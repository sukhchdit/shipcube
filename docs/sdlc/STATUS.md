# SDLC Status
- **Product:** the Platform (multi-carrier shipping platform, repo `sukhchdit/shipcube`)    **Updated:** 2026-11-12
- **Run scope:** M0 Foundation + M1 Customer MVP (brief §12). M2–M5 = backlog.
- **Current phase:** P5 Build — Wave 0 (Foundation)    **State:** IN_PROGRESS

## Phase / Task list
| # | Phase | Owner | State | Notes |
|---|---|---|---|---|
| P0 | Intake | orchestrator | ✅ DONE | BRIEF.md, operating params (D-002), Q-001..Q-004 answered |
| P1 | Requirements → G1 | product-manager | ✅ G1 PASS_WITH_CONDITIONS | 430 REQs, 90 NFRs, 290 stories (215 Must), D-008..D-034, A-005..A-077 (commit 9cb3205) |
| P2 | UX | ux-designer | ✅ DONE | 108/108 Must UI stories covered; F01–F10, W00–W17, tokens.json (validated), D-UX-001..029. 11 open items → P3 (README §5) |
| P3 | Architecture → G2 | principal-architect | ✅ G2 PASS_WITH_CONDITIONS | 27 ADRs, C4, data model (~90 tables), OpenAPI 3.1 (132 ops, lint 0 errors), threat model (119 threats), NFR strategy + G1-C4 design column. Pre-G2: ADR-0023 amend (D-ORCH-001), UX §5 items; PM applies D-ARCH-006 wording |
| P4 | Planning | senior-developer + qa-lead | ✅ DONE | 281 tasks / 10 waves / 76 batches (70 S / 211 M, 0 L); Must ≈ 600 dev-days; critical path 21 tasks. ★ v0.1.0-m0 after Wave 3; G3-ready after Wave 7; Waves 8 (Should) and 9 (Could) cuttable. TEST-STRATEGY + 65-suite manifest. traceability: 434 REQs Planned with tasks |
| P5 | Build (waves, M0 → M1) | senior-developer | ▶ WAVE 0 | `v0.1.0-m0` pre-release after M0 waves (D-006) |
| P6 | Verification → G3 | qa-lead + security-analyst + performance-engineer | ⏳ | |
| P7 | Release → G4 → execute | devops + technical-writer + release-manager | ⏳ | Tag + GH Release + GHCR (D-005) |

## Gates (decided by quality-gatekeeper)
| Gate | Verdict | Attempt | Date | Conditions open | Evidence |
|---|---|---|---|---|---|
| G1 Requirements | PASS_WITH_CONDITIONS | 1 | 2026-11-12 | G1-C1..C5 | docs/sdlc/gates/G1-attempt-1.md |
| G2 Architecture | PASS_WITH_CONDITIONS | 1 | 2026-11-12 | G2-C1..C5 | docs/sdlc/gates/G2-attempt-1.md |
| G3 Quality | – | | | | docs/sdlc/gates/G3-*.md |
| G4 Release | – | | | | docs/sdlc/gates/G4-*.md |

## Build Board
| Wave | Task | Agent (model) | Branch | Dev | Review | Security | Tests | Merged | Fix cycles | Escalation step |
|---|---|---|---|---|---|---|---|---|---|---|
| 0.1 | TASK-001 SPK-01 toolchain + workspace foundation (PR #1) | senior-developer (opus) | merged 8bf373c | ✅ | ✅ APPROVED r2 | ✅ PASS_WITH_FOLLOW-UPS r2 | ✅ 77/77 unit, lint, typecheck, build on main (orchestrator) | ✅ | 1 | – |
| 0.2 | TASK-002 lint/format/layering (PR #2) | senior-developer → specialist (sonnet→opus cont.) | merged 76164c3 | ✅ | ✅ APPROVED_WITH_NITS r2 | ✅ PASS_WITH_FOLLOW-UPS r2 | ✅ main a8a1d90 post-merge: ci, deps:rebuild, lint, fmt, tc, unit 172/172, build, clean tree (orchestrator) | ✅ | 1 | – |
| 0.2 | TASK-003 Prisma 7 + PG 18 baseline + engine pin D-ARCH-041 (PR #5) | senior-developer → database-engineer (opus) | merged 5964ccc | ✅ | ✅ APPROVED_WITH_NITS r3 | ✅ PASS_WITH_FOLLOW-UPS r3 | ✅ main 5964ccc post-merge (orchestrator): ci, deps:rebuild, lint, fmt, tc, unit 289/289, integration 28/28, build, audit, plan gen no drift, clean tree | ✅ | 1 | – |
| 0.2 | TASK-004 web + admin scaffolds (PR #4; Playwright+axe after cooldown 20:18Z) | senior-developer → frontend-developer (opus cont.) | feat/TASK-004-… @50b4831 (main merged) | 🟡 harness pending | r2 CHANGES_REQUESTED (only M1 harness; R2-m1/m2 lint) | PASS_WITH_FOLLOW-UPS r1 (R2 on harness) | 🟡 merge-main: lint (clean typegen), tc, unit 229 ✅; unit-dom/int/build/cov re-run pending (host reaped) | | 1 | harness + merge-main ▶ (cooldown clears 20:17:41Z) |
| 0.2 | TASK-005 packages/config + key register (PR #3) | senior-developer → backend-developer (sr-dev completed) | merged b1597fd | ✅ | ✅ APPROVED_WITH_NITS r4 | ✅ PASS_WITH_FOLLOW-UPS r3 | ✅ 3e390e0: unit 753, integration 28, cov 100/97.5, build (sr-dev + orchestrator re-run). main b1597fd code tree == 3e390e0 (git diff empty outside docs); orchestrator post-merge rerun reaped by host (low memory), not restarted | ✅ | 2 | – |
| 0.3 | TASK-008 SPK-03 RLS + Prisma 7 interactive tx — GO (PR #7) | senior-developer → database-engineer (opus) | merged a00340f | ✅ | ✅ APPROVED_WITH_NITS r2 | ✅ PASS_WITH_FOLLOW-UPS r2 | ✅ fc1: unit 753, integration 47 + 1 opt-in skipped, build, audit, clean (sr-dev) | ✅ | 1 | – |
| 0.3 | TASK-009 SPK-02 carrier API docs — UPS GO, FedEx/DHL FALLBACK (PR #6) | senior-developer → backend-developer (sonnet) | merged 501af73 | ✅ | ✅ APPROVED_WITH_NITS r2 | ✅ PASS_WITH_FOLLOW-UPS r2 | ✅ fc1 docs: lint, fmt, unit, build, clean (sr-dev) | ✅ | 1 | – |
| 0.4 | TASK-013 permission catalogue + 17 seeded roles (PR #8) | senior-developer → backend-developer (opus) | merged 4dc7122 | ✅ | ✅ APPROVED_WITH_NITS r2 | ✅ PASS_WITH_FOLLOW-UPS r2 | ✅ 6e70275: unit 859, integration 33, coverage 892 (authz 100/100), build, audit (sr-dev); main 4dc7122 code tree == gated head (D-ORCH-010) | ✅ | 1 | – |
| 0.3 | TASK-006 API + worker runtime skeleton (PR #9) | senior-developer → backend-developer | merged a4b4bb2 | ✅ | ✅ APPROVED_WITH_NITS r4 | ✅ PASS_WITH_FOLLOW-UPS r3c | ✅ lane A green on f27c99d; main code tree == f27c99d | ✅ | 2 | – |
| 0.3 | TASK-007 CI lane A + supply-chain hardening (PR #10) | senior-developer → devops-engineer (opus) | merged 8e62763 | ✅ | ✅ APPROVED_WITH_NITS r2 | ✅ PASS_WITH_FOLLOW-UPS r2 | ✅ lane A green on 26fc08d (run 43279941688); main code tree == 26fc08d | ✅ | 1 | – (lane A now live on main) |
| 0.5 | TASK-016 RLS foundations (PR #11; critical path) | senior-developer → database-engineer (opus) | feat/TASK-016-… @37a2109 (fc2 + merge + reconcile) | ✅ | r2 CHANGES_REQUESTED (R2-M1 requestTransaction escape) | r2 PASS_WITH_FOLLOW-UPS (a3e8edd; not merge auth — architect items open) | ✅ local: unit 2057, api 49, integration 154, cov 97.5/97.1, all lane-A checkers; lane A red: gitleaks (main literal via merge) + base-ref fixture harness defect | | 2 | r3 reviews ▶; CI harness fix PR ▶; then supersede branch (D-ORCH-018) |
| 0.4 | TASK-012 SPK-08 audit owner / DDL guard / signed anchors — GO (PR #12) | senior-developer → database-engineer (opus) | merged da9f312 | ✅ | ✅ APPROVED_WITH_NITS r2 | ✅ PASS_WITH_FOLLOW-UPS r1 (+ r2 security lens) | ✅ fc1: unit 1393, integration 79, build, audit; lane A run 43292614021 green (no record needed) | ✅ | 1 | – |
| 0.7 | TASK-023 reference + demo seed framework (PR #13; merges after #11; US-049 partial per D-061) | senior-developer → backend-developer | feat/TASK-023-… @e42e368 (fc1) | ✅ | ✅ APPROVED_WITH_NITS r2 (e42e368); superseding branch must carry R2-m1 (inserted>0 drift) + R2-n1 | r1 PASS_WITH_FOLLOW-UPS (4 LOW) | ✅ fc1 local gates; lane A fast-lane green, scans red (gitleaks synthetic literal in e6ccf60 → supersede branch D-ORCH-017) | | 1 | r2 reviews ▶; supersede + reconcile after #11 |

## Escalations in progress
- **Gitleaks contamination watch (PR13-SEC-11):** main commits 63accea..7f8ec4f quoted a synthetic secret-shaped literal (scrubbed in 2e29004). In-flight branches TASK-016 (PR #11) and TASK-004 (PR #4) merged main locally while it contained it (unpushed at 20:3xZ). If their lane A gitleaks goes red on push, supersede each with a fresh branch from main carrying the final reviewed tree (D-ORCH-017 pattern), then a supersede security round naming the new head.
_none_ (batch 0.2: 80-turn stops on TASK-002/004/005 resumed via opus continuation / sr-dev completion — not fix cycles)

## Defaults applied / optional questions outstanding
- Q-006 Node 24 via fnm (installed v24.22.3; per-command PATH prefix since the profile change was blocked by the safety classifier) — D-ORCH-002.
- Q-007 CI = hosted fast lane + local heavy suites — D-ORCH-001.
- Q-001..Q-004 answered by the human (all recommended defaults). See QUESTIONS.md.
- Brief §14 defaults adopted (D-007).

## Tracked conditions
| ID | Condition | Due | Owner | State |
|---|---|---|---|---|
| G1-C1 | Reconcile 5 contradictory defaults REQUIREMENTS vs NFR (rate limits, compose 180 s, home JS budget, DR-A22) | before G2 | product-manager | CLOSED (D-035; verify at G2) |
| G1-C2 | Milestone/MoSCoW tag fixes (REQ-UI-014, AUTH-020, UI-018, PICK-013/US-239), regen stats | before G2 | product-manager | CLOSED (D-036; verify at G2) |
| G1-C3 | Assumption/GAP hygiene, permission markers, NFR-MAINT-002 table fix | before G2 | product-manager | CLOSED (verify at G2) |
| G1-C4 | NFR traceability: Design column (architect) before G2; Test column (qa-lead) before P5 | G2 / P5 | principal-architect, qa-lead | CLOSED into G2-C1 (NFR-RES-007 row) and G2-C5 (Test column) |
| G1-C5 | Demo-critical Must tagging per epic (PM) before G2; wave plan by it (P4) | G2 / P4 | product-manager, senior-developer | PM tag DONE; wave plan → P4 (senior-developer) |
| G2-C1 | NFR-RES-007 row in nfr-traceability/nfr-strategy (91 NFRs) | P4 exit | principal-architect | CLOSED (91 NFRs) |
| G2-C2 | traceability.md Design column for 434 REQs; ARCHITECTURE §6 adds AUTH-025/026, CARR-022/023; Valkey labels; close R-ARCH-10 | P4 exit | principal-architect | CLOSED (434/434 Design; Valkey labels; R-ARCH-10 closed) |
| G2-C3 | SEC-COND-05 (audit fn search_path), 06 (cvc_check=pass), 07 (unverified=anonymous, quote-create class, org quota share); SEC-P3-30/33 drift; security-analyst records closure; SEC-COND-03 item 7 → G4-production checklist | P4 exit (design) · G3 (tests) | principal-architect, product-manager, security-analyst | CLOSED at design level (review §16, D-ORCH-005); SEC-TC evidence due G3; SEC-P3-34..37 routed to TASK-003/016/021/034/085/190 |
| G2-C4 | UX README reconcile v1.3 (US-027 Must screens, US-291..293, 218 count, admin idle dialog, CVC note) | P4 exit | ux-designer | CLOSED (README v1.1: 218 Must = 110 UI + 108 non-UI, 100%; D-UX-030..036). Follow-ups: UX §5 #12–14 → architect/api-designer |
| G2-C5 | NFR Test column (91) incl. SEC-TC-01..64 | before P5 | qa-lead | CLOSED (91/91 Test cells; TEST-STRATEGY.md, required-suites.json 65 suites, SEC-TC-01..64, e2e journeys, gherkin-test-map 1,599 Must scenarios) |
| COND-G4-PROD | Locked audit-anchor sink, RDS master break-glass only, pgaudit (SEC-COND-03 item 7); SPK-08 RDS C13(b) parity; SEC-P3-34 master search_path pin + break-glass runbook; KMS envelope, TLS, WAF (RR-03); PR12-SEC-04 RDS residual (master SET ROLE to audit owner undetected by event triggers; pgaudit MISC_SET + filter fix); SPK-08 §6.1 d/f/g/h (event-trigger drop/re-create around major upgrades; session_replication_role / event_triggers / pgaudit.log SET checks), §6.4 rds.allowed_extensions, §6.2 a–d, §6.3 | G4 for any production release (not this run) | platform-architect, release-manager | OPEN (n/a this run: no prod target) |
| SEC-FU-36 | Per-user carrier quota share (SEC-P3-36) | before TASK-190 | principal-architect, product-manager | OPEN |
| SEC-FU-QA | SEC-TC-65 adopt, SEC-TC-62 multi-org, SEC-TC-53 text | before Wave 4 | qa-lead | OPEN |
| SEC-FU-PR1 | security-analyst confirms D-ARCH-003 rev 4 (licence/deprecation registers) and D-ARCH-041 (Prisma engine pin) in the TASK-003/TASK-007 reviews; senior-developer folds ADR-0023 am. J into the TASK-003/004/007/014/049/214 sheets + corrects SPK-01 §1 | batch 0.2/0.3 | security-analyst, senior-developer | TASK-003 part DONE (PR-0005: D-ARCH-041 CONFIRMED; D-ARCH-003 rev 4 policy CONFIRMED); TASK-007 implementation part OPEN |
| BCRYPT-EXC | bcrypt 6.0.0 maintenance exception expires 2027-05-11 (D-ARCH-042); monthly review | 2027-05-11 | principal-architect, performance-engineer | OPEN |
| FU-TASK001 | Tracked follow-ups from PR #1: m4/n1/n2/n3/n5/R2-n1 → TASK-002; m6 + PR1-SEC-02 + R2-n5 → TASK-003; m8 + PR1-SEC-03 → TASK-004; PR1-SEC-12/13 + R2-n4 + PR1-SEC-05/06 → TASK-007; m9 + PR1-SEC-04 → TASK-014; R2-m1/R2-n2 + per-path 95% → TASK-015; m5 → ADR-0003 wording | per task | senior-developer | OPEN (TASK-002 part in fix cycle 1; TASK-003 m6/PR1-SEC-02/R2-n5 CLOSED in PR #5; m4 SPK-01 §2.5 recorded D-ARCH-051) |
| ROUTED-0.2 | Batch 0.2 review items routed to later task sheets (fold into plan-data.mjs at Wave 0 batch end): TASK-002 m7→TASK-015, m8→TASK-006, m9(b)→carriers adapter task, m10→TASK-076, n5→TASK-016; PR2-SEC-01 (suppression counter, Semgrep bcrypt/createRequire, CODEOWNERS)+PR5-SEC-04+gitignore anchoring→TASK-007; PR2-SEC-03 TS-only block/`--allow-empty-input` removal→TASK-004; PR2-SEC-04→TASK-112/113; PR2-SEC-05→TASK-016; password-hasher-only→TASK-049; PR4 m2→TASK-042, m5→TASK-022, m6→first lazy-route task; PR4-SEC-02→TASK-014/111; PR3 m5/PR3-SEC-06→TASK-006/014, m6→crypto consumer tasks; PR5-SEC-07/08→TASK-006, PR5-SEC-09→TASK-016, PR5-SEC-10→qa-lead; ADR-0002 §6 stylelint wording (n4) DONE D-ARCH-055; packages/shared Axios DONE D-ARCH-056; PR #3 r3: PR3-SEC-16 (provider error code getter)→TASK-006, PGOPTIONS/PG* env preflight→TASK-014, code R3-n1..n4 + R4-n1 (BRAND_NAME control/bidi chars, import allow-list, rule id in differential)→TASK-022, ADR-0018 §3 APP_ENV wording + ECS second signal→architect; PR #5 r3: R3-n1 prisma/tests import policy→TASK-016, R3-n2/PR5-SEC-14 reset URL typing→TASK-034 | Wave 0 exit | senior-developer, principal-architect | OPEN |
| ROUTED-W0-B3 | Wave 0 batch-3 review items routed (fold into sheets/ADR before the owning task starts): PR #8 r2: R2-m1 mid-segment verb treated as read (guard allow-list of middle segments + P3/P3b tests) → TASK-020; R2-n1 narrow Auditor audit:* → architect/ADR-0008; R2-n2 assigner-subset property test → TASK-231/235; R2-n3 migration-immutability check vs origin/main → TASK-016/TASK-007. PR #7 r2: R2-m1 ADR-0005 am.10 item 4 + TASK-016 sheet reword ("proves session-level value leaks"; token ban + prosrc scan + fresh-connection probe), R2-n1 "existing lint rule" wording, R2-n2 W-1/item 12/13 + data-model §4.1 settings list → architect BEFORE TASK-016 dispatch; R2-m2 TASK-016 C-1 line sets SPK03_BENCH=1 + due before G3 + server-side p95 ≤ 1 ms → plan-data. PR #6 r2: R2-n1 README heading "PII and redaction" + UPS spec SHA → TASK-191 (or TASK-135/139/140); R2-n2 UPS format-code length quirk → TASK-140/R-ARCH-25; R2-n3 egress prefix segment boundaries → TASK-113; R2-n4 DHL README post-decision wording + create-timeout-then-tracking-reconcile fixture → TASK-135; R2-n5/n6 FedEx wording → TASK-139; R2.4 ADR-0010 am.11 npm dates → architect; PR6-SEC-11 per-carrier on403 policy (UPS 403 = per-account negative cache, FedEx carrier-wide cool-down) → architect ADR-0010 am.11 item 5(c) + PM REQ-CARR-016 + TASK-131/132/140 + SEC-TC-68 UPS case; PR6-SEC-02 residual party-object redaction (DHL receiverId/mobilePhone/customerReferences, UPS Fax/Phone/InternationalForms.Contacts, FedEx child_id) → TASK-135/139/140/188; PR6-SEC-12 → TASK-113/214/131 ; PR #7 sec r2: PR7-SEC-11 prosrc scan incl. platform schema, PR7-SEC-12 (a)-(f) ADR-0005/data-model §4.3/§4.5 text, PR7-SEC-13 1-row-affected checks, PR7-SEC-14 prior-value probe → architect + TASK-016; TASK-006 (in flight, gap): PR7-SEC-03 items 2/4 (no DB message echo; errorFormat minimal) + PR7-SEC-06 item 3 (pg_db_role_setting drift readiness) — check at TASK-006 review; TASK-010: Prisma-error log serializer; TASK-024: C12 guest-row probes; PR #8 sec r2: PR8-SEC-13 migration immutability (base-ref A-only check on prisma/migrations) + CODEOWNERS packages/authz, tools/authz, prisma/migrations → TASK-007 (fallback TASK-016), due before first catalogue v2 / M5; PR8-SEC-06 consumer conditions → TASK-231/235; PR8-SEC-05 → TASK-020 merge condition, -07 → TASK-060, -10 → TASK-016/028 (copy into sheets); PR8-SEC-14 → TASK-016 | before owning task | principal-architect, senior-developer | FOLDED into ADR-0005 am.10 / ADR-0008 am.3 / ADR-0010 am.11 + task sheets (D-ARCH-063..070); in-flight TASK-006/007 items checked at their reviews (rulings Part 2 §4) |
| SHEET-FOLD-1 | Pending plan-data.mjs folds for the next architect batch: D-061 US-049 split (blocks seedfw TASK-023 part, compose TASK-014 AT-02 + bootstrap pg error listener, seeddemo TASK-089 AT-05/09/10 + PR13-SEC-02, slice TASK-026 evidence line — exact text in D-061 handoff); PR13-SEC-04 grant decision (reference_dataset_versions platform_app SELECT-only?) before TASK-221; SPK-08 F-01/F-02 data-model §7.3 before TASK-021,  TASK-021 port-then-delete of SPK-08 spike files (PR #12 review M3); PR12-SEC-02 MEDIUM partition-name squatting → architect/data-architect amend data-model §5.2/§5.3 + readiness rule BEFORE TASK-021, TASK-021 implements, TASK-033 tests; PR12-SEC-01 escalation-primitive tests → TASK-033 + qa-lead SEC-TC-61; PR12-SEC-03 plain CREATE guard + C14 converse → TASK-021; PR12-SEC-05 incremental verifier/A-1/A-6/SEC-TC-44 → TASK-116 + architect; F-01 lane-reorder option REJECTED by security; SPK-08 §8.1 port-then-delete DoD lines on TASK-021 (audit-owner files) and TASK-116 (anchor files); SPK-08 F-11 partial-index rule → architect §7.3 + TASK-016/linter (PR #12 r2 R2-m1: a re-create after DROP must carry the WHERE predicate, mirror F-04 INCLUDE rule); A-2/A-3/A-4 before TASK-116 (not TASK-033); PR9-SEC-15 npm_execpath trust in tools/deps/npm-cli.mjs + script-shell residual → TASK-014; PR9-SEC-17 sslrootcert bounded read → TASK-014; PR9 R3-m1 config/runtime DATABASE_URL value agreement (exit 78) → TASK-014; PR10-SEC-21 record check takes head SHAs only from the last-Verdict table → TASK-015; PR10-SEC-16/17/18..20 + code R2-m1..m4 → TASK-015 | before TASK-014/021/033/089/221 dispatch | principal-architect | OPEN |
| COND-SANDBOX-DEMO | Real sandbox label from DHL, FedEx and UPS booked and paid end to end (M1 exit demo); needs creds outside the repo | Post-release, when creds supplied | qa-lead | OPEN (blocked on external creds, by design) |

## Top Risks
1. **Scope size.** M0+M1 is very large for one run. Mitigation: strict Must/Should prioritisation in P1, small waves, escalation-ladder re-scoping.
2. **Carrier API drift.** No live sandbox access. Mitigation: verify docs at implementation time, contract suite, opt-in live runs.
3. **Windows host.** Tooling must be cross-platform (Node scripts, no bash-only, LF endings enforced).
4. **Testcontainers on Docker Desktop.** Integration tests depend on Docker availability in CI and locally.
5. **Host memory pressure.** ~4 GB free; Claude Code reaped 3 background gate runs. Mitigation: one heavy command at a time host-wide, ≤ 3 concurrent build agents, post-merge verification by tree-equality with the gated PR head when a rerun is reaped (D-ORCH-010).

## Wave plan (docs/04-plan/PLAN.md)
| Wave | Goal | Tasks | Batches | State |
|---|---|---|---|---|
| 0 | Foundation: skeleton, CI lanes, generators, SPK-01..08 | 37 | 10 | ▶ IN_PROGRESS |
| 1 | M0 DC I | 40 | 10 | ⏳ |
| 2 | M0 DC II | 22 | 6 | ⏳ |
| 3 | M0 non-DC Must → ★ v0.1.0-m0 | 28 | 7 | ⏳ |
| 4 | M1 DC I | 24 | 7 | ⏳ |
| 5 | M1 DC II | 20 | 6 | ⏳ |
| 6 | M1 DC III | 20 | 6 | ⏳ |
| 7 | M1 non-DC Must + NFR → G3-ready | 33 | 9 | ⏳ |
| 8 | Should (cuttable, ladder rung 2) | 50 | 13 | ⏳ |
| 9 | Could (cuttable, ladder rung 1) | 7 | 2 | ⏳ |

## Next Actions
- senior-developer: Wave 0, batch by batch (reconcile Wave 0 with D-ARCH-029..034 design deltas first).
- security-analyst: verify review §15 (G2-C3 design closure), extend SEC-TC-61.
- Cut-list decision points: rung 1 (Could) at the M0 checkpoint; rung 2 tier A after Wave 4 if the projected Wave 7 exit is beyond budget (D-ORCH-003).
- Re-estimate CI minutes after SPK-07 (end of Wave 0).
