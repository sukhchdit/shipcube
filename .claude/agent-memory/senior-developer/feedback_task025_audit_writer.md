---
name: task025-audit-writer
description: TASK-025 (2026-11-14) - where a DB+package integration test may live, audit_ name guard, spike path tripwire, tsc -b emitting stray .js next to tools, lead-contract + one specialist split
metadata:
  type: feedback
---

TASK-025 (audit writer core, PR #42). I wrote the contract first, then one opus backend-developer did the admission bulkhead in disjoint files and finished with a report (101 tool uses). I did the audit package and both integration suites. About 150 of my own calls.

**Why:** these placement and tripwire traps cost several iterations and will recur for TASK-028/029/030/033.

**How to apply:**
- **Where a test that needs the bootstrapped DB AND a package lives:**
  - `apps/api` tests cannot import `prisma/tests/harness` or `tools/db` (TS6059 rootDir). Their `tsc -b` also EMITS `.js`/`.d.ts` next to `tools/db` and `tools/test-support` sources. Delete those untracked files before any Jest run.
  - `prisma/tests` may not import packages (boundaries). I added a narrow category (`prisma/tests/audit/**` may import `packages/audit/**` only), plus `@platform/audit` in the prisma devDependencies (one lock line), plus a `tools/tsconfig.json` reference.
  - `tools/tsconfig.json` lists the `apps/api/src/platform/db` files EXPLICITLY. A new file there needs an entry, or `tsc -b tools` fails with TS6307.
- **The audit DDL guard refuses CREATING any relation whose name starts with `audit_`**, even a test probe table as superuser ("audit objects are immutable (SEC-P3-03)"). Name probe tables otherwise.
- **The SPK-04 path tripwire** (`prisma/tests/spikes/spk04/paths.test.ts`) fails on any `apps`/`packages` file whose text, comments included, contains `spikes/spk04`. A targeted `packages/` unit run misses it; only the full unit run (the evidence pre-gate) caught it.
- **The `platform/tenant-context-sql` rule flags ANY `set_config` text**, even `'lock_timeout'`. It needs an exact-file `setter` exemption plus a source-pin test.
- `@ts-expect-error` needs the `-- TASK-xxx <reason>` form (check-suppressions).
- **`canonicalize` (ESM-only) loads fine under the Jest swc/cjs setup.** The hash of `ip_coarse` must equal PostgreSQL's `inet` text, so compress the zero run as PG prints it, and integration-test it with `SELECT $1::inet::text`.
- To run gitleaks on a worktree, mount `git rev-parse --git-common-dir` (with `pwd -W`), use `MSYS_NO_PATHCONV=1`, and take the base-ref `.gitleaks.toml` from `git show origin/main:`.

Related: [[p5-dispatch]], [[lane-b-evidence-run]], [[batch-04-07-lessons]]
