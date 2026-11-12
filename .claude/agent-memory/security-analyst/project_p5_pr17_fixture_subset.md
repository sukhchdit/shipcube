---
name: project-p5-pr17-fixture-subset
description: PR #17 (TASK-007 follow-up) R1 @ea78d38 + R2 @8dd1d24 PASS_WITH_FOLLOW-UPS; 01/03-06 closed; new LOW 07 (yaml-subset folded differential beats pin), 08 (BASH_ENV/PATH env), 09 (Jest __mocks__), 10 (lint-step regexes); probe-confirmed swc/Jest/bash/git facts; PR #4 conflict
metadata:
  type: project
---

The PR #17 review is `docs/05-quality/security/PR-0017-TASK-007-security-review.md` (R1 + "Round 2" section).
- **R1:** head `ea78d38`, 2026-11-13. PASS_WITH_FOLLOW-UPS, PR17-SEC-01..06.
- **R2:** head `8dd1d24`, 2026-11-13. PASS_WITH_FOLLOW-UPS.
  - Closed 01, 03, 04, 05, 06. 02 is still open (routed to TASK-015). New LOW findings 07-10.
  - The simulated record check passed (main's tool, main `9bbcb77`). Control C, the R1-only record, gave `missing`.

**Open findings and what to check:**
- **02 (LOW).** The matcher is location-blind. Check for line/column in the harness (TASK-015).
- **07 (LOW).** `yaml-subset.mjs` `foldLines` is not spec-compliant.
  - It appends a more-indented line to the previous line with no newline.
  - So in `run: >`, a `# comment` line followed by a more-indented `exit 0` is one comment line for the checker, and `commandLines` drops it. GitHub (YamlDotNet/libyaml) runs `exit 0`, which bypasses the pinned base-ref step.
  - My PR-0010 claim "folded scalars are understood" was wrong for more-indented lines.
  - Fix: fail closed on folded scalars that contain whitespace-leading or empty lines, and require a literal `|` for pinned steps.
- **08 (LOW).** These pass the checker and can redefine `node` for every gate:
  - workflow/job `env` `BASH_ENV`, `PATH` or `BASH_FUNC_*`;
  - earlier-step writes to `$GITHUB_ENV`/`$GITHUB_PATH`.
  The exact step-env check covers only gates that declare `env`.
- **09 (LOW).** Jest 30 uses ANY `__mocks__/<pkg>` under `roots` for a bare `require('<pkg>')`, with no `jest.mock` call (jest-runtime `build/index.js:296-303`).
  - `modulePathIgnorePatterns: ['/__mocks__/']` disables this.
  - The repo has no `__mocks__` today.
  - Due before the first Wave-1 feature merge.
- **10 (LOW).** The `LINT_STEPS` regexes have no end anchor, so `|| true` and `; true` pass. Subset mode also allows `cd`/`export` steps placed before the base steps.

**Facts, probe-confirmed 2026-11-13:**
- **@swc/jest 0.2.39.**
  - With non-empty inline options it never reads `<cwd>/.swcrc`, and `swcrc:false` stops the nested lookup.
  - `buildSwcTransformOpts` mutates the nested `jsc` of the options passed in (harmless).
- **git** refuses `.git` path components, case-insensitively, both in the index and on checkout. `fsck` reports `hasDotgit`.
  - So PR content cannot exploit a tree walk that skips directories containing `.git`.
  - The Workflow policy step also runs before any head code.
- **GitHub bash** (`--noprofile --norc -eo pipefail`) honours `BASH_ENV`, and functions defined there shadow commands.
- **The runner reads log lines with `ReadLine`,** so a lone CR also starts a new line, and that line can start a `::command`.
- **Jest `--config <file>`** failed in a scratch dir on this host ("Could not find a config file"). Placing `jest.config.json` in cwd works.
- **Record-row pitfall:** never start a table's first cell with "Head", except the real head row.

**How to apply:**
- **TASK-015 review:** check, together with PR10-SEC-17/19/21:
  - 07: the Example 8.10 fixture and the F0-F2 mutations;
  - 08: the R1-R8 cases;
  - 10, 02, and the CR note on PR17-SEC-05.
- **The next devops PR, at the latest before Wave-1:** check 09.
- **Before merge:** owned-path overlap with main was nil at `9bbcb77`. Re-check it if owned paths land on main first.
  - PR #4 (`d2e867b`) changes the same owned `jest.config.ts` and `tools/lint/negative-fixtures.test.ts`, and the two PRs conflict in both files.
  - D-ORCH-020 sets the merge order: #17 first, then #4.
  - Whichever of the two merges second needs a delta round on its merge commit; see [[project-p5-wave0-web-scaffolds]].

Related: [[project-p5-pr10-ci-lane]], [[project-p5-pr2-lint-controls]], [[project-security-review-conventions]]
