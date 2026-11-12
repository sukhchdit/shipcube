# Wave-0 sheet-fold 1 — rulings and closure table (2026-11-13)

Owner principal-architect. Inputs: `docs/sdlc/STATUS.md` rows SHEET-FOLD-1, ROUTED-0.2 (open remainder), ROUTED-W0-B3 (remainder), COND-E2E-FF, D-ORCH-021; DECISIONS D-ORCH-015..021, D-061, D-SEC-PR12-01, D-SEC-PR13-02, D-TASK012-01/02, D-TASK023-01, D-TASK007-03/04; review records PR-0002/0003/0004/0005/0009/0010/0011/0012/0013/0017 (code + security); `docs/04-plan/spikes/SPK-08.md` §7–§9. Decisions: **D-ARCH-075..079**. Edited: `data-model.md` (§3.5, §4.4, §5.2, §5.3, §5.5, §5.6, §7.3, §8.3, §9.2, §12 A20), `adr/ADR-0007-audit-store.md` (am. 9), `adr/ADR-0023-ci-cd-and-release.md` (`.swcrc`), `risks.md` v1.7 (R-ARCH-27), `generator/plan-data.mjs` (47 replacements, 25 task blocks), regenerated plan (0 errors, 0 warnings, 281 tasks; IDs unchanged; one dependency change: TASK-089 + TASK-014; no lock change).

## 1. Decisions

| # | Item | Ruling | Where |
|---|---|---|---|
| (a) | PR13-SEC-04 `platform_app` grant on `reference_dataset_versions` | **SELECT only** (reviewer option 1). The seed is the single writer (migrator = owner). TASK-221's reconciler needs **no write at all**: it derives the last audited digest from the latest `CONFIG_CHANGE` entry in `audit_entries` (tamper-evident store, `SELECT` for `platform_app`), which also removes the PR13-SEC-08 "second baseline after `down.sql`" problem. Options 2 (RLS on a SYSTEM table) and the table-grant form are rejected; option 3 (definer function) is the sanctioned form *if* a runtime writer ever appears; option 4 (`CHECK (version < 2³¹−1)`) not adopted (no runtime writer remains). Corollary (PR13-SEC-08 TASK-025 item): the **migrator gains no audit privilege**; seed-originated `CONFIG_CHANGE` entries are written by the generalised reconciler for every audited dataset; drift restores recorded via two expand columns (TASK-221) and audited the same way. `version` → `dataset_version` (D-TASK023-01 (01)). `pg.Client`, never a pool (PR #13 n3) | §3.5, §4.4, §9.2; D-ARCH-075 |
| (b) | PR12-SEC-02 partition-name squatting (MEDIUM) | Three layers: guard matches the object's **own name** for every `pg_class`/`pg_type` kind; `ensure_audit_partitions` **identity test** raising `AUDIT_PARTITION_NAME_TAKEN` / `AUDIT_PARTITION_BOUNDS_MISMATCH` (never a silent skip); readiness = **contiguity from the catalogue** for months current..+2 plus `unavailable` + `audit_partition_squatted` for any foreign object under a partition name. Plus PR12-SEC-03 (plain `CREATE FUNCTION`; C14 owner/converse/dependency checks), PR12-SEC-08 (prototype RLS not ported; real rule-12 marker) and the **`ENABLE ALWAYS`** decision (PR12-SEC-04 item 3) with stated limits | §5.2, §5.3; ADR-0007 am. 9 item 4; R-ARCH-27; D-ARCH-076 |
| (c) | SPK-08 F-01/F-02/F-03/F-04/F-11; A-1..A-7; AF-9/AF-12 | §7.3 "verify in P5 spike" notes closed; F-01 generated `tables.external` window (lane re-order rejected); F-02/F-03 shadow rendering with `DROP SCHEMA … CASCADE`, grant stripping and the **owner refusal** as first statement; F-04 `INCLUDE` rule and F-11 `WHERE` rule (R2-m1 wording) as **TASK-024** linter rules due before TASK-026; A-2 (raw-UUID sort, empty set), A-3 (JCS line, string compare), A-4 (`clock_timestamp()` rendered by PostgreSQL) **ratified** as hash/sink inputs; A-1 precedence + `failure_kinds[]` + `ANCHOR_SINK_MISMATCH`; A-5 strict DER; A-6 clamp [now − 15 min, now + 2 min]; A-7; AF-9/AF-12 nightly-walk qualifier; ADR-0007 am. 6 digest wording superseded by a pointer to §5.5 | §5.5, §5.6, §7.3; ADR-0007 am. 9; D-ARCH-077 |
| (d) | PR11-SEC-16 E-strings; PR #11 R2-n2 by-form limits | `E'…'` strings in `EXECUTE` operands **refused token-level** (as `U&`), owner TASK-024 with PR11-SEC-14 b; §8.3 "Limits" lists forms (a)–(e) with their outcome controls (C3/C11/C13/C14, leak detector); rule 11 quoted names / `set_config('lock_timeout')` → TASK-024, DO bodies → TASK-021 | §8.3; D-ARCH-078 |
| (e) | D-061 US-049 split | Applied verbatim: TASK-023 `part: US-049` with AT-01/-03/-04/-06/-07/-08; TASK-014 `part: US-049` + AT-02 (+ n7, PR13-SEC-08/-06 one-shot env); TASK-089 **completes** US-049 (AT-05/-09/-10-1/-10-2, PR13-SEC-02 gate, n3/n4) and gains the dependency on TASK-014; TASK-026 evidence line | plan-data; D-ARCH-079 |
| (f) | `.swcrc` mentions (PR #17 R2-n2) | plan-data `ws` deliverable annotated "REMOVED … PR17-SEC-01, D-TASK007-04"; WAVE-00.md regenerated; ADR-0023 full-trigger path struck with a dated note | plan-data, ADR-0023; D-ARCH-079 |

**Owner conflicts resolved:** PR5-SEC-14 / PR #5 R3-n2 (code review said TASK-014, security said TASK-034) → **TASK-034** (owner of the reset/restore tooling). PR #11 R3-n3 (STATUS: TASK-020) → **TASK-024** (setter keys, quoted names) + **TASK-021** (DO bodies), following the security review's PR11-SEC-17 c routing; TASK-020's sheet says so. PR #3 R3-n3 (TASK-015 or TASK-022) → **TASK-022**. PR17-SEC-09 (no task named) → **TASK-015** (devops, batch 0.5, before the first Wave-1 feature merge). PR9-SEC-15 (no task after TASK-007 merged) → **TASK-014**. `db_session_context_leak` metric name (code review) vs `db_session_context_leak_total` (security) → **`db_session_context_leak_total`** (Prometheus counter convention). m4 "templates" extension → the first task that seeds `notification_templates` (noted on the holidays task).

## 2. Closure table — STATUS row item → sheet line (for the orchestrator to mark FOLDED)

Sheet = `docs/04-plan/tasks/WAVE-0x.md`, acceptance list of the task unless stated. "x" = also in the task's refs (`task-map.csv`).

### SHEET-FOLD-1

| STATUS item | Folded into |
|---|---|
| D-061 US-049 split: seedfw partial | TASK-023 header `part: US-049`, first acceptance line (x: D-061) |
| D-061: compose AT-02 + bootstrap pg error listener | TASK-014 `part: US-049`; lines "AT-US-049-02 …" and "PR13-SEC-09 … register a pg error listener (tools/db/bootstrap.ts has the m1 gap)" |
| D-061: seeddemo AT-05/09/10 + PR13-SEC-02 | TASK-089 `us: +US-049`, `d: +TASK-014`; line "AT-US-049-05, -09, -10-1, -10-2 … PR13-SEC-02 GATE …" |
| D-061: slice evidence line | TASK-026 line "D-061 evidence line …" |
| PR13-SEC-04 grant decision | D-ARCH-075; data-model §3.5/§4.4/§9.2; TASK-023 line "SUPERSEDING BRANCH … PR13-SEC-04 AS RULED"; TASK-221 line "D-ARCH-075 …"; TASK-025 line "D-ARCH-075 …" |
| SPK-08 F-01/F-02 §7.3 | data-model §7.3 amendment; TASK-021 line "SPK-08 F-01/F-02/F-03 …"; TASK-034 line (F-01 restore config) |
| TASK-021 port-then-delete (M3) | TASK-021 DoD line "SPK-08 §8.1 PORT-THEN-DELETE …" |
| PR12-SEC-02 amend §5.2/§5.3 + readiness; TASK-021 implements; TASK-033 tests | data-model §5.2/§5.3 amendments; TASK-021 line "PR12-SEC-02 (MEDIUM) …"; TASK-033 line "PR12-SEC-02 tests …"; R-ARCH-27 |
| PR12-SEC-01 → TASK-033 + qa-lead SEC-TC-61 | TASK-033 line "PR12-SEC-01 (LOW) escalation primitives …" (qa-lead text change noted there) |
| PR12-SEC-03 plain CREATE guard + C14 converse → TASK-021 | TASK-021 line "PR12-SEC-03 (LOW) + PR12-SEC-08 + PR12-SEC-04 item 3 …" |
| PR12-SEC-05 incremental verifier / A-1 / A-6 / SEC-TC-44 → TASK-116 + architect | data-model §5.6 amendment; TASK-116 lines "ANCHOR FORMAT AS RATIFIED …" and "AF-9/AF-12 qualifier + PR12-SEC-05 b/f …" |
| F-01 lane-reorder REJECTED | data-model §7.3 F-01 bullet, §5.2 "What it does not cover" |
| SPK-08 §8.1 DoD lines on TASK-021 / TASK-116 | TASK-021 DoD line; TASK-116 line "SPK-08 §8.1 PORT-THEN-DELETE …" |
| F-11 partial-index rule (+ R2-m1 WHERE) → §7.3 + linter | data-model §7.3 F-11 bullet; TASK-024 line "SPK-08 F-04 and F-11 linter rules …" |
| A-2/A-3/A-4 before TASK-116 | data-model §5.5 "Anchor format (byte layouts), ratified"; ADR-0007 am. 9; TASK-116 first new line |
| PR9-SEC-15 npm_execpath / script-shell → TASK-014 | TASK-014 line "PR9-SEC-15 (LOW; TASK-007 merged without it) …" |
| PR9-SEC-17 sslrootcert bounded read → TASK-014 | TASK-014 line "PR13-SEC-09 … + PR9-SEC-17 + PR9-SEC-16 remainder + PR #9 r1 n5 …" |
| PR9 R3-m1 DATABASE_URL value agreement exit 78 → TASK-014 | TASK-014 line "PR #9 code review R3-m1 + PR #11 code review R3-m2 …" |
| PR10-SEC-21 last-Verdict head SHAs → TASK-015 | TASK-015 line "PR10-SEC-19/20/21 + …" |
| PR10-SEC-16/17/18..20 + code R2-m1..m4 → TASK-015 | TASK-015 lines "PR10-SEC-16/17/18 + …" and "PR10-SEC-19/20/21 + …" |
| PR #11 r3 R3-m1 owners (sink → TASK-010; metric → TASK-214; Client + boot assertion → TASK-020) | TASK-010 line "PR #11 code review R3-m1 (i) …"; TASK-214 line "PR #11 code review R3-m1 (ii) …"; TASK-020 line "… RUNNER ACTIVATION …" |
| R3-m2 PGOPTIONS exit 78 → TASK-014 | TASK-014 line "PR #9 code review R3-m1 + PR #11 code review R3-m2 …" |
| R3-n2..n6 → TASK-020 (n6), TASK-021 (n5) | TASK-020 line "PR11-SEC-17 a/b … + PR #11 R3-n2/R3-n4 …" (n6 in the runner line); TASK-021 DoD (n5 tripwire); n3 → TASK-024/021 (see conflicts) |
| PR11-SEC-16 E-string → TASK-024 + §8.3 Limits | data-model §8.3 Limits; TASK-024 line "PR11-SEC-16 (LOW) + PR11-SEC-14 b + PR11-SEC-17 c …" |
| PR11-SEC-17 a/b → TASK-020, c → TASK-024/021 | TASK-020 line "PR11-SEC-17 a/b …"; TASK-024 line (c setter keys); TASK-021 line "PR11-SEC-17 c DO-body part …" |
| TASK-020 activates the runner | TASK-020 line "… RUNNER ACTIVATION …" |
| qa-lead activates migration-lint + catalog-c1-c14 at PR #11 merge | not a sheet item — qa-lead action at merge (unchanged) |
| PR17-SEC-02 line/column + n5 lockfile classifier → TASK-015 | TASK-015 line "PR17-SEC-02/07/08/10 + …" |
| PR4-SEC-12 delete stock default.conf → TASK-014 | TASK-014 line "PR4-SEC-02 / PR4-SEC-12 (BINDING) …" |
| PR2-SEC-09 + PR2-SEC-03 TS-only block → TASK-022 | TASK-022 line "PR2-SEC-03 remainder + PR2-SEC-09 …" |
| PR4-SEC-08 PLAYWRIGHT_*DOWNLOAD_HOST → TASK-015 | TASK-015 line "COND-E2E-FF … PR4-SEC-08 residual …" |
| PR #4 r3 NITs: R3-n1 → TASK-042; R3-n3/n4 → qa T-QA-05; R3-n6 → TASK-015 | TASK-042 line "PR #4 code review m2 + R3-n1 …"; TASK-015 line (globalTimeout); R3-n3/n4 remain qa-lead (T-QA-05 / TEST-STRATEGY §7.8, §11) — not a task sheet |
| D-ORCH-021 routing (PR17-SEC-02/07/08/10, R2-m1/n1/n3 → TASK-015; PR17-SEC-09 → devops; `.swcrc` → fold) | TASK-015 lines "PR17-SEC-02/07/08/10 …" and "PR4-SEC-11 … + PR17-SEC-09 …"; `.swcrc` in TASK-001 deliverable + ADR-0023 |

### ROUTED-0.2 (open remainder)

| Item | Folded into |
|---|---|
| TASK-002 m7 → TASK-015 | TASK-015 line "PR #2 code review m7 …" |
| m9(b) → carriers adapter task | TASK-131 line "PR #2 code review m9 (b) …" |
| m10 → TASK-076 | TASK-076 line "PR #2 code review m10 …" |
| PR2-SEC-03 TS-only → TASK-004 → re-routed TASK-022 | TASK-022 (as above); `--allow-empty-input` already dropped in PR #4 (ba57e77) |
| PR2-SEC-04 → TASK-112/113 | TASK-112 line "PR2-SEC-04 … no-innerhtml …"; TASK-113 line "PR2-SEC-04 … outbound-http-via-client …" |
| password-hasher-only → TASK-049 | TASK-049 line "PR2-SEC-02 residual …" |
| PR4 m2 → TASK-042; m5 → TASK-022 (already: VITE_PUBLIC_ORIGIN required, D-ARCH-054); m6 → first lazy-route task | TASK-042 lines (m2; m6 conditional) |
| PR4-SEC-02 → TASK-014/111 | TASK-014 (binding delete); TASK-111 line "PR4-SEC-02 / PR4-SEC-06 (header suite) …" |
| PR3 m5 / PR3-SEC-06 → TASK-006/014 | TASK-014 line "PR13-SEC-08 / PR13-SEC-06 + PR3-SEC-06 (… per-service env) …" (TASK-006 part merged) |
| PR3 m6 → crypto consumer tasks | no sheet change: the local-only key derivation contract is recorded in the config module doc (PR #3 R2.2 "routed"); first crypto consumer (TASK-049 hasher / TASK-116 anchors) reads it from there — flagged for senior-developer, not re-folded |
| PR3 r3: PR3-SEC-16 → TASK-006 | TASK-006 merged (PR #9); not re-folded — security-analyst confirms at the next `secret-refs.ts` touch |
| PGOPTIONS/PG* preflight → TASK-014 | already on TASK-014 (entrypoint preflight line) |
| R3-n1..n4 + R4-n1 → TASK-022 | TASK-022 line "PR #3 code review R3-n1/n2/n3/n4 (+ R4-n1, optional) …" |
| ADR-0018 §3 APP_ENV wording + ECS signal → architect | already done (ADR-0018 am. 8, verified today) |
| PR #5 r3: R3-n1 → TASK-016 (already on sheet); R3-n2 / PR5-SEC-14 → TASK-034 | TASK-034 line "PR #5 code review R3-n2 / PR5-SEC-14 …" |
| PR5-SEC-10 → qa-lead | not a task sheet (SEC-FU-QA) |

### ROUTED-W0-B3 remainder / COND-E2E-FF / other

| Item | Folded into |
|---|---|
| COND-E2E-FF → TASK-015 | TASK-015 line "COND-E2E-FF (D-ORCH-019, D-ORCH-020; due before G3) …" (x: COND-E2E-FF) |
| D-SEC-PR13-02 (4) PR13-SEC-09 → TASK-014 | TASK-014 line "PR13-SEC-09 (LOW) …" |
| PR13-SEC-05 → TASK-026 | TASK-026 line "PR13-SEC-05 remainder …" |
| PR #13 m4 Dataset contract extensions → seed tasks | TASK-066 (a: fk/seedId, first consumer), svcref/TASK-130-ish carriers (a), packseed (a, c arbiterWhere), samples/holidays (b NND), seqs/number-sequences (d insertOnlyColumns), pricingseed (a); templates (b) noted on the holidays task for the first `notification_templates` seeder |
| PR13 R2-m1 / R2-n1 / PR13-SEC-10 | TASK-023 "SUPERSEDING BRANCH …" line |
| PR13-SEC-08 TASK-025 item (audit-writer role on the seed path) | TASK-025 line "D-ARCH-075 …" (x: PR13-SEC-08, D-ARCH-075) |
| PR13 n3 (pool), n4 (secrets), n6 (reserved name) | TASK-089 line (n3, n4); n6 closed in PR #13; §3.5 records the reserved name |
| R-ARCH-21 `build_clean` → TASK-011 | TASK-011 line "R-ARCH-21 / ADR-0023 am. I item 4 …" |
| PR4-SEC-11 generalised jest-reference ownership test → TASK-015 | TASK-015 line "PR4-SEC-11 / PR #4 R3-M1 generalisation + PR17-SEC-09 …" (R3-M1 itself lands in PR #4 fc2, D-ORCH-020) |
| PR4-SEC-10 → PR #4 fc2, fallback TASK-022 | TASK-022 line (FALLBACK clause) |
| PR12-SEC-04 RDS residual | COND-G4-PROD (already); `ENABLE ALWAYS` decision + TASK-116 tripwire folded (TASK-021, TASK-116 lines; §5.2) |

## 3. Not folded (deliberately), with owner

- qa-lead: PR #4 R3-n3/R3-n4 (T-QA-05 / TEST-STRATEGY §7.8), R3-n6 known issue (§11), PR12-SEC-01 SEC-TC-61 row text, PR5-SEC-10 SEC-TC-64 catalogue text, SEC-TC-44 variant (d) row — tracked under SEC-FU-QA.
- sdlc-orchestrator: PR10-SEC-05 repository settings (denied, D-ORCH-012), PR10-SEC-19 (d)/PR10-SEC-20 (b) procedural rules (reject PR diffs touching another agent's memory directory; records only for the PR's own number), D-ORCH-021 RANGE_BASE lever (repository owner).
- platform-architect / release-manager: PR12-SEC-04 `pgaudit` classes/filters, PR12-SEC-05 (e) sink versioning — COND-G4-PROD (unchanged text; the design decisions are now in §5.2/§5.6).
- TASK-006 (merged): PR3-SEC-16 guarded `describeFailureCause` — security-analyst re-raises at the next `packages/config/src/secret-refs.ts` change.
