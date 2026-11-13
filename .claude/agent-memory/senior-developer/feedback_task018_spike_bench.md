---
name: task018-spike-bench
description: TASK-018 SPK-04 benchmark spike (2026-11-13) — check-evidence owns docs/05-quality/*/runs, DECISIONS append-conflict recipe, Jest OOM, benchmark brief that finished in 62 calls
metadata:
  type: feedback
---

**A single, sharply-briefed opus performance-engineer finished a benchmark spike in 62 tool calls.** The brief fixed the file layout, the DB setup order, the exact line ranges to read ("do NOT read ADRs"), the arms and the lock-helper script. It asked for one harness commit before the final run (so the evidence names a real SHA) and left docs/evidence uncommitted for me.

**Why:** Earlier specialists stopped at the turn limit when they had to re-derive the specs themselves.

**How to apply / pitfalls:**
- Since TASK-011 merged (PR #23), `quality:check-evidence` (lane A, base-ref copy) governs `docs/05-quality/{tests,security,performance}/runs/`. Run IDs must be `YYYYMMDDTHHMMZ_<sha7>` (no seconds), `summary.json` must follow the heavy-run schema plus JUnit, and every changed run dir is evaluated. Put non-lane-B evidence (spikes) elsewhere, e.g. `docs/05-quality/performance/spikes/SPK-0x/` (D-TASK018-05). Run `node tools/quality/check-evidence.mjs --root . --base <main> --head <HEAD> --profile pr` on COMMITTED head before pushing.
- DECISIONS.md append-vs-append merge conflicts: a generic "theirs then ours" marker resolver mangled entries, because git aligned shared `- **Decision:**` lines. Instead, rebuild the file as `git show origin/main:DECISIONS.md` + our pure-append block (bytes after the base file's length; check with `cmp -n`), then verify `git diff origin/main -- DECISIONS.md` has 0 removed lines.
- Bash heredocs with apostrophes or backticks fail even when quoted ('EOF'). Write long text with the Write tool, then `cat >>`.
- `npm run test:unit` on a loaded host: Jest workers crashed with out-of-memory errors (16 suites). `-- --maxWorkers=3` re-run was green. Report both runs.
- The docker.lock can be held for 10+ minutes by others. Wrap gitleaks/runs in `timeout` only around the wait, or run them in the background and poll `== exit` in the log.
- Docker Desktop: a k6 container reaches a host server bound to 127.0.0.1 via `host.docker.internal`. No 0.0.0.0 needed.
- Benchmarks on this host are noisy (other agents). SPK-03's RTT of ~1.1–1.7 ms makes audit overhead round-trip-dominated, so ask for per-phase timings and round-trip counts, not only k6 latencies.

Related: [[p5-dispatch]], [[merge-main-pass]], [[lane-a-pr-hygiene]]
