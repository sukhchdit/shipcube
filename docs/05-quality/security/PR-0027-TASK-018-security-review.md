# PR-0027 / TASK-018: change-scoped security review (SPK-04 audit write throughput spike: k6 ESLint block, test-only harness, SQL fixtures, run evidence)

| Field | Value |
|---|---|
| PR | #27 `test(perf): spk-04 audit write throughput spike (TASK-018)`, https://github.com/sukhchdit/shipcube/pull/27 (SPK-04, R-ARCH-04, D-TASK018-01..05, D-ORCH-031) |
| Branch | `feat/TASK-018-spk-04-spike-audit-write`: four commits on the merge base `94e8808` (`c037470` harness, `bb6ae77` findings and evidence, `34a1232` merge of main `94e8808`, `aa1cfb1` evidence move); 22 files, +13 978 / -0, equal to `gh pr view` |
| Head | aa1cfb1c6c12d154e5a33482235235459b389551 |
| Main now | `ddbeb49` at the end of the review. Main moved several times while I worked (`8ae440c`, `f5a29d6`, `600232d` = PR #25 merged, `ddbeb49`). PR #25 changed the security-owned `.github/dependabot.yml`, `.gitleaks.toml` and `tools/ci/sec-static.test.ts`; none of them is in this PR's net change, so a merge of main keeps this record valid (§7 case D). `docs/sdlc/DECISIONS.md` conflicts textually on a merge (both sides append at the end) |
| Security-owned paths changed (CODEOWNERS, as lane A computes them) | `eslint.config.mjs` (1) |
| Dependencies / workflows | `package.json`, `package-lock.json`, `.npmrc`, every workspace manifest, `.github/**`, `tools/**`, `apps/**`, `packages/**`, `prisma/bootstrap`, `prisma/migrations`, `prisma/seed`, `prisma/schema`, every `tsconfig*.json`, `.gitleaks*`, `.semgrep*` are byte-identical between the merge base and the head (three-dot diff empty). No D-ORCH-021 lever moves (§3.6) |
| Binding items checked | D-ORCH-021 (1), D-TASK018-02..05, PR3-SEC-11 / SEC-TC-18 (no `-bench` profile), PR12-SEC-04 / PR12-SEC-08 and D-ARCH-076 (prototype state versus product state), SEC-P3-03 / SEC-P3-27 (audit owner and guard), ADR-0007 item 4 and amendment 10 item 8 (as it stood in the main working tree), ADR-0024 (k6 through Docker), TEST-STRATEGY §7.10 (host-spec contents), `platform.md:233` (`.dockerignore`), code review R1 §5 security flags |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. In the `Shipqube-TASK-018` worktree I ran no git command and no tool; I listed two directories (`ls` of the root and of `docs/05-quality/performance/spikes/SPK-04/`) and read nothing else from it. Everything else came from `git show` / `git archive` of the head in the main checkout, probed in scratch extracts and one scratch `git clone --shared`. In the main checkout I ran `git fetch origin` (twice), read-only git and read-only `gh pr view` / `gh pr list`. Docker was not used (lane A's and the developer's gate table stand for lint, typecheck, unit and build). Network: anonymous read-only GETs to the Docker Hub registry and tag API for the k6 digest (§3.4); no other. The scratch extracts, clones and `node_modules` junctions are removed at the end |

## 1. Summary

**The change does what D-TASK018-03 asks and nothing more.** I found no way in which the ESLint block, the harness or the fixtures weaken a gate, the audit immutability layers, RLS or the DDL guard, and no secret, personal datum or host identifier in the evidence. One LOW and four INFO items are follow-ups; none blocks the merge.

- **The ESLint block is scoped to `tests/load/**/*.js` and changes no rule.** Over 49 representative paths the effective configuration differs for exactly the three `tests/load/**/*.js` probes, and only in `languageOptions.globals` (five read-only names) and `settings['import-x/core-modules']` (two names). The 46 others are identical, including every near miss (`.ts`, `.mjs`, `.cjs`, `.jsx`, `.mts` beside the script, `tests/loadx`, `tests/load.js`, `tests/api`, `tests/e2e`, nested `tests/load` folders). A mutated block (wider glob plus `no-undef` off) is detected by the same probe (§3.1).
- **The harness and fixtures are not on any lane that ships or enforces.** Nothing outside the PR's own paths mentions `spk04`; the bootstrap, migration, seed and schema paths are byte-identical; product code cannot import the harness (a protected lint rule fires); the runner reads the SPK-08 files in place and those are unchanged (§3.2, §3.3). The one gap is forward-looking: no Dockerfile or `.dockerignore` exists yet, and the planned `tests` pattern does not match `prisma/tests`. **PR27-SEC-01 (LOW)**, owner TASK-014.
- **The fixtures create no role and no `SECURITY DEFINER` function.** The only function is the data-model §5.7 `platform.audit_vault_guard()` (invoker, pinned `search_path`), the only grants go to `platform_app` (the audit ones equal data-model lines 2686-2688), and everything runs in a Testcontainers database with random per-run credentials (§3.3).
- **The k6 image pin is real.** The digest is a content-verified OCI index whose `linux/amd64` and `linux/arm64` image manifests are identical to the ones the moved `2.2.0` tag serves now (only the attestation manifests differ). The image is non-root and the run exposes four `-e` values and one read-only directory (§3.4).
- **The evidence is clean.** Nine files scanned for secrets, e-mail addresses, user names, paths, IP addresses, MAC addresses, connection strings and key shapes: no hit. `host-spec.json` carries the §7.10 fields plus non-identifying extras (§3.5).
- **The integrity claims hold for what was tested, and three of the assertions encode the SPK-08 prototype, not the product design.** **PR27-SEC-02 (INFO)**: they must not be ported as expected values (§3.7).

**Rulings on the six questions** (details in §3):

| | Question | Ruling |
|---|---|---|
| (a) | Is the ESLint block scoped to `tests/load/**/*.js` with no weakening elsewhere? | **Yes.** 49-path effective-config diff: 3 differ (globals and one setting), 46 identical, 0 rule differences; positive and mutation controls. §3.1 |
| (b) | Can the harness or fixtures reach a shipped image, the bootstrap or migration lanes or the seeds, and do they weaken immutability, RLS or the guard? | **Not today; one forward gap.** No lane reads them; SPK-08 files are unchanged and read in place; the guard is installed after the fixture as in the real lane; the fixtures add no role and no definer function. The image gap is **PR27-SEC-01 (LOW)**. §3.2, §3.3 |
| (c) | Is the k6 image pinned by digest, and is the run free of network and secret exposure? | **Pinned and verified.** The run uses the default bridge network (it must reach `host.docker.internal`), so "no network" is not claimed; secret exposure is nil. Hardening flags for the lane-B reuse are **PR27-SEC-04 (INFO)**. §3.4 |
| (d) | Do the evidence files hold secrets, PII or host identifiers beyond the host-spec policy? | **No.** §3.5 |
| (e) | Lock delta, D-ORCH-021 levers? | **None, none.** §3.6 |
| (f) | Are the integrity claims (42501 for UPDATE and DELETE as `platform_app` and as the superuser on entries and vault) consistent with SPK-08? | **Consistent for the legs tested** (all four as `platform_app`; superuser UPDATE of entries and DELETE of the vault). The PR body's "both get 42501 on UPDATE/DELETE of entries and vault" is broader than the runner asserts. Three assertions mirror the prototype: **PR27-SEC-02 (INFO)**. §3.7 |

Findings: **1 LOW and 4 INFO**, none blocking. No Critical, High or Medium.

## 2. Method

| Probe | What it did | Result |
|---|---|---|
| **P-1** Effective-config diff | ESLint `calculateConfigForFile` for 49 paths against the merge-base configuration and the head configuration (`git archive` extracts of `eslint.config.mjs`, `tools/eslint-rules`, `tools/lint` and the workspace manifests, `node_modules` junctioned to the main checkout). Root paths scrubbed; a deep diff of every leaf. Control 1: the three in-scope paths must differ. Control 2 (mutation): a copy with `files: ['tests/**/*.js']` and `no-undef` off must light up the near misses | §3.1 |
| **P-2** Real lint runs | `ESLint#lintFiles` on the real k6 script with the head and the base configuration; a hostile sample under `tests/load` (process, require, `==`, `var`, a bcrypt import, `window`, an unlisted k6 module); a `.mjs` neighbour | §3.1 |
| **P-3** Harness lint | The six harness files with the head configuration, type-aware rules disabled (a project service over the whole repository does not fit the host); a hostile control in the same folder; a product file (`apps/api`, `packages/audit`) importing the harness | §3.2 |
| **P-4** Source review | Whole diff of `eslint.config.mjs`, `tests/load/spikes/spk04-audit.js`, both fixtures, `server.ts` and `runner.ts` (all 1 431 lines), the SPK-08 SQL they reuse, `tools/db/bootstrap.ts` (lane directory), `check-suppressions.mjs`, `.semgrep/raw-sql.yml`, data-model §5.7 and the grants block | §3.1 to §3.3 |
| **P-5** Registry probe | Anonymous GETs of the manifest by the pinned digest (sha256 of the body compared with the digest), the `linux/amd64` manifest and config blob, the current `2.2.0` tag index and the tag list | §3.4 |
| **P-6** Evidence scan | A Node scan of the nine evidence and document files (patterns in §3.5) | §3.5 |
| **P-7** Default-rule Gitleaks emulation | A per-line emulation of the 221 v8.30.1 default rules over the 26 PR files and the added `DECISIONS.md` lines; a run-time-generated positive control (2 findings, discarded, never written to a record). A hint only; lane A's real run (4 commits, exit 0 per the PR) is the proof | 0 findings |
| **P-8** Lock, workflow and merge checks | Three-dot diffs against main; `git merge-file` of this PR's `eslint.config.mjs` with the versions of open PRs #20 and #24 | §3.6, §6 |
| **P-9** Record check | Main's `tools/ci/check-security-owned-paths.mjs` against a scratch `clone --shared`, with six negative controls and four positive cases | §7 |

## 3. Rulings

### 3.1 The ESLint block (question a)

The diff is six lines in `eslint.config.mjs` (472-477 at the head), placed after the `disableTypeChecked` block for plain JavaScript:

- `files: ['tests/load/**/*.js']`, `languageOptions.globals` = `__ENV`, `__VU`, `__ITER`, `open`, `console` (all `readonly`), and `settings['import-x/core-modules']` = `['k6/http', 'k6/execution']`. No `rules`, no `ignores`, no `plugins`, no `linterOptions`.

| ID | Probe | Result |
|---|---|---|
| E1 | 49 paths, head against base | **3 differ**: `tests/load/spikes/spk04-audit.js`, `tests/load/x.js`, `tests/load/a/b/c/deep.js`. The only differing leaves are `.languageOptions.globals` and `.settings.import-x/core-modules`. **0** `.rules` differences |
| E2 | The 46 paths that must not differ | All identical: `tests/load/x.{ts,mjs,cjs,jsx,mts}`, `tests/loadx/y.js`, `tests/load.js`, `tests/api/x.js`, `tests/e2e/x.js`, `tests/e2e/web.spec.ts`, `load/x.js`, `apps/api/tests/load/x.js`, `apps/api/src/tests/load/x.js`, `packages/audit/src/tests/load/x.js`, the config file itself, `tools/**`, `apps/{api,worker,web,admin}`, `packages/{audit,authz,pricing,shared,ui}`, the harness (`server.ts`, `runner.ts`, `chain.test.ts`), `prisma/seed`, `prisma/bootstrap`, `jest.config.ts`, `prisma.config.ts` |
| E3 | Mutation control: `files: ['tests/**/*.js']` plus `rules: { 'no-undef': 'off' }` | **7 differ**: the three above plus `tests/loadx/y.js`, `tests/load.js`, `tests/api/x.js`, `tests/e2e/x.js`, and `.rules.no-undef` (2 to 0) shows. The probe can see a widened scope and a rule change |
| E4 | The real script, head against base | **0 messages** with the block; **8** without (`import-x/no-unresolved` for `k6/http` and `k6/execution`, `no-undef` for `__ENV` x4, `__VU`, `__ITER`). The block is needed, and is enough |
| E5 | Hostile sample under `tests/load` with the head configuration | 10 messages: `import-x/no-unresolved` for an unlisted k6 module (the list is exact-name), `no-restricted-imports`, `import-x/no-extraneous-dependencies` and `boundaries/dependencies` for a bcrypt import, `no-var`, `no-undef` for `process`, `eqeqeq`, `no-undef` for `window`, `no-undef` for `require`, `platform/node-path-only`. Every security rule still fires; only `console` and `__ENV` moved to "known" |
| E6 | A `.mjs` neighbour in the same folder using `k6/http` and `__ENV` | Still 2 errors: the block does not extend to `.mjs` |
| E7 | Suppression policy | `tools/lint/check-suppressions.mjs:58` (`INLINE_CONFIG`) matches `eslint`, `eslint-env` and `globals?` block comments, and the lint script runs it, so the claim "inline `global` comments are banned, the config block is the only way" is true |

Notes. `open` and `console` are declared but unused by the only script (code review R1-n1 agrees). That grants nothing: `no-console` applies only to `APP_AND_PACKAGE_SOURCES`, and k6's `open()` is an init-stage file read. The first k6 script that calls `open()` for a data file (T-QA-06) should be read for the path it reads. The block adds no Node global, so `process` and `require` stay errors in k6 scripts, which is right (the k6 runtime has neither).

A text merge of this file with the versions in open PRs #20 and #24 is clean (`git merge-file`, 0 conflicts, the block present once in each result). Their hunks are elsewhere in the file. A merge still changes the owned file, which matters for the record (§7 case F).

### 3.2 Reachability of the harness and the fixtures (question b)

| ID | Check | Result |
|---|---|---|
| R1 | `git grep` for `spk04` / `SPK-04` at the head outside the PR's own paths, `docs/` and `.claude/` | **0 hits** |
| R2 | Bootstrap lane | `tools/db/bootstrap.ts` reads `prisma/bootstrap/*.sql` with the name rule `NN-name.sql`. The fixtures are under `prisma/tests/spikes/spk04/fixtures/`. The runner copies only `^0\d-[a-z0-9-]+\.sql$` files of `prisma/bootstrap` to its scratch lane (today `00` to `02`) |
| R3 | Migration, seed and schema lanes | `prisma/migrations`, `prisma/seed`, `prisma/schema` are byte-identical to the base. The runner only reads the migrations, as the migrator, in its own database. The migration linter and the immutability check never see the fixtures |
| R4 | Product code importing the harness | **Blocked.** A probe file in `apps/api/src/platform` and one in `packages/audit/src` importing `prisma/tests/spikes/spk04/chain.js` each get `import-x/no-relative-packages` (a protected rule: not suppressible inline). A same-package import is clean. The `prisma-tests` boundaries category may import only `tools/db`, `tools/test-support`, `tools/authz`, the database platform, `prisma/generated`, `prisma/seed` and itself |
| R5 | Jest, coverage, tsc | Only the three `*.test.ts` files run (`test:unit`). `runner.ts` imports `./server.js` for types only (`import type`), so no test or tool starts the server. `tools/tsconfig.json` is `noEmit`; no tsconfig changed |
| R6 | Static analysis | The harness contains no `eval`, `new Function`, `$queryRawUnsafe`, `$executeRawUnsafe`, `Prisma.raw`, `Prisma.join` or `set_config`. Every SQL value goes through a tagged template or a `$n` placeholder. The only process spawns are `docker` and the replica `node` (argument arrays, no shell). `.semgrep/raw-sql.yml` excludes `tests/` anyway. The six harness files lint clean with the head configuration (P-3), and a hostile control in the same folder gets four errors (bcrypt import x3, `platform/tenant-context-sql`) |
| R7 | Shipped images | **No Dockerfile and no `.dockerignore` exist yet** (TASK-014, batch 0.5). **PR27-SEC-01** |
| R8 | Does the harness reach a database other than its own? | No. `PlatformPostgres.start()` creates a Testcontainers cluster (image pinned by digest, superuser and role passwords random per run); no variable points the runner at another cluster. `SPK04_DATABASE_URL` is set by the runner for its own replicas |

If the code reviewer's ruling to drop `server.ts`, `runner.ts` and fixtures 20 and 30 is adopted, R2, R3, R6 and R8 become moot and nothing in this record is weakened; if the harness is kept (ADR-0007 amendment 10 item 8 as drafted), the conditions it lists ("no product code imports from either tree, not counted in coverage, not in any image, the `SPK04_AUDIT` switch stays harness-only") are exactly the controls above, and PR27-SEC-01 is the missing test of the third.

### 3.3 The SQL fixtures and the SPK-08 reuse (question b, continued)

- **Statement inventory.** `20-spk04-audit-write.sql`: `SET ROLE platform_audit_owner` ... `RESET ROLE`, three `CREATE TABLE`, one `CREATE FUNCTION` (`platform.audit_vault_guard()`, plpgsql, **not** `SECURITY DEFINER`, `SET search_path = pg_catalog, pg_temp`), two triggers, four `ALTER ... OWNER TO platform_audit_owner`, three `GRANT`s. `30-spk04-business.sql`: `SET ROLE platform_migrator`, one `CREATE TABLE` (`spk04_orders`), one index, `ENABLE` and `FORCE ROW LEVEL SECURITY`, one policy, one `GRANT`. No `CREATE ROLE`, `ALTER ROLE`, `DROP`, `REVOKE`, `DISABLE TRIGGER`, `NO FORCE`, `CREATE EXTENSION`, `COPY`, `DO`, `set_config`, `session_replication_role` or `ALTER DEFAULT PRIVILEGES`.
- **Grants.** `SELECT, INSERT` on `audit_pii_vault` and `data_subjects`, `SELECT, INSERT, UPDATE` on `audit_stream_heads`, all to `platform_app`: identical to `data-model.md` lines 2686-2688. The `platform_erasure` grants are not in the fixture, so the vault guard's erasure branch is dead in the benchmark database (the role does not exist there). The business table grants `SELECT, INSERT, UPDATE` to `platform_app` under the `tenant.sql` policy text with `FORCE`.
- **Fidelity.** All 11 statements of the data-model §5.7 block (two tables, the guard function, two triggers, the `ALTER ... OWNER TO` lines) occur in the fixture verbatim after comment and whitespace normalisation (Node comparison, 11 of 11, 0 missing); the fixture adds the `SET ROLE` wrapper, the `audit_stream_heads` table and the grants. The `audit_stream_heads` columns follow the data-model list.
- **SPK-08 reuse "unchanged".** `git diff --stat` of all of `prisma/tests` except `spikes/spk04` (so `spikes/spk08/`, the SPK-08 suites and `harness/` included) between the merge base and the head is **empty**; with `spk04` included it shows the PR's 10 files and 2 086 insertions (control). The runner reads `spk08/10-audit.sql` and `spk08/90-audit-ddl-guard.sql` in place (no copy, no edit) and applies them as `10`, fixture `20`, `90`, so the guard is installed after all audit DDL, as the real lane does (data-model §5.2 amendment).
- **The guard covers the fixture's objects.** `c_tbl` matches `audit_*` and `data_subjects`; `c_fn` lists `audit_vault_guard`. The runner's read-back shows both event triggers and all six audit triggers enabled, and the business table (`spk04_orders`, owned by the migrator, not matching `c_tbl`) is created through the guard without a refusal, as it should be.
- **Not a bootstrap or migration file.** The fixture carries audit DDL without the rule-12 `@audit-ddl security-approved` marker. That is correct for a file outside the two lanes the rule governs, and is one more reason it must never be copied into `prisma/bootstrap` (TASK-021 owns the real file; PR #24 already holds it).

### 3.4 The k6 image and the container run (question c)

| ID | Check | Result |
|---|---|---|
| K1 | The digest exists and is what it claims | `grafana/k6@sha256:5221b620…` returns `200`, an OCI image index, and `sha256(body)` equals the pinned digest. Entries: `linux/amd64` (`a0709829…`), `linux/arm64` (`ea746c18…`) and two attestation manifests |
| K2 | The claim "the tag has moved" | **True, and harmless.** The `2.2.0` tag now resolves to index `9bd01d69…` (last updated 2026-08-10, one minute after the image was created). Its `linux/amd64` and `linux/arm64` image manifests are the **same digests** as the pinned index's; only the two attestation manifests differ. The pinned bytes and the tag run the same image |
| K3 | Image facts (`linux/amd64` config) | Created `2026-08-10T13:52:37Z` (more than the 7-day cooldown); `User` = `12345` (non-root); entrypoint `k6`; no `Cmd`, no exposed ports, no volumes; working directory `/home/k6`; only `PATH` in `Env` |
| K4 | Pin form | `repo@sha256:<64 hex>` matches lane A's `image-digest` regex (`@sha256:[0-9a-f]{64}\b`) if it is ever used in a workflow. A `tag@digest` form would have been misleading here, as the PR says |
| K5 | What the container sees (`runner.ts:272`) | `docker run --rm -v <repo>/tests/load/spikes:/scripts:ro -e RATE -e DURATION -e TARGETS -e ORGS <image> run --quiet /scripts/spk04-audit.js`. One read-only directory holding one file; four plain `-e` values (a number, a duration, two loopback URLs, a number); no `--env-file`, no host environment, no socket, no `--privileged`, no `--network host`. Arguments are an array (`spawn`, no shell), so the operator-set numbers cannot inject flags |
| K6 | Network | Default bridge network. It cannot be `--network none` because the run must reach `host.docker.internal` (the replicas bind to `127.0.0.1`; Docker Desktop relays). The container therefore has internet egress and can reach host loopback services. Accepted for a local spike with a digest-pinned, non-root publisher image; the hardening for the reuse is **PR27-SEC-04** |
| K7 | Output handling | `handleSummary` prints the k6 summary between markers; the runner parses it with a regex and `JSON.parse`. The summary holds metrics and options only (checked in the committed evidence: keys `root_group`, `options`, `state`, `metrics`) |

### 3.5 The evidence files (question d)

Scanned: the eight evidence files and `docs/04-plan/spikes/SPK-04.md` (nine files), then the PR's code files, the other spike sheets and the added `DECISIONS.md` lines for comparison. Patterns: Windows and POSIX user paths, any drive path, the operator's user and computer names (read from the environment, never printed), the author names, e-mail addresses, IPv4, IPv6 and MAC addresses, connection strings, `password`/`secret`/`api key`/`bearer`/`authorization` words, JWT and PEM shapes, cloud and token key shapes, 64-hex strings, UUIDs, Docker identifiers.

- **No hit** in the eight evidence files and `SPK-04.md` for: paths, user or computer names, e-mail addresses, MAC or IPv6 addresses, connection strings, secret words, JWT, PEM and key shapes, UUIDs.
- **Explained hits:** `127.0.0.1` and `host.docker.internal` as descriptive text of the bind and the k6 target; `token` in the doc prose (vault tokens); 64-hex strings = the two image digests in `host-spec.json` and, in `k6-audit-ab.summary.json`, the **ephemeral Testcontainers container ID and its random name** from `docker stats` (the container is gone after the run).
- **PR code files:** the only address-like or identity-like strings are `203.0.113.0` (RFC 5737 documentation range) in `chain.ts` and its test, `seed@example.test` (reserved domain) and a `+1555` phone prefix in the seeder and generator, the fixed synthetic UUIDs and the one pinned SHA-256 vector in `chain.test.ts`, and `api_key` / `apiKey` as audit-column and field names. The replicas generate their HMAC, encryption and IP-hash keys with `randomBytes` at start and never write them out (`server.ts`, "Run-time random keys (never persisted)"); the database passwords are random per run (`prisma/tests/harness/postgres.ts`).
- **`host-spec.json` against TEST-STRATEGY §7.10.** The policy fields (CPU model, cores, RAM, Docker version, Node version, CPU series) are present. Extras: OS build string (`Windows 11 Pro 10.0.26300`), free RAM at start, Docker VM sizing, six PostgreSQL settings, the Postgres and k6 digests, the replica and transaction options. None identifies a person or a machine (no hostname, user, domain, serial, MAC or address). Not a finding.
- **Size and location.** 139 KB and 136 KB per run directory (policy cap 5 MB). The directory is `docs/05-quality/performance/spikes/SPK-04/`, outside the lane-B `runs/` tree (D-TASK018-05); the code review confirmed `quality:check-evidence` and `quality:prune` read only `runs/`.
- **Provenance.** `git diff c037470 aa1cfb1` over the harness and the k6 script is two comment or path lines in `runner.ts`, so the committed code produced the evidence. The 150 rps run says `"dirty": true` and the 300 rps run `false`; I concur with code review R1-n4 (most likely the first run's untracked directory) and add nothing.
- **Gitleaks emulation (P-7).** 0 findings over 26 inputs; the run-time positive control produced 2.

### 3.6 Lock delta and D-ORCH-021 levers (question e)

- `git diff --stat origin/main...aa1cfb1 -- package.json package-lock.json .npmrc '**/package.json' tools/ci tools/quality tools/deps .github` is **empty** (three-dot form, D-ORCH-021). There is **no lock delta** and no new dependency; the harness uses `pg`, `tsx`, `testcontainers` and the Prisma client that the repository already pins.
- `.github/**` is untouched, so none of `RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, a folded `run: >` on a gate step, or a `$GITHUB_ENV` / `$GITHUB_PATH` write can have moved. The k6 image is not referenced by any workflow.
- No `-bench` build profile, no `APP_ENV` value and nothing under `packages/config` or `apps/**` changed (PR3-SEC-11 stays open: PR27-SEC-05).

### 3.7 The integrity claims (question f)

| Claim (PR body / SPK-04 §3) | What `runner.ts` asserts | SPK-08 | Ruling |
|---|---|---|---|
| `platform_app` gets 42501 on UPDATE and DELETE of `audit_entries` and `audit_pii_vault` | Four attempts as `platform_app` inside `BEGIN ... ROLLBACK` (`runner.ts:530-533`), each must be `42501` | SPK-08 SEC-TC-43 asserts the migrator's tamper list (42501); it has no direct `platform_app` UPDATE or DELETE probe (the grant is `SELECT, INSERT`, C5) | **Consistent with the grants, and the first direct probe.** Both runs: four `permission denied` |
| The superuser gets 42501 on UPDATE and DELETE of entries and vault | **Two** attempts: UPDATE of `audit_entries` (trigger `AUDIT_IMMUTABLE: UPDATE on audit_entries_2026_11`) and DELETE of `audit_pii_vault` (`AUDIT_VAULT_IMMUTABLE: DELETE`), `runner.ts:534-535` | SPK-08 asserts the superuser UPDATE of entries the same way (the partition-naming message, F-07) | **Consistent with SPK-08; narrower than the PR body.** The sheet (§3 (b')) says exactly this. DELETE of entries and UPDATE of the vault as the superuser, and TRUNCATE, are not exercised here (TASK-033; data-model line 3084 lists them) |
| Chains intact under overload | Every entry of every stream recomputed (140 905 + 82 213 = 223 118), gap, link, order, head and global-uniqueness checks, 0 failures | n/a | **Holds** for the prototype writer (the PR body adds the two runs, correctly) |
| Triggers, DDL guard and FORCE RLS intact | `tgenabled = 'O'` and `evtenabled = 'O'` (`runner.ts:582`), `relforcerowsecurity` on `audit_entries` and `spk04_orders` (`runner.ts:586`) | The prototype state | **True of the prototype, wrong as a template for the product:** PR27-SEC-02 |
| The DDL guard is the SPK-08 one | `eventTriggers.length === 2` | Same two triggers | **Holds** |

### 3.8 What this record covers when the head moves

Code review R1 is CHANGES_REQUESTED, with a recommendation to delete the four DB-coupled files and edit the spike document. Such a fix is a deletion plus documentation: it touches no security-owned path, so it needs no delta round (§7 case I). What does void the record is any later change to `eslint.config.mjs`, including one that arrives through a merge of main; open PRs #20 and #24 both edit that file, so whichever of the three merges later needs a merge-only security round (§7 case F).

## 4. Test evidence

| Item | Result |
|---|---|
| Effective-config diff, 49 paths | 3 differ (globals and one setting), 0 rule differences, 46 identical |
| Mutation control on the diff | 7 differ and `no-undef` shows |
| Real script, head against base | 0 messages against 8 |
| Hostile sample under `tests/load` | 10 messages; `.mjs` neighbour 2 messages |
| Harness files with the head configuration, type-aware rules off | 6 files, 0 messages; hostile control 4 messages |
| Product file importing the harness (`apps/api`, `packages/audit`) | `import-x/no-relative-packages` on both; same-package control clean |
| Registry probe | digest verified (sha256 of the body), amd64 and arm64 manifests shared with the `2.2.0` tag, user `12345` |
| Evidence scan | 9 files, no secret, PII, path or host identifier |
| Gitleaks emulation | 0 findings; control 2 |
| Text merge with PRs #20 and #24 | 0 conflicts each |
| Gate table in the PR body (lint, format, typecheck, unit, build, `tools/ci`, evidence check, Gitleaks, commitlint) | Taken as reported, not re-run |
| Not run | Semgrep (not installed on the host; lane A runs it), Docker, the benchmark, k6, `test:unit`, build, coverage, integration |

## 5. Findings

| ID | Severity | Title | CWE | OWASP | Where | Owner | Status |
|---|---|---|---|---|---|---|---|
| PR27-SEC-01 | LOW | Nothing keeps `prisma/tests/**` (SPK-04 harness, SPK-08 and SPK-04 throwaway audit DDL) out of the images TASK-014 will build; the planned `.dockerignore` entry `tests` does not match `prisma/tests` | CWE-489 | A05:2021 | `prisma/tests/spikes/spk04/**`, `prisma/tests/spikes/spk08/*.sql`; `platform.md:233` | TASK-014 (devops), qa-lead | Open |
| PR27-SEC-02 | INFO | Three runner assertions encode the SPK-08 prototype state, not the product design (FORCE RLS on `audit_entries`; `tgenabled = 'O'`; `evtenabled = 'O'`); the superuser legs are two of four | CWE-1068 | A04:2021 | `runner.ts:530-535`, `:582`, `:586`; SPK-04.md §3 (b'), (c), (d) | principal-architect (wording), TASK-280, TASK-033 | Open |
| PR27-SEC-03 | INFO | The harness server has an undocumented bind override, and the runner hands its whole environment to the replicas | CWE-1327 | A05:2021 | `server.ts:654`; `runner.ts:219` | TASK-280 (if kept) | Open |
| PR27-SEC-04 | INFO | The k6 container runs with Docker defaults (capabilities, writable root file system, no limits, bridge network) | CWE-250 | A05:2021 | `runner.ts:272` | TASK-280 / devops | Open |
| PR27-SEC-05 | INFO | PR3-SEC-11 / SEC-TC-18 stays open: no `-bench` profile exists, the harness's audit-off is a runtime switch in a test file, and the threat-model wording is still `APP_ENV=benchmark` | CWE-778 | A09:2021 | `server.ts:74`; `threat-model.md` T-88, AC-53, SEC-TC-18; `nfr-traceability.md` NT-AUDIT-005-a | TASK-030 / TASK-280, security-analyst (text) | Open |

### PR27-SEC-01 (LOW): nothing keeps `prisma/tests/**` out of the images

**Description.** The repository has no Dockerfile and no `.dockerignore` yet (TASK-014 builds `prisma/Dockerfile` for the migrate job and the four app images). `platform.md:233` plans "a strict `.dockerignore` [that] excludes `.git`, `.env*`, `node_modules`, `docs`, `tests`, `coverage`, `*.pem` and `*.key`". Docker matches `.dockerignore` patterns against the context root, so a bare `tests` excludes `/tests` and not `/prisma/tests`. The migrate image has to carry parts of `prisma/` (`migrations`, `bootstrap`, `seed`, `schema`), and the natural instruction is `COPY prisma ./prisma`. That would put into a production-image layer: the SPK-08 prototype SQL (`SET ROLE platform_audit_owner`, grants, the DDL guard text), this PR's two fixtures, and, if the harness is kept, an unauthenticated HTTP server whose `SPK04_AUDIT=off` is a runtime audit-off switch (the class of T-88). SPK-08 already put the first group there in PR #12; this PR adds about 2 100 lines under `prisma/tests/spikes/spk04`.

**Exploitability and impact.** Nothing starts or applies these files, so there is no direct path. The harm is dormant code and prototype audit DDL in a production artefact, which breaks the "not in any image" condition of ADR-0007 amendment 10 item 8 and makes a later accidental `psql -f prisma/tests/...` or `node ... server.ts` in an image possible. Impact low, likelihood medium: LOW.

**Remediation (code level), in TASK-014.**
```
# .dockerignore at the repository root. Docker anchors patterns at the context root, so say it for every depth.
**/tests
**/spikes
**/fixtures
**/*.test.ts
docs
.claude
```
and in the Dockerfiles copy explicit paths only (`COPY prisma/migrations prisma/migrations`, `prisma/bootstrap`, `prisma/seed`, `prisma/schema`, `prisma.config.ts`), never `COPY prisma ./prisma` or `COPY . .`.

**Verification tests.** (1) A lane A static test beside `check-install-flags`: parse `.dockerignore` with a Docker-compatible matcher and assert that `prisma/tests/spikes/spk04/server.ts`, `prisma/tests/spikes/spk08/10-audit.sql` and `tests/load/spikes/spk04-audit.js` are ignored, and that no Dockerfile `COPY`s `.`, `./` or the bare `prisma` directory. (2) An image-content check in TASK-014's image suite: `docker run --rm --entrypoint sh <migrate-image> -c 'find / \( -path "*/prisma/tests*" -o -path "*/tests/load*" \) -not -path "/proc/*" 2>/dev/null'` prints nothing, for every image.

### PR27-SEC-02 (INFO): runner assertions that mirror the prototype

**Description.** `runner.ts` reads back (i) `relforcerowsecurity` on `audit_entries` and `spk04_orders` and calls it intact, (ii) `tgenabled = 'O'` for every audit trigger and (iii) `evtenabled = 'O'` for both event triggers. The product design differs on all three: `audit_entries` is SYSTEM with **no RLS** and the prototype's policies are "not ported" (data-model §5.2 amendment, PR12-SEC-08; code review R1-m2 raises the first), and the triggers and event triggers are created `ENABLE ALWAYS` (`tgenabled = 'A'`, `evtenabled = 'A'`; D-ARCH-076, data-model line 3243). The PR body's "FORCE RLS intact" is true of the prototype and of `spk04_orders`, and says nothing about the product's `audit_entries`. Separately, the superuser legs of the immutability check are two of four (§3.7).

**Impact.** If the lane-B `audit-ab` integrity step (T-QA-06 absorbs the arm loop and the evidence writer) or a TASK-033 case copies these assertions, it fails on the real store or, worse, is bent to pass by enabling origin-mode triggers. Evidence value for O4 stays with TASK-033 and C14.

**Remediation.** SPK-04.md §3 (c) and (d) gain "SPK-08 prototype state" qualifiers (R1-m2 already asks for (d)). T-QA-06's integrity step asserts the product state: no `audit_entries` RLS row (C1 allow-list), `tgenabled = 'A'`, `evtenabled = 'A'`, and the four superuser legs plus TRUNCATE.

**Verification test.** In TASK-280's integrity step: a planted `ALTER TABLE ... ENABLE TRIGGER` (origin) on an audit trigger makes the step fail.

### PR27-SEC-03 (INFO): harness server bind override and environment pass-through

**Description.** `server.ts:654` listens on `process.env['SPK04_BIND'] ?? '127.0.0.1'`. The variable is documented nowhere (not in the runner's environment list, SPK-04.md or the PR). The server is unauthenticated: `GET /__stats`, `POST /__reset` and `GET|POST /op/*` run SQL as any seeded tenant against the run's database. `runner.ts:219` starts the replicas with `...process.env`, so every operator variable (cloud credentials, tokens) reaches the child, and would reach a product process if T-QA-06 reused `startReplicas` for an image.

**Exploitability.** Needs the operator to set the variable; data are synthetic and the cluster is throwaway with random passwords. Low (code review R1 §5 reaches the same view).

**Remediation (only if the harness is kept).** Bind `'127.0.0.1'` as a constant and delete the override; pass an explicit `env` (`PATH`, `SYSTEMROOT`, `TEMP`, `TMP`, `NODE_ENV` and the `SPK04_*` keys, copied by a small helper) instead of `...process.env`.

**Verification test.** A unit test over the spawn options (`env` has no key outside the allow-list; a canary variable set in the test process is absent in the child), and a grep test that `server.ts` has no `process.env` read other than `SPK04_*` names.

### PR27-SEC-04 (INFO): k6 container flags for the lane-B reuse

**Description.** The container runs without `--cap-drop=ALL`, `--security-opt no-new-privileges`, `--read-only`, `--pids-limit` or memory limits, on the default bridge network. Mitigations that exist: digest pin (verified), non-root user, one read-only one-file mount, four `-e` values (§3.4). Code review R1 §5 adds that the `-v` pattern must not migrate into `.github/workflows` (its workflow-policy tripwires apply to those files only).

**Remediation (for T-QA-06 / TASK-280, lane B).** Run with `--cap-drop=ALL --security-opt=no-new-privileges --read-only --tmpfs /tmp --pids-limit=256 --memory=1g`, a dedicated user-defined network (or `--add-host=host.docker.internal:host-gateway` on Linux) instead of the default bridge, `--pull=never` after a one-time pull by digest, and keep the digest in one constant that a test compares with the manifest.

**Verification test.** A unit test over the `docker run` argument list (flags present, image matches `@sha256:[0-9a-f]{64}`, no `-e` key outside the allow-list, mount read-only).

### PR27-SEC-05 (INFO): PR3-SEC-11 / SEC-TC-18, the `-bench` profile and the runtime switch

**Description.** This PR adds no build profile, no `APP_ENV` value and nothing in `packages/config` (confirmed, §3.6), so SEC-TC-18 stays uncovered, as PR #3 recorded. The harness's `SPK04_AUDIT=off|on|batched` (`server.ts:74`) is a runtime audit-off switch, confined to a test file by the lint and boundary rules in §3.2. Two closures are owed.
1. **Text (mine).** `threat-model.md` T-88, AC-53, SEC-TC-18 and `nfr-traceability.md` NT-AUDIT-005-a still say "`APP_ENV=benchmark`"; ADR-0018 (line 91) and the batch-3 rulings fixed the vocabulary as "the `-bench` image refuses to start unless `APP_ENV` is `local` or `test`". The batch-3 ruling asked security-analyst to align the text before TASK-018 adds a profile; TASK-018 did not add one, so the trigger is the first task that does (TASK-030 or TASK-280). The alignment is owed by security-analyst, in a docs round before that PR is reviewed (this review is read-only and does not make the edit).
2. **Control (the task that adds the profile).** Build-time only; the refusal lives in the `packages/config` guards and exits before any application code; the image name cannot be pushed by the CD workflow; SEC-TC-18 starts the image with `APP_ENV=staging` and `production` and expects the refusal exit before any listener opens; the `SPK04_AUDIT` switch is not ported (ADR-0007 amendment 10 item 8).

**Verification test.** SEC-TC-18 in `config-guards`, plus a `check-workflow-policy` case that rejects a push or deploy step naming a `-bench` image.

## 6. Closures and checks owed

| Task / owner | Check | Source |
|---|---|---|
| **TASK-014** (before the first image-building PR merges) | `.dockerignore` and explicit `COPY` paths; the static test and the image-content check of PR27-SEC-01; the `-bench` image is never built here | PR27-SEC-01 |
| **PR #24 / TASK-021** (code review R1-M1 overlaps) | Whichever of #24 and #27 merges second leaves no dangling `spk08` or `spk04` reference; fixture 20 is not copied into `prisma/bootstrap`; the real files carry the rule-12 marker and reviewer entry | §3.3, code review R1 §6.6 |
| **TASK-030** (chain writer, review) | The writer imports nothing from `prisma/tests`; the lock statement's `lock_timeout` is set with `set_config(..., true)` (transaction-local) and never `false`; the 503 `AUDIT_LOCK_TIMEOUT` body is generic and the metric label is the stream kind, not a tenant id; fail-closed rollback of the business transaction; the zero hash as `decode(repeat('00', 32), 'hex')` | ADR-0007 amendment 10 items 1, 2, 7 |
| **TASK-025** (admission bulkhead, review) | The admission key is derived from the server-side context, never a header; the `anonymous` key is one shared bucket (T-85), so an anonymous flood fills it for every guest: edge rate limits stay the control and need their own case | ADR-0007 amendment 10 item 3, T-83, T-85 |
| **TASK-033** | The four superuser legs plus TRUNCATE; no origin-mode trigger passes C14 | PR27-SEC-02 |
| **TASK-280** (T-QA-06, `audit-ab`) | Product-state integrity step; container flags; the integrity step fails closed (code review R1-m4); `open()` reads reviewed; randomised arm order; host-spec fields as §3.5 | PR27-SEC-02, 03, 04 |
| **security-analyst** | Threat-model and `nfr-traceability` wording for the `-bench` vocabulary before the profile PR | PR27-SEC-05 |
| **Whoever merges second of #20, #24, #27** | A merge-only security round for `eslint.config.mjs` (clause (d)); the text merge is clean | §3.1, §7 case F |
| **G3 / G4** | Nothing new. SPK-04 does not retire R-ARCH-04 and is not O2 evidence (INCONCLUSIVE under §7.10); the integrity results prove no property of the product store | PR27-SEC-02 |

References to "ADR-0007 amendment 10" are to the draft that stood in the main working tree (uncommitted) at review time; the security hooks I list in the TASK-030 and TASK-025 rows follow its text and should be re-read against the committed version.

## 7. Record-check simulation (P-9)

Main's `tools/ci/check-security-owned-paths.mjs` (from `ddbeb49`) was run from outside, against a scratch `git clone --shared` at the reviewed head, with this record added as one commit on top. `--pr 27`, base `origin/main` unless stated.

| Case | Scenario | Result |
|---|---|---|
| B | Control: no record in the tree | `missing` ("no record named docs/05-quality/security/PR-0027-*.md for PR #27"), owned = `eslint.config.mjs` |
| A | This record committed on top of the reviewed head | **`pass`**, satisfied by the record at commit `aa1cfb1` |
| A2 | The same against the original merge base `94e8808` | **`pass`** |
| C | Control: `--pr 26` | `missing` (a record of another PR does not count) |
| D | Real main (`ddbeb49`) merged after the record (`-X ours` for the `DECISIONS.md` conflict) | **`pass`**. Main's own owned changes since the merge base (`.github/dependabot.yml`, `.gitleaks.toml`, `tools/ci/sec-static.test.ts`, from PR #25) are not in this PR's net change, so clause (d) ignores them |
| E | Control: `eslint.config.mjs` edited after the record | `missing` ("names aa1cfb1, but eslint.config.mjs changed after it") |
| F | Main itself changes `eslint.config.mjs` (as open PRs #20 and #24 do) and is merged after the record | `missing`, same message. A merge-only security round is needed for whichever of #20, #24 and #27 merges later |
| G | Control: a later table row `Verdict` with the value FAIL | `missing` ("verdict FAIL is not one of PASS, PASS_WITH_FOLLOW-UPS, PASS_WITH_CONDITIONS") |
| H | Control: the head row names the merge base, which lies outside the range | `missing` ("its head row names no commit of this PR") |
| I | The code reviewer's keep/drop outcome: the four DB-coupled harness files deleted and the spike document edited after the record | **`pass`** (no owned path changed) |

Cases B, C, E, F, G and H each fail for the reason the check names, so the passes in A, A2, D and I are not vacuous. The orchestrator's pre-merge `.github/workflows` check uses the three-dot form and finds nothing to compare (§3.6).

## 8. Verdict

| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open at head `aa1cfb1`, so the merge rule is met for the security dimension. **Rulings:** (a) the ESLint block is scoped to `tests/load/**/*.js` and changes only globals and one import setting (3 of 49 probed paths differ, 0 rules); (b) the harness and fixtures reach no image, lane or seed today, reuse the unchanged SPK-08 files and add no role or definer function; (c) the k6 digest is verified and the run exposes no secret (container hardening is an INFO for the lane-B reuse); (d) the evidence holds no secret, PII or host identifier; (e) no lock delta, and no D-ORCH-021 lever moves; (f) the integrity claims hold for the legs tested, and three assertions mirror the prototype, not the product. **Open, none blocking:** PR27-SEC-01 (LOW, TASK-014, before the first image-building PR merges); PR27-SEC-02 to PR27-SEC-05 (INFO; TASK-280, TASK-033, TASK-030 and the security-analyst text alignment). **Record validity:** the record stays valid for later commits that do not change `eslint.config.mjs`, including the code reviewer's drop-the-harness fix and documentation edits (§7 case I) and a merge of main that brings no change to that file (case D). A change to it, including one that arrives through main when PR #20 or #24 lands first, needs a merge-only round (cases E and F). |
