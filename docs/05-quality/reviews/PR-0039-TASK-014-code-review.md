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

---

# Round 2 (head c85d5e5)

- **Head reviewed:** `c85d5e56` (code `4d87301`, evidence commit `c85d5e5`). Delta since round 1 (`894c72e`): 11 branch commits (`ace8c27` security record, `def2b9b`, `4a3a0d6`, `2aabee0`, `a31f94b`, `8a31d1f`, `dd7a2dd`, `a9a53e1`, `756d505`, `7edcd08`, `32d8ca8`), 4 evidence commits, and 11 merges of main (PRs #40, #43, #44, #45, #47 and docs).
- **Inputs:** PR body (fix cycle 1 and the round-2 push section, D-TASK014-18..25) and its 3 comments; `rulings/wave-0-task-014-rulings.md` R1–R6; security record r1 (C1/C2, PR39-SEC-01..10); evidence `20261114T1449Z_4d87301`; lane A run 43612304410.
- **Reviewer:** code-reviewer, 2026-11-14

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R1-M1 / C1 is closed: the find pins */routing/tests* and */dist/*/tests/* (outside node_modules), and
  prune-dist has the routing rows plus an on-disk case. Architect R1-R6 and R1-m1/m2/m4 and R1-n2/n3/n5/n6/n7/n9 are met.
  The exit-78 move into installProcessErrorHandlers is correct, unit-tested in process, and composes with PR #44's
  startApi. Every merge is a pure union. 4 new NITs; no BLOCKER, MAJOR or MINOR.
FINDINGS: 0 BLOCKER, 0 MAJOR, 0 MINOR, 4 NIT (R2-n1..n4), plus 2 carried NITs (R1-n1 routed, R1-n4 needs an owner)
GOOD: the exit-78 mapping lives in the one handler both entry points already install, so the entry points stay equal
  to main. The preflight argv rule is an allow-list (exactly one dist/*.js), not a deny-list of flags. Per-line
  CODEOWNERS mutation tests. prune-deps stops following optional peers, so typescript no longer arrives through prisma.
  Size WARN is visible on every run without loosening the gate.
SECURITY-FLAGS: none new. The env channels outside the preflight (LD_PRELOAD, OPENSSL_CONF, NODE_V8_COVERAGE,
  NODE_REDIRECT_WARNINGS) are in the same operator-controls-the-task-definition class as R1-m1. FYI only, for the
  security delta round. NODE_DEBUG is already refused by loadConfig.
```

## R2.1 What I verified myself

| Check | Result |
|---|---|
| Branch state | `git log origin/main..c85d5e5`. Main moved after the last union (`d753027`) with docs and `.claude/` files only (`git diff --name-only d753027 origin/main` has no other path). gh reports MERGEABLE. |
| Lane A run 43612304410 on `c85d5e5` | fast-lane: success, with every step green (lint ran with the 4 GB heap; the evidence check passed). scans: only "Security-owned paths need a review record" failed, which is expected because the r1 record names `894c72e`. ci-gate: red only as the aggregate. |
| Targeted unit files on the head (path before `--selectProjects unit`) | Batch 1: config-exit, process-errors, entry-preflight, tooling-env, prune-dist, entrypoint: **192/192**, including the 3 spawned `main.ts` cases. Batch 2: check-dockerfiles, sec-static, check-workflow-policy, jest-projects, prune-deps, tooling-closure, scan-image-secrets: **347/347**. |
| Jest project membership on the union | `--listTests` per project, with and without `JEST_STACK=1`: unit 208, unit-dom 12, integration 31, api 7, generated 1. The lists are byte-identical with and without the flag. `stack` exists only with the flag and holds exactly the 2 `tests/compose/*.stack.test.ts` files. **0 files in two projects.** `merged_coverage` has no `stack`, and `tools/quality/` equals main. |
| Merges since r1 (11) | `git merge-tree --write-tree P1 P2` vs the merge commit: **9 clean merges with an empty diff**. The 2 conflicted merges (`7845a76`, `399f8b8`) differ only in the hand resolution in `check-workflow-policy.{mjs,test.ts}`. `git show --cc`: `REQUIRED_CODEOWNED_PATHS` keeps the PR39-SEC-05 block (15 entries), the PR40-SEC-01 `.gitattributes` pair and the PR43-SEC-04 pair. The test file keeps both describe blocks whole (PR39-SEC-05: 15 required + 15 mutation + prisma/Dockerfile + 22 owned-path rows; PR43-SEC-04: 2 + 2 + sibling-folder case). |
| Entry points equal main | `git diff --quiet origin/main c85d5e5` for `apps/api/src/main.ts`, `apps/worker/src/main.ts`, `apps/api/src/platform/runtime/index.ts` and `apps/api/src/start-api.ts`: all equal. |
| Evidence `20261114T1449Z_4d87301` | summary.md: sha 4d87301, profile pr, **PASS**. api 124, catalog-c1-c14 102, integration 298 (1 skipped), **rls-cross-tenant 126**, unit 5369 (2 skipped), 0 failures. Merged coverage 98.86 % lines / 96.47 % branches; US-006 merged gate PASS. |
| Find probe (scratchpad, GNU find, the PR's exact predicate) | It matches `dist/platform/x/tests/b.js` and does not match `node_modules/p/dist/a/tests/c.js`, as intended. It also does not match `apps/api/dist/tests/a.js` or `packages/config/src/foo.test.ts` (R2-n1). |
| PR #42 / PR #46 merge-tree against `c85d5e5` | #42: conflicts in `packages/config/src/values.test.ts` (`GUARDS.length` 14 vs 13; main has 12) and `ci.yml`, where only the comment conflicts and the env line appears once. #46: `ci.yml` only, where only the comment conflicts and there is one `--max-old-space-size=4096`. |
| Not run (dispatch constraint) | No image builds, no stack suite, no full suites. I relied on the PR's stack result: 54/54 on `ee17098`, where `4d87301` differs outside docs only in `ci.yml` and `required-suites.json`, neither of which any image build reads. I also relied on the evidence above and on lane A. |

## R2.2 Verification items

**(a) R1-M1 / C1.** Closed.
- `tests/compose/images.stack.test.ts:252-266` adds `-path '*/routing/tests*'` and `( -path '*/dist/*/tests/*' ! -path '*/node_modules/*' )`.
- The node_modules exclusion is commented and justified by ruling §4.3 (f).
- `tools/docker/prune-dist.test.ts` gains two table rows:
  - `platform/routing/tests` is a directory, and it is removed;
  - `…/tests/fixture-route.js` alone is kept by the file rule, which proves that the directory rule is the one doing the work.
- An on-disk case shows that `fixture-route.js`, its `.map` and `loopback.js` go with their directory while `define-route.js` stays (`prune` returns 1).
- The stack result `[sheet line 543] × 5` is green on `ee17098`.

**(b) Architect requirements.**
- **R1 (D-ARCH-117), met.**
  - Install and prune:
    - The install is `npm ci --include=dev --workspace=prisma`, with no root.
    - `tsx` is in `prisma` devDependencies.
    - `prune-deps --dev --leaf …` keeps the workspace's production closure plus its own devDependencies' closure.
    - Optional peers are no longer edges.
    - The api/worker closures are unchanged (252/252 and 274/274 per the PR). The unit test pins that `typescript`, `@eslint/js` and a react peer are removed.
  - Stack assertions:
    - `node_modules/typescript` is absent in **every** image (`:274-287`, 5 cases green).
    - The tooling dev list (25 names, `:289-319`) and 0 PEM private-key files (`:320-340`) are asserted.
    - Tooling is now **327.9 MiB** (was 588.8).
- **R2, met.** `.github/dependabot.yml` has `docker` (5 directories) and `docker-compose` (`/`), each monthly with a 7-day cooldown, a limit of 2, one `['*']` group and the `build(deps)` prefix. Both are pinned exactly by the parsed `sec-static.test.ts` case, and the cooldown count is 4. The first-run checks (a digest-only `debian` bump; whether `compose.debug.yaml` is picked up) are recorded as non-blocking follow-ups, as the ruling allows.
- **R3, met.** `check-dockerfiles`:
  - `runtime-codename` covers (a) codename parity, with a FROM that has no readable codename as a finding; (b) byte-identical node and debian FROMs across all scanned files; (c) a debian stage takes exactly `/usr/local/bin/node` from the node stage, with no `RUN --mount from=`.
  - `entrypoint` covers the last ENTRYPOINT plus the `--chmod=0555` copy.
  - Each branch has a negative test, all green.
- **R4, met.** `--use-openssl-ca` is gone from `ALLOWED_NODE_OPTION_NAMES`. `--unhandled-rejections` is limited to `strict`/`throw` (`CONSTRAINED_NODE_OPTION_VALUES`). "No system CA store" is stated in `entrypoint.sh`, in the Dockerfiles and in the allow-list JSDoc.
- **R5, met.** The size case prints the share and writes `[stack] WARN <image> at P % of its budget` to stderr at ≥ 90 %, while failing only above 100 % (`:193-208`). The PR body quotes api 92.1 % and worker 98.7 %. Tooling is reported, not gated.
- **R6, done in this PR.** The tooling final stage is `debian:trixie-slim` plus the node binary. The D-TASK014-13 V8-header allow-list entry is deleted, and a unit test pins that every Node final stage is debian.

**(c) R1-m1 / SEC-02 preflight.** Closed.
- **(a) argv.**
  - `entrypoint.sh` passes `-- "$@"`, and `argvAfterSeparator` takes everything after the first `--`.
  - Hardened means exactly one argument matching `^dist/[A-Za-z0-9_][A-Za-z0-9/_.-]*\.js$`, no leading `-`, and no `..` segment. Otherwise the issue key is `CMD` only and the exit is 78.
  - A user CMD that itself starts with `--` has length 2 and is refused.
  - `PREFLIGHT_NODE_OPTIONS` is always overwritten by the entrypoint (`"${NODE_OPTIONS-}"`) and unset before `exec`, so a task definition cannot pre-seed a benign value.
  - The stack row `[R1-m1] [PR39-SEC-02 (a)]` (api and worker → 78) is green.
- **(b) ECS second signal.** `isHardenedPreflightEnv` returns false only for local/test **and** no non-empty `ECS_CONTAINER_METADATA_URI[_V4]`. `checkToolingEnv` runs `localAppEnvOnEcsGuard` with the same `presentEcsMetadataKeys`.
- **(c) Trust store.**
  - `NODE_EXTRA_CA_CERTS` must equal `RDS_CA_BUNDLE_PATH`; an empty value is refused.
  - `SSL_CERT_FILE` and `SSL_CERT_DIR` are refused when present, even empty.
  - `NODE_TLS_REJECT_UNAUTHORIZED` must be unset or `1`.
- **`PG*` in tooling.** `checkToolingEnv` refuses every `PG*` name, even empty, when hardened (rule `pg.environment`). The `check-tooling-env.test.ts` CLI cases are green.

**(d) D-TASK014-24.** Correct.
- **Handler.** `installProcessErrorHandlers` (`process-errors.ts`) computes `configErrorVariable(thrown)`.
  - For a `DatabaseConfigError` it gives `DATABASE_URL`; for a `TenantTxConfigError` it gives `.variable` (`PGOPTIONS`, or the default `DB_TX_*`). Either way it writes one `runtime.config_rejected` line at `error` with `{ variable, error: name, exitCode: 78 }` (no message, path or stack) and requests exit 78.
  - Anything else keeps the fatal line and exit 1.
  - The exit is requested once, with the first error's code. A logger throw still requests the exit, inside `finally`.
- **Throw sites.** `DatabaseConfigError` comes only from pool-settings and TLS construction (`client.ts`, `db-tls.ts`). `TenantTxConfigError` comes only from `tenantTxOptionsFrom`/`assertNoSessionOptions`. All of these are start-up paths, so mapping every *uncaught* instance to 78 does not misclassify a run-time crash.
- **In-process tests.** `config-exit.test.ts` has 4 handler cases:
  - DATABASE_URL named without the path;
  - PGOPTIONS named without the value;
  - the first error decides, in both orders;
  - a logger throw still exits 78.
- **Spawned tests.** The 3 child-process cases (api and worker PGOPTIONS, api sslrootcert) run the real `main.ts` and are green locally and in evidence.
- **Composition with PR #44.** `startApi` installs the handlers (`start-api.ts:98`) before `deps.createRuntimeServices` (`:100`). A synchronous throw there rejects `startApi`. `main.ts` passes the rejection to `raiseStartupError`, which re-throws it in a microtask as an uncaught exception, and the handler maps it to 78. This is the path the spawned api cases execute.
- **Worker.** The worker calls `createRuntimeServices` at top-level await after installing the handlers. Node reports the rejected module evaluation through `uncaughtException`, and the spawned worker PGOPTIONS case proves it.
- **Preflight CLI in-process test.** `entry-preflight.test.ts` imports the CLI with a hardened `process.env` and `argv = [... '--', 'dist/main.js']`, expects `exitCode` 0 and restores the globals in `finally`. It proves the `--` split in process. The refusal path is covered only by the spawned cases (R2-n3).

**(e) D-TASK014-25.** Accepted.
- The change is a step-level `env: NODE_OPTIONS: --max-old-space-size=4096` on the Lint step only. The `npm run lint` line is unchanged, so the PR17-SEC-04 step matcher still holds, and `check-workflow-policy` passes on the head (lane A green).
- The env line is **byte-identical** to PR #42 (`96bd37a`) and PR #46 (`ad30316`). Each merge-tree shows a comment-only conflict and a single env line.
- **Union rule:** whichever merges second keeps ONE comment block and ONE `NODE_OPTIONS` line on the Lint step.

**(f) Unions pure.** Yes (R2.1).
- `check-workflow-policy` keeps the PR39-SEC-05 and PR43-SEC-04 blocks whole, plus PR40-SEC-01.
- No file is in two Jest projects.
- `package.json` keeps `test:coverage` (PR #40) and `test:stack`. The unit ignore `\.(int|api|stack)\.test\.ts$` and the `JEST_STACK` spread stay.

**(g) Docs drift (R1-m3).** It is still routed and not touched in this PR.
- DECISIONS.md routes the residual path drift and the "300 MB" wording (D-ARCH-116..118 acceptance and the PR #39 r1 entries) to TASK-282 / the architect.
- The CLAUDE.md §2 run-locally note is also routed ("the human is told").
- The branch's DECISIONS.md and STATUS.md equal the main it last merged (`d753027`).

## R2.3 Findings (round 2)

| ID | Severity | File:line | Issue | Fix |
|---|---|---|---|---|
| R2-n1 | NIT | `tests/compose/images.stack.test.ts:252-266` | The generic arm `*/dist/*/tests/*` needs at least one segment between `dist/` and `tests/`, so a `dist/tests/…` directly under a dist root is not matched (scratchpad probe). Separately, the tooling image ships `packages/{shared,authz,config}/src` and `prisma/seed` as sources, yet the find asserts `*.test.js` only; `*.test.ts` absence rests on `.dockerignore` (pinned by `check-dockerignore.test.ts`). Risk is nil today: `.dockerignore` `**/tests` and `**/*.test.ts`, the prune-dist directory rule and the preflight `cleanTree` all hold. | Add `-path '*/dist/tests/*'` to the node_modules-excluded group and `-name '*.test.ts'` to the find; re-run with the next stack run (activation PR or `imgheadroom`). |
| R2-n2 | NIT | `apps/api/src/platform/db/config-exit.ts:1-8`; `apps/api/src/start-api.ts:97,99,166-168`; `apps/worker/src/main.ts:28` | Comments are stale after D-TASK014-24. `config-exit.ts` says "both entry points call `createRuntimeServices` at the top level", but the api now calls it inside `startApi`, and the rejection is re-raised by `raiseStartupError`. The other three files say "fatal line … then exit 1", while config errors now exit 78. The entry files were deliberately left equal to main. | Route to 020-D, or to whoever next touches `start-api.ts`/`main.ts`. All these paths are under `/apps/api/src/platform/` or entry points that are security-owned, so an in-PR fix would cost a new record and evidence. Do not reopen the PR for it. |
| R2-n3 | NIT | `packages/config/src/entry-preflight.test.ts:289-303` | The in-process CLI case is positive-only. A mutant that hard-codes `process.exitCode = 0` survives in process; the spawned cases kill it. | Optional: add `argv = [..., 'entry-preflight-cli.js']` (no `--`) and expect 78. The module cache means this needs `jest.isolateModulesAsync`, or a second import with a query string. |
| R2-n4 | NIT | PR body "Sheet line → test" table | No row for sheet line 545 (D-ARCH-115). R1-M1 asked for it; the fix-cycle table does cover it. | Add a row "545 D-ARCH-115 → `images.stack` `[sheet line 543]` find (routing/tests, dist/*/tests); `prune-dist.test.ts` routing rows" to the body. Body only, no commit. |
| R1-n4 (carried) | NIT | `packages/config/src/guards.ts` vs `db-tls.ts` | Not taken: PR #42 also edits `guards.ts`. "Follow-up" has no owner. | The orchestrator names an owner (the senior-developer follow-up after PR #42 merges, or TASK-089) in STATUS ROUTED. |
| R1-n1 (carried) | NIT | `tools/docker/entrypoint.sh` | `--enable-source-maps` is always on. Routed to the perf task. | No action here. |

All round-1 items are closed or routed: R1-M1, R1-m1, R1-m2, R1-m4 (for merge), R1-n2, R1-n3, R1-n5, R1-n6, R1-n7, R1-n8 (via C2) and R1-n9 are fixed. R1-m3 is routed (TASK-282 / architect). R1-n1 and R1-n4 are carried as above.

## R2.4 Union notes (whichever merges second)

**PR #42 (TASK-025):**
1. `packages/config/src/values.test.ts:213`: `expect(GUARDS.length).toBe(15)`. Main has 12; #39 adds 2 and #42 adds 1.
2. `apps/api/src/platform/db/with-tenant-tx.ts`: the auto-merge keeps `'PGOPTIONS'` as the second argument of the session-options refusal. Keep it, because without it the exit-78 line would name `DB_TX_*`.
   - #42's admission refusal (`admission.waitMs must not exceed maxWaitMs`, merged-tree line ≈304) should pass `'DB_TENANT_ADMISSION_WAIT_MS'` as `variable`, so that `runtime.config_rejected` names the right key.
   - Add the matching `configErrorVariable` row to `config-exit.test.ts`.
3. The images already ship `packages/audit`: `apps/api/Dockerfile:23,53,60,110-111` (and the worker equivalents). Keep these lines.
   - #42 adds `@platform/audit` to the api and worker `package.json`, and code to `packages/audit/dist`.
   - The worker is at **98.7 %** of its budget, so the second merger must re-run `npm run test:stack` (at least the size cases, `[sheet line 543]` and the preflight cases) on the union and quote the shares.
4. `.github/workflows/ci.yml`: one comment block and one `NODE_OPTIONS: --max-old-space-size=4096` line on the Lint step.

**PR #46 (TASK-015 015-B, ci.yml rewrite):**
- Keep the Lint step's `run: npm run lint` byte-identical (the PR17-SEC-04 matcher) and one heap env line.
- Re-run `check-workflow-policy` on both the head and the base copy.

**PR #45 retirement (its m3):** when #39 squash-merges, `dd7a2dd` never reaches main. The commit-bound gitleaks entry is then dead and should be retired, with its description pin updated.

## R2.5 Merge conditions

1. **A security-analyst round-2 record naming `c85d5e5` (or later)**, so that the scans step turns green. This is the only red lane A step.
2. No further code change is needed for this verdict. R2-n1..n4 are optional, or routed as stated. A change to any owned path would need a new record and evidence.
3. If main gains a non-docs change before merge: merge it, then fresh lane B evidence and a stack re-run if any image input changed. Otherwise merge as is.
4. **Squash.** Intermediate commits such as `dd7a2dd` must not reach main (PR #45).
