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
  text: string;
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
      const escaped = /[eE]$/.test(code) && !IDENT_CHAR.test(code.at(-2) ?? ' ');
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
      push({ kind: 'string', text: sql.slice(i, j) });
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

/** Top-level statements, comments removed, trimmed, without the terminating `;`; empty statements dropped. */
export function splitStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = '';
  for (const token of tokenize(sql)) {
    if (token.kind === 'comment') {
      current += token.text.startsWith('--') ? '' : ' ';
      continue;
    }
    if (token.kind !== 'code') {
      current += token.text;
      continue;
    }
    const parts = token.text.split(';');
    parts.forEach((part, index) => {
      current += part;
      if (index < parts.length - 1) {
        statements.push(current);
        current = '';
      }
    });
  }
  statements.push(current);
  return statements.map((statement) => statement.trim()).filter((statement) => statement !== '');
}

/** Collapses whitespace and lowercases, for keyword matching. */
export function normalise(statement: string): string {
  return statement.replace(/\s+/g, ' ').trim().toLowerCase();
}
