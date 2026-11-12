# SPK-01 — Toolchain spike and workspace foundation

| Field | Value |
|---|---|
| Task | TASK-001 (Wave 0, batch 0.1) · branch `feat/TASK-001-spk-01-toolchain-spike-workspace` |
| Risks | R-ARCH-01 (toolchain drift), R-ARCH-17 (Windows/Linux drift), R-ARCH-20 (`--ignore-scripts` vs native/generated deps) |
| Security | SEC-P3-04 / SEC-COND-04 (SEC-TC-45 local part), SEC-P3-31 (`npm exec --no`) |
| Date / host | 2026-11-12 · Windows 11 Pro 10.0.26300, Node v24.22.3 (fnm, PATH prefix), npm 11.19.1, Docker Desktop 29.8.0 (16 CPU, 15.5 GiB) |
| Owner | senior-developer |
| **Verdict** | **GO** for the ADR-0001 runtime/toolchain baseline on the Windows host. Thirteen packages are **not installed** and are deferred to their owning tasks (7-day cooldown, maintenance/licence rules or High advisories; §3, §6) and four ADR wording points need a principal-architect amendment (§5). No ADR-0001 version pin changes. The ubuntu-latest half of the exit criterion closes with TASK-007 (lane A). |

## 1. Exit criterion (risks.md R-ARCH-01/20) — results on the Windows host

Clean-room run at the PR head after `rm -rf node_modules` (every command under the CLAUDE.md §2 PATH prefix):

| Step | Command | Result | Time |
|---|---|---|---|
| Install | `npm ci --ignore-scripts` | 1,505 packages, exit 0 | 39.2 s |
| Allow-listed post-install | `npm run deps:rebuild` | bcrypt prebuild loads → skip; Prisma: no schema yet → skip; Playwright: not requested → skip | 1.1 s |
| Lint | `npm run lint` | 0 problems (`--max-warnings 0`) | 5.5 s |
| Format | `npm run format:check` | clean | 2.0 s |
| Type-check | `npm run typecheck` (`tsc -b`) | exit 0 (16 projects) | 3.6 s |
| Unit | `npm run test:unit` | 4 suites, 38/38 passed | 7.0 s |
| Integration / API | `npm run test:integration` / `test:api` | no suites yet (`--passWithNoTests`), exit 0 | 1.1 s / 1.0 s |
| Coverage | `npm run test:coverage` | exit 0 (no measurable product code yet) | 7.5 s |
| Build | `npm run build` | 9 workspaces `tsc -b`, exit 0 | 3.0 s |
| Audit | `npm audit --audit-level=high` | 0 critical, 0 high (37 moderate, 1 low; §4) | 17.5 s |
| Tree | `npm ls --all` | valid (exit 0) | 3.2 s |

Full baseline install without a cache (`npm install`, lockfile generation): 157 s for 1,505 packages. The first attempt hit `ECONNRESET` after 565 s; retries (`--fetch-retries=6 --fetch-retry-maxtimeout=120000`) fixed it.

Spike probes (throwaway code in commit `7bc9bd3`, removed in the next commit):

| Probe | Result |
|---|---|
| Prisma 7.10.1 `prisma-client` generator + `@prisma/adapter-pg` against `postgres:18` (18.6, `sha256:e3d24f6906d0760bf4da0dae872415391ededefad23fd471c47dc53b0ddf3c42`) | **GO.** `prisma generate` works with no install script (engine-free client, 35 ms generation, 4.8 s CLI wall time). Hello query: `SELECT version()`, `create` with `@default(uuid(7))`, `count`, native `uuidv7()`; 156 ms in-process, 0.8 s wall time. The generated client type-checks under the full strict family (`exactOptionalPropertyTypes`, `verbatimModuleSyntax`, NodeNext) and loads in a Jest test (swc rewrites its `import.meta.url`). |
| React Router 8.5.1 framework mode, `ssr:false` + `prerender: ['/en','/es','/fr']`, Vite 8.3.6, Tailwind 4.3.4 | **GO.** `react-router build` in 4.7 s; HTML for `/en`, `/es`, `/fr` and the SPA fallback; the prerendered HTML contains `<title>` and the localized `<h1>` (NFR-WEB-005). `react-router typegen` + strict `tsc` pass. **Security finding F-SEC-1 (§3).** |
| ESM-only packages under the Jest unit project | **GO with the flag in §2.2.** |
| `openapi-typescript` 7.13.0 under TypeScript 6.0.3 (scoped override) | **GO.** Generates 11,427 lines from `docs/03-architecture/api/openapi.yaml` in 0.5 s; the output type-checks under `--strict`. |
| bcrypt 6.0.0 without install scripts | **GO.** N-API prebuilds ship in the package (`win32-x64`, `linux-x64` glibc + musl, `linux-arm64`, `darwin-*`), so no native build and no toolchain is needed in images. `deps:rebuild` keeps `npm rebuild bcrypt --ignore-scripts=false` as the fallback for a platform without a prebuild. |
| `engine-strict` | System Node v20.20.2 / npm 10.8.2 fail fast with `EBADENGINE` (`node >=24 <25`, `npm >=11.10`). |
| `min-release-age=7` | Supported by npm 11.19.1. 0 of 1,597 lockfile entries are younger than 7 days (newest `undici@8.12.4`, 7.1 days old at generation). |

## 2. Decisions taken inside TASK-001 (no ADR change needed)

1. **Type-check command is `tsc -b`, not `tsc -b --noEmit`.** TypeScript 6.0.3 rejects `--noEmit` in build mode whenever a referenced project emits (`TS6310: Referenced project … may not disable emit`). `tsc -b` emits into the git-ignored `dist/` and `*.tsbuildinfo`, incrementally, so `typecheck` followed by `build` costs nothing extra. Vite apps, `prisma`, `tests/*` and `tools` are `noEmit` leaf projects (allowed). Empty projects use `"files": []` + `include` so they type-check with no inputs (no stub files needed) and pick up files as tasks add them. → wording amendment for ADR-0002 §2/§6 and CLAUDE.md §2 (§5 A-1).
2. **Jest runs with `node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js`.** Under the swc → CommonJS transform, `jose` 6, `uuid` 14, `canonicalize` 5, `otplib` 13 (via `@scure/base`), `cookie` 2 and `nock` 15 fail with "Must use import to load ES Module". Jest 30.5 implements `require(esm)` only when `vm.SourceTextModule` exists, which needs that Node flag. With it, all 23 probed baseline packages load and work (ES256 sign/verify, UUIDv7, RFC 8785, nock interception), including in Jest worker processes. Full native-ESM Jest was not needed and would break `jest.mock` hoisting. → ADR-0024 conventions note (§5 A-2).
3. **Workspace packages resolve to sources through a custom export condition.** `exports["."]` = `{ "@platform/source": "./src/index.ts", "types": "./dist/index.d.ts", "default": "./dist/index.js" }`; `tsconfig.base.json` sets `customConditions: ["@platform/source"]` and Jest sets `customExportConditions`. Node at runtime (images) uses `dist/`, so no TypeScript is loaded from `node_modules`. Dev runners must pass `--conditions=@platform/source` (TASK-006 `dev:api`/`dev:worker`, TASK-004 Vite `resolve.conditions`).
4. **Jest `roots` instead of `<rootDir>/{a,b}/**` globs.** That brace glob matched 0 files on Windows (mixed separators). Explicit `roots` + root-relative `testMatch` work on both platforms and shrink the haste map.
5. **Coverage.** The v8 provider reports never-imported files as uncovered lines, so the seven `export {}` package entry points made `test:coverage` fail with no product code. Pure entry barrels (`packages/*/src/index.ts`) are excluded from `collectCoverageFrom`. Only the global 85/75 threshold is configured now, because Jest fails a per-path threshold that matches no files. **TASK-015** (coverage gates) adds the 95 % per-path thresholds for `packages/{pricing,audit,authz}` once they contain code. TASK-002 lint should keep entry files re-export-only.
6. **`deps:rebuild` uses `npm exec --no -- <bin>`**, not `npx`, so a missing local binary fails instead of being downloaded (SEC-P3-31 / SEC-TC-64; ADR-0023 am. F still says `npx prisma generate`).
7. **`@hookform/resolvers` 5.9.2 instead of 7.x.** 7.x declares the optional peer `effect ^4`, while Prisma 7.10 depends on `effect` 3.20, which makes `npm ls` invalid. 5.9.2 (MIT, 2026-10-17) declares `effect ^3` and has the same `zodResolver` API with Zod 4 support.
8. **`openapi-typescript` scoped override** `"overrides": { "openapi-typescript": { "typescript": "$typescript" } }`. 7.13.0 (latest) declares the peer `typescript ^5.x`; generation under 6.0.3 was verified (§1). Remove the override when upstream widens the peer.
9. **`--passWithNoTests`** on `test:integration` / `test:api` until the first suites land (TASK-003 Prisma harness, TASK-276 test harness). The required-suites `min_tests` gate (lane B, TASK-011) is the guard against an empty suite after that. `test:e2e` exists (AT-US-001-04) but fails until TASK-004 adds `tests/e2e/playwright.config.ts` and Playwright.
10. **Baseline lint/format configs.** A minimal `eslint.config.mjs` (`@eslint/js` + `typescript-eslint` recommended) and `.prettierrc` / `.prettierignore` (docs and Markdown excluded; `docs/04-plan` is generated) so lint and format gate from the first merge. TASK-002 owns and replaces them.

## 3. Findings for other tasks

| ID | Finding | Owner / action |
|---|---|---|
| **F-SEC-1** | **`@react-router/dev` installs packages on its own.** When an app has no custom `app/entry.server.tsx` and `isbot` is not in the nearest `package.json` `dependencies`, `react-router build`/`typegen` rewrites that `package.json` (`isbot: "^5"`) and runs `npm install` through `execSync` (`dist/typegen-*.js`). In the spike, the nearest `package.json` was outside the workspace graph, so that install ran **without the committed `.npmrc`** (no `ignore-scripts`, no cooldown). This bypasses SEC-P3-04. | **TASK-004:** give `apps/web` and `apps/admin` a custom `app/entry.server.tsx` (with `ssr:false` + prerender, bot detection is not needed) **or** declare `isbot` explicitly (5.x, Unlicense). **TASK-007:** lane A must fail when `build` changes any tracked file (`git diff --exit-code` after build). security-analyst to confirm. |
| F-02 | `eslint-plugin-jsx-a11y` 6.10.2 is the latest release, last published 2024-10-26 (> 18 months, CLAUDE.md §5), and its peer range stops at ESLint 9. Not installed. Candidate: `eslint-plugin-jsx-a11y-x` 0.2.0 (MIT, es-tooling fork, peer `eslint ^9 \|\| ^10`, 2026-05-10). | principal-architect: ADR-0002 §5 amendment; then TASK-002. |
| F-03 | `prom-client` 15.1.3 is **deprecated** ("replaced by `@prometheus-io/client`"), last release 2024-06. Not installed. Candidate: `@prometheus-io/client` 0.16.1 (Apache-2.0, 2026-08-27, Node `^22 \|\| ^24`). | principal-architect: ADR-0025 amendment; then the metrics task (ADR-0017). |
| F-04 | `stylelint-use-logical` 2.1.3 declares the peer `stylelint >=11 <18`; Stylelint 18.0.0 was released 2026-11-03. Neither is installed (no CSS exists yet). | TASK-002: Stylelint 17 + plugin, or 18 with the plugin verified under a scoped override. If 17 is chosen, ADR-0002 §5 wording changes. |
| F-05 | 7-day cooldown blocks ADR versions published this week: `i18next` 27 (first release 2026-11-07), `react-i18next` 18 (2026-11-07, peer `i18next >=27.0.1`), `@playwright/test` 1.65.0 (2026-11-05T18:30Z) and its peer consumer `@axe-core/playwright` 4.14. Not installed. | TASK-004 (Playwright, after 2026-11-12T18:30Z) and the i18n task (TASK-042, after 2026-11-14). `i18next-icu` / `intl-messageformat` go in with i18next. |
| F-06 | `@lhci/cli` 0.16 and `@size-limit/preset-app` 14 pull puppeteer/lighthouse chains with **17 High** advisories (`basic-ftp`, `extract-zip`, `nanoid`, nested `zod` < 4.6.6, `chromium-bidi`). Not installed; with them removed, High = 0. | T-QA-09: run LHCI as a pinned container (tool register, D-ARCH-003 rev 2 item 4). TASK-004: `size-limit` with `@size-limit/file` only (byte budgets, no puppeteer). |
| F-07 | Stryker 10 depends on Babel 8 and hoists `@babel/core@8`, which leaves Jest 30's `babel-preset-current-node-syntax` plugins with an invalid `^7` peer (`npm ls` exits non-zero). Not installed. | The mutation task (`gate` profile): install Stryker in an isolated tool directory with its own lockfile, or wait for Jest to move to Babel 8. |
| F-08 | Lockfile provenance: 6 entries have no `resolved`/`integrity` because they are `bundledDependencies` (`inBundle: true`) inside `@tailwindcss/oxide-wasm32-wasi`, covered by the parent tarball's sha512. 5 entries are npm aliases (`@jest/react-is-18` → `npm:react-is@18.3.1`, `string-width-cjs`, `strip-ansi-cjs`, `wrap-ansi-cjs`); their registry name is the entry's `name` field, not the path. | TASK-007: `check-lockfile.mjs` exempts `inBundle` entries; `check-dep-age.mjs` resolves aliases through `name`. |
| F-09 | `npm audit` after the change: 0 critical, 0 high, 37 moderate, 1 low. All are upstream dev-tooling chains (`glob`/`minimatch`/`deepmerge` under Jest, ESLint, typescript-eslint, `testcontainers`→`archiver`). The **production** closure (`--omit=dev`) has 5 moderate: `glob` 10 via `@opentelemetry/auto-instrumentations-node` → GCP resource detector → `gcp-metadata` → `gaxios` → `rimraf`. No fix within the pinned majors. | security-analyst triage. ADR-0017 task may drop the GCP detector (AWS only) and import the specific instrumentations instead of the `auto-instrumentations-node` meta-package. |
| F-10 | `@swc/jest` 0.2.39 (latest) was published 2025-07-09. It turns > 18 months old on **2027-01-09**. | Freshness watch for the dependency-auditor baseline (R-ARCH-12). |
| F-11 | API notes from the probes: `cookie` 2 renamed `parse` → `parseCookie` (and `serialize` → `stringifySetCookie`); `@types/opossum` 8.1.9 lags `opossum` 10; the Prisma `prisma-client` generator writes `globalThis.__dirname` in the generated client. | Identity tasks (cookie); TASK-003 keeps `prisma/generated` git-ignored (already in `.gitignore`). |
| F-12 | TypeScript 6 behaviour change: `tsc <file>` in a directory that has a `tsconfig.json` now fails with `TS5112` unless `--ignoreConfig` is passed. | Anyone scripting ad-hoc `tsc` calls. |
| F-13 | `tsc -b` compiles `*.test.ts` into `dist/` (one tsconfig per workspace covers source and tests). | TASK-014: exclude `**/*.test.*` from runtime image stages, or add a `tsconfig.build.json` per app. |
| **F-14** | **`npm ci --omit=dev` is not enough for runtime images.** `prisma` (CLI), `@prisma/studio-core`, `elkjs` (**EPL-2.0**, not on LICENSE_ALLOWLIST), `@visx/*` **4.0.x-alpha** pre-releases and `typescript` are flagged `devOptional` in the lockfile. They are dev dependencies, but also reachable as optional peers of production packages (`@prisma/client` → `peerOptional prisma`; `react-router` → optional `typescript`). npm drops `devOptional` packages only when **both** `dev` and `optional` are omitted. | TASK-014: runtime stages (`api`, `worker`) install with `npm ci --omit=dev --omit=optional --ignore-scripts`, or prune afterwards, and verify that the runtime prebuilds still work (bcrypt ships its prebuilds inside the package, not as optional dependencies). Only the migrate job image keeps the Prisma CLI, and that image's licence closure must exclude Studio (`elkjs`). The Trivy licence scan on images (D-ARCH-003 rev 2 item 5) is the backstop. security-analyst to confirm. |
| F-15 | Licence metadata in the lockfile: `ssh2`, `cpu-features` and `buildcheck` (dev, via `testcontainers` → `docker-modem`) use the legacy `licenses: [{type: "MIT"}]` array, so the lockfile has no `license`. `png-js` 2.0.0 (prod, via `pdfkit`) has no licence field, but its `LICENSE` file is MIT. `@visx/vendor` declares `"MIT and ISC"` (lower-case operator). `caniuse-lite` is CC-BY-4.0 (dev build data, allowed by D-ARCH-003 rev 2 item 2). | TASK-007 `licence-check.mjs`: read installed `package.json` files (legacy `licenses` arrays), keep an explicit LICENSE-file override list (`png-js`), and parse SPDX operators case-insensitively. |

## 4. Windows host specifics (R-ARCH-17)

- **Line endings.** `core.autocrlf=true` on the host, but `.gitattributes` `* text=auto eol=lf` wins: `git ls-files --eol` shows `i/lf w/lf`, and no file written by this task contains CR. Files written through Node or the shell are LF.
- **Path length.** Longest path under the worktree: 73-character root + 154 characters under `node_modules` = about 227 of 260. Git `core.longpaths=true` is set. A repository root more than about 30 characters deeper than `C:\Users\<user>\Documents\Projects\Garudavega\` would risk `MAX_PATH` failures in tools that do not use `\\?\` paths.
- **Excluded TCP port ranges (Hyper-V/WinNAT).** Binding `127.0.0.1:55432` failed (`bind: An attempt was made to access a socket in a way forbidden`). Excluded ranges on this host: 5357, 44332, 44399, 49810–49909, 50000–50059, 50160–50359, 51527–51726, 54640–54839, 55409–55508, 55809–55908, 55987–56086, 56375, 58488–58687, 60506. The Compose ports in CLAUDE.md §2 (3000, 5432, 6379, 8025, 8080, 8081, 1025) and the observability ports (3001, 4317/4318, 9090, 16686) are **not** excluded. Testcontainers uses ephemeral ports, so it is unaffected. → TASK-014: avoid fixed host ports in the 49152+ range.
- **Docker Desktop** 29.8.0 is available (Linux engine, 16 CPUs, 15.5 GiB). `postgres:18` pull took 81 s. Ready for the Testcontainers tasks (TASK-003/008).
- **Defender** causes harmless `EPERM rmdir` cleanup warnings during large installs.
- **Child processes.** Tooling tests spawn `process.execPath <script>` (npm via `npm-cli.js`, tsx via `dist/cli.mjs`). There are no `.cmd` shims and no `shell: true`, so they run the same on Windows and Linux.

## 5. ADR amendment requests (principal-architect)

None changes a version pin in the ADR-0001 baseline table. All four are wording or convention updates:

- **A-1 (ADR-0002 §1, §2, §6; CLAUDE.md §2):** "npm 10" → npm ≥ 11.10 (bundled with Node 24.22; required for `min-release-age`), with `engines.npm ">=11.10"`. `npm run typecheck` = `tsc -b` (§2.1). `.npmrc` also carries `audit=false` and `min-release-age=7` (ADR-0023 am. F "once SPK-01 confirms": **confirmed**).
- **A-2 (ADR-0024 conventions; ADR-0002 §6):** Jest scripts run under `node --experimental-vm-modules` for `require(esm)` (§2.2). Workspace packages use the `@platform/source` export condition (§2.3).
- **A-3 (ADR-0002 §5, ADR-0025):** replacements for `eslint-plugin-jsx-a11y` (F-02) and `prom-client` (F-03); the Stylelint 18 / `stylelint-use-logical` choice (F-04); LHCI as a container and `size-limit` without `preset-app` (F-06); the Stryker isolation approach (F-07).
- **A-4 (ADR-0002 §Alternatives, ADR-0023 am. F item 1, platform.md image stages):** the `prod-deps` stage installs with `--omit=dev --omit=optional` (F-14), so the Prisma CLI, Studio (`elkjs` EPL-2.0) and TypeScript stay out of runtime images.

## 6. Version pins delivered (`package-lock.json`)

Toolchain (exact): `typescript` 6.0.3, `jest` / `@jest/globals` / `jest-environment-jsdom` 30.5.2, `prisma` = `@prisma/client` = `@prisma/adapter-pg` 7.10.1, `react-router` / `@react-router/dev` / `@react-router/node` 8.5.1, `vite` 8.3.6, `tailwindcss` / `@tailwindcss/vite` 4.3.4.

Resolved under the cooldown (caret in manifests): `@swc/core` 1.16.21, `@swc/jest` 0.2.39, `tsx` 4.23.15, `eslint` 10.14.0, `typescript-eslint` 8.72.1, `prettier` 3.9.10, `express` 5.3.0, `joi` 18.3.2, `pino` 10.4.0, `pino-http` 11.0.0, `jose` 6.2.15, `bcrypt` 6.0.0, `otplib` 13.6.0, `bullmq` 6.7.0, `ioredis` 6.0.0, `pg` 8.23.1, `uuid` 14.0.3, `helmet` 8.3.0, `express-rate-limit` 8.7.3, `rate-limit-redis` 6.0.2, `cookie` 2.0.1, `opossum` 10.0.0, `p-limit` 7.3.3, `canonicalize` 5.1.0, `bowser` 2.15.0, `stripe` 23.1.0, `nodemailer` 10.3.1 (MIT-0), `pdfkit` 0.20.2, `@aws-sdk/*` 3.1162.0, `@opentelemetry/sdk-node` 0.300.0, `swagger-ui-dist` 5.34.1, `react` / `react-dom` 19.3.1, `axios` 1.21.0, `@tanstack/react-query` 5.106.1, `@tanstack/react-table` 9.3.1, `react-hook-form` 7.91.0, `@hookform/resolvers` 5.9.2, `zod` 4.6.7, `radix-ui` 1.8.1, `uqr` 0.1.3, `web-vitals` 6.2.3, `testcontainers` 12.2.1, `supertest` 7.3.1, `nock` 15.0.5, `fast-check` 4.10.2, `ajv` 8.20.0, `@apidevtools/swagger-parser` 13.1.0, `@redocly/cli` 2.75.0, `openapi-typescript` 7.13.0, `@commitlint/cli` 21.2.4, `eslint-plugin-boundaries` 7.4.1, `eslint-plugin-import-x` 4.17.1, `eslint-plugin-i18next` 6.1.5, `eslint-plugin-react-hooks` 7.1.1.

Not installed (deferred, §3): `i18next`, `react-i18next`, `i18next-icu`, `intl-messageformat`, `@playwright/test`, `@axe-core/playwright`, `stylelint`, `stylelint-use-logical`, `eslint-plugin-jsx-a11y`, `prom-client`, `@lhci/cli`, `size-limit` (+ presets), `@stryker-mutator/*`.

## 7. Open (not closable on this host)

- **ubuntu-latest half** of the R-ARCH-01/17/20 exit criterion: `npm ci --ignore-scripts && npm run deps:rebuild && npm run typecheck && npm run test:unit && npm run build` on the hosted runner. It closes with TASK-007 (lane A), the first PR to run it.
- **SEC-TC-45 remaining parts** (Dockerfile and `quality:heavy` installs, the age script, the lockfile URL check): TASK-007/011/014.
