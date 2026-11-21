/**
 * Host unit test of the C16 and P9-CK finding rules of ./tenant-keys.ts with row fixtures (TASK-051 brief scope note 4;
 * rulings/wave-1-r-arch-34-operator-rulings.md §2.6, §8.1 to §8.3; D-ARCH-162, D-ARCH-163, D-ARCH-207 to D-ARCH-209;
 * SEC-TC-76). Every rule and every exception path is driven here, so the logic is proven before lane B runs the catalog
 * SQL in c16-tenant-keys.int.test.ts.
 */
import { describe, expect, it } from '@jest/globals';

import {
  PLANT_GUEST_REFERENCES,
  PLANT_GUEST_UNIQUE_INDEXES,
  PLANT_REFERENCES,
  PLANT_UNIQUE_INDEXES,
  PLANTED_GUEST_REFERENCE_FINDINGS,
  PLANTED_GUEST_UNIQUE_FINDINGS,
  PLANTED_REFERENCE_FINDINGS,
  PLANTED_UNIQUE_FINDINGS,
  TENANT_REFERENCE_EXCEPTIONS,
  TENANT_UNIQUE_EXCEPTIONS,
  checkNameFindings,
  exceptionCheckNames,
  orgOnlyCheckDefinition,
  ownerColumnCounts,
  referenceExceptionFindings,
  referenceViolations,
  tenantReferenceFindings,
  tenantUniqueFindings,
  uniqueExceptionFindings,
  uniqueScope,
  type OwnerKeyColumn,
  type ReferenceException,
  type TenantCheck,
  type TenantReference,
  type TenantUniqueIndex,
} from './tenant-keys.js';

const REST = 'parent_id=id';

/** A T1 org-bound key by default; `over` turns it into the shape under test. */
const ref = (conname: string, over: Partial<TenantReference> = {}): TenantReference => ({
  conname,
  child: 'child',
  parent: 'parent',
  child_org_not_null: true,
  child_guest_capable: false,
  org_bound: true,
  guest_bound: false,
  rest: REST,
  ...over,
});
const t2n = (conname: string, over: Partial<TenantReference> = {}): TenantReference => ref(conname, { child_org_not_null: false, ...over });
const t2g = (conname: string, over: Partial<TenantReference> = {}): TenantReference =>
  ref(conname, { child_org_not_null: false, child_guest_capable: true, ...over });
const single = { org_bound: false, guest_bound: false } as const;
const guestKey = { org_bound: false, guest_bound: true } as const;

const names = (findings: readonly string[]): string[] => findings.map((finding) => finding.split(/[: ]/)[0] ?? '').sort();
const NONE: ReadonlyMap<string, ReferenceException> = new Map();

describe('C16 (a) rules over fixture rows (rulings §2.6; D-ARCH-154, D-ARCH-162)', () => {
  it('[SEC-TC-76] T1: an org-bound key passes; a single-column key is reported, also beside a composite sibling', () => {
    expect(tenantReferenceFindings([ref('fk_ok')], NONE)).toEqual([]);
    expect(tenantReferenceFindings([ref('fk_single', single), ref('fk_composite')], NONE)).toEqual([
      'fk_single: child -> parent is not bound through org_id (T1)',
    ]);
  });

  it('[SEC-TC-76] T2-N: an org-bound key passes; a single-column key passes only beside an org-bound sibling of the same table pair and rest', () => {
    expect(tenantReferenceFindings([t2n('fk_composite')], NONE)).toEqual([]);
    expect(tenantReferenceFindings([t2n('fk_single', single), t2n('fk_composite')], NONE)).toEqual([]);
    const alone = 'fk_single: child -> parent is not bound through org_id and has no org-bound sibling (T2-N)';
    expect(tenantReferenceFindings([t2n('fk_single', single)], NONE)).toEqual([alone]);
    expect(tenantReferenceFindings([t2n('fk_single', single), t2n('fk_composite', { rest: 'other_id=id' })], NONE)).toEqual([alone]);
    expect(tenantReferenceFindings([t2n('fk_single', single), t2n('fk_composite', { parent: 'elsewhere' })], NONE)).toEqual([alone]);
    expect(tenantReferenceFindings([t2n('fk_single', single), t2n('fk_composite', { child: 'elsewhere' })], NONE)).toEqual([alone]);
  });

  it('[SEC-TC-76] [D-ARCH-162] T2-G: the owner-bound pair passes; a single-column key beside it is reported', () => {
    const pair = [t2g('fk_org'), t2g('fk_guest', guestKey)];
    expect(tenantReferenceFindings(pair, NONE)).toEqual([]);
    expect(tenantReferenceFindings([...pair, t2g('fk_single', single)], NONE)).toEqual([
      'fk_single: child -> parent is not owner-bound: neither org_id nor guest_token_hash at the same key position on both sides (T2-G)',
    ]);
  });

  it('[SEC-TC-76] [D-ARCH-162] T2-G: an org-bound key alone and a guest-bound key alone are reported; a sibling must share table pair and rest', () => {
    expect(tenantReferenceFindings([t2g('fk_org')], NONE)).toEqual([
      'fk_org: child -> parent is org-bound without a guest-bound sibling (T2-G; a T2-O key needs an exception entry)',
    ]);
    expect(tenantReferenceFindings([t2g('fk_guest', guestKey)], NONE)).toEqual([
      'fk_guest: child -> parent is guest-bound without an org-bound sibling (T2-G)',
    ]);
    expect(names(tenantReferenceFindings([t2g('fk_org'), t2g('fk_guest', { ...guestKey, rest: 'other_id=id' })], NONE))).toEqual([
      'fk_guest',
      'fk_org',
    ]);
    expect(names(tenantReferenceFindings([t2g('fk_org'), t2g('fk_guest', { ...guestKey, parent: 'elsewhere' })], NONE))).toEqual([
      'fk_guest',
      'fk_org',
    ]);
  });

  it('[SEC-TC-76] [D-ARCH-207] T2-G: a key holding both owner columns is reported and is the sibling of no key', () => {
    expect(tenantReferenceFindings([t2g('fk_both', { guest_bound: true })], NONE)).toEqual([
      'fk_both: child -> parent holds both owner columns, so the owner CHECK leaves it unchecked on every row (T2-G)',
    ]);
    // Beside a both-bound key, a lone org-bound key still has no guest-bound sibling, and a lone guest-bound key no
    // org-bound sibling.
    expect(names(tenantReferenceFindings([t2g('fk_both', { guest_bound: true }), t2g('fk_org')], NONE))).toEqual(['fk_both', 'fk_org']);
    expect(names(tenantReferenceFindings([t2g('fk_both', { guest_bound: true }), t2g('fk_guest', guestKey)], NONE))).toEqual([
      'fk_both',
      'fk_guest',
    ]);
    expect(referenceViolations([t2g('fk_both', { guest_bound: true })]).map((violation) => violation.kind)).toEqual(['both-owners']);
  });

  it('[SEC-TC-76] the committed exception map holds T2-O entries only when ruled: today it is empty and therefore live on any rows', () => {
    expect(TENANT_REFERENCE_EXCEPTIONS.size).toBe(0);
    expect(exceptionCheckNames()).toEqual([]);
    expect(referenceExceptionFindings([])).toEqual([]);
    expect(referenceViolations([])).toEqual([]);
  });
});

describe('C16 (a) T2-O entries name their CHECK (rulings §8.3; D-ARCH-209)', () => {
  const COLUMN = 'requote_of_quote_id';
  /** The T2-O key (org_id plus one other column) and a compliant pair of the same table. */
  const rows = [
    t2g('fk_requote', { rest: `${COLUMN}=id` }),
    t2g('fk_org', { rest: 'quote_id=id' }),
    t2g('fk_guest', { ...guestKey, rest: 'quote_id=id' }),
  ];
  const CHECK_NAME = 'ck_child__requote_org_only';
  const entry = (conname: string, check = CHECK_NAME): ReadonlyMap<string, ReferenceException> =>
    new Map([[conname, { check, reason: 'only organisation rows re-quote' }]]);
  const check = (over: Partial<TenantCheck> = {}): TenantCheck => ({
    conname: CHECK_NAME,
    table: 'child',
    contype: 'c',
    validated: true,
    definition: orgOnlyCheckDefinition(COLUMN),
    ...over,
  });
  const REPORTED = 'fk_requote: child -> parent is org-bound without a guest-bound sibling (T2-G; a T2-O key needs an exception entry)';

  it('[SEC-TC-76] [D-ARCH-209] the predicate text is the one pg_get_constraintdef prints for c IS NULL OR org_id IS NOT NULL', () => {
    expect(orgOnlyCheckDefinition('parent_id')).toBe('CHECK (((parent_id IS NULL) OR (org_id IS NOT NULL)))');
    expect(exceptionCheckNames(new Map([...entry('fk_a', 'ck_b'), ...entry('fk_c', 'ck_a'), ...entry('fk_d', 'ck_a')]))).toEqual([
      'ck_a',
      'ck_b',
    ]);
  });

  it('[SEC-TC-76] [D-ARCH-209] an entry with its validated CHECK hides the org-only key and is live', () => {
    expect(tenantReferenceFindings(rows, NONE)).toEqual([REPORTED]);
    expect(tenantReferenceFindings(rows, entry('fk_requote'), [check()])).toEqual([]);
    expect(referenceExceptionFindings(rows, entry('fk_requote'), [check()])).toEqual([]);
  });

  it.each([
    ['no CHECK rows at all', [], 'names ck_child__requote_org_only, which child does not carry'],
    ['the CHECK on another table', [check({ table: 'other' })], 'names ck_child__requote_org_only, which child does not carry'],
    ['a constraint of another type', [check({ contype: 'u' })], 'names ck_child__requote_org_only, which is not a CHECK (contype u)'],
    ['a CHECK that is not validated', [check({ validated: false })], 'names ck_child__requote_org_only, which is not validated'],
    [
      'the predicate c IS NULL OR org_id IS NULL',
      [check({ definition: `CHECK (((${COLUMN} IS NULL) OR (org_id IS NULL)))` })],
      `names ck_child__requote_org_only, whose definition CHECK (((${COLUMN} IS NULL) OR (org_id IS NULL))) is not ${orgOnlyCheckDefinition(COLUMN)}`,
    ],
    [
      'the predicate NOT VALID',
      [check({ validated: false, definition: `${orgOnlyCheckDefinition(COLUMN)} NOT VALID` })],
      'names ck_child__requote_org_only, which is not validated',
    ],
    [
      'the predicate over another column',
      [check({ definition: orgOnlyCheckDefinition('quote_id') })],
      `names ck_child__requote_org_only, whose definition ${orgOnlyCheckDefinition('quote_id')} is not ${orgOnlyCheckDefinition(COLUMN)}`,
    ],
  ] as const)('[SEC-TC-76] [D-ARCH-209] %s: the key stays reported and the entry is reported', (_case, checks, defect) => {
    expect(tenantReferenceFindings(rows, entry('fk_requote'), checks)).toEqual([REPORTED]);
    expect(referenceExceptionFindings(rows, entry('fk_requote'), checks)).toEqual([`fk_requote: exception entry ${defect}`]);
  });

  it.each([
    [
      'a single-column key',
      t2g('fk_x', single),
      'names a key reported as not-owner-bound, not as org-bound without a guest-bound sibling (T2-O only)',
    ],
    [
      'a guest-bound key alone',
      t2g('fk_x', guestKey),
      'names a key reported as guest-only, not as org-bound without a guest-bound sibling (T2-O only)',
    ],
    [
      'a key holding both owner columns',
      t2g('fk_x', { guest_bound: true }),
      'names a key reported as both-owners, not as org-bound without a guest-bound sibling (T2-O only)',
    ],
    [
      'a T1 key that is not owner-bound',
      ref('fk_x', single),
      'names a key reported as not-org-bound, not as org-bound without a guest-bound sibling (T2-O only)',
    ],
    [
      'an org-only key over org_id and two other columns',
      t2g('fk_x', { rest: `${COLUMN}=id,seq=seq` }),
      'names a key whose referencing columns are not org_id and exactly one other column (T2-O only)',
    ],
    [
      'an org-only key over org_id alone',
      t2g('fk_x', { rest: '' }),
      'names a key whose referencing columns are not org_id and exactly one other column (T2-O only)',
    ],
  ] as const)(
    '[SEC-TC-76] [D-ARCH-209] an entry naming %s hides nothing and is reported, even with a valid CHECK',
    (_case, row, defect) => {
      const checks = [check({ definition: orgOnlyCheckDefinition(COLUMN) })];
      expect(names(tenantReferenceFindings([row], entry('fk_x'), checks))).toEqual(['fk_x']);
      expect(referenceExceptionFindings([row], entry('fk_x'), checks)).toEqual([`fk_x: exception entry ${defect}`]);
    },
  );

  it('[SEC-TC-76] [D-ARCH-162] an entry for a compliant or missing key is not live', () => {
    const stale = new Map([...entry('fk_org'), ...entry('fk_gone')]);
    expect(referenceExceptionFindings(rows, stale, [check()])).toEqual([
      'fk_org: exception entry names no reported key',
      'fk_gone: exception entry names no reported key',
    ]);
    expect(tenantReferenceFindings(rows, stale, [check()])).toEqual([REPORTED]);
  });
});

const owner = (column: string, over: Partial<OwnerKeyColumn> = {}): OwnerKeyColumn => ({
  column,
  not_null: false,
  equality: null,
  ...over,
});

/** A NULLS DISTINCT unique index of a scoped table with a nullable `org_id` key column by default. */
const ux = (index: string, over: Partial<TenantUniqueIndex> = {}): TenantUniqueIndex => ({
  index,
  table: 'quotes',
  kind: 'unique',
  nulls_not_distinct: false,
  owner_columns: [owner('org_id')],
  ...over,
});
const ex = (index: string, columns: readonly OwnerKeyColumn[]): TenantUniqueIndex =>
  ux(index, { kind: 'exclusion', owner_columns: columns });

describe('C16 (b) rules over fixture rows (rulings §2.6, §8.2; PR65-SEC-01, D-ARCH-163, D-ARCH-208)', () => {
  it('[SEC-TC-76] [D-ARCH-163] a unique index or an exclusion constraint without an owner key column is reported, with its kind; one with an owner column is not', () => {
    const rows = [
      ux('ux_owner'),
      ex('ex_owner', [owner('org_id', { equality: true })]),
      ux('ux_code', { owner_columns: [] }),
      ux('ex_code', { kind: 'exclusion', owner_columns: [] }),
    ];
    expect(tenantUniqueFindings(rows, new Map())).toEqual([
      'ux_code (unique) on quotes has no owner column (org_id or guest_token_hash) among its key columns (PR65-SEC-01)',
      'ex_code (exclusion) on quotes has no owner column (org_id or guest_token_hash) among its key columns (PR65-SEC-01)',
    ]);
  });

  it('[SEC-TC-76] [D-ARCH-208] B1: a nullable owner column counts only under NULLS DISTINCT; a NOT NULL one counts either way', () => {
    const nnd = { nulls_not_distinct: true } as const;
    expect(tenantUniqueFindings([ux('ux_guest_nnd', { ...nnd, owner_columns: [owner('guest_token_hash')] })], new Map())).toEqual([
      'ux_guest_nnd (unique) on quotes has no owner column that separates owners: guest_token_hash is nullable under NULLS NOT DISTINCT (D-ARCH-208)',
    ]);
    expect(names(tenantUniqueFindings([ux('ux_org_nnd', nnd)], new Map()))).toEqual(['ux_org_nnd']);
    // Over both nullable owner columns: reported (fail closed; U2 asks for two NULLS DISTINCT indexes).
    expect(
      tenantUniqueFindings([ux('ux_both_nnd', { ...nnd, owner_columns: [owner('org_id'), owner('guest_token_hash')] })], new Map()),
    ).toEqual([
      'ux_both_nnd (unique) on quotes has no owner column that separates owners: org_id is nullable under NULLS NOT DISTINCT; guest_token_hash is nullable under NULLS NOT DISTINCT (D-ARCH-208)',
    ]);
    // Passing: NULLS DISTINCT on nullable owner columns, and NULLS NOT DISTINCT on a NOT NULL org_id (a TENANT table).
    expect(tenantUniqueFindings([ux('ux_org'), ux('ux_guest', { owner_columns: [owner('guest_token_hash')] })], new Map())).toEqual([]);
    expect(
      tenantUniqueFindings([ux('ux_tenant_nnd', { ...nnd, owner_columns: [owner('org_id', { not_null: true })] })], new Map()),
    ).toEqual([]);
  });

  it('[SEC-TC-76] [D-ARCH-208] B2: an exclusion owner column counts only with a btree equality operator; NOT NULL does not rescue another operator', () => {
    expect(tenantUniqueFindings([ex('ex_org_ne', [owner('org_id', { equality: false })])], new Map())).toEqual([
      'ex_org_ne (exclusion) on quotes has no owner column that separates owners: org_id is compared by an operator that is not btree equality (D-ARCH-208)',
    ]);
    expect(names(tenantUniqueFindings([ex('ex_tenant_ne', [owner('org_id', { not_null: true, equality: false })])], new Map()))).toEqual([
      'ex_tenant_ne',
    ]);
    // An exclusion row whose equality fact is missing is not trusted (fail closed).
    expect(names(tenantUniqueFindings([ex('ex_unknown', [owner('org_id', { not_null: true })])], new Map()))).toEqual(['ex_unknown']);
    expect(tenantUniqueFindings([ex('ex_org_eq', [owner('org_id', { equality: true })])], new Map())).toEqual([]);
    // One owner column that counts is enough: <> on org_id beside = on guest_token_hash stays inside one owner (Q2g).
    expect(
      tenantUniqueFindings(
        [ex('ex_mixed', [owner('org_id', { equality: false }), owner('guest_token_hash', { equality: true })])],
        new Map(),
      ),
    ).toEqual([]);
    expect(ownerColumnCounts(ex('ex_mixed', []), owner('org_id', { equality: false }))).toBe(false);
    expect(ownerColumnCounts(ux('ux_any'), owner('org_id'))).toBe(true);
  });

  it('[SEC-TC-76] [D-ARCH-163] [D-ARCH-208] an exception entry hides only an index with no owner key column; an entry naming an index whose owner column does not count hides nothing and is not live', () => {
    const rows = [
      ux('ux_digest', { owner_columns: [] }),
      ux('ux_owner'),
      ux('ux_guest_nnd', { nulls_not_distinct: true, owner_columns: [owner('guest_token_hash')] }),
    ];
    const map = new Map([['ux_digest', 'global digest']]);
    expect(names(tenantUniqueFindings(rows, map))).toEqual(['ux_guest_nnd']);
    expect(uniqueExceptionFindings(rows, map)).toEqual([]);
    const wrong = new Map([
      ['ux_owner', 'compliant'],
      ['ux_gone', 'missing'],
      ['ux_guest_nnd', 'holds a non-separating owner column'],
    ]);
    expect(uniqueExceptionFindings(rows, wrong)).toEqual([
      'ux_owner: exception entry names no owner-free unique key in scope',
      'ux_gone: exception entry names no owner-free unique key in scope',
      'ux_guest_nnd: exception entry names no owner-free unique key in scope',
    ]);
    expect(names(tenantUniqueFindings(rows, wrong))).toEqual(['ux_digest', 'ux_guest_nnd']);
  });

  it('[SEC-TC-76] the committed exception map names the invitation token digest only, and its default use reports a missing index', () => {
    expect([...TENANT_UNIQUE_EXCEPTIONS.keys()]).toEqual(['ux_invitations__token_hash']);
    expect(uniqueExceptionFindings([])).toEqual(['ux_invitations__token_hash: exception entry names no owner-free unique key in scope']);
    expect(tenantUniqueFindings([ux('ux_invitations__token_hash', { table: 'invitations', owner_columns: [] })])).toEqual([]);
  });

  it('[SEC-TC-76] [D-ARCH-163] the scope is the TENANT and GUEST_CAPABLE tables, sorted; USER_OWNED, GLOBAL and SYSTEM tables are out', () => {
    expect(
      uniqueScope([
        { name: 'quotes', class: 'GUEST_CAPABLE' },
        { name: 'tokens', class: 'USER_OWNED' },
        { name: 'countries', class: 'GLOBAL' },
        { name: 'audit_entries', class: 'SYSTEM' },
        { name: 'invitations', class: 'TENANT' },
      ]),
    ).toEqual(['invitations', 'quotes']);
  });
});

describe('P9-CK rule over fixture rows (PR #66 R1-n2)', () => {
  it('[PR #66 R1-n2] a ck_ constraint that is not a CHECK is reported with its contype; a CHECK is not', () => {
    expect(
      checkNameFindings([
        { conname: 'ck_t__a', contype: 'c', owner: 'public.t' },
        { conname: 'ck_t__b', contype: 'u', owner: 'public.t' },
      ]),
    ).toEqual(['ck_t__b on public.t has contype u, not c (CHECK)']);
  });
});

describe('planted probes stay consistent with their expected findings', () => {
  it.each([
    ['PLANT_REFERENCES', PLANT_REFERENCES, PLANTED_REFERENCE_FINDINGS],
    ['PLANT_GUEST_REFERENCES', PLANT_GUEST_REFERENCES, PLANTED_GUEST_REFERENCE_FINDINGS],
    ['PLANT_UNIQUE_INDEXES', [...PLANT_REFERENCES, ...PLANT_UNIQUE_INDEXES], PLANTED_UNIQUE_FINDINGS],
    ['PLANT_GUEST_UNIQUE_INDEXES', [...PLANT_GUEST_REFERENCES, ...PLANT_GUEST_UNIQUE_INDEXES], PLANTED_GUEST_UNIQUE_FINDINGS],
  ] as const)('%s: every expected finding names an object the probe creates, sorted and unique', (_name, statements, findings) => {
    const text = statements.join('\n');
    for (const name of findings) expect(text).toContain(` ${name} `);
    expect([...findings]).toEqual([...new Set(findings)].sort());
  });

  it('[D-ARCH-208] the five planted shapes of rulings §8.2 are present: three reported on the guest-capable parent, one on the TENANT parent, two controls', () => {
    const guest = PLANT_GUEST_UNIQUE_INDEXES.join('\n');
    expect(guest).toContain('ON public.c16_gparent (guest_token_hash, code) NULLS NOT DISTINCT');
    expect(guest).toContain('ON public.c16_gparent (org_id, code) NULLS NOT DISTINCT');
    expect(guest).toContain('c16_gex_org_ne_code EXCLUDE USING gist (org_id WITH <>, code WITH =)');
    expect(guest).toContain('c16_gex_gist_org_code EXCLUDE USING gist (org_id WITH =, code WITH =)');
    const tenant = PLANT_UNIQUE_INDEXES.join('\n');
    expect(tenant).toContain('c16_ux_org_code_nnd ON public.c16_parent (org_id, code) NULLS NOT DISTINCT');
    expect(tenant).toContain('c16_ex_org_ne_code EXCLUDE USING gist (org_id WITH <>, code WITH =)');
    expect(PLANTED_GUEST_UNIQUE_FINDINGS).not.toContain('c16_gex_gist_org_code');
    expect(PLANTED_UNIQUE_FINDINGS).not.toContain('c16_ux_org_code_nnd');
    expect(PLANTED_GUEST_REFERENCE_FINDINGS).toContain('c16_g_both_parent');
  });
});
