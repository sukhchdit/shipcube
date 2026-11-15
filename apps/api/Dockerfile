# api image (TASK-014, US-004; platform.md §3.1/§3.2 stage plan; ADR-0022 am. 12-14; ADR-0023 am. F/I/J; WAVE-00 sheet
# lines 530-532, 539, 543, 544). Build from the repository root:
#   docker build -f apps/api/Dockerfile -t shipcube-api .
# Explicit COPY paths only (never the whole context or the bare prisma directory); .dockerignore hides tests,
# fixtures, spikes, docs (except the API contract), env files and host build output.

# ---- base: pinned Node 24 LTS (ADR-0001: node:24-trixie-slim by digest). No apt packages.
FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS base
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    SCARF_ANALYTICS=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

# ---- manifests: root lockfile, .npmrc and every workspace package.json (am. J item 1 (c), D-ARCH-040).
FROM base AS manifests
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
COPY apps/worker/package.json apps/worker/
COPY apps/web/package.json apps/web/
COPY apps/admin/package.json apps/admin/
COPY packages/audit/package.json packages/audit/
COPY packages/authz/package.json packages/authz/
COPY packages/carriers/package.json packages/carriers/
COPY packages/config/package.json packages/config/
COPY packages/pricing/package.json packages/pricing/
COPY packages/shared/package.json packages/shared/
COPY packages/ui/package.json packages/ui/
COPY prisma/package.json prisma/

# ---- deps: full install for the build; --include=dev because the base sets NODE_ENV=production (npm would omit dev
# dependencies). Lifecycle scripts never run.
FROM manifests AS deps
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --no-audit --include=dev

# ---- build: deps:rebuild (bcrypt load check, pinned schema engine, prisma generate), then tsc -b for the app and its
# referenced packages; compiled tests and fixtures are pruned before anything is copied out (SPK-01 F-13).
FROM deps AS build
COPY tsconfig.base.json .prettierrc ./
COPY tools/deps/ tools/deps/
COPY tools/docker/prune-dist.mjs tools/docker/
COPY tools/api/gen-module-registry.ts tools/api/
COPY tools/db/audit-external-tables.ts tools/db/shadow-init.ts tools/db/sql-text.ts tools/db/
COPY prisma.config.ts ./
COPY prisma/schema/ prisma/schema/
COPY prisma/bootstrap/ prisma/bootstrap/
COPY prisma/client/tsconfig.json prisma/client/
COPY packages/shared/ packages/shared/
COPY packages/config/ packages/config/
COPY packages/authz/ packages/authz/
COPY packages/audit/ packages/audit/
COPY packages/pricing/ packages/pricing/
COPY packages/carriers/ packages/carriers/
COPY apps/api/ apps/api/
RUN npm run deps:rebuild \
 && npm run build -w apps/api \
 && node tools/docker/prune-dist.mjs --declarations prisma/dist/client apps/api/dist packages/shared/dist packages/config/dist \
      packages/authz/dist packages/audit/dist packages/pricing/dist packages/carriers/dist

# ---- prod-deps: production closure of apps/api only; optional dependencies (and so the devOptional Prisma CLI,
# Studio, elkjs, typescript) omitted (ADR-0022 am. 11). prune-deps.mjs then drops every installed package outside the
# apps/api production closure (npm reifies some packages of other workspaces, e.g. react-dom), and prune-dist.mjs
# drops Markdown, maps, declarations and the non-PostgreSQL Prisma query compilers. Workspace-nested node_modules
# (packages/carriers/node_modules) are staged under /out with the root one.
FROM manifests AS prod-deps
COPY tools/docker/prune-deps.mjs tools/docker/prune-dist.mjs tools/docker/
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --no-audit --omit=dev --omit=optional --workspace=apps/api \
 && node tools/docker/prune-deps.mjs apps/api \
 && node tools/docker/prune-dist.mjs --node-modules node_modules \
 && mkdir -p /out \
 && for dir in node_modules */*/node_modules prisma/node_modules; do \
      if [ -d "$dir" ]; then mkdir -p "/out/$(dirname "$dir")" && cp -a "$dir" "/out/$dir"; fi; \
    done

# ---- runtime: Debian trixie-slim (the base of the pinned node image) plus the Node binary only, copied from the pinned
# node image. npm, yarn, corepack and the C headers stay out: no package manager at run time, and the size budget of
# platform.md §3.4 (api/worker <= 300 MB uncompressed; OI-08) cannot be met on the full node image (decision R1-03).
FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS runtime
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    SCARF_ANALYTICS=false
COPY --from=base /usr/local/bin/node /usr/local/bin/node
# The node user (UID/GID 1000, as in the node image) and the audit anchor mount point, owned by node so the named
# volume inherits it (platform.md §2.3).
RUN groupadd --gid 1000 node \
 && useradd --uid 1000 --gid node --shell /bin/sh --create-home node \
 && install -d -o node -g node -m 0750 /data/audit-anchors \
 && node --version
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
ARG SOURCE=https://github.com/sukhchdit/shipcube
LABEL org.opencontainers.image.title="shipcube-api" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="UNLICENSED"
# Application code and dependencies stay root-owned and read-only for the node user (CWE-732); only
# /data/audit-anchors is writable by node.
COPY --from=prod-deps /out/ /app/
COPY package.json /app/package.json
COPY --from=build /app/packages/shared/package.json /app/packages/shared/package.json
COPY --from=build /app/packages/shared/dist /app/packages/shared/dist
COPY --from=build /app/packages/config/package.json /app/packages/config/package.json
COPY --from=build /app/packages/config/dist /app/packages/config/dist
COPY --from=build /app/packages/authz/package.json /app/packages/authz/package.json
COPY --from=build /app/packages/authz/dist /app/packages/authz/dist
COPY --from=build /app/packages/audit/package.json /app/packages/audit/package.json
COPY --from=build /app/packages/audit/dist /app/packages/audit/dist
COPY --from=build /app/packages/pricing/package.json /app/packages/pricing/package.json
COPY --from=build /app/packages/pricing/dist /app/packages/pricing/dist
COPY --from=build /app/packages/carriers/package.json /app/packages/carriers/package.json
COPY --from=build /app/packages/carriers/dist /app/packages/carriers/dist
# The generated Prisma client package (D-ARCH-102/-105, sheet line 544; TASK-020 part 020-B merged first): its
# manifest and the compiled JavaScript only. Never prisma/generated, schema, migrations, bootstrap, seed or tests.
# The preflight imports @platform/prisma/client through the default condition (no --conditions).
COPY --from=build /app/prisma/package.json /app/prisma/package.json
COPY --from=build /app/prisma/dist/client /app/prisma/dist/client
COPY --from=build /app/apps/api/package.json /app/apps/api/package.json
COPY --from=build /app/apps/api/dist /app/apps/api/dist
# The contract served by /api/docs (D-TASK017-01 (7)): main.js resolves ../../../docs/... from apps/api/dist.
COPY docs/03-architecture/api/openapi.yaml /app/docs/03-architecture/api/openapi.yaml
COPY --chmod=0555 tools/docker/entrypoint.sh /app/entrypoint.sh
# Image tools (TASK-014): root-owned and read-only; build-time preflight and HEALTHCHECK probe, never served code.
COPY --chmod=0444 tools/docker/healthcheck.mjs tools/docker/preflight.mjs /app/
WORKDIR /app/apps/api
USER 1000:1000
# ADR-0022 am. 13: every production module and @platform entry point loads from dist without --conditions.
RUN node /app/preflight.mjs /app/apps/api/dist
EXPOSE 3000
HEALTHCHECK --interval=5s --timeout=3s --retries=6 --start-period=20s \
  CMD ["/usr/bin/env", "-u", "NODE_OPTIONS", "node", "/app/healthcheck.mjs", "api"]
ENTRYPOINT ["/app/entrypoint.sh"]
CMD ["dist/main.js"]
