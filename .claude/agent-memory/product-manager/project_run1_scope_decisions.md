---
name: run1-scope-and-product-decisions
description: Run 1 (started 2026-11-12) scope is M0+M1 of the shipping-platform brief; key P1 product decisions D-008..D-029 and the reasoning behind the minimal admin slice, account-before-booking, Mock gateway, and Should/Could cut lines.
metadata:
  type: project
---

Run 1 (2026-11-12) delivers brief §12 milestones **M0 Foundation + M1 Customer MVP** only; M2–M5 are backlog (`docs/01-requirements/BACKLOG.md`). P1 product decisions are D-008..D-029 in `docs/sdlc/DECISIONS.md`.

**Why the cut lines look the way they do:**
- Minimal admin slice (staff login + mandatory TOTP, shell, read-only audit viewer, my sessions) exists only because the M0 exit demo needs "sign in to both apps" and "audit entries appear in the viewer". Resist any further admin screens — they are M2 (D-008).
- Account required before booking, verified email before payment (D-009): tenancy/RLS and audit identity need an actor; reversible via funnel telemetry.
- Mock payment gateway in M0 so the booking saga demo runs without Stripe; Stripe test mode in M1 (D-011). No sandbox/Stripe creds exist (D-003) → e2e on Mock + fixtures; real-label demo is COND-SANDBOX-DEMO.
- Self-service cancellation + automatic full refund is Should (D-017) because there is no admin to handle "refund requests" in M1.
- Pricing config is versioned seed data (no pricing admin until M2) (D-010).
- Prioritisation = WSJF-lite: Must = exit-demo critical path + brief's cross-cutting MUSTs (RBAC/audit/RLS/i18n/a11y/responsive) (D-029).

**How to apply:** For change requests or re-scoping in this run, check the decision IDs above before re-deciding; anything that adds admin surface, PayPal/wallet, partners, or AWS deployment is out of run scope and should be deferred to the matching backlog epic (EPIC-B-2xx..5xx), not accepted.
