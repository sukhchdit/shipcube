# W15 — Admin sign-in, MFA challenge and enrolment (S-D01, S-D02, S-D03)

Routes (admin app) `/sign-in`, `/sign-in/verify`, `/mfa/enrol` · Client-rendered only, `noindex` · Stories: **US-017, US-022, US-023, US-024, US-025, US-030, US-031** · US-033 (Should) · Flows: [F06 §1](../flows/F06-staff-signin-totp-audit.md), [F09](../flows/F09-mfa-enrolment.md)

The layout matches W03 (a centred 480 px card) inside a minimal admin header (brand + "Admin", language, theme). There is no sidebar before sign-in. A "Staff sign-in" label distinguishes it from the customer app.

## 1. Staff sign-in (S-D01)

```
360 / 1280 (same card, centred)
+--------------------------------------+
| {Logo} Admin       [English v][theme]|
+--------------------------------------+
| # Staff sign-in                      |
| (i) Your session ended. Sign in      |   only after expiry or revocation
|     again.                           |
| ! Email or password is incorrect.    |   alert (focused)
| Email                                |
| [________________________________]   |
| Password                             |
| [__________________________][Show]   |
| [            Continue            ]   |
| <Forgot your password?>              |
+--------------------------------------+
```
- Errors exactly as W03 §1: `INVALID_CREDENTIALS` also covers customer accounts (US-030, NOT_STAFF internal), `ACCOUNT_DELAYED` (countdown), `ACCOUNT_LOCKED`, `RATE_LIMITED` (US-031: "the localised RATE_LIMITED message with the retry time").
- The return URL is kept (same-origin path only).

## 2. MFA challenge (S-D02)

```
| # Enter your verification code       |
| Step 2 of 2                          |
| Code from your authenticator app     |
| [ ______ ]                           |  single field, numeric, one-time-code
| [            Sign in             ]   |
| <Use a recovery code instead>        |
| <Start again>                        |
```
- `MFA_INVALID`: inline "That code didn't work. Use the current code from your app." The field is cleared and focus stays.
- `MFA_LOCKED`: alert "Too many incorrect codes. You can try again at {time}." The field and button are disabled with the reason.
- Drifting device clock (US-024): after 2 consecutive `MFA_INVALID`, the hint "Codes depend on your phone's clock. Make sure it's set automatically." is added, and the recovery code link is emphasised.

## 3. Mandatory enrolment (S-D03)

### Step 1 — Set up
```
360                                          1280
| # Set up two-step verification       |   | # Set up two-step verification                         |
| Step 1 of 3                          |   | Step 1 of 3                                             |
| Staff accounts need a code from an   |   | +------------------+  1. Open your authenticator app.  |
| authenticator app to sign in.        |   | |                  |  2. Scan this QR code, or enter    |
| +------------------+                 |   | |    [QR 192px]    |     the setup key.                 |
| |    [QR 192px]    |                 |   | |                  |  Setup key                         |
| +------------------+                 |   | +------------------+  JBSW Y3DP EHPK 3PXP [Copy]        |
| Can't scan it? Enter this key:       |   |                       Account: sam@operator.example    |
| JBSW Y3DP EHPK 3PXP  [Copy]          |   |                       [Next]                           |
| [Next]                               |
```
QR alt text: "QR code to add {BRAND_NAME} to your authenticator app". The key is shown in groups of 4 in mono, and copying copies it without spaces. No app brand names appear in the copy ("an authenticator app").

### Step 2 — Confirm
```
| # Enter the code from your app       |
| Step 2 of 3                          |
| [ ______ ]                           |
| [Verify]   <Back>                    |
```
`MFA_INVALID` → inline error. `TOKEN_EXPIRED` (15 min) → "Setup timed out. [Start again]" with a new QR.

### Step 3 — Recovery codes (shown once)
```
| # Save your recovery codes           |
| Step 3 of 3                          |
| Use one of these if you lose your    |
| phone. Each code works once. You     |
| won't see them again.                |
| +----------------------------------+ |
| | 4F7K-9QWZ-2M   8HDX-3PLA-7R       | |  CodeBlock grid, mono, 2 columns (1 column < 360)
| | ... (10 codes)                   | |
| +----------------------------------+ |
| [Copy all] [Download .txt] [Print]   |
| +----------------------------------+ |
| | [ ] I've saved my recovery codes | |  CheckboxCard
| |     somewhere safe.              | |
| +----------------------------------+ |
| [Continue]  (aria-disabled until ticked, with reason) |
```
- Leaving before acknowledgement (in-app navigation, closing the tab, browser back) prompts: an AlertDialog for in-app navigation, "Leave without saving your codes? You won't be able to see them again." with "Stay" (default) and "Leave"; plus the `beforeunload` prompt for tab close (US-031).
- "Download .txt" builds a Blob client-side with a localised header line and the codes, and makes no server call. "Print" uses a print stylesheet that shows only the codes and the header.

## 4. States (all three)

| State | Rendering |
|---|---|
| Loading | Submit button loading. Enrolment start: a fixed 192 px QR placeholder with "Preparing your setup code" text. |
| Empty | Not applicable (US-031) |
| Error | Alert + reference (5xx). QR render failure: the key is shown with "Enter this key manually" (partial). |
| Partial | Not applicable except the QR fallback above (US-031 says partial is n/a; the fallback is a degraded success) |
| Permission-denied | "Admission refused" is presented as `INVALID_CREDENTIALS` (no staff-existence leak, US-030). A staff user in an enrolment-only session hitting any other route is redirected to enrolment with the InlineAlert "Finish setting up two-step verification to continue". |
| Offline | Banner + Retry; submit disabled with reason (US-031) |

## 5. Accessibility

- Single `h1` per step, with step numbering as text ("Step 1 of 3") in a paragraph associated with the `h1` via `aria-describedby`.
- Focus moves to the `h1` on each step. Errors move focus to the alert.
- Recovery codes: the CodeBlock is a `region` labelled "Recovery codes", and each code is a list item, so screen readers can read them one by one. Copy all announces "10 codes copied".
- The 3.3.8 accessible authentication rules from W03 apply. The OTP field allows paste. No time pressure applies beyond the 5-minute challenge, which is restartable, and the 15-minute enrolment, which is restartable with a new QR.
- Language switch is available before sign-in (the locale cookie for the admin app).
