# web image (TASK-014, US-004; platform.md §3.1/§3.3; ADR-0026; WAVE-00 sheet lines 531, 537, 543). Static build
# served by nginx-unprivileged. Build from the repository root:
#   docker build -f apps/web/Dockerfile -t shipcube-web .
# Explicit COPY paths only; .dockerignore hides tests, fixtures, docs, env files and host build output.

# ---- build: same pinned Node base as the Node images (ADR-0001). Root lockfile, .npmrc and every workspace manifest
# (am. J item 1 (c)); lifecycle scripts never run, and no deps:rebuild is needed for the static apps (platform.md §3.3).
FROM node:26.13.0-trixie-slim@sha256:5adad64f9a1fca2d51972caa65983634c8a774eb300d72b20f7f2a0f60368072 AS build
ENV NODE_ENV=production \
    CHECKPOINT_DISABLE=1 \
    SCARF_ANALYTICS=false \
    NPM_CONFIG_UPDATE_NOTIFIER=false \
    NPM_CONFIG_FUND=false
WORKDIR /app
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
    npm ci --ignore-scripts --no-audit --include=dev
COPY tsconfig.base.json ./
COPY packages/shared/ packages/shared/
COPY packages/ui/ packages/ui/
COPY apps/web/ apps/web/
# am. J items 5/6 (D-ARCH-044): the build runs offline and must not touch the manifests or the lockfile.
ENV NPM_CONFIG_OFFLINE=true
RUN sha256sum package.json package-lock.json > /tmp/manifests.sha256 \
 && npm run build -w apps/web \
 && sha256sum -c --quiet /tmp/manifests.sha256 \
 && test -f apps/web/build/client/index.html

# ---- runtime: nginx-unprivileged mainline alpine-slim (listens on 8080, UID 101; platform.md §3.3).
FROM nginxinc/nginx-unprivileged:1.31.7-alpine-slim@sha256:a8cb0f33d51fa107c96fd2bd3a71aaf564ec131e9d2bdf8700944f0ed8b170d7 AS runtime
ARG VERSION=0.0.0-dev
ARG REVISION=unknown
ARG SOURCE=https://github.com/sukhchdit/shipcube
LABEL org.opencontainers.image.title="shipcube-web" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.revision="${REVISION}" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.licenses="UNLICENSED"
USER 0
# PR4-SEC-02 / PR4-SEC-12 (sheet line 537): the stock default.conf would still answer Host: localhost and IPv6, and the
# stock html/ holds 50x.html; both go BEFORE the template and the static build are copied.
RUN rm -f /etc/nginx/conf.d/default.conf \
 && rm -rf /usr/share/nginx/html/*
# The template's only placeholder is ${NGINX_PORT}; it is rendered once at build time (8080 is fixed in this image) to
# a root-owned file, so the container needs no writable conf.d and runs with a read-only root filesystem.
COPY infra/nginx/web.conf.template /tmp/web.conf.template
RUN sed "s/[\$]{NGINX_PORT}/8080/g" /tmp/web.conf.template > /etc/nginx/conf.d/web.conf \
 && rm /tmp/web.conf.template \
 && if grep -qF "\${" /etc/nginx/conf.d/web.conf; then echo 'unrendered placeholder in web.conf' >&2; exit 1; fi \
 && chmod 0644 /etc/nginx/conf.d/web.conf
# ONLY build/client/ (never build/server/).
COPY --from=build /app/apps/web/build/client/ /usr/share/nginx/html/
USER 101
RUN nginx -t
EXPOSE 8080
HEALTHCHECK --interval=5s --timeout=2s --retries=6 --start-period=3s \
  CMD ["wget", "-q", "--spider", "http://127.0.0.1:8080/healthz"]
