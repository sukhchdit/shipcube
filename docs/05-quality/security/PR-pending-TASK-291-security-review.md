# PR-pending: TASK-291 (TASK-W0-FLAKE-3: one-shot loopback transport for the generated suites, pooled-fetch ratchet, PR #57 leftovers), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-291-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>`, so under the placeholder name the record step is red (section 7, control C1). This follows the D-ORCH-136 order: open as a draft, rename on main, confirm the rename, then mark the PR ready.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-291-task-w0-flake-3-one`, two commits on `ca7e4b7` (merge base, PR #65 merged): `1672070` (the change) and `f4f8a12` (code review round 1 fixes). To be pushed as these code commits plus evidence-only commits (lane B run files under `docs/05-quality/tests/runs/` only) |
| Head | f4f8a1226dfa844a54b482e06dfc2dd4665223cb |
| Tip to push | `f4f8a12` plus evidence-only commits. Main's checker accepts that tip through the merge ref (section 7). Any later change to an owned path, including `apps/api/src/platform/routing/tests/loopback.ts` for PR291-SEC-01, voids the binding and needs a delta round (sim control C6) |
| Lane A evidence | None: the branch is not pushed. The classifier on main selects `security-integration` for this range (section 6) |
| Lane B evidence | None for `f4f8a12` at review time. The orchestrator queues lane B on `f4f8a12` (merge condition C1) |
| Owned paths changed | 20 as main's checker counts them on the test merge: `.github/CODEOWNERS`; the 11 `prisma/tests/**` reader files; `tests/generated/rls/{api-cases.ts, api-cases.test.ts, cross-tenant.int.test.ts}`; `tools/db/prisma-client-locked.{cjs,test.ts}`; and, through the head's own new CODEOWNERS line (the checker reads CODEOWNERS from the base and from the checked-out head), `tests/generated/{loopback-scan.ts, loopback-ratchet.test.ts, loopback-fetch-allowlist.json}`. With main's CODEOWNERS alone the count is 17 |
| Unowned paths changed | `tests/generated/route-metadata.test.ts` (read in full: transport and timeout only) |
| Binding items checked | The TASK-291 card (WAVE-00 batch 0.13): "the whole-response comparison and its findings are unchanged", R1-n4, R1-n6, the security-integration DoD note. D-SEC-PR57-01..03 (PR #57 C1 precedent; PR57-SEC-05 owner note). D-ORCH-113, D-ORCH-118, D-ORCH-136, D-ORCH-137. The code review twin on main (`f3f9557`, `docs/05-quality/reviews/PR-pending-TASK-291-code-review.md`, round 1 at `1672070`, CHANGES_REQUESTED; read after my probes ran, section 5). The coordinator's note that `f4f8a12` replaced `1672070` and that the web-prerender item is re-scoped out (D-ARCH-158) |
| Reviewer / date | security-analyst, 2026-11-19, round 1, pre-push. Host rule (lane B owns the machine): no npm, Jest, type-check, build or Docker. Method: static review plus single-process Node probes on `git show` extracts of `1672070` and `f4f8a12` (head), `ca7e4b7` (merge base) and main's `tools/ci`. Nothing ran in the PR worktree, not even read-only git: commits were read from the main checkout's shared object store. Line numbers come from single-file reads at `f4f8a12` |

## 1. Summary

The questions of this round: did the transport change weaken any expectation of the RLS suites? Can the shim's new manifest read load a different client? Are the read locks only taken by readers? Are the allow-list's lock labels right? Is the new CODEOWNERS line sound? Is `security-integration` expected, and what must hold before merge?

- **The RLS suites' assertions are textually unchanged.**
  - In `tests/generated/rls/**` the diff is the transport line in `runApiCase` (`api-cases.ts:130`), the close helper in `api-cases.test.ts` and `cross-tenant.int.test.ts`, and the timeout constant in `api-cases.test.ts`.
  - Per file, the counts of `describe(`, `it(`, `it.each(`, `test(` and `expect(` at `f4f8a12` equal the merge base's for every owned test file. That includes `api-cases.test.ts` (9 `it`, 23 `expect`) and `cross-tenant.int.test.ts` (13 `it`, 6 `it.each`, 38 `expect`). The `.skip`, `.only` and `.todo` counts are 0 on both sides.
- **The transport is stricter in two places and narrower in one (PR291-SEC-01, LOW).** I built a differential over the verbatim runner text: the base copy uses the global `fetch`, the head copy uses `fetchOnce`, and both run against one fake server, 27 behaviours.
  - **Same verdicts:** isolation, a single leaking `ETag`, a body leak, duplicated `x-custom` or `set-cookie`, the leak in the first of two `ETag` or `Location` lines, and gzip on request. All give identical problem lists.
  - **Stricter:** `fetchOnce` does not follow redirects. A 302 whose `Location` carries B's id now gives 5 problems where `fetch` gave none, and a 301 on the positive call is now named. Unconditional gzip fails closed: "body is not JSON".
  - **Narrower:** Node's HTTP client keeps only the first copy of 16 response headers when a response sends the same header twice. The 16 include `etag` and `location`, the two headers the R2-n2 (b) check names. So a refusal whose second copy of such a header carries B's value is named by the base runner and missed by the head runner, in 16 of 16 cases.
  - **Fix:** one option on the request, `joinDuplicateHeaders: true`, in `loopback.ts`. With it, 24 of 27 rows give byte-identical problem lists to the base, and the other 3 are the stricter rows.
  - **Exposure today:** none reachable. `API_CASES` is empty on main, the fixture routes set single headers, and the problem handler removes every `ETag` and `Last-Modified` copy from problem responses (`problem-handler.ts:102`).
- **The shim cannot be redirected without two security-owned edits (PR291-SEC-02, INFO).**
  - The shim follows `prisma/package.json` `exports['./client']['@platform/source']`. With crafted values, it loads targets that Node's own exports resolver refuses (`ERR_INVALID_PACKAGE_TARGET`): `../`, `./../`, a target without `./`, and a `node_modules` segment. That includes a file outside the repository.
  - The manifest is owned three times in CODEOWNERS, and `tools/db/prisma-client-package.test.ts:51-58` (also owned) pins the exact value. So a redirect needs two owned edits and a record, and the trust boundary did not move.
  - The shim's own test is now circular: it derives the expected path from the same manifest. That is acceptable only because of that pin.
  - `f4f8a12` turns a missing or non-string target into a named error. Before, it was a TypeError.
- **The read locks are taken by readers only.**
  - The 11 `prisma/tests/**` files are a rename-only change: `withFileLock` to `withReadLock`, applied with `/g`, gives the head byte for byte.
  - All 12 call sites run nothing but `import('../../generated/prisma/client.js')`.
  - The generated client imports only `node:` modules, `@prisma/client/runtime/*` and its own siblings, so it never re-enters the shim.
  - The remaining exclusive takers stay exclusive: the harness and shadow-init Prisma CLI runs, and the tools/db and tools/deps rebuild tests.
  - `fs-lock.ts` is unchanged since PR #57.
- **Lock labels: 5 of 6 exist, `contract-stubs` does not (PR291-SEC-03, INFO).** `tests/contract-stubs/` sits in the file list of the task whose lock is `api-openapi`. 9 of the 10 listed files are security-owned, so each conversion needs a record.
- **The new CODEOWNERS line is sound.** It only widens the owned set. It covers the three ratchet files, including a future `loopback-*` directory, and binds this PR itself.
- **`security-integration` is selected.** Main's classifier says `true`, with 15 trigger paths. The hosted job runs `rls-cross-tenant` and `catalog-c1-c14`, but not the `integration` suite that holds 9 of the 11 converted readers. So lane B evidence at the head is the merge condition (C1), as in the PR #57 C1 precedent.

## 2. Method

- **Diff.** I read `git diff ca7e4b7 f4f8a12` (22 files) and `git diff 1672070 f4f8a12` (6 files) in full. I also read the files in context at the head: `loopback.ts`, `fs-lock.ts`, `jest.config.ts`, `prisma/package.json`, CODEOWNERS, `problem-handler.ts`, and the `cross-tenant.int.test.ts` API block.
- **Transport differential** (session scratch `r291/probes/transport.mjs`, `build.mjs`).
  - **Runner copies.** I took the runner text from `interface Call` to the end of `api-cases.ts`, verbatim from the merge base (global `fetch`) and from the head (`fetchOnce`). Types were stripped in transform mode. Only the module imports were replaced, by stubs equal to `generator.ts` (`pathParameters`, `isSuccessStatus`) and `database.ts` (`seededValues`).
  - **Transport.** `loopback.ts` at the head is the transport. A third copy adds `joinDuplicateHeaders: true` as the fix candidate.
  - **Server.** One `node:http` server with random row ids and a session-only route (B's id gives the negative call, A's id the positive).
  - **Behaviours (27):**
    - 3 controls: isolation, a single leaking `ETag`, a body leak;
    - the 16 headers Node keeps only once, each sent twice with B's id in the second copy;
    - `x-custom` and `set-cookie` sent twice;
    - the leak in the first of two `ETag` or `Location` lines;
    - a 302 on the negative call, a 301 on the positive call;
    - gzip only on request, and gzip always.
  - **Re-runs.** I ran it 4 times. The flag table was the same each time. The exact problem lists were equal in the last 3 runs. In the first run one row (`x-custom`) differed in text between base and fix candidate while both flagged; it did not reproduce.
- **Header behaviour.** A three-way header dump (`xcustom.mjs`) shows `fetch` returning `"e1", "e2"` for a doubled `ETag`, `fetchOnce` returning `"e1"`, and the fix candidate returning `"e1", "e2"`.
- **Shim probe** (`shim2.mjs`). I took the shim of each head verbatim (`git show`) into a scratch tree with a pass-through lock stub. For each of 9 manifest values I ran it in a fresh process, next to Node's own exports resolution of the same manifest (self-reference, `--conditions=@platform/source`).
- **Lock change.** Rename-only proof: `sed s/withFileLock/withReadLock/g` on the merge-base file equals the head file, for all 11 files. I also grepped every lock caller at the head, and grepped the generated client's imports (the main checkout's `prisma/generated`, the same generator).
- **Classifier and checker.** I ran main's `tools/ci/security-paths.mjs` on `ca7e4b7..1672070` (`security_paths=true`, 15 paths; `f4f8a12` adds no trigger path). I ran main's `check-security-owned-paths.mjs` `--json` for the owned list, and its `patternToRegExp` on the new CODEOWNERS line.
- **Record simulation** (section 7).
- **Not run (host rule):** lint, type-check, Jest and lane B. The fix candidate was probed in scratch only.

## 3. What was asked, and what I found

### 3.1 Transport: no expectation weakened?

| Behaviour of the refusal (row B) | Base, global `fetch` | Head, `fetchOnce` | Fix candidate | Reading |
|---|---|---|---|---|
| Isolated (control) | pass | pass | pass | same |
| One `ETag` carrying B's id (R2-n2 (b) shape) | named | named | named | same |
| B's name in the body | named | named | named | same |
| `etag` twice, B's id in the 2nd copy | named | **missed** | named | narrower |
| `location` twice, B's id in the 2nd copy | named | **missed** | named | narrower |
| 14 further headers Node keeps once (`age`, `authorization`, `expires`, `from`, `host`, `if-modified-since`, `if-unmodified-since`, `last-modified`, `max-forwards`, `proxy-authorization`, `referer`, `retry-after`, `server`, `user-agent`), twice, B's id in the 2nd copy | named (14/14) | **missed (14/14)** | named (14/14) | narrower |
| `x-custom` or `set-cookie` twice | named | named | named | same |
| B's id in the 1st of two `etag` / `location` lines | named | named | named | same |
| 302 to `/leak/<B id>`, target answers a clean 404 | **pass** | named (5 problems: status, type, JSON, code, `location`) | named | stricter |
| Positive call answered 301 to A's row | pass | named (positive control) | named | stricter |
| gzip only when asked | named | named (no `accept-encoding` is sent, so the body is plain) | named | same |
| gzip always | named (decoded) | named ("body is not JSON", code) | named | fails closed |

- **Request side.** `fetch` also sends `accept-encoding`, `accept-language`, `sec-fetch-mode` and `user-agent`; `fetchOnce` sends only the caller's headers plus `host`, `connection: close` and `content-length`. No API slot decides on those headers: `execute.ts:226` copies `user-agent`, falling back to an empty string, into the context. No finding.
- **Body.** `fetchOnce` resolves only on `end`, and a reset rejects, so a refusal is never judged on a partial body it did not flag. A GET with a body, which `fetch` refused with a TypeError, is now sent. That lets more cases run and weakens nothing.

### 3.2 The shim's manifest read: can a crafted value point outside the tree?

| `@platform/source` value | Shim at `1672070` | Shim at `f4f8a12` | Node exports resolver |
|---|---|---|---|
| `./generated/prisma/client.ts` (head value, control) | loads the generated client | same | resolves the same file |
| `../evil-in-tree.cjs` | loads it (out of `prisma/`) | same | `ERR_INVALID_PACKAGE_TARGET` |
| `../../outside.cjs` | loads it (out of the repository) | same | refused |
| `./../evil-in-tree.cjs` | loads it | same | refused |
| `generated/prisma/client.ts` (no `./`) | loads the client | same | refused |
| `./node_modules/x/index.cjs` | loads it | same | refused |
| `/generated/prisma/client.ts` | loads the client (joined under `prisma/`) | same | refused |
| `123` | TypeError | named error | refused |
| `{ "node": "./generated/..." }` | TypeError | named error | resolves (nested conditions) |

Yes, mechanically. But only through the manifest, which is owned (`/prisma/package.json`, `/prisma/`, `**/package.json`) and exactly pinned by the owned `tools/db/prisma-client-package.test.ts:51-58`. Before this PR, the Jest path was pinned by the shim's literal and the same field already steered `tsc` and `tsx` (`customConditions`). So the set of files a redirect must touch, all owned, did not shrink. PR291-SEC-02 records the defence-in-depth gap.

### 3.3 Read locks versus write locks

- **Who writes.** A reader that wrote under a shared lock could race another reader or a queued writer. No converted reader writes.
  - The callbacks are only the dynamic import.
  - Jest's transform cache lives outside the prisma tree (no `cacheDirectory` in `jest.config.ts`).
  - The client's lazily loaded query compiler comes from `node_modules/@prisma/client/runtime`, which no writer regenerates. Its timing relative to the lock is the same as under the old exclusive lock: load only.
- **Writer side.** Writers keep `withFileLock`: `prisma/tests/harness/postgres.ts:116`, `prisma/tests/shadow/shadow-init.int.test.ts:64`, `tools/db/prisma-client-package.test.ts:112`, and `tools/deps/{ignore-scripts.test.ts, prisma-engines.test.ts, prisma-engines.int.test.ts}`. Each waits for foreign readers before running.
- **Same-process overlap.** Under the old exclusive lock, any same-process writer-reader overlap would have been a 600 s self-deadlock. So none existed, and the per-process re-entrancy of readers adds no hazard to today's call graph.
- **Code twin R1-n1** (a nested read lock while a foreign writer is queued): I agree it is unreachable today, because the generated client never loads the shim. It is an availability hazard of the tests only. No security finding.

### 3.4 The allow-list's lock labels

`api-audit-mw`, `api-platform-core`, `api-openapi`, `api-tx-execute` and `worker-platform-core` are lock names in `docs/04-plan/generator/plan-data.mjs`. `contract-stubs` is not: the string appears there only as the path `tests/contract-stubs/`, in the file list of the task whose locks are `api-openapi` and `shared-api-types`. The ratchet test checks only that a label is non-empty, so a label that names no lock passes. See PR291-SEC-03.

### 3.5 The CODEOWNERS line (`f4f8a12`, `.github/CODEOWNERS:83`)

- **Pattern.** `/tests/generated/loopback-*` becomes `^tests\/generated\/loopback-[^/]*(?:$|\/)`. It matches the scan module, the ratchet test, the allow-list, and anything under a future `loopback-*` directory. It does not match outside `tests/generated/`.
- **Binding.** The checker reads the base copy from git and the head copy from the checked-out merge, so this PR is already bound by its own line (20 owned paths in the simulation, 17 with main's file alone).
- **What it costs.** In this repository CODEOWNERS is the security-owned list, so every later change of the allow-list or the pin needs a security record. 9 of the 10 listed files are already owned (`apps/api/src/platform/**`, `tests/contract-stubs/`), so the extra review load is small. The worker health suite is the one conversion that newly needs a record.
- **Reviewer duty.** A later record that touches these files has to check that the list and `PINNED_CEILING` only shrink; the checker sees only that a record exists.
- **Verdict.** Accepted. A line that only adds ownership never weakens the gate.

## 4. Findings

| ID | Severity | CWE / OWASP | File:line | Finding | Fix | Verification | Owner / due |
|---|---|---|---|---|---|---|---|
| PR291-SEC-01 | LOW | CWE-693 (protection mechanism failure: the oracle's header coverage), A04:2021 | `apps/api/src/platform/routing/tests/loopback.ts:81-90`, `:100-103`; used by `tests/generated/rls/api-cases.ts:130`, `:158` (and `tests/generated/rbac/runner.ts` since PR #60) | **`fetchOnce` keeps only the first copy of 16 response headers when a response sends the same header twice, so the O3 runner's header scan misses a cross-tenant value in the second copy.** Node's `IncomingMessage.headers` discards duplicates of `age`, `authorization`, `content-length`, `content-type`, `etag`, `expires`, `from`, `host`, `if-modified-since`, `if-unmodified-since`, `last-modified`, `location`, `max-forwards`, `proxy-authorization`, `referer`, `retry-after`, `server` and `user-agent`. The `content-*` pair is excluded from the probe: `content-type` has its own check, and a doubled `content-length` is a parse error. `fetch` (undici) and browsers combine both copies, so an attacker's client would see a leak that the oracle cannot. The card requires the findings to be unchanged. **Exploitability and impact:** a detection gap, not a leak. It needs an independent bug that sends one of these headers twice on a refusal, with only the later copy carrying the other tenant's value. Express `res.set` replaces, the problem handler drops every `ETag` and `Last-Modified` copy on problems, and `API_CASES` is empty on main. Impact M × Likelihood L. The RBAC runner's D-ARCH-109 header comparison has had the same blind spot since PR #60 (my PR #60 review missed it). | In `fetchOnce`'s request options, add `joinDuplicateHeaders: true`. Alternatively, build `answered` from `response.rawHeaders` pairs with `append`. Either makes the header view equal `fetch`'s; the probe shows parity on 24 of 27 rows, and the other 3 are the intended stricter rows. Update the JSDoc ("headers as fetch combines them"). | (a) `loopback.test.ts`: a server that sends `etag` twice gives `response.headers.get('etag') === '"e1", "e2"'` (red without the option). (b) `api-cases.test.ts`: `refusalHeaders` returning `etag: ['"x"', '"<B id>"']` and `location: ['/x', '/orgs/<ORG_B>']` names both headers (red without the option; the writeHead type accepts arrays). (c) A mutant that removes the option must fail (a). | Senior-developer. **Preferred: this PR's next push.** `loopback.ts` is in the card's file list and the `api-routing` lock TASK-291 holds. It then needs a delta security round, because `loopback.ts` is owned (sim C6). Otherwise, the next holder of `api-routing`, due before the first `API_CASES` registration (TASK-051, TASK-211 or a module task) and before `rbac-matrix` activation, whichever comes first, and in any case before G3 |
| PR291-SEC-02 | INFO | CWE-73 (external control of a file path), A08:2021 | `tools/db/prisma-client-locked.cjs:13-21`; `tools/db/prisma-client-locked.test.ts:19-24` | **The shim's hand-rolled resolution accepts exports targets that Node refuses** (`../`, `./../`, no `./`, `node_modules` segments; a file outside the repository loads). The shim test derives its expectation from the same manifest, so it cannot see a redirect. It is mitigated by the exact pin in `prisma-client-package.test.ts:51-58`; the manifest and both tests are owned. | Optional hardening on the next touch: before the `require`, refuse any target that does not match `^\./generated/` or that has a `.`, `..` or `node_modules` segment, with a named error. Or resolve the target and require `path.relative(<prisma>/generated, abs)` not to start with `..`. Keep the exact pin. | A shim test with a scratch manifest `../x.cjs` expects the named error. | Next touch of `tools/db/prisma-client-locked.cjs`; no gate |
| PR291-SEC-03 | INFO | CWE-1059 (insufficient technical documentation), process | `tests/generated/loopback-fetch-allowlist.json:13`; `tests/generated/loopback-ratchet.test.ts` | **The lock label `contract-stubs` names no lock in `plan-data.mjs`.** The code twin's section 2 says all six exist, which does not hold for this one. The file is the security-owned SEC-TC-29 contract-stub suite, so its conversion to `fetchOnce` would have no task to pick it up. The ratchet test accepts any non-empty label. | Label it `api-openapi`, the lock of the task that lists `tests/contract-stubs/`. Optionally the ratchet test reads the lock names from `plan-data.mjs` and refuses unknown labels. | Ratchet test: every label is a lock name. | Qa-lead / senior-developer, in this PR's next push (now an owned file: it rides the same delta round) or the next touch of the allow-list |

No Critical, High or Medium finding. Earlier items closed by this PR:
- **PR #57 R1-n4:** the shim and its test read the manifest; the residual is PR291-SEC-02.
- **R1-n6:** 12 readers on `withReadLock`.
- **Code review R1-n5:** a named error since `f4f8a12`.

PR57-SEC-05 (the `withFileLock` spin) was already closed at PR #57 round 3. `fs-lock.ts` is unchanged here.

## 5. The code review twin

`docs/05-quality/reviews/PR-pending-TASK-291-code-review.md` (main `f3f9557`, round 1 at `1672070`, CHANGES_REQUESTED). I read it after my probes.

- **Section 3, "it is at least as strict as before".** It is stricter on redirects and compression, as I also found, but narrower on doubled headers. That is PR291-SEC-01; the two records should be read together.
- **Section 2, lock labels.** "All exist in `plan-data.mjs`" does not hold for `contract-stubs` (PR291-SEC-03).
- **R1-m1 (i), CODEOWNERS line and ceiling pin.** Both are in `f4f8a12`. The line is accepted (section 3.5). The pin is a list equal to today's allow-list. It enforces "only shrink" against a growth in the same PR only together with the CODEOWNERS line, which makes such an edit a reviewed, owned change.
- **R1-m2.** Both suites now use `LOOPBACK_TEST_TIMEOUT_MS` (180 s), so the 60 s named `FetchOnceTimeoutError` fires before Jest's timeout. A longer timeout weakens no assertion.
- **R1-n1:** agreed, no security impact (section 3.3).
- **R1-n5:** closed by `f4f8a12`.
- **R1-M1 (prerender):** not security. Per the coordinator, it is re-scoped out by D-ARCH-158.

## 6. `security-integration` and lane B

- **Selection.** Main's `tools/ci/security-paths.mjs` classifies `ca7e4b7..1672070` as `security_paths=true` (15 paths, from `prisma/**`, `tools/db/**` minus `*.test.ts`, and `tests/generated/rls/**`). `f4f8a12` adds no trigger path; CODEOWNERS and the unowned files are not triggers. So ci-gate needs the hosted job's success or an inherited proof, and degraded mode never waives it (D-ARCH-021).
- **What the hosted job covers.** The tested base's `security_integration_suites` are `rls-cross-tenant`, `rbac-matrix`, `audit-generator`, `audit-immutability`, `csrf-cookie` and `catalog-c1-c14`. Only `rls-cross-tenant` and `catalog-c1-c14` are active.
  - `catalog-c1-c14` covers `prisma/tests/catalog/`.
  - `rls-cross-tenant` covers `tests/generated/rls/`.
  - Neither runs the `integration` suite, which holds 9 of the 11 converted readers (`prisma/tests/{audit, db, harness, rls}`).
- **Therefore:** lane B at the head is the merge condition (C1), as in the PR #57 C1 precedent, and the hosted job is required on top by ci-gate.

## 7. Record binding and simulation

The checker (main's `tools/ci/check-security-owned-paths.mjs`, unchanged by this PR) reads records and the head CODEOWNERS from the checked-out test merge. The record therefore counts once two things hold: it is on main under its `PR-<NNNN>-` name, and a `pull_request` event after that rename builds the merge ref. It binds through the single `Head` row (the full `f4f8a12` SHA, a commit in `<base>..<head>`). Evidence-only commits change no owned path, so rule (d) holds for the tip.

Simulation (`r291/probes/sim.mjs`). Setup:
- a `git clone --shared` of the main repository, sparse checkout of `/.github/ /docs/05-quality/security/ /tools/ci/`;
- scenario commits built with plumbing;
- main = `8084977` (its tip when this round was written; PR #70 merged, and the checker, the classifier and CODEOWNERS are unchanged by it) plus a record commit;
- the test merge = `merge-tree` of that with the PR tip, checked out so the head CODEOWNERS is the merge's;
- the checker taken from the merge's tree, with `--pr 9991` as a stand-in number.

| Scenario | Base given to the checker | Head | Result | Expected |
|---|---|---|---|---|
| S1 record on main under `PR-9991-…`, evidence tip | merge base `ca7e4b7` | evidence tip | exit 0, pass (20 owned) | pass |
| S2 same | main + record | evidence tip | exit 0, pass | pass |
| S3 same | main before the record | evidence tip | exit 0, pass | pass |
| S4 same, code head pushed alone | merge base | `f4f8a12` | exit 0, pass | pass |
| S5 same, two evidence-only commits | merge base | second evidence commit | exit 0, pass | pass |
| C1 record only under the placeholder name `PR-pending-…` | merge base | evidence tip | exit 1, missing | fail |
| C2 no record | merge base | evidence tip | exit 1, missing | fail |
| C3 a later `FAIL` verdict row appended | merge base | evidence tip | exit 1, missing | fail |
| C4 the `Head` row names the merge base instead | merge base | evidence tip | exit 1, missing | fail |
| C5 a `tests/generated/rls/api-cases.ts` change after the reviewed head | merge base | that commit | exit 1, missing | fail |
| C6 a `loopback.ts` change after the reviewed head (the PR291-SEC-01 fix) | merge base | that commit | exit 1, missing (21 owned) | fail |
| C7 a `loopback-fetch-allowlist.json` change after the reviewed head (owned only through the head's new line) | merge base | that commit | exit 1, missing | fail |
| C8 the record named for another PR number | merge base | evidence tip | exit 1, missing | fail |
| C9 the `Head` row names `1672070`, the commit before the review fixes | merge base | evidence tip | exit 1, missing | fail |

14 of 14 as expected. The record has exactly one `Head` row, no `Branch / head` row and one `Verdict` row (the last table row of the file). C9 shows why the binding is `f4f8a12`: `f4f8a12` changed three owned paths (`.github/CODEOWNERS`, the shim, `api-cases.test.ts`) after `1672070`.

## 8. Merge conditions and routes

- **C1. Lane B evidence.** A lane B run at `f4f8a12`, or at a later head that changes no owned path after it, recorded under `docs/05-quality/tests/runs/`:
  - `integration`, `catalog-c1-c14` and `rls-cross-tenant` each with 0 failures, 0 errors and 0 skipped (PR #57 C1 precedent);
  - `rls-cross-tenant` with the same total as main's latest lane B run whose tree has the same `tests/generated/rls/` cases as `ca7e4b7` (the card's "identical counts"). Statically, the case sites are unchanged (section 1), and `API_CASES` is empty on both sides;
  - the hosted `security-integration` job green on the PR (ci-gate enforces it).

  The orchestrator verifies the run's summary SHA and dirty flag against JUnit, as for PR #57.
- **C2. Rename.** Rename the record per D-ORCH-136 before the event that must pass. Under the placeholder name it fails (sim C1).
- **If PR291-SEC-01 and PR291-SEC-03 are fixed in this PR (preferred).** A delta security round on the new head: the `loopback.ts` option, the two tests and the mutant, the label, a re-run of this simulation, and C1 on that head.
- **Routes.**
  - **PR291-SEC-01:** senior-developer, this PR or the next `api-routing` holder (due as in section 4).
  - **PR291-SEC-02:** next touch of the shim.
  - **PR291-SEC-03:** qa-lead, this PR or the next allow-list touch.
- **For the conversions of the 10 allow-listed suites.** 9 are security-owned. Each conversion needs a record that checks the suite's header assertions under `fetchOnce`: land the PR291-SEC-01 fix first, or check those assertions explicitly in the record. Each record also checks that the allow-list and `PINNED_CEILING` only shrink.

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_CONDITIONS.** 0 Critical, 0 High, 0 Medium; PR291-SEC-01 LOW (fix preferred in this PR, otherwise before the first `API_CASES` registration or rbac-matrix activation, at the latest G3), PR291-SEC-02 INFO, PR291-SEC-03 INFO. Conditions C1 (lane B at the head: integration, catalog-c1-c14, rls-cross-tenant 0/0/0 with identical rls counts; hosted security-integration green) and C2 (rename). PR #57 R1-n4 and R1-n6 closed |
