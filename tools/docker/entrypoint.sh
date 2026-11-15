#!/bin/sh
# api and worker container entrypoint (TASK-014; D-ORCH-007 item 2; PR3-SEC-13; PR3-SEC-11 R3.4 item 2;
# ADR-0018 am. 8, D-ARCH-061; PR20-SEC-04 item 2; PR39-SEC-02). Image usage: ENTRYPOINT ["/app/entrypoint.sh"],
# CMD ["dist/main.js"].
#
# The runtime image carries no system CA store (no ca-certificates, no /etc/ssl/certs); outbound TLS uses Node's
# bundled Mozilla store, so --use-openssl-ca could only make every TLS call fail. The preflight refuses it.
#
# Node applies NODE_OPTIONS and its command-line options before any JavaScript runs (an --inspect-wait listener, a
# --require or --import preload), so the preflight runs with NODE_OPTIONS removed from its environment, the original
# value in PREFLIGHT_NODE_OPTIONS and this script's argv after `--` (packages/config/src/entry-preflight.ts; outside
# APP_ENV local/test, or inside an ECS task, the argv must be exactly one dist/*.js entry script). Only after it exits
# 0 is the application exec'd with that same argv, keeping the PID so the init process (Compose `init: true`, ECS
# initProcessEnabled) forwards signals to Node. --disable-sigusr1 stops a SIGUSR1 from starting the inspector in
# either process. A refusal exits 78 (EX_CONFIG) and names variables (or CMD) only, never a value or an argument.
set -eu

status=0
PREFLIGHT_NODE_OPTIONS="${NODE_OPTIONS-}" env -u NODE_OPTIONS node --disable-sigusr1 /app/packages/config/dist/entry-preflight-cli.js -- "$@" || status=$?
if [ "$status" -ne 0 ]; then
  exit "$status"
fi

unset PREFLIGHT_NODE_OPTIONS
exec node --disable-sigusr1 --enable-source-maps "$@"
