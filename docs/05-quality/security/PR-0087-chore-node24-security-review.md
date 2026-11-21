# Security review: PR #87 Node 24 base images restored, Dependabot ignores Node majors (D-DEVOPS-002), round 1

| Field | Value |
|---|---|
| PR | #87, branch `chore/node24-base-images-revert` (worktree `Shipqube-NODE24`, not touched), base `88fd7360` |
| Head | 0ccac6bf5a5fadf2bcafe2f5178dee0cdbf234d7 |
| Owned paths | 7, by main's `tools/ci/check-security-owned-paths.mjs` with `--base 88fd7360`: `.github/dependabot.yml`, `apps/admin/Dockerfile`, `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/worker/Dockerfile`, `prisma/Dockerfile`, `tools/ci/sec-static.test.ts` |
| Bindings read | D-DEVOPS-001 (observation), D-DEVOPS-002; D-ORCH-171, D-ORCH-172; ADR-0001 and D-ARCH-001 (Node 24 LTS); D-ARCH-116 rules 1 and 3 (node and debian move together); PR25-SEC-02 (the parsed Dependabot pin); PR39-SEC-06; code review twin `docs/05-quality/reviews/PR-0087-chore-node24-code-review.md` (D-CRCHORE-01, APPROVED_WITH_NITS) |
| Main when written | `7b7263f8` (= `origin/main` at commit time). Since each PR base, main has changed only `docs/` and `.claude/` paths |
| Reviewer / date | security-analyst, 2026-11-21 (orchestrator session C; D-SECCHORE-01) |
| Method | Static only. **Registry:** anonymous Docker Hub reads of the index, the amd64 manifest and the config, each body hashed against its digest; HEAD requests for current tag digests. **Node releases:** `https://nodejs.org/dist/index.json` (release dates, `security` flags, bundled OpenSSL) and the nodejs.org post "Wednesday, November 11, 2026 Security Releases". **Dependabot:** the dependabot-core sources at `main` (`docker/lib/dependabot/docker/update_checker.rb`, `common/lib/dependabot/version.rb`); `gh pr view 50` for its dates. **Gitleaks:** an emulation over the diff. **Not used:** Docker, so no image was built or pulled; Jest; npm. No command ran in any worktree, and no `.env*` file was opened. |

## 1. Summary

**Verdict:** PASS_WITH_FOLLOW-UPS. No Critical, High, Medium or Low finding. One INFO finding (PR87-SEC-01).

- **The revert lowers advisory exposure.**
  - Main's `node:26.13.0` (released 2026-10-28, not a security release) predates the Node security release of 2026-11-11. That release fixes 16 CVEs: 7 High, 6 Medium, 3 Low. All 16 are listed for the 26.x line, and only 26.13.1 fixes them there.
  - `node:24.22.3` (2026-11-10, `security: true`) is that security release for the 24 line, and it is the newest 24.x. The `24-trixie-slim` tag points at the pinned digest today.
- **The pins are exact.**
  - All five `FROM` lines carry `node:24.22.3-trixie-slim@sha256:af02d57b…f124a0`.
  - The five Dockerfiles are byte-identical to `7db3b8b5`, the parent of #50.
  - No `node:` reference of another major, and none without a digest, remains outside `tools/ci/fixtures/` (lint fixtures that are never built).
  - The debian runtime pins are unchanged.
- **The operating-system layer is unchanged.** The 24.22.3 image, the 26.13.0 image and the runtime `debian:trixie-slim` pin share one Debian rootfs layer (§3).
- **The major ignore does not suppress updates within the major.** It removes only tags `>= 25.a`. Node 24.x patch and minor releases arrive as new tags (version updates) in the one `docker-images` group with debian (§4).

## 2. Pins

| Pin | Index digest | `NODE_VERSION` (OpenSSL, npm) | Image created | Debian rootfs layer |
|---|---|---|---|---|
| This PR: `node:24.22.3-trixie-slim` | `af02d57b…f124a0`, also the current `24.22.3-trixie-slim` and `24-trixie-slim` | 24.22.3 (3.5.9, 11.19.1) | 2026-11-11 | `37fb86c2…` |
| main, reverted: `node:26.13.0-trixie-slim` | `5adad64f…368072` | 26.13.0 (3.5.9, 11.20.0) | 2026-11-05 | `37fb86c2…` |
| Runtime `debian:trixie-slim`, unchanged | `a72b4433…63b6b2`, the current `trixie-slim` | n/a | 2026-11-04 | `37fb86c2…` |

All body hashes match their digests. Every image has linux/amd64, arm64/v8, ppc64le and s390x.

What ships:
- The api, worker and prisma tooling images copy only `/usr/local/bin/node` from the node image into `debian:trixie-slim` (`apps/api/Dockerfile:85`, `apps/worker/Dockerfile:80`, `prisma/Dockerfile:72`).
- web and admin use node only to build; their runtime is `nginxinc/nginx-unprivileged`.

So the shipped exposure from this pin is the Node binary itself. The Debian packages of the node image stay in build stages.

## 3. Advisory exposure: 24.22.3 against 26.13.0

The nodejs.org post for the 2026-11-11 security releases (fixed versions 22.23.5, 24.22.3 and 26.13.1) lists these CVEs. "Affects 26.13.0" means the CVE is listed for the 26.x line.

| Severity | CVEs (affects 26.13.0; fixed in 24.22.3) |
|---|---|
| High (7) | CVE-2026-123863 (HTTP/2 abort), -123864 (HTTPS zero-length write leaks heap into responses), -123865 (HTTP/2 leak at shutdown), -123866 (HTTP/2 freed memory sent to the peer), -126051 (TLS handshake callback after destroy), -123872 (TLS 1.2 renegotiation bypasses client-cert authentication), -123874 (HTTP/2 `respondWithFile` UAF) |
| Medium (6) | CVE-2026-123828, -123867, -123868, -123871 (proxy credentials in an error message), -123877 (`https.Agent` reuses TLS sessions across CA policies), -123875 |
| Low (3) | CVE-2026-123829, -123862, -106071 |

- **No newer Node security release.** nodejs.org lists none after 2026-11-11, and no pre-announcement, as of 2026-11-21. Both pins bundle OpenSSL 3.5.9.
- **Debian packages.** The three images in §2 share one Debian rootfs layer. The node image adds its usual layers, and they are build-stage only. The revert therefore changes no OS package that ships.
- **How main came to carry 26.13.0.** Dependabot opened #50 on 2026-11-15, five days after 26.13.1. With the 7-day cooldown, it offered 26.13.0, a release without these fixes, and that release was also across a major. See PR87-SEC-01.

## 4. The Dependabot ignore (`.github/dependabot.yml:57-64`)

- **What the ignore removes.** `version-update:semver-major` becomes the requirement `>= 25.a` for the current 24.22.3 (`Version#ignored_major_versions`). `filter_ignored` drops only the candidate tags that satisfy it.
- **What still arrives.** 24.x.y tags with the same `-trixie-slim` suffix and precision remain version-update candidates. They do not depend on digest-only refreshes.
- **Group membership.** The `debian:trixie-slim` codename tag keeps its digest refresh in the same `docker-images` group (D-ARCH-116 rule 3).
- **Lifetime.** Node 24 is in maintenance LTS until 2028-04-30 (Node release schedule), so security releases keep coming within the major.
- **No security-update channel.** Container images get no Dependabot security updates, so version updates are the only automated channel, and the ignore removes majors only.
- **The pin is tested.** The parsed pin (`sec-static.test.ts:307`) fixes the exact entry. The developer reports `sec-static`, `check-dockerfiles` and `check-install-flags` at 155/155 (D-DEVOPS-002). I did not run them.

## 5. Findings

| ID | Severity | Title |
|---|---|---|
| PR87-SEC-01 | INFO | Nothing checks the Node base pin against Node security releases or `.node-version` |

### PR87-SEC-01 (INFO): nothing checks the Node base pin against Node security releases or `.node-version`

- **CWE:** CWE-1395 (Dependency on Vulnerable Third-Party Component). **OWASP:** A06:2021 Vulnerable and Outdated Components.
- **Where:** `.github/dependabot.yml:50-70` (the docker ecosystem: monthly, 7-day cooldown); the five `FROM` lines (`apps/api/Dockerfile:8`, `apps/worker/Dockerfile:8`, `apps/web/Dockerfile:8`, `apps/admin/Dockerfile:8`, `prisma/Dockerfile:16`).
- **Description:** two gaps.
  - **The schedule and cooldown pick versions without regard to security releases.** With a monthly schedule and a 7-day cooldown, a Node security release reaches the images only through a Dependabot PR, up to about five weeks later. When the release is younger than 7 days on the run date, Dependabot offers the release before it, as it did with #50.
  - **No static rule ties the `node:` tag to the toolchain.** Nothing checks the major against `.node-version` and `engines.node` (code review PR-0087 R1-m1). A manual edit or an un-ignored ecosystem could again move the images to a different line with a different patch level.
- **Exploitability / impact:** none at `0ccac6bf`, which is current. This is a process gap: the window in which shipped images lack a Node security release is unbounded by any check.
- **Remediation** (devops-engineer, before G3):
  - (a) A `check-dockerfiles` rule: every `node:` tag major equals `.node-version`'s major and satisfies `engines.node`. This concurs with R1-m1.
  - (b) A lane C or nightly check: compare the Dockerfiles' Node version with the newest `security: true` release of the same major in `https://nodejs.org/dist/index.json`, and fail when it is behind.
  - (c) A recorded rule that a Node security release is bumped by hand without waiting for the cooldown. The cooldown guards supply-chain age, and an official nodejs.org security release, with signed SHASUMS and the official image, is the reasoned exception.
- **Verification:** unit fixtures for (a) (a `node:26` pin and a `node:22` pin are refused), and a fixture index for (b) in which a `security: true` 24.x newer than the pin fails the check.

## 6. Follow-ups, conditions on the binding, and routes

- **Image build.** The api image build on `0ccac6bf` (`prep-chore-node24.sh`, D-DEVOPS-002) is a code-review condition, not a security one. Its output was still empty when I wrote this record.
- **Binding.** A later branch commit that touches an owned path needs a delta round first. A squash merge without updating the branch keeps this record valid.
  - If #85 or #86 lands first and #87 is then updated by a merge of main, `tools/ci/sec-static.test.ts` changes after `0ccac6bf`, and main's checker voids this record. A merge-only round is then owed.
  - `.github/dependabot.yml` is the same case with #86.
  - All pairwise `git merge-tree --write-tree` results are clean.
- **Gitleaks on the diff.** Over `88fd7360..0ccac6bf`, the faithful `generic-api-key` emulation finds 0 and the over-approximating scan of all 221 rules hits 0. The controls fire.
- **Routes:**
  - devops-engineer: PR87-SEC-01, and code review R1-m1 and R1-n1.
  - orchestrator: the PR87-SEC-01 due date.

## 7. Not checked

- **The images themselves.** None was built or run (no Docker), so `npm ci` under engine-strict on the restored base was not exercised.
- **The Debian package list.** I did not read it. The identical rootfs layer stands in for it.
- **Reachability of each Node CVE in this API.** It is not needed: the PR removes the exposure.

| Item | Result |
|---|---|
| Critical / High / Medium / Low | 0 / 0 / 0 / 0 |
| Info | 1 (PR87-SEC-01) |
| Verdict | **PASS_WITH_FOLLOW-UPS.** The five pins are exact and current. Reverting them removes the 16 Node CVEs (7 High, 6 Medium, 3 Low) that main's 26.13.0 carries, and changes no OS layer. The major ignore keeps every Node 24 update. |
