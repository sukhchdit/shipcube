---
name: project-p5-pr18-supersede
description: PR #18 (TASK-016 supersede of PR #11) supersede round @0f9ff27 PASS_WITH_FOLLOW-UPS, no new finding; method for supersede rounds (three-way tree compare, scratch clone --shared record check); negative-fixtures.test.ts overlap ruling; PR #4 / PR #13 follow-on checks
metadata:
  type: project
---

The supersede round for PR #18 (TASK-016, supersedes PR #11 per D-ORCH-018) is in `docs/05-quality/security/PR-0018-TASK-016-security-review.md`. It is a NEW file, because lane A's record check needs a `PR-0018-*` name; a round appended to PR-0011 would not count.
- **Head and verdict:** `0f9ff27`, 2026-11-13. PASS_WITH_FOLLOW-UPS, no new finding. It authorises the merge once the record is committed as a docs-only commit and lane A is green.
- **Content review:** stays in PR-0011 R1–R3. The open items are carried over: PR11-SEC-14 b/c, 16 LOW; INFO 11 c–g, 15, 17.

**Facts:**
- **D-ORCH-020 merged PR #17 first,** so PR-0011 §R3.7's "non-docs diff 37a2109..new is empty" was false by design.
  - The real delta is PR #17's 15 paths (all equal to main) plus one overlap, `tools/lint/negative-fixtures.test.ts`, resolved in `0f9ff27`.
  - The resolution keeps every exact-mode TASK-016 assertion.
  - It splits the audit-writer and tenant-db wiring tests: the `error` halves always run, the `off` halves are exact-only. `expect-affected` accepts `warn` or `error` in no-weakening mode.
- **Owned paths:** PR #18 changes 74.

**Reusable method (also for the PR #13 supersede, D-ORCH-017/020):**
- **Three-way `ls-tree -r -z` comparison.**
  - Inputs: base `63accea`, old head, main, new head.
  - Expected entry: the old head's if the PR changed the path, else main's. Compare mode, type and oid. List the overlaps separately.
  - Positive control: main treated as the new head.
  - This proves equivalence, docs included, in one run.
- **Line-carry script for the overlap.** For each side, list the lines it added that are missing at the head. Map each missing line to its restructured assertion.
- **Record check.**
  - `git clone --shared --no-checkout <main checkout>` into scratch, check out the head detached, and commit the record there.
  - Run main's `check-security-owned-paths.mjs` with `--root clone --base <main sha> --pr N`.
  - Controls: no record → missing; `--pr <old>` → missing; `--pr <other>` → missing.
  - Then `rm -rf` the clone (no junctions in it).

**How to apply:**
- **PR #4 delta round** (it merges after #18, see [[project-p5-wave0-web-scaffolds]]): its `negative-fixtures.test.ts` / `jest.config.ts` resolution must keep the `TENANT_DB` (36 cases) and `WARNINGS` tables and the split above.
- **Re-resolving the file voids the PR-0018 record** (checker rule (d)). If PR #18 is rebased or re-merged with main, any change to its owned paths needs a delta round.

Related: [[project-p5-pr11-rls-review]], [[project-p5-pr17-fixture-subset]], [[project-p5-pr13-seed-framework]], [[project-security-review-conventions]]
