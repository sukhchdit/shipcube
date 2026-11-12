# EPIC-02 — Identity, sessions and staff MFA

- **Goal:** Customers and staff can register, sign in and stay signed in securely (short-lived in-memory access token, rotating refresh cookie, mandatory TOTP for staff), and staff reach an admin shell that shows only what is implemented and permitted.
- **Milestone(s):** M0+M1 (M0: core authentication, staff MFA, admin shell; M1: customer-facing security settings, sessions page)
- **REQ areas covered:** REQ-AUTH, REQ-ADMIN (every REQ in these areas is linked below)
- **Exit-demo contribution:** PRD §6.1 "Staff and customer sign-in to both apps" (staff TOTP, access token in memory, refresh cookie), "Audit entries appear in the viewer" (LOGIN entries, auditor landing on the audit viewer); PRD §6.2 account security and sessions.
- **Depends on epics:** EPIC-03 (organisations, membership, RBAC permissions, RLS), EPIC-04 (audit writer and viewer), EPIC-05 (app shell, i18n, six states), EPIC-15 (email transport for verification, reset, security notices), EPIC-16 (problem+json, rate limits, CSRF), EPIC-17 (seeded users)

## Story summary
| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |
|---|---|---|---|---|---|---|---|
| US-015 | Register an account with a compliant password | M0 | Must | M | EPIC-03, EPIC-15, US-036 | REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-003 | DC |
| US-016 | Verify email address | M0 | Must | S | US-015, EPIC-15 | REQ-AUTH-004 | DC |
| US-017 | Sign in with email and password | M0 | Must | M | US-015 | REQ-AUTH-005 | DC |
| US-018 | Refresh cookie, rotation and reuse detection | M0 | Must | M | US-017, US-044 | REQ-AUTH-006, REQ-AUTH-007, REQ-AUTH-008 | DC |
| US-019 | Logout and immediate revocation | M0 | Must | M | US-018 | REQ-AUTH-009 |  |
| US-020 | Client-side token handling with single-flight refresh | M0 | Must | M | US-018, EPIC-05 | REQ-AUTH-010 | DC |
| US-021 | Password reset | M0 | Must | M | US-015, EPIC-15 | REQ-AUTH-011, REQ-AUTH-012 |  |
| US-022 | Progressive delay and account lockout | M0 | Must | M | US-017, US-040 | REQ-AUTH-013, REQ-AUTH-014 |  |
| US-023 | TOTP enrolment and recovery codes | M0 | Must | M | US-017 | REQ-AUTH-015, REQ-AUTH-016 | DC |
| US-024 | MFA challenge at sign-in | M0 | Must | M | US-023 | REQ-AUTH-017 | DC |
| US-025 | Mandatory TOTP enrolment for operator members | M0 | Must | S | US-023, EPIC-03 | REQ-AUTH-018 | DC |
| US-026 | Customer TOTP settings, re-authentication and staff recovery-code regeneration | M1 | Should | M | US-023, US-024 | REQ-AUTH-019, REQ-AUTH-020, REQ-ADMIN-008 |  |
| US-027 | Sessions list and remote sign-out (API and My sessions page) | M1 | Must | M | US-019, EPIC-05 | REQ-AUTH-021, REQ-AUTH-022, REQ-ADMIN-007 |  |
| US-028 | Change password | M1 | Should | S | US-026 | REQ-AUTH-023 |  |
| US-029 | Refuse sign-in for suspended and deactivated users | M0 | Should | S | US-017, US-019 | REQ-AUTH-024 |  |
| US-030 | Admin app route guard and staff-only admission | M0 | Must | S | US-017, US-020 | REQ-ADMIN-001, REQ-ADMIN-003 | DC |
| US-031 | Staff sign-in, MFA challenge and enrolment screens | M0 | Must | M | US-030, US-023, US-024, EPIC-05 | REQ-ADMIN-002 | DC |
| US-032 | Admin landing page, permission-aware navigation and audit-viewer routes | M0 | Must | M | US-031, EPIC-03, EPIC-04, EPIC-05 | REQ-ADMIN-005, REQ-ADMIN-006, REQ-ADMIN-009 | DC |
| US-033 | Admin session lifetime and crawler exclusion | M0 | Should | S | US-018, US-030 | REQ-ADMIN-004, REQ-ADMIN-010 |  |
| US-291 | Re-authentication primitive, `auth_time` and age-based step-up | M1 | Must | M | US-017, US-018, US-024 | REQ-AUTH-020, REQ-AUTH-025 |  |
| US-292 | Unverified-account expiry and pre-hijack recovery | M0 | Must | S | US-015, US-016, EPIC-01 | REQ-AUTH-026 |  |

## Stories

### US-015 — Register an account with a compliant password
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-03, EPIC-15, US-036
- **Linked REQs:** REQ-AUTH-001, REQ-AUTH-002, REQ-AUTH-003
- **As a** guest shipper **I want** to create an account with email, password, name, locale and terms acceptance **so that** I can book and manage shipments.
- **Notes:** Email trimmed, NFC-normalised, lower-cased, at most 254 characters, case-insensitively unique. Existing email returns the same 202 as success plus an "account already exists" email (EC-A01, EC-A02). The "account already exists" email contains a password-reset entry point; the verification email says "if you did not create this account, ignore this e-mail" (D-050). `POST /auth/register` is counted in the `auth` and the `email-send` rate classes; more than 5 distinct addresses per IP per hour is `registration_probe` (D-049, EC-A52). The register-then-login existence oracle is accepted as RR-16 / PRD R-12. Passwords 12-128 characters; breached list of 10,000 is a bundled offline asset; bcrypt cost at least 12 (EC-A03). The registration UI form is in EPIC-05.

#### Acceptance criteria
```gherkin
Feature: Register an account with a compliant password
  Scenario: Successful registration
    When a guest posts email "Alice@Example.com " , password "correct horse battery 9", displayName "Alice", locale "es" and termsVersion current
    Then the response is 202
    And one user with email "alice@example.com" and status PENDING_VERIFICATION exists
    And a personal INDIVIDUAL organisation with the user as Owner and a terms-acceptance record (version, UTC timestamp) exist, created in one transaction
    And a verification email in locale "es" is in the mail catcher
    And the stored password is a bcrypt hash with cost at least 12 and it appears in no response, log or audit value

  Scenario: Existing email gives the identical response
    Given alice@example.com is registered
    When another registration is posted for " ALICE@example.com"
    Then the response is 202 with the same body and no second user or organisation is created
    And an "account already exists" email is sent to the existing owner

  Scenario Outline: Password policy violations
    When registering with password "<password>" for email "bob@example.com"
    Then the response is 400 VALIDATION_ERROR with pointer "/body/password" and sub-code PASSWORD_POLICY
    Examples:
      | password                                  |
      | 11charsonly                               |
      | a 129-character string                    |
      | password1234                              |
      | bob                                       |

  Scenario: Long multibyte password is accepted and fully significant
    Given a 100-character password with multibyte characters exceeding 72 bytes
    When the user registers and later signs in with that password minus its last character
    Then sign-in fails with 401 INVALID_CREDENTIALS

  Scenario: Other validation errors
    When displayName is empty or locale is "de" or terms are not accepted
    Then the response is 400 VALIDATION_ERROR listing every failing field pointer

  Scenario: Rehash on login when cost is lower
    Given a stored hash with cost 10 and configured cost 12
    When the user signs in successfully
    Then the stored hash is replaced by a cost-12 hash

  Scenario: Registration is rate limited (anonymous endpoint, no permission needed)
    When 11 registrations arrive from one IP within a minute
    Then the 11th returns 429 RATE_LIMITED with Retry-After

  Scenario: Audit of registration
    Then CREATE audit entries for user and organisation exist with actor type ANONYMOUS, IP, outcome SUCCESS, written in the same transaction, and values exclude password and hash

  Scenario: Sixth distinct address from one IP in an hour is a registration probe
    Given one IP has registered 5 distinct normalised addresses within the last hour
    When it posts a registration for a 6th distinct address
    Then the response is 429 RATE_LIMITED with Retry-After
    And one security log event "registration_probe" with no secrets is written and its counter increments
    And no user, organisation or email is created for the 6th address

  Scenario: Fourth accepted registration for one address in an hour
    Given 3 registrations for "alice@example.com" were accepted within the last hour
    When a 4th is posted for " ALICE@example.com"
    Then the response is 429 RATE_LIMITED with Retry-After (email-send class, 3 per hour per normalised address)
    And no further email is sent to that address

  Scenario: New and existing addresses are indistinguishable
    Given alice@example.com is registered and bob-new@example.com is not
    When each address is registered once from different IPs
    Then both responses are 202 with identical status and body
    And the median response times differ by no more than the configured jitter tolerance (EC-A01)

  Scenario: Email wording supports recovery
    Then the "account already exists" email contains a password-reset entry point
    And the verification email contains the sentence "if you did not create this account, ignore this e-mail" in en, es and fr
```

### US-016 — Verify email address
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-015, EPIC-15
- **Linked REQs:** REQ-AUTH-004
- **As a** registered individual **I want** to confirm my email through a link **so that** I can use features that require a verified address.
- **Notes:** 256-bit single-use token stored hashed, valid 24 h. Resend limited to 3 per hour per account and 10 per hour per IP (DR-A22, NFR-SEC-005, D-035). Unverified users can sign in; payment gating is in EPIC-10 (US-208). Successful verification revokes every other session of the user (D-050, EC-A51); a verify call from a session of another user, or from no session, revokes all sessions. Unverified accounts expire after 7 days (US-292).

#### Acceptance criteria
```gherkin
Feature: Verify email address
  Scenario: Valid token verifies
    Given a user in PENDING_VERIFICATION with a fresh token
    When the token is redeemed
    Then the response is 200, email_verified_at is set and status becomes ACTIVE
    And an UPDATE audit entry records the status transition

  Scenario: Expired token
    Given a token issued 24 h and 1 s ago
    When it is redeemed
    Then the response is 410 TOKEN_EXPIRED

  Scenario Outline: Used or unknown token
    When a "<kind>" token is redeemed
    Then the response is 400 TOKEN_INVALID
    Examples:
      | kind    |
      | used    |
      | unknown |
      | earlier |

  Scenario: Resend invalidates earlier tokens and is limited
    When a user requests resend 4 times within an hour
    Then requests 1-3 return 202 and each invalidates the previous token
    And request 4 returns 429 RATE_LIMITED

  Scenario: Resend for unauthenticated or unknown email gives no information
    When resend is requested for an unknown email
    Then the response is 202 identical to a known email

  Scenario: Unverified user can sign in
    Given the user has not verified
    When they sign in
    Then sign-in succeeds

  Scenario: Verification revokes every other session (pre-hijack protection)
    Given an attacker pre-registered the victim's address and holds a signed-in session S1 for that account
    And the victim opens the verification link in a browser where the victim holds session S2 for the same account
    When the victim redeems the token with S2
    Then the response is 200 and status becomes ACTIVE
    And S1 is revoked and the attacker's refresh returns 401 SESSION_REVOKED within 5 s
    And exactly one SESSION_REVOKED audit entry per revoked session exists, each with the target session ID
    And S2 is not revoked

  Scenario: Verification from a fresh browser revokes all sessions
    Given the account has sessions S1 and S2
    When the token is redeemed by an anonymous request
    Then the response is 200 and S1 and S2 are both revoked with one SESSION_REVOKED audit entry each

  Scenario: The verifying user's own session keeps working
    Given the verifying session S2 belongs to the same user
    When the token is redeemed
    Then requests with S2's access token still succeed and S2's refresh still returns 200

  Scenario: Verification email wording
    Then the verification email contains "if you did not create this account, ignore this e-mail"
```

### US-017 — Sign in with email and password
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-015
- **Linked REQs:** REQ-AUTH-005
- **As a** registered customer **I want** to sign in **so that** I reach my account.
- **Notes:** 15-minute JWT in the response body; claims limited to opaque subject, session ID, active org ID, iat, exp, token ID; no roles or personal data. Identical 401 `INVALID_CREDENTIALS` for unknown email, wrong password and non-permitted account type. Authentication endpoints are idempotency not-applicable.

#### Acceptance criteria
Permission path: not applicable — pre-authentication flow; the negative scenarios cover invalid credentials and lockout
```gherkin
Feature: Sign in with email and password
  Scenario: Successful sign-in
    Given the seeded customer Owner
    When they post correct credentials to /api/v1/auth/login
    Then the response is 200 with an access token expiring in 900 s
    And a refresh cookie is set and not present in the body
    And the token claims contain sub, session id, active org id, iat, exp and jti and no role, permission, email or name
    And a LOGIN audit entry with outcome SUCCESS exists

  Scenario Outline: Failures are indistinguishable
    When signing in with "<case>"
    Then the response is 401 INVALID_CREDENTIALS with an identical body apart from correlation_id
    Examples:
      | case                              |
      | unknown email                     |
      | wrong password                    |
      | DEACTIVATED user                  |

  Scenario: Timing does not reveal account existence
    When 200 attempts each are made for known and unknown emails
    Then the median response times differ by no more than the configured jitter tolerance

  Scenario: Failed login is audited
    When a login fails
    Then a LOGIN_FAILED entry with outcome DENIED, actor type ANONYMOUS, IP and a security log event is written

  Scenario: Missing field
    When the password is omitted
    Then the response is 400 VALIDATION_ERROR pointer "/body/password"

  Scenario: Login endpoint is rate limited
    When 11 logins arrive from one IP within a minute
    Then the 11th returns 429 RATE_LIMITED
```

### US-018 — Refresh cookie, rotation and reuse detection
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-017, US-044
- **Linked REQs:** REQ-AUTH-006, REQ-AUTH-007, REQ-AUTH-008
- **As a** customer **I want** my session renewed safely and a stolen cookie neutralised **so that** I stay signed in without exposing my account.
- **Notes:** Cookie HttpOnly, Secure (relaxed only for NODE_ENV=development on localhost), SameSite=Strict, `__Host-` prefix with `Path=/` and no `Domain`, read by the server only on the auth routes (refresh, logout, CSRF token) and ignored everywhere else (REQ-AUTH-006 as amended by D-043 / ADR-0006 amendment 1), 30 days (accepted, compensated ASVS V3.3.2 deviation, D-046 supersedes D-038), names `__Host-rt_web` and `__Host-rt_admin`. Family states in DR-A03. Absolute session cap 30 days (`AUTH_SESSION_ABSOLUTE_TTL=30d`, was 90 days; D-046); `AUTH_REFRESH_TTL` may never exceed it. The session's `authenticated_at` is copied unchanged by refresh into the `auth_time` claim (REQ-AUTH-025, US-291). Refresh requires CSRF token and allowed Origin (US-044). Refresh, logout and CSRF routes are `public` rate class (D-043).

#### Acceptance criteria
```gherkin
Feature: Refresh cookie, rotation and reuse detection
  Scenario: Cookie attributes
    When a user signs in on the web app and on the admin app
    Then each refresh cookie is HttpOnly, Secure, SameSite=Strict, named with the __Host- prefix, has Path=/ and no Domain attribute, Max-Age 2592000, and the two cookie names differ
    And no refresh token appears in any response body

  Scenario: Cookie is read only by the auth routes
    Given a valid refresh cookie and no Authorization header
    When GET /api/v1/me is called with the cookie
    Then the response is 401 AUTH_REQUIRED and the cookie value is not read or logged
    When POST /api/v1/auth/refresh is called with the same cookie, a valid Origin and X-CSRF-Token
    Then the response is 200

  Scenario: Refresh rotates the token
    When POST /api/v1/auth/refresh is sent with the cookie, a valid Origin and X-CSRF-Token
    Then a new access token and a new refresh cookie in the same family are returned
    And the presented token becomes ROTATED

  Scenario: Reuse of a rotated token revokes the family
    Given the legitimate client already rotated token T1 to T2
    When T1 is presented
    Then the response is 401 SESSION_REVOKED
    And the family and session are REVOKED including T2
    And a TOKEN_REUSE_DETECTED audit entry and a security log event are written

  Scenario: Absolute age cap
    Given a session created 30 days and 1 s ago (fake clock)
    When refresh is attempted
    Then the response is 401 SESSION_EXPIRED
    And the session and its family are REVOKED and no token is issued

  Scenario: Sliding expiry is clamped to the absolute cap
    Given a session created 29 days and 23 hours ago
    When refresh is attempted with a valid cookie, Origin and X-CSRF-Token
    Then the response is 200 and the new refresh cookie expires at login time plus 30 days, not at now plus 30 days

  Scenario: Refresh never renews auth_time
    Given a session whose last password verification was 2 h ago
    When refresh is called twice
    Then the auth_time claim in each new access token equals the original login time

  Scenario: Refresh lifetime may not exceed the absolute cap
    Given the configuration AUTH_REFRESH_TTL=45d and AUTH_SESSION_ABSOLUTE_TTL=30d
    When the API starts
    Then start-up fails config validation naming AUTH_REFRESH_TTL

  Scenario: Missing CSRF token or foreign origin
    When refresh is sent without X-CSRF-Token
    Then the response is 403 CSRF_REJECTED

  Scenario: Revoked family cannot be revived
    Given a REVOKED family
    When any of its tokens is presented
    Then 401 SESSION_REVOKED is returned and no token is issued

  Scenario: Permission path (no cookie)
    When refresh is called without a cookie
    Then the response is 401 AUTH_REQUIRED
```

### US-019 — Logout and immediate revocation
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-018
- **Linked REQs:** REQ-AUTH-009
- **As a** customer **I want** logout to end my session everywhere it matters at once **so that** a stolen access token stops working within seconds.
- **Notes:** Revocation list Redis-backed with TTL equal to access-token lifetime; applies to logout, remote sign-out, reset, password change, reuse detection, membership removal of the active org.

#### Acceptance criteria
```gherkin
Feature: Logout and immediate revocation
  Scenario: Logout revokes within 5 s
    Given a signed-in user holding access token A
    When POST /api/v1/auth/logout is sent with cookie, Origin and X-CSRF-Token
    Then the cookie is cleared, the family is REVOKED and a LOGOUT audit entry is written
    And within 5 s any request with A returns 401 SESSION_REVOKED

  Scenario Outline: Other triggers revoke too
    When "<trigger>" happens for a user session
    Then requests with its access token return 401 SESSION_REVOKED within 5 s
    Examples:
      | trigger                              |
      | password reset completed             |
      | token reuse detected                 |
      | membership of the active org removed |

  Scenario: Logout without CSRF token
    Then 403 CSRF_REJECTED and the session stays active

  Scenario: Logout without session
    When logout is called without cookie
    Then the response is 401 AUTH_REQUIRED

  Scenario: Redis TTL
    Then the revocation entry expires after the access-token lifetime of 900 s

  Scenario: Revocation check on every authenticated request
    Given Redis revocation lookup is unavailable
    Then authenticated requests fail closed with 503 SERVICE_UNAVAILABLE
```

### US-020 — Client-side token handling with single-flight refresh
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-018, EPIC-05
- **Linked REQs:** REQ-AUTH-010
- **As a** customer or staff user **I want** the apps to keep me signed in without storing tokens where scripts can steal them **so that** my session is safe and seamless.
- **Notes:** Applies to web and admin. EC-A04, EC-A11. Locale/responsive: the redirect lands on a localised sign-in page.

#### Acceptance criteria
```gherkin
Feature: Client-side token handling with single-flight refresh
  Scenario: Token only in memory
    When a user signs in
    Then localStorage, sessionStorage, document.cookie and every URL contain no access token
    And a page reload obtains a new access token through the refresh cookie

  Scenario: Two tabs refresh at once
    Given two open tabs near token expiry
    When both need a token simultaneously
    Then exactly one POST /api/v1/auth/refresh is sent and both tabs use the result

  Scenario: Expired access token is retried once
    When a request returns 401 ACCESS_TOKEN_EXPIRED
    Then the client refreshes once and retries the original request once
    And a second 401 redirects to sign-in with a return URL

  Scenario: Revoked session redirects
    When refresh returns 401 SESSION_REVOKED
    Then the user is redirected to /sign-in?returnUrl=<same-origin path>
    And a localised "You were signed out" message is shown in en, es and fr

  Scenario: Unsafe return URL is dropped
    Given returnUrl "https://evil.example/x"
    Then after sign-in the user lands on the default page

  Scenario: Unauthenticated visit to a protected route
    When an anonymous visitor opens a protected route
    Then they are redirected to sign-in
```

### US-021 — Password reset
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-015, EPIC-15
- **Linked REQs:** REQ-AUTH-011, REQ-AUTH-012
- **As a** customer who forgot my password **I want** to reset it by email **so that** I regain access safely.
- **Notes:** Token 256-bit, stored hashed, valid 60 minutes, supersedes earlier tokens. 3 requests per hour per account, 10 per hour per IP (DR-A22, NFR-SEC-005, D-035). EC-A10. A redeemed token sets `email_verified_at` when still null (D-050), the recovery path for a mailbox owner whose address was pre-registered by someone else (EC-A51).

#### Acceptance criteria
Permission path: not applicable — pre-authentication token flow; invalid/expired/reused token scenarios are the negative paths
```gherkin
Feature: Password reset
  Scenario: Request responds identically for any email
    When a reset is requested for a known and for an unknown email
    Then both return 202 with identical bodies
    And only the known account receives an email in its locale

  Scenario: Newer token supersedes older
    When two resets are requested
    Then redeeming the first token returns 400 TOKEN_INVALID

  Scenario: Successful redemption
    Given a valid token and the account is locked
    When it is redeemed with a compliant new password
    Then the password hash is replaced, the token is used, all sessions are revoked, lock and counters are cleared
    And a security-notice email is sent and an UPDATE audit entry for the credential change is written without password or hash values
    And the user can sign in with the new password

  Scenario Outline: Invalid redemptions
    When a "<kind>" token is redeemed
    Then the response is "<status>" "<code>"
    Examples:
      | kind               | status | code          |
      | expired (61 min)   | 410    | TOKEN_EXPIRED |
      | already used       | 400    | TOKEN_INVALID |
      | unknown            | 400    | TOKEN_INVALID |

  Scenario: Redeeming a reset token proves mailbox control
    Given a user in PENDING_VERIFICATION with email_verified_at null and a valid reset token
    When the token is redeemed with a compliant new password
    Then email_verified_at is set and the status becomes ACTIVE
    And all of the user's sessions are revoked as for any reset
    And an UPDATE audit entry records the status transition without password or hash values

  Scenario: Weak new password
    When redeemed with "password1234"
    Then the response is 400 VALIDATION_ERROR sub-code PASSWORD_POLICY and the token stays valid

  Scenario: Request limits
    When 4 reset requests for one account arrive within an hour
    Then the 4th returns 429 RATE_LIMITED with Retry-After
    And 11 requests from one IP in an hour result in 429 for the 11th
```

### US-022 — Progressive delay and account lockout
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-017, US-040
- **Linked REQs:** REQ-AUTH-013, REQ-AUTH-014
- **As an** account owner **I want** repeated wrong passwords to slow and then lock sign-in **so that** guessing is impractical.
- **Notes:** DR-A02. Failures 1-4 no delay; 5-9 delay 2, 4, 8 ... capped 60 s (ASSUMED GAP-A-02); 10 reached locks 15 min. Counters also for unknown identifiers (hashed key). EC-A09.

#### Acceptance criteria
Permission path: not applicable — pre-authentication protection; applies to any identifier
```gherkin
Feature: Progressive delay and account lockout
  Scenario: Delay starts at the fifth failure and doubles
    When 5 consecutive wrong passwords are submitted for one account
    Then the next attempt returns 429 ACCOUNT_DELAYED with Retry-After 2
    And after waiting and failing again the Retry-After values are 4, 8, 16, 32, 60

  Scenario: Lock after 10 failures
    When 10 consecutive failures have been recorded
    Then the response is 429 ACCOUNT_LOCKED with Retry-After about 900
    And an ACCOUNT_LOCKED audit entry and security log event exist and an unlock-information email is sent to a verified account

  Scenario: Correct password is refused during delay or lock
    Given the account is locked
    When the correct password is submitted
    Then the response is 429 ACCOUNT_LOCKED and the counter does not increase

  Scenario: Unknown identifiers behave identically
    When 10 failures are made for an unregistered email
    Then the same 429 codes and Retry-After values are returned and no email is sent

  Scenario: Success resets counters
    Given 4 consecutive failures
    When the correct password is submitted
    Then sign-in succeeds and the counter is 0

  Scenario: Each failure is audited
    Then each failure writes LOGIN_FAILED with outcome DENIED and a security event

  Scenario: Lock expires
    Given the lock is 15 min old
    Then sign-in with the correct password succeeds
```

### US-023 — TOTP enrolment and recovery codes
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-017
- **Linked REQs:** REQ-AUTH-015, REQ-AUTH-016
- **As a** staff user **I want** to enrol an authenticator app and receive recovery codes **so that** I can sign in with a second factor.
- **Notes:** RFC 6238: 6 digits, 30 s, SHA-1, plus or minus 1 step. Pending enrolment expires after 15 min. Secret encrypted at rest and returned once. Codes cannot be reused within their step (EC-A06, EC-A07). 10 recovery codes of at least 50 bits, stored hashed; regeneration needs re-authentication (US-026). UI is US-031.

#### Acceptance criteria
```gherkin
Feature: TOTP enrolment and recovery codes
  Scenario: Enrolment and activation
    Given an authenticated user without TOTP
    When they start enrolment
    Then the response contains a provisioning URI and a manual key once
    When they submit a valid code
    Then MFA becomes active and 10 recovery codes are returned once
    And UPDATE audit entries for mfa activation are written without secret or code values

  Scenario: Wrong code does not activate
    When an invalid code is submitted
    Then 401 MFA_INVALID is returned and MFA stays inactive

  Scenario: Pending enrolment expires
    Given enrolment started 16 minutes ago
    When a valid code is submitted
    Then it is rejected with 410 TOKEN_EXPIRED and a new enrolment is required

  Scenario: Secret stored encrypted and never repeated
    Then the database column holds ciphertext and a second GET of enrolment never returns the secret

  Scenario: Same code twice in one step
    When the same valid code is submitted twice within 30 s
    Then the second is 401 MFA_INVALID

  Scenario: Tolerance window
    When a code from the previous 30 s step is submitted
    Then it is accepted, and a code two steps old is rejected

  Scenario: Recovery codes
    Then 10 codes are stored hashed, each single-use, and a used code cannot be reused
    And using one writes an audited entry and sends a notification email
    And with 2 or fewer remaining the account security screen shows a warning

  Scenario: Unauthenticated enrolment
    When enrolment is started without a token
    Then the response is 401 AUTH_REQUIRED
```

### US-024 — MFA challenge at sign-in
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-023
- **Linked REQs:** REQ-AUTH-017
- **As a** user with TOTP **I want** to complete a second step after my password **so that** a stolen password alone is useless.
- **Notes:** Challenge token valid 5 minutes, single-use, bound to user and IP class (same /24 for IPv4); 5 consecutive wrong codes lock MFA for the **user** for 15 min, counted across challenges and IPs (ASSUMED GAP-A-03, DR-A02 as amended by D-043 / ADR-0006 amendment 3). A consumed recovery code writes `MFA_RECOVERY_USED` (REQ-AUDIT-002).

#### Acceptance criteria
Permission path: not applicable — challenge-token flow before a session exists; the "Challenge token misuse" scenario is the equivalent
```gherkin
Feature: MFA challenge at sign-in
  Scenario: Password then TOTP
    Given the seeded Super Admin with active TOTP
    When the correct password is posted
    Then the response is 401 MFA_REQUIRED with a challenge token and no session tokens
    When the challenge token and a valid code are posted
    Then an access token and refresh cookie are issued and a LOGIN audit entry is written

  Scenario: Recovery code works once
    When a valid recovery code is posted as the second factor
    Then sign-in succeeds, an MFA_RECOVERY_USED audit entry and a security-notice email are written, and the same code a second time returns 401 MFA_INVALID

  Scenario: Wrong code
    Then the response is 401 MFA_INVALID and a failure is audited with outcome DENIED and security-logged

  Scenario: Lock after five wrong codes is per user
    When 5 consecutive wrong codes are submitted
    Then the next attempt returns 429 MFA_LOCKED with Retry-After about 900, even for a correct code

  Scenario: A new challenge does not reset the lock counter
    Given 3 wrong codes were submitted on one challenge
    When the user re-enters the password, obtains a new challenge token from another IP and submits 2 more wrong codes
    Then the response is 429 MFA_LOCKED and the lock applies to every challenge of that user for 15 minutes

  Scenario Outline: Challenge token misuse
    When the challenge token is "<misuse>"
    Then the response is 401 MFA_INVALID or TOKEN_INVALID and no session is issued
    Examples:
      | misuse                          |
      | older than 5 minutes            |
      | already used                    |
      | presented from another /24 IP   |
      | used as a bearer access token   |

  Scenario: Code from a drifting device clock
    When the device is more than one step off
    Then 401 MFA_INVALID is returned and the recovery path remains usable
```

### US-025 — Mandatory TOTP enrolment for operator members
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-023, EPIC-03
- **Linked REQs:** REQ-AUTH-018
- **As an** operator **I want** staff without TOTP restricted to enrolment **so that** no staff action happens without a second factor.
- **Notes:** EC-A13. Seeded staff start in this state (REQ-DATA-003). Also applies to staff added to the operator org later. Outside `APP_ENV` local/test the first activation needs an e-mailed one-time code (6 digits, 10 minutes, single use, sent to the staff address; wrong or expired is `MFA_INVALID` and counts toward the per-user MFA lock) and a staff member not enrolled 24 h after the membership was created is set `SUSPENDED` by `housekeeping` (D-052, SEC-P3-14). The M0 demo runs `APP_ENV=local` and is unchanged. Re-enabling a suspended account is the M2 users screen; locally re-run the seed.

#### Acceptance criteria
```gherkin
Feature: Mandatory TOTP enrolment for operator members
  Scenario: Staff without TOTP can only reach enrolment
    Given a seeded Super Admin who has not enrolled
    When they sign in and call GET /api/v1/audit/entries
    Then the response is 403 MFA_ENROLMENT_REQUIRED and no data is returned
    And the MFA enrolment endpoints respond normally

  Scenario: After activation normal access resumes
    When the staff user activates TOTP and signs in again with a code
    Then the previously blocked call succeeds

  Scenario: Staff added later
    Given a customer user is added as member of the OPERATOR organisation
    Then their next session is restricted to enrolment endpoints

  Scenario: Enrolment endpoints still require authentication
    When enrolment is called without a token
    Then the response is 401 AUTH_REQUIRED

  Scenario: Customer without operator membership is unaffected
    Then the seeded customer Owner calls business endpoints without MFA

  Scenario: Blocked attempt is audited
    Then a PERMISSION_DENIED entry with outcome DENIED and reason MFA_ENROLMENT_REQUIRED is written

  Scenario: Staging requires the e-mailed code for first activation
    Given APP_ENV=staging and a staff member without TOTP who has started enrolment
    And a 6-digit code was e-mailed to the staff address and is visible in the mail catcher
    When they submit a valid authenticator code without the e-mailed code
    Then the response is 401 MFA_INVALID and MFA stays inactive
    When they submit a valid authenticator code with the e-mailed code within 10 minutes
    Then MFA becomes active and an UPDATE audit entry without secret or code values is written

  Scenario Outline: E-mailed code misuse
    Given APP_ENV=staging and a staff member starting first activation
    When the e-mailed code is "<state>"
    Then the response is 401 MFA_INVALID and the failure counts toward the per-user MFA lock
    Examples:
      | state                  |
      | older than 10 minutes  |
      | already used           |
      | sent to another user   |

  Scenario Outline: No e-mailed code in local and test
    Given APP_ENV=<env> and a seeded staff member without TOTP
    When they activate TOTP with a valid authenticator code and no e-mailed code
    Then MFA becomes active (M0 demo unchanged)
    Examples:
      | env   |
      | local |
      | test  |

  Scenario: Enrolment deadline suspends the staff member
    Given APP_ENV=staging and a staff membership created 24 h and 1 s ago (fake clock) whose user has no active TOTP
    When the housekeeping job runs
    Then the user status becomes SUSPENDED, their sessions are revoked and an UPDATE audit entry by the system actor exists
    And signing in returns 401 INVALID_CREDENTIALS identical to a wrong password

  Scenario: Staff enrolled in time is not suspended
    Given a staff membership created 23 h ago whose user activated TOTP
    When the housekeeping job runs
    Then the user stays ACTIVE
```

### US-026 — Customer TOTP settings, re-authentication and staff recovery-code regeneration
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-023, US-024
- **Linked REQs:** REQ-AUTH-019, REQ-AUTH-020, REQ-ADMIN-008
- **As a** customer or staff user **I want** to manage my second factor after proving it is me **so that** sensitive security changes are protected.
- **Notes:** The re-authentication primitive itself (proof, 5 minutes, single-use, bound to session and scope, `REAUTH_REQUIRED`, `auth_time`) is now specified and tested in US-291 (Must); this story keeps the consumers: TOTP disable and staff recovery-code regeneration. Staff cannot disable their own TOTP. Staff TOTP reset by an administrator is M2. UI states: loading, error, permission-denied; en/es/fr; 360 px and 1280 px.

#### Acceptance criteria
```gherkin
Feature: Customer TOTP settings, re-authentication and staff recovery-code regeneration
  Scenario: Customer enables then disables TOTP
    Given a customer Owner without TOTP
    When they enrol and later disable TOTP with a valid re-authentication proof
    Then TOTP is off, all other sessions are revoked and UPDATE audit entries exist

  Scenario: Missing proof
    When disable is called without a proof
    Then the response is 401 REAUTH_REQUIRED

  Scenario Outline: Proof misuse
    When a proof that is "<state>" is used
    Then the response is 401 REAUTH_REQUIRED
    Examples:
      | state                           |
      | older than 5 minutes            |
      | already consumed                |
      | issued for another action scope |
      | issued for another session      |

  Scenario: Staff regenerates recovery codes
    Given a staff user with a valid proof
    When they regenerate recovery codes
    Then 10 new codes are shown once, the previous set is void and an audited entry exists

  Scenario: Staff cannot disable TOTP
    When a staff user (operator member) calls disable even with a proof
    Then the response is 403 AUTHZ_DENIED and a PERMISSION_DENIED entry is written

  Scenario: Re-authentication with TOTP for MFA users
    Given a user with active TOTP
    Then the proof is obtained with a TOTP code instead of the password

  Scenario: Security settings screen in three locales
    Then the screen renders in en, es and fr at 360 px and 1280 px with loading and error states
```

### US-027 — Sessions list and remote sign-out (API and My sessions page)
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-019, EPIC-05
- **Linked REQs:** REQ-AUTH-021, REQ-AUTH-022, REQ-ADMIN-007
- **As a** customer or staff user **I want** to see and end my sessions **so that** I can remove a device I no longer trust.
- **Notes:** Promoted to Must by D-047 (ASVS 3.3.4). Not demo-critical. Own sessions only. Fields: session ID, parsed browser and OS, coarse IP (IPv4 /24, IPv6 /48), created, last used, current flag. Current session action reads "Sign out". Listing is a VIEW of entity `session`. Page exists in web (account) and admin.

#### Acceptance criteria
```gherkin
Feature: Sessions list and remote sign-out
  Scenario: List own sessions
    Given a user with sessions on Chrome/Windows and Safari/iOS
    When they open My sessions
    Then both are listed with browser, OS, coarse IP (203.0.113.0/24 style), created and last-used times
    And the current session is labelled and its action reads "Sign out"
    And one VIEW audit entry for entity session is written

  Scenario: Sign out one session
    When the user signs out the iOS session
    Then access tokens of that session fail within 5 s and an audit entry records the target session ID

  Scenario: Sign out all other sessions
    Then every session except the current one is revoked and the current one stays active

  Scenario: Remote sign-out is audited
    When the user signs out session S2 remotely
    Then a SESSION_REVOKED audit entry with outcome SUCCESS and the target session ID of S2 is written in the same transaction
    And signing out all other sessions writes one SESSION_REVOKED entry per revoked session

  Scenario: Foreign or unknown session
    When the user targets a session ID belonging to another user
    Then the response is 404 NOT_FOUND identical to an unknown ID

  Scenario: Unauthenticated
    Then GET sessions without a token returns 401 AUTH_REQUIRED

  Scenario: Six states and locales
    Then the page shows loading, empty-not-applicable (current always present), error, offline and permission-denied states in en, es, fr at 360 px and 1280 px
```

### US-028 — Change password
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-026
- **Linked REQs:** REQ-AUTH-023
- **As a** signed-in user **I want** to change my password **so that** I can rotate credentials.
- **Notes:** Requires re-authentication proof (US-026). New password equal to current is `PASSWORD_POLICY`.

#### Acceptance criteria
```gherkin
Feature: Change password
  Scenario: Successful change
    Given a valid proof and the current password
    When a compliant new password is submitted
    Then the hash is replaced, all other sessions are revoked, a security-notice email is sent and an UPDATE audit entry without password values is written

  Scenario: Wrong current password
    Then the response is 401 INVALID_CREDENTIALS and counts toward lockout

  Scenario: Same password
    When new equals current
    Then the response is 400 VALIDATION_ERROR sub-code PASSWORD_POLICY

  Scenario: Missing proof
    Then the response is 401 REAUTH_REQUIRED

  Scenario: Unauthenticated
    Then the response is 401 AUTH_REQUIRED
```

### US-029 — Refuse sign-in for suspended and deactivated users
- **Milestone:** M0 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-017, US-019
- **Linked REQs:** REQ-AUTH-024
- **As an** operator **I want** suspended or deactivated users unable to sign in and their sessions ended **so that** access removal is effective.
- **Notes:** DR-A04: sign-in permitted only in PENDING_VERIFICATION and ACTIVE. The admin screen to change status is M2; the check and seam exist now (status set by test fixture).

#### Acceptance criteria
```gherkin
Feature: Refuse sign-in for suspended and deactivated users
  Scenario Outline: Blocked statuses
    Given a user with status "<status>" and correct credentials
    When they sign in
    Then the response is 401 INVALID_CREDENTIALS identical to a wrong password
    Examples:
      | status      |
      | SUSPENDED   |
      | DEACTIVATED |

  Scenario: Status change revokes sessions
    Given an active signed-in user
    When their status becomes SUSPENDED
    Then their access tokens fail within 5 s and refresh returns 401 SESSION_REVOKED

  Scenario: Verification does not revoke
    When status moves PENDING_VERIFICATION to ACTIVE
    Then existing sessions remain valid

  Scenario: Deactivated is terminal
    When a transition from DEACTIVATED to ACTIVE is attempted
    Then it is rejected with 409 CONFLICT

  Scenario: Blocked sign-in is audited
    Then LOGIN_FAILED with outcome DENIED and internal reason is written
```

### US-030 — Admin app route guard and staff-only admission
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-017, US-020
- **Linked REQs:** REQ-ADMIN-001, REQ-ADMIN-003
- **As an** operator **I want** the admin app to admit only authenticated staff **so that** customers cannot reach back-office features or learn that staff accounts exist.
- **Notes:** Separately built static app. Return URLs are same-origin relative paths only. EC-A14. A customer signing in to the customer web app is symmetric: operator-only accounts without a customer membership are rejected there too.

#### Acceptance criteria
```gherkin
Feature: Admin app route guard and staff-only admission
  Scenario: Unauthenticated visit redirects with return URL
    When an anonymous visitor opens /audit/entries/123 in the admin app
    Then they are redirected to /sign-in?returnUrl=%2Faudit%2Fentries%2F123

  Scenario: Only sign-in and MFA challenge are public
    Then every other admin route requires an authenticated session

  Scenario: Open redirect is blocked
    Given returnUrl "//evil.example" or "https://evil.example"
    Then after sign-in the user lands on the default page

  Scenario: Customer cannot sign in to admin
    When a customer with correct credentials signs in via the admin app
    Then the response is 401 INVALID_CREDENTIALS identical to a wrong password
    And a LOGIN_FAILED audit entry with outcome DENIED and internal reason NOT_STAFF is written

  Scenario: Staff with active operator membership is admitted
    Then the seeded Super Admin proceeds to the MFA step

  Scenario: Operator-only account on the customer web app
    Given an operator member with no customer membership
    When they sign in via the web app
    Then 401 INVALID_CREDENTIALS is returned
```

### US-031 — Staff sign-in, MFA challenge and enrolment screens
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-030, US-023, US-024, EPIC-05
- **Linked REQs:** REQ-ADMIN-002
- **As a** staff member **I want** a guided sign-in with TOTP or recovery code and first-time enrolment **so that** I can safely enter the admin app.
- **Notes:** Steps: email+password, TOTP/recovery code, or enrolment (QR + manual key, confirmation code, one-time display of 10 recovery codes with acknowledgement). Navigating away from recovery codes requires acknowledgement.

#### Acceptance criteria
Permission path: not applicable — staff sign-in screens are pre-authentication; the admin route guard US-030 covers denial after sign-in
```gherkin
Feature: Staff sign-in, MFA challenge and enrolment screens
  Scenario: Enrolled staff signs in
    Given the seeded Super Admin with TOTP
    When they enter email and password and then a valid code
    Then the admin shell is shown in their locale

  Scenario: Recovery code alternative
    When they choose "Use a recovery code" and enter a valid one
    Then they are signed in

  Scenario: First-time enrolment
    Given a seeded staff user without TOTP
    When they sign in
    Then they see the QR code and manual key, enter a valid confirmation code and see 10 recovery codes once
    And "Continue" stays disabled until the acknowledgement checkbox is ticked

  Scenario: Leaving the recovery-code screen
    When the user tries to navigate away before acknowledging
    Then a confirmation prompt blocks navigation

  Scenario Outline: Error feedback
    When "<case>" occurs
    Then an accessible, localised message is announced and focus moves to the message
    Examples:
      | case                          |
      | wrong password                |
      | wrong code                    |
      | MFA locked (MFA_LOCKED)       |
      | account delayed (ACCOUNT_DELAYED) with a countdown |

  Scenario Outline: Locales and layouts
    Given locale "<locale>" and viewport "<viewport>"
    Then all three steps render with no truncation and meet WCAG 2.2 AA (labels, focus order, contrast)
    Examples:
      | locale | viewport |
      | en     | 360 px   |
      | es     | 360 px   |
      | fr     | 1280 px  |

  Scenario: Screen states
    Then loading (submit pending), error, offline (retry) and permission-denied (admission refused) states are shown; empty and partial are not applicable

  Scenario: Authentication endpoints are rate limited
    Then the 11th attempt from one IP within a minute shows the localised RATE_LIMITED message with the retry time
```

### US-032 — Admin landing page, permission-aware navigation and audit-viewer routes
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-031, EPIC-03, EPIC-04, EPIC-05
- **Linked REQs:** REQ-ADMIN-005, REQ-ADMIN-006, REQ-ADMIN-009
- **As a** staff member **I want** to land where I can work and see only implemented, permitted modules **so that** the admin app is honest and safe.
- **Notes:** Audit viewer content is EPIC-04; this story owns routing, deep links, breadcrumbs and navigation. "No silent stubs" rule (brief section 13).

#### Acceptance criteria
```gherkin
Feature: Admin landing page, permission-aware navigation and audit-viewer routes
  Scenario: Auditor lands on the audit log
    Given the seeded Compliance Auditor with audit:read
    When they sign in
    Then they land on /audit and the sidebar shows only "Audit log"

  Scenario: User without audit:read gets the welcome page
    Given a staff user with no audit:read
    Then the welcome page shows their name, role names and a "My sessions" link
    And a user with no permissions for any module sees the empty state "Contact your administrator"

  Scenario: No navigation for unimplemented modules
    Then orders, customers, carriers, pricing, finance, reports and settings entries, routes and placeholder pages do not exist
    And /orders shows the not-found state

  Scenario: Deep links
    When /audit?actor=...&action=LOGIN&from=2026-11-01 is opened
    Then filters are applied from the query string after validation
    And /audit/entries/<id> and /audit/entities/shipment/<id> render with breadcrumbs

  Scenario: Invalid filter value in URL
    When the URL carries from=not-a-date
    Then the value is ignored with an inline notice and no request is made with it

  Scenario: Deep link without audit:read
    When a user lacking audit:read opens /audit
    Then the permission-denied state is shown and the sidebar has no Audit entry

  Scenario: Locales and breakpoints
    Then navigation collapses to a menu at 360 px and is fixed at 1280 px, in en, es and fr
```

### US-033 — Admin session lifetime and crawler exclusion
- **Milestone:** M0 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-018, US-030
- **Linked REQs:** REQ-ADMIN-004, REQ-ADMIN-010
- **As an** operator **I want** staff sessions capped at 12 hours and the admin app hidden from crawlers **so that** cross-tenant access is time-boxed and not indexed.
- **Notes:** 12 h is configurable (ASSUMED GAP-A-04), independent of refresh rotation. Idle timeout is 30 minutes of user input (pointer, keyboard, touch), enforced server-side by a sliding admin refresh TTL `AUTH_ADMIN_REFRESH_IDLE_TTL=30m` inside the 12 h cap and client-side by stopping silent refresh; warning dialog at 28 minutes (WCAG 2.2.1, D-052, D-UX-025). Background refetches and silent refresh are not activity.

#### Acceptance criteria
```gherkin
Feature: Admin session lifetime and crawler exclusion
  Scenario: Absolute cap
    Given a staff session created 12 h and 1 s ago with continuous refreshes
    When refresh is attempted
    Then the response is 401 SESSION_REVOKED and the user must sign in again

  Scenario: Configurable
    Given ADMIN_SESSION_MAX_HOURS is 8
    Then the cap is 8 hours

  Scenario: Customer session is unaffected
    Then a customer session of 13 h remains valid via refresh

  Scenario: Headers and robots
    When any admin response is fetched
    Then it has X-Robots-Tag "noindex, nofollow"
    And /robots.txt contains "Disallow: /"

  Scenario: Expiry is audited
    Then a LOGOUT or session-expiry audit entry with reason SESSION_EXPIRED is written

  Scenario: Admin refresh token idle for 30 minutes
    Given an admin session with a valid refresh token last used 30 min and 1 s ago (fake clock) and 2 h after login
    When refresh is attempted
    Then the response is 401 SESSION_EXPIRED
    And a refresh at 29 min 59 s idle returns 200 and slides the idle window

  Scenario: Admin SPA signs out after 30 minutes without input
    Given the admin app is open and receives no pointer, keyboard or touch input for 30 minutes (fake timers)
    Then silent refresh stops, POST /api/v1/auth/logout is called and the sign-in page is shown with a localised "You were signed out for inactivity" message in en, es and fr

  Scenario: Warning dialog at 28 minutes with extend action
    Given no input for 28 minutes
    Then a modal warning dialog with focus on an "Extend session" button appears, announced to assistive technology
    When the user activates "Extend session"
    Then the idle timer resets, silent refresh continues and the dialog closes

  Scenario: Background activity is not user input
    Given no user input for 29 minutes while the app performs background refetches and silent refresh
    Then the idle timer is not reset and the user is signed out at 30 minutes
```

### US-291 — Re-authentication primitive, `auth_time` and age-based step-up
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-017, US-018, US-024
- **Linked REQs:** REQ-AUTH-020, REQ-AUTH-025
- **As a** customer or staff user **I want** to prove it is me again before a sensitive action, and to be asked again only when my last verification is old **so that** a stolen or forgotten session cannot cause lasting harm.
- **Notes:** Added by D-046 (REQ-AUTH-020 retagged Must; new REQ-AUTH-025). It is the compensating control for the 30-day session. Proof: 5 minutes, single-use, bound to the session and a named scope (`x-reauth-scope`); password, or a TOTP code for MFA users. `auth_time` is the last password or MFA verification (`sessions.authenticated_at`), copied unchanged by refresh; routes with `x-reauth-max-age` (43200 s) require a proof when `now − auth_time` exceeds it. `REAUTH_REQUIRED` problem detail carries `scope` and `max_age`. Consumers: US-026, US-028, US-083, US-085 and the payment and privacy stories (not repeated here). Re-authentication routes are in the `auth` rate class (DR-A22). Not demo-critical.

#### Acceptance criteria
```gherkin
Feature: Re-authentication primitive, auth_time and age-based step-up
  Background:
    Given a test route R1 with x-reauth-scope "test.sensitive" and a test route R2 with x-reauth-scope "test.member" and x-reauth-max-age 43200

  Scenario: Obtain a proof with the password
    Given a signed-in customer without TOTP
    When they post their correct password for scope "test.sensitive" to the re-authentication endpoint
    Then the response is 200 with a proof that expires in 300 s
    And calling R1 with the proof in X-Reauth-Proof succeeds

  Scenario: Obtain a proof with a TOTP code for an MFA user
    Given a signed-in user with active TOTP
    When they post a valid TOTP code for scope "test.sensitive"
    Then the response is 200 with a proof and a password alone is refused with 401 MFA_REQUIRED or MFA_INVALID and no proof

  Scenario: Wrong password or code gives no proof
    When the wrong password is posted
    Then the response is 401 INVALID_CREDENTIALS, no proof is issued and the failure counts toward lockout (US-022)

  Scenario: Proof is single-use
    Given a proof was consumed by one successful call to R1
    When it is presented again
    Then the response is 401 REAUTH_REQUIRED

  Scenario: Route with a scope and no proof
    When R1 is called without X-Reauth-Proof
    Then the response is 401 REAUTH_REQUIRED and the problem detail contains scope "test.sensitive"

  Scenario Outline: Proof misuse
    When a proof that is "<state>" is presented to R1
    Then the response is 401 REAUTH_REQUIRED
    Examples:
      | state                           |
      | older than 5 minutes            |
      | already consumed                |
      | issued for another action scope |
      | issued for another session      |

  Scenario: Access token carries auth_time
    When a user signs in with password (and TOTP when enrolled) at time T
    Then the access token contains the claim auth_time equal to T and the session's authenticated_at equals T

  Scenario: Refresh leaves auth_time unchanged
    Given a session authenticated at T
    When the token is refreshed 3 times over the next hours
    Then every new access token has auth_time equal to T

  Scenario: Age-based step-up (fake clock)
    Given a session whose auth_time is 11 h 59 min old
    When R2 is called without a proof
    Then the response is 200
    When the clock advances to auth_time age 12 h 01 min and R2 is called without a proof
    Then the response is 401 REAUTH_REQUIRED and the problem detail contains scope "test.member" and max_age 43200
    When the user re-authenticates for scope "test.member" and repeats the call with the proof
    Then the response is 200
    And the next access token has an auth_time equal to the re-authentication time and R2 succeeds without a proof

  Scenario: Scope without max age always requires a proof
    Given a session authenticated 1 minute ago
    When R1 is called without a proof
    Then the response is 401 REAUTH_REQUIRED

  Scenario: Unauthenticated
    When the re-authentication endpoint or R1 is called without an access token
    Then the response is 401 AUTH_REQUIRED

  Scenario: Re-authentication is rate limited
    When 11 re-authentication attempts arrive from one IP within a minute
    Then the 11th returns 429 RATE_LIMITED

  Scenario: Audit of a successful re-authentication
    When a re-authentication succeeds
    Then an UPDATE audit entry for entity "session" with the old and new authenticated_at is written in the same transaction with outcome SUCCESS
    And the entry contains no password, TOTP code or proof value
    And a failed re-authentication writes LOGIN_FAILED with outcome DENIED
```

### US-292 — Unverified-account expiry and pre-hijack recovery
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-015, US-016, EPIC-01
- **Linked REQs:** REQ-AUTH-026
- **As a** platform operator **I want** accounts that never verify their e-mail to expire after 7 days **so that** nobody can squat on or pre-register a victim's address indefinitely, and the real mailbox owner can register once the week has passed.
- **Notes:** D-050, SEC-P3-06 item 3, EC-A51. `AUTH_UNVERIFIED_TTL=7d` is configuration; the job is a `housekeeping` repeatable job (REQ-PLAT-015). The e-mail unique index excludes `DEACTIVATED` users (or the address is tombstoned). Drafts, quotes and addresses of the expired user are retained for the audit chain and removed by the later erasure jobs. Mailbox owner's earlier recovery path: password reset verifies the mailbox (US-021). Not demo-critical.

#### Acceptance criteria
Permission path: not applicable — system job, no principal
```gherkin
Feature: Unverified-account expiry and pre-hijack recovery
  Scenario: Expired unverified account is deactivated
    Given an account registered 7 days and 1 s ago (fake clock) still in PENDING_VERIFICATION with a live session and a personal organisation
    When the housekeeping job runs
    Then the user status is DEACTIVATED and the user's sessions are revoked
    And the personal organisation is soft-deleted (deleted_at set)
    And an UPDATE audit entry for the status transition exists with actor type SYSTEM_JOB, outcome SUCCESS, old status PENDING_VERIFICATION and new status DEACTIVATED

  Scenario: The address can register again
    Given the account above was expired
    When a guest registers the same address
    Then the response is 202 and a new user row with status PENDING_VERIFICATION exists
    And the old row still exists with its audit history

  Scenario: Account inside the window is untouched
    Given an account registered 6 days and 23 hours ago in PENDING_VERIFICATION
    When the housekeeping job runs
    Then its status, sessions and organisation are unchanged and no audit entry is written

  Scenario: Verified account is never touched
    Given an ACTIVE account registered 30 days ago
    When the housekeeping job runs
    Then it is unchanged

  Scenario: Sign-in for the expired account
    Given the account was expired
    When its owner signs in with the original credentials
    Then the response is 401 INVALID_CREDENTIALS identical to a wrong password

  Scenario: Job redelivery is idempotent
    Given one expired unverified account
    When the housekeeping job runs twice
    Then the account is deactivated once and exactly one audit entry exists

  Scenario: Failure of one account does not block the others
    Given two expired accounts and a forced failure while expiring the first
    When the housekeeping job runs
    Then the second is still deactivated and the failure is logged and retried on the next run
```

## Coverage check
| REQ | Stories |
|---|---|
| REQ-AUTH-001 | US-015 |
| REQ-AUTH-002 | US-015 |
| REQ-AUTH-003 | US-015 |
| REQ-AUTH-004 | US-016 |
| REQ-AUTH-005 | US-017 |
| REQ-AUTH-006 | US-018 |
| REQ-AUTH-007 | US-018 |
| REQ-AUTH-008 | US-018 |
| REQ-AUTH-009 | US-019 |
| REQ-AUTH-010 | US-020 |
| REQ-AUTH-011 | US-021 |
| REQ-AUTH-012 | US-021 |
| REQ-AUTH-013 | US-022 |
| REQ-AUTH-014 | US-022 |
| REQ-AUTH-015 | US-023 |
| REQ-AUTH-016 | US-023 |
| REQ-AUTH-017 | US-024 |
| REQ-AUTH-018 | US-025 |
| REQ-AUTH-019 | US-026 |
| REQ-AUTH-020 | US-026, US-291 |
| REQ-AUTH-021 | US-027 |
| REQ-AUTH-022 | US-027 |
| REQ-AUTH-023 | US-028 |
| REQ-AUTH-024 | US-029 |
| REQ-AUTH-025 | US-291 |
| REQ-AUTH-026 | US-292 |
| REQ-ADMIN-001 | US-030 |
| REQ-ADMIN-002 | US-031 |
| REQ-ADMIN-003 | US-030 |
| REQ-ADMIN-004 | US-033 |
| REQ-ADMIN-005 | US-032 |
| REQ-ADMIN-006 | US-032 |
| REQ-ADMIN-007 | US-027 |
| REQ-ADMIN-008 | US-026 |
| REQ-ADMIN-009 | US-032 |
| REQ-ADMIN-010 | US-033 |
