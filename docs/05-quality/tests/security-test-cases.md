# Security test cases SEC-TC-01..64: adoption, suites and gated stories

Version 1.0 · 2026-11-12 · owner qa-lead · status: **adopted** (all 64). Sources: `docs/03-architecture/threat-model.md` §10.2 (SEC-TC-01..36), `docs/05-quality/security/P3-architecture-security-review.md` §9 (updates to 03, 04, 09, 12, 17, 20, 26, 28, 31, 32, 34; new 37..60) and §14.5 (amended 37, 44, 53; new 61..64). Strategy context: [TEST-STRATEGY.md](../TEST-STRATEGY.md) §7.11; manifest: [required-suites.json](required-suites.json).

## Rules for every case

1. **Tagging.** Every test implementing a case carries `@security` and the case ID in its title, e.g. `it('[SEC-TC-38] @security refresh at 30 d + 1 s returns SESSION_EXPIRED', …)`. A case may need several tests (API + DB + log scan); all of them carry the ID and all must pass.
2. **Manifest.** Each case is listed in `required_cases` of its primary suite. `quality:check-evidence` fails when a required case is missing, failed or skipped, in any suite (ADR-0023 amendment G, D-QA-004).
3. **Zero skip.** No case is ever skipped, quarantined or marked `todo`. A case blocked by an unimplemented story fails the build of the wave that should deliver it, which makes the gap visible.
4. **Conditional cases (D-QA-011).** Some cases exercise routes that belong to Should or Could stories. If the story ships, the case tests the behaviour. If the story is not delivered in this run, the same test asserts that the route is absent from the route registry and from `openapi.yaml` (or rejected with 404), and the G3 report records "route absent" with the deferral decision ID. The condition is named per case below.
5. **Story gating.** A story listed under "Gates stories" cannot meet its DoD while the case fails. The task that implements the story (task IDs come from senior-developer's `docs/04-plan/`) includes the case in its acceptance section; the placement column follows the review's guidance (§9 "Placement").
6. **G3.** 64/64 cases present and passing in the `gate` evidence (TEST-STRATEGY.md §15 item 6). The SEC-COND conditions of the review §14.8 close on the cases named there.

Legend for **Lane**: A = hosted fast lane; A* = hosted `security-integration` on security-critical paths; B = local heavy lane (`pr` when the path rule selects the suite, always in `wave`/`gate`); C = hosted full lane.

## Cases

| ID | Test (as adopted, amendments folded in) | Type | Primary suite (+ others) | Lane | Gates stories | Plan placement | Condition / closes |
|---|---|---|---|---|---|---|---|
| SEC-TC-01 | Every route with `{orgId}`: active organisation ≠ path organisation → 404, no data | RBAC-GEN variant | `rbac-matrix` | B, A*, C | US-063, US-068, US-069, US-071 | Wave 0 (generator) | T-32, AC-06 |
| SEC-TC-02 | 5 wrong TOTP codes across 2 challenges → user `MFA_LOCKED` | API | `identity-session` | B, C | US-024, US-022 | Wave 0/1 identity | T-21 |
| SEC-TC-03 | Demo seed with `APP_ENV=staging` and defaults aborts; non-local seed creates staff without passwords; first staff enrolment outside local/test without the e-mailed code → 403 | CFG + API | `identity-session` (+ `config-guards`) | A, B | US-025, US-031, US-050 | Wave 0/1 identity + seeds | T-23, SEC-P3-14 |
| SEC-TC-04 | Idempotency: tenants A/B with the same key are isolated; two anonymous IPs with the same key on `POST /quotes` are isolated; `createQuote` and `createQuoteShare` never create an `idempotency_keys` row; stored response bodies are ciphertext; DB scan finds no stored secrets | API + DB | `idempotency` | B, C | US-038, US-155, US-203 | Wave 0 (platform) | T-79, SEC-P3-10 |
| SEC-TC-05 | Catalog: no `SECURITY DEFINER` outside the allow-list; fixed `search_path` (`pg_catalog, pg_temp`); runtime role attributes | CAT | `catalog-c1-c14` (C4, C11) | B, A*, C | US-074 | Wave 0 (catalog tests) | T-37, T-82 |
| SEC-TC-06 | Inside a tenant transaction, `actor_scope=OPERATOR` set by a non-operator → 0 foreign rows; operator policies are SELECT-only | RLS-INT | `rls-cross-tenant` | B, A*, C | US-075, US-076 | Wave 0 | T-35, T-36 |
| SEC-TC-07 | Concurrent claim of a guest quote: options visible only to the winner; guest token returns 404 afterwards | RLS-INT | `rls-cross-tenant` (+ `api`) | B, A*, C | US-080, US-166, US-171 | With US-080 (M0), re-run with US-166 | T-44 |
| SEC-TC-08 | Shared-quote projection returns only allow-listed fields; the share token is absent from logs | API + log scan | `redaction` (+ `log-scan`) | B, C | US-165 (Should) | With US-165 | T-45. **Conditional** on US-165; route-absent assertion otherwise |
| SEC-TC-09 | Refresh cookie (`__Host-rt_*`, `Path=/`, HttpOnly, Secure, SameSite=Strict) accepted by Chromium, Firefox and WebKit; CSRF token = HMAC over `session_id ‖ app`, bound and rotated at login; foreign Origin on login → 403 | E2E + API | `csrf-cookie` + `e2e-security` | B, A*, C | US-017, US-018, US-020, US-044 | Wave 0/1 identity + web shell | T-07, T-17, T-18, T-27 |
| SEC-TC-10 | Valkey stopped: a revoked access token is rejected through the DB fallback | Resilience | `resilience-deps` | B | US-019 | Wave 1 | T-20 |
| SEC-TC-11 | JWT negatives (`alg: none`, HS256, unknown `kid`, clock skew, wrong `app`); a web token cannot activate OPERATOR scope | API | `identity-session` | B, C | US-017, US-018, US-030, US-076 | Wave 0/1 identity | T-19 |
| SEC-TC-12 | 50 rps of wrong recovery codes: p95 of other routes stays within NFR-PERF-001; recovery codes are a single HMAC lookup (no bcrypt fan-out) | K6 + UNIT | `k6-abuse` (`recovery-flood`) (+ `unit`) | B wave/gate | US-023, US-024 | Wave with US-023 (k6 at wave end) | T-24 |
| SEC-TC-13 | Password re-auth is refused for the TOTP-disable scope (needs TOTP proof) | API | `identity-session` | B, C | US-291 (US-026 Should for the UI) | Wave with US-291 | T-25 |
| SEC-TC-14 | Two 100-byte passwords sharing their first 72 bytes are distinct | UNIT | `unit` | A, C | US-015 | Wave 0/1 identity | T-29 |
| SEC-TC-15 | A Viewer's denied-request flood is throttled; the audit holds ≤ N entries plus a summary entry | API | `abuse` | B, C | US-069 | Wave 0/1 | T-39 |
| SEC-TC-16 | Mixed anonymous load keeps login-failure p95 within budget; afterwards every SYSTEM shard's chain verifies | K6 + DB | `k6-abuse` (`anon-mix`) + `audit-chain` | B wave/gate | US-017, US-092 | Wave end after US-092 | T-85 |
| SEC-TC-17 | Superuser rewrites an entry and recomputes the chain → signed checkpoint mismatch detected (extended by SEC-TC-44) | RLS-INT | `audit-chain` | B, C | US-092, US-093 | Wave 0/1 audit package | T-84; **SEC-COND-03** |
| SEC-TC-18 | The audit-off profile is refused at start-up outside `APP_ENV=benchmark` | CFG | `config-guards` | A, C | US-086, US-002 | Wave 0 | T-88 |
| SEC-TC-19 | Sentinel IP, UA, reason and filter values are absent in clear from audit values; deleting a vault entry → chain still verifies and the viewer shows `[ERASED]` | AUDIT-GEN | `redaction` | B, C | US-091, US-098 | Wave 0/1 audit | T-87, AC-41 |
| SEC-TC-20 | Mandatory: the processor resolves `org_id` from PostgreSQL (`platform.job_context`); a forged BullMQ job naming a foreign `org_id` → DLQ, `job_context_mismatch`, no data access | Integration | `jobs-resilience` | B, C | US-078, US-010 | Wave 0 (worker) | T-73, SEC-P3-12 |
| SEC-TC-21 | Cancel committed before the pickup step → no `schedulePickup` call | Integration | `saga-fault-matrix` | B, C | US-235, US-237 | Wave with US-235 | T-75 |
| SEC-TC-22 | An unconfirmed `PICKED_UP` push does not block cancellation (push applied only after `track()` confirmation) | Integration | `integration` (tracking) | B, C | US-242; US-252 (Should, push), US-196 (Should, cancel) | Wave with US-242 | T-72. **Conditional** in part: with US-252 absent, the test asserts the push route is absent and the polling path never treats an unconfirmed event as terminal |
| SEC-TC-23 | `livemode: true` event rejected; `POST /payments/{id}/confirm` ignores any status in the body | API | `payments-webhooks` | B, C | US-212, US-213 | Wave with US-213 | T-52, T-67 |
| SEC-TC-24 | Production route table lacks `/webhooks/mock-gateway`; staging requires its HMAC | CFG + API | `config-guards` (+ `payments-webhooks`) | A, B | US-199, US-123 | Wave 0 (Mock gateway) | T-71 |
| SEC-TC-25 | SSRF suite: DNS rebinding, `::ffff:127.0.0.1`, `0x7f000001`, 100.64.0.1, 169.254.170.2, fd00:ec2::254, off-list redirect; Stripe traffic goes through the safe client | Integration | `ssrf` | B, C | US-047, US-210 | Wave 0 (outbound client) | T-96 |
| SEC-TC-26 | Anonymous flood from 50 IPs leaves the separate `transactional` pool available and sagas succeed during the flood; the per-IP SSE cap holds; 6 hung rate calls leave `createShipment` admitted at once | K6 + integration | `carrier-resilience` + `k6-abuse` (`wave`) | B wave/gate | US-130, US-293, US-202 | Wave with US-130/US-293 | T-46, T-47; **SEC-COND-02** |
| SEC-TC-27 | `X-Forwarded-For` spoofing, IPv6 /64 rotation and path-case variants all hit the same limiter key | API | `rate-limit` | B, C | US-040 | Wave 0 (platform) | T-11 |
| SEC-TC-28 | Share, verify, reset and invite flows (`#token=` fragment links, `POST …/resolve`) leave no token in Nginx or API logs, Referer or `history` | E2E + log scan | `e2e-security` + `log-scan` | B wave/gate | US-016, US-021; US-084 (Should, invite), US-165 (Should, share) | Wave with US-016/US-021 | T-09. **Conditional** for the invite and share flows |
| SEC-TC-29 | Authenticated responses carry `Cache-Control: private, no-store` | API helper | `api` | B, C | US-043, US-068 | Wave 0 (API helper) | T-06 |
| SEC-TC-30 | A co-member cannot list, use or delete another member's saved payment method or notification log | API | `abuse` | B, C | US-217 (Should), US-289 (Should) | With US-217 / US-289 | T-31, T-56. **Conditional** on the Should stories |
| SEC-TC-31 | 400 logs contain JSON pointers and sub-codes only, never submitted values; a `Cookie`/`Set-Cookie` sentinel is absent from Nginx, API and OTel output | Log scan | `log-scan` (+ `redaction`) | B, C | US-008, US-036 | Wave 0 (logging) | L-13, SEC-P3-23 |
| SEC-TC-32 | CI policy: actions pinned by SHA, no `pull_request_target`, read-only token; every install `--ignore-scripts`, committed `.npmrc` (`ignore-scripts=true`), 7-day cooldown, lockfile source/integrity, `npm audit signatures` | CI | `ci-policy` | A | US-005, US-048 | Wave 0 (first `npm ci`) | T-102, T-103; **SEC-COND-04** |
| SEC-TC-33 | Migration lint blocks `DROP TRIGGER`, `DISABLE ROW LEVEL SECURITY`, `BYPASSRLS`, `ALTER POLICY` (and audit DDL outside the bootstrap lane) without an approval marker | CI | `migration-lint` | A | US-074, US-094 | Wave 0 | T-108 |
| SEC-TC-34 | Compose publishes ports only on 127.0.0.1 (incl. the local edge); Mailpit and RustFS consoles are absent from non-local profiles | CFG | `config-guards` | A | US-003, US-276 | Wave 0 | T-94, T-100, SEC-P3-20 |
| SEC-TC-35 | Public-tracking audit stores HMAC values and a coarse IP | AUDIT-GEN | `audit-generator` | B, A*, C | US-247 | Wave with US-247 | L-04 |
| SEC-TC-36 | `qs` depth, parameter and array caps enforced; `__proto__` keys rejected | API fuzz | `abuse` | B, C | US-045 | Wave 0 (platform) | T-41 |
| SEC-TC-37 | (amended) Without `X-Reauth-Proof`: `createPaymentMethodSetup`, `createPaymentMethod`, `updatePaymentMethod`, `deletePaymentMethod`, `requestPrivacyExport`, `downloadPrivacyExport` → 401 `REAUTH_REQUIRED`. With `auth_time` > 12 h and no proof: `createInvitation`, `resendInvitation`, `updateMember`, `removeMember` → 401 `REAUTH_REQUIRED`; fresh login → success. Saved-card checkout with `auth_time` > 12 h → PaymentIntent `require_cvc_recollection=true`; Mock CVC `fail`/`unavailable` → payment `FAILED/AUTHENTICATION_FAILED`, authorisation voided, no saga, `cvc_recollection_failed`; `pass` → `AUTHORISED`; after `createReauthProof` the retried checkout has `cvc_recollection_required=false`; same derivation on the webhook path. The test is generated over every implemented operation with `x-reauth-scope` | API (fake clock) | `identity-session` + `payments-webhooks` | B, C | US-291 (Must); US-217, US-265 (Should, payment methods); US-083, US-085 (Should, members); US-270 (Could, export) | Wave with US-291; payment part with the payments stories | SEC-P3-01, SEC-P3-28; **SEC-COND-01, SEC-COND-06**. **Conditional** per route group; if the payment-method and membership routes do not ship with step-up, the test asserts the fallback `AUTH_REFRESH_TTL=7d` (D-046) |
| SEC-TC-38 | Customer refresh at absolute age 30 d + 1 s → 401 `SESSION_EXPIRED`; sliding refresh never extends past the absolute cap; `auth_time` unchanged by refresh | API (fake clock) | `identity-session` | B, C | US-018, US-291 | Wave 0/1 identity | SEC-P3-01; **SEC-COND-01** |
| SEC-TC-39 | Admin SPA with no input for 30 min → silent refresh stops, logout called, sign-in shown; warning at 28 min; server rejects an admin refresh token idle > 30 min; background refetch does not count as activity | E2E + API | `e2e-security` (+ `identity-session`) | B wave/gate | US-030, US-031, US-032; US-033 (Should) | Wave with US-030 | SEC-P3-11 |
| SEC-TC-40 | Guest flood from 50 IPs (Mock latency) while 20 authenticated orders book: all bookings reach `BOOKED`; guests receive `CARRIER_BUSY` or cached results; no saga step ends in DRAFT or EXCEPTION because of `CARRIER_BUSY` | K6 + integration | `k6-abuse` (`wave`) | B wave/gate | US-293, US-130, US-202 | Wave end after US-293 | SEC-P3-02; **SEC-COND-02**; NFR-RES-007 |
| SEC-TC-41 | Daily quota guard: with the counter at (100 − reserve) %, anonymous fan-out to that account stops; authenticated and transactional calls continue; `carrier_quota_pressure` emitted once at 70 % and once at 90 % | Integration | `carrier-resilience` | B, C | US-293 | Wave with US-293 | SEC-P3-02; **SEC-COND-02** |
| SEC-TC-42 | Reopening `streamQuoteResults` 10 times (incl. `Last-Event-ID`) causes 0 extra carrier calls (Mock call counter); a third concurrent stream from one IP → 429 | API | `carrier-resilience` | B, C | US-135, US-293, US-042 | Wave with US-135 | SEC-P3-02, T-47; **SEC-COND-02** |
| SEC-TC-43 | As `platform_migrator`: `ALTER TABLE audit_entries DISABLE TRIGGER ALL`, `NO FORCE ROW LEVEL SECURITY`, `DROP TRIGGER`, `DETACH PARTITION` → permission denied; the same via dynamic SQL in `DO $$ … EXECUTE …` → blocked by the identity-based event trigger; `ensure_audit_partitions()` still succeeds | RLS-INT / CAT | `audit-immutability` | B, A*, C | US-094, US-095 | Wave 0 (audit package) | SEC-P3-03; **SEC-COND-03** |
| SEC-TC-44 | (amended) The verifier holds only the public key. A tampered entry older than the last anchor, with chain and checkpoint heads recomputed as superuser → `CHECKPOINT_SIGNATURE_INVALID`; a deleted or reordered anchor → `ANCHOR_MISSING`; an anchor is written every hour; an anchor with `algorithm` ≠ `ECDSA_P256_SHA256` or unknown `key_id` → `CHECKPOINT_SIGNATURE_INVALID`; a malleated `(r, n−s)` signature written only to the table → `ANCHOR_MISSING` | Integration | `audit-chain` | B, C | US-092, US-093 | Wave 0/1 audit package | SEC-P3-03; **SEC-COND-03** |
| SEC-TC-45 | A fixture package with a marker-writing `postinstall`: after the CI, Dockerfile and `quality:heavy` installs the marker is absent; `deps:rebuild` still yields working `bcrypt`, Prisma client and Playwright; a version published < 7 days ago is rejected by the age script; a lockfile entry from a non-registry URL fails lane A | CI | `ci-policy` | A | US-005, US-048 | Wave 0 (first `npm ci`) | SEC-P3-04; **SEC-COND-04** |
| SEC-TC-46 | 6th distinct address from one IP within an hour → 429 + `registration_probe`; 4th registration for one identifier within an hour → 429 (`email-send`); responses identical for new and existing addresses (NFR-SEC-003 timing) | API | `rate-limit` + `identity-session` | B, C | US-015 | Wave 0/1 identity | SEC-P3-05 |
| SEC-TC-47 | Attacker registers `victim@`, signs in; victim redeems the verification link → attacker's next refresh 401 `SESSION_REVOKED`; account unverified for 7 days → `DEACTIVATED` and the address can register again; a successful reset sets `email_verified_at` | API (fake clock) | `identity-session` | B, C | US-016, US-021, US-292 | Wave with US-292 | SEC-P3-06 |
| SEC-TC-48 | `quality:check-evidence` FAILs on: `verdict: PASS` with a JUnit attachment showing failures; a missing required security suite; `skipped > 0` in a security suite; untracked files in code paths; any `SKIP_*` recorded; evidence older than a change to `openapi.yaml`; plus (D-QA-004) a missing `required_cases` ID and a JUnit file for a `planned` suite | CI (fixtures) | `ci-policy` | A | US-005 | Wave 0 CI | SEC-P3-07 |
| SEC-TC-49 | Config schema rejects two identical key values; every ciphertext and HMAC column has `key_id`; decrypting with a retired key works while new writes use the current key; swapping ciphertexts between two vault rows fails GCM authentication (AAD) | UNIT + integration | `secrets-keys` (+ `config-guards`, `catalog-c1-c14` C10) | A, B | US-002, US-091, US-128 | Wave 0 (config, vault) | SEC-P3-08 |
| SEC-TC-50 | After the carrier OAuth contract tests a Valkey `SCAN` finds no plaintext token pattern; job payloads in Valkey contain IDs only (schema check on every queued job during e2e) | Integration | `secrets-keys` | B, C | US-129, US-078 | Wave with US-129 | SEC-P3-08, SEC-P3-12 |
| SEC-TC-51 | Workflow policy: `secrets.CARRIER_*` and `secrets.STRIPE_*` appear only in jobs with `environment: carrier-sandbox`; no `pull_request`/`push` workflow references that environment; with `APP_ENV=staging` start-up is refused if any secret equals a placeholder | CI + CFG | `ci-policy` + `config-guards` | A | US-005, US-048, US-002 | Wave 0 CI | SEC-P3-08 |
| SEC-TC-52 | The invoice prints `FULL` only for pack-designated reference types and the masked form otherwise; `emailShipmentDocuments` for a document with a `FULL` reference sends a link, no attachment; a Viewer gets 403 + `PERMISSION_DENIED` audit on `getDocumentDownloadUrl`; raw-carrier-payload objects contain no base64 blob > 1 kB and none of the sentinel name, address or tax ID | API + UNIT + storage scan | `redaction` (+ `api`) | B, C | US-186, US-225, US-136; US-228 (Should, e-mail documents) | Wave with US-186/US-136 | SEC-P3-09, SEC-P3-13. **Conditional** for the e-mail-documents part (US-228) |
| SEC-TC-53 | (amended) Contract: `x-idempotency: not-applicable` on every ADR-0014 one-time-secret route. `createQuoteShare` twice → two different tokens, the first resolves to 404 (or 409 `SHARE_EXISTS`); no clear share token in any table; a second mint writes `CREATE` + `UPDATE quote_share` (revoked) audit entries; the 11th mint for one quote within an hour → 429; unknown, revoked and expired tokens give three byte-identical 404 bodies | Contract + API | `idempotency` (+ `contract-openapi`) | A, B | US-038, US-034; US-165 (Should, share) | Wave 0 (contract part); with US-165 (share part) | SEC-P3-10, SEC-P3-32. **Conditional** for the share part |
| SEC-TC-54 | After claim, sign-out, a 404 and an expiry sweep, `localStorage` has no `qt:` entry for that quote; app start removes expired entries and keeps ≤ 20; the token never appears in URL, `history.state`, Referer or logs; the server rejects the token 7 days after quote expiry | E2E + API | `e2e-security` | B wave/gate | US-155, US-166, US-171 | Wave with US-166 | SEC-P3-15 |
| SEC-TC-55 | Recovery code in `id-secret` form: one HMAC compare per attempt; per-code salt; the bcrypt input is `base64(HMAC(pepper, pw))` (44 characters); two 100-byte passwords sharing their first 72 bytes are distinct | UNIT | `unit` | A, C | US-015, US-023 | Wave 0/1 identity | SEC-P3-16 |
| SEC-TC-56 | A staff member's first TOTP enrolment (`APP_ENV=staging` profile) without the e-mailed code → 403; a staff account with no enrolment after 24 h → restricted | API (fake clock) | `identity-session` | B, C | US-025, US-031 | Wave 0/1 identity | SEC-P3-14 |
| SEC-TC-57 | 1,000 anonymous requests whose crafted `X-Correlation-Id` values all hash to one shard are spread over ≥ 12 of the 16 SYSTEM shards | API + DB | `audit-chain` | B, C | US-092, US-087 | Wave 0/1 audit | SEC-P3-17 |
| SEC-TC-58 | A foreign `Origin` on `loginUser`, `registerUser`, `resetPassword` or `verifyEmail` → 403 `CSRF_REJECTED`; `text/plain` bodies → 415 | API | `csrf-cookie` | B, A*, C | US-017, US-015, US-021, US-016, US-044 | Wave 0/1 identity | SEC-P3-18 |
| SEC-TC-59 | With Valkey stopped, suspending a user or removing a member → the affected access token is rejected through the DB fallback within 5 s, and refresh fails | Resilience | `resilience-deps` | B wave/gate | US-019, US-027; US-029 (Should, suspend), US-085 (Should, remove member) | Wave with US-027 | SEC-P3-19. **Conditional** for the suspend/remove triggers; with them absent, the test uses session revocation (US-027) as the trigger |
| SEC-TC-60 | A correctly signed fixture event with `livemode: true` → rejected and audited (`webhook_livemode_rejected`); an unknown event type is stored but not processed; Stripe SDK calls go through `OutboundHttpClient` (dispatcher spy) and a non-allow-listed host is blocked | API + integration | `payments-webhooks` (+ `ssrf`) | B, C | US-213, US-210 | Wave with US-210 | SEC-P3-21 |
| SEC-TC-61 | As `platform_migrator`, create `public.pg_advisory_xact_lock(integer)` and `public.to_char(date, text)` whose bodies insert a marker and try `ALTER TABLE public.audit_entries DISABLE TRIGGER ALL`; then as `platform_app` call `platform.ensure_audit_partitions(3)`: succeeds, no marker row, every audit trigger enabled. `ALTER SCHEMA public RENAME TO x` and `ALTER SCHEMA platform RENAME TO y` as the migrator both raise. C11 and C14 `proconfig` assertions pass | RLS-INT / CAT | `audit-immutability` (+ `catalog-c1-c14`) | B, A*, C | US-094, US-095 | Wave 0 (audit package) | SEC-P3-27; **SEC-COND-05** (closes SEC-COND-03 with 17/43/44) |
| SEC-TC-62 | With Mock and `CARRIER_DAILY_QUOTA=500`: an unverified account is throttled by the anonymous bucket; a verified account gets 429 from `quote-create` after 30 per minute; one organisation cannot push an account's daily usage past its 10 % share (`CARRIER_BUSY` or cached results + `carrier_quota_org_share_exhausted`), while another organisation's quotes still fan out | API + integration | `carrier-resilience` + `rate-limit` | B, C | US-293, US-155, US-040 | Wave with US-293 | SEC-P3-29; **SEC-COND-07** |
| SEC-TC-63 | Contract test: the security-event names in `packages/shared` equal the `api/README.md` §13 table, including the eight names added by SEC-P3-30 | Contract | `contract-openapi` | A, C | US-047, US-034 | Wave 0 | SEC-P3-30 |
| SEC-TC-64 | A PR fixture that edits `tools/quality/check-evidence.mjs` to always pass still fails lane A on bad evidence, because the base-ref copy ran; `deps:rebuild` with the local Prisma binary removed fails instead of downloading (`npm exec --no`) | CI | `ci-policy` | A | US-005 | Wave 0 CI | SEC-P3-31 |

## Counts

| Primary suite | Cases |
|---|---|
| `identity-session` | 02, 03, 11, 13, 37, 38, 46, 47, 56 (9) |
| `ci-policy` | 32, 45, 48, 51, 64 (5) |
| `carrier-resilience` | 26, 41, 42, 62 (4) |
| `audit-chain` | 16, 17, 44, 57 (4) |
| `k6-abuse` | 12, 16, 26, 40 (4; 16 and 26 shared) |
| `redaction` | 08, 19, 31, 52 (4) |
| `config-guards` | 03, 18, 24, 34, 49, 51 (6; shared) |
| `e2e-security` | 09, 28, 39, 54 (4) |
| `abuse` | 15, 30, 36 (3) |
| `payments-webhooks` | 23, 37, 60 (3) |
| `audit-immutability` | 43, 61 (2) |
| `rls-cross-tenant` | 06, 07 (2) |
| `csrf-cookie` | 09, 58 (2) |
| `idempotency` | 04, 53 (2) |
| `rate-limit` | 27, 46, 62 (3) |
| `ssrf` | 25, 60 (2) |
| `resilience-deps` | 10, 59 (2) |
| `secrets-keys` | 49, 50 (2) |
| `log-scan` | 28, 31 (2) |
| `contract-openapi` | 53, 63 (2) |
| `rbac-matrix` 01 · `catalog-c1-c14` 05 · `jobs-resilience` 20 · `saga-fault-matrix` 21 · `integration` 22 · `api` 29 · `audit-generator` 35 · `migration-lint` 33 · `unit` 14, 55 | 1–2 each |

Every one of the 64 IDs appears in at least one suite's `required_cases` in `required-suites.json` (checked by script on 2026-11-12: 0 missing). Conditional cases: 08, 22 (part), 28 (part), 30, 37 (part), 52 (part), 53 (part), 59 (part).

## SEC-COND closure map (review §14.8)

| Condition | Cases that must be green at G3 |
|---|---|
| SEC-COND-01 (session policy) | SEC-TC-37 (amended), SEC-TC-38 |
| SEC-COND-02 (bulkheads, anonymous budget, quota) | SEC-TC-26, 40, 41, 42 |
| SEC-COND-03 (audit tamper evidence) | SEC-TC-17, 43, 44 (amended), 61; locked sink stays a G4-production precondition |
| SEC-COND-04 (install scripts, cooldown, lockfile) | SEC-TC-32, 45 (green in Wave 0) |
| SEC-COND-05 (definer `search_path`) | SEC-TC-61 |
| SEC-COND-06 (CVC outcome) | SEC-TC-37 (amended) |
| SEC-COND-07 (unverified as anonymous, `quote-create`, org share) | SEC-TC-62 |
| Medium tasks SEC-P3-05..14 | SEC-TC-03 (ext.), 20, 39, 46–53, 56 |
| LOW/INFO new | SEC-TC-53 (amended), 63, 64 |
| LOW/INFO backlog | SEC-TC-12, 14, 22, 24, 25, 31 (ext.), 34 (ext.), 55, 57, 58, 59, 60 |
