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
 * Name and keyword comparisons use regular-expression literals, so this module carries none of the text that
 * `platform/tenant-context-sql` refuses in string literals.
 */

/**
 * @typedef {{ kind: 'word' | 'quoted' | 'string' | 'param' | 'punct'; value: string }} SqlToken
 * @typedef {{ tokens: SqlToken[]; unreadable?: string }} SqlLex
 * @typedef {'transaction-control' | 'session' | 'anonymous-block' | 'session-setter' | 'unreadable'} RefusedForm
 * @typedef {{ form: RefusedForm; detail: string }} Refusal
 */

const WORD_START = /[A-Za-z_\u0080-￿]/u;
const WORD_PART = /[A-Za-z0-9_$\u0080-￿]/u;
const SPACE = /\s/u;
const PARAM = /^\$\d+/u;
const DOLLAR_TAG = /^\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/u;
/** One-letter string prefixes (`E'…'` takes backslash escapes). */
const STRING_PREFIX = /^[ebxn]$/u;
const UNICODE_PREFIX = /^u$/u;

/**
 * Reads a single-quoted string starting at `start` (the opening quote).
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
      if (text[i + 1] !== "'") return { value, end: i + 1 };
      value += "'";
      i += 1;
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
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end + 1;
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
    } else {
      tokens.push({ kind: 'punct', value: ch });
      i += 1;
    }
  }
  return { tokens };
}

/**
 * The text of a tagged template as one statement: each `${…}` becomes a bind parameter, as Prisma sends it. A quasi
 * without a cooked value (an invalid escape in a tagged template) is undefined, and so is the whole text.
 * @param {readonly (string | null | undefined)[]} strings
 * @returns {string | undefined}
 */
export function templateText(strings) {
  if (strings.some((part) => typeof part !== 'string')) return undefined;
  return strings.join(' $1 ');
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
/** First keywords that change the pooled session (they outlive the transaction or the request). */
const SESSION = /^(?:set|reset|discard|listen|unlisten|notify|load|execute|deallocate)$/u;
const ANONYMOUS_BLOCK = /^do$/u;
const SETTER_NAME = /^set_config$/u;
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
 * The top-level argument token lists of a call whose `(` is at `open`, or undefined when there is none or it is unbalanced.
 * @param {readonly SqlToken[]} tokens
 * @param {number} open
 * @returns {SqlToken[][] | undefined}
 */
function callArguments(tokens, open) {
  const first = tokens[open];
  if (first?.kind !== 'punct' || first.value !== '(') return undefined;
  /** @type {SqlToken[][]} */
  const args = [[]];
  let depth = 1;
  for (let i = open + 1; i < tokens.length; i += 1) {
    const token = /** @type {SqlToken} */ (tokens[i]);
    if (token.kind === 'punct' && token.value === '(') depth += 1;
    else if (token.kind === 'punct' && token.value === ')') {
      depth -= 1;
      if (depth === 0) return args;
    } else if (depth === 1 && token.kind === 'punct' && token.value === ',') {
      args.push([]);
      continue;
    }
    args.at(-1)?.push(token);
  }
  return undefined;
}

/**
 * A session-level setter anywhere in the statement: the setter function unless it is called with exactly three
 * arguments and the literal `true` as `is_local` (transaction-local, as withTenantTx and the audit store use it), and
 * an `UPDATE` of `pg_settings` (equivalent to a session `SET`, D-SEC-PR42-02).
 * @param {readonly SqlToken[]} statement
 * @returns {string | undefined}
 */
function sessionSetter(statement) {
  for (let i = 0; i < statement.length; i += 1) {
    if (!isName(statement[i], SETTER_NAME)) continue;
    const args = callArguments(statement, i + 1);
    const local = args?.[2];
    if (args?.length !== 3 || local?.length !== 1 || local[0]?.kind !== 'word' || !TRUE.test(local[0].value)) {
      return 'the setting function without a literal true is_local';
    }
  }
  if (
    statement.some((token) => isName(token, SETTINGS_VIEW)) &&
    statement.some((token) => token.kind === 'word' && UPDATE.test(token.value))
  ) {
    return 'UPDATE pg_settings';
  }
  return undefined;
}

/**
 * Why a raw statement text is refused, or undefined when it is allowed (PR44-SEC-05). Every statement of the text
 * (top-level `;`) is checked:
 *  - `transaction-control`: a first keyword that ends or nests the transaction (`COMMIT`, `ROLLBACK`, `END`, `ABORT`,
 *    `BEGIN`, `START`, `SAVEPOINT`, `RELEASE`, `PREPARE`);
 *  - `session`: a first keyword that changes the pooled session (`SET` in any form, `RESET`, `DISCARD`, `LISTEN`,
 *    `UNLISTEN`, `NOTIFY`, `LOAD`, `EXECUTE`, `DEALLOCATE`); `allowReadOnlyTransaction` admits exactly
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
    if (setter !== undefined) return { form: 'session-setter', detail: setter };
  }
  return undefined;
}
