---
name: project-p5-pr30-s3-adapter
description: PR #30 (TASK-019 SPK-05 S3 adapter on RustFS) R1 @293fb62 PASS_WITH_CONDITIONS; SEC-01 MEDIUM request timeout is warn-only in the SDK; 02-04 LOW; RustFS probe facts; checks owed in TASK-014/116/147/155/162/250
metadata:
  type: project
---

The PR #30 review (TASK-019, spike plus adapter) is `docs/05-quality/security/PR-0030-TASK-019-security-review.md` (uncommitted in main when written, 2026-11-13). R1 head `293fb622d01196abd128bed0caa3b8f3444e23da`, **PASS_WITH_CONDITIONS** (C1 = SEC-01). No security-owned path changed (`apps/api/src/platform/**` and `main.ts` are NOT in CODEOWNERS; the PR body and code review claim they are), lane A computed `not-required`; the record is courtesy coverage.

- **PR30-SEC-01 MEDIUM:** `@smithy/node-http-handler` 4.14.2 (SDK 3.1162.0) only `console.warn`s when `requestTimeout` elapses unless `throwOnRequestTimeout: true`. A silent TCP server leaves a signal-less `head()` pending past 50 s; with the flag it rejects at 30.3 s (3 x 10 s). Connect timeout works (6.2 s). Fix: the flag plus a per-op `AbortSignal.any` deadline, silent-server test. Only the readiness caller exists today (2 s signal), so exposure is nil until TASK-116/147/155/162. Condition: fix in the PR's fix cycle or before the first non-readiness caller; delta review closes it.
- **02 LOW:** `presignGet` accepts `inline`, cannot force `response-content-type`; RustFS honours a signed `ResponseContentType`; no `nosniff` possible on a pre-signed response (ADR-0021 am. 2 has no delivery point; principal-architect). **03 LOW:** `head()/get()` `sha256` is the unverified metadata claim; RustFS accepts any `x-amz-meta-sha256` but verifies `ChecksumSHA256` (wrong gives 400 BadDigest); F-10 anchor rule should compare bytes. **04 LOW:** exactly one `STORAGE_*_REF` silently selects the SDK default chain; no pairing/hardened guard; ENDPOINT without PUBLIC_ENDPOINT puts the internal host in URLs.
- **INFO 05-08:** `get` unbounded without ContentLength; anchor sink conditions (shared port/credential, F-10 needs `s3:GetObject` vs ADR "PutObject only", AWS 409 ConditionalRequestConflict maps to UNEXPECTED); key grammar and tenant prefix are the callers' job; CODEOWNERS/RustFS console CORS `*`/suite-runners image list/dist tests.

**Facts verified 2026-11-13 (re-verify before relying).**
- RustFS 1.0.4 `sha256:ed9210d6...` is an OCI index, body hash equals digest, user `rustfs`, ports 9000/9001, env `RUSTFS_CONSOLE_CORS_ALLOWED_ORIGINS=*`. Image was already in local Docker.
- GET-presigned URL: HEAD/PUT/DELETE/POST all 403 (object unchanged); 10 query-tamper variants 403/400; other `Host` 403, `X-Forwarded-Host` ignored, store uses the Host header; `a/./b`, `a//b`, `..` signed raw give 400; `%2e%2e` 403; `%2f` aliases the same key. 32 concurrent `putIfAbsent`: exactly 1 created, 1 version.
- SDK 3.1162.0 closure: 27 packages, zero advisories, no install scripts; `ChecksumMode`/CRC32 default shows `x-amz-checksum-mode=ENABLED` in presigned query.
- PR #20 redactor at `fafa3b5` masks a presigned URL in 14 forms (keys `url`/`signature`/`credential`/`token` + free text).
- Error hygiene: 36 failure paths with sentinels, no leak, no console output; retries exactly 3.

**Why:** the timeout gap is the one claim in the PR (adapter header, D-TASK019-02 (3)) that was untested and false, and the same class (SDK default is warn-only or no-op) can repeat for any SDK option set via object literal.

**How to apply.**
- **Fix-cycle delta review (SEC-01):** `throwOnRequestTimeout: true` present; deadline combined with caller signal; silent-server test with a mutation; `console.warn` empty; no owned path touched (record needs no new Head row).
- **TASK-116 (anchors):** sink takes `Pick<ObjectStorage,'putIfAbsent'|'get'>` with its own credential/bucket; created:false compares bytes; 409 handling; ADR-0021 am. 1 IAM wording amended first.
- **TASK-147/162/155/250:** one typed key builder from UUIDs; presign only RLS-visible row keys and pin versionId; forced content type + attachment; route test that logs/responses carry no `X-Amz-*`; recompute against the DB hash.
- **TASK-014:** pairing guard for the two refs and hardened-env rule; PUBLIC endpoint with ENDPOINT; compose `rustfs` on 127.0.0.1 port 9000 only with Host passthrough; `.dockerignore`/image `find` for `**/storage/tests` and `*.test.js`.
- **Merge order trap:** PR #24 conflicts on services.ts/services.test.ts/health.int.test.ts (code review R1 section 5); PR #28 (W0-ACT-1) merged, so lane-B evidence (D-ORCH-034) is now required for this PR.

Related: [[project-p5-pr27-spk04-spike]], [[project-p5-pr24-audit-store]], [[project-p5-pr20-logging]], [[project-security-review-conventions]]
