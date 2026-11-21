---
name: project-p5-pr63-task036
description: PR #63 (TASK-036 error catalogue, 79 codes, contract-wide assertion 6, client error keys) security r1 @fcdb7ac PASS_W_F-U; record + D-SEC-PR63-01 committed on MAIN (a70dc64), not the branch; LOW 01 free-text 4xx detail on indistinguishability codes; INFO 02-04; merge-ref record facts
metadata:
  type: project
---

Round 1, 2026-11-18, static only (D-ORCH-131 host rule). Record `docs/05-quality/security/PR-0063-TASK-036-security-review.md` and D-SEC-PR63-01 were committed **on main** (`a70dc64`). The PR worktree `Shipqube-TASK-036` was reserved for the lane-B queue and had to stay untouched.

**Why main works:** ci-gate checks out `refs/remotes/pull/N/merge`, and the checker reads records from that work tree. So a record on main counts from the next `pull_request` event (for example the evidence push). A re-run of an old lane-A run does NOT pick it up, because it reuses the old merge SHA. This was simulated with S1 and S3 passing and C0 to C5 failing.

**Findings:**
- **01 LOW (CWE-204/209):** the 4xx `detail` is free text (`app-error.ts:60` → `problem.ts:47`).
  - Nothing pins it for NOT_FOUND, INVALID_CREDENTIALS, TOKEN_INVALID, TRACKING_NOT_FOUND, COUPON_INVALID, ACCOUNT_DELAYED/LOCKED and AUTHZ_DENIED.
  - Fix: a `uniformDetail` catalogue flag that `buildProblem` and `AppError` honour, plus a literal-only `detail` lint rule or a scan arm.
  - Due: fix cycle, else before TASK-052. Latent: 0 of 20 production AppErrors pass a detail.
- **02 INFO:** `classifyDbError` accepts any catalogue code with a matching status (13 → 79 codes). Restrict it to `DB_PROBLEM_CODES` (not exported from `db/index.ts` yet).
- **03 INFO:** the MFA gate stub (`platform/mfa/mfa-gate.ts:17`) answers AUTHZ_DENIED, and its reason (MFA_ENROLMENT_REQUIRED not catalogued) is gone → TASK-067. The RLS write rejection is a second non-gate AUTHZ_DENIED producer.
- **04 INFO:** conditions on whichever of TASK-040/041/061/096/103 first widens the problem handler:
  - extension members (`mfa_challenge_token` is a one-time secret) on a closed per-code list;
  - `Retry-After` on the 429 codes and on IDEMPOTENCY_IN_PROGRESS (today only on a 503, `classify.ts:71-75`).

**Code twin** `0f3528e`, APPROVED_WITH_NITS: R1-m1 README §11 arm, R1-m2 scan blind to domain error classes (PR #65 `OrganisationRuleError` with `MEMBERSHIP_STATUS_NOT_WRITABLE`), R1-n1 orphaned JSDoc in `define-route.ts`, and §4 item 3 (the shared root must not re-export `./queues`, PR #64).

**How to apply:**
- In the delta round or at the TASK-052 review, check that 01 is fixed, with a sentinel test through the real handler.
- At TASK-067, check that the gate answers MFA_ENROLMENT_REQUIRED.
- At TASK-040/041/061, check 04 items 1 to 3.

**Slip:** I ran one read-only `git -C <PR worktree> rev-parse HEAD`. It is disclosed in the hand-off.

Related: [[project-security-review-conventions]], [[project-p5-pr32-route-pipeline]], [[project-p5-pr61-task028]]
