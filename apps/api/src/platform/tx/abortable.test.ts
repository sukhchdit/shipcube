// Deadline enforcement helpers of the tx slot and the afterCommit queue (PR #44 R1-M1, PR44-SEC-02, D-ORCH-069).
import { setTimeout as delay } from 'node:timers/promises';

import { describe, expect, it } from '@jest/globals';

import { abortable, deadline } from './abortable.js';

describe('abortable', () => {
  it('settles like the work when the signal never aborts', async () => {
    const controller = new AbortController();
    await expect(abortable(Promise.resolve(7), controller.signal)).resolves.toBe(7);
    await expect(abortable(Promise.reject(new TypeError('work failed')), controller.signal)).rejects.toThrow(TypeError);
    await expect(abortable(8, controller.signal)).resolves.toBe(8);
  });

  it('rejects with the signal reason as soon as the signal aborts, without waiting for work that never settles', async () => {
    const controller = new AbortController();
    const reason = new Error('deadline');
    const pending = abortable(new Promise<never>(() => undefined), controller.signal);
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
  });

  it('rejects at once for a signal that has already aborted', async () => {
    const reason = new Error('gone');
    await expect(abortable(Promise.resolve(1), AbortSignal.abort(reason))).rejects.toBe(reason);
  });

  it('consumes a later rejection of abandoned work (no unhandled rejection)', async () => {
    const controller = new AbortController();
    let fail: (error: Error) => void = () => undefined;
    const work = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    const pending = abortable(work, controller.signal);
    controller.abort(new Error('deadline'));
    await expect(pending).rejects.toThrow('deadline');
    const unhandled: unknown[] = [];
    const onUnhandled = (reason: unknown): void => {
      unhandled.push(reason);
    };
    process.on('unhandledRejection', onUnhandled);
    try {
      fail(new Error('late'));
      await delay(20);
      expect(unhandled).toEqual([]);
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  it('removes its abort listener once the work settles', async () => {
    const controller = new AbortController();
    let listeners = 0;
    const signal = controller.signal;
    const add = signal.addEventListener.bind(signal);
    const remove = signal.removeEventListener.bind(signal);
    signal.addEventListener = (...args: Parameters<typeof add>) => {
      listeners += 1;
      add(...args);
    };
    signal.removeEventListener = (...args: Parameters<typeof remove>) => {
      listeners -= 1;
      remove(...args);
    };
    await abortable(Promise.resolve('done'), signal);
    expect(listeners).toBe(0);
  });
});

describe('deadline', () => {
  it('aborts with the given reason after the time, and not when cleared first', async () => {
    const reason = new Error('late');
    const fired = deadline(10, () => reason);
    const cleared = deadline(10, () => new Error('never'));
    cleared.clear();
    await delay(40);
    expect([fired.signal.aborted, fired.signal.reason, cleared.signal.aborted]).toEqual([true, reason, false]);
  });
});
