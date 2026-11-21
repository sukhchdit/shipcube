---
name: p4-concurrency-and-positional-ids
description: Shipqube QA docs are co-edited by other agents mid-session; AT- test IDs are positional so the Gherkin map must be regenerated after any story edit
metadata:
  type: project
---

During P4 (2026-11-12) product-manager, ux-designer and principal-architect edited story files, ADR-0023 and nfr-traceability.md while qa-lead was writing. Story Gherkin changed mid-session (Must scenarios went 1,592 → 1,599), which shifted positional `AT-US-NNN-nn` IDs.

**Why:** `AT-` IDs are the 1-based scenario position in each story (D-QA-002), and `docs/05-quality/tests/gherkin-test-map.md` is generated, not hand-written. The generator lived only in a session scratchpad; Wave 0 task T-QA-02 is supposed to commit it as `tools/quality/gen-gherkin-map.mjs`.

**How to apply:**
- Regenerate the Gherkin map as the last step of any QA session and after every story change; check whether T-QA-02 has landed the generator before rebuilding one.
- In shared files (nfr-traceability.md, DECISIONS.md, traceability.md) make Edit calls strictly one at a time, never two in the same batch, and re-read before each edit. Append to DECISIONS.md via a scratch file + `cat >>` (heredocs with backticks failed in this shell).
- P5 (2026-11-19): other agents commit to main while you work, and leave uncommitted hunks in DECISIONS.md. Stage only your entry: `git show HEAD:docs/sdlc/DECISIONS.md` + your entry → `git hash-object -w` → `git update-index --cacheinfo`; never `git add` the whole shared file. Commit and push right away.
- `gherkin-test-map.md` is generated from `docs/05-quality/tests/gherkin-suite-assignments.json` (not a tooling input; the map is). Changing a suite label means editing both, and that makes open PRs' lane-B evidence stale. The suite column has no gate effect, so batch label fixes with the next story-driven regeneration.
- `tools/quality/lib/test-ids.test.ts` pins the adopted SEC-TC set (67 since TASK-293) and the map row counts. Moving a registry row between Proposed and Adopted is a code change, not docs only (SEC-TC-74 pending, D-QA-021).
- The map cannot "name tests" on a row: lane-A unit test `gen-gherkin-map.test.ts` requires the committed map byte-identical to the generator output, and `parseGherkinMap` requires exactly 6 cells. Decisions routing "the row names test X" (D-SD-007, D-PM-079/082, 2026-11-20) need a generator feature first (proposed: `notes` keyed by AT-ID in the assignments JSON, rendered as a trailing section). Scenario titles come from the story files, so a retitle is product-manager's story edit plus regeneration.
- Held story-patch commits (D-PM-085/086, 2026-11-20): do them in a fresh worktree from origin/main, `git apply` the held patch, regenerate, then check the map diff is only the retitled rows. `npm run test:unit -- <paths>` ran ALL 312 suites (11 min, prisma-client failures in a fresh worktree); call jest directly with `--selectProjects unit --runTestsByPath <files>` (2 s). `quality:trace` exits 1 on every run since PR #46 (decoy title `SEC-TC-060` in tools/ci/security-integration.test.ts:143, S4, routed in DECISIONS around line 4372); compare with a pristine-tree run before blaming a change. Orchestrator commit subjects can be over commitlint's 100-char header limit; docs-only pushes skip CI commitlint, but say so in the report.
- Related: [[qa-strategy-artifacts]]
