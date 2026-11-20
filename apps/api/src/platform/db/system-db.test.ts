import { describe, expect, it } from '@jest/globals';

import { SYSTEM_MODELS, systemDelegates } from './system-db.js';
import { createTenantDb, SYSTEM_DELEGATES_LABEL, SYSTEM_MODEL_HINT, type TenantDb, TenantDbAccessError } from './tenant-db.js';

class FakeDelegate {
  constructor(private readonly table: string) {}
  findMany(): string {
    return `rows:${this.table}`;
  }
  aggregateRaw(): string {
    return 'mongo-only';
  }
}

/** A transaction client with one tenant model, one GLOBAL catalogue model and the SYSTEM model. */
class FakeTx {
  readonly _runtimeDataModel = { models: { Shipment: {}, Role: {}, ReferenceDatasetVersion: {} } };
  readonly shipment = new FakeDelegate('shipments');
  readonly role = new FakeDelegate('roles');
  readonly referenceDatasetVersion = new FakeDelegate('reference_dataset_versions');
  $queryRaw(): number {
    return 1;
  }
}

type Assert<T extends true> = T;
type Lacks<T, K extends PropertyKey> = K extends keyof T ? false : true;
type Has<T, K extends PropertyKey> = K extends keyof T ? true : false;
// Compile-time half of PR19-SEC-01: the SYSTEM delegate is not part of TenantDb; GLOBAL and tenant delegates are, and
// systemDelegates(tx) infers the client type from the handle and offers exactly the SYSTEM delegate.
export type SystemModelTypeChecks = [
  Assert<Lacks<TenantDb<FakeTx>, 'referenceDatasetVersion'>>,
  Assert<Has<TenantDb<FakeTx>, 'shipment'>>,
  Assert<Has<TenantDb<FakeTx>, 'role'>>,
  Assert<Has<ReturnType<typeof systemDelegates<FakeTx>>, 'referenceDatasetVersion'>>,
  Assert<Lacks<ReturnType<typeof systemDelegates<FakeTx>>, 'shipment'>>,
];

const read = (value: unknown, key: PropertyKey): unknown => (value as Record<PropertyKey, unknown>)[key];

describe('SYSTEM-model access control (PR19-SEC-01, D-ARCH-080)', () => {
  it('[PR19-SEC-01] the SYSTEM delegate is not on TenantDb: a read throws naming the systemDelegates port', () => {
    const { db } = createTenantDb(new FakeTx());
    expect(SYSTEM_MODELS).toEqual(['jobExecution', 'outboxEvent', 'processedEvent', 'referenceDatasetVersion']);
    expect(() => read(db, 'referenceDatasetVersion')).toThrow(new TenantDbAccessError('referenceDatasetVersion', SYSTEM_MODEL_HINT));
    expect(SYSTEM_MODEL_HINT).toContain('systemDelegates(tx)');
    expect('referenceDatasetVersion' in db).toBe(false);
    expect(Reflect.ownKeys(db)).toEqual(['shipment', 'role', '$queryRaw', 'markRollbackOnly', 'track', 'beforeCommit', 'contextOrgId']);
    // GLOBAL catalogue delegates stay in TenantDb (read-only by grant).
    expect(db.role.findMany()).toBe('rows:roles');
  });

  it('[PR19-SEC-01] systemDelegates(tx) reaches the SYSTEM delegate of the same transaction, guarded, and nothing else', () => {
    const { db } = createTenantDb(new FakeTx());
    const system = systemDelegates(db);
    expect(systemDelegates(db)).toBe(system);
    expect(Object.prototype.toString.call(system)).toBe(`[object ${SYSTEM_DELEGATES_LABEL}]`);
    expect(Reflect.ownKeys(system)).toEqual(['referenceDatasetVersion']);
    expect(system.referenceDatasetVersion.findMany()).toBe('rows:reference_dataset_versions');
    expect(() => read(system, 'shipment')).toThrow(new TenantDbAccessError('shipment'));
    expect(() => read(system, '$queryRaw')).toThrow(TenantDbAccessError);
    expect(() => read(system.referenceDatasetVersion, 'aggregateRaw')).toThrow(TenantDbAccessError);
    expect(read(system, 'then')).toBeUndefined();
  });

  it('[PR19-SEC-01] the SYSTEM delegates close with the handle (revoke) like every TenantDb delegate', () => {
    const handle = createTenantDb(new FakeTx());
    const system = systemDelegates(handle.db);
    const kept = system.referenceDatasetVersion;
    handle.revoke();
    expect(() => kept.findMany).toThrow('Database error: TENANT_TX_CLOSED');
    expect(() => system.referenceDatasetVersion).toThrow('Database error: TENANT_TX_CLOSED');
    expect(() => systemDelegates(handle.db).referenceDatasetVersion).toThrow('Database error: TENANT_TX_CLOSED');
  });

  it('[PR19-SEC-01] a value that is not a TenantDb handle is refused (no SYSTEM accessor from a hand-made object)', () => {
    const fake = new FakeTx() as unknown as TenantDb<FakeTx>;
    const expected = new TenantDbAccessError('systemDelegates', 'the argument is not a TenantDb handle');
    expect(() => systemDelegates(fake)).toThrow(expected);
    expect(() => systemDelegates(null as unknown as TenantDb<FakeTx>)).toThrow(expected);
  });
});
