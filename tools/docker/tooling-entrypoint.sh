#!/bin/sh
# Entrypoint of the tooling image (prisma/Dockerfile; TASK-014 decision R1-01: ONE image for the three Compose
# one-shots). WAVE-00 sheet lines 530, 533, 534; ADR-0022 am. 14; ADR-0023 am. J item 2 (d)/(e); platform.md §2.4.
#
#   bootstrap       tools/db/bootstrap.ts (roles, schemas, audit DDL lane) as the bootstrap superuser connection
#   migrate         verify the pinned schema engine, then `migrate deploy` through tools/deps/prisma-cli.mjs
#   seed            the reference seed, then the demo seed (same tsx invocation as `npm run db:seed` / `db:seed:demo`)
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

usage() {
  echo "usage: tooling-entrypoint.sh bootstrap|migrate|seed|prisma-version" >&2
  exit 64
}

[ "$#" -eq 1 ] || usage
command=$1

case "$command" in
  bootstrap)
    exec node "$TSX" tools/db/bootstrap.ts
    ;;
  migrate)
    node tools/deps/prisma-cli.mjs --verify-only
    exec node tools/deps/prisma-cli.mjs --verify-only migrate deploy
    ;;
  seed)
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
