# W08 — Step 6 Checkout (S-B06)

Route `/checkout/{orderId}` · Permission `payment:create` · Stories: **US-208, US-209, US-210, US-211, US-212, US-214, US-109** · US-217 (Should, saved cards), US-218 (Should, receipt) · Flow: [F03 §1–§2](../flows/F03-checkout-3ds-confirmation.md)

**Data needed:** order (number, shipments with route, service and total, server-computed amount in minor units, sell currency), gateway mode (`mock` | `stripe-test`; `livemode: false`), the gateway client configuration for hosted fields (publishable key reference and client secret or equivalent; principal-architect defines it), saved methods (Should: brand, last 4, expiry, needs-auth flag), the access token's `auth_time` claim (to predict CVC re-collection, §5), the payment's `cvc_recollection_required` flag from `checkoutOrder` (authoritative, §5), and attempt count (to show the remaining attempts only after a failure).

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
| X We couldn't verify this card's security code.      |   AUTHENTICATION_FAILED after CVC re-collection
|   You haven't been charged. ... (3 actions, §5)      |   (saved card, Should US-217)
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
- **Saved card in a session last verified more than 12 h ago** (Should): the security code is collected again in a gateway-hosted field before payment (§5).
- **"Save this card"** (Should): saving needs a re-authentication proof (`payment_method.manage`, D-046). With the box ticked, Pay first opens the ReauthDialog (W03 §8); Cancel unticks the box and the payment continues without saving (W13 §6).

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

## 5. CVC re-collection for saved cards (Should, US-217; REQ-PAY-014; ADR-0006 am. 12, ADR-0012 am. 1; SEC-P3-28; D-UX-033)

When a saved card pays in a session whose `auth_time` is older than 12 hours, the gateway must collect the card's security code (CVC) again. The CVC is typed **only** inside a gateway-hosted field (Stripe iframe; PCI SAQ A unchanged). The Platform renders the label, hint, notice and messages around it and never renders its own CVC input (US-211, REQ-PAY-005; a CVC-like field on the API is `CARD_DATA_NOT_ACCEPTED`). A new card is unaffected.

### 5.1 When the field appears

- **Predicted (UX):** when the user selects a saved card, the client reads `auth_time` from the in-memory access token. If `now − auth_time > 12 h`, the CVC field mounts under the selected card at once, so the user pays with one press of Pay.
- **Authoritative (server):** `checkoutOrder` returns `cvc_recollection_required`. If it is `true` and the field was not shown (clock skew, or the 12 h boundary passed while the page was open), Pay returns to idle, the field mounts, the notice below is shown and focus moves into the hosted field (`element.focus()`). The user presses Pay again; no charge was attempted. If it is `false` but the field was shown, the field is unmounted and the payment proceeds without a code.
- Switching to "Use a new card" unmounts the CVC field; switching back to the saved card re-evaluates the prediction.

### 5.2 Layout

```
360                                          1280 (payment column)
| ## Payment method                    |     | ## Payment method                              |
| (o) Visa •••• 4242  exp 12/28        |     | (o) Visa •••• 4242  exp 12/28                  |
|   (i) For your security, enter the   |     |   (i) For your security, enter the security    |
|       security code for              |     |       code for Visa •••• 4242.                 |
|       Visa •••• 4242.                |     |   Security code (CVC)                          |
|   Security code (CVC)                |     |   The 3 digits on the back of your card.       |
|   The 3 digits on the back of your   |     |   [ gateway CVC field ]   (min-height reserved) |
|   card.                              |     |   X Enter the security code.   (when invalid)  |
|   [ gateway CVC field  ]             |     | ( ) Use a new card                             |
|   X Enter the security code.         |     |                                                |
| ( ) Use a new card                   |     | [            Pay USD 65.00            ]        |
```
American Express: the hint reads "The 4 digits on the front of your card." (brand from the saved method).

### 5.3 States of the CVC field

| State | Trigger | Rendering |
|---|---|---|
| Not required | Fresh session (`auth_time` ≤ 12 h) or a new card | Field not mounted; nothing shown |
| Required (default) | Predicted or server flag true | InlineAlert (info) notice, label, hint, hosted field with reserved height (no layout shift) |
| Loading | Hosted field mounting | Fixed-height skeleton in the field slot; Pay `aria-disabled` "Loading the security code field" |
| Required, empty on Pay | Pay pressed with an empty field | No request. Error text "Enter the security code." under the field; focus into the hosted field; error summary line at the top of the payment section links to the field |
| Invalid | Gateway `change` event reports incomplete or invalid input, shown on blur and on Pay | "The security code is incomplete. Enter {digits} digits." (3, or 4 for American Express); the gateway's own in-frame styling also marks the field. Raw gateway text is never shown |
| Submitting | Pay pressed with a complete code | Pay loading ("Paying…", `aria-busy`); the hosted field is disabled through the gateway API |
| 3DS demanded as well | `REQUIRES_ACTION` | The normal 3-D Secure path (§1) |
| **Check failed** | Payment `FAILED` with `failure_code = AUTHENTICATION_FAILED` on an attempt that carried `cvc_recollection_required: true` and no 3DS challenge was shown. Covers `cvc_check` = `fail`, `unavailable`, `unchecked` or absent (SEC-P3-28: authorisation voided, shipments back to `QUOTED`, attempt counted) | Danger InlineAlert above Pay, `role="alert"`, focused: **"We couldn't verify this card's security code."** / "You haven't been charged. Check the code and try again, use a new card, or confirm it's you." Actions: [Enter the code again] (clears the field and focuses it) · [Use a new card] (selects "Use a new card" and focuses the hosted card fields) · [Confirm it's you] (opens the ReauthDialog; on success `auth_time` is fresh, the CVC field is unmounted and the next Pay needs no code). The third action renders only once the contract names a scope for it (README §5 item 12); until then two actions show. The wording does not distinguish "wrong code" from "bank couldn't check" (both are `AUTHENTICATION_FAILED`) |
| Attempts exhausted | `PAYMENT_ATTEMPTS_EXCEEDED` | Existing alert; CVC field and Pay disabled with the reason |
| Field failed to load | Gateway element mount error | Notice in the field slot "We couldn't load the security code field. Try again, or use a new card." + [Try again]; saved card stays selected; Pay `aria-disabled` with that reason |
| Offline | Network lost | Banner; field stays mounted; Pay `aria-disabled` "You're offline" |

**Mock gateway (local and CI):** the CVC slot renders the Mock gateway's simulated hosted control (a test-mode selector of the documented outcomes: CVC pass, fail, unavailable; SEC-P3-28 item 5), never a free-text code posted to the Platform API. It carries the same label, notice and states, plus the Test mode marking.

### 5.4 Accessibility

- The visible label "Security code (CVC)" and the hint sit **outside** the iframe because `aria-describedby` cannot cross the frame boundary. The iframe gets a `title` ("Secure security code input frame") through the gateway options; the inner input's accessible name is the gateway's. The Platform error text sits directly under the field and is also announced through the polite Announcer on blur and as part of the error summary on Pay. The inner accessibility of the gateway field is a known third-party constraint, verified end to end by qa-lead (W08 §4).
- The notice is an InlineAlert (info, `role="status"`, announced politely when the field appears after the server flag). Focus moves into the hosted field only in the server-flag case (the user pressed Pay and must act); in the predicted case focus is not moved.
- The check-failed alert follows the payment-outcome pattern: `role="alert"`, focus to its heading, three buttons in a group with distinct names. Keyboard path: alert heading → Enter the code again → Use a new card → Confirm it's you → Pay.
- Colour is never the only signal: info and danger alerts carry icons and text.
- No time limit is added. The gateway's own limits apply as for 3DS.

### 5.5 i18n keys

`checkout:cvc.notice` (`{card}` = pre-formatted "Visa •••• 4242"), `checkout:cvc.label`, `checkout:cvc.hint`, `checkout:cvc.hintAmex`, `checkout:cvc.required`, `checkout:cvc.incomplete` (`{digits}`), `checkout:cvc.loadFailed`, `checkout:cvc.failed.title`, `checkout:cvc.failed.body`, `checkout:cvc.failed.retry`, `checkout:cvc.failed.newCard`, `checkout:cvc.failed.reauth`, `a11y:cvcFrame`. Strings in content-and-i18n §4.12.
