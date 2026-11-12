# Positive control: root manifests, lockfile and .npmrc copied before the install; the build stage inherits them.
FROM node:24-bookworm-slim@sha256:0000000000000000000000000000000000000000000000000000000000000000 AS deps
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
COPY apps/api/package.json apps/api/
RUN npm ci --ignore-scripts \
    --workspace=apps/api
FROM deps AS prod-deps
RUN npm ci --ignore-scripts --omit=dev --omit=optional --workspace=apps/api
