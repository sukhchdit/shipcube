---
name: project-p5-task040b1
description: TASK-040 part 040-B PR 1 security rounds: R1 at a4aadd2e PASS_W_COND (D-SECPR040B1-01, 6b2c6a7f); R2 at 9d1687b1 (delta + merge-only of 0ccdd009) PASS_W_COND (D-SECPR040B1-02, main 5e13110a); PR040-SEC-10..12 closed, 13 routed to PR 2, new 14 INFO; open C4 incl. lane A gitleaks route (c)
metadata:
  type: project
---

**Round 1** of TASK-040 part 040-B, first PR = PASS_WITH_CONDITIONS, bound to `a4aadd2e` (record `docs/05-quality/security/PR-pending-TASK-040B1-security-review.md`, D-SECPR040B1-01, main `6b2c6a7f`). IDs continue the TASK-040 series (PR040-SEC-10..), not `PR40-SEC-nn`.

**Round 2** (2026-11-21) = PASS_WITH_CONDITIONS at `9d1687b1` (appended to the same record, D-SECPR040B1-02, local main `5e13110a`, not pushed). Covered C2 (delta `0ccdd009..9d1687b1`) and C3 (merge-only of the stacked merge `0ccdd009`).
- **Closed:** PR040-SEC-10 (D-ARCH-232 / ADR-0014 am. 18: `lease = max(30 s, timeout + max(D+T, 3T) + F + 5 s)`, 38.25 s at the defaults, 40 s as PR 1 composes it); -11; -12.
- **PR040-SEC-13** is routed to PR 2 (D-ORCH-167, D-TASK040-25), which I accepted. It stays due before G3 regardless.
- **New PR040-SEC-14 INFO** (= code review R2-n2 extended): pin (d) misses a `default` response, a `2XX` key, and a `+json` type the store refuses. Owner: senior-developer, at the latest PR 2.
- **Merge `0ccdd009` is pure:** tree `206bfdfb` = explicit-base merge-tree, raw equality 15/15. #81/#82/#83/#84 paths are 100 % identical at the head.
- **Open C4:**
  - (a) lane B `run-live75` at `9d1687b1`. A FAIL on only the D-ORCH-170 cases (PR080-SEC-07 three fingerprints, compose O-1) counts as a pass.
  - (b) **lane A gitleaks will flag `0ccdd009…:DECISIONS.md:generic-api-key:7697`.** #85 only baselines it for gitleaks-full, and lane A never reads the baseline. PR080-SEC-07 route (c) is needed: a commit-bound `.gitleaks.toml` entry in its own PR, or a supersede.
  - (c) hosted CI.
  - (d) the rename.
- **C5** holds.

**Why:** a new main merge, or any owned change after `9d1687b1`, voids the binding. PR 2 owes P-1..P-5, the purge, a class-only Pino IdempotencyLog, `admissionWaitMs` from the resolved admission options (an understated value gives 0 s margin, mutant m5), SEC-13 and SEC-14.

**How to apply:**
- Next 040-B work:
  - a merge-only round if main is merged again (the 5 checks of §6, Head row = new merge);
  - a supersede round if route (c) is done by supersede;
  - the PR 2 security round.
- Kit (session scratch `t040b1r2/probes/`, may vanish):
  - `p2r2-lease.mjs`: enumerates `run()` paths, production plus 2M random, mutants via `mk-mutants.mjs`.
  - `p5r2-pins.mjs` with `jest-hook.mjs` / `jest-stub.mjs`: runs a Jest test file in-process with real `expect` 30 and predicate mutants.
  - `gl-emu-noenv.mjs`: the faithful gitleaks emulator with a `.env*` pathspec exclusion.
  - `record-sim-r2.sh`: merge-ref form, `--base` = merge base.
- QG-040-C9 (TASK-187 re-auth tx not in the lease rows) is the architect's; the lease test types the rows by hand, so a new slot phase does not fail it.

Related: [[project-p5-task040]], [[project-p5-task041b]], [[project-p5-postmerge-80-84]], [[project-security-review-conventions]]
