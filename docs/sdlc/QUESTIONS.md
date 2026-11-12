# Questions Log
Questions asked of the human (only by sdlc-orchestrator), the default applied, and the answer received.

| # | Date | Phase | Question | Options | Recommended default | Answer | Applied |
|---|---|---|---|---|---|---|---|
| Q-001 | 2026-11-12 | P0 | No DHL/FedEx/UPS/Stripe sandbox credentials in env; how to handle the M1 "real sandbox label" exit demo? | Fixtures+Mock / creds mid-run / Mock only (adapters to backlog) | Fixtures + Mock: build all adapters from current official docs with recorded/synthesised nock fixtures; Mock + Stripe test stub drive e2e; live sandbox opt-in via `CARRIER_LIVE_SANDBOX=1`; real-label demo tracked as a condition until creds supplied | **Fixtures + Mock** (human) | ✅ D-003 |
| Q-002 | 2026-11-12 | P0 | May agents push to github.com/sukhchdit/shipcube and run GitHub Actions? | Push+PRs+CI / main only / local only | Push task branches, PRs via gh, merge after review+security+green CI | **Push + PRs + CI** (human) | ✅ D-004 |
| Q-003 | 2026-11-12 | P0 | What does the release publish with no prod target and $0 budget? | Tag+GH Release+GHCR / Tag+GH Release / local tag | Tag v0.1.0 + GitHub Release (notes, SBOM) + images to GHCR via CD workflow; no AWS | **Tag + GH Release + GHCR** (human) | ✅ D-005 |
| Q-004 | 2026-11-12 | P0 | Release cadence for M0+M1? | Pre-release after M0 / single / two runs | One pipeline; waves M0→M1; `v0.1.0-m0` pre-release after M0 waves pass regression; `v0.1.0` after G4 | **Pre-release after M0** (human) | ✅ D-006 |
| Q-005 | 2026-11-12 | P2 | Date display: follow the user's formatting region (en-US "Nov 12, 2026") or always day-month ("12 Nov 2026")? (raised by ux-designer, not asked: low impact) | region-based / fixed day-month | Region-based, medium month names; US-116 test data follows the en-GB region | Not asked (non-blocking) | ✅ D-UX-028 |
| Q-006 | 2026-11-12 | P3 | Node 20 is EOL; ADR-0001 baselines Node 24. How should the host get it? | agent installs via fnm / human installs / stay on Node 20 | Agent installs fnm + Node 24 (user scope) | **Agent installs Node 24** (human) | ✅ D-ORCH-002 |
| Q-007 | 2026-11-12 | P3 | Private repo: ~2,000 free Actions min/month vs ~22,000 estimated. How should CI run? | hosted fast lane + local heavy / self-hosted runner / public repo / paid minutes | Hosted fast lane + local heavy | **Hosted fast lane + local heavy** (human) | ✅ D-ORCH-001 |
