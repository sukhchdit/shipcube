---
name: project-p5-task043
description: TASK-043 outbox writer/relay/purge security round 1 (record on main feb00326, head da996002) - findings PR043-SEC-01..07, QG-043-C3/C4 answers, conditions and probe facts
metadata:
  type: project
---

TASK-043 round 1 = PASS_WITH_FOLLOW-UPS at code head `da996002` (dispatched `c60959bd`; the delta touched apps/worker only, so either binds). Record `docs/05-quality/security/PR-pending-TASK-043-security-review.md` + D-SECPR043-01, commit `feb00326` on main (2026-11-20).

- **IDs:** `PR043-SEC-nn` (3-digit task number), NOT PR #43's `PR43-SEC-nn` (TASK-024).
- **Findings:**
  - 01 LOW: `isClosedObjectSchema` is shallow. `Joi.object()` with no keys, `.keys()`, `.pattern`, nested open objects, `any`, `alternatives`, `array`, free `Joi.string()` all pass. The fix walk was validated, with STRING_RULES pattern/guid/isoDate/base64.
  - 02 LOW: `createOutbox` is reachable by a deep `writer.ts` import or the test seam from any api file. The worker is blocked by boundaries.
  - 03 INFO: `./testing/outbox` is not in the preflight `SKIPPED_EXPORTS` (exact `./testing`). That breaks `tools/docker/image-exports.test.ts` and the worker image build.
  - 04 LOW: a foreign holder of the relay advisory lock leaves the lag gauge at 0 and the last-tick time fresh, so both alarms stay silent. Fix: `tickEnded` only when locked.
  - 05 LOW: full-row UPDATE on `outbox_events` while `org_id` becomes authoritative for `job_context` (TASK-047). Fix: a column grant.
  - 06 LOW: DELETE on the dedupe ledgers has no horizon at the database; also RB-06 replays near day 30.
  - 07 INFO: SYSTEM contexts share the `anonymous` admission key.
- **QG-043-C4 concurred** with conditions:
  - C4-1: no second producer call site before TASK-047's lint names it.
  - C4-2: SEC-04 is settled before TASK-214's alarms.
  - C4-3: I owe the threat-model T-83 row before G3; the text is in the record §3.
- **QG-043-C3 confirmed** (ADR-0004 am. 3 item 21), with T078-1..5. Key point: the overwrite's only predicate is the id, and its SET clauses are row-relative (`version = version + 1`, `payload - 'token_enc'`). Otherwise the READ COMMITTED re-check after waiting on the tick, or a retry, updates 0 rows.

**Round 2** = PASS_WITH_FOLLOW-UPS at `93f9faa0` (commit `86ec0678`, D-SECPR043-02).
- **Merges.** Both merges were pure, negative-fixtures included.
- **Closed:** 01, 03, 04, and 05's UPDATE and actor arms (column grant plus `ck_outbox_events__actor`).
- **Open with owners:**
  - 05 `org_id` arm: TASK-047 (D-ARCH-197).
  - 06: accepted residual R-ARCH-38 until the definer-purge late task (D-ARCH-198).
  - 07: TASK-047 (D-ARCH-199).
- **New:** 08 INFO. My own walk missed `whens`, `ordered`, `custom`, inverted patterns and default functions. Code review R3-m1 widened it (pattern probe set, `base64` only on `*_enc` keys). It is due as a TASK-049 merge prerequisite.
- **R3-m2 reopened 02's tripwire arm.** The seam moved into `routing/tests/timing.ts`. Fix with the general "resolves into tests/" rule: recommended in fix cycle 3, required before TASK-049.
- **Lessons:**
  - When I propose a validation walk, probe Joi's `whens`/`ordered`/`custom`/`default` too.
  - When a fix moves a seam, re-check the tripwire against its new home.

**Why:** the next rounds will be a merge-only round, and maybe a delta round. Main changed the owned `tools/lint/negative-fixtures.test.ts`, and the branch must merge main because of a DECISIONS.md conflict; the sim confirmed this voids the binding.

**How to apply:**
- On the merge-only round, check the negative-fixtures union and whether fixes for 01/02/03/05 touched owned paths.
- At TASK-047, check C4-1, 05 and 07.
- At TASK-078, check T078-1..5.
- At TASK-214, check C4-2.
- Lint probes need a `node_modules` tree with `@platform/*` junctioned to the extract (`probes/mknm.mjs` pattern). Otherwise the resolved-file boundaries arms miss.

Related: [[project-p5-task039]], [[project-p5-pr64-task035]], [[project-security-review-conventions]]
