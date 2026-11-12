# SDLC Status
- **Product:** the Platform (multi-carrier shipping platform, repo `sukhchdit/shipcube`)    **Updated:** 2026-11-12
- **Run scope:** M0 Foundation + M1 Customer MVP (brief §12). M2–M5 = backlog.
- **Current phase:** P2 UX + P3 Architecture (parallel)    **State:** IN_PROGRESS

## Phase / Task list
| # | Phase | Owner | State | Notes |
|---|---|---|---|---|
| P0 | Intake | orchestrator | ✅ DONE | BRIEF.md, operating params (D-002), Q-001..Q-004 answered |
| P1 | Requirements → G1 | product-manager | ✅ G1 PASS_WITH_CONDITIONS | 430 REQs, 90 NFRs, 290 stories (215 Must), D-008..D-034, A-005..A-077 (commit 9cb3205) |
| P2 | UX | ux-designer | ▶ IN_PROGRESS | UI present (web + admin) |
| P3 | Architecture → G2 | principal-architect | ▶ IN_PROGRESS | Stack fixed (ADR-0001 documents, does not re-select) |
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
- Q-001..Q-004 answered by the human (all recommended defaults). See QUESTIONS.md.
- Brief §14 defaults adopted (D-007).

## Tracked conditions
| ID | Condition | Due | Owner | State |
|---|---|---|---|---|
| G1-C1 | Reconcile 5 contradictory defaults REQUIREMENTS vs NFR (rate limits, compose 180 s, home JS budget, DR-A22) | before G2 | product-manager | CLOSED (D-035; verify at G2) |
| G1-C2 | Milestone/MoSCoW tag fixes (REQ-UI-014, AUTH-020, UI-018, PICK-013/US-239), regen stats | before G2 | product-manager | CLOSED (D-036; verify at G2) |
| G1-C3 | Assumption/GAP hygiene, permission markers, NFR-MAINT-002 table fix | before G2 | product-manager | CLOSED (verify at G2) |
| G1-C4 | NFR traceability: Design column (architect) before G2; Test column (qa-lead) before P5 | G2 / P5 | principal-architect, qa-lead | IN_PROGRESS |
| G1-C5 | Demo-critical Must tagging per epic (PM) before G2; wave plan by it (P4) | G2 / P4 | product-manager, senior-developer | PM tag DONE (DC=134: M0 74, M1 60; ladder PRD §7.1, D-037); wave plan pending P4 |
| COND-SANDBOX-DEMO | Real sandbox label from DHL, FedEx and UPS booked and paid end to end (M1 exit demo); needs creds outside the repo | Post-release, when creds supplied | qa-lead | OPEN (blocked on external creds, by design) |

## Top Risks
1. **Scope size.** M0+M1 is very large for one run. Mitigation: strict Must/Should prioritisation in P1, small waves, escalation-ladder re-scoping.
2. **Carrier API drift.** No live sandbox access. Mitigation: verify docs at implementation time, contract suite, opt-in live runs.
3. **Windows host.** Tooling must be cross-platform (Node scripts, no bash-only, LF endings enforced).
4. **Testcontainers on Docker Desktop.** Integration tests depend on Docker availability in CI and locally.

## Next Actions
- product-manager: close G1-C1, C2, C3, C5-tag; fill CLAUDE.md §1.
- ux-designer: P2 for Must UI stories.
- principal-architect: P3 (ADR-0001 fixed stack, C4 L1–L3, ADRs, data model, OpenAPI, threat model via security-analyst, NFR strategy, G1-C4 Design column) → G2.
