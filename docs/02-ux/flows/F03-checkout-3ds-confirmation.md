# F03 — Checkout (3-D Secure), booking progress and confirmation

Stories: **US-204, US-205, US-206, US-207, US-208, US-209, US-210, US-211, US-212, US-214, US-195, US-223, US-224, US-225, US-226, US-235, US-236** (Must) · US-217, US-218, US-228, US-188, US-239 (Should) · Screens S-B06, S-B07

## 1. Checkout gate (US-208)

```mermaid
flowchart TD
  A0["Continue to payment"] --> A1{"Checkout start response"}
  A1 -->|OK| A2["Order number allocated,<br/>shipments PENDING_PAYMENT,<br/>open /checkout/orderId"]
  A1 -->|"403 EMAIL_NOT_VERIFIED"| A3["Blocking panel on review:<br/>Verify your email to pay.<br/>Resend email / I have verified (re-check)"]
  A3 -->|verified in another tab: broadcast| A0
  A1 -->|"409 QUOTE_EXPIRED"| A4["Panel naming the shipment:<br/>prices expired. Get new prices (F01 §4)"]
  A1 -->|"422 VALIDATION_ERROR step incomplete"| A5["Panel: Shipment 2 - Collection is incomplete.<br/>Resolve (link to step)"]
  A1 -->|"422 ITEM_PROHIBITED"| A6["Panel: an item can no longer be shipped.<br/>Edit contents (link)"]
  A1 -->|"422 DG_ATTESTATION_REQUIRED"| A7["Panel: confirm no dangerous goods.<br/>Go to Contents"]
  A1 -->|"403 AUTHZ_DENIED"| A8["Permission-denied state"]
  A1 -->|offline or 5xx| A9["Error with Try again"]
```

Each blocking panel is an InlineAlert (danger) placed above "Continue to payment". On insertion, focus moves to the alert heading (`tabindex=-1`). It contains a single resolve action.

## 2. Pay with card, 3-D Secure and declines (US-209, US-211, US-212, US-214)

```mermaid
flowchart TD
  P0["Checkout page: order summary, amount to be charged<br/>in sell currency, Test mode badge"] --> P1["Card in gateway hosted fields<br/>container reserves height (no layout shift)"]
  P1 --> P2["Pay USD 65.00 (single idempotency key per attempt)"]
  P2 --> P3["Button loading, aria-busy, repeat clicks ignored"]
  P3 --> P4{"Payment result"}
  P4 -->|"AUTHORISED"| P5["Navigate to /orders/id/confirmation<br/>progress state (§3)"]
  P4 -->|"REQUIRES_ACTION (3DS)"| P6["Gateway challenge opens (gateway-owned frame).<br/>Page announces: Your bank is asking you to confirm"]
  P6 --> P7{"Challenge outcome"}
  P7 -->|completed| P5
  P7 -->|"failed or abandoned: AUTHENTICATION_FAILED"| P8["Error alert: Your bank couldn't confirm this payment.<br/>Try again or use another card. Shipments back to QUOTED"]
  P8 --> P1
  P4 -->|"CARD_DECLINED / INSUFFICIENT_FUNDS / EXPIRED_CARD"| P9["Error alert with the localised reason<br/>(raw gateway text never shown). Card fields kept for edit"]
  P9 --> P1
  P4 -->|"GATEWAY_UNAVAILABLE"| P10["Error state with Try again;<br/>order stays payable"]
  P10 --> P2
  P4 -->|"429 PAYMENT_ATTEMPTS_EXCEEDED"| P11["Blocking alert: too many attempts for this order.<br/>Try again after time. Pay button disabled with reason"]
  P4 -->|"409 AMOUNT_MISMATCH"| P12["Alert: the total changed. Review the new total<br/>(page reloads summary)"]
  P4 -->|"422 AMOUNT_BELOW_MINIMUM"| P13["Alert: the order total is below the minimum card payment"]
  P4 -->|"409 QUOTE_EXPIRED"| P14["Back to review with the expired panel"]
```

### 2a. Saved card with CVC re-collection (Should, US-217; W08 §5; SEC-P3-28)

```mermaid
flowchart TD
  C0["Saved card selected"] --> C1{"now - auth_time > 12 h? (client prediction)"}
  C1 -->|No| C2["No CVC field"]
  C1 -->|Yes| C3["Hosted CVC field mounts under the card<br/>notice: For your security, enter the security code"]
  C2 --> C4["Pay"]
  C3 --> C4
  C4 --> C5{"CVC field shown and empty or incomplete?"}
  C5 -->|Yes| C6["No request. Inline error; focus into the hosted field"] --> C4
  C5 -->|No| C7["checkoutOrder (saved_payment_method_id)"]
  C7 --> C8{"cvc_recollection_required"}
  C8 -->|"true, field not shown"| C9["Pay back to idle; field mounts; notice announced;<br/>focus into the field. Nothing charged"] --> C4
  C8 -->|"false, field shown"| C10["Field unmounted; continue"]
  C8 -->|"matches"| C11["Gateway confirm (CVC inside the iframe)"]
  C10 --> C11
  C11 --> C12{"Result"}
  C12 -->|AUTHORISED| P5b["Confirmation (§3)"]
  C12 -->|REQUIRES_ACTION| P6b["3-D Secure (§2)"]
  C12 -->|"FAILED AUTHENTICATION_FAILED<br/>(cvc_check not pass: authorisation voided, shipments QUOTED, attempt counted)"| C13["Alert: We couldn't verify this card's security code.<br/>You haven't been charged."]
  C13 -->|"Enter the code again"| C3
  C13 -->|"Use a new card"| P1b["'Use a new card' selected; focus to hosted card fields"]
  C13 -->|"Confirm it's you (when the contract has a scope, README §5 item 12)"| C14["ReauthDialog (F10 §4)"] --> C15["auth_time fresh: CVC field unmounted"] --> C4
  C12 -->|"429 PAYMENT_ATTEMPTS_EXCEEDED"| P11b["Blocking alert: too many attempts; Pay and CVC field disabled with reason"]
```

Notes
- Only card is rendered (US-211). PayPal, wallet, credit account and payment links never appear in M1.
- Saved cards (Should, US-217) show as RadioCards above "Use a new card". A saved card that needs 3DS follows the same REQUIRES_ACTION branch. A saved card in a session verified more than 12 h ago follows §2a (CVC re-collection).
- If the session expires during checkout, the gateway challenge result is preserved by the gateway. On return after sign-in, the page re-reads the payment status before offering "Pay" again, so the user is never charged twice (idempotency key per attempt).

## 3. Booking progress (US-207) → confirmation (US-195)

```mermaid
flowchart TD
  G0["/orders/id/confirmation opens in progress state"] --> G1["Saga steps list:<br/>Payment authorised, Booking with carrier, Payment taken,<br/>Preparing documents, Scheduling pickup, Sending confirmation"]
  G1 --> G2{"Status stream"}
  G2 -->|"blocked"| G3["Poll every 3 s, same rendering"]
  G2 -->|events| G4["Step done within 2 s of server; polite announcement per step"]
  G3 --> G4
  G4 --> G5{"Outcome"}
  G5 -->|"LABEL_READY (+ pickup scheduled)"| G6["Confirmation content replaces progress.<br/>Focus to h1 Your shipment is booked"]
  G5 -->|"definitive carrier rejection: compensated"| G7["Danger panel (assertive): We couldn't book this shipment with carrier.<br/>You have not been charged; the hold on your card is released.<br/>Choose another service"]
  G5 -->|"ambiguous outcome: EXCEPTION"| G8["Warning panel: We're still confirming your booking with carrier.<br/>You have not been charged yet. We'll email you.<br/>View shipment"]
  G5 -->|"pickup failed: PICKUP_UNAVAILABLE"| G9["Booked + warning: pickup could not be scheduled.<br/>Schedule pickup (dialog, §4)"]
  G5 -->|"documents still generating"| G10["Booked; documents row shows Preparing,<br/>updates without reload"]
  G5 -->|"multi-shipment, some failed"| G11["Per-shipment result cards: booked ones charged;<br/>failed ones not charged with next action"]
  G2 -.offline.-> G12["Offline banner: progress paused, reconnect resumes"]
  G6 --> G13["Download label / invoice (§5), copy tracking number,<br/>Track link, pickup ref and window, next steps, paid amount, Test mode"]
```

## 4. Schedule pickup after booking (US-236; also from shipment detail)

```mermaid
flowchart TD
  H0["Schedule pickup (button)"] --> H1["Dialog: date picker + window + instructions<br/>(same rules as step 3)"]
  H1 --> H2["Schedule"]
  H2 --> H3{"Response"}
  H3 -->|OK| H4["Dialog closes; toast + on-page Pickup scheduled,<br/>reference and window; status PICKUP_SCHEDULED"]
  H3 -->|"409 PICKUP_ALREADY_SCHEDULED"| H5["Alert in dialog; page refreshes pickup section"]
  H3 -->|"422 PICKUP_DATE_INVALID or WINDOW_INVALID"| H6["Inline error beside date or window"]
  H3 -->|"carrier rejects: PICKUP_UNAVAILABLE"| H7["Alert in dialog: carrier couldn't accept this pickup.<br/>Choose another date, or drop off instead (if supported)"]
  H3 -->|"409 ILLEGAL_STATE_TRANSITION"| H8["Alert: this shipment can no longer be collected"]
```

## 5. Document download (US-224, US-225, US-226)

```mermaid
flowchart TD
  D0["Download label (v1, PDF)"] --> D1["Button preparing state"]
  D1 --> D2{"Response"}
  D2 -->|"URL issued"| D3["Browser download starts (attachment).<br/>Button returns to idle; status text: Downloaded"]
  D2 -->|"403 AUTHZ_DENIED (Viewer)"| D4["Button was rendered disabled with reason<br/>You don't have permission to download"]
  D2 -->|"404 NOT_FOUND"| D5["Inline error: document not available"]
  D2 -->|"503 AUDIT_UNAVAILABLE"| D6["Inline error: downloads are paused for a moment. Try again"]
  D2 -->|"document VOID"| D7["Row shows Void; download disabled with reason"]
  D2 -->|"410 DOWNLOAD_EXPIRED (link reused late)"| D8["Re-request automatically once, then error"]
```

## 6. State summary

| State | Checkout (S-B06) | Progress and confirmation (S-B07) |
|---|---|---|
| Loading | Summary and payment area skeletons. The payment area reserves its height. | Saga list renders immediately with all steps "Pending". Document rows are skeletons. |
| Empty | Not applicable (no order means not found) | Documents "Documents are being prepared" (US-224) |
| Error | Gateway or 5xx: error state with Try again. Declines show an inline alert. | Stream and poll failure: error panel with Try again and correlation ID. Booking failure panel. |
| Partial | Saved methods failed to load: "Use a new card" still shown, with a notice | Multi-shipment partial booking; pickup failed; documents pending |
| Permission-denied | Viewer: permission-denied (403). Another organisation: not found. | Without `shipment:read`: permission-denied. Another organisation: not found. |
| Offline | Banner; Pay disabled with reason | Banner; progress paused; resumes and re-syncs on reconnect |
