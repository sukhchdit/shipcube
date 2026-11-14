import { describe, expect, it } from '@jest/globals';

import {
  ESCAPE_STRING_MARK,
  SqlLexError,
  containsEscapeString,
  literalBody,
  normalise,
  quoteIdentifier,
  quoteLiteral,
  referencedVariables,
  splitStatements,
  sqlText,
  stripComments,
  substituteVariables,
  tokenize,
} from './sql-text.js';

describe('SQL text helpers (bootstrap runner, migration linter)', () => {
  it('substitutes psql-style variables as a literal or an identifier, and only outside quotes, comments and bodies', () => {
    const sql = [
      "ALTER ROLE r PASSWORD :'pw';",
      'REVOKE ALL ON DATABASE :"db" FROM PUBLIC;',
      "-- comment :'pw'",
      "SELECT ':''pw''', $$ :'pw' $$, \"a:'pw'\", 1::int;",
    ].join('\n');
    expect(substituteVariables(sql, { pw: "it's", db: 'my"db' })).toBe(
      [
        "ALTER ROLE r PASSWORD 'it''s';",
        'REVOKE ALL ON DATABASE "my""db" FROM PUBLIC;',
        "-- comment :'pw'",
        "SELECT ':''pw''', $$ :'pw' $$, \"a:'pw'\", 1::int;",
      ].join('\n'),
    );
    expect(referencedVariables(sql)).toEqual(['db', 'pw']);
  });

  it('refuses a missing variable, NUL bytes and empty identifiers', () => {
    expect(() => substituteVariables("SELECT :'missing'", {})).toThrow(/variable missing is not set/);
    expect(() => quoteLiteral('a\0b')).toThrow(SqlLexError);
    expect(() => quoteIdentifier('')).toThrow(SqlLexError);
  });

  it('splits top-level statements, keeping semicolons inside strings, identifiers, dollar bodies and comments', () => {
    const sql = [
      '/* outer /* nested; */ still comment; */',
      "SELECT 'a;b', E'x\\';y', \"c;d\";",
      'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $body$ BEGIN RETURN 1; END $body$;',
      '-- trailing; comment',
      'SELECT $1',
    ].join('\n');
    expect(splitStatements(sql)).toEqual([
      "SELECT 'a;b', E'x\\';y', \"c;d\"",
      'CREATE FUNCTION f() RETURNS int LANGUAGE plpgsql AS $body$ BEGIN RETURN 1; END $body$',
      'SELECT $1',
    ]);
  });

  it('strips comments and normalises whitespace', () => {
    expect(stripComments('SELECT 1; -- one\n/* two */SELECT 2;')).toBe('SELECT 1; \n SELECT 2;');
    expect(normalise('  CREATE\n\tTABLE   X ')).toBe('create table x');
  });

  it('[PR11-SEC-16] marks E-prefixed escape strings token-level, prefix included; a word ending in e before a quote and an e inside a string are no prefix', () => {
    expect(tokenize(String.raw`SELECT E'a\'b', e'x'`).filter((token) => token.kind === 'string')).toEqual([
      { kind: 'string', text: String.raw`E'a\'b'`, escape: true },
      { kind: 'string', text: "e'x'", escape: true },
    ]);
    for (const sql of ["SELECT 'abcde'", "SELECT 'a e'", "SELECT date'2026-11-14'", "SELECT name'x'", "SELECT 1e'x'"]) {
      expect(tokenize(sql).some((token) => token.escape === true)).toBe(false);
    }
    // The text round-trips unchanged.
    const sql = String.raw`SELECT E'\\', 'abcde'`;
    expect(
      tokenize(sql)
        .map((token) => token.text)
        .join(''),
    ).toBe(sql);
  });

  it('[PR11-SEC-16] containsEscapeString reads code, dollar bodies and literals as dynamic SQL; sqlText marks them with ESCAPE_STRING_MARK', () => {
    expect(containsEscapeString(String.raw`SELECT E'\x61'`)).toBe(true);
    expect(containsEscapeString(String.raw`DO $$ BEGIN EXECUTE E'\x61'; END $$`)).toBe(true);
    expect(containsEscapeString("DO $$ BEGIN EXECUTE 'SELECT E''x'''; END $$")).toBe(true);
    expect(containsEscapeString("SELECT 'abcde', 'a e', 'it''s', date'2026-11-14'")).toBe(false);
    expect(() => containsEscapeString("SELECT 'open")).toThrow(SqlLexError);
    expect(sqlText("SELECT e'x', 'y'", true)).toBe(`SELECT ${ESCAPE_STRING_MARK}e'x', 'y'`);
    expect(sqlText("DO $$ BEGIN EXECUTE 'SELECT E''x'''; END $$", true)).toContain(`${ESCAPE_STRING_MARK}'SELECT E''x'''`);
    expect(sqlText("SELECT e'x'", false)).not.toContain(ESCAPE_STRING_MARK);
    expect(normalise(ESCAPE_STRING_MARK)).toBe(ESCAPE_STRING_MARK);
    expect(literalBody({ kind: 'string', text: "E'a''b'", escape: true })).toBe("a'b");
  });

  it('[SEC-TC-73] keeps a BEGIN ATOMIC body (with CASE … END) in one statement; a top-level BEGIN and CASE elsewhere split as before', () => {
    const atomic = 'CREATE OR REPLACE FUNCTION f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT CASE WHEN true THEN 1 END; SELECT 2; END';
    expect(splitStatements(`BEGIN; ${atomic}; SELECT CASE WHEN true THEN 1 END; COMMIT;`)).toEqual([
      'BEGIN',
      atomic,
      'SELECT CASE WHEN true THEN 1 END',
      'COMMIT',
    ]);
    // Outside a routine definition a stray BEGIN word never swallows the rest of the file.
    expect(splitStatements('SELECT begin FROM t; SELECT 2;')).toEqual(['SELECT begin FROM t', 'SELECT 2']);
  });

  it('fails on unterminated comments, strings, identifiers and dollar quotes', () => {
    expect(() => tokenize('/* open')).toThrow(/unterminated block comment/);
    expect(() => tokenize("SELECT 'open")).toThrow(/unterminated string literal/);
    expect(() => tokenize('SELECT "open')).toThrow(/unterminated quoted identifier/);
    expect(() => tokenize('SELECT $x$ open')).toThrow(/unterminated dollar-quoted string/);
  });
});
