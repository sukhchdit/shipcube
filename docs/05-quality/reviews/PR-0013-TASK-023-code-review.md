# Code review: PR #13, TASK-023 idempotent reference and demo seed framework (round 1)

- **PR:** #13 `feat/TASK-023-idempotent-reference-demo-seed-framework`, head `e92cd6f` (last code commit `fa3d848`; `e92cd6f` is a docs-only merge of `origin/main` `31303f2`)
- **Reviewer:** code-reviewer · P5 Wave 0 · 2026-11-13
- **Inputs:** WAVE-00.md TASK-023 (and TASK-014, TASK-026; WAVE-02.md TASK-089); US-049 (EPIC-17); data-model §3.3, §3.5, §3.6, §4.4, §8.3, §9.1–§9.3; ADR-0018 §4; DECISIONS.md D-TASK023-01, D-ARCH-060, D-SEC-PR8-01, D-ORCH-007, D-ORCH-015; PR #11 head `557aada` (merge-second analysis)

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A careful, well-tested framework. The single-statement jsonb_populate_recordset upsert with an IS DISTINCT FROM
         guard really is a zero-tuple no-op (proven by xmin), refusals really happen before any connection, and the
         authz step really only reads. One MAJOR: US-049 is planned as "completes", but AT-02/-05/-09/-10 are not met and no
         plan sheet owns their remainders. M1 is docs only. Six MINORs: the CLI crashes with exit 1 on a dropped connection;
         the pinned search_path and statement_timeout can be overridden by the URL; the readSecret copy adds an unregistered
         key; the Dataset contract cannot express several §9.2 shapes; a drift restore of an audited dataset is not audited;
         and PR #11 merge-second adds 5 lint errors that D-ORCH-015 does not list.
FINDINGS: M1 (MAJOR); m1–m6 (MINOR); n1–n8 (NIT). See §3.
GOOD: see §5
SECURITY-FLAGS: m2, m3, the platform_app write grant on reference_dataset_versions, n3, n4 (see §6)
```

## 1. Verification performed

The host is memory-constrained, so per the brief I ran no `npm ci`, build, typecheck, Docker, integration, coverage or full suite. I used two `git archive` scratch copies, PR head `e92cd6f` and the `git merge-tree` result `652258f` of `e92cd6f` with PR #11 head `557aada`. Each had `node_modules` junctioned from the worktree. Both copies and junctions were removed afterwards. The worktree is unchanged: HEAD `e92cd6f`, `git status` empty, 740 `node_modules` entries, no drive-root junction.

| Check | Result |
|---|---|
| `prettier --check` on `prisma/seed`, `prisma/tests/seed`, `prisma/README.md`, both `package.json`, both tsconfigs | clean |
| Unit files, run one at a time (`jest --selectProjects unit`): runner, credential-plan, sql, cli, hash, validate, run-demo-seed, authz-parity-step | 8 files, **109/109 passed** |
| ESLint (repository config, type-checked rules disabled) on `prisma/seed` and `prisma/tests/seed`, at the PR head | 25 files, 0 problems |
| Same, on the merge-tree with PR #11 | **5 problems**: `boundaries/dependencies` at `prisma/tests/seed/seed.int.test.ts:19-23` (m6) |
| `tools/db/lint-migrations.ts --no-validate`, PR head | no findings |
| Same, merge-tree with PR #11 | rule 9: `reference_dataset_versions` is in no table-class manifest (already a D-ORCH-015 item) |
| `git merge-tree e92cd6f 557aada` | textually clean |
| Probe 1 (tsx): `pg.Client({connectionString: '…?options=-c search_path=evil,pg_catalog&statement_timeout=0', options: SESSION_OPTIONS, statement_timeout: 120000})` | `connectionParameters.options = "-c search_path=evil,pg_catalog"`, `statement_timeout = 0`. **The URL wins** (m2) |
| Probe 2 (tsx): `main(['reference'])` against a fake PG server that authenticates and then drops the socket on the first query | **process crash, exit 1**, `Unhandled 'error' event` stack on stderr, no JSON line (m1) |
| Probe 3: `main` with 7 malformed or unreachable URLs carrying a marker password | exit 2 and no leak in 6 of 7. The 7th leak is contrived: the marker sits inside an `sslrootcert` path, echoed by ENOENT (n4) |
| Probe 4: `planDemoCredentials` edge cases | `' local-only-…'` and `LOCAL-ONLY-…` refused in `test` (good); `''` in staging/production → `SEED_PASSWORD_FORBIDDEN` (n2); `SEED_*_FILE` ignored |
| Probe 5: `validateDataset` | `__proto__` column with no row value **accepted** (n1); a null natural-key value (holidays `region_code`) refused; an `id` column refused (m4) |
| `gh pr view 13 --json statusCheckRollup` | `[]`: no CI on the head (lane A not yet merged, D-ORCH-004 bootstrap) |

Not re-run, so I rely on the PR body evidence: typecheck, full typed lint, `test:unit` (968), `test:api`, `test:integration` (68 + `seed.int.test.ts` 17/17), coverage (99.53 % / 97.73 %; `prisma/seed/index.ts` 89.3 % / 89.7 %), build, `npm audit`. I read `seed.int.test.ts` in full. Its assertions (whole-table `xmin` + `updated_at` equality, `id:xmin` of the 3 authz tables, rollback of a refused run) do prove what the AT table claims at framework level.

## 2. Scope and design summary

- **Runner.** Each chunk of at most 500 rows becomes one statement, `INSERT … SELECT … FROM jsonb_populate_recordset(NULL::<table>, $2) ON CONFLICT (<nk>) DO UPDATE … WHERE (cur.payload) IS DISTINCT FROM (EXCLUDED.payload) RETURNING (cur.xmax = 0)`.
  - Identifiers pass `validateDataset` and are re-guarded and quoted in `sql.ts`. Values are parameterised.
  - Insert-only datasets use `DO NOTHING`, then a changed-count join, so an in-place change is refused.
  - A version row is written, and an audited change reported, only when the label or hash changed.
  - The whole run is one transaction behind `pg_advisory_xact_lock`.
- **Authz parity step.** It reads the three authz tables and diffs them against `packages/authz`. It never writes (D-ARCH-060).
- **Credential plan.** Decided before connecting:
  - production → skip;
  - staging → set-password links, and any present `SEED_*` is refused;
  - local/test → every `SEED_*` required; `local-only-*` defaults allowed in local only.
  - `NODE_ENV=production` with local/test is refused.
- **CLI.** Exit 0 / 1 (refusal) / 2 (unexpected). Output is JSON lines. The URL is redacted.
- **Migration.** `reference_dataset_versions`: expand-only, `data-changing: no`, `down.sql`, `platform_app` gets SELECT/INSERT/UPDATE (§4.4).

The idempotency proof is sound. The `IS DISTINCT FROM` predicate on `DO UPDATE` means a no-op run creates no tuple and leaves `updated_at`/`version` alone. `xmax = 0` correctly separates inserts from updates in `RETURNING`. AT-01 checks every row's `xmin`, which a missing predicate would break. A no-op run still takes row locks (`ON CONFLICT … DO UPDATE` locks the conflicting row even when the `WHERE` is false) and therefore an xid. That is a physical, not logical, write, and it is consistent with "no writes, no audit entry" as REQ-DATA-001/D-TASK023-03 define it.

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| M1 | **MAJOR** | PR body "AT mapping"; WAVE-00.md TASK-023 ("Stories (completes) US-049 DC"); WAVE-02.md TASK-089; WAVE-00.md TASK-014 | **US-049 is planned as completed by this task, but 4 of its 10 scenarios are not met, and no plan sheet owns the remainders.**<br>• AT-05 *Then the demo users are created*: not met. `DEFERRED_PROVISIONER` writes nothing, and the in-process test asserts `created: 0, deferred: 14`.<br>• AT-10-1/-2 *users are created with the seeded passwords*: not met.<br>• AT-09 *staff created, set-password link visible in the mail catcher*: not met.<br>• AT-02 *compose runs the seed*: not met.<br>The PR labels AT-05 and AT-10 "Met for the framework", which overstates them; the honest label is Partial (the test titles themselves correctly say "deferred until TASK-089").<br>The routing exists only in the PR body:<br>• TASK-089's sheet lists only AT-US-050-* and AT-US-003-*;<br>• TASK-014's US-003 line says "seed content completed by the seed tasks";<br>• D-TASK023-01 (04) records the stand-in provisioner but not where these ATs go.<br>Merged as is, traceability would mark US-049 done and the four scenarios would silently drop. That is the CLAUDE.md §8 DoD item "AC of the linked stories satisfied", and it would need a §7 re-scope. | Docs only, no code change:<br>(a) PR body: AT-05 and AT-10 become **Partial**.<br>(b) The orchestrator (product-manager for the split) logs a re-scope decision: US-049 framework part done by TASK-023; AT-US-049-05/-09/-10 end to end (users exist; Mailpit-visible SET_PASSWORD link in staging; no link in local/test) → TASK-089; AT-US-049-02 → TASK-014, or TASK-026 as the first Compose end-to-end.<br>(c) Add those AT IDs to the TASK-089 and TASK-014/026 sheets (`plan-data.mjs`, regenerated).<br>(d) traceability.md records US-049 as partial until then. |
| m1 | MINOR | `prisma/seed/index.ts:76-91` | **A dropped connection crashes the CLI with exit 1 (the refusal code) and a non-JSON stack.** pg `Client` emits `'error'` on connection loss even while a query is pending (`client.js` `_handleErrorEvent`), and nothing listens. I proved it with a fake server that drops the socket on `BEGIN`: `Unhandled 'error' event`, exit 1, no `seed.failed` line. The trigger can be a server restart, an admin kill, the `idle_in_transaction_session_timeout`, or a network blip. This breaks the documented contract "1 refusal · 2 unexpected · JSON lines", and a pipeline would report a policy refusal. (`tools/db/bootstrap.ts` has the same gap; route it to TASK-014.) | Attach `client.on('error', …)` in `withMigratorConnection`. The pending query already rejects, so the listener only needs to swallow or record. Add a unit test with a fake socket server like the probe, expecting exit 2 and a JSON `seed.failed` line. |
| m2 | MINOR | `prisma/seed/index.ts:22-25, 77-84` | **The "pinned like tools/db/bootstrap.ts" session can be overridden by the URL.** pg merges `parse(connectionString)` *over* the config object. So `DATABASE_MIGRATOR_URL=…?options=-c search_path=x,pg_catalog&statement_timeout=0` replaces the pin and the timeout (probe 1). `bootstrap.ts` `connectPrivileged` both refuses an `options=` parameter (`:133`) and verifies `SHOW search_path` after connecting (`:139`). The seed copied only the constant, which is exactly the drift risk of copying. It is the same class of issue as PR #9 R2-m2 and PR3-SEC-12 (hardened `DATABASE_URL` params are allow-listed in `@platform/config`, `POSTGRES_URL_PARAMS`). Exploitability is low (it needs control of the migrator URL), but the migrator is the privileged role. | Refuse `options`, `statement_timeout`, `idle_in_transaction_session_timeout` and `host` parameters in the URL, preferably by reusing the config allow-list. Then verify `SHOW search_path` (and `statement_timeout`) after `connect()`, as bootstrap does. Add tests for both. |
| m3 | MINOR | `prisma/seed/index.ts:47-57` | **The copied `readSecret` (D-TASK023-05) adds an unregistered key and an unconfined file read.**<br>• `DATABASE_MIGRATOR_URL_FILE` is in neither `packages/config/src/tooling-keys.ts` (which registers `BOOTSTRAP_*_PASSWORD_FILE`) nor ADR-0018. It is built dynamically (`${name}_FILE`), so key-parity scans cannot see it.<br>• The read has no `/run/secrets` root confinement and no 64 KiB cap. `@platform/config`'s file provider has both, and the prisma workspace now depends on that package.<br>• Two byte-identical copies drift apart; m2 shows that is already happening.<br>• The Prisma CLI (`prisma-cli.mjs migrate deploy`) cannot use a `_FILE` variant anyway, so the migrate job needs the plain URL. | Either drop the `_FILE` path, or register `DATABASE_MIGRATOR_URL_FILE` (tooling-keys + ADR-0018 register, `secret-ref`, `['migrate']`). Then single-source the helper: a tooling export in `@platform/config` used by both `bootstrap.ts` and the seed, or at minimum a parity test. |
| m4 | MINOR | `prisma/seed/framework/validate.ts:10, 49-51`; `contracts.ts:29-40`; `prisma/README.md` "Adding a dataset" | **The `Dataset` contract cannot express several data-model §9.2 datasets, yet the README presents "add a Dataset file" as sufficient.**<br>(a) **UUID foreign keys:** `id` is reserved and there is no natural-key FK lookup. `carrier_services`, `transit_days.carrier_service_id`, pack sections, pricing rules and `prohibited_items.compliance_pack_id/carrier_id` need parent ids that are generated per environment. The authz migration and §9.3 `seedId` use deterministic ids, which the framework forbids.<br>(b) **Nullable natural keys** (`NULLS NOT DISTINCT`): `holidays.region_code` and `notification_templates.variant` are refused (probe 5), and the insert-only changed-count joins with `=`.<br>(c) **Partial-index arbiters:** `prohibited_items` uniqueness is `… WHERE scope='COUNTRY'`, and `ON CONFLICT (cols)` cannot infer it without the predicate.<br>(d) **Columns set on insert but never restored:** `number_sequences.next_value` is "only on insert; never reset", and `reviewed_at`/`reviewed_by` behave the same way. Listing `next_value` in `columns` would reset every sequence to 1 on every deploy's reference seed, which means **duplicate order numbers** (a guardrail). | Now, in this PR: document the limits in `contracts.ts` and the README, including the hard rule "never list a column the runtime or a reviewer mutates". Route the extensions to the first consumer tasks under the `prisma-seed` lock, with tests: (a) deterministic `seedId` ids or `{ fk: { column, table, naturalKey } }` resolution; (b) `IS NOT DISTINCT FROM` joins and lifting the null-key refusal for NND indexes; (c) an optional `arbiterWhere`; (d) `insertOnlyColumns`. Owners: TASK-066 (fx), the carriers, compliance-pack, holidays (US-054), templates and number-sequences (US-056) seed tasks. |
| m5 | MINOR | `prisma/seed/framework/runner.ts:74-86`; `contracts.ts:81-93` | **A drift restore of an audited, non-insert-only dataset writes configuration rows with no `CONFIG_CHANGE`.** `configChanged` fires only on a label or hash change. A hand-edited `feature_flags` row (the obvious audited, mutable dataset) is restored with `updated > 0` and no audit entry. data-model §9.1 says configuration changes "write one `CONFIG_CHANGE` audit entry each", and REQ-COMP-008 exempts only a *no-op* re-run. `ConfigChange` has no field for this case, and this PR fixes the port shape that TASK-025 will implement. | Either call the sink when `audited && updated > 0` (add `restoredRows: number`, or a `kind: 'version' \| 'drift-restored'` discriminator), or refuse drift on audited datasets the way insert-only ones are refused. Add a runner unit test and an integration case. |
| m6 | MINOR | `prisma/tests/seed/seed.int.test.ts:19-23`; D-ORCH-015 | **PR #11 merge-second breaks lint in a way D-ORCH-015 does not list.** PR #11's `prisma-tests` boundaries policy allows only tools-db, test-support, tools-authz, db-platform-core, prisma-generated and prisma-tests. The merge-tree lint probe gives 5 `boundaries/dependencies` errors, one for each `../../seed/**` import. Conversely, the D-ORCH-015 item "align `prisma/seed/**` raw SQL with PR #11's lint rules" is a no-op: `platform/db-raw-sql` covers only `DB_PLATFORM` and repository files, and the probe shows no other rule firing on `prisma/seed`. | In the reconcile commit: add a `prisma-seed` element category and allow `prisma-tests → prisma-seed`. Also add the D-ORCH-015 items: the `platform.json` manifest entry (rule 9 confirmed on the merge-tree) with the `$comment` fix, and `grants.manifest`. Re-run the merge-tree lint. I will check §1's probe again in round 2. |
| n1 | NIT | `validate.ts:45` | `column in row` walks the prototype chain. A `__proto__` column with no value passes the missing-value check (probe 5); the lower-case regex admits `__proto__` and `constructor`. Datasets are code, so this is not exploitable, but it is wrong. | Use `Object.hasOwn(row, column)`, or refuse names that begin with `__`. |
| n2 | NIT | `credential-plan.ts:47-51` (asserted at `credential-plan.test.ts:93`) | In staging/production `SEED_X=''` counts as present → `SEED_PASSWORD_FORBIDDEN`, while local/test treat `''` as missing. A Compose-style `${SEED_X:-}` would trip the hardened path. This is deliberate, but undocumented in D-TASK023-02. | Add one line to D-TASK023-02 or the README, or treat `''` as absent in both branches. |
| n3 | NIT | `contracts.ts:63-69`; `runner.ts:117-134` | `SeedSql` structurally accepts a `pg.Pool`. With a pool, `BEGIN`, the advisory lock and `COMMIT` run on different connections, so a refused run leaves partial writes. The CLI passes a `Client`; TASK-089/221 wiring could pass a pool. | Narrow the type (for example `Pick<pg.ClientBase, 'query'> & { readonly release?: never }`), or have `runReferenceSeed` take a connection factory. Alternatively, assert one `pg_backend_pid()` across the run. |
| n4 | NIT | `index.ts:95-98, 107-114` | Redaction covers only the whole URL string. Before TASK-089 wires a real provisioner, push the planned `SEED_*` values (and the decoded URL password) into `secrets`, so a provider error can never echo them (AT-07 defence in depth). | Push them when the plan is `seeded-passwords`. |
| n5 | NIT | `version-store.ts:40` | `decode(…)` and `$5::uuid` are unqualified, while `sql.ts`/`runner.ts` qualify everything with `pg_catalog.`. It is safe only while the pin holds, and m2 shows the pin can be bypassed. | Use `pg_catalog.decode` and `pg_catalog.uuid`. |
| n6 | NIT | `validate.ts:59-67` | `reference_dataset_versions.dataset = 'authz_matrix'` belongs to TASK-221's reconciler, but nothing stops a future dataset from taking that name. | Add a reserved-names check. |
| n7 | NIT → TASK-014 | `credential-plan.ts:34-40`; `package.json` `db:seed*` | Runtime images set `ENV NODE_ENV=production` (ADR-0018 am.), and the seed refuses `NODE_ENV=production` with `APP_ENV=local`. The Compose seed one-shot must therefore get `NODE_ENV=development` (`compose.env`) or AT-02 fails. The scripts also need `tsx` plus `@platform/source` sources in whichever image runs `db:seed`. | Add both to the TASK-014 sheet / Compose checklist. |
| n8 | NIT | `seed.int.test.ts` | The advisory lock is asserted only as a statement (unit). No test runs two seeds concurrently. | Optional: two `runReferenceSeed` calls on separate clients with `Promise.all` give one `applied`, one `unchanged` and no unique violation. |

## 4. Rulings on the author's decisions and on the reviewer focus

- **D-TASK023-01 (01) `dataset_version`:** accepted. STD `version` must stay the row counter. Architect: amend data-model §3.5 (`version text` → `dataset_version text`) and the §9.2 authz row (`(dataset='authz_matrix', version, content_sha256)` → `dataset_version`) before TASK-221 starts. Note: data-model.md has uncommitted edits in the main checkout; make sure the amendment lands there.
- **(02) Stricter hardened refusal:** accepted. It is consistent with SEC-P3-14 and fail-closed. See n2 for `''`. Refusing `NODE_ENV=production` with local/test reintroduces, for the seed only, the reverse coupling that D-ORCH-007 rejected for the runtime. That is acceptable because it only refuses, but it creates the n7 obligation.
- **(03) No-op semantics:** accepted. Drift is checked on every run, and the version row stays untouched. See §2 on row locks.
- **(04) Ports:**
  - `DemoUserProvisioner` is a good seam: per user, credential decided up front, `Secret`-wrapped.
  - `ConfigChangeSink` runs inside the transaction (good) but needs m5's shape change.
  - `DatasetVersionStore` is reusable only from `prisma/` or `tools/`: apps cannot import `prisma/`, and PR #11 bans untagged raw SQL. If TASK-221's reconciler runs in the worker, the shared contract is the table plus `(dataset, dataset_version, content_sha256)`, not this object. Say so in §3.5 when amending.
- **(05) Copied `readSecret`:** not accepted as is. See m3, and m2 for the drift it already caused.
- **Rule-10 classification:** correct. DDL plus GRANT only, so `data-changing: no`. The header, `reversible: yes` and `down.sql` are all present, and the migration is expand-only. The `platform_app` SELECT/INSERT/UPDATE grant matches §4.4; see §6.
- **AT honesty:**
  - AT-01, -03, -04 (×3), -06, -07 and -08 are met as claimed. AT-01/-08 are at framework level with probe tables; that is acceptable for a framework task, and the real tables come with TASK-026/066.
  - AT-02, -05, -09 and -10 are not met. See M1.
- **Coverage:** not re-run. The CLI gaps the PR names (logging sink body, `import.meta.main`) are plausible. m1's fix adds a reachable branch with its own test.

## 5. Good

- One statement per 500-row chunk with typed rows from `jsonb_populate_recordset(NULL::table, $2)`: no per-row queries, no per-column casts, and the identifiers are guarded twice.
- `IS DISTINCT FROM` on `DO UPDATE` plus whole-table `xmin`/`updated_at` equality is a real proof of a no-op, not just a matching row count.
- Insert-only refusal, both up front (same label, new hash) and per row (changed-count join), with a rollback test showing the refused run's new rows do not survive.
- The authz step is read-only and its proof is `id:xmin` of all three tables. The drift refusal names the key, caps the list at 25 and rolls back.
- Refusals are proven to happen before connecting: the URL is unreachable, so a connect-first bug would exit 2, not 1. `Proxy` envs prove that staging reads no `SEED_*`. fast-check secrecy properties cover the logs, the plan and the errors.
- The canonical hash is independent of row and key order and distinguishes types, with property tests.
- Test titles are honest ("deferred until TASK-089").

## 6. Security flags (for security-analyst)

1. **m2:** the migrator session's `search_path` and `statement_timeout` can be overridden through the URL (CWE-15/CWE-426 class). The bootstrap lane's refusal and `SHOW` check were not carried over.
2. **m3:** the `_FILE` read has no root confinement or size cap, and the key is unregistered.
3. **`platform_app` INSERT/UPDATE on `reference_dataset_versions`** (per data-model §4.4). A compromised runtime role can rewrite `content_sha256` or `dataset_version` for any dataset. The next reference seed then refuses (a deploy DoS for insert-only datasets) or records a spurious `CONFIG_CHANGE`. The row-level changed-count still catches content tampering. Consider restricting the runtime grant to the `authz_matrix` row (a trigger, or a column/row-scoped writer), or document the residual risk.
4. **n3:** a pool passed as `SeedSql` silently loses atomicity.
5. **n4:** redaction is limited to the whole URL string; seed passwords are not yet included.

## 7. Merge conditions

1. M1 closed: PR body relabelled, re-scope decision logged, AT-02/-05/-09/-10 on owning sheets.
2. m1–m5 fixed in-PR, or explicitly routed with a DECISIONS entry. m1 and m2 are small and should be fixed in-PR. For m4, at least the documentation and the "never list a runtime-mutated column" rule must land in-PR.
3. Per D-ORCH-015 this PR merges after PR #11. The reconcile commit carries m6: the `prisma-seed` boundary category, the `platform.json` entry with the `$comment` fix, and `grants.manifest`. It must then pass full typed lint, `db:lint-migrations` and the PR #11 catalog suite (C5) on the merged head.
4. CI (`statusCheckRollup`) is empty on the head. Gatekeeper re-runs the gates on the final merge-main commit.
