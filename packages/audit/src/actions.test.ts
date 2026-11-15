import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { AUDIT_ACTIONS, type components, type operations } from '@platform/shared';

import {
  AUDIT_ACTOR_TYPES,
  AUDIT_ENTRY_ACTIONS,
  AUDIT_OUTCOMES,
  AUDIT_SOURCE_APPS,
  type AuditEntryAction,
  DENIED_ONLY_ACTIONS,
  DESCRIPTOR_ACTIONS_ARE_ENTRY_ACTIONS,
  isAuditActorType,
  isAuditEntryAction,
  isAuditOutcome,
  isAuditSourceApp,
  isPiiClassification,
  PII_CLASSIFICATIONS,
} from './actions.js';

interface LaneFile {
  readonly name: string;
  readonly sql: string;
}

/** prisma/bootstrap/*.sql in the runner's order (byte order of the names), found from the Jest working directory. */
function bootstrapLane(): LaneFile[] {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, 'prisma', 'bootstrap');
    if (existsSync(join(candidate, '10-audit.sql'))) {
      return readdirSync(candidate)
        .filter((name) => name.endsWith('.sql'))
        .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0))
        .map((name) => ({ name, sql: readFileSync(join(candidate, name), 'utf8') }));
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error('prisma/bootstrap/10-audit.sql not found above the working directory');
    dir = parent;
  }
}

/**
 * The EFFECTIVE value lists of the enum CHECKs (`CONSTRAINT <name> CHECK (<column> IN (…))`) after the lane: the files
 * are replayed in order, a `DROP CONSTRAINT [IF EXISTS] <name>` forgets a definition and a later definition replaces
 * it, so a widening file (91-audit-actions-v2.sql, TASK-285) wins over 10-audit.sql. Comments are removed first, so a
 * header that quotes a constraint cannot count. Values keep their order.
 */
function effectiveChecks(files: readonly LaneFile[]): Map<string, string[]> {
  const checks = new Map<string, string[]>();
  const event =
    /\bDROP\s+CONSTRAINT\s+(?:IF\s+EXISTS\s+)?([a-z][a-z0-9_]*)|\bCONSTRAINT\s+([a-z][a-z0-9_]*)\s+CHECK\s*\(\s*[a-z_]+\s+IN\s*\(([^)]*)\)/gi;
  for (const file of files) {
    const code = file.sql.replace(/--[^\n]*/g, '');
    for (const match of code.matchAll(event)) {
      const [, dropped, defined, list] = match;
      if (dropped !== undefined) checks.delete(dropped);
      else
        checks.set(
          defined as string,
          [...(list as string).matchAll(/'([A-Za-z_]+)'/g)].map((value) => value[1] as string),
        );
    }
  }
  return checks;
}

const lane = bootstrapLane();
const effective = effectiveChecks(lane);

describe('[US-087] audit vocabularies equal the EFFECTIVE database CHECK constraints (REQ-AUDIT-002/003/011, catalog C9)', () => {
  it.each([
    ['ck_audit_entries__action', AUDIT_ENTRY_ACTIONS],
    ['ck_audit_entries__actor_type', AUDIT_ACTOR_TYPES],
    ['ck_audit_entries__outcome', AUDIT_OUTCOMES],
    ['ck_audit_entries__source_app', AUDIT_SOURCE_APPS],
    ['ck_audit_pii_vault__classification', PII_CLASSIFICATIONS],
  ] as const)('%s (same values, same order)', (name, list) => {
    expect(effective.get(name)).toEqual([...list]);
    expect(new Set(list).size).toBe(list.length);
  });

  it('[AT-US-087-07] the 20 REQ-AUDIT-002 actions, MFA_RECOVERY_USED and SESSION_REVOKED included, come from the widening file', () => {
    expect(AUDIT_ENTRY_ACTIONS).toHaveLength(20);
    expect(AUDIT_ENTRY_ACTIONS.slice(11, 15)).toEqual(['MFA_FAILED', 'MFA_RECOVERY_USED', 'SESSION_REVOKED', 'PERMISSION_DENIED']);
    const lastDefinition = lane.filter((file) => effectiveChecks([file]).has('ck_audit_entries__action')).map((file) => file.name);
    expect(lastDefinition).toEqual(['10-audit.sql', '91-audit-actions-v2.sql']);
    // 10-audit.sql alone (released, immutable) still holds the 18 values: without the widening file the parity fails.
    const released = effectiveChecks(lane.filter((file) => file.name !== '91-audit-actions-v2.sql')).get('ck_audit_entries__action');
    expect(released).toEqual(AUDIT_ENTRY_ACTIONS.filter((action) => action !== 'MFA_RECOVERY_USED' && action !== 'SESSION_REVOKED'));
    expect(released).not.toEqual([...AUDIT_ENTRY_ACTIONS]);
  });

  it('the replay follows DROP and re-ADD in file order, ignores comments and values outside the IN list', () => {
    const create = {
      name: '10-a.sql',
      sql: "CREATE TABLE t (a text CONSTRAINT ck_t__a CHECK (a IN ('X','Y')), b int CONSTRAINT ck_t__b CHECK (b > 0));",
    };
    const widen = {
      name: '20-b.sql',
      sql: "-- CONSTRAINT ck_t__a CHECK (a IN ('COMMENT'))\nALTER TABLE t DROP CONSTRAINT IF EXISTS ck_t__a, ADD CONSTRAINT ck_t__a CHECK (a IN ('X','Y','Z'));",
    };
    const drop = { name: '30-c.sql', sql: 'ALTER TABLE t DROP CONSTRAINT ck_t__a;' };
    expect(Object.fromEntries(effectiveChecks([create]))).toEqual({ ck_t__a: ['X', 'Y'] });
    expect(Object.fromEntries(effectiveChecks([create, widen]))).toEqual({ ck_t__a: ['X', 'Y', 'Z'] });
    expect(Object.fromEntries(effectiveChecks([create, widen, drop]))).toEqual({});
  });

  it('[AT-US-087-05] an unknown action fails the type check and the run-time guard', () => {
    // @ts-expect-error -- TASK-025 'FOO' is not an audit action: the type check fails (AT-US-087-05; the database half is prisma/tests/audit).
    const foo: AuditEntryAction = 'FOO';
    expect(isAuditEntryAction(foo)).toBe(false);
    expect(isAuditEntryAction('CREATE')).toBe(true);
    expect([isAuditEntryAction('MFA_RECOVERY_USED'), isAuditEntryAction('SESSION_REVOKED')]).toEqual([true, true]);
  });

  it('every route-descriptor action other than NONE is an entry action (compile-time proof, checked at run time)', () => {
    expect(DESCRIPTOR_ACTIONS_ARE_ENTRY_ACTIONS).toBe(true);
    for (const action of AUDIT_ACTIONS.filter((value) => value !== 'NONE')) expect(isAuditEntryAction(action)).toBe(true);
  });

  it('the guards accept exactly their lists', () => {
    expect([isAuditActorType('USER'), isAuditActorType('user'), isAuditActorType(1)]).toEqual([true, false, false]);
    expect([isAuditOutcome('DENIED'), isAuditOutcome('denied')]).toEqual([true, false]);
    expect([isAuditSourceApp('worker'), isAuditSourceApp('WEB')]).toEqual([true, false]);
    expect([isPiiClassification('SENSITIVE_PERSONAL'), isPiiClassification('SECRET')]).toEqual([true, false]);
  });

  it('denials are DENIED-only actions', () => {
    expect([...DENIED_ONLY_ACTIONS].sort()).toEqual(['LOGIN_FAILED', 'PERMISSION_DENIED']);
  });
});

/**
 * Contract parity (compile time; TASK-285 card "PARITY"): every action the contract can return or filter by
 * (openapi.yaml `AuditEntry.action`, `AuditEntrySummary.action`, `listAuditEntries` `filter[action]`) is an entry
 * action. The contract still lists 18: MFA_RECOVERY_USED and SESSION_REVOKED are missing there, a change request to
 * api-designer (D-TASK285-02; contract changes are never edited in a task). The second element of each check pins that
 * gap exactly, so the regenerated packages/shared/src/api/types.gen.ts of the contract fix fails this file until the
 * expected gap is `never` (full equality).
 */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
/** [every contract value is an entry action, the entry actions the contract lacks are exactly the two new ones] */
type ContractParity<ContractAction> = [
  Same<Exclude<ContractAction, AuditEntryAction>, never>,
  Same<Exclude<AuditEntryAction, ContractAction>, 'MFA_RECOVERY_USED' | 'SESSION_REVOKED'>,
];
type ListAuditFilter = NonNullable<NonNullable<operations['listAuditEntries']['parameters']['query']>['filter']>;
const CONTRACT_PARITY: {
  readonly entry: ContractParity<components['schemas']['AuditEntry']['action']>;
  readonly summary: ContractParity<components['schemas']['AuditEntrySummary']['action']>;
  readonly filter: ContractParity<NonNullable<ListAuditFilter['action']>>;
} = { entry: [true, true], summary: [true, true], filter: [true, true] };

describe('[US-087] the contract enum and the entry vocabulary (compile-time proof, checked at run time)', () => {
  it('every contract action is an entry action; the only entry actions the contract lacks are the two new ones (D-TASK285-02)', () => {
    expect(CONTRACT_PARITY).toEqual({ entry: [true, true], summary: [true, true], filter: [true, true] });
  });
});
