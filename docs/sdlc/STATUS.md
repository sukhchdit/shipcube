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
| 0.1 | TASK-001 SPK-01 toolchain + workspace foundation | backend-developer (opus) | feat/TASK-001-* | ▶ | | | | | 0 | |

## Escalations in progress
_none_

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
| G2-C3 | SEC-COND-05 (audit fn search_path), 06 (cvc_check=pass), 07 (unverified=anonymous, quote-create class, org quota share); SEC-P3-30/33 drift; security-analyst records closure; SEC-COND-03 item 7 → G4-production checklist | P4 exit (design) · G3 (tests) | principal-architect, product-manager, security-analyst | Design CLOSED by architect + PM (D-ARCH-029..034, D-053..D-057, review §15); security-analyst verification running; SEC-TC evidence at G3 |
| G2-C4 | UX README reconcile v1.3 (US-027 Must screens, US-291..293, 218 count, admin idle dialog, CVC note) | P4 exit | ux-designer | CLOSED (README v1.1: 218 Must = 110 UI + 108 non-UI, 100%; D-UX-030..036). Follow-ups: UX §5 #12–14 → architect/api-designer |
| G2-C5 | NFR Test column (91) incl. SEC-TC-01..64 | before P5 | qa-lead | CLOSED (91/91 Test cells; TEST-STRATEGY.md, required-suites.json 65 suites, SEC-TC-01..64, e2e journeys, gherkin-test-map 1,599 Must scenarios) |
| COND-G4-PROD | Locked audit-anchor sink, RDS master break-glass only, pgaudit (SEC-COND-03 item 7) | G4 for any production release (not this run) | platform-architect, release-manager | OPEN (n/a this run: no prod target) |
| COND-SANDBOX-DEMO | Real sandbox label from DHL, FedEx and UPS booked and paid end to end (M1 exit demo); needs creds outside the repo | Post-release, when creds supplied | qa-lead | OPEN (blocked on external creds, by design) |

## Top Risks
1. **Scope size.** M0+M1 is very large for one run. Mitigation: strict Must/Should prioritisation in P1, small waves, escalation-ladder re-scoping.
2. **Carrier API drift.** No live sandbox access. Mitigation: verify docs at implementation time, contract suite, opt-in live runs.
3. **Windows host.** Tooling must be cross-platform (Node scripts, no bash-only, LF endings enforced).
4. **Testcontainers on Docker Desktop.** Integration tests depend on Docker availability in CI and locally.

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
