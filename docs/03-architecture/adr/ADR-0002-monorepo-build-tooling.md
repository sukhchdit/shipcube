# ADR-0002: Monorepo, build and developer tooling

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** ADR-0001, ADR-0003 (module boundaries), ADR-0024 (testing), ADR-0026 (frontend), REQ-PLAT-001..003, NFR-MAINT-001/002, NFR-WEB-004/005

## Context

Brief §4.1 fixes the repository layout (`apps/{web,admin,api,worker}`, `packages/{shared,ui,carriers,pricing,audit,authz,config}`, `prisma`, `infra`, `tests`, `docs`). CLAUDE.md §2 requires npm workspaces, TypeScript strict and Node/TypeScript tooling only (no Python on the Windows 11 host). §3.3 requires public pages to be pre-rendered (React Router framework mode). The build must give every workspace one set of root scripts (REQ-PLAT-003) and enforce layering by lint (REQ-PLAT-002).

## Decision

1. **Package manager and workspaces.** npm 10 workspaces, one root `package.json`, `package-lock.json` committed, `.npmrc` with `engine-strict=true`, `save-exact=true` for toolchain pins, `fund=false`, `audit=false` (audit runs as an explicit CI step). Workspaces: `apps/*`, `packages/*`, `prisma`, `tests/*`. Internal packages are consumed as TypeScript sources via `exports` → `src/index.ts` in dev/test (no publish step) and compiled by each consuming app's build.
2. **TypeScript project layout.** Root `tsconfig.base.json` (strict family, `module: NodeNext`, `target: ES2023`, `moduleResolution: NodeNext` for Node packages; `bundler` for Vite apps), `tsconfig.json` per workspace extending it, root `tsconfig.json` with `references` for `tsc -b --noEmit` type-check of everything in one command. Path aliases are **not** used; imports go through package names (`@platform/shared`, `@platform/ui`, …) so boundaries are visible to ESLint.
3. **Backend build/run.** `apps/api` and `apps/worker` are compiled with `tsc -b` to `dist/` (plain ESM, no bundler → stack traces and Prisma generated client stay simple), run with `node dist/main.js`. Dev: `tsx watch src/main.ts`. Prisma client generated to `prisma/generated` and consumed by `apps/api`, `apps/worker`, `prisma/seed`.
4. **Frontend build.** Vite 8 with `@react-router/dev` (React Router 8 framework mode). `apps/web`: `react-router.config.ts` → `ssr: false`, `prerender: [...]` for public routes per locale (`/{en,es,fr}`, `/{lang}/track`, `/{lang}/tools/prohibited-items`, `/{lang}/legal/{terms,privacy}`, help placeholders — **not** `/`, which Nginx redirects to `/{lng}/`, ADR-0026 amendment 4) (D-026, NFR-WEB-005); output `build/client` served by Nginx with the SPA fallback `index.html`. `apps/admin`: `ssr: false`, no prerender (SPA). Route-level code splitting is native to framework mode; `size-limit` enforces NFR-WEB-004 budgets; `rollup-plugin-visualizer` reports are CI artifacts.
5. **Lint/format.** ESLint 10 flat config at the root with `typescript-eslint` (type-aware), `eslint-plugin-boundaries` (layering and package rules, ADR-0003), `eslint-plugin-import-x` (no cycles, no `apps/*` cross-imports), `eslint-plugin-i18next` (`no-literal-string` in JSX, NFR-I18N-001), `eslint-plugin-react-hooks`, `eslint-plugin-jsx-a11y`; custom local rules for: money arithmetic on `Money`, forbidden `toFixed/toLocaleString/parseFloat` outside helpers (NFR-I18N-004, NFR-DATA-001), outbound HTTP only via the SSRF-safe client (NFR-SEC-010), audit writer import allow-list (REQ-AUDIT-001), no `innerHTML`/`dangerouslySetInnerHTML` outside the sanitising component (REQ-SEC-016). Prettier 3 for formatting; Stylelint 18 with `stylelint-use-logical` (NFR-I18N-003) and a rule requiring hover styles inside `@media (hover: hover)` (NFR-A11Y-006). `--max-warnings 0`.
6. **Root scripts** (REQ-PLAT-003; these are the CLAUDE.md §2 commands):
   - `npm run lint` → `eslint . --max-warnings 0 && stylelint "apps/**/*.css" "packages/ui/**/*.css"`
   - `npm run format:check` / `npm run format` → `prettier --check .` / `prettier --write .`
   - `npm run typecheck` → `tsc -b --noEmit`
   - `npm run test:unit` → `jest --selectProjects unit`
   - `npm run test:integration` → `jest --selectProjects integration` (Testcontainers; Docker required)
   - `npm run test:api` → `jest --selectProjects api` (Supertest + OpenAPI response validation)
   - `npm run test:e2e` → `playwright test -c tests/e2e/playwright.config.ts`
   - `npm run test:coverage` → `jest --coverage` (thresholds in `jest.config.ts`)
   - `npm run test:load` → `docker compose -f tests/load/compose.k6.yml run k6 ...`
   - `npm run build` → `npm run build --workspaces --if-present`
   - `npm run openapi:lint` / `openapi:types` → `redocly lint docs/03-architecture/api/openapi.yaml` / `openapi-typescript ... -o packages/shared/src/api/types.gen.ts`
   - `npm run db:migrate`, `db:migrate:deploy`, `db:seed`, `db:seed:demo`, `db:reset` (Prisma + seed CLI in `prisma/`)
   - `npm run dev` → `docker compose up` (full stack) ; `npm run dev:api|dev:worker|dev:web|dev:admin` for hot-reload against the compose data services.
7. **Git hygiene.** Conventional Commits enforced by `commitlint` in CI (not a local hook requirement); `lint-staged` optional locally; `.gitattributes` LF (already present); Gitleaks pre-commit documented.
8. **Tooling scripts** (migration linter, `.env.example` parity, repository-structure test, licence/age checks) are written in TypeScript and run with `tsx` (no Python).

## Alternatives considered

- **pnpm / Turborepo / Nx.** pnpm would be faster, but CLAUDE.md §2 fixes npm; Turborepo/Nx add a task-graph layer that npm workspaces + `tsc -b` references cover adequately at this size (4 apps, 7 packages). Revisit if CI time exceeds the 20-minute budget (NFR-OPS-003).
- **Bundling the API with esbuild.** Smaller image but complicates Prisma generated client loading and source maps; `tsc` output + `npm ci --omit=dev --ignore-scripts` (ADR-0023 amendment F) keeps images under 300 MB (NFR-OPS-002) since Prisma 7 ships no engine.
- **Next.js / Remix for the public site.** Not in the fixed stack; React Router framework mode provides pre-rendering natively (verified reactrouter.com/how-to/pre-rendering, 2026-11-12).
- **`ts-jest`.** Works with TS 6 but couples Jest to the compiler version; `@swc/jest` transpiles without type-checking (type-check is a separate CI step) and is 3–5× faster.

## Consequences

- One command per concern (REQ-PLAT-003); layering and package rules are lint-enforced with negative fixtures (NFR-MAINT-001).
- Framework-mode pre-rendering produces per-locale HTML with `<title>`, meta, `hreflang` and primary heading in the HTML (NFR-WEB-005); loaders on pre-rendered routes run at build time, so public pages read reference data from a build-time snapshot or client-side fetch (ADR-0026).
- Negative: developers must run Docker for integration tests; type errors are not reported by Jest (by design) — `npm run typecheck` is required in the DoD.

## Reversibility

High for tooling choices (lint plugins, Jest transform); medium for the framework-mode pre-rendering model (route structure depends on it).
