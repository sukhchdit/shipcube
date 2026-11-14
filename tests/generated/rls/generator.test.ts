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
  caseTraits,
  enumerationFindings,
  expectedObservation,
  generateCases,
  isolationKey,
  pathParameters,
  routeCaseFindings,
  stableHash,
  stableUuid,
  synthesiseRow,
  tenantResourceRoutes,
  type ApiCrossTenantCase,
  type ColumnInfo,
  type LiveTable,
} from './generator.js';
import { drA14ProbesFor, PROBE_ENTRIES, probeSchemaDdl } from './probe.js';

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
  schema: 'public',
  name,
  kind: 'r',
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
    const withCheck = { sqlState: '42501', marker: 'row-level security' };
    expect(expectedObservation('own-row-visible', all)).toEqual({ rows: 1 });
    expect(expectedObservation('own-row-visible', [])).toEqual({ sqlState: '42501' });
    expect(expectedObservation('select-foreign-id', all)).toEqual({ rows: 0 });
    expect(expectedObservation('delete-foreign-id', ['SELECT', 'UPDATE'])).toEqual({ sqlState: '42501' });
    expect(expectedObservation('delete-foreign-id', all)).toEqual({ rows: 0 });
    expect(expectedObservation('update-foreign-id', ['SELECT'])).toEqual({ sqlState: '42501' });
    // R1-n4: with INSERT held the refusal must be the WITH CHECK one, not a privilege refusal.
    expect(expectedObservation('insert-foreign-key', all)).toEqual(withCheck);
    expect(expectedObservation('insert-foreign-key', ['SELECT'])).toEqual({ sqlState: '42501' });
    expect(expectedObservation('guest-insert-with-org', all)).toEqual(withCheck);
    expect(expectedObservation('guest-declaim-refused', all)).toEqual({ sqlState: '23514', marker: 'GUEST_DECLAIM_FORBIDDEN' });
    expect(expectedObservation('guest-claim-allowed', all)).toEqual({ rows: 1 });
    expect(expectedObservation('operator-policies-select-only', [])).toEqual({ rows: 0 });
  });

  it('[PR43-SEC-02] blind writes need only their own privilege and touch A only; a re-parent is refused by the first guard in line', () => {
    const all = ['SELECT', 'INSERT', 'UPDATE', 'DELETE'] as const;
    expect(expectedObservation('update-blind', ['UPDATE'])).toEqual({ rows: 1 });
    expect(expectedObservation('update-blind', ['SELECT'])).toEqual({ sqlState: '42501' });
    expect(expectedObservation('delete-blind', ['DELETE'])).toEqual({ rows: 1 });
    expect(expectedObservation('delete-blind', ['SELECT', 'UPDATE'])).toEqual({ sqlState: '42501' });
    expect(expectedObservation('guest-update-other-hash', all)).toEqual({ rows: 0 });
    expect(expectedObservation('reparent-own-row', all)).toEqual({ sqlState: '42501', marker: 'row-level security' });
    expect(expectedObservation('reparent-own-row', ['UPDATE'])).toEqual({ sqlState: '42501' });
    expect(expectedObservation('reparent-own-row', all, { guestCapable: true })).toEqual({
      sqlState: '23514',
      marker: 'GUEST_DECLAIM_FORBIDDEN',
    });
    expect(expectedObservation('reparent-own-row', all, { stdGuardOnKey: true })).toEqual({
      sqlState: 'P0001',
      marker: 'STD_COLUMNS_VIOLATION',
    });
    expect(expectedObservation('guest-context-tenant-rows', all)).toEqual({ rows: 0 });
  });

  it('derives the case traits from the manifest entry', () => {
    expect(caseTraits(entry('q', 'GUEST_CAPABLE'))).toEqual({ guestCapable: true, stdGuardOnKey: false });
    expect(caseTraits(entry('organisations', 'TENANT', { policySet: 'dr-a14-organisations', stdColumns: true }))).toEqual({
      guestCapable: false,
      stdGuardOnKey: true,
    });
    expect(caseTraits(entry('parcels', 'TENANT', { stdColumns: true }))).toEqual({ guestCapable: false, stdGuardOnKey: false });
  });
});

describe('RLS generator: probe schema DDL (R1-m3)', () => {
  const tablesIn = (ddl: readonly string[]): string[] =>
    ddl.flatMap((statement) => [...statement.matchAll(/CREATE TABLE public\.([a-z_]+)/g)].map((match) => match[1] ?? '')).sort();
  const grantedIn = (ddl: readonly string[]): string[] =>
    ddl.flatMap((statement) => [...statement.matchAll(/ON public\.([a-z_]+) TO platform_app/g)].map((match) => match[1] ?? '')).sort();

  it('creates and grants exactly the planted tables', () => {
    const ddl = probeSchemaDdl(PROBE_ENTRIES);
    const planted = PROBE_ENTRIES.map((e) => e.name).sort();
    expect(tablesIn(ddl)).toEqual(planted);
    expect(grantedIn(ddl)).toEqual(planted);
  });

  it('once TASK-037 commits organisations and memberships, only users is planted next to the probe tables (no 42P07)', () => {
    const left = drA14ProbesFor(new Set(['organisations', 'memberships']));
    expect(left.map((e) => e.name)).toEqual(['users']);
    const ddl = probeSchemaDdl(left);
    expect(tablesIn(ddl)).toEqual(['users']);
    expect(grantedIn(ddl)).toEqual(['users']);
    expect(drA14ProbesFor(new Set(['organisations', 'memberships', 'users']))).toEqual([]);
    expect(() => probeSchemaDdl([entry('nope', 'TENANT')])).toThrow(/probe table nope has no DDL/);
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
      'quotes: GUEST_CAPABLE without an enabled tg_quotes__guest_capable_guard (PR7-SEC-04, PR43-SEC-05 (d))',
      'quotes: GUEST_CAPABLE without guest_token_hash',
      'gone: listed as USER_OWNED but not in the database',
    ]);
    expect(enumerationFindings([entry('orders', 'TENANT')], [orders])).toEqual([]);
  });

  it('[R1-m4] names every relation outside public, whatever its kind, even when a manifest lists its name', () => {
    const hidden = live('orders', [column('id', 'uuid'), column('org_id', 'uuid')], { schema: 'platform' });
    const view = live('v_orders', [column('id', 'uuid')], { schema: 'reporting', kind: 'v' });
    expect(enumerationFindings([entry('orders', 'TENANT')], [orders, hidden, view])).toEqual([
      'platform.orders: relation (relkind r) outside public, where no table-class manifest or RLS template reaches it',
      'reporting.v_orders: relation (relkind v) outside public, where no table-class manifest or RLS template reaches it',
    ]);
  });
});

describe('RLS generator: API-level enumeration (AT-US-077-02; PR43-SEC-01, R1-M2)', () => {
  const route = (operationId: string, path: string, tenancy: string, auth: string[] = ['session'], method = 'get') => ({
    operationId,
    method,
    path,
    tenancy,
    auth,
  });
  const routes = [
    route('getOrder', '/orders/:orderId', 'tenant'),
    route('patchOrder', '/orders/{orderId}/items', 'tenant', ['session'], 'patch'),
    route('listOrders', '/orders', 'tenant'),
    route('getMe', '/me/sessions/:id', 'user'),
    route('getQuote', '/quotes/:quoteId', 'guest', ['session', 'quote-token']),
    route('createQuote', '/quotes', 'guest', ['anonymous', 'session']),
    route('getCountry', '/countries/:code', 'public', ['anonymous']),
    route('opGetOrg', '/operator/organisations/:orgId', 'operator-cross-tenant'),
  ];
  const manifests = [
    entry('orders', 'TENANT'),
    entry('sessions', 'USER_OWNED'),
    entry('quotes', 'GUEST_CAPABLE'),
    entry('roles', 'GLOBAL'),
  ];

  it('enumerates tenant, user and guest routes with a path parameter; operator-cross-tenant and public stay out', () => {
    expect(tenantResourceRoutes(routes).map((r) => r.operationId)).toEqual(['getOrder', 'patchOrder', 'getMe', 'getQuote']);
    expect(pathParameters('/a/:x/b/{y}/c')).toEqual(['x', 'y']);
  });

  it('names every route without an executable case, and nothing once each has a well-formed case', () => {
    expect(routeCaseFindings(routes, new Map(), manifests)).toEqual([
      'GET /me/sessions/:id (getMe): tenant-resource route without a generated cross-tenant case',
      'GET /orders/:orderId (getOrder): tenant-resource route without a generated cross-tenant case',
      'GET /quotes/:quoteId (getQuote): tenant-resource route without a generated cross-tenant case',
      'PATCH /orders/{orderId}/items (patchOrder): tenant-resource route without a generated cross-tenant case',
    ]);
    const cases = new Map<string, ApiCrossTenantCase>([
      ['getOrder', { table: 'orders', params: { orderId: 'id' } }],
      ['patchOrder', { table: 'orders', params: { orderId: 'id' }, body: { note: 'x' } }],
      ['getMe', { table: 'sessions', params: { id: 'id' } }],
      ['getQuote', { table: 'quotes', params: { quoteId: 'id' } }],
    ]);
    expect(routeCaseFindings(routes, cases, manifests)).toEqual([]);
  });

  it('fails closed on a stale case, wrong parameters, a non-RLS table, a quote-token route on a non-guest table and an unpresentable credential', () => {
    const cases = new Map<string, ApiCrossTenantCase>([
      ['getOrder', { table: 'orders', params: { id: 'id' } }],
      ['patchOrder', { table: 'roles', params: { orderId: 'id' } }],
      ['getMe', { table: 'sessions', params: { id: 'id' } }],
      ['getQuote', { table: 'orders', params: { quoteId: 'id' } }],
      ['listOrders', { table: 'orders', params: {} }],
    ]);
    const signed = [...routes, route('getHook', '/hooks/:hookId', 'tenant', ['signature'])];
    cases.set('getHook', { table: 'orders', params: { hookId: 'id' } });
    expect(routeCaseFindings(signed, cases, manifests)).toEqual([
      'GET /hooks/:hookId (getHook): accepts credential signature, which the cross-tenant case runner cannot present',
      "GET /orders/:orderId (getOrder): case parameters [id] differ from the route's [orderId]",
      'GET /quotes/:quoteId (getQuote): accepts quote-token but case table orders is TENANT, not GUEST_CAPABLE',
      'PATCH /orders/{orderId}/items (patchOrder): case table roles is not a row-level secured manifest entry',
      'listOrders: registered cross-tenant case without a tenant-resource route',
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
