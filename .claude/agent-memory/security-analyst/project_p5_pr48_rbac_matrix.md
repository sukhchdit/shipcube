---
name: project-p5-pr48-rbac-matrix
description: PR #48 (TASK-027 RBAC matrix generator) R1 @a4f2d51 2026-11-15 PASS_WITH_FOLLOW-UPS; LOW 01 foreign-cred compare, 02 CODEOWNERS rbac+doc, 03 oracle export, 04 stub-era 401 getQuote; INFO 05-08; T-32 owner TASK-060; independent-oracle + runner probe kit
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0048-TASK-027-security-review.md` in worktree `Shipqube-TASK-027` (uncommitted, LF). R1 head `a4f2d51ddf0c8ddfa83997b53d7adb73d8a637c0`, merge base `5d2c102`, 11 owned paths. Code twin on main `e1768ea` (APPROVED_WITH_NITS; R1-m1 no negative control for foreign/Cache-Control checks, R1-m2 dead authorise branches, R1-m3 seam retirement, R1-n1 whole-segment `{orgId}` only, R1-n2 admin cookie, R1-n3 SEC-TC-01 no positive control). Its runner.ts/org-scope.ts line numbers are off (multi-file dump); mine are single-file.

**Findings (proposed D-SEC-PR48-01):**
- 01 LOW: `cellProblems` foreign check = status/code/Cache-Control only; real signature headers never sent as foreign. Probe: Set-Cookie, WWW-Authenticate, body field, stripe-signature-401 wrappers all 0 problems; status-change control named. Due before TASK-052/055.
- 02 LOW: CODEOWNERS + REQUIRED_CODEOWNED_PATHS for `/tests/generated/rbac/` and `/docs/03-architecture/generated/rbac-route-matrix.md` (openapi.yaml unowned -> the doc is the owned tripwire for authz metadata). This PR or the activation PR.
- 03 LOW: generator exported from `@platform/authz` root; production import lint-clean (probe). Subpath `@platform/authz/matrix` + restricted pattern; before TASK-060.
- 04 LOW: `[session, quote-token]` none/foreign/unknown-token = 401 in matrix; ADR-0008 am.5 item 1 + A-078 say 404 / guest principal (8 cells). TASK-091.
- 05 INFO SEC-TC-01 design (route reached, AC-06 dual membership, name/shape) + **T-32 owner proposed TASK-060** (batch 1.7 precedes wave-8 {orgId} routes). 06 INFO seams (= R1-m3) + live resolution + TASK-041 limiter seam test-only. 07 INFO header scan raw values only -> compare with never-seeded-id 404. 08 INFO no ROUTE_AUTHS column-coverage check.

**Why:** the matrix is an O3 oracle (G3); open items land in TASK-052/055/060/091/041 and the activation PR.

**How to apply:**
- Union trigger: main `3f58935` (PR #39) changed `package.json` -> any main merge into #48 voids R1 (sim S7); merge-tree clean = main + `authz:matrix` line. Dependabot #51 also touches package.json.
- Activation PR review: check the two CODEOWNERS lines + REQUIRED_CODEOWNED_PATHS, `min_tests` from its own run (PR says 21), `required_cases ["SEC-TC-01"]` OK (D-SEC-PR47-01 (1)).
- TASK-060 review: T-32 gate compares `params.orgId` with `principal.orgId` only; R-03 build rule; PR48-SEC-03 fix. TASK-091: generator `deny-404` change.
- Probe kit (session scratch `review/PR-48-sec/`): `oracle.mjs` (reads openapi.yaml directly, `security: []` = anonymous; stub/adr modes; 4,389/4,389 agree), `runner-probe.mjs` (real createApp + PR runner via `hooks.mjs` strip-types/@platform map; needs ALL `packages/` in the extract + node_modules junction), `lintprobe.mjs` (lintText; controls must use files that exist on main), `hostscan.mjs`, `sim/record-sim.mjs` (Node plumbing sim, S0-S7), `gl/` emulator copy.

Related: [[project-p5-pr43-task024-rls-generator]], [[project-p5-pr47-rls-activation]], [[project-p5-pr8-authz-review]], [[project-p5-pr32-route-pipeline]], [[project-security-review-conventions]]
