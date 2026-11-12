import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import {
  createSessionIntegrityGuard,
  type DedicatedConnection,
  evaluateSessionIntegrity,
  EXPECTED_ROLE_SETTINGS,
  SESSION_INTEGRITY_SQL,
  SESSION_INTEGRITY_INTERVAL_MS,
  SessionIntegrityError,
  type SessionIntegrityFinding,
  type SessionIntegrityRow,
  startIntegrityMonitor,
  TENANT_CONTEXT_KEYS,
} from './session-integrity.js';

const unset = TENANT_CONTEXT_KEYS.map(() => null);

/** Repository root from this file (apps/api/src/platform/db). */
const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');

describe('database session integrity (PR7-SEC-06 item 3, PR7-SEC-02 item 2)', () => {
  it('[D-ORCH-014 (a)] expects exactly the platform_app settings of EVERY prisma/bootstrap/*.sql file', () => {
    const dir = join(REPO_ROOT, 'prisma', 'bootstrap');
    const files = readdirSync(dir).filter((name) => name.endsWith('.sql'));
    expect(files).toEqual(expect.arrayContaining(['00-roles.sql', '02-role-backstops.sql']));
    const fromBootstrap = files
      .flatMap((name) => [
        ...readFileSync(join(dir, name), 'utf8').matchAll(
          /^ALTER ROLE "?platform_app"? (?:IN DATABASE \S+ )?SET (\w+) (?:=|TO) (.+?);/gimu,
        ),
      ])
      .map(([, name, value]) => `${(name ?? '').toLowerCase()}=${(value ?? '').replace(/^'|'$/gu, '')}`)
      .sort();
    expect(fromBootstrap).toEqual([...EXPECTED_ROLE_SETTINGS]);
    expect(EXPECTED_ROLE_SETTINGS).toEqual(expect.arrayContaining(['statement_timeout=30s', 'lc_messages=C']));
  });

  it('the probe reads catalogs and the four tenant-context keys only, with no bind parameter', () => {
    for (const key of TENANT_CONTEXT_KEYS) expect(SESSION_INTEGRITY_SQL).toContain(`current_setting('${key}', true)`);
    expect(SESSION_INTEGRITY_SQL).not.toMatch(/\$\d/u);
  });

  it.each<[string, readonly string[], readonly (string | null)[], readonly SessionIntegrityFinding[]]>([
    ['intact', EXPECTED_ROLE_SETTINGS, unset, []],
    ['intact after a transaction-local context write (empty values)', EXPECTED_ROLE_SETTINGS, TENANT_CONTEXT_KEYS.map(() => ''), []],
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

  /** A fake database: a pooled connection and dedicated connections, each answering its own row. */
  function fakeDatabase(initial: { pooled: SessionIntegrityRow; dedicated: SessionIntegrityRow }) {
    const state = { ...initial, connectFailures: 0 };
    const calls = { pooled: 0, dedicated: 0, ended: 0 };
    const pool = {
      query: () => {
        calls.pooled += 1;
        return Promise.resolve({ rows: [state.pooled] });
      },
    };
    const connectDedicated = (): Promise<DedicatedConnection> => {
      if (state.connectFailures > 0) {
        state.connectFailures -= 1;
        return Promise.reject(new Error('ECONNREFUSED'));
      }
      return Promise.resolve({
        query: () => {
          calls.dedicated += 1;
          return Promise.resolve({ rows: [state.dedicated] });
        },
        end: () => {
          calls.ended += 1;
          return Promise.resolve();
        },
      });
    };
    return { state, calls, pool, connectDedicated };
  }

  const intact: SessionIntegrityRow = { settings: EXPECTED_ROLE_SETTINGS, context: unset };
  /** A pooled connection after a transaction-local set_config: the key reads '' (ADR-0005 item 16, F-07). */
  const afterLocalSetConfig: SessionIntegrityRow = { settings: EXPECTED_ROLE_SETTINGS, context: TENANT_CONTEXT_KEYS.map(() => '') };

  it('[M1] start-up runs on a dedicated connection (NULL required); a pooled row with an empty value afterwards is not tampering', async () => {
    const db = fakeDatabase({ pooled: afterLocalSetConfig, dedicated: intact });
    const events: (readonly SessionIntegrityFinding[])[] = [];
    let clock = 0;
    const guard = createSessionIntegrityGuard({ ...db, onDrift: (f) => events.push(f), intervalMs: 1_000, now: () => clock });

    await expect(guard.recheck()).resolves.toBeUndefined();
    expect(db.calls).toEqual({ pooled: 0, dedicated: 1, ended: 1 });
    // The reviewer's scenario: readiness at 0 s, 60 s, 299.999 s (scaled) on a pooled connection that holds ''.
    for (const at of [0, 600, 999, 1_000, 2_500]) {
      clock = at;
      await expect(guard.assertIntact()).resolves.toBeUndefined();
    }
    expect(db.calls.dedicated).toBe(1);
    expect(db.calls.pooled).toBe(2);
    expect(events).toEqual([]);
  });

  it('[M1] an empty tenant-context value on the dedicated start-up connection is tampering, and is re-checked on a new dedicated connection every time', async () => {
    const db = fakeDatabase({ pooled: intact, dedicated: afterLocalSetConfig });
    const events: (readonly SessionIntegrityFinding[])[] = [];
    const guard = createSessionIntegrityGuard({ ...db, onDrift: (f) => events.push(f), now: () => 0 });

    await expect(guard.recheck()).rejects.toThrow('db_session_default_tampered');
    await expect(guard.assertIntact()).rejects.toBeInstanceOf(SessionIntegrityError);
    expect(db.calls).toEqual({ pooled: 0, dedicated: 2, ended: 2 });
    expect(events).toEqual([['db_session_default_tampered']]);

    db.state.dedicated = intact;
    await expect(guard.assertIntact()).resolves.toBeUndefined();
    expect(db.calls.dedicated).toBe(3);
  });

  it('[M1] a failing start-up (database unreachable) is not cached: the next check retries on a new dedicated connection', async () => {
    const db = fakeDatabase({ pooled: intact, dedicated: intact });
    db.state.connectFailures = 1;
    const guard = createSessionIntegrityGuard({ ...db, onDrift: () => undefined, now: () => 0 });
    await expect(guard.recheck()).rejects.toThrow('ECONNREFUSED');
    await expect(guard.assertIntact()).resolves.toBeUndefined();
    expect(db.calls).toEqual({ pooled: 0, dedicated: 1, ended: 1 });
  });

  it('[M1] drift is never cached for the interval: a fixed drift recovers on the next check; one event per transition, findings only', async () => {
    const db = fakeDatabase({ pooled: intact, dedicated: intact });
    const events: (readonly SessionIntegrityFinding[])[] = [];
    let clock = 0;
    const guard = createSessionIntegrityGuard({ ...db, onDrift: (f) => events.push(f), intervalMs: 1_000, now: () => clock });
    await guard.recheck();
    await guard.assertIntact();
    expect(db.calls.pooled).toBe(0);

    db.state.pooled = { settings: [...EXPECTED_ROLE_SETTINGS, 'statement_timeout=0'], context: unset };
    clock = 1_000;
    await expect(guard.assertIntact()).rejects.toBeInstanceOf(SessionIntegrityError);
    await expect(guard.assertIntact()).rejects.toThrow('db_role_setting_drift');
    expect(db.calls.pooled).toBe(2);
    expect(events).toEqual([['db_role_setting_drift']]);
    expect(JSON.stringify(events)).not.toContain('statement_timeout');

    db.state.pooled = intact;
    await expect(guard.assertIntact()).resolves.toBeUndefined();
    await expect(guard.assertIntact()).resolves.toBeUndefined();
    expect(db.calls.pooled).toBe(3);
  });

  it('concurrent checks share one evaluation', async () => {
    const db = fakeDatabase({ pooled: intact, dedicated: intact });
    const guard = createSessionIntegrityGuard({ ...db, onDrift: () => undefined });
    await Promise.all([guard.recheck(), guard.assertIntact(), guard.assertIntact()]);
    expect(db.calls).toEqual({ pooled: 0, dedicated: 1, ended: 1 });
  });

  it('a malformed probe result fails closed and the dedicated connection is still closed', async () => {
    const ended: boolean[] = [];
    const guard = createSessionIntegrityGuard({
      pool: { query: () => Promise.resolve({ rows: [] }) },
      connectDedicated: () =>
        Promise.resolve({ query: () => Promise.resolve({ rows: [] }), end: () => Promise.resolve(void ended.push(true)) }),
      onDrift: () => undefined,
    });
    await expect(guard.assertIntact()).rejects.toThrow('no row');
    expect(ended).toEqual([true]);
  });

  describe('[PR9-SEC-05] interval monitor, independent of readiness polling', () => {
    afterEach(() => {
      jest.useRealTimers();
    });

    it('re-checks on its own timer: drift at t + interval raises one event without any readiness call; close stops it', async () => {
      jest.useFakeTimers();
      const db = fakeDatabase({ pooled: intact, dedicated: intact });
      const events: (readonly SessionIntegrityFinding[])[] = [];
      const guard = createSessionIntegrityGuard({ ...db, onDrift: (f) => events.push(f), now: () => Date.now() });
      await guard.recheck();
      const monitor = startIntegrityMonitor(guard);

      db.state.pooled = { settings: EXPECTED_ROLE_SETTINGS.slice(1), context: unset };
      await jest.advanceTimersByTimeAsync(SESSION_INTEGRITY_INTERVAL_MS - 1);
      expect(events).toEqual([]);
      await jest.advanceTimersByTimeAsync(1);
      expect(events).toEqual([['db_role_setting_drift']]);
      await jest.advanceTimersByTimeAsync(SESSION_INTEGRITY_INTERVAL_MS);
      expect(events).toHaveLength(1);
      expect(db.calls.pooled).toBe(2);

      await monitor.close();
      await jest.advanceTimersByTimeAsync(3 * SESSION_INTEGRITY_INTERVAL_MS);
      expect(db.calls.pooled).toBe(2);
      expect(jest.getTimerCount()).toBe(0);
    });

    it('the timer is unref’d and swallows failures', async () => {
      const guard = { assertIntact: () => Promise.resolve(), recheck: () => Promise.reject(new Error('down')) };
      jest.useFakeTimers();
      const monitor = startIntegrityMonitor(guard, 10);
      await jest.advanceTimersByTimeAsync(30);
      await monitor.close();
      jest.useRealTimers();
      const spy = jest.spyOn(globalThis, 'setInterval');
      const real = startIntegrityMonitor(guard, 60_000);
      const timer = spy.mock.results[0]?.value as NodeJS.Timeout;
      expect(timer.hasRef()).toBe(false);
      await real.close();
      spy.mockRestore();
    });
  });
});
