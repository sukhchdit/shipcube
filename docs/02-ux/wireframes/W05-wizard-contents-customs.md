# W05 — Step 2 Contents and customs (S-B02)

Route `/book/{id}/contents` · Permission `shipment:create`, plus `customs:manage` for customs lines · Stories: **US-180, US-181, US-182, US-183, US-184, US-208** (re-check), **US-054** (sample HS data label) · US-185 (Should) · Flow: [F02 §4](../flows/F02-auth-gate-and-wizard.md#4-step-2-contents-customs-prohibited-items-dg)

**Data needed:** customs applicability for the lane and content type (required / not required / document declaration), reasons for export (enum), Incoterms offered (Should), currency list, the HS sample search (public), countries for "made in", the package weight total (for the line-weight check), prohibited and restricted match results for the description and HS chapter prefixes, DG attestation wording (versioned), and de-minimis (Should).

## 1. Layout

### 360 px (parcel, cross-border: US → IN)
```
| # What's inside                      |
| ErrorSummary                         |
| Describe the contents                |
| e.g. Cotton shirts and a book        |
| [________________________________]   |  3–100 chars, counter near limit
| X This can't be sent to this         |  prohibited (danger; polite field live region)
|   destination: Batteries, loose      |
|   lithium (Prohibited).              |
|                                      |
| ## Customs details                   |
| Customs in India need these to       |
| clear your parcel.                   |
| Reason for sending                   |
| [Gift                          v]    |
| Currency of item values              |
| [USD — US dollar               v]    |  chosen once per shipment (D-UX-014)
| Who pays import duties? (Should)     |
| (o) Receiver pays (DAP)              |
| ( ) I'll pay (DDP) — not offered     |  shown only if supported
| i May be exempt from duties (below   |  de-minimis hint, Should; "Unreviewed"
|   the India threshold). Not binding. |
|                                      |
| ## Items (2)                         |
| +----------------------------------+ |
| | Item 1                  [Remove] | |
| | Description                      | |
| | [Cotton shirts______________]    | |
| | Commodity code (HS)  [Sample data]| |
| | [6109 v] → 610910 T-shirts...    | |  async Combobox
| | Made in  [India           v]     | |
| | Quantity [3]  Value each [12.50] | |
| | Weight each [0.44] lb            | |
| | Item total $37.50                | |
| +----------------------------------+ |
| <+ Add another item>  (max 50)       |
| Declared value $62.50 (read-only)    |
| Total item weight 1.8 lb of 4.4 lb   |
|                                      |
| ## Safety                            |
| +----------------------------------+ |
| | [ ] This shipment contains no    | |  CheckboxCard, required always
| |     dangerous goods              | |
| |  For example: lithium batteries, | |
| |  aerosols, flammable liquids,    | |
| |  compressed gas. <What counts?>  | |
| +----------------------------------+ |
+--------------------------------------+
| $45.20 [Price details ^] [Continue] |  Continue aria-disabled while prohibited match
```

### 1280 px (customs lines as an editable table)
```
| ## Items                                                                                    |
| +--------------------------------------------------------------------------------------+   |
| | # | Description        | HS code [Sample] | Made in | Qty | Value each | Weight each | Total  |   |
| | 1 | [Cotton shirts___] | [610910 v]       | [IN v]  | [3] | [12.50]    | [0.44] lb   | $37.50 | [x] |
| | 2 | [Paperback book__] | [490199 v]       | [US v]  | [1] | [25.00]    | [0.88] lb   | $25.00 | [x] |
| +--------------------------------------------------------------------------------------+   |
| <+ Add another item>                       Declared value $62.50 · Item weight 1.8 of 4.4 lb |
```
At 768–1279 the table keeps the essential columns (Description, HS, Qty, Value, Total). "Made in" and "Weight each" move into an expandable row detail. The line card layout is used below 768 (US-181).

### Document shipment (declaration instead of lines, US-180)
```
| # What's inside                                     |
| Describe the documents                              |
| [Signed contracts__________________]                |
| [ ] These items are documents with no commercial    |
|     value                                           |
| ## Safety  [ ] contains no dangerous goods ...      |
```
Domestic or customs not required: description + Safety only, with the text "No customs details are needed for this shipment."

## 2. Interaction details

- **Prohibited and restricted check (US-183):** runs 400 ms after typing stops in the description and on HS code selection (chapter prefix).
  - **Prohibited:** the danger message names the list entry, never echoing free text beyond the matched term. "Continue" becomes `aria-disabled` with `aria-describedby` → "You can't continue while an item can't be sent." Activating it moves focus to the message.
  - **Restricted:** a warning CheckboxCard "I understand {entry}: {restriction note}". It is required to continue (stored acknowledgement).
  - Matching happens in the user's locale plus English (server-defined). The UI only renders results.
- **HS code Combobox (US-182):** a minimum of 2 characters (keyword or digits). Results show "610910 — T-shirts, singlets, of cotton" with a "Sample data" badge on the field label. Selecting a result fills the code and, when empty, the description. A free-typed code is formatted on blur (dots stripped). `COMMODITY_CODE_FORMAT` shows "Enter 6, 8 or 10 digits (India accepts 6 or 8)". A code not in the sample list shows a non-blocking warning "We couldn't find this code in our sample list. Check it's correct."
- **Values:** DecimalField with a currency adornment from the section currency. Item total and declared total are display-only, formatted from server-validated values after save (or a client preview labelled "estimate" before save). The authoritative value comes from the server.
- **Weights:** per unit, in the shipment's unit system. `CUSTOMS_WEIGHT_EXCEEDS_PACKAGE` shows on the total line: "Item weights (2.5 kg) are more than the package weight (2 kg). Check the item weights or edit the package."
- **Add or remove an item:** remove shows an Undo toast for 5 s (no confirm dialog). At 50 items, "Add another item" is disabled with the reason "You can add up to 50 items".
- **Reason for sending:** options are Sale, Gift, Sample, Personal effects, Repair or return, Returned goods. A short hint under the select explains that Sale produces a commercial invoice and the others a pro-forma invoice (US-186).

## 3. States

| State | Rendering |
|---|---|
| Loading | Section skeletons (description, customs fields, 2 item cards or table rows) |
| Empty | Items section before the first item: one empty item is pre-added, so the user is never asked to "add" before typing. Declared value "—". |
| Error | Load failure: ErrorState in the shell. HS search failure: inline row in the Combobox "Search isn't available. Enter the code yourself." Prohibited-check service failure: "We couldn't check your items right now. We'll check again when you continue." (server enforces). |
| Partial | HS search unavailable or prohibited check unavailable as above. Incoterm DDP unavailable: only DAP shown with no notice. |
| Permission-denied | Viewer: PermissionDeniedState. A role with `shipment:create` but without `customs:manage` (custom role): the items section is read-only with the InlineAlert "You don't have permission to edit customs items. Ask an owner or admin." |
| Offline | Banner; HS search shows "Search needs a connection"; Continue disabled with reason; values kept |

## 4. Accessibility

- `h1` "What's inside" → `h2` Customs details, Items, Safety. Each item card is a `fieldset` with legend "Item 1". The table variant uses `th` column headers, and each input's accessible name includes the column and row ("Quantity, item 2").
- Prohibited, restricted and HS-code messages are delivered through an `aria-live="polite"` region tied to the field (US-183) plus `aria-describedby`. Prohibited messages are polite, not assertive, because they result from typing.
- The disabled "Continue" uses `aria-disabled` (focusable) with a description, never a silent native disabled state.
- The DG CheckboxCard label is the full sentence. The examples are in its description (`aria-describedby`). "What counts?" opens a Popover with more examples (button, not hover).
- Removing an item moves focus to the next item's legend, or to "Add another item" when the last item is removed.
- Targets: the remove "[x]" is a 44 px IconButton on touch with the label "Remove item 2".
