/**
 * The outcome of `prisma migrate status | deploy` in the restore report (TASK-034 fix cycle 2, D-TASK034-14): both
 * streams are read, whichever one carries the banner or the status text, and the pending / failed migration names are
 * parsed into structured fields.
 */
import { describe, expect, it } from '@jest/globals';

import { deployOutcome, listedMigrations, maskValues, outputTail, statusOutcome } from './prisma-outcome.js';

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

describe('statusOutcome', () => {
  it('[TASK-034 R1-M1] names the pending migration when the status text is on stdout and the banner on stderr (lane B 20261121T0711Z)', () => {
    const outcome = statusOutcome({ status: 1, stdout: `${DATASOURCE}${BEHIND_TEXT}`, stderr: BANNER });
    expect(outcome.ok).toBe(false);
    expect(outcome.pending).toEqual([NAME]);
    expect(outcome.failed).toEqual([]);
    expect(outcome.detail).toMatch(new RegExp(`^exit 1: pending ${NAME} \\| `));
    expect(outcome.detail).not.toMatch(/Loaded Prisma config|Prisma schema loaded|localhost/);
  });

  it('[TASK-034 R1-M1] names the pending migration when everything, banner first, is on stderr', () => {
    const outcome = statusOutcome({ status: 1, stdout: '', stderr: `${BANNER}${DATASOURCE}${BEHIND_TEXT}` });
    expect(outcome).toEqual({
      ok: false,
      pending: [NAME],
      failed: [],
      detail: `exit 1: pending ${NAME} | ${NAME} | To apply migrations in development run prisma migrate dev. | To apply migrations in production run prisma migrate deploy.`,
    });
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
      detail: 'exit 0: no output',
      pending: [],
      failed: [],
    });
    expect(statusOutcome({ status: 1, stdout: 'Database schema is up to date!', stderr: '' }).ok).toBe(false);
    expect(statusOutcome({ status: null, stdout: '', stderr: '' })).toEqual({
      ok: false,
      detail: 'exit null: no output',
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
    expect(outcome.detail).toMatch(new RegExp(`^exit 1: pending ${names.slice(0, 5).join(', ')} \\(\\+2 more\\) \\| `));
    expect(outcome.detail.length).toBeLessThanOrEqual(500);
  });

  it('lists failed migrations and the diverged-history case (pending under "The migration have not yet been applied:")', () => {
    const failed = statusOutcome({ status: 1, stdout: `Following migration have failed:\n${NAME}\n\nDuring development …`, stderr: '' });
    expect(failed).toMatchObject({ pending: [], failed: [NAME] });
    expect(failed.detail).toMatch(new RegExp(`^exit 1: failed ${NAME} \\| `));
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

  it('names the failed migration of P3018 and masks the row data a database error quotes', () => {
    const stderr = [
      BANNER,
      'Error: P3018',
      '',
      'A migration failed to apply. New migrations cannot be applied before the error is recovered from.',
      '',
      `Migration name: ${NAME}`,
      '',
      'Database error code: 23505',
      '',
      'Database error:',
      'ERROR: duplicate key value violates unique constraint "zz_rehearsal_probe_pkey"',
      "DETAIL: Key (id)=(1) already exists, near 'x@example.test'.",
    ].join('\n');
    const outcome = deployOutcome({ status: 1, stdout: '', stderr });
    expect(outcome.failed).toEqual([NAME]);
    expect(outcome.detail).toBe(
      `exit 1: failed ${NAME} | Database error: | ERROR: duplicate key value violates unique constraint "…" | DETAIL: Key (id)=(…) already exists, near '…'.`,
    );
  });

  it('names the migration of P3009 (a failed migration found in the target database)', () => {
    const stderr = `Error: P3009\n\nmigrate found failed migrations in the target database.\nThe \`${NAME}\` migration started at 2026-11-21 07:30:00 UTC failed\n`;
    expect(deployOutcome({ status: 1, stdout: '', stderr }).failed).toEqual([NAME]);
  });
});

describe('helpers', () => {
  it('listedMigrations stops at the first line that is not a migration name and de-duplicates across streams', () => {
    const text = `Following migration have not yet been applied:\n${NAME}\nnot_a_name\n20261121000000_later\n`;
    expect(listedMigrations({ stdout: text, stderr: text })).toEqual({ pending: [NAME], failed: [] });
  });

  it('outputTail drops the banner and empty lines, reads stdout then stderr, and masks values', () => {
    expect(outputTail({ stdout: `${BANNER}a\n\nb`, stderr: `${DATASOURCE}c "secret"` }, 5)).toEqual(['a', 'b', 'c "…"']);
    expect(maskValues(`x = 'y' and "z" (k)=(v)`)).toBe(`x = '…' and "…" (k)=(…)`);
  });
});
