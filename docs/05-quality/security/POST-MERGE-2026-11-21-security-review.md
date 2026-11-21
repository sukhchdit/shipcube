# Security review: post-merge review of #80 to #84 on main (D-ORCH-162 (b))

| Field | Value |
|---|---|
| Scope | The squashes of #80 (`763800f3`), #81 (`339b29d6`), #82 (`61c53b5e`), #83 (`a93a6113`) and #84 (`3c4d9a6d`). The user merged them while hosted CI was billing-blocked (D-ORCH-162, a user-accepted deviation). This review is the replacement evidence (b) of D-ORCH-162. |
| Head | 3c4d9a6de01f5f05e62af5c4af030b7aa8bfac83 |
| Main when written | `f7b6b1a4`. Since `3c4d9a6d`, main has changed only `docs/` and `.claude/agent-memory/` (0 other paths). |
| Reviewer / date | security-analyst, 2026-11-21 |
| Method | Git plumbing on the main checkout's object store: `merge-tree --write-tree`, `diff --raw`, `merge-file`. A `--shared` sparse clone at `3c4d9a6d` ran main's own gates: `check-lockfile`, `licence-check`, `check-dep-age` (registry times fetched by its `--fetch`), `check-audit`, plus `npm ls --package-lock-only` and `npm audit --package-lock-only`. Single-process Node 24 scripts: the OSV `querybatch` API, the npm registry (packuments, `dist.integrity`, `dist.signatures` checked against `-/npm/v1/keys`), GitHub repository advisories through `gh api`, and `npm pack` of old and new tarballs for the diffs. **Not used:** Docker, Jest, ESLint and `npm ci`. Nothing ran in any worktree. **Read only:** the lane-B queue log, and the version fields of one lane-B checkout's `node_modules` (§5). No `.env*` file was opened. |
| Related rounds | D-SECPR080-03 and D-SECPR041-04 (`934bb0f1`) are the merge-only rounds for #81 and #82, run in parallel with this review. They already cover the post-merge review of those two unions, and this record reuses them. My own run of the same proofs agrees with them (§2). |

## 1. Summary

**Verdict:** PASS_WITH_CONDITIONS. No Critical, High or Medium finding is open for #80 to #84.

**(a) The squashes:**
- Each squash tree equals `git merge-tree --write-tree <squash parent> <PR head>`, and each of those merges is clean.
- #81, #82 and #83 were merged through union heads. Each union head is the merge-tree of its two parents, except the named conflict file. Each named resolution is a pure union.
- Every other file that both sides changed is byte-equal to `git merge-file --union`.
- `git diff --raw <main parent> <union head>` equals `git diff --raw <merge base> <PR head>` path by path, old and new blob, for every one-sided path.
- The owned-path sets are unchanged: #80 39, #81 27, #82 27, #83 21. No path was dropped or added.
- The merge-only rounds owed on the union heads are now closed:
  - `2805c809` (#81) by D-SECPR080-03;
  - `22f69a82` (#82) by D-SECPR041-04;
  - `05e1e9da` and `93a14e44` (#83) by this review.

**(b) #84's 28 updates:**
- All 28 pass the policy. That covers 151 new lockfile tuples: 67 in the production closure and 84 dev-only.
- **Licences** are within LICENSE_ALLOWLIST plus the D-ARCH-003 extensions.
- **Advisories:** no Critical or High advisory applies to any locked version in npm audit, in OSV, or in the 28 packages' GitHub repository advisories.
- **Release age:** the youngest tuple was 7.72 days old at merge, so `min-release-age=7` was respected.
- **Install scripts:** none was newly enabled.
- **Registry match:** 151 of 151 integrities and tarball URLs equal the registry's, and 151 of 151 registry signatures verify.
- **Lockfile merge:** GitHub merged #84's lockfile, generated on `0b1efbb2`, into `a93a6113`. The result is the exact leaf union of #84's 868 changed leaves and #82's 7.
- **Fixes:** #84 removes three repository-only advisories from main (POST-SEC-03): vite (Critical), `@opentelemetry/resources` (High) and nodemailer (two Mediums).
- **Bumps that need a test:** none needs a new test now. The runtime-relevant bumps (bullmq; the S3 SDK; swagger-ui-dist; the lint stack that carries the security lint rules) rely on named lane-B suites (C1).

**Findings:**
- POST-SEC-01 INFO: express-rate-limit 8.7.4 carries a repository advisory (Medium). It is not reachable here.
- POST-SEC-02 INFO: cron-parser 5.10.4 carries a repository advisory (Medium). It is not reachable here.
- POST-SEC-03 LOW: lane A's advisory gate cannot see repository-only advisories.
- POST-SEC-04 INFO: main's migration history is out of name order. The three migrations involved are independent.
- POST-SEC-05 INFO: bullmq now records job errors on trace spans. This becomes relevant when TASK-214 wires telemetry.

## 2. (a) Squash and union proofs

### 2.1 Per pull request

| PR | Reviewed head (record) | PR side merged | Union head(s) | Squash (parent) | Squash = merge-tree(parent, PR head) | Named conflict and resolution | Other two-sided paths | Raw-diff equality | Owned paths | Merge-only round |
|---|---|---|---|---|---|---|---|---|---|---|
| #80 | `2abd665f` (PR-0080 round 3) | `0f0d92a0` = `2abd665f` + 9 lane-B evidence files | none | `763800f3` (`0b1efbb2`) | yes, clean, 52 paths | none | none | 52 = 52, 0 mismatches | 39 = 39 | none owed; round 3's binding carries |
| #81 | `3d3a7775` (PR-0081 round 2) | `a5935281` = `3d3a7775` + 9 evidence files | `2805c809` = `a5935281` with `763800f3` | `339b29d6` (`3308474b`) | yes, clean, 61 paths | `prisma/sql/grants.manifest`: main's `idempotency_keys` block (comment and 4 grants), then the PR's `pricing_config_versions` block (comment and SELECT). 0 lines lost, 0 lines added. | `registry.ts`, `c01-c12.int.test.ts`, `grants-manifest.test.ts`: each byte-equal to `merge-file --union` | 61 = 61, 0 mismatches | 27 = 27 | closed by D-SECPR080-03 (round 3 in PR-0081); confirmed here |
| #82 | `0614a90f` (PR-0082 round 3) | `be843ae1` = `0614a90f` + 8 evidence files | `22f69a82` = `be843ae1` with `763800f3` | `61c53b5e` (`339b29d6`, which holds #81; merge base `763800f3`; #81 and #82 share no path) | yes, clean, 49 paths | `apps/api/src/platform/routing/pipeline-guards.test.ts`: main's widened `execute.js` import line and its 4 idempotency imports, plus the PR's `DEFAULT_RATE_LIMIT_SETTINGS` import. Both sides' test bodies are kept. 0 added lines missing, 0 stray lines, 0 resurrected base lines. | `package-lock.json`: byte-equal to `merge-file --union` (the PR's 7 `rate-limit-redis` removal leaves) | 49 = 49, 0 mismatches | 27 = 27 | closed by D-SECPR041-04 (round 4 in PR-0082); confirmed here |
| #83 | `39cac6e5` (PR-0083 round 2) | `57e8ad62` = `39cac6e5` + 9 evidence files | `05e1e9da` = `57e8ad62` with `3308474b` (clean); then `93a14e44` = `05e1e9da` with `61c53b5e` | `a93a6113` (`61c53b5e`); its tree equals `93a14e44`'s tree | yes, clean, 32 paths | `tools/db/grants-manifest.test.ts`, the C5 test title: split into tokens, the title is exactly the clean three-way token merge. It keeps #81's "reference_dataset_versions and the TASK-080 pricing_config_versions" and #83's "SELECT only on the TASK-051 operator_staff_grants". The rest of the file is exactly the clean three-way merge (both sides' list entries). | first union: `registry.ts`, `grants.manifest`, `grants-manifest.test.ts`; second union: `registry.ts`, `grants.manifest`, `tenant-db.real-client.test.ts`. Each byte-equal to `merge-file --union`. | 32 = 32, 0 mismatches (both unions) | 21 = 21 | **closed by this review** (`05e1e9da` and `93a14e44`) |
| #84 | none (no review before merge) | `88933546`, built on `0b1efbb2` | none | `3c4d9a6d` (`a93a6113`) | yes, clean, 7 paths | none | `apps/api/package.json` and `package-lock.json`, against #82's removal: each byte-equal to `merge-file --union` | 7 = 7, 0 mismatches | 7 = 7 | dependency review in §3 |

**Controls:**
- A resolution that keeps only the PR side of `grants.manifest` is detected: it misses main's 7 added lines and differs from the union.
- A title that keeps only one side's clause is detected: it differs from the token merge.
- The raw-diff compare does see main-side paths: 174 paths differ between `a5935281` and `2805c809`.

**Record state:**
- **PR-0080:** round 3's binding to `2abd665f` carries to the squash, because only evidence files followed. Its open LOW and INFO findings are due in part 040-B, whose PR 1 is under its own rounds (D-SECPR040B1-01).
- **PR-0081 and PR-0082:** the post-merge state is recorded in their own rounds 3 and 4 (D-SECPR080-03, D-SECPR041-04).
- **PR-0083:** stays at round 2, and this record closes the merge-only round for `93a14e44` and `05e1e9da`. Its routed items are unchanged: PR051-SEC-02 (b) to TASK-146, -04 to TASK-087, -05 to TASK-089, and -06 to TASK-298.
- **Still open on all four records:**
  - the hosted lane A run and the `security-integration` job on main once billing returns (C2);
  - lane B on the combined tree (C1).

### 2.2 What the unions mean beyond text

- **#83 joined with #81 and #82** in the classification registry (both added entries), in `grants.manifest` (both blocks), in the C5 test title and lists, and in `tenant-db.real-client.test.ts`.
  - The combined schema (the idempotency, pricing, guest-guard and staff-grant migrations together) has not yet run through catalog C1-C14 or the RLS suite on PostgreSQL 18. That is condition C1.
- **Migration order.** #83's `20261120200000_guest_capable_guard` and `20261120210000_operator_staff_grants` landed after #81's `20261121000000_pricing_config_versions` (POST-SEC-04).
  - Each of the three touches only its own objects. There is no catalog-wide statement, no `ON ALL TABLES` and no default privileges.
  - So a fresh database (name order) and a database migrated at `339b29d6` and then at `a93a6113` converge.

## 3. (b) Dependency review of #84

### 3.1 The 28 updates

Registry licence of the new version. "Age" is days between publish and the merge at 2026-11-21T14:57:25Z. "Sig" means the registry ECDSA signature over `name@version:integrity` verified with the npm keys. "Prov" means a SLSA provenance attestation is present.

| Package | From → to | Licence | Closure | Published | Age (d) | Sig | Prov | Advisories that touch the from or to version (GitHub repository; npm audit; OSV) | Security relevance |
|---|---|---|---|---|---|---|---|---|---|
| @redocly/cli | 2.75.0 → 2.78.0 | MIT | dev | 2026-11-12 | 8.99 | ok | yes | none (repo: 3 older, all < 2.33.2) | lane A OpenAPI lint |
| @swc/core | 1.16.21 → 1.16.22 | Apache-2.0 | dev | 2026-11-05 | 16.18 | ok | yes | none (repo: @swc/html only) | Jest transform; has an install script at both versions, never run (§3.2) |
| @testing-library/user-event | 14.6.8 → 14.6.10 | MIT | dev | 2026-11-12 | 9.43 | ok | yes | none | tests |
| eslint | 10.14.0 → 10.15.0 | MIT | dev | 2026-11-13 | 7.72 | ok | no | none | **carries the security lint rules** (C1) |
| eslint-plugin-boundaries | 7.4.1 → 7.4.3 | MIT | dev | 2026-11-12 | 8.91 | ok | no | none | **layering controls**; notes say chore only (README, `@boundaries/*` 3.3.3 / 1.0.2) (C1) |
| eslint-plugin-import-x | 4.17.1 → 4.18.1 | MIT | dev | 2026-11-09 | 12.41 | ok | yes | none | **4.18.0 rewrote the module-analysis core** ("no behaviour change intended") (C1) |
| nock | 15.0.5 → 15.0.6 | MIT | dev | 2026-11-05 | 15.64 | ok | yes | none | tests |
| prettier | 3.9.10 → 3.10.1 | MIT | dev | 2026-11-12 | 9.33 | ok | no | none (repo GHSA-4cm8-f57v-mqm6 affects ≤ 3.9.9) | format gate |
| supertest | 7.3.1 → 7.3.2 | MIT | dev | 2026-11-07 | 14.24 | ok | no | none | api tests |
| typescript-eslint | 8.72.1 → 8.72.2 | MIT | dev | 2026-11-09 | 11.91 | ok | yes | none | **scope manager under the custom rules** (C1) |
| @hookform/resolvers | 7.0.3 → 7.0.6 | MIT | prod (web, admin) | 2026-11-11 | 9.64 | ok | no | none | forms |
| @tanstack/react-query | 5.106.1 → 5.107.1 | MIT | prod (web, admin) | 2026-11-06 | 14.66 | ok | yes | none (repo: a 2024 advisory on another package) | data fetching |
| axios | 1.21.0 → 1.21.1 | MIT | prod (web, admin) | 2026-11-09 | 11.94 | ok | yes | none (repo: 51, all fixed by ≤ 1.20.0) | not imported by production code yet (lint fixtures only) |
| react-hook-form | 7.91.0 → 7.92.0 | MIT | prod (web, admin) | 2026-11-11 | 10.17 | ok | no | none | forms |
| @tailwindcss/vite | 4.3.4 → 4.3.5 | MIT | dev | 2026-11-06 | 14.99 | ok | yes | none | build |
| tailwindcss | 4.3.4 → 4.3.5 | MIT | dev | 2026-11-06 | 14.99 | ok | yes | none | build |
| vite | 8.3.6 → 8.3.8 | MIT | dev | 2026-11-11 | 10.51 | ok | yes | **from-version affected:** repo GHSA-p4f5-76q4-ffq7 Critical (dev-server RCE, ≥ 8.3.0 ≤ 8.3.6, fixed 8.3.7). 8.3.8 is clean. | dev server and build (POST-SEC-03) |
| @aws-sdk/client-s3 | 3.1162.0 → 3.1169.0 | Apache-2.0 | prod (api, worker) | 2026-11-13 | 7.78 | ok | no | none (repo: one Low on `@smithy/config-resolver` < 4.4.0) | **S3 adapter** (C1) |
| @aws-sdk/s3-request-presigner | 3.1162.0 → 3.1169.0 | Apache-2.0 | prod (api) | 2026-11-13 | 7.78 | ok | no | as above | **presigned GET URLs** (C1) |
| @opentelemetry/sdk-node | 0.300.0 → 0.301.2 | Apache-2.0 | prod (api, worker) | 2026-11-12 | 8.91 | ok | yes | **from-version affected:** repo GHSA-qrww-3xmv-qhgm High (`@opentelemetry/resources` ≥ 3.0.0 ≤ 3.1.0, fixed 3.1.1, now 3.1.1). Not in our closure: GHSA-qmwq-c476-x7q2 (instrumentation-fetch/xhr) and GHSA-3v2p-hm54-8qcq (instrumentation-http). | not imported yet (TASK-214) |
| bullmq | 6.7.0 → 6.7.6 | MIT | prod (api, worker) | 2026-11-12 | 8.74 | ok | yes | none on bullmq. Transitive `cron-parser` 5.10.4: repo GHSA-7jm7-f8vg-h8wf Medium (POST-SEC-02) | **queues, schedulers** (C1, POST-SEC-05) |
| cookie | 2.0.1 → 2.0.2 | MIT | prod (api) | 2026-11-05 | 15.76 | ok | yes | none (repo: a 2024 advisory, < 0.7.0) | not imported yet (TASK-052 note §3.3) |
| express-rate-limit | 8.7.3 → 8.7.4 | MIT | prod (api) | 2026-11-09 | 11.74 | ok | yes | **to-version affected:** repo GHSA-cppf-2hm6-mrvm Medium (≤ 8.7.4, fixed 8.7.5) (POST-SEC-01) | `ipKeyGenerator` only, byte-identical |
| jose | 6.2.15 → 6.2.17 | MIT | prod (api) | 2026-11-09 | 11.84 | ok | yes | none (repo: 6, all ≤ 4.15.4) | not imported by production code yet (TASK-052 note §3.3) |
| swagger-ui-dist | 5.34.1 → 5.35.0 | Apache-2.0 | prod (api) | 2026-11-13 | 8.14 | ok | yes | none (repo: 2021, ≤ 4.1.2) | **`/api/docs` page** (§3.3, C1) |
| @aws-sdk/client-sesv2 | 3.1162.0 → 3.1169.0 | Apache-2.0 | prod (worker) | 2026-11-13 | 7.77 | ok | no | as for client-s3 | not imported yet |
| nodemailer | 10.3.1 → 10.5.0 | MIT-0 | prod (worker) | 2026-11-10 | 11.25 | ok | yes | **from-version affected:** repo GHSA-3q53-mvfw-q9v8 and GHSA-2g53-87p2-4qq8, both Medium (≤ 10.4.0, fixed 10.4.1). 10.5.0 is clean. | not imported by production code yet (a lint rule names it) |
| @playwright/test | 1.65.0 → 1.65.1 | Apache-2.0 | dev | 2026-11-13 | 7.74 | ok | yes | none | e2e; browsers only through `deps:rebuild --playwright` (lane C) |

### 3.2 Policy checks over the whole delta (151 new tuples, 145 removed)

| Check | Result | Evidence and control |
|---|---|---|
| Licence | **pass** | Licences of the new tuples: MIT 83, Apache-2.0 54, "Apache-2.0 AND MIT" 11, BlueOak-1.0.0 2, MIT-0 1. The lockfile and the registry agree for 151 of 151.<br>BlueOak-1.0.0 (`minimatch` 11.0.8, `@isaacs/nonrecursive-glob-match` 1.1.0, both dev) and MIT-0 (`nodemailer`, already MIT-0 at 10.3.1) are outside CLAUDE.md §3's literal list. Both are admitted by D-ARCH-003 rev 2, so they are not a violation.<br>Main's `licence-check.mjs` reports only the four pre-existing `licence/missing` entries (`buildcheck`, `cpu-features`, `ssh2`, `svg-tags`, none new). CI resolves them from installed manifests. The same four are reported on `a93a6113` (control). |
| Critical/High advisories | **pass** | `npm audit --package-lock-only` at `3c4d9a6d`: 0 critical, 0 high, 31 moderate. All 31 trace to the two watched advisories GHSA-3g3m-2fjr-6pw4 (glob) and GHSA-g3hv-75wg-m249 (minimatch), dev only. `check-audit.mjs` passes and lists them as watched until 2027-02-12.<br>OSV `querybatch` over all 1,306 registry tuples: the same 4 tuple hits (glob 10.5.0 and 13.0.6; minimatch 9.0.9 and 10.2.6), none on a new tuple. Both positive controls fired: `minimist@0.0.8` 2 hits, `lodash@4.17.15` 5 hits.<br>GitHub repository advisories of the 28 packages: see §3.1 and POST-SEC-01..03. None of them is in the global advisory database yet (`gh api advisories/<id>` answers 404 for all 6), which is why npm audit and OSV are silent. |
| Maintained (release < 18 months) | **pass** | Every new tuple was published within 70 days of the merge. All 28 packages released in November 2026. `check-dep-age.mjs` (maintenance half) reports no stale direct dependency and no deprecated transitive. The registry marks none of the 151 tuples deprecated. |
| `min-release-age=7` at merge | **pass** | The youngest tuples at merge were `eslint` 10.15.0 and `playwright-core` 1.65.1, both 7.72 days old. At the Dependabot commit (14:35:56Z) the minimum was 7.71 days.<br>`check-dep-age.mjs --base a93a6113` passes at the lockfile commit time, at `--now 2026-11-21T14:57:25Z` and at `--now 2026-11-21T14:35:56Z`. Control: `--now 2026-11-18T00:00:00Z` gives 61 `dep-age/cooldown` findings. |
| Install scripts | **pass** | Two new tuples have install scripts: `@swc/core` 1.16.22 and `msgpackr-extract` 3.0.7. Both had them at the previous version, and no `hasInstallScript` flag was newly set. The lockfile and the registry agree on all 151.<br>`.npmrc` (`ignore-scripts=true`, `min-release-age=7`), `tools/`, workflows, Dockerfiles and compose files are unchanged by #84. `deps:rebuild` still runs only bcrypt, the Prisma engine and generate, and opt-in Playwright.<br>The 6 manifests change only dependency version strings: no script or other key, 0 non-version lines. |
| Integrity and source | **pass** | `check-lockfile.mjs --base a93a6113` passes: every new tuple comes from `registry.npmjs.org` with a `sha512-` integrity, and no integrity changed for an unchanged tuple.<br>For 151 of 151 tuples, `integrity` equals the registry's `dist.integrity` and `resolved` equals `dist.tarball`. 151 of 151 registry signatures verify with the npm keys; a tampered-integrity control fails. 113 carry provenance. |
| Lockfile merge correctness | **pass** | #84's lockfile was generated on `0b1efbb2` (before #80) and merged by GitHub into `a93a6113`, which holds #82's `rate-limit-redis` removal.<br>Leaf-level deltas, compared as (path, before, after):<br>- `delta(a93a6113→3c4d9a6d)` equals `delta(0b1efbb2→88933546)` (868 leaves).<br>- `delta(88933546→3c4d9a6d)` equals #82's delta (7 leaves).<br>- The two deltas share 0 leaves; the only package entry they share is `apps/api`, in different keys.<br>- Control: `delta(0b1efbb2→3c4d9a6d)` = 875 = 868 + 7.<br>`npm ls --package-lock-only --all` at `3c4d9a6d` reports exactly one problem, `invalid: effect@3.22.4`. That is TASK-295's `@prisma/config` override, and it is identical at `a93a6113` and at `88933546`. No missing or other invalid edge. |
| Closure moves | note | `semver` 7.8.6 moved from dev into the production closure: bullmq 6.7.6 depends on it and it dedupes to the hoisted copy. The nested `bullmq/node_modules/semver` 7.8.5 was removed; bullmq 6.7.1 notes that bump as "[security]". `semver` is ISC. |

### 3.3 Security-relevant packages: does a bump need a test?

| Package | Used in production? | What changed | Test needed? |
|---|---|---|---|
| express-rate-limit 8.7.4 | `ipKeyGenerator` only (`apps/api/src/platform/rate-limit/policy.ts:11`, used at `:48`) | `dist/index.mjs` changes only `MemoryStore#get` (expired entries) and error handling around `decrement`. `ipKeyGenerator` is byte-identical (agrees with D-SECPR041-04). | No. The existing key-derivation tests hold; POST-SEC-01 covers the advisory. |
| bullmq 6.7.6 | Worker queues and schedulers (`apps/worker/src/platform/queues/*`, `jobs/schedulers.ts`) | `job.js` is unchanged (`moveToFailed`, the stack-trace limit). `worker.js` adds `span.recordException(err)` (line 665 of the ESM dist). `upsertJobScheduler` forces `count: undefined`. The Lua changes are in flow-dedup removal and `moveToFinished`. 6.7.1 and 6.7.2 pin `semver` and other dependencies for security. | No new test. The TASK-035 and TASK-039 suites on real Valkey must pass in lane B (C1). POST-SEC-05 is for TASK-214. |
| @aws-sdk/client-s3, s3-request-presigner 3.1169.0 | `apps/api/src/platform/storage/s3-object-storage.ts` | The SDK release notes for 3.1163 to 3.1169 list no S3, checksum or presign change. `core/httpAuthSchemes` now ignores an invalid date when computing clock skew. `@aws-sdk/checksums` and `middleware-sdk-s3` bumped; `@smithy/node-http-handler` (the PR30 `throwOnRequestTimeout` fact) is unchanged. | No new test. The TASK-019 storage integration cases on RustFS must pass in lane B: checksum on put, `get` recompute, presign tamper, timeouts (C1). |
| swagger-ui-dist 5.35.0 | `/api/docs` (`apps/api/src/platform/openapi/serve.ts`) | Features only: JSON Schema document rendering. The 6 allow-listed `ASSETS` (`serve.ts:39`) exist in 5.35.0. The pinned options `validatorUrl` (`:102`), `queryConfigEnabled` (`:104`) and `supportedSubmitMethods` (`:106`) appear in the bundle exactly as often as in 5.34.1. | No. The existing AT-US-035 api cases must pass in lane B (C1). |
| eslint, typescript-eslint, eslint-plugin-boundaries, eslint-plugin-import-x | Gate code: boundaries layering, the 28 rule fixture directories under `tests/fixtures/lint/rules/`, `pricing-purity` | Boundaries: chore releases. import-x 4.18.0 rewrote the module-analysis core. typescript-eslint and eslint: patch and minor releases. | No new test. `tools/lint/negative-fixtures.test.ts` and the lint-fixture suites in lane B's unit project run every security rule's positive and negative fixtures under the new versions (C1). This answers the D-SECPR080-03 request, in place of re-running the round-2 P1 matrix. A whole-tree `npm run lint` comes with lane A (C2). |
| jose 6.2.17 | No (only `tools/repo/jest-esm.test.ts`) | 6.2.16 exposes invalid options in general JWS and JWE. 6.2.17 rejects a negative `maxTokenAge`. Both make it stricter. | No. **For TASK-052:** pin `jwtVerify` options with tests (algorithms `['ES256']`, `maxTokenAge`, clock tolerance). 6.2.18 (not yet past the cooldown) also reports JWKS body-read timeouts. |
| cookie 2.0.2 | No | `serialize` now encodes characters outside the cookie-octet set with the default encoder instead of throwing. The value is validated only when a custom encoder is used. `maxAge` must be a safe integer. Expiry years must be between 1601 and 9999. The decode default changed from `\|\|` to `??`. | No. **For TASK-052:** a serialisation test for the `__Host-rt_web` cookie (exact `Set-Cookie` string: `Secure`, `HttpOnly`, `SameSite`, `Path=/`, no `Domain`) and a hostile-header parse test (duplicate names, `%` sequences). |
| nodemailer 10.5.0, @aws-sdk/client-sesv2, @opentelemetry/sdk-node, axios, @tanstack/react-query, react-hook-form, @hookform/resolvers | Not imported by production code yet, or frontend only | as in §3.1 | No |

## 4. Findings

### POST-SEC-01: express-rate-limit 8.7.4 carries repository advisory GHSA-cppf-2hm6-mrvm (prototype-pollution gadget disables limiting)
- **Severity:** INFO. **CWE:** CWE-1321. **OWASP:** A06:2021 Vulnerable and Outdated Components.
- **Location:** `package-lock.json` (`node_modules/express-rate-limit` 8.7.4); `apps/api/package.json`; the use is at `apps/api/src/platform/rate-limit/policy.ts:11`.
- **Description:**
  - The advisory: `parseOptions` reads `passedOptions.max` and `passedOptions.headers` through the prototype chain. So `Object.prototype.max` replaces the limit of every `rateLimit()` instance constructed afterwards that was given neither `limit` nor `max`.
  - Affected: ≤ 8.7.4. Fixed: 8.7.5, published 2026-11-18T23:01Z. It is a repository advisory only; the global database answers 404.
- **Exploitability and impact:**
  - It needs a separate prototype-pollution primitive in the API process.
  - It also needs a call to `rateLimit()`, which no production code makes. The only import is `ipKeyGenerator`, byte-identical between 8.7.3 and 8.7.4.
  - TASK-041's limiter is the project's own Valkey implementation, so not reachable.
- **Remediation:**
  - Take express-rate-limit ≥ 8.7.5 in the next Dependabot group after its cooldown ends (2026-11-25T23:01Z).
  - Optional hardening: in `eslint.config.mjs`, a `no-restricted-imports` entry with `importNames: ['default', 'rateLimit']` for `express-rate-limit`, so that only `ipKeyGenerator` can be imported.
- **Verification:** after the bump, `npm ls express-rate-limit` shows ≥ 8.7.5. A lint fixture importing `rateLimit` from `express-rate-limit` fails, if the optional rule is taken.

### POST-SEC-02: cron-parser 5.10.4 (via bullmq) is likely affected by repository advisory GHSA-7jm7-f8vg-h8wf (`parse()` never returns)
- **Severity:** INFO. **CWE:** CWE-835. **OWASP:** A06:2021.
- **Location:** `package-lock.json` (`node_modules/cron-parser` 5.10.4, production closure through bullmq 6.7.6); scheduler API at `apps/worker/src/platform/jobs/schedulers.ts:37` (`repeat: { readonly every: number }`) and `:58`.
- **Description:**
  - A 23-byte expression with an `H/n` token plus a fractional step loops forever in `#createRange`.
  - The advisory tested 5.10.5 and says earlier 5.x releases with `H` syntax were not tested. 4.9.0 is not affected.
  - bullmq 6.7.7 and 6.7.8 bump cron-parser to 5.10.5 and 5.10.6 with "[security]" labels.
  - Main had 5.10.3 before #84, so #84 neither introduced nor removed the exposure.
- **Exploitability and impact:**
  - Only applications that parse untrusted cron expressions are exposed.
  - Our scheduler port accepts `{ every }` only. No cron `pattern` exists anywhere in `apps/` or `packages/`, and no request reaches the scheduler. Not reachable.
- **Remediation:**
  - Take bullmq ≥ 6.7.8 (cron-parser 5.10.6) after its cooldown ends (2026-11-26T04:24Z).
  - Keep the scheduler port typed `{ every: number }`. A future `pattern` must come from the code's closed schedule list, never from input.
- **Verification:** `npm ls cron-parser` shows ≥ 5.10.6. In a child process with a 10 s guard, `CronExpressionParser.parse('H/60,1-59/1e-17 * * * *')` rejects or returns.

### POST-SEC-03: lane A's advisory gate sees only the reviewed global database; repository-only advisories reached main unseen
- **Severity:** LOW. **CWE:** CWE-1395. **OWASP:** A06:2021.
- **Location:** `tools/ci/check-audit.mjs` (inputs are `npm audit --json` and osv-scanner only); the dependency-review practice for Dependabot groups.
- **Description:**
  - From 2026-11-10 until `3c4d9a6d`, main held vite 8.3.6. Repository advisory GHSA-p4f5-76q4-ffq7 is Critical: dev-server RCE through the `__vite-browser-external` virtual module.
  - From 2026-11-09, main held `@opentelemetry/resources` 3.0.0. GHSA-qrww-3xmv-qhgm is High: an untrusted search path in the host detector.
  - Main also held nodemailer 10.3.1, affected by two Medium advisories.
  - None of these is in the global advisory database. npm audit, OSV and so `check-audit.mjs` cannot report them.
  - The TASK-042 review found the same class (i18next, PR042-SEC-01).
  - #84 happened to fix all three. A merge with CI green would not have caught them either.
- **Exploitability and impact:**
  - vite: only a dev server exposed to the network. No `server.host` or `--host` is set in `apps/web`, `apps/admin`, `compose.yaml` or `compose.debug.yaml`, so it was not exploitable here.
  - `@opentelemetry/resources`: needs a local attacker, and OTel is not imported yet.
  - nodemailer: not imported yet.
  - So no exposure this time. The control gap stays: a Critical or High in a production dependency can sit on main until GitHub reviews it into the global database.
- **Remediation (devops-engineer):** add `tools/ci/repo-advisories.mjs`, run in lane C (weekly and on dependency PRs), with `GITHUB_TOKEN` read-only.
  - For each direct dependency of every workspace `package.json`, read `repository.url` from the registry manifest of the locked version.
  - Call `GET /repos/{owner}/{repo}/security-advisories?state=published&per_page=100`, with a 30 s timeout and 3 retries with backoff and jitter (idempotent GET).
  - Match `vulnerabilities[]` by `package.ecosystem == 'npm'` and `package.name` against every locked tuple of that name, using `semver.satisfies` on `vulnerable_version_range`.
  - Exit 1 on Critical or High unless `tools/ci/advisory-watchlist.json` holds an unexpired entry for that GHSA (same register rules as `check-audit.mjs`). Report Medium and Low.
  - Fail closed (exit 2) when the API is unreachable.
  - Until it exists, every Dependabot group review includes this query; the D-SECPOST-01 kit did it for the 28 packages.
- **Verification:** unit tests with recorded API fixtures:
  - vite 8.3.6 with GHSA-p4f5-76q4-ffq7 gives exit 1;
  - 8.3.8 gives exit 0;
  - a watchlisted GHSA gives exit 0 with a note;
  - an unreachable API gives exit 2.
- **Due:** before G3.

### POST-SEC-04: main's migration history is not in name order after #83; the three migrations are independent
- **Severity:** INFO. **CWE:** none (integrity hygiene). **OWASP:** A08:2021 Software and Data Integrity Failures (process).
- **Location:** `prisma/migrations/20261120200000_guest_capable_guard`, `20261120210000_operator_staff_grants` (added by `a93a6113`) and `20261121000000_pricing_config_versions` (added by `339b29d6`). The gate is `tools/ci/check-migration-immutability.mjs:90`, which orders bootstrap files only.
- **Description:**
  - A database migrated at `339b29d6` and then at `a93a6113` applies the two 20261120 migrations after the 20261121 one; a fresh database applies them in name order.
  - All three statements touch only their own objects: a trigger function, a table with its index, grant and guard replacement, and a table with its triggers and grant. So the end states are the same.
  - Nothing on main refuses an out-of-order Prisma migration. TASK-034's `migrations/added-out-of-order` rule (D-CRPR034-01, m1) would have refused #83's merge ref.
- **Exploitability and impact:** none this time. A future pair with catalog-wide statements, such as `ON ALL TABLES`, default privileges or a loop over `pg_class`, would leave fresh and migrated databases with different grants.
- **Remediation:**
  - Land TASK-034's rule, judged against the merge-ref base (D-CRPR034-01 R2-n2).
  - Until then, the coordinator checks migration names when it merges a branch that adds a migration after main gained a later one.
- **Verification:** TASK-034's rule fixture: a branch adding `20261120…` onto a base holding `20261121…` fails.

### POST-SEC-05: bullmq 6.7.5+ records the original job error on the processing span
- **Severity:** INFO. **CWE:** CWE-532. **OWASP:** A09:2021 Security Logging and Monitoring Failures.
- **Location:** bullmq 6.7.6 `dist/esm/classes/worker.js:665` (`span.recordException(err)`); `apps/worker/src/platform/queues/consumer.ts` (no `telemetry` option today).
- **Description:**
  - When a `telemetry` option is passed to `Worker` or `Queue`, a failing job's error object becomes a span exception event: message, type and stack.
  - Today no telemetry option is set, so nothing is exported.
- **Exploitability and impact:**
  - When TASK-214 wires OTel through API, queue, worker and carrier, job error messages could carry carrier payload fragments or personal data into traces.
  - The PR64 log-side redaction (`failedReason`, stack-trace limit) does not cover the span.
- **Remediation (TASK-214):**
  - Pass BullMQ a tracer wrapper whose `recordException` records only the error `name` and the platform error code, or apply the shared redaction to exception events in a span processor before export.
  - Add the case to TASK-214's redaction tests.
- **Verification:** a worker test with an in-memory span exporter. A job that throws an error whose message holds a sentinel produces an exception event without the sentinel.

## 5. Not checked here, and why

- **Lane B on `3c4d9a6d`:**
  - The first run (`20261121T1512Z_3c4d9a6`) was INVALID: no diff (D-ORCH-164).
  - The re-queued run (`run-live70.sh`, `--base a3c0b1af`) had not started when this was written. The queue was on TASK-040B.
  - So lane B on main itself remains condition C1.
- **Interim evidence from a main-derived head.** I read it from the queue log `.orch/laneb-queue/Shipqube-TASK-044.log` (outside any worktree). I also read the `package.json` version fields under that checkout's `node_modules`, without running anything there.
  - Lane B `20261121T1512Z_3326231` ran on TASK-044's union `33262314`, which holds main `4ba683ad`, so #80 to #84, #49 and #50.
  - It ran with #84's versions installed: eslint 10.15.0, typescript-eslint 8.72.2, eslint-plugin-boundaries 7.4.3, eslint-plugin-import-x 4.18.1, bullmq 6.7.6, `@aws-sdk/client-s3` 3.1169.0, swagger-ui-dist 5.35.0, vite 8.3.8.
  - Results:
    - api: 252 of 252;
    - catalog C1-C14 on the combined schema: 121 of 121;
    - `rls-cross-tenant`: 162 of 162;
    - generated: 188 of 188;
    - integration: 503 of 505. Both failures are `gitleaks-full.int.test.ts`, with 3 fingerprints beyond the baseline: the PR080-SEC-07 class, whose third instance is the `c33e5e92` union re-add named in D-ORCH-168.
    - unit: 8,687 of 8,690 with 2 skipped, so `negative-fixtures` and the lint-fixture suites pass under the new lint stack. The one failure is `tools/compose/compose-stack.test.ts:95`.
  - That failure comes from **Dependabot #49**, outside this review's five PRs: it moved `compose.yaml`'s Valkey from `8.1-alpine` to `9.1-alpine`, while the Testcontainers harness (`tools/quality/suite-runners.json`) stays on 8.1 (observation O-1, §6).
  - None of the #84-sensitive suites failed. This is not a substitute for C1, because the head carries TASK-044's own changes.
- **No Docker:** no image build, Trivy or real gitleaks image. The ancestry gitleaks state is PR080-SEC-07 (D-SECPR080-03, D-ORCH-168). This record adds no new fingerprint (over-approximating emulation: 0 hits).
- **No `npm ci`:** so no installed-tree `npm audit signatures` and no `licence-check` resolution of the 4 manifest-less entries. Registry signatures were verified per tuple instead.
- **Behaviour diffs:** read only for express-rate-limit, cookie, bullmq and swagger-ui-dist (`npm pack` tarballs). The other 24 rest on release notes, the gates and lane B.
- **`.env*`:** not opened. #84 does not touch it.

## 6. Conditions and routing

| ID | Condition | Owner | Due |
|---|---|---|---|
| C1 | Lane B PASS on `3c4d9a6d` (or a later main head), read from JUnit by title:<br>- catalog C1-C14 and `rls-cross-tenant` on the combined schema of #80, #81 and #83;<br>- the TASK-035 and TASK-039 queue and scheduler integration cases (real Valkey);<br>- the TASK-019 storage cases on RustFS;<br>- the AT-US-035 docs api cases;<br>- the unit project with `tools/lint/negative-fixtures.test.ts`;<br>- `migrations`;<br>- gitleaks-full, whose only findings beyond the 17-line baseline are PR080-SEC-07's two fingerprints.<br>Expected red from outside this review: `compose-stack.test.ts:95` (O-1, #49).<br>Interim evidence: §5 (run `20261121T1512Z_3326231`).<br>A red result becomes a P5 fix task (D-ORCH-162). | sdlc-orchestrator (lane-B queue) | next queue slot |
| C2 | Hosted lane A on main (lint, typecheck, `check-audit`, `licence-check` after `npm ci`, `check-dep-age`) and the `security-integration` job, once billing returns. | devops-engineer / orchestrator | when Actions accepts jobs |
| C3 | POST-SEC-03: the repository-advisory gate. | devops-engineer | before G3 |

**Observation O-1 (outside #80 to #84; for devops-engineer and the orchestrator):**
- Dependabot #49 (`7db3b8b5`) moved local compose to Valkey 9.1 while the harness, the rate-limit Lua scripts' lane-B proof and CLAUDE.md's fixed stack ("Valkey 8") stay on 8.1.
- `compose-stack.test.ts` already fails on it, so the main run of C1 will show that failure too.
- Fix: put `compose.yaml` back on the harness digest, and add a Dependabot `ignore` for Valkey major versions. A move to Valkey 9 goes through a superseding ADR and moves both the harness and compose together.
- Security relevance: the local stack would otherwise run an untested major under the `rl:*` ACL (`~rl:* +@all -@dangerous`).

**Routed follow-ups (not conditions):**
- POST-SEC-01: express-rate-limit ≥ 8.7.5 after 2026-11-25T23:01Z (Dependabot group; devops-engineer).
- POST-SEC-02: bullmq ≥ 6.7.8 after 2026-11-26T04:24Z (same).
- POST-SEC-04: TASK-034.
- POST-SEC-05: TASK-214 card line.
- TASK-052 card notes: jose options and cookie serialisation tests (§3.3).

| Verdict | **PASS_WITH_CONDITIONS.** Post-merge review of #80 to #84 at `3c4d9a6d`.<br>**(a):** every squash equals the clean merge-tree of its parent and its PR head. The union heads `2805c809`, `22f69a82`, `05e1e9da` and `93a14e44` are pure unions. Owned paths are unchanged (39/27/27/21). The merge-only rounds owed on the union heads are closed: #81 and #82 by D-SECPR080-03 and D-SECPR041-04, #83 here.<br>**(b):** #84's 28 updates (151 new tuples) pass licence, advisory, maintenance, release-age, install-script and integrity policy. The lockfile is the exact union of #84 and #82.<br>**Findings:** 0 Critical, 0 High, 0 Medium. LOW POST-SEC-03; INFO POST-SEC-01, -02, -04, -05.<br>**Interim lane B** on the main-derived head `33262314`, with #84's versions installed: every #84-sensitive suite passes. Its reds are the PR080-SEC-07 gitleaks class and #49's compose Valkey 9.1 (O-1).<br>**Conditions:** C1 lane B on `3c4d9a6d`, C2 hosted lane A and `security-integration`, C3 the repository-advisory gate before G3. |
