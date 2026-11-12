# ADR-0020: Notifications — provider interface, SES adapter, local SMTP catcher, versioned templates, event mapping

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.13, §3.3 (inbound email per tenant, M4); REQ-NOTIF-001..017, DR-A18 (locale), DR-B28 (event → template); D-018; A-072, A-076; NFR-PRIV-004, NFR-I18N-002; ADR-0004 (events), ADR-0013 (queue)

## Decision

1. **Provider interface** `NotificationProvider { channel: 'EMAIL' | 'SMS' | 'WHATSAPP'; send(message: RenderedMessage, ctx): Promise<DeliveryReceipt> }` in the `notifications` module. M1 providers: `SesEmailProvider` (`@aws-sdk/client-sesv2`, exercised by unit tests only — no live sends this run, D-018) and `SmtpEmailProvider` (`nodemailer` 10 → **Mailpit** in Compose: SMTP 1025, UI/API 8025 used by e2e assertions). `SMS`/`WHATSAPP` are interface values with no provider (LATER; `NOTIFICATION_CHANNEL_UNAVAILABLE` if selected).
2. **Event → template mapping** (REQ-NOTIF-004, DR-B28) is a single registry `eventTemplateMap: Record<DomainEventType, TemplateId | ((payload) => TemplateId)>` in the module; the registry test fails on duplicates and on a domain event missing from the map when it is marked `notifies: true` in the event catalogue; unmapped events log a warning and increment `notification_unmapped_event_total`. Recipient: booking user (orders/shipments/payments/pickups/tracking), invited address (invitations), account (auth events) — never receivers or third parties (A-072).
3. **Templates** are versioned code + seed: `notification_templates(id, version, channel, locale, subject, body_text, body_html, variables_schema, is_current)` seeded from `apps/api/src/modules/notifications/templates/<TEMPLATE_ID>/{en,es,fr}.ts` (TypeScript template functions with escaping, no runtime template language); the rendered output records `template_id` + `version` + `locale`; en/es/fr parity is enforced by the i18n CI check (NFR-I18N-002). Locale resolution DR-A18 captured on the event (recipient's stored locale). Documents attached per ADR-0019 rules. The admin template editor is M4 (EPIC-B-409).
4. **Preferences** (REQ-NOTIF-010/011): `notification_preferences(user_id, tracking_updates bool, marketing bool)`; transactional security mails cannot be disabled; tracking milestone mails obey `tracking_updates`.
5. **Delivery pipeline**: outbox event → `notifications` queue (ADR-0013) → render (idempotency key `notify:<event_id>:<template>`) → provider → `notification_log(id, user_id, org_id, template_id, version, locale, channel, status QUEUED|SENT|FAILED|SUPPRESSED, provider_message_id, error_code, created_at)` — **no rendered body, no address** (NFR-PRIV-004); `GET /me/notifications` reads the log. Retries ×5 then DLQ; failures never block business flows (saga step 6).
6. **Security notices** (`auth.security_event` variants) are always sent; new-device detection = new `ua_browser`/`ua_os` + IP /24 combination per user (sessions table).
7. **Seams**: per-tenant inbound address (SES + S3 + Lambda, M4) → `inbound_mailboxes` table defined in the data model, no rows; `NotificationProvider` channel values; template editor.

## Alternatives considered

- **MJML / Handlebars templates at runtime.** Adds a template engine and HTML-injection surface; typed TS templates with escaping are simpler and lint-checked (REQ-SEC-016).
- **Mailpit HTTP send API instead of SMTP (avoids nodemailer).** Works only for Mailpit; SMTP keeps the local provider realistic. `nodemailer` is MIT-0 — equivalence logged (D-ARCH-003).
- **Sending from the API request.** Rejected: side effects belong in the worker, retried and dead-lettered.

## Consequences

- Positive: one map decides every e-mail; privacy-minimal log; providers swappable; e2e can assert e-mails via Mailpit API.
- Negative: SES path is unit-tested only until an AWS account exists (COND at M5).

## Reversibility

High.
