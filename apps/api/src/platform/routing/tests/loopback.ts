/**
 * Test helper (TASK-020, PR #38 code review R1-n1): the per-test timeout of suites that compose createApp and make real
 * loopback requests. The 5 s Jest default timed out under parallel host load in the heavy lane (runs 20261113T2208Z
 * and 20261113T2226Z, never in isolation); one case takes about 15-100 ms alone, so 20 s is wide headroom, not a mask.
 * One constant, so a later change reaches every such file. Never imported by production code.
 */
import type { Server } from 'node:http';

export const LOOPBACK_TEST_TIMEOUT_MS = 20_000;

/**
 * Upper-bound slack of the "answers within X" timing checks (W0-FLAKE). A lower bound (the deadline really elapsed)
 * stays exact; an upper bound only has to tell "the deadline fired" from "the call hung or ran to a far longer limit"
 * (tens of seconds), so it is the deadline plus this slack, not the deadline plus a few hundred ms that a loaded host
 * overshoots. Never imported by production code.
 */
export const HOST_LOAD_SLACK_MS = 5_000;

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
