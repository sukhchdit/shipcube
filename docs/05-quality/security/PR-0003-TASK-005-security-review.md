# PR-0003 / TASK-005: change-scoped security review

| Field | Value |
|---|---|
| PR | #3 `feat(config): typed, validated configuration and key/secret register (TASK-005, US-002)`, https://github.com/sukhchdit/shipcube/pull/3 |
| Branch / head | `feat/TASK-005-typed-validated-configuration-key-secret` @ `be468bc`; base `main` @ `4da693a`; 2 commits (`baa24d7`, `be468bc`); 32 files, +3,572 / −4 |
| Scope | P5 Wave 0, batch 0.2, bootstrap merge rule D-ORCH-004. `packages/config/**` (security-critical path), `.env.example`, `compose.env`, `tools/config/**`, `package-lock.json` (one declaration line) |
| Security requirements in scope | SEC-P3-08 items 1, 4, 5, 6 (ADR-0018 amendment items 1 and 3); SEC-TC-49 (config part); SEC-TC-51 (start-up part); NFR-SEC-002, NFR-SEC-007 (config guard); NFR-OPS-005; AT-US-002-03 (bcrypt floor) |
| Reviewer / date | security-analyst, 2026-11-12. Read-only on the branch; worktree `Shipqube-TASK-005` at `be468bc`, clean. Node 24.22.3 via the CLAUDE.md §2 PATH prefix. `.env*`, `*.pem` and `*.key` were not opened; `.env.example` and `compose.env` were reviewed from the GitHub diff hunks only |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open for this change. 2 MEDIUM, both concrete bypasses of start-up guards: the debug-flag guard (PR3-SEC-01) and the transport guard (PR3-SEC-02). Each fix is about 10 lines in files this PR owns, so I recommend landing them in this PR's fix cycle. Otherwise they become binding on TASK-006 and are due before G3. Also 6 LOW and 3 INFO. |

## 1. Summary

The package does what US-002 and SEC-P3-08 ask:
- one Joi schema;
- a pure loader;
- errors that carry names only;
- a 25-row key register with purpose-bound `key_id`s;
- one-key-per-purpose enforcement by digest;
- placeholder and `local-only-*` refusal in staging and production;
- a redacting `Secret` wrapper;
- a public-only web subset.

Fail-closed behaviour holds for every input I tried:
- `APP_ENV` unset, empty, a case variant, padded with whitespace, or a Unicode look-alike: rejected;
- local-only key markers in a hardened env: refused;
- local-only marker variants (case, whitespace, Unicode hyphen): rejected as `key.encoding` in every env;
- error text with a sentinel value in 8 different keys: the sentinel never appears.

**The findings are not about the core design.** They are about guards that inspect the configured string differently from the component that later consumes it:
- **NODE_OPTIONS:** Node's own parser starts the inspector for `"--inspect=…"` and `--inspect_brk`. The guard's regex lets both through.
- **Database URL:** node-postgres honours the *last* `sslmode`; the guard reads the *first*.
- **Valkey URL:** ioredis turns `rediss://…?tls=` into a plain-TCP connection. The guard only checks the scheme.

**The remaining items are wiring and least-privilege gaps that later tasks will inherit:**
- secret-reference resolution and its post-checks are not composed into start-up;
- the register's `holders` column is not enforced;
- `file:` references are not confined to `/run/secrets`;
- Vite's native `VITE_*` exposure is outside the web subset's control.

## 2. Method

- **Diff and code review.** I read all 32 files at `be468bc`: `gh pr diff 3` and the worktree sources. I traced every configured string to each place it is consumed: guards, parsers, `Secret`, the error formatter and the Vite `define` output.
- **Empirical probes** ran against the PR's own build output (`packages/config/dist`). Before running them I confirmed that every `dist/*.js` is newer than its source. The scripts sit in the session scratchpad (`review/PR-3-sec/probe.mjs`, `probe2.mjs`) and print issue codes and booleans only; their output is in `probe-out.txt`. The probes covered:
  - `APP_ENV` spoofing;
  - NODE_OPTIONS variants;
  - duplicate `sslmode`;
  - local-only marker variants;
  - HMAC-equivalent duplicates;
  - holder enforcement;
  - secret-reference grammar;
  - a provider that ignores `AbortSignal`;
  - error-text leakage, using a sentinel value.
- **Consumer behaviour, verified on the locked versions.**
  - Node 24.22.3 starts the inspector for each guard-bypassing NODE_OPTIONS form. I bound it to `127.0.0.1:0` with a 3–5 s timeout and redacted the URL in the output.
  - `pg` 8.23.1 with `pg-connection-string` 2.14.1: how duplicate `sslmode` is resolved.
  - `ioredis` 6.0.0: what `options.tls` becomes for `rediss://…?tls=`.
- **Secrets.** I ran a Node regex scan of the added diff lines for these shapes: Stripe, `whsec_`, PEM, AKIA/ASIA, base64 ≥ 40, hex ≥ 32, JWT, URL credentials. It printed `file:line` and the rule only.
  - No key material, token or credential shape was found.
  - Every URL credential hit was either `CHANGE_ME`, a `local-only-*` marker, or a deliberate negative fixture (`user:pass@cdn.example.org` in the parity test).
  - gitleaks was **not** run, because the host constraints for this review bar Docker. The hosted gitleaks job and the `security-integration` job arrive with TASK-007 and TASK-015.
- **SAST.** Semgrep is not installed on the host. About 1,600 lines of non-test TypeScript were reviewed manually.
- **Supply chain.** The lockfile delta is one line: `packages/config` now declares `zod ^4.6.7`, which was already locked for apps/web and apps/admin (MIT). No package entry was added or changed.
- **Not re-run, per the review constraints** (memory-constrained host, 8 parallel reviewers): `npm ci`, the build and the unit suites. I accept the PR's D-ORCH-004 evidence: 226/226 tests; `packages/config/src` coverage 99.89 % lines and 97.69 % branches.

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR3-SEC-01 | Debug guard bypass. NODE_OPTIONS written as `"--inspect=…"` (quoted) or `--inspect_brk` / `--inspect_wait` (underscore) passes in staging and production, and Node starts the inspector for each. CLI flags (`process.execArgv`) and SIGUSR1 are not covered | MEDIUM | CWE-489, CWE-184 | A05 | `packages/config/src/guards.ts:57-67` | senior-developer **in this PR** (recommended), else TASK-006 before it merges; TASK-014 (`--disable-sigusr1`) | Open |
| PR3-SEC-02 | Transport guard bypass. The guard reads the first `sslmode`; node-postgres uses the last (`…&sslmode=no-verify` → `rejectUnauthorized:false`; `…&sslmode=disable` → plaintext). `rediss://…?tls=` gives ioredis `tls:""`, which means plain TCP | MEDIUM | CWE-319, CWE-295 | A02 | `guards.ts:44-55` | senior-developer **in this PR** (recommended), else TASK-006 (pg/Valkey client construction); TASK-003 (adapter-pg wiring) | Open |
| PR3-SEC-03 | Hardened behaviour hinges on `APP_ENV` alone. `NODE_ENV=production` with `APP_ENV=local` is accepted, which brings local-only key markers, Mock defaults, plain transport, Swagger and `.env.local`. The key parsers are exported without an env check. ADR-0018 §3 wording diverges from the code | LOW | CWE-693, CWE-454 | A05 | `schema.ts:174-175`; `keys.ts:443-447`; `environment.ts:13-20`; ADR-0018 §3/§4 | principal-architect (ADR-0018 wording, corroborating signal); first key-provider task (TASK-040 / 045 / 048 / 052, whichever lands first); IaC task (Terraform `app_env` validation) | Open (latent until a deployed env exists) |
| PR3-SEC-04 | The secret-resolution timeout is only advisory. A provider that ignores `AbortSignal` overruns the budget (measured: 613 ms against a 50 ms budget), so NFR-OPS-005's 5 s fail-fast is not guaranteed | LOW | CWE-1088, CWE-400 | A04 | `secret-refs.ts:89-97` | senior-developer in this PR (3 lines) or TASK-006 | Open |
| PR3-SEC-05 | `resolveSecretRefs` and `checkResolvedSecrets` are not composed into start-up. `PAYMENT_LIVE_KEY_FORBIDDEN` and the placeholder refusal for `*_REF` targets therefore depend on every consumer remembering both calls | LOW | CWE-693 | A04 | `process-env.ts:55-65`; `secret-refs.ts:103-173` | TASK-006 (binding); TASK-167 | Open (latent) |
| PR3-SEC-06 | The register's `holders` column is never enforced. The API accepts `AUDIT_ANCHOR_SIGNING_KEY`. The worker accepts the private `JWT_SIGNING_KEYS` and API-only keys. Both services accept `DATABASE_MIGRATOR_URL` / `SHADOW_DATABASE_URL`, and the migrator owns the database | LOW | CWE-250, CWE-272 | A04 | `keys.ts:54-65, 132-143, 340-352`; `schema.ts:213-220, 250-253, 264`; `compose.env` (one file for all services) | senior-developer (guard; this PR or TASK-006); TASK-014 (per-service env); principal-architect (holder column for `jwt-signing`) | Open (latent) |
| PR3-SEC-07 | The `file:` locator accepts any absolute path (`/proc/self/environ` and `/etc/shadow` both parse), although the docs say `/run/secrets/<name>`. No file adapter exists yet | LOW | CWE-22, CWE-59 | A01 | `secret-refs.ts:29, 48-49` | senior-developer (prefix, this PR); the task that adds the file provider (TASK-006 / TASK-014) | Open (latent) |
| PR3-SEC-08 | The web subset does not govern Vite's own env exposure. TASK-004's `vite.config.ts` files keep the default `envPrefix: 'VITE_'` and do not use `webBuildDefine`, so any `VITE_*` variable in the build environment can reach the bundle | LOW | CWE-200, CWE-540 | A05 | `apps/{web,admin}/vite.config.ts` on `feat/TASK-004-…`; `packages/config/src/web/load-web-config.ts` | TASK-004 (or the task that wires `@platform/config/web`) | Open (latent) |
| PR3-SEC-09 | Gaps in key-material checks. HMAC-equivalent keys are not detected (K versus K‖0x00, verified accepted); neither are alternative PKCS#8 encodings of one key. 32 zero bytes are accepted in staging. `reveal()` hands out a mutable shared `Uint8Array` | INFO | CWE-320, CWE-331 | A02 | `keys.ts:464-477, 531-548` | senior-developer (optional) | Open |
| PR3-SEC-10 | Placeholder-pattern precision (reviewer focus 2). An unanchored `<…>` and the bare words cause fail-closed false refusals of real passwords. There is no NFKC or URL-decoding step | INFO | CWE-184 | A05 | `placeholders.ts:8-15` | senior-developer (optional) | Open |
| PR3-SEC-11 | Notes for later tasks: AWS adapter region/account pinning; `@platform/config/testing` import boundary; SEC-TC-18 `APP_ENV=benchmark` vocabulary | INFO | n/a | n/a | `secret-refs.ts:30`; `packages/config/package.json` `./testing`; threat-model R-12 vs ADR-0007 item 4 | TASK-002, TASK-018, M5 AWS adapter, principal-architect | Open |

### PR3-SEC-01: debug-flag guard bypass (MEDIUM)

**Description.** SEC-P3-08 item 6 and ADR-0018 am. item 3 require that `NODE_OPTIONS` containing `--inspect*` is refused outside `local`. The guard tests the raw string with `/(?:^|\s)--inspect(?:-brk|-wait|-port)?(?:=|\s|$)/`. Node's NODE_OPTIONS parser accepts three forms that this regex misses:
- double-quoted tokens, such as `"--inspect=0.0.0.0:9229"`;
- `_` in place of `-` inside option names, such as `--inspect_brk` and `--inspect_wait`;
- `--debug-port`, an alias of `--inspect-port`.

Probe at `be468bc` with `APP_ENV=staging`. Only the plain form is refused:

| NODE_OPTIONS | Guard | Node 24.22.3 |
|---|---|---|
| `--inspect=0.0.0.0:9229` | refused | inspector on |
| `"--inspect=0.0.0.0:9229"` | **accepted** | **inspector on**: `Debugger listening on ws://…`, and `inspector.url()` is set |
| `--max-old-space-size=512 "--inspect"` | **accepted** | inspector on |
| `--inspect_brk=…` / `--inspect_wait=…` | **accepted** | **inspector on**, process paused for attach |

The guard sees only NODE_OPTIONS. An inspector enabled by a CLI flag in an image `CMD` (`node --inspect dist/main.js`) or by SIGUSR1 is never checked.

**Exploitability and impact.** Quoted values are a realistic accident. `docker run --env-file` and ECS environment files keep quotes literally, so `NODE_OPTIONS="--inspect=0.0.0.0:9229"` written in such a file arrives with the quotes, and Node strips them.
- Impact is C. An inspector bound to `0.0.0.0` gives anyone with network reach to port 9229 code execution as the task role, which includes Secrets Manager and KMS decrypt at M5.
- Likelihood is L.
- C×L = HIGH. Adjusted one step because exploitation is Hard: it needs an in-VPC network position and a misconfiguration. Result: **MEDIUM**.

**Remediation (code level).**

1. Tokenise NODE_OPTIONS the way Node does and normalise option names. In hardened environments an allow-list is the stronger choice. Minimal denylist fix in `guards.ts`:
   ```ts
   /** Splits NODE_OPTIONS like Node: double quotes group a token; `\` escapes inside quotes. */
   export const nodeOptionTokens = (value: string): string[] =>
     [...value.matchAll(/"((?:\\.|[^"\\])*)"|(\S+)/g)].map(([, quoted, bare]) => quoted?.replace(/\\(.)/g, '$1') ?? bare ?? '');
   /** Node accepts `_` for `-` in option names (`--inspect_brk` is `--inspect-brk`). */
   const optionName = (token: string): string => (token.split('=', 1)[0] ?? '').replace(/_/g, '-');
   const INSPECTOR_OPTIONS = new Set(['--inspect', '--inspect-brk', '--inspect-wait', '--inspect-port', '--debug-port', '--inspect-publish-uid']);
   export const isInspectorOption = (token: string): boolean => INSPECTOR_OPTIONS.has(optionName(token));
   // debugGuard:
   if (raw.NODE_OPTIONS !== undefined && nodeOptionTokens(raw.NODE_OPTIONS).some(isInspectorOption)) issues.push({ key: 'NODE_OPTIONS', code: 'debug-flag' });
   ```
   Preferred for `staging` and `production`: refuse every token whose option name is not in an allow-list, for example `--max-old-space-size`, `--max-semi-space-size`, `--enable-source-maps`, `--disable-sigusr1`, `--no-deprecation`. This also closes `--require`/`--import` preloads, which the current guard accepts.
2. Add a belt at the process edge that is independent of how the inspector was enabled. In `process-env.ts`, inside the existing `try`:
   ```ts
   import inspector from 'node:inspector';
   const config = loadConfig(env, { service });
   if (config.APP_ENV !== 'local' && (inspector.url() !== undefined || process.execArgv.some(isInspectorOption))) {
     throw new ConfigValidationError([{ key: 'NODE_OPTIONS', code: 'debug-flag' }]);
   }
   return config;
   ```
3. TASK-014: start the runtime images with `node --disable-sigusr1` (present in Node 24.22.3 `--help`).

**Verification test.**
- `it.each(['"--inspect=0.0.0.0:9229"', '--inspect_brk=0.0.0.0:9229', '--inspect_wait=0.0.0.0:9229', '--max-old-space-size=512 "--inspect"', '--debug-port=9229'])` with `APP_ENV=staging` → `{ key: 'NODE_OPTIONS', code: 'debug-flag' }`.
- A child-process test spawns `fixtures/start-service.ts` with `APP_ENV=staging` and `NODE_OPTIONS='"--inspect=127.0.0.1:0"'`. Expected: exit 78, stderr names `NODE_OPTIONS`, and `ready` is never printed.

### PR3-SEC-02: transport guard reads a different URL than the drivers do (MEDIUM)

**Description.** NFR-SEC-007 requires `sslmode=verify-full` and `rediss://` outside local/test. The guard has two gaps:
- **Database URL.** It checks `url.searchParams.get('sslmode')`, which returns the **first** value. `pg-connection-string` 2.14.1 copies every query entry into the config object, so the **last** value wins. I verified this with `pg` 8.23.1, the driver behind `@prisma/adapter-pg`:
  - `…?sslmode=verify-full&sslmode=no-verify` passes the guard (probe: ACCEPTED) and yields `ssl: { rejectUnauthorized: false }`, which is MITM-able;
  - `…?sslmode=verify-full&sslmode=disable` passes the guard and yields `ssl: false`, which is plaintext.
- **Valkey URL.** It checks only `url.protocol === 'rediss:'`. ioredis 6.0.0 merges query parameters into its options before it applies `tls: true` for `rediss://`, and lodash `defaults` keeps an existing `""`. So `rediss://api:…@cache:6379?tls=` yields `options.tls === ""`, which is falsy, and `StandaloneConnector` then uses `net.createConnection`: plaintext.

**Exploitability and impact.** Exploitation needs a malformed URL from the configuration author. IaC templating that appends `&sslmode=${var.mode}` to a URL that already has one is a realistic way to get there.
- Impact is H: database or Valkey credentials and data in clear, or open to MITM, inside the VPC.
- Likelihood is L.
- H×L = **MEDIUM**.

**Remediation (code level).** In `guards.ts`:
```ts
const hasDuplicateParam = (url: URL): boolean => {
  const keys = [...url.searchParams.keys()];
  return new Set(keys).size !== keys.length;
};
DATABASE_URL_KEYS.forEach((key) =>
  insecure(key, (url) => !hasDuplicateParam(url) && url.searchParams.getAll('sslmode').join(',') === 'verify-full'),
);
// No query string on the Valkey URL outside local/test: TLS and auth come from the scheme and userinfo only.
insecure('REDIS_URL', (url) => url.protocol === 'rediss:' && url.search === '');
```
For TASK-006 (and the Valkey and BullMQ client factory): build the ioredis client with an explicit `tls: { servername: host }` when `rediss:`, and do not pass the raw URL string as the only source of TLS options.

Optional, in all environments: reject duplicated query keys on every `t.url`/`t.secretUrl` key at schema level, with rule `url.duplicateParam`.

**Verification test.**
- `[NT-SEC-007-a]` with staging: `DATABASE_URL` ending in `sslmode=verify-full&sslmode=no-verify` → `insecure-transport`.
- `REDIS_URL=rediss://api:<random>@cache:6379?tls=` → `insecure-transport`.
- A property test: for any staging URL key, appending a duplicate of an existing query key is refused.

### PR3-SEC-03: single-signal environment classification (LOW)

**Description.**
- **Single signal.** `APP_ENV` alone selects every hardened behaviour: placeholder and local-only refusal, transport, debug and Mock gating, the `DOCS_ENABLED` and `MOCK_*` defaults, and reading `.env.local`. `APP_ENV` is required and closed-set, so unset or malformed values fail closed (verified, §4.1). `NODE_ENV` is never corroborated: `NODE_ENV=production` with `APP_ENV=local` loads (probe: ACCEPTED). A deployed task that declares itself `local`, for example because `compose.env` was reused, would accept the committed `local-only-*` markers as key material. Those bytes are public in git, so JWTs could be forged and the vault decrypted once the key provider derives keys from them.
- **Exported parsers.** `parseKeyVersion`, `parseKeySet` and `parsePublicKeySet` are exported and env-agnostic. They return `localOnly: true` for markers in any environment; only the placeholder guard inside `loadConfig` stops them.
- **ADR wording.** ADR-0018 §3 says start-up fails "if `NODE_ENV=production` and the Mock carrier/gateway is enabled". The code checks `APP_ENV=production`. The code is consistent with ADR-0010 am. 9 and SEC-TC-24, which allow the Mock gateway in staging, so the ADR text is what needs to change.

**Exploitability and impact.** Impact is H. Likelihood is L, and it requires a privileged operator to declare a deployed environment `local`. There is no deployed environment in Run 1, and IaC review is a separate control. H×L = MEDIUM, adjusted one step for Hard exploitability: **LOW**.

**Remediation.**

1. principal-architect chooses a corroborating signal and amends ADR-0018 §3/§4. Options:
   - (a) A `nodeEnvGuard`: `NODE_ENV=production` requires `APP_ENV ∈ {staging, production}`. `compose.env` already sets `NODE_ENV=development` and `createTestEnv` uses `test`. Check the effect on k6 runs against Compose.
   - (b) At the edge (`process-env.ts`): refuse `APP_ENV ∈ {local, test}` when `ECS_CONTAINER_METADATA_URI_V4` or `AWS_EXECUTION_ENV` is set.
   - Either way, align the §3 sentence with "`APP_ENV=production`".
2. Binding on the first task that implements the shared key provider (TASK-040, 045, 048 or 052): local-key derivation asserts its environment.
   ```ts
   if (version.localOnly && !isLocalAppEnv(config.APP_ENV)) throw new Error('local-only key material outside local/test');
   ```
   Optionally, give `parseKeyVersion` an `{ allowLocalOnly: boolean }` option that `schema.ts` sets from `appEnvOf(parent)`. Then the marker is rejected at parse time as well.
3. IaC task: `variable "app_env" { validation { condition = contains(["staging", "production"], var.app_env) } }`, with a Checkov custom check on the task definitions.

**Verification test.**
- `loadConfig({ ...createTestEnv({ appEnv: 'local' }), NODE_ENV: 'production' })` → `{ key: 'APP_ENV', code: 'inconsistent' }` (if option (a) is chosen).
- Key-provider unit test: a `localOnly` version with `APP_ENV=staging` throws.

### PR3-SEC-04: resolve timeout is advisory (LOW)

**Description.** `resolveOne` passes `AbortSignal.timeout(timeoutMs)` to the provider, then awaits the provider's own promise. A provider that ignores the signal holds start-up for as long as it likes. In the probe, `timeoutMs: 50` with a provider that resolves after 600 ms → `resolved after 613 ms`.

The PR's test uses a provider that honours `abort`, so it does not catch this. AWS SDK v3 honours `abortSignal` only if the adapter passes it through.

**Impact.** Availability only: NFR-OPS-005 says start-up must fail within 5 s. **LOW**.

**Remediation.**
```ts
const signal = AbortSignal.timeout(timeoutMs);
const timedOut = new Promise<never>((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }));
const value = await Promise.race([provider.resolve(ref.locator, signal), timedOut]);
```

**Verification test.** A provider whose `resolve` ignores `signal` and settles after `10 × timeoutMs` → `ConfigValidationError` with `{ key, code: 'unresolvable' }` within `timeoutMs + 100 ms`.

### PR3-SEC-05: secret resolution not part of start-up (LOW, latent)

**Description.** `loadConfigOrExit` returns a `Config` whose `*_REF` fields are parsed references. Three things therefore happen only if each consumer calls `resolveSecretRefs` and then `checkResolvedSecrets`:
- the refusal of live Stripe keys (`PAYMENT_LIVE_KEY_FORBIDDEN`, SEC-P3-08 item 4);
- the `rk_test_`-only rule;
- the SEC-TC-51 refusal of placeholders behind references.

This includes the `compose.env` targets `STORAGE_ACCESS_KEY_ID` and `STORAGE_SECRET_ACCESS_KEY`, which are not schema keys, so the `compose.env`-in-staging test does not cover them. Both functions are correct and unit-tested.

**Remediation.** Compose them inside `packages/config` so that a consumer cannot skip the check:
```ts
export async function resolveConfigSecrets(config: Config, providers: readonly SecretProvider[]): Promise<ReadonlyMap<ConfigKey, Secret<string>>> {
  const resolved = await resolveSecretRefs(secretRefsOf(config), providers);
  const issues = checkResolvedSecrets(resolved, { appEnv: config.APP_ENV, allowFullStripeTestKey: config.PAYMENT_ALLOW_FULL_TEST_KEY });
  if (issues.length > 0) throw new ConfigValidationError(issues);
  return resolved;
}
```
At the edge, add `loadRuntimeConfigOrExit(service, providers)`. Build the env provider over the same merged env that `readStartupEnv` returned.

**Binding requirements.**
- **TASK-006:** `apps/api/src/main.ts` and `apps/worker/src/main.ts` use it.
- **TASK-167:** the Stripe adapter accepts only a `Secret` from this map.

**Verification test (TASK-006).** Child process with `APP_ENV=staging`, `STRIPE_SECRET_KEY_REF=env:X` and `X=sk_live_<runtime-random>` → exit 78 naming `STRIPE_SECRET_KEY_REF`, and the value is not printed.

### PR3-SEC-06: register holders not enforced (LOW, latent)

**Description.** The ADR-0018 register gives a holder per key, but `holders` is metadata only. Probe at staging: both of the following load.
- `api` with `AUDIT_ANCHOR_SIGNING_KEY` set. The ADR says this key is "worker only".
- `worker` with `JWT_SIGNING_KEYS` and `CSRF_KEY` set. The ADR says "API signs; API + worker verify (public part only)", yet the register row lists `holders: ['api', 'worker']` for the private ES256 set.

`DATABASE_MIGRATOR_URL` and `SHADOW_DATABASE_URL` are optional for both services. ADR-0018 §2 says the migrator URL is "used only by the migrate job". Per the P3 review, `platform_migrator` owns the database, so an API compromise that finds the migrator URL in its environment could bypass RLS and audit immutability (O4).

`compose.env` is one file for every service.

**Impact.** Blast-radius amplification only; it needs a second vulnerability. **LOW**.

**Remediation.**
1. Make holders per variable. Split the `db` row:
   - `DATABASE_URL` → api, worker;
   - `DATABASE_MIGRATOR_URL` → migrate;
   - `SHADOW_DATABASE_URL` → local tooling only.

   Set `jwt-signing` → api. If the worker ever verifies JWTs, add a public key-set variable.
2. Add `service` to `GuardInput` and add a `holderGuard`: in `staging` and `production`, a register variable (or its `_PREVIOUS`) configured for a service outside its holders → `{ key, code: 'forbidden-in-environment' }`. `SHADOW_DATABASE_URL` is refused outside `local`/`test`.
3. TASK-014: give each Compose service only its own variables, either with per-service `environment:` or with split env files. The migrator URL goes only to the migrate one-shot.

**Verification test.**
- staging `api` with `AUDIT_ANCHOR_SIGNING_KEY` → refused, naming that key;
- staging `worker` with `JWT_SIGNING_KEYS` → refused;
- staging `api` with `DATABASE_MIGRATOR_URL` → refused.

### PR3-SEC-07: `file:` locator not confined (LOW, latent)

**Description.** `FILE_PATH = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/` plus a `..`-segment check. The header comment and `.env.example` document `file:/run/secrets/<name>`, but the following all parse:
- `file:/proc/self/environ`;
- `file:/etc/shadow`;
- `file:/run/secrets/./x`.

No file adapter exists in this PR.

**Remediation.**
- **In this PR:** `FILE_PATH = /^\/run\/secrets\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}$/`.
- **Binding for the task that implements the `file` provider (TASK-006 or TASK-014):**
  - open with `O_RDONLY | O_NOFOLLOW`;
  - `fstat`: the target is a regular file, ≤ 64 KiB, and `mode & 0o022 === 0`;
  - `realpath` stays under `/run/secrets`;
  - strip one trailing `\n`;
  - honour `signal`;
  - throw `SecretNotFoundError` with no path.

**Verification test.**
- `parseSecretRef('file:/proc/self/environ')` → `ref.filePath`.
- The adapter test refuses a symlink in `/run/secrets` that points to `/etc/hostname`.

### PR3-SEC-08: Vite's native `VITE_*` exposure (LOW, latent)

**Description.** Inside the package, the web subset is sound (§4.7). But Vite independently exposes every `VITE_*` variable from `process.env` and from `apps/*/.env*` through `import.meta.env`. TASK-004's `apps/web/vite.config.ts` and `apps/admin/vite.config.ts` (branch `feat/TASK-004-web-admin-app-scaffolds`) keep the default `envPrefix` and do not use `webBuildDefine`. So a mis-named secret such as `VITE_STRIPE_SECRET_KEY` in a build environment would be inlined wherever it is referenced. The schema cannot prevent this.

**Remediation (in TASK-004, or the first task that wires the web config).**
```ts
import { loadWebBuildConfig, webBuildDefine } from '@platform/config/web';
export default defineConfig({
  envPrefix: 'PLATFORM_NO_IMPLICIT_ENV_', // nothing reaches import.meta.env implicitly
  define: webBuildDefine(loadWebBuildConfig(process.env)),
  // …existing plugins/resolve
});
```
Then add a post-build test over `build/client/**/*.js`. It fails when:
- the value of any `SECRET_KEY_NAMES` variable present in the build environment appears in the bundle;
- or any `looksLikeSecret` shape from `tools/config/env-file.ts` appears.

### PR3-SEC-09 (INFO): key-material checks

- **Raw-byte comparison has blind spots.** `findDuplicateKeyMaterial` compares SHA-256 digests of the decoded bytes. HMAC zero-pads keys up to the 64-byte block and hashes longer keys, so these pairs are the same HMAC key but are not detected:
  - K and K‖0x00 (probe: ACCEPTED);
  - a key longer than 64 bytes and `SHA-256(key)`.

  Two PKCS#8 encodings of one EC key are not detected either.
  Fix: fingerprint HMAC rows on `key.length > 64 ? sha256(key) : key.padEnd(64, 0)`, and EC rows on the public point (`createPublicKey(priv).export({ format: 'der', type: 'spki' })`).
- **Low-entropy keys pass.** 32 zero bytes pass in staging. Fix: reject keys made of a single repeated byte.
- **Comparison method.** The comparison is not constant-time. That is acceptable: it runs once at start-up on operator input, so there is no attacker-observable timing channel, and the digests never leave the function.
- **Mutable buffers.** `Secret<Uint8Array>.reveal()` returns the shared buffer, so one consumer could zero a key for every other consumer. Fix: return a copy, or document that consumers must import it once into a `KeyObject` (`createSecretKey`).

### PR3-SEC-10 (INFO): placeholder-pattern precision (reviewer focus 2)

Security-wise the list is adequate:
- every `.env.example` secret is `CHANGE_ME` or `<key_id>-v1:CHANGE_ME`;
- every `compose.env` secret contains `local-only-`;
- both are refused in staging (tests in `tools/config`);
- key variables cannot use exotic variants, because anything that is neither canonical base64 nor the strict marker grammar fails as `key.encoding` in every environment.

A real `<…>`-shaped value does matter, but only for availability. `/<[^<>]*>/` is unanchored, so a generated password containing `<`…`>` is refused as a placeholder (`p<a>ss` → true). Secrets Manager `GetRandomPassword` can emit both characters. The same applies to whole-value `secret`/`password`/`xxx`, and to `changeme` anywhere in a value.

Suggested refinements:
- anchor `<…>` to the whole value or to the URL userinfo (`/^<[^<>]+>$/` and `/:<[^<>]+>@/`);
- percent-decode URL userinfo and apply NFKC before matching, so fullwidth or `%5F` variants of `CHANGE_ME` are caught;
- keep the refusal fail-closed.

### PR3-SEC-11 (INFO): notes for later tasks

1. **AWS Secrets Manager adapter (M5).**
   - What the locator regex already handles: a region with a dot (`evil.example.com`) fails to parse, so the endpoint host cannot be injected. The SDK sends `SecretId` in the JSON body, so names such as `../../x` are inert.
   - What the adapter must add: a cross-account ARN (`…:999999999999:secret:…`) parses. Pin the region to the configured `REGION` and the account to an allow-list.
2. **TASK-002 boundaries.** Only `*.test.ts`, `tests/**` and `tools/**` may import `@platform/config/testing`.
3. **TASK-018 and principal-architect: SEC-TC-18 vocabulary.** threat-model R-12 and SEC-TC-18 say "refused outside `APP_ENV=benchmark`", but `APP_ENVS` has no `benchmark`. ADR-0007 item 4 says the `-bench` image refuses `staging`/`production`. Align the text before TASK-018 adds the build profile; the refusal belongs in `packages/config` guards.

## 4. Reviewer focus: answers

1. **Local-only key derivation unreachable in staging and production.** Holds at the `loadConfig` boundary.
   - `APP_ENV` is `required` and `valid('local','test','staging','production')`, with no trimming or case folding. Every spoofing variant I tried is rejected (`any.only` / `missing`): `Production`, `PRODUCTION`, leading or trailing space, `prod`, dotless-ı `stagıng`, empty, unset. That is fail-closed.
   - The marker grammar, `^local-only-[a-z0-9]+(?:-[a-z0-9]+)*$` (case-sensitive, anchored, `keys.ts:417`), matches a strict subset of the strings that the guard's `/local-only-/i` matches. So no `KeyVersion` with `localOnly: true` can leave `loadConfig` when `APP_ENV ∈ {staging, production}`.
   - Variants (`LOCAL-ONLY-x`, surrounding whitespace, U+2010 hyphens) are rejected as `key.encoding` in *every* environment.
   - The derivation itself is not in this PR. The residual risks are the single-signal environment and the exported parsers: PR3-SEC-03.
2. **Placeholder bypass via case, whitespace or Unicode.** None is relevant for key variables (see above). For URLs and seed passwords the denylist is case-insensitive and unanchored; the exact-word patterns are anchored but irrelevant inside URLs. It catches every `.env.example` and `compose.env` value. Precision notes are in PR3-SEC-10.
3. **Duplicate key material.**
   - **Covered:** cross-variable, cross-kid (`JWT_SIGNING_KEYS` with the same material under two kids) and `_PREVIOUS`-against-another-purpose reuse.
   - **Method:** comparison is by SHA-256 of the decoded bytes, so non-canonical base64 of the same bytes is still caught. The material and the digests stay inside `findDuplicateKeyMaterial`. Issues name only the variables, and the tests assert that the material is absent from the rendered error.
   - **Constant time:** not needed (PR3-SEC-09).
4. **Secret references.**
   - **Grammar:** `env` requires an upper-snake name; `file` requires an absolute path without a `..` segment, but has no prefix confinement (PR3-SEC-07); `aws-secrets-manager` requires a partition `aws[a-z-]*`, a region `[a-z0-9-]+` that cannot inject a host, a 12-digit account and AWS name characters.
   - **Timeout:** 2 s per call via `AbortSignal.timeout`, but advisory (PR3-SEC-04).
   - **Errors:** `SecretNotFoundError` carries no locator. Every failure becomes `{ key, code: 'unresolvable' }`, and the test asserts that the locator is absent.
   - **Leakage probe:** a sentinel value in 8 keys never appears in `message`, `formatConfigError`, `issues` or `stack`.
5. **`.env.example` holds placeholders only.** Verified from the GitHub diff (`.env.example` +151; I did not open it locally).
   - Every secret key is `CHANGE_ME` or `<key_id>-v1:CHANGE_ME`.
   - The DB and Valkey URLs embed `CHANGE_ME`.
   - `VITE_STRIPE_PUBLISHABLE_KEY` and the `_PREVIOUS` keys are empty.
   - No added line has a key, token or credential shape.
   - `compose.env`: every credential is `local-only-*`, and there is no `STRIPE_*` or `CARRIER_*_SECRET*`, as the test asserts. `.env.local` is git-ignored (`.gitignore:19-21`).
6. **`key_id` per row and rotation fields.** Verified.
   - The register has 25 frozen rows with unique `keyId` (test). Each row carries `algorithm`, `purpose`, `holders`, `storage`, `rotation`, `dualRead` and `blastRadius`, mirroring the ADR-0018 table.
   - Key values must be `<purpose>-v<n>`, with the purpose matching the row (`key.purpose`).
   - `_PREVIOUS` exists exactly for the `dualRead` rows and must be an older version.
   - AES keys are exactly 32 bytes; HMAC keys are at least 32 bytes; ES256 and anchor keys must be P-256 PKCS#8; public anchor keys must be P-256 SPKI.
   - Holder enforcement is missing: PR3-SEC-06.
7. **The Zod web subset cannot expose server secrets.** Verified within the package.
   - Only `VITE_*`/`BRAND_*` keys, and none is in `SECRET_KEY_NAMES` (test).
   - `z.object` strips unknown keys, and `webBuildDefine` iterates only the validated output.
   - `pk_live_` is refused.
   - The `web` entry imports no Node built-ins.
   - Outside the package, Vite's native exposure is PR3-SEC-08.

## 5. SEC-TC coverage: claimed against verified

| Case | Claimed by PR | Verified at `be468bc` | Remaining / owner |
|---|---|---|---|
| SEC-TC-49 (config part) | Yes | **VERIFIED**: `load-config.test.ts` `[SEC-TC-49]` ×7 (identical material named, property over all symmetric pairs, retired key reused, two kids, local-only markers, `key_id` purpose, 32-byte floor, `_PREVIOUS` ordering); `keys.test.ts` ×4 (25 rows, unique `key_id`, register ↔ schema parity, dual-read rows). Probes agree | Edge cases PR3-SEC-09 (INFO). Vault part (ciphertext `key_id`, AAD swap): TASK-128 |
| SEC-TC-51 (start-up part) | Yes | **VERIFIED for direct schema values**: property test over every configured secret × 6 placeholder shapes in staging; both hardened envs; `.env.example` loaded with `APP_ENV=staging` refuses every placeholder; `compose.env` with `APP_ENV=staging` refuses its markers. **PARTIAL for `*_REF` targets**: `checkResolvedSecrets` is unit-tested but not wired into start-up | PR3-SEC-05: TASK-006. CI-policy part: TASK-007 |
| SEC-TC-24 (config part) | No (covered anyway) | Production refuses `MOCK_CARRIER_ENABLED`, `MOCK_SCENARIOS_ENABLED`, `PAYMENT_PROVIDER=mock` and `MOCK_GATEWAY_WEBHOOK_SECRET`; staging with the Mock gateway requires its HMAC secret (`companionGuard`) | Route-table part: payments/webhooks task |
| SEC-TC-03 (config part) | No | Partial: `SEED_*` local-only or placeholder values are refused in staging | Seed abort and staff without passwords: TASK-023 |
| SEC-TC-18 | No | Not covered (no build profile yet) | TASK-018; vocabulary note PR3-SEC-11 |
| SEC-P3-08 item 6 (debug flags) | Yes | **PARTIAL**: the plain `--inspect`, `NODE_DEBUG` and `DEBUG` forms are refused; quoted and underscore forms bypass | PR3-SEC-01 |
| NT-SEC-007-a (TLS outside local/test) | Yes (tests) | **PARTIAL**: scheme and first-`sslmode` checks are correct; duplicate-param and `?tls=` bypasses | PR3-SEC-02 |
| SEC-P3-08 item 4 (Stripe `rk_test_`, no live key) | Yes | Unit-verified in `checkResolvedSecrets`; start-up wiring pending | PR3-SEC-05: TASK-006, TASK-167 |
| AT-US-002-03 (bcrypt floor 12) | Yes | VERIFIED (schema `min(12)`, property test over −1000..1000) | — |

## 6. Follow-ups routed to named tasks (binding)

| Task | Requirement | From |
|---|---|---|
| **This PR (recommended)** or TASK-006 | Tokenised and normalised NODE_OPTIONS check (allow-list in hardened envs) plus the `inspector.url()` / `execArgv` belt at the edge, with the tests in PR3-SEC-01 | PR3-SEC-01 |
| **This PR (recommended)** or TASK-006 | Duplicate-param and `getAll('sslmode')` checks; no query string on `REDIS_URL` outside local/test, with tests | PR3-SEC-02 |
| This PR (optional) or TASK-006 | `Promise.race` timeout in `resolveOne`, with a test for a provider that ignores the signal | PR3-SEC-04 |
| This PR (optional) | `FILE_PATH` confined to `/run/secrets/<name>` | PR3-SEC-07 |
| TASK-006 | Start-up uses a composed resolve-and-check (`resolveConfigSecrets` / `loadRuntimeConfigOrExit`); child-process test for a live Stripe key and a placeholder behind a reference; ioredis built with explicit `tls` | PR3-SEC-05, PR3-SEC-02 |
| TASK-006 or TASK-014 (whichever adds the `file` provider) | `O_NOFOLLOW`, regular file, realpath under `/run/secrets`, size cap, mode check, signal, path-free errors | PR3-SEC-07 |
| TASK-014 | `node --disable-sigusr1` in runtime `CMD`; per-service env, with the migrator URL only in the migrate one-shot | PR3-SEC-01, PR3-SEC-06 |
| TASK-004 (or the first task wiring `@platform/config/web`) | Non-matching `envPrefix`, `define: webBuildDefine(loadWebBuildConfig(process.env))`, post-build bundle secret scan | PR3-SEC-08 |
| First key-provider task (TASK-040 / 045 / 048 / 052) | Local-key derivation asserts `isLocalAppEnv(config.APP_ENV)`; import keys once into `KeyObject`s | PR3-SEC-03, PR3-SEC-09 |
| TASK-167 | The Stripe adapter takes only a resolved and checked `Secret` | PR3-SEC-05 |
| TASK-002 | Boundaries rule: `@platform/config/testing` imported only from tests and tools | PR3-SEC-11 |
| TASK-018 | Bench-image refusal lives in `packages/config` guards; align the `APP_ENV=benchmark` wording first | PR3-SEC-11 |
| principal-architect | ADR-0018 §3 sentence (`NODE_ENV=production` → `APP_ENV=production`); choose the corroborating signal (PR3-SEC-03 option a or b); per-variable holders and `jwt-signing` holder (public part for the worker); SEC-TC-18 vocabulary | PR3-SEC-03, PR3-SEC-06, PR3-SEC-11 |
| IaC task (M5) | Terraform `app_env` variable validation plus a Checkov custom check; Secrets Manager adapter pins region and account | PR3-SEC-03, PR3-SEC-11 |

## 7. Evidence (PR head `be468bc`)

| Check | Result |
|---|---|
| `gh pr view 3` / `gh pr diff 3` | head `be468bca`, 2 commits, 32 files, +3,572 / −4; base `4da693a` |
| Worktree state | `git rev-parse HEAD` = `be468bc`; `git status --porcelain` empty; `dist/*.js` mtimes ≥ sources |
| Probe (`probe.mjs`) | APP_ENV variants all rejected; `NODE_ENV=production` + `APP_ENV=local` ACCEPTED; NODE_OPTIONS: plain `--inspect` refused, 7 other forms accepted; duplicate `sslmode` ACCEPTED (×2); local-only variants: correct in all 12 cases; K / K‖00 ACCEPTED; zero key ACCEPTED; non-holder keys ACCEPTED (×2); `file:/proc/self/environ` and `/etc/shadow` parse OK; ARN with a dotted region rejected; cross-account ARN OK; signal-ignoring provider resolved after 613 ms against a 50 ms budget |
| Probe (`probe2.mjs`) | A sentinel value in 8 invalid keys never appears in message, formatted report, issues or stack |
| Node inspector | `NODE_OPTIONS='"--inspect=127.0.0.1:0"'` → `Debugger listening`, `inspector.url()` set; `--inspect_brk=…` and `--inspect_wait=…` → `Debugger listening` (Node 24.22.3) |
| node-postgres | `pg` 8.23.1 / `pg-connection-string` 2.14.1: `sslmode=verify-full&sslmode=no-verify` → `{ rejectUnauthorized: false }`; `…&sslmode=disable` → `ssl: false` |
| ioredis | 6.0.0: `rediss://…` → `options.tls === true`; `rediss://…?tls=` → `options.tls === ""` (connector branch `if (options.tls)` → `net`) |
| Secret-shape scan of added lines | 0 key, token, PEM, AWS or Stripe shapes; URL-credential hits are only `CHANGE_ME`, `local-only-*` or a test fixture |
| Lockfile | `packages/config` declares `zod ^4.6.7` (already locked, MIT); no package entry added or changed |
| Not run (host constraints) | `npm ci`, build, unit suites, gitleaks (Docker), Semgrep (not installed). PR evidence accepted: 226/226 tests, coverage 99.89 % lines / 97.69 % branches |
