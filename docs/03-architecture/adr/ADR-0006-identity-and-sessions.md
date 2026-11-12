# ADR-0006: Identity, sessions, CSRF and MFA

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect (security-analyst reviews at P3/P6)
- **Related:** brief §4.2, §4.11; REQ-AUTH-001..024, REQ-ADMIN-001..004, REQ-SEC-004/005/012, DR-A01..A04, DR-A08; D-024; A-041, A-054; NFR-SEC-003/004/008; threat-model.md

## Context

The brief fixes: email + password (bcrypt ≥ 12), short-lived JWT access token held in memory, rotating refresh token in an `HttpOnly; Secure; SameSite=Strict` cookie with reuse detection and server-side revocation, email verification, single-use reset tokens, lockout with progressive delay, session list with remote sign-out, TOTP with recovery codes (mandatory for operator staff), a re-authentication primitive for signed actions (M2), separate web/admin apps with distinct cookies (A-054), CSRF defence on cookie-authenticated endpoints (REQ-SEC-004). Parameters are D-024/DR-A01/DR-A02.

## Decision

### Tokens

- **Access token:** JWT, **ES256** (`jose` 6), 15 min, issuer/audience fixed per environment, `kid` from a two-key rotation set (`JWT_SIGNING_KEYS` secret ref; public keys exposed internally only). Claims: `sub` (user id), `sid` (session id), `org` (active org id), `app` (`web|admin`), `mfa` (true when the session completed a second factor), `iat`, `exp`, `jti`. No roles, permissions or personal data (REQ-AUTH-005); permissions are resolved per request (ADR-0008). Clients keep it in memory only (REQ-AUTH-010) and send `Authorization: Bearer`.
- **Revocation:** every authenticated request checks Redis set `auth:revoked:sid` (TTL = access lifetime) — populated on logout, remote sign-out, password reset/change, reuse detection, membership removal, user status change (REQ-AUTH-009/024). Redis outage → fail closed for admin app, fail open with ERROR security log for web (A-053 analogue; security-analyst to confirm at P3 review).
- **Refresh token:** 256-bit random (`crypto.randomBytes(32)`, base64url), stored only as SHA-256 in `refresh_tokens(id, family_id, session_id, user_id, token_hash, status ACTIVE|ROTATED|REVOKED, issued_at, expires_at, rotated_to_id)`; cookie names `__Host-rt_web` and `__Host-rt_admin` (the `__Host-` prefix forces Secure + no Domain + Path=/; the token value is additionally bound to `app` server-side), `HttpOnly; Secure; SameSite=Strict; Path=/` — Path `/` is required by `__Host-`; the cookie is only *read* by `/api/v1/auth/refresh|logout` and ignored elsewhere. Lifetime 30 d; absolute session cap 90 d (web) / 12 h (admin, REQ-ADMIN-004). Rotation on every refresh; presenting a `ROTATED` or `REVOKED` token revokes the family and session and writes `TOKEN_REUSE_DETECTED` + security event `refresh_token_reuse` (DR-A03). `Secure` is relaxed only for `NODE_ENV=development` on `localhost` (REQ-AUTH-006).
- **Single-flight refresh** in the clients: one in-flight refresh promise per tab plus a `BroadcastChannel`/`navigator.locks` lock across tabs; server stays strict (A-041).

### CSRF (REQ-SEC-004, A-054)

Cookie-authenticated unsafe routes (`/auth/refresh`, `/auth/logout`) require: (1) `Origin` (or `Referer` fallback) in the CORS allow-list, (2) header `X-CSRF-Token` equal to the value issued by `GET /auth/csrf` (random 128-bit, stored HMAC-bound to the session cookie in Redis for 24 h; rotated on login), (3) `SameSite=Strict` as the third layer. Failures → 403 `CSRF_REJECTED` + security event `csrf_rejected`. Bearer routes are CSRF-exempt by construction (documented per route via `x-tenancy`/security scheme in OpenAPI).

### Passwords and lockout

`bcrypt` cost 12 (floor enforced in config), re-hash on login when cost < configured; policy 12–128 chars, offline top-10k breached list in `packages/shared/assets`, no composition rules (REQ-AUTH-002). Identical 401 `INVALID_CREDENTIALS` for unknown email / wrong password / wrong app (REQ-ADMIN-003) with a constant-time compare against a dummy hash for unknown users (timing, NFR-SEC-003). Lockout counters per hashed identifier **and** per IP in Redis (`auth:fail:<sha256(identifier)>`), schedule DR-A02 (5–9 failures → delay 2 s doubling to 60 s with `Retry-After`; 10 → 15 min lock), reset on success/password reset; audit `LOGIN_FAILED`/`ACCOUNT_LOCKED` + security events.

### Email verification and reset

256-bit single-use tokens stored hashed with purpose and expiry (24 h / 60 min), superseding earlier tokens of the same purpose; identical 202 responses (no enumeration, EC-A01); rate limits per DR-A22/G1-C1 outcome (values are configuration). Redemption revokes all sessions (reset) and audits an `UPDATE` on `user_credentials` with redacted values.

### MFA

TOTP RFC 6238 (6 digits, 30 s, SHA-1, ±1 step; `otplib` 13), secret encrypted at rest with AES-256-GCM under the environment data key (KMS-wrapped in AWS; `MFA_ENCRYPTION_KEY` locally), pending enrolment 15 min, replay of an accepted code within its step rejected (Redis `mfa:used:<user>:<step>`). 10 recovery codes (≥ 50 bits, bcrypt-hashed, single-use; regeneration requires re-auth). Login for MFA users: password OK → 401 `MFA_REQUIRED` with a 5-min single-use **challenge token** (opaque, Redis, bound to user + IP /24); `POST /auth/mfa/challenge` with TOTP or recovery code completes the session (`mfa: true`); 5 wrong codes → `MFA_LOCKED` 15 min. **Staff gate:** any user with an OPERATOR membership whose TOTP is not active is restricted to the enrolment endpoints (403 `MFA_ENROLMENT_REQUIRED`); the admin app requires `mfa: true` on every session (REQ-AUTH-018).

### Re-authentication primitive (REQ-AUTH-020)

`POST /auth/reauth` verifies password (or TOTP for MFA users) and returns a 5-min single-use proof bound to `sid` and an `action_scope` string; routes with `reauth: true` in metadata require header `X-Reauth-Proof`; used in M1 by recovery-code regeneration, TOTP disable and password change. The M2 signature record (reason + meaning) binds to the audit entry via `audit.reasonRequired`.

### Sessions

`sessions(id, user_id, app, created_at, last_used_at, ip_coarse, user_agent_raw, ua_browser, ua_os, absolute_expires_at, revoked_at, revoke_reason)`; UA parsed with `bowser` (MIT); IP coarsened to /24 or /48 for display (REQ-AUTH-021). Remote sign-out revokes the family and adds `sid` to the revocation set (effective ≤ 5 s).

### Seam for later login methods (D-007 #11)

`user_credentials.kind ∈ {PASSWORD}` now; `SOCIAL`, `OTP` later behind the identity module boundary. API keys (M3) are a distinct actor type (`API_KEY`) handled by a separate authenticator in the same pipeline slot.

## Alternatives considered

- **Opaque access tokens with a DB lookup per request.** Simpler revocation but adds a round trip to every call; JWT + Redis revocation set gives ≤ 5 s revocation (REQ-AUTH-009) at lower latency.
- **HS256.** Shared secret across api/worker; ES256 lets verifiers hold only public keys and simplifies key rotation.
- **Refresh token in body / localStorage.** Rejected by the brief (cookie, HttpOnly).
- **Synchroniser token in forms only.** SPA uses `fetch`; the double-submit header + Origin check is the standard fit, with SameSite=Strict as defence in depth.
- **WebAuthn/passkeys.** Not in scope (brief fixes TOTP); the `mfa_*` tables leave room for a second method.

## Consequences

- Positive: access tokens are stateless and short-lived; refresh reuse is detected; staff always have MFA; all parameters are configuration (D-024).
- Negative: two cookies and a CSRF token to manage in the clients; Redis is on the authentication hot path (revocation + counters) — readiness reports Redis state and admin fails closed.
- Verification: API tests with a fake clock for every lifetime boundary (NFR-SEC-004), cookie attribute assertions, CSRF cross-origin tests (NFR-SEC-008), timing test (NFR-SEC-003), RBAC matrix proving the staff gate.

## Amendments after the threat model (2026-11-12, threat-model.md R-06..R-08, T-21, T-23, T-100)

1. **Cookie attributes (R-06).** The `__Host-` prefix requires `Path=/` and no `Domain`; the cookie is therefore `__Host-rt_web` / `__Host-rt_admin; Path=/; HttpOnly; Secure; SameSite=Strict`, served from the app's own host (API under `/api/*` of the same host, platform.md PD-01), and **read by the server only on `/api/v1/auth/refresh` and `/api/v1/auth/logout`** (ignored everywhere else). This deviates from the literal wording of REQ-AUTH-006 ("scoped to the auth path"); D-ARCH-006 asks product-manager to amend the wording to "read only by the auth routes". Trade-off: `__Host-` blocks cookie injection from sibling subdomains (relevant for future white-label hosts), which a path restriction cannot.
2. **CSRF token is signed, not stored (R-06).** `csrf_token = base64url(HMAC-SHA256(CSRF_KEY, session_id || app))`; `GET /auth/csrf` returns it for the current refresh cookie; verification recomputes it — no Redis state, rotates with the session.
3. **MFA hardening (R-07, T-21).** The MFA failure counter is **per user** (not per challenge): 5 consecutive wrong codes lock MFA for the user for 15 minutes (`MFA_LOCKED`), counted across challenges and IPs (D-ARCH-006 notes the DR-A02 wording). Recovery codes: 10 codes of 10 characters from a 32-symbol alphabet (≈ 50 bits), stored as `HMAC-SHA256(RECOVERY_KEY, code)` for constant-time single lookup (a keyed hash satisfies "stored hashed", REQ-AUTH-016) instead of ten bcrypt comparisons. Actions that weaken MFA (disable TOTP, regenerate recovery codes) require a **TOTP** re-authentication proof when MFA is active, never password-only. bcrypt input is `base64(SHA-512(password))` so passwords > 72 bytes are never truncated (REQ-AUTH-002).
4. **Seeded staff takeover (T-23).** The demo seed refuses default `SEED_*` passwords whenever `APP_ENV ≠ local` (not only in production, extending REQ-DATA-002 — D-ARCH-006); seeded staff must complete TOTP enrolment within 24 h of first sign-in or the account is suspended until an administrator resets it (M2); the first sign-in of a seeded staff account writes a `SECURITY_NOTICE` e-mail and a security event.
5. **Revocation under Redis outage (R-08).** When Redis is unavailable the revocation check falls back to `sessions.revoked_at` in PostgreSQL (one indexed read per request) instead of failing open; the admin app additionally fails closed if both are unavailable. Admin sessions have an idle timeout of 30 minutes (config; aligns with ASVS V3.3.2 L2) in addition to the 12 h absolute cap.
6. **Open requirement decision (R-26).** The 30-day customer refresh lifetime (D-024) exceeds ASVS 4.0.3 V3.3.2 L2 (12 h or 30 min idle). Recommended default applied: keep 30 d for the customer app (consumer UX), compensate with re-authentication on sensitive actions (password/MFA changes, payment methods, privacy actions) and record the deviation in the ASVS checklist; product-manager confirms or shortens (D-ARCH-006).
7. **Local secrets exposure (T-100).** Compose binds Mailpit and RustFS ports to `127.0.0.1` only; verification/reset links in Mailpit are reachable only from the developer host.

## Amendments after the UX specification (2026-11-12, `docs/02-ux/README.md` §5 items 1, 3, 4, 7; D-UX-009, D-UX-024)

8. **Email-link format (UX §5 #1, D-UX-009).** The canonical link is `<app origin>/<route>#token=<base64url(32 random bytes)>` with routes `/verify-email`, `/reset-password` and `/invitations/accept` (unprefixed app routes per D-UX-005). The SPA reads `location.hash`, posts `{ token }` to `POST /auth/verify-email`, `POST /auth/password/reset` or `POST /invitations/accept`, then removes the fragment with `history.replaceState`. The link carries no other parameter (the page resolves its locale per D-UX-005; the e-mail itself is already in the recipient locale, REQ-I18N-008). Notification templates (ADR-0020) build links from the `WEB_APP_ORIGIN` / `ADMIN_APP_ORIGIN` configuration keys. This fixes the parameter name that ADR-0016 amendment 2 left as an example (`#t=`); tokens never travel in paths or query strings. Share links for saved quotes (US-165, Should) follow the same rule, `/q#token=…`, resolved through `POST /public/shared-quotes/resolve`; ux-designer aligns the S-W02s route when US-165 is scheduled.
9. **Link origin for staff accounts (UX §5 #7).** The notifications consumer chooses the origin by account affinity: a user with an ACTIVE membership in the OPERATOR organisation receives `ADMIN_APP_ORIGIN` links; every other user receives `WEB_APP_ORIGIN` links. The choice does not depend on which app submitted `requestPasswordReset` (the response is the identical 202 either way and the request carries no `client_app`). `resetPassword` is app-agnostic; after a successful reset the admin app routes to `/sign-in` (all sessions are revoked, REQ-AUTH-012). Verification links use the same rule, so seeded staff (T-23) verify and reset on the admin host only.
10. **Registration does not issue a session (UX §5 #3).** `registerUser` stays `202 Accepted`, identical for new and existing e-mails (EC-A01); issuing a session server-side would break that property. The web app realises the F02 assumption ("registered → straight into the wizard") **client-side**: immediately after the 202 it calls `POST /auth/login` (`client_app: "web"`) with the credentials still held in memory, then continues to the return URL (quote claim per US-171). If login answers `INVALID_CREDENTIALS` (the address already existed with a different password) the app shows the sign-in panel with the same `returnUrl` and the generic message (the F02 fallback) while the "account already exists" e-mail reaches the real owner. Credentials are cleared from memory after the attempt; nothing is persisted. Signing in before verification is permitted (D-009; checkout remains gated on verification). Audit shows `CREATE user` followed by `LOGIN`; the login counts once against the `auth` rate class and the lockout counters, so the register-then-login pair is not a cheaper enumeration oracle than sign-in itself.
11. **TOTP provisioning data (UX §5 #4).** The contract is unchanged: `enrolTotp` returns `provisioning_uri` (`otpauth://totp/...`, generated with `otplib`) and `manual_key` once. The QR code is rendered **client-side** (ADR-0026 amendment 2, `uqr`); the API never renders images, so the secret appears in exactly one response. The URI lives in component state only and is discarded on activation, on navigation away, or when the 15-minute enrolment expires.

## Reversibility

High for parameters (config), medium for token format (clients depend on it from M0).
