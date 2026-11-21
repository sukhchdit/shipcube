# Security review: PR #86 Valkey back on the harness digest, Dependabot ignores Valkey majors (D-SECPOST-01 O-1), round 1

| Field | Value |
|---|---|
| PR | #86, branch `chore/main-red-gitleaks-valkey-baseline` (worktree `Shipqube-CHORE-VALKEY`, not touched), base `88fd7360` |
| Head | 72e3dc9f1a5aa4cfe2aab64335a80e47b62ea470 |
| Owned paths | 3, by main's `tools/ci/check-security-owned-paths.mjs` with `--base 88fd7360`: `.github/dependabot.yml`, `compose.yaml`, `tools/ci/sec-static.test.ts` |
| Bindings read | D-SECPOST-01 (O-1, C1); D-ORCH-170, D-ORCH-171, D-ORCH-172; D-DEVOPS-001; ADR-0001 (Valkey 8); PR25-SEC-02 (the parsed Dependabot pin); PR39-SEC-06; the platform.md §2.2 ACL row as pinned by `tools/compose/compose-stack.test.ts`; code review twin `docs/05-quality/reviews/PR-0086-chore-valkey-code-review.md` (D-CRCHORE-01, APPROVED_WITH_NITS) |
| Main when written | `7b7263f8` (= `origin/main` at commit time). Since each PR base, main has changed only `docs/` and `.claude/` paths |
| Reviewer / date | security-analyst, 2026-11-21 (orchestrator session C; D-SECCHORE-01) |
| Method | Static only. Anonymous Docker Hub registry reads: the image index, the amd64 manifest, and the config and layer blobs, each body hashed against its digest. Current tag digests came from HEAD requests. The installed APK database was extracted from the image layers in Node. Advisory sources: OSV `querybatch` (`Alpine:v3.24`, with a positive control that returned 25 vulnerabilities), and the 14 repository advisories of `valkey-io/valkey` read with `gh api`. dependabot-core sources read at `main`: `docker/lib/dependabot/docker/update_checker.rb`, `docker/lib/dependabot/docker_compose.rb` and `common/lib/dependabot/version.rb`. The lane-B artefacts of run `20261121T1629Z_72e3dc9` were read as files. A gitleaks emulation was run over the diff. Not used: Docker, Jest or npm. No command ran in any worktree. `infra/local/valkey/users.acl` was read for its rules. A masking mistake showed its hash fields once in the session's own output; they are not copied anywhere. No `.env*` file was opened. |

## 1. Summary

**Verdict:** PASS_WITH_FOLLOW-UPS. No Critical, High or Medium finding. One LOW finding (PR86-SEC-01) and one INFO finding (PR86-SEC-02).

- **The pin is exact and equals the harness.**
  - `compose.yaml:44` is `valkey/valkey:8.1-alpine@sha256:2602ace2…db02a`, byte-equal to the Testcontainers harness pin in all five places: `tools/quality/suite-runners.json:6`, `health.int.test.ts:35`, `rate-limit.int.test.ts:19`, `consumer.int.test.ts:25` and `retention.int.test.ts:31`.
  - Today the digest is also the `8.1.11-alpine` and `8.1.11-alpine3.24` tags.
  - No compose image is left without a digest (compose-stack `[NFR-OPS-002]` green).
- **No new advisory exposure.**
  - Valkey 8.1.11 (this PR) and the 9.1.3 it replaces carry the same single open repository advisory, GHSA-3885-pq5f-788j (High upstream). It is not reachable in this configuration (§3).
  - Their APK package sets are identical (§4).
- **The major ignore does not suppress updates within the major.** It removes only tags `>= 9.a`. The within-major channel for an `8.1-alpine` pin is a digest-only refresh, and it has two weak points (PR86-SEC-02).
- **D-SECPOST-01 O-1 closes when #86 merges.**
  - compose-stack passes 29 of 29 in lane B on `72e3dc9f`, including the case that failed on main ("postgres and valkey use the Testcontainers harness digests").
  - That run's two failures are outside #86 (D-DEVOPS-001): the open-queue Jest timeout under host load, and the merged-coverage step that carries gitleaks-full (PR080-SEC-07, PR #85).

## 2. Image pins

| Pin | Index digest | Valkey / base | Image created | Platforms |
|---|---|---|---|---|
| This PR (`8.1-alpine`) | `2602ace2…db02a` (= `8.1.11-alpine` today) | 8.1.11 / Alpine 3.24.3 | 2026-10-27 | linux/amd64, arm64, arm/v7, ppc64le |
| main, reverted (`9.1-alpine`) | `bf09d58e…fae0b` | 9.1.3 / Alpine 3.24.3 | 2026-10-26 | same |
| `8.1-alpine` = `8.1.12-alpine` = `8-alpine` today | `9971099a…fc3fc` | 8.1.12 / Alpine 3.24.4 | 2026-11-18 | same |
| `9.1-alpine` today | `56729e68…893f0` | 9.1.4 / Alpine 3.24.4 | 2026-11-18 | same |

`8.2-alpine` does not exist (404). The body hashes of the index, manifest, config and every layer blob match their digests. `VALKEY_VERSION` comes from each image's config. In every image's config, `User` is empty: the upstream entrypoint switches the user, which I did not run. This is unchanged from main.

## 3. Valkey advisories: 8.1.11 against 9.1.3

The 14 repository advisories of `valkey-io/valkey` were read on 2026-11-21. All 14 were checked against both versions; the table lists the ones that are open for, or relevant to, either version.

| Advisory | Upstream severity | 8.1.11 (this PR) | 9.1.3 (main) | Reachable here |
|---|---|---|---|---|
| GHSA-3885-pq5f-788j (CVE-2026-130822), a use-after-free when client eviction frees the client whose command still runs; published 2026-11-19 | High, CVSS 7.5 (AV:N/AC:H/PR:L) | **affected**, fixed in 8.1.12 | **affected**, fixed in 9.1.4 | No (see the list below) |
| GHSA-f4q9-j22m-xqq9, a heap overflow in cluster publish | High 8.8 | fixed (8.1.11) | fixed (9.1.3) | cluster mode is off anyway |
| GHSA-fq2f-crmw-q97r, an unauthenticated UAF in the Lua debugger | High 8.8 | not affected (9.1 only) | fixed (9.1.2) | n/a |
| The other 11 (8.1.10 and below; 9.0-only) | various | fixed | fixed or n/a | n/a |

**Why GHSA-3885 is not reachable here.** The advisory needs `maxmemory-clients` above 0. The default is 0, and "Servers with `maxmemory-clients 0` (the default) are not affected."
- `compose-stack.test.ts:204-215` pins the exact `valkey-server` command: `--aclfile`, `--appendonly yes`, `--maxmemory-policy noeviction`. An added flag turns the test red.
- `maxmemory-clients` appears in no tracked file outside `docs/` and `.claude/`.
- Client eviction cannot be switched on at run time.
  - The ACL gives `api` and `worker` `+@all -@dangerous`, and `CONFIG` is in `@dangerous`.
  - `healthcheck` has `ping` only, and `default` is off.
  - The ACL cases of compose-stack pin exactly these users.
- The Testcontainers harness runs the default configuration.

## 4. Operating-system packages

The APK databases of 8.1.11 and 9.1.3 are identical: the same 23 packages at the same versions. Both images share the Alpine 3.24.3 base layer `7b229517…`.

The current 8.1.12 image differs only in `alpine-release` and `apk-tools`/`libapk` (3.0.8 to 3.0.9), and in `tzdata`.

OSV reports the same six records for all three images, the current one included:
- Five `openssl` 3.5.9-r0 CVEs, fixed in 3.5.9-r1, published 2026-11-10, CVSS up to 7.5. They cover CMS_encrypt, two in QUIC and two in AES-GCM-SIV.
- One `zlib` record, CVE-2026-4738 (`inftree9.c`).

None is new with this PR. None is reachable here:
- Valkey here has no TLS port.
- It does not use QUIC, CMS or GCM-SIV.
- `inftree9.c` belongs to zlib's `contrib/infback9`, which the standard libz build leaves out. I took that from the zlib source layout, not from the Alpine build.

No upstream Valkey image carries `openssl` 3.5.9-r1 yet.

## 5. The Dependabot ignore (`.github/dependabot.yml:71-78`)

- **The checker.** The `docker-compose` ecosystem uses `Dependabot::Docker::UpdateChecker` (dependabot-core `docker/lib/dependabot/docker_compose.rb:14`).
- **What the ignore removes.** `version-update:semver-major` becomes the requirement `>= 9.a` for the current `8.1` (`Version#ignored_major_versions`). `filter_ignored` drops only the candidate tags that satisfy it, so 8.x tags stay candidates.
- **What reaches an `8.1-alpine` pin.** There is no `8.2` line, so the only update within the major is a digest-only refresh of the same tag (`digest_requirement_up_to_date?`). Dependabot proposes it once the new digest is older than the cooldown (7 days here). Two cases suppress it:
  - the service enables the `docker_digest_only_update_suppression` experiment for comparable tags. I cannot observe that from here;
  - the cooldown has not passed.
- **No other channel exists for images.** Container images get no Dependabot security updates, so version updates are the only automated channel, and the ignore removes majors only.
- **The pin is tested.** The parsed pin (`sec-static.test.ts:316`) fixes the exact entry. `[PR25-SEC-02]` passed in lane B on `72e3dc9f`.
- **The harness and compose must move together.** A refresh edits `compose.yaml` only. Dependabot does not edit the five harness pins, and compose-stack goes red until a person moves them in the same PR. That fails closed, but it delays the patch (code review R1-m1).

## 6. Findings

| ID | Severity | Title |
|---|---|---|
| PR86-SEC-01 | LOW | The pinned Valkey 8.1.11 (and main's 9.1.3) carries GHSA-3885 (High upstream; not reachable here) |
| PR86-SEC-02 | INFO | Valkey patch releases reach the `8.1-alpine` pin only as digest-only refreshes, and never reach the harness by themselves |

### PR86-SEC-01 (LOW): the pinned Valkey carries GHSA-3885-pq5f-788j

- **CWE:** CWE-1395 (Dependency on Vulnerable Third-Party Component); the advisory itself is CWE-416. **OWASP:** A06:2021 Vulnerable and Outdated Components.
- **Where:** `compose.yaml:44`, `tools/quality/suite-runners.json:6`, `apps/api/src/platform/health/health.int.test.ts:35`, `apps/api/src/platform/rate-limit/rate-limit.int.test.ts:19`, `apps/worker/src/platform/queues/consumer.int.test.ts:25`, `apps/worker/src/platform/queues/retention.int.test.ts:31`.
- **Description:** Valkey up to 8.1.11 (and up to 9.1.3) frees a client that is still executing when client eviction runs while blocked clients are being served. Any authenticated user who writes to a key that others block on can then crash the server. It is fixed in 8.1.12 and 9.1.4, released 2026-11-18. #86 does not introduce it: main's 9.1.3 has it too.
- **Exploitability / impact:**
  - **Impact if reachable:** High. It is a reliable crash of the store that holds the rate-limit counters, the BullMQ queues and the caches; upstream also rates C:H and I:H.
  - **Likelihood:** below the matrix's Low. The precondition (`maxmemory-clients` above 0) is absent, the exact command pin guards it, and the ACL denies `CONFIG` to every application user.
  - **Rating:** LOW, not the H×L cell, because that cell assumes a reachable path. This is one step above the INFO given to unreachable npm advisories (POST-SEC-01/02), because the component is a running service.
- **Remediation** (devops-engineer, due before G3; the 7-day cooldown of the 2026-11-18 digest ends about 2026-11-25):
  - In one PR, move compose and all five harness pins to Valkey 8.1.12 or later 8.1.x. Today that is `9971099a…fc3fc`. Prefer the patch-precision tag `8.1.12-alpine@sha256:…` (PR86-SEC-02).
  - **Trigger:** if any change before then sets `maxmemory-clients`, the bump goes first.
- **Verification:** compose-stack's harness-digest case stays green. A sec-static or compose-stack assertion that the pinned `VALKEY_VERSION` is at least the patched release is optional.

### PR86-SEC-02 (INFO): Valkey patch releases reach the pin only as digest-only refreshes

- **CWE:** CWE-1104 (Use of Unmaintained Third Party Components: the update path can stall). **OWASP:** A06:2021.
- **Where:** `.github/dependabot.yml:71-78` (the comment says "8.x minor and patch bumps still come"); `compose.yaml:44`; the five harness pins.
- **Description:** at tag precision `8.1-alpine`, with no `8.2` line, Valkey 8.1.x patch releases arrive only as a digest-only refresh (§5). That refresh does not show the Valkey version in the PR title. A service-side experiment can suppress it. It never updates the harness. The ignore itself is correct and suppresses nothing within the major.
- **Remediation** (devops-engineer, with PR86-SEC-01):
  - Pin the patch-precision tag (`8.1.N-alpine@sha256:…`) in compose and in the harness. Patch releases then arrive as version updates (`8.1.N+1-alpine`), visible and independent of the experiment.
  - Give the harness one source that compose-stack compares against (code review R1-m1).
  - Correct the dependabot.yml comment to say how patches arrive.
- **Verification:** the next Valkey patch release produces a Dependabot PR that names the version. compose-stack shows the harness moving in the same PR.

## 7. Follow-ups, conditions on the binding, and routes

- **O-1 of D-SECPOST-01:** closed when #86 merges (compose equals harness; evidence in §1). D-SECPOST-01 C1 then needs the main lane-B run without the compose-stack case (with #85 for the gitleaks pair).
- **Binding:** a later branch commit that touches an owned path needs a delta round first. A squash merge without updating the branch keeps this record valid. If #85 or #87 lands first and #86 is then updated by a merge of main, `tools/ci/sec-static.test.ts` changes after `72e3dc9f` and main's checker voids this record; a merge-only round is then owed. `.github/dependabot.yml` is the same case with #87. All pairwise `git merge-tree --write-tree` results are clean.
- **Gitleaks on the diff:** 0 findings (faithful `generic-api-key` emulation) and 0 hits (all 221 rules, over-approximating) over `88fd7360..72e3dc9f`, with the controls firing.
- **Routes:**
  - devops-engineer: PR86-SEC-01, PR86-SEC-02, and code review R1-m1 and R1-n1.
  - orchestrator: the PR86-SEC-01 due date and the D-SECPOST-01 O-1 closure on merge.

## 8. Not checked

- **The image itself.** It was not pulled or run (no Docker). The versions come from the config blobs, and the packages from the layer tarballs.
- **The Dependabot service's experiment flags.**
- **A local `redisdata` volume written by 9.1.3.** I did not check whether 8.1.11 loads one. Only developers who ran compose on main after #49 have such a volume, and it holds only ephemeral queue, counter and cache data. If Valkey refuses to start, recreate the volume. This is operability, not security.
- **Advisories outside the Valkey repository, OSV and the GitHub database.**

| Item | Result |
|---|---|
| Critical / High / Medium | 0 / 0 / 0 |
| Low / Info | 1 (PR86-SEC-01) / 1 (PR86-SEC-02) |
| Verdict | **PASS_WITH_FOLLOW-UPS.** The pin is exact and equals the harness, it brings no advisory or package exposure that main's 9.1.3 does not already have, and the major ignore keeps every update within the major. The bump to 8.1.12 (PR86-SEC-01) is due before G3. |
