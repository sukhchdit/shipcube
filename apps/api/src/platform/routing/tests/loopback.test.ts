/**
 * The loopback test helpers themselves (PR #53 code review R1-m1, R1-m2, R1-n1): a helper that decides whether a deadline
 * test passes must be tested, or a bug in it hides a regression in the product.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { closeLoopbackServer, fetchOnce, FetchOnceTimeoutError, LOOPBACK_TEST_TIMEOUT_MS } from './loopback.js';
import { HEARTBEAT_JITTER_MS, HEARTBEAT_TICK_MS, recordAbortTimeouts, stallBooked, timeOperation } from './timing.js';

jest.setTimeout(LOOPBACK_TEST_TIMEOUT_MS);

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => closeLoopbackServer(server)));
});

async function serve(handler: (request: IncomingMessage, response: ServerResponse) => void): Promise<{ url: string; hits: () => number }> {
  let hits = 0;
  const server = createServer((request, response) => {
    hits += 1;
    handler(request, response);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`, hits: () => hits };
}

describe('fetchOnce (test helper)', () => {
  it('returns status, every Set-Cookie value and the body', async () => {
    const { url } = await serve((_request, response) => {
      response.writeHead(201, { 'set-cookie': ['a=1', 'b=2'], 'content-type': 'text/plain' });
      response.end('hello');
    });
    const response = await fetchOnce(`${url}/x?y=1`);
    expect(response.status).toBe(201);
    expect(response.headers.getSetCookie()).toEqual(['a=1', 'b=2']);
    expect(await response.text()).toBe('hello');
  });

  it('sends a string body with Content-Length, not chunked (as fetch does)', async () => {
    let seen: IncomingMessage['headers'] = {};
    const { url } = await serve((request, response) => {
      seen = request.headers;
      response.end();
    });
    await fetchOnce(url, { method: 'POST', body: 'payload' });
    expect(seen['content-length']).toBe('7');
    expect(seen['transfer-encoding']).toBeUndefined();
  });

  it('refuses an unsupported body BEFORE anything is sent', async () => {
    const { url, hits } = await serve((_request, response) => response.end());
    await expect(fetchOnce(url, { method: 'POST', body: new URLSearchParams({ a: '1' }) })).rejects.toThrow(/only string and byte bodies/);
    expect(hits()).toBe(0);
  });

  it('rejects an already-aborted signal without sending the request', async () => {
    const { url, hits } = await serve((_request, response) => response.end());
    await expect(fetchOnce(url, { signal: AbortSignal.abort(new Error('stop')) })).rejects.toThrow('stop');
    expect(hits()).toBe(0);
  });

  it('a signal aborted while waiting destroys the request', async () => {
    const { url } = await serve(() => undefined);
    const controller = new AbortController();
    const pending = fetchOnce(url, { signal: controller.signal });
    setTimeout(() => controller.abort(new Error('caller gave up')), 50);
    await expect(pending).rejects.toThrow('caller gave up');
  });

  it('a server that never answers fails with the named error naming the method and path', async () => {
    const { url } = await serve(() => undefined);
    const outcome = fetchOnce(`${url}/health/ready`, { method: 'GET' }, { deadlineMs: 150 });
    await expect(outcome).rejects.toBeInstanceOf(FetchOnceTimeoutError);
    await expect(fetchOnce(`${url}/health/ready`, {}, { deadlineMs: 100 })).rejects.toThrow(
      'fetchOnce: no response from GET /health/ready within 100 ms',
    );
  });
});

describe('timeOperation (test helper)', () => {
  it('the live wait only asserts load-proof facts: the raw elapsed time has a lower bound and workMs never exceeds it', async () => {
    const { ms, workMs } = await timeOperation(() => new Promise<void>((resolve) => setTimeout(resolve, 600)));
    expect(ms).toBeGreaterThanOrEqual(550);
    expect(workMs).toBeLessThanOrEqual(ms);
  });

  it.each([
    [0, 0],
    [HEARTBEAT_JITTER_MS - 20, 0],
    [HEARTBEAT_JITTER_MS, 0],
    [HEARTBEAT_JITTER_MS + 1, HEARTBEAT_JITTER_MS + 1],
    [400, 400],
    [-5, 0],
  ])('a tick %i ms late books %i ms of stall (the threshold, deterministic)', (late, booked) => {
    expect(stallBooked(late)).toBe(booked);
  });

  it('an asynchronous wait is not hidden: with a heartbeat that arrives on schedule workMs equals ms (fake clock)', async () => {
    jest.useFakeTimers();
    try {
      const pending = timeOperation(() => new Promise<void>((resolve) => setTimeout(resolve, 600)));
      await jest.advanceTimersByTimeAsync(600);
      const { ms, workMs } = await pending;
      expect(ms).toBe(600);
      expect(workMs).toBe(600);
      expect(HEARTBEAT_TICK_MS).toBeLessThan(600);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a stall above the jitter threshold is subtracted from workMs but not from ms', async () => {
    const { ms, workMs } = await timeOperation(
      () =>
        new Promise<void>((resolve) => {
          setTimeout(() => {
            const end = performance.now() + 400;
            while (performance.now() < end) {
              // Block the event loop: stands in for a frozen process.
            }
          }, 50);
          setTimeout(resolve, 700);
        }),
    );
    expect(ms).toBeGreaterThanOrEqual(650);
    expect(workMs).toBeLessThan(ms - 300);
  });
});

describe('recordAbortTimeouts (test helper)', () => {
  it('records the configured values, calls through, and restores the original', () => {
    const before = AbortSignal.timeout;
    const timers = recordAbortTimeouts();
    const signal = AbortSignal.timeout(12_345);
    expect(signal.aborted).toBe(false);
    expect(timers.calls).toEqual([12_345]);
    timers.restore();
    expect(AbortSignal.timeout).toBe(before);
  });
});
