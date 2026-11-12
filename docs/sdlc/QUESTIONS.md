# Questions Log
Questions asked of the human (only by sdlc-orchestrator), the default applied, and the answer received.

| # | Date | Phase | Question | Options | Recommended default | Answer | Applied |
|---|---|---|---|---|---|---|---|
| Q-001 | 2026-11-12 | P0 | No DHL/FedEx/UPS/Stripe sandbox credentials in env; how to handle the M1 "real sandbox label" exit demo? | Fixtures+Mock / creds mid-run / Mock only (adapters to backlog) | Fixtures + Mock: build all adapters from current official docs with recorded/synthesised nock fixtures; Mock + Stripe test stub drive e2e; live sandbox opt-in via `CARRIER_LIVE_SANDBOX=1`; real-label demo tracked as a condition until creds supplied | **Fixtures + Mock** (human) | ✅ D-003 |
| Q-002 | 2026-11-12 | P0 | May agents push to github.com/sukhchdit/shipcube and run GitHub Actions? | Push+PRs+CI / main only / local only | Push task branches, PRs via gh, merge after review+security+green CI | **Push + PRs + CI** (human) | ✅ D-004 |
| Q-003 | 2026-11-12 | P0 | What does the release publish with no prod target and $0 budget? | Tag+GH Release+GHCR / Tag+GH Release / local tag | Tag v0.1.0 + GitHub Release (notes, SBOM) + images to GHCR via CD workflow; no AWS | **Tag + GH Release + GHCR** (human) | ✅ D-005 |
| Q-004 | 2026-11-12 | P0 | Release cadence for M0+M1? | Pre-release after M0 / single / two runs | One pipeline; waves M0→M1; `v0.1.0-m0` pre-release after M0 waves pass regression; `v0.1.0` after G4 | **Pre-release after M0** (human) | ✅ D-006 |
