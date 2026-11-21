/**
 * The rehearsal record: the committed proof that a `data-changing: yes` migration had a fresh, verified backup
 * (CLAUDE.md §5 Database; data-model.md §8.6 step 6; NT-DATA-004-c; TASK-034).
 *
 * `npm run db:verify-restore -- --backup <dir> --migration <name>` writes `prisma/migrations/<name>/rehearsal.json`
 * after a passed verification, and the migration linter (`lintRehearsals`, rule R) refuses a data-changing migration
 * whose record is missing or stale. "Fresh" needs no clock:
 *  - `migrationSha256` equals the SHA-256 of the committed `migration.sql` bytes, so an edit after the rehearsal voids it;
 *  - the backup's `_prisma_migrations` head is the migration just before this one, so the backup was taken at the state
 *    this migration changes (a migration merged in between voids it too);
 *  - the verification passed, against that same backup manifest, and was not dated before the backup.
 * The record is a claim written by a tool, not a signature: the outcome controls are the rehearsal itself (lane B
 * `restore-rehearsal`) and, at M5, the CD pipeline's snapshot-restore-verify step before a data-changing deploy (§8.6).
 */
import { RehearsalError, sha256Hex, type BackupManifest } from './rehearsal-manifest.js';

export const RECORD_FORMAT = 'platform.rehearsal-record/v1';
export const RECORD_FILE = 'rehearsal.json';

export interface RehearsalRecord {
  readonly format: typeof RECORD_FORMAT;
  readonly migration: string;
  readonly migrationSha256: string;
  readonly backup: {
    readonly database: string;
    readonly migrationHead: string | null;
    readonly manifestSha256: string;
    readonly takenAt: string;
  };
  readonly verification: {
    readonly verdict: 'pass';
    readonly manifestSha256: string;
    readonly verifiedAt: string;
    readonly tables: number;
    readonly rows: string;
  };
}

export interface RecordExpectation {
  readonly migration: string;
  /** SHA-256 (hex) of the committed migration.sql bytes. */
  readonly migrationSha256: string;
  /** The migration directory just before this one, or null for the first. */
  readonly previous: string | null;
}

const HEX64 = /^[0-9a-f]{64}$/;
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z$/;
const instant = (value: unknown): number | undefined =>
  typeof value === 'string' && ISO_INSTANT.test(value) && !Number.isNaN(Date.parse(value)) ? Date.parse(value) : undefined;
const object = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;

/** Why `raw` is not a fresh, passed rehearsal record of the expected migration (empty = it is). */
export function rehearsalProblems(raw: unknown, expected: RecordExpectation): string[] {
  const record = object(raw);
  if (record === undefined || record['format'] !== RECORD_FORMAT) return [`not a ${RECORD_FORMAT} record`];
  const problems: string[] = [];
  const backup = object(record['backup']);
  const verification = object(record['verification']);
  if (record['migration'] !== expected.migration) problems.push(`it names migration ${JSON.stringify(record['migration'])}`);
  if (record['migrationSha256'] !== expected.migrationSha256) {
    problems.push('migration.sql changed after the rehearsal (its SHA-256 differs from the record)');
  }
  if (backup === undefined || verification === undefined) return [...problems, 'the backup or verification section is missing'];
  if (backup['migrationHead'] !== expected.previous) {
    problems.push(
      `the backup was taken at migration head ${JSON.stringify(backup['migrationHead'] ?? null)}, not at the migration before this one (${JSON.stringify(expected.previous)}): take a fresh backup`,
    );
  }
  if (verification['verdict'] !== 'pass') problems.push('the verification did not pass');
  if (typeof backup['manifestSha256'] !== 'string' || !HEX64.test(backup['manifestSha256']))
    problems.push('the backup manifest digest is malformed');
  else if (verification['manifestSha256'] !== backup['manifestSha256'])
    problems.push('the verification ran against another backup manifest');
  const takenAt = instant(backup['takenAt']);
  const verifiedAt = instant(verification['verifiedAt']);
  if (takenAt === undefined || verifiedAt === undefined) problems.push('a timestamp is not an ISO-8601 UTC instant');
  else if (verifiedAt < takenAt) problems.push('the verification is dated before the backup');
  return problems;
}

export interface RecordInputs {
  readonly migration: string;
  readonly migrationSql: string | Buffer;
  readonly manifest: BackupManifest;
  readonly manifestSha256: string;
  readonly verifiedAt: string;
  readonly totals: { readonly tables: number; readonly rows: string };
}

/** A passed record (the caller has verified the restore and checked the migration head). */
export function buildRehearsalRecord(inputs: RecordInputs): RehearsalRecord {
  if (!HEX64.test(inputs.manifestSha256)) throw new RehearsalError('the manifest digest must be a SHA-256 hex string');
  return {
    format: RECORD_FORMAT,
    migration: inputs.migration,
    migrationSha256: sha256Hex(inputs.migrationSql),
    backup: {
      database: inputs.manifest.database,
      migrationHead: inputs.manifest.migrationHead,
      manifestSha256: inputs.manifestSha256,
      takenAt: inputs.manifest.takenAt,
    },
    verification: {
      verdict: 'pass',
      manifestSha256: inputs.manifestSha256,
      verifiedAt: inputs.verifiedAt,
      tables: inputs.totals.tables,
      rows: inputs.totals.rows,
    },
  };
}

/** The file text of a record: two-space JSON with a final newline (Prettier's JSON form). */
export const recordText = (record: RehearsalRecord): string => `${JSON.stringify(record, null, 2)}\n`;
