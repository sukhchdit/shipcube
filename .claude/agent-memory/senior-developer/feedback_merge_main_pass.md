---
name: merge-main-pass
description: Lessons from the batch 0.2 merge-main pass (PRs #3-#5 absorbing TASK-002 lint): read new main docs first, rule conflicts in typescript-eslint, lock regeneration check, reaped gates
metadata:
  type: feedback
---

When a PR has to absorb `main`, read the newest review files and the newest D-ORCH entries on `origin/main` **before** you merge. Reviewers route "fix in the merge-main pass" items there, and those items are often missing from the dispatch brief.

**Why:** In the 2026-11-12 pass, `origin/main` gained round-2 reviews and D-ORCH-007 while I was working. They added PR #4 merge-pass work: lint runs typegen first, `--allow-empty-input` dropped, Playwright output ignores. They also asked for `test:coverage` on the merge commit. I found this only when an ancestry check failed at the end, and I needed a second merge plus extra commits.

**How to apply:**
- Fetch first, then grep `docs/05-quality/{reviews,security}/PR-000N-*` on `origin/main` for "merge-main" and "merged tree". Run `git merge-base --is-ancestor origin/main HEAD` again before you report.
- TASK-002's type-aware config only flags code once it is merged in, so expect about 5 to 26 errors per branch. Fix them properly. The only accepted relaxations are narrow `files:` blocks that follow the jest-esm allowance pattern, and they must be listed for review.
- `prefer-promise-reject-errors` conflicts with `no-unnecessary-type-assertion` when a test rejects with a non-Error. Use a test helper `rejectWith(reason: unknown) => new Promise<never>(() => { throw reason; })` (`only-throw-error` allows `unknown`). Joi's `ValidationResult` types the error branch's `value` as `any`: read `result.value` into an `unknown`-typed variable instead of destructuring it.
- After `npm install --package-lock-only`, compare the lock delta vs main with the branch's own delta vs its merge-base (scratch `lockdiff.mjs`, comparing `packages` keys). When both deltas are identical, that is the evidence.
- TASK-002 has an exact-steps test for the `lint` script (`tools/lint/negative-fixtures.test.ts`). Changing the script means updating that test.
- Background gate runs can be reaped under memory pressure. Do not restart them. Run only targeted foreground checks, and list in the PR comment which gates still need a re-run.

Related: [[p5-dispatch]], [[p5-worktrees]]
