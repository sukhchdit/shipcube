---
name: project-wave1-batch11-rulings
description: D-ARCH-151..153 (PR #65 / TASK-037, batch 1.1) — operator organisation as a reserved migration row, optional type on the create-organisation request (lands with TASK-224), first production staff user at M5; why contract edits cannot go on main as docs, and the Must-story-in-a-cuttable-task flag left with product-manager
metadata:
  type: project
---

Batch 1.1 rulings, 2026-11-18, commit `96278d0`; ADR-0005 amendment 12 (items 23 to 26); data-model A30; risks R-ARCH-33; `rulings/wave-1-batch-1.1-rulings.md`.

- **D-ARCH-151:** the one OPERATOR organisation is a reserved row (`OPERATOR_ORG_ID` = `00000000-0000-7000-8000-000000000010`) of the migration that creates `organisations`, inserted before `FORCE`. AT-US-061-01 stays on TASK-037.
- **D-ARCH-152:** `OrganisationCreateRequest` gains an optional `type` (all four values, default `BUSINESS_CUSTOMER`); the acceptance criteria stand. The edit rides the TASK-224 PR.
- **D-ARCH-153:** first staff user in production = `ops:staff-bootstrap` at M5, a G4 precondition for a production release.

**Why:**
- After `FORCE` the migrator cannot write an RLS table, and the demo seed never runs in production, so production had no operator organisation. `p_organisations__active` checks only `id = app_org_id()`, so on an empty unique index the service rule was the only control against a first OPERATOR organisation.
- REQ-AUDIT-010 writes no audit entry for a 400. An acceptance criterion that wants a refused attempt audited needs a 422, so the field must pass the schema.

**How to apply:**
- A reserved row of an RLS table can only ship in the migration that creates the table. A later one needs a new ADR-0005 amendment, not a seed step.
- **Never edit `api/openapi.yaml`, `api/README.md`, the story files or `gherkin-test-map.md` in a docs commit on `main`.** They are `tooling_inputs`: a change makes the lane-B evidence of every open PR stale (`check-evidence`), and a schema change also needs `types.gen.ts` regenerated (`tools/openapi/types-drift.test.ts`). Write the exact delta in a rulings file and put it on the card of the task that mounts the route (api/README §18 item 1).
- `data-model.md` is read by `tools/db/render-rls-dr-a14.test.ts` (the §4.3 fence with `-- template dr-a14-users`) but is not a tooling input. Do not touch that fence in a docs commit.
- Still open with product-manager: US-061 and US-062 (M0 Must) now close in TASK-224 and TASK-231 (Wave 8, Should, cuttable). I flagged it on the cards and did not change `us`/`part`. Check DECISIONS for the answer before the next fold of those cards.
- Wording left for product-manager: REQ-ORG-001 "(created by seed)".

**Process lessons:**
1. While a lane-B queue runs the host has about 5 GB free. I ran no lint, test or type check; `gen.mjs` and small `node -e` scripts were fine. Say "not linted here" in the ruling instead of running `openapi:lint`.
2. The harness attribution reminder named my actual model; the orchestrator's brief named the trailer of earlier sessions. I used the harness one and said so in the handoff.
3. `git pull --rebase` needs `--autostash` because other agents' memory files are dirty in the shared checkout; check `git status -s` afterwards.
4. plan-data keys: orgs = 037, seeddemo = 089, orgswitch = 224, members = 231, invite = 227. The applier that worked: find the single line starting with the block key, replace one exact `x` tail, append quoted items before the array's closing tail; then the per-field verify script and a CSV diff, as in [[wave0-sheet-fold9-rulings]].
