---
name: project-p5-pr33-lane-a-hardening
description: PR #33 (TASK-015 part 015-A: US-006 coverage gate, oasdiff, CODEOWNERS + bootstrap immutability, gitleaks baseline, lane B pin) R1 @3ed0484 PASS_WITH_FOLLOW-UPS; 9 earlier findings closed, PR25-SEC-01 half; PR33-SEC-01..08; probe facts; R2 delta checklist
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0033-TASK-015-security-review.md` (R1, 2026-11-13, uncommitted in main when written, 241 lines). Head row names `3ed048466667bff670610d1bd6f830253b9553c7`; the PR changes 28 owned paths. Code review R1 on the same head is CHANGES_REQUESTED (3 MAJOR), so a fix cycle moves the head and voids the record: **R2 is a delta round**.

**Verdict PASS_WITH_FOLLOW-UPS** (0 Critical/High/Medium, 3 LOW, 5 INFO). Closed: PR4-SEC-13 (items 1-3; item 4 ADR note stays with principal-architect), PR4-SEC-11, PR17-SEC-09, PR21-SEC-04, PR23-SEC-06 (as amended, D-ORCH-032, R2-n2/n3), PR24-SEC-04, PR24-SEC-06 (immutability half; content marker TASK-024), PR25-SEC-02, PR26-SEC-07. PR25-SEC-01 half: the 17-line baseline is exact, the gitleaks-full runner half is 015-B. PR10-SEC-08 not reopened (`.gitleaks.toml` untouched).

**New findings:** 01 LOW `commandLines` treats a line led by Unicode whitespace + `#` (NBSP) as a comment, bash runs it as a command (`<NBSP># || exit 0` skips the pinned verifier; probe M06 passes head and base checker; fix = ASCII-only blank/comment test + reject non-ASCII in pinned run:); 02 LOW oasdiff container uid 65534 cannot read the 0700 mkdtemp dir on Linux (exit 102 permission denied; chmod 755 fixes) = code review R1-M1; 03 LOW openapi pin is unanchored with no `env: {}` (trailing `|| true`, step-env image or `GATE_OPENAPI_BREAKING` swap pass), any pushed `v*` tag is the baseline (use `--merged <base>`), ADR record self-certifying (`Status: Proposed` passes, adr folder unowned); 04 INFO PR-controlled strings reach stdout (`::warning` line from a parameter name with a newline); 05 INFO `apps/*/react-router.config.ts`, `apps/*/app/routes.ts` (typegen evaluates them), `.prettierrc`, `.size-limit.json`, `tools/repo/*.test.ts` unowned; 06 INFO US-006 cases not in `unit.required_cases`, gate runs in no CI lane; 07 INFO shell-expanded npm command words (`npm $'x'`, `${V:-x}`) not recovered; 08 INFO gitleaks-full runner requirements.

**Probe facts (re-verify before relying):**
- npm 11 `deref`: only `exec`, `x`, `exe` mean exec. `npm exec --no` does one packument GET but never fetches a tarball, even with `npm_config_yes=true` / `npm_config_package` in the env (local registry stub proves it). 360 generated spellings: 0 mismatches against the new rule.
- gitleaks v8.30.1 `.gitleaksignore`: a commit-less `path:rule:line` line suppresses that line in every commit (16 of 17 remain); abbreviated commit, upper case, shifted line do not suppress; CRLF is accepted. The 17 baseline lines equal the first-parent and the whole-ancestry fingerprint sets of main (tip `c48910d`).
- tufin/oasdiff v1.35.0: pinned digest `82b1840a...` is the OCI index (body hash equals the pin), created 2026-10-28, Apache-2.0 label, alpine, entrypoint `/usr/bin/oasdiff`; v1.36.0 and v1.37.0 exist.
- Docker Desktop: `-v /tmp/x:/d` binds a path inside the Linux VM, so real POSIX modes can be probed there (chown 1001, chmod 700, then the exact `--user 65534:65534 --cap-drop ALL --mount ...readonly` args).
- Jest 30.5.2: with `modulePathIgnorePatterns` containing `/__mocks__/` in a `projects` config, planted bare and scoped manual mocks are ignored; without it both replace the real module.
- `patternToRegExp` old regex needed a leading folder for `**/x` (root `__mocks__/x` was unowned); new one matches the root. Ownership: 994 of 1608 tracked paths (516 gained, 0 lost).
- Real bash (Git Bash 5.2) runs a NBSP-led line as a command; trailing NBSP after `set -euo pipefail` aborts with exit 2 (not exploitable).

**Effects on the queue:** after #33 merges, #20 and #32 (`apps/api/src/platform/**`), #29 and #16 (workspace `package.json`) need a security record on their next round. Every open PR must merge main for the new lane B pin (their ci.yml gets rejected by the new base checker otherwise).

**R2 delta checklist (after the fix cycle):** commandLines ASCII fix against M06 (`probes/mutants.mjs`); openapi-breaking: part L exit 0, mode test, tag `--merged` (O10 must fail), exact pin + `env: {}` (M25/M26/M28 flagged), output neutralised (O11), the persistence fix of R1-M2 (a sanctioned break must not turn later PRs red); coverage scopes of R1-M3; heavy wiring test; fresh lane B evidence (merging main stales `2e17530`); rerun `probes/record-sim.mjs` (25 scenarios) with the new head.

**Why:** the openapi-breaking gate becomes live automatically at the first `v*` tag (`v0.1.0-m0`), and the lane A pins are the only machine control over owned `ci.yml` edits besides the record.

**How to apply:** at R2 name the final head in a new `| Head |` row, keep a single final `| **Verdict** |` row, and run the 25-scenario simulation; for 015-B check the gitleaks-full runner against PR33-SEC-08 and PR25-SEC-01.

Related: [[project-p5-pr10-ci-lane]], [[project-p5-pr25-ci-followups]], [[project-p5-pr23-lane-b]], [[project-p5-pr31-staleness-scrub]], [[project-security-review-conventions]]
