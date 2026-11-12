# F07 — Password reset (customer and staff)

Stories: **US-021, US-022, US-282** (Must) · Screens S-A04, S-A05, email S-E02 · The staff app uses the same pages under its own origin (a link on S-D01).

```mermaid
flowchart TD
  R0["Sign in: Forgot your password?"] --> R1["/forgot-password: email (prefilled from sign-in form if entered)"]
  R1 --> R2{"Response"}
  R2 -->|"202 (known or unknown email)"| R3["Confirmation: If an account exists for address,<br/>we've sent a link. It expires in 60 minutes.<br/>Didn't get it? Check spam, or send again"]
  R2 -->|"429 RATE_LIMITED"| R4["Alert with retry time"]
  R2 -->|"400 VALIDATION_ERROR"| R5["Inline email error"]
  R3 -.email S-E02.-> R6["/reset-password, token in URL fragment;<br/>page reads then clears the fragment"]
  R6 --> R7["New password + confirm (show/hide, paste allowed)"]
  R7 --> R8{"Response"}
  R8 -->|OK| R9["Success: Password changed. You've been signed out everywhere.<br/>Sign in (email prefilled if known)"]
  R8 -->|"400 PASSWORD_POLICY"| R10["Inline error; token still valid"]
  R8 -->|"410 TOKEN_EXPIRED"| R11["State: This link has expired. Request a new link"]
  R8 -->|"400 TOKEN_INVALID (used, superseded, unknown)"| R12["State: This link is no longer valid. Request a new link"]
  R6 -->|"no token in fragment"| R12
  R8 -->|offline or 5xx| R13["Alert with Try again; fields kept"]
```

| State | Rendering |
|---|---|
| Loading | Submit button loading; no skeleton (static form) |
| Empty | Not applicable |
| Error | Form-level alert with Try again and correlation ID |
| Partial | Not applicable |
| Permission-denied | Not applicable (pre-authentication). Expired and invalid links have explicit states. |
| Offline | Banner; submit disabled with reason |
