---
name: project-p5-pr20-logging
description: PR #20 (TASK-010 redacted Pino logging) R1 @dae1f96 + R2 @9647907 PASS_WITH_FOLLOW-UPS; 01 MEDIUM closed; new LOW 13 (free-text raw lists/__Host- pairs/path queries), INFO 14-17; PR #21 merged first, so the union needs a merge-only round; checks owed at TASK-052/113/020/014/214/022
metadata:
  type: project
---

The PR #20 review (TASK-010) is in `docs/05-quality/security/PR-0020-TASK-010-security-review.md`.

**Rounds:**
- **R1** at `dae1f96`: PASS_WITH_FOLLOW-UPS (01 MEDIUM, 02–07 LOW, 08–12 INFO).
- **R2** at `9647907` (fix cycle 1, 2026-11-13): **PASS_WITH_FOLLOW-UPS**, appended as `## Round 2 (head 9647907)`.
  - Lane A run 43353973952: fast-lane green; gitleaks found 14 commits clean; Semgrep 0 findings over 209 files.
  - 18 owned paths: eslint, lock, `tools/tsconfig.json`, `negative-fixtures.test.ts`, and 14 shared-logging fixtures.
  - The simulated checker passed against main `c3ff7f1` and against base `6ac9836`.

**R2 status of the R1 findings:**
- **Closed:** 01 (the MEDIUM), 05, 06, 08, 09, 11.
- **Closed for TASK-010's part:** 02, 03 (scheme URLs), 04 items 1 and 3, 07 (cost), 10 (correlation ID), 12.
- **Routed:**
  - 04 item 2 → TASK-014;
  - the 10 template → TASK-113;
  - Joi messages → TASK-020 (D-ORCH-025).
- **SEC-P3-23** (TASK-010 part) is closed.

**New in R2:**
- **13 (LOW).** Free-text renderings keep credential and query values:
  - `JSON.stringify` / `util.inspect` / `String` of `req.rawHeaders` or `req` (name and value are comma-adjacent, so the pair rule misses them);
  - a bare `__Host-rt_x=v` pair under a neutral key;
  - scheme-less `/x?q=` targets.

  Fixes:
  1. the `__Host-`/`__Secure-` key prefix counts as sensitive;
  2. a quoted-list adjacency pass;
  3. strip `/path?query`;
  4. a TASK-020 lint/Semgrep rule against stringifying `req` in log calls.

  Items 1–3 are due before TASK-052/055 merge (first refresh cookie).
- **INFO:**
  - 14: PII-class gaps (`clientIp`, `x-forwarded-for`, `username`, `iban`/`accountNumber`, the card parent through arrays, PII pairs in arrays) → TASK-113 and TASK-135/139/140/188;
  - 15: the brand can be forged by a Proxy `getOwnPropertyDescriptor` trap (fix: `types.isProxy`) → TASK-113;
  - 16: transitive path around the guard (a non-logging `packages/shared` file imports logging, then the root re-exports it) → TASK-020/022;
  - 17: line size covers fields only (`err` and each `child()` binding set add 16 KiB budgets; 48/88 KiB lines) → TASK-214.

**PR #21 merged first** (`62e4961`, D-ORCH-027). PR #20 must merge main, which conflicts only in `app.ts`, `main.ts` and `request-context.ts`, and auto-merges the owned `eslint.config.mjs` and `negative-fixtures.test.ts`. That voids R2 under rule (d), so a **merge-only round is required**. Its 8-item check list is §R2.7 of the record. It includes:
- PR21-SEC-07 (b): the contract-validator excerpt list switches to `isSensitiveKey`, or is re-routed to TASK-020;
- `installProcessErrorHandlers` stays before the services;
- `routePrefix` becomes the first layer of `api`.

Q7 (the lint probe) on the union config gave the same result as on the head.

**Facts (probe-confirmed 2026-11-13, R2; re-verify after changes):**
- **Walker:** `instanceof EventEmitter` → `[Unsupported]` (req, res, sockets). `{...req}` is safe because `rawHeaders`, `_parsedUrl` and `*url` keys are omitted. `Headers`, `Request`, `URLSearchParams` and `FormData` walk to `{}`.
- **Regexes:** every string-redaction regex is linear to 128k. `redactString` takes at most 4.8 ms at the 8 KiB cap, and a whole call at most 9 ms.
- **Stack accessor:** the V8 `stack` accessor is the same function for `captureStackTrace` objects. Cross-realm errors are logged without a stack.
- **Process errors:** an ESM top-level throw reaches `uncaughtException` with origin `unhandledRejection`.
- **Over-redaction in security attributes:** a lower-case value with a keyword (`bad_password`) becomes `[REDACTED]`. Emitters must use UPPER_SNAKE reason codes (record §R2.8).
- **Correlation ID:** `CORRELATION_ID_PATTERN` now lives in `@platform/shared` (root).

**Why:** the logger is the last control for the "secrets/PII in logs = 0" guardrail, and its residuals close only if the owning tasks check them.

**How to apply:**
- **Merge-only round:** use record §R2.7 as the checklist. Re-run the lock delta (one path: `packages/shared` declares pino) and the Q7 lint probe on the union commit.
- **TASK-052/055:** PR20-SEC-13 items 1–3 must be merged; the emitter conditions in §R2.8 apply.
- **TASK-113:** 14 and 15, plus the PR6 client halves and the route template.
- **TASK-020:** the 13 item 4 rule, 16, and Joi messages.
- **TASK-214:** 17.
- **TASK-022:** the bundle scan proves there is no `pino` in the web and admin bundles.

The probe kit (scratch, session-scoped) is in `scratchpad/review/PR-20-sec-r2/scripts/`:
- `build.mjs` (strips `packages/shared/src` fully and rewrites `@platform/shared` too);
- `probe-req.mjs`, `probe-corpus.mjs`, `probe-sec.mjs`, `probe-cost.mjs`, `probe-process.mjs`;
- `lint-probe.mjs` (22 bypass forms);
- `lockdiff.mjs`, `record-sim.sh`.

Related: [[project-p5-pr21-openapi-pipeline]], [[project-p5-pr10-ci-lane]], [[project-p5-pr9-runtime-skeleton]], [[project-p5-pr11-rls-review]], [[project-p3-security-conditions]], [[project-security-review-conventions]]
