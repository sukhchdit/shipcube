---
name: task045-fc1
description: TASK-045 fix cycle 1 lessons - RLS policy in bare-container int tests without tripping tenant-context-sql, heredoc/sed backslash traps, Joi custom helpers.original
metadata:
  type: feedback
---

- A bare-PG int test that needs a tenant RLS policy must not spell the context key in TS (`platform/tenant-context-sql` flags it; exemptions live in locked `eslint.config.mjs`). Apply the released helpers migration as written (`readFileSync(new URL('../../../../../prisma/migrations/20261112020000_platform_rls_helpers/migration.sql', import.meta.url))` after `CREATE SCHEMA platform` + `GRANT USAGE`), then `USING (org_id = platform.app_org_id())`. node-pg runs multi-statement text on the simple protocol when `values` is empty.
  **Why:** the first lint run failed on a `current_setting(...)` policy literal; splitting the key string would be rule evasion.
  **How to apply:** any test that needs RLS on an ad-hoc table.
- Again: quoted heredoc + JS template literal still lost `\0`/`\d` (and wrote a raw NUL). `sed` replacement `\0` = whole match. For regex-bearing edits use a Write-tool script that builds backslashes with `String.fromCharCode(92)`, or the Edit tool. See [[pr23-fc1]].
- Joi `.custom((value, helpers) => ...)` gets the pre-coercion input as `helpers.original`; use it to refuse date-only / >3 fraction digits before `Joi.date().iso()` silently rounds. Raise `helpers.error('date.format', { format: 'iso' })` so the validate slot's SAFE_MESSAGES cover it. Joi iso refuses lowercase t/z and 5-digit years itself (date.format, not date.max).
- A Write-tool mutation script (apply mutant, run targeted unit suites, restore byte for byte) is cheap proof that review-flagged binding members are pinned; 15 mutants ran in about 3 minutes with `--runInBand --silent`.
- fc2: a test helper `get(path, q, orgId: string | undefined = ORG_A)` called with an explicit `undefined` takes the DEFAULT, so the "anonymous" call was signed in and the anonymous-only route gave 401 at the TASK-020 credential gate (authorise.ts: route.auth must include principal.credential). Use a `null` sentinel for "no caller". When a lane B failure looks like a code regression, reproduce it on the host first; this one predated the fix cycle it was blamed on.
