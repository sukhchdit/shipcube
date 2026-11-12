---
name: project-run-scope-and-publishing
description: Shipcube run 1 (started 2026-11-12) covers M0+M1 only; no sandbox creds; publish via tag + GH Release + GHCR; pre-release v0.1.0-m0 after M0
metadata:
  type: project
---
First SDLC run (started 2026-11-12) is scoped to brief §12 M0 + M1; M2–M5 are backlog, to be started later via `/sdlc-change Implement milestone M2 ...`.

**Why:** Human instruction plus brief Appendix C, which favours milestone-sized runs to keep gates meaningful and cost predictable.

**How to apply:**
- No DHL/FedEx/UPS/Stripe sandbox creds exist. Adapters are fixture-backed; the "real sandbox label" M1 demo is the tracked condition COND-SANDBOX-DEMO.
- Pushing to github.com/sukhchdit/shipcube with PRs and Actions CI is approved.
- The release publishes a semver tag, a GitHub Release and GHCR images through CI. No AWS ($0 budget).
- Cut the `v0.1.0-m0` pre-release once M0 waves pass, then `v0.1.0` after G4.
