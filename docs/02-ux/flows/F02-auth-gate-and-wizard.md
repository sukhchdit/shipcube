# F02 — Sign-in gate, quote claim and booking wizard (steps 1–5)

Stories: **US-015, US-017, US-020, US-166, US-171, US-172, US-174, US-175, US-176, US-177, US-180, US-181, US-182, US-183, US-184, US-189, US-191, US-192, US-232, US-233, US-234, US-168, US-167, US-119** (Must) · US-178, US-179, US-185, US-190, US-193, US-194, US-239 (Should) · Screens S-A01, S-A02, S-B01..S-B05

## 1. "Book this service" gate (D-009, US-171)

```mermaid
flowchart TD
  B0["Book this service on option O1 of quote Q1"] --> B1{"Session?"}
  B1 -->|Yes| B2{"shipment:create?"}
  B2 -->|No| B3["Button was absent for this role.<br/>Direct URL: permission-denied state"]
  B2 -->|Yes| W1["/book/new?quote=Q1&option=O1 step 1"]
  B1 -->|No| G0["/sign-in?returnUrl=/book/new... with BookingContextCard:<br/>carrier, service, price, valid until"]
  G0 --> G1{"Has an account?"}
  G1 -->|Yes| SI["Sign in (F02 §1a)"]
  G1 -->|No| RG["Register link keeps returnUrl and context"]
  RG --> RG1["Register form S-A02"]
  RG1 --> RG2{"Response"}
  RG2 -->|"202 accepted"| RG3["Signed in as PENDING_VERIFICATION.<br/>Banner: we sent a link to address.<br/>Continue to booking"]
  RG2 -->|"400 VALIDATION_ERROR"| RG4["Inline errors + summary,<br/>PASSWORD_POLICY message on password"]
  RG4 --> RG1
  RG2 -->|"429 RATE_LIMITED"| RG5["Form alert with retry time"]
  RG3 --> W1
  SI --> W1
  W1 --> CL["First save of step 1 claims Q1<br/>O1 still selected"]
  CL -->|"409 QUOTE_ALREADY_CLAIMED"| CL1["Blocking panel: this quote belongs to another account.<br/>Get a new quote with the same details"]
  CL -->|"404 guest token lost"| CL2["Panel: we could not find your quote.<br/>Get new prices with the same details (inputs kept in memory if available)"]
  CL -->|"403 AUTHZ_DENIED"| CL3["Permission-denied state"]
  CL -->|OK| W2["Draft created, URL becomes /book/id/addresses"]
```

Registration for an existing email returns the same 202 response (US-015). The UI therefore always says "Check your inbox". It never says "account exists". The user can still continue to the wizard only if a session was issued. The flow assumes the API signs the user in on registration. **Open item for principal-architect:** if registration does not create a session, the screen after registration must route to sign-in with the same `returnUrl` and context, with no other UX change.

### 1a. Sign in (customer)

```mermaid
flowchart TD
  S0["Email + password, paste allowed"] --> S1{"Response"}
  S1 -->|200| S2["Go to returnUrl (validated same-origin) or /account"]
  S1 -->|"401 MFA_REQUIRED"| S3["Two-step verification S-A06<br/>code or recovery code"]
  S3 -->|valid| S2
  S3 -->|"401 MFA_INVALID"| S4["Inline error on code, focus stays in field"]
  S3 -->|"429 MFA_LOCKED"| S5["Alert with time until retry, input disabled"]
  S1 -->|"401 INVALID_CREDENTIALS"| S6["Form-level alert, focus to alert:<br/>Email or password is incorrect"]
  S1 -->|"429 ACCOUNT_DELAYED"| S7["Alert with live countdown,<br/>submit re-enables at 0"]
  S1 -->|"429 ACCOUNT_LOCKED"| S8["Alert: account temporarily locked,<br/>try again at time or reset password"]
  S1 -->|"429 RATE_LIMITED"| S9["Alert with retry time"]
  S1 -->|offline or 5xx| S10["Alert with Try again and correlation ID"]
```

## 2. Wizard step navigation and resume (US-172, US-174)

```mermaid
flowchart TD
  R0["Open a draft from Drafts, a link, or another device"] --> R1{"Draft accessible?"}
  R1 -->|"401"| R2["Redirect to /sign-in?returnUrl"]
  R1 -->|"404 cross-tenant or unknown"| R3["Not-found state"]
  R1 -->|"403 Viewer"| R4["Permission-denied, no editable fields"]
  R1 -->|OK| R5["Open first incomplete step<br/>completed steps shown as summaries (desktop)"]
  R5 --> R6["Edit step"]
  R6 --> R7["Save and continue"]
  R7 --> R8{"Client validation"}
  R8 -->|fail| R9["Focus first invalid field + error summary"]
  R9 --> R6
  R8 -->|pass| R10{"Server response"}
  R10 -->|OK| R11["Next step, focus to step h1,<br/>announce Step N of 7"]
  R10 -->|"400 / 422 field errors"| R9
  R10 -->|"412 CONCURRENCY_CONFLICT"| R12["Dialog: This booking changed in another tab or device.<br/>Review the latest version (your unsaved edits listed)"]
  R12 --> R5
  R10 -->|"offline"| R13["Offline banner; edits kept in the form;<br/>Save disabled with reason"]
  R13 -->|back online| R7
  R6 -->|"Back"| R14["Previous step with its data"]
  R5 -->|"URL to a later, unreachable step"| R15["Show first incomplete step with message:<br/>Complete Contents first"]
```

Autosave (Should, US-179) adds a background save after 1 s idle with an indicator ("Saving…", "Saved at 14:02", "Not saved"). Without it, saving happens only on "Save and continue". The offline edit queue exists only if US-179 is built.

## 3. Rate-relevant change inside the wizard (US-168)

```mermaid
flowchart TD
  Q0["Step 1: user edits postcode or residential flag<br/>(country is fixed by the quote)"] --> Q1["On blur: inline info under the field:<br/>Changing this updates your price"]
  Q1 --> Q2["Save and continue"]
  Q2 --> Q3["Server creates new quote, draft back to DRAFT,<br/>previous option invalidated"]
  Q3 --> Q4["Choose your service again S-B01a<br/>streamed results, old price shown for reference"]
  Q4 --> Q5{"Same service available?"}
  Q5 -->|Yes| Q6["Highlighted with price difference"]
  Q5 -->|No| Q7["Notice + alternatives, nothing preselected"]
  Q6 --> Q8["Select, continue to next incomplete step"]
  Q7 --> Q8
  Q2 -->|"400 invalid value e.g. weight 1000.1 kg"| Q9["Inline error; existing quote and selection kept"]
```

Package weight and dimensions are edited from the review step ("Edit packages"). They open the same S-B01a flow.

## 4. Step 2: contents, customs, prohibited items, DG

```mermaid
flowchart TD
  C0["Open Contents"] --> C1{"Customs required for lane and content type?"}
  C1 -->|"Document with declaration"| C2["Description + attestation:<br/>documents with no commercial value"]
  C1 -->|"Domestic or customs not required"| C3["Description only"]
  C1 -->|"Parcel cross-border"| C4["Description + customs section:<br/>reason for export, currency of values, lines"]
  C4 --> C5["Add line: description, HS code search,<br/>country of manufacture, quantity, unit value, unit weight"]
  C5 --> C6{"HS code"}
  C6 -->|"422 COMMODITY_CODE_FORMAT"| C7["Inline error with accepted formats"]
  C6 -->|"not in sample list"| C8["Non-blocking warning"]
  C6 -->|OK| C9["Line total and declared total update (read-only)"]
  C2 --> P0
  C3 --> P0
  C9 --> P0["Description typed: prohibited check after 400 ms"]
  P0 --> P1{"Match?"}
  P1 -->|Prohibited| P2["Inline error naming the list entry, announced.<br/>Continue aria-disabled with reason"]
  P1 -->|Restricted| P3["Warning + required acknowledgement checkbox"]
  P1 -->|None| P4["No message"]
  P3 --> DG
  P4 --> DG["DG attestation checkbox with examples (always)"]
  DG --> SV["Save and continue"]
  SV -->|"422 ITEM_PROHIBITED"| P2
  SV -->|"422 CUSTOMS_WEIGHT_EXCEEDS_PACKAGE"| C10["Error on line weights + total vs package weight"]
  SV -->|"400 more than 50 lines"| C11["Add line disabled at 50, with reason"]
  SV -->|OK| NEXT["Step 3"]
```

## 5. Step 3: collection

```mermaid
flowchart TD
  K0["Open Collection"] --> K1{"Service supports drop-off?"}
  K1 -->|No| K2["Courier pickup only, preselected"]
  K1 -->|Yes| K3["Choose: Courier pickup or Drop-off"]
  K3 -->|Pickup| K4
  K2 --> K4["Date: earliest valid preselected.<br/>Weekends, holidays, past cut-off disabled with reason"]
  K4 --> K5["Window: Morning, Afternoon or Custom (min 2 h)"]
  K5 --> K6["Instructions (optional, 200 chars)"]
  K6 --> K7["Save and continue"]
  K7 -->|"422 PICKUP_DATE_INVALID / PICKUP_WINDOW_INVALID"| K8["Message beside the date or window;<br/>picker refreshes availability"]
  K3 -->|Drop-off| D1["Nearby points near sender postcode (list)"]
  D1 --> D2{"Points found?"}
  D2 -->|"None or carrier error"| D3["No drop-off points found near postcode.<br/>Switch to courier pickup"]
  D2 -->|Yes| D4["Select a point (radio card), hours disclosure"]
  D4 --> K7
  K7 -->|OK| K9["Step 4 (Should) or Step 5"]
```

Switching mode clears the other mode's data (US-189). When the user has entered pickup data, the switch asks "Switch to drop-off? Your pickup date and window will be cleared" with an AlertDialog.

## 6. Step 5: review and basket

```mermaid
flowchart TD
  V0["Open Review"] --> V1["Sections with Edit links: Addresses, Contents,<br/>Collection, Extras; itemised price from snapshot;<br/>quote valid until"]
  V1 --> V2{"Quote expired?"}
  V2 -->|Yes| V3["Expired panel + Get new prices (F01 §4)"]
  V2 -->|No| V4{"All steps complete?"}
  V4 -->|No| V5["Continue to payment aria-disabled;<br/>list of missing steps with links"]
  V4 -->|Yes| V6{"Email verified?"}
  V6 -->|No| V7["Warning banner: verify your email before paying.<br/>Resend link. Continue still enabled; gate repeats at checkout"]
  V6 -->|Yes| V8["Basket: this order has N shipments, total"]
  V7 --> V8
  V8 -->|Should| V9["Add another shipment (sender copied) / remove"]
  V8 -->|Should| V10["Coupon: apply / remove"]
  V8 --> V11["Continue to payment"]
  V11 --> CO["Checkout gate (F03)"]
  V9 -->|"422 limit of 10"| V12["Inline message: an order can hold up to 10 shipments"]
  V9 -->|"422 ORDER_CURRENCY_MISMATCH"| V13["Panel: this shipment is priced in INR.<br/>Start a separate order"]
```

## 7. Error, empty, loading, offline and permission paths (wizard summary)

| Condition | Result |
|---|---|
| Loading a step | Step skeleton (field-shaped blocks). Summary column skeleton. Stepper rendered immediately from the cached draft when available. |
| Empty | Not applicable to steps. The address-book picker shows "No saved addresses yet" with "Enter an address". Drop-off shows the no-points state. |
| Error loading a draft | Error state with Try again and correlation ID, inside the wizard shell |
| Partial | Price summary failed while the step loaded: the summary shows its own error with Try again, and the step stays usable. Address suggestions time out after 3 s, so the step is not blocked (US-178). |
| Permission-denied | Viewer or a role without `shipment:create`: permission-denied state, no editable fields (US-174). Address-book save without `address_book:manage`: the step saves, and an inline note says "Couldn't save to your address book: you don't have permission" (US-175). |
| Not found | Cross-tenant or unknown draft: not-found state (404 indistinguishable) |
| Offline | Banner. Entered data kept. "Save and continue" uses `aria-disabled` with the reason "You're offline". |
| Session expired mid-step | Silent refresh. If refresh fails, a dialog says "Your session ended. Sign in to continue. Your saved steps are kept." The user signs in, returns to the same step and unsaved field values are restored from memory when the tab survived (US-020). |
