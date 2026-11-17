/**
 * The classification completeness check over `prisma/schema` (REQ-AUDIT-009, NFR-PRIV-003; US-091 AT-US-091-04;
 * PR8-SEC-10; TASK-028) and the C10 finding rules on planted data. The live-schema twin is catalog C10
 * (prisma/tests/catalog/c10-classification.int.test.ts).
 */
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { CLASSIFICATION_REGISTRY, classificationOf, unclassifiedColumns } from '@platform/shared';

import { findRepoRoot } from '../test-support/process.js';
import { c10Findings, KEY_ID_SIBLINGS, prismaSchemaColumns, registryTableName, schemaColumnsOf } from './classification.js';

const SCHEMA_DIR = join(findRepoRoot(), 'prisma', 'schema');

describe('[AT-US-091-04] [NFR-PRIV-003] every column of prisma/schema has a classification', () => {
  const columns = prismaSchemaColumns(SCHEMA_DIR);

  it('reads the models of every schema file, authz.prisma included', () => {
    const tables = new Set(columns.map((column) => column.table));
    for (const table of ['permissions', 'roles', 'role_permissions', 'reference_dataset_versions']) expect(tables.has(table)).toBe(true);
    // Relation fields are not columns.
    expect(columns).not.toContainEqual({ table: 'roles', column: 'permissions' });
    expect(columns).toContainEqual({ table: 'roles', column: 'name_key' });
  });

  it('the build test: no unclassified column', () => {
    expect(unclassifiedColumns(columns)).toEqual([]);
  });

  it('planted: a model that gains an unclassified field fails, naming the entity and the field', () => {
    const planted = schemaColumnsOf([`model Role {\n  id String @id @db.Uuid\n  nickname String @map("nick_name")\n  @@map("roles")\n}`]);
    expect(unclassifiedColumns(planted)).toEqual(['roles.nick_name']);
  });
});

describe('[PR8-SEC-10] the authz tables of authz.prisma: INT except the four PUB text columns', () => {
  const PUBLIC_COLUMNS = new Set(['permissions.description', 'permissions.category', 'roles.name_key', 'roles.description']);

  it('every schema column of permissions, roles and role_permissions has the PR8-SEC-10 class', () => {
    const authz = prismaSchemaColumns(SCHEMA_DIR).filter(({ table }) => ['permissions', 'roles', 'role_permissions'].includes(table));
    expect(authz.length).toBeGreaterThan(20);
    for (const { table, column } of authz) {
      const key = `${table}.${column}`;
      expect([key, classificationOf(table, column)]).toEqual([key, PUBLIC_COLUMNS.has(key) ? 'PUBLIC' : 'INTERNAL']);
    }
  });
});

describe('schemaColumnsOf: the Prisma schema reader', () => {
  it('uses @map and @@map, keeps scalar and enum lists, skips relations, attributes and comments', () => {
    const text = [
      '// a comment',
      'enum Scope {',
      '  OPERATOR',
      '}',
      'model Parcel {',
      '  /// doc comment',
      '  id        String   @id @db.Uuid',
      '  orgId     String   @map("org_id") @db.Uuid // trailing comment',
      '  tags      String[]',
      '  scope     Scope',
      '  scopes    Scope[]  @map(name: "scope_list")',
      '  weight    Decimal?',
      '  owner     User     @relation(fields: [orgId], references: [id])',
      '  items     Item[]',
      '  legacy    Unsupported("tsvector")?',
      '  @@index([orgId])',
      '  @@map("parcels")',
      '}',
      'model Item {',
      '  id String @id',
      '}',
    ].join('\n');
    expect(schemaColumnsOf([text])).toEqual([
      { table: 'parcels', column: 'id' },
      { table: 'parcels', column: 'org_id' },
      { table: 'parcels', column: 'tags' },
      { table: 'parcels', column: 'scope' },
      { table: 'parcels', column: 'scope_list' },
      { table: 'parcels', column: 'weight' },
      { table: 'parcels', column: 'legacy' },
      { table: 'Item', column: 'id' },
    ]);
  });
});

describe('[C10] c10Findings on planted data (data-model §4.6)', () => {
  const live = (table: string, column: string, schema = 'public') => ({ schema, table, column });
  const complete = {
    users: { id: 'INTERNAL', email: 'PERSONAL' },
    login_attempt_counters: { id: 'INTERNAL', identifier_hmac: 'SECRET', identifier_hmac_key_id: 'INTERNAL' },
    idempotency_keys: { response_body: 'PERSONAL', response_body_key_id: 'INTERNAL' },
    audit_pii_vault: { token: 'INTERNAL', ciphertext: 'SECRET', ciphertext_key_id: 'INTERNAL' },
    'platform.jobs': { id: 'INTERNAL' },
  } as const;
  /** A PERSONAL column planted in a SYSTEM table, and the key-id sibling gone from the registry. */
  const planted = { ...complete, login_attempt_counters: { id: 'INTERNAL', identifier_hmac: 'SECRET', note: 'PERSONAL' } } as const;
  const tableClasses = [
    { name: 'users', class: 'USER_OWNED' },
    { name: 'login_attempt_counters', class: 'SYSTEM' },
    { name: 'idempotency_keys', class: 'SYSTEM' },
    { name: 'audit_pii_vault', class: 'SYSTEM' },
  ] as const;
  const clean = [
    live('users', 'id'),
    live('users', 'email'),
    live('login_attempt_counters', 'id'),
    live('login_attempt_counters', 'identifier_hmac'),
    live('login_attempt_counters', 'identifier_hmac_key_id'),
    live('idempotency_keys', 'response_body'),
    live('idempotency_keys', 'response_body_key_id'),
    live('audit_pii_vault', 'token'),
    live('audit_pii_vault', 'ciphertext'),
    live('audit_pii_vault', 'ciphertext_key_id'),
    live('jobs', 'id', 'platform'),
  ];

  it('control: a classified schema within the rules has no finding (the exceptions hold, platform tables are qualified)', () => {
    expect(c10Findings({ columns: clean, tableClasses, registry: complete })).toEqual([]);
  });

  it('reports unclassified and stale entries, PII in a SYSTEM table and a missing key-id sibling', () => {
    const columns = [
      ...clean.filter((column) => !(column.table === 'login_attempt_counters' && column.column === 'identifier_hmac_key_id')),
      live('login_attempt_counters', 'note'),
      live('users', 'phone'),
    ];
    expect(c10Findings({ columns, tableClasses, registry: planted })).toEqual([
      'login_attempt_counters.identifier_hmac: no sibling key-id column identifier_hmac_key_id (data-model §10.4)',
      'login_attempt_counters.note: PERSONAL / SENSITIVE_PERSONAL column in a SYSTEM table',
      'users.phone: no classification registry entry',
    ]);
    expect(c10Findings({ columns: clean.slice(1), tableClasses, registry: complete })).toEqual([
      'users.id: registry entry for a column that does not exist',
    ]);
  });

  it('the key-id list names the §10.4 columns of the live audit store', () => {
    expect(KEY_ID_SIBLINGS).toContainEqual(['audit_pii_vault', 'ciphertext', 'ciphertext_key_id', 'SECRET']);
    expect(KEY_ID_SIBLINGS).toContainEqual(['audit_pii_vault', 'value_hmac', 'value_hmac_key_id', 'SECRET']);
    expect(KEY_ID_SIBLINGS).toContainEqual(['audit_entries', 'ip_hash', 'ip_hash_key_id', 'INTERNAL']);
    expect(registryTableName('platform', 'jobs')).toBe('platform.jobs');
    expect(Object.keys(CLASSIFICATION_REGISTRY).every((name) => !name.startsWith('public.'))).toBe(true);
  });
});

describe('[PR61-SEC-10] C10 pins the data-model class of each §10.4 column', () => {
  it('a §10.4 column classified other than the data model says is a finding', () => {
    const columns = [
      { schema: 'public', table: 'audit_pii_vault', column: 'ciphertext' },
      { schema: 'public', table: 'audit_pii_vault', column: 'ciphertext_key_id' },
    ];
    const registry = { audit_pii_vault: { ciphertext: 'INTERNAL', ciphertext_key_id: 'INTERNAL' } } as const;
    expect(c10Findings({ columns, tableClasses: [], registry })).toEqual([
      'audit_pii_vault.ciphertext: classified INTERNAL, data-model §3 says SECRET (PR61-SEC-10)',
    ]);
  });

  it('the live registry agrees with every pinned class it holds', () => {
    for (const [table, column, , expected] of KEY_ID_SIBLINGS) {
      const actual = classificationOf(table, column);
      if (actual !== undefined) expect([`${table}.${column}`, actual]).toEqual([`${table}.${column}`, expected]);
    }
  });
});

describe('[PR61 R1-n2] [dup-review R1-n7] the Prisma reader: @@schema and // inside strings', () => {
  it('keys a model of another schema as <schema>.<table>; a // inside a string does not cut the line', () => {
    const text = [
      'model Job {',
      '  id   String @id',
      '  hook String @default("https://example.test/hook") @map("hook_url") // trailing comment',
      '  @@map("jobs")',
      '  @@schema("platform")',
      '}',
    ].join('\n');
    expect(schemaColumnsOf([text])).toEqual([
      { table: 'platform.jobs', column: 'id' },
      { table: 'platform.jobs', column: 'hook_url' },
    ]);
  });
});
