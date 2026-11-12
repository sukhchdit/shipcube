# D-ARCH-040 (c): the stage copies only the app manifest, so npm would resolve @platform/* without the root pin.
FROM node:24-bookworm-slim@sha256:0000000000000000000000000000000000000000000000000000000000000000 AS deps
WORKDIR /app
COPY apps/api/package.json ./
RUN npm ci --ignore-scripts
