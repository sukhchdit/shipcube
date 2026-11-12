---
name: project-security-review-conventions
description: How security findings are expressed and routed in this project (OWASP 2021 codes, severity rule, read-only on ADRs, npm registry checks work from the host)
metadata:
  type: project
---

Findings use the CLAUDE.md §11 scale with CWE and OWASP Top 10:2021 codes (threat-model.md uses 2021 codes, e.g. A10 = SSRF; keep consistent). Severity matrix from threat-model.md §1: Impact×Likelihood, C×H=CRITICAL, C×L/M or H×M/H=HIGH, H×L or M×M/H=MEDIUM, else LOW. Security-analyst never edits ADRs/requirements: findings go to principal-architect (technical) or product-manager (functional), and proposed decision text is handed to them to log in DECISIONS.md.

**Why:** Orchestrator instructions for P3 (read-only scope, no commits, no human questions); consistency with threat-model.md lets quality-gatekeeper trace IDs.

**How to apply:** Registry checks (`npm view <pkg> license version time.modified --json`) work from the Windows host when prefixed with `export PATH="$APPDATA/fnm/aliases/default:$PATH";` (D-ORCH-002) — no need to spawn dependency-auditor for spot checks before a lockfile exists. Notable licence facts found 2026-11-12: caniuse-lite is CC-BY-4.0, spdx-exceptions CC-BY-3.0 (stale), argparse 3.x is PSF-2.0, nodemailer MIT-0, tslib 0BSD, lru-cache BlueOak-1.0.0. Related: [[project-p3-security-conditions]]
