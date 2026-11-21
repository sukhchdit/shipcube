---
name: project-p5-task043-outbox
description: TASK-043 outbox security rounds 1-3 (PR-pending record, D-SECPR043-01..03); Joi walk bypass facts, tripwire gaps, binding sim kit, TASK-049/047 checks
metadata:
  type: project
---

TASK-043 (transactional outbox) record `docs/05-quality/security/PR-pending-TASK-043-security-review.md`: R1 @da996002, R2 @93f9faa0, R3 @3ba1eb53 (commit 298cea31 on main, 2026-11-21), all PASS_WITH_FOLLOW-UPS. IDs are `PR043-SEC-nn` (not PR #43's `PR43-SEC-nn`).

Open after R3: SEC-09 LOW (pattern anchoring: no ^/$, top-level |, m flag) + SEC-10 INFO (raw() under node-level prefs({convert:true}); Joi.extend rules/hooks) = TASK-049 merge prerequisites (replace SEC-08); SEC-11 INFO tripwire spellings (comment before literal, `packages/config/src/testing` which ships unpruned, `@platform/api/modules/*/tests`, \u escapes, backslash separators) on the lint-twin card; SEC-05 org_id INSERT + SEC-07 → TASK-047; SEC-06 R-ARCH-38; my C4-3 T-83 threat-model row before G3.

**Why:** the closed-schema walk is a deny-list over `describe()`; each round found a new class. Allow-lists (flags, preferences) + `Joi.build(describe())` (drops extension hooks, refuses unknown rules) were validated as the robust fix.

**How to apply:**
- Joi facts: `pattern` = `regex.test` (no anchoring); a node's own `prefs()` overrides the validator's root `convert:false`; `raw()` returns the pre-coerce input; V8 `new Date()` ignores parenthesised text; `.messages()` is a preference.
- Before writing a delta round, re-check main for a newer code-review round (R4 landed mid-round here and added R4-C2 asking me to confirm carry-over).
- Binding sim: `git clone --shared --no-checkout`, plumbing commits with a temp `GIT_INDEX_FILE`, `git archive <head> docs/05-quality/security .github/CODEOWNERS | tar -x` into the clone, checker `--root` the clone. Checker reports the FIRST satisfying Head row (older round), so add a "this round alone" scenario.
- Long markdown appends: bash heredoc failed on the record text ("unexpected EOF"); write to scratch with Write, then `cat >>`, then `cmp` with the simulated file.
- At TASK-049: check SEC-09/10 fixed and CODEOWNERS covers `/packages/shared/src/events/`. At TASK-047: lint twin names SEC-11 (a)-(d); SEC-05/07.

Related: [[project-security-review-conventions]], [[project-p5-pr34-r2-harness]] (junction cleanup).
