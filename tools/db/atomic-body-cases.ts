/**
 * BEGIN ATOMIC shapes for `splitStatements` (tools/db/sql-text.ts; PR43-SEC-11, PR #43 code review R2-m1/R2-n1;
 * TASK-290). One table, two consumers: tools/db/sql-text.test.ts pins the split, and
 * prisma/tests/migrations/split-statements.int.test.ts proves on PostgreSQL 18 that every piece of that split is exactly
 * one command and that the hostile tail runs at top level (so a splitter that swallowed it would hide a real step).
 *
 * Every case is `<routine>; <HOSTILE_TAIL>;` and must split into `[routine, ...HOSTILE_TAIL_STATEMENTS]`. The tail ends
 * with a top-level `END` (a COMMIT synonym), the statement that used to resynchronise a swallowed block.
 */

/** Objects the PostgreSQL 18 run creates before each case (one fresh database per case). */
export const ATOMIC_CASE_SETUP: readonly string[] = [
  'CREATE TABLE public.split_target (id integer)',
  'CREATE TABLE public.split_victim (id integer)',
  'CREATE ROLE split_grantee NOLOGIN',
  // A type named `atomic`, so that a parameter `begin atomic` is valid SQL (the paren-gate cases).
  'CREATE DOMAIN public.atomic AS integer',
];

/** Session search path of the PostgreSQL 18 run: the unqualified type `atomic` must resolve. */
export const ATOMIC_CASE_SEARCH_PATH = 'public, pg_catalog';

/** Hostile statements after the routine: a privilege, a destructive step and a session setting, then a top-level END. */
export const HOSTILE_TAIL_STATEMENTS: readonly string[] = [
  'GRANT TRUNCATE ON public.split_target TO split_grantee',
  'DROP TABLE public.split_victim',
  "SET lock_timeout = '10s'",
  'END',
];

export const HOSTILE_TAIL = HOSTILE_TAIL_STATEMENTS.join('; ');

export interface AtomicBodyCase {
  /** Short description (test title). */
  readonly shape: string;
  /** The routine statement, exactly as `splitStatements` returns it. */
  readonly routine: string;
  /**
   * SQLSTATE PostgreSQL 18 raises for the routine itself, when the grammar accepts it but CREATE refuses it (a utility
   * statement inside a SQL function body: 0A000). Absent: the routine is created.
   */
  readonly refusedWith?: string;
}

const fn = (name: string, returns: string, body: string): string =>
  `CREATE FUNCTION public.${name}() RETURNS ${returns} LANGUAGE sql BEGIN ATOMIC ${body} END`;

/** PR43-SEC-11 / R2-m1: reserved words used as labels inside a body; none of them may move a block boundary. */
export const LABEL_CASES: readonly AtomicBodyCase[] = [
  { shape: 'a column label AS case', routine: fn('split_as_case', 'integer', 'SELECT 1 AS case;') },
  { shape: 'an attribute t.case', routine: fn('split_attr_case', 'integer', 'SELECT t.case FROM (VALUES (1)) AS t("case");') },
  { shape: 'a bare column label case', routine: fn('split_bare_case', 'integer', 'SELECT 1 case;') },
  {
    shape: 'a column begin with the bare label atomic',
    routine: fn('split_begin_atomic_alias', 'integer', 'SELECT begin atomic FROM (VALUES (1)) AS v(begin);'),
  },
  { shape: 'labels AS end and a bare end', routine: fn('split_end_labels', 'integer', 'SELECT 1 AS end; SELECT 2 end;') },
  {
    shape: 'a CASE expression labelled AS end',
    routine: fn('split_case_as_end', 'text', "SELECT CASE WHEN random() > 2 THEN 'a' ELSE 'b' END AS end;"),
  },
];

/** PR #43 R2-n1: the parenthesis-depth gate. */
export const PAREN_CASES: readonly AtomicBodyCase[] = [
  {
    shape: 'a parenthesised AS case',
    routine: fn('split_paren_as_case', 'xml', 'SELECT xmlelement(name x, xmlattributes(1 AS case));'),
  },
  { shape: 'a parenthesised t.end', routine: fn('split_paren_attr_end', 'integer', 'SELECT abs(t.end) FROM (VALUES (1)) AS t("end");') },
  {
    // The gate itself: `begin atomic` inside the parameter list is a parameter of type `atomic`, not an opener.
    shape: 'a parameter begin of type atomic (no body)',
    routine: 'CREATE FUNCTION public.split_param(begin atomic) RETURNS integer LANGUAGE sql RETURN 1',
  },
];

/** Structure: nested routines, an END label that the grammar puts in the body, and positive controls. */
export const STRUCTURE_CASES: readonly AtomicBodyCase[] = [
  {
    shape: 'a nested routine (the grammar nests it; CREATE refuses it)',
    routine: fn(
      'split_outer',
      'integer',
      'CREATE FUNCTION public.split_inner() RETURNS integer LANGUAGE sql BEGIN ATOMIC SELECT 1; END; SELECT 1;',
    ),
    refusedWith: '0A000',
  },
  {
    shape: 'a bare label end before a GRANT (the grammar keeps the GRANT in the body; CREATE refuses it)',
    routine: fn('split_end_label_grant', 'integer', 'SELECT 1 END; GRANT TRUNCATE ON public.split_target TO split_grantee;'),
    refusedWith: '0A000',
  },
  { shape: 'an empty body (control)', routine: 'CREATE FUNCTION public.split_empty() RETURNS void LANGUAGE sql BEGIN ATOMIC END' },
  {
    shape: 'a procedure with a CASE expression and two body statements (control)',
    routine:
      'CREATE PROCEDURE public.split_proc(v integer) LANGUAGE sql BEGIN ATOMIC INSERT INTO public.split_target VALUES (CASE WHEN v > 0 THEN v END); SELECT 1; END',
  },
];

export const ATOMIC_BODY_CASES: readonly AtomicBodyCase[] = [...LABEL_CASES, ...PAREN_CASES, ...STRUCTURE_CASES];

/** The file text of a case: the routine, the hostile tail, each terminated. */
export const caseText = (entry: AtomicBodyCase): string => `${entry.routine};\n${HOSTILE_TAIL};\n`;
