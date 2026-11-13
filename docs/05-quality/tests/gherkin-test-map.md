# Gherkin → planned test ID map (Must stories)

Version 1.1 · 2026-11-14 · owner qa-lead · generated from `docs/01-requirements/stories/EPIC-*.md` (story files v1.3) by qa-lead in P4. Companion to [TEST-STRATEGY.md](../TEST-STRATEGY.md) §6 (test IDs) and §7 (suite catalogue).

**How to read.**

- **Test ID** `AT-<story>-<nn>`: `nn` is the 1-based position of the scenario in the story's Gherkin block (Scenario and Scenario Outline both count). Every automated test that verifies the scenario carries the ID in its title in square brackets, e.g. `it('[AT-US-086-01] mutation is audited without feature code', …)`. A test may carry several IDs; a scenario may be verified by several tests (all must pass).
- **Scenario Outline** rows get one test per Examples row, ID suffix `-<row>` (e.g. `AT-US-131-01-1`); the outline ID is covered when every row passes.
- **Suite** is the primary suite (TEST-STRATEGY.md §7) where the test lives and whose JUnit file carries it. Permission scenarios in a story whose default suite is not RBAC-aware are verified in `rbac-matrix` (generated cells plus a named scenario test); cross-tenant ones in `abuse` or `rls-cross-tenant`; audit ones in `audit-generator`; UI-standard ones (locales, 360/1280, keyboard, axe, six states) in the Playwright suites.
- **Lane**: A = hosted PR fast lane; B = local heavy lane (`quality:heavy`); `B+A*` = lane B plus the hosted `security-integration` job when a security-critical path changes; opt-in = runs only with sandbox credentials (D-003).
- **G3** = counted in the AC-coverage denominator. `@live-sandbox` scenarios are COND-SANDBOX-DEMO (post-release condition, D-003) and excluded.
- **Stability of IDs.** If a story's Gherkin is edited, product-manager appends new scenarios at the end of the block; a removed scenario keeps its number as `(withdrawn)` in this map. qa-lead regenerates this file after any story change (`tools/quality/gen-gherkin-map.mjs`, Wave 0 task T-QA-02) and `quality:trace` fails on an ID present in tests but absent here, or on a G3 ID without a passing test at the gate.
- **Should/Could stories** use the same convention (`AT-US-xxx-nn`). They are verified when delivered but are not in the G3 Must-AC denominator.

## Summary

- Must stories: 218; Must scenarios: 1612 (1606 counted for G3 AC coverage, 6 `@live-sandbox`).
- Scenarios per primary suite:

| Suite | Scenarios | Lane |
|---|---|---|
| `e2e` | 241 | B |
| `api` | 204 | B |
| `integration` | 180 | B |
| `unit` | 131 | A |
| `audit-generator` | 122 | B+A* |
| `identity-session` | 107 | B |
| `rbac-matrix` | 79 | B+A* |
| `carrier-contract` | 53 | A |
| `jobs-resilience` | 42 | B |
| `carrier-resilience` | 42 | B |
| `abuse` | 35 | B |
| `payments-webhooks` | 33 | B |
| `saga-fault-matrix` | 32 | B |
| `e2e-a11y` | 30 | B |
| `rls-cross-tenant` | 29 | B+A* |
| `rate-limit` | 28 | B |
| `idempotency` | 25 | B |
| `config-guards` | 21 | A |
| `redaction` | 20 | B |
| `e2e-i18n` | 13 | B |
| `i18n-parity` | 12 | A |
| `sec-static` | 12 | A |
| `headers` | 11 | B |
| `pricing-properties` | 11 | A |
| `lint` | 10 | A |
| `ci-policy` | 9 | A |
| `audit-chain` | 9 | B |
| `audit-immutability` | 9 | B+A* |
| `secrets-keys` | 9 | B |
| `csrf-cookie` | 7 | B+A* |
| `ssrf` | 7 | B |
| `observability` | 6 | B |
| `contract-openapi` | 5 | A |
| `image-assertions` | 4 | B |
| `route-registry` | 4 | A |
| `catalog-c1-c14` | 4 | B+A* |
| `contract-live` | 4 | opt-in |
| `e2e-security` | 4 | B |
| `compose-up` | 3 | B |
| `resilience-deps` | 3 | B |
| `e2e-live` | 2 | opt-in |

| Epic | Must stories | Must scenarios |
|---|---|---|
| EPIC-01 | 12 | 60 |
| EPIC-02 | 17 | 142 |
| EPIC-03 | 19 | 106 |
| EPIC-04 | 13 | 88 |
| EPIC-05 | 17 | 130 |
| EPIC-06 | 18 | 153 |
| EPIC-07 | 13 | 79 |
| EPIC-08 | 11 | 99 |
| EPIC-09 | 18 | 132 |
| EPIC-10 | 18 | 129 |
| EPIC-11 | 7 | 53 |
| EPIC-12 | 6 | 45 |
| EPIC-13 | 9 | 72 |
| EPIC-14 | 4 | 41 |
| EPIC-15 | 11 | 86 |
| EPIC-16 | 14 | 107 |
| EPIC-17 | 11 | 90 |


## EPIC-01 ([stories/EPIC-01-platform-foundation.md](../../01-requirements/stories/EPIC-01-platform-foundation.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-001-01 | US-001 (DC) | Repository structure is complete | `lint` | A | yes |
| AT-US-001-02 | US-001 (DC) | Missing folder fails the structure test | `lint` | A | yes |
| AT-US-001-03 | US-001 (DC) | Each layering rule is enforced by a seeded negative fixture (outline: one test per Examples row, suffix -<row>) | `lint` | A | yes |
| AT-US-001-04 | US-001 (DC) | Root scripts fail on defects | `lint` | A | yes |
| AT-US-001-05 | US-001 (DC) | Unjustified any suppression is rejected | `lint` | A | yes |
| AT-US-002-01 | US-002 (DC) | Valid environment starts the process | `config-guards` | A | yes |
| AT-US-002-02 | US-002 (DC) | Invalid and missing keys are all listed, names only | `config-guards` | A | yes |
| AT-US-002-03 | US-002 (DC) | Bcrypt cost below the floor is rejected | `config-guards` | A | yes |
| AT-US-002-04 | US-002 (DC) | Worker and frontend builds use the same validation | `config-guards` | A | yes |
| AT-US-003-01 | US-003 (DC) | Cold start reaches healthy | `compose-up` | B | yes |
| AT-US-003-02 | US-003 (DC) | Second start is idempotent | `idempotency` | B | yes |
| AT-US-003-03 | US-003 (DC) | Reset returns to clean state | `compose-up` | B | yes |
| AT-US-003-04 | US-003 (DC) | A failing migration stops the stack visibly | `compose-up` | B | yes |
| AT-US-004-01 | US-004 (DC) | Images satisfy the hardening checks | `image-assertions` | B | yes |
| AT-US-004-02 | US-004 (DC) | A secret in a layer fails the build | `image-assertions` | B | yes |
| AT-US-004-03 | US-004 (DC) | Unpinned base image is rejected | `image-assertions` | B | yes |
| AT-US-004-04 | US-004 (DC) | Container health check reflects state | `image-assertions` | B | yes |
| AT-US-005-01 | US-005 | Green PR fast lane runs its stages in order | `ci-policy` | A | yes |
| AT-US-005-02 | US-005 | Full workflow runs every stage on main | `ci-policy` | A | yes |
| AT-US-005-03 | US-005 | Any failing stage fails the run | `ci-policy` | A | yes |
| AT-US-005-04 | US-005 | Images are published only from main or tags | `ci-policy` | A | yes |
| AT-US-005-05 | US-005 | No AWS deploy is possible from ci.yml | `ci-policy` | A | yes |
| AT-US-005-06 | US-005 | Integration tests use Testcontainers | `ci-policy` | A | yes |
| AT-US-006-01 | US-006 | Coverage at target passes | `ci-policy` | A | yes |
| AT-US-006-02 | US-006 | Below-threshold coverage fails the gate (outline: one test per Examples row, suffix -<row>) | `ci-policy` | A | yes |
| AT-US-006-03 | US-006 | Ledger gate is vacuous before M4 | `ci-policy` | A | yes |
| AT-US-007-01 | US-007 | Framework failures map to stable codes (outline: one test per Examples row, suffix -<row>) | `api` | B | yes |
| AT-US-007-02 | US-007 | 405 includes the Allow header | `api` | B | yes |
| AT-US-007-03 | US-007 | 5xx never leaks internals | `api` | B | yes |
| AT-US-007-04 | US-007 | Unauthenticated caller still receives problem+json | `rbac-matrix` | B+A* | yes |
| AT-US-007-05 | US-007 | Error response is not audited as a mutation | `audit-generator` | B+A* | yes |
| AT-US-008-01 | US-008 | Valid inbound correlation ID is echoed | `observability` | B | yes |
| AT-US-008-02 | US-008 | Invalid inbound value is replaced | `observability` | B | yes |
| AT-US-008-03 | US-008 | One ID is visible end to end for the M0 booking | `observability` | B | yes |
| AT-US-008-04 | US-008 | Redaction of sensitive keys | `observability` | B | yes |
| AT-US-008-05 | US-008 | Emails are masked and mandatory fields present | `observability` | B | yes |
| AT-US-008-06 | US-008 | Request logs omit bodies | `observability` | B | yes |
| AT-US-009-01 | US-009 (DC) | Transient failure is retried then succeeds | `jobs-resilience` | B | yes |
| AT-US-009-02 | US-009 (DC) | Exhausted retries go to the dead-letter queue | `jobs-resilience` | B | yes |
| AT-US-009-03 | US-009 (DC) | Non-retryable errors skip retries (outline: one test per Examples row, suffix -<row>) | `jobs-resilience` | B | yes |
| AT-US-009-04 | US-009 (DC) | Dead-letter data is redacted | `jobs-resilience` | B | yes |
| AT-US-009-05 | US-009 (DC) | Queue metrics are exposed | `jobs-resilience` | B | yes |
| AT-US-010-01 | US-010 (DC) | Duplicate mock-booking job produces one shipment | `jobs-resilience` | B | yes |
| AT-US-010-02 | US-010 (DC) | Job ID is deterministic | `jobs-resilience` | B | yes |
| AT-US-010-03 | US-010 (DC) | Payload without required context is rejected | `jobs-resilience` | B | yes |
| AT-US-010-04 | US-010 (DC) | Job without tenant context is dead-lettered at the worker | `jobs-resilience` | B | yes |
| AT-US-010-05 | US-010 (DC) | Scheduled job fires once with three workers | `jobs-resilience` | B | yes |
| AT-US-010-06 | US-010 (DC) | Re-registration at restart does not duplicate schedules | `jobs-resilience` | B | yes |
| AT-US-010-07 | US-010 (DC) | Cross-tenant job data is not accessible | `abuse` | B | yes |
| AT-US-011-01 | US-011 (DC) | Event is committed with the change | `integration` | B | yes |
| AT-US-011-02 | US-011 (DC) | Rolled-back change leaves no event | `integration` | B | yes |
| AT-US-011-03 | US-011 (DC) | Relay publishes in order per aggregate and marks after accept | `integration` | B | yes |
| AT-US-011-04 | US-011 (DC) | Crash between enqueue and mark creates a duplicate that is discarded | `integration` | B | yes |
| AT-US-011-05 | US-011 (DC) | Queue unavailable keeps events pending | `integration` | B | yes |
| AT-US-011-06 | US-011 (DC) | Relay latency metric | `integration` | B | yes |
| AT-US-012-01 | US-012 (DC) | Healthy stack | `resilience-deps` | B | yes |
| AT-US-012-02 | US-012 (DC) | A dependency outage makes readiness fail (outline: one test per Examples row, suffix -<row>) | `resilience-deps` | B | yes |
| AT-US-012-03 | US-012 (DC) | Slow dependency is bounded | `resilience-deps` | B | yes |
| AT-US-012-04 | US-012 (DC) | Audit status is degraded, not failing | `audit-generator` | B+A* | yes |
| AT-US-012-05 | US-012 (DC) | No sensitive content (unauthenticated caller allowed by design) | `rbac-matrix` | B+A* | yes |

## EPIC-02 ([stories/EPIC-02-identity-sessions.md](../../01-requirements/stories/EPIC-02-identity-sessions.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-015-01 | US-015 (DC) | Successful registration | `identity-session` | B | yes |
| AT-US-015-02 | US-015 (DC) | Existing email gives the identical response | `identity-session` | B | yes |
| AT-US-015-03 | US-015 (DC) | Password policy violations (outline: one test per Examples row, suffix -<row>) | `identity-session` | B | yes |
| AT-US-015-04 | US-015 (DC) | Long multibyte password is accepted and fully significant | `identity-session` | B | yes |
| AT-US-015-05 | US-015 (DC) | Other validation errors | `identity-session` | B | yes |
| AT-US-015-06 | US-015 (DC) | Rehash on login when cost is lower | `identity-session` | B | yes |
| AT-US-015-07 | US-015 (DC) | Registration is rate limited (anonymous endpoint, no permission needed) | `identity-session` | B | yes |
| AT-US-015-08 | US-015 (DC) | Audit of registration | `audit-generator` | B+A* | yes |
| AT-US-015-09 | US-015 (DC) | Sixth distinct address from one IP in an hour is a registration probe | `identity-session` | B | yes |
| AT-US-015-10 | US-015 (DC) | Fourth accepted registration for one address in an hour | `identity-session` | B | yes |
| AT-US-015-11 | US-015 (DC) | New and existing addresses are indistinguishable | `identity-session` | B | yes |
| AT-US-015-12 | US-015 (DC) | Email wording supports recovery | `identity-session` | B | yes |
| AT-US-016-01 | US-016 (DC) | Valid token verifies | `identity-session` | B | yes |
| AT-US-016-02 | US-016 (DC) | Expired token | `identity-session` | B | yes |
| AT-US-016-03 | US-016 (DC) | Used or unknown token (outline: one test per Examples row, suffix -<row>) | `identity-session` | B | yes |
| AT-US-016-04 | US-016 (DC) | Resend invalidates earlier tokens and is limited | `identity-session` | B | yes |
| AT-US-016-05 | US-016 (DC) | Resend for unauthenticated or unknown email gives no information | `identity-session` | B | yes |
| AT-US-016-06 | US-016 (DC) | Unverified user can sign in | `identity-session` | B | yes |
| AT-US-016-07 | US-016 (DC) | Verification revokes every other session (pre-hijack protection) | `identity-session` | B | yes |
| AT-US-016-08 | US-016 (DC) | Verification from a fresh browser revokes all sessions | `identity-session` | B | yes |
| AT-US-016-09 | US-016 (DC) | The verifying user's own session keeps working | `identity-session` | B | yes |
| AT-US-016-10 | US-016 (DC) | Verification email wording | `identity-session` | B | yes |
| AT-US-017-01 | US-017 (DC) | Successful sign-in | `identity-session` | B | yes |
| AT-US-017-02 | US-017 (DC) | Failures are indistinguishable (outline: one test per Examples row, suffix -<row>) | `identity-session` | B | yes |
| AT-US-017-03 | US-017 (DC) | Timing does not reveal account existence | `identity-session` | B | yes |
| AT-US-017-04 | US-017 (DC) | Failed login is audited | `audit-generator` | B+A* | yes |
| AT-US-017-05 | US-017 (DC) | Missing field | `identity-session` | B | yes |
| AT-US-017-06 | US-017 (DC) | Login endpoint is rate limited | `identity-session` | B | yes |
| AT-US-018-01 | US-018 (DC) | Cookie attributes | `identity-session` | B | yes |
| AT-US-018-02 | US-018 (DC) | Cookie is read only by the auth routes | `identity-session` | B | yes |
| AT-US-018-03 | US-018 (DC) | Refresh rotates the token | `identity-session` | B | yes |
| AT-US-018-04 | US-018 (DC) | Reuse of a rotated token revokes the family | `identity-session` | B | yes |
| AT-US-018-05 | US-018 (DC) | Absolute age cap | `identity-session` | B | yes |
| AT-US-018-06 | US-018 (DC) | Sliding expiry is clamped to the absolute cap | `identity-session` | B | yes |
| AT-US-018-07 | US-018 (DC) | Refresh never renews auth_time | `identity-session` | B | yes |
| AT-US-018-08 | US-018 (DC) | Refresh lifetime may not exceed the absolute cap | `identity-session` | B | yes |
| AT-US-018-09 | US-018 (DC) | Missing CSRF token or foreign origin | `identity-session` | B | yes |
| AT-US-018-10 | US-018 (DC) | Revoked family cannot be revived | `identity-session` | B | yes |
| AT-US-018-11 | US-018 (DC) | Permission path (no cookie) | `identity-session` | B | yes |
| AT-US-019-01 | US-019 | Logout revokes within 5 s | `identity-session` | B | yes |
| AT-US-019-02 | US-019 | Other triggers revoke too (outline: one test per Examples row, suffix -<row>) | `identity-session` | B | yes |
| AT-US-019-03 | US-019 | Logout without CSRF token | `identity-session` | B | yes |
| AT-US-019-04 | US-019 | Logout without session | `identity-session` | B | yes |
| AT-US-019-05 | US-019 | Redis TTL | `identity-session` | B | yes |
| AT-US-019-06 | US-019 | Revocation check on every authenticated request | `identity-session` | B | yes |
| AT-US-020-01 | US-020 (DC) | Token only in memory | `e2e` | B | yes |
| AT-US-020-02 | US-020 (DC) | Two tabs refresh at once | `e2e` | B | yes |
| AT-US-020-03 | US-020 (DC) | Expired access token is retried once | `e2e` | B | yes |
| AT-US-020-04 | US-020 (DC) | Revoked session redirects | `e2e` | B | yes |
| AT-US-020-05 | US-020 (DC) | Unsafe return URL is dropped | `e2e` | B | yes |
| AT-US-020-06 | US-020 (DC) | Unauthenticated visit to a protected route | `e2e` | B | yes |
| AT-US-021-01 | US-021 | Request responds identically for any email | `identity-session` | B | yes |
| AT-US-021-02 | US-021 | Newer token supersedes older | `identity-session` | B | yes |
| AT-US-021-03 | US-021 | Successful redemption | `identity-session` | B | yes |
| AT-US-021-04 | US-021 | Invalid redemptions (outline: one test per Examples row, suffix -<row>) | `identity-session` | B | yes |
| AT-US-021-05 | US-021 | Redeeming a reset token proves mailbox control | `identity-session` | B | yes |
| AT-US-021-06 | US-021 | Weak new password | `identity-session` | B | yes |
| AT-US-021-07 | US-021 | Request limits | `identity-session` | B | yes |
| AT-US-022-01 | US-022 | Delay starts at the fifth failure and doubles | `identity-session` | B | yes |
| AT-US-022-02 | US-022 | Lock after 10 failures | `identity-session` | B | yes |
| AT-US-022-03 | US-022 | Correct password is refused during delay or lock | `identity-session` | B | yes |
| AT-US-022-04 | US-022 | Unknown identifiers behave identically | `identity-session` | B | yes |
| AT-US-022-05 | US-022 | Success resets counters | `identity-session` | B | yes |
| AT-US-022-06 | US-022 | Each failure is audited | `audit-generator` | B+A* | yes |
| AT-US-022-07 | US-022 | Lock expires | `identity-session` | B | yes |
| AT-US-023-01 | US-023 (DC) | Enrolment and activation | `identity-session` | B | yes |
| AT-US-023-02 | US-023 (DC) | Wrong code does not activate | `identity-session` | B | yes |
| AT-US-023-03 | US-023 (DC) | Pending enrolment expires | `identity-session` | B | yes |
| AT-US-023-04 | US-023 (DC) | Secret stored encrypted and never repeated | `identity-session` | B | yes |
| AT-US-023-05 | US-023 (DC) | Same code twice in one step | `identity-session` | B | yes |
| AT-US-023-06 | US-023 (DC) | Tolerance window | `identity-session` | B | yes |
| AT-US-023-07 | US-023 (DC) | Recovery codes | `identity-session` | B | yes |
| AT-US-023-08 | US-023 (DC) | Unauthenticated enrolment | `identity-session` | B | yes |
| AT-US-024-01 | US-024 (DC) | Password then TOTP | `identity-session` | B | yes |
| AT-US-024-02 | US-024 (DC) | Recovery code works once | `identity-session` | B | yes |
| AT-US-024-03 | US-024 (DC) | Wrong code | `identity-session` | B | yes |
| AT-US-024-04 | US-024 (DC) | Lock after five wrong codes is per user | `identity-session` | B | yes |
| AT-US-024-05 | US-024 (DC) | A new challenge does not reset the lock counter | `identity-session` | B | yes |
| AT-US-024-06 | US-024 (DC) | Challenge token misuse (outline: one test per Examples row, suffix -<row>) | `identity-session` | B | yes |
| AT-US-024-07 | US-024 (DC) | Code from a drifting device clock | `identity-session` | B | yes |
| AT-US-025-01 | US-025 (DC) | Staff without TOTP can only reach enrolment | `identity-session` | B | yes |
| AT-US-025-02 | US-025 (DC) | After activation normal access resumes | `identity-session` | B | yes |
| AT-US-025-03 | US-025 (DC) | Staff added later | `identity-session` | B | yes |
| AT-US-025-04 | US-025 (DC) | Enrolment endpoints still require authentication | `identity-session` | B | yes |
| AT-US-025-05 | US-025 (DC) | Customer without operator membership is unaffected | `identity-session` | B | yes |
| AT-US-025-06 | US-025 (DC) | Blocked attempt is audited | `audit-generator` | B+A* | yes |
| AT-US-025-07 | US-025 (DC) | Staging requires the e-mailed code for first activation | `identity-session` | B | yes |
| AT-US-025-08 | US-025 (DC) | E-mailed code misuse (outline: one test per Examples row, suffix -<row>) | `identity-session` | B | yes |
| AT-US-025-09 | US-025 (DC) | Re-enrolment after a first activation uses the re-authentication proof | `identity-session` | B | yes |
| AT-US-025-10 | US-025 (DC) | No e-mailed code in local and test (outline: one test per Examples row, suffix -<row>) | `identity-session` | B | yes |
| AT-US-025-11 | US-025 (DC) | Enrolment deadline suspends the staff member | `identity-session` | B | yes |
| AT-US-025-12 | US-025 (DC) | Staff enrolled in time is not suspended | `identity-session` | B | yes |
| AT-US-025-13 | US-025 (DC) | Deadline counts from first sign-in, not from membership creation | `identity-session` | B | yes |
| AT-US-025-14 | US-025 (DC) | Operator re-activates a suspended staff member from the CLI | `identity-session` | B | yes |
| AT-US-027-01 | US-027 | List own sessions | `identity-session` | B | yes |
| AT-US-027-02 | US-027 | Sign out one session | `identity-session` | B | yes |
| AT-US-027-03 | US-027 | Sign out all other sessions | `identity-session` | B | yes |
| AT-US-027-04 | US-027 | Remote sign-out is audited | `audit-generator` | B+A* | yes |
| AT-US-027-05 | US-027 | Foreign or unknown session | `identity-session` | B | yes |
| AT-US-027-06 | US-027 | Unauthenticated | `identity-session` | B | yes |
| AT-US-027-07 | US-027 | Six states and locales | `e2e` | B | yes |
| AT-US-030-01 | US-030 (DC) | Unauthenticated visit redirects with return URL | `e2e` | B | yes |
| AT-US-030-02 | US-030 (DC) | Only sign-in and MFA challenge are public | `e2e` | B | yes |
| AT-US-030-03 | US-030 (DC) | Open redirect is blocked | `e2e` | B | yes |
| AT-US-030-04 | US-030 (DC) | Customer cannot sign in to admin | `e2e` | B | yes |
| AT-US-030-05 | US-030 (DC) | Staff with active operator membership is admitted | `e2e` | B | yes |
| AT-US-030-06 | US-030 (DC) | Operator-only account on the customer web app | `e2e` | B | yes |
| AT-US-031-01 | US-031 (DC) | Enrolled staff signs in | `e2e` | B | yes |
| AT-US-031-02 | US-031 (DC) | Recovery code alternative | `e2e` | B | yes |
| AT-US-031-03 | US-031 (DC) | First-time enrolment | `e2e` | B | yes |
| AT-US-031-04 | US-031 (DC) | Leaving the recovery-code screen | `e2e` | B | yes |
| AT-US-031-05 | US-031 (DC) | Error feedback (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-031-06 | US-031 (DC) | Locales and layouts (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-031-07 | US-031 (DC) | Screen states | `e2e` | B | yes |
| AT-US-031-08 | US-031 (DC) | Authentication endpoints are rate limited | `e2e` | B | yes |
| AT-US-032-01 | US-032 (DC) | Auditor lands on the audit log | `audit-generator` | B+A* | yes |
| AT-US-032-02 | US-032 (DC) | User without audit:read gets the welcome page | `audit-generator` | B+A* | yes |
| AT-US-032-03 | US-032 (DC) | No navigation for unimplemented modules | `e2e` | B | yes |
| AT-US-032-04 | US-032 (DC) | Deep links | `e2e` | B | yes |
| AT-US-032-05 | US-032 (DC) | Invalid filter value in URL | `e2e` | B | yes |
| AT-US-032-06 | US-032 (DC) | Deep link without audit:read | `audit-generator` | B+A* | yes |
| AT-US-032-07 | US-032 (DC) | Locales and breakpoints | `e2e` | B | yes |
| AT-US-291-01 | US-291 | Obtain a proof with the password | `identity-session` | B | yes |
| AT-US-291-02 | US-291 | Obtain a proof with a TOTP code for an MFA user | `identity-session` | B | yes |
| AT-US-291-03 | US-291 | Wrong password or code gives no proof | `identity-session` | B | yes |
| AT-US-291-04 | US-291 | Proof is single-use | `identity-session` | B | yes |
| AT-US-291-05 | US-291 | Route with a scope and no proof | `identity-session` | B | yes |
| AT-US-291-06 | US-291 | Proof misuse (outline: one test per Examples row, suffix -<row>) | `identity-session` | B | yes |
| AT-US-291-07 | US-291 | Access token carries auth_time | `identity-session` | B | yes |
| AT-US-291-08 | US-291 | Refresh leaves auth_time unchanged | `identity-session` | B | yes |
| AT-US-291-09 | US-291 | Age-based step-up (fake clock) | `identity-session` | B | yes |
| AT-US-291-10 | US-291 | Scope without max age always requires a proof | `identity-session` | B | yes |
| AT-US-291-11 | US-291 | Unauthenticated | `identity-session` | B | yes |
| AT-US-291-12 | US-291 | Re-authentication is rate limited | `identity-session` | B | yes |
| AT-US-291-13 | US-291 | Audit of a successful re-authentication | `audit-generator` | B+A* | yes |
| AT-US-292-01 | US-292 | Expired unverified account is deactivated | `identity-session` | B | yes |
| AT-US-292-02 | US-292 | The address can register again | `identity-session` | B | yes |
| AT-US-292-03 | US-292 | Account inside the window is untouched | `identity-session` | B | yes |
| AT-US-292-04 | US-292 | Verified account is never touched | `identity-session` | B | yes |
| AT-US-292-05 | US-292 | Sign-in for the expired account | `identity-session` | B | yes |
| AT-US-292-06 | US-292 | Job redelivery is idempotent | `idempotency` | B | yes |
| AT-US-292-07 | US-292 | Failure of one account does not block the others | `identity-session` | B | yes |

## EPIC-03 ([stories/EPIC-03-organisations-rbac-tenancy.md](../../01-requirements/stories/EPIC-03-organisations-rbac-tenancy.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-061-01 | US-061 (DC) | Seed creates exactly one OPERATOR organisation | `api` | B | yes |
| AT-US-061-02 | US-061 (DC) | Creating a PARTNER or second OPERATOR organisation is refused | `api` | B | yes |
| AT-US-061-03 | US-061 (DC) | Type is immutable | `api` | B | yes |
| AT-US-061-04 | US-061 (DC) | Unauthenticated organisation creation | `rbac-matrix` | B+A* | yes |
| AT-US-061-05 | US-061 (DC) | Audit of a refused attempt | `audit-generator` | B+A* | yes |
| AT-US-062-01 | US-062 (DC) | Registration creates a personal organisation in the same transaction | `api` | B | yes |
| AT-US-062-02 | US-062 (DC) | Role must belong to the organisation type | `api` | B | yes |
| AT-US-062-03 | US-062 (DC) | Duplicate non-removed membership is refused | `api` | B | yes |
| AT-US-062-04 | US-062 (DC) | Personal organisation cannot be deleted while the user is active | `api` | B | yes |
| AT-US-062-05 | US-062 (DC) | Permission denied on assigning roles | `rbac-matrix` | B+A* | yes |
| AT-US-062-06 | US-062 (DC) | Audit of membership change | `audit-generator` | B+A* | yes |
| AT-US-063-01 | US-063 (DC) | /me returns memberships, active organisation and effective permissions | `rbac-matrix` | B+A* | yes |
| AT-US-063-02 | US-063 (DC) | Login selects last-used organisation, else personal | `api` | B | yes |
| AT-US-063-03 | US-063 (DC) | Token whose organisation has no ACTIVE membership | `api` | B | yes |
| AT-US-063-04 | US-063 (DC) | Unauthenticated /me | `rbac-matrix` | B+A* | yes |
| AT-US-063-05 | US-063 (DC) | Audit of /me | `audit-generator` | B+A* | yes |
| AT-US-064-01 | US-064 | Server sets columns on create | `integration` | B | yes |
| AT-US-064-02 | US-064 | Seed and system-job writes use the reserved system user | `integration` | B | yes |
| AT-US-064-03 | US-064 | Client-supplied server fields are rejected | `integration` | B | yes |
| AT-US-064-04 | US-064 | Schema test rejects naive timestamps | `integration` | B | yes |
| AT-US-064-05 | US-064 | Local-by-nature dates carry a zone | `integration` | B | yes |
| AT-US-064-06 | US-064 | Permission path | `rbac-matrix` | B+A* | yes |
| AT-US-064-07 | US-064 | Audit entry records both fields | `audit-generator` | B+A* | yes |
| AT-US-065-01 | US-065 (DC) | Catalogue contains required permissions | `unit` | A | yes |
| AT-US-065-02 | US-065 (DC) | Format and uniqueness | `unit` | A | yes |
| AT-US-065-03 | US-065 (DC) | Unknown reference fails type check | `unit` | A | yes |
| AT-US-065-04 | US-065 (DC) | Route declares a permission absent from the catalogue | `unit` | A | yes |
| AT-US-065-05 | US-065 (DC) | Permission path: unauthenticated access to the catalogue is not exposed | `unit` | A | yes |
| AT-US-066-01 | US-066 (DC) | Idempotent seed | `idempotency` | B | yes |
| AT-US-066-02 | US-066 (DC) | Generated role-permission matrix | `unit` | A | yes |
| AT-US-066-03 | US-066 (DC) | Guard invariants hold | `unit` | A | yes |
| AT-US-066-04 | US-066 (DC) | Customer or partner role holding an operator-only permission | `unit` | A | yes |
| AT-US-066-05 | US-066 (DC) | Viewer may never download, e-mail or export (REQ-RBAC-004, D-051) (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |
| AT-US-066-06 | US-066 (DC) | Viewer is denied the document download-URL route and the denial is audited | `audit-generator` | B+A* | yes |
| AT-US-066-07 | US-066 (DC) | Partner roles are unused | `unit` | A | yes |
| AT-US-066-08 | US-066 (DC) | Permission path | `unit` | A | yes |
| AT-US-066-09 | US-066 (DC) | Compliance Auditor may never hold a non-read audit permission other than audit:export (REQ-RBAC-004, D-ARCH-069) (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |
| AT-US-066-10 | US-066 (DC) | Compliance Auditor keeps audit:export and audit:read | `unit` | A | yes |
| AT-US-066-11 | US-066 (DC) | Self-service permission removed from a seeded role (REQ-RBAC-004, D-058) (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |
| AT-US-066-12 | US-066 (DC) | Self-service permissions reach only the caller's own rows (D-058) | `api` | B | yes |
| AT-US-067-01 | US-067 (DC) | Complete route mounts | `route-registry` | A | yes |
| AT-US-067-02 | US-067 (DC) | Missing any of the three refuses mount | `route-registry` | A | yes |
| AT-US-067-03 | US-067 (DC) | Marker without justification | `route-registry` | A | yes |
| AT-US-067-04 | US-067 (DC) | Permission path: not applicable — build-time tooling has no principal. Second negative: unknown query parameter | `route-registry` | A | yes |
| AT-US-068-01 | US-068 (DC) | Authorised request executes | `api` | B | yes |
| AT-US-068-02 | US-068 (DC) | Unauthenticated call | `rbac-matrix` | B+A* | yes |
| AT-US-068-03 | US-068 (DC) | Authorisation precedes validation | `api` | B | yes |
| AT-US-068-04 | US-068 (DC) | Role change takes effect within 5 s | `api` | B | yes |
| AT-US-068-05 | US-068 (DC) | Claims in token or client headers are ignored | `api` | B | yes |
| AT-US-068-06 | US-068 (DC) | Public route skips authentication | `api` | B | yes |
| AT-US-069-01 | US-069 | Denial is audited and logged | `audit-generator` | B+A* | yes |
| AT-US-069-02 | US-069 | Cross-tenant resource returns 404 | `abuse` | B | yes |
| AT-US-069-03 | US-069 | Denied attempt at the audit viewer | `audit-generator` | B+A* | yes |
| AT-US-069-04 | US-069 | Unauthenticated probe | `abuse` | B | yes |
| AT-US-069-05 | US-069 | Repeated cross-tenant probes | `abuse` | B | yes |
| AT-US-070-01 | US-070 | Controls follow /me permissions through one helper | `e2e` | B | yes |
| AT-US-070-02 | US-070 | Guarded route shows permission-denied without a data request | `e2e` | B | yes |
| AT-US-070-03 | US-070 | Permission-denied offers actions | `e2e` | B | yes |
| AT-US-070-04 | US-070 | Server still authoritative | `unit` | A | yes |
| AT-US-070-05 | US-070 | Unauthenticated deep link | `e2e` | B | yes |
| AT-US-070-06 | US-070 | Keyboard and axe | `e2e` | B | yes |
| AT-US-071-01 | US-071 (DC) | Allow or deny per cell | `rbac-matrix` | B+A* | yes |
| AT-US-071-02 | US-071 (DC) | Unauthenticated test per protected route | `rbac-matrix` | B+A* | yes |
| AT-US-071-03 | US-071 (DC) | Cross-tenant case per tenant-resource route | `abuse` | B | yes |
| AT-US-071-04 | US-071 (DC) | Uncovered route or role fails CI | `rbac-matrix` | B+A* | yes |
| AT-US-071-05 | US-071 (DC) | Permission path: not applicable — test tooling has no principal. Second negative: seed drift | `rbac-matrix` | B+A* | yes |
| AT-US-072-01 | US-072 | Permitted download | `api` | B | yes |
| AT-US-072-02 | US-072 | Missing permission | `rbac-matrix` | B+A* | yes |
| AT-US-072-03 | US-072 | Route lacking its own download permission fails the build | `rbac-matrix` | B+A* | yes |
| AT-US-072-04 | US-072 | Cross-tenant | `abuse` | B | yes |
| AT-US-074-01 | US-074 (DC) | org_id and index on every tenant table | `catalog-c1-c14` | B+A* | yes |
| AT-US-074-02 | US-074 (DC) | Table without org_id not on global list fails build | `catalog-c1-c14` | B+A* | yes |
| AT-US-074-03 | US-074 (DC) | RLS enabled and forced | `catalog-c1-c14` | B+A* | yes |
| AT-US-074-04 | US-074 (DC) | Runtime role attributes | `catalog-c1-c14` | B+A* | yes |
| AT-US-074-05 | US-074 (DC) | Permission path | `rbac-matrix` | B+A* | yes |
| AT-US-075-01 | US-075 (DC) | Sequential requests on a single-connection pool | `rls-cross-tenant` | B+A* | yes |
| AT-US-075-02 | US-075 (DC) | Unset, empty or invalid context returns nothing | `rls-cross-tenant` | B+A* | yes |
| AT-US-075-03 | US-075 (DC) | Session-level SET is rejected by lint | `rls-cross-tenant` | B+A* | yes |
| AT-US-075-04 | US-075 (DC) | Permission path: not applicable — infrastructure with no end-user principal. Second negative | `rls-cross-tenant` | B+A* | yes |
| AT-US-076-01 | US-076 (DC) | Operator on a cross-tenant-capable route sees other organisations | `rls-cross-tenant` | B+A* | yes |
| AT-US-076-02 | US-076 (DC) | Client-supplied scope is ignored | `rls-cross-tenant` | B+A* | yes |
| AT-US-076-03 | US-076 (DC) | Customer or partner member can never obtain scope | `rls-cross-tenant` | B+A* | yes |
| AT-US-076-04 | US-076 (DC) | Operator on a route not flagged cross-tenant | `rls-cross-tenant` | B+A* | yes |
| AT-US-077-01 | US-077 | Table-level proof | `rls-cross-tenant` | B+A* | yes |
| AT-US-077-02 | US-077 | API-level proof | `rls-cross-tenant` | B+A* | yes |
| AT-US-077-03 | US-077 | New table without a generated case | `rls-cross-tenant` | B+A* | yes |
| AT-US-077-04 | US-077 | Permission path: not applicable — test tooling. Second negative: runtime role used | `rls-cross-tenant` | B+A* | yes |
| AT-US-078-01 | US-078 (DC) | Job runs in payload context | `jobs-resilience` | B | yes |
| AT-US-078-02 | US-078 (DC) | Missing or invalid org_id | `jobs-resilience` | B | yes |
| AT-US-078-03 | US-078 (DC) | Cross-tenant job iterates explicitly | `abuse` | B | yes |
| AT-US-078-04 | US-078 (DC) | Permission path: not applicable — jobs run as actor type SYSTEM_JOB. Second negative | `rbac-matrix` | B+A* | yes |
| AT-US-079-01 | US-079 | Soft delete | `api` | B | yes |
| AT-US-079-02 | US-079 | Unique keys free after delete | `api` | B | yes |
| AT-US-079-03 | US-079 | Runtime role cannot hard delete | `api` | B | yes |
| AT-US-079-04 | US-079 | Version increments | `api` | B | yes |
| AT-US-079-05 | US-079 | Stale update | `api` | B | yes |
| AT-US-079-06 | US-079 | Two concurrent updates | `api` | B | yes |
| AT-US-079-07 | US-079 | Missing If-Match and no-op update | `api` | B | yes |
| AT-US-079-08 | US-079 | Permission denied | `rbac-matrix` | B+A* | yes |
| AT-US-080-01 | US-080 (DC) | Token access | `rls-cross-tenant` | B+A* | yes |
| AT-US-080-02 | US-080 (DC) | Crafted IDs and wrong tokens | `rls-cross-tenant` | B+A* | yes |
| AT-US-080-03 | US-080 (DC) | Null org_id only on flagged tables | `rls-cross-tenant` | B+A* | yes |
| AT-US-080-04 | US-080 (DC) | Atomic claim | `rls-cross-tenant` | B+A* | yes |
| AT-US-080-05 | US-080 (DC) | Claim twice | `rls-cross-tenant` | B+A* | yes |
| AT-US-080-06 | US-080 (DC) | Unauthenticated claim | `rls-cross-tenant` | B+A* | yes |
| AT-US-080-07 | US-080 (DC) | Audit | `audit-generator` | B+A* | yes |

## EPIC-04 ([stories/EPIC-04-audit-trail-viewer.md](../../01-requirements/stories/EPIC-04-audit-trail-viewer.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-086-01 | US-086 (DC) | Mutation is audited without feature code | `audit-generator` | B+A* | yes |
| AT-US-086-02 | US-086 (DC) | Incomplete descriptor | `audit-generator` | B+A* | yes |
| AT-US-086-03 | US-086 (DC) | Writer imported outside allow-list | `audit-generator` | B+A* | yes |
| AT-US-086-04 | US-086 (DC) | List view granularity | `audit-generator` | B+A* | yes |
| AT-US-086-05 | US-086 (DC) | Permission denied | `rbac-matrix` | B+A* | yes |
| AT-US-086-06 | US-086 (DC) | NONE routes | `audit-generator` | B+A* | yes |
| AT-US-086-07 | US-086 (DC) | NONE outside the closed list is rejected | `audit-generator` | B+A* | yes |
| AT-US-087-01 | US-087 (DC) | All fields present on a user action | `audit-generator` | B+A* | yes |
| AT-US-087-02 | US-087 (DC) | Shipment state transition | `audit-generator` | B+A* | yes |
| AT-US-087-03 | US-087 (DC) | Actor types | `audit-generator` | B+A* | yes |
| AT-US-087-04 | US-087 (DC) | Spoofed forwarded header | `audit-generator` | B+A* | yes |
| AT-US-087-05 | US-087 (DC) | Unknown action type | `audit-generator` | B+A* | yes |
| AT-US-087-06 | US-087 (DC) | Failed login for unknown account | `audit-generator` | B+A* | yes |
| AT-US-087-07 | US-087 (DC) | Recovery code and remote revocation have their own action types | `audit-generator` | B+A* | yes |
| AT-US-087-08 | US-087 (DC) | Permission path: audit entry fields are not readable without "audit:read" | `audit-generator` | B+A* | yes |
| AT-US-088-01 | US-088 (DC) | Audit insert fails | `audit-generator` | B+A* | yes |
| AT-US-088-02 | US-088 (DC) | Business insert fails | `audit-generator` | B+A* | yes |
| AT-US-088-03 | US-088 (DC) | Retry is safe | `audit-generator` | B+A* | yes |
| AT-US-088-04 | US-088 (DC) | Authorised mutation ends 409, 422 or 5xx | `audit-generator` | B+A* | yes |
| AT-US-088-05 | US-088 (DC) | Schema validation failure | `audit-generator` | B+A* | yes |
| AT-US-088-06 | US-088 (DC) | Permission denial | `rbac-matrix` | B+A* | yes |
| AT-US-088-07 | US-088 (DC) | No partition for current month | `audit-generator` | B+A* | yes |
| AT-US-088-08 | US-088 (DC) | Permission path: not applicable — transaction semantics have no principal difference. Second negative: concurrent mutation | `rbac-matrix` | B+A* | yes |
| AT-US-089-01 | US-089 | Sensitive view recorded before release | `audit-generator` | B+A* | yes |
| AT-US-089-02 | US-089 | Audit unavailable on sensitive read | `audit-generator` | B+A* | yes |
| AT-US-089-03 | US-089 | Non-sensitive read does not block | `audit-generator` | B+A* | yes |
| AT-US-089-04 | US-089 | Download | `audit-generator` | B+A* | yes |
| AT-US-089-05 | US-089 | Unauthorised sensitive read | `rbac-matrix` | B+A* | yes |
| AT-US-090-01 | US-090 | Update stores only changed fields | `audit-generator` | B+A* | yes |
| AT-US-090-02 | US-090 | Create and delete | `audit-generator` | B+A* | yes |
| AT-US-090-03 | US-090 | No-op update | `audit-generator` | B+A* | yes |
| AT-US-090-04 | US-090 | No-op on a route flagged audit_noop | `audit-generator` | B+A* | yes |
| AT-US-090-05 | US-090 | Same diff, same bytes | `audit-generator` | B+A* | yes |
| AT-US-090-06 | US-090 | Permission path: not applicable — storage format with no principal. Second negative: unserialisable value | `rbac-matrix` | B+A* | yes |
| AT-US-091-01 | US-091 | Denylisted keys redacted | `redaction` | B | yes |
| AT-US-091-02 | US-091 | Property test | `redaction` | B | yes |
| AT-US-091-03 | US-091 | Classification tags | `redaction` | B | yes |
| AT-US-091-04 | US-091 | Unclassified field fails the build | `redaction` | B | yes |
| AT-US-091-05 | US-091 | Redaction happens before hashing | `redaction` | B | yes |
| AT-US-091-06 | US-091 | Permission path | `rbac-matrix` | B+A* | yes |
| AT-US-092-01 | US-092 (DC) | First entry in a stream | `audit-chain` | B | yes |
| AT-US-092-02 | US-092 (DC) | Links | `audit-chain` | B | yes |
| AT-US-092-03 | US-092 (DC) | Concurrent writers | `audit-chain` | B | yes |
| AT-US-092-04 | US-092 (DC) | Per-organisation streams | `audit-chain` | B | yes |
| AT-US-092-05 | US-092 (DC) | Duplicate hash | `audit-chain` | B | yes |
| AT-US-092-06 | US-092 (DC) | Permission path: not applicable — internal mechanism. Second negative: out-of-order insert | `rbac-matrix` | B+A* | yes |
| AT-US-093-01 | US-093 | Healthy chain | `audit-chain` | B | yes |
| AT-US-093-02 | US-093 | Break detected | `audit-chain` | B | yes |
| AT-US-093-03 | US-093 | Full nightly run covers all entries | `audit-chain` | B | yes |
| AT-US-093-04 | US-093 | Multiple workers | `audit-chain` | B | yes |
| AT-US-093-05 | US-093 | Permission path: not applicable — system job. Second negative: job failure | `rbac-matrix` | B+A* | yes |
| AT-US-094-01 | US-094 (DC) | UPDATE, DELETE, TRUNCATE fail for every role | `audit-immutability` | B+A* | yes |
| AT-US-094-02 | US-094 (DC) | Privileges | `audit-immutability` | B+A* | yes |
| AT-US-094-03 | US-094 (DC) | Repository scan | `audit-immutability` | B+A* | yes |
| AT-US-094-04 | US-094 (DC) | No edit or delete surface | `audit-immutability` | B+A* | yes |
| AT-US-094-05 | US-094 (DC) | Permission denied on dropping the trigger | `rbac-matrix` | B+A* | yes |
| AT-US-094-06 | US-094 (DC) | Audit of the attempt | `audit-immutability` | B+A* | yes |
| AT-US-095-01 | US-095 (DC) | Partitioned layout and indexes | `audit-immutability` | B+A* | yes |
| AT-US-095-02 | US-095 (DC) | One-day filter prunes | `audit-immutability` | B+A* | yes |
| AT-US-095-03 | US-095 (DC) | Daily job is idempotent | `idempotency` | B | yes |
| AT-US-095-04 | US-095 (DC) | Readiness degrades | `audit-immutability` | B+A* | yes |
| AT-US-095-05 | US-095 (DC) | Missing partition fails closed | `audit-immutability` | B+A* | yes |
| AT-US-095-06 | US-095 (DC) | Permission path: not applicable — scheduled job. Second negative | `rbac-matrix` | B+A* | yes |
| AT-US-096-01 | US-096 (DC) | Permitted role | `audit-generator` | B+A* | yes |
| AT-US-096-02 | US-096 (DC) | Forbidden role | `rbac-matrix` | B+A* | yes |
| AT-US-096-03 | US-096 (DC) | Chain valid afterwards | `audit-generator` | B+A* | yes |
| AT-US-096-04 | US-096 (DC) | Sensitive reads and downloads | `audit-generator` | B+A* | yes |
| AT-US-096-05 | US-096 (DC) | NONE routes | `audit-generator` | B+A* | yes |
| AT-US-096-06 | US-096 (DC) | Route without a generated case | `audit-generator` | B+A* | yes |
| AT-US-096-07 | US-096 (DC) | Permission path: not applicable — test tooling. Second negative | `rbac-matrix` | B+A* | yes |
| AT-US-097-01 | US-097 (DC) | Default view | `e2e` | B | yes |
| AT-US-097-02 | US-097 (DC) | Filters combine and reflect in URL | `e2e` | B | yes |
| AT-US-097-03 | US-097 (DC) | Pagination limits | `e2e` | B | yes |
| AT-US-097-04 | US-097 (DC) | Range over 31 days | `e2e` | B | yes |
| AT-US-097-05 | US-097 (DC) | Empty result | `e2e` | B | yes |
| AT-US-097-06 | US-097 (DC) | Mobile | `e2e` | B | yes |
| AT-US-097-07 | US-097 (DC) | Six states | `e2e` | B | yes |
| AT-US-097-08 | US-097 (DC) | Permission denied | `e2e` | B | yes |
| AT-US-097-09 | US-097 (DC) | Cross-tenant filter | `abuse` | B | yes |
| AT-US-097-10 | US-097 (DC) | Locales, keyboard, accessibility | `e2e` | B | yes |
| AT-US-098-01 | US-098 (DC) | Detail shows all fields and diff | `e2e` | B | yes |
| AT-US-098-02 | US-098 (DC) | Redacted fields marked | `e2e` | B | yes |
| AT-US-098-03 | US-098 (DC) | Viewing is audited without looping | `audit-generator` | B+A* | yes |
| AT-US-098-04 | US-098 (DC) | Audit write fails | `audit-generator` | B+A* | yes |
| AT-US-098-05 | US-098 (DC) | Unknown or cross-tenant entry | `abuse` | B | yes |
| AT-US-098-06 | US-098 (DC) | Permission denied | `e2e` | B | yes |
| AT-US-098-07 | US-098 (DC) | Responsive, locales and states | `e2e` | B | yes |
| AT-US-098-08 | US-098 (DC) | Read-only | `e2e` | B | yes |

## EPIC-05 ([stories/EPIC-05-design-system-shells-i18n.md](../../01-requirements/stories/EPIC-05-design-system-shells-i18n.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-101-01 | US-101 (DC) | Both apps consume tokens | `lint` | A | yes |
| AT-US-101-02 | US-101 (DC) | Hard-coded colour fails lint | `lint` | A | yes |
| AT-US-101-03 | US-101 (DC) | Off-grid spacing fails lint | `lint` | A | yes |
| AT-US-101-04 | US-101 (DC) | Tenant override | `lint` | A | yes |
| AT-US-101-05 | US-101 (DC) | Permission path: not applicable — build tooling has no principal. Second negative: unknown token | `lint` | A | yes |
| AT-US-102-01 | US-102 | First visit follows system | `unit` | A | yes |
| AT-US-102-02 | US-102 | Manual toggle persisted | `unit` | A | yes |
| AT-US-102-03 | US-102 | Contrast test | `unit` | A | yes |
| AT-US-102-04 | US-102 | Colour-only meaning | `unit` | A | yes |
| AT-US-102-05 | US-102 | Toggle operable | `unit` | A | yes |
| AT-US-102-06 | US-102 | Permission path: not applicable — theming is available to all principals. Second negative: stored value invalid | `unit` | A | yes |
| AT-US-103-01 | US-103 | Pointer sizes | `e2e-a11y` | B | yes |
| AT-US-103-02 | US-103 | All states exist | `e2e-a11y` | B | yes |
| AT-US-103-03 | US-103 | Hover only on hover devices | `e2e-a11y` | B | yes |
| AT-US-103-04 | US-103 | Focus indicator | `e2e-a11y` | B | yes |
| AT-US-103-05 | US-103 | Reduced motion | `e2e-a11y` | B | yes |
| AT-US-103-06 | US-103 | Disabled and loading controls | `e2e-a11y` | B | yes |
| AT-US-103-07 | US-103 | Permission path: not applicable — presentational. Second negative: transition outside range | `e2e` | B | yes |
| AT-US-104-01 | US-104 | Loading | `e2e-a11y` | B | yes |
| AT-US-104-02 | US-104 | Empty | `e2e-a11y` | B | yes |
| AT-US-104-03 | US-104 | Error | `e2e-a11y` | B | yes |
| AT-US-104-04 | US-104 | Partial | `e2e-a11y` | B | yes |
| AT-US-104-05 | US-104 | Permission-denied | `e2e` | B | yes |
| AT-US-104-06 | US-104 | Render exception | `e2e-a11y` | B | yes |
| AT-US-104-07 | US-104 | Per-route checklist | `e2e-a11y` | B | yes |
| AT-US-104-08 | US-104 | Locales and viewports | `e2e-a11y` | B | yes |
| AT-US-104-09 | US-104 | Permission denied is localised | `e2e` | B | yes |
| AT-US-105-01 | US-105 | Offline banner | `e2e` | B | yes |
| AT-US-105-02 | US-105 | Back online | `e2e` | B | yes |
| AT-US-105-03 | US-105 | In-flight request fails | `e2e` | B | yes |
| AT-US-105-04 | US-105 | Toast timing | `e2e` | B | yes |
| AT-US-105-05 | US-105 | Toast pause | `e2e` | B | yes |
| AT-US-105-06 | US-105 | Assistive announcement | `e2e` | B | yes |
| AT-US-105-07 | US-105 | Critical info is never toast-only | `e2e` | B | yes |
| AT-US-105-08 | US-105 | Locales and viewports | `e2e` | B | yes |
| AT-US-106-01 | US-106 | Inline validation on blur | `e2e-a11y` | B | yes |
| AT-US-106-02 | US-106 | Submit moves focus | `e2e-a11y` | B | yes |
| AT-US-106-03 | US-106 | Server errors mapped | `e2e-a11y` | B | yes |
| AT-US-106-04 | US-106 | Not colour alone | `e2e-a11y` | B | yes |
| AT-US-106-05 | US-106 | Labels and headings | `e2e-a11y` | B | yes |
| AT-US-106-06 | US-106 | Document language | `e2e-a11y` | B | yes |
| AT-US-106-07 | US-106 | Permission denied on submit | `e2e` | B | yes |
| AT-US-106-08 | US-106 | Locales and viewports | `e2e-a11y` | B | yes |
| AT-US-107-01 | US-107 (DC) | No horizontal scroll | `e2e-a11y` | B | yes |
| AT-US-107-02 | US-107 (DC) | 400% zoom reflow | `e2e-a11y` | B | yes |
| AT-US-107-03 | US-107 (DC) | Table at 768 px | `e2e-a11y` | B | yes |
| AT-US-107-04 | US-107 (DC) | Cards at 360 px | `e2e-a11y` | B | yes |
| AT-US-107-05 | US-107 (DC) | Permission path: not applicable — layout is principal-independent. Second negative: oversized content | `e2e` | B | yes |
| AT-US-108-01 | US-108 (DC) | Header and footer content | `e2e` | B | yes |
| AT-US-108-02 | US-108 (DC) | Skip link | `e2e` | B | yes |
| AT-US-108-03 | US-108 (DC) | Mobile navigation | `e2e` | B | yes |
| AT-US-108-04 | US-108 (DC) | Locale switch | `e2e` | B | yes |
| AT-US-108-05 | US-108 (DC) | Signed-in menu | `e2e` | B | yes |
| AT-US-108-06 | US-108 (DC) | Permission denied | `e2e` | B | yes |
| AT-US-108-07 | US-108 (DC) | States | `e2e` | B | yes |
| AT-US-108-08 | US-108 (DC) | Brand from configuration | `e2e` | B | yes |
| AT-US-108-09 | US-108 (DC) | Accessibility | `e2e` | B | yes |
| AT-US-109-01 | US-109 (DC) | Hero above the fold | `e2e` | B | yes |
| AT-US-109-02 | US-109 (DC) | No layout shift | `e2e` | B | yes |
| AT-US-109-03 | US-109 (DC) | Sticky bar on mobile | `e2e` | B | yes |
| AT-US-109-04 | US-109 (DC) | Bar never covers focus | `e2e` | B | yes |
| AT-US-109-05 | US-109 (DC) | Not shown on desktop | `e2e` | B | yes |
| AT-US-109-06 | US-109 (DC) | Locales | `e2e` | B | yes |
| AT-US-109-07 | US-109 (DC) | Permission path | `e2e` | B | yes |
| AT-US-110-01 | US-110 (DC) | Layout at 1280 px | `e2e` | B | yes |
| AT-US-110-02 | US-110 (DC) | Collapse persisted | `e2e` | B | yes |
| AT-US-110-03 | US-110 (DC) | Drawer below 1024 px | `e2e` | B | yes |
| AT-US-110-04 | US-110 (DC) | Entries filtered by permission | `e2e` | B | yes |
| AT-US-110-05 | US-110 (DC) | Unimplemented modules | `e2e` | B | yes |
| AT-US-110-06 | US-110 (DC) | Locale switch in the header | `e2e` | B | yes |
| AT-US-110-07 | US-110 (DC) | Landmarks and states | `e2e` | B | yes |
| AT-US-110-08 | US-110 (DC) | Accessibility | `e2e` | B | yes |
| AT-US-112-01 | US-112 | HTML without JavaScript | `headers` | B | yes |
| AT-US-112-02 | US-112 | Every public page per locale | `e2e` | B | yes |
| AT-US-112-03 | US-112 | Locale precedence | `e2e` | B | yes |
| AT-US-112-04 | US-112 | Authenticated routes are not rendered with data | `headers` | B | yes |
| AT-US-112-05 | US-112 | Admin | `headers` | B | yes |
| AT-US-112-06 | US-112 | Missing translation | `headers` | B | yes |
| AT-US-112-07 | US-112 | Permission path | `rbac-matrix` | B+A* | yes |
| AT-US-112-08 | US-112 | States and accessibility | `headers` | B | yes |
| AT-US-113-01 | US-113 | Axe zero serious or critical | `e2e-a11y` | B | yes |
| AT-US-113-02 | US-113 | Violation fails CI | `e2e-a11y` | B | yes |
| AT-US-113-03 | US-113 | Keyboard-only journeys | `e2e-a11y` | B | yes |
| AT-US-113-04 | US-113 | Dialogs and menus | `e2e-a11y` | B | yes |
| AT-US-113-05 | US-113 | No keyboard trap | `e2e-a11y` | B | yes |
| AT-US-113-06 | US-113 | Permission path | `e2e` | B | yes |
| AT-US-113-07 | US-113 | Locales | `e2e-a11y` | B | yes |
| AT-US-115-01 | US-115 (DC) | Literal string fails lint | `i18n-parity` | A | yes |
| AT-US-115-02 | US-115 (DC) | Missing, unused or partial key fails CI | `i18n-parity` | A | yes |
| AT-US-115-03 | US-115 (DC) | Placeholder mismatch fails CI | `i18n-parity` | A | yes |
| AT-US-115-04 | US-115 (DC) | ICU plurals in all locales | `e2e` | B | yes |
| AT-US-115-05 | US-115 (DC) | Concatenation forbidden | `i18n-parity` | A | yes |
| AT-US-115-06 | US-115 (DC) | Pending review list | `i18n-parity` | A | yes |
| AT-US-115-07 | US-115 (DC) | Runtime missing key | `i18n-parity` | A | yes |
| AT-US-115-08 | US-115 (DC) | Error codes localised | `i18n-parity` | A | yes |
| AT-US-115-09 | US-115 (DC) | Permission path: not applicable — build tooling has no principal. Second negative: key-name collision across namespaces | `i18n-parity` | A | yes |
| AT-US-116-01 | US-116 (DC) | Number formats | `unit` | A | yes |
| AT-US-116-02 | US-116 (DC) | Currency | `unit` | A | yes |
| AT-US-116-03 | US-116 (DC) | Units | `unit` | A | yes |
| AT-US-116-04 | US-116 (DC) | Timestamp in viewer zone | `unit` | A | yes |
| AT-US-116-05 | US-116 (DC) | DST change | `unit` | A | yes |
| AT-US-116-06 | US-116 (DC) | Zone preference order | `unit` | A | yes |
| AT-US-116-07 | US-116 (DC) | Date-only value | `unit` | A | yes |
| AT-US-116-08 | US-116 (DC) | Collation | `unit` | A | yes |
| AT-US-116-09 | US-116 (DC) | Invalid input | `unit` | A | yes |
| AT-US-116-10 | US-116 (DC) | Unknown locale for formatting | `e2e` | B | yes |
| AT-US-117-01 | US-117 (DC) | Accept-Language matching | `e2e-i18n` | B | yes |
| AT-US-117-02 | US-117 (DC) | Precedence | `e2e-i18n` | B | yes |
| AT-US-117-03 | US-117 (DC) | Change persists | `e2e-i18n` | B | yes |
| AT-US-117-04 | US-117 (DC) | Guest cookie | `e2e-i18n` | B | yes |
| AT-US-117-05 | US-117 (DC) | Across devices | `e2e-i18n` | B | yes |
| AT-US-117-06 | US-117 (DC) | Email locale captured at event time | `e2e-i18n` | B | yes |
| AT-US-117-07 | US-117 (DC) | Missing template locale | `e2e-i18n` | B | yes |
| AT-US-117-08 | US-117 (DC) | Invalid locale value | `e2e-i18n` | B | yes |
| AT-US-117-09 | US-117 (DC) | Permission denied | `e2e` | B | yes |
| AT-US-119-01 | US-119 (DC) | United States | `e2e` | B | yes |
| AT-US-119-02 | US-119 (DC) | India | `e2e` | B | yes |
| AT-US-119-03 | US-119 (DC) | United Kingdom | `e2e` | B | yes |
| AT-US-119-04 | US-119 (DC) | Rendered address block | `e2e` | B | yes |
| AT-US-119-05 | US-119 (DC) | Country change re-lays out the form | `e2e` | B | yes |
| AT-US-119-06 | US-119 (DC) | Required field missing | `e2e` | B | yes |
| AT-US-119-07 | US-119 (DC) | Unsupported country | `e2e` | B | yes |
| AT-US-119-08 | US-119 (DC) | Locales and viewports | `e2e` | B | yes |
| AT-US-119-09 | US-119 (DC) | Permission path | `e2e` | B | yes |
| AT-US-120-01 | US-120 | Pseudo-locale expands strings | `e2e-i18n` | B | yes |
| AT-US-120-02 | US-120 | No clipping or overlap | `e2e-i18n` | B | yes |
| AT-US-120-03 | US-120 | Production excludes pseudo-locale | `e2e-i18n` | B | yes |
| AT-US-120-04 | US-120 | Physical properties fail lint | `e2e-i18n` | B | yes |
| AT-US-120-05 | US-120 | Logical properties pass | `e2e-i18n` | B | yes |
| AT-US-120-06 | US-120 | Permission path: not applicable — build and test tooling. Second negative: annotated exception without reason | `e2e` | B | yes |

## EPIC-06 ([stories/EPIC-06-carrier-integration.md](../../01-requirements/stories/EPIC-06-carrier-integration.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-121-01 | US-121 (DC) | Adapter exposes required and optional operations with a context | `carrier-contract` | A | yes |
| AT-US-121-02 | US-121 (DC) | Capabilities describe services, limits and pickup constraints | `carrier-contract` | A | yes |
| AT-US-121-03 | US-121 (DC) | Unsupported optional operation fails without a network call | `carrier-contract` | A | yes |
| AT-US-121-04 | US-121 (DC) | Environment is read from the account, not a global flag | `carrier-contract` | A | yes |
| AT-US-121-05 | US-121 (DC) | Wire formats cannot leak out of the package | `carrier-contract` | A | yes |
| AT-US-121-06 | US-121 (DC) | Adapter missing a required operation is rejected at registration | `carrier-contract` | A | yes |
| AT-US-121-07 | US-121 (DC) | Required operation declared unsupported fails without a network call | `carrier-contract` | A | yes |
| AT-US-122-01 | US-122 (DC) | Three services priced deterministically | `carrier-contract` | A | yes |
| AT-US-122-02 | US-122 (DC) | Price changes only with weight, zone or service | `carrier-contract` | A | yes |
| AT-US-122-03 | US-122 (DC) | Tracking number is stable for a client reference | `carrier-contract` | A | yes |
| AT-US-122-04 | US-122 (DC) | Documents, imports and domestic lanes are served | `carrier-contract` | A | yes |
| AT-US-122-05 | US-122 (DC) | Optional operations are supported except landed cost | `carrier-contract` | A | yes |
| AT-US-122-06 | US-122 (DC) | Request outside Mock limits returns no service | `carrier-contract` | A | yes |
| AT-US-123-01 | US-123 | Latency directive delays every call | `config-guards` | A | yes |
| AT-US-123-02 | US-123 | Failure with canonical error | `config-guards` | A | yes |
| AT-US-123-03 | US-123 | Reference-based directive | `config-guards` | A | yes |
| AT-US-123-04 | US-123 | Empty rates and tracking milestones | `config-guards` | A | yes |
| AT-US-123-05 | US-123 | Unknown directive is rejected | `config-guards` | A | yes |
| AT-US-123-06 | US-123 | Flags default to true only in local and test | `config-guards` | A | yes |
| AT-US-123-07 | US-123 | Staging without the flags has no Mock | `config-guards` | A | yes |
| AT-US-123-08 | US-123 | Directives are ignored and stripped when scenarios are disabled | `config-guards` | A | yes |
| AT-US-123-09 | US-123 | Production start-up is refused with the Mock enabled | `config-guards` | A | yes |
| AT-US-123-10 | US-123 | Compose demo stack keeps directives working | `config-guards` | A | yes |
| AT-US-123-11 | US-123 | Boundary values of latency | `config-guards` | A | yes |
| AT-US-124-01 | US-124 (DC) | Mapped service, surcharge and error | `carrier-contract` | A | yes |
| AT-US-124-02 | US-124 (DC) | Unmapped service is dropped and logged | `carrier-contract` | A | yes |
| AT-US-124-03 | US-124 (DC) | Unmapped surcharge becomes CARRIER_OTHER | `carrier-contract` | A | yes |
| AT-US-124-04 | US-124 (DC) | Unmapped error becomes CARRIER_UNKNOWN_ERROR | `carrier-contract` | A | yes |
| AT-US-124-05 | US-124 (DC) | Every canonical code is in the catalogue | `carrier-contract` | A | yes |
| AT-US-125-01 | US-125 | Suite passes for the Mock adapter | `carrier-contract` | A | yes |
| AT-US-125-02 | US-125 | Capability honesty is verified | `carrier-contract` | A | yes |
| AT-US-125-03 | US-125 | Suite is adapter-agnostic | `carrier-contract` | A | yes |
| AT-US-125-04 | US-125 | Duplicate client reference does not create a second shipment | `carrier-contract` | A | yes |
| AT-US-125-05 | US-125 | A failing adapter fails CI | `carrier-contract` | A | yes |
| AT-US-126-01 | US-126 (DC) | Parallel fan-out returns all carriers' results | `carrier-resilience` | B | yes |
| AT-US-126-02 | US-126 (DC) | Slow carrier times out without blocking others | `carrier-resilience` | B | yes |
| AT-US-126-03 | US-126 (DC) | Carrier filtered out by declared services | `carrier-resilience` | B | yes |
| AT-US-126-04 | US-126 (DC) | Carrier error is isolated | `carrier-resilience` | B | yes |
| AT-US-126-05 | US-126 (DC) | Overall deadline marks outstanding carriers | `carrier-resilience` | B | yes |
| AT-US-126-06 | US-126 (DC) | Disabled carrier account is skipped | `carrier-resilience` | B | yes |
| AT-US-126-07 | US-126 (DC) | Quote performance with the Mock latency profile | `carrier-resilience` | B | yes |
| AT-US-126-08 | US-126 (DC) | Fan-out is audited per carrier call only for system jobs | `audit-generator` | B+A* | yes |
| AT-US-127-01 | US-127 (DC) | Seed covers all carriers | `integration` | B | yes |
| AT-US-127-02 | US-127 (DC) | Divisors and flags | `integration` | B | yes |
| AT-US-127-03 | US-127 (DC) | Single source of truth | `integration` | B | yes |
| AT-US-127-04 | US-127 (DC) | Seed is idempotent | `integration` | B | yes |
| AT-US-127-05 | US-127 (DC) | Invalid row is rejected | `integration` | B | yes |
| AT-US-128-01 | US-128 (DC) | Three sandbox accounts from configuration | `secrets-keys` | B | yes |
| AT-US-128-02 | US-128 (DC) | Missing secret disables the account | `secrets-keys` | B | yes |
| AT-US-128-03 | US-128 (DC) | Start-up fails for an enabled account lacking its secret | `secrets-keys` | B | yes |
| AT-US-128-04 | US-128 (DC) | Secrets never leak | `secrets-keys` | B | yes |
| AT-US-128-05 | US-128 (DC) | Only Mock keeps the system usable | `secrets-keys` | B | yes |
| AT-US-128-06 | US-128 (DC) | Permission denied on the status listing | `rbac-matrix` | B+A* | yes |
| AT-US-128-07 | US-128 (DC) | Unauthenticated listing | `rbac-matrix` | B+A* | yes |
| AT-US-129-01 | US-129 | Token reused until 60 s before expiry | `secrets-keys` | B | yes |
| AT-US-129-02 | US-129 | Single in-flight refresh | `secrets-keys` | B | yes |
| AT-US-129-03 | US-129 | 401 triggers one retry with a new token | `rbac-matrix` | B+A* | yes |
| AT-US-129-04 | US-129 | Persistent 401 does not loop | `rbac-matrix` | B+A* | yes |
| AT-US-129-05 | US-129 | Token never logged | `secrets-keys` | B | yes |
| AT-US-129-06 | US-129 | Token endpoint rejects the credentials | `carrier-resilience` | B | yes |
| AT-US-129-07 | US-129 | FedEx token endpoint 403 starts a carrier-wide cool-down (policy carrier-cooldown) | `carrier-resilience` | B | yes |
| AT-US-129-08 | US-129 | UPS token endpoint 403 on account A leaves accounts B and C working (policy account-negative-cache, SEC-TC-68 UPS case) | `carrier-resilience` | B | yes |
| AT-US-129-09 | US-129 | Token requests are rate-limited per carrier | `carrier-resilience` | B | yes |
| AT-US-129-10 | US-129 | Missing expires_in is never cached | `secrets-keys` | B | yes |
| AT-US-130-01 | US-130 | Timeout per operation | `carrier-resilience` | B | yes |
| AT-US-130-02 | US-130 | Idempotent operation is retried with backoff | `idempotency` | B | yes |
| AT-US-130-03 | US-130 | Non-idempotent operations are never retried | `idempotency` | B | yes |
| AT-US-130-04 | US-130 | Retries stop at the overall deadline | `carrier-resilience` | B | yes |
| AT-US-130-05 | US-130 | Breaker opens on failure ratio | `carrier-resilience` | B | yes |
| AT-US-130-06 | US-130 | Breaker opens on consecutive failures and half-opens | `carrier-resilience` | B | yes |
| AT-US-130-07 | US-130 | Two bulkhead pools per account | `carrier-resilience` | B | yes |
| AT-US-130-08 | US-130 | Hung rate calls do not delay createShipment | `carrier-resilience` | B | yes |
| AT-US-130-09 | US-130 | Rates pool overflow waits and then yields CARRIER_BUSY | `carrier-resilience` | B | yes |
| AT-US-130-10 | US-130 | Transactional pool overflow | `carrier-resilience` | B | yes |
| AT-US-130-11 | US-130 | Pool metrics are exposed | `carrier-resilience` | B | yes |
| AT-US-130-12 | US-130 | Breakers are independent per account | `carrier-resilience` | B | yes |
| AT-US-131-01 | US-131 (DC) | Rates from fixtures | `carrier-contract` | A | yes |
| AT-US-131-02 | US-131 (DC) | Full required-operation set | `carrier-contract` | A | yes |
| AT-US-131-03 | US-131 (DC) | Carrier validation error is normalised | `carrier-contract` | A | yes |
| AT-US-131-04 | US-131 (DC) | Carrier timeout | `carrier-contract` | A | yes |
| AT-US-131-05 | US-131 (DC) | Authentication failure | `carrier-contract` | A | yes |
| AT-US-131-06 | US-131 (DC) | Credentials absent | `carrier-contract` | A | yes |
| AT-US-131-07 | US-131 (DC) | Permission path | `carrier-contract` | A | yes |
| AT-US-131-08 | US-131 (DC) | Audit of booking-time call | `audit-generator` | B+A* | yes |
| AT-US-131-09 | US-131 (DC) | Live sandbox label (COND-SANDBOX-DEMO) | `contract-live` | opt-in | no (COND-SANDBOX-DEMO) |
| AT-US-132-01 | US-132 (DC) | Rates from fixtures | `carrier-contract` | A | yes |
| AT-US-132-02 | US-132 (DC) | Full required-operation set | `carrier-contract` | A | yes |
| AT-US-132-03 | US-132 (DC) | No SOAP | `carrier-contract` | A | yes |
| AT-US-132-04 | US-132 (DC) | Token expiry mid-call | `carrier-contract` | A | yes |
| AT-US-132-05 | US-132 (DC) | Carrier refuses cancellation | `carrier-contract` | A | yes |
| AT-US-132-06 | US-132 (DC) | Rate-limited by carrier | `rate-limit` | B | yes |
| AT-US-132-07 | US-132 (DC) | Permission path | `carrier-contract` | A | yes |
| AT-US-132-08 | US-132 (DC) | Audit of booking-time call | `audit-generator` | B+A* | yes |
| AT-US-132-09 | US-132 (DC) | Live sandbox label (COND-SANDBOX-DEMO) | `contract-live` | opt-in | no (COND-SANDBOX-DEMO) |
| AT-US-133-01 | US-133 (DC) | Rates from fixtures | `carrier-contract` | A | yes |
| AT-US-133-02 | US-133 (DC) | Full required-operation set | `carrier-contract` | A | yes |
| AT-US-133-03 | US-133 (DC) | No legacy XML | `carrier-contract` | A | yes |
| AT-US-133-04 | US-133 (DC) | Unknown tracking number | `carrier-contract` | A | yes |
| AT-US-133-05 | US-133 (DC) | Invalid address | `carrier-contract` | A | yes |
| AT-US-133-06 | US-133 (DC) | Permission path | `carrier-contract` | A | yes |
| AT-US-133-07 | US-133 (DC) | Audit of booking-time call | `audit-generator` | B+A* | yes |
| AT-US-133-08 | US-133 (DC) | Live sandbox label (COND-SANDBOX-DEMO) | `contract-live` | opt-in | no (COND-SANDBOX-DEMO) |
| AT-US-134-01 | US-134 | Identical request is served from cache | `carrier-resilience` | B | yes |
| AT-US-134-02 | US-134 | Expiry after 300 s | `carrier-resilience` | B | yes |
| AT-US-134-03 | US-134 | Metric and imperial entry share a key | `carrier-resilience` | B | yes |
| AT-US-134-04 | US-134 | Customer discounts are not shared | `carrier-resilience` | B | yes |
| AT-US-134-05 | US-134 | Partial or failed responses are not cached | `carrier-resilience` | B | yes |
| AT-US-134-06 | US-134 | Different Mock scenario means different key | `carrier-resilience` | B | yes |
| AT-US-135-01 | US-135 (DC) | Events arrive per carrier then complete | `api` | B | yes |
| AT-US-135-02 | US-135 (DC) | Slow carrier yields carrier_error | `api` | B | yes |
| AT-US-135-03 | US-135 (DC) | Events contain no raw carrier text or personal data | `api` | B | yes |
| AT-US-135-04 | US-135 (DC) | Fallback GET returns what has completed | `api` | B | yes |
| AT-US-135-05 | US-135 (DC) | Heartbeat | `api` | B | yes |
| AT-US-135-06 | US-135 (DC) | Wrong guest token | `api` | B | yes |
| AT-US-135-07 | US-135 (DC) | Cross-tenant stream | `abuse` | B | yes |
| AT-US-135-08 | US-135 (DC) | Role without quote:read on a claimed quote | `api` | B | yes |
| AT-US-135-09 | US-135 (DC) | Audit of the quote created by the stream request | `audit-generator` | B+A* | yes |
| AT-US-135-10 | US-135 (DC) | Opening, reopening and resuming a stream makes no carrier calls | `api` | B | yes |
| AT-US-135-11 | US-135 (DC) | Third concurrent stream from one anonymous IP is refused | `api` | B | yes |
| AT-US-135-12 | US-135 (DC) | Sixth concurrent stream for one authenticated user is refused | `api` | B | yes |
| AT-US-136-01 | US-136 | Booking payloads stored and redacted | `redaction` | B | yes |
| AT-US-136-02 | US-136 | Cancel and pickup calls are stored | `redaction` | B | yes |
| AT-US-136-03 | US-136 | Tracking event payload stored with the event | `redaction` | B | yes |
| AT-US-136-04 | US-136 | Redaction failure blocks storage | `redaction` | B | yes |
| AT-US-136-05 | US-136 | Customers cannot read raw objects | `redaction` | B | yes |
| AT-US-136-06 | US-136 | Cross-tenant | `abuse` | B | yes |
| AT-US-136-07 | US-136 | Customs truncation marker | `redaction` | B | yes |
| AT-US-136-08 | US-136 | Base64 documents are replaced by a blob reference | `redaction` | B | yes |
| AT-US-136-09 | US-136 | Property test finds no sentinel text or long base64 run in any stored object | `redaction` | B | yes |
| AT-US-136-10 | US-136 | Tracking and response payloads are allow-list redacted | `redaction` | B | yes |
| AT-US-137-01 | US-137 | Fixtures pass the shared suite | `carrier-contract` | A | yes |
| AT-US-137-02 | US-137 | Fixtures contain no secrets or real personal data | `carrier-contract` | A | yes |
| AT-US-137-03 | US-137 | Fixture with a secret fails CI | `carrier-contract` | A | yes |
| AT-US-137-04 | US-137 | README records documentation provenance | `carrier-contract` | A | yes |
| AT-US-137-05 | US-137 | README missing a field fails the docs check | `carrier-contract` | A | yes |
| AT-US-137-06 | US-137 | Live suite is skipped by default | `carrier-contract` | A | yes |
| AT-US-137-07 | US-137 | Live sandbox runs when opted in (COND-SANDBOX-DEMO) | `contract-live` | opt-in | no (COND-SANDBOX-DEMO) |
| AT-US-137-08 | US-137 | Not yet diffed by a person is allowed but reported | `carrier-contract` | A | yes |
| AT-US-293-01 | US-293 | Guest flood does not starve paid bookings | `carrier-resilience` | B | yes |
| AT-US-293-02 | US-293 | Token bucket is shared across API replicas | `carrier-resilience` | B | yes |
| AT-US-293-03 | US-293 | Anonymous callers hold at most half of the rates slots | `carrier-resilience` | B | yes |
| AT-US-293-04 | US-293 | Exhaustion raises one security event per minute and a reject counter | `carrier-resilience` | B | yes |
| AT-US-293-05 | US-293 | Verified users' quotes are unaffected by the anonymous budget | `carrier-resilience` | B | yes |
| AT-US-293-06 | US-293 | An unverified signed-in user is an anonymous caller for the carrier budget | `carrier-resilience` | B | yes |
| AT-US-293-07 | US-293 | One organisation cannot use more than its share of an account's daily quota | `carrier-resilience` | B | yes |
| AT-US-293-08 | US-293 | The organisation share resets with the day counter and is off when the guard is off | `carrier-resilience` | B | yes |
| AT-US-293-09 | US-293 | Anonymous fan-out stops at 60 percent of the daily quota | `carrier-resilience` | B | yes |
| AT-US-293-10 | US-293 | Quota pressure alarms fire once at 70 and once at 90 percent | `carrier-resilience` | B | yes |
| AT-US-293-11 | US-293 | Above 90 percent only transactional calls continue | `carrier-resilience` | B | yes |
| AT-US-293-12 | US-293 | Guard is disabled with a quota of zero | `carrier-resilience` | B | yes |
| AT-US-293-13 | US-293 | Counter resets at 00:00 UTC | `carrier-resilience` | B | yes |
| AT-US-293-14 | US-293 | Usage is exposed as a gauge | `carrier-resilience` | B | yes |
| AT-US-293-15 | US-293 | Redis unavailable falls back to per-instance counting | `carrier-resilience` | B | yes |

## EPIC-07 ([stories/EPIC-07-pricing-engine.md](../../01-requirements/stories/EPIC-07-pricing-engine.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-138-01 | US-138 (DC) | Identical inputs give byte-identical output | `pricing-properties` | A | yes |
| AT-US-138-02 | US-138 (DC) | Lint forbids impure imports | `pricing-properties` | A | yes |
| AT-US-138-03 | US-138 (DC) | Percentage rounding half away from zero | `pricing-properties` | A | yes |
| AT-US-138-04 | US-138 (DC) | No floating point on money | `pricing-properties` | A | yes |
| AT-US-138-05 | US-138 (DC) | Mixed currencies without FX step | `pricing-properties` | A | yes |
| AT-US-138-06 | US-138 (DC) | Currency exponents | `pricing-properties` | A | yes |
| AT-US-139-01 | US-139 (DC) | Volumetric weight exceeds actual | `unit` | A | yes |
| AT-US-139-02 | US-139 (DC) | Actual exceeds volumetric and rounds up to increment | `unit` | A | yes |
| AT-US-139-03 | US-139 (DC) | Sum over packages | `unit` | A | yes |
| AT-US-139-04 | US-139 (DC) | Imperial uses divisor 139 and 1 lb increment | `unit` | A | yes |
| AT-US-139-05 | US-139 (DC) | Metric and imperial parity | `unit` | A | yes |
| AT-US-139-06 | US-139 (DC) | Invalid dimension | `unit` | A | yes |
| AT-US-140-01 | US-140 (DC) | Mock cost priced with 15% margin | `unit` | A | yes |
| AT-US-140-02 | US-140 (DC) | Output is itemised | `unit` | A | yes |
| AT-US-140-03 | US-140 (DC) | Missing default rule fails | `unit` | A | yes |
| AT-US-140-04 | US-140 (DC) | Zero carrier cost | `unit` | A | yes |
| AT-US-140-05 | US-140 (DC) | Specific rule overrides the default | `unit` | A | yes |
| AT-US-141-01 | US-141 | Priority beats specificity | `unit` | A | yes |
| AT-US-141-02 | US-141 | Specificity ordering at equal priority | `unit` | A | yes |
| AT-US-141-03 | US-141 | Later effective-from breaks specificity ties | `unit` | A | yes |
| AT-US-141-04 | US-141 | Rule key breaks the final tie | `unit` | A | yes |
| AT-US-141-05 | US-141 | Non-matching rule is rejected and counted | `unit` | A | yes |
| AT-US-141-06 | US-141 | Rule order independence | `unit` | A | yes |
| AT-US-141-07 | US-141 | Expired date range | `unit` | A | yes |
| AT-US-142-01 | US-142 | Fuel on discounted base freight | `unit` | A | yes |
| AT-US-142-02 | US-142 | Carrier already includes fuel | `unit` | A | yes |
| AT-US-142-03 | US-142 | No matching fuel row | `unit` | A | yes |
| AT-US-142-04 | US-142 | Pass-through at cost, no margin | `unit` | A | yes |
| AT-US-142-05 | US-142 | Margin on surcharges flag | `unit` | A | yes |
| AT-US-142-06 | US-142 | Unmapped surcharge | `unit` | A | yes |
| AT-US-142-07 | US-142 | Overlapping fuel ranges are invalid | `unit` | A | yes |
| AT-US-143-01 | US-143 | Per-kilogram term | `unit` | A | yes |
| AT-US-143-02 | US-143 | Percentage term | `unit` | A | yes |
| AT-US-143-03 | US-143 | Fixed term in another currency | `unit` | A | yes |
| AT-US-143-04 | US-143 | Cover line does not alter totals | `unit` | A | yes |
| AT-US-143-05 | US-143 | Missing liability term | `unit` | A | yes |
| AT-US-146-01 | US-146 | Stackable set wins | `unit` | A | yes |
| AT-US-146-02 | US-146 | Non-stackable wins | `unit` | A | yes |
| AT-US-146-03 | US-146 | Additive, not compounded | `unit` | A | yes |
| AT-US-146-04 | US-146 | Discount cannot exceed base freight | `unit` | A | yes |
| AT-US-146-05 | US-146 | Fixed amount discounts | `unit` | A | yes |
| AT-US-146-06 | US-146 | No eligible discount | `unit` | A | yes |
| AT-US-147-01 | US-147 | Tax-exclusive display | `unit` | A | yes |
| AT-US-147-02 | US-147 | Tax-inclusive display | `unit` | A | yes |
| AT-US-147-03 | US-147 | Zero-rated line | `unit` | A | yes |
| AT-US-147-04 | US-147 | Origin decides, not destination | `unit` | A | yes |
| AT-US-147-05 | US-147 | Unreviewed pack flag | `unit` | A | yes |
| AT-US-147-06 | US-147 | Missing pack for origin | `unit` | A | yes |
| AT-US-147-07 | US-147 | Rounding per line | `unit` | A | yes |
| AT-US-148-01 | US-148 | Carrier cost in INR sold in USD | `unit` | A | yes |
| AT-US-148-02 | US-148 | Same currency needs no conversion | `unit` | A | yes |
| AT-US-148-03 | US-148 | Missing pair | `unit` | A | yes |
| AT-US-148-04 | US-148 | Stale snapshot warns but does not block | `unit` | A | yes |
| AT-US-148-05 | US-148 | Snapshot at 30 days is not stale | `unit` | A | yes |
| AT-US-148-06 | US-148 | Sell currency by origin | `unit` | A | yes |
| AT-US-149-01 | US-149 | Ordered immutable lines with totals | `unit` | A | yes |
| AT-US-149-02 | US-149 | Sums reconcile | `unit` | A | yes |
| AT-US-149-03 | US-149 | Explanation of rules | `unit` | A | yes |
| AT-US-149-04 | US-149 | Labels are keys | `unit` | A | yes |
| AT-US-149-05 | US-149 | No negative total | `unit` | A | yes |
| AT-US-149-06 | US-149 | Unknown line source rejected | `unit` | A | yes |
| AT-US-150-01 | US-150 (DC) | Snapshot stored with hash and versions | `integration` | B | yes |
| AT-US-150-02 | US-150 (DC) | Later rule change does not alter a booked price | `integration` | B | yes |
| AT-US-150-03 | US-150 (DC) | Update attempt is denied and audited | `audit-generator` | B+A* | yes |
| AT-US-150-04 | US-150 (DC) | Delete attempt is denied and audited | `audit-generator` | B+A* | yes |
| AT-US-150-05 | US-150 (DC) | Hash verifies integrity | `integration` | B | yes |
| AT-US-150-06 | US-150 (DC) | Role without shipment:read | `integration` | B | yes |
| AT-US-150-07 | US-150 (DC) | Cross-tenant | `abuse` | B | yes |
| AT-US-151-01 | US-151 | Required properties run | `pricing-properties` | A | yes |
| AT-US-151-02 | US-151 | Coverage gate | `pricing-properties` | A | yes |
| AT-US-151-03 | US-151 | Coverage below gate fails the build | `pricing-properties` | A | yes |
| AT-US-151-04 | US-151 | Failing property gives a reproducible seed | `pricing-properties` | A | yes |
| AT-US-151-05 | US-151 | Case count below minimum | `pricing-properties` | A | yes |
| AT-US-152-01 | US-152 | Load and record version | `integration` | B | yes |
| AT-US-152-02 | US-152 | Loading is idempotent | `integration` | B | yes |
| AT-US-152-03 | US-152 | Validation rejects bad seeds | `integration` | B | yes |
| AT-US-152-04 | US-152 | Published seed cannot be edited in place | `integration` | B | yes |
| AT-US-152-05 | US-152 | New version takes effect for new quotes only | `integration` | B | yes |
| AT-US-152-06 | US-152 | Seed values match ASSUMED defaults | `integration` | B | yes |

## EPIC-08 ([stories/EPIC-08-quote-and-comparison.md](../../01-requirements/stories/EPIC-08-quote-and-comparison.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-154-01 | US-154 (DC) | Mock quote stored with expiry | `api` | B | yes |
| AT-US-154-02 | US-154 (DC) | First Mock result within 1.5 s | `api` | B | yes |
| AT-US-154-03 | US-154 (DC) | Quote is separate from shipments | `api` | B | yes |
| AT-US-154-04 | US-154 (DC) | Expiry is derived from time | `api` | B | yes |
| AT-US-154-05 | US-154 (DC) | TTL is configuration | `api` | B | yes |
| AT-US-154-06 | US-154 (DC) | Quote prices never change | `api` | B | yes |
| AT-US-154-07 | US-154 (DC) | Cross-tenant read | `abuse` | B | yes |
| AT-US-154-08 | US-154 (DC) | Role without quote:read | `api` | B | yes |
| AT-US-154-09 | US-154 (DC) | Audit of creation and view | `audit-generator` | B+A* | yes |
| AT-US-155-01 | US-155 (DC) | Guest creates and reads a quote | `api` | B | yes |
| AT-US-155-02 | US-155 (DC) | Wrong token | `api` | B | yes |
| AT-US-155-03 | US-155 (DC) | Missing token | `api` | B | yes |
| AT-US-155-04 | US-155 (DC) | Per-minute limit | `api` | B | yes |
| AT-US-155-05 | US-155 (DC) | Per-hour limit | `api` | B | yes |
| AT-US-155-06 | US-155 (DC) | Different IP is not limited | `api` | B | yes |
| AT-US-155-07 | US-155 (DC) | Idempotent creation | `idempotency` | B | yes |
| AT-US-155-08 | US-155 (DC) | Token does not leak | `api` | B | yes |
| AT-US-155-09 | US-155 (DC) | Audit of anonymous creation | `audit-generator` | B+A* | yes |
| AT-US-155-10 | US-155 (DC) | Guest access token stops being honoured 7 days after quote expiry | `api` | B | yes |
| AT-US-155-11 | US-155 (DC) | Per-IP limits are the first line and the anonymous carrier budget applies on top | `api` | B | yes |
| AT-US-156-01 | US-156 (DC) | Valid parcel input | `api` | B | yes |
| AT-US-156-02 | US-156 (DC) | Postcode missing where the country requires it | `api` | B | yes |
| AT-US-156-03 | US-156 (DC) | Postcode pattern invalid | `api` | B | yes |
| AT-US-156-04 | US-156 (DC) | Domestic quote | `api` | B | yes |
| AT-US-156-05 | US-156 (DC) | Package count boundaries | `api` | B | yes |
| AT-US-156-06 | US-156 (DC) | Weight and dimension boundaries | `api` | B | yes |
| AT-US-156-07 | US-156 (DC) | Pound and inch equivalents | `api` | B | yes |
| AT-US-156-08 | US-156 (DC) | Unsupported country | `api` | B | yes |
| AT-US-156-09 | US-156 (DC) | Exceeding every service | `api` | B | yes |
| AT-US-156-10 | US-156 (DC) | Some services excluded with reasons | `api` | B | yes |
| AT-US-156-11 | US-156 (DC) | Document limit | `api` | B | yes |
| AT-US-156-12 | US-156 (DC) | Anonymous may create; no deny path for quote:create | `api` | B | yes |
| AT-US-157-01 | US-157 | Default units by origin | `e2e` | B | yes |
| AT-US-157-02 | US-157 | Toggle converts to the same physical size | `e2e` | B | yes |
| AT-US-157-03 | US-157 | Live weights | `e2e` | B | yes |
| AT-US-157-04 | US-157 | Invalid value | `e2e` | B | yes |
| AT-US-157-05 | US-157 | Toggle does not alter a saved quote | `e2e` | B | yes |
| AT-US-157-06 | US-157 | Permission path (anonymous allowed) | `e2e` | B | yes |
| AT-US-157-07 | US-157 | UI standard for the widget weights (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-158-01 | US-158 (DC) | Form is in the HTML | `e2e` | B | yes |
| AT-US-158-02 | US-158 (DC) | LCP budget | `e2e` | B | yes |
| AT-US-158-03 | US-158 (DC) | Slow JavaScript | `e2e` | B | yes |
| AT-US-158-04 | US-158 (DC) | Results routes are client-rendered | `e2e` | B | yes |
| AT-US-158-05 | US-158 (DC) | Validation errors are localised | `e2e` | B | yes |
| AT-US-158-06 | US-158 (DC) | Submitting offline | `e2e` | B | yes |
| AT-US-158-07 | US-158 (DC) | Permission path (public page) | `e2e` | B | yes |
| AT-US-158-08 | US-158 (DC) | UI standard for the home page (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-159-01 | US-159 (DC) | Card content | `e2e` | B | yes |
| AT-US-159-02 | US-159 (DC) | Printer not required only when offered | `e2e` | B | yes |
| AT-US-159-03 | US-159 (DC) | Cut-off countdown | `e2e` | B | yes |
| AT-US-159-04 | US-159 (DC) | Itemised breakdown on demand | `e2e` | B | yes |
| AT-US-159-05 | US-159 (DC) | No client recomputation | `e2e` | B | yes |
| AT-US-159-06 | US-159 (DC) | Stale FX flag | `e2e` | B | yes |
| AT-US-159-07 | US-159 (DC) | Expired quote | `e2e` | B | yes |
| AT-US-159-08 | US-159 (DC) | Wrong guest token | `e2e` | B | yes |
| AT-US-159-09 | US-159 (DC) | Role without quote:read | `e2e` | B | yes |
| AT-US-159-10 | US-159 (DC) | UI standard for cards and breakdown (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-160-01 | US-160 (DC) | Results appear per carrier with skeletons | `e2e` | B | yes |
| AT-US-160-02 | US-160 (DC) | Timeout gives inline notice and banner | `e2e` | B | yes |
| AT-US-160-03 | US-160 (DC) | All carriers fail | `e2e` | B | yes |
| AT-US-160-04 | US-160 (DC) | No services match | `e2e` | B | yes |
| AT-US-160-05 | US-160 (DC) | SSE blocked | `e2e` | B | yes |
| AT-US-160-06 | US-160 (DC) | Offline | `e2e` | B | yes |
| AT-US-160-07 | US-160 (DC) | Wrong guest token and role without quote:read | `e2e` | B | yes |
| AT-US-160-08 | US-160 (DC) | UI standard for progressive results (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-161-01 | US-161 (DC) | Default sort is best value | `e2e` | B | yes |
| AT-US-161-02 | US-161 (DC) | Cheapest and fastest sorts with ties | `e2e` | B | yes |
| AT-US-161-03 | US-161 (DC) | Best-value tie-break by carrier code | `e2e` | B | yes |
| AT-US-161-04 | US-161 (DC) | Badges and shared badge | `e2e` | B | yes |
| AT-US-161-05 | US-161 (DC) | Provisional badges | `e2e` | B | yes |
| AT-US-161-06 | US-161 (DC) | Re-sort on arrival does not move focus | `e2e` | B | yes |
| AT-US-161-07 | US-161 (DC) | Invalid sort parameter | `e2e` | B | yes |
| AT-US-161-08 | US-161 (DC) | Permission path | `e2e` | B | yes |
| AT-US-161-09 | US-161 (DC) | UI standard for sort and badges (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-166-01 | US-166 (DC) | Claim at step 1 | `rls-cross-tenant` | B+A* | yes |
| AT-US-166-02 | US-166 (DC) | Guest token stops working | `rls-cross-tenant` | B+A* | yes |
| AT-US-166-03 | US-166 (DC) | Claimed by a different organisation | `rls-cross-tenant` | B+A* | yes |
| AT-US-166-04 | US-166 (DC) | Claim is idempotent for the same organisation | `idempotency` | B | yes |
| AT-US-166-05 | US-166 (DC) | Concurrent claims | `rls-cross-tenant` | B+A* | yes |
| AT-US-166-06 | US-166 (DC) | Unauthenticated claim attempt | `rls-cross-tenant` | B+A* | yes |
| AT-US-166-07 | US-166 (DC) | Cross-tenant read after claim | `rls-cross-tenant` | B+A* | yes |
| AT-US-166-08 | US-166 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-167-01 | US-167 | Booking from an expired quote is refused | `e2e` | B | yes |
| AT-US-167-02 | US-167 | One-action re-quote with price difference | `e2e` | B | yes |
| AT-US-167-03 | US-167 | Service no longer returned | `e2e` | B | yes |
| AT-US-167-04 | US-167 | Re-quote with carrier timeout | `e2e` | B | yes |
| AT-US-167-05 | US-167 | Re-quote rate-limited | `e2e` | B | yes |
| AT-US-167-06 | US-167 | Cross-tenant re-quote | `abuse` | B | yes |
| AT-US-167-07 | US-167 | Role without quote:create | `e2e` | B | yes |
| AT-US-167-08 | US-167 | Audit | `audit-generator` | B+A* | yes |
| AT-US-167-09 | US-167 | UI standard for the re-quote screen (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-168-01 | US-168 | Weight change | `api` | B | yes |
| AT-US-168-02 | US-168 | Each rate-relevant field | `api` | B | yes |
| AT-US-168-03 | US-168 | Non-rate change | `api` | B | yes |
| AT-US-168-04 | US-168 | Same value re-saved | `api` | B | yes |
| AT-US-168-05 | US-168 | Invalid new input | `api` | B | yes |
| AT-US-168-06 | US-168 | Cross-tenant draft | `abuse` | B | yes |
| AT-US-168-07 | US-168 | Role without shipment:create | `api` | B | yes |
| AT-US-168-08 | US-168 | Audit | `audit-generator` | B+A* | yes |

## EPIC-09 ([stories/EPIC-09-booking-wizard-customs-basket.md](../../01-requirements/stories/EPIC-09-booking-wizard-customs-basket.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-171-01 | US-171 (DC) | Selected option survives registration and verification | `e2e` | B | yes |
| AT-US-171-02 | US-171 (DC) | Saving step 1 without a session is rejected | `e2e` | B | yes |
| AT-US-171-03 | US-171 (DC) | Quote already claimed by another organisation | `abuse` | B | yes |
| AT-US-171-04 | US-171 (DC) | Viewer cannot start a booking | `e2e` | B | yes |
| AT-US-171-05 | US-171 (DC) | Claim is audited | `audit-generator` | B+A* | yes |
| AT-US-171-06 | US-171 (DC) | Unverified user can continue the wizard | `e2e` | B | yes |
| AT-US-172-01 | US-172 (DC) | First save of step 1 creates a DRAFT | `api` | B | yes |
| AT-US-172-02 | US-172 (DC) | Resume at the first incomplete step on another device | `api` | B | yes |
| AT-US-172-03 | US-172 (DC) | Server-side validation overrides client validation | `api` | B | yes |
| AT-US-172-04 | US-172 (DC) | Stale save from a second tab | `api` | B | yes |
| AT-US-172-05 | US-172 (DC) | Another organisation's draft | `abuse` | B | yes |
| AT-US-172-06 | US-172 (DC) | Viewer cannot edit, unauthenticated cannot read | `rbac-matrix` | B+A* | yes |
| AT-US-172-07 | US-172 (DC) | Draft mutations are audited | `audit-generator` | B+A* | yes |
| AT-US-173-01 | US-173 (DC) | Direction is derived from origin and destination (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |
| AT-US-173-02 | US-173 (DC) | Content type and package type are stored | `unit` | A | yes |
| AT-US-173-03 | US-173 (DC) | Unknown package type is rejected | `unit` | A | yes |
| AT-US-173-04 | US-173 (DC) | Missing content type is rejected | `unit` | A | yes |
| AT-US-173-05 | US-173 (DC) | Unauthenticated creation is refused | `unit` | A | yes |
| AT-US-173-06 | US-173 (DC) | Viewer creation is refused | `unit` | A | yes |
| AT-US-173-07 | US-173 (DC) | Direction is part of the creation audit entry | `audit-generator` | B+A* | yes |
| AT-US-174-01 | US-174 (DC) | Phone layout shows one step per screen | `e2e` | B | yes |
| AT-US-174-02 | US-174 (DC) | Desktop layout shows sections with a sticky price summary | `e2e` | B | yes |
| AT-US-174-03 | US-174 (DC) | Back navigation keeps entered data | `e2e` | B | yes |
| AT-US-174-04 | US-174 (DC) | Step jump beyond the first incomplete step is refused | `e2e` | B | yes |
| AT-US-174-05 | US-174 (DC) | Draft of another organisation or no session | `abuse` | B | yes |
| AT-US-174-06 | US-174 (DC) | Viewer sees permission-denied state | `e2e` | B | yes |
| AT-US-174-07 | US-174 (DC) | UI standard | `e2e` | B | yes |
| AT-US-175-01 | US-175 (DC) | Complete step 1 by typing | `e2e` | B | yes |
| AT-US-175-02 | US-175 (DC) | Select a party from the address book | `e2e` | B | yes |
| AT-US-175-03 | US-175 (DC) | Save entered receiver to the address book | `e2e` | B | yes |
| AT-US-175-04 | US-175 (DC) | Phone not in E.164 format | `e2e` | B | yes |
| AT-US-175-05 | US-175 (DC) | A fourth address line is rejected | `e2e` | B | yes |
| AT-US-175-06 | US-175 (DC) | Role without address book manage cannot save to the book | `e2e` | B | yes |
| AT-US-175-07 | US-175 (DC) | Cross-tenant address book entry | `abuse` | B | yes |
| AT-US-175-08 | US-175 (DC) | Step 1 save is audited without personal values | `audit-generator` | B+A* | yes |
| AT-US-175-09 | US-175 (DC) | UI standard | `e2e` | B | yes |
| AT-US-176-01 | US-176 | Valid US to IN addresses pass | `api` | B | yes |
| AT-US-176-02 | US-176 | Postcode pattern violation | `api` | B | yes |
| AT-US-176-03 | US-176 | Required state missing | `api` | B | yes |
| AT-US-176-04 | US-176 | Field longer than the strictest carrier limit | `api` | B | yes |
| AT-US-176-05 | US-176 | Country differs from the selected quote option | `api` | B | yes |
| AT-US-176-06 | US-176 | Client and server share the rules | `api` | B | yes |
| AT-US-176-07 | US-176 | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-177-01 | US-177 | US to IN requires a receiver reference | `api` | B | yes |
| AT-US-177-02 | US-177 | Well-formed reference completes the step | `api` | B | yes |
| AT-US-177-03 | US-177 | Malformed reference | `api` | B | yes |
| AT-US-177-04 | US-177 | Lane with no requirement | `api` | B | yes |
| AT-US-177-05 | US-177 | Value never leaks | `api` | B | yes |
| AT-US-177-06 | US-177 | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-180-01 | US-180 (DC) | PARCEL US to IN shows the customs section | `e2e` | B | yes |
| AT-US-180-02 | US-180 (DC) | Domestic parcel needs no customs | `e2e` | B | yes |
| AT-US-180-03 | US-180 (DC) | Intra-EU parcel needs no customs | `e2e` | B | yes |
| AT-US-180-04 | US-180 (DC) | DOCUMENT shipment shows the declaration instead | `e2e` | B | yes |
| AT-US-180-05 | US-180 (DC) | Description length | `e2e` | B | yes |
| AT-US-180-06 | US-180 (DC) | Permission paths | `e2e` | B | yes |
| AT-US-180-07 | US-180 (DC) | Step save is audited | `audit-generator` | B+A* | yes |
| AT-US-180-08 | US-180 (DC) | UI standard | `e2e` | B | yes |
| AT-US-181-01 | US-181 (DC) | Valid line and calculated declared value | `api` | B | yes |
| AT-US-181-02 | US-181 (DC) | Reason for export is mandatory | `api` | B | yes |
| AT-US-181-03 | US-181 (DC) | Line limits (outline: one test per Examples row, suffix -<row>) | `api` | B | yes |
| AT-US-181-04 | US-181 (DC) | Fifty-first line | `api` | B | yes |
| AT-US-181-05 | US-181 (DC) | Mixed currencies | `api` | B | yes |
| AT-US-181-06 | US-181 (DC) | Net weights exceed package weight | `api` | B | yes |
| AT-US-181-07 | US-181 (DC) | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-181-08 | US-181 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-181-09 | US-181 (DC) | UI standard | `e2e` | B | yes |
| AT-US-182-01 | US-182 (DC) | Keyword search | `api` | B | yes |
| AT-US-182-02 | US-182 (DC) | Selecting a result fills the line | `api` | B | yes |
| AT-US-182-03 | US-182 (DC) | Query too short | `api` | B | yes |
| AT-US-182-04 | US-182 (DC) | Code format (outline: one test per Examples row, suffix -<row>) | `api` | B | yes |
| AT-US-182-05 | US-182 (DC) | Length not accepted by the destination pack | `api` | B | yes |
| AT-US-182-06 | US-182 (DC) | Search is public, validation requires permission | `rbac-matrix` | B+A* | yes |
| AT-US-182-07 | US-182 (DC) | Locales | `e2e` | B | yes |
| AT-US-183-01 | US-183 | Inline prohibited match blocks continuation | `api` | B | yes |
| AT-US-183-02 | US-183 | Server enforces when the client check is bypassed | `api` | B | yes |
| AT-US-183-03 | US-183 | Restricted match needs acknowledgement | `api` | B | yes |
| AT-US-183-04 | US-183 | Match rules | `api` | B | yes |
| AT-US-183-05 | US-183 | Carrier list applies | `api` | B | yes |
| AT-US-183-06 | US-183 | Clean text | `api` | B | yes |
| AT-US-183-07 | US-183 | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-183-08 | US-183 | Audit | `audit-generator` | B+A* | yes |
| AT-US-183-09 | US-183 | UI standard | `e2e` | B | yes |
| AT-US-184-01 | US-184 | Attestation recorded | `api` | B | yes |
| AT-US-184-02 | US-184 | Booking blocked without attestation | `api` | B | yes |
| AT-US-184-03 | US-184 | Applies to documents and domestic shipments | `api` | B | yes |
| AT-US-184-04 | US-184 | Screening status is explicit | `api` | B | yes |
| AT-US-184-05 | US-184 | Other screening values are unreachable in M1 | `api` | B | yes |
| AT-US-184-06 | US-184 | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-184-07 | US-184 | Audit | `audit-generator` | B+A* | yes |
| AT-US-186-01 | US-186 (DC) | SALE produces a commercial invoice | `integration` | B | yes |
| AT-US-186-02 | US-186 (DC) | Other reasons produce a pro-forma invoice (outline: one test per Examples row, suffix -<row>) | `integration` | B | yes |
| AT-US-186-03 | US-186 (DC) | Carrier-returned customs document is stored | `integration` | B | yes |
| AT-US-186-04 | US-186 (DC) | Shipment without customs data | `integration` | B | yes |
| AT-US-186-05 | US-186 (DC) | Other organisation cannot read the invoice | `abuse` | B | yes |
| AT-US-186-06 | US-186 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-186-07 | US-186 (DC) | Identity reference printed in full only for a FULL type (REQ-COMP-001, D-051) | `integration` | B | yes |
| AT-US-186-08 | US-186 (DC) | Identity reference of a MASKED type is printed masked | `integration` | B | yes |
| AT-US-186-09 | US-186 (DC) | Document carrying a FULL reference is classified SENSITIVE | `integration` | B | yes |
| AT-US-186-10 | US-186 (DC) | Decrypted reference exists only in the render DTO (sentinel test) | `integration` | B | yes |
| AT-US-186-11 | US-186 (DC) | API keeps returning the masked value (REQ-BOOK-008) | `integration` | B | yes |
| AT-US-187-01 | US-187 | Mapping passes the contract suite | `carrier-contract` | A | yes |
| AT-US-187-02 | US-187 | Over-long description is truncated, full text kept | `carrier-contract` | A | yes |
| AT-US-187-03 | US-187 | Missing mandatory carrier field | `carrier-contract` | A | yes |
| AT-US-187-04 | US-187 | Carrier rejects customs data | `carrier-contract` | A | yes |
| AT-US-189-01 | US-189 (DC) | Pickup chosen | `e2e` | B | yes |
| AT-US-189-02 | US-189 (DC) | Drop-off offered only when supported | `e2e` | B | yes |
| AT-US-189-03 | US-189 (DC) | Switching clears the other mode's data | `e2e` | B | yes |
| AT-US-189-04 | US-189 (DC) | Unsupported mode via API | `e2e` | B | yes |
| AT-US-189-05 | US-189 (DC) | Permission paths | `e2e` | B | yes |
| AT-US-189-06 | US-189 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-189-07 | US-189 (DC) | UI standard | `e2e` | B | yes |
| AT-US-191-01 | US-191 (DC) | Review shows everything | `e2e` | B | yes |
| AT-US-191-02 | US-191 (DC) | Edit an earlier step | `e2e` | B | yes |
| AT-US-191-03 | US-191 (DC) | Editing a rate-relevant field re-quotes | `e2e` | B | yes |
| AT-US-191-04 | US-191 (DC) | Incomplete earlier step | `e2e` | B | yes |
| AT-US-191-05 | US-191 (DC) | Expired quote | `e2e` | B | yes |
| AT-US-191-06 | US-191 (DC) | Permission paths | `e2e` | B | yes |
| AT-US-191-07 | US-191 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-191-08 | US-191 (DC) | UI standard | `e2e` | B | yes |
| AT-US-192-01 | US-192 (DC) | Shipment joins the open order | `api` | B | yes |
| AT-US-192-02 | US-192 (DC) | Eleventh shipment refused | `api` | B | yes |
| AT-US-192-03 | US-192 (DC) | Mixed currency refused | `api` | B | yes |
| AT-US-192-04 | US-192 (DC) | Another organisation's order | `abuse` | B | yes |
| AT-US-192-05 | US-192 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-195-01 | US-195 (DC) | Booked order with a pickup | `e2e` | B | yes |
| AT-US-195-02 | US-195 (DC) | Documents still generating | `e2e` | B | yes |
| AT-US-195-03 | US-195 (DC) | Drop-off shipment | `e2e` | B | yes |
| AT-US-195-04 | US-195 (DC) | Pickup failed | `e2e` | B | yes |
| AT-US-195-05 | US-195 (DC) | Page reachable later | `e2e` | B | yes |
| AT-US-195-06 | US-195 (DC) | Permission paths | `e2e` | B | yes |
| AT-US-195-07 | US-195 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-195-08 | US-195 (DC) | UI standard | `e2e` | B | yes |

## EPIC-10 ([stories/EPIC-10-payments-booking-saga.md](../../01-requirements/stories/EPIC-10-payments-booking-saga.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-197-01 | US-197 (DC) | Permitted transitions succeed (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |
| AT-US-197-02 | US-197 (DC) | Illegal transitions are rejected unchanged (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |
| AT-US-197-03 | US-197 (DC) | Exhaustive matrix | `unit` | A | yes |
| AT-US-197-04 | US-197 (DC) | State cannot be set directly through the API | `unit` | A | yes |
| AT-US-197-05 | US-197 (DC) | Cancel needs the permission | `unit` | A | yes |
| AT-US-197-06 | US-197 (DC) | Concurrent transitions | `unit` | A | yes |
| AT-US-198-01 | US-198 (DC) | Every transition writes history and audit together | `audit-generator` | B+A* | yes |
| AT-US-198-02 | US-198 (DC) | Triggers (outline: one test per Examples row, suffix -<row>) | `audit-generator` | B+A* | yes |
| AT-US-198-03 | US-198 (DC) | Audit write failure rolls the transition back | `audit-generator` | B+A* | yes |
| AT-US-198-04 | US-198 (DC) | History is append-only | `audit-generator` | B+A* | yes |
| AT-US-198-05 | US-198 (DC) | Timeline read permission | `rbac-matrix` | B+A* | yes |
| AT-US-199-01 | US-199 (DC) | Mock is the default without a Stripe key | `payments-webhooks` | B | yes |
| AT-US-199-02 | US-199 (DC) | Token selects a deterministic outcome (outline: one test per Examples row, suffix -<row>) | `payments-webhooks` | B | yes |
| AT-US-199-03 | US-199 (DC) | Every state-changing call carries money and an idempotency key | `payments-webhooks` | B | yes |
| AT-US-199-04 | US-199 (DC) | Repeating a call with the same key returns the same result | `payments-webhooks` | B | yes |
| AT-US-199-05 | US-199 (DC) | Partial capture | `payments-webhooks` | B | yes |
| AT-US-199-06 | US-199 (DC) | Mock tokens are rejected in production | `payments-webhooks` | B | yes |
| AT-US-199-07 | US-199 (DC) | Contract suite | `payments-webhooks` | B | yes |
| AT-US-200-01 | US-200 (DC) | Record created with history | `integration` | B | yes |
| AT-US-200-02 | US-200 (DC) | DR-B27 transitions (outline: one test per Examples row, suffix -<row>) | `integration` | B | yes |
| AT-US-200-03 | US-200 (DC) | Raw payload is not stored on the row | `integration` | B | yes |
| AT-US-200-04 | US-200 (DC) | Read permission | `rbac-matrix` | B+A* | yes |
| AT-US-200-05 | US-200 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-201-01 | US-201 (DC) | Allocated when checkout starts | `integration` | B | yes |
| AT-US-201-02 | US-201 (DC) | One sequence per origin country | `integration` | B | yes |
| AT-US-201-03 | US-201 (DC) | Concurrent allocation is unique | `integration` | B | yes |
| AT-US-201-04 | US-201 (DC) | Never reused and gaps allowed | `integration` | B | yes |
| AT-US-201-05 | US-201 (DC) | Not consumed by a blocked checkout | `integration` | B | yes |
| AT-US-201-06 | US-201 (DC) | Same order keeps its number on retry | `integration` | B | yes |
| AT-US-201-07 | US-201 (DC) | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-201-08 | US-201 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-202-01 | US-202 (DC) | Happy path through the worker | `saga-fault-matrix` | B | yes |
| AT-US-202-02 | US-202 (DC) | Restarted worker resumes at the first incomplete step | `saga-fault-matrix` | B | yes |
| AT-US-202-03 | US-202 (DC) | Missing Idempotency-Key | `saga-fault-matrix` | B | yes |
| AT-US-202-04 | US-202 (DC) | Expired quote | `saga-fault-matrix` | B | yes |
| AT-US-202-05 | US-202 (DC) | Unauthenticated, Viewer and cross-tenant | `abuse` | B | yes |
| AT-US-202-06 | US-202 (DC) | Every transition is audited | `audit-generator` | B+A* | yes |
| AT-US-202-07 | US-202 (DC) | Saga deadline | `saga-fault-matrix` | B | yes |
| AT-US-203-01 | US-203 (DC) | Replay with the same key returns the same order | `idempotency` | B | yes |
| AT-US-203-02 | US-203 (DC) | Same key with a different body | `idempotency` | B | yes |
| AT-US-203-03 | US-203 (DC) | Same key while the first request is in progress | `idempotency` | B | yes |
| AT-US-203-04 | US-203 (DC) | Retry never buys a second label | `idempotency` | B | yes |
| AT-US-203-05 | US-203 (DC) | Carrier without idempotent create | `idempotency` | B | yes |
| AT-US-203-06 | US-203 (DC) | 5xx responses are not stored | `idempotency` | B | yes |
| AT-US-203-07 | US-203 (DC) | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-204-01 | US-204 | Carrier booking fails permanently | `saga-fault-matrix` | B | yes |
| AT-US-204-02 | US-204 | Capture fails after the carrier shipment exists | `saga-fault-matrix` | B | yes |
| AT-US-204-03 | US-204 | Guarantee G1 - no captured payment without a booked shipment | `saga-fault-matrix` | B | yes |
| AT-US-204-04 | US-204 | Void of the carrier shipment fails during compensation | `saga-fault-matrix` | B | yes |
| AT-US-204-05 | US-204 | Steps 4 to 6 never undo the booking | `saga-fault-matrix` | B | yes |
| AT-US-204-06 | US-204 | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-204-07 | US-204 | Audit | `audit-generator` | B+A* | yes |
| AT-US-205-01 | US-205 | Transient failure is retried with backoff | `saga-fault-matrix` | B | yes |
| AT-US-205-02 | US-205 | Retries are bounded | `saga-fault-matrix` | B | yes |
| AT-US-205-03 | US-205 | Definitive rejection | `saga-fault-matrix` | B | yes |
| AT-US-205-04 | US-205 | Ambiguous outcome on a non-idempotent carrier | `saga-fault-matrix` | B | yes |
| AT-US-205-05 | US-205 | Whole saga deadline | `saga-fault-matrix` | B | yes |
| AT-US-205-06 | US-205 | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-205-07 | US-205 | CARRIER_BUSY from the transactional bulkhead is retried without counting against transient retries | `saga-fault-matrix` | B | yes |
| AT-US-205-08 | US-205 | A quota-guard refusal is treated like CARRIER_BUSY | `saga-fault-matrix` | B | yes |
| AT-US-205-09 | US-205 | Booking succeeds once the pool frees within the deadline | `saga-fault-matrix` | B | yes |
| AT-US-205-10 | US-205 | Deadline passes while the carrier stays busy | `saga-fault-matrix` | B | yes |
| AT-US-205-11 | US-205 | Guest flood does not block a paid booking | `saga-fault-matrix` | B | yes |
| AT-US-206-01 | US-206 | Second of three bookings fails | `saga-fault-matrix` | B | yes |
| AT-US-206-02 | US-206 | Customer view | `saga-fault-matrix` | B | yes |
| AT-US-206-03 | US-206 | All fail | `saga-fault-matrix` | B | yes |
| AT-US-206-04 | US-206 | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-206-05 | US-206 | Audit | `audit-generator` | B+A* | yes |
| AT-US-207-01 | US-207 (DC) | Steps update within 2 seconds | `api` | B | yes |
| AT-US-207-02 | US-207 (DC) | Polling fallback | `api` | B | yes |
| AT-US-207-03 | US-207 (DC) | Failed step | `api` | B | yes |
| AT-US-207-04 | US-207 (DC) | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-207-05 | US-207 (DC) | UI states | `api` | B | yes |
| AT-US-208-01 | US-208 (DC) | All conditions met | `api` | B | yes |
| AT-US-208-02 | US-208 (DC) | Unverified email | `api` | B | yes |
| AT-US-208-03 | US-208 (DC) | Expired quote | `api` | B | yes |
| AT-US-208-04 | US-208 (DC) | Incomplete step | `api` | B | yes |
| AT-US-208-05 | US-208 (DC) | Prohibited item re-checked at checkout | `api` | B | yes |
| AT-US-208-06 | US-208 (DC) | Missing DG attestation | `api` | B | yes |
| AT-US-208-07 | US-208 (DC) | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-208-08 | US-208 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-208-09 | US-208 (DC) | UI standard | `e2e` | B | yes |
| AT-US-209-01 | US-209 (DC) | Amount from stored snapshots | `payments-webhooks` | B | yes |
| AT-US-209-02 | US-209 (DC) | Client amount differs | `payments-webhooks` | B | yes |
| AT-US-209-03 | US-209 (DC) | Amount below the gateway minimum | `payments-webhooks` | B | yes |
| AT-US-209-04 | US-209 (DC) | Authorise without capture, capture after carrier confirmation | `payments-webhooks` | B | yes |
| AT-US-209-05 | US-209 (DC) | Authorisation released after 30 minutes | `payments-webhooks` | B | yes |
| AT-US-209-06 | US-209 (DC) | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-209-07 | US-209 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-209-08 | US-209 (DC) | Idempotency | `payments-webhooks` | B | yes |
| AT-US-210-01 | US-210 (DC) | Test key accepted | `payments-webhooks` | B | yes |
| AT-US-210-02 | US-210 (DC) | Live key forbidden | `rbac-matrix` | B+A* | yes |
| AT-US-210-03 | US-210 (DC) | Fixture-backed by default | `payments-webhooks` | B | yes |
| AT-US-210-04 | US-210 (DC) | Live Stripe test API only when enabled | `payments-webhooks` | B | yes |
| AT-US-210-05 | US-210 (DC) | Secrets never exposed | `payments-webhooks` | B | yes |
| AT-US-210-06 | US-210 (DC) | Fixtures contain no secrets or real data | `payments-webhooks` | B | yes |
| AT-US-211-01 | US-211 | Card-number-like field rejected | `e2e-security` | B | yes |
| AT-US-211-02 | US-211 | Other card fields rejected (outline: one test per Examples row, suffix -<row>) | `e2e-security` | B | yes |
| AT-US-211-03 | US-211 | Unsupported method | `e2e-security` | B | yes |
| AT-US-211-04 | US-211 | Gateway token accepted | `e2e-security` | B | yes |
| AT-US-211-05 | US-211 | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-211-06 | US-211 | Audit | `audit-generator` | B+A* | yes |
| AT-US-212-01 | US-212 (DC) | 3DS required then completed | `payments-webhooks` | B | yes |
| AT-US-212-02 | US-212 (DC) | 3DS failed or abandoned | `payments-webhooks` | B | yes |
| AT-US-212-03 | US-212 (DC) | Declines map to canonical codes (outline: one test per Examples row, suffix -<row>) | `payments-webhooks` | B | yes |
| AT-US-212-04 | US-212 (DC) | Sixth attempt in an hour | `payments-webhooks` | B | yes |
| AT-US-212-05 | US-212 (DC) | Saved card needing 3DS | `payments-webhooks` | B | yes |
| AT-US-212-06 | US-212 (DC) | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-212-07 | US-212 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-213-01 | US-213 (DC) | Valid signed event is stored and applied | `payments-webhooks` | B | yes |
| AT-US-213-02 | US-213 (DC) | Invalid signature | `payments-webhooks` | B | yes |
| AT-US-213-03 | US-213 (DC) | Timestamp outside tolerance | `payments-webhooks` | B | yes |
| AT-US-213-04 | US-213 (DC) | Duplicate event | `payments-webhooks` | B | yes |
| AT-US-213-05 | US-213 (DC) | Webhook before the API response | `payments-webhooks` | B | yes |
| AT-US-213-06 | US-213 (DC) | Out-of-order events | `payments-webhooks` | B | yes |
| AT-US-213-07 | US-213 (DC) | Replay by event ID | `payments-webhooks` | B | yes |
| AT-US-213-08 | US-213 (DC) | Unknown event type | `payments-webhooks` | B | yes |
| AT-US-213-09 | US-213 (DC) | Live-mode event is rejected | `payments-webhooks` | B | yes |
| AT-US-213-10 | US-213 (DC) | Unknown event type is stored but never processed | `payments-webhooks` | B | yes |
| AT-US-213-11 | US-213 (DC) | Permission path | `rbac-matrix` | B+A* | yes |
| AT-US-214-01 | US-214 (DC) | Pay with a card in hosted fields | `e2e` | B | yes |
| AT-US-214-02 | US-214 (DC) | 3-D Secure challenge | `e2e` | B | yes |
| AT-US-214-03 | US-214 (DC) | Test-mode indicator | `e2e` | B | yes |
| AT-US-214-04 | US-214 (DC) | Sell currency shown | `e2e` | B | yes |
| AT-US-214-05 | US-214 (DC) | Gateway unavailable | `e2e` | B | yes |
| AT-US-214-06 | US-214 (DC) | Pay twice by double click | `e2e` | B | yes |
| AT-US-214-07 | US-214 (DC) | Permission paths | `e2e` | B | yes |
| AT-US-214-08 | US-214 (DC) | UI standard | `e2e` | B | yes |
| AT-US-214-09 | US-214 (DC) | Stripe test card with 3DS against the live Stripe test API (COND-SANDBOX-DEMO) | `e2e-live` | opt-in | no (COND-SANDBOX-DEMO) |

## EPIC-11 ([stories/EPIC-11-documents.md](../../01-requirements/stories/EPIC-11-documents.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-220-01 | US-220 (DC) | Stored document has full metadata | `integration` | B | yes |
| AT-US-220-02 | US-220 (DC) | Hash is computed over the stored bytes | `integration` | B | yes |
| AT-US-220-03 | US-220 (DC) | Private, encrypted, personal-data-free key | `integration` | B | yes |
| AT-US-220-04 | US-220 (DC) | Unknown type or status rejected (outline: one test per Examples row, suffix -<row>) | `integration` | B | yes |
| AT-US-220-05 | US-220 (DC) | Oversized document | `integration` | B | yes |
| AT-US-220-06 | US-220 (DC) | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-220-07 | US-220 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-221-01 | US-221 | Re-issue with different bytes | `integration` | B | yes |
| AT-US-221-02 | US-221 | Identical bytes create no version | `integration` | B | yes |
| AT-US-221-03 | US-221 | Latest by default, older by explicit version | `integration` | B | yes |
| AT-US-221-04 | US-221 | Unknown version | `integration` | B | yes |
| AT-US-221-05 | US-221 | Concurrent re-issue | `integration` | B | yes |
| AT-US-221-06 | US-221 | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-221-07 | US-221 | Audit | `audit-generator` | B+A* | yes |
| AT-US-222-01 | US-222 (DC) | Formats offered by origin (outline: one test per Examples row, suffix -<row>) | `integration` | B | yes |
| AT-US-222-02 | US-222 (DC) | Mock returns both formats | `integration` | B | yes |
| AT-US-222-03 | US-222 (DC) | Carrier returns one format | `integration` | B | yes |
| AT-US-222-04 | US-222 (DC) | Format choice on confirmation page and shipment detail | `integration` | B | yes |
| AT-US-222-05 | US-222 (DC) | Unsupported format requested | `integration` | B | yes |
| AT-US-222-06 | US-222 (DC) | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-222-07 | US-222 (DC) | UI standard | `e2e` | B | yes |
| AT-US-222-08 | US-222 (DC) | Real sandbox label (COND-SANDBOX-DEMO) | `e2e-live` | opt-in | no (COND-SANDBOX-DEMO) |
| AT-US-222-09 | US-222 (DC) | Offered format recovered after creation | `integration` | B | yes |
| AT-US-222-10 | US-222 (DC) | Label recovery fails | `integration` | B | yes |
| AT-US-223-01 | US-223 (DC) | Mock booking documents within 30 seconds | `jobs-resilience` | B | yes |
| AT-US-223-02 | US-223 (DC) | Deterministic job ID | `jobs-resilience` | B | yes |
| AT-US-223-03 | US-223 (DC) | Redelivery creates no duplicate | `jobs-resilience` | B | yes |
| AT-US-223-04 | US-223 (DC) | Retries with backoff then dead letter | `jobs-resilience` | B | yes |
| AT-US-223-05 | US-223 (DC) | Shipment stays BOOKED while pending or failed | `jobs-resilience` | B | yes |
| AT-US-223-06 | US-223 (DC) | Generation completes after a failure was fixed | `jobs-resilience` | B | yes |
| AT-US-223-07 | US-223 (DC) | Customers cannot enqueue generation directly | `jobs-resilience` | B | yes |
| AT-US-223-08 | US-223 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-224-01 | US-224 (DC) | List documents | `e2e` | B | yes |
| AT-US-224-02 | US-224 (DC) | Re-download later | `e2e` | B | yes |
| AT-US-224-03 | US-224 (DC) | Voided document not downloadable | `e2e` | B | yes |
| AT-US-224-04 | US-224 (DC) | Empty list | `e2e` | B | yes |
| AT-US-224-05 | US-224 (DC) | Permission paths | `e2e` | B | yes |
| AT-US-224-06 | US-224 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-224-07 | US-224 (DC) | UI standard | `e2e` | B | yes |
| AT-US-225-01 | US-225 (DC) | Authorised download | `api` | B | yes |
| AT-US-225-02 | US-225 (DC) | URL expires | `api` | B | yes |
| AT-US-225-03 | US-225 (DC) | Cross-tenant document | `abuse` | B | yes |
| AT-US-225-04 | US-225 (DC) | Missing permission | `rbac-matrix` | B+A* | yes |
| AT-US-225-05 | US-225 (DC) | Unauthenticated | `rbac-matrix` | B+A* | yes |
| AT-US-225-06 | US-225 (DC) | URL and personal data never logged | `api` | B | yes |
| AT-US-225-07 | US-225 (DC) | Specific version | `api` | B | yes |
| AT-US-225-08 | US-225 (DC) | Customer Viewer cannot download (REQ-RBAC-004, D-051) | `rbac-matrix` | B+A* | yes |
| AT-US-226-01 | US-226 | Audit entry is written before the URL | `audit-generator` | B+A* | yes |
| AT-US-226-02 | US-226 | Audit store unavailable | `audit-generator` | B+A* | yes |
| AT-US-226-03 | US-226 | Denied attempts are audited | `audit-generator` | B+A* | yes |
| AT-US-226-04 | US-226 | Email channel | `audit-generator` | B+A* | yes |
| AT-US-226-05 | US-226 | Auditor visibility | `audit-generator` | B+A* | yes |
| AT-US-226-06 | US-226 | Permission paths | `rbac-matrix` | B+A* | yes |

## EPIC-12 ([stories/EPIC-12-pickup-and-dropoff.md](../../01-requirements/stories/EPIC-12-pickup-and-dropoff.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-232-01 | US-232 (DC) | Earliest pickup date (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |
| AT-US-232-02 | US-232 (DC) | Weekend skipped | `unit` | A | yes |
| AT-US-232-03 | US-232 (DC) | Holiday is not selectable | `unit` | A | yes |
| AT-US-232-04 | US-232 (DC) | Date beyond the 14-day horizon | `unit` | A | yes |
| AT-US-232-05 | US-232 (DC) | Window validation (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |
| AT-US-232-06 | US-232 (DC) | Same-day window must start after the lead time | `unit` | A | yes |
| AT-US-232-07 | US-232 (DC) | Holiday reference data | `unit` | A | yes |
| AT-US-232-08 | US-232 (DC) | Same function as the results page | `unit` | A | yes |
| AT-US-232-09 | US-232 (DC) | Permission paths | `unit` | A | yes |
| AT-US-232-10 | US-232 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-233-01 | US-233 (DC) | Record stores local date and zone | `api` | B | yes |
| AT-US-233-02 | US-233 (DC) | Pickup address is the sender address | `api` | B | yes |
| AT-US-233-03 | US-233 (DC) | Instructions are cleaned | `api` | B | yes |
| AT-US-233-04 | US-233 (DC) | Instructions limit | `api` | B | yes |
| AT-US-233-05 | US-233 (DC) | Carrier truncation keeps the full text | `api` | B | yes |
| AT-US-233-06 | US-233 (DC) | Output is encoded | `api` | B | yes |
| AT-US-233-07 | US-233 (DC) | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-233-08 | US-233 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-234-01 | US-234 (DC) | Pick date and window | `e2e` | B | yes |
| AT-US-234-02 | US-234 (DC) | Unavailable dates are disabled with a reason | `e2e` | B | yes |
| AT-US-234-03 | US-234 (DC) | Custom window | `e2e` | B | yes |
| AT-US-234-04 | US-234 (DC) | Server rejects forced values | `e2e` | B | yes |
| AT-US-234-05 | US-234 (DC) | Permission paths | `e2e` | B | yes |
| AT-US-234-06 | US-234 (DC) | UI standard | `e2e` | B | yes |
| AT-US-235-01 | US-235 (DC) | Pickup scheduled after documents | `saga-fault-matrix` | B | yes |
| AT-US-235-02 | US-235 (DC) | Idempotent re-run | `saga-fault-matrix` | B | yes |
| AT-US-235-03 | US-235 (DC) | Carrier rejects the pickup | `saga-fault-matrix` | B | yes |
| AT-US-235-04 | US-235 (DC) | Drop-off shipments skip the step | `saga-fault-matrix` | B | yes |
| AT-US-235-05 | US-235 (DC) | Documents not ready | `saga-fault-matrix` | B | yes |
| AT-US-235-06 | US-235 (DC) | Permission path | `rbac-matrix` | B+A* | yes |
| AT-US-235-07 | US-235 (DC) | Audit | `audit-generator` | B+A* | yes |
| AT-US-236-01 | US-236 | Schedule from LABEL_READY | `api` | B | yes |
| AT-US-236-02 | US-236 | Replay | `idempotency` | B | yes |
| AT-US-236-03 | US-236 | Active pickup exists | `api` | B | yes |
| AT-US-236-04 | US-236 | Wrong state | `api` | B | yes |
| AT-US-236-05 | US-236 | Invalid date or window | `api` | B | yes |
| AT-US-236-06 | US-236 | Carrier rejects again | `api` | B | yes |
| AT-US-236-07 | US-236 | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-236-08 | US-236 | Audit | `audit-generator` | B+A* | yes |
| AT-US-237-01 | US-237 | Pickup cancelled first | `saga-fault-matrix` | B | yes |
| AT-US-237-02 | US-237 | Pickup cancel fails | `saga-fault-matrix` | B | yes |
| AT-US-237-03 | US-237 | Shipment without a pickup | `saga-fault-matrix` | B | yes |
| AT-US-237-04 | US-237 | Idempotent cancel | `saga-fault-matrix` | B | yes |
| AT-US-237-05 | US-237 | Permission paths | `rbac-matrix` | B+A* | yes |
| AT-US-237-06 | US-237 | Audit | `audit-generator` | B+A* | yes |

## EPIC-13 ([stories/EPIC-13-tracking.md](../../01-requirements/stories/EPIC-13-tracking.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-241-01 | US-241 (DC) | A known carrier code maps to a canonical status and keeps the original | `unit` | A | yes |
| AT-US-241-02 | US-241 (DC) | Every taxonomy status is reachable from a fixture event (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |
| AT-US-241-03 | US-241 (DC) | An unmapped carrier code is never dropped | `unit` | A | yes |
| AT-US-241-04 | US-241 (DC) | Carrier-side CANCELLED changes no shipment state but raises an alert | `unit` | A | yes |
| AT-US-241-05 | US-241 (DC) | Event ingestion is a system job and has no user-facing route | `unit` | A | yes |
| AT-US-241-06 | US-241 (DC) | Raw payload never reaches customer responses | `unit` | A | yes |
| AT-US-242-01 | US-242 (DC) | Pickup event moves the shipment to IN_TRANSIT | `integration` | B | yes |
| AT-US-242-02 | US-242 (DC) | Walk through customs hold, out for delivery and delivered | `integration` | B | yes |
| AT-US-242-03 | US-242 (DC) | Polling the same data twice creates no duplicates | `integration` | B | yes |
| AT-US-242-04 | US-242 (DC) | Events without a carrier ID are de-duplicated by hash | `integration` | B | yes |
| AT-US-242-05 | US-242 (DC) | Out-of-order events produce a time-ordered timeline | `integration` | B | yes |
| AT-US-242-06 | US-242 (DC) | A late event after DELIVERED is stored but changes nothing | `integration` | B | yes |
| AT-US-242-07 | US-242 (DC) | An illegal transition is stored but not applied | `integration` | B | yes |
| AT-US-242-08 | US-242 (DC) | Concurrent cancel and first scan are decided by the version check | `integration` | B | yes |
| AT-US-242-09 | US-242 (DC) | Cross-tenant events cannot be attached by identifier guessing | `abuse` | B | yes |
| AT-US-243-01 | US-243 | Interval by shipment state (outline: one test per Examples row, suffix -<row>) | `jobs-resilience` | B | yes |
| AT-US-243-02 | US-243 | Polling stops in final states (outline: one test per Examples row, suffix -<row>) | `jobs-resilience` | B | yes |
| AT-US-243-03 | US-243 | Stale after 60 days without events | `jobs-resilience` | B | yes |
| AT-US-243-04 | US-243 | Carrier poll timeout does not record an event or change state | `jobs-resilience` | B | yes |
| AT-US-243-05 | US-243 | Jitter prevents synchronised polls | `jobs-resilience` | B | yes |
| AT-US-243-06 | US-243 | Poll jobs are system jobs with no HTTP surface | `jobs-resilience` | B | yes |
| AT-US-243-07 | US-243 | Polling writes no per-poll audit entry | `audit-generator` | B+A* | yes |
| AT-US-244-01 | US-244 | Due shipments are grouped per account up to the adapter maximum | `jobs-resilience` | B | yes |
| AT-US-244-02 | US-244 | Concurrency is limited to 2 calls per account | `jobs-resilience` | B | yes |
| AT-US-244-03 | US-244 | Call failure backs off without recording an event | `jobs-resilience` | B | yes |
| AT-US-244-04 | US-244 | Ten consecutive failures raise an alert | `jobs-resilience` | B | yes |
| AT-US-244-05 | US-244 | Freshly created label unknown to the carrier is pending, not an error | `jobs-resilience` | B | yes |
| AT-US-244-06 | US-244 | Persistent not-found after 48 hours raises the stale-tracking alert | `jobs-resilience` | B | yes |
| AT-US-244-07 | US-244 | Open circuit breaker skips the account | `jobs-resilience` | B | yes |
| AT-US-244-08 | US-244 | Shipments of different tenants share a batch without cross-assignment | `jobs-resilience` | B | yes |
| AT-US-245-01 | US-245 | Happy path sequence by elapsed time | `integration` | B | yes |
| AT-US-245-02 | US-245 | Each scenario ends in its expected canonical status (outline: one test per Examples row, suffix -<row>) | `integration` | B | yes |
| AT-US-245-03 | US-245 | Unknown number scenario behaves like a carrier not-found | `integration` | B | yes |
| AT-US-245-04 | US-245 | Same inputs and elapsed time give identical output | `integration` | B | yes |
| AT-US-245-05 | US-245 | Invalid directive is rejected | `integration` | B | yes |
| AT-US-245-06 | US-245 | Scenario is ignored in production mode | `integration` | B | yes |
| AT-US-247-01 | US-247 (DC) | Lookup by carrier tracking number | `api` | B | yes |
| AT-US-247-02 | US-247 (DC) | Lookup by order number lists every shipment | `api` | B | yes |
| AT-US-247-03 | US-247 (DC) | Unknown number | `api` | B | yes |
| AT-US-247-04 | US-247 (DC) | Not-yet-trackable number is indistinguishable from unknown | `api` | B | yes |
| AT-US-247-05 | US-247 (DC) | Cancelled or voided shipments are not disclosed | `api` | B | yes |
| AT-US-247-06 | US-247 (DC) | Route declares the public permission and the page is noindex | `rbac-matrix` | B+A* | yes |
| AT-US-247-07 | US-247 (DC) | Page shell is pre-rendered and result is fetched client-side | `api` | B | yes |
| AT-US-247-08 | US-247 (DC) | Audit trail records an anonymous VIEW without the number | `audit-generator` | B+A* | yes |
| AT-US-247-09 | US-247 (DC) | No existence information leaks across tenants | `api` | B | yes |
| AT-US-248-01 | US-248 (DC) | Page shows allowed fields only | `redaction` | B | yes |
| AT-US-248-02 | US-248 (DC) | Contract test on the response schema | `redaction` | B | yes |
| AT-US-248-03 | US-248 (DC) | Localised canonical descriptions (outline: one test per Examples row, suffix -<row>) | `redaction` | B | yes |
| AT-US-248-04 | US-248 (DC) | Screen states (outline: one test per Examples row, suffix -<row>) | `redaction` | B | yes |
| AT-US-248-05 | US-248 (DC) | Responsive layouts | `e2e` | B | yes |
| AT-US-248-06 | US-248 (DC) | Keyboard and accessibility | `e2e` | B | yes |
| AT-US-248-07 | US-248 (DC) | Stale estimate or missing city is handled | `redaction` | B | yes |
| AT-US-248-08 | US-248 (DC) | Anonymous visitor cannot reach authenticated detail via the public route | `redaction` | B | yes |
| AT-US-249-01 | US-249 | Requests within limits succeed with limit headers | `rate-limit` | B | yes |
| AT-US-249-02 | US-249 | 31st lookup within a minute is limited | `rate-limit` | B | yes |
| AT-US-249-03 | US-249 | 301st lookup within an hour is limited | `rate-limit` | B | yes |
| AT-US-249-04 | US-249 | Eleventh unsuccessful lookup per minute is limited | `rate-limit` | B | yes |
| AT-US-249-05 | US-249 | Successful lookups do not consume the failed-lookup budget | `rate-limit` | B | yes |
| AT-US-249-06 | US-249 | Limits are per IP | `rate-limit` | B | yes |
| AT-US-249-07 | US-249 | Limit resets after the window | `rate-limit` | B | yes |
| AT-US-249-08 | US-249 | Concurrent requests share one Redis counter | `rate-limit` | B | yes |
| AT-US-249-09 | US-249 | Limited requests are counted but audited only as security events | `audit-generator` | B+A* | yes |
| AT-US-251-01 | US-251 (DC) | Owner sees the full timeline | `api` | B | yes |
| AT-US-251-02 | US-251 (DC) | Unauthenticated request | `rbac-matrix` | B+A* | yes |
| AT-US-251-03 | US-251 (DC) | Cross-tenant request returns 404 | `abuse` | B | yes |
| AT-US-251-04 | US-251 (DC) | Role without tracking:read is denied | `rbac-matrix` | B+A* | yes |
| AT-US-251-05 | US-251 (DC) | Raw payloads are not shown | `api` | B | yes |
| AT-US-251-06 | US-251 (DC) | Audit entry for the view | `audit-generator` | B+A* | yes |
| AT-US-251-07 | US-251 (DC) | Audit unavailable fails closed for the sensitive entity | `audit-generator` | B+A* | yes |
| AT-US-251-08 | US-251 (DC) | Empty, error and stale states | `api` | B | yes |
| AT-US-251-09 | US-251 (DC) | Locales and layouts (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-251-10 | US-251 (DC) | Keyboard and axe | `e2e` | B | yes |

## EPIC-14 ([stories/EPIC-14-customer-account.md](../../01-requirements/stories/EPIC-14-customer-account.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-254-01 | US-254 (DC) | Default list is newest first with 25 rows | `api` | B | yes |
| AT-US-254-02 | US-254 (DC) | Cursor pagination walks all items without duplicates | `api` | B | yes |
| AT-US-254-03 | US-254 (DC) | Page size is capped at 100 | `api` | B | yes |
| AT-US-254-04 | US-254 (DC) | Search and filter (outline: one test per Examples row, suffix -<row>) | `api` | B | yes |
| AT-US-254-05 | US-254 (DC) | Invalid filter value | `api` | B | yes |
| AT-US-254-06 | US-254 (DC) | Search never crosses tenants | `api` | B | yes |
| AT-US-254-07 | US-254 (DC) | Unauthenticated | `rbac-matrix` | B+A* | yes |
| AT-US-254-08 | US-254 (DC) | Role without shipment:read | `api` | B | yes |
| AT-US-254-09 | US-254 (DC) | Audit entry for the list view | `audit-generator` | B+A* | yes |
| AT-US-254-10 | US-254 (DC) | Query plan uses an index | `api` | B | yes |
| AT-US-254-11 | US-254 (DC) | UI states, locales and responsive layout (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-254-12 | US-254 (DC) | Keyboard and axe | `e2e` | B | yes |
| AT-US-255-01 | US-255 (DC) | Detail shows all sections | `e2e` | B | yes |
| AT-US-255-02 | US-255 (DC) | Prices come from the stored snapshot | `e2e` | B | yes |
| AT-US-255-03 | US-255 (DC) | Payment summary requires payment:read | `e2e` | B | yes |
| AT-US-255-04 | US-255 (DC) | Unauthenticated | `e2e` | B | yes |
| AT-US-255-05 | US-255 (DC) | Cross-tenant identifier | `abuse` | B | yes |
| AT-US-255-06 | US-255 (DC) | Role without shipment:read | `e2e` | B | yes |
| AT-US-255-07 | US-255 (DC) | Audit VIEW entry | `audit-generator` | B+A* | yes |
| AT-US-255-08 | US-255 (DC) | Audit unavailable fails closed | `audit-generator` | B+A* | yes |
| AT-US-255-09 | US-255 (DC) | Documents pending then ready | `e2e` | B | yes |
| AT-US-255-10 | US-255 (DC) | Document download uses the audited download route | `audit-generator` | B+A* | yes |
| AT-US-255-11 | US-255 (DC) | Failed carrier tracking shows partial state | `e2e` | B | yes |
| AT-US-255-12 | US-255 (DC) | Locales and responsive layouts (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-255-13 | US-255 (DC) | Keyboard and axe | `e2e` | B | yes |
| AT-US-256-01 | US-256 | List drafts with step and last edit | `api` | B | yes |
| AT-US-256-02 | US-256 | Resume opens the first incomplete step | `api` | B | yes |
| AT-US-256-03 | US-256 | Delete moves the draft to CANCELLED | `api` | B | yes |
| AT-US-256-04 | US-256 | Draft expires after 30 days | `api` | B | yes |
| AT-US-256-05 | US-256 | Draft edited 29 days ago is kept | `api` | B | yes |
| AT-US-256-06 | US-256 | Expiry job is idempotent | `idempotency` | B | yes |
| AT-US-256-07 | US-256 | Cannot delete a non-draft through the draft route | `api` | B | yes |
| AT-US-256-08 | US-256 | Viewer cannot delete | `rbac-matrix` | B+A* | yes |
| AT-US-256-09 | US-256 | Unauthenticated and cross-tenant | `abuse` | B | yes |
| AT-US-256-10 | US-256 | Audit entries | `audit-generator` | B+A* | yes |
| AT-US-256-11 | US-256 | Empty state and responsive | `e2e` | B | yes |
| AT-US-257-01 | US-257 | List endpoints return only own data (outline: one test per Examples row, suffix -<row>) | `rls-cross-tenant` | B+A* | yes |
| AT-US-257-02 | US-257 | Foreign identifiers return 404 (outline: one test per Examples row, suffix -<row>) | `rls-cross-tenant` | B+A* | yes |
| AT-US-257-03 | US-257 | Unauthenticated access is rejected | `rls-cross-tenant` | B+A* | yes |
| AT-US-257-04 | US-257 | Search and filters cannot widen the tenant | `rls-cross-tenant` | B+A* | yes |
| AT-US-257-05 | US-257 | Route test fails when an account route lacks a denial case | `rls-cross-tenant` | B+A* | yes |

## EPIC-15 ([stories/EPIC-15-notifications.md](../../01-requirements/stories/EPIC-15-notifications.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-274-01 | US-274 (DC) | Accepted send | `unit` | A | yes |
| AT-US-274-02 | US-274 (DC) | Permanent rejection | `unit` | A | yes |
| AT-US-274-03 | US-274 (DC) | Temporary failure | `unit` | A | yes |
| AT-US-274-04 | US-274 (DC) | Same idempotency key sends once | `idempotency` | B | yes |
| AT-US-274-05 | US-274 (DC) | Channel enumeration is closed | `unit` | A | yes |
| AT-US-274-06 | US-274 (DC) | Contract suite runs against every adapter | `unit` | A | yes |
| AT-US-276-01 | US-276 (DC) | Non-production delivers to the catcher | `config-guards` | A | yes |
| AT-US-276-02 | US-276 (DC) | Non-production with SES is refused | `config-guards` | A | yes |
| AT-US-276-03 | US-276 (DC) | CI environment with an external relay is refused | `config-guards` | A | yes |
| AT-US-276-04 | US-276 (DC) | Catcher host cannot be a public address | `config-guards` | A | yes |
| AT-US-276-05 | US-276 (DC) | Compose brings the catcher up | `config-guards` | A | yes |
| AT-US-276-06 | US-276 (DC) | Test run asserts zero external sends | `config-guards` | A | yes |
| AT-US-277-01 | US-277 (DC) | Each event maps to exactly one template (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |
| AT-US-277-02 | US-277 (DC) | Security event variants (outline: one test per Examples row, suffix -<row>) | `unit` | A | yes |
| AT-US-277-03 | US-277 (DC) | Completeness test | `unit` | A | yes |
| AT-US-277-04 | US-277 (DC) | Unknown event | `unit` | A | yes |
| AT-US-277-05 | US-277 (DC) | Event never maps to two templates | `unit` | A | yes |
| AT-US-277-06 | US-277 (DC) | Correlation ID is carried for security mails | `unit` | A | yes |
| AT-US-278-01 | US-278 (DC) | Event creates one job | `integration` | B | yes |
| AT-US-278-02 | US-278 (DC) | Redelivered event sends once | `integration` | B | yes |
| AT-US-278-03 | US-278 (DC) | Redelivered job sends once | `integration` | B | yes |
| AT-US-278-04 | US-278 (DC) | Request path does not send mail | `integration` | B | yes |
| AT-US-278-05 | US-278 (DC) | Outbox write failure rolls back the change | `integration` | B | yes |
| AT-US-278-06 | US-278 (DC) | Different recipients get separate jobs | `integration` | B | yes |
| AT-US-278-07 | US-278 (DC) | Worker restart resumes | `integration` | B | yes |
| AT-US-279-01 | US-279 (DC) | Render all parts for a locale | `e2e` | B | yes |
| AT-US-279-02 | US-279 (DC) | Variables are HTML-escaped | `unit` | A | yes |
| AT-US-279-03 | US-279 (DC) | Locale-aware formats (outline: one test per Examples row, suffix -<row>) | `e2e` | B | yes |
| AT-US-279-04 | US-279 (DC) | Version recorded on the message | `unit` | A | yes |
| AT-US-279-05 | US-279 (DC) | New version does not change old messages | `unit` | A | yes |
| AT-US-279-06 | US-279 (DC) | Missing variable | `unit` | A | yes |
| AT-US-279-07 | US-279 (DC) | Links use the configured base URL | `unit` | A | yes |
| AT-US-279-08 | US-279 (DC) | Both bodies present | `unit` | A | yes |
| AT-US-280-01 | US-280 (DC) | Stored locale wins | `e2e` | B | yes |
| AT-US-280-02 | US-280 (DC) | Fallback to registration locale | `e2e` | B | yes |
| AT-US-280-03 | US-280 (DC) | Invitation uses the inviter's selection | `unit` | A | yes |
| AT-US-280-04 | US-280 (DC) | Fallback to en when nothing is known | `unit` | A | yes |
| AT-US-280-05 | US-280 (DC) | Unsupported locale value falls back to en | `e2e` | B | yes |
| AT-US-280-06 | US-280 (DC) | Template missing a locale part falls back to en at runtime and alerts | `e2e` | B | yes |
| AT-US-280-07 | US-280 (DC) | Locale change applies to the next email | `e2e` | B | yes |
| AT-US-281-01 | US-281 | Complete templates pass | `i18n-parity` | A | yes |
| AT-US-281-02 | US-281 | Missing part fails the build (outline: one test per Examples row, suffix -<row>) | `i18n-parity` | A | yes |
| AT-US-281-03 | US-281 | Variable missing in another locale fails the build | `e2e` | B | yes |
| AT-US-281-04 | US-281 | Extra variable in one locale fails | `e2e` | B | yes |
| AT-US-281-05 | US-281 | Check runs in CI as a required job | `i18n-parity` | A | yes |
| AT-US-281-06 | US-281 | New event without template fails the completeness test | `i18n-parity` | A | yes |
| AT-US-282-01 | US-282 (DC) | Registration sends a verification email | `integration` | B | yes |
| AT-US-282-02 | US-282 (DC) | Password reset request sends a reset email | `integration` | B | yes |
| AT-US-282-03 | US-282 (DC) | Unknown email gets no message but an identical response | `integration` | B | yes |
| AT-US-282-04 | US-282 (DC) | Security notices are sent regardless of preferences (outline: one test per Examples row, suffix -<row>) | `integration` | B | yes |
| AT-US-282-05 | US-282 (DC) | Preferences cannot suppress them | `integration` | B | yes |
| AT-US-282-06 | US-282 (DC) | Provider failure retries then dead-letters | `integration` | B | yes |
| AT-US-282-07 | US-282 (DC) | No secrets in the notification log | `integration` | B | yes |
| AT-US-282-08 | US-282 (DC) | Security mail carries the correlation ID | `integration` | B | yes |
| AT-US-282-09 | US-282 (DC) | Unauthenticated trigger routes are not rate-bypassed | `rbac-matrix` | B+A* | yes |
| AT-US-282-10 | US-282 (DC) | Audit of account-locked mail | `audit-generator` | B+A* | yes |
| AT-US-283-01 | US-283 (DC) | Confirmation arrives in the mail catcher with details | `integration` | B | yes |
| AT-US-283-02 | US-283 (DC) | Documents attached when total size is within 10 MB | `integration` | B | yes |
| AT-US-283-03 | US-283 (DC) | Documents over 10 MB become an account link | `integration` | B | yes |
| AT-US-283-04 | US-283 (DC) | Exactly 10 MB boundary | `integration` | B | yes |
| AT-US-283-05 | US-283 (DC) | Voided or superseded documents are not attached | `integration` | B | yes |
| AT-US-283-06 | US-283 (DC) | Duplicate saga delivery sends once | `integration` | B | yes |
| AT-US-283-07 | US-283 (DC) | Mail failure does not undo the booking | `integration` | B | yes |
| AT-US-283-08 | US-283 (DC) | Documents still pending | `integration` | B | yes |
| AT-US-283-09 | US-283 (DC) | Only the booking user receives it | `integration` | B | yes |
| AT-US-283-10 | US-283 (DC) | Email content excludes sensitive data | `integration` | B | yes |
| AT-US-283-11 | US-283 (DC) | Attachment access is not an unaudited download bypass | `integration` | B | yes |
| AT-US-283-12 | US-283 (DC) | Unauthenticated access to attachments | `rbac-matrix` | B+A* | yes |
| AT-US-283-13 | US-283 (DC) | SENSITIVE document is excluded from attachments (REQ-NOTIF-008, D-051) | `integration` | B | yes |
| AT-US-283-14 | US-283 (DC) | Label and pickup confirmation stay attached | `integration` | B | yes |
| AT-US-283-15 | US-283 (DC) | No SENSITIVE document leaves attachment behaviour unchanged | `integration` | B | yes |
| AT-US-284-01 | US-284 (DC) | Success on first attempt | `jobs-resilience` | B | yes |
| AT-US-284-02 | US-284 (DC) | Transient failure then success | `jobs-resilience` | B | yes |
| AT-US-284-03 | US-284 (DC) | Retries exhausted go to the dead-letter queue | `jobs-resilience` | B | yes |
| AT-US-284-04 | US-284 (DC) | Permanent rejection is not retried | `jobs-resilience` | B | yes |
| AT-US-284-05 | US-284 (DC) | Job ID is the idempotency key | `jobs-resilience` | B | yes |
| AT-US-284-06 | US-284 (DC) | Worker crash mid-send does not duplicate | `jobs-resilience` | B | yes |
| AT-US-284-07 | US-284 (DC) | Dead-lettered message is visible in the user log | `jobs-resilience` | B | yes |
| AT-US-284-08 | US-284 (DC) | Alert fires on dead-letter | `jobs-resilience` | B | yes |
| AT-US-285-01 | US-285 | Shipment events go to the booking user | `integration` | B | yes |
| AT-US-285-02 | US-285 | Receiver and sender are never addressed | `integration` | B | yes |
| AT-US-285-03 | US-285 | Invitation goes only to the invited address | `integration` | B | yes |
| AT-US-285-04 | US-285 | Authentication events go to the account | `integration` | B | yes |
| AT-US-285-05 | US-285 | Booking user removed from the organisation | `integration` | B | yes |
| AT-US-285-06 | US-285 | Addresses in variables cannot redirect mail | `integration` | B | yes |
| AT-US-285-07 | US-285 | Static check | `integration` | B | yes |

## EPIC-16 ([stories/EPIC-16-api-conventions-security.md](../../01-requirements/stories/EPIC-16-api-conventions-security.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-034-01 | US-034 (DC) | Consistent contract passes | `contract-openapi` | A | yes |
| AT-US-034-02 | US-034 (DC) | Contract drift fails CI (outline: one test per Examples row, suffix -<row>) | `contract-openapi` | A | yes |
| AT-US-034-03 | US-034 (DC) | Version prefix | `contract-openapi` | A | yes |
| AT-US-034-04 | US-034 (DC) | Response deviating from the contract fails the test | `contract-openapi` | A | yes |
| AT-US-034-05 | US-034 (DC) | Problem+json bodies are validated too | `contract-openapi` | A | yes |
| AT-US-036-01 | US-036 | Errors are problem+json with derived type | `api` | B | yes |
| AT-US-036-02 | US-036 | All validation failures are reported | `api` | B | yes |
| AT-US-036-03 | US-036 | Error list is capped | `api` | B | yes |
| AT-US-036-04 | US-036 | Uncatalogued error fails the test suite | `api` | B | yes |
| AT-US-036-05 | US-036 | Catalogue is complete and stable | `api` | B | yes |
| AT-US-036-06 | US-036 | Permission-denied errors use the catalogue | `rbac-matrix` | B+A* | yes |
| AT-US-037-01 | US-037 | First page and next page | `api` | B | yes |
| AT-US-037-02 | US-037 | Equal sort keys are stable | `api` | B | yes |
| AT-US-037-03 | US-037 | Invalid pagination input (outline: one test per Examples row, suffix -<row>) | `api` | B | yes |
| AT-US-037-04 | US-037 | Filter and sort allow-lists (outline: one test per Examples row, suffix -<row>) | `api` | B | yes |
| AT-US-037-05 | US-037 | Filters combine with AND and sort applies | `api` | B | yes |
| AT-US-037-06 | US-037 | Totals are opt-in | `api` | B | yes |
| AT-US-037-07 | US-037 | Bounded reference list allows a larger page | `api` | B | yes |
| AT-US-037-08 | US-037 | Tenant lists cannot raise the cap | `api` | B | yes |
| AT-US-037-09 | US-037 | List route without pagination fails the contract test | `api` | B | yes |
| AT-US-037-10 | US-037 | Cursor cannot cross tenants | `api` | B | yes |
| AT-US-038-01 | US-038 (DC) | Replay returns the stored response with no new effect | `idempotency` | B | yes |
| AT-US-038-02 | US-038 (DC) | Key required on booking | `idempotency` | B | yes |
| AT-US-038-03 | US-038 (DC) | Invalid key format | `idempotency` | B | yes |
| AT-US-038-04 | US-038 (DC) | Same key, different body | `idempotency` | B | yes |
| AT-US-038-05 | US-038 (DC) | Concurrent duplicate | `idempotency` | B | yes |
| AT-US-038-06 | US-038 (DC) | Server errors and rate limits are not stored | `rate-limit` | B | yes |
| AT-US-038-07 | US-038 (DC) | 4xx responses are replayed | `idempotency` | B | yes |
| AT-US-038-08 | US-038 (DC) | Keys are scoped to the caller | `idempotency` | B | yes |
| AT-US-038-09 | US-038 (DC) | Expiry | `idempotency` | B | yes |
| AT-US-039-01 | US-039 | ETag on single-resource GET and conditional GET | `api` | B | yes |
| AT-US-039-02 | US-039 | Update with matching If-Match | `api` | B | yes |
| AT-US-039-03 | US-039 | Missing If-Match | `api` | B | yes |
| AT-US-039-04 | US-039 | Stale If-Match | `api` | B | yes |
| AT-US-039-05 | US-039 | No-op update | `api` | B | yes |
| AT-US-039-06 | US-039 | Cross-tenant resource | `abuse` | B | yes |
| AT-US-039-07 | US-039 | Concurrent updates | `api` | B | yes |
| AT-US-040-01 | US-040 | Limit headers on limited routes | `rate-limit` | B | yes |
| AT-US-040-02 | US-040 | Exceeding the limit | `rate-limit` | B | yes |
| AT-US-040-03 | US-040 | Class-specific limits (outline: one test per Examples row, suffix -<row>) | `rate-limit` | B | yes |
| AT-US-040-04 | US-040 | Authenticated quote creation is the quote-create class, not the authenticated class | `rate-limit` | B | yes |
| AT-US-040-05 | US-040 | Counters are shared across instances | `rate-limit` | B | yes |
| AT-US-040-06 | US-040 | Per-IP limit is applied before authentication | `rate-limit` | B | yes |
| AT-US-040-07 | US-040 | Refresh, logout and CSRF are in the public class | `rate-limit` | B | yes |
| AT-US-040-08 | US-040 | Spoofed X-Forwarded-For is ignored | `rate-limit` | B | yes |
| AT-US-040-09 | US-040 | Redis down | `rate-limit` | B | yes |
| AT-US-040-10 | US-040 | Rate-limit hit on auth routes is a security event | `rate-limit` | B | yes |
| AT-US-040-11 | US-040 | Limits apply per user, not shared between users | `rate-limit` | B | yes |
| AT-US-040-12 | US-040 | Unauthenticated route class used when no principal | `rbac-matrix` | B+A* | yes |
| AT-US-040-13 | US-040 | Registration is counted in both the auth and the email-send class | `rate-limit` | B | yes |
| AT-US-040-14 | US-040 | Sixth distinct address from one IP is a registration probe | `rate-limit` | B | yes |
| AT-US-040-15 | US-040 | Concurrent quote SSE streams are capped (outline: one test per Examples row, suffix -<row>) | `rate-limit` | B | yes |
| AT-US-040-16 | US-040 | Closing a stream frees its slot | `rate-limit` | B | yes |
| AT-US-040-17 | US-040 | Rate-limit headers use the three draft-06 names | `rate-limit` | B | yes |
| AT-US-041-01 | US-041 | Conforming representations | `api` | B | yes |
| AT-US-041-02 | US-041 | Non-integer money fails the contract test | `api` | B | yes |
| AT-US-041-03 | US-041 | Floating-point rate is rejected | `api` | B | yes |
| AT-US-041-04 | US-041 | Invalid input formats (outline: one test per Examples row, suffix -<row>) | `api` | B | yes |
| AT-US-041-05 | US-041 | Date-only values are not converted | `api` | B | yes |
| AT-US-042-01 | US-042 (DC) | Stream format | `api` | B | yes |
| AT-US-042-02 | US-042 (DC) | Completion closes the stream | `api` | B | yes |
| AT-US-042-03 | US-042 (DC) | Fatal error | `api` | B | yes |
| AT-US-042-04 | US-042 (DC) | Heartbeat | `api` | B | yes |
| AT-US-042-05 | US-042 (DC) | Maximum duration | `api` | B | yes |
| AT-US-042-06 | US-042 (DC) | Client abort cancels upstream work | `api` | B | yes |
| AT-US-042-07 | US-042 (DC) | Unauthenticated stream | `rbac-matrix` | B+A* | yes |
| AT-US-042-08 | US-042 (DC) | Events contain no personal data | `api` | B | yes |
| AT-US-043-01 | US-043 | Headers present on API and both Nginx images (outline: one test per Examples row, suffix -<row>) | `headers` | B | yes |
| AT-US-043-02 | US-043 | CSP content | `headers` | B | yes |
| AT-US-043-03 | US-043 | Inline script is blocked | `headers` | B | yes |
| AT-US-043-04 | US-043 | Violation report endpoint | `headers` | B | yes |
| AT-US-043-05 | US-043 | HSTS and HTTPS redirect | `headers` | B | yes |
| AT-US-043-06 | US-043 | ZAP baseline | `headers` | B | yes |
| AT-US-044-01 | US-044 | Valid cookie-authenticated request | `csrf-cookie` | B+A* | yes |
| AT-US-044-02 | US-044 | CSRF rejection (outline: one test per Examples row, suffix -<row>) | `csrf-cookie` | B+A* | yes |
| AT-US-044-03 | US-044 | Bearer endpoints are exempt | `csrf-cookie` | B+A* | yes |
| AT-US-044-04 | US-044 | Allowed origin receives credentials headers | `csrf-cookie` | B+A* | yes |
| AT-US-044-05 | US-044 | Unlisted origin gets no CORS headers | `csrf-cookie` | B+A* | yes |
| AT-US-044-06 | US-044 | Wildcard with credentials is impossible | `csrf-cookie` | B+A* | yes |
| AT-US-044-07 | US-044 | Unauthenticated caller hitting refresh | `csrf-cookie` | B+A* | yes |
| AT-US-045-01 | US-045 | Unknown and server-controlled fields are rejected (outline: one test per Examples row, suffix -<row>) | `abuse` | B | yes |
| AT-US-045-02 | US-045 | Unknown query and path parameters | `abuse` | B | yes |
| AT-US-045-03 | US-045 | Body size | `abuse` | B | yes |
| AT-US-045-04 | US-045 | Content type | `abuse` | B | yes |
| AT-US-045-05 | US-045 | Request timeout | `abuse` | B | yes |
| AT-US-045-06 | US-045 | Mass assignment attempt by a customer user | `abuse` | B | yes |
| AT-US-045-07 | US-045 | Unauthenticated mass assignment | `abuse` | B | yes |
| AT-US-046-01 | US-046 | Unsafe code is rejected (outline: one test per Examples row, suffix -<row>) | `sec-static` | A | yes |
| AT-US-046-02 | US-046 | Allowed usage passes | `sec-static` | A | yes |
| AT-US-046-03 | US-046 | Validators agree on samples | `sec-static` | A | yes |
| AT-US-046-04 | US-046 | Parity drift fails | `sec-static` | A | yes |
| AT-US-046-05 | US-046 | Limits come from one place | `sec-static` | A | yes |
| AT-US-047-01 | US-047 | Allow-listed https host succeeds | `ssrf` | B | yes |
| AT-US-047-02 | US-047 | Blocked destinations (outline: one test per Examples row, suffix -<row>) | `ssrf` | B | yes |
| AT-US-047-03 | US-047 | DNS rebinding to a private address | `ssrf` | B | yes |
| AT-US-047-04 | US-047 | Redirect leaving the allow-list | `ssrf` | B | yes |
| AT-US-047-05 | US-047 | Response size cap | `ssrf` | B | yes |
| AT-US-047-06 | US-047 | SSRF block is a security event | `ssrf` | B | yes |
| AT-US-047-07 | US-047 | Other security events are emitted (outline: one test per Examples row, suffix -<row>) | `ssrf` | B | yes |
| AT-US-047-08 | US-047 | Permission path | `rbac-matrix` | B+A* | yes |
| AT-US-048-01 | US-048 | Clean repository passes | `sec-static` | A | yes |
| AT-US-048-02 | US-048 | Config key missing from .env.example | `sec-static` | A | yes |
| AT-US-048-03 | US-048 | Placeholders only | `sec-static` | A | yes |
| AT-US-048-04 | US-048 | Committed secret is detected | `sec-static` | A | yes |
| AT-US-048-05 | US-048 | Production refuses placeholder secrets | `sec-static` | A | yes |
| AT-US-048-06 | US-048 | Findings gate the pipeline (outline: one test per Examples row, suffix -<row>) | `sec-static` | A | yes |
| AT-US-048-07 | US-048 | Waiver | `sec-static` | A | yes |

## EPIC-17 ([stories/EPIC-17-reference-data-compliance-packs.md](../../01-requirements/stories/EPIC-17-reference-data-compliance-packs.md))

| Test ID | Story | Scenario | Suite | Lane | G3 |
|---|---|---|---|---|---|
| AT-US-049-01 | US-049 (DC) | Seed twice yields identical counts | `integration` | B | yes |
| AT-US-049-02 | US-049 (DC) | Compose runs the seed automatically | `integration` | B | yes |
| AT-US-049-03 | US-049 (DC) | Demo seed is skipped in production | `integration` | B | yes |
| AT-US-049-04 | US-049 (DC) | Non-local environment with a default seed password aborts (outline: one test per Examples row, suffix -<row>) | `integration` | B | yes |
| AT-US-049-05 | US-049 (DC) | Local environment accepts the defaults | `integration` | B | yes |
| AT-US-049-06 | US-049 (DC) | Missing SEED variable | `integration` | B | yes |
| AT-US-049-07 | US-049 (DC) | Passwords never printed | `integration` | B | yes |
| AT-US-049-08 | US-049 (DC) | Natural-key upsert corrects drift | `integration` | B | yes |
| AT-US-049-09 | US-049 (DC) | Staging seed creates staff without passwords (REQ-DATA-002, D-052) | `integration` | B | yes |
| AT-US-049-10 | US-049 (DC) | Local and test environments keep the seeded-password flow (outline: one test per Examples row, suffix -<row>) | `integration` | B | yes |
| AT-US-050-01 | US-050 (DC) | Users and organisations exist | `integration` | B | yes |
| AT-US-050-02 | US-050 (DC) | Seeded accounts are usable | `integration` | B | yes |
| AT-US-050-03 | US-050 (DC) | Mock carrier and pricing are present | `integration` | B | yes |
| AT-US-050-04 | US-050 (DC) | Re-seeding does not duplicate or reset enrolled TOTP | `integration` | B | yes |
| AT-US-050-05 | US-050 (DC) | Seeded customer cannot reach admin | `integration` | B | yes |
| AT-US-050-06 | US-050 (DC) | Seeded roles hold only their matrix permissions | `rbac-matrix` | B+A* | yes |
| AT-US-050-07 | US-050 (DC) | Seed writes audit entries as system actor | `audit-generator` | B+A* | yes |
| AT-US-051-01 | US-051 (DC) | Countries are complete | `integration` | B | yes |
| AT-US-051-02 | US-051 (DC) | Launch-country postcode formats (outline: one test per Examples row, suffix -<row>) | `integration` | B | yes |
| AT-US-051-03 | US-051 (DC) | Shipping-enabled set | `integration` | B | yes |
| AT-US-051-04 | US-051 (DC) | Non-enabled country cannot be selected | `integration` | B | yes |
| AT-US-051-05 | US-051 (DC) | Regions | `integration` | B | yes |
| AT-US-051-06 | US-051 (DC) | Missing translation falls back and is flagged | `integration` | B | yes |
| AT-US-051-07 | US-051 (DC) | Countries without a curated postcode format | `integration` | B | yes |
| AT-US-051-08 | US-051 (DC) | Reference data is not editable at runtime | `integration` | B | yes |
| AT-US-052-01 | US-052 (DC) | Currencies seeded | `integration` | B | yes |
| AT-US-052-02 | US-052 (DC) | Unknown currency rejected | `integration` | B | yes |
| AT-US-052-03 | US-052 (DC) | FX snapshot rows | `integration` | B | yes |
| AT-US-052-04 | US-052 (DC) | Latest snapshot at or before the request time | `integration` | B | yes |
| AT-US-052-05 | US-052 (DC) | Rates are never edited in place | `integration` | B | yes |
| AT-US-052-06 | US-052 (DC) | Re-seed does not create duplicates | `integration` | B | yes |
| AT-US-052-07 | US-052 (DC) | No snapshot before the request time | `integration` | B | yes |
| AT-US-053-01 | US-053 (DC) | Localised countries without authentication | `api` | B | yes |
| AT-US-053-02 | US-053 (DC) | Conditional request | `api` | B | yes |
| AT-US-053-03 | US-053 (DC) | Fallback locale | `e2e` | B | yes |
| AT-US-053-04 | US-053 (DC) | Unknown dataset | `api` | B | yes |
| AT-US-053-05 | US-053 (DC) | Read-only | `api` | B | yes |
| AT-US-053-06 | US-053 (DC) | Rate limited per IP | `rate-limit` | B | yes |
| AT-US-053-07 | US-053 (DC) | Pagination of large datasets | `api` | B | yes |
| AT-US-053-08 | US-053 (DC) | Not audited | `audit-generator` | B+A* | yes |
| AT-US-054-01 | US-054 (DC) | Holidays | `integration` | B | yes |
| AT-US-054-02 | US-054 (DC) | Transit days | `integration` | B | yes |
| AT-US-054-03 | US-054 (DC) | HS search | `integration` | B | yes |
| AT-US-054-04 | US-054 (DC) | Commodity code format (outline: one test per Examples row, suffix -<row>) | `integration` | B | yes |
| AT-US-054-05 | US-054 (DC) | Reasons for export | `integration` | B | yes |
| AT-US-054-06 | US-054 (DC) | Incoterms | `integration` | B | yes |
| AT-US-054-07 | US-054 (DC) | Sample data is labelled for staff and customers | `integration` | B | yes |
| AT-US-054-08 | US-054 (DC) | Seed idempotent | `integration` | B | yes |
| AT-US-055-01 | US-055 | Lookup by country | `api` | B | yes |
| AT-US-055-02 | US-055 | Union with carrier entries | `api` | B | yes |
| AT-US-055-03 | US-055 | Localisation | `api` | B | yes |
| AT-US-055-04 | US-055 | Unsupported country | `api` | B | yes |
| AT-US-055-05 | US-055 | Missing pack | `api` | B | yes |
| AT-US-055-06 | US-055 | Invalid parameter | `api` | B | yes |
| AT-US-055-07 | US-055 | Rate limited | `rate-limit` | B | yes |
| AT-US-055-08 | US-055 | Seed covers launch lanes | `api` | B | yes |
| AT-US-056-01 | US-056 (DC) | Format | `integration` | B | yes |
| AT-US-056-02 | US-056 (DC) | Concurrency | `integration` | B | yes |
| AT-US-056-03 | US-056 (DC) | Gaps are allowed | `integration` | B | yes |
| AT-US-056-04 | US-056 (DC) | Separate sequences per country | `integration` | B | yes |
| AT-US-056-05 | US-056 (DC) | Invalid origin | `integration` | B | yes |
| AT-US-056-06 | US-056 (DC) | Invoice sequence not allocatable yet | `integration` | B | yes |
| AT-US-056-07 | US-056 (DC) | Check digit rejects typos | `integration` | B | yes |
| AT-US-056-08 | US-056 (DC) | Zone tables exist and are empty | `integration` | B | yes |
| AT-US-057-01 | US-057 | Pack structure and uniqueness | `integration` | B | yes |
| AT-US-057-02 | US-057 | Invalid section fails the seed | `integration` | B | yes |
| AT-US-057-03 | US-057 | Resolution by instant | `integration` | B | yes |
| AT-US-057-04 | US-057 | EU fallback | `integration` | B | yes |
| AT-US-057-05 | US-057 | No applicable pack | `integration` | B | yes |
| AT-US-057-06 | US-057 | Published version is immutable | `integration` | B | yes |
| AT-US-057-07 | US-057 | Change creates a new version | `integration` | B | yes |
| AT-US-057-08 | US-057 | Resolved version is recorded by consumers | `integration` | B | yes |
| AT-US-057-09 | US-057 | Party identity reference types section (REQ-COMP-001, D-051) | `integration` | B | yes |
| AT-US-057-10 | US-057 | Invalid invoice_print value fails the seed | `integration` | B | yes |
| AT-US-057-11 | US-057 | Seeded IN pack marks only the import receiver reference FULL | `integration` | B | yes |
| AT-US-057-12 | US-057 | Change to the FULL list is flagged unreviewed | `integration` | B | yes |
| AT-US-058-01 | US-058 | Packs present | `integration` | B | yes |
| AT-US-058-02 | US-058 | Tax labels as data (outline: one test per Examples row, suffix -<row>) | `integration` | B | yes |
| AT-US-058-03 | US-058 | Content completeness | `integration` | B | yes |
| AT-US-058-04 | US-058 | Audit of loads | `audit-generator` | B+A* | yes |
| AT-US-058-05 | US-058 | Re-run is a no-op | `integration` | B | yes |
| AT-US-058-06 | US-058 | Pack content cannot be changed by API | `integration` | B | yes |
| AT-US-058-07 | US-058 | Audit write failure aborts the load | `audit-generator` | B+A* | yes |
| AT-US-059-01 | US-059 | Unreviewed flag in responses | `integration` | B | yes |
| AT-US-059-02 | US-059 | Badge in staff views | `integration` | B | yes |
| AT-US-059-03 | US-059 | Tax rule input for pricing | `integration` | B | yes |
| AT-US-059-04 | US-059 | Country branches are rejected | `integration` | B | yes |
| AT-US-059-05 | US-059 | De-minimis exposure | `integration` | B | yes |
| AT-US-059-06 | US-059 | Missing pack | `integration` | B | yes |
| AT-US-059-07 | US-059 | Permission path | `rbac-matrix` | B+A* | yes |
