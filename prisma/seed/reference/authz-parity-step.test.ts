import { describe, expect, it } from '@jest/globals';

import { PERMISSION_DEFINITIONS, ROLES } from '@platform/authz';

import type { SeedContext, SeedLogger, SeedSql } from '../framework/contracts.js';
import { authzParityStep, catalogueSnapshot, diffAuthz, type AuthzSnapshot } from './authz-parity-step.js';
import { REFERENCE_DATASETS, REFERENCE_STEPS } from './index.js';

const clone = (snapshot: AuthzSnapshot): { permissions: Map<string, string>; roles: Map<string, string>; links: Set<string> } => ({
  permissions: new Map(snapshot.permissions),
  roles: new Map(snapshot.roles),
  links: new Set(snapshot.links),
});

/** Answers the three parity reads from the catalogue itself, optionally mutated. */
function contextFor(
  mutate: (rows: { permissions: Record<string, unknown>[]; roles: Record<string, unknown>[]; links: Record<string, unknown>[] }) => void,
): SeedContext {
  const rows = {
    permissions: PERMISSION_DEFINITIONS.map((p) => ({
      key: p.key,
      description: p.description,
      category: p.category,
      operator_only: p.operatorOnly,
    })),
    roles: ROLES.map((r) => ({ key: r.key, scope: r.scope, name_key: r.nameKey, is_system: true, description: r.description })),
    links: ROLES.flatMap((r) => r.permissions.map((p) => ({ link: `${r.key}|${p}` }))),
  };
  mutate(rows);
  const sql: SeedSql = {
    query: <R extends Record<string, unknown>>(text: string) => {
      const picked = text.includes('role_permissions') ? rows.links : text.includes('FROM public.roles') ? rows.roles : rows.permissions;
      return Promise.resolve({ rows: picked as unknown as R[], rowCount: picked.length });
    },
  };
  const logger: SeedLogger = { info: () => undefined, warn: () => undefined };
  return {
    sql,
    logger,
    versions: { get: () => Promise.resolve(undefined), record: () => Promise.resolve() },
    configChanges: { configChanged: () => Promise.resolve() },
  };
}

describe('diffAuthz', () => {
  it('is empty for the catalogue against itself', () => {
    expect(diffAuthz(catalogueSnapshot(), catalogueSnapshot())).toEqual([]);
  });

  it('names missing, unexpected and changed keys, sorted', () => {
    const actual = clone(catalogueSnapshot());
    const [firstPermission] = [...actual.permissions.keys()];
    const [firstRole] = [...actual.roles.keys()];
    const [firstLink] = [...actual.links];
    actual.permissions.delete(firstPermission ?? '');
    actual.roles.set(firstRole ?? '', 'tampered');
    actual.links.delete(firstLink ?? '');
    actual.links.add('GHOST|ghost:perm');
    const drift = diffAuthz(catalogueSnapshot(), actual);
    expect(drift).toEqual(
      [`permission:${firstPermission}`, `role:${firstRole}`, `link:${firstLink}`, 'link:GHOST|ghost:perm']
        .map(
          (prefix, index) =>
            prefix + (index === 0 ? ' (missing)' : index === 1 ? ' (changed)' : index === 2 ? ' (missing)' : ' (unexpected)'),
        )
        .sort(),
    );
  });
});

describe('authzParityStep', () => {
  it('passes when the tables equal the catalogue', async () => {
    await expect(authzParityStep.run(contextFor(() => undefined))).resolves.toBeUndefined();
  });

  it('fails with SEED_AUTHZ_DRIFT naming the drifted link', async () => {
    let removed = '';
    const context = contextFor((rows) => {
      removed = String(rows.links.pop()?.['link']);
    });
    const error = await authzParityStep.run(context).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: 'SEED_AUTHZ_DRIFT', subjects: [`link:${removed} (missing)`] });
  });
});

describe('reference seed definition', () => {
  it('has no datasets yet and verifies authz parity as its only step', () => {
    expect(REFERENCE_DATASETS).toEqual([]);
    expect(REFERENCE_STEPS.map((step) => step.name)).toEqual(['authz-parity']);
  });
});
