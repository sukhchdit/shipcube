# Code review: PR #1, TASK-001 (SPK-01 toolchain spike and workspace foundation), round 1

| Field | Value |
|---|---|
| PR | https://github.com/sukhchdit/shipcube/pull/1 |
| Branch / head | `feat/TASK-001-spk-01-toolchain-spike-workspace` @ `76b69c0` (6 commits over `main` @ `1ba1b00`) |
| Reviewer | code-reviewer (independent), 2026-11-12 |
| Inputs | WAVE-00.md TASK-001 spec; PLAN.md §5, §7; CLAUDE.md §2/§8/§9; ADR-0001, 0002, 0003, 0023 (am. F), 0024, 0025; ARCHITECTURE.md §139; TEST-STRATEGY §8; US-001 Gherkin; PR body; `docs/04-plan/spikes/SPK-01.md` |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A strong, well-documented foundation. Every root script is green on the Windows host, the spike code is gone
         from the final tree, the lockfile provenance is clean, and the design choices (tsc -b, the vm-modules flag,
         the @platform/source condition) hold up. Two small MAJORs block approval. Coverage is collected only from
         {apps,packages}/*/src, so React Router app/ code and prisma/ fall outside the "whole repository" 85/75 gate.
         AT-US-001-04 ("a type error in any workspace") checks a fixture, not the repository's solution file.
         Both are fixes of roughly 15 lines.
```

## 1. Verification performed by the reviewer (not taken from the PR)

All commands ran in the worktree under `export PATH="$APPDATA/fnm/aliases/default:$PATH"`: Node v24.22.3, npm 11.19.1.

| Check | Result |
|---|---|
| `npm run lint` | exit 0, 0 problems |
| `npm run format:check` | exit 0 |
| `npm run typecheck` (`tsc -b`) and `tsc -b --force --verbose` | exit 0, 16 projects |
| `npm run test:unit` | 4 suites, **38/38 passed** |
| `npm run test:integration` / `test:api` | no tests, exit 0 (`--passWithNoTests`, as documented) |
| `npm run test:coverage` | exit 0; summary `0/0 (Unknown%)`, so the global threshold is vacuous today |
| `npm run build` | exit 0 (9 workspaces) |
| `npm run deps:rebuild` (real run, not the dry run) | bcrypt skip (prebuild loads), prisma skip, playwright skip, exit 0 |
| `npm audit` | 0 critical, 0 high, 37 moderate, 1 low (matches the PR) |
| `npm ls --all` | exit 0 (valid tree) |
| Lockfile (v3, 1,633 entries) | every non-link entry resolves from `https://registry.npmjs.org/` with `sha512` integrity, except 6 `inBundle` entries under `@tailwindcss/oxide-wasm32-wasi`; no `spikes/` entries; `isbot` only via `@react-router/dev` |
| Spike removal | `git diff 7bc9bd3^ 3f9c797` is empty; no `spikes/` path at HEAD; PLAN §7.8 squash merge keeps it off `main` |
| Line endings | `git ls-files --eol`: every text file is `i/lf w/lf`; `.gitattributes` (`* text=auto eol=lf`) is already on `main` |
| `git status --porcelain` after all runs | clean |
| **Type-error injection** (scratch copy of HEAD) | a `TS2322` injected into `packages/pricing/src`, `apps/api/src/modules/quotes/service`, `apps/web/app`, `prisma/seed` and `tests/e2e` is reported by `tsc -b` (exit 2) in every case. A cross-workspace import of `@platform/pricing` from `apps/api` resolves and type-checks. An incremental re-run with no changes still exits 2, so errors persist in the build info. |
| **TS6310 claim** | confirmed: `tsc -b --noEmit --force` fails with `TS6310 Referenced project … may not disable emit`. Side note: `tsc -b --noEmit` on an up-to-date tree exits 0, so the ADR wording would also have produced false greens. |
| **Stale output** | deleting a source leaves its `.js`/`.d.ts` in `dist/`, because `tsc -b` never cleans (see m9) |
| `rebuild.mjs` entry guard | works through a lower-case drive letter and an 8.3 short path. **Exits 0 and does nothing** when invoked through a junction or symlink path (see m1). |

## 2. Findings

| ID | Severity | file:line | Issue | Required fix |
|---|---|---|---|---|
| M1 | **MAJOR** | `jest.config.ts:33-40` | `collectCoverageFrom: '{apps,packages}/*/src/**/*.{ts,tsx}'` leaves out **`apps/web/app/**` and `apps/admin/app/**`** (React Router framework mode keeps its code in `app/`; this PR's own `apps/{web,admin}/tsconfig.json` includes `app`) and leaves out **`prisma/**`** (seed framework, TASK-023). TEST-STRATEGY §8 defines the 85/75 gate over the *whole repository*. TASK-004 (batch 0.2) adds `app/` code and TASK-007 (0.3) starts gating `test:coverage`, both before TASK-015 (0.5), whose spec only mentions thresholds. So the frontend would sit outside the gate and nothing would report it. | Widen the scope now, for example `'{apps,packages}/*/{src,app}/**/*.{ts,tsx}'` and `'prisma/{seed,src}/**/*.ts'`, keeping `!**/*.test.*`, `!**/*.d.ts`, `!**/*.generated.ts` and adding generated-output exclusions (`!**/.react-router/**`, `!prisma/generated/**`). Add a unit test that asserts each workspace's source roots, as declared in its tsconfig `include`, are matched by `collectCoverageFrom`. Alternatively, record a scope note in SPK-01 §2.5 and hand an explicit condition to TASK-015. The wider glob is still required in this PR, because lane A starts gating before TASK-015. |
| M2 | **MAJOR** | `tools/repo/root-scripts.test.ts:73-83`, `tsconfig.json:4-21` | AT-US-001-04 says "a type error introduced in **any workspace**" fails `npm run typecheck`. The test shows that `tsc -b` fails on a two-project fixture, which is a property of TypeScript. It does not show that the repository's solution file reaches every workspace. Deleting `{ "path": "apps/web" }` from the root `tsconfig.json`, or adding a workspace without a reference, leaves every test green while that workspace silently drops out of type-checking. Today all 15 workspaces plus `tools` are referenced (the reviewer checked by injection), but nothing guards that. DoD §8 requires the AC to be *demonstrated by tests*. | Add a test, for example in `root-scripts.test.ts`, that uses `listManifests()` to assert: (a) every workspace directory has a `tsconfig.json`; (b) the root `tsconfig.json` `references` contain exactly those directories plus `tools`; (c) no referenced project has an empty `include` that also lacks `files`. Keep the fixture test as the mechanism proof. |
| m1 | MINOR | `tools/deps/rebuild.mjs:136` | The entry guard `resolve(process.argv[1]) === fileURLToPath(import.meta.url)` compares the given path with the realpath. Invoked through a junction or symlink path, the script **does nothing and exits 0** (reproduced). That is a false green on the only allow-listed post-install step (images, CI caches and mounted workspaces can all hit it). | Use `import.meta.main` (Node ≥ 24.2; `engines` already requires 24), or compare `realpathSync(process.argv[1])`. Better still, split it into `rebuild-plan.mjs` (pure) and a CLI entry, the same pattern as `check-structure.ts`. |
| m2 | MINOR | `tools/deps/ignore-scripts.test.ts:146-168` | The test titled "bcrypt works … **after deps:rebuild**" never runs `deps:rebuild`. It checks the current tree, and the other tests only exercise `--dry-run`. `main()` is untested: the spawn loop, the exit-code propagation and the post-run bcrypt verification. | Run `node rebuild.mjs` with no flags in the test (it is a no-op here, about 1 s). Assert exit 0 and the three `[deps:rebuild] <id>: skip` lines. Optionally inject a failing probe through an env seam to cover the `return 1` path. |
| m3 | MINOR | `package.json:25-28` (spike removed in `3f9c797`) | `--experimental-vm-modules` exists only because ESM-only runtime dependencies (`jose`, `uuid`, `cookie`, `canonicalize`, `otplib`, `nock`) must load under the swc to CJS transform. That evidence left with the spike, and no permanent test locks it in, so removing the flag stays green until some later feature test breaks. | Keep a small permanent toolchain test, such as `tools/repo/jest-esm.test.ts`, that imports `uuid` (v7) and `jose`, signs and verifies once, and names the flag in its title. This is foundation code, not spike code. |
| m4 | MINOR | `jest.config.ts:38-39` | `!packages/*/src/index.ts` is a permanent exclusion that rests on the convention that barrels are re-export-only, and nothing enforces it yet (SPK-01 §2.5: "TASK-002 lint *should*…"). Logic added to an entry file would never count toward coverage. | Make it a tracked condition for TASK-002: a lint rule restricting `packages/*/src/index.ts` to re-exports. Or remove the exclusion once the packages export real modules: v8 counts executed re-export lines as covered. Record whichever is chosen in SPK-01 §2.5. |
| m5 | MINOR | `tools/repo/structure.ts:45-46, 77-79` | The checker accepts `<layer>/` **or** `<layer>.ts` for every layer, including `tests`. ADR-0003 names folders. ARCHITECTURE.md §139 names files for `routes`…`events` and a **folder** for `tests/`. So `tests.ts` passes, and a module keeping both `routes/.gitkeep` and `routes.ts` passes without comment. The reconciliation itself is sensible, but it amends ADR-0003 wording and is not one of the SPK-01 §5 requests. | Accept only a directory for `tests`, and add a unit case for it. Add the file-or-folder rule to the SPK-01 §5 amendment list (ADR-0003 wording). Optionally have TASK-006 delete the `.gitkeep` folder when it adds `<layer>.ts`. |
| m6 | MINOR | `docs/04-plan/spikes/SPK-01.md` §1, §3 | The R-ARCH-20 inventory is incomplete. The lockfile has 12 `hasInstallScript` packages: `bcrypt`, `prisma`, `@prisma/engines`, `esbuild`, `@swc/core`, `@parcel/watcher`, `protobufjs`, `msgpackr-extract`, `@scarf/scarf`, `ssh2`, `cpu-features`, `fsevents`. Only bcrypt, `prisma generate` and Playwright have a disposition. In particular, `@prisma/engines`' skipped postinstall is what fetches the schema engine used by `prisma migrate`. The spike created its table with raw SQL, so **`prisma migrate` under `ignore-scripts` is unverified**: it may download a binary at run time from outside the lockfile's integrity chain, or fail offline. | Add a table to SPK-01 §3 with one row per `hasInstallScript` package: what the script does, why skipping it is safe, and which owner verifies it. Hand "`prisma migrate deploy` works after `npm ci --ignore-scripts` + `deps:rebuild` with no network fetch, or the fetch is allow-listed" to TASK-003 and security-analyst. |
| m7 | MINOR (process) | `package.json:23`, `tools/deps/rebuild.mjs:91,102`, SPK-01 §5 | The PR knowingly departs from Accepted ADR text: `typecheck` = `tsc -b` against ADR-0002 §2/§6 and DECISIONS.md L345 (`tsc -b --noEmit`); npm ≥ 11.10 against "npm 10"; `npm exec --no` against `npx` in ADR-0023 am. F; the file-or-folder layer (m5). The reasons are sound and the reviewer verified TS6310, but CLAUDE.md §5 requires a principal-architect amendment verified by quality-gatekeeper. | Not a code change. Before batch 0.2 starts, the orchestrator sends SPK-01 §5 A-1..A-4 (plus m5) to principal-architect and logs them in DECISIONS.md. |
| m8 | MINOR | `jest.config.ts:21-23` | `testEnvironmentOptions.customExportConditions = ['@platform/source','node','node-addons']` sits in the shared project config. A `@jest-environment jsdom` test (TASK-004, RTL) then resolves packages with node conditions instead of `browser`. | When TASK-004 adds component tests, give jsdom its own project or override to `['@platform/source','browser']`. A one-line note in the jest config comment is enough now. |
| m9 | MINOR | `apps/*/tsconfig.json`, `packages/*/tsconfig.json` (`outDir: dist`) | `tsc -b` never removes stale outputs (reproduced), and it compiles `*.test.ts` into `dist/` (SPK-01 F-13). An image built from a non-clean context could ship renamed or deleted modules and test code. | Hand to TASK-014: the build stage starts from a clean context (`.dockerignore` lists `**/dist`, `**/*.tsbuildinfo`) or runs `tsc -b --clean` first. Optionally add a root `clean` script now. |
| n1 | NIT | `eslint.config.mjs:10` | `tseslint.config()` is `@deprecated` in typescript-eslint 8.72 in favour of ESLint's `defineConfig()`. | TASK-002 replaces this file; use `defineConfig` there. |
| n2 | NIT | `tools/repo/structure.test.ts:74-78` | `expect(result.stderr).toBe('')` breaks on any harmless Node or tsx warning. | Assert `status === 0` and `stdout` contains "Repository structure complete." |
| n3 | NIT | `tools/repo/structure.test.ts:47, 68` | The Gherkin says "packages/authz is **renamed**"; the fixture *omits* the folder. The result is the same, but the wording differs. | Optionally create `packages/authz-old` in the fixture so the test reads like the scenario. |
| n4 | NIT | `tools/deps/rebuild.mjs:28-39`, `tools/test-support/process.ts:32-43` | `npmCli()` is duplicated. | Acceptable while `rebuild.mjs` must stay loader-free. Add a cross-reference comment. |
| n5 | NIT | `package.json:25-28` | `--disable-warning=ExperimentalWarning` hides every experimental warning, not only the vm-modules one. | Acceptable; mention it in the ADR-0024 conventions note (A-2). |
| n6 | NIT | `jest.config.ts:53` | The unit project ignores `.int.test.ts` and `.api.test.ts` but not `.int.test.tsx` or `.api.test.tsx`. | Use `'\\.(int|api)\\.test\\.tsx?$'`. |

Answers to the focus questions:

- **`tsc -b` as typecheck:** sound. Injected errors in every kind of workspace are caught, errors persist across incremental runs, and `--noEmit` is genuinely impossible (TS6310). The emit to `dist/` is git-ignored. Gaps: M2 and m9.
- **`--experimental-vm-modules`:** sound and portable (no `NODE_OPTIONS` or cross-env needed). Jest workers inherit the flag through `execArgv`. Gap: m3.
- **`@platform/source` leak into production:** none. The condition is listed first but is not a Node or Vite default condition, so at runtime Node skips it (and `types`) and falls through to `default` → `dist/index.js`. It is active only in tsc (`customConditions`) and Jest. Dev runners must opt in (`--conditions`, Vite `resolve.conditions`), as documented for TASK-004/006.
- **Coverage exclusion hiding code:** the barrel exclusion hides nothing today (m4). The `src`-only glob hides future frontend and prisma code (M1).
- **`<layer>/` or `<layer>.ts`:** a reasonable way to reconcile ADR-0003 with ARCHITECTURE.md, but it needs the `tests` folder carve-out and ADR wording (m5).
- **Test quality:** AT-US-001-01/02 are good: pure core, real-FS probe, fixture and CLI, both polarities. SEC-TC-45 is excellent: a packed tarball, the committed `.npmrc`, isolation from `npm_config_*` and user config, and a positive control. Weak spots: M2, m2, n2.
- **Spike removal:** confirmed (§1).
- **Portability:** confirmed. `process.execPath` is used without shells or `.cmd` shims, paths use POSIX separators with `join(...split('/'))`, files are LF, and the scripts are free of OS-specific syntax.
- **Scope:** the dependency breadth is not scope creep (PLAN §5 rule 3 tells TASK-001 to install the full baseline). The baseline ESLint/Prettier configs, `infra/README.md` and the extra `tools/` helpers are outside the spec's file list but declared in the PR and needed for the gates and the structure AC. TASK-002 owns and replaces the lint files, and batch 0.1 has no lock conflict.

## 3. GOOD (patterns worth keeping)

- `FsProbe` keeps the structure rules pure and testable against the real tree and against fixtures. The CLI is a thin shell over it.
- The SEC-TC-45 harness: a packed fixture, a hermetic `file:` install, the committed `.npmrc` copied in, `npm_config_*` stripped, an empty user config, and a positive control that proves the marker mechanism works.
- `npm exec --no` instead of `npx` (no silent downloads). Playwright browsers are opt-in and allow-listed, and unknown engines are rejected.
- `toolchain.test.ts` turns the ADR-0001 pin policy into executable checks (exact pins, Prisma lockstep, no pre-releases, private/UNLICENSED).
- The lifecycle-hook detector has its own control test, and it catches `pre<x>`/`post<x>` hooks that `ignore-scripts` would silently skip.
- SPK-01.md is exemplary: measured timings, a reasoned deviation for each change, findings routed to named owners, and honest "not installed" and "open" lists.

## 4. SECURITY-FLAGS (for security-analyst)

1. **`@prisma/engines` postinstall skipped (m6):** check that `prisma migrate` does not fetch an unverified binary at run time in CI or the migrate image, or allow-list and pin the fetch.
2. **`rebuild.mjs` silent no-op through a symlink or junction path (m1):** an install-path control that can be bypassed with exit 0.
3. **`npm rebuild bcrypt --ignore-scripts=false` fallback:** confirm that its scope is only bcrypt's own install script.
4. **`@scarf/scarf` (via `swagger-ui-dist`):** a telemetry postinstall, neutralised by `ignore-scripts`. Consider `SCARF_ANALYTICS=false` in images as defence in depth.
5. Already raised in the PR: F-SEC-1 (`@react-router/dev` runs its own `npm install isbot`), F-14 (`devOptional` packages and the EPL-2.0 `elkjs` in runtime images), F-09 (5 moderate advisories in the production closure).

## 5. DoD checklist (CLAUDE.md §8, task level; TASK-001 DoD notes)

| Item | Status |
|---|---|
| Linked AC satisfied and demonstrated by tests | **Partial.** AT-US-001-01/02 pass. AT-US-001-04: the scripts exist and the mechanism is shown, but "any workspace" is not tied to the real solution (M2). SEC-TC-45 local part passes (m2 weakens the `deps:rebuild` half). AT-US-001-03/05 belong to TASK-002. |
| Lint, format, type checks pass; no new warnings | Pass (reviewer re-ran) |
| Unit tests for new logic; integration tests for new boundaries; coverage not reduced | Pass for the tooling logic. The coverage gate is mis-scoped for future code (M1). |
| code-reviewer APPROVED | **No.** CHANGES_REQUESTED (M1, M2) |
| security-analyst: no Critical/High | Pending (security-path task; hosted `security-integration` job not yet available, per the D-ORCH-004 bootstrap rule) |
| Public interfaces documented; ADR written for significant decisions | Partial. Decisions are documented in SPK-01 §2; the ADR amendments are requested but not ratified (m7). |
| traceability.md and STATUS.md updated | Out of scope by design (orchestrator) |
| No secrets or credentials | Pass (none found; the spike used `SPIKE_DATABASE_URL` from the environment) |
| `--ignore-scripts` installs | Pass (`.npmrc`, SEC-TC-45) |
| Digest-pinned images; hadolint/actionlint clean | N/A (no Dockerfiles or workflows; the PG 18 digest is recorded in SPK-01) |
| Spike code removed before merge; findings with GO/FALLBACK | Pass (GO; spike code removed; requires squash merge per PLAN §7.8) |
| Timebox | Not assessed by the reviewer |

## 6. To reach APPROVED

Fix M1 and M2. The reviewer recommends also fixing m1 and m2 in the same cycle (both small, both on the install path). m3–m9 and the NITs can be fixed now or turned into tracked conditions on their owner tasks (TASK-002, 003, 004, 014, 015, principal-architect), recorded in STATUS.md.

## Round 2 (head 4ec1bc4)

| Field | Value |
|---|---|
| Head | `4ec1bc4` (3 commits over `76b69c0`: `36d2310` deps/.npmrc, `d5f707c` rebuild entry guard + tests, `4ec1bc4` coverage/typecheck guards) |
| Reviewer | code-reviewer (independent), 2026-11-12 |
| Scope | `git diff 76b69c0..4ec1bc4` (12 files) plus the code it touches: `rebuild.mjs` and `jest.config.ts` in full, `workspaces.ts`, every workspace `tsconfig.json`, the `@jest/transform` and `jest-util` matcher source, and the lockfile |

```
VERDICT: APPROVED
SUMMARY: Both MAJORs are fixed, and their guard tests fail on the original defects (reproduced by mutation).
         m1, m2, m3, n4 and n6 are fixed and verified. m7 has landed on main (D-ARCH-035..039), and the other
         deferrals have named owners in the PR body. One new MINOR (a blind spot in the coverage-scope guard)
         and five NITs remain. None blocks the merge; they are routed below.
```

### R2.1 Verification performed by the reviewer

All commands ran in the worktree under `export PATH="$APPDATA/fnm/aliases/default:$PATH"`: Node v24.22.3, npm 11.19.1. Mutation experiments ran in a scratch copy of `4ec1bc4` (`git archive` plus a junctioned `node_modules`). The copy was removed afterwards. The worktree's `node_modules` was intact (693 entries) and `git status --porcelain` was clean.

| Check | Result |
|---|---|
| `npm run lint` / `format:check` | exit 0 / exit 0 |
| `npm run typecheck` and `tsc -b --force` | exit 0 / exit 0 |
| `npm run test:unit` | 6 suites, **77/77 passed** (matches the PR) |
| `npm run test:coverage` | exit 0, 77/77; summary 0/0 (no product source yet, as the PR states) |
| `npm run build` | exit 0 |
| `npm run deps:rebuild` (real run) | bcrypt skip, prisma skip, playwright skip; exit 0 |
| `npm ls --all` | exit 0; `jest-util` is a single deduped copy (30.5.1) shared with Jest |
| `npm audit` / `--omit=dev` | 0 critical, 0 high, 34 moderate, 1 low / **0 vulnerabilities** (matches the PR) |
| Lockfile vs `76b69c0` | 1,559 entries. **0 new** `resolved`+`integrity` tuples. Apart from links and `inBundle` entries, every entry resolves from `registry.npmjs.org` with sha512. No `gcp-metadata`, `gaxios` or `auto-instrumentations` entries. All 15 `@platform/*` entries are `{resolved: <workspace dir>, link: true}`. |
| `npm config get @platform:registry` | `https://registry.invalid/` |
| **M1 mutation:** old `src`-only glob restored | coverage-scope: **3 failed** (`apps/admin/app`, `apps/web/app`, `prisma/seed`) |
| **M1 live check:** untested `apps/web/app/routes/home.ts`, `prisma/seed/run.ts` and `apps/api/src/modules/quotes/tests/builder.ts` added | `jest --coverage` lists `home.ts` and `run.ts` at 0 %, excludes the `tests/` builder and fails the 85/75 threshold: **exit 1** |
| **M2 mutation:** `{ "path": "apps/web" }` removed / duplicated in the root `tsconfig.json` | root-scripts: **1 failed** in each case |
| **M2 mutation:** new workspace `packages/newpkg` (include `lib`) with no reference | root-scripts + coverage-scope: **2 failed** (missing reference; `packages/newpkg/lib` not measured) |
| **m1 mutation:** old `resolve(argv[1]) === fileURLToPath(...)` guard restored | ignore-scripts: **1 failed** (the junction test) |
| **m1 fail-closed:** `rebuild.mjs` under system Node v20.20.2 (no `import.meta.main`) | exit 1 with `Error: deps:rebuild needs Node >= 24.2 (import.meta.main)`. No silent no-op. |
| **m3 mutation:** jest-esm suite run without `--experimental-vm-modules` | the suite fails: `Must use import to load ES Module … jose` |
| **n6:** `--listTests` per project with `a.int.test.tsx`, `b.api.test.tsx`, `c.test.tsx`, `d.int.test.ts` | unit: `c` only; integration: `a`, `d`; api: `b` |
| `@jest/transform` source check | `shouldInstrument` applies `globsToMatcher(collectCoverageFrom)` to the rootDir-relative, `/`-separated path. coverage-scope.test.ts calls it the same way. |

### R2.2 Status of round-1 findings

| ID | Sev | Status | Evidence / note |
|---|---|---|---|
| M1 | MAJOR | **Fixed** | `jest.config.ts:37-49` covers `{apps,packages}/*/{src,app}` and `prisma/seed`, and excludes `tests`, `fixtures`, `.react-router` and `prisma/generated`. `coverage-scope.test.ts` derives the roots from each tsconfig `include` and checks them with Jest's own matcher. The mutation and live checks above confirm it. One blind spot remains: R2-m1. |
| M2 | MAJOR | **Fixed** | `root-scripts.test.ts:93-134` checks that (a) every workspace has a tsconfig, (b) the references are exactly the workspaces plus `tools`, with no duplicates, (c) the root compiles nothing itself, and (d) no referenced project is empty. All three mutations above fail as intended. |
| m1 | MINOR | **Fixed** | `rebuild.mjs:128-133` uses `import.meta.main` and throws when it is missing. The junction test fails against the old guard. Fail-closed confirmed on a real Node 20. See R2-n1 for the `engines` floor. |
| m2 | MINOR | **Fixed** | `ignore-scripts.test.ts:167-178` runs the script for real, with `DEPS_REBUILD_PLAYWRIGHT` stripped, and asserts exit 0 plus the ordered `id: action` lines. This exercises `main()`, the step loop and the final bcrypt check. The failing-probe (`return 1`) path is still untested; round 1 marked it optional. |
| m3 | MINOR | **Fixed** | `tools/repo/jest-esm.test.ts` asserts the script flag, generates a `uuid` v7 and round-trips a `jose` HS256 token with a random per-run key (no committed secret material). Mutation confirmed. |
| m4 | MINOR | Tracked | PR Follow-ups: TASK-002 (lint rule) / TASK-015 (coverage gates). |
| m5 | MINOR | Tracked | principal-architect (ADR-0003 amendment, in flight), then the structure-checker rule for the `tests` folder. |
| m6 | MINOR | Tracked | TASK-003 + security-analyst, merged with PR1-SEC-02. Includes `prisma migrate deploy` with no unverified download. |
| m7 | MINOR | **Resolved on main** | `e74399a` (D-ARCH-035..039) marks ADR-0002 §2/§6 as superseded by `tsc -b`, npm ≥ 11.10 and `npm exec --no`. The ADR-0003 file-or-folder wording is still pending under m5. |
| m8 | MINOR | Tracked | TASK-004. |
| m9 | MINOR | Tracked | TASK-014. D-ARCH-038 also requires stripping `**/*.test.*` from the runtime `dist/`. |
| n1, n2, n3, n5 | NIT | Tracked | TASK-002. n5 is also covered by principal-architect A-2, ratified in D-ARCH-036. |
| n4 | NIT | **Fixed** | `tools/deps/npm-cli.mjs` (loader-free, `node:` builtins only) is shared by `rebuild.mjs` and `test-support/process.ts`. The duplicate is gone. |
| n6 | NIT | **Fixed** | `jest.config.ts:62,67,72`; see the `--listTests` check above. |

The changes outside the round-1 findings (the `.npmrc` `@platform` pin and the OTel meta-package removal) implement security-analyst's PR1-SEC-01/-07 recommendations (the TASK-001 row of the security review), so they are not scope creep. `git grep` finds no importer of the removed package in code, and TASK-214 owns the explicit instrumentations.

### R2.3 Judgements requested by the orchestrator

- **`jest-util` 30.5.1 as a direct devDependency:** acceptable. It is MIT-licensed, part of the Jest monorepo and already in the tree (deduped, 0 new lockfile tuples, past the 7-day cooldown). The PR body justifies it per CLAUDE.md §9. It is the right choice over `path.matchesGlob`: `@jest/transform` calls this exact function with the same path shape, so the guard can't disagree with Jest on `{a,b}` braces, `dot: true` or negation. The remaining risk is that the exact pin is not tied to Jest's version (R2-n2).
- **`import.meta.main` fail-closed:** correct, and better than `realpathSync(argv[1])`. Node resolves the entry module through its real path, so `import.meta.main` holds for junction, symlink, 8.3 and drive-letter-case invocations. Importing the module for `plan()` does not run `main()`. A Node without the property throws at load time with an actionable message and exit 1 (verified on v20.20.2), so the install path can no longer report a silent green. `engine-strict` with `engines.node >=24` already stops Node 20/22 at install. The only gap left is Node 24.0–24.1 (R2-n1), where the script fails loudly, which is the safe direction.

### R2.4 New findings (round 2)

| ID | Severity | file:line | Issue | Required fix / owner |
|---|---|---|---|---|
| R2-m1 | MINOR | `tools/repo/coverage-scope.test.ts:43-50, 56-60` | The guard drops every `include` entry that contains glob characters. A workspace whose `include` holds only globs (e.g. `["lib/**/*.ts"]`) yields **zero** source roots and falls out of the drift check. Reproduced: a new `packages/newpkg` with `include: ["lib/**/*.ts"]` keeps coverage-scope green at 28/28 while `packages/newpkg/lib/**` sits outside `collectCoverageFrom`. With `include: ["lib"]` the guard catches it. The hard-coded `arrayContaining` list names only 6 of the 11 non-test workspaces and leaves out the 95 % paths `packages/audit` and `packages/authz`. Every include today is a plain directory, so nothing is unmeasured now. | Assert that every non-test workspace yields at least one source root, or derive the static prefix of a glob include (`lib/**/*.ts` → `lib`) instead of dropping it. About 3 lines. Fix in this PR if convenient; otherwise a tracked condition on **TASK-015** (coverage gates). |
| R2-n1 | NIT | `package.json:9` | `engines.node` `>=24 <25` admits 24.0–24.1, where `deps:rebuild` now throws. `engine-strict` could reject those versions at install instead. | Use `>=24.2 <25`, or record the floor in ADR-0001's pin note. Owner: TASK-002 or the next toolchain change. |
| R2-n2 | NIT | `package.json:57` | `jest-util` is pinned exactly at 30.5.1, separately from `jest` 30.5.2. If a Jest bump moves its internal `jest-util` and the root pin stays behind, npm installs two copies, and the scope guard then uses a different matcher from Jest's. | Add a `toolchain.test.ts` assertion that the root `jest-util` version equals the one resolved from `@jest/transform` (`createRequire(require.resolve('@jest/transform'))`). Owner: TASK-015. |
| R2-n3 | NIT | PR #1 body, "Acceptance" table | The counts are stale: AT-US-001-04 says "12 pass" (now 16) and SEC-TC-45 says "8 pass" (now 12). `coverage-scope` and `jest-esm` are not listed. The squash-merge message is taken from this body. | Refresh the table before the squash merge. Owner: senior-developer. |
| R2-n4 | NIT (outside this PR) | `docs/sdlc/DECISIONS.md:918` (PR1-SEC pin decision, item 2) | The decision says `check-lockfile` accepts `@platform/*` link entries "without `resolved`/`integrity`". In npm lockfile v3, link entries always carry `resolved: "<workspace dir>"` (all 15 here do), so a TASK-007 check written from this text would reject every one of them. The PR's own test (`link: true` and `resolved` is a workspace directory) is the correct rule. | Reword to "`link: true` whose `resolved` is a workspace directory, no `integrity`". Owner: principal-architect / TASK-007. |
| R2-n5 | NIT | `tools/deps/ignore-scripts.test.ts:167-178` | Once TASK-003 adds `prisma.config.ts` or `prisma/schema`, the real-run test makes the unit suite run `prisma generate` (slow, and it writes `prisma/generated`). On a platform without a bcrypt prebuild it would run `npm rebuild bcrypt` inside a unit test. Both behaviours are correct but heavy for a unit lane. | TASK-003: keep the real run but confirm its duration fits the lane A budget, or move it to `quality:heavy`. Watchlist item. |

### R2.5 GOOD (round 2)

- Every fix has a guard test, and the PR body names the mutation that proves each one. The reviewer reproduced all of them. Use this as the template for later fix cycles.
- coverage-scope.test.ts reuses Jest's own `globsToMatcher` rather than a similar glob engine, and it checks both directions: unmeasured roots and stale include globs.
- `npm-cli.mjs` gives the install-time script and the tests one shared helper, with no dependency on a TS loader at install time.
- The lockfile was regenerated under the committed `.npmrc` cooldown with 0 new tuples, and provenance and audit evidence back it.

### R2.6 SECURITY-FLAGS (for security-analyst, round 2)

1. The `.npmrc` line `@platform:registry=https://registry.invalid/` is present and asserted. The out-of-graph negative fixture from item 4 of the PR1-SEC decision (`@platform/shared@0.0.0` → `ENOTFOUND`) is **not** in this PR. Confirm whether it belongs here or in TASK-007.
2. R2-n4: the `check-lockfile` wording for link entries needs correcting before TASK-007 implements it.
3. m1 is closed: `deps:rebuild` can no longer be bypassed with exit 0 through a link path, and it fails closed on an old Node.

### R2.7 DoD checklist delta

| Item | Round 2 status |
|---|---|
| Linked AC satisfied and demonstrated by tests | **Pass** for TASK-001's share. AT-US-001-04 is now tied to the real solution file (M2). The local part of SEC-TC-45 covers the real `deps:rebuild` run (m2). AT-US-001-03/05 belong to TASK-002. |
| Lint, format, type checks; no new warnings | Pass (re-run) |
| Unit tests for new logic; coverage not reduced | Pass. The coverage gate now spans every current source root (M1). |
| code-reviewer APPROVED | **Yes**: APPROVED at `4ec1bc4` (0 BLOCKER, 0 MAJOR open). |
| security-analyst: no Critical/High | Pending security-analyst round 2 |
| Public interfaces / ADRs | Pass. The SPK-01 amendments are ratified on main (D-ARCH-035..039). The ADR-0003 wording is pending (m5, tracked). |
| traceability.md / STATUS.md | Orchestrator: record the tracked items (m4–m6, m8, m9, n1–n3, n5, R2-m1, R2-n1..n5) against their owner tasks. |
