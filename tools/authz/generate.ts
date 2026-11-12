/**
 * Writes the generated authz artefacts from the packages/authz catalogue and role seed (ADR-0008 §2, REQ-RBAC-002):
 *   - docs/03-architecture/generated/role-permission-matrix.md (read-only document; drift test AT-US-066-02)
 *   - prisma/migrations/20261112010100_authz_seed_v1/{migration.sql,down.sql} (versioned seed, AT-US-066-01)
 *
 * CLI: `npm run authz:generate` writes them; `npm run authz:generate -- --check` exits 1 when a committed file differs.
 *
 * Released seed versions are immutable (D-SEC-PR8-01, PR8-SEC-01): `prisma migrate deploy` never re-applies an edited
 * migration, so rewriting a released seed would leave every existing database on the old grants while fresh databases
 * get the new ones. Each released version is therefore pinned by the SHA-256 of its two files (SEED_MIGRATIONS). The
 * generator refuses to write a pinned directory with different content, and `--check` fails when a pinned file changes
 * or when the catalogue no longer renders to the pinned bytes. A grant change bumps CATALOGUE_VERSION and ships as a
 * new seed directory, which needs the delta renderer described in `artefacts()`.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  AUTHZ_GENERATE_COMMAND,
  CATALOGUE_VERSION,
  MATRIX_DOC_PATH,
  PERMISSION_DEFINITIONS,
  type PermissionDefinition,
  renderRolePermissionMatrix,
  renderSeedMigration,
  type RoleDefinition,
  ROLES,
  type SeedIdFactory,
} from '@platform/authz';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** One seed migration directory; `sha256` is set when the version is released (merged) and makes it immutable. */
export interface SeedRelease {
  readonly dir: string;
  readonly sha256?: { readonly up: string; readonly down: string };
}

/** Seed migration directory per catalogue version, with the SHA-256 pins of the released versions. */
export const SEED_MIGRATIONS: Readonly<Record<number, SeedRelease>> = {
  1: {
    dir: 'prisma/migrations/20261112010100_authz_seed_v1',
    sha256: {
      up: 'dbe3e8071cb81cb34a0a46cf66a3517eaead4ba21e83ce7eeed14f3f338f290a',
      down: '096b273a5edd6d8f43908a3b422a785f508b43fa86fc1e6a04f80ac71c912764',
    },
  },
};

/**
 * The renderer (`renderSeedMigration`) emits the WHOLE catalogue, which is only a correct migration for the first
 * version: a later version rendered that way would re-insert every row and its down.sql would delete every v1 row.
 */
export const MAX_FULL_RENDER_VERSION = 1;

/** Timestamp embedded in every seed ID: 2026-11-12T00:00:00Z, the catalogue v1 date. */
export const SEED_EPOCH_MS = Date.UTC(2026, 10, 12);

/**
 * Deterministic, syntactically valid UUIDv7 (version 7, variant 10; data-model P1, NFR-DATA-002) for a seed row:
 * the fixed seed timestamp plus 74 bits of SHA-256 over the natural key, so every run yields the same IDs.
 */
export const seedId: SeedIdFactory = (kind, naturalKey) => {
  const hash = createHash('sha256').update(`platform:authz:${kind}:${naturalKey}`).digest('hex');
  const time = SEED_EPOCH_MS.toString(16).padStart(12, '0');
  const variant = ((Number.parseInt(hash.charAt(3), 16) & 0x3) | 0x8).toString(16);
  return `${time.slice(0, 8)}-${time.slice(8, 12)}-7${hash.slice(0, 3)}-${variant}${hash.slice(4, 7)}-${hash.slice(7, 19)}`;
};

/** What the artefacts are rendered from; tests inject a mutated source. */
export interface CatalogueSource {
  readonly version: number;
  readonly permissions: readonly PermissionDefinition[];
  readonly roles: readonly RoleDefinition<string, string>[];
}

/**
 * The catalogue the seed is generated from, also used by the Prisma integration lane (prisma/tests/authz), whose
 * workspace manifest does not list @platform/authz.
 */
export const SEED_SOURCE: CatalogueSource = { version: CATALOGUE_VERSION, permissions: PERMISSION_DEFINITIONS, roles: ROLES };

export interface Artefact {
  readonly path: string;
  readonly content: string;
  /** Set for the files of a released (pinned) seed version: the content must hash to this value. */
  readonly pin?: string;
}

export const sha256 = (content: string | Buffer): string => createHash('sha256').update(content).digest('hex');

export function artefacts(source: CatalogueSource = SEED_SOURCE): Artefact[] {
  if (source.version > MAX_FULL_RENDER_VERSION) {
    throw new Error(
      `catalogue version ${String(source.version)} needs a delta seed renderer, which does not exist yet: ` +
        `v(n) migration.sql must insert only the added permissions, roles and links and delete the removed links ` +
        `(data-changing: yes when it deletes, D-SEC-PR8-01), and v(n) down.sql must revert only that delta. ` +
        `Implement it in packages/authz/src/seed-sql.ts before bumping CATALOGUE_VERSION (PR8-SEC-01).`,
    );
  }
  const release = SEED_MIGRATIONS[source.version];
  if (release === undefined) {
    throw new Error(`no seed migration directory registered for catalogue version ${String(source.version)}`);
  }
  const seed = renderSeedMigration(source.permissions, source.roles, source.version, seedId, AUTHZ_GENERATE_COMMAND);
  return [
    {
      path: MATRIX_DOC_PATH,
      content: renderRolePermissionMatrix(source.permissions, source.roles, source.version, AUTHZ_GENERATE_COMMAND),
    },
    { path: `${release.dir}/migration.sql`, content: seed.up, ...(release.sha256 ? { pin: release.sha256.up } : {}) },
    { path: `${release.dir}/down.sql`, content: seed.down, ...(release.sha256 ? { pin: release.sha256.down } : {}) },
  ];
}

const readIfExists = (file: string): Buffer | undefined => (existsSync(file) ? readFileSync(file) : undefined);

/** Artefacts whose committed content differs from the generator output (missing files included). */
export function drifted(root: string = REPO_ROOT, source: CatalogueSource = SEED_SOURCE): string[] {
  return artefacts(source)
    .filter(({ path, content }) => readIfExists(join(root, path))?.toString('utf8') !== content)
    .map(({ path }) => path);
}

const releasedMessage = (path: string, version: number): string =>
  `${path} belongs to released catalogue v${String(version)} and is pinned by SHA-256: released seed migrations are ` +
  `immutable (D-SEC-PR8-01). Revert it, bump CATALOGUE_VERSION and add a new seed migration instead`;

/** Committed files of every released seed version that no longer hash to their pin (missing files included). */
export function pinnedDrift(root: string = REPO_ROOT): string[] {
  return Object.entries(SEED_MIGRATIONS).flatMap(([version, { dir, sha256: pin }]) => {
    if (pin === undefined) return [];
    return (['up', 'down'] as const)
      .map((side) => ({ path: `${dir}/${side === 'up' ? 'migration.sql' : 'down.sql'}`, expected: pin[side] }))
      .filter(({ path, expected }) => {
        const bytes = readIfExists(join(root, path));
        return bytes === undefined || sha256(bytes) !== expected;
      })
      .map(({ path }) => releasedMessage(path, Number(version)));
  });
}

/** Rendered artefacts of a released version that would change its pinned bytes: the catalogue changed in place. */
function releasedChanges(source: CatalogueSource): string[] {
  return artefacts(source)
    .filter(({ pin, content }) => pin !== undefined && sha256(content) !== pin)
    .map(
      ({ path }) =>
        `catalogue changed: ${path} would change, but catalogue v${String(source.version)} is released and pinned. ` +
        `Bump CATALOGUE_VERSION and add a seed migration (D-SEC-PR8-01)`,
    );
}

/** Every reason `--check` fails, as messages; empty when the committed artefacts are current and the pins hold. */
export function checkMessages(root: string = REPO_ROOT, source: CatalogueSource = SEED_SOURCE): string[] {
  const released = releasedChanges(source);
  const pinned = pinnedDrift(root);
  const pinnedPaths = new Set(artefacts(source).flatMap(({ path, pin }) => (pin === undefined ? [] : [path])));
  const stale = drifted(root, source)
    .filter((path) => !pinnedPaths.has(path))
    .map((path) => `${path} is out of date; run \`${AUTHZ_GENERATE_COMMAND}\``);
  return [...released, ...pinned, ...stale];
}

export function main(
  argv: readonly string[] = process.argv.slice(2),
  root: string = REPO_ROOT,
  source: CatalogueSource = SEED_SOURCE,
): number {
  const report = (messages: readonly string[]): number => {
    for (const message of messages) process.stderr.write(`[authz:generate] ${message}\n`);
    return messages.length === 0 ? 0 : 1;
  };
  if (argv.includes('--check')) return report(checkMessages(root, source));
  const refused = releasedChanges(source);
  if (refused.length > 0) return report(refused);
  for (const { path, content } of artefacts(source)) {
    const file = join(root, path);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, content, 'utf8');
    process.stdout.write(`[authz:generate] wrote ${path}\n`);
  }
  return 0;
}

if (import.meta.main) {
  process.exitCode = main();
}
