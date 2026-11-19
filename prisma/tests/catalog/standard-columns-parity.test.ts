/**
 * `catalog-std` controls that need no database (PR26-SEC-06; D-TASK032-04):
 *  - exemption maps are looked up by own key, so tables named like `Object.prototype` members are not exempt;
 *  - the Prisma field names the standard-columns extension keys on and the database columns this suite checks stay in
 *    step (a model that maps `creatorId @map("created_by")` is neither stamped nor refused), proven on planted data
 *    models and on the generated client's own runtime data model.
 */
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { PrismaPg } from '@prisma/adapter-pg';

import { withStandardColumns } from '../../../apps/api/src/platform/db/index.js';
import { PRISMA_TREE_LOCK, withReadLock } from '../../../tools/test-support/fs-lock.js';
import type * as GeneratedClient from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../generated/prisma/client.js';
import {
  type ColumnRow,
  dateZoneFindings,
  namingParityFindings,
  onBehalfFindings,
  type OnBehalfRow,
  STANDARD_COLUMN_PAIRS,
  standardColumnFindings,
} from './standard-columns-scans.js';

const PROTOTYPE_NAMES = ['constructor', 'toString', 'valueOf', 'hasOwnProperty', 'isPrototypeOf', '__proto__'];

describe('catalog-std exemption lookups use own keys, not the prototype chain (PR26-SEC-06)', () => {
  it.each(PROTOTYPE_NAMES)('a table named "%s" is not exempt from the standard-column rule', (table) => {
    const findings = standardColumnFindings({ columns: [{ ...column(table, 'note', 'text') }], primaryKeys: [], checks: [] });
    expect(findings.length).toBeGreaterThan(0);
    expect(findings.every((finding) => finding.startsWith(`${table}`))).toBe(true);
  });

  it.each(PROTOTYPE_NAMES)('a table named "%s" is not exempt from the on-behalf pin or the date time-zone rule', (table) => {
    const behalf: OnBehalfRow = { schema_name: 'public', table_name: table, type_name: 'uuid', not_null: false, checks: [] };
    expect(onBehalfFindings([behalf])).toEqual([
      `${table}.on_behalf_of_org_id: missing CHECK (on_behalf_of_org_id IS NULL), expected ck_${table}__on_behalf_null_m1`,
    ]);
    expect(dateZoneFindings([column(table, 'due', 'date')])).toEqual([`${table}.due: date without an IANA time-zone column`]);
  });

  it('control: a real exemption still applies, by exact own key', () => {
    expect(standardColumnFindings({ columns: [column('_prisma_migrations', 'id', 'varchar')], primaryKeys: [], checks: [] })).toEqual([]);
    expect(
      onBehalfFindings([{ schema_name: 'public', table_name: 'audit_entries', type_name: 'uuid', not_null: false, checks: [] }]),
    ).toEqual([]);
  });
});

function column(table: string, name: string, type: string): ColumnRow {
  return { schema_name: 'public', table_name: table, column_name: name, type_name: type, not_null: true, default_expr: null, identity: '' };
}

const field = (name: string, dbName?: string) => ({ name, kind: 'scalar', type: 'String', ...(dbName === undefined ? {} : { dbName }) });

describe('Prisma field name and database column parity for the standard columns (PR26-SEC-06)', () => {
  const MAPPED = Object.entries(STANDARD_COLUMN_PAIRS).map(([name, dbName]) => field(name, dbName === name ? undefined : dbName));

  it('a model that follows the naming has no finding', () => {
    expect(namingParityFindings({ models: { Good: { fields: [...MAPPED, field('reference')] } } })).toEqual([]);
  });

  it('planted: a differently named field mapped to a standard column is reported', () => {
    expect(namingParityFindings({ models: { Bad: { fields: [field('creatorId', 'created_by')] } } })).toEqual([
      'Bad.creatorId: column created_by must be the Prisma field createdBy',
    ]);
  });

  it('planted: a standard Prisma name mapped to another column is reported', () => {
    expect(namingParityFindings({ models: { Bad: { fields: [field('createdBy', 'creator'), field('version', 'rev')] } } })).toEqual([
      'Bad.createdBy: maps to column creator, expected created_by',
      'Bad.version: maps to column rev, expected version',
    ]);
  });

  it('planted: the unmapped name of a standard column is also checked (field "org_id" unmapped)', () => {
    expect(namingParityFindings({ models: { Bad: { fields: [field('org_id')] } } })).toEqual([
      'Bad.org_id: column org_id must be the Prisma field orgId',
    ]);
  });

  it.each([undefined, null, {}, { models: null }, { models: { M: {} } }])(
    'an unreadable data model (%j) yields no finding rather than throwing',
    (dataModel) => {
      expect(namingParityFindings(dataModel)).toEqual([]);
    },
  );
});

describe('the generated Prisma client (no database)', () => {
  let generated: typeof GeneratedClient;
  let client: PrismaClient;

  beforeAll(async () => {
    // The tree lock may be held by the deps rebuild suites running in parallel (they regenerate the client).
    generated = await withReadLock(PRISMA_TREE_LOCK, () => import('../../generated/prisma/client.js'));
    // The pool connects lazily: nothing is opened until the first query, and none runs here.
    client = new generated.PrismaClient({ adapter: new PrismaPg({ connectionString: 'postgres://platform_app@127.0.0.1:1/none' }) });
  }, 120_000);

  afterAll(async () => {
    await client?.$disconnect();
  });

  it('every model follows the standard-column naming (stamping and refusal cannot be silently disabled)', () => {
    const dataModel = Reflect.get(client, '_runtimeDataModel') as { models: Record<string, unknown> };
    expect(Object.keys(dataModel.models).length).toBeGreaterThan(0);
    expect(namingParityFindings(dataModel)).toEqual([]);
  });

  it('the production extension builds on the real client: its runtime data model is non-empty and readable', () => {
    const extended = withStandardColumns(client as unknown as Parameters<typeof withStandardColumns>[0], {
      orgId: '',
      actorId: '00000000-0000-7000-8000-000000000002',
    });
    expect(typeof Reflect.get(extended, '$transaction')).toBe('function');
  });
});
