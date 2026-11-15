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

---

## Delta round 2 (fix cycle 1 + unions, head c85d5e5)

| Field | Value |
|---|---|
| PR | #39, branch `feat/TASK-014-hardened-multi-stage-images-docker`, pushed at `c85d5e5` (D-ORCH-086). Code head `4d87301` (merge of `main` `d753027`); evidence commit `c85d5e5`. |
| Head | c85d5e56eefbb57f731325c50f997ccce324b4f6 |
| Base | Merge base `d753027fd215942c7318c5e509f65958db82c1c9` (lane A `RANGE_BASE`). When this round was written, `main` was at `b04d972`. Since the merge base it gained one non-docs change, PR #42 (`a082560`); see R2.13. |
| Delta since round 1 | 26 first-parent commits `894c72e..c85d5e5`: 11 branch commits (`ace8c27` round-1 record, `def2b9b`, `4a3a0d6`, `2aabee0`, `a31f94b`, `8a31d1f`, `dd7a2dd`, `a9a53e1`, `756d505`, `7edcd08`, `32d8ca8`), 4 evidence commits and 11 merges of `main` (PRs #40, #43, #44, #45, #47 and docs). |
| Owned paths changed since `894c72e` | 31 (the lane A list): `.github/{CODEOWNERS,dependabot.yml,workflows/ci.yml}`, `apps/api/src/platform/db/{config-exit,config-exit.test,with-tenant-tx}.ts`, `apps/api/src/platform/runtime/process-errors{,.test}.ts`, `package{,-lock}.json`, `packages/config/src/{entry-preflight-cli,entry-preflight,tooling-env}.ts`, `prisma/{Dockerfile,package.json}`, 5 `tools/ci` files, `tools/db/check-tooling-env.test.ts` and 11 `tools/docker` files. With the head's new CODEOWNERS lines the PR now touches 100 owned paths. |
| Lane A evidence | Run [43612304410](https://github.com/sukhchdit/shipcube/actions/runs/43612304410) on `c85d5e5` (`pull_request`). `fast-lane` **success**, every step executed: workflow policy, install flags, lockfile provenance, cooldown, licences, signatures, audit + osv, lane B evidence check (`check-evidence: PASS`), deps:rebuild, commitlint, lint (4 GB heap), format, actionlint, type-check, unit, negative fixtures, build, both porcelain gates. `scans`: Gitleaks success (67 commits, no leaks), Semgrep success, oasdiff success. The only failing step is "Security-owned paths need a review record": the round-1 record names `894c72e`, and 31 owned paths changed after it. |
| Lane B evidence | `docs/05-quality/tests/runs/20261114T1449Z_4d87301`, profile `pr`, verdict PASS, `git_dirty` false, `build_clean` true, `env_overrides` empty. api 124, catalog-c1-c14 102, integration 298, rls-cross-tenant 126, unit 5369; merged coverage 98.86 % lines / 96.47 % branches (PR body). Hygiene: R2.12. |
| Reviewer / date | security-analyst, 2026-11-15 (probes run late on 2026-11-14), delta round 2. Read-only on code. No command ran in the PR worktree: this section is the only write there, and the untracked FAIL-run directory was not touched. Git ran in the main checkout against commit SHAs. Docker was used only under the host-wide `docker.lock`, owner tag `sec-pr39r2`, in four short holds. Those holds inspected the developer's existing local images with `docker run --rm --pull=never --network none` and ran the pinned Gitleaks image with `--pull=never --network none` (probe trees, the PR range, this record). Nothing was built, pulled or pushed. |

### R2.1 Summary

Fix cycle 1 closes both conditions and every round-1 LOW. Each closure is confirmed by a probe, not only by reading:

- **C1 = PR39-SEC-01: closed.** The image `find` now pins `*/routing/tests*` and a node_modules-excluded `*/dist/*/tests/*`, and `prune-dist.test.ts` has the routing rows plus an on-disk case. My wider `find` over all 5 local images also checks `*/dist/tests*`, `*.test.ts`, `*.spec.*`, `__tests__`, `fixtures`, `fixture-route*` and `loopback.js`, and finds **0** outside node_modules.
- **C2 = PR39-SEC-03: closed.** The scanner always forces the repo-pinned `gitleaks-image.toml` (`[extend] useDefault = true`, nothing else). It renames `node_modules` and `.gitleaksignore` path segments while unpacking. Its exceptions are 7 exact `packageFile` entries, and the D-TASK014-13 node-header entry is gone. Files over 64 MiB are reported. With the pinned Gitleaks image, each of the three mechanisms is load-bearing (R2.4). The head scanner, run over the 5 local images, reports 0 findings and allows exactly the 7 entries, each once, all in the tooling image's layer 4.
- **PR39-SEC-02: closed.** A 38-case differential matrix ran the round-1 preflight, the head preflight and the api image's real `/app/entrypoint.sh`. The head and the image agree in all 38 cases, and every round-1 bypass is now refused with exit 78, naming only the key:
  - argv;
  - the ECS signal;
  - `NODE_EXTRA_CA_CERTS`;
  - `SSL_CERT_*`;
  - `NODE_TLS_REJECT_UNAUTHORIZED`;
  - `--use-openssl-ca`;
  - `--unhandled-rejections`.

  The tooling one-shots refuse `PG*` when hardened, both directly and through the real entrypoint.
- **PR39-SEC-04, -05, -06: closed.**
  - Tooling image: no `typescript` in any image, no root devDependency, 0 PEM private-key files, 67 top-level packages.
  - CODEOWNERS: 15 lines, plus `REQUIRED_CODEOWNED_PATHS` with per-line mutation tests.
  - Dependabot: `docker` (5 directories) and `docker-compose`, pinned exactly by `sec-static.test.ts`.
- **D-TASK014-24 holds.** The `runtime.config_rejected` line carries `{variable, error, exitCode}` only and never the error object, and the first error decides the exit code (8-case probe).
- **D-TASK014-25 holds.** The lint step's `NODE_OPTIONS` is the literal `--max-old-space-size=4096`; main's workflow policy accepts it and refuses preload variants.
- **Unions are pure.** 9 of the 11 merges equal `git merge-tree`. The 2 conflicted merges (`7845a76`, `399f8b8`, both in `check-workflow-policy.{mjs,test.ts}`) delete 0 lines against either parent.
- **PR45-SEC-02 is met.**
  - The range scan of `d753027..c85d5e5` with the merged config finds 0.
  - The pre-#45 config finds the 2 `dd7a2dd` hits, which is the positive control.
  - `dd7a2dd` is not an ancestor of `main`, and `756d505` is in the head.

New this round: three INFO findings, PR39-SEC-11 to -13 (R2.11). No new Critical, High, Medium or Low finding. **Verdict: PASS_WITH_FOLLOW-UPS** (R2.17).

Because PR #42 merged after this head, the union is not yet in this PR. The second merger of #39 and #42 needs a merge-only round; R2.13 gives its checklist.

### R2.2 Method

1. **Diff classification.** Every path was classified by its blobs at round-1 base, round-1 head, current base and head. That gives 23 PR paths changed since round 1, 42 new PR paths (29 evidence files and the round-1 record among them), and 3 paths now equal to `main` (both `main.ts` and `runtime/index.ts`). I then read every changed non-evidence owned path in full: the scanner, the config, the preflight, the tooling env, both entrypoints, `prisma/Dockerfile`, `prune-deps`, `check-dockerfiles`, `check-workflow-policy`, CODEOWNERS, Dependabot, `ci.yml`, `process-errors`/`config-exit`, `with-tenant-tx`, plus the PR body (D-TASK014-18..25), its three comments and the code-review twin (round 2, `APPROVED_WITH_NITS`, on `main`).
2. **Image provenance.**
   - `shipcube-{api,worker,tooling}:local` were created 10:52-10:53Z, after `ee17098` (10:32Z). `ee17098..c85d5e5` changes outside docs only `.github/workflows/ci.yml` and `tools/quality/required-suites.json`, and no build context reads either.
   - The 38-case preflight matrix shows the api image behaving exactly as the head sources do.
   - `shipcube-{web,admin}:local` are the 2026-11-13 images of round 1. Their nginx inputs and Dockerfiles are unchanged; only the bundle inputs (`packages/shared`, lockfile) changed. My web/admin checks are nginx-level and secret-scan only.
3. **Preflight differential matrix.** Type-stripped copies of round-1 and head `entry-preflight{,-cli}.ts`, `node-options.ts`, `errors.ts` and `environment.ts` were run behind each version's `entrypoint.sh`, with the final `exec` replaced by an argv echo. The same matrix also ran through the api image's real `/app/entrypoint.sh`, with real `exec` of a stub `dist/main.js`. All of it ran inside the api image, as uid 1000, with `--network none` and `env -i`, plus a sentinel value checked against stdout and stderr.
4. **Tooling env.** `check-tooling-env.ts` was run directly inside the tooling image over 7 environments, and `tooling-entrypoint.sh seed` was run end to end once (sentinel in the URL password).
5. **Images.** `find` over the 5 images: seams, `typescript`, key-named files, PEM private-key blocks, package managers, the root devDependency list and archives. The head `scan-image-secrets.mjs` was copied to scratch with one change, `--pull=never` added to `gitleaksArgs`, and run over the 5 images.
6. **Gitleaks behaviour.** The pinned image ran in `dir` mode over a scratch tree holding a runtime-generated AWS-shaped key id at 9 paths, a layer-style `.gitleaks.toml` that allows everything, and a `.gitleaksignore` holding the control file's fingerprint. Four runs: head config; no config; head config plus `--max-archive-depth 2`; head config with the ignore file renamed as the scanner renames it. Only file, line and rule were printed.
7. **PR45-SEC-02.** Lane A's exact Gitleaks command (`git` mode, `--diff-merges=first-parent`, `.git` mounted read-only) over `d753027..c85d5e5`, once with `main`'s `.gitleaks.toml` and once with the config before PR #45 (`4a60ca6^`) as the positive control. Ancestry by `git merge-base --is-ancestor`.
8. **D-TASK014-24.** The head `process-errors.ts` and `config-exit.ts` were type-stripped, with the real `DatabaseConfigError` and `TenantTxConfigError` class bodies extracted from the head. They ran over an EventEmitter source and a recording logger, in 8 cases including a look-alike error name and a throwing logger.
9. **D-TASK014-25.** `main`'s `checkWorkflow(…, { requiredGates: true })` (the base-ref copy lane A runs) over the head `ci.yml` and 6 mutants of the heap line.
10. **Lockfile.** A deep JSON diff of `package-lock.json` between `d753027` and `c85d5e5`, with a single-leaf positive control (`1735719^..1735719`).
11. **Merges.** Each merge `M` was re-derived with `git merge-tree --write-tree M^1 M^2`. For the conflicted ones I counted deleted lines against both parents.
12. **Record simulation** (R2.15). A count-only host-fragment scan covered the evidence and this record, and the pinned Gitleaks image covered the whole record.

### R2.3 Status of the round-1 findings and routed items

| ID | Round 1 | Round 2 | Evidence |
|---|---|---|---|
| PR39-SEC-01 (C1) | LOW, open | **Closed** | R2.4 (find and prune-dist rows; 0 seams in 5 images). Code review R2-n1 (`dist/tests` directly under a dist root, `*.test.ts`) is cited, not duplicated: my probe of those two patterns is 0 in every image. |
| PR39-SEC-02 | LOW, open | **Closed** | R2.5: 38-case matrix, tooling env, `--use-openssl-ca` and `--unhandled-rejections` |
| PR39-SEC-03 (C2) | LOW, open | **Closed**; INFO residuals → PR39-SEC-12 | R2.4 |
| PR39-SEC-04 | LOW, open | **Closed** | R2.6 |
| PR39-SEC-05 | LOW, open | **Closed**; `tests/compose/` → PR39-SEC-11 | R2.7 |
| PR39-SEC-06 | LOW, open | **Closed** (Dependabot). Trivy unchanged per D-SEC-PR39-02. The `dockerfile_inline` alpine pin and the hadolint pin stay manual; added to PR39-SEC-09. | R2.7 |
| PR39-SEC-07 / -08 / -09 / -10 | INFO, open | Open, unchanged (owners in §8). -09 gains the two manual pins. | n/a |
| PR9-SEC-04 item 3 | Open (merged into -02 (c)) | **Closed** | C15-C18 |
| PR3-SEC-01 / -13, argv and ECS residual | Open via -02 | **Closed** | C01-C12 |
| PR3-SEC-14, ECS residual | Open via -02 (b) | **Closed** | T2, T6 |
| D-SEC-PR39-04 (D-TASK014-13 layer binding) | Ruling | **Superseded**: the entry is deleted (D-TASK014-19). A unit test pins every Node final stage to `debian`, and the scan shows no base-layer allowance is needed. | R2.4 |

### R2.4 C1 and C2: the image find and the image secret scan

**C1.**
- `tests/compose/images.stack.test.ts:216` `[sheet line 543]` adds two arms: `-path '*/routing/tests*'` and `( -path '*/dist/*/tests/*' ! -path '*/node_modules/*' )`.
- `tools/docker/prune-dist.test.ts:23-26` adds the rows `platform/routing/tests` (directory removed) and `…/tests/fixture-route.js` (the file rule alone keeps it). Line 81 is an on-disk case: `fixture-route.js`, its `.map` and `loopback.js` go with their directory, and `define-route.js` stays.
- Over the 5 local images, my extended find printed 0 paths. Its arms are the PR's own patterns plus `*/dist/tests*`, `*.test.ts`, `*.spec.{js,ts}`, `__tests__`, `fixtures`, `__fixtures__`, `fixture-route*` and `loopback.js`.

**C2, mechanism by mechanism (pinned Gitleaks v8.30.1, `dir` mode, one runtime key id planted at each probe path).**

| Probe path (scan tree) | Head config, layer `.gitleaksignore` kept (A) | No `--config` (B) | Head config, ignore file renamed as the scanner does (D) | Head config + `--max-archive-depth 2` (C) |
|---|---|---|---|---|
| `lib/creds.txt` (control) | not reported (suppressed by the layer `.gitleaksignore`) | not reported | **reported** | not reported (ignore file kept) |
| `node_modules/x/creds.txt` | not reported (default path allow-list) | not reported | not reported | not reported |
| `node_modules.scan/x/creds.txt` | **reported** | not reported | **reported** | **reported** |
| `pkgs/y/node_modules.scan/z/creds.txt` | **reported** | not reported | **reported** | **reported** |
| `node_modules.scan/.package-lock.json` | **reported** | not reported | **reported** | **reported** |
| `node_modules.scan/x/package-lock.json` | not reported | not reported | not reported | not reported |
| `app/blob.bin`, `app/jquery-3.7.1.min.js` | not reported | not reported | not reported | not reported |
| `app/creds.txt.gz` | not reported | not reported | not reported | **reported** |

Each lever matters:
- **The forced `--config`.** B reports nothing, because without `--config` Gitleaks loads the layer's root `.gitleaks.toml`.
- **The `node_modules` segment rename.** `node_modules/x` stays silent; the renamed copy is found.
- **The `.gitleaksignore` rename.** A layer-supplied ignore file suppresses the control (A); with the ignore file renamed as the scanner does, the control is found (D).

The columns in the last three rows are residuals; see PR39-SEC-12.

**The head scanner over the developer's images** (scratch copy, only `--pull=never` added):

| Image | Exit | Findings | Allowed (reviewed entries) | Oversize |
|---|---|---|---|---|
| tooling | 0 | 0 | exactly the 7 D-TASK014-19 files (6 `effect` 3.20.0 schedule files, `prisma/build/cli.js`), each once, all `generic-api-key`, all in layer 4 | `/usr/local/bin/node` (126,891,984 bytes) reported as "skipped (known binary)" |
| api, worker | 0 | 0 | none | same node binary, reported |
| web, admin | 0 | 0 | none | none |

**Allow-list exactness.**
- `assertExactAllowList` refuses any entry without a rule and a reason, any `packageFile` that is not one normalised absolute path below `node_modules/`, and any `baseLayer` entry whose regex is not `^\/…$` without flags or that lacks sha256 diff_id lists. It runs on every scan.
- `isAllowListed` compares the rule and the full path by string equality.
- The list has no `baseLayer` entry left.
- An entry therefore masks only `generic-api-key` findings in one of 7 exact third-party files. Every other rule in those files, and every rule in every other path, still fails the scan.
- Residual: the entries are not bound to a package version, a line or a finding count, and nothing reports an entry that stops matching. That is PR39-SEC-12 (c).

**Size.** `SCAN_FILE_LIMIT_BYTES` is 64 MiB, and Gitleaks gets `--max-target-megabytes 128`, so Gitleaks never skips a file the scanner wrote. Every file over the limit is printed with its path and size. Only `/usr/local/bin/node` with ELF magic is exempt: it is reported as skipped, not silently passed. Unit test: "reports files over the size limit: known ELF binaries as skipped, anything else as a finding". Case-only collisions on this Windows host exit 2 (unit test).

### R2.5 PR39-SEC-02: preflight, tooling env and the pre-JS window

**Matrix** (exit code; the key names in the refusal):
- `APP_ENV=staging NODE_ENV=production` unless stated;
- argv after the image entrypoint;
- the three run targets are r1 (round-1 sources), the head sources, and the api image's real entrypoint.

| Case | r1 | Head sources = image | Keys named |
|---|---|---|---|
| C00 `dist/main.js` (control) | 0 | 0 | none |
| C01 `--inspect-wait=0.0.0.0:9229 dist/main.js` | 0 (bypass) | 78 | `CMD` |
| C02 `--import=data:text/javascript,… dist/main.js` | 0 (bypass) | 78 | `CMD` |
| C03 `dist/main.js --inspect` / C04 `dist/../dist/main.js` / C06 an absolute path / C07 `-- dist/main.js` / C08 no argv / C09 `-e 1` / C10 `dist/main.mjs` | 0 | 78 each | `CMD` |
| C05 `dist/other.js` (any single `dist/*.js`) | 0 | 0 | none |
| C11 `APP_ENV=local` + `ECS_CONTAINER_METADATA_URI_V4` + `NODE_OPTIONS=--import=data:…` | 0 (bypass) | 78 | `NODE_ENV`, `NODE_OPTIONS` |
| C12 `APP_ENV=local` + `ECS_CONTAINER_METADATA_URI` (v3) + argv `--inspect` | 0 (bypass) | 78 | `CMD`, `NODE_ENV` |
| C13 `APP_ENV=local` + an empty ECS variable / C14 `APP_ENV=local`, no ECS, argv flag | 0 | 0 (local by design) | none |
| C15 `NODE_EXTRA_CA_CERTS` = another path / C17 empty / C18 `/etc/ssl/platform/../platform/rds-global-bundle.pem` | 0 | 78 each | `NODE_EXTRA_CA_CERTS` |
| C16 `NODE_EXTRA_CA_CERTS=/etc/ssl/platform/rds-global-bundle.pem` | 0 | 0 | none |
| C19 `SSL_CERT_FILE=…` / C20 `SSL_CERT_DIR=` (empty) | 0 | 78 each | `SSL_CERT_FILE` / `SSL_CERT_DIR` |
| C21 `NODE_TLS_REJECT_UNAUTHORIZED=0` / C23 empty | 0 | 78 each | `NODE_TLS_REJECT_UNAUTHORIZED` |
| C22 `NODE_TLS_REJECT_UNAUTHORIZED=1` | 0 | 0 | none |
| C24 `NODE_OPTIONS=--use-openssl-ca` | 0 | 78 | `NODE_OPTIONS` |
| C25 / C26 / C36 `--unhandled-rejections=strict`, `=throw`, quoted `"…=strict"` | 0 | 0 | none |
| C27 / C28 / C29 / C30 `=warn`, `=none`, bare, `=warn-with-error-code` | 0 | 78 each | `NODE_OPTIONS` |
| C31 `NODE_OPTIONS=--import=data:…`; C32 a pre-set `PREFLIGHT_NODE_OPTIONS=` with `NODE_OPTIONS=--inspect`; C33 `PGOPTIONS=` (empty); C34 `PGSSLMODE` | 78 | 78 | `NODE_OPTIONS` / `NODE_OPTIONS` / `PGOPTIONS` / `PGSSLMODE` |
| C35 `--max-old-space-size=512`; C37 staging plus an ECS variable | 0 | 0 | none |

- The head sources and the real image agree in all 38 cases.
- No refusal printed the sentinel, a value or an argument.
- No run printed the `data:` payload's marker: the head refuses before `exec`, and the round-1 copies only echo.
- The `data:` execution itself was probe-confirmed in round 1.

**Tooling one-shots** (`check-tooling-env.ts` inside the tooling image; sentinel in the URL password, never printed):

| Case | Exit | Issues |
|---|---|---|
| T1 staging, `PGOPTIONS=` | 1 | `PGOPTIONS (forbidden-in-environment: pg.environment)` |
| T2 local + ECS v4 + `PGHOST` | 1 | `APP_ENV (…: appEnv.ecsTask)`, `PGHOST (…: pg.environment)` |
| T3 production, `PGSSLMODE` | 1 | `PGSSLMODE` |
| T4 staging, verify-full URL, no `PG*` (control) | 0 | none |
| T5 local, no ECS, `PGOPTIONS` | 0 (local by design) | none |
| T6 local + ECS v3, plain URL | 1 | `APP_ENV (…: appEnv.ecsTask)` |
| T7 `APP_ENV` unset, `PGUSER` | 1 | `APP_ENV (missing)`, `PGUSER` |
| E1 `tooling-entrypoint.sh seed`, staging, `PGOPTIONS=` (real entrypoint) | 1 | refused by `check-tooling-env` before any seed code ran |

**Residual env levers.** The code-review twin's FYI (`LD_PRELOAD`, `OPENSSL_CONF`, `NODE_V8_COVERAGE`, `NODE_REDIRECT_WARNINGS`), plus `NODE_USE_ENV_PROXY`, which I probe-confirmed, are rated in PR39-SEC-13 (INFO).

### R2.6 PR39-SEC-04: tooling closure

- **`prisma/Dockerfile`.** It runs `npm ci --include=dev --workspace=prisma` with no workspace root, then `prune-deps --dev --leaf …/@prisma/studio-core --leaf …/@prisma/dev prisma`. The final stage is `debian:trixie-slim@sha256` plus `/usr/local/bin/node` only (R6), and has no npm, npx or corepack.
- **`prune-deps`.** Optional peers are no longer edges, and emptied scope folders are removed.
- **Lockfile delta against `main`.** Exactly 1 leaf changes: `packages["prisma"].devDependencies.tsx` = `^4.23.15`. It resolves to the existing `node_modules/tsx` 4.23.15 (MIT, `dev`, no install script). The positive control saw its single leaf.
- **D-SEC-PR23-02 interim statement.** `node_modules/ajv` is 8.20.0 from `registry.npmjs.org`, and no non-`@platform` `link: true` entry exists.
- **Image facts (find).**
  - Tooling: 67 top-level packages. None of the probed root-toolchain names is present: `typescript`, `eslint` and `eslint-*`, `prettier`, `stylelint`, `jest`, `jest-*` and `@jest`, `@swc`, `@babel`, `react`, `react-dom`, the `playwright` packages, `testcontainers`, `dockerode`, `ssh2`, `nock`, `supertest`, `jsdom`, `lodash`, `@commitlint`, `@redocly`, `ts-node`. The stack test asserts its own 26-name list. Present are the expected `tsx`, `prisma`, `@prisma`, `pg` and `effect`, plus `@types` (the `prisma` workspace declares `@types/pg` as a devDependency).
  - Tooling: 0 files with a PEM private-key block under `/app`, `/usr` or `/etc`; no key-named file.
  - All 5 images: no `typescript`; no npm, npx, corepack, yarn or pnpm.
  - api and worker: 2 files contain the text `PRIVATE KEY-----`. Both are jose's PEM-parsing code (`jose/dist/webapi/lib/asn1.js`, `key/import.js`), not key material. Gitleaks' `private-key` rule does not fire on them.
- **Stack test.** `typescript` is asserted for every image (`it.each` over `IMAGES`, line 274). The root devDependency list and the PEM count are asserted for tooling (line 289).

### R2.7 PR39-SEC-05 and -06: CODEOWNERS and Dependabot

**CODEOWNERS.**
- The diff against `main` adds 15 lines:
  - 7 for `packages/config/src/{entry-preflight,entry-preflight-cli,node-options,db-tls,tooling-env,guards,environment}.ts`;
  - 8 for `/apps/*/Dockerfile`, `/.dockerignore`, `/.hadolint.yaml`, `/compose*.yaml`, `/compose.env`, `/infra/`, `/tools/docker/` and `/tools/compose/`.
- `prisma/Dockerfile` is owned through `/prisma/`.
- The same 15 entries are in `REQUIRED_CODEOWNED_PATHS` (`check-workflow-policy.mjs:1219`).
- `check-workflow-policy.test.ts` covers them:
  - each line is present;
  - deleting, commenting out or un-owning a line gives exactly one finding naming it;
  - `prisma/Dockerfile` is covered by `prisma/`;
  - 22 representative files are owned per `check-security-owned-paths.ownedPaths`.
- The lane A run proves it: "100 security-owned path(s) changed", up from 33 in round 1, because the head's lines already bind this PR.

**Dependabot.**
- `docker` covers `/apps/{api,worker,web,admin}` and `/prisma`; `docker-compose` covers `/`.
- Both run monthly, with `cooldown.default-days: 7`, `open-pull-requests-limit: 2`, one `patterns: ['*']` group each (node and debian move together, D-TASK014-23), and the `build(deps)` prefix.
- `sec-static.test.ts` pins both entries exactly and counts 4 cooldowns.
- Two pins have no update channel: the `dockerfile_inline` `FROM alpine:3.24@sha256` of `tls-init` (`compose.yaml:128`) and the hadolint pin (a comment in `.hadolint.yaml`). Both are local-only tooling, so they are added to PR39-SEC-09 (INFO). The PR body already lists the first-run checks: a digest-only `debian:trixie-slim` bump, and `compose.debug.yaml` pick-up.

### R2.8 D-TASK014-24: configuration errors exit 78 through the process-error handler

`process-errors.ts:85-92` and `config-exit.ts`:
- `configErrorVariable` is `instanceof` based. It returns `'DATABASE_URL'` for `DatabaseConfigError`, and `error.variable` for `TenantTxConfigError` (default `'DB_TX_*'`, `'PGOPTIONS'` for the session refusal).
- The config line is `log.error('runtime.config_rejected', { variable, error: <class name>, exitCode: 78 })`. The thrown object is not passed.

**Probe** (recording logger; a random sentinel in every error message):

| Case | Exit | Lines | Sentinel in what reached the logger |
|---|---|---|---|
| `DatabaseConfigError`, uncaught | 78 | 1 × `runtime.config_rejected` `{variable, error, exitCode}` | absent |
| `TenantTxConfigError(…, 'PGOPTIONS')`, unhandled rejection | 78 | same | absent |
| `TenantTxConfigError` with the default variable | 78 | same | absent |
| config error first, then a plain error | 78 | config line, then the redacting fatal line | absent |
| plain error first, then a config error | 1 | fatal line, then config line | absent |
| config error, logger throws | 78 (exit requested once) | config line attempted | absent |
| a plain `Error` whose `name` is `DatabaseConfigError` (look-alike) | 1 | fatal line (the error object goes to the redacting logger) | present (positive control) |
| plain error (control) | 1 | fatal line | present (positive control) |

The first error decides, and a look-alike `name` does not divert to 78. The config path hands the logger no value and no error object. Both entry points and `runtime/index.ts` equal `main`; the 3 child-process entry-point cases are green in lane B.

The level is `error`, not `fatal`. That is safe in hardened environments, where `logLevelGuard` and the preflight refuse `APP_LOG_LEVEL` `error`, `fatal` and `silent`, so the line always prints.

Code review R2-n2 (stale comments in `config-exit.ts`, `start-api.ts` and `main.ts`) is cited, not duplicated.

### R2.9 D-TASK014-25: the lint heap line

`ci.yml:259-260` adds a step-level `env:` with `NODE_OPTIONS: --max-old-space-size=4096`. It is a literal with no `${{ }}` expression, and `run: npm run lint` is byte-identical, so the PR17-SEC-04 matcher still matches.

`main`'s `checkWorkflow(…, { requiredGates: true })` gives:
- **head:** clean;
- **refused by `node-options-preload`:** `--require=./x.cjs`, `--import=data:…`, `-r ./x.cjs`, `--env-file=.env`;
- **accepted:** `--inspect=0.0.0.0:9229` and `${{ github.event.pull_request.title }}`.

The two accepted forms are not in this PR. They are a lexical gap of `main`'s checker: an expression whose value the PR author picks at run time, and the inspector. The impact is small, because a PR author already controls a pull-request run's code, and any such `ci.yml` edit is owned and needs a record. **Observation, routed to 015-C (next `check-workflow-policy` change):** refuse a `${{` in any `NODE_OPTIONS` value and allow-list option names as the entry preflight does. Optional; no ID.

PR #42 and PR #46 carry the same heap line (R2.13).

### R2.10 Merges and unions

| Merge | Main side | Re-derived with `git merge-tree` |
|---|---|---|
| `4ab6c10`, `d0b6f1f`, `7dd3c64`, `09a54f8`, `fb65287`, `3a2a20f`, `ee17098`, `ef195bc`, `4d87301` | docs-only `main` sides, plus #44 (`ee17098`) and #47 (`4d87301`) | clean; merge tree equal |
| `7845a76` | #40 + #45 | conflict in `check-workflow-policy.mjs`. The resolution deletes 0 lines against either parent (17 added and 0 deleted against `main`; 3 added and 0 deleted against the branch, the PR40-SEC-01 `.gitattributes` entries). Test file: 0 deletions either side. |
| `399f8b8` | #43 | conflict in `check-workflow-policy.{mjs,test.ts}`. 0 deletions against either parent; the PR43-SEC-04 entries and describe block are kept next to the PR39-SEC-05 ones. |

Net against `main` at `c85d5e5`:
- `check-workflow-policy.mjs` only adds the 15-entry PR39-SEC-05 block, placed before the PR43-SEC-04 block; 0 deletions;
- `check-workflow-policy.test.ts`: 0 deletions;
- `sec-static.test.ts` deletes exactly the 2 Dependabot expectations it updates;
- `with-tenant-tx.ts` differs only by the `variable` parameter and `'PGOPTIONS'`;
- `package.json` differs only by `test:stack`;
- `CODEOWNERS` only adds lines.

The round-1 §7 checklist for #40 is met: `test:coverage` from #40 and `test:stack` are both present, `stack` is behind `JEST_STACK`, and `stack` is not in `merged_coverage` (PR body; the `--listTests` split has no file in two projects).

### R2.11 New findings (round 2)

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner / due | Status |
|---|---|---|---|---|---|---|---|
| PR39-SEC-11 | The image-assertion tests are not security-owned: `/tests/compose/` is missing from CODEOWNERS, though it holds the C1 find, the C2 positive control, the SEC-04 closure and PEM checks and the argv stack cases | INFO | CWE-284 | A05 | `.github/CODEOWNERS:106-107` (head); `tests/compose/images.stack.test.ts:105,216,289,395` | qa-lead + devops, in the Wave-0-exit activation PR that makes the stack suites required (with PR39-SEC-10) | Open |
| PR39-SEC-12 | Image-scan residual coverage: (a) archives are not opened; (b) the rest of Gitleaks' default path allow-list still applies (lockfile names, `*.bin`, `jquery*`/`bootstrap*`/`swagger-ui*` bundles); (c) package-file entries are not bound to a version, line or count, and stale entries go unnoticed; (d) the known-binary exemption is path + ELF magic only | INFO | CWE-693 | A05 | `tools/docker/scan-image-secrets.mjs:267-283, 314-325, 336-346, 443-472` | devops, with PR39-SEC-10 (before lane B `image-assertions` activation) | Open |
| PR39-SEC-13 | Env levers outside the preflight lists: `NODE_USE_ENV_PROXY` + `HTTP(S)_PROXY` route all outbound HTTP(S) through a proxy; `LD_PRELOAD`, `OPENSSL_CONF`/`OPENSSL_MODULES` and `NODE_COMPILE_CACHE` need a planted file; `NODE_V8_COVERAGE`/`NODE_REDIRECT_WARNINGS` only write | INFO | CWE-15 | A05 | `packages/config/src/entry-preflight.ts:144-156` | devops / platform, with the M5 ECS task definitions (optional preflight deny-list) | Open |

**PR39-SEC-11 (INFO).**
- **Description.** The fix cycle owns `/tools/compose/` (the runner), but the assertions live in `tests/compose/`. A later PR could drop an arm of the `[sheet line 543]` find, the node_modules copies of the AT-US-004-02 positive control, or the tooling PEM count, and pass lane A without a security record. My round-1 remediation block omitted the folder too.
- **Impact.** The stack suites are still `planned` (PR39-SEC-10), so these tests are evidence today, not a gate.
- **Remediation.**
  ```
  # .github/CODEOWNERS (next to /tools/compose/)
  /tests/compose/                         @sukhchdit
  ```
  Add `'tests/compose/'` to `REQUIRED_CODEOWNED_PATHS`, plus a row in the PR39-SEC-05 mutation table.
- **Verification.** `check-security-owned-paths` on a scenario commit that edits only `tests/compose/images.stack.test.ts` reports `missing` (today it reports `pass` on the old record; record simulation S5).

**PR39-SEC-12 (INFO).**
- **Description, by probe.**
  - (a) A key inside `app/creds.txt.gz` is silent with the head config and found with `--max-archive-depth 2`. The images hold 2 to 5 archive files each today, all base-image or third-party: `thread-stream` test zips, a `pdfkit` `.yarn/install-state.gz`, the `confbox` licence `.gz`, the dpkg/apt `.gz`/`.xz`, and apk's `scripts.tar.gz`.
  - (b) A key in `node_modules.scan/x/package-lock.json`, `app/blob.bin` or `app/jquery-3.7.1.min.js` stays silent. The hidden `.package-lock.json` is scanned. The scanner header documents (b); the AT-US-004-02 title ("holds no secret in any layer") does not.
  - (c) An entry hides every `generic-api-key` finding in its file, in any layer, whatever the package version. After a Dependabot bump it keeps hiding that rule in the new file. If the false positive disappears, the entry lingers unnoticed (today all 7 match exactly once).
  - (d) `/usr/local/bin/node` is skipped when it starts with the ELF magic. A later layer that replaced it with an ELF-headed file carrying text would be skipped.
- **Impact.** This is a gap in a detective control (a missed detection, not an exposure). A miss would need a platform secret written into an archive or into one of those 7 files. No build step writes archives (the npm cache is a BuildKit cache mount, not a layer), and the 7 files come from lockfile-integrity-checked tarballs. INFO: the residual of an otherwise closed LOW.
- **Remediation (code level).**
  ```js
  // gitleaksArgs(): open archives (the probe found the gz member at depth 2)
  '--max-archive-depth', '2',
  // scanImage(): fail on stale entries (after all layers)
  const used = new Set(result.allowed.map((f) => `${f.rule}\0${f.file}`));
  const stale = IMAGE_SCAN_ALLOW_LIST.filter((e) => e.kind === 'package-file' && !used.has(`${e.rule}\0${e.file}`));
  // report stale entries per image (an entry list per image, or a --expect-allowed flag used by the stack test)
  ```
  - Bind each `packageFile` to the package version read from `/app/node_modules/.package-lock.json` in the same image (or to the finding's `StartLine`).
  - Pin the node binary's sha256 (taken from the pinned node image) instead of the ELF magic.
  - Name the remaining default path allow-list in the AT-US-004-02 evidence text.
- **Verification.**
  - A unit case with a gzip member, found.
  - A unit case where a listed file has no finding, which fails as stale.
  - The tooling stack scan still allows exactly 7.

**PR39-SEC-13 (INFO).**
- **Description.** The preflight refuses `NODE_OPTIONS`, argv, the CA, TLS, `PG*`, `NODE_ENV` and log-level variables. Other variables act before or outside JavaScript.
  - **`NODE_USE_ENV_PROXY=1` with `HTTPS_PROXY`/`HTTP_PROXY`.** Probe on Node 24.22.3 with a loopback listener: `fetch` and `https.get` both sent `CONNECT probe.invalid:443` to the proxy; without the variable there was no contact. TLS is still verified against Node's bundled store (no extra CA is possible after SEC-02), so the proxy sees host names and can deny service. Plain-HTTP calls go through it in clear.
  - **`LD_PRELOAD`/`LD_LIBRARY_PATH`, `OPENSSL_CONF`/`OPENSSL_MODULES` and `NODE_COMPILE_CACHE`.** They need a library, config or cache file at a path the attacker controls. `/app` is root-owned, Compose and ECS run the root filesystem read-only, and the tmpfs is empty at start. Neutralised today.
  - **`NODE_V8_COVERAGE` and `NODE_REDIRECT_WARNINGS`.** They only write files.
- **Impact.** The same privilege as round-1 SEC-02 (write access to the task environment), which already sets the configuration itself (database URL, storage endpoint). No code-execution path was found. INFO.
- **Remediation (optional, M5).** Add a hardened-only deny-list to `entryPreflightIssues`:
  ```ts
  const PRE_JS_ENV = /^(?:LD_[A-Z_]+|OPENSSL_CONF|OPENSSL_MODULES|NODE_COMPILE_CACHE|NODE_USE_ENV_PROXY|(?:HTTPS?|ALL|NO)_PROXY)$/i;
  for (const key of Object.keys(env).filter((n) => PRE_JS_ENV.test(n))) issues.push(forbidden(key, 'env.preJs'));
  ```
  Alternatively, a Terraform/OPA rule allow-listing the ECS task-definition environment names.
- **Verification.** Unit cases per name; the stack case `docker run -e APP_ENV=staging -e NODE_USE_ENV_PROXY=1 -e HTTPS_PROXY=http://127.0.0.1:9 <api> dist/main.js` exits 78.

### R2.12 PR45-SEC-02 and evidence hygiene

**PR45-SEC-02.**

| Check | Result |
|---|---|
| Lane A's Gitleaks command, `main`'s `.gitleaks.toml` (with the PR #45 entry), `--diff-merges=first-parent d753027..c85d5e5` | 67 commits scanned, **0 findings** |
| Same range, the config before PR #45 (`4a60ca6^`), positive control | 2 findings, both `dd7a2dd` `tools/docker/scan-image-secrets.mjs` lines 272-273 `generic-api-key` |
| `git merge-base --is-ancestor dd7a2dd origin/main` | exit 1: **`dd7a2dd` is not an ancestor of `main`** |
| `756d505` in the head; quoted `effect/` strings in the scanner | `756d505` is an ancestor of `c85d5e5`; 0 quoted strings at the head (2 at `dd7a2dd`) |
| A new `pull_request` event after #45 merged | Lane A run 43612304410 on `c85d5e5` (`pull_request`), Gitleaks success |

**Lane B evidence `20261114T1449Z_4d87301`.**
- **D-SEC-PR23-02 statements, verbatim, in the round-2 gate table of the PR body:**
  - "**`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first**", meaning before `quality:heavy`, in a fresh worktree;
  - "**`.git/info/exclude` is empty** (0 bytes)".

  The evidence commit message repeats "after npm ci --ignore-scripts and deps:rebuild". I checked the shared `.git/info/exclude` (the file every worktree uses): 0 bytes, 0 non-comment lines.
- **Host-fragment scan.** My count-only scan covered all 29 blobs of the 4 run directories added since round 1, with 10 labels (OS user, its 8.3 stem, home and temp dir in both separator forms, host name, git e-mail, two users-dir forms). It found 0 hits; the positive control fired for every label.
- **Committed runs.** The PR adds 9 run directories in total (5 from round 1, 4 since). All have verdict PASS and profile `pr`; no `wave` or `gate` run is committed.
- **Uncredited runs not in the tree.** None of the uncredited runs the PR body lists is committed: the FAIL runs `0546Z_756d505`, `0800Z_7845a76`, `0919Z_399f8b8`, `0959Z_fb65287` and `1135Z_ee17098`, and the unpushed `1338Z_32d8ca8`.
- **Superseded runs.** The earlier PASS runs `0448Z_d0b6f1f`, `0830Z_09a54f8` and `1202Z_ee17098` stay committed from earlier pushes. That is accepted: `check-evidence` selects by head ancestry and suites.
- **The untracked FAIL directory in the PR worktree** is untouched and is not in any commit.

### R2.13 Sequencing and unions (updates §7)

**State of `main`.** `main` gained PR #42 (`a082560`) after this head. A union preview (`git merge-tree c85d5e5 origin/main`) conflicts in `.github/workflows/ci.yml` and `packages/config/src/values.test.ts`, and auto-merges `with-tenant-tx.ts`, `guards.ts`, `index.ts`, `load-config.test.ts`, `prisma/package.json` and `package-lock.json`. The merge changes four owned paths of this PR after `c85d5e5` (`with-tenant-tx.ts`, `guards.ts`, `prisma/package.json` and `package-lock.json`), so it voids this record (simulation S8). **PR #39 is now the second merger with #42 and needs a merge-only round.**

**That round checks:**
1. **`values.test.ts`.** `expect(GUARDS.length).toBe(15)`: `main` 12, plus 2 from #39, plus 1 from #42. `GUARDS` holds all 15 by name: `localAppEnvOnEcsGuard`, `credentialPairGuard`, `logLevelGuard` (#39), `databaseGuard` (#42), `sessionGuard` and `keyMaterialGuard` among them. The auto-merged list already has 15.
2. **`with-tenant-tx.ts`.** `TenantTxConfigError(message, variable)` keeps its parameter, and the session refusal keeps `'PGOPTIONS'`. #42's admission refusal (`admission.waitMs must not exceed maxWaitMs`, merged line ≈304) and the `positiveInt('admission.*')` throws should pass `'DB_TENANT_ADMISSION_WAIT_MS'` and `'DB_TENANT_MAX_CONCURRENT_TX'`. Otherwise `runtime.config_rejected` names `DB_TX_*`. That is a mislabel, not a leak, so it is code-review R2.4 item 2, not a security condition. Add the `config-exit.test.ts` rows.
3. **`ci.yml`.** Exactly one `env:` block with one `NODE_OPTIONS: --max-old-space-size=4096` on the Lint step, and `run: npm run lint` unchanged. A duplicated `env:` key is a YAML error; actionlint and the policy must pass.
4. **`prisma/package.json` and lockfile.** Both `tsx` (#39) and `@platform/audit` (#42) are in the `prisma` devDependencies (auto-merged). Then:
   - re-run the lockfile delta against the new `main` (expected: only the `tsx` leaf);
   - confirm in the tooling image that `node_modules/@platform/audit` is absent or an unused dangling link, since `packages/audit` is not copied into the tooling final stage and only `prisma/tests` imports it;
   - confirm that `migrate`, `seed` and `prisma-version` still pass.
5. **Images and stack.** api and worker already copy `packages/audit/{package.json,dist}`; keep those lines. The worker is at 98.7 % of its budget, so re-run `npm run test:stack` on the union: sizes, `[sheet line 543]`, `[AT-US-004-02]` (tooling still exactly 7 allowed), the preflight cases. Take fresh lane B evidence with the D-SEC-PR23-02 wording.
6. **`index.ts`.** The union of the export lists: #39's db-tls, tooling-env and `DATABASE_SSLMODES`/`hasValid…` exports, plus #42's `DB_AUDIT_LOCK_TIMEOUT_MS_*`, `DB_TENANT_*` and `defaultTenantMaxConcurrentTx`.
7. **Record.** The round's `| Head |` row names the pushed union commit (`git ls-remote` first).

**PR #46 (015-B, open, needs its own union with #42 per D-ORCH-089).**
- A preview of `#39 ∪ #46` conflicts only in `ci.yml`: both add the Lint heap block.
- `check-workflow-policy.{mjs,test.ts}`, `jest.config.ts`, `package.json` and `tools/deps/rebuild.mjs` auto-merge.

Whichever of #39 and #46 merges second needs a merge-only round. It checks:
- one heap block, and `run: npm run lint` byte-identical;
- `check-workflow-policy.mjs` keeps the PR39-SEC-05, PR40-SEC-01 and PR43-SEC-04 blocks of `REQUIRED_CODEOWNED_PATHS` and #46's new rules (`gh-token`, `dispatch-only`, `playwright-install`, `scans-isolation` for `ci-gate`);
- the head and the base copy of `check-workflow-policy` both pass on the union `ci.yml`;
- `package.json` keeps `test:stack`, `test:coverage` and `ci:minutes`;
- `jest.config.ts` keeps the `stack` project behind `JEST_STACK`;
- `tools/deps/rebuild.mjs` keeps both #39's Prisma runner (`prismaArgv`, PR9-SEC-15) and #46's Playwright-redirect refusal (PR46-SEC-02).

After #46, `lane-scope.mjs` classifies #39's image paths as code: `DOCS_ONLY_PATHS` is `docs/**`, `.claude/**` and `*.md` outside code roots. A later image-only PR therefore still runs the full fast lane.

**PR #45 retirement (code review R2.4, PR #45 m3).** After #39 squash-merges and `dd7a2dd` is confirmed absent from `main`'s ancestry, the commit-bound entry may be retired by its own PR (D-SEC-PR45-01 lifetime rule).

### R2.14 Checks owed (updates §8)

| Owner / when | Item |
|---|---|
| Second merger of #39 and #42 (now: #39) | R2.13 items 1-7; merge-only security round |
| Second merger of #39 and #46 | R2.13 #46 list; merge-only security round |
| qa-lead + devops, Wave-0-exit activation PR | PR39-SEC-10 (runner entries, committed stack evidence) and PR39-SEC-11 (`/tests/compose/` owned) |
| devops, with PR39-SEC-10 | PR39-SEC-12: `--max-archive-depth`, stale-entry failure, version binding, node binary digest |
| devops, first Dependabot run | A digest-only `debian:trixie-slim` bump is proposed; `compose.debug.yaml` is picked up (PR body) |
| M5 ECS task definitions | PR39-SEC-07, the round-1 M5 list, plus PR39-SEC-13 (optional pre-JS env deny-list or a task-definition env allow-list) |
| 015-C (next `check-workflow-policy` change) | R2.9 observation: refuse `${{` and non-allow-listed options in `NODE_OPTIONS` values |
| TASK-119 / G3 | Trivy (D-SEC-PR39-02), unchanged |

### R2.15 Record simulation and secret hygiene

**Setup.**
- `main`'s `tools/ci/check-security-owned-paths.mjs` (tip `b04d972`), run as lane A runs it.
- A scratch `git clone --shared --no-checkout` with a sparse checkout of `.github/`, `docs/05-quality/security/` and `tools/ci/`.
- Scenario commits built with plumbing on `c85d5e5`, each checked out detached and checked with `--root <clone> --json`.
- Nothing is written to the main repository's refs or objects.

| Scenario | `--base` / `--head` / `--pr` | Expected | Result |
|---|---|---|---|
| S0: `c85d5e5` with the round-1 record only (control) | `d753027` / `c85d5e5` / 39 | missing (names `894c72e`, 31 changed after it) | missing: names `894c72e`, 31 owned paths changed after it |
| S1: this round appended and committed on `c85d5e5` | `d753027` / S1 / 39 | pass, satisfied by `c85d5e5` | **pass**: 100 owned paths, satisfied by `c85d5e5` (the `894c72e` row only adds a note) |
| S2: S1 with `--base` = the `main` tip | `b04d972` / S1 / 39 | pass | pass |
| S3: S1 checked as PR #40 | `d753027` / S1 / 40 | missing | missing |
| S4: S1 plus a later edit of `tools/docker/entrypoint.sh` (owned since this PR) | `d753027` / S4 / 39 | missing | missing: names `c85d5e5`, `tools/docker/entrypoint.sh` changed after it |
| S5: S1 plus a later edit of `tests/compose/images.stack.test.ts` | `d753027` / S5 / 39 | pass (shows PR39-SEC-11) | pass |
| S6: S1 with this round's verdict set to FAIL | `d753027` / S6 / 39 | missing | missing (verdict FAIL) |
| S7: S1 plus a docs-only commit | `d753027` / S7 / 39 | pass | pass |
| S8: S1 merged with `main` `b04d972` (conflicts resolved: 15 guards, `main`'s heap block) | `b04d972` / S8 / 39 | missing (the merge-only round of R2.13 is needed) | missing: names `c85d5e5`, but `with-tenant-tx.ts`, `guards.ts`, `prisma/package.json` and `package-lock.json` changed after it (99 owned paths: the union `ci.yml` equals `main`) |
| S9: S1 without this round's final verdict row (control) | `d753027` / S9 / 39 | pass on round 1's row (the procedural gap noted in PR10-SEC-04) | pass (procedural, as expected) |

**Secret and host hygiene of this section.**
- The pinned Gitleaks image (`--pull=never`, `--network none`, default config, `dir` mode, `--redact`) scanned the whole record (round 1 plus this section) beside a runtime-generated positive control: 1 finding, the control only.
- A count-only host-fragment scan of the whole record (10 labels, positive control fired) found 0 hits.
- The section quotes no secret value, no env-file value, no `effect` constant value, no scratch path and no user name.
- `docker.lock` was released after each hold (owner tag `sec-pr39r2`). Every container ran with `--rm`. The probe trees hold only runtime-generated values, and Docker never mounted the PR worktree.

### R2.16 Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

- **D-SEC-PR39-08 · security-analyst · PR #39 delta round 2 at `c85d5e5`.**
  - **Verdict:** PASS_WITH_FOLLOW-UPS.
  - **Closed:** C1 (PR39-SEC-01) and C2 (PR39-SEC-03), plus PR39-SEC-02, -04, -05 and -06 (Dependabot), PR9-SEC-04 item 3, the argv/ECS residuals of PR3-SEC-01/-13/-14, and D-SEC-PR39-04 (superseded: the node-header entry is deleted).
  - **New INFO:**
    - PR39-SEC-11, `/tests/compose/` owned in the Wave-0-exit activation PR;
    - PR39-SEC-12, image-scan residuals (archives, remaining default path allow-list, entry binding and staleness, node binary digest), devops with PR39-SEC-10;
    - PR39-SEC-13, pre-JS env deny-list, optional, M5 task definitions.
  - **PR45-SEC-02 met:** range scan 0, control 2, `dd7a2dd` not an ancestor of `main`.
  - **Unions:** PR #42 merged first, so #39's union with `main` needs a merge-only round with the R2.13 checklist (15 guards, `DB_TENANT_*` variables, one heap block, `tsx` + `@platform/audit`, stack re-run, fresh evidence). The second merger of #39 and #46 does the same for `ci.yml` and `check-workflow-policy`.
  - **Observation → 015-C:** `node-options-preload` should refuse `${{` expressions.
  - **Reversibility:** high.

### R2.17 Verdict (round 2)

| Field | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium, 0 Low open. Closed: PR39-SEC-01 (C1), -02, -03 (C2), -04, -05, -06. Open INFO: PR39-SEC-07, -08, -09, -10 (round 1) and PR39-SEC-11, -12, -13 (new) |
| Conditions | C1 and C2 closed. None open |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High, Medium or Low finding is open at head `c85d5e5`. Both conditions are closed and every round-1 LOW is fixed, each confirmed by probes on the head sources and the local images. The unions are pure, and PR45-SEC-02 is met. The INFO follow-ups have owners in R2.14. Merging current `main` (PR #42) into this branch voids this record: a merge-only round with the R2.13 checklist is required before merge |

---

## Merge-only round (union with PR #42, head ea1e010)

| Field | Value |
|---|---|
| PR | #39, branch `feat/TASK-014-hardened-multi-stage-images-docker`, pushed at `ea1e010` in one push from `c85d5e5` (PR comment 6890259994; `git ls-remote` and `gh pr view` both give `ea1e010`). Commits since `c85d5e5`: `b63fe6e` (round-2 record, docs only), `018dfa7` (merge of `main` `3d9aa8b`: PR #42 `a082560` plus docs), `14f3ea7` (the `DB_TENANT_*` variable names), `ea1e010` (lane B evidence). |
| Head | ea1e0105d57bbe8dd995fea65c281746a70e029a |
| Base | Merge base `3d9aa8b0dbf1da0ec743d16981fa7c35ad6670f2` (lane A `RANGE_BASE`). When this round was written, `main` was at `5d2c102`; since `3d9aa8b` it gained only `docs/sdlc/STATUS.md`. |
| Owned paths changed since `c85d5e5` | 5: `apps/api/src/platform/db/config-exit.test.ts`, `apps/api/src/platform/db/with-tenant-tx.ts`, `package-lock.json`, `packages/config/src/guards.ts`, `prisma/package.json`. Lane A's note names exactly these five. The PR now touches 99 owned paths: `ci.yml` equals `main` and has left the diff. |
| Lane A evidence | Run [43684115250](https://github.com/sukhchdit/shipcube/actions/runs/43684115250) on `ea1e010` (`pull_request`, `RANGE_BASE` `3d9aa8b`). `fast-lane` **success**, every step executed: workflow policy, install flags, lockfile provenance and delta, cooldown, licences, signatures, audit + osv, lane B evidence check, deps:rebuild, commitlint, lint with the 4 GB heap, format, actionlint, type-check, unit, negative fixtures, build, both porcelain gates. `scans`: Gitleaks success (71 commits scanned, no leaks), Semgrep success, oasdiff success. The only failing step is "Security-owned paths need a review record": the record names `c85d5e5`, and the five paths above changed after it. |
| Lane B evidence | `docs/05-quality/tests/runs/20261115T0541Z_14f3ea7`: profile `pr`, verdict PASS, `git_sha` `14f3ea7`, `git_dirty` false, `build_clean` true, `env_overrides` and `invalid_reasons` empty. api 128, catalog-c1-c14 102, integration 321 (1 skipped), **rls-cross-tenant 126 tests, 0 failures, 0 skipped**, unit 5639 (2 skipped); merged coverage 98.98 % lines / 96.85 % branches; `packages/audit` 100 % / 100 %. Hygiene: MO.7. |
| Reviewer / date | security-analyst, 2026-11-15, merge-only round against the R2.13 checklist. Read-only on code. No command ran in the PR worktree: this section is the only write there, and the untracked FAIL-run directory was not touched. Git ran in the main checkout against commit SHAs. Docker was used only under the host-wide `docker.lock`, owner tag `sec-pr39mo`, in two short holds. Those holds inspected the developer's local images with `docker run --rm --pull=never --network none` and ran the pinned Gitleaks image with `--pull=never --network none` (the PR range and this record). Nothing was built, pulled or pushed. |

### MO.1 Summary

The union is pure, and every R2.13 item holds:

- **Merge `018dfa7`.** `git merge-tree --write-tree b63fe6e 3d9aa8b` conflicts in exactly `ci.yml` and `values.test.ts`, as the PR body says. The merge commit's tree differs from the merge-tree result only in those two files. `ci.yml` at `ea1e010` is byte-equal to `main`, with one Lint `env:` block and one `NODE_OPTIONS: --max-old-space-size=4096`. `values.test.ts` changes one line against each parent: `GUARDS.length` 15.
- **`14f3ea7`.** It adds only an optional `variable` argument to `positiveInt` and three literal key names (`DB_TENANT_MAX_CONCURRENT_TX` once, `DB_TENANT_ADMISSION_WAIT_MS` twice), plus test rows. No message changes, and no value reaches a message. `runtime.config_rejected` still carries `{variable, error: <class name>, exitCode: 78}`; `process-errors.ts` and `config-exit.ts` are unchanged since `c85d5e5`. The code-review R2.4 item 2 mislabel is closed.
- **`GUARDS`** holds 15 distinct guards.
- **Lockfile.** The leaf-level delta against `main` is exactly the `tsx` leaf of the `prisma` workspace, and it equals the round-2 delta set. The positive control saw `main`'s `@platform/audit` leaf arrive.
- **Images and stack.** The local api, worker and tooling images were created after `14f3ea7`, matching the developer's stack run (MO.6). My find over them shows 0 test seams, no `typescript`, no package manager and no PEM private-key file outside jose's parsing code. The head scanner reports 0 findings on all three, and the tooling image allows exactly the 7 reviewed entries. Layer sums from `docker history` equal the stack run: worker 296.2 MiB (98.7 % of 300 MiB), api 276.6 MiB (92.2 %), tooling 328.0 MiB (reported, not gated). Stack 54/54 (PR body).
- **Tooling closure.** The dangling `@platform/audit` link and the unused `canonicalize` 5.1.0 are acceptable. Nothing in the image imports either, `/app` is root-owned, the one-shots run with a read-only root filesystem in Compose, and the scan allow-list is unchanged at 7 entries. Rated INFO as PR39-SEC-14 (MO.5): the image that holds the migrator credentials should not carry test-only closures.
- **PR45-SEC-02 is still met.** Lane A's Gitleaks command over `origin/main..ea1e010` (71 commits) with `main`'s config finds 0. The pre-#45 config finds the 2 `dd7a2dd` hits, which is the positive control. `dd7a2dd` is not an ancestor of `main`.
- **Evidence hygiene.** Both D-SEC-PR23-02 statements are verbatim in the union gate table. The host-fragment scan of the 8 new evidence files is 0, with a positive control. No FAIL run is committed: all 10 committed run directories are PASS, profile `pr`.

No new Critical, High, Medium or Low finding. New INFO: PR39-SEC-14. **Verdict: PASS_WITH_FOLLOW-UPS** (MO.12).

### MO.2 Method

1. **Union purity.** `git merge-tree --write-tree --name-only b63fe6e 3d9aa8b`, then `git diff --name-status <merge tree> 018dfa7`. For the two conflicted files, the numstat of `018dfa7` against each parent. `ci.yml` compared with `3d9aa8b` and `origin/main` byte for byte.
2. **Commit classification.** `git diff --name-status` per commit since `c85d5e5`:
   - `b63fe6e` touches only this record;
   - `14f3ea7` touches only `config-exit.test.ts` and `with-tenant-tx.ts`;
   - `ea1e010` touches only its 8 evidence files.

   Since `c85d5e5`, no image input changed: no Dockerfile, preflight, entrypoint, scanner, Gitleaks config, CODEOWNERS, Dependabot or `tests/compose` file (empty `git diff --stat` over those paths).
3. **`14f3ea7`.** Read in full, plus `git diff origin/main ea1e010` of `with-tenant-tx.ts`: 18 added, 8 deleted, which are this PR's `variable` parameter, `'PGOPTIONS'` and the three admission names. The 5 new test cases were matched by name in the lane B `unit.junit.xml`; all passed.
4. **Lockfile.** Leaf-level deltas as `(path, before, after)` sets: `d753027 → c85d5e5` (round 2) against `origin/main → ea1e010`, with `c85d5e5 → ea1e010` as the positive control.
5. **Images.** `docker image inspect` (created time), then, as root with `--network none`:
   - the round-2 extended find (seams, `typescript`, key-named files, PEM blocks, package managers, top-level count);
   - the tooling closure list;
   - a link probe: every `@platform/*` entry and whether it resolves, all dangling links, `canonicalize` version and install scripts, and files that name `@platform/audit` or `canonicalize`;
   - owners and modes under `/app`.

   As uid 1000: `require.resolve` from `/app/prisma`, and `prisma-version`. Layer sums came from `docker history`, as the stack test computes them. The head `scan-image-secrets.mjs` was copied to scratch with one change, `--pull=never` added to `gitleaksArgs`, and run over the three images.
6. **PR45-SEC-02.** Lane A's Gitleaks command (`git` mode, `--diff-merges=first-parent`, `.git` mounted read-only) over `origin/main..ea1e010`. It ran once with `main`'s `.gitleaks.toml` and once, as the positive control, with the config before PR #45 (`4a60ca6^`). Ancestry by `git merge-base --is-ancestor`.
7. **Evidence.** The `summary.json` of every committed run directory; the count-only host-fragment scan (10 labels) over the 8 new files; the PR body's union gate table and the evidence commit message.
8. **Sequencing.** `git merge-tree` previews of `ea1e010` with PR #46's pushed head `ad30316` and with its local fix-cycle-2 head `0f17495`, and the overlap of the two PRs' non-docs paths against `main`.
9. **Record simulation** (MO.10).

### MO.3 The R2.13 checklist, item by item

| Item | Check | Result |
|---|---|---|
| 1. `values.test.ts` | `expect(GUARDS.length).toBe(15)`. `main` has 13 (12 + #42's `databaseGuard`); the branch has 14 (12 + this PR's two). | **Met.** The resolution changes one line against each parent. `GUARDS` (`guards.ts:336`) lists 15 distinct names, `localAppEnvOnEcsGuard`, `credentialPairGuard`, `logLevelGuard`, `sessionGuard`, `databaseGuard` and `keyMaterialGuard` among them. `guards.ts` changed 18 added / 0 deleted since `c85d5e5` (#42's `databaseGuard`, auto-merged). |
| 2. `with-tenant-tx.ts` | `TenantTxConfigError(message, variable)` kept; `'PGOPTIONS'` kept; the admission throws name `DB_TENANT_*`; `config-exit.test.ts` rows | **Met** (MO.4). |
| 3. `ci.yml` | One Lint `env:` block, one heap line, `run: npm run lint` unchanged | **Met.** `ci.yml` at `ea1e010` equals `main` byte for byte; line 260 is its only `max-old-space-size`. The file is no longer in this PR's diff, so the workflow-policy checks of the PR17/D-TASK014-25 heap line now judge `main`'s own state. Lane A's workflow policy and actionlint passed. |
| 4. `prisma/package.json` and lockfile | `tsx` and `@platform/audit` both in the `prisma` devDependencies; lockfile delta only `tsx`; tooling link state; one-shots | **Met.** The devDependencies are `@platform/audit`, `prisma`, `@types/pg` and `tsx`; the diff against `main` adds only `tsx`. Lockfile: MO.1. Tooling image: MO.5 and MO.6. One-shots: the stack's compose-up case runs migrate and seed (`[AT-US-003-01]`, `[AT-US-049-02]`), and `[SEC-TC-64 (vi)]` runs `prisma-version` with no network. My own `prisma-version` run on the local tooling image exited 0 with `--network none`. |
| 5. Images and stack | api and worker keep `packages/audit/{package.json,dist}`; stack re-run; fresh evidence | **Met.** The Dockerfiles are unchanged since `c85d5e5`. Stack suite 54/54 on `14f3ea7` (PR body), with these passing: `[sheet line 543]` × 5, `[AT-US-004-02]` × 5, the 6 preflight cases and the 4 size cases. Worker 296.2 MiB = 98.7 % of 300 MiB; api 92.2 %. My own checks: MO.6. |
| 6. `config/index.ts` | Union of the export lists | **Met.** Against `c85d5e5`: 6 added, 0 deleted (#42's `DB_AUDIT_LOCK_TIMEOUT_MS_*`, `DB_TENANT_*` and `defaultTenantMaxConcurrentTx`). Against `main`: this PR's db-tls, tooling-env, `DATABASE_SSLMODES` and `hasValid…`/`hasOnly…` exports. The 1 deleted line is the one-line `guards.js` export, which this PR expands. |
| 7. Record | The round names the pushed union commit | **Met.** This section's head row is `ea1e010`, checked with `git ls-remote` before writing. |

### MO.4 `14f3ea7`: the admission refusals name their keys

`with-tenant-tx.ts` at `ea1e010`:
- `positiveInt(name, value, variable?)` passes `variable` to `TenantTxConfigError`, whose default stays `'DB_TX_*'` (line 137).
- `resolveAdmissionOptions` (lines 305-312) passes `'DB_TENANT_MAX_CONCURRENT_TX'` and `'DB_TENANT_ADMISSION_WAIT_MS'` to `positiveInt`. It also passes `'DB_TENANT_ADMISSION_WAIT_MS'` for the "wait above `maxWaitMs`" refusal.
- The transaction-option refusals (`resolveTransactionOptions`) keep the default, and `assertNoSessionOptions` keeps `'PGOPTIONS'`.

Every `variable` is a string literal. Every message is a literal or interpolates only the literal option name (`admission.waitMs`), never a value. `configErrorVariable` and `installProcessErrorHandlers` are unchanged since `c85d5e5`, so their R2.8 probe still applies:
- one `runtime.config_rejected` line with `{variable, error: <class name>, exitCode: 78}`;
- no error object reaches the logger;
- the first error decides the exit code;
- look-alike names are not diverted to 78.

`CONFIG_EXIT_CODE` is 78 (`packages/config/src/process-env.ts:34`).

Tests added in `config-exit.test.ts`; each one is in the lane B `unit.junit.xml` as passed:
- four `configErrorVariable` rows: a wait above `maxWaitMs` and a non-positive wait (`DB_TENANT_ADMISSION_WAIT_MS`), a non-integer and a zero concurrency (`DB_TENANT_MAX_CONCURRENT_TX`);
- one `DB_TX_*` row through `resolveTransactionOptions`;
- one process-handler case: `runtime.config_rejected` names `DB_TENANT_ADMISSION_WAIT_MS`, with `error` `TenantTxConfigError` and exit 78.

These refusals are a second line of defence. The configuration schema already bounds both keys (`DB_TENANT_MAX_CONCURRENT_TX` `t.int(1, DB_POOL_MAX_LIMIT)`, `DB_TENANT_ADMISSION_WAIT_MS` `t.int(1, DB_TENANT_ADMISSION_WAIT_MS_MAX)`), and so does `databaseGuard` (`db.tenantConcurrency`). The "(ms)" suffix in the concurrency message is a cosmetic leftover of `positiveInt`'s wording, not a security matter.

### MO.5 PR39-SEC-14 (INFO): the tooling image carries a test-only closure

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner / due | Status |
|---|---|---|---|---|---|---|---|
| PR39-SEC-14 | The tooling image ships the `prisma` workspace's test-only devDependency `@platform/audit` as a dangling workspace link, plus its unused dependency `canonicalize`; dangling `.bin` shims of pruned packages also remain | INFO | CWE-1164 | A05 | `prisma/package.json:27`; `prisma/Dockerfile` (the `prune-deps --dev … prisma` step keeps every `prisma` devDependency and its production closure) | devops, with PR39-SEC-12 (before lane B `image-assertions` activation), or the next PR that changes `prisma/Dockerfile` | Open |

- **Description.**
  - #42 added `@platform/audit` to the `prisma` devDependencies for `prisma/tests/audit/audit-writer.int.test.ts`. The tooling build runs `npm ci --include=dev --workspace=prisma` and then `prune-deps --dev … prisma`, which keeps every `prisma` devDependency and its production closure.
  - So `/app/node_modules/@platform/audit` stays as a link to `../../packages/audit`, a folder the final stage never copies (`/app/packages` holds `authz`, `config` and `shared`). `canonicalize` 5.1.0, its one third-party dependency, ships with its `.bin/canonicalize` shim. The top-level count rises from 67 to 68.
  - The other `@platform` links (`authz`, `config`, `prisma`, `shared`) resolve.
  - The image holds 6 dangling links: `@platform/audit`, and 5 `.bin` shims of packages that `prune-deps` removed (`tsc` and `tsserver` of `typescript`, `pglite-server` of `@electric-sql/pglite-socket`, `safe-regex2`, and `node-which` of `which`). The shims are not from the union. `prune-deps` removes packages but not their `.bin` links, the lockfile gained no package in the union (`c85d5e5 → ea1e010` changes one leaf), and neither `canonicalize` nor `packages/audit` declares one of those bins.
  - Only `/app/prisma/package.json` (the devDependency declaration) and the hidden lockfile name either package; no source file in the image imports them.
- **Impact.** No exposure today:
  - nothing in the image imports either package; a `require.resolve('@platform/audit')` from `/app/prisma` fails with `MODULE_NOT_FOUND`, which fails closed;
  - the link target is relative and inside `/app`. `/app`, `/app/packages` and `/app/node_modules` are root-owned 755. Compose runs the one-shots with `read_only: true`, and ECS will run them with a read-only root filesystem (PR39-SEC-07 M5 list). So the link cannot be made to resolve to planted code. No directory under `/app` is owned by uid 1000 or world-writable. The 18 mode-777 entries the probe lists are symlinks, whose mode Linux ignores.
  - `canonicalize` 5.1.0 is Apache-2.0 (allow-listed). It has no dependencies and no install script, was published 2026-09-18, and passed lane A's licence, signature, audit and osv steps. The api and worker images already ship it for the audit writer;
  - the image secret scan still allows exactly the 7 reviewed entries, and no entry was added (`scan-image-secrets.mjs` is unchanged since `c85d5e5`).

  The residual is hygiene. The image that holds the migrator credentials carries code that no tooling command needs, and the next test-only devDependency added to `prisma` will ship the same way, unnoticed. INFO.
- **Remediation (code level, optional).** Keep test-only workspace links out of the tooling closure, drop dangling links, and assert both.
  ```dockerfile
  # prisma/Dockerfile, build stage, after prune-deps and prune-dist (packages/audit is not copied to the final stage)
   && rm -f node_modules/@platform/audit \
   && find node_modules -xtype l -delete \
  ```
  Stop the `--dev` closure at the link as well, so `canonicalize` goes too. For example, add a `prune-deps --omit-dev <name>` option that drops named devDependencies, and pass `--omit-dev @platform/audit`. Then `--dev` keeps only what the tooling commands run: `prisma`, `tsx`, and `@types/pg`, which is type-only.
  ```ts
  // tests/compose/images.stack.test.ts, next to the [PR39-SEC-04] tooling case
  expect(findInImage(IMAGES.tooling, ['/app', '-xtype', 'l'])).toEqual({ status: 0, found: '' });
  expect(findInImage(IMAGES.tooling, ['/app/node_modules', '-maxdepth', '1', '-name', 'canonicalize'])).toEqual({ status: 0, found: '' });
  ```
- **Verification.**
  - The tooling image has 0 dangling links and no `canonicalize`.
  - `prisma-version`, `migrate` and `seed` still pass.
  - The tooling secret scan still allows exactly 7 entries.

### MO.6 Images

**Provenance.**
- `shipcube-{api,worker,tooling}:local` were created 05:05Z on 2026-11-15. That is four minutes after `14f3ea7` was committed (05:01Z), which matches the PR body's stack run on `14f3ea7`. `14f3ea7..ea1e010` adds only the 8 evidence files, which no build context reads.
- `shipcube-{web,admin}:local` are the 2026-11-13 images. Their inputs are unchanged since round 1 apart from bundle inputs, and the PR body reports cache hits with byte-identical bundles. My web/admin evidence is the stack run only.

| Image | Seams (round-2 extended find) | `typescript` | PEM private-key files | Package managers | Top-level packages | Head scanner (`--pull=never` copy) |
|---|---|---|---|---|---|---|
| tooling | 0 | 0 | 0 | none | 68 (67 + `canonicalize`) | exit 0, 0 findings; exactly the 7 reviewed entries allowed; `/usr/local/bin/node` reported as skipped (known binary); 53 s |
| api | 0 | 0 | 2 (jose's PEM-parsing code, as in round 2) | none | 152 | exit 0, 0 findings, none allowed, node binary reported as skipped |
| worker | 0 | 0 | 2 (same) | none | 170 | exit 0, 0 findings, none allowed, node binary reported as skipped |

- **Tooling closure.** Of the probed names, the image holds only the expected `@types`, `tsx`, `prisma`, `@prisma`, `pg` and `effect`. It holds no `eslint-*` or `jest-*` package and no other root-toolchain name.
- **api and worker.** `canonicalize` and `packages/audit/dist` are present (the audit writer needs both), and the images have 0 dangling links.

**Sizes** (layer sum from `docker history`, as the stack test computes it):

| Image | Layer sum | Budget | Share |
|---|---|---|---|
| worker | 310,603,776 bytes = 296.2 MiB | 300 MiB | 98.7 % (WARN) |
| api | 290,062,336 bytes = 276.6 MiB | 300 MiB | 92.2 % (WARN) |
| tooling | 343,941,120 bytes = 328.0 MiB | reported, not gated | n/a |

These equal the stack run's figures. The worker has 3.8 MiB of headroom, and the size case fails the stack suite on any breach (D-ARCH-118). That is capacity, not security.

### MO.7 PR45-SEC-02 and evidence hygiene

**PR45-SEC-02.**

| Check | Result |
|---|---|
| Lane A's Gitleaks command, `main`'s `.gitleaks.toml` (with the PR #45 entry), `--diff-merges=first-parent origin/main..ea1e010` (`5d2c102..ea1e010`, the same commits as `3d9aa8b..ea1e010`) | 71 commits scanned, **0 findings** |
| Same range, the config before PR #45 (`4a60ca6^`), positive control | 2 findings, both `dd7a2dd` `tools/docker/scan-image-secrets.mjs` lines 272-273 `generic-api-key` |
| `git merge-base --is-ancestor dd7a2dd origin/main` | exit 1: **`dd7a2dd` is not an ancestor of `main`**. It is an ancestor of `ea1e010`, as expected until the squash merge. |
| `756d505` in the head | An ancestor of `ea1e010` |
| Lane A, a new `pull_request` event | Run 43684115250 on `ea1e010`: Gitleaks success, 71 commits, no leaks |

**Lane B evidence `20261115T0541Z_14f3ea7`.**
- **D-SEC-PR23-02 statements, verbatim, in the union gate table of the PR body:**
  - "**`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first**", in a fresh clean worktree of the branch at `14f3ea7`;
  - "**`.git/info/exclude` is empty** (0 bytes)".

  The evidence commit message repeats both statements. I checked the shared `.git/info/exclude`: 0 bytes.
- **Host-fragment scan.** My count-only scan covered all 8 files of the new run directory with 10 labels: OS user, its 8.3 stem, home and temp dir in both separator forms, host name, git e-mail, and two users-dir forms. It found 0 hits; the positive control fired for every label.
- **Committed runs.** The PR now adds 10 run directories. In every `summary.json`, the verdict is PASS, the profile `pr`, `git_dirty` false, `build_clean` true and `env_overrides` empty. No `FAIL` verdict is committed anywhere under `docs/05-quality/tests/runs/` at `ea1e010`, and no `wave` or `gate` run is committed.
- **The untracked FAIL directory in the PR worktree** is untouched and is not in any commit.
- **Parked SEC-TC note.** check-evidence's note "pending ID SEC-TC-74 is implemented in suite catalog-c1-c14" belongs to `main`'s manifest (D-SEC-PR47-01, D-ORCH-088), not to this PR.

### MO.8 Sequencing and unions (updates §7 and R2.13)

**PR #42: done.** This round closes the R2.13 merge-only requirement.

**PR #46 (015-B, fix cycle 2 in progress).**
- **Pushed head `ad30316`** (base `d753027`). A union with `ea1e010` still conflicts in `ci.yml` only, because both sides add the Lint heap block.
- **Local head `0f17495`** (not pushed). It has merged `main` `3d9aa8b`, and it adds `pull_request: branches: [main]` plus the lane-scope proof binding (R2-M1, PR46-SEC-13).
  - A union with `ea1e010` is **clean**. Its `ci.yml` is #46's file, with exactly one `max-old-space-size` line.
  - The two PRs' non-docs diffs against `main` overlap in 5 paths, all auto-merged: `jest.config.ts`, `package.json`, `tools/ci/check-workflow-policy.{mjs,test.ts}` and `tools/deps/rebuild.mjs`.
  - The preview union keeps:
    - the PR39-SEC-05, PR40-SEC-01 and PR43-SEC-04 `REQUIRED_CODEOWNED_PATHS` blocks;
    - #46's `gh-token`, `dispatch-only`, `playwright-install` and `scans-isolation` rules;
    - `prismaArgv` and the Playwright-redirect refusal in `rebuild.mjs`;
    - `test:stack`, `test:coverage` and `ci:minutes`;
    - the `stack` project behind `JEST_STACK`.

Whichever of #39 and #46 merges second needs a merge-only round. Simulation S8 shows why: if #46 merges first, the union voids this record through those overlapping owned paths. That round checks:
- **`ci.yml`.** Exactly one Lint `env:` block with one heap line, `run: npm run lint` byte-identical, and every stage-1 hunk of #46: `pull_request: branches: [main]`, the push `paths-ignore`, and the lane-scope and proof steps. If #39 merges second, its `ci.yml` must equal the new `main` byte for byte, as it does now.
- **The other overlapping files.** The R2.13 #46 list for `check-workflow-policy`, `package.json`, `jest.config.ts` and `rebuild.mjs` (unchanged).
- **The policy checker.** `main`'s base-ref `check-workflow-policy` and the head copy both pass on the union `ci.yml`.

**PR #45 retirement.** Unchanged (R2.13). After #39 squash-merges and `dd7a2dd` is confirmed absent from `main`'s ancestry, the commit-bound entry may be retired by its own PR (D-SEC-PR45-01).

### MO.9 Checks owed (updates R2.14)

| Owner / when | Item |
|---|---|
| Second merger of #39 and #46 | MO.8 list; merge-only security round |
| qa-lead + devops, Wave-0-exit activation PR | PR39-SEC-10 and PR39-SEC-11, unchanged |
| devops, with PR39-SEC-10 | PR39-SEC-12, plus PR39-SEC-14 (test-only closure and dangling links out of the tooling image, with a stack assertion) |
| devops, first Dependabot run | Unchanged (R2.14) |
| M5 ECS task definitions | PR39-SEC-07, the round-1 M5 list and PR39-SEC-13; the tooling one-shots with `readonlyRootFilesystem` (this keeps PR39-SEC-14 at INFO) |
| 015-C | R2.9 observation, unchanged |
| TASK-119 / G3 | Trivy (D-SEC-PR39-02), unchanged |

### MO.10 Record simulation and secret hygiene

**Setup.**
- `main`'s `tools/ci/check-security-owned-paths.mjs`, run as lane A runs it. `main`'s tip is `5d2c102`, and its `tools/ci` equals the base-ref copy at `3d9aa8b`.
- A scratch `git clone --shared --no-checkout` with a sparse checkout of `.github/`, `docs/05-quality/security/` and `tools/ci/`.
- Scenario commits built with plumbing on `ea1e010`, each checked out detached and checked with `--root <clone> --json`.
- Nothing is written to the main repository's refs or objects.
- This section, checked before the run: exactly one table row whose first cell starts with `Head` (the full `ea1e010` SHA), and exactly one `| **Verdict** |` row, which is the last line.

| Scenario | `--base` / `--head` / `--pr` | Expected | Result |
|---|---|---|---|
| S0: `ea1e010` as pushed, with rounds 1 and 2 only (control) | `3d9aa8b` / `ea1e010` / 39 | missing (names `c85d5e5`, 5 paths) | missing: names `c85d5e5`; `config-exit.test.ts`, `with-tenant-tx.ts`, `package-lock.json`, `guards.ts` and `prisma/package.json` changed after it (lane A's note) |
| S1: this section appended and committed on `ea1e010` | `3d9aa8b` / S1 / 39 | pass, satisfied by `ea1e010` | **pass**: 99 owned paths, satisfied by `ea1e010`. The `894c72e` and `c85d5e5` rows only add notes. |
| S2: S1 with `--base` = the `main` tip | `5d2c102` / S1 / 39 | pass | pass, satisfied by `ea1e010` |
| S3: S1 checked as PR #40 | `3d9aa8b` / S1 / 40 | missing | missing |
| S4: S1 plus a later edit of `with-tenant-tx.ts` | `3d9aa8b` / S4 / 39 | missing | missing: names `ea1e010`, and `with-tenant-tx.ts` changed after it |
| S5: S1 with this round's verdict set to FAIL | `3d9aa8b` / S5 / 39 | missing | missing (verdict FAIL) |
| S6: S1 plus a docs-only commit | `3d9aa8b` / S6 / 39 | pass | pass |
| S7: S1 without this round's final verdict row (control) | `3d9aa8b` / S7 / 39 | pass on round 2's row (the procedural gap noted in PR10-SEC-04) | pass (procedural, as expected) |
| S8: #46's local head `0f17495` squashed onto `main`, then merged into S1 (both merges clean) | squash commit / S8 / 39 | missing (MO.8) | missing: names `ea1e010`; `jest.config.ts`, `package.json`, `check-workflow-policy.{mjs,test.ts}` and `rebuild.mjs` changed after it |
| S9: this section with its head row naming `c85d5e5` instead | `3d9aa8b` / S9 / 39 | missing | missing: names `c85d5e5` and the 5 paths |

**Secret and host hygiene of this section.**
- **Gitleaks.** The pinned Gitleaks image (`--pull=never`, `--network none`, default config, `dir` mode, `--redact`) scanned the whole candidate record, beside a runtime-generated positive control. The candidate was rounds 1 and 2 plus this section, before the last hold figures were filled in. Result: 1 finding, the control only. The Gitleaks emulator (222 rules, three runtime controls fired) then re-checked the final text: 0 findings.
- **Host fragments.** A count-only host-fragment scan of the final record (10 labels, positive control fired) found 0 hits.
- **Quoted content.** The section quotes no secret value, no env-file value, no `effect` constant value, no scratch path and no user name. `.env.example`, which `main` changed in #42, was not opened; lane A's Gitleaks scanned its added lines in the range.
- **Docker.** `docker.lock` was released after each hold (owner tag `sec-pr39mo`). Every container ran with `--rm`, and Docker never mounted the PR worktree.

### MO.11 Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

- **D-SEC-PR39-09 · security-analyst · PR #39 merge-only round at `ea1e010` (union with PR #42).**
  - **Verdict:** PASS_WITH_FOLLOW-UPS.
  - **R2.13 checklist met:**
    - the union is pure: `018dfa7` equals `git merge-tree` outside the two conflicted files, and `ci.yml` equals `main` with one Lint heap line;
    - `GUARDS` has 15 entries;
    - `14f3ea7` adds only the `DB_TENANT_*` variable names and test rows (exit 78, names only);
    - the lockfile delta against `main` is only the `tsx` leaf;
    - the stack is 54/54, with the worker at 296.2 MiB (98.7 %);
    - fresh lane B evidence is PASS (rls-cross-tenant 126/0/0, the `packages/audit` gates).
  - **New INFO:** PR39-SEC-14. The tooling image carries the test-only `@platform/audit` link (dangling), the unused `canonicalize` and dangling `.bin` shims. Owner: devops, with PR39-SEC-12.
  - **PR45-SEC-02 met:** range scan `origin/main..ea1e010` 0 findings (71 commits), positive control 2, `dd7a2dd` not an ancestor of `main`.
  - **Sequencing:** the second merger of #39 and #46 needs a merge-only round (MO.8).
  - **Reversibility:** high.

### MO.12 Verdict (merge-only round)

| Field | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium, 0 Low open. Open INFO: PR39-SEC-07, -08, -09, -10 (round 1), -11, -12, -13 (round 2) and -14 (new) |
| Conditions | None open |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High, Medium or Low finding is open at head `ea1e010`. The union with PR #42 is pure, every R2.13 item is met, and `14f3ea7` only names the `DB_TENANT_*` keys. The lockfile delta is the `tsx` leaf alone, the stack and lane B evidence are fresh and green, and PR45-SEC-02 still holds. The INFO follow-ups have owners in MO.9. The second merger of #39 and #46 needs a merge-only round (MO.8) |
