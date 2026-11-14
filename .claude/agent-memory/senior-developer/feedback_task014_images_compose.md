---
name: task014-images-compose
description: TASK-014 (2026-11-13/14) images + compose - host traps (Avast TLS MITM, host 5432, containerd .Size, MSYS path mangling), stack-suite design, Prisma CLI load-time requires, main-chasing cost
metadata:
  type: feedback
---

TASK-014 delivered as PR #39 after about 8 stack runs and 7 evidence runs. It used 2 devops rounds and 1 backend TLS round, all opus and one at a time.

**Why:** these host and tooling traps cost most of the wall time. Any later image, compose or e2e task hits them again.

**How to apply:**

**Host traps**
- Avast Web/Mail Shield re-signs every localhost TLS certificate. A host-side Node client can never verify the edge.
  - Probe HTTPS from inside the compose network instead: `docker compose exec -T api node -e …` with the CA on stdin.
  - Playwright will need `ignoreHTTPSErrors` or an in-network runner.
- A host PostgreSQL listens on 5432. Make data-service host ports configurable (`POSTGRES_HOST_PORT` …); the stack suite sets 25432 and similar.
- Docker Desktop uses the containerd image store, so `image inspect .Size` also counts compressed blobs. Measure "uncompressed" as the sum from `docker history --human=false`.
- Git Bash mangles paths:
  - `git show origin/main:file` becomes `origin\main;file`.
  - `-v x:/cfg/...` becomes a Git path.
  - Prefix both with `MSYS_NO_PATHCONV=1`. The `hadolint/hadolint` image has no `sh`, so mount the config with `$(pwd -W)`.
- The Docker engine hung for more than 2 h after the disk filled; agents could not kill or restart it (the classifier denied it). Author statically and validate with `docker compose config -q`, which needs no daemon.

**Image and compose facts**
- Prisma 7.10.1 `cli.js` requires `@prisma/studio-core/data/*` and `@prisma/dev/internal/state` at module load. Stub both.
- tls-init: Node refuses a self-signed CA:FALSE leaf as its own trust anchor, so create a local CA plus a leaf.
- With CAP_CHOWN but no DAC_OVERRIDE, root cannot read a 0400 file it has already chowned away. Copy the file first, then chown.
- nginx refuses a duplicate `proxy_read_timeout` across an include.
- The tooling image runs TS sources through `@platform/source`. When a package gains a workspace dependency (authz gained shared), the seed fails with ERR_MODULE_NOT_FOUND. `tools/docker/tooling-closure.test.ts` guards this.
- A stack suite that builds images must not run in `test:coverage`. It is an opt-in Jest project (`JEST_STACK=1`, `npm run test:stack`), and unit ignores `*.stack.test.ts`.

**Process**
- Main moved with code three times (#33, #32, #34, #37). Each merge voided the stack and evidence runs, and #32's new lint rules broke files in this PR. Fetch right before the final evidence run, then push immediately with a gated `&&` chain.
- Lane B unit runs flake on 5 s Jest timeouts when other agents load the host. Rerun rather than change other tasks' tests, and report the failed runs in the evidence commit.
- The Bash tool keeps eating backslashes in `node -e` and perl replacements. Use the Edit tool for any line with `\`, `$` or a regex.

Related: [[lane-b-evidence-run]], [[p5-dispatch]], [[batch-020-015-lessons]]
