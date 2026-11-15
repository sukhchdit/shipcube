# ADR-0001: Technology stack (fixed by the brief) and version baseline

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect (documenting; the stack itself is fixed by brief §3 and CLAUDE.md §2 and is not re-selected here)
- **Related:** ADR-0002 (tooling), ADR-0024 (testing toolchain), ADR-0025 (sanctioned additions), D-ARCH-001..003 in `docs/sdlc/DECISIONS.md`

## Context

Brief §3 fixes the technology stack and §3.3 resolves its ambiguities (Zod on the frontend, Joi on the backend, Pino, Terraform, ECS on EC2, RLS applicable, Part 11 controls only, per-tenant inbound email, pre-rendered public pages). CLAUDE.md §2 forbids re-selecting it. What remains for architecture is (a) to record the exact stack so every agent builds against one list, (b) to pin a **version baseline** verified against the registries and vendor docs on 2026-11-12, and (c) to resolve two facts that the brief could not know when it was written:

1. **Node.js 20 reached end-of-life on 2026-04-30** (nodejs/Release schedule, checked 2026-11-12). The brief says "Node.js (current LTS)"; CLAUDE.md §2 describes the developer host as having Node 20 installed. Shipping on an EOL runtime violates CLAUDE.md §5 ("dependencies must be maintained") and ASVS L2 (V14.2). Current LTS lines: 22 (maintenance, EOL 2027-04-30), **24 Krypton (LTS since 2025-10-28, maintenance since 2026-10-20, EOL 2028-04-30)**, 26 Lithium (Active LTS since 2026-10-28, EOL 2029-04-30). Several sanctioned libraries already require Node ≥ 22 (`opossum` 10: `^22 || ^24 || ^26`).
2. **TypeScript 7.0 (native Go compiler) is now `latest`**, while key tooling still declares `typescript: <7` as a peer (`ts-jest` 29.4.15; `typescript-eslint` compatibility unverified). TypeScript 6.0.3 is the last JavaScript-implemented release.

Also verified today: Prisma `@prisma/client` latest **7.10.1** (CLI `latest` tag points at an 8.0.0 release candidate; RCs are not used), Express **5.3**, React **19.3**, React Router **8.5** (framework mode with `prerender`), Vite **8.3**, Tailwind **4.3**, Jest **30.5**, Playwright **1.65**, BullMQ **6.7**, PostgreSQL **18** supported on Amazon RDS since 2025-11-14 (native `uuidv7()`).

## Decision

The stack is exactly brief §3.1 + §3.3 + the §3.2 additions recorded in ADR-0025. The **version baseline** for this run is:

| Layer | Technology (fixed) | Baseline pinned for M0/M1 (verified 2026-11-12) | Notes |
|---|---|---|---|
| Runtime | Node.js current LTS | **Node 24 LTS** (`engines: ">=24 <25"`, `.node-version` = `24`), Docker base `node:24-trixie-slim` pinned by digest (Debian 13 is the current slim default; platform.md OI-03) | Node 20 is EOL; Node 26 is evaluated at M5 (only 2 weeks into LTS, ecosystem lag risk). The Windows dev host must install Node 24 (fnm or nvm-windows); see D-ARCH-001. |
| Language | TypeScript strict everywhere | **TypeScript ~6.0.3**, `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `isolatedModules`, `verbatimModuleSyntax` | TypeScript 7 (tsgo) adopted when `typescript-eslint`, `@swc/jest`/`ts-jest` and Prisma declare support (spike in Wave 0; D-ARCH-002). |
| Backend | Express.js, Prisma ORM, Joi, JWT access + refresh, Pino, RBAC | Express 5.3, Prisma 7.10.x (client **and** CLI pinned equal) with `@prisma/adapter-pg` + `pg` 8, Joi 18, `jose` 6 (ES256 JWT), Pino 10 + `pino-http` 11, `bcrypt` 6 (cost 12), `otplib` 13 (TOTP) | Prisma 7 is engine-free and requires a driver adapter and `prisma.config.ts` (ADR-0005 / data-model.md). |
| Database | PostgreSQL: UUID PKs, soft delete, RLS, partitioned audit, indexing strategy, migrations | **PostgreSQL 18** (Compose `postgres:18`, RDS 18.x), UUIDv7 (`uuid` 14 `v7()` in the app, `uuidv7()` DB default), Prisma migrations with raw SQL for RLS/partitions/triggers | ADR-0009 |
| Jobs | BullMQ + Redis | BullMQ 6.7, `ioredis` 6, **Valkey 8** (BSD-3-Clause; Redis-protocol compatible) in Compose/CI and ElastiCache for Valkey in AWS — the `redis:7` image tag is now the 7.4 line under RSALv2/SSPL and Redis 8 is AGPL/RSALv2/SSPL, none on LICENSE_ALLOWLIST; fallback `redis:7.2.x` (BSD-3). BullMQ/ioredis compatibility is confirmed in SPK-01 (risks.md). `maxmemory-policy noeviction` required (ADR-0016 §Amendments) | ADR-0013, D-ARCH-005 |
| Frontend | React, React Router, Axios, React Hook Form, Zod, i18n (en/es/fr), JWT auth | React 19.3, React Router 8.5 framework mode (`ssr: false` + `prerender` for public pages), Axios 1.21 under TanStack Query 5, RHF 7.9, Zod 4.6, `react-i18next` 18 / `i18next` 27 | ADR-0002, ADR-0026 |
| Containers | Docker multi-stage, Compose for local | Docker Compose v2 spec; images per ADR-0022/platform.md | |
| Cloud (AWS) | EC2 behind ALB with Auto Scaling, RDS PostgreSQL, S3, IAM, CloudWatch, WAF, AWS Backup, VPC private subnets, Secrets Manager, SES, Lambda; + §3.2 ElastiCache, KMS, CloudFront, ECR | Designed in Terraform (modules + overlays), validated and Checkov-checked, **not applied** (CLOUD_BUDGET = 0, D-002) | ADR-0022, platform.md |
| IaC | Terraform (§3.3) with Checkov | Terraform ≥ 1.9 (HCL kept OpenTofu-compatible as a fallback), Checkov via its Docker image/GitHub Action (Python is not on the dev host) | |
| CI/CD | GitHub + GitHub Actions | Repo `sukhchdit/shipcube`; release = tag + GitHub Release + GHCR images (D-005) | ADR-0023 |
| Testing | Jest, integration, API, RBAC, audit validation, k6, OWASP checks (+ §3.2 Supertest, Testcontainers, nock, Playwright, axe, ZAP, Semgrep, Gitleaks, Trivy) | Jest 30 (`@swc/jest` transform), Supertest 7, Testcontainers 12, nock 15, fast-check 4, Playwright 1.65, `@axe-core/playwright` 4.14, k6 (Docker image), Stryker 10 | ADR-0024 |

Rules that follow from the baseline:

- Pin **exact** versions in `package.json` for frameworks with coupled toolchains (TypeScript, Prisma, React Router, Vite, Jest); use caret ranges elsewhere; `package-lock.json` committed; Renovate/Dependabot grouped weekly updates (P5+).
- Never consume pre-release tags (`next`, `rc`, `beta`) in product code.
- A dependency is admissible only if its licence is in LICENSE_ALLOWLIST (or an equivalence is logged, D-ARCH-003), it has a release in the last 18 months and no open Critical/High advisory (CLAUDE.md §5). Checked today: `ua-parser-js` 2.x is AGPL-3.0 → **rejected** (use `bowser` 2.15, MIT); `cookie-parser` last released 2024-10 → **rejected** as stale (use `cookie` 2.x directly); `nodemailer` is MIT-0 → accepted by equivalence (D-ARCH-003); `jest-openapi`/`swagger-ui-express` stale → use an Ajv-based validator and `swagger-ui-dist`.

## Alternatives considered

- **Stay on Node 20 because it is installed on the host.** Rejected: EOL runtime, blocked `opossum` 10, fails the maintained-dependency guardrail; the fix (install Node 24 via fnm) costs minutes.
- **Node 26 (Active LTS).** Deferred to M5: broadest-support line today is 24; both are LTS; moving 24 → 26 is a base-image bump.
- **TypeScript 7 now.** Deferred: peer-dependency conflicts in the Jest/ESLint toolchain would cost build-pipeline time in Wave 0 with no functional benefit.
- **Prisma 8 RC.** Rejected: pre-release.

## Consequences

- Positive: one verified list for every agent; no EOL runtime; engine-free Prisma 7 keeps images small (NFR-OPS-002); PG 18 gives native UUIDv7 and skip-scan.
- Negative: the developer host needs a Node upgrade; Prisma 7 driver-adapter wiring is newer than the training data of most agents and must follow the docs (data-model.md §7); React Router 8 / Vite 8 / Tailwind 4 are current majors, so sample code from older tutorials will not apply.
- Verification: `engines` + `.node-version` enforced by `npm ci` (`engine-strict=true` in `.npmrc`); a repository test asserts the pinned majors; CI runs on `node-version-file: .node-version`. *Added 2026-11-12 (SPK-01, D-ARCH-035):* `engines` also declares `"npm": ">=11.10"` (the npm bundled with Node 24.22+, first release with `min-release-age`); the toolchain conventions proven by the spike are in the "Amendment (2026-11-12, SPK-01)" sections of ADR-0002/0017/0022/0023/0024/0025/0026 — no baseline pin above changed.

## Reversibility

Version pins: high (bump + CI). Stack: fixed by the brief; changing it requires a superseding ADR verified by quality-gatekeeper (CLAUDE.md §5).

## Amendment (2026-11-12, D-ORCH-002): developer-host Node 24 via fnm, per-command PATH

The Node 24 baseline above is **unchanged**. The Windows host now has Node **v24.22.3** installed by fnm 1.39.0 (user scope) and set as the fnm default. The install is not on the shell's default PATH (the auto-mode classifier denied profile and user-PATH changes), so the project convention is (CLAUDE.md §2): **every Bash command that runs `node`, `npm` or `npx` starts with** `export PATH="$APPDATA/fnm/aliases/default:$PATH";`.

Consequences:

- `npm run` scripts inherit the prefixed PATH, so repository scripts need no change; tooling scripts stay Node/TypeScript (no Python on the host).
- A command without the prefix hits the system Node 20 and fails fast on `engine-strict` (`engines: ">=24 <25"`). That is the intended guard, not a problem to work around; never relax `engines` for it.
- Containers (`node:24-trixie-slim` by digest) and hosted runners (`setup-node` with `node-version-file: .node-version`) are unaffected. `.node-version` stays `24`, so `fnm use` works for a developer who later adds fnm to their profile (the prefix then becomes a no-op).
- Local heavy-lane runs (ADR-0023 amendment, lane B) record `node_version` in their evidence `summary.json`; it must be `24.x`.
- risks.md R-ARCH-09 is closed by this amendment.

## Amendment (2026-11-14, D-ARCH-116): service-image runtime = `debian:trixie-slim` + the Node binary of the pinned node image (TASK-014 / PR #39 D-TASK014-02; platform.md §3.2; `rulings/wave-0-task-014-rulings.md`)

The Node 24 baseline and the rule "Docker base `node:24-trixie-slim` pinned by digest" are **refined, not changed**: that image remains the digest-pinned source of the Node runtime and the base of every build stage, but the `runtime` stage of `apps/api/Dockerfile` and `apps/worker/Dockerfile` is `debian:trixie-slim@sha256:<digest>` with exactly one artefact copied from it, `/usr/local/bin/node`. Measured on the PR #39 images: Debian trixie-slim 83.6 MiB + Node 24.22.3 binary 121.0 MiB = 204.6 MiB of fixed cost; the full node image adds ≈ 47 MiB (npm, corepack, yarn, V8 headers, `ca-certificates`) and would put `api` at ≈ 324 MiB and `worker` at ≈ 344 MiB against the 300 MiB budget of NFR-OPS-002.

Rules (normative; platform.md §3.2 carries the detail):

1. Both `FROM`s are `name:tag@sha256` with an exact version tag and share the Debian codename (lane A rule `runtime-codename`). The official nodejs.org binary needs glibc ≥ 2.28 and links only `libc`, `libm`, `libdl`, `libpthread`, `libstdc++`, `libgcc_s` dynamically (verified `ldd`); `node --version` and the preflight at build time are the fail-fast for any mismatch.
2. Nothing but the binary is copied; the runtime holds no package manager, headers or `docker-entrypoint.sh`.
3. CVE response is a rebuild from Dependabot bumps: `node:` tag + digest for Node security releases, `debian:` digest for Debian point releases (`.github/dependabot.yml` ecosystems `docker` and `docker-compose`, 7-day cooldown). The Node runtime was never a dpkg package in the official image either, so Trivy coverage is unchanged.
4. The runtime has no system CA store: Node's bundled Mozilla store serves outbound TLS; the PostgreSQL CA is a file under `/etc/ssl/platform`; `--use-openssl-ca` is a fail-closed trap and is kept out of the entrypoint allow-list.
5. `/bin/sh` (dash) and `/usr/bin/env` stay: the entrypoint preflight removes `NODE_OPTIONS` before the first Node process (PR3-SEC-13). Distroless bases are therefore **not** the fallback when the budget is tight (platform.md OI-08 superseded); the recorded lever is `gcr.io/distroless/cc-debian13` + a static busybox shell, by superseding amendment only (risks R-ARCH-31).
6. The web/admin images (nginx-unprivileged) and the tooling image (`prisma/Dockerfile`, ADR-0022 am. 15) are unaffected; the tooling image may adopt the same pattern (recommended).

Reversibility: Medium (one Dockerfile stage per service image, one lint rule, two Dependabot entries).

## Amendment (2026-11-16, D-ARCH-138): Terraform CLI tooling licence exception (platform.md §12.2 OI-07; D-TASK015-43; P3 security review licence rules item 4; `rulings/wave-0-sheet-fold-8.md`)

Terraform CLI is licensed BUSL-1.1, which is not on LICENSE_ALLOWLIST. Ruling: a **tooling licence exception**, not a stack change. (1) Scope: the Terraform binary runs only in CI (`iac` job: `fmt -check`, `validate -backend=false`, `plan` once a target exists) and on a developer host; it is never distributed, never in the npm closure (`tools/ci/licence-check.mjs` and `licence-exceptions.json` govern npm packages only, so no entry is added there) and never in an image (the Trivy licence scan of images is unaffected). LICENSE_ALLOWLIST governs what the Platform ships and installs; BUSL-1.1 permits production use of the tool and restricts only competing managed offerings, which the Platform is not. (2) Fallback kept warm: the HCL stays OpenTofu-compatible (§3 table, row "IaC"), `.terraform-version` pins the CLI and the `iac` job calls the setup action by commit SHA, so the switch to OpenTofu (MPL-2.0) is one action and one pin — the only trigger would be a licence change that reached the tool's own use. (3) Checkov (Apache-2.0) is unaffected. Brief §3.3 fixed Terraform, so this records the exception the brief implied rather than a deviation. Reversibility: High.
