# W04 — Booking wizard shell and step 1 Addresses (S-B01, S-B01a)

Routes `/book/new?quote&option`, `/book/{id}/addresses`, `/book/{id}/service` · Client-rendered · Permission `shipment:create` (address-book read/manage optional) · Stories: **US-171, US-172, US-174, US-175, US-176, US-177, US-119, US-166, US-168, US-109** (sticky bar) · US-178, US-179 (Should) · Flow: [F02](../flows/F02-auth-gate-and-wizard.md)

**Data needed:** draft (version/ETag, step completion flags, first incomplete step), quote and selected option summary (carrier, service, price snapshot, expiry), address formats for the origin and destination countries (field order, labels, required, postcode pattern, subdivisions, max lengths = strictest carrier), lane requirements for tax and identity references (types, labels, patterns), address book entries (if `address_book:read`), and the user's default sender address (Should).

## 1. Wizard shell (all steps)

Seven steps (brief §5). Steps 6 and 7 are separate routes (checkout, confirmation) but appear in the stepper for orientation.

| # | Step | Route slug | MoSCoW |
|---|---|---|---|
| 1 | Addresses | `addresses` | Must |
| 2 | Contents | `contents` | Must |
| 3 | Collection | `collection` | Must |
| 4 | Extras | `extras` | Should (when not built, the stepper shows 6 steps and the numbering adapts, with no empty step) |
| 5 | Review | `review` | Must |
| 6 | Payment | `/checkout/{orderId}` | Must |
| 7 | Confirmation | `/orders/{orderId}/confirmation` | Must |

### 360 px (one step per screen, D-UX-006)
```
+--------------------------------------+
| [‹ Back]   Book a shipment   [Exit]  |  compact header (replaces the site header nav in the wizard)
| Step 1 of 7 · Addresses              |
| [■■□□□□□]                            |  progressbar
+--------------------------------------+
| # Addresses                          |
| ...step content...                   |
|                                      |
| (content ends 80 px above the bar)   |
+--------------------------------------+
| $45.20  [Price details ^] [Continue]|  StickyActionBar 64 + safe area
+--------------------------------------+
```
- `[Exit]` goes to `/account/drafts`. When there are unsaved edits, an AlertDialog asks "Leave this booking? Changes since your last save will be lost. Your draft is kept." with "Stay" (default focus) and "Leave". Before the first save, the text is "Your price is kept for 24 hours" with "Leave" going back to the results.
- "Price details" opens a BottomSheet with the PriceBreakdown, route, service and the quote expiry.

### 1280 px (stepper + current section + sticky summary)
```
+------------------------------------------------------------------------------------------------+
| header (brand + Exit booking; primary nav hidden in the wizard to reduce distraction)            |
+------------------------------------------------------------------------------------------------+
| +----------------+  +------------------------------------------------+  +---------------------+ |
| | Book a shipment|  | # Addresses                     Saved 14:02*   |  | Your shipment       | |
| | (1) Addresses <|  |                                                |  | (DH) DHL Express    | |
| | (2) Contents   |  | ## Sender                                      |  | Express Worldwide   | |
| | (3) Collection |  | ...                                            |  | US 10001 → IN 400001| |
| | (4) Extras     |  | ## Receiver                                    |  | 1 package · 4.4 lb  | |
| | (5) Review     |  | ...                                            |  | ------------------- | |
| | (6) Payment    |  |                                                |  | Total      $45.20   | |
| | (7) Confirm.   |  | [Back]                    [Save and continue]  |  | <Price details>     | |
| +----------------+  +------------------------------------------------+  | Valid until 14:30   | |
|   220 px            main (max 720)                                      +---------------------+ |
|                                                                           360 px, sticky        |
+------------------------------------------------------------------------------------------------+
On later steps, completed steps render as collapsed summary cards above the current form:
| ✓ Addresses   Ana Silva, New York → Ravi Kumar, Mumbai              [Edit] |
```
`*` The autosave indicator is shown only when US-179 (Should) is built. Without it, "Saved {time}" reflects the last explicit save.

### Shell behaviours
- **Step navigation:** completed steps and the first incomplete step are links. Later steps are text with "Not started" (not focusable). A URL to an unreachable step shows the first incomplete step with an InlineAlert "Complete {step} first" (US-174).
- **Back:** goes to the previous step with its data. Entered but unsaved data on the current step is kept in memory while navigating within the wizard.
- **Focus on step change:** moves to the step `h1`; announces "Step 2 of 7, Contents".
- **Concurrency (`CONCURRENCY_CONFLICT`):** Dialog "This booking was changed in another tab or device. We've loaded the latest version." It lists the fields whose unsaved values differ (label + "your value" / "saved value") and offers "Review latest version". There is no silent overwrite (US-172).
- **Viewer / no `shipment:create`:** PermissionDeniedState inside the shell, with no editable fields (US-174).

## 2. Step 1 — Addresses

### 360 px
```
| # Addresses                          |
| ErrorSummary (when 2+ errors)        |
|                                      |
| ## Sender (from United States)       |
| [Choose from address book v]*        |  Combobox; *only with address_book:read
| Full name                            |
| [________________________________]   |
| Company (optional)                   |
| [________________________________]   |
| Address line 1                       |
| [________________________________]   |
| Address line 2 (optional)            |
| [________________________________]   |
| <+ Add address line 3>               |
| City                                 |
| [________________________________]   |
| State                                |
| [New York                      v]    |
| ZIP code                             |
| [10001____]                          |
| i Changing this updates your price.  |  shown on blur only if changed from the quote
| Phone                                |
| [+1 v][415 555 0100____________]     |
| Email                                |
| [________________________________]   |
| [ ] Save to my address book*         |
|                                      |
| ## Receiver (in India)               |
| [Choose from address book v]*        |
| Full name / Company / Lines / City   |
| State [Maharashtra v]                |
| PIN code [400001]                    |
| Phone [+91 v][__________]            |
| Email [______________]               |
| [ ] This is a home address  (pre-    |
|     filled from your quote)          |
| Receiver's ID for customs            |  only when the lane requires it (US-177)
| Type [PAN v]   Number [__________]   |  masked after entry: ••••••••34 [Show]
| Customs in India need this to clear  |
| the parcel.                          |
| [ ] Save to my address book*         |
+--------------------------------------+
| $45.20 [Price details ^] [Continue] |
```

### 1280 px
Sender and Receiver are stacked sections (not side by side) in the 720 px column, so the reading order is linear. Field rows pair on the same line where the country format allows: City | State | ZIP; Phone | Email.

### Field rules
- **Country** is fixed by the quote: shown as text "United States" in the section heading, not editable (prevents `ADDRESS_COUNTRY_MISMATCH`). A "Change countries" link goes back to the results via "Edit search" (new quote).
- **Order and labels** follow the country format (US-119): US uses ZIP code and requires State; IN uses PIN code and requires State; GB uses Postcode, County optional, no state; CA uses Postal code and requires Province.
- **Max lengths** come from reference data (strictest carrier). A counter appears when within 10 characters of the limit: "Line 1 — 31 of 35 characters".
- **Phone:** calling-code Select + national number, composed to E.164. Error: "Enter a phone number with country code, for example +1 415 555 0100".
- **Rate-relevant fields** (postcode, residential flag): an info hint on change; on save a new quote is created and the user goes to S-B01a (US-168).
- **Tax or identity reference** (US-177): the type and pattern come from the compliance pack. After a valid entry and blur, the value is masked except the last 2 characters, with a "Show" toggle (`aria-pressed`). It is never displayed in full on later steps.
- **Address book selection:** fills the fields (snapshot). The Combobox lists label, name and city. Empty: "No saved addresses yet". Selecting a cross-tenant entry is impossible in the UI. A 404 response shows a toast "That address isn't available any more".
- **Save to address book** without `address_book:manage` is not rendered. A 403 on that save (race) shows an InlineAlert after the step saves: "Your booking was saved, but we couldn't save this address to your address book."
- **Carrier suggestion (Should, US-178):** after save, when the carrier suggests a correction:
```
| (i) Suggested address from DHL                       |
|   12 W 31st St, New York, NY 10001-4402              |
|   [Use suggestion]  [Keep mine]                      |
```
  It is not blocking. A timeout of 3 s means no panel is shown.

## 3. Choose your service again (S-B01a, US-168 / US-167)

```
| # Choose your service again                          |
| You changed details that affect the price. Here are  |
| updated prices for your shipment.                    |
| Previously: DHL Express Worldwide · $45.20           |
| [Result cards as in W02, streaming, same states]     |
|   on the same service: "Price changed: was $45.20,   |
|   now $47.10 (+$1.90)"                               |
|   if gone: "DHL Express Worldwide isn't available    |
|   for these details. Choose another option."         |
```
Selecting an option returns to the next incomplete step. All W02 states apply.

## 4. States (step 1 and shell)

| State | Rendering |
|---|---|
| Loading | Shell renders. The step shows field-shaped skeletons (two sections). The summary column shows a skeleton. |
| Empty | Not applicable. The address-book Combobox empty row: "No saved addresses yet". |
| Error | Draft failed to load: ErrorState inside the shell + Try again + reference. Save failed (5xx): InlineAlert above the actions, data kept. |
| Validation error | Inline per field + ErrorSummary; focus to the first invalid field (US-106). Server pointers like `/receiver/postcode` map to fields. |
| Partial | Address formats failed to load for one country: generic fields (all optional except name and line 1) with a warning "We couldn't load the address format for India. Check the address carefully." Save remains allowed (the server validates). |
| Permission-denied | Viewer: PermissionDeniedState. Address-book actions absent without permission. |
| Not found | Cross-tenant or unknown draft: NotFoundState |
| Offline | Banner; "Save and continue" `aria-disabled` "You're offline"; values kept |
| Claim conflict | `QUOTE_ALREADY_CLAIMED`: blocking InlineAlert "This quote is linked to another account" + [Get a new quote with these details] |

## 5. Accessibility

- Landmarks: wizard header (banner), stepper `nav aria-label="Booking steps"` (≥ 1024), `main`, summary `aside aria-label="Price summary"`.
- Heading order: `h1` step title → `h2` Sender / Receiver.
- Each party is a `fieldset` + `legend` (visually the `h2`). `autocomplete` uses `section-sender` and `section-receiver` tokens (WCAG 1.3.5).
- Redundant entry (3.3.7): sender details prefill from the default sender (Should) or the last-used sender in this session, and the receiver postcode and residential flag from the quote. The wizard never re-asks data entered earlier.
- Masked reference: the "Show" toggle is announced as "Show receiver ID, toggle button, not pressed".
- Sticky bar: `scroll-padding-block-end` ensures the focused field is never hidden behind it (2.4.11). The bar hides while the on-screen keyboard is up (US-109).
- Country-driven re-layout keeps focus where the user is (US-119).
