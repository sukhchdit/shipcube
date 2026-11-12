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

---

## Round 2 (head 875409d)

| Field | Value |
|---|---|
| Head / delta | `875409d` (one commit over `be468bc`: 27 files, +1650/−156). The merge base is still `4da693a`, so **PR #2 (lint) is not yet in the branch**; a merge-main commit is being added concurrently and was not reviewed |
| Inputs | Round 1 (above); fix comment issuecomment-6825516810; D-ORCH-006 item 4; D-TASK005-02; PR #5 @ `4574a14` (TASK-003 names and pool defaults); `eslint.config.mjs` on `main` (PR #2) |
| Reviewer | code-reviewer (independent), 2026-11-12 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Both MAJORs are closed. A provider that ignores its signal is now cut off at timeoutMs/deadline
         (reproduced: no hang, no unhandled rejection, no leaked timer), and the backend validates BRAND_* with
         Joi only (no zod anywhere reachable from index.ts). All requested MINORs/NIT closed. Two new MINORs:
         Joi/Zod parity holds only for the curated vectors (R2-m1, fix in-PR recommended) and tooling keys
         have no hardened-env checks for the tools themselves (R2-m2, routed). Four NITs.
```

### R2.1 Verification performed by the reviewer

No install, build, Docker or worktree commands (per brief). Sources were taken with `git archive 875409d` into a reviewer-only scratch directory, and `node_modules` was junctioned to the **main** checkout (joi 18.3.2 and zod 4.6.7 there are exactly the PR lockfile versions). The scratch directory and the junctions were removed afterwards; main has 740 node_modules entries, unchanged.

| Check | Result |
|---|---|
| `jest --selectProjects unit` on `brand-rules`, `secret-refs` and `guards` tests (scratch copy) | **3 suites, 130/130 passed** (3.1 s) |
| `prettier --check packages/config/src tools/config` | pass |
| Lint under **main's** `eslint.config.mjs` (PR #2), no type information (lint-probe technique) | `packages/config/src`: **0 messages**. `tools/config`: 5 `import-x` resolution messages for `@platform/config[/web]`. These come from the scratch environment (main's node_modules has no `@platform/config` workspace link), but they must be re-checked on the merge-main commit |
| **Probe R1** (race): provider ignores the signal and rejects later; provider never settles; provider returns a plain value; provider honours the signal | Timeout reported at 26 ms (timeout 20 ms / deadline 60 ms). **0 unhandled rejections**, **0 timers** left after settling (apart from the provider's own). A non-promise return resolves. The signal reaches the provider at the timeout. Defaults: one attempt of 2000 ms, jitter of at most 300 ms, one retry of 2000 ms, total ≤ 4300 ms < 4500 ms deadline < 5 s NFR |
| **Probe R2** (NODE_OPTIONS vs real Node 24.22.3, `127.0.0.1:0` only) | 11 forms tried, **no bypass**: every form that turns the inspector ON (`"--insp"ect=…`, `"--inspect\=…"`, `--inspect=…\v`, a quoted form after another option) is refused. Over-refusals are harmless: a tab separator (Node exits 9), a leading NBSP, `--Inspect` (Node exits 9) |
| **Probe R3** (Joi vs Zod differential, outside the curated vectors) | **16 of 30 URL vectors and astral-plane BRAND_NAME values give different verdicts** (R2-m1) |
| Reconciliation with PR #5 @ `4574a14` | The tooling names (`DATABASE_MIGRATOR_URL`, `SHADOW_DATABASE_URL`, `DATABASE_BOOTSTRAP_URL`, `BOOTSTRAP_{MIGRATOR,APP}_PASSWORD[_FILE]`) match `prisma.config.ts` and `tools/db` exactly. Defaults 10 000 / 5 000 ms and bounds 3 600 000 / 120 000 match `client.ts`. The pool limit of 100 is stricter than the factory's 200, as ruled in D-TASK005-02 |
| Not re-run (constraints) | type-aware lint, typecheck, full `test:unit` (430), coverage (99.91 % / 97.56 % claimed), build. These rely on the author's gate table; the gatekeeper must re-run them **on the merge-main commit**, since PR #2's config has never run on this branch with type information |

### R2.2 Closure of round-1 findings

| ID | Status | Evidence (read and, where marked, re-run) |
|---|---|---|
| **M1** | **Closed** | `secret-refs.ts:161-179`: `Promise.race([provider.resolve(locator, signal), aborted])` with `signal = AbortSignal.any([attempt, deadline])`. The timer is cleared and the listener removed in `finally`. A late rejection by the provider is absorbed by `race`'s subscription, and the `aborted` promise never rejects once the listener is removed. A synchronous throw lands in `catch`. A single overall deadline (4.5 s) is enforced, and both budgets are validated. Tests use a real `new Promise(() => {})` provider (re-run) plus Probe R1 |
| **M2** | **Closed** | `schema.ts` builds `t.brandName()` and `t.urlOrRootPath()` natively in Joi from `brand-rules.ts`, which imports nothing. `t.zod` and every zod import are gone. The import-graph test proves that no zod is reachable from `index.ts` and that the web entry pulls in only `zod` (re-run). This conforms to D-ORCH-006 item 4. The residual parity gap is tracked as R2-m1 |
| m1 | **Closed** | Five value-free classes and a `cause` built only from the constructor name and an errno-shaped code (messages never read; property test with 25 runs, re-run). One retry with 100–300 ms full jitter, on timeout or provider error only, when a full attempt still fits. Nits in R2-n3 |
| m2 | **Closed** | `nodeOptionTokens` and `optionName` normalisation, the `--inspect*`/`--debug*` prefix check, and `execArgv` plus `inspector.url()` at the process edge. Probe R2 found no bypass. Doc nit in R2-n2 |
| m3 | **Closed** | `<…>` is matched only as a whole value, or as a component of URL, key-variable or secret-ref values. Marker words are anchored per component, with NFKC and percent-decoding. Property tests cover 500 printable-ASCII passwords and `<…>` embedded in generated passwords. Residual false positives need a separator directly before `changeme`/`placeholder`/`local-only-` (negligible for generated secrets) |
| m7 | **Closed** | `nodeEnvGuard`: staging and production require the raw value `NODE_ENV=production`, including when it is missing or empty; the value is never echoed |
| m9 | **Closed** | `DB_IDLE_TIMEOUT_MS` and `DB_CONNECTION_TIMEOUT_MS` added. `DB_POOL_MAX` defaults per service (`defaultFor(appEnv, service)`). The tooling set has moved out of the runtime schema, and api/worker refuse it in hardened environments by name only. The register's `db` row lists all 8 variables, with two-way parity tested |
| n3 | **Closed** | `reveal()` returns `Uint8Array.prototype.slice.call(value)`, so a `Buffer` stays a `Buffer` and the copy is independent (tested) |
| m4 (first half), m5, m6, m8, n1, n2, n4, n5 | Routed, as listed in the fix comment | m4's file-adapter half is done: `createFileSecretProvider` uses realpath confinement, a size cap, an abortable read, a regular-file check and path-free errors; it passes `../` traversal, junction escape and the growth race (tests read). n1 is logged as D-TASK005-02. `O_NOFOLLOW`, the mode check and the stat-then-read TOCTOU are routed to TASK-006/014 (acceptable: `/run/secrets` is a root-owned read-only mount) |

### R2.3 New findings

| ID | Sev | File:line | Problem | Why it matters | Required fix |
|---|---|---|---|---|---|
| R2-m1 | MINOR | `schema.ts:137-148` vs `web/web-schema.ts:24-33`; `brand-rules.test.ts:25-54` | Only the *limits* are shared, while the URL grammar and the length unit belong to each library. Joi `.uri()` is an RFC 3986 regex and counts UTF-16 units. Zod `z.url()` is the WHATWG `URL` parser (it trims and lower-cases the scheme) and counts code points. Probe R3: Zod accepts and Joi rejects `HTTPS://…`, `https://cdn.example.org/a b.svg`, `http:cdn.example.org/x`, `https:///logo.svg`, leading or trailing spaces, `…?x=<script>`, `/{x}`, `a"b`, `` a`b ``, `a^b`, `a|b` and IDN hosts. Joi accepts and Zod rejects `https://h:99999/x`. For **BRAND_NAME**, `'😀'.repeat(21)` and `'x'.repeat(39)+'😀'` are accepted by the web build and refused by the API, a counterexample to AT-US-002-04 "rejected identically" on its own key. The parity test passes only because every vector avoids this region | Brief §3.3 says the shared module exists "so the two validators cannot drift". Today they drift on ordinary operator typos (an uppercase scheme, a pasted trailing space). The failure is closed but appears late: the web build succeeds and the API exits 78 at deploy, or the reverse | Share **predicates**, not just limits. In `brand-rules.ts` add `brandNameLength(v) = [...v].length` (or state UTF-16 explicitly) and `isBrandUrl(v)`: no surrounding whitespace, length ≤ 2048, `ROOT_PATH_PATTERN`, or global `URL` (available in browser and Node with no import) with `BRAND_URL_PROTOCOL_PATTERN` and a non-empty host. Call them from Joi `.custom()` and Zod `.refine()` instead of `.uri()` and `z.url()`. Add a fast-check differential property (`fc.webUrl()`, `fc.string({ unit: 'grapheme' })` plus the R3 vectors) asserting equal verdicts. About 25 lines in owned files: **fix in this PR before merge** (D-ORCH-006 item 2 spirit), or make it a tracked condition for TASK-022 |
| R2-m2 | MINOR | `tooling-keys.ts`; `load-config.test.ts` (removed `DATABASE_MIGRATOR_URL` transport vector) | The tooling set is only a list of names. Nothing validates tooling keys **for the tools themselves** in a hardened environment: the migrate job in staging gets no placeholder/`local-only-` refusal and no `sslmode=verify-full` check on `DATABASE_MIGRATOR_URL`. Round 1 §4 asked for "a loader for tools/db" so that these refusals apply to them too. This is not a regression: at `be468bc` the check ran only when the *API* held the URL, which is now refused outright | The migrator holds DDL rights, so a placeholder or a plaintext connection there is the worst place to be lax | Add `checkToolingEnv(env, appEnv)` in packages/config, reusing `isPlaceholder` and `isVerifiedPostgresUrl`, and call it from `prisma.config.ts` and `tools/db/*` when `APP_ENV` is hardened. **Route:** TASK-014 / migrate-job owner, with a DECISIONS line |
| R2-n1 | NIT | `brand-rules.test.ts:81` | The `IMPORT` regex misses `import('zod')`, `require`, `createRequire` and import-equals. None exist today, so the test is correct now but can be bypassed by a future edit | Robustness of the M2 guard | Use `ts.preProcessFile(text, true, true)` (covers imports, re-exports and dynamic imports, ignores comments), or add a boundaries rule "packages/config/src/** except web/** → no zod" after the merge-main pass |
| R2-n2 | NIT | `guards.ts:80-83`; `guards.test.ts` "tabs and newlines separate tokens" | The doc says "the way Node's parser does: whitespace separates tokens". Node splits on U+0020 only (`node_options.cc`; Probe R2: `…\t--inspect=…` is one token, and Node exits 9) | Misleading for the next editor. Over-splitting is safe (it only adds refusals), and the doc should say so | Reword: "splits on any whitespace, which is stricter than Node (U+0020 only); over-splitting can only add refusals" |
| R2-n3 | NIT | `secret-refs.ts:106,146-150,196-198` | Permanent failures are retried: `SecretFileError` `OUTSIDE_ROOT`, `NOT_REGULAR`, `TOO_LARGE`, and `EACCES` all count as `providerError`. A retry that starts after the deadline reports `ref.timeout` and drops the first attempt's cause | It wastes up to 2.3 s of the budget and gives a misleading diagnosis | Treat `SecretFileError` codes (and the `EACCES`/`EPERM` errno) as non-retryable. When the deadline elapses during the sleep, return `first` |
| R2-n4 | NIT | `secret-refs.test.ts` M1 tests | Upper bounds such as `elapsed < 150` with 50 ms timers are tight for loaded CI. On this host a 30 ms timer fired at 44 ms (Windows ~15.6 ms granularity) | Flake risk in the hosted fast lane | Use `jest.useFakeTimers()` with `advanceTimersByTimeAsync`, or widen the bound to `timeout + 500` |

### R2.4 Can apps/web consume `@platform/config/web` under PR #2's rule?

**No, not as main stands.** `eslint.config.mjs` classifies `apps/*/**` as category `app`, which includes `apps/web/vite.config.ts` and `react-router.config.ts`. The web/admin policy disallows `toPackage('@platform/*')`, and `toPackage` expands to `source` **and** `source/**`, so `@platform/config/web` matches. It also disallows any `package` file whose `pkg` is not `shared` or `ui`. A `vite.config.ts` that imports `loadWebBuildConfig` therefore fails `boundaries` with "server packages (config, …) stay out of the browser bundle". The subpath itself is browser-safe: it has no joi and no `node:*` (tested).

What must change. The recommended path is an ADR-0003 amendment by the architect, under the "Architecture changes" rule:
1. **New category `web-build-config`.** It covers the exact files `apps/{web,admin}/{vite,react-router}.config.ts`. Its policy is placed after the web/admin prohibition, because the last matching policy wins, and allows only `{ module: { source: ['@platform/config/web'] } }` (exact, with **no** `/**`) plus the resolved-file arm for `packages/config/src/web/**`. The root `@platform/config` and `/testing` stay forbidden.
2. **Runtime app code (`apps/{web,admin}/app/**`) keeps the ban.** Values reach it only through `webBuildDefine` (Vite `define`), so no Zod or config code enters the bundle.
3. **Dependencies.** `apps/web` and `apps/admin` get `"@platform/config": "*"` as a **devDependency** (`import-x/no-extraneous-dependencies`).
4. **Lint probes or fixtures.** `app/x.tsx` → `@platform/config/web` is refused; `vite.config.ts` → `@platform/config` is refused; `vite.config.ts` → `@platform/config/web` is allowed.
5. **Interaction with PR #4's `envPrefix: 'VITE_PUBLIC_'` (TASK-022).** The schema's `VITE_API_BASE_URL`, `VITE_STRIPE_PUBLISHABLE_KEY`, `VITE_LOCALES` and `VITE_FEATURE_FLAGS_ENDPOINT` are then exposed **only** through `webBuildDefine`. That is the intended single path, but it has to be wired; renaming them to `VITE_PUBLIC_*` is the alternative.

The alternative of moving `brand-rules.ts` and `web-schema.ts` into `@platform/shared` needs no lint change. However, it gives `shared`, a runtime-bundled package, build-time environment parsing and contradicts ADR-0018 §1 ("Zod schema in `config/web`"), so it is not recommended.

### R2.5 Security flags (for security-analyst)
- **The inspector guard detects; it cannot prevent.** With `--inspect-brk` or `--inspect-wait` in NODE_OPTIONS, Node pauses *before* user code, so `loadConfigOrExit` never runs and the port stays open until attach or kill. With `--inspect`, the port is open from process start until exit 78. The preventive control must be on the platform: lint the task definition or Dockerfile for NODE_OPTIONS (Checkov custom policy) under TASK-014. INFO: `-r`/`--import` preloads can call `inspector.open()` after the config check.
- R2-m1: the web build accepts `"`, `<`, `` ` `` and spaces in BRAND URLs that the API refuses. The output paths (React attributes, JSON in `define`) encode them, so this is low risk, but the e-mail templates (backend) and the web disagree on the accepted set.
- R2-m2: no hardened-environment checks on the migrator and bootstrap credentials in the tools themselves.
- File provider: stat-then-read TOCTOU and missing `O_NOFOLLOW` (already routed to TASK-006/014).

### R2.6 Merge conditions
1. Gatekeeper re-runs type-aware `lint`, `typecheck`, `test:unit`, `test:coverage` and `build` on the **merge-main commit**, since PR #2's config has never run on this branch with type information. The 5 `tools/config` import-resolution messages from the probe must be absent.
2. R2-m1 is fixed in this PR (preferred) or recorded as a TASK-022 condition with a DECISIONS line.
3. R2-m2, R2-n1…n4 and the R2.4 lint carve-out are routed by the orchestrator (TASK-014, TASK-022, architect).
4. TASK-005 merges last in batch 0.2 (D-ORCH-006 item 5). If PR #5 changes its env names or pool defaults before then, `keys.test.ts` "[m9] tooling key set is exactly the TASK-003 names" and the pool-defaults test must be updated in the same merge.

### R2.7 Good patterns worth keeping
- Races are cleaned up with `finally` and a removable listener, and the bounded behaviour is proven with a genuinely non-cooperative provider.
- The retry gate is "a full attempt must fit the deadline", not just "time remains".
- Failure causes are built from code-defined identifiers only (constructor name plus an errno-shaped code), with a property test across message, code, name and raw throws.
- Mirror-Node tokenisation with probe results recorded in the test comment. The tooling keys are refused **by name only**, and tests check that their values never appear in the config or the error output.
- A dependency-free rules module with a static import-graph test is the right structure for every later Joi/Zod pair (address, parcel, customs). Extend it to shared predicates (R2-m1) before it is copied.

## Round 3 (head 0e48a2a)

| Field | Value |
|---|---|
| Head / delta | `0e48a2a`: one commit over `c277ea6` (16 files, +558/−100, all in `packages/config/src/**`; no dependency change). Merge base `44d6c2e`: PR #2 (lint) **is** in the branch; TASK-003 (`5964ccc`) is **not**. The concurrent merge-main commit is not part of this review |
| Inputs | Rounds 1–2 (above); fix comment issuecomment-6826964394; D-ORCH-007 item 1; D-TASK005-03; D-ORCH-009 |
| Reviewer | code-reviewer (independent), 2026-11-12. The review is by SHA only; no command was run in the `Shipqube-TASK-005` worktree |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R2-m1 is closed. Joi (.custom) and Zod (.refine) now call the same brand-rules.ts predicates and report the
         same rule ids. A 20 000-case loader-level differential run found 0 divergences on non-empty values. All four
         R2 NITs are closed, and every D-TASK005-03 behaviour is sound. 10 targeted mutants: 9 are killed by the
         intended test; M8 survives the property and is killed by the curated loader vectors. No BLOCKER/MAJOR; 4 NITs.
```

### R3.1 Verification performed by the reviewer

I ran `git archive 0e48a2a` into a reviewer-only scratch directory, with `node_modules` junctioned to the **main** checkout. Afterwards I removed both the junction and the directory. Main still has 740 node_modules entries, there is no stray junction at `C:\`, and `git status` is unchanged.

| Check | Result |
|---|---|
| `jest --selectProjects unit --testPathPatterns packages/config` (Node 24.22.3) | **9 suites, 447/447 passed** (21 s) |
| `prettier --check packages/config/src` | pass |
| **Probe P1**: `isBrandUrl` / `isBrandName` edge cases (33 URLs, 8 names) | Refused: `user@`, `user:@`, `%75ser@`, `[v1.x]`, an unclosed `[`, `a%2Fb`, `a%00` hosts, and backslash forms. Accepted, harmless: an empty userinfo (`https://@h`, `https://:@h`), `https://./`, `xn--a` / `xn--` (Node's URL is lenient on invalid punycode), hex or decimal IPv4 (`0x7f.1`, `2130706433`), `http://localhost`, `/../..`. Names: controls, U+202E, a lone surrogate and a ZWSP-only value are accepted (R3-n4) |
| **Probe P2**: loader-level differential. `loadConfig(api)` vs `loadWebBuildConfig` on whole `issues` arrays **including `rule`**, for `BRAND_NAME` / `BRAND_LOGO_URL` / `BRAND_FAVICON_URL`. 20 000 fast-check cases (webUrl, binary and grapheme strings, adversarial prefixes/suffixes incl. NBSP, BOM, `%`, `ü`); 10 931 of them rejected | **0 divergences** on non-empty values. The empty value is a **missing** key on both sides, but the web issue carries `rule: 'invalid_type'` and the backend issue has no rule (R3-n1, pre-existing) |
| **Probe P3**: trim-set parity (NBSP, BOM, U+2028, U+3000, U+180E, ZWSP, NEL around 40 × `x`) | Identical on both sides: `String.prototype.trim` is used by both, so there is one trim set |
| **Mutation runs** (sed on the copy, then the targeted test, then restore) | M1 Zod name without `.trim()`, M2 Joi returns the untrimmed value, M3 Joi back to `.uri()`, M4 Zod back to `z.url()`, M5 Joi `trimEnd` only: **all killed by the differential property alone**. M6 `ruleOf` returns `issue.code`: killed (6 AT-US-002-04 loader tests). M7 credentials check dropped: killed (curated vectors only; correct, because both sides stay equal). **M8** Zod name `.min(1).max(40)` instead of the predicate: **survives the property** (Zod 4 counts code points, so the verdicts are equal; only the rule id differs). It is killed by 3 curated loader tests (R3-n2). M9 the post-sleep deadline check removed: killed. M10 `permanent` ignored: killed (5 tests) |
| Not re-run (constraints) | type-aware `lint`, `typecheck`, the full `test:unit` (635 claimed), `test:coverage` (config 100 % lines / 97.46 % branches claimed), `build`. For these I relied on the author's gate table at `0e48a2a`. The gatekeeper re-runs them on the merge-main commit (TASK-003 is not yet in the branch) |

### R3.2 Closure of round-2 findings

| ID | Status | Evidence |
|---|---|---|
| **R2-m1** | **Closed** | `brand-rules.ts:44-83`: `brandNameLength` counts code points. `isBrandName` checks the trimmed value, 1..40. `isBrandUrl` accepts either `ROOT_PATH_PATTERN`, or a raw lower-case `http(s)://` URL with a non-`/?#` first authority character and RFC 3986 characters only (`%XX` well-formed); the check runs *before* WHATWG can trim, lower-case or encode anything. The value must then parse with a non-empty host and empty `username`/`password`, and be at most 2048 units (identical in every unit, because the accepted set is ASCII). Joi `Joi.string().custom(...)` (`schema.ts:137-146`) and Zod `.refine(...)` (`web-schema.ts:18-25`) both report `brand.name` / `brand.url`. `load-web-config.ts:15-18` maps a Zod `custom` issue's `params.rule`. `pickConfigured` drops `''`, so Joi's `string.empty` cannot surface. The two wrappers can therefore differ only in trimming and in the returned value, and the property checks both (M1/M2/M5). AT-US-002-04 now compares **whole issue arrays** (rule included) for 3 names and 3 URLs. Probes P2 and P3 found no divergence |
| R2-n1 | **Closed** | The AST scanner (`brand-rules.test.ts:198-224`) covers static imports, re-exports, import-equals, `import()`, `require()` and non-literal specifiers. It skips `import type` / `export type` only; inline `{ type X }` imports still count, which is correct under `verbatimModuleSyntax: true`, because the import is kept as a side-effect import. JSDoc/`ImportType` nodes are correctly ignored. The probe fixture exercises every form plus comment and string decoys. Residual: R3-n3 |
| R2-n2 | **Closed** | `guards.ts` doc reworded as requested |
| R2-n3 | **Closed** | `PERMANENT_ERROR_CODES` (3 `SECRET_FILE_*` codes plus `EACCES`, `EPERM`) is matched by code, so there is no adapter import. A permanent failure is marked as such and returned without sleeping (`secret-refs.ts:228`). After the sleep, `if (plan.deadline.aborted) return first` (`:234`). The changed expectation in the old "retry after the deadline" test, from `ref.timeout` to `ref.providerError (Error)`, is exactly the requested behaviour, and M9 proves the test detects removal of the line. Timer ordering is deterministic: the 200 ms deadline timer expires before the 260 ms injected sleep. `EIO` is still retried. The `errno` locator in the classification test now expects 1 call (EACCES is permanent), which is consistent |
| R2-n4 | **Closed** | `SLACK_MS = 500`. Masking analysis: (a) the late provider now settles at **5 000 ms** (with `unref`), so a missing cut-off still shows up as about 5 s against a 550 ms bound; (b) a missing deadline gives about 5 s against 560 ms; (c) a missing per-attempt timeout is still caught by "[m1] retries a timeout once" (timeout 30 ms, default 4.5 s deadline) and by call counts. The only regressions the wider bound can hide are cut-offs that happen but 100–500 ms late, which is acceptable. The file-provider abort test now aborts after `readFile` has started. That pins the abort-during-read path, which is the one under test (the pre-aborted path is tested just above). If `readFile` were never called, the test would fail by Jest timeout rather than pass |

### R3.3 D-TASK005-03 behaviour rulings

| Item | Ruling |
|---|---|
| (1) Punycode required; credentials refused; non-RFC-3986 characters refused; one validator for `VITE_API_BASE_URL` / `VITE_FEATURE_FLAGS_ENDPOINT` | **Accept.** Refusing a lower-case-insensitive scheme (`HTTPS://`) is stricter than RFC 3986 §3.1 but deterministic, and it is documented. Invalid punycode (`xn--a`) passes because Node's URL is lenient. Both sides run in Node at build time, so parity holds; the only effect is a broken logo, which is an operator typo (INFO) |
| (2) pg query allow-list, TCP host, no `%` in host | **Accept.** `ssl` is now refused by the allow-list, so the old explicit `!has('ssl')` check is subsumed. `postgresql:` is a non-special scheme, so WHATWG keeps `%2F` visible in `hostname` and the `%` test is effective (tested). Multi-host and bad-port URLs fail to parse and are refused (fail closed) |
| (3) Valkey raw `rediss://`, non-empty host, no `?`/`#` | **Accept.** It mirrors ioredis's raw-prefix TLS decision. An upper-case `REDISS://` is refused, which fails closed |
| (4) Transport guard skips keys the schema rejected | **Accept.** `configObjectSchema` includes every `CONFIG_KEY_NAMES` key for every service, so `key in values` is false only for absent or schema-rejected keys, and startup still fails on the schema issue |
| (5) Permanent errors not retried; deadline during sleep keeps the first diagnosis | **Accept** (see R2-n3). The injected `sleep` is not abortable, but the pre-sleep fit check makes overrun possible only with a misbehaving injected sleep |
| (6) `APP_ENV=local` or `test` refused with ECS metadata variables present | **Accept.** It checks presence only, the value never appears in the output (tested), empty counts as absent, and it does not affect hardened environments. ECS on EC2 agents inject `ECS_CONTAINER_METADATA_URI_V4`, so the signal is present on the target platform |
| PR3-SEC-15 `errorClassName` | **Accept.** It reads own data descriptors only (no getter runs), and Error/Exception-shaped names only. Residual: a letters-only data value embedded in a dynamically named class (`L<letters>Error`) would pass. The property cannot generate that case because hex values always contain digits, but the threat (a provider building class names from secrets) is not realistic |

### R3.4 New findings

| ID | Sev | File:line | Problem | Why it matters | Fix |
|---|---|---|---|---|---|
| R3-n1 | NIT | `web/load-web-config.ts:32` vs `load-config.ts:26` | A **missing** required key yields `{code:'missing', rule:'invalid_type'}` on the web side and `{code:'missing'}` on the backend (Probe P2, `BRAND_NAME=''`). This is pre-existing and outside the AT's "invalid" wording | Another small shape drift in the same "rejected identically" surface | Omit `rule` when `code === 'missing'` in the web loader. Add `''` and unset `BRAND_NAME` to the AT-US-002-04 whole-array test |
| R3-n2 | NIT | `brand-rules.test.ts:23-34` | The differential `Verdict` carries the accepted flag and the value, not the rule id. Mutant M8 (the Zod name back to native `.min/.max`) passes the property and is caught only by 3 curated loader vectors | The property should be the guard that cannot be sidestepped by vector choice | Add `rule` to the rejected verdict: Joi `error.details[0].context.rule ?? type`, Zod via the same `ruleOf` (export it from `load-web-config.ts` or move it next to the schema) |
| R3-n3 | NIT | `brand-rules.test.ts:222,242-249` | The backend graph follows only relative specifiers and **deny-lists** zod. A package self-reference (`import … from '@platform/config/web'`, resolvable through `exports`), a `#imports` alias, or `process.getBuiltinModule('node:module')` would bring Zod into the backend graph undetected. `import-x/no-self-import` does not cover self-reference by package name | A realistic drift path: someone reuses `BRAND_VALUE_SCHEMAS` in `schema.ts` | Change to an allow-list: externals ⊆ {`joi`, `node:crypto`, `node:fs`, `node:fs/promises`, `node:inspector`, `node:path`, `node:timers/promises`, `node:util`} (today's exact set), so any `@platform/*`, `#…` or new package fails |
| R3-n4 | NIT | `brand-rules.ts:51-54`; `brand-rules.test.ts:54` | `isBrandName` accepts C0/C1 controls (`\n`, NUL), bidi overrides (U+202E), lone surrogates (a curated vector **pins** `'\uD800'` as accepted) and invisible-only names (ZWSP). This is pre-existing and parity holds | BRAND_NAME reaches the e-mail From display name and Subject (backend) and the document title. A newline or bidi override there is a header and spoofing hygiene problem, even though the value is operator-set | Add one shared check in the predicate, e.g. refuse `/[\p{Cc}\p{Cs}\u200B-\u200F\u202A-\u202E\u2066-\u2069]/u` plus `!value.isWellFormed()`, and flip the lone-surrogate vector. Fix in-PR (about 3 lines) or route to TASK-022 / the e-mail template task |

### R3.5 Security flags (for security-analyst)
- R3-n4: control, bidi and lone-surrogate characters in BRAND_NAME, which flows into e-mail headers.
- `isBrandUrl` accepts loopback, hex/decimal IPv4 and `http:` absolute URLs in hardened environments (the round-1 n5 mixed-content point is still open). This is harmless while only browsers fetch these URLs. If any backend job ever fetches `BRAND_*` URLs (for example, to inline a logo in e-mail), add host restrictions there (SSRF).
- `errorClassName` residual (letters-only data in a class name): INFO, not exploitable in practice.

### R3.6 Merge conditions
1. Gatekeeper re-runs type-aware `lint`, `typecheck`, `test:unit`, `test:coverage` and `build` on the merge-main commit that brings in TASK-003 (`5964ccc`). Run `keys.test.ts` "tooling key set is exactly the TASK-003 names" and the pool-defaults test there.
2. R3-n1…n4 are optional in-PR. Otherwise the orchestrator routes them (R3-n3 to TASK-015 or TASK-022, R3-n1/n2/n4 to TASK-022).
3. Round-2 routings are unchanged: R2-m2 → TASK-014; PR3-SEC-13/14 → TASK-014/016; the `@platform/config/web` lint carve-out → TASK-022 (D-ORCH-007 item 3).

### R3.7 Good patterns worth keeping
- The predicates are applied to the **raw** string before any WHATWG normalisation, and the parser is used only as a structural second check.
- The rule id travels in Joi `context.rule` and Zod `params.rule` and is mapped once per loader, so whole issue arrays can be compared.
- The differential property also checks the *value* (trim output), not just the verdict. Five of six wrapper mutants die on the property alone.
- Permanent failures are classified by code rather than by importing the adapter, so the port stays dependency-free.
- The late provider settles at 5 s when the slack is widened, which keeps the cut-off proof meaningful.

## Round 4 — merge-main delta (head 3e390e0)

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Merge 4cfd055 is a clean union of 0e48a2a and origin/main @376ceca. Only package-lock.json changed on both
         sides, and the lock delta vs main is exactly packages/config +zod ^4.6.7. Test 3e390e0 is sound: deterministic,
         prints no secret, and allowed by the layering rules. No new BLOCKER/MAJOR; the round-3 verdict carries forward.
```

### R4.1 Verification (by SHA, read-only, in the main checkout after `git fetch`)
- **Merge union.** Merge-base `44d6c2e`. The only file changed on both sides is `package-lock.json`.
  - At `4cfd055`, every branch-only path is byte-identical to `0e48a2a`.
  - At `4cfd055`, every main-only path is byte-identical to `376ceca`.
  - Nothing in the merge differs from both parents except the lock.
  - Main's content (TASK-003 `5964ccc`) was already reviewed in PR-0005.
- **Lock.** `git diff origin/main 3e390e0 -- package-lock.json` is one hunk: `packages/config` dependencies `joi` → `joi` plus `zod ^4.6.7`. This is identical to the branch's own lock delta vs the merge-base, so no transitive or version drift came in.
- **`4cfd055..3e390e0`.** One file, `tools/config/compose-env.test.ts`, with 9 lines added. There are no production changes.
- **Test soundness.**
  - **Keys.** It covers the same keys that `tools/db/bootstrap.ts:271` reads (`BOOTSTRAP_MIGRATOR_PASSWORD` and `BOOTSTRAP_APP_PASSWORD`). It calls the same `scramSha256Verifier` that bootstrap calls (`bootstrap.ts:107`).
  - **Missing key.** A missing key becomes `''`, which fails with the key name.
  - **No secret in failure output.** The length assertion prints `{key, long}` only. `ScramPasswordError` messages never contain the password (`scram.ts` doc comment and messages).
  - **Determinism.** The salt is random, but the assertion depends only on length and charset, so the result is deterministic. The cost is 2 × PBKDF2 at 4096 iterations, which is negligible.
  - **Values.** I checked the compose.env values without printing them: 37 and 32 characters, both printable ASCII.
- **Layering.** `tools/config/**` is category `tools` and `tools/db/**` is `tools-db` (`eslint.config.mjs:123-124`). No policy restricts tools → tools-db, and `scram.ts` imports only `node:crypto`, so the Prisma/SQL-driver rules don't apply. The test sits in the same `tools` tree as the code it tests.

### R4.2 Findings
| ID | Sev | File:line | Problem | Fix |
|---|---|---|---|---|
| R4-n1 | NIT | `tools/config/compose-env.test.ts:58-62` | If the printable-ASCII rule fails, `not.toThrow()` reports the error but not which of the two keys failed, because both are checked in one loop | Use `it.each(['BOOTSTRAP_MIGRATOR_PASSWORD','BOOTSTRAP_APP_PASSWORD'])`, or label the second assertion `{key, ok}` like the first. Optionally pass a fixed salt so it is fully deterministic |

### R4.3 Merge conditions
- R3.6 still applies. The gatekeeper re-runs the gate on `3e390e0`. The PR comment reports it green, but I did not re-run it here (no npm ci/build in this delta, per the brief).
- `gh pr view 3` shows **no status checks** on head `3e390e0`. Merge needs passing CI (CLAUDE.md §5), so confirm the fast-lane workflow has run on this head before merging.
