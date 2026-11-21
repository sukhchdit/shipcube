---
name: project-p5-pr57-task288
description: PR #57 (TASK-288 flake2, reader lock + Jest shim) R1 @4c3d13a PASS_W_COND; R2 @4f1fbd5 PASS_W_F-U; R3 narrow @a5f94b0 PASS_W_F-U (af219c6, pushed with code r3 c8cc4f2); SEC-01/03/04/05 closed, C1 met; SEC-02 -> TASK-287; lock probe and hang-mutant facts
metadata:
  type: project
---

Record `docs/05-quality/security/PR-0057-TASK-288-security-review.md` on `test/TASK-288-flake2`: R1 committed `30ca878` (head `4c3d13a`, PASS_WITH_CONDITIONS), R2 delta appended and committed `b53d254` (head `4f1fbd5`, PASS_WITH_FOLLOW-UPS), pushed once 2026-11-17 under D-ORCH-119 (one combined record push per round; pull first, code twin stacks on top).

- **C1 met at 4f1fbd5:** restricted run `20261117T0646Z_4f1fbd5` (catalog 102, integration 315, rls 126, all 0/0/0) lives in the shared scratchpad `c1-out3/tests/runs/`; I verified summary sha/dirty/hashes against JUnit. Restricted runs are INVALID by design.
- **Closed in R2:** SEC-01 (root `<checkout>/node_modules/.cache/shipqube-test-locks`, lstat refusal of the readers path; P5a 3/3 victims kept), SEC-03 (tombstone take-over + put-back + `LostTestLockError`; residuals: two-rename put-back window lets a reader in (P2t), owner write not `wx` so a >30 s-starved writer overwrites a re-created lock (P1e)), SEC-04 (strict `<pid>-<uuid>`, junk ignored). 7 security-fix mutants each killed by one PR case.
- **New PR57-SEC-05 INFO** (CWE-835): `withFileLock` stale branch `takeOverStale(); continue;` spins without deadline or await when the rename fails (EBUSY: a process with cwd inside); P7 writer never returned (12 s watchdog), reader honoured deadline. Owner: next touch of fs-lock.ts (W0-FLAKE-3).
- **PR57-SEC-02 LOW** open, routed (D-SEC-PR57-01): trigger-list additions; TASK-287 note: exclude `node_modules/.cache/shipqube-test-locks/` from any node_modules cache.

**Facts:** Windows Node 24 `process.kill(0, 0)` does not throw; `fs.rmSync(junction, {recursive, force})` and `rmdirSync(junction)` remove the link only; a dir that is a live process's cwd cannot be renamed (EBUSY). Production import of `tools/**` is refused only by `import-x/no-relative-packages`. Mutation kit that worked: `git archive` of `package.json jest.config.ts tools/test-support tools/test-dom tools/deps tools/db/prisma-client-locked.cjs tests/api/helpers/coverage-teardown.ts`, empty root dirs, `node_modules` of junctions to the PR worktree's entries minus `.cache`/`.bin`, `jest --selectProjects unit --runInBand --json` (scratch `review/PR-57-sec/r2/mut.mjs`, session-scoped).

**R3 (2026-11-17, narrow `b53d254..a5f94b0`):** SEC-05 closed (cwd-held stale lock now throws at 1.5 s, 52 ticks; r2 copy spins), SEC-03 residual (b) closed by `wx` owner write (P1w bypass on r2 copy, none on r3). C1 rerun `20261117T1051Z_a5f94b0` verified (scratch `c1-fc2b/`). Mutants N1/N2 killed only by HANG (spinning loop blocks Jest timeouts: use a 400 s outer spawn timeout and expect ETIMEDOUT); N3 (no wx) survives, race-only accepted. Push protocol D-ORCH-119: wait for the code twin local commit in the shared worktree, commit on top, push once. A Win32_Process listing to find orphaned IDLE children was denied by the auto-mode classifier: do not retry; note it instead.

Related: [[project-p5-pr52-pr53]], [[project-p5-pr53-r2]], [[project-p5-pr46-015b-lane-c]], [[project-security-review-conventions]]
