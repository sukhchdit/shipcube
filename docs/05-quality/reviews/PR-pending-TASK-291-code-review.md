# Code review: TASK-291 (TASK-W0-FLAKE-3), pre-push round 1

| Field | Value |
|---|---|
| PR | not pushed yet (pre-push review; the orchestrator renames this record once the PR exists) |
| Branch / head | `feat/TASK-291-task-w0-flake-3-one` @ `1672070` (one commit), based on `origin/main` `ca7e4b7` |
| Diff reviewed | `git diff ca7e4b7 1672070`: 20 files, +241 / -38 |
| Card | `docs/04-plan/tasks/WAVE-00.md` batch 0.13, TASK-291; D-ORCH-113, D-ARCH-146, D-TASK288-08, D-TASK020-100, PR #57 R1-n4 / R1-n6 |
| Reviewer | code-reviewer, 2026-11-19 |

## 1. Verdict

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The code is sound. fetchOnce/closeLoopbackServer removes the pooled-socket class from the three generated suites;
         the ratchet is exact on today's tree; the 11 reader files really only read. One MAJOR, which needs no code:
         the web prerender item of the card was replaced by its own fallback without the measurement the fallback depends on.
```

The only blocking item is R1-M1. It closes without a code fix cycle, in one of two ways: the 20-build measurement is run in the lane-B queue, or the orchestrator/architect records a section 7 re-scope that splits the prerender item into a follow-up. A delta review of that record then turns this verdict into APPROVED_WITH_NITS. The code part on its own has no BLOCKER and no MAJOR.

## 2. Verification performed (HOST RULE: no npm, no Jest, no Docker)

- I read the full diff and the files it touches in context: `loopback.ts` (fetchOnce, closeLoopbackServer, unchanged), `fs-lock.ts` (reader/writer protocol), `jest.config.ts` (project map: a plain `*.test.ts` under tests/generated runs in lane A `unit`), `runApiCase` (the RLS oracle), `prisma/package.json`, the shim, the TASK-293 card (to check for overlap), and CODEOWNERS.
- Scanner probe, one Node 24 process, on a `git archive 1672070` extract of `loopback-scan.ts` and the allow-list, scanning the clean worktree:
  - `scanLoopbackFetchUsers` found 10 files and `ratchetFindings` returned `[]`.
  - The same probe replayed every assertion of the 15 ratchet tests: 13/13 checks PASS.
  - It listed every in-scope global-fetch user the marker does not flag. There are 5, and none is a loopback client:
    - `object-storage.contract.int.test.ts` fetches presigned URLs from the RustFS container.
    - `run-semgrep.int.test.ts` and `tenant-tx-disable-ratchet.test.ts` only have fixture text.
    - `mock-scenario.ts` and `no-external-calls-in-tenant-tx.mjs` mention fetch only in comments.
  - So there are 0 false negatives and 0 false positives today.
  - I also ran 18 bypass shapes (results in R1-m1).
- I confirmed `execute-phases.test.ts` really belongs on the list. D-TASK020-100 moved its `request()` helper to fetchOnce, but lines 488/534/606/919/963 still call the global `fetch` (the in-flight/abort cases).
- Allow-list lock names: `api-audit-mw`, `api-platform-core`, `api-openapi`, `api-tx-execute`, `worker-platform-core` and `contract-stubs` all exist in `plan-data.mjs`.
- R1-n6: I grepped every `withFileLock` / `withReadLock` user.
  - The 12 converted call sites in 11 files run nothing but `import('../../generated/prisma/client.js')` under the lock.
  - The generated client imports only `@prisma/client/runtime/client`, its own siblings and node built-ins, so it never reaches the `@platform/prisma/client` shim.
  - The exclusive users that remain are `prisma/tests/harness/postgres.ts:116` and `shadow/shadow-init.int.test.ts:64` (generic Prisma CLI, which can include `generate`), plus the tools/deps and tools/db rebuild tests. All of them are correct to stay exclusive.
- R1-n4: the shim's computed path, `../../prisma/generated/prisma/client.ts`, is the same path as before. The test resolves the same target from the manifest.
- Prettier `--check` on the 20 changed files (`node node_modules/prettier/bin/prettier.cjs`, read-only): clean.
- Overlap with the concurrent TASK-293 (`prisma-core`): its branch has no commits beyond `ca7e4b7`. Its card plans `tools/db/sql-text.ts`, `shadow-init.ts`, `lint-migrations.ts` and a NEW file under `prisma/tests/catalog/`. None of these is among the 11 files edited here.
- **Not re-run:** lint, typecheck, `test:unit`, the generated or integration projects, coverage, and the 20-run measurement. For these I rely on the developer's report (15/15 ratchet tests) and on the lane-B run that is still owed (merge condition C2).

## 3. Questions asked by the dispatch

**Does the transport remove the ECONNRESET / "other side closed" class?** Yes, for the files this task owns.
- `fetchOnce` opens a fresh socket per request (`agent: false`) and sends `Connection: close`. No pool means no socket is reused, and reuse of a socket the server has already closed is the mechanism behind "other side closed" and ECONNRESET.
- It reads the whole body before it resolves. A hang fails as the named `FetchOnceTimeoutError`; see R1-m2 for where that is still masked.
- Close order:
  - `closeLoopbackServer` calls `close()` and then, synchronously, `closeAllConnections()`, so `close()` never waits out a keep-alive.
  - `api-cases.test.ts` previously awaited `close()` and only then called `closeAllConnections()`, which was the wrong order. That is now fixed.
  - `cross-tenant.int.test.ts` `serve().close` previously never destroyed sockets. That is now fixed.
- In route-metadata and api-cases.test.ts every request is awaited before the close, so `closeAllConnections` never cuts a live exchange.
- The class still lives in the 10 allow-listed api/worker suites. That is by design: they are routed to their lock holders.

**Is the RLS oracle unchanged?** It is at least as strict as before.
- fetchOnce does not follow redirects. A 3xx whose `Location` carries another tenant's value now fails twice: the status is not 404, and the header scan sees `Location`. Before, `fetch` followed the redirect, so neither check saw that hop.
- It sends no `accept-encoding`, so compression can never hide a value from the body scan.
- The "identical counts" proof of the card still has to come from lane B (C2).

**Is the ratchet meaningful and hard to bypass?** It is meaningful: it is exact on the current tree, catches stale entries, keeps the list sorted and unique, includes untracked files, and runs in lane A on every PR. But it is easy to bypass in two ways (R1-m1):
- the "may only shrink" rule is not enforced, and the files have no CODEOWNERS entry;
- the loopback marker is a naming heuristic.

**Read-vs-write lock split.** Correct. No converted reader writes, and the writers that remain are exclusive. Readers no longer serialise against each other or against shim loads, which is what R1-n6 asked for. One latent hazard is new and only reachable by a future edit (R1-n1).

**Does "procedural rule only" meet the card for the web prerender?** No. See R1-M1.

## 4. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | (card item "WEB PRERENDER UNDER HOST LOAD"; no file in the diff) | **The card's own fallback is used without the measurement that justifies it.** The card says DELIVER: (1) a reproduction under the PR #53 load method that names the slow phase and the failure rate over 20 builds; (2) the lightest control (report an app/config cause, or the bounded signature-keyed retry in `heavy.mjs`); and only "when the measurement warrants neither form of (2)" does the outcome become the procedural rule. None of this was done. (1) is "still owed", so the precondition of the fallback is unmet. The procedural rule is also not recorded anywhere on the branch (no DECISIONS line, no TEST-STRATEGY or `heavy.mjs` note), although the card says "the recorded procedural rule". A developer decision (D-TASK291-04) cannot waive a card deliverable: under CLAUDE.md section 7 a re-scope belongs to principal-architect or product-manager. Why it matters: lane B was INVALID twice on this signature (D-TASK020-99/-100), and without the phase and the rate nobody knows whether "re-run once" brings the rate under 1 % or hides an app-side regression. D-ARCH-146 says "the task measures first". | Either (a) queue the 20-build reproduction in the lane-B queue (this host is the lane-B host) and record the phase and the rate, then apply (2) or the rule as the card decides; or (b) the orchestrator records a section 7 re-scope, in which architect/PM split the prerender item into a carded follow-up with an owner and a due gate (before G3) and keep the procedural rule as the interim. In both cases the procedural rule is written down where lane-B operators read it (D-ORCH entry, plus a `tools/quality` or TEST-STRATEGY line), and the PR body says the prerender item is NOT delivered. No code change is needed for this finding. |
| R1-m1 | MINOR | `tests/generated/loopback-scan.ts:22`, `loopback-ratchet.test.ts:27-39`, `.github/CODEOWNERS` | **The ratchet is easy to bypass.** (i) "May only shrink" is not enforced. A PR that adds its own file to `loopback-fetch-allowlist.json` passes all 15 tests, and the three `loopback-*` files have no CODEOWNERS entry (unlike `/tests/generated/rls/`). (ii) The marker is a naming heuristic. The probe flags none of these: `fetch(\`${origin}/x\`)`, `${baseUrl}`, `${url}` (a helper's server URL), `base + '/x'`, `http://[::1]` without a `.listen(` in the same file, `const { fetch: f } = globalThis`, `globalThis['fetch'](`, `fetch.call(`. A suite that gets its server from a shared helper is the likely way the pooled form returns, which is exactly the history D-ARCH-146 cites. | (i) Pin a ceiling in the test (`expect(ALLOW_LIST.length).toBeLessThanOrEqual(10)`, with a comment that it only goes down) and add `/tests/generated/loopback-*` to CODEOWNERS (qa-lead). (ii) Make the rule structural, not name-based. In test code (`*.test.*`, `tests/helpers`, `**/tests/**`), every global `fetch` / `globalThis.fetch` call is a finding, and the few non-loopback users (the object-storage presign case) sit in a separate `external` list with a reason. As a minimum, widen the marker with `\[::1\]`, `server\.address\(\)` and `\$\{(?:origin\|baseUrl\|url)\}`. Record D-TASK291-01's limits in the scanner JSDoc. |
| R1-m2 | MINOR | `tests/generated/route-metadata.test.ts:42`, `tests/generated/rls/api-cases.test.ts:19` | **The named deadline cannot fire first.** `jest.setTimeout(60_000)` equals `FETCH_ONCE_DEADLINE_MS` (60 s), and the docs-routes case runs 2N+1 sequential `fetchOnce` calls inside one 60 s test budget. Under host load a hang therefore surfaces as Jest's generic timeout, not the named `FetchOnceTimeoutError` the card asks for ("a named per-request deadline"). `LOOPBACK_TEST_TIMEOUT_MS` (180 s) is the single constant created for exactly these suites (PR #38 R1-n1). | Use `jest.setTimeout(LOOPBACK_TEST_TIMEOUT_MS)` in both files. It is already exported from `loopback.ts`. |
| R1-n1 | NIT | `tools/test-support/fs-lock.ts:236-250` (design; made reachable by R1-n6) | Now that readers are shared, consider a nested read in one process while a foreign writer is queued. The outer registration blocks the writer, the nested `tryRegisterReader` backs off (writers win ties), and `withReadLockSync` sleeps the thread synchronously. Nothing moves until the writer's 600 s deadline, and then the writer fails. This is unreachable today, because the generated client never loads the shim, but a future `fn` that imports apps code (which maps `@platform/prisma/client` to the shim) would hit it. Under the old exclusive pseudo-readers it was safe, because the outer holder was the writer. | Make readers re-entrant per process, symmetric with the writer rule: if this pid already holds a registration, register without the writer check. Or add a JSDoc rule: "`fn` must not take a nested read lock of the same name". |
| R1-n2 | NIT | `tests/generated/loopback-scan.ts:14` | `prisma/` is not a scan root (D-TASK291-03). This matches the card's wording, but `prisma/tests/spikes/spk04/runner.ts:234,301,307` uses the pooled global fetch against `127.0.0.1`, and future `prisma/tests` suites fall outside the tripwire. | Next holder of `prisma-core`: add `prisma/tests/` as a root and list spk04's runner under lock `prisma-core`, or exclude `prisma/tests/spikes/` by name. |
| R1-n3 | NIT | `tests/generated/loopback-scan.ts:26-28` | `withoutComments` is regex-based. A `' //'` string before a fetch on the same line hides the call (probe: `const a = ' //'; await fetch(\`http://127.0.0.1:1/\`)` is not flagged). A `'/*'` inside a glob string can also swallow code up to a later `*/`. Today this affects no file. | State the limit in the JSDoc, or strip comments with `ts.createScanner` (typescript is already a dependency). |
| R1-n4 | NIT | `tests/generated/loopback-scan.ts:43-53` | `--cached` lists a tracked file that was deleted in the worktree but not yet `git rm`'d, and `readFileSync` then throws ENOENT, so the whole case crashes instead of reporting. A non-git extract (`git archive` scratch copies) makes `execFileSync('git')` throw. | Filter with `existsSync` (or pass `--deleted` and subtract it). Optionally fail with a named message when `git` is unavailable. |
| R1-n5 | NIT | `tools/db/prisma-client-locked.test.ts:23`; `tools/db/prisma-client-locked.cjs:13` | `?? ''` resolves to the `prisma/` directory when the `./client` `@platform/source` export is missing, so the failure is an obscure directory-import error. The shim throws a bare TypeError in the same case. | Throw a named error, e.g. "prisma/package.json has no ./client @platform/source export", in both places. |

## 5. Deviation rulings (D-TASK291-01..05; none of them is in DECISIONS.md yet, so the orchestrator should record them)

| ID | Ruling |
|---|---|
| 01 (scan rule = global fetch + loopback marker) | **Accepted for this merge, with R1-m1.** The rule is exact on today's tree. A structural rule is the follow-up. |
| 02 (ratchet is a plain unit test in tests/generated, not a `generated`-project case) | **Accepted.** It is stronger than the card: it runs in lane A `unit` on every PR, `jest.config.ts` documents plain `*.test.ts` there as unit, and it needs no app or database. |
| 03 (prisma/ not a scan root) | **Accepted.** It matches the card's "apps, packages, tests and tools". See R1-n2. |
| 04 (prerender: procedural rule only) | **Not accepted as delivered.** See R1-M1. |
| 05 (R1-n6 scope exception: 11 prisma/tests files outside the four locks) | **Accepted.** The card lists these files explicitly, and they do not overlap TASK-293 (section 2). The PR body must carry the D-ORCH-118 statement the card requires ("edits a suite outside its own locks only when no in-flight PR holds that folder ... and says so in the PR body"): `prisma-core` is held by TASK-293, which has no overlapping file. |

## 6. Follow-up closure

| Item | Status |
|---|---|
| PR #57 R1-n4 (shim and test hard-code the client path) | **Closed.** Both read `exports['./client']['@platform/source']`. Residual: R1-n5. |
| PR #57 R1-n6 (11 pseudo-readers on the exclusive side) | **Closed.** All 12 call sites use `withReadLock`, and the per-process rule stays documented in `fs-lock.ts`. Residual: R1-n1. |
| D-TASK288-08 (route-metadata assertion 10 pooled fetch) | **Closed.** All five call sites are converted. |
| PR #56 R2-n3 (api/worker loopback suites) | **Routed.** They are on the allow-list with lock names, and are converted by the next holder of each lock. |
| D-ORCH-113 (b) prerender | **Open.** See R1-M1. |

## 7. Good

- The transport choice really ends the reuse class, and it makes the RLS oracle stricter (no redirect following, no compression), not weaker.
- The ratchet reports in both directions (new user and stale entry), the list stays sorted and unique, lock names are required, untracked files are included, the seeded defects come with negative controls, and the scanner excludes itself.
- R1-n6 converts exactly the pure importers and leaves both CLI runners exclusive.
- R1-n4: the shim and the test now share one source of truth with `prisma-client-package.test.ts`.

## 8. Security flags (for security-analyst)

- `tests/generated/rls/**` (the O3 runner transport), `prisma/tests/**` (lock semantics of the RLS/audit suites) and `tools/db/**` (the shim) changed, so a security record is required. `security-integration` should be selected by the classifier (`prisma/**`, `tools/db/**`). If it is not selected, use the restricted lane-B run of the PR #57 C1 precedent.
- The oracle semantics changed: no redirect following and no `accept-encoding` (stricter; please confirm).
- The ratchet files are not CODEOWNED (R1-m1 (i)).
- Readers of the prisma tree now run concurrently. Writer exclusion is unchanged; residual window (i) of `fs-lock.ts` was already accepted (PR57-SEC-03).

## 9. Merge conditions

- **C1.** R1-M1 closed, by the measurement or by a section 7 re-scope record. A delta review of that record follows.
- **C2.** A lane-B run at the final head, with 0 failures, 0 errors and 0 skips:
  - `integration` (the 11 prisma/tests files);
  - `catalog-c1-c14`;
  - `rls-cross-tenant`, with the same case count as the last main run (card: "identical counts");
  - the `unit` suite (15 new ratchet tests).

  The card's 20/20-under-load measurement for each converted suite and for the lock change is either attached here or routed in the C1 record.
- **C3.** A security record on the head.
- **C4.** The PR body carries the D-ORCH-118 statement (section 5, item 05) and does not claim the prerender item.
- **Recommended in the same push** (not blocking): R1-m2 (two one-line edits) and R1-m1 (i) (the ceiling pin and the CODEOWNERS line).
