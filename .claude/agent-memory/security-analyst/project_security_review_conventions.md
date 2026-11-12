---
name: project-security-review-conventions
description: How security findings are expressed and routed in this project (OWASP 2021 codes, severity rule, read-only on ADRs, npm registry checks work from the host)
metadata:
  type: project
---

Findings use the CLAUDE.md §11 scale with CWE and OWASP Top 10:2021 codes (threat-model.md uses 2021 codes, e.g. A10 = SSRF; keep consistent). Severity matrix from threat-model.md §1: Impact×Likelihood, C×H=CRITICAL, C×L/M or H×M/H=HIGH, H×L or M×M/H=MEDIUM, else LOW. Security-analyst never edits ADRs/requirements: findings go to principal-architect (technical) or product-manager (functional), and proposed decision text is handed to them to log in DECISIONS.md.

**Why:** Orchestrator instructions for P3 (read-only scope, no commits, no human questions); consistency with threat-model.md lets quality-gatekeeper trace IDs.

**How to apply:** Registry checks (`npm view <pkg> license version time.modified --json`) work from the Windows host when prefixed with `export PATH="$APPDATA/fnm/aliases/default:$PATH";` (D-ORCH-002) — no need to spawn dependency-auditor for spot checks before a lockfile exists. Notable licence facts found 2026-11-12: caniuse-lite is CC-BY-4.0, spdx-exceptions CC-BY-3.0 (stale), argparse 3.x is PSF-2.0, nodemailer MIT-0, tslib 0BSD, lru-cache BlueOak-1.0.0.

**dependency-auditor hits its 30-turn limit.** A 4-task dispatch on 2026-11-12 (age sweep, provenance, maintenance, gitleaks) stopped before it reported. Its scratchpad outputs (`sweep-stdout.json`, `packuments-condensed.json`, `gitleaks-out/`) were still usable.
- Give it at most 2 tasks per dispatch.
- Or run the licence, audit and maintenance checks yourself with Node scripts; this is fast.
- gitleaks works via the Docker image with `--redact`. In Git Bash, prefix it with `MSYS_NO_PATHCONV=1`, otherwise `/repo` is rewritten to `C:/Program Files/Git/repo`. For worktree commits, mount the main repo, which holds the shared object store, and use `--log-opts=<base>..<head>`.
- Semgrep is not installed on the host.

Related: [[project-p3-security-conditions]], [[project-p5-wave0-supply-chain]]
