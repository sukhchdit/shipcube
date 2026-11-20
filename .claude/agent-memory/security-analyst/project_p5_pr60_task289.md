---
name: project-p5-pr60-task289
description: PR #60 (TASK-289 rbacfu, TASK-027-F) security r1 @df31b32 PASS_W_F-U (cb3bf8d); r2 delta @c912a0a (code f2a7411, merge of #56) PASS_W_F-U, SEC-02 closed, record handed via .orch/records; LOW 01 test-category laundering (TASK-283 before TASK-060), INFO 03-05; probe kit
metadata:
  type: project
---

Record `docs/05-quality/security/PR-0060-TASK-289-security-review.md`, committed as `cb3bf8d` on top of the code review r1 `89c24d8` (APPROVED_WITH_NITS) in worktree `Shipqube-TASK-289`. Both went in one push (D-ORCH-119). Head row `df31b32` (code `1353e78`), base `c2b74c1`, 20 owned paths. Main's checker returned `pass` on `cb3bf8d`.

**Findings (D-SEC-PR60-01):**
- **01 LOW** — `TEST_FILES` (`**/{test,tests,__tests__}/**`) may import `@platform/authz/matrix`, and app/package code may import a `test`-category file (boundaries default allow). That makes a two-hop laundering lint-clean.
  - `prune-dist` keeps the `test/` and `__tests__/` folders (only `tests/` is pruned), and keeps `dist/generator`.
  - Fix: the D-ARCH-136 (b) arm already planned on TASK-283 (it was probed: it kills L3/L4; 0 production→test imports in 201 files).
  - Due before TASK-060 merges. The task map has no TASK-283→060 edge.
- **02 INFO — CLOSED in r2** (`UNPRESENTED_CREDENTIAL_HEADERS` + a totality test + a partition pin by value).
- **03 INFO** (= R1-n3, mutant A3 survived) — the `STUBBED_CREDENTIAL_KINDS` list is not load-bearing. Owner: the TASK-052 tripwire.
- **04 INFO** — no combined declared+foreign credential cells ("cannot choose the principal"; the `__Host-` cookie rides along on every call). Owners: TASK-052/055.
- **05 INFO** (= reviewer flag (a)) — `./matrix` sits outside the `./testing` convention: it ships and the preflight imports it. Owner: TASK-283 (`SKIPPED_EXPORTS` or a rename).
- **Flag (b) accepted** — a seed/tools `import()` of the oracle is not refused (probed), but neither path decides a request.

**Round 2 (2026-11-17), delta `df31b32..c912a0a`:**
- fc1 `b66f450` (tests/JSDoc), then merge `f2a7411` of main `d173d8f` (PR #56 + #59), then evidence `c912a0a`.
- **PASS_WITH_FOLLOW-UPS, no new finding.**
- The full record (r1 bytes plus an r2 section, LF, 333 lines, blob `16df5e3`) was written to `Garudavega/.orch/records/PR-0060/` for the orchestrator to commit. Its Head row names `c912a0a`.
- The merge is a pure union, with `eslint.config.mjs` the only overlap. Sim S5 proved that naming the pre-merge `b66f450` is voided by main's eslint hunk.
- Sim: 11/11 with main's checker (tooling `732ad20`), base `d173d8f`.
- Routing note to the orchestrator: PR56-SEC-12 (owner "next PR touching eslint.config.mjs") is NOT taken by #60. It goes to the next lint-lock holder, TASK-283.

**Merged and a duplicate r2 (2026-11-17):** PR #60 was squash-merged as `96c2c7a` (14:13Z) at head `ad7d44d` (code review r2 plus the sibling's r2, committed by the orchestrator). A second r2 dispatch reached me after that and found nothing new on the merged config: the 22 forms and 3 forms from PR #56's new categories were all refused, and L1-L4 were still clean. Nothing was pushed.
- **New INFO, proposed as PR60-SEC-06, owner TASK-060:** `fillPath` (`runner.ts`) still uses `/:(…)|\{(…)\}/`. After the R1-n5 change, `*orgId` wildcards are enumerated but never substituted, so a wildcard SEC-TC-01 case never sends the foreign id (probe: `/organisations/files/*orgId` is filled unchanged). Fix: one shared regex. TASK-060's R-03 rule could instead refuse `*orgId` (Express 5 wildcard params are arrays).
- **Lesson:** before starting any round, `git ls-remote` the branch and `gh pr view --json state`, and grep the record for an existing round with the same Head. Duplicate dispatches happen.

**Why:** TASK-060 rewrites `authorise`. The oracle must stay independent until then, or the O3 matrix confirms itself.

**How to apply:**
- **TASK-283 review** — check the test-category arm, the oracle laundering fixture, `test`/`__tests__` in prune-dist and preflight `TEST_ARTIFACT`, `./matrix` in `SKIPPED_EXPORTS` (or the rename), and PR56-SEC-12.
- **TASK-060 review** — refuse to sign off unless the arm is on main.
- **TASK-052 review** — check the tripwire also refuses a seam-format bearer of the retired kind, plus the combined rows.
- **TASK-048/187** — they owe the proof-header foreign columns; their entries come out of `UNPRESENTED_CREDENTIAL_HEADERS`.
- **Activation PR** — PR48-SEC-02 CODEOWNERS is still open.

**Probe gotchas:**
- `AUDIT_WRITER_ALLOW_LIST` includes `apps/api/src/modules/shipments/service/**`. A "module must not import `platform/audit/*`" control placed there is clean by design; use `modules/orders`.
- The session scratchpad is shared with sibling agents (the code reviewer used `pr60r2/`). Use distinct subdir names and delete only your own files.

**Probe kit:**
- r1 kit in `scratchpad/review/PR-60-sec/`:
  - `lintprobe.mjs` — `lintText` with the worktree's real config, cwd the worktree. The `candidate` argument appends a policy by cloning the boundaries block options from the imported config.
  - `testimports.mjs` — production→test import scan.
  - `cmpprobe.mjs` — type-stripped `runner.ts` with stubbed imports.
  - `matrixdiff.mjs` — cell-by-cell comparison with flip controls.
  - `sim2.mjs` — plumbing commits plus a sparse `--shared` clone checkout. The checker reads records from the WORK TREE.
- r2 kit in `pr60r2-sec/`:
  - `hooks.mjs` — `registerHooks`: maps `@platform/*` to the worktree src and `.js` to `.ts`, transform-strips the types, and applies the in-memory mutations from env `PR60_MUT`.
  - `totality.mjs` — one child process per mutant.
  - `sim.mjs` — scenario commits in a scratch `clone --shared`, so no object reaches the main repo.

Related: [[project-p5-pr48-rbac-matrix]], [[project-p5-pr56-task029]], [[project-p5-pr53-r2]], [[project-security-review-conventions]]
