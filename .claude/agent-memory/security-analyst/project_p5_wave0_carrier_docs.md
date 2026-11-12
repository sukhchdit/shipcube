---
name: project-p5-wave0-carrier-docs
description: PR-0006 (TASK-009 SPK-02 carrier READMEs) PASS_WITH_FOLLOW-UPS — DHL same-origin sandbox/prod, FedEx per-IP token penalty, URL PII, provisional SEC-TC-66..68; what to check in TASK-113/131/135/139/140/188/214/261
metadata:
  type: project
---

PR-0006 (TASK-009, SPK-02, head 4e5d05f, docs only) reviewed 2026-11-12: PASS_WITH_FOLLOW-UPS, 1 MEDIUM + 5 LOW + 4 INFO (PR6-SEC-01..10). Report: `docs/05-quality/security/PR-0006-TASK-009-security-review.md`.

Carrier facts that drive later reviews (not obvious from ADRs):
- **DHL sandbox and production share one origin** (`express.api.dhl.com`, `/mydhlapi/test` vs `/mydhlapi`). ADR-0016 §13's host-only allow-list cannot enforce the CLAUDE.md §5 sandbox-only rule for DHL → PR6-SEC-01 MEDIUM: rules must be origin + path prefix + tier, production tier refused unless APP_ENV=production. UPS token path is outside `/api`; FedEx ETD *sandbox* host is `documentapitest.prod.fedex.com` (contains "prod" — no wildcard/heuristics).
- **FedEx token service is throttled per public IP** with a 10-min 403 penalty → one failing account can lock all FedEx accounts (cross-tenant from M3). Needs negative cache + global token bucket + 403 cool-down (PR6-SEC-05).
- DHL cancel pickup puts `requestorName` (a person's name) in the **query string**; DHL rates puts `accountNumber` in query; UPS paperless delete has ShipperNumber in path → OTel `url.full` / logs (PR6-SEC-03).
- Carrier responses carry URLs (UPS LabelURL, FedEx URL_ONLY, DHL trackingUrl/cancelPickupUrl) — never follow/surface (PR6-SEC-06).
- No carrier documents push authenticity; all pushTracking=false → TASK-261 must not invent a scheme (PR6-SEC-08).
- FedEx secrets go in the form body (client_secret/child_secret), not a header.

Provisional SEC-TC-66 (egress path-prefix), 67 (carrier URL builder property test), 68 (FedEx token failure) proposed to qa-lead; IDs may be renumbered — check `docs/05-quality/tests/security-test-cases.md` before citing.

**Why:** these are the controls the adapter/egress tasks must implement; the ADR text alone does not reveal the DHL shared-origin or FedEx per-IP penalty issues.

**How to apply:** in reviews of TASK-113 check EgressRule shape + production-tier refusal; TASK-131/132 failure-path throttling and `expires_in` clamp; TASK-135/139/140 `carrierPath`/URLSearchParams, inline labels, constant requestorName, no POD/signature views, README "Sensitive fields" table; TASK-188 per-carrier deny-list; TASK-214 span attrs exclude url.full/path/query; TASK-261 route only for pushTracking=true carriers. Also confirm principal-architect decided the SPK-02 §4 amendment (item 6 wording).

Related: [[project-p3-security-conditions]], [[project-security-review-conventions]]
