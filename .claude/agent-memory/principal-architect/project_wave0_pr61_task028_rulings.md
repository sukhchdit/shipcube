---
name: project-wave0-pr61-task028-rulings
description: D-ARCH-148..150 (PR #61 / TASK-028) — vault token columns INT, unattributed data subject per UTC month with 12-month retention, registry home in packages/shared and the Pino link as a coverage test; lessons on where a claim is repeated across docs
metadata:
  type: project
---

PR #61 (TASK-028) rulings, 2026-11-17, commit `e85a5bc`; ADR-0007 amendment 13; data-model A29.

- **D-ARCH-148:** `audit_entries.ip_token` / `user_agent_token` / `reason_token` are `INT (token)`. "PER (token)" in data-model §3.4 was a note, not a class. C10 unchanged.
- **D-ARCH-149:** list-filter values of an authenticated request belong to the actor's subject. A value without a known person belongs to the unattributed subject of its UTC month: `kind 'USER'`, `ref_id` = ANONYMOUS actor id with the 48-bit UUIDv7 timestamp set to the month start (2026-11 = `01a19467-e800-7000-8000-000000000002`). Erased 12 months after the month ends by the EPIC-B-413 (M4) retention job; G4 precondition for production. "No revival" of an erased subject and erasure by value sit with the same epic; `API_KEY` actors with EPIC-B-303.
- **D-ARCH-150:** the registry stays in `packages/shared/src/classification`. "Feeds the Pino redaction list" is a build-time coverage test (`log-coverage.test.ts`), not a run-time list.

**Why:** the vault's unique key `(subject_id, entity_name, field, value_hmac)` forces token reuse, so under one permanent subject a row's age is the first sighting of a value and age-based retention cannot work. The log redaction lives in `packages/shared/src/logging` and `@platform/audit` depends on `@platform/shared`. Column names are unique per table but log keys are global (`description`, `label`, `city`, `time_zone` are PERSONAL columns).

**How to apply:**
- A later table task whose PERSONAL column fails the coverage test adds a matcher key or a reasoned exception; do not rule a run-time union.
- When the M4 privacy epic is planned, start from ADR-0007 amendment 13 items 5–6 (retention job, no revival, by-value erasure, index-key destruction).
- Before amending one ADR sentence, grep the other documents for the same claim: the Pino link was also stated in ADR-0017 §1, nfr-strategy PRIV-001/003 and nfr-traceability NT-PRIV-001-c.
- Two orchestrator sessions shared the checkout that day (D-ORCH-COORD-01): HEAD moved twice during the task and my push carried their unpushed commit. Re-check `git log -1` and `git status -s docs/sdlc` right before the append, as in [[project-wave0-sheet-fold9-rulings]].
