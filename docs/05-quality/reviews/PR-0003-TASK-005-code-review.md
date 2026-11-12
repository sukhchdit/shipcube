# Code review: PR #3, TASK-005 (typed, validated configuration and key/secret register, US-002), round 1

| Field | Value |
|---|---|
| PR | https://github.com/sukhchdit/shipcube/pull/3 |
| Branch / head | `feat/TASK-005-typed-validated-configuration-key-secret` @ `be468bc` (2 commits over merge-base `4da693a`; `main` is now `26662fb`, docs-only delta, no conflict) |
| Reviewer | code-reviewer (independent), 2026-11-12 |
| Inputs | WAVE-00.md TASK-005; US-002 Gherkin (EPIC-01); ADR-0018 incl. SEC-P3-08 amendment; ADR-0001 / brief §3.3 (Joi backend, Zod frontend); ADR-0010 am. 9; platform.md §2.7, §9.1–9.4, §4.7; data-model §7.1; CLAUDE.md §5, §9; PR body; PR #5 (TASK-003 @ `d8ba197`) and PR #4 (TASK-004 @ `519bb89`) for the merge-time key gap |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A careful, well-tested config package. The loader is pure, errors name keys only (property-tested), the
         result is frozen, the 25-row register matches ADR-0018, and no key material is committed. Two MAJORs block
         approval. The 2 s secret timeout is not enforced by the orchestrator (a provider that ignores the signal
         hangs start-up; reproduced). The backend Joi schema runs Zod at runtime for BRAND_*, which contradicts the
         fixed-stack resolution (brief §3.3, ADR-0001). Nine MINORs, mostly guard hardening and merge-time wiring.
```

## 1. Verification performed by the reviewer

The host was memory-constrained (8 parallel reviewers), so the brief limited this review to one targeted test file, with no install, build, Docker or full suites. `.env*` files can't be read under policy, so `.env.example` was checked only through its parity test.

| Check | Result |
|---|---|
| `prettier --check packages/config/src tools/config packages/config/package.json` | pass |
| `jest --selectProjects unit --testPathPatterns tools/config/env-example-parity` | **6/6 passed** (3.3 s). `.env.example` lists every schema key once; it has no unknown keys, and every secret value is a placeholder. |
| Lockfile diff | only `"zod": "^4.6.7"` added to `packages/config`, which matches the existing spec in apps/web and apps/admin |
| Web subpath dependency graph (read) | `web/index.ts` → `errors.ts`, `env-input.ts`, `web-schema.ts`: no Joi, no `node:*`. **Verified.** |
| ADR-0018 register row count | 25 rows in the amendment table (counted), so the brief's "24" is wrong. `KEY_REGISTER` matches the ADR row by row (see §3.1). |
| **Experiment A** (scratch tsx script against the worktree sources) | `resolveSecretRefs(..., { timeoutMs: 200 })` with a provider that ignores `signal` was **still pending after 1505 ms**, so it never settles (M1) |
| **Experiment B** | `isPlaceholder('Xk9<q!Tz>2wP') === true`. A punctuated real password is refused as a placeholder (m3). |
| **Experiment C** | `NODE_OPTIONS=--inspect_brk=127.0.0.1:0 node -e 1` prints "Debugger listening on ws://…", and `INSPECT_FLAG.test('--inspect_brk=…') === false`. The debug guard is bypassable (m2). |
| Not re-run (constraints) | lint, typecheck, build, the full `test:unit` and coverage. The PR's 226/226 and 99.89 % / 97.69 % figures are **not independently verified** and must be re-checked by the gatekeeper or CI lane before merge. |
| `git status --porcelain` in the worktree after all runs | clean |

## 2. Findings

| ID | Sev | File:line | Problem | Why it matters | Required fix |
|---|---|---|---|---|---|
| M1 | **MAJOR** | `packages/config/src/secret-refs.ts:89-97` (`resolveOne`) | The "2 s timeout" is only *passed* to the provider as an `AbortSignal`; nothing in the orchestrator enforces it. A provider that ignores the signal (a hung socket in a future AWS adapter, or an `fs` read without `signal`) leaves `await provider.resolve(...)` pending forever. Reproduced in Experiment A. The unit test passes only because its "hanging" provider honours the signal. | NFR-OPS-005 (fail within 5 s) and the documented contract ("each bounded by `timeoutMs`") depend on every future adapter author getting abort wiring right. A start-up hang is worse than a start-up failure: ECS keeps restarting a task that never reports. | Race the provider against the signal in the orchestrator, e.g. `await Promise.race([provider.resolve(locator, signal), new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))])`. Add a test whose provider returns `new Promise(() => {})` and ignores the signal; it must reject within `timeoutMs` + ε. Consider one overall deadline (≤ 4.5 s) as well as the per-call limit. |
| M2 | **MAJOR** | `packages/config/src/schema.ts:12,27,129-135,197-206`; `web/web-schema.ts:27-32` | The backend Joi schema delegates `BRAND_*` validation to **Zod at runtime** (`t.zod` wraps `schema.safeParse` in `Joi.any().custom`), so API and worker validation now depends on Zod. The fixed-stack resolution says otherwise (brief §3.3, ADR-0001, CLAUDE.md §2): "**Zod on the frontend. Joi stays on the backend.** Limits, enums, regexes and field names shared by both live in [a shared module] so the two validators cannot drift; a test asserts parity." The Joi side also loses the Zod rule (`rule: 'zod'`), so the AT-US-002-04 test titled "rejected identically" shows different codes (`zod` vs `too_big`). | This contradicts an accepted architectural rule without a superseding decision (CLAUDE.md §5, "Architecture changes"). It also sets the precedent that later tasks will copy for the address, parcel and customs schemas, where the brief explicitly wants Joi and Zod with shared primitives. | Put the primitives in a dependency-free module, e.g. `packages/config/src/brand-rules.ts`: `BRAND_NAME_MAX_LENGTH = 40`, `ROOT_PATH_PATTERN`, `BRAND_URL_PROTOCOLS`, and the trim rule. Build the Joi validators in `schema.ts` and the Zod validators in `web-schema.ts` from them, and delete `t.zod`. Add a parity test that runs shared accept/reject vectors (empty, 40/41 chars, whitespace-only, `/logo.svg`, `//evil`, `javascript:`, `https://…`) through both validators and asserts the same verdict. **Alternative:** a D-ARCH ruling from principal-architect that explicitly permits Zod value schemas in backend config. |
| m1 | MINOR | `packages/config/src/secret-refs.ts:94` | A bare `catch { return undefined; }` collapses every failure (not found, timeout, access denied, provider bug or `TypeError`) into `unresolvable`. There is also no retry policy, although CLAUDE.md §9 requires timeouts plus retries with backoff and jitter for idempotent external calls, and a secret read is idempotent. | Operators can't tell "secret missing" from "Secrets Manager slow" from "IAM denied" at 03:00. Programming errors are silently turned into configuration errors, against CLAUDE.md §9 ("no silent catch-alls; structured errors"). | Classify the failure into value-free rule codes (`ref.noProvider`, `ref.timeout`, `ref.notFound` for `SecretNotFoundError`, `ref.empty`, `ref.providerError`) and put them in `ConfigIssue.rule`. Retry once, with full jitter (100–300 ms), on `timeout` and `providerError` only, within the 5 s budget. Rethrow non-`Error` throws, or at least record the error class name. |
| m2 | MINOR | `packages/config/src/guards.ts:57` (`INSPECT_FLAG`) | Node accepts `_` for `-` in option names, so `--inspect_brk`, `--inspect_wait` and `--inspect_port` activate the inspector but don't match the regex (Experiment C). Quoted forms (`"--inspect"`, which Node's NODE_OPTIONS parser un-quotes) also slip through. | SEC-P3-08 item 6 and platform.md §9.2 require refusing "any `--inspect*`" outside local. The guard has a known bypass. | Normalise before matching: `opts.replace(/["']/g, ' ').replace(/_/g, '-')`, then `/(?:^|\s)--inspect[\w-]*(?:=|\s|$)/`. Add test vectors for `--inspect_brk=0`, `"--inspect"`, `--inspect-publish-uid=http` (refusing it is fine) and `--max-old-space-size` (accepted). |
| m3 | MINOR | `packages/config/src/placeholders.ts:13` (`/<[^<>]*>/`), used by `secret-refs.ts:161` | The `<…>` pattern matches *anywhere* in a value. Resolved secrets (Stripe, carrier JSON, SMTP password) are checked with `isPlaceholder` in hardened environments, and Secrets Manager's default password charset includes `<` and `>`. A rotated real password such as `Xk9<q!Tz>2wP` is refused as a placeholder (Experiment B). The substring `change[-_ ]?me` has the same problem in a weaker form (`exchangemerchant`). | The result is a start-up outage in staging or production at the next rotation, with a misleading "placeholder" reason. | Placeholders in `.env.example` are whole values or whole URL components. Match `<…>` only as a whole value or component (`^<[A-Za-z0-9_.-]+>$` after splitting on `:@/`). For **resolved** secret values, test against an exact set (`CHANGE_ME`, `REPLACE_ME`, `local-only-*` prefix, …) rather than substrings. Add a property test showing that random punctuated passwords are not flagged. |
| m4 | MINOR | `packages/config/src/process-env.ts:55`; `secret-refs.ts:103,154` | Consumer ergonomics are split. `loadConfigOrExit` is synchronous and does not resolve references. A service must chain `secretRefsOf`, `resolveSecretRefs` (throws), `checkResolvedSecrets` (*returns* issues) and its own exit handling. The live-Stripe-key refusal (`PAYMENT_LIVE_KEY_FORBIDDEN`, ADR-0018 §3) and the resolved-placeholder refusal (SEC-TC-51) run only if every entry point remembers the third call. The parser accepts `file:` references, but no file adapter exists, although the PR body says "env, file and aws-secrets-manager providers". | Security refusals become opt-in. API and worker (TASK-006) will each re-implement the composition, and one may get it wrong. | Add an async edge `loadRuntimeConfigOrExit(service, { providers, env?, io? })`. It should load, resolve, check, raise one `ConfigValidationError`, write the stderr report and exit 78, and return `{ config, secrets }`. Make `checkResolvedSecrets` throw or merge into it. Add `createFileSecretProvider()`: abortable `fs.promises.readFile` with a size cap, trailing-newline trim and `SecretNotFoundError` on `ENOENT`. Alternatively, correct the PR text and track the adapter. |
| m5 | MINOR | `packages/config/src/keys.ts:59,340-352`; `schema.ts:213,264`; `compose.env` | The register's `holders` field is documentation only. (a) `AUDIT_ANCHOR_SIGNING_KEY` is "**worker only**" in ADR-0018, but the API loads it whenever it is present. (b) `DATABASE_MIGRATOR_URL` and `SHADOW_DATABASE_URL` sit in the api/worker runtime schema, against data-model §7.1 ("the runtime never uses the migrator URL") and TASK-003's `client.ts` header. (c) `jwt-signing` lists the worker as a holder of the private key set, while the ADR says the worker verifies with the "public part only". (d) `compose.env` is a single file, so if it is used as `env_file` for every service, each container receives every key, including the migrator URL. | Least privilege (REQ-RLS-005, ADR-0018 holder column) is enforced only by deployment wiring, and the local stack does not show the intended separation. | Add a guard that refuses a key variable whose register `holders` excludes the loading service (`forbidden-for-service`), at least outside `local`. Move migrator, shadow and bootstrap keys to a tooling key set (see §4). If the worker verifies JWTs, add a `JWT_PUBLIC_KEYS` variable on the `AUDIT_ANCHOR_PUBLIC_KEYS` pattern. Hand off to TASK-008 that `compose.yaml` passes the migrator URL to the migrate service only. |
| m6 | MINOR | `packages/config/src/keys.ts:443-444`; `compose.env` | In local, `KeyVersion.material` is the UTF-8 bytes of the marker (for example 19 bytes for `local-only-csrf-key`), so every consumer must branch on `localOnly` and derive key bytes itself. For ES256 (`JWT_SIGNING_KEYS`) and the anchor key pair, independently "derived" private and public markers will not correspond, so local anchor verification breaks unless one adapter derives both from the same seed. | Each crypto consumer (TASK auth, audit, outbox, carrier cache) gets a foot-gun. An AES call with 19 bytes throws, or worse, someone pads it. | Derive here, in one place, for local and test only: symmetric material = HKDF-SHA-256(marker, info = keyId), 32 bytes. For the P-256 rows, derive the private scalar from HKDF and compute the public key from it (or require `AUDIT_ANCHOR_PUBLIC_KEYS` to be omitted locally and derived). Consumers then always receive valid material. If deferred, record the contract in the module doc and create a tracked task. |
| m7 | MINOR | `packages/config/src/schema.ts:174` | `NODE_ENV` defaults to `development` regardless of `APP_ENV`, and nothing requires `NODE_ENV=production` when `APP_ENV ∈ {staging, production}`. Libraries read `process.env.NODE_ENV` directly, not the config default, and ADR-0006 relaxes `Secure` cookies on `NODE_ENV=development`. | A staging or production task started without `NODE_ENV` (or with `development`) runs in development mode: Express defaults, cookie relaxation and the demo-seed gate (data-model L3842-3847, keyed on `NODE_ENV=production`). | Add a guard: in a hardened `APP_ENV`, a raw `NODE_ENV` other than `production` gives `forbidden-in-environment`. |
| m8 | MINOR | `packages/config/src/web/load-web-config.ts:12`; PR #4 `apps/web/app/seo/public-origin.ts` | The "web build" half of AT-US-002-04 is proven only at loader level, because apps/web and apps/admin don't call `loadWebBuildConfig` yet. PR #4 introduces `VITE_PUBLIC_ORIGIN`, which is outside `webConfigSchema` and read straight from `import.meta.env`. Vite also exposes **every** `VITE_*` variable automatically, whatever the schema says, so the "no secret can reach a bundle" claim holds only if the Vite configs stop doing that. | AT-US-002-04 is not end-to-end, and a misnamed `VITE_*` secret would ship in the bundle. | Track this for TASK-004 or the next owner: add `VITE_PUBLIC_ORIGIN` (an http(s) origin) to `webConfigSchema`. Both `vite.config.ts` files should call `loadWebBuildConfig(loadEnv(mode, root, ''))`, use `webBuildDefine` only, and set `envPrefix` to a prefix nothing uses. `loadWebBuildConfig` should reject unknown `VITE_*` keys. |
| m9 | MINOR | `packages/config/src/schema.ts:221` | `DB_POOL_MAX` is capped at 100 with a default of 10 for both services. data-model §7.1 and platform.md §5 say api 10 / worker 5, and TASK-003's client allows up to `APP_ROLE_CONNECTION_LIMIT = 200`. `DB_IDLE_TIMEOUT_MS` and `DB_CONNECTION_TIMEOUT_MS` (TASK-003 defaults of 10 000 and 5 000 ms) are not config keys, against ADR-0018 §6 (configuration over hard-coding). | Two validators disagree on one value, and the pool tuning is hard-coded. | See merge notes §4. Add both keys and make the default service-aware (or set worker = 5 in compose/ECS). Align the cap with TASK-003, or keep 100 deliberately and say so. |
| n1 | NIT | `keys.ts:341`, `schema.ts` (AUTH_*), DECISIONS.md | Naming drift from the spec is commented in code but not recorded: ADR `DB_URL`/`DB_MIGRATOR_URL` became `DATABASE_URL`/`DATABASE_MIGRATOR_URL`; the Gherkin `ACCESS_TOKEN_TTL_SECONDS`/`BCRYPT_COST`/`JWT_SECRET` became `AUTH_ACCESS_TOKEN_TTL_SECONDS`/`AUTH_BCRYPT_COST`/ES256 key set; the brief's 24 rows became 25. | Traceability. | The orchestrator should log one DECISIONS entry and add a story or AT-map note. |
| n2 | NIT | `schema.ts` (AUTH_* TTLs) | `AUTH_ACCESS_TOKEN_TTL_SECONDS` is an integer, while every other TTL uses the `<n><unit>` format. | Two conventions for one concept. | Pick one; `AUTH_ACCESS_TOKEN_TTL=15m` is consistent. |
| n3 | NIT | `secret.ts:20` | `reveal()` returns the shared, mutable `Uint8Array`, and `deepFreeze` can't freeze typed arrays. | Any consumer can mutate key bytes for all others. | Return a copy for `Uint8Array` values, or document the contract. |
| n4 | NIT | `testing/index.ts` | "Never import from production code" is not enforced. | Drift. | Add a boundaries rule with TASK-002. |
| n5 | NIT | `guards.ts` (`transportGuard`) | `BRAND_*` URLs, `OTEL_EXPORTER_OTLP_ENDPOINT` and SMTP (`MAIL_SECURE=false`) are not covered by the hardened-environment transport guard. | An `http:` logo causes mixed content; SMTP runs without TLS. | Optional: extend `HTTPS_KEYS` to `BRAND_*` absolute URLs. |

**APPROVED requires M1 and M2 closed.** Fixing m1–m4 in the same cycle is strongly recommended, because they sit on the security-critical path and each is under about 30 lines. m5–m9 may become tracked conditions, with owners in §4.

## 3. Focus-area answers

### 3.1 Register: 25 rows vs the brief's "24"
The ADR-0018 amendment table has **25** rows; I counted them and the brief is wrong. `KEY_REGISTER` reproduces each row in ADR order: algorithm, purpose, holders, storage, rotation, blast radius. The deliberate concretisations are documented in code:
- row 22 `CARRIER_<ACCOUNT>_SECRET_REF` becomes the three carriers;
- row 23 maps to `DATABASE_URL` / `DATABASE_MIGRATOR_URL` / `SHADOW_DATABASE_URL`, with the bootstrap credential "outside this schema";
- row 25 maps to the two storage refs plus `MAIL_SMTP_PASSWORD_REF`.

The `_PREVIOUS` variables exist exactly for the dual-read rows (tested). The non-dual rows (login-counter, mfa-challenge-bind, mfa-enrolment-code, the anchor key, the JWT set) match the ADR's "no dual" text. `key_id` purposes are unique, and `mfa-v1` matches data-model L1120. The withdrawn HMAC `AUDIT_CHECKPOINT_KEY` is absent, as it should be. The deviations are the holder enforcement and the JWT holder (m5).

### 3.2 Joi/Zod sharing
The web bundle is **not** coupled to Joi (verified). The coupling runs the other way, backend to Zod (M2).

### 3.3 Error messages name keys only
Confirmed by reading: `ConfigIssue` carries `key`, `code` and `rule`; Joi `detail.message` and `detail.context.value` are never read. The property tests cover every structured secret key, plus `inspect` and `stack`, and the child-process test checks real stderr. This is strong.

### 3.4 Providers, timeout and retries
- Only the `env` adapter exists; `file` and `aws-secrets-manager` exist as port and parser only (m4).
- The timeout is not enforced by the orchestrator (M1).
- There is no retry, and the catch-all collapses causes (m1).
- `SecretNotFoundError` is typed and value-free. That part is good.

### 3.5 Parity
`.env.example` parity is green (6/6, re-run). `compose.env` holds only `local-only-*` markers, starts api and worker with `APP_ENV=local` and is refused with `staging` (tests read). Both tests reject unknown keys, which is what forces the merge-time reconciliation in §4.

### 3.6 Ergonomics and immutability
`Config` is deeply frozen, except typed arrays (n3). Secrets are `Secret`-wrapped, and keys are `KeyVersion` objects with `Secret` material. Types are derived from the single schema, and per-service required sets come from the register. The flat UPPER_SNAKE shape differs from data-model §7.1's `config.db.appUrl` / `config.db.poolMax`: update the doc or add small selectors such as `databaseOptions(config, service)`. The async composition gap is m4.

### 3.7 Coverage
The PR claims 99.89 % / 97.69 %. **I did not re-run it** under the memory constraint. The gatekeeper must take it from the CI lane or a sequential local run before merge.

### 3.8 Author's questions to security
- **(1) Can local-only derivation be reached in a hardened environment?** No through `loadConfig`: `placeholderGuard` scans the raw value of every configured key, key variables included, for `local-only-` when `APP_ENV ∈ {staging, production}`, and `loadConfig` throws. A direct call to `parseKeyVersion` bypasses this, but that is a programming choice, not configuration.
- **(2) `<…>`-shaped real values:** yes, this matters (m3).
- **(3) AWS locator format:** acceptable, and the ARN or name regex is bounded.

## 4. Merge notes (batch 0.2 reconciliation)

1. **TASK-003 (PR #5) key gap.** TASK-005 owns `packages/config`. Whichever PR merges second reconciles the keys, and the parity tests will fail until it does.
   - `DATABASE_MIGRATOR_URL` and `SHADOW_DATABASE_URL`: the names already match TASK-003's `prisma.config.ts`. Move them out of the api/worker schema into the tooling set (m5).
   - Add `DB_IDLE_TIMEOUT_MS` (int 1..3 600 000, default 10 000) and `DB_CONNECTION_TIMEOUT_MS` (int 1..120 000, default 5 000) to `CONFIG_SCHEMA` and `.env.example`. These bounds are exactly TASK-003's `positiveInteger` bounds. Align the `DB_POOL_MAX` cap (100 vs 200) and the worker default of 5 (m9).
   - Keep `DATABASE_BOOTSTRAP_URL`, `BOOTSTRAP_MIGRATOR_PASSWORD` and `BOOTSTRAP_APP_PASSWORD` (and their `*_FILE` variants) **out of the api/worker schema**. Add an exported tooling key set to packages/config: `TOOLING_CONFIG_KEYS` with sensitivity `secret`, holders `bootstrap`/`migrate`, and a loader for tools/db. Include it in `ALL_CONFIG_KEYS`, so `.env.example` and `compose.env` can document the keys without failing the unknown-key check, and so the placeholder and `local-only` refusals apply to them too. Have api and worker refuse these keys outside `local` (m5).
   - Two file-secret conventions now exist: TASK-003's `NAME_FILE` and TASK-005's `file:` reference. Pick one. Recommended: keep the Docker-standard `NAME_FILE` for the tooling set, implemented once in packages/config next to `createFileSecretProvider` (m4), and have `tools/db/bootstrap.ts#readSecret` import it.
   - `prisma.config.ts` reads `process.env` directly. This is acceptable as a CLI-tooling exception to "only `process-env.ts` touches `process.env`"; note it in the package doc.
   - TASK-006's composition root maps config onto TASK-003's `createDatabaseAdapter({ connectionString: config.DATABASE_URL.reveal(), poolMax: config.DB_POOL_MAX, idleTimeoutMs: config.DB_IDLE_TIMEOUT_MS, connectionTimeoutMs: config.DB_CONNECTION_TIMEOUT_MS, applicationName: service })`.
2. **TASK-004 (PR #4):** add `VITE_PUBLIC_ORIGIN` to `webConfigSchema` and wire both Vite configs through `loadWebBuildConfig`/`webBuildDefine` (m8). Whichever PR merges second must run `tools/config/*.test.ts`.
3. **TASK-002:** re-run lint on this branch after TASK-002 merges, as the PR's open item states. Do not hand-merge the lockfile; regenerate it.
4. **TASK-008 (compose):** pass `DATABASE_MIGRATOR_URL` and bootstrap secrets to the migrate and bootstrap services only, override `REDIS_URL` per service (already noted in `compose.env`), and keep `AUDIT_ANCHOR_SIGNING_KEY` worker-only (m5).

## 5. Good patterns worth keeping
- `loadConfig` is pure (an explicit env record), with one thin process edge (`process-env.ts`) and an injectable `StartupIo`. A real child-process start test proves exit code 78, the stderr content and the "ready" path.
- One schema source derives the type, the Joi object, the secret list and the parity input. No hand-written interface can drift.
- Every error is names-only by construction (`ConfigIssue` has no value field). Property tests cover all secret keys across `message`, `inspect`, `stack` and JSON.
- `Secret` redacts through `toString`, `toJSON` and `inspect.custom`, uses a private `#value` and is frozen. Key material is compared by SHA-256 digest only.
- Test material is generated at run time (`createTestEnv`, P-256 via `generateKeyPairSync`), so no key literal is committed, and the PEM header in the parity test is assembled at run time.
- Hardened-environment refusals are tested from both sides: `compose.env` is refused under `staging`, and every `.env.example` placeholder is refused.

## 6. Security flags for security-analyst
- M1: the unbounded secret resolve hang is a start-up availability problem.
- m2: `--inspect_brk` and quoted-flag bypass of the SEC-P3-08 item 6 guard (CWE-489, debug feature left enabled). Low exploitability, since it needs control of the environment.
- m3: placeholder false positive on resolved secrets, a rotation-time outage.
- m5: holder and least-privilege enforcement (anchor signing key in the API, migrator URL in the runtime, JWT private set in the worker, shared `compose.env`).
- m6: the local-only key derivation contract; confirm it is unreachable outside local/test (my reading: yes, via `placeholderGuard`).
- m8: Vite auto-exposes any `VITE_*` variable, so the schema alone doesn't keep secrets out of bundles.
