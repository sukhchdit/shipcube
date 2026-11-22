# Security review: PR #93 Dependabot regression repair (#90 to #92) and PR87-SEC-01 closure (D-DEVOPS-005), round 1

| Field | Value |
|---|---|
| PR | #93, branch `chore/dependabot-regressions-90-92` (worktree `Shipqube-NODE24`, read by SHA only, not touched), merge base `dde82c09`, event base `3079e2f7` |
| Head | 1b8db071ba8f1b2c3fa1e4bfa4bbfca9d7b03791 |
| Owned paths | 14, by main's `tools/ci/check-security-owned-paths.mjs` with `--base origin/main --head 1b8db071`: `.github/dependabot.yml`, the five Dockerfiles (`apps/admin`, `apps/api`, `apps/web`, `apps/worker`, `prisma`), `compose.yaml`, `package-lock.json`, `package.json`, `tools/ci/check-dockerfiles.mjs`, `tools/ci/check-dockerfiles.test.ts`, `tools/ci/check-node-security.mjs`, `tools/ci/check-node-security.test.ts`, `tools/ci/sec-static.test.ts` |
| Bindings read | D-ORCH-179, D-ORCH-180, D-ORCH-181 (the D-DEVOPS-005 renumbering line); D-DEVOPS-002, D-DEVOPS-004; D-SECCHORE-01 (PR-0087 record, PR87-SEC-01), D-SECCHORE-02, D-SECPUB-01; ADR-0001 / D-ARCH-001 (Node 24 LTS); D-ARCH-116 rules 1 and 3; ADR-0023 am. J item 4 (maintenance rule); PR25-SEC-02 (parsed Dependabot pins); PR30-SEC-08 (compose rustfs equals the harness pin); the PR body; code review twin `docs/05-quality/reviews/PR-0093-code-review.md` (D-CRCHORE-03, APPROVED_WITH_NITS). **D-DEVOPS-005 itself does not exist yet** on the branch or on main (code review R1-m3, MC-2); its content was read from the PR body and the commit messages. |
| Main when written | `3e09c5db` (= `origin/main` at commit time). Since the merge base, main has changed only `docs/` and `.claude/` paths |
| Reviewer / date | security-analyst, 2026-11-22 (orchestrator session D; D-SECCHORE-03) |
| Method | Static plus targeted single-process Node probes on `git archive` extracts of the head. **Registry:** Docker Hub HEAD requests for current tag digests; anonymous GETs of the aws-cli index, amd64 manifest and config, each body hashed against its digest. **Node releases:** `https://nodejs.org/dist/index.json` (fetched today). **Dependabot:** the job logs of runs 44980363263 and 44980382471 (`gh run view --log`), dependabot-core `main` (`docker/lib/dependabot/docker/requirement.rb`, `version.rb`, `common/lib/dependabot/config/ignore_condition.rb`). **npm:** lockfile tuple delta main to head; registry packuments (licence, publish time, integrity), `dist.signatures` verified against `-/npm/v1/keys`, the npm bulk advisory endpoint and OSV `querybatch`, each with a positive control; GitHub repository advisories for stylelint, stylelint-use-logical, aws-cli and rustfs. **CI:** hosted run 44989509938 on the head (`gh run view --json jobs`, step logs). **Not used:** Docker (no image built, pulled or run; `docker.lock` never taken), Jest, the PR worktree. No `.env*` file was opened. |

## 1. Summary

**Verdict:** PASS_WITH_CONDITIONS. No Critical, High or Medium finding. One LOW (PR93-SEC-01) and three INFO (PR93-SEC-02 to -04). PR87-SEC-01 is **closed** (section 7).

- **The three reverts are byte-exact.** The five Dockerfiles equal `7cc7d2e4` (#87), `package.json` and `package-lock.json` equal `95cb411d` (#91, before #92), and the compose rustfs line equals the line before #91 and `RUSTFS_IMAGE` (`apps/api/src/platform/storage/tests/rustfs.ts:14`). The only kept Dependabot change is aws-cli 2.40.3 (`compose.yaml:86`).
- **Correction to the dispatch framing.** `node:26.13.1` (#90) does **not** lack the 2026-11-11 security release. `index.json` marks 26.13.1 `security: true` (2026-11-10), and it is the 26.x fixed version that PR-0087 section 3 names. 24.22.3 and 26.13.1 carry the same fix set and bundle the same OpenSSL 3.5.9. #90 is a policy and availability regression (ADR-0001, `.node-version`, `engines` `>=24.2 <25` with engine-strict refuse Node 26 in every image `npm ci`), not an advisory regression. Restoring 24.22.3 is security-neutral, and 24.22.3 is still the newest 24.x and its newest security release today.
- **Correction to D-ORCH-179's "the ignore did not hold".** The job logs confirm the PR's race analysis: the #87 ignore held in the job that #87 triggered, and #90 came from the job triggered by #86's push, which had no node ignore but cloned the tree after #87 (section 4).
- **The new controls work for the canonical spelling.** node-major catches #90 (10 findings on main's Dockerfiles), fails closed on every unreadable policy input, and agrees with npm `semver` on 200,000 fuzzed engines ranges (0 differences, mutation control 1,662). check-node-security fails closed (exit 2) on every malformed input I tried. Residuals: other registry spellings of the node image pass every Dockerfile rule (PR93-SEC-01), and both tools read the tag, not the digest (PR93-SEC-02).
- **Dependency policy holds for everything the PR keeps or adds:** 39 restored npm tuples, the Node image, aws-cli 2.40.3 and rustfs 1.0.4 (section 6).
- **Condition:** hosted lane A has not run lint, type-check, unit or build on the head, because the lane B evidence is stale (code review R1-m1, MC-1).

## 2. What the PR changes

| Area | Change | Proof |
|---|---|---|
| Node base | Five `FROM` lines back to `node:24.22.3-trixie-slim@sha256:af02d57b…f124a0` (`apps/api/Dockerfile:8`, `apps/worker/Dockerfile:8`, `apps/web/Dockerfile:8`, `apps/admin/Dockerfile:8`, `prisma/Dockerfile:16`) | `git diff 7cc7d2e4 1b8db071` on the five files is empty |
| Stylelint | `stylelint` 18.0.0 back to 17.16.0; lockfile restored | `git diff 95cb411d 1b8db071 -- package.json package-lock.json` is empty |
| Compose | rustfs 1.0.5 back to the 1.0.4 harness digest; aws-cli 2.40.3 kept | `git diff 6351e15b 1b8db071 -- compose.yaml` (the tree before #90) shows only the aws-cli line |
| Dependabot | docker `node` ignore becomes `versions: ['>= 25.a']` (`.github/dependabot.yml:79-80`); npm `stylelint` semver-major ignore added (`:36`); header notes | sec-static pins both (PR25-SEC-02) |
| Gates | check-dockerfiles rule `node-major`; new local tool `tools/ci/check-node-security.mjs`; tests; CI-CD.md section 6 (hand-bump rule) | sections 5 and 7 |
| `1b8db071` | Comment and doc text only (`D-DEVOPS-004` renamed to `D-DEVOPS-005` in 11 lines) | `git show 1b8db071` read line by line; no code, YAML key or test assertion changed |

## 3. The Node base

| Pin | Index digest today (Docker Hub HEAD) | index.json |
|---|---|---|
| This PR: `node:24.22.3-trixie-slim` | `af02d57b…f124a0`; `24-trixie-slim` resolves to the same digest | 24.22.3, 2026-11-10, `security: true`, OpenSSL 3.5.9; newest 24.x and newest 24.x security release |
| Reverted (#90): `node:26.13.1-trixie-slim` | `e6bedef2…8820bc`, equal to #90's pin | 26.13.1, 2026-11-10, `security: true`, OpenSSL 3.5.9 |

- The image itself is unchanged since PR-0087 section 2 (same index digest), so that record's layer and rootfs analysis applies unchanged.
- No Node security release after 2026-11-11 on any line (22.23.5 is the newest 22.x one).
- The live `check-node-security` run on the head extract prints `OK: pinned node:24.22.3; newest 24.x 24.22.3; newest security release 24.22.3 (2026-11-10)` (exit 0).

## 4. Dependabot

- **The race, verified from the job logs.**
  - Run 44980363263 (job `1721094313`) was triggered by `25dfd72f` (#86) at 03:22:54Z. Its job definition has `"ignore-conditions":[]`, it logs `Base commit SHA: 7cc7d2e4` (#87's merge), and it logs `Updating node from 24.22.3-trixie-slim to 26.13.1-trixie-slim` five times. That job opened #90.
  - Run 44980382471 (job `1721094357`) was triggered by `7cc7d2e4` at 03:23:09Z. It carries the node `version-update:semver-major` condition, logs the same base commit, and logs `No update needed for node 24.22.3-trixie-slim` five times.
  - So a job takes its configuration from the triggering commit and its tree from the default branch when it starts. No configuration closes this. PR87-SEC-01 was "live" only in the sense that nothing in the repository refused the result.
- **`versions: ['>= 25.a']` does what the comment says.** `IgnoreCondition#ignored_versions` passes `versions` through unchanged. `Docker::Requirement` is a `Gem::Requirement`, and `satisfied_by?` compares the tag's `release_part` (`26.13.1-trixie-slim` gives 26.13.1). `25.a` sorts below every 25.x release and pre-release, and 24.x is below it. Unlike the relative semver-major type, the range stays the same when the file already holds 26. GitHub's `.github/dependabot.yml` validation check passes on the head.
- **Image ecosystems get no Dependabot security updates**, so the `versions` list cannot suppress one.
- **Relative ignores left.** stylelint (npm) uses `update-types: semver-major`. Its repository-side guard is `npm ci` ERESOLVE, which lasts only while `stylelint-use-logical`'s peer range stays below 18. I concur with code review R1-n1 (`versions: ['>= 18.a']`); the impact is a lint-tool major, so no separate ID. Valkey (docker-compose) stays relative, but its guard is repository-side and does not depend on upstream (compose-stack harness equality, PR86 follow-ups).

## 5. Probes of the new controls

Run on a `git archive` extract of the head (`tools/ci/check-dockerfiles.mjs`, `npm-command.mjs`, `check-node-security.mjs`, root `package.json`, `.node-version`, the five Dockerfiles). Main's `node_modules/semver` 7.8.6 was the oracle.

**node-major (`tools/ci/check-dockerfiles.mjs:426-458`).**

| Probe | node-major | All rules, repository mode |
|---|---|---|
| P1 head tree | 0 | 0 |
| P2 main's #90 Dockerfiles, head checker | 10 (major and engines, times 5) | |
| P3 api `FROM node:26.13.1-…` (Dependabot spelling) | 2 | 3 (+ runtime-codename (b)) |
| P3 `node:22.23.5-…` | 2 | 3 |
| P3 `node:24.1.0-…` (below the engines floor) | 1 | 2 |
| P3 `docker.io/library/node:26…`, `docker.io/node:26…`, `--platform=$BUILDPLATFORM node:26…`, lower-case `from … as` | 2 each | 3 each |
| P3 `node:lts-trixie-slim@…` | 1 | 3 |
| P3 `node:26.13.1-trixie-slim` without a digest | 2 | 5 (+ from-digest) |
| P3 `index.docker.io/library/node:26…`, `registry-1.docker.io/library/node:26…`, `mirror.gcr.io/library/node:26…`, `public.ecr.aws/docker/library/node:26…` | **0** | **0** (PR93-SEC-01) |
| P3 tag `24.22.3` with the node:26 digest | **0** | 1 (runtime-codename (b) only, because one file differs; PR93-SEC-02) |
| P4 `.node-version` `v24.22.3` | 0 | |
| P4 `.node-version` `lts/krypton`, missing, or `26`; `engines.node` `^24.2.0`, missing, or `>=24 <24.2` | 5 each (fail closed) | |
| P5 `satisfiesEngines` against `semver.satisfies`, 200,000 random ranges in the documented subset (`>= > <= < =`/bare, partial versions, optional space after the operator, `\|\|`) | 200,000 read, 68,129 satisfied, **0 differences** | control: `>` rewritten as `>=` gives 1,662 differences |

**check-node-security (`tools/ci/check-node-security.mjs`).**

| Probe | Exit | Note |
|---|---|---|
| N1 head, today's index | 0 | OK line as in section 3 |
| N2 index plus `v24.23.0` `security: true` | 1 | BEHIND, names both versions |
| N3 index plus `v24.23.0` `security: false` | 0 | |
| N4 to N8 index an object, entry without `version`, no 24.x release, not JSON, file missing | 2 each | |
| N9 index plus `v24.23.0` with `security: "true"` (a string) | **0** | a schema drift reads as "no security release" (PR93-SEC-02) |
| N10 api on `node:24.10.0`, the others on 24.22.3 | 2 | "found 2: 24.22.3, 24.10.0" |
| N11 api on `mirror.gcr.io/library/node:24.10.0` | **0** | the api pin is invisible (PR93-SEC-01) |
| N12 api on the floating `node:24-…` | 2 | |
| F1 to F5 fake fetch: 200, 404 (1 call), 503 (3 calls), thrown redirect error (3 calls), 200 non-JSON (3 calls) | 0, 2, 2, 2, 2 | |
| F6 real `fetch` against a loopback server that answers 302 | 2 | `redirect: 'error'` reaches the real fetch; 3 calls |

The outbound request is a fixed HTTPS URL with no credentials and no user input (no SSRF surface), with a 20 s timeout over headers and body and 3 attempts with backoff and jitter. The tool changes nothing; it prints and exits.

## 6. Dependency policy (what the PR keeps or adds)

| Component | Licence | Advisories | Release age | Maintained |
|---|---|---|---|---|
| `node:24.22.3-trixie-slim` (restored) | Node.js MIT; Debian packages unchanged since PR-0087 | the 2026-11-11 fixed version; no later Node security release | image created 2026-11-11 (11 days) | Node 24 maintenance LTS until 2028-04-30 |
| `stylelint` 17.16.0 and 38 transitive tuples (restored; 3 removed: `stylelint` 18.0.0, `cosmiconfig` 10.0.1, `write-file-atomic` 8.0.0) | 32 MIT, 5 ISC, 1 BSD-3-Clause, `svg-tags` 1.0.0 MIT through the legacy `licenses` array; all on the allowlist | npm bulk 0 (control `braces@3.0.2`: 1); OSV 0 (control: 1); GitHub: stylelint's only advisory is `< 15.10.1` (low), `stylelint-use-logical` has none | youngest `table` 6.10.1 at 17 days, `stylelint` 17.16.0 at 51 days | `stylelint` (direct) released 18.1.0 on 2026-11-20; `stylelint-use-logical` (direct, unchanged) 2026-02-04, repository not archived. 24 transitive packages have no release in 18 months: all dev-only, report-only under ADR-0023 am. J item 4, and the same set main carried until #92 |
| | All 39: registry integrity equals the lockfile, `dist.signatures` verify (tampered-integrity control fails), no install scripts, all `dev`, one host (`registry.npmjs.org`) | | | |
| `amazon/aws-cli:2.40.3` (kept from #91; `storage-init`, local compose only) | Apache-2.0 (`LICENSE.txt` at tag 2.40.3) | GitHub repository advisories affect v2 up to 2.35.2 only | created 2026-11-13T19:10Z; 8.3 days when #91 merged (03:30Z today) | monthly releases (2.42.1 is current) |
| `rustfs/rustfs:1.0.4` (restored; local compose and the storage harness) | Apache-2.0 | every published GHSA affects up to 1.0.1 (newest published 2026-10-18); see PR93-SEC-04 for 1.0.5's unadvised fixes | released 2026-10-25 | 1.0.5 and 1.0.6 out |

- aws-cli: the index, amd64 manifest and config bodies hash to their digests; linux/amd64 and arm64; base Amazon Linux 2023.12.20261112.0. The user is unset (root), as in 2.39.7, and the compose service keeps `read_only`, `cap_drop: ALL`, `no-new-privileges` and a tmpfs `/tmp`. Lane B `--profile pr` does not run it (code review R1-n6).
- Hosted lane A on the head ran these supply-chain steps green: lockfile provenance and delta, release cooldown and freshness, `npm ci --ignore-scripts`, licences, registry signatures and provenance, vulnerability audit (npm audit plus osv-scanner). ci-gate's Gitleaks (PR range) and Semgrep are green too.
- No new npm dependency: both tools use Node built-ins only.

## 7. PR87-SEC-01: closed

| Part of the PR-0087 remediation | Delivered | Ruling |
|---|---|---|
| (a) check-dockerfiles rule: node major equals `.node-version`, version satisfies `engines.node` | `node-major`, repository mode, fail closed, tested; runs through the "repository Dockerfiles" unit test in lane A and lane B (lane B `20261122T0507Z_36b072c` lists them passed on `36b072cc`) | Met for the canonical spelling that Dependabot preserves. Residuals: PR93-SEC-01 (other registry spellings), PR93-SEC-02 (tag, not digest) |
| (b) security-release comparison, "lane C or nightly" | local tool, exit 0/1/2, offline `--index` seam, 20 unit tests; CI-CD.md section 6 item 3 assigns runs to the orchestrator and devops-engineer | **Ruling on code review R1-m4:** accepted as closing (b) of an INFO finding, because it adds a working comparison where none existed and the hand-bump rule (c) gives it a consequence. It is not yet enforced by anything a gate reads, so PR93-SEC-03 (INFO) tracks the binding |
| (c) hand-bump rule without waiting for the cooldown | CI-CD.md section 6: within 2 working days, all five FROM lines at the security release's current index digest, debian pin if rebuilt, lane B on the head; a new major needs a superseding ADR | Met. It matches the reasoning of PR87-SEC-01 (an official nodejs.org security release is the reasoned exception to the 7-day cooldown) |
| Verification: fixtures for `node:26` and `node:22` refused; a fixture index with a newer 24.x `security: true` fails | `node:26` fixture and CLI test in the head; `node:22` not a fixture, but P3 shows it refused; N2 above and the head's own index fixtures | Met |

**On code review R1-m2 (no node-major signal on a Dependabot PR before merge):** I concur. Lane A stops at "Lane B evidence" before "Unit tests" on every Dependabot PR. With the user merging Dependabot PRs without green CI and no branch protection on main (D-DEVOPS-004 item 1, owner-only), node-major as delivered detects a #90-class change after the merge. One security addition to R1-m2's fix: the new fast-lane step must run `check-dockerfiles.mjs` from the tested base copy (the `TOOLS_REF` / `$GATE_*` pattern, SEC-P3-31, PR46-SEC-17), not from the head, like every other gate step. The real control remains the D-DEVOPS-004 ruleset requiring `ci-gate`.

## 8. Findings

| ID | Severity | Title |
|---|---|---|
| PR93-SEC-01 | LOW | Node base rules recognise only the `[docker.io/][library/]node:` spelling; any other registry host for the same image passes every Dockerfile rule and check-node-security |
| PR93-SEC-02 | INFO | node-major and check-node-security trust the tag and the index schema |
| PR93-SEC-03 | INFO | The security-release comparison (PR87-SEC-01 (b)) is not bound to any gate |
| PR93-SEC-04 | INFO | rustfs 1.0.4 stays behind 1.0.5/1.0.6, whose notes list unadvised authorization fixes |

### PR93-SEC-01 (LOW): other registry spellings of the node image pass every Dockerfile rule

- **CWE:** CWE-184 (Incomplete List of Disallowed Inputs). **OWASP:** A06:2021 Vulnerable and Outdated Components.
- **Where:** `tools/ci/check-dockerfiles.mjs:164` (`IMAGE_PREFIX` = optional `docker.io/` and `library/`), `:174-178` (`baseImageKind`), `:312` (`NODE_TAG_VERSION`), `:432` (node-major skips any FROM that is not kind `node`); `tools/ci/check-node-security.mjs:49` (the same prefix).
- **Description:** a FROM reference such as `index.docker.io/library/node:…`, `registry-1.docker.io/library/node:…`, `mirror.gcr.io/library/node:…` or `public.ecr.aws/docker/library/node:…` is the same image (or a mirror of it) but is not kind `node`. Probe P3: one api Dockerfile moved to Node 26 that way gives 0 findings under every rule, including the existing runtime-codename (b) byte-identity check. Probe N11: check-node-security then reports OK from the other four files while the api image would run 24.10.0. `from-digest` does not help: these references carry a tag and a digest.
- **Exploitability / impact:** Dependabot keeps the existing spelling, so the automated path that produced #50 and #90 cannot reach this. It needs a hand edit in a security-owned path that the record checker sends to review. A major change would still fail the image `npm ci` under engine-strict. A within-major downgrade (for example to a 24.x without the 2026-11-11 fixes) would build and ship. Impact medium, likelihood low: LOW. The gap predates this PR for runtime-codename (b); the PR extends the same predicate to node-major and the security tool.
- **Remediation** (devops-engineer, in the next devops chore that touches `tools/ci`, before G3):
  - Classify by repository, not by prefix: strip a leading registry host (a first path component that contains `.` or `:`, or is `localhost`), then `library/` or `docker/library/`, and treat the reference as kind `node` (or `debian`) when the remaining repository is `node` (or `debian`).
  - Add a rule that a `node` or `debian` base uses the canonical spelling `node:…` / `debian:…` with no registry host, so every node rule sees one form.
  - Use the same classifier in `pinnedNodeVersion`.
- **Verification:** unit rows for the four spellings above: each gives node-major and runtime-codename findings, and check-node-security exits 2 ("found 2") on the N11 tree. The canonical-spelling rule refuses each of them.

### PR93-SEC-02 (INFO): the tools trust the tag and the index schema

- **CWE:** CWE-345 (Insufficient Verification of Data Authenticity); CWE-754 (Improper Check for Unusual or Exceptional Conditions). **OWASP:** A08:2021 Software and Data Integrity Failures.
- **Where:** `tools/ci/check-dockerfiles.mjs:312` and node-major (version from the tag only); `tools/ci/check-node-security.mjs:82` (`security === true`), `:90`.
- **Description:** two small gaps.
  - **Tag versus digest.** Docker pulls by digest and ignores the tag, but both tools read the tag. Probe P3: tag `24.22.3` with the node:26 digest gives no node-major finding; only runtime-codename (b) fires, and only because the other four files differ. If all five carried such a pair, nothing would fire. Dependabot writes matching pairs, so this needs a hand edit, as in PR93-SEC-01.
  - **Index schema drift fails open.** An entry whose `security` is not a boolean counts as "not a security release" (probe N9 exits 0). If nodejs.org ever renamed or retyped the field, the tool would report OK indefinitely.
- **Exploitability / impact:** none at the head (tag and digest match: Docker Hub HEAD today; the index uses booleans). Hardening only.
- **Remediation** (devops-engineer, optional, with PR93-SEC-01): in check-node-security, which already goes online, resolve the pinned digest's config anonymously from Docker Hub and compare its `NODE_VERSION` with the tag (exit 2 on a mismatch). Exit 2 when any entry has a non-boolean `security`, or when no entry in the whole index is `security: true`.
- **Verification:** an index fixture with `security: "true"` exits 2; a fake registry answer whose `NODE_VERSION` differs from the tag exits 2.

### PR93-SEC-03 (INFO): the security-release comparison is not bound to any gate

- **CWE:** CWE-1395 (Dependency on Vulnerable Third-Party Component). **OWASP:** A06:2021.
- **Where:** `docs/07-ops/CI-CD.md:251` (the orchestrator runs it at session start and before G3/G4); `tools/ci/check-node-security.mjs:3-4` (a different cadence, code review R1-n2).
- **Description:** the comparison exists, but only a sentence in a runbook says when it runs. No orchestrator checklist, STATUS line or gate evidence asks for its output. The "zero hosted minutes" reason predates D-ORCH-180: the repository is public, and standard hosted runners are free for it.
- **Exploitability / impact:** none today (exit 0). The window that PR87-SEC-01 described (a shipped image behind a Node security release, unbounded by any check) is now bounded only by whether someone remembers to run the tool.
- **Remediation:**
  - quality-gatekeeper: G3 and G4 evidence includes a same-day `check-node-security` exit-0 line (or the hand-bump PR when it exits 1).
  - orchestrator: the session-start run goes into the orchestrator's own start checklist, and the script and doc cadences agree (R1-n2).
  - Preferred, devops-engineer with principal-architect: a weekly scheduled hosted job running the tool (exit 1 or 2 fails the job). `nightly.yml` is `workflow_dispatch` only (ADR-0023 am. C), so a schedule needs an ADR-0023 note.
- **Verification:** the G3 dossier shows the line; or a scheduled run with a planted index fixture fails.

### PR93-SEC-04 (INFO): rustfs 1.0.4 stays behind releases with unadvised authorization fixes

- **CWE:** CWE-1395. **OWASP:** A06:2021.
- **Where:** `compose.yaml:64`; `apps/api/src/platform/storage/tests/rustfs.ts:14`.
- **Description:** the revert to 1.0.4 is correct for PR30-SEC-08 (compose equals the harness), and 1.0.4 has no published advisory. But 1.0.5 (2026-11-10) and 1.0.6 (2026-11-15) are out, and 1.0.5's release notes list fixes with no GHSA. Among them: restricting root-derived accounts and credential logs; closing identity, session and admin-authorisation gaps; canonicalising `s3:VersionId` before policy evaluation; replacing vulnerable zstd codecs.
- **Exploitability / impact:** low. RustFS is the local and test object store only. It has no host port (the edge proxy on 127.0.0.1 fronts it), its console is off, it uses local placeholder credentials, and production storage is S3 (ADR). Next month's Dependabot rustfs PR fails `[PR30-SEC-08]` by design. If the user merges it without green CI, main goes red again.
- **Remediation** (devops-engineer): one chore that moves `RUSTFS_IMAGE` and the compose pin together after a storage integration run (the "TASK-299 line" the PR body suggests), before the next monthly Dependabot run (early December) and before G3 in any case. Until then, the orchestrator triages any rustfs Dependabot PR (closes it or points it at that chore).
- **Verification:** compose-stack `[PR30-SEC-08]` green with both pins on the new digest; the storage integration suite green in lane B.

## 9. CI state, conditions, binding and routes

- **Hosted run 44989509938 on the head** (event base `3079e2f7`): fast-lane steps 6 to 14 green (section 6). Step 15 "Lane B evidence" fails, because run `20261122T0507Z_36b072c` is stale: `1b8db071` changed 5 paths outside the staleness allow-list after it. So lint, format, type-check, unit (which holds the node-major repository test) and build **did not run hosted**. ci-gate: Gitleaks and Semgrep green; "Security-owned paths need a review record" failed only because this record did not exist yet. Lane B `20261122T0507Z_36b072c` on `36b072cc` (PASS, `git_dirty` false) ran those tests. Its result holds semantically for `1b8db071`, whose delta is comment text only.
- **Conditions:**
  - **C1** = code review MC-1: lane B on the final head with its record committed, then hosted fast-lane and ci-gate green on a fresh `pull_request` event (or the D-ORCH-162 user-accepted path, recorded).
  - **C2** = code review MC-2: the D-DEVOPS-005 entry lands. It records security-relevant choices that exist nowhere else: absolute against relative ignores, the local (b) tool, the rustfs revert against the aws-cli keep. It should cite the PR93 IDs it accepts.
  - **C3:** squash-merge the head unchanged, or after an evidence-only or docs-only commit. A later change to any of the 14 owned paths (for example R1-n1's stylelint `versions` or R1-n3/-n4) needs a delta round first. A merge of main into the branch keeps this record valid while main changes no owned path the PR also changes.
- **Binding:** one `Head` row, `1b8db071ba8f1b2c3fa1e4bfa4bbfca9d7b03791` (the last owned-path change). Main's checker passes on the merge-ref simulation (with this record on main), and fails with no record, with a FAIL verdict, with the head row naming `36b072cc`, and with an owned-path change after the head.
- **Follow-ups (before G3):** F1 PR93-SEC-01 (+ -02 optional), F2 PR93-SEC-03, F3 PR93-SEC-04, F4 code review R1-m2 with the base-copy addition (section 7).
- **Routes:**
  - devops-engineer: PR93-SEC-01, -02, -04, R1-m2, D-DEVOPS-005 (C2).
  - quality-gatekeeper: PR93-SEC-03 (G3/G4 evidence line).
  - orchestrator: C1, C3, PR93-SEC-03 (start checklist), the rustfs Dependabot triage, and the two corrections in section 1.
  - principal-architect: the ADR-0023 am. C note if a scheduled job is chosen (PR93-SEC-03).

## 10. Not checked

- **Images.** None was built, pulled or run. The image `npm ci` under engine-strict on the restored base was not exercised here (it was in PR #87's period).
- **Jest.** I ran no test suite. Lane B on `36b072cc` and the code review twin (207 targeted tests on the head) cover them. The probes in section 5 exercise the head's real modules.
- **aws-cli OS packages.** Not enumerated; the image is local-only tooling with a 2026-11-12 Amazon Linux base.
- **Gitleaks.** Not run by me on the PR range; hosted ci-gate Gitleaks on `3079e2f7..1b8db071` is green.

| Item | Result |
|---|---|
| Critical / High / Medium | 0 / 0 / 0 |
| Low | 1 (PR93-SEC-01) |
| Info | 3 (PR93-SEC-02, -03, -04) |
| PR87-SEC-01 | Closed (section 7) |
| Verdict | **PASS_WITH_CONDITIONS.** The reverts are byte-exact and the restored pins are current, signed and inside the dependency policy. The Node 26 regression was a policy break, not an advisory exposure. node-major and the Dependabot `versions` range close the #50/#90 path for the canonical spelling. Conditions C1 to C3; follow-ups F1 to F4 before G3. |
