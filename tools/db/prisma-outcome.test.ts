/**
 * The outcome of `prisma migrate status | deploy` in the restore report (TASK-034 fix cycle 2, D-TASK034-14): both
 * streams are read, whichever one carries the banner or the status text, and the pending / failed migration names are
 * parsed into structured fields. Fix cycle 3 (PR034-SEC-03): the detail is an allow-list, so no row data reaches it.
 */
import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { allowedFacts, deployOutcome, listedMigrations, maskValues, statusOutcome } from './prisma-outcome.js';

const NAME = '29991231000000_rehearsal_probe';
const BANNER =
  'Loaded Prisma config from prisma\\tests\\fixtures\\rehearsal\\prisma.config.ts.\n\nPrisma schema loaded from prisma\\schema.\n';
const DATASOURCE = 'Datasource "db": PostgreSQL database "rehearsal_behind", schema "public" at "localhost:55432"\n\n';
/** Prisma 7.10 `migrate status`, one migration behind (databaseIsBehind). */
const BEHIND_TEXT = [
  '42 migrations found in prisma/migrations',
  'Following migration have not yet been applied:',
  NAME,
  '',
  'To apply migrations in development run prisma migrate dev.',
  'To apply migrations in production run prisma migrate deploy.',
  '',
].join('\n');

/** A P3018 report of `prisma migrate deploy` in the schema engine's template, with the server's lines. */
const p3018 = (sqlstate: string, server: readonly string[]): string =>
  [
    BANNER,
    'Error: P3018',
    '',
    'A migration failed to apply. New migrations cannot be applied before the error is recovered from.',
    '',
    `Migration name: ${NAME}`,
    '',
    `Database error code: ${sqlstate}`,
    '',
    'Database error:',
    ...server,
    '',
    `DbError { severity: "ERROR", code: SqlState(E${sqlstate}), message: "${server[0] ?? ''}", detail: Some("${server[1] ?? ''}") }`,
  ].join('\n');

describe('statusOutcome', () => {
  it('[TASK-034 R1-M1] names the pending migration when the status text is on stdout and the banner on stderr (lane B 20261121T0711Z)', () => {
    const outcome = statusOutcome({ status: 1, stdout: `${DATASOURCE}${BEHIND_TEXT}`, stderr: BANNER });
    expect(outcome.ok).toBe(false);
    expect(outcome.pending).toEqual([NAME]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.detail).toBe(`exit 1: pending ${NAME}`);
    expect(outcome.detail).not.toMatch(/Loaded Prisma config|Prisma schema loaded|localhost/);
  });

  it('[TASK-034 R1-M1] names the pending migration when everything, banner first, is on stderr', () => {
    const outcome = statusOutcome({ status: 1, stdout: '', stderr: `${BANNER}${DATASOURCE}${BEHIND_TEXT}` });
    expect(outcome).toEqual({ ok: false, pending: [NAME], failed: [], detail: `exit 1: pending ${NAME}` });
  });

  it('names the pending migration when the status text is on stderr and the banner on stdout', () => {
    expect(statusOutcome({ status: 1, stdout: BANNER, stderr: BEHIND_TEXT }).pending).toEqual([NAME]);
  });

  it('is ok only with exit 0 and "Database schema is up to date" on either stream', () => {
    const upToDate = { ok: true, detail: 'up to date', pending: [], failed: [] };
    expect(statusOutcome({ status: 0, stdout: '42 migrations found\nDatabase schema is up to date!\n', stderr: BANNER })).toEqual(upToDate);
    expect(statusOutcome({ status: 0, stdout: '', stderr: `${BANNER}Database schema is up to date!` })).toEqual(upToDate);
    expect(statusOutcome({ status: 0, stdout: BANNER, stderr: '' })).toEqual({
      ok: false,
      detail: 'exit 0: no recognised output',
      pending: [],
      failed: [],
    });
    expect(statusOutcome({ status: 1, stdout: 'Database schema is up to date!', stderr: '' }).ok).toBe(false);
    expect(statusOutcome({ status: null, stdout: '', stderr: '' })).toEqual({
      ok: false,
      detail: 'exit null: no recognised output',
      pending: [],
      failed: [],
    });
  });

  it('lists several pending names (plural heading, CRLF, colour codes), caps them in the detail and keeps all in the field', () => {
    const esc = String.fromCharCode(27);
    const names = Array.from({ length: 7 }, (_, index) => `2026112100000${String(index)}_m${String(index)}`);
    const stdout = `Following migrations have not yet been applied:\r\n${names.map((name) => `${esc}[1m${name}${esc}[22m`).join('\r\n')}\r\n`;
    const outcome = statusOutcome({ status: 1, stdout, stderr: '' });
    expect(outcome.pending).toEqual(names);
    expect(outcome.detail).toBe(`exit 1: pending ${names.slice(0, 5).join(', ')} (+2 more)`);
    expect(outcome.detail.length).toBeLessThanOrEqual(500);
  });

  it('lists failed migrations and the diverged-history case (pending under "The migration have not yet been applied:")', () => {
    const failed = statusOutcome({ status: 1, stdout: `Following migration have failed:\n${NAME}\n\nDuring development …`, stderr: '' });
    expect(failed).toMatchObject({ pending: [], failed: [NAME], detail: `exit 1: failed ${NAME}` });
    const diverged = [
      'Your local migration history and the migrations table from your database are different:',
      '',
      'The last common migration is: 20261119000000_job_executions',
      '',
      'The migration have not yet been applied:',
      NAME,
      '',
      'The migrations from the database are not found locally in prisma/migrations:',
      '20261120000000_elsewhere',
    ].join('\n');
    expect(statusOutcome({ status: 1, stdout: diverged, stderr: '' })).toMatchObject({ pending: [NAME], failed: [] });
  });
});

describe('deployOutcome', () => {
  it('is applied on exit 0', () => {
    expect(deployOutcome({ status: 0, stdout: 'All migrations have been successfully applied.', stderr: BANNER })).toEqual({
      ok: true,
      detail: 'applied',
      pending: [],
      failed: [],
    });
  });

  it('[PR034-SEC-03] P3018: the failed migration, the Prisma code, the SQLSTATE and the masked ERROR line, nothing else', () => {
    const stderr = p3018('23505', [
      'ERROR: duplicate key value violates unique constraint "zz_rehearsal_probe_pkey"',
      "DETAIL: Key (id)=(1) already exists, near 'x@example.test'.",
    ]);
    const outcome = deployOutcome({ status: 1, stdout: '', stderr });
    expect(outcome.failed).toEqual([NAME]);
    expect(outcome.detail).toBe(
      `exit 1: failed ${NAME} | P3018 | SQLSTATE 23505 | ERROR: duplicate key value violates unique constraint "…"`,
    );
  });

  /** A random row value that must never reach the detail (the security record's probe P3). */
  const sentinel = (): string => `s${randomBytes(6).toString('hex')}`;

  it.each([
    [
      'DETAIL: Failing row contains (…) of a check violation (23514)',
      '23514',
      (v: string) => ['ERROR: new row for relation "zz" violates check constraint "ck_zz"', `DETAIL: Failing row contains (1, ${v}).`],
    ],
    [
      'DETAIL: Failing row contains (…) of a not-null violation (23502)',
      '23502',
      (v: string) => [
        'ERROR: null value in column "n" of relation "zz" violates not-null constraint',
        `DETAIL: Failing row contains (${v}, null).`,
      ],
    ],
    [
      'a RAISE message that carries a value (P0001)',
      'P0001',
      (v: string) => [`ERROR: refusing row ${v}`, 'CONTEXT: PL/pgSQL function public.zz_check() line 3 at RAISE'],
    ],
    [
      'a value with an escaped quote and a nested group',
      '22P02',
      (v: string) => [`ERROR: invalid input syntax for type integer: "a\\"${v}" (near ((${v})))`, `HINT: value ${v}`],
    ],
    [
      'a Key (…)=(…) control',
      '23505',
      (v: string) => [
        'ERROR: duplicate key value violates unique constraint "ux_zz"',
        `DETAIL: Key (email)=(${v}@example.test) already exists.`,
      ],
    ],
  ])('[PR034-SEC-03] no row value in the detail for %s; the names and codes are still parsed', (_label, sqlstate, server) => {
    const value = sentinel();
    const stderr = p3018(sqlstate, server(value));
    for (const outcome of [deployOutcome({ status: 1, stdout: '', stderr }), deployOutcome({ status: 1, stdout: stderr, stderr: '' })]) {
      expect(outcome.failed).toEqual([NAME]);
      expect(outcome.detail).not.toContain(value);
      expect(outcome.detail).toMatch(new RegExp(`^exit 1: failed ${NAME} \\| P3018 \\| SQLSTATE ${sqlstate}`));
      expect(outcome.detail).not.toMatch(/DETAIL|CONTEXT|HINT|DbError|Loaded Prisma config/);
    }
    if (sqlstate === 'P0001')
      expect(deployOutcome({ status: 1, stdout: '', stderr }).detail).toBe(`exit 1: failed ${NAME} | P3018 | SQLSTATE P0001`);
  });

  it('names the migration of P3009 (a failed migration found in the target database)', () => {
    const stderr = `Error: P3009\n\nmigrate found failed migrations in the target database.\nThe \`${NAME}\` migration started at 2026-11-21 07:30:00 UTC failed\n`;
    expect(deployOutcome({ status: 1, stdout: '', stderr })).toMatchObject({ failed: [NAME], detail: `exit 1: failed ${NAME} | P3009` });
  });

  it('[PR034-SEC-03] a connection failure keeps the Prisma code only, never the host or the database name', () => {
    const stderr = `${BANNER}${DATASOURCE}Error: P1001: Can't reach database server at \`localhost:55432\`\n`;
    expect(deployOutcome({ status: 1, stdout: '', stderr }).detail).toBe('exit 1: P1001');
  });
});

describe('helpers', () => {
  it('listedMigrations stops at the first line that is not a migration name and de-duplicates across streams', () => {
    const text = `Following migration have not yet been applied:\n${NAME}\nnot_a_name\n20261121000000_later\n`;
    expect(listedMigrations({ stdout: text, stderr: text })).toEqual({ pending: [NAME], failed: [] });
  });

  it('[PR034-SEC-03] maskValues masks quotes (escaped quotes included) and parenthesised groups innermost first, and drops what an open quote or parenthesis would keep', () => {
    expect(maskValues(`x = 'y' and "z" (k)=(v)`)).toBe(`x = '…' and "…" (…)=(…)`);
    expect(maskValues(`a "b\\"c" 'd\\'e' f`)).toBe(`a "…" '…' f`);
    expect(maskValues('row (1, (2, (secret)), 3) end')).toBe('row (…) end');
    expect(maskValues('cut "open secret')).toBe('cut …');
    expect(maskValues('cut (open secret')).toBe('cut …');
    expect(maskValues(`${'x'.repeat(2_500)}"secret"`)).toBe('x'.repeat(2_000));
  });

  it('allowedFacts keeps Prisma codes once each, in order', () => {
    expect(allowedFacts({ stdout: 'Error: P3009\nError: P3018', stderr: 'P3009 again' })).toEqual(['P3009', 'P3018']);
  });

  it('[PR034-SEC-03] maskValues stays linear on deeply nested groups (time(4n) / time(n) < 8)', () => {
    const nested = (n: number) => `${'('.repeat(n)}x${')'.repeat(n)}`;
    const fastest = (text: string) =>
      Math.min(
        ...[0, 1, 2].map(() => {
          const started = performance.now();
          maskValues(text);
          return performance.now() - started;
        }),
      );
    // The input is cut at 2 000 characters first, so the depth is bounded and the time is flat.
    expect(fastest(nested(4_000)) / Math.max(fastest(nested(1_000)), 1)).toBeLessThan(8);
    expect(maskValues(nested(500))).toBe('(…)');
  });
});
