/**
 * Unit tests of the RLS generator (TASK-024; US-077 AT-US-077-03): case derivation, enumeration findings, route
 * enumeration, row synthesis and expectations. Pure; the database half runs in cross-tenant.int.test.ts.
 */
import { describe, expect, it } from '@jest/globals';

import type { TableClassEntry } from '../../../tools/db/table-classes.js';
import { enumCheckValues } from './database.js';
import {
  GUEST_PROBES,
  TABLE_PROBES,
  RowSynthesisError,
  enumerationFindings,
  expectedObservation,
  generateCases,
  isolationKey,
  routeCaseFindings,
  stableHash,
  stableUuid,
  synthesiseRow,
  tenantResourceRoutes,
  type ColumnInfo,
  type LiveTable,
} from './generator.js';

const entry = (name: string, tableClass: TableClassEntry['class'], extra: Partial<TableClassEntry> = {}): TableClassEntry => ({
  module: 'm',
  name,
  class: tableClass,
  ...extra,
});
const column = (name: string, type: string, notNull = true, hasDefault = false, enumValues?: string[]): ColumnInfo => ({
  name,
  type,
  notNull,
  hasDefault,
  ...(enumValues === undefined ? {} : { enumValues }),
});
const live = (name: string, columns: ColumnInfo[], extra: Partial<LiveTable> = {}): LiveTable => ({
  name,
  columns,
  rowSecurity: true,
  forceRowSecurity: true,
  triggers: [],
  appPrivileges: ['SELECT', 'INSERT', 'UPDATE'],
  ...extra,
});

describe('RLS generator: cases (AT-US-077-03)', () => {
  it('derives the isolation key per class and DR-A14 set', () => {
    expect(isolationKey(entry('t', 'TENANT'))).toEqual({ column: 'org_id', scope: 'org' });
    expect(isolationKey(entry('q', 'GUEST_CAPABLE'))).toEqual({ column: 'org_id', scope: 'org' });
    expect(isolationKey(entry('s', 'USER_OWNED'))).toEqual({ column: 'user_id', scope: 'actor' });
    expect(isolationKey(entry('users', 'USER_OWNED', { policySet: 'dr-a14-users' }))).toEqual({ column: 'id', scope: 'actor' });
    expect(isolationKey(entry('organisations', 'TENANT', { policySet: 'dr-a14-organisations' }))).toEqual({ column: 'id', scope: 'org' });
    expect(isolationKey(entry('memberships', 'TENANT', { policySet: 'dr-a14-memberships' }))).toEqual({ column: 'org_id', scope: 'org' });
    expect(() => isolationKey(entry('g', 'GLOBAL'))).toThrow(/not row-level secured/);
  });

  it('generates every table probe for each RLS table, the guest probes only for GUEST_CAPABLE, nothing for GLOBAL/SYSTEM', () => {
    const cases = generateCases([entry('a', 'TENANT'), entry('b', 'GUEST_CAPABLE'), entry('c', 'GLOBAL'), entry('d', 'SYSTEM')]);
    expect(cases.filter((c) => c.table === 'a').map((c) => c.kind)).toEqual([...TABLE_PROBES]);
    expect(cases.filter((c) => c.table === 'b').map((c) => c.kind)).toEqual([...TABLE_PROBES, ...GUEST_PROBES]);
    expect(cases.some((c) => c.table === 'c' || c.table === 'd')).toBe(false);
    expect(new Set(cases.map((c) => c.title)).size).toBe(cases.length);
    expect(cases.find((c) => c.kind === 'select-foreign-id')?.title).toMatch(/^a: AT-US-077-01 /);
    expect(cases.find((c) => c.kind === 'forced-operator')?.title).toContain('[SEC-TC-06]');
  });

  it('pins the expected observation per probe and privilege set', () => {
    const all = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
    expect(expectedObservation('own-row-visible', all)).toEqual({ rows: 1 });
    expect(expectedObservation('own-row-visible', [])).toEqual({ sqlState: '42501' });
    expect(expectedObservation('select-foreign-id', all)).toEqual({ rows: 0 });
    expect(expectedObservation('delete-foreign-id', ['SELECT', 'UPDATE'])).toEqual({ sqlState: '42501' });
    expect(expectedObservation('delete-foreign-id', all)).toEqual({ rows: 0 });
    expect(expectedObservation('update-foreign-id', ['SELECT'])).toEqual({ sqlState: '42501' });
    expect(expectedObservation('insert-foreign-key', all)).toEqual({ sqlState: '42501' });
    expect(expectedObservation('guest-declaim-refused', all)).toEqual({ sqlState: '23514', marker: 'GUEST_DECLAIM_FORBIDDEN' });
    expect(expectedObservation('guest-claim-allowed', all)).toEqual({ rows: 1 });
    expect(expectedObservation('operator-policies-select-only', [])).toEqual({ rows: 0 });
  });
});

describe('RLS generator: enumeration (AT-US-077-03)', () => {
  const orders = live('orders', [column('id', 'uuid'), column('org_id', 'uuid')]);

  it('reports unlisted tables, missing tables, ENABLE/FORCE, key column, de-claim trigger and RLS under a non-RLS class', () => {
    const entries = [entry('orders', 'TENANT'), entry('quotes', 'GUEST_CAPABLE'), entry('gone', 'USER_OWNED'), entry('roles', 'GLOBAL')];
    const tables = [
      live('orders', [column('id', 'uuid')], { forceRowSecurity: false }),
      live('quotes', [column('id', 'uuid'), column('org_id', 'uuid', false)]),
      live('roles', [column('id', 'uuid')]),
      live('stray', [column('id', 'uuid'), column('org_id', 'uuid')], { rowSecurity: false, forceRowSecurity: false }),
    ];
    expect(enumerationFindings(entries, tables)).toEqual([
      'roles: row security is enabled but the manifest class is GLOBAL',
      'stray: table in no table-class manifest, so the generator cannot classify it',
      'orders: TENANT without ENABLE and FORCE ROW LEVEL SECURITY',
      'orders: isolation key column org_id missing',
      'quotes: GUEST_CAPABLE without tg_quotes__guest_capable_guard (PR7-SEC-04)',
      'quotes: GUEST_CAPABLE without guest_token_hash',
      'gone: listed as USER_OWNED but not in the database',
    ]);
    expect(enumerationFindings([entry('orders', 'TENANT')], [orders])).toEqual([]);
  });

  it('[AT-US-077-02] enumerates tenant- and user-scoped routes with a path parameter and names those without a case', () => {
    const routes = [
      { operationId: 'getOrder', method: 'get', path: '/orders/:orderId', tenancy: 'tenant' },
      { operationId: 'patchOrder', method: 'patch', path: '/orders/{orderId}/items', tenancy: 'tenant' },
      { operationId: 'listOrders', method: 'get', path: '/orders', tenancy: 'tenant' },
      { operationId: 'getMe', method: 'get', path: '/me/sessions/:id', tenancy: 'user' },
      { operationId: 'getQuote', method: 'get', path: '/quotes/:id', tenancy: 'guest' },
      { operationId: 'getCountry', method: 'get', path: '/countries/:code', tenancy: 'public' },
    ];
    expect(tenantResourceRoutes(routes).map((route) => route.operationId)).toEqual(['getOrder', 'patchOrder', 'getMe']);
    expect(routeCaseFindings(routes, new Set(['getOrder']))).toEqual([
      'GET /me/sessions/:id (getMe): tenant-resource route without a generated cross-tenant case',
      'PATCH /orders/{orderId}/items (patchOrder): tenant-resource route without a generated cross-tenant case',
    ]);
  });
});

describe('RLS generator: row synthesis and deterministic ids', () => {
  it('fills NOT NULL columns without a default by type, enum CHECKs with their first value, and honours overrides', () => {
    const table = live('parcels', [
      column('id', 'uuid'),
      column('org_id', 'uuid'),
      column('status', 'text', true, false, ['ACTIVE', 'CLOSED']),
      column('ref', 'character varying(6)'),
      column('currency', 'character(3)'),
      column('amount_minor', 'bigint'),
      column('flag', 'boolean'),
      column('payload', 'jsonb'),
      column('hash', 'bytea'),
      column('tags', 'text[]'),
      column('at', 'timestamp with time zone'),
      column('note', 'text', false),
      column('created_at', 'timestamp with time zone', true, true),
    ]);
    const row = synthesiseRow(table, { id: 'x', org_id: 'o' }, 'A');
    expect(row.columns).toEqual(['id', 'org_id', 'status', 'ref', 'currency', 'amount_minor', 'flag', 'payload', 'hash', 'tags', 'at']);
    expect(row.values.slice(0, 8)).toEqual(['x', 'o', 'ACTIVE', 'rls-re', 'USD', '1', false, '{}']);
    expect(Buffer.isBuffer(row.values[8])).toBe(true);
    expect(row.values.slice(9)).toEqual(['{}', '2026-01-01T00:00:00Z']);
  });

  it('names the column it cannot synthesise and refuses an override for an unknown column', () => {
    expect(() => synthesiseRow(live('t', [column('shape', 'geometry')]), {}, 'A')).toThrow(RowSynthesisError);
    expect(() => synthesiseRow(live('t', [column('shape', 'geometry')]), {}, 'A')).toThrow(
      /t\.shape \(geometry\): no synthetic value; add it to ROW_OVERRIDES/,
    );
    expect(() => synthesiseRow(live('t', [column('id', 'uuid')]), { nope: 1 }, 'A')).toThrow(/unknown column\(s\) nope/);
  });

  it('derives stable version-7 UUIDs and 64-hex guest hashes from labels', () => {
    expect(stableUuid('a')).toBe(stableUuid('a'));
    expect(stableUuid('a')).not.toBe(stableUuid('b'));
    expect(stableUuid('a')).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(stableHash('H')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('reads single-column enum CHECKs in both deparsed forms and ignores other CHECKs', () => {
    expect(enumCheckValues("CHECK ((status = ANY (ARRAY['ACTIVE'::text, 'INVITED'::text])))")).toEqual(['ACTIVE', 'INVITED']);
    expect(enumCheckValues("CHECK ((kind = 'ONLY'::text))")).toEqual(['ONLY']);
    expect(enumCheckValues("CHECK ((currency ~ '^[A-Z]{3}$'::text))")).toBeUndefined();
    expect(enumCheckValues('CHECK ((amount_minor >= 0))')).toBeUndefined();
  });
});
