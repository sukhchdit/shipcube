/**
 * Test helper (TASK-020, PR #38 code review R1-n1): the per-test timeout of suites that compose createApp and make real
 * loopback requests. The 5 s Jest default timed out under parallel host load in the heavy lane (runs 20261113T2208Z
 * and 20261113T2226Z, never in isolation); one case takes about 15-100 ms alone, so 60 s is wide headroom, not a mask.
 * One constant, so a later change reaches every such file. Never imported by production code.
 */
import { request as httpRequest, type Server } from 'node:http';

export const LOOPBACK_TEST_TIMEOUT_MS = 60_000;

/**
 * Upper-bound slack of the "answers within X" timing checks (W0-FLAKE). A lower bound (the deadline really elapsed)
 * stays exact; an upper bound only has to tell "the deadline fired" from "the call hung or ran to a far longer limit"
 * (tens of seconds), so it is the deadline plus this slack, not the deadline plus a few hundred ms that a loaded host
 * overshoots. Never imported by production code.
 */
export const HOST_LOAD_SLACK_MS = 20_000;

/**
 * Closes a loopback test server and every socket still open on it. `server.close()` alone waits for the keep-alive
 * connection that `fetch` keeps open (a connection the server has not yet marked idle is not dropped by Node), so under
 * host load a probe could sit in `close()` until the keep-alive timeout; the response was already read in full.
 */
export function closeLoopbackServer(server: Server): Promise<void> {
  return new Promise<void>((resolve) => {
    server.close(() => resolve());
    server.closeAllConnections();
  });
}

/**
 * Measures how long `operation` took and how much of that the host stole (W0-FLAKE). A heartbeat timer notes every tick
 * that fires later than scheduled; the sum of that lateness is the time this process was not running (host load, GC,
 * a suspended process). `ms` is the raw elapsed time, so a lower bound ("the deadline really elapsed") stays exact;
 * `workMs` is `ms` minus the stalls, so an upper bound ("the deadline fired, the call did not run on to a far longer
 * limit") no longer depends on how long the host froze the process. Never imported by production code.
 */
export async function timeOperation<T>(
  operation: () => Promise<T>,
): Promise<{ readonly value: T; readonly ms: number; readonly workMs: number }> {
  const tickMs = 20;
  const started = performance.now();
  let last = started;
  let stalledMs = 0;
  const heartbeat = setInterval(() => {
    const now = performance.now();
    stalledMs += Math.max(0, now - last - tickMs);
    last = now;
  }, tickMs);
  try {
    const value = await operation();
    const now = performance.now();
    stalledMs += Math.max(0, now - last - tickMs);
    return { value, ms: now - started, workMs: Math.max(0, now - started - stalledMs) };
  } finally {
    clearInterval(heartbeat);
  }
}

/**
 * A one-shot HTTP request to a loopback test server that returns a fetch `Response`: a fresh socket (`agent: false`,
 * `Connection: close`) and no connection pool. Under host load the global fetch dispatcher left a connect that the server
 * had accepted without ever delivering its request (the pooled client for a recycled ephemeral port, or one idled out during
 * a stall); the case then waited for the whole test budget (W0-FLAKE). The response is read in full before it is returned.
 * Only string and byte bodies, no redirects. Never imported by production code.
 */
export function fetchOnce(url: string, init: RequestInit = {}): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    const target = new URL(url);
    const headers: Record<string, string> = {};
    new Headers(init.headers).forEach((value, name) => {
      headers[name] = value;
    });
    headers['connection'] = 'close';
    const request = httpRequest(
      {
        hostname: target.hostname,
        port: target.port,
        path: `${target.pathname}${target.search}`,
        method: init.method ?? 'GET',
        headers,
        agent: false,
      },
      (response) => {
        const chunks: Buffer[] = [];
        response.on('data', (chunk: Buffer) => chunks.push(chunk));
        response.on('error', reject);
        response.on('end', () => {
          const answered = new Headers();
          for (const [name, value] of Object.entries(response.headers)) {
            if (Array.isArray(value)) for (const item of value) answered.append(name, item);
            else if (value !== undefined) answered.set(name, value);
          }
          const status = response.statusCode ?? 0;
          const withoutBody = status === 101 || status === 204 || status === 205 || status === 304;
          resolve(
            new Response(withoutBody ? null : Buffer.concat(chunks), {
              status,
              statusText: response.statusMessage ?? '',
              headers: answered,
            }),
          );
        });
      },
    );
    request.on('error', reject);
    const { body } = init;
    if (typeof body === 'string' || body instanceof Uint8Array) request.write(body);
    else if (body !== undefined && body !== null) reject(new Error('fetchOnce: only string and byte bodies'));
    request.end();
  });
}
