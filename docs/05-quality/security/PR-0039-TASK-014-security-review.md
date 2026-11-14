# PR-0039 / TASK-014: hardened multi-stage images and the Docker Compose skeleton (round 1)

| Field | Value |
|---|---|
| PR | #39 `feat(infra): hardened images and compose skeleton (TASK-014)`, https://github.com/sukhchdit/shipcube/pull/39, branch `feat/TASK-014-hardened-multi-stage-images-docker`. 34 commits `3390555..894c72e` (four merges of `main`), 143 files. |
| Head | 894c72e4afec04af63c6274b67f663b5894e0129 |
| Base | Merge base `339055558dba8d411e023ed7064918edd323229c`. `main` was at `ff9673c` when this round was written; it changed only `docs/` and `.claude/` since the merge base, and `tools/ci` and `.github` are identical. |
| Lane A evidence | Run [43547497834](https://github.com/sukhchdit/shipcube/actions/runs/43547497834) on `894c72e`. `fast-lane` **success**, every step executed (install flags, lockfile provenance, cooldown, licences, signatures, audit + osv, lane B evidence check, deps:rebuild, commitlint, lint, format, actionlint, type-check, unit, negative fixtures, build, both porcelain gates). `scans`: Gitleaks success, Semgrep success, oasdiff success; the only failing step is "Security-owned paths need a review record" (33 owned paths, no record). |
| Lane B evidence | `docs/05-quality/tests/runs/20261114T0223Z_e4c2ad5`, profile `pr`, verdict PASS: api 123, catalog-c1-c14 74, integration 263 (1 skip, SPK-03 (d)), unit 4835 (2 skip). Count-only host-fragment scan of the 7 evidence blobs: 0 hits for 8 labels (OS user, its 8.3 stem, home and temp dir in both separator forms, host name, git e-mail), positive control fired for every label. The suites `compose-up`, `image-assertions` and `trivy` are still `planned` (skipped by manifest). |
| Owned paths changed | 33 (lane A list; confirmed by the record simulation in §9). |
| Reviewer / date | security-analyst, 2026-11-14, round 1. Read-only on code: no command ran in the PR worktree; this file is the only write there. Git ran in the main checkout against commit SHAs. Docker was used only under the host-wide `docker.lock` (owner tag `sec-pr39`), to inspect the developer's existing local images with `docker run --rm --network none` and to run the pinned Gitleaks image (`--pull=never`) on a scratch directory. Nothing was built, pulled or pushed. |

## 1. Summary

TASK-014 delivers what the sheet asks for on the security-relevant lines, and most of it holds under probing.

- **Runtime images (api, worker).** They are multi-stage builds on digest pins. They run as `1000:1000`, every path under `/app` is root-owned and nothing there is group- or other-writable. `npm`, `npx`, `corepack` and `yarn` are absent, and so are the Prisma engines, the schema engine, Studio, `@prisma/dev`, `elkjs`, `typescript`, compiled tests, `routing/tests` and the query counter. This was checked with `find` inside the developer's local images (§5.1).
- **Web and admin images.** The stock `default.conf` and `50x.html` are removed, there is one server block, and the images copy `build/client` only (PR4-SEC-02/-12 closed).
- **Entrypoint preflight.** It refuses a non-allow-listed `NODE_OPTIONS` (quoted, underscore and `data:` forms included), any `PG*` variable (empty ones too), `NODE_ENV != production` and a suppressing `APP_LOG_LEVEL`, exiting 78 and naming only the variable. It runs with `NODE_OPTIONS` removed, before any application code, and both Node processes get `--disable-sigusr1`.
- **One TLS implementation (`db-tls.ts`).** The api pool, the seed and the bootstrap all use it. Every TLS mode verifies (`rejectUnauthorized: true` pinned). `no-verify`, unknown modes, `system`, relative paths and `file:` URLs are refused. The CA file is realpath-confined to two directories, opened once with `O_RDONLY|O_NONBLOCK|O_NOFOLLOW`, checked on the descriptor and read to a 1 MiB bound. Errors name the variable only.
- **PR9-SEC-15 closed.** The Prisma CLI is resolved through `createRequire(prisma/package.json)` and started with `process.execPath`; `npm_execpath` is no longer trusted.
- **Compose.**
  - Every published port binds `127.0.0.1`; the edge binds `${EDGE_BIND:-127.0.0.1}`.
  - RustFS publishes no port and its console is disabled. The store vhost forwards GET/HEAD only, adds nosniff and refuses foreign `Host` values.
  - Valkey turns `default` off and gives each service its own ACL user. Per-service env files keep the migrator, bootstrap and seed secrets out of api and worker.
  - Every secret value in the committed env files is a `local-only-*` marker.
  - tls-init deletes the local CA key right after signing.

The gaps are in the evidence and guard rails around these controls, not in the shipped runtime behaviour:

- **PR39-SEC-01 (LOW, condition C1).** The D-ARCH-115 review requirement is only partly met. The image `find` does not assert `*/routing/tests*` or a generic `*/dist/*/tests/*`, and `prune-dist.test.ts` has no `platform/routing/tests/fixture-route.js` case. The content itself is absent today (three independent layers plus my image `find`).
- **PR39-SEC-02 (LOW).** The preflight can be bypassed or misses things:
  - (a) It does not look at the command-line arguments that `entrypoint.sh` forwards to `node` (`"$@"`).
  - (b) It decides "hardened" from `APP_ENV` alone. `APP_ENV=local` on ECS skips it, and `checkToolingEnv` has the same blind spot. Config's `localAppEnvOnEcsGuard` fires only after any preload has run.
  - (c) The `NODE_EXTRA_CA_CERTS` allow-list (PR9-SEC-04 item 3, routed here) is still missing, and `--use-openssl-ca` is allow-listed with `SSL_CERT_FILE`/`SSL_CERT_DIR` unchecked.

  Probe-confirmed (§5.5).
- **PR39-SEC-03 (LOW, condition C2).** `scan-image-secrets.mjs` runs Gitleaks with its default config. Its global path allow-list skips every `node_modules/` path (and lockfiles, `*.bin` and some vendored bundles). Probe: 1 of 3 copies of a planted key is found; the two under `node_modules` are not.
  - The tooling image therefore "holds no secret" per AT-US-004-02, although it carries 50 files holding PEM private-key blocks. They are third-party test fixtures, not platform secrets.
- **PR39-SEC-04 (LOW).** The tooling image (migrator and bootstrap superuser credentials at run time) ships the whole root devDependency toolchain. That is 588 top-level packages and 347 MiB, including `typescript`, `jest`, `eslint`, `testcontainers` → `dockerode` → `ssh2`, `nock` and `@redocly/cli`. This contradicts the platform.md §3.2 invariant "no `typescript` … in any image", and no decision records the deviation.
- **PR39-SEC-05 (LOW).** The new runtime security controls are not security-owned: the four app Dockerfiles, `.dockerignore`, `compose*.yaml`, `compose.env`, `infra/**`, `tools/docker/**` (the preflight entrypoint) and `packages/config/src/{entry-preflight,node-options,db-tls,tooling-env,guards,environment}.ts`. A later PR can weaken them without a security record.
- **PR39-SEC-06 (LOW).** The 10 digest pins have no update channel: Dependabot covers only `npm` and `github-actions`. No image has a vulnerability scan yet. **Trivy ruling:** it is not needed before this merge, because the images are local-only and unpublished. It is due before lane B image-suite activation and before any image publication (§4.6).
- INFO 07 (runtime hardening residuals), 08 (Valkey ACL residuals, ready-check ruling), 09 (local-stack residuals), 10 (stack-suite evidence is not committed).

**Findings: 6 LOW, 4 INFO. Nothing Critical, High or Medium. Verdict: PASS_WITH_CONDITIONS** (§11).
- **C1 (= PR39-SEC-01) is due in this PR's fix cycle, before merge (D-ARCH-115 "merge check").** It touches only unowned test files, so it keeps this record valid (§9, scenario S4).
- **C2 (= PR39-SEC-03) is due before the lane B `image-assertions` activation, and in all cases before G3 accepts US-004.**

## 2. Method

1. **Diff and history.**
   - Read `git diff 3390555...894c72e` for every non-evidence path: 5 Dockerfiles, `.dockerignore`, `.hadolint.yaml`, `compose*.yaml`, `compose.env`, `infra/local/**`, `infra/nginx/*`, `tools/docker/**`, `tools/ci/check-docker*.mjs`, `tools/compose/**`, `tools/deps/*`, `tools/db/{bootstrap,check-tooling-env}.ts`, `packages/config/src/*`, `prisma/seed/migrator-connection.ts`, the api/worker `main.ts`, `config-exit.ts`, `with-tenant-tx.ts`, `valkey/options.ts`, `jest.config.ts`, `package.json`, the tsconfigs and every new test.
   - Read the sheet (WAVE-00 TASK-014, lines 496-553, including line 545 = D-ARCH-115) and the PR body (D-TASK014-01..17).
   - Read platform.md §3.1-§3.3, the CODEOWNERS on `main` and `.github/dependabot.yml`.
   - Read every earlier record that routes an item to TASK-014 (PR-0001, -0003, -0004, -0005, -0007, -0009, -0010, -0011, -0013, -0019, -0020, -0027, -0028, -0030, -0031, -0034, -0038; P3 review).
2. **Secret hygiene of the committed env files without reading values.**
   - A Node classifier read `compose.env` and the 8 `infra/local/env/*.env` blobs from git. It printed key names and value classes only: `local-only-*` marker, `<key-id>-vN:` + marker, `env:` / `file:` reference, URL with the password class, or plain non-secret values.
   - `.env.example`, `*.pem` and `*.key` were not opened. `.env.example` is not changed by this PR, and the tree holds no `*.pem`, `*.key`, `*.crt`, `*.p12` or `*.pfx`.
3. **Preflight behaviour probe.**
   - Built type-stripped copies of `entry-preflight.ts`, `node-options.ts`, `errors.ts` and `entry-preflight-cli.ts` from the head blobs.
   - Ran the head `tools/docker/entrypoint.sh` with only the final `exec` replaced by an argv echo, under `env -i`, over an 8-case matrix.
   - Confirmed on Node 24.22.3 that a `data:` URL given to `--import` runs before the main module in both the `NODE_OPTIONS` and the argv form.
4. **Image inspection (under `docker.lock`).**
   - Inspected the developer's local `shipcube-{api,worker,tooling,web,admin}:local` images (§5.1 gives build times and why they equal the head): `docker image inspect` (user, entrypoint, cmd, env NAMES only).
   - Ran `docker run --rm --user 0 --network none --entrypoint sh <image> -c 'find …'`: test/seam paths, secret-shaped file names, `.map` count, ownership and writability, setuid/setgid, package managers, Prisma/Studio/typescript, and the tooling-image closure (counts and names only).
5. **Gitleaks behaviour probe.**
   - Used the pinned `ghcr.io/gitleaks/gitleaks:v8.30.1@sha256:c00b6bd…`, with `--pull=never` and `--network none`, the exact flags of `gitleaksArgs()` and the default config.
   - Planted one runtime-generated AWS-shaped key id at three paths: `app/lib`, `app/node_modules/pkg` and `app/packages/x/node_modules/y`. Only counts and paths were printed; the value was never printed, and the scratch tree was deleted.
6. **Pins.** Anonymous Docker Hub registry reads (no Docker) for the 10 pins: the manifest exists, the body SHA-256 equals the digest, whether the tag has moved since the pin, and the amd64 config `created` date and user.
7. **Overlaps.** Path overlap of this PR with open PRs #40, #41 and #42 and with `main` since the merge base, plus the hunks in each overlap (§7).
8. **Record simulation.** Ran `main`'s `tools/ci/check-security-owned-paths.mjs` in a scratch `git clone --shared` over plumbing scenario commits (§9).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner / due | Status |
|---|---|---|---|---|---|---|---|
| PR39-SEC-01 | D-ARCH-115 review requirement partly met: the image `find` lacks `*/routing/tests*` and a generic `*/dist/*/tests/*`; `prune-dist.test.ts` lacks the `platform/routing/tests/fixture-route.js` case | LOW | CWE-489 | A05 | `tests/compose/images.stack.test.ts:196-238`; `tools/docker/prune-dist.test.ts:17-60` | devops, **C1: this PR's fix cycle, before merge** | Open |
| PR39-SEC-02 | Preflight leaves the pre-JS window open through (a) argv, (b) an `APP_ENV`-only hardened decision (ECS second signal ignored; `checkToolingEnv` too), (c) no CA-variable allow-list (PR9-SEC-04 item 3) | LOW | CWE-15, CWE-489, CWE-696 | A05 | `tools/docker/entrypoint.sh:13,19`; `packages/config/src/entry-preflight.ts:62-75`; `packages/config/src/tooling-env.ts:35-52` | senior-developer; recommended in this fix cycle (about 15 lines), otherwise before the first non-local deployment (M5, G4-prod) | Open |
| PR39-SEC-03 | Image secret scan is blind to `node_modules/**` (Gitleaks default global path allow-list) and to files over 10 MB; the allow-list entry is not bound to base-image layers | LOW | CWE-693 | A05 | `tools/docker/scan-image-secrets.mjs:177-179, 227-252` | devops, **C2: before lane B `image-assertions` activation; in all cases before G3 (US-004 acceptance)** | Open |
| PR39-SEC-04 | Tooling image ships the root devDependency toolchain (588 packages, 347 MiB, `typescript`, `jest`, `eslint`, `testcontainers`/`ssh2`, …; 50 PEM private-key fixture files) against the platform.md §3.2 invariant | LOW | CWE-1164, CWE-1395 | A06 | `prisma/Dockerfile:37-38, 40, 45-51, 65` | devops (prune) + principal-architect (rule on the invariant); before G3 and before the migrate image is published | Open |
| PR39-SEC-05 | New runtime security controls live in unowned paths (Dockerfiles, `.dockerignore`, compose, `infra/**`, `tools/docker/**`, the preflight and TLS modules) | LOW | CWE-284 | A05 | `.github/CODEOWNERS` (`main`) | orchestrator/devops (CODEOWNERS is owned, so its own record); before Wave-0 exit | Open |
| PR39-SEC-06 | 10 digest pins with no update channel (Dependabot: `npm` and `github-actions` only); no image vulnerability scan yet | LOW | CWE-1104, CWE-1395 | A06 | `.github/dependabot.yml:12,29`; 5 Dockerfiles; `compose.yaml` | devops; Dependabot before Wave-0 exit; Trivy per D-SEC-PR39-02 | Open |
| PR39-SEC-07 | Runtime-image hardening residuals: setuid/setgid binaries, the base image's 101-owned writable `/etc/nginx`, worker carries all of `apps/api/dist` (PR9-SEC-12), `config/dist/testing` shipped | INFO | CWE-250, CWE-732 | A05 | api/worker/tooling runtime stages; web/admin runtime stage | devops; with the ECS task definitions (M5) at the latest | Open |
| PR39-SEC-08 | Valkey ACL residuals: `SCAN` lists every key name for `api`; health-check password on the `valkey-cli` argv; PING answers during AOF load (ready check off, ruled acceptable) | INFO | CWE-200, CWE-214 | A05 | `infra/local/valkey/users.acl`; `compose.yaml:55`; `valkey/options.ts` | devops / M5 ElastiCache task | Open |
| PR39-SEC-09 | Local-stack residuals: the web/admin edge answers any `Host` (DNS rebinding reaches the local api), the `EDGE_BIND` override exposes committed local-only keys to the LAN, tls-init's `apk add openssl` is unpinned | INFO | CWE-350, CWE-1188 | A05 | `infra/local/edge/{web,admin}.conf`; `compose.yaml:127-133, 333-337` | devops (optional) | Open |
| PR39-SEC-10 | The stack suite (45/45) and the image assertions are not in committed evidence; lane B `compose-up`, `image-assertions` and `trivy` are still `planned` | INFO | n/a | n/a | `tools/quality/required-suites.json` (status `planned`) | qa-lead + devops, Wave-0-exit activation PR | Open |

## 4. Finding details

### 4.1 PR39-SEC-01 (LOW, condition C1): the D-ARCH-115 merge check is partly met

**Where.**
- `tests/compose/images.stack.test.ts:196-238`, the `[sheet line 543]` find. Its patterns are `*prisma/tests*`, `*tests/load*`, `*storage/tests*`, `spikes`, `*.test.js` and `query-counter.*`.
- `tools/docker/prune-dist.test.ts:17-60`: the `tests` case is only `modules/quotes/tests`.

**Description.** WAVE-00 line 545 (D-SEC-PR38-02, D-ARCH-115) makes three demands of this PR:
1. `prune-dist.mjs` removes `dist/**/*.test.js`, the query counter and every `dist/**/tests/` directory outside `node_modules`. **Met**: the generic `tests` directory rule at `prune-dist.mjs:56` and `TEST_SEAM` at `:43`.
2. The image `find` asserts all three. **Not met** for `routing/tests`: no `-path */routing/tests*` and no generic `-path */dist/*/tests/*`.
3. `prune-dist.test.ts` carries the `platform/routing/tests/fixture-route.js` case. **Not met.**

The architect's note says the same.

**Exploitability / impact.** None today. `apps/api/dist/platform/routing` in the local api image holds only `define-route`, `pipeline`, `route-registry`, `route-state` and `slot` (plus maps), and my wider `find` (§5.1) over api, worker and tooling found no `tests`, `fixtures`, `spikes`, `*.test.*`, `query-counter.*`, `fixture-route*` or `loopback.js` outside `node_modules`. Three layers keep them out:
- `.dockerignore` `**/tests` (the sources never reach the build stage);
- the `prune-dist` generic rule;
- the build-time `preflight.mjs` `cleanTree`, which fails the build on a `tests/` path in the app's own dist. It does not cover the worker's copy of `apps/api/dist`.

The finding is the missing regression assertion that the D-ARCH-115 line makes a merge check. The fixture route and the loopback helper are test-only route code, so a future refactor (for example a `tests` folder renamed `test-support`) would ship them silently.

**Remediation (code level).**
```ts
// tests/compose/images.stack.test.ts, inside the find pattern list (after '-name', 'query-counter.*'):
'-o', '-path', '*/routing/tests*',
'-o', '-path', '*/dist/*/tests/*',
// keep node_modules out of the generic arm so third-party test folders do not trip it:
// find / ( -path /proc -o -path '*/node_modules' ) -prune -o ( ... ) -print
```
```ts
// tools/docker/prune-dist.test.ts, it.each table:
['platform/routing/tests', true, {}, true],
['platform/routing/tests/fixture-route.js', false, {}, false], // file rule alone keeps it; the directory rule removes it
// and in the on-disk case: create dist/platform/routing/tests/fixture-route.js and loopback.js, run prune(),
// expect existsSync(join(root, 'dist/platform/routing/tests')) === false
```
Optionally, run `cleanTree` over every copied `dist` in the worker's preflight too (`apps/api/dist`).

**Verification.**
- The stack suite on the fixed head: the extended find prints nothing for all five images.
- A mutation: temporarily drop `'tests'` from `shouldRemove`'s directory list; `prune-dist.test.ts` must go red on the new case.
- Both files are unowned, so the fix commit keeps this record valid (§9, S4). The code reviewer or security confirms the two diffs in the fix cycle; no new record round is needed.

### 4.2 PR39-SEC-02 (LOW): the preflight's three open edges

**Where.**
- `tools/docker/entrypoint.sh:13` runs the preflight with only `NODE_OPTIONS` passed through.
- `:19` runs `exec node --disable-sigusr1 --enable-source-maps "$@"`.
- `packages/config/src/entry-preflight.ts:62` reads `if (env.APP_ENV === 'local' || env.APP_ENV === 'test') return [];`.
- `packages/config/src/tooling-env.ts:35-52` (`checkToolingEnv`) runs `databaseUrlParamsGuard`, `transportGuard`, `placeholderGuard` and `tlsVerificationGuard`, not `localAppEnvOnEcsGuard` (`guards.ts:184`).

**Probe** (head entrypoint and preflight, `exec` replaced by an argv echo):

| Case | Result |
|---|---|
| `APP_ENV=staging`, `NODE_OPTIONS=--inspect-wait=0.0.0.0:9229` (control) | 78, names `NODE_OPTIONS` only |
| `APP_ENV=production`, `PGOPTIONS=` (empty) | 78 |
| `APP_ENV=production`, `NODE_OPTIONS="--inspect"` (quoted) | 78 |
| (a) `APP_ENV=staging`, argv `--inspect-wait=0.0.0.0:9229 --import=data:text/javascript,… dist/main.js` | exec with both flags |
| (b) `APP_ENV=local` + `ECS_CONTAINER_METADATA_URI_V4` set + `NODE_OPTIONS=--import=data:text/javascript,…` | exec (preflight 0) |
| (c) `APP_ENV=production`, `NODE_OPTIONS=--use-openssl-ca`, `SSL_CERT_FILE=…`, `NODE_EXTRA_CA_CERTS=…` | exec |

On Node 24.22.3, `--import=data:text/javascript,…` (env or argv) printed before the main module. A `data:` preload needs no file in the read-only image.

**Description and impact.**
- (a) The ECS task-definition `command` (or a `docker run` CMD override) reaches `node` unchecked. `--inspect-wait` pauses before any JavaScript with a listener; `--import=data:` runs arbitrary code with the task role before `loadConfigOrExit`. The config's `debugGuard` sees `execArgv`, but only after the preload has run. That is PR3-SEC-13's "detects but cannot prevent", now for argv.
- (b) The preflight treats `local` and `test` as unhardened without the second signal the config uses since PR3-SEC-03 (`localAppEnvOnEcsGuard`: `APP_ENV` local or test plus an ECS metadata variable is refused). Whoever can set two task environment variables, the same privilege the preflight defends against, runs a preload. The config then refuses with exit 78, but too late.

  The same `APP_ENV`-only decision lets `checkToolingEnv` accept a plain-TCP `DATABASE_MIGRATOR_URL` or `DATABASE_BOOTSTRAP_URL` (migrator / cluster-admin credentials in clear inside the VPC) when `APP_ENV=local` is set on ECS. The tooling entrypoint also refuses no `PG*` variable. Today that is benign, because `ssl` and `options` are explicit and the URL wins, but it is inconsistent with the runtime preflight.
- (c) PR9-SEC-04 item 3 (allow-list `NODE_EXTRA_CA_CERTS` to the RDS bundle path) was routed to TASK-014 and is not implemented. With `--use-openssl-ca` allow-listed, `SSL_CERT_FILE` and `SSL_CERT_DIR` choose the trust store for every TLS client that does not pin `ca`: carriers, Stripe and Valkey. The PostgreSQL pool pins `ca` when `sslrootcert` is set, so it is unaffected.
- **Rating.** Impact H for (a) and (b) (code execution with the task role); likelihood L, because it needs write access to the task definition or its environment source, which at M5 lives in the same Terraform as the image pin. The incremental gain over that baseline is small. **LOW**, the same as PR3-SEC-13, which the preflight closes for the `NODE_OPTIONS` form. Nothing runs outside local Compose before M5.

**Remediation (code level).**
```sh
# tools/docker/entrypoint.sh: pass the argv to the preflight; keep exec unchanged
PREFLIGHT_NODE_OPTIONS="${NODE_OPTIONS-}" env -u NODE_OPTIONS node --disable-sigusr1 \
  /app/packages/config/dist/entry-preflight-cli.js -- "$@" || status=$?
```
```ts
// entry-preflight.ts
const hardened = (env: PreflightEnv): boolean =>
  !(env.APP_ENV === 'local' || env.APP_ENV === 'test') ||
  ECS_METADATA_KEYS.some((key) => (env[key] ?? '') !== ''); // same keys as localAppEnvOnEcsGuard (import from environment.ts)
export function entryPreflightIssues(env: PreflightEnv, argv: readonly string[] = []): readonly ConfigIssue[] {
  if (!hardened(env)) return [];
  // ... existing rules ...
  // argv: exactly the image's entry script, no option token
  if (argv.length !== 1 || argv[0]?.startsWith('-') || !/^dist\/main\.js$/.test(argv[0] ?? '')) {
    issues.push({ key: 'ARGV', code: 'forbidden-in-environment', rule: 'argv.entryOnly' });
  }
  // PR9-SEC-04 item 3
  const extra = env.NODE_EXTRA_CA_CERTS;
  if (extra !== undefined && !['/etc/ssl/platform/rds-global-bundle.pem'].includes(extra)) {
    issues.push({ key: 'NODE_EXTRA_CA_CERTS', code: 'forbidden-in-environment', rule: 'caBundle.allowList' });
  }
  for (const key of ['SSL_CERT_FILE', 'SSL_CERT_DIR']) if (env[key] !== undefined) issues.push({ key, code: 'forbidden-in-environment', rule: 'caStore.fixed' });
}
```
- `entry-preflight-cli.ts`: `runEntryPreflight(process.env, process.argv.slice(process.argv.indexOf('--') + 1), …)`.
- `tooling-env.ts`: compute the same `hardened` flag from `ECS_METADATA_KEYS`, and pass `{ appEnv, ecsMetadataKeys }` through `localAppEnvOnEcsGuard` in the guard list.
- `tooling-entrypoint.sh`: refuse `PG*` when hardened (reuse the preflight CLI with an empty argv check, or a two-line loop).
- Alternatively, drop `--use-openssl-ca` from `ALLOWED_NODE_OPTION_NAMES`. The runtime base carries no system CA store, so the flag has no legitimate use there.

**Verification.**
- Unit, per hardened rule: argv `['--inspect-wait=…', 'dist/main.js']` → `ARGV`; `APP_ENV=local` plus `ECS_CONTAINER_METADATA_URI_V4=x` and an `--import` `NODE_OPTIONS` → `NODE_OPTIONS`; `NODE_EXTRA_CA_CERTS=/tmp/x.pem` → refused; the RDS path is accepted; `checkToolingEnv` with `APP_ENV=local`, an ECS key and a plain URL → `APP_ENV` (`appEnv.ecsTask`).
- Stack: `docker run -e APP_ENV=staging <api> --inspect-wait=0.0.0.0:9229 dist/main.js` exits 78 within 5 s, and nothing listens on 9229.
- Mutation: remove the ECS term, and the unit case goes red.

### 4.3 PR39-SEC-03 (LOW, condition C2): the image secret scan does not look under `node_modules`

**Where.**
- `tools/docker/scan-image-secrets.mjs:227-252` (`gitleaksArgs`) runs `dir /scan --redact --ignore-gitleaks-allow --max-target-megabytes 10` with no `--config`, so Gitleaks v8.30.1's default config applies.
- That config's global `[allowlist] paths` includes `(?:^|/)node_modules(?:/.*)?$`, all lockfile names, `*.bin`, `*.exe`/`.dll`, fonts and images, and `swagger-ui*.js` / `jquery*.js` / `bootstrap*.js` bundles (`config/gitleaks.toml` at tag v8.30.1).
- `:177-179` (`BASE_IMAGE_FALSE_POSITIVES`).

**Probe.** Pinned image, exact flags, default config. One runtime-generated AWS-shaped key id at `app/lib/creds.txt`, `app/node_modules/pkg/creds.txt` and `app/packages/x/node_modules/y/creds.txt` gave **1 finding** (`aws-access-token`, `app/lib` only). The positive control fired; both `node_modules` copies were silent.

**Description and impact.**
- In the api and worker images most bytes sit under `/app/node_modules`. In the tooling image that is 347 MiB.
- AT-US-004-02 ("`%s holds no secret in any layer or in its history`", `images.stack.test.ts:125-134`) passes for the tooling image. Yet `find` in that image shows 50 files holding PEM private-key blocks under `/app/node_modules`, for example `ssh2/test/fixtures/id_rsa`, `id_rsa_enc` and `https_key.pem`. These are published test keys of third-party packages, not platform secrets (PR39-SEC-04 removes them), but the scan cannot tell, because it never looks.
- A platform secret that lands under `node_modules` would pass in the same way, as would a file larger than 10 MB. Examples: a mistaken `COPY` of a workspace folder with a local credential file into a package directory, or a build cache written during `deps:rebuild`.
- Impact H if it happened; likelihood L, because nothing in the current Dockerfiles writes there besides `npm ci`. **LOW.** It is a condition because the US-004 acceptance evidence over-states its coverage.

**Remediation (code level).**
1. Scan `node_modules` too, without dropping the default rules. The simplest way is to rename the path segment while unpacking, so the default path allow-list cannot match:
   ```js
   // unpackLayer(): after confinedPath()
   const scanned = relative.split('/').map((part) => (part === 'node_modules' ? 'node_modules.scan' : part)).join('/');
   const target = join(dir, ...scanned.split('/'));
   // gitleaksFindings(): map the reported path back (…/node_modules.scan/… -> …/node_modules/…)
   ```
   Alternatively, mount a pinned copy of the v8.30.1 default config with the `node_modules` and lockfile entries removed (`--config /cfg/gitleaks.toml`, with a unit test that diffs it against the upstream file at that tag except those lines).
2. Triage the third-party hits once, into an exact list bound to the BASE or DEPENDENCY LAYER DIGEST plus path plus rule, never a prefix alone. Removing them through PR39-SEC-04 is better than listing them.
3. Bind the existing `/usr/local/include/node/` entry to the pinned node base image's layer digests (or `layer < <base layer count>`), so a later layer that adds a file under that prefix is still reported. **D-TASK014-13 is accepted on that basis** (§10, D-SEC-PR39-04).
4. Replace `--max-target-megabytes 10` with a larger bound plus a report of every skipped file over the bound by path and size, or scan large files with the history-pattern regexes in Node.
5. On a Windows host, two layer members that differ only in case overwrite each other in the unpack directory. Detect the collision (a lower-cased path set) and fail with exit 2.

**Verification.**
- Extend the `[AT-US-004-02]` positive-control test: add `COPY creds.txt /app/node_modules/x/creds.txt` (and a nested workspace `node_modules`) to the probe image. The scan must name both paths.
- A second probe layer that adds a file under `/usr/local/include/node/` must be reported, because it is not a base layer.
- The five real images then report either 0 findings or only exact, reviewed entries.

### 4.4 PR39-SEC-04 (LOW): the tooling image carries the root dev toolchain

**Where.**
- `prisma/Dockerfile:37-38` runs `npm ci --ignore-scripts --no-audit --include=dev --workspace=prisma --include-workspace-root`, which installs all 42 root devDependencies and their closure.
- `:45-51`: only `prune-migrate-image.mjs` (Studio and `@prisma/dev`) and `prune-dist.mjs --node-modules` run. `prune-deps.mjs` is copied in at `:40` but never run.
- `:65` copies the whole `/out/` tree.

**Observed in `shipcube-tooling:local` (§5.1).**
- 588 top-level `node_modules` entries, 347 MiB.
- Present: `typescript`, `jest`, `eslint`, `prettier`, `stylelint`, `@swc/core`, `jsdom`, `supertest`, `nock`, `testcontainers`, `dockerode`, `ssh2`, `@redocly/cli` and `@commitlint/cli`, besides the needed `tsx`, `esbuild`, `prisma`, `@prisma/client` and `pg`.
- 50 files with PEM private-key blocks under `node_modules` (third-party fixtures).
- `ssh2` 1.17.0 is a `dev` lockfile entry, reached through `testcontainers` → `dockerode` → `docker-modem`.

**Description and impact.**
- platform.md §3.2 lists the image invariant "no `typescript` and no `src/*.ts` of workspace packages in any image".
- D-TASK014-01 and sheet line 533 justify `tsx` plus the `@platform/source` sources for the seed. Nothing justifies the rest of the toolchain, and the image-invariant test does not check the tooling image.
- The image runs the bootstrap (cluster superuser) and migrate/seed (`platform_migrator`, the DB owner). The extra code is not loaded by the entrypoint, so there is no direct execution path. But it multiplies the vulnerable-component surface (any advisory in that tree will fail the release Trivy gate), it carries key material that every external secret scanner will flag, and it leaves `testcontainers` and `dockerode` (Docker API clients) in an image that holds DB-owner credentials.
- Impact L-M, likelihood L. **LOW.**

**Remediation (code level).** Pick one of these; the first is closest to platform.md.
1. Compile `prisma/seed`, `tools/db/{bootstrap,check-tooling-env,scram,sql-text,shadow-init,audit-external-tables}.ts` and the `@platform/{config,authz,shared}` dist in the build stage. Install the final stage with `npm ci --omit=dev --workspace=prisma` plus the pinned `prisma` CLI (or keep the build stage's `prisma`, `@prisma/*` subtree), and drop `tsx` and the `src/` copies.
2. Keep `tsx`, but prune to an explicit root set after `deps:rebuild`:
   ```sh
   node tools/docker/prune-deps.mjs --roots tsx,prisma,@prisma/client,@prisma/adapter-pg,pg,pg-connection-string prisma
   ```
   This needs a `--roots` option in `prune-deps.mjs`, which today takes a workspace. Then add an invariant to `prune-migrate-image.mjs` `invariantViolations()`: no `typescript`, `jest`, `eslint`, `testcontainers`, `dockerode`, `ssh2` or `nock`.

Either way, principal-architect records whether `src/*.ts` in the tooling image is an accepted deviation from the §3.2 invariant (it amounts to D-TASK014-01 plus sheet line 533 "or runs a built dist").

**Verification.**
- `images.stack.test.ts` gains `[platform.md §3.2] tooling holds no dev toolchain`: `find /app/node_modules -maxdepth 2 -name package.json -path '*/typescript/*' -o …` prints nothing, and `grep -rl 'PRIVATE KEY-----' /app/node_modules | wc -l` is 0.
- `prisma-version`, `migrate` and `seed` still pass in the stack suite.

### 4.5 PR39-SEC-05 (LOW): the new controls are not security-owned

**Where.** `.github/CODEOWNERS` on `main`. Owned among this PR's paths: `prisma/**` (so `prisma/Dockerfile`), `tools/ci/**`, `tools/db/**`, `tools/deps/**`, `apps/api/src/platform/**`, `package.json`, `jest.config.ts`, tsconfigs and `.prettierignore`. **Unowned:**
- `apps/{api,worker,web,admin}/Dockerfile`, `.dockerignore`, `.hadolint.yaml`;
- `compose.yaml`, `compose.debug.yaml`, `compose.env`;
- `infra/**`: the edge's `X-Mock-Scenario` strip, its log format, the store vhost, the Valkey ACL, tls-init and the env files;
- `tools/docker/**`: `entrypoint.sh`, the only pre-JS gate; `scan-image-secrets.mjs` and its allow-list; `prune-dist.mjs`, which removes the test seams; `healthcheck.mjs`; `preflight.mjs`;
- `tools/compose/**`, `tests/compose/**`;
- `packages/config/src/{entry-preflight,node-options,db-tls,tooling-env,guards,environment}.ts`.

**Description and impact.** A later PR could do any of the following and pass lane A with no security record:
- drop `ENTRYPOINT ["/app/entrypoint.sh"]` or the preflight line;
- add a prefix to `BASE_IMAGE_FALSE_POSITIVES`;
- remove `default off` or widen `+@all -@dangerous` in the ACL;
- forward `X-Mock-Scenario` unconditionally;
- set `EDGE_BIND` to `0.0.0.0`;
- loosen `DATABASE_CA_DIRECTORIES`.

`check-dockerfiles.mjs` (owned, and run against the real Dockerfiles by a lane A unit test) catches only USER, digest, HEALTHCHECK, node flags, COPY, install flags, secret-like names, telemetry ENV and NODE_ENV. Likelihood L, impact M. **LOW.** This repeats the TASK-014 hand-over note of PR #10 ("consider Dockerfiles under CODEOWNERS") and the class of PR30-SEC-08 and PR38-SEC-06.

**Remediation.** Add to `.github/CODEOWNERS` (this edit is owned, so it needs its own record):
```
/apps/*/Dockerfile                        @sukhchdit
/.dockerignore                            @sukhchdit
/.hadolint.yaml                           @sukhchdit
/compose*.yaml                            @sukhchdit
/compose.env                              @sukhchdit
/infra/                                   @sukhchdit
/tools/docker/                            @sukhchdit
/tools/compose/                           @sukhchdit
/packages/config/src/entry-preflight.ts   @sukhchdit
/packages/config/src/node-options.ts      @sukhchdit
/packages/config/src/db-tls.ts            @sukhchdit
/packages/config/src/tooling-env.ts       @sukhchdit
/packages/config/src/guards.ts            @sukhchdit
/packages/config/src/environment.ts       @sukhchdit
```
Optionally add a `check-dockerfiles` rule `entrypoint`: the final stage of `NODE_SERVICE_DOCKERFILES` has `ENTRYPOINT ["/app/entrypoint.sh"]`, and `COPY --chmod=0555 tools/docker/entrypoint.sh /app/entrypoint.sh` is present.

**Verification.** `check-security-owned-paths` on a scenario commit that edits only `tools/docker/entrypoint.sh` reports `missing` (today it reports `not-required`). A `check-dockerfiles.test.ts` case that removes the ENTRYPOINT line fails.

### 4.6 PR39-SEC-06 (LOW): pins without an update channel; the Trivy ruling

**Where.** `.github/dependabot.yml:12` (`npm`) and `:29` (`github-actions`) are the only ecosystems. The pins are in the 5 Dockerfiles (`node:24.22.3-trixie-slim`, `debian:trixie-slim`, `nginxinc/nginx-unprivileged:1.31.7-alpine-slim`), in `compose.yaml` (`postgres:18`, `valkey/valkey:8.1-alpine`, `rustfs/rustfs:1.0.4`, `amazon/aws-cli:2.36.0`, `axllent/mailpit:v1.33`, `alpine:3.24`) and in `.hadolint.yaml` (`hadolint/hadolint:v2.15.0`).

**Facts (registry, 2026-11-14).**
- All 10 digests resolve, and each body's SHA-256 equals its digest.
- 9 tags still point at the pinned digest; `postgres:18` has moved, as a rolling tag does.
- amd64 `created`:
  - node 2026-11-11, debian 2026-11-04, nginx-unprivileged 2026-10-19;
  - postgres 2026-11-05, valkey 2026-10-27, rustfs 2026-10-25;
  - aws-cli 2026-07-16, mailpit 2026-11-07, alpine 2026-11-05, hadolint 2026-07-30.

The pins are fresh today. The problem is the next CVE: nothing proposes a bump.

**D-TASK014-02 coupling.** The api/worker runtime is `debian:trixie-slim` plus the node binary copied from `node:24.22.3-trixie-slim`. That is two pins that must move together: the binary links against the runtime's glibc and libstdc++. Security has no objection to the base itself: it removes npm and corepack from the runtime, which is better than platform.md's `node:24-*-slim`. Note that the build-time `node --version` already proves the binary loads.

**Trivy ruling.** The images are local-only this run. Nothing pushes them to a registry before TASK-119, and CLOUD_BUDGET = 0. A Trivy run is therefore **not required before this merge**. It is required:
- before lane B activates `image-assertions` and `compose-up` at Wave-0 exit (`trivy` joins the same activation);
- before any image is published (TASK-119);
- in G3 evidence.

The first run covers the 5 built images and the 7 third-party runtime pins, with severity HIGH and CRITICAL plus the secret and licence scanners.

**Remediation.**
```yaml
# .github/dependabot.yml
  - package-ecosystem: docker
    directories: [/apps/api, /apps/worker, /apps/web, /apps/admin, /prisma]
    schedule: { interval: weekly }
    groups: { node-runtime: { patterns: ['node', 'debian'] } }   # D-TASK014-02: bump together
  - package-ecosystem: docker-compose
    directory: /
    schedule: { interval: weekly }
```
Add a lane A test asserting that the Debian codename of the node base tag (`trixie`) equals the runtime base tag.

**Verification.** The first Dependabot run opens docker PRs. `check-workflow-policy` and lane A accept them. The test fails if the node tag says `bookworm` while the runtime says `trixie`.

### 4.7 PR39-SEC-07 (INFO): runtime-image hardening residuals

- **setuid/setgid.** 11 setuid/setgid binaries are present in api, worker and tooling: `su`, `mount`, `umount`, `passwd`, `chsh`, `chfn`, `newgrp`, `gpasswd`, `chage`, `expiry`, `unix_chkpwd`. Compose's `no-new-privileges:true` neutralises them; ECS needs `dockerSecurityOptions: ["no-new-privileges"]` (EC2 launch type). Fix in the runtime stage: `RUN find / -xdev -perm /6000 -type f -exec chmod a-s {} +` (CIS Docker 4.8).
- **web/admin.** `/etc/nginx`, `/etc/nginx/conf.d`, `nginx.conf`, `mime.types`, `*_params` and `modules` are owned by `nginx` (101) and group-writable, inherited from `nginx-unprivileged`. The rendered `web.conf` and `admin.conf` are root-owned 0644. Compose's `read_only: true` neutralises this; ECS must set `readonlyRootFilesystem: true` (platform.md §3.3). Fix in the existing `USER 0` step: `chown -R root:root /etc/nginx && chmod -R go-w /etc/nginx`.
- **Worker image.** It copies all of `apps/api/dist`: routes, the OpenAPI serving code, `app.js` (PR9-SEC-12, still open, INFO). It also skips `cleanTree` for that copy (PR39-SEC-01).
- **`packages/config/dist/testing`.** It ships in api and worker. The random-key builders are harmless, but they are test code: prune `dist/testing` there, or move the subpath to a test-only package.
- **Source maps.** 132 (api) and 136 (worker) `.js.map` files outside `node_modules`, without `sourcesContent`. They are used by `--enable-source-maps`; no action.

### 4.8 PR39-SEC-08 (INFO): Valkey ACL residuals and the ready-check ruling

- **Ruling on D-TASK014-12.** Disabling the ioredis ready check (`enableReadyCheck: false`) is **accepted**. Granting `+info` to `api` would expose server, memory, client and keyspace details to the internet-facing service. The worker keeps `+info` for BullMQ.

  Side effect: Valkey answers `PING` while it loads the AOF, so readiness can report ready while data commands still fail with `LOADING` (fail-closed errors, not a security issue). Optionally, add an `EXISTS cache:readiness-probe` to the readiness check.
- **`SCAN`.** It is not in `@dangerous` and is not filtered by key patterns. `api` can therefore list every key name, including `bull:*` job and `audit:*` names, though not read the values. Check that no key name embeds personal data; at M5 consider `-scan` for `api` if no cache-invalidation path needs it.
- **Health check password.** It is on the `valkey-cli` argv (`compose.yaml:55`), visible in `/proc/<pid>/cmdline` inside the container. Use `REDISCLI_AUTH` instead: `REDISCLI_AUTH="$$REDIS_HEALTHCHECK_PASSWORD" valkey-cli --user healthcheck ping`.

### 4.9 PR39-SEC-09 (INFO): local-stack residuals

- **Any `Host`.** `web.conf` and `admin.conf` use `server_name _` as `default_server`, so a DNS-rebinding page served as `attacker.example:8080` reaches the local api with the committed demo credentials. The store vhost already refuses foreign hosts with a `default_server` 403; give the web and admin servers the same pattern (`server_name localhost 127.0.0.1;`, plus a `default_server` that returns 421).
- **`EDGE_BIND`.** `EDGE_BIND=0.0.0.0` publishes a stack whose JWT, CSRF and seed secrets are committed `local-only-*` values: token forging from the LAN. Add a one-line warning to the compose comment and the developer docs (TASK-282).
- **tls-init.** `apk add --no-cache openssl` takes whatever the Alpine 3.24 repository serves at build time. It is local-only and runs once, so it is not reproducible but low risk. Pin `openssl=<version>` (already listed in the PR's open items).
- **Edge rate limit.** The edge has no rate limit on `/health/ready`, which does per-request dependency I/O (PR9-SEC-08). It stays with the M5 ALB/WAF tasks.

### 4.10 PR39-SEC-10 (INFO): the stack evidence is not committed

The gate table's stack suite (45/45 on `c425093`), the image sizes, the find check and the in-container preflight results come from a local run with no committed artifact. Lane B lists `compose-up`, `image-assertions` and `trivy` as `planned`. The activation PR (qa-lead + devops) must give them runner entries (`npm run test:stack`) and the D-SEC-PR23-02 evidence statements, and include PR39-SEC-01, -03 and -04 in the assertions. My §5.1 inspection stands in for this round only.

## 5. Focus areas checked

### 5.1 Container hardening (code plus the developer's local images)

**Which images.**
- `shipcube-api:local` and `shipcube-worker:local` were created 2026-11-14 01:44:53Z and `shipcube-tooling:local` 01:43:36Z. `c425093` was committed at 01:42:27Z, and `c425093..894c72e` changes only `apps/api/src/platform/db/config-exit.test.ts` and `docs/`. Both are outside the build context (`.dockerignore` `**/*.test.ts`, `docs`).
- `shipcube-web:local` and `shipcube-admin:local` were created 2026-11-13 20:37:24Z, after `a8d18e8`. `git diff a8d18e8 894c72e -- apps/{web,admin}/Dockerfile infra/nginx` is empty.

The nginx-level facts below therefore hold for the head. The web/admin bundles were not compared.

| Check | api | worker | tooling | web / admin |
|---|---|---|---|---|
| `Config.User` | `1000:1000` | `1000:1000` | `1000:1000` | `101` |
| Entrypoint / cmd | `/app/entrypoint.sh` / `dist/main.js` | same | `tooling-entrypoint.sh` / `prisma-version` | `/docker-entrypoint.sh` / nginx |
| Env names | `PATH NODE_ENV CHECKPOINT_DISABLE SCARF_ANALYTICS` | same | node base + `PRISMA_SCHEMA_ENGINE_BINARY` | nginx base |
| `/app` owned by non-root / group- or other-writable | none / none | none / none | none / none | n/a (`/etc/nginx` 101-owned, group-writable: §4.7) |
| Test or seam paths outside `node_modules` (`tests`, `fixtures`, `__fixtures__`, `spikes`, `*/routing/tests*`, `*/dist/*/tests*`, `*.test.js`, `*.test.ts`, `query-counter.*`, `fixture-route*`, `loopback.js`) | none | none | none | none |
| Secret-shaped names (`.env*`, `*.pem`, `*.key`, `.git`, `.npmrc`, `id_rsa*`, `*.p12`, `.claude`, `compose.env`) | none | none | `/app/.npmrc` (registry pin), npm's own `.npmrc`, `ssh2` fixture keys (§4.4) | CA bundle `/etc/ssl/cert.pem` only |
| Prisma engines, `schema-engine*`, Studio, `@prisma/dev`, `elkjs`, `prisma/generated`, `typescript` | none | none | engine (verified), stubs `0.0.0-removed`, `typescript` (§4.4) | none |
| Package managers | `apt`, `dpkg` only (no npm, npx, corepack, yarn) | same | `npm`, `npx`, `corepack`, `yarn` (node base) | `apk`, `wget` |
| setuid/setgid | 11 (§4.7) | 11 | 11 | none |

Other checks:
- **Code.** `read_only`, `init`, `cap_drop: ALL` and `no-new-privileges` are set for api and worker in `compose.yaml` (lane A asserts read-only, init and tmpfs). `HEALTHCHECK` strips `NODE_OPTIONS`. The build-time preflight runs as uid 1000 and imports every dist module without `--conditions`. The `check-dockerfiles` rules (owned, lane A) pass on all 5 Dockerfiles.
- **`.dockerignore`.** Sheet line 543 is met. The in-house matcher (`check-dockerignore.mjs`, 80 lines) mirrors moby's parent-match and last-match-wins semantics. It keeps `.npmrc`, `openapi.yaml` and `prisma/client/tsconfig.json` visible and hides `.claude/settings.json` (PR28-SEC-03 item 6). Residual note: the build stages `COPY` whole folders (`apps/api/`, `prisma/seed/` straight into the tooling image), so a stray untracked local file in those folders would enter a locally built image. An allow-list `.dockerignore` (`*` plus re-includes) would close that. INFO, no ID; CI builds come from clean checkouts.
- **Base choice (D-TASK014-02).** No security objection (§4.6).

### 5.2 Secrets handling

- **Env files** (`compose.env`, `infra/local/env/{api,worker,tooling,seed,bootstrap,postgres,redis,rustfs}.env`). Every value is one of:
  - a `local-only-*` marker;
  - a key value of the form `<key-id>-v1:` plus a marker (11 api/worker keys, 8 shared keys);
  - an `env:` reference (`STORAGE_*_REF`);
  - a `file:` sink;
  - a URL whose password is a marker;
  - a plain non-secret setting.

  The partition holds: `DATABASE_MIGRATOR_URL` only in `tooling.env` (migrate, seed), `DATABASE_BOOTSTRAP_URL` and `BOOTSTRAP_*` only in `bootstrap.env`, `SEED_*` only in `seed.env`, `AUDIT_ANCHOR_SIGNING_KEY` only in `worker.env`, `JWT_SIGNING_KEYS` only in `api.env`, with per-service Valkey users. `tools/config/compose-env.test.ts` pins all of this in lane A. Carrier and Stripe credentials are passed by name from the host environment only.
- **`.env.example`.** Not changed by this PR, and not opened.
- **Demo and role passwords.** They come from the env files (markers of 28-38 characters). The bootstrap turns the role passwords into client-side SCRAM verifiers (PR5-SEC-01). The PR5 note "≥ 32 characters from a generator" stays an M5 secret-generation item.
- **Valkey ACL users.** SHA-256 verifiers in `users.acl`; lane A checks that they hash the env-file passwords.
- **RustFS.** Its root credentials equal the values the api's `STORAGE_*_REF` resolve to (lane A test).
- **tls-init.** The CA key lives only in a `mktemp -d` under the container's tmpfs `/tmp` and is removed by an EXIT trap. The leaf key is created there, copied into the `edgecerts` volume with `umask 077`, `chmod 0400`, `chown 101:101` and an atomic `mv`. The edge mounts the volume read-only. No key or certificate is committed: there are no key files in the tree, `.dockerignore` excludes `*.pem` and `*.key`, and a lane A test asserts it.
- **D-TASK014-13 allow-list.** Accepted, with the layer binding of §4.3 item 3.
- **History scan.** `HISTORY_RULES` covers private keys, AWS ids, Stripe keys, GitHub and npm tokens, URL credentials and secret-named assignments. `check-dockerfiles` `secret-name` refuses secret-like `ARG`/`ENV` names.

### 5.3 Network exposure

- Published ports, all on `127.0.0.1`:
  - postgres `5432`, redis `6379`, mailpit `1025` and `8025` (host ports configurable);
  - edge `8080`, `8443`, `8444` and `9000` on `${EDGE_BIND:-127.0.0.1}`.

  api, worker, rustfs, web and admin publish none. `compose.debug.yaml` adds api `3000`, worker `9464` and RustFS `9002`, all on `127.0.0.1`. Lane A (`compose-stack.test.ts`) and the stack test `[SEC-TC-34]` assert this. SEC-P3-20 is closed.
- **Store vhost.** A `default_server` on 9000 returns 403 with nosniff. `server_name localhost` forwards GET and HEAD only (others 405); `Host` is passed through unchanged (`$http_host`), `client_max_body_size 1k`, nosniff `always`. RustFS has `RUSTFS_CONSOLE_ENABLE=false`, no host port and `cap_drop: ALL`. The stack test covers pre-signed GET 200 with type, disposition and nosniff, PUT and DELETE 403/405, and a foreign Host 403.
- **Edge (web and admin).**
  - `server_tokens off`; the JSON access log uses `$uri` (no query string, no Cookie or Authorization).
  - `/metrics` returns 404; `X-Forwarded-For` is appended and the api trusts one hop.
  - `X-Mock-Scenario` is replaced through `proxy_set_header`, so every client copy is dropped unless `EDGE_APP_ENV=local`. An unset `EDGE_APP_ENV` renders a non-`local` literal, which is fail-closed.

  SEC-P3-21 item 1 is closed for local, and SEC-P3-23 (TASK-014 part) is closed. Residual: §4.9 (Host).
- **Mailpit.** UI and SMTP on `127.0.0.1` only, unauthenticated by design (local), `read_only`, `cap_drop: ALL`.

### 5.4 TLS (`packages/config/src/db-tls.ts`)

`databaseConnectionSettings` applies the allow-list `{sslmode, sslrootcert, sslnegotiation}` (each name at most once, compared percent-decoded) and hands `pg` the URL without its query string plus an explicit `ssl`:
- `false`;
- or `{ rejectUnauthorized: true, ca? }`.

So `PGSSLMODE`, URL-derived TLS and `NODE_TLS_REJECT_UNAUTHORIZED=0` cannot change it.

`readRootCertificate`:
- refuses an empty value, `system`, `file:` and relative paths;
- realpaths the file and requires it to lie strictly inside `/etc/ssl/certs` or `/etc/ssl/platform` (realpathed; a missing directory admits nothing; no environment override);
- opens it once with `O_RDONLY|O_NONBLOCK|O_NOFOLLOW` and checks `fstat().isFile()` on the descriptor (a FIFO or a device is refused without blocking);
- reads at most 1 MiB + 1 bytes and refuses more (a procfs file reporting size 0 is bounded by what it yields);
- produces fixed error texts with no path, value or `cause`.

`hasValidDatabaseUrlParamValues` gives exit 78 at config load for bad values. `checkToolingEnv` requires exactly one `sslmode=verify-full` in staging and production; the seed and bootstrap call it before they connect. PR9-SEC-16/-17, PR13-SEC-03 (TLS half) and PR13-SEC-09 are closed, apart from the ECS residual (§4.2 (b)).

The production seed is refused over plain TCP (D-TASK014-08), and the integration test asserts the refusal. Note that Debian's `/etc/ssl/certs/*.pem` entries are symlinks into `/usr/share/ca-certificates`, so only `ca-certificates.crt` and files in `/etc/ssl/platform` pass the confinement. That is fail-closed and fine for the RDS bundle.

### 5.5 Entrypoint preflight

The checks:
- the allow-list (9 names, canonical `--name[=value]` tokens only);
- the tokenizer, which is stricter than Node's: it splits on any whitespace, and quotes and escapes are handled the same way;
- `PG*` (case-sensitive, empty values too), `NODE_ENV`, `APP_LOG_LEVEL`;
- exit 78 with names only;
- `env -u NODE_OPTIONS`, `--disable-sigusr1` in both processes, and `exec`, so the init process forwards signals.

`PREFLIGHT_NODE_OPTIONS` cannot be pre-set to bypass the check, because the entrypoint's prefix assignment overrides it. Probe matrix and residuals: §4.2. PR3-SEC-01, PR3-SEC-13 (NODE_OPTIONS form), PR9-SEC-03, PR20-SEC-04 item 2 and PR7-SEC-02 (TASK-014 preflight part) are closed.

### 5.6 PR9-SEC-15

`prismaCliPath()` resolves `prisma/package.json` through `createRequire(<root>/prisma/package.json)`. It refuses an absolute, drive-letter or `..` `bin`, and runs `process.execPath <cli>`. Both `prisma-cli.mjs` and `rebuild.mjs` (`runner: 'prisma'`) use it. `npmCli()` takes only Node-install-relative candidates; `npm_execpath` is ignored. The integration test `prisma-cli-npm-free.int.test.ts` covers the `.npmrc` `script-shell` and `node-options` markers, with plain `npm exec` as the positive control. **Closed.**

### 5.7 Valkey

`default off resetpass resetkeys resetchannels -@all`. `api` gets `~auth:* ~rl:* ~cache:* ~carrier:* ~sse:* &sse:* +@all -@dangerous`, `worker` gets `~bull:* ~carrier:* ~audit:* ~cache:* +@all -@dangerous +info`, and `healthcheck` gets `-@all +ping`. Started with `--aclfile` (read-only mount), AOF on, `noeviction`. The stack test covers NOAUTH, the default user refused, health-check PING only, `api` refused `CONFIG` and `bull:*` and allowed `cache:*`. Ready-check ruling and residuals: §4.8.

### 5.8 Supply chain

- The 10 pins are verified (§4.6). The hadolint pin is `v2.15.0@sha256:78cefa24…`, created 2026-07-30; the tag has not moved.
- No lockfile change, no new dependency. All installs use `--ignore-scripts`; there is no `npm rebuild` and no `npx`.
- web/admin builds run offline with a manifest checksum (PR1-SEC-03 (d)). `CHECKPOINT_DISABLE` and `SCARF_ANALYTICS` are set in every Node stage (PR1-SEC-08, images).
- `--omit=dev --omit=optional` plus `prune-deps` for api/worker (PR1-SEC-04 closed for the runtime images). The tooling image: §4.4.
- Trivy ruling: §4.6.

### 5.9 CODEOWNERS

§4.5.

## 6. Earlier findings routed to TASK-014

| Item | Status after this round | Evidence |
|---|---|---|
| PR1-SEC-02 (TASK-014 part: images, SEC-TC-64 (vi)) | **Closed** | `prisma-version` with `--network none` at build and in the stack test; api/worker hold no engines (§5.1) |
| PR1-SEC-03 (d) | **Closed** | web/admin `NPM_CONFIG_OFFLINE=true` + `sha256sum -c` |
| PR1-SEC-04 (MEDIUM, devOptional in images) | **Closed for api/worker**; tooling → PR39-SEC-04 | §5.1, §4.4 |
| PR1-SEC-08 (images) | **Closed** | ENV in every Node stage |
| PR3-SEC-01 / PR3-SEC-13 | **Closed (NODE_OPTIONS form)**; argv/ECS residual → PR39-SEC-02 | §4.2 |
| PR3-SEC-06 (per-service env) | **Closed** (Compose partition plus the lane A test); runtime local keeps warnings for `dev:*` (accepted) | §5.2 |
| PR3-SEC-14 (`checkToolingEnv`) | **Closed**; ECS residual → PR39-SEC-02 (b) | §5.4 |
| PR4-SEC-02 / PR4-SEC-12 | **Closed** | Dockerfiles, test, and the image `ls` (one root-owned `web.conf`) |
| PR7-SEC-02 / PR9-SEC-03 (preflight `PG*`) | **Closed** | probe (empty `PGOPTIONS` → 78) |
| PR9-SEC-04 item 3 (`NODE_EXTRA_CA_CERTS` allow-list) | **Open** → PR39-SEC-02 (c) | probe |
| PR9-SEC-08 (readiness I/O, edge) | Open, INFO → M5 ALB/WAF | §4.9 |
| PR9-SEC-12 (worker pruning) | Open, INFO | §4.7 |
| PR9-SEC-15 | **Closed** | §5.6 |
| PR9-SEC-16 / -17 | **Closed** | §5.4 |
| PR10-SEC-06 (licences from installed manifests, "before TASK-014 images") | Open, LOW; images are not published yet, so re-route to "before the first image publication (TASK-119)" | D-SEC-PR39-06 |
| PR13-SEC-03 TLS half / PR13-SEC-09 | **Closed** | §5.4 |
| PR13-SEC-06 (ordering) | **Closed for Compose** (bootstrap → migrate → seed); the snapshot step is the M5 pipeline's | `compose.yaml` `depends_on`, lane A test |
| PR13-SEC-08 (TASK-014 part) | **Closed** | §5.2 |
| PR20-SEC-04 item 2 | **Closed** | `logLevelGuard` plus the preflight |
| PR27-SEC-01 | **Closed**; `routing/tests` assertion → PR39-SEC-01 | `.dockerignore`, matcher test, image find |
| PR28-SEC-03 item 6 | **Closed** | `.claude/settings.json` in `REQUIRED_IGNORED` |
| PR30-SEC-04 (config half) / PR30-SEC-11 (config case) | **Closed** | `credentialPairGuard`, the `STORAGE_PUBLIC_ENDPOINT` companion, tests |
| PR30-SEC-08 (b) | **Closed** | §5.3 |
| PR #34 checkpoint (`*.test.js`, `query-counter`) | **Closed** | `prune-dist` `TEST_SEAM`, image find (§5.1) |
| PR #38 TASK-014 items (D-ARCH-105, `routing/tests`, `inlineSchema`) | D-ARCH-105 **closed** (only `prisma/package.json` and `prisma/dist/client`; no `prisma/generated`); `routing/tests` → PR39-SEC-01; `inlineSchema` note unchanged (schema comments must stay public) | §5.1 |
| SEC-P3-20 / SEC-P3-21 item 1 / SEC-P3-23 (TASK-014 part) | **Closed** | §5.3 |

## 7. Sequencing and unions: what each union must preserve

- **`main`.** It has not moved outside `docs/` and `.claude/` since the merge base, so a merge of current `main` does not void this record.
- **PR #40 (TASK-015 merged coverage) overlaps on `package.json` only.** #39 adds `"test:stack": "node tools/compose/run-stack-tests.mjs"`; #40 replaces `test:coverage` with `node tools/ci/coverage-run.mjs`. The hunks are disjoint lines, so a text auto-merge is expected. Whichever PR merges second needs a merge-only security round, because both change the owned `package.json` and the merge voids the earlier head (§9, S5). That round checks:
  - `package.json` equals the three-way union exactly (both lines present, nothing else);
  - `jest.config.ts` keeps the `stack` project behind `process.env.JEST_STACK === '1'` and keeps `stack` in the unit project's `testPathIgnorePatterns`;
  - `coverage-run.mjs` never sets `JEST_STACK` and never selects `stack`, and `merged_coverage` in `tools/quality/suite-runners.json` does not list `stack`;
  - the round's head row names the PUSHED merge commit (`git ls-remote` first).
- **PR #41 (Dependabot npm group, 14 updates) overlaps on `package.json`** and changes the lockfile. If it merges first:
  - the api/worker production closure and the tooling closure change, and the worker sits at 296.0 of 300 MiB, so the stack suite (sizes, find check, `scan-image-secrets`) must be re-run on the union;
  - the merge-only round re-runs the lockfile delta script on the union.
- **PR #42 (TASK-025 audit writer) overlaps on `apps/api/src/platform/db/with-tenant-tx.ts` (owned)** and on `packages/config/src/{guards,index}.ts`, `load-config.test.ts` and `values.test.ts`. The union must keep:
  - (a) `TenantTxConfigError(message, variable)` with its second parameter, and `assertNoSessionOptions` passing `'PGOPTIONS'`;
  - (b) #42's new `resolveAdmissionOptions` throws, which should pass `'DB_TENANT_ADMISSION_WAIT_MS'` and `'DB_TENANT_MAX_CONCURRENT_TX'` instead of falling back to `'DB_TX_*'` (`config-exit.ts` then exits 78 naming the right key);
  - (c) `GUARDS` containing `credentialPairGuard`, `logLevelGuard` (#39) and `databaseGuard` (#42) together with `localAppEnvOnEcsGuard`;
  - (d) the union of the `index.ts` export lists: #39's db-tls exports, `checkToolingEnv`, `formatToolingIssues`, `DATABASE_SSLMODES`, `hasOnlyRuntimeDatabaseUrlParams` and `hasValidDatabaseUrlParamValues`, plus #42's `DB_AUDIT_LOCK_TIMEOUT_MS_*`, `DB_TENANT_*` and `defaultTenantMaxConcurrentTx`.

  Whichever merges second needs a merge-only round for `with-tenant-tx.ts`.

## 8. Checks owed (routed)

| Owner / when | Item |
|---|---|
| devops, this PR's fix cycle (**C1**) | PR39-SEC-01: extended find, `prune-dist.test.ts` case. Verified by the code reviewer or security; unowned paths, so no new record |
| senior-developer, this fix cycle (recommended) or before the first non-local deployment | PR39-SEC-02 (a)-(c), including the `checkToolingEnv` ECS term and `PG*` in the tooling entrypoint |
| devops, before lane B `image-assertions` activation; before G3 at the latest (**C2**) | PR39-SEC-03: `node_modules` scanned, layer-bound allow-list, large-file handling, a positive control under `node_modules` |
| devops + principal-architect, before G3 and before the migrate image is published | PR39-SEC-04: prune or compile the tooling image; rule on the §3.2 invariant |
| orchestrator / devops, before Wave-0 exit | PR39-SEC-05 CODEOWNERS lines (own record); optional `check-dockerfiles` `entrypoint` rule |
| devops, before Wave-0 exit; Trivy at activation and before TASK-119 publishes | PR39-SEC-06 Dependabot `docker` / `docker-compose`; the Trivy ruling |
| qa-lead + devops, Wave-0-exit activation PR | PR39-SEC-10: runner entries for `compose-up` / `image-assertions` / `trivy`, committed evidence including SEC-01/03/04 assertions |
| M5 task definitions (TASK for ECS, G4-prod) | `no-new-privileges`, `readonlyRootFilesystem`, `initProcessEnabled`; the RDS bundle at `/etc/ssl/platform`; role secrets ≥ 32 characters from a generator; PR9-SEC-08 at the ALB/WAF |
| TASK-119 | PR10-SEC-06 before the first publication; image signing and provenance; Trivy |
| Second merger of #39 / #40 / #41 / #42 | §7 merge-only checklist |

## 9. Record simulation and secret hygiene

**Setup.**
- `main`'s `tools/ci/check-security-owned-paths.mjs`, extracted with `git archive origin/main tools/ci`. It is identical at the merge base.
- A scratch `git clone --shared --no-checkout` with a sparse checkout of `.github/`, `docs/05-quality/security/` and `tools/ci/`.
- Scenario commits built with plumbing (`read-tree`, `update-index --cacheinfo`, `write-tree`, `commit-tree`). Each is checked out detached and checked with `--root <clone> --json`.
- Nothing is written to the main repository's refs or objects.

| Scenario | `--base` / `--head` / `--pr` | Expected | Result |
|---|---|---|---|
| S0: the head without this record (control) | merge base / `894c72e` / 39 | missing | missing |
| S1: this record committed on `894c72e` | merge base / S1 / 39 | pass | **pass**, 33 owned paths, satisfied by `894c72e` and this file, 0 notes |
| S2: S1 checked as PR #40 | merge base / S1 / 40 | missing | missing |
| S3: S1 plus a later edit of `package.json` (owned) | merge base / S3 / 39 | missing | missing |
| S4: S1 plus the C1 fix stand-in (`tests/compose/images.stack.test.ts`, `tools/docker/prune-dist.test.ts`) | merge base / S4 / 39 | pass | pass |
| S5: union of S1 with `main` plus a simulated PR #40 squash (`git merge-file` of the three `package.json` versions, exit 0; `merge-tree` clean; the union keeps both `test:stack` and `coverage-run.mjs`) | main+#40 / union / 39 | missing (the merge-only round of §7 is needed) | missing |
| S6: the record with its Verdict set to FAIL | merge base / S6 / 39 | missing | missing |
| S7: S1 plus a later edit that removes the preflight line from `tools/docker/entrypoint.sh` | merge base / S7 / 39 | pass (shows PR39-SEC-05) | pass |
| S8: S1 with `--base` = the current `main` tip | `ff9673c` / S1 / 39 | pass | pass |

**Secret and host hygiene of this record.**
- The pinned Gitleaks image (`--pull=never`, `--network none`, default config, dir mode, `--redact`) scanned this file beside a runtime-generated positive control: 1 finding, the control only.
- A count-only host-fragment scan (8 labels: OS user and its 8.3 stem, home and temp dir in both separator forms, host name, git e-mail; positive control ok) found 0 hits.
- The record quotes no secret value, no env-file value, no scratch path and no user name.
- Probe scratch trees were removed. `docker.lock` was released after each short hold (owner tag `sec-pr39`), and every container ran with `--rm`.

## 10. Proposed decision entries (for the orchestrator; DECISIONS.md not edited)

- **D-SEC-PR39-01 · security-analyst · PR #39 round 1 verdict.**
  - **Verdict:** PASS_WITH_CONDITIONS at `894c72e`.
  - **C1 (PR39-SEC-01):** in this PR's fix cycle, before merge (D-ARCH-115 merge check). It touches unowned test files only, so the record stays valid.
  - **C2 (PR39-SEC-03):** before lane B `image-assertions` activation, and before G3 accepts US-004.
  - **Follow-ups:** PR39-SEC-02, -04, -05 and -06 (LOW) and -07 to -10 (INFO), with the owners of §8.
  - **Reversibility:** high.
- **D-SEC-PR39-02 · Trivy.** Not required before this merge: the images are local-only and unpublished. It is required at the Wave-0-exit activation of the image suites, before any image publication (TASK-119) and in G3 evidence. The first run covers the 5 built images and the 7 third-party runtime pins, with the HIGH/CRITICAL, secret and licence scanners. Dependabot gets `docker` and `docker-compose` ecosystems, with node and debian grouped (PR39-SEC-06).
- **D-SEC-PR39-03 · ioredis ready check.** `enableReadyCheck: false` is accepted (D-TASK014-12). `INFO` stays denied to `api`, both in Compose and in the M5 ElastiCache user strings; the worker keeps `+info` for BullMQ.
- **D-SEC-PR39-04 · scan allow-list.** D-TASK014-13 (`/usr/local/include/node/` × `generic-api-key`) is accepted as an exact (prefix, rule) pair. It must be bound to the pinned node base image's layers in the PR39-SEC-03 fix.
- **D-SEC-PR39-05 · runtime base (D-TASK014-02, OI-08).** No security objection: the runtime holds no npm or corepack and keeps root-owned code. The node and debian digests move together. The architect's OI-08 confirmation is still needed for the platform.md §3.2 wording.
- **D-SEC-PR39-06 · re-routing.**
  - PR10-SEC-06 → "before the first image publication (TASK-119)".
  - PR9-SEC-12 and PR39-SEC-07 → with the ECS task definitions (M5).
  - PR9-SEC-08 → the M5 ALB/WAF task.
  - PR9-SEC-04 item 3 is merged into PR39-SEC-02 (c).
- **D-SEC-PR39-07 · unions.** The §7 checklist binds the second merger of #39 with #40, #41 or #42. Each needs a merge-only round naming the pushed merge commit.

## 11. Verdict

| Field | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium. LOW: PR39-SEC-01 (C1), -02, -03 (C2), -04, -05, -06. INFO: PR39-SEC-07, -08, -09, -10 |
| Conditions | **C1 = PR39-SEC-01**: the D-ARCH-115 image-find patterns and the `prune-dist.test.ts` case, in this PR's fix cycle before merge. **C2 = PR39-SEC-03**: the secret scan covers `node_modules`, with a layer-bound allow-list, before lane B `image-assertions` activation and before G3 |
| **Verdict** | **PASS_WITH_CONDITIONS.** No Critical or High finding is open at head `894c72e`. The runtime images, preflight, TLS, Compose exposure, Valkey ACL and secret partition hold under probing. C1 must land before merge (unowned test paths, so this record stays valid); C2 and the LOW/INFO follow-ups have owners and due points in §8 |
