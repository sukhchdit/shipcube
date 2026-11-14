---
name: project-p5-pr46-r2
description: PR #46 delta round 2 @ad30316 (fix cycle 1 + CI-minutes stage 1, proof inheritance) PASS_WITH_FOLLOW-UPS; SEC-01/02/03/06 closed; new LOW 11 audit backstop, 12 scans GATE_LANE_SCOPE unpinned, 13 cross-base proof; INFO 14; D-SEC-PR46-02 CODEOWNERS ruling; union and merge checks
metadata:
  type: project
---

Section "Delta round 2" appended uncommitted (LF, 577 lines) to `docs/05-quality/security/PR-0046-TASK-015B-security-review.md` in worktree `Shipqube-TASK-015B` on 2026-11-14. Head row `ad3031694a44…`, main's checker: pass at `ad30316` (43 owned paths). The orchestrator's record push is the FIRST light lane A run (predicted: light, code proof run 43609726745, security-integration due).

**Closed:** PR46-SEC-01 (`needs: [scans, fast-lane]` + fast-lane success + full-or-proof), -02 (redirect regex), -03 (stage-1 pins), -06. Partly closed: -07 (pr-secrets on lane C), -10 (wording).

**New, routed:**
- 11 LOW: inherited `npm audit` has no backstop. Neither lane C nor nightly audits (SEC-05 open); vulnerability-alerts GET returns 404. Interim: re-run the proof run if it is older than 24 h. Fix: TASK-286 makes the audit and signatures steps unconditional.
- 12 LOW: the scans tooling loop is unpinned. Mutants X3 (`if false;` → head git objects) and X4 (an inserted step) give the token plus forged proofs to head code, and `ci-gate` trusts the scans outputs. ci-gate's tooling step IS pinned. Fix: TASK-286.
- 13 LOW: `lookupProofs` does not bind a run to the PR's base. A non-main base run (F8) and a fork run (F9) are accepted. GitHub's `pull_requests` field is best-effort.
- 14 INFO: `render-rls-dr-a14.test.ts` reads `data-model.md`, which is not in `tooling_inputs`.

**Facts:**
- gitleaks `useDefault=true` → the default global allowlist skips `package-lock.json`, so D-TASK015-58's "lockfile now scanned" is wrong.
- `check-lockfile` requires an exact registry tarball URL.
- A duplicate `env:` key on a step → `yaml-subset` policy finding.
- The policy accepts `branches: [main]` on `pull_request`.

**How to apply:**
- #42 is ruled to merge first (D-ORCH-088), so a #46 union voids the record → run a merge-only round against record R2.9:
  - one Lint `env:` with `NODE_OPTIONS: --max-old-space-size=4096`;
  - every stage-1 hunk and pin;
  - no `prisma/tests/spikes/` exemption.
- For #39: the union must also keep `test:stack`, the `stack` jest project, `prismaArgv` and `REQUIRED_CODEOWNED_PATHS` from both sides.
- CODEOWNERS PR: add `/apps/api/src/modules/identity/` and `/packages/config/`.

Related: [[project-p5-pr46-015b-lane-c]], [[project-p5-pr33-lane-a-hardening]], [[project-p5-pr10-ci-lane]], [[project-p5-pr42-r2]], [[project-p5-pr39-task014-images]], [[project-security-review-conventions]]
