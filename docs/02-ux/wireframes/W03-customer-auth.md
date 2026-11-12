# W03 — Customer authentication screens (S-A01..S-A06)

Routes `/sign-in`, `/sign-in/verify`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password` · Client-rendered · Permission `public` (pre-authentication) · Stories: **US-015, US-016, US-017, US-020, US-021, US-022, US-024, US-171, US-291** (Must; US-291 = §8 ReauthDialog, an overlay shared by both apps) · US-026 (Should) · Flows: [F02 §1](../flows/F02-auth-gate-and-wizard.md), [F07](../flows/F07-password-reset.md), [F08](../flows/F08-email-verification.md), [F10 §4](../flows/F10-session-guards-and-errors.md)

All six screens share one layout: a centred single column, max 480 px (`size.layout.formNarrow`), on `bg.canvas`, with the form in a `Card`. At 360 px the card is full-bleed with 16 px gutters. Header and footer are the regular web shell.

## 1. Sign in (S-A01)

```
360                                         1280
+--------------------------------------+    +--------------------------------------------------+
| header                               |    | header                                           |
+--------------------------------------+    +--------------------------------------------------+
| (i) You were signed out. Sign in     |    |            +------------------------------+      |
|     again to continue.  (US-020)     |    |            | BookingContextCard (if from  |      |
| +----------------------------------+ |    |            | Book): DHL Express Worldwide |      |
| | Sign in to book this shipment    | |    |            | $45.20 · valid until 14:30   |      |
| | DHL Express Worldwide · $45.20   | |    |            | Your price is saved.         |      |
| | Valid until 13 Nov 14:30 EST     | |    |            +------------------------------+      |
| | Your price is saved.             | |    |            # Sign in                             |
| +----------------------------------+ |    |            Email                                 |
| # Sign in                            |    |            [______________________________]      |
| ! Email or password is incorrect.    |    |            Password            <Forgot password?>|
| Email                                |    |            [__________________________][Show]    |
| [________________________________]   |    |            [          Sign in             ]      |
| Password                             |    |            New here? <Create an account>         |
| [__________________________][Show]   |    |                                                  |
| <Forgot your password?>              |    +--------------------------------------------------+
| [            Sign in             ]   |
| New here? <Create an account>        |
+--------------------------------------+
```

- **Fields:** Email (`type=email`, `autocomplete="username"`), Password (PasswordField, `autocomplete="current-password"`). Paste allowed; no CAPTCHA (WCAG 3.3.8, D-UX-026).
- **Errors (form-level alert, `role="alert"`, focus moves to it, US-031 pattern also used here):**
  - `INVALID_CREDENTIALS`: "Email or password is incorrect." The alert never says which one.
  - `ACCOUNT_DELAYED`: "Too many attempts. You can try again in {seconds} seconds." A visible countdown runs. The submit button is `aria-disabled` until 0, and the message is announced once (not per second).
  - `ACCOUNT_LOCKED`: "For your security, sign-in is paused until {time}. You can <reset your password> to unlock it now."
  - `RATE_LIMITED`: "Too many sign-in attempts from this network. Try again in {seconds} seconds."
  - Network or 5xx: "We couldn't sign you in right now. Try again." + reference.
- **Booking context:** shown when `returnUrl` points to a booking route and the quote and option are readable with the guest token (US-171). Otherwise it is omitted.
- **Signed-out notice:** shown after `SESSION_REVOKED`, `SESSION_EXPIRED` (30-day absolute cap, ADR-0006 am. 12) or `AUTH_REQUIRED` redirects (US-020). The same notice covers sessions ended by e-mail verification in another browser (D-050 (1)); the page never says why, so it reveals nothing about other devices.
- **Expired unverified account (US-292):** an account deactivated after 7 days unverified gets the same `INVALID_CREDENTIALS` alert as a wrong password. No special message (no account-existence signal); the user can register again (§3).

## 2. Two-step verification (S-A06, customers with TOTP)

```
| # Enter your verification code                       |
| Open your authenticator app and enter the 6-digit    |
| code for {BRAND_NAME}.                               |
| Code                                                 |
| [ 123 456 ]   (single field, numeric, mono)          |
| [            Verify            ]                     |
| <Use a recovery code instead>                        |
| <Back to sign in>                                    |
```
- `autocomplete="one-time-code"`, `inputmode="numeric"`. It auto-submits at 6 digits and the button remains.
- `MFA_INVALID`: an inline field error "That code didn't work. Enter the current code from your app." The field is cleared and focus stays.
- `MFA_LOCKED`: alert "Too many incorrect codes. Try again at {time}." The field is disabled.
- Challenge expired or `TOKEN_INVALID`: alert "Your sign-in timed out. <Start again>".
- Recovery code mode: label "Recovery code", `inputmode="text"`, hint "Each code works once."

## 3. Register (S-A02)

```
360
+--------------------------------------+
| [BookingContextCard if from Book]    |
| # Create your account                |
| ErrorSummary (2+ errors)             |
| Your name                            |
| [________________________________]   |
| Email                                |
| [________________________________]   |
| Password                             |
| At least 12 characters. Avoid common |
| passwords.                           |
| [__________________________][Show]   |
| Language for emails                  |
| [Español v]   (defaults to active)   |
| [ ] I agree to the <Terms> and have  |
|     read the <Privacy notice>        |
| [        Create account        ]     |
| Already have an account? <Sign in>   |
+--------------------------------------+
```
1280: the same column, centred.

- **Fields:** Name (`autocomplete="name"`), Email (`autocomplete="email"`), Password (`autocomplete="new-password"`, rule hint as static text), Language (Select of endonyms, default the active locale), Terms checkbox (required; links open the legal pages in the same tab with state preserved, or as a Dialog showing the terms, chosen by the developer; the default is a new tab with the visible text "(opens in a new tab)" because losing form state is worse).
- **Validation:** on blur. The password rules are checked client-side for length (12–128). The breached-list check is server-only. `PASSWORD_POLICY` shows "Choose a stronger password. It must be 12 to 128 characters and not a commonly used password."
- **Rate limit (D-049):** registration counts in the `email-send` class as well as `auth`; 429 `RATE_LIMITED` (including the `registration_probe` case) shows the form-level alert `errors:RATE_LIMITED` with the retry time. The text never says why (no hint about other addresses); field values are kept.
- **Success (202, identical for new and existing emails, US-015):** the page swaps to the status panel:
```
| (mail icon) # Check your inbox                         |
| We've sent a link to ana@example.com. Open it to verify |
| your email. You'll need a verified email to pay.        |
| [Continue to booking]   (only when returnUrl is booking |
|                          and a session was issued)      |
| Didn't get it? <Send again>  · <Change email>           |
```
Focus moves to the panel `h1`.

## 4. Verify email (S-A03)

Token landing (`/verify-email#token=…`):
```
| Verifying your email…   (status text, skeleton line)   |
then
| (check-circle) # Your email is verified                |
| You can now pay for bookings.                          |
| [Continue where you left off]  or  [Sign in]           |
or
| (alert) # This link has expired                        |
| Links last 24 hours. [Send a new link]                 |
or
| (alert) # This link is no longer valid                 |
| It may have been used already or replaced by a newer   |
| link. [Send a new link]                                |
```
Pending panel (`/verify-email` without a token, signed in): the "Check your inbox" panel above, with Send again and "I've verified my email" (re-checks status).

Resend errors: `RATE_LIMITED` (4th in an hour): "You can request another link at {time}."

## 5. Forgot password (S-A04) and reset (S-A05)

```
Forgot                                         Reset
| # Reset your password                    |   | # Choose a new password                  |
| Enter your email and we'll send you a    |   | New password                             |
| link to choose a new password.           |   | At least 12 characters.                  |
| Email                                    |   | [________________________][Show]         |
| [______________________________]         |   | [      Change password      ]            |
| [       Send reset link       ]          |   |                                          |
| <Back to sign in>                        |   | -> success:                              |
| -> after submit (always the same):       |   | (check) # Your password has been changed |
| (mail) # Check your inbox                |   | You've been signed out on all devices.   |
| If an account exists for {email}, we've  |   | [Sign in]                                |
| sent a link. It expires in 60 minutes.   |   |                                          |
| <Send again>  <Back to sign in>          |   | expired / invalid: like §4, "Request a   |
|                                          |   | new link" -> /forgot-password            |
```
- Reset uses one password field with Show/Hide (no "confirm password" field: show/hide removes the need for re-entry, WCAG 3.3.7 spirit, D-UX-026).
- `PASSWORD_POLICY` shows inline; the token stays valid (US-021).

## 6. States (all auth screens)

| State | Rendering |
|---|---|
| Loading | Submit button loading (`aria-busy`). Token-redeem pages show a status line with a skeleton. |
| Empty | Not applicable |
| Error | Form-level alert + reference; field values kept (except password fields after `INVALID_CREDENTIALS`, which are cleared) |
| Partial | Not applicable |
| Permission-denied | Not applicable before authentication. Operator-only accounts get `INVALID_CREDENTIALS` on the web app (US-030), shown like any wrong password. |
| Offline | Banner; submit `aria-disabled` with the reason |
| Already signed in | Visiting `/sign-in` or `/register` with a session redirects to `returnUrl` or `/account` |

## 7. Accessibility

- One `h1` per screen. The form has `aria-labelledby` set to the `h1`.
- Error alerts: inserted with `role="alert"` and focused (`tabindex=-1`) on submit failure. Inline field errors are linked with `aria-describedby`.
- Countdown text for delay and lock is shown visually and updated each second, but **not** in a live region. Only the initial message is announced.
- Show-password toggle: `aria-pressed`, label switches, and focus stays on the toggle.
- Accessible authentication (3.3.8): no cognitive test, no CAPTCHA, paste allowed, password managers supported, codes can be pasted, and the recovery code is an alternative.
- Redundant entry (3.3.7): the email entered on sign-in carries to Forgot password and to Register (prefilled through router state, not the URL).
- Targets 44 px on touch. The "Forgot password" link sits outside the label row on mobile so it does not crowd the field.

## 8. Re-authentication dialog "Confirm it's you" (ReauthDialog, **US-291 Must**; both apps; D-UX-031)

A `packages/ui` overlay that obtains a 5-minute, single-use proof (`createReauthProof`) bound to the session and to one action scope, then lets the pending action run with `X-Reauth-Proof`. It is not a route. Flow: [F10 §4](../flows/F10-session-guards-and-errors.md).

### 8.1 When it opens

| Trigger | Scopes (ReauthRequest enum) | Behaviour |
|---|---|---|
| **Proactive**: the action's route always requires a proof (`x-reauth-scope` without `x-reauth-max-age`) | `auth.password.change`, `mfa.totp.disable`, `mfa.recovery_codes.regenerate`, `privacy.delete`, `privacy.export`, `payment_method.manage` | The dialog opens at the **last step**: after the user has confirmed the action (including its own AlertDialog, if any) and immediately before the request, so the proof is used within seconds and never expires in a half-filled form. The client knows the scope from the generated API client metadata. |
| **Reactive**: the API answers 401 `REAUTH_REQUIRED` (age-based scopes such as `org.member.manage` with max age 12 h, or a proof that expired, was consumed or was for another scope) | any; `scope` and `max_age` come from the problem detail | The API client intercepts the 401, opens the dialog with that scope (the "stale" variant when `max_age` is present), and on success **retries the original request once** with the proof. A second `REAUTH_REQUIRED` on the retry ends the loop with an error toast `errors:REAUTH_REQUIRED` + reference; the action is not retried again automatically. |

### 8.2 Layout

```
360 (Dialog, full width minus 16 px gutters)        1280 (Dialog, centred, max 440 px)
+--------------------------------------+            +----------------------------------------------+
| # Confirm it's you              [X]  |            | # Confirm it's you                       [X] |
| You're changing your saved cards.    |  purpose   | You're changing your saved cards.            |
| (It's been more than 12 hours since  |  stale     | Enter your password to continue.             |
|  you last confirmed it's you.)       |  variant   | Password                                     |
| Enter your password to continue.     |            | [______________________________][Show]       |
| Password                             |            |                       [Continue] [Cancel]    |
| [__________________________][Show]   |            +----------------------------------------------+
| <Forgot your password?>              |
| [          Continue          ]       |  primary
| [           Cancel           ]       |
+--------------------------------------+

TOTP variant (user with MFA; always for staff):
| # Confirm it's you                   |
| You're turning off two-step          |
| verification.                        |
| Enter the 6-digit code from your     |
| authenticator app to continue.       |
| Code from your authenticator app     |
| [ ______ ]  (single field, numeric)  |
| <Can't use your authenticator app?>  |  -> Help (S-W05); README §5 item 13
| [          Continue          ]       |
| [           Cancel           ]       |
```

- **Variant choice:** TOTP when `me.mfa_enabled` is true (the API refuses a password alone for MFA users on MFA-weakening scopes, and `ReauthRequest` takes `totp_code` for MFA users generally); password otherwise. Staff always have TOTP. Recovery codes are not accepted by the contract, so no recovery-code link is shown (open item 13).
- **Purpose sentence** comes from one key per scope (`reauth:purpose.{scope with dots as underscores}`), followed by a separate instruction sentence per variant. No sentence is assembled from fragments (US-115).
- **Stale variant** (reactive trigger with `max_age`): adds "It's been more than {hours} hours since you last confirmed it's you." where `hours = max_age / 3600`.
- **Fields:** Password: `PasswordField`, `autocomplete="current-password"`, plus a hidden read-only `autocomplete="username"` input holding the account e-mail so password managers fill the right entry (3.3.8). TOTP: `OneTimeCodeField`, `autocomplete="one-time-code"`, `inputmode="numeric"`, auto-submits at 6 digits (the button remains). Paste allowed in both.
- **"Forgot your password?"** (password variant only) opens `/forgot-password` in the same tab after the dialog closes; the pending action is abandoned.
- **Proof handling:** the proof lives only in memory inside the API client call that consumes it; it is never stored, logged, put in a URL or shown.

### 8.3 Responses and messages

| Response | Rendering |
|---|---|
| 201 proof | Dialog closes; the pending request runs with `X-Reauth-Proof`; the calling control shows its own loading state and outcome. Focus returns to the control that triggered the action (or per that screen's rules after success, for example a removed row). |
| 401 `INVALID_CREDENTIALS` (password) | Inline field error "That password is incorrect. Try again."; field cleared; focus stays on the field. Counts toward lockout (US-022); the text does not say so. |
| 401 `MFA_INVALID` | Inline field error `errors:MFA_INVALID`; field cleared; focus stays. After 2 consecutive failures the clock hint of W15 §2 is added. |
| 429 `MFA_LOCKED` | Alert in the dialog `errors:MFA_LOCKED` with the time; field and Continue `aria-disabled` with the reason; Cancel stays. |
| 429 `ACCOUNT_DELAYED` / `ACCOUNT_LOCKED` (if returned; open item 14) | Alert in the dialog with the W03 §1 texts; Continue `aria-disabled` until the time; countdown text not announced per tick. |
| 429 `RATE_LIMITED` | Alert `errors:RATE_LIMITED` with the retry time; Continue `aria-disabled` until then. |
| 401 `SESSION_REVOKED` / `SESSION_EXPIRED` / `AUTH_REQUIRED` | Dialog closes; F10 sign-in redirect with the signed-out notice and `returnUrl`. |
| 403 `MFA_ENROLMENT_REQUIRED` (staff) | F10: redirect to `/mfa/enrol`. |
| 5xx, `AUDIT_WRITE_FAILED`, network | Alert in the dialog "We couldn't check this right now. Try again." + reference; the password stays in the field (no server rejection happened). |
| Retried action answers `REAUTH_REQUIRED` once more (proof older than 5 min, consumed) | The dialog re-opens once with the notice "That took too long. Confirm it's you again." If that also fails: error toast, no further loop. |
| Cancel, X or Escape | Dialog closes; the pending action is abandoned without a request; nothing changes; focus returns to the trigger. Where cancelling changes a visible control (the "Save this card" checkbox), it is reverted. |

### 8.4 States

| State | Rendering |
|---|---|
| Default | As drawn; focus on the field |
| Loading | Continue in loading state (`aria-busy`), field read-only, Cancel enabled (cancelling ignores the late response) |
| Error | Inline field error or in-dialog alert per §8.3; alerts use `role="alert"` and receive focus; field errors are linked with `aria-describedby` |
| Offline | Continue `aria-disabled` with "You're offline"; the OfflineBanner behind the overlay |
| Empty / Partial / Permission-denied | Not applicable (no data is loaded; an unauthenticated caller is redirected, F10) |

### 8.5 Accessibility

- Radix `Dialog` (`role="dialog"`, `aria-modal="true"`), labelled by the title, described by the purpose and instruction sentences. Not an `alertdialog`: the user started the action, nothing is urgent.
- Initial focus on the password or code field (accessibility §3, "Dialog open: first field"). Focus trapped; on close it returns to the trigger.
- Accessible authentication (3.3.8): no cognitive test, paste and password managers work, show/hide on the password, single OTP field.
- Time limits: none in the dialog. The 5-minute proof lifetime starts after submission and the proof is used at once; if it lapses, the re-prompt is free (2.2.1 satisfied by restart).
- DOM, visual and focus order are the same at every width: Continue, then Cancel (stacked full width at 360; side by side at the inline end at 1280), matching the idle dialog (W00 §2.1). Targets 44 px on coarse pointers.
- i18n: `reauth` namespace in `packages/ui` (content §4.10). Errors use the shared `errors:` keys.
