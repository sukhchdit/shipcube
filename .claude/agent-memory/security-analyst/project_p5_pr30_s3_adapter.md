---
name: project-p5-pr30-s3-adapter
description: PR #30 (TASK-019 SPK-05 S3 adapter on RustFS) R1 @293fb62 PASS_WITH_CONDITIONS, R2 @5f45a8b PASS_WITH_FOLLOW-UPS (C1 closed); open SEC-04 LOW + INFO 06-11; RustFS probe facts; checks owed in TASK-014/116/147/155/162/250
metadata:
  type: project
---

The PR #30 review (TASK-019, spike plus adapter) is `docs/05-quality/security/PR-0030-TASK-019-security-review.md` (R1 committed a7bb07f; Round 2 appended 2026-11-13, uncommitted when written). No security-owned path changed (`apps/api/src/platform/**` and `main.ts` are NOT in CODEOWNERS), lane A computes `not-required`; the record is courtesy coverage.

**R1 @293fb62 PASS_WITH_CONDITIONS (C1 = SEC-01). R2 @5f45a8b (delta 5488dac, 0a05463, merge f2cad2e, 5f45a8b) PASS_WITH_FOLLOW-UPS, C1 CLOSED.**
- **Closed in R2:** SEC-01 MEDIUM (silent TCP server and a `docker pause`d RustFS: put/putIfAbsent/get reject UNAVAILABLE at 15.0 s, head/delete/checkBucket at 5.0 s; 2nd connection at 10.1 s = request timeout now throws; base still pending at 22 s with one console.warn per op at 10.1 s; flag-less and deadline-less scratch mutants behave as expected), SEC-05 (byte-counting `get`), SEC-02/03 adapter parts (forced `responseContentType`, attachment default, `allowInline === true`; ChecksumSHA256 on put verified by the store, `get` recomputes, `head().checksumSha256` vs claim).
- **Still open:** SEC-04 LOW (config half only: hardened-env refusal of static refs, PUBLIC endpoint with ENDPOINT, pairing check in config validation exit 78; TASK-014). INFO 06 (anchor sink, TASK-116/G4-prod), 07 (key grammar, R1-n2 accepted-open), 08 (+ (e) boundary-test scope), new 09 (disposition `trim()` accepts U+00A0 prefix, free-text filename; TASK-162 builds `filename*`), 10 (get().contentLength=header or 0, SDK checksum error -> UNEXPECTED, no put echo assert), 11 (StorageConfigError uncaught: exit 1 + raw stack until PR #20 handlers; installProcessErrorHandlers must stay above createRuntimeServices in the union).
- **ADR-0021 am. 2 item 3 wording (handed to the architect):** with a pre-seeded anchor key (other bytes, metadata claim = writer's digest) RustFS gives `head().sha256` == writer digest (claim passes), `head().checksumSha256` != digest, `get()` INTEGRITY_MISMATCH; a CRC32-only attacker object has `checksumSha256` undefined, so the rule is: compare `checksumSha256`, fall back to `get().sha256`, never `head().sha256`; TASK-116 sink wrapper `isWritten(key, digest)` only.

**R1 facts (still true).** `@smithy/node-http-handler` 4.14.2 (SDK 3.1162.0) only warns on `requestTimeout` unless `throwOnRequestTimeout: true`. RustFS 1.0.4 `sha256:ed9210d6...` OCI index, user `rustfs`, ports 9000/9001, env `RUSTFS_CONSOLE_CORS_ALLOWED_ORIGINS=*`, image already local. GET-presigned URL: HEAD/PUT/DELETE/POST 403; any tamper of signed `response-*` params, duplicate or unsigned `response-*` params, or dropping `x-amz-checksum-mode` -> 403; store sends NO `x-content-type-options` (nosniff has no delivery point; architect wording T-59). Raw put with wrong `ChecksumSHA256` -> 400 BadDigest, nothing stored; PutObject echoes the checksum. 16/32-way `putIfAbsent`: exactly 1 created on unversioned and versioned buckets. SDK closure 27 packages, zero advisories.

**Why:** the timeout gap was the one claim in the PR (adapter header, D-TASK019-02 (3)) that was untested and false; the same class (SDK default is warn-only or no-op for an option set via object literal) can repeat.

**How to apply.**
- **TASK-116 (anchors):** sink own credential/bucket, `Pick<ObjectStorage,'putIfAbsent'|'head'|'get'>` wrapper on `checksumSha256`/`get().sha256`; 409 UNAVAILABLE retry with jitter; contract run on real S3 before G4-production.
- **TASK-147/162/155/250:** one typed key builder from UUIDs; presign only RLS-visible row keys with `versionId`; never `allowInline` with request-derived or html/svg/xhtml/xml types; route test that logs/responses carry no `X-Amz-*`; recompute against the DB hash.
- **TASK-014:** pairing guard (exit 78) + hardened-env rule; PUBLIC endpoint with ENDPOINT; compose `rustfs` on 127.0.0.1 port 9000 only with Host passthrough; `.dockerignore`/image `find` for `**/storage/tests`, `*.test.js`.
- **Merge order / unions:** PR #24 conflicts on services.ts/services.test.ts/health.int.test.ts (keep storage-first, `storage` member, `onFailure`); PR #20 conflicts in both main.ts and runtime/index.ts; DECISIONS.md tail keep-both. Merging main alone does NOT void the record (sim case E). Lane-B evidence is required (D-ORCH-034/035).

Related: [[project-p5-pr27-spk04-spike]], [[project-p5-pr24-audit-store]], [[project-p5-pr20-logging]], [[project-security-review-conventions]]
