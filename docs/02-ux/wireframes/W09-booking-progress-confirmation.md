# W09 — Booking progress and confirmation (S-B07, schedule-pickup dialog)

Route `/orders/{orderId}/confirmation` · Permission `shipment:read` (+ `document:download`, `pickup:schedule`) · Stories: **US-195, US-204, US-205, US-206, US-207, US-214, US-223, US-224, US-225, US-226, US-235, US-236, US-072** · US-188, US-228, US-239 (Should) · Flows: [F03 §3–§5](../flows/F03-checkout-3ds-confirmation.md)

**Data needed:** order (number, paid amount and currency, gateway mode), per shipment: saga step status (authorise, create carrier shipment, capture, documents, pickup, notify), canonical status, carrier and service, tracking number, documents (type, version, format, size, status CURRENT/VOID/PENDING), pickup (reference, local date, window, zone, instructions) or drop-off (point snapshot, latest drop-off time, what to bring), failure codes, and paperless outcome (Should).

## 1. Progress state (D-UX-007)

### 360 px
```
| # Booking your shipment              |
| Order US-000000123                   |
| (flask) Test mode                    |
| Keep this page open. It takes about  |
| a minute.                            |
| +----------------------------------+ |
| | ✓ Payment authorised             | |  ProgressSteps (saga)
| | ◌ Booking with DHL Express       | |  "In progress" text
| | · Taking payment                 | |  "Pending"
| | · Preparing documents            | |
| | · Scheduling pickup              | |
| | · Sending confirmation email     | |
| +----------------------------------+ |
| You won't be charged unless the      |
| carrier confirms your booking.       |
```
1280: the same list in the main column (720), with the order summary on the right.

When the page is closed during progress, the booking continues and the user gets the email. The account shipment detail shows the same status. This is stated under the list.

## 2. Confirmation (LABEL_READY, pickup scheduled)

### 360 px
```
| (check-circle)                       |
| # Your shipment is booked            |  focus moves here; polite announcement
| Order US-000000123  [Copy]           |
| Paid USD 65.00 · (flask) Test mode   |
|                                      |
| +----------------------------------+ |
| | (DH) DHL Express Worldwide       | |
| | [✓ Label ready]                  | |  StatusBadge
| | Tracking number                  | |
| | 1234567890  [Copy]  <Track>      | |
| |                                  | |
| | ## Documents                     | |
| | Shipping label (PDF)  [Download] | |
| | Commercial invoice (PDF)         | |
| |                       [Download] | |
| | [Email me the documents]*        | |  Should US-228
| |                                  | |
| | ## Pickup                        | |
| | Tue 17 Nov 2026                  | |
| | 13:00–17:00 EST                  | |
| | Reference PRN-55821  [Copy]      | |
| | Driver note: Ring the bell...    | |
| +----------------------------------+ |
|                                      |
| ## What to do next                   |
| 1. Print the label and attach it to  |
|    the parcel.                       |
| 2. Print 2 copies of the commercial  |
|    invoice and put them in the       |
|    pouch on the parcel.              |
| 3. Have the parcel ready for the     |
|    driver on Tue 17 Nov, 13:00–17:00.|
|                                      |
| [View shipment]  <Book another>      |
| We've emailed the confirmation to    |
| ana@example.com.                     |
```

### 1280 px
```
| # Your shipment is booked                                       | Order US-000000123 [Copy] |
| Order summary line + Test mode                                  | Paid USD 65.00            |
| +-------------------------------------------------------------+ | (flask) Test mode         |
| | DHL Express Worldwide   [Label ready]   Tracking 1234567890 | | [View shipment]           |
| | Documents (table): Type | Version | Format | Size | Status | [Download] |  <Book another> |
| | Pickup: Tue 17 Nov 2026, 13:00–17:00 EST · Ref PRN-55821     | |                           |
| +-------------------------------------------------------------+ |                           |
| ## What to do next (numbered list)                              |                           |
```

### Variants
```
Drop-off (US-239):
| ## Drop off                                          |
| Express Service Point — Chelsea                      |
| 214 W 23rd St, New York · Open today 08:00–19:00     |
| Drop off by 17:00 for dispatch today.                |
| Bring: printed label, 2 invoice copies, photo ID.    |

Pickup failed (US-235, PICKUP_UNAVAILABLE):
| ! We couldn't book a pickup with DHL for this date.  |
|   Your shipment is booked and paid. Choose another   |
|   pickup time or drop it off.                        |
|   [Schedule pickup]  <Find a drop-off point>*        |

Documents still preparing (US-223, US-224):
| ## Documents                                         |
| Documents are being prepared…  (row skeletons)       |
|  updates without reload; announced "Shipping label ready" |

Paperless customs (Should, US-188):
| ✓ We've sent your invoice to DHL electronically. You  |
|   don't need to print it.                             |
 or on failure: "Print 2 copies of the invoice." (default instructions)

Booking failed, definitive carrier rejection (US-204):
| X We couldn't book this shipment with DHL Express.   |  role=alert
|   You haven't been charged. The hold on your card    |
|   has been released.                                 |
|   Reason: The carrier couldn't accept this address.  |  canonical reason, localised
|   [Choose another service]  <Edit addresses>         |

Ambiguous outcome (US-205, EXCEPTION):
| ! We're still confirming your booking with DHL.      |
|   You haven't been charged yet. We'll email you when |
|   it's confirmed or released.  [View shipment]       |

Multi-shipment, partly booked (US-206):
| Shipment 1  DHL  [Label ready]  ...                  |
| Shipment 2  FedEx [Not booked] We couldn't book this |
|   shipment. You weren't charged for it. [Choose another service] |
| Paid USD 55.20 (for 1 of 2 shipments)                |
```

### Schedule pickup dialog (US-236)
```
| Schedule a pickup                               [X] |
| Times are local to 10001 (EST).                     |
| Date   [DateChipList / Calendar]                    |
| Time   (o) Morning ( ) Afternoon ( ) Choose a time   |
| Instructions (optional) [_______________]           |
| [Cancel]                           [Schedule pickup] |
```
Full-screen under 768 px. Errors appear inline (W06 rules). A carrier rejection shows an InlineAlert in the dialog (F03 §4).

## 3. Interaction details

- Status updates arrive from the event stream (polling fallback every 3 s) within 2 s of the server (US-207).
- **Download** button states: idle "Download" → preparing ("Preparing…", aria-busy) → the browser download starts → returns to idle with the status text "Downloaded" for 3 s. Void: disabled with "Void" badge and the reason "This label was cancelled". Without `document:download`, the button is disabled (`aria-disabled`) with "You don't have permission to download" (US-224, US-072). `AUDIT_UNAVAILABLE`: inline "Downloads are paused for a moment. Try again." (US-226).
- The tracking link opens `/{lng}/track?number=…` (public) in the same tab.
- **"Book another"** goes to Home, with the sender details remembered for the next wizard (redundant-entry reduction).

## 4. States

| State | Rendering |
|---|---|
| Loading | First load: the saga list with all steps "Pending" (no skeleton needed); document rows as skeletons |
| Empty | Documents not ready: "Documents are being prepared" (US-224) |
| Error | Stream and poll failure: InlineAlert "We can't show live progress right now. Your booking is still being processed." + Try again + reference. Booking failure: the panel above. |
| Partial | Pickup failed; documents pending; multi-shipment partly booked; paperless upload failed |
| Permission-denied | Without `shipment:read`: PermissionDeniedState. Another organisation: NotFoundState. |
| Offline | Banner "Live progress is paused while you're offline"; resumes and re-syncs on reconnect (US-207) |

## 5. Accessibility

- **Live regions (D-UX-010):** each saga step completion is announced politely ("Booking with DHL Express: done"). A failure is announced assertively once. The final success moves focus to the `h1` "Your shipment is booked".
- ProgressSteps: an ordered list. Each item's status is text, not icon only ("Done", "In progress", "Pending", "Failed").
- Order number and tracking number: mono, CopyButton with the accessible name "Copy tracking number 1234567890". Each is also visible as text (never toast-only, US-105).
- The documents table at ≥ 768 px has a caption "Documents for shipment 1". Download buttons are labelled "Download shipping label, PDF, version 1".
- "What to do next" is an `ol`. The instructions come from i18n keys, with the copy count from carrier data.
- The Test mode badge is text plus icon (US-214).
