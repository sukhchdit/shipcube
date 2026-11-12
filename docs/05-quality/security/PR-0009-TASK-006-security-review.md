# PR-0009 / TASK-006: change-scoped security review

| Field | Value |
|---|---|
| PR | #9 `feat(api): api and worker runtime skeleton, problem+json errors, health probes (TASK-006)`, https://github.com/sukhchdit/shipcube/pull/9 |
| Branch / head | `feat/TASK-006-api-worker-runtime-skeleton-express` @ `374166d`; merge-base `main` @ `7712c7c`; 8 commits (`23e6060` config start-up, `65e97d1` runtime skeleton, `920a195` lint, `feb5160` session integrity + minimal Prisma errors, `d927ce3` sheet alignment, 3 merges of `main`); 70 files, +3,729 / −74 |
| Scope | `apps/api/src/{app.ts, main.ts, platform/{context,errors,health,http,runtime,db,valkey}/**, modules/index.generated.ts}`; `apps/worker/src/{main.ts, platform/health/server.ts}`; `packages/config/src/{process-env,holders,secret-refs,file-secret-provider,guards,schema,load-config}.ts`; `packages/shared/src/errors/**`; `tools/api/gen-module-registry.ts`; `tools/deps/prisma-engines.mjs`; `eslint.config.mjs`; `compose.env`, `.env.example` (one key each); `package-lock.json` (one workspace edge) |
| Security requirements in scope | REQ-PLAT-009/010/011/018, REQ-SEC-015 (body limit and media types only), NFR-SEC-007/009, NFR-AVAIL-002; ADR-0016 §3/§4/§11/§15, ADR-0018 §3/§4 + am. 1/5–8, ADR-0005 am. 10 items 4/6/12; threat model T-11, L-14, R-13, R-22; WAVE-00 TASK-006 sheet (incl. the D-ARCH-070 lines) |
| Routed items checked | PR3-SEC-05 (binding), PR3-SEC-06, PR3-SEC-07 residual, PR3-SEC-16, PR3-SEC-02/-12 consumer half, PR5-SEC-07 (TASK-006 half), PR5-SEC-08, PR7-SEC-02 item 2, PR7-SEC-03 items 2/4, PR7-SEC-06 item 3 |
| Reviewer / date | security-analyst, 2026-11-12. Read-only. No install, build, Docker or suite run (memory-constrained host, D-ORCH-010). The head was extracted with `git archive 374166d`, type-stripped with Node 24.22.3 and probed in-process against the worktree's `node_modules` through a scratch junction (removed afterwards; the worktree is clean) |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open. 6 LOW, 7 INFO, each routed below. The merge rule "no Critical/High open" (D-ORCH-004 bootstrap rule) is met. |

## 1. Summary

The skeleton gets the security-relevant defaults right, and every routed item that this PR claims is closed holds up under independent probing:
- **No internals in error bodies.** A thrown Prisma-style `P2039` error with a table name and an e-mail address in its message and `meta` yields the generic 500 problem document; the logger receives scalar fields only. Every 5xx carries the generic detail; `instance` drops the query string and is capped at 2,048 characters.
- **Request edge.** 1 MB limit (also enforced after `gzip` inflation: a 5 KB bomb of 5 MB gives 413), strict JSON (scalars refused), a JSON-only media-type allow-list before any read (form and missing types give 415, which keeps the SEC-P3-18 CSRF premise), Express 5 `simple` query parser, `__proto__` stays an own key (no pollution), no `X-Powered-By`, CORS default-deny (no `Access-Control-Allow-Origin`; the automatic `OPTIONS` answer carries none, so browsers block cross-origin reads).
- **Start-up refusals are value-free and exit 78.** Live Stripe key (`sk_live_`, `rk_live_`) behind an `env:` reference in staging or production, a placeholder behind a reference, a `file:` reference outside `/run/secrets`, an unknown provider, and a key the register gives to another holder (`AUDIT_ANCHOR_SIGNING_KEY` on the api) all exit 78 naming the key only.
- **Transport.** The `pg` query-parameter allow-list survived a 20,000-run differential fuzz against `pg-connection-string` with 0 violations. Valkey is built from parsed parts with explicit `tls: { servername, minVersion }`; `REDISS://`, the opaque `rediss:` form and query strings are handled.
- **Session integrity.** The readiness guard compares the role and database settings exactly with `00-roles.sql` (tied by a unit test) and requires NULL tenant context on the first probe.

The LOW findings are hardening gaps around these controls, not defects in them:
- **01:** the JSON parser accepts UTF-7 and UTF-16 bodies; UTF-7 smuggles keys and markup past byte-level inspection (WAF).
- **02:** npm's `node-options` setting puts `NODE_OPTIONS` back into the Prisma child after `prismaChildEnv` dropped it.
- **03:** `PGOPTIONS` still reaches the runtime pool (PR7-SEC-02 item 3), and the guard reads catalog rows, not effective session values.
- **04:** `NODE_TLS_REJECT_UNAUTHORIZED=0` would silently switch off certificate checks for PostgreSQL and Valkey; nothing refuses it.
- **05:** the 5-minute re-check runs only when `/health/ready` is polled, and in ECS nothing polls it after a deployment (PD-05).
- **06:** the API listener keeps Node's default timeouts (300 s request, 60 s headers), and the global body parser runs before any limiter.

## 2. Method

- **Diff review.** `gh pr view 9`, `gh pr diff 9`, `git diff 7712c7c..374166d` for every file. Sinks traced: thrown value → problem body and log; request headers → correlation ID → response header and log; body → parser; `DATABASE_URL` → `pg`; `REDIS_URL` → ioredis; secret references → providers → stderr; environment → Prisma child; module folder names → generated TypeScript.
- **Independent probes** (scratch `…/scratchpad/review/PR-9-sec/scripts/`, Node 24 `stripTypeScriptTypes` in transform mode; every probe has a positive control):
  - `probe-db.mjs`: 16 fixed URL cases plus a fast-check differential (20,000 runs, 4,165 accepted) with the invariant "guard accepts ⇒ `pg-connection-string` yields no key outside the allow-list, and `pg` keeps `options` unset, `statement_timeout` 25,000 and `application_name` `api`"; the `PGOPTIONS` fallback; 7 Valkey URLs through `buildValkeyOptions` into a lazy `new Redis()`.
  - `probe-http.mjs`: `createApp` on a real listener with throwing routes (Prisma-like error, partial response, non-serialisable `errors`, a Proxy posing as `AppError`), 404/405/`OPTIONS`/readiness, correlation-ID cases, 415/400/413, a gzip bomb, `__proto__`, a 5,000-character path, and the listener's timeout and `trust proxy` settings.
  - `probe-charset.mjs`: request charsets UTF-8 (control), UTF-7 smuggling, UTF-16LE, UTF-32, latin1.
  - `probe-config.mjs`: `loadRuntimeConfigOrExit` in staging and production with the refusal cases above, and the holders check in staging and local.
  - npm `node-options`: `npm exec` with `npm_config_node_options`, `NPM_CONFIG_NODE_OPTIONS` and a project `.npmrc` (`node-options=`), each with `NODE_OPTIONS` unset in the parent; and the `--node-options=` CLI override.
- **Library facts read** (worktree `node_modules`): `body-parser` 2.4.0 `lib/types/json.js:56` (`isValidCharset: charset.slice(0, 4) === 'utf-'`); `finalhandler` 2.1.1 `index.js:73` (env defaults to `development`; the body carries `err.stack` unless `production`); `pg` 8.23.1 `connection-parameters.js:9-23, :83` (`options` falls back to `PGOPTIONS`); `pg-connection-string` 2.14.1 (`sslmode=verify-full` → `ssl: {}`; URL keys override explicit config); npm 11 `@npmcli/config/lib/set-envs.js:102-103` (`env.NODE_OPTIONS = cliConf['node-options']`).
- **Documents read.** WAVE-00 TASK-006/TASK-007/TASK-010/TASK-014/TASK-017/TASK-020 sheets, WAVE-01 TASK-048, WAVE-03 TASK-108/TASK-111; ADR-0016, ADR-0018 (+ am. 8), ADR-0005 am. 10; platform.md §2 (compose table), §4.4 (edge, WAF), §5.3 (PD-05), the image table; threat model T-11, L-14, R-13, R-22; P3 review SEC-P3-17/18; PR-0003, PR-0005 and PR-0007 reviews; DECISIONS D-ARCH-070, D-TASK006-01.
- **Secrets.** The added diff (excluding `.env.example`, which adds `DB_STATEMENT_TIMEOUT_MS=25000` only) was grepped for Stripe, webhook, PEM, AWS, GitHub, Slack, JWT and credential-URL patterns: 0 hits. Test fixtures generate random values at run time. gitleaks (Docker) was not run (memory constraint).
- **Supply chain.** No new dependencies. The lockfile delta is the single `"@platform/api": "0.0.0"` workspace edge under `apps/worker`; the `@platform` scope resolves to `registry.invalid` (`.npmrc`, PR1-SEC-01), so no dependency confusion.

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Owner |
|---|---|---|---|---|---|
| PR9-SEC-01 | JSON parser accepts UTF-7/UTF-16/UTF-32 bodies; UTF-7 smuggles keys and markup past byte-level inspection | LOW | CWE-180, CWE-172 | A05 | senior-developer (this PR, recommended) or TASK-108 |
| PR9-SEC-02 | npm `node-options` (env or `.npmrc`) reinstates `NODE_OPTIONS` in the Prisma child | LOW | CWE-15, CWE-426 | A08 | senior-developer (this PR or TASK-007, `tools/deps`) |
| PR9-SEC-03 | `PGOPTIONS` still reaches the runtime pool; the integrity guard checks catalog rows, not effective session values | LOW | CWE-15 | A05 | TASK-016 (binding, factory) + TASK-014 (preflight); guard part optional here |
| PR9-SEC-04 | `NODE_TLS_REJECT_UNAUTHORIZED=0` silently disables PostgreSQL and Valkey certificate verification | LOW | CWE-295 | A07 | senior-developer (Valkey pin, this PR) + `packages/config` guard (this PR or TASK-014) |
| PR9-SEC-05 | Session-integrity re-check runs only when `/health/ready` is polled; ECS does not poll it after deployment | LOW | CWE-778 | A09 | senior-developer (this PR or TASK-016); TASK-214 alternative |
| PR9-SEC-06 | API listener keeps Node's default timeouts; global body parsing precedes any limiter | LOW | CWE-400, CWE-770 | A05 | TASK-108 (REQ-SEC-015 timeout), TASK-020 (pipeline order); listener settings optional here |
| PR9-SEC-07 | Problem handler is not exception-safe; a throw inside it reaches Express's `finalhandler` (HTML, stack trace outside `NODE_ENV=production`) | INFO | CWE-209 | A05 | senior-developer (optional) |
| PR9-SEC-08 | Readiness performs dependency I/O per request without coalescing (unauthenticated, no rate limit) | INFO | CWE-400 | A04 | senior-developer (optional); TASK-014 (edge) |
| PR9-SEC-09 | No security-header baseline on API responses until TASK-111 (Wave 3); problem bodies reflect the path | INFO | CWE-693 | A05 | TASK-111; optional interim here |
| PR9-SEC-10 | The client correlation ID is the only request key; no server-generated request ID seam (L-14, SEC-P3-17) | INFO | CWE-807 | A09 | TASK-010, TASK-030 |
| PR9-SEC-11 | Pending audit checks report `ok`; an unverified audit chain should never read healthy | INFO | CWE-392 | A09 | TASK-019, TASK-021; optional here |
| PR9-SEC-12 | The worker now depends on the whole `@platform/api` package (api-only dependencies in the worker closure) | INFO | CWE-1164 | A05 | TASK-014 (image pruning) |
| PR9-SEC-13 | File provider residuals: `O_NOFOLLOW` covers the final component only; `translateFsError` reads `code` through a getter | INFO | CWE-367 | A04 | accepted (note) |

### PR9-SEC-01 (LOW): the JSON parser accepts UTF-7, UTF-16 and UTF-32 request bodies

**Where.** `apps/api/src/platform/http/json-body.ts:25-42`; `body-parser` 2.4.0 `lib/types/json.js:56` (`isValidCharset: (charset) => charset.slice(0, 4) === 'utf-'`).

**Description.** The pre-check allows the JSON media types and then hands the body to `express.json`, which accepts **any** charset beginning with `utf-` and decodes it with iconv-lite. RFC 8259 §8.1 requires UTF-8 for JSON exchanged between systems. Probe (`probe-charset.mjs`):

| Request | Result |
|---|---|
| `charset=utf-8`, `{"a":"x"}` (control) | 200 `{"a":"x"}` |
| `charset=utf-7`, raw bytes `{"a":"x+ACI-,+ACI-role+ACI-:+ACI-admin+ACI-,+ACI-n+ACI-:+ACI-+ADw-script+AD4-"}` (the raw bytes contain neither `"role"` nor `<script`) | 200 `{"a":"x","role":"admin","n":"<script>"}` |
| `charset=utf-16le` | 200 |
| `charset=latin1` | 415 |

**Exploitability / impact.** Anything that inspects request bytes sees a different document from the one the application parses. This is mainly the edge WAF (platform §4.4: CloudFront and ALB web ACLs with managed SQLi/XSS groups; AWS WAF has no UTF-7 text transformation), and later any byte-level size, signature or logging step. The application's own controls (Joi with `allowUnknown: false`, parameterised queries, output encoding) still apply to the decoded body, so this bypasses a defence-in-depth layer, not a primary control. Crafting it is trivial. Likelihood M × Impact L → **LOW**.

**Remediation** (`json-body.ts`, before `parse`). Accept a body only when the charset is absent or UTF-8. `content-type` 2.1.0 (MIT, jshttp) is already in the lockfile as a transitive dependency of Express. Declaring it directly is one lockfile line and needs the usual dependency justification. A local parser would also do.
```ts
import contentType from 'content-type';

function isUtf8Json(req: Request): boolean {
  const header = req.headers['content-type'];
  if (header === undefined) return false;
  try {
    const charset = contentType.parse(header).parameters['charset'];
    return charset === undefined || charset.toLowerCase() === 'utf-8';
  } catch {
    return false;
  }
}
// in jsonBodyParser:
if (typeof req.is([...JSON_MEDIA_TYPES]) !== 'string' || !isUtf8Json(req)) {
  next(new AppError('UNSUPPORTED_MEDIA_TYPE'));
  return;
}
```
Keep the `charset.unsupported` → 415 mapping in `classify.ts` as the backstop.

**Verification.** `problem-handler.api.test.ts` (or a new `json-body.api.test.ts`): `charset=utf-7` with the `+ACI-` payload → 415 `UNSUPPORTED_MEDIA_TYPE` and the handler never runs; `utf-16le`, `utf-32` → 415; `UTF-8` (upper case) and no charset → 200; malformed `Content-Type` parameters → 415.

### PR9-SEC-02 (LOW): npm's `node-options` puts `NODE_OPTIONS` back into the Prisma child

**Where.** `tools/deps/prisma-engines.mjs:442-457` (`DROPPED_CHILD_ENV = ['NODE_OPTIONS']`); `tools/deps/prisma-cli.mjs:43-45` and `tools/deps/rebuild.mjs:160-161` (both start Prisma as `node <npm-cli> exec … prisma`); npm 11 `@npmcli/config/lib/set-envs.js:102-103`.

**Description.** `prismaChildEnv` removes `NODE_OPTIONS` (any case), but the child it starts is **npm**, not Prisma. npm reads its `node-options` setting from `npm_config_node_options` / `NPM_CONFIG_NODE_OPTIONS`, from the project, user or global `.npmrc` (or from files named by `npm_config_userconfig` / `npm_config_globalconfig`), and writes it into `process.env.NODE_OPTIONS` before it spawns the `prisma` bin. Probe, with `NODE_OPTIONS` unset in the parent:

| Source | `NODE_OPTIONS` seen by the command `npm exec` runs |
|---|---|
| `npm_config_node_options=--max-old-space-size=123` | `--max-old-space-size=123` |
| `NPM_CONFIG_NODE_OPTIONS=…124` | `…124` |
| project `.npmrc` `node-options=…125` | `…125` |
| any of the above plus `npm exec --node-options=` | `undefined` |

So the PR5-SEC-07 attack stays open: a `--require` / `--import` preload inside the Prisma CLI sets `PRISMA_MIGRATION_ENGINE_BINARY` (preferred by `@prisma/fetch-engine` over the verified `PRISMA_SCHEMA_ENGINE_BINARY`), and the after-child re-hash of the verified file still passes.

**Exploitability / impact.** It needs control of the environment or of an `.npmrc` on the machine that runs `db:*`, `deps:rebuild` or the migrate image entrypoint. That is the same precondition as `NODE_OPTIONS` itself, which is why PR5-SEC-07 was INFO. A persistent per-user `.npmrc` makes the vector stealthier, and a working bypass of a control this PR claims to close is worth recording. Impact H (unverified engine binary with migrator credentials) × Likelihood L, and the compound precondition gives **LOW**.

**Remediation.**
1. Neutralise npm's setting on the command line, which beats every npmrc and env layer: `[npmCli(), 'exec', '--node-options=', '--no', '--', 'prisma', ...args]` in `prisma-cli.mjs`, and the same flag in the Prisma step of `rebuild.mjs`.
2. Belt: `DROPPED_CHILD_ENV = ['NODE_OPTIONS', 'NPM_CONFIG_NODE_OPTIONS']` (the comparison is already upper-cased).
3. Better long-term: resolve the Prisma CLI entry (`require.resolve('prisma/build/index.js')`) and spawn `process.execPath` on it directly, so no npm configuration takes part.

**Verification.** Unit: `prismaChildEnv({ npm_config_node_options: '--require x' }, …)` drops the key, and the argv built by `runPrisma` contains `--node-options=`. Integration (`prisma-engines.int.test.ts`): with a scratch `.npmrc` containing `node-options=--require <probe.cjs>` that writes a marker, `runPrisma(['--version'])` leaves no marker.

### PR9-SEC-03 (LOW): `PGOPTIONS` still reaches the runtime pool, and the guard reads catalog rows only

**Where.** `apps/api/src/platform/db/client.ts:77-106` (no `options` set); `pg` 8.23.1 `connection-parameters.js:9-23, :83`; `apps/api/src/platform/db/session-integrity.ts:31-41`.

**Description.** PR7-SEC-02 item 3 ("the factory refuses a defined `PGOPTIONS`") is still open. Probe: with `PGOPTIONS='-c app.org_id=<uuid> -c lock_timeout=0'`, `new pg.Client(toPoolConfig(…)).connectionParameters.options` equals that string. The explicit `statement_timeout` startup parameter still wins. Session-start options outrank role and database settings, though, so `-c lock_timeout=0 -c idle_in_transaction_session_timeout=0 -c search_path=…` silently removes the role defaults that F-03, F-09 and T-83 rely on.

The new guard catches the tenant-context half: the first probe requires the four `app.*` keys to be NULL. It cannot see the settings half, because it compares `pg_db_role_setting` rows, not the **effective** values on the connection. RDS parameter-group or `ALTER SYSTEM` changes are invisible for the same reason. Two smaller gaps:
- the query keys on `current_user`, while role settings apply to the login role (`session_user`);
- it omits the `ALTER ROLE ALL` row (`setrole = 0 AND setdatabase = 0`), which needs superuser.

**Exploitability / impact.** Requires environment control or a misconfigured task definition. The tenant-context variant is detected (fail closed). The remainder weakens lock and idle-transaction protections (pool-exhaustion DoS amplifier). Likelihood L × Impact M → **LOW**.

**Remediation.**
1. **Factory (binding on TASK-016 per PR7-SEC-02; cheap here).** Refuse a defined `PGOPTIONS`. Keep `services.ts` free of `process`: pass the environment in, for example `toPoolConfig(options, { env: process.env })`, with `main.ts` supplying it.
   ```ts
   if (env.PGOPTIONS !== undefined) throw new DatabaseConfigError('PGOPTIONS must not be set for the runtime role');
   ```
   Or refuse it in `packages/config` for `api`/`worker` in every environment. The TASK-014 entrypoint preflight keeps its `PG*` refusal for hardened environments.
2. **Guard (optional here, else TASK-016 C13).** On the start-up probe, also compare the effective values: `current_setting('lock_timeout') = '2s'`, `idle_in_transaction_session_timeout = '15s'`, `search_path = 'pg_catalog, public'`, `statement_timeout` = the configured value, and `default_transaction_read_only = 'off'`. Report a mismatch as `db_session_default_tampered`. Key the settings query on `session_user`, and add `OR (s.setrole = 0 AND s.setdatabase = 0)`.

**Verification.** Unit: `PGOPTIONS` set → `DatabaseConfigError` (or exit 78 naming `PGOPTIONS`). Integration (`session-integrity.int.test.ts`): a pool started with `options: '-c lock_timeout=0'` → readiness `database: unavailable` and one event.

### PR9-SEC-04 (LOW): `NODE_TLS_REJECT_UNAUTHORIZED=0` silently disables PostgreSQL and Valkey certificate checks

**Where.** `apps/api/src/platform/valkey/options.ts:96` (`tls` without `rejectUnauthorized`); `pg-connection-string` 2.14.1 (`sslmode=verify-full` → `ssl: {}`, and URL keys override any explicit `ssl` config; probe: an explicit `ssl: { rejectUnauthorized: true }` is replaced by `{}`); `packages/config/src/guards.ts` (no check of the variable); ADR-0018 am. 8 (the TASK-014 preflight list does not name it).

**Description.** Both TLS clients leave `rejectUnauthorized` to Node's default, which is `process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0'`. The config transport guard requires `sslmode=verify-full` and `rediss://` in staging and production (NFR-SEC-007). One stray environment variable still turns both into encrypted-but-unauthenticated connections, and Node only prints a warning.

**Exploitability / impact.** Two preconditions are needed: a misconfigured task environment (a classic "fix" for a certificate error), and an on-path attacker inside the VPC. The result would be credential and data interception for the database and Valkey. Impact H, but the compound precondition gives Likelihood L. The variable is a pure misconfiguration vector and is cheap to refuse → **LOW**.

**Remediation.**
1. `options.ts`: pin it explicitly, in both branches:
   ```ts
   const tls: ValkeyTlsOptions = isIP(host) === 0
     ? { servername: host, minVersion: 'TLSv1.2', rejectUnauthorized: true }
     : { minVersion: 'TLSv1.2', rejectUnauthorized: true };
   ```
   Add `readonly rejectUnauthorized: true` to `ValkeyTlsOptions`.
2. `packages/config` guard: refuse `NODE_TLS_REJECT_UNAUTHORIZED` when it is set to anything but `1`, at least when `APP_ENV ∈ {staging, production}`. Use `{ key: 'NODE_TLS_REJECT_UNAUTHORIZED', code: 'forbidden-in-environment' }`, which exits 78.
3. **TASK-014 preflight.** Add `NODE_EXTRA_CA_CERTS` to the allow-list (RDS CA bundle path only).
4. **pg.** The URL overrides an explicit `ssl` object, so item 2 is the control. If a code-level pin is wanted, `toPoolConfig` must build host, port, user, password and database from the parsed URL and pass `ssl: { rejectUnauthorized: true, … }` without `connectionString`.

**Verification.** `options.test.ts`: `rediss` URLs yield `tls.rejectUnauthorized === true`. `runtime-config.test.ts`: staging with `NODE_TLS_REJECT_UNAUTHORIZED=0` exits 78 naming the key and no value.

### PR9-SEC-05 (LOW): the slow-interval integrity re-check depends on readiness being polled

**Where.** `apps/api/src/platform/db/session-integrity.ts:111-115` (refresh only inside `assertIntact`); `apps/api/src/platform/runtime/services.ts:63-73`; D-TASK006-01 (06); platform.md PD-05 and the ECS task table (container check `healthcheck.js --live`, ALB target health `/health/live`).

**Description.** The sheet (PR7-SEC-06 item 3) asks for the check "at start-up and on a slow interval". The implementation refreshes lazily when `/health/ready` is called. In ECS, readiness is polled only by the deployment step controller (through the test listener, before traffic shifts) and by dashboards; ALB and container health use liveness. After a deployment, the following raises **no** `security.db_role_setting_drift` event until something calls `/health/ready`, possibly at the next deployment:
- `ALTER ROLE platform_app RESET lock_timeout`, or `SET default_transaction_read_only = on`, run through an injection defect;
- a privileged `ALTER DATABASE … SET app.org_id`.

In ECS, "not ready" also has no routing effect, so the event is the only signal.

**Exploitability / impact.** This is a detective-control gap. Detection is delayed or missing for durable tampering that follows a raw-SQL or injection defect (T-35 Hard). Likelihood L × Impact M → **LOW**.

**Remediation.** Run the guard on its own timer, independent of HTTP:
```ts
// services.ts (or a small integrity-monitor.ts)
const timer = setInterval(() => void integrity.assertIntact().catch(() => undefined), SESSION_INTEGRITY_INTERVAL_MS);
timer.unref();
void integrity.assertIntact().catch(() => undefined); // eager start-up probe on a fresh pool
// resources: { name: 'integrity-monitor', close: async () => clearInterval(timer) }
```
`refresh` already emits one event per transition, so readiness keeps its current semantics. Alternatively, TASK-214 adds a synthetic `/health/ready` poll per task. That is weaker, because the ALB spreads polls across tasks.

**Verification.** Unit with fake timers: no readiness call; a drifting row at t + 5 min calls `onDrift` exactly once; shutdown clears the timer, and Jest reports no open handles.

### PR9-SEC-06 (LOW): the API listener keeps Node's default timeouts; body parsing precedes any limiter

**Where.** `apps/api/src/main.ts:18` (`app.listen` with defaults; probe: `headersTimeout=60000`, `requestTimeout=300000`, `keepAliveTimeout=5000`); `apps/api/src/app.ts:46` (global `jsonBodyParser` ahead of every router). Contrast `apps/worker/src/platform/health/server.ts:57-60` (5 s bounds).

**Description.** REQ-SEC-015 caps requests at 30 s, owned by TASK-108 (Wave 3). Until then, a client can take up to 300 s to deliver a request. body-parser buffers up to 1 MB per connection while it waits, and the app container heap is 1,152 MB (platform ECS table). R-13 places a per-IP limiter as pipeline step 0, but the parser is global and runs before any route pipeline. Unauthenticated floods will therefore have up to 1 MB each read and `JSON.parse`d before a limiter can refuse them.

**Exploitability / impact.** It needs many concurrent slow or large uploads through CloudFront and the ALB (neither buffers whole request bodies). The effect is availability only. Likelihood L × Impact M → **LOW**.

**Remediation.**
1. `main.ts` (cheap now; TASK-108 owns the requirement):
   ```ts
   server.headersTimeout = 15_000;
   server.requestTimeout = 30_000;  // receiving the request only; SSE responses are unaffected
   server.keepAliveTimeout = 65_000; // above the ALB idle timeout (60 s) to avoid 502s
   ```
   Make the values config keys if ops wants to tune them.
2. **TASK-020.** Mount body parsing inside the route pipeline after the step-0 limiter (the per-route limits and media types already move there), so a refused request is never read.

**Verification.** A unit test asserts the listener settings. An API test with injected small values: a client that sends headers and trickles the body is cut off at the bound, and the socket closes.

### INFO findings

- **PR9-SEC-07: problem handler is not exception-safe** (`problem-handler.ts:45-82`).
  - Any throw inside the handler falls through to Express's `finalhandler`. With `NODE_ENV ≠ production` that answers `text/html` with the stack. Probe, local env: an `AppError` with a BigInt in `errors[].message` gives 400 HTML `TypeError: Do not know how to serialize a BigInt` plus frames; a Proxy posing as `AppError` with an unknown code gives 500 HTML.
  - The `headersSent` branch passes an `AppError` to `next()`, so Express's `logerror` writes an unstructured stack line to stderr.
  - It needs a code defect, and hardened environments force `NODE_ENV=production` (`guards.ts:173-178`), so the body there is the bare status text.
  - **Fix:** wrap the body in `try/catch`. On failure with headers unsent, send a pre-serialised 500 problem with the correlation ID; with headers sent, call `res.destroy()` instead of `next(err)`. Optionally `app.set('env', 'production')`.
  - **Test:** the BigInt case answers `application/problem+json` 500.
- **PR9-SEC-08: readiness amplification** (`readiness.ts:151-163`, `health-check.ts:21`).
  - Each `/health/ready` request runs `SELECT 1` and `PING` with no coalescing, outside rate limits.
  - When the database is slow, abandoned checks keep pool checkouts queued (`connectionTimeoutMillis` 5 s, `query_timeout` 26 s) and starve business queries.
  - In AWS, CloudFront returns 404 for `/health/*` and the ALB ACL requires `X-Origin-Verify` (platform §4.4), so exposure is internal. Locally the `edge` proxies it.
  - **Fix:** single-flight plus a 1 s result cache inside `createReadinessProbe` (draining still answers at once).
- **PR9-SEC-09: no header baseline yet.**
  - API responses carry no `X-Content-Type-Options`, CSP or `X-Robots-Tag`, and problem documents no `Cache-Control`. The 404 `instance` echoes the request path inside a JSON string.
  - Browsers do not sniff `application/problem+json` into HTML, so this is defence in depth. Helmet is TASK-111 (Wave 3), and Waves 1–2 add the auth routes before it.
  - **Optional interim:** set `X-Content-Type-Options: nosniff`, `Cache-Control: no-store` and `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'` in the context middleware. That is three lines, superseded by TASK-111.
- **PR9-SEC-10: correlation ID seam** (`request-context.ts:13-24`).
  - The pattern is ADR-0016 §15 compliant: length-capped, no log or header injection, duplicates generate a fresh ID.
  - The client value is the only key, though. L-14 / R-22 ask for a server ID with the client value kept as `client_correlation_id`. SEC-P3-17 (TASK-030) needs a server-side value for the shard.
  - **Fix:** add `requestId: randomUUID()` (always server-generated) to `RequestContext` now; TASK-010 logs both, and TASK-030 shards on `requestId`.
- **PR9-SEC-11: pending audit checks read `ok`** (`services.ts:36-44`).
  - Acceptable for Wave 0: no audit data or S3 client exists, and a 503 would block compose.
  - But `audit_chain: ok` must never mean "not verified". The audit components are degradable, so make `pendingCheck` report `degraded` for them (readiness stays 200), and keep `ok` only for `object_storage`.
  - Add a test that fails once `packages/audit` exports a chain verifier, or the S3 adapter exists, while `pendingCheck` is still wired.
- **PR9-SEC-12: worker dependency closure** (`apps/worker/package.json`).
  - `@platform/api` brings Express, Helmet, Stripe, bcrypt (native), swagger-ui-dist and the api `dist/` into the worker's production closure and image.
  - It is not exploitable (the worker serves only `/health/*`), but it is extra attack surface.
  - **TASK-014:** prune the worker image to the modules reachable from `@platform/api/runtime` and `modules/*`, or move the runtime into its own workspace later (D-TASK006-01 alternative).
- **PR9-SEC-13: file provider residuals** (`file-secret-provider.ts:138-142, 92`).
  - `O_NOFOLLOW` guards only the last component. Swapping a parent directory between `realpath` and `open` needs write access inside the root-owned, read-only `/run/secrets` mount.
  - `translateFsError` reads `error.code` through a getter (the errors come from `node:fs`, so they are trusted).
  - Accepted. Node has no `openat2(RESOLVE_BENEATH)`.

## 4. Routed items: closure

| Item | Status | Evidence |
|---|---|---|
| PR3-SEC-05 (binding): start-up composes `resolveSecretRefs` + `checkResolvedSecrets`, exit 78 | **Closed** | `process-env.ts` `loadRuntimeConfigOrExit`; both entry points call it first. Probe: staging `env:` ref to a random `sk_live_…` → 78 `STRIPE_SECRET_KEY_REF: live-key-forbidden`; production `rk_live_` → 78; placeholder behind a ref → 78 (`placeholder` ×2); `file:` outside root → 78 (`ref.filePath`); unknown provider → 78 (`ref.noProvider`); no value in stderr in any case |
| PR3-SEC-06: register holders at start-up | **Closed** | `holders.ts`; probe: full shared env, api in staging → 78 `AUDIT_ANCHOR_SIGNING_KEY: forbidden-for-service: holders.api`; local → named warning only (D-TASK006-02, accepted until TASK-014 splits `compose.env`) |
| PR3-SEC-07 residual: one `open(O_RDONLY\|O_NOFOLLOW)`, `fstat` + bounded read on the same handle, mode check | **Closed** | `file-secret-provider.ts:130-154`; residual note PR9-SEC-13 |
| PR3-SEC-16: throwing getters and Proxy traps in `describeFailureCause` | **Closed** | `secret-refs.ts:165-203` (`isInstance`, own-data `code`, guarded class name); every read on the thrown value is inside a guard |
| PR3-SEC-02/-12 consumer half: ioredis with explicit TLS | **Closed** | `valkey/options.ts`. Probe: `rediss://…` → `tls {servername, minVersion}`; `REDISS://` → TLS; IPv6 literal → no SNI (IP SAN check); `rediss:user:pw@host` → refused; `?tls=` → refused. Hardening in PR9-SEC-04 |
| PR5-SEC-08: query-parameter allow-list in `toPoolConfig` | **Closed** | `client.ts:57-66`. Differential fuzz 20,000 runs / 4,165 accepted / 0 violations; fixed cases `options`, `%6Fptions`, tab and newline in names, repeated `sslmode`, `host=`, `lock_timeout`, `statement_timeout`, `ssl`, `sslcert` all refused; fragment ignored by both parsers |
| PR5-SEC-07 (TASK-006 half): Prisma children drop `NODE_OPTIONS`; no dotenv in `prisma.config.ts` | **Partial** | `prismaChildEnv` and the dotenv test landed, but npm `node-options` reinstates it: **PR9-SEC-02**. The workflow half stays on TASK-007 |
| PR7-SEC-02 item 2: fresh-connection NULL check of the four `app.*` keys | **Closed** | `session-integrity.ts:59, :104`; first refresh requires NULL, later ones accept `''` (D-TASK006-06; a non-empty leak or session default is still detected on any connection, because `SET LOCAL` reverts to the session value). Item 3 (`PGOPTIONS`) stays **open**: PR9-SEC-03 |
| PR7-SEC-03 item 2: never copy `message`/`originalMessage`/`detail`/`hint`/`meta` into a response | **Closed** | `problem.ts`/`problem-handler.ts` build the body from catalogue data plus `AppError.detail`/`errors` only; probe: P2039-like error → generic 500, no table name or e-mail |
| PR7-SEC-03 item 4: `errorFormat: 'minimal'` in every environment | **Closed** | `client.ts:125-130` (the constructor type requires the literal). Item 3 (Pino serializer) stays on TASK-010 |
| PR7-SEC-06 item 3: readiness drift on `pg_db_role_setting` + security event | **Closed (with LOW follow-up)** | Exact-set compare tied to `00-roles.sql` by `session-integrity.test.ts:22-27`; integration test resets `lock_timeout` as `platform_app` → not ready + one event. Cadence gap: **PR9-SEC-05** |

## 5. Focus areas from the dispatch

| Focus | Result |
|---|---|
| Error responses never leak DB/driver messages, stacks, paths | Holds for every handled path (probe). Only a throw **inside** the handler escapes, and only outside `NODE_ENV=production` (PR9-SEC-07) |
| Security headers baseline | Not in scope: TASK-111 (Wave 3) owns Helmet. `X-Powered-By` is off, and health sends `no-store`. Interim suggestion in PR9-SEC-09 |
| Body size, JSON parsing | 1 MB incl. inflated bodies; strict; content type before read. Charset gap PR9-SEC-01 |
| `trust proxy` | Express default `false` (probe). Safe while nothing reads `req.ip`; the rate-limit task sets it from `TRUST_PROXY_HOPS` (T-11, ADR-0016 §8) |
| CORS default deny | Holds: no CORS middleware, no `Access-Control-Allow-*` on any response, preflight answered without ACAO. TASK-048 adds the allow-list |
| Correlation ID handling | Pattern `^[A-Za-z0-9-]{8,64}$`; invalid → UUID; set before any other middleware, so it is echoed on errors too; scalar JSON log. Seam note PR9-SEC-10 |
| Readiness detail | Enum statuses and schema keys only (no versions, hosts or messages); `Cache-Control: no-store`; draining answers 503 without I/O. Stubs PR9-SEC-11, amplification PR9-SEC-08 |
| Session-integrity correctness | Exact set (extra, missing and changed entries all drift), NULL at start-up, `''` later, one event per transition, fail-closed on query error. Gaps PR9-SEC-03/-05 |
| Start-up refusal paths | Exit 78, keys and reason codes only (probe, §4) |
| Secret resolution logging | No locator or value in any issue; providers' messages never read |
| `pg` query-parameter allow-list | Closed (fuzz) |
| ioredis `tls.servername` | Closed (probe) |
| Prisma children drop `NODE_OPTIONS` | Partial (PR9-SEC-02) |
| File provider `O_NOFOLLOW` / same-handle read | Closed |
| Graceful shutdown | Readiness 503 at once, bounded drain (25 s) then `closeAllConnections`, pool `end()` and Valkey `quit()` each bounded (3 s), exit 0/1; second signal does not restart the sequence (it terminates with the default action, which is acceptable) |

## 6. Reviewer-focus questions in the PR

1. **No path copies a thrown value into the body.** Confirmed (classifier reads own data properties only; 5xx detail is constant). The raw value goes to the logger's third argument and is ignored by the interim log. TASK-010 must serialise it with the PR7-SEC-03 item 3 serializer (`{name, code, originalCode, kind}`), never `message`.
2. **`object_storage` pending as `ok`.** Acceptable for Wave 0. Make the audit components `degraded` instead (PR9-SEC-11), and add a guard against stubs outliving TASK-019/TASK-021.
3. **Holders as a warning in local.** Acceptable (D-TASK006-02). Refusal in staging/production is proven. TASK-014 should make local strict once `compose.env` is split.
4. **Exact-set comparison includes database-wide settings.** Accepted. Fail-closed is the right posture for settings that change every runtime connection. Record in the runbook that a DBA database-level `SET` needs the shared constant (and `00-roles.sql`) updated in the same change.
5. **win32 without `O_NOFOLLOW`.** Accepted; the provider runs in Linux containers, and the realpath confinement still applies.
6. **`build` runs the registry generator.** Safe: folder names must match `^[a-z][a-z0-9-]*$` before they reach generated code, and the output path is constant.

## 7. Checks owed by later reviews

- **TASK-007:** `tools/deps` npm invocations carry `--node-options=` (if PR9-SEC-02 is not fixed here); workflow `NODE_OPTIONS` policy (PR5-SEC-07 workflow half).
- **TASK-010:** Pino adapter serialises the third `error()` argument with the PR7-SEC-03 serializer; logs `request_id` and `client_correlation_id` (PR9-SEC-10).
- **TASK-014:** entrypoint preflight refuses `PGOPTIONS`/`PG*`, `NODE_TLS_REJECT_UNAUTHORIZED`, a non-allow-listed `NODE_EXTRA_CA_CERTS`; worker image pruning (PR9-SEC-12); local holders strict after the env split.
- **TASK-016:** factory refuses `PGOPTIONS` (PR7-SEC-02 item 3 / PR9-SEC-03); effective-value assertions; `withTenantTx` per-tx `lock_timeout`/`idle_in_transaction_session_timeout`.
- **TASK-019 / TASK-021:** replace the pending checks; the audit chain check is a real verification.
- **TASK-020 / TASK-108:** body parsing after the step-0 limiter; 30 s request timeout and listener bounds (PR9-SEC-06); charset check if PR9-SEC-01 is not fixed here.
- **TASK-030:** shard on a server-generated ID (SEC-P3-17).
- **TASK-048 / TASK-111:** CORS allow-list and the Helmet baseline (PR9-SEC-09).

## 8. Verdict

**PASS_WITH_FOLLOW-UPS.** 0 Critical, 0 High, 0 Medium, 6 LOW, 7 INFO. The PR may merge under D-ORCH-004 once the code review is satisfied. In a fix cycle on this PR, the recommended order is PR9-SEC-01, PR9-SEC-04 item 1 and PR9-SEC-02 item 1 (one or two lines each), then PR9-SEC-05. The rest is routed as listed.

## Round 2 (head 05855b1)

| Field | Value |
|---|---|
| PR | #9, fix cycle 1 (https://github.com/sukhchdit/shipcube/pull/9#issuecomment-6831965273); D-TASK006-02 |
| Branch / head | `feat/TASK-006-api-worker-runtime-skeleton-express` @ `05855b1`; delta `374166d..05855b1`, 5 commits (`3cf1526` dedicated start-up check + monitor, `1ed09e7` readiness coalescing + degraded stubs, `056cd46` UTF-8-only JSON + 400 for corrupt encodings + uncacheable problems, `6af84ef` TLS pinning, `05855b1` npm `node-options`); 35 files, +1,371 / −135; `main` not merged |
| Scope | `apps/api/src/platform/{http/json-body.ts, errors/problem-handler.ts, db/{client,dedicated-connection,session-integrity}.ts, runtime/{readiness,services}.ts, valkey/options.ts}`, `apps/{api,worker}/src/main.ts`, `packages/config/src/{environment,guards,load-config,schema}.ts`, `tools/deps/{prisma-engines,prisma-cli,rebuild}.mjs` and the tests in the delta |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. No install, build, Docker or suite run. The head's sources were extracted with `git archive 05855b1`, type-stripped with Node 24.22.3 and probed against the worktree's `node_modules` through a scratch junction (removed afterwards). One read-only `git status --porcelain` was run in the TASK-006 worktree by mistake (clean, no output); nothing else ran there |
| **Verdict** | **FAIL.** Head `05855b1`: 1 HIGH open (PR9-SEC-14, a ReDoS that the PR9-SEC-01 fix introduced), plus 1 LOW and 1 INFO new. Merge is blocked under D-ORCH-004 until PR9-SEC-14 is fixed. Every other fix in this cycle holds |

### R2.1 Summary

The fix cycle closes PR9-SEC-01 (as a smuggling control), PR9-SEC-02 items 1–2, PR9-SEC-04 items 1, 2 and 4, PR9-SEC-05, PR9-SEC-07, PR9-SEC-08 and PR9-SEC-11. Independent probes confirm each one (§R2.5).

The new charset check, though, validates the header with a regular expression that backtracks exponentially:
- **The attack.** One unauthenticated request stalls the API process for seconds to days, depending on how many `"; "` pairs the attacker puts in the `Content-Type` header (65 bytes stall it for 5.5 s; 97 bytes for about 4 days).
- **Why nothing stops it.** `req.is` does not stop it: type-is 2.1.0 parses the media type with `parameters: false`. The global body parser runs before any route or limiter.
- **The fix.** A one-line grammar change makes the regex linear without changing the language it accepts (proven below).

### R2.2 Method

- **Diff review.** `git diff 374166d..05855b1` for every file; the fix comment; D-TASK006-02. Sinks re-traced: `Content-Type` → `isUtf8JsonContentType` → body-parser; `DATABASE_URL` → `toPoolConfig` → `pg` → `tls.connect`; `REDIS_URL` → ioredis `tls`; environment → `loadConfig` guards; environment and npmrc → `npm exec` → Prisma bin.
- **Probes.** Scratch `…/scratchpad/review/PR-9-sec-r2/scripts/`. Every probe has a positive control.
  - `probe-charset-r2.mjs`: 27 request cases over a real listener, corrupt and valid gzip, a 20,000-run differential against content-type 2.1.0 (what body-parser's `getCharset` reads), and in-process timing of `isUtf8JsonContentType`.
  - `redos-client.mjs` + `redos-server.mjs`: the app in a child process; one crafted POST, with `/health/live` measured while the POST is in flight.
  - `probe-redos.mjs`: the proposed grammar's timing, and language equivalence against the shipped grammar (50,000 runs).
  - `probe-tls-r2.mjs`: 22 URL cases with `NODE_TLS_REJECT_UNAUTHORIZED=0` and `PGSSLMODE=no-verify` set.
    - The options `pg` hands to the real `tls.connect` for an IP host, a DNS host, and through `dedicatedConnector`. The fake server answers `S`, then breaks the handshake.
    - A 20,000-run differential: the bare URL gives `pg` the same host, port, user, password and database as the original string, no query key, and `ssl` either `false` or `rejectUnauthorized: true`.
    - ioredis `tls` for 4 URLs.
  - `probe-dedicated.mjs`: `dedicatedConnector` and `runStartupIntegrityCheck` against 5 realistic database failures.
  - `probe-integrity.mjs`: guard semantics and the monitor timer.
  - `probe-config-r2.mjs`: `loadRuntimeConfigOrExit` with 9 values of `NODE_TLS_REJECT_UNAUTHORIZED`, in staging, production and local.
  - `probe-npm-r2.mjs`: real npm 11.19.1 run with the head's `prismaExecArgs` + `prismaChildEnv` against 7 `node-options` sources, each with a positive control, plus the `script-shell` residual.
  - `probe-http.mjs` (R1): re-run for regressions.
- **Library facts read** (worktree `node_modules`):
  - type-is 2.1.0 `index.js:237`: `contentType.parse(value, { parameters: false })`.
  - content-type 2.1.0 `dist/index.js` `parse`: the lenient parser, which never throws and keeps the first value of a repeated key.
  - body-parser 2.4.0 `lib/read.js:263`: `getCharset`.
  - pg 8.23.1 `lib/connection.js:96-134`: `upgradeToSSL` sets `host`, merges `ssl`, sets `servername` only for DNS names; `lib/stream.js:26-28`: `require('tls').connect`.
- **Secrets.** Added lines grepped for Stripe, PEM, AWS, GitHub, Slack and credential-URL patterns. One hit, `DUMMY_CA` in `client.test.ts`: its body is base64 for `dummy-test-ca`, not key material. gitleaks was not run (memory constraint).
- **Supply chain.** No dependency or lockfile change in the delta.

### R2.3 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Owner |
|---|---|---|---|---|---|
| PR9-SEC-14 | `MEDIA_TYPE` charset-check regex backtracks exponentially; one unauthenticated request blocks the API event loop | **HIGH** | CWE-1333, CWE-400 | A04 | senior-developer (this PR, merge blocker) |
| PR9-SEC-15 | npm configuration other than `node-options` (`script-shell`, and `npm_execpath` for the CLI itself) still chooses code in the Prisma child chain | LOW | CWE-15, CWE-426 | A08 | TASK-007 or a tools/deps follow-up (R1 PR9-SEC-02 item 3) |
| PR9-SEC-16 | `sslrootcert` is read from any path, relative to the cwd, without a type or size check; libpq's `system` keyword is read as a file name | INFO | CWE-73 | A05 | optional here, or TASK-014 |

#### PR9-SEC-14 (HIGH): the charset-check regex backtracks exponentially

**Where.** `apps/api/src/platform/http/json-body.ts:31` (`MEDIA_TYPE`), called at `:86` for every request that declares a body, from the global `jsonBodyParser` (`app.ts:46`). type-is 2.1.0 `index.js:237` explains why `req.is` does not filter the input first.

**Description.** In `(?:[ \t]*;[ \t]*(?:param)?)*[ \t]*$`, whitespace after a `;` with no parameter can be consumed by that iteration's trailing `[ \t]*` or by the next iteration's leading `[ \t]*`. With k empty `"; "` separators followed by a character that fails the match, V8's backtracking engine tries 2^k splits before it gives up.

`req.is([...JSON_MEDIA_TYPES])` runs first, but it does not filter this input: type-is 2.1.0 parses the type with `parameters: false`, so `application/json; ; ; … !` reads as `application/json`. Measured:

| Input | Result |
|---|---|
| In-process, `"; "` × n + `!`, n = 16 / 18 / 20 / 22 / 24 | 1.8 / 13.2 / 30.1 / 112 / 453 ms (×4 per +2); `req.is` = `application/json` in every case |
| Listener in a child process, n = 20 (57-byte header), POST to a non-existent path, no credentials | 415 after 368 ms; `/health/live` sent meanwhile answered after 169 ms |
| Same, n = 24 (65 bytes) | 415 after 5,497 ms; `/health/live` answered after 5,275 ms (the event loop was blocked) |
| Same process, n = 26 (69 bytes), first request (regexp not yet tiered up) | 23,170 ms |
| Extrapolated (×4 per +2) | n = 30 ≈ 6 min; n = 34 ≈ 1.5 h; n = 40 (97 bytes) ≈ 4 days |
| Control: 2,000 well-formed `; a=b` parameters (10 KB) | 0.3 ms |

**Exploitability / impact.**
- **Reach.** Any method and any path work, with a 1-byte body and no credentials. The parser is global and runs before any route, authentication or limiter (PR9-SEC-06). CloudFront and the ALB pass a 100-byte `Content-Type`, and the managed WAF groups have no rule for it.
- **Effect.** Each request pins one task's only thread. Liveness then fails, and ECS replaces the task. A handful of requests per minute keeps every API task down.
- **Ease.** Crafting the request is trivial, and the pattern is a textbook ReDoS that public scanners find.
- **Rating.** Impact H (API-wide availability; no confidentiality or integrity effect) × Likelihood H → **HIGH** (threat-model §1 matrix). The PR9-SEC-01 fix introduced it; R1's suggested `content-type` call had no regex.

**Remediation.** Make the whitespace after `;` part of the optional parameter, so every split is unique (linear), and cap the header length before any pattern runs (belt):
```ts
// json-body.ts
const MEDIA_TYPE = new RegExp(`^[ \\t]*${TOKEN}/${TOKEN}(?:[ \\t]*;(?:[ \\t]*${TOKEN}=(?:${TOKEN}|${QUOTED}))?)*[ \\t]*$`, 'u');
/** Media types are short; a longer header is refused before any pattern runs (PR9-SEC-14). */
export const MAX_CONTENT_TYPE_LENGTH = 256;

export function isUtf8JsonContentType(header: string | undefined): boolean {
  if (header === undefined || header.length > MAX_CONTENT_TYPE_LENGTH || !MEDIA_TYPE.test(header)) return false;
  // … unchanged
}
```
Proof for the grammar (`probe-redos.mjs`):
- **Linear.** n = 8,000 empty separators takes 0.42 ms; 4,000 mixed `; \t;` groups take 0.26 ms.
- **Same language.** Over 50,000 fast-check runs of short headers (8,617 accepted), the shipped grammar and the fixed one gave 0 differing results.

The cap alone is not enough: about 40 separators fit in 256 characters. A hand-written linear scanner (in the style of content-type's) is an equally good alternative. `PARAMETER` (`:32`) runs only on headers that `MEDIA_TYPE` accepted, and stays linear on them.

**Verification.**
- Unit (`json-body.test.ts`): `isUtf8JsonContentType('application/json' + '; '.repeat(5_000) + '!')` and `'application/json' + ' ;\t'.repeat(5_000)` return `false` within 50 ms each. A fast-check property over strings built from `; \t=a"\\/` up to 300 characters stays under the same budget.
- API (`problem-handler.api.test.ts`): POST with `Content-Type: application/json` + `'; '.repeat(40)` + `!` and a 1-byte body answers 415 within 1 s, and `/health/live` answers immediately afterwards.
- Keep the existing 415/201 matrix, and the 27 cases of `probe-charset-r2.mjs`.

#### PR9-SEC-15 (LOW): other npm settings still choose code in the Prisma child chain

**Where.**
- `tools/deps/prisma-cli.mjs:46` and `tools/deps/rebuild.mjs:162` both run `node <npm-cli> exec --node-options= --no -- prisma …`.
- `tools/deps/npm-cli.mjs:15`: `npm_execpath` from the environment picks the npm CLI whenever it ends in `npm-cli.js` and exists. This predates the delta.

**Description.** `--node-options=` closes the `node-options` vector (§R2.5). But `npm exec` still runs the bin through npm's `script-shell`, and that setting comes from the same layers: environment, and project, user or global npmrc. Probe with the head's `prismaExecArgs` and `prismaChildEnv`:

| Source | What ran the bin |
|---|---|
| none (control) | `cmd` shim (`via: cmd`) |
| project `.npmrc` `script-shell=<bash.exe>` | `via: sh` |
| env `npm_config_script_shell=<bash.exe>` | `via: sh` |
| project `.npmrc` `script-shell=<planted path>` | npm spawned the planted path (ENOENT here) |

On Linux (images and CI), `script-shell` can name any executable. It runs with the child environment and can start `prisma` with `PRISMA_MIGRATION_ENGINE_BINARY` set, which is the PR5-SEC-07 attack again. `npm_execpath` likewise lets the environment substitute the "npm" that `prisma-cli.mjs` starts.

**Exploitability / impact.** The precondition is the same as for PR9-SEC-02: control of the environment, or write access to an npmrc on the machine that runs `db:*`, `deps:rebuild` or the migrate entrypoint. The developer flagged this residual, and D-TASK006-02 routes it. Impact H × Likelihood L with a compound precondition → **LOW**.

**Remediation** (R1 PR9-SEC-02 item 3). Take npm out of the chain:
```js
// prisma-cli.mjs and rebuild.mjs (shared helper in prisma-engines.mjs)
import { createRequire } from 'node:module';
const req = createRequire(join(REPO_ROOT, 'prisma', 'package.json'));
const pkgPath = req.resolve('prisma/package.json');
const { bin } = JSON.parse(readFileSync(pkgPath, 'utf8'));
const entry = join(dirname(pkgPath), typeof bin === 'string' ? bin : bin.prisma);
spawnSync(process.execPath, [entry, ...args], { cwd, env: prismaChildEnv(env, engine.path), stdio: 'inherit' });
```
In `npmCli()`, stop trusting `npm_execpath` (use only the Node-install-relative candidates), or require it to resolve inside `dirname(process.execPath)`.

**Verification.**
- Unit: the Prisma argv no longer contains `npm-cli.js`.
- Integration: a scratch project `.npmrc` with `script-shell=<marker script>` and `node-options=--require <probe>` leaves no marker after `runPrisma(['--version'])`. The positive control is the same `.npmrc` under plain `npm exec`, which writes the marker.

#### PR9-SEC-16 (INFO): `sslrootcert` handling

**Where.** `apps/api/src/platform/db/client.ts:90-97` (`readRootCertificate`).

**Description.**
- **What the probe confirmed.** A missing file gives `connectionString sslrootcert could not be read`, with neither the path nor the fs error echoed. An empty value and `system` are refused, so they fail closed. A readable file goes into `ca`, which replaces Node's default trust store; that is the intended pinning.
- **What is not checked.**
  - The path is any string from the URL. A relative path resolves against the process cwd.
  - libpq's `sslrootcert=system` keyword is read as a file named `system`.
  - There is no `isFile` or size check, so a FIFO or `/dev/zero` would hang the process or exhaust its memory at start-up.

The URL is operator-trusted configuration (a secret reference), and the file is read once at start-up, so this is a hardening note.

**Fix (optional, or the TASK-014 preflight).**
- Require an absolute path under an allow-listed CA directory.
- Check that `statSync(path).isFile()` is true and the size is at most 1 MB before reading.
- Refuse `system` explicitly, with a message that names the keyword.

### R2.4 Focus areas from the dispatch

| Focus | Result |
|---|---|
| Charset check: parameter parsing, quoted charset, case, multiple charset params | **Logic correct; implementation HIGH (PR9-SEC-14).** All 27 cases pass over a real listener: UTF-7 smuggle, `CHARSET=UTF-7`, quoted and escaped `utf-7`, UTF-16LE/UTF-32, duplicates in either order, spaces around `=`, a tab separator, a parameter without a value, an unterminated quote, garbage after a quote and a comma list all give 415, and the handler never runs. `UTF-8`, quoted and escaped `utf-8`, `+json`, and a `charset=utf-7` text inside another parameter's quoted value give 201. Differential against content-type 2.1.0 (body-parser's view): 20,000 runs, 5,176 accepted, **0** where body-parser would decode a non-UTF-8 charset |
| Corrupt encodings | Corrupt gzip → 400 `MALFORMED_REQUEST`, `no-store`; valid gzip → 201 |
| TLS: verify-full for every TLS mode | Holds. With `NODE_TLS_REJECT_UNAUTHORIZED=0` and `PGSSLMODE=no-verify` set, `allow`, `prefer`, `require`, `verify-ca`, `verify-full`, `sslnegotiation=direct` and `sslrootcert`-only URLs all give `ssl: { rejectUnauthorized: true }`. The real `tls.connect` receives `rejectUnauthorized: true` for an IP host (no SNI; `host` is set, so the IP SAN is checked), for a DNS host (`servername` set), and through `dedicatedConnector`. No `checkServerIdentity` override |
| `no-verify` refusal; URL cannot override | `no-verify` and `%73slmode=no-verify` are refused. `VERIFY-FULL` is refused as an unsupported value. `ssl=0`, `sslcert`, `options` and repeated `sslmode` are refused by the allow-list. `pg` receives the URL without its query (`cs-has-query=false` in every accepted case). Fuzz: 20,000 runs, 6,753 accepted, 0 violations (same target as the original string, no query keys, `ssl` false or pinned, `options` unset) |
| `PGSSLMODE` / `NODE_TLS_REJECT_UNAUTHORIZED` | `PGSSLMODE` is never read, because `ssl` is always explicit (`false` without `sslmode`). The guard refuses every configured value except `1` in staging and production (exit 78: `0`, `false`, `no`, ` 1`, `1 `, `01` and a marker string), naming the key only, with no value leak in any case. Unset, empty and `1` pass; local allows any value. Valkey: `tls.rejectUnauthorized: true` for DNS, IPv4 and IPv6 hosts; `redis://` has no `tls` |
| `sslrootcert` path confinement | Not confined; value-free errors (PR9-SEC-16, INFO) |
| npm `--node-options=` and `NPM_CONFIG_NODE_OPTIONS` drop | **Closed.** Seven sources, each with a positive control that preloads: `npm_config_node_options`, `NPM_CONFIG_NODE_OPTIONS`, `Npm_Config_Node_Options`, project `.npmrc`, user npmrc via `npm_config_userconfig` and via `NPM_CONFIG_USERCONFIG`, and global npmrc via `npm_config_globalconfig`. With the head's argv and env filter, the bin sees `NODE_OPTIONS=""` and no preload. Every Prisma spawn at the head goes through `prismaExecArgs`: `prisma-cli.mjs`, `rebuild.mjs`, and `tools/db/{reset,lint-migrations}.ts` through `prisma-cli.mjs` |
| Residual `.npmrc` `script-shell` class | Confirmed and rated **LOW** (PR9-SEC-15); route to TASK-007 or a tools/deps follow-up |
| Dedicated start-up check vs tampering between boot and first pooled use | **No bypass of the start-up check:**<br>• A process-level session default (`PGOPTIONS`-style) is fixed at boot and seen on the dedicated connection.<br>• Durable role or database rows are compared exactly on any connection.<br>• A non-empty tenant context is caught on any probed connection.<br>• `''` on the dedicated connection is tampering.<br><br>Probe: a failure is never cached; the next check uses a new dedicated connection again; after a pass, pooled `''` is accepted; one event per transition. The monitor caught drift injected after recovery with no readiness call and stopped after `close()`. A database that is down at start-up fails closed and is retried.<br><br>Residual (already in PR9-SEC-03 item 2, TASK-016): an `ALTER ROLE platform_app SET … ; … RESET` between two checks (≤ 5 min) leaves pooled connections opened in that window with the tampered defaults. They are invisible to the catalog compare, and the context check sees them only if one happens to be probed. Effective-value assertions on every new physical connection close it |
| Start-up liveness of the dedicated check | `dedicatedConnector` and `runStartupIntegrityCheck` settle for every realistic failure: no TLS (`N`), broken handshake, close after `S`, silent server (2,010 ms, the connect timeout), auth error. `startup()` resolves and logs `db.session_integrity_failed` with the error class only |
| Degraded audit stubs not leaking information | Holds. `pendingCheck` rejects with `"<component> check pending"`, but `passes()` never reads rejection messages. The body holds enum statuses only, with `no-store`. The 1 s cached report is not mutated by the router. Draining bypasses the cache |

### R2.5 Round-1 items: closure

| Item | Status | Evidence |
|---|---|---|
| PR9-SEC-01 | **Closed as a smuggling control**; implementation regression **PR9-SEC-14** | §R2.4 rows 1–2 |
| PR9-SEC-02 items 1–2 | **Closed** | 7 sources × positive control (§R2.4) |
| PR9-SEC-02 item 3 | Open → **PR9-SEC-15** | |
| PR9-SEC-03 | Open, routed unchanged (TASK-016 factory and effective values; TASK-014 preflight) | Transient set/reset note in §R2.4 |
| PR9-SEC-04 items 1, 2, 4 | **Closed** | §R2.4 TLS rows; config probe |
| PR9-SEC-04 item 3 (`NODE_EXTRA_CA_CERTS` allow-list) | Open → TASK-014 | |
| PR9-SEC-05 | **Closed** | `session-integrity.ts:189` unref'd timer; probe |
| PR9-SEC-06 | Open, routed (TASK-108, TASK-020). Note: parsing after the step-0 limiter would also bound any future parser-cost defect of the PR9-SEC-14 kind | |
| PR9-SEC-07 | **Closed** | Re-run of `probe-http.mjs`: the BigInt `errors` entry and the Proxy posing as `AppError` both give 500 `application/problem+json`, `no-store`, no HTML, no stack, no leak. Cosmetic: the fallback title is `Internal server error`, while the catalogue's is `Internal error` (code review). The headers-sent path is unchanged (stderr line `AppError: INTERNAL_ERROR`, code only) |
| PR9-SEC-08 | **Closed** | Single-flight plus a 1 s report cache (`readiness.ts:61`); draining is uncached |
| PR9-SEC-09 | **Partial**: problem documents now carry `Cache-Control: no-store` and drop `ETag`/`Last-Modified`/`Content-Disposition`/`Content-Language`. `nosniff`/CSP stay with TASK-111 | |
| PR9-SEC-10, -12, -13 | Unchanged, routed as in R1 §7 | |
| PR9-SEC-11 | **Closed** | `readiness.ts:205`; audit components read `degraded` (HTTP 200); tripwire tests in `services.test.ts` |

### R2.6 Checks owed by later reviews (additions to R1 §7)

- **This PR, round 3 (targeted).**
  - PR9-SEC-14: the linear grammar and the length cap.
  - The unit timing test and the API test listed under its Verification.
  - Re-run `probe-charset-r2.mjs` and `redos-client.mjs` (n = 40 must answer 415 at once).
- **TASK-007 / tools/deps follow-up.** PR9-SEC-15: spawn the Prisma bin with `process.execPath` and no npm, and stop trusting `npm_execpath`.
- **TASK-014.**
  - `NODE_EXTRA_CA_CERTS` allow-list (PR9-SEC-04 item 3).
  - Optionally, `sslrootcert` confinement (PR9-SEC-16).
  - Everything else listed in R1 §7.
- **TASK-016.** Effective-value assertions on every new physical connection (PR9-SEC-03 item 2), which also covers the transient set/reset window.
- **TASK-020 / TASK-108.** Body parsing after the step-0 limiter. For every parser of request headers or bodies: a linear grammar, a length cap, and a timing test.

### R2.7 Verdict

**FAIL** at head `05855b1`: 0 Critical, **1 HIGH (PR9-SEC-14)**, 0 Medium, 1 LOW new (PR9-SEC-15), 1 INFO new (PR9-SEC-16). Of the R1 items, 01, 02 (items 1–2), 04 (items 1, 2, 4), 05, 07, 08 and 11 are closed; the rest stay routed as listed.

Once PR9-SEC-14 is fixed and verified, the expected verdict is PASS_WITH_FOLLOW-UPS. No other change is needed for this PR.

## Round 3 (head 6331aeb)

| Field | Value |
|---|---|
| PR | #9, fix cycle 2 (https://github.com/sukhchdit/shipcube/pull/9#issuecomment-6833101331) |
| Head | 6331aeb23940d6fd759c24e238eea9690ef3d11e |
| Branch | `feat/TASK-006-api-worker-runtime-skeleton-express`; `main` is not merged at this head |
| Delta | From the round-2 head: 1 commit (`fix(api): linear content-type grammar with a length cap`), 13 files, +373 / −96. No dependency, lockfile or security-owned path changes |
| Scope | `apps/api/src/platform/http/json-body.ts`, `apps/api/src/platform/db/client.ts`, `apps/api/src/platform/errors/problem-handler.ts`, `apps/api/src/platform/runtime/readiness.ts`, `packages/config/src/{guards,index}.ts`, and the tests in the delta |
| Reviewer / date | security-analyst, 2026-11-13. Read-only, reviewed by SHA. No command was run in the TASK-006 worktree, where a merge-main pass was running. No install, build, Docker or suite run. The head's sources (and the round-2 head's, for the controls) were extracted with `git archive`, type-stripped with Node 24.22.3, and probed against the worktree's `node_modules` through a scratch junction, removed afterwards. The merge simulation ran in a scratch `git clone --shared`; nothing was written to the main repository |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** PR9-SEC-14 (HIGH) is closed and PR9-SEC-16 (INFO) is closed. 1 new INFO (PR9-SEC-17). 0 Critical, 0 High and 0 Medium are open, so the merge rule (D-ORCH-004) is met. This record binds to the head above; a head that merges `main` needs a merge-only addendum (§R3.6) |

### R3.1 Summary

- **PR9-SEC-14 is closed.** Three changes close it:
  - **Grammar.** `MEDIA_TYPE` is now exactly the round-2 remediation, and it is linear.
  - **Length cap.** A header longer than 256 characters is refused before any pattern runs.
  - **Order.** The bounded check runs before `req.is`.

  With the app in a child process, a crafted `Content-Type` of n = 24, 40 or 5,000 empty parameters gets 415 in 7–9 ms, and `/health/live` answers in 6–7 ms during the attack. The same probe against the round-2 head blocks the event loop for about 1 s at n = 22.
- **R2-m2 holds.** `DATABASE_URL` has a single allow-list, and configuration and the runtime pool factory agree on it in every APP_ENV.
- **PR9-SEC-16 hardening is in place.** One residual is new: **PR9-SEC-17 (INFO)**. The 1 MiB bound is checked on `stat`, not on the read.
- **Record check.** This record parses and satisfies lane A at this head. It will **not** satisfy lane A at a head that merges `main`: three security-owned paths changed on both sides (§R3.6).
- **Lane A tool.** Validating the record turned up a LOW in the tool itself, which is already on `main`: **PR10-SEC-21**. Commits named in earlier rounds stay bindable under the latest verdict. It is routed to TASK-015.

### R3.2 Method

- **Diff review.** I read the full `git diff 05855b1..6331aeb` and the fix comment, then re-traced three sinks:
  - `Content-Type` → `isUtf8JsonContentType` → `req.is` → body-parser;
  - `DATABASE_URL` → `loadConfig` guards and `toPoolConfig` → `pg`;
  - `sslrootcert` → `fs` → `tls`.
- **Probes.** Scratch `…/scratchpad/review/PR-9-sec-r3/scripts/`. Every probe has a positive control.
  - `redos-client.mjs` (R2): the app runs in a child process. It was run at n = 24, 40 and 5,000, with a control against the round-2 head at n = 22.
  - `probe-redos-r3.mjs` (new): the shipped `isWellFormedMediaType`, uncapped.
    - 16 adversarial input families at 5,000 and 20,000 repetitions (up to about 100 kB).
    - 2,000 random runs up to 16 kB, and 3,000 structured runs.
    - 100,000 runs checking that it accepts the same strings as the round-2 grammar and the R2 remediation.
    - The cap boundary.
    - Control: the round-2 grammar takes 195 ms at n = 20.
  - Re-run from R2: `probe-charset-r2.mjs`, `probe-redos.mjs` and `probe-tls-r2.mjs`. Re-run from R1: `probe-http.mjs`.
  - `probe-sslroot-r3.mjs` and `probe-sslroot-stat0-r3.mjs` (new): `sslrootcert` refusals, and whether the read is bounded.
  - `probe-config-r3.mjs` (new): 20 fixed URLs, plus a 6,000-run differential between `loadConfig` (local, test, staging, production) and `toPoolConfig`.
  - Merge simulation and record check: a scratch shared clone, `git merge-tree`, and main's `tools/ci/check-security-owned-paths.mjs` (`recordVerdict`, `recordHeadShas`, `checkSecurityOwnedPaths`).
- **Secrets.** The added lines were grepped for Stripe, PEM private-key, AWS, GitHub, Slack and credential-URL patterns. There were 3 hits, all test URLs whose password is generated at run time (`randomSecret()` or random hex). No literal secret.
- **Supply chain.** No dependency or lockfile change.

### R3.3 PR9-SEC-14: closure evidence

| Check | Result |
|---|---|
| Grammar | `json-body.ts:39` behaves exactly like the R2 remediation: 0 differences in 100,000 runs, and every adversarial family gives the same result |
| Linear time | Uncapped, the worst input family takes 1.35 ms at about 100 kB. Going from 5,000 to 20,000 repetitions raises the time 2–6×, which is linear growth near a sub-millisecond noise floor. Random runs: max 0.10 ms. Structured runs: max 0.02 ms |
| Same language | 100,000 runs, 10,102 accepted, **0** differences from the round-2 grammar. `probe-redos.mjs`: 50,000 runs, 8,617 accepted, 0 differences |
| Length cap | `json-body.ts:43`, applied at `:56`. A 256-character header is accepted and a 257-character one refused. The worst case within the cap (119 empty parameters, 255 characters) takes 0.016 ms. The capped check takes at most 0.13 ms for any input family |
| Order | `json-body.ts:103`: the bounded check runs before `req.is`. type-is, content-type and body-parser therefore only see headers of at most 256 characters that match the grammar |
| Over HTTP (child process) | Each request was a POST to an unknown path with no credentials. At the head, n = 24 (65 B), 40 (97 B) and 5,000 (10 kB) each get 415 in 7 / 9 / 7 ms, and liveness answers in 7 / 7 / 6 ms during the attack. Control at the round-2 head, n = 22 (61 B): 415 after 1,215 ms, with liveness blocked for 1,014 ms |
| Charset control (no regression) | 27 of 27 cases correct over a real listener, with the handler never run on a 415. The differential against content-type 2.1.0 ran 20,000 times, accepted 5,176 headers and found **0** smuggles. A corrupt gzip body gets 400 with `no-store`; a valid one gets 201 |
| Tests | `json-body.test.ts` and the new `problem-handler.api.test.ts` block implement the R2 verification list. They go further: the timing property covers inputs up to 2,000 characters, and a differential compares against the round-2 grammar |

### R3.4 Other fix-cycle items

| Item | Result |
|---|---|
| R2-m2: one `DATABASE_URL` allow-list | **Holds.**<br>• **Where it lives.** `guards.ts:62` is the only list, and `client.ts` imports it. `databaseUrlParamsGuard` (`guards.ts:75`) is in `GUARDS` (`:289`) and runs in every APP_ENV. Outside local/test, the transport guard (`:89`) requires exactly one `sslmode`, with the value `verify-full`.<br>• **Fixed cases.** Configuration and the runtime both refuse `application_name`, `connect_timeout`, `uselibpqcompat`, `%6Fptions`, `ssl+mode`, `=x`, `SSLMODE`, `ssl=0` and a repeated `sslmode`. Both accept `?&&` and `#?options=x`, because pg never sees the fragment.<br>• **Differential.** 6,000 runs, 1,099 accepted by configuration:<br>  – **0** runs where one side refuses a parameter name and the other accepts it;<br>  – **0** accepted URLs in staging or production that lack `rejectUnauthorized: true`;<br>  – **0** passwords in the rendered error.<br>  In 495 runs both sides refuse, under different rules: the schema's `string.uriCustomScheme` refuses a literal space in a name, and the runtime refuses the name. Errors name the key only |
| TLS (regression) | `probe-tls-r2.mjs`, 22 cases, run with `NODE_TLS_REJECT_UNAUTHORIZED=0` and `PGSSLMODE=no-verify`:<br>• `uselibpqcompat` is now refused by the allow-list.<br>• Every TLS mode gives `rejectUnauthorized: true`.<br>• The real `tls.connect` receives `rejectUnauthorized: true` for an IP host, for a DNS host (with `servername`), and through `dedicatedConnector`.<br>• Fuzz: 20,000 runs, 5,929 accepted, 0 violations.<br>• ioredis is unchanged |
| PR9-SEC-16 | **Closed** (`client.ts:97-110`).<br>• **Refused:** `system`, a relative path, `./x`, an empty value, a `file:` URL, a directory, and a file of 1 MiB + 1 byte.<br>• **Accepted:** a file of exactly 1 MiB.<br>• A missing file gives `could not be read`.<br>• No message carries the path, and no error carries a `cause`.<br>• Not done: confinement to a CA directory (optional in R2).<br>Residual: PR9-SEC-17 |
| R2-n1 | `probe-http.mjs`: the BigInt `errors` entry and the Proxy posing as an `AppError` both give 500 `application/problem+json` with `no-store`, and no HTML, stack or leak. Every 500 path now has the title `Internal error` and the configured `type` base. No other change in the R1 cases |
| R2-m1 | The `WeakSet` brand serves the tests only, and no request path reads it. The readiness output is unchanged: enum statuses and `no-store` |

### R3.5 New finding

| ID | Title | Severity | CWE | OWASP 2021 | Owner |
|---|---|---|---|---|---|
| PR9-SEC-17 | The `sslrootcert` size bound is checked on `stat`, not on the read | INFO | CWE-367, CWE-770 | A05 | Optional here; otherwise TASK-014 (preflight), with the PR9-SEC-16 directory confinement |
| PR10-SEC-21 | Lane A record check: commits named in earlier review rounds stay bindable under the latest verdict | LOW | CWE-693 | A08 | TASK-015 (owner of `tools/ci`); found while validating this record (§R3.6); not a defect of this PR |

#### PR9-SEC-17 (INFO): the CA-bundle size bound is checked on `stat`, not on the read

**Where.** `apps/api/src/platform/db/client.ts:101-105` (`readRootCertificate`).

**Description.** `statSync(path)` checks `isFile()` and a size of at most 1 MiB, and then `readFileSync(path, 'utf8')` opens the path again. On Node 24, `readFileSync` with `'utf8'` goes to the native `readFileUtf8`, which reads until EOF and never consults the size (as printed by `String(fs.readFileSync)` on 24.22.3). The bound and the type check therefore hold only for the `stat`. Two cases slip past them:
- **Pseudo-files.** On Linux, procfs and sysfs files report size 0 but have content behind them; `/proc/self/pagemap` is effectively unbounded.
- **Swapped paths.** A path replaced between the `stat` and the `open`, for example by a FIFO, blocks start-up.

Probe: with `statSync` reporting size 0 for a 2 MiB file (the procfs case, synced into the ESM bindings), the file is accepted and `ca` holds 2,097,152 characters. The control, without the patch, is refused.

**Exploitability / impact.** The precondition is control of `DATABASE_URL`, an operator-held secret reference, or of the file it names. The effect is a failed or hung start-up only; nothing is disclosed, because the content goes into `ca` and no message echoes it. Rated **INFO**, hardening.

**Remediation.** Open once, check the open descriptor, and bound the bytes actually read:
```ts
import { closeSync, constants, fstatSync, openSync, readSync } from 'node:fs';

function readRootCertificate(path: string): string {
  if (path === 'system') throw new DatabaseConfigError('connectionString sslrootcert must name a CA bundle file');
  if (!isAbsolute(path)) throw new DatabaseConfigError('connectionString sslrootcert must be an absolute path');
  let fd: number | undefined;
  try {
    // O_NONBLOCK: opening a FIFO must not wait for a writer (it is then refused as not a regular file).
    fd = openSync(path, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
    if (!fstatSync(fd).isFile()) throw new DatabaseConfigError('connectionString sslrootcert must be a regular file of at most 1 MiB');
    const buffer = Buffer.alloc(MAX_ROOT_CERTIFICATE_BYTES + 1);
    let length = 0;
    while (length < buffer.length) {
      const read = readSync(fd, buffer, length, buffer.length - length, null);
      if (read === 0) break;
      length += read;
    }
    if (length > MAX_ROOT_CERTIFICATE_BYTES) throw new DatabaseConfigError('connectionString sslrootcert must be a regular file of at most 1 MiB');
    return buffer.toString('utf8', 0, length);
  } catch (error) {
    if (error instanceof DatabaseConfigError) throw error;
    throw new DatabaseConfigError('connectionString sslrootcert could not be read');
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}
```
Optionally, also require the text to contain `-----BEGIN CERTIFICATE-----`, so that a wrong but readable file fails at configuration time rather than at the first TLS handshake.

**Verification.**
- **Unit.** Stub `fstatSync` to report size 0 for a 2 MiB file: it is still refused. The existing rows stay green (system, relative path, directory, 1 MiB + 1, missing file, a readable file read into `ca`).
- **Linux, in the TASK-014 preflight suite.** `sslrootcert=/proc/self/pagemap` is refused within 1 s with flat memory, and a FIFO path is refused without blocking.

### R3.6 Record check and the merge of `main`

**Parser.** Running main's `recordVerdict` on this file gives `PASS_WITH_FOLLOW-UPS` from the last Verdict row; the control, main's round-2 file, gives `FAIL`. `recordHeadShas` gives 13 tokens: the R1 and R2 head-row SHAs, including the commit lists and merge base `7712c7c`, then `6331aeb23940d6fd759c24e238eea9690ef3d11e`.

**Overlap.** The merge base is `7712c7c`. Three paths changed on both `main` (`8e62763`, PR #10) and this PR, and all three are security-owned:
- `package.json`, which conflicts;
- `eslint.config.mjs`, which merges automatically;
- `tools/lint/negative-fixtures.test.ts`, which merges automatically.

After the merge they differ both from `6331aeb` and from `main`. Lane A's clause (d) (`changedSince(<named commit>)` ∩ the PR's owned net change) is therefore non-empty for `6331aeb`, so this record **cannot** satisfy the check at a head that merges `main`.

**Simulation.** Main's `checkSecurityOwnedPaths` ran from main's copy of the script against a scratch clone, with `--pr 9` and base = `main` @ `66cb34b`:

| Scenario | Result |
|---|---|
| `6331aeb` + this record (docs-only commit) | `pass`. The tool reports the first qualifying SHA in the file's head rows. That is `05855b1`, because `05855b1..6331aeb` touched no owned path. With the Round 3 section alone, the result is `pass`, satisfied by `6331aeb` |
| `6331aeb` + merge of `main` + this record. `package.json` was resolved by inserting the PR's `gen:modules` line after `authz:generate` in main's version (resulting blob `6595a2d`) | `missing`. Every named SHA fails, including "names 6331aeb, but eslint.config.mjs, package.json, tools/lint/negative-fixtures.test.ts changed after it" |
| Same merge + this record + a merge-only addendum whose head row names the merge commit | `pass`, satisfied by the merge commit |
| Control: the merge commit itself, which carries main's round-2 record (last Verdict FAIL) | `missing` ("verdict FAIL is not one of …") |
| Control: same merge + this record, `--pr 10` | `missing`. Only `PR-0010-*` records count, and that record names no commit of the range |

**Observation on the tool: PR10-SEC-21 (LOW, routed to TASK-015).**
- **The gap.** `recordHeadShas` takes SHAs from every head row in the file, but `recordVerdict` takes the last Verdict only. The commits named in earlier rounds therefore stay bindable under the latest verdict, including the FAIL head `05855b1` (scenario 1 above).
- **No effect on this PR.** Here it is harmless, because the round-2 FAIL concerned `json-body.ts`, which is not an owned path.
- **The general case.** Suppose round N fails head Y over an owned path, and round N+1 passes head X after a fix. A later commit that restores the owned paths to Y's content then passes clause (d) through Y. That post-review change to an owned path is exactly what the check exists to catch.
- **The fix.** Take head SHAs only from the table that holds the last Verdict row (or from the last `## Round` section).
- **The test.** A record whose round 1 (FAIL) names Y and whose round 2 (PASS) names X, with head = X + a revert of the owned paths to Y, must give `missing`.

**What the orchestrator needs.** Once the merge-main commit exists, it needs a short merge-only Round 3b by security-analyst. Round 3b names the merge commit in a `| Head |` row and adds a new last Verdict row. Per D-ORCH-013 the orchestrator commits records but does not author them, so it should not add the SHA itself. The merge commit `6742bec` appeared during this review, so Round 3b below already covers it; a further merge of `main` needs the same check again. The check is mechanical:
- `eslint.config.mjs` and `tools/lint/negative-fixtures.test.ts` must equal the automatic merge (`git merge-tree --write-tree 6331aeb 66cb34b` gives blobs `ce379e2a` and `7a83afe1`; against a later `main`, recompute them).
- `package.json` must be main's version plus the PR's `"gen:modules"` script line, and nothing else (blob `6595a2d` when the line follows `authz:generate` with LF endings).
- `6331aeb..<merge>` must bring in no other PR-side change.

Both sides of all three files were already reviewed (here in R1, and in the PR #10 reviews). The automatic merges combine hunks that do not overlap, and the expected `package.json` keeps both script lines. None of the three raises a security concern.

### R3.7 Status of all items

| Item | Status |
|---|---|
| PR9-SEC-14 (HIGH) | **Closed** (§R3.3) |
| PR9-SEC-16 (INFO) | **Closed**; residual is PR9-SEC-17 |
| PR9-SEC-17 (INFO) | **New**; optional here, otherwise TASK-014 |
| PR10-SEC-21 (LOW, `tools/ci`) | **New**; routed to TASK-015. To be carried into the PR-0010 record's routing |
| PR9-SEC-15 (LOW) | Open. TASK-007 merged without it: `tools/deps/npm-cli.mjs:15` still trusts `npm_execpath` on `main` and at this head. It needs a task ID (a tools/deps follow-up or TASK-014) |
| PR9-SEC-03, -04 item 3, -06, -10, -12, -13 | Unchanged; routed as in R1 §7 and §R2.6 |
| PR9-SEC-09 | Partial, unchanged (`nosniff`/CSP with TASK-111) |
| Closed earlier | 01, 02 items 1–2, 04 items 1/2/4, 05, 07, 08 and 11 (R2) |

### R3.8 Checks owed by later reviews (additions to §R2.6)

- **This PR.** A merge-only Round 3b once `main` is merged (§R3.6).
- **TASK-014.**
  - PR9-SEC-17: bound the bytes actually read, through a single descriptor.
  - Confine `sslrootcert` to a CA directory (PR9-SEC-16 remainder).
  - Allow-list `NODE_EXTRA_CA_CERTS` (PR9-SEC-04 item 3).
- **TASK-015.** PR10-SEC-21: bind head SHAs to the round that holds the last Verdict row (§R3.6).
- **TASK-020 / TASK-108.** Unchanged. The `json-body.test.ts` pattern (an uncapped grammar timing test, a property test, a differential against the reference language, and a cap boundary test) is the template for every future header or body parser.

### R3.9 Conclusion

At head `6331aeb`: 0 Critical, 0 High, 0 Medium, 1 LOW open (PR9-SEC-15, routed), and INFO items routed. PR9-SEC-14 and PR9-SEC-16 are closed and PR9-SEC-17 is new. PR10-SEC-21 (LOW) concerns the lane A tool on `main`, not this PR's code. The PR may merge under D-ORCH-004 once the code review is satisfied and, after `main` is merged, the Round 3b addendum names the merge commit.

## Round 3b (head 6742bec, merge of main)

| Field | Value |
|---|---|
| PR | #9, the merge-main pass after fix cycle 2 |
| Head | 6742becf3979b6c9fc2109dd6d10bb0c63e56495 |
| Delta | One merge commit since the round-3 head (`chore(merge): main into TASK-006 (post TASK-007)`), with parents `6331aeb` and `main` @ `e760368` |
| Scope | Merge only: does the merge commit carry any PR-side content that round 3 did not review? |
| Reviewer / date | security-analyst, 2026-11-13. Read-only, by SHA, from the main checkout (`git diff`, `git rev-parse`). No command in the TASK-006 worktree |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** The merge adds no unreviewed PR-side content, so the round-3 findings and routing apply unchanged: 0 Critical, 0 High, 0 Medium open. This holds while no later commit changes a security-owned path; docs-only and record commits are fine |

**Evidence.**
- **Same set of paths.** `git diff --name-only e760368 6742bec` lists 82 paths, exactly the PR's net change at the round-3 head (`7712c7c..6331aeb`, 82 paths). Both set differences are empty. Every path outside the PR therefore equals `main` @ `e760368`, so the merge drops nothing from `main`.
- **Same content.** 79 of the 82 paths have the same blob as at `6331aeb`. The other 3 are the security-owned overlap paths, and each equals the independent simulation in §R3.6:
  - `eslint.config.mjs` is `ce379e2` and `tools/lint/negative-fixtures.test.ts` is `7a83afe`, both the automatic merge;
  - `package.json` is `6595a2d`. Its diff against `main` is the one PR line, `"gen:modules": "tsx tools/api/gen-module-registry.ts"`.
- **Later `main`.** `main` has since moved to `66cb34b`, through two docs-only commits (`docs/`, `.claude/agent-memory/`). Neither touches a path of this PR.
- **Lane A.** Main's `checkSecurityOwnedPaths` ran in a scratch shared clone, with head = `6742bec` + this record as a docs-only commit and `--pr 9`.
  - Base `66cb34b`: `pass`, satisfied by `6742bec`. Base `e760368`: `pass`, satisfied by `6742bec`.
  - Control, the same head with this Round 3b removed: `missing`, because `6331aeb` is voided by the three overlap paths.
  - Main's `recordVerdict` reads `PASS_WITH_FOLLOW-UPS` from this table's Verdict row, the last of 4 in the file. `recordHeadShas` ends with `6742becf3979b6c9fc2109dd6d10bb0c63e56495`.
- **Later merges.** A later merge of `main` that changes an owned path of this PR needs the same check again, and a new head row.

## Round 3c (head 5e6119d, merge of main)

| Field | Value |
|---|---|
| PR | #9, the merge-main pass after fix cycle 2. It replaces the Round 3b merge, which was never pushed |
| Head | 5e6119d16d491a2cbedf408fb0e5f130319d65b5 |
| Delta | One merge commit since the round-3 head (`chore(merge): main into TASK-006 (post TASK-007)`), with parents `6331aeb` and `main` @ `c998d07`. The Round 3b merge `6742bec` (parents `6331aeb` and `e760368`) never reached `origin`: the branch was reset to `6331aeb` and `main` was merged again |
| Scope | Merge only: does `5e6119d` carry any PR-side content that round 3 did not review, and does it equal `6742bec` outside `docs/` and `.claude/`? |
| Reviewer / date | security-analyst, 2026-11-13. Read-only, by SHA, from the main checkout after `git fetch` (`git diff`, `git rev-parse`, `git merge-tree`, `git ls-remote`). Lane A simulated in a scratch shared clone, removed afterwards. No command in the TASK-006 worktree |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** `5e6119d` adds no unreviewed PR-side content and equals the Round 3b merge outside `docs/` and `.claude/`, so the round-3 findings and routing (§R3.7, §R3.8) apply unchanged: 0 Critical, 0 High, 0 Medium open. This holds while no later commit changes a security-owned path; docs-only and record commits are fine |

**Evidence.**
- **Pushed head.** `git ls-remote origin` gives `5e6119d` for both `refs/heads/feat/TASK-006-api-worker-runtime-skeleton-express` and `refs/pull/9/head`. `6742bec` is not an ancestor of it, so the Round 3b head row binds nothing: lane A accepts only a commit in `<base>..<head>`.
- **Equal to Round 3b outside the docs.** `git diff 6742bec 5e6119d -- . ':!docs' ':!.claude'` is empty. The full diff between the two merges is 19 paths, all under `docs/` or `.claude/agent-memory/`. It is exactly `git diff --name-only e760368 c998d07`, i.e. main's docs-only commits between the two main parents.
- **Same set of paths.** `git diff --name-only c998d07 5e6119d` lists 82 paths, exactly the PR's net change at the round-3 head (`7712c7c..6331aeb`, 82 paths, none under `docs/` or `.claude/`). Both set differences are empty, so the merge drops nothing from `main`.
- **Same content.** 79 of the 82 paths have the same blob as at `6331aeb`. The other 3 are the security-owned overlap paths, which are the whole intersection of `7712c7c..c998d07` with the PR's net change. `main` did not touch any of the three between `e760368` and `c998d07`, so §R3.6's expected resolutions carry over:
  - `eslint.config.mjs` is `ce379e2a` and `tools/lint/negative-fixtures.test.ts` is `7a83afe1`. Both equal the tree of `git merge-tree --write-tree 6331aeb c998d07` (automatic merges) and the Round 3b blobs;
  - `package.json` is `6595a2d4`, the only conflict, and equals the Round 3b blob. Its diff against `main` @ `c998d07` is the one PR line `"gen:modules": "tsx tools/api/gen-module-registry.ts"` after `authz:generate`, with LF endings (0 CR bytes).
- **Later `main`.** `main` is at `e3290a4`, one docs-only commit after `c998d07` (this record's rounds 3 and 3b, `docs/sdlc/STATUS.md`, security-analyst memory). The merge base of `5e6119d` and `e3290a4` is `c998d07`.
- **Lane A run 43289999705** (developer evidence, not re-run here). It was red only at the security-owned-paths record step. The branch carries main's `c998d07` copy of this record, whose last Verdict row is round 2's FAIL. The simulation below reproduces that result and shows that committing this file onto the branch clears it.

**Simulation.** Main's `tools/ci` (from `e3290a4`, via `git archive`) ran against a scratch `git clone --shared --no-checkout` of the main checkout, with base `origin/main` (= `e3290a4`) and `--pr 9`. Each head is `5e6119d`, plus a docs-only commit of the stated record where one is listed:

| Scenario | Result |
|---|---|
| `5e6119d` + this record | `pass`, satisfied by `5e6119d` |
| Control: `5e6119d` as pushed (round-2 copy of the record) | `missing` ("verdict FAIL is not one of …"), the lane A result |
| Control: `5e6119d` + main's `e3290a4` copy (ends at Round 3b) | `missing`. `6331aeb` is voided by the 3 overlap paths, and `6742bec` is not a commit of the range |
| Control: `5e6119d` + this record, `--pr 10` | `missing`. Only `PR-0010-*` records count |

Main's `recordVerdict` reads `PASS_WITH_FOLLOW-UPS` from this table's Verdict row, the last of 5 in the file. `recordHeadShas` ends with `5e6119d16d491a2cbedf408fb0e5f130319d65b5`.

**Residuals.**
- The Round 3b section stays as history. Its head `6742bec` exists only in local object stores and is not reachable from any pushed ref. Under PR10-SEC-21 (LOW, TASK-015) the tool still reads it as a candidate, which is harmless here.
- A later merge of `main` that changes an owned path of this PR needs the same check again, and a new head row.
