# F08 — Email verification

Stories: **US-015, US-016, US-208, US-282** (Must) · Screens S-A02, S-A03, S-B05/S-B06 gate, email S-E01 · Decision D-UX-024 (cross-tab detection)

```mermaid
flowchart TD
  V0["Registered (status PENDING_VERIFICATION)"] --> V1["Header chip and account banner: Verify your email.<br/>Resend"]
  V0 --> V2["Continue booking (steps 1-5 allowed)"]
  V2 --> V3["Review: warning banner, non-blocking"]
  V3 --> V4["Continue to payment: 403 EMAIL_NOT_VERIFIED panel"]
  V1 --> V5["Resend"]
  V4 --> V5
  V5 --> V6{"Response"}
  V6 -->|202| V7["Status: We've sent a new link to address. Earlier links no longer work"]
  V6 -->|"429 (4th in an hour)"| V8["Alert: You can request another link at time"]
  V7 -.email S-E01.-> V9["/verify-email, token in fragment"]
  V9 --> V10{"Redeem"}
  V10 -->|200| V11["Success: Email verified.<br/>If signed in: Continue where you left off (returns to last booking step or checkout).<br/>If not: Sign in"]
  V10 -->|"410 TOKEN_EXPIRED"| V12["This link has expired. Send a new link (requires sign-in) or Sign in"]
  V10 -->|"400 TOKEN_INVALID"| V13["This link is no longer valid (used or replaced). Send a new link"]
  V11 -.broadcast to other tabs of same browser.-> V14["Original tab: banner turns to success, gate re-checks automatically"]
  V4 --> V15["I have verified: re-check status"]
  V15 -->|"verified"| V16["Checkout proceeds"]
  V15 -->|"still unverified"| V17["Message: not verified yet. Check the latest email"]
```

Cross-tab detection: when verification succeeds in another tab of the same browser, a same-origin `BroadcastChannel` message (no token, only "verified") makes the waiting tab re-fetch the user's status (D-UX-024). When verification happens on another device, the "I have verified" action re-checks.

| State | Rendering |
|---|---|
| Loading | Token redemption: an "Verifying your email…" status with a skeleton line (no spinner) |
| Empty | Opening `/verify-email` without a token while signed in: "Check your inbox" panel with Resend. Signed out: Sign in. |
| Error | 5xx: error with Try again |
| Partial | Not applicable |
| Permission-denied | Resend without a session prompts sign-in |
| Offline | Banner; actions disabled with reason |
