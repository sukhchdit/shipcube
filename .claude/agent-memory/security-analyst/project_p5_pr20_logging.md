---
name: project-p5-pr20-logging
description: PR #20 (TASK-010 redacted Pino logging) R1 dae1f96, R2 9647907, R3 fafa3b5 (PR #21 union + fc2) all PASS_WITH_FOLLOW-UPS; R3 new LOW 18 (quadratic re-scan, 1-line fix) and 19 ({name,value} records), INFO 20-22; checks owed at TASK-052/055/113/020/022/214
metadata:
  type: project
---

The PR #20 review (TASK-010) is in `docs/05-quality/security/PR-0020-TASK-010-security-review.md`.

**Rounds:**
- **R1** at `dae1f96`: PASS_WITH_FOLLOW-UPS (01 MEDIUM, 02–07 LOW, 08–12 INFO).
- **R2** at `9647907` (fix cycle 1): PASS_WITH_FOLLOW-UPS. 01 closed. New: 13 LOW (free-text raw lists, bare `__Host-` pairs, scheme-less queries), 14–17 INFO.
- **R3** at `fafa3b5` (2026-11-13): merge-only + delta round on the PR #21 union (`3153b3e` = merge of main `9d188fd`) and fix cycle 2. **PASS_WITH_FOLLOW-UPS.** Appended as `## Round 3 (head fafa3b5)`; written to the main checkout, uncommitted.
  - Lane A run 43384035437: fast-lane green; gitleaks 19 commits clean; Semgrep 0 over 227 files. Only the record step was red (24 owned paths).
  - All 8 §R2.7 items met. The merge differs from `git merge-tree` (`d2b162c`) in exactly 8 non-owned files.
  - **Closed:** 13 items 1–3 (item 4 → TASK-020), 16, the R2-m2 part of 14, PR21-SEC-07 (b) (option 1, nothing weakened).
  - The simulated checker passed with base `a7bb07f` and with `9d188fd`. Controls B/C/D gave `missing`. E (a non-owned fix), F (a `docs/**` evidence commit) and G (a merge of main) gave `pass`.

**New in R3:**
- **18 (LOW).** `redactQuotedLists` re-scans: when `startsPair` is true it does `continue` without advancing `lastIndex`. This is quadratic for N units of `"pin",\'` closed by one escaped quote and a colon at the end: 26–38 ms per 8 KiB string, 143 ms per call.
  - Fix: `if (startsPair(text, end)) { pattern.lastIndex = end; continue; }` (probe-verified linear; corpus unchanged).
  - Due: in PR #20 if a further cycle runs, otherwise before TASK-052/055.
- **19 (LOW).** `{name|key, value}` records (HAR-style header arrays, `Set-Cookie`/tough-cookie records, SDK `{Name, Value}`) leak credentials. `name` is PII-exact, `value` is neutral.
  - Fix: a `walkObject` pair rule.
  - Due: before TASK-113 or TASK-055.
- **INFO:**
  - 20: lint two-hop via test-category files (`TEST_FILES` exempt; = code R3-n4 a) → TASK-020/022;
  - 21: the logger event argument is not redacted (only escaped, cut to 128) → TASK-020 lint (literal identifier) plus an optional runtime guard;
  - 22: free-text residuals (`util.inspect(new URL)` searchParams, target leads, backtick-quoted values, `query:{...}`, `String(rawHeaders)`) → widen 13 item 4 to flag `util.inspect`/`JSON.stringify`/`String()`/template literals in logger args (TASK-020); runtime extras → TASK-113.
- Code review r3 (`840e39a`) said "every new regex linear, worst 4.3 ms". Its families missed the closer-at-end shape, and so did the developer's tests (absolute < 50 ms threshold).

**Facts (probe-confirmed 2026-11-13, re-verify after changes):**
- Q1 has 0 leaks in all 29 request forms at `fafa3b5`.
- `exitAfterFlush`: exit 1 with identifier-only fatal lines. Two same-phase timer throws give 2 fatal lines.
- Lane-B evidence lives in `docs/05-quality/tests/runs/<stamp>_<sha7>/` (`docs/**`, not owned), so an evidence commit after a record keeps the record valid.
- PR #28 merged at 07:37 UTC (`f56b12f`, owned `tools/quality/**`). A main merge into PR #20 does not overlap its owned paths.

**Why:** the logger is the last control for the "secrets/PII in logs = 0" guardrail, and its residuals close only if the owning tasks check them.

**How to apply:**
- **If PR #20 gets another cycle:** check the 18 one-liner (scaling test, not an absolute time) and the 19 walker rule.
- **TASK-052/055:**
  - check 18 (if not fixed in PR #20) and 19;
  - the §R2.8 emitter conditions apply.
- **TASK-113:** 14 remainder, 15, 19, the 22 runtime extras, R2-n1 (a)/R3-n3, and the 21 optional guard.
- **TASK-020:**
  - 13 item 4 widened per 22;
  - the 21 literal-event rule;
  - the 20 policy (non-test code never imports the test category);
  - Joi messages.
- **TASK-214:** 17.
- **TASK-022:** the bundle scan proves there is no `pino` in the web/admin bundles (the backstop for 20).

Probe kit (scratch, persists): `scratchpad/review/PR-20-sec-r3/scripts/`:
- `lint-probe3.mjs` (45 forms), `fixture-probe.mjs`, `probe-corpus3.mjs`, `probe-records.mjs`, `probe-cost3.mjs`, `probe-call3.mjs`, `probe-process3.mjs`, `excerpt-keys.mjs`, `keyclass-diff.mjs`, `record-sim3.sh`;
- plus the R2 kit (`build.mjs`, `probe-req.mjs`, `probe-corpus.mjs`, `probe-sec.mjs`, `probe-cost.mjs`).

`build.mjs <root>` needs `<root>/src` from `git archive` and a `build/node_modules` junction to main's.

Related: [[project-p5-pr21-openapi-pipeline]], [[project-p5-pr10-ci-lane]], [[project-p5-pr23-lane-b]], [[project-p5-pr9-runtime-skeleton]], [[project-p3-security-conditions]], [[project-security-review-conventions]]
