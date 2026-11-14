/**
 * A small PostgreSQL lexer for the bootstrap runner and the migration linter (data-model.md §8.1, §8.3). It knows
 * exactly what both need: comments (`--`, nested `/* *\/`), string literals (`'…'`, `E'…'`), quoted identifiers,
 * dollar-quoted bodies, top-level `;`, and psql-style variables `:'name'` (literal) and `:"name"` (identifier).
 * It is not a parser: the linter is a text-level early warning, and the database (ownership, catalog tests) is the
 * boundary (§8.3 "Limits").
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
const VARIABLE = /^:(['"])([A-Za-z_][A-Za-z0-9_]*)\1/;
const DOLLAR_TAG = /^\$([A-Za-z_][A-Za-z0-9_]*)?\$/;

export class SqlLexError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SqlLexError';
  }
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
      const end = sql.indexOf('\n', i);
      const stop = end === -1 ? sql.length : end;
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
      const escaped = /[eE]$/.test(code) && !IDENT_CHAR.test(code.at(-2) ?? ' ');
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
    } else if (ch === '$' && !IDENT_CHAR.test(code.at(-1) ?? ' ') && DOLLAR_TAG.test(rest)) {
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

/**
 * Top-level statements, comments removed, trimmed, without the terminating `;`; empty statements dropped.
 *
 * Inside a `CREATE [OR REPLACE] FUNCTION | PROCEDURE` statement a SQL-standard body (`BEGIN ATOMIC … END`) holds `;`
 * that do not end the statement. As psql does (psqlscan.l `begin_depth`), a `BEGIN` or `CASE` word that is not the
 * statement's first word opens a block and `END` closes one; a `;` splits only outside every block. The tracking is
 * limited to routine definitions, so a stray word elsewhere can never swallow the rest of a file (SEC-TC-73).
 */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  let words: string[] = [];
  let depth = 0;
  for (const token of tokenize(sql)) {
    if (token.kind === 'comment') {
      current += token.text.startsWith('--') ? '' : ' ';
      continue;
    }
    if (token.kind !== 'code') {
      current += token.text;
      continue;
    }
    for (const piece of token.text.match(CODE_PIECE) ?? []) {
      if (piece === ';' && depth === 0) {
        statements.push(current);
        current = '';
        words = [];
        continue;
      }
      current += piece;
      if (!/^[A-Za-z_]/.test(piece)) continue;
      const word = piece.toLowerCase();
      words.push(word);
      if (!ROUTINE_HEAD.test(words.slice(0, 4).join(' '))) continue;
      if ((word === 'begin' || word === 'case') && words.length > 1) depth += 1;
      else if (word === 'end' && depth > 0) depth -= 1;
    }
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
 * escape string. Nested text that does not lex (prose in a literal) holds no token and counts as clean; top-level text
 * that does not lex throws SqlLexError.
 */
export function containsEscapeString(sql: string, depth = 0): boolean {
  let tokens: Token[];
  try {
    tokens = tokenize(sql);
  } catch (error) {
    if (!(error instanceof SqlLexError) || depth === 0) throw error;
    return false;
  }
  return tokens.some(
    (token) =>
      token.escape === true ||
      (depth < MAX_NESTED_SQL_DEPTH &&
        (token.kind === 'string' || token.kind === 'dollar') &&
        containsEscapeString(literalBody(token), depth + 1)),
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
      } catch {
        return ` ${body} `;
      }
    })
    .join('');
}
