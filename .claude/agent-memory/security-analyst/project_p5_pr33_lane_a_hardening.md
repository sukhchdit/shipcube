---
name: project-p5-pr33-lane-a-hardening
description: PR #33 (TASK-015 part 015-A: US-006 coverage gate, oasdiff, CODEOWNERS + bootstrap immutability, gitleaks baseline, lane B pin) R1 @3ed0484 + R2 @d3a46a2 both PASS_WITH_FOLLOW-UPS; R1 findings 01-04 closed; open INFO 03(iii),05-10; probe facts; what a further round needs
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0033-TASK-015-security-review.md` (R1 241 lines + `## Round 2 (head d3a46a2, delta + merge)` appended 2026-11-13, 386 lines, CRLF working tree, uncommitted in main when written). R2 has its own `| Head | d3a46a20... |` row and final `| **Verdict** | **PASS_WITH_FOLLOW-UPS.** ... |`. The PR changes 29 owned paths (28 + `tools/quality/heavy.test.ts`); code review R2 (APPROVED_WITH_NITS, R2-m1/-n1..-n4) agrees with my R2.

**R1 (@3ed0484):** 3 LOW, 5 INFO; closed PR4-SEC-13 items 1-3, PR4-SEC-11, PR17-SEC-09, PR21-SEC-04, PR23-SEC-06, PR24-SEC-04, PR24-SEC-06 (immutability half), PR25-SEC-02, PR26-SEC-07; PR25-SEC-01 artifact half closed, runner half 015-B.

**R2 (@d3a46a2):** CLOSED PR33-SEC-01 (ASCII-only `commandLines` + `NON_ASCII` in every pinned run and every non-comment ci.yml line; 18 code points, bash control), -02 (0755/0644; Linux proof = lane A run 43440981589 smoke on ubuntu-24.04: `smoke ... 0 change(s)`, `PASS: no release tag`; docker args byte-identical to R1), -03 (i) (exact pins, `env: {}`, workflow `OASDIFF_IMAGE` = base-ref constant, `gate-env`, `--image` = script constant) and (ii) (`git tag --merged <base>` + strict semver; fuzz 300k pairs 0 mismatches vs the `semver` pkg), -04 (`clean`; R1 script gives 1 `::` line, head 0). Residual PR33-SEC-03 (iii) now INFO (PR-authored Accepted ADR; ADR dir and openapi.yaml unowned; O7f/O7h pass). New INFO PR33-SEC-09 (unset `GATE_*` => `node ""` exits 0, loops/position unpinned; extends PR17-SEC-08 and code review R2-m1; owner 015-C) and PR33-SEC-10 (oasdiff image bump impossible through lane A, code review R2-n1; owner before first bump). Open as routed: SEC-05, -07 (015-C), -06 (split-out coverage hook, D-ORCH-047, before TASK-025), -08 (015-B), PR25-SEC-01 runner half (015-B). 35-scenario record sim all as expected; real oasdiff image NOT run in R2 (Docker engine hung after the host disk filled; lane A log is the proof).

**Probe facts (re-verify before relying):**
- `node ""` (empty script path) reads the script from stdin and exits 0 at EOF (Node 24.22.3); with stdin it runs it. `"${X:?msg}"` aborts. Same for every `node "$GATE_*"` step.
- npm 11 `deref`: only `exec`, `x`, `exe` mean exec; `npm exec --no` never fetches a tarball even with `npm_config_yes`/`npm_config_package` set.
- gitleaks v8.30.1 `.gitleaksignore`: a commit-less `path:rule:line` suppresses that line in every commit; abbreviated commit, upper case, shifted line do not; CRLF accepted; the 17 baseline lines equal the first-parent and whole-ancestry fingerprint sets.
- tufin/oasdiff v1.35.0 pinned digest is the OCI index (body hash equals the pin), uid 65534 cannot read a 0700 mkdtemp dir on Linux (exit 102) but reads 0755 dir + 0644 files.
- Jest 30.5.2: `/__mocks__/` in `modulePathIgnorePatterns` stops planted bare and scoped manual mocks.
- Bash runs a U+00A0/U+2000-200A/U+3000/U+1680/U+202F/U+205F-led `# || exit 0` line as a command (exit 0, next command skipped); U+200B/U+180E are not JS `\s`. The YAML subset parser refuses U+0085/2028/2029, bare CR, BOM anywhere including comments.
- `latestReleaseTag` trims each listing line (git tag names cannot hold blanks anyway).

**Method notes that worked in R2:** mutation matrix script over `checkWorkflow(...,{requiredGates:true})` with head, R1 head and main checkers side by side (81+9+6 edits); text-patched copy of `openapi-breaking.mjs` (swap the `spawnSync('docker', ...)` target for a node stub) gives the real git/tag/ADR/clean logic without a daemon, and the R1 script as positive control; base-ref `check-evidence.mjs` (origin/main copy) on a `git clone --shared` of the head with only ajv + 4 deps copied into `node_modules`; `gh run view <id> --repo sukhchdit/shipcube --log` then grep the step name for the Linux proof.

**Why:** the openapi-breaking gate becomes live automatically at the first `v*` tag (`v0.1.0-m0`); lane A pins are the only machine control over owned `ci.yml` edits besides the record.

**How to apply:** a further round after any new fix commit: owned-path edit voids the record (clause (d)); evidence must be fresh on an ancestor if code changes; for 015-B check the gitleaks-full runner against PR33-SEC-08 and PR25-SEC-01; for 015-C check PR33-SEC-09 (pin the gate-tooling loops, `${GATE_X:?}`), -05, -07, -03 (iii); watch for the first oasdiff bump (SEC-10).

Related: [[project-p5-pr10-ci-lane]], [[project-p5-pr25-ci-followups]], [[project-p5-pr23-lane-b]], [[project-p5-pr31-staleness-scrub]], [[project-security-review-conventions]]
