---
name: g2c3-requirement-closure
description: How G2-C3 (security review §14 conditions SEC-COND-06/07, SEC-P3-30/32/33, RR-19) was closed on the requirement side as REQUIREMENTS/NFR/PRD 1.4 (D-053..D-057, A-099..A-102); the new config keys, rate class and pairs that move together.
metadata:
  type: project
---

G2-C3 requirement side (2026-11-12, after G2 PASS_WITH_CONDITIONS at cef043f): product-manager applied D-053..D-057 as REQUIREMENTS 1.4 / NFR 1.4 / PRD 1.4 while principal-architect edited docs/03-architecture/* and the traceability Design column in parallel. traceability.md was not touched (no ID changes).

**Decisions:** D-053 `PENDING_VERIFICATION` users are anonymous callers for the carrier budget; new `quote-create` rate class (30/min + 300/h per user, 1,000/h per org) on authenticated `POST /quotes`; `CARRIER_QUOTA_ORG_SHARE_PCT=10` per-org share of each account's daily quota (rates pool only, off when quota 0), event `carrier_quota_org_share_exhausted`. D-054 saved-card checkout with CVC re-collection is AUTHORISED only on `cvc_check = pass`, else void + FAILED/AUTHENTICATION_FAILED + `cvc_recollection_failed`; Mock CVC outcomes pass/fail/unavailable via `test_token`. D-055 share link: implicit revocation audited as `UPDATE quote_share` reason SUPERSEDED, `QUOTE_SHARE_MINTS_PER_HOUR=10`, byte-identical 404 for unknown/revoked/superseded/expired — the "expired with prefilled inputs" shared view was dropped. D-056 REQ-SEC-012 catalogue completed (+`job_context_mismatch`, `webhook_livemode_rejected`, `audit_anchor_missing`); REQ-AUTH-018 now follows ADR-0006 am. 14 (deadline from `first_signed_in_at`, 403 `MFA_ENROLMENT_CODE_REQUIRED`, `ops:staff-reactivate` CLI); REQ-BOOK-023 names `LOCAL_REJECT`, DRAFT (not EXCEPTION) at the saga deadline. D-057 RR-19 accepted as PRD R-15 without the sign-in-before-verification control.

**Counts unchanged:** 434 REQs / 91 NFRs / 293 stories / 134 DC. New EC-B50..B53 only. US-027 confirmed M1 Must not-DC after D-047.

**Why:** Each item was a security-review condition due at P4 exit; the gate flags REQ-vs-ADR drift, so the REQ wording had to adopt the architect's design where the design was better (first sign-in deadline) and the analyst's reading where it was right (DRAFT at deadline). I accepted the small product loss of the expired-share view because US-165 is Should and the recipient is a third party.

**How to apply:** New pairs that move together: `quote-create` values → REQ-SEC-005 + DR-A22 + NFR-SEC-005 + REQ-QUOTE-002 + US-040 + A-099; org share → REQ-CARR-023 + DR-B32 + NFR-RES-007 + US-293 + A-094/A-099; cvc_check rule → REQ-PAY-014 + US-217 + EC-B52 + A-100; share hardening → REQ-QUOTE-015 + EC-B29/B53 + US-165 + A-101; staff enrolment → REQ-AUTH-018 + US-025 + A-098. Open drift to watch: ADR-0014 am. 3 said EXCEPTION at deadline and 5 s backoff base; REQ keeps DRAFT and 2 s (architect to align). Stale strings for the verification agent now also include `membership being created`, `401 \`MFA_INVALID\`` near enrolment code, `inputs prefilled` for share links, `600/min` applied to POST /quotes.
