---
name: dpm086-payment-rulings-confirmed
description: D-PM-086 (2026-11-20) — QG-040-C7 (d): US-199, AT-US-202-01, REQ-PAY-014 hold under ADR-0012 am. 6/7 (Mock authorises in the checkout request, real gateways never; deletePaymentMethod detach is a worker step after commit); notes on REQ-PAY-002/014 and REQ-BOOK-020; AT-US-202-01 status literal 202 → 201 (contract); removed method not counted in the limit of 10; REQ 1.19, PRD 1.20; next D-PM-087
metadata:
  type: project
---

D-PM-086 confirmed the architect's payment rulings (D-ARCH-205, D-ARCH-206) with no shall-statement change.

- US-199 unchanged (one `authorise`; `mock_ok` → AUTHORISED; two calls with one key → one authorisation).
- AT-US-202-01 holds for the ruling; its response literal was corrected 202 → 201 because `checkoutOrder` answers 201 in `openapi.yaml` and US-038 already said 201. Found while checking the scenario, not asked for.
- REQ-PAY-014 "Removal detaches at the gateway" stays; note added: removal takes effect with the request (not listed, refused at checkout, **not counted towards the limit of 10** — my addition, a TASK-249 card test), detach follows after commit.
- REQ-BOOK-020 note: the authorisation of saga step 1 is obtained at checkout; the worker saga starts from `payment.authorised`; no worker step authorises. Shall-statement left as is (says "as a queued worker job … authorise payment").
- REQ-PAY-002 note: Mock is an in-process simulator and may answer AUTHORISED in the request.

**Why:** the product property behind the rule (no hold on a customer's card without a payment the Platform knows, D-PM-083) concerns real gateways only; a removal that loses a concurrent write must not break a card the user keeps.

**How to apply:**
- When asked to "confirm no change is needed", read the scenario against the API contract too, not only against the ruling: status literals written at P1 can disagree with the P3 contract (here 202 vs 201). The contract wins for status codes; fix the literal in the D-063 wording-amendment form.
- "No story file if avoidable" from the orchestrator is a timing concern (lane-B evidence). A wrong literal in a Must scenario of an upcoming task is not avoidable: edit, say so, and name the latest commit point (before TASK-092 dispatch).
- Rows that move together for payment methods: REQ-PAY-014 note + TASK-249 card (PAYMENT METHOD CALLS, security conditions C-3 to C-9 of D-SECPR040-04).
- D-ARCH-202 answered my D-PM-083 rule: rule (i) compares the version after `load` and before `call` (TASK-096); `cancelShipment` has no `call`; QG-040-C2 is closed. Nothing open there.

Related: [[dpm081-082-idempotency-audit-us038-split]], [[d063-allow-parity-wording]].
