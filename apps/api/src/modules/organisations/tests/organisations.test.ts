// Organisations rules, service and repository without a database (US-061, US-062; TASK-037). The database backstops of
// the same rules (CHECKs, unique indexes, triggers, RLS) are proven in organisations.int.test.ts.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { ROLES } from '@platform/authz';
import { ERROR_CATALOGUE, isErrorCode, OPERATOR_ORG_ID, SYSTEM_ACTOR_ID } from '@platform/shared';

import {
  assertCreatableOrgType,
  assertRoleAllowed,
  assertWritableMembershipStatus,
  assignRole,
  createOrganisation,
  createOrganisationRepository,
  createPersonalOrganisation,
  isOrganisationRefusalCode,
  isOrgType,
  membershipChange,
  MembershipNotFoundError,
  organisationDisplayName,
  ORGANISATION_NAME_MAX,
  ORGANISATION_INTERNAL_CODES,
  ORGANISATION_REFUSAL_CODES,
  ORGANISATION_RULE_CODES,
  OrganisationNotFoundError,
  type OrganisationRepository,
  OrganisationRuleError,
  organisationRuleProblemCode,
  type OrganisationsDb,
  personalOrganisationName,
  roleScopeForOrgType,
} from '../index.js';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..', '..');
const MIGRATION = join(REPO_ROOT, 'prisma', 'migrations', '20261117000000_organisations_identity', 'migration.sql');

const ORG = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';
const USER = '0193a5b2-7c1e-7d4a-9f3b-0000000000b1';
const NOW = new Date('2026-11-17T10:00:00.000Z');

type FakeRepository = OrganisationRepository & { readonly writes: string[]; roleIdByKey: OrganisationRepository['roleIdByKey'] };

/**
 * An in-memory repository recording every write; `types` answers organisationType, the context organisation is ORG
 * (or `context`), and `memberships` lists the membership ids of the context organisation.
 */
function fakeRepository(types: Record<string, string> = {}, context = ORG, memberships: readonly string[] = ['m-1']): FakeRepository {
  const writes: string[] = [];
  return {
    writes,
    contextOrgId: () => context,
    membershipOfContextOrganisation: (membershipId) => Promise.resolve(memberships.includes(membershipId)),
    insertOrganisation: (organisation) => {
      writes.push(`org ${organisation.type} ${organisation.displayName} owner=${organisation.personalOwnerUserId ?? '-'}`);
      return Promise.resolve(ORG);
    },
    organisationType: (orgId) => Promise.resolve(types[orgId]),
    insertActiveMembership: (userId) => {
      writes.push(`membership ${userId} ACTIVE`);
      return Promise.resolve('m-1');
    },
    roleIdByKey: (roleKey) => Promise.resolve(`role:${roleKey}`),
    insertMembershipRole: (membershipId, roleId, grantedBy) => {
      writes.push(`role ${membershipId} ${roleId} by=${grantedBy}`);
      return Promise.resolve('mr-1');
    },
  };
}

async function ruleCode(work: () => Promise<unknown>): Promise<string> {
  try {
    await work();
  } catch (error) {
    if (error instanceof OrganisationRuleError) return error.code;
    throw error;
  }
  return 'no error';
}

const OPERATOR_ROLE = ROLES.find((role) => role.scope === 'OPERATOR')?.key ?? '';

describe('organisation rules (REQ-ORG-001..004)', () => {
  it('maps every organisation type to the role scope it admits', () => {
    expect((['OPERATOR', 'BUSINESS_CUSTOMER', 'INDIVIDUAL', 'PARTNER'] as const).map((type) => roleScopeForOrgType(type))).toEqual([
      'OPERATOR',
      'CUSTOMER',
      'CUSTOMER',
      'PARTNER',
    ]);
    expect([isOrgType('INDIVIDUAL'), isOrgType('individual'), isOrgType(7)]).toEqual([true, false, false]);
  });

  it('[AT-US-061-02] only BUSINESS_CUSTOMER can be requested; PARTNER and OPERATOR are ORG_TYPE_NOT_ALLOWED', () => {
    expect(() => assertCreatableOrgType('BUSINESS_CUSTOMER')).not.toThrow();
    for (const type of ['PARTNER', 'OPERATOR', 'INDIVIDUAL', undefined, 'business_customer']) {
      expect(() => assertCreatableOrgType(type)).toThrow(expect.objectContaining({ code: 'ORG_TYPE_NOT_ALLOWED' }));
    }
  });

  it('[AT-US-062-02] a role is allowed only when its scope matches the organisation type', () => {
    expect(OPERATOR_ROLE).not.toBe('');
    expect(assertRoleAllowed('BUSINESS_CUSTOMER', 'CUSTOMER_VIEWER')).toBe('CUSTOMER_VIEWER');
    expect(assertRoleAllowed('INDIVIDUAL', 'CUSTOMER_OWNER')).toBe('CUSTOMER_OWNER');
    expect(assertRoleAllowed('OPERATOR', OPERATOR_ROLE)).toBe(OPERATOR_ROLE);
    for (const [type, role] of [
      ['BUSINESS_CUSTOMER', OPERATOR_ROLE],
      ['OPERATOR', 'CUSTOMER_OWNER'],
      ['PARTNER', 'CUSTOMER_OWNER'],
      ['INDIVIDUAL', 'NOT_A_ROLE'],
    ] as const) {
      expect(() => assertRoleAllowed(type, role)).toThrow(expect.objectContaining({ code: 'ROLE_NOT_ALLOWED_FOR_ORG_TYPE' }));
    }
  });

  it('[D-ARCH-123] no code path writes an INVITED membership', () => {
    for (const status of ['ACTIVE', 'SUSPENDED', 'REMOVED']) expect(() => assertWritableMembershipStatus(status)).not.toThrow();
    for (const status of ['INVITED', 'active', null]) {
      expect(() => assertWritableMembershipStatus(status)).toThrow(expect.objectContaining({ code: 'MEMBERSHIP_STATUS_NOT_WRITABLE' }));
    }
  });

  it('[PR63 R1-m2] refusal codes are catalogued 422s; MEMBERSHIP_STATUS_NOT_WRITABLE is internal-only and answers INTERNAL_ERROR', () => {
    expect([...ORGANISATION_REFUSAL_CODES]).toEqual(['ORG_TYPE_NOT_ALLOWED', 'ROLE_NOT_ALLOWED_FOR_ORG_TYPE']);
    expect([...ORGANISATION_INTERNAL_CODES]).toEqual(['MEMBERSHIP_STATUS_NOT_WRITABLE']);
    expect([...ORGANISATION_RULE_CODES]).toEqual([...ORGANISATION_REFUSAL_CODES, ...ORGANISATION_INTERNAL_CODES]);
    for (const code of ORGANISATION_REFUSAL_CODES) {
      expect([isErrorCode(code), ERROR_CATALOGUE[code].status, isOrganisationRefusalCode(code), organisationRuleProblemCode(code)]).toEqual(
        [true, 422, true, code],
      );
    }
    for (const code of ORGANISATION_INTERNAL_CODES) {
      // Internal-only (api/README.md §11): never catalogued, so never published; a route answers the generic 500.
      expect([isErrorCode(code), isOrganisationRefusalCode(code), organisationRuleProblemCode(code)]).toEqual([
        false,
        false,
        'INTERNAL_ERROR',
      ]);
    }
    const internalRow = readFileSync(join(REPO_ROOT, 'docs', '03-architecture', 'api', 'README.md'), 'utf8')
      .split('\n')
      .find((line) => line.startsWith('| Internal / start-up only |'));
    for (const code of ORGANISATION_INTERNAL_CODES) expect(internalRow).toContain(`\`${code}\``);
    const error = new OrganisationRuleError('MEMBERSHIP_STATUS_NOT_WRITABLE');
    expect([error.name, error.code, error.message]).toEqual([
      'OrganisationRuleError',
      'MEMBERSHIP_STATUS_NOT_WRITABLE',
      'MEMBERSHIP_STATUS_NOT_WRITABLE',
    ]);
  });

  it('[D-ARCH-151] the reserved operator organisation row of the migration carries OPERATOR_ORG_ID, the SYSTEM actor and type OPERATOR', () => {
    const sql = readFileSync(MIGRATION, 'utf8');
    const inserts = [
      ...sql.matchAll(/INSERT INTO "public"\."organisations" \(([^)]*)\)\s*VALUES \(([^)]*)\)\s*ON CONFLICT \("id"\) DO NOTHING;/g),
    ];
    expect(inserts).toHaveLength(1);
    const [, columns = '', values = ''] = inserts[0] ?? [];
    const names = columns.split(',').map((column) => column.trim().replaceAll('"', ''));
    const literals = values.split(',').map((value) => value.trim().replace(/^'(.*)'$/s, '$1'));
    expect(Object.fromEntries(names.map((name, index) => [name, literals[index]]))).toEqual({
      id: OPERATOR_ORG_ID,
      created_by: SYSTEM_ACTOR_ID,
      updated_by: SYSTEM_ACTOR_ID,
      type: 'OPERATOR',
      display_name: 'Operator',
    });
    // Before ENABLE + FORCE (the migrator has no policy on organisations afterwards) and after the single-operator index.
    const at = sql.indexOf(inserts[0]?.[0] ?? '');
    expect(at).toBeGreaterThan(sql.indexOf('CREATE UNIQUE INDEX "ux_organisations__single_operator"'));
    expect(at).toBeLessThan(sql.indexOf('ENABLE ROW LEVEL SECURITY'));
  });

  it('[AT-US-062-01] a personal organisation is named after the user (NFC, trimmed, at most 120 characters)', () => {
    expect(personalOrganisationName('  Asha Rao ')).toBe('Asha Rao');
    expect(personalOrganisationName('x'.repeat(150))).toHaveLength(120);
    expect(() => personalOrganisationName('   ')).toThrow(TypeError);
  });

  it('[R1-n2] a display name is cut at 120 code points, never inside a surrogate pair, NFC-normalised and re-trimmed on both paths', () => {
    const emoji = '\u{1F600}'; // two UTF-16 units, one code point
    const cut = organisationDisplayName(`${'x'.repeat(119)}${emoji}${emoji}`);
    expect(Array.from(cut)).toHaveLength(ORGANISATION_NAME_MAX);
    expect(cut.endsWith(emoji)).toBe(true);
    expect(organisationDisplayName(`${'y'.repeat(119)} tail`)).toBe('y'.repeat(119));
    expect(organisationDisplayName('Café ')).toBe('Café');
    expect(personalOrganisationName('Café')).toBe(organisationDisplayName('Café'));
  });

  it('[AT-US-062-06] a membership change records old/new status and the role-set diff', () => {
    expect(membershipChange(null, { status: 'ACTIVE', roles: ['CUSTOMER_VIEWER'] })).toEqual({
      old_status: null,
      new_status: 'ACTIVE',
      roles_added: ['CUSTOMER_VIEWER'],
      roles_removed: [],
    });
    expect(
      membershipChange(
        { status: 'ACTIVE', roles: ['CUSTOMER_VIEWER', 'CUSTOMER_SHIPPER'] },
        { status: 'SUSPENDED', roles: ['CUSTOMER_ADMIN', 'CUSTOMER_SHIPPER'] },
      ),
    ).toEqual({ old_status: 'ACTIVE', new_status: 'SUSPENDED', roles_added: ['CUSTOMER_ADMIN'], roles_removed: ['CUSTOMER_VIEWER'] });
  });
});

describe('organisations service (one tenant transaction per call)', () => {
  it('[AT-US-062-01] registration: an INDIVIDUAL organisation named after the user, one ACTIVE membership holding Owner', async () => {
    const repo = fakeRepository();
    const created = await createPersonalOrganisation(repo, { userId: USER, displayName: 'Asha Rao', locale: 'en', now: NOW });
    expect(created).toEqual({ organisationId: ORG, membershipId: 'm-1' });
    expect(repo.writes).toEqual([
      `org INDIVIDUAL Asha Rao owner=${USER}`,
      `membership ${USER} ACTIVE`,
      `role m-1 role:CUSTOMER_OWNER by=${USER}`,
    ]);
    await expect(createPersonalOrganisation(fakeRepository(), { userId: USER, displayName: 'B', locale: 'fr' })).resolves.toBeDefined();
  });

  it('[AT-US-061-02] a PARTNER or OPERATOR organisation is refused with ORG_TYPE_NOT_ALLOWED and nothing is written', async () => {
    for (const type of ['PARTNER', 'OPERATOR']) {
      const repo = fakeRepository();
      expect(await ruleCode(() => createOrganisation(repo, { type, displayName: 'Acme', locale: 'en', ownerUserId: USER }))).toBe(
        'ORG_TYPE_NOT_ALLOWED',
      );
      expect(repo.writes).toEqual([]);
    }
    const repo = fakeRepository();
    await createOrganisation(repo, { type: 'BUSINESS_CUSTOMER', displayName: ' Acme ', locale: 'en', ownerUserId: USER, now: NOW });
    expect(repo.writes).toEqual([
      'org BUSINESS_CUSTOMER Acme owner=-',
      `membership ${USER} ACTIVE`,
      `role m-1 role:CUSTOMER_OWNER by=${USER}`,
    ]);
    await expect(
      createOrganisation(fakeRepository(), { type: 'BUSINESS_CUSTOMER', displayName: 'X', locale: 'en', ownerUserId: USER }),
    ).resolves.toBeDefined();
  });

  it('[AT-US-062-02] assigning an operator role in a BUSINESS_CUSTOMER organisation is refused; no membership role changes', async () => {
    const repo = fakeRepository({ [ORG]: 'BUSINESS_CUSTOMER' });
    expect(await ruleCode(() => assignRole(repo, { membershipId: 'm-1', roleKey: OPERATOR_ROLE, grantedBy: USER }))).toBe(
      'ROLE_NOT_ALLOWED_FOR_ORG_TYPE',
    );
    expect(repo.writes).toEqual([]);
    expect(await assignRole(repo, { membershipId: 'm-1', roleKey: 'CUSTOMER_FINANCE', grantedBy: USER })).toBe('mr-1');
    expect(repo.writes).toEqual([`role m-1 role:CUSTOMER_FINANCE by=${USER}`]);
  });

  it('[R1-m1] assignRole uses the context organisation and refuses a membership of another organisation as not found; nothing is written', async () => {
    const input = { membershipId: 'm-of-b', roleKey: 'CUSTOMER_VIEWER', grantedBy: USER };
    // The membership id is a visible membership of another organisation (e.g. the actor's own, via own_read).
    const repo = fakeRepository({ [ORG]: 'BUSINESS_CUSTOMER' }, ORG, ['m-1']);
    await expect(assignRole(repo, input)).rejects.toThrow(MembershipNotFoundError);
    expect(repo.writes).toEqual([]);
    // The type checked is the context organisation's: a PARTNER context refuses a customer role whatever the caller says.
    const partner = fakeRepository({ [ORG]: 'PARTNER' }, ORG, ['m-1']);
    expect(await ruleCode(() => assignRole(partner, { ...input, membershipId: 'm-1' }))).toBe('ROLE_NOT_ALLOWED_FOR_ORG_TYPE');
    // No context organisation: not found, and the repository is not asked about any organisation.
    const none = fakeRepository({ '': 'BUSINESS_CUSTOMER' }, '', ['m-1']);
    await expect(assignRole(none, { ...input, membershipId: 'm-1' })).rejects.toThrow(OrganisationNotFoundError);
    expect([...partner.writes, ...none.writes]).toEqual([]);
  });

  it('an organisation that is absent or hidden by RLS is not found; a role missing from the catalogue table is refused', async () => {
    const input = { membershipId: 'm-1', roleKey: 'CUSTOMER_VIEWER', grantedBy: USER };
    await expect(assignRole(fakeRepository(), input)).rejects.toThrow(OrganisationNotFoundError);
    await expect(assignRole(fakeRepository({ [ORG]: 'SOMETHING' }), input)).rejects.toThrow(OrganisationNotFoundError);
    const repo = fakeRepository({ [ORG]: 'BUSINESS_CUSTOMER' });
    repo.roleIdByKey = () => Promise.resolve(undefined);
    expect(await ruleCode(() => assignRole(repo, input))).toBe('ROLE_NOT_ALLOWED_FOR_ORG_TYPE');
    expect(repo.writes).toEqual([]);
  });
});

describe('organisations repository (TenantDb delegates)', () => {
  it('writes business columns only (the extension stamps id, org and actor) and reads through the delegates', async () => {
    const calls: unknown[] = [];
    const record = (name: string, value: unknown, result: unknown): Promise<unknown> => {
      calls.push([name, value]);
      return Promise.resolve(result);
    };
    const db = {
      organisation: {
        create: (args: { data: unknown }) => record('organisation.create', args.data, { id: ORG }),
        findUnique: (args: { where: { id: string } }) =>
          record('organisation.findUnique', args.where, args.where.id === ORG ? { type: 'INDIVIDUAL' } : null),
      },
      membership: { create: (args: { data: unknown }) => record('membership.create', args.data, { id: 'm-1' }) },
      membershipRole: { create: (args: { data: unknown }) => record('membershipRole.create', args.data, { id: 'mr-1' }) },
      role: {
        findUnique: (args: { where: { key: string } }) => Promise.resolve(args.where.key === 'CUSTOMER_OWNER' ? { id: 'r-1' } : null),
      },
    };
    const repo = createOrganisationRepository(db as unknown as OrganisationsDb);
    expect(await repo.insertOrganisation({ type: 'INDIVIDUAL', displayName: 'A', defaultLocale: 'en', personalOwnerUserId: USER })).toBe(
      ORG,
    );
    expect(await repo.insertOrganisation({ type: 'BUSINESS_CUSTOMER', displayName: 'B', defaultLocale: 'es' })).toBe(ORG);
    expect([await repo.organisationType(ORG), await repo.organisationType(USER)]).toEqual(['INDIVIDUAL', undefined]);
    expect(await repo.insertActiveMembership(USER, NOW)).toBe('m-1');
    expect([await repo.roleIdByKey('CUSTOMER_OWNER'), await repo.roleIdByKey('X')]).toEqual(['r-1', undefined]);
    expect(await repo.insertMembershipRole('m-1', 'r-1', USER)).toBe('mr-1');
    expect(calls).toEqual([
      ['organisation.create', { type: 'INDIVIDUAL', displayName: 'A', defaultLocale: 'en', personalOwnerUserId: USER }],
      ['organisation.create', { type: 'BUSINESS_CUSTOMER', displayName: 'B', defaultLocale: 'es' }],
      ['organisation.findUnique', { id: ORG }],
      ['organisation.findUnique', { id: USER }],
      ['membership.create', { userId: USER, status: 'ACTIVE', activatedAt: NOW }],
      ['membershipRole.create', { membershipId: 'm-1', roleId: 'r-1', grantedBy: USER }],
    ]);
  });

  it('[R1-m1] resolves a membership with an explicit filter on the context organisation; no context finds nothing', async () => {
    const wheres: unknown[] = [];
    let context = ORG;
    const db = {
      contextOrgId: () => context,
      membership: {
        findFirst: (args: { where: { id: string; orgId: string } }) => {
          wheres.push(args.where);
          return Promise.resolve(args.where.id === 'm-1' && args.where.orgId === ORG ? { id: 'm-1' } : null);
        },
      },
    };
    const repo = createOrganisationRepository(db as unknown as OrganisationsDb);
    expect(repo.contextOrgId()).toBe(ORG);
    expect([await repo.membershipOfContextOrganisation('m-1'), await repo.membershipOfContextOrganisation('m-2')]).toEqual([true, false]);
    context = '';
    expect(await repo.membershipOfContextOrganisation('m-1')).toBe(false);
    expect(wheres).toEqual([
      { id: 'm-1', orgId: ORG },
      { id: 'm-2', orgId: ORG },
    ]);
  });
});
