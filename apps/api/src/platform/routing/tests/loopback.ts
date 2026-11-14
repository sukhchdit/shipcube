/**
 * Test helper (TASK-020, PR #38 code review R1-n1): the per-test timeout of suites that compose createApp and make real
 * loopback requests. The 5 s Jest default timed out under parallel host load in the heavy lane (runs 20261113T2208Z
 * and 20261113T2226Z, never in isolation); one case takes about 15-100 ms alone, so 20 s is wide headroom, not a mask.
 * One constant, so a later change reaches every such file. Never imported by production code.
 */
export const LOOPBACK_TEST_TIMEOUT_MS = 20_000;
