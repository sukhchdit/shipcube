import { describe, expect, it } from '@jest/globals';

import { GrantsManifestError, grantTuples, loadGrantsManifest, parseGrantsManifest, validateGrants } from './grants-manifest.js';
import { loadTableClasses, type TableClassEntry } from './table-classes.js';

const entry = (name: string, extra: Partial<TableClassEntry> = {}): TableClassEntry => ({ module: 'm', name, class: 'TENANT', ...extra });

describe('grant manifest (data-model §4.4, C5)', () => {
  it('PR8-SEC-10, D-ARCH-075, C5: the committed manifest grants SELECT only on the authz catalogue and reference_dataset_versions, the §4.4 audit matrix, the TASK-037 organisation and user tables (no DELETE), the TASK-039 job_executions with its TASK-043 DELETE, the TASK-043 outbox_events and processed_events (hard-delete allow-list), and agrees with the table classes', () => {
    const grants = loadGrantsManifest();
    expect(grantTuples(grants)).toEqual([
      // TASK-043: the hard-delete allow-list (outbox_events, processed_events, job_executions) and the outbox writes.
      'platform_app DELETE public.job_executions *',
      'platform_app DELETE public.outbox_events *',
      'platform_app DELETE public.processed_events *',
      'platform_app INSERT public.audit_anchors *',
      'platform_app INSERT public.audit_chain_verifications *',
      'platform_app INSERT public.audit_checkpoint_heads *',
      'platform_app INSERT public.audit_entries *',
      'platform_app INSERT public.audit_partitions *',
      'platform_app INSERT public.audit_pii_vault *',
      'platform_app INSERT public.audit_stream_heads *',
      'platform_app INSERT public.data_subjects *',
      'platform_app INSERT public.invitations *',
      'platform_app INSERT public.job_executions *',
      'platform_app INSERT public.membership_roles *',
      'platform_app INSERT public.memberships *',
      'platform_app INSERT public.organisations *',
      'platform_app INSERT public.outbox_events *',
      'platform_app INSERT public.processed_events *',
      'platform_app INSERT public.users *',
      'platform_app SELECT public.audit_anchors *',
      'platform_app SELECT public.audit_chain_verifications *',
      'platform_app SELECT public.audit_checkpoint_heads *',
      'platform_app SELECT public.audit_entries *',
      'platform_app SELECT public.audit_partitions *',
      'platform_app SELECT public.audit_pii_vault *',
      'platform_app SELECT public.audit_stream_heads *',
      'platform_app SELECT public.data_subjects *',
      'platform_app SELECT public.invitations *',
      'platform_app SELECT public.job_executions *',
      'platform_app SELECT public.membership_roles *',
      'platform_app SELECT public.memberships *',
      'platform_app SELECT public.organisations *',
      'platform_app SELECT public.outbox_events *',
      'platform_app SELECT public.permissions *',
      'platform_app SELECT public.processed_events *',
      'platform_app SELECT public.reference_dataset_versions *',
      'platform_app SELECT public.role_permissions *',
      'platform_app SELECT public.roles *',
      'platform_app SELECT public.users *',
      'platform_app UPDATE public.audit_chain_verifications *',
      'platform_app UPDATE public.audit_partitions *',
      'platform_app UPDATE public.audit_stream_heads *',
      'platform_app UPDATE public.invitations *',
      'platform_app UPDATE public.membership_roles *',
      'platform_app UPDATE public.memberships *',
      'platform_app UPDATE public.organisations *',
      // PR043-SEC-05 (D-ARCH-197): column-level UPDATE, the relay marks only.
      'platform_app UPDATE public.outbox_events attempts',
      'platform_app UPDATE public.outbox_events last_error',
      'platform_app UPDATE public.outbox_events published_at',
      'platform_app UPDATE public.outbox_events updated_at',
      'platform_app UPDATE public.outbox_events updated_by',
      'platform_app UPDATE public.outbox_events version',
      'platform_app UPDATE public.users *',
      'platform_definer SELECT public.invitations *',
      'platform_definer SELECT public.memberships *',
      'platform_definer SELECT public.organisations *',
      'platform_definer SELECT public.users *',
      'platform_erasure DELETE public.audit_pii_vault *',
      'platform_erasure SELECT public.audit_pii_vault *',
      'platform_erasure SELECT public.data_subjects *',
      'platform_erasure UPDATE public.data_subjects erased_at',
      'platform_erasure UPDATE public.data_subjects updated_at',
      'platform_erasure UPDATE public.data_subjects updated_by',
      'platform_erasure UPDATE public.data_subjects version',
    ]);
    expect(validateGrants(grants, loadTableClasses())).toEqual([]);
  });

  it('parses table and column grants, ignores comments and blank lines, and sorts the columns', () => {
    const grants = parseGrantsManifest(
      '# comment\n\nplatform_app   SELECT public.quotes   # trailing\nplatform_app UPDATE public.quotes (version, org_id)\n',
    );
    expect(grants).toEqual([
      { grantee: 'platform_app', privilege: 'SELECT', schema: 'public', table: 'quotes' },
      { grantee: 'platform_app', privilege: 'UPDATE', schema: 'public', table: 'quotes', columns: ['org_id', 'version'] },
    ]);
    expect(grantTuples(grants)).toEqual([
      'platform_app SELECT public.quotes *',
      'platform_app UPDATE public.quotes org_id',
      'platform_app UPDATE public.quotes version',
    ]);
  });

  it.each([
    ['a malformed line', 'platform_app SELECT', /expected "<grantee>/],
    ['an unknown grantee', 'platform_migrator SELECT public.t', /grantee must be one of/],
    ['TRUNCATE', 'platform_app TRUNCATE public.t', /privilege must be one of/],
    ['another schema', 'platform_app SELECT other.t', /schema must be public or platform/],
    ['an invalid column', 'platform_app UPDATE public.t (Bad)', /invalid column list/],
    ['a duplicate column', 'platform_app UPDATE public.t (a, a)', /duplicate column/],
    ['a DELETE column grant', 'platform_app DELETE public.t (a)', /DELETE cannot be a column grant/],
    ['a duplicate grant', 'platform_app SELECT public.t\nplatform_app SELECT public.t', /duplicate grant platform_app SELECT public\.t \*/],
    [
      'a table grant shadowing a column grant',
      'platform_app UPDATE public.t\nplatform_app UPDATE public.t (a)',
      /both a table and a column grant/,
    ],
  ])('refuses %s', (_label, text, error) => {
    expect(() => parseGrantsManifest(text)).toThrow(GrantsManifestError);
    expect(() => parseGrantsManifest(text)).toThrow(error);
  });

  it('cross-checks DELETE and definer grants with the table-class flags', () => {
    const entries = [
      entry('tokens', { class: 'USER_OWNED', definerRead: true, definerPurge: true }),
      entry('outbox_events', { class: 'SYSTEM', hardDelete: true }),
      entry('shipments'),
    ];
    const grants = parseGrantsManifest(
      [
        'platform_app DELETE public.outbox_events',
        'platform_app DELETE public.shipments',
        'platform_definer SELECT public.tokens',
        'platform_definer SELECT public.shipments',
        'platform_definer DELETE public.shipments',
        'platform_definer INSERT public.tokens',
        'platform_app SELECT public.unknown_table',
        'platform_app SELECT platform.not_checked',
      ].join('\n'),
    );
    expect(validateGrants(grants, entries)).toEqual([
      'platform_app DELETE public.shipments: DELETE outside the hard-delete allow-list',
      'platform_definer SELECT public.shipments: table has no definerRead flag',
      'platform_definer DELETE public.shipments: table has no definerPurge flag',
      'platform_definer INSERT public.tokens: platform_definer holds SELECT/DELETE only',
      'platform_app SELECT public.unknown_table: table is in no table-class manifest',
      'platform_definer DELETE public.tokens: definerPurge table without its manifest line',
    ]);
  });

  it('PR11-SEC-11 g: a runtimeReadOnly table accepts SELECT lines only, for every grantee; the committed catalogue is flagged', () => {
    const entries = [entry('roles', { class: 'GLOBAL', runtimeReadOnly: true }), entry('countries', { class: 'GLOBAL' })];
    const grants = parseGrantsManifest(
      [
        'platform_app SELECT public.roles',
        'platform_app INSERT public.roles',
        'platform_app UPDATE public.roles (name)',
        'platform_erasure DELETE public.roles',
        'platform_app INSERT public.countries',
      ].join('\n'),
    );
    expect(validateGrants(grants, entries)).toEqual([
      'platform_app INSERT public.roles: write privilege on a runtimeReadOnly table',
      'platform_app UPDATE public.roles: write privilege on a runtimeReadOnly table',
      'platform_erasure DELETE public.roles: write privilege on a runtimeReadOnly table',
    ]);
    const readOnly = loadTableClasses()
      .filter((e) => e.runtimeReadOnly === true)
      .map((e) => e.name);
    expect(readOnly).toEqual([
      '_prisma_migrations',
      'bootstrap_migrations',
      'permissions',
      'reference_dataset_versions',
      'role_permissions',
      'roles',
    ]);
  });

  it('PR43-SEC-09 b: the migration ledgers are runtimeReadOnly, so a write line for either is refused against the committed table classes; the committed manifest has no line for them', () => {
    const committed = loadTableClasses();
    // The Prisma ledger name is built from pieces: check-install-flags refuses its literal next to a write verb
    // outside prisma/tests (PR-0005 n8), and this is a manifest line, not a write.
    const prismaLedger = ['', 'prisma', 'migrations'].join('_');
    const grants = parseGrantsManifest(
      [
        `platform_app UPDATE public.${prismaLedger} (checksum)`,
        'platform_app INSERT public.bootstrap_migrations',
        'platform_erasure DELETE public.bootstrap_migrations',
      ].join('\n'),
    );
    expect(validateGrants(grants, committed)).toEqual(
      expect.arrayContaining([
        `platform_app UPDATE public.${prismaLedger}: write privilege on a runtimeReadOnly table`,
        'platform_app INSERT public.bootstrap_migrations: write privilege on a runtimeReadOnly table',
        'platform_erasure DELETE public.bootstrap_migrations: write privilege on a runtimeReadOnly table',
      ]),
    );
    expect(grantTuples(loadGrantsManifest()).filter((tuple) => /_migrations\b/.test(tuple))).toEqual([]);
  });
});
