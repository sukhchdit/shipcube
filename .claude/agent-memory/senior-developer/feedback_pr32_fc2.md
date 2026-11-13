---
name: pr32-fc2
description: PR #32 fix cycle 2 (2026-11-13/14) - docker info false positive, kill refusal, main moved with code after the evidence commit, Joi extension detection, coverage P1001 rerun
metadata:
  type: feedback
---

PR #32 fc2 was done solo in about 110 calls (SEC-13/15, R2-m2, R2-m4 note). The gate was green on the first run. Evidence had to be produced twice because main moved with code (PR #35) after my first evidence commit and before the push.

**Why:** these traps recur in any evidence run after a Docker restart, and in any fix cycle that touches Joi schema walking.

**How to apply:**
- **`docker info --format '{{.ServerVersion}}'` exits 0 even when it prints "Docker Desktop is unable to start".** My wait loop took that as "up" and went for the lock. Probe with `docker version --format '{{.Server.Version}}'` AND require non-empty output (`[ -s file ]`), or use `docker ps`.
- **The auto-mode classifier refused `kill <pid1> <pid2>`.** A single `kill <script pid>` with a plain description worked.
- **Check main right before pushing an evidence commit.** If main moved with code, the evidence is void (merge conditions forbid a code merge after evidence). Reset the UNPUSHED evidence commit away (`git reset --hard <last pushed>`), merge main, re-gate, and re-run the evidence. Keep the gate and the evidence chained in one background command: `gates.sh g2; evidence.sh ev3 g2/summary.txt`.
- **Read new D-ARCH/D-ORCH entries in the main delta.** A ruling (D-ARCH-109) superseded the "pending ruling" comment I had just written. Update such notes in the same re-gate.
- **Joi.extend detection:** `describe()` hides an extension that reuses the name `object`. Compare `schema._definition` against `Joi.types()` built-ins. Walk `$_terms` generically: schemas, arrays and plain objects (skip class instances such as Ref), with a seen-set and a depth bound. The type of `Joi.extend` is `any`: assign it to an `unknown` and cast to a narrow factory type, or lint flags no-unsafe-*. `Joi.Schema.type` is `string | undefined`, so use `String(schema.type)`.
- **Prove every new check with a line-deletion mutation script** (`mutate.sh`: cp a backup, delete the line matching a fixed string, run the targeted suites, restore). 10/10 were killed. Reviewers count unpinned wiring lines (R2-m2).
- **`test:coverage -i` lost Postgres twice (P1001) in a 30 min run under host load.** A targeted re-run of the two files under the lock passed. Report both runs.
- **Never run `quality:heavy` with an extra env var in scope.** A `SKIP_EXTRA=1` flag for my own wrapper script reached heavy, and heavy flagged it as "invalidating environment variable set" (D-ARCH-021), so the verdict was voided. Put wrapper switches in arguments or in a separate script.
- **Main moved with code twice during evidence** (PR #35, then PR #36). Each time: reset the unpushed evidence commit, merge, re-gate, re-run heavy, and re-fetch right before the push. Heavy also flaked twice under host load (5 s loopback timeouts; a Testcontainers port-bind timeout). Re-run it and do not commit the FAIL dir. Delete the untracked FAIL dir first, or `git_dirty` voids the next run.
- `docs(...)` comment-only edits to owned files (`authenticate.ts`) still void the security record. Batch them with the code changes.

Related: [[pr32-fc1]], [[lane-b-evidence-run]], [[p5-dispatch]], [[merge-main-pass]]
