---
name: project-p5-pr26-standard-columns
description: PR #26 (TASK-032 standard-columns Prisma extension, scopeClient, uuidv7) R1 @84b70c4 2026-11-13 PASS_WITH_FOLLOW-UPS; PR26-SEC-01..08 (relation connect, optional scopeClient, raw SQL, CODEOWNERS gap); offline tenant-like Prisma probe recipe; checks owed in TASK-037/020/024/100/015
metadata:
  type: project
---

The PR #26 review is `docs/05-quality/security/PR-0026-TASK-032-security-review.md` (uncommitted in main when written, 2026-11-13). R1 head `84b70c4216ae6dd58a120b69fd333298ee276d73`, PASS_WITH_FOLLOW-UPS, 0 Critical/High/Medium.

**Findings:** 01 LOW relation `connect`/`disconnect` is allowed, so `org: {connect}` / `onBehalfOfOrg: {connect}` on update write `org_id` / `on_behalf_of_org_id`, and a to-many `connect` writes the child row with no `updated_by`/`updated_at`/`version` (fix: refuse every relation field; repositories use unchecked inputs anyway). 02 LOW `scopeClient?` optional (`?? client`), `runtime.ts:211` unpinned (mutant: updates silently unstamped, forged `version`/`updatedBy` persist), empty catalogue passes writes (= code review m1+m3). 03 LOW raw `$executeRaw` DML can forge `created_by`/`version`; DB enforces only NOT NULL/`version>=1`/RLS org/on-behalf CHECK (needs an architect ruling: guard trigger vs raw-DML lint vs documented acceptance). 04 INFO `contextValues` accepts SYSTEM/ANONYMOUS ids in any scope; empty actor + OPERATOR is stamped anonymous (TASK-020/037/047 checks). 05 INFO uuid "74 random bits" is 73/42 (seq increments +1 within a ms). 06 INFO `catalog-std` uses `in` on exemption maps (tables named `constructor`/`toString`/`__proto__` are exempt) and has no Prisma-name/DB-column parity test. 07 INFO CODEOWNERS excludes `apps/api/src/platform/db/**`, `packages/shared/**`, `**/package.json` (extends PR24-SEC-04; lane A flagged only `package-lock.json` + `tools/tsconfig.json`). 08 INFO soft-delete columns missing from `SERVER_CONTROLLED_FIELDS`, app-clock `updated_at`, spread bypasses `serverStamped` types.

**Facts verified 2026-11-13 (re-verify after Prisma/schema changes):**
- Prisma 7.10.1 `_runtimeDataModel` relation fields carry only `name`, `kind`, `type`, `relationName` (no `relationFromFields`, no cardinality, no dmmf); scalars carry `dbName`. So an extension cannot tell which relation backs an FK.
- The query extension sees Prisma's COPY of args: inherited and accessor props become own (refused), non-enumerable props are dropped. JSON `__proto__` own keys change nothing.
- TENANT RLS template is `FOR ALL … WITH CHECK (org_id = app_org_id())`; the operator branch is SELECT-only (data-model §4.3). So an `org_id` re-parent is backstopped in every scope once a tenant table exists. No tenant table or `on_behalf_of_org_id` column exists yet (the `catalog-std` on-behalf rule has no instance).
- Stamp is closure-bound: 200 interleaved transactions, 0 mismatches; one `$extends` is about 14 us with no retained heap.
- `uuid` 14.0.3: MIT, no deps, valid signatures + SLSA provenance, advisories only for <11.1.1 and 13.0.0; `apps/api` and `apps/worker` already depend on it.
- Open PRs overlapping this PR's owned paths: #24 (`tools/tsconfig.json`), #20 (lock + tsconfig), #29 Dependabot (lock). The second to merge needs a merge-only security round. PR #28 merged during the review (suites active; lane-B evidence now required, D-ORCH-034).

**Probe recipe (reusable, scratch `review/PR-26-sec/probes`):** write a tenant-like `.prisma` (org/shipment/parcel with standard columns, `org_id`, `on_behalf_of_org_id`, relations) and run `node node_modules/prisma/build/index.js generate --schema=<abs>` from a scratch cwd (works offline, no DB, no engine). Import the generated `client.ts` directly with Node 24 (junction scratch `node_modules` to main's), strip the PR head sources with `stripTypeScriptTypes`, and drive the real `createWithTenantTx` + extension over a recording fake driver adapter (`probes/common.mjs`). To make Prisma proceed past `connect` pre-checks, have the adapter answer SELECT/RETURNING with one plausible row (`p2-relations.mjs`). Mutation build = copy the stripped tree and `sed`-delete the wiring line (`p5-wiring.mjs`). Remove junctions with `cmd //c rmdir`.

**Why:** TASK-032 is the REQ-SEC-007 / T-33 defence in depth and the audit-actor attribution source for every later table.

**How to apply.**
- **TASK-037 (first tenant model) review:** SEC-01 and SEC-02 closed; relation fields refused; Prisma-name parity assertion; RLS planted-row control for an `update` that re-parents; `ck_<table>__on_behalf_null_m1` present; SEC-03 ruling applied in the table template; users table pins the two reserved ids (`is_system`, no credentials).
- **TASK-020:** context builder takes `actorId` only from the verified `sub`; no reserved id on a request context; OPERATOR needs a real actor; `serverControlledFieldIssues` called per body and per bulk item; authz re-exports `SYSTEM_ACTOR_ID` from shared.
- **TASK-024:** raw-DML manifest lint (SEC-03 lint half). **TASK-100:** `deleted_at`/`deleted_by` in the server list, `where.version`, extension order (standard-columns innermost). **TASK-015:** CODEOWNERS list (SEC-07).

Related: [[project-p5-pr11-rls-review]], [[project-p5-pr24-audit-store]], [[project-p5-pr10-ci-lane]], [[project-security-review-conventions]]
