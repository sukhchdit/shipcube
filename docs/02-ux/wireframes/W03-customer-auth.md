# W03 — Customer authentication screens (S-A01..S-A06)

Routes `/sign-in`, `/sign-in/verify`, `/register`, `/verify-email`, `/forgot-password`, `/reset-password` · Client-rendered · Permission `public` (pre-authentication) · Stories: **US-015, US-016, US-017, US-020, US-021, US-022, US-024, US-171** (Must) · US-026 (Should) · Flows: [F02 §1](../flows/F02-auth-gate-and-wizard.md), [F07](../flows/F07-password-reset.md), [F08](../flows/F08-email-verification.md)

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
- **Signed-out notice:** shown after `SESSION_REVOKED` or `AUTH_REQUIRED` redirects (US-020).

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
