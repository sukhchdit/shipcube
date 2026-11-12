# PR-0001 / TASK-001: change-scoped security review

| Field | Value |
|---|---|
| PR | #1 `feat(repo): SPK-01 toolchain spike and workspace foundation (TASK-001, US-001)`, https://github.com/sukhchdit/shipcube/pull/1 |
| Branch / head | `feat/TASK-001-spk-01-toolchain-spike-workspace` @ `76b69c0`; base `main` @ `1ba1b00`; 6 commits; 192 files, +1,803 |
| Scope | P5 Wave 0, batch 0.1. Workspace foundation, `.npmrc`, `tools/deps/rebuild.mjs` and its tests, the SEC-TC-45 fixture, root scripts, `package-lock.json` (1,603 package entries), SPK-01 findings F-SEC-1, F-09, F-14 and F-15 |
| Security requirements in scope | SEC-COND-04 / SEC-P3-04 (local part), SEC-P3-31 item 2 (`npm exec --no`), SEC-TC-45 (local part), SEC-TC-64 (the `deps:rebuild` part) |
| Reviewer / date | security-analyst, 2026-11-12. Read-only on the branch. Commands ran in the worktree under the CLAUDE.md §2 PATH prefix: Node 24.22.3, npm 11.19.1 |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open for this change. 4 MEDIUM: all latent at `76b69c0`, all routed to named tasks as binding requirements. One of them (PR1-SEC-01) is a one-line `.npmrc` fix, verified in a scratch copy, and should land in this PR. Also 3 LOW and 4 INFO. |

## 1. Summary

The supply-chain foundation does what SEC-P3-04 asks of the local part:
- `.npmrc` disables lifecycle scripts, enforces engines and exact saves, and sets the 7-day `min-release-age`. npm 11.19.1 recognises all of these keys.
- No workspace declares a lifecycle hook.
- `deps:rebuild` is a closed allow-list (bcrypt, Prisma generate, opt-in Playwright browsers). It runs binaries through `npm exec --no`, never through a shell.
- The SEC-TC-45 marker test proves `npm ci` with the committed `.npmrc` skips a `postinstall`, while a control run shows the fixture works.
- The lockfile is clean on provenance, cooldown and High/Critical advisories.

None of the findings below is exploitable at this commit. They are design gaps that TASK-003, TASK-004, TASK-007 and TASK-014 would otherwise inherit:
- the third-party-owned `@platform` npm scope;
- the Prisma schema-engine download that `prisma generate` triggers;
- the React Router `isbot` auto-install;
- `devOptional` leakage into runtime images.

Three dependency-policy items will trip TASK-007's lane A gates unless they are decided first: `elkjs` EPL-2.0, `bcrypt` crossing 18 months, and deprecated transitives in the production closure.

## 2. Method

- **Diff and code review:** `git diff main...HEAD` covered every non-`.gitkeep` file. Manual sink review of `tools/deps/rebuild.mjs`, `tools/test-support/process.ts` and `tools/repo/*.ts` found:
  - no `shell: true`;
  - no string-built commands;
  - no untrusted input reaching a sink;
  - probes run as fixed `node -e` strings;
  - Playwright browser names are validated against a fixed set.
- **SAST:** Semgrep is not installed on the host, so no Semgrep run was made. The PR adds about 450 lines of executable tooling, which was reviewed manually. Lane A Semgrep arrives with TASK-007.
- **Secrets:** gitleaks ran via the `zricethezav/gitleaks` container with `--redact`, with the repository mounted read-only.
- **Supply chain:**
  - `npm audit` (full and `--omit=dev`) and `npm audit signatures`;
  - a licence scan of every lockfile entry, using an in-house Node script that falls back to the installed `package.json` for legacy `licenses` arrays and evaluates SPDX case-insensitively;
  - a release-age sweep of all 1,597 registry entries against the lockfile commit time `2026-11-12T10:28:08Z` (dependency-auditor; partial run, results used where complete);
  - a provenance check;
  - an 18-month maintenance check of the 89 direct dependencies.
- **Empirical checks in a scratch copy of the manifests and lockfile** (outside the repository):
  - `npm ci --omit=dev` compared with `npm ci --omit=dev --omit=optional` (F-14);
  - a scoped-registry pin for `@platform` (PR1-SEC-01);
  - `prisma generate` with no engine cache and the engine mirror pointed at an unresolvable host (PR1-SEC-02).
- **Tests:** the unit project (38/38) and the `ignore-scripts` suite (8/8) were run independently at the PR head.
- **In-flight architecture edits:** the main working tree holds **uncommitted** principal-architect amendments made in response to SPK-01: ADR-0002, 0017, 0022, 0023 am. I, 0024, 0025, 0026 am. 10–12, and `platform.md`. This review checks the findings against them (§7) but does not rely on them. D-ARCH-003 rev 3 and D-ARCH-035..039 are referenced there but were **not yet in `docs/sdlc/DECISIONS.md`** at review time.

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR1-SEC-01 | Workspace packages use the public npm scope `@platform`, which a third party owns; there is no scoped-registry pin (dependency confusion) | MEDIUM | CWE-427, CWE-1357 | A08 | `.npmrc:1-12`; 16 manifests (`"name": "@platform/*"`, deps `"@platform/shared": "0.0.0"` …); ADR-0002 §2 | senior-developer in **this PR** (recommended); otherwise TASK-007 before TASK-014 starts; principal-architect (ADR-0002 / ADR-0023 am. I wording) | Open (latent) |
| PR1-SEC-02 | `prisma generate` (via `deps:rebuild`) and every `migrate`/`db` command download the native schema engine outside lockfile integrity; on developer hosts it is reused from a cross-project cache | MEDIUM | CWE-494, CWE-829 | A08 | `tools/deps/rebuild.mjs:88-93`; `node_modules/prisma/build/cli.js` (`ensureBinaries = ["version","init","migrate","db","generate","validate","format","telemetry"]`); `@prisma/engines/dist/index.js` `ensureNeededBinariesExist` | principal-architect (ADR-0023 am. F/I allow-list wording); TASK-003 (implementation); TASK-007; TASK-014 | Open (latent; activates when TASK-003 adds a schema) |
| PR1-SEC-03 | F-SEC-1: `@react-router/dev` runs `npm install` through `execSync` to add `isbot` when an app has no custom `entry.server` | MEDIUM | CWE-829, CWE-494 | A08 | `node_modules/@react-router/dev/dist/typegen-CqlAVM2O.js:445-472` (`resolveEntryFiles`) | TASK-004, TASK-007, TASK-014 | Open (latent; not reachable at `76b69c0`) |
| PR1-SEC-04 | F-14: `npm ci --omit=dev` keeps `devOptional` packages (Prisma CLI, Studio, `elkjs` EPL-2.0, `typescript`, `@visx/*` alphas, `mysql2`, PGlite) in runtime images | MEDIUM | CWE-489, CWE-1357 | A05 | ADR-0023 am. F item 1 (`prod-deps` stage text); lockfile `devOptional` flags (123 entries) | TASK-014 | Open (latent) |
| PR1-SEC-05 | `elkjs` 0.11.1 (`EPL-2.0`) is in the dev closure through `prisma` → `@prisma/studio-core`. This is outside D-ARCH-003 rev 2 items 2 and 4 | LOW | n/a (licence policy) | n/a | `package-lock.json` `node_modules/elkjs` | principal-architect (D-ARCH-003 rev 3, exact SPDX); TASK-007 (`licence-check`) | Open |
| PR1-SEC-06 | `bcrypt` 6.0.0 (direct, named by the brief) crossed the 18-month maintenance limit on 2026-11-11T18:06Z | LOW | CWE-1104 | A06 | `apps/api/package.json` `"bcrypt": "^6.0.0"` | principal-architect (exception or substitution); TASK-007 (freshness gate); TASK-049 | Open |
| PR1-SEC-07 | F-09: production closure carries unreachable moderate advisories and deprecated transitives (`glob` 10.5.0, `minimatch` 9.0.9, `node-domexception` 1.0.0 via the GCP resource detector; `node-abort-controller` 3.1.1 via BullMQ) | LOW | CWE-1104, CWE-1395 | A06 | `apps/api/package.json:20` `@opentelemetry/auto-instrumentations-node`; `bullmq` 6.7.0 | senior-developer (drop the meta-package now, optional) / TASK-214; principal-architect (BullMQ polyfill ruling); TASK-007 | Open |
| PR1-SEC-08 | Third-party telemetry: Prisma CLI checkpoint (`checkpoint.prisma.io`), and `@scarf/scarf` in the production closure (its beacon is suppressed by `ignore-scripts`) | INFO | n/a | n/a | `node_modules/prisma/build/cli.js` (`CHECKPOINT_DISABLE`); `swagger-ui-dist` → `@scarf/scarf` 1.4.0 | TASK-003, TASK-007, TASK-014 | Open |
| PR1-SEC-09 | `deps:rebuild` / SEC-TC-45 hardening nits | INFO | n/a | n/a | `tools/deps/rebuild.mjs:28-39, 83`; `tools/deps/ignore-scripts.test.ts:35-47, 112-115` | senior-developer (optional) / TASK-007 | Open |
| PR1-SEC-10 | Licence metadata gaps: `png-js` 2.0.0 (production) has no licence field (its LICENSE file is MIT); `caniuse-lite` CC-BY-4.0 needs `THIRD_PARTY_NOTICES.md` attribution (the file does not exist yet) | INFO | n/a | n/a | lockfile `node_modules/png-js`, `node_modules/caniuse-lite` | TASK-007 | Open (covered by in-flight ADR-0023 am. I item 7) |
| PR1-SEC-11 | 17 pre-existing gitleaks `generic-api-key` hits in OpenAPI example values and agent docs, outside this PR's diff | INFO | n/a | n/a | `docs/03-architecture/api/openapi.yaml` (15), `.claude/agents/security-analyst.md:22`, `claude-code-sdlc-agent-team.md:975` | TASK-007 (`.gitleaks.toml`); api-designer (example-value convention) | Open (not introduced here) |

### PR1-SEC-01: third-party-owned `@platform` npm scope, no registry pin (MEDIUM)

**Description.** ADR-0002 §2 and this PR name every workspace `@platform/<x>`, and internal dependencies are pinned as `"@platform/shared": "0.0.0"`.

The `@platform` scope on the public npm registry is an existing third-party organisation:
- `GET https://registry.npmjs.org/-/org/platform/package` returns 200 and lists 131 public packages (`@platform/ui.*`, `@platform/cli`, …);
- the same request for a non-existent scope returns 404 "Scope not found".

None of our 16 names is published today (the packuments return 404). The scope owner, or anyone who takes over that account, can publish `@platform/shared@0.0.0` at any time.

`npm ci` from the workspace root is safe, because the lockfile records workspace entries as `link: true`. But any install that resolves a workspace name from the registry would fetch the third party's code. Examples:
- a per-app Docker stage that copies only `apps/api/package.json`;
- an `npm install` in a directory outside the workspace graph (the F-SEC-1 mechanism);
- a regenerated lockfile with a broken workspace link.

That code would then be imported at runtime by the API and the worker. `ignore-scripts` does not help, because the payload is the module itself.

Scratch evidence: a copy of `packages/audit/package.json` installed outside the root fails with `E404 … GET https://registry.npmjs.org/@platform%2fshared`. It is a public-registry lookup that is "safe" only because nothing has been published yet.

**Exploitability and impact.** It needs two independent preconditions: a build path that resolves workspace names from the registry (none exists at `76b69c0`), and a malicious publish into a scope we do not control. Impact is C: code execution in the production API/worker with database and payment credentials. C×L = HIGH, adjusted one step for Hard exploitability: **MEDIUM**.

**Remediation (code level).**

1. Add one line to `.npmrc`. `.invalid` is reserved (RFC 6761) and never resolves, so any registry resolution of `@platform/*` fails closed.
   ```ini
   # Workspace packages are never fetched from a registry; `@platform` on npmjs.com belongs to a third party.
   @platform:registry=https://registry.invalid/
   ```
   Verified in a scratch copy with this line:
   - `npm ci --ignore-scripts` installs 1,505 packages and exits 0;
   - `npm ls --all` exits 0;
   - `npm audit` counts are unchanged (0/0/37/1);
   - an out-of-workspace install fails with `ENOTFOUND registry.invalid` instead of querying npmjs.com.
2. Extend the SEC-TC-45 `.npmrc` assertion (`tools/deps/ignore-scripts.test.ts:57-69`) to require `'@platform:registry': 'https://registry.invalid/'`.
3. Add a unit test, and later the TASK-007 `check-lockfile` rule: every lockfile key that resolves to `@platform/*` is either a workspace folder entry or `node_modules/@platform/*` with `link: true`, and no such entry has a `resolved` URL.
4. principal-architect adds the line to ADR-0023 am. I item 1, which currently lists `.npmrc` "in full", and notes the scope ownership in ADR-0002 §2. A rename does not help unless we own the new scope on npm, and registering one is an external action; the pin is the control.

**Verification test.** `[SEC-TC-45] .npmrc pins the @platform scope to an unresolvable registry` plus `[SEC-TC-45] lockfile workspace entries are links only`. Negative fixture: a temporary project whose `package.json` depends on `@platform/shared@0.0.0`, installed with the committed `.npmrc` → npm exits non-zero with `ENOTFOUND registry.invalid`.

### PR1-SEC-02: Prisma schema engine fetched outside lockfile integrity (MEDIUM, latent)

**Description.** With `ignore-scripts=true`, `@prisma/engines`' `postinstall` (which downloads the native `schema-engine`) never runs. The Prisma CLI compensates at run time: `ensureNeededBinariesExist()` runs before `version`, `init`, `migrate`, `db`, `generate`, `validate`, `format` and `telemetry`.

It downloads `schema-engine` (about 20 MB, native) for engines hash `d1b3f377ca835d73fd50954a5e22128b9ebdd6b8` from `binaries.prisma.sh`, or from `PRISMA_ENGINES_MIRROR` when set. It checks a SHA-256 fetched **from the same origin**, and that check is skippable with `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`.

The binary then sits in `node_modules/@prisma/engines/` and is executed by `migrate`/`db` commands. In the migrate job, those commands hold migrator credentials.

Evidence in a scratch copy:
- With an empty `APPDATA` and `PRISMA_ENGINES_MIRROR=https://engines.invalid`, `prisma generate` exits 1: "request to https://engines.invalid/all_commits/d1b3f377…/windows/schema-engine.exe.gz.sha256 failed".
- In the normal host environment it succeeds in 40 ms and writes `node_modules/@prisma/engines/schema-engine-windows.exe`, copied from `%APPDATA%\Prisma\master\d1b3f377…\windows\schema-engine`. That cache entry was created 2026-10-19 by another project.

So SPK-01's "`prisma generate` works with no install script" holds only because the host already had the engine cached. A clean CI runner or BuildKit stage downloads it. The lockfile, the 7-day cooldown, `npm audit signatures` and the planned `check-lockfile` cover none of these bytes. The engine *version* is pinned indirectly through `@prisma/engines-version`; the *content* is not.

`deps:rebuild`'s header ("Nothing else is ever executed") is accurate about execution, but the Prisma step implicitly widens the trust boundary.

**Exploitability and impact.** Exploitation needs a compromise of Prisma's engine CDN, or an attacker-controlled environment variable in CI or the image build. Impact is C: a malicious engine runs DDL as the database-owning migrator role, which threatens RLS and audit integrity (threat-model "C"). C×L, adjusted for Hard exploitability: **MEDIUM**. It is not reachable in this PR (no `prisma.config.ts` or `prisma/schema`, so the step is `skip`). It becomes reachable when TASK-003 merges.

**Remediation (code level, TASK-003 with principal-architect's allow-list wording).**
1. Commit `tools/deps/prisma-engines.json` = `{ "enginesVersion": "d1b3f377…", "schemaEngineSha256": { "debian-openssl-3.0.x": "<hex>", "linux-musl-openssl-3.0.x": "<hex>", "windows": "<hex>" } }`. Record the hashes once, from a fetch on a clean runner. security-analyst reviews the manifest change, and a change to `enginesVersion` without new hashes fails.
2. Add an explicit `prisma-engines` step to `deps:rebuild`, ahead of `prisma`:
   - run `npm exec --no -- prisma --version`, which triggers the download;
   - hash `node_modules/@prisma/engines/schema-engine-<target>[.exe]` and compare it with the manifest;
   - on mismatch, delete the file and exit 1.
3. `deps:rebuild` refuses to start when `PRISMA_ENGINES_MIRROR` or `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING` is set. It also refuses when `PRISMA_SCHEMA_ENGINE_BINARY` points outside `node_modules/@prisma/engines`. It passes `CHECKPOINT_DISABLE=1` to its children (PR1-SEC-08).
4. TASK-014:
   - the `migrate` image fetches and verifies the engine in a build stage, so the runtime stage needs no egress to `binaries.prisma.sh`;
   - `api`/`worker` images contain no `schema-engine*`, which the image invariant test checks; the client is engine-free.
5. TASK-007: `check-workflow-policy` rejects those variables in workflows, and CI caches that hold `node_modules/@prisma/engines` are keyed by `enginesVersion`.

**Verification test** (extend SEC-TC-64):
- (i) with one manifest hash altered, `deps:rebuild` exits 1 and leaves no `schema-engine*`;
- (ii) with `PRISMA_ENGINES_MIRROR` set, `deps:rebuild` refuses to run;
- (iii) with no engine cache and the mirror unreachable, `deps:rebuild` fails closed;
- (iv) image test: no `schema-engine*` in `api`/`worker`.

### PR1-SEC-03: F-SEC-1, React Router auto-installs `isbot` (MEDIUM, latent)

**Description.** Confirmed in `typegen-CqlAVM2O.js:445-472`. When `app/entry.server.*` is missing and the nearest `package.json` has no `dependencies.isbot`, `resolveEntryFiles()` does two things: it rewrites that `package.json` (`"isbot": "^5"`) and runs ``execSync(`${detectPackageManager() ?? "npm"} install`, { cwd: packageJsonDirectory })``. The command string comes from a fixed set, so there is no injection.

Inside the workspace graph, npm finds the root `.npmrc`, so scripts stay off and the cooldown applies. The install still re-resolves a caret range at build time and mutates `package.json` and `package-lock.json`.

Outside the graph, as in the spike's `spikes/SPK-01/web/package.json`, the install runs with only user/global config: lifecycle scripts on, no cooldown. That bypasses SEC-P3-04.

**Exploitability and impact.** Impact H: code execution on a developer host or CI runner with secrets. Likelihood L: it needs a missing custom entry, plus either a build outside the workspace graph or a compromised `isbot` release. `isbot` has no dependencies and no install script today. H×L = **MEDIUM**.

**Does it block this PR? No.** At `76b69c0`:
- `apps/web` and `apps/admin` have no `app/` directory, no `react-router.config.ts` and no `build` script;
- `npm run build --workspaces --if-present` skips them;
- the spike that triggered it has been deleted.

It is a **binding requirement on TASK-004 and TASK-007**, and on TASK-014 for image builds (§6).

**Remediation.** The in-flight ADR-0026 am. 10 and ADR-0023 am. I item 4 are adequate. security-analyst confirms them, with these additions:
- (a) the TASK-004 structure test asserts `app/entry.server.tsx` exists in every workspace that has a `react-router.config.ts`, **and** that no workspace manifest declares `isbot`;
- (b) the lane A post-build check is `git status --porcelain` with empty output required, which also catches untracked files such as a nested `package-lock.json`;
- (c) as defence in depth, CI jobs set `NPM_CONFIG_IGNORE_SCRIPTS: "true"` at job level, so even an out-of-graph nested install inherits it;
- (d) TASK-014 web/admin build stages run the build step with `NPM_CONFIG_OFFLINE=true` and compare `sha256sum` of `package.json` and `package-lock.json` before and after the build.

**Verification test.**
- Lane A negative fixture (ADR-0023 am. I item 4): a build script that touches `package.json` fails the lane.
- TASK-004: the structure test fails when `apps/web/app/entry.server.tsx` is deleted.

### PR1-SEC-04: F-14, `devOptional` packages leak into runtime images (MEDIUM, latent)

**Description and evidence.** Scratch installs of the committed lockfile and manifests:

| Command | Packages | Present |
|---|---|---|
| `npm ci --omit=dev --ignore-scripts` | 833 | `prisma`, `@prisma/studio-core`, `elkjs`, `@prisma/engines`, `@prisma/dev`, `typescript`, `@visx/*`, `mysql2`, `@electric-sql/pglite`, `bcrypt`, `@prisma/client`, `@prisma/adapter-pg`, `msgpackr-extract` (+ platform binaries), `pg-cloudflare` |
| `npm ci --omit=dev --omit=optional --ignore-scripts` | 705 | `bcrypt` (loads; `compareSync` true), `@prisma/client`, `@prisma/adapter-pg`, `msgpackr` (pure-JS path works). All `devOptional` tooling and `elkjs` are gone. |

**Exploitability and impact.** Impact M:
- DDL tooling and the Studio server sit inside internet-facing service images, which widens what an attacker with code execution can use (least functionality);
- an EPL-2.0 component and pre-release packages are shipped, breaking D-ARCH-003 rev 2 items 1 and 5.

Likelihood H if TASK-014 follows the original ADR-0023 am. F text (`--omit=dev`). M×H = **MEDIUM**.

**Binding on TASK-014: yes.** The in-flight ADR-0022 am. 11–13 and ADR-0023 am. I item 2 match this review. security-analyst confirms them, with three notes:
- (a) `prisma generate` must run in the build stage, because the CLI is absent from runtime stages; the generated client is compiled into `dist/`.
- (b) For the Studio-free `migrate` image, `prisma/build/cli.js` contains module-level `require("@prisma/studio-core/data/bff")` (and `data/mysql2`, `data/node-sqlite`). Deleting `@prisma/studio-core` is therefore likely to break CLI start-up. Plan on the stub fallback, or prune only `elkjs` and `@visx/*`. Either way, the image test must prove that `prisma migrate deploy` and `prisma migrate status` work.
- (c) Dropping `msgpackr-extract` removes BullMQ's native msgpack acceleration. It is functionally neutral; performance-engineer may note it under TASK-214.

**Verification test.** Image tests assert the ADR-0022 am. 12 invariants:
- no `node_modules/prisma`, `@prisma/studio-core`, `elkjs`, `typescript` or `*-alpha.*` in `api`/`worker`;
- `dist/preflight.js` passes.

Trivy's licence scan is the backstop.

### PR1-SEC-05: `elkjs` EPL-2.0 in the dev closure (LOW)

`elkjs` 0.11.1 is reached only via `prisma` → `@prisma/studio-core`, flagged `devOptional`. Its `package.json` and lockfile say `EPL-2.0`. Its `LICENSE.md` is the EPL-2.0 text with an **unfilled** Exhibit A template, so no Secondary License applies.

The in-flight ADR-0023 am. I item 7 calls it `EPL-2.0 OR GPL-3.0-or-later`. That is not what the package declares; the decision should name `EPL-2.0` exactly.

D-ARCH-003 rev 2 item 2 (dev closure = allow-list + permissive equivalents + CC-BY data) does not admit it. Item 4 places copyleft outside the npm closure.

**Fix.** principal-architect writes D-ARCH-003 rev 3, which was referenced but not yet in DECISIONS.md at review time. Recommended text: admit `EPL-2.0` for `elkjs` **only** as a transitive of the pinned Prisma CLI, in the dev/build closure, unmodified and never distributed; it must be absent from every image (PR1-SEC-04). TASK-007 `licence-check` encodes this as a named exception (`elkjs` + parent chain), not as a licence-wide allowance.

**Verification:** TASK-007 licence check fixture — a different package declaring `EPL-2.0` fails.

### PR1-SEC-06: `bcrypt` 6.0.0 past the 18-month maintenance rule (LOW)

Registry `time`: `6.0.0` was published 2025-05-11T18:06:24Z, with no later release (`latest` = 6.0.0, `time.modified` 2026-03-28). On 2026-11-12 it is 18 months and 1 day old. CLAUDE.md §5 and D-ARCH-003 rev 2 item 6 make that gating for direct dependencies. SPK-01 (also dated 2026-11-12) did not flag it, because it crossed the line the day before. The brief §3 names `bcrypt`, so this is a fixed-stack versus policy conflict for principal-architect.

There are no known advisories. It is mature N-API code with prebuilds inside the package.

**Options:**
- (a) **Recommended:** a time-boxed exception in DECISIONS.md. Re-evaluate monthly. Switch on any advisory, a Node 26 ABI break, or 24 months without a release.
- (b) `bcryptjs` 3.0.3 (BSD-3-Clause, pure JS). This removes native code and the bcrypt branch of `deps:rebuild`. Cost-12 latency must be measured against the NFR-SEC/PERF budgets.
- (c) Not recommended: `@node-rs/bcrypt`. napi-rs ships its platform binaries as `optionalDependencies`, which the `--omit=optional` runtime install (PR1-SEC-04) would drop.

The decision is needed before TASK-007's freshness gate merges, or lane A fails on its own PR, and before TASK-049 (first bcrypt use).

### PR1-SEC-07: F-09, unreachable moderates and deprecated transitives in the production closure (LOW)

**Advisories.** `npm audit --omit=dev` reports 5 moderate entries from two advisories:
- GHSA-3g3m-2fjr-6pw4 (glob, CWE-400);
- GHSA-g3hv-75wg-m249 (minimatch, CWE-405).

Both come through `@opentelemetry/auto-instrumentations-node` 0.82.0 → `resource-detector-gcp` 0.59.0 → `gcp-metadata` 8.1.4 → `gaxios` 7.1.3 → `rimraf` 5.0.10 → `glob` 10.5.0 / `minimatch` 9.0.9.

**Reachability: none.** `gaxios`' shipped JavaScript never `require`s `rimraf` (grep of `node_modules/gaxios`), so the vulnerable code never loads.

**Fix availability.** `gcp-metadata` 8.1.4 pins `gaxios` **exactly** at 7.1.3, and `resource-detector-gcp` accepts only `gcp-metadata ^8`. So `npm audit`'s `fixAvailable: true` is misleading, and SPK-01's "no fix within the pinned majors" is correct.

**Deprecated transitives.** The same chain adds two deprecated versions: `glob` 10.5.0 and `node-domexception` 1.0.0 (via `node-fetch` 3). BullMQ 6.7.0 adds `node-abort-controller` 3.1.1 (deprecated polyfill). D-ARCH-003 rev 2 item 6 makes deprecated transitives gating.

**Side effect.** The GCP, Azure and Alibaba detectors also probe cloud metadata endpoints at start-up, which is unnecessary egress on AWS.

**Fix.**
- In-flight ADR-0017 am. item 2 (TASK-214: explicit instrumentations + AWS detector only) closes the GCP chain. TASK-007's gate lands much earlier, though, so remove `@opentelemetry/auto-instrumentations-node` from `apps/api/package.json` now. No code imports it; TASK-214 adds the specific packages. Do this in this PR (preferred) or in TASK-007's first lockfile change.
- `node-abort-controller` needs a principal-architect ruling: a recorded exception with expiry, because it is upstream BullMQ, deprecated only because Node has the global, and has no advisory.

**Verification.** After the removal, `npm audit --omit=dev` = 0 vulnerabilities and `npm ls gcp-metadata` is empty.

### PR1-SEC-08: third-party telemetry (INFO)

- The Prisma CLI's checkpoint client reports to `checkpoint.prisma.io` on CLI runs (local, CI, migrate job). It is disabled by `CHECKPOINT_DISABLE=1`.
- `@scarf/scarf` 1.4.0 (production, via `swagger-ui-dist`) is an install-time analytics beacon. `ignore-scripts` already suppresses it, and `SCARF_ANALYTICS=false` is the second layer.

These are minor data egress, but CLAUDE.md §5 limits external communication to the configured CI/CD and repository integrations.

**Fix:**
- `deps:rebuild` sets `CHECKPOINT_DISABLE=1` for its children (TASK-003);
- workflows set both variables at workflow level (TASK-007);
- images set them with `ENV` (TASK-014);
- the developer setup docs mention them.

### PR1-SEC-09: `deps:rebuild` / SEC-TC-45 nits (INFO)

1. `npmCli()` and `npmCliPath()` honour `npm_execpath` when it ends in `npm-cli.js` (`rebuild.mjs:29-30`, `process.ts:33-34`). This is acceptable: whoever controls the environment already controls `NODE_OPTIONS`.
2. The bcrypt fallback `npm rebuild bcrypt --ignore-scripts=false` runs `node-gyp-build`. That may fetch Node headers from nodejs.org and needs a compiler toolchain. In images it should be a build failure, not a fallback: TASK-014 runs preflight and there is no toolchain in runtime stages, so it fails closed. Document this.
3. The SEC-TC-45 fixture test isolates `npm_config_*` and the user config, but not the global config. If `$PREFIX/etc/npmrc` set `ignore-scripts=true`, the "ignored" case would pass regardless of the committed `.npmrc`. The static `.npmrc` assertion and the control case make the evidence adequate. Optional: set `npm_config_globalconfig` to an empty file.
4. The lifecycle detector omits `preshrinkwrap`, `shrinkwrap` and `postshrinkwrap`. They are run only by `npm shrinkwrap`, so this is negligible.

### PR1-SEC-10 and PR1-SEC-11 (INFO)

See the table. Both are covered by in-flight ADR-0023 am. I item 7 (licence overrides) and by TASK-007's `.gitleaks.toml`.

For the OpenAPI examples, prefer obviously fake values (for example `EXAMPLE_…`) over path-wide allow-listing, so a real secret pasted into the spec still fails.

## 4. Triage of the developer-reported items

| Item | Outcome |
|---|---|
| **(a) F-SEC-1** | **Confirmed** (code path quoted in PR1-SEC-03). **MEDIUM** (H×L). **Does not block this PR:** it is unreachable at `76b69c0`. **Binding on TASK-004** (custom `app/entry.server.tsx` in both apps, no `isbot`, structure test) **and TASK-007** (post-build `git status --porcelain` gate with a negative fixture; job-level `NPM_CONFIG_IGNORE_SCRIPTS`), **plus TASK-014** (offline, checksum-guarded web/admin build stages). In-flight ADR-0026 am. 10 and ADR-0023 am. I item 4 are confirmed adequate, with the additions in PR1-SEC-03. |
| **(b) F-14** | **Confirmed empirically** (833 vs 705 packages; table in PR1-SEC-04). **Binding on TASK-014: yes.** MEDIUM. `--omit=dev --omit=optional` is verified safe for `api`/`worker` (bcrypt and msgpackr work). The migrate image needs the stub or the narrower prune, because the CLI requires `@prisma/studio-core/data/*` at module level. |
| **(c) F-09** | **Confirmed:** 5 moderate entries from 2 advisories (glob, minimatch) in the production closure via the GCP detector chain, plus deprecated transitives. **Not reachable** (`gaxios` never loads `rimraf`). **LOW.** Fix: drop the meta-package now (no consumer yet); TASK-214 adds explicit instrumentations; BullMQ's `node-abort-controller` needs a recorded exception. |
| **(d) `npm audit`** | **Verified.** Full tree: **0 critical, 0 high**, 37 moderate, 1 low (38) across 1,633 dependencies. `--omit=dev`: 0 critical, 0 high, 5 moderate. Advisories: GHSA-3g3m-2fjr-6pw4 (glob, moderate), GHSA-g3hv-75wg-m249 (minimatch, moderate), GHSA-gcqx-w48m-w2h4 (deepmerge under Jest, low). The dev-only chains (Jest, ESLint, typescript-eslint, testcontainers → archiver) process trusted repository inputs only. `npm audit signatures`: **1,496 packages with verified registry signatures, 611 with verified attestations, 0 invalid or missing.** |
| **(e) Licence scan** | 1,603 lockfile entries (690 prod, 780 dev, 123 devOptional, 10 optional). Outside the allow-list + production equivalents there are only: **`elkjs` 0.11.1 `EPL-2.0`** (devOptional; violates D-ARCH-003 rev 2 → PR1-SEC-05); **`png-js` 2.0.0** (production, no licence field, LICENSE file MIT → override, PR1-SEC-10); **`caniuse-lite` CC-BY-4.0** (dev; allowed by rev 2 item 2 with attribution). Legacy `licenses` arrays (`ssh2`, `cpu-features`, `buildcheck`) resolve to MIT. `@visx/vendor` "MIT and ISC" passes under case-insensitive SPDX. No GPL, AGPL, LGPL, SSPL, BUSL or RSAL anywhere in the npm closure. Under the F-14 runtime install the production closure is fully compliant apart from the `png-js` metadata gap. |

Additional supply-chain results:
- **Cooldown:** 1,597 registry entries (1,212 names); **0 younger than 7 days** at `2026-11-12T10:28:08Z`. Thinnest margins: `undici` 8.12.4 (7.06 d), `@tanstack/query-core` / `@tanstack/react-query` 5.106.1 (7.10 d), `vite` 8.3.6 (7.20 d).
- **Provenance:** every one of the 1,597 registry entries resolves to `https://registry.npmjs.org/` with `sha512` integrity; 0 exceptions. 6 `inBundle` entries (inside `@tailwindcss/oxide-wasm32-wasi`), 15 workspace links.
- **Install scripts present and suppressed** (12): production — `bcrypt`, `@scarf/scarf`, `protobufjs`; devOptional — `prisma`, `@prisma/engines` (see PR1-SEC-02); optional — `msgpackr-extract`; dev — `@parcel/watcher`, `@swc/core`, `cpu-features`, `esbuild`, `fsevents`, `ssh2`. Lint, typecheck, unit and build pass without them.
- **Maintenance:** 89 direct dependencies; only `bcrypt` fails (PR1-SEC-06). Deprecated entries: 6 (PR1-SEC-07, plus dev-only `glob` 10.5.0 ×2 and `whatwg-encoding` 3.1.1 under Jest/jsdom and testcontainers, which the rev 2 item 6 freshness report must list).
- **Secrets:** gitleaks on `main..HEAD` scanned 5 commits (the sixth, `3f9c797`, only deletes files): **no leaks**. The 17 hits in the full-tree scan are all in files this PR does not touch (PR1-SEC-11). The spike's DB URL came from `SPIKE_DATABASE_URL`; no credential was committed.

## 5. Security requirements verified in this PR

| Requirement | Result |
|---|---|
| SEC-P3-04 item 1, local part: committed `.npmrc` with `ignore-scripts`, `engine-strict`, `save-exact`, `fund=false`, `update-notifier=false` (+ `audit=false`, `min-release-age=7`) | **Met.** `npm config get` returns the values; npm 11.19.1 documents `min-release-age` (it applies to tree building; the lane A age script stays the gate for `npm ci`). |
| SEC-P3-04 item 1: allow-listed `deps:rebuild`; nothing else runs lifecycle scripts; no workspace has `pre*`/`post*` hooks | **Met**, with PR1-SEC-02 (the implicit engine download) for TASK-003. |
| SEC-P3-04 item 2: 7-day cooldown | **Met at this lockfile** (0 entries < 7 d). The enforcing script is TASK-007. |
| SEC-P3-04 item 3: registry source and `sha512` integrity; `npm audit signatures` | **Met at this lockfile** (0 exceptions; signatures verified). The enforcing check is TASK-007. |
| SEC-P3-31 item 2: `npm exec --no` instead of `npx` | **Met in code** (`rebuild.mjs:91, 102`). ADR-0023 am. F text is corrected by in-flight am. I item 3. No root script uses `npx`. |
| SEC-TC-45 (local part) | **Green**, independently re-run: 8/8 in `tools/deps/ignore-scripts.test.ts` (static `.npmrc`, hook detector + control, no workspace hooks, fixture `npm ci` leaves no marker, control writes the marker, bcrypt works, dry-run allow-list, Playwright engine validation). |
| SEC-TC-64 (`deps:rebuild` part) | Partially met: `npm exec --no` fails instead of fetching a missing npm package. The Prisma engine download (PR1-SEC-02) needs the extension in PR1-SEC-02 when TASK-003 activates the step. |

## 6. Binding requirements for later tasks

| Task | Requirement (finding) |
|---|---|
| **TASK-001 (this PR, recommended, not blocking)** | 1. Add `@platform:registry=https://registry.invalid/` to `.npmrc` and assert it in the SEC-TC-45 `.npmrc` test (PR1-SEC-01). 2. Remove `@opentelemetry/auto-instrumentations-node` from `apps/api/package.json`, regenerate the lockfile under the cooldown, and expect `npm audit --omit=dev` = 0 (PR1-SEC-07). If either is not done here, it becomes binding on TASK-007. |
| **TASK-003** | Engine-pin step in `deps:rebuild` with `tools/deps/prisma-engines.json`; refuse `PRISMA_ENGINES_MIRROR` / `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`; children get `CHECKPOINT_DISABLE=1`; SEC-TC-64 extensions (i)–(iii) (PR1-SEC-02, PR1-SEC-08). The acceptance test "`deps:rebuild` regenerates the Prisma client with scripts disabled" must run with an empty engine cache. |
| **TASK-004** | Committed `app/entry.server.tsx` in `apps/web` and `apps/admin`, without `isbot`. The structure test asserts the entry exists in every workspace with `react-router.config.ts` and that no manifest declares `isbot` (PR1-SEC-03). |
| **TASK-007** | - Post-build `git status --porcelain` gate with a negative fixture.<br>- Job-level `NPM_CONFIG_IGNORE_SCRIPTS: "true"`, `CHECKPOINT_DISABLE: "1"`, `SCARF_ANALYTICS: "false"`.<br>- `check-workflow-policy` rejects `PRISMA_ENGINES_MIRROR`, `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING` and `npm_config_ignore_scripts=false`.<br>- `check-install-flags` asserts the `@platform` pin; `check-lockfile` asserts `@platform/*` entries are links only.<br>- `licence-check` with the named `elkjs` exception, the `png-js` override and `THIRD_PARTY_NOTICES.md` for `caniuse-lite`.<br>- The freshness gate goes live only after the `bcrypt` and `node-abort-controller` decisions are recorded.<br>- `.gitleaks.toml` handling of OpenAPI example values.<br>(PR1-SEC-01, -03, -05, -06, -07, -08, -10, -11) |
| **TASK-014** | - `api`/`worker`: `npm ci --ignore-scripts --omit=dev --omit=optional` from the **workspace root with the root lockfile and `.npmrc`** (never a per-app install, PR1-SEC-01).<br>- `prisma generate` in the build stage; preflight.<br>- `migrate` image: Studio-free via stub or narrow prune, proven by a `migrate deploy`/`status` test; schema engine fetched and verified at build time; no `schema-engine*` in `api`/`worker`.<br>- web/admin build with `NPM_CONFIG_OFFLINE=true` and a manifest checksum guard.<br>- `ENV CHECKPOINT_DISABLE=1 SCARF_ANALYTICS=false`.<br>(PR1-SEC-01..04, -08) |
| **TASK-214** | Explicit OTel instrumentations and the AWS resource detector only. Assert in a test that `gcp-metadata`, `gaxios` and the Azure/Alibaba detectors are absent from the production closure (PR1-SEC-07). |
| **TASK-049** | Apply the PR1-SEC-06 decision (exception or `bcryptjs`) before first use. |
| **principal-architect** | - D-ARCH-003 rev 3 in DECISIONS.md naming `elkjs` `EPL-2.0` exactly (not "OR GPL-3.0-or-later").<br>- `bcrypt` exception or substitution; `node-abort-controller` ruling.<br>- ADR-0023 am. I item 1: add the `@platform` pin to the `.npmrc` "in full" text.<br>- ADR-0023 am. I item 3 / SPK-01 §1: correct "`prisma generate` works with no install script" (it downloads `schema-engine` when not cached) and add the engine-pin step to the am. F allow-list.<br>- ADR-0002 §2: note the third-party ownership of `@platform`. |

## 7. Alignment with the in-flight architecture amendments (uncommitted at review time)

- **ADR-0026 am. 10 (custom `entry.server.tsx`, no `isbot`, structure test, build-must-not-mutate gate):** confirmed; additions in PR1-SEC-03.
- **ADR-0022 am. 11–13, ADR-0023 am. I item 2 (`--omit=optional`, Studio-free `migrate` image, preflight):** confirmed; the eager-`require` caveat is in PR1-SEC-04 (b).
- **ADR-0023 am. I item 3 (`npm exec --no`):** confirmed. Its claim "`prisma generate` works with no install script (engine-free client, 35 ms)" is **incomplete**; see PR1-SEC-02.
- **ADR-0023 am. I item 7 (lockfile and licence check adjustments):** confirmed. **Correction:** the `elkjs` SPDX is `EPL-2.0`.
- **ADR-0017 am. item 2 (explicit instrumentations, AWS detector only):** confirmed as the closure for F-09. Sequencing: remove the meta-package before TASK-007's gate lands (PR1-SEC-07).
- Not covered by any in-flight amendment: PR1-SEC-01 (`@platform` scope), PR1-SEC-02 (engine download), PR1-SEC-06 (`bcrypt` 18 months), PR1-SEC-08 (telemetry).

## 8. Evidence (commands, PR head `76b69c0`)

| Command | Result |
|---|---|
| `npm config get min-release-age ignore-scripts audit` | `7`, `true`, `false` |
| `npm audit --json` / `npm audit --omit=dev --json` | `{critical:0, high:0, moderate:37, low:1}` / `{critical:0, high:0, moderate:5, low:0}` |
| `npm audit signatures` | 1,496 verified signatures; 611 verified attestations |
| Licence scan (Node, scratchpad `sa/licences.mjs`) | 1,603 entries; 3 outside the allow-list + equivalents (`caniuse-lite`, `elkjs`, `png-js`) |
| Age/provenance sweep (dependency-auditor, scratchpad `dep-auditor/sweep.mjs`, `provenance.mjs`) | 1,597 entries; 0 < 7 d; 0 provenance exceptions; 6 deprecated; 12 with install scripts |
| `npm ci --omit=dev` vs `--omit=dev --omit=optional` (scratch copy) | 833 vs 705 packages; table in PR1-SEC-04 |
| Scratch copy + `@platform:registry=https://registry.invalid/` | `npm ci` exit 0 (1,505), `npm ls` exit 0, audit unchanged; out-of-workspace install → `ENOTFOUND registry.invalid` (without the pin: `E404` from registry.npmjs.org) |
| `prisma generate` with empty `APPDATA` + `PRISMA_ENGINES_MIRROR=https://engines.invalid` (scratch copy) | exit 1, attempted `…/all_commits/d1b3f377…/windows/schema-engine.exe.gz.sha256`; with the host cache: success in 40 ms and `schema-engine-windows.exe` written into `node_modules/@prisma/engines` |
| `curl https://registry.npmjs.org/-/org/platform/package` | 200; 131 third-party packages; none of our 16 names |
| `npm view bcrypt time` | `6.0.0` 2025-05-11T18:06:24Z, no later version |
| gitleaks (container, `--redact`) `git --log-opts=main..HEAD` / full-tree `dir` | no leaks / 17 pre-existing hits outside the diff |
| `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects unit` | 38/38; `ignore-scripts` suite 8/8 |

## Round 2 (head 4ec1bc4)

| Field | Value |
|---|---|
| Head / range | `4ec1bc4` (fix cycle 1: `36d2310`, `d5f707c`, `4ec1bc4`) against round 1 `76b69c0`. 12 files, +292 / −40, plus `package-lock.json` |
| Reviewer / date | security-analyst, 2026-11-12. Read-only on the worktree. Commands ran under the CLAUDE.md §2 PATH prefix: Node 24.22.3, npm 11.19.1 |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open for this change. **PR1-SEC-01 and PR1-SEC-07 are resolved in this PR.** The regenerated lockfile adds **0** new name@version tuples and 0 integrity changes; this was verified independently. Two new items, both routed to TASK-007 and neither blocking: PR1-SEC-12 (LOW) and PR1-SEC-13 (INFO). PR1-SEC-02, -03 and -04 (MEDIUM, latent) keep their round 1 routing. |

### R2.1 Status of round 1 findings

| ID | Round 2 status | Evidence at `4ec1bc4` |
|---|---|---|
| PR1-SEC-01 | **Resolved in this PR.** | `.npmrc:13-16` sets `@platform:registry=https://registry.invalid/`. New tests: `[SEC-TC-45] .npmrc pins the @platform scope…` and `[SEC-TC-45] lockfile entries for @platform/* are workspace links only…` (`tools/deps/ignore-scripts.test.ts:71-85`). Lockfile: 15 `node_modules/@platform/*` entries, all `link: true` to workspace folders. Fresh resolution of `@platform/shared` in a scratch project fails with `ENOTFOUND registry.invalid`; without the pin it is `E404` from `registry.npmjs.org`. **Scope correction to round 1:** the pin covers registry *resolution* only. It does not cover a lockfile `resolved` URL (PR1-SEC-13), and it breaks `npm audit signatures` and `npm outdated` (PR1-SEC-12). |
| PR1-SEC-02 / -03 / -04 | Open (latent), routing unchanged | Not touched by this cycle. They stay binding on TASK-003, TASK-004, TASK-007 and TASK-014 per §6. |
| PR1-SEC-05 / -06 / -10 / -11 | Open, routing unchanged | `elkjs` 0.11.1 (devOptional) and `bcrypt` 6.0.0 are unchanged in the lockfile. This review does not assess architect rulings. |
| PR1-SEC-07 | **Resolved in this PR** (GCP chain and advisories). The `node-abort-controller` sub-item stays with principal-architect and TASK-007. | `@opentelemetry/auto-instrumentations-node` was removed from `apps/api/package.json`. 69 name@version tuples (75 lockfile keys) left the tree, including `gcp-metadata`, `gaxios`, `rimraf` 5.0.10, `node-fetch` 3, `node-domexception` and every `resource-detector-*`. `npm audit --omit=dev` reports **0** vulnerabilities, and `npm ls gcp-metadata --all` is `(empty)`. In the production closure the only deprecated package left is `node-abort-controller` 3.1.1 (BullMQ). The remaining `glob` 10.5.0 and `minimatch` 9.0.9 copies (×2 each, under `archiver-utils` and `test-exclude`) are dev-only. |
| PR1-SEC-08 | Open, routing unchanged | `@scarf/scarf` 1.4.0 is still in the production closure, with its script suppressed. |
| PR1-SEC-09 | Item 1 unchanged (accepted); items 2–4 open (optional) | `npm_execpath` handling moved verbatim into `tools/deps/npm-cli.mjs`. The fixture test still does not isolate the global npm config (item 3). |

### R2.2 Lockfile verification (`76b69c0` → `4ec1bc4`)

`package-lock.json` has `-diff` in `.gitattributes` (pre-existing, from `main` `a1cd33d`), so `git diff` shows it as binary. Both versions were extracted with `git show` and compared structurally with a Node script (scratchpad `r2/scripts/lockdiff.mjs`).

| Check | Result |
|---|---|
| Entries (including root) | 1,634 → 1,559. The developer's figures are confirmed. |
| Distinct name@version | 1,320 → 1,251 |
| **New name@version tuples** | **0** |
| Retained tuples with a changed `integrity` or `resolved` | **0** |
| New lockfile keys (placements) | 0. 75 keys removed. |
| Same-key flag changes | 27, every one toward `dev`/`devOptional`. Examples: `cross-spawn`, `which`, `isexe`, `foreground-child`, `agent-base`, `https-proxy-agent`, the `@isaacs/cliui` family. These left the production closure with the GCP chain. **No entry moved into production.** |
| Workspace manifest deltas recorded in the lockfile | `apps/api` drops `@opentelemetry/auto-instrumentations-node`; the root adds devDependency `jest-util` 30.5.1. |
| Provenance | 1,522 registry entries, all `https://registry.npmjs.org/` with `sha512` integrity. 15 links, 15 workspace folders, 6 `inBundle`, 0 exceptions. 0 `node_modules` entries aliased to an `@platform/*` name; 0 `resolved` URLs containing `/@platform/`. |
| Cooldown | Respected. The tuple set is a strict subset of the round 1 set, which the sweep cleared (0 entries younger than 7 days at `2026-11-12T10:28:08Z`), and ages only increase. |
| `jest-util` 30.5.1 | Already in the lockfile at `node_modules/jest-util` as a Jest transitive: no new key, no flag change. Now a direct devDependency. MIT, published 2026-09-01T07:58Z (72 days), `latest` dist-tag. Licence, maintenance and cooldown all pass. |
| Licence | No new tuples, so nothing new to scan. The three round 1 exceptions are unchanged: `elkjs`, `png-js`, `caniuse-lite`. |
| Install scripts | The same 12 packages as round 1, all suppressed. |
| Installed tree vs lockfile | `node_modules/.package-lock.json` matches the committed lockfile: 0 missing, 0 extra, 0 version mismatches. `npm ls --all` exits 0. |

### R2.3 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR1-SEC-12 | The `@platform` pin makes `npm audit signatures` and `npm outdated` fail with `ENOTFOUND registry.invalid` | LOW | CWE-693 | A08 | `.npmrc:16`; npm 11.19.1 `lib/utils/verify-signatures.js:157-179, 181-221, 273` | TASK-007 (lane A `static`, freshness gate, Dependabot); principal-architect (platform.md §7.2 `static` command text) | Open (latent; nothing in this PR runs either command) |
| PR1-SEC-13 | The pin does not apply to lockfile-pinned `resolved` URLs, and the link-only test is keyed on install paths, so it would miss an npm alias | INFO | CWE-427, CWE-1357 | A08 | `tools/deps/ignore-scripts.test.ts:75-85`; arborist `replace-registry-host` behaviour | TASK-007 (`check-lockfile`) | Open (no exposure: 0 aliases, 0 `/@platform/` URLs) |

#### PR1-SEC-12: `@platform` pin breaks `npm audit signatures` and `npm outdated` (LOW)

**Description.** `npm audit signatures` in the worktree exits 1:

```text
npm warn Fetching verification keys using TUF failed.  Fetching directly from https://registry.invalid/.
npm error network request to https://registry.invalid/-/npm/v1/keys failed, reason: getaddrinfo ENOTFOUND registry.invalid
```

There are three steps to the cause, all in npm 11.19.1:
1. `getEdgesOut()` (`verify-signatures.js:157-179`) collects `pickRegistry(spec)` for **every** dependency edge, including the workspace edges `"@platform/shared": "0.0.0"`.
2. The registry set therefore contains `https://registry.invalid/`. `setKeys()` (`:181-221`) tolerates only `E404` and `E400` from the keys endpoint and rethrows `ENOTFOUND`.
3. Workspace nodes would have been skipped later (`:273`, `node.isWorkspace`), but the key prefetch already aborted the command.

`npm outdated --all` fails the same way. It requests `https://registry.invalid/@platform%2fshared`.

Without the pin, `npm outdated` asks the public registry for our workspace names, and it would offer anything the third-party scope owner publishes as an "update". Failing closed there is the right behaviour.

Round 1 verified the pin against `npm ci`, `npm ls` and `npm audit` but not `npm audit signatures`. This gap is round 1's.

**Exploitability and impact.** There is no exposure: both commands fail closed. The risk is to the control. SEC-P3-04 item 3 makes `npm audit signatures` a lane A gate (platform.md §7.2 `static`, TASK-007), and that gate will fail on its first run. The obvious workarounds weaken supply-chain controls:
- deleting the pin re-opens PR1-SEC-01;
- `|| true` silently disables signature verification.

Impact M × likelihood L = **LOW**.

**Remediation (TASK-007, code level).**
1. Lane A runs signature verification with a scope override on that read-only command only:
   ```sh
   npm audit signatures --@platform:registry=https://registry.npmjs.org/
   ```
   It is safe for three reasons:
   - `audit signatures` installs nothing;
   - workspace nodes are skipped (`:273`);
   - the override removes `registry.invalid` from the key prefetch set.

   Verified in the worktree at `--loglevel=http`: exit 0, **1,421 packages with verified registry signatures, 560 with verified attestations, 0 invalid, 0 missing**, and **0 requests for any `@platform/*` URL**. The drop from round 1's 1,496 / 611 equals the 75 removed packages.
2. `check-workflow-policy` allows `--@platform:registry=` only on an `npm audit signatures` invocation. It rejects the override, and any `npm_config_@platform:registry` environment entry, on `ci`, `install`, `exec`, `outdated`, `update` and `view`.
3. The freshness/age gate is lockfile-driven and skips `link: true` entries, as the round 1 sweep did. It never shells out to `npm outdated`.
4. Dependabot (`.github/dependabot.yml`, npm ecosystem) sets `ignore: [{ dependency-name: "@platform/*" }]`. The first run is checked for a `private_source_not_reachable` error on `registry.invalid`.
5. principal-architect records the exact `static` step command line in platform.md §7.2 / ADR-0023 am. I item 1. This is routing only; this review does not rule on the in-flight ADR text.

**Verification test (TASK-007).**
- The lane A `static` job passes on the repository with the pin present. This is the positive control.
- A `check-workflow-policy` negative fixture fails: a workflow step running `npm ci --@platform:registry=https://registry.npmjs.org/`.
- A second negative fixture also fails: a step running `npm audit signatures || true`.

#### PR1-SEC-13: pin scope and the link-only test (INFO)

**Description.** Scratch fixture: a project depending on `@platform/shared@0.0.0`, with the committed `.npmrc` (pin present) and a lockfile entry `resolved: https://registry.npmjs.org/@platform/shared/-/shared-0.0.0.tgz`. `npm ci --ignore-scripts` fetched **`https://registry.npmjs.org/…`** (E404 today), not `registry.invalid`. Arborist's `replace-registry-host` rewrites a `resolved` host against the default `registry` only, never against a scoped registry.

So a poisoned lockfile bypasses the pin. The SEC-TC-45 link-only test added in this cycle is therefore **load-bearing, not defence in depth**.

That test selects entries by key (`/(^|\/)node_modules\/@platform\//`). An npm alias, such as `"x": "npm:@platform/shared@…"`, is keyed `node_modules/x` with `name: "@platform/shared"`, and the test would not see it.

Lockfile diffs are also invisible to `git diff` (`-diff`) and collapsed on GitHub (`linguist-generated`). So the automated check is the reviewer's only view of a lockfile change.

**Exploitability and impact.** An attacker needs a merged lockfile change that adds an aliased or non-link `@platform/*` entry, plus a malicious publish in the third-party scope. At `4ec1bc4` there are 0 such entries. TASK-007's `check-lockfile` (`resolved` must be on the registry, `sha512` integrity) does not catch it either, because a third-party publish is on `registry.npmjs.org`. **INFO**: there is no exposure today.

**Remediation (TASK-007 `check-lockfile`; optional now in this test).**
- Reject any non-link entry whose `name` starts with `@platform/`.
- Reject any non-link entry whose key path contains `node_modules/@platform/`.
- Reject any non-link entry whose `resolved` path contains `/@platform/`.
- Lane A writes a lockfile delta summary to the job summary: new name@version tuples, integrity changes, and flag moves into production. The `lockdiff.mjs` logic used for R2.2 is a template.

**Verification test.** `check-lockfile` negative fixtures fail for two cases:
- (i) a non-link `node_modules/@platform/shared` entry with an npmjs `resolved` URL;
- (ii) an alias entry `node_modules/x` with `name: "@platform/shared"`.

### R2.4 Change review of the fix cycle

| Change | Security assessment |
|---|---|
| `tools/deps/npm-cli.mjs` (extracted) | Behaviour is identical to round 1: `node:` builtins only, no shell, and the caller spawns `process.execPath` with an argument array. PR1-SEC-09 item 1 still applies (accepted). |
| `tools/deps/rebuild.mjs` entry guard → `import.meta.main` | **Positive.** The old `argv[1]` comparison could skip `main()` and **exit 0 with no output** when the script was started through a junction or symlink. That was a fail-open on the install path. The new guard throws when `import.meta.main` is unavailable, so it fails closed. Covered by a new junction test and an end-to-end `main()` test that strips `DEPS_REBUILD_PLAYWRIGHT`. |
| `tools/test-support/process.ts` | Re-uses `npmCli()`. No new sink. |
| `tools/repo/jest-esm.test.ts` | The HS256 key is random per run (`webcrypto.getRandomValues`). Nothing secret-shaped is committed. |
| `jest.config.ts`, `tools/repo/coverage-scope.test.ts`, `tools/repo/root-scripts.test.ts` | No security sink. Coverage now also measures `apps/*/app` and `prisma/seed`, which supports the 95 % authz/audit targets. |
| Secrets | gitleaks (container, `--redact`) on `76b69c0..4ec1bc4`: 3 commits scanned, **no leaks**. |
| SAST | Semgrep is not installed. The changed executable code (about 120 lines) was reviewed manually: no `shell: true`, no string-built commands, no untrusted input reaching a sink. |

### R2.5 Requirements re-checked

| Requirement | Result at `4ec1bc4` |
|---|---|
| SEC-P3-04 items 1–3 (local part) | **Met.** The `.npmrc` keys are unchanged, plus the pin. Cooldown and provenance are clean (R2.2). Running `npm audit signatures` needs the PR1-SEC-12 command form. |
| SEC-TC-45 (local part) | **Green.** `ignore-scripts` suite 12/12: the round 1 eight, two PR1-SEC-01 tests and two `deps:rebuild` run tests. |
| SEC-P3-31 item 2 (`npm exec --no`) | **Met** (unchanged). |

### R2.6 Binding requirements: changes to §6

- **TASK-001 (this PR):** both recommended items are done. Nothing further is required to merge from a security standpoint.
- **TASK-007:** add the PR1-SEC-12 items:
  - the `npm audit signatures --@platform:registry=https://registry.npmjs.org/` command form;
  - the `check-workflow-policy` override rule;
  - a lockfile-driven freshness gate with no `npm outdated`;
  - Dependabot `ignore` for `@platform/*`.

  Add the PR1-SEC-13 items: `check-lockfile` `name`/`resolved` rules for `@platform/*` and the lockfile delta summary. The PR1-SEC-07 item in §6 shrinks to the `node-abort-controller` ruling.
- **TASK-214:** unchanged. Add the specific instrumentations (http, undici, pg, ioredis, pino, express or the chosen framework) and the AWS/container detectors through the cooldown, licence and age gates. Never re-add `auto-instrumentations-node` or the GCP/Azure/Alibaba detectors.

### R2.7 Evidence (commands, head `4ec1bc4`)

| Command | Result |
|---|---|
| `git show 76b69c0:package-lock.json` / `4ec1bc4:…` + `lockdiff.mjs` | 0 new tuples, 0 integrity changes, 0 new keys, 75 keys removed, 27 flag moves toward dev; 1,522 registry entries with 0 provenance exceptions |
| `npm audit --json` | `{critical:0, high:0, moderate:34, low:1}` across 1,558. Advisories unchanged and dev-only: GHSA-3g3m-2fjr-6pw4, GHSA-g3hv-75wg-m249, GHSA-gcqx-w48m-w2h4 |
| `npm audit --omit=dev --json` | `{total:0}` |
| `npm audit signatures` | exit 1, `ENOTFOUND registry.invalid` (PR1-SEC-12) |
| `npm audit signatures --@platform:registry=https://registry.npmjs.org/ --loglevel=http` | exit 0; 1,421 verified signatures; 560 verified attestations; 0 `@platform` requests |
| `npm outdated --all --json` | exit 1, `ENOTFOUND https://registry.invalid/@platform%2fshared` (PR1-SEC-12) |
| `npm sbom --sbom-format cyclonedx` | exit 0; 1,144 components |
| `npm ls --all` / `npm ls gcp-metadata --all` | exit 0 / `(empty)` |
| Scratch: fresh `npm install --package-lock-only` of `@platform/shared@0.0.0` | pinned: `ENOTFOUND registry.invalid` ×3 retries, exit 1. Unpinned: `E404 registry.npmjs.org/@platform%2fshared` |
| Scratch: `npm ci` with a lockfile `resolved` at registry.npmjs.org | pinned **and** unpinned: `GET 404 https://registry.npmjs.org/@platform/shared/-/shared-0.0.0.tgz` (PR1-SEC-13) |
| `npm view jest-util@30.5.1 license time` | MIT; 2026-09-01T07:58:44Z; `latest` = 30.5.1 |
| `node --experimental-vm-modules node_modules/jest/bin/jest.js --selectProjects unit` | 6 suites, 77/77; `ignore-scripts` suite 12/12; `git status --porcelain` empty afterwards |
| gitleaks container `git --log-opts=76b69c0..4ec1bc4 --redact` | 3 commits, no leaks |
