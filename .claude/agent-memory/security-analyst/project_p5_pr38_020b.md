---
name: project-p5-pr38-020b
description: PR #38 (TASK-020 part 020-B, generated client package, runner activation, D-ARCH-109/110) R1 @bdf009d and delta R2 @8b3a8ed PASS_WITH_FOLLOW-UPS; 01/02/05/06 closed in R2, 03/04 open (020-C); probe kits (lint matrix, R1-m1 differential, record sim) and due points
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0038-TASK-020B-security-review.md`, written in the PR worktree (uncommitted, LF, 473 lines) on 2026-11-14. Code review twin on main: `docs/05-quality/reviews/PR-0038-TASK-020B-code-review.md` (`ea56793`, CHANGES_REQUESTED R1-M1 = deleted PR32-SEC-15 deep-freeze tests).

**R1 @bdf009d: PASS_WITH_FOLLOW-UPS.**
- **Closed:** PR32-SEC-14, PR32-SEC-16, PR32-SEC-17 (missing/renamed `$_terms` form), R2-n2.
- **LOW 01:** `tools/eslint-rules/db-raw-sql.mjs` `PRISMA_SOURCES` lacks `@platform/prisma`. In platform/db, 7 bare-specifier helper forms are silent; the relative controls fire. Fix: preferably in the union commit; at the latest before TASK-024 merges and before TASK-025/026/040 start.
- **LOW 02:** the value allowance `db-platform-core` = `apps/*/src/platform/db/**` includes the un-owned `apps/worker/src/platform/db/`.
  - There, template `import()` and `createRequire` are lint-clean and need no record.
  - Fix: a CODEOWNERS line, plus an architect ruling on narrowing to `generated.ts`.
- **LOW 03:** `schema.headers` may declare `cookie`/`authorization`/`x-quote-token`, and the handler receives them (probe 3/3).
  - This contradicts D-ARCH-109 (3).
  - Compensating control: the route-metadata drift test (unowned). Owner 020-C, before TASK-055.
- **INFO:**
  - 04: a non-plain `$_terms` (null-prototype, Map, class instance) is accepted (020-C);
  - 05: the `DB_CONNECTION_TIMEOUT_MS` floor (= code review R1-m2; the exit is 1, not 78);
  - 06: CODEOWNERS for `packages/shared/src/http/` and the SEC-TC-29 helper (= R1-m6).
- **Evidence** `20261113T2251Z_cb7c12e`: accepted. `npm ci --ignore-scripts` is verbatim; `info/exclude` is stated as "0 non-comment lines", accepted as a substitute.

**Facts:**
- PR #34 merged as `263b790`. The union conflicts only in eslint `BOUNDARIES_FILES` (the db-root-client list vs the db-test-seam line). The seam pair must stay the last two policies. The union voids the record (sim H), so a merge-only or delta round follows.
- Owned paths: 47.
- Express 5.3.0 `res.locals` = `Object.create(null)`.
- The compiled client embeds the whole schema as `inlineSchema` (a TASK-014 note).
- `boundaries` classifies `prisma/dist/**` as `prisma` (relative dist imports are caught only by no-relative-packages).
- The new `exports` map blocks deep `@platform/prisma/...` paths.

**Method that worked:**
- Lint: `lintText` with the worktree's own config and `node_modules` (cwd = worktree, nothing written). 198 boundary cases and 14 raw-rule cases, each paired with a relative control.
- Full-app header probe: a `git archive` extract plus `hooks.mjs`, mapping `@platform/prisma/client` to the worktree's generated client.ts.
- Record sim:
  - a sparse `git clone --shared` with `MSYS_NO_PATHCONV=1 git sparse-checkout set --no-cone '/.github/' '/docs/05-quality/security/' '/tools/ci/'`; without it, Git Bash rewrites the patterns to `C:/Program Files/Git/...`;
  - plumbing scenario commits, 13/13.
- Worktree cleanliness without git: `find <wt> -newer <scratch file> -not -path '*/node_modules/*'`.

**How to apply:**
- Next round on the union head: effective-config delta equivalence, the seam pair last, a re-run of the P1 matrix (and R01-R14 should fire if 01 is fixed), the lockfile still one leaf, CODEOWNERS, and the evidence statements verbatim.
- If R1-M1 / R1-m3 / 01 / CODEOWNERS ride along, it is a delta round.

**Delta round 2 @8b3a8ed (code cdd3716, union 976edf6 with main c0c31a1/PR #34), 2026-11-14: PASS_WITH_FOLLOW-UPS, no new finding.** Section appended to the worktree record (uncommitted, LF, 687 lines); real checker pass @8b3a8ed (owned 61); sim 18/18 (J/K now `missing`).
- Closed: 01 (bare specifier, plus `export *` in platform/db which R1 never probed), 02 (CODEOWNERS; narrowing optional per D-ORCH-055), 05 (floor 2000, exit 78), 06. PR32-SEC-15 block restored byte-identical to main.
- Open: 03 LOW + 04 INFO (020-C), PR34-SEC-07 + R1-m5 (before TASK-026). Proposed D-SEC-PR38-02.
- R1-m1 kit: `m1probe.mjs` (4 authenticators x 6 sets x 16 header shapes + 404, raw socket, independent oracle) on head and previous head: head 0 mismatches, previous head 22 declared-lost (positive control). Transitions only no-store -> private.
- D-TASK020-46 (shared `.git/info/exclude` truncated): accepted. The git template is 240 bytes / 6 comment lines (`$(git --exec-path)/../../share/git-core/templates/info/exclude`). Also check `core.excludesFile`, `~/.config/git/ignore`, `status.showUntrackedFiles`.
- Fact: the checker reads base AND head CODEOWNERS, so lines added in the PR already count for its own record (owned went 47 -> 61).
- Two-dot `bdf009d..head` (37 owned) differs from the checker's three-dot count (22 since R1): the 15 extra are main-brought files.
- A Bash `run` re-invocation of the sim took >300 s once (host load): use `run_in_background` for sims.

Related: [[project-p5-pr32-route-pipeline]], [[project-p5-pr34-r2-harness]], [[project-p5-pr19-supersede]], [[project-security-review-conventions]]
