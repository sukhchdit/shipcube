---
name: project-p5-pr27-spk04-spike
description: PR #27 (TASK-018 SPK-04 audit write spike) R1 @aa1cfb1 PASS_WITH_FOLLOW-UPS; ESLint k6 block verified scoped; PR27-SEC-01 LOW image-exclusion gap (TASK-014), 02-05 INFO; k6 digest registry facts; checks owed in TASK-014/025/030/033/280
metadata:
  type: project
---

The PR #27 review (TASK-018, spike, test-only) is `docs/05-quality/security/PR-0027-TASK-018-security-review.md` (uncommitted in main when written, 2026-11-13). R1 head `aa1cfb1c6c12d154e5a33482235235459b389551`, PASS_WITH_FOLLOW-UPS. Only owned path: `eslint.config.mjs` (6-line `tests/load/**/*.js` block).
- **Findings:** PR27-SEC-01 LOW: no `.dockerignore`/Dockerfile exists yet, and the planned `tests` entry (platform.md:233) is root-anchored, so it misses `prisma/tests` (SPK-08 and SPK-04 throwaway audit DDL plus an unauthenticated harness server). Owner TASK-014: `**/tests`, explicit `COPY` paths, a static test and an image-content `find`. 02 INFO: runner assertions mirror the SPK-08 prototype (FORCE RLS on `audit_entries`, `tgenabled='O'`, `evtenabled='O'`; product = no RLS and ENABLE ALWAYS 'A', D-ARCH-076), superuser legs are 2 of 4. 03 INFO: undocumented `SPK04_BIND`, `...process.env` to children. 04 INFO: k6 container Docker defaults (lane-B reuse). 05 INFO: PR3-SEC-11/SEC-TC-18 still open, threat-model T-88/AC-53/SEC-TC-18 and nfr-traceability NT-AUDIT-005-a still say `APP_ENV=benchmark` (should be `{local,test}`); that text alignment is MY follow-up before the `-bench` profile PR (TASK-030/280).
- **Code review R1 was CHANGES_REQUESTED** (recommends dropping `server.ts`, `runner.ts`, fixtures 20/30; PR #24 deletes the SPK-08 files the runner reads). A drop-plus-doc fix commit keeps my record valid (no owned path). Any change to `eslint.config.mjs`, including via a main merge, voids it: open PRs #20 and #24 both edit that file (text merge clean), so whichever merges later needs a merge-only round.

**Facts verified 2026-11-13. Re-verify before relying on them.**
- **k6 pin:** `grafana/k6@sha256:5221b620…` is an OCI index (sha256 of body equals digest), amd64/arm64 image manifests identical to the moved `2.2.0` tag (only attestation manifests differ), user 12345, created 2026-08-10. Registry probe needs no Docker: anonymous token from `auth.docker.io`, GET manifests/blobs at `registry-1.docker.io`, tag list from `hub.docker.com/v2/repositories/<repo>/tags`.
- **Effective-config diff method works:** `calculateConfigForFile` over ~49 paths on two `git archive` extracts, scrub the root path, diff leaves, plus a mutation control (widened glob, rule off) to prove sensitivity. `eslint.config.mjs` needs `tools/eslint-rules`, `tools/lint` and workspace `package.json` files in the extract (WORKSPACE_DIRS reads the disk).
- **Non-type-aware harness lint:** `overrideConfig: [{...tseslint.configs.disableTypeChecked (a single object, not an array), files}, {parserOptions.projectService:false, rules:{'import-x/no-unresolved':'off','import-x/no-cycle':'off'}}]` lints TS files cheaply. Product-to-harness imports are stopped by the protected `import-x/no-relative-packages`.
- **Fixtures:** data-model §5.7 block is verbatim in fixture 20 (11/11 statements); no role creation, no SECURITY DEFINER; SPK-08 SQL read in place, all of `prisma/tests` outside `spk04` unchanged.
- **Scratchpad is shared across sessions** (`.../scratchpad/review/PR-NN-*` persist): `PR-25-sec/scripts/gl-emul-multi.mjs` + `PR-25-sec/cfg/gl-default.toml` (Gitleaks emulation), `PR-27-sec/record-sim.sh` (nine-scenario record simulation incl. main-side owned change and drop-the-harness), `PR-27-sec/effcfg.mjs`, `lintts.mjs`, `evscan.mjs`, `k6digest.mjs`.
- **Dirty flag:** the 150 rps run says `dirty:true` (likely run 1's untracked evidence directory); harness delta c037470 to head is path-only (code review R1-n4 agrees).
- **ADR-0007 amendment 10 (D-ARCH-085..089)** sat uncommitted in main's working tree during the review: head-row `FOR UPDATE` lock, 250 ms `DB_AUDIT_LOCK_TIMEOUT_MS` set in-statement, per-tenant admission bulkhead, sub-streams deferred, harness lifecycle condition "not in any image".

**Why:** the image-exclusion gap is the one item nobody else tracks and it grows with every spike that parks SQL or servers under `prisma/tests`.

**How to apply.**
- **TASK-014 review:** `.dockerignore` matcher test for `prisma/tests/spikes/**` and `tests/load/**`; no `COPY .` or bare `COPY prisma`; image `find` for `*/prisma/tests*` and `*/tests/load*` is empty for every image.
- **TASK-030 review:** nothing imported from `prisma/tests`; `lock_timeout` via `set_config(..., true)` only; 503 `AUDIT_LOCK_TIMEOUT` generic with no tenant id in labels; rollback of the business transaction (fail closed).
- **TASK-025 review:** admission key from server-side context only; the shared `anonymous` bucket (T-85) needs an edge rate-limit case.
- **TASK-033 / TASK-280:** product-state integrity assertions (no `audit_entries` RLS, 'A' triggers), the four superuser legs plus TRUNCATE, fail-closed evidence step, hardened k6 `docker run` flags.

Related: [[project-p5-pr12-spk08-audit]], [[project-p5-pr24-audit-store]], [[project-p5-pr25-ci-followups]], [[project-security-review-conventions]]
