/**
 * A small PostgreSQL lexer for the bootstrap runner and the migration linter (data-model.md §8.1, §8.3). It knows
 * exactly what both need: comments (`--`, nested `/* *\/`), string literals (`'…'`, `E'…'`), quoted identifiers,
 * dollar-quoted bodies, top-level `;`, and psql-style variables `:'name'` (literal) and `:"name"` (identifier).
 * It is not a parser: the linter is a text-level early warning, and the database (ownership, catalog tests) is the
 * boundary (§8.3 "Limits").
 *
 * Token boundaries follow PostgreSQL 18's scanner (src/backend/parser/scan.l), because PostgreSQL reads every byte of a
 * deployed file and the linter must see the statements PostgreSQL runs (PR66-SEC-01, PR #66 code review R1-m1/R1-n1;
 * TASK-293):
 *  - `comment ("--"{non_newline}*)` with `non_newline [^\n\r]`: a line comment ends at LF **or** CR;
 *  - `ident_cont [A-Za-z\200-\377_0-9\$]`: a `$` right after an identifier character (ASCII letter, digit, `_`, `$`, or
 *    any non-ASCII character) belongs to the identifier and opens no dollar quote (`é$a$` is one identifier);
 *  - `dolq_start [A-Za-z\200-\377_]`, `dolq_cont [A-Za-z\200-\377_0-9]`: a dollar tag may hold non-ASCII letters
 *    (`$é$ … $é$` is one string);
 *  - `space [ \t\n\r\f\v]`: white space is ASCII only (SQL_WHITESPACE); U+00A0, U+FEFF, U+3000 and every other
 *    non-ASCII character are identifier characters to PostgreSQL;
 *  - `quotecontinue`: a string continued after a newline keeps the state it closed in, so an E-string continued that
 *    way is refused (EscapeContinuationError, PR293-SEC-02); a plain string continued that way reads the same either
 *    way and is two string tokens here.
 * The scanner works on bytes and every byte of a multi-byte UTF-8 character is in `\200-\377`; this lexer works on
 * UTF-16 code units, where every code unit from 0x80 up (surrogates included) stands for such bytes.
 */

export type TokenKind = 'code' | 'comment' | 'string' | 'identifier' | 'dollar' | 'variable';

export interface Token {
  kind: TokenKind;
  /** The token text as written; an escape string (`E'…'`) includes its prefix. */
  text: string;
  /** String tokens: `true` for an E-prefixed escape string (`E'…'`, `e'…'`); the prefix is part of `text`. */
  escape?: true;
  /** Variable tokens: the variable name and quoting (`'` literal, `"` identifier). */
  variable?: { name: string; quote: "'" | '"' };
}

const IDENT_CHAR = /[A-Za-z0-9_$]/;
/**
 * An identifier character as PostgreSQL's scanner reads it (scan.l `ident_cont`): ASCII letters, digits, `_`, `$` and
 * every non-ASCII character (code unit 0x80 and above, as CODE_PIECE). Used for the E-prefix check (PR #43 R1-n2):
 * `éE'…'` is the identifier `éE` followed by a plain string, not an escape string; and for the dollar-quote opener
 * (PR66-SEC-01 b): `é$a$` is one identifier, not `é` followed by a dollar quote.
 */
const isIdentifierChar = (ch: string | undefined): boolean => ch !== undefined && (IDENT_CHAR.test(ch) || (ch.codePointAt(0) ?? 0) >= 0x80);
const VARIABLE = /^:(['"])([A-Za-z_][A-Za-z0-9_]*)\1/;
/** scan.l `dolqdelim \$({dolq_start}{dolq_cont}*)?\$`: the tag alphabet includes every non-ASCII character (PR66-SEC-01 c). */
const DOLLAR_TAG = /^\$([A-Za-z_\u0080-\uFFFF][A-Za-z0-9_\u0080-\uFFFF]*)?\$/;
/** scan.l `space [ \t\n\r\f\v]`: PostgreSQL's white space, ASCII only (PR #66 code review R1-n1). */
const SQL_WHITESPACE = /^[ \t\n\r\f\v]$/;

export class SqlLexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlLexError';
  }
}

/**
 * An E-string continued on a new line (PR293-SEC-02): refused, because PostgreSQL keeps its escapes live in the
 * continued part. Nested reads (containsEscapeString) count it as an escape string, never as prose that does not lex.
 */
export class EscapeContinuationError extends SqlLexError {
  constructor() {
    super('an E-string continued on a new line is refused (PR293-SEC-02)');
    this.name = 'EscapeContinuationError';
  }
}

/**
 * scan.l `quotecontinue {whitespace_with_newline}{quote}`: from `from` (right after a closing quote), white space and
 * `--` comments that hold at least one newline, then a quote. A linear scan, not a regular expression (an alternation of
 * white space and comments under `*` backtracks on a long run of `--` without a newline).
 */
function continuesString(sql: string, from: number): boolean {
  let newline = false;
  for (let k = from; k < sql.length;) {
    const c = sql[k];
    if (c === '-' && sql[k + 1] === '-') {
      while (k < sql.length && sql[k] !== '\n' && sql[k] !== '\r') k += 1;
    } else if (c === '\n' || c === '\r') {
      newline = true;
      k += 1;
    } else if (c === ' ' || c === '\t' || c === '\f' || c === '\v') {
      k += 1;
    } else {
      return newline && c === "'";
    }
  }
  return false;
}

/** Splits SQL text into tokens. Adjacent code characters are merged into one token. */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let code = '';
  const flush = () => {
    if (code !== '') tokens.push({ kind: 'code', text: code });
    code = '';
  };
  const push = (token: Token) => {
    flush();
    tokens.push(token);
  };
  let i = 0;
  while (i < sql.length) {
    const ch = sql[i] as string;
    const next = sql[i + 1];
    const rest = sql.slice(i);
    if (ch === '-' && next === '-') {
      // scan.l `comment ("--"{non_newline}*)`, `non_newline [^\n\r]`: a lone CR ends the comment too (PR66-SEC-01 a).
      let stop = i + 2;
      while (stop < sql.length && sql[stop] !== '\n' && sql[stop] !== '\r') stop += 1;
      push({ kind: 'comment', text: sql.slice(i, stop) });
      i = stop;
    } else if (ch === '/' && next === '*') {
      let depth = 0;
      let j = i;
      while (j < sql.length) {
        if (sql.startsWith('/*', j)) {
          depth += 1;
          j += 2;
        } else if (sql.startsWith('*/', j)) {
          depth -= 1;
          j += 2;
          if (depth === 0) break;
        } else {
          j += 1;
        }
      }
      if (depth !== 0) throw new SqlLexError('unterminated block comment');
      push({ kind: 'comment', text: sql.slice(i, j) });
      i = j;
    } else if (ch === ':' && next === ':') {
      code += '::';
      i += 2;
    } else if (ch === ':' && VARIABLE.test(rest)) {
      const match = VARIABLE.exec(rest) as RegExpExecArray;
      push({ kind: 'variable', text: match[0], variable: { name: match[2] as string, quote: match[1] as "'" | '"' } });
      i += match[0].length;
    } else if (ch === "'") {
      // Token level (PR11-SEC-16): the E prefix is a lone `e` directly before the quote, not the end of a longer word
      // (`name'…'`, `date'…'`) and never text inside another token (`'abcde'`, `'a e'`).
      const escaped = /[eE]$/.test(code) && !isIdentifierChar(code.at(-2));
      const prefix = escaped ? code.slice(-1) : '';
      if (escaped) code = code.slice(0, -1);
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new SqlLexError('unterminated string literal');
        if (escaped && sql[j] === '\\') {
          j += 2;
        } else if (sql[j] === "'" && sql[j + 1] === "'") {
          j += 2;
        } else if (sql[j] === "'") {
          j += 1;
          break;
        } else {
          j += 1;
        }
      }
      // scan.l {quotecontinue}: after a newline, a quote continues the string in the state it closed in, so the escapes
      // of an E-string stay live in the next part; this lexer would start a plain string there. Fail closed (PR293-SEC-02).
      if (escaped && continuesString(sql, j)) throw new EscapeContinuationError();
      push(escaped ? { kind: 'string', text: prefix + sql.slice(i, j), escape: true } : { kind: 'string', text: sql.slice(i, j) });
      i = j;
    } else if (ch === '"') {
      let j = i + 1;
      for (;;) {
        if (j >= sql.length) throw new SqlLexError('unterminated quoted identifier');
        if (sql[j] === '"' && sql[j + 1] === '"') j += 2;
        else if (sql[j] === '"') {
          j += 1;
          break;
        } else j += 1;
      }
      push({ kind: 'identifier', text: sql.slice(i, j) });
      i = j;
    } else if (ch === '$' && !isIdentifierChar(code.at(-1)) && DOLLAR_TAG.test(rest)) {
      // scan.l `ident_cont` holds `$` and every non-ASCII character: a `$` after an identifier character continues the
      // identifier (PR66-SEC-01 b). After a string, quoted identifier or comment token `code` is empty: a new token.
      const tag = (DOLLAR_TAG.exec(rest) as RegExpExecArray)[0];
      const close = sql.indexOf(tag, i + tag.length);
      if (close === -1) throw new SqlLexError(`unterminated dollar-quoted string ${tag}`);
      push({ kind: 'dollar', text: sql.slice(i, close + tag.length) });
      i = close + tag.length;
    } else {
      code += ch;
      i += 1;
    }
  }
  flush();
  return tokens;
}

/** SQL string literal for `value` (standard_conforming_strings). */
export function quoteLiteral(value: string): string {
  if (value.includes('\0')) throw new SqlLexError('a variable value must not contain NUL');
  return `'${value.replaceAll("'", "''")}'`;
}

/** SQL quoted identifier for `value`. */
export function quoteIdentifier(value: string): string {
  if (value.includes('\0') || value === '') throw new SqlLexError('an identifier must be non-empty and must not contain NUL');
  return `"${value.replaceAll('"', '""')}"`;
}

/**
 * Replaces psql-style `:'name'` and `:"name"` outside comments, strings and dollar-quoted bodies (where psql does not
 * interpolate either). Every referenced variable must be supplied.
 */
export function substituteVariables(sql: string, vars: Readonly<Record<string, string>>): string {
  return tokenize(sql)
    .map((token) => {
      if (token.kind !== 'variable' || token.variable === undefined) return token.text;
      const value = vars[token.variable.name];
      if (value === undefined) throw new SqlLexError(`variable ${token.variable.name} is not set`);
      return token.variable.quote === "'" ? quoteLiteral(value) : quoteIdentifier(value);
    })
    .join('');
}

/** Names of the variables a script references, sorted and unique. */
export function referencedVariables(sql: string): string[] {
  const names = tokenize(sql).flatMap((token) => (token.variable ? [token.variable.name] : []));
  return [...new Set(names)].sort();
}

/** The script with every comment removed (string literals, identifiers and bodies kept). */
export function stripComments(sql: string): string {
  return tokenize(sql)
    .map((token) => (token.kind === 'comment' ? (token.text.startsWith('--') ? '' : ' ') : token.text))
    .join('');
}

/** A word (identifier or keyword), a number-like run, or one other character of a code token. */
const CODE_PIECE = /[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*|[0-9][A-Za-z0-9_$.]*|[^]/g;
const ROUTINE_HEAD = /^create (?:or replace )?(?:function|procedure)\b/;

/** One piece of the token stream for splitStatements: a CODE_PIECE of a code token, or a whole other token. */
interface Piece {
  readonly kind: TokenKind;
  readonly text: string;
}

/** One open `BEGIN ATOMIC` block: the words of its current body statement, and whether that statement has begun. */
interface AtomicBlock {
  words: string[];
  started: boolean;
}

/**
 * Top-level statements, comments removed, trimmed, without the terminating `;`; empty statements dropped.
 *
 * Inside a `CREATE [OR REPLACE] FUNCTION | PROCEDURE` statement a SQL-standard body (`BEGIN ATOMIC … END`) holds `;`
 * that do not end the statement (SEC-TC-73). The block structure follows PostgreSQL's grammar (gram.y
 * `opt_routine_body: BEGIN_P ATOMIC routine_body_stmt_list END_P`, where every body statement ends in `;`, and
 * `routine_body_stmt: stmt | ReturnStmt` excludes `TransactionStmtLegacy`, so no body statement starts with `BEGIN` or
 * `END`), on unquoted words only (PR43-SEC-03, PR #43 R1-M1; PR43-SEC-11 structural fix, TASK-290):
 *  - OPEN: the two words `BEGIN ATOMIC` (comments and whitespace between them allowed), at parenthesis depth 0, in a
 *    statement that starts with the routine head: the top-level statement, or — inside an open block — the current
 *    body statement (a nested routine). `begin` / `atomic` anywhere else is a name or a label (`SELECT begin atomic
 *    FROM …`, a parameter `begin` of a type `atomic`) and opens nothing.
 *  - CLOSE: `END` as the FIRST word of a body statement (right after `ATOMIC` or after a body `;`). Every other `end`
 *    — the end of a `CASE` expression, a label (`AS end`, `t.end`, the bare label `SELECT 1 end`) — is part of its
 *    statement. `CASE` therefore never counts: neither a CASE expression nor a label `case` (`AS case`, `t.case`,
 *    `SELECT 1 case`) can move a block boundary, so no over-count exists that a later top-level `END` could
 *    resynchronise.
 *  - a `;` splits only outside a block; inside one it ends a body statement.
 * Fail closed (SqlLexError, reported by the linter as rule L; never one swallowed statement, never a crash): text that
 * ends inside an open block; a body `;` inside parentheses (PostgreSQL refuses it); anything but `;` (or the end of the
 * text, top level only) after the `END` that closes a block (PostgreSQL accepts nothing else there: `END WORK`,
 * `END LANGUAGE sql`, `END SELECT 1` are syntax errors).
 * A bare `BEGIN` never counts: a routine named `begin`, a parameter or a `RETURNS TABLE` column `begin`, or `RETURN
 * begin` opens nothing. This is narrower than psql's heuristic (psqlscan.l `begin_depth` also counts a bare `BEGIN` and
 * every `CASE`); the PostgreSQL 18 agreement is prisma/tests/migrations/split-statements.int.test.ts. Limit: it is a
 * splitter, not a parser. A utility statement (GRANT, DROP, SET, CREATE FUNCTION …) that a body holds by the grammar is
 * refused at CREATE time (0A000), so it never runs as a migration step; DML that a body holds runs whenever the routine
 * is called (PR66-SEC-02), which migration-linter rule 10 sees only at a top-level call of a routine created in the same
 * or an earlier migration file (tools/db/lint-migrations.ts, TASK-293).
 * White space is PostgreSQL's ASCII class (SQL_WHITESPACE). The lexer stays approximate in one place without effect: a
 * `$` right after a number or a parameter (`1$a$`, `$1$a$`) is code here and opens a dollar quote in PostgreSQL, but a
 * constant followed by a string constant is a syntax error there, so no such file runs.
 */
export function splitStatements(sql: string): string[] {
  const pieces: Piece[] = tokenize(sql).flatMap((token): Piece[] =>
    token.kind === 'code' ? (token.text.match(CODE_PIECE) ?? []).map((text) => ({ kind: 'code', text })) : [token],
  );
  /** The next piece after `at` that is not a comment or whitespace, lowercased; undefined when it is not code. */
  const nextWord = (at: number): string | undefined => {
    for (let k = at + 1; k < pieces.length; k += 1) {
      const piece = pieces[k] as Piece;
      if (piece.kind === 'comment' || (piece.kind === 'code' && SQL_WHITESPACE.test(piece.text))) continue;
      return piece.kind === 'code' ? piece.text.toLowerCase() : undefined;
    }
    return undefined;
  };
  const statements: string[] = [];
  let current = '';
  /** Words of the current top-level statement. */
  let words: string[] = [];
  let parens = 0;
  /** Open blocks, innermost last. */
  const blocks: AtomicBlock[] = [];
  /** The `atomic` of an opening `BEGIN ATOMIC` is next: it belongs to the opener, not to the first body statement. */
  let openerPending = false;
  /** A block has just closed: only `;` (or the end of the text) may follow. */
  let closed = false;
  const opens = (head: readonly string[], word: string, index: number): boolean =>
    word === 'begin' && parens === 0 && ROUTINE_HEAD.test(head.slice(0, 4).join(' ')) && nextWord(index) === 'atomic';
  pieces.forEach((piece, index) => {
    if (piece.kind === 'comment') {
      current += piece.text.startsWith('--') ? '' : ' ';
      return;
    }
    // PostgreSQL's white space only (R1-n1): a lone U+00A0, U+FEFF or U+3000 piece is an identifier to PostgreSQL, so
    // it starts a body statement, and an END after it closes nothing.
    if (piece.kind === 'code' && SQL_WHITESPACE.test(piece.text)) {
      current += piece.text;
      return;
    }
    if (closed && !(piece.kind === 'code' && piece.text === ';')) {
      throw new SqlLexError('unbalanced BEGIN ATOMIC block: the END of a routine body must end the routine statement');
    }
    closed = false;
    const block = blocks.at(-1);
    if (piece.kind !== 'code') {
      current += piece.text;
      if (block) block.started = true;
      return;
    }
    if (piece.text === ';') {
      if (!block) {
        statements.push(current);
        current = '';
        words = [];
        parens = 0;
        return;
      }
      if (parens !== 0) throw new SqlLexError('unbalanced parentheses in a BEGIN ATOMIC body statement');
      current += ';';
      block.words = [];
      block.started = false;
      return;
    }
    current += piece.text;
    if (piece.text === '(') parens += 1;
    else if (piece.text === ')') parens = Math.max(0, parens - 1);
    const word = /^[A-Za-z_]/.test(piece.text) ? piece.text.toLowerCase() : undefined;
    if (openerPending && word === 'atomic') {
      openerPending = false;
      return;
    }
    if (!block) {
      if (word === undefined) return;
      words.push(word);
      if (opens(words, word, index)) {
        blocks.push({ words: [], started: false });
        openerPending = true;
      }
      return;
    }
    const first = !block.started;
    block.started = true;
    if (word === undefined) return;
    if (word === 'end' && first) {
      blocks.pop();
      closed = true;
      return;
    }
    block.words.push(word);
    if (opens(block.words, word, index)) {
      blocks.push({ words: [], started: false });
      openerPending = true;
    }
  });
  if (blocks.length > 0) {
    throw new SqlLexError(`unbalanced BEGIN ATOMIC block: the text ends inside a routine body (${blocks.length} open)`);
  }
  statements.push(current);
  return statements.map((statement) => statement.trim()).filter((statement) => statement !== '');
}

/**
 * Text of a string literal (`''` -> `'`; an escape string's backslash escapes are left as written) or of a dollar
 * body (tags removed). Other tokens return their text.
 */
export function literalBody(token: Token): string {
  if (token.kind === 'dollar') {
    const tag = (/^\$[^$]*\$/.exec(token.text) as RegExpExecArray)[0];
    return token.text.slice(tag.length, token.text.length - tag.length);
  }
  if (token.kind !== 'string') return token.text;
  const quoted = token.escape === true ? token.text.slice(1) : token.text;
  return quoted.slice(1, -1).replaceAll("''", "'");
}

/** Nesting bound of dynamic SQL read by containsEscapeString (a literal inside a literal inside …). */
export const MAX_NESTED_SQL_DEPTH = 4;

/**
 * True when `sql` holds an E-prefixed escape string (`E'…'`, `e'…'`) as a TOKEN (PR11-SEC-16, D-ARCH-078): in code,
 * in a dollar-quoted body, or in a string literal read as dynamic SQL (`EXECUTE 'SELECT E''\x61pp…'''`), up to
 * MAX_NESTED_SQL_DEPTH levels. Never a regular expression over the text: `'abcde'`, `'a e'` and `name'…'` hold no
 * escape string. Nested text that does not lex (prose in a literal) holds no token and counts as clean, except a
 * continued E-string (EscapeContinuationError), which counts as an escape string (PR293-SEC-02); top-level text
 * that does not lex throws SqlLexError. At the depth cap a string or dollar token that is still present counts as an
 * escape string (fail closed, PR43-SEC-06 c / PR #43 R1-n1): it is not read, so it cannot be shown clean.
 */
export function containsEscapeString(sql: string, depth = 0): boolean {
  let tokens: Token[];
  try {
    tokens = tokenize(sql);
  } catch (error) {
    if (!(error instanceof SqlLexError) || depth === 0) throw error;
    return error instanceof EscapeContinuationError; // a continued E-string is one (fail closed); other prose is not
  }
  return tokens.some(
    (token) =>
      token.escape === true ||
      ((token.kind === 'string' || token.kind === 'dollar') &&
        (depth >= MAX_NESTED_SQL_DEPTH || containsEscapeString(literalBody(token), depth + 1))),
  );
}

/**
 * Sentinel that `sqlText(…, true)` writes before every string literal that is, or (as dynamic SQL) contains, an
 * E-prefixed escape string. The shared write-form list (tools/db/tenant-key-forms.ts) matches it, so migration-linter
 * rule 16 and the C-series `prosrc` scan refuse escape strings token-level from the same text (PR11-SEC-16). Lowercase
 * and free of whitespace (U+2063 INVISIBLE SEPARATOR is no `\s`), so `normalise` keeps it intact; a literal that
 * carries the character itself only causes a false positive (fail closed).
 */
export const ESCAPE_STRING_MARK = '⁣escape-string⁣';

/** Collapses whitespace and lowercases, for keyword matching. */
export function normalise(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim().toLowerCase();
}

/**
 * SQL text for the tenant-context form checks, shared by migration-linter rule 16 and the C-series `prosrc` scan
 * (prisma/tests/catalog/scans.ts) so the two cannot drift (PR #11 review R2-n1): comments become one space,
 * dollar-quoted bodies are expanded recursively (a body is SQL or PL/pgSQL), string literals are kept or blanked. A
 * nested body that does not lex is kept verbatim (still scanned, fail closed); a top-level lexing error is thrown.
 * With strings kept, a literal that is or contains an escape string is preceded by ESCAPE_STRING_MARK.
 */
export function sqlText(sql: string, keepStrings: boolean): string {
  return tokenize(sql)
    .map((token) => {
      if (token.kind === 'comment') return ' ';
      if (token.kind === 'string') {
        if (!keepStrings) return ' ';
        const escaped = token.escape === true || containsEscapeString(literalBody(token), 1);
        return escaped ? `${ESCAPE_STRING_MARK}${token.text}` : token.text;
      }
      if (token.kind !== 'dollar') return token.text;
      const body = literalBody(token);
      try {
        return ` ${sqlText(body, keepStrings)} `;
      } catch (error) {
        // A body holding a continued E-string (PR293-SEC-02) does not lex, but it IS an escape string: keep the mark, so
        // rule 16 and the C-series scan still refuse it (TASK-293 code review R3-M1). Strings blanked: no mark exists.
        return keepStrings && error instanceof EscapeContinuationError ? ` ${ESCAPE_STRING_MARK}${body} ` : ` ${body} `;
      }
    })
    .join('');
}
