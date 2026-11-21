---
name: project-p5-task041b
description: TASK-041 part 041-B r1 @83a85739 PASS_W_COND (e8067a31) + r2 delta @12b8a10a PASS_W_COND (17085083, D-SECPR041B-02, unpushed); SEC-10 + 02(b) closed; new 15 INFO (= CR R3-n2), 16 LOW slot-without-outcome leak; C2-C4 open; squash of #82 => 16 conflicts
metadata:
  type: project
---

Round 1, 2026-11-21, stacked on PR #82 head `be843ae1` (D-ORCH-150), branch `feat/TASK-041-part-b-rate-limit-rulings-rev2`, head `83a85739` (fix cycle 1). Record `docs/05-quality/security/PR-pending-TASK-041B-security-review.md` + D-SECPR041B-01 committed on local main `e8067a31`. Rename to `PR-<NNNN>-TASK-041B-…` when the part-B PR exists (C4).

**Round 1 findings:** PR041-SEC-10 LOW (= code review R2-M1, CWE-307): close released the in-flight unit after the slot was entered. SEC-11 LOW hold cost (accepted; label done in r2; TASK-108/214/PM routes open). SEC-12 INFO N x limit. SEC-13 INFO event-loop stall opens breaker. SEC-14 INFO precheck cost. Closed: SEC-09; SEC-03 HTTP side.

**Round 2 (delta `83a85739..12b8a10a`, fix cycle 2, D-TASK041-19..22), 2026-11-21:** appended to the same record, D-SECPR041B-02, commit `17085083` on local main (on top of code review r3 `f49a7ff1`, APPROVED_WITH_NITS), not pushed. Closed SEC-10 (abort probe 5 in six shapes; control 11-117) and SEC-02 (b) => SEC-02 fully closed. C-2 label/held, C-3 verbatim, D-TASK041-20 confirmed. New: **SEC-15 INFO** (= CR R3-n2) the `enter()`-false guard has unit rows only; it is load-bearing because body-parser inflates gzip bodies asynchronously between step 0 and the slot (without it 20-31 entries at limit 5). **SEC-16 LOW** (CWE-772): after C-1 only `done` releases an entered unit, so a slot that answers the client itself (`res.status(401).json()`, no next) keeps its unit until restart (5 answers => address locked 429 RA 1 for good); pre-existing: such a refusal spends nothing. Fix (a) card lines TASK-052/055/091/171/261 (report only via next/throw/reject, never write the response); (b) optional: release at `finish` if unsettled (validated). My r1 additions (a)/(b) to the (d) wording NOT folded at f2055342 (D-ORCH-158 routes them; check at G3).

**Conditions still open:** C2 lane B on the merge head incl. H6; C3 merge-only round after #82 (item 3 now `git diff --raw be843ae1 12b8a10a`, still 16 conflicts); C4 rename. Any further owned-path commit needs a delta round first.

**Key fact (squash):** the repo squash-merges PRs, so merging main into the part-B branch after #82 conflicts in 16 files (11 add/add, 5 content). Resolve each to the branch blob; prove with `git diff --raw <main> <merge>` == `git diff --raw be843ae1 <head>` (old AND new blob). Main's checker passes resolutions that drop a part-B or main change (sim S7b/S11/S12); only the raw equality catches them.

**Kit (session scratch `t041b-r2/probes/`):** hooks.mjs / hooks2.mjs (adds an observation counter for the wrapper's early return), pa2-abort.mjs (leave = reset|destroy|half, timing fixed|entered), pg-gone.mjs (gzip window, FinalizationRegistry, --expose-gc), pg-burst.mjs, pc-label.mjs, ph-direct.mjs, mkmut.mjs (6 mutants), mkfixf.mjs, record-sim3.mjs (14 scenarios incl. round-1-only control). Extracts were removed after the round.

Related: [[project-p5-task041]], [[project-security-review-conventions]], [[project-t39-denial-budget-ruling]]
