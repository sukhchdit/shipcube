---
name: project-p5-postmerge-80-84
description: D-SECPOST-01 post-merge review of #80-#84 on main (88fd7360, unpushed) PASS_W_COND; union/squash proofs, #84 28-bump dependency review, LOW POST-SEC-03 repo-advisory gate, O-1 #49 compose Valkey 9.1; open C1-C3
metadata:
  type: project
---

D-SECPOST-01, 2026-11-21. The user merged #80-#84 with CI billing-blocked (D-ORCH-162). Record `docs/05-quality/security/POST-MERGE-2026-11-21-security-review.md` + DECISIONS entry, committed on main `88fd7360`, not pushed. The Head row is `3c4d9a6d`.

**(a) Merges:**
- Every squash equals `merge-tree <parent> <PR head>`, clean.
- The union heads are pure unions: `2805c809` (#81), `22f69a82` (#82), `05e1e9da` + `93a14e44` (#83).
- #81 and #82 were already covered by the parallel D-SECPR080-03 / D-SECPR041-04 (`934bb0f1`); I reused them.
- #83's C5 title conflict is a token-level three-way merge.
- Owned paths: 39 / 27 / 27 / 21.

**(b) #84:** 151 new tuples (67 prod), all policy checks passed.
- The lockfile was built on `0b1efbb2` and GitHub merged it into `a93a6113`. The result is the exact leaf union of 868 + 7 leaves.
- `npm ls --package-lock-only` flags only the `effect@3.22.4` override artefact (TASK-295), at base too.

**Findings:**
- **POST-SEC-01 INFO:** express-rate-limit GHSA-cppf (≤ 8.7.4). Not reachable: we import `ipKeyGenerator` only. Bump after 2026-11-25T23:01Z.
- **POST-SEC-02 INFO:** cron-parser GHSA-7jm7 (hang). Not reachable: the scheduler port takes `{every}` only. bullmq ≥ 6.7.8 after 2026-11-26.
- **POST-SEC-03 LOW:** `check-audit` sees the global DB only.
  - Repository-only vite Critical, otel/resources High and nodemailer Mediums sat on main; #84 fixed them.
  - Fix: `tools/ci/repo-advisories.mjs` in lane C. Owner devops-engineer, before G3.
- **POST-SEC-04 INFO:** migrations out of name order (#83's 20261120 after #81's 20261121). The three are independent. TASK-034's rule closes it.
- **POST-SEC-05 INFO:** bullmq 6.7.5+ calls `span.recordException`. TASK-214 must redact.
- **O-1:** #49 moved compose Valkey to 9.1 while the harness stays on 8.1. `compose-stack.test.ts:95` fails. Route to devops.

**Why:** these are the replacement evidence for merges made without CI. G3 needs C1-C3 closed.

**How to apply:**
- **C1:** cite the lane B main run (`run-live70.sh`, `--base a3c0b1af`) when it lands. Expected reds outside the scope: the PR080-SEC-07 gitleaks pair and the compose-stack failure (O-1).
  - Interim green: TASK-044 run `20261121T1512Z_3326231`, which had #84's versions installed.
- **Dependabot groups:** query GitHub repository advisories for every direct bump (`gh api repos/<o>/<r>/security-advisories`).
- **TASK-052 notes:** pin the jose verify options; test the cookie 2.0.2 serialisation of `__Host-rt_web`.

**Kit** (session scratch `post/scripts/`):
- `lockdelta.mjs`: three-way leaf proof.
- `regcheck.mjs`: registry integrity, tarball, licence, age, signatures, with a tampered control.
- `osv.mjs`: OSV querybatch with controls.
- `repoadv.mjs`: `gh` repository advisories.
- `union.mjs`: squash and union proofs with `merge-file --union`, raw-diff equality and controls.
- `owned.mjs`, `hostscan.mjs`.
- A `--shared` sparse clone runs main's `tools/ci` gates with `--root`.

Related: [[project-p5-task080]], [[project-p5-task041]], [[project-p5-task051]], [[project-p5-task040]], [[project-p5-task295]], [[project-p5-task042]], [[project-security-review-conventions]]
