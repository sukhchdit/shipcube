// Generated from docs/03-architecture/api/openapi.yaml by tools/openapi/types.ts (openapi-typescript 7). Do not edit:
// change the contract, then regenerate with `npm run openapi:types` (CI fails a stale file: `npm run openapi:types -- --check`).
export interface paths {
  readonly '/admin/feature-flags': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List feature-flag definitions
     * @description Definitions with environment values and organisation overrides.
     *
     *     **Requirements:** REQ-PLAT-021, REQ-PLAT-020. **Permission:** `featureflag:manage`. **Audit:** VIEW `feature_flag` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** operator-cross-tenant.
     */
    readonly get: operations['listFeatureFlags'];
    readonly put?: never;
    /**
     * Create a feature flag
     * @description Audited CONFIG_CHANGE with before/after values; takes effect within the 30 s cache window. Duplicate key: 409 CONFLICT.
     *
     *     **Requirements:** REQ-PLAT-021. **Permission:** `featureflag:manage`. **Audit:** CONFIG_CHANGE `feature_flag` NORMAL. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** operator-cross-tenant.
     */
    readonly post: operations['createFeatureFlag'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/admin/feature-flags/{flagKey}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    /**
     * Update a feature flag
     * @description Enable, disable, change targeting; audited CONFIG_CHANGE (`featureflag.changed` event).
     *
     *     **Requirements:** REQ-PLAT-021. **Permission:** `featureflag:manage`. **Audit:** CONFIG_CHANGE `feature_flag` NORMAL. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** operator-cross-tenant.
     */
    readonly patch: operations['updateFeatureFlag'];
    readonly trace?: never;
  };
  readonly '/audit/chain/status': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get hash-chain verification status
     * @description Latest incremental (hourly) and full (nightly) verification results, first broken entry if any, and partition headroom.
     *
     *     **Requirements:** REQ-AUDIT-013, REQ-AUDIT-017. **Permission:** `audit:read`. **Audit:** VIEW `audit_chain_verification` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** operator-cross-tenant.
     */
    readonly get: operations['getAuditChainStatus'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/audit/entities/{entityName}/{entityId}/history': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get the audit history of one entity
     * @description Entries of one entity in chronological order; reusable as a panel on entity detail pages.
     *
     *     **Requirements:** REQ-AUDIT-021, REQ-AUDIT-022, REQ-ADMIN-006. **Permission:** `audit:read`. **Audit:** VIEW `audit_entry` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** operator-cross-tenant.
     */
    readonly get: operations['listEntityAuditHistory'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/audit/entries': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Search audit entries
     * @description Newest first, keyset pagination (default 50, max 200). Date range required (default last 24 h, max 31 days: 400 VALIDATION_ERROR sub-code RANGE_TOO_LARGE). Filters combine with AND. `filter[org_id]` for another organisation uses the operator branch (target org recorded). The request itself writes a VIEW entry with filters and result count, failing closed.
     *
     *     **Requirements:** REQ-AUDIT-019, REQ-AUDIT-022, REQ-AUDIT-023, REQ-RLS-006, REQ-ADMIN-006. **Permission:** `audit:read`. **Audit:** VIEW `audit_entry` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** operator-cross-tenant.
     */
    readonly get: operations['listAuditEntries'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/audit/entries/{auditEntryId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get an audit entry
     * @description All stored fields, old/new values ([REDACTED]/[ERASED] markers) and both hashes. Read-only; no API edits or deletes audit entries.
     *
     *     **Requirements:** REQ-AUDIT-020, REQ-AUDIT-022, REQ-AUDIT-023. **Permission:** `audit:read`. **Audit:** VIEW `audit_entry` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** operator-cross-tenant.
     */
    readonly get: operations['getAuditEntry'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/csrf': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Issue a CSRF token
     * @description Returns the signed CSRF token for the current refresh cookie: base64url(HMAC-SHA256(CSRF_KEY, session_id || app)), recomputed on verification, no server state, rotates with the session (ADR-0006 amendment 2). Send it as `X-CSRF-Token` on refreshSession and logoutSession. No cookie: 401 AUTH_REQUIRED. GET is safe, so no CSRF token is needed to obtain one; the allow-listed Origin is still enforced by CORS.
     *
     *     **Requirements:** REQ-SEC-004. **Permission:** `public` (Authenticated by the refresh cookie; issues the anti-CSRF token for the cookie routes.). **Audit:** none (Derives an anti-CSRF token from the session; no entity is read or changed (proposed addition to the REQ-AUDIT-006 NONE list).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** user.
     */
    readonly get: operations['getCsrfToken'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/login': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Sign in with email and password
     * @description Returns a 15-minute access token and sets the app-specific refresh cookie. Unknown email, wrong password, suspended/deactivated user, or a non-staff user on `client_app: admin` all return the identical 401 INVALID_CREDENTIALS (REQ-ADMIN-003). Users with TOTP receive 401 MFA_REQUIRED with `mfa_challenge_token`. Progressive delay after 5 failures (429 ACCOUNT_DELAYED), 15-minute lock after 10 (429 ACCOUNT_LOCKED). Staff without TOTP get a token with `mfa_enrolment_required: true` restricted to enrolment routes (REQ-AUTH-018).
     *
     *     **Requirements:** REQ-AUTH-005, REQ-AUTH-006, REQ-AUTH-013, REQ-AUTH-014, REQ-AUTH-017, REQ-AUTH-024, REQ-ADMIN-003. **Permission:** `public` (Credential exchange.). **Audit:** LOGIN `session` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** auth (10/min per IP and 5/min per account identifier (DR-A22)). **Tenancy:** user.
     */
    readonly post: operations['loginUser'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/logout': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Sign out the current session
     * @description Cookie-authenticated with CSRF. Revokes the session and token family, clears the cookie; access tokens of the session are rejected within 5 s.
     *
     *     **Requirements:** REQ-AUTH-009, REQ-SEC-004. **Permission:** `public` (Authenticated by the refresh cookie plus CSRF token.). **Audit:** LOGOUT `session` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** user.
     */
    readonly post: operations['logoutSession'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/mfa/challenge': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Complete the MFA challenge
     * @description Exchanges the MFA challenge token plus a TOTP code or a recovery code for session tokens. Wrong code: 401 MFA_INVALID; 5 consecutive wrong codes lock MFA for the user for 15 min across challenges and IPs (429 MFA_LOCKED; ADR-0006 amendment 3). Using a recovery code emits `auth.security_event` RECOVERY_CODE_USED.
     *
     *     **Requirements:** REQ-AUTH-017, REQ-AUTH-016, REQ-AUTH-015. **Permission:** `public` (Second factor of sign-in; authenticated by the challenge token.). **Audit:** LOGIN `session` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** auth. **Tenancy:** user.
     */
    readonly post: operations['completeMfaChallenge'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/mfa/recovery-codes/regenerate': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Regenerate recovery codes
     * @description Requires re-authentication (scope `mfa.recovery_codes.regenerate`); voids the previous set and returns 10 new codes once.
     *
     *     **Requirements:** REQ-AUTH-016, REQ-AUTH-020, REQ-ADMIN-008. **Permission:** `authenticated` (Own MFA only.). **Audit:** UPDATE `recovery_codes` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** auth. **Tenancy:** user.
     */
    readonly post: operations['regenerateRecoveryCodes'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/mfa/totp/activate': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Activate TOTP with a first code
     * @description Activates MFA after a valid code and returns 10 single-use recovery codes, shown once. Emits `auth.security_event` MFA_ENABLED.
     *
     *     **Requirements:** REQ-AUTH-015, REQ-AUTH-016, REQ-AUTH-018. **Permission:** `authenticated` (Own MFA only.). **Audit:** MFA_ENROLLED `user_mfa` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** auth. **Tenancy:** user.
     */
    readonly post: operations['activateTotp'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/mfa/totp/disable': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Disable TOTP (customers only)
     * @description Customer users only; requires re-authentication (scope `mfa.totp.disable`). Revokes all other sessions and emits MFA_DISABLED. A user who is also an operator member gets 403 AUTHZ_DENIED (REQ-ADMIN-008).
     *
     *     **Requirements:** REQ-AUTH-019, REQ-AUTH-020, REQ-ADMIN-008. **Permission:** `authenticated` (Own MFA only; staff refused by rule.). **Audit:** UPDATE `user_mfa` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** auth. **Tenancy:** user.
     */
    readonly post: operations['disableTotp'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/mfa/totp/enrol': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Start TOTP enrolment
     * @description Returns the provisioning URI and manual key once (RFC 6238, 6 digits, 30 s, SHA-1). Pending enrolment expires after 15 minutes. Allowed for staff sessions restricted by the MFA gate.
     *
     *     Staff first enrolment (SEC-P3-14): when `APP_ENV` is not `local` or `test` and the caller is a member of the OPERATOR organisation with no TOTP ever activated, the request must carry `enrolment_code`, the 6-digit single-use code (10 min) e-mailed to the account address by `requestTotpEnrolmentCode`. A missing, wrong, expired or used code returns 403 MFA_ENROLMENT_CODE_REQUIRED; wrong codes count against the per-user MFA lock (5 consecutive failures: 429 MFA_LOCKED, 15 min). Customers and later staff re-enrolments send no body (or `{}`); a supplied code is then ignored.
     *
     *     **Requirements:** REQ-AUTH-015, REQ-AUTH-018, REQ-ADMIN-002, REQ-AUTH-019. **Permission:** `authenticated` (Own MFA only.). **Audit:** CREATE `mfa_enrolment` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** auth. **Tenancy:** user.
     */
    readonly post: operations['enrolTotp'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/mfa/totp/enrolment-code': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * E-mail a TOTP enrolment code (staff first enrolment)
     * @description Sends a 6-digit single-use code, valid for 10 minutes, to the signed-in account's e-mail address. The code is required by `enrolTotp` for a staff (OPERATOR member) user's **first** TOTP enrolment when `APP_ENV` is not `local` or `test`, which binds first enrolment to mailbox control: a leaked staff password alone cannot enrol an attacker's authenticator (SEC-P3-14, threat model T-23). Only the code hash is stored; a new request invalidates earlier codes. The response is the identical 202 whether or not a code was needed or sent (customer accounts, already-enrolled staff, local/test). Allowed for staff sessions restricted by the MFA gate.
     *
     *     **Requirements:** REQ-AUTH-018, REQ-ADMIN-002. **Permission:** `authenticated` (Own account only; the code goes to the account's own address.). **Audit:** CREATE `mfa_enrolment_code` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** email-send (3/h per account identifier and 10/h per IP (DR-A22)). **Tenancy:** user.
     */
    readonly post: operations['requestTotpEnrolmentCode'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/password/change': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Change the password
     * @description Requires the current password and a re-authentication proof for scope `auth.password.change`. Revokes all other sessions and sends a security notice. New password equal to the current one: PASSWORD_POLICY.
     *
     *     **Requirements:** REQ-AUTH-023, REQ-AUTH-020, REQ-AUTH-002. **Permission:** `authenticated` (Own credential only.). **Audit:** UPDATE `user_credential` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** auth. **Tenancy:** user.
     */
    readonly post: operations['changePassword'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/password/forgot': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Request a password-reset email
     * @description Always 202. For an existing account a 60-minute single-use token supersedes earlier tokens; the email uses the account locale (`auth.password_reset`).
     *
     *     **Requirements:** REQ-AUTH-011. **Permission:** `public` (Account recovery without a session.). **Audit:** CREATE `password_reset_token` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** email-send (3/h per account identifier and 10/h per IP (DR-A22)). **Tenancy:** user.
     */
    readonly post: operations['requestPasswordReset'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/password/reset': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Reset the password with a token
     * @description Stores the new hash, marks the token used, revokes all sessions, clears lockout counters and sends a security notice (PASSWORD_RESET_COMPLETED).
     *
     *     **Requirements:** REQ-AUTH-012, REQ-AUTH-002. **Permission:** `public` (Token-authenticated link from email.). **Audit:** UPDATE `user_credential` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** auth. **Tenancy:** user.
     */
    readonly post: operations['resetPassword'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/reauth': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Re-authenticate for a sensitive action
     * @description Verifies the password (or a TOTP code for MFA users) and returns a 5-minute single-use proof bound to the session and the named action scope. Send it as `X-Reauth-Proof`. Scopes that weaken MFA (`mfa.totp.disable`, `mfa.recovery_codes.regenerate`) require `totp_code` when MFA is active; a password alone is rejected with 401 INVALID_CREDENTIALS (ADR-0006 amendment 3). Success also sets the session's `authenticated_at`; access tokens issued from then on (refresh, organisation switch) carry the new `auth_time` (SEC-P3-01).
     *
     *     **Requirements:** REQ-AUTH-020. **Permission:** `authenticated` (Own session only.). **Audit:** CREATE `reauth_proof` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** auth. **Tenancy:** user.
     */
    readonly post: operations['createReauthProof'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/refresh': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Rotate the refresh token
     * @description Cookie-authenticated (no bearer). Requires an allow-listed Origin and `X-CSRF-Token`. Rotates the refresh token in the same family and returns a new access token. Presenting a rotated or revoked token revokes the whole family and session: 401 SESSION_REVOKED, audit TOKEN_REUSE_DETECTED, security event refresh_token_reuse (EC-A04/EC-A05). Customer sessions: 30-day sliding refresh lifetime (`AUTH_REFRESH_TTL`) inside a 30-day absolute cap (`AUTH_SESSION_ABSOLUTE_TTL`); admin sessions: 30-minute sliding idle lifetime (`AUTH_ADMIN_REFRESH_IDLE_TTL`) inside a 12 h absolute cap. A refresh token past either limit gets 401 SESSION_EXPIRED (audit reason `SESSION_EXPIRED`); sign in again (SEC-P3-01, SEC-P3-11). The new access token carries the session's `auth_time` unchanged: refresh never renews it.
     *
     *     **Requirements:** REQ-AUTH-007, REQ-AUTH-008, REQ-AUTH-010, REQ-SEC-004, REQ-ADMIN-004. **Permission:** `public` (Authenticated by the refresh cookie plus CSRF token, not by a bearer token.). **Audit:** UPDATE `session` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** public (not an auth-class route in DR-A22; 120/min per IP). **Tenancy:** user.
     */
    readonly post: operations['refreshSession'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/register': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Register a user
     * @description Creates, in one transaction, the user (PENDING_VERIFICATION), a personal INDIVIDUAL organisation with the user as Owner and the terms acceptance, then sends the verification email via the outbox (`auth.email_verification`). An existing email returns the identical 202 and an "account already exists" email (EC-A01). Password policy failures are 400 VALIDATION_ERROR sub-code PASSWORD_POLICY.
     *
     *     **Requirements:** REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-003, REQ-ORG-002. **Permission:** `public` (Anonymous self-registration.). **Audit:** CREATE `user` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** auth. **Tenancy:** user.
     */
    readonly post: operations['registerUser'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/resend-verification': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Resend the verification email
     * @description Invalidates earlier verification tokens and sends a new one. Always 202 (no enumeration). Limited to 3/h per account and 10/h per IP.
     *
     *     **Requirements:** REQ-AUTH-004. **Permission:** `public` (Unverified users may not hold a session on this device.). **Audit:** CREATE `email_verification_token` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** email-send (3/h per account identifier and 10/h per IP (DR-A22)). **Tenancy:** user.
     */
    readonly post: operations['resendVerificationEmail'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/switch-organisation': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Switch the active organisation
     * @description Issues a new access token for another organisation in which the user has an ACTIVE membership; otherwise 403 AUTHZ_DENIED. The session remembers the choice for the next sign-in.
     *
     *     **Requirements:** REQ-ORG-006, REQ-ORG-005. **Permission:** `authenticated` (Membership of the target organisation is the check.). **Audit:** UPDATE `session` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly post: operations['switchOrganisation'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/auth/verify-email': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Redeem an email-verification token
     * @description The email link carries the token in the URL fragment; the SPA posts it here (ADR-0016 amendment 2). Marks `email_verified_at` and moves the user PENDING_VERIFICATION to ACTIVE. Used or unknown token: 400 TOKEN_INVALID; expired: 410 TOKEN_EXPIRED.
     *
     *     **Requirements:** REQ-AUTH-004. **Permission:** `public` (Token-authenticated link from email.). **Audit:** UPDATE `user` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** auth. **Tenancy:** user.
     */
    readonly post: operations['verifyEmail'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/carriers/status': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List carrier account status (staff)
     * @description Per platform carrier account: environment, configured/NOT_CONFIGURED, breaker state, last success/failure. Never exposes secrets (references only).
     *
     *     **Requirements:** REQ-CARR-015, REQ-CARR-017. **Permission:** `carrier:status:read`. **Audit:** VIEW `carrier_account` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** operator-cross-tenant.
     */
    readonly get: operations['listCarrierStatuses'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/compliance/legal/{packCountry}/{legalDocument}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get a legal text (privacy notice or terms)
     * @description Privacy notice or terms for a country and locale (fallback en) with the draft banner flag while unreviewed; the privacy document includes the consent rule that drives the cookie banner.
     *
     *     **Requirements:** REQ-COMP-007, REQ-UI-019, REQ-UI-023. **Permission:** `public` (Public legal pages.). **Audit:** none (Static documents (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['getLegalDocument'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/compliance/packs/{packCountry}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get the public compliance-pack subset
     * @description Resolves the pack in force now (DR-A23): EU members without a national pack use the EU template; otherwise `state: PACK_UNAVAILABLE` (200, never a hidden default). Always carries `unreviewed`.
     *
     *     **Requirements:** REQ-COMP-002, REQ-COMP-004, REQ-COMP-006, REQ-COMP-007. **Permission:** `public` (Public compliance information.). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['getCompliancePack'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/consents': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Record a cookie consent decision
     * @description Stores a consent record (categories, consent-rule version, timestamp, anonymous identifier). `necessary` is always true. Withdrawal is a new record (EC-A47).
     *
     *     **Requirements:** REQ-UI-023, REQ-COMP-007. **Permission:** `public` (Visitors decide before any account exists.). **Audit:** CREATE `consent_record` NORMAL. **Idempotency:** optional. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly post: operations['recordConsent'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/documents/{documentId}/download': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get a pre-signed download URL
     * @description After document:download and tenant checks, recomputes the SHA-256 (500 DOCUMENT_INTEGRITY_FAILURE on mismatch), writes the DOWNLOAD audit entry (fail closed: 503 AUDIT_UNAVAILABLE) and returns a 300 s pre-signed URL with Content-Disposition attachment. Voided label: 410 DOCUMENT_VOIDED (audited DENIED). `version` selects an older version.
     *
     *     **Requirements:** REQ-DOC-007, REQ-DOC-008, REQ-DOC-009, REQ-DOC-014, REQ-RBAC-012, REQ-DOC-004. **Permission:** `document:download`. **Audit:** DOWNLOAD `document` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getDocumentDownloadUrl'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/feature-flags': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Evaluate feature flags for the caller
     * @description Evaluations for the active organisation and environment (override > environment > default; unknown keys default false). Cached up to 30 s.
     *
     *     **Requirements:** REQ-PLAT-020. **Permission:** `authenticated` (REQ-PLAT-020: web and admin apps read their flags.). **Audit:** VIEW `feature_flag` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['evaluateFeatureFlags'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/health/live': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Liveness probe
     * @description 200 while the process runs. Outside /api/v1.
     *
     *     **Requirements:** REQ-PLAT-018. **Permission:** `public` (Load balancer and orchestrator probes.). **Audit:** none (Health endpoint (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** none. **Tenancy:** public.
     */
    readonly get: operations['getLiveness'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/health/ready': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Readiness probe
     * @description 503 with per-dependency status when PostgreSQL, Redis or object storage is unreachable (2 s timeout each); audit partitions and chain verification report degraded without failing.
     *
     *     **Requirements:** REQ-PLAT-018, REQ-AUDIT-013, REQ-AUDIT-017. **Permission:** `public` (Load balancer and orchestrator probes.). **Audit:** none (Health endpoint (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** none. **Tenancy:** public.
     */
    readonly get: operations['getReadiness'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/invitations/accept': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Accept an invitation
     * @description The SPA reads the token from the URL fragment of the email link and posts it in the body; tokens never appear in paths or query strings (ADR-0016 amendment 2). The signed-in user whose verified email matches accepts (new users register first). Expired: 410 TOKEN_EXPIRED; used/revoked: 400 TOKEN_INVALID; other email: 403 INVITATION_EMAIL_MISMATCH. The membership `created_by` is the inviter.
     *
     *     **Requirements:** REQ-ORG-011. **Permission:** `authenticated` (Authorised by possession of the invitation token plus matching verified email.). **Audit:** CREATE `membership` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly post: operations['acceptInvitation'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get the current user, memberships and permissions
     * @description Returns the user profile, the active organisation, all memberships and the effective permissions of the active membership resolved server-side (never from the token).
     *
     *     **Requirements:** REQ-ORG-005, REQ-RBAC-008, REQ-RBAC-009. **Permission:** `authenticated` (Every signed-in user may read their own context.). **Audit:** VIEW `user` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly get: operations['getMe'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    /**
     * Update profile and preferences
     * @description Updates display name, locale, display currency, unit system and time zone. Locale change sets Content-Language and the email locale (REQ-I18N-007).
     *
     *     **Requirements:** REQ-ACCT-018, REQ-I18N-007, REQ-I18N-012. **Permission:** `authenticated` (Own profile only.). **Audit:** UPDATE `user` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly patch: operations['updateMe'];
    readonly trace?: never;
  };
  readonly '/me/dashboard': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get the customer dashboard
     * @description Five most recent shipments, action counts (drafts, PENDING_PAYMENT, LABEL_READY without pickup, EXCEPTION) and current-month spend by currency (null without payment:read).
     *
     *     **Requirements:** REQ-ACCT-001. **Permission:** `shipment:read`. **Audit:** VIEW `dashboard` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getDashboard'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me/notification-preferences': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get email preferences
     * @description `tracking_updates` (default on) and `marketing` (default off). Security and transactional emails cannot be turned off.
     *
     *     **Requirements:** REQ-ACCT-012, REQ-NOTIF-011. **Permission:** `notification_pref:manage`. **Audit:** VIEW `notification_preferences` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly get: operations['getNotificationPreferences'];
    /**
     * Set email preferences
     * @description Each change stores a consent record with timestamp and source.
     *
     *     **Requirements:** REQ-ACCT-012, REQ-NOTIF-011. **Permission:** `notification_pref:manage`. **Audit:** UPDATE `notification_preferences` NORMAL. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly put: operations['replaceNotificationPreferences'];
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me/notifications': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List my notification log
     * @description Own messages only: template ID and version, locale, channel, recipient as at send time, status, attempts and timestamps; redacted variables; no rendered content.
     *
     *     **Requirements:** REQ-NOTIF-012. **Permission:** `notification:read`. **Audit:** VIEW `notification` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly get: operations['listMyNotifications'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me/notifications/{notificationId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get one notification log entry
     * @description One own entry; another user's ID returns 404.
     *
     *     **Requirements:** REQ-NOTIF-012. **Permission:** `notification:read`. **Audit:** VIEW `notification` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly get: operations['getMyNotification'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me/organisations': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List my memberships
     * @description Memberships of the current user across organisations; the UI shows the switcher when there are two or more ACTIVE.
     *
     *     **Requirements:** REQ-ORG-003, REQ-ORG-006. **Permission:** `authenticated` (Own memberships only.). **Audit:** VIEW `membership` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly get: operations['listMyOrganisations'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me/payment-method-setups': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Start a hosted setup for a new card
     * @description Creates a gateway setup session (Stripe SetupIntent in test mode, or Mock) and returns its client secret for the hosted fields. No card data touches the Platform.
     *
     *     Requires re-authentication on every call (SEC-P3-01): a valid `X-Reauth-Proof` for scope `payment_method.manage` from `createReauthProof` (5 min, single-use, bound to the session); otherwise 401 REAUTH_REQUIRED.
     *
     *     **Requirements:** REQ-PAY-014, REQ-PAY-005, REQ-AUTH-020. **Permission:** `payment_method:manage`. **Audit:** CREATE `payment_method_setup` NORMAL. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly post: operations['createPaymentMethodSetup'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me/payment-methods': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List saved payment methods
     * @description Brand, last four digits and expiry only.
     *
     *     **Requirements:** REQ-PAY-014, REQ-ACCT-011. **Permission:** `payment_method:manage`. **Audit:** VIEW `payment_method` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly get: operations['listPaymentMethods'];
    readonly put?: never;
    /**
     * Save a payment method from a completed setup
     * @description Retrieves the completed setup from the gateway and stores only the token, brand, last four and expiry. Max 10 per user (422 LIMIT_EXCEEDED). Card fields: 400 CARD_DATA_NOT_ACCEPTED.
     *
     *     Requires re-authentication on every call (SEC-P3-01): a valid `X-Reauth-Proof` for scope `payment_method.manage` from `createReauthProof` (5 min, single-use, bound to the session); otherwise 401 REAUTH_REQUIRED.
     *
     *     **Requirements:** REQ-PAY-014, REQ-PAY-005, REQ-AUTH-020. **Permission:** `payment_method:manage`. **Audit:** CREATE `payment_method` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly post: operations['createPaymentMethod'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me/payment-methods/{paymentMethodId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post?: never;
    /**
     * Remove a saved payment method
     * @description Detaches at the gateway, then removes.
     *
     *     Requires re-authentication on every call (SEC-P3-01): a valid `X-Reauth-Proof` for scope `payment_method.manage` from `createReauthProof` (5 min, single-use, bound to the session); otherwise 401 REAUTH_REQUIRED.
     *
     *     **Requirements:** REQ-PAY-014, REQ-AUTH-020. **Permission:** `payment_method:manage`. **Audit:** DELETE `payment_method` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly delete: operations['deletePaymentMethod'];
    readonly options?: never;
    readonly head?: never;
    /**
     * Set the default payment method
     * @description Sets this method as the default (clears the previous default).
     *
     *     Requires re-authentication on every call (SEC-P3-01): a valid `X-Reauth-Proof` for scope `payment_method.manage` from `createReauthProof` (5 min, single-use, bound to the session); otherwise 401 REAUTH_REQUIRED.
     *
     *     **Requirements:** REQ-PAY-014, REQ-ACCT-011, REQ-AUTH-020. **Permission:** `payment_method:manage`. **Audit:** UPDATE `payment_method` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly patch: operations['updatePaymentMethod'];
    readonly trace?: never;
  };
  readonly '/me/privacy/delete': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Request deletion of my account
     * @description Requires re-authentication (scope `privacy.delete`). Soft-deletes with a 30-day grace period (sign-in cancels), revokes sessions and sends a security notice. Refused with 409 ACCOUNT_HAS_ACTIVE_SHIPMENTS while the user owns non-final shipments.
     *
     *     **Requirements:** REQ-ACCT-017, REQ-AUTH-020. **Permission:** `privacy:delete`. **Audit:** DELETE `user` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly post: operations['requestAccountDeletion'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me/privacy/export': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Request an export of my data
     * @description Creates a one-time JSON export (profile, memberships, addresses, shipments, quotes, preferences, consent records; no restricted references) and returns its one-time download path.
     *
     *     Requires re-authentication on every call (SEC-P3-01): a valid `X-Reauth-Proof` for scope `privacy.export` from `createReauthProof` (5 min, single-use, bound to the session); otherwise 401 REAUTH_REQUIRED.
     *
     *     **Requirements:** REQ-ACCT-016, REQ-AUTH-020. **Permission:** `privacy:export`. **Audit:** CREATE `privacy_export` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated (1 request per minute per user (US-270)). **Tenancy:** user.
     */
    readonly post: operations['requestPrivacyExport'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me/privacy/exports/{exportId}/download': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Download my data export once
     * @description Streams the export as an attachment once; a second request returns 410 DOWNLOAD_EXPIRED. Fails closed (503 AUDIT_UNAVAILABLE) if the DOWNLOAD entry cannot be written.
     *
     *     Requires re-authentication on every call (SEC-P3-01): a valid `X-Reauth-Proof` for scope `privacy.export` from `createReauthProof` (5 min, single-use, bound to the session); otherwise 401 REAUTH_REQUIRED.
     *
     *     **Requirements:** REQ-ACCT-016, REQ-AUDIT-005, REQ-AUTH-020. **Permission:** `privacy:export`. **Audit:** DOWNLOAD `privacy_export` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly get: operations['downloadPrivacyExport'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me/sessions': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List my active sessions
     * @description Own sessions with parsed browser/OS, coarse IP, created/last-used times and the current flag.
     *
     *     **Requirements:** REQ-AUTH-021, REQ-ADMIN-007, REQ-ACCT-013. **Permission:** `session:manage`. **Audit:** VIEW `session` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly get: operations['listMySessions'];
    readonly put?: never;
    readonly post?: never;
    /**
     * Sign out all other sessions
     * @description Revokes every own session except the current one.
     *
     *     **Requirements:** REQ-AUTH-022, REQ-ADMIN-007. **Permission:** `session:manage`. **Audit:** DELETE `session` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly delete: operations['revokeOtherSessions'];
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/me/sessions/{sessionId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post?: never;
    /**
     * Sign out one session
     * @description Revokes one own session (effective within 5 s); the current session equals logout. Unknown or foreign ID: 404. Emits SESSION_REVOKED security notice.
     *
     *     **Requirements:** REQ-AUTH-022, REQ-AUTH-009. **Permission:** `session:manage`. **Audit:** DELETE `session` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly delete: operations['revokeMySession'];
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/orders': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List orders
     * @description The organisation's orders, newest first.
     *
     *     **Requirements:** REQ-ACCT-002, REQ-BOOK-013. **Permission:** `order:read`. **Audit:** VIEW `order` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['listOrders'];
    readonly put?: never;
    /**
     * Create an order (basket)
     * @description Creates an OPEN order with 1-10 shipments of one sell currency (422 ORDER_CURRENCY_MISMATCH; more than 10: 422 LIMIT_EXCEEDED).
     *
     *     **Requirements:** REQ-BOOK-013, REQ-BOOK-012. **Permission:** `shipment:create`. **Audit:** CREATE `order` NORMAL. **Idempotency:** required. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['createOrder'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/orders/{orderId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get an order
     * @description Order with per-shipment state, coupon status and totals.
     *
     *     **Requirements:** REQ-BOOK-013, REQ-BOOK-017. **Permission:** `order:read`. **Audit:** VIEW `order` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getOrder'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/orders/{orderId}/booking-progress': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get booking progress (polling fallback)
     * @description Saga step status per shipment (AUTHORISE, CREATE_SHIPMENT, CAPTURE, DOCUMENTS, PICKUP, NOTIFY: PENDING/DONE/FAILED/SKIPPED with canonical reason). Clients poll every 3 s when SSE is blocked.
     *
     *     **Requirements:** REQ-BOOK-025, REQ-BOOK-017. **Permission:** `shipment:read`. **Audit:** VIEW `booking_progress` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getBookingProgress'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/orders/{orderId}/booking-progress/stream': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Stream booking progress (SSE)
     * @description SSE per REQ-API-017/018: event `step_update` (SseStepUpdate) within 2 s of each saga step change, `complete` (BookingProgress) when every shipment reached a terminal saga outcome, `error` (SseError); heartbeat every 15 s; capped at 30 s, after which the client reconnects or polls.
     *
     *     Opening or reopening the stream never triggers carrier calls or saga work: the booking saga's carrier calls are started by checkout (`checkoutOrder` / `confirmPayment`), and the stream only reads the persisted saga state and subscribes to step changes (SEC-P3-02). Concurrent open streams are capped at 2 per client IP (IPv6 /64) and 5 per user (`SSE_MAX_STREAMS_PER_IP`, `SSE_MAX_STREAMS_PER_USER`, counted together with `streamQuoteResults`, shared across replicas in Redis); the next stream is refused before it opens with 429 RATE_LIMITED and `Retry-After` (threat model R-15, T-47).
     *
     *     **Requirements:** REQ-BOOK-025, REQ-API-017, REQ-API-018. **Permission:** `shipment:read`. **Audit:** VIEW `booking_progress` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated (plus at most 2 concurrent streams per IP and 5 per user (SEC-P3-02)). **Tenancy:** tenant.
     */
    readonly get: operations['streamBookingProgress'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/orders/{orderId}/checkout': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Start checkout and create the payment authorisation
     * @description Gate (REQ-BOOK-016): verified email (403 EMAIL_NOT_VERIFIED, no order number consumed), every quote unexpired (409 QUOTE_EXPIRED), steps 1-5 complete, DG attestation and prohibited checks re-run (422). Then allocates the order number (DR-B22), computes the amount server-side from stored snapshots (client `expected_amount` mismatch: 409 AMOUNT_MISMATCH; below gateway minimum: 422 AMOUNT_BELOW_MINIMUM) and creates an authorise-only payment (Mock token or Stripe PaymentIntent with manual capture). On AUTHORISED the booking saga starts via the outbox (`order.checkout_started`, `payment.authorised`). Saved-card step-up (SEC-P3-01): when a saved payment method is used and the access token `auth_time` is older than 12 h, the response has `cvc_recollection_required: true`; the server then creates the PaymentIntent with `payment_method_options.card.require_cvc_recollection=true` and the Payment Element collects the CVC inside the Stripe iframe, so no PCI scope change. No `X-Reauth-Proof` is used on this route. At most 5 attempts per order per hour (429 PAYMENT_ATTEMPTS_EXCEEDED). Card fields are rejected (400 CARD_DATA_NOT_ACCEPTED); non-card methods 400 PAYMENT_METHOD_NOT_AVAILABLE.
     *
     *     CVC recollection outcome (SEC-P3-28, ADR-0012 amendment 4). When `cvc_recollection_required` is true, the payment is `AUTHORISED` only if the retrieved charge has `payment_method_details.card.checks.cvc_check = 'pass'`. Any other value (`fail`, `unavailable`, `unchecked` or absent) voids the authorisation (manual capture, so no money moves) and the payment becomes `FAILED` with `failure_code: AUTHENTICATION_FAILED`: audited `UPDATE payment`, security event `cvc_recollection_failed`, shipments back to `QUOTED`, no saga start, and the attempt counts toward the 5-per-hour cap. One payment-state derivation function serves this route (Mock gateway, which authorises synchronously), `confirmPayment` and the Stripe and Mock webhook processors. The client then offers another card (hosted fields) or "confirm it's you" (`createReauthProof`, which advances `auth_time`, so the retried checkout returns `cvc_recollection_required: false`). Mock: `test_token` `mock_cvc_pass`, `mock_cvc_fail` or `mock_cvc_unavailable` simulates the check.
     *
     *     **Requirements:** REQ-BOOK-016, REQ-BOOK-026, REQ-PAY-005, REQ-PAY-006, REQ-PAY-007, REQ-PAY-008, REQ-PAY-009, REQ-PAY-010, REQ-PAY-016, REQ-PAY-019, REQ-BOOK-020, REQ-CUST-009, REQ-CUST-010. **Permission:** `payment:create`. **Audit:** CREATE `payment` NORMAL (plus UPDATE `payment` when a failed CVC check voids a synchronous Mock authorisation). **Idempotency:** required. **Rate-limit class:** authenticated (5 payment attempts per order per hour (REQ-PAY-010)). **Tenancy:** tenant.
     */
    readonly post: operations['checkoutOrder'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/orders/{orderId}/coupon': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    /**
     * Apply a coupon
     * @description Applies the code (trimmed, case-insensitive) to every eligible shipment by re-pricing stored carrier cost (no carrier call). Errors COUPON_INVALID (unknown or ineligible), COUPON_EXPIRED, COUPON_EXHAUSTED. Redemption counts at PAID.
     *
     *     **Requirements:** REQ-BOOK-015, REQ-PRICE-011, REQ-PRICE-013. **Permission:** `shipment:create`. **Audit:** UPDATE `order` NORMAL. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly put: operations['applyOrderCoupon'];
    readonly post?: never;
    /**
     * Remove the coupon
     * @description Removes the coupon and re-prices.
     *
     *     **Requirements:** REQ-BOOK-015. **Permission:** `shipment:create`. **Audit:** UPDATE `order` NORMAL. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly delete: operations['removeOrderCoupon'];
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/orders/{orderId}/payment': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get the payment of an order
     * @description Current payment record of the order (livemode false in this run).
     *
     *     **Requirements:** REQ-PAY-003, REQ-PAY-016, REQ-ACCT-003. **Permission:** `payment:read`. **Audit:** VIEW `payment` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getOrderPayment'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/orders/{orderId}/shipments': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Add a shipment to the open order
     * @description Adds a draft shipment; recalculates totals. Currency mismatch: 422 ORDER_CURRENCY_MISMATCH; 11th shipment: 422 LIMIT_EXCEEDED; order not OPEN: 409 ILLEGAL_STATE_TRANSITION.
     *
     *     **Requirements:** REQ-BOOK-014, REQ-BOOK-013. **Permission:** `shipment:create`. **Audit:** UPDATE `order` NORMAL. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['addOrderShipment'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/orders/{orderId}/shipments/{shipmentId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post?: never;
    /**
     * Remove a shipment from the open order
     * @description The draft stays under drafts; removing the last shipment empties the basket.
     *
     *     **Requirements:** REQ-BOOK-014. **Permission:** `shipment:create`. **Audit:** UPDATE `order` NORMAL. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly delete: operations['removeOrderShipment'];
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/organisations': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Create a business organisation
     * @description Creates a BUSINESS_CUSTOMER organisation with the caller as Owner. Max 10 owned organisations (422 LIMIT_EXCEEDED). Any type other than BUSINESS_CUSTOMER cannot be created (ORG_TYPE_NOT_ALLOWED).
     *
     *     **Requirements:** REQ-ORG-009, REQ-ORG-001. **Permission:** `authenticated` (Any signed-in user may create a business organisation (REQ-ORG-009).). **Audit:** CREATE `organisation` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** user.
     */
    readonly post: operations['createOrganisation'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/organisations/{orgId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get the organisation profile
     * @description Profile of the active organisation.
     *
     *     **Requirements:** REQ-ACCT-014, REQ-ORG-008. **Permission:** `org:read`. **Audit:** VIEW `organisation` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getOrganisation'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    /**
     * Update the organisation profile
     * @description Field-level diff audited. Country, locale and currency validated against reference data; type and ID are not updatable (UNKNOWN_FIELD).
     *
     *     **Requirements:** REQ-ORG-008. **Permission:** `org:update`. **Audit:** UPDATE `organisation` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly patch: operations['updateOrganisation'];
    readonly trace?: never;
  };
  readonly '/organisations/{orgId}/address-book': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List and search the address book
     * @description Search by name, company, city and label via `q` (case-insensitive, partial).
     *
     *     **Requirements:** REQ-ACCT-008, REQ-BOOK-005. **Permission:** `address_book:read`. **Audit:** VIEW `address_book_entry` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['listAddressBookEntries'];
    readonly put?: never;
    /**
     * Create an address-book entry
     * @description Validated by country rules (REQ-BOOK-006). Max 500 entries per organisation (422 LIMIT_EXCEEDED). Setting `is_default_sender` clears the previous default.
     *
     *     **Requirements:** REQ-ACCT-008, REQ-ACCT-009. **Permission:** `address_book:manage`. **Audit:** CREATE `address_book_entry` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['createAddressBookEntry'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/organisations/{orgId}/address-book/{entryId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get an address-book entry
     * @description One entry of the active organisation.
     *
     *     **Requirements:** REQ-ACCT-008. **Permission:** `address_book:read`. **Audit:** VIEW `address_book_entry` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getAddressBookEntry'];
    /**
     * Replace an address-book entry
     * @description Full replacement; never alters booked shipments (they hold snapshots).
     *
     *     **Requirements:** REQ-ACCT-008, REQ-ACCT-009. **Permission:** `address_book:manage`. **Audit:** UPDATE `address_book_entry` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly put: operations['replaceAddressBookEntry'];
    readonly post?: never;
    /**
     * Delete an address-book entry
     * @description Soft delete; deleting the default sender clears the default.
     *
     *     **Requirements:** REQ-ACCT-008, REQ-ACCT-009. **Permission:** `address_book:manage`. **Audit:** DELETE `address_book_entry` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly delete: operations['deleteAddressBookEntry'];
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/organisations/{orgId}/address-book/import': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Import address-book rows (CSV parsed in the browser)
     * @description Accepts up to 1000 structured rows (CSV parsed client-side, D-025). `dry_run: true` returns the per-row report; `dry_run: false` creates only valid rows (one audit entry per created row). Duplicates by label + postcode are reported. Exceeding 500 entries: 422 LIMIT_EXCEEDED.
     *
     *     **Requirements:** REQ-ACCT-010. **Permission:** `address_book:manage`. **Audit:** CREATE `address_book_entry` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['importAddressBookEntries'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/organisations/{orgId}/invitations': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List invitations
     * @description Invitations of the active organisation.
     *
     *     **Requirements:** REQ-ORG-010. **Permission:** `org:member:invite`. **Audit:** VIEW `invitation` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['listInvitations'];
    readonly put?: never;
    /**
     * Invite a member
     * @description Single-use token valid 7 days (stored hashed); email in the chosen locale via `org.invitation_created`. Owner role only by an Owner. Existing ACTIVE member: 409 ALREADY_MEMBER. INDIVIDUAL organisation: 422 ORG_TYPE_RESTRICTION.
     *
     *     Step-up re-authentication (SEC-P3-01): accepted without a proof only while the access token's `auth_time` (last password or MFA verification) is at most 12 h old (`x-reauth-max-age: 43200`); otherwise a valid `X-Reauth-Proof` for scope `org.member.manage` from `createReauthProof` (5 min, single-use) is required, else 401 REAUTH_REQUIRED. Refresh never renews `auth_time`.
     *
     *     **Requirements:** REQ-ORG-010, REQ-ORG-014, REQ-ACCT-014, REQ-AUTH-020. **Permission:** `org:member:invite`. **Audit:** CREATE `invitation` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['createInvitation'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/organisations/{orgId}/invitations/{invitationId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post?: never;
    /**
     * Revoke an invitation
     * @description Revokes a pending invitation; its token then returns TOKEN_INVALID.
     *
     *     **Requirements:** REQ-ORG-010. **Permission:** `org:member:invite`. **Audit:** DELETE `invitation` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly delete: operations['revokeInvitation'];
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/organisations/{orgId}/invitations/{invitationId}/resend': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Resend an invitation
     * @description Issues a new token (superseding the old) and resends; at most 3 resends (422 LIMIT_EXCEEDED).
     *
     *     Step-up re-authentication (SEC-P3-01): accepted without a proof only while the access token's `auth_time` (last password or MFA verification) is at most 12 h old (`x-reauth-max-age: 43200`); otherwise a valid `X-Reauth-Proof` for scope `org.member.manage` from `createReauthProof` (5 min, single-use) is required, else 401 REAUTH_REQUIRED. Refresh never renews `auth_time`.
     *
     *     **Requirements:** REQ-ORG-010, REQ-AUTH-020. **Permission:** `org:member:invite`. **Audit:** UPDATE `invitation` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['resendInvitation'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/organisations/{orgId}/members': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List members
     * @description Memberships of the active organisation.
     *
     *     **Requirements:** REQ-ACCT-014, REQ-ORG-003. **Permission:** `org:read`. **Audit:** VIEW `membership` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['listMembers'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/organisations/{orgId}/members/{membershipId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    readonly post?: never;
    /**
     * Remove a member
     * @description Moves the membership to REMOVED (history kept) and revokes the member sessions in this organisation within 5 s. Removing the last Owner: 422 LAST_OWNER.
     *
     *     Step-up re-authentication (SEC-P3-01): accepted without a proof only while the access token's `auth_time` (last password or MFA verification) is at most 12 h old (`x-reauth-max-age: 43200`); otherwise a valid `X-Reauth-Proof` for scope `org.member.manage` from `createReauthProof` (5 min, single-use) is required, else 401 REAUTH_REQUIRED. Refresh never renews `auth_time`.
     *
     *     **Requirements:** REQ-ORG-012, REQ-ORG-013, REQ-AUTH-009, REQ-AUTH-020. **Permission:** `org:member:manage`. **Audit:** DELETE `membership` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly delete: operations['removeMember'];
    readonly options?: never;
    readonly head?: never;
    /**
     * Change a member's roles or status
     * @description Only an Owner may grant owner or modify an Owner; a member cannot change their own roles (403 AUTHZ_DENIED). Leaving no ACTIVE Owner: 422 LAST_OWNER. Revokes the member sessions whose active context is this organisation.
     *
     *     Step-up re-authentication (SEC-P3-01): accepted without a proof only while the access token's `auth_time` (last password or MFA verification) is at most 12 h old (`x-reauth-max-age: 43200`); otherwise a valid `X-Reauth-Proof` for scope `org.member.manage` from `createReauthProof` (5 min, single-use) is required, else 401 REAUTH_REQUIRED. Refresh never renews `auth_time`.
     *
     *     **Requirements:** REQ-ORG-012, REQ-ORG-013, REQ-ORG-004, REQ-ACCT-015, REQ-AUTH-020. **Permission:** `org:member:manage`. **Audit:** UPDATE `membership` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly patch: operations['updateMember'];
    readonly trace?: never;
  };
  readonly '/payments/{paymentId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get a payment
     * @description Payment record with status history and refunds; livemode false (REQ-PAY-016).
     *
     *     **Requirements:** REQ-PAY-003, REQ-PAY-016. **Permission:** `payment:read`. **Audit:** VIEW `payment` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getPayment'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/payments/{paymentId}/confirm': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Confirm after hosted fields or 3-D Secure
     * @description Called after the hosted confirmation or 3DS return. The server retrieves the gateway object and derives state from it (never from the client result or event order); a webhook may already have applied it (EC-B11, no-op). AUTHORISED moves shipments to PAID and starts the saga; FAILED returns shipments to QUOTED with failure_code (CARD_DECLINED, INSUFFICIENT_FUNDS, AUTHENTICATION_FAILED, EXPIRED_CARD, GATEWAY_UNAVAILABLE).
     *
     *     CVC recollection outcome (SEC-P3-28, ADR-0012 amendment 4). When the payment has `cvc_recollection_required: true`, the derivation treats the authorisation as `AUTHORISED` only if the retrieved charge has `payment_method_details.card.checks.cvc_check = 'pass'`. Any other value (`fail`, `unavailable`, `unchecked` or absent) voids the authorisation (manual capture, so no money moves); the payment becomes `FAILED` with `failure_code: AUTHENTICATION_FAILED` and is returned as a normal 200 (no new status code): audited `UPDATE payment`, security event `cvc_recollection_failed`, shipments back to `QUOTED`, no saga start, and the attempt counts toward the 5-per-hour cap of `checkoutOrder`. The same derivation function runs on the webhook path (`receiveStripeWebhook`, `receiveMockGatewayWebhook`), so whichever arrives first applies the outcome and the other is a no-op. The client then offers another card or `createReauthProof` (which advances `auth_time`, so the retried checkout needs no CVC).
     *
     *     **Requirements:** REQ-PAY-009, REQ-PAY-010, REQ-PAY-012, REQ-BOOK-020. **Permission:** `payment:create`. **Audit:** UPDATE `payment` NORMAL. **Idempotency:** required. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['confirmPayment'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/public/shared-quotes/resolve': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * View a shared quote by token
     * @description The share link carries the token in the URL fragment; the page posts it here so it never reaches paths, query strings or access logs (ADR-0016 amendment 2). Safe: no state change. Read-only, no personal data (countries and cities, packages, options, prices). Unknown, revoked, superseded and expired tokens return one byte-identical 404 `NOT_FOUND` problem body (same `type`, `title`, `status`, `code`, `instance` and generic `detail`; `correlation_id` echoes the request's `X-Correlation-Id`, so two requests sent with the same inbound `X-Correlation-Id` get identical bytes), with no field or header that distinguishes the cases (SEC-P3-32; D-055, EC-B29/EC-B53): `quote_share_resolve` also requires `expires_at > now()`, so the former expired view with prefilled inputs no longer exists and the shared page shows a generic "this shared quote is no longer available" notice with a link to start a new quote (D-UX-034).
     *
     *     **Requirements:** REQ-QUOTE-015. **Permission:** `public` (Anyone holding the share link.). **Audit:** VIEW `quote_share` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly post: operations['resolveSharedQuote'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/public/tracking': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Public tracking lookup
     * @description No login. Exactly one of `tracking_number` or `order_number` (Luhn check digit validated before any query; lists every shipment of the order). The customer-reference + postcode variant is `lookupPublicTracking` (POST, ADR-0016 amendment 2). Every miss returns the identical 404 TRACKING_NOT_FOUND with comparable timing (REQ-TRACK-012). Response is the DR-B31 allow-list only. Responses are `noindex`.
     *
     *     **Requirements:** REQ-TRACK-008, REQ-TRACK-010, REQ-TRACK-011, REQ-TRACK-012, REQ-DATA-015. **Permission:** `public` (Public tracking page (brief §4.6).). **Audit:** VIEW `shipment_tracking` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** public-tracking (30/min and 300/h per IP; unsuccessful lookups 10/min per IP). **Tenancy:** public.
     */
    readonly get: operations['getPublicTracking'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/public/tracking/lookup': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Public tracking by customer reference and postcode
     * @description No login. Returns a result only when exactly one shipment matches both the customer reference and the receiver postcode; otherwise answers exactly like an unknown number (404 TRACKING_NOT_FOUND, comparable timing; EC-B39). POST so the postcode never appears in a URL (ADR-0016 amendment 2). Safe: no state change. Same DR-B31 allow-list as getPublicTracking.
     *
     *     **Requirements:** REQ-TRACK-009, REQ-TRACK-010, REQ-TRACK-011, REQ-TRACK-012. **Permission:** `public` (Public tracking page (brief §4.6).). **Audit:** VIEW `shipment_tracking` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** public-tracking (30/min and 300/h per IP; unsuccessful lookups 10/min per IP). **Tenancy:** public.
     */
    readonly post: operations['lookupPublicTracking'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/quotes': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List saved quotes
     * @description The organisation's saved quotes with route, creation time and expiry; expired quotes are marked.
     *
     *     **Requirements:** REQ-QUOTE-014, REQ-ACCT-005. **Permission:** `quote:read`. **Audit:** VIEW `quote` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['listSavedQuotes'];
    readonly put?: never;
    /**
     * Create a quote and start rate shopping
     * @description Validates inputs against country reference data (postcode/city per location type) and package limits (DR-B34), persists the quote (expires in 24 h) and fans out to every enabled carrier account matching direction, content type, weight and dimensions (per-carrier 4 s, overall 5 s). Returns 201 immediately with carriers PENDING; results arrive on the SSE stream or via getQuote. Anonymous callers receive `guest_token` once (send as X-Quote-Token; never in URLs); authenticated callers create the quote in their active organisation. A bearer token, if present, must be valid. Non-enabled countries: 422 COUNTRY_NOT_SUPPORTED. Carrier fan-out happens here, exactly once per quote; `streamQuoteResults` never triggers it (SEC-P3-02).
     *
     *     Not idempotent-key capable: the response carries a one-time secret and is never stored (ADR-0014 amendment 1). An `Idempotency-Key` header is ignored; a client retry creates a new quote (SEC-P3-10).
     *
     *     Carrier quota protection (SEC-P3-29, ADR-0010 amendment 10). Users in `PENDING_VERIFICATION` are treated as anonymous: they are limited per IP by `public-quote` and count against the anonymous carrier budget (the anonymous bucket, its 50 % share and the 60 % stop of ADR-0010 amendments 2-3). Verified authenticated callers are limited by the `quote-create` class instead of `authenticated` (declared in `x-rate-limit-route`; ADR-0016 amendment 11). In addition, each organisation may use at most `CARRIER_QUOTA_ORG_SHARE_PCT` (default 10) % of a carrier account's daily quota for rates-pool calls; beyond it that organisation receives `carrier_error` with code `CARRIER_BUSY` (or cached results) for that carrier, other organisations still fan out, and the security event `carrier_quota_org_share_exhausted` fires (at most once a minute per carrier account and organisation). Transactional (booking) calls are never refused by the share. The quota share never produces an HTTP error: the quote is still created (201).
     *
     *     **Requirements:** REQ-QUOTE-001, REQ-QUOTE-002, REQ-QUOTE-003, REQ-QUOTE-004, REQ-CARR-008, REQ-CARR-010, REQ-CARR-005. **Permission:** `public` (Guests quote without an account (REQ-QUOTE-002, D-009); quote:create is held by every seeded role.). **Audit:** CREATE `quote` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** public-quote for anonymous callers and users in `PENDING_VERIFICATION` (20/min and 100/h per IP (REQ-QUOTE-002)); quote-create for verified authenticated callers (30/min and 300/h per user, and 1,000/h per organisation; SEC-P3-29). **Tenancy:** guest.
     */
    readonly post: operations['createQuote'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/quotes/{quoteId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get a quote (fallback for the stream)
     * @description Returns the quote with whatever carriers have completed so far (non-streaming fallback, REQ-CARR-009). Guests send X-Quote-Token; a wrong or missing token, or a claimed quote read with a guest token, returns 404 (A-078). Authenticated callers need quote:read in the owning organisation. `display_currency` adds an approximate converted amount per option.
     *
     *     **Requirements:** REQ-CARR-009, REQ-QUOTE-002, REQ-QUOTE-012, REQ-QUOTE-019, REQ-RLS-013. **Permission:** `public` (Guest branch authorised by the quote token; tenant branch requires quote:read.). **Audit:** VIEW `quote` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** guest.
     */
    readonly get: operations['getQuote'];
    readonly put?: never;
    readonly post?: never;
    /**
     * Delete a saved quote
     * @description Removes the quote from saved quotes (soft delete); a quote referenced by a shipment stays readable through the shipment.
     *
     *     **Requirements:** REQ-ACCT-005, REQ-QUOTE-014. **Permission:** `quote:delete`. **Audit:** DELETE `quote` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly delete: operations['deleteSavedQuote'];
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/quotes/{quoteId}/claim': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Claim a guest quote for the active organisation
     * @description Atomically sets the owner once (DR-B14) using the guest token in X-Quote-Token; the guest token stops working afterwards. Claim by the same organisation is idempotent (200); claimed by another organisation: 409 QUOTE_ALREADY_CLAIMED. createShipment performs the same claim implicitly.
     *
     *     **Requirements:** REQ-QUOTE-016, REQ-RLS-013, REQ-BOOK-001, REQ-QUOTE-014. **Permission:** `quote:create`. **Audit:** UPDATE `quote` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['claimQuote'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/quotes/{quoteId}/save': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Save a quote to the account
     * @description Marks the quote saved (claiming a guest quote first under the once-only rule). Expiry is not extended.
     *
     *     **Requirements:** REQ-QUOTE-014. **Permission:** `quote:create`. **Audit:** UPDATE `quote` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['saveQuote'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/quotes/{quoteId}/share': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Create a share link
     * @description Always mints a new share link with a >= 128-bit token, revokes any previous active share of the quote in the same transaction, and returns 201. It never returns an existing token: only the token hash (`share_token_hash`) is stored, so an earlier link stops resolving (404) as soon as a new one is created (SEC-P3-10, decided variant: mint-and-revoke, not 409 `SHARE_EXISTS`). The shared view exposes no personal data and expires with the quote.
     *
     *     Not idempotent-key capable: the response carries a one-time secret and is never stored (ADR-0014 amendment 1). An `Idempotency-Key` header is ignored; a client retry mints a new token and revokes the previous one.
     *
     *     Mint-and-revoke details (SEC-P3-32). The implicit revocation of the previous active share writes its own audit entry in the same transaction: `UPDATE quote_share` with `revoked_at` from null to the revocation time and the acting user, in addition to `CREATE quote_share` for the new share. At most 10 mints per quote per rolling hour (configuration; ADR-0016 amendment 11); the 11th returns 429 `RATE_LIMITED` with `Retry-After`, and no share is minted or revoked.
     *
     *     **Requirements:** REQ-QUOTE-015. **Permission:** `quote:share`. **Audit:** CREATE `quote_share` NORMAL (plus UPDATE `quote_share` NORMAL for the revoked previous share). **Idempotency:** not-applicable. **Rate-limit class:** authenticated (10 mints per quote per rolling hour). **Tenancy:** tenant.
     */
    readonly post: operations['createQuoteShare'];
    /**
     * Revoke the share link
     * @description Revokes the active share link; its token then returns 404.
     *
     *     **Requirements:** REQ-QUOTE-015. **Permission:** `quote:share`. **Audit:** DELETE `quote_share` NORMAL. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly delete: operations['revokeQuoteShare'];
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/quotes/{quoteId}/stream': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Stream rate-shopping results (SSE)
     * @description Server-sent events (REQ-API-017/018): `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `X-Accel-Buffering: no`, monotonically increasing `id`, comment heartbeat every 15 s. Events: `carrier_result` (SseCarrierResult: one carrier's priced options), `carrier_error` (SseCarrierError: carrier code, state timeout|error, canonical code; no raw text), `complete` (SseComplete: counts per status, per-carrier status, elapsed ms; sent by 5 s), `error` (SseError). The server closes within 1 s after `complete`/`error`, caps the stream at 30 s (normally closed by 6 s) and cancels upstream work within 1 s of client disconnect. Reconnect with `Last-Event-ID` (any replica): missed events are replayed from the persisted results before live events; the event id is the per-quote sequence number (ADR-0016 amendment 3). getQuote remains the non-streaming fallback. Authorised with the bearer header via a fetch-based client or, for guests, X-Quote-Token. Events carry no personal data.
     *
     *     Opening or reopening a stream never triggers carrier fan-out: fan-out happens once, at `POST /quotes` (`createQuote`); the stream only replays the persisted results and subscribes to new ones, so reconnects cost no carrier calls (SEC-P3-02, SEC-TC-42). Concurrent open streams are capped at 2 per client IP (IPv6 /64) and 5 per user (`SSE_MAX_STREAMS_PER_IP`, `SSE_MAX_STREAMS_PER_USER`, shared across replicas in Redis); the next stream is refused before it opens with 429 RATE_LIMITED and `Retry-After` (threat model R-15, T-47).
     *
     *     **Requirements:** REQ-CARR-009, REQ-API-017, REQ-API-018, REQ-QUOTE-008. **Permission:** `public` (Guest branch authorised by the quote token; tenant branch requires quote:read.). **Audit:** VIEW `quote` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** public (plus at most 2 concurrent streams per IP and 5 per user (SEC-P3-02)). **Tenancy:** guest.
     */
    readonly get: operations['streamQuoteResults'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/carriers': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List carriers and services
     * @description Enabled carriers (Mock outside production only) with service summaries from service reference data; sample values flagged unreviewed.
     *
     *     **Requirements:** REQ-CARR-021, REQ-CARR-006, REQ-DATA-016. **Permission:** `public` (Public reference data (REQ-DATA-016).). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['listCarriers'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/countries': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List countries
     * @description All ISO 3166-1 countries with localised names, currency, unit system, postcode format, location type and shipping enablement. Locale-aware collation.
     *
     *     **Requirements:** REQ-DATA-004, REQ-DATA-005, REQ-DATA-016, REQ-I18N-014. **Permission:** `public` (Public reference data (REQ-DATA-016).). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['listCountries'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/countries/{countryCode}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get one country
     * @description One country with postcode format and region requirement.
     *
     *     **Requirements:** REQ-DATA-004, REQ-DATA-016. **Permission:** `public` (Public reference data (REQ-DATA-016).). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['getCountry'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/countries/{countryCode}/subdivisions': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List states/provinces of a country
     * @description ISO 3166-2 subdivisions (US, CA, IN seeded) with localised names.
     *
     *     **Requirements:** REQ-DATA-007, REQ-DATA-016. **Permission:** `public` (Public reference data (REQ-DATA-016).). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['listSubdivisions'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/currencies': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List currencies
     * @description Seeded ISO 4217 currencies with minor-unit exponent.
     *
     *     **Requirements:** REQ-DATA-006, REQ-DATA-016. **Permission:** `public` (Public reference data (REQ-DATA-016).). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['listCurrencies'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/export-reasons': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List reasons for export
     * @description Reason codes with localised labels; DOCUMENTS applies only to document shipments.
     *
     *     **Requirements:** REQ-DATA-012, REQ-DATA-016. **Permission:** `public` (Public reference data (REQ-DATA-016).). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['listExportReasons'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/fx-rates': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List the latest FX snapshot
     * @description Latest FX snapshot rows (rate as 6-decimal string, timestamp, source, stale flag after 30 days).
     *
     *     **Requirements:** REQ-DATA-014, REQ-QUOTE-022, REQ-I18N-012. **Permission:** `public` (Public reference data (REQ-DATA-016).). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['listFxRates'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/fx-rates/convert': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Convert an amount with the FX snapshot
     * @description Indicative conversion for the currency converter page using the latest snapshot; rounding once to the target minor unit (DR-B11). Missing pair: 422 FX_RATE_UNAVAILABLE.
     *
     *     **Requirements:** REQ-QUOTE-022, REQ-I18N-012, REQ-PRICE-015. **Permission:** `public` (Public indicative calculator.). **Audit:** none (Public reference calculation; no entity read beyond public FX data.). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['convertCurrency'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/holidays': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List holidays
     * @description Public and bank holidays (2026, 2027) per country with local date and IANA zone; sample data flagged unreviewed.
     *
     *     **Requirements:** REQ-DATA-008, REQ-PICK-003, REQ-DATA-016. **Permission:** `public` (Public reference data (REQ-DATA-016).). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['listHolidays'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/hs-codes': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Search commodity codes (sample list)
     * @description Search by code prefix or keyword (min 2 chars) over the seeded sample HS list; at most 20 results; labelled sample data.
     *
     *     **Requirements:** REQ-CUST-006, REQ-DATA-010, REQ-DATA-016. **Permission:** `public` (Public lookup (REQ-CUST scope note).). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['searchHsCodes'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/incoterms': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List Incoterms 2020
     * @description Eleven Incoterms with localised labels, the courier-usable flag (DAP, DDP) and the DAP default.
     *
     *     **Requirements:** REQ-DATA-013, REQ-DATA-016. **Permission:** `public` (Public reference data (REQ-DATA-016).). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['listIncoterms'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/prohibited-items': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Look up prohibited and restricted items
     * @description Union of the destination country entries from the active compliance pack and the carrier entries; keyword search in the request locale plus English. When no pack applies, `pack.state` is PACK_UNAVAILABLE and only carrier entries are returned.
     *
     *     **Requirements:** REQ-DATA-011, REQ-QUOTE-020, REQ-COMP-004. **Permission:** `public` (Public lookup page (REQ-QUOTE-020).). **Audit:** none (Public reference data (REQ-AUDIT-006).). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['listProhibitedItems'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/reference/volumetric': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Calculate volumetric and billable weight
     * @description Pure calculation using the shared helper (DR-B05/DR-B06): volumetric weight = L x W x H / divisor (defaults 5000 cm3/kg metric, 139 in3/lb imperial). Used by the public calculator and the quote widget.
     *
     *     **Requirements:** REQ-QUOTE-021, REQ-QUOTE-006, REQ-PRICE-004. **Permission:** `public` (Public calculator.). **Audit:** none (Pure calculation over request parameters; no entity read.). **Idempotency:** not-applicable. **Rate-limit class:** public. **Tenancy:** public.
     */
    readonly get: operations['calculateVolumetricWeight'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/security/csp-report': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Receive a CSP violation report
     * @description Accepts `application/csp-report` and `application/reports+json`; logs the violation (no PII, query strings stripped) and increments a metric. Body limit 16 KB.
     *
     *     **Requirements:** REQ-SEC-002. **Permission:** `public` (Browsers send reports without credentials.). **Audit:** none (Security telemetry is logged, not audited (proposed addition to the REQ-AUDIT-006 NONE list).). **Idempotency:** not-applicable. **Rate-limit class:** csp-report (20/min per IP (DR-A22)). **Tenancy:** public.
     */
    readonly post: operations['reportCspViolation'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List shipments
     * @description The organisation's shipments, default newest first. `q` searches tracking number, order number, customer reference and receiver name (partial, case-insensitive, tenant only). Drafts: `filter[status]=DRAFT`.
     *
     *     **Requirements:** REQ-ACCT-002, REQ-ACCT-004, REQ-ACCT-020. **Permission:** `shipment:read`. **Audit:** VIEW `shipment` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['listShipments'];
    readonly put?: never;
    /**
     * Create a draft shipment (wizard step 1)
     * @description First save of wizard step 1: validates sender and receiver against country rules and compliance-pack reference requirements, claims the quote (X-Quote-Token for guest quotes), and creates the shipment in DRAFT with sender/receiver snapshots. Countries must match the selected option lane (422 ADDRESS_COUNTRY_MISMATCH). Expired quote: 409 QUOTE_EXPIRED. `on_behalf_of_org_id` is rejected as UNKNOWN_FIELD (REQ-ORG-007).
     *
     *     **Requirements:** REQ-BOOK-001, REQ-BOOK-002, REQ-BOOK-005, REQ-BOOK-006, REQ-BOOK-008, REQ-BOOK-027, REQ-QUOTE-016, REQ-ORG-007. **Permission:** `shipment:create`. **Audit:** CREATE `shipment` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['createShipment'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get a shipment
     * @description Full detail: state, parties (restricted references masked), packages, contents, collection, extras, immutable price snapshot, carrier, tracking number, screening status. Payment summary is fetched separately (payment:read).
     *
     *     **Requirements:** REQ-ACCT-003, REQ-BOOK-002, REQ-CUST-011, REQ-PRICE-017. **Permission:** `shipment:read`. **Audit:** VIEW `shipment` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getShipment'];
    readonly put?: never;
    readonly post?: never;
    /**
     * Delete a draft
     * @description Deleting a draft is a state transition to CANCELLED (soft delete). Only DRAFT/QUOTED (409 ILLEGAL_STATE_TRANSITION otherwise).
     *
     *     **Requirements:** REQ-ACCT-004, REQ-BOOK-018. **Permission:** `shipment:create`. **Audit:** STATE_TRANSITION `shipment` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly delete: operations['deleteDraftShipment'];
    readonly options?: never;
    readonly head?: never;
    /**
     * Save wizard sections of a draft
     * @description Partial save of parties, contents (incl. DG attestation), collection and extras; `complete_step` validates the step server-side. Rate-relevant changes require a new quote_id/quote_option_id and return the shipment to DRAFT (REQ-QUOTE-018). Cover changes re-price from stored carrier cost (422 COVER_VALUE_EXCEEDS_MAXIMUM). Only DRAFT/QUOTED shipments are editable (409 ILLEGAL_STATE_TRANSITION). Stale save: 412 with current ETag.
     *
     *     **Requirements:** REQ-BOOK-002, REQ-BOOK-004, REQ-BOOK-005, REQ-BOOK-006, REQ-BOOK-008, REQ-BOOK-009, REQ-BOOK-010, REQ-BOOK-011, REQ-QUOTE-018, REQ-CUST-010, REQ-PRICE-009. **Permission:** `shipment:create`. **Audit:** UPDATE `shipment` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly patch: operations['updateShipment'];
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/address-suggestions': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Get a carrier address suggestion
     * @description Calls the selected carrier `validateAddress` (where declared) with a 3 s budget; failure or timeout returns status UNAVAILABLE and never blocks the step.
     *
     *     **Requirements:** REQ-BOOK-007. **Permission:** `shipment:create`. **Audit:** VIEW `shipment` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['suggestShipmentAddress'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/cancel': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Cancel a shipment
     * @description BOOKED, LABEL_READY or PICKUP_SCHEDULED before any PICKED_UP/DROPPED_OFF scan: shipment to CANCELLED, then pickup cancel, carrier void (VOIDED) and automatic full refund (REFUNDED) run asynchronously; DRAFT/QUOTED/PENDING_PAYMENT cancel without carrier or refund steps. Otherwise 409 SHIPMENT_NOT_CANCELLABLE (DR-B20). Repeating is idempotent. Void failure moves to EXCEPTION without refund (REQ-BOOK-030).
     *
     *     **Requirements:** REQ-BOOK-029, REQ-BOOK-030, REQ-ACCT-007, REQ-PICK-008, REQ-PAY-013. **Permission:** `shipment:cancel`. **Audit:** STATE_TRANSITION `shipment` SENSITIVE. **Idempotency:** required. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['cancelShipment'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/customs': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get customs data
     * @description Customs lines, computed declared value, reason, Incoterm, acknowledgements, de-minimis hint (non-binding, unreviewed flag) and whether customs is required (DR-B23).
     *
     *     **Requirements:** REQ-CUST-001, REQ-CUST-003, REQ-CUST-008. **Permission:** `shipment:read`. **Audit:** VIEW `customs` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getShipmentCustoms'];
    /**
     * Save customs data
     * @description Full replacement of customs data on a draft. PARCEL cross-border: CustomsInput (1-50 lines, one currency, weights within package weight, 6/8/10-digit codes). DOCUMENT: DocumentDeclarationInput only (customs lines rejected). Prohibited match: 422 ITEM_PROHIBITED; restricted matches need acknowledgements. DDP only where offered (REQ-CUST-005).
     *
     *     **Requirements:** REQ-CUST-002, REQ-CUST-003, REQ-CUST-004, REQ-CUST-005, REQ-CUST-007, REQ-CUST-009, REQ-BOOK-009. **Permission:** `customs:manage`. **Audit:** UPDATE `shipment` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly put: operations['replaceShipmentCustoms'];
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/customs/check': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Check contents against prohibited/restricted lists
     * @description Inline check (client debounce 400 ms) of the stored draft plus optional unsaved texts and commodity codes against origin, destination and carrier lists, by whole-word accent-insensitive text and commodity chapter prefix (DR-B24). Read-only; returns matches rather than failing.
     *
     *     **Requirements:** REQ-CUST-009, REQ-CUST-007, REQ-CUST-008, REQ-BOOK-009. **Permission:** `customs:manage`. **Audit:** VIEW `customs` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['checkShipmentCustoms'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/documents': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List shipment documents
     * @description Type, version, format, size, SHA-256, status and creation time; latest CURRENT versions first. `filter[version]=all` style history via `filter[status]`.
     *
     *     **Requirements:** REQ-DOC-011, REQ-DOC-001, REQ-DOC-004, REQ-DOC-012. **Permission:** `document:read`. **Audit:** VIEW `document` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['listShipmentDocuments'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/documents/{documentId}/email': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Email documents to the account address
     * @description Sends the document (and, with `document_ids`, others of the same shipment) only to the verified account email; attachments up to 10 MB total, otherwise an account link. 5 sends per shipment per hour (429 RATE_LIMITED). Audited as DOWNLOAD with channel EMAIL.
     *
     *     **Requirements:** REQ-DOC-010, REQ-NOTIF-015. **Permission:** `document:email`. **Audit:** DOWNLOAD `document` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated (5 per shipment per hour). **Tenancy:** tenant.
     */
    readonly post: operations['emailShipmentDocuments'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/pickup': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get the active pickup
     * @description Active pickup record (local date, zone, window, carrier reference, instructions, cancel-failed flag).
     *
     *     **Requirements:** REQ-PICK-001, REQ-PICK-005. **Permission:** `pickup:read`. **Audit:** VIEW `pickup` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getShipmentPickup'];
    /**
     * Reschedule the active pickup
     * @description Until 2 hours before the current window starts: schedules the new pickup first and cancels the old one only after confirmation; failure leaves the old pickup untouched. New pickup confirmation version.
     *
     *     **Requirements:** REQ-PICK-009, REQ-DOC-003. **Permission:** `pickup:schedule`. **Audit:** UPDATE `pickup` SENSITIVE. **Idempotency:** required. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly put: operations['reschedulePickup'];
    /**
     * Schedule a pickup after booking
     * @description For LABEL_READY shipments without an active pickup (409 PICKUP_ALREADY_SCHEDULED; other states 409 ILLEGAL_STATE_TRANSITION). Validates date/window (422 PICKUP_DATE_INVALID / PICKUP_WINDOW_INVALID), calls `schedulePickup` (never auto-retried), moves to PICKUP_SCHEDULED and generates the pickup confirmation document. Instructions max 200 chars, control characters and markup stripped.
     *
     *     **Requirements:** REQ-PICK-007, REQ-PICK-002, REQ-PICK-004, REQ-PICK-012, REQ-DOC-003. **Permission:** `pickup:schedule`. **Audit:** CREATE `pickup` SENSITIVE. **Idempotency:** required. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['schedulePickup'];
    /**
     * Cancel the active pickup
     * @description Calls `cancelPickup`; the shipment returns to LABEL_READY (DR-B01). A failed carrier cancel is recorded as `pickup_cancel_failed` with a notice that a driver may still attend.
     *
     *     **Requirements:** REQ-PICK-008, REQ-BOOK-018. **Permission:** `pickup:cancel`. **Audit:** UPDATE `pickup` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly delete: operations['cancelPickup'];
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/pickup/availability': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get selectable pickup dates and windows
     * @description DR-B25 in the sender IANA zone: served weekdays minus pickup-unavailable holidays, today only when now + lead time (120 min) is before cut-off and latest close, 14-day horizon; standard windows 09:00-13:00 and 13:00-17:00 and custom-window bounds.
     *
     *     **Requirements:** REQ-PICK-002, REQ-PICK-003, REQ-PICK-004, REQ-QUOTE-007. **Permission:** `pickup:read`. **Audit:** VIEW `pickup_availability` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getPickupAvailability'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/repeat': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Repeat a past shipment
     * @description Creates a new DRAFT prefilled with sender, receiver, packages, contents, customs lines and references (not pickup, price or documents) and a fresh quote with the same inputs; cancelled shipments may be repeated.
     *
     *     **Requirements:** REQ-ACCT-006. **Permission:** `shipment:create`. **Audit:** CREATE `shipment` SENSITIVE. **Idempotency:** optional. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly post: operations['repeatShipment'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/service-points': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * List drop-off service points
     * @description Where the service supports drop-off and the adapter declares `findServicePoints`: up to 20 points within `radius_km` (default 25) of the sender postcode. Empty or failed lookup returns an empty list.
     *
     *     **Requirements:** REQ-PICK-010, REQ-BOOK-010. **Permission:** `shipment:create`. **Audit:** VIEW `service_point` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['listServicePoints'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/timeline': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get the state history timeline
     * @description Append-only state history (from, to, trigger, actor, reason code, time), oldest first; "Booked by" display for staff actors (brief §4.2).
     *
     *     **Requirements:** REQ-BOOK-019, REQ-ACCT-003. **Permission:** `shipment:read`. **Audit:** VIEW `shipment_transition` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['listShipmentTransitions'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/tracking': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    /**
     * Get the full tracking timeline
     * @description Owner view: canonical status, carrier original code and description, location, event times (UTC; displayed in the viewer zone) and estimated delivery. Raw payloads are never returned.
     *
     *     **Requirements:** REQ-TRACK-013, REQ-TRACK-005. **Permission:** `tracking:read`. **Audit:** VIEW `shipment_tracking` SENSITIVE. **Idempotency:** not-applicable. **Rate-limit class:** authenticated. **Tenancy:** tenant.
     */
    readonly get: operations['getShipmentTracking'];
    readonly put?: never;
    readonly post?: never;
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/shipments/{shipmentId}/tracking/refresh': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Trigger an immediate tracking poll
     * @description Queues an immediate poll through the shared pipeline; at most once every 5 minutes per shipment (429 RATE_LIMITED with Retry-After).
     *
     *     **Requirements:** REQ-TRACK-015. **Permission:** `shipment:create` (A-074: requires tracking:read and shipment:create; holders of shipment:create always hold tracking:read in the seed.). **Audit:** UPDATE `shipment_tracking` NORMAL. **Idempotency:** optional. **Rate-limit class:** authenticated (1 per shipment per 5 minutes). **Tenancy:** tenant.
     */
    readonly post: operations['refreshShipmentTracking'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/webhooks/carriers/{carrierCode}': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Receive a carrier tracking push
     * @description Per-carrier signature or shared-secret verification before parsing (401 AUTH_REQUIRED, nothing stored). Events go through the same mapping, de-duplication and transition pipeline as polling; unknown tracking numbers are accepted silently (202). Replays store one event.
     *
     *     **Requirements:** REQ-TRACK-006. **Permission:** `public` (Carrier callers authenticated by the route signature check (REQ-TRACK scope note).). **Audit:** CREATE `tracking_push` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** webhook. **Tenancy:** public.
     */
    readonly post: operations['receiveCarrierPush'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/webhooks/mock-gateway': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Receive a Mock gateway webhook (non-production)
     * @description Same pipeline as Stripe for the deterministic Mock gateway; route not mounted in production (REQ-PAY-002).
     *
     *     CVC recollection outcome (SEC-P3-28, ADR-0012 amendment 4): the same derivation function as `confirmPayment` and `receiveStripeWebhook` applies. With `cvc_recollection_required: true`, only the simulated `cvc_check = pass` (`test_token: mock_cvc_pass`) gives `AUTHORISED`; `mock_cvc_fail` and `mock_cvc_unavailable` void the authorisation and set `FAILED` with `failure_code: AUTHENTICATION_FAILED` (audited `UPDATE payment`, security event `cvc_recollection_failed`, shipments back to `QUOTED`, attempt counted). The webhook still answers 200.
     *
     *     **Requirements:** REQ-PAY-002, REQ-PAY-012. **Permission:** `webhook:mock_gateway:receive`. **Audit:** CREATE `webhook_event` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** webhook. **Tenancy:** public.
     */
    readonly post: operations['receiveMockGatewayWebhook'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
  readonly '/webhooks/stripe': {
    readonly parameters: {
      readonly query?: never;
      readonly header?: never;
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly get?: never;
    readonly put?: never;
    /**
     * Receive a Stripe webhook
     * @description Raw body verified against the endpoint secret (300 s tolerance) before parsing; failure: 400 WEBHOOK_SIGNATURE_INVALID without processing, audited DENIED with source IP, security event webhook_signature_invalid. Stored by gateway event ID before processing; duplicates answer 200 with `duplicate: true`; state is derived from the retrieved gateway object; unknown types stored and acknowledged. Replay by event ID is a worker command.
     *
     *     CVC recollection outcome (SEC-P3-28, ADR-0012 amendment 4): the processor uses the same payment-state derivation function as `confirmPayment`. When the payment has `cvc_recollection_required: true`, an authorisation counts as `AUTHORISED` only if the retrieved charge has `payment_method_details.card.checks.cvc_check = 'pass'`; any other value (`fail`, `unavailable`, `unchecked` or absent) voids the authorisation (manual capture, no money moves), sets the payment `FAILED` with `failure_code: AUTHENTICATION_FAILED` (audited `UPDATE payment`, actor SYSTEM), emits the security event `cvc_recollection_failed`, returns the shipments to `QUOTED` and counts the attempt toward the 5-per-hour cap. The webhook still answers 200.
     *
     *     **Requirements:** REQ-PAY-011, REQ-PAY-012. **Permission:** `webhook:stripe:receive`. **Audit:** CREATE `webhook_event` NORMAL. **Idempotency:** not-applicable. **Rate-limit class:** webhook. **Tenancy:** public.
     */
    readonly post: operations['receiveStripeWebhook'];
    readonly delete?: never;
    readonly options?: never;
    readonly head?: never;
    readonly patch?: never;
    readonly trace?: never;
  };
}
export type webhooks = Record<string, never>;
export interface components {
  schemas: {
    /** @description Uniform 202 body (no enumeration, EC-A01). */
    readonly Accepted: {
      readonly message_key: string;
      /** @enum {string} */
      readonly status: 'ACCEPTED';
    };
    /** @description Postal address. Field lengths of the strictest carrier are enforced server-side (REQ-BOOK-006). */
    readonly Address: {
      readonly city: string;
      readonly country_code: components['schemas']['CountryCode'];
      readonly line1: string;
      readonly line2?: string | null;
      readonly line3?: string | null;
      /** @description Validated against the country pattern (REQ-BOOK-006). */
      readonly postcode?: string | null;
      /** @description ISO 3166-2 subdivision; required where the country requires it. */
      readonly region_code?: string | null;
      /** @description Residential delivery flag. */
      readonly residential: boolean;
    };
    readonly AddressBookEntry: {
      readonly address: components['schemas']['Address'];
      readonly contact: components['schemas']['Contact'];
      readonly created_at: components['schemas']['Timestamp'];
      readonly id: components['schemas']['Uuid'];
      readonly is_default_sender: boolean;
      readonly label: string;
      readonly updated_at: components['schemas']['Timestamp'];
      readonly version: number;
    };
    readonly AddressBookEntryInput: {
      readonly address: components['schemas']['Address'];
      readonly contact: components['schemas']['Contact'];
      readonly is_default_sender?: boolean;
      readonly label: string;
    };
    /** @description Cursor page of AddressBookEntry (REQ-API-007). */
    readonly AddressBookEntryList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['AddressBookEntry'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly AddressBookImportReport: {
      readonly created_count: number;
      readonly dry_run: boolean;
      readonly duplicates: readonly {
        readonly existing_entry_id: components['schemas']['Uuid'];
        readonly row: number;
      }[];
      readonly rejected: readonly {
        readonly errors: readonly components['schemas']['ValidationIssue'][];
        readonly row: number;
      }[];
      readonly valid_count: number;
    };
    readonly AddressBookImportRequest: {
      /** @description true = validate and report only (confirm step). */
      readonly dry_run: boolean;
      readonly rows: readonly components['schemas']['AddressBookEntryInput'][];
    };
    readonly AddressSuggestion: {
      /** @enum {string} */
      readonly party: 'SENDER' | 'RECEIVER';
      /** @enum {string} */
      readonly status: 'SUGGESTED' | 'VALID' | 'UNAVAILABLE';
      readonly suggestion: components['schemas']['Address'] | null;
    };
    readonly AddressSuggestionRequest: {
      /** @enum {string} */
      readonly party: 'SENDER' | 'RECEIVER';
    };
    readonly AuditChainStatus: {
      readonly first_broken_entry_id: components['schemas']['Uuid'] | null;
      readonly last_full: {
        readonly entries_checked: number;
        readonly finished_at: components['schemas']['Timestamp'];
        readonly ok: boolean;
      } | null;
      readonly last_incremental: {
        readonly entries_checked: number;
        readonly finished_at: components['schemas']['Timestamp'];
        readonly ok: boolean;
      } | null;
      readonly partitions: {
        readonly degraded: boolean;
        readonly future_months: number;
      };
      /** @enum {string} */
      readonly status: 'OK' | 'BROKEN' | 'NEVER_RUN';
    };
    /** @description Full audit entry (REQ-AUDIT-003, REQ-AUDIT-020). */
    readonly AuditEntry: {
      /** @enum {string} */
      readonly action:
        | 'CREATE'
        | 'UPDATE'
        | 'DELETE'
        | 'VIEW'
        | 'DOWNLOAD'
        | 'LOGIN'
        | 'LOGOUT'
        | 'LOGIN_FAILED'
        | 'ACCOUNT_LOCKED'
        | 'TOKEN_REUSE_DETECTED'
        | 'MFA_ENROLLED'
        | 'MFA_FAILED'
        | 'PERMISSION_DENIED'
        | 'EXPORT'
        | 'ON_BEHALF_ACTION'
        | 'CONFIG_CHANGE'
        | 'API_KEY_USE'
        | 'STATE_TRANSITION';
      /** @enum {string} */
      readonly actor_type: 'USER' | 'API_KEY' | 'SYSTEM_JOB' | 'ANONYMOUS';
      readonly correlation_id: string;
      readonly device: {
        readonly browser: string | null;
        readonly device_type: string | null;
        readonly os: string | null;
      } | null;
      readonly entity_id: string | null;
      readonly entity_name: string;
      readonly entry_hash: components['schemas']['Sha256Hex'];
      readonly id: components['schemas']['Uuid'];
      readonly ip: string | null;
      readonly job_name: string | null;
      readonly new_value: Record<string, never> | null;
      readonly occurred_at: components['schemas']['Timestamp'];
      /** @description Field-level diff; [REDACTED] for secrets, [ERASED] for erased PII tokens. */
      readonly old_value: Record<string, never> | null;
      readonly on_behalf_of_org_id: components['schemas']['Uuid'] | null;
      readonly org_id: components['schemas']['Uuid'] | null;
      /** @enum {string} */
      readonly outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
      readonly prev_hash: components['schemas']['Sha256Hex'];
      readonly reason: string | null;
      readonly roles: readonly string[];
      readonly session_id: components['schemas']['Uuid'] | null;
      /** @enum {string} */
      readonly source_app: 'web' | 'admin' | 'api' | 'worker';
      readonly stream_id: components['schemas']['Uuid'];
      readonly target_org_id: components['schemas']['Uuid'] | null;
      readonly user_agent: string | null;
      readonly user_display: string | null;
      readonly user_id: components['schemas']['Uuid'] | null;
    };
    /** @description Entity history, oldest first (REQ-AUDIT-021). */
    readonly AuditEntryList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['AuditEntry'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly AuditEntrySummary: {
      /** @enum {string} */
      readonly action:
        | 'CREATE'
        | 'UPDATE'
        | 'DELETE'
        | 'VIEW'
        | 'DOWNLOAD'
        | 'LOGIN'
        | 'LOGOUT'
        | 'LOGIN_FAILED'
        | 'ACCOUNT_LOCKED'
        | 'TOKEN_REUSE_DETECTED'
        | 'MFA_ENROLLED'
        | 'MFA_FAILED'
        | 'PERMISSION_DENIED'
        | 'EXPORT'
        | 'ON_BEHALF_ACTION'
        | 'CONFIG_CHANGE'
        | 'API_KEY_USE'
        | 'STATE_TRANSITION';
      /** @enum {string} */
      readonly actor_type: 'USER' | 'API_KEY' | 'SYSTEM_JOB' | 'ANONYMOUS';
      readonly entity_id: string | null;
      readonly entity_name: string;
      readonly id: components['schemas']['Uuid'];
      readonly ip: string | null;
      readonly occurred_at: components['schemas']['Timestamp'];
      readonly org_id: components['schemas']['Uuid'] | null;
      /** @enum {string} */
      readonly outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
      readonly roles: readonly string[];
      /** @enum {string} */
      readonly source_app: 'web' | 'admin' | 'api' | 'worker';
      readonly user_display: string | null;
      readonly user_id: components['schemas']['Uuid'] | null;
    };
    /** @description Newest first; default 50, max 200 (REQ-AUDIT-019). */
    readonly AuditEntrySummaryList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['AuditEntrySummary'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly BlockingCondition: {
      /** @enum {string} */
      readonly condition:
        'EMAIL_NOT_VERIFIED' | 'QUOTE_EXPIRED' | 'STEPS_INCOMPLETE' | 'ITEM_PROHIBITED' | 'DG_ATTESTATION_REQUIRED' | 'ORDER_EMPTY';
      readonly shipment_id: components['schemas']['Uuid'] | null;
    };
    /** @description Saga progress per shipment (REQ-BOOK-025). */
    readonly BookingProgress: {
      readonly complete: boolean;
      readonly order_id: components['schemas']['Uuid'];
      readonly order_number: string | null;
      readonly shipments: readonly {
        readonly shipment_id: components['schemas']['Uuid'];
        readonly state: components['schemas']['ShipmentState'];
        readonly steps: readonly {
          readonly error_code: string | null;
          readonly status: components['schemas']['SagaStepStatus'];
          readonly step: components['schemas']['SagaStep'];
          readonly updated_at: components['schemas']['Timestamp'] | null;
        }[];
      }[];
    };
    /** @description REQ-BOOK-029, REQ-ACCT-007. */
    readonly CancellationResult: {
      /** @enum {string} */
      readonly outcome: 'CANCELLED' | 'VOID_PENDING' | 'VOIDED' | 'REFUND_PENDING' | 'REFUNDED' | 'NOT_CANCELLABLE_EXCEPTION';
      readonly refund_amount: components['schemas']['Money'] | null;
      readonly shipment_id: components['schemas']['Uuid'];
      readonly state: components['schemas']['ShipmentState'];
    };
    readonly CancelShipmentRequest: {
      /** @enum {string} */
      readonly reason_code: 'CHANGED_MIND' | 'WRONG_ADDRESS' | 'WRONG_SERVICE' | 'OTHER';
      readonly reason_text?: string | null;
    };
    /** @description Carrier code, e.g. MOCK, DHL_EXPRESS, FEDEX, UPS. */
    readonly CarrierCode: string;
    /**
     * @description Carrier canonical error code (DR-B30). Separate namespace from HTTP problem codes.
     * @enum {string}
     */
    readonly CarrierErrorCode:
      | 'INVALID_ADDRESS'
      | 'POSTCODE_INVALID'
      | 'SERVICE_UNAVAILABLE'
      | 'WEIGHT_EXCEEDED'
      | 'DIMENSION_EXCEEDED'
      | 'PROHIBITED_ITEM'
      | 'CUSTOMS_DATA_INVALID'
      | 'AUTH_FAILED'
      | 'RATE_LIMITED'
      | 'TIMEOUT'
      | 'CARRIER_UNAVAILABLE'
      | 'CARRIER_BUSY'
      | 'DUPLICATE_SHIPMENT'
      | 'CANNOT_VOID'
      | 'PICKUP_UNAVAILABLE'
      | 'CAPABILITY_NOT_SUPPORTED'
      | 'CARRIER_UNKNOWN_ERROR';
    /** @description Carrier-specific tracking push body; parsed by the adapter after signature verification. */
    readonly CarrierPushPayload: Record<string, never>;
    /** @description Per-carrier rate-shopping status (REQ-CARR-008). */
    readonly CarrierQuoteStatus: {
      readonly cached: boolean;
      readonly carrier_code: components['schemas']['CarrierCode'];
      readonly carrier_name: string;
      readonly elapsed_ms: number | null;
      readonly error_code: components['schemas']['CarrierErrorCode'] | null;
      readonly exclusions: readonly components['schemas']['ServiceExclusion'][];
      /** @enum {string} */
      readonly status: 'PENDING' | 'OK' | 'NO_SERVICE' | 'TIMEOUT' | 'ERROR';
    };
    readonly CarrierService: {
      readonly content_types: readonly components['schemas']['ContentType'][];
      readonly ddp: boolean;
      readonly directions: readonly components['schemas']['Direction'][];
      readonly drop_off: boolean;
      readonly label_formats: readonly ('PDF_4X6' | 'PDF_A4' | 'PDF_LETTER' | 'ZPL')[];
      readonly name: string;
      readonly paperless: boolean;
      readonly pickup: boolean;
      readonly service_code: string;
      readonly tier: components['schemas']['ServiceTier'];
      readonly unreviewed: boolean;
    };
    readonly CarrierStatus: {
      /** @description Configuration reference name, never a secret. */
      readonly account_ref: string;
      /** @enum {string} */
      readonly breaker_state: 'CLOSED' | 'OPEN' | 'HALF_OPEN';
      readonly carrier_code: components['schemas']['CarrierCode'];
      /** @enum {string} */
      readonly environment: 'sandbox' | 'production';
      readonly last_failure_at: components['schemas']['Timestamp'] | null;
      readonly last_failure_code: components['schemas']['CarrierErrorCode'] | null;
      readonly last_success_at: components['schemas']['Timestamp'] | null;
      /** @enum {string} */
      readonly status: 'OK' | 'NOT_CONFIGURED' | 'DEGRADED' | 'CIRCUIT_OPEN' | 'DISABLED';
    };
    /** @description Cursor page of CarrierStatus (REQ-API-007). */
    readonly CarrierStatusList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['CarrierStatus'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly CarrierSummary: {
      readonly code: components['schemas']['CarrierCode'];
      readonly enabled: boolean;
      readonly name: string;
      readonly services: readonly components['schemas']['CarrierService'][];
    };
    /** @description Cursor page of CarrierSummary (REQ-API-007). */
    readonly CarrierSummaryList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['CarrierSummary'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly ChangePasswordRequest: {
      readonly current_password: string;
      readonly new_password: string;
    };
    /** @description Immutable charge line (REQ-PRICE-016). */
    readonly ChargeLine: {
      readonly amount: components['schemas']['Money'];
      /** @description BASE_FREIGHT, MARGIN, canonical surcharge (DR-B30), COVER, INCLUDED_COVER, DISCOUNT, COUPON. */
      readonly code: string;
      /** @description Zero-priced informational line (included cover). */
      readonly informational: boolean;
      /** @description i18n key; never a translated string. */
      readonly label_key: string;
      /** @enum {string} */
      readonly source: 'CARRIER' | 'MARGIN' | 'FUEL' | 'COVER' | 'DISCOUNT' | 'COUPON' | 'TAX';
      readonly tax_amount: components['schemas']['Money'];
      readonly tax_code: string | null;
    };
    readonly CheckoutRequest: {
      readonly expected_amount?: components['schemas']['Money'] | null;
      /**
       * @description Only CARD in M1 (REQ-PAY-019); other values -> 400 PAYMENT_METHOD_NOT_AVAILABLE.
       * @enum {string}
       */
      readonly method: 'CARD';
      /**
       * Format: uri
       * @description Same-origin URL for 3DS return.
       */
      readonly return_url?: string | null;
      readonly saved_payment_method_id?: components['schemas']['Uuid'] | null;
      /**
       * @description Mock gateway outcome token (REQ-PAY-002); rejected in production. `mock_cvc_pass`, `mock_cvc_fail` and `mock_cvc_unavailable` set the simulated `payment_method_details.card.checks.cvc_check` (`pass`, `fail`, `unavailable`) when CVC recollection is required (`cvc_recollection_required: true`): `pass` gives AUTHORISED, the other two give FAILED with `failure_code: AUTHENTICATION_FAILED` and a voided authorisation (SEC-P3-28, ADR-0012 amendment 4). When CVC recollection is not required they behave as `mock_ok`. The token `mock_cvc_required` named in ADR-0012 amendment 1 was never implemented and is withdrawn.
       * @enum {string|null}
       */
      readonly test_token?:
        | 'mock_ok'
        | 'mock_decline'
        | 'mock_3ds'
        | 'mock_3ds_fail'
        | 'mock_capture_fail'
        | 'mock_refund_fail'
        | 'mock_cvc_pass'
        | 'mock_cvc_fail'
        | 'mock_cvc_unavailable'
        | null;
    };
    readonly ClientAppRequest: {
      /** @enum {string} */
      readonly client_app: 'web' | 'admin';
    };
    readonly CollectionInput: {
      /** @enum {string} */
      readonly mode: 'PICKUP' | 'DROP_OFF';
      readonly pickup?: components['schemas']['PickupSelection'] | null;
      readonly service_point_id?: string | null;
    };
    /** @description Public subset of a compliance pack (D-020); no internal review notes. */
    readonly CompliancePackPublic: {
      readonly consent: {
        /** @enum {string} */
        readonly rule: 'NOTICE_ONLY' | 'OPT_IN' | 'OPT_OUT';
        readonly version: string;
      } | null;
      readonly country_code: string;
      readonly customs: {
        readonly accepted_commodity_code_lengths: readonly (6 | 8 | 10)[];
        readonly de_minimis: components['schemas']['Money'] | null;
        readonly document_exemption: boolean;
      } | null;
      readonly effective_from: components['schemas']['Timestamp'] | null;
      readonly privacy_notice_locales: readonly components['schemas']['Locale'][];
      readonly reference_requirements: readonly {
        readonly direction: components['schemas']['Direction'];
        /** @enum {string} */
        readonly party: 'SENDER' | 'RECEIVER';
        readonly pattern: string;
        readonly required: boolean;
        readonly type: string;
      }[];
      /** @description EU when the EU template applied. */
      readonly resolved_from: string | null;
      /** @enum {string} */
      readonly state: 'RESOLVED' | 'PACK_UNAVAILABLE';
      readonly tax: {
        /** @enum {string} */
        readonly display_mode: 'INCLUSIVE' | 'EXCLUSIVE';
        readonly label: string;
        readonly rate: components['schemas']['DecimalString'];
      } | null;
      /** @description reviewed_at is null (REQ-COMP-004). */
      readonly unreviewed: boolean;
      readonly version: number | null;
    };
    readonly ConsentRecord: {
      readonly anonymous_id: components['schemas']['Uuid'];
      readonly categories: {
        readonly analytics: boolean;
        readonly marketing: boolean;
        /** @constant */
        readonly necessary: true;
        readonly preferences: boolean;
      };
      readonly consent_rule_version: string;
      readonly id: components['schemas']['Uuid'];
      readonly recorded_at: components['schemas']['Timestamp'];
    };
    readonly ConsentRecordInput: {
      readonly anonymous_id: components['schemas']['Uuid'];
      readonly categories: {
        readonly analytics: boolean;
        readonly marketing: boolean;
        /** @constant */
        readonly necessary: true;
        readonly preferences: boolean;
      };
      readonly consent_rule_version: string;
      readonly country_code: components['schemas']['CountryCode'];
      /** @enum {string} */
      readonly source: 'BANNER' | 'FOOTER';
    };
    readonly Contact: {
      readonly company?: string | null;
      readonly email: components['schemas']['Email'];
      readonly name: string;
      readonly phone: components['schemas']['PhoneE164'];
    };
    /**
     * @description Shipment content type (REQ-BOOK-028).
     * @enum {string}
     */
    readonly ContentType: 'DOCUMENT' | 'PARCEL';
    readonly Country: {
      readonly alpha3: string;
      readonly code: components['schemas']['CountryCode'];
      readonly currency: components['schemas']['CurrencyCode'];
      readonly launch_country: boolean;
      /** @enum {string} */
      readonly location_type: 'POSTCODE_REQUIRED' | 'POSTCODE_OPTIONAL' | 'CITY_ONLY';
      /** @description Localised by Accept-Language. */
      readonly name: string;
      readonly numeric: string;
      readonly postcode: {
        readonly example: string;
        readonly pattern: string;
      } | null;
      readonly region_required: boolean;
      readonly shipping_enabled: boolean;
      readonly unit_system: components['schemas']['UnitSystem'];
    };
    /** @description ISO 3166-1 alpha-2. */
    readonly CountryCode: string;
    /** @description Cursor page of Country (REQ-API-007). */
    readonly CountryList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['Country'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly CouponRequest: {
      readonly code: string;
    };
    /** @description CSP violation report (report-uri or Reporting API format); logged, never stored with PII. */
    readonly CspReport: Record<string, never>;
    /** @description Valid while the refresh session lives; expires_at mirrors the session expiry. */
    readonly CsrfToken: {
      readonly csrf_token: string;
      readonly expires_at: components['schemas']['Timestamp'];
    };
    readonly Currency: {
      readonly code: components['schemas']['CurrencyCode'];
      readonly exponent: number;
      readonly name: string;
    };
    /** @description ISO 4217 alphabetic code. */
    readonly CurrencyCode: string;
    /** @description Cursor page of Currency (REQ-API-007). */
    readonly CurrencyList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['Currency'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly Customs: {
      readonly de_minimis_hint: components['schemas']['DeMinimisHint'] | null;
      readonly declared_value: components['schemas']['Money'] | null;
      /** @enum {string|null} */
      readonly incoterm: 'DAP' | 'DDP' | null;
      readonly items: readonly components['schemas']['CustomsItem'][];
      readonly non_commercial_attestation: boolean;
      readonly pack_version: number | null;
      readonly reason_for_export: string | null;
      /** @description DR-B23. */
      readonly required: boolean;
      readonly restricted_acknowledgements: readonly {
        readonly acknowledged_at: components['schemas']['Timestamp'];
        readonly prohibited_item_id: components['schemas']['Uuid'];
      }[];
      readonly shipment_id: components['schemas']['Uuid'];
      readonly version: number;
    };
    /** @description Optional unsaved texts/codes; the stored draft is always checked too. */
    readonly CustomsCheckRequest: {
      readonly commodity_codes?: readonly string[];
      readonly texts?: readonly string[];
    };
    readonly CustomsCheckResult: {
      /** @description True when any PROHIBITED match exists. */
      readonly blocking: boolean;
      readonly commodity_warnings: readonly {
        /** @enum {string} */
        readonly code: 'NOT_IN_SAMPLE_LIST';
        readonly pointer: string;
      }[];
      readonly customs_required: boolean;
      readonly de_minimis_hint: components['schemas']['DeMinimisHint'] | null;
      readonly matches: readonly components['schemas']['ProhibitedMatch'][];
    };
    readonly CustomsInput: {
      /** @enum {string} */
      readonly incoterm: 'DAP' | 'DDP';
      readonly items: readonly components['schemas']['CustomsItemInput'][];
      /**
       * @description REQ-CUST-004.
       * @enum {string}
       */
      readonly reason_for_export: 'SALE' | 'GIFT' | 'SAMPLE' | 'PERSONAL_EFFECTS' | 'REPAIR_RETURN' | 'RETURNED_GOODS';
      /** @description Prohibited-item entry IDs of RESTRICTED matches the user acknowledged. */
      readonly restricted_acknowledgements?: readonly components['schemas']['Uuid'][];
    };
    readonly CustomsItem: {
      readonly commodity_code: string;
      readonly country_of_manufacture: components['schemas']['CountryCode'];
      readonly description: string;
      readonly in_sample_list: boolean;
      readonly line_no: number;
      readonly line_value: components['schemas']['Money'];
      readonly quantity: number;
      readonly unit_net_weight_g: number;
      readonly unit_value: components['schemas']['Money'];
    };
    readonly CustomsItemInput: {
      /** @description Digits with optional dots/spaces; 6/8/10 digits after stripping (COMMODITY_CODE_FORMAT). */
      readonly commodity_code: string;
      readonly country_of_manufacture: components['schemas']['CountryCode'];
      readonly description: string;
      readonly quantity: number;
      readonly unit_net_weight_g: number;
      readonly unit_value: components['schemas']['Money'];
    };
    /** @description PUT body: CustomsInput for PARCEL cross-border shipments, DocumentDeclarationInput for DOCUMENT shipments (REQ-CUST-001/002). */
    readonly CustomsUpdate: components['schemas']['CustomsInput'] | components['schemas']['DocumentDeclarationInput'];
    readonly Dashboard: {
      readonly action_items: {
        readonly drafts: number;
        readonly exceptions: number;
        readonly label_ready_without_pickup: number;
        readonly pending_payment: number;
      };
      readonly recent_shipments: readonly components['schemas']['ShipmentSummary'][];
      /** @description Captured less refunded, per currency; null without payment:read. */
      readonly spend_this_month: readonly components['schemas']['Money'][] | null;
    };
    /** @description Exact decimal as a string (never a binary float). */
    readonly DecimalString: string;
    readonly DeMinimisHint: {
      readonly declared_value_converted: components['schemas']['Money'] | null;
      /** @constant */
      readonly non_binding: true;
      /** @enum {string} */
      readonly status: 'LIKELY_EXEMPT' | 'DUTIES_LIKELY' | 'NO_THRESHOLD';
      readonly threshold: components['schemas']['Money'] | null;
      readonly unreviewed: boolean;
    };
    /** @description No-dangerous-goods attestation (REQ-CUST-010). */
    readonly DgAttestation: {
      /** @constant */
      readonly accepted: true;
      readonly wording_version: string;
    };
    readonly DgAttestationRecord: {
      readonly accepted_at: components['schemas']['Timestamp'];
      readonly accepted_by: components['schemas']['Uuid'];
      readonly wording_version: string;
    };
    /**
     * @description Derived shipment direction (REQ-BOOK-027).
     * @enum {string}
     */
    readonly Direction: 'EXPORT' | 'IMPORT' | 'DOMESTIC';
    /** @description Informational conversion to the display currency (REQ-QUOTE-019). */
    readonly DisplayAmount: {
      /** @constant */
      readonly approximate: true;
      readonly currency: components['schemas']['CurrencyCode'];
      readonly gross: components['schemas']['Money'];
      readonly indicative: boolean;
    };
    /** @description Document metadata; storage key never exposed (REQ-DOC-001). */
    readonly Document: {
      readonly created_at: components['schemas']['Timestamp'];
      /** @enum {string} */
      readonly format: 'PDF_4X6' | 'PDF_A4' | 'PDF_LETTER' | 'ZPL';
      readonly id: components['schemas']['Uuid'];
      readonly media_type: string;
      readonly sha256: components['schemas']['Sha256Hex'];
      readonly shipment_id: components['schemas']['Uuid'];
      readonly size_bytes: number;
      /** @enum {string} */
      readonly status: 'CURRENT' | 'SUPERSEDED' | 'VOIDED';
      /** @enum {string} */
      readonly type: 'SHIPPING_LABEL' | 'COMMERCIAL_INVOICE' | 'PRO_FORMA_INVOICE' | 'CARRIER_CUSTOMS_DECLARATION' | 'PICKUP_CONFIRMATION';
      readonly version: number;
    };
    /** @description DOCUMENT shipments: no customs lines, attestation only (REQ-CUST-002). */
    readonly DocumentDeclarationInput: {
      /** @constant */
      readonly non_commercial_attestation: true;
    };
    readonly DocumentDownload: {
      readonly expires_at: components['schemas']['Timestamp'];
      readonly filename: string;
      readonly sha256: components['schemas']['Sha256Hex'];
      /**
       * Format: uri
       * @description Pre-signed URL, 300 s, Content-Disposition attachment; never logged.
       */
      readonly url: string;
      readonly version: number;
    };
    readonly DocumentEmailRequest: {
      /** @description Default: all CURRENT documents of the shipment. */
      readonly document_ids?: readonly components['schemas']['Uuid'][];
    };
    readonly DocumentEmailResult: {
      /** @enum {string} */
      readonly delivery: 'ATTACHMENTS' | 'ACCOUNT_LINK';
      readonly document_count: number;
      readonly recipient_masked: string;
      /** @enum {string} */
      readonly status: 'QUEUED';
    };
    /** @description Documents of a shipment; generation_pending tells the UI to show "documents are being prepared" (REQ-DOC-012). */
    readonly DocumentList: {
      readonly generation_pending: boolean;
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['Document'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    /** Format: email */
    readonly Email: string;
    readonly EmailRequest: {
      readonly email: components['schemas']['Email'];
    };
    readonly ExplanationEntry: {
      readonly config_version: string;
      /** Format: int64 */
      readonly effect_minor: number;
      /** @description Inputs the rule used (free-form, no personal data). */
      readonly inputs: Record<string, never>;
      /** @enum {string} */
      readonly outcome: 'FIRED' | 'REJECTED';
      readonly rule_key: string;
      /** @enum {string} */
      readonly rule_type: 'MARGIN' | 'FUEL' | 'SURCHARGE' | 'COVER' | 'DISCOUNT' | 'COUPON' | 'VOLUME_TIER' | 'FLOOR' | 'TAX' | 'FX';
    };
    readonly ExportReason: {
      /** @enum {string} */
      readonly code:
        'SALE' | 'GIFT' | 'SAMPLE' | 'REPAIR_RETURN' | 'PERSONAL_EFFECTS' | 'RETURNED_GOODS' | 'TEMPORARY_EXPORT' | 'DOCUMENTS';
      readonly documents_only: boolean;
      readonly label: string;
    };
    /** @description Cursor page of ExportReason (REQ-API-007). */
    readonly ExportReasonList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['ExportReason'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly ExtrasInput: {
      readonly cover?: {
        readonly insured_value: components['schemas']['Money'];
      } | null;
      readonly delivery_options?: readonly string[];
      readonly references?: components['schemas']['References'];
    };
    readonly FeatureFlag: {
      readonly created_at: components['schemas']['Timestamp'];
      readonly default_value: boolean;
      readonly description: string;
      readonly environments: {
        readonly local?: boolean | null;
        readonly production?: boolean | null;
        readonly staging?: boolean | null;
        readonly test?: boolean | null;
      };
      readonly key: string;
      readonly org_overrides: readonly {
        readonly org_id: components['schemas']['Uuid'];
        readonly value: boolean;
      }[];
      readonly updated_at: components['schemas']['Timestamp'];
      readonly version: number;
    };
    readonly FeatureFlagCreateRequest: {
      readonly default_value: boolean;
      readonly description: string;
      readonly environments?: {
        readonly local?: boolean | null;
        readonly production?: boolean | null;
        readonly staging?: boolean | null;
        readonly test?: boolean | null;
      };
      readonly key: string;
      readonly org_overrides?: readonly {
        readonly org_id: components['schemas']['Uuid'];
        readonly value: boolean;
      }[];
    };
    readonly FeatureFlagEvaluations: {
      readonly evaluated_at: components['schemas']['Timestamp'];
      /** @description key -> evaluated value for the caller org and environment (DR-A28). */
      readonly flags: {
        readonly [key: string]: boolean;
      };
    };
    /** @description Cursor page of FeatureFlag (REQ-API-007). */
    readonly FeatureFlagList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['FeatureFlag'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly FeatureFlagPatch: {
      readonly default_value?: boolean;
      readonly description?: string;
      readonly environments?: {
        readonly local?: boolean | null;
        readonly production?: boolean | null;
        readonly staging?: boolean | null;
        readonly test?: boolean | null;
      };
      readonly org_overrides?: readonly {
        readonly org_id: components['schemas']['Uuid'];
        readonly value: boolean;
      }[];
    };
    readonly FxApplied: {
      readonly cost_currency: components['schemas']['CurrencyCode'];
      readonly rate: components['schemas']['FxRateString'];
      readonly sell_currency: components['schemas']['CurrencyCode'];
      readonly snapshot_at: components['schemas']['Timestamp'];
      readonly source: string;
      /** @description Snapshot older than 30 days (DR-B13). */
      readonly stale: boolean;
    };
    readonly FxConversion: {
      readonly as_of: components['schemas']['Timestamp'];
      readonly from: components['schemas']['Money'];
      /** @constant */
      readonly indicative: true;
      readonly rate: components['schemas']['FxRateString'];
      readonly source: string;
      readonly to: components['schemas']['Money'];
    };
    readonly FxRate: {
      readonly as_of: components['schemas']['Timestamp'];
      readonly base: components['schemas']['CurrencyCode'];
      readonly quote: components['schemas']['CurrencyCode'];
      readonly rate: components['schemas']['FxRateString'];
      readonly source: string;
      readonly stale: boolean;
    };
    /** @description Cursor page of FxRate (REQ-API-007). */
    readonly FxRateList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['FxRate'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    /** @description FX rate with exactly 6 decimal places (DR-B11, NUMERIC(18,6)). */
    readonly FxRateString: string;
    readonly HealthLive: {
      /** @enum {string} */
      readonly status: 'ok';
    };
    /** @description No versions, hostnames or secrets (REQ-PLAT-018). */
    readonly HealthReady: {
      readonly components: {
        /** @enum {string} */
        readonly audit_chain: 'ok' | 'degraded';
        /** @enum {string} */
        readonly audit_partitions: 'ok' | 'degraded';
        /** @enum {string} */
        readonly database: 'ok' | 'unavailable';
        /** @enum {string} */
        readonly object_storage: 'ok' | 'unavailable';
        /** @enum {string} */
        readonly redis: 'ok' | 'unavailable';
      };
      /** @enum {string} */
      readonly status: 'ok' | 'degraded' | 'unavailable';
    };
    readonly Holiday: {
      readonly country_code: components['schemas']['CountryCode'];
      readonly date: components['schemas']['LocalDate'];
      readonly name: string;
      readonly pickups_unavailable: boolean;
      readonly region_code: string | null;
      readonly source: string;
      readonly time_zone: components['schemas']['TimeZone'];
      readonly unreviewed: boolean;
    };
    /** @description Cursor page of Holiday (REQ-API-007). */
    readonly HolidayList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['Holiday'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly HsCode: {
      readonly code: string;
      readonly description: string;
      /** @constant */
      readonly sample: true;
    };
    /** @description At most 20 results per page; labelled sample data (REQ-CUST-006). */
    readonly HsCodeList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['HsCode'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    /** @description Included carrier liability (REQ-PRICE-008). */
    readonly IncludedCover: {
      readonly max_amount: components['schemas']['Money'] | null;
      readonly percentage: components['schemas']['DecimalString'] | null;
      /** @enum {string} */
      readonly type: 'PERCENTAGE' | 'PER_KG' | 'FIXED';
    };
    readonly Incoterm: {
      /** @enum {string} */
      readonly code: 'EXW' | 'FCA' | 'CPT' | 'CIP' | 'DAP' | 'DPU' | 'DDP' | 'FAS' | 'FOB' | 'CFR' | 'CIF';
      readonly courier_usable: boolean;
      readonly is_default: boolean;
      readonly label: string;
    };
    /** @description Cursor page of Incoterm (REQ-API-007). */
    readonly IncotermList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['Incoterm'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly Invitation: {
      readonly created_at: components['schemas']['Timestamp'];
      readonly email: components['schemas']['Email'];
      readonly expires_at: components['schemas']['Timestamp'];
      readonly id: components['schemas']['Uuid'];
      readonly invited_by: {
        readonly display_name: string;
        readonly user_id: components['schemas']['Uuid'];
      };
      readonly locale: components['schemas']['Locale'];
      readonly organisation_id: components['schemas']['Uuid'];
      readonly resend_count: number;
      readonly role: string;
      /** @enum {string} */
      readonly status: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
    };
    readonly InvitationCreateRequest: {
      readonly email: components['schemas']['Email'];
      readonly locale?: components['schemas']['Locale'];
      /** @enum {string} */
      readonly role: 'owner' | 'admin' | 'shipper' | 'finance' | 'viewer';
    };
    /** @description Cursor page of Invitation (REQ-API-007). */
    readonly InvitationList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['Invitation'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly LegalDocument: {
      readonly body_markdown: string;
      readonly consent: {
        /** @enum {string} */
        readonly rule: 'NOTICE_ONLY' | 'OPT_IN' | 'OPT_OUT';
        readonly version: string;
      } | null;
      readonly country_code: string;
      /** @enum {string} */
      readonly document: 'privacy' | 'terms';
      readonly draft_banner: boolean;
      readonly fallback_used: boolean;
      readonly locale: components['schemas']['Locale'];
      readonly pack_version: number | null;
      readonly title: string;
      readonly unreviewed: boolean;
    };
    /**
     * Format: date
     * @description Local calendar date YYYY-MM-DD; always paired with an IANA zone where relevant (REQ-RLS-012).
     */
    readonly LocalDate: string;
    /**
     * @description Supported UI/email locale (D-023).
     * @enum {string}
     */
    readonly Locale: 'en' | 'es' | 'fr';
    /** @description Local wall-clock time HH:MM. */
    readonly LocalTime: string;
    readonly LoginRequest: {
      /** @enum {string} */
      readonly client_app: 'web' | 'admin';
      readonly email: components['schemas']['Email'];
      readonly password: string;
    };
    readonly Me: {
      readonly active_organisation: components['schemas']['OrganisationRef'];
      readonly memberships: readonly components['schemas']['MyMembership'][];
      /** @description Effective permissions in the active organisation (REQ-RBAC-009). */
      readonly permissions: readonly string[];
      readonly user: components['schemas']['UserProfile'];
    };
    readonly Membership: {
      readonly created_at: components['schemas']['Timestamp'];
      readonly id: components['schemas']['Uuid'];
      readonly organisation_id: components['schemas']['Uuid'];
      readonly roles: readonly string[];
      /** @enum {string} */
      readonly status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REMOVED';
      readonly updated_at: components['schemas']['Timestamp'];
      readonly user: {
        readonly display_name: string;
        readonly email: components['schemas']['Email'];
        readonly id: components['schemas']['Uuid'];
      };
      readonly version: number;
    };
    /** @description Cursor page of Membership (REQ-API-007). */
    readonly MembershipList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['Membership'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly MembershipPatch: {
      readonly roles?: readonly ('owner' | 'admin' | 'shipper' | 'finance' | 'viewer')[];
      /** @enum {string} */
      readonly status?: 'ACTIVE' | 'SUSPENDED';
    };
    readonly MePatch: {
      readonly display_currency?: components['schemas']['CurrencyCode'];
      readonly display_name?: string;
      readonly locale?: components['schemas']['Locale'];
      readonly time_zone?: components['schemas']['TimeZone'];
      readonly unit_system?: components['schemas']['UnitSystem'];
    };
    readonly MfaChallengeRequest: {
      readonly code: string;
      /** @enum {string} */
      readonly method: 'TOTP' | 'RECOVERY_CODE';
      readonly mfa_challenge_token: string;
    };
    readonly MockGatewayEvent: {
      readonly created_at: components['schemas']['Timestamp'];
      readonly id: string;
      readonly payment_reference: string;
      /** @enum {string} */
      readonly type:
        | 'payment.authorised'
        | 'payment.requires_action'
        | 'payment.failed'
        | 'payment.captured'
        | 'payment.capture_failed'
        | 'payment.voided'
        | 'payment.refunded'
        | 'payment.refund_failed';
    };
    /**
     * @description Money value (REQ-API-016, ADR-0009).
     * @example {
     *       "amount": 4599,
     *       "currency": "USD"
     *     }
     */
    readonly Money: {
      /**
       * Format: int64
       * @description Integer amount in minor units of the currency (ISO 4217 exponent). Never a float.
       */
      readonly amount: number;
      /** @description ISO 4217 code. */
      readonly currency: string;
    };
    readonly MyMembership: {
      readonly is_active_context: boolean;
      readonly membership_id: components['schemas']['Uuid'];
      readonly organisation: components['schemas']['OrganisationRef'];
      readonly roles: readonly string[];
      /** @enum {string} */
      readonly status: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REMOVED';
    };
    /** @description Cursor page of MyMembership (REQ-API-007). */
    readonly MyMembershipList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['MyMembership'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    /** @description No rendered subject/body is stored or returned (REQ-NOTIF-012). */
    readonly NotificationLogEntry: {
      readonly attempts: number;
      /** @enum {string} */
      readonly channel: 'EMAIL' | 'SMS' | 'WHATSAPP';
      readonly created_at: components['schemas']['Timestamp'];
      readonly id: components['schemas']['Uuid'];
      readonly locale: components['schemas']['Locale'];
      /** @description Address as at send time. */
      readonly recipient: string;
      readonly sent_at: components['schemas']['Timestamp'] | null;
      /** @enum {string} */
      readonly status: 'QUEUED' | 'SENT' | 'FAILED' | 'DEAD_LETTERED' | 'SUPPRESSED_BY_PREFERENCE';
      readonly template_id: string;
      readonly template_version: number;
      /** @description Redacted variables (identifiers only). */
      readonly variables: Record<string, never>;
    };
    /** @description Cursor page of NotificationLogEntry (REQ-API-007). */
    readonly NotificationLogList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['NotificationLogEntry'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly NotificationPreferences: {
      readonly marketing: boolean;
      readonly tracking_updates: boolean;
      readonly updated_at: components['schemas']['Timestamp'] | null;
    };
    readonly NotificationPreferencesInput: {
      readonly marketing: boolean;
      readonly tracking_updates: boolean;
    };
    readonly Order: {
      readonly coupon: {
        readonly code: string;
        /** @enum {string} */
        readonly status: 'APPLIED' | 'COUPON_INVALID' | 'COUPON_EXPIRED' | 'COUPON_EXHAUSTED';
      } | null;
      readonly created_at: components['schemas']['Timestamp'];
      readonly currency: components['schemas']['CurrencyCode'];
      readonly id: components['schemas']['Uuid'];
      /** @constant */
      readonly livemode: false;
      /** @description Allocated at checkout start (DR-B22). */
      readonly order_number: string | null;
      readonly payment_id: components['schemas']['Uuid'] | null;
      readonly shipments: readonly components['schemas']['OrderShipment'][];
      /** @enum {string} */
      readonly status: 'OPEN' | 'PENDING_PAYMENT' | 'PAID' | 'BOOKING' | 'BOOKED' | 'PARTIALLY_BOOKED' | 'FAILED' | 'CANCELLED';
      readonly totals: components['schemas']['PriceTotals'];
      readonly updated_at: components['schemas']['Timestamp'];
      readonly version: number;
    };
    readonly OrderAddShipmentRequest: {
      readonly shipment_id: components['schemas']['Uuid'];
    };
    readonly OrderCreateRequest: {
      readonly shipment_ids: readonly components['schemas']['Uuid'][];
    };
    readonly OrderShipment: {
      readonly booking_error_code: components['schemas']['CarrierErrorCode'] | null;
      readonly carrier_code: components['schemas']['CarrierCode'] | null;
      readonly coupon_discount: components['schemas']['Money'] | null;
      readonly gross: components['schemas']['Money'] | null;
      readonly service_name: string | null;
      readonly shipment_id: components['schemas']['Uuid'];
      readonly state: components['schemas']['ShipmentState'];
    };
    readonly OrderSummary: {
      readonly created_at: components['schemas']['Timestamp'];
      readonly gross: components['schemas']['Money'];
      readonly id: components['schemas']['Uuid'];
      readonly order_number: string | null;
      readonly shipment_count: number;
      /** @enum {string} */
      readonly status: 'OPEN' | 'PENDING_PAYMENT' | 'PAID' | 'BOOKING' | 'BOOKED' | 'PARTIALLY_BOOKED' | 'FAILED' | 'CANCELLED';
    };
    /** @description Cursor page of OrderSummary (REQ-API-007). */
    readonly OrderSummaryList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['OrderSummary'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly Organisation: {
      readonly address: components['schemas']['Address'] | null;
      readonly contact_email: components['schemas']['Email'] | null;
      readonly country_code: components['schemas']['CountryCode'];
      readonly created_at: components['schemas']['Timestamp'];
      readonly default_currency: components['schemas']['CurrencyCode'];
      readonly default_locale: components['schemas']['Locale'];
      readonly id: components['schemas']['Uuid'];
      readonly legal_name: string | null;
      readonly name: string;
      readonly phone: components['schemas']['PhoneE164'] | null;
      readonly tax_references: readonly {
        readonly type: string;
        readonly value: string;
      }[];
      /** @enum {string} */
      readonly type: 'OPERATOR' | 'BUSINESS_CUSTOMER' | 'PARTNER' | 'INDIVIDUAL';
      readonly updated_at: components['schemas']['Timestamp'];
      readonly version: number;
    };
    readonly OrganisationCreateRequest: {
      readonly country_code: components['schemas']['CountryCode'];
      readonly default_currency: components['schemas']['CurrencyCode'];
      readonly name: string;
    };
    readonly OrganisationPatch: {
      readonly address?: components['schemas']['Address'] | null;
      readonly contact_email?: components['schemas']['Email'] | null;
      readonly country_code?: components['schemas']['CountryCode'];
      readonly default_currency?: components['schemas']['CurrencyCode'];
      readonly default_locale?: components['schemas']['Locale'];
      readonly legal_name?: string | null;
      readonly name?: string;
      readonly phone?: components['schemas']['PhoneE164'] | null;
      readonly tax_references?: readonly {
        readonly type: string;
        readonly value: string;
      }[];
    };
    readonly OrganisationRef: {
      readonly id: components['schemas']['Uuid'];
      readonly name: string;
      /** @enum {string} */
      readonly type: 'OPERATOR' | 'BUSINESS_CUSTOMER' | 'PARTNER' | 'INDIVIDUAL';
    };
    /** @description Canonical package (integer grams and millimetres) plus display values. */
    readonly Package: {
      readonly display: components['schemas']['PackageDisplay'];
      readonly height_mm: number;
      readonly length_mm: number;
      readonly package_type: components['schemas']['PackageType'];
      /** @description Volumetric weight at the default divisor of the unit system (DR-B05). */
      readonly volumetric_weight_g: number;
      /** @description Actual weight, integer grams. */
      readonly weight_g: number;
      readonly width_mm: number;
    };
    readonly PackageDisplay: {
      readonly height: number;
      readonly length: number;
      readonly unit_system: components['schemas']['UnitSystem'];
      /** @description kg or lb, 1 decimal */
      readonly weight: number;
      readonly width: number;
    };
    /** @description Package as entered; converted to integer grams/millimetres (DR-B06). Limits DR-B34. */
    readonly PackageInput: components['schemas']['PackageInputMetric'] | components['schemas']['PackageInputImperial'];
    readonly PackageInputImperial: {
      /** @description in */
      readonly height: number;
      /** @description in */
      readonly length: number;
      readonly package_type: components['schemas']['PackageType'];
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      readonly unit_system: 'IMPERIAL';
      /** @description lb */
      readonly weight: number;
      /** @description in */
      readonly width: number;
    };
    readonly PackageInputMetric: {
      /** @description cm */
      readonly height: number;
      /** @description cm */
      readonly length: number;
      readonly package_type: components['schemas']['PackageType'];
      /**
       * @description discriminator enum property added by openapi-typescript
       * @enum {string}
       */
      readonly unit_system: 'METRIC';
      /** @description kg */
      readonly weight: number;
      /** @description cm */
      readonly width: number;
    };
    /**
     * @description Package type; values extend later (pallets/freight) (REQ-BOOK-028).
     * @enum {string}
     */
    readonly PackageType: 'PARCEL_BOX' | 'ENVELOPE';
    /** @description Structured snapshot stored on the shipment (REQ-BOOK-005). */
    readonly Party: {
      readonly address: components['schemas']['Address'];
      readonly address_suggestion_accepted: boolean;
      readonly contact: components['schemas']['Contact'];
      readonly tax_references: readonly components['schemas']['TaxReferenceMasked'][];
    };
    readonly PartyInput: {
      readonly address: components['schemas']['Address'];
      readonly address_book_entry_id?: components['schemas']['Uuid'] | null;
      /** @description Caller accepted the carrier suggestion (REQ-BOOK-007). */
      readonly address_suggestion_accepted?: boolean;
      readonly contact: components['schemas']['Contact'];
      /** @description Also create an address-book entry (needs address_book:manage). */
      readonly save_to_address_book?: boolean;
      readonly tax_references?: readonly components['schemas']['TaxReferenceInput'][];
    };
    /** @description Payment record; no card data or gateway secrets beyond the client secret (REQ-PAY-003). */
    readonly Payment: {
      readonly amount: components['schemas']['Money'];
      readonly attempts_remaining: number;
      readonly captured_amount: components['schemas']['Money'];
      /** @description Gateway client secret for hosted fields / 3DS; only while CREATED or REQUIRES_ACTION. */
      readonly client_secret: string | null;
      readonly created_at: components['schemas']['Timestamp'];
      /** @description True when the payment uses a saved payment method and the access token auth_time was older than 12 h at checkout. The PaymentIntent was then created with payment_method_options.card.require_cvc_recollection=true, so the Payment Element collects the CVC inside the Stripe iframe before confirmation (no PCI scope change). Always false for a new card entered in hosted fields (SEC-P3-01). When true, the payment becomes AUTHORISED only if the retrieved charge has payment_method_details.card.checks.cvc_check = pass; any other value (fail, unavailable, unchecked, absent) voids the authorisation and fails the payment with failure_code AUTHENTICATION_FAILED (SEC-P3-28). */
      readonly cvc_recollection_required: boolean;
      /** @enum {string|null} */
      readonly failure_code:
        'CARD_DECLINED' | 'INSUFFICIENT_FUNDS' | 'AUTHENTICATION_FAILED' | 'EXPIRED_CARD' | 'GATEWAY_UNAVAILABLE' | null;
      /** @enum {string} */
      readonly gateway: 'MOCK' | 'STRIPE';
      readonly id: components['schemas']['Uuid'];
      /**
       * @description REQ-PAY-016.
       * @constant
       */
      readonly livemode: false;
      readonly method: {
        readonly brand: string | null;
        readonly last4: string | null;
        /** @enum {string} */
        readonly type: 'CARD';
      } | null;
      readonly next_action: {
        /** Format: uri */
        readonly redirect_url: string | null;
        /** @enum {string} */
        readonly type: 'USE_GATEWAY_SDK' | 'REDIRECT';
      } | null;
      readonly order_id: components['schemas']['Uuid'];
      readonly refunded_amount: components['schemas']['Money'];
      readonly refunds: readonly {
        readonly amount: components['schemas']['Money'];
        readonly created_at: components['schemas']['Timestamp'];
        readonly id: components['schemas']['Uuid'];
        readonly shipment_id: components['schemas']['Uuid'];
        /** @enum {string} */
        readonly status: 'PENDING' | 'SUCCEEDED' | 'FAILED';
      }[];
      readonly status: components['schemas']['PaymentStatus'];
      readonly status_history: readonly {
        readonly from_status: components['schemas']['PaymentStatus'] | null;
        readonly occurred_at: components['schemas']['Timestamp'];
        readonly to_status: components['schemas']['PaymentStatus'];
      }[];
      readonly updated_at: components['schemas']['Timestamp'];
      readonly version: number;
    };
    readonly PaymentConfirmRequest: {
      /**
       * @description Informational; state is derived from the retrieved gateway object (REQ-PAY-012).
       * @enum {string}
       */
      readonly client_result: 'succeeded' | 'requires_action' | 'failed' | 'abandoned';
    };
    readonly PaymentMethod: {
      readonly brand: string;
      readonly created_at: components['schemas']['Timestamp'];
      readonly exp_month: number;
      readonly exp_year: number;
      readonly id: components['schemas']['Uuid'];
      readonly is_default: boolean;
      readonly last4: string;
      readonly version: number;
    };
    readonly PaymentMethodCreateRequest: {
      readonly set_default?: boolean;
      readonly setup_id: string;
    };
    /** @description Cursor page of PaymentMethod (REQ-API-007). */
    readonly PaymentMethodList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['PaymentMethod'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly PaymentMethodPatch: {
      /** @constant */
      readonly is_default: true;
    };
    /** @description Hosted setup session (REQ-PAY-014). */
    readonly PaymentMethodSetup: {
      readonly client_secret: string;
      readonly expires_at: components['schemas']['Timestamp'];
      /** @enum {string} */
      readonly gateway: 'MOCK' | 'STRIPE';
      readonly setup_id: string;
    };
    /**
     * @description Payment status (DR-B27).
     * @enum {string}
     */
    readonly PaymentStatus:
      | 'CREATED'
      | 'REQUIRES_ACTION'
      | 'AUTHORISED'
      | 'CAPTURED'
      | 'PARTIALLY_CAPTURED'
      | 'VOIDED'
      | 'FAILED'
      | 'REFUND_PENDING'
      | 'REFUNDED'
      | 'REFUND_FAILED';
    /** @description E.164 phone number. */
    readonly PhoneE164: string;
    /** @description Pickup record: local date + IANA zone + local window (REQ-PICK-001). */
    readonly Pickup: {
      readonly address: components['schemas']['Address'];
      readonly carrier_reference: string | null;
      readonly contact: components['schemas']['Contact'];
      readonly created_at: components['schemas']['Timestamp'];
      readonly failure_code: components['schemas']['CarrierErrorCode'] | null;
      readonly id: components['schemas']['Uuid'];
      readonly instructions: string | null;
      readonly local_date: components['schemas']['LocalDate'];
      /** @description REQ-PICK-008. */
      readonly pickup_cancel_failed: boolean;
      readonly shipment_id: components['schemas']['Uuid'];
      /** @enum {string} */
      readonly status: 'REQUESTED' | 'SCHEDULED' | 'FAILED' | 'CANCELLED' | 'SUPERSEDED';
      readonly time_zone: components['schemas']['TimeZone'];
      readonly updated_at: components['schemas']['Timestamp'];
      readonly version: number;
      readonly window_end: components['schemas']['LocalTime'];
      readonly window_start: components['schemas']['LocalTime'];
    };
    /** @description DR-B25 computation for the shipment service and sender address. */
    readonly PickupAvailability: {
      readonly custom_window: {
        readonly earliest_ready: components['schemas']['LocalTime'];
        readonly latest_close: components['schemas']['LocalTime'];
        readonly min_minutes: number;
      };
      readonly cutoff_at: components['schemas']['Timestamp'] | null;
      readonly dates: readonly {
        readonly available: boolean;
        readonly date: components['schemas']['LocalDate'];
        readonly holiday_name: string | null;
        /** @enum {string|null} */
        readonly reason: 'HOLIDAY' | 'NOT_SERVED' | 'CUTOFF_PASSED' | null;
      }[];
      readonly earliest_date: components['schemas']['LocalDate'];
      readonly holidays_unreviewed: boolean;
      readonly latest_date: components['schemas']['LocalDate'];
      readonly lead_time_minutes: number;
      readonly standard_windows: readonly {
        readonly end: components['schemas']['LocalTime'];
        readonly start: components['schemas']['LocalTime'];
      }[];
      readonly time_zone: components['schemas']['TimeZone'];
    };
    readonly PickupRequest: {
      readonly instructions?: string | null;
      readonly local_date: components['schemas']['LocalDate'];
      readonly window_end: components['schemas']['LocalTime'];
      readonly window_start: components['schemas']['LocalTime'];
    };
    readonly PickupSelection: {
      readonly instructions: string | null;
      readonly local_date: components['schemas']['LocalDate'];
      readonly window_end: components['schemas']['LocalTime'];
      readonly window_start: components['schemas']['LocalTime'];
    };
    /** @description Immutable price snapshot on a shipment (REQ-PRICE-017). */
    readonly PriceSnapshot: {
      readonly charge_lines: readonly components['schemas']['ChargeLine'][];
      readonly config_version: string;
      readonly engine_version: string;
      readonly fx: components['schemas']['FxApplied'];
      readonly snapshot_hash: components['schemas']['Sha256Hex'];
      readonly tax_pack: {
        readonly country_code: components['schemas']['CountryCode'];
        readonly unreviewed: boolean;
        readonly version: number | null;
      };
      readonly totals: components['schemas']['PriceTotals'];
    };
    /** @description sum(lines) = net; net + tax = gross (REQ-PRICE-016). */
    readonly PriceTotals: {
      readonly discount: components['schemas']['Money'];
      readonly gross: components['schemas']['Money'];
      readonly net: components['schemas']['Money'];
      readonly tax: components['schemas']['Money'];
      /** @enum {string} */
      readonly tax_display: 'INCLUSIVE' | 'EXCLUSIVE';
      readonly tax_label: string | null;
    };
    readonly PricingExplanation: {
      readonly config_version: string;
      readonly engine_version: string;
      readonly entries: readonly components['schemas']['ExplanationEntry'][];
      readonly rejected_candidate_count: number;
      readonly warnings: readonly ('FX_STALE' | 'PRICE_FLOOR_APPLIED' | 'FUEL_NONE' | 'FUEL_INCLUDED_BY_CARRIER')[];
    };
    readonly PrivacyDeleteRequest: {
      /** @constant */
      readonly confirm: true;
    };
    readonly PrivacyDeleteResult: {
      readonly grace_period_ends_at: components['schemas']['Timestamp'];
      /** @enum {string} */
      readonly status: 'DELETION_SCHEDULED';
    };
    readonly PrivacyExportCreated: {
      readonly download_path: string;
      readonly expires_at: components['schemas']['Timestamp'];
      readonly export_id: components['schemas']['Uuid'];
    };
    /** @description Own data only; no restricted references (REQ-ACCT-016). */
    readonly PrivacyExportFile: {
      readonly addresses: readonly Record<string, never>[];
      readonly consent_records: readonly Record<string, never>[];
      readonly generated_at: components['schemas']['Timestamp'];
      readonly memberships: readonly Record<string, never>[];
      readonly preferences: Record<string, never>;
      readonly profile: Record<string, never>;
      readonly quotes: readonly Record<string, never>[];
      readonly shipments: readonly Record<string, never>[];
    };
    /** @description RFC 9457 problem details (REQ-PLAT-009, REQ-API-005). title/detail stay English; clients render errors.<code>. */
    readonly Problem: {
      /** @description Checkout gate reasons (REQ-BOOK-016). */
      readonly blocking_conditions?: readonly components['schemas']['BlockingCondition'][];
      /** @description Stable error code (README error catalogue). */
      readonly code: string;
      readonly correlation_id: string;
      /** @description Present for CONCURRENCY_CONFLICT (412). */
      readonly current_etag?: string;
      readonly detail?: string;
      /** @description Present for VALIDATION_ERROR. */
      readonly errors?: readonly components['schemas']['ValidationIssue'][];
      /** @description Request path (route template is logged, not returned). */
      readonly instance?: string;
      /** @description Present for LIMIT_EXCEEDED: the configured limit. */
      readonly limit?: number;
      /** @description Present for MFA_REQUIRED; 5 min, single-use. */
      readonly mfa_challenge_token?: string;
      readonly mfa_methods?: readonly ('TOTP' | 'RECOVERY_CODE')[];
      /** @description Present for ITEM_PROHIBITED. */
      readonly prohibited_matches?: readonly components['schemas']['ProhibitedMatch'][];
      readonly status: number;
      readonly title: string;
      /**
       * Format: uri
       * @description https://docs.<domain>/problems/<CODE> (ADR-0016).
       */
      readonly type: string;
    };
    readonly ProhibitedItem: {
      readonly carrier_code: components['schemas']['CarrierCode'] | null;
      readonly category: string;
      readonly country_code: components['schemas']['CountryCode'] | null;
      readonly hs_prefixes: readonly string[];
      readonly id: components['schemas']['Uuid'];
      readonly name: string;
      readonly note: string | null;
      /** @enum {string} */
      readonly scope: 'COUNTRY' | 'CARRIER';
      readonly source: string;
      /** @enum {string} */
      readonly status: 'PROHIBITED' | 'RESTRICTED';
      readonly unreviewed: boolean;
    };
    /** @description Union of pack country entries and carrier entries (REQ-DATA-011). */
    readonly ProhibitedItemList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['ProhibitedItem'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
      readonly pack: {
        /** @enum {string} */
        readonly state: 'RESOLVED' | 'PACK_UNAVAILABLE';
        readonly unreviewed: boolean;
        readonly version: number | null;
      };
    };
    readonly ProhibitedMatch: {
      readonly category: string;
      /** @enum {string} */
      readonly matched_on: 'DESCRIPTION' | 'COMMODITY_PREFIX';
      readonly name: string;
      readonly pointer: string;
      readonly prohibited_item_id: components['schemas']['Uuid'];
      /** @enum {string} */
      readonly scope: 'ORIGIN' | 'DESTINATION' | 'CARRIER';
      /** @enum {string} */
      readonly status: 'PROHIBITED' | 'RESTRICTED';
      readonly unreviewed: boolean;
    };
    /** @description Allow-list only (DR-B31, REQ-TRACK-011): no names, street lines, postcodes, phone, email, references, contents, prices, carrier free text or facility names. additionalProperties false is asserted by the contract test. */
    readonly PublicTracking: {
      /** @enum {string} */
      readonly lookup: 'TRACKING_NUMBER' | 'ORDER_NUMBER' | 'CUSTOMER_REFERENCE';
      readonly shipments: readonly components['schemas']['PublicTrackingShipment'][];
    };
    readonly PublicTrackingEvent: {
      readonly canonical_status: components['schemas']['TrackingStatus'];
      readonly city: string | null;
      readonly country_code: components['schemas']['CountryCode'] | null;
      /** @description Localised canonical description only (never carrier free text). */
      readonly description: string;
      readonly occurred_at: components['schemas']['Timestamp'];
    };
    /** @description Customer reference + receiver postcode (REQ-TRACK-009); POST so the postcode never appears in a URL (ADR-0016 amendment 2). */
    readonly PublicTrackingLookupRequest: {
      readonly customer_reference: string;
      readonly postcode: string;
    };
    readonly PublicTrackingShipment: {
      readonly carrier_name: string;
      readonly current_status: components['schemas']['TrackingStatus'] | null;
      readonly estimated_delivery_date: components['schemas']['LocalDate'] | null;
      readonly events: readonly components['schemas']['PublicTrackingEvent'][];
      readonly service_name: string;
    };
    readonly Quote: {
      readonly carrier_statuses: readonly components['schemas']['CarrierQuoteStatus'][];
      /** @description All carriers finished or the 5 s deadline passed. */
      readonly complete: boolean;
      readonly created_at: components['schemas']['Timestamp'];
      readonly expires_at: components['schemas']['Timestamp'];
      /** @description Returned once, only in the 201 response to an anonymous creator; >= 256 bits base64url. Send as X-Quote-Token. */
      readonly guest_token?: string;
      readonly id: components['schemas']['Uuid'];
      readonly inputs: components['schemas']['QuoteInputs'];
      readonly options: readonly components['schemas']['QuoteOption'][];
      /** @description True once claimed or created by an authenticated caller. */
      readonly owned_by_organisation: boolean;
      readonly pricing_config_version: string;
      readonly saved: boolean;
      readonly sell_currency: components['schemas']['CurrencyCode'];
      readonly share: {
        readonly created_at: components['schemas']['Timestamp'];
        readonly share_id: components['schemas']['Uuid'];
        readonly share_token: string;
      } | null;
      /**
       * @description DR-B14; EXPIRED derived from time.
       * @enum {string}
       */
      readonly status: 'ACTIVE' | 'EXPIRED' | 'CLAIMED';
      readonly tax_pack: {
        readonly country_code: components['schemas']['CountryCode'];
        /** @enum {string} */
        readonly state: 'RESOLVED' | 'PACK_UNAVAILABLE';
        readonly unreviewed: boolean;
        readonly version: number | null;
      };
    };
    readonly QuoteInputs: {
      readonly content_type: components['schemas']['ContentType'];
      readonly destination: components['schemas']['QuoteLocation'];
      readonly direction: components['schemas']['Direction'];
      readonly origin: components['schemas']['QuoteLocation'];
      readonly packages: readonly components['schemas']['Package'][];
      readonly residential: boolean;
      readonly ship_date: components['schemas']['LocalDate'];
    };
    /** @description Postcode or city per the country location_type (REQ-QUOTE-003). */
    readonly QuoteLocation: {
      readonly city?: string | null;
      readonly country_code: components['schemas']['CountryCode'];
      readonly postcode?: string | null;
    };
    /** @description Priced result option (REQ-QUOTE-007, REQ-PRICE-016). */
    readonly QuoteOption: {
      readonly badges: readonly ('CHEAPEST' | 'FASTEST')[];
      readonly badges_provisional: boolean;
      readonly best_value_score: components['schemas']['DecimalString'] | null;
      readonly billable_weight_g: number;
      /** @description Carrier cost came from the 300 s rate cache (REQ-CARR-010). */
      readonly cached: boolean;
      readonly carrier_code: components['schemas']['CarrierCode'];
      readonly carrier_name: string;
      readonly charge_lines: readonly components['schemas']['ChargeLine'][];
      readonly collection: {
        readonly cutoff_at: components['schemas']['Timestamp'] | null;
        readonly drop_off_available: boolean;
        readonly next_pickup_date: components['schemas']['LocalDate'] | null;
        readonly origin_time_zone: components['schemas']['TimeZone'];
        readonly pickup_available: boolean;
      };
      /** @description DDP offered only with a DUTIES_TAXES_ESTIMATE line (REQ-CUST-005). */
      readonly ddp_available: boolean;
      readonly delivery_options: readonly {
        readonly code: string;
        readonly price: components['schemas']['Money'];
      }[];
      readonly display: components['schemas']['DisplayAmount'] | null;
      readonly explanation: components['schemas']['PricingExplanation'];
      readonly fx: components['schemas']['FxApplied'];
      readonly id: components['schemas']['Uuid'];
      readonly included_cover: components['schemas']['IncludedCover'];
      /** @description False only for QR/label-free drop-off (REQ-QUOTE-007). */
      readonly printer_required: boolean;
      /** @description Canonical service code = carrier code + carrier service code (DR-B30). */
      readonly service_code: string;
      readonly service_name: string;
      readonly service_tier: components['schemas']['ServiceTier'];
      readonly totals: components['schemas']['PriceTotals'];
      readonly transit: {
        readonly estimated_delivery_date: components['schemas']['LocalDate'] | null;
        readonly max_days: number | null;
        readonly min_days: number | null;
        /** @enum {string|null} */
        readonly unavailable_reason: 'TRANSIT_DATA_MISSING' | null;
      };
      readonly volumetric_divisor: {
        readonly unit_system: components['schemas']['UnitSystem'];
        readonly value: number;
      };
    };
    readonly QuoteRequest: {
      readonly content_type: components['schemas']['ContentType'];
      readonly destination: components['schemas']['QuoteLocation'];
      readonly origin: components['schemas']['QuoteLocation'];
      readonly packages: readonly components['schemas']['PackageInput'][];
      /** @description Destination is residential. */
      readonly residential: boolean;
      readonly ship_date?: components['schemas']['LocalDate'];
    };
    readonly QuoteShare: {
      readonly expires_at: components['schemas']['Timestamp'];
      readonly share_id: components['schemas']['Uuid'];
      /** @description Relative web path of the share page (`/q`); the token travels in the URL fragment as `#token=<base64url>`, never in a path or query (ADR-0006 amendment 8, ADR-0016 amendment 2; resolved via `POST /public/shared-quotes/resolve`). */
      readonly share_path: string;
      /** @description >= 128-bit random token. */
      readonly share_token: string;
    };
    readonly QuoteSummary: {
      readonly content_type: components['schemas']['ContentType'];
      readonly created_at: components['schemas']['Timestamp'];
      readonly destination: components['schemas']['QuoteLocation'];
      readonly expires_at: components['schemas']['Timestamp'];
      readonly id: components['schemas']['Uuid'];
      readonly lowest_gross: components['schemas']['Money'] | null;
      readonly option_count: number;
      readonly origin: components['schemas']['QuoteLocation'];
      /** @enum {string} */
      readonly status: 'ACTIVE' | 'EXPIRED' | 'CLAIMED';
    };
    /** @description Cursor page of QuoteSummary (REQ-API-007). */
    readonly QuoteSummaryList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['QuoteSummary'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    /** @description 5 min, single-use, bound to session and scope; send as X-Reauth-Proof. */
    readonly ReauthProof: {
      readonly action_scope: string;
      readonly expires_at: components['schemas']['Timestamp'];
      readonly reauth_proof: string;
    };
    /** @description Supply password, or totp_code for MFA users (REQ-AUTH-020). */
    readonly ReauthRequest: {
      /** @enum {string} */
      readonly action_scope:
        | 'auth.password.change'
        | 'mfa.totp.disable'
        | 'mfa.recovery_codes.regenerate'
        | 'privacy.delete'
        | 'privacy.export'
        | 'payment_method.manage'
        | 'org.member.manage';
      readonly password?: string;
      readonly totp_code?: string;
    };
    /** @description Shown once; 10 codes of 10 characters from a 32-symbol alphabet, about 50 bits each (REQ-AUTH-016, ADR-0006 amendment 3). */
    readonly RecoveryCodes: {
      readonly generated_at: components['schemas']['Timestamp'];
      readonly recovery_codes: readonly string[];
    };
    /** @description Up to 3 reference fields (REQ-BOOK-011). */
    readonly References: {
      /** @description MOCK:<directives> drives the Mock carrier outside production (DR-B29). */
      readonly customer_reference?: string | null;
      readonly note?: string | null;
      readonly order_reference?: string | null;
    };
    readonly RegisterRequest: {
      /** @constant */
      readonly accept_terms: true;
      readonly display_name: string;
      readonly email: components['schemas']['Email'];
      readonly locale: components['schemas']['Locale'];
      readonly password: string;
      readonly terms_version: string;
    };
    readonly ResetPasswordRequest: {
      readonly new_password: string;
      readonly token: string;
    };
    /** @enum {string} */
    readonly SagaStep: 'AUTHORISE' | 'CREATE_SHIPMENT' | 'CAPTURE' | 'DOCUMENTS' | 'PICKUP' | 'NOTIFY';
    /** @enum {string} */
    readonly SagaStepStatus: 'PENDING' | 'DONE' | 'FAILED' | 'SKIPPED';
    readonly ServiceExclusion: {
      /** @description Human-readable limit, e.g. "70000 g per package". */
      readonly limit: string;
      /** @enum {string} */
      readonly reason: 'WEIGHT_EXCEEDED' | 'DIMENSION_EXCEEDED' | 'CONTENT_TYPE_NOT_SUPPORTED' | 'DIRECTION_NOT_SUPPORTED';
      readonly service_code: string;
    };
    readonly ServicePoint: {
      readonly address: components['schemas']['Address'];
      readonly carrier_code: components['schemas']['CarrierCode'];
      readonly distance_m: number;
      readonly id: string;
      readonly latest_drop_off_time: components['schemas']['LocalTime'] | null;
      readonly latitude: number | null;
      readonly longitude: number | null;
      readonly name: string;
      readonly opening_hours: readonly {
        readonly close: components['schemas']['LocalTime'];
        /** @enum {string} */
        readonly day: 'MON' | 'TUE' | 'WED' | 'THU' | 'FRI' | 'SAT' | 'SUN';
        readonly open: components['schemas']['LocalTime'];
      }[];
    };
    /** @description Up to 20 service points within the radius (REQ-PICK-010). */
    readonly ServicePointList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['ServicePoint'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly ServicePointSnapshot: {
      readonly address: components['schemas']['Address'];
      readonly carrier_code: components['schemas']['CarrierCode'];
      readonly id: string;
      readonly latest_drop_off_time: components['schemas']['LocalTime'] | null;
      readonly name: string;
    };
    /**
     * @description Canonical service tier (DR-B30).
     * @enum {string}
     */
    readonly ServiceTier: 'EXPRESS' | 'STANDARD' | 'ECONOMY';
    readonly Session: {
      /** @enum {string} */
      readonly app: 'web' | 'admin';
      readonly browser: string | null;
      readonly created_at: components['schemas']['Timestamp'];
      readonly current: boolean;
      readonly id: components['schemas']['Uuid'];
      /** @description IPv4 /24 or IPv6 /48. */
      readonly ip_coarse: string;
      readonly last_used_at: components['schemas']['Timestamp'];
      readonly os: string | null;
    };
    /** @description Cursor page of Session (REQ-API-007). */
    readonly SessionList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['Session'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    /** @description Lower-case hex SHA-256. */
    readonly Sha256Hex: string;
    /** @description Public shared view: no postcode, names, addresses, emails or references (REQ-QUOTE-015). Only active shares resolve (D-055). */
    readonly SharedQuote: {
      readonly content_type: components['schemas']['ContentType'];
      readonly destination: {
        readonly city: string | null;
        readonly country_code: components['schemas']['CountryCode'];
      };
      readonly expires_at: components['schemas']['Timestamp'];
      /** @description Always populated while the share is active. Expired, revoked, superseded and unknown shares are answered 404 instead of a view (D-055, EC-B29; SEC-P3-32). */
      readonly options: readonly {
        readonly carrier_name: string;
        readonly service_name: string;
        readonly service_tier: components['schemas']['ServiceTier'];
        readonly totals: components['schemas']['PriceTotals'];
        readonly transit: {
          readonly max_days: number | null;
          readonly min_days: number | null;
        };
      }[];
      readonly origin: {
        readonly city: string | null;
        readonly country_code: components['schemas']['CountryCode'];
      };
      readonly packages: readonly components['schemas']['Package'][];
      /**
       * @description Only active shares resolve; expired, revoked, superseded and unknown tokens are answered 404 (D-055, SEC-P3-32). `EXPIRED` was removed from this enum on 2026-11-12 with the v1.3 EC-B29 expired view.
       * @enum {string}
       */
      readonly status: 'ACTIVE';
    };
    readonly ShareTokenRequest: {
      /** @description Share token read from the URL fragment. */
      readonly token: string;
    };
    /** @description Shipment (REQ-BOOK, REQ-ACCT-003). Restricted references are masked. */
    readonly Shipment: {
      readonly booked_by: {
        readonly display_name: string;
        readonly user_id: components['schemas']['Uuid'];
      } | null;
      readonly carrier: {
        readonly carrier_code: components['schemas']['CarrierCode'];
        readonly carrier_name: string;
        readonly service_code: string;
        readonly service_name: string;
      } | null;
      readonly collection: {
        /** @enum {string|null} */
        readonly mode: 'PICKUP' | 'DROP_OFF' | null;
        readonly pickup: components['schemas']['PickupSelection'] | null;
        readonly service_point: components['schemas']['ServicePointSnapshot'] | null;
      };
      readonly content_type: components['schemas']['ContentType'];
      readonly contents_description: string | null;
      readonly created_at: components['schemas']['Timestamp'];
      readonly current_step: number;
      readonly customs_required: boolean;
      readonly dg_attestation: components['schemas']['DgAttestationRecord'] | null;
      readonly direction: components['schemas']['Direction'];
      readonly extras: {
        readonly cover: {
          readonly insured_value: components['schemas']['Money'];
        } | null;
        readonly delivery_options: readonly string[];
        readonly references: components['schemas']['References'];
      };
      readonly id: components['schemas']['Uuid'];
      readonly last_error: {
        readonly code: components['schemas']['CarrierErrorCode'];
        readonly occurred_at: components['schemas']['Timestamp'];
      } | null;
      readonly needs_review: boolean;
      /** @description Seam; always null in M1 (DR-A06). */
      readonly on_behalf_of_org_id: null;
      readonly order_id: components['schemas']['Uuid'] | null;
      readonly order_number: string | null;
      readonly packages: readonly components['schemas']['Package'][];
      readonly price: components['schemas']['PriceSnapshot'] | null;
      readonly quote_expires_at: components['schemas']['Timestamp'];
      readonly quote_id: components['schemas']['Uuid'];
      readonly quote_option_id: components['schemas']['Uuid'] | null;
      readonly receiver: components['schemas']['Party'];
      /**
       * @description Only NOT_SCREENED is reachable in M1 (REQ-CUST-011).
       * @enum {string}
       */
      readonly screening_status: 'NOT_SCREENED' | 'CLEARED' | 'REVIEW' | 'BLOCKED';
      readonly sender: components['schemas']['Party'];
      readonly state: components['schemas']['ShipmentState'];
      readonly steps_completed: readonly number[];
      readonly tracking_number: string | null;
      readonly tracking_stale: boolean;
      readonly updated_at: components['schemas']['Timestamp'];
      readonly version: number;
    };
    /** @description Wizard step 1 first save: creates a DRAFT and claims the quote (REQ-BOOK-002, REQ-QUOTE-016). */
    readonly ShipmentCreateRequest: {
      readonly quote_id: components['schemas']['Uuid'];
      readonly quote_option_id: components['schemas']['Uuid'];
      readonly receiver: components['schemas']['PartyInput'];
      readonly sender: components['schemas']['PartyInput'];
    };
    /** @description Partial update of wizard sections; rate-relevant changes require a new quote_id (REQ-QUOTE-018). Customs via PUT /customs. */
    readonly ShipmentPatch: {
      readonly collection?: components['schemas']['CollectionInput'];
      /** @description Validate and mark this wizard step complete. */
      readonly complete_step?: number;
      readonly contents_description?: string;
      readonly dg_attestation?: components['schemas']['DgAttestation'];
      readonly extras?: components['schemas']['ExtrasInput'];
      readonly quote_id?: components['schemas']['Uuid'];
      readonly quote_option_id?: components['schemas']['Uuid'];
      readonly receiver?: components['schemas']['PartyInput'];
      readonly sender?: components['schemas']['PartyInput'];
    };
    /**
     * @description Shipment state machine (DR-B01). CLAIM_OPEN is unreachable in M1.
     * @enum {string}
     */
    readonly ShipmentState:
      | 'DRAFT'
      | 'QUOTED'
      | 'PENDING_PAYMENT'
      | 'PAID'
      | 'BOOKING'
      | 'BOOKED'
      | 'LABEL_READY'
      | 'PICKUP_SCHEDULED'
      | 'DROPPED_OFF'
      | 'IN_TRANSIT'
      | 'CUSTOMS_HOLD'
      | 'OUT_FOR_DELIVERY'
      | 'DELIVERED'
      | 'EXCEPTION'
      | 'RETURNED_TO_SENDER'
      | 'CANCELLED'
      | 'VOIDED'
      | 'REFUNDED'
      | 'CLAIM_OPEN';
    readonly ShipmentSummary: {
      readonly carrier_code: components['schemas']['CarrierCode'] | null;
      readonly created_at: components['schemas']['Timestamp'];
      readonly current_step: number;
      readonly customer_reference: string | null;
      readonly destination_country: components['schemas']['CountryCode'];
      readonly direction: components['schemas']['Direction'];
      readonly gross: components['schemas']['Money'] | null;
      readonly id: components['schemas']['Uuid'];
      readonly order_number: string | null;
      readonly receiver_name: string;
      readonly service_name: string | null;
      readonly state: components['schemas']['ShipmentState'];
      readonly tracking_number: string | null;
      readonly updated_at: components['schemas']['Timestamp'];
    };
    /** @description Cursor page of ShipmentSummary (REQ-API-007). */
    readonly ShipmentSummaryList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['ShipmentSummary'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly ShipmentTracking: {
      readonly carrier_code: components['schemas']['CarrierCode'];
      readonly carrier_name: string;
      readonly current_status: components['schemas']['TrackingStatus'] | null;
      readonly estimated_delivery_date: components['schemas']['LocalDate'] | null;
      /** @description Sorted by occurred_at (REQ-TRACK-005). */
      readonly events: readonly components['schemas']['TrackingEvent'][];
      readonly last_polled_at: components['schemas']['Timestamp'] | null;
      readonly refresh_available_at: components['schemas']['Timestamp'] | null;
      readonly service_name: string;
      readonly shipment_id: components['schemas']['Uuid'];
      readonly shipment_state: components['schemas']['ShipmentState'];
      readonly tracking_number: string;
      readonly tracking_stale: boolean;
    };
    /** @description SSE event `carrier_error`; never raw carrier text (REQ-API-017). */
    readonly SseCarrierError: {
      readonly carrier_code: components['schemas']['CarrierCode'];
      readonly code: components['schemas']['CarrierErrorCode'];
      readonly elapsed_ms: number;
      /** @enum {string} */
      readonly state: 'timeout' | 'error';
    };
    /** @description SSE event `carrier_result` (REQ-CARR-009). */
    readonly SseCarrierResult: {
      readonly cached: boolean;
      readonly carrier_code: components['schemas']['CarrierCode'];
      readonly elapsed_ms: number;
      readonly exclusions: readonly components['schemas']['ServiceExclusion'][];
      readonly options: readonly components['schemas']['QuoteOption'][];
      /** @enum {string} */
      readonly status: 'OK' | 'NO_SERVICE';
    };
    /** @description SSE event `complete`; sent by 5 s, stream closed within 1 s after (REQ-API-018). */
    readonly SseComplete: {
      readonly carriers: readonly {
        readonly carrier_code: components['schemas']['CarrierCode'];
        /** @enum {string} */
        readonly status: 'OK' | 'NO_SERVICE' | 'TIMEOUT' | 'ERROR';
      }[];
      readonly counts: {
        readonly ERROR: number;
        readonly NO_SERVICE: number;
        readonly OK: number;
        readonly TIMEOUT: number;
      };
      readonly elapsed_ms: number;
      readonly option_count: number;
    };
    /** @description SSE event `error`: stream-level failure; connection closed. */
    readonly SseError: {
      readonly code: string;
      readonly correlation_id: string;
    };
    /** @description Booking-progress SSE event `step_update` (REQ-BOOK-025). */
    readonly SseStepUpdate: {
      readonly error_code: string | null;
      readonly shipment_id: components['schemas']['Uuid'];
      readonly shipment_state: components['schemas']['ShipmentState'];
      readonly status: components['schemas']['SagaStepStatus'];
      readonly step: components['schemas']['SagaStep'];
    };
    readonly StateTransition: {
      readonly actor_display: string | null;
      /** @enum {string} */
      readonly actor_type: 'USER' | 'API_KEY' | 'SYSTEM_JOB' | 'ANONYMOUS';
      readonly from_state: components['schemas']['ShipmentState'] | null;
      readonly id: components['schemas']['Uuid'];
      readonly occurred_at: components['schemas']['Timestamp'];
      readonly reason_code: string | null;
      readonly to_state: components['schemas']['ShipmentState'];
      /** @enum {string} */
      readonly trigger: 'USER_ACTION' | 'SAGA_STEP' | 'CARRIER_EVENT' | 'PAYMENT_EVENT' | 'SYSTEM_TIMEOUT';
    };
    /** @description Shipment state history, oldest first (REQ-BOOK-019). */
    readonly StateTransitionList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['StateTransition'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    /** @description Raw Stripe event; verified over the raw body (REQ-PAY-011). Other members are passed through. */
    readonly StripeEvent: {
      readonly id: string;
      /** @constant */
      readonly livemode?: false;
      readonly type: string;
    };
    readonly Subdivision: {
      readonly code: string;
      readonly country_code: components['schemas']['CountryCode'];
      readonly name: string;
      readonly translation_reviewed: boolean;
    };
    /** @description Cursor page of Subdivision (REQ-API-007). */
    readonly SubdivisionList: {
      readonly has_more: boolean;
      readonly items: readonly components['schemas']['Subdivision'][];
      /** @description Opaque cursor for the next page; null when has_more is false. */
      readonly next_cursor: string | null;
    };
    readonly SwitchOrganisationRequest: {
      readonly organisation_id: components['schemas']['Uuid'];
    };
    readonly TaxReferenceInput: {
      /** @description Reference type from the compliance pack (e.g. IN_PAN, IN_GSTIN, EORI). */
      readonly type: string;
      /** @description Restricted personal data; never returned, logged or audited in clear (REQ-BOOK-008). */
      readonly value: string;
    };
    readonly TaxReferenceMasked: {
      readonly type: string;
      /** @description Masked value, last 4 characters visible. */
      readonly value_masked: string;
    };
    /**
     * Format: date-time
     * @description UTC instant, ISO 8601 ending in Z (REQ-API-016).
     */
    readonly Timestamp: string;
    /**
     * @description IANA time-zone identifier.
     * @example America/New_York
     */
    readonly TimeZone: string;
    readonly TokenRequest: {
      /** @description 256-bit base64url one-time token. */
      readonly token: string;
    };
    /** @description Refresh token is only ever set as a __Host- cookie (REQ-AUTH-006). */
    readonly TokenResponse: {
      /** @description ES256 JWT, 15 min; keep in memory only (REQ-AUTH-010). */
      readonly access_token: string;
      readonly active_org_id: components['schemas']['Uuid'];
      /** @enum {string} */
      readonly app: 'web' | 'admin';
      readonly expires_in: number;
      /** @description Staff session restricted to MFA enrolment routes (REQ-AUTH-018). */
      readonly mfa_enrolment_required: boolean;
      readonly session_id: components['schemas']['Uuid'];
      /** @enum {string} */
      readonly token_type: 'Bearer';
    };
    readonly TotpCodeRequest: {
      readonly code: string;
    };
    /** @description Secret shown once; pending enrolment expires in 15 min (REQ-AUTH-015). */
    readonly TotpEnrolment: {
      readonly expires_at: components['schemas']['Timestamp'];
      readonly manual_key: string;
      readonly provisioning_uri: string;
    };
    readonly TotpEnrolRequest: {
      /** @description Single-use code from requestTotpEnrolmentCode (10 min). Required only for a staff first enrolment when APP_ENV is not local or test (SEC-P3-14). */
      readonly enrolment_code?: string;
    };
    readonly TrackingEvent: {
      readonly canonical_status: components['schemas']['TrackingStatus'];
      /** @description Original carrier text; authenticated owner view only. */
      readonly carrier_description: string | null;
      readonly carrier_event_code: string | null;
      /** @description i18n key of the canonical description. */
      readonly description_key: string;
      readonly id: components['schemas']['Uuid'];
      readonly location: components['schemas']['TrackingLocation'];
      readonly occurred_at: components['schemas']['Timestamp'];
      /** @description REQ-TRACK-001. */
      readonly unmapped: boolean;
    };
    readonly TrackingLocation: {
      readonly city: string | null;
      readonly country_code: components['schemas']['CountryCode'] | null;
      readonly region_code: string | null;
    };
    readonly TrackingRefreshResult: {
      readonly refresh_available_at: components['schemas']['Timestamp'];
      /** @enum {string} */
      readonly status: 'QUEUED';
    };
    /**
     * @description Canonical tracking taxonomy (DR-B18).
     * @enum {string}
     */
    readonly TrackingStatus:
      | 'INFO_RECEIVED'
      | 'PICKED_UP'
      | 'DROPPED_OFF'
      | 'IN_TRANSIT'
      | 'CUSTOMS_HOLD'
      | 'CUSTOMS_CLEARED'
      | 'OUT_FOR_DELIVERY'
      | 'DELIVERY_ATTEMPTED'
      | 'DELIVERED'
      | 'EXCEPTION'
      | 'RETURN_INITIATED'
      | 'RETURNED_TO_SENDER'
      | 'CANCELLED';
    /**
     * @description Display/entry unit system: METRIC = kg/cm, IMPERIAL = lb/in (DR-B06).
     * @enum {string}
     */
    readonly UnitSystem: 'METRIC' | 'IMPERIAL';
    readonly UserProfile: {
      readonly created_at: components['schemas']['Timestamp'];
      readonly deletion_scheduled_at: components['schemas']['Timestamp'] | null;
      readonly display_currency: components['schemas']['CurrencyCode'] | null;
      readonly display_name: string;
      readonly email: components['schemas']['Email'];
      readonly email_verified: boolean;
      readonly id: components['schemas']['Uuid'];
      readonly locale: components['schemas']['Locale'];
      readonly mfa_enabled: boolean;
      readonly recovery_codes_remaining: number | null;
      /** @enum {string} */
      readonly status: 'PENDING_VERIFICATION' | 'ACTIVE' | 'SUSPENDED' | 'DEACTIVATED';
      readonly time_zone: components['schemas']['TimeZone'] | null;
      readonly unit_system: components['schemas']['UnitSystem'] | null;
      readonly version: number;
    };
    /**
     * Format: uuid
     * @description UUIDv7 identifier (ADR-0009).
     * @example 0193a5b2-7c1e-7d4a-9f3b-2c4d5e6f7a8b
     */
    readonly Uuid: string;
    readonly ValidationIssue: {
      /** @description Stable sub-code (see README validation sub-codes). */
      readonly code: string;
      /** @description English developer message; clients localise from code. */
      readonly message: string;
      /**
       * @description JSON pointer into the request: /body/..., /query/..., /params/..., /headers/... (ADR-0016).
       * @example /body/password
       */
      readonly pointer: string;
    };
    /** @description Shared helper result (DR-B05, REQ-QUOTE-021). */
    readonly VolumetricResult: {
      readonly actual_weight_g: number | null;
      /** @description max(actual, volumetric) before service increment rounding. */
      readonly billable_weight_g: number | null;
      readonly display: {
        readonly billable_weight: number | null;
        /** @enum {string} */
        readonly unit: 'kg' | 'lb';
        readonly volumetric_weight: number;
      };
      readonly divisor: number;
      readonly unit_system: components['schemas']['UnitSystem'];
      readonly volumetric_weight_g: number;
    };
    readonly WebhookAck: {
      readonly duplicate: boolean;
      /** @constant */
      readonly received: true;
    };
  };
  responses: {
    /** @description Problem (400). Codes: VALIDATION_ERROR, MALFORMED_REQUEST, INVALID_CURSOR, INVALID_FILTER, INVALID_SORT, IDEMPOTENCY_KEY_REQUIRED, TOKEN_INVALID, MOCK_SCENARIO_INVALID, CARD_DATA_NOT_ACCEPTED, PAYMENT_METHOD_NOT_AVAILABLE, WEBHOOK_SIGNATURE_INVALID. See x-error-codes on each operation for the subset it can return. */
    readonly BadRequest: {
      headers: {
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (409). Codes: CONFLICT, IDEMPOTENCY_IN_PROGRESS, ALREADY_MEMBER, QUOTE_ALREADY_CLAIMED, ILLEGAL_STATE_TRANSITION, QUOTE_EXPIRED, SHIPMENT_NOT_CANCELLABLE, PICKUP_ALREADY_SCHEDULED, AMOUNT_MISMATCH, ACCOUNT_HAS_ACTIVE_SHIPMENTS. See x-error-codes on each operation for the subset it can return. */
    readonly Conflict: {
      headers: {
        readonly 'Retry-After': components['headers']['RetryAfter'];
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (403). Codes: AUTHZ_DENIED, MFA_ENROLMENT_REQUIRED, MFA_ENROLMENT_CODE_REQUIRED, CSRF_REJECTED, INVITATION_EMAIL_MISMATCH, EMAIL_NOT_VERIFIED. See x-error-codes on each operation for the subset it can return. */
    readonly Forbidden: {
      headers: {
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (410). Codes: TOKEN_EXPIRED, DOWNLOAD_EXPIRED, DOCUMENT_VOIDED. See x-error-codes on each operation for the subset it can return. */
    readonly Gone: {
      headers: {
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (500). Codes: INTERNAL_ERROR, AUDIT_WRITE_FAILED, DOCUMENT_INTEGRITY_FAILURE. See x-error-codes on each operation for the subset it can return. */
    readonly InternalServerError: {
      headers: {
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (404). Codes: NOT_FOUND, TRACKING_NOT_FOUND. See x-error-codes on each operation for the subset it can return. */
    readonly NotFound: {
      headers: {
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Not modified (If-None-Match matched). */
    readonly NotModified: {
      headers: {
        readonly ETag: components['headers']['ETag'];
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content?: never;
    };
    /** @description Problem (413). Codes: PAYLOAD_TOO_LARGE. See x-error-codes on each operation for the subset it can return. */
    readonly PayloadTooLarge: {
      headers: {
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (412). Codes: CONCURRENCY_CONFLICT. See x-error-codes on each operation for the subset it can return. */
    readonly PreconditionFailed: {
      headers: {
        readonly ETag: components['headers']['ETag'];
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (428). Codes: PRECONDITION_REQUIRED. See x-error-codes on each operation for the subset it can return. */
    readonly PreconditionRequired: {
      headers: {
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (503). Codes: SERVICE_UNAVAILABLE, AUDIT_UNAVAILABLE, GATEWAY_UNAVAILABLE. See x-error-codes on each operation for the subset it can return. */
    readonly ServiceUnavailable: {
      headers: {
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (429). Codes: RATE_LIMITED, ACCOUNT_DELAYED, ACCOUNT_LOCKED, MFA_LOCKED, PAYMENT_ATTEMPTS_EXCEEDED. See x-error-codes on each operation for the subset it can return. */
    readonly TooManyRequests: {
      headers: {
        readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
        readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
        readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
        readonly 'Retry-After': components['headers']['RetryAfter'];
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (401). Codes: AUTH_REQUIRED, ACCESS_TOKEN_EXPIRED, INVALID_CREDENTIALS, MFA_REQUIRED, MFA_INVALID, SESSION_REVOKED, SESSION_EXPIRED, REAUTH_REQUIRED. See x-error-codes on each operation for the subset it can return. */
    readonly Unauthorized: {
      headers: {
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (422). Codes: IDEMPOTENCY_KEY_REUSED, LAST_OWNER, LIMIT_EXCEEDED, REASON_REQUIRED, ROLE_NOT_ALLOWED_FOR_ORG_TYPE, ORG_TYPE_RESTRICTION, COUNTRY_NOT_SUPPORTED, ORG_TYPE_NOT_ALLOWED, ORDER_CURRENCY_MISMATCH, ADDRESS_COUNTRY_MISMATCH, CUSTOMS_CURRENCY_MIXED, CUSTOMS_WEIGHT_EXCEEDS_PACKAGE, COMMODITY_CODE_FORMAT, ITEM_PROHIBITED, DG_ATTESTATION_REQUIRED, COVER_VALUE_EXCEEDS_MAXIMUM, COUPON_INVALID, COUPON_EXPIRED, COUPON_EXHAUSTED, AMOUNT_BELOW_MINIMUM, PICKUP_WINDOW_INVALID, PICKUP_DATE_INVALID, FX_RATE_UNAVAILABLE. See x-error-codes on each operation for the subset it can return. */
    readonly UnprocessableContent: {
      headers: {
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
    /** @description Problem (415). Codes: UNSUPPORTED_MEDIA_TYPE. See x-error-codes on each operation for the subset it can return. */
    readonly UnsupportedMediaType: {
      headers: {
        readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
        readonly [name: string]: unknown;
      };
      content: {
        readonly 'application/problem+json': components['schemas']['Problem'];
      };
    };
  };
  parameters: {
    /**
     * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
     * @example es-MX,es;q=0.9,en;q=0.5
     */
    readonly AcceptLanguage: string;
    /** @description Audit entry ID. */
    readonly AuditEntryIdPath: components['schemas']['Uuid'];
    /** @description Carrier code in lower case (e.g. dhl_express, fedex, ups). */
    readonly CarrierCodePath: string;
    /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
    readonly CorrelationId: string;
    /** @description ISO 3166-1 alpha-2 country code. */
    readonly CountryCodePath: components['schemas']['CountryCode'];
    /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
    readonly Cursor: string;
    /** @description Document ID. */
    readonly DocumentIdPath: components['schemas']['Uuid'];
    /** @description Entity ID. */
    readonly EntityIdPath: string;
    /** @description Audited entity name (e.g. shipment). */
    readonly EntityNamePath: string;
    /** @description Address-book entry ID. */
    readonly EntryIdPath: components['schemas']['Uuid'];
    /** @description Privacy export ID. */
    readonly ExportIdPath: components['schemas']['Uuid'];
    /** @description Feature flag key. */
    readonly FlagKeyPath: string;
    /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
    readonly IdempotencyKey: string;
    /** @description Required on this operation (creates an order, payment or booking; REQ-API-009). Missing: 400 IDEMPOTENCY_KEY_REQUIRED. Semantics DR-A20. */
    readonly IdempotencyKeyRequired: string;
    /**
     * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
     * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
     */
    readonly IfMatch: string;
    /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
    readonly IfNoneMatch: string;
    /** @description Invitation ID. */
    readonly InvitationIdPath: components['schemas']['Uuid'];
    /** @description Resume after this event id; missed events are replayed from the database before live events (ADR-0016 amendment 3). */
    readonly LastEventId: string;
    /** @description Legal document key. */
    readonly LegalDocumentPath: 'privacy' | 'terms';
    /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
    readonly Limit: number;
    /** @description Membership ID. */
    readonly MembershipIdPath: components['schemas']['Uuid'];
    /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
    readonly MockScenario: string;
    /** @description Notification log entry ID. */
    readonly NotificationIdPath: components['schemas']['Uuid'];
    /** @description Order ID. */
    readonly OrderIdPath: components['schemas']['Uuid'];
    /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
    readonly OrgIdPath: components['schemas']['Uuid'];
    /** @description Country code or EU (template). */
    readonly PackCountryPath: string;
    /** @description Payment ID. */
    readonly PaymentIdPath: components['schemas']['Uuid'];
    /** @description Saved payment method ID. */
    readonly PaymentMethodIdPath: components['schemas']['Uuid'];
    /** @description Quote ID. */
    readonly QuoteIdPath: components['schemas']['Uuid'];
    /** @description Guest quote access token returned once by createQuote. Never placed in URLs (REQ-QUOTE-002, A-078: wrong or missing token gives 404). */
    readonly QuoteToken: string;
    /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Missing/invalid: 401 REAUTH_REQUIRED. */
    readonly ReauthProof: string;
    /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Needed only when the access token's auth_time is older than the operation's x-reauth-max-age (SEC-P3-01); then missing/invalid: 401 REAUTH_REQUIRED. A proof that is sent is always verified and consumed. */
    readonly ReauthProofConditional: string;
    /** @description Session ID. */
    readonly SessionIdPath: components['schemas']['Uuid'];
    /** @description Shipment ID. */
    readonly ShipmentIdPath: components['schemas']['Uuid'];
  };
  requestBodies: never;
  headers: {
    /** @description Public reference data: `public, max-age=3600` (REQ-DATA-016); streams: `no-cache`. */
    readonly CacheControl: string;
    /** @description `attachment; filename=...` (no personal data). */
    readonly ContentDisposition: string;
    /** @description Locale used for localised labels (REQ-I18N-007). */
    readonly ContentLanguage: 'en' | 'es' | 'fr';
    /** @description Strong ETag "<id>:<version>" (ADR-0016, DR-A16). */
    readonly ETag: string;
    /** @description `true` when the stored response of an earlier request with the same Idempotency-Key is replayed (REQ-API-010). */
    readonly IdempotentReplayed: 'true';
    /** @description URL of the created resource. */
    readonly Location: string;
    /** @description Requests allowed in the current window for this route class (REQ-API-014). */
    readonly RateLimitLimit: number;
    /** @description Requests remaining in the window. */
    readonly RateLimitRemaining: number;
    /** @description Seconds until the window resets. */
    readonly RateLimitReset: number;
    /** @description Seconds to wait before retrying. */
    readonly RetryAfter: number;
    /** @description `__Host-rt_web` or `__Host-rt_admin` refresh cookie: HttpOnly; Secure; SameSite=Strict; Path=/ (no Domain), read only by the auth routes (ADR-0006 amendment 1); Max-Age 30 d, never beyond the 30-day absolute session cap (admin: 30 min sliding idle lifetime inside a 12 h absolute cap; SEC-P3-01, SEC-P3-11). Cleared on logout (REQ-AUTH-006). */
    readonly SetCookieRefresh: string;
    /** @description `no` on event streams (REQ-API-017). */
    readonly XAccelBuffering: 'no';
    /** @description Correlation ID of this request (REQ-PLAT-011). */
    readonly XCorrelationId: string;
  };
  pathItems: never;
}
export type $defs = Record<string, never>;
export interface operations {
  readonly listFeatureFlags: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: key, updated_at. Default: key. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['FeatureFlagList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly createFeatureFlag: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['FeatureFlagCreateRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['FeatureFlag'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly updateFeatureFlag: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Feature flag key. */
        readonly flagKey: components['parameters']['FlagKeyPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['FeatureFlagPatch'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['FeatureFlag'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getAuditChainStatus: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['AuditChainStatus'];
        };
      };
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listEntityAuditHistory: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 50, max 200 (DR-A21). */
        readonly limit?: number;
        /** @description Comma-separated, '-' for descending. Allowed: occurred_at. Default: occurred_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Entity ID. */
        readonly entityId: components['parameters']['EntityIdPath'];
        /** @description Audited entity name (e.g. shipment). */
        readonly entityName: components['parameters']['EntityNamePath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['AuditEntryList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listAuditEntries: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[occurred_from], filter[occurred_to], filter[user_id], filter[role], filter[org_id], filter[entity_name], filter[entity_id], filter[action], filter[ip], filter[outcome]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          /** @enum {string} */
          readonly action?:
            | 'CREATE'
            | 'UPDATE'
            | 'DELETE'
            | 'VIEW'
            | 'DOWNLOAD'
            | 'LOGIN'
            | 'LOGOUT'
            | 'LOGIN_FAILED'
            | 'ACCOUNT_LOCKED'
            | 'TOKEN_REUSE_DETECTED'
            | 'MFA_ENROLLED'
            | 'MFA_FAILED'
            | 'PERMISSION_DENIED'
            | 'EXPORT'
            | 'ON_BEHALF_ACTION'
            | 'CONFIG_CHANGE'
            | 'API_KEY_USE'
            | 'STATE_TRANSITION';
          readonly entity_id?: string;
          readonly entity_name?: string;
          readonly ip?: string;
          readonly occurred_from?: components['schemas']['Timestamp'];
          readonly occurred_to?: components['schemas']['Timestamp'];
          readonly org_id?: components['schemas']['Uuid'];
          /** @enum {string} */
          readonly outcome?: 'SUCCESS' | 'DENIED' | 'FAILED';
          readonly role?: string;
          readonly user_id?: components['schemas']['Uuid'];
        };
        /** @description Page size, default 50, max 200 (DR-A21). */
        readonly limit?: number;
        /** @description Comma-separated, '-' for descending. Allowed: occurred_at. Default: -occurred_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['AuditEntrySummaryList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getAuditEntry: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Audit entry ID. */
        readonly auditEntryId: components['parameters']['AuditEntryIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['AuditEntry'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getCsrfToken: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CsrfToken'];
        };
      };
      readonly 401: components['responses']['Unauthorized'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly loginUser: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['LoginRequest'];
      };
    };
    readonly responses: {
      /** @description Signed in; refresh cookie set. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'Set-Cookie': components['headers']['SetCookieRefresh'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['TokenResponse'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly logoutSession: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['ClientAppRequest'];
      };
    };
    readonly responses: {
      /** @description Signed out; cookie cleared. */
      readonly 204: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'Set-Cookie': components['headers']['SetCookieRefresh'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly completeMfaChallenge: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['MfaChallengeRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'Set-Cookie': components['headers']['SetCookieRefresh'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['TokenResponse'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 410: components['responses']['Gone'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly regenerateRecoveryCodes: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Missing/invalid: 401 REAUTH_REQUIRED. */
        readonly 'X-Reauth-Proof': components['parameters']['ReauthProof'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['RecoveryCodes'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly activateTotp: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['TotpCodeRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['RecoveryCodes'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 410: components['responses']['Gone'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly disableTotp: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Missing/invalid: 401 REAUTH_REQUIRED. */
        readonly 'X-Reauth-Proof': components['parameters']['ReauthProof'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['TotpCodeRequest'];
      };
    };
    readonly responses: {
      /** @description TOTP disabled. */
      readonly 204: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly enrolTotp: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: {
      readonly content: {
        readonly 'application/json': components['schemas']['TotpEnrolRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['TotpEnrolment'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly requestTotpEnrolmentCode: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Accepted; identical whether or not a code was sent. */
      readonly 202: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Accepted'];
        };
      };
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly changePassword: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Missing/invalid: 401 REAUTH_REQUIRED. */
        readonly 'X-Reauth-Proof': components['parameters']['ReauthProof'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['ChangePasswordRequest'];
      };
    };
    readonly responses: {
      /** @description Password changed. */
      readonly 204: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly requestPasswordReset: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['EmailRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 202: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Accepted'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly resetPassword: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['ResetPasswordRequest'];
      };
    };
    readonly responses: {
      /** @description Password reset; all sessions revoked. */
      readonly 204: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 410: components['responses']['Gone'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly createReauthProof: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['ReauthRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ReauthProof'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly refreshSession: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['ClientAppRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'Set-Cookie': components['headers']['SetCookieRefresh'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['TokenResponse'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly registerUser: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['RegisterRequest'];
      };
    };
    readonly responses: {
      /** @description Accepted (identical for new and existing emails). */
      readonly 202: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Accepted'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly resendVerificationEmail: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['EmailRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 202: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Accepted'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly switchOrganisation: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['SwitchOrganisationRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['TokenResponse'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly verifyEmail: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['TokenRequest'];
      };
    };
    readonly responses: {
      /** @description Email verified. */
      readonly 204: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 410: components['responses']['Gone'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listCarrierStatuses: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: carrier_code. Default: carrier_code. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CarrierStatusList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getLegalDocument: {
    readonly parameters: {
      readonly query?: {
        /** @description Locale; falls back to en. */
        readonly locale?: components['schemas']['Locale'];
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Legal document key. */
        readonly legalDocument: components['parameters']['LegalDocumentPath'];
        /** @description Country code or EU (template). */
        readonly packCountry: components['parameters']['PackCountryPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['LegalDocument'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getCompliancePack: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Country code or EU (template). */
        readonly packCountry: components['parameters']['PackCountryPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CompliancePackPublic'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly recordConsent: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['ConsentRecordInput'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ConsentRecord'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getDocumentDownloadUrl: {
    readonly parameters: {
      readonly query?: {
        /** @description Explicit version; default latest CURRENT. */
        readonly version?: number;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Document ID. */
        readonly documentId: components['parameters']['DocumentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['DocumentDownload'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 410: components['responses']['Gone'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly evaluateFeatureFlags: {
    readonly parameters: {
      readonly query?: {
        /** @description Optional comma-separated keys; default all registered flags. */
        readonly keys?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['FeatureFlagEvaluations'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getLiveness: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['HealthLive'];
        };
      };
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getReadiness: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['HealthReady'];
        };
      };
      readonly 500: components['responses']['InternalServerError'];
      /** @description Not ready: a required dependency is unavailable (HealthReady body, not problem+json). */
      readonly 503: {
        headers: {
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['HealthReady'];
        };
      };
    };
  };
  readonly acceptInvitation: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['TokenRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Membership'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 410: components['responses']['Gone'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getMe: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Me'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly updateMe: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['MePatch'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['UserProfile'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getDashboard: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Dashboard'];
        };
      };
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getNotificationPreferences: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['NotificationPreferences'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly replaceNotificationPreferences: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['NotificationPreferencesInput'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['NotificationPreferences'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listMyNotifications: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[status], filter[template_id]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          /** @enum {string} */
          readonly status?: 'QUEUED' | 'SENT' | 'FAILED' | 'DEAD_LETTERED' | 'SUPPRESSED_BY_PREFERENCE';
          readonly template_id?: string;
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: created_at. Default: -created_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['NotificationLogList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getMyNotification: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Notification log entry ID. */
        readonly notificationId: components['parameters']['NotificationIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['NotificationLogEntry'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listMyOrganisations: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: created_at. Default: created_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['MyMembershipList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly createPaymentMethodSetup: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Missing/invalid: 401 REAUTH_REQUIRED. */
        readonly 'X-Reauth-Proof': components['parameters']['ReauthProof'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['PaymentMethodSetup'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listPaymentMethods: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: created_at. Default: -created_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['PaymentMethodList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly createPaymentMethod: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Missing/invalid: 401 REAUTH_REQUIRED. */
        readonly 'X-Reauth-Proof': components['parameters']['ReauthProof'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['PaymentMethodCreateRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['PaymentMethod'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly deletePaymentMethod: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Missing/invalid: 401 REAUTH_REQUIRED. */
        readonly 'X-Reauth-Proof': components['parameters']['ReauthProof'];
      };
      readonly path: {
        /** @description Saved payment method ID. */
        readonly paymentMethodId: components['parameters']['PaymentMethodIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Removed. */
      readonly 204: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly updatePaymentMethod: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Missing/invalid: 401 REAUTH_REQUIRED. */
        readonly 'X-Reauth-Proof': components['parameters']['ReauthProof'];
      };
      readonly path: {
        /** @description Saved payment method ID. */
        readonly paymentMethodId: components['parameters']['PaymentMethodIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['PaymentMethodPatch'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['PaymentMethod'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly requestAccountDeletion: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Missing/invalid: 401 REAUTH_REQUIRED. */
        readonly 'X-Reauth-Proof': components['parameters']['ReauthProof'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['PrivacyDeleteRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 202: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['PrivacyDeleteResult'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly requestPrivacyExport: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Missing/invalid: 401 REAUTH_REQUIRED. */
        readonly 'X-Reauth-Proof': components['parameters']['ReauthProof'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['PrivacyExportCreated'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly downloadPrivacyExport: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Missing/invalid: 401 REAUTH_REQUIRED. */
        readonly 'X-Reauth-Proof': components['parameters']['ReauthProof'];
      };
      readonly path: {
        /** @description Privacy export ID. */
        readonly exportId: components['parameters']['ExportIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Content-Disposition': components['headers']['ContentDisposition'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['PrivacyExportFile'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 410: components['responses']['Gone'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listMySessions: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: last_used_at, created_at. Default: -last_used_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['SessionList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly revokeOtherSessions: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Other sessions revoked. */
      readonly 204: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly revokeMySession: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Session ID. */
        readonly sessionId: components['parameters']['SessionIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Session revoked. */
      readonly 204: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listOrders: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[status], filter[created_from], filter[created_to]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          readonly created_from?: components['schemas']['Timestamp'];
          readonly created_to?: components['schemas']['Timestamp'];
          /** @enum {string} */
          readonly status?: 'OPEN' | 'PENDING_PAYMENT' | 'PAID' | 'BOOKING' | 'BOOKED' | 'PARTIALLY_BOOKED' | 'FAILED' | 'CANCELLED';
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: created_at. Default: -created_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['OrderSummaryList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly createOrder: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Required on this operation (creates an order, payment or booking; REQ-API-009). Missing: 400 IDEMPOTENCY_KEY_REQUIRED. Semantics DR-A20. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKeyRequired'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['OrderCreateRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Order'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getOrder: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Order ID. */
        readonly orderId: components['parameters']['OrderIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Order'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getBookingProgress: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Order ID. */
        readonly orderId: components['parameters']['OrderIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['BookingProgress'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly streamBookingProgress: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Order ID. */
        readonly orderId: components['parameters']['OrderIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Event stream. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Accel-Buffering': components['headers']['XAccelBuffering'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'text/event-stream': string;
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly checkoutOrder: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Required on this operation (creates an order, payment or booking; REQ-API-009). Missing: 400 IDEMPOTENCY_KEY_REQUIRED. Semantics DR-A20. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKeyRequired'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
        readonly 'X-Mock-Scenario'?: components['parameters']['MockScenario'];
      };
      readonly path: {
        /** @description Order ID. */
        readonly orderId: components['parameters']['OrderIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['CheckoutRequest'];
      };
    };
    readonly responses: {
      /** @description Payment created (CREATED/REQUIRES_ACTION awaits hosted confirmation; AUTHORISED starts the saga; FAILED carries failure_code, including AUTHENTICATION_FAILED when a required CVC check did not pass). */
      readonly 201: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Payment'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly applyOrderCoupon: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Order ID. */
        readonly orderId: components['parameters']['OrderIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['CouponRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Order'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly removeOrderCoupon: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Order ID. */
        readonly orderId: components['parameters']['OrderIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Order'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getOrderPayment: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Order ID. */
        readonly orderId: components['parameters']['OrderIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Payment'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly addOrderShipment: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Order ID. */
        readonly orderId: components['parameters']['OrderIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['OrderAddShipmentRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Order'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly removeOrderShipment: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Order ID. */
        readonly orderId: components['parameters']['OrderIdPath'];
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Order'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly createOrganisation: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['OrganisationCreateRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Organisation'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getOrganisation: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Organisation'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly updateOrganisation: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['OrganisationPatch'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Organisation'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listAddressBookEntries: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[is_default_sender], filter[country_code]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          readonly country_code?: components['schemas']['CountryCode'];
          readonly is_default_sender?: boolean;
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Search text over name, company, city and label. */
        readonly q?: string;
        /** @description Comma-separated, '-' for descending. Allowed: label, created_at, updated_at. Default: label. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['AddressBookEntryList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly createAddressBookEntry: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['AddressBookEntryInput'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['AddressBookEntry'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getAddressBookEntry: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Address-book entry ID. */
        readonly entryId: components['parameters']['EntryIdPath'];
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['AddressBookEntry'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly replaceAddressBookEntry: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Address-book entry ID. */
        readonly entryId: components['parameters']['EntryIdPath'];
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['AddressBookEntryInput'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['AddressBookEntry'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly deleteAddressBookEntry: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Address-book entry ID. */
        readonly entryId: components['parameters']['EntryIdPath'];
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Deleted. */
      readonly 204: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly importAddressBookEntries: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['AddressBookImportRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['AddressBookImportReport'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listInvitations: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[status]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          /** @enum {string} */
          readonly status?: 'PENDING' | 'ACCEPTED' | 'REVOKED' | 'EXPIRED';
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: created_at, expires_at. Default: -created_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['InvitationList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly createInvitation: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Needed only when the access token's auth_time is older than the operation's x-reauth-max-age (SEC-P3-01); then missing/invalid: 401 REAUTH_REQUIRED. A proof that is sent is always verified and consumed. */
        readonly 'X-Reauth-Proof'?: components['parameters']['ReauthProofConditional'];
      };
      readonly path: {
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['InvitationCreateRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Invitation'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly revokeInvitation: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Invitation ID. */
        readonly invitationId: components['parameters']['InvitationIdPath'];
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Invitation revoked. */
      readonly 204: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly resendInvitation: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Needed only when the access token's auth_time is older than the operation's x-reauth-max-age (SEC-P3-01); then missing/invalid: 401 REAUTH_REQUIRED. A proof that is sent is always verified and consumed. */
        readonly 'X-Reauth-Proof'?: components['parameters']['ReauthProofConditional'];
      };
      readonly path: {
        /** @description Invitation ID. */
        readonly invitationId: components['parameters']['InvitationIdPath'];
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Invitation'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listMembers: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[status]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          /** @enum {string} */
          readonly status?: 'ACTIVE' | 'INVITED' | 'SUSPENDED' | 'REMOVED';
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: created_at, display_name. Default: created_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['MembershipList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly removeMember: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Needed only when the access token's auth_time is older than the operation's x-reauth-max-age (SEC-P3-01); then missing/invalid: 401 REAUTH_REQUIRED. A proof that is sent is always verified and consumed. */
        readonly 'X-Reauth-Proof'?: components['parameters']['ReauthProofConditional'];
      };
      readonly path: {
        /** @description Membership ID. */
        readonly membershipId: components['parameters']['MembershipIdPath'];
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Member removed. */
      readonly 204: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly updateMember: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Proof from createReauthProof for this action scope (5 min, single-use; REQ-AUTH-020). Needed only when the access token's auth_time is older than the operation's x-reauth-max-age (SEC-P3-01); then missing/invalid: 401 REAUTH_REQUIRED. A proof that is sent is always verified and consumed. */
        readonly 'X-Reauth-Proof'?: components['parameters']['ReauthProofConditional'];
      };
      readonly path: {
        /** @description Membership ID. */
        readonly membershipId: components['parameters']['MembershipIdPath'];
        /** @description Organisation ID; must equal the active organisation (REQ-ORG-005) else 404. */
        readonly orgId: components['parameters']['OrgIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['MembershipPatch'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Membership'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getPayment: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Payment ID. */
        readonly paymentId: components['parameters']['PaymentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Payment'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly confirmPayment: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Required on this operation (creates an order, payment or booking; REQ-API-009). Missing: 400 IDEMPOTENCY_KEY_REQUIRED. Semantics DR-A20. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKeyRequired'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Payment ID. */
        readonly paymentId: components['parameters']['PaymentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['PaymentConfirmRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Payment'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly resolveSharedQuote: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['ShareTokenRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['SharedQuote'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 404: components['responses']['NotFound'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getPublicTracking: {
    readonly parameters: {
      readonly query?: {
        /** @description Platform order number. */
        readonly order_number?: string;
        /** @description Carrier tracking number. */
        readonly tracking_number?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['PublicTracking'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly lookupPublicTracking: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['PublicTrackingLookupRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['PublicTracking'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 404: components['responses']['NotFound'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listSavedQuotes: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[status]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          /** @enum {string} */
          readonly status?: 'ACTIVE' | 'EXPIRED' | 'CLAIMED';
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: created_at, expires_at. Default: -created_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['QuoteSummaryList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly createQuote: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
        readonly 'X-Mock-Scenario'?: components['parameters']['MockScenario'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['QuoteRequest'];
      };
    };
    readonly responses: {
      /** @description Quote created; rate shopping in progress. */
      readonly 201: {
        headers: {
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Quote'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getQuote: {
    readonly parameters: {
      readonly query?: {
        /** @description Optional display currency for approximate amounts. */
        readonly display_currency?: components['schemas']['CurrencyCode'];
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Quote ID. */
        readonly quoteId: components['parameters']['QuoteIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Quote'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly deleteSavedQuote: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Quote ID. */
        readonly quoteId: components['parameters']['QuoteIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Deleted. */
      readonly 204: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly claimQuote: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Guest quote access token returned once by createQuote. Never placed in URLs (REQ-QUOTE-002, A-078: wrong or missing token gives 404). */
        readonly 'X-Quote-Token'?: components['parameters']['QuoteToken'];
      };
      readonly path: {
        /** @description Quote ID. */
        readonly quoteId: components['parameters']['QuoteIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Quote'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly saveQuote: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Guest quote access token returned once by createQuote. Never placed in URLs (REQ-QUOTE-002, A-078: wrong or missing token gives 404). */
        readonly 'X-Quote-Token'?: components['parameters']['QuoteToken'];
      };
      readonly path: {
        /** @description Quote ID. */
        readonly quoteId: components['parameters']['QuoteIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Quote'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly createQuoteShare: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Quote ID. */
        readonly quoteId: components['parameters']['QuoteIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['QuoteShare'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly revokeQuoteShare: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Quote ID. */
        readonly quoteId: components['parameters']['QuoteIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Revoked. */
      readonly 204: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly streamQuoteResults: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Resume after this event id; missed events are replayed from the database before live events (ADR-0016 amendment 3). */
        readonly 'Last-Event-ID'?: components['parameters']['LastEventId'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Quote ID. */
        readonly quoteId: components['parameters']['QuoteIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Event stream. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Accel-Buffering': components['headers']['XAccelBuffering'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'text/event-stream': string;
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listCarriers: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: code. Default: code. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CarrierSummaryList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listCountries: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[shipping_enabled]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          readonly shipping_enabled?: boolean;
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: name, code. Default: name. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CountryList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getCountry: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description ISO 3166-1 alpha-2 country code. */
        readonly countryCode: components['parameters']['CountryCodePath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Country'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listSubdivisions: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: name, code. Default: name. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description ISO 3166-1 alpha-2 country code. */
        readonly countryCode: components['parameters']['CountryCodePath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['SubdivisionList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listCurrencies: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: code. Default: code. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CurrencyList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listExportReasons: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: code. Default: code. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ExportReasonList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listFxRates: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[base], filter[quote]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          readonly base?: components['schemas']['CurrencyCode'];
          readonly quote?: components['schemas']['CurrencyCode'];
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: base, quote. Default: base. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['FxRateList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly convertCurrency: {
    readonly parameters: {
      readonly query: {
        /** @description Amount in minor units of `from`. */
        readonly amount: number;
        /** @description Source currency. */
        readonly from: components['schemas']['CurrencyCode'];
        /** @description Target currency. */
        readonly to: components['schemas']['CurrencyCode'];
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['FxConversion'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listHolidays: {
    readonly parameters: {
      readonly query: {
        /** @description Country. */
        readonly country: components['schemas']['CountryCode'];
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: date. Default: date. Others: 400 INVALID_SORT. */
        readonly sort?: string;
        /** @description Calendar year. */
        readonly year: number;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['HolidayList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly searchHsCodes: {
    readonly parameters: {
      readonly query: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 20, max 20 (DR-A21). */
        readonly limit?: number;
        /** @description Code prefix or keyword. */
        readonly q: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['HsCodeList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listIncoterms: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[courier_usable]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          readonly courier_usable?: boolean;
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: code. Default: code. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['IncotermList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listProhibitedItems: {
    readonly parameters: {
      readonly query: {
        /** @description Optional carrier code. */
        readonly carrier?: components['schemas']['CarrierCode'];
        /** @description Destination country. */
        readonly country: components['schemas']['CountryCode'];
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[status]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          /** @enum {string} */
          readonly status?: 'PROHIBITED' | 'RESTRICTED';
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Optional keyword. */
        readonly q?: string;
        /** @description Comma-separated, '-' for descending. Allowed: name, category. Default: name. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'Content-Language': components['headers']['ContentLanguage'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ProhibitedItemList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly calculateVolumetricWeight: {
    readonly parameters: {
      readonly query: {
        /** @description Optional divisor override (e.g. 6000, 5000, 4000; 139, 166). */
        readonly divisor?: number;
        /** @description cm or in. */
        readonly height: number;
        /** @description cm or in. */
        readonly length: number;
        /** @description Unit system of the inputs. */
        readonly unit_system: components['schemas']['UnitSystem'];
        /** @description Optional actual weight (kg or lb). */
        readonly weight?: number;
        /** @description cm or in. */
        readonly width: number;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'Cache-Control': components['headers']['CacheControl'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['VolumetricResult'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly reportCspViolation: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/csp-report': components['schemas']['CspReport'];
        readonly 'application/reports+json': components['schemas']['CspReport'];
      };
    };
    readonly responses: {
      /** @description Report accepted. */
      readonly 204: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listShipments: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[status], filter[carrier], filter[direction], filter[destination_country], filter[created_from], filter[created_to]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          readonly carrier?: components['schemas']['CarrierCode'];
          readonly created_from?: components['schemas']['Timestamp'];
          readonly created_to?: components['schemas']['Timestamp'];
          readonly destination_country?: components['schemas']['CountryCode'];
          readonly direction?: components['schemas']['Direction'];
          /** @description Comma-separated shipment states. */
          readonly status?: string;
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Search text. */
        readonly q?: string;
        /** @description Comma-separated, '-' for descending. Allowed: created_at, updated_at. Default: -created_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ShipmentSummaryList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly createShipment: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Guest quote access token returned once by createQuote. Never placed in URLs (REQ-QUOTE-002, A-078: wrong or missing token gives 404). */
        readonly 'X-Quote-Token'?: components['parameters']['QuoteToken'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['ShipmentCreateRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Shipment'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getShipment: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Shipment'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly deleteDraftShipment: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Draft cancelled. */
      readonly 204: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content?: never;
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly updateShipment: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
        readonly 'X-Mock-Scenario'?: components['parameters']['MockScenario'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['ShipmentPatch'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Shipment'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly suggestShipmentAddress: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
        readonly 'X-Mock-Scenario'?: components['parameters']['MockScenario'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['AddressSuggestionRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['AddressSuggestion'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly cancelShipment: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Required on this operation (creates an order, payment or booking; REQ-API-009). Missing: 400 IDEMPOTENCY_KEY_REQUIRED. Semantics DR-A20. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKeyRequired'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
        readonly 'X-Mock-Scenario'?: components['parameters']['MockScenario'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['CancelShipmentRequest'];
      };
    };
    readonly responses: {
      /** @description Cancellation accepted; void and refund continue asynchronously. */
      readonly 202: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CancellationResult'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getShipmentCustoms: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Customs'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly replaceShipmentCustoms: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['CustomsUpdate'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Customs'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly checkShipmentCustoms: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['CustomsCheckRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['CustomsCheckResult'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listShipmentDocuments: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Allow-listed filters combined with AND (REQ-API-008): filter[type], filter[status]. Others: 400 INVALID_FILTER. */
        readonly filter?: {
          /** @enum {string} */
          readonly status?: 'CURRENT' | 'SUPERSEDED' | 'VOIDED';
          /** @enum {string} */
          readonly type?:
            'SHIPPING_LABEL' | 'COMMERCIAL_INVOICE' | 'PRO_FORMA_INVOICE' | 'CARRIER_CUSTOMS_DECLARATION' | 'PICKUP_CONFIRMATION';
        };
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: created_at, type. Default: -created_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['DocumentList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly emailShipmentDocuments: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Document ID. */
        readonly documentId: components['parameters']['DocumentIdPath'];
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: {
      readonly content: {
        readonly 'application/json': components['schemas']['DocumentEmailRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 202: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['DocumentEmailResult'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 410: components['responses']['Gone'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getShipmentPickup: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Pickup'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly reschedulePickup: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Required on this operation (creates an order, payment or booking; REQ-API-009). Missing: 400 IDEMPOTENCY_KEY_REQUIRED. Semantics DR-A20. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKeyRequired'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
        readonly 'X-Mock-Scenario'?: components['parameters']['MockScenario'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['PickupRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Pickup'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly schedulePickup: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Required on this operation (creates an order, payment or booking; REQ-API-009). Missing: 400 IDEMPOTENCY_KEY_REQUIRED. Semantics DR-A20. */
        readonly 'Idempotency-Key': components['parameters']['IdempotencyKeyRequired'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
        readonly 'X-Mock-Scenario'?: components['parameters']['MockScenario'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['PickupRequest'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Pickup'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly cancelPickup: {
    readonly parameters: {
      readonly query?: never;
      readonly header: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /**
         * @description Strong ETag of the version being modified. Missing: 428 PRECONDITION_REQUIRED; stale: 412 CONCURRENCY_CONFLICT (REQ-API-013).
         * @example "0193a5b2-7c1e-7d4a-9f3b-000000000f01:3"
         */
        readonly 'If-Match': components['parameters']['IfMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
        readonly 'X-Mock-Scenario'?: components['parameters']['MockScenario'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Pickup'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 412: components['responses']['PreconditionFailed'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 428: components['responses']['PreconditionRequired'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getPickupAvailability: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['PickupAvailability'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly repeatShipment: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
        readonly 'X-Mock-Scenario'?: components['parameters']['MockScenario'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 201: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly Location: components['headers']['Location'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['Shipment'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listServicePoints: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 20, max 20 (DR-A21). */
        readonly limit?: number;
        /** @description Search radius. */
        readonly radius_km?: number;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
        readonly 'X-Mock-Scenario'?: components['parameters']['MockScenario'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ServicePointList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly listShipmentTransitions: {
    readonly parameters: {
      readonly query?: {
        /** @description Opaque cursor from next_cursor (REQ-API-007). Tampered/expired: 400 INVALID_CURSOR. */
        readonly cursor?: components['parameters']['Cursor'];
        /** @description Page size, default 25, max 100; out of range is 400 VALIDATION_ERROR, never clamped (DR-A21). */
        readonly limit?: components['parameters']['Limit'];
        /** @description Comma-separated, '-' for descending. Allowed: occurred_at. Default: occurred_at. Others: 400 INVALID_SORT. */
        readonly sort?: string;
      };
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['StateTransitionList'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly getShipmentTracking: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Conditional GET; a matching ETag returns 304 with no body (REQ-API-012). */
        readonly 'If-None-Match'?: components['parameters']['IfNoneMatch'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly ETag: components['headers']['ETag'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['ShipmentTracking'];
        };
      };
      readonly 304: components['responses']['NotModified'];
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly refreshShipmentTracking: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description 1-255 printable ASCII (UUIDv4 recommended). Stored 24 h with a SHA-256 request fingerprint, scoped by organisation (or guest token) + actor + method + path (DR-A20). */
        readonly 'Idempotency-Key'?: components['parameters']['IdempotencyKey'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
        /** @description Mock carrier directives, e.g. `latency=6000;fail=booking`. Keys latency, fail, error, rates, track (DR-B29). Ignored in production (REQ-CARR-006). Invalid: 400 MOCK_SCENARIO_INVALID. */
        readonly 'X-Mock-Scenario'?: components['parameters']['MockScenario'];
      };
      readonly path: {
        /** @description Shipment ID. */
        readonly shipmentId: components['parameters']['ShipmentIdPath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody?: never;
    readonly responses: {
      /** @description Success. */
      readonly 202: {
        headers: {
          readonly 'Idempotent-Replayed': components['headers']['IdempotentReplayed'];
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['TrackingRefreshResult'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 403: components['responses']['Forbidden'];
      readonly 404: components['responses']['NotFound'];
      readonly 409: components['responses']['Conflict'];
      readonly 422: components['responses']['UnprocessableContent'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly receiveCarrierPush: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path: {
        /** @description Carrier code in lower case (e.g. dhl_express, fedex, ups). */
        readonly carrierCode: components['parameters']['CarrierCodePath'];
      };
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['CarrierPushPayload'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 202: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['WebhookAck'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 401: components['responses']['Unauthorized'];
      readonly 404: components['responses']['NotFound'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly receiveMockGatewayWebhook: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['MockGatewayEvent'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['WebhookAck'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
  readonly receiveStripeWebhook: {
    readonly parameters: {
      readonly query?: never;
      readonly header?: {
        /**
         * @description Locale negotiation for localised labels; en, es, fr; others resolve to en (REQ-I18N-006).
         * @example es-MX,es;q=0.9,en;q=0.5
         */
        readonly 'Accept-Language'?: components['parameters']['AcceptLanguage'];
        /** @description Inbound correlation ID; accepted when it matches ^[A-Za-z0-9-]{8,64}$, otherwise generated. Echoed in the response (REQ-PLAT-011). */
        readonly 'X-Correlation-Id'?: components['parameters']['CorrelationId'];
      };
      readonly path?: never;
      readonly cookie?: never;
    };
    readonly requestBody: {
      readonly content: {
        readonly 'application/json': components['schemas']['StripeEvent'];
      };
    };
    readonly responses: {
      /** @description Success. */
      readonly 200: {
        headers: {
          readonly 'RateLimit-Limit': components['headers']['RateLimitLimit'];
          readonly 'RateLimit-Remaining': components['headers']['RateLimitRemaining'];
          readonly 'RateLimit-Reset': components['headers']['RateLimitReset'];
          readonly 'X-Correlation-Id': components['headers']['XCorrelationId'];
          readonly [name: string]: unknown;
        };
        content: {
          readonly 'application/json': components['schemas']['WebhookAck'];
        };
      };
      readonly 400: components['responses']['BadRequest'];
      readonly 413: components['responses']['PayloadTooLarge'];
      readonly 415: components['responses']['UnsupportedMediaType'];
      readonly 429: components['responses']['TooManyRequests'];
      readonly 500: components['responses']['InternalServerError'];
      readonly 503: components['responses']['ServiceUnavailable'];
    };
  };
}
