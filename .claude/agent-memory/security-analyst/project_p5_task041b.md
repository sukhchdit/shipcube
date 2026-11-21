---
name: project-p5-task041b
description: TASK-041 part 041-B r1 @83a85739 PASS_W_COND (e8067a31, D-SECPR041B-01, record PR-pending-TASK-041B on main, unpushed); SEC-10 abort-after-admission, 11 hold cost LOW, 12-14 INFO; squash of #82 => 16 conflicts
metadata:
  type: project
---

Round 1, 2026-11-21, stacked on PR #82 head `be843ae1` (D-ORCH-150), branch `feat/TASK-041-part-b-rate-limit-rulings-rev2`, head `83a85739` (fix cycle 1). Record `docs/05-quality/security/PR-pending-TASK-041B-security-review.md` + D-SECPR041B-01 committed on local main `e8067a31` on top of the code-review r2 `86cdef9a` and architect `f8794de2` (D-ARCH-225..227), none pushed. Rename to `PR-<NNNN>-TASK-041B-…` when the part-B PR exists.

**Findings:** PR041-SEC-10 LOW (= code review R2-M1, CWE-307): `res.once('close')` releases the in-flight unit even after the auth slot was entered -> limit 5: 13 entries (20 ms slot), 84 (200 ms slot); fix D-ARCH-226 C-1 (enter mark, close releases only un-entered, NO timer) validated on scratch copy (5/5). MEDIUM if it reached TASK-055 lookups. SEC-11 LOW: hold cost (valid creds 429 Retry-After 1; quiet hold by unfinished bodies, also a declared Content-Length > 1 MB with no bytes: body-parser 2.4.0 `dump`s the request before passing 413; Node requestTimeout 300 s default). SEC-12 INFO N x limit bound. SEC-13 INFO event-loop stall > 250 ms opens the breaker (timers phase before poll). SEC-14 INFO precheck ~100 µs at 4 KiB cap (nested JSON). Closed: SEC-09; SEC-03 HTTP side. SEC-02 (b) closes at the delta round.

**Conditions:** C1 fix cycle 2 (C-1, C-2 label `step0-authn-inflight`, C-3 README, H2-H5) + MY DELTA ROUND (re-run abort probe: reset 5 ms after send, staggered, slot 20/200 ms; leak matrix of 11 outcomes). C2 lane B incl. H6 real Valkey. C3 merge-only round after #82. C4 rename.

**Key fact (squash):** the repo squash-merges PRs, so merging main into the part-B branch after #82 conflicts in 16 files (11 add/add, 5 content). Resolve each to the branch blob; prove with `git diff --raw <main> <merge>` == `git diff --raw be843ae1 <head>` (old AND new blob). Main's checker passes resolutions that drop a part-B or main change (sim S7b/S11/S12) — only the raw equality catches them. Code review C3 "pure merge" exemption does not apply.

**Kit (session scratch, `t041b/probes/`):** hooks.mjs (resolve `@platform/*` via the `@platform/source` export of the extract, `@platform/prisma` to main checkout, bare pkgs from main checkout, strip types; NO junctions), pa-abort.mjs, pb-hold.mjs, pd-batch.mjs, pe-lag.mjs, pf-precheck.mjs, gl-over.mjs, gl-generic.mjs (generic-api-key with entropy/allowlists/stopwords, per-hunk fragments), record-sim2.mjs (simulated squash + conflict resolution + item-3 column), mkfix.mjs.

Related: [[project-p5-task041]], [[project-security-review-conventions]], [[project-t39-denial-budget-ruling]]
