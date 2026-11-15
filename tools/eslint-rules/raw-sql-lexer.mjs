/**
 * A small PostgreSQL lexer and statement classifier for the raw-SQL checks of the local ESLint rules (TASK-020 part
 * 020-D): `platform/db-raw-sql` (PR44-SEC-05: transaction-control and session statements in a tagged raw template) and
 * `platform/system-model-owner` (D-ARCH-124: `rawSystemTable`, the SYSTEM tables a raw template names).
 *
 * The run-time twin is apps/api/src/platform/db/raw-statement.ts (the `TenantDb` raw guard). Tools may not import
 * apps/api and the api may not import tools, so the two are kept equal by one shared corpus,
 * tests/fixtures/sql/raw-statement-corpus.json, which tools/lint/raw-sql-lexer.test.ts and
 * apps/api/src/platform/db/raw-statement.test.ts both run (a drift fails one of them).
 *
 * Tokens: words (unquoted identifiers and keywords, lower-cased as PostgreSQL folds them), quoted identifiers (`"…"`,
 * `""` unescaped, case kept), strings (`'…'`, the `E`/`B`/`X`/`N` prefixed forms, Unicode-escape strings, dollar-quoted
 * `$tag$…$tag$`), bind parameters (`$1`) and single punctuation characters. Comments (`--`, nested block comments)
 * and white space are dropped. A Unicode-escape identifier (it can spell any name in escapes) or an unterminated
 * string, identifier or comment makes the text unreadable; every caller fails closed on it.
 *
 * The lexer reads the text as PostgreSQL 18's scan.l does, where a difference would hide a statement (PR54-SEC-01,
 * code review R1-M1 of PR #54):
 *  - white space is `[ \t\n\r\f\v]` only, and a `--` comment ends at the first LF or CR;
 *  - a character outside ASCII outside a string, a quoted identifier or a comment makes the text unreadable.
 *    PostgreSQL reads every byte >= 0x80 as an identifier character, so `<NBSP>$q$` is one identifier there; the
 *    lexer refuses instead of following, because application SQL is ASCII, and identifier folding, the server
 *    encoding and UTF-16 code units are then never compared with PostgreSQL's byte rules;
 *  - a string followed by white space that holds a newline (comments allowed) and another quote continues the SAME
 *    literal in the same mode (`xqs` in scan.l), so `E'a'<LF>'\' …'` keeps its backslash escapes. The continuation
 *    pattern is unambiguous (linear time; the obvious one is exponential in a run of dashes, PR54-SEC-06);
 *  - a template is rendered as Prisma's `Sql#text` renders it: the parts joined with `$1`, `$2`, … and no spaces.
 * Name and keyword comparisons use regular-expression literals, so this module carries none of the text that
 * `platform/tenant-context-sql` refuses in string literals.
 */

/**
 * @typedef {{ kind: 'word' | 'quoted' | 'string' | 'param' | 'punct'; value: string }} SqlToken
 * @typedef {{ tokens: SqlToken[]; unreadable?: string }} SqlLex
 * @typedef {'transaction-control' | 'session' | 'anonymous-block' | 'session-setter' | 'unreadable'} RefusedForm
 * @typedef {{ form: RefusedForm; detail: string }} Refusal
 */

const WORD_START = /[A-Za-z_]/u;
const WORD_PART = /[A-Za-z0-9_$]/u;
/** PostgreSQL's `space`; not `\s`, which also matches the Unicode spaces. */
const SPACE = /[ \t\n\r\f\v]/u;
const NON_ASCII = /[\u0080-\u{10ffff}]/u;
/** The end of a `--` comment (`non_newline` is `[^\n\r]`). Global: used with `lastIndex`. */
const LINE_END = /[\n\r]/gu;
/**
 * A quote continuation after a closing quote (scan.l `quotecontinue`): horizontal white space, an optional comment,
 * a newline, then white space or comments that end in a newline, then the quote. Sticky: used with `lastIndex`.
 */
const CONTINUATION = /[ \t\f\v]*(?:--[^\n\r]*)?[\n\r](?:[ \t\n\r\f\v]|--[^\n\r]*[\n\r])*'/uy;
const PARAM = /^\$\d+/u;
const DOLLAR_TAG = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/u;
/** One-letter string prefixes (`E'…'` takes backslash escapes). */
const STRING_PREFIX = /^[ebxn]$/u;
const UNICODE_PREFIX = /^u$/u;

/**
 * Reads a single-quoted string starting at `start` (the opening quote), quote continuations included.
 * @param {string} text
 * @param {number} start
 * @param {boolean} backslashEscapes `E'…'`
 * @returns {{ value: string; end: number } | undefined} undefined when unterminated
 */
function readString(text, start, backslashEscapes) {
  let value = '';
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (backslashEscapes && ch === '\\') {
      value += text.slice(i, i + 2);
      i += 1;
    } else if (ch === "'") {
      if (text[i + 1] !== "'") {
        CONTINUATION.lastIndex = i + 1;
        if (!CONTINUATION.test(text)) return { value, end: i + 1 };
        i = CONTINUATION.lastIndex - 1;
      } else {
        value += "'";
        i += 1;
      }
    } else value += ch;
  }
  return undefined;
}

/**
 * Reads a double-quoted identifier starting at `start` (the opening quote).
 * @param {string} text
 * @param {number} start
 * @returns {{ value: string; end: number } | undefined} undefined when unterminated
 */
function readQuoted(text, start) {
  let value = '';
  for (let i = start + 1; i < text.length; i += 1) {
    const ch = text[i];
    if (ch === '"') {
      if (text[i + 1] !== '"') return { value, end: i + 1 };
      value += '"';
      i += 1;
    } else value += ch;
  }
  return undefined;
}

/**
 * @param {string} text
 * @param {number} start
 * @returns {number} the index after the line comment that opens at `start` (the end of the text when it has no LF or CR)
 */
function skipLineComment(text, start) {
  LINE_END.lastIndex = start;
  const end = LINE_END.exec(text);
  return end === null ? text.length : end.index + 1;
}

/**
 * @param {string} text
 * @param {number} start index of a block comment's opening slash
 * @returns {number} the index after the comment, or -1 when unterminated (nested comments count)
 */
function skipBlockComment(text, start) {
  let depth = 0;
  for (let i = start; i < text.length;) {
    if (text[i] === '/' && text[i + 1] === '*') {
      depth += 1;
      i += 2;
    } else if (text[i] === '*' && text[i + 1] === '/') {
      depth -= 1;
      i += 2;
      if (depth === 0) return i;
    } else i += 1;
  }
  return -1;
}

/**
 * Splits SQL text into tokens.
 * @param {string} text
 * @returns {SqlLex}
 */
export function lexSql(text) {
  /** @type {SqlToken[]} */
  const tokens = [];
  /** @param {string} reason */
  const unreadable = (reason) => ({ tokens, unreadable: reason });
  let i = 0;
  while (i < text.length) {
    const ch = text[i] ?? '';
    const next = text[i + 1];
    if (SPACE.test(ch)) {
      i += 1;
    } else if (ch === '-' && next === '-') {
      i = skipLineComment(text, i);
    } else if (ch === '/' && next === '*') {
      i = skipBlockComment(text, i);
      if (i === -1) return unreadable('an unterminated comment');
    } else if (ch === "'") {
      const string = readString(text, i, false);
      if (string === undefined) return unreadable('an unterminated string');
      tokens.push({ kind: 'string', value: string.value });
      i = string.end;
    } else if (ch === '"') {
      const quoted = readQuoted(text, i);
      if (quoted === undefined) return unreadable('an unterminated quoted identifier');
      tokens.push({ kind: 'quoted', value: quoted.value });
      i = quoted.end;
    } else if (ch === '$') {
      const rest = text.slice(i);
      const param = PARAM.exec(rest)?.[0];
      const tag = param === undefined ? DOLLAR_TAG.exec(rest)?.[0] : undefined;
      if (param !== undefined) {
        tokens.push({ kind: 'param', value: param });
        i += param.length;
      } else if (tag !== undefined) {
        const close = text.indexOf(tag, i + tag.length);
        if (close === -1) return unreadable('an unterminated dollar-quoted string');
        tokens.push({ kind: 'string', value: text.slice(i + tag.length, close) });
        i = close + tag.length;
      } else {
        tokens.push({ kind: 'punct', value: ch });
        i += 1;
      }
    } else if (WORD_START.test(ch)) {
      let end = i + 1;
      while (end < text.length && WORD_PART.test(text[end] ?? '')) end += 1;
      const word = text.slice(i, end).toLowerCase();
      if (text[end] === "'" && STRING_PREFIX.test(word)) {
        const string = readString(text, end, word === 'e');
        if (string === undefined) return unreadable('an unterminated string');
        tokens.push({ kind: 'string', value: string.value });
        i = string.end;
      } else if (UNICODE_PREFIX.test(word) && text[end] === '&' && text[end + 1] === "'") {
        const string = readString(text, end + 1, false);
        if (string === undefined) return unreadable('an unterminated string');
        tokens.push({ kind: 'string', value: string.value });
        i = string.end;
      } else if (UNICODE_PREFIX.test(word) && text[end] === '&' && text[end + 1] === '"') {
        return unreadable('a Unicode-escape identifier');
      } else {
        tokens.push({ kind: 'word', value: word });
        i = end;
      }
    } else if (NON_ASCII.test(ch)) {
      return unreadable('a character outside ASCII outside a string or comment');
    } else {
      tokens.push({ kind: 'punct', value: ch });
      i += 1;
    }
  }
  return { tokens };
}

/**
 * The text of a tagged template as Prisma sends it (`Sql#text`): the parts joined with `$1`, `$2`, … and nothing
 * else. A quasi without a cooked value (an invalid escape in a tagged template) is undefined, and so is the whole text.
 * @param {readonly (string | null | undefined)[]} strings
 * @returns {string | undefined}
 */
export function templateText(strings) {
  if (strings.some((part) => typeof part !== 'string')) return undefined;
  const parts = /** @type {readonly string[]} */ (strings);
  return parts.reduce((text, part, index) => (index === 0 ? part : `${text}$${index}${part}`), '');
}

/**
 * Statement tokens split at top-level `;` (empty statements dropped).
 * @param {readonly SqlToken[]} tokens
 * @returns {SqlToken[][]}
 */
export function statementsOf(tokens) {
  /** @type {SqlToken[][]} */
  const statements = [[]];
  for (const token of tokens) {
    if (token.kind === 'punct' && token.value === ';') statements.push([]);
    else statements.at(-1)?.push(token);
  }
  return statements.filter((statement) => statement.length > 0);
}

/**
 * The names a statement mentions as identifiers: unquoted words (lower-cased) and quoted identifiers (as written).
 * @param {readonly SqlToken[]} tokens
 * @returns {string[]}
 */
export const identifiersOf = (tokens) =>
  tokens.filter((token) => token.kind === 'word' || token.kind === 'quoted').map((token) => token.value);

/** First keywords that end, nest or prepare a transaction. */
const TRANSACTION_CONTROL = /^(?:begin|start|commit|end|rollback|abort|savepoint|release|prepare)$/u;
/**
 * First keywords that change the pooled session (they outlive the transaction or the request); a cursor (`DECLARE …
 * WITH HOLD` outlives the commit and is read by a later request's `FETCH` / `MOVE`, PR54-SEC-02 (a)).
 */
const SESSION = /^(?:set|reset|discard|listen|unlisten|notify|load|execute|deallocate|declare|fetch|move|close)$/u;
const ANONYMOUS_BLOCK = /^do$/u;
const SETTER_NAME = /^set_config$/u;
/**
 * The settings a literal-`true` setter may name (a plain literal, case-insensitive as setting names are): the
 * withTenantTx context keys and the three transaction-local timeouts. Any other setting, a computed or bound name,
 * an escape in the name, `search_path`, `role` and the string-syntax settings are refused (PR54-SEC-01 (e)).
 */
const LOCAL_SETTING = /^(?:app\.[a-z_]+|statement_timeout|lock_timeout|idle_in_transaction_session_timeout)$/iu;
/** The settings that change how PostgreSQL reads a string (PR54-SEC-01 (e); migration-lint rule 20 parity). */
const STRING_SYNTAX_SETTING = /standard_conforming_strings|backslash_quote/iu;
/** Session advisory locks (held until the backend closes); the `_xact_` forms end with the transaction. */
const SESSION_LOCK = /^pg_(?:try_)?advisory_(?:lock|unlock)(?:_shared|_all)?$/u;
const SETTINGS_VIEW = /^pg_settings$/u;
const UPDATE = /^update$/u;
const TRUE = /^true$/u;
const READ_ONLY_TRANSACTION = ['set', 'transaction', 'read', 'only'];

/**
 * @param {SqlToken | undefined} token
 * @param {RegExp} name
 */
const isName = (token, name) => (token?.kind === 'word' || token?.kind === 'quoted') && name.test(token.value);
/**
 * @param {SqlToken | undefined} token
 * @param {string} value
 */
const isPunct = (token, value) => token?.kind === 'punct' && token.value === value;

/**
 * Every parenthesis pair of a statement in one pass (linear, PR54-SEC-06): the index of the matching `)` and the
 * top-level commas of each `(`; an unbalanced `(` has no close.
 * @param {readonly SqlToken[]} statement
 * @returns {{ close: Map<number, number>; commas: Map<number, number[]> }}
 */
function parentheses(statement) {
  /** @type {Map<number, number>} */
  const close = new Map();
  /** @type {Map<number, number[]>} */
  const commas = new Map();
  /** @type {number[]} */
  const open = [];
  statement.forEach((token, index) => {
    if (isPunct(token, '(')) {
      open.push(index);
      commas.set(index, []);
    } else if (isPunct(token, ')')) {
      const start = open.pop();
      if (start !== undefined) close.set(start, index);
    } else if (isPunct(token, ',') && open.length > 0) commas.get(/** @type {number} */ (open.at(-1)))?.push(index);
  });
  return { close, commas };
}

/**
 * Why a setter call at `index` is refused, or undefined when it is a transaction-local setter: exactly three
 * arguments, a single string token naming a listed setting, and the literal `true` as `is_local`.
 * @param {readonly SqlToken[]} statement
 * @param {number} index
 * @param {{ close: Map<number, number>; commas: Map<number, number[]> }} pairs
 * @returns {string | undefined}
 */
function refusedSetter(statement, index, pairs) {
  const open = index + 1;
  const end = pairs.close.get(open);
  const commas = pairs.commas.get(open);
  if (end === undefined || commas?.length !== 2) return 'the setting function without a literal true is_local';
  const [first = 0, second = 0] = commas;
  const local = statement[second + 1];
  if (second + 2 !== end || local?.kind !== 'word' || !TRUE.test(local.value)) {
    return 'the setting function without a literal true is_local';
  }
  const name = statement[open + 1];
  if (first !== open + 2 || name?.kind !== 'string' || !LOCAL_SETTING.test(name.value)) {
    return 'the setting function on a setting outside the transaction-local list';
  }
  return undefined;
}

/**
 * A session-level setter or lock anywhere in the statement: the setter function unless transaction-local (see
 * {@link refusedSetter}); an `UPDATE` of `pg_settings` (equivalent to a session `SET`, D-SEC-PR42-02); any mention of a
 * string-syntax setting; a session advisory lock function.
 * @param {readonly SqlToken[]} statement
 * @returns {{ form: RefusedForm; detail: string } | undefined}
 */
function sessionSetter(statement) {
  /** @type {{ close: Map<number, number>; commas: Map<number, number[]> } | undefined} */
  let pairs;
  for (let i = 0; i < statement.length; i += 1) {
    const token = statement[i];
    if (isName(token, SESSION_LOCK)) return { form: 'session', detail: 'a session advisory lock' };
    if (token !== undefined && token.kind !== 'punct' && STRING_SYNTAX_SETTING.test(token.value)) {
      return { form: 'session-setter', detail: 'a string-syntax setting' };
    }
    if (!isName(token, SETTER_NAME)) continue;
    pairs ??= parentheses(statement);
    const refused = refusedSetter(statement, i, pairs);
    if (refused !== undefined) return { form: 'session-setter', detail: refused };
  }
  if (
    statement.some((token) => isName(token, SETTINGS_VIEW)) &&
    statement.some((token) => token.kind === 'word' && UPDATE.test(token.value))
  ) {
    return { form: 'session-setter', detail: 'UPDATE pg_settings' };
  }
  return undefined;
}

/**
 * Why a raw statement text is refused, or undefined when it is allowed (PR44-SEC-05). Every statement of the text
 * (top-level `;`) is checked:
 *  - `transaction-control`: a first keyword that ends or nests the transaction (`COMMIT`, `ROLLBACK`, `END`, `ABORT`,
 *    `BEGIN`, `START`, `SAVEPOINT`, `RELEASE`, `PREPARE`);
 *  - `session`: a first keyword that changes the pooled session (`SET` in any form, `RESET`, `DISCARD`, `LISTEN`,
 *    `UNLISTEN`, `NOTIFY`, `LOAD`, `EXECUTE`, `DEALLOCATE`, and the cursor statements `DECLARE`, `FETCH`, `MOVE`,
 *    `CLOSE`); a session advisory lock function anywhere; `allowReadOnlyTransaction` admits exactly
 *    `SET TRANSACTION READ ONLY` (withTenantTx's read-only `load`; it can only restrict);
 *  - `anonymous-block`: `DO` (its body can build any of the above from concatenated text, D-SEC-PR42-02);
 *  - `session-setter`: see {@link sessionSetter};
 *  - `unreadable`: the lexer cannot read the text (fail closed).
 * @param {string} text
 * @param {{ allowReadOnlyTransaction?: boolean }} [options]
 * @returns {Refusal | undefined}
 */
export function refusedStatement(text, options = {}) {
  const lexed = lexSql(text);
  if (lexed.unreadable !== undefined) return { form: 'unreadable', detail: lexed.unreadable };
  for (const statement of statementsOf(lexed.tokens)) {
    const first = statement[0];
    const keyword = first?.kind === 'word' ? first.value : '';
    if (TRANSACTION_CONTROL.test(keyword)) return { form: 'transaction-control', detail: keyword.toUpperCase() };
    if (SESSION.test(keyword)) {
      const readOnly =
        statement.length === READ_ONLY_TRANSACTION.length &&
        statement.every((token, index) => token.kind === 'word' && token.value === READ_ONLY_TRANSACTION[index]);
      if (!(readOnly && options.allowReadOnlyTransaction === true)) return { form: 'session', detail: keyword.toUpperCase() };
    }
    if (ANONYMOUS_BLOCK.test(keyword)) return { form: 'anonymous-block', detail: 'DO' };
    const setter = sessionSetter(statement);
    if (setter !== undefined) return setter;
  }
  return undefined;
}
