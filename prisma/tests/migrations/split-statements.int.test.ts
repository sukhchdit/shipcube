/**
 * `splitStatements` (tools/db/sql-text.ts) against PostgreSQL 18's own grammar for SQL-standard routine bodies
 * (`BEGIN ATOMIC … END`; PR43-SEC-11, PR #43 code review R2-m1/R2-n1; data-model.md §8.3 rule L; TASK-290).
 *
 * The migration linter lints the statements `splitStatements` returns, and `migrate deploy` runs a file's statements one
 * at a time (§8.3 rule 5). So the split must be PostgreSQL's: a piece that holds two commands hides the second from every
 * linter rule, and a piece that is a fragment over-splits. For every case of tools/db/atomic-body-cases.ts (a routine
 * whose body uses `case` / `end` / `begin atomic` as labels or names, followed by a hostile tail that ends in a top-level
 * `END`), one fresh database each:
 *  1. the WHOLE text, sent as one simple-protocol query, runs (or CREATE refuses the routine with the case's SQLSTATE),
 *     and the hostile tail takes effect at top level — so a splitter that swallowed it would hide real migration steps;
 *  2. EVERY piece of the split, sent through the extended protocol (a named prepared statement), runs alone with the
 *     same outcome: the extended protocol refuses two commands in one piece (42601 "cannot insert multiple commands into
 *     a prepared statement") and a fragment is a syntax error, so a passing piece is exactly one PostgreSQL command.
 * A control proves both refusals of step 2 on this server.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import type pg from 'pg';

import {
  ATOMIC_BODY_CASES,
  ATOMIC_CASE_SEARCH_PATH,
  ATOMIC_CASE_SETUP,
  HOSTILE_TAIL_STATEMENTS,
  caseText,
  type AtomicBodyCase,
} from '../../../tools/db/atomic-body-cases.js';
import { splitStatements } from '../../../tools/db/sql-text.js';
import { PlatformPostgres } from '../harness/postgres.js';

const TEMPLATE = 'split_template';

let pgh: PlatformPostgres | undefined;
let sequence = 0;

const cluster = (): PlatformPostgres => {
  if (pgh === undefined) throw new Error('PostgreSQL container not started');
  return pgh;
};

/** SQLSTATE and message of a failed query (pg errors are not `instanceof Error` under Jest VM modules). */
async function outcome(run: () => Promise<unknown>): Promise<{ code: string; message: string }> {
  try {
    await run();
  } catch (error) {
    const e = error as { code?: unknown; message?: unknown };
    return { code: typeof e.code === 'string' ? e.code : 'no code', message: typeof e.message === 'string' ? e.message : '' };
  }
  return { code: 'ok', message: '' };
}

/** A fresh clone of the template (the split targets, the grantee's table and the `atomic` type), as the superuser. */
async function freshSession(): Promise<pg.Client> {
  sequence += 1;
  const name = `split_case_${String(sequence)}`;
  await cluster().createDatabase(name, TEMPLATE);
  const client = await cluster().superuser(name);
  await client.query(`SET search_path = ${ATOMIC_CASE_SEARCH_PATH}`);
  return client;
}

/** The tail's effects at top level: the privilege granted, the table dropped, the session setting raised. */
async function tailEffects(client: pg.Client): Promise<{ granted: boolean; victim: string | null; lockTimeout: string }> {
  const { rows } = await client.query<{ granted: boolean; victim: string | null; lock_timeout: string }>(
    `SELECT pg_catalog.has_table_privilege('split_grantee', 'public.split_target', 'TRUNCATE') AS granted,
            pg_catalog.to_regclass('public.split_victim')::text AS victim,
            pg_catalog.current_setting('lock_timeout') AS lock_timeout`,
  );
  const row = rows[0];
  if (row === undefined) throw new Error('no effects row');
  return { granted: row.granted, victim: row.victim, lockTimeout: row.lock_timeout };
}

const TAIL_TOOK_EFFECT = { granted: true, victim: null, lockTimeout: '10s' };

beforeAll(async () => {
  pgh = await PlatformPostgres.start();
  await cluster().createDatabase(TEMPLATE);
  const admin = await cluster().superuser(TEMPLATE);
  try {
    for (const statement of ATOMIC_CASE_SETUP) await admin.query(statement);
  } finally {
    await admin.end();
  }
}, 180_000);

afterAll(async () => {
  await pgh?.stop();
});

describe('[PR43-SEC-11] splitStatements agrees with PostgreSQL 18 on BEGIN ATOMIC bodies (one piece = one command)', () => {
  it('control: the extended protocol refuses two commands in one piece (42601) and a fragment of a routine (42601), so a passing piece is exactly one command', async () => {
    const client = await freshSession();
    try {
      const [routine, first] = splitStatements(caseText(ATOMIC_BODY_CASES[0] as AtomicBodyCase));
      const twoCommands = await outcome(() => client.query({ name: 'control_two', text: `${String(routine)}; ${String(first)}` }));
      expect(twoCommands.code).toBe('42601');
      expect(twoCommands.message).toMatch(/cannot insert multiple commands into a prepared statement/);
      const fragment = await outcome(() => client.query({ name: 'control_fragment', text: String(routine).replace(/ END$/, '') }));
      expect(fragment.code).toBe('42601');
      // The same routine alone is one command (positive control of the control).
      expect(await outcome(() => client.query({ name: 'control_one', text: String(routine) }))).toEqual({ code: 'ok', message: '' });
    } finally {
      await client.end();
    }
  });

  it.each(ATOMIC_BODY_CASES.map((entry) => [entry.shape, entry] as const))(
    '%s: the whole file and its split pieces have the same outcome, piece by piece, and the hostile tail runs at top level',
    async (_shape, entry) => {
      const text = caseText(entry);
      const pieces = splitStatements(text);
      expect(pieces).toEqual([entry.routine, ...HOSTILE_TAIL_STATEMENTS]);

      // 1. The whole text as PostgreSQL receives a migration file in one simple query.
      const whole = await freshSession();
      try {
        const result = await outcome(() => whole.query(text));
        if (entry.refusedWith === undefined) {
          expect(result).toEqual({ code: 'ok', message: '' });
          expect(await tailEffects(whole)).toEqual(TAIL_TOOK_EFFECT);
        } else {
          // CREATE refuses the routine: the utility statement is INSIDE the body by the grammar, as the split says.
          expect(result.code).toBe(entry.refusedWith);
          expect(result.message).toMatch(/is not yet supported in unquoted SQL function body/);
        }
      } finally {
        await whole.end();
      }

      // 2. Every piece alone, through the extended protocol.
      const split = await freshSession();
      try {
        const outcomes: string[] = [];
        for (const [index, piece] of pieces.entries()) {
          outcomes.push((await outcome(() => split.query({ name: `piece_${String(index)}`, text: piece }))).code);
        }
        expect(outcomes).toEqual([entry.refusedWith ?? 'ok', ...HOSTILE_TAIL_STATEMENTS.map(() => 'ok')]);
        expect(await tailEffects(split)).toEqual(TAIL_TOOK_EFFECT);
      } finally {
        await split.end();
      }
    },
    120_000,
  );
});
