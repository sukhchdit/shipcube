# F06 — Staff sign-in with TOTP → audit viewer

Stories: **US-017, US-022, US-023, US-024, US-025, US-030, US-031, US-032, US-097, US-098, US-093, US-110, US-070, US-027** (Must; S-D08 flow in F05 §5) · US-099, US-033 (Should) · Screens S-D01..S-D08 · Exit demo PRD §6.1

## 1. Staff sign-in

```mermaid
flowchart TD
  A0["Any admin URL without session"] --> A1["/sign-in?returnUrl=path (same-origin only)"]
  A1 --> A2["Email + password"]
  A2 --> A3{"Response"}
  A3 -->|"401 INVALID_CREDENTIALS (incl. customer account, NOT_STAFF)"| A4["Alert: Email or password is incorrect"]
  A3 -->|"429 ACCOUNT_DELAYED"| A5["Alert with countdown; submit re-enables"]
  A3 -->|"429 ACCOUNT_LOCKED"| A6["Alert: locked until time"]
  A3 -->|"429 RATE_LIMITED"| A7["Alert with retry time"]
  A3 -->|"401 MFA_REQUIRED"| B0["/sign-in/verify: authenticator code"]
  A3 -->|"signed in but MFA_ENROLMENT_REQUIRED"| C0["/mfa/enrol (F09)"]
  B0 --> B1{"Code"}
  B1 -->|valid| B2{"audit:read?"}
  B1 -->|"Use a recovery code"| B3["Recovery code input (text)"] --> B1
  B1 -->|"401 MFA_INVALID"| B4["Inline error, focus stays, field cleared"]
  B1 -->|"429 MFA_LOCKED"| B5["Alert with time; input disabled"]
  B1 -->|"challenge expired (5 min) / TOKEN_INVALID"| B6["Alert: sign-in timed out. Start again (back to /sign-in, email kept)"]
  B2 -->|Yes| D0["/audit or returnUrl"]
  B2 -->|No| D1["/ Welcome: name, roles, My sessions link<br/>or empty: Contact your administrator"]
  C0 --> B0
```

## 2. Audit viewer

```mermaid
flowchart TD
  D0["/audit"] --> E1{"audit:read?"}
  E1 -->|No| E2["Permission-denied in shell, no request made; no Audit entry in sidebar"]
  E1 -->|Yes| E3["Default: last 24 h, newest first, 50 per page<br/>chain verification chip: Verified at time / Broken at entry / Not yet verified"]
  E3 --> E4["Filter bar: date range, user, role, organisation, entity, entity ID, action, IP, outcome"]
  E4 --> E5["Apply: URL query updated, results count announced"]
  E5 --> E6{"Response"}
  E6 -->|"400 RANGE_TOO_LARGE"| E7["Inline error on date range (max 31 days)"]
  E6 -->|"400 INVALID_CURSOR"| E8["Notice: page link expired; restart from first page"]
  E6 -->|"503 AUDIT_UNAVAILABLE"| E9["Error state: audit log temporarily unavailable (fail-closed)"]
  E6 -->|"0 rows"| E10["Empty: No entries match. Clear filters (resets to 24 h)"]
  E6 -->|rows| E11["Table (768+) / cards; Next and Previous"]
  E11 --> E12["Open entry: /audit/entries/id"]
  E11 -.xl Should.-> E13["Preview in side panel; Open full entry"]
  E12 --> F0["Entry detail: all fields, diff (side by side at 1024+, stacked below),<br/>REDACTED markers, previous and entry hashes; read-only"]
  F0 --> F1["View history of this record: /audit/entities/entity/id"]
  F1 --> F2{"Entries?"}
  F2 -->|No| F3["Empty: no history for this record"]
  F2 -->|Yes| F4["Oldest to newest; links to each entry"]
  D0 -.URL with invalid filter e.g. from=not-a-date.-> G0["Value ignored with inline notice; no request uses it"]
```

## 3. Staff session limits (US-033 Should; WCAG 2.2.1)

```mermaid
flowchart LR
  H0["Absolute cap reached in 5 min"] --> H1["Non-modal warning banner (role=status):<br/>Your session ends at time for security. Save your place: filters are in the URL.<br/>Sign in again now"]
  H1 -->|cap reached| H2["Redirect to /sign-in?returnUrl=current URL; message: Your session ended"]
```

## 4. Idle timeout (US-033 Should; REQ-ADMIN-004; ADR-0026 am. 8; W00 §2.1)

```mermaid
flowchart TD
  I0["Any authenticated admin route"] --> I1["Shared idle clock (all admin tabs):<br/>reset only by pointerdown, keydown, touchstart, wheel"]
  I1 -->|"28:00 without input"| I2["alertdialog in every tab: Are you still there?<br/>sign-out time shown; focus on Extend session;<br/>background refetches paused"]
  I2 -->|"Extend session or Escape"| I3["POST /auth/refresh"]
  I3 -->|OK| I4["Clock reset in all tabs; dialog closes;<br/>announce Session extended; focus restored"] --> I1
  I3 -->|"401 SESSION_EXPIRED / SESSION_REVOKED"| I7
  I3 -->|"network / offline"| I5["Error inside dialog; Extend stays available;<br/>countdown continues"] --> I2
  I2 -->|"29:00"| I6["Polite announcement: 1 minute left"]
  I2 -->|"Sign out"| I8["Standard sign-out (US-019); all tabs cleared; /sign-in"]
  I2 -->|"30:00 without Extend"| I7["Stop silent refresh; logoutSession (keepalive);<br/>clear memory and query cache; broadcast to tabs;<br/>/sign-in?reason=idle&returnUrl=current path"]
  I1 -.->|"tab wakes from sleep at 30:00 or later"| I7
  I7 --> I9["S-D01 notice: You were signed out for inactivity.<br/>After sign-in and MFA, returnUrl restores the same view"]
```

Server side, the 30-minute sliding admin refresh TTL (ADR-0006 am. 13) ends the session even if the tab is suspended or its script is blocked; the client path above is the user-facing half.
