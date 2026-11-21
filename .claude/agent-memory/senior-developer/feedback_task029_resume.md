---
name: task029-resume
description: TASK-029 resume to PR #56 (2026-11-16) - audit an inherited branch against the sheet, testcontainer wait instead of docker.lock, harness backgrounds long waits, api timeouts under load
metadata:
  type: feedback
---

Resuming TASK-029 (6 commits from an interrupted session) took about 75 calls to reach PR #56, with a first-time lane-B PASS. Lane A came back as expected: the scans job had only the security-record step red (33 security-owned paths), and fast-lane ran long.

**Why:** an inherited branch looks finished. The value lies in auditing it line by line against the sheet AC, not in re-running it.

**How to apply:**
- **Read the tx slot `run()` against REQ-AUDIT-010 first.** The inherited code wrote FAILED entries only when the handler transaction threw. A 409 from `load` or a 5xx from `call` went unaudited. The fix was one try block, red-green in `capture.api.test.ts`.
- **The prior session's numbered D-TASK029-xx list was lost with the scratchpad.** Only `-05` was cited in code. Rebuild the list from the code for the handoff, and write decision IDs into commit bodies so they survive.
- **Inherited commits can fail `format:check`** (here `writer.test.ts`). Run all four gates before trusting the branch.
- **Waiting for the docker slot:** the brief rule is "no foreign testcontainers in `docker ps`" (grep `testcontainers|ryuk|postgres:18|valkey|rustfs`; other projects' postgres:16 containers stay running). Put the wait loop in the evidence script after npm ci. The wait took 8 min.
- **The harness moves any Bash call to the background after about 180 s,** even with a 600 s timeout. Use `timeout 170` until-loops, or rely on the completion notification.
- **Plain `npm run test:api` with workers timed out 2 to 10 unrelated suites under host load.** Heavy runs api in band: 160/160.
- **The production capture has no tokeniser or UA parser** (TASK-028). No audited route is mounted yet, so nothing fails today. Flag it as a follow-up in every audit PR until TASK-028 wires it.

**PR #56 fc1 (2026-11-17): about 70 calls; lane B PASS on the first try; lane A fast-lane green, scans red only on the record step.**
- **Bash heredoc `\\u0000` inside a JS template became a literal NUL in the source file.** Write edit scripts with the Write tool, and spell control characters in source as `String.fromCharCode(0)`. Note that `grep -c $'\x00'` matches every line (an empty pattern); test for NUL with node `includes(String.fromCharCode(0))`.
- **Never run `jest <folder>` without `--selectProjects unit api`:** it also starts the integration suites and overloads the host (70 false failures).
- **Through createApp, the authorise slot mounts before the tx slot,** so a mount-time refusal from the denial path shows up first.
- **The ev worktree keeps the previous run directory untracked.** Remove it before `git checkout` to a head that tracks it.

**PR #56 merge-main for the P1 overlap with #54 (2026-11-17):** git merged it clean and `--remerge-diff` was 0 lines; I explained that in the merge commit body, amended before the push.
- **Two lane-B FAILs were environmental:** a network outage broke SEC-TC-64 `deps:rebuild` (ENOTFOUND binaries.prisma.sh), and the api-cases loopback test flaked. Move a failed run dir to `scratchpad/failed-runs/` and rerun.
- **Stage-2 ci.yml (PR #59) has no `scans` job.** The security-record step now sits in `ci-gate`.
- **Push budget (D-ORCH-119):** push once, after the local gates and check-evidence pass.

Related: [[pr54-evidence-push]], [[lane-b-evidence-run]], [[task025-audit-writer]]
