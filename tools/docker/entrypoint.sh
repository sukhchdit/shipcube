#!/bin/sh
# api and worker container entrypoint (TASK-014; D-ORCH-007 item 2; PR3-SEC-13; PR3-SEC-11 R3.4 item 2;
# ADR-0018 am. 8, D-ARCH-061; PR20-SEC-04 item 2). Image usage: ENTRYPOINT ["/app/entrypoint.sh"], CMD ["dist/main.js"].
#
# Node applies NODE_OPTIONS before any JavaScript runs (an --inspect-wait listener, a --require preload), so the
# preflight runs with NODE_OPTIONS removed from its environment and the original value in PREFLIGHT_NODE_OPTIONS
# (packages/config/src/entry-preflight.ts). Only after it exits 0 is the application exec'd, keeping the PID so the
# init process (Compose `init: true`, ECS initProcessEnabled) forwards signals to Node. --disable-sigusr1 stops a
# SIGUSR1 from starting the inspector in either process. A refusal exits 78 (EX_CONFIG) and names variables only.
set -eu

status=0
PREFLIGHT_NODE_OPTIONS="${NODE_OPTIONS-}" env -u NODE_OPTIONS node --disable-sigusr1 /app/packages/config/dist/entry-preflight-cli.js || status=$?
if [ "$status" -ne 0 ]; then
  exit "$status"
fi

unset PREFLIGHT_NODE_OPTIONS
exec node --disable-sigusr1 --enable-source-maps "$@"
