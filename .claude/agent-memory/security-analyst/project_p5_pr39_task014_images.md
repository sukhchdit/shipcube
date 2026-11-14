---
name: project-p5-pr39-task014-images
description: PR #39 (TASK-014 images + compose) R1 @894c72e PASS_WITH_CONDITIONS (C1 routing/tests find, C2 scanner node_modules); gitleaks default-config node_modules blind spot (probe-confirmed); tooling-image dev closure; preflight argv/ECS gaps; union checklist #40/#41/#42; image-inspection recipe
metadata:
  type: project
---

Record: `docs/05-quality/security/PR-0039-TASK-014-security-review.md`, written uncommitted into worktree `Shipqube-TASK-014` on 2026-11-14 (LF, ~600 lines). IDs PR39-SEC-01..10 (6 LOW, 4 INFO).

**R1 @894c72e: PASS_WITH_CONDITIONS.**
- **C1 = SEC-01**, before merge: the D-ARCH-115 image `find` lacks `*/routing/tests*` and `*/dist/*/tests/*`; `prune-dist.test.ts` lacks the `fixture-route.js` case. Content is absent today (dockerignore `**/tests`, prune-dist generic `tests` dir rule, build-time `cleanTree`). Unowned paths, so the fix keeps the record valid (sim S4).
- **C2 = SEC-03**, before lane B `image-assertions` activation / G3: see the Gitleaks fact below.
- **Follow-ups:**
  - 02: preflight ignores argv `"$@"`, uses an APP_ENV-only hardened decision (no ECS second signal; `checkToolingEnv` too), and has no `NODE_EXTRA_CA_CERTS` / `SSL_CERT_*` check (PR9-SEC-04 item 3).
  - 04: the tooling image ships the root devDeps.
  - 05: CODEOWNERS misses Dockerfiles, compose, `infra/`, `tools/docker/`, and the preflight / db-tls modules (sim S7: removing the preflight line passes with no record).
  - 06: no Dependabot docker ecosystems; Trivy ruled not needed before merge, due at activation / TASK-119 / G3.

**Facts, probe-confirmed 2026-11-14:**
- **Gitleaks v8.30.1 default config skips every `node_modules/` path in `dir` mode.** One planted key at 3 paths gave 1 finding. Any image scan without its own `--config` is blind there.
- **Tooling image (`prisma/Dockerfile`, `npm ci --workspace=prisma --include-workspace-root --include=dev`, `prune-deps` not run).** 588 top-level packages, 347 MiB, including typescript, jest, eslint, testcontainers → dockerode → docker-modem → ssh2, and 50 PEM private-key fixture files.
- **api / worker images.** Root-owned `/app`, user 1000, no npm. 11 debian setuid binaries.
- **web / admin.** nginx-unprivileged leaves `/etc/nginx` 101-owned and group-writable (`read_only` neutralises it).
- **`entrypoint.sh` execs `node … "$@"`.** `--import=data:text/javascript,…` runs before main in both the NODE_OPTIONS and the argv form.

**Image inspection recipe:**
- Map local image `Created` to commit times first (`git diff <commit> <head>` must touch only build-context-excluded paths).
- Then, under `docker.lock`: `docker run --rm --user 0 --network none --entrypoint sh <img> -c 'find …'`. Print names and counts only.
- A background mkdir-loop waiter on the lock worked; another agent held it about 15 min.
- Run the Gitleaks image with `--pull=never`.

**Union checklist (second merger needs a merge-only round):**
- **#40** (package.json): keep `test:stack` and `coverage-run.mjs`. The `stack` jest project stays behind `JEST_STACK`, and `coverage-run` never selects it.
- **#41** (deps): re-run the stack suite. The worker is at 296/300 MiB.
- **#42**: keep the `TenantTxConfigError(msg, variable)` parameter and pass `DB_TENANT_*` names in the admission throws. GUARDS keeps credentialPair, logLevel, database and localAppEnvOnEcs. Union the `index.ts` export lists.

**How to apply.**
- **Fix-cycle round:** verify C1 (two unowned diffs, extended find empty on all images) and any SEC-02 code (unit plus the stack `docker run … --inspect-wait dist/main.js` → 78).
- **Activation PR:** compose-up, image-assertions and trivy runner entries, with the SEC-01/03/04 assertions.
- **M5 ECS task definitions:** `no-new-privileges`, `readonlyRootFilesystem`, `initProcessEnabled`, and the RDS bundle at `/etc/ssl/platform`.
- **TASK-119:** PR10-SEC-06 (re-routed), Trivy.

Related: [[project-p5-pr9-runtime-skeleton]], [[project-p5-wave0-config-review]], [[project-p5-pr13-seed-framework]], [[project-p5-pr30-s3-adapter]], [[project-p5-pr40-covhook]], [[project-security-review-conventions]]
