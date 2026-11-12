# P3 Architecture Security Review (pre-G2)

| Field | Value |
|---|---|
| Document | `docs/05-quality/security/P3-architecture-security-review.md` (scope SEC-P3, architecture level) |
| Version | 1.1 (§14 remediation verification appended 2026-11-12 against commit `d5cdfa2`) |
| Date | 2026-11-12 |
| Reviewer | security-analyst (Application Security Lead) |
| Baseline | commit `b8f805f` (design documents only, no product code yet) |
| Inputs | `CLAUDE.md` §5, §9, §11; `docs/sdlc/BRIEF.md` §4.2, §4.3, §4.7–§4.11; `docs/03-architecture/threat-model.md`, `ARCHITECTURE.md`, `data-model.md` (§4 RLS, §5 audit SQL, §10.4, §12), `platform.md`, `risks.md`; ADR-0004, 0005, 0006 (amendments 1–11), 0007, 0010, 0012, 0013, 0014, 0016, 0018, 0019, 0021, 0023 (amendment A–E), 0025, 0026 (amendments 1–7); `api/openapi.yaml`, `api/README.md`; `docs/01-requirements/NFR.md` (NFR-SEC-*), `REQUIREMENTS.md` (REQ-SEC-*, REQ-AUTH-*); `docs/sdlc/DECISIONS.md` (D-024, D-038, D-045, D-ARCH-003, D-ARCH-006/007/010–013); `docs/02-ux/README.md` §5 |
| Consumers | principal-architect (owner of every architecture change below), product-manager, api-designer, data-architect, platform-architect, devops-engineer, qa-lead, quality-gatekeeper (G2) |
| Verdict | **APPROVED_WITH_CONDITIONS** |

## 1. Verdict

**APPROVED_WITH_CONDITIONS.**

At design level, the architecture meets OWASP ASVS 4.0.3 Level 2 for V1, V4, V5, V11, V12 and V13, and for most of V2, V3, V7, V8 and V14. It also honours the brief's security directives:

- RLS is forced on every tenant table, with no `BYPASSRLS` and a read-only operator branch checked in the database.
- The audit store is append-only and enforced in PostgreSQL.
- PCI SAQ A holds through Stripe Payment Element iframes.
- Credentials exist only as secret references.
- The CSP is hash-based with no `unsafe-inline`.
- The design adopted all threat-model P1 recommendations except parts of R-06, R-07, R-09 and R-21.

**No CRITICAL finding.** **Four HIGH findings remain open** (SEC-P3-01..04). Each one has a concrete required change, an owner and a due point (§3, §10). None of them requires re-architecture. They are ADR amendments, OpenAPI edits and one build-configuration rule.

Recommended gate handling: G2 may pass when SEC-COND-01..04 are tracked as G2 conditions. Each condition's design change must land before **P4 exit** (task DAG frozen), so P4 plans the work. The implementation is verified by the listed SEC-TC cases before **G3**. MEDIUM findings become tracked tasks, due before the affected story starts in P5, and are verified at G3. LOW and INFO findings go to the owning agent's backlog.

| Severity | Count | IDs |
|---|---|---|
| CRITICAL | 0 | none |
| HIGH | 4 | SEC-P3-01, 02, 03, 04 |
| MEDIUM | 10 | SEC-P3-05 .. 14 |
| LOW | 9 | SEC-P3-15 .. 23 |
| INFO | 3 | SEC-P3-24 .. 26 |

## 2. Scope and method

- **Scope.** This review covers the M0 + M1 architecture as documented at `b8f805f`: the API, worker, web and admin apps, PostgreSQL, Redis/Valkey, object storage, Stripe test mode, the carrier sandboxes and Mock, CI/CD and the local heavy lane. AWS infrastructure is designed but deferred to M5 (threat-model §5.17). It is reviewed only for design intent.
- **Method.**
  1. I re-validated every HIGH threat and every P1/P2 recommendation in `threat-model.md` against the amended ADRs, `data-model.md` and `openapi.yaml`. Section 6 records the disposition.
  2. I traced the contract (vendor extensions `x-reauth-scope`, `x-idempotency`, `x-csrf`, `x-tenancy`) against the ADR claims.
  3. I adjudicated the eight items the orchestrator raised (§5).
  4. I mapped ASVS 4.0.3 L2 per chapter (§7).
  5. I ran licence and maintenance spot checks with `npm view` under the CLAUDE.md §2 PATH prefix (§5 e). No lockfile exists yet, so dependency-auditor was not spawned. A full scan is due in Wave 0 (R-ARCH-12).
- **Severity rule.** I use the threat-model §1 matrix (impact × likelihood, adjusted for exploitability) on the CLAUDE.md §11 scale. OWASP categories are Top 10:2021, for consistency with `threat-model.md`. API Top 10:2023 is given where it adds precision.

## 3. Findings summary

| ID | Title | Sev | CWE | OWASP | Primary location | Owner | Due |
|---|---|---|---|---|---|---|---|
| SEC-P3-01 | D-038 session deviation: the claimed compensations are missing from the contract, and the 90-day absolute cap exceeds ASVS L1 | HIGH | CWE-613 | A07 | `DECISIONS.md:431-435`; `ADR-0006:18,70`; `openapi.yaml:13010,13213,13332,3067,3196,3285`; `REQUIREMENTS.md:110,123` | product-manager + principal-architect + api-designer | P4 exit |
| SEC-P3-02 | Anonymous rate-shopping can exhaust the carrier bulkheads and quotas that the booking saga also uses (T-46; R-15 not adopted) | HIGH | CWE-770 | A04 (API4:2023) | `ADR-0010:31,35`; `ADR-0014:27` | principal-architect | P4 exit |
| SEC-P3-03 | Audit-chain tamper evidence against the DB owner or superuser is weak: the migrator login owns the audit objects, the event trigger matches statement text, the anchor is nightly, symmetric and optional (T-84) | HIGH | CWE-345 | A08 / A09 | `data-model.md:2406-2426,2601,2713-2717,2736`; `ADR-0007:62` | principal-architect + data-architect | P4 exit (design); M5 (sink) |
| SEC-P3-04 | npm install scripts run in CI, image builds and the local heavy lane; no release cooldown or lockfile-source check (T-102; R-21 partially adopted) | HIGH | CWE-1357 / CWE-829 | A08 | `platform.md:208,210,225,783`; `ADR-0023:11,43` | platform-architect + devops-engineer | P4 exit; enforced from the first `npm ci` in Wave 0 |
| SEC-P3-05 | Registration followed by pre-verification sign-in is an account-enumeration oracle; ADR-0006 am. 10 says it is not | MEDIUM | CWE-204 | A07 | `ADR-0006:77`; `api/README.md:213`; `REQUIREMENTS.md:678` | principal-architect + product-manager | before identity stories |
| SEC-P3-06 | Account pre-hijacking through pre-verification sign-in, with no session purge when the email is verified | MEDIUM | CWE-287 | A07 | `ADR-0006:31,77`; `REQUIREMENTS.md:107,678` | principal-architect + product-manager | before identity stories |
| SEC-P3-07 | Local heavy-lane evidence is self-attested: the verdict field is trusted, the docs-only exemption covers `openapi.yaml`, untracked files are ignored and there is no required-suite manifest | MEDIUM | CWE-345 | A08 | `ADR-0023:86,104,108` | principal-architect + devops-engineer + qa-lead | P4 exit (manifest); Wave 0 (scripts) |
| SEC-P3-08 | Secrets and keys: no key register, rotation or AAD design; carrier OAuth tokens sit in Redis in clear; CI sandbox secrets are repository-scoped; a full Stripe secret key is used | MEDIUM | CWE-320 / CWE-522 | A02 / A05 | `ADR-0018:12`; `ADR-0010:22`; `ADR-0023:17`; `ADR-0012:15`; `platform.md:1031` | principal-architect + platform-architect | P4 exit (ADR); before any secret is added to CI |
| SEC-P3-09 | Full receiver ID on the customs invoice (UX §5 #8): distribution and minimisation controls are not specified | MEDIUM | CWE-359 | A04 | `ADR-0019:22`; `DECISIONS.md:471`; `ASSUMPTIONS.md:93` | principal-architect + product-manager | before US-186 |
| SEC-P3-10 | The contract drifts from the T-79 mitigation: `createQuote` and `createQuoteShare` idempotency is `optional`; the share route "returns the active" token although only its hash is stored | MEDIUM | CWE-524 / CWE-312 | A04 | `openapi.yaml:6347,7492,7554`; `api/README.md:140-141`; `ADR-0014:64` | api-designer (via principal-architect) | P4 exit |
| SEC-P3-11 | Background silent refresh defeats the admin 30-minute idle timeout | MEDIUM | CWE-613 | A07 | `ADR-0006:69`; `ADR-0026:14` | principal-architect + ux-designer | before admin-shell stories |
| SEC-P3-12 | The worker trusts `org_id` from Redis job payloads (T-73; R-18 not adopted) | MEDIUM | CWE-345 / CWE-639 | A08 / A01 | `ADR-0013:12` | principal-architect | before the Wave 0 worker skeleton |
| SEC-P3-13 | Raw carrier payload redaction misses embedded label and document blobs, and tracking free text (T-95) | MEDIUM | CWE-359 | A04 | `ADR-0010:53` | principal-architect + product-manager | before carrier-adapter stories |
| SEC-P3-14 | A staff member's first TOTP enrolment is not bound to mailbox control, and the 24 h enrolment deadline is deferred to M2 (T-23 residual) | MEDIUM | CWE-1392 / CWE-287 | A07 | `ADR-0006:68` | principal-architect + product-manager | ADR now; before any non-local deployment |
| SEC-P3-15 | Guest quote token in `localStorage`: accepted with conditions (adjudication b) | LOW | CWE-922 | A04 | `ADR-0026:37`; `DECISIONS.md:403-407` | principal-architect (web) | before US-155/US-171 |
| SEC-P3-16 | Recovery codes use a keyed HMAC with no per-code salt at 50 bits (ASVS 2.6.2 partial); the unpeppered SHA-512 bcrypt pre-hash allows "shucking"; docs still say bcrypt | LOW | CWE-916 / CWE-759 | A02 | `ADR-0006:67`; `ADR-0025:30`; `data-model.md:3260` | principal-architect | before MFA stories |
| SEC-P3-17 | The SYSTEM audit shard is chosen by the client-controlled correlation ID | LOW | CWE-807 | A04 | `ADR-0007:60`; `ADR-0016:24` | principal-architect | before audit package task |
| SEC-P3-18 | No `Origin` check on login, register, reset and verify (R-06 remainder) | LOW | CWE-352 | A01 | `openapi.yaml:87,177,336,886`; `ADR-0006:23` | api-designer | before identity stories |
| SEC-P3-19 | Revoking another user's sessions is not consistent in PostgreSQL during a Redis outage | LOW | CWE-613 | A07 | `ADR-0005:88`; `data-model.md:3344`; `ADR-0006:69` | principal-architect | before identity stories |
| SEC-P3-20 | The local edge binds all interfaces while default seed passwords are allowed locally (LAN exposure) | LOW | CWE-1188 / CWE-668 | A05 | `platform.md:59,73` | platform-architect | Wave 0 compose task |
| SEC-P3-21 | R-16, R-17 and R-20 remainders: Mock gating keyed on `NODE_ENV`, no edge strip of `X-Mock-Scenario`, no Stripe `livemode` check, no SDK egress register, carrier push not treated as a hint, label bytes not validated | LOW | CWE-489 / CWE-918 / CWE-345 | A05 / A10 / A08 | `ADR-0010:39`; `ADR-0012:16-17`; `ADR-0016:22` | principal-architect | before the affected stories |
| SEC-P3-22 | Licence policy D-ARCH-003 needs clarifications (adjudication e) | LOW | CWE-1104 | A06 | `DECISIONS.md:349-352`; `NFR.md:120` | principal-architect (log) + dependency-auditor (Wave 0) | P4 exit |
| SEC-P3-23 | The `Path=/` refresh cookie goes with every static and API request, so edge and app log formats must exclude `Cookie` | LOW | CWE-532 | A09 | `ADR-0006:65`; `platform.md:73` | platform-architect | Wave 0 |
| SEC-P3-24 | CSP refinements: Trusted Types, Stripe host list, lazy Stripe.js | INFO | CWE-79 | A03 | `platform.md:242`; `ADR-0026:18` | principal-architect | P5 |
| SEC-P3-25 | Document drift: definer-function owner, shared-quote path, RateLimit header draft, attestation on a private repo, ASVS 3.3.4 stories rated Should | INFO | n/a | n/a | see detail | principal-architect / product-manager | P4 |
| SEC-P3-26 | `auth_lookup_credential(user_id)` returns password hashes to any `platform_app` caller (by design); add a call-site restriction | INFO | CWE-522 | A04 | `data-model.md:2458` | principal-architect | before identity stories |

## 4. Findings detail

Each finding gives severity, CWE, OWASP and ASVS references, location, description, exploitability and impact, the **required change** (design-level remediation, which the owner applies in the ADR, contract or data model; code follows in P5), and verification (test IDs in §9).

### SEC-P3-01: D-038 session deviation: the claimed compensations are missing and the absolute cap exceeds ASVS L1 (HIGH)

- **CWE-613** Insufficient Session Expiration · **OWASP A07:2021** · **ASVS** 3.3.2 (L1/L2), 3.7.1, 4.3.3, 3.3.4
- **Location:** `docs/sdlc/DECISIONS.md:431-435` (D-038); `ADR-0006:18` (30 d / 90 d), `:70` (amendment 6); `REQUIREMENTS.md:110` (REQ-AUTH-007, 90-day cap), `:123` (REQ-AUTH-020 re-auth primitive is **Should**), `:124-125` (REQ-AUTH-021/022 are Should); `openapi.yaml` re-auth scopes appear only at `:1048, :1516, :1605, :2576`.
- **Description.**
  1. D-038 accepts the 30-day sliding refresh token with a 90-day absolute cap as an "L2 deviation". ASVS 3.3.2 requires periodic re-authentication "both when actively used or after an idle period": L1 = 30 days, L2 = 12 h or 30 min idle. A 90-day absolute cap therefore misses **L1 as well**, and NIST 800-63B AAL1 also caps re-authentication at 30 days.
  2. D-038 lists "payment-method changes" among the re-authenticated sensitive actions. The contract has no `x-reauth-scope` on `createPaymentMethod` (`openapi.yaml:13010`), `createPaymentMethodSetup` (`:13126`), `updatePaymentMethod` (`:13213`) or `deletePaymentMethod` (`:13332`).
  3. Organisation-control actions (`createInvitation` `:3285`, `updateMember` `:3067`, `removeMember` `:3196`) and `requestPrivacyExport` / `downloadPrivacyExport` (`:2294`, `:2380`) also have no step-up.
  4. The whole compensation rests on REQ-AUTH-020, which is a **Should** and could be descoped.
- **Exploitability and impact.** Likelihood M: refresh-cookie theft needs malware, a shared or stolen device, or a forgotten session; XSS can ride but not steal the cookie. Impact H, for three reasons:
  - A hijacked Owner session can invite an attacker-controlled account as Admin or Owner. That persists after the victim's password reset, because membership outlives sessions.
  - The hijacker can book shipments on the victim's saved card (no CVC or step-up at checkout).
  - The hijacker can download the full personal-data export or customs invoices that carry full tax IDs.

  Rotation with reuse detection only fires if the victim comes back. If the victim stays away, the attacker keeps sliding the session for up to 90 days. Impact H × likelihood M = HIGH.
- **Required change.** D-038 is not accepted as written. The deviation is accepted as **"L2 deviation, compensated; L1 met"** only with C1–C4:
  - **C1 (product-manager, REQ-AUTH-007; principal-architect, ADR-0006).** Customer absolute session cap **30 days** (`AUTH_SESSION_ABSOLUTE_TTL=30d`, was 90 d). `AUTH_REFRESH_TTL` (idle, sliding) stays 30 d and may never exceed the absolute cap.
  - **C2 (api-designer, `openapi.yaml`; principal-architect, ADR-0006 amendment).** Add `auth_time`, the time of the last password or MFA verification and an OIDC-standard claim, to the access token. Persist it as `sessions.authenticated_at`. Refresh copies it and never renews it. Then:
    - **Always require re-auth** (`x-reauth-scope`): `payment_method.manage` on `createPaymentMethodSetup`, `createPaymentMethod`, `updatePaymentMethod` and `deletePaymentMethod`; `privacy.export` on `requestPrivacyExport` and `downloadPrivacyExport`.
    - **Require re-auth when `now − auth_time > 12 h`** (`x-reauth-scope` with `x-reauth-max-age: 43200`): `org.member.manage` on `createInvitation`, `resendInvitation`, `updateMember` and `removeMember`.
    - **Checkout with a saved card** when `auth_time > 12 h`: the PaymentIntent sets `payment_method_options.card.require_cvc_recollection = true`, so the CVC is collected in the Stripe iframe (no PCI scope change). Otherwise checkout requires a re-auth proof.
  - **C3 (product-manager).** REQ-AUTH-020 becomes **Must** for M1. Strongly recommended: promote REQ-AUTH-021/022 (session list and remote sign-out) to Must as well, because ASVS 3.3.4 is an L2 requirement. If they stay Should, record ASVS 3.3.4 as a second deviation.
  - **C4 (product-manager).** Amend D-038 to list only compensations that exist in the contract, and update NFR-SEC-004.
  - **Fallback default:** if C2 is not delivered with the payments and organisation stories, `AUTH_REFRESH_TTL=7d` with a 30-day absolute cap becomes the configuration default, and D-038 is re-opened.
- **Why this option rather than plain 7 days.** The users the PM is protecting (a few bookings a year) sign in again in either variant, because their idle gap exceeds 30 days anyway. The 30-day absolute cap removes the L1 failure. Step-up gating removes the persistence and financial paths, which is what 3.3.2 is really protecting against.
- **Verification.** SEC-TC-37, SEC-TC-38; NFR-SEC-004 fake-clock tests re-thresholded.

### SEC-P3-02: Anonymous rate-shopping can exhaust carrier bulkheads and quotas shared with the booking saga (HIGH)

- **CWE-770** Allocation of Resources Without Limits · **OWASP A04:2021**, API4:2023 Unrestricted Resource Consumption · **ASVS** 11.1.4
- **Location:** `ADR-0010:31` (one `p-limit(10)` bulkhead per carrier account for all operations), `:35` (fan-out); `ADR-0014:27` (saga step 2 runs "bounded by bulkhead"); `threat-model.md:387` (T-46), `:700` (R-15, priority P2, not adopted; ADR-0010 has no amendment section).
- **Description.** Guest `createQuote` fans out to every eligible carrier account. Per-IP limits (20/min, 100/h) do not bound a distributed source. The design has:
  - no global anonymous budget;
  - no separation between interactive rate calls and transactional calls (`createShipment`, `cancelShipment`, `schedulePickup`);
  - no daily-quota guard (the DHL sandbox allows about 500 calls a day).

  When the bulkhead queue wait exceeds the deadline, the call returns `CARRIER_BUSY`. ADR-0014 does not classify `CARRIER_BUSY` on saga step 2 as retryable and non-ambiguous, so a paid booking can be pushed to `DRAFT` or `EXCEPTION`, releasing the authorisation.
- **Exploitability and impact.** Easy with a botnet or IPv6 rotation (until the M5 WAF), and still easy against a single sandbox quota. Impact H: CF3 bookings fail for paying customers, CF7 is unavailable, and a carrier account can be suspended for quota abuse. Likelihood M × impact H = HIGH.
- **Required change (ADR-0010 amendment, principal-architect; budget values as configuration defaults, product-manager):**
  1. **Two bulkheads per carrier account:** `rates` (`getRates`, `findServicePoints`, `validateAddress`) and `transactional` (`createShipment`, `cancelShipment`, `schedulePickup`, `cancelPickup`, `track` for booked shipments). Defaults are 6 and 4 (config). Saga and tracking calls never queue behind rate shopping.
  2. **Anonymous sub-budget:** guests may use at most 50 % of the `rates` pool. A global anonymous token bucket per carrier account (`CARRIER_ANON_CALLS_PER_MIN`, shared across replicas in Redis) applies across all IPs. When it is exhausted, guests get an immediate `carrier_error {code: CARRIER_BUSY}` for that carrier or cached results only. Authenticated quotes are unaffected.
  3. **Daily quota guard:** a Redis counter per account per UTC day (`CARRIER_DAILY_QUOTA`, `CARRIER_QUOTA_RESERVE_PCT=40`). At (100 − reserve) % of quota, anonymous fan-out to that account stops. At 90 %, only transactional calls continue. Alarms fire at 70 % and 90 %, with security event `carrier_quota_pressure`.
  4. **Saga semantics:** `CARRIER_BUSY` and quota rejections, which are local and involve no network I/O, are a distinct, **retryable, non-ambiguous** outcome. The saga retries them with backoff inside the 30-minute deadline and never moves the shipment to `DRAFT` or `EXCEPTION` (ADR-0014 cross-reference).
  5. **Streams:** state explicitly that `streamQuoteResults` never triggers fan-out (fan-out happens once, at `POST /quotes`). Concurrent-stream caps are 2 per IP and 5 per user (R-15, T-47).
  6. **Metrics:** bulkhead queue depth per pool, rejects per class, and quota usage gauge.
- **Verification.** SEC-TC-26 (as amended), SEC-TC-40, SEC-TC-41, SEC-TC-42.

### SEC-P3-03: Audit-chain tamper evidence against the DB owner or superuser is weak (HIGH)

- **CWE-345** Insufficient Verification of Data Authenticity; CWE-284 · **OWASP A08:2021 / A09:2021** · **ASVS** 7.3.3, 1.6.1
- **Location:**
  - `data-model.md:2406-2426`: `platform_migrator` is a LOGIN role that owns every audit object.
  - `:2601`: the event trigger "raises when the statement text targets audit_entries …".
  - `:2713-2717`: an HMAC anchor written after the **nightly** checkpoint.
  - `:2736`: the anchor is compared "when configured".
  - `ADR-0007:62` (amendment 3, "designed now, enforced at M5"); `threat-model.md:460` (T-84).
- **Description.**
  1. Whoever holds the migrator credentials (the migrate job, CI, developers, agents) owns the audit tables. The owner can `ALTER TABLE … DISABLE TRIGGER` and rewrite rows. The guard against this is an event trigger that pattern-matches statement text, which dynamic SQL defeats, for example `DO $$ BEGIN EXECUTE 'ALTER TABLE audit_' || 'entries DISABLE TRIGGER ALL'; END $$`.
  2. The external anchor is written only nightly, so entries newer than the last anchor (up to 24 h) can be rewritten. The next checkpoint then legitimises the rewritten head.
  3. HMAC is symmetric: every verifier holds the signing key and can forge anchors, and a third party (regulator) cannot verify.
  4. The verifier compares against the anchor only "when configured", and a deleted anchor record is not detected.
- **Exploitability and impact.** Hard (AT5 insider with migrator or superuser access). Impact C: audit integrity is a brief §4.9 non-negotiable. C × L = HIGH, as in the threat model.
- **Required change (ADR-0007 amendment 7 + `data-model.md` §4.4/§5, principal-architect and data-architect):**
  1. **Ownership separation.** A new `NOLOGIN` role `platform_audit_owner` owns `audit_entries` and its partitions, `audit_stream_heads`, `audit_checkpoint_heads`, `audit_chain_verifications`, `audit_partitions`, `audit_pii_vault`, `data_subjects`, `platform.audit_forbid_mutation`, `platform.audit_vault_guard` and `platform.ensure_audit_partitions` (`SECURITY DEFINER`). `platform_migrator` is **not** a member. Audit DDL changes run in the bootstrap (cluster-admin) lane with the migration linter's security-approval marker. Effect: tampering needs cluster superuser, not the migrator login.
  2. **Event trigger by object identity.** Use `ddl_command_end` + `pg_event_trigger_ddl_commands()` and `sql_drop` + `pg_event_trigger_dropped_objects()`. Raise for any command on an audit object unless `current_user = 'platform_audit_owner'`, which holds only inside `ensure_audit_partitions`. No statement-text matching.
  3. **Anchor cadence.** Write a checkpoint and anchor after every hourly incremental verification (not only nightly). This bounds the window in which a rewrite goes undetected to ≤ 1 h.
  4. **Asymmetric signature.** Ed25519 or ECDSA P-256. The private key comes from Secrets Manager, or KMS `Sign` with a non-exportable key at M5; a key file locally. Verifiers hold only the public key. HMAC is dropped. Anchors are verifiable by third parties, which supports the M2 regulator report.
  5. **Anchor log integrity.** Each anchor record carries `anchor_seq` and the previous anchor's hash. The verifier **fails** on a missing, duplicated or out-of-order anchor (`ANCHOR_MISSING`). The local file sink is mandatory in local and test; remove "when configured".
  6. **Verifier scope.** Every run recomputes the stream at each anchored `(stream_id, stream_seq)` of the latest anchor and checks its signature. The nightly run checks all anchors since the previous nightly run.
  7. **M5 precondition (platform-architect; G4 for any production release).** The anchor sink is S3 Object Lock in compliance mode, or CloudWatch Logs with no delete or put-retention permission for any app or CI role. RDS master credentials are break-glass only. `pgaudit` DDL logging goes to CloudWatch.
- **Residual after the change.** MEDIUM: a cluster superuser can rewrite at most the last hour of entries undetected. Accepted for this run, which holds no production data (AS-2). It closes with item 7 at M5.
- **Verification.** SEC-TC-17 (extended), SEC-TC-43, SEC-TC-44, NFR-AUDIT-002/003.

### SEC-P3-04: npm install scripts run in CI, image builds and the local heavy lane (HIGH)

- **CWE-1357** Reliance on Insufficiently Trustworthy Component; CWE-829 · **OWASP A08:2021** · **ASVS** 14.2.4, 14.1.1, 10.3.2
- **Location:** `platform.md:208, 210, 225` (Dockerfile `deps`, `prod-deps` and `build` stages use plain `npm ci`); `platform.md:783` (lane A/C `npm ci`); `ADR-0023:11, 43`. Repository-wide grep: no `--ignore-scripts`, cooldown or lockfile-source rule anywhere in `docs/` except the threat model (`threat-model.md:498, 706, 753`).
- **Description.** R-21 (P1) was adopted only for action pinning, `permissions`, no `pull_request_target` and the migration linter. Install-time lifecycle scripts still run:
  - on GitHub-hosted runners, which hold `GITHUB_TOKEN` with `packages: write` in the image job;
  - in BuildKit;
  - on the **developer host**, where carrier-sandbox and Stripe test credentials live (lane B).

  There is no minimum release age, so a freshly hijacked version can be adopted on the day it is published. Nothing checks that every `resolved` URL in the lockfile points at the npm registry.
- **Exploitability and impact.** Moderate: the npm worm campaigns of 2025 spread through `postinstall` within hours of publication. Impact C: CI token, GHCR and host secrets are stolen, and a backdoor reaches the images. M × C = HIGH, as in the threat model.
- **Required change (platform.md §2.2/§7 + ADR-0023 amendment, platform-architect; implemented by devops-engineer before the first `npm ci` in Wave 0):**
  1. `npm ci --ignore-scripts` everywhere: Dockerfiles, every workflow, `quality:heavy`, `quality:fastlane` and the developer setup docs. Commit a root `.npmrc` with `ignore-scripts=true`. Install-time work becomes explicit allow-listed steps: `npm rebuild bcrypt` (or rely on its bundled N-API prebuilds), `npx prisma generate`, `npx playwright install --with-deps`. A lane A check fails on any `npm ci` or `npm install` without the flag in workflows, Dockerfiles or `package.json` scripts.
  2. **Release cooldown:** the package-age script rejects any direct or transitive version published fewer than `DEP_MIN_AGE_DAYS=7` days before the lockfile change. A security-fix override needs a DECISIONS.md entry. Configure Dependabot `cooldown` to match.
  3. **Lockfile integrity:** every `resolved` URL is `https://registry.npmjs.org/`, and every entry has a `sha512` `integrity` (lockfile-lint or an in-house Node check). Run `npm audit signatures` in lane A.
  4. The image job is the only job holding `packages: write`. It runs after `build-and-scan`, and none of its steps execute package scripts.
- **Verification.** SEC-TC-32 (extended), SEC-TC-45.

### SEC-P3-05: Registration plus pre-verification sign-in is an enumeration oracle (MEDIUM)

- **CWE-204** Observable Response Discrepancy · **OWASP A07:2021** · NFR-SEC-003, EC-A01
- **Location:** `ADR-0006:77` (amendment 10 says the pair "is not a cheaper enumeration oracle than sign-in itself"); `api/README.md:213`; `REQUIREMENTS.md:678` (DR-A04 permits sign-in in `PENDING_VERIFICATION`); `api/README.md:167` (register is in the `auth` class only).
- **Description.** For an address X and a fresh password P, the probe is `registerUser(X, P)` → 202 (identical), then `loginUser(X, P)`. If X was free, the login **succeeds**. If X exists, it returns 401. That distinguishes free from existing addresses, which login alone does not. The oracle comes from D-009 (sign-in before verification) and exists whether or not the web app auto-signs-in. The ADR statement is incorrect and must not be relied on in G2/G3 evidence.
- **Exploitability and impact.** Easy, but noisy: every probe emails the target ("verify your email" or "account already exists") and creates an unverified account for free addresses. Throughput is bounded by the `auth` class (10/min/IP, 5/min/identifier, about 14k per day per IP). Impact: account-existence disclosure, which enables targeted phishing and credential stuffing. Likelihood M × impact M = MEDIUM.
- **Required change (adjudication c):**
  1. Correct ADR-0006 amendment 10 to state that the oracle exists and is accepted under D-009.
  2. Count `registerUser` in the `email-send` class as well (3/h per identifier, 10/h per IP), because every registration sends an email. This also closes R-23.
  3. Add a per-IP distinct-address counter: more than 5 distinct addresses per IP per hour → 429 and security event `registration_probe`.
  4. product-manager records the residual as RR-16 (accepted with throttling). Alternative, if zero enumeration is preferred: no sign-in until verification (breaks UX flow F02). Not recommended.
- **Verification.** SEC-TC-46; NFR-SEC-003 timing tests still apply to the register response.

### SEC-P3-06: Account pre-hijacking through pre-verification sign-in (MEDIUM)

- **CWE-287** Improper Authentication · **OWASP A07:2021** · ASVS 2.5.x, 3.3.x
- **Location:** `ADR-0006:31` (verification redemption has no session effect), `:77`; `REQUIREMENTS.md:107` (REQ-AUTH-004), `:678` (DR-A04).
- **Description.** An attacker registers `victim@…` with the attacker's password and signs in, which D-009 allows. If the victim later clicks the "verify your email" link from that registration, the account becomes verified while the attacker's session stays alive. The attacker can now see everything the victim enters (addresses, quotes, orders). Password reset revokes sessions (REQ-AUTH-012), but email verification does not. A future social login seam (D-007 #11) would add the classic federated-merge variant.
- **Exploitability and impact.** Moderate, because it needs victim interaction. Impact M (privacy and data of the victim). M × M = MEDIUM.
- **Required change (ADR-0006 amendment; PM wording in REQ-AUTH-004/012, DR-A04):**
  1. Successful email verification revokes **all sessions of that user except the session that made the verify call**, if it belongs to the same user (audit `SESSION_REVOKED`).
  2. A successful password reset also sets `email_verified_at`, because it proves mailbox control.
  3. `PENDING_VERIFICATION` accounts not verified within 7 days move to `DEACTIVATED` through `housekeeping`, which frees the address for registration.
  4. The verification email says "if you did not create this account, ignore this email". The "account already exists" email includes a reset entry point.
  5. ADR-0006's seam section records that a future social or OTP login never links automatically to an unverified password account.
- **Verification.** SEC-TC-47.

### SEC-P3-07: Local heavy-lane evidence is self-attested (MEDIUM; adjudication h)

- **CWE-345** · **OWASP A08:2021** · ASVS 14.1.1
- **Location:** `ADR-0023:86` (integrity rules), `:104` (docs-only staleness exemption), `:108` (degraded mode); `risks.md` R-ARCH-16.
- **Description.** The checks catch stale and wrong-SHA evidence but not wrong verdicts:
  1. `quality:check-evidence` trusts the `verdict` field of `summary.json`. Attachment hashes prove internal consistency, not results, so flipping `FAIL` to `PASS` passes.
  2. The "diff touches only `docs/**`" exemption includes `docs/03-architecture/api/openapi.yaml`, which drives the drift test and generated types (it is a full-trigger path).
  3. The clean-tree check covers tracked paths only. Untracked local test or config overrides, and `SKIP_*` environment variables, can silently drop suites.
  4. There is no canonical list of required suites, so a missing RLS or RBAC suite is not detected.
  5. Security-critical changes can merge on lane B evidence alone, with cross-checking only at wave end.
- **Exploitability and impact.** Needs an agent or developer under fix-cycle pressure, or a bug. Impact: code with a broken RLS, RBAC or audit control merges to `main` and stays there until wave end. G3 and G4 stay protected by lane C on the gate SHA, and nothing deploys in this run. Likelihood L–M × impact H (contained) = MEDIUM.
- **Required change (ADR-0023 amendment B/C, principal-architect; scripts devops-engineer; manifest qa-lead):**
  1. `quality:check-evidence` **recomputes the verdict** from the attached JUnit/JSON and ignores the declared field. Any mismatch fails.
  2. Add a **required-suite manifest** (code-owned under `tools/quality/required-suites.json`) per profile and per changed-path rule. Every required suite must be present with `tests > 0`, and JUnit counts must equal `summary.json`. Security suites must have `skipped = 0`: RLS cross-tenant, RBAC matrix, audit generator and immutability, abuse, SSRF, CSRF/cookie, idempotency, catalog C1–C12.
  3. The clean-tree check uses `git status --porcelain --untracked-files=all` on code, test and config paths. `summary.json` also records the lockfile SHA-256, the Testcontainers image digests and the **names** of any `SKIP_*`/`TEST_*` variables set. Any `SKIP_*` → `INVALID`.
  4. Narrow the staleness exemption to an explicit allow-list: `docs/**` minus `docs/03-architecture/api/**`, minus any path read by build or test tooling (listed in the manifest).
  5. **Security-critical paths** (`packages/authz/**`, `packages/audit/**`, `packages/config/**`, `prisma/**`, `apps/api/src/platform/**`, `apps/api/src/modules/identity/**`) need a hosted `security-integration` lane C subset on the PR head before merge: Testcontainers PostgreSQL plus the RLS, RBAC, audit, CSRF and catalog suites, about 10–12 minutes. Budget about 150–180 min/month, offset through the ADR-0023 §D levers. Degraded mode never applies to these paths.
  6. At wave end, lane C compares the suite inventory and test counts of every lane B evidence merged in the wave with its own results on `main`. A discrepancy fails the wave end, is logged as an incident in DECISIONS.md, and the PR is reverted.
- **Verification.** SEC-TC-48.

### SEC-P3-08: Secrets and keys: register, rotation, AAD, Redis tokens, CI scoping, Stripe key (MEDIUM; adjudication g)

- **CWE-320** Key Management Errors; CWE-522; CWE-312 · **OWASP A02 / A05:2021** · ASVS 1.6.1, 1.6.3, 6.2.1, 6.4.1, 2.10.4
- **Location:** `ADR-0018:12`; `ADR-0010:22` (OAuth tokens cached in Redis, in clear); `ADR-0023:17` and `platform.md:806` (sandbox and Stripe secrets as **repository** secrets); `ADR-0012:15` (`sk_test_`/`rk_test_` both allowed); `platform.md:1031` (placeholder refusal only when `APP_ENV=production`); `threat-model.md:465` (T-89 AAD, not adopted); `data-model.md:3259-3260`.
- **Description.** The design holds at least 13 distinct keys and secrets (JWT signing, CSRF, recovery HMAC, MFA, vault, audit index, checkpoint, tracking index, outbox payload, idempotency body, cursor, login-counter HMAC, Stripe and carrier credentials). It has no inventory with purpose, rotation method, `key_id` scheme or separation rule. HMAC lookup columns (recovery codes, `ip_hash`, tracking index) cannot be rotated without dual computation. AES-GCM encryptions have no AAD, so ciphertexts can be swapped between rows (T-89). Other gaps:
  - Carrier OAuth tokens sit in Redis in clear (R-16).
  - Repository secrets are readable by any workflow on any branch an agent pushes.
  - A full Stripe secret key is broader than the integration needs.
  - Placeholder refusal does not cover staging.
- **Exploitability and impact.** Mostly operational: these weaknesses widen the blast radius of a leak and block safe rotation. Impact H on leak; likelihood L–M → MEDIUM.
- **Required change:**
  1. **Key register (ADR-0018 new section, principal-architect).** For every key: purpose, algorithm, consuming process, storage (env reference → Secrets Manager or KMS at M5), rotation cadence and method, `key_id`/`key_version` format, blast radius. The config schema rejects identical values across any two keys (one key per purpose). Every ciphertext and HMAC lookup value carries `key_id`, so reads are dual during rotation. AES-256-GCM uses 96-bit random nonces with **AAD = table ‖ column ‖ row id or token ‖ key_id** (closes T-89). Envelope encryption uses KMS `GenerateDataKey` at M5.
  2. **Carrier OAuth tokens.** Encrypt them in Redis (AES-256-GCM, AAD = carrier account id) or keep them in process memory only. Use Valkey ACL users per service (`api`, `worker`) locally as well as in AWS, with key-prefix limits (`platform.md:320` already limits the prefixes for AWS).
  3. **CI.** Carrier and Stripe test secrets become **environment** secrets (`carrier-sandbox`), restricted to `main` and `workflow_dispatch`, and are consumed only by `contract-live`. A CI policy test fails if any `pull_request`/`push` job references that environment or `secrets.CARRIER_*` / `secrets.STRIPE_*`.
  4. **Stripe.** The default `STRIPE_SECRET_KEY_REF` is a restricted `rk_test_` key with the minimum permissions: PaymentIntents, SetupIntents, PaymentMethods and Customers write; Refunds write; Events read. Each webhook endpoint has its own secret.
  5. Placeholder and `local-only-*` refusal applies when `APP_ENV ∈ {staging, production}`.
  6. The config schema refuses `NODE_DEBUG`/library debug flags outside local. nodemailer `logger`/`debug` and the AWS SDK logger are off (R-22).
  7. **Developer host.** Sandbox credentials live only in user-scoped environment variables or a git-ignored `.env.local`, with a Gitleaks pre-commit hook (NFR-SEC-002). They never go into compose files.
- **Verification.** SEC-TC-49, SEC-TC-50, SEC-TC-51.

### SEC-P3-09: Full receiver ID on the customs invoice (MEDIUM; adjudication f)

- **CWE-359** Exposure of Private Personal Information · **OWASP A04:2021** · ASVS 8.3.4, 8.3.5 · LINDDUN L-21
- **Location:** `ADR-0019:22` (documents emailed as attachments ≤ 10 MB); `DECISIONS.md:471` (D-045 item 5); `ASSUMPTIONS.md:93` (A-090); `REQUIREMENTS.md` REQ-ACCT scope note (Viewer has "read permissions only" and the matrix leaves `document:download` ambiguous).
- **Description.** Printing the full importer tax or identity reference on the commercial or pro-forma invoice is a legitimate customs need. Storage is already designed well: `shipment_party_identifiers.value_ciphertext` (AES-256-GCM), masking everywhere else, fail-closed `DOWNLOAD` audit and a 300 s pre-signed URL. The gaps are in **distribution and minimisation**:
  1. The invoice can be **emailed as an attachment**, so the full ID ends up in mailboxes outside our control.
  2. It is unspecified whether the customer **Viewer** role holds `document:download`.
  3. Every stored reference type is printed. Some national identity numbers carry statutory masking or storage rules, so the pack must say which types customs actually requires in full.
  4. Carrier paperless upload payloads would hold the PDF bytes (see SEC-P3-13).
- **Required change (ADR-0019 amendment, principal-architect; REQ-DOC-010, A-090 and compliance-pack field, product-manager; pack schema, data-architect):**
  1. The compliance pack declares `invoice_print: FULL | MASKED` per reference type, default `MASKED`, and only `FULL` types are printed in full. Legal review (`reviewed_by`) is required before M5.
  2. A document that contains a `FULL` reference is classified `SENSITIVE`. It is **never attached** to an email; `emailShipmentDocuments` sends a link to the app instead.
  3. The RBAC seed states explicitly that the customer **Viewer** lacks `document:download`. RBAC-GEN asserts it.
  4. The decrypted value exists only in the worker's render input. That DTO is registered as `SENSITIVE_PERSONAL`, so Pino redacts it. The PDF is stored with SSE (SSE-KMS at M5).
  5. Retention and erasure follow the pack (M4/M5 erasure job, ADR-0021 item 7).
- **Verification.** SEC-TC-52.

### SEC-P3-10: Contract drift from the T-79 idempotency mitigation (MEDIUM)

- **CWE-524** Use of Cache Containing Sensitive Information; CWE-312 · **OWASP A04:2021**
- **Location:** `openapi.yaml:6347` (`createQuote` `x-idempotency: optional`; its response carries `guest_token`); `:7554` (`createQuoteShare` `optional`; the response carries `share_token`); `:7492` ("Creates (or returns the active) share link"); `api/README.md:140-141` (scope without IP; no mention of encryption or not-applicable routes); `ADR-0014:64` (amendment 1 makes both `not-applicable`).
- **Description.** ADR-0014 amendment 1 forbids storing responses that carry one-time secrets. The contract still makes idempotency optional on both routes, so implementers following the drift-tested contract would store guest and share tokens. Also, "returns the active share link" cannot work: the server holds only `share_token_hash` (`data-model.md:1706`). An implementer would be tempted to store the token in clear.
- **Required change (api-designer; principal-architect approves):**
  1. Set `x-idempotency: not-applicable` on `createQuote` and `createQuoteShare`, and remove the `IdempotencyKey` parameter and the `Idempotent-Replayed` header from both.
  2. Rewrite `api/README.md` §5 "Scope": org, or guest-token hash, or (anonymous) client IP /64 HMAC, plus actor, method, path and key; bodies encrypted at rest; one-time-secret routes never stored.
  3. `createQuoteShare` always mints a new token and revokes the previous active share (201), or returns 409 `SHARE_EXISTS` without a token. It never returns an existing token.
  4. The drift test asserts that the ADR-0014 one-time-secret list is `not-applicable`.
- **Verification.** SEC-TC-53, SEC-TC-04.

### SEC-P3-11: Background silent refresh defeats the admin 30-minute idle timeout (MEDIUM)

- **CWE-613** · **OWASP A07:2021** · ASVS 3.3.2 (L2, admin)
- **Location:** `ADR-0006:69` (amendment 5: admin idle timeout 30 min, mechanism unspecified); `ADR-0026:14` (silent refresh 60 s before expiry, unconditional).
- **Description.** The SPA refreshes the access token every 14 minutes while a tab is open, whether or not anyone is using it. Background TanStack Query refetches count as activity too. A staff session left open on an unattended workstation therefore never idles out. Staff hold cross-tenant audit access, which is why D-038 gave admin the strict profile.
- **Required change (ADR-0006 and ADR-0026 amendments, principal-architect; dialog, ux-designer):**
  1. The admin SPA tracks **user input only** (pointer, keyboard, touch; not focus, visibility or background refetch). After 30 minutes without input it stops silent refresh, calls `logoutSession` and routes to sign-in.
  2. A warning dialog appears at 28 minutes with an "extend" action (WCAG 2.2.1).
  3. Server: the admin refresh token has a **30-minute sliding lifetime** (`AUTH_ADMIN_REFRESH_IDLE_TTL=30m`) inside the 12 h cap, so an idle client cannot keep the session alive.
- **Verification.** SEC-TC-39.

### SEC-P3-12: The worker trusts `org_id` from Redis job payloads (MEDIUM)

- **CWE-345**, CWE-639 · **OWASP A08 / A01:2021**
- **Location:** `ADR-0013:12` (processors open `withTenantTx` with the payload's `org_id`); `threat-model.md:439` (T-73), `:703` (R-18 not adopted).
- **Description.** Anyone who can write to Redis can enqueue or edit a job that makes the worker act inside another tenant's RLS context. RLS cannot help, because the context itself is forged. Locally there is a single shared `requirepass` (`platform.md:64`).
- **Required change (ADR-0013 amendment):**
  1. Jobs carry `outbox_event_id` or `saga_id` plus IDs only.
  2. The processor resolves the authoritative `org_id` from PostgreSQL: the `outbox_events` row (SYSTEM table), or a new allow-listed definer function `job_context(p_kind, p_id) → org_id` added to `data-model.md` §4.5. A payload that disagrees goes to the DLQ as non-retryable, with security event `job_context_mismatch`.
  3. Payloads are Joi-validated at dequeue.
  4. Valkey ACL users per service (SEC-P3-08 item 2).
- **Verification.** SEC-TC-20 (now mandatory).

### SEC-P3-13: Raw payload redaction misses embedded documents and tracking free text (MEDIUM)

- **CWE-359** · **OWASP A04:2021** · T-95, L-23
- **Location:** `ADR-0010:53` (field-name redaction: credentials, names, street lines, phone, email, tax IDs).
- **Description.** `createShipment` and `uploadCustomsDocuments` requests and responses carry base64 label images and PDFs. Those contain receiver names and addresses, and, for invoices, the full tax ID. Field-name redaction does not touch binary content. Tracking payloads carry "signed by" names and free-text locations. The `raw-carrier-payloads` bucket would therefore hold personal data the design believes is redacted, beyond the reach of the M4/M5 erasure process.
- **Required change (ADR-0010 amendment; REQ-CARR-018 wording by PM, closes R-29):**
  1. The redactor replaces every base64 or binary document field with `{"$blob": {sha256, size, media_type, document_id?}}`.
  2. Redaction of tracking and response payloads is **allow-list** based: canonical codes, timestamps, carrier references and city/country are kept; everything else becomes `[REDACTED]`.
  3. A property test uses synthetic PII and an embedded PDF containing sentinel text.
- **Verification.** SEC-TC-52 (raw-payload part).

### SEC-P3-14: A staff member's first TOTP enrolment is not bound to mailbox control (MEDIUM)

- **CWE-1392** Use of Default Credentials, CWE-287 · **OWASP A07:2021** · T-23 residual
- **Location:** `ADR-0006:68` (amendment 4: defaults refused when `APP_ENV ≠ local`; 24 h enrolment deadline enforced only in M2; R-07's emailed-code step not adopted).
- **Description.** Whoever first signs in with a seeded or leaked staff password enrols their own TOTP and becomes Super Admin. Defaults are refused outside local, but a leaked non-default seed password, for example from a CI secret or a shared environment, still leads to takeover.
- **Required change (ADR-0006 amendment; REQ-AUTH-018 note, PM):**
  1. Outside `APP_ENV ∈ {local, test}`, a staff member's first TOTP enrolment needs an emailed one-time code sent to the staff address.
  2. The 24 h enrolment deadline is enforced now by `housekeeping` (restricted status), not deferred to M2.
  3. Non-local seeds create staff **without** passwords and send a set-password link instead.

  The design lands now; the implementation is due before any non-local deployment.
- **Verification.** SEC-TC-03 (extended), SEC-TC-56.

### SEC-P3-15: Guest quote token in `localStorage` (LOW; accepted, adjudication b)

- **CWE-922** · **OWASP A04:2021** · ASVS 8.2.2, 3.2.3 (interpretation recorded in §5 b)
- **Location:** `ADR-0026:37`; `DECISIONS.md:403-407` (D-ARCH-012).
- **Conditions:**
  1. Only `{token, expires_at}` is stored, under `qt:<quoteId>`, with no PII next to it.
  2. On every app start, sweep expired entries and keep at most the 20 newest.
  3. Delete the entry on claim, sign-out, 404 and expiry (as designed).
  4. Never put the token in URLs, `history.state` or logs (as designed); Pino redacts `x-quote-token`.
  5. Server side: the guest token stops granting access 7 days after the quote expires, even though the row is retained for 90 days (D-045).
  6. Load Stripe.js lazily on the checkout route only. By then the quote is claimed and the token deleted.
- **Verification.** SEC-TC-54.

### SEC-P3-16: Recovery-code and password pre-hash details (LOW)

- **CWE-916**, CWE-759 · **OWASP A02:2021** · ASVS 2.6.2, 2.4.x
- **Location:** `ADR-0006:67` (`HMAC-SHA256(RECOVERY_KEY, code)` at about 50 bits; bcrypt input `base64(SHA-512(password))`); `ADR-0025:30` and `data-model.md:3260` still say bcrypt for recovery codes.
- **Description.**
  1. ASVS 2.6.2 asks for lookup secrets of at least 112 bits, or a per-secret 32-bit salt. A keyed HMAC without a salt is acceptable only while `RECOVERY_KEY` stays outside the database. Record this as a compensated interpretation.
  2. An unpeppered SHA-512 pre-hash allows "password shucking" against leaked unsalted SHA-512 corpora. Also note that base64(SHA-512) is 88 characters, so bcrypt uses 72 bytes, about 432 bits: safe, but not "untruncated".
- **Required change:**
  1. Use the `id-secret` format (8-character lookup id + 10-character secret), store `HMAC(RECOVERY_KEY, secret ‖ per-code 32-bit salt)`, and look up by id.
  2. Change the pre-hash to `base64(HMAC-SHA-256(PASSWORD_PEPPER, password))` (44 characters, within 72 bytes), with the pepper in the SEC-P3-08 key register.
  3. Fix ADR-0025 and data-model §10.4.
- **Verification.** SEC-TC-14, SEC-TC-12.

### SEC-P3-17: The SYSTEM audit shard is chosen by a client-controlled value (LOW)

- **CWE-807** Reliance on Untrusted Inputs in a Security Decision · **OWASP A04:2021**
- **Location:** `ADR-0007:60` (`n = hash(correlation_id) mod 16`); `ADR-0016:24` (a client `X-Correlation-Id` is accepted).
- **Description.** An attacker can pick correlation IDs that all hash to one shard, which re-creates T-85 contention for that shard's legitimate traffic.
- **Required change:** derive the shard from a server-generated request id (or a random value), and keep the client value as `client_correlation_id` (L-14).
- **Verification.** SEC-TC-57.

### SEC-P3-18: No `Origin` check on login, register, reset and verify (LOW)

- **CWE-352** · **OWASP A01:2021**
- **Location:** `openapi.yaml:87, 177, 336, 886`; `ADR-0006:23` (CSRF covers only cookie routes).
- **Description.** The JSON-only content type (415) and CORS already block cross-site form login CSRF, so this is defence in depth (R-06 remainder, T-07).
- **Required change:** require an allow-listed `Origin` (with a `Referer` fallback) on these four routes, plus `x-origin-check: true` in the contract.
- **Verification.** SEC-TC-58.

### SEC-P3-19: Cross-user session revocation is not consistent during a Redis outage (LOW)

- **CWE-613** · **OWASP A07:2021**
- **Location:** `ADR-0005:88`; `data-model.md:3344` (OI-25: the `sessions` update runs in a worker job); `ADR-0006:69` (the fallback reads `sessions.revoked_at`).
- **Description.** If Redis is down, the synchronous Redis write fails, and the worker job (which needs BullMQ) is delayed. The DB fallback then reads a session that is not yet revoked, so a suspended user's sessions stay alive.
- **Required change:** add a definer function `revoke_sessions_for_user(p_user_id, p_reason)` and call it synchronously in the API transaction. Redis then becomes the cache.
- **Verification.** SEC-TC-59.

### SEC-P3-20: The local edge binds all interfaces (LOW)

- **CWE-1188** Insecure Default Initialization, CWE-668 · **OWASP A05:2021**
- **Location:** `platform.md:59` ("except the edge ports"), `:73` (`8080, 8443, 8444` on all interfaces).
- **Description.** With default seed passwords allowed locally, anyone on the same LAN can reach the admin app and enrol TOTP on a seeded staff account (T-23 on a café Wi-Fi). The data is synthetic, but the dev host also holds sandbox credentials.
- **Required change:** bind the edge to `127.0.0.1` by default, with `EDGE_BIND=0.0.0.0` as an explicit opt-in for LAN demos that also refuses default seed passwords.
- **Verification.** SEC-TC-34 (extended).

### SEC-P3-21: Remaining parts of R-16, R-17 and R-20 (LOW)

- **CWE-489**, CWE-918, CWE-345 · **OWASP A05 / A10 / A08:2021**
- **Location:** `ADR-0010:39` (Mock registered on `NODE_ENV !== 'production'`); `ADR-0012:16-17`; `ADR-0016:22`.
- **Required change:**
  1. Add an explicit `MOCK_CARRIER_ENABLED` and `MOCK_SCENARIOS_ENABLED`, defaulting to false outside `APP_ENV ∈ {local, test}`, and strip `X-Mock-Scenario` at the edge in non-local environments (T-50).
  2. The Stripe webhook rejects `livemode: true` events and keeps an event-type allow-list (T-67).
  3. The Stripe SDK uses `Stripe.createFetchHttpClient()` bound to the `OutboundHttpClient` dispatcher. An "SDK egress exception register" in ADR-0016 lists the AWS SDK (S3, SES) and nodemailer, with their configured hosts (T-96).
  4. Carrier pushes are hints. Cancellation-blocking or terminal transitions require confirmation by `track()` (T-72).
  5. Validate carrier label bytes (magic bytes, ≤ 5 MB) and set the content type at put time (T-59).
- **Verification.** SEC-TC-22, SEC-TC-24, SEC-TC-25, SEC-TC-60; CFG test for the Mock flags.

### SEC-P3-22: Licence policy clarifications (LOW; adjudication e)

- **CWE-1104** · **OWASP A06:2021**
- **Location:** `DECISIONS.md:349-352` (D-ARCH-003); `NFR.md:120` (NFR-SEC-012 covers prod and dev, and requires the 18-month rule for "100 %").
- **Required change:** see §5 (e) for the proposed decision text, which principal-architect should log as D-ARCH-003 rev 2.
- **Verification.** Wave 0 dependency-auditor run (R-ARCH-12); licence-check unit tests on SPDX expressions.

### SEC-P3-23: The `Path=/` refresh cookie reaches edge and app logs (LOW)

- **CWE-532** · **OWASP A09:2021**
- **Location:** `ADR-0006:65` (`__Host-rt_*; Path=/` on the app host, with the API under `/api/*`); `platform.md:73`.
- **Description.** The refresh cookie travels with every static and API request on the app host. Any access log or trace that records request headers would capture refresh tokens.
- **Required change:**
  - Nginx log format without `$http_cookie`, and CloudFront cookie logging off (M5).
  - Pino redaction of `req.headers.cookie`, `res.headers["set-cookie"]`, `authorization`, `x-csrf-token`, `x-quote-token` and `x-reauth-proof`.
  - The OTel HTTP instrumentation header allow-list excludes them.
  - The CloudFront cache policy does not forward cookies to the static origin.
- **Verification.** SEC-TC-31 (extended with cookie sentinel).

### SEC-P3-24: CSP refinements (INFO)

- **Location:** `platform.md:242`; `ADR-0026:18`.
- **Notes:**
  1. Add `require-trusted-types-for 'script'` with one policy owned by the sanitising component (R-22). Evaluate in Wave 0 (SPK-06).
  2. Stripe's current CSP guidance may need `https://*.js.stripe.com` in `script-src`/`frame-src`. A subdomain wildcard under Stripe's own registrable domain is acceptable. Record it against NFR-SEC-006's "exact host" wording, rather than weakening anything else.
  3. ADR-0026 amendment 1 says "no third-party scripts", but Stripe.js is one. Lazy-load it on checkout only (also SEC-P3-15).
  4. PCI DSS v4.0.1 SAQ A (2025 revision) asks the merchant to confirm the page embedding the payment iframe is protected against script attacks. The hash-based CSP, the CSP violation listener and SRI/hash checks on first-party bundles are that evidence.

### SEC-P3-25: Document drift (INFO)

- `data-model.md` §4.3 and §4.5 still name `platform_migrator` as owner of the definer functions and holder of the definer policies. §12 and ADR-0005 amendment 6 (`platform_definer`) win. Update in Wave 0, as §12 says.
- `data-model.md:2463` still cites `GET /public/shared-quotes/{shareToken}`; the route is now `POST …/resolve`.
- RateLimit headers: ADR-0016 §8 says `draft-6`, ADR-0025 says `draft-7`, and `api/README.md:186` flags the mismatch. Settle on `draft-6` (three headers, REQ-API-014).
- ADR-0023 §1 attaches GitHub artifact attestations, but `platform.md:1243` notes they need Enterprise Cloud on private repositories. Use Syft SBOM plus digest pinning until M5 (cosign).
- REQ-AUTH-021/022 (ASVS 3.3.4, L2) are Should; see SEC-P3-01 C3.

### SEC-P3-26: `auth_lookup_credential(user_id)` exposes password hashes to any caller (INFO)

- **Location:** `data-model.md:2458`.
- **Description.** This is by design for login. Any `platform_app` code path, or an injection, can call it for any user id. RLS on `users` limits user-id discovery.
- **Required change:** add a lint or Semgrep rule allowing calls only from `modules/identity/repository`, and add the function to catalog test C11's "sensitive definer" list.

## 5. Adjudications

### (a) D-038: ASVS V3.3.2 deviation (30-day refresh)

**Decision: accepted as a compensated deviation only with conditions C1–C4 of SEC-P3-01. D-038 as written is not accepted.**

1. The 90-day absolute cap exceeds ASVS 3.3.2 **L1** (30 days) and NIST AAL1. It is cut to **30 days**.
2. The compensating control D-038 cites ("re-auth for payment-method changes") does not exist in the contract, and the control it depends on (REQ-AUTH-020) is a Should.
3. The real persistence paths (member and role management, saved-card checkout, privacy export) are not step-up gated.

With a 30-day absolute cap, `auth_time`-based step-up (12 h, the L2 figure) on high-risk actions, and REQ-AUTH-020 as Must, the residual is **LOW**: theft gives at most 30 days of read access to the victim's own data, with no persistence and no payment without re-auth or CVC.

`AUTH_REFRESH_TTL=7d` is **not required** under these conditions. It becomes the configuration default automatically if C2 is not implemented with the payments and organisation stories. ASVS checklist status for V3.3.2: **Deviation (L2), compensated; L1 met.**

### (b) `localStorage` guest quote token vs XSS under the planned CSP

**Decision: accepted (SEC-P3-15, LOW).**

- **What the token protects.** One **unclaimed** quote: postcodes, city, package data and prices, with no names. The token dies on claim. Its worst-case misuse is reading those details or racing the guest to claim the quote (a nuisance DoS on one quote).
- **XSS.** Script running on the web origin is already game over for the user: it can call `/auth/refresh` with the HttpOnly cookie and fetch a CSRF token. Moving the guest token to memory or `sessionStorage` would not change the XSS outcome. The real control is preventing XSS, and the design is strong there:
  - hash-based `script-src` with no `unsafe-inline`/`unsafe-eval` (`platform.md:242`);
  - `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`;
  - one sanitising component (REQ-SEC-016);
  - React encoding;
  - a CSP-violation listener in e2e (NFR-SEC-006).
- **Shared devices.** Persistence across browser restarts is the actual marginal risk. It is bounded by condition 5 (server stops honouring the token 7 days after expiry) and condition 2 (start-up sweep).
- **ASVS interpretation.** 3.2.3 (session tokens in cookies or `sessionStorage`) and 8.2.2 (no sensitive data in browser storage) are read as not applying to a single-resource **capability token** that is not a session token. This interpretation is recorded in the checklist.
- **Revisit trigger.** Move to an HttpOnly path-scoped cookie if a guest quote ever holds names, addresses or payment state.

### (c) Register → 202 → client-side sign-in vs account enumeration

**Decision: the flow is acceptable, but ADR-0006 amendment 10's claim is wrong (SEC-P3-05, MEDIUM).**

The register-then-login pair is an enumeration oracle (free address ⇔ login succeeds). It is inherent to D-009 (sign-in before verification), not to the client auto-login. Keeping the identical 202 still matters, because it denies a free oracle on the register call alone. The required changes are:

- correct the ADR text;
- add the `email-send` class on register (3/h per identifier, 10/h per IP);
- add the `registration_probe` detector;
- record the PM-accepted residual RR-16.

The pre-hijacking side effect (SEC-P3-06) is handled separately. The alternative, no sign-in before verification, is the PM's call; I don't recommend it given the funnel rationale in D-038 and D-045.

### (d) Residual HIGH items T-84 and T-46

- **T-84 (DB superuser vs hash chain): HIGH stays open until SEC-P3-03 lands.** ADR-0007 amendment 3 has the right idea (external anchor, key outside the database), but four things weaken it:
  - the migrator login owns the audit tables;
  - the event trigger matches statement text;
  - anchoring is nightly and symmetric;
  - anchor comparison is optional.

  After SEC-P3-03 items 1–6 the residual is **MEDIUM** (≤ 1 h rewrite window for a cluster superuser). That is accepted for this run, which has no production data. Item 7 (Object Lock or retention-locked anchor sink) is a **G4 precondition for any production release** (M5).
- **T-46 (guest floods vs carrier bulkheads): HIGH stays open until SEC-P3-02 lands.** R-15 was scheduled P2, but the shared bulkhead couples anonymous traffic to paid bookings (CF3), so it must be settled in ADR-0010 before P4 freezes the task DAG. After the change: separate pools, an anonymous budget, a quota guard and `CARRIER_BUSY` retry semantics. The residual is **MEDIUM**: distributed floods can still deny guests rate shopping until the M5 WAF (RR-03), but no longer paying customers.

### (e) D-ARCH-003 licence interpretation

**Decision: confirmed, with clarifications.** Registry spot checks on 2026-11-12 (`npm view <pkg> license version time.modified`, PATH prefix per CLAUDE.md §2):

| Package | Licence | Latest version, modified | Note |
|---|---|---|---|
| nodemailer | MIT-0 | 10.5.0 (2026-11-10) | equivalent to MIT |
| tslib | 0BSD | 2.9.1 (2026-10-30) | |
| lru-cache | BlueOak-1.0.0 | 11.5.3 (2026-09-18) | |
| argparse | **PSF-2.0** (3.x); Python-2.0 (2.x) | 3.0.4 (2026-10-24) | add the PSF-2.0 spelling |
| caniuse-lite | **CC-BY-4.0** | 1.0.30001826 (2026-11-11) | **not covered by D-ARCH-003** (build-time data via browserslist) |
| spdx-exceptions | **CC-BY-3.0** | 2.5.0 (2024-02-15) | not covered, and fails the 18-month rule (dev transitive of licence tooling) |
| uqr / bowser / canonicalize / cookie / otplib / jose / opossum / bcrypt / pdfkit | MIT / MIT / Apache-2.0 / MIT / MIT / MIT / Apache-2.0 / MIT / MIT | all modified within 18 months | pass |

Proposed decision text (principal-architect to log as **D-ARCH-003 rev 2**; security-analyst confirms):

1. **Production closure** (the runtime dependency graph of `apps/api`, `apps/worker` and the shipped web/admin bundles) must match LICENSE_ALLOWLIST plus these permissive equivalents: MIT-0, 0BSD, BlueOak-1.0.0, PSF-2.0 / Python-2.0.
2. **Dev and build closure:** the same, plus **build-time data licences CC-BY-3.0 and CC-BY-4.0** (for example caniuse-lite and spdx-exceptions), provided the data is not shipped in bundles, with attribution in `THIRD_PARTY_NOTICES.md`.
3. **SPDX expressions:** `OR` passes if any branch passes; `AND` needs all branches. `UNKNOWN`, `UNLICENSED` or a missing licence **fails**, except for workspace packages marked `"private": true`.
4. **Copyleft and source-available licences** (GPL, AGPL, LGPL, SSPL, BUSL, RSAL, Commons Clause, Semgrep Rules License) never appear in the npm closure, prod or dev. They are admissible only for **separately executed tools** run as pinned containers or actions and **listed by name** in a tool register:
   - Terraform BUSL-1.1, with the OpenTofu fallback;
   - k6 AGPL-3.0;
   - Semgrep CLI LGPL-2.1 and its registry rules, used internally to scan our own code;
   - Checkov, ZAP, Mailpit, RustFS, Valkey.

   The open-ended "source-available with a licence permitting our use" category is replaced by the register.
5. **Shipped images** must contain no AGPL, SSPL, BUSL or RSAL component (Trivy licence scan on images). OS packages from the pinned base images are governed by the distribution's licences and reported, not gated.
6. **Maintenance (18-month) rule:** gating for **direct** dependencies and for any transitive dependency that is deprecated, archived or has a Critical/High advisory. Other stale transitives are reported in the nightly freshness report.
7. **OFL-1.1:** only for font files embedded in generated PDFs (Noto Sans, ADR-0019). The web apps ship no web fonts (D-UX-001).

NFR-SEC-012's "dev dependencies … release in the last 18 months" should be reworded to match point 6 (product-manager).

### (f) UX §5 item 8: the customs invoice prints the full receiver ID

**Decision: accepted, with conditions (SEC-P3-09, MEDIUM).**

The full ID is a customs necessity, and storage is designed well: encrypted column, masking elsewhere, fail-closed `DOWNLOAD` audit, 300 s pre-signed URL. The conditions are:

- print only the reference types the pack marks `FULL`;
- never email the document as an attachment;
- deny `document:download` to the Viewer role explicitly;
- render-only decryption with Pino redaction;
- binary redaction in raw carrier payloads (SEC-P3-13);
- legal review of the pack's `FULL` list before M5.

### (g) Secrets handling for carrier and Stripe credentials

**Decision: compliant at design, with conditions (SEC-P3-08, MEDIUM).** In place:

- references only (`*_REF`, `carrier_accounts.credential_secret_ref` with a CHECK pattern);
- a `SecretProvider` (env locally, Secrets Manager at M5) with values in process memory only;
- Pino redaction by key; `.env.example` parity; Gitleaks on PRs and full history;
- the live-key start-up guard (`PAYMENT_LIVE_KEY_FORBIDDEN`);
- partner credentials envelope-encrypted under per-tenant KMS keys (M3 seam).

Still required:

- a key register with rotation, `key_id` and AAD;
- encrypted (or in-process) carrier OAuth token cache;
- environment-scoped CI secrets;
- a restricted Stripe key;
- placeholder refusal in staging;
- library debug logging off;
- a hygiene rule for credentials on the developer host.

### (h) Local-evidence integrity for the CI lane model (ADR-0023 amendment)

**Decision: acceptable for merges, with conditions; gates are protected (SEC-P3-07, MEDIUM).**

The design catches stale, dirty-tree and wrong-SHA evidence. It cannot catch a wrong verdict or a silently skipped suite, and the docs-only exemption covers the contract. Lane C on the gate SHA keeps G3 and G4 trustworthy, so the exposure is security-regressing code sitting on `main` within one wave. Required:

- recompute the verdict from the reports;
- a required-suite manifest with `skipped = 0` for security suites;
- untracked-file and `SKIP_*` checks;
- a narrowed staleness exemption;
- a hosted `security-integration` subset on the PR head for security-critical paths;
- a wave-end inventory cross-check with automatic revert.

## 6. Disposition of threat-model HIGH threats and P1 recommendations

| Threat | Threat-model severity | Design response | Status after this review |
|---|---|---|---|
| T-21 MFA brute force across challenges | HIGH | ADR-0006 am. 3: per-user lock; REQ-AUTH-017 amended (D-043 b) | **Closed** (SEC-TC-02) |
| T-23 seeded staff enrolment hijack | HIGH | ADR-0006 am. 4: defaults refused outside local | **Reduced to MEDIUM**, SEC-P3-14 |
| T-32 confused deputy `{orgId}` | HIGH | ADR-0005 am. 3; data-model §4.1 | **Closed** (SEC-TC-01) |
| T-37 pre-auth and system lookups | HIGH | ADR-0005 am. 1/6; data-model §4.5, §12 (`platform_definer`), catalog C11 | **Closed** (SEC-TC-05) |
| T-46 rate-shopping amplification | HIGH | none in ADR-0010 | **Open: SEC-P3-02 (HIGH)** |
| T-79 idempotency store | HIGH | ADR-0014 am. 1 (scoping, encryption, not-applicable list) | ADR closed; **contract drift SEC-P3-10 (MEDIUM)** |
| T-84 superuser vs hash chain | HIGH | ADR-0007 am. 3 | **Open: SEC-P3-03 (HIGH)** |
| T-85 SYSTEM stream lock DoS | HIGH | ADR-0007 am. 1 (16 shards) | **Closed**; shard-key residual SEC-P3-17 (LOW) |
| T-88 runtime audit-off switch | HIGH | ADR-0007 am. 4 (build-time `-bench` image only) | **Closed** (SEC-TC-18) |
| T-100 Mailpit/RustFS exposure | HIGH | ADR-0006 am. 7; platform.md:59 binds 127.0.0.1 | **Closed**; edge residual SEC-P3-20 (LOW) |
| T-102 malicious dependency | HIGH | pinned actions only | **Open: SEC-P3-04 (HIGH)** |
| T-103 CI secret exfiltration | HIGH | platform.md §7.1: SHA pins, `permissions: {}`, no `pull_request_target` | **Reduced to MEDIUM**; secret scoping in SEC-P3-08 |

| P1 recommendation | Landed in | Status |
|---|---|---|
| R-01 definer allow-list and global index tables | ADR-0005 am. 1/6; data-model §4.5, §12 | Done |
| R-02 operator branch SELECT-only plus DB membership check | ADR-0005 am. 2; data-model §4.2/§4.3 | Done |
| R-03 tenant context only from the token | ADR-0005 am. 3 | Done |
| R-05 idempotency store | ADR-0014 am. 1 | Done in the ADR; contract drift (SEC-P3-10) |
| R-06 `__Host-` cookie, signed CSRF, Origin on login-class routes | ADR-0006 am. 1/2 | Partial: Origin on login-class routes missing (SEC-P3-18) |
| R-07 MFA hardening | ADR-0006 am. 3/4 | Partial: emailed first-enrolment code missing (SEC-P3-14); id-secret codes and peppered pre-hash (SEC-P3-16) |
| R-08 revocation fallback, JWT pinning, operator only in admin, admin idle | ADR-0006 am. 5; ADR-0005 am. 5 | Partial: JWT pinning (`algorithms:['ES256']`, iss/aud/app, leeway ≤ 30 s) to be stated in ADR-0006 (SEC-TC-11 tests it); admin idle mechanism (SEC-P3-11) |
| R-09 signed external checkpoint | ADR-0007 am. 3 | Partial (SEC-P3-03) |
| R-10 SYSTEM sharding, aggregation | ADR-0007 am. 1/5 | Done (aggregation deferred, acceptable); shard key (SEC-P3-17) |
| R-11 tokenised IP/UA/reason; AAD; HMAC tracking | ADR-0007 am. 2; data-model §5.1 | Partial: AAD and `key_id` not designed (SEC-P3-08) |
| R-12 no runtime audit-off | ADR-0007 am. 4 | Done |
| R-13 pre-auth limiter, /64 keys, trust proxy, qs, `no-store` | ADR-0016 am. 1; D-043 d | Done |
| R-14 no secrets in URLs | ADR-0016 am. 2/6; ADR-0006 am. 8 | Done |
| R-20 Compose binding, Mailpit local only, seed defaults, Mock flag | platform.md:59; ADR-0006 am. 4/7 | Partial: Mock flag and edge strip (SEC-P3-21); edge binding (SEC-P3-20) |
| R-21 supply chain and CI | platform.md §7.1 | Partial: `--ignore-scripts`, cooldown, environments, CODEOWNERS equivalent (SEC-P3-04, SEC-P3-07, SEC-P3-08) |
| R-26 ASVS 3.3.2 deviation | D-038 | Adjudicated in §5 (a): conditional |

P2 recommendations are tracked by their owners. R-15 is promoted to a condition (SEC-P3-02); R-16, R-17 and R-18 are captured in SEC-P3-08, 12, 13 and 21; R-19 is done (ADR-0014 am. 2); R-22 is partly captured in SEC-P3-08 and 24; R-23 is in SEC-P3-05; R-24, R-25, R-27..R-31 remain with product-manager (R-27 is closed by D-040).

## 7. ASVS 4.0.3 Level 2: design checklist (chapter level)

Status values: **pass** (designed and testable), **partial** (gaps listed, or items deferred to M5 with a tracked task), **n.a.** (not applicable in M0/M1, with the reason). This is the seed for the NFR-SEC-001 per-item checklist, which security-analyst completes at P6 against code and tests.

| Chapter | Status | Design evidence (references) | Gaps, deviations and deferrals |
|---|---|---|---|
| V1 Architecture, design, threat modelling | **partial** | Threat model with DFDs, STRIDE and LINDDUN (`threat-model.md`); single enforcement points (`defineRoute` metadata + RLS, ADR-0003/0005/0008); input and output architecture (ADR-0016); data classification registry (ADR-0007, data-model §1.2); business-logic state machines (ADR-0014) | 1.6.1/1.6.3 key management policy and rotation (SEC-P3-08); 1.9 TLS deferred to M5; 1.14.x edge binding (SEC-P3-20); supply chain (SEC-P3-04) |
| V2 Authentication | **partial** | 2.1 policy 12–128 characters, no composition rules, breached list (REQ-AUTH-002); 2.2 anti-automation (DR-A02, DR-A22, pre-auth limiter, per-user MFA lock); 2.4 bcrypt 12 (REQ-AUTH-003); 2.5 single-use reset tokens, no MFA bypass (REQ-AUTH-011/012); 2.8 TOTP RFC 6238 with replay protection (ADR-0006); 2.10 service credentials via secret references (ADR-0018) | 2.1.7 top-10k list is small (R-31, P3); 2.6.2 recovery codes (SEC-P3-16); enumeration oracle accepted (SEC-P3-05); pre-hijack (SEC-P3-06); staff first enrolment (SEC-P3-14); 2.2 distributed attacks until the M5 WAF (RR-03) |
| V3 Session management | **partial (documented deviation)** | 3.2 new token at login, 256-bit refresh tokens (ADR-0006); 3.3.1 logout revokes server side; 3.4 `__Host-`, HttpOnly, Secure, SameSite=Strict, Path=/ (ADR-0006 am. 1); 3.5 ES256 JWT with Redis plus DB revocation (am. 5); 3.7.1 re-auth primitive (REQ-AUTH-020) | **3.3.2: L2 deviation compensated, L1 met, conditional on SEC-P3-01**; admin idle mechanism (SEC-P3-11); 3.3.4 session list and logout-others are Should (SEC-P3-01 C3); cross-user revocation consistency (SEC-P3-19); cookie log exposure (SEC-P3-23) |
| V4 Access control | **partial** | 4.1 server-side, deny by default, fail closed (RLS forced; `app_org_id()` NULL on malformed, data-model §4.2); 4.2.1 IDOR: 404 cross-tenant, generated RLS/RBAC suites, catalog C1–C12; 4.2.2 CSRF on cookie routes (ADR-0006 am. 2); 4.3.1 admin MFA mandatory (REQ-AUTH-018); operator branch SELECT-only with DB check (ADR-0005 am. 2) | 4.3.3 step-up for high-value actions (SEC-P3-01 C2); worker context trust (SEC-P3-12) |
| V5 Validation, sanitisation, encoding | **pass** | Joi `allowUnknown:false` everywhere (REQ-SEC-007); Joi/Zod parity (REQ-SEC-008); one sanitiser (REQ-SEC-016); React encoding; parameterised SQL with a Semgrep ban (REQ-SEC-009); SSRF client with post-resolution checks (ADR-0016 §13); qs hardening (ADR-0016 am. 1); safe redirect validator (REQ-ADMIN-001) | ReDoS seed checks (T-42) at implementation; label byte validation (SEC-P3-21) |
| V6 Stored cryptography | **partial** | 6.1 classification; 6.2 AES-256-GCM, SHA-256, HMAC-SHA-256, ES256, bcrypt; 6.3 CSPRNG tokens (`crypto.randomBytes`, DR-A01) | 6.2 AAD and `key_id` (SEC-P3-08); 6.4.1/6.4.2 vault and KMS deferred to M5; key register missing (SEC-P3-08) |
| V7 Error handling and logging | **partial** | 7.1 Pino redaction from the classification registry, no secrets or PII (REQ-PLAT-012, NFR-PRIV-001); 7.1.3/7.2 security event catalogue (REQ-SEC-012, `api/README.md` §13); 7.4 RFC 9457 errors with a generic 5xx (ADR-0016 §3); audit trail (ADR-0007) | 7.3.3 audit tamper evidence (SEC-P3-03); 7.3.3/7.3.4 log protection and time sync deferred to M5 (CloudWatch); Joi value echo (L-13, R-22) |
| V8 Data protection | **partial** | 8.1.1 `no-store` default on authenticated responses (ADR-0016 am. 1); 8.2.1 client anti-caching; 8.2.2/3.2.3 guest-token interpretation accepted (§5 b); 8.3.1 no sensitive data in URLs (ADR-0016 am. 2); 8.3.4 classification registry; 8.3.5 sensitive reads audited fail-closed (DR-A12); 8.3.7 field encryption for identifiers and TOTP | 8.3.2 export and erasure are Could, with retention jobs in M4/M5 (L-22, RR-05); customs invoice distribution (SEC-P3-09); raw payload blobs (SEC-P3-13); 8.1.x backups deferred to M5 |
| V9 Communication | **partial (deferred to M5)** | HTTPS-only outbound (REQ-SEC-010); HSTS logic (REQ-SEC-003); config refuses plain DB/Redis outside local (NFR-SEC-007) | 9.1/9.2 TLS at ALB, RDS, ElastiCache verified in M5 (NFR-SEC-007 PARTIAL); local plain HTTP is not claimed compliant |
| V10 Malicious code | **partial** | 10.3.2 pinned digests, SBOM, Trivy, Semgrep, Gitleaks (REQ-SEC-013); SHA-pinned actions (platform.md §7.1) | Install scripts and cooldown (SEC-P3-04); Stripe.js SRI exception (RR-08); image signing deferred to M5 |
| V11 Business logic | **partial** | 11.1.1 explicit state machines (DR-B01, DR-B27); 11.1.2/11.1.3 limits (payment attempts, rate classes); 11.1.6 version checks, advisory locks, saga re-checks (ADR-0014 am. 2); 11.1.7/11.1.8 security events and alerts | 11.1.4 anti-automation on rate shopping (SEC-P3-02); coupon race policy (R-28, PM) |
| V12 Files and resources | **pass / n.a.** | No user uploads in M1 (D-025), so 12.1–12.3 are n.a.; 12.4.1 private bucket outside the web root (ADR-0021); 12.5.2 attachment disposition and forced content type; 12.6.1 SSRF allow-list | Carrier label byte validation (SEC-P3-21); `UploadScanner` refuses `Noop` in production (ADR-0021 §5) |
| V13 API and web service | **pass** | 13.1.1/13.1.3 consistent encoding, no secrets in URLs; 13.1.4 authorisation per route plus per resource (RLS); 13.1.5 content-type allow-list (415); 13.2.1 `Allow`/405; 13.2.2 schema validation from the contract plus a drift test; 13.2.3 CSRF on cookie routes; 13.3/13.4 SOAP and GraphQL n.a. | Idempotency contract drift (SEC-P3-10) |
| V14 Configuration | **partial** | 14.1.1 automated reproducible builds, digest-pinned images, non-root, read-only rootfs (platform.md); 14.2.1 audit plus age checks; 14.2.2 Swagger and Mock off in production; 14.2.5 SBOM; 14.3 no banners or debug; 14.4 full header set incl. CSP, HSTS, Referrer-Policy, `frame-ancestors` (platform.md:237-245); 14.5.3 exact-origin CORS (REQ-SEC-014); 14.5.4 trusted-proxy CIDRs (ADR-0016 am. 1) | 14.2.3 Stripe.js SRI exception (RR-08); 14.2.4 trusted repositories and lockfile source (SEC-P3-04); Mock gating by flag (SEC-P3-21); 14.1.x infrastructure hardening deferred to M5 (Checkov now) |

## 8. Compliance with the brief's security directives

| Directive | Status | Evidence | Open items |
|---|---|---|---|
| §4.2 Tenancy, identity, access | Compliant with conditions | ADR-0005 (RLS, active org, operator branch), ADR-0006 (bcrypt 12, in-memory JWT, `__Host-` HttpOnly SameSite=Strict refresh with reuse detection and server revocation, verification, reset, lockout, sessions, staff TOTP), ADR-0008 (catalogue, route metadata build test) | SEC-P3-01, 05, 06, 11, 14 |
| §4.3 Carrier credentials | Compliant with conditions | `credential_secret_ref` names only (ADR-0010 §carrier accounts), `SecretResolver`, values never logged, partner envelope encryption seam (ADR-0011), OAuth tokens cached in Redis until shortly before expiry (as the brief says) | SEC-P3-08 (encrypt the cached tokens), SEC-P3-13 |
| §4.7 PCI DSS SAQ A | Compliant at design | Stripe Payment Element iframes (ADR-0012 §2); PAN scanner on bodies, logs and DB, `CARD_DATA_NOT_ACCEPTED` (NFR-SEC-013, EC-B30); exact Stripe hosts in the CSP; test-key guard; amounts computed server-side; state from the retrieved PaymentIntent (`openapi.yaml:12777`) | SEC-P3-21 (`livemode` check, SDK egress), SEC-P3-24 (SAQ A script-protection evidence) |
| §4.9 Audit immutability | Compliant with a HIGH condition | INSERT/SELECT-only grants, UPDATE/DELETE/TRUNCATE triggers on parent and partitions, per-stream SHA-256 chain with `stream_seq`, monthly partitions with no default, same-transaction writes, fail-closed sensitive reads, redaction before hashing, tokenised erasure (ADR-0007, data-model §5) | SEC-P3-03 (owner separation, anchoring), SEC-P3-17 |
| §4.10 Row-level security and files | Compliant | Forced RLS on every tenant table, transaction-local `set_config`, `NOBYPASSRLS`, explicit audited operator policy, definer allow-list, catalog tests C1–C12, crafted-ID integration tests (data-model §4); files private, SHA-256, pre-signed after permission check plus audit (ADR-0021) | SEC-P3-12 (worker context), SEC-P3-26 |
| §4.11 Security | Compliant; infrastructure items deferred to M5 | Helmet headers, hash CSP, exact CORS, CSRF on cookie routes, Joi strict, parameterised SQL, SSRF client, Redis-backed limits per IP/user/(M3 key), scanning in CI, problem+json errors, security events; WAF, TLS, Secrets Manager, OIDC and least-privilege IAM designed in platform.md for M5 | SEC-P3-04, 07, 08 |

## 9. Security test cases qa-lead must adopt

**Adopt SEC-TC-01..36 from `threat-model.md` §10.2 without change, except for these updates:**

| ID | Update |
|---|---|
| SEC-TC-03 | Also: first staff enrolment outside local/test without the emailed code → 403; non-local seed creates staff without passwords (SEC-P3-14) |
| SEC-TC-04 | Also: `createQuote` and `createQuoteShare` never create an `idempotency_keys` row; stored bodies are ciphertext (SEC-P3-10) |
| SEC-TC-09 | Cookie assertions use `__Host-rt_*; Path=/` (ADR-0006 am. 1); the CSRF token is the HMAC over `session_id ‖ app` (am. 2) |
| SEC-TC-12 | Recovery codes are a single HMAC lookup (no bcrypt fan-out); the test keeps the p95 isolation assertion |
| SEC-TC-17 | Extended by SEC-TC-44 (asymmetric anchor, anchor sequence) |
| SEC-TC-20 | Mandatory (was conditional on R-18): the processor resolves `org_id` from PostgreSQL (SEC-P3-12) |
| SEC-TC-26 | Asserts the separate `transactional` pool and saga success during the flood (SEC-P3-02) |
| SEC-TC-28 | Uses the `#token=` fragment links of ADR-0006 am. 8 and `POST …/resolve` |
| SEC-TC-31 | Adds a `Cookie`/`Set-Cookie` sentinel in Nginx, API and OTel output (SEC-P3-23) |
| SEC-TC-32 | Adds `--ignore-scripts`, `.npmrc`, cooldown, lockfile source and `npm audit signatures` (SEC-P3-04) |
| SEC-TC-34 | Adds the edge bound to 127.0.0.1 by default (SEC-P3-20) |

**New test cases:**

| ID | Test | Type | Covers |
|---|---|---|---|
| SEC-TC-37 | `createPaymentMethodSetup`, `createPaymentMethod`, `updatePaymentMethod`, `deletePaymentMethod`, `requestPrivacyExport`, `downloadPrivacyExport` without `X-Reauth-Proof` → 401 `REAUTH_REQUIRED`. `createInvitation`, `resendInvitation`, `updateMember`, `removeMember` with `auth_time` more than 12 h old and no proof → 401 `REAUTH_REQUIRED`; with fresh login → success. Saved-card checkout with `auth_time` more than 12 h old → PaymentIntent has `require_cvc_recollection=true` | API (fake clock) | SEC-P3-01 |
| SEC-TC-38 | Customer refresh at absolute age 30 d + 1 s → 401 `SESSION_EXPIRED`; sliding refresh never extends past the absolute cap; `auth_time` unchanged by refresh | API (fake clock) | SEC-P3-01 |
| SEC-TC-39 | Admin SPA with no input for 30 min → silent refresh stops, logout called, sign-in shown; warning at 28 min; server rejects an admin refresh token idle for more than 30 min; background refetch does not count as activity | E2E + API | SEC-P3-11 |
| SEC-TC-40 | Guest flood from 50 IPs (Mock latency) while 20 authenticated orders book: all bookings reach `BOOKED`; guests receive `CARRIER_BUSY` or cached results; no saga step ends in `DRAFT` or `EXCEPTION` because of `CARRIER_BUSY` | K6 + integration | SEC-P3-02 |
| SEC-TC-41 | Daily quota guard: with the counter at (100 − reserve) %, anonymous fan-out to that account stops, authenticated and transactional calls continue, and `carrier_quota_pressure` is emitted at 70 % and 90 % | Integration | SEC-P3-02 |
| SEC-TC-42 | Reopening `streamQuoteResults` 10 times (including `Last-Event-ID`) causes 0 extra carrier calls (Mock call counter); a third concurrent stream from one IP → 429 | API | SEC-P3-02, T-47 |
| SEC-TC-43 | As `platform_migrator`: `ALTER TABLE audit_entries DISABLE TRIGGER ALL`, `ALTER TABLE … NO FORCE ROW LEVEL SECURITY`, `DROP TRIGGER`, `DETACH PARTITION` → permission denied (not owner). The same statements via `DO $$ … EXECUTE 'ALTER TABLE audit_' || 'entries …' $$` → blocked by the identity-based event trigger. `ensure_audit_partitions()` still succeeds | RLS-INT / CAT | SEC-P3-03 |
| SEC-TC-44 | The verifier holds only the public key. A tampered entry older than the last anchor, with the chain and checkpoint heads recomputed as superuser → `CHECKPOINT_SIGNATURE_INVALID`. A deleted or reordered anchor record → `ANCHOR_MISSING`. An anchor is written every hour | Integration | SEC-P3-03 |
| SEC-TC-45 | A fixture package with a `postinstall` that writes a marker: after the CI, Dockerfile and `quality:heavy` installs, the marker is absent; the allow-listed rebuild steps still produce working `bcrypt`, Prisma client and Playwright; a version published fewer than 7 days ago is rejected by the age script; a lockfile entry resolved from a non-registry URL fails lane A | CI | SEC-P3-04 |
| SEC-TC-46 | Registering a 6th distinct address from one IP within an hour → 429 plus `registration_probe`; a 4th registration for one identifier within an hour → 429 (`email-send` class); responses stay identical for new and existing addresses (NFR-SEC-003 timing) | API | SEC-P3-05 |
| SEC-TC-47 | The attacker registers `victim@`, signs in, then the victim redeems the verification link → the attacker's next refresh returns 401 `SESSION_REVOKED`; an account left unverified for 7 days → `DEACTIVATED` and the address can register again; a successful reset sets `email_verified_at` | API (fake clock) | SEC-P3-06 |
| SEC-TC-48 | `quality:check-evidence` FAILs on: `verdict: PASS` with a JUnit attachment showing failures > 0; a missing required security suite; `skipped > 0` in a security suite; untracked files in code paths; any `SKIP_*` variable recorded; evidence older than a change to `docs/03-architecture/api/openapi.yaml` | CI (fixtures) | SEC-P3-07 |
| SEC-TC-49 | The config schema rejects two identical key values; every ciphertext and HMAC column has `key_id`; decrypting with a retired key works while new writes use the current key; swapping ciphertexts between two vault rows fails GCM authentication (AAD) | UNIT + integration | SEC-P3-08 |
| SEC-TC-50 | After the carrier OAuth contract tests, a Redis `SCAN` finds no plaintext token pattern; job payloads in Redis contain IDs only (schema check on every queued job during e2e) | Integration | SEC-P3-08, SEC-P3-12 |
| SEC-TC-51 | Workflow policy test: `secrets.CARRIER_*` and `secrets.STRIPE_*` appear only in jobs with `environment: carrier-sandbox`; no `pull_request` or `push` workflow references that environment; with `APP_ENV=staging`, startup is refused if any secret equals a placeholder | CI + CFG | SEC-P3-08 |
| SEC-TC-52 | The invoice prints `FULL` only for pack-designated types and the masked form otherwise; `emailShipmentDocuments` for a document with a `FULL` reference sends a link and no attachment; a Viewer gets 403 plus a `PERMISSION_DENIED` audit on `getDocumentDownloadUrl`; raw-carrier-payload objects contain no base64 blob over 1 kB and none of the sentinel name, address or tax ID | API + UNIT + storage scan | SEC-P3-09, SEC-P3-13 |
| SEC-TC-53 | The contract test asserts `x-idempotency: not-applicable` on every ADR-0014 one-time-secret route; `createQuoteShare` called twice returns two different tokens and the first resolves to 404 (or 409 `SHARE_EXISTS`); no clear share token exists in any table | Contract + API | SEC-P3-10 |
| SEC-TC-54 | After claim, sign-out, a 404 and an expiry sweep, `localStorage` has no `qt:` entry for that quote; app start removes expired entries and keeps at most 20; the token never appears in URL, `history.state`, Referer or logs; the server rejects the token 7 days after the quote expires | E2E + API | SEC-P3-15 |
| SEC-TC-55 | Recovery code in `id-secret` form: one HMAC compare per attempt; per-code salt present; the bcrypt input is `base64(HMAC(pepper, pw))`, 44 characters; two 100-byte passwords sharing their first 72 bytes are distinct | UNIT | SEC-P3-16 |
| SEC-TC-56 | A staff member's first TOTP enrolment (`APP_ENV=staging` profile) without the emailed code → 403; a staff account with no enrolment after 24 h → restricted | API (fake clock) | SEC-P3-14 |
| SEC-TC-57 | 1,000 anonymous requests whose crafted `X-Correlation-Id` values all hash to one shard are spread over at least 12 of the 16 SYSTEM shards | API + DB | SEC-P3-17 |
| SEC-TC-58 | A foreign `Origin` on `loginUser`, `registerUser`, `resetPassword` or `verifyEmail` → 403 `CSRF_REJECTED`; `text/plain` bodies → 415 | API | SEC-P3-18 |
| SEC-TC-59 | With Redis stopped, suspending a user or removing a member → the affected access token is rejected through the DB fallback within 5 s, and refresh fails | Resilience | SEC-P3-19 |
| SEC-TC-60 | A correctly signed fixture event with `livemode: true` → rejected and audited; an unknown event type is stored but not processed; Stripe SDK calls go through `OutboundHttpClient` (dispatcher spy), and a non-allow-listed host is blocked | API + integration | SEC-P3-21 |

Placement: SEC-TC-37, 38, 46, 47, 55, 56, 58 and 59 belong to the identity generator and API suites in Wave 0/1. SEC-TC-43 and 44 belong to the audit package suite. SEC-TC-45, 48 and 51 belong to the Wave 0 CI tasks. SEC-TC-40, 41 and 42 are in the k6 `wave` profile. All of them are tagged `@security` and listed in the SEC-P3-07 required-suite manifest.

## 10. Conditions register

| Condition | Finding | Required change (summary) | Owner | Due | Closure evidence |
|---|---|---|---|---|---|
| **SEC-COND-01** | SEC-P3-01 (HIGH) | 30-day absolute cap; `auth_time` plus step-up re-auth scopes (payment methods, member and invitation management, privacy export); CVC recollection at saved-card checkout; REQ-AUTH-020 promoted to Must; D-038 amended | product-manager (D-038, REQ-AUTH-007/020), principal-architect (ADR-0006), api-designer (`openapi.yaml`) | P4 exit | Amended D-038, ADR-0006, REQ rows and contract; SEC-TC-37/38 green by G3 |
| **SEC-COND-02** | SEC-P3-02 (HIGH) | ADR-0010 amendment: rates and transactional bulkheads, anonymous budget, daily quota guard, `CARRIER_BUSY` saga semantics, subscribe-only streams with caps | principal-architect | P4 exit | ADR-0010 amendment; SEC-TC-26/40/41/42 green by G3 |
| **SEC-COND-03** | SEC-P3-03 (HIGH) | `platform_audit_owner`; identity-based event trigger; hourly asymmetric anchor with sequence; mandatory anchor comparison; M5 locked sink as a G4-production precondition | principal-architect, data-architect; platform-architect (M5) | P4 exit (design); G4-production (sink) | ADR-0007 amendment 7, data-model §4.4/§5; SEC-TC-43/44 green by G3 |
| **SEC-COND-04** | SEC-P3-04 (HIGH) | `--ignore-scripts` everywhere with an allow-listed rebuild; 7-day cooldown; lockfile source and integrity; `npm audit signatures` | platform-architect, devops-engineer | P4 exit (doc); before the first `npm ci` in Wave 0 (implementation) | platform.md / ADR-0023 amendment; SEC-TC-32/45 green in Wave 0 |
| SEC-TASK-05..14 | SEC-P3-05..14 (MEDIUM) | As in §4 | As in §3 | Before the affected story starts (P5); SEC-P3-07, 08, 10 and 12 by P4 exit | Listed SEC-TCs green by G3 |
| Backlog | SEC-P3-15..26 (LOW/INFO) | As in §4 | As in §3 | Before the affected story starts | P5 change reviews |

## 11. Residual risks accepted for this run (after the conditions)

| ID | Residual | Disposition |
|---|---|---|
| RR-04 (updated) | A cluster superuser can rewrite at most the last hour of audit entries undetected | Accepted for M0/M1 (no production data); closed by the Object Lock or retention-locked sink at M5 (G4-production precondition) |
| RR-03 (updated) | Distributed floods can deny guests rate shopping (not bookings) until the WAF | Deferred to M5 |
| RR-06 (replaced) | Customer session up to 30 days absolute (ASVS 3.3.2 L2 deviation, L1 met) | Accepted as compensated under SEC-COND-01 |
| RR-16 (new) | Account-existence oracle through register then login (D-009) | Accepted by product-manager with SEC-P3-05 throttling |
| RR-17 (new) | Guest capability token persisted in `localStorage` (≤ 24 h plus 7-day server grace) | Accepted (§5 b) |
| RR-18 (new) | Security-critical merges can rest on local evidence until wave end, if the hosted subset is unavailable | Not accepted for security-critical paths (SEC-P3-07 item 5); accepted for other paths, with the wave-end cross-check |

## 12. Handoff Report

- **Agent:** security-analyst  **Phase:** P3  **Task/Scope:** architecture-level security review before G2
- **STATUS:** DONE
- **Summary:** Verdict APPROVED_WITH_CONDITIONS. 0 Critical, 4 High (SEC-P3-01..04), each with a concrete required change and owner (SEC-COND-01..04, due at P4 exit), 10 Medium, 9 Low, 3 Info. All eight requested items are adjudicated (§5). ASVS L2 chapter checklist in §7. 24 new security test cases (SEC-TC-37..60) plus updates to SEC-TC-01..36.
- **Artifacts written/changed:** `docs/05-quality/security/P3-architecture-security-review.md` (new). No ADR, requirement or code changed, nothing committed.
- **Evidence:** read-through of the inputs listed in the header; contract grep of `x-reauth-scope`, `x-idempotency`, `x-csrf` and the operation list in `openapi.yaml`; `npm view` licence and maintenance spot checks for 15 packages (§5 e).
- **Decisions made:** adjudications (a)–(h) in §5; proposed D-ARCH-003 rev 2 text for principal-architect to log.
- **Assumptions / defaults applied:** none beyond those documented in the inputs. The recommended values (30-day absolute cap, 12 h step-up age, 7-day dependency cooldown, 7-day unverified-account expiry, bulkhead 6/4 split, 40 % quota reserve) are configuration defaults the owners may tune.
- **Optional questions (non-blocking):** product-manager may prefer "no sign-in before verification" over RR-16 (default applied: accept with throttling).
- **Risks / follow-ups:** see §10.
- **Recommended next agent & action:** principal-architect applies SEC-COND-01..04 and the P4-exit MEDIUM items (with product-manager and api-designer); quality-gatekeeper records SEC-COND-01..04 as G2 conditions; qa-lead adds §9 to the test strategy in P4.

## 13. Remediation status (appended 2026-11-12 by principal-architect; design-level closure before G2)

Every change is a dated "Amendment (2026-11-12, SEC-P3-xx)" section in the affected ADR (Accepted ADRs amended, not rewritten), mirrored in the data model, contract and platform design. Decisions: `docs/sdlc/DECISIONS.md` D-ARCH-003 rev 2 and D-ARCH-017..028; requirement side D-046..D-052 (product-manager). OpenAPI re-lint after the changes: `@redocly/cli@2` → valid, 0 errors, 8 pre-existing warnings. Implementation and test closure (SEC-TC-*) remain due per §10.

| Finding | Design change (summary) | File / section |
|---|---|---|
| SEC-P3-01 (HIGH) | 30-day absolute cap (`AUTH_SESSION_ABSOLUTE_TTL`), 401 `SESSION_EXPIRED`; `auth_time` claim = `sessions.authenticated_at`; `x-reauth-scope` always on the 4 payment-method and 2 privacy-export operations, `org.member.manage` + `x-reauth-max-age: 43200` on the 4 member/invitation operations (`ReauthProofConditional`); saved-card checkout with `auth_time` > 12 h → `require_cvc_recollection` + `Payment.cvc_recollection_required` (CVC recollection is the only mechanism — equivalent alternative, rationale in the ADR); 7-day refresh fallback | `adr/ADR-0006-identity-and-sessions.md` am. 12; `adr/ADR-0012-payments-gateway-abstraction.md` am. 1; `adr/ADR-0016-api-conventions.md` am. 8; `api/openapi.yaml` (10 operations, `refreshSession`, `createReauthProof`, `checkoutOrder`, security schemes, `Unauthorized`); `api/README.md` §5/§8/§10/§11; `data-model.md` §3.1 `sessions`/`refresh_tokens`; D-ARCH-017, D-046/D-047 |
| SEC-P3-02 (HIGH) | Two bulkheads per account (`rates` 6 / `transactional` 4); anonymous share ≤ 50 % + global bucket `CARRIER_ANON_CALLS_PER_MIN=120` (`carrier_anon_budget_exhausted`); daily quota guard `CARRIER_DAILY_QUOTA` / `CARRIER_QUOTA_RESERVE_PCT=40`, alarms 70/90 % (`carrier_quota_pressure`); `CARRIER_BUSY` and quota refusals = `LOCAL_REJECT`, retryable and non-ambiguous in the saga; streams subscribe-only, caps 2/IP and 5/user; pool and quota metrics | `adr/ADR-0010-carrier-adapter-layer-and-resilience.md` am. 1–6; `adr/ADR-0014-booking-saga-and-idempotency.md` am. 3; `adr/ADR-0016-api-conventions.md` am. 9; `api/openapi.yaml` `streamQuoteResults`/`streamBookingProgress`/`createQuote`; `api/README.md` §7/§9; `nfr-strategy.md`/`nfr-traceability.md` RES-003; D-ARCH-018, D-048 |
| SEC-P3-03 (HIGH) | `platform_audit_owner` NOLOGIN owns all audit objects and functions (migrator not a member; audit DDL only in the bootstrap lane with a linter marker); `platform.audit_ddl_guard()` on `ddl_command_end`/`sql_drop` via `pg_event_trigger_ddl_commands()`/`pg_event_trigger_dropped_objects()`; hourly `CHAIN_CHECKPOINT` + `audit_anchors` (`anchor_seq`, `prev_anchor_hash`, ECDSA P-256 signature, worker-only key; public-key verifiers); mandatory `AUDIT_ANCHOR_SINK`; verifier fails `ANCHOR_MISSING` / `CHECKPOINT_SIGNATURE_INVALID` / `CHECKPOINT_HEAD_MISMATCH`; M5 locked sink (Object Lock compliance or retention-locked CloudWatch, bootstrap stack, RDS master break-glass, `pgaudit`) recorded as a G4-production precondition | `adr/ADR-0007-audit-store.md` am. 7; `adr/ADR-0005-tenancy-row-level-security.md` am. 7; `adr/ADR-0021-object-storage.md` am. 1; `data-model.md` §1.7, §3.4 (`audit_anchors`), §4.4, §4.6 (C13/C14), §5.1–§5.7, §8.1/§8.3; `platform.md` §2.2/§2.3 (anchor volume), §4.3, §4.7, §4.8, §5.2; `risks.md` R-ARCH-18 + SPK-08; `ARCHITECTURE.md` §2 and audit row; `nfr-*` AUDIT-002/003; D-ARCH-019 |
| SEC-P3-04 (HIGH) | Root `.npmrc` (`ignore-scripts=true` …); `npm ci --ignore-scripts` in every Dockerfile stage, workflow and quality script; allow-listed `npm run deps:rebuild`; lane A `check-install-flags`; `DEP_MIN_AGE_DAYS=7` cooldown with an override register; Dependabot `cooldown: 7`; `check-lockfile` (registry source + sha512) and `npm audit signatures`; `images` the only `ci.yml` job with `packages: write`, after `build-and-scan`, no package scripts | `adr/ADR-0023-ci-cd-and-release.md` am. F; `platform.md` §2.1, §3.2, §3.3, §7.1, §7.2, Appendix A; `risks.md` R-ARCH-20 (SPK-01 extended); `nfr-*` SEC-002/SEC-012; D-ARCH-020 |
| SEC-P3-07 (MEDIUM) | Verdict recomputed from JUnit/JSON; `tools/quality/required-suites.json` with `skipped = 0` for security suites; untracked-file clean-tree check; `lockfile_sha256`, Testcontainers digests and `SKIP_*`/`TEST_*` names in `summary.json` (`SKIP_*` → `INVALID`); staleness exemption narrowed (excludes `api/**` and tooling inputs); hosted `security-integration` job on security-critical paths (degraded mode never applies); wave-end inventory cross-check with revert; lane C `wave-end` dispatches default 3 (≈ 1,825 min ≈ 91 %) | `adr/ADR-0023-ci-cd-and-release.md` am. G; `platform.md` §7.2 (job row + amendment), §7.4, §7.8, §11.1; `risks.md` R-ARCH-19; D-ARCH-021 |
| SEC-P3-08 (MEDIUM) | Key and secret register (24 entries: algorithm, holder, storage, rotation, blast radius), `<key_id>:<base64>` format with `_PREVIOUS`, `key_id` sibling on every ciphertext/HMAC column, AES-256-GCM AAD = table ‖ column ‖ row id/token ‖ key_id, KMS envelope at M5; encrypted (or in-memory) carrier OAuth token cache; Valkey ACL users `api`/`worker`/`healthcheck` locally and in AWS; `carrier-sandbox` environment secrets + `check-workflow-policy`; restricted `rk_test_` Stripe key, one webhook secret per endpoint; placeholder refusal in staging; debug flags refused outside local; developer-host hygiene with a Gitleaks pre-commit hook | `adr/ADR-0018-configuration-and-secrets.md` am. 1–4; `adr/ADR-0010…` am. 7; `adr/ADR-0012…` am. 2; `adr/ADR-0013…` am. 4; `adr/ADR-0023…` am. H; `platform.md` §2.1, §2.2, §2.7, §4.7, §7.1, §7.3, §9.2, §9.3; `data-model.md` §3.1/§3.4/§3.5/§3.8/§3.11/§3.16 (`*_key_id`), §10.4; D-ARCH-022 |
| SEC-P3-10 (MEDIUM) | `createQuote` and `createQuoteShare` `x-idempotency: not-applicable`, no `Idempotency-Key`/`Idempotent-Replayed`; `createQuoteShare` mints a new token and revokes the previous share (201; mint-and-revoke chosen over 409 `SHARE_EXISTS`); README §5 scope rewritten (org / guest hash / IP-/64 HMAC + actor, method, path, key; encrypted bodies; one-time-secret routes never stored); drift test asserts the ADR-0014 list (now incl. `activateTotp`); `share_path` example fixed to `/q#token=` | `api/openapi.yaml` (`createQuote` ~6328, `createQuoteShare` ~7629, `share_path`); `api/README.md` §5, §15; `adr/ADR-0014…` am. 4; `data-model.md` §3.10 `quote_shares` (`ux_quote_shares__quote_active`), §6.2; D-ARCH-023 |
| SEC-P3-11 (MEDIUM) | Admin refresh token 30-minute sliding lifetime (`AUTH_ADMIN_REFRESH_IDLE_TTL`) inside the 12 h cap → 401 `SESSION_EXPIRED`; admin SPA idle clock reset by user input only, 28-minute `alertdialog` warning with extend (WCAG 2.2.1), logout at 30 minutes | `adr/ADR-0006…` am. 13; `adr/ADR-0026-frontend-architecture.md` am. 8; `api/openapi.yaml` `refreshSession`, cookie schemes; `api/README.md` §8; `data-model.md` §3.1 `refresh_tokens`; D-ARCH-024, D-052 (a) |
| SEC-P3-12 (MEDIUM) | Job payload v2 `{v, kind, id, correlation_id, trace_context}` (no `org_id`); `platform.job_context(kind, id)` SECURITY DEFINER resolves `org_id`/actor before `withTenantTx`; mismatch → DLQ + `job_context_mismatch`; Joi validation at dequeue; Valkey ACL users per service | `adr/ADR-0013-background-jobs-and-queues.md` am. 1–5; `adr/ADR-0005…` am. 7; `data-model.md` §1.7 (`job_context_kind`), §4.1–§4.3, §4.5 (`job_context` SQL), §6.1/§6.3; `platform.md` §2.2 (ACL); D-ARCH-025 |
| SEC-P3-13 (MEDIUM) | Redactor replaces binary/base64 document fields with `{"$blob": {sha256, size, media_type, document_id?}}`; tracking and response payloads allow-list redacted; property test with synthetic PII and a sentinel PDF | `adr/ADR-0010…` am. 8; `data-model.md` §3.8 `carrier_raw_payloads`; D-ARCH-026, D-052 (b) |
| SEC-P3-14 (MEDIUM) | `requestTotpEnrolmentCode` (`POST /auth/mfa/totp/enrolment-code`, `email-send`, `x-mfa-gate-exempt`, 202); `enrolTotp.enrolment_code` required for a staff user's first enrolment outside local/test, 403 `MFA_ENROLMENT_CODE_REQUIRED`; `mfa_enrolment_codes` table (HMAC, 10 min, attempt counter); 24 h deadline enforced now by `housekeeping` → `SUSPENDED` / `status_reason = MFA_ENROLMENT_OVERDUE` (`users.first_signed_in_at`, `mfa_enrolment_overdue_candidates`); non-local seeds create staff without `user_credentials` and send a `SET_PASSWORD` link | `adr/ADR-0006…` am. 14; `adr/ADR-0005…` am. 7; `api/openapi.yaml` (new operation, `TotpEnrolRequest`, `Forbidden`); `api/README.md` §7/§8/§11; `data-model.md` §1.7, §3.1 (`users`, `user_credentials`, `password_reset_tokens.purpose`, `mfa_enrolment_codes`), §4.5, §9.3; D-ARCH-027, D-052 (c) |
| SEC-P3-22 (LOW) | D-ARCH-003 rev 2 logged with the §5 (e) text (closures, SPDX rules, tool register, image rule, 18-month rule, OFL) | `docs/sdlc/DECISIONS.md` D-ARCH-003 rev 2; `nfr-*` SEC-012; D-052 (f) |
| Alignment with PM rewording (SEC-P3-05/06/09/15/21/25) | ADR text aligned so no REQ-vs-ADR contradiction remains: registration oracle corrected + `email-send`/`registration_probe`; verification revokes other sessions, reset verifies mailbox, 7-day unverified expiry, no auto-linking of future social/OTP logins; `invoice_print: FULL | MASKED`, SENSITIVE documents never attached, Viewer without `document:download`; `localStorage` token conditions incl. 7-day server grace and lazy Stripe.js; Mock flags, carrier pushes confirmed by `track()`, Stripe `livemode` rejection + event allow-list + SDK on the SSRF client, label byte validation; RateLimit `draft-6`; SDK egress register; definer-owner drift fixed | `adr/ADR-0006…` am. 15; `adr/ADR-0010…` am. 9; `adr/ADR-0012…` am. 3; `adr/ADR-0016…` am. 7, 10; `adr/ADR-0019-documents-and-pdf-generation.md` am. 1; `adr/ADR-0021…` am. 2–3; `adr/ADR-0025-sanctioned-additions.md` (draft-6); `adr/ADR-0026…` am. 9; `data-model.md` §4.3/§4.5 (SEC-P3-25); D-ARCH-028 |
| Not yet applied (owner backlog, Wave 0) | `x-origin-check` on `loginUser`/`registerUser`/`resetPassword`/`verifyEmail` (SEC-P3-18); Nginx strip of `X-Mock-Scenario` outside local (SEC-P3-21 item 1); edge bound to 127.0.0.1 (SEC-P3-20); cookie/log redaction set (SEC-P3-23); SYSTEM shard key from a server id (SEC-P3-17); `revoke_sessions_for_user` (SEC-P3-19); `id-secret` recovery codes and peppered pre-hash (SEC-P3-16, `pepper_key_id` reserved); CSP refinements (SEC-P3-24); `auth_lookup_credential` call-site lint (SEC-P3-26) | api-designer, devops-engineer, platform-architect, principal-architect per §3 "Due" |

## 14. Remediation verification (2026-11-12)

Appended by security-analyst after the remediation recorded in §13. Baseline: commit `d5cdfa2` (clean tree). I checked every claim in §13 against the files, not against the summary. Line numbers refer to that commit.

### 14.1 Method and evidence

- **Contract greps (`docs/03-architecture/api/openapi.yaml`).**
  - `x-reauth-scope` appears on 14 operations: the 4 that already had it (`changePassword`, `disableTotp`, `regenerateRecoveryCodes`, `requestAccountDeletion`) plus the 10 the review required:
    - `requestPrivacyExport` :2483 and `downloadPrivacyExport` :2585 (`privacy.export`);
    - `updateMember` :3312, `removeMember` :3407, `createInvitation` :3537 and `resendInvitation` :3840 (`org.member.manage`);
    - `createPaymentMethod` :13271, `createPaymentMethodSetup` :13364, `updatePaymentMethod` :13490 and `deletePaymentMethod` :13581 (`payment_method.manage`).
  - `x-reauth-max-age: 43200` appears exactly on the 4 member and invitation operations (:3313, :3408, :3538, :3841). Those 4 use `ReauthProofConditional` (`required: false`, :15629). The 6 always-re-auth operations use `ReauthProof` (`required: true`, :15620).
  - Other SEC-P3-01 contract items: the `auth_time` claim is in `bearerAuth` (:15513); 401 `SESSION_EXPIRED` is on `refreshSession` (:546, :636); the `ReauthRequest.action_scope` enum holds all 7 scopes (:20689–20696).
  - `createQuote` (:6328) and `createQuoteShare` (:7629) are both `x-idempotency: not-applicable` (:6486, :7693). Neither declares `IdempotencyKey` or `Idempotent-Replayed`, and `SHARE_EXISTS` appears nowhere.
- **SQL (`docs/03-architecture/data-model.md`).**
  - Bootstrap SQL (§4.4 :2569–2595) creates `platform_audit_owner` as `NOLOGIN NOINHERIT`. It contains no `GRANT platform_audit_owner TO …`, and C13 asserts that `pg_auth_members` is empty for that role.
  - The guard `platform.audit_ddl_guard()` (§5.2 :2925–2980) calls `pg_event_trigger_ddl_commands()` (:2941) and `pg_event_trigger_dropped_objects()` (:2961). It is not `SECURITY DEFINER`, and the statement-text trigger is dropped (:2978).
  - Anchors are hourly and signed with ECDSA P-256 (§5.5 :3105–3166). The sink is mandatory (:3122). The verifier checks `ANCHOR_MISSING`, `CHECKPOINT_SIGNATURE_INVALID` and `CHECKPOINT_HEAD_MISMATCH` (§5.6 :3209–3222).
- **`platform.md`.** Every `npm ci` carries `--ignore-scripts` (:196, :222, :224, :250, :803, :824, :835, :836, :859). The only other mentions are descriptive (:1374, `npm audit signatures` needs an installed tree; :1385, `min-release-age`). **No unflagged `npm ci` in platform.md.** Unflagged mentions elsewhere are listed in SEC-P3-33.
- **Documents read.**
  - ADR amendment sections: 0005 am. 7; 0006 am. 12–15; 0007 am. 7; 0010 am. 1–9; 0012 am. 1–3; 0013 am. 1–5; 0014 am. 3–4; 0016 am. 7–10; 0018 am. 1–4; 0019 am. 1; 0021 am. 1–3; 0023 am. F–H; 0026 am. 8–9.
  - `data-model.md` §3.1, §3.4, §3.10, §4.4–§4.6, §5.2–§5.7; `api/README.md` §5, §7, §8, §9, §13; `platform.md` §3.2, §7.1, §7.2; `risks.md` R-ARCH-18..20.
  - `REQUIREMENTS.md`: REQ-AUTH-004/006/007/018/020–026, REQ-CARR-017/018/022/023, REQ-BOOK-023, REQ-PAY-014, REQ-ACCT-016, REQ-ORG-010/012, REQ-RBAC-004, REQ-DOC-010, REQ-NOTIF-008, REQ-COMP-001, REQ-QUOTE-002, REQ-SEC-012, DR-A01/A04/A22.
  - `NFR.md`: NFR-SEC-004/005/012, NFR-RES-007.
  - `DECISIONS.md`: D-046..D-052, D-ARCH-003 rev 2, D-ARCH-017..028.
- **External facts checked (2026-11-12).**
  - Stripe documents that a payment can succeed when the CVC check fails, and that the Radar "CVC verification fails" rule does not act when the check is unavailable ([Stripe: card verification checks](https://docs.stripe.com/disputes/prevention/verification), [Stripe support: charge succeeded despite CVC mismatch](https://support.stripe.com/questions/cvc-or-avs-failed-but-payment-succeeded), [Stripe: recollect CVC](https://support.stripe.com/questions/recollect-cvc-to-prevent-fraud)).
  - AWS KMS has supported Ed25519 since 2025-11-07: key spec `ECC_NIST_EDWARDS25519`, algorithm `ED25519_SHA_512` ([AWS What's New](https://aws.amazon.com/about-aws/whats-new/2025/11/aws-kms-edwards-curve-digital-signature-algorithm), [KMS Sign API](https://docs.aws.amazon.com/kms/latest/APIReference/API_Sign.html)).

### 14.2 Per-finding verdicts

**RESOLVED** means the design change the review required is in the ADRs, contract, data model and requirements, consistently, and is testable. **PARTIAL** means part of the required effect is not achieved by the design as written. Implementation evidence (SEC-TC) is still owed for every row by G3.

| Finding | Sev | Verdict | Evidence (design level) | Residual and follow-ups |
|---|---|---|---|---|
| SEC-P3-01 | HIGH | **RESOLVED** | C1: 30-day cap and `SESSION_EXPIRED` (ADR-0006 am. 12; REQ-AUTH-007; data-model §3.1 :1070, :1102). C2: `auth_time` and the step-up scopes on all 10 operations (§14.1). C3: REQ-AUTH-020/021/022 are Must (D-046, D-047). C4: D-038 superseded by D-046, NFR-SEC-004 updated. The 7-day fallback is recorded in the ADR, REQ, NFR and DECISIONS | Session residual LOW, as adjudicated in §5 (a). The saved-card path rests on ruling 1, which needs SEC-P3-28 (MEDIUM). |
| SEC-P3-02 | HIGH | **RESOLVED** | ADR-0010 am. 1–6: two pools, anonymous share plus global bucket, quota guard, `LOCAL_REJECT`, subscribe-only streams, metrics. ADR-0014 am. 3 and ADR-0016 am. 9. REQ-CARR-017/022/023, REQ-BOOK-023, NFR-RES-007. Stream caps in the contract (:7063, :12776) and in README §7 and §9 | Paid bookings are decoupled from guest traffic, so the HIGH is closed. RR-03 stays (guests can still be denied). New SEC-P3-29 (MEDIUM): free or unverified accounts are outside the anonymous budget. Deadline-state drift is listed in SEC-P3-33. |
| SEC-P3-03 | HIGH | **PARTIAL: HIGH closed, residual MEDIUM** | Items 2–6 are fully designed. Item 7 is recorded as a G4-production precondition (ADR-0007 am. 7; R-ARCH-18; D-ARCH-019). Item 1 is designed for direct DDL: the migrator gets "must be owner", and the `sql_drop` guard covers drop-by-schema-owner | Item 1's stated effect ("tampering needs the cluster superuser") is **not** achieved. `ensure_audit_partitions` is `SECURITY DEFINER`, owned by `platform_audit_owner`, with `search_path = pg_catalog, public`, and `public` is owned by `platform_migrator`. A function-overload hijack therefore runs migrator code as the audit owner, and the DDL guard admits it. The anchors still bound undetected rewriting to entries younger than the last anchor (≤ 1 h), so the HIGH becomes MEDIUM. The exact change is in **SEC-P3-27**, due at P4 exit. |
| SEC-P3-04 | HIGH | **RESOLVED** | `.npmrc` `ignore-scripts=true`, and `--ignore-scripts` on every install in platform.md. Allow-listed `deps:rebuild`; lane A `check-install-flags`; a repository test against `pre*`/`post*` scripts. `DEP_MIN_AGE_DAYS=7` with an override register; Dependabot `cooldown`. `check-lockfile` (registry source, sha512) and `npm audit signatures`. Image-job isolation (ADR-0023 am. F; platform.md §3.2, §7.1; R-ARCH-20; D-ARCH-020) | Enforcement is due before the first `npm ci` in Wave 0. Unflagged `npm ci` text outside platform.md (SEC-P3-33) is not exploitable, because `.npmrc` is the backstop. Hardening: `npx --no-install` and gate tooling run from the base ref (SEC-P3-31, LOW). |
| SEC-P3-05 | MEDIUM | **RESOLVED** | ADR-0006 am. 15 withdraws the wrong claim. `email-send` class plus `registration_probe` (DR-A22, NFR-SEC-005, REQ-SEC-012). RR-16 accepted in D-049 (PRD R-12). | The new event is missing from README §13 (SEC-P3-30). |
| SEC-P3-06 | MEDIUM | **RESOLVED** | ADR-0006 am. 15. REQ-AUTH-004: verification revokes the other sessions. REQ-AUTH-012: a redeemed reset token verifies the mailbox. REQ-AUTH-026: 7-day expiry. DR-A04, the e-mail wording and the seam rule against automatic linking (D-050) | New residual **RR-19 (LOW)**: a victim tricked into redeeming the verification link of an account they did not create gives the password-holding attacker a *verified* account. The attacker's session dies, but they can sign in again until the owner resets the password. Mitigated by the e-mail wording, the "account already exists" reset path and the 7-day expiry. Optional for product-manager (non-blocking): an anonymous verification redemption requires sign-in first. |
| SEC-P3-07 | MEDIUM | **RESOLVED** | ADR-0023 am. G items 1–6: recomputed verdict, manifest with `skipped = 0`, untracked and `SKIP_*` checks, narrowed exemption, a hosted `security-integration` job that degraded mode never waives, and a wave-end cross-check with revert. platform.md §7.2; R-ARCH-19; D-ARCH-021 | Gate scripts run from the PR head (SEC-P3-31, LOW). The manifest's "catalog C1–C12" must read C1–C14 (SEC-P3-33). |
| SEC-P3-08 | MEDIUM | **RESOLVED** | ADR-0018 am. 1: a 24-entry key register with `key_id`, `_PREVIOUS` and AAD = table ‖ column ‖ row id/token ‖ key_id; duplicate and short keys are rejected. Encrypted carrier token cache (ADR-0010 am. 7); Valkey ACL users (ADR-0013 am. 4). `carrier-sandbox` environment secrets plus `check-workflow-policy` (ADR-0023 am. H). Restricted `rk_test_` key and one webhook secret per endpoint (ADR-0012 am. 2). Staging placeholder refusal, debug flags refused, developer-host hygiene. data-model §10.4 `*_key_id` siblings | D-ARCH-022 says the register has 20 entries; ADR-0018 has 24 (SEC-P3-33). |
| SEC-P3-09 | MEDIUM | **RESOLVED** | ADR-0019 am. 1 (a)–(e): `invoice_print: FULL \| MASKED` with default `MASKED`; SENSITIVE documents never attached; Viewer lacks `document:download`, `document:email` and `privacy:export`; render-only decryption; SSE. REQ-COMP-001, REQ-DOC-010, REQ-NOTIF-008, REQ-RBAC-004; D-051. | Legal `reviewed_by` on the `FULL` list stays a precondition before M5 (A-097). |
| SEC-P3-10 | MEDIUM | **RESOLVED** | Both routes `not-applicable`, with no key parameter or replay header (§14.1). README §5 scope rewritten. ADR-0014 am. 4 (list gains `activateTotp`). data-model §3.10 :1830 backstop index `ux_quote_shares__quote_active`. D-ARCH-023. | Ruling 3 conditions (SEC-P3-32, LOW). README §5 still calls `activateTotp` "proposed" (SEC-P3-33). |
| SEC-P3-11 | MEDIUM | **RESOLVED** | Server: 30-minute sliding admin refresh, `LEAST(now + 30 min, absolute)` (ADR-0006 am. 13; data-model :1102; `refreshSession` :546). Client: the idle clock counts input only, with an `alertdialog` at 28 min and logout at 30 min (ADR-0026 am. 8). REQ-ADMIN-004 (D-052 a) | Usability note: share the last-input time across admin tabs, so an idle tab's logout does not end the session of an active tab (SEC-P3-33). |
| SEC-P3-12 | MEDIUM | **RESOLVED** | Payload v2 carries IDs only (ADR-0013 am. 1). `platform.job_context(kind, id)`, owned by `platform_definer`, resolves the context before `withTenantTx` (data-model §4.5 :2675–2738; outbox :3322; saga :3419). Joi validation at dequeue; DLQ plus `job_context_mismatch`; ACL users; ADR-0005 am. 7; D-ARCH-025 | A forged job can only re-run work inside the named row's own tenant. Steps are idempotent and re-check state (ADR-0014 am. 2). Accepted. |
| SEC-P3-13 | MEDIUM | **RESOLVED** | ADR-0010 am. 8: `$blob` descriptors, allow-list redaction of tracking and response payloads, property test with a sentinel PDF. REQ-CARR-018; data-model §3.8 :1701; D-ARCH-026. | None. |
| SEC-P3-14 | MEDIUM | **RESOLVED** | ADR-0006 am. 14. `requestTotpEnrolmentCode` (:1249) and `enrolTotp.enrolment_code` with 403 `MFA_ENROLMENT_CODE_REQUIRED` (:1327). `mfa_enrolment_codes`, `first_signed_in_at` (:991) and the AP-ID-19 suspension job. Seeds without passwords; D-ARCH-027, D-052 (c) | REQ-AUTH-018 disagrees with the ADR on the deadline start, the wrong-code response and the re-enable path (SEC-P3-33). Align before identity stories. |

Status of the LOW and INFO backlog (owner backlog, not gate conditions):

- **Designed:**
  - SEC-P3-15: ADR-0026 am. 9, REQ-QUOTE-002.
  - SEC-P3-21: items 1 (flags), 2 and 3 (ADR-0012 am. 3), 4 (ADR-0010 am. 9) and 5 (ADR-0021 am. 2).
  - SEC-P3-22: D-ARCH-003 rev 2, NFR-SEC-012.
  - SEC-P3-25: items a, b, c and e.
- **Still open, as listed in the last row of §13:**
  - SEC-P3-16, 17, 18, 19, 20, 23, 24 and 26;
  - SEC-P3-21 item 1, edge strip of `X-Mock-Scenario`;
  - SEC-P3-25 item d: ADR-0023 §1 and the Consequences section still claim artifact attestations.

### 14.3 Rulings on the three alternatives

**(1) CVC recollection as the only saved-card step-up (no conditional re-auth header on `checkoutOrder`). Ruling: ACCEPTED as equivalent, conditional on SEC-P3-28.**

- **Why it is equivalent.** On this path, the threat SEC-P3-01 addresses is a session hijacker spending with a card they do not hold. A re-auth proof asks for the account password; recollection asks for the card's CVC. The thief of a refresh cookie normally has neither, and the CVC binds the step-up to the asset at risk.
- **What else it gets right.**
  - It keeps PCI SAQ A, because the CVC stays in the Stripe iframe.
  - It avoids a second UX path.
  - Start-up refuses saved cards on any gateway without `capabilities().cvcRecollection`.
- **Its weakness.** *Collection is not verification.* Whether a wrong CVC blocks the authorisation depends on the issuer and on Radar, and Radar's CVC rule does not act when the check is `unavailable`. The design never reads `cvc_check`.
- **Condition.** With SEC-P3-28, the alternative is equivalent: authorisation counts only when `cvc_check = pass`; otherwise the authorisation is voided. It needs no header, because `createReauthProof` already advances `auth_time`, so "confirm it's you, then retry" is the fallback when an issuer returns `unavailable`.

**(2) ECDSA P-256 instead of Ed25519 for audit anchors. Ruling: ACCEPTED (compliant; this was not a deviation).**

- **Compliance.** SEC-P3-03 item 4 allowed "Ed25519 or ECDSA P-256".
- **Why P-256 is sound.**
  - It is FIPS 186-5 approved, offers a 128-bit security level and verifies with a stock `openssl dgst` command.
  - Signing happens only through Node `crypto.sign` (OpenSSL) or KMS `Sign`, so nonce generation is not in our code.
  - ECDSA signatures are malleable, but that is harmless here. Anchor identity and the `prev_anchor_hash` chain use `anchor_hash`, never the signature bytes, and the byte-identical table/sink comparison flags a malleated copy as `ANCHOR_MISSING`.
- **The stated reason is outdated.** AWS KMS has signed with Ed25519 since 2025-11-07. That is not a reason to switch, but the rationale in ADR-0007 am. 7 item 4, data-model §5.5 :3113 and D-ARCH-019 must be corrected (SEC-P3-33).
- **Verification conditions (SEC-TC-44 amended).**
  - The verifier accepts only `algorithm = 'ECDSA_P256_SHA256'`, and only keys from `AUDIT_ANCHOR_PUBLIC_KEYS` selected by `key_id`, never a key or algorithm taken from the record.
  - DER is parsed strictly.
  - No in-house ECDSA code.
  - Public-key fingerprints are published in the release dossier, so a third party can obtain an authentic key.

**(3) `createQuoteShare` mint-and-revoke instead of 409 `SHARE_EXISTS`. Ruling: ACCEPTED (compliant; SEC-P3-10 item 3 offered both).**

- **Why it is preferable.**
  - It never needs the clear token.
  - It lets a user rotate a leaked link.
  - A partial unique index backs it.
  - It stays out of the idempotency store.
- **Side effect, accepted.** Any member holding `quote:share` can revoke another member's link to the same quote. This stays within the tenant and is audited.
- **Conditions.** Auditing of the implicit revocation, a per-quote mint cap and an identical 404 on resolve (SEC-P3-32).

### 14.4 New findings from the verification

| ID | Title | Sev | CWE | OWASP | Location | Owner | Due |
|---|---|---|---|---|---|---|---|
| SEC-P3-27 | The audit owner's `SECURITY DEFINER` function searches the migrator-owned `public` schema, so a function-overload hijack escalates the migrator to `platform_audit_owner` (residual of SEC-P3-03) | MEDIUM | CWE-426 / CWE-427 | A08 | `data-model.md:3001-3006, 3018, 3023, 2539, 2559, 2936`; ADR-0007 am. 7 item 1 | data-architect + principal-architect | P4 exit |
| SEC-P3-28 | CVC recollection is collected but its outcome (`cvc_check`) is never verified (condition of ruling 1) | MEDIUM | CWE-304 | A07 | ADR-0012 am. 1 (:38); ADR-0006 am. 12; `openapi.yaml:12294, 12917, 19613-19621, 19720` | principal-architect + api-designer | P4 exit (design); with the payments story (code) |
| SEC-P3-29 | Free or unverified accounts are outside the carrier anonymous budget, so one account can push a carrier's daily quota to 90 % and stop rate shopping for everyone (residual of SEC-P3-02) | MEDIUM | CWE-770 | A04 (API4:2023) | ADR-0010 am. 2–3; REQ-CARR-022/023; `api/README.md:178`; REQ-AUTH-004 note | principal-architect + product-manager | P4 exit (design); US-293 (code) |
| SEC-P3-30 | The security event catalogue (`api/README.md` §13) lacks the events introduced by the remediation | LOW | CWE-778 | A09 | `api/README.md:443-464`; REQUIREMENTS.md:359 | api-designer + product-manager | P4 exit |
| SEC-P3-31 | Gate scripts run from the PR's own tree; tooling paths are not security-critical; `npx` may fetch outside the lockfile | LOW | CWE-345 / CWE-829 | A08 | ADR-0023 am. F, G; `platform.md:241-242, 803-808` | platform-architect + devops-engineer | Wave 0 CI tasks |
| SEC-P3-32 | Share mint-and-revoke details: revocation audit, mint cap, uniform 404 | LOW | CWE-778 / CWE-770 | A09 / A04 | `openapi.yaml:7629-7693`; `data-model.md:1830` | api-designer + data-architect | Before US-165 (REQ-QUOTE-015) |
| SEC-P3-33 | Documentation drift left by the remediation | INFO | n/a | n/a | see detail | principal-architect, product-manager, api-designer, sdlc-orchestrator (CLAUDE.md) | P4 exit |

#### SEC-P3-27: The audit owner's definer function searches a migrator-owned schema (MEDIUM)

- **CWE-426** Untrusted Search Path, CWE-427 · **OWASP A08:2021** · ASVS 7.3.3, 1.4.3 (least privilege). This is the CVE-2018-1058 class; see the PostgreSQL guidance "Writing SECURITY DEFINER Functions Safely" (CREATE FUNCTION).
- **Location:**
  - `data-model.md:3001-3006`: `platform.ensure_audit_partitions` is `SECURITY DEFINER` with `SET search_path = pg_catalog, public`, owned by `platform_audit_owner` (:3043).
  - `:3018`: `pg_advisory_xact_lock(hashtext('audit:partitions'))`.
  - `:3023`: `to_char(v_month, 'YYYY_MM')` with `v_month date`.
  - `:2539, :2559`: `platform_migrator` owns schema `public`.
  - `:2936`: the guard admits `current_user = 'platform_audit_owner'`.
- **Description.**
  1. **Overload resolution favours the better match.** PostgreSQL resolves an unqualified call over every schema on the path. Being first on the path wins only between functions with *identical* argument types; a better-matching overload in a later schema wins outright.
  2. **The hijack.** `hashtext()` returns `integer`, and `pg_catalog.pg_advisory_xact_lock` takes `bigint` (or two integers). A `public.pg_advisory_xact_lock(integer)` created by the migrator, which owns `public`, is therefore an exact match and is called instead. `public.to_char(date, text)` likewise beats the `timestamp` variants.
  3. **What the planted body can do.** The daily `audit-maintenance` job calls the function, and the lock runs on every call, even when no partition is due. The planted body executes with `current_user = platform_audit_owner`, so it can:
     - `ALTER TABLE public.audit_entries DISABLE TRIGGER ALL`;
     - rewrite rows;
     - `GRANT UPDATE … TO platform_migrator` for persistence.

     The identity-based guard admits all of it, by design.
  4. **Secondary weaknesses in the same component:**
     - The trigger functions `audit_forbid_mutation` and `audit_vault_guard` set no `search_path`. Their unqualified `format()` call runs as the invoker, which includes the superuser in the bootstrap lane.
     - `audit_ddl_guard` sets `search_path = pg_catalog` without `pg_temp`, so `pg_temp` is searched first for relations. In the migrator's own session, a temporary `pg_index` or `pg_class` shadows the catalog in the index branch.
     - The guard matches schemas by name. As owner of `public` (and with `CREATE` on the database), the migrator can `ALTER SCHEMA public RENAME TO x`. Audit writes then fail closed, and the guard blocks renaming it back. This is a denial of service that needs superuser repair, not an integrity breach.
     - The bootstrap lane runs `SET ROLE platform_audit_owner` with the default `search_path` (`"$user", public`).
- **Exploitability and impact.** Likelihood L: it needs the migrator credential (held by the migrate job, CI, developers and agents) plus this technique. Impact H, not C:
  - the worker-held signing key and the external sink still detect any change to an anchored entry;
  - so the attacker gets the ≤ 1 h window, plus persistent grants.

  That is the same window as the accepted superuser residual (RR-04), but reachable with a far more widely held credential. H × L = MEDIUM.
- **Required change (data-architect; principal-architect approves; P4 exit):**
  1. Every function owned by `platform_audit_owner` (`ensure_audit_partitions`, `audit_forbid_mutation`, `audit_vault_guard`), and `audit_ddl_guard`, declares `SET search_path = pg_catalog, pg_temp`, with `pg_temp` explicitly last. Functions and operators are then resolved in `pg_catalog` only. Relations stay `public.`-qualified, as now.
  2. As defence in depth, `ensure_audit_partitions` qualifies built-ins with explicit casts:
     - `PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('audit:partitions')::bigint)`;
     - `pg_catalog.to_char(v_month::timestamp, 'YYYY_MM')`;
     - `pg_catalog.uuidv7()`;
     - `pg_catalog.format(…)`.
  3. `audit_ddl_guard` qualifies `pg_catalog.pg_index`, `pg_catalog.pg_class` and `pg_catalog.pg_namespace`. It matches the two schemas **by OID**, not by name, so `ALTER SCHEMA public|platform RENAME` raises. Either the bootstrap writes the OIDs into the function body, or the guard derives them from `relnamespace` of the relations owned by `platform_audit_owner`.
  4. Every bootstrap-lane script starts with `SET search_path = pg_catalog, pg_temp;` before `SET ROLE platform_audit_owner`, and qualifies every object.
  5. **C11** asserts that `proconfig` holds exactly `search_path=pg_catalog, pg_temp` for every `SECURITY DEFINER` function. This includes the §4.5 `platform_definer` functions: there is no escalation there, because the migrator already holds `platform_definer`, but one uniform rule is easy to test. **C14** asserts the same for the audit-owner functions and the guard.
  6. *Recommended, not required:* transfer ownership of the `public` and `platform` schemas to a `NOLOGIN` role with no members, and grant `platform_migrator` `USAGE, CREATE`. This closes drop-by-schema-owner and schema renames by privilege without renaming any relation, and is cheaper than the dedicated `audit` schema that §4.4 defers to M5.
  7. ADR-0007 am. 7 item 1 ("tampering needs the cluster superuser") cites this finding. The sentence is true only after items 1–4.
- **Verification.** SEC-TC-61; C11 and C14 as amended.

#### SEC-P3-28: CVC recollection outcome is not verified (MEDIUM; condition of ruling 1)

- **CWE-304** Missing Critical Step in Authentication · **OWASP A07:2021** · ASVS 4.3.3
- **Location:**
  - ADR-0012 am. 1 (:38) and ADR-0006 am. 12 "Saved-card checkout";
  - `openapi.yaml` `checkoutOrder` (:12294), `confirmPayment` (:12917) and `Payment.cvc_recollection_required` (:19720);
  - `CheckoutRequest.test_token` (:19613–19621) has no Mock CVC outcome, although ADR-0012 names `mock_cvc_required`.
- **Description.**
  - `require_cvc_recollection` makes the Payment Element collect a CVC. The issuer decides what a wrong CVC means, and Stripe documents successful charges despite a failed CVC check. The Radar rule ignores `unavailable` checks.
  - The design derives `AUTHORISED` from the retrieved PaymentIntent and never reads `payment_method_details.card.checks.cvc_check`.
  - A hijacker of a session older than 12 h can therefore type any three digits. Where the issuer does not verify the CVC, the payment is authorised and the saga books.
  - My original SEC-P3-01 text omitted this check as well. It is raised now as the condition for accepting ruling 1.
- **Exploitability and impact.** Likelihood M: it needs a hijacked session more than 12 h past the victim's last authentication and an issuer that does not verify. Impact M: shipments are paid with the victim's saved card, bounded by 5 attempts per order per hour, with confirmation e-mails to the victim and a chargeback path. M × M = MEDIUM.
- **Required change (principal-architect: ADR-0012 am. 1 and ADR-0006 am. 12; api-designer: contract; P4 exit):**
  1. When `requireCvcRecollection` was set, the payment-state derivation treats the authorisation as `AUTHORISED` only if the retrieved charge has `payment_method_details.card.checks.cvc_check = 'pass'`. One function covers both `confirmPayment` and the webhook processor.
  2. Any other value (`fail`, `unavailable`, `unchecked`, absent) leads to:
     - `voidAuthorisation` (manual capture, so no money moves);
     - payment `FAILED` with the existing `failure_code = AUTHENTICATION_FAILED`;
     - an audited `UPDATE payment` and the security event `cvc_recollection_failed`;
     - shipments back to `QUOTED`, with the attempt counted.
  3. The client then offers "use another card" (hosted fields) or "confirm it's you" (`createReauthProof`, which advances `auth_time`, so the retried checkout needs no CVC). No new header or extension is needed, which keeps the single-mechanism decision.
  4. ADR-0012 records the Radar rule "Block if CVC verification fails" as enabled on the test account, as defence in depth.
  5. The contract exposes the Mock outcomes (CVC pass, fail and unavailable) through `test_token` or a documented Mock setting.
- **Verification.** SEC-TC-37 as amended in §14.5.

#### SEC-P3-29: Authenticated or unverified accounts can drain a carrier's daily quota (MEDIUM; residual of SEC-P3-02)

- **CWE-770** · **OWASP A04:2021**, API4:2023 · ASVS 11.1.4
- **Location:**
  - ADR-0010 am. 2–3 and REQ-CARR-022/023: the anonymous bucket and the 60 % stop apply to guests only.
  - `api/README.md:178`: an authenticated `createQuote` counts in the `authenticated` class, 600/min per user.
  - REQ-AUTH-004 note: unverified users can sign in, so they can quote.
- **Description.**
  - Registration is free and needs no verification to quote. One account at 600 quotes/min fans out to every eligible carrier account.
  - With the seeded DHL sandbox quota of 500 per day, the 90 % threshold is reached within about a minute. Authenticated rate shopping to that carrier then stops for every customer until 00:00 UTC.
  - Paid bookings stay protected by the transactional reserve, and the carrier account is not suspended, so SEC-P3-02 stays closed. This is the remaining path to deny the booking funnel.
- **Exploitability and impact.** Likelihood H: one account is enough. Impact M: one carrier's quotes are unavailable for up to a day, while other carriers and cached results still answer. → MEDIUM.
- **Required change (principal-architect: ADR-0010 amendment; product-manager: values in REQ-CARR-022/023 and DR-A22):**
  1. Users in `PENDING_VERIFICATION` count as **anonymous** for the carrier budget: the bucket, the 50 % share and the 60 % stop.
  2. A **`quote-create` rate class** for authenticated callers replaces the 600/min class on `createQuote`. Proposed: 30/min and 300/h per user, 1,000/h per organisation; all configuration.
  3. Each organisation gets a **share of each carrier account's daily quota** for rates-pool calls (`CARRIER_QUOTA_ORG_SHARE_PCT`, proposed 10 %). Beyond it, that organisation gets `CARRIER_BUSY` or cached results, and the event `carrier_quota_org_share_exhausted` fires (at most once a minute).
- **Verification.** SEC-TC-62.

#### SEC-P3-30: Security event catalogue not updated (LOW)

- **Gap.** `api/README.md` §13 lists 14 events, and the new ones match 0 times there:
  - `registration_probe`, `carrier_quota_pressure` and `carrier_anon_budget_exhausted`, although REQ-SEC-012 (REQUIREMENTS.md:359) lists them and says "names added here must appear there";
  - `job_context_mismatch` (ADR-0013 am. 2), `webhook_livemode_rejected` (ADR-0012 am. 3) and `audit_anchor_missing` (data-model §5.6), which no requirement lists;
  - `cvc_recollection_failed` (SEC-P3-28) and `carrier_quota_org_share_exhausted` (SEC-P3-29), which this verification adds.
- **Why it matters.** Alerting and the `security_events_total` metric are built from the catalogue, so uncatalogued events would go unmonitored (A09).
- **Required change.**
  - api-designer adds the events to §13, with fields and the related audit action.
  - product-manager adds the ADR-only events to REQ-SEC-012.
  - A contract test asserts that the event names in `packages/shared` equal the §13 table.
- **Verification.** SEC-TC-63.

#### SEC-P3-31: Gate and install tooling hardening (LOW)

1. **Gate scripts run from the PR head.** `quality:check-evidence`, `tools/quality/required-suites.json`, `check-install-flags`, `check-lockfile` and `check-workflow-policy` run from the PR's own checkout, so one PR can weaken a gate and pass it in the same change.
   - Required: lane A runs these scripts and the manifest from the base commit (`github.event.pull_request.base.sha`, a second sparse checkout).
   - Required: `tools/quality/**`, `tools/ci/**`, `.github/**` and `.npmrc` join the security-critical path list of ADR-0023 am. G item 5, and a change to them needs a security-analyst review in the DoD.
2. **`npx` can fetch packages.** `npx prisma generate` and `npx playwright install` would download from the registry when the local binary is missing, outside the lockfile, cooldown and signature checks.
   - Required: use `npm exec --no -- prisma generate` (or `npx --no-install`) in `deps:rebuild` and in the docs.

Verification: SEC-TC-64.

#### SEC-P3-32: Share mint-and-revoke details (LOW; conditions of ruling 3)

1. The implicit revocation of the previous share writes its own audit entry in the same transaction: `UPDATE quote_share`, `revoked_at` from null to a value, actor. The contract's `x-audit` lists only `CREATE quote_share`.
2. A per-quote mint cap, proposed at 10 per quote per hour (then 429). Without it, the 600/min `authenticated` class lets one user write about 36,000 revoked rows an hour.
3. `resolveSharedQuote` answers the identical 404 for unknown, revoked and expired tokens, as the contract already states for revoked ones.

Verification: SEC-TC-53 as amended.

#### SEC-P3-33: Documentation drift left by the remediation (INFO)

1. **ECDSA rationale.** "AWS KMS offers no Ed25519 signing" is outdated (supported since 2025-11-07). Correct ADR-0007 am. 7 item 4, data-model §5.5 :3113 and D-ARCH-019; the choice stands (ruling 2).
2. **Unflagged `npm ci` text outside platform.md:**
   - `CLAUDE.md:11` (owned by sdlc-orchestrator);
   - `ADR-0023:11` and `:43`: amended by am. F, but with no inline "amended" marker as ADR-0006 uses;
   - `nfr-strategy.md:152` (OPS-002 `npm ci --omit=dev`);
   - `ADR-0002:39` (prose in the alternatives).

   `.npmrc` makes them harmless, but agents follow `CLAUDE.md` literally.
3. **REQ-AUTH-018 vs ADR-0006 am. 14 and the contract:**
   - deadline start: membership creation vs `first_signed_in_at`;
   - wrong code: 401 `MFA_INVALID` vs 403 `MFA_ENROLMENT_CODE_REQUIRED`;
   - re-enable path: re-run the seed vs `ops:staff-reactivate`.
4. **Saga deadline state.** REQ-BOOK-023 says DRAFT when the deadline passes under `CARRIER_BUSY`; ADR-0014 am. 3 says EXCEPTION. DRAFT is the accurate state, because no carrier call was made.
5. `api/README.md` §5 still calls `activateTotp` "proposed" for the one-time-secret list; ADR-0014 am. 4 added it.
6. D-ARCH-022 says the key register has "20" entries; ADR-0018 lists 24.
7. ADR-0023 am. G and D-ARCH-021 name the security catalog suite "C1–C12"; it is C1–C14 (data-model §4.6 note).
8. ADR-0023 §1 and the Consequences section still claim artifact attestations (SEC-P3-25 item d; platform.md:281 says they are unavailable).
9. **Re-auth proof vs idempotent replay** on the four `payment_method.manage` routes (`x-idempotency: optional`, single-use proof). Specify in README §5 and §8 that a replay (same scope, actor, key and fingerprint) is served before the proof check, and that any new execution needs a fresh proof.
10. **M5, for platform-architect.** On RDS the bootstrap master is not a superuser. In PostgreSQL 16+, a `CREATEROLE` role that creates `platform_audit_owner` receives ADMIN membership automatically, so C13's "no `pg_auth_members` row" will fail on RDS. At M5, allow exactly that row (ADMIN, no SET or INHERIT) and treat it as break-glass, like the RDS master.
11. **Admin idle clock across tabs.** Share the last-input time across tabs (`BroadcastChannel`, as the single-flight refresh already does). Usability only.

### 14.5 Security test case changes

| ID | Change |
|---|---|
| SEC-TC-37 (amended) | Saved-card checkout with `auth_time` more than 12 h old produces a PaymentIntent with `require_cvc_recollection=true`. With the Mock CVC result `fail` or `unavailable`, the payment is `FAILED/AUTHENTICATION_FAILED`, the authorisation is voided, no saga starts and `cvc_recollection_failed` is emitted. With `pass`, it is `AUTHORISED`. After `createReauthProof`, the retried checkout has `cvc_recollection_required=false`. The same derivation applies on the webhook path |
| SEC-TC-44 (amended) | An anchor record whose `algorithm` is anything other than `ECDSA_P256_SHA256`, or whose `key_id` is unknown, gives `CHECKPOINT_SIGNATURE_INVALID`. A malleated `(r, n−s)` signature written to the table only gives `ANCHOR_MISSING` (table and sink disagree) |
| SEC-TC-53 (amended) | A second `createQuoteShare` writes `CREATE` plus `UPDATE quote_share` (revoked) audit entries. The 11th mint for one quote within an hour returns 429. Resolving an unknown, a revoked and an expired token gives three byte-identical 404 bodies |
| SEC-TC-61 (new) | As `platform_migrator`, create `public.pg_advisory_xact_lock(integer)` and `public.to_char(date, text)`; their bodies insert a marker into a migrator-owned table and try `ALTER TABLE public.audit_entries DISABLE TRIGGER ALL`. Then, as `platform_app`, call `platform.ensure_audit_partitions(3)`: it succeeds, no marker row exists and every audit trigger is still enabled. `ALTER SCHEMA public RENAME TO x` and `ALTER SCHEMA platform RENAME TO y` as the migrator both raise. C11 and C14 `proconfig` assertions pass |
| SEC-TC-62 (new) | With Mock and `CARRIER_DAILY_QUOTA=500`: an unverified account is throttled by the anonymous bucket. A verified account gets 429 from `quote-create` after 30 per minute. One organisation cannot push an account's daily usage past its 10 % share (`CARRIER_BUSY` or cached results, plus `carrier_quota_org_share_exhausted`), while another organisation's quotes still fan out |
| SEC-TC-63 (new) | Contract test: the security-event names in `packages/shared` equal the README §13 table, including the eight names from SEC-P3-30 |
| SEC-TC-64 (new) | A PR fixture that edits `tools/quality/check-evidence.mjs` to always pass still fails lane A on bad evidence, because the base-ref copy ran. `deps:rebuild`, with the local Prisma binary removed, fails instead of downloading |

All seven are tagged `@security` and listed in the SEC-P3-07 required-suite manifest.

### 14.6 ASVS 4.0.3 L2 checklist delta (design level; replaces the gap cells of §7 where stated)

| Chapter | Status now | What changed |
|---|---|---|
| V1 | partial | 1.6.1/1.6.3 key register and rotation are designed (SEC-P3-08). Open: 1.4.3 least privilege for the definer search path (SEC-P3-27); TLS deferred to M5 |
| V2 | partial | Enumeration accepted (RR-16); pre-hijack fixed; staff first enrolment bound to the mailbox. Open: 2.6.2 recovery codes (SEC-P3-16, backlog) |
| V3 | **pass at design (documented deviation)** | 3.3.2 "L2 deviation, compensated; L1 met" (D-046); 3.3.4 Must (D-047); admin idle mechanism (SEC-P3-11). Open: 3.3.x cross-user revocation (SEC-P3-19, backlog) |
| V4 | partial | 4.3.3 step-up designed. Open: the saved-card result check (SEC-P3-28). Worker context (SEC-P3-12) fixed |
| V6 | **pass at design** | AAD, `key_id`, register (SEC-P3-08); KMS envelope deferred to M5 |
| V7 | partial | 7.3.3: owner separation and signed hourly anchors. Open: SEC-P3-27; locked sink at M5; event catalogue (SEC-P3-30) |
| V8 | partial | Customs invoice distribution and blob redaction fixed. Open: 8.3.2 export and erasure deferred (RR-05) |
| V10 / V14.2.4 | **pass at design** | Install scripts, cooldown and lockfile source (SEC-P3-04). Hardening in SEC-P3-31 |
| V11 | partial | 11.1.4 for guests fixed. Open: authenticated and unverified accounts (SEC-P3-29) |
| V13 | **pass** | Idempotency contract drift fixed (SEC-P3-10) |

### 14.7 Updated verdict

**APPROVED_WITH_CONDITIONS** (unchanged class; the content changed).

**Is any Critical or High design risk still open? No.**

- **The four HIGHs.** SEC-P3-01, 02 and 04 are resolved at design level. SEC-P3-03 is PARTIAL: its HIGH is reduced to MEDIUM, because the anchors bound undetected rewriting to the last hour whoever the attacker is, and it closes fully when SEC-P3-27 lands.
- **Highest open severity: MEDIUM.**
  - Design changes due at P4 exit: SEC-P3-27, 28 and 29.
  - Accepted residuals: RR-03, and RR-04, which SEC-P3-27 restores to the superuser-only actor.
- **No Medium due at P4 exit remains open.** SEC-P3-05..14 are all RESOLVED at design level.
- **Rulings.** All three alternatives are accepted; (1) depends on SEC-P3-28.
- **What stays owed.** Implementation evidence for every condition (SEC-TC) is due by G3.

G2 can treat the items below as conditions (PASS_WITH_CONDITIONS). None needs re-architecture: each is an SQL attribute, an ADR paragraph, a rate-limit class or a contract enum.

### 14.8 Conditions that remain

| Condition | Content | Owner | Due | Closure evidence |
|---|---|---|---|---|
| SEC-COND-01 | Design **closed**. Fallback `AUTH_REFRESH_TTL=7d` still applies if the step-up does not ship with the payments and organisation stories | product-manager, principal-architect, api-designer | G3 | SEC-TC-37 (amended) and SEC-TC-38 green |
| SEC-COND-02 | Design **closed** | principal-architect | G3 | SEC-TC-26, 40, 41, 42 green |
| SEC-COND-03 | Design **partial**: closes when SEC-COND-05 lands. Item 7 (locked sink, RDS master break-glass, `pgaudit`) stays a G4 precondition for any production release, plus SEC-P3-33 item 10 | principal-architect, data-architect; platform-architect (M5) | P4 exit (design); G3 (tests); G4-production (sink) | SEC-TC-17, 43, 44 (amended), 61 green |
| SEC-COND-04 | Design **closed** | platform-architect, devops-engineer | Before the first `npm ci` in Wave 0 | SEC-TC-32 and 45 green in Wave 0 |
| **SEC-COND-05** (new) | SEC-P3-27: `search_path = pg_catalog, pg_temp` on the audit-owner functions and the guard; qualified built-ins; OID-based schema match; bootstrap `search_path`; C11/C14 assertions | data-architect, principal-architect | **P4 exit** | data-model §4.4/§5.2/§5.3/§4.6 amended; SEC-TC-61 green by G3 |
| **SEC-COND-06** (new) | SEC-P3-28: `cvc_check = pass` rule with void otherwise; Mock CVC outcomes in the contract; Radar rule noted | principal-architect, api-designer | **P4 exit** (design); with the payments story (code) | ADR-0012 am. 1 and contract amended; SEC-TC-37 (amended) green by G3 |
| **SEC-COND-07** (new) | SEC-P3-29: unverified users count as anonymous; `quote-create` class; per-organisation quota share | principal-architect, product-manager | **P4 exit** (design); US-293 (code) | ADR-0010 amendment, REQ-CARR-022/023 and DR-A22 amended; SEC-TC-62 green by G3 |
| Medium tasks | SEC-P3-05..14: design closed | as §3 | Before the affected story (P5) | SEC-TC-03 (ext.), 20, 39, 46–53, 56 green by G3 |
| LOW / INFO, new | SEC-P3-30 (P4 exit), 31 (Wave 0 CI tasks), 32 (before US-165), 33 (P4 exit; item 10 at M5) | as §14.4 | as listed | SEC-TC-53 (amended), 63, 64; P5 change reviews |
| LOW / INFO backlog (Wave 0 and before the affected story) | SEC-P3-16 (`id-secret` recovery codes, peppered pre-hash); 17 (SYSTEM shard key from a server-side id); 18 (`x-origin-check` on login, register, reset, verify); 19 (`revoke_sessions_for_user`); 20 (edge bound to 127.0.0.1); 21 item 1 (edge strip of `X-Mock-Scenario`); 23 (cookie and header log redaction); 24 (CSP refinements, Trusted Types spike SPK-06); 25 item d (attestation wording); 26 (`auth_lookup_credential` call-site lint) | as §3 | as §3 "Due" | SEC-TC-12, 14, 22, 24, 25, 31 (ext.), 34 (ext.), 55, 57, 58, 59, 60; P5 change reviews |
| P6 / G3 | The SEC-P3-07 required-suite manifest lists every `@security` case (SEC-TC-01..64) with `skipped = 0`. security-analyst completes the ASVS L2 per-item checklist (NFR-SEC-001) against code. dependency-auditor runs the Wave 0 baseline (R-ARCH-12) | qa-lead, security-analyst | G3 | Verification report; SEC-P6 assessment |

Residual-risk register updates (§11):

| ID | Update |
|---|---|
| RR-03 | Extended: authenticated and unverified accounts as well as guests, until SEC-COND-07 lands |
| RR-04 | Reachable with the migrator credential, not only by the superuser, until SEC-COND-05 lands. Afterwards it is unchanged (superuser, ≤ 1 h) |
| RR-19 (new, LOW) | Tricked verification of a pre-registered account; product-manager to accept or apply the optional control in the SEC-P3-06 row of §14.2 |

## 15. Condition closure (principal-architect, P4)

Appended 2026-11-12 by principal-architect after G2 PASS_WITH_CONDITIONS (`docs/sdlc/gates/G2-attempt-1.md`, G2-C3) and in parallel with product-manager's requirement-side closures (D-053, D-055, D-056). Design level only; SEC-TC evidence is due at G3. security-analyst verifies these closures and records the result (suggested §16). Decisions: D-ARCH-029..034. data-architect and api-designer did the physical and contract parts; principal-architect integrated them.

| Item | Change | File:section |
|---|---|---|
| **SEC-COND-05 / SEC-P3-27** | `SET search_path = pg_catalog, pg_temp` on `ensure_audit_partitions`, `audit_forbid_mutation`, `audit_vault_guard` and `audit_ddl_guard`, and uniformly on every `SECURITY DEFINER` function (§4.5 list, `app_is_operator`, `job_context`) with schema-qualified relations; built-ins qualified with casts (`pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(…)::bigint)`, `pg_catalog.to_char(v_month::timestamp, …)`, `pg_catalog.format`, `pg_catalog.uuidv7`); the guard qualifies `pg_catalog.pg_class/pg_index/pg_namespace` and matches the protected schemas **by OID derived at call time** from the objects owned by `platform_audit_owner` (fail-closed when empty; not baked in because restores renumber OIDs), refusing `ALTER SCHEMA … RENAME`/`OWNER TO`/`COMMENT`/`DROP SCHEMA`; every bootstrap script starts with the same `SET search_path` before `SET ROLE`; **review item 6 adopted**: no-member `platform_schema_owner` owns `public` and `platform`, migrator `USAGE, CREATE`, `platform_definer` `CREATE` on `platform` (missing grant found); C11 asserts exactly one `proconfig` entry `search_path=pg_catalog, pg_temp` on every definer function, C14 the same on the three audit trigger/guard functions plus a superuser `ALTER SCHEMA … RENAME` that must raise; migration-linter rule 13; app-side advisory-lock calls qualified as defence in depth | `data-model.md` §4.2, §4.4 (00-roles, roles table, bootstrap block, amendment), §4.5, §4.6 C11/C13/C14, §5.2 (guard rewrite + amendment), §5.3, §5.4/§5.5 (qualified locks), §5.7, §7.3, §8.3 rule 13, §12 A13; `adr/ADR-0007` am. 8 items 1–4; `adr/ADR-0005` am. 8; `platform.md` §4.3 (RDS bootstrap `SET`/ADMIN row); `risks.md` R-ARCH-18 / SPK-08 extended; D-ARCH-033 |
| **SEC-COND-06 / SEC-P3-28** | When `requireCvcRecollection` was set, `AUTHORISED` only if the retrieved charge has `cvc_check = 'pass'`; otherwise `voidAuthorisation`, payment `FAILED/AUTHENTICATION_FAILED`, audited `UPDATE payment`, event `cvc_recollection_failed`, shipments back to `QUOTED`, attempt counted, no saga; one derivation function for `confirmPayment`, the Mock path and both webhooks; recovery = other card or `createReauthProof`; Mock `test_token` `mock_cvc_pass | mock_cvc_fail | mock_cvc_unavailable` (`mock_cvc_required` withdrawn); Radar rule "Block if CVC verification fails" recorded as test-account configuration (backstop, ignores `unavailable`) | `adr/ADR-0012` am. 4; `adr/ADR-0006` am. 12 (inline marker); `api/openapi.yaml` `CheckoutRequest.test_token`, `Payment.cvc_recollection_required`, `checkoutOrder` (paragraph, example `mock_saved_card_cvc_fail`, `x-audit.additional` UPDATE payment), `confirmPayment` (paragraph, example `cvc_check_failed`), `receiveStripeWebhook`, `receiveMockGatewayWebhook`; `api/README.md` header, §7 `checkoutOrder` row, §8, §13 `cvc_recollection_failed`; D-ARCH-030 |
| **SEC-COND-07 / SEC-P3-29** | `PENDING_VERIFICATION` users count as anonymous (per-IP `public-quote` limits and the whole anonymous carrier budget); new `quote-create` class for verified callers of `createQuote` (`RATE_QUOTE_CREATE_PER_USER_PER_MIN=30`, `…_PER_USER_PER_HOUR=300`, `…_PER_ORG_PER_HOUR=1000`, 429), declared in `x-rate-limit-route` while `x-rate-limit-class` stays `public-quote`; `CARRIER_QUOTA_ORG_SHARE_PCT=10` per organisation per account per UTC day → `CARRIER_BUSY`/cached results for that organisation only, event `carrier_quota_org_share_exhausted` (≤ 1 per account and organisation per minute); transactional calls never refused | `adr/ADR-0010` am. 10; `adr/ADR-0016` am. 11 (a); `api/openapi.yaml` `createQuote` (description, `x-rate-limit-route`); `api/README.md` §7 (`quote-create`, `public-quote`, `authenticated` rows and the class-selection paragraph), §9, §10, §13, §15; `nfr-strategy.md` RES-007; `nfr-traceability.md` NFR-RES-007; requirement side D-053 (product-manager: DR-A22, REQ-CARR-022/023, US-293); D-ARCH-031 |
| **SEC-P3-30** | README §13 gains `registration_probe`, `carrier_anon_budget_exhausted`, `carrier_quota_pressure`, `carrier_quota_org_share_exhausted`, `job_context_mismatch`, `webhook_livemode_rejected`, `audit_anchor_missing`, `cvc_recollection_failed` (22 events) with fields, audit action and source; SEC-TC-63 sentence (names in `packages/shared` = table, both directions) | `api/README.md` §13; requirement side D-056 (REQ-SEC-012) |
| **SEC-P3-32** | Implicit revocation audited as `UPDATE quote_share` (reason `SUPERSEDED`) via the new contract member `x-audit.additional[]`; mint cap `QUOTE_SHARE_MINTS_PER_HOUR=10` per quote per rolling hour (429, refused mint revokes nothing) counted in PostgreSQL inside the minting transaction over new index `ix_quote_shares__quote_created` (serialised by `ux_quote_shares__quote_active`, no Redis counter); `resolveSharedQuote` returns **one byte-identical 404 for unknown, revoked, superseded and expired tokens** per product-manager's D-055 (`quote_share_resolve` adds `expires_at > now()`; the v1.3 EC-B29 expired view is dropped). An interim principal-architect reconciliation that kept the expired 200 `EXPIRED` view was withdrawn the same day; **SEC-TC-53 stands as amended in §14.5** | `adr/ADR-0016` am. 11 (b–c); `adr/ADR-0014` am. 4 (unchanged); `api/openapi.yaml` `createQuoteShare` (`x-audit.additional`, `x-rate-limit-route`, 429), `resolveSharedQuote`, `SharedQuote`; `api/README.md` §5, §7 route row, §10 (`x-audit.additional`), §15; `data-model.md` §3.10 amendment (AP-QUO-09, index, resolve semantics), §4.5 `quote_share_resolve`, §12 A14; D-ARCH-032, D-055 |
| **SEC-P3-33 item 1** | ECDSA P-256 rationale corrected (KMS Ed25519 since 2025-11-07); choice stands for FIPS 186-5 and universal verifier support; `algorithm` enum extensible | `adr/ADR-0007` am. 8 item 5; `data-model.md` §5.5; D-ARCH-029 (supersedes the D-ARCH-019 sentence) |
| **item 2** | `npm ci` → `npm ci --ignore-scripts` with inline "amended (amendment F)" markers | `adr/ADR-0023` §1 `ci.yml` setup, am. A fast-lane row; `adr/ADR-0002` §Alternatives; `nfr-strategy.md` OPS-002. `CLAUDE.md:11` is the orchestrator's (replacement text in the P4 handoff) |
| **item 3** | REQ-AUTH-018 follows ADR-0006 am. 14 (deadline from first sign-in, 403 `MFA_ENROLMENT_CODE_REQUIRED`, `ops:staff-reactivate`) | product-manager D-056 (REQUIREMENTS.md v1.4); ADR unchanged |
| **item 4** | Deadline under `LOCAL_REJECT` → `DRAFT` (not `EXCEPTION`) | `adr/ADR-0014` am. 3 (corrected inline); REQ-BOOK-023 per D-056 |
| **item 5** | `activateTotp` definitive on the one-time-secret list | `api/README.md` §5, §15 assertion 9 |
| **item 6** | D-ARCH-022 "20 entries" vs ADR-0018's 24 noted (DECISIONS.md is append-only) | D-ARCH-029 |
| **item 7** | C1–C12 → C1–C14 | `adr/ADR-0023` am. G items 2 and 5; `platform.md` §7.3 `security-integration` row; D-ARCH-029 (D-ARCH-021 correction) |
| **item 8** | Provenance attestations deferred to M5 (OI-10; cosign keyless / KMS / public repo) | `adr/ADR-0023` §1 `release.yml`, §Consequences |
| **item 9** | On the four `payment_method.manage` routes a replay (same scope, actor, key, fingerprint) is served before the proof check and consumes no proof; new executions need a fresh proof | `api/README.md` §5 "Replay and re-auth proof", §8 |
| **item 10** | C13: locally no `pg_auth_members` row; on RDS exactly one ADMIN-only row per no-member role for the bootstrap master (`admin_option = true`, `set_option = false`, `inherit_option = false`), break-glass | `data-model.md` §4.6 C13, §12 A15; `platform.md` §4.3; `risks.md` SPK-08 |
| **item 11** | Admin idle clock shared across tabs via `BroadcastChannel` (usability) | `adr/ADR-0026` am. 8; D-UX-032 |
| G2-C1 / G2-C2 (gate, not security) | NFR-RES-007 rows and 91 totals; Design column for 434 REQs; §6 catalogue 434; Valkey 8 labels; R-ARCH-10 closed | `nfr-traceability.md`, `nfr-strategy.md`, `docs/sdlc/traceability.md` v1.4, `ARCHITECTURE.md` §4/§6/§8, `threat-model.md` §1/§4, `platform.md` §2.2/OI-01, `risks.md`; D-ARCH-034 |

**Deviations and additions for security-analyst to rule on:**
1. New contract extension member `x-audit.additional[] {action, entity, sensitivity, when}` (README §10, §15 deep-compare) — needed so the audit test generator can assert a second entry on one operation.
2. Mint cap counted in PostgreSQL, not Redis (data-architect's choice: the rows it bounds are the source of truth; race-free via the unique index).
3. `carrier_quota_org_share_exhausted` is limited to once per account **and organisation** per minute (ADR-0010 am. 10), finer than §14.4's "once a minute".
4. SEC-TC-53 stands exactly as §14.5 wrote it (three identical 404s) now that D-055 aligned the requirement; the interim EC-B29 reconciliation is withdrawn everywhere (ADR-0016 am. 11 c, openapi, README, data-model §3.10).
5. SEC-TC-61 should gain `DROP FUNCTION platform.audit_ddl_guard() CASCADE` and `DROP SCHEMA platform CASCADE` as the migrator (both must fail by privilege) — data-architect found that `sql_drop` is not guaranteed to fire for the command that drops the guard itself; review item 6 (adopted) is what closes it.
6. With item 6 adopted, RR-04 returns to the superuser-only actor (≤ 1 h window); SEC-COND-03 closes except item 7 (locked sink, G4-production).
7. `platform_definer` now holds `CREATE` on schema `platform` (a grant the definer migrations needed and lacked).
8. **Not done here (out of G2-C3 scope):** SEC-P3-31 (`npx` → `npm exec --no`, base-ref gate scripts) stays a Wave-0 CI task; ADR-0023 am. F still says `npx prisma generate`. `CLAUDE.md` §2 `npm ci` text is the orchestrator's edit.
