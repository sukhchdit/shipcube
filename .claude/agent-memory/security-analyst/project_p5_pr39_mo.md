---
name: project-p5-pr39-mo
description: PR #39 (TASK-014) merge-only round @ea1e010 (union with PR #42) PASS_WITH_FOLLOW-UPS; new INFO PR39-SEC-14 (tooling image test-only closure + dangling links); #46 second-merger checklist; D-SEC-PR39-09 proposed
metadata:
  type: project
---

Record section "Merge-only round (union with PR #42, head ea1e010)" (MO.1-MO.12) appended uncommitted to `docs/05-quality/security/PR-0039-TASK-014-security-review.md` in worktree `Shipqube-TASK-014` on 2026-11-15 (LF, 1293 lines). Proposed D-SEC-PR39-09.

**Verdict PASS_WITH_FOLLOW-UPS.** The R2.13 checklist was met:
- `018dfa7` equals `git merge-tree` outside `ci.yml` and `values.test.ts`;
- `ci.yml` equals main byte for byte (one heap line), so it has left #39's diff;
- GUARDS has 15 entries;
- `14f3ea7` only adds the `DB_TENANT_*` variable literals;
- the lockfile delta equals the round-2 set (the `tsx` leaf);
- layer sums equal the stack: worker 296.2 MiB = 98.7 %;
- range gitleaks 71 commits: 0 findings, and the pre-#45 control gives 2.

**New INFO PR39-SEC-14 (CWE-1164, A05).** The tooling image keeps the `prisma` devDependency `@platform/audit` as a dangling link, plus an unused `canonicalize` 5.1.0 (68 top-level packages). It also has 5 dangling `.bin` shims of pruned packages (`tsc`, `tsserver`, `pglite-server`, `safe-regex2`, `node-which`). Owner: devops with PR39-SEC-12. The fix is `rm` + `find -xtype l -delete` in the build stage, a `prune-deps --omit-dev` option, and a stack assertion.

**Sequencing.**
- PR #46's local fix-cycle-2 head `0f17495` unions cleanly with `ea1e010`.
- The overlap is `jest.config.ts`, `package.json`, `check-workflow-policy.{mjs,test.ts}` and `rebuild.mjs`.
- If #46 merges first, the record is voided (sim S8). Whichever PR merges second needs a merge-only round.

**Probe gotchas learned:**
- `find -perm -0002` lists every symlink (mode 777, ignored by Linux). Use `-type d` or `! -type l` for real writability.
- `docker history --human=false --format '{{.Size}}'` summed gives the stack test's layer sum exactly. `image inspect .Size` does not (containerd store).
- A lock waiter that sleeps 5 s lost the `docker.lock` race twice to other agents. One that sleeps 2 s got it.

**Kit (session scratch `review/PR-39-sec-mo/`):**
- `lockdelta.mjs` (set-equality of leaf deltas plus a control);
- `record-sim.mjs` (10 scenarios, including a #46-first squash union);
- `hold.sh` / `hold2.sh`;
- `find/links.sh`, `find/perm.sh`;
- `gl-prep.mjs`, `fill.mjs`.

**How to apply.**
- **Second merger of #39/#46:** apply MO.8.
- **Activation PR:** check PR39-SEC-10/11/12/14.

Related: [[project-p5-pr39-r2]], [[project-p5-pr39-task014-images]], [[project-p5-pr46-r2]], [[project-p5-pr45-gitleaks-allow]], [[project-security-review-conventions]]
