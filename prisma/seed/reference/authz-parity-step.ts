import { PERMISSION_DEFINITIONS, ROLES } from '@platform/authz';

import { SeedRefusedError, type SeedContext, type SeedStep } from '../framework/contracts.js';

/** What the three authz tables hold, reduced to comparable text per natural key. */
export interface AuthzSnapshot {
  readonly permissions: ReadonlyMap<string, string>;
  readonly roles: ReadonlyMap<string, string>;
  readonly links: ReadonlySet<string>;
}

/** At most this many drifted keys are listed in a refusal; the rest are counted. */
const MAX_LISTED = 25;

const fingerprint = (...parts: readonly (string | boolean)[]): string => JSON.stringify(parts);

/** The `packages/authz` catalogue in {@link AuthzSnapshot} form. */
export function catalogueSnapshot(): AuthzSnapshot {
  return {
    permissions: new Map(PERMISSION_DEFINITIONS.map((p) => [p.key, fingerprint(p.description, p.category, p.operatorOnly)] as const)),
    roles: new Map(ROLES.map((r) => [r.key, fingerprint(r.scope, r.nameKey, true, r.description)] as const)),
    links: new Set(ROLES.flatMap((r) => r.permissions.map((permission) => `${r.key}|${permission}`))),
  };
}

function diffMaps(kind: string, expected: ReadonlyMap<string, string>, actual: ReadonlyMap<string, string>): string[] {
  const drift: string[] = [];
  for (const [key, value] of expected) {
    const found = actual.get(key);
    if (found === undefined) drift.push(`${kind}:${key} (missing)`);
    else if (found !== value) drift.push(`${kind}:${key} (changed)`);
  }
  for (const key of actual.keys()) if (!expected.has(key)) drift.push(`${kind}:${key} (unexpected)`);
  return drift;
}

/** Drifted keys between the catalogue and the database, sorted; empty when the tables equal the catalogue. */
export function diffAuthz(expected: AuthzSnapshot, actual: AuthzSnapshot): string[] {
  const links: string[] = [];
  for (const link of expected.links) if (!actual.links.has(link)) links.push(`link:${link} (missing)`);
  for (const link of actual.links) if (!expected.links.has(link)) links.push(`link:${link} (unexpected)`);
  return [
    ...diffMaps('permission', expected.permissions, actual.permissions),
    ...diffMaps('role', expected.roles, actual.roles),
    ...links,
  ].sort();
}

async function readSnapshot(context: SeedContext): Promise<AuthzSnapshot> {
  const { sql } = context;
  const permissions = await sql.query<{ key: string; description: string; category: string; operator_only: boolean }>(
    'SELECT key, description, category, operator_only FROM public.permissions',
  );
  const roles = await sql.query<{ key: string; scope: string; name_key: string; is_system: boolean; description: string }>(
    'SELECT key, scope, name_key, is_system, description FROM public.roles',
  );
  const links = await sql.query<{ link: string }>(
    `SELECT r.key || '|' || p.key AS link
       FROM public.role_permissions rp
       JOIN public.roles r ON r.id = rp.role_id
       JOIN public.permissions p ON p.id = rp.permission_id`,
  );
  return {
    permissions: new Map(permissions.rows.map((p) => [p.key, fingerprint(p.description, p.category, p.operator_only)] as const)),
    roles: new Map(roles.rows.map((r) => [r.key, fingerprint(r.scope, r.name_key, r.is_system, r.description)] as const)),
    links: new Set(links.rows.map((row) => row.link)),
  };
}

/**
 * Verifies that `permissions`, `roles` and `role_permissions` equal the `packages/authz` catalogue (data-model §9.2,
 * D-ARCH-060). It only reads: the generated, versioned seed migration is the sole writer of these tables, so a
 * mismatch means a migration is missing or was altered and is fixed by migrating, never by this seed.
 */
export const authzParityStep: SeedStep = {
  name: 'authz-parity',
  async run(context: SeedContext): Promise<void> {
    const drift = diffAuthz(catalogueSnapshot(), await readSnapshot(context));
    if (drift.length === 0) return;
    const listed = drift.slice(0, MAX_LISTED);
    const more = drift.length > listed.length ? ` (+${String(drift.length - listed.length)} more)` : '';
    throw new SeedRefusedError(
      'SEED_AUTHZ_DRIFT',
      listed,
      `Seed refused: the authz tables differ from the packages/authz catalogue in ${String(drift.length)} place(s)${more}: ${listed.join(', ')}. ` +
        'Run `migrate deploy`; the seed never writes these tables.',
    );
  },
};
