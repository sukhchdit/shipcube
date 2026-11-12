# SDLC Status
- **Product:** the Platform (multi-carrier shipping platform, repo `sukhchdit/shipcube`)    **Updated:** 2026-11-12
- **Run scope:** M0 Foundation + M1 Customer MVP (brief §12). M2–M5 = backlog.
- **Current phase:** P4 Planning (+ G2 condition closure)    **State:** IN_PROGRESS

## Phase / Task list
| # | Phase | Owner | State | Notes |
|---|---|---|---|---|
| P0 | Intake | orchestrator | ✅ DONE | BRIEF.md, operating params (D-002), Q-001..Q-004 answered |
| P1 | Requirements → G1 | product-manager | ✅ G1 PASS_WITH_CONDITIONS | 430 REQs, 90 NFRs, 290 stories (215 Must), D-008..D-034, A-005..A-077 (commit 9cb3205) |
| P2 | UX | ux-designer | ✅ DONE | 108/108 Must UI stories covered; F01–F10, W00–W17, tokens.json (validated), D-UX-001..029. 11 open items → P3 (README §5) |
| P3 | Architecture → G2 | principal-architect | ✅ G2 PASS_WITH_CONDITIONS | 27 ADRs, C4, data model (~90 tables), OpenAPI 3.1 (132 ops, lint 0 errors), threat model (119 threats), NFR strategy + G1-C4 design column. Pre-G2: ADR-0023 amend (D-ORCH-001), UX §5 items; PM applies D-ARCH-006 wording |
| P4 | Planning | senior-developer + qa-lead | ▶ IN_PROGRESS | Task DAG + waves by DC tag; Wave 0 = skeleton, CI lanes, generators, SPK-01..08; test strategy + NFR Test column |
| P5 | Build (waves, M0 → M1) | senior-developer | ⏳ | `v0.1.0-m0` pre-release after M0 waves (D-006) |
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
| G2-C1 | NFR-RES-007 row in nfr-traceability/nfr-strategy (91 NFRs) | P4 exit | principal-architect | IN_PROGRESS |
| G2-C2 | traceability.md Design column for 434 REQs; ARCHITECTURE §6 adds AUTH-025/026, CARR-022/023; Valkey labels; close R-ARCH-10 | P4 exit | principal-architect | IN_PROGRESS |
| G2-C3 | SEC-COND-05 (audit fn search_path), 06 (cvc_check=pass), 07 (unverified=anonymous, quote-create class, org quota share); SEC-P3-30/33 drift; security-analyst records closure; SEC-COND-03 item 7 → G4-production checklist | P4 exit (design) · G3 (tests) | principal-architect, product-manager, security-analyst | IN_PROGRESS |
| G2-C4 | UX README reconcile v1.3 (US-027 Must screens, US-291..293, 218 count, admin idle dialog, CVC note) | P4 exit | ux-designer | IN_PROGRESS |
| G2-C5 | NFR Test column (91) incl. SEC-TC-01..64 | before P5 | qa-lead | IN_PROGRESS |
| COND-G4-PROD | Locked audit-anchor sink, RDS master break-glass only, pgaudit (SEC-COND-03 item 7) | G4 for any production release (not this run) | platform-architect, release-manager | OPEN (n/a this run: no prod target) |
| COND-SANDBOX-DEMO | Real sandbox label from DHL, FedEx and UPS booked and paid end to end (M1 exit demo); needs creds outside the repo | Post-release, when creds supplied | qa-lead | OPEN (blocked on external creds, by design) |

## Top Risks
1. **Scope size.** M0+M1 is very large for one run. Mitigation: strict Must/Should prioritisation in P1, small waves, escalation-ladder re-scoping.
2. **Carrier API drift.** No live sandbox access. Mitigation: verify docs at implementation time, contract suite, opt-in live runs.
3. **Windows host.** Tooling must be cross-platform (Node scripts, no bash-only, LF endings enforced).
4. **Testcontainers on Docker Desktop.** Integration tests depend on Docker availability in CI and locally.

## Next Actions
- P4 in parallel: senior-developer (plan), qa-lead (test strategy, G2-C5), principal-architect (G2-C1/C2/C3), product-manager (G2-C3 requirement side), ux-designer (G2-C4).
- At P4 exit: security-analyst confirms SEC-COND-05..07; orchestrator verifies all G2 conditions before P5 Wave 0.
