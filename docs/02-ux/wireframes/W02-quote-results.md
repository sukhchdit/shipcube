# W02 — Quote results and comparison (S-W02, S-W02s)

Route `/quote/{quoteId}` · Client-rendered · Permission: guest quote token, or a session with `quote:read` · Stories: **US-155, US-156, US-159, US-160, US-161, US-166, US-167, US-168, US-143, US-149** (Must) · US-162, US-163, US-164, US-165, US-169 (Should) · Flow: [F01 §2–§5](../flows/F01-guest-quote-and-compare.md)

**Data needed:** quote (inputs summary, created, expires, state ACTIVE/EXPIRED/CLAIMED, sell currency, FX snapshot timestamp and staleness flag), per-carrier stream status (pending, ok, timeout, error), options (carrier code and name, service name, gross total, charge lines, explanation entries, ETA date, transit days, collection modes, included cover amount, cut-off local time and origin zone, next pickup date, printer requirement, badges computed client-side from returned values per DR-B17 only for ordering), exclusion reasons per carrier (WEIGHT_EXCEEDED, DIMENSION_EXCEEDED).

## 1. Layout

### 360 px
```
+--------------------------------------+
| header                               |
+--------------------------------------+
| <‹ Edit search>                      |
| # Prices for your shipment           |
| US 10001 → IN 400001                 |  SearchSummary (dl)
| Parcel · 1 package · 4.4 lb billable |
| Prices valid until 13 Nov, 14:30 EST |  expiry (absolute)
| [Save]* [Share]*                     |  Should, signed in only
|                                      |
| Sort by [Best value v]  [Filters (0)]*
| Comparing 4 carriers · 2 responded   |  status line (polite live region)
|--------------------------------------|
| +----------------------------------+ |
| | (DH) DHL Express                 | |  CarrierMark (monogram + name)
| | Express Worldwide                | |  service, h3
| | [✓ Cheapest] [>> Fastest]        | |  badges (text + icon); "Provisional" until complete
| |                       $45.20     | |  price, tabular
| | Delivery by Tue 17 Nov           | |
| | 3 business days                  | |
| | Pickup or drop-off               | |
| | Cover included up to $100        | |
| | Book by 17:00 today · 2 h 14 min | |  Countdown
| | Printer needed for label         | |
| | <Price details v>   [ ] Compare* | |  disclosure + Should checkbox
| | [      Book this service      ]  | |
| +----------------------------------+ |
| +----------------------------------+ |
| | ▒▒▒▒▒▒▒▒▒   (skeleton card)      | |  one per pending carrier
| +----------------------------------+ |
| ! UPS didn't respond in time.        |  inline per-carrier notice
|--------------------------------------|
| [ 2 selected   [Compare] ]*          |  sticky compare tray (Should)
+--------------------------------------+
```

### 1280 px
```
+------------------------------------------------------------------------------------------------+
| header                                                                                          |
+------------------------------------------------------------------------------------------------+
| # Prices for your shipment                                                                      |
| +-----------------------------+  +-----------------------------------------------------------+ |
| | Your shipment               |  | Comparing 4 carriers · 3 responded            Sort [Best value v] |
| | US 10001 → IN 400001        |  | ! Some carriers didn't respond. Prices shown are from 3 of 4.   | |
| | Parcel · 1 package          |  |-----------------------------------------------------------| |
| | 4.4 lb billable             |  | (DH) DHL Express  Express Worldwide   [Cheapest][Fastest]  | |
| | Valid until 13 Nov 14:30 EST|  |   Delivery by Tue 17 Nov · 3 days  Pickup or drop-off      | |
| | <Edit search>               |  |   Cover up to $100 · Book by 17:00 (2 h 14 min) · Printer  | |
| |                             |  |   <Price details v>  [ ] Compare            $45.20 [Book]  | |
| | Filters (Should)            |  |-----------------------------------------------------------| |
| |  Carrier  [x]DHL [x]FedEx.. |  | (FX) FedEx  International Priority                        | |
| |  Speed    ( )Express ...    |  |   ...                                       $52.10 [Book]  | |
| |  Collection [ ]Drop-off     |  |-----------------------------------------------------------| |
| |  Features [ ]No printer     |  | ▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒▒ skeleton row (UPS pending)                 | |
| |  <Reset filters>            |  |                                                           | |
| | [Save]* [Share]*            |  |                                                           | |
| +-----------------------------+  +-----------------------------------------------------------+ |
+------------------------------------------------------------------------------------------------+
side column 360 px (sticky), list column fluid; result rows are cards in a list (ul > li > article)
```

### Price details (expanded inside a card; both sizes)
```
| Price details                                        |
| Shipping                                             |
|   Base freight                              $38.00   |
|   Fuel surcharge (12.5%)                     $4.75   |
|   Remote area surcharge                      $2.10   |
| Protection                                           |
|   Included cover (up to $100)                $0.00   |
| Subtotal before tax                         $44.85   |
| Sales tax  [Unreviewed]                      $0.35   |
| ---------------------------------------------------- |
| Total                                       $45.20   |
| Converted from EUR at 1 EUR = 1.0832 USD,            |
| rate of 12 Nov 2026, 09:00 UTC                       |
| <Why this price? v>                                  |
|   · Standard margin applied for this route           |
|   · Fuel surcharge for November 2026                 |
```
Amounts are rendered verbatim from stored charge lines. There is no browser arithmetic (US-159). A stale FX snapshot (> 30 days) appends "Converted amounts are indicative".

### Expired and re-quote (US-167)
```
+--------------------------------------------------------------+
| ! These prices expired at 13 Nov, 14:30 EST.                 |
|   Prices can change. Get new prices to continue.             |
|   [Get new prices]                                           |
+--------------------------------------------------------------+
cards: price struck through visually + text "Expired"; "Book this service" replaced by nothing
after re-quote, on the previously chosen service:
| Price changed: was $23.00, now $24.50 (+$1.50)               |  status.warning InlineAlert in card
if the service is gone:
| ! DHL Express Worldwide isn't available now. Choose another option below. |
```

### Compare dialog (Should, US-163)
```
360: Dialog full-screen; options stacked (one section per option, same field order)
1280: Dialog (max 960) table:
|                  | DHL Express Worldwide | FedEx Intl Priority | UPS Saver   |
| Price            | $45.20                | $52.10              | $49.00      |
| Delivery         | Tue 17 Nov            | Mon 16 Nov          | Wed 18 Nov  |
| Transit          | 3 days                | 2 days              | 4 days      |
| Collection       | Pickup, drop-off      | Pickup              | Pickup      |
| Cover included   | $100                  | $100                | $100        |
| Surcharges       | Fuel, remote area     | Fuel                | Fuel        |
|                  | [Book]                | [Book]              | [Book]      |
```

## 2. Components

`SearchSummary`, Select (sort), `ResultCard` (Card interactive, CarrierMark, Badge, MoneyAmount, DateValue, Countdown, Collapsible + PriceBreakdown, Checkbox, Button lg), Skeleton (ResultCard-shaped), InlineAlert (partial, expired, per-carrier notices), BottomSheet (filters < 1024, Should), Dialog (compare, share), StickyActionBar variant (compare tray), Announcer.

## 3. Interaction details

- **Streaming insertion (D-UX-008):** before the user interacts with the list, results insert in sort position as they arrive. Once focus or a pointer is inside the list, new results queue behind a button "Show 2 new results" at the top of the list, announced politely. The focused card never moves (US-161). Activating the button inserts them and keeps focus on the button's replacement heading.
- **Badges:** "Cheapest" and "Fastest" are recomputed as results arrive. Until `complete` or 5 s, each badge has a "Provisional" suffix in text ("Cheapest so far"). The suffix is removed at completion (US-161).
- **Sort:** Best value (default), Cheapest, Fastest. Changing the sort re-orders and announces "Sorted by cheapest". Focus stays on the Select. An invalid `sort` in the URL silently falls back to Best value.
- **Countdown:** origin-local cut-off. After the cut-off it reads "Next pickup Wed 18 Nov" and the delivery date updates from the server values (no client calculation beyond display).
- **"Printer needed for label"** shows unless the service supports QR or label-free drop-off, which shows "No printer needed" with the printer-off icon (US-159).
- **Book:** guest → sign-in gate with BookingContextCard; signed in → `/book/new?quote&option`. Disabled with a reason when offline or expired.
- **Hover (hover:hover):** card lifts 2 px with `shadow.e2` and a start-edge accent border. Touch and keyboard users get the same affordance from the visible "Book this service" button and focus ring.
- **Currency switcher (Should):** converted amounts read "approx. ₹3,780" next to the sell-currency price, which always remains visible.

## 4. States

| State | Rendering |
|---|---|
| Loading | Summary renders from the quote immediately. One skeleton card per pending carrier (count equals pending carriers) after 150 ms. Status line "Comparing {total} carriers · {done} responded". |
| Empty | No service fits the limits: EmptyState "No services can carry this shipment", followed by per-carrier reasons ("DHL Express: too heavy, maximum 70 kg per package") and actions "Edit packages", hint "Try splitting into more packages" (US-156, US-160). Filters hide everything (Should): "No options match your filters. {count} hidden" + "Reset filters". |
| Error | Every carrier failed or a 5xx: ErrorState "We couldn't get prices right now" + "Try again" (new rate request on the same inputs) + correlation ID. No skeletons remain. |
| Partial | One or more carriers timed out or errored: inline notice in place of that carrier's skeleton ("UPS didn't respond in time") plus a page banner "Some carriers didn't respond. Prices shown are from 3 of 4." Results stay bookable (US-160, EC-B01). |
| Permission-denied | Wrong or missing guest token (404) or a role without `quote:read` (403): PermissionDeniedState variant "This quote isn't available. It may belong to another account or the link may be incomplete." + "Start a new quote". Sort and filter controls are not rendered (US-161). |
| Offline | OfflineBanner. Received results stay. "Book" and "Get new prices" are `aria-disabled` with the reason. The stream reconnects on `online`, or the client polls. |
| Expired | Expired banner + per-card "Expired". Book replaced; "Get new prices" (US-159, US-167). |
| Rate-limited (re-quote) | InlineAlert "You've requested a lot of quotes. Try again in {seconds} seconds." |

## 5. Accessibility

- Headings: `h1` page title; visually hidden `h2` "Your shipment" and `h2` "Options"; each card title is an `h3` (carrier + service). Results are a `ul` (`aria-labelledby` the Options heading, `aria-busy` while pending).
- **Live regions (D-UX-010):** one polite region announces streaming progress, throttled to at most one message every 2 s: "2 of 4 carriers responded, 5 options". Completion: "All carriers responded, 7 options. Cheapest {price} with {carrier}." Partial: "3 of 4 carriers responded. UPS didn't respond." These messages are not repeated on re-sort.
- Badges: text plus icon; the icon is `aria-hidden`, so the text is read ("Cheapest").
- Price details: a disclosure button with `aria-expanded` and `aria-controls`. Focus stays on the button. The breakdown is a `table` with a caption "Price details for DHL Express Worldwide".
- Countdown: no live announcements. The text contains the absolute time.
- "Book this service" accessible name includes the option: "Book DHL Express Worldwide, $45.20" (visually hidden suffix).
- Compare checkbox label: "Compare DHL Express Worldwide". At the limit, the message is inline (`role="status"`) next to the checkbox.
- Compare dialog: Radix Dialog, a table with row headers (`th scope="row"`). At 360 px, stacked sections (no horizontal scroll needed, D-UX choice per US-163).
- Focus never jumps on arrival (WCAG 3.2.2 / US-161).

## 6. Shared quote view (Should, S-W02s, `/q/{shareToken}`)

Same card layout, read-only. There is no Book, Save or Compare. It shows countries and cities, packages, content type, options and prices, with a banner "This is a shared quote. Prices are valid until {time}." Expired: "This quote has expired" + [Get a new quote] with the inputs prefilled (EC-B29). No postcodes, names or references appear.

## 7. i18n keys (examples)

`results:meta.title`, `results:summary.route` (`{originCountry} {originPostcode} → …`), `results:summary.validUntil` (`{datetime}`), `results:status.progress` (ICU plural on `{done}` of `{total}`), `results:status.complete`, `results:banner.partial`, `results:card.badge.cheapest`, `results:card.badge.fastest`, `results:card.badge.cheapestProvisional`, `results:card.badge.fastestProvisional` (separate keys, never "{badge} so far" concatenation), `results:card.delivery` (`{date}`), `results:card.transitDays` (ICU plural), `results:card.collection.pickupOrDropoff`, `results:card.cover` (`{amount}`), `results:card.cutoff` (`{time}`, `{remaining}`), `results:card.printer.required`, `results:card.printer.notRequired`, `results:card.book`, `results:breakdown.*`, `results:expired.*`, `results:requote.priceChanged` (`{old}`, `{new}`, `{diff}`), `results:empty.limits.*`, `results:compare.*`.
