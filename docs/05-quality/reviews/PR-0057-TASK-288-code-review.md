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

---

# Round 2 (delta): fix cycle 1

Head reviewed: `4f1fbd5` (full SHA `4f1fbd561cf8845c350c4e8691d2a030bbed3bab`). Code commits: `67055a3` (fix cycle 1) and `a67db34` (put-back pin). `4f1fbd5` is lane B evidence only, and `30ca878` is the security record r1. Delta reviewed: `git diff d44e022 4f1fbd5`, which changes only `tools/test-support/fs-lock.ts`, `fs-lock.test.ts` and `lock-children.ts` (plus the evidence and the security record).

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: All four r1 MINORs are fixed and pinned. M1 and M5 are now killed: 11 of my 12 r1 mutants die, and M12
  survives as before (it is the wall-clock case, which D-SEC-PR53-02 excludes). Of 17 new mutants against the fix-cycle
  code, 12 die, 3 are equivalent and 2 are unpinned branches (NITs). The tombstone take-over removes the r1 failure, where
  a live lock was destroyed silently: the worst case is now a loud LostTestLockError, plus a microsecond put-back window
  (R2-n3). One new MINOR: when a stale lock cannot be renamed (Windows EPERM/EBUSY), `withFileLock` spins synchronously
  with no deadline. I reproduced 24 s at 100 % CPU with zero event-loop ticks against a 2 s deadline. The fix is two lines.
```

## R2.1 What I verified myself

| Check | Result |
|---|---|
| `npm run typecheck` on `4f1fbd5` | exit 0 |
| ESLint `--max-warnings 0` on the 3 changed files | exit 0 |
| Prettier `--check` on the 3 changed files | clean |
| Full `unit` project on `4f1fbd5` | **234 / 234 suites, 5,903 passed, 2 skipped, 0 failed** (181 s) |
| `fs-lock.test.ts` + `prisma-client-locked.test.ts` in a scratch copy (baseline) | 32 / 32 |
| Lane A run 44016220270 on `4f1fbd5` | fast-lane **success**. `scans` fails only on the security-record step (the r1 record is not on the head), so `ci-gate` fails. `security-integration` was skipped; security r1 replaces it with condition C1, a local run. |
| Lane B `20261117T0349Z_a67db34` | bound to the code head `a67db34`; I did not re-run it |
| PR body | updated: the fix-cycle table, R1-n5 corrected, and R1-n4/n6 explicitly left |

## R2.2 Mutation testing (scratch copy of `4f1fbd5`, `node_modules` junction)

| # | Mutant | Result |
|---|---|---|
| M1 | drop the writer recheck after registration | **killed** ([R1-m4 (a)] via the `afterRegister` seam) |
| M2 | writer does not wait for readers | killed (5) |
| M3 | reader ignores writers | killed (10) |
| M4 | no re-entrancy for a reader in the writer's process | killed |
| M5 | writer counts its own process's readers | **killed** ([R1-m4 (b)]) |
| M6 / M7 | dead registration kept / counted live | killed / killed |
| M8 | reader does not take over a stale writer | killed (3) |
| M9 | release is a no-op | killed (5) |
| M10 | shim without the lock | killed |
| M11 | ownerless directory always stale | killed |
| M12 | sync deadline overshoot | survives (wall-clock; accepted in r1) |
| N1 | take-over removes the tombstone without checking its owner | killed (put-back case) |
| N2 | no put-back (the caught live lock is removed) | killed (put-back case) |
| N3 | drop `assertOwned` after the reader wait | **survives** (R2-n1) |
| N4 | drop `assertOwned` after `fn` | killed |
| N5 | `finally` deletes a lock it lost | killed |
| N6 | ownerless directory never stale | killed |
| N7 | registration regex loosened to `^(\d+)-` | killed (junk case) |
| N8 | junk entries deleted | killed (junk case) |
| N9 | link refusal removed | killed |
| N10 | lock root back in the OS temp directory | killed |
| N11 | WRITER child without dead-owner take-over | killed |
| N12 | `start()` readiness deadline never fires | killed. My first form did not compile; the valid form, a 2e9 ms timer, is killed. |
| N13 | `isStale` without `pid !== process.pid` | survives, equivalent: its own pid is always alive |
| N14 | empty readers directory kept | killed |
| N15 | reader skips the "readers directory vanished" retry | killed (link case) |
| N16 | registration-write ENOENT throws instead of retrying | **survives** (R2-n2) |
| N17 | pid parsed with `split('-')` instead of the regex group | survives, equivalent once the strict regex matched |

## R2.3 Windows rename semantics for the tombstone (probes: `rename-probe*.cjs`, `spin-probe.mts` in my scratchpad)

| Probe | Result |
|---|---|
| Rename the lock directory while another process holds an fd on `owner` | **EPERM** |
| Rename it while it is another process's cwd | **EBUSY** |
| Take-over rename while 3 processes read `dir/owner` in a tight loop (4 s) | **1,666 of 1,921 fail EPERM**. With a 1 ms pause between reads, 15 of 1,447 fail. Each failure is transient and clears on retry. |
| Put-back rename (`tomb` → the original, now absent, name; nobody reads the private tomb) | 1,687 of 1,687 succeed |
| Put-back onto a re-created directory, empty or non-empty | **EPERM** on Windows; the code then removes the tomb. On POSIX, `rename` onto an **empty** directory replaces it (see R2-n3). |
| Stale dead-owner lock that cannot be renamed (another process's cwd), reader `withReadLockSync(…, 2000)` | throws the named timeout at 2,010 ms. The reader path is correct. |
| Same lock, writer `withFileLock(…, 2000)` | **spun 24 s** with **0** event-loop ticks and entered only when the watchdog killed the cwd holder (R2-m1) |

So `renameSync` failure is common on Windows, and the code's choice to treat EPERM/EBUSY/EACCES as "in use, retry" is right. Only the writer's retry loop is wrong.

## R2.4 Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `tools/test-support/fs-lock.ts:283-286` | **Writer hot-spins past its deadline when a take-over fails.** `if (isStale(dir, owner)) { takeOverStale(dir, owner); continue; }` neither sleeps nor checks the deadline. `takeOverStale` returns silently on EPERM/EBUSY/EACCES (`:113`), so the loop runs `mkdir`, then `readOwnerText`, then `rename` with no `await`. The Jest test timeout cannot fire, and the spinner's own owner reads make other takers' renames fail too (R2.3). It is transient under normal contention and unbounded while anything keeps a handle in the directory (reproduced: 24 s against a 2 s deadline). r1 used `rmSync`, which threw on the same condition, so this is a regression introduced by the fix. | After `takeOverStale`, `continue` only if the directory is gone (`lstat` ENOENT). Otherwise fall through to the deadline check and the `POLL_MS` sleep. Pin it with a case where the stale lock cannot be renamed: on Windows an idle child with `cwd` set to the lock directory; on POSIX use a seam, e.g. an optional `rename` hook on `takeOverStale`. The case expects the named timeout error. |
| R2-n1 | NIT | `tools/test-support/fs-lock.ts:299` | `assertOwned(dir, 'while waiting for readers')` is unpinned (N3 survives). The after-`fn` check still fails the run, but only after `fn` has run on a lost lock. | Add a case where a READER child holds for 400 ms; while the writer waits for it, the test replaces the lock with an idle child's owner. Expect `LostTestLockError` and that `fn` never ran. |
| R2-n2 | NIT | `tools/test-support/fs-lock.ts:204` | The ENOENT retry when the readers directory disappears between the check and the write is unpinned (N16 survives). | Optional: a `beforeWrite` hook on the existing `ReaderHooks` seam that removes the directory. |
| R2-n3 | NIT (residual) | `tools/test-support/fs-lock.ts:102-125`, JSDoc `:11-15` | **Narrowed, not closed.** (i) Between the two renames, a live lock that was caught by mistake is invisible: a reader can register and enter, and if the put-back then succeeds, nobody notices. (ii) On POSIX, a put-back onto an *empty* re-created directory replaces it. The new writer then writes its owner into the restored directory, and the old writer gets `LostTestLockError` (loud). (iii) An ownerless judgement (`seen === undefined`) that catches a fresh writer between its `mkdir` and its owner write removes that directory, and that writer's owner write fails with a bare ENOENT. All three need a stale lock, two concurrent takers and a deschedule inside a microsecond window. | Document the residual in the JSDoc ("take-over narrows the race to the put-back window; a lost lock is reported, a reader in that window is not"). If it ever matters: serialise takers with a short-lived `${dir}.takeover` mutex and re-read the owner under it, so no rename is needed. |
| R2-n4 | NIT | `tools/test-support/fs-lock.ts:7-8`, `:63-65` | The lock root follows `node_modules`. A checkout whose `node_modules` is a junction into another checkout (reviewer scratch copies, or any evidence worktree built that way) shares that checkout's locks while it has its own `prisma/generated`. This is safe, it only over-serialises, but "worktrees do not block each other" holds only for worktrees with their own `node_modules`. | Qualify the JSDoc sentence. |

## R2.5 Round 1 closure

| r1 item | Status |
|---|---|
| R1-m1 take-over TOCTOU | **Closed (narrowed).** The tombstone with owner verification plus put-back replaces blind removal. The writer re-checks `owner === pid` twice and never deletes a lost lock. Residual: R2-n3. Pinned by N1, N2, N4 and N5. |
| R1-m2 registration names | **Closed.** Names are `<pid>-<uuid>` with a strict regex, and junk is ignored, not deleted. The two-instance case runs the probe I filed (`isolateModulesAsync` × 2) and stays green. |
| R1-m3 WRITER take-over / `start()` deadline | **Closed.** Pinned by N11 and N12. The stale-lock scenario I reproduced in r1 is now a case. |
| R1-m4 M1 / M5 survivors | **Closed.** Both are killed through the `tryRegisterReader` hook and the read-then-write case. |
| R1-n1 JSDoc path | Closed (`:226`). |
| R1-n2 `isPid` | Closed. The JSDoc is corrected; `withFileLock` now goes through `isStale`. |
| R1-n3 liveness | **Closed.** Blocking registrations are named in the timeout error, and an ownerless directory goes stale after `OWNERLESS_STALE_MS` = 30 s (mtime), pinned by M11 and N6. Pid-reuse waits remain a documented liveness residual. |
| R1-n4 shim target hard-coded | Deferred to the next touch (PR body). **Accepted.** |
| R1-n5 PR body | Closed. |
| R1-n6 per-process re-entrancy / `prisma/tests` pseudo-readers | The JSDoc now states the rule (`:26-28`, including the `workerThreads` note). The pseudo-reader move is deferred to the next touch. **Accepted.** |
| PR57-SEC-01 (security r1): lock in the shared temp directory, link-following cleanup | Lock root moved to `<checkout>/node_modules/.cache/shipqube-test-locks` (mode 0o700). `lstat` refuses a readers path that is a link or not a directory, before any read or delete. Pinned by N9 and N10. Final ruling: security-analyst (delta running). |

## R2.6 Merge conditions (replace §6)

1. The security delta record on the merge head; the record step in `scans` fails until it lands. Security r1 condition C1 (a local `integration`, `catalog-c1-c14` and `rls-cross-tenant` run at the merge head) stays with the security record.
2. R2-m1: fix it in this PR (two lines plus one case), or record the routing in DECISIONS.md. **Recommendation:** fix it here, because it is a regression of this fix cycle and it defeats a deadline the JSDoc promises. A fix needs a new lane A run and lane B evidence.
3. The P1 check at merge (unchanged from §6.3).

Full `unit` project on `4f1fbd5` (my run): **234 / 234 suites, 5,903 passed, 2 skipped, 0 failed** (181 s).

## R2.7 Good patterns worth keeping

- The seams (`tryRegisterReader` hooks, `takeOverStale`) are exported "for the lock tests only" and documented as such. They turn a race that only showed up under stress into deterministic cases.
- `LostTestLockError` and `LockChildTimeoutError` both name the lock, so a failure explains itself.
- Junk in the readers directory is ignored rather than deleted, which is the right default for a directory another process could write.

---

# Round 3 (narrow delta): fix cycle 2

Scope as dispatched: `tools/test-support/fs-lock.ts`, `fs-lock.test.ts` and `lock-children.ts` only. Delta: `git diff 5891125 a5f94b0`. Head `a5f94b0` (full SHA `a5f94b0616bcb8832fb959df5ea81b1dc61c9e04`); code `bfe5235`; `a5f94b0` adds lane B evidence only.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R2-m1 is fixed. My hot-spin repro now rejects at 2,051 ms against a 2 s deadline with 18 event-loop ticks (r2:
  24 s, 0 ticks). takeOverStale now returns a boolean, and the writer `continue`s only after a real take-over.
  N3 and N16 are now killed. Of 7 delta mutants, 5 are killed; the 2 survivors are equivalent or race-only, as claimed.
  The JSDoc closes R2-n3 and R2-n4. No BLOCKER, MAJOR or MINOR. Three NITs: the hot-spin pin kills only by hanging the
  run, residual (ii) in the JSDoc is outdated now that the owner write uses `wx`, and idle children outlive a killed
  Jest worker.
```

## R3.1 What I verified myself

| Check | Result |
|---|---|
| `npm run typecheck` on `a5f94b0` | exit 0 |
| ESLint `--max-warnings 0` and Prettier `--check` on the 3 files | exit 0 / clean |
| `fs-lock.test.ts` + `prisma-client-locked.test.ts` in a scratch copy of `a5f94b0` (baseline) | 37 / 37 (17 s) |
| **Hot-spin repro** (`spin-probe.mts`: dead-owner lock whose directory is a live child's cwd, so rename gets EBUSY; `withFileLock(…, 2000)`) | **rejects with the named timeout at 2,051 ms; 18 event-loop ticks while waiting.** r2 head: spun 24 s with 0 ticks. The reader path is unchanged (2,012 ms). |
| Lane A 44070813630 on `a5f94b0` | fast-lane **success**. `ci-gate` fails only on the security-record step; `security-integration` was skipped (C1 replaces it). |
| Lane B `20261117T0739Z_bfe5235`, C1 rerun `20261117T1051Z_a5f94b0` | not re-run; relied on as reported |

Not re-run in round 3: the full `unit` project. The delta is limited to the three lock files; their suite and the shim suite ran above.

## R3.2 Mutants (`mutate3.cjs`; each row runs `fs-lock.test.ts` + `prisma-client-locked.test.ts` under an outer `timeout 240`)

| # | Mutant | Result |
|---|---|---|
| R3a | the R2-m1 bug restored (`if (isStale) { takeOverStale(); continue; }`) | **killed by hang**: the suite never finishes and the outer timeout fires at 240 s (R3-n1) |
| R3b | a failed rename returns `true` | **killed by hang** (same shape) |
| R3c | a put-back returns `true` | survives, equivalent: the writer loops once more, `mkdir` gets EEXIST, the restored lock is live, so it waits; the reader path ignores the value |
| N3 | drop `assertOwned` before `fn` | **killed** ([R2-n1]) |
| N16 | registration-write ENOENT throws instead of retrying | **killed** ([R2-n2]) |
| R3d | owner write without `wx` | survives (race-only, as the developer states) |
| R3e | `beforeWrite` hook never called | killed ([R2-n2]) |

The developer's statement holds: the old bug blocks Jest's own timeout, because the loop never yields. The kill therefore only shows up as a hung run.

## R3.3 Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R3-n1 | NIT | `tools/test-support/fs-lock.test.ts:397`, `:419` | **The hot-spin pin kills only by hanging.** If the R2-m1 bug returns, the EBUSY hook throws forever, the writer spins synchronously, and lane A's unit job hangs until its job timeout with no message naming the case. | Make the hook give up after a bound: throw EBUSY for at most N calls (e.g. 1,000), then delegate to the real rename, and assert the call count stayed small. A yielding writer polls about deadline/`POLL_MS` ≈ 5 times; a spinner hits 1,000 in milliseconds. This is a magnitude check, not a wall-clock bound: a loaded host makes fewer calls, never more, so D-SEC-PR53-02 is respected. The mutant then fails in about 1 s instead of hanging the lane. |
| R3-n2 | NIT | `tools/test-support/fs-lock.ts:23-24` (residual (ii)) | Since the owner file is created with `wx`, a POSIX put-back onto an empty re-created directory no longer leads to a `LostTestLockError`. The writer that re-created the directory gets EEXIST on its owner write, reads the restored live owner, and waits. The JSDoc still describes the old outcome. | Reword (ii): "…replaces it; the writer that re-created it then finds the restored owner on its exclusive owner write and waits." |
| R3-n3 | NIT | `tools/test-support/lock-children.ts:56` | `IDLE` children (`setInterval` forever) outlive a Jest worker that is killed (an outer timeout, a lane job timeout, or Jest force-exit), because `killAll` runs only in `afterEach`. My two hang mutants were killed by `timeout`. They left 40 `t288-*` lock directories in the worktree's `node_modules/.cache/shipqube-test-locks` (I removed them; none was held). The idle grandchildren of those runs may still be alive: I could not list process command lines here, and 38 `node.exe` processes were running on the host. | Make `IDLE` exit when its parent goes away: spawn with an `'ipc'` channel and call `process.on('disconnect', () => process.exit(0))`, or poll `process.kill(process.ppid, 0)`. Alternatively give it a lifetime cap (`setTimeout(() => process.exit(0), 300_000)`). |

## R3.4 Round 2 closure

| r2 item | Status |
|---|---|
| R2-m1 writer hot-spin past its deadline | **Closed.** The repro is green, R3a/R3b are killed, and there is a cross-platform seam case plus a win32-only real-cwd case (`idleStarted` waits for the child's marker, so the directory is really in use). |
| R2-n1 pre-`fn` ownership check | **Closed** (N3 killed; READER-child case with `fnRan === false`). |
| R2-n2 ENOENT retry | **Closed** (N16 and R3e killed; `beforeWrite` seam). |
| R2-n3 put-back window residual | **Closed** (JSDoc lists windows (i)-(iii) and the `.takeover` mutex escape hatch); see R3-n2 for wording. |
| R2-n4 lock root follows `node_modules` | **Closed** (JSDoc). |
| Owner file `wx` (new, unpinned) | Accepted. R3d survives because the path is race-only; it improves residual (ii) (R3-n2). |

## R3.5 Merge conditions (replace R2.6)

1. The security delta record on the merge head: `ci-gate`'s record step fails until it lands. Security r1 C1 is reported green at `20261117T1051Z_a5f94b0`; security-analyst confirms.
2. The P1 check at merge (`jest.config.ts` and `tools/test-support/**` unchanged on `main` since the merge base).
3. R3-n1..n3 are NITs, so the next touch is fine. If a fix cycle is opened for any other reason, R3-n1 is the one worth taking, because it stops a regression from hanging lane A.
