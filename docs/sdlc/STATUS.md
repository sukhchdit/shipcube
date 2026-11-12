# SDLC Status
- **Product:** the Platform (multi-carrier shipping platform, repo `sukhchdit/shipcube`)    **Updated:** 2026-11-12
- **Run scope:** M0 Foundation + M1 Customer MVP (brief §12). M2–M5 = backlog.
- **Current phase:** P2 UX + P3 Architecture (parallel)    **State:** IN_PROGRESS

## Phase / Task list
| # | Phase | Owner | State | Notes |
|---|---|---|---|---|
| P0 | Intake | orchestrator | ✅ DONE | BRIEF.md, operating params (D-002), Q-001..Q-004 answered |
| P1 | Requirements → G1 | product-manager | ✅ G1 PASS_WITH_CONDITIONS | 430 REQs, 90 NFRs, 290 stories (215 Must), D-008..D-034, A-005..A-077 (commit 9cb3205) |
| P2 | UX | ux-designer | ✅ DONE | 108/108 Must UI stories covered; F01–F10, W00–W17, tokens.json (validated), D-UX-001..029. 11 open items → P3 (README §5) |
| P3 | Architecture → G2 | principal-architect | ▶ PRE-G2 FIXES | 27 ADRs, C4, data model (~90 tables), OpenAPI 3.1 (132 ops, lint 0 errors), threat model (119 threats), NFR strategy + G1-C4 design column. Pre-G2: ADR-0023 amend (D-ORCH-001), UX §5 items; PM applies D-ARCH-006 wording |
| P4 | Planning | senior-developer + qa-lead | ⏳ | |
| P5 | Build (waves, M0 → M1) | senior-developer | ⏳ | `v0.1.0-m0` pre-release after M0 waves (D-006) |
| P6 | Verification → G3 | qa-lead + security-analyst + performance-engineer | ⏳ | |
| P7 | Release → G4 → execute | devops + technical-writer + release-manager | ⏳ | Tag + GH Release + GHCR (D-005) |

## Gates (decided by quality-gatekeeper)
| Gate | Verdict | Attempt | Date | Conditions open | Evidence |
|---|---|---|---|---|---|
| G1 Requirements | PASS_WITH_CONDITIONS | 1 | 2026-11-12 | G1-C1..C5 | docs/sdlc/gates/G1-attempt-1.md |
| G2 Architecture | – | | | | docs/sdlc/gates/G2-*.md |
| G3 Quality | – | | | | docs/sdlc/gates/G3-*.md |
| G4 Release | – | | | | docs/sdlc/gates/G4-*.md |

## Build Board
| Wave | Task | Agent (model) | Branch | Dev | Review | Security | Tests | Merged | Fix cycles | Escalation step |
|---|---|---|---|---|---|---|---|---|---|---|

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
| G1-C4 | NFR traceability: Design column (architect) before G2; Test column (qa-lead) before P5 | G2 / P5 | principal-architect, qa-lead | Design column DONE (nfr-traceability.md); Test column → qa-lead P4 |
| G1-C5 | Demo-critical Must tagging per epic (PM) before G2; wave plan by it (P4) | G2 / P4 | product-manager, senior-developer | PM tag DONE (DC=134: M0 74, M1 60; ladder PRD §7.1, D-037); wave plan pending P4 |
| COND-SANDBOX-DEMO | Real sandbox label from DHL, FedEx and UPS booked and paid end to end (M1 exit demo); needs creds outside the repo | Post-release, when creds supplied | qa-lead | OPEN (blocked on external creds, by design) |

## Top Risks
1. **Scope size.** M0+M1 is very large for one run. Mitigation: strict Must/Should prioritisation in P1, small waves, escalation-ladder re-scoping.
2. **Carrier API drift.** No live sandbox access. Mitigation: verify docs at implementation time, contract suite, opt-in live runs.
3. **Windows host.** Tooling must be cross-platform (Node scripts, no bash-only, LF endings enforced).
4. **Testcontainers on Docker Desktop.** Integration tests depend on Docker availability in CI and locally.

## Next Actions
- P3 security review (security-analyst): APPROVED_WITH_CONDITIONS, 0 Critical / 4 High (SEC-P3-01 session/step-up, 02 carrier bulkhead flood, 03 audit tamper evidence, 04 npm lifecycle scripts) + Mediums. Report: docs/05-quality/security/P3-architecture-security-review.md (commit 8fcb8be).
- principal-architect (+ specialists): remediating SEC-P3-01..04 and 07/08/10/11/12/13/14 in the ADRs, data model, OpenAPI and platform (running).
- product-manager: requirement side (supersede D-038, REQ-AUTH-020 → Must, budgets, RR-16, invoice_print) (running).
- Then quality-gatekeeper G2 attempt 1.
