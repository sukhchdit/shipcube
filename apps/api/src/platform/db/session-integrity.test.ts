import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import {
  createSessionIntegrityGuard,
  evaluateSessionIntegrity,
  EXPECTED_ROLE_SETTINGS,
  SESSION_INTEGRITY_SQL,
  SessionIntegrityError,
  type SessionIntegrityFinding,
  TENANT_CONTEXT_KEYS,
} from './session-integrity.js';

const unset = TENANT_CONTEXT_KEYS.map(() => null);

/** Repository root from this file (apps/api/src/platform/db). */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('database session integrity (PR7-SEC-06 item 3, PR7-SEC-02 item 2)', () => {
  it('expects exactly the platform_app settings of prisma/bootstrap/00-roles.sql', () => {
    const sql = readFileSync(join(REPO_ROOT, 'prisma', 'bootstrap', '00-roles.sql'), 'utf8');
    const fromBootstrap = [...sql.matchAll(/^ALTER ROLE platform_app SET (\w+) = (.+?);/gmu)]
      .map(([, name, value]) => `${name ?? ''}=${(value ?? '').replace(/^'|'$/gu, '')}`)
      .sort();
    expect(fromBootstrap).toEqual([...EXPECTED_ROLE_SETTINGS]);
  });

  it('the probe reads catalogs and the four tenant-context keys only, with no bind parameter', () => {
    for (const key of TENANT_CONTEXT_KEYS) expect(SESSION_INTEGRITY_SQL).toContain(`current_setting('${key}', true)`);
    expect(SESSION_INTEGRITY_SQL).not.toMatch(/\$\d/u);
  });

  it.each<[string, readonly string[], readonly (string | null)[], readonly SessionIntegrityFinding[]]>([
    ['intact', EXPECTED_ROLE_SETTINGS, unset, []],
    ['intact after a transaction-local set_config (empty values)', EXPECTED_ROLE_SETTINGS, TENANT_CONTEXT_KEYS.map(() => ''), []],
    ['a reset role setting', EXPECTED_ROLE_SETTINGS.slice(1), unset, ['db_role_setting_drift']],
    [
      'an added default_transaction_read_only',
      [...EXPECTED_ROLE_SETTINGS, 'default_transaction_read_only=on'],
      unset,
      ['db_role_setting_drift'],
    ],
    [
      'a changed lock_timeout',
      ['idle_in_transaction_session_timeout=15s', 'lock_timeout=0', 'search_path=pg_catalog, public'],
      unset,
      ['db_role_setting_drift'],
    ],
    [
      'a preset tenant context',
      EXPECTED_ROLE_SETTINGS,
      ['00000000-0000-0000-0000-000000000001', null, null, null],
      ['db_session_default_tampered'],
    ],
  ])('%s', (_title, settings, context, expected) => {
    expect(evaluateSessionIntegrity({ settings, context })).toEqual(expected);
  });

  it('the start-up probe on a fresh connection requires NULL; an empty value there is tampering', () => {
    const empty = TENANT_CONTEXT_KEYS.map(() => '');
    expect(evaluateSessionIntegrity({ settings: EXPECTED_ROLE_SETTINGS, context: empty }, { freshConnection: true })).toEqual([
      'db_session_default_tampered',
    ]);
    expect(evaluateSessionIntegrity({ settings: EXPECTED_ROLE_SETTINGS, context: unset }, { freshConnection: true })).toEqual([]);
  });

  it('checks at the first probe, then at most once per interval; one security event per detection, findings only', async () => {
    let clock = 0;
    let row: { settings: readonly string[]; context: readonly (string | null)[] } = { settings: EXPECTED_ROLE_SETTINGS, context: unset };
    const queries: string[] = [];
    const events: (readonly SessionIntegrityFinding[])[] = [];
    const guard = createSessionIntegrityGuard({
      pool: { query: (text) => Promise.resolve(void queries.push(text)).then(() => ({ rows: [row] })) },
      onDrift: (findings) => events.push(findings),
      intervalMs: 1_000,
      now: () => clock,
    });
    await guard.assertIntact();
    await guard.assertIntact();
    expect(queries).toHaveLength(1);

    row = { settings: [...EXPECTED_ROLE_SETTINGS, 'statement_timeout=0'], context: unset };
    clock = 1_000;
    await expect(guard.assertIntact()).rejects.toBeInstanceOf(SessionIntegrityError);
    clock = 2_000;
    await expect(guard.assertIntact()).rejects.toThrow('db_role_setting_drift');
    expect(events).toEqual([['db_role_setting_drift']]);
    expect(JSON.stringify(events)).not.toContain('statement_timeout');

    row = { settings: EXPECTED_ROLE_SETTINGS, context: unset };
    clock = 3_000;
    await expect(guard.assertIntact()).resolves.toBeUndefined();
  });

  it('a malformed probe result fails closed', async () => {
    const guard = createSessionIntegrityGuard({ pool: { query: () => Promise.resolve({ rows: [] }) }, onDrift: () => undefined });
    await expect(guard.assertIntact()).rejects.toThrow('no row');
  });
});
