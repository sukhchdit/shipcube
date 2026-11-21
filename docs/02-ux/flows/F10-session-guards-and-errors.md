# F10 — Route guards, token refresh, permission denial and global error handling

Stories: **US-020, US-030, US-070, US-104, US-105, US-106, US-036, US-040, US-069, US-257, US-291** (Must) · Both apps

## 1. Guarded route resolution (both apps)

```mermaid
flowchart TD
  R0["Navigate to a route"] --> R1{"Route auth requirement"}
  R1 -->|public| R2["Render"]
  R1 -->|session| R3{"Access token in memory?"}
  R3 -->|No| R4["Single-flight refresh (one request for all tabs)"]
  R4 -->|OK| R5
  R4 -->|"401 SESSION_REVOKED / SESSION_EXPIRED / AUTH_REQUIRED"| R6["Redirect /sign-in?returnUrl=same-origin path<br/>message: You were signed out (if a session existed)"]
  R4 -->|"429 RATE_LIMITED (after the R19 repeats when Retry-After is 1)"| R14
  R3 -->|Yes| R5{"Route permission in me.permissions?"}
  R5 -->|No| R7["PermissionDeniedState; NO data request issued"]
  R5 -->|Yes| R8["Fetch data"]
  R8 --> R9{"API response"}
  R9 -->|"401 ACCESS_TOKEN_EXPIRED"| R10["Refresh once, retry once"]
  R10 -->|"401 again"| R6
  R10 -->|"429 RATE_LIMITED on the refresh (after the R19 repeats when Retry-After is 1)"| R14
  R9 -->|"403 AUTHZ_DENIED"| R7
  R9 -->|"401 REAUTH_REQUIRED (scope, max_age)"| R18["ReauthDialog, then retry once with X-Reauth-Proof (§4)"]
  R9 -->|"403 MFA_ENROLMENT_REQUIRED (admin)"| R11["Redirect /mfa/enrol"]
  R9 -->|"404 NOT_FOUND"| R12["NotFoundState (same for cross-tenant)"]
  R9 -->|"409 / 412 / 422 domain codes"| R13["Inline handling per screen"]
  R9 -->|"429 RATE_LIMITED, Retry-After 1"| R19["API client repeats the same request by itself<br/>(same Idempotency-Key, 1 to 2 s apart, at most 3 times)<br/>loading state stays; nothing announced"]
  R19 -->|OK| R17
  R19 -->|"3rd repeat refused too"| R14
  R19 -->|"any other answer: its own edge of R9"| R9
  R9 -->|"429 RATE_LIMITED, Retry-After above 1 or missing"| R14["Rate-limited state with the retry time from Retry-After (§1.1)<br/>session kept, no redirect to sign-in; the user repeats"]
  R9 -->|"5xx / AUDIT_UNAVAILABLE / SERVICE_UNAVAILABLE"| R15["ErrorState: Try again + correlation ID"]
  R9 -->|"network failure + navigator offline"| R16["OfflineBanner + ErrorState with Try again"]
  R9 -->|OK| R17["Render"]
```

A `RATE_LIMITED` answer whose `Retry-After` is one second is repeated by the API client and reaches no screen unless the third repeat is refused too; every other `RATE_LIMITED` answer reaches the screen at once, with its retry time (ADR-0016 amendment 13 item 6, D-ARCH-233, D-UX-037).

### 1.1 Rate-limited answers (US-031, US-167, US-248; D-UX-037)

- **Only this code, only in the API client.** R19 is the API client's rule, implemented once; the query layer adds no retry for `RATE_LIMITED`, and no component repeats on a timer. The other 429 codes (`ACCOUNT_DELAYED`, `ACCOUNT_LOCKED`, `MFA_LOCKED`, `PAYMENT_ATTEMPTS_EXCEEDED`) are never repeated by the client and go to the state of their own flow (F02, F03, F06, F09).
- **The silent wait (R19).** At most three repeats of 1 to 2 s each, so about six seconds at worst, and only while every answer says one second. The screen keeps its normal loading state (W00 §3.1 skeleton with `aria-busy`, or the pressed button's loading state); nothing extra is shown or announced. If the user leaves the screen, the pending reads of that screen are cancelled with it and nothing is shown later.
- **Where R14 appears.**
  - After a user action on a rendered screen (sign-in, register, quote, reset, resend, share, MFA): the alert of that screen as its flow already shows it (F01, F02, F04, F06, F07, F09; W03 §1, W15).
  - When nothing of the route has rendered yet (R4 on entry, R10, or R9 on the first load of the route's data): the route-level `RateLimitedState` in `RouteStates` (W00 §3.9) inside the normal shell. The session is kept and there is no redirect to sign-in; a 429 never signs anyone out (US-020).
  - A background refetch or a poll of data already on screen (F01 stream fallback, F03 booking progress, documents): the data stays, no alert is shown, and the next poll is not sent before `Retry-After` has passed.
- **The retry time.** From `Retry-After`, shown with `errors:RATE_LIMITED` (or the flow's own wording, for example W10). After three refused repeats the value is 1 and it is shown as it is: "Try again in 1 second." (the singular form of the key).
- **The control.** The action that was refused ("Try again", the submit button) is `aria-disabled="true"` with `aria-describedby` → the message until the time has passed (accessibility §5), then becomes available. Nothing is sent again by itself when the countdown ends: the user repeats. On the route-level state, "Try again" re-issues what failed: the single-flight refresh (R4, R10) or the data request (R9).
- **Announcements (accessibility §4).** The message is announced once when it appears: by its alert role after the user's own action, where focus moves to the alert as for every blocking alert after an action (accessibility §3); on the route-level state through the route's `h1` (route-change focus rule) and no other focus move. The countdown is never announced per tick. When the control becomes available again, one polite message: "You can try again now." (`common:retry.available`). Focus is never moved when the countdown ends.
- **Tests.** An end-to-end test of R14 serves a `Retry-After` above 1, or the client absorbs the refusal and the state never shows; a test of R19 serves `Retry-After: 1` (D-ARCH-233, TEST-STRATEGY §10.4).

## 2. Unsafe action blocked in the UI but reached anyway (US-070)

When a control was hidden by permission but triggered anyway (tampered UI), the server answers 403 `AUTHZ_DENIED`. The UI shows an error toast (`role="alert"`) with "You don't have permission to do that" plus the correlation ID. No partial UI update is applied.

## 3. Error message resolution (US-036, US-115)

```mermaid
flowchart LR
  E0["problem+json: code, errors[] with pointer, correlation_id"] --> E1{"errors[] present?"}
  E1 -->|Yes| E2["Map each pointer to a form field; message key validation:subCode or errors:code"]
  E1 -->|No| E3["Message key errors:CODE; unknown code falls back to errors:UNKNOWN"]
  E2 --> E4["Unmapped pointers go to the top of the error summary"]
  E3 --> E5["Display in alert / state with correlation ID where it is an error state"]
```

The raw API `detail` text (English) is never shown to users. Only localised `errors:<CODE>` and `validation:<SUB_CODE>` keys are shown (US-115).

## 4. Re-authentication for sensitive actions (US-291; ADR-0006 am. 12; W03 §8; D-UX-031)

```mermaid
flowchart TD
  A0["User confirms a sensitive action<br/>(after its own AlertDialog, if any)"] --> A1{"Route scope type (client metadata)"}
  A1 -->|"always (x-reauth-scope, no max-age)"| A2["Open ReauthDialog proactively with that scope"]
  A1 -->|"max-age (e.g. org.member.manage 12 h) or none"| A3["Send the request without a proof"]
  A3 --> A4{"Response"}
  A4 -->|OK| A12["Action result on the calling screen"]
  A4 -->|"401 REAUTH_REQUIRED (scope, max_age)"| A5["Open ReauthDialog: stale variant with hours = max_age / 3600"]
  A2 --> A6{"Dialog"}
  A5 --> A6
  A6 -->|"Cancel / Escape / X"| A7["Action abandoned; no request; focus to trigger"]
  A6 -->|"Continue: POST /auth/reauth"| A8{"Proof response"}
  A8 -->|"401 INVALID_CREDENTIALS / MFA_INVALID"| A9["Inline field error; field cleared; focus stays"] --> A6
  A8 -->|"429 MFA_LOCKED / RATE_LIMITED / ACCOUNT_*"| A10["Alert in dialog with time; Continue aria-disabled"]
  A8 -->|"401 SESSION_* / AUTH_REQUIRED"| R6b["Sign-in redirect with returnUrl (§1)"]
  A8 -->|"5xx / network"| A11["Alert in dialog + reference; Try again"] --> A6
  A8 -->|"201 proof (memory only)"| A13["Run the action once with X-Reauth-Proof"]
  A13 --> A14{"Response"}
  A14 -->|OK| A12
  A14 -->|"401 REAUTH_REQUIRED (first time)"| A15["Re-open dialog: That took too long. Confirm it's you again."] --> A6
  A14 -->|"401 REAUTH_REQUIRED (second time)"| A16["Error toast errors:REAUTH_REQUIRED + reference; no further retry"]
  A14 -->|"other error"| A17["Normal handling of that error on the calling screen"]
```

- One dialog at a time per app; a second scoped action while the dialog is open waits.
- The proof is never stored, logged or put in a URL, and each proof is used for exactly one request (single-use).
- A successful re-authentication advances `auth_time` on the next token (ADR-0006 am. 12), so age-based scopes and saved-card checkout need no further prompt for 12 hours.
