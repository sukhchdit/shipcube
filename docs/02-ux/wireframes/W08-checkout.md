# W08 — Step 6 Checkout (S-B06)

Route `/checkout/{orderId}` · Permission `payment:create` · Stories: **US-208, US-209, US-210, US-211, US-212, US-214, US-109** · US-217 (Should, saved cards), US-218 (Should, receipt) · Flow: [F03 §1–§2](../flows/F03-checkout-3ds-confirmation.md)

**Data needed:** order (number, shipments with route, service and total, server-computed amount in minor units, sell currency), gateway mode (`mock` | `stripe-test`; `livemode: false`), the gateway client configuration for hosted fields (publishable key reference and client secret or equivalent; principal-architect defines it), saved methods (Should: brand, last 4, expiry, needs-auth flag), and attempt count (to show the remaining attempts only after a failure).

## 1. Layout

### 360 px
```
+--------------------------------------+
| [‹ Back to review]  Payment  [TEST]  |  compact wizard header; Test mode badge (flask icon + "Test mode")
| Step 6 of 7 · Payment  [■■■■■■□]     |
+--------------------------------------+
| # Pay for your order                 |
| Order US-000000123 · 1 shipment      |
| +----------------------------------+ |
| | (flask) Test mode: no real money | |  InlineAlert warning (always in non-production gateways)
| | is taken. Use a test card.       | |
| +----------------------------------+ |
| ## Payment method                    |
| (o) Visa •••• 4242  exp 12/28  (Should)|
| ( ) Use a new card                   |
| +----------------------------------+ |
| | [ gateway hosted card fields    ] | |  container min-height reserved (no CLS)
| | [ card number / expiry / CVC    ] | |
| +----------------------------------+ |
| [ ] Save this card for next time *   |  Should
|                                      |
| Amount to be charged                 |
| USD 65.00                            |  sell currency with code, always (US-214)
| (approx. ₹5,430 — shown only if a    |
|  display currency is selected)       |
| By paying you agree to the <Terms>.  |
+--------------------------------------+
| USD 65.00 [Details ^] [Pay USD 65.00]|  StickyActionBar
+--------------------------------------+
```

### 1280 px
```
| [‹ Back to review]        Book a shipment                                        [TEST MODE] |
| stepper (6 Payment current) | # Pay for your order                     | Order US-000000123  |
|                             | (flask) Test mode: no real money is taken| 1 shipment          |
|                             | ## Payment method                         | DHL Express  $55.00 |
|                             | ( ) saved card*  (o) Use a new card       | Extra cover  $10.00 |
|                             | [ hosted card fields ................. ]  | ------------------- |
|                             | [ ] Save this card*                       | Amount to be charged|
|                             |                                           | USD 65.00           |
|                             | [            Pay USD 65.00            ]   | <Price details>     |
```

### Payment outcomes (InlineAlert above the Pay button; focus moves to its heading)
```
| X Your bank declined this card.                      |   CARD_DECLINED
|   Try another card or contact your bank.             |
| X There isn't enough money on this card.             |   INSUFFICIENT_FUNDS
| X This card has expired. Use another card.           |   EXPIRED_CARD
| X Your bank couldn't confirm this payment.           |   AUTHENTICATION_FAILED (3DS failed/abandoned)
|   Try again or use another card.                     |
| X We can't reach the payment service right now.      |   GATEWAY_UNAVAILABLE + [Try again]
|   You haven't been charged.                          |
| X Too many payment attempts for this order.          |   PAYMENT_ATTEMPTS_EXCEEDED (Pay disabled with reason)
|   You can try again at 15:40.                        |
| ! The total changed to USD 67.10. Check and pay.     |   AMOUNT_MISMATCH (summary refreshed)
```

### 3-D Secure
The gateway presents its own challenge (a modal or iframe owned by the gateway, US-212). Before it opens, the page announces politely "Your bank is asking you to confirm this payment". During the challenge the Pay button stays in its loading state ("Waiting for your bank…"). On return, focus goes back to the Pay button region and the outcome is announced.

## 2. Interaction details

- **Only card is rendered** (US-211). Card data never touches Platform inputs: the card fields are the gateway's hosted fields. The page renders no own inputs for card number, expiry or CVC.
- **Pay:** one idempotency key per attempt. Double activation is ignored while loading (US-214). The label includes the amount and the code: "Pay USD 65.00".
- **On AUTHORISED:** navigate to `/orders/{orderId}/confirmation` (progress state, W09).
- **Hosted field errors** (gateway client-side validation such as an incomplete number) are shown by the gateway inside its fields. The page also sets an error summary line "Check your card details" if submit is pressed with gateway errors.
- **Back to review:** allowed until Pay is pressed. After a failure the order stays payable or returns to QUOTED (US-212). The Back link stays available.
- **Saved card needing 3DS** (Should): same challenge path. A silent charge never occurs.

## 3. States

| State | Rendering |
|---|---|
| Loading | Order summary skeleton. Card-fields container with a fixed-height skeleton until the gateway mounts. |
| Empty | Not applicable (an order without shipments is NotFound) |
| Error | Gateway script failed to load: ErrorState in the payment area "Payment isn't available right now. You haven't been charged." + Try again. Order load failure: ErrorState. Payment errors: the alerts above. |
| Partial | Saved methods failed (Should): "Use a new card" shown with a notice "We couldn't load your saved cards". |
| Permission-denied | Viewer, or no `payment:create`: PermissionDeniedState (US-214). Another organisation's order: NotFoundState. Unauthenticated: redirect to sign-in with `returnUrl`. |
| Offline | Banner; Pay `aria-disabled` "You're offline"; card fields stay mounted |
| Gate blocked on direct entry | `EMAIL_NOT_VERIFIED` / `QUOTE_EXPIRED` / step incomplete: redirect to Review with the matching panel (F03 §1) |

## 4. Accessibility

- `h1` "Pay for your order" → `h2` Payment method; the summary is an `aside` "Order summary".
- The **Test mode badge** is text plus an icon in the header, and the explanation is an InlineAlert in the body. It is never colour only (US-214).
- Hosted fields: the gateway iframe has a `title` ("Secure card payment input frame") set through the gateway options. The label "Card details" is above the container. **Known constraint:** the inner accessibility of the gateway's fields and 3DS challenge is the gateway's. qa-lead verifies keyboard operability end to end (US-214) and records any gateway-owned issue as a third-party finding.
- Payment outcome alerts use `role="alert"` and are focused. The amount is repeated in the Pay label for screen-reader context.
- The sticky Pay bar never covers the card fields (scroll padding). On iOS the bar hides while the keyboard is open.
- Timing: no time limit is imposed by the page. The gateway's 3DS has its own limits, and an expiry returns `AUTHENTICATION_FAILED` with a retry (WCAG 2.2.1 satisfied by retry).
