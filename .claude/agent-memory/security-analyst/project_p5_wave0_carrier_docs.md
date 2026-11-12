---
name: project-p5-wave0-carrier-docs
description: PR-0006 (TASK-009 SPK-02 carrier READMEs) R1+R2 PASS_WITH_FOLLOW-UPS — DHL same-origin sandbox/prod, FedEx per-IP token penalty, UPS 403 = Blocked Merchant (PR6-SEC-11), DHL receiverId e-mail; what to check in TASK-113/131/135/139/140/188/214/261
metadata:
  type: project
---

PR-0006 (TASK-009, SPK-02, docs only). Report: `docs/05-quality/security/PR-0006-TASK-009-security-review.md`.
- R1 @4e5d05f: PASS_WITH_FOLLOW-UPS, PR6-SEC-01..10 (1 MEDIUM).
- R2 @f0387d4 (2026-11-12): PASS_WITH_FOLLOW-UPS. SEC-01 MEDIUM closed at design level by ADR-0010 am. 11 item 6 (D-ARCH-057/062). SEC-07 and SEC-09 closed; the rest open downstream. New: PR6-SEC-11 LOW (MEDIUM from M3), PR6-SEC-12 INFO.

Carrier facts that drive later reviews (not obvious from ADRs):
- **DHL sandbox and production share one origin** (`express.api.dhl.com`, `/mydhlapi/test/` vs `/mydhlapi/`). ADR-0010 am. 11 item 6 adopted static per-adapter `EGRESS {origin, pathPrefixes, tier}`, unioned over enabled accounts; no env var adds a rule.
  - Residual: the union does not bind the rule to the calling tier. TASK-113 should also check `rule.tier === ctx.environment` before G4-prod.
  - UPS token path `/security/v1/oauth/token` is outside `/api` and must be an exact match.
  - The FedEx ETD *sandbox* host `documentapitest.prod.fedex.com` contains "prod".
- **FedEx token service is throttled per public IP** with a 10-min 403 penalty.
  - ADR item 5 / REQ-CARR-016 / TASK-131 now say "token-endpoint 403 → carrier-wide cool-down" for ALL carriers.
  - But a **UPS token 403 = Blocked Merchant (one account)**, so one blocked tenant account would stop UPS for everyone (PR6-SEC-11). The fix is a per-adapter `on403` policy.
- `encodeURIComponent` does not neutralise `.`/`..`. ADR item 8 relies on it alone, so keep the per-carrier identifier allow-pattern (SEC-TC-67).
- ADR item 8 logs `url.full` minus the query; the READMEs say route template. Paths hold INT ids, plus the UPS reference-tracking `referenceNumber` (free text).
- Fields the README inventories miss:
  - DHL `shipmentNotification[].receiverId` (receiver e-mail; no generic deny-list catches it), `mobilePhone`, `customerReferences`.
  - UPS `FaxNumber`, `PhoneNumber`, `InternationalForms.Contacts` parties.
- DHL cancel pickup puts `requestorName` in the query → it must be a BRAND_* constant. UPS `LabelURL` appears only with `LabelLinksIndicator`.
- No carrier documents push authenticity; all are pushTracking=false → TASK-261 must not invent a scheme (PR6-SEC-08).

SEC-TC-66/67/68 are still provisional (not in `security-test-cases.md` as of R2). Check before citing.

**Why:** these are the controls the adapter, egress and token tasks must implement. The ADR text alone hides the shared DHL origin, the per-IP penalty, and the UPS 403 semantics.

**How to apply:** in reviews of:
- TASK-113: EgressRule shape, tier match, encoded-separator refusal, production-tier refusal, route template.
- TASK-131/132: per-carrier 403 scope, negative cache, global bucket, strict `expires_in`.
- TASK-135/139/140: `carrierPath` identifier pattern, inline labels, constant requestorName, no POD/signature.
- TASK-188: whole-container redaction incl. DHL receiverId.
- TASK-214: no url.full/query in spans.
- TASK-261: route only for pushTracking=true carriers.

Related: [[project-p3-security-conditions]], [[project-security-review-conventions]]
