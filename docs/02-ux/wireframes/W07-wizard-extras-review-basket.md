# W07 — Step 4 Extras (Should) and step 5 Review and basket (S-B04, S-B05)

Routes `/book/{id}/extras`, `/book/{id}/review` · Permission `shipment:create` · Stories: **US-191, US-192, US-149, US-150, US-167, US-168, US-208** (gate preview), **US-109** · US-190, US-193, US-194 (Should) · Flow: [F02 §6](../flows/F02-auth-gate-and-wizard.md#6-step-5-review-and-basket)

## 1. Step 4 — Extras (Should, US-190)

**Data:** cover terms (rate, minimum, maximum insurable value, included cover), priced delivery options returned by the carrier, reference field rules (max 3 fields, 30 chars).

```
360                                          1280 (same column in main, summary on the right)
| # Extras                             |
| ## Protection                        |
| Included: cover up to $100.          |
| [ ] Add extra cover                  |
|     Value to cover                   |
|     [500.00] USD                     |
|     Extra cover costs $10.00         |  server-recomputed line; "Updating…" while pending
|     (2%, minimum $5.00). Maximum     |
|     value $5,000.                    |
| ## Delivery options                  |  only priced options from the carrier
| [ ] Signature on delivery  +$4.50    |
| ## Your references (optional)        |
| Reference 1 [PO-2026/11.A_____]      |
| <+ Add another reference> (max 3)    |
+--------------------------------------+
| $55.20 [Price details ^] [Continue] |
```
- `COVER_VALUE_EXCEEDS_MAXIMUM`: an inline error on the value: "We can cover up to $5,000. Enter a lower value." The previous price is kept.
- Reference rules: up to 30 characters; letters, numbers and `-_/.#` (rejected characters are listed in the message).
- When US-190 is not built, the step is absent from the stepper (no placeholder).

## 2. Step 5 — Review and basket

**Data:** the full draft (all sections), the stored price snapshot (charge lines, totals, tax metadata, FX line), quote expiry, the open order (shipments with route, service and total; currency; order total), the user's verification status, completeness per step, and coupon state (Should).

### 360 px
```
| # Review your booking                |
| ! Verify your email before you pay.  |  warning InlineAlert (unverified only)
|   We sent a link to ana@example.com. |
|   [Resend email]                     |
|                                      |
| ## Addresses                [Edit]   |
| From Ana Silva                       |
| 350 5th Ave, New York NY 10001, US   |
| To Ravi Kumar                        |
| 12 MG Road, Mumbai 400001, IN        |
| Receiver ID: PAN ••••••••34          |
| ## Contents                 [Edit]   |
| Gift · 2 items · declared $62.50     |
| No dangerous goods confirmed ✓       |
| ## Package                  [Edit]   |  rate-relevant: opens S-B01a after edit
| 1 package · 4.4 lb · 11.8×7.9×3.9 in |
| ## Collection               [Edit]   |
| Courier pickup                       |
| Tue 17 Nov 2026, 13:00–17:00 EST     |
| ## Extras                   [Edit]   |  Should
| Extra cover $500 · Ref PO-2026/11.A  |
|                                      |
| ## Price                             |
| [PriceBreakdown table, from snapshot]|
| Total                       $55.20   |
| Prices valid until 13 Nov, 14:30 EST |
|                                      |
| ## Your order (1 shipment)           |
| US→IN DHL Express Worldwide  $55.20  |
| <+ Add another shipment>  (Should)   |
| Coupon (Should)                      |
| [SAVE10_____] [Apply]                |
| Order total                 $55.20   |
| By continuing you agree to the       |
| <Terms>.                             |
+--------------------------------------+
| $55.20 [Details ^] [Continue to payment] |
```

### 1280 px
```
| # Review your booking                                      | Your order          |
| ! Verify your email before you pay.  [Resend email]        | 1 shipment          |
| ## Addresses ........................................[Edit] | DHL Express ...     |
| From ... | To ...   (two columns in DescriptionList)       | $55.20              |
| ## Contents ......................................... [Edit]| Coupon* [___][Apply]|
| ## Package .......................................... [Edit]| ------------------- |
| ## Collection ....................................... [Edit]| Order total $55.20  |
| ## Extras ........................................... [Edit]| Valid until 14:30   |
| ## Price (full PriceBreakdown)                             | [Continue to payment]|
| ## Shipments in this order (table: route, service, total, [Remove]*)  | (sticky)  |
```

### Multi-shipment basket (Should, US-193)
```
| ## Your order (3 shipments)                                  |
| 1  US→IN  DHL Express Worldwide     $55.20  [Review] [Remove] |
| 2  US→GB  FedEx Intl Priority       $61.00  [Review] [Remove] |
| 3  US→CA  UPS Saver                 $38.40  [Review] [Remove] |
| Order total                                 $154.60          |
| <+ Add another shipment> (sender details copied)            |
```

## 3. Interaction details

- **Edit links** go to the step and return to Review after "Save and continue" (the stepper's "Continue" becomes "Save and return to review" when the user entered from Review).
- **Package edit** is rate-relevant: after save, the user is taken to S-B01a (choose service again), then back to Review (US-168, US-191).
- **Price** is the stored snapshot with no recalculation in the browser (US-191).
- **Incomplete steps:** "Continue to payment" is `aria-disabled` with a description, and an InlineAlert lists the missing steps as links: "Finish these steps before paying: Collection" (US-191).
- **Expired quote:** the Price section is replaced by the expired panel + "Get new prices" (W02 §expired, US-167).
- **Unverified email:** the warning is non-blocking here. The gate at checkout start is authoritative (US-208, D-009). "Resend email" shows an inline status "Sent. Check your inbox." and handles 429 with the next allowed time.
- **Coupon (Should, US-194):** Apply shows the discount line per eligible shipment. Errors appear inline: `COUPON_INVALID` "This code isn't valid for this order", `COUPON_EXPIRED` "This code has expired", `COUPON_EXHAUSTED` "This code has reached its limit". Applied state: "SAVE10 applied −$5.52 [Remove]".
- **Basket limits:** at 10 shipments, "Add another shipment" is disabled with the reason. `ORDER_CURRENCY_MISMATCH` shows "This shipment is priced in INR. Orders can only have one currency. [Start a separate order]".
- **Continue to payment:** runs the checkout gate (F03 §1). Blocking responses render as InlineAlerts above the button and receive focus.

## 4. States

| State | Rendering |
|---|---|
| Loading | Section skeletons + summary skeleton |
| Empty | Basket emptied by removing the last shipment (Should): the page redirects to Home with the toast "Your order is empty" (US-193) |
| Error | Load failure: ErrorState. Gate 5xx: InlineAlert + Try again. |
| Partial | The price snapshot failed to load while the sections loaded: the Price section shows an error with Try again, and "Continue to payment" is disabled with the reason. |
| Permission-denied | Viewer: PermissionDeniedState. Without `payment:create`: Review is visible, and "Continue to payment" is replaced by the text "Someone with payment permission needs to complete this booking." (US-070: the action is absent, the explanation present). |
| Offline | Banner; Continue and Apply disabled with the reason |
| Expired | Expired panel (above) |

## 5. Accessibility

- `h1` Review → `h2` per section. Each "Edit" link has an accessible name with the section: "Edit addresses".
- PriceBreakdown is a table with caption "Price details". The order total is in the table footer.
- InlineAlerts from the gate are focused on insertion (`tabindex=-1` heading). The Resend status uses `role="status"`.
- Mobile sticky bar: "Continue to payment" label wraps if needed (es and fr longer). The bar grows to 2 lines rather than truncating, and `scroll-padding` is updated accordingly.
- Coupon field: label "Coupon code (optional)". Apply is a separate button. Results are announced (`role="status"`).
