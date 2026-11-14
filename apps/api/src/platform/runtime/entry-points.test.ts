/**
 * Boot order of the two entry points (D-ARCH-104 (1)-(3), PR11-SEC-09 items 1 and 3; TASK-020 part 020-B). The entry
 * modules run top-level side effects (process handlers, listeners), so they are read as source text, not imported:
 * each calls createRuntimeServices exactly once (one composition, no second runner, no Prisma class passed in), awaits
 * startup() (the fresh-connection probe is the first pool query) before it listens or takes work, and the API hands
 * the runtime's runner to createApp.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

const APPS = join(import.meta.dirname, '..', '..', '..', '..');
const source = (app: 'api' | 'worker'): string => readFileSync(join(APPS, app, 'src', 'main.ts'), 'utf8');

/** Offset of the single occurrence of `needle` (fails when it is missing or repeated). */
function only(text: string, needle: string): number {
  const first = text.indexOf(needle);
  expect({ needle, found: first !== -1, repeated: first !== -1 && text.indexOf(needle, first + 1) !== -1 }).toEqual({
    needle,
    found: true,
    repeated: false,
  });
  return first;
}

describe('[D-ARCH-104] entry-point boot order', () => {
  it.each([
    ['api', "createRuntimeServices(config, 'api', log, secrets)", 'app.listen('],
    ['worker', "createRuntimeServices(config, 'worker', log, secrets)", 'server.listen('],
  ] as const)('%s: one composition, startup() awaited before it listens or takes work', (app, composition, listen) => {
    const text = source(app);
    const composed = only(text, composition);
    const started = only(text, 'await services.startup();');
    const listening = only(text, listen);
    expect(composed).toBeLessThan(started);
    expect(started).toBeLessThan(listening);
    // No entry point builds or passes a Prisma client (the class lives in platform/db/generated.ts only).
    expect(text).not.toMatch(/PrismaClient|@platform\/prisma|db\/generated\.js/u);
  });

  it('api: createApp receives the runtime runner (the tx slot of every tenant route)', () => {
    const text = source('api');
    expect(only(text, 'tenantTx: services.tenantTx')).toBeLessThan(only(text, 'await services.startup();'));
  });

  it('api: one afterCommit queue is passed to createApp and drained by the shutdown drain after server.close (PR #44 R1-m3)', () => {
    const text = source('api');
    const created = only(text, 'const afterCommit = createAfterCommitQueue(log);');
    const composed = only(text, 'app = createApp({');
    const passed = only(text, '    afterCommit,\n');
    const composedEnd = text.indexOf('});', composed);
    expect([created < composed, composed < passed, passed < composedEnd]).toEqual([true, true, true]);
    // The drain: listener first, then the queue in a finally (also when closing the listener fails).
    const drain = only(text, 'drain: async () => {');
    const closed = only(text, 'server.close(');
    const finallyAt = text.indexOf('} finally {', closed);
    const drained = only(text, 'await afterCommit.drain();');
    expect([drain < closed, closed < finallyAt, finallyAt !== -1 && finallyAt < drained]).toEqual([true, true, true]);
    expect(drained).toBeLessThan(only(text, 'forceClose:'));
  });
});
