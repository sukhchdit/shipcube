/**
 * Token-boundary shapes for `tokenize` / `splitStatements` (tools/db/sql-text.ts) where the lexer used to read the
 * text differently from PostgreSQL's scanner (PR66-SEC-01 a-c, PR #66 code review R1-m1; TASK-293). One table, two
 * consumers: tools/db/sql-text.test.ts pins the split, and prisma/tests/migrations/split-statements.int.test.ts proves
 * on PostgreSQL 18 that the whole text and its split pieces have the same effect, piece by piece, with the hostile tail
 * of tools/db/atomic-body-cases.ts at top level. Every text uses the same tail, so the PostgreSQL run reuses its setup.
 *
 * `before` is what the PR #66 lexer returned: each row is a statement the linter did not see (a, b) or saw although
 * PostgreSQL never runs it (c).
 */
import { HOSTILE_TAIL, HOSTILE_TAIL_STATEMENTS } from './atomic-body-cases.js';

export interface LexerCase {
  /** Short description (test title). */
  readonly shape: string;
  /** The file text. */
  readonly text: string;
  /** `splitStatements(text)`, as PostgreSQL reads the text. */
  readonly pieces: readonly string[];
  /** `splitStatements(text)` before TASK-293 (an error message when it threw). */
  readonly before: readonly string[] | string;
}

const [GRANT, DROP, SET] = HOSTILE_TAIL_STATEMENTS as [string, string, string, string];
const ROUTINE = 'CREATE FUNCTION public.split_cr_body() RETURNS integer LANGUAGE sql BEGIN ATOMIC SELECT 1;';

/** A `$tag$` right after a non-ASCII identifier character (b): one identifier per statement in PostgreSQL. */
const identifierDollar = (shape: string, lead: string): LexerCase => ({
  shape,
  text: `SELECT 1 AS ${lead}$q$; ${HOSTILE_TAIL}; SELECT 2 AS ${lead}$q$;\n`,
  pieces: [`SELECT 1 AS ${lead}$q$`, ...HOSTILE_TAIL_STATEMENTS, `SELECT 2 AS ${lead}$q$`],
  before: [`SELECT 1 AS ${lead}$q$; ${HOSTILE_TAIL}; SELECT 2 AS ${lead}$q$`],
});

export const LEXER_CASES: readonly LexerCase[] = [
  {
    shape: '(a) a lone CR ends a -- comment before a GRANT',
    text: `SELECT 1; -- note\r${HOSTILE_TAIL};\n`,
    pieces: ['SELECT 1', ...HOSTILE_TAIL_STATEMENTS],
    before: ['SELECT 1'],
  },
  {
    shape: '(a) a lone CR ends a -- comment before SET lock_timeout',
    text: `SELECT 1; ${GRANT}; ${DROP}; -- note\r${SET}; END;\n`,
    pieces: ['SELECT 1', ...HOSTILE_TAIL_STATEMENTS],
    before: ['SELECT 1', GRANT, DROP],
  },
  {
    shape: '(a) a lone CR ends a -- comment before the END of a routine body',
    text: `${ROUTINE} --\rEND; ${HOSTILE_TAIL};\n`,
    pieces: [`${ROUTINE} \rEND`, ...HOSTILE_TAIL_STATEMENTS],
    before: 'unbalanced BEGIN ATOMIC block: the text ends inside a routine body (1 open)',
  },
  identifierDollar('(b) $q$ after é is part of the identifier', 'é'),
  identifierDollar('(b) $q$ after U+00A0 is part of the identifier', '\u00a0'),
  identifierDollar('(b) $q$ after U+FEFF is part of the identifier', '\ufeff'),
  identifierDollar('(b) $q$ after U+3000 is part of the identifier', '\u3000'),
  {
    shape: '(c) a non-ASCII dollar tag $é$ quotes a fake RESET ROLE',
    text: `SELECT $é$; RESET ROLE; $é$; ${HOSTILE_TAIL};\n`,
    pieces: ['SELECT $é$; RESET ROLE; $é$', ...HOSTILE_TAIL_STATEMENTS],
    before: ['SELECT $é$', 'RESET ROLE', '$é$', ...HOSTILE_TAIL_STATEMENTS],
  },
];
