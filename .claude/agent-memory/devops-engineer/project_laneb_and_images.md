# Lane B queue, Docker lock and image checks

- Lock: `../.orch/docker.lock` (mkdir + `owner` file). Queue scripts in `../.orch/laneb-queue/`: always run a COPY of
  run-live69.sh as the next free run-liveNN.sh (never edit a running one). Pattern for a fresh worktree: a
  `prep-<name>.sh` wrapper that takes the lock, runs `npm ci --ignore-scripts && npm run deps:rebuild` (+ any docker
  build), releases, runs light tests, then starts run-liveNN.sh (prep-chore-valkey.sh, prep-chore-node24.sh).
- Lane B `--profile pr` (tools/quality/suite-runners.json) runs unit/integration/api/catalog/migrations/rls/gitleaks-full
  only: it builds NO images. An image change needs its own `docker build` under the lock.
- Light checks without npm ci: a junction `mklink /J node_modules ..\Shipqube\node_modules` works for jest/prettier, but
  ESLint then reports import-x/no-extraneous-dependencies on @platform/* (artifact). Remove it with `cmd //c rmdir`
  (NEVER rm -rf: it would follow into main's node_modules) before any npm ci in that worktree.
- Node base image: ADR-0001 Node 24; pin node:24.22.3-trixie-slim@sha256:af02d57b... in all five Dockerfiles;
  Dependabot docker ignores node semver-major since #87 (D-DEVOPS-002). check-dockerfiles --root . enforces cross-file
  identity and node/debian codename match.
