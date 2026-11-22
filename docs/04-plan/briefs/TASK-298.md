# Dispatch brief: TASK-298, C16 follow-up: constraint state (arm c) and referential actions (arm d)

- **Plan fold / dispatch:** D-SD-011 (task created), D-SD-012 (QG-051-C7 lines folded onto the card). Dispatched by senior-developer in orchestrator session C (2026-11-21). The card section below is copied verbatim from `docs/04-plan/tasks/WAVE-01.md`. If they differ, the generated card governs.
- **Branch:** `feat/TASK-298-c16-follow-up-constraint-state`, from `origin/main` `3d54cef8` (TASK-051 is on main as PR #83, `a93a6113`). Worktree `../Shipqube-TASK-298`.
- **Specialist and model:** database-engineer, **opus** (card: complexity S, opus).
- **Why now:** MERGE PREREQUISITE of TASK-087 (the first quote tables, the first owner-bound pairs and the first T2-O exception entry). D-QG-006 leaves QG-051-C6 "ruling CLOSED, build OPEN" until this task is on main; QG-051-C7 (b)/(c) are due before G3.
- **Locks:** `prisma-rls`. No migration, no schema file, no manifest, no product code.

## Read first (in this order; stop when you have what the item needs)

1. `docs/03-architecture/rulings/wave-1-r-arch-34-operator-rulings.md` §8.12 (whole: the rulings for arms (c) and (d), the SQL sketches as run on PostgreSQL 18.6, rows K1-K9 and N1-N7). The sketches are guidance; the rules and the plants of the card bind.
2. `docs/03-architecture/data-model.md` §4.6, row C16 (arms (a) to (d) as amended 2026-11-21).
3. `docs/05-quality/security/PR-0083-TASK-051-security-review.md` lines 346-372 (PR051-SEC-06, probe P8 (D), the fix sketch).
4. The code: `prisma/tests/catalog/tenant-keys.ts` (whole), `tenant-keys.test.ts`, `c16-tenant-keys.int.test.ts`, and `prisma/tests/organisations/organisations.int.test.ts` line 316 (the O7 title).

Do not read the ADRs, the other rulings sections or DECISIONS.md: the card and this brief carry what you need.

## Scope notes (lead)

1. **Arm (a), `enforced` (D-ARCH-216 item 1).** `TENANT_REFERENCES_SQL` gains `(c.conenforced AND c.convalidated) AS enforced`, and `TenantReference` gains `enforced: boolean`. In the pure rules: a key with `enforced` false is reported **whatever its columns** (a new violation kind, for example `not-enforced`, with its own message), it is never org-bound, guest-bound or a sibling (so the `sibling()` lookup must ignore unenforced rows, which makes its partner `guest-only` / `org-only`), and an exception entry that names it is a finding (`exceptionDefect` accepts only kind `org-only`, so that holds once the kind differs; pin it with a fixture). Keep the existing kinds and messages byte-stable for enforced keys.
2. **PR051-SEC-06 (structured pairs).** Replace the joined `rest` text with structured data: return the non-owner column pairs as an array (for example `jsonb_agg(jsonb_build_array(ka.attname, kp.attname) ORDER BY k.n)` with `COALESCE(..., '[]'::jsonb)`, or two `text[]` columns). Compare the arrays element by element for siblings. `soleRestColumn` returns the referencing name of a one-element array. If a printable form is still wanted in messages or `ReferenceViolation`, derive it in TypeScript; never parse identifiers out of text. Planted case `c16_g_eq` (security review P8 (D)): columns `a` and `"a=x"`, CHECK `a IS NULL OR org_id IS NOT NULL`, key `(org_id, "a=x") → c16_gparent (org_id, id)`, and an exception entry naming the key and that CHECK: the key is reported **and** the entry is reported as not live. Control (same rolled-back transaction or its own): with the CHECK on the real referencing column, a guest row (`org_id` NULL) naming A's parent is refused `23514`. A unit fixture in `tenant-keys.test.ts` proves both halves on the pure function (including the sibling case `a → "b=c"` vs `"a=b" → c`, which must no longer compare equal).
3. **Arm (c), constraint state (D-ARCH-216 item 2).** A second query over **every** constraint of a non-system schema (`nspname <> 'information_schema' AND nspname NOT LIKE 'pg\_%'`, any `contype`, no `conparentid` filter) returning the rows with `NOT (conenforced AND convalidated)`; a pure finding function over its rows; no exception map. Committed schema: 0 findings. Plants (each rolled back, each reported by name): an org-bound key declared `NOT ENFORCED`; an org-bound key altered with `ALTER TABLE … ALTER CONSTRAINT … NOT ENFORCED`; an org-bound key added `NOT VALID`; a guest-bound key declared `NOT ENFORCED` whose org-bound sibling is then reported by arm (a) as alone (`org-only`); an owner CHECK declared `NOT ENFORCED`; a CHECK added `NOT VALID`. The `NOT ENFORCED` / `NOT VALID` plants are also arm (a) findings where they are keys between `org_id` tables: assert both arms where the card names both.
4. **Arm (d), referential actions (D-ARCH-215).** A query over every foreign key of a non-system schema with `NOT (confdeltype = 'r' AND confupdtype = 'r')`; a pure finding function; no exception map. Committed schema: 0 findings, and the test states that the 13 keys of the merged migrations pass (count them from the catalog, `contype = 'f'` in non-system schemas, and pin `13` with a comment naming the two migrations: `20261112010000_authz_catalogue_tables` (2) and `20261117000000_organisations_identity` (11); verify the count against `origin/main` before pinning, and say in the report that a later task adding a key bumps it). Plants: `ON UPDATE CASCADE`, `ON DELETE SET NULL`, and a key that states no action (`NO ACTION` on both, `a`/`a`).
5. **PostgreSQL 18 only.** `pg_constraint.conenforced` exists from 18 on. Do not adapt any query for PGlite 17 and do not add a PGlite replay of these queries.
6. **Header.** Update the module headers of `tenant-keys.ts` and `c16-tenant-keys.int.test.ts` to name arms (c) and (d), D-ARCH-215, D-ARCH-216 and PR051-SEC-06; the limits paragraph stays true.
7. **O7 tag (QG-051-C7 (b)).** Add `[SEC-TC-79]` at the front of the O7 title in `prisma/tests/organisations/organisations.int.test.ts:316`. Title only; Prettier may re-wrap the line. Nothing else in that file.
8. **O1/O7 mutants on PostgreSQL 18 (QG-051-C7 (c)).** The lead runs them in the lane B slot (cut the operator clause, then the UPDATE arm, out of a scratch copy of migration `20261120210000_operator_staff_grants`; run O1 and O7; restore). You do **not** commit or write a mutant. You may leave a short note in your report on which assertions you expect to fail.
9. **Ripple rule for the handoff (D-ARCH-215).** Once this is on main, a migration whose foreign key states another action than `RESTRICT`, or none, fails the catalog suite; every later Prisma relation states `onDelete: Restrict, onUpdate: Restrict`. Name this rule in your report.

## Acceptance (IDs in test titles)

- `[D-ARCH-216]` arm (c): committed 0, six plants reported (scope note 3).
- `[D-ARCH-215]` arm (d): committed 0 with the 13-key pin, three plants reported (scope note 4).
- `[D-ARCH-216]` arm (a) `enforced`: unenforced keys reported and never siblings; an entry naming one is a finding.
- `[PR051-SEC-06]` structured pairs: `c16_g_eq` reported with its entry; the `23514` control.
- Keep `[SEC-TC-76]` on the existing C16 titles. Whether the new plants join SEC-TC-76 is security-analyst's call (D-ARCH-216): do not add the tag to the new titles.
- `[SEC-TC-79]` on O7 (title only).
- Host unit fixtures in `tenant-keys.test.ts` for every new rule and branch (95 % is not enforced on `prisma/tests`, but every new branch of the pure functions needs a fixture).

## Tests and evidence

- **Host (you run):** `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm run test:unit -- prisma/tests/catalog` (put the path first if you call jest directly: `jest <path> --selectProjects unit`). If a failed typecheck leaves stray `.js`/`.d.ts`/`.map` files under `prisma/tests` or `tools`, delete those untracked files before committing.
- **Lane B (lead, PostgreSQL 18):** `c16-tenant-keys.int.test.ts` (integration and catalog copies), `organisations.int.test.ts`, catalog C1-C15, the generated RLS suite. Make the int test compile and say which assertions are first-run guesses (for example the printed definition text of a plant), so the lead knows what lane B confirms.
- **Literal pins:** none expected (no table, column, manifest or model changes).

## `.env.example` lines this task may need

None.

## Working rules

1. **Worktree.** Work only in `../Shipqube-TASK-298` on the branch above. Dependencies are already installed there (`npm ci --ignore-scripts` + `deps:rebuild` done by the lead): do not reinstall. The main checkout is shared with other agents: never touch it. If your sandbox pins you to `.claude/worktrees/agent-*`, use `git -C <worktree>` and the Write/Edit tools instead of `cd` and heredocs.
2. **Node.** Every node or npm command starts with `export PATH="$APPDATA/fnm/aliases/default:$PATH";`. Tools run through `npm exec --no --`, never `npx`.
3. **No Docker.** No Testcontainers, no `quality:heavy`, no integration/api/catalog suites, no `docker` commands: they run only in the lead's lane B slot under `../.orch/docker.lock`.
4. **No new dependency;** do not touch `package-lock.json`, `eslint.config.mjs` or any migration.
5. **Bash pitfalls on this host.** Heredocs and `node -e` lose backslashes and break on backticks: use the Edit and Write tools for any source change that contains regex, backslashes or template literals (SQL `LIKE 'pg\_%'` is one).
6. **Commits.** Conventional Commits with a lower-case subject containing `task-298` (for example `test(db): task-298 c16 arms (c) and (d), structured key pairs`), body lines under 100 characters, a blank line before any decision list, decisions as `D-TASK298-nn` in commit bodies (never in DECISIONS.md), and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No push, no PR. No secret-shaped literals (gitleaks scans the PR range on every push).
7. **Security-owned path.** `prisma/**` is security-owned: list the files you changed in the report; the lead requests the security record.
8. **Turn budget.** Commit early (one commit when the unit tests are green, a second for the int test). Past about 65 tool calls, finish what you have, commit it and write the report. Never stop silently.
9. **Handoff Report** (`docs/sdlc/templates/HANDOFF.md`): branch and head SHA, files changed, test evidence (commands and counts), `D-TASK298-nn` decisions, the security-owned paths touched, first-run guesses lane B must confirm, the ripple rule (scope note 9), open questions.

## Card (generated by docs/04-plan/generator/gen.mjs, verbatim)

#### TASK-298 — C16 follow-up: constraint state (arm c) and referential actions (arm d) in the tenant-key catalog assertion

| Field | Value |
|---|---|
| Stories (completes) | — |
| REQs | — (enabler; see refs) |
| NFRs | NFR-TENANT-001 |
| Spikes / security / decisions | D-QG-005, QG-051-C1, QG-051-C6, D-ARCH-215, D-ARCH-216, R-ARCH-34, SEC-TC-76, D-SD-011, D-QG-006, QG-051-C7, PR051-SEC-06, D-SD-012 |
| Specialist · model | database-engineer · opus |
| Complexity | S |
| Depends on | TASK-051 |
| Batch · locks | 1.11 · prisma-rls |
| Branch | `feat/TASK-298-c16-follow-up-constraint-state` |
| Priority | Enabler |

> Scheduling note: Late task (plan fold D-SD-011): the C16 follow-up of rulings section 8.9 (D-ARCH-215, D-ARCH-216) in batch 1.11; a separate PR so that the TASK-051 review and security rounds are not reopened.

**Files / modules**
- prisma/tests/catalog/tenant-keys.ts (TENANT_REFERENCES_SQL gains enforced; the pure function and the arm (c) and (d) queries) and tenant-keys.test.ts (fixtures)
- prisma/tests/catalog/c16-tenant-keys.int.test.ts (arms (c) and (d), planted cases rolled back)
- prisma/tests/organisations/organisations.int.test.ts (the [SEC-TC-79] title tag of O7 only; D-QG-006 QG-051-C7)

**Acceptance tests to write**
- C16 (c) CONSTRAINT STATE (D-QG-005 condition QG-051-C6; D-ARCH-216; data-model 4.6 C16 as amended 2026-11-21; rulings section 8.12): TENANT_REFERENCES_SQL returns per foreign key the fact enforced = conenforced AND convalidated; the pure function reports a key that is not enforced whatever its columns, never counts it as org-bound, guest-bound or a sibling, and reports an exception entry that names it; a second assertion of the suite finds no constraint of a non-system schema (the scope of P9-CK) with conenforced or convalidated false, with no exception map; planted and reported, each rolled back: an org-bound key declared NOT ENFORCED, an org-bound key altered to NOT ENFORCED with ALTER CONSTRAINT, an org-bound key left NOT VALID, a guest-bound key declared NOT ENFORCED whose org-bound sibling is then reported as alone, an owner CHECK declared NOT ENFORCED and a CHECK left NOT VALID; fixtures in tenant-keys.test.ts drive the function; pg_constraint.conenforced exists from PostgreSQL 18 on, so the query fails on a PGlite 17 replay and is not adapted for it
- C16 (d) REFERENTIAL ACTIONS (D-QG-005 condition QG-051-C1 (a); D-ARCH-215; ADR-0005 amendment 15 item 37 as clarified 2026-11-21; data-model 4.6 C16): no foreign key of a non-system schema has confdeltype or confupdtype other than r (RESTRICT), with no exception map; planted and reported, each rolled back: a key with ON UPDATE CASCADE, a key with ON DELETE SET NULL and a key that states no action (NO ACTION on both); not reported: the 13 keys of the merged migrations
- MERGE ORDER (D-ARCH-216 owner and date; D-SD-011): starts when TASK-051 is on main (both tasks edit tenant-keys.ts) and merges before TASK-087 opens its PR (MERGE PREREQUISITE on TASK-087); the TASK-051 fix cycle does not take it
- RIPPLE (D-ARCH-215): once this task is on main a migration whose foreign key states another action than RESTRICT, or states none, fails the catalog suite; Prisma defaults a relation to Cascade on update, so every relation of a later schema file states onDelete: Restrict and onUpdate: Restrict; the cards of TASK-087, TASK-092, TASK-154 and TASK-237 say so, and the handoff of this task names the rule for the orchestrator
- PR051-SEC-06 (INFO, CWE-1023; D-SECPR051-02; D-QG-006 QG-051-C7 (a)): tenant-keys.ts returns the referencing and referenced column pairs as an array, not as joined text split on =, for the T2-O entry check and for the sibling comparison (the split at tenant-keys.ts lines 122, 223 and 239 at 39cac6e5); planted case: a quoted column "a=x" in the key and the CHECK on column a: the key is reported and the entry no longer hides it; control: the CHECK on the real column refuses the row (23514)
- O7 TAG AND POSTGRESQL 18 MUTANTS (D-QG-006 QG-051-C7 (b) and (c); D-SECPR051-02; due before G3): this task adds [SEC-TC-79] to the title of O7 in prisma/tests/organisations/organisations.int.test.ts (title only, after TASK-051 is on main, so no binding of PR #83 is voided), runs the mutants of O1 and O7 of the TASK-051 code review (rounds 1 and 2, PR-0083-TASK-051-code-review.md) on PostgreSQL 18 in its lane B slot, and reports both as killed in its PR; qa-lead moves SEC-TC-79 (O1 to O7) into integration.required_cases after the TASK-051 merge

**DoD notes**
- Suites tagged (`@security` where applicable) and registered in `tools/quality/required-suites.json` with `min_tests`; deterministic (fake clock, seeded RNG); flake < 1 % over 20 runs.
- prisma/tests/catalog is a security-owned path: the PR carries a security record; whether the planted probes join SEC-TC-76 is security-analyst, and whether QG-051-C6 is closed is quality-gatekeeper (D-ARCH-216)
- Lane B on PostgreSQL 18: the catalog suite green with every planted case; no adaptation for PGlite 17
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`prisma/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.
