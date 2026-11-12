---
name: project-p3-security-conditions
description: P3 (pre-G2) security verdict APPROVED_WITH_CONDITIONS; 4 HIGH conditions (session deviation D-038, carrier bulkheads T-46, audit anchor T-84, npm install scripts T-102) to re-verify at P4 exit, in P5 reviews and at G3
metadata:
  type: project
---

P3 architecture security review (2026-11-12, baseline b8f805f) gave APPROVED_WITH_CONDITIONS with four HIGH conditions SEC-COND-01..04 (findings SEC-P3-01..04) owned by principal-architect / product-manager / platform-architect, due before P4 exit, verified by SEC-TC-37..60 before G3.

**Why:** G2 could pass only with no unmitigated Critical/High; each HIGH got a concrete ADR/contract/config change instead of a re-architecture. Key judgement calls made: D-038 accepted only with a 30-day absolute cap plus step-up re-auth (fallback AUTH_REFRESH_TTL=7d); guest quote token in localStorage accepted (capability token, not a session token); register->202->auto-login is an enumeration oracle inherent to D-009 (accepted with throttling, MEDIUM); local heavy-lane evidence must have its verdict recomputed from JUnit, not trusted.

**How to apply:** In every P5 change review and at G3, first check whether the ADR-0006/0007/0010/0018/0023 amendments and openapi.yaml edits demanded by SEC-COND-01..04 actually landed (grep for `--ignore-scripts`, `x-reauth-scope` on payment-method/member routes, `platform_audit_owner`, transactional vs rates bulkhead). Details and the full test list live in docs/05-quality/security/P3-architecture-security-review.md. Related: [[project-security-review-conventions]]
