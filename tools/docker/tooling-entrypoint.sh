#!/bin/sh
# Entrypoint of the tooling image (prisma/Dockerfile; TASK-014 decision R1-01: ONE image for the three Compose
# one-shots). WAVE-00 sheet lines 530, 533, 534; ADR-0022 am. 14; ADR-0023 am. J item 2 (d)/(e); platform.md §2.4.
#
#   bootstrap       tools/db/bootstrap.ts (roles, schemas, audit DDL lane) as the bootstrap superuser connection
#   migrate         verify the pinned schema engine, then `migrate deploy` through tools/deps/prisma-cli.mjs
#   seed            the reference seed, then the demo seed (same tsx invocation as `npm run db:seed` / `db:seed:demo`)
#
# PR3-SEC-14 (TASK-014 round 2): before a step connects, tools/db/check-tooling-env.ts checks the URL it uses
# (DATABASE_BOOTSTRAP_URL for bootstrap, DATABASE_MIGRATOR_URL for migrate and seed) and exits 1 naming only the
# variable. Outside APP_ENV local/test, or with an ECS task-metadata variable set, it also refuses APP_ENV local/test
# on ECS and every PG* variable, even empty (PR39-SEC-02, R1-n9), again by name only. The image holds packages/config as sources only, so every tsx run uses the @platform/source condition.
#   prisma-version  verify the engine and print the Prisma CLI version; needs no network and no database (SEC-TC-64 (vi))
#
# No npm, no npx: TypeScript entry points run through `node <tsx cli>`; Prisma runs only through prisma-cli.mjs, which
# refuses engine-redirecting variables and tolerates PRISMA_SCHEMA_ENGINE_BINARY only when it names the verified file.
# NODE_OPTIONS is dropped so that no preload (--require, --import) can run inside the migrator-privileged processes.
# Exit codes are those of the step that ran; nothing here prints connection strings or other variable values.
set -eu
unset NODE_OPTIONS

cd /app
TSX=/app/node_modules/tsx/dist/cli.mjs

check_env() {
  node "$TSX" --conditions=@platform/source tools/db/check-tooling-env.ts "$1"
}

usage() {
  echo "usage: tooling-entrypoint.sh bootstrap|migrate|seed|prisma-version" >&2
  exit 64
}

[ "$#" -eq 1 ] || usage
command=$1

case "$command" in
  bootstrap)
    check_env DATABASE_BOOTSTRAP_URL
    exec node "$TSX" --conditions=@platform/source tools/db/bootstrap.ts
    ;;
  migrate)
    check_env DATABASE_MIGRATOR_URL
    exec node tools/deps/prisma-cli.mjs --verify-only migrate deploy
    ;;
  seed)
    check_env DATABASE_MIGRATOR_URL
    node "$TSX" --conditions=@platform/source prisma/seed/index.ts reference
    exec node "$TSX" --conditions=@platform/source prisma/seed/index.ts demo
    ;;
  prisma-version)
    exec node tools/deps/prisma-cli.mjs --verify-only --version
    ;;
  *)
    usage
    ;;
esac
