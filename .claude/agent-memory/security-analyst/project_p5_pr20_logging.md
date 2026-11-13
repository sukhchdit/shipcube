---
name: project-p5-pr20-logging
description: PR #20 (TASK-010 redacted Pino logging) R1 dae1f96, R2 9647907, R3 fafa3b5, R4 3f585b7 (merge+delta, fix cycle 3) all PASS_WITH_FOLLOW-UPS; 18/19 closed in R4, new INFO 23 (record shapes beyond name/key) + 22(f); owners TASK-113/022/214, PR #32 carries 13 item 4
metadata:
  type: project
---

The PR #20 review (TASK-010) is in `docs/05-quality/security/PR-0020-TASK-010-security-review.md` (rounds 1 to 4 appended; R4 written to the main checkout, uncommitted, 2026-11-13).

**Rounds:**
- **R1** `dae1f96`: PASS_WITH_FOLLOW-UPS (01 MEDIUM, 02-07 LOW, 08-12 INFO). **R2** `9647907`: 01 closed; new 13 LOW, 14-17 INFO. **R3** `fafa3b5`: 13 items 1-3, 16, R2-m2 part of 14 closed; new 18 LOW (quadratic re-scan), 19 LOW (`{name,value}` records), INFO 20-22.
- **R4** `3f585b7` (merge + delta, fix cycle 3 of 3, lane A run 43427180301, lane-B run `20261113T1231Z_5e6ccb7` accepted): **PASS_WITH_FOLLOW-UPS**, nothing blocks.
  - **Closed:** 18 (closer-at-end family 7,700 ms at 128k uncapped to 1.5 ms; whole log call 183 to 7.3 ms), 19 (27 of 27 record shapes hidden, 15 of 18 live-request forms clean), PR30-SEC-11 (child process: one `fatal` StorageConfigError line, exit 1, no value), PR24 R2.5 steps 2-5 (squat and mutation events through the sink at `error`, only allow-listed attributes, written at any `APP_LOG_LEVEL`), R3-n1, R3-n5.
  - **Union proof:** `git merge-tree fafa3b5 e3c07d8` (`aae4494`, 8 conflict files); `b133c83` differs in exactly 15 paths (8 conflicts + 7 declared hand merges). `eslint.config.mjs` byte-identical to the auto-merge; `tools/tsconfig.json` = main + 1 line; lock = main + the single `pino` leaf (deep JSON diff; `npm ci` ran in lane A). Server-only policies still last (`eslint.config.mjs:421/422/426`; mutation: dropping the third flips the 3 shared-root fixtures). 161 main fixtures lint identically under the head config.
  - **New:** PR20-SEC-23 INFO (record shapes outside `name|key` + `value`: `{header,value}`, `{field,value}`, `{k,v}`, `{headerName,headerValue}`, CFN `ParameterKey/ParameterValue`, `{name,content|data|values}`, nested name) → TASK-113 (= code review R4-n1). PR20-SEC-22 form (f): `JSON.stringify`/`util.inspect` of record arrays leak (2 of 18 forms) → TASK-113 (PR #32's lint rules only cover stringifiers on raw request names).
  - **Accepted, no finding:** the SEC-18 `lastIndex` skip loses redaction for 128 of 300,000 strings of a deliberately confusing quoting grammar (object-key item whose own text holds a sensitive name, comma and quote); 0 differences over 200,000 broad strings and 7 natural renderings. Bare `key` feature flags stay readable (`{key:'new_checkout',value}`); a flag name holding a sensitive word is hidden with its value (fail closed).
  - **Rulings:** code review r4 (`0753441`, APPROVED_WITH_NITS) R4-m1 (ratio limit 20 vs 40: not in this PR, a non-docs commit stales the lane-B run), R4-n2 (shutdown `exit(0)` can win over fatal `exit(1)` for one tick): no security action.
  - **Simulated record check** (22 scenarios, main's `check-security-owned-paths` plus `check-evidence`): pass with bases `c2ddfac` and the main tip; owned edits (5 kinds) and a main merge that overlaps an owned path (eslint.config.mjs, tools/tsconfig.json) give `missing`; a non-owned code fix passes the record step but stales lane B; docs-only evidence commit and a docs-only main merge pass.

**Open after R4 (owners):** 13 item 4 (LOW, carried by PR #32 `no-raw-request-in-log`/`no-catch-message-interpolation`, PR32-SEC-08); 14 remainder, 15 (TASK-113); 17 (TASK-214); 20 (boundaries policy, TASK-022 bundle scan); 21 (TASK-113 literal-event rule + optional runtime guard); 22 (TASK-113, 113/214 for R2-n1 (a)); 23 (TASK-113).

**Facts (probe-confirmed 2026-11-13, re-verify after changes):**
- `exitAfterFlush`: exit 1 with identifier-only fatal lines; handlers are installed above `createRuntimeServices` in both `main.ts` (api 25-29, worker 26-30). Process lives until the stdout write callback or a 1,000 ms timer after an uncaught exception (accepted since R3).
- Squat events: name is bound by the catalogue regex `^audit_entries_[0-9]{4}_[0-9]{2}$`, `kind` is a relkind or `type`, `reason` an enum; emitted once per object; `component` dropped.
- Lane-B evidence lives in `docs/05-quality/tests/runs/<stamp>_<sha7>/` (`docs/**`, not owned), so an evidence commit after a record keeps the record valid; a merge of a docs-only main keeps both record and evidence valid.
- The 24 owned paths: `eslint.config.mjs`, `package-lock.json`, `tools/tsconfig.json`, `tools/lint/negative-fixtures.test.ts`, 20 fixtures under `tests/fixtures/lint/layering/shared-logging-server-only/`.

**Why:** the logger is the last control for the "secrets/PII in logs = 0" guardrail, and its residuals close only if the owning tasks check them.

**How to apply:**
- **PR #32 round 2 (second merger):** server-only policies still last, `routePrefix(API_PREFIX)` first layer of `api`, both handlers above `createRuntimeServices`, PR20-SEC-13 item 4 rules keep their fixtures. PR #20 merges first (D-ORCH-044), so this record does not cover PR #32; it needs its own round-2 record.
- **TASK-113:** 14 remainder, 15, 21, 22 (incl. (f) and the runtime extras), 23, R2-n1 (a)/R3-n3; if this pass is ever rewritten as a tokenizer, include the SEC-18 differential family.
- **TASK-022:** the bundle scan proves there is no `pino` in the web/admin bundles (backstop for 20). **TASK-214:** 17. **TASK-052/055:** the §R2.8 emitter conditions (no request-controlled free text in logger args).

Probe kit (scratch, session-scoped, may be wiped): `scratchpad/review/PR-20-sec-r4/scripts/` (`p18-cost.mjs`, `p18-fuzz*.mjs`, `p18-shrink.mjs`, `p19-records.mjs`, `p-live.mjs`, `p-events*.mjs`, `p30-child.mjs`/`p30-parent.mjs`, `record-sim4.mjs`, `lockdiff.mjs`, `lockcheck.mjs`, `hostscan.mjs`, `hooks.mjs`). Extracts for head/base/main and the sim clone were removed after the round.

Related: [[project-p5-pr21-openapi-pipeline]], [[project-p5-pr10-ci-lane]], [[project-p5-pr23-lane-b]], [[project-p5-pr9-runtime-skeleton]], [[project-p5-pr30-s3-adapter]], [[project-p5-pr32-route-pipeline]], [[project-p3-security-conditions]], [[project-security-review-conventions]]
