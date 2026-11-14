---
name: wave0-task014-image-rulings
description: D-ARCH-116..118 (TASK-014 / PR #39 images): api/worker runtime = debian:trixie-slim + Node binary (distroless superseded, shell load-bearing), one tooling image prisma/Dockerfile with a closure invariant (no typescript / root devDeps), size budget = 300 MiB as layer sum (worker 296.0 MiB, SI reading would fail), prune plan + imgheadroom task; lessons on measuring images on Windows
metadata:
  type: project
---

**Rulings (2026-11-14, `docs/03-architecture/rulings/wave-0-task-014-rulings.md`; ADR-0001 am. 2026-11-14, ADR-0022 am. 15; platform.md §2.2/§2.4/§3.1/§3.2/§3.4/§5.2/§7.4, OI-03 + OI-08 resolved; risks R-ARCH-31):**
- D-ARCH-116: api/worker `runtime` = `debian:trixie-slim@sha256` + only `/usr/local/bin/node` from `node:24.22.3-trixie-slim@sha256`. Fixed cost measured 204.6 MiB (Debian 83.6 + node 121.0); full node base would be api ≈ 324 / worker ≈ 344 MiB. Rules: codename parity (lane A `runtime-codename`), binary-only copy, CVE response = Dependabot `docker` + `docker-compose` bumps (PR #39 head had NO docker ecosystem in dependabot.yml → review req R2), no `ca-certificates`/`/etc/ssl` in the runtime (Node bundled CA; `--use-openssl-ca` is a fail-closed trap), shell stays because `entrypoint.sh` strips NODE_OPTIONS before the first Node process → distroless is NOT the fallback (lever recorded: `cc-debian13` + static busybox).
- D-ARCH-117: one tooling image `prisma/Dockerfile` → `shipcube-tooling` (bootstrap/migrate/seed by `command`); ECS = three task defs with command overrides. Closure invariant: no `typescript`/root devDeps closure (PR head shipped 588.8 MiB incl. typescript 20, effect 24, @redocly 21, @swc/core 13 because of `--include-workspace-root`) → binding review req R1. `src/*.ts` allowed only in the tooling image (sheet line 533).
- D-ARCH-118: size = sum of `docker history` layer sizes, unit MiB (300 MiB = 314,572,800 B). Worker 296.0 MiB = 310.4 MB → would FAIL under SI; ruled MiB, NFR-OPS-002 wording routed to PM, WARN at 90 %, tooling reported not gated. Prune plan measured in the worker: pdfkit alt bundles ≈ 3, zod src/unused entries ≈ 3–4, stripe dual build ≈ 2, bcrypt foreign prebuilds 0.9, Prisma CJS twins 0.4; structural: `@opentelemetry/sdk-node` pulls @grpc/grpc-js + protobufjs (≈ 8 MiB) → telemetry task. New late task `imgheadroom` proposed (exit worker ≤ 270, api ≤ 255 MiB) for the next sheet fold.

**Why:** OI-08 flagged the 300 MB budget as tight before anyone measured a Node 24 binary; the PR surfaced the unit choice transparently (D-TASK014-07) and the architect must own it rather than let the gatekeeper read "300 MB" literally.

**How to apply:** when reviewing image PRs, measure with `docker history --human=false` (never `inspect .Size` under containerd), check both FROM codenames, check dependabot.yml docker ecosystems, and check the tooling image for root devDeps. Any base-image change needs a superseding amendment to ADR-0001.

**Lessons:**
- `docker run … --entrypoint /bin/sh` from Git Bash rewrites `/bin/sh` to a Windows path; prefix `MSYS_NO_PATHCONV=1 MSYS2_ARG_CONV_EXCL='*'`.
- PR images are usually still present locally as `shipcube-*:local`; probe them directly (`ldd`, `dpkg -l`, `du -sm`) instead of trusting the PR body.
- `npm explain <pkg>` on the main checkout shows which production dep pulls a heavy transitive (used to attribute @grpc to otlp-grpc-exporter-base, @swc/helpers to fontkit, zod to @platform/config).
