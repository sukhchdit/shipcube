# Tooling image: ONE image for the three Compose one-shots `bootstrap`, `migrate` and `seed` (TASK-014 decision R1-01;
# platform.md §3.1 migrate row, §3.2 migrate stage; ADR-0022 am. 12/14; ADR-0023 am. J item 2 (d)/(e); WAVE-00 sheet
# lines 530, 533, 534, 543). Build from the repository root:
#   docker build -f prisma/Dockerfile -t shipcube-tooling .
#   docker run --rm --network none shipcube-tooling prisma-version
# It carries the Prisma CLI with the pinned, verified schema engine, the migrations and bootstrap SQL, and tsx with the
# @platform/source sources of the seed closure (no compiled seed: the seed runs exactly like `npm run db:seed`).
# Never prisma/tests (also hidden by .dockerignore), never prisma/generated, explicit COPY paths only.

# ---- base: pinned Node 24 LTS (ADR-0001). prisma-cli.mjs starts the Prisma CLI with node directly (PR9-SEC-15).
FROM node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0 AS base
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    SCARF_ANALYTICS=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app

# ---- build: the prisma workspace plus the root devDependencies (tsx, pg) from the root lockfile and .npmrc; optional
# dependencies stay (tsx needs esbuild's platform binary; the Prisma CLI is kept deliberately). deps:rebuild fetches
# the schema engine and verifies it against tools/deps/prisma-engines.json (the only network call; never at run time),
# then prune-migrate-image.mjs removes Prisma Studio and the Prisma dev server and installs the Studio stub.
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
RUN --mount=type=cache,target=/root/.npm,sharing=locked \
    npm ci --ignore-scripts --no-audit --include=dev --workspace=prisma --include-workspace-root
COPY tools/deps/ tools/deps/
COPY tools/docker/prune-deps.mjs tools/docker/prune-migrate-image.mjs tools/docker/
COPY tools/db/audit-external-tables.ts tools/db/shadow-init.ts tools/db/sql-text.ts tools/db/
COPY prisma.config.ts ./
COPY prisma/schema/ prisma/schema/
COPY prisma/bootstrap/ prisma/bootstrap/
RUN npm run deps:rebuild \
 && node tools/docker/prune-migrate-image.mjs --stub-studio \
 && mkdir -p /out \
 && for dir in node_modules */node_modules */*/node_modules; do \
      if [ -d "$dir" ]; then mkdir -p "/out/$(dirname "$dir")" && cp -a "$dir" "/out/$dir"; fi; \
    done

# ---- tooling (final): root-owned, read-only for the node user.
FROM base AS tooling
# ADR-0022 am. 14: the verified engine; prisma-engines.mjs tolerates this variable only when it names that file.
ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/node_modules/@prisma/engines/schema-engine-debian-openssl-3.0.x
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
# The seed imports @platform/authz and @platform/config through the @platform/source condition (their src).
COPY packages/authz/package.json packages/authz/
COPY packages/authz/src/ packages/authz/src/
COPY packages/config/package.json packages/config/
COPY packages/config/src/ packages/config/src/
USER node
# SEC-TC-64 (vi) at build time too: the verified engine and the CLI work with no network and no database.
RUN tools/docker/tooling-entrypoint.sh prisma-version
ENTRYPOINT ["/app/tools/docker/tooling-entrypoint.sh"]
CMD ["prisma-version"]
