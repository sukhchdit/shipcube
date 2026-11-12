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

## Round 2 (head 875409d)

| Field | Value |
|---|---|
| Delta | `be468bc..875409d`, 1 commit (`875409d fix(config): review fix cycle 1 for TASK-005 (PR #3 round 1)`), 27 files, +1,650 / −156. `gh pr view 3`: head `875409d4`, OPEN, MERGEABLE |
| Fix comment | https://github.com/sukhchdit/shipcube/pull/3#issuecomment-6825516810 |
| Reviewer / date | security-analyst, 2026-11-12. Review by SHA only: the `Shipqube-TASK-005` worktree was not touched, because a merge-main pass runs there. Node 24.22.3 |
| **Verdict** | **PASS_WITH_FOLLOW-UPS. No Critical or High finding is open, so merge is allowed.** **Closed:** PR3-SEC-01, -02 (every round-1 vector), -04, -07 (adapter hardening residue routed as INFO), -10. **Open:** PR3-SEC-03 stays LOW (partly remediated). **New:** one MEDIUM, PR3-SEC-12: an opaque `rediss:` URL passes the Valkey guard, and ioredis then sends the password in clear. It is a ~5-line fix, so I recommend landing it in this PR; otherwise it is binding on TASK-006. Also new: PR3-SEC-13 LOW, PR3-SEC-14 LOW (latent) and PR3-SEC-15 INFO |

### R2.1 Method

- **Code read.** Every changed non-test source, in full, read from `git archive 875409d` into the scratchpad. Tests were read for every claimed PR3-SEC vector.
- **Probes ran against the PR's own code.**
  - Setup: the `875409d` sources were transpiled with Node 24's `module.stripTypeScriptTypes` into the session scratchpad (`review/PR-3-sec-r2/build`). That build resolves `node_modules` from the main checkout, which has the same locked versions: joi 18.3.2, pg 8.23.1, pg-connection-string 2.14.1, ioredis 6.0.0, zod 4.6.7, fast-check.
  - Scripts and outputs sit in `review/PR-3-sec-r2/probes/`:
    - `transport.mjs`, `redis-wire.mjs`: guard against driver;
    - `node-options.mjs`, `belt.mjs`: guard against Node's own parser and the process edge;
    - `misc.mjs`: NODE_ENV, tooling keys, placeholders, timeout, leakage, file provider;
    - `envdiff.mjs`, `shapescan.mjs`: value-free checks of the env files and of secret shapes.
  - Credentials are runtime-random. Output is booleans and issue codes; inspector URLs are redacted.
- **Driver behaviour was observed, not inferred.**
  - For pg: `pg/lib/connection-parameters` on each URL.
  - For ioredis: `parseURL` plus the exact `startsWith("rediss://")` test from `ioredis/built/Redis.js:707`.
  - A loopback TCP listener captured the first bytes ioredis sends for a guard-accepted URL.
- **Env files.** The `.env.example` and `compose.env` changes were checked only with a classifier that prints each key with a shape class and the `isPlaceholder` verdict, never the value.
- **Not run, per the constraints:** `npm ci`, the build, the unit suites, gitleaks and Semgrep. I accept the PR gate evidence: 430/430 tests; `packages/config` coverage 99.91 % lines and 97.56 % branches; `npm audit --audit-level=high` exit 0.

### R2.2 Round-1 findings: status at `875409d`

| ID | R1 severity | Status | Verification |
|---|---|---|---|
| PR3-SEC-01 | MEDIUM | **Closed** | `nodeOptionTokens` matches Node's `ParseNodeOptionsEnvVar`: double quotes group a token, and `\` escapes only inside quotes. It splits on any `\s`, while Node splits on space only, so the guard is stricter than Node. Option names are normalised (`'` dropped, cut at `=`, `_`→`-`, lower-cased), and the `--inspect*` / `--debug*` prefixes are refused. Differential probe over 17 forms: **no form for which Node 24.22.3 starts the inspector is accepted.** Details: the quoted, mid-token-quoted, escaped, `--inspect_port` and empty-quotes-prefix (`"" --inspect=…`) forms are refused, and the inspector is on in each. Tab, newline and NBSP separators and upper-case flags are refused by the guard, and Node will not start with them (exit 9). `--experimental-config-file` and `--experimental-default-config-file` (a `nodeOptions.inspect` route) exit 9 inside NODE_OPTIONS. The process-edge belt (`process-env.ts:71-76`) works: CLI `--inspect=127.0.0.1:0` → exit 78 with `NODE_OPTIONS: debug-flag: runtime.inspector`; quoted NODE_OPTIONS → exit 78; the control → exit 0 and ready. Residual risks: PR3-SEC-13 (new) and SIGUSR1 (TASK-014, unchanged) |
| PR3-SEC-02 | MEDIUM | **Closed (all round-1 vectors)**; successor PR3-SEC-12 | **PostgreSQL** (`guards.ts:54-55`). Refused: a duplicate `sslmode`, including a percent-encoded key name (`ssl%6Dode=disable`), because `URLSearchParams` decodes keys exactly as pg-connection-string does; any `ssl=` parameter; a missing `sslmode`. With `verify-full`, pg yields `ssl:{}` and `rejectUnauthorized` keeps its default of true. `uselibpqcompat=true&sslmode=verify-full` keeps verification: the source has `case 'verify-full': break`, and the probe shows no `checkServerIdentity` override. Joi rejects the two forms where pg reads a URL differently from the guard: the empty-host `user:pw@/db?host=…` form (pg's `___DUMMY___` fallback would accept it as plaintext), and upper-case schemes. **Valkey:** `?tls=`, `?tls=false` and `?family=4` are refused. Plain `rediss://` gives a TLS ClientHello on the wire (`0x16`). **New vector:** PR3-SEC-12 |
| PR3-SEC-03 | LOW | **Open (LOW), partly remediated** | `nodeEnvGuard` (`guards.ts:139-142`) adds the **converse** check: a hardened `APP_ENV` requires the raw `NODE_ENV=production`. With `APP_ENV=staging`, an unset, `development` or `" production"` NODE_ENV is refused, which fails closed. **The round-1 scenario is still accepted.** `APP_ENV=local` with `NODE_ENV=production` and a `local-only-*` `CSRF_KEY` → ACCEPTED, and `localOnly: true` reaches `Config`. The remaining remediation is unchanged: principal-architect picks round-1 option (a) or (b) (option (b) fits best because it has no local impact: refuse `APP_ENV ∈ {local, test}` when `ECS_CONTAINER_METADATA_URI_V4` or `AWS_EXECUTION_ENV` is set); the first key-provider task asserts `isLocalAppEnv` before using local-only material; the IaC task validates `app_env` |
| PR3-SEC-04 | LOW | **Closed** | `attemptResolve` races the provider against `AbortSignal.any([per-attempt timer, overall deadline])` (`secret-refs.ts:161-179`). Probes: a provider that never settles, with a 50 ms budget → `ref.timeout` after 363 ms (two attempts plus 100–300 ms jitter); a provider that ignores the signal and settles at 600 ms → cut off at about 310 ms. With the defaults (2 s per attempt, 4.5 s deadline), the whole call stays at or under 4.5 s, inside NFR-OPS-005's 5 s. There is no unhandled-rejection path: `race` subscribes to the provider promise, the abort listener is removed in `finally`, and the deadline is checked synchronously before the subscription. Budgets must be positive safe integers |
| PR3-SEC-05 | LOW | Open (latent); unchanged | Routed to TASK-006 (binding), as in round 1 |
| PR3-SEC-06 | LOW | **Open (latent), partly remediated** | Tooling keys are now outside the runtime schema. The API and the worker refuse all 7 of them by name with `APP_ENV=staging` (probe 7/7); none reaches `Config` in local; an empty value counts as absent. Still open: `AUDIT_ANCHOR_SIGNING_KEY` in the API, the private `JWT_SIGNING_KEYS` in the worker, and per-service env. Note for TASK-014: the shared `compose.env` now also carries `DATABASE_BOOTSTRAP_URL` (cluster admin, local-only marker) for **every** Compose service, so per-service env now matters more |
| PR3-SEC-07 | LOW | **Closed**; residual hardening is INFO and routed | **Parser** (`secret-refs.ts:39`): 1–4 segments under `/run/secrets`; no segment may start with a dot; 10 negative vectors are tested. **Adapter** (`file-secret-provider.ts`): `realpath` confinement holds. On this Windows host, a junction under the root that points outside → `SECRET_FILE_OUTSIDE_ROOT`. Also refused: `../` traversal, `/etc/shadow` and `/run/secretsX/…`. A directory → `NOT_REGULAR`; 70 KiB → `TOO_LARGE`; ENOENT → `SecretNotFoundError`. Error messages carry no path and have no `cause`. POSIX analysis: `relative(realRoot, realTarget)` that starts with `..` or is absolute, or the root itself, is refused. **Residual hardening (INFO; the PR also routes it to TASK-006/TASK-014):** (1) the file is opened by path after `realpath`, which leaves a TOCTOU window for anyone who can write to the secrets mount; (2) `readFile` is unbounded and the cap is applied only after the read (the seam probe materialised 32 MiB before refusing); (3) there is no `mode & 0o022` check. Fix: `const fh = await open(realTarget, O_RDONLY \| O_NOFOLLOW)`, then `fh.stat()`, then read at most `maxBytes + 1` from `fh`. Exploitation needs prior write access to a read-only tmpfs |
| PR3-SEC-08 | LOW | Open (latent), narrowed | PR #4 at `9f5ea5e` sets `envPrefix: 'VITE_PUBLIC_'` for web and admin, with tests. A post-build bundle secret scan is still owed (TASK-022 / web config owner) |
| PR3-SEC-09 | INFO | Open, narrowed | Mutable-buffer item closed: `reveal()` returns a copy of the `Uint8Array` (`secret.ts`). HMAC-equivalent keys and low-entropy keys remain open |
| PR3-SEC-10 | INFO | **Closed** | Detected: `CHANGE_ME`, its full-width form, `CHANGE%5FME`, `%43HANGE_ME` in URL userinfo, `jwt-signing-v1:CHANGE_ME`, `<key_id>-v1:CHANGE_ME`, `<password>`, `user:<password>@`, `Change Me`. Not detected, as intended: `p<a>ss`, `exchangemerchant`. Property: across 300 runs, every value that the key parser accepts as a local-only marker in `local` is refused as `placeholder` in staging, with 0 escapes. Not caught, and not a bypass of the accident net, because none of them decodes to the placeholder in the driver: a zero-width-space prefix, a `%20` prefix, `%255F` double encoding, and a UTF-8 percent-encoded full-width letter. Every new `.env.example` secret is `CHANGE_ME` or a URL with `CHANGE_ME` userinfo, and is detected. Every new `compose.env` credential contains `local-only-` and is detected |
| PR3-SEC-11 | INFO | Open; unchanged | — |

### R2.3 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR3-SEC-12 | Valkey guard accepts an opaque `rediss:` URL (no `//`), which ioredis sends over plain TCP with the password in clear. The transport guard also fails open when WHATWG `URL` cannot parse a value | MEDIUM | CWE-319, CWE-436 | A02 | `packages/config/src/guards.ts:62`, `:68-71` | senior-developer **in this PR** (recommended); else binding on TASK-006, together with the explicit ioredis `tls` | Open |
| PR3-SEC-13 | The debug guard detects but cannot prevent. Node applies NODE_OPTIONS before any JS runs, so `--inspect-brk` and `--inspect-wait` pause the process before `loadConfigOrExit` and the guard never runs. `--require` and `--import` preloads are accepted and run before the guard | LOW | CWE-489, CWE-696 | A05 | `guards.ts:124-133`; `process-env.ts:79-91`; runtime image (TASK-014) | TASK-014 (entrypoint preflight, `--disable-sigusr1`); IaC task (M5) | Open |
| PR3-SEC-14 | Tooling credentials have no start-up validation. `DATABASE_MIGRATOR_URL` (whose role owns the DB) and `DATABASE_BOOTSTRAP_URL` are no longer checked for placeholders or TLS anywhere; `prisma.config.ts` reads them raw | LOW (latent) | CWE-319, CWE-693 | A05 | `tooling-keys.ts`; `prisma.config.ts:14` on `feat/TASK-003-…` @ `1f9c192` | senior-developer (`packages/config` helper: this PR or TASK-006); TASK-003 / TASK-014 (migrate one-shot calls it) | Open (latent until a deployed migrate job) |
| PR3-SEC-15 | `describeFailureCause` trusts `error.constructor.name`, and a thrown object can override it with an own `constructor` property | INFO | CWE-209, CWE-532 | A09 | `secret-refs.ts:138-144` | senior-developer (optional) | Open |

#### PR3-SEC-12: opaque `rediss:` URL passes the Valkey guard (MEDIUM)

**Description.** The guard and ioredis disagree on what counts as a `rediss://` URL.

- **What the guard sees.** `isTlsRedisUrl` checks `url.protocol === 'rediss:' && url.search === ''` on a WHATWG `URL`. WHATWG parses `rediss:api:<pw>@cache:6379` (no `//`) as an opaque URL with protocol `rediss:` and an empty search. Joi `uri()` also accepts it, as an RFC 3986 `path-rootless` URI. Probe at staging: **ACCEPTED**.
- **What ioredis does.** ioredis 6.0.0 turns on TLS only when the **raw string** `startsWith("rediss://")` (`built/Redis.js:707`). Its `parseURL` sees no `//`, so it re-parses the value as `redis://rediss:api:<pw>@cache:6379`. The result: username `rediss`, password `api:<pw>`, host `cache`, port 6379, plain TCP.
- **On the wire.** Loopback capture: the first byte is `*` (plaintext RESP), and the runtime-random password is present in the clear. The control `rediss://…` sends `0x16` (TLS ClientHello).
- **Variants.** `rediss:%2F%2Fapi:<pw>@…` behaves the same way.
- **Fail-open on parse failure.** `transportGuard` skips a key when `new URL()` throws (`url !== undefined && …`). A `DATABASE_URL` with port `99999` and `sslmode=disable` is ACCEPTED in staging. pg 8.23.1 throws on that value as well, so it is not exploitable today. Still, the guard should not depend on the driver failing.

**Exploitability and impact.**
- The configuration author has to write a malformed URL: a missing `//`, or templating that joins `${scheme}:${userinfo}@…`.
- The attacker needs a passive position inside the VPC.
- AUTH then fails, because the username is wrong, so no working session is opened. But the Valkey password crosses the network in clear on every reconnect, and ioredis and ECS both retry.
- Impact is H: the Valkey ACL credential gives access to BullMQ queues, rate-limit state and cache. Likelihood is L. H×L = **MEDIUM**. This is the same rating as PR3-SEC-02.
- TASK-006's binding requirement (build ioredis with an explicit `tls` when the URL is `rediss:`) would mitigate this at the consumer. The guard is the control under review, though.

**Remediation (code level, `guards.ts`).**
```ts
/** Mirrors ioredis 6.0.0: TLS only when the raw value starts with `rediss://` (Redis.js:707). */
const isTlsRedisUrl = (raw: string, url: URL): boolean =>
  raw.startsWith('rediss://') && url.hostname !== '' && url.search === '' && url.hash === '';
const isVerifiedPostgresUrl = (_raw: string, url: URL): boolean =>
  url.hostname !== '' && !hasDuplicateParam(url) && url.searchParams.get('sslmode') === 'verify-full' && !url.searchParams.has('ssl');

// transportGuard: outside local/test an unparseable URL is insecure (fail closed).
const insecure = (key: string, secure: (raw: string, url: URL) => boolean): void => {
  const value = raw[key];
  if (value === undefined) return;
  const url = parseUrl(value);
  if (url === undefined || !secure(value, url)) issues.push({ key, code: 'insecure-transport' });
};
```
Optional defence in depth for PostgreSQL: allow-list the query parameter names. Allow `sslmode`, `application_name`, `connect_timeout`, `sslrootcert`, `uselibpqcompat` and `sslnegotiation`, and refuse everything else. The probe shows these are accepted today:
- `host=/var/run/postgresql`: a Unix socket, so no TLS;
- `host=<other>`: overrides the authority;
- `options=-c …`: server GUCs. These cannot weaken client TLS; for a role without BYPASSRLS, `row_security=off` makes RLS-protected queries fail rather than bypass the policies.

**Verification test.**
- With `APP_ENV=staging`, each of `rediss:api:{p}@cache:6380`, `rediss:%2F%2Fapi:{p}@cache:6380` and `rediss://api:{p}@cache:6380#x` → `[{ key: 'REDIS_URL', code: 'insecure-transport' }]`.
- `DATABASE_URL=postgresql://platform_app:{p}@db:99999/platform?sslmode=disable` → `insecure-transport`.
- Control: `rediss://api:{p}@cache:6380/0` is still accepted.

#### PR3-SEC-13: the debug guard detects but cannot prevent (LOW)

**Description.** Node parses NODE_OPTIONS and starts the inspector before the entry module runs. So:
- with `--inspect`, the inspector listens from process start until `loadConfigOrExit` exits with 78;
- with `--inspect-brk=…` or `--inspect-wait=…`, Node pauses **before** the entry module. The probe child hung for 4 s with no output for both forms, and the guard never ran. Whoever attaches first runs code before the guard does. On ECS the task fails its health checks and is restarted, which reopens the window each time;
- `--require` and `--import` preloads are accepted (round 1's allow-list was not adopted), and they also run before the guard.

**Exploitability and impact.** Impact is C: code execution with the task role. Two independent misconfigurations are needed (NODE_OPTIONS in the task definition, and a security group that opens 9229), plus a position inside the VPC. **LOW.**

**Remediation.**
1. **TASK-014.** Validate NODE_OPTIONS in an entrypoint preflight that runs with NODE_OPTIONS unset, then exec the service:
   ```sh
   #!/bin/sh
   set -eu
   env -u NODE_OPTIONS node /app/dist/preflight.js   # nodeOptionTokens + option-name allow-list when APP_ENV is staging/production; exit 78 otherwise
   exec node --disable-sigusr1 /app/dist/main.js
   ```
   Allow-list: `--max-old-space-size`, `--max-semi-space-size`, `--enable-source-maps`, `--no-deprecation`, `--disable-sigusr1`.
2. **IaC task (M5).**
   - A Checkov custom check that refuses `NODE_OPTIONS` in ECS task definitions unless the value matches the allow-list.
   - Security groups never open 9229.

**Verification test (TASK-014 container test).** `docker run -e APP_ENV=staging -e NODE_OPTIONS=--inspect-wait=0.0.0.0:9229 <image>` exits 78 within 5 s, and nothing listens on 9229.

#### PR3-SEC-14: tooling credentials are not validated at start-up (LOW, latent)

**Description.** Moving `DATABASE_MIGRATOR_URL`, `SHADOW_DATABASE_URL` and the bootstrap credentials out of the runtime schema is right for least privilege, and it closes part of PR3-SEC-06. But no code path checks them any more:
- `prisma.config.ts:14` on the TASK-003 branch (`1f9c192`) reads `process.env['DATABASE_MIGRATOR_URL']` directly;
- `tools/db/reset.ts` only checks that the endpoints match.

A staging migrate job with `sslmode=disable`, or with a `CHANGE_ME` URL, would not be refused. `platform_migrator` owns the database (O4).

**Impact.** Credential and DDL traffic in clear, or a placeholder deployed. This is latent: no migrate job is deployed before M5 / TASK-014. **LOW**, consistent with PR3-SEC-05.

**Remediation.** Export a pure helper from `packages/config`, and call it first thing in `prisma.config.ts` and `tools/db/*.ts`:
```ts
export function checkToolingEnv(env: EnvInput, options: { readonly tool: 'migrate' | 'bootstrap' }): void {
  // APP_ENV required and closed-set (same schema rule as runtime); outside local/test:
  //  - placeholder guard over every configured tooling key;
  //  - DATABASE_MIGRATOR_URL / DATABASE_BOOTSTRAP_URL must pass isVerifiedPostgresUrl;
  //  - SHADOW_DATABASE_URL and the BOOTSTRAP_* keys are forbidden-in-environment (role bootstrap is local/IaC only).
  // Throws ConfigValidationError with key names only.
}
```

**Verification test.** With `APP_ENV=staging`:
- `DATABASE_MIGRATOR_URL=…sslmode=disable` → `insecure-transport`;
- `…:CHANGE_ME@…` → `placeholder`;
- `SHADOW_DATABASE_URL` set → `forbidden-in-environment`.

#### PR3-SEC-15 (INFO): failure cause read from an overridable property

**Description.** `describeFailureCause` reads `error.constructor.name` and accepts any identifier of up to 64 characters. In the probe, a provider that throws `Object.assign(new Error('x'), { constructor: { name: <value> } })` puts a 28-character `sk_test_…` value into `cause` (`leaks: true`).

**Impact.** Exploitation needs a provider that copies data into an error's `constructor`, which code-defined adapters do not do. The PR's property test covers the message, code, name and raw channels, but not this one. **INFO.**

**Fix.**
```ts
const proto: unknown = Object.getPrototypeOf(error);
const ctor = typeof proto === 'object' && proto !== null && Object.hasOwn(proto, 'constructor') ? (proto as { constructor: { name?: unknown } }).constructor : undefined;
const name = typeof ctor?.name === 'string' && /^[A-Z][A-Za-z]{0,48}(?:Error|Exception)$/.test(ctor.name) ? ctor.name : 'Error';
```
Then add a `constructor` throwable to the property test.

### R2.4 Reviewer focus: answers

1. **NODE_OPTIONS tokeniser against Node 24.22.3.**
   - Quotes and escapes match Node exactly.
   - Whitespace splitting is stricter than Node's.
   - `_`/`-`, `=` and case are normalised.
   - `execArgv` and `inspector.url()` are both checked at the edge.
   - No accepted form starts the inspector. Remaining gaps: the guard cannot prevent, only detect (PR3-SEC-13), and SIGUSR1 (TASK-014).
2. **pg URL guard.**
   - Duplicates are refused, including encoded key names.
   - `ssl`, `sslmode` and `uselibpqcompat` variants are correct.
   - `sslrootcert` and `sslcert` are accepted. pg reads these files at parse time, and they do not weaken `verify-full`.
   - `options=` and `host=` are accepted; an allow-list is optional (PR3-SEC-12).
   - Joi blocks the empty-host dummy fallback.
3. **Valkey.** `rediss://host` with no query gives TLS. The opaque form does not: PR3-SEC-12.
4. **Placeholders.** NFKC and percent-decoding work as intended; there is no bypass of the accident net (PR3-SEC-10 closed).
5. **File provider.** Confinement, size cap, regular-file check, abort and path-free errors all verified. Residual TOCTOU, unbounded read and mode check are INFO, routed (PR3-SEC-07).
6. **NODE_ENV / APP_ENV.** The hardened direction fails closed. The local direction is still open (PR3-SEC-03).
7. **Tooling keys.** Refused by the API and the worker in hardened environments (7/7). Their own validation is missing (PR3-SEC-14).
8. **Error and log value-freedom.**
   - Holds for the message, code, name and raw-throw channels, and for every file-provider error.
   - The new `cause` field is value-free except for the constructor channel (PR3-SEC-15, INFO).
   - The ConfigValidationError surfaces (`message`, `formatConfigError`, `issues`, `stack`, `inspect`) were checked with a sentinel value.
9. **Joi-only backend.**
   - The only non-test `zod` import in `packages/config` is `src/web/web-schema.ts`.
   - No backend module imports `./web/*`: `schema.ts` now imports the dependency-free `brand-rules.ts`.
   - `BRAND_*` parity between Joi and Zod is tested.
   - `zod` stays a package dependency for the `./web` subpath only.
10. **Secrets in the delta.**
    - The secret-shape scan of added lines found 0 key, PEM, AWS, JWT or Stripe shapes.
    - Its URL-credential hits are all `CHANGE_ME`, `local-only-*`, `<…>` or `{p}` templates, and its one base64-run hit is an alphabet string in a test.
    - `.env.example` and `compose.env` additions are placeholders or markers (classifier above).

### R2.5 Follow-ups added or changed by round 2 (binding)

| Task | Requirement | From |
|---|---|---|
| **This PR (recommended)** or TASK-006 | Raw `rediss://` prefix, non-empty host, no query or fragment; fail closed on an unparseable URL; tests in PR3-SEC-12 (optional: pg query allow-list) | PR3-SEC-12 |
| TASK-006 (unchanged, now also covers PR3-SEC-12) | ioredis built with an explicit `tls: { servername }` whenever the URL is `rediss:` | PR3-SEC-02, PR3-SEC-12 |
| TASK-006 or TASK-014 (whichever wires the `file` provider) | Single `open(O_RDONLY \| O_NOFOLLOW)`, then `fstat` and a bounded read (`maxBytes + 1`) on the same handle, plus the `mode & 0o022` check | PR3-SEC-07 residual |
| TASK-014 | Entrypoint preflight with `env -u NODE_OPTIONS`, using `nodeOptionTokens` and an allow-list; `exec node --disable-sigusr1`; container test for `--inspect-wait`. Per-service env, now including `DATABASE_BOOTSTRAP_URL` | PR3-SEC-13, PR3-SEC-06 |
| senior-developer (this PR or TASK-006); TASK-003 / TASK-014 | `checkToolingEnv` in `packages/config`, called by `prisma.config.ts` and `tools/db/*` | PR3-SEC-14 |
| principal-architect | Choose PR3-SEC-03 option (a) or (b) (option (b), the ECS-metadata signal, recommended) and record it in DECISIONS together with the converse `nodeEnvGuard` the PR added | PR3-SEC-03 |
| IaC task (M5) | Checkov check on `NODE_OPTIONS` in task definitions; security groups never open 9229 (in addition to the `app_env` validation) | PR3-SEC-13, PR3-SEC-03 |
| senior-developer (optional) | Prototype-based, error-class-shaped `describeFailureCause`, plus a property-test case | PR3-SEC-15 |

### R2.6 Evidence (head `875409d`)

| Check | Result |
|---|---|
| `transport-out.txt` | DATABASE_URL, staging. Refused: last-wins `sslmode`, `ssl%6Dode`, `ssl=`. Joi rejects: the empty-host `@/` forms and upper-case schemes. ACCEPTED: `verify-full` (pg `rejectUnauthorized` default true), `uselibpqcompat` with `verify-full`, `sslnegotiation=direct`, `options=`, `host=` override (Unix socket or another TCP host), and port 99999 (WHATWG throws, so the guard skips it; pg throws too). REDIS_URL, staging: `?tls=` refused; upper-case and leading-space forms rejected by Joi; **`rediss:api:…@cache:6379` ACCEPTED, and ioredis gives `tls=undefined`, which is plain TCP** |
| `redis-wire-out.txt` | Loopback. `rediss://` → first byte `0x16`, secret not in clear. **Opaque `rediss:` → guard ACCEPTED, first byte `*`, secret in clear.** `redis://` (positive control) → refused by the guard; plaintext |
| `node-options-out.txt` | 17 forms. Every form that turns the inspector on is refused; benign forms and `--no-inspect` are accepted. Tab, newline, NBSP, upper-case and config-file forms → Node exit 9 |
| `belt-out.txt` | Control → exit 0, ready. CLI `--inspect` → 78 (`runtime.inspector`). `--inspect-port=0` → 78. Quoted NODE_OPTIONS → 78. **`--inspect-wait` / `--inspect-brk` → hang, and the guard never ran** |
| `misc-out.txt` | NODE_ENV: hardened direction refused ×3; local + `production` + `local-only` key ACCEPTED. Tooling keys 7/7 refused in staging, absent from `Config` in local. Placeholders as listed in R2.2, with 300/300 marker-invariant runs. Timeout: 363 ms and 310 ms against 50 ms budgets. Leakage: message, code, raw and non-string → no leak; **own `constructor.name` → leak**. File provider on a Windows temp root: read with trim; missing, oversize, directory, junction-outside, traversal, `/etc/shadow` and prefix look-alike all refused path-free; seam: 32 MiB read before the size refusal |
| `envdiff-out.txt` | `.env.example`: tooling credentials are `CHANGE_ME`, `_FILE` keys are empty, the DB timeouts are literals. `compose.env`: tooling credentials contain `local-only-`, and all are refused in staging |
| `shapescan` | 11 hits, all placeholders, templates or test alphabets; the positive control fired |
| Not run (constraints) | `npm ci`, build, unit suites, gitleaks, Semgrep. PR gate accepted: 430/430; coverage 99.91 % / 97.56 %; `npm audit --audit-level=high` exit 0 |

## Round 3 (head 0e48a2a)

| Field | Value |
|---|---|
| Delta | `c277ea6..0e48a2a`, 1 commit (`0e48a2a fix(config): review fix cycle 2 for TASK-005 (PR #3 round 2, D-ORCH-007)`), 16 files, all under `packages/config/src`, +558 / −100. No lockfile, env-file or dependency change. `gh pr view 3`: head `0e48a2a5`, OPEN |
| Fix comment | https://github.com/sukhchdit/shipcube/pull/3#issuecomment-6826964394 |
| Decisions | D-ORCH-007 (fix-cycle scope; PR3-SEC-03 option (b)), D-TASK005-03 (behaviours) |
| Reviewer / date | security-analyst, 2026-11-12. Review by SHA only: the `Shipqube-TASK-005` worktree was not touched, because a merge-main pass runs there. Node 24.22.3 |
| **Verdict** | **PASS_WITH_FOLLOW-UPS. No Critical or High finding is open, so merge is allowed.** **Closed:** PR3-SEC-12 (MEDIUM), covering every round-2 vector plus the optional pg allow-list. A 5,000-run generated differential per driver found no guard-accepted URL that pg or ioredis would use without verified TLS. Also closed: PR3-SEC-15 (INFO), and PR3-SEC-03 (LOW) within this PR's scope (the ECS second signal); round-1 remediation items 2 and 3 stay binding on later tasks. **New:** PR3-SEC-16 (INFO): a thrown value whose `code` getter or Proxy trap throws escapes the value-free classification. **Open and unchanged:** PR3-SEC-05, -06, -08, -13 and -14 (LOW or latent, all routed), and PR3-SEC-09 and -11 (INFO). The verdict covers `0e48a2a`. A later merge-main commit needs a delta check only if it changes `packages/config/src` beyond the merge itself |

### R3.1 Method

- **Code read.** Every changed non-test source at `0e48a2a` was read in full, from `git archive 0e48a2a packages/config` in the scratchpad. Tests were read for each claimed vector: `[PR3-SEC-12]`, `[PR3-SEC-03]` and `[PR3-SEC-15]` in `load-config.test.ts`, `guards.test.ts` and `secret-refs.test.ts`, and `[R2-n3]`.
- **Probes ran against the PR's own code.**
  - Setup: the 22 non-test sources were transpiled with `module.stripTypeScriptTypes` into `scratchpad/review/PR-3-sec-r3/build`. A temporary `node_modules` junction pointed to the main checkout, which has the same locked versions: joi 18.3.2, zod 4.6.7, pg 8.23.1, pg-connection-string 2.14.1, ioredis 6.0.0 and fast-check 4.10.2. The delta changes no lock entry. The junction was removed afterwards (`rmdir`, link only).
  - The round-2 scripts were no longer in the scratchpad, so they were re-created in `review/PR-3-sec-r3/probes/`:
    - `transport.mjs`: 40 `DATABASE_URL` and 31 `REDIS_URL` forms through `loadConfig` (staging, service `api`). Each verdict is printed next to the driver's own reading: `pg/lib/connection-parameters`, and `new Redis(url, { lazyConnect: true }).options`. Also covers the HTTPS keys.
    - `redis-wire.mjs`: a loopback listener captures the first bytes ioredis sends, for 10 forms.
    - `fuzz.mjs`: a fast-check generated differential, 5,000 runs per driver, seed 20261112. Invariant: if the guard accepts in staging, the driver uses verified TLS over TCP. It includes positive controls.
    - `misc.mjs`: the ECS guard matrix; the `describeFailureCause` channels; code-running throwables; permanent errors through the real file provider on a temp root (junction outside, directory, 70 KiB file); brand and web URL credentials through the predicate, Joi and Zod.
    - `shapescan.mjs`: secret shapes in the added lines, with a positive control.
  - Passwords, tokens and endpoints are runtime-random. Outputs are verdicts, booleans and redacted templates (`{p}`), and each probe asserts that its own output contains none of these values.
- **Not run, per the constraints:** `npm ci`, the build, the unit suites, gitleaks (Docker) and Semgrep (not installed). I accept the PR gate evidence: lint, format, typecheck and build all exit 0; 635/635 unit tests pass; `packages/config` coverage is 100 % lines and 97.46 % branches; `npm audit --audit-level=high` exits 0.

### R3.2 Findings: status at `0e48a2a`

| ID | Previous | Status | Verification |
|---|---|---|---|
| PR3-SEC-12 | MEDIUM | **Closed** | **Valkey** (`guards.ts:83-84`). The guard requires the raw value to start with `rediss://`, a non-empty host, and no `?` or `#` anywhere in the raw value. The prefix test is exactly the one ioredis uses (`Redis.js:707`, case-sensitive), so the guard and the driver now decide TLS from the same bytes. **Refused by the guard:** the opaque `rediss:user:pw@host` (with and without `/0`), `rediss:%2F%2F…`, `rediss:/…`, `#x`, `/0?`, `?tls=`, `?family=4`, `?path=` (Unix socket), port 99999 (fails closed) and `rediss:///0`. **Refused earlier by Joi:** `REDISS://`, `Rediss://`, a leading space, tab and newline forms, backslashes, protocol-relative values and Unix paths. **Accepted:** `rediss://` with or without `/0`, IPv6, `%3F` or `%23` inside the path, the whole userinfo in the username, and `/0;tls=false`. ioredis gives `tls: true` for every accepted form. **On the wire:** every accepted form sends `0x16` (TLS ClientHello) first, and the password is not in clear. Every refused plaintext form sends `*` with the password in clear: the opaque form, `%2F%2F`, `?tls=`, and the `redis://` positive control. **Generated:** 5,000 runs, 88 accepted, 0 accepted without TLS. **Fail closed** (`guards.ts:93-104`). A value WHATWG cannot parse is now `insecure-transport`: `DATABASE_URL …:99999…?sslmode=disable`, `REDIS_URL …:99999` and `STORAGE_ENDPOINT https://…:99999`. The new `key in values` skip applies only to a key the schema already rejected, and any schema issue throws, so it opens no path: `configObjectSchema` strips none of `CONFIG_KEY_NAMES`. **PostgreSQL allow-list** (`guards.ts:54-75`). Refused: `host=` (socket or TCP), `ho%73t=`, `options=`, `user=`, `password=`, `replication=`, `sslcert`/`sslkey`, `ssl=0`, an empty key, `ssl+mode`, `SSLMODE`, a `;`-joined parameter, a bare `sslmode`, duplicate and encoded-duplicate `sslmode`, `%2F` and `%2f` socket hosts, the opaque `postgresql:host` and `postgresql:/host` forms (pg would fall back to `localhost`), and a fragment-only `#?sslmode=disable`. Accepted: `verify-full` alone; with `sslrootcert` (the file is read and `ca` is set); with `uselibpqcompat=true`, `sslnegotiation=direct`, `connect_timeout` or `application_name`; IPv6; `localhost`; `#&sslmode=disable` (pg ignores the fragment too); and `verify%2Dfull` (both sides decode it). For every accepted form, pg yields `ssl: {}` with no `rejectUnauthorized: false`, no `checkServerIdentity` override, a TCP host and no `options`. **Generated:** 5,000 runs, 34 accepted, 0 downgraded. 4 accepted forms make pg throw at parse time: a malformed `%` in the password combined with an IPv6 host, because pg's `encodeURI` pre-pass encodes the brackets. The client then fails to construct, which fails closed. The runtime pool factory on `main` (`apps/api/src/platform/db/client.ts`, TASK-003) passes the string to pg unchanged, so this is the reading the probe used |
| PR3-SEC-15 | INFO | **Closed**; successor PR3-SEC-16 (INFO) | `errorClassName` (`secret-refs.ts:152-158`) reads the prototype's own `constructor` data descriptor, then that function's own `name` data descriptor. It accepts only `^[A-Z][A-Za-z]{0,48}(?:Error\|Exception)$`. **Probe → `Error`:** an own `constructor` (object or function), a non-function prototype constructor, an accessor constructor, an accessor `name`, names with `_` or without the suffix, an own `name` property, the message, and a token-shaped `code`. **Kept:** `VaultTimeoutException`, `DOMException` and `SecretFileError/SECRET_FILE_TOO_LARGE`. The round-2 channel (`leaks: true`) is gone. **Residual, by design:** a letters-only class name declared in code (`<letters>Error`) and an upper-case letters `code` (`SECRET_<LETTERS>`) still pass. A provider would have to name a class, or set an errno-shaped code, from data, and no code-defined adapter does that. "Getter-free" holds for the class-name read only; see PR3-SEC-16 |
| PR3-SEC-03 | LOW | **Closed in this PR's scope** (option (b)); items 2 and 3 stay binding | The guard is `localAppEnvOnEcsGuard` (`guards.ts:180-181`); the variable names are `ECS_METADATA_KEYS` (`environment.ts:26`); presence is read through `pickConfigured` (`load-config.ts:45`). **Matrix.** `local` or `test` with V3 or V4 set → `APP_ENV forbidden-in-environment (appEnv.ecsTask)`. This includes a single-space value, and V4 empty with V3 set. `staging` and `production` are unaffected. The endpoint value is absent from every error surface. **Edge.** `loadConfigOrExit` passes the whole `process.env`, not a pre-filtered record, so the names reach the guard: `local` with V4 set → exit 78. **Effect.** The round-1 scenario is now refused on the target platform (ECS on EC2, brief §3.3): a deployed ECS task that declares itself `local` and accepts the committed `local-only-*` markers. **Not covered, by design:** lower-case names (Linux environments are case-sensitive, and the agent injects upper case), `AWS_EXECUTION_ENV` on its own, and non-ECS hosts. For "empty = unset", see R3.4 item 3. **Still binding:** (2) the first key-provider task asserts `isLocalAppEnv` before it uses `localOnly` material; (3) the IaC task validates `app_env`. **Doc:** ADR-0018 §3 still says "`NODE_ENV=production` and the Mock carrier/gateway". principal-architect aligns it with `APP_ENV=production` (round-1 item 1) |
| PR3-SEC-05 | LOW (latent) | Open; unchanged | Binding on TASK-006 |
| PR3-SEC-06 | LOW (latent) | Open; unchanged | TASK-014 (per-service env) |
| PR3-SEC-07 | LOW | Closed in round 2; the residual INFO stays routed | The file provider is unchanged in this delta; only its test changed (abort timing) |
| PR3-SEC-08 | LOW (latent) | Open; unchanged | TASK-022 |
| PR3-SEC-09 | INFO | Open; unchanged | — |
| PR3-SEC-11 | INFO | Open; one note added (`PGOPTIONS`, R3.4 item 2) | — |
| PR3-SEC-13 | LOW | Open; routed by D-ORCH-007 item 2 | TASK-014 entrypoint preflight; IaC Checkov rule |
| PR3-SEC-14 | LOW (latent) | Open; routed by D-ORCH-007 item 2 | Helper in `packages/config` by TASK-014; callers in TASK-014 and TASK-016 |

### R3.3 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR3-SEC-16 | A thrown value whose `code` getter or Proxy trap throws escapes the value-free classification. The secondary exception leaves `resolveSecretRefs` unclassified, message included | INFO | CWE-209, CWE-755 | A09 | `packages/config/src/secret-refs.ts:160-163`, `:169-184`, `:208-209` | senior-developer (optional, this PR) or TASK-006 (which composes `resolveSecretRefs` into start-up) | Open |

#### PR3-SEC-16 (INFO): code-running throwables escape classification

**Description.** `classifyFailure` runs inside the `catch` of `attemptResolve`. `describeFailureCause` and `errorCode` still run code that belongs to the thrown value:
- `error instanceof Error` walks the prototype chain, so a Proxy `getPrototypeOf` trap runs;
- `errorCode` reads `.code` with an ordinary `[[Get]]`, so a getter runs.

If that code throws, the new exception propagates out of `attemptResolve`, then `resolveOne`, then `Promise.all`. `resolveSecretRefs` then rejects with that exception instead of a `ConfigValidationError`.

- **Probe.** One provider throws an `Error` whose `code` getter throws `new Error(<secret>)`. Another throws a Proxy whose `getPrototypeOf` trap does the same. Both give `ESCAPED Error`, with the secret present in the message and stack (`leak=true`), after one provider call each.
- **Control.** A getter that *returns* `EACCES` is handled: `Error/EACCES`, no leak.
- **Origin.** This predates round 3: round 2 read `error.constructor.name` and `.code` the same way. The PR3-SEC-15 fix made the class-name read getter-free, but not the `code` read.

**Exploitability and impact.**
- The provider must throw an object with a throwing accessor, or a Proxy, that carries data.
- Node system errors, `ERR_*` errors and `SecretFileError` define `code` as an own data property (verified on Node 24.22.3), and AWS SDK v3 errors are plain class instances.
- So this is not reachable with the code-defined adapters. If it were triggered, the start-up caller (TASK-006) would print an unexpected exception. **INFO.**

**Remediation (code level, `secret-refs.ts`).**
```ts
const ownData = (target: object, key: string): unknown => Object.getOwnPropertyDescriptor(target, key)?.value;

/** errno, ERR_* and SecretFileError codes are own data properties; an accessor is never invoked. */
const errorCode = (error: Error): string | undefined => {
  const code = ownData(error, 'code');
  return typeof code === 'string' && ERRNO_CODE.test(code) ? code : undefined;
};

export function describeFailureCause(error: unknown): string {
  try {
    if (!(error instanceof Error)) return `non-error:${typeName(error)}`;
    const code = errorCode(error);
    const name = errorClassName(error);
    return code === undefined ? name : `${name}/${code}`;
  } catch {
    // A Proxy trap threw: the thrown value's own code never decides the outcome.
    return 'Error';
  }
}
```
In `classifyFailure`, take `permanent` from the same guarded code: compute it once, inside a `try`, together with the cause.

**Verification test (`secret-refs.test.ts`).**
- Case (a): a provider throws an `Error` with `get code() { throw new Error(token) }`.
- Case (b): a provider throws `new Proxy(new Error('x'), { getPrototypeOf() { throw new Error(token) } })`.
- For each case, `resolveSecretRefs` rejects with a `ConfigValidationError` whose issue is `{ rule: 'ref.providerError', cause: 'Error' }`. `token` is absent from `message`, `formatConfigError`, `stack` and `inspect`.
- Add both throwables as channels in the value-free property.

### R3.4 Reviewer focus: answers

1. **Valkey forms.** `rediss:` without `//`, the encoded forms, `#`, `?` and unparsable URLs are all refused. Every accepted form is TLS on the wire (R3.2).
2. **PostgreSQL forms.**
   - `host=`, `options=`, socket hosts and `%2F` are all refused. So are lower-case `%2f`, the encoded key `ho%73t` and the opaque `postgresql:` forms.
   - Every allow-listed parameter keeps verified TLS.
   - **Note (outside the URL guard's scope).** pg also reads `PGOPTIONS` from the process environment when the URL has no `options`. Verified: a guard-accepted URL plus `PGOPTIONS='-c row_security=off'` gives `options` set. `PGSSLMODE` and `PGHOST` do not override the URL. TASK-003's `toPoolConfig` refuses `options` only in the URL. Routed to TASK-014 (R3.5).
3. **ECS guard: presence only, and an empty value counts as unset. This is safe for its purpose.**
   - The ECS agent always injects a non-empty endpoint URL into each container. An empty value can only come from explicit configuration (the task definition or an entrypoint). Whoever writes that also controls `APP_ENV` and every other variable, which is outside this accident net's threat model.
   - It matches the package-wide rule that Compose's `${VAR:-}` empty string means "not configured" (`pickConfigured`).
   - A single space counts as present, and is refused.
   - **Optional hardening, at no local cost:** treat a *defined* ECS name as present even when empty (`key in env`), and add `AWS_EXECUTION_ENV` starting with `AWS_ECS_` as a third signal. Not required for merge.
4. **Error class-name hardening.** Closed against the round-2 channel. The residual (code-defined letters-only names, upper-case codes) is by design. Code-running throwables are PR3-SEC-16 (INFO).
5. **Permanent errors.**
   - Each of these gives exactly one provider call, no sleep, and a `cause` of class and code only: `SECRET_FILE_OUTSIDE_ROOT` (a junction pointing outside the root), `SECRET_FILE_NOT_REGULAR` (a directory), `SECRET_FILE_TOO_LARGE` (70 KiB), `EACCES` and `EPERM`.
   - No path, root or secret appears in any error surface, even when the provider's message carries the path.
   - The `EIO` control is still retried (2 calls, 1 sleep).
   - When the deadline passes during the sleep, the first diagnosis is kept. This changes no information.
6. **Brand URL credentials.**
   - **Refused identically** by `isBrandUrl`, by Joi (`BRAND_LOGO_URL`) and by Zod (`BRAND_LOGO_URL` and `VITE_API_BASE_URL`), each with rule `brand.url` and no value in any error surface: `user:pw@`, `user@`, `:pw@`, `user%3Apw@`, host-looking userinfo, a double `@`, `http:`, an upper-case scheme, protocol-relative values, and the backslash and tab forms.
   - **Accepted:** `https://@host`, and `@` inside the path. Neither carries credentials, because WHATWG and browsers drop the empty userinfo.
   - **No ReDoS.** The `ABSOLUTE_BRAND_URL` regex runs in linear time, because `%` is not in its character class, so the two alternatives cannot overlap. The length check also runs first.
7. **Secrets in the delta.** The shape scan of added lines has 1 hit: a 2-character dictionary-word password in a test vector that is expected to be refused (`brand-rules.test.ts:95`). The positive control fired.

### R3.5 Follow-ups added or changed by round 3 (binding unless marked optional)

| Task | Requirement | From |
|---|---|---|
| senior-developer (optional, this PR) or TASK-006 | A guarded `describeFailureCause` (try/catch, and an own-data read of `code`), plus the two throwables in the value-free property | PR3-SEC-16 |
| TASK-014 | The entrypoint preflight also refuses `PG*` variables (at least `PGOPTIONS`) when `APP_ENV` is staging or production, next to the NODE_OPTIONS allow-list | PR3-SEC-11 note (R3.4 item 2) |
| principal-architect | ADR-0018 §3: change "`NODE_ENV=production` and the Mock carrier/gateway" to "`APP_ENV=production` …". Record the ECS second signal (D-ORCH-007) in §4 | PR3-SEC-03 |
| First key-provider task (TASK-040/045/048/052) | Unchanged: assert `isLocalAppEnv` before using `localOnly` material | PR3-SEC-03 item 2 |
| IaC task (M5) | Unchanged: `app_env` validation; a Checkov check on `NODE_OPTIONS`; security groups never open 9229 | PR3-SEC-03 item 3, PR3-SEC-13 |
| TASK-006 | Unchanged: ioredis built with an explicit `tls: { servername }`; `resolveSecretRefs` plus `checkResolvedSecrets` at start-up; the `O_NOFOLLOW` file read | PR3-SEC-02, -05, -07 |
| Optional (any task touching the guard) | ECS signal: treat a defined-but-empty name as present; add `AWS_EXECUTION_ENV=AWS_ECS_*` | PR3-SEC-03 (R3.4 item 3) |

The R2.5 row "This PR (recommended) or TASK-006" for PR3-SEC-12 is discharged. The R2.5 row for PR3-SEC-15 is discharged, and PR3-SEC-16 succeeds it.

### R3.6 Evidence (head `0e48a2a`)

Files are in `scratchpad/review/PR-3-sec-r3/out/`.

| Check | Result |
|---|---|
| `transport-out.txt` | **DATABASE_URL, staging.** 40 forms. Every form for which pg would use a socket, `ssl: false`, an `options` GUC or another host is refused. Accepted forms all yield `ssl: {}` (verify-full defaults) over TCP. Port 99999 → `insecure-transport` (fail closed). **REDIS_URL, staging.** 31 forms. Every form with `tls=undefined` (plain) in ioredis is refused. Accepted forms all have `tls: true`. **HTTPS keys.** `https:/host`, `https:host`, `https://` and upper case are rejected by Joi. `http://` and port 99999 → `insecure-transport`. **Local control:** opaque `rediss:` is accepted in `local`, as designed. Password present in the output: false |
| `redis-wire-out.txt` | Loopback. 6 accepted forms → first byte `0x16`, password not in clear. 4 refused forms (opaque, `%2F%2F`, `?tls=`, and `redis://` as the positive control) → first byte `*`, password in clear |
| `fuzz-out.txt` | **Redis:** 5,000 runs, 88 accepted, 0 without TLS. **pg:** 5,000 runs, 34 accepted, 0 downgraded; 4 make pg throw at parse time (fail closed). Both positive controls flagged as insecure |
| `misc-out.txt` | **ECS matrix:** 32 cells plus the edge (exit 78); no endpoint leak. **Class-name channels:** 17 cases; only the code-defined letters-only name and the upper-case `SECRET_` code pass, by design. **Code-running throwables:** 2 escape (PR3-SEC-16); the returning getter is handled. **Permanent errors:** 5 with 1 call each, `EIO` with 2; no path or secret leak. **Brand credentials:** 11 refused identically on all three validators, 2 credential-free forms accepted, controls accepted |
| `shapescan-out.txt` | 1 hit, a test vector (see R3.4 item 7); the control fired |
| Not run (constraints) | `npm ci`, the build, the unit suites, gitleaks, Semgrep. PR gate accepted: 635/635; coverage 100 % / 97.46 %; `npm audit --audit-level=high` exit 0 |
