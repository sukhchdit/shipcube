import { describe, expect, it } from '@jest/globals';

import {
  TableClassManifestError,
  immutableTables,
  loadTableClasses,
  mergeManifests,
  parseManifest,
  rlsAllowList,
} from './table-classes.js';

const manifest = (module: string, tables: unknown): string => JSON.stringify({ module, tables });

describe('table-class manifests', () => {
  it('parses a manifest and keeps the optional flags', () => {
    const entries = parseManifest(
      'quotes.json',
      manifest('quotes', [
        { name: 'quotes', class: 'GUEST_CAPABLE', definerRead: true },
        { name: 'quote_options', class: 'GUEST_CAPABLE' },
      ]),
    );
    expect(entries).toEqual([
      { module: 'quotes', name: 'quotes', class: 'GUEST_CAPABLE', definerRead: true },
      { module: 'quotes', name: 'quote_options', class: 'GUEST_CAPABLE' },
    ]);
  });

  it.each([
    ['invalid JSON', 'x.json', '{', /not valid JSON/],
    ['an array root', 'x.json', '[]', /must be an object/],
    ['an unknown root key', 'x.json', JSON.stringify({ module: 'x', tables: [], extra: 1 }), /unknown key "extra"/],
    ['a module/file mismatch', 'y.json', manifest('x', []), /file name must be "x.json"/],
    ['a bad module name', 'X.json', manifest('X', []), /lowercase module name/],
    ['tables not an array', 'x.json', JSON.stringify({ module: 'x', tables: {} }), /"tables" must be an array/],
    ['a non-object entry', 'x.json', manifest('x', ['t']), /must be an object/],
    ['an unknown entry key', 'x.json', manifest('x', [{ name: 't', class: 'TENANT', policy: 'x' }]), /unknown key "policy"/],
    ['a bad table name', 'x.json', manifest('x', [{ name: 'T-1', class: 'TENANT' }]), /lowercase SQL identifier/],
    ['an unknown class', 'x.json', manifest('x', [{ name: 't', class: 'PUBLIC' }]), /class outside/],
    ['a non-boolean flag', 'x.json', manifest('x', [{ name: 't', class: 'TENANT', definerRead: 'yes' }]), /must be a boolean/],
    ['hardDelete on a TENANT table', 'x.json', manifest('x', [{ name: 't', class: 'TENANT', hardDelete: true }]), /SYSTEM tables only/],
    ['definerRead on a GLOBAL table', 'x.json', manifest('x', [{ name: 't', class: 'GLOBAL', definerRead: true }]), /need an RLS class/],
    [
      'definerPurge without definerRead',
      'x.json',
      manifest('x', [{ name: 't', class: 'USER_OWNED', definerPurge: true }]),
      /requires "definerRead"/,
    ],
    ['a non-boolean immutable flag', 'x.json', manifest('x', [{ name: 't', class: 'SYSTEM', immutable: 1 }]), /must be a boolean/],
    [
      'immutable together with hardDelete',
      'x.json',
      manifest('x', [{ name: 't', class: 'SYSTEM', hardDelete: true, immutable: true }]),
      /cannot be on a delete allow-list/,
    ],
    [
      'immutable together with definerPurge',
      'x.json',
      manifest('x', [{ name: 't', class: 'USER_OWNED', definerRead: true, definerPurge: true, immutable: true }]),
      /cannot be on a delete allow-list/,
    ],
  ])('rejects %s', (_label, file, text, message) => {
    expect(() => parseManifest(file, text)).toThrow(TableClassManifestError);
    expect(() => parseManifest(file, text)).toThrow(message);
  });

  it('rejects a table listed by two modules and sorts the merged list by name', () => {
    const a = parseManifest('a.json', manifest('a', [{ name: 'zeta', class: 'TENANT' }]));
    const b = parseManifest('b.json', manifest('b', [{ name: 'alpha', class: 'SYSTEM', hardDelete: true }]));
    expect(mergeManifests([a, b]).map((entry) => entry.name)).toEqual(['alpha', 'zeta']);
    expect(() => mergeManifests([a, a])).toThrow(/listed by "a" and "a"/);
  });

  it('derives the C1 allow-list (GLOBAL and SYSTEM only) from the committed manifests', () => {
    const entries = loadTableClasses();
    const allow = rlsAllowList(entries);
    expect(allow).toEqual(
      expect.arrayContaining(['permissions', 'roles', 'role_permissions', 'bootstrap_migrations', '_prisma_migrations']),
    );
    expect(
      entries.filter((entry) => allow.includes(entry.name)).every((entry) => entry.class === 'GLOBAL' || entry.class === 'SYSTEM'),
    ).toBe(true);
  });

  it('[C7] keeps the immutable flag and derives the immutability list; the audit module flags its append-only tables', () => {
    const entries = parseManifest(
      'x.json',
      manifest('x', [
        { name: 't', class: 'SYSTEM', immutable: true },
        { name: 'u', class: 'SYSTEM' },
      ]),
    );
    expect(entries[0]).toEqual({ module: 'x', name: 't', class: 'SYSTEM', immutable: true });
    expect(immutableTables(entries)).toEqual(['t']);
    const committed = loadTableClasses();
    expect(immutableTables(committed)).toEqual(
      expect.arrayContaining(['audit_anchors', 'audit_checkpoint_heads', 'audit_entries', 'audit_pii_vault']),
    );
    const audit = committed.filter((entry) => entry.module === 'audit');
    expect(audit.map((entry) => entry.name)).toEqual([
      'audit_anchors',
      'audit_chain_verifications',
      'audit_checkpoint_heads',
      'audit_entries',
      'audit_partitions',
      'audit_pii_vault',
      'audit_stream_heads',
      'data_subjects',
    ]);
    expect(audit.every((entry) => entry.class === 'SYSTEM')).toBe(true);
    expect(rlsAllowList(committed)).toEqual(expect.arrayContaining(audit.map((entry) => entry.name)));
  });
});
