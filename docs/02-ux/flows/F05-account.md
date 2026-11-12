# F05 — Customer account: shipments, detail, drafts, sign-out

Stories: **US-254, US-255, US-256, US-257, US-251, US-224, US-236, US-019, US-070, US-027** (Must; US-027 since D-047) · US-258, US-261/US-196, US-260, US-267 (Should) · Screens S-C01..S-C04, S-C07 (sessions section), S-D08

## 1. Find and open a shipment

```mermaid
flowchart TD
  A0["Account menu: Shipments"] --> A1{"shipment:read?"}
  A1 -->|No| A2["Entry absent; direct URL: permission-denied"]
  A1 -->|Yes| A3["/account/shipments: 25 newest, table (768+) or cards"]
  A3 --> A4["Search: tracking no., order no., reference, receiver name"]
  A3 --> A5["Filters: status, carrier, direction, destination, created range"]
  A4 --> A6["URL query updated; results count announced"]
  A5 --> A6
  A6 --> A7{"Result"}
  A7 -->|"0 items, no filters"| A8["Empty: No shipments yet. Get a quote"]
  A7 -->|"0 items with filters"| A9["Empty: No shipments match. Clear filters"]
  A7 -->|"400 VALIDATION_ERROR (bad URL value)"| A10["Value dropped, inline notice, list reloads"]
  A7 -->|items| A11["Next / Previous (cursor)"]
  A11 --> A12["Open shipment"]
  A12 --> B0["/account/shipments/id"]
  B0 --> B1{"Response"}
  B1 -->|"404 cross-tenant or unknown"| B2["Not-found state"]
  B1 -->|"503 AUDIT_UNAVAILABLE"| B3["Error state: this page is temporarily unavailable. Try again"]
  B1 -->|OK| B4["Status, actions, tracking timeline, charges,<br/>parties (references masked), contents, collection,<br/>documents, payment summary (payment:read only)"]
  B4 --> B5{"Section failures"}
  B5 -->|"tracking unavailable"| B6["Partial notice in tracking section + Try again"]
  B5 -->|"documents generating"| B7["Documents: Preparing; updates without reload"]
  B4 --> B8["Actions: Download, Schedule pickup (LABEL_READY without pickup),<br/>Track publicly, Copy tracking no.; Should: Repeat, Cancel"]
```

## 2. Drafts: resume and delete (US-256)

```mermaid
flowchart TD
  D0["/account/drafts"] --> D1{"Any drafts?"}
  D1 -->|No| D2["Empty: No drafts. Get a quote"]
  D1 -->|Yes| D3["List: route, step reached (Step 3 of 7 Collection), last edited, expires in N days"]
  D3 --> D4["Resume"] --> D5["Wizard at first incomplete step (F02 §2)"]
  D3 --> D6["Delete"] --> D7["AlertDialog: Delete this draft? This can't be undone. Cancel / Delete draft"]
  D7 -->|confirm| D8{"Response"}
  D8 -->|OK| D9["Row removed; toast Draft deleted; focus to next row or list heading"]
  D8 -->|"409 ILLEGAL_STATE_TRANSITION"| D10["Toast error: this shipment is no longer a draft; list refreshes"]
  D8 -->|"403"| D11["Not offered to Viewers (absent)"]
```

## 3. Cancel a shipment (Should, US-261/US-196; Must parts: US-237 notices)

```mermaid
flowchart TD
  X0["Cancel shipment (only when BOOKED, LABEL_READY or PICKUP_SCHEDULED<br/>and shipment:cancel)"] --> X1["Dialog: reason (required), note (optional, 200 chars),<br/>consequences: label voided, pickup cancelled, full refund to card"]
  X1 --> X2{"Response"}
  X2 -->|OK| X3["Status Cancelled, then Voided, then Refunded (progress in status area)"]
  X2 -->|"409 SHIPMENT_NOT_CANCELLABLE"| X4["Alert: the carrier has already collected this shipment"]
  X3 --> X5{"Pickup cancel failed?"}
  X5 -->|Yes| X6["Warning: A driver may still come to collect. You don't need to hand over the parcel"]
  X3 --> X7{"Void failed (EXCEPTION)?"}
  X7 -->|Yes| X8["Warning: We couldn't complete the cancellation yet. You haven't been refunded. We'll keep trying and email you"]
```

## 4. Sign out (US-019) and session end

```mermaid
flowchart LR
  O0["Account menu: Sign out"] --> O1["Sign out request"] --> O2{"Response"}
  O2 -->|OK| O3["Home page; toast You've signed out"]
  O2 -->|"network error"| O4["Local session cleared anyway; message: You're signed out on this device"]
```

## 5. Where you're signed in: list and remote sign-out (US-027 Must; web S-C07 and admin S-D08; W13 §1, W16 §4)

```mermaid
flowchart TD
  S0["Account nav: Security (web) / sidebar: My sessions (admin)"] --> S1["GET own sessions (one VIEW audit entry)"]
  S1 --> S2{"Response"}
  S2 -->|"401 AUTH_REQUIRED"| S3["Sign-in redirect with returnUrl (F10)"]
  S2 -->|"5xx / network"| S4["Section ErrorState: We couldn't load your sessions. Try again + reference"]
  S2 -->|offline| S5["OfflineBanner; cached list if any; Sign out buttons aria-disabled"]
  S2 -->|OK| S6["List: This device first, then by last active<br/>Device, IP address range, Signed in, Last active"]
  S6 --> S7["Sign out (other row)"]
  S7 --> S8{"Response"}
  S8 -->|OK| S9["Row removed; toast Signed out of device;<br/>focus to next row action or section heading;<br/>that device's tokens fail within 5 s"]
  S8 -->|"404 NOT_FOUND (already ended or not yours)"| S10["Row removed; info toast That session had already ended"]
  S8 -->|"5xx / AUDIT_WRITE_FAILED"| S11["Error toast + reference; row kept"]
  S6 --> S12["Sign out (This device)"] --> S13["Normal sign-out (§4)"]
  S6 --> S14{"Other sessions exist?"}
  S14 -->|No| S15["Text: This is the only device signed in (no button)"]
  S14 -->|Yes| S16["Sign out of all other devices"] --> S17["AlertDialog: Sign out of all other devices?<br/>You'll stay signed in on this device. Cancel (focus) / Sign out other devices"]
  S17 -->|confirm| S18{"Response"}
  S18 -->|OK| S19["Only This device remains; toast Signed out of N other devices"]
  S18 -->|error| S11
  S17 -->|cancel| S6
```

No re-authentication is needed for listing or remote sign-out. A device that was signed out remotely sees the signed-out notice on its next request (F10 §1).
