---
name: p3-architecture-context
description: Context behind the P3 (M0+M1) architecture decisions for the shipping platform — why Node 24/TS 6/Valkey/RustFS were chosen, the CI lane model forced by the private-repo minutes cap (D-ORCH-001), the fnm per-command PATH convention, and which UX open items were resolved where
metadata:
  type: project
---

P3 architecture (2026-11-12) produced ADR-0001..0027 under `docs/03-architecture/adr/`, plus ARCHITECTURE.md, data-model.md, api/openapi.yaml + api/README.md, platform.md, threat-model.md, nfr-strategy.md, nfr-traceability.md, risks.md. Decisions logged as D-ARCH-001..016 in `docs/sdlc/DECISIONS.md`. Several ADRs carry dated "Amendment" sections (threat-model P1 items in ADR-0005/0006/0007/0014/0016/0022; D-ORCH-001 in ADR-0023/0024/0001; UX §5 items in ADR-0006/0016/0026/0025) — judge conformance against the amendments, not just the original Decision sections.

**Why the non-obvious choices:**
- Node 24 (not the host's Node 20): Node 20 went EOL 2026-04-30; `opossum` 10 needs Node ≥ 22. Host now has Node 24.22.3 via fnm but NOT on PATH: every Bash command running node/npm/npx must start with `export PATH="$APPDATA/fnm/aliases/default:$PATH";` (CLAUDE.md §2, D-ORCH-002). A missing prefix hits Node 20 and fails on engine-strict — intended.
- TypeScript ~6.0.3 (not 7.x native): ts-jest/typescript-eslint peers declared `<7` on 2026-11-12. Jest uses @swc/jest to decouple.
- Valkey 8 instead of `redis:7` image: redis 7.4/8 licences (RSALv2/SSPL/AGPL) are off the allow-list.
- RustFS instead of MinIO/LocalStack: MinIO community archived; LocalStack requires an account since 2026.03.
- Audit erasure = tokenised PII vault (not key shredding) because closed partitions go to S3 Object Lock and must hold no PII.
- Carrier portals (DHL WAF, UPS 403) block automated fetches; UPS specs are on github.com/UPS-API/api-documentation; DHL MyDHL API is at spec 3.3.x.
- **CI (D-ORCH-001, human):** private repo ≈ 2,000 free min/month vs ≈ 22,000 needed all-hosted. Result: hosted PR fast lane (single incremental job, diff-coverage gate) + heavy suites run LOCALLY by test-runner with machine-generated evidence under `docs/05-quality/{tests,security,performance}/runs/<stamp>_<sha7>/` + hosted full lane on `workflow_dispatch` only (wave ends, G3, G4). No self-hosted runner (kept as `HEAVY_RUNNER_LABELS` switch), no merge queue, `nightly.yml` has no schedule, post-merge fast lane off by default (`CI_MAIN_FAST_LANE`). "Passing CI" in the DoD = lane A green + lane B evidence PASS for changed paths + reviews. Estimate ≈ 1,830 min/month; guards at 70/90/100 %.
- WebFetch cannot reach registry.npmjs.org from this environment; use `npm view <pkg> ... --json` under the PATH prefix to verify licences/dates.

**P3 security remediation (2026-11-12, pre-G2, review `docs/05-quality/security/P3-architecture-security-review.md`):** SEC-P3-01..04 (HIGH) and 07/08/10/11/12/13/14 resolved as dated "Amendment (2026-11-12, SEC-P3-xx)" sections; decisions D-ARCH-003 rev 2 and D-ARCH-017..028; a "Remediation status" table closes the review doc. Non-obvious choices to defend in conformance reviews: (a) CVC recollection is the *only* saved-card step-up mechanism (no conditional re-auth header); (b) anchors are ECDSA P-256, not Ed25519, because KMS has no Ed25519; (c) `ReauthProofConditional` (optional header) on `x-reauth-max-age` routes so Joi parity does not demand it; (d) lane C `wave-end` dispatches default 3 (was 5) to fund the hosted `security-integration` subset; (e) `createQuoteShare` is mint-and-revoke, not 409. PM owns configuration defaults (D-046/D-048: `CARRIER_ANON_CALLS_PER_MIN=120`, bulkheads 6/4, reserve 40 %) — ADR values must follow DECISIONS, not the review's suggestions. Wave-0 follow-ups: `x-origin-check` on login-class routes (SEC-P3-18), Nginx strip of `X-Mock-Scenario`, SPK-08 (audit owner + anchors on PG 18), SPK-01 extended for `--ignore-scripts`.

**Open items handed to others (check DECISIONS.md / gate G2 notes before assuming resolved):**
- product-manager: align NFR-RES-001..003 with DR-B32 (D-ARCH-004); wording changes in D-ARCH-006 (cookie path, MFA lock per user, seed defaults outside local, DR-A08 pre-auth limiter, token-free URLs, 30-day refresh vs ASVS L2, MinIO → S3-compatible).
- performance-engineer (P4): re-baseline A-029 — k6 gate runs on the developer host (spec recorded); hosted 2-vCPU k6 is reported only.
- ux-designer: when US-165 is scheduled, change S-W02s route `/q/{token}` → `/q#token=`.
- Wave-0 spikes SPK-01..07 in risks.md (SPK-07 = CI lanes + incremental fast lane + evidence integrity negative tests).

**How to apply:** In conformance reviews, judge against these ADRs and amendment sections. If a later session finds Node 26 / TS 7 tooling mature, a superseding ADR for ADR-0001 is the expected path. If CI minutes measurements exceed the estimate, the lever order is: fewer wave-end dispatches → public repo → self-hosted label switch → budget.
