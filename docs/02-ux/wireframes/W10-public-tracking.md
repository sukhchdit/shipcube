# W10 — Public tracking (S-W03)

Route `/{lng}/track` (`?number=`) · **Pre-rendered shell** per locale; the result is fetched client-side · Permission `public`, rate-limited · Stories: **US-247, US-248, US-249, US-112, US-243** (stale flag) · US-250 (Should) · Flow: [F04](../flows/F04-public-tracking.md)

**Data needed (public view only, DR-B31):** canonical status, ETA date, carrier name, service name, events (canonical status code, localised description key, timestamp, city, country code), stale flag and last-update time; for an order number, the list of shipments (tracking number, carrier, status). **Never:** names, streets, postcodes, phone, email, references, contents, prices, carrier free text, facility names.

## 1. Layout

### 360 px
```
| # Track a shipment                   |
| Tracking or order number             |
| [1234567890______________] [Track]   |  stacked on very narrow widths
| Find it on your confirmation email   |
| or label.                            |
| (Should) <Use your reference instead>|
|--------------------------------------|
| result region (aria-live polite)     |
| ## DHL Express · Express Worldwide   |
| [arrow-route In transit]             |  StatusBadge
| Estimated delivery Tue 17 Nov        |
| Last update 16 Nov, 09:12 CET        |
|                                      |
| ### Updates                          |
| ● 16 Nov 09:12  Leipzig, DE          |  Timeline, newest first
|   In transit                         |
| ● 15 Nov 22:40  Hamburg, DE          |
|   Arrived at sorting facility        |
| ● 15 Nov 17:05  New York, US         |
|   Picked up                          |
```

### 1280 px
```
| # Track a shipment                                                                           |
| Tracking or order number [1234567890__________________] [Track]                              |
| +---------------------------------------+  +---------------------------------------------+ |
| | DHL Express · Express Worldwide       |  | Updates                                     | |
| | [In transit]                          |  | 16 Nov 2026, 09:12 CET  Leipzig, DE         | |
| | Estimated delivery Tue 17 Nov 2026    |  |   In transit                                | |
| | Last update 16 Nov, 09:12 CET         |  | 15 Nov 2026, 22:40 CET  Hamburg, DE         | |
| +---------------------------------------+  |   Arrived at sorting facility               | |
|                                            +---------------------------------------------+ |
```

### Order number result (several shipments)
```
1280 (table):                                    360 (cards):
| Tracking number | Carrier     | Status     |   | 1234567890                    |
| 1234567890      | DHL Express | In transit |   | DHL Express · [In transit]    |
| 7788990011      | FedEx       | Delivered  |   | <View updates>                |
each row links to ?number=<tracking number>
```

## 2. Interaction details

- **Submit:** trims spaces. An order number pattern with a bad check digit gets the inline error "Check the number. It doesn't look right." without a request (D-032). The URL updates to `?number=` with `replaceState`, so the result is shareable and the back button returns to the previous page.
- **Arriving from a link** (confirmation, email): the lookup runs on load and the field is prefilled.
- **Times** are in the viewer's zone with the zone label (US-116). Event location is "City, CC" or "CC" only (US-248). The country code is also expanded via `Intl.DisplayNames` in the accessible text ("Leipzig, Germany").

## 3. States

| State | Rendering |
|---|---|
| Loading | Result card skeleton (status line + 4 timeline rows) |
| Empty (no search yet) | Form + a helper paragraph: "Enter the tracking number from your label or confirmation email, or your order number (for example US-000000123)." |
| Not found (`TRACKING_NOT_FOUND`) | Neutral InlineAlert (not an error tone): "We couldn't find that number. Check it and try again. New bookings can take up to an hour to appear." Input kept. Identical for unknown, not-yet-trackable and voided numbers (US-247). |
| Error | Network or 5xx: ErrorState in the result region + Try again + reference |
| Partial | Stale flag: warning "Updates from DHL are delayed. Last update {time}." Events with no city show the country only (US-248). |
| Permission-denied (rate limited, 429) | RateLimitedState: "Too many lookups from your network. Try again in {seconds} seconds." The Track button is disabled with the countdown, and the field stays editable (US-248, US-249). |
| Offline | OfflineBanner; the last result stays; Track disabled with the reason |

## 4. Accessibility

- `h1` "Track a shipment". The result `h2` is the carrier and service. "Updates" is an `h3`.
- The result region is `aria-live="polite"`. After a lookup it announces a concise summary: "In transit. Estimated delivery Tuesday 17 November." The full timeline is not announced.
- Timeline: an `ol` with `<time datetime>`. The newest-first order is stated in a visually hidden caption "Newest first".
- Form: `label for`; the hint is linked with `aria-describedby`. `autocomplete="off"` and `spellcheck="false"` on the number field; `inputmode="text"` because order numbers contain letters.
- The pre-rendered HTML has the form with labels and no shipment data (US-247). The page works by keyboard only (US-248).
- Responses carrying a number are `noindex` (header rule for principal-architect, IA §1).
