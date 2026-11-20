---
name: project-p5-pr65-task037
description: PR #65 (TASK-037 orgs/memberships/users, DR-A14 RLS, std-columns guard) r1 @29be7be + r2 delta @d4de55d PASS_W_COND (main 1d31ea8, fb766c1); 01 closed in r2; LOW 02 operator self-join open; INFO 03-05; SEC-TC-76..78; C1 lane-B on d4de55d; shadow-init + C15 rulings; PGlite kit
metadata:
  type: project
---

Round 1, 2026-11-19, static plus PGlite 17.5 probes (host rule). Record `docs/05-quality/security/PR-0065-TASK-037-security-review.md` and D-SEC-PR65-01 pushed **on main** as `1d31ea8`. Head row is code head `29be7be` (pushed later with one evidence commit). Sim S1-S5 pass (S5 = branch merges main fcec9a9), C1-C6 fail. Code twin r2 `7cd23db` APPROVED_WITH_NITS (conditional on lane B).

**Sign-off given (COORD-03, PR11-SEC-10, PR26-SEC-03 closed subject to C1).** C1 = orchestrator checks the credited lane-B run on PG 18: migrations up/down/up, catalog incl. C3/C11/16 `[SEC-TC-74]` C15 cases, all 19 `organisations.int` blocks, rls committed layer unchanged.

**Findings:**
- **01 LOW (CWE-203):** `ux_membership_roles__membership_role_live (membership_id, role_id)` has no `org_id`. The unique check runs before the statement-end FK, so A gets 23505 vs 23503 for B's role holdings. This contradicts D-ARCH-154. Fix `(org_id, membership_id, role_id)` validated (mutant idx). Goes to this PR's next code cycle, else TASK-293 + C16 rule, before TASK-231.
- **02 LOW latent (CWE-269):** with a context of `OPERATOR_ORG_ID`, any actor self-inserts an ACTIVE membership + `OPERATOR_SUPER_ADMIN` and reads all tenants (1 → 4 orgs). The DB cannot tell this from provisioning (D-ARCH-156 makes all inserts self-inserts). Conditions on TASK-049/224 (context only after an ACTIVE-membership check, never from `last_active_org_id`), TASK-227 (role = the invitation's role); architect DB option before TASK-089.
- **INFO:** 03 oracle inventory (TASK-049 uniform registration answer, no auth for `is_system`); 04 INVITED via UPDATE, PARTNER org below the service, self-writable users status/email_verified_at, caller `granted_by` (TASK-231); 05 SEC-TC-76 (T1/T2/R1-m2), 77 (T3), 78 (T4-T8) to be tagged by TASK-293 + qa-lead `integration.required_cases` + catalog `min_tests` ratchet + PR43-SEC-07 remainder cases, before TASK-049 merges.

**Facts:**
- PG fires AFTER triggers by name, and `RI_ConstraintTrigger_*` sorts before `trg_*`, so FK errors precede AFTER assertion triggers.
- Unique-index errors precede both.
- The std guard does not check `created_at` on INSERT (RR-18).
- CI reads `required-suites.json` from the BASE ref (`check-evidence.mjs:760`), so a PR's own manifest move binds only later PRs.

**How to apply:**
- Delta round if an owned path changes after `29be7be`, or if C1 shows a changed observation.
- **TASK-293:** check the index fix, C16 unique-index rule and SEC-TC tags.
- **TASK-049/224/227/231/089:** check the 02/03/04 conditions.

**Kit** (session scratch `pr65sec/probes/`, may vanish):
- `sec1.mts <extract> [idx|wc|noguard]` P1-P9. `PROBE_MAIN` resolves PGlite from the main checkout. Map `RESET ROLE` to `SET ROLE platform_migrator`, or functions end up owned by postgres with PUBLIC EXECUTE (a harness artefact).
- `render.mts` (renderer containment + controls), `tz.mts`, `sim.mjs` (merge-ref sim incl. S5 branch-merges-main), `gl/gl-emul.mjs` (no built-in controls: add runtime PAT/AWS lines).

**Round 2 (delta @d4de55d, 2026-11-19, D-SEC-PR65-02, main fb766c1):** C1 failed on PG 18 (C15 (a) probe, C9, shadow F-02, own_read plant). Closed: 01 (index now leads with org_id; P1 all 23503). Accepted: D-TASK037-28 (C15 probe narrowed to planted tables; P10 replay + guard-drop mutant show the committed test holds the coverage), -29 (shadow-init keeps the 7 bootstrap schema USAGE/CREATE grants; shadow only, behind the PR12-SEC-07 ownership guard; grant option/GRANTED BY/ALL/ON ALL/REVOKE stripped; probe r2-shadow.mts needs a transform load hook because of constructor parameter properties), -30/-31/-32. Owned paths 28 (+shadow-init pair). Two Head rows in the record; R1 row void, R2 binds. Code twin r3 `1afa706` APPROVED_WITH_NITS. C1 now = the d4de55d run (adds shadow-init.int F-01/F-02/PR12-SEC-07, C9, 20 organisations.int blocks).

Related: [[project-p5-pr43-task024-rls-generator]], [[project-p5-pr47-rls-activation]], [[project-p5-pr26-standard-columns]], [[project-p5-pr11-rls-review]], [[project-security-review-conventions]]
