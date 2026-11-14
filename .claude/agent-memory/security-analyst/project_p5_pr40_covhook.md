---
name: project-p5-pr40-covhook
description: PR #40 (TASK-015 merged-coverage hook, D-ORCH-047) R1 @2b651f7 PASS_WITH_FOLLOW-UPS; PR33-SEC-06 closed; LOW 01 .gitattributes blinds diff gate, INFO 02-06; union with PR #38 voids record (package.json); probe facts and merge-only checklist
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0040-TASK-015-covhook-security-review.md`, written into the PR worktree `Shipqube-COVHOOK` (uncommitted, LF, 218 lines) on 2026-11-14. Code review twin was not on main yet (the code reviewer was probing V8 merge semantics in parallel).

**R1 @2b651f7: PASS_WITH_FOLLOW-UPS.** 11 owned paths (package.json, 4 new tools/ci, 6 tools/quality). PR33-SEC-06 CLOSED (4 names in `unit.required_cases`; head verifier rejects a run without them and an inactive authz).
- **LOW 01:** an unowned `.gitattributes` (`*.ts -diff`, `apps/** binary`, or a NESTED one) makes `git diff` print "Binary files differ" with no `+++` line, so the diff gate (now enforcing at heavy `--profile pr`) writes a PASSED "no changed source file in scope". Fix `--text --no-textconv --src-prefix=a/ --dst-prefix=b/` in `diff-coverage.mjs` gitDiff + fail closed on `Binary files` + CODEOWN `.gitattributes`. Host-config twin: `diff.dstPrefix`. Owner devops before G3.
- **INFO 02:** `check-evidence` `nameHasId` is substring + no classname: a Jest title CONTAINING `coverage gate: overall lines` satisfies the required name (probe S2/S3). Fix: exact name + classname === suite id for `coverage gate:` ids (patched copy rejects S1-S3, S6, accepts the real run). 015-C.
- **INFO 03** per-group "project measured" (unit-dom rides on unit's map); **04** `fileKey` lowercases whole path: two case-variant files merge on Linux (4/8 -> 4/4), 015-B; **05** audit/pricing/money/ledger names must join required_cases in the PR that lands their first measured source (TASK-025 for audit); **06** "branches never above combined run" is empirical: re-run the comparison at G3 and on Jest/v8-to-istanbul/swc bumps.

**Facts (probe-confirmed 2026-11-14):** PR #38's runs already carry the 4 names (classname `unit`), so D-ORCH-056's "PR #38 would fail" reason does not hold (order harmless). Pre-#33 runs get 4 required-case reasons under the new manifest. Jest JUnit classname = test-file path; heavy's own cases use the suite id. `collectCoverageFrom` is global, so every partial run lists every in-scope file (placeholders). `istanbul-lib-coverage` 3.2.2 last modified 2023-11-08. Lane A 43536312585: all steps green but the record step; unit 4284 = evidence 4303 - 19 merged-step cases (2 Windows-only skips).

**Method that worked:** three-copy verifier matrix (base-ref `git archive cc18451 tools/quality`, head, patched head) over plumbing scenario commits in a `git clone --shared` (copy ajv + fast-uri, fast-deep-equal, json-schema-traverse, require-from-string into `<clone>/node_modules`, verifier resolves ajv from `--root` first); scenario evidence edits must also rewrite `report_sha256` in summary.json; rename cases instead of deleting them so counts stay equal. Diff-gate probe imports the head `diff-coverage.mjs` and runs it on throw-away repos. Record sim: sparse clone + `record-sim.sh` with a simulated PR #38 squash and union (17/17). `find <worktree> -newer` without pruning node_modules exceeds 120 s: prune or skip.

**How to apply (merge-only round after #38 merges):** overlap is `package.json` only (db:generate + test:coverage lines); all other #40 paths byte-identical to 2b651f7; jest.config.ts unchanged; fresh evidence with the verbatim D-SEC-PR23-02 statements, host scan 0, the 4 names passing with classname `unit`, 4 projects measured, `generated` still not required, authz active; Head row = pushed union merge commit. An owned fix riding along (e.g. SEC-01 in diff-coverage.mjs) makes it a delta round: re-run the verifier matrix and the diff probe.

Related: [[project-p5-pr33-lane-a-hardening]], [[project-p5-pr23-lane-b]], [[project-p5-pr31-staleness-scrub]], [[project-p5-pr38-020b]], [[project-security-review-conventions]]
