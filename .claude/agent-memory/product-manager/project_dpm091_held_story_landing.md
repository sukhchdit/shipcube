---
name: dpm091-held-story-landing
description: D-PM-091 (2026-11-21) — held story text of D-PM-085/086/088/089/090 landed in the main checkout with hand-aligned map rows (QG-044-C2 (f)), uncommitted because the run had no shell; AT-US-135-13 NOT appended (map test totals 1612/1606 are pinned in tools/quality tests); PRD 1.25; next D-PM-092, A-120
metadata:
  type: project
---

D-PM-091 landed story text that earlier entries had held, in the working tree of the main checkout: US-040 notes (D-PM-088 outage sentence, D-PM-090 in-flight hold), US-042 notes + AT-US-042-06 retitle + AT-US-042-07 When-step, US-045 notes + AT-US-045-05 steps, US-135 notes + AT-US-135-06 steps (D-PM-089). The four uncommitted edits already there (EPIC-04/06/10/16) were my own D-PM-085 and D-PM-086 text, recorded as the held patches by D-ORCH-143. Map: AT-US-293-15 and AT-US-042-06 titles, AT-US-042-07 suite `api` (override removed from `gherkin-suite-assignments.json`), Summary `api` 205, `rbac-matrix` 78.

**Why AT-US-135-13 was left out:** an appended scenario moves the map totals, and `tools/quality/gen-gherkin-map.test.ts` and `tools/quality/lib/test-ids.test.ts` pin 1612 rows / 1606 G3 (also "1,606" in TEST-STRATEGY.md). A story with one more scenario than its assignment fails the generator and the drift guard. So it cannot be a documents-only commit; it is qa-lead's commit with the test totals, due before TASK-141 is dispatched. US-135 stays at 12 scenarios and its Notes say so.

**How to apply:**
- Count-neutral story edits (a title, a step, a suite) can land with a hand-aligned map row: the map is `renderMap` output (title from the Scenario line, suite from the assignment JSON, lane from `suite_lanes`, suite table by count then first row). A scenario added or removed never can; route it to qa-lead with the five places (story block, assignment count, map, two test totals, TEST-STRATEGY).
- A suite change in the map needs the assignment JSON changed too, or the byte-identity test fails.
- Without a shell nothing can be committed. Leave the edits in the working tree, give the pathspec commit command and the check to run first (`npm run quality:gherkin-map -- --check`), and say "discharged in content, closes with the commit" for a gate condition. Do not write "landed" without a SHA.
- To check an uncommitted diff without git: anchored searches for each added line of the held patch, line counts of the file in the main checkout and in sibling worktrees (a branch with the patch, a task branch without it), and line-count fingerprints. Name the `git diff <sha> -- <path>` the committer should see empty.
- Before starting a D-PM entry, grep `docs/` and the DECISIONS tail for the next ID: the QG-041B-C3 decision was dispatched to two runs and the other one wrote D-PM-090 while I was editing. I wrote no second entry and took D-PM-091 for the landing only.
- Still held after this: the D-PM-087 notes (US-080 in EPIC-03, US-166 in EPIC-08), `../.orch/held/D-PM-087-stories.note.md`.

Related: [[dpm089-us042-split-stream-wording]], [[dpm090-inflight-hold-accepted]], [[dpm088-store-outage-as-built]], [[d065-gherkin-append-only]], [[dpm081-082-idempotency-audit-us038-split]].
