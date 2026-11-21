---
name: project-p5-task045
description: TASK-045 (HMAC cursors, keyset, INVALID_FILTER slot) r1 @b380f429, r2 @3168c194, r3 delta @c02dbf27 PASS_W_COND (main 5e8ceb01, D-SECPR045-03): C4 discharged; open C5/F2'/F6 (045-C), 06/09 TASK-073, 07 TASK-096, F5
metadata:
  type: project
---

**Round 1** (2026-11-21, `b380f429`, D-SECPR045-01, record `docs/05-quality/security/PR-pending-TASK-045-security-review.md`; rename to `PR-<NNNN>-…` when the PR exists). Findings 01 LOW filter 500s (NUL/int4/year 0000/negative years), 02 LOW = R1-M1 (RLS-invisible boundary ends list), 03 LOW binding (`q`, actorScope, credential), 04 LOW latent key budget, INFO 05 expiry cap, 06 id-only boundary subquery (non-RLS tables, TASK-073 card), 07 audit ceiling.

**Round 2** (2026-11-21, delta `b380f429..3168c194`, appended on main `658d9918`, D-SECPR045-02). Closed: 01 (classes found), 02, 03; 04/05 in code; 07 contract half. New: **08 LOW latent = code R2-m1** (integer default int4 vs `smallint` `Invitation.sendCount`: 32768 → 500 22003/P2020; routed to part 045-C, preferred fix = required min/max), **09 INFO = R2-n2 widened** (keys-path timestamp text outside `TIMESTAMP_TEXT`; TASK-073 rider).

**Round 3** (2026-11-21, delta `3168c194..c02dbf27`, two test files, appended on main `5e8ceb01`, unpushed, D-SECPR045-03). D-TASK045-15 concurred: explicit `undefined` took the default `ORG_A`, so the "anonymous" AT-US-037-07 call was signed in by the fixture stub and refused at authorise step 1 (401); fixed with a `null` sentinel. No new finding. C4 discharged by lane B `20261121T1414Z_c02dbf2` (evidence commit `77326dc5`). Still open: C5 + F2' + F6 (part 045-C), 06/09 (TASK-073 card), 07 module half (TASK-096), F5 (principal-architect, G3).

**Why:** the next trigger is a new owned-path head, a main merge that changes one of the branch's 18 files (merge-only round), or part 045-C's own round. Main merged #80-#84 during r3 with NO file overlap; such a merge needs no security round if the event base is the new merge base.

**How to apply (next round):** kit in session scratch `t045r3/probes/` (may vanish): `gl-emu.mjs` (gitleaks v8.30.1 emulation rebuilt from upstream `config/gitleaks.toml` fetched by curl into `t045r3/dl/`; 221/222 compile; mid-pattern `(?i)` rewritten per enclosing group; controls b34f954e:75 and dd7a2ddc:272/273), `r3-mutants.mjs` (replay, M1 undefined, gate probes G1/G2, M2 step 1 off), `r3-binding.sh` (13 scenarios incl. C8 stale base). Round-2 kit `t045r2/` is gone.

**Facts:**
- Record sim MUST pass `--head <PR head>` (ci.yml:610 uses `pull_request.head.sha`; `--root` = merge-ref tree). Passing the merge ref as `--head` only works while main is docs-only past the merge base; once main carries code it counts main's owned files (134 here). See [[project-security-review-conventions]].
- Checker diff semantics: `diff base...head` (three-dot), `rev-list base..head`, `changedSince = diff <bound> head`.
- The fixture `signedIn` stub in `pagination.api.test.ts` ignores `route.auth`; production `authenticate` reads only declared kinds (`presentedKinds`).
- PGlite 0.4.3: first query after another client disconnects fails P1017; retry with a new client. `@prisma/adapter-pg` 7.10.1 pads negative years without a sign (22007). Unmapped SQLSTATE → 500 `DB_ERROR`.
- Git Bash heredoc of a long markdown block failed (`unexpected EOF`); append records with the Edit tool instead. `mklink /J` needs `MSYS_NO_PATHCONV=1 cmd /c mklink /J`.

Related: [[project-p5-task041]], [[project-p5-pr56-task029]], [[project-p5-pr32-route-pipeline]], [[project-security-review-conventions]]
