---
name: project-p5-pr54-020d
description: PR #54 (TASK-020 020-D rawSystemTable, PR44-SEC-05 lexer twins + TenantDb guard) R1 @3efa2df 2026-11-15 PASS_WITH_CONDITIONS; PR54-SEC-01 five lexer-vs-PostgreSQL differentials (C1), -02 deny-list gaps incl. WITH HOLD cross-tenant (C2 = code R1-m3 "refuse"), -03 loaders; PG 18 + real Prisma probe kit; round-2 checklist
metadata:
  type: project
---

Record `docs/05-quality/security/PR-0054-TASK-020D-security-review.md`, written into worktree `Shipqube-TASK-020D` (uncommitted, LF). Head `3efa2df…` (code `f01e470`), merge base `3e2da8b`, 55 owned paths. Code twin on main `a1db134` = CHANGES_REQUESTED (R1-M1 CR comment + Unicode `\s`; R1-m1 dynamic `import('node:module')` members; R1-m2 corpus first-occurrence pins; R1-m3 WITH HOLD/advisory locks "at security-analyst's choice").

**Verdict PASS_WITH_CONDITIONS** (0 C/H/M). C1 = PR54-SEC-01 complete: (a) CR ends `--` (scan.l `non_newline [^\n\r]`), (b) PG space is only `[ \t\n\r\f\v]`, bytes >= 0x80 are identifier chars, (c) `E'..'` continued across a newline keeps E mode (`xqs` state), (d) twins join `' $1 '` but Prisma `Sql#text` renders `$1` with no spaces (dollar-quote parity flip), (e) literal-true setter admits `standard_conforming_strings=off`. C2 = PR54-SEC-02 (a) DECLARE/FETCH/MOVE/CLOSE + session advisory locks refused. LOW -03 (= R1-m1 widened: `Reflect.get(process,…)`, `process[name]`, `globalThis.process.binding`). INFO -04 (fragments lint-legal; corpus + start-api.ts unowned), -05 (D-TASK020-94: detector covers 4 keys across requests only), -06 (quadratic nested setter; continuation regex must be unambiguous).

**Facts (PG 18.6, real Prisma 7.10.1 + adapter-pg, head guard):** each differential committed a row the callback rolled back / left session `search_path` changed on the pooled backend / read a SYSTEM table lint-clean. `DECLARE … WITH HOLD` under org A, `FETCH` under org B returned A's row. Non-superuser `ALTER ROLE CURRENT_USER SET` admitted (lint `no-alter-role-sql` catches). `database_to_xml` reads every granted table with no identifier. pg simple protocol (no values) allows multi-statement through Prisma `$executeRaw`. Fix validated: patched lint twin corpus 73/73, 0 of 96 real raw templates change verdict; allow-list + one statement also 0 new refusals.

**Kit (session scratch `review/PR-54-sec/`):** `probes/twins.mjs`, `lintprobe.mjs` + `cases-lint*.mjs` (head vs base), `pgprobe.mjs`/`pgprobe2.mjs` + `runner.mjs` (mkdir docker.lock, pinned postgres:18 digest, random creds via env, frozen strings array with frozen `raw` passes `isTemplateStringsArray`), `hooks.mjs` (.js→.ts resolve for the generated client), `fixcheck*.mjs`, `hostscan.mjs`, `recscan.mjs`, `record-sim.mjs` (11 scenarios).

**How to apply (round 2):** re-run twins/lint/PG probes on the fix head with `3efa2df` as control; check template-level corpus cases, `rawSystemTable` CR fixture, PG integration cases for CR + continuation, the four mutants, C2 rows; unambiguous continuation regex (ReDoS). Fresh lane-B evidence with D-SEC-PR23-02 wording. Union: `eslint.config.mjs` / `negative-fixtures.test.ts` collide with other lint PRs.

Related: [[project-p5-pr44-r2]], [[project-p5-pr44-020c]], [[project-p5-pr42-r2]], [[project-p5-pr43-task024-rls-generator]], [[project-security-review-conventions]]
