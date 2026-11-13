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

**PR #3 post-TASK-003 pass (2026-11-12): about 35 tool calls, clean.** `test:coverage` runs every Jest project, including integration, so it needs Docker just like `test:integration`. Before each Docker gate, run `docker ps | grep postgres:18` to see whether another instance's Testcontainers are running; if they are, run the non-Docker gates first. A wait loop of the form `timeout 590 bash -c "until grep -q '<step> exit' summary; do sleep 10; done"` is allowed, so you can wait on background gates. Any `git diff`/`grep` command line that names `.env.example` is denied, even with `--stat`. To inspect compose.env secrets, print only key names and lengths with a `node -e` one-liner.

**PR #9 post-TASK-007 pass (2026-11-13): about 45 calls, no code changes needed, lane A fast-lane green on the first push.** Lessons:
- Main moved docs-only twice while I gated, and a round-3 review with a merge-condition item landed. Since the merge was still unpushed, I ran `git reset --hard <branch head SHA>` and re-merged the new main. That kept ONE merge commit. Evidence: `git diff <gated> HEAD -- . ':!docs' ':!.claude'` is empty, plus a lint/format/unit re-run.
- Pure-union proof script: take the branch-only files and the main-only files (from `comm` over the two name lists), diff each set against its side (expect 0 lines), then for each overlapping file check that HEAD-vs-branch equals main's delta.
- `package-lock.json` is binary in `git diff` (gitattributes), so use `--text` to compare deltas.
- Main's lane-A checkers run locally without CI env: `node tools/ci/<checker> --root . [--base <main> --head <HEAD>]`. `check-dep-age` needs `--fetch --out` first. `run-semgrep.mjs` uses Docker, so take docker.lock (~4 min).
- The expected first-run failure is `scans / Security-owned paths need a review record`, which makes ci-gate red. That is the orchestrator's record, not mine.
- When a review offers "fix at the merge-main pass, or route to TASK-xxx" and the brief is scoped to the merge, report it as an open merge condition. Don't widen the merge delta.

**PR #4 post-TASK-023 pass (2026-11-13): about 30 calls, lane A fast-lane + gitleaks green on the first push.** No textual conflicts, and the lock auto-merge was byte-identical to "main's lock + `npm install --package-lock-only`". Main moved docs-only during the gate, so I reset to the branch head and re-merged (one merge commit). Reviewer watchlist routings on main ("PR #N merge-main must ...") can already be satisfied by an earlier pass: check the merged file before editing. Scratch `merge-main4/PR-4/{union.sh,gates.sh,gitleaks.sh}` are reusable templates.
