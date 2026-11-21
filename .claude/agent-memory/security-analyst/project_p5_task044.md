---
name: project-p5-task044
description: TASK-044 (SSE convention) r1 @dc64193f PASS_W_COND (d04731f7); r2 delta @3b56ab54 PASS_W_COND (ef446899, unpushed): C1/C2 closed, new INFO 08/09 to 044-B; QG-044-C3 concurrence given with G1 conditions for the 044-B round; C3 lane B + C4 PR #80 merge-only owed
metadata:
  type: project
---

**Round 1**, 2026-11-21, pre-push, head `dc64193f` (base `530629f4`), record `docs/05-quality/security/PR-pending-TASK-044-security-review.md` + D-SECPR044-01 (`d04731f7`). 11 owned paths (problem-handler{,.test}, platform/sse/* 8 files, tests/api/helpers/contract-validator.ts). Findings: 01 MED quadratic e-mail regex; 02 LOW guard on live object/keys/key list; 03 LOW unhandled rejection exits replica; 04 LOW disconnect ERROR+stderr; 05 LOW T-47 caps unwired; 06 INFO reader bounds; 07 INFO replay/resume route conditions.

**Round 2**, 2026-11-21, delta `dc64193f..3b56ab54` (part 044-A after D-ARCH-217 split), appended as round 2 + D-SECPR044-02, commit `ef446899` on main (parent `43c010d1`, not pushed). Closed: 01, 02, 03, 06, R1-n2; D-ARCH-220 (error frame has no id) holds. Open: 04 -> part 044-B (D-ARCH-221 rule (p)), 05/07 on TASK-141/173 cards (D-SD-012). New INFO 08 (pointer carries name-like ancestor key text; party key holding array passes; comment's Cyrillic-e example actually refused because normalise drops non-ASCII -> `mail`), INFO 09 (replay loop outside try: throwing element accessor rejects hook, 30 s cap later reports max_duration). Both F6/F7 owner 044-B, due before TASK-141 merges.

**QG-044-C3 concurrence given** on D-ARCH-218 (two slot Cache-Control constants), -219 (31 s stream deadline only with drain signal; drain ends streams with error <=1 s; accepted reading of my "below 25 s" condition), -221 (no ERROR line on disconnect; after headers problem handler logs+destroys, no next()), -223 (1 MiB unsent-bytes cut). G1 conditions for the 044-B security round: proofs (a)-(i) + QG-044-C4 deadline proof, `api.stream_cut` no value/cause; proofs (e)/(f); proof (g) env=production incl. hook rejecting after headers; T-47 slot TTL >= 31 s + margin and release before drain closes Valkey; I update T-47 and AC-46 threat-model cells (amendment 14 item 5) at the latest in that round.

**Merge conditions:** C3 lane B green on `3b56ab54` (12 tests in event-stream.api.test.ts); C4 whichever of PR #80 (`0f0d92a0`, with 040-B PR1 `a4aadd2e` stacked) and this PR merges second: union + R1-m4 unused `appError` lint edit + security merge-only round (sim C6 voids binding via problem-handler.ts).

**Kit (session scratch `t044sec-r2/`, rebuilt from scratch; r1 kit lost with its session):** `x/` + `xo/` extracts with node_modules junctions (`MSYS_NO_PATHCONV=1 cmd /c mklink /J`); probes `r2-regex.mjs <head> <old>`, `r2-wire.mjs <root>` (sseStream + recording sink), `r2-app.mjs <root> <label>` (real createApp, installProcessErrorHandlers with recording exit, stdout/console.error capture), `r2-reader.mjs`, `r2-mutants.mjs` (15 mutants, cwd=extract), `r2-secrets.mjs` (gitleaks not installed: pattern+entropy scan), `r2-binding.sh <repo> <sim> <record>` (sparse clone: sparse-checkout patterns need MSYS_NO_PATHCONV=1 or they become `C:/Program Files/Git/...`). Jest unit subset runs fine on an extract: `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects unit --coverage=false <paths>`.

**How to apply:** a push after `3b56ab54` touching owned paths voids round 2; the 044-B round must check G1 and do the threat-model cells; orchestrator renames the record once the PR exists.

Related: [[project-p5-pr44-r2]], [[project-p5-task041]], [[project-p5-task040]], [[project-security-review-conventions]]
