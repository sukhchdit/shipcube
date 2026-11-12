# Stories — conventions

Owner: product-manager · Version 1.1 (DC column added, D-037) · 2026-11-12. One file per epic: `EPIC-NN-<slug>.md`. Story IDs `US-NNN` are unique across all epics. Requirements live in `../REQUIREMENTS.md`; NFRs in `../NFR.md`; decisions in `../../sdlc/DECISIONS.md`.

## Epic file layout

```markdown
# EPIC-NN — <Epic name>

- **Goal:** one sentence (outcome, not feature list)
- **Milestone(s):** M0 | M1 | M0+M1
- **REQ areas covered:** REQ-XXX, REQ-YYY (every REQ in these areas is linked by at least one story below)
- **Exit-demo contribution:** which M0/M1 demo scenario(s) in PRD §6 depend on this epic
- **Depends on epics:** EPIC-xx (cross-epic dependencies are expressed at epic level)

## Story summary
| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs | DC |
|---|---|---|---|---|---|---|---|

## Stories
### US-NNN — <Title>
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S | M · **Depends on:** US-xxx, EPIC-yy
- **Linked REQs:** REQ-XXX-001, REQ-XXX-002 (exact IDs; the traceability generator parses this line)
- **Linked NFRs (optional):** NFR-XXX-001
- **As a** <persona> **I want** <capability> **so that** <outcome>.
- **Notes:** scope boundaries, out-of-scope, COND-SANDBOX-DEMO where relevant

#### Acceptance criteria
```gherkin
Feature: <story title>
  Background: (optional shared Given)

  Scenario: <happy path>
  Scenario: <validation / edge / failure path>
  Scenario: <permission denied>            # or an explicit "Permission path: not applicable — <reason>" note before the block
  Scenario: <audit expectation>            # where the story mutates or reads sensitive data
  @live-sandbox
  Scenario: <sandbox variant>              # only for carrier/Stripe stories; tagged COND-SANDBOX-DEMO
```
```

## Rules
1. **INVEST.** Independent where possible, negotiable in solution, valuable to a named persona (including "developer" and "operator" for platform stories), estimable, **small** (S ≤ ~2 dev-days, M ≤ ~4; nothing larger — split L), testable.
2. **MoSCoW per D-029.** Must = on the critical path of an exit demo (PRD §6) or a non-negotiable cross-cutting obligation (RBAC, audit, RLS, i18n, WCAG 2.2 AA, responsive). Everything else Should or Could. A story's MoSCoW is never higher than the highest MoSCoW of its linked REQs, and a Must REQ must be linked by at least one Must story.
3. **Gherkin coverage.** Every **Must** story has at least: one happy path, one negative (validation, failure, edge or timeout) path, and one permission path (denied for a role without the permission, cross-tenant 404, or unauthenticated 401). Where no principal exists (build tooling, pure library), write `Permission path: not applicable — <reason>` immediately before the gherkin block and include a second negative scenario instead. Stories that mutate state or read sensitive data also include an audit scenario (entry fields, outcome, same-transaction).
4. **Concrete values.** Use the numbers and codes from REQUIREMENTS.md (error codes from DR-A26, states from DR-B01, limits from DR-A22/DR-B34, etc.). Error responses are `application/problem+json` with the stated code.
5. **Testable now.** Scenarios run against the Mock carrier, recorded fixtures and the Mock/Stripe-fixture gateway. Live-sandbox variants are separate scenarios tagged `@live-sandbox` and noted as COND-SANDBOX-DEMO (D-003).
6. **Locales, states, responsive.** UI stories include scenarios or explicit AC lines for the three locales (en/es/fr), the six screen states (loading, empty, error, partial, permission-denied, offline) where they apply, and mobile (360 px) + desktop (1280 px).
7. **Traceability.** Every REQ in the epic's areas appears in at least one story's "Linked REQs" line; every story links at least one REQ. Could REQs may be grouped into Could stories.
8. **No design.** Stories state behaviour and outcomes; libraries, schemas and component structure are for P2/P3.
9. **Demo-critical tag (D-037, v1.1).** The last summary-table column `DC` holds `DC` for a Must story that a step or assertion of the PRD §6.1 or §6.2 demo script cannot execute without, and is empty otherwise. Only Must stories may carry it. P4 waves DC stories first; the re-scope ladder in PRD §7.1 never defers a DC story (it splits it). Moving the tag is a product decision logged in `DECISIONS.md`.
