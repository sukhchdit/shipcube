/**
 * Run-time classifier of the `TenantDb` raw guard (PR44-SEC-05; TASK-020 part 020-D): a tagged `$queryRaw` /
 * `$executeRaw` template whose statement ends, nests or prepares the tenant transaction, changes the pooled session,
 * is an anonymous `DO` block, sets a setting beyond the transaction, or cannot be read, is refused before Prisma sends
 * anything. Without it, `` db.$executeRaw`COMMIT` `` from a repository commits the read-only `load` transaction (or
 * separates the handler's writes from their audit entry) and the rest runs in autocommit, without the tenant context;
 * `SET search_path …` / `RESET ALL` change the pooled backend for later requests.
 *
 * The lint twin is tools/eslint-rules/raw-sql-lexer.mjs (`platform/db-raw-sql` reports the same statements at build
 * time). The api may not import tools and tools may not import the api, so the two are kept equal by one shared
 * corpus, tests/fixtures/sql/raw-statement-corpus.json, run by both twins' tests: a change to one alone fails a suite.
 *
 * A small PostgreSQL lexer, not a parser: words (lower-cased as PostgreSQL folds unquoted names), quoted identifiers,
 * strings (`'…'`, `E'…'` and the other prefixes, Unicode-escape strings, dollar quotes), bind parameters and single
 * punctuation characters; comments (nested block comments included) and white space are dropped. A Unicode-escape
 * identifier (it can spell any name in escapes) or an unterminated token makes the text unreadable, which is refused.
 * It reads the text as PostgreSQL 18's scan.l does wherever a difference would hide a statement (PR54-SEC-01, code
 * review R1-M1 of PR #54): white space is `[ \t\n\r\f\v]` only; a `--` comment ends at the first LF or CR; a character
 * outside ASCII outside a string, quoted identifier or comment is unreadable (PostgreSQL would read it as part of an
 * identifier; application SQL is ASCII, so the guard refuses rather than follow byte and encoding rules); a string
 * continued across a newline (`'…'<LF>'…'`) stays one literal in the same mode, so `E'…'` keeps its escapes; and the
 * text is rendered exactly as Prisma's `Sql#text` renders it (`$1`, `$2`, … with no spaces).
 * Name and keyword comparisons use regular-expression literals, so this file carries none of the text that
 * `platform/tenant-context-sql` refuses in string literals.
 * Residual (pinned in the corpus): a function or procedure whose BODY commits or sets; function bodies are
 * bootstrap/migration DDL, owned by that lane, and the runtime roles cannot create functions.
 */

type TokenKind = 'word' | 'quoted' | 'string' | 'param' | 'punct';

interface SqlToken {
  readonly kind: TokenKind;
  readonly value: string;
}

/** The refused forms (the same names as the lint twin). */
export type RawStatementForm = 'transaction-control' | 'session' | 'anonymous-block' | 'session-setter' | 'unreadable';

export interface RawStatementRefusal {
  readonly form: RawStatementForm;
  /** The refused keyword or construct (never a value: values are bind parameters and never reach the text). */
  readonly detail: string;
}

export interface RawStatementOptions {
  /** Admit exactly `SET TRANSACTION READ ONLY` (only withTenantTx sends it, on the raw transaction client). */
  readonly allowReadOnlyTransaction?: boolean;
}

const WORD_START = /[A-Za-z_]/u;
const WORD_PART = /[A-Za-z0-9_$]/u;
/** PostgreSQL's `space`; not `\s`, which also matches the Unicode spaces. */
const SPACE = /[ \t\n\r\f\v]/u;
const NON_ASCII = /[\u0080-\u{10ffff}]/u;
/** The end of a `--` comment (`non_newline` is `[^\n\r]`). Global: used with `lastIndex`. */
const LINE_END = /[\n\r]/gu;
/** A quote continuation after a closing quote (scan.l `quotecontinue`), unambiguous (linear time). Sticky. */
const CONTINUATION = /[ \t\f\v]*(?:--[^\n\r]*)?[\n\r](?:[ \t\n\r\f\v]|--[^\n\r]*[\n\r])*'/uy;
const PARAM = /^\$\d+/u;
const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u;
const STRING_PREFIX = /^[ebxn]$/u;
const UNICODE_PREFIX = /^u$/u;

const TRANSACTION_CONTROL = /^(?:begin|start|commit|end|rollback|abort|savepoint|release|prepare)$/u;
/** Session first keywords; the cursor statements too (`DECLARE … WITH HOLD` outlives the commit, PR54-SEC-02 (a)). */
const SESSION = /^(?:set|reset|discard|listen|unlisten|notify|load|execute|deallocate|declare|fetch|move|close)$/u;
const ANONYMOUS_BLOCK = /^do$/u;
const SETTER_NAME = /^set_config$/u;
/** The settings a literal-`true` setter may name: the withTenantTx context keys and three transaction-local timeouts. */
const LOCAL_SETTING = /^(?:app\.[a-z_]+|statement_timeout|lock_timeout|idle_in_transaction_session_timeout)$/iu;
/** The settings that change how PostgreSQL reads a string (PR54-SEC-01 (e)); refused wherever they are named. */
const STRING_SYNTAX_SETTING = /standard_conforming_strings|backslash_quote/iu;
/** Session advisory locks (held until the backend closes); the `_xact_` forms end with the transaction. */
const SESSION_LOCK = /^pg_(?:try_)?advisory_(?:lock|unlock)(?:_shared|_all)?$/u;
const SETTINGS_VIEW = /^pg_settings$/u;
const UPDATE = /^update$/u;
const TRUE = /^true$/u;
const READ_ONLY_TRANSACTION = ['set', 'transaction', 'read', 'only'] as const;
const NOT_LOCAL = 'the setting function without a literal true is_local';
const NOT_LISTED = 'the setting function on a setting outside the transaction-local list';

/** Thrown by the lexer only; `reason` names what could not be read (never statement text). */
class Unreadable extends Error {
  constructor(readonly reason: string) {
    super(reason);
  }
}

interface Read {
  readonly value: string;
  readonly end: number;
}

/** A single-quoted string from its opening quote, quote continuations included; `backslashEscapes` for `E'…'`. */
function readString(text: string, start: number, backslashEscapes: boolean): Read {
  let value = '';
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (backslashEscapes && ch === '\\') {
      value += text.slice(i, i + 2);
      i += 1;
    } else if (ch === "'" && text.charAt(i + 1) === "'") {
      value += "'";
      i += 1;
    } else if (ch === "'") {
      CONTINUATION.lastIndex = i + 1;
      if (!CONTINUATION.test(text)) return { value, end: i + 1 };
      i = CONTINUATION.lastIndex - 1;
    } else value += ch;
  }
  throw new Unreadable('an unterminated string');
}

/** A double-quoted identifier from its opening quote. */
function readQuoted(text: string, start: number): Read {
  let value = '';
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text.charAt(i);
    if (ch === '"') {
      if (text.charAt(i + 1) !== '"') return { value, end: i + 1 };
      value += '"';
      i += 1;
    } else value += ch;
  }
  throw new Unreadable('an unterminated quoted identifier');
}

/** The index after a line comment that opens at `start` (it ends at the first LF or CR, or the end of the text). */
function skipLineComment(text: string, start: number): number {
  LINE_END.lastIndex = start;
  const end = LINE_END.exec(text);
  return end === null ? text.length : end.index + 1;
}

/** The index after a (nested) block comment that opens at `start`. */
function skipBlockComment(text: string, start: number): number {
  let depth = 0;
  for (let i = start; i < text.length;) {
    if (text.startsWith('/*', i)) {
      depth += 1;
      i += 2;
    } else if (text.startsWith('*/', i)) {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
    } else i += 1;
  }
  throw new Unreadable('an unterminated comment');
}

/** The token at `start` of a `$`: a bind parameter, a dollar-quoted string or punctuation. */
function readDollar(text: string, start: number): { token: SqlToken; end: number } {
  const rest = text.slice(start);
  const param = PARAM.exec(rest)?.[0];
  if (param !== undefined) return { token: { kind: 'param', value: param }, end: start + param.length };
  const tag = DOLLAR_TAG.exec(rest)?.[0];
  if (tag === undefined) return { token: { kind: 'punct', value: '$' }, end: start + 1 };
  const close = text.indexOf(tag, start + tag.length);
  if (close === -1) throw new Unreadable('an unterminated dollar-quoted string');
  return { token: { kind: 'string', value: text.slice(start + tag.length, close) }, end: close + tag.length };
}

/** A word, or the prefixed string or Unicode-escape token it starts. */
function readWord(text: string, start: number): { token: SqlToken; end: number } {
  let end = start + 1;
  while (end < text.length && WORD_PART.test(text.charAt(end))) end += 1;
  const word = text.slice(start, end).toLowerCase();
  const after = text.charAt(end);
  if (after === "'" && STRING_PREFIX.test(word)) {
    const string = readString(text, end, word === 'e');
    return { token: { kind: 'string', value: string.value }, end: string.end };
  }
  if (UNICODE_PREFIX.test(word) && after === '&') {
    const quote = text.charAt(end + 1);
    if (quote === '"') throw new Unreadable('a Unicode-escape identifier');
    if (quote === "'") {
      const string = readString(text, end + 1, false);
      return { token: { kind: 'string', value: string.value }, end: string.end };
    }
  }
  return { token: { kind: 'word', value: word }, end };
}

/** Splits SQL text into tokens; throws `Unreadable`. */
function lex(text: string): SqlToken[] {
  const tokens: SqlToken[] = [];
  let i = 0;
  while (i < text.length) {
    const ch = text.charAt(i);
    if (SPACE.test(ch)) i += 1;
    else if (text.startsWith('--', i)) i = skipLineComment(text, i);
    else if (text.startsWith('/*', i)) i = skipBlockComment(text, i);
    else if (ch === "'") {
      const string = readString(text, i, false);
      tokens.push({ kind: 'string', value: string.value });
      i = string.end;
    } else if (ch === '"') {
      const quoted = readQuoted(text, i);
      tokens.push({ kind: 'quoted', value: quoted.value });
      i = quoted.end;
    } else if (NON_ASCII.test(ch)) {
      throw new Unreadable('a character outside ASCII outside a string or comment');
    } else {
      const read = ch === '$' ? readDollar(text, i) : WORD_START.test(ch) ? readWord(text, i) : undefined;
      tokens.push(read?.token ?? { kind: 'punct', value: ch });
      i = read?.end ?? i + 1;
    }
  }
  return tokens;
}

function statementsOf(tokens: readonly SqlToken[]): SqlToken[][] {
  const statements: SqlToken[][] = [[]];
  for (const token of tokens) {
    if (token.kind === 'punct' && token.value === ';') statements.push([]);
    else statements.at(-1)?.push(token);
  }
  return statements.filter((statement) => statement.length > 0);
}

const isName = (token: SqlToken | undefined, name: RegExp): boolean =>
  (token?.kind === 'word' || token?.kind === 'quoted') && name.test(token.value);
const isPunct = (token: SqlToken | undefined, value: string): boolean => token?.kind === 'punct' && token.value === value;

interface Parentheses {
  /** The index of the matching `)` of each balanced `(`. */
  readonly close: ReadonlyMap<number, number>;
  /** The top-level commas of each `(`. */
  readonly commas: ReadonlyMap<number, readonly number[]>;
}

/** Every parenthesis pair of a statement in one pass (linear, PR54-SEC-06). */
function parentheses(statement: readonly SqlToken[]): Parentheses {
  const close = new Map<number, number>();
  const commas = new Map<number, number[]>();
  const open: number[] = [];
  for (const [index, token] of statement.entries()) {
    if (isPunct(token, '(')) {
      open.push(index);
      commas.set(index, []);
    } else if (isPunct(token, ')')) {
      const start = open.pop();
      if (start !== undefined) close.set(start, index);
    } else if (isPunct(token, ',') && open.length > 0) commas.get(open.at(-1) ?? -1)?.push(index);
  }
  return { close, commas };
}

/** Why the setter call at `index` is refused: not three arguments, a listed literal name and a literal `true` is_local. */
function refusedSetter(statement: readonly SqlToken[], index: number, pairs: Parentheses): string | undefined {
  const open = index + 1;
  const end = pairs.close.get(open);
  const commas = pairs.commas.get(open);
  if (end === undefined || commas?.length !== 2) return NOT_LOCAL;
  const [first = 0, second = 0] = commas;
  const local = statement[second + 1];
  if (second + 2 !== end || local?.kind !== 'word' || !TRUE.test(local.value)) return NOT_LOCAL;
  const name = statement[open + 1];
  return first !== open + 2 || name?.kind !== 'string' || !LOCAL_SETTING.test(name.value) ? NOT_LISTED : undefined;
}

/** A setter or session lock anywhere: see the lint twin's `sessionSetter`; an UPDATE of pg_settings. */
function sessionSetter(statement: readonly SqlToken[]): RawStatementRefusal | undefined {
  let pairs: Parentheses | undefined;
  for (const [index, token] of statement.entries()) {
    if (isName(token, SESSION_LOCK)) return { form: 'session', detail: 'a session advisory lock' };
    if (token.kind !== 'punct' && STRING_SYNTAX_SETTING.test(token.value)) {
      return { form: 'session-setter', detail: 'a string-syntax setting' };
    }
    if (!isName(token, SETTER_NAME)) continue;
    pairs ??= parentheses(statement);
    const refused = refusedSetter(statement, index, pairs);
    if (refused !== undefined) return { form: 'session-setter', detail: refused };
  }
  const updates = statement.some((token) => token.kind === 'word' && UPDATE.test(token.value));
  return updates && statement.some((token) => isName(token, SETTINGS_VIEW))
    ? { form: 'session-setter', detail: 'UPDATE pg_settings' }
    : undefined;
}

const isReadOnlyTransaction = (statement: readonly SqlToken[]): boolean =>
  statement.length === READ_ONLY_TRANSACTION.length &&
  statement.every((token, index) => token.kind === 'word' && token.value === READ_ONLY_TRANSACTION[index]);

/** Why one statement is refused, or undefined. */
function refusedOne(statement: readonly SqlToken[], options: RawStatementOptions): RawStatementRefusal | undefined {
  const first = statement[0];
  const keyword = first?.kind === 'word' ? first.value : '';
  if (TRANSACTION_CONTROL.test(keyword)) return { form: 'transaction-control', detail: keyword.toUpperCase() };
  if (SESSION.test(keyword) && !(options.allowReadOnlyTransaction === true && isReadOnlyTransaction(statement))) {
    return { form: 'session', detail: keyword.toUpperCase() };
  }
  if (ANONYMOUS_BLOCK.test(keyword)) return { form: 'anonymous-block', detail: 'DO' };
  return sessionSetter(statement);
}

/** Why a raw statement text is refused (every `;`-separated statement is checked), or undefined when it is allowed. */
export function refusedRawText(text: string, options: RawStatementOptions = {}): RawStatementRefusal | undefined {
  let tokens: SqlToken[];
  try {
    tokens = lex(text);
  } catch (error) {
    // The lexer throws only Unreadable; anything it cannot read is refused (fail closed).
    return { form: 'unreadable', detail: (error as Unreadable).reason };
  }
  for (const statement of statementsOf(tokens)) {
    const refusal = refusedOne(statement, options);
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}

/**
 * The text Prisma sends for a tagged template (`Sql#text` of @prisma/client-runtime-utils): the parts joined with
 * `$1`, `$2`, … and nothing else. Spaces around the parameter would change what the lexer reads: `$q${v}$q$` is the
 * dollar-quoted string `1` for PostgreSQL, but `$q $1 $q$` opens a dollar quote (PR54-SEC-01 (d)).
 */
export function prismaText(strings: readonly string[]): string {
  return strings.reduce((text, part, index) => (index === 0 ? part : `${text}$${String(index)}${part}`), '');
}

/**
 * The guard's entry point: the strings of a tagged template, rendered as Prisma sends them ({@link prismaText}). A
 * part that is not a string (an invalid escape in a tagged template has no cooked value) makes the text unreadable.
 */
export function refusedRawStatement(strings: readonly unknown[]): RawStatementRefusal | undefined {
  if (!strings.every((part): part is string => typeof part === 'string')) {
    return { form: 'unreadable', detail: 'a template part with an invalid escape' };
  }
  return refusedRawText(prismaText(strings));
}
