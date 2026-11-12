import { describe, expect, it } from '@jest/globals';

import {
  SqlLexError,
  normalise,
  quoteIdentifier,
  quoteLiteral,
  referencedVariables,
  splitStatements,
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

  it('fails on unterminated comments, strings, identifiers and dollar quotes', () => {
    expect(() => tokenize('/* open')).toThrow(/unterminated block comment/);
    expect(() => tokenize("SELECT 'open")).toThrow(/unterminated string literal/);
    expect(() => tokenize('SELECT "open')).toThrow(/unterminated quoted identifier/);
    expect(() => tokenize('SELECT $x$ open')).toThrow(/unterminated dollar-quoted string/);
  });
});
