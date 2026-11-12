# Project Constitution: Autonomous Multi-Agent SDLC

## 1. Project Context
<!-- product-manager fills §1 after G1; principal-architect fills §2 after G2. -->
- **Product:** Multi-carrier shipping platform ("the Platform"; brand is `BRAND_*` configuration). Instant quotes and side-by-side comparison of DHL Express, FedEx and UPS, booking, payment, labels and customs documents, pickup scheduling and tracking for guests and customers, on an audit-ready, multi-tenant, compliance-as-data core. Run 1 delivers M0 Foundation + M1 Customer MVP (D-001); M2–M5 are backlog. PRD: `docs/01-requirements/PRD.md`.
- **Problem / Users:** Cross-border shippers (primary lane US → India) face opaque carrier pricing, three separate carrier portals and confusing customs paperwork; the legacy .NET system has no audit trail, no tenant model and cannot meet per-country compliance (GDPR, India DPDP, US state privacy). Users this run: guest shipper, registered individual, business customer (Owner/Admin/Shipper/Finance/Viewer), operator Super Admin and Compliance Auditor (minimal admin slice, D-008), and system actors (worker jobs).
- **Primary success metrics:** North-star: paid bookings per week; leading indicator quote → paid conversion ≥ 8%. Run outcomes judged at G3/G4: O1 both exit demos (PRD §6.1/§6.2) green on Chromium, Firefox and WebKit at 360 px and 1280 px on Mock + fixtures; O2 first quote result ≤ 1.5 s, complete ≤ 5 s; O3 zero cross-tenant access and 100% route permission/audit/validation metadata coverage; O4 100% audit completeness with immutability proven for every DB role; O5 coverage ≥ 85% line / 75% branch (≥ 95% pricing, audit, authz), 0 serious/critical axe violations, 0 open Critical/High security findings. Guardrails held at 0: captured payments without a booked shipment, duplicate labels, personal data on public tracking beyond city level, secrets/PII in logs.

## 2. Tech Stack & Conventions
- **Languages / frameworks:** TypeScript ~6.0 strict everywhere (ADR-0001; TS 7/tsgo deferred until tooling peers allow). Runtime **Node 24 LTS** (`.node-version`; Node 20 is EOL — install Node 24 via fnm/nvm-windows). Backend: Express 5, Prisma 7.10 (`@prisma/adapter-pg` + `pg`), Joi 18, Pino 10, `jose` (ES256 JWT), BullMQ 6 on Valkey 8 (Redis-compatible), PostgreSQL 18. Frontend: React 19, React Router 8 framework mode (`ssr:false` + `prerender` for public pages), Vite 8, Tailwind 4 tokens, Radix UI, TanStack Query 5 / Table 9, React Hook Form + Zod 4, react-i18next (en/es/fr), Axios. Infra: Docker multi-stage + Compose, Terraform + Checkov (validated, never applied this run), GitHub Actions. Full version baseline and rationale: `docs/03-architecture/adr/ADR-0001-technology-stack.md`; conventions: ADR-0002/0003/0016.
- **Build / package manager:** npm 10 workspaces (`apps/*`, `packages/*`, `prisma`, `tests/*`), `package-lock.json` committed, `.npmrc` `engine-strict=true`. `npm ci` → `npm run build` (all workspaces: `tsc -b` for api/worker, `react-router build` for web/admin). Type-check: `npm run typecheck` (`tsc -b --noEmit`). Prisma: `npm run db:migrate` (dev), `npm run db:migrate:deploy`, `npm run db:seed` (reference), `npm run db:seed:demo`, `npm run db:reset`. OpenAPI: `npm run openapi:lint` (Redocly) and `npm run openapi:types` (openapi-typescript → `packages/shared/src/api/types.gen.ts`).
- **Lint / format commands:** `npm run lint` (ESLint 10 flat config with typescript-eslint, eslint-plugin-boundaries layering rules, import-x, i18next, jsx-a11y + Stylelint with logical-properties rule; `--max-warnings 0`) · `npm run format:check` / `npm run format` (Prettier 3) · commit messages: Conventional Commits (commitlint in CI).
- **Test commands:** unit `npm run test:unit` (Jest 30 + @swc/jest, fast-check) · integration `npm run test:integration` (Jest + Testcontainers: PostgreSQL 18, Valkey, RustFS — Docker Desktop required) · API/contract `npm run test:api` (Supertest + OpenAPI response validation; generated RBAC matrix, audit, RLS and abuse suites run here) · e2e `npm run test:e2e` (Playwright 1.65: Chromium/Firefox/WebKit × mobile/desktop, axe on every navigation) · coverage `npm run test:coverage` (Jest thresholds 85 % line / 75 % branch; 95 % on `packages/pricing`, `packages/audit`, `packages/authz`) · load `npm run test:load` (k6 via Docker, `tests/load`) · carrier contract live sandbox (opt-in) `CARRIER_LIVE_SANDBOX=1 npm run test:contract:live`.
- **Run locally:** `cp .env.example .env` (placeholders only; demo passwords via `SEED_*`) then `docker compose up` (Postgres 18, Valkey, RustFS S3, Mailpit, migrate+seed job, api :3000, worker, web :8080, admin :8081, local `edge` TLS proxy; `--profile observability` adds otel-collector/Jaeger/Prometheus/Grafana). Hot-reload against the compose data services: `npm run dev:api`, `npm run dev:worker`, `npm run dev:web`, `npm run dev:admin`. Swagger UI at `http://localhost:3000/api/docs`; Mailpit UI at `http://127.0.0.1:8025`. Scale test: `docker compose up --scale api=2 --scale worker=2`.
- **Branching:** trunk-based; task branches `feat/TASK-xxx-slug`; Conventional Commits; merge to `main` only after a gatekeeper-verified DoD.
- **Fixed stack (project rule):** the technology stack in `shipping-platform-brief.md` §3 is fixed, including the resolved ambiguities in §3.3 (Zod on the frontend, Joi on the backend, Pino, Terraform, ECS on EC2). `principal-architect` documents it in ADR-0001 and does **not** re-select it. TypeScript strict mode everywhere. Repository layout per brief §4.1.
- **Dev environment:** Windows 11 host, Docker Desktop, npm. **Node 24 LTS** is installed via fnm (user scope) but is NOT on the default PATH. Every Bash command that runs node/npm/npx must start with `export PATH="$APPDATA/fnm/aliases/default:$PATH";` (the system Node 20 is EOL and is rejected by `engine-strict`). Do not modify shell profiles or the user PATH. Python is not installed; write tooling scripts in Node/TypeScript. CI: hosted GitHub Actions fast lane on PRs; heavy suites run locally (D-ORCH-001).

## 3. Operating Parameters (optional; defaults apply when blank)
| Parameter | Value | Default if blank |
|---|---|---|
| DEPLOY_TARGET_STAGING | _blank (until an AWS account is ready)_ | Local/ephemeral environment via docker compose |
| DEPLOY_TARGET_PRODUCTION | _blank (until M5)_ | No production rollout; the release ends with a tagged version, published artifacts/images and a deploy-ready pipeline |
| CI_PLATFORM | GitHub Actions (repo `sukhchdit/shipcube`) | GitHub Actions |
| CLOUD_BUDGET_MONTHLY_USD | 0 (until M5) | 0: no paid resources are created |
| LICENSE_ALLOWLIST | _blank_ | MIT, Apache-2.0, BSD-2-Clause, BSD-3-Clause, ISC, MPL-2.0, Unlicense, CC0-1.0 |
| CANARY_STEPS | _blank_ | 5% → 25% → 50% → 100%, 10 min bake per step |
| ROLLBACK_TRIGGERS | _blank_ | Error rate > 2× baseline, p95 latency > NFR budget, SLO fast-burn alert, failed health checks |
| COVERAGE_TARGET | 85% line / 75% branch; 95% on pricing, ledger, audit, authz | 80% line / 70% branch on domain code |
| MAX_FIX_CYCLES | _blank_ | 3 |
| MAX_PARALLEL_DEVELOPERS | 4 (drop to 2 if merge conflicts appear) | 4 |

## 4. Questions & Inputs Policy
- Only `sdlc-orchestrator` asks the human, in ONE batch per phase at most (normally only at intake), and only for decisions that are high-impact and can't be derived from the brief, the code or sensible industry defaults.
- Every question includes options and a **recommended default**. The run never waits on an answer: in non-interactive runs, or when an answer isn't available, the recommended default is applied, logged in `docs/sdlc/DECISIONS.md` and `docs/01-requirements/ASSUMPTIONS.md`, and work continues.
- Answers arriving later are applied through `/sdlc-resume <answer>` or `/sdlc-change <request>`. Agents re-plan the affected work automatically.

## 5. Autonomous Guardrails (replace manual approvals)
All agents act autonomously within these guardrails. An action that can't be done within them is replaced by a safe alternative. It's never escalated to a human.
- **Production changes** happen only through the CD pipeline, after gate G4 = PASS, using progressive delivery (CANARY_STEPS) with automated health analysis and **automatic rollback** on ROLLBACK_TRIGGERS. No agent runs `kubectl apply`/`terraform apply`/deploy commands against shared environments from a terminal; the pipeline does.
- **Infrastructure** changes go through IaC: `plan` → policy-as-code checks (Checkov/OPA/tfsec) → security-analyst review → `apply` in CI only. `destroy` is never used outside ephemeral environments.
- **Git:** no force pushes or history rewrites (they're never needed). Merges to `main` require a DoD verified by code-reviewer and security-analyst, and passing CI.
- **Database:** expand → migrate → contract only. Before any data-changing migration: an automated backup/snapshot plus a successful restore test. Contract steps (dropping columns/tables) ship in a later release, once no code reads the old structure and the backup is verified. Backfills run in throttled, resumable batches.
- **Dependencies:** must match LICENSE_ALLOWLIST, have no Critical/High known vulnerabilities, and be maintained (release in the last 18 months). Otherwise choose an alternative or implement it in-house.
- **Secrets:** agents never create, read or print raw secret values. Code uses secret-manager references; `.env.example` holds placeholders only.
- **Spend:** never exceed CLOUD_BUDGET_MONTHLY_USD. Choose cheaper designs or local/emulated services instead.
- **External communication:** no emails, messages, issues or posts to third parties beyond the configured CI/CD and repository integrations.
- **Architecture changes:** contradicting an Accepted ADR requires a superseding ADR by principal-architect that quality-gatekeeper verifies.
- **Carrier and payment integrations:** DHL, FedEx and UPS **sandbox** APIs and payment-gateway **test** modes are permitted integrations. Production carrier and payment endpoints are not, until G4 for a production release. Until sandbox credentials are supplied (as environment variables or secrets outside the repo), everything runs on the Mock carrier.
- **Restricted data:** the legacy database backup (brief Appendix A) is never committed, copied into fixtures, or placed in prompts or logs. Use its structural profile and synthetic test data only (brief §13 rule 9).

## 6. Phases & Quality Gates (all gates decided by quality-gatekeeper)
| Phase | Owner | Exit criteria |
|---|---|---|
| P0 Intake | orchestrator | Brief in `docs/sdlc/BRIEF.md`; operating parameters resolved (values or defaults) |
| P1 Requirements | product-manager | PRD, NFRs with quantified targets, prioritized stories with Gherkin AC, assumptions logged → **G1** |
| P2 UX (if UI) | ux-designer | Flows, wireframes, states, tokens, a11y notes for every Must story |
| P3 Architecture | principal-architect | C4 L1–L3, ADRs, data model, API contracts, threat model, NFR strategy, stack in §2 → **G2** |
| P4 Planning | senior-developer + qa-lead | Task DAG with traceability, complexity tags, waves; test strategy |
| P5 Build | senior-developer | Every task meets the DoD and is merged |
| P6 Verification | qa-lead + security-analyst + performance-engineer | Suites green; coverage ≥ target; e2e critical journeys; perf budgets; a11y AA; no open Critical/High; Must stories accepted → **G3** |
| P7 Release | devops + technical-writer + release-manager | CI/CD green, IaC applied via pipeline, observability live, docs complete, release dossier → **G4** → automated release (and canary rollout if a production target is configured) |

Gate verdicts: **PASS** (proceed) · **PASS_WITH_CONDITIONS** (proceed; conditions become tracked tasks due before the next gate) · **FAIL** (the required actions go back to the owning agent automatically).

## 7. Escalation Ladder (instead of human escalation)
When a task fails review/QA/security MAX_FIX_CYCLES times, or an agent reports BLOCKED:
1. **Re-dispatch with more capability:** the same task with `model: opus` and a sharper brief that includes all previous findings.
2. **Re-specify:** principal-architect (technical) or product-manager (functional) does a root-cause analysis and amends the spec/ADR; the task is re-planned.
3. **Re-scope:** product-manager defers or splits the story (the Must becomes a smaller Must plus a Should in the backlog), records the decision with reasons, and the pipeline continues.
Every step is logged in DECISIONS.md. The pipeline never stops waiting.

## 8. Definition of Done (per task)
- [ ] Acceptance criteria of the linked stories satisfied and demonstrated by tests
- [ ] Lint, format and type checks pass; no new warnings
- [ ] Unit tests for new logic; integration tests for new boundaries; coverage not reduced
- [ ] code-reviewer: APPROVED (no BLOCKER/MAJOR open)
- [ ] security-analyst: no Critical/High open for the change
- [ ] Public interfaces documented; ADR written if a significant decision was made
- [ ] traceability.md and STATUS.md updated

**Feature-level Definition of Done (from `shipping-platform-brief.md` §12, applies in addition):**
- [ ] Business logic implemented behind the service layer
- [ ] RBAC enforced and covered by the generated matrix tests
- [ ] Audit trail captured automatically and covered by audit tests
- [ ] Validation and error handling at every boundary
- [ ] API documented in OpenAPI with examples
- [ ] All UI states, three locales (en, es, fr), responsive layouts and accessibility checks done
- [ ] Performance considered: indexes, pagination, no N+1 queries
- [ ] Configuration over hard-coding; no secrets in code
- [ ] Docker configuration updated so the feature runs in Compose and deploys

## 9. Engineering Standards
- SOLID, clean architecture, explicit boundaries; small cohesive modules; functions do one thing.
- Fail fast; validate at boundaries; no silent catch-alls; structured errors.
- Every external call has timeouts, retries with backoff and jitter (idempotent ops only), and circuit breaking where it matters.
- Structured logging with correlation IDs; never log secrets/PII; metrics and traces at every service boundary.
- Typed configuration from the environment; no secrets in code, tests or fixtures.
- Avoid N+1 queries, unbounded loops/queries and sync I/O on hot paths; paginate everything.
- OWASP ASVS L2 baseline; least privilege; parameterized queries; output encoding; secure defaults.
- New dependencies must be justified in the task report (license, maintenance, size, alternatives).

## 10. Communication Protocol
- Agents exchange work through files under `docs/` and the code itself.
- Every agent ends with a **Handoff Report** (`docs/sdlc/templates/HANDOFF.md`).
- Every non-trivial decision goes in `docs/sdlc/DECISIONS.md` (who, what, why, alternatives, reversibility).

## 11. Severity Scales
- **Review:** BLOCKER · MAJOR · MINOR · NIT
- **Security:** CRITICAL · HIGH · MEDIUM · LOW · INFO (with CWE, OWASP category, exploitability, fix)
- **Defects:** S1 (data loss/security/outage) · S2 (major function broken) · S3 (minor) · S4 (cosmetic)
