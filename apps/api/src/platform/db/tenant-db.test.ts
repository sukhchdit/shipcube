import { describe, expect, it } from '@jest/globals';

import { DbError } from './map-db-error.js';
import { createTenantDb, TENANT_DB_OMITTED, type TenantDb, TenantDbAccessError } from './tenant-db.js';

class FakeTx {
  readonly #secret = 'internal';
  readonly shipment = { findMany: (): string => 'rows' };
  readonly _originalClient = { root: true };
  readonly version = 7;

  $queryRaw(strings: TemplateStringsArray, ...values: unknown[]): string {
    return `${this.#secret}:${strings.join('?')}:${String(values.length)}`;
  }
  $executeRaw(): number {
    return 1;
  }
  $transaction(): string {
    return 'savepoint';
  }
  $queryRawUnsafe(): string {
    return 'unsafe';
  }
  $executeRawUnsafe(): string {
    return 'unsafe';
  }
  $extends(): string {
    return 'extended';
  }
}

type Assert<T extends true> = T;
type Lacks<T, K extends PropertyKey> = K extends keyof T ? false : true;
// Compile-time half of ADR-0005 am.10 item 1: the omitted members are not part of the type.
export type TenantDbOmitsMembers = [
  Assert<Lacks<TenantDb<FakeTx>, '$transaction'>>,
  Assert<Lacks<TenantDb<FakeTx>, '$queryRawUnsafe'>>,
  Assert<Lacks<TenantDb<FakeTx>, '$executeRawUnsafe'>>,
];

const asRecord = (db: unknown): Record<string, unknown> => db as Record<string, unknown>;

describe('TenantDb run-time guard (ADR-0005 am.10 item 1)', () => {
  it('ADR-0005 am.10 item 1: $transaction, $queryRawUnsafe and $executeRawUnsafe throw at run time', () => {
    const { db } = createTenantDb(new FakeTx());
    for (const member of TENANT_DB_OMITTED) {
      expect(() => asRecord(db)[member]).toThrow(TenantDbAccessError);
      expect(member in db).toBe(false);
    }
  });

  it('ADR-0005 am.10 item 1: client-lifecycle members and Prisma internals (which reach the root client) are blocked', () => {
    const { db } = createTenantDb(new FakeTx());
    for (const member of ['$extends', '$connect', '$disconnect', '$on', '_originalClient', '_engine']) {
      expect(() => asRecord(db)[member]).toThrow(new TenantDbAccessError(member));
    }
    expect('_originalClient' in db).toBe(false);
  });

  it('ADR-0005 am.10 item 1: allowed members work and methods run against the real transaction client', () => {
    const { db } = createTenantDb(new FakeTx());
    expect(db.$queryRaw`SELECT ${1}`).toBe('internal:SELECT ?:1');
    expect(db.$executeRaw()).toBe(1);
    expect(db.shipment.findMany()).toBe('rows');
    expect(db.version).toBe(7);
    expect(db.$queryRaw).toBe(db.$queryRaw);
    expect('shipment' in db).toBe(true);
  });

  it('ADR-0005 am.10 item 1: the guard is read-only', () => {
    const { db } = createTenantDb(new FakeTx());
    const record = asRecord(db);
    expect(() => {
      record['$queryRaw'] = (): string => 'replaced';
    }).toThrow(TenantDbAccessError);
    expect(() => Object.defineProperty(db, 'x', { value: 1 })).toThrow(TenantDbAccessError);
    expect(() => delete record['version']).toThrow(TenantDbAccessError);
    expect(() => {
      Object.setPrototypeOf(db, null);
    }).toThrow(TenantDbAccessError);
    expect(() => asRecord(db)[Symbol.iterator as unknown as string]).not.toThrow();
  });

  it('ADR-0005 am.10 item 1: after revoke (transaction settled) every access throws TENANT_TX_CLOSED', () => {
    const handle = createTenantDb(new FakeTx());
    const query = handle.db.$queryRaw;
    handle.revoke();
    expect(() => handle.db.$queryRaw).toThrow(DbError);
    expect(() => handle.db.shipment).toThrow('Database error: TENANT_TX_CLOSED');
    expect(typeof query).toBe('function');
  });
});
