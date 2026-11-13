---
name: batch-020-015-lessons
description: TASK-020/015 (2026-11-13) - 4 opus specialists in 2 rounds of 2 all reported; Jest global-hook resolution, Joi _definition, scratchpad wipe, evidence-run recipe, base-ref constraints that force deviations
metadata:
  type: feedback
---

TASK-020 (route metadata, huge sheet) and TASK-015 (CI hardening, split into 015-A/B/C) ran with 4 opus specialists, 2 at a time (D-ORCH-010 cap). All 4 reported, at 128-142 tool uses each, so the "80-turn limit" did not bite. I did the routing core myself. The PR-opening protocol is in [[lane-a-pr-hygiene]].

**Why:** these are reusable traps and recipes for later Wave-0/1 tasks.

**How to apply:**

**Dispatch**
- Brief one area per specialist with exact sheet line numbers and an ownership list. A lead-owned shared file (`eslint.config.mjs`) can pass between rounds.
- A specialist's new lint rule may flag the lead's in-flight code (it caught a `${error.message}` in my file). Lint the whole area after each report.
- Decision-ID collisions: the specialists took D-TASK020-10..17, so pre-assign ID ranges per specialist.

**Base-ref constraints force deviations; expect them on CI PRs**
- The policy forbids `/.gitleaksignore`, so the baseline went to `tools/quality/`.
- The npx rule rejected `npm exec --no -w …`, so the form became `npm -w … exec --no --`.
- New gates pinned in a PR only govern later PRs, so prove them with unit and mutation tests.

**Jest**
- `globalTeardown` and `globalSetup` load outside Jest's module mapper, so `.js` specifiers of TS sources fail. Spawn a `tsx` CLI (`node_modules/tsx/dist/cli.mjs`) from a builtins-only teardown.
- A teardown that throws flips the exit code.

**Joi**
- Type message templates live at `schema._definition.messages`.
- `node -e "…\$_definition…"` in bash silently became `_definition` through `$`-substitution, so my probe "worked" while the real code read `$_definition` (undefined) and SAFE_MESSAGES was empty. Only a pinned coverage test caught it.
- Never trust a bash `node -e` probe that contains `$`. Write the probe with the Write tool.

**Scratchpad wipe (D-ORCH-038)**
- Something deleted scratch helpers mid-session (briefs, `run-int-locked.sh`, `docker-locked.sh`).
- Check that a helper exists before you rely on it, and keep helpers small enough to rewrite.
- Re-verify the docker.lock owner file before heavy commands.

**Evidence recipe** (`wave0/evidence.sh`)
- Hold the lock for the whole run: `npm ci --ignore-scripts` → `deps:rebuild` → porcelain=0 and `info/exclude`=0 → `quality:heavy -- --profile pr`.
- Commit `test(evidence): heavy lane pr <sha7> pass (TASK-xxx)` with a gate table that includes the host-path scan count and the parked-SEC-TC row (D-SEC-PR31-01).
- Keep commitlint body lines ≤ 100: a long table row failed.
- After the evidence, only `docs/**` and `.claude/agent-memory/*/*.md` may change. Check with `node tools/quality/check-evidence.mjs --base <merge-base> --head HEAD --profile pr --event pull_request`.

**Gates**
- `test:coverage` under host load lost a Postgres container mid-run: 4 suites failed with P1001. A targeted re-run of only those files under the lock passed. Report both runs.
- To replay the base-ref fixture step locally, run `wave0/baseref-fixtures.sh <wt> <merge-base>` (needs a clean tree).

**Merges**
- DECISIONS.md conflicts on every merge of main. Rebuild it as main's file plus our block, kept in scratch.

Related: [[batch-019-032-lessons]], [[lane-a-pr-hygiene]], [[p5-dispatch]]
