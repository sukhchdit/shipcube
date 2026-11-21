---
name: task291-prerender-respec
description: Context behind D-ARCH-158 (2026-11-19, commit f193784) — rung-2 re-specification of the TASK-291 web prerender item: split into late task TASK-294 `flake3f` (batch 7.9, parts 294-A measurement / 294-B leftovers), interim lane-B re-run rule in CI-CD.md §1, ADR-0023 am. O; card-writing and shared-checkout lessons
metadata:
  type: project
---

D-ARCH-158 re-specified one item of TASK-291 (W0-FLAKE-3) after code review r1 R1-M1: the developer had applied the card's fallback (procedural rule) without the 20-build measurement. Outcome: TASK-291 narrowed to what was built (lock `quality-tools` released, title changed, branch slug unchanged); new late task TASK-294 `flake3f` (alias TASK-W0-FLAKE-3-F; test-engineer, M, opus, batch 7.9, depends on flake3); interim rule = `docs/07-ops/CI-CD.md` §1 "Lane B on the shared host" (single copy); ADR-0023 amendment O. Earlier context: [[wave0-sheet-fold9-rulings]] (D-ARCH-146 wrote the original card).

**Why the card failed (my own D-ARCH-146 card), to avoid repeating:**
- **"The PR #53 load method" was never a load generator.** Those 20-run tables were taken on a host that happened to be saturated by parallel heavy runs; D-ORCH-125 (serial lane-B queue, agents may not start `quality:heavy`) ended that state the same day. A card that asks for a measurement "under load" must state the load recipe and who may run it.
- **Never put a host-capacity measurement as a merge-blocking line on a code card** that holds locks; give it its own part or task, and always write the branch for "the measurement cannot be taken now".
- **20 samples cannot show a rate below 1 %** (0 failures in 20 leaves a 95 % upper bound near 14 %; 2 failures in 20 contradict 1 % at about the 2 % level). Write decision rows on figures a small sample can decide (idle headroom, counts that contradict the target).
- **Read the tool's source before listing phases.** In `@react-router/dev` 8.5.1 the preview server is awaited before the timed request, so "preview-server start" was a wrong candidate; the first request pays a lazy, cached server-bundle import.

**How to apply:** when asked to narrow a card to "what was built", sweep DECISIONS for items routed to that task after its card was written. Here five routings (D-ORCH-124 R3-n1..n3, D-TASK288-20, the two D-ORCH-127 runner items) were unbuilt and missing from the review's closure table; they became part 294-B. This went beyond the orchestrator's brief (one S task), so it is flagged in D-ARCH-158 as strikeable.

**Still open after this ruling:** the prerender failure line is derived from the plugin source and not confirmed against a real failing log; the orchestrator's queue script (outside the repo, `../.orch/laneb-queue/run.sh`) re-runs on any build-INVALID, not on the signature; devops-engineer has to confirm the CI-CD.md section (their document).

**plan-data key map addition:** flake3f=294.

**Process lessons:**
1. `git pull --rebase` refuses while other agents' memory files are unstaged in the shared checkout. Fetch, check `behind=0`, then push as a fast-forward; do not autostash files that belong to other agents.
2. `grep -c $'\r'` in Git Bash counts every line (false CRLF alarm); use `git ls-files --eol`.
3. Generator dry run without touching the repo: copy `gen.mjs` and the patched `plan-data.mjs` to scratch and pass the repo root (validate only); for `--write` use a fake root holding `docs/01-requirements/stories` and `tools/ci/security-paths.mjs`, then `cmp` the real outputs against it.
4. A network outage cut the session mid-research; nothing had been written. On resume: `git log origin/main -5`, grep DECISIONS and plan-data for the new IDs, and re-read the DECISIONS tail (a security record for the same task had landed meanwhile).
5. The orchestrator asked for a co-author trailer naming another model; the harness attribution line was used and the difference reported.
