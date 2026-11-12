FROM node:24-bookworm-slim@sha256:0000000000000000000000000000000000000000000000000000000000000000
WORKDIR /app
COPY package.json package-lock.json .npmrc ./
RUN npm ci --ignore-scripts --omit=dev
