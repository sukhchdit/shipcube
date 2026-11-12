import { describe, expect, it } from '@jest/globals';

import { createDatabaseCheck } from '../db/health-check.js';
import { createRuntimeLog } from './log.js';
import { createShutdown, type ShutdownOptions } from './shutdown.js';

function harness(overrides: Partial<ShutdownOptions> = {}) {
  const lines: string[] = [];
  const exits: number[] = [];
  let draining = false;
  const options: ShutdownOptions = {
    probe: { startDraining: () => void (draining = true) },
    drain: () => Promise.resolve(),
    resources: [{ name: 'database', close: () => Promise.resolve() }],
    log: createRuntimeLog('api', { write: (line: string) => lines.push(line) }, () => new Date(0)),
    exit: (code) => void exits.push(code),
    drainTimeoutMs: 50,
    closeTimeoutMs: 50,
    ...overrides,
  };
  return { shutdown: createShutdown(options), lines, exits, isDraining: () => draining };
}

const events = (lines: readonly string[]): string[] => lines.map((line) => (JSON.parse(line) as { event: string }).event);

describe('graceful shutdown (NFR-AVAIL-002)', () => {
  it('drains, closes resources and exits 0; readiness turns 503 first; a second signal is a no-op', async () => {
    const order: string[] = [];
    const h = harness({
      probe: { startDraining: () => void order.push('draining') },
      drain: () => Promise.resolve(void order.push('drained')),
      resources: [{ name: 'valkey', close: () => Promise.resolve(void order.push('closed')) }],
    });
    await Promise.all([h.shutdown('SIGTERM'), h.shutdown('SIGINT')]);
    expect(order).toEqual(['draining', 'drained', 'closed']);
    expect(h.exits).toEqual([0]);
    expect(events(h.lines)).toEqual(['shutdown.start', 'shutdown.done']);
    expect(JSON.parse(h.lines[0] ?? '{}')).toEqual({
      level: 'info',
      time: new Date(0).toISOString(),
      service: 'api',
      event: 'shutdown.start',
      signal: 'SIGTERM',
    });
  });

  it('a drain that exceeds its bound forces the connections closed and exits 1', async () => {
    let forced = false;
    const h = harness({ drain: () => new Promise<void>(() => undefined), forceClose: () => void (forced = true) });
    await h.shutdown('SIGTERM');
    expect(forced).toBe(true);
    expect(h.isDraining()).toBe(true);
    expect(events(h.lines)).toContain('shutdown.drain_timeout');
    expect(h.exits).toEqual([1]);
  });

  it('failed or hanging resources are logged by class name only and the exit code is 1', async () => {
    const h = harness({
      drain: () => Promise.reject(new RangeError('server not running')),
      resources: [
        { name: 'database', close: () => Promise.reject(new Error('password=hunter2')) },
        { name: 'valkey', close: () => new Promise<void>(() => undefined) },
      ],
    });
    await h.shutdown('SIGTERM');
    expect(events(h.lines)).toEqual([
      'shutdown.start',
      'shutdown.drain_failed',
      'shutdown.close_failed',
      'shutdown.close_timeout',
      'shutdown.done',
    ]);
    expect(h.lines.join('')).not.toContain('hunter2');
    expect(h.exits).toEqual([1]);
  });

  it('the database check runs SELECT 1 and honours an aborted signal', async () => {
    const queries: string[] = [];
    const check = createDatabaseCheck({ query: (text: string) => Promise.resolve(void queries.push(text)) });
    await check.check(new AbortController().signal);
    expect(queries).toEqual(['SELECT 1']);
    await expect(check.check(AbortSignal.abort())).rejects.toThrow();
    expect(check).toMatchObject({ name: 'database', critical: true });
  });
});
