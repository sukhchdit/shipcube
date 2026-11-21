# Code review: PR #87 Node base images back to Node 24 LTS, Dependabot ignore for node majors (D-DEVOPS-002), round 1

| Field | Value |
|---|---|
| PR | #87, branch `chore/node24-base-images-revert`, head `0ccac6bf` (pushed; `origin` equals the head), worktree `Shipqube-NODE24` (clean) |
| Commit | `0ccac6bf` build(docker) on main `88fd7360`; `88fd7360..main` is `docs/` and `.claude/` only; `git merge-tree --write-tree main 0ccac6bf` is clean |
| Diff | 5 Dockerfiles (1 `FROM` line each), `.github/dependabot.yml` (+8), `tools/ci/sec-static.test.ts` (+2) |
| Bindings read | D-ARCH-001 / ADR-0001 (Node 24 LTS), D-ARCH-116 (rules 1-3), D-ORCH-061 R2/R3, D-DEVOPS-001 (observation), D-DEVOPS-002; root `package.json` `engines`, `.node-version`; Dependabot #50 `0b1efbb2`; the PR25-SEC-02 Dependabot block and the D-ORCH-027 test of `sec-static.test.ts`; `.orch/laneb-queue/prep-chore-node24.*` |
| Reviewer | code-reviewer, 2026-11-21 (orchestrator session C dispatch; D-CRCHORE-01) |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The five Dockerfiles are byte-identical to 7db3b8b5, the parent of #50 and the only commit since that touched
         them, so the debian:trixie-slim runtime pins and every other line are as reviewed before. Node 24.22.3-trixie
         + debian trixie keeps codename parity, and the ignore keeps 24.x bumps in the one docker-images group, so
         D-ARCH-116 rule 3 holds. One MINOR (no static guard on the node major), one NIT; the api image build is owed.
```

## 1. What I verified myself

Dispatch constraints: git, grep and reads only. No npm, Jest, Docker or Node.

| Check | How | Result |
|---|---|---|
| Revert = pre-#50 | `git log -1 0b1efbb2` (parent `7db3b8b5`, 5 files, 5 lines); `git diff --quiet 7db3b8b5 0ccac6bf -- <5 Dockerfiles>`; `git log 7db3b8b5..main -- <5 Dockerfiles>` | Byte-identical; #50 is the only commit on those paths since `7db3b8b5`, so the revert drops nothing else |
| Pins | `git grep '^FROM'` at `0ccac6bf` | api, worker, web, admin and prisma: `node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0`. api, worker, prisma runtime: `debian:trixie-slim@sha256:a72b4433...` (unchanged by #50 and by this PR). web/admin runtime: the nginx pin, unchanged |
| No Node 26 left | `git grep '26\.13\.0\|5adad64f'` at `0ccac6bf` outside `docs/` and `.claude/` | None. The Node 24 digest is the one `check-dockerfiles.test.ts:27` already uses |
| Engines | `package.json` `engines.node ">=24.2 <25"`, `.node-version` `24`, `engine-strict=true` | 24.22.3 satisfies all three; Node 26 did not (D-DEVOPS-001's observation is right) |
| D-ARCH-116 rule 1 (codename parity) | node tag `trixie` vs runtime `debian:trixie-slim` | Holds |
| D-ARCH-116 rule 3 (node and debian move together) | `.github/dependabot.yml:57-67` | The ignore removes only node semver-major. Dependabot then offers the highest non-ignored tag with the same `-trixie-slim` suffix (24.x), still in the single `docker-images` group (`patterns: ['*']`) together with any `debian:trixie-slim` digest bump. Holds |
| Dependabot syntax | same | `dependency-name: node` is the Docker Hub library image name the `docker` ecosystem reports. `update-types: ['version-update:semver-major']` is valid; Dependabot parses `24.22.3-trixie-slim` as version 24.22.3 with a suffix. Same shape as the npm `typescript` ignore |
| sec-static pin | `sec-static.test.ts:307` | The parsed docker entry gains exactly this ignore; the D-ORCH-027 test is untouched |
| New gitleaks hits | over-approximating grep of the generic-api-key rule over `88fd7360..0ccac6bf` | None |
| Conflicts with #85 and #86 | `git merge-tree --write-tree` pairwise and of all three | Clean; disjoint hunks in `dependabot.yml` (docker block here, docker-compose block in #86) and `sec-static.test.ts` |

Developer evidence, not re-run: `check-dockerfiles --root .` 5 files and 0 findings; `sec-static`, `check-dockerfiles`, `check-install-flags` 155/155 (D-DEVOPS-002). **Not run by anyone:** the image build. `.orch/laneb-queue/prep-chore-node24.out` was empty when I reviewed.

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `tools/ci/check-dockerfiles.mjs` (no rule); `apps/*/Dockerfile:8`, `prisma/Dockerfile:16` | Nothing static ties the major of the `node:` base to `.node-version` and `engines`. #50 reached main because the only signal is an image `npm ci` that fails at build time, and lane B `--profile pr` builds no images. The ignore closes the automated path, but a hand edit or a later Dependabot config change would slip the same way. | devops-engineer follow-up, not a merge condition. A `check-dockerfiles` rule (or a sec-static case) that every `FROM node:<v>-...` major equals `.node-version` and satisfies `engines.node`, with a node:26 negative fixture. |
| R1-n1 | NIT | `.github/dependabot.yml:8-10` | The header lists only the typescript ignore and says "Other majors stay visible for review on purpose". | Same as PR-0086 R1-n1: one header bullet for the Node and Valkey ignores, carried by whichever PR merges second or by a later chore. |

## 3. Merge conditions

1. The api image `docker build` on `0ccac6bf` with the current lockfile (the queued `prep-chore-node24.sh`), with the result in the PR body as D-DEVOPS-002 promises. The byte-identity proof shows the Dockerfiles are the last reviewed ones. It does not show they build: the lockfile has moved since `7db3b8b5` (#84's 28 updates, among others).
2. Merge after #85; #86 and #87 commute (PR-0086 section 4). Lane-B reading as in PR-0086 condition 2: on this head the expected reds are the 2 PR080-SEC-07 fingerprints only. Once #85 is on main, a run without a merge of main stops `gitleaks-full` with exit 2 (count 22 vs 17).
3. Hosted CI when billing returns.

## 4. Good

- A pure revert to a known commit, proven by `git diff --quiet` and not by eye, plus the one config line that stops the recurrence.
- The ignore is scoped to semver-major, not to `node` as a whole, so Node 24 security patches keep arriving with the debian base (the alternative D-DEVOPS-002 rightly rejected).
