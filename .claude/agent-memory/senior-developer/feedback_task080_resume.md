---
name: task080-resume
description: TASK-080 resume lessons - new Prisma model/table ripples, prisma test import limits, purity rule ripple, parseDecimal accepts exponents
metadata:
  type: feedback
---

Lessons from resuming TASK-080 (2026-11-21) after a stalled run; the leftover "case-table rows" turned out to be an
existing fixture row broken by the new rule, not missing scenarios.

- A new pricing-purity check (any `@platform/shared/<subpath>`) also fires on the older TASK-010 fixture
  `layering/shared-logging-server-only/packages/pricing/src/bad-logging-specifier.ts`: run
  `tools/lint/negative-fixtures.test.ts` first on resume; the failing row tells you what was left half-done.
- A new Prisma model (even GLOBAL, read-only) changes the TenantDb delegate surface: the `exposed` list in
  `prisma/tests/rls/tenant-db.real-client.test.ts` must gain it. Run `npm run db:generate` before typecheck/tests.
- New table checklist that passed host tests: migration + down.sql (IF EXISTS), `tools/db/table-classes/<module>.json`,
  `prisma/sql/grants.manifest` + both pins in `tools/db/grants-manifest.test.ts` (tuples and runtimeReadOnly list),
  classification registry rows, `npm run db:lint-migrations`. Partial/DESC indexes and CHECKs stay out of the .prisma
  file with a "Not expressible" comment.
- Import limits: `prisma/tests/**` may not import `@platform/authz` (use the SYSTEM uuid literal); `prisma/seed/**`
  tests may not relatively import `tools/test-support` (import-x/no-relative-packages): read repo files with
  `new URL('../../../<path>', import.meta.url)`.
- `parseDecimal`/`fromMajor` accept exponents (`1e3`): carrier-text parsing needs its own strict regex first.
- Seeding bytea through the framework: pass `\x<hex>` text; `jsonb_populate_recordset` types it via the table row.

**Why:** each of these cost a lint/test round trip on a loaded host.
**How to apply:** check this list before adding a table, a seed dataset or a lint rule change that widens a check.
