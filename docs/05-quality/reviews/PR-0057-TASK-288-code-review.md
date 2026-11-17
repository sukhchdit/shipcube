# Code review: PR #57, TASK-288 `flake2` (= TASK-W0-FLAKE-2): prisma/generated reader lock and probe connect-timer race, round 1

Reviewer: code-reviewer (principal engineer). Head reviewed: `4c3d13a` (full SHA `4c3d13a00bd875e61976ff6c004b3fd7fcb4b021`, branch `test/TASK-288-flake2`); code head `c4a4462` (`4c3d13a` adds only the lane B evidence directory). Diff base: `git diff origin/main...4c3d13a` (12 files; 8 non-evidence files).

Specs checked against the code:
- the TASK-288 card (`docs/04-plan/tasks/WAVE-00.md` §TASK-288: files, acceptance lines, DoD notes);
- D-ORCH-083 (the race), D-ORCH-098 (the residual), D-ORCH-099, D-ARCH-136/137, D-SEC-PR53-01/-02 (standing rule: no wall-clock bounds);
- the developer decisions D-TASK288-01..08 in `docs/sdlc/DECISIONS.md` on `origin/main`;
- CLAUDE.md §2 and §8–9.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The reader/writer protocol is sound for the normal case: each side announces before it looks (reader file,
  then writer check; writer directory, then reader scan), a waiting reader holds nothing, so there is no cross-process
  deadlock, and writers win ties. The shim covers every static and dynamic `@platform/prisma/client` load in every
  project. The probe fix is right, and the tests are order-based with a real race control. 10 of my 12 mutants are
  killed. No BLOCKER or MAJOR. Four MINORs:
  - dead-owner take-over is a TOCTOU, so a reader can delete a live writer's fresh lock;
  - `<pid>-<n>` registration names collide across module instances and with a stale same-pid file (EEXIST crash, probed);
  - the WRITER test child never takes over a dead lock (shim test times out at 120 s on a stale lock, probed);
  - the writers-win-ties recheck and the own-process reader exemption are untested (two surviving mutants).
  Plus six NITs.
```

## 1. What I verified myself (and what I did not)

### 1.1 Gates

| Check | Result |
|---|---|
| `npm run typecheck` in the PR worktree (Node 24.22.3) | exit 0 |
| ESLint `--max-warnings 0` on the 8 changed non-evidence files (incl. the `.cjs` shim) | exit 0 |
| Prettier `--check` on the same 8 files | clean |
| Full `unit` project (`jest --selectProjects unit`, my run on the head) | **234 / 234 suites, 5,888 passed, 2 skipped, 0 failed** (209 s); this run includes the regenerating writers (`ignore-scripts`, `prisma-engines`) running in parallel with every client-loading suite |
| `fs-lock.test.ts` + `prisma-client-locked.test.ts` in a scratch copy (baseline for the mutants) | 17 / 17 |
| Lane A run 44005361656 on `4c3d13a` | fast-lane **success**. `scans` fails only on "Security-owned paths need a review record", so `ci-gate` fails on that. `security-integration` was **skipped** (see §4). |
| Lane B evidence `20261117T0234Z_c4a4462` | bound to the code head; verdict PASS (unit 5,954 / 0 failed / 2 skipped) |
| Loopback refused-connect latency on this host (`net.connect(1, '127.0.0.1')` ×5) | ECONNREFUSED in 1.5–5 ms. This is consistent with D-TASK288-03: only a starved child loses the race to a 2 s timer. Windows loopback retry is not the cause. |
| `process.kill(0, 0)` on Windows | "alive". An empty owner file (`Number('') = 0`) is therefore never taken over by `withFileLock` (line 169), so that pre-existing path is safe on this platform. |
| `rmSync(dir, {recursive})` vs 3 processes reading `dir/owner` in a tight loop (8 s, 2,056 lock cycles) | 0 writer failures. The readers saw ENOENT/EPERM, which `readOwner` maps to NaN = "held", followed by a retry. Windows delete-pending does not wedge the writer. |

Not re-run: `unit-dom`, build, coverage, and the card's 20-run stress measurement. For those I rely on lane B (`20261117T0234Z_c4a4462`) and the PR body (20/20 at `c4a4462`, 15/20 before the probe fix). The changed files are all under `tools/`, outside `collectCoverageFrom`.

### 1.2 Mutation probes

Scratch copy: `git archive 4c3d13a` + `node_modules` junction + copied `prisma/generated`. Each row runs `fs-lock.test.ts` + `prisma-client-locked.test.ts`.

| # | Mutant | Result |
|---|---|---|
| M1 | drop the post-registration writer recheck (`tryRegisterReader`, writers win ties) | **survives** (R1-m4) |
| M2 | writer does not wait for readers | killed (3) |
| M3 | reader ignores writers | killed (7) |
| M4 | no re-entrancy for a reader inside its own process's writer | killed (re-entrant case) |
| M5 | writer counts its own process's readers | **survives** (R1-m4) |
| M6 | dead reader registration not removed | killed |
| M7 | dead reader registration counted as live | killed |
| M8 | reader does not take over a dead writer directory | killed |
| M9 | reader release is a no-op | killed (3) |
| M10 | shim loads the client without the lock | killed (shim order case) |
| M11 | ownerless writer directory treated as free | killed |
| M12 | sync reader deadline overshoots by 5 s | survives. This is acceptable: D-SEC-PR53-02 forbids the wall-clock bound that would kill it. |

In the first sequential pass the shim order case also failed under M4 and M11. Re-running them alone showed that both failures were caused by the previous mutant's leftover lock (M3/M10 kill a WRITER child while it holds the real `prisma-tree` lock). That led to R1-m3, which I then reproduced directly (§1.3).

### 1.3 Targeted probes

| Probe | Result |
|---|---|
| Two module instances of `fs-lock.ts` in one process (`?instance=a/b`, what `jest.isolateModules` or a second registry gives): async `withReadLock` of A wrapping `withReadLockSync` of B, on one name | **EEXIST** on `<pid>-1` (R1-m2) |
| A stale `<pid>-1` registration whose pid this process now has (pid reuse), then `withReadLockSync` | **EEXIST**: the reader crashes instead of entering (R1-m2) |
| A dead-owner `prisma-tree` writer directory in the checkout's lock scope, then `prisma-client-locked.test.ts` alone | the order case **fails after 120 s** ("Exceeded timeout"): the WRITER child spins on EEXIST forever. The next case's shim reader then takes the stale directory over, so the following run is green again (R1-m3). |

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tools/test-support/fs-lock.ts:63-71` (and pre-existing `:168-171`) | **Dead-owner take-over is check-then-act.** Readers now run it too, every 200 ms from every waiting worker. Sequence: reader A reads owner = dead pid D. Writer W2 also sees D, removes the directory, re-creates it with its own pid, finds no readers, and starts `fn` (rewriting `prisma/generated`). A, descheduled between `readOwner` and `rmSync`, then deletes **W2's live directory**, registers, and loads the tree mid-write. A third writer can also `mkdir` and run alongside W2. Precondition: a writer killed while holding (which `LockChildren.killAll` and Jest force-exit both do), plus contention. That is rare, but it is exactly the half-written-tree outcome this PR exists to prevent, and the PR widens the window from writers only to every reader. | Make take-over atomic and verified. Rename the stale directory to a unique tombstone (`${dir}.dead-${pid}-${randomUUID()}`); only the winner of the rename proceeds; read the tombstone's owner, and if it is not the dead pid you saw, the lock was live: fail loudly. **Minimum alternative:** `withFileLock` re-reads `owner === process.pid` after the reader wait and after `fn`, and throws a named error if it lost the lock. That detects the theft instead of silently corrupting. Add a one-line residual to the JSDoc. |
| R1-m2 | MINOR | `tools/test-support/fs-lock.ts:89-99` | **Registration names are not unique.** `readerSeq` is module-level, so every module instance (each Jest registry, `isolateModules`, the shim's `require` vs a test's `import` in another registry) numbers from 1. A stale `<pid>-<n>` left by a dead process whose pid is reused does the same. `flag: 'wx'` turns the collision into an **EEXIST throw at module load** instead of a wait (probed, §1.3). Today no in-repo async `withReadLock` overlaps a shim load, so this is latent. But `withReadLock` is exported API, and Windows reuses pids quickly. | Name registrations `${pid}-${randomUUID()}` (the parser already reads only the prefix before the first `-`). Optionally include `threadId`, so the re-entrancy and "own reader" checks stay correct if `workerThreads` is ever enabled (`process.pid` is shared across Jest worker threads). |
| R1-m3 | MINOR | `tools/test-support/lock-children.ts:15-22`; `tools/db/prisma-client-locked.test.ts:39` | **The WRITER child is not "exactly as `withFileLock`".** It never takes over a dead-owner directory: it loops on EEXIST forever, and `start()` has no deadline of its own. `prisma-client-locked.test.ts` uses the real `PRISMA_TREE_LOCK`, so any stale `prisma-tree` lock in the checkout's scope makes the order case fail at 120 s with a bare Jest timeout (reproduced). A killed WRITER, including one killed by this suite's own `afterEach` after a failure, is exactly what leaves that lock. In a full run the outcome depends on whether another client-loading suite takes the lock over first: an order-dependent flake in a flake-fix PR. | In `WRITER`, on EEXIST read `owner` and, when `process.kill(pid, 0)` throws ESRCH, remove the directory and retry (the `withFileLock` rule). Give `LockChildren.start` a readiness deadline that rejects with a named error ("lock child could not take <dir>"). Fix the JSDoc either way. |
| R1-m4 | MINOR | `tools/test-support/fs-lock.ts:100-103`, `:82`; `tools/test-support/fs-lock.test.ts` | **Two load-bearing branches are unpinned (surviving mutants M1, M5).** (a) The second `foreignWriterHolds` check is what makes the announce-then-look protocol correct. Without it: reader sees no writer, writer `mkdir`s, writer sees no reader, reader registers, and both are in. Deleting it leaves every test green. (b) Ignoring the writer's own process's readers is what prevents a self-deadlock on an in-process read-then-write. Counting them also leaves every test green. | (a) Add an internal seam: an optional `afterRegister` hook parameter, or an exported `tryRegisterReader(name, { afterRegister })` used only by the test. A case then creates a live foreign writer directory (a WRITER child's lock) in that hook and asserts the reader backs off, leaving no registration. (b) Add a case `withReadLock(name, () => withFileLock(name, () => 'ran', 2_000))` that resolves `'ran'`. If (a) is judged not worth a seam, record it in the PR body as a residual covered only by the stress run. |
| R1-n1 | NIT | `tools/test-support/fs-lock.ts:118` | The JSDoc points at `tools/test-support/prisma-client.cjs`. The shim is `tools/db/prisma-client-locked.cjs`. | Fix the path. |
| R1-n2 | NIT | `tools/test-support/fs-lock.ts:56-57`, `:169` | `isPid`'s JSDoc says "a live process id other than this one", but it only checks for a positive integer. `withFileLock` still uses `Number.isInteger(owner)` rather than `isPid`, so a `0` owner would reach `process.kill(0, 0)` (safe on Windows and POSIX, as probed, but by accident). | Correct the JSDoc and use `isPid` in both places. |
| R1-n3 | NIT | `tools/test-support/fs-lock.ts:178-182`, `:71` | **Liveness residuals with a wider blast radius.** (i) A registration whose dead pid has been reused by a live process makes every writer wait the full 600 s, and the error names only the lock, not the blocking `<pid>-<n>` files. (ii) An ownerless writer directory (a writer killed between `mkdir` and the owner write) now blocks **every client-loading suite** synchronously for 600 s each (`Atomics.wait`, so the Jest timeout cannot fire), not only the few writers. | List the blocking entries in the readers-timeout error. Treat an ownerless directory whose `mtime` is older than ~30 s as stale: the owner write follows `mkdir` immediately. |
| R1-n4 | NIT | `tools/db/prisma-client-locked.test.ts:56`; `tools/db/prisma-client-locked.cjs:12` | The pass-through pin hard-codes `prisma/generated/prisma/client.ts` in both the shim and the test. If the `@platform/source` target in `prisma/package.json` moves, `prisma-client-package.test.ts:55` changes, but the shim silently keeps loading the old path. | Read `exports['./client']['@platform/source']` from `prisma/package.json` in the test (and optionally in the shim). |
| R1-n5 | NIT | PR body "Security" paragraph | The body says "Per the card, the hosted `security-integration` job runs". On lane A 44005361656 it was **skipped**, and D-TASK288-08 asks security-analyst to rule on that. | Align the body with the run and the ruling. |
| R1-n6 | NIT | `tools/test-support/fs-lock.ts` (design) | Re-entrancy is per process, not per holder: any reader in the writer's process is let in, even one unrelated to the writer's call. This is correct today because a Jest worker runs one file at a time, and the JSDoc says "a reader in the writer's own process". The 11 existing `withFileLock(PRISMA_TREE_LOCK, () => import(...generated...))` pseudo-readers in `prisma/tests/**` still take the exclusive side, so they serialise against each other and against every shim load. | Next touch (owner of `prisma/tests`): move those imports to `withReadLock`. Keep the per-process rule documented. |

## 3. Focus questions from the dispatch

- **Deadlock.** None across processes. A waiting reader (sync or async) holds no registration; a writer holds its directory and waits only for readers already inside, and those finish (a synchronous `require`). The only cyclic shape is two processes that each hold a read lock and then ask for the write lock. Nothing does that today, and the 600 s deadline would break it. An in-process read-then-write is safe because own readers are ignored, but that is untested (R1-m4 b).
- **Starvation.** Writers cannot be starved: once the directory exists, new readers back off. Readers can be delayed only by the bounded set of writers in a run (polling, no queue). That is acceptable.
- **Pid reuse.** Liveness only: a reused pid looks alive, so the system waits up to 600 s (R1-n3). There is one crash path, the EEXIST in R1-m2.
- **Stale-reader / stale-writer take-over race.** Removing a dead reader's file is safe, because the names are unique per holder once R1-m2 is fixed. Removing a dead writer's directory is the TOCTOU in R1-m1.
- **Windows.** `Atomics.wait` on the main thread is allowed in Node and works inside Jest's `vm` context (the shim tests prove it). `mkdir` and `wx` are atomic CREATE_NEW on NTFS. Concurrent `rmSync` vs owner reads is safe (probed, §1.1); delete-pending reads surface as EPERM and are retried. `process.kill(pid, 0)` returns EPERM for a live pid of another user, which counts as alive.
- **Can the shim load a half-written client?** Not in the normal case. Jest's `require` of `client.ts` is synchronous, and the shim's lock covers the whole static graph. The only lazy loads in the generated client (`internal/class.ts:42-51`) come from `node_modules/@prisma/client/runtime`, which `deps:rebuild` does not touch: the PR's snapshot diff shows only the 12 files under `prisma/generated`. Two exceptions: R1-m1 (a reader that wrongly deletes a live writer's directory), and the 11 relative `../../generated/prisma/client.js` importers, which bypass the mapper but already hold `withFileLock`.
- **Test quality.** Every concurrent party is a real child process; assertions are about order (a `released` marker), with no wall-clock bound (D-SEC-PR53-02). There is a genuine control case (`SyntaxError` without the lock). The deadline cases use 300 ms only as an input, never as an asserted duration. The order assertions can pass vacuously on a host that starves the parent for longer than 400 ms, but they can never fail spuriously. The weak spots are R1-m3 and R1-m4.

## 4. Deviation rulings

| Item | Ruling |
|---|---|
| D-TASK288-01: a `moduleNameMapper` shim instead of a `setupFiles` entry or a shared package | **Accepted.** It is Jest configuration, not per-suite boilerplate (meets the card AC). It locks only when a suite actually resolves the client, and it covers dynamic `import()` and `jest.isolateModules` loads, which a setup file taking the lock once would not. |
| D-TASK288-03: probe root cause is the pg connect timer; the probe takes no read lock | **Accepted.** `prisma/dist` is written only by this suite's own `beforeAll` (under `withFileLock`), and `deps:rebuild` does not touch it. Refused loopback connects are immediate on this host (§1.1). `runNode`'s 300 s default bounds a hang. The failure-only `detail` is a good diagnostic. |
| D-TASK288-05: branch `test/TASK-288-flake2` instead of the card's `feat/...` | Accepted (as dispatched). |
| D-TASK288-06: no `required-suites.json` / `min_tests` change; the ratchet stays with qa-lead | Accepted. The card's DoD line is carried by qa-lead's ratchet. |
| D-TASK288-07: the `deps:rebuild` budget measured inside the lock | **Accepted and correct.** The budget is unchanged and now measures the rebuild, not lock contention. |
| D-TASK288-08: `execute-phases.test.ts` routed to PR #54 fc2; `route-metadata.test.ts` [10] to W0-FLAKE-3 | Accepted (file ownership). |
| Card DoD: "`security-integration` runs on the PR and degraded mode never waives it (D-ARCH-021)", while the job was **skipped** on 44005361656 | **For security-analyst** (already asked in D-TASK288-08). Not a code finding. It is a merge condition below. |

## 5. Follow-up closure

- **D-ORCH-083 / D-ORCH-098 residual** (static `@platform/prisma/client` importers take the tree read lock before the import resolves, with no per-suite boilerplate): **closed**. The mapping test pins all 6 projects; the order case and the race control prove the behaviour; M10 is killed.
- **PR53-SEC-01..03** (card AC): recorded closed against PR #53 head `378af72` in the PR body, citing the security record lines. No code expected. **Closed** as recorded.
- **PR #48 R1-m4** → TASK-289; **PR53-SEC-05/06** → TASK-283 (D-ARCH-136/137). Correctly not here.

## 6. Merge conditions

1. A security record on the merge head (the lane A `scans` record step fails until one exists), plus security-analyst's ruling on the skipped `security-integration` job against the card's DoD line.
2. If R1-m1..m4 are fixed in a fix cycle, a fresh lane A run and lane B evidence on that head. If they are routed instead, record the routing in DECISIONS.md. **Recommendation:** fix R1-m2 and R1-m3 here (a few lines each, inside this PR's locks), and fix R1-m1 at least in its detection form.
3. P1 check at merge time: `main` must not have changed `jest.config.ts` or `tools/test-support/**` since `origin/main` at review time.

## 7. Good patterns worth keeping

- Announce-before-look on both sides, with writers winning ties, explained in the module JSDoc in a way the next engineer can check.
- The race **control** case: an unlocked load of a half-written module throws `SyntaxError`. It proves that the test can detect the bug it guards against.
- Marker-based ordering with real child processes, instead of timing, consistent with D-SEC-PR53-02.
- The probe's failure-only `detail`: on a wrong error class, the failure message names its own cause.
- The budget clock moved inside the critical section, so unrelated contention cannot turn the AC budget red.

## 8. Security flags (for security-analyst)

- R1-m1: the lock's mutual exclusion can be broken by a take-over race (test integrity, CWE-367 TOCTOU). Test-only, no production path.
- The `.cjs` shim is reachable only through `jest.config.ts` (`moduleNameMapper`). No production path resolves it; images prune `tools/`. Please confirm.
- `jest.config.ts` is a full-trigger and security-owned path: the skipped `security-integration` job needs a ruling (§4).
