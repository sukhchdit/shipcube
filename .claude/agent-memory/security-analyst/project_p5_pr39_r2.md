---
name: project-p5-pr39-r2
description: PR #39 (TASK-014) delta round 2 @c85d5e5 PASS_WITH_FOLLOW-UPS; C1/C2 + LOW 02-06 closed; new INFO 11-13; PR #42 merged after the head, so the union needs a merge-only round (R2.13 checklist); probe facts (gitleaks .gitleaksignore/archives, NODE_USE_ENV_PROXY)
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0039-TASK-014-security-review.md`, section "Delta round 2 (fix cycle 1 + unions, head c85d5e5)" appended uncommitted in worktree `Shipqube-TASK-014` on 2026-11-15 (LF, 1035 lines). Proposed D-SEC-PR39-08.

**Verdict PASS_WITH_FOLLOW-UPS.** Closed: 01 (C1), 02, 03 (C2), 04, 05, 06 (Dependabot), PR9-SEC-04 item 3, argv/ECS residuals of PR3-SEC-01/13/14. D-SEC-PR39-04 superseded: the node-header entry is deleted.

**New INFO findings:**
- **11:** `/tests/compose/` is not owned. Due in the activation PR.
- **12:** image-scan residuals: archives are not opened (`--max-archive-depth 2` finds a gz member); lockfile names, `*.bin` and `jquery*` stay skipped; package-file entries are unbound and stale entries go unnoticed; the node binary is exempted by path plus ELF magic only.
- **13:** env levers outside the preflight: `NODE_USE_ENV_PROXY`, `LD_*`, `OPENSSL_CONF`, `NODE_COMPILE_CACHE`. Optional, M5.

Observation, no ID, routed to 015-C: main's `node-options-preload` accepts `${{ }}` and `--inspect` in `NODE_OPTIONS`.

**Sequencing.** PR #42 merged (a082560) after c85d5e5, so #39 is the second merger. The merge-only round checks:
- `GUARDS.length` 15;
- the admission throws name `DB_TENANT_*` (mislabel only);
- one Lint heap `env:` block;
- `tsx` and `@platform/audit` both in prisma devDeps; the tooling image then gets a dangling `@platform/audit` link (only `prisma/tests` imports it);
- a stack re-run (worker at 98.7 %) and fresh evidence.

Simulation S8: the union voids the record via `with-tenant-tx.ts`, `guards.ts`, `prisma/package.json` and `package-lock.json`. The #46 union conflicts only in `ci.yml`.

**Facts, probe-confirmed 2026-11-14:**
- **Gitleaks v8.30.1 `dir` mode loads `<source>/.gitleaksignore`.** A layer-supplied fingerprint suppressed a finding. Without `--config` it loads `<source>/.gitleaks.toml`.
- **Default path allow-list.** It skips `package-lock.json` but scans the hidden `.package-lock.json`. It skips `*.bin` and `jquery-*.min.js`. Archives are opened only with `--max-archive-depth`.
- **Node 24.22.3 honours `NODE_USE_ENV_PROXY=1` + `HTTPS_PROXY`** for both `fetch` and `https.get` (CONNECT to the proxy).
- **Local images 2026-11-14:** api, worker and tooling were built from ee17098 (equal to head for every image input). Tooling has 67 top-level packages and 0 PEM files. api and worker hold 2 jose files containing the "PRIVATE KEY-----" text (parsing code, not keys).

**Kit (session scratch `review/PR-39-sec-r2/`, may vanish):**
- `pf-gen.mjs`: 38-case matrix run inside the api image. It compares r1 vs head echo-entrypoints vs the image's real entrypoint.
- `hold*.sh`: lock-holding Docker runs.
- `gl-prep.mjs`: probe tree plus a scanner copy with `--pull=never`.
- `record-sim.mjs`: 10 scenarios, including a union-with-main merge.
- `hostscan.mjs`: count-only host-fragment scan.
- `lockdiff.mjs`: lockfile delta.

**How to apply:** merge-only round = R2.13 items 1-7 + record Head = pushed union commit. Activation PR: check 10/11/12. M5: 13.

Related: [[project-p5-pr39-task014-images]], [[project-p5-pr45-gitleaks-allow]], [[project-p5-pr42-r2]], [[project-p5-pr46-015b-lane-c]], [[project-security-review-conventions]]
