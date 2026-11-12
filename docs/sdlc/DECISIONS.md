# Decision Log (append-only)
Format: ID · date · who · decision · why · alternatives · reversibility

### D-001 · 2026-11-12 · sdlc-orchestrator · Run scope = M0 + M1 only
- **Decision:** This run delivers milestones M0 (Foundation) and M1 (Customer MVP) from brief §12. M2–M5 and LATER items are backlog; only the seams the brief requires are built.
- **Why:** Explicit human instruction in `/sdlc-start`; brief Appendix C §5 recommends milestone-sized runs.
- **Alternatives:** whole product in one run (rejected: unreviewable gates, unbounded cost).
- **Reversibility:** High. Later milestones arrive via `/sdlc-change`.

### D-002 · 2026-11-12 · sdlc-orchestrator · Operating parameters resolved
- DEPLOY_TARGET_STAGING = local/ephemeral via `docker compose` (default; blank in CLAUDE.md).
- DEPLOY_TARGET_PRODUCTION = none. The release ends with a tagged version, published artifacts/images and a deploy-ready pipeline (default).
- CI_PLATFORM = GitHub Actions, repo `sukhchdit/shipcube` (set).
- CLOUD_BUDGET_MONTHLY_USD = 0. No paid resources; Terraform is fmt/validate/plan-less (no AWS creds)/Checkov only (set).
- LICENSE_ALLOWLIST = MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, Unlicense, CC0-1.0 (default). Note: transitive deps commonly include 0BSD, BlueOak-1.0.0, Python-2.0, CC-BY-4.0 (data); any such case is handled by dependency-auditor with a logged decision.
- CANARY_STEPS = 5% → 25% → 50% → 100%, 10 min bake (default; designed into the pipeline but not exercised, since there is no prod target).
- ROLLBACK_TRIGGERS = error rate > 2× baseline, p95 > NFR budget, SLO fast-burn, failed health checks (default).
- COVERAGE_TARGET = 85% line / 75% branch overall; 95% on pricing, ledger, audit, authz (set).
- MAX_FIX_CYCLES = 3 (default). MAX_PARALLEL_DEVELOPERS = 4, drop to 2 on merge conflicts (set).
- **Reversibility:** High. Edit CLAUDE.md §3 and `/sdlc-resume`.

### D-003 · 2026-11-12 · human (Q-001) · Carrier/payment credentials: fixtures + Mock
- **Decision:** DHL Express, FedEx and UPS adapters are built against current official docs (version and date checked recorded in each adapter README), with recorded/synthesised `nock` fixtures and the shared contract suite. The Mock carrier and Stripe test mode (fixture-backed when no key is present) drive all e2e tests. Live sandbox runs are opt-in (`CARRIER_LIVE_SANDBOX=1`, `STRIPE_TEST_LIVE=1`).
- **Consequence:** The M1 exit demo "real sandbox label from each carrier" cannot run in this session. It becomes a tracked **post-release verification condition (COND-SANDBOX-DEMO)**, executable via one documented command once credentials are supplied. G3/G4 judge the demo with the Mock carrier + fixture replay.
- **Reversibility:** High.

### D-004 · 2026-11-12 · human (Q-002) · Push to GitHub and run CI there
- Task branches `feat/TASK-xxx-slug` are pushed; PRs via `gh`; merge to `main` after code-reviewer APPROVED + security-analyst no Critical/High + green CI. No force pushes.

### D-005 · 2026-11-12 · human (Q-003) · Release publishes tag + GitHub Release + GHCR images
- Semver tag, GitHub Release with notes, changelog and SBOM; container images pushed to `ghcr.io/sukhchdit/shipcube-*` by the GitHub Actions CD workflow (GITHUB_TOKEN, no long-lived secrets). No AWS deployment ($0 budget). Note: `docker push` from a terminal is denied by settings and isn't needed; publishing happens in CI only.

### D-006 · 2026-11-12 · human (Q-004) · Cadence: pre-release after M0
- One pipeline run. P5 waves are ordered M0 → M1. Once all M0 waves pass regression, release-manager cuts the `v0.1.0-m0` pre-release through CI (lightweight dossier, no gate). Full `v0.1.0` follows G4.

### D-007 · 2026-11-12 · sdlc-orchestrator · Brief §14 defaults adopted as-is
- Launch countries US, IN, UK, CA + an EU template pack (US→IN primary lane); currency/units follow origin; Stripe now, PayPal at M4; Part 11 controls only; per-tenant inbound email (M4); ECS on EC2 (Terraform written, not applied); documents + parcels; email+password with optional MFA (mandatory for operator staff per §4.2); placeholder brand.
