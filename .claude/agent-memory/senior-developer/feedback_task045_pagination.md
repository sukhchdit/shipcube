---
name: task045-pagination
description: TASK-045 solo build (2026-11-21) - int-test placement limits (no prisma harness from apps/api), lint traps (.binding, app.* setting literals), stray tsc emits, shared $ref objects, timestamptz keyset precision
metadata:
  type: feedback
---

TASK-045 (cursor pagination module) was built solo in about 110 calls, with no dispatch because of host load. Lint, typecheck and unit tests were green on the first full run. Api and int suites were left for lane B.

**Why:** these traps cost about 15 calls and will recur on any platform-module task that adds an integration test or contract rules.

**How to apply:**
- **Placing an `apps/api/src` int test.** It cannot import `prisma/tests/harness/postgres.ts`: `tsc` fails on rootDir, and `import-x/no-relative-packages` allows that harness only from `tests/generated/rls/**`. tests/api allows apps/api imports only in `*.api.test.ts`, and eslint.config.mjs is a lock. The approach that works is a bare `PostgreSqlContainer` plus `createAppRole` (copy it from tenant-admission.int.test.ts) plus a table created to match the Prisma model, then `databaseRuntimeFromConfig` with `withTenantTx`.
- **A FAILED `npm run typecheck` with rootDir errors emits `.js`, `.d.ts` and maps next to the sources** in prisma/tests and tools. Delete those untracked files before you commit.
- **`platform/tenant-context-sql` checks test files too.** Writing `current_setting('app.org_id', true)` in a test's RLS policy literal is refused. Drop the policy, and leave RLS proof to tests/generated/rls.
- **`no-restricted-properties` flags ANY property named `binding`.** It comes from the `process.binding` ban (PR44-SEC-14). Pick another name, e.g. `cursorBinding`.
- **Dereferenced OpenAPI documents share one object per `$ref`, and `structuredClone` keeps that sharing.** In a seeded-defect test, replace the parameter object with a copy instead of mutating it, or the edit reaches every operation.
- **Express 5 uses the simple query parser, so `filter[status]` arrives as a flat key.** The closed Joi schemas refuse key patterns. That is why an unknown filter key becomes `INVALID_FILTER` in the validate slot (list schemas only), not in Joi.
- **Keyset pagination on `timestamptz(6)` through Prisma model queries is inexact when the cursor holds a JS `Date` value**, because a Date has millisecond precision. Use Prisma's native `cursor: { id }` without `skip: 1`: take limit + 2 and drop the boundary row by id. The int test with microsecond-apart rows is the proof. Lane B has not confirmed it under the Prisma 7 query compiler yet.

Related: [[p5-worktrees]], [[p5-dispatch]], [[task020c-lessons]]
