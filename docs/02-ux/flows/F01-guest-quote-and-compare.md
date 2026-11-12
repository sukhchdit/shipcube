# F01 — Guest quote → results → compare → choose a service

Stories: **US-109, US-155, US-156, US-157, US-158, US-159, US-160, US-161, US-166, US-167, US-168** (Must) · US-162, US-163, US-164, US-165, US-169 (Should) · Screens S-W01, S-W02 · Exit demo PRD §6.2 (first half)

## 0. End-to-end overview of the M1 demo journey (F01 → F02 → F03)

```mermaid
flowchart LR
  A["Home: quote widget S-W01"] --> B["Results stream in S-W02"]
  B --> C{"Signed in?"}
  C -->|No| D["Sign in or register S-A01 / S-A02<br/>quote kept, option kept"]
  C -->|Yes| E["Wizard step 1 S-B01<br/>quote claimed on first save"]
  D --> E
  E --> F["Steps 2-5 S-B02..S-B05"]
  F --> G{"Email verified?"}
  G -->|No| H["Verify email F08<br/>resume at review"]
  H --> I
  G -->|Yes| I["Checkout S-B06<br/>card, 3-D Secure"]
  I --> J["Booking progress S-B07"]
  J --> K["Confirmation: label, invoice,<br/>pickup ref, tracking link"]
```

Detailed flows: this file (quote and results), [F02](F02-auth-gate-and-wizard.md) (gate and wizard), [F03](F03-checkout-3ds-confirmation.md) (checkout, 3DS, progress, confirmation).

## 1. Get a quote (home widget)

```mermaid
flowchart TD
  START["Visitor opens /lng/ (pre-rendered)"] --> FORM["Widget visible before hydration<br/>fields focusable, values survive hydration"]
  FORM --> UNITS["Units default from origin<br/>US = lb/in, else kg/cm"]
  UNITS --> EDIT["Visitor edits route, content type,<br/>residential flag, packages"]
  EDIT --> LIVE["Live volumetric and billable weight<br/>150 ms debounce, polite total announcement"]
  EDIT --> BLUR{"Field valid on blur?"}
  BLUR -->|No| INLINE["Inline error beside field<br/>aria-invalid, aria-describedby"]
  INLINE --> EDIT
  BLUR -->|Yes| EDIT
  LIVE --> SUBMIT["Get quotes"]
  SUBMIT --> ONLINE{"Online?"}
  ONLINE -->|No| OFF["Offline banner, values kept,<br/>submit aria-disabled with reason"]
  OFF -->|connection back| SUBMIT
  ONLINE -->|Yes| CLIENTVAL{"Client validation passes?"}
  CLIENTVAL -->|No| SUMMARY["Focus first invalid field<br/>error summary above form"]
  SUMMARY --> EDIT
  CLIENTVAL -->|Yes| POST["Create quote, button loading, aria-busy"]
  POST --> RESP{"Response"}
  RESP -->|201 created| NAV["Navigate to /quote/quoteId<br/>guest token kept out of the URL"]
  RESP -->|400 VALIDATION_ERROR| MAP["Map pointers to fields<br/>e.g. /destination/postcode"]
  MAP --> SUMMARY
  RESP -->|422 COUNTRY_NOT_SUPPORTED| CNS["Inline error on country"]
  CNS --> EDIT
  RESP -->|429 RATE_LIMITED| RL["Form-level alert with retry time<br/>button re-enables when Retry-After passes"]
  RL --> SUBMIT
  RESP -->|5xx or network error| ERR["Form-level error with correlation ID<br/>and Try again, values kept"]
  ERR --> SUBMIT
```

Notes
- **No JavaScript:** a `<noscript>` message inside the widget explains that getting prices needs JavaScript. The form is still visible and readable (US-158).
- **Rate-relevant fields** are country, postcode or city, content type, residential flag, package weight and dimensions. They exist only here and in wizard step 1 (US-168).

## 2. Results stream, sort, breakdown

```mermaid
flowchart TD
  OPEN["Open /quote/quoteId"] --> AUTHZ{"Access check"}
  AUTHZ -->|"404 (wrong or missing guest token)"| PD1["Permission-denied state<br/>This quote is not available<br/>Start a new quote"]
  AUTHZ -->|"403 AUTHZ_DENIED"| PD2["Permission-denied state"]
  AUTHZ -->|OK| EXP{"Quote expired?"}
  EXP -->|Yes| EXPIRED["Expired notice on every card<br/>Select replaced by Get new prices (F01 §4)"]
  EXP -->|No| SKEL["One skeleton per pending carrier<br/>status line: Comparing N carriers"]
  SKEL --> STREAM{"Event stream connects?"}
  STREAM -->|No: blocked| POLL["Fall back to polling GET<br/>same rendering"]
  STREAM -->|Yes| ARRIVE["Carrier answers: cards replace skeletons<br/>polite announcement throttled to 2 s"]
  POLL --> ARRIVE
  ARRIVE --> INTERACT{"User focus or hover inside the list?"}
  INTERACT -->|No| INSERT["Insert in sort position"]
  INTERACT -->|Yes| PILL["Queue: show N new results button<br/>focused card does not move"]
  PILL -->|activated or focus leaves| INSERT
  INSERT --> DONE{"complete event or 5 s deadline"}
  DONE -->|all OK| FINAL["Badges Cheapest and Fastest final<br/>Provisional label removed"]
  DONE -->|some carriers timed out or failed| PARTIAL["Inline notice per failed carrier<br/>banner: some carriers did not respond<br/>other options stay selectable"]
  DONE -->|every carrier failed| ALLFAIL["Error state with Try again<br/>no skeletons remain"]
  DONE -->|no service matches limits| EMPTY["Empty state: reasons per carrier<br/>WEIGHT_EXCEEDED or DIMENSION_EXCEEDED<br/>Edit packages / split shipment hint"]
  FINAL --> SORT["Sort: Best value default, Cheapest, Fastest"]
  PARTIAL --> SORT
  SORT --> BREAK["Price details disclosure per card<br/>stored charge lines only"]
  BREAK --> PICK["Book this service"]
  ARRIVE -.offline mid-stream.-> OFFL["Offline banner, received results stay<br/>reconnect resumes or polls"]
```

## 3. Compare up to three options (Should, US-163)

```mermaid
flowchart TD
  C1["Tick Compare on a card"] --> C2{"Already 3 selected?"}
  C2 -->|Yes| C3["Inline message beside checkbox:<br/>You can compare up to 3 options<br/>selection stays 3"]
  C2 -->|No| C4["Compare tray updates: N selected<br/>announced politely"]
  C4 --> C5["Open Compare dialog"]
  C5 --> C6["Side-by-side table: price, transit days,<br/>delivery date, cover, collection, surcharges<br/>no new carrier or pricing call"]
  C6 --> C7{"Quote expired while open?"}
  C7 -->|Yes| C8["Readable with expired notice<br/>and Get new prices"]
  C7 -->|No| C9["Book from a column, or close<br/>focus returns to the tray button"]
```

## 4. Expired quote and one-action re-quote (US-167) and rate-relevant change (US-168)

```mermaid
flowchart TD
  E0["User acts on an expired quote<br/>results, review or checkout returns 409 QUOTE_EXPIRED"] --> E1["Expired notice: Prices expired at time.<br/>Get new prices"]
  E1 --> E2["Re-quote with same inputs<br/>new quote created, old unchanged"]
  E2 --> E3{"Rate request outcome"}
  E3 -->|429| E4["Rate-limited message with retry time"]
  E3 -->|partial| E5["Partial notice, available options shown"]
  E3 -->|OK| E6{"Same carrier service returned?"}
  E6 -->|Yes| E7["Price change summary on that card:<br/>Was USD 23.00, now USD 24.50, +USD 1.50<br/>user must confirm by choosing again"]
  E6 -->|No| E8["Notice: that service is no longer available<br/>alternatives listed, nothing auto-selected"]
  E7 --> E9["Continue: returns to the step the user came from"]
  E8 --> E9
```

When a rate-relevant field changes in wizard step 1 (postcode, residential flag), see [F02 §3](F02-auth-gate-and-wizard.md#3-rate-relevant-change-inside-the-wizard-us-168).

## 5. Save and share (Should, US-164, US-165)

```mermaid
flowchart LR
  S0["Results header: Save / Share"] --> S1{"Signed in?"}
  S1 -->|No| S2["Save: sign-in prompt with returnUrl<br/>Share: hidden for guests"]
  S1 -->|Yes| S3{"Permission"}
  S3 -->|"quote:create for save"| S4["Saved toast and Saved state on button<br/>appears in /account/quotes"]
  S3 -->|"quote:share for share"| S5["Share dialog: notice that a new link turns off the previous one;<br/>Create link -> /q#token=... read-only link, Copy;<br/>notice: no personal data is shared, expires with quote"]
  S5 -->|"429 RATE_LIMITED (10 links per quote per hour)"| S8["Alert in dialog with retry time"]
  S3 -->|missing| S6["Action absent from the accessibility tree"]
  S4 -->|"409 QUOTE_ALREADY_CLAIMED"| S7["Inline error: this quote belongs to another account.<br/>Start a new quote"]
  R0["Recipient opens /q#token=..."] --> R1["POST resolveSharedQuote with the token from the fragment"]
  R1 -->|OK| R2["Read-only shared view (W02 §6)"]
  R1 -->|"404 (unknown, revoked, superseded or expired)"| R3["This shared quote is no longer available. Get a quote"]
```

## 6. Error, empty, loading, offline and permission paths (summary)

| Condition | Where | Result |
|---|---|---|
| Loading | Results | Skeleton cards (one per pending carrier) after 150 ms. Status line "Comparing 4 carriers…" plus "2 of 4 responded". |
| Empty (no service fits) | Results | Empty state with per-carrier reasons and "Edit packages" |
| Filters hide everything (Should) | Results | Empty state "No options match your filters ({hidden} hidden)" with "Reset filters" |
| Error (all carriers fail, 5xx) | Results | Error state, "Try again" (new rate request on the same quote if not expired) and correlation ID |
| Partial | Results | Per-carrier inline notice plus a warning banner. Partial results remain bookable. |
| Permission-denied | Results | Wrong or missing guest token (404) or role without `quote:read` (403): no data, "Start a new quote" |
| Offline | Home, results | Offline banner. Values and received results kept. Submit and "Book" use `aria-disabled` with a reason. |
| Rate limited | Home submit, re-quote | Form-level alert with the retry time (`Retry-After`) |
