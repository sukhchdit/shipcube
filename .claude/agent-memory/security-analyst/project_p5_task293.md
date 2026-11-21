---
name: project-p5-task293
description: TASK-293 (lexfu, TASK-290-F, pre-push) security r1 @85afc70 (9aad85c) + r2 @c618d8a final head (b0f5396) PASS_W_COND; PR66-SEC-01/02, PR293-SEC-01/02, PR65-SEC-05 (a)(b)(d) closed; R3-M1 regression confirmed+closed; open INFO 03 C16 scope, 04 body-reader residuals; kit
metadata:
  type: project
---

Round 1, 2026-11-19, pre-push. Started on `3183525`; the coordinator moved the head to `85afc70` (code review r1 fixes: RoutineRegistry, linear `;`-segment body scan, registry rows "Adopted cases SEC-TC-76..78" in `security-test-cases.md`, test-ids pin 67). The record `docs/05-quality/security/PR-pending-TASK-293-security-review.md` and D-SECPR293-01 were pushed on main as `9aad85c`. Head row is `85afc70`; 12 owned paths; sim 14/14 against main `8b0ac3d`. Code twin r1 `4e05347` + r2 `942d8d9`, both APPROVED_WITH_NITS.

**Closed:** PR66-SEC-01 (all (a)(b)(c) shapes through the real linter, 18/18; shadow CR route refused; corpus 534/534 LF identical), PR66-SEC-02 as filed, PR65-SEC-05 (a)(b) (min_tests 113 = 106 + 7), C16 = PR65-SEC-01 intent (token_hash exception justified; PK exemption backed by the standard-columns PK = (id) check).

**PR293-SEC-01 LOW (CWE-693/184):** rule 10 still misses, all PGlite-executed:
- call-site: `SET SCHEMA`, routine `FOR … IN <DML> RETURNING`, attribute notation `t.f`, `CREATE CAST`, `CREATE AGGREGATE`, non-ASCII routine names (twin R2-n1);
- DO bodies: `FOR … IN` / `OPEN … FOR` DML (pre-existing), a `;` inside a string before the DML (pre-existing), unqualified `UPDATE "x;y"` (regression of the `;` split: main sees it).
- Stated limits now: `RENAME TO`, trigger fired by `INSERT … VALUES`.
- Candidate on 85afc70: add `in|open <c> [no] [scroll] for` to both `bodyDataChanging(...)` start lists; ALTER RENAME/SET SCHEMA = `registry.define(new, false, [old])`. Closes 7/11, 81 fixtures identical, linear.
- Due: in-PR preferred, else before the first migration with a data-changing routine or DO FOR-IN/OPEN-FOR, at latest G3; interim hand check.

**SEC-02 INFO:** E'..' + newline + '..' continuation keeps escapes in PG (scan.l quotecontinue → xe); hides a definer routine from rule 13 in an approved bootstrap file. Migrations lane refuses E-strings (rule 16). Fix: linear `continuesString` refusal (record §3; a regex version backtracks exponentially).

**SEC-03 INFO:** GUEST_CAPABLE unique keys → R-ARCH-34 ruling before TASK-051; a T2 pair gives 23503 with different constraint names (foreign vs unknown) → error mapper must merge; EXCLUDE (indisexclusion) now a stated limit.

**Routed:** PR65-SEC-05 (d) PR43-SEC-07 remainder → this PR's fix cycle or test-engineer, before TASK-049; data-model §8.3/§4.6 → architect; TEST-STRATEGY G3 64→67 → qa-lead.

**Facts:** PL/pgSQL FOR-IN and OPEN-FOR accept DML RETURNING (PGlite confirmed). The registry design compares parsed identifiers; an unqualified def/call matches any schema. Lane B on 3183525 reportedly passed all TASK-293 checks (files not on main).

**Kit** (session scratch `sec293/probes/`): `hooks.mjs` (.js→.ts + transform strip), `p1.mjs` lexer shapes, `p2*.mjs` call-site shapes (base/head/h2), `p4pg*.mjs` PGlite execution, `p9semi.mjs`, `mkfix2.mjs` + `p6fix2.mjs` candidate validation, `fuzz-body2/3.mjs` old-vs-new body matcher (xorshift; 300k), `p10scale.mjs`, `corpus*.mjs`, `sim293.mjs`, `gl-over.mjs`, `hostscan.mjs`.

**How to apply:** delta round on any owned-path change after `85afc70` (sim C5-C7): rerun p2/p9 rows + controls, fixtures, scaling, sim. At the SEC-01 fix, also check the `other.fixture_purge()` control decision and the CAST/AGGREGATE rule-14 choice.

**Round 2 (2026-11-19, @c618d8a, D-SECPR293-02, main b0f5396):** fc2 06270ba closed 8/11 SEC-01 rows (starts `in`/`open … for`, code-`;` segments with dynamic reads, RENAME/SET SCHEMA aliasing, non-ASCII names, unparseable writer names reported), rows 3-5 stated + pinned (D-TASK293-10), E-continuation refused (rule L). fc2 broke rule 16: `sqlText` dollar fallback and `scans.ts bodyText` dropped ESCAPE_STRING_MARK on EscapeContinuationError (code review R3-M1; my SEC-02 sketch had named only tokenize). fc3 c618d8a keeps the mark; nested shapes (EXECUTE $q$/string/nested DO) refused. New PR293-SEC-04 INFO: unlexable-body fallback lacks a `;` start; prose `in update mode` FP. 15 owned paths; sim 15/15 (C10 round-1 record alone). Kit adds `p14b.mjs` (rule 16 + each head`s real scanFunctionBodies), `p16nest.mjs`, `p12h4.mjs`, `p15lanes.mjs`, `fuzz-h4b.mjs` (classifies misses), `sim293r2.mjs` (last-Head swap + R1_RECORD).

Related: [[project-p5-pr66-task290]], [[project-p5-pr65-task037]], [[project-p5-pr43-task024-rls-generator]], [[project-p5-task291]], [[project-security-review-conventions]]
