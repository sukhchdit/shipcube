---
name: project-p5-pr19-supersede
description: PR #19 (TASK-023 supersede of PR #13) round @699f33d PASS_WITH_FOLLOW-UPS; PR19-SEC-01 INFO (TenantDb exposes SYSTEM model delegates); PR13-SEC-04/10 closed; PR #4 overlap and R19-n1 void-the-record traps
metadata:
  type: project
---

The supersede and delta round for PR #19 is in `docs/05-quality/security/PR-0019-TASK-023-security-review.md`, written on 2026-11-13 as a NEW file. The content review stays in PR-0013 R1–R2.
- **Head and verdict:** `699f33d`, PASS_WITH_FOLLOW-UPS. It authorises the merge once the record is committed docs-only on top and lane A is green.
- **Simulated checker:** `pass` with 12 owned paths. The controls (no record, `--pr 13`, `--pr 18`, a rule-(d) migration edit) all gave `missing`.

**Facts established:**
- **Tree equivalence.** The three-way tree compare (base `d68168e`, old `e42e368`, main `80ff2c2`) proved that `eb96b77` = PR #13 content + main exactly. The overlaps `prisma/README.md` and `tools/tsconfig.json` are clean unions.
- **D-ARCH-075.** `platform_app` gets `SELECT` only on `reference_dataset_versions`. This holds by construction: owner is the migrator, there is one GRANT, and there are no default table ACLs. C5 is an exact ACL equality across all privilege types, and the seed suite has 42501 probes. The integration evidence is the developer's local run only.
- **eslint-plugin-boundaries 7.4.1** file descriptors ACCUMULATE categories (no `singleMatch`). So `prisma/seed/**` is both `prisma-seed` and `prisma`, and the new category opened only `prisma/tests` → `prisma/seed/**`. A head-vs-main probe proved this.
- **PR19-SEC-01 (INFO).** `TenantDb` exposes every Prisma model delegate, SYSTEM models included. Data-model §1.5 says "only the owning module's repositories", but nothing enforces it. Owner: the architect, before the first writable or sensitive SYSTEM model (TASK-043 outbox, `idempotency_keys`, `login_attempt_counters`).

**How to apply:**
- **PR #4 overlap.** PR #4 also changes `eslint.config.mjs` and `tools/lint/negative-fixtures.test.ts`. Whichever PR merges second needs a delta round.
  - Keep the 37th `TENANT_DB` case (`bad-prisma-import`).
  - Keep the `prisma-seed` category and its allow.
- **R19-n1 trap.** Editing the migration header comment after `699f33d` voids the record, so a delta round is needed. After the merge, the migration is immutable (PR8-SEC-01).
- **At TASK-043 review:** check that PR19-SEC-01 was decided.

Related: [[project-p5-pr13-seed-framework]], [[project-p5-pr18-supersede]], [[project-p5-wave0-web-scaffolds]], [[project-security-review-conventions]]
