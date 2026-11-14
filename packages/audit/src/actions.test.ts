import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { AUDIT_ACTIONS } from '@platform/shared';

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

/** prisma/bootstrap/10-audit.sql, found from the Jest working directory (the repository root or below it). */
function bootstrapSql(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, 'prisma', 'bootstrap', '10-audit.sql');
    if (existsSync(candidate)) return readFileSync(candidate, 'utf8');
    const parent = dirname(dir);
    if (parent === dir) throw new Error('prisma/bootstrap/10-audit.sql not found above the working directory');
    dir = parent;
  }
}

/** The quoted values of the `IN (…)` list of the CHECK constraint `name`. */
function checkList(sql: string, name: string): string[] {
  const start = sql.indexOf(`CONSTRAINT ${name}`);
  if (start < 0) throw new Error(`${name} not found`);
  const open = sql.indexOf('IN (', start);
  const close = sql.indexOf(')', open);
  return [...sql.slice(open, close).matchAll(/'([A-Za-z_]+)'/g)].map((match) => match[1] as string).sort();
}

const sorted = (list: readonly string[]): string[] => [...list].sort();

describe('[US-087] audit vocabularies equal the database CHECK constraints (REQ-AUDIT-002/003/011, catalog C9)', () => {
  const sql = bootstrapSql();

  it.each([
    ['ck_audit_entries__action', AUDIT_ENTRY_ACTIONS],
    ['ck_audit_entries__actor_type', AUDIT_ACTOR_TYPES],
    ['ck_audit_entries__outcome', AUDIT_OUTCOMES],
    ['ck_audit_entries__source_app', AUDIT_SOURCE_APPS],
    ['ck_audit_pii_vault__classification', PII_CLASSIFICATIONS],
  ] as const)('%s', (name, list) => {
    expect(sorted(list)).toEqual(checkList(sql, name));
    expect(new Set(list).size).toBe(list.length);
  });

  it('[AT-US-087-05] an unknown action fails the type check and the run-time guard', () => {
    // @ts-expect-error -- TASK-025 'FOO' is not an audit action: the type check fails (AT-US-087-05; the database half is prisma/tests/audit).
    const foo: AuditEntryAction = 'FOO';
    expect(isAuditEntryAction(foo)).toBe(false);
    expect(isAuditEntryAction('CREATE')).toBe(true);
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
