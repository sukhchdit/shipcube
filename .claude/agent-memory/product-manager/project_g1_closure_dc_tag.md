---
name: g1-closure-and-dc-tag
description: How G1-C1/C2/C3/C5 were closed (D-035..D-037), the demo-critical (DC) tag convention and counts, the re-scope ladder in PRD §7.1, and what to keep consistent when touching REQ/NFR/story numbers again.
metadata:
  type: project
---

G1 for run 1 was PASS_WITH_CONDITIONS (2026-11-12). product-manager closed C1 (contradictory defaults), C2 (tags), C3 (hygiene) and the C5 tag; C4 (NFR → mechanism matrix) belongs to principal-architect at `docs/03-architecture/nfr-traceability.md`, linked from the end of `docs/sdlc/traceability.md`.

**Decisions:** D-035 (one value per default: guest quotes 20/min+100/h per IP; resend/reset 3/h per account + 10/h per IP; compose healthy ≤ 180 s; public JS ≤ 170 kB; 5/min/account auth limit kept; NFR-RES-001..003 aligned to REQ-CARR-017), D-036 (REQ-UI-014/UI-018/AUTH-020 → M1; REQ-PICK-013 and US-239 → Should), D-037 (DC tag + ladder).

**DC tag:** last column `DC` of every epic story-summary table and of traceability "Story → Requirement". 134 DC of 214 Must (M0 74, M1 60). Rule: DC only if a PRD §6.1/§6.2 demo step or assertion cannot execute without the story; cross-cutting Must obligations the scripts don't assert are Must-not-DC. Ladder (PRD §7.1): defer Could → defer Should → defer non-DC Must (becomes Should + named gate condition) → split DC Must; never defer a DC story outright.

**Why:** F1 risk was a design satisfying one doc and failing the other's test; F5 was 215 Must stories with no agreed fallback. Where REQ and NFR disagreed I kept the value that already had Gherkin written against it (REQ side) and the stricter abuse limit.

**How to apply:** When re-scoping (escalation step 3) use the ladder and the DC column; don't invent a new order. When changing any limit/budget, update REQUIREMENTS row + NFR row + story Notes + ASSUMPTIONS (A-033/035/037/039 are the "one set" rows) together, then re-run the Node verification agent (checks: counts vs statistics tables, orphans, dangling, MoSCoW rule, DC set = 134 and all Must, marker literal `Permission path: not applicable`). Current count baselines: REQs 317/94/19, 204 M0/226 M1; stories 214/68/8, 119/171.
