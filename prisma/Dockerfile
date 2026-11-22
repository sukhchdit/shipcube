# Tooling image: ONE image for the three Compose one-shots `bootstrap`, `migrate` and `seed` (TASK-014 decision R1-01,
# D-ARCH-117; platform.md §3.1 migrate row, §3.2 migrate stage; ADR-0022 am. 12/14/15; ADR-0023 am. J item 2 (d)/(e);
# WAVE-00 sheet lines 530, 533, 534, 543). Build from the repository root:
#   docker build -f prisma/Dockerfile -t shipcube-tooling .
#   docker run --rm --network none shipcube-tooling prisma-version
# It carries the Prisma CLI with the pinned, verified schema engine, the migrations and bootstrap SQL, and tsx with the
# @platform/source sources of the seed closure (no compiled seed: the seed runs exactly like `npm run db:seed`).
# Never prisma/tests (also hidden by .dockerignore), never prisma/generated, explicit COPY paths only.
# Closure invariant (D-ARCH-117, ruling R1): node_modules holds only the prisma workspace's dependencies and its own
# devDependencies (the Prisma CLI, tsx) with their production closure; typescript and the root devDependency closure
# (eslint, prettier, jest, @redocly, @swc, testcontainers, ...) are never installed here.

# ---- base: pinned Node 24 LTS (ADR-0001). Used by the build stage; the final stage takes only its node binary.
# The node tag's Debian codename (trixie) equals the runtime's debian tag (D-ARCH-116 rule 1, check-dockerfiles
# runtime-codename); Dependabot bumps both pins in one grouped PR.
FROM node:26.13.1-trixie-slim@sha256:e6bedef217677b276c591795e169840edd9096dbf13f29df8ef8d1856b8820bc AS base
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    SCARF_ANALYTICS=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

# ---- build: the prisma workspace only (no --include-workspace-root), with its devDependencies, from the root lockfile
# and .npmrc. Optional dependencies stay (tsx needs esbuild's platform binary). deps:rebuild fetches the schema engine
# and verifies it against tools/deps/prisma-engines.json (the only network call; never at run time).
# prune-migrate-image.mjs then replaces Prisma Studio and the Prisma dev server with throwing stubs, and
# prune-deps.mjs --dev keeps exactly the prisma workspace's production closure plus its own devDependencies' closure
# (the stubs are leaves; optional peers such as typescript are not followed).
FROM base AS build
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
COPY tools/docker/prune-deps.mjs tools/docker/prune-dist.mjs tools/docker/prune-migrate-image.mjs tools/docker/
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --no-audit --include=dev --workspace=prisma
COPY tools/deps/ tools/deps/
COPY tools/db/audit-external-tables.ts tools/db/shadow-init.ts tools/db/sql-text.ts tools/db/
COPY prisma.config.ts ./
COPY prisma/schema/ prisma/schema/
COPY prisma/bootstrap/ prisma/bootstrap/
RUN npm run deps:rebuild \
 && node tools/docker/prune-migrate-image.mjs --stub-studio \
 && node tools/docker/prune-deps.mjs --dev --leaf node_modules/@prisma/studio-core --leaf node_modules/@prisma/dev prisma \
 && node tools/docker/prune-dist.mjs --node-modules node_modules \
 && mkdir -p /out \
 && for dir in node_modules */node_modules */*/node_modules; do \
      if [ -d "$dir" ]; then mkdir -p "/out/$(dirname "$dir")" && cp -a "$dir" "/out/$dir"; fi; \
    done

# ---- tooling (final): Debian trixie-slim plus the Node binary only (the api/worker runtime pattern, D-ARCH-116;
# ruling R6). No npm, npx, corepack, yarn or C headers. No system CA store (no ca-certificates, no /etc/ssl/certs):
# the PostgreSQL CA is a file under DATABASE_CA_DIRECTORIES (/etc/ssl/platform) and Node's bundled store serves any
# other TLS. Root-owned and read-only for the node user.
FROM debian:trixie-slim@sha256:a72b4433de1cf7d6bae0c4cee74d0547f58601a643b3375f070c51600d63b6b2 AS tooling
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    SCARF_ANALYTICS=false \
    PRISMA_SCHEMA_ENGINE_BINARY=/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x
# ADR-0022 am. 14: PRISMA_SCHEMA_ENGINE_BINARY names the verified engine; prisma-engines.mjs tolerates the variable
# only when it names that file. The engine links the image's libssl3 (Debian 13).
COPY --from=base /usr/local/bin/node /usr/local/bin/node
# The node user (UID/GID 1000, as in the node image).
RUN groupadd --gid 1000 node \
 && useradd --uid 1000 --gid node --shell /bin/sh --create-home node \
 && node --version
WORKDIR /app
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
ARG SOURCE=https://github.com/sukhchdit/shipcube
LABEL org.opencontainers.image.title="shipcube-tooling" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="UNLICENSED"
COPY --from=build /out/ /app/
COPY package.json .npmrc ./
COPY prisma.config.ts ./
COPY tools/deps/npm-cli.mjs tools/deps/prisma-cli.mjs tools/deps/prisma-engines.mjs tools/deps/prisma-engines.json tools/deps/
COPY tools/db/bootstrap.ts tools/db/check-tooling-env.ts tools/db/scram.ts tools/db/sql-text.ts tools/db/shadow-init.ts tools/db/audit-external-tables.ts tools/db/
COPY --chmod=0555 tools/docker/tooling-entrypoint.sh tools/docker/tooling-entrypoint.sh
COPY prisma/package.json prisma/
COPY prisma/schema/ prisma/schema/
COPY prisma/migrations/ prisma/migrations/
COPY prisma/bootstrap/ prisma/bootstrap/
COPY prisma/seed/ prisma/seed/
# The seed imports @platform/authz and @platform/config through the @platform/source condition (their src), and
# @platform/authz imports @platform/shared since TASK-020 (the workspace link in node_modules needs its target).
COPY packages/shared/package.json packages/shared/
COPY packages/shared/src/ packages/shared/src/
COPY packages/authz/package.json packages/authz/
COPY packages/authz/src/ packages/authz/src/
COPY packages/config/package.json packages/config/
COPY packages/config/src/ packages/config/src/
USER 1000:1000
# SEC-TC-64 (vi) at build time too: the verified engine and the CLI work with no network and no database.
RUN tools/docker/tooling-entrypoint.sh prisma-version
ENTRYPOINT ["/app/tools/docker/tooling-entrypoint.sh"]
CMD ["prisma-version"]
