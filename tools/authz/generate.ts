/**
 * Writes the generated authz artefacts from the packages/authz catalogue and role seed (ADR-0008 §2, REQ-RBAC-002):
 *   - docs/03-architecture/generated/role-permission-matrix.md (read-only document; drift test AT-US-066-02)
 *   - prisma/migrations/20261112010100_authz_seed_v1/{migration.sql,down.sql} (versioned seed, AT-US-066-01)
 *
 * CLI: `npm run authz:generate` writes them; `npm run authz:generate -- --check` exits 1 when a committed file differs.
 * Applied migrations are immutable: when CATALOGUE_VERSION is bumped, the next seed migration gets its own directory
 * (SEED_MIGRATIONS below) and the v1 files stay as they are.
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
  renderRolePermissionMatrix,
  renderSeedMigration,
  ROLES,
  type SeedIdFactory,
} from '@platform/authz';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Seed migration directory per catalogue version. */
export const SEED_MIGRATIONS: Readonly<Record<number, string>> = { 1: 'prisma/migrations/20261112010100_authz_seed_v1' };

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

/**
 * The catalogue the seed is generated from, for the Prisma integration lane (prisma/tests/authz), whose workspace
 * manifest does not list @platform/authz.
 */
export const SEED_SOURCE = { version: CATALOGUE_VERSION, permissions: PERMISSION_DEFINITIONS, roles: ROLES } as const;

export interface Artefact {
  readonly path: string;
  readonly content: string;
}

export function artefacts(): Artefact[] {
  const seedDir = SEED_MIGRATIONS[CATALOGUE_VERSION];
  if (seedDir === undefined) throw new Error(`no seed migration directory registered for catalogue version ${String(CATALOGUE_VERSION)}`);
  const seed = renderSeedMigration(PERMISSION_DEFINITIONS, ROLES, CATALOGUE_VERSION, seedId, AUTHZ_GENERATE_COMMAND);
  return [
    {
      path: MATRIX_DOC_PATH,
      content: renderRolePermissionMatrix(PERMISSION_DEFINITIONS, ROLES, CATALOGUE_VERSION, AUTHZ_GENERATE_COMMAND),
    },
    { path: `${seedDir}/migration.sql`, content: seed.up },
    { path: `${seedDir}/down.sql`, content: seed.down },
  ];
}

/** Artefacts whose committed content differs from the generator output (missing files included). */
export function drifted(root: string = REPO_ROOT): string[] {
  return artefacts()
    .filter(({ path, content }) => {
      const file = join(root, path);
      return !existsSync(file) || readFileSync(file, 'utf8') !== content;
    })
    .map(({ path }) => path);
}

export function main(argv: readonly string[] = process.argv.slice(2), root: string = REPO_ROOT): number {
  if (argv.includes('--check')) {
    const stale = drifted(root);
    for (const path of stale) process.stderr.write(`[authz:generate] ${path} is out of date; run \`${AUTHZ_GENERATE_COMMAND}\`\n`);
    return stale.length === 0 ? 0 : 1;
  }
  for (const { path, content } of artefacts()) {
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
