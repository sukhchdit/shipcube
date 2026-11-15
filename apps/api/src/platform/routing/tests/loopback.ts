/**
 * Test helper (TASK-020, PR #38 code review R1-n1): the per-test timeout of suites that compose createApp and make real
 * loopback requests. The 5 s Jest default timed out under parallel host load in the heavy lane (runs 20261113T2208Z
 * and 20261113T2226Z, never in isolation); one case takes about 15-100 ms alone, so 60 s is wide headroom, not a mask.
 * One constant, so a later change reaches every such file. Never imported by production code.
 */
import type { Server } from 'node:http';

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
 * `fetch` that never reuses a pooled socket (`Connection: close`). Each probe runs against its own short-lived server on an
 * ephemeral port; a pooled socket to a previous server on a recycled port, or one the server idled out during a host stall,
 * is reset or hangs the next request (W0-FLAKE). The response is read in full by the caller. Never imported by production code.
 */
export function fetchOnce(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set('connection', 'close');
  return fetch(url, { ...init, headers });
}
