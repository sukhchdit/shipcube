# Code review: PR #39, TASK-014 hardened multi-stage images and Docker Compose skeleton (round 1)

- **PR:** https://github.com/sukhchdit/shipcube/pull/39, branch `feat/TASK-014-hardened-multi-stage-images-docker`
- **Head reviewed:** `894c72e4afec04af63c6274b67f663b5894e0129` (code at e4c2ad5 plus an evidence-only commit)
- **Scope:** US-004 (completes), US-003/US-049 (partial), WAVE-00 sheet lines 512–548 including the SHEET-FOLD-6
  review requirement (line 545, D-ARCH-115); D-TASK014-01..17
- **Reviewer:** code-reviewer, 2026-11-14

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A careful, well-layered delivery. Images, Compose ordering, per-service env files, the entry preflight, the
  single TLS implementation and PR9-SEC-15 are correct, and the opt-in stack project leaves the other projects alone.
  One MAJOR: the D-ARCH-115 merge check is not met. The image find has no routing/tests pattern, and prune-dist.test
  has no routing case. The fix is three lines plus one targeted stack re-run.
FINDINGS: 1 MAJOR, 4 MINOR, 9 NIT (section 3)
GOOD: three independent layers keep test code out of the images (.dockerignore, prune-dist, build-time preflight
  cleanTree over the app dist and the @platform dependency dists); value-free exit-78 paths; a bounded single-open CA
  read; the tooling one-shots pin pg `options`, so PGOPTIONS cannot reach them; the compose shape is pinned by lane A
  tests; the .dockerignore matcher is checked against itself
SECURITY-FLAGS: entrypoint forwards CMD arguments to node unchecked (R1-m1); no Dependabot channel for 9 new digest
  pins (R1-m2); --use-openssl-ca on a base without ca-certificates (R1-n6)
```

## 1. What I verified myself

| Check | Result |
|---|---|
| `git log origin/main..894c72e` | 40 commits: feature/fix commits, 5 merges of main, and evidence-only commits. origin/main has moved by two docs-only commits since the last merge (8537ab0 sheet fold 6, ff9673c STATUS). The PR does not touch WAVE-00.md, and gh reports MERGEABLE. |
| Lane A on the exact head (run 43547497834) | fast-lane: every step executed and green (none skipped). scans: only "Security-owned paths need a review record" failed, which is expected. ci-gate: red as a consequence. I did not re-run lint, format or typecheck locally; I relied on these executed steps. |
| Targeted unit files, run on the head (path before `--selectProjects`) | prune-dist, entry-preflight, check-dockerignore, run-stack-tests, check-dockerfiles, db-tls: **222/222 green**. config-exit.test.ts on its own: 9/9 green. |
| Unintended full unit runs (my own mistake: I put the path after `--selectProjects unit`, which made Jest run the whole project) | 4 runs, 4781 tests each. 2 runs were fully green. 2 runs had load flakes (4 and 2 failures) in worker health server, routing pipeline(-guards), runtime services, seed cli, openapi contract and, once, the PR's `config-exit.test.ts`. None of these files failed in another run. This was host load, not a regression, but see R1-n7. |
| Jest project membership (focus 5) | `jest --listTests --selectProjects <p>` for unit, unit-dom, integration, api and generated, with and without `JEST_STACK=1`: **byte-identical lists** (196/13/30/8/2). `stack` exists only with the flag and lists exactly `tests/compose/compose-up.stack.test.ts` and `images.stack.test.ts`. Union of all project lists: **0 files in two projects**. `tools/compose/compose-stack.test.ts` and `run-stack-tests.test.ts` stay in `unit` (lane A). |
| `docker compose config -q` (base, and base + debug) | exit 0 / exit 0 |
| TLS predicate vs runtime (focus 3) | tsx differential over 350 URL parameter combinations: config `hasValidDatabaseUrlParamValues` vs runtime `tlsConfig` (CA inside a temp CA dir). **0 fail-open divergences**. 10 fail-closed ones: config also refuses a bad `sslrootcert` when `sslmode=disable`, where the runtime ignores it. See R1-n4. |
| prune-dist on a routing/tests tree | Probe: `dist/platform/routing/tests/{fixture-route,loopback}.js` and `query-counter.js` are removed and `define-route.js` is kept. The behaviour is right; only the pins are missing (R1-M1). |
| PR #40 union (sequencing) | `git merge-tree 894c72e ee64946` is clean (tree 397fc4f). PR #40 does not touch `jest.config.ts`. `package.json` gets different script lines from each side. PR #40's `jest-esm.test.ts` enumerates the scripts whose command contains `jest`. `test:stack` (`node tools/compose/run-stack-tests.mjs`) does not, so its expected list of 5 scripts stays true. |
| Not run (dispatch constraint) | Image builds, the stack suite, hadolint and the secret scan. I relied on the PR's stack result (45/45 on c425093) and on evidence `20261114T0223Z_e4c2ad5` (unit 4835, api 123, integration 263, catalog 74; verdict PASS). |

## 2. Focus-by-focus

1. **Dockerfiles.**
   - Every FROM is `name:tag@sha256` or an earlier stage.
   - The final stages run `USER 1000:1000` (api/worker/tooling) or `USER 101` (nginx).
   - The code is COPY-ed root-owned, and only `/data/audit-anchors` is node-owned.
   - The runtime installs use `--omit=dev --omit=optional`, followed by `prune-deps` and `prune-dist`.
   - There is no `npm rebuild` and no npx.
   - The build-time `preflight.mjs` imports every module without `--conditions`. Its `cleanTree` refuses `tests/`, `fixtures/`, `spikes/` and `*.test.*` in the app dist and in every `@platform/*` dependency dist. This includes `apps/api/dist` inside the worker image, so a compiled `routing/tests` would already fail `docker build`.
   - `read_only` plus a tmpfs on `/tmp` is set for api, worker, the one-shots, web, admin and edge.
   - Both nginx Dockerfiles delete the stock `default.conf` and the stock `html/`, render the template at build time and copy only `build/client`.
2. **Compose.**
   - Order: postgres healthy → bootstrap → migrate → seed (each `service_completed_successfully`), then api and worker (with redis healthy and storage-init done; the worker also waits for mailpit), then the edge (with web, admin and api healthy and tls-init done).
   - Idempotent re-up, `down -v` + up and a failing migration are covered by the stack suite.
   - The env partition is pinned by `compose-env.test.ts`. Every secret-shaped value in `compose.env` and `infra/local/env/*.env` is a `local-only-*` marker (I checked this without printing values).
   - `.env.example` is unchanged by the PR.
3. **packages/config.**
   - `credentialPairGuard`: `raw` already drops empty values, so an empty reference counts as unset. Hardened environments refuse both members with no switch.
   - `logLevelGuard` mirrors the preflight floor.
   - `readRootCertificate` does the following:
     - confines the path by realpath to the CA directories;
     - opens the file once with `O_NONBLOCK|O_NOFOLLOW`;
     - checks it is a regular file with fstat;
     - reads at most 1 MiB + 1 byte;
     - sends every failure through fixed text.
   - Exit-78 paths: `createOrExitOnConfigError` exits 78 for `DatabaseConfigError` (DATABASE_URL) and `TenantTxConfigError` (PGOPTIONS / DB_TX_*) and rethrows everything else. A child-process test covers both `main.ts` files.
4. **PR9-SEC-15.**
   - `prismaArgv` = `[prismaCliPath(root), ...args]`, spawned with `process.execPath`. The bin is resolved from `prisma/package.json` through `createRequire`, and absolute paths and `..` are refused.
   - `rebuild.mjs` routes the prisma step through `runner: 'prisma'`.
   - `npmCli()` no longer reads `npm_execpath`.
   - The integration test runs the npmrc `script-shell`/`node-options` marker negative and positive controls.
5. **Stack project.** It is clean (section 1). The exclusion from the unit project is pinned only by a text tripwire (R1-n3).
6. **Checkers.**
   - `check-dockerignore.mjs` (80 lines) follows moby semantics: anchored patterns, `**` matching zero or more directories, a matching parent directory excluding everything below it, and the last match winning. Its test pins all five required paths, the single docs exception and the no-`COPY .` rule.
   - `check-dockerfiles.mjs` duplicates the ignore-scripts rule more weakly than `check-install-flags` (R1-n2).
7. **Test quality.**
   - The tests are strong overall: decision tables, a fake `node` on PATH for `entrypoint.sh`, child-process exit codes, a secret probe that has to be found in an earlier layer, and AT IDs in the titles.
   - Gaps: R1-M1, and the stack evidence is not committed (R1-m4).
8. **Docs drift (open item 5).** It is not fixed in this PR, and that is correct. The ruling is R1-m3.
9. **D-TASK014-02 maintainability.** Section 4.

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `tests/compose/images.stack.test.ts:196-238`; `tools/docker/prune-dist.test.ts:17-56` | **D-ARCH-115 merge check (sheet line 545) is not met.** The image find asserts `*.test.js` and `query-counter.*`, but it has no `*/routing/tests*` pattern and no generic `*/dist/*/tests/*`. `prune-dist.test.ts` has no `platform/routing/tests/fixture-route.js` case. The sheet calls this a merge check: "the image find asserts all three". The risk is nil today, because `.dockerignore` (`**/tests`), the prune-dist directory rule and the preflight `cleanTree` each exclude the folder. Without the pins, though, nothing names the requirement, and a later relaxation (a re-included folder, a `tests` rename) would go unnoticed by the suite that is meant to prove it. The requirement landed on main (8537ab0) after this head's last merge of main. | (a) In the find, add `'-o', '-path', '*/routing/tests*'`, plus `'-o', '-path', '*/dist/*/tests/*'` if no `node_modules` package matches it. If one does, scope it to `/app/apps` and `/app/packages` and say so in a comment. (b) In `prune-dist.test.ts`, add the rows `['platform/routing/tests', true, {}, true]`, plus a directory case in which `dist/platform/routing/tests/fixture-route.js` is removed and `dist/platform/routing/define-route.js` is kept (my probe shows this passes today). (c) Re-run only `npm run test:stack -- tests/compose/images -t "sheet line 543"` on the final head and put the result, with the SHA, in the PR body. Add sheet line 545 to the sheet-line → test table. |
| R1-m1 | MINOR (security flag) | `tools/docker/entrypoint.sh:19` | `exec node --disable-sigusr1 --enable-source-maps "$@"` forwards the container command unchecked. In a hardened `APP_ENV`, a task-definition `command` or a `docker run <image> --inspect=0.0.0.0:9229 dist/main.js` (or `--require /x dist/main.js`) starts the inspector or a preload before any application code runs. This is the same class of attack that the NODE_OPTIONS allow-list closes, reached through the other channel that the same operator controls. | When the preflight passes, refuse in the entrypoint (or pass to the preflight as `PREFLIGHT_ARGC`/args) any argument that starts with `-`, or require exactly one argument matching `^dist/[A-Za-z0-9/_.-]+\.js$`, for APP_ENV outside local/test. Exit 78 and name `CMD` only. Add an `entrypoint.test.ts` row and an `images.stack` row (`docker run -e APP_ENV=staging <image> --inspect=0.0.0.0:9229 dist/main.js` → 78). |
| R1-m2 | MINOR | `.github/dependabot.yml:9` (not in the diff) | The file says that docker ecosystems are added "with the first Dockerfile/infra code (TASK-014, TASK-017)". This PR adds 9 third-party digest pins (node ×4 Dockerfiles, debian ×2, nginx-unprivileged ×2 plus the edge, and postgres/valkey/rustfs/aws-cli/mailpit/alpine in compose.yaml). None of them has an update channel, and the gap is not in "Not done". D-TASK014-02 makes this more pressing: the node and debian pins must move together (section 4). | Add `package-ecosystem: docker` (directories `/apps/api`, `/apps/worker`, `/apps/web`, `/apps/admin`, `/prisma`) and `docker-compose` (`/`). Use the 7-day cooldown, and add a group that bumps `node` and `debian` together. Update `tools/ci/sec-static.test.ts:149` (the `cooldown … toHaveLength(2)` count). Alternatively, name an owner and route it in the PR body and DECISIONS. |
| R1-m3 | MINOR (routing ruling) | open item 5; `CLAUDE.md` §2 run-locally | **Docs drift ruling: no fix in this PR**, because the author does not own these files. (a) ADR-0002/0006/0022/0023, platform.md, data-model.md and nfr-strategy.md still say `dist/healthcheck.js` / `dist/preflight.js`, where the code uses `/app/healthcheck.mjs` / `/app/preflight.mjs`. ADR-0023 am. J and platform.md §3.2 still describe `npm exec --no -- prisma`, while sheet line 538 (PR9-SEC-15, already an architect decision) moved this to node-direct. Route all of these to the principal-architect ruling already dispatched on D-TASK014-01/02/07 as one amendment pass, before TASK-022/026/034 cite them. (b) Sheet line 544 (`dist/preflight.js`) and the single `compose.env` in `plan-data.mjs` go to the architect's next generator fold. (c) CLAUDE.md §2 says "api :3000, admin :8081, Swagger at http://localhost:3000/api/docs, `cp .env.example .env`, `npm run dev:*`". After this PR the api has no host port (only with `compose.debug.yaml`), and admin is `https://localhost:8444`. The docs are at `http://localhost:8080/api/docs` through the edge. The `dev:*` scripts do not exist. This file belongs to the orchestrator (D-ORCH-058). TASK-282's README must use the edge URLs. | Orchestrator: record the routing (architect amendment pass; TASK-282 for developer docs; a CLAUDE.md note or none). No change in PR #39. |
| R1-m4 | MINOR | PR body "stack suite 45/45 on c425093"; `tests/compose/*.stack.test.ts` | The executed proof of AT-US-004-01..04, AT-US-003-01..04 and AT-US-049-02, and the size budget, exists only as a sentence in the PR body, for a SHA one unit-test file older than the code head. The worker sits at 296.0 of 300 MiB (1.3 % headroom), and the budget is checked only in the opt-in suite. Until the activation PR, the next dependency added to apps/worker can break the budget silently. | Merge condition: with the R1-M1 re-run, state the stack result per test for the final head in the PR body (or attach the Jest JUnit if `check-evidence` allows it). Activation PR: `compose-up`/`image-assertions` runner entries, plus the size test in `pr` for any change under `apps/worker`, `apps/api`, `packages/**` or the lockfile. |
| R1-n1 | NIT | `tools/docker/entrypoint.sh:19` | `--enable-source-maps` is always on. The Node docs warn about the cost when `Error.stack` is read often (error logging, validation errors), and the O2 latency budget is tight. | Measure it in the perf task, or make it opt-in through the NODE_OPTIONS allow-list (it is already listed). |
| R1-n2 | NIT | `tools/ci/check-dockerfiles.mjs:182` | The `ignore-scripts` rule accepts `npm ci --ignore-scripts false` (npm reads a bare boolean value). `check-install-flags` already catches that form, so the two gates disagree. | Drop the duplicate rule and point to `check-install-flags`, or reuse its predicate. |
| R1-n3 | NIT | `tools/repo/jest-projects.test.ts` (not in the diff) | The unit project's exclusion of `*.stack.test.ts` is pinned only by a source-text `toContain` in `run-stack-tests.test.ts`. | Add the row `['tests/compose/x.stack.test.ts', []]` to the project-selection table. |
| R1-n4 | NIT | `packages/config/src/guards.ts:90-98` vs `db-tls.ts:137-154` | There are two implementations of the TLS-selector rule. Today they differ only in the fail-closed direction (0/350 fail-open). | Have `tlsConfig` call `hasValidDatabaseUrlParamValues` first, or add a parity property test. |
| R1-n5 | NIT | `tools/docker/tooling-entrypoint.sh:43-44` | `migrate` verifies the engine twice (`--verify-only` alone, then `--verify-only migrate deploy`). | Drop line 43. |
| R1-n6 | NIT (security flag) | `packages/config/src/entry-preflight.ts:40,44` | `--use-openssl-ca` is allow-listed, but the runtime base (debian:trixie-slim plus the Node binary) installs no `ca-certificates`, so I expect the OpenSSL store to be empty (not verified; no image build). Selecting it would break every outbound TLS call (carriers, Stripe). `--unhandled-rejections=none` or `=warn` is also allowed and silences a fatal path. | Remove `--use-openssl-ca` (or ship CA certificates), and constrain `--unhandled-rejections` to `strict` or `throw`. |
| R1-n7 | NIT | `apps/api/src/platform/db/config-exit.test.ts:85-125` | It failed once in the 4 host-loaded full unit runs and passed alone. Each case spawns tsx over a whole `main.ts`. | Run this describe in band, or raise the per-case limit explicitly. Watch it in lane B. |
| R1-n8 | NIT | `tools/docker/scan-image-secrets.mjs:243-244` | `--max-target-megabytes 10` skips larger files (the node binary, the wasm compilers). | Document the limit next to the AT-US-004-02 claim. |
| R1-n9 | NIT | `tools/docker/tooling-entrypoint.sh` | The tooling image runs with migrator and bootstrap credentials. Its entrypoint unsets NODE_OPTIONS, but it has no `PG*` refusal like the runtime preflight's. In practice `pg` ignores PGOPTIONS here (both clients set `options`, and the seed asserts a pinned session). The Rust schema engine is not libpq and should not read `PG*`, but nothing records this. | Optional: a `PG*` refusal in `check-tooling-env` for staging/production, which costs one line and keeps the two entrypoints symmetric. |

## 4. D-TASK014-02 (debian:trixie-slim plus the Node binary): maintainability view

The architect rules on the deviation. From a maintainability angle the construction is sound, but it has three costs.

1. **Two pins that must stay ABI-compatible.** The Node binary links glibc, libstdc++ and libgcc from the base. Both come from Debian 13, and `apt` depends on libstdc++, so they are present. The build-time `node --version` and the preflight (which loads bcrypt's native addon) fail the build on a mismatch, so a drift fails loudly, not silently. Still, a bump of `node:24.x-trixie-slim` and a bump of `debian:trixie-slim` are separate edits today. Ask for:
   - a lane A static test that the node tag's Debian suffix equals the runtime `debian:<suffix>` tag;
   - a test that all four node FROM references are byte-identical;
   - a Dependabot group (R1-m2).
2. **A hand-assembled user and runtime.** UID/GID 1000 and `/data/audit-anchors` are re-created by hand. Everything else the node image offers is dropped. Some of that is wanted: npm, corepack and the headers. The CA bundle is not (R1-n6). Document the dropped items in platform.md §3.2 when the ruling lands, so that the next maintainer does not "fix" the base back.
3. **Little budget headroom.** Worker 296.0/300 MiB. Any growth needs a size check that runs (R1-m4).

An alternative for the architect: a digest-pinned distroless Node 24 / Debian 13 image would remove the hand assembly. It has no `/bin/sh`, so `entrypoint.sh` would have to become a Node launcher that runs the preflight in-process before it spawns the app (the spawn is needed because NODE_OPTIONS applies at process start). That is more code, so the current choice is defensible if items 1–3 are pinned.

## 5. Union notes for whichever of PR #39 / PR #40 merges second

- `jest.config.ts`: keep `'\\.(int|api|stack)\\.test\\.ts$'` in the unit ignore and the trailing `...(process.env.JEST_STACK === '1' ? [...] : [])` spread. `run-stack-tests.test.ts` asserts both literally.
- `package.json`: keep `test:stack` (a non-`jest` command, so PR #40's `jest-esm.test.ts` list of 5 stays right). PR #40's `test:coverage` → `coverage-run.mjs`.
- PR #40's `coverage-run.mjs` takes its projects from `suite-runners.json` `merged_coverage`. Do not add `stack` there; the activation PR adds a separate `stack` runner entry.
- Re-run `--listTests` per project on the union and expect the same lists as in section 1.

## 6. Merge conditions

1. R1-M1 is fixed, with the targeted stack re-run result for the final head in the PR body (this also covers R1-m4 for the merge).
2. A security record names the final head (the scans step is the only red lane A step today).
3. MINORs R1-m1 and R1-m2 are fixed in this PR or routed by the orchestrator with owners. R1-m3 is routed as ruled.
4. Merge main (docs-only delta), then squash.

Round 2 is a delta check: the R1-M1 diff, the stack re-run statement, and whichever MINORs were taken in-branch.
