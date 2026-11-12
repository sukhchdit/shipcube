# PR-0013 / TASK-023: change-scoped security review (reference and demo seed framework)

| Field | Value |
|---|---|
| PR | #13 `feat(seed): idempotent reference and demo seed framework (TASK-023)`, https://github.com/sukhchdit/shipcube/pull/13 |
| Branch | `feat/TASK-023-idempotent-reference-demo-seed-framework` (merge-base with `main`: `31303f2`). Task commits `65d059a`, `e1b4f8a`, `6fcdaaf`, `cfaa51d`, `44d7674`, `ffc5999`, `fa3d848`; docs-only merges `c06c4d6`, `e92cd6f`. 34 files, +2,793 / −2 outside `docs/` |
| Head | e92cd6fb94496e6b20c5c970f7e212f381c34da1 |
| Scope | `prisma/seed/**` (CLI `index.ts`, `framework/{contracts,sql,validate,hash,runner,version-store}.ts`, `reference/authz-parity-step.ts`, `demo/{app-env,credential-plan,run-demo-seed,users,deferred-provisioner}.ts`); migration `20261112030000_reference_dataset_versions` (+ `down.sql`); `prisma/schema/platform.prisma`; root scripts `db:seed`, `db:seed:demo`; `prisma/package.json` workspace links; tests (unit, `prisma/tests/seed/seed.int.test.ts`) |
| Dependencies | Lockfile delta verified with `git diff --text`: exactly `+@platform/authz`, `+@platform/config` under the `prisma` workspace. No third-party package, no version, integrity or install-script change. `@platform/config`'s closure is `joi` + `zod` + `node:*` (no AWS SDK) |
| Binding items checked | ADR-0018 am. 6 (tooling set, `_FILE` register exception, readSecret parity), am. 8 / D-ARCH-061 (ECS second signal), D-ARCH-052, D-ARCH-060 (seed never writes authz tables), D-SEC-PR8-01 (rule 10), SEC-P3-14 / T-23 (seeded staff), SEC-P3-34 (privileged session `search_path`), PR3-SEC-14 (tooling credential validation), data-model §3.5, §4.4, §9.1–§9.3, D-TASK023-01, D-ORCH-015, merge rule D-ORCH-004 |
| Reviewer / date | security-analyst, 2026-11-13. Read-only: no command was run in the worktree; sources were taken with `git archive e92cd6f` from the main checkout and type-stripped into scratch, with a scratch junction to the worktree's `node_modules` (removed afterwards). No install, build, Docker or suite run (memory-constrained host). |

## 1. Summary

The core controls hold under independent probing:

- **SQL construction.** Every identifier that reaches SQL text passes `^[a-z_][a-z0-9_]*$` twice (`validateDataset`, then the renderer's own `ident()`), and is double-quoted. Row values never enter SQL text: each chunk is one statement with two bound parameters (actor UUID, one `jsonb` array) expanded by `pg_catalog.jsonb_populate_recordset(NULL::<table>, $2::jsonb)`. A 50,000-run fast-check fuzz of arbitrary binary strings found no rendered identifier outside `[a-z_][a-z0-9_]*`; quotes, `;`, newline suffixes, Cyrillic look-alikes and upper case are refused by both layers (§2 P-C). **There is no SQL-injection path from dataset definitions**, which are code constants in any case.
- **Demo credentials.** The plan is decided before the database URL is even read. Production skips the demo seed; staging and production refuse any present `SEED_*` password (D-TASK023-02, stricter than US-049); local/test require both variables at 12–128 characters, refuse placeholders, and accept `local-only-*` only in `local`. `NODE_ENV=production` with `APP_ENV` local/test is refused. Refusals print `code` + `subjects` only. Passwords stay in `Secret` until the provisioner port.
- **No secret output.** Six real failure modes of `pg` 8.23.1 (refused, DNS failure, invalid IPv6 URL, malformed `%`, percent-encoded password, libpq key/value DSN) print neither the raw nor the decoded password; the URL redaction works for same-realm and cross-realm (`vm`) errors (§2 P-A, P-D).
- **Authz tables.** The parity step issues three `SELECT`s only; the integration test compares `id:xmin` of all three tables before and after a run, and drift raises `SEED_AUTHZ_DRIFT` inside the transaction so the run rolls back. Because datasets run before steps in the same transaction, the parity step also backstops a future dataset that targets an authz table with non-catalogue content.
- **Transaction and lock.** One `pg.Client` (not a pool), `BEGIN` → `pg_advisory_xact_lock($1::int8)` → datasets → steps → `COMMIT`, `ROLLBACK` on any error; statement and idle-in-transaction timeouts 120 s.
- **Migration.** `CREATE TABLE` + unique index + one explicit `GRANT`; no DML, so `data-changing: no` is correct under D-SEC-PR8-01. No default-privilege rule adds table grants (bootstrap `01-schemas.sql` only revokes function `EXECUTE`), so the effective `platform_app` privilege set is exactly `SELECT, INSERT, UPDATE`, as data-model §4.4 prescribes.
- **Synthetic data only.** Demo users are on RFC 2606 `.example` domains; the integration fixture is `Probe N` / `P00000` rows on test-only probe tables; every test password and URL password is generated at run time with `randomBytes`. Nothing derives from the legacy backup (CLAUDE.md §5).

The four LOW findings are parity and least-privilege gaps around these controls; none is exploitable today without control of the seed job's environment or a prior compromise of `platform_app`:

- **01:** the CLI copies the **un-hardened** `readSecret` and adds `DATABASE_MIGRATOR_URL_FILE`, a `_FILE` variant ADR-0018 am. 6 does not admit (register exception: the two bootstrap passwords, holder `bootstrap`, only).
- **02:** the seed's environment decision keys on `APP_ENV` alone; it lacks the ECS task-metadata second signal (ADR-0018 am. 8) that `loadConfig` applies. Proven: `APP_ENV=local` on an ECS-signalled environment yields `seeded-passwords` with `local-only-*` defaults. Latent until TASK-089 replaces the non-writing provisioner, after which this is the T-23 path.
- **03:** the privileged migrator session's `search_path` pin and timeouts are silently overridden by URL query parameters (`?options=`, `?statement_timeout=0`, `?host=`), and no TLS posture is enforced. `tools/db/bootstrap.ts` refuses `?options=` and asserts `SHOW search_path`; the seed does neither.
- **04:** `platform_app` may `INSERT`/`UPDATE` every row of a SYSTEM table without RLS that no runtime code writes yet. A compromised app can suppress future `CONFIG_CHANGE` entries (the content hash is computable from the public repository) or block every later seed run (`version` set to 2³¹−1 makes `version + 1` overflow). It matches the approved §4.4 matrix, so this is a design item for principal-architect, not a PR defect.

**Overall: no Critical or High finding; D-ORCH-004 merge rule met.** 4 LOW, 4 INFO. 01, 02 and 03 are each a few lines in this PR's own code and are **recommended for this PR's fix cycle**; if not taken here they become the binding conditions in §6.

## 2. Method

| Probe (scratch, session-scoped) | What it did | Result |
|---|---|---|
| **P-A** `probe-cli.mjs` | `main()` of the stripped CLI with injected env and output, against `127.0.0.1:1` (nothing listens) | `demo` + `APP_ENV=local` + `ECS_CONTAINER_METADATA_URI_V4` + `local-only-*` defaults → **exit 2 `ECONNREFUSED`** (it went on to connect), plan `seeded-passwords` (2 secrets); `localAppEnvOnEcsGuard` for the same input → `appEnv.ecsTask` refusal. Control: same env + `NODE_ENV=production` → exit 1 `SEED_ENVIRONMENT_INVALID`. 6 real URL failure modes: password never printed. `DATABASE_MIGRATOR_URL_FILE` → a temp file outside `/run/secrets` is read and used; with both `NAME` and `NAME_FILE` set, `NAME` wins silently; an 8 MiB file is read whole (no cap); a missing file prints its **path** (`ENOENT … open 'C:\…\missing-secret'`) |
| **P-B** `probe-pg-options.mjs` | The CLI's exact `pg.Client` config over URL variants, read from `client.connectionParameters` (no connection) | Control: `options = -c search_path=pg_catalog,pg_temp`, `statement_timeout 120000`, `ssl false`. `?options=-c search_path=public,pg_catalog` → **pin replaced**; `?statement_timeout=0` → **"0"**; `?host=/tmp` → Unix socket; `?sslmode=disable` and no `sslmode` → plaintext; `require`/`verify-full` → `ssl {}` (pg 8.23.1 aliases to verify-full) |
| **P-C** `probe-sql.mjs` | Identifier guard and renderers: 12 hostile datasets through `renderUpsert` and `validateDataset`; fast-check 50k binary strings as a column; JSON-only value binding | Control renders and validates. Every hostile identifier refused by both layers. `public.t.extra` **renders** as `"public"."t"` when the renderer is called alone (validate refuses it). `public.role_permissions` and `public.reference_dataset_versions` are **accepted** as dataset targets. Fuzz: 242 accepted, all `[a-z_][a-z0-9_]*`. A value `x'); DROP TABLE t; --` stays in the JSON parameter |
| **P-D** `probe-redact.mjs` | `pg.Client.prototype.connect` stubbed to reject with crafted errors | Full URL in message → `[redacted]` (positive control); cross-realm `vm` error → `[redacted]`; **password component alone → printed** (synthetic: no real pg path produces it, see P-A) |
| Source review | All added sources and tests, the migration and `down.sql`, `packages/config` guards, file provider and placeholders, `tools/db/bootstrap.ts` at the head and at PR #11 `5ed304a`, PR #11's `grants.manifest`, table-class manifests and ESLint scopes | — |
| Secrets | Added lines (excluding `docs/`, `.claude/`, lockfile) grepped for key, token, high-entropy and `scheme://user:pw@` shapes; positive control matched | Only templates with run-time `randomBytes` passwords and placeholder test vectors. gitleaks not run (Docker off-limits); lane A covers the merge |

**Not executed:** the PostgreSQL integration suite. I rely on the PR body's serial gates (integration 8 suites / 68 passed at run 1, `seed.int.test.ts` 17/17 at run 3, coverage 99.53 % lines / 97.73 % branches, lint/typecheck/build/audit clean).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR13-SEC-01 | Copied `readSecret` is below the ADR-0018 am. 6 / D-ARCH-052 bar, and `DATABASE_MIGRATOR_URL_FILE` is an unregistered `_FILE` variant | LOW | CWE-73, CWE-59, CWE-400, CWE-209 | A05 | `prisma/seed/index.ts:47-57, 113` | TASK-023 (this PR) | Open |
| PR13-SEC-02 | Seed environment decision lacks the ECS task-metadata second signal: `APP_ENV=local` on ECS accepts `local-only-*` demo passwords | LOW (latent until TASK-089) | CWE-1188, CWE-1392 | A07 | `prisma/seed/demo/app-env.ts:12-19`; `prisma/seed/demo/credential-plan.ts:32-43`; `prisma/seed/index.ts:109-111` | TASK-023 (this PR); else TASK-089 merge condition | Open |
| PR13-SEC-03 | Migrator session pin and timeouts are overridable from the URL; no TLS posture; no `SHOW search_path` assertion (parity with `bootstrap.ts`) | LOW | CWE-426, CWE-319 | A05 | `prisma/seed/index.ts:22-25, 76-91` | TASK-023 (this PR); TLS half TASK-014 (PR3-SEC-14) | Open |
| PR13-SEC-04 | `platform_app` holds `INSERT, UPDATE` on all rows of `reference_dataset_versions` (SYSTEM, no RLS) with no runtime writer yet: CONFIG_CHANGE suppression and seed DoS by a compromised app | LOW | CWE-732, CWE-269 | A01 | `prisma/migrations/20261112030000_reference_dataset_versions/migration.sql:31`; `prisma/seed/framework/version-store.ts:36-50`; data-model §4.4 | principal-architect (data-architect) before TASK-221 | Open |
| PR13-SEC-05 | Dataset target table is not restricted (authz, version, audit or tenant tables accepted); renderer ignores a third name segment | INFO | CWE-284 | A04 | `prisma/seed/framework/validate.ts:5, 25`; `prisma/seed/framework/sql.ts:18-22` | TASK-023 (optional) or TASK-026 (first dataset) | Open |
| PR13-SEC-06 | Drift restoration of audited datasets is silent (info log only, no CONFIG_CHANGE or security event); production writes outside the migration backup guardrail | INFO | CWE-778 | A09 | `prisma/seed/framework/runner.ts:74-96` | TASK-025 / TASK-221; TASK-014 (ordering) | Open |
| PR13-SEC-07 | Redaction covers the full URL string only (not the password component, not `SEED_*` values); README says no `SEED_*` value is read in staging/production | INFO | CWE-532 | A09 | `prisma/seed/index.ts:95-98, 107-114`; `prisma/README.md` "Seeding" | TASK-023 (optional); TASK-089 (provisioner errors) | Open |
| PR13-SEC-08 | Checks owed by later tasks (TASK-089 set-password links and provisioner, TASK-221 re-baseline after `down.sql`, TASK-014 seed one-shot, TASK-025 audit writer role) | INFO | various | various | see item | as listed | Open |

### PR13-SEC-01 (LOW): copied `readSecret` and an unregistered `_FILE` variant

**Description.** `prisma/seed/index.ts:51-57` is a verbatim copy of the pre-TASK-016 `tools/db/bootstrap.ts#readSecret`:

```ts
const file = env[`${name}_FILE`];
if (file !== undefined && file !== '') return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
```

ADR-0018 am. 6 makes `DATABASE_MIGRATOR_URL` a **direct value** and admits the `<NAME>_FILE` idiom as a "register exception, holder `bootstrap` only" for the two bootstrap passwords; it also binds every `_FILE` reader to the file-provider bar (path lexically under `/run/secrets`, realpath confinement, regular file, ≤ 64 KiB, exactly one of `NAME`/`NAME_FILE`, errors name the variable, never the path or the value). PR #11 (`5ed304a`, `bootstrap.ts:281-319`) brings `bootstrap.ts` to that bar; this copy is not touched by it and diverges once #11 merges. P-A confirmed:
- any path is read (outside `/run/secrets`; symlinks followed);
- no size cap (8 MiB read whole) and no regular-file check (a FIFO or character device would block or exhaust memory on Linux);
- `NAME` and `NAME_FILE` both set → `NAME` silently wins;
- a read error prints the path in `seed.failed`.

**Exploitability / impact.** Requires control of the seed job's environment, which already implies broad compromise; the practical risks are a hung or OOM-killed deploy step and an ADR-0018 conformance gap in a process holding the database-owner credential. Impact Low × Likelihood Low.

**Remediation (recommended: option A, this PR).**
- **A. Drop the `_FILE` variant**, which ADR-0018 does not admit for this key. Compose already delivers the migrator URL as a direct value (D-ARCH-052).

  ```ts
  function readMigratorUrl(env: NodeJS.ProcessEnv): string {
    if ((env['DATABASE_MIGRATOR_URL_FILE'] ?? '') !== '') {
      throw new SeedRefusedError('SEED_ENVIRONMENT_INVALID', ['DATABASE_MIGRATOR_URL_FILE'],
        'Seed refused: DATABASE_MIGRATOR_URL_FILE is not supported (ADR-0018 am. 6); set DATABASE_MIGRATOR_URL.');
    }
    const url = env['DATABASE_MIGRATOR_URL'] ?? '';
    if (url === '') throw new SeedRefusedError('SEED_VARIABLE_MISSING', ['DATABASE_MIGRATOR_URL'], 'Seed refused: DATABASE_MIGRATOR_URL is not set.');
    return url;
  }
  ```
  Update the README ("`DATABASE_MIGRATOR_URL` or `..._FILE`") and D-TASK023-01 item 05.
- **B.** If `_FILE` is wanted: principal-architect extends the am. 6 register exception to the seed holder, and the hardened reader moves to a module both `tools/db` and `prisma/seed` may import (or the copy carries PR #11's full rule set and test list, including the open-once refinement PR11-SEC-11 d).

**Verification.** Unit: `DATABASE_MIGRATOR_URL_FILE` set (with or without `DATABASE_MIGRATOR_URL`) → exit 1, `subjects: ['DATABASE_MIGRATOR_URL_FILE']`, no file read (point it at a path whose read would throw and assert the code is a refusal, not exit 2). Replace the `_FILE` case in `cli.test.ts`.

### PR13-SEC-02 (LOW, latent until TASK-089): no ECS second signal for `APP_ENV` local/test

**Description.** `parseAppEnv` accepts any of the four values and `planDemoCredentials` keys every decision on it; the only cross-check is `NODE_ENV=production` with local/test. ADR-0018 am. 8 (D-ARCH-061) adopted a second signal precisely for this misconfiguration: `APP_ENV ∈ {local, test}` is refused when `ECS_CONTAINER_METADATA_URI` / `_V4` is present and non-empty, because those values unlock "Mock adapters, plain transport, `local-only-*` keys" (`packages/config/src/guards.ts:175-182`). `loadConfig` applies it to api/worker; the seed CLI, which is the one process that turns `local-only-*` values into user passwords, does not. P-A: an ECS-signalled environment with `APP_ENV=local` and `local-only-*` defaults produces `seeded-passwords` and proceeds to connect.

**Exploitability / impact.** Today `DEFERRED_PROVISIONER` writes nothing, so there is no impact at this head. Once TASK-089 wires the identity-backed provisioner, the same misconfiguration (APP_ENV mis-set on a deployed task + compose-style `SEED_*` values + `db:seed:demo`) creates the 8 operator staff, including Super Admin, with known default passwords in a real environment: threat T-23 (seeded staff hijack), which SEC-P3-14 reduced only on the premise "defaults refused outside local". The `NODE_ENV` cross-check helps only if the seed runs in an image that sets `NODE_ENV=production`; the seed runs via `tsx` from sources, so it may run in a tooling image that does not. Impact when live: Critical; Likelihood: Low. That is HIGH-class by the threat-model matrix once the provisioner writes, hence the hard condition below.

**Remediation (this PR, about 6 lines; both commands).**

```ts
import { ECS_METADATA_KEYS, isLocalAppEnv } from '@platform/config';

export function assertNotLocalOnEcs(appEnv: AppEnv, env: Readonly<Record<string, string | undefined>>): void {
  const signals = ECS_METADATA_KEYS.filter((key) => (env[key] ?? '') !== '');
  if (isLocalAppEnv(appEnv) && signals.length > 0) {
    throw new SeedRefusedError('SEED_ENVIRONMENT_INVALID', ['APP_ENV', ...signals],
      `Seed refused: APP_ENV=${appEnv} is not allowed on an ECS task.`);
  }
}
// main(): const appEnv = parseAppEnv(env['APP_ENV']); assertNotLocalOnEcs(appEnv, env); …
```

Optionally add the third signal `AWS_EXECUTION_ENV` starting with `AWS_ECS_` (ADR-0018 am. 8, optional).

**Verification.** Unit table {local, test} × {`_URI`, `_V4`, both, empty string} → refusal for every non-empty case, none for empty; staging/production unaffected. CLI test: exit 1 with `SEED_ENVIRONMENT_INVALID` and no `ECONNREFUSED` line for an unreachable URL (refused before connecting). **If not fixed here, TASK-089 may not replace `DEFERRED_PROVISIONER` until this test exists.**

### PR13-SEC-03 (LOW): the privileged session pin is overridable from the URL

**Description.** `withMigratorConnection` passes `options: '-c search_path=pg_catalog,pg_temp'`, `statement_timeout` and `idle_in_transaction_session_timeout` next to `connectionString`. In `pg` 8.23.1 / `pg-connection-string` 2.14.1 the URL's query parameters override the explicit config (P-B): `?options=…` replaces the pin, `?statement_timeout=0` removes the timeout, `?host=` redirects to another host or a Unix socket. No `ssl` is set, so TLS is whatever the URL says, and plaintext is the default. `tools/db/bootstrap.ts:132-143` (head) refuses `?options=` and asserts `SHOW search_path` after connecting (SEC-P3-34 item 2); the seed cites the same item but implements neither.

**Exploitability / impact.** The URL is operator configuration, so the attacker must be able to edit the migrator secret. With the pin gone and `public` placed before `pg_catalog`, the seed's unqualified operators and functions (`decode`, `=`, `+`, `||`, `IS DISTINCT FROM`) resolve to objects planted in `public` by any role with `CREATE` there (`platform_migrator`, `platform_audit_owner`) and run as the database owner. Impact Medium × Likelihood Low. The reference seed runs in staging and production with the owner credential, so the TLS half matters at M5.

**Remediation (this PR).**

```ts
const FORBIDDEN_URL_PARAMS = /[?&](options|host|hostaddr|statement_timeout|idle_in_transaction_session_timeout|search_path)=/i;
if (FORBIDDEN_URL_PARAMS.test(connectionString)) {
  throw new SeedRefusedError('SEED_ENVIRONMENT_INVALID', ['DATABASE_MIGRATOR_URL'], 'Seed refused: DATABASE_MIGRATOR_URL carries a session-overriding parameter.');
}
// after client.connect():
const { rows } = await client.query<{ search_path: string }>('SHOW search_path');
if (rows[0]?.search_path.replace(/\s+/g, '') !== 'pg_catalog,pg_temp') {
  await client.end();
  throw new Error('seed session search_path is not pinned');
}
```

An allow-list (the `POSTGRES_URL_PARAMS` set of `packages/config/src/guards.ts`) is stronger than the deny-list above and is preferred. TLS: in `APP_ENV ∈ {staging, production}` require `sslmode=verify-full` through the `checkToolingEnv` helper owed by TASK-014 (PR3-SEC-14); the seed CLI must be one of its callers.

**Verification.** Unit on the connection builder: `?options=`, `?host=`, `?statement_timeout=0` → exit 1 naming `DATABASE_MIGRATOR_URL`, value never printed. Integration: with `ALTER ROLE platform_migrator SET search_path = public` on the test database the seed still reports a pinned path; a stubbed `SHOW` result other than `pg_catalog, pg_temp` → refusal.

### PR13-SEC-04 (LOW): `platform_app` write grant on `reference_dataset_versions`

**Description.** The migration grants `platform_app` `SELECT, INSERT, UPDATE`, exactly as data-model §4.4 ("Other SYSTEM … `reference_dataset_versions` … `SELECT, INSERT, UPDATE`"). But the only writer in this PR is the seed, which connects as `platform_migrator` (the owner), and the only planned runtime writer is TASK-221's reconciler for the single row `dataset = 'authz_matrix'`. The table is SYSTEM, so there is no RLS, and the grant covers every row and column.

**Exploitability / impact** (requires SQL-level control of `platform_app`, for example an injection that slips past Prisma parameterisation, or code execution in api/worker):
- **Audit suppression.** `content_sha256` is the SHA-256 of `canonicalDataset()`, which is computable from the public repository. An attacker pre-writes the next release's `(dataset_version, content_sha256)` for an audited dataset (compliance pack, pricing version). The seed then sees `versionChanged = false` and emits no `CONFIG_CHANGE` (REQ-COMP-008 / O4). The rows themselves are still upserted correctly.
- **Persistent seed DoS.** `UPDATE … SET version = 2147483647, dataset_version = 'x'` makes the next run take the record path, where `version = cur.version + 1` raises 22003. The whole seed transaction rolls back, and every later deploy's seed step fails until someone repairs the row by hand.

Impact Medium × Likelihood Low = LOW.

**Remediation (design decision, principal-architect with data-architect, before TASK-221).** Preferred order:
1. Grant `SELECT` only in this migration (no runtime writer exists yet). TASK-221's migration adds the narrowest write it needs. Only `grants.manifest` and §4.4 change.
2. Or keep the grant but restrict it to the reconciler's row with RLS **enabled but not forced** (the owner/migrator is unaffected):
   `ALTER TABLE public.reference_dataset_versions ENABLE ROW LEVEL SECURITY; CREATE POLICY rdv_app_authz_matrix ON public.reference_dataset_versions TO platform_app USING (dataset = 'authz_matrix') WITH CHECK (dataset = 'authz_matrix');`
   This deviates from the "SYSTEM = no RLS" class rule, so the C1 allow-list needs an entry.
3. Or a `platform_definer`-owned `SECURITY DEFINER` function `platform.record_authz_digest(p_version text, p_sha256 bytea, p_row_count integer)` in the §4.5 pattern.

Independently, `CHECK (version < 2147483647)` makes the overflow fail at the attacker's `UPDATE` instead of at the next seed.

**Verification.** Catalog C5 shows exactly the decided privilege set. An API/DB test as `platform_app`: `UPDATE public.reference_dataset_versions SET version = 2147483647 WHERE dataset = 'probe'` → 42501 (option 1), or 0 rows (option 2).

### PR13-SEC-05 (INFO): dataset targets are not restricted

`validateDataset` accepts any `schema.table` that matches the identifier shape. P-C: `public.role_permissions` and `public.reference_dataset_versions` are accepted as targets. The parity step limits the authz case to catalogue-equal content (same transaction, steps after datasets), and audit tables are not writable by the migrator. Still, D-ARCH-060's "single writer" is enforced only by review, and a dataset could forge version rows. Separately, `sql.ts#table()` destructures `split('.')`, so `public.t.extra` renders as `"public"."t"` when a renderer is called without validation.

**Fix.**
- Once PR #11's manifests are on main, accept only tables whose table-class manifest class is GLOBAL. Until then, deny `permissions`, `roles`, `role_permissions`, `reference_dataset_versions` and `audit_*` by name.
- In `table()`, require `parts.length === 2`.

**Test.** `validateDataset` refuses the authz tables and `reference_dataset_versions`; `renderUpsert` throws for a three-part name.

### PR13-SEC-06 (INFO): drift restoration is silent; production writes outside the migration guardrail

**What happens now.** `runDataset` restores drifted rows on every run (AT-US-049-08). For an audited dataset, a non-zero `updated` with an unchanged hash emits only `info seed.dataset … updated: N`. Drift in production configuration (a hand-edited compliance pack or pricing row) is tamper evidence, and it is reverted without an audit entry or alert.

**Guardrail classification.** The seed's `ON CONFLICT … DO UPDATE` writes are runtime writes, not migrations, so D-SEC-PR8-01 and the backup/restore guardrail do not apply to them. I accept this, because reference content is GLOBAL, re-derivable from the repository, and insert-only for published versions.

**Recommendations.**
- Log `warn seed.drift_restored {dataset, rows}` when `updated > 0`.
- For audited datasets, have TASK-025/221 record a `CONFIG_CHANGE` or security event for the restoration.
- TASK-014 / the M5 pipeline: order the steps snapshot → `migrate deploy` → `db:seed`, so the seed runs after the same pre-migration snapshot.

### PR13-SEC-07 (INFO): redaction scope and README wording

**Redaction scope.** `secrets` holds only the full URL string. P-D (synthetic) shows that an error carrying only the password component would print it. No real `pg` 8.23.1 path does this (P-A), so this is defence in depth.

**Fix.**
- Also push the URL's password and its decoded form:

  ```ts
  const parsed = URL.parse(url);
  if (parsed?.password) secrets.push(parsed.password, safeDecode(parsed.password));
  ```

- Before `runDemoSeed`, push the revealed `SEED_*` values from `plan.passwords`, so errors raised by the TASK-089 provisioner are covered.

**README wording.** The README says "none read in staging or production". In fact, a *present* value is read once, only to choose between `SEED_DEFAULT_PASSWORD_REFUSED` and `SEED_PASSWORD_FORBIDDEN`; it is never stored or printed. Reword it to "never used; a present value is refused".

### PR13-SEC-08 (INFO): checks owed by later tasks

- **TASK-089 (identity-backed provisioner):**
  - PR13-SEC-02 must be fixed first.
  - Staging `set-password-link` tokens:
    - never logged or printed;
    - single-use, short TTL, stored hashed (`password_reset_tokens.purpose = 'SET_PASSWORD'`, data-model §4.5);
    - delivered only through the mail adapter.
  - `.example` recipients mean a deployed staging environment with a Mailpit-style sink exposes Super Admin takeover to anyone with sink access, so the sink must be access-controlled.
  - The first-TOTP-enrolment binding of SEC-P3-14 applies to seeded staff.
  - Provisioner errors are value-free (PR13-SEC-07).
  - Demo users are created through the identity service with audit entries.
- **TASK-221:** `down.sql` drops the `authz_matrix` digest row. After a down → up, the reconciler would back-fill a second "∅ → current" baseline `CONFIG_CHANGE`. Derive the last audited digest from the audit log, or mark re-baselines explicitly. Also apply the PR13-SEC-04 decision.
- **TASK-014 (Compose / seed one-shot):**
  - `DATABASE_MIGRATOR_URL` appears only in the migrate/seed job env;
  - the seed is a `checkToolingEnv` caller (PR3-SEC-14);
  - hardened images set `NODE_ENV=production`;
  - the one-shot runs `tsx` from TS sources, so record the tooling-image closure (`tsx`/esbuild) or run a built `dist`;
  - ordering per PR13-SEC-06.
- **TASK-025 (audit writer behind `ConfigChangeSink`):** the sink receives the seed's **migrator** connection inside the seed transaction. §4.4 grants `INSERT` on `audit_entries` to `platform_app`, not to the migrator. Any new migrator privilege on audit tables needs a security review (audit-owner separation, §4.4 item 5).

## 4. Focus-area closure (orchestrator brief)

| Focus item | Result |
|---|---|
| Demo credentials: `SEED_*` only; defaults only in local; staging set-password links; production skips; no password or URL printed | **Holds**, with the ECS-signal gap PR13-SEC-02 and redaction depth PR13-SEC-07. Staging reads no value for use; production returns `skip` before any provisioner call; refusals name variables only (unit fast-check + spawned-CLI tests + P-A) |
| SQL construction safety (identifier guard, parameterisation, injection via dataset definitions) | **Holds**: two-layer identifier guard, quoted identifiers, values bound as one `jsonb` parameter (P-C fuzz). Residual PR13-SEC-05 (target allow-list) |
| `platform_app` write grants on `reference_dataset_versions` | Conforms to §4.4, but wider than any current or planned need → PR13-SEC-04 (decision before TASK-221) |
| Seed never writes authz tables | **Holds**: read-only parity step, `id:xmin` integration test, drift → rollback |
| No real or legacy personal data in fixtures | **Holds**: `.example` addresses, `Probe N` fixture rows, run-time random secrets |
| `readSecret` parity with the file provider | **Not met** → PR13-SEC-01 |
| Advisory lock / transaction behaviour | **Holds**: single client, xact lock, full rollback, timeouts. Lock key `4821950023` does not collide with Prisma's migrate lock (`72707369`) |
| Data-changing classification of the migration | **Correct** (`data-changing: no`; DDL + GRANT only). The seed's upserts are runtime writes, not migrations (PR13-SEC-06) |

## 5. Rulings on the PR's decisions (D-TASK023-01)

| Item | Ruling |
|---|---|
| 01 `dataset_version` column | No security impact; accepted |
| 02 any `SEED_*` refused in staging/production | **Endorsed**: closer to SEC-P3-14 / T-23 than US-049's wording |
| 03 no-op semantics (zero writes, drift checked every run) | Accepted; drift visibility per PR13-SEC-06 |
| 04 deferred provisioner, logging sink | Accepted as temporary; the logging sink prints dataset, versions and hashes only. PR13-SEC-02 gates the provisioner swap |
| 05 copied `readSecret` | **Not accepted as is** → PR13-SEC-01 (drop `_FILE`) |
| 06 rule-10 classification | Confirmed `data-changing: no` |

## 6. Merge conditions and routing

**Merge conditions (D-ORCH-015 reconciliation after PR #11 merges)**
1. Register `reference_dataset_versions` in `tools/db/table-classes/platform.json` (class SYSTEM; fix the `$comment` "no grant to any platform role").
2. List exactly the decided `platform_app` privileges in `prisma/sql/grants.manifest`: three lines today, one if PR13-SEC-04 option 1 is taken.
3. `db:lint-migrations` (including PR #11's unclassified-table rule) and catalog C1–C14 are green on the rebased head.
4. A **round-2 delta review** by security-analyst on the reconciled head. The migration and the grant manifest are security-owned paths, so the lane A record check needs a record whose `Head` lies in the new range.

**Routing**

| Owner | Item | Due |
|---|---|---|
| TASK-023 fix cycle (recommended) | PR13-SEC-01 (option A), -02, -03 (URL guard + `SHOW search_path`); optionally -05, -07 | Before merge if taken; otherwise -02 before TASK-089, -01/-03 before TASK-014 deploys the seed one-shot |
| principal-architect + data-architect | PR13-SEC-04 grant decision (§4.4 amendment if option 1/2); ADR-0018 am. 6 register only if PR13-SEC-01 option B is chosen | Before TASK-221 |
| TASK-089 | PR13-SEC-08 TASK-089 list; PR13-SEC-02 test present before replacing `DEFERRED_PROVISIONER` | With TASK-089 |
| TASK-014 | `checkToolingEnv` caller incl. `sslmode=verify-full` in hardened envs (PR13-SEC-03 TLS half, PR3-SEC-14); seed one-shot env and ordering (PR13-SEC-06/08) | Wave 0 |
| TASK-025 / TASK-221 | Drift-restoration event for audited datasets (PR13-SEC-06); audit-writer role on the seed path; re-baseline after `down.sql` (PR13-SEC-08) | With those tasks |
| TASK-026 (first real dataset) | PR13-SEC-05 if not done here | With TASK-026 |

## 7. ASVS / OWASP mapping

| ASVS 4.0.3 | Status | Findings |
|---|---|---|
| V2.10.2 / V2.10.4 (no default service credentials; seeds and secrets managed securely) | Met for the plan logic; second signal missing | PR13-SEC-02 |
| V5.3.4 (parameterised queries) | Met (identifier guard + bound `jsonb`) | PR13-SEC-05 (scope) |
| V7.1.1 (no credentials in logs) | Met (P-A, unit properties) | PR13-SEC-07 (depth) |
| V6.4.1 / V14.1.x (secrets management, configuration hardening) | Partly met | PR13-SEC-01, -03 |
| V4.1.3 (least privilege) | Conforms to §4.4; wider than needed | PR13-SEC-04 |
| V7.2.x (security events logged) | Partial | PR13-SEC-06 |

OWASP 2021 categories are as in §3.

Sources: `pg` 8.23.1 / `pg-connection-string` 2.14.1 in the worktree's `node_modules` (P-B, observed config precedence); `packages/config/src/{guards,environment,file-secret-provider,placeholders}.ts` @ `e92cd6f`; `tools/db/bootstrap.ts` @ `e92cd6f` and @ `5ed304a` (PR #11); ADR-0018 am. 6 and am. 8; data-model §3.5, §4.4, §9; DECISIONS D-ARCH-052, D-ARCH-060, D-ARCH-061, D-SEC-PR8-01, D-TASK023-01, D-ORCH-015; PostgreSQL 18 documentation (*Client Connection Defaults*: `search_path`, implicit `pg_catalog`; *Numeric Types*: `integer` overflow raises an error).

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open at head `e92cd6f`, so the D-ORCH-004 merge rule ("no Critical/High open") is met. 4 LOW (PR13-SEC-01..04), 4 INFO (05..08). PR13-SEC-01, -02 and -03 are recommended in this PR's fix cycle. PR13-SEC-02 is a hard precondition for TASK-089's provisioner swap, and PR13-SEC-04 needs a principal-architect decision before TASK-221. The D-ORCH-015 reconciliation after PR #11 needs a round-2 delta review |
