# Architecture rulings — P5 Wave 0, TASK-016 (PR #11 @557aada: RLS foundations)

| Field | Value |
|---|---|
| Date | 2026-11-13 |
| Author | principal-architect |
| Trigger | PR #11 (TASK-016) raised design items that block TASK-037: the PR's own decisions 3/4/5 (`app_actor_id` grant to the definer; rule-5 probe proving non-atomic migration files; DR-A14 policies outside the renderer allow-list), the code review's §4 rulings and §7 merge list (incl. m4 C6–C10 deferral), and the security review's PR11-SEC-03/06/07/09/10/11 "for principal-architect" items. The orchestrator also routed PR #9 m2/n3 (readiness stubs, platform.md:341), T-83 ownership and the C-1 re-owning to this batch |
| Evidence | `docs/05-quality/reviews/PR-0011-TASK-016-code-review.md` (M1, m1–m6, n1–n5, §4, §7, §8); `docs/05-quality/security/PR-0011-TASK-016-security-review.md` (PR11-SEC-01..11, §4 closure tables, §5 rulings, §6 routing); DECISIONS.md D-TASK016-01, D-ORCH-014, D-TASK006-02; PR #11 code read with `git show 557aada:<path>` — `tools/db/render-rls.ts`, `tools/db/table-classes.ts`, `tools/db/lint-migrations.ts` (rule 11 `LOCK_TIMEOUT` :245, rule 15 `handedOver` :558–571, rule 16 :575–584), `prisma/sql/policy-templates/*.sql`, `prisma/sql/function-templates/app-is-operator.sql`, `prisma/sql/grants.manifest`, `prisma/migrations/20261112020000_platform_rls_helpers/migration.sql`, `prisma/tests/catalog/{scans.ts,c01-c12.int.test.ts}` (`plantProbe`, C11 helper expectation), `prisma/README.md` "Rule 5"; PR #9 head `packages/config/src/schema.ts` (`DB_STATEMENT_TIMEOUT_MS` default 25 000); data-model §1.7 `membership_status`, §3.2, §4.1–§4.6, §8.3, §8.4; REQUIREMENTS.md DR-A14; threat-model T-83; `docs/04-plan/generator/plan-data.mjs` + `task-map.csv` |
| Decisions | D-ARCH-071 (non-atomic files, definer form, `app_actor_id` grant), D-ARCH-072 (DR-A14 mechanism), D-ARCH-073 (helper qualification, `lc_messages` backstop, C13 case folding, C11 converse), D-ARCH-074 (routing and plan-sheet edits) in `docs/sdlc/DECISIONS.md` |
| Documents amended | `data-model.md` §4.1 (lc_messages row), §4.2 (qualified helpers; definer grant note), §4.3 (DR-A14 named templates, positive lists, invariants), §4.4 (grant matrix), §4.6 (C3 row + 2026-11-13 bullets: C3 derived set, C5 PUBLIC, C6–C11 owners, C13 case folding, C1 scope, `runtimeReadOnly`), §8.3 (rule 5 verified result, rule 9 a/b, rule 11, non-atomic ordering principle, rule 15, rule 16 a/b, new rule 17), §8.4 (prefix reversibility), §12 A19 · `ADR-0005` am. 10 item 9 (SET ROLE only form) + "Round-3 corrections" bullet · `platform.md` §RDS parameter paragraph (statement_timeout layering) · `risks.md` v1.6 (R-ARCH-26) · `docs/04-plan/generator/plan-data.mjs` (12 blocks, regenerated: 0 errors, IDs unchanged, deps changed for TASK-037 only, locks changed for TASK-020 (+`lint`) and TASK-024 (+`prisma-rls`, `prisma-core`), `part` US-012 added to TASK-019/021) |
| Not touched | PR #11 branch, worktrees, review files, DECISIONS.md history (append only), REQUIREMENTS.md (product-manager), threat-model.md (security-analyst) |

Verdict vocabulary: **ACCEPTED** (the code or probe result is right; the spec is amended) · **ACCEPTED WITH CONDITIONS** (right; a named follow-up is required) · **REJECTED** (code must change) · **CONFIRMED** (question answered without a spec change) · **DECIDED** (an open design choice is closed).

## Item 1 — `GRANT EXECUTE ON platform.app_actor_id() TO platform_definer` and the `app_is_operator()` template (PR decision 3)

**Ruling: ACCEPTED.** D-ARCH-071 (3).

- The body of `app_is_operator()` calls `platform.app_actor_id()` while running as `platform_definer`; `PUBLIC` holds no `EXECUTE` on the helpers (01-schemas.sql global default privileges), so without the grant the function would fail at runtime with 42501 for every operator query. The helper only reads a GUC; the grant adds no capability.
- The grant belongs to the migration that creates `app_is_operator()`, issued by the migrator (owner of the helper) **before** `SET ROLE platform_definer` — exactly what `prisma/sql/function-templates/app-is-operator.sql` does. Shipping the function as a template (not in PR #11) is right: a SQL body is validated at `CREATE` time and the tables do not exist yet.
- **data-model §4.4** grant matrix: Functions row and the `platform_definer` row name the grant. **§4.2** carries a comment block above the function. **C11** (TASK-037, when the template is applied): `platform.app_actor_id()` becomes `EXECUTE`-able by `platform_app`, `platform_migrator` and `platform_definer`; the other two helpers are unchanged. The `plantProbe` adaptation is on TASK-037's sheet.

## Item 2 — Migration files are not atomic (PR decision 4; PR11-SEC-07; code review §4 decision 4)

**Ruling: ACCEPTED — the probe result is recorded in §8.3 rule 5 and its consequences are written into rules 9, 11, 15, a new rule 17, an ordering principle and §8.4.** D-ARCH-071 (1), (2).

- **Verified fact (PR #11 `prisma/README.md` "Rule 5", `tests/migrations/concurrent-index.int.test.ts`, Prisma 7.10.1 / PG 18.6):** `migrate deploy` runs a file's statements one at a time outside any transaction block; `CREATE INDEX CONCURRENTLY` after a `SET lock_timeout` in the same file is applied; a file whose second statement fails keeps the effects of its first (`finished_at` NULL). Rule 5's open question is closed; the one-statement rule stays for isolation, not for `25001`.
- **Rule 11:** session form only. `SET LOCAL lock_timeout` outside a transaction block is a warning-only no-op, so a compliant-looking file ran its `ALTER TABLE` with no lock timeout — the pile-up NFR-AVAIL-003 guards against. Fixture `set-local-lock-timeout` fails. A value raised above the migrator's role default (`3s`) ends with `RESET lock_timeout` because the session value persists into later files.
- **Rule 9 b:** a `GRANT … TO platform_app` on an RLS-class table comes after `ENABLE` + `FORCE` (+ policies) in the same file; fixture `grant-before-force`.
- **Rule 15:** see item 3.
- **Rule 17 (new):** `down.sql` is idempotent against any applied prefix (`IF EXISTS` forms). **§8.4:** a failed deploy is a *prefix*, not "nothing"; `down.sql` → `migrate resolve --rolled-back` (legitimate for the genuinely FAILED migration; the P3012 note concerns successful ones) → redeploy; the up→down→up driver gains a prefix-reversibility check (every proper prefix on a template clone, then `down.sql`, schema equals the pre-migration snapshot). Owner TASK-024.
- **Principle (§8.3):** every prefix of a file leaves the schema safe — `CREATE TABLE` → `ENABLE`/`FORCE` → policies → grants; definer functions inside one `SET ROLE` block; data after structure; no file ends inside `SET ROLE`.
- **risks.md R-ARCH-26** records the risk and its gates.

## Item 3 — ADR-0005 am. 10 item 9: `SET ROLE platform_definer … RESET ROLE` is the only definer form (PR11-SEC-07 items 2–3)

**Ruling: AMENDED — the "grants before `OWNER TO`" alternative is withdrawn.** D-ARCH-071 (2).

- With non-atomic files, a failed `ALTER FUNCTION … OWNER TO platform_definer` after a successful `GRANT EXECUTE … TO platform_app` leaves a **migrator-owned** `SECURITY DEFINER` function executable by `platform_app` as a durable state; the migrator owns the SYSTEM/GLOBAL tables, which have no RLS. The block form has no such window: the function is born with the right owner and is granted inside the block.
- **Rule 15 now fails:** (a) a `CREATE FUNCTION | PROCEDURE … SECURITY DEFINER` outside the block (was: flagged), (b) any `ALTER FUNCTION | PROCEDURE | ROUTINE … OWNER TO platform_definer` in `prisma/migrations/**`, (c) a file whose last statement leaves the definer role set (a later file on the same deploy connection would create definer-owned objects — PR11-SEC-06's hazard). The linter's `handedOver` branch is removed. Fixture `definer-grants-before-owner-to` flips to **failing**; new fixture `definer-role-not-reset`.
- F-10's observation (the migrator's `INHERIT FALSE` membership cannot grant after an owner change) stays true and is recorded as the reason the block form was preferred.

## Item 4 — DR-A14 special policies outside the renderer allow-list (PR decision 5; PR11-SEC-10; code review §4 decision 5)

**Ruling: DECIDED — three named renderer templates selected by a manifest field, with positive status lists; no exemption list. Security-analyst sign-off on the rendered policies is a merge condition of TASK-037 and TASK-049.** D-ARCH-072.

- **Why templates, not an exemption file.** PR11-SEC-10 named the real risk: an exemption keyed by policy name would permanently remove `users`/`memberships`/`organisations` from C3 and from rule 9, and later edits to an exempted predicate would go unchecked. A SHA-keyed exemption file (option 2) is workable but adds a second source of truth under CODEOWNERS; the renderer already *is* the reviewed source. The templates keep "renderer and C3 are the only source" (requirement 1) with no new trust boundary.
- **Mechanism (data-model §4.3).** Manifest field `policySet: dr-a14-users | dr-a14-memberships | dr-a14-organisations`, accepted by the loader only on the table of the same name and class (`users` USER_OWNED, `memberships` TENANT, `organisations` TENANT). `blocksFor` renders `enable-force` + the set (replacing `user-owned` for users and `tenant` for organisations — neither table has the keyed column the standard template uses; adding `own_read` to `tenant` for memberships) + `operator` (+ `definer-read`). `validateTemplate` admits, for these templates only, the exact atoms `id = platform.app_actor_id()` (users), `id = platform.app_org_id()` (organisations) and the two exact `EXISTS` atoms as opaque strings; every forbidden token stays forbidden inside the `EXISTS`; every context reference inside it is `col = platform.app_*()` (requirement 3); `IN (…)` only on `m.status`, positive only.
- **Positive lists (requirement 4).** `p_users__org_member_read`: `m.status IN ('INVITED','ACTIVE','SUSPENDED')` replaces `<> 'REMOVED'` — same semantics today (every non-removed status), fail-closed when `membership_status` grows. `p_organisations__member_read` keeps `IN ('ACTIVE','SUSPENDED')` (the switcher does not list invitations). Both lists are extended deliberately, never by default.
- **Checks.** Rule 9 a: every `CREATE POLICY` in `prisma/migrations/**` equals the renderer output for its table. C3: expected set derived from manifests + renderer (rendered on a rolled-back probe, deparsed, compared), keyed-atom presence in every `TO platform_app` predicate (closes the tautology / `org_id IS NULL` hole of probe P-C), and the invariants of requirement 5 — `memberships` policies contain no subquery (42P17), `users`/`organisations` subqueries reference `public.memberships` only.
- **Owners.** TASK-024 (templates, `policySet`, rule 9 a, C3 derivation, C11 converse; gains locks `prisma-rls`, `prisma-core`, free in batch 0.7). TASK-037 applies the memberships/organisations sets and `app_is_operator()` and now depends on TASK-024. TASK-049 (creates `users`) applies the users set. **Merge condition** on both: security-analyst sign-off on the rendered policies in the change-scoped review.
- **Flag for senior-developer (not decided here):** `memberships.user_id` references `users(id)`, which TASK-049 creates three batches after TASK-037. Either TASK-037 also creates the minimal `users` table (then it needs lock `identity-core` in batch 1.1) or TASK-049 adds the FK `NOT VALID` + `VALIDATE` (rule 6). Recorded on TASK-037's dod for the dispatch decision.
- **For product-manager (no DC impact, wording only):** DR-A14 lists `users`, `sessions`, `memberships` as special; the model's special sets are `users`, `memberships`, `organisations` (`sessions` is plain USER_OWNED). A one-line alignment of DR-A14 is suggested, not required.

## Item 5 — §4.2 helper name qualification (PR11-SEC-11 a)

**Ruling: ACCEPTED — data-model §4.2 rewritten with `pg_catalog.current_setting`, `OPERATOR(pg_catalog.~*)`, `OPERATOR(pg_catalog.~)`, `pg_catalog.decode`, `::pg_catalog.uuid`.** D-ARCH-073 (1).

- The plain SQL helpers are inlined into the caller's query and therefore resolve names through the **caller's** `search_path`; qualification removes the dependency and does not prevent inlining. Rule 16 and the C-series scan still match `current_setting(` through the `pg_catalog.` prefix (word boundary) and the helpers stay exempt by `regprocedure`.
- **Timing:** PR #11's helpers migration `20261112020000_platform_rls_helpers` is **unmerged**, so it should adopt the qualified bodies now; once merged it is immutable and the same change costs a `CREATE OR REPLACE` migration (which rule 15 would then also want inside no `SET ROLE` block — the helpers are migrator-owned, fine). Listed as "required before merge" below.

## Item 6 — Plan-sheet routing (D-ARCH-074)

**Ruling: 12 `plan-data.mjs` blocks edited; regenerated with 0 errors and 0 warnings; task IDs and titles unchanged; dependency change for TASK-037 only (+TASK-024); lock changes for TASK-020 (+`lint`) and TASK-024 (+`prisma-rls`, `prisma-core`); `part: US-012` added to TASK-019 and TASK-021 (US-012 stays fully owned by TASK-006, so no generator warning).**

| Task | Block | Additions (summary) |
|---|---|---|
| TASK-015 `lanec` | 0.5 | **C-1** with `SPK03_BENCH=1` on the hosted `security-integration` job, `SPK03_REPORT` artifact with `d_overhead_ms`, recorded in SPK-03 §4 + ADR-0005 W-1, **due before G3**; delete `prisma/tests/spikes/spk03-rls-tx.int.test.ts` **and** its `TENANT_CONTEXT_EXEMPTIONS` entry in the same commit (PR11-SEC-08) |
| TASK-016 `rls` | 0.5 (PR #11 open) | D-ORCH-014 reconciliation (a)–(f) + **PR11-SEC-09 items 1–6 as merge conditions**; fix-cycle items (M1 deep Proxy, m1/PR11-SEC-02 shared forms list, m2/PR11-SEC-04 C5 PUBLIC + rule 8, m5/PR11-SEC-05 `Prisma.raw`/`$parent`/`pg` scope, PR11-SEC-08 exact-file exemptions and `keys`/`setter` split); **required by the architecture before merge** (rule 11 session-only, rule 15 SET-ROLE-only + end-of-file, rule 9 b grant order, rule 16 b operator atom, qualified helper bodies in the unmerged migration, `lc_messages = 'C'` in the unmerged backstop file, C13 case folding); deferrals with owners; dod merge-order line |
| TASK-019 `spk05` | 0.6 | `object_storage` readiness check (`HeadBucket`, 2 s, `unavailable`), AT-US-012-02-object-storage against RustFS, tripwire deleted; `part: US-012` (PR #9 m2) |
| TASK-020 `route` | 0.6 | **T-83 owner**: ESLint rule `platform/no-external-calls-in-tenant-tx` (lexical: `fetch`, imports from `undici`/`node:http(s)`/`bullmq`/`ioredis`/`@aws-sdk/*`/`stripe`/`nodemailer`, configurable member-call name list, `setTimeout` sleeps) with fixtures; lock `lint`; PR11-SEC-09 verification at the `tx` slot (runner from `platform/db/runtime.ts`; `DbError` problem+json surface) |
| TASK-021 `auditdb` | 0.6 | C6, **C7 via new manifest flag `immutable`**, C14 remainder; `audit_partitions` / `audit_chain` readiness checks replace the degraded stubs (`part: US-012`); PR11-SEC-11 c trigger events; `lc_messages` fallback file `03-role-locale.sql`; rule 10 DO-body / `U&` carry-overs; bootstrap file names aligned to §8.1 (`10-audit.sql`, `90-audit-ddl-guard.sql`) |
| TASK-024 `rlsgen` | 0.7 | **DR-A14 templates + `policySet`**, rule 9 a renderer equality, **C3 derived set + keyed atom + invariants**, **C11 converse** (PR11-SEC-06), **rule 17 + §8.4 prefix check**, C8/C9 if PR #11 does not ship them, C1 scope (e), `runtimeReadOnly` (g); locks + `prisma-rls`, `prisma-core` |
| TASK-025 `auditcore` | 0.7 | `prisma-store.ts` typed on `TenantDb`, no own client/pool (PR2-SEC-05 addendum, PR11-SEC-05 item 2) |
| TASK-028 `redact` | 0.8 | **C10** in the catalog suite |
| TASK-037 `orgs` | 1.1 | dep + TASK-024; **prerequisites check** (BLOCKED if TASK-024 / PR #11 items missing); **DR-A14 application** (rendered, pasted verbatim, prefix-safe order, `app_is_operator` template with the definer grant before `SET ROLE`); catalog adaptation (`plantProbe`, C11 helper expectation, C3, C2, C12 probes); **merge condition: security-analyst sign-off**; dod flag on the `users` FK / `identity-core` question |
| TASK-043 `outbox` | 1.3 | `writer.ts` takes `TenantDb` only; relay through the worker runtime runner, no second pool |
| TASK-049 `register` | 1.4 | **DR-A14 `users` set** (`policySet: dr-a14-users`, positive list), FK placement, C3/C12 coverage, security sign-off merge condition |
| TASK-113 `ssrf` | 3.5 | T-83 list extension with the `OutboundHttpClient` member names + fixture |

**Why these owners.** T-83 → TASK-020 because the `tx` pipeline slot is the only per-request `withTenantTx` entry and wave-1 modules are the first possible violators; TASK-113 (wave 3) would gate too late, and `lint` is free in batch 0.6. C6/C7/C14 → TASK-021 (the audit objects are its own; C7 made manifest-driven so later creating tasks self-declare). C8/C9 → PR #11 if cheap, else TASK-024 (catalog family, database-engineer, before the first module tables). C10 → TASK-028 (classification registry). PR11-SEC-09 → TASK-016 as the D-ORCH-014 reconciler, verified by TASK-020 at the first consumer. DR-A14 tooling → TASK-024 rather than TASK-037, so a DC module task is not loaded with renderer/linter/catalog work and the tooling lands one wave earlier; no new task was created (a `late` task would have been possible without renumbering, but the orchestrator's dispatch state is keyed on existing tasks).

## Item 7 — platform.md:341 wording (PR #9 n3)

**Ruling: CORRECTED.** The sentence "Per-role `statement_timeout` is set by migration (`platform_app` 25 s …)" was wrong on two counts: role settings are bootstrap-lane objects, and the role value is the **30 s backstop** of `02-role-backstops.sql`. The paragraph now describes the three layers — role backstop 30 s (non-pool sessions only), pool startup parameter `DB_STATEMENT_TIMEOUT_MS` 25 s (PR #9, overrides the role default on every pooled connection), per-transaction `DB_TX_STATEMENT_TIMEOUT_MS` 5 s inside `withTenantTx` — all below the 30 s request cap of REQ-SEC-015, with C13 and the readiness drift check as the controls. D-ARCH-074.

## Other PR11-SEC-11 items (D-ARCH-073)

| # | Ruling | Owner |
|---|---|---|
| b | ADOPTED: C13 `lower(…) LIKE 'app.%'` on `pg_db_role_setting.setconfig` and `pg_parameter_acl.parname`; assert no `pg_proc.proconfig` entry `ILIKE 'app.%'` in any non-system schema | PR #11 fix cycle |
| c | ADOPTED: distinct security events for trigger-raised 42501/23514, derived from the message prefix | TASK-021 (`AUDIT_IMMUTABLE`), TASK-051 (`GUEST_DECLAIM_FORBIDDEN`) |
| d | ADOPTED (hardening): `readSecret` opens once, `fstatSync(fd)`, bounded `readSync` | PR #11 fix cycle or TASK-034 |
| e | ADOPTED: C1 and rule 9 cover every non-system schema or assert `platform` holds no table | TASK-024 |
| f | ADOPTED: `platform/expect-affected` raised to `error` and extended to `$executeRaw` UPDATE/DELETE results | TASK-051 (already routed) |
| g | ADOPTED: `runtimeReadOnly` manifest flag refused by `validateGrants` on write lines | TASK-024 |
| h | ADOPTED as a role setting, not a note: `ALTER ROLE platform_app SET lc_messages = 'C'` in the unmerged `02-role-backstops.sql` (five C13 rows, `EXPECTED_ROLE_SETTINGS` row); fallback `03-role-locale.sql` by TASK-021; SPK-08 records RDS parity (`lc_messages` is `SUSET`) | PR #11 fix cycle / TASK-021 |

## Required code changes in PR #11 before merge

The code review's own merge conditions (M1 deep Proxy with real-itx tests; m1, m2, m5; m3 full list recorded + decision (d); m4/m6 implemented or deferred with owners; gates re-run on the final head) stand. **From the architecture, additionally required before merge** (each is a linter/catalog/text change in files PR #11 owns, and each becomes an immutable-migration or lint-blocker problem if left to TASK-037):

| # | Change | Source |
|---|---|---|
| 1 | Rule 11: `LOCK_TIMEOUT = /^set (?:session )?lock_timeout\b/` — `SET LOCAL` fails; fixture `set-local-lock-timeout`; `RESET lock_timeout` required at end of file when the value exceeds `3s` | PR11-SEC-07 (1), D-ARCH-071 |
| 2 | Rule 15: remove the `handedOver` branch; `CREATE … SECURITY DEFINER` outside the block **fails**; `ALTER … OWNER TO platform_definer` fails; end-of-file definer role fails; fixtures `definer-grants-before-owner-to` (now failing), `definer-role-not-reset` | PR11-SEC-07 (2)–(3), ADR-0005 am. 10 item 9 |
| 3 | Rule 9 b: `GRANT … TO platform_app` on an RLS-class table after `ENABLE` + `FORCE` (+ policies) in the same file; fixture `grant-before-force` | PR11-SEC-07 |
| 4 | Rule 16 b: exempt exactly the normalised operator atom and only inside `CREATE POLICY`; a fixture holding the rendered TENANT/GUEST_CAPABLE/USER_OWNED blocks lints clean | PR11-SEC-03 (1) — otherwise TASK-037's first migration fails lint |
| 5 | Helpers migration `20261112020000_platform_rls_helpers`: qualified bodies per data-model §4.2 (unmerged, so free now) | PR11-SEC-11 a, D-ARCH-073 |
| 6 | `02-role-backstops.sql`: add `ALTER ROLE platform_app SET lc_messages = 'C'`; C13 five rows; `EXPECTED_ROLE_SETTINGS` row (already being reconciled under D-ORCH-014 (a)) | PR11-SEC-11 h, D-ARCH-073 |
| 7 | C13 case folding + `proconfig ILIKE 'app.%'` assertion | PR11-SEC-11 b |
| 8 | Sheet lines D-ORCH-014 (a)–(f) and PR11-SEC-09 items 1–6 implemented as merge conditions (the sheet now carries them) | D-ORCH-014, PR11-SEC-09 |

Recommended but not required before merge (owner exists otherwise): C8/C9 (else TASK-024), PR11-SEC-06 C11 converse (else TASK-024), `readSecret` open-once (else TASK-034), rule 10 DO-body / `U&` (else TASK-021).

## Open items handed on

- **sdlc-orchestrator:** forward the TASK-016 sheet additions to the running fix cycle (items 1–8 above); apply the TASK-037 dependency change (+TASK-024) in STATUS/dispatch; decide with senior-developer the `users`-FK / `identity-core` question on TASK-037's dod before dispatch; mark D-TASK016-01's three "open for principal-architect" items closed by D-ARCH-071/072.
- **security-analyst:** PR11-SEC-03/06/07/09/10/11 addressed in design text and routed as above; verify at the PR #11 fix-cycle review, TASK-024 and TASK-037/049 reviews; the DR-A14 sign-off is now a sheet-level merge condition; threat-model T-83 row may cite TASK-020 as the lint owner.
- **qa-lead:** flip `migration-lint` and `catalog-c1-c14` to active with US-074 at PR #11 merge (security review §6); the catalog suite header lists C6–C10 deferrals by owner; C-1 verification at P6 unchanged.
- **product-manager:** optional DR-A14 wording (`organisations` instead of `sessions` in the special list); no DC impact.
- **data-architect:** none — the data-model half was done here.
- **performance-engineer:** C-1 artifact now comes from TASK-015's job; verify at P6.
