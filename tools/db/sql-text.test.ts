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
import { ATOMIC_BODY_CASES, HOSTILE_TAIL, HOSTILE_TAIL_STATEMENTS, caseText } from './atomic-body-cases.js';

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

  /** Statements every hostile head below must leave split: one each, never swallowed by the routine. */
  const TAIL = 'GRANT TRUNCATE ON public.t TO platform_app; CREATE SCHEMA evil; BEGIN; COMMIT';
  const TAIL_STATEMENTS = ['GRANT TRUNCATE ON public.t TO platform_app', 'CREATE SCHEMA evil', 'BEGIN', 'COMMIT'];

  it.each([
    ['a parameter named begin', 'CREATE FUNCTION public.f(begin integer) RETURNS integer LANGUAGE sql RETURN begin'],
    [
      'a RETURNS TABLE column named begin',
      'CREATE FUNCTION public.f() RETURNS TABLE (begin timestamptz) LANGUAGE sql AS $$ SELECT now() $$',
    ],
    ['a function named begin', "CREATE FUNCTION public.begin() RETURNS integer LANGUAGE sql AS 'SELECT 1'"],
    ['a function named begin (OR REPLACE)', "CREATE OR REPLACE FUNCTION public.begin() RETURNS integer LANGUAGE sql AS 'SELECT 1'"],
    ['a procedure parameter named begin', 'CREATE PROCEDURE public.p(begin integer) LANGUAGE sql AS $$ SELECT 1 $$'],
    [
      'RETURN CASE … END at depth 0',
      "CREATE FUNCTION public.f(v int) RETURNS text LANGUAGE sql RETURN CASE WHEN v > 0 THEN 'a' ELSE 'b' END",
    ],
    ['a bare CASE after the head', 'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql AS $$ SELECT 1 $$ CASE'],
  ])('[PR43-SEC-03] splitStatements: %s opens no block; the statements after it stay split', (_shape, head) => {
    expect(splitStatements(`${head}; ${TAIL};`)).toEqual([head, ...TAIL_STATEMENTS]);
  });

  it('[PR43-SEC-03] splitStatements: a later END; does not resync a block that never opened (the GRANT is not hidden)', () => {
    const head = 'CREATE FUNCTION public.f(begin integer) RETURNS int LANGUAGE sql AS $$ SELECT 1 $$';
    expect(splitStatements(`${head}; GRANT TRUNCATE ON public.t TO platform_app; END; CREATE SCHEMA s`)).toEqual([
      head,
      'GRANT TRUNCATE ON public.t TO platform_app',
      'END',
      'CREATE SCHEMA s',
    ]);
  });

  it('[PR43-SEC-03] splitStatements: BEGIN ATOMIC (comments between the words allowed) with CASE … END and a parenthesised CASE stays one statement (positive control)', () => {
    const atomic = [
      'CREATE FUNCTION public.f(v int) RETURNS text LANGUAGE sql',
      'BEGIN /* body */ -- of f',
      'ATOMIC',
      "  SELECT CASE WHEN v > 0 THEN 'a' ELSE 'b' END;",
      "  SELECT (CASE WHEN v > 1 THEN 'c' END);",
      'END',
    ].join('\n');
    const statements = splitStatements(`${atomic}; ${TAIL};`);
    expect(statements).toHaveLength(1 + TAIL_STATEMENTS.length);
    expect(statements.slice(1)).toEqual(TAIL_STATEMENTS);
    expect(statements[0]).toMatch(/^CREATE FUNCTION public\.f\(v int\)[^]*SELECT \(CASE WHEN v > 1 THEN 'c' END\);\nEND$/);
  });

  it('[PR43-SEC-03] splitStatements fails closed: text that ends inside a BEGIN ATOMIC block throws SqlLexError', () => {
    const open = 'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; CREATE SCHEMA evil;';
    expect(() => splitStatements(open)).toThrow(SqlLexError);
    expect(() => splitStatements(open)).toThrow(/unbalanced BEGIN ATOMIC block/);
    expect(() => splitStatements(`${open.replace('SELECT 1;', 'SELECT CASE WHEN true THEN 1 END;')} END`)).not.toThrow();
  });

  it.each(ATOMIC_BODY_CASES.map((entry) => [entry.shape, entry] as const))(
    '[PR43-SEC-11] splitStatements: %s — the routine is one statement, and every hostile statement after it stays split (a later top-level END resynchronises nothing)',
    (_shape, entry) => {
      expect(splitStatements(caseText(entry))).toEqual([entry.routine, ...HOSTILE_TAIL_STATEMENTS]);
    },
  );

  it('[PR43-SEC-11] splitStatements: the case table covers the four PR43-SEC-11 label shapes, the R2-n1 parenthesised labels and the paren gate', () => {
    const routines = ATOMIC_BODY_CASES.map((entry) => entry.routine).join('\n');
    for (const shape of [
      'SELECT 1 AS case;',
      'SELECT t.case FROM',
      'SELECT 1 case;',
      'SELECT begin atomic FROM',
      'xmlattributes(1 AS case)',
      'abs(t.end)',
      '(begin atomic)',
    ]) {
      expect(routines).toContain(shape);
    }
    expect(HOSTILE_TAIL_STATEMENTS).toEqual([
      expect.stringMatching(/^GRANT TRUNCATE /),
      expect.stringMatching(/^DROP TABLE /),
      expect.stringMatching(/^SET lock_timeout /),
      'END',
    ]);
  });

  it('[PR43-SEC-11] splitStatements: a nested BEGIN ATOMIC opens a block only in a body statement that starts with the routine head', () => {
    const nested =
      'CREATE OR REPLACE PROCEDURE public.p() LANGUAGE sql BEGIN ATOMIC CREATE OR REPLACE FUNCTION public.g() RETURNS int LANGUAGE sql BEGIN /* c */ ATOMIC SELECT 1; END; SELECT 2; END';
    expect(splitStatements(`${nested}; ${HOSTILE_TAIL}`)).toEqual([nested.replace('/* c */', ' '), ...HOSTILE_TAIL_STATEMENTS]);
    // The same words in a body statement that is not a routine definition open nothing (the alias shape, in parentheses).
    const alias =
      'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT (SELECT begin atomic FROM (VALUES (1)) v(begin)); END';
    expect(splitStatements(`${alias}; ${HOSTILE_TAIL}`)).toEqual([alias, ...HOSTILE_TAIL_STATEMENTS]);
  });

  it.each([
    [
      'END WORK closing a body (PostgreSQL: syntax error at WORK)',
      'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END WORK; GRANT ALL ON public.t TO platform_app; END;',
      /must end the routine statement/,
    ],
    [
      'a routine option after the END',
      'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END LANGUAGE sql; DROP TABLE public.t;',
      /must end the routine statement/,
    ],
    [
      'a statement after the END without a semicolon',
      "CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END SET lock_timeout = '10s';",
      /must end the routine statement/,
    ],
    [
      'a string after the END',
      "CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END 'x';",
      /must end the routine statement/,
    ],
    [
      'a nested routine END not followed by a semicolon',
      'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC CREATE FUNCTION public.g() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END SELECT 2; END;',
      /must end the routine statement/,
    ],
    [
      'a body semicolon inside parentheses',
      'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT (1; END; GRANT ALL ON public.t TO platform_app; SELECT 1); END;',
      /unbalanced parentheses in a BEGIN ATOMIC body statement/,
    ],
    [
      'the text ending inside a nested block',
      'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC CREATE FUNCTION public.g() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1;',
      /ends inside a routine body \(2 open\)/,
    ],
    [
      'the text ending after a nested END',
      'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC CREATE FUNCTION public.g() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END;',
      /ends inside a routine body \(1 open\)/,
    ],
  ])('[PR43-SEC-11] splitStatements fails closed (rule L): %s', (_shape, sql, message) => {
    expect(() => splitStatements(sql)).toThrow(SqlLexError);
    expect(() => splitStatements(sql)).toThrow(message);
  });

  it('[PR43-SEC-11] splitStatements: the END that closes a top-level block may end the text, and comments may sit before its semicolon', () => {
    const routine = 'CREATE FUNCTION public.f() RETURNS int LANGUAGE sql BEGIN ATOMIC SELECT 1; END';
    expect(splitStatements(routine)).toEqual([routine]);
    expect(splitStatements(`${routine} -- done\n /* x */ ; SELECT 2`)).toEqual([routine, 'SELECT 2']);
  });

  it('[PR43-SEC-06 c] containsEscapeString fails closed beyond MAX_NESTED_SQL_DEPTH: a string still present at the cap counts', () => {
    const nest = (sql: string, levels: number): string => (levels === 0 ? sql : nest(`SELECT '${sql.replaceAll("'", "''")}'`, levels - 1));
    for (const levels of [1, 4, 5, 6]) expect(containsEscapeString(nest(String.raw`SELECT E'\x61'`, levels))).toBe(true);
    // Below the cap plain nesting stays clean.
    expect(containsEscapeString(nest("SELECT 'x'", 3))).toBe(false);
  });

  it('[PR #43 R1-n2] a non-ASCII identifier character before E makes it part of the identifier, not an escape-string prefix', () => {
    const sql = String.raw`SELECT éE'\'; SELECT 2; --'`;
    expect(tokenize(sql).some((token) => token.escape === true)).toBe(false);
    expect(splitStatements(sql)).toEqual([String.raw`SELECT éE'\'`, 'SELECT 2']);
    // The ASCII control still marks a lone E.
    expect(tokenize(String.raw`SELECT E'\''`).some((token) => token.escape === true)).toBe(true);
  });

  it('fails on unterminated comments, strings, identifiers and dollar quotes', () => {
    expect(() => tokenize('/* open')).toThrow(/unterminated block comment/);
    expect(() => tokenize("SELECT 'open")).toThrow(/unterminated string literal/);
    expect(() => tokenize('SELECT "open')).toThrow(/unterminated quoted identifier/);
    expect(() => tokenize('SELECT $x$ open')).toThrow(/unterminated dollar-quoted string/);
  });
});
