# D-ARCH-040 (c): lockfile copied but not .npmrc (no ignore-scripts, no @platform pin inside the image).
FROM node:24-bookworm-slim@sha256:0000000000000000000000000000000000000000000000000000000000000000
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
