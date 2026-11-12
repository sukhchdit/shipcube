---
name: p3-security-remediation
description: How the P3 security review (SEC-P3-01..26) was applied on the requirement side before G2 (D-046..D-052, A-093..A-098): what changed, the new IDs, count baselines after v1.3, and which pairs move together on future changes.
metadata:
  type: project
---

P3 security remediation (2026-11-12, before G2): security-analyst rejected D-038 as written; product-manager applied the requirement-side changes as REQUIREMENTS 1.3 / NFR 1.3 / PRD 1.3 / traceability 1.3. principal-architect amended docs/03-architecture/* in parallel (ADR-0006/0010/0014/0019 etc.); never edit those files from the PM role.

**Decisions:** D-046 supersedes D-038 (30 d sliding refresh inside a **30 d absolute cap**, `auth_time` claim + `x-reauth-max-age: 43200` step-up on org.member.manage, always-re-auth on payment_method.manage and privacy.export, CVC re-collection on saved-card checkout > 12 h, 7-day refresh fallback, REQ-AUTH-020 Must); D-047 REQ-AUTH-021/022 + US-027 → Must (ASVS 3.3.4); D-048 two bulkheads rates 6 / transactional 4, anonymous budget 120/min per account, quota reserve 40 %, alarms 70/90, stream caps 2/IP 5/user, CARRIER_BUSY retryable non-ambiguous in saga; D-049 register in `email-send` + `registration_probe` (5 distinct addr/IP/h), RR-16 accepted as PRD R-12, D-009 kept; D-050 verify revokes other sessions, reset sets email_verified_at, 7-day unverified expiry (REQ-AUTH-026); D-051 pack `invoice_print: FULL|MASKED` (narrows D-045 (5)), SENSITIVE docs never attached, Viewer lacks document:download/email + privacy:export; D-052 bundle (admin 30 min input-idle, blob redaction, staff first-enrolment e-mailed code + 24 h suspension, passwordless non-local seed, guest token 7-day grace, Mock flags, livemode reject, NFR-SEC-012 closures, draft-06 headers).

**New IDs:** REQ-AUTH-025/026, REQ-CARR-022/023, NFR-RES-007, EC-A51/52, EC-B48/49, US-291 (EPIC-02 M1 Must), US-292 (EPIC-02 M0 Must), US-293 (EPIC-06 M1 Must), A-093..A-098, PRD R-12..R-14.

**Count baselines after 1.3:** REQs 434 (324/91/19; 205 M0 / 229 M1); NFRs 91 (75 FULL/10/6); stories 293 (218/67/8; 120 M0 / 173 M1); DC 134 unchanged (74/60). §7.1: R0 113 Must, R1 105 Must.

**Why:** G2 flags REQ-vs-ADR contradictions; each security finding had an ADR amendment, so the REQ wording had to move with it. Security hardening stories are Must-not-DC (gate verifies via SEC-TC cases; demos don't exercise them). I accepted RR-16 rather than blocking sign-in before verification because the funnel rationale (D-009/A-006) outweighs a noisy, throttled oracle.

**How to apply:** Pairs that move together from now on: session lifetimes → REQ-AUTH-006/007/025 + NFR-SEC-004 + US-018/US-291 + A-041/A-086/A-093 + D-046; step-up scopes → REQ-ORG-010/012, REQ-PAY-014, REQ-ACCT-016 + US-083/085/217/268/270; bulkhead/budget values → REQ-CARR-017/022/023 + DR-B32 + NFR-RES-003/007 + US-130/US-293 + A-037/A-094; registration throttles → REQ-AUTH-001 + DR-A22 + REQ-SEC-005 + NFR-SEC-005 + US-015/US-040 + A-035/A-095; invoice printing → REQ-COMP-001 + REQ-CUST-012 + REQ-DOC-010 + REQ-NOTIF-008 + US-057/186/228/283 + A-090/A-097. The verification agent's stale-string list should now also include `90 days`/`90-day` (session), `bulkhead of 10`, `D-038` outside historical references, `not production` in REQ-CARR-006.
