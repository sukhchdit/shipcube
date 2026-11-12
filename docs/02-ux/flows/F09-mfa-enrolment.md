# F09 — MFA (TOTP) enrolment and recovery codes

Stories: **US-023, US-025, US-031** (Must, staff) · US-026, US-267 (Should, customer optional MFA and settings) · Screens S-D03 (admin), S-C07 (customer, Should)

## 1. Mandatory staff enrolment (first sign-in)

```mermaid
flowchart TD
  M0["Staff signs in with password; account has no TOTP"] --> M1["Session restricted: every route except /mfa/enrol<br/>redirects there (403 MFA_ENROLMENT_REQUIRED)"]
  M1 --> E0["enrolTotp"]
  E0 -->|"OK (local/test, or re-enrolment)"| M2
  E0 -->|"403 MFA_ENROLMENT_CODE_REQUIRED (first enrolment outside local/test)"| E1["Step 1 of 4 Confirm your email:<br/>requestTotpEnrolmentCode sent once (202); code field"]
  E1 --> E2{"enrolTotp with enrolment_code"}
  E2 -->|"403 MFA_ENROLMENT_CODE_REQUIRED"| E3["Inline: That code didn't work or has expired.<br/>Send a new code (60 s cooldown)"] --> E1
  E2 -->|"429 MFA_LOCKED / RATE_LIMITED"| E4["Alert with time; field disabled"]
  E2 -->|OK| M2
  M0 -.->|"no TOTP 24 h after first sign-in (housekeeping)"| E5["Account SUSPENDED (MFA_ENROLMENT_OVERDUE); sessions revoked;<br/>sign-in shows the generic INVALID_CREDENTIALS; reactivation by ops CLI in M1"]
  M2["Step 1 of 3 (or 2 of 4) Set up your authenticator app:<br/>QR code + setup key (copy) + supported app guidance (no brand names)"]
  M2 --> M3["Step 2 of 3 Enter the 6-digit code"]
  M3 --> M4{"Response"}
  M4 -->|"401 MFA_INVALID"| M5["Inline error: That code didn't match. Check the time on your phone and try the current code"]
  M5 --> M3
  M4 -->|"410 TOKEN_EXPIRED (enrolment older than 15 min)"| M6["State: Setup timed out. Start again (new QR)"]
  M6 --> M2
  M4 -->|OK| M7["Step 3 of 3 Save your recovery codes: 10 codes shown once<br/>Copy all, Download .txt, Print"]
  M7 --> M8["Checkbox: I have saved my recovery codes"]
  M8 -->|unticked| M9["Continue aria-disabled with reason"]
  M8 -->|ticked| M10["Continue: sign-in completes with a code<br/>(re-verify per US-025) then landing (F06)"]
  M7 -->|"navigate away / close tab before ack"| M11["Confirmation: Leave without saving codes?<br/>You won't see them again. Stay / Leave"]
```

## 2. Customer optional MFA (Should, US-026, US-267)

```mermaid
flowchart LR
  C0["Security: Two-step verification Off"] --> C1["Turn on"] --> C2["ReauthDialog: password (W03 §8)"] --> C3["Same 3 steps as staff (no e-mail code step for customers)"] --> C4["Status On; recovery codes remaining: 10"]
  C4 --> C5["Turn off"] --> C7["AlertDialog: Turn off two-step verification? Other sessions will be signed out"] --> C6["ReauthDialog: code (scope mfa.totp.disable), opens after the confirmation, right before the request"] --> C8["Status Off; toast"]
  C4 -.2 or fewer codes left.-> C9["Warning: You have 2 recovery codes left. Generate new codes"]
```

| State | Rendering |
|---|---|
| Loading | QR placeholder box of fixed size (no layout shift) with text "Preparing your setup code" |
| Empty | Not applicable |
| Error | Enrolment start fails: error with Try again and correlation ID |
| Partial | QR image fails to render: the setup key is still shown, with the text "Enter this key manually" |
| Permission-denied | Not applicable (own account). A staff "turn off" attempt is not offered (US-026: staff cannot disable). |
| Offline | Banner; code submit disabled with reason. Codes already shown stay visible. |
