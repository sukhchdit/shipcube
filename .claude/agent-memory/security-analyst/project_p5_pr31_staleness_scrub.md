---
name: project-p5-pr31-staleness-scrub
description: PR #31 (staleness allow-list .claude/agent-memory/*/*.md + host-path scrub + pending-case gate, devops) R1 @69a997c PASS_WITH_FOLLOW-UPS; PR28-SEC-01/02 closed; PR31-SEC-01..05 (2 LOW, 3 INFO); .gitmodules ignore=all hides gitlinks from git diff; checks owed at #20/#24/#26/#30 evidence, TASK-015, G3
metadata:
  type: project
---

PR #31 review: `docs/05-quality/security/PR-0031-quality-staleness-scrub-security-review.md` (R1, 2026-11-13).
- **Head row names `69a997c`** (6 commits: code `15be779`, merge of main as of `a7bb07f`, two title commits, two evidence commits for `d6338a6` then `4f6a6c3`). 9 owned paths, all `tools/quality`. `.github`, `tools/ci`, `package.json`, lockfile byte-identical to base and to main (`tools/quality` on main is still `430208e`). Lane A run 43391844910: base-ref copy accepted run `20261113T0810Z_4f6a6c3`; only the record step was red.
- **Verdict PASS_WITH_FOLLOW-UPS.** PR28-SEC-01 and PR28-SEC-02 closed. PR28-SEC-03 items 1-5 done; item 6 (`.claude/` in the TASK-014 `.dockerignore` matcher test) still open. PR28-SEC-04 and PR23-SEC-03/04/05 unchanged.

**Findings:**
- PR31-SEC-01 LOW: `git diff --raw`/`--name-only` honour a worktree `.gitmodules` `ignore = all` (or `diff.ignoreSubmodules`), so the 160000 arm of the mode guard (and any gitlink in selection) is hidden; fix is `--ignore-submodules=none` on both calls in `check-evidence.mjs` plus a test. Next `tools/quality` change, before G3.
- PR31-SEC-02 LOW: mode guard lives only inside the staleness check; a memory-only PR selects nothing, so a symlink/exec/gitlink named like a note passes with no evidence; `MEMORY.md` is auto-loaded by the harness. Fix: lane A tree invariant (no tracked 120000/160000, 100755 only `tools/hooks/*`) in `tools/ci`, TASK-015, before G3. Repo has 0 symlinks/gitlinks, 2 hook scripts at 100755.
- INFO 03 test gaps (`*.md*` mutant survives the PR's 13-case table; pinned by the constant-equality test), 04 pending gate residuals (D- ID syntax-only, `v0.1.0-m0` enforced only by a `gate` run, silent removal of an entry), 05 scrub belt residuals (double-JSON-escape, percent-encoded drive, space in profile name, bare 8.3 segment) and no verifier-side host scan.

**Probe-confirmed facts:**
- 28-case table passes; 12 widened-glob mutants all killed by my table; 35 staleness scenarios through the real CLI all as predicted; old (base-ref) checker marks every note change stale (positive control).
- Memory-only PR now selects no suite (before: `unit`). Note plus `settings.json`, code, `.sh` or nested still select suites.
- Pending gate: `pr` never fails; `wave` reaches only `Wave-0 exit`; `gate` reaches all; a `decision` of any `D-...` syntax exempts "not yet implemented" but never "now implemented"; typo of the key name parses as `{}`; malformed entry exits 2.
- Committed run clean (0 hits); positive control: the withdrawn PR #28 run has the fragment. Scrub covers 19 of 23 spellings of this host's paths.
- **Merging main into the branch makes the old base-ref checker mark the evidence stale** (15 agent-memory paths); squash as is.

**Why:** These items stay live until #20/#24/#26/#30 commit evidence, the next `tools/quality` change, TASK-015 and G3.

**How to apply:**
- **Evidence commits of later PRs:** D-SEC-PR23-02 gate table plus a host-path scan row (counts only) and "no parked ID carried by a passing test" row; re-do any run made before #31 merged.
- **Next tools/quality change:** SEC-01 flag and test; SEC-03 table cases.
- **TASK-015:** SEC-02 tree invariant; optional SEC-05 verifier-side scan.
- **G3:** each pending entry's `decision` resolves in DECISIONS.md; gate transcript; SEC-P3-07 items 5 and 6.
- **Probe method:** reuse `scratchpad/review/PR-31-sec/probes` if it still exists (scen.mjs plumbing, stale-scen, select-scen, pending-scen, table-mutants, scrub-probe, hostscan, record-sim); `gl/gl-emul.mjs` is the Gitleaks emulator.

Related: [[project-p5-pr28-w0act1]], [[project-p5-pr23-lane-b]], [[project-security-review-conventions]]
