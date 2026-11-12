# W12 — Shipment detail (S-C03)

Route `/account/shipments/{id}` · Client-rendered · Permission `shipment:read`; sections also need `tracking:read`, `document:read` (list), `document:download` (download), `payment:read` (payment summary), `pickup:schedule` (schedule pickup) · Stories: **US-255, US-251, US-224, US-225, US-226, US-236, US-237, US-243, US-257, US-072, US-150** · US-260, US-261, US-196, US-238 (Should) · Flow: [F05 §1](../flows/F05-account.md)

**Data needed:** shipment (status, state history with timestamps and trigger, order number, tracking number, carrier and service, created by), tracking events (canonical status, carrier original description and code, location, timestamp, ETA, stale flag), charge snapshot (lines, totals, tax metadata, FX line, unreviewed flag), sender and receiver snapshots (tax and identity references masked to the last 2 characters), contents and customs summary (lines, reason, Incoterm, declared value, DG attestation, screening status shown only as text to staff, never to customers), collection (pickup or drop-off details), documents, payment summary (if permitted).

## 1. Layout

### 1280 px
```
| Shipments / US-000000123                                                                     |
| # Shipment to Ravi Kumar, Mumbai                                [Schedule pickup] [More v]  |
| [In transit]  DHL Express Worldwide · Tracking 1234567890 [Copy] <Public tracking page>      |
| Order US-000000123 · Booked 12 Nov 2026, 10:04 EST by Ana Silva                               |
| +---------------------------------------------------+ +-----------------------------------+ |
| | ## Tracking                                        | | ## Documents                      | |
| | Estimated delivery Tue 17 Nov                      | | Shipping label v1 PDF 84 KB       | |
| | Timeline (newest first, viewer zone):              | |   Current  [Download]             | |
| | 16 Nov 09:12 CET · Leipzig, DE · In transit        | | Commercial invoice v1 PDF 40 KB   | |
| |   Carrier: "Processed at LEJ hub" (code PL)        | |   Current  [Download]             | |
| | 15 Nov 22:40 CET · Hamburg, DE · Arrived ...       | | SHA-256 a3f1…9c0e [Copy]          | |
| +---------------------------------------------------+ +-----------------------------------+ |
| | ## Charges (from booking snapshot)                 | | ## Collection                     | |
| | PriceBreakdown table                               | | Pickup Tue 17 Nov, 13:00–17:00 EST| |
| | Total $55.20                                       | | Reference PRN-55821               | |
| +---------------------------------------------------+ +-----------------------------------+ |
| | ## Parties                                         | | ## Payment (payment:read)         | |
| | From (AddressBlock) | To (AddressBlock)            | | Card •••• 4242 · Captured $55.20  | |
| | Receiver ID PAN ••••••••34                         | | 12 Nov 10:04 EST · Test mode      | |
| +---------------------------------------------------+ +-----------------------------------+ |
| | ## Contents and customs                            | | ## History                        | |
| | Gift · 2 items · Declared $62.50 · DAP             | | Label ready  12 Nov 10:05         | |
| | (items table)                                      | | Booked       12 Nov 10:04         | |
| +---------------------------------------------------+ | Paid         12 Nov 10:03         | |
|                                                       +-----------------------------------+ |
```

### 360 px (one column; sections in priority order; long sections collapsible)
```
| <‹ Shipments>                        |
| # Shipment to Ravi Kumar, Mumbai     |
| [In transit]                         |
| DHL Express Worldwide                |
| 1234567890 [Copy] <Track publicly>   |
| [Schedule pickup]  [More v]          |
| ## Tracking  (open by default)       |
| ## Documents (open)                  |
| ## Collection                        |
| ## Charges          [v]              |  Collapsible sections
| ## Parties          [v]              |
| ## Contents         [v]              |
| ## Payment          [v]              |
| ## History          [v]              |
```
Sections are headings with disclosure buttons, not Tabs, so the page stays one readable document and Ctrl+F works. Charge tables collapse to label/amount rows under 768 px (US-255).

## 2. Actions

| Action | Shown when | Behaviour |
|---|---|---|
| Schedule pickup | LABEL_READY, no active pickup, `pickup:schedule` | Opens the schedule dialog (W09) |
| Download (per document) | `document:read`; enabled with `document:download` and status CURRENT | W09 §3 download states |
| Copy tracking number | always | CopyButton |
| Public tracking page | tracking number exists | Link `/{lng}/track?number=` |
| View confirmation | order booked | Link to `/orders/{orderId}/confirmation` (US-195 "reachable later") |
| More v → Repeat this shipment (Should, US-260) | `shipment:create` | Starts a new wizard prefilled (a new quote is required) |
| More v → Cancel shipment (Should, US-261, US-196) | BOOKED, LABEL_READY or PICKUP_SCHEDULED, no pickup scan, `shipment:cancel` | Dialog with reason (required Select: Changed my mind, Booked by mistake, Wrong details, Other) and an optional note (200). The consequences are stated: "We'll cancel the pickup, void the label and refund USD 55.20 to your card." AlertDialog styling. |
| More v → Reschedule pickup (Should, US-238) | active pickup more than 2 h before the window | Same dialog as schedule |

Post-cancellation notices (US-237 Must for the pickup part):
```
| ! A driver may still come to collect this parcel. You don't need to hand it over. |   pickup cancel failed
| ! We couldn't finish cancelling yet. You haven't been refunded. We'll keep trying |   void failed (EXCEPTION)
|   and email you.                                                                  |
| ✓ Cancelled. USD 55.20 will be refunded to your card.                             |   success (refund timing by gateway)
```

## 3. Tracking section (US-251)
- Events newest first. Each shows the canonical description (localised), the carrier's original description in muted text with its code, the location, and the time in the viewer's zone with the zone label.
- **Stale (> 60 days without update, or the stale flag):** warning "We haven't had an update from DHL since {date}."
- No events: EmptyState (small) "No tracking updates yet. Updates appear once the carrier scans your parcel."
- The raw carrier payload and storage paths are never shown (US-251).

## 4. States

| State | Rendering |
|---|---|
| Loading | Header skeleton + section skeletons |
| Empty | Tracking: "No tracking updates yet". Documents: "Documents are being prepared" (updates without reload). |
| Error | Whole page: ErrorState. `AUDIT_UNAVAILABLE` (fail-closed): "This shipment can't be shown right now. Try again in a moment." + reference (US-255). |
| Partial | Tracking unavailable: PartialNotice in the Tracking section with Try again; other sections render (US-255). Document list failed: same, scoped. |
| Permission-denied | Without `shipment:read`: PermissionDeniedState. The Payment section is absent without `payment:read` (not denied, US-255). Download disabled with the reason for Viewers. |
| Not found | Foreign or unknown ID: NotFoundState (US-257) |
| Offline | Banner; actions needing the network disabled with the reason |

## 5. Accessibility

- `h1` names the shipment. Each section is a `section` with an `h2`. On mobile the disclosure button is inside the `h2` (`aria-expanded`).
- Timeline: `ol`, `<time>`. The carrier text is marked as quoted ("Carrier says: …") for clarity.
- The masked receiver ID shows "PAN ending 34" in its accessible name.
- "More" is a DropdownMenu with menu semantics. Destructive items open an AlertDialog with focus on Cancel.
- Download buttons are named by type, format and version. The status text ("Current", "Void") is visible.
- The "Booked by" line shows "Booked by {staff name}" for on-behalf bookings (seam for M2; not reachable in M1).
