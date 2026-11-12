# PR-0005 / TASK-003: change-scoped security review

| Field | Value |
|---|---|
| PR | #5 `feat(db): Prisma 7 + PostgreSQL 18 baseline, bootstrap lane and pinned schema engine (TASK-003, US-074)`, https://github.com/sukhchdit/shipcube/pull/5 |
| Branch / head | `feat/TASK-003-prisma-7-postgresql-18-baseline` @ `d8ba197`; merge-base `main` @ `4da693a`; 2 commits (`2e70cec` docs-only, `d8ba197` implementation); 91 files, +3,813 / −44 |
| Scope | Pinned schema engine (`tools/deps/prisma-engines.{json,mjs}`, `prisma-cli.mjs`, `rebuild.mjs`); bootstrap lane (`prisma/bootstrap/00-roles.sql`, `01-schemas.sql`, `tools/db/bootstrap.ts`, `sql-text.ts`); migration linter; up→down→up driver; `db:reset`; Testcontainers harness; runtime client factory `apps/api/src/platform/db/client.ts`; `prisma.config.ts`; baseline migration |
| Security requirements in scope | D-ARCH-041 / PR1-SEC-02 / PR1-SEC-08 (TASK-003 parts), SEC-P3-34 items 1, 2, 3 (local), 5; SEC-P3-37 item 1; data-model §4.4 / §8.1 / §8.3 rule 12–13; SEC-TC-64 (i)–(v); AT-US-074-04 (runtime-role part); tracked condition **SEC-FU-PR1** |
| Reviewer / date | security-analyst, 2026-11-12. Read-only on the worktree `Shipqube-TASK-003`. No install, build, Docker or test runs (host memory constraint; the orchestrator ran the integration suite in parallel). Node 24.22.3 / npm 11.19.1 under the CLAUDE.md §2 PATH prefix |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open for this change. 1 MEDIUM (PR5-SEC-01, role passwords reach the PostgreSQL server log on the error path), 3 LOW, 6 INFO. All are routed to named tasks below. The merge rule "no Critical/High open" is met. |

## 1. Summary

The engine pin does what D-ARCH-041 asks.
- **Manifest hashes.** I re-derived both hashes independently on 2026-11-12. I streamed each `.gz` from the fixed origin, gunzipped it in the pipe and hashed it, so no binary touched disk. Both match the manifest. They also match the publisher's uncompressed `.sha256` files.
- **Short-circuit.** It is real, and I confirmed it at the cited lines of the `@prisma/fetch-engine` 7.10.1 that `@prisma/engines` actually resolves.
- **Forbidden variables.** The list covers every engine-redirecting variable that the locked sources read.
- **No fallback download.** Every failure path exits 1 before a Prisma child starts.

The bootstrap lane is sound on privilege. Every role has `NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`. The no-member owner roles are `NOLOGIN NOINHERIT`.
- **Database ownership.** The migrator no longer owns the database (SEC-P3-34 item 5). It gets 42501 on `ALTER DATABASE`, `CREATE SCHEMA` and `CREATE EXTENSION`.
- **Bootstrap search path.** The bootstrap role's search path is pinned in the database.
- **Default privileges.** They use the only PostgreSQL form that actually removes `EXECUTE` from `PUBLIC`. I verified this against the PostgreSQL 18 documentation.

The one material issue is not in the privilege model. The two role passwords are interpolated as plaintext literals into one multi-statement query. Any error in `00-roles.sql`, or DDL statement logging (and pgaudit at M5), therefore writes both passwords into the server log. The fix is local and cheap: send SCRAM verifiers, and leave the immutable SQL file unchanged.

## 2. Method

- **Diff and code review.** `git diff 4da693a..d8ba197`, every file. I did a manual sink review of each new executable module: subprocess spawning (argv arrays, no shell), SQL construction (identifier and literal quoting, the lexer), file writes (atomic, `wx`), network (origin, redirects, TLS, size caps) and error and log output (secret reachability).
- **Third-party code read at the locked version:**
  - `node_modules/@prisma/fetch-engine/dist/chunk-P3P4GYYB.js:2300-2443`: `download`, `binaryNeedsToBeDownloaded`, `getCachedBinaryPath`;
  - `chunk-XNR2KDTK.js:89-125`: `getBinaryEnvVarPath`, `getEnvVarToUse`;
  - `@prisma/engines/dist/index.js`: `PRISMA_CLI_BINARY_TARGETS`;
  - `prisma/build/cli.js`: the `ensureBinaries` list, and that `@prisma/engines` is `require`d externally, not bundled;
  - `pg-connection-string@2.14.1`: query parameters override the URL host;
  - `pg/lib/connection-parameters.js:59-60`: the parsed string overrides the explicit config.
- **Independent engine hashing.** I ran `curl --proto =https …/<target>/schema-engine[.exe].gz | gunzip | sha256sum` for both targets. I also fetched the publisher's `.sha256` and `.gz.sha256` files.
- **PostgreSQL semantics.** The PostgreSQL 18 `ALTER DEFAULT PRIVILEGES` documentation (quoted in §4 item 2). I also used the server's logging behaviour for simple-query multi-statement strings (`log_min_error_statement`, `log_statement`).
- **Linter probe.** A scratch replica of `isAuditDdl(…, 'bootstrap')` at `lint-migrations.ts:44-75`, run against 11 statements. The script is `…/scratchpad/review/PR-5-sec/rule12-probe.mjs`.
- **Supply chain.**
  - `package-lock.json` and `.npmrc` are unchanged against the merge-base.
  - `npm audit`: 0 High/Critical (34 moderate and 1 low, all in dev tooling, all pre-existing). `npm audit --omit=dev`: 0 of any severity.
  - Registry facts for D-ARCH-003 rev 4: `npm view elkjs@0.11.1 license`, `npm view elkjs license` (latest), `npm view bcrypt time`, `npm view node-abort-controller@3.1.1 deprecated`.
  - The production closure computed from lockfile flags.
- **Secrets.** I grepped the diff for secret-shaped strings (passwords, keys, URLs with credentials). The only hit is the literal `placeholder` in `client.test.ts:13`. gitleaks was **not** run, because Docker was off-limits for this review. TASK-007's lane A gitleaks covers the merge.
- **SAST.** Semgrep is not installed on the host. About 1,600 lines of executable tooling were reviewed manually.
- **Tests.** Not executed by me (constraint). The test claims rely on senior-developer's unit run (159/159) and the orchestrator's integration run (26/26 per `STATUS.md`). I verified their adequacy by reading the code (§6).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR5-SEC-01 | Role passwords are sent as plaintext SQL literals in one multi-statement simple query. On any error in the file, and on every apply under DDL statement logging, both passwords land in the PostgreSQL server log | MEDIUM | CWE-532, CWE-312 | A09 (A02) | `prisma/bootstrap/00-roles.sql:29-32`; `tools/db/bootstrap.ts:156-159`, `:187-191`; `tools/db/sql-text.ts:122-125` | senior-developer: this PR's fix cycle (recommended), otherwise binding before TASK-014 merges | Open |
| PR5-SEC-02 | Rule 12 in the bootstrap lane is allow-by-default for `platform_audit_owner`. `REASSIGN OWNED BY`, `DROP OWNED BY`, `ALTER ROLE … LOGIN/BYPASSRLS/RENAME`, `DROP ROLE`, `ALTER DEFAULT PRIVILEGES … GRANT`, and a membership `GRANT` that lists the audit owner after another role all pass without the marker | LOW | CWE-184, CWE-693 | A08 | `tools/db/lint-migrations.ts:61-75` | before TASK-021 merges (first audit file); TASK-016 if the linter rules are batched there | Open |
| PR5-SEC-03 | The `db:reset` loopback guard checks `URL.hostname`, but `pg` connects to a `?host=` query parameter. `DATABASE_MIGRATOR_URL` is not checked at all | LOW | CWE-20, CWE-1289 | A04 | `tools/db/reset.ts:19-33`, `:50-57` | senior-developer: this PR's fix cycle or TASK-034 (db tooling) | Open |
| PR5-SEC-04 | No `CODEOWNERS` exists, and no planned task creates it. D-ARCH-041 item 2, D-ARCH-003 rev 4 item 4, data-model §8.3 rule 12 and threat-model T-107/R-21 all cite it, and the rule-12 reviewer list is self-attestable without it | LOW | CWE-284 | A08 | repository root (`.github/` absent); `tools/db/audit-ddl-reviewers.json`; `tools/deps/prisma-engines.json` `$comment` | TASK-007 (devops-engineer); principal-architect to name the enforcing check | Open |
| PR5-SEC-05 | Trusted extensions are installed by the superuser into `public`, which the migrator can write. Future `ALTER EXTENSION … UPDATE` scripts run as superuser with `search_path` = `public, pg_temp` | INFO | CWE-427 | A08 | `prisma/bootstrap/01-schemas.sql:84-86` | principal-architect (data-model note); G4-production runbook (COND-G4-PROD) | Open (note) |
| PR5-SEC-06 | `gunzipSync` has no output cap, so a decompression bomb runs before the manifest check (DoS of `deps:rebuild`) | INFO | CWE-409 | A05 | `tools/deps/prisma-engines.mjs:328` | senior-developer (any later touch of the file) | Open (note) |
| PR5-SEC-07 | Environment sources inside the Prisma child, such as a `NODE_OPTIONS` preload or a future `dotenv` import in `prisma.config.ts`, could set `PRISMA_MIGRATION_ENGINE_BINARY`. Prisma prefers that variable over `PRISMA_SCHEMA_ENGINE_BINARY`, and the after-child re-hash cannot see the swap | INFO | CWE-15, CWE-426 | A08 | `tools/deps/prisma-engines.mjs:435-438`; `@prisma/fetch-engine` `chunk-XNR2KDTK.js:121-125` | senior-developer (small hardening); TASK-007 `check-workflow-policy` | Open (note) |
| PR5-SEC-08 | Connection-string query parameters override explicit `pg` config. The runtime factory rejects only `options`, so `lock_timeout`, `idle_in_transaction_session_timeout` and `application_name` in the URL silently override role settings and factory values. The bootstrap `options` guard is a raw-string regex that `%6Fptions` bypasses; `SHOW search_path` still catches it | INFO | CWE-15 | A05 | `apps/api/src/platform/db/client.ts:60-61`; `tools/db/bootstrap.ts:80-82` | TASK-005/TASK-006 (config mapping, composition root) | Open (note) |
| PR5-SEC-09 | Role re-assertion resets attributes but not pre-existing memberships, role settings or ownerships of a squatted `platform_*` role. The migrator keeps `INHERIT` | INFO | CWE-269 | A01 | `prisma/bootstrap/00-roles.sql:16-36` | TASK-016 (C13 runs post-bootstrap in every lane); SPK-08 (RDS) | Open (note) |
| PR5-SEC-10 | SEC-TC-64 test notes: (iv) has a location control but no sensitivity control; there is no test for an empty-valued forbidden variable or for the size cap; the SEC-TC-64 row in `security-test-cases.md` still has the pre-D-ARCH-041 text | INFO | n/a | n/a | `tools/deps/prisma-engines.test.ts:179-190`, `:345-403`; `docs/05-quality/tests/security-test-cases.md:83` | qa-lead (SEC-FU-QA); senior-developer (tests, optional) | Open (note) |

### PR5-SEC-01: role passwords reach the PostgreSQL server log (MEDIUM)

**Description.**
- `runBootstrap` substitutes `:'migrator_password'` and `:'app_password'` as quoted plaintext literals (`sql-text.ts:122-125`) into the whole file. It sends the result as one simple-protocol query (`bootstrap.ts:159`: `client.query(sql)` with no parameters).
- PostgreSQL logs the failing *query string* under `log_min_error_statement` (default `error`). For a simple-query message that string is the entire multi-statement text (`STATEMENT: …`). Any error in `00-roles.sql` therefore writes both passwords to the server log. Examples: a lock or role conflict, or the RDS-specific statement differences that SPK-08 still has to verify.
- With `log_statement = 'ddl'`, the same text is logged on **every** successful apply, because `ALTER ROLE` is DDL. pgaudit's ROLE class does the same. pgaudit is planned for M5 (SEC-COND-03 item 7).
- `reapplyDatabaseLevel` (`:187-191`) and the restore rehearsal (data-model §8.6 step 4) re-send the same text.
- The PostgreSQL documentation for `CREATE/ALTER ROLE … PASSWORD` warns about exactly this.

**Exploitability and impact.**
- **Impact H.** A reader of the logs gets the runtime credential (`platform_app`: all tenant data under RLS) and the DDL credential (`platform_migrator`). Readers include `docker compose logs postgres` locally, CI container logs, and CloudWatch at M5.
- **Likelihood L in this run.** The databases are local or ephemeral and the harness passwords are random. Likelihood rises at M5, when DDL logging or pgaudit makes the success path leak too.
- H×L = **MEDIUM**. The guardrail "secrets in logs = 0" (CLAUDE.md §1) applies.

**Remediation (code level; `00-roles.sql` is unchanged, so its ledger hash is unaffected).** Send a SCRAM-SHA-256 verifier instead of the plaintext. PostgreSQL stores a pre-hashed verifier as is, whatever `password_encryption` says.

```ts
// tools/db/scram.ts
import { createHash, createHmac, pbkdf2Sync, randomBytes } from 'node:crypto';
const PRINTABLE_ASCII = /^[\x21-\x7e]{24,}$/; // SASLprep is the identity on printable ASCII; also a length floor
export function scramSha256Verifier(password: string, iterations = 4096, salt = randomBytes(16)): string {
  if (!PRINTABLE_ASCII.test(password)) throw new Error('role passwords must be >= 24 printable ASCII characters');
  const salted = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  const clientKey = createHmac('sha256', salted).update('Client Key').digest();
  const storedKey = createHash('sha256').update(clientKey).digest();
  const serverKey = createHmac('sha256', salted).update('Server Key').digest();
  return `SCRAM-SHA-256$${iterations}:${salt.toString('base64')}$${storedKey.toString('base64')}:${serverKey.toString('base64')}`;
}
```

- **Callers.** `BootstrapOptions` gains `passwords: { migrator: string; app: string }`. `runBootstrap` and `reapplyDatabaseLevel` convert them to `vars.migrator_password` / `vars.app_password` with `scramSha256Verifier`. `vars` rejects any `*_password` key, so no caller can pass plaintext. `main`, `reset.ts` and the harness (`bootstrapVars()`) switch to `passwords`.
- **Side effect.** The verifier is base64 plus `$:`, so it never contains a backslash or a quote. This also removes the `standard_conforming_strings` assumption in `quoteLiteral` for these values.

**Verification.**
1. **Unit.** The verifier matches `^SCRAM-SHA-256\$4096:[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}:[A-Za-z0-9+/=]{44}$`. A short password or a non-ASCII password is rejected.
2. **Integration.** Start the container with `.withCommand(['postgres', '-c', 'log_statement=ddl'])`. Then:
   - Bootstrap. Next, call `reapplyDatabaseLevel` on a lane copy whose `00-roles.sql` has `SELECT 1/0;` appended, so the error path runs.
   - Assert that `container.logs()` contains neither plaintext password.
   - Assert that `pg_authid.rolpassword` for both roles starts with `SCRAM-SHA-256$4096:`.
   - Assert that `platform_app` and `platform_migrator` still log in with the plaintext.

### PR5-SEC-02: rule 12 bootstrap-lane detection is allow-by-default (LOW)

**Description.**
- In the bootstrap lane, `isAuditDdl` flags audit-object names and three audit-owner forms: `SET ROLE`, `OWNER TO`, and `GRANT platform_audit_owner TO` with the owner as the *first* grantee. The probe confirmed that these 8 audit-weakening statements pass **without** the marker:
  - `GRANT platform_definer, platform_audit_owner TO platform_migrator`
  - `REASSIGN OWNED BY platform_audit_owner TO platform_migrator`, which hands every audit table to the migrator
  - `DROP OWNED BY platform_audit_owner CASCADE`
  - `ALTER ROLE platform_audit_owner LOGIN PASSWORD '…'`
  - `ALTER ROLE platform_audit_owner BYPASSRLS`
  - `ALTER ROLE platform_audit_owner RENAME TO …`
  - `ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner GRANT UPDATE, DELETE ON TABLES TO platform_app`
  - `DROP ROLE platform_audit_owner`
- The migrations lane is unaffected: there, any mention of the audit owner fails unconditionally.

**Exploitability and impact.**
- **Precondition.** A reviewed bootstrap-lane PR has to contain such a statement.
- **Layers that catch it.** The boundary is the catalog tests (C5 grant manifest, C13 memberships and login, audit ownership assertions), which arrive in TASK-016 and TASK-021, plus the review. The guard does not help, because the bootstrap lane runs as the superuser it admits.
- **What the gap costs.** The linter is the early-warning layer data-model §8.3 assigns to exactly this lane, and it misses the strongest weakening forms.
- **Severity.** Impact M (degrades a defence-in-depth control) × likelihood L = **LOW**.

**Remediation.** Make the bootstrap lane deny-by-default for audit-owner mentions: any statement that matches `AUDIT_OWNER_PATTERN` needs the marker, unless it matches a narrow allow-list of the *tightening* forms that `00`/`01` contain:

```ts
const AUDIT_OWNER_TIGHTENING = [
  // ALTER ROLE platform_audit_owner with only NO* attributes (no LOGIN, PASSWORD, RENAME, SET, VALID UNTIL, CONNECTION LIMIT)
  /^alter role "?platform_audit_owner"?( (nologin|nosuperuser|nocreatedb|nocreaterole|noreplication|nobypassrls|noinherit))+$/,
  // schema privileges granted TO the no-member owner
  /^grant (usage|create)(, ?(usage|create))? on schema [a-z_, "]+ to "?platform_audit_owner"?$/,
  // default-privilege REVOKEs only
  /^alter default privileges for role "?platform_audit_owner"? (in schema [a-z_, "]+ )?revoke /,
];
const isAuditDdl = (statement: string, lane: 'migrations' | 'bootstrap'): boolean => {
  if (AUDIT_OBJECT_PATTERN.test(statement)) return true;
  if (!AUDIT_OWNER_PATTERN.test(statement)) return false;
  return lane === 'migrations' || !AUDIT_OWNER_TIGHTENING.some((p) => p.test(normalise(statement)));
};
```

The creation `DO` block in `00-roles.sql` names the role inside an array literal, and the lexer keeps that literal as a dollar-quoted body. Either allow-list that exact block by its normalised text, or match `AUDIT_OWNER_PATTERN` against code tokens only (strings and bodies excluded). The developer's Decision 5 (§4 item 4) stays valid in substance.

**Verification.** Add one fixture per bypass form above under `tools/db/fixtures/lint/bootstrap/audit-owner-*`, each expecting rule `12`. `audit-owner-setup` and the real `00`/`01` files keep expecting `[]`.

### PR5-SEC-03: the `db:reset` guard can be steered off loopback (LOW)

**Description.**
- `resetTarget` checks `new URL(url).hostname` against the loopback set (`reset.ts:25-26`). `pg-connection-string` (`index.js`, "Only set the host if there is no equivalent query param") lets `?host=` override the URL host, and `pg` merges the parsed string over the explicit config.
- So `postgresql://admin@localhost/platform?host=shared-db.internal --yes` passes the guard. `DROP DATABASE … WITH (FORCE)` then runs against `shared-db.internal`.
- `DATABASE_MIGRATOR_URL`, used by the subsequent `migrate deploy` (`:52-57`), is never checked against the reset target.

**Exploitability and impact.** This is an accident-prevention guard, not an attacker boundary: anyone setting the URL already holds an admin credential. Impact M: data loss on a shared, non-production database, since none exists this run. Likelihood L. Severity **LOW**.

**Remediation.**

```ts
import { parse } from 'pg-connection-string';
const effective = parse(bootstrapUrl);                  // the parser pg itself uses
if (new URL(bootstrapUrl).searchParams.has('host') || new URL(bootstrapUrl).searchParams.has('hostaddr'))
  throw new BootstrapError('db:reset refuses host/hostaddr query parameters');
if (!LOOPBACK.has(String(effective.host))) throw new BootstrapError(`db:reset only runs against a loopback host, not ${effective.host}`);
// and: the migrator URL must name the same host, port and database
const migrator = parse(env['DATABASE_MIGRATOR_URL'] ?? '');
if (migrator.host !== effective.host || migrator.port !== effective.port || migrator.database !== database)
  throw new BootstrapError('DATABASE_MIGRATOR_URL must point at the database being reset');
```

The LOOPBACK set should hold `::1` (the parser strips brackets).

**Verification.** In `bootstrap.test.ts`/`reset` unit tests, these are refused:
- `resetTarget('postgresql://u@localhost/db?host=db.example.com', ['--yes'])`;
- the same with `hostaddr=10.0.0.5`;
- a migrator URL with a different database.

### PR5-SEC-04: `CODEOWNERS` is cited by four controls but owned by no task (LOW)

**Description.** These all rely on "security-analyst review (CODEOWNERS)" for a path: D-ARCH-041 item 2 (`tools/deps/prisma-engines.json`), D-ARCH-003 rev 4 item 4 (`tools/ci/*-exceptions.json`), data-model §8.3 rule 12 (`tools/db/audit-ddl-reviewers.json`) and threat-model T-107/R-21 (`packages/authz`, `packages/audit`, `prisma/migrations`).
- There is no `.github/` directory.
- No task sheet in `docs/04-plan/tasks/` mentions CODEOWNERS.
- Without it, the rule-12 marker is self-attestable: the PR that adds an audit file can add its own "reviewer" to `audit-ddl-reviewers.json`.

**Exploitability and impact.** It is compensated today by CLAUDE.md §5: every merge needs a security-analyst verdict. In a single-maintainer repository, GitHub's "Require review from Code Owners" cannot be satisfied by agents, so a plain `CODEOWNERS` file would be either decorative or merge-blocking. Severity **LOW**.

**Remediation.** TASK-007:
1. Add `.github/CODEOWNERS` covering these paths: `tools/deps/prisma-engines.json`, `tools/deps/prisma-engines.mjs`, `tools/deps/prisma-cli.mjs`, `tools/db/audit-ddl-reviewers.json`, `prisma/bootstrap/**`, `tools/ci/*-exceptions.json`, `packages/authz/**`, `packages/audit/**`, `prisma/migrations/**`, `.github/**`. It serves as documentation and drives the review UI.
2. Add a lane A `check-security-owned-paths`. When the diff touches any of those paths, it requires a committed review record `docs/05-quality/security/PR-<nnnn>-*.md` that names the PR head SHA and a verdict other than FAIL. The check runs from the base ref (SEC-P3-31).
3. principal-architect records the rule in ADR-0023, so "CODEOWNERS" in the four controls means this check.

**Verification.** Lane A fixtures:
- a PR changing `prisma-engines.json` without a record fails;
- one with a record whose SHA does not match fails;
- one with a matching record passes.

### PR5-SEC-05 to PR5-SEC-10 (INFO)

- **PR5-SEC-05: extensions in a migrator-writable schema.**
  - **Today.** `pg_trgm`, `btree_gin` and `btree_gist` objects are superuser-owned in `public`, where the migrator has `CREATE`. `CREATE EXTENSION IF NOT EXISTS` runs once, before any migrator object exists. Since CVE-2022-2625, extension scripts refuse to replace objects they do not own. No exposure today.
  - **The residual.** A later `ALTER EXTENSION … UPDATE` run by the bootstrap role or the RDS master resolves unqualified names in the update script through `public`.
  - **Proposed.** Add this to the G4-production runbook: "before any `ALTER EXTENSION … UPDATE`, assert no migrator-owned function or operator in `public` shares a name with an extension member". Note the M5 option of a dedicated `extensions` schema owned by `platform_schema_owner` (`USAGE` only for the platform roles) in data-model §4.4.
- **PR5-SEC-06: decompression bomb.** The manifest hash is the trust anchor, but it is checked after `gunzipSync(gz)` inflates without a cap. Use `gunzipSync(gz, { maxOutputLength: 256 * 1024 * 1024 })`, which comfortably covers today's engines. Test: an injected transport serving a small gzip of 300 MB of zeros fails with `cannot gunzip` and leaves no file behind.
- **PR5-SEC-07: environment set inside the child.**
  - **Mechanism.** `getEnvVarToUse` prefers the *deprecated* `PRISMA_MIGRATION_ENGINE_BINARY` when it is set (`chunk-XNR2KDTK.js:121-125`). `prismaChildEnv` strips it from the inherited environment, which is correct. But a value set *inside* the child would redirect the engine while the verified file stays untouched, and `reverifyEngine` would pass. Two ways to set it there: a `NODE_OPTIONS=--require …` preload, or a future `import 'dotenv/config'` in `prisma.config.ts`.
  - **Exposure.** Neither exists today. Prisma 7 does not auto-load `.env`, and `@prisma/config` loads with `dotenv: false`.
  - **Hardening.** `prismaChildEnv` drops `NODE_OPTIONS` (or refuses one containing `--require`, `--import` or `--env-file`). Add a unit test that `prisma.config.ts` and `prisma/tests/fixtures/**/prisma.config.ts` contain no `dotenv` and no `loadEnvFile`.
  - **TASK-007.** `check-workflow-policy` also rejects `NODE_OPTIONS` preloads and `NODE_TLS_REJECT_UNAUTHORIZED=0` in workflows. TLS is not the trust anchor, so the latter is hygiene.
- **PR5-SEC-08: query parameters override config.**
  - **Mechanism.** `pg` applies `Object.assign({}, config, parse(connectionString))`, so URL parameters win over explicit settings.
  - **Fix.** `toPoolConfig` should allow-list query parameters (for example `sslmode`, `sslrootcert`, `sslnegotiation`) and reject the rest, rather than reject only `options`. `connectPrivileged` should test `new URL(cs).searchParams.has('options')` instead of the raw-string regex, so the two guards behave the same.
  - **Exposure.** None today. The value comes from typed configuration, and the `SHOW search_path` check makes the bootstrap path fail closed on a search-path change.
- **PR5-SEC-09: squatted roles.**
  - **The gap.** `ALTER ROLE` re-asserts attributes on a pre-existing `platform_*` role. It does not remove members, role settings or ownerships the role already had. This matters on a shared cluster (RDS at M5).
  - **Control.** C13, which must run post-bootstrap in every lane and in the restore rehearsal (TASK-016, TASK-034).
  - **Cheap fail-fast.** End `00-roles.sql`'s successor file, or have the runner check afterwards, with an assertion that `pg_auth_members` holds exactly the expected rows for `platform_%`.
  - **Optional.** `platform_migrator NOINHERIT` would make any future grant to it non-inheriting by default (PG 16+). With PG 16+ grant options this is cosmetic, since `SET` would still default to TRUE.
- **PR5-SEC-10: SEC-TC-64 test notes.**
  - **(iv) sensitivity.** It proves the poisoned entry sits where Prisma looks (the control test) and that the engine is unchanged afterwards. It does not prove that the same run *without* the override would have been poisoned. I verified that sensitivity by code reading instead:
    - `binaryNeedsToBeDownloaded` returns at `:2415` when the override path exists;
    - `getBinaryEnvVarPath` throws when it does not (fail closed);
    - without the override, `:2427-2433` overwrites the target from a cache entry whose `.sha256` matches.
  - **Missing tests.** An empty-valued variable (the code treats `''` as set), and the 128 MB cap.
  - **Catalogue text.** `security-test-cases.md:83` still describes SEC-TC-64 as the SEC-P3-31 base-ref and `npm exec --no` case. D-ARCH-041 item 8 redefined it as (i)–(vi). qa-lead should reconcile it under SEC-FU-QA.

## 4. Reviewer-focus items: rulings

1. **Engine manifest and D-ARCH-041 mechanics: CONFIRMED.**
   - **Hashes.** Verified independently: `debian-openssl-3.0.x` binary `7116e002…311f` (gz `5827f561…fad6`) and `windows` binary `e6c4bb89…ea4a` (gz `67ffd7d2…e62d`). Both binary hashes equal the publisher's uncompressed `.sha256` files and the manifest. The installed `node_modules/@prisma/engines/schema-engine-windows.exe` hashes to the manifest value, and `@prisma/engines-version` is `8.1.0-1.d1b3f377…`.
     - The third fetch comes from the same origin, so it proves consistency across time and tooling, not provenance. Residual R-ARCH-23 (origin compromise before recording) is unchanged.
   - **Fixed origin.** `ENGINE_ORIGIN` is a constant, and the manifest `source` must equal it. URLs are built from the constant. Redirects are same-host and `https:` only, with a maximum of 5. Non-HTTPS URLs are refused.
   - **TLS.** Node's default verification applies. TLS is not the trust anchor: a TLS failure can only deny service, never substitute bytes.
   - **Forbidden variables.** The 10 names cover every engine-redirecting read in the locked `@prisma/fetch-engine`, `@prisma/engines` and the CLI:
     - `PRISMA_ENGINES_MIRROR`, `PRISMA_BINARIES_MIRROR`;
     - `PRISMA_ENGINES_CHECKSUM_IGNORE_MISSING`;
     - `BINARY_DOWNLOAD_VERSION`;
     - `PRISMA_SCHEMA_ENGINE_BINARY` and `PRISMA_MIGRATION_ENGINE_BINARY` (dynamic, via `getEnvVarToUse`);
     - `PRISMA_CLI_BINARY_TARGETS`.

     The other variables those sources read (`HTTP(S)_PROXY`, `NO_PROXY`, `XDG_CACHE_HOME`, `APPDATA`, `DEBUG`) affect transport or cache location only, and the short-circuit bypasses both. Matching is case-insensitive and counts empty values. `deps:rebuild` refuses even a correct `PRISMA_SCHEMA_ENGINE_BINARY`, and the wrapper tolerates only the verified path. Both are correct for the `migrate` image (am. J (e)).
   - **Short-circuit.** Confirmed at `chunk-P3P4GYYB.js:2330` (`shouldDownload = … && !job.envVarPath`) and `:2415` (returns before `getCachedBinaryPath` and before the cache overwrite at `:2419-2443`). `cleanupCache()` runs only when something downloads, so the cache is not written either. The CLI `require`s the external `@prisma/engines` (`cli.js`: `require("@prisma/engines")`). That package resolves the hoisted `@prisma/fetch-engine@7.10.1`, and the nested `@prisma/get-platform@7.10.1` is the one the script uses (the hoisted copy is 7.2.0).
   - **Failure modes.** Stale version, unknown target, foreign source, bad manifest shape, transport mismatch, non-gzip body, trust-anchor mismatch, write mismatch, unreachable origin, and a change after the child exits: each exits 1. Each also removes `schema-engine*` from the engines directory.
   - **No fallback.** `rebuild.mjs` returns before the `prisma` step, and `prisma-cli.mjs` returns before `spawnSync`.
   - **CODEOWNERS.** Not present; see PR5-SEC-04.
2. **Bootstrap SQL: CONFIRMED.**
   - **Role attributes.** As specified in data-model §4.4: app `NOINHERIT CONNECTION LIMIT 200`; definer, audit owner and schema owner `NOLOGIN NOINHERIT`; all `NO{SUPERUSER,CREATEDB,CREATEROLE,REPLICATION,BYPASSRLS}`. `platform_definer` is granted to the migrator `WITH INHERIT FALSE, SET TRUE` and without ADMIN. The audit and schema owners have no members (tested).
   - **Search path.** `SET search_path = pg_catalog, pg_temp` is the first statement of each file. The runner session is pinned by `options` and checked with `SHOW`. The bootstrap role is pinned in the database by `ALTER ROLE CURRENT_USER IN DATABASE … SET search_path`, and a test asserts the effective value without `options`.
   - **Database ownership.** The migrator does not own the database. `REVOKE ALL ON DATABASE … FROM PUBLIC` removes PUBLIC's `TEMPORARY` too. `CONNECT` is granted to the app and the migrator only.
   - **Default privileges.** Placed after the schema exists, as SEC-P3-37 item 1 requires, although the global form no longer depends on the schema.
   - **FOR ROLE vs IN SCHEMA: the developer's claim is correct.** PostgreSQL 18 docs: "Default privileges that are specified per-schema are added to whatever the global default privileges are … you cannot revoke privileges per-schema if they are granted globally (either by default …). Per-schema REVOKE is only useful to reverse the effects of a previous per-schema GRANT." The docs give `ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` as the no-op example and the `FOR ROLE … REVOKE` form without `IN SCHEMA` as the fix.
     - `pg_default_acl` is per database ("all objects created in the current database"), so "global" here means all schemas of this database.
     - Functions the migrator creates under `SET ROLE platform_definer` are created *by* the definer and get the definer's row.
     - Functions created and then reassigned with `ALTER … OWNER TO` keep their creation ACL with the owner substituted.
     - **Not covered:** functions created by the bootstrap role itself. TASK-021 must create audit functions after `SET ROLE platform_audit_owner` (as data-model §4.4 already shows) or `REVOKE EXECUTE … FROM PUBLIC` explicitly.
     - data-model §4.4's `IN SCHEMA public REVOKE ALL ON TABLES FROM PUBLIC` is also a no-op, because tables carry no PUBLIC default, and can be dropped.
3. **Ledger SHA-256 tamper detection: CONFIRMED for its purpose.**
   - **What it detects.** It detects a changed, deleted or out-of-order bootstrap *file*. It is not a control against a database adversary: only the bootstrap superuser can write the ledger, and deleting rows causes an idempotent re-apply.
   - **Ledger protection.** Owned by the bootstrap role, `REVOKE ALL … FROM PUBLIC`, fully qualified, read under the advisory lock. The migrator's `CREATE` on `public` cannot shadow it, because the runner's path is `pg_catalog, pg_temp` and the name is qualified.
   - **Hash inputs.** The hash covers raw bytes, and `.gitattributes` `* text=auto eol=lf` keeps them stable across Windows and containers.
   - **Atomicity.** The file and its ledger row commit in one transaction (tested).
4. **Rule-12 marker scope (Decision 5): CONFIRMED WITH AMENDMENT.**
   - **Agreed.** The statements in `00`/`01` need no marker. They either tighten (the `NO*` attribute assertion, the default-privilege `REVOKE`s) or are inert, since they grant schema privileges *to* a role nobody can use.
   - **The amendment.** The implementation must be deny-by-default for every other audit-owner mention (PR5-SEC-02).
   - **Data-model wording.** The text "`GRANT … TO`" should read "role-membership `GRANT` of `platform_audit_owner`, and any statement that changes its attributes, ownerships or default privileges other than a `REVOKE`". principal-architect to amend §8.3.
5. **up-down-up writing `rolled_back_at`: CONFIRMED confined to test and dev.**
   - **Reachability.** `tools/db/up-down-up.ts` has no `import.meta.main` entry and no npm script. Only `prisma/tests/**` and `tools/db/*.test.ts` import it.
   - **Role.** `markRolledBack` (`prisma/tests/harness/postgres.ts:126-139`) connects as `platform_migrator`, the owner of `_prisma_migrations`, and updates exactly one finished row. It never runs as the bootstrap superuser. A superuser `UPDATE` on a migrator-owned table would execute any trigger the migrator planted on it with superuser rights, so this choice is the right one.
   - **Recommendation.** TASK-002's boundaries rules should forbid importing `tools/db/up-down-up` from `apps/**`/`packages/**` (INFO).
6. **`db:reset` guard: CONFIRMED** for `--yes`, the refused names (`postgres`, `template*`, empty), recreate, bootstrap and deploy. The loopback check is bypassable (PR5-SEC-03).
7. **Secrets: CONFIRMED client-side, NOT server-side.**
   - **Client side.**
     - `readSecret` reads the value or the `*_FILE` file and never echoes either. An empty value is treated as unset.
     - Runner logs carry the file and database names only. Errors carry the message and SQLSTATE, not `detail`/`where`.
     - No connection string reaches a log. `pg-connection-string` redacts its parse errors.
     - The harness passwords are 32 random bytes per run. `.env*` is untouched, and no committed value is secret-shaped.
   - **Server side.** PR5-SEC-01.
8. **Harness role separation: CONFIRMED.**
   - **Runtime.** `runtime-role.int.test.ts` builds the client through the production factory with `appUrl`. It asserts that `current_user` and `session_user` are `platform_app`, `rolsuper = false`, `rolbypassrls = false`, that the role owns nothing, and that DDL is denied in `public` and `platform`.
   - **Other roles.** Migrations run as the migrator via `DATABASE_MIGRATOR_URL`, and bootstrap and clone run as the pinned superuser.
9. **`tools/db/audit-ddl-reviewers.json` empty: CONFIRMED fail-closed.** Any audit DDL in the bootstrap lane fails today. Routed to TASK-021, together with PR5-SEC-04: the reviewer identity is meaningful only once the record-based check exists.
   - Suggested identity: `security-analyst`, as the fixture uses.
   - Suggested extension: the linter cross-checks the marker against a committed review record that names the file.

## 5. SEC-FU-PR1 confirmation

| Decision | Ruling | Evidence |
|---|---|---|
| **D-ARCH-041** (Prisma engine pin) | **CONFIRMED: design, and the TASK-003 implementation of items 1–4, 7 and 8 (i)–(v).** Two conditions: PR5-SEC-04 (the CODEOWNERS premise of item 2 needs an enforcing check) and the INFO hardening PR5-SEC-06/07. Item 5 (CI cache key, `check-workflow-policy`, `check-no-raw-prisma`) and item 6 / test (vi) (images, `--network none`) are confirmed in the TASK-007 and TASK-014 reviews | §4 item 1. Independent hash derivation (§10 commands 1–2). Source lines in `@prisma/fetch-engine` 7.10.1. No raw `prisma` in any `package.json` script or tool (`grep`). Lockfile unchanged |
| **D-ARCH-003 rev 4** (licence and deprecation registers) | **Policy CONFIRMED; implementation not yet reviewable.** `tools/ci/` does not exist; the registers, the checks and the negative fixtures are TASK-007 deliverables. The implementation confirmation stays open for the TASK-007 review | All facts checked against the **locked** versions on 2026-11-12, see the list below |

**D-ARCH-003 rev 4 facts:**
- `elkjs@0.11.1` license is `EPL-2.0`; `elkjs@0.12.1` (latest) is `EPL-2.0 OR GPL-3.0-or-later`. Item 1's correction holds.
- In the lockfile, `elkjs`, `@prisma/studio-core`, `prisma`, `@prisma/engines` and `@prisma/fetch-engine` are all `devOptional`. The production closure computed from lockfile flags (`--omit=dev --omit=optional` semantics) has 589 entries and contains none of them.
- `bcrypt@6.0.0` was published 2025-05-11T18:06Z, so it crossed 18 months on 2026-11-11. This matches D-ARCH-042.
- `node-abort-controller@3.1.1` is deprecated ("no longer needed on supported Node.js versions…"). It is in the production closure via `bullmq@6.7.0`, which matches D-ARCH-043.
- `npm audit --omit=dev` = 0. The report-only treatment of dev-only deprecations is acceptable, because High/Critical advisories stay gating through `npm audit --audit-level=high`, which covers dev, and supply-chain injection is addressed separately (`min-release-age`, `ignore-scripts`, signatures).

**Notes for the TASK-007 implementation:**
1. Compute the closures from lockfile flags (`dev`, `optional`, `devOptional`). `npm ls elkjs --omit=dev --omit=optional` still prints `@platform/api → @prisma/client → prisma → @prisma/studio-core → elkjs`, because `@prisma/client` declares an optional peer on `prisma`. That `npm ls` view does not reflect what `npm ci --omit=dev --omit=optional` installs.
2. Express the `elkjs` exception's `via` chain from `prisma` downwards. The checker must also accept that the chain is reached through the `@prisma/client` optional-peer edge; otherwise "reached outside the chain" misfires.

**Recommended `STATUS.md` update.** Change SEC-FU-PR1 to "TASK-003 part DONE (PR-0005: D-ARCH-041 confirmed, D-ARCH-003 rev 4 policy confirmed); TASK-007 part OPEN (register implementation, workflow policy)".

## 6. SEC-TC coverage: claimed vs verified

| Test case | Claimed in PR | Verified (code reading; not re-executed) |
|---|---|---|
| SEC-TC-64 (i) altered hash → exit 1, no engine left | Yes | **Yes.** `prisma-engines.test.ts:155-177`: manifest mismatch with a pre-existing engine and a partial file both removed; transport mismatch; non-gzip |
| SEC-TC-64 (ii) redirect variable → refused before any network call | Yes | **Yes.** `:179-215`: all 10 names (lower-cased, proving case-insensitivity), zero requests, no file. Real `rebuild.mjs` and `prisma-cli.mjs` child processes exit 1 before any step. The `PRISMA_SCHEMA_ENGINE_BINARY` exception is tested both ways. Gap: empty value (PR5-SEC-10) |
| SEC-TC-64 (iii) empty directory + unreachable origin → fail closed | Yes | **Yes.** `:217-243`: 2×(3+1) attempts, no file. `--verify-only` makes no request |
| SEC-TC-64 (iv) poisoned per-user cache ignored | Yes | **Yes, with a note.** `:345-403` runs the real CLI `generate` (it is in `ensureBinaries`) with a poisoned cache at the location proven by the control test; the cache is neither read nor written. The sensitivity rests on code reading (PR5-SEC-10) |
| SEC-TC-64 (v) stale `enginesVersion` → exit 1 before a request | Yes | **Yes.** `:245-255` |
| SEC-TC-64 (vi) image tests | No (TASK-014) | n/a |
| TASK-003 acceptance: empty engine directory, no `PRISMA_*`, scripts disabled | Yes | **Yes.** `prisma-engines.int.test.ts` strips `PRISMA_*` and `DEPS_REBUILD_*`, empties the directory, asserts `ignore-scripts=true`, the fetch from the fixed origin, the hash, mode 0755 (POSIX) and a regenerated client |
| SEC-TC-45 (updated) | Yes | **Yes.** The step list includes `prisma-engines`, the offline-mode real run, and a budget assertion |
| AT-US-074-04 (runtime-role part) | Yes | **Yes.** §4 item 8 |
| NT-DATA-004-a (empty-database part) | Yes | **Yes**, with a negative control (`updown-broken` leaves a sequence and is reported). The seeded part waits for TASK-023 |
| SEC-P3-34 local catalog assertion (item 3 part) | Yes (not as SEC-TC) | **Yes.** `bootstrap.int.test.ts:272-288`. The C13 extension is TASK-016 |
| SEC-TC-33 (migration lint) | **No (correctly)** | Rules 3–9 and 11 are not implemented, and rule 12 has the PR5-SEC-02 gap. Owner needed: recommend **TASK-016**, the first task that alters tables and adds policies, with rule 12 fixed before TASK-021 |
| SEC-TC-65 (search-path probe) | No (proposed only) | n/a (SEC-FU-QA) |

## 7. Security requirements: status after this PR

| Requirement | Status |
|---|---|
| PR1-SEC-02 (MEDIUM) | **TASK-003 part RESOLVED** (the pin, the wrapper, tests (i)–(v), the empty-directory acceptance). The TASK-007 part (workflow policy, cache key, `check-no-raw-prisma`) and the TASK-014 part (images, test (vi)) remain binding |
| PR1-SEC-08 (INFO) | **TASK-003 part RESOLVED** (`CHECKPOINT_DISABLE=1` for every Prisma child). The TASK-007 and TASK-014 parts remain |
| SEC-P3-34 (LOW) | **TASK-003 part RESOLVED.** Item 1 (role-in-database pin), item 2 (runner and harness `options`), item 3 (local assertion) and item 5 (database not owned by the migrator; extensions by bootstrap) are done. Remaining: the C13 extension and the catalog harness `options` (TASK-016), the rehearsal `options` (TASK-034), and the item 4 runbook (G4-production) |
| SEC-P3-37 item 1 (INFO) | **RESOLVED.** The global `FOR ROLE` form, placed after the schema; data-model correction per Decision 3 |
| SEC-P3-27 item 4 (bootstrap first statement, runner pin) | **Implemented and linted** (rule 13 bootstrap check, `connectPrivileged`) |

## 8. Follow-ups routed to named tasks

| Item | Severity | Owner / task | Due |
|---|---|---|---|
| PR5-SEC-01: SCRAM verifiers instead of plaintext passwords; integration log test | MEDIUM | senior-developer, this PR's fix cycle (recommended) | Binding before TASK-014 merges (Compose bootstrap with a persistent volume and logs); in all cases before any M5 run |
| PR5-SEC-02: rule-12 deny-by-default in the bootstrap lane, plus fixtures | LOW | senior-developer / database-engineer | Before TASK-021 merges (TASK-016 if the linter rules are batched there) |
| PR5-SEC-03: `db:reset` effective-host and migrator-URL checks | LOW | senior-developer (this PR) or TASK-034 | Before TASK-014 documents `db:reset` |
| PR5-SEC-04: CODEOWNERS plus the record-based `check-security-owned-paths` | LOW | TASK-007 (devops-engineer); principal-architect (ADR-0023 wording) | With TASK-007 |
| PR5-SEC-05: extension-update runbook item; data-model note | INFO | principal-architect; COND-G4-PROD | G4-production |
| PR5-SEC-06: `maxOutputLength` on `gunzipSync` | INFO | senior-developer | Next touch of `prisma-engines.mjs` |
| PR5-SEC-07: drop or refuse `NODE_OPTIONS` preloads for Prisma children; no-`dotenv` test; workflow policy | INFO | senior-developer; TASK-007 | With TASK-007 |
| PR5-SEC-08: query-parameter allow-list in `toPoolConfig`; `URLSearchParams` in `connectPrivileged` | INFO | TASK-005 / TASK-006 | With TASK-006 |
| PR5-SEC-09: C13 post-bootstrap in every lane and in the rehearsal; optional membership fail-fast | INFO | TASK-016, TASK-034, SPK-08 | With those tasks |
| PR5-SEC-10: SEC-TC-64 catalogue text; optional extra tests | INFO | qa-lead (SEC-FU-QA) | Before Wave 4 |
| Migration-linter rules 3–9 and 11 (SEC-TC-33) need an owner | n/a | orchestrator: recommend TASK-016 | TASK-016 |
| `audit-ddl-reviewers.json` identity and record cross-check | n/a | TASK-021 + security-analyst | Before the first audit file |
| SEC-FU-PR1 TASK-007 half: registers, checks, negative fixtures; closures from lockfile flags | n/a | TASK-007 | batch 0.3 |

## 9. Proposed decision text (for principal-architect / orchestrator to log; security-analyst does not edit ADRs)

1. **Data-model §4.4 (Decisions 2 and 3 of the PR).**
   - **Database ownership.** The database stays owned by the bootstrap role, and the migrator gets `CONNECT` plus `USAGE, CREATE` on both schemas. Extensions are installed by `01-schemas.sql`; a new extension is a new bootstrap file.
   - **Default privileges.** Use `ALTER DEFAULT PRIVILEGES FOR ROLE {platform_migrator | platform_definer | platform_audit_owner} REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC`, with no `IN SCHEMA`. The two `IN SCHEMA … REVOKE` lines are removed, because PostgreSQL treats them as no-ops (PG 18 docs, `ALTER DEFAULT PRIVILEGES`).
   - **Catalog checks.** C5 and C11 assert `pg_default_acl` rows with `defaclnamespace = 0`, `defaclobjtype = 'f'` for the three roles.
   - **Bootstrap-role functions.** Functions created by the bootstrap role itself must revoke `PUBLIC` explicitly.
2. **Data-model §8.3 rule 12 wording.** "Statements that mention `platform_audit_owner` count too" becomes:

   > any statement naming `platform_audit_owner` other than (a) a role-attribute assertion consisting only of `NO*` attributes, (b) `GRANT USAGE[, CREATE] ON SCHEMA … TO platform_audit_owner`, (c) `ALTER DEFAULT PRIVILEGES FOR ROLE platform_audit_owner … REVOKE …`

   This text replaces the current list `SET ROLE`, `OWNER TO`, `GRANT … TO`.
3. **Data-model §8.4 step 2.** Prisma 7.10 `migrate resolve --rolled-back` fails with P3012 on a finished migration. The test driver sets `rolled_back_at` as `platform_migrator`, the table owner, never as a superuser.
4. **ADR-0023.** Define what "CODEOWNERS" means for the security-owned paths (PR5-SEC-04): `.github/CODEOWNERS` for routing, plus a base-ref lane A check that requires a committed security review record for the PR head.

## 10. Evidence (commands, PR head `d8ba197`)

1. Ran `curl -sS --proto =https "$B/<target>/schema-engine[.exe].sha256"` and `.gz.sha256` with `B=https://binaries.prisma.sh/all_commits/d1b3f377ca835d73fd50954a5e22128b9ebdd6b8`, for `debian-openssl-3.0.x` and `windows`. The published values equal the manifest.
2. Ran `curl -sS --proto =https "$B/<target>/schema-engine[.exe].gz" | tee >(sha256sum >&2) | gunzip -c | sha256sum`, streamed with nothing written to disk:
   - debian: binary `7116e00278a793ee13db6f0a732c1aaec10f795a37bc02e3a7df3b06b2f1311f`, gz `5827f56149193f0249b2f4b8a64e60c300c3129ed6514bad0a11c340e1cffad6`;
   - windows: binary `e6c4bb89d31f39f7ac601e264c998c0382c069df8485fb8810d0ba8fa806ea4a`, gz `67ffd7d2dc94c33c2d8e687bee2ab3203f822ffcf560c11d73f06f5729c0e62d`.
3. `sha256sum node_modules/@prisma/engines/schema-engine-windows.exe` gives `e6c4bb89…ea4a`. `@prisma/engines-version` is `8.1.0-1.d1b3f377…`.
4. `sed -n 2300,2450p node_modules/@prisma/fetch-engine/dist/chunk-P3P4GYYB.js`, `grep -n "!job.envVarPath\|envVarPath && import_node_fs"`: lines 2330 and 2415. `sed -n 80,125p chunk-XNR2KDTK.js`.
5. `grep -rhoE "process\.env\.[A-Z_]+" node_modules/@prisma/{fetch-engine,get-platform}/dist`, and `grep process.env node_modules/@prisma/engines/dist/index.js`.
6. `grep -o 'xpe=require("@prisma/engines")' node_modules/prisma/build/cli.js`. The CLI's `ensureBinaries` list contains `migrate`, `db`, `generate`, `validate`, `format`, `telemetry` and `init`.
7. `node rule12-probe.mjs` (scratch). 3 forms flagged, 8 audit-weakening forms not flagged.
8. `sed -n 1,120p node_modules/pg-connection-string/index.js` (`?host=` precedence); `grep -n connectionString node_modules/pg/lib/connection-parameters.js` (line 60 merge order).
9. Supply-chain commands:
   - `git diff --quiet 4da693a d8ba197 -- package-lock.json`: unchanged.
   - `npm audit --audit-level=high`: exit 0 (0 High/Critical; 34 moderate and 1 low in dev tooling).
   - `npm audit --omit=dev`: 0.
10. Registry and closure checks:
    - `npm view elkjs@0.11.1 license` → `EPL-2.0`; `npm view elkjs dist-tags.latest license` → `0.12.1`, `EPL-2.0 OR GPL-3.0-or-later`.
    - `npm view bcrypt time --json` → 6.0.0 = 2025-05-11T18:06:24Z.
    - `npm view node-abort-controller@3.1.1 deprecated` → deprecated.
    - Lockfile-flag closure: 589 production entries, none of them `elkjs`, studio-core, prisma, `@prisma/engines` or `@prisma/fetch-engine`.
    - `npm ls elkjs --omit=dev --omit=optional` still prints the optional-peer path (note in §5).
11. `git diff 4da693a..d8ba197 | grep -E <secret patterns>`: only `client.test.ts:13` `placeholder`. `git check-ignore -v prisma/generated/prisma/client.ts`: ignored (`.gitignore:94`).
12. PostgreSQL 18 `ALTER DEFAULT PRIVILEGES` documentation (https://www.postgresql.org/docs/18/sql-alterdefaultprivileges.html), quoted in §4 item 2.

## Round 2 (head 4574a14)

| Field | Value |
|---|---|
| Delta | `d8ba197..4574a14`: 1 commit, `fix(db): review fix cycle 1 for TASK-003 (PR #5 round 1)`. 42 files, +733 / −94. Fix comment: https://github.com/sukhchdit/shipcube/pull/5#issuecomment-6825445288 |
| Re-review triggers | The password path changed (`tools/db/bootstrap.ts` and the new `tools/db/scram.ts`), and `tools/deps/prisma-engines.mjs` gained the gunzip cap. Also reviewed: `tools/db/reset.ts`, `tools/db/lint-migrations.ts` (rules 2, 10, 12 and 13), the Testcontainers harness, the new `session-safety.int.test.ts`, and the root `devDependencies` |
| Reviewer / date | security-analyst, 2026-11-12. I reviewed by SHA only (`git show`/`git diff` from the main checkout) and did not touch the `Shipqube-TASK-003` worktree, where a merge-main pass was running. I ran no install, build, Docker or test suite. To run the probes, I extracted the head sources into scratch and executed them under Node 24.22.3 type stripping, using the main checkout's `pg` 8.23.1 and `pg-connection-string` 2.14.1 |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open. **Closed:** PR5-SEC-01 (MEDIUM), PR5-SEC-02 and PR5-SEC-03 (LOW), and PR5-SEC-06 (INFO). **New this round:** PR5-SEC-11 (LOW): rule 13 misses `ALTER ROUTINE` and repeated `SET search_path` clauses. The gap was already present at `d8ba197`, so it is not a regression of the fix cycle. Also new: PR5-SEC-12 and PR5-SEC-13 (INFO). The merge rule "no Critical/High open" is met |

### R2.1 Byte-unchanged claim: CONFIRMED

`git rev-parse <sha>:<path>` returns the same blob at `d8ba197` and at `4574a14` for each file below. The bootstrap ledger hashes and the engine manifest therefore still hold.

| Path | Blob (both SHAs) |
|---|---|
| `prisma/bootstrap/00-roles.sql` | `f6766a46…` |
| `prisma/bootstrap/01-schemas.sql` | `65d22c5d…` |
| `tools/deps/prisma-engines.json` | `84774dd0…` |
| `.npmrc` | `51567959…` |
| `tools/db/sql-text.ts` | `59742561…` |
| `apps/api/src/platform/db/client.ts` | `9c0b953c…` |
| `tools/db/audit-ddl-reviewers.json` | `132c0e30…` (still empty, so rule 12 stays fail-closed) |

### R2.2 PR5-SEC-01 (MEDIUM): CLOSED

**Verifier construction (`tools/db/scram.ts`).**
- **Algorithm.** The construction is RFC 5802 / RFC 7677, in PostgreSQL's `scram_build_secret` format:
  - salted = PBKDF2-HMAC-SHA-256(password, salt, 4096, 32);
  - StoredKey = SHA-256(HMAC(salted, "Client Key"));
  - ServerKey = HMAC(salted, "Server Key");
  - the result is `SCRAM-SHA-256$4096:<salt>$<StoredKey>:<ServerKey>`.
- **Encoding.** Standard padded base64, giving 24, 44 and 44 characters. This is what `parse_scram_secret` decodes.
- **Known-answer check.** I recomputed the RFC 7677 §3 vector independently. Both `v=` (`6rri…5G4=`) and `p=` (`dHzb…dVQ=`) match. The module's StoredKey and ServerKey equal my own derivation.
- **Salt.** `randomBytes(16)` from the Node CSPRNG, fresh on every call. The probe produced two different salts, each 16 bytes after decoding. The `salt` parameter is a test seam only: the one production caller, `bootstrapVariables`, always uses the default.
- **Iterations.** The constant is 4096, which equals PostgreSQL's `scram_iterations` default (PG 16+). `scramSha256Keys` refuses anything below 4096 (the probe confirmed 4095 is refused).
- **Password floor.** At least 24 characters, all printable ASCII `0x21-0x7E`. SASLprep is the identity on that range, so libpq, node-postgres and the schema engine all derive the same keys.
  - The probe refused 23 characters, a space, a tab, DEL, non-ASCII and a lone surrogate.
  - No error message echoes the password.

**Reserved variables.**
- `bootstrapVariables` refuses `db_name` and any caller key matching `/_password$/i` before it connects. It writes the verifiers last, so they win over anything else.
- **Callers.** Every caller now uses `passwords`: `main`, `reset.ts`, the harness's `bootstrap` and clone, and the tests. No other path sends `00-roles.sql`: `git grep` finds no `psql -v` and no `initdb.d` use.
- **Unit proof.** The substituted `00-roles.sql` contains exactly two `PASSWORD 'SCRAM-SHA-256$4096:…'` literals and neither plaintext password.

**Ruling on a verifier in the server log: ACCEPTABLE. This is PostgreSQL's own practice.**
- **A literal is unavoidable.** `ALTER ROLE` is a utility statement and takes no bind parameters, so no "parameterised" path exists.
- **PostgreSQL's own tools do the same.** libpq's `PQencryptPasswordConn` / `PQchangePassword` (used by psql `\password` and `createuser`) send exactly `ALTER USER … PASSWORD 'SCRAM-SHA-256$…'`. The `CREATE ROLE` documentation recommends those tools because the cleartext then never reaches the server or its log. A pre-hashed verifier is stored as is, whatever `password_encryption` says.
- **What a log reader gains.** A logged verifier is worth the same as read access to `pg_authid` (RFC 5802 §9, RFC 7677 §4):
  - **(a) Offline guessing at 4096 PBKDF2 iterations.** Infeasible for machine-generated secrets. The harness uses 256 bits, and 24 uniform characters from 94 symbols give about 157 bits.
  - **(b) Server impersonation**, using ServerKey.
  - **(c) Client impersonation**, but only after also observing one SCRAM exchange (StoredKey plus the proof yields ClientKey).
  - (b) and (c) need a network position on an unverified connection. `sslmode=verify-full` (PR-0003 / TASK-005) and RDS `rds.force_ssl` close that at M5.
- **Conditions of this ruling (no new finding):**
  - role passwords stay machine-generated (secret manager or `randomBytes`), never human-chosen;
  - server logs keep `pg_authid`-level access control (CloudWatch at M5);
  - connections use TLS with server verification at M5.
- **Not recommended:** suppressing DDL logging for the bootstrap session (`SET log_statement = none`). pgaudit ROLE logging is an M5 audit requirement, and a verifier is safe to keep there.
- **Residual (INFO, no ID).** The floor checks length and character set, not entropy: 24 × `a` is accepted. The strength comes from generation. The TASK-014 / M5 secret generation should use `GenerateRandomPassword` with length ≥ 32 and space excluded.

**Integration test design (`prisma/tests/bootstrap/session-safety.int.test.ts`): it proves absence.**
- **Sensitivity.**
  - `-c log_statement=ddl` logs the entire simple-query text of every apply, because `ALTER ROLE` is DDL. `log_min_error_statement=error` (the PG default) logs it again as `STATEMENT:` when the appended `SELECT 1/0;` fails.
  - The two positive controls assert that both lines are present: the logged `ALTER ROLE platform_migrator … PASSWORD 'SCRAM-SHA-256$4096:` and the `STATEMENT:` line.
  - A regression to plaintext would therefore put `PASSWORD '<base64url password>'` verbatim into the captured text, with no quote doubling, and `not.toContain` would fail.
- **Completeness.**
  - The log is read up to a sentinel error raised after the run, so no late flush is missed.
  - The `pg_authid` prefix check, together with both roles logging in with the plaintext, proves the verifier is correct and not just present.
  - `log_statement=all`, `log_min_duration_statement` and pgaudit ROLE all log the same query text. The unit proof (no plaintext ever in the SQL text) plus this test therefore covers them too.
- **Optional test hardening (INFO; for whoever next touches the file):**
  - **Anchor the `STATEMENT:` control.** It uses a lazy `[\s\S]*?` starting from the first `STATEMENT:`. That is correct today, because the forced error is the first error in the container. An earlier unrelated error followed by the `LOG: statement:` line would also satisfy it. Anchor it, for example `/ERROR:\s+division by zero\n[^\n]*STATEMENT:\s+SET search_path[\s\S]*?SELECT 1\/0;/`.
  - **Prove "stored as is".** The `SCRAM-SHA-256$4096:` prefix would also appear if the server hashed the password itself (its default is 4096). Assert instead that the stored `rolpassword` equals one of the verifiers in the `LOG: statement:` text.
- **Not executed by me** (Docker was off-limits). I rely on the developer's run on `4574a14`: 5 integration suites, 28/28, including this file.

### R2.3 PR5-SEC-02 (LOW): CLOSED

**Implementation.** The bootstrap lane is now deny-by-default, as recommended in round 1.
- There are three tightening patterns. Each is anchored on the whole normalised statement: `NO*`-only `ALTER ROLE`, `GRANT USAGE|CREATE ON SCHEMA … TO` the owner, and `ALTER DEFAULT PRIVILEGES FOR ROLE` the owner `… REVOKE`.
- The creation `DO` block is pinned by the SHA-256 of its whitespace-collapsed text. The pin cannot drift, because `00-roles.sql` is immutable through the ledger. A copy of that exact block elsewhere would only create the same `NOLOGIN` roles.

**Probe results (`rule12-probe.mjs`: 38 statements, plus the real lane and the PR's fixtures):**
- **All 8 round-1 bypass forms are now flagged.**
- **20 further weakening forms are flagged:**
  - `ALTER USER` and `ALTER GROUP … ADD USER`;
  - `ALTER ROLE … SET` and `ALTER ROLE … IN DATABASE … SET`;
  - `VALID UNTIL` and `CONNECTION LIMIT`;
  - a `NOLOGIN SUPERUSER` mixed list;
  - schema grants with `WITH GRANT OPTION`, with `GRANTED BY`, and with an extra grantee;
  - a `FOR ROLE` list;
  - membership in either direction, including the quoted name;
  - `SET ROLE`, `OWNER TO` and `CREATE ROLE`;
  - a dynamic-SQL literal;
  - a creation block with an extra role;
  - `COMMENT ON ROLE` (over-strict, which is acceptable).
- **The 6 tightening forms are not flagged.**
- **Real lane and fixtures.** The real `prisma/bootstrap` gives `[]`. All 13 `audit-owner-*` bypass fixtures give `["12"]`, and `audit-owner-setup` gives `[]`.

**Residuals (INFO, no ID). These are lexical limits; the boundary is C13, C5 and C11 in TASK-016.**
- A role name built at run time in dynamic SQL (`'platform_' || 'audit_owner'`) and `U&"…\005f…"` escaped identifiers are not seen.
- `:"var"` placeholders are not seen either, but they fail closed at run time: no production caller passes `vars`, so any new variable fails with "needs variable(s)".
- Some audit weakening names neither the owner nor an audit object, for example `GRANT pg_write_all_data TO platform_app`. Predefined-role privileges do not appear in object ACLs, so the C5 grant manifest cannot see them. **This is added to PR5-SEC-09:** the post-bootstrap membership assertion must cover every `pg_auth_members` row whose `member` is a `platform_%` role, predefined `pg_*` roles included.
- **Optional hardening for TASK-016.** In the bootstrap lane, require the marker for any `DO` or `EXECUTE` outside the pinned creation block, and refuse `U&"` identifiers.

### R2.4 PR5-SEC-03 (LOW): CLOSED

**Implementation (`effectiveEndpoint` / `resetTarget`):**
- Only `postgres:` and `postgresql:` schemes are accepted.
- `host` and `hostaddr` query parameters are refused case-insensitively, after `URLSearchParams` has decoded the keys.
- The URL is parsed with `pg-connection-string`, the parser `pg` itself uses, and an empty host is refused.
- **Loopback** means `localhost`, `::1`, a `127.x.x.x` dotted quad, or a Unix-socket path.
- `DATABASE_MIGRATOR_URL` must resolve to the same host, port and database.
- Messages echo at most the host, never the URL.

**Differential probe (`reset-probe.mjs`, 23 URLs).** For every URL the guard accepts, `new pg.Client({ connectionString })` resolves the same host, port and database, and that host is loopback or a socket.

| Result | URLs |
|---|---|
| Refused | `?host=`, `?%68ost=`, `?HOST=`, `?hostaddr=`, `localhost@db.example.com`, `127.0.0.1.nip.io`, `127.1`, `localhost%2fdb…`, a comma multi-host, `[::ffff:127.0.0.1]`, `0.0.0.0`, an empty host |
| Accepted, guard and `pg` agree | `?port=6543` (both 6543); `?database=other` (both ignore it, the pathname wins); `%6cocalhost`; `[::1]`; a socket path; a fragment; `pg-connection-string`'s `encodeURI` pre-processing path (a space plus `%2568ost` is not `host` for either) |

**Residuals (INFO, no ID; this is an accident-prevention guard):**
- If neither URL names a port, `PGPORT` applies to both. They then still resolve identically, to the same loopback host.
- A Unix-socket path is trusted as local.
- The resolution of `localhost` is trusted.

### R2.5 PR5-SEC-06 (INFO): CLOSED

- **The cap.** `gunzipSync(gz, { maxOutputLength: MAX_BINARY_BYTES })`, with 256 MiB.
- **Overflow throws; it does not truncate.** On Node 24.22.3 I inflated an 8 KB gzip of 8 MiB of zeros:
  - with a 1 MiB cap it throws `RangeError ERR_BUFFER_TOO_LARGE`;
  - exactly at the cap it succeeds.

  The error maps to `cannot gunzip`, and the existing cleanup removes the file.
- **The seam is reachable only through function parameters.** `rebuild.mjs` and `prisma-cli.mjs` do not pass `maxBinaryBytes`, and the module CLI `run(argv, seams)` receives seams only from tests. No environment or configuration value can set it.
- **Memory bound.** At most 128 MiB of gzip input plus 256 MiB of output.
- **Test.** The new test includes a positive control at exactly the cap.

### R2.6 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location (head) | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR5-SEC-11 | Rule 13 misses `ALTER ROUTINE`, and it accepts a SECURITY DEFINER routine whose fixed `SET search_path` is followed by a second `SET search_path`, where the last one wins | LOW | CWE-184, CWE-426 | A08 | `tools/db/lint-migrations.ts:175-187` (`definerWithoutFixedPath`) | TASK-016 (owner of the linter batch and C11); optional in this PR | Open |
| PR5-SEC-12 | The bootstrap secret-variable protection is name-based (`*_password`). A future `:'password'`, `:'x_secret'` or literal `PASSWORD '…'` would bypass the verifier path | INFO | CWE-312 | A04 | `tools/db/bootstrap.ts` `bootstrapVariables`; `tools/db/lint-migrations.ts` `lintBootstrap` | TASK-016 (linter) | Open (note) |
| PR5-SEC-13 | `db:reset` spawns `migrate deploy` with the full environment, so the Prisma CLI and the schema engine receive the cluster-admin `DATABASE_BOOTSTRAP_URL` and the role passwords | INFO | CWE-526 | A05 | `tools/db/reset.ts:98-104` | TASK-034 (db tooling), or the next touch of `reset.ts` | Open (note) |

#### PR5-SEC-11: rule 13 misses `ALTER ROUTINE` and repeated `SET search_path` (LOW)

**Description.**
- **`ALTER ROUTINE` is not checked.** `definerWithoutFixedPath` matches `^alter (function|procedure)` only. PostgreSQL 11+ `ALTER ROUTINE` accepts the same actions, so these three statements all pass:
  - `ALTER ROUTINE platform.f() SECURITY DEFINER`;
  - `ALTER ROUTINE … SET search_path = public`;
  - `ALTER ROUTINE … RESET ALL`.
- **Only the first `SET search_path` is checked.** `FIXED_PATH` needs one matching clause anywhere, but PostgreSQL applies the SET items left to right. The PG 18 `functioncmds.c` comment on `compute_function_attributes` reads: "We don't try to detect duplicate SET parameters though --- if you're redundant, the last one wins". `update_proconfig_value` then calls `GUCArrayAdd`, which replaces the earlier entry.
  - So `… SECURITY DEFINER SET search_path = pg_catalog, pg_temp SET search_path = public AS …` creates a definer function with `proconfig = {search_path=public}`, and it passes rule 13.
  - The same applies to `SET search_path FROM CURRENT` as the second clause, and to `ALTER FUNCTION` with two SET clauses.
- **Probe.** `rule13-probe.mjs` found 6 misses; all 7 controls behaved correctly.
- **Not a regression.** The round-1 header-split code had the same logic, so these gaps pre-date the fix cycle. My round-1 review missed them.

**Exploitability and impact.**
- **The risk.** A definer function that resolves names through the migrator-writable `public` is the CVE-2018-1058 class (CWE-426): code planted by the migrator runs with the definer's (or the audit owner's) rights.
- **The boundary.** C11's `proconfig` assertion (exactly one `search_path` entry, equal to `pg_catalog, pg_temp`) catches both forms. It arrives in TASK-016.
- **Exposure today.** No definer function exists yet.
- **Severity.** Impact M (an early-warning layer is degraded) × likelihood L = **LOW**, the same rating as PR5-SEC-02.

**Remediation (code level).**

```ts
function definerWithoutFixedPath(statement: string): boolean {
  const text = codeOnly(statement);
  const pathSets = text.match(/\bset search_path\b/g)?.length ?? 0;
  const fixedOnly = pathSets === 1 && FIXED_PATH.test(`${text};`); // exactly one SET, and it is the fixed one
  if (/^create (or replace )?(function|procedure)\b/.test(text)) {
    return /\bsecurity definer\b/.test(text) && !fixedOnly;
  }
  if (/^alter (function|procedure|routine)\b/.test(text)) {
    if (/\bsecurity definer\b/.test(text)) return true;
    if (/\b(reset search_path|reset all)\b/.test(text)) return true;
    return pathSets > 0 && !fixedOnly;
  }
  return false;
}
```

**Verification.**
- Add fixtures `migrations/definer-duplicate-set`, `definer-set-from-current`, `alter-routine-definer`, `alter-routine-set` and `alter-function-duplicate-set`. Each must report rule `13`.
- `definer-after-body` and the valid fixtures keep `[]`.

#### PR5-SEC-12: name-based secret variables (INFO)

**Description.**
- `bootstrapVariables` refuses only `db_name` and `*_password`.
- A future bootstrap file could use `:'password'` or `:'readonly_secret'`, or hard-code `PASSWORD '…'`. It would bypass the SCRAM path, and the plaintext would reach the server log again.

**Exposure.** None today. No production caller passes `vars`, so any new variable fails with "needs variable(s)".

**Remediation.** Add two checks to `lintBootstrap`:
1. The lane may reference only `db_name`, `migrator_password` and `app_password`. Check this with `referencedVariables`.
2. Every `PASSWORD` keyword in code (use `codeOnly`) must be followed by `:'migrator_password'`, `:'app_password'` or `NULL`.

Add one fixture per check.

#### PR5-SEC-13: the reset child inherits the cluster-admin credential (INFO)

**Description.**
- `main` passes `env` unchanged to `prisma-cli.mjs migrate deploy`.
- `prisma.config.ts` reads only `DATABASE_MIGRATOR_URL`, so the bootstrap credential is not misused today. It is still available to the Prisma CLI, to the schema engine, and to any future config change.

**Remediation.** Filter the child environment to least privilege (CLAUDE.md §9):

```ts
env: Object.fromEntries(Object.entries(env).filter(([k]) => !/^(DATABASE_BOOTSTRAP_URL|BOOTSTRAP_(MIGRATOR|APP)_PASSWORD(_FILE)?)$/.test(k)))
```

**Verification.** A unit test through a spawn seam asserts that the child environment holds none of those names.

### R2.7 Other delta items

- **CR m6 timeouts.**
  - `SET lock_timeout = ${lockTimeoutMs}` interpolates a value already validated as a positive integer.
  - `statement_timeout` and `'60s'` are constants.
  - `connectionTimeoutMillis` can be overridden only by the caller's own `connection`.
  - No injection surface.
- **Rules 2 and 10 now match code only.** Quoted identifiers stay visible, because they are not blanked. A data change inside a `DO` body was not seen before either: `^do` never matched. No regression.
- **Rule 13 code-only matching.** `SECURITY DEFINER` and `SET` after the body are now checked, and body text no longer counts. Over-strictness is fail-safe: `SET search_path = 'pg_catalog, pg_temp'` as a string is flagged. The remaining gaps are in PR5-SEC-11.
- **Supply chain.**
  - **Lockfile.** A deep JSON diff of the base and head `package-lock.json` found exactly 3 differing paths, all under `packages[""].devDependencies` (`@types/pg`, `pg`, `pg-connection-string`). The positive control was detected. Both sides have 1,559 entries, and no `resolved`/`integrity` value changed. The three packages were already locked (`pg` and `pg-connection-string` as production entries, through `apps/api`). All three are MIT and come from registry tarballs.
  - **Registry dates.** `pg` 8.23.1 was published 2026-09-30, `pg-connection-string` 2.14.1 on 2026-09-30, and `@types/pg` 8.23.1 on 2026-08-17. All are past `min-release-age`, maintained, and on the LICENSE_ALLOWLIST.
  - **Audit.** I did not re-run `npm audit`. The resolved set is identical to round 1 (0 High/Critical; `--omit=dev` 0). The developer's run on `4574a14` exits 0 at `--audit-level=high`.
- **Secrets.** A grep of the delta found only per-run random values (`randomBytes(32).toString('base64url')`) and test-only literals: the `scram.test.ts` `strong` constant, and the fixture `'x'` and placeholders. None is a real credential. gitleaks was not run (Docker was off-limits); TASK-007 lane A covers it.

### R2.8 Finding status after round 2

| ID | Severity | Status | Owner / due |
|---|---|---|---|
| PR5-SEC-01 | MEDIUM | **Closed** (R2.2) | n/a |
| PR5-SEC-02 | LOW | **Closed** (R2.3); lexical residuals are notes | TASK-016 (optional hardening) |
| PR5-SEC-03 | LOW | **Closed** (R2.4) | n/a |
| PR5-SEC-04 | LOW | Open | TASK-007 (CODEOWNERS and `check-security-owned-paths`) |
| PR5-SEC-05 | INFO | Open (note) | principal-architect; COND-G4-PROD |
| PR5-SEC-06 | INFO | **Closed** (R2.5) | n/a |
| PR5-SEC-07 | INFO | Open (note) | The fix comment routes it to TASK-006. Keep the workflow-policy half on **TASK-007**. The `prismaChildEnv` `NODE_OPTIONS` hardening goes with the next task that touches `tools/deps` |
| PR5-SEC-08 | INFO | Open (note) | TASK-006 (`toPoolConfig` allow-list) |
| PR5-SEC-09 | INFO | Open (note); **extended**: the membership assertion includes predefined `pg_*` roles (R2.3) | TASK-016, TASK-034, SPK-08 |
| PR5-SEC-10 | INFO | Open (note) | qa-lead (SEC-FU-QA) |
| PR5-SEC-11 | LOW | **New**, Open | TASK-016 (before the first `SECURITY DEFINER` migration); optional now |
| PR5-SEC-12 | INFO | **New**, Open (note) | TASK-016 |
| PR5-SEC-13 | INFO | **New**, Open (note) | TASK-034, or the next touch of `reset.ts` |

### R2.9 Evidence (head `4574a14`)

Scratch directory: `…/scratchpad/review/PR-5-sec-r2/`.
1. `git fetch -q origin`. Then `git log --oneline d8ba197..4574a14` (1 commit) and `git diff --stat d8ba197..4574a14`.
2. `git rev-parse d8ba197:<path>` and `git rev-parse 4574a14:<path>` for the 7 paths in R2.1: all identical.
3. Sources extracted with `git show 4574a14:<file>`, and the lane and fixtures with `git archive 4574a14 prisma/bootstrap tools/db/fixtures/lint/bootstrap`. `prep.mjs` rewrote the relative `.js` imports to `.ts` and pointed `pg` / `pg-connection-string` at the main checkout's `node_modules` by file URL.
4. `node rule12-probe.mjs`: 38/38 as expected. Real lane `[]`. 13 bypass fixtures `["12"]`; `audit-owner-setup` `[]`.
5. `node rule13-probe.mjs`: 7 controls OK and 6 misses (PR5-SEC-11). The PostgreSQL REL_18_STABLE `src/backend/commands/functioncmds.c` source (`compute_common_attribute`, `update_proconfig_value`, `AlterFunction`) confirms that the last SET wins.
6. `node reset-probe.mjs`: 23 URLs. No URL was accepted with an inconsistent or non-loopback endpoint.
7. `node scram-probe.mjs`: RFC 7677 `v=` and `p=` match; the module equals the independent derivation; format, fresh 16-byte salt and floor and charset boundaries hold; no error echoes the password; 4095 iterations refused.
8. `node -e` zlib check: `maxOutputLength` overflow throws `RangeError ERR_BUFFER_TOO_LARGE`, and exactly at the cap succeeds.
9. `node lockdiff.mjs lock-base.json lock-head.json`: 3 paths, all root `devDependencies`; control detected. Then `npm view pg@8.23.1 license time.modified` and `npm view {pg,pg-connection-string,@types/pg} time`.
10. `git diff d8ba197..4574a14 | grep` for secret-shaped additions: random per-run values and test-only literals only. `git grep "initdb\.d|psql .*-v|00-roles\.sql"`: no other consumer of `00-roles.sql`.
