/**
 * Renders the role-permission matrix document (REQ-RBAC-002, ADR-0008 §2) from the catalogue and the role seed, the
 * single source. Pure: the writer (tools/authz/generate.ts) puts the result in
 * docs/03-architecture/generated/role-permission-matrix.md and the drift test compares it byte for byte.
 */
import type { PermissionDefinition } from './permissions/index.js';
import { type RoleDefinition, ROLE_SCOPES, type RoleScope } from './roles.js';

/** Regenerates the matrix document and the seed migration (root script, tools/authz/generate.ts). */
export const AUTHZ_GENERATE_COMMAND = 'npm run authz:generate';

/** Repository-relative path of the generated document. */
export const MATRIX_DOC_PATH = 'docs/03-architecture/generated/role-permission-matrix.md';

const SCOPE_TITLES: Readonly<Record<RoleScope, string>> = {
  OPERATOR: 'Operator roles',
  CUSTOMER: 'Customer roles',
  PARTNER: 'Partner roles (data only in this run, REQ-RBAC-003)',
};

function flags(definition: PermissionDefinition): string {
  const set: string[] = [];
  if (definition.operatorOnly) set.push('operator-only');
  if (definition.reserved === true) set.push('reserved');
  if (definition.signatureOnly === true) set.push('signature-only');
  if (definition.selfService === true) set.push('self-service');
  return set.join(', ');
}

const row = (cells: readonly string[]): string => `| ${cells.join(' | ')} |`;

function scopeTable(catalogue: readonly PermissionDefinition[], roles: readonly RoleDefinition<string, string>[]): string[] {
  const held = roles.map((role) => new Set(role.permissions));
  return [
    row(['Permission', 'Flags', ...roles.map((role) => role.key)]),
    row(['---', '---', ...roles.map(() => ':-:')]),
    ...catalogue.map((definition) =>
      row([`\`${definition.key}\``, flags(definition), ...held.map((set) => (set.has(definition.key) ? 'Y' : ''))]),
    ),
  ];
}

export function renderRolePermissionMatrix(
  catalogue: readonly PermissionDefinition[],
  roles: readonly RoleDefinition<string, string>[],
  version: number,
  regenerateCommand: string,
): string {
  const lines = [
    `<!-- GENERATED FILE: do not edit. Regenerate with \`${regenerateCommand}\` (source: packages/authz). -->`,
    '',
    '# Role-permission matrix',
    '',
    `Catalogue version: **${String(version)}**. Generated from the permission catalogue (\`packages/authz/src/permissions\`) and the role seed (\`packages/authz/src/roles.ts\`), the single source of the seed migration (ADR-0008, REQ-RBAC-002). CI fails when this file differs from the generator output.`,
    '',
    '`Y` = granted. Flags: `operator-only` = never held by a customer or partner role (DR-A07); `reserved` = seam for a later milestone, held by Super Admin only; `signature-only` = webhook permission, held by no role.',
  ];
  for (const scope of ROLE_SCOPES) {
    lines.push(
      '',
      `## ${SCOPE_TITLES[scope]}`,
      '',
      ...scopeTable(
        catalogue,
        roles.filter((role) => role.scope === scope),
      ),
    );
  }
  lines.push('', '## Permissions per role', '', row(['Role', 'Scope', 'Name key', 'Permissions']), row(['---', '---', '---', '--:']));
  for (const role of roles) lines.push(row([role.key, role.scope, `\`${role.nameKey}\``, String(role.permissions.length)]));
  lines.push('', `Catalogue: ${String(catalogue.length)} permissions; ${String(roles.length)} roles.`, '');
  return lines.join('\n');
}
