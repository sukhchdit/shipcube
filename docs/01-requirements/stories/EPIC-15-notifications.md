# EPIC-15 — Email notifications

- **Goal:** Customers receive reliable, localised, deduplicated transactional emails for security, booking and tracking events, with no live sends and no mail to third parties during this run.
- **Milestone(s):** M1
- **REQ areas covered:** REQ-NOTIF (REQ-NOTIF-001 to REQ-NOTIF-017)
- **Exit-demo contribution:** PRD §6.2 (M1 demo): the booking confirmation email with documents arrives in the mail catcher in the user's locale; verification and password-reset mail enable sign-up and recovery; milestone emails follow the Mock tracking scenarios.
- **Depends on epics:** EPIC-01 (PLAT: outbox, BullMQ worker, Compose mail catcher REQ-PLAT-005), EPIC-02 (AUTH: verification, reset, security events), EPIC-04 (AUDIT), EPIC-05 (UI/I18N parity), EPIC-09 (BOOK: saga notify step, booking failure), EPIC-10 (PAY: receipts, refunds), EPIC-11 (DOC: attachments), EPIC-12 (PICK: pickup events), EPIC-13 (TRACK: milestone events), EPIC-14 (ACCT: preferences, invitations), EPIC-16 (API/SEC), EPIC-17 (DATA/COMP)

Event names follow DR-B28 (for example `auth.email_verification`, `auth.password_reset`, `auth.security_event`, `order.booked`, `payment.captured`, `tracking.delivered`, `org.invitation_created`). Template IDs are the DR-B28 names (EMAIL_VERIFICATION, PASSWORD_RESET, SECURITY_NOTICE variants, BOOKING_CONFIRMATION, and so on). Email sends are system jobs; permission scenarios therefore concern the log view, preferences and absence of HTTP surfaces.

## Story summary
| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |
|---|---|---|---|---|---|---|---|
| US-274 | Notification provider interface with channel enumeration | M1 | Must | S | EPIC-01 | REQ-NOTIF-001 | DC |
| US-275 | SES adapter verified against recorded fixtures | M1 | Should | S | US-274 | REQ-NOTIF-002 |  |
| US-276 | Local mail catcher only in non-production | M1 | Must | S | US-274, EPIC-01 | REQ-NOTIF-003 | DC |
| US-277 | Map every domain event to exactly one template | M1 | Must | M | US-279 | REQ-NOTIF-004 | DC |
| US-278 | Create notification jobs only from outbox events, idempotently | M1 | Must | M | US-274, EPIC-01 | REQ-NOTIF-014 | DC |
| US-279 | Versioned templates with escaped, locale-aware rendering | M1 | Must | M | US-274 | REQ-NOTIF-005 | DC |
| US-280 | Resolve recipient locale with fallback to en | M1 | Must | S | US-279 | REQ-NOTIF-006 | DC |
| US-281 | CI gate for template and variable parity across locales | M1 | Must | S | US-279 | REQ-NOTIF-017 |  |
| US-282 | Verification, reset and security mails always sent | M1 | Must | M | US-277, US-278, EPIC-02 | REQ-NOTIF-007 | DC |
| US-283 | Booking confirmation email with documents | M1 | Must | M | US-277, US-278, EPIC-11 | REQ-NOTIF-008 | DC |
| US-284 | BullMQ send job with retries and dead-letter queue | M1 | Must | M | US-274, US-278 | REQ-NOTIF-013 | DC |
| US-285 | Address only booking-organisation users | M1 | Must | S | US-277 | REQ-NOTIF-015 |  |
| US-286 | Transactional lifecycle emails | M1 | Should | M | US-277, EPIC-10, EPIC-12 | REQ-NOTIF-009 |  |
| US-287 | Tracking milestone emails | M1 | Should | S | US-277, EPIC-13 | REQ-NOTIF-010 |  |
| US-288 | Suppress tracking emails by preference at send time | M1 | Should | S | US-287, EPIC-14 | REQ-NOTIF-011 |  |
| US-289 | Per-user notification log with PII minimisation | M1 | Should | M | US-284 | REQ-NOTIF-012 |  |
| US-290 | SMS and WhatsApp channel seam | M1 | Could | S | US-274 | REQ-NOTIF-016 |  |

## Stories

### US-274 — Notification provider interface with channel enumeration
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** EPIC-01
- **Linked REQs:** REQ-NOTIF-001
- **As a** platform developer **I want** a provider interface for sending notifications **so that** the delivery channel can be swapped without changing business code.
- **Notes:** `send` takes channel, recipient address, template ID, template version, locale, variables and idempotency key; returns accepted, rejected-permanently or failed-temporarily. Channels EMAIL, SMS, WHATSAPP; only EMAIL implemented (US-290 for the seam). Provider contract test suite shared by adapters.

#### Acceptance criteria
Permission path: not applicable — library interface with no principal; a second negative scenario is included instead.
```gherkin
Feature: Notification provider interface
  Scenario: Accepted send
    Given the mail catcher provider
    When send is called with channel "EMAIL", recipient "ana@acme.test", template "EMAIL_VERIFICATION", version 1, locale "en", variables and an idempotency key
    Then the result is "accepted"

  Scenario: Permanent rejection
    When send is called with recipient "not-an-address"
    Then the result is "rejected-permanently" with a reason code

  Scenario: Temporary failure
    Given the provider is unreachable
    When send is called
    Then the result is "failed-temporarily"

  Scenario: Same idempotency key sends once
    When send is called twice with the same idempotency key
    Then exactly 1 message exists in the mail catcher

  Scenario: Channel enumeration is closed
    When send is called with channel "PIGEON"
    Then it fails with problem code "VALIDATION_ERROR"

  Scenario: Contract suite runs against every adapter
    Then the shared provider contract tests pass for the mail catcher adapter and for the SES adapter against fixtures
```

### US-275 — SES adapter verified against recorded fixtures
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-274
- **Linked REQs:** REQ-NOTIF-002
- **As an** operator **I want** an SES adapter ready for production **so that** the platform can send real mail when a production environment exists.
- **Notes:** Unit-tested against recorded SES API fixtures only; never exercised against AWS in this run (D-018). Enabled only when provider is `ses` with credentials referenced by secret manager. Start-up refuses `ses` in non-production (US-276).

#### Acceptance criteria
Permission path: not applicable — adapter library, no principal.
```gherkin
Feature: SES adapter
  Scenario: Fixture success maps to accepted
    Given a recorded SES "SendEmail" success response
    Then the adapter returns "accepted" with the provider message ID

  Scenario Outline: Fixture errors map to results
    Given a recorded SES response "<error>"
    Then the adapter returns "<result>"
    Examples:
      | error | result |
      | MessageRejected for invalid address | rejected-permanently |
      | Throttling | failed-temporarily |
      | ServiceUnavailable | failed-temporarily |

  Scenario: Adapter disabled by default
    Given provider configuration is not "ses"
    Then the SES adapter is not registered and no AWS client is created

  Scenario: Missing credential reference
    Given provider "ses" without a credential reference
    Then start-up fails with a config error that names the variable and not any value

  Scenario: No network calls in tests
    When the unit suite runs with networking blocked
    Then all SES adapter tests pass

  Scenario: Secrets are never logged
    Then no log line or error message contains a credential value
```

### US-276 — Local mail catcher only in non-production
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-274, EPIC-01
- **Linked REQs:** REQ-NOTIF-003
- **As a** compliance owner **I want** all non-production mail to go to the local catcher **so that** no email reaches a real recipient during development, CI or this run.
- **Notes:** Error code `NOTIFICATION_PROVIDER_FORBIDDEN`. Mail catcher is a Compose service (REQ-PLAT-005). Guardrail "no emails to third parties" (CLAUDE.md §5).

#### Acceptance criteria
Permission path: not applicable — start-up configuration validation, no principal.
```gherkin
Feature: Mail catcher guard
  Scenario: Non-production delivers to the catcher
    Given environment "development" and provider "catcher"
    When a verification email is sent to "ana@acme.test"
    Then the message appears in the mail catcher inbox and no external SMTP connection is made

  Scenario: Non-production with SES is refused
    Given environment "development" and provider "ses"
    When the API starts
    Then start-up aborts with config error "NOTIFICATION_PROVIDER_FORBIDDEN"

  Scenario: CI environment with an external relay is refused
    Given environment "ci" and an SMTP host that is not the catcher
    Then start-up aborts with "NOTIFICATION_PROVIDER_FORBIDDEN"

  Scenario: Catcher host cannot be a public address
    Given the catcher host resolves to a public IP
    Then start-up aborts with "NOTIFICATION_PROVIDER_FORBIDDEN"

  Scenario: Compose brings the catcher up
    When "docker compose up" runs
    Then the mail catcher health check passes and its web UI is reachable on the documented local port

  Scenario: Test run asserts zero external sends
    Then an egress guard test shows no connection to any host other than the catcher during the email suite
```

### US-277 — Map every domain event to exactly one template
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-279
- **Linked REQs:** REQ-NOTIF-004
- **As a** platform developer **I want** a single table mapping domain events to templates **so that** every event produces the right email and none is forgotten.
- **Notes:** DR-B28: auth.email_verification, auth.password_reset, auth.security_event (new-device sign-in, password changed, MFA enabled/disabled, account locked), order.booked, payment.captured, pickup.scheduled, pickup.cancelled, pickup.failed, shipment.booking_failed, tracking.* (5), shipment.cancelled, payment.refunded, payment.refund_failed, org.invitation_created.

#### Acceptance criteria
Permission path: not applicable — mapping table and worker consumer, no principal.
```gherkin
Feature: Event to template mapping
  Scenario Outline: Each event maps to exactly one template
    When event "<event>" is consumed
    Then exactly 1 message with template "<template>" is queued
    Examples:
      | event | template |
      | auth.email_verification | EMAIL_VERIFICATION |
      | auth.password_reset | PASSWORD_RESET |
      | order.booked | BOOKING_CONFIRMATION |
      | payment.captured | PAYMENT_RECEIPT |
      | pickup.scheduled | PICKUP_SCHEDULED |
      | pickup.cancelled | PICKUP_CANCELLED |
      | pickup.failed | PICKUP_FAILED |
      | shipment.booking_failed | BOOKING_FAILED |
      | tracking.picked_up | TRACKING_PICKED_UP |
      | tracking.in_transit | TRACKING_IN_TRANSIT |
      | tracking.out_for_delivery | TRACKING_OUT_FOR_DELIVERY |
      | tracking.delivered | TRACKING_DELIVERED |
      | tracking.exception | TRACKING_EXCEPTION |
      | shipment.cancelled | SHIPMENT_CANCELLED |
      | payment.refunded | REFUND_ISSUED |
      | payment.refund_failed | REFUND_FAILED |
      | org.invitation_created | TEAM_INVITATION |

  Scenario Outline: Security event variants
    When "auth.security_event" with kind "<kind>" is consumed
    Then a SECURITY_NOTICE message of variant "<kind>" is queued
    Examples:
      | kind |
      | new_device_sign_in |
      | password_changed |
      | mfa_enabled |
      | mfa_disabled |
      | account_locked |

  Scenario: Completeness test
    Then a test fails if any event in the DR-B28 table has no template in en, es and fr

  Scenario: Unknown event
    When an event name outside the table is consumed
    Then no email is queued and a warning with the event name is logged and a metric "notification_unmapped_event_total" increases

  Scenario: Event never maps to two templates
    Then the registry test fails when an event name is registered twice

  Scenario: Correlation ID is carried for security mails
    When "auth.security_event" is consumed with correlation ID "c-123"
    Then the send job and log carry "c-123"
```

### US-278 — Create notification jobs only from outbox events, idempotently
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-274, EPIC-01
- **Linked REQs:** REQ-NOTIF-014
- **As an** operator **I want** emails created only from outbox events with an idempotency key **so that** redelivery never sends duplicates and requests never block on mail.
- **Notes:** Idempotency key = event ID + template ID + recipient. Notification creation never occurs inside the request that caused the change. EC-B44.

#### Acceptance criteria
Permission path: not applicable — worker-side pipeline, no principal.
```gherkin
Feature: Outbox-driven notification creation
  Scenario: Event creates one job
    Given an outbox event "order.booked" with ID "E1" for user "ana@acme.test"
    When the notification consumer processes it
    Then exactly 1 job exists with idempotency key "E1:BOOKING_CONFIRMATION:ana@acme.test"

  Scenario: Redelivered event sends once
    When the same outbox event is delivered twice
    Then exactly 1 email is in the mail catcher

  Scenario: Redelivered job sends once
    When the job is delivered twice to workers
    Then exactly 1 email is sent

  Scenario: Request path does not send mail
    When a user registers
    Then the HTTP response returns before any email is sent and the email is produced by the worker after the outbox event

  Scenario: Outbox write failure rolls back the change
    Given the outbox insert fails in the booking transaction
    Then no notification job exists and the booking change is rolled back

  Scenario: Different recipients get separate jobs
    Given one event addressed to two users of the booking organisation
    Then 2 jobs exist with distinct keys

  Scenario: Worker restart resumes
    Given the worker crashes after claiming an event
    When it restarts
    Then the event is processed once
```

### US-279 — Versioned templates with escaped, locale-aware rendering
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-274
- **Linked REQs:** REQ-NOTIF-005
- **As a** customer **I want** well-formed, correctly formatted emails **so that** I can read and trust them.
- **Notes:** Templates are versioned code plus seed, identified by template ID and integer version, each with en, es and fr subject, HTML and plain-text bodies. Variables HTML-escaped. Locale-aware dates, numbers, currencies and units. Sentence parts live in the template; no string concatenation. Template version recorded on every sent message. Links built from the configured base URL only.

#### Acceptance criteria
Permission path: not applicable — rendering library, no principal.
```gherkin
Feature: Template rendering
  Scenario: Render all parts for a locale
    When BOOKING_CONFIRMATION version 1 is rendered for locale "fr" with order number "DE-000000042"
    Then subject, HTML body and plain-text body are produced in French and contain "DE-000000042"

  Scenario: Variables are HTML-escaped
    Given a variable value "<script>alert(1)</script>"
    Then the HTML body contains "&lt;script&gt;" and not "<script>"

  Scenario Outline: Locale-aware formats
    When an amount 1234.50 EUR and date 2026-11-12 are rendered in "<locale>"
    Then the amount appears as "<amount>" and the date as "<date>"
    Examples:
      | locale | amount | date |
      | en | €1,234.50 | Nov 12, 2026 |
      | es | 1234,50 € | 12 nov 2026 |
      | fr | 1 234,50 € | 12 nov. 2026 |

  Scenario: Version recorded on the message
    When a message is sent with BOOKING_CONFIRMATION version 2
    Then the notification log row records template version 2

  Scenario: New version does not change old messages
    Given version 3 is released
    Then log rows of messages sent with version 2 still show version 2

  Scenario: Missing variable
    When a required variable is absent
    Then rendering fails with a structured error naming the variable and no email is sent

  Scenario: Links use the configured base URL
    Given a variable containing "https://evil.example/reset"
    Then the reset link in the email still uses the configured base URL

  Scenario: Both bodies present
    Then every sent email has an HTML part and a plain-text part with equivalent content
```

### US-280 — Resolve recipient locale with fallback to en
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-279
- **Linked REQs:** REQ-NOTIF-006
- **As a** customer **I want** emails in my language **so that** I understand them.
- **Notes:** Resolution order: stored user locale, then the locale given at registration or invitation, then en. Invitee locale is the inviter's selection on the invite form. A missing part is a CI failure (US-281), not a runtime fallback within a template.

#### Acceptance criteria
Permission path: not applicable — resolution function, no principal.
```gherkin
Feature: Email locale resolution
  Scenario: Stored locale wins
    Given user locale "es" and registration locale "fr"
    When an email is sent
    Then the Spanish template is used

  Scenario: Fallback to registration locale
    Given the user has no stored locale and registration locale "fr"
    Then the French template is used

  Scenario: Invitation uses the inviter's selection
    When the inviter selects locale "fr" on the invite form
    Then the TEAM_INVITATION email is French

  Scenario: Fallback to en when nothing is known
    Given no stored or registration locale
    Then the English template is used

  Scenario: Unsupported locale value falls back to en
    Given stored locale "de"
    Then the English template is used and a warning is logged

  Scenario: Template missing a locale part falls back to en at runtime and alerts
    Given template "PICKUP_FAILED" has no Spanish part despite CI checks
    When an email is sent to a Spanish user
    Then the message is sent in English, the metric "notification_locale_fallback_total" increases and the log row records locale "en"

  Scenario: Locale change applies to the next email
    When a user changes locale to "fr" in the account
    Then the next email in the mail catcher is French
```
Note: the last-resort runtime fallback in the "missing locale part" scenario reconciles REQ-NOTIF-006 ("never send a template in a locale for which any part is missing") with the default decision to send in en; the CI gate (US-281) is the primary control. See the report for the flagged ambiguity.

### US-281 — CI gate for template and variable parity across locales
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-279
- **Linked REQs:** REQ-NOTIF-017
- **As a** release manager **I want** the build to fail when any template locale part is missing **so that** broken emails never ship.
- **Notes:** Same mechanism as i18n key parity (REQ-I18N, EPIC-05). Checks subject, HTML and plain-text in en, es and fr and that variables referenced in one locale exist in the others.

#### Acceptance criteria
Permission path: not applicable — build tooling, no principal.
```gherkin
Feature: Template parity gate
  Scenario: Complete templates pass
    When the parity check runs on the repository
    Then it exits with code 0

  Scenario Outline: Missing part fails the build
    Given template "BOOKING_CONFIRMATION" lacks the <part> in locale "<locale>"
    When the parity check runs
    Then it exits non-zero and names the template, part and locale
    Examples:
      | part | locale |
      | subject | es |
      | HTML body | fr |
      | plain-text body | es |

  Scenario: Variable missing in another locale fails the build
    Given the English body uses "{trackingNumber}" and the French body does not
    Then the check fails naming the variable and locale

  Scenario: Extra variable in one locale fails
    Given the Spanish body references "{unknownVar}" not present in English
    Then the check fails

  Scenario: Check runs in CI as a required job
    Then the CI workflow includes the check as a required status on pull requests

  Scenario: New event without template fails the completeness test
    Given a new event is added to the DR-B28 table without a template
    Then the mapping completeness test fails
```

### US-282 — Verification, reset and security mails always sent
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-277, US-278, EPIC-02
- **Linked REQs:** REQ-NOTIF-007
- **As a** customer **I want** account verification, password reset and security alerts delivered regardless of my preferences **so that** I can verify, recover and protect my account.
- **Notes:** Behaviour of tokens and expiry is EPIC-02 (verification gates checkout, D-009; reset token valid 60 minutes, REQ-AUTH-011). This story covers transport and preference immunity. Locale per US-280. Security emails carry the event correlation ID. Demo-critical.

#### Acceptance criteria
```gherkin
Feature: Always-sent account emails
  Background:
    Given user "ana@acme.test" with locale "es" whose "tracking_updates" and "marketing" preferences are off

  Scenario: Registration sends a verification email
    When Ana registers
    Then an EMAIL_VERIFICATION message in Spanish arrives in the mail catcher with a link on the configured base URL

  Scenario: Password reset request sends a reset email
    When Ana requests a password reset
    Then a PASSWORD_RESET message arrives in the mail catcher

  Scenario: Unknown email gets no message but an identical response
    When a reset is requested for "ghost@acme.test"
    Then the HTTP response equals that for a known address and no email is sent

  Scenario Outline: Security notices are sent regardless of preferences
    When the event "<kind>" occurs for Ana
    Then a SECURITY_NOTICE message is delivered despite her preferences being off
    Examples:
      | kind |
      | new_device_sign_in |
      | password_changed |
      | mfa_enabled |
      | mfa_disabled |
      | account_locked |

  Scenario: Preferences cannot suppress them
    When a client attempts to set a preference named "security_notices" to false
    Then the response is 400 with problem code "VALIDATION_ERROR" and no preference is stored

  Scenario: Provider failure retries then dead-letters
    Given the mail provider fails temporarily on every attempt
    Then the job is retried 5 times and ends in the dead-letter queue as in US-284, and the HTTP request that triggered it still succeeded

  Scenario: No secrets in the notification log
    Then the log row for a reset email contains no token and no link

  Scenario: Security mail carries the correlation ID
    Then the security email job and log row include the correlation ID of the originating event

  Scenario: Unauthenticated trigger routes are not rate-bypassed
    When 11 reset requests per minute come from one IP
    Then the 11th returns 429 "RATE_LIMITED" and no extra email is sent

  Scenario: Audit of account-locked mail
    Then the audit entry for the lock event references the notification correlation ID and contains no email body
```
Permission path: covered by the unauthenticated rate-limit and the unknown-email scenarios; delivery is system-driven.

### US-283 — Booking confirmation email with documents
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-277, US-278, EPIC-11
- **Linked REQs:** REQ-NOTIF-008
- **As a** shipper **I want** a confirmation email with my labels and documents **so that** I have everything I need to hand over my shipment.
- **Notes:** Sent once per order after the saga reaches the notify step. Contains order number, per-shipment carrier, service, tracking number, pickup reference or drop-off point; documents attached up to 10 MB total, otherwise an account link (same rule as REQ-DOC-010). Demo-critical (PRD §6.2). Shipment-level audit and document download audit are EPIC-11.

#### Acceptance criteria
```gherkin
Feature: Booking confirmation email
  Background:
    Given booking user "ana@acme.test" with locale "es" who booked order "DE-000000042" with 2 shipments

  Scenario: Confirmation arrives in the mail catcher with details
    When the saga reaches the notify step
    Then exactly 1 BOOKING_CONFIRMATION email in Spanish is addressed to "ana@acme.test"
    And it lists for each shipment the carrier, service, tracking number and pickup reference or drop-off point

  Scenario: Documents attached when total size is within 10 MB
    Given documents total 4 MB
    Then the label and invoice PDFs are attached

  Scenario: Documents over 10 MB become an account link
    Given documents total 11 MB
    Then no attachment is present and the email contains a link to the order in the account on the configured base URL

  Scenario: Exactly 10 MB boundary
    Given documents total exactly 10 MB
    Then the documents are attached

  Scenario: Voided or superseded documents are not attached
    Given one label is VOIDED
    Then only CURRENT documents are attached

  Scenario: Duplicate saga delivery sends once
    When the notify step runs twice
    Then exactly 1 confirmation email exists

  Scenario: Mail failure does not undo the booking
    Given the provider fails permanently
    Then the booking stays BOOKED, the log shows DEAD_LETTERED or FAILED and an alert metric increases

  Scenario: Documents still pending
    Given documents are still generating
    Then the email is sent with an account link and the later documents are available in the account

  Scenario: Only the booking user receives it
    Then neither the sender nor receiver contact addresses receive any email

  Scenario: Email content excludes sensitive data
    Then the email contains no tax or ID references, no full receiver street address and no payment card data

  Scenario: Attachment access is not an unaudited download bypass
    Then attachments are generated from stored documents by the worker and an audit entry "DOWNLOAD" with actor type system and the booking user ID exists per attached document

  Scenario: Unauthenticated access to attachments
    Then no URL in the email grants access without sign-in

  Scenario: SENSITIVE document is excluded from attachments (REQ-NOTIF-008, D-051)
    Given order "DE-000000042" has a US -> IN shipment whose commercial invoice carries a FULL receiver reference and is classified "SENSITIVE"
    When the saga reaches the notify step
    Then the invoice is not attached
    And the email names the invoice and links to the authenticated shipment page

  Scenario: Label and pickup confirmation stay attached
    Given the same order with a label of 1 MB, a pickup confirmation of 1 MB and a SENSITIVE invoice
    Then the label and the pickup confirmation are attached within the 10 MB total
    And the demo step "confirmation email with documents arrives" (PRD 6.2) is met by the label attachment plus the invoice link

  Scenario: No SENSITIVE document leaves attachment behaviour unchanged
    Given no document of the order is classified "SENSITIVE"
    Then the attachment rules above (10 MB boundary, account link over 10 MB, CURRENT only) apply unchanged
```

### US-284 — BullMQ send job with retries and dead-letter queue
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-274, US-278
- **Linked REQs:** REQ-NOTIF-013
- **As an** operator **I want** email sends retried with backoff and failed ones dead-lettered with an alert **so that** transient provider issues do not lose mail and permanent ones are visible.
- **Notes:** 5 attempts, exponential backoff 30 s base factor 2 (30 s, 60 s, 120 s, 240 s), no retry on permanent rejection (for example invalid recipient), dead-letter queue with alert metric after final failure. Job ID is the idempotency key. Log shows DEAD_LETTERED.

#### Acceptance criteria
Permission path: not applicable — worker job, no principal; the permanent-rejection and exhausted-retry scenarios are negative paths.
```gherkin
Feature: Send job retries and dead-letter
  Scenario: Success on first attempt
    When the send job runs with a healthy provider
    Then the log status is "SENT" with attempt count 1

  Scenario: Transient failure then success
    Given the provider fails twice temporarily then accepts
    Then the job succeeds on attempt 3 with delays of about 30 s and 60 s using the fake clock
    And the log shows status "SENT" and attempt count 3

  Scenario: Retries exhausted go to the dead-letter queue
    Given the provider fails temporarily on every attempt
    Then after 5 attempts the job is moved to the dead-letter queue
    And the log status is "DEAD_LETTERED" and the metric "notification_dead_letter_total" increases by 1

  Scenario: Permanent rejection is not retried
    Given the provider rejects the recipient permanently
    Then the job ends after 1 attempt with status "FAILED" and no dead-letter retry

  Scenario: Job ID is the idempotency key
    When two jobs with the same key are added
    Then only one job exists

  Scenario: Worker crash mid-send does not duplicate
    Given the worker crashes after the provider accepted but before the ack
    When the job is retried
    Then the provider idempotency key prevents a second message

  Scenario: Dead-lettered message is visible in the user log
    Then the owner's notification log shows the message as "DEAD_LETTERED"

  Scenario: Alert fires on dead-letter
    Then the alert rule "notification_dead_letter" is triggered in the metrics test
```

### US-285 — Address only booking-organisation users
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-277
- **Linked REQs:** REQ-NOTIF-015
- **As a** compliance owner **I want** emails only to users of the booking organisation or the invited address **so that** no unsolicited mail goes to third parties.
- **Notes:** Receiver and sender contacts never receive email in M1 (GAP-B-21). Recipient is the booking user, except invitations (invited address) and authentication events (the account).

#### Acceptance criteria
Permission path: not applicable — recipient policy in the worker; the third-party scenarios are the negatives.
```gherkin
Feature: Recipient policy
  Scenario: Shipment events go to the booking user
    Given a shipment booked by "ana@acme.test" with receiver email "bob@example.org" and sender email "carl@example.org"
    When "tracking.delivered" is consumed
    Then the only addressee is "ana@acme.test"

  Scenario: Receiver and sender are never addressed
    When any shipment, payment or pickup event is consumed
    Then no message is queued for "bob@example.org" or "carl@example.org", including in cc or bcc

  Scenario: Invitation goes only to the invited address
    When "org.invitation_created" is consumed for "sam@acme.test"
    Then the only addressee is "sam@acme.test"

  Scenario: Authentication events go to the account
    When "auth.security_event" is consumed for "ana@acme.test"
    Then the only addressee is "ana@acme.test"

  Scenario: Booking user removed from the organisation
    Given the booking user left the organisation before the event
    Then the email goes to the booking user's address only if they still have an active account, otherwise no email is sent and the log records the reason

  Scenario: Addresses in variables cannot redirect mail
    Given a variable value contains "bcc: evil@example.org"
    Then the message headers contain no extra recipient

  Scenario: Static check
    Then a test fails if any template or job adds a recipient taken from shipment sender or receiver fields
```

### US-286 — Transactional lifecycle emails
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-277, EPIC-10, EPIC-12
- **Linked REQs:** REQ-NOTIF-009
- **As a** shipper **I want** emails for payment, pickup, booking failure, cancellation and refund events **so that** I know the outcome without checking the account.
- **Notes:** Templates PAYMENT_RECEIPT, PICKUP_SCHEDULED, PICKUP_CANCELLED, PICKUP_FAILED, BOOKING_FAILED, SHIPMENT_CANCELLED, REFUND_ISSUED, REFUND_FAILED. BOOKING_FAILED states the canonical reason and next action (REQ-BOOK-023). EC-B02, EC-B17, EC-B32. These are transactional: not suppressed by preferences.

#### Acceptance criteria
Permission path: not applicable — system-triggered; cross-tenant and recipient scenarios apply.
```gherkin
Feature: Transactional lifecycle emails
  Background:
    Given booking user "ana@acme.test" with locale "fr" and "tracking_updates" off

  Scenario Outline: Event sends the matching email in the user's locale
    When event "<event>" occurs
    Then a "<template>" email in French reaches the mail catcher
    Examples:
      | event | template |
      | payment.captured | PAYMENT_RECEIPT |
      | pickup.scheduled | PICKUP_SCHEDULED |
      | pickup.cancelled | PICKUP_CANCELLED |
      | pickup.failed | PICKUP_FAILED |
      | shipment.booking_failed | BOOKING_FAILED |
      | shipment.cancelled | SHIPMENT_CANCELLED |
      | payment.refunded | REFUND_ISSUED |
      | payment.refund_failed | REFUND_FAILED |

  Scenario: Booking failed states reason and next action
    Given a Mock "fail=booking" with canonical error "SERVICE_UNAVAILABLE"
    Then the BOOKING_FAILED email shows the localised reason, states no charge was made and links to the draft

  Scenario: Pickup failure offers alternatives
    Given Mock "fail=pickup"
    Then the PICKUP_FAILED email states the booking stands and offers schedule pickup or drop-off

  Scenario: Refund failed states the refund is delayed
    Given Mock "mock_refund_fail"
    Then the REFUND_FAILED email states the refund is delayed

  Scenario: Preferences do not suppress them
    Then all of the above are sent although "tracking_updates" is off

  Scenario: Redelivery sends once
    When "payment.refunded" is delivered twice
    Then exactly 1 REFUND_ISSUED email is sent

  Scenario: Amounts use the sell currency and locale
    Then the receipt shows the paid amount in the order currency with French formatting and the test-mode indicator in test mode

  Scenario: Cross-tenant data never mixes
    Given two organisations with simultaneous refunds
    Then each email contains only its own organisation's order numbers

  Scenario: Payment data minimisation
    Then no email contains card numbers; only brand and last four digits may appear
```

### US-287 — Tracking milestone emails
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-277, EPIC-13
- **Linked REQs:** REQ-NOTIF-010
- **As a** shipper **I want** emails when my shipment is picked up, in transit, out for delivery, delivered or in exception **so that** I can follow progress without checking.
- **Notes:** Sent to the booking user for events from REQ-TRACK-007 (US-246). Content: order number, tracking number, carrier, canonical status and city-level location; no names or street addresses. Demo-relevant: Mock scenarios drive each milestone. Flagged: PRD demo implies Must but REQ is Should.

#### Acceptance criteria
Permission path: not applicable — system-triggered; recipient restriction scenario covers third-party denial.
```gherkin
Feature: Tracking milestone emails
  Background:
    Given booking user "ana@acme.test" with locale "en" and "tracking_updates" on, and a Mock shipment with "track=happy_path"

  Scenario Outline: Milestone email per canonical status
    When the fake clock reaches the "<status>" step
    Then a "<template>" email arrives in the mail catcher with order number, tracking number, carrier, status "<status>" and a city and country
    Examples:
      | status | template |
      | PICKED_UP | TRACKING_PICKED_UP |
      | IN_TRANSIT | TRACKING_IN_TRANSIT |
      | OUT_FOR_DELIVERY | TRACKING_OUT_FOR_DELIVERY |
      | DELIVERED | TRACKING_DELIVERED |

  Scenario: Exception scenario sends an exception email
    Given "track=exception"
    Then a TRACKING_EXCEPTION email is sent

  Scenario: Email contains no personal data
    Given the carrier free text is "Signed by J. Smith, 12 High Street"
    Then the email does not contain "J. Smith", "High Street", a postcode, a phone number or the facility name

  Scenario: Locale
    Given the user's locale is "es"
    Then the subject and body are Spanish

  Scenario: Duplicate events do not repeat the email
    When the same DELIVERED event is polled twice
    Then exactly 1 TRACKING_DELIVERED email exists

  Scenario: Second IN_TRANSIT event does not send
    Then only the first IN_TRANSIT occurrence triggers an email

  Scenario: Late event after DELIVERED sends nothing
    Then no email is sent for events stored after DELIVERED

  Scenario: Only the booking user receives it
    Then the receiver contact receives nothing

  Scenario: Tracking link uses the configured base URL
    Then the link in the email points to the public tracking page of the configured base URL with the tracking number
```

### US-288 — Suppress tracking emails by preference at send time
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-287, EPIC-14
- **Linked REQs:** REQ-NOTIF-011
- **As a** customer **I want** to stop tracking update emails **so that** my inbox is not flooded while security emails still arrive.
- **Notes:** Preference is read at send time, not event time. Suppressed messages are logged with status SUPPRESSED_BY_PREFERENCE. Never applies to verification, reset and security notices. EC-B44. Demo: notification preferences for tracking updates.

#### Acceptance criteria
Permission path: not applicable — system job; user preference changes are covered with permission scenarios in US-266.
```gherkin
Feature: Preference suppression
  Background:
    Given booking user "ana@acme.test"

  Scenario: Preference off suppresses the tracking email
    Given "tracking_updates" is off
    When "tracking.out_for_delivery" is consumed
    Then no email reaches the mail catcher
    And a log row with status "SUPPRESSED_BY_PREFERENCE" exists

  Scenario: Preference on sends the email
    Given "tracking_updates" is on
    Then the email is sent

  Scenario: Preference is read at send time
    Given "tracking_updates" was on at event time and Ana turns it off before the job runs
    Then the email is suppressed

  Scenario: Turned on after the event does not send past suppressed mail
    Given the email was suppressed earlier
    When Ana turns the preference on
    Then the suppressed message is not sent retroactively

  Scenario: Security mail is never suppressed
    Given "tracking_updates" is off
    When a password reset is requested
    Then the reset email is sent

  Scenario: Transactional lifecycle mail is not suppressed
    Given "tracking_updates" is off
    Then BOOKING_CONFIRMATION and PICKUP_FAILED emails are sent

  Scenario: Redelivery of a suppressed event stays suppressed once
    When the same event is delivered twice
    Then exactly 1 suppression log row exists

  Scenario: Preference read failure fails safe
    Given the preference store is unavailable
    Then the job is retried and no email is sent until the preference can be read

  Scenario: Audit of preference change
    When Ana turns the preference off
    Then an audit entry "UPDATE" on entity "notification_pref" exists (see US-266)
```

### US-289 — Per-user notification log with PII minimisation
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-284
- **Linked REQs:** REQ-NOTIF-012
- **As a** customer **I want** to see which emails the platform sent me **so that** I can check that confirmations were delivered.
- **Notes:** Log fields: message ID, template ID and version, locale, channel, recipient user ID, recipient address in masked form (`a***@domain`, REQ-PLAT-012 rule) as at send time, status (QUEUED, SENT, FAILED, DEAD_LETTERED, SUPPRESSED_BY_PREFERENCE), attempt count, timestamps. Variables stored with PII redacted (order number, tracking number, carrier, canonical status and city kept; names, street addresses, phone numbers, references dropped); rendered subject and body not stored; no clear-text email address (D-040 reconciles REQ-NOTIF-012 with NFR-PRIV-004). Permission `notification:read`, own log only. Viewing writes `VIEW`. Staff view is M2.

#### Acceptance criteria
```gherkin
Feature: Notification log
  Background:
    Given user "ana@acme.test" with role "Shipper" who received a booking confirmation and a suppressed tracking email

  Scenario: Own log lists messages
    When Ana opens "GET /v1/notifications"
    Then the response is 200 with both entries showing template ID, version, locale, channel "EMAIL", recipient, status, attempt count and timestamps

  Scenario: Variables are redacted and body is absent
    Then stored variables keep "orderNumber" and drop receiver name, street, phone and references
    And the response contains no rendered subject or body

  Scenario: Recipient address as at send time, masked
    Given Ana later changes her email
    Then old log rows still show the masked form of the address used at send time (for example "a***@acme.test")
    And no log row stores a clear-text email address

  Scenario Outline: Status values
    Then log rows can show the status "<status>"
    Examples:
      | status |
      | QUEUED |
      | SENT |
      | FAILED |
      | DEAD_LETTERED |
      | SUPPRESSED_BY_PREFERENCE |

  Scenario: Only own messages
    Given organisation colleague "cora@acme.test" also received messages
    When Ana lists the log
    Then Cora's messages are not returned

  Scenario: Cross-tenant message ID
    When Ana requests a message ID of another organisation
    Then the response is 404 with problem code "NOT_FOUND"

  Scenario: Unauthenticated
    Then the request returns 401 with problem code "AUTH_REQUIRED"

  Scenario: Role without notification:read
    Given a custom role lacking "notification:read"
    Then the response is 403 with problem code "AUTHZ_DENIED"

  Scenario: Pagination
    Given 60 log rows
    Then the list is cursor-paginated at 25 per page by default

  Scenario: Audit VIEW
    When Ana opens the log
    Then an audit entry with action "VIEW" and entity "notification" exists without message contents

  Scenario: Redaction is tested
    Then a unit test with synthetic names, addresses and phone numbers asserts they never appear in stored variables

  Scenario Outline: Screen states, locales and responsive
    When the log screen is shown in "<locale>" at "<viewport>"
    Then the six states render, rows are a table at 1280 px and cards at 360 px, and axe-core reports no violations
    Examples:
      | locale | viewport |
      | en | 1280 px |
      | es | 360 px |
      | fr | 360 px |
```

### US-290 — SMS and WhatsApp channel seam
- **Milestone:** M1 · **MoSCoW:** Could · **Size:** S · **Depends on:** US-274
- **Linked REQs:** REQ-NOTIF-016
- **As a** platform developer **I want** SMS and WhatsApp reserved in the interface with no implementation **so that** later channels need no interface change.
- **Notes:** Seam only. No user-facing preference for these channels. Error `CHANNEL_NOT_AVAILABLE`.

#### Acceptance criteria
Permission path: not applicable — interface seam, no principal.
```gherkin
Feature: SMS and WhatsApp seam
  Scenario Outline: Send on an unimplemented channel
    When send is called with channel "<channel>"
    Then it fails with error "CHANNEL_NOT_AVAILABLE" and no network call is made
    Examples:
      | channel |
      | SMS |
      | WHATSAPP |

  Scenario: Enumeration retains both values
    Then the channel enumeration contains EMAIL, SMS and WHATSAPP

  Scenario: No preference UI
    Then the notification preferences screen shows no SMS or WhatsApp control

  Scenario: No log row is created as SENT
    When an SMS send is attempted
    Then no notification log row with status "SENT" is created
```

## Coverage check
| REQ | Stories |
|---|---|
| REQ-NOTIF-001 | US-274 |
| REQ-NOTIF-002 | US-275 |
| REQ-NOTIF-003 | US-276 |
| REQ-NOTIF-004 | US-277 |
| REQ-NOTIF-005 | US-279 |
| REQ-NOTIF-006 | US-280 |
| REQ-NOTIF-007 | US-282 |
| REQ-NOTIF-008 | US-283 |
| REQ-NOTIF-009 | US-286 |
| REQ-NOTIF-010 | US-287 |
| REQ-NOTIF-011 | US-288 |
| REQ-NOTIF-012 | US-289 |
| REQ-NOTIF-013 | US-284 |
| REQ-NOTIF-014 | US-278 |
| REQ-NOTIF-015 | US-285 |
| REQ-NOTIF-016 | US-290 |
| REQ-NOTIF-017 | US-281 |

Every Must REQ (REQ-NOTIF-001, 003, 004, 005, 006, 007, 008, 013, 014, 015, 017) is linked by at least one Must story.
