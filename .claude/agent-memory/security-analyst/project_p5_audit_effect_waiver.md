---
name: project-p5-audit-effect-waiver
description: effect GHSA-7589-6fvf-x4pw waiver D-SECAUDIT-02 (expires 2026-12-18, forcing a Prisma bump or a scoped override); Prisma pins effect 3.20.0; PR67-SEC-02 closed by a lockfile-closure test; picomatch advisory withdrawn; record on main f2fd4eeb under a pending name
metadata:
  type: project
---

**The advisory.** GHSA-7589-6fvf-x4pw (effect `<= 3.22.0`, patched in 3.22.1, ReDoS in `Schema.TemplateLiteral`) has failed lane A since 2026-11-20.

**The routing premise was wrong.** The patched 3.22.1 to 3.22.4 date from July to October 2026, so they clear min-release-age. The real blocker is `@prisma/config` 7.10.1, which pins `effect: 3.20.0` exactly. So do its dev line 8.1.0-dev.12 and 7.9.1-dev.1, and no newer stable exists. `@hookform/resolvers`' optional `^3.10.3` peer dedupes onto the same tuple, so an in-range bump cannot remove 3.20.0.

**What I delivered (2026-11-20):**
- **Branch.** `chore/audit-waive-effect`, local commit `67c4c04` on `cb2ed535`, worktree `../Shipqube-audit-effect`. It was **not pushed**: the coordinator queues lane B, pushes, then runs the draft → rename → merge-ref → ready flow.
- **Change.** The waiver (granted 2026-11-20, expires 2026-12-18), an `it.each` with one due-date row per waiver, and a `[PR67-SEC-02]` test: no waived package may have a production tuple in the committed lockfile. That test closed PR67-SEC-02.
- **Record and decision.** `PR-pending-audit-effect-security-review.md` and D-SECAUDIT-02, on main as `f2fd4eeb`. The coordinator must rename the record to `PR-<n>-…`; the sim shows the pending name fails.
- **PR body.** In `../.orch/records/PR-pending-audit-effect/pr-body.md`.

**Forcing plan by 2026-12-18 (owner senior-developer):**
1. Bump Prisma once a stable `@prisma/config` allows effect >= 3.22.1 and is 7 or more days old.
2. Otherwise add `overrides: { "@prisma/config": { effect: "3.22.x" } }`. 3.22.5 is installable from 2026-11-26T21:22Z. This needs full lane B.
3. Remove the waiver, its row and its pin in the same PR.

**Facts:**
- effect is `devOptional`. The api and worker runtime stages use `--omit=dev --omit=optional`, so they do not ship it.
- The Prisma CLI images (`prisma/Dockerfile`: bootstrap, migrate, seed) and `deps:rebuild` do load it, but `@prisma/config` uses only Struct and String schemas, with 0 `TemplateLiteral`.
- Probe (child processes): the advisory template takes 1.7 s at n=2000, growing cubically. Prisma's real `loadConfigFromFile` stays at about 114 ms with 50,000-character strings.
- **GHSA-fc5q-39xc-vjpf (picomatch) was withdrawn on 2026-11-18T15:38Z.** The D-SECAUDIT-01 waiver now matches nothing and is kept as a hedge (EFFECT-SEC-02 INFO).
- EFFECT-SEC-03 INFO: "dev closure" includes devOptional. Any new runtime stage must keep `--omit=optional`.

**Process lessons:**
- **Another agent (the PM) had uncommitted DECISIONS.md edits.** I staged only my entry by building HEAD-blob + entry with `git hash-object -w --path=… --stdin` and `git update-index --cacheinfo`, then appended the entry to the working tree as well. Their edits stayed unstaged and intact. Never `git add` the whole file in that situation.
- **The scratch directory was wiped mid-task again.** My probe, audit JSON, sel and commit-message files vanished. Keep results in the record as you go.

**Status 2026-11-20:** the waiver merged as PR #74 (record `PR-0074-audit-effect-security-review.md`). TASK-295 (route 2, override to 3.22.4) passed security round 1 at `5edc54f5`. EFFECT-SEC-01 closes, and D-SECAUDIT-02 is discharged, when that PR merges. See [[project-p5-task295]].

Related: [[project-p5-pr67-picomatch-waiver]], [[project-security-review-conventions]], [[project-p5-task295]]
