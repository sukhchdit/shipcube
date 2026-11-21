---
name: project-p5-pr67-picomatch-waiver
description: PR #67 picomatch GHSA-fc5q-39xc-vjpf audit waiver (D-SECAUDIT-01, expires 2027-02-12); check-audit watch-vs-waiver and DECISION_ID facts; record a750c97 on main; follow-up PR67-SEC-02 closure binding
metadata:
  type: project
---

**What happened.** GitHub reviewed GHSA-fc5q-39xc-vjpf on 2026-11-17 (picomatch `<= 4.0.7`, High, no patched version; 4.0.7 is the latest). Lane A `check-audit` then failed on every PR from 2026-11-18.

**What I did.**
- Opened PR #67 (`chore/audit-watch-picomatch`, worktree `../Shipqube-audit-picomatch`, head `1f9c81f`). It adds a **waiver**, granted 2026-11-18 and expiring 2027-02-12, plus `check-audit.test.ts` changes.
- Committed the record `PR-0067-audit-picomatch-waiver-security-review.md` and D-SECAUDIT-01 on main as `a750c97`. The verdict is PASS_WITH_FOLLOW-UPS.
- Lane A on the head showed `check-audit: PASS`, with the real osv-scanner and npm audit both matched.

**Facts that are not obvious from the brief:**
- **A watch entry never clears a High.** `check-audit` only adds a note for it. A High with no fix needs a waiver: a DECISIONS ID, `granted` not in the future, and `expires` at most 90 days later.
- **The decision ID must have a single area segment.** `DECISION_ID = ^D-[A-Z0-9]+-\d+$`, so `D-SEC-AUDIT-01` and `D-SEC-PRnn-xx` are invalid and make check-audit exit 2 on every PR. Use the `D-SECAUDIT-nn` form.
- **Adding a waiver breaks two tests unless they move with it.** These are the `committed.waivers == []` pin and the CLI tests that copy the committed register with a fixed `--now`; a future grant date makes them exit 2. PR #67 replaced the fixed date with `cliNow`, the register's newest grant date.
- **npm's `fixAvailable` can be a semver-major downgrade** (here `jest-util@26.6.2`). The gate still prints "fix available" and drops its "track it with a dated waiver" hint (PR67-SEC-03).
- **A change to `tools/ci/*.json` needs lane B `unit` evidence.** No path rule matches it, so `profiles.pr.always` applies.
- **The PR-0066 record's "dated audit/watched entry" route was wrong.** D-SECAUDIT-01 clarifies D-SEC-PR66-01 condition 2.

**Open items:**
- PR67-SEC-02 (LOW): the waiver is not bound to the dev closure. Add a `closure: "dev"` field or a lockfile-tuple test. Owner devops-engineer via senior-developer, by 2027-02-12.
- PR67-SEC-01: when picomatch ships a release above 4.0.7, run `npm update picomatch` and remove the waiver in the same PR.

**Re-checks on 2027-02-12, or earlier at a picomatch release:**
- The waiver expires on that date and lane A goes red again.
- Re-run the ReDoS probe: `+(*a)` against `a`×24 + `!` takes about 3.5 s on 4.0.7 and 2.3.2, while our `!(shared|ui)` / `!(pricing|shared)` stay linear.

**Process slips to avoid:**
- The main-commit subject "PR #67 …" fails commitlint `subject-case`, the same as the earlier `docs(sdlc): PR #64 …` commits. I ran commitlint after `;`, not `&&`, so it did not block. Lint the message before committing.
- I authored and reviewed the same change, so independence rests on the code-reviewer twin.

Related: [[project-security-review-conventions]], [[project-p5-pr10-ci-lane]], [[project-p5-wave0-supply-chain]], [[project-p5-pr2-lint-controls]]
