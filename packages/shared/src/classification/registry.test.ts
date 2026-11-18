/**
 * The field classification registry (REQ-AUDIT-009, NFR-PRIV-003; data-model §1.2; US-091; TASK-028): vocabulary,
 * own-key lookups and the completeness / staleness findings the build test and catalog C10 report.
 */
import { describe, expect, it } from '@jest/globals';

import {
  CLASSIFICATION_REGISTRY,
  CLASSIFICATION_TAGS,
  classificationOf,
  FIELD_CLASSIFICATIONS,
  isFieldClassification,
  registeredColumns,
  staleClassifications,
  unclassifiedColumns,
} from './registry.js';

describe('[REQ-AUDIT-009] classification vocabulary (data-model §1.2)', () => {
  it('has the five REQ-AUDIT-009 classes, each with its data-model tag', () => {
    expect(FIELD_CLASSIFICATIONS).toEqual(['PUBLIC', 'INTERNAL', 'PERSONAL', 'SENSITIVE_PERSONAL', 'SECRET']);
    expect(CLASSIFICATION_TAGS).toEqual({ PUBLIC: 'PUB', INTERNAL: 'INT', PERSONAL: 'PER', SENSITIVE_PERSONAL: 'SPER', SECRET: 'SEC' });
  });

  it('isFieldClassification accepts exactly the vocabulary', () => {
    for (const value of FIELD_CLASSIFICATIONS) expect(isFieldClassification(value)).toBe(true);
    for (const value of ['', 'PUB', 'personal', 'NONE', null, 3]) expect(isFieldClassification(value)).toBe(false);
  });

  it('every registry entry is in the vocabulary and the registry is frozen', () => {
    for (const [table, columns] of Object.entries(CLASSIFICATION_REGISTRY)) {
      expect(Object.isFrozen(columns)).toBe(true);
      for (const [column, value] of Object.entries(columns))
        expect([table, column, isFieldClassification(value)]).toEqual([table, column, true]);
    }
    expect(Object.isFrozen(CLASSIFICATION_REGISTRY)).toBe(true);
  });
});

describe('[REQ-AUDIT-009] classificationOf uses own keys only (PR26-SEC-06 lesson)', () => {
  it('answers the class of a registered column', () => {
    expect(classificationOf('permissions', 'description')).toBe('PUBLIC');
    expect(classificationOf('audit_pii_vault', 'ciphertext')).toBe('SECRET');
    expect(classificationOf('audit_entries', 'ua_parsed')).toBe('INTERNAL');
  });

  it.each(['constructor', 'toString', '__proto__', 'hasOwnProperty'])('a table or column named "%s" is unclassified', (name) => {
    expect(classificationOf(name, 'id')).toBeUndefined();
    expect(classificationOf('permissions', name)).toBeUndefined();
  });

  it('an injected registry is used instead of the platform one', () => {
    const registry = { users: { email: 'PERSONAL' } } as const;
    expect(classificationOf('users', 'email', registry)).toBe('PERSONAL');
    expect(classificationOf('permissions', 'key', registry)).toBeUndefined();
  });
});

describe('[AT-US-091-04] [NFR-PRIV-003] completeness and staleness findings name the entity and the field', () => {
  const registry = { users: { id: 'INTERNAL', email: 'PERSONAL' } } as const;

  it('a column without an entry is reported as table.column, sorted', () => {
    const columns = [
      { table: 'users', column: 'postcode' },
      { table: 'users', column: 'email' },
      { table: 'addresses', column: 'line1' },
    ];
    expect(unclassifiedColumns(columns, registry)).toEqual(['addresses.line1', 'users.postcode']);
  });

  it('an entry whose column does not exist is reported as stale', () => {
    expect(staleClassifications([{ table: 'users', column: 'id' }], registry)).toEqual(['users.email']);
  });

  it('control: a fully classified schema has no finding either way', () => {
    const columns = [
      { table: 'users', column: 'id' },
      { table: 'users', column: 'email' },
    ];
    expect(unclassifiedColumns(columns, registry)).toEqual([]);
    expect(staleClassifications(columns, registry)).toEqual([]);
  });

  it('registeredColumns lists every entry of the platform registry', () => {
    const listed = registeredColumns();
    expect(listed).toContainEqual({ table: 'roles', column: 'name_key', classification: 'PUBLIC' });
    expect(listed.length).toBe(Object.values(CLASSIFICATION_REGISTRY).reduce((sum, columns) => sum + Object.keys(columns).length, 0));
  });
});

describe('[PR8-SEC-10] the authz catalogue tables: INT except four PUB text columns (ADR-0008 am. 3 item 6, D-ARCH-069)', () => {
  const PUBLIC_COLUMNS = ['permissions.description', 'permissions.category', 'roles.name_key', 'roles.description'];

  it.each(['permissions', 'roles', 'role_permissions'])('%s: every column is INTERNAL unless it is one of the four', (table) => {
    const columns = CLASSIFICATION_REGISTRY[table] ?? {};
    expect(Object.keys(columns).length).toBeGreaterThan(0);
    for (const [column, value] of Object.entries(columns)) {
      expect([`${table}.${column}`, value]).toEqual([
        `${table}.${column}`,
        PUBLIC_COLUMNS.includes(`${table}.${column}`) ? 'PUBLIC' : 'INTERNAL',
      ]);
    }
  });
});

describe('[NFR-PRIV-002] secrets and personal data columns of the audit store', () => {
  it('the vault ciphertext and the dedupe HMAC are SECRET; the entry token columns are INTERNAL references', () => {
    expect(classificationOf('audit_pii_vault', 'value_hmac')).toBe('SECRET');
    for (const column of ['ip_token', 'user_agent_token', 'reason_token'])
      expect(classificationOf('audit_entries', column)).toBe('INTERNAL');
  });
});
