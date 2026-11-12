/** Generated role-permission matrix document and seed migration renderers (REQ-RBAC-002, ADR-0008 §2). */
import { describe, expect, it } from '@jest/globals';

import { AUTHZ_GENERATE_COMMAND, MATRIX_DOC_PATH, renderRolePermissionMatrix } from './matrix-doc.js';
import { PERMISSION_DEFINITIONS } from './permissions/index.js';
import { CATALOGUE_VERSION, ROLES } from './roles.js';
import { linkKey, renderSeedMigration, SYSTEM_ACTOR_ID, type SeedIdFactory } from './seed-sql.js';
import { readRepoFile } from './tests/repo.js';

const render = (): string => renderRolePermissionMatrix(PERMISSION_DEFINITIONS, ROLES, CATALOGUE_VERSION, AUTHZ_GENERATE_COMMAND);

/** Test factory: a counter-based UUID per natural key (the real factory hashes, tools/authz/generate.ts). */
const sequentialIds = (): SeedIdFactory => {
  const ids = new Map<string, string>();
  return (kind, key) => {
    const natural = `${kind}/${key}`;
    if (!ids.has(natural)) ids.set(natural, `00000000-0000-7000-8000-${(ids.size + 1).toString(16).padStart(12, '0')}`);
    return String(ids.get(natural));
  };
};

describe('role-permission matrix document (REQ-RBAC-002)', () => {
  it(`[AT-US-066-02] the committed ${MATRIX_DOC_PATH} matches the generator output exactly (drift fails CI)`, () => {
    const committed = readRepoFile(MATRIX_DOC_PATH);
    if (committed !== render())
      throw new Error(`${MATRIX_DOC_PATH} is out of date: regenerate it with \`${AUTHZ_GENERATE_COMMAND}\` and commit it`);
    expect(committed).toBe(render());
  });

  it('[AT-US-066-02] the document carries the banner, the version, one row per permission per scope and per-role counts', () => {
    const doc = render();
    expect(doc.startsWith(`<!-- GENERATED FILE: do not edit. Regenerate with \`${AUTHZ_GENERATE_COMMAND}\``)).toBe(true);
    expect(doc).toContain(`Catalogue version: **${String(CATALOGUE_VERSION)}**`);
    for (const heading of ['## Operator roles', '## Customer roles', '## Partner roles', '## Permissions per role'])
      expect(doc).toContain(heading);
    expect(doc.match(/^\| `[a-z_:]+` \|/gm)).toHaveLength(PERMISSION_DEFINITIONS.length * 3);
    expect(doc).toContain('| `audit:export` | operator-only, reserved | Y |');
    expect(doc).toContain('| `webhook:stripe:receive` | signature-only |  |');
    for (const role of ROLES)
      expect(doc).toContain(`| ${role.key} | ${role.scope} | \`${role.nameKey}\` | ${String(role.permissions.length)} |`);
  });
});

describe('seed migration renderer (REQ-RBAC-002/013, data-model §3.3)', () => {
  const seed = renderSeedMigration(PERMISSION_DEFINITIONS, ROLES, CATALOGUE_VERSION, sequentialIds(), AUTHZ_GENERATE_COMMAND);
  const links = ROLES.reduce((total, role) => total + role.permissions.length, 0);

  it('renders an expand, non-data-changing, reversible migration of plain idempotent INSERTs by the SYSTEM actor', () => {
    expect(seed.up.startsWith('-- migration-kind: expand\n-- data-changing: no\n-- reversible: yes\n')).toBe(true);
    expect(seed.up.match(/ON CONFLICT DO NOTHING;/g)).toHaveLength(3);
    expect(seed.up).not.toMatch(/INSERT[^;]*SELECT/i);
    expect(seed.up.match(/^ {2}\(/gm)).toHaveLength(PERMISSION_DEFINITIONS.length + ROLES.length + links);
    expect(seed.up).toContain(`'${SYSTEM_ACTOR_ID}', '${SYSTEM_ACTOR_ID}')`);
    expect(seed.up).toContain(`'carrier:status:read', 'View carrier integration health and circuit-breaker status.', 'carrier', true`);
    expect(seed.down).toContain('DELETE FROM "public"."role_permissions" WHERE "id" IN (');
    expect(seed.down.indexOf('"role_permissions"')).toBeLessThan(seed.down.indexOf('"roles"'));
    expect(linkKey('CUSTOMER_OWNER', 'quote:read')).toBe('CUSTOMER_OWNER|quote:read');
  });

  it('escapes quotes in literals and rejects an ID that is not a lower-case UUID', () => {
    const quoted = [{ key: 'quote:read', description: "Owner's quotes", category: 'quote' as const, operatorOnly: false }];
    expect(renderSeedMigration(quoted, [], 1, sequentialIds(), 'x').up).toContain("'Owner''s quotes'");
    expect(() => renderSeedMigration(quoted, [], 1, () => "x'); DROP TABLE roles; --", 'x')).toThrow('is not a lower-case UUID');
  });
});
