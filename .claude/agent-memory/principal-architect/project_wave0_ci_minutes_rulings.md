---
name: wave0-ci-minutes-rulings
description: D-ARCH-126..129 / ADR-0023 am. L (2026-11-14) — hosted CI minutes ruling after SPK-07 §6: push-scoped lane A light mode with verified proof inheritance, security-integration once per code tree on merge-candidate heads, production-closure lockfile rule, scans→ci-gate fold (two-step), forecast guards; measured run mix and lessons for reading GitHub run data
metadata:
  type: project
---

Ruling file: `docs/03-architecture/rulings/wave-0-ci-minutes.md`; ADR-0023 amendment L; platform.md §7.8 budget v2; risks v1.15 (R-ARCH-15 H until TASK-286 lands).

**Decisions (D-ARCH-126..129):**
- 126: lane A classifies the PUSH range (`github.event.before`→head), not the PR range; docs-only push = light mode (skip exactly the `env.CODE == 'true'` steps); code proof = step conclusions via the jobs API (CODE-gated required steps + scans gitleaks/Semgrep/oasdiff `success`) on a commit whose TREE diff to head is docs-only; a job conclusion is never a proof (light success can't chain); `cancel-in-progress: false` on PRs so a full run is never cancelled by a docs push (runs queue).
- 127: `security-integration` runs once per code tree, only when the security record check is `pass`/`not-required` (the record push IS the merge candidate — almost every green run this month was a `docs(security)` push); `package-lock.json` selects only for production-closure entry changes.
- 128: stage 2 (two-step, policy PR first because the base-ref policy pins topology): fold `scans` into `ci-gate`, sec-int `needs: fast-lane`, CODE-gate commitlint/actionlint/install; incremental fast lane = TASK-287. Proposed late tasks TASK-286 `cigatefold`, TASK-287 `fastlaneinc`.
- 129: Dependabot runs (`dynamic/dependabot/**`) are NOT billed on standard runners → exclude from `ci:minutes`; guards act on the FORECAST (70 % → tier-1 lane C only + P1/P2; 90 % → gates only but a planned tier-1 wave-end up to 95 %).

**Why:** measured 2026-11-01..14: 771 billed min, 123 PR runs at a flat 6.6 min (fast-lane 4.5 / scans 1.1 / ci-gate 1.0), 59 docs-only heads, 64 code pushes (21 unions), sec-int selected on 73 % of PRs on every push. Plan assumed 1.3 runs/PR and 15 security PRs. Budget v2: mechanisms alone ≈ 84 %, with incremental + process levers ≈ 64 %.

**How to apply:** when ruling on CI cost again, start from run-count levers (docs pushes, unions, per-push sec-int), not per-run tuning; keep every base-ref gate on every exact head; never trust a job colour as proof. Process levers (unions only when `main` conflicts/moved under tooling paths; one docs push per review round) are D-ORCH proposals — the orchestrator decides.

**Lessons:**
- `git show 'origin/branch:.github/workflows/ci.yml'` fails under Git Bash path conversion for dotted paths — prefix `MSYS_NO_PATHCONV=1`.
- Runs API: `.pull_requests[0].number` is often empty for closed PRs; classify runs by `head_commit.message` subject instead. `gh api --paginate ... --jq '... | @tsv'` into the scratchpad, then `cut`/`sort | uniq -c`.
- Required-gate `ifs` and `ci-gate needs` are pinned by the BASE-ref policy, so any topology or `if:` change on ci.yml is a two-PR change (policy first).
- GITHUB_TOKEN is not auto-exported to `run` steps: put `GH_TOKEN: ${{ github.token }}` on the lookup step only; `actions: read` is needed for runs/jobs API.
