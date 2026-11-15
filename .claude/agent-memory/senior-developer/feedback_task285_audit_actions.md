---
name: task285-audit-actions
description: TASK-285 (2026-11-15) - a ruling's bootstrap file name can contradict the runner's sort rule; shadow-init fail-closed ripple; lane-test pins on file lists and approval dates; host-saturation evidence failures
metadata:
  type: feedback
---

TASK-285 (action CHECK widening, a new bootstrap file). Done solo. It took about 140 calls and 3 evidence worktrees; only run 3 passed.

**Why:** a ruling's names and claims are not checked against the tooling. Every new bootstrap file ripples into four places that are invisible from the task card.

**How to apply:**
- **Check a new bootstrap file name against the lane's sort rule BEFORE writing it.**
  - Two places refuse a new file that sorts before a released one: `tools/db/bootstrap.ts` (on existing databases) and `check-migration-immutability` (lane A).
  - D-ARCH-119 named `11-…`, but `90-audit-ddl-guard.sql` is released. I used `91-…` and recorded it as a decision for the architect to ratify.
  - Prove it with `checkBootstrapChanges([{status:'A',path}], baseFiles)` from `node -e`.
- **Verify ADR claims against the code.**
  - ADR-0007 am. 11 said "the contract enum already lists 20". The openapi enum lists 18.
  - I pinned the gap at compile time per enum (one type per source; a union of identical enums trips `no-duplicate-type-constituents`) and raised a change request to api-designer.
- **A new bootstrap statement form needs a KEEP rule in `tools/db/shadow-init.ts`.** The rendering fails closed, and `prisma.config.ts` renders the lane at config load, so every Prisma CLI run breaks. Add refusal fixtures next to the KEEP rule.
- **Existing tests pin the lane:**
  - `tools/db/bootstrap.test.ts` (the file list).
  - `bootstrap.int.test.ts`: `AUDIT_FILES`, the once-only test (delete the last file's ledger row first), the guard-plant lane copy (drop the later file too), and the out-of-order regex `[a-z-]+` (no digits).
  - `lint-migrations.test.ts`: the `today` date and the list of marked files.
- **ALTER of a CHECK on the partitioned audit parent propagates.** Partitions end with `conislocal=false`, `coninhcount=1`, and later `ensure_audit_partitions` partitions copy the new CHECK. The guard admits it under SET ROLE platform_audit_owner. The same statement as superuser without SET ROLE fails 42501 with the guard message.
- **Host saturation (D-ORCH-096):** evidence runs 1 and 2 failed only on `timeout expired`, P1001 and RustFS UNAVAILABLE, in suites I never touched. Two hours later the same head passed in 12 min.
  - Before burning a worktree, re-run the suspect files in isolation (37/37 in 35 s proved it was not my change).
  - Hold docker.lock for the whole evidence script (scratch `t285/run-ev3.sh`, with a trap release).
  - Instrument a hidden `tail` via stderr temporarily, then `git checkout` the file.
- **check-evidence needs the run committed.** It FAILs on an untracked run dir. Commit it, check, then fix the message with `reset --soft` + recommit (tree-equality check) before pushing.
- **The local lint OOM at 2048 MB is expected now.** ci.yml lint runs at 4096, so use `--max-old-space-size=4096` as the CI proxy.

Related: [[task025-audit-writer]], [[pr39-push]], [[lane-b-evidence-run]], [[pr42-fc2]]
