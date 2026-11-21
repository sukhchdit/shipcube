/**
 * The backup guardrail before a data-changing migration (CLAUDE.md §5 Database; data-model.md §8.6 step 6;
 * NT-DATA-004-c; TASK-034): the rehearsal record, its freshness rules and the linter's rule R over migration folders.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { lintRehearsals, lintRepository } from './lint-migrations.js';
import { MANIFEST_FORMAT, RehearsalError, sha256Hex, type BackupManifest } from './rehearsal-manifest.js';
import { RECORD_FILE, RECORD_FORMAT, buildRehearsalRecord, migrationNames, recordText, rehearsalProblems } from './rehearsal-record.js';
import { findRepoRoot } from '../test-support/process.js';

const scratch = mkdtempSync(join(tmpdir(), 'rehearsal-record-'));
afterAll(() => rmSync(scratch, { recursive: true, force: true }));

const PREVIOUS = '20261119000000_job_executions';
const MIGRATION = '20261121000000_backfill_notes';
const SQL =
  "-- migration-kind: migrate\n-- data-changing: yes\n-- reversible: yes\nUPDATE public.notes SET body = '' WHERE body IS NULL;\n";
const DIGEST = 'a'.repeat(64);

const manifest = (migrationHead: string | null = PREVIOUS): BackupManifest => ({
  format: MANIFEST_FORMAT,
  database: 'platform',
  serverVersionNum: '180001',
  takenAt: '2026-11-21T10:00:00.000Z',
  migrationHead,
  schemaSha256: sha256Hex(''),
  tables: [],
  sequences: [],
  cluster: { systemIdentifier: '7300000000000000001' },
  loadTimeCode: [],
});

const record = (head: string | null = PREVIOUS, sql: string = SQL) =>
  buildRehearsalRecord({
    migration: MIGRATION,
    migrationSql: sql,
    manifest: manifest(head),
    manifestSha256: DIGEST,
    verifiedAt: '2026-11-21T10:05:00.000Z',
    totals: { tables: 12, rows: '345' },
  });

const expectation = { migration: MIGRATION, migrationSha256: sha256Hex(SQL), previous: PREVIOUS };

describe('the rehearsal record (rule R input)', () => {
  it('[NT-DATA-004-c] a passed record of this migration.sql, taken at the previous migration, is fresh', () => {
    const fresh = record();
    expect(fresh).toEqual({
      format: RECORD_FORMAT,
      migration: MIGRATION,
      migrationSha256: sha256Hex(SQL),
      backup: { database: 'platform', migrationHead: PREVIOUS, manifestSha256: DIGEST, takenAt: '2026-11-21T10:00:00.000Z' },
      verification: {
        verdict: 'pass',
        manifestSha256: DIGEST,
        verifiedAt: '2026-11-21T10:05:00.000Z',
        tables: 12,
        rows: '345',
        deployed: true,
      },
    });
    expect(rehearsalProblems(JSON.parse(recordText(fresh)) as unknown, expectation)).toEqual([]);
    expect(recordText(fresh).endsWith('}\n')).toBe(true);
  });

  it('[NT-DATA-004-c] refuses a stale record: an edited migration.sql, a backup at another head, another migration', () => {
    expect(rehearsalProblems(record(PREVIOUS, `${SQL}-- edited\n`), expectation)).toEqual([
      'migration.sql changed after the rehearsal (its SHA-256 differs from the record)',
    ]);
    expect(rehearsalProblems(record('20261117000000_organisations_identity'), expectation)).toEqual([
      'the backup was taken at migration head "20261117000000_organisations_identity", not at the migration before this one ("20261119000000_job_executions"): take a fresh backup',
    ]);
    expect(rehearsalProblems({ ...record(), migration: 'other' }, expectation)).toEqual(['it names migration "other"']);
    expect(rehearsalProblems(record(null), { ...expectation, previous: null })).toEqual([]);
  });

  it('[NT-DATA-004-c] refuses a failed verification, one without the deploy, a verification of another backup and an impossible order of times', () => {
    const fresh = record();
    const verification = (patch: Record<string, unknown>) => ({ ...fresh, verification: { ...fresh.verification, ...patch } });
    expect(rehearsalProblems(verification({ verdict: 'fail' }), expectation)).toEqual(['the verification did not pass']);
    // D-TASK034-09: a record of a run that did not deploy the migration on the restored data proves no rehearsal.
    expect(rehearsalProblems(verification({ deployed: undefined }), expectation)).toEqual([
      'the rehearsal did not deploy the migration on the restored data',
    ]);
    expect(rehearsalProblems(verification({ manifestSha256: 'b'.repeat(64) }), expectation)).toEqual([
      'the verification ran against another backup manifest',
    ]);
    expect(rehearsalProblems(verification({ verifiedAt: '2026-11-21T09:00:00.000Z' }), expectation)).toEqual([
      'the verification is dated before the backup',
    ]);
    expect(rehearsalProblems(verification({ verifiedAt: 'yesterday' }), expectation)).toEqual([
      'a timestamp is not an ISO-8601 UTC instant',
    ]);
    expect(rehearsalProblems({ ...fresh, backup: { ...fresh.backup, manifestSha256: 'x' } }, expectation)).toEqual([
      'the backup manifest digest is malformed',
    ]);
  });

  it('refuses something that is not a record at all', () => {
    expect(rehearsalProblems(null, expectation)).toEqual([`not a ${RECORD_FORMAT} record`]);
    expect(rehearsalProblems([], expectation)).toEqual([`not a ${RECORD_FORMAT} record`]);
    expect(rehearsalProblems({ ...record(), backup: undefined }, expectation)).toEqual(['the backup or verification section is missing']);
  });

  it('refuses to build a record with a malformed manifest digest', () => {
    expect(() =>
      buildRehearsalRecord({
        migration: MIGRATION,
        migrationSql: SQL,
        manifest: manifest(),
        manifestSha256: 'nope',
        verifiedAt: 'x',
        totals: { tables: 0, rows: '0' },
      }),
    ).toThrow(RehearsalError);
  });
});

describe('rule R: a data-changing migration without a fresh, verified backup is refused by the migration linter', () => {
  let cases = 0;
  /** A migrations root holding the repository's last migration name and MIGRATION; returns the root. */
  const root = (migration: string, recordJson?: string): string => {
    cases += 1;
    const dir = join(scratch, `case-${String(cases)}`);
    mkdirSync(join(dir, PREVIOUS), { recursive: true });
    writeFileSync(join(dir, PREVIOUS, 'migration.sql'), '-- migration-kind: expand\n-- data-changing: no\n-- reversible: yes\nSELECT 1;\n');
    mkdirSync(join(dir, MIGRATION));
    writeFileSync(join(dir, MIGRATION, 'migration.sql'), migration);
    if (recordJson !== undefined) writeFileSync(join(dir, MIGRATION, RECORD_FILE), recordJson);
    mkdirSync(join(dir, '20261122000000_no_sql')); // a folder without migration.sql is rule 1's, not rule R's
    return dir;
  };

  it('[NT-DATA-004-c] refuses a data-changing migration without rehearsal.json, naming the commands', () => {
    const findings = lintRehearsals(root(SQL), 'migrations');
    expect(findings).toEqual([
      {
        file: join('migrations', MIGRATION, RECORD_FILE),
        rule: 'R',
        message: expect.stringMatching(
          /^a data-changing migration needs a fresh, verified backup \(CLAUDE\.md §5\): run "npm run db:backup", then "npm run db:verify-restore -- --backup <dir> --migration 20261121000000_backfill_notes"/,
        ) as unknown as string,
      },
    ]);
  });

  it('[NT-DATA-004-c] accepts a fresh, passed record; refuses a stale one and an unreadable one', () => {
    expect(lintRehearsals(root(SQL, recordText(record())))).toEqual([]);
    const stale = lintRehearsals(root(`${SQL}-- changed after the rehearsal\n`, recordText(record())));
    expect(stale.map((finding) => [finding.rule, finding.message])).toEqual([
      ['R', 'stale or failed rehearsal record: migration.sql changed after the rehearsal (its SHA-256 differs from the record)'],
    ]);
    expect(lintRehearsals(root(SQL, '{ not json')).map((finding) => finding.message)).toEqual([`${RECORD_FILE} is not valid JSON`]);
  });

  it('needs no record for a migration that is not data-changing, and none for a missing root', () => {
    expect(lintRehearsals(root(SQL.replace('data-changing: yes', 'data-changing: no')))).toEqual([]);
    expect(lintRehearsals(join(scratch, 'absent'))).toEqual([]);
  });

  it('[TASK-034 R1-n4] "previous" is the migration before in Prisma\'s list: a folder without migration.sql in between is skipped', () => {
    const dir = root(SQL, recordText(record()));
    mkdirSync(join(dir, '20261120000000_no_sql_between'));
    expect(lintRehearsals(dir)).toEqual([]);
    expect(migrationNames(dir)).toEqual([PREVIOUS, MIGRATION]);
  });

  it('the first migration of a root is checked against a null head', () => {
    const dir = join(scratch, 'first');
    mkdirSync(join(dir, MIGRATION), { recursive: true });
    writeFileSync(join(dir, MIGRATION, 'migration.sql'), SQL);
    writeFileSync(join(dir, MIGRATION, RECORD_FILE), recordText(record(null)));
    expect(lintRehearsals(dir)).toEqual([]);
  });

  it('[NT-DATA-004-c] runs in the repository lanes: prisma/migrations has no data-changing migration yet, so no finding', () => {
    expect(lintRepository(findRepoRoot(), '2026-11-21').filter((finding) => finding.rule === 'R')).toEqual([]);
  });
});
