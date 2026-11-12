---
name: project-p5-wave0-db-baseline
description: PR #5 (TASK-003 Prisma/PG18 baseline, engine pin, bootstrap lane) review 2026-11-12 PASS_WITH_FOLLOW-UPS; verified Prisma/pg/PostgreSQL facts (engine env precedence, npm ls devOptional, pg ?host=, PG logs full multi-statement query) and checks owed in TASK-007/014/016/021/034
metadata:
  type: project
---

The PR #5 review (TASK-003, head `d8ba197`) is in `docs/05-quality/security/PR-0005-TASK-003-security-review.md`. IDs are PR5-SEC-01..10.
- Verdict: PASS_WITH_FOLLOW-UPS.
- 1 MEDIUM: 01, plaintext role passwords in the bootstrap SQL reach the PG server log. The fix is SCRAM verifiers built in the runner, so `00-roles.sql` stays unchanged and its hash is unaffected.
- 3 LOW: 02 rule-12 allow-by-default, 03 `db:reset` `?host=`, 04 CODEOWNERS unowned.
- 6 INFO.
- **SEC-FU-PR1.** D-ARCH-041 is CONFIRMED. D-ARCH-003 rev 4 is confirmed as policy only: `tools/ci/` registers don't exist yet, so the TASK-007 half stays open.

**Facts verified 2026-11-12 (Prisma 7.10.1, pg 8.23 / pg-connection-string 2.14.1, PG 18). Re-verify after upgrades.**
- **Prisma engine environment variables.**
  - The engine manifest hashes are re-derivable without writing binaries: `curl …/<target>/schema-engine[.exe].gz | gunzip | sha256sum`. binaries.prisma.sh also publishes an uncompressed `.sha256`.
  - The `@prisma/fetch-engine` short-circuit is at `chunk-P3P4GYYB.js:2330`/`:2415`.
  - `getBinaryEnvVarPath` THROWS if the override path is missing, so it fails closed.
  - `getEnvVarToUse` PREFERS the deprecated `PRISMA_MIGRATION_ENGINE_BINARY` over `PRISMA_SCHEMA_ENGINE_BINARY`. An env var set inside the child (NODE_OPTIONS preload, or dotenv in `prisma.config.ts`) would bypass the after-child re-hash.
- **`npm ls` and devOptional.** `npm ls X --omit=dev --omit=optional` still lists devOptional packages that are reached through `@prisma/client`'s optional peer on `prisma`. Compute closures from lockfile flags; the production closure is 589 entries with no elkjs or prisma CLI.
- **pg connection strings.** URL query params override the explicit `pg` config (`connection-parameters.js:60`), and `?host=` overrides the URL hostname. A guard on `new URL().hostname` or a raw-string `options=` regex is bypassable. See [[project-p5-wave0-config-review]] for the sslmode twin.
- **PostgreSQL statement logging.** PG logs the ENTIRE multi-statement simple-query text under `log_min_error_statement`, and under `log_statement=ddl`. Plaintext secrets in one-shot SQL leak this way.
- **Default privileges.** `ALTER DEFAULT PRIVILEGES … IN SCHEMA x REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC` is a no-op (PG docs). Only the `FOR ROLE` form without `IN SCHEMA` works, and it is per database.
- **CODEOWNERS.** No task sheet creates `.github/CODEOWNERS`, although D-ARCH-041, D-ARCH-003 rev 4, rule 12 and T-107 cite it.

**Why:** the follow-ups are spread over later tasks, and they close only if each later review checks them.

**How to apply.** In these reviews, check:
- **TASK-003 fix cycle, or TASK-014 at the latest:** PR5-SEC-01 SCRAM verifiers, and a log test with `log_statement=ddl`.
- **TASK-021 (and TASK-016 if the linter is batched there):** PR5-SEC-02 deny-by-default for audit-owner mentions in the bootstrap lane, plus fixtures for `REASSIGN OWNED`, `DROP OWNED`, `ALTER ROLE … LOGIN`, `GRANT a, platform_audit_owner TO`, and `ALTER DEFAULT PRIVILEGES … GRANT`. The audit-ddl reviewer identity.
- **TASK-007:**
  - CODEOWNERS plus a record-based `check-security-owned-paths`;
  - the registers per D-ARCH-003 rev 4, with the elkjs `via` chain from `prisma` down;
  - `NODE_OPTIONS` preload refusal and no `NODE_TLS_REJECT_UNAUTHORIZED=0`.
- **TASK-016:** C13 runs post-bootstrap in every lane; the catalog harness uses `options`; C5/C11 assert the `pg_default_acl` `ns=0` rows; owner of linter rules 3–9 and 11 (SEC-TC-33).
- **TASK-034:** the rehearsal uses `options`; the `db:reset` host check if it was not fixed in TASK-003.
- **TASK-006:** the query-param allow-list in `toPoolConfig`.

Related: [[project-p5-wave0-supply-chain]], [[project-p3-security-conditions]], [[project-p5-wave0-config-review]], [[project-security-review-conventions]]
