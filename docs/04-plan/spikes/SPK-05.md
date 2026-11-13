# SPK-05 — S3 adapter contract against RustFS and the object_storage readiness check

| Field | Value |
|---|---|
| Task | TASK-019 (Wave 0) · branch `feat/TASK-019-spk-05-spike-s3-compatible` |
| Risk | R-ARCH-05 (S3-compatible local store diverges from AWS S3: presign, versioning, conditional writes, checksums) |
| NFR / requirements | NFR-SEC-013; REQ-PLAT-018 (readiness); ADR-0021 (§1 single S3 code path, am. 1 audit-anchor sink, am. 2 ≤ 5 MB documents); A-084; D-025 (pre-signed URL ≤ 300 s) |
| Date / host | 2026-11-13 · Windows 11 Pro 10.0.26300, Node v24.22.3, Docker Desktop (Linux engine, same host as SPK-03) |
| Image | `rustfs/rustfs:1.0.4@sha256:ed9210d6411d77ffceb70d94b964a3cb7d225983368bc25bebe01e995293dcc2` (multi-arch index digest from `docker pull`; tag pushed 2026-10-25, built from revision `46337942d55f`). 1.0.5 (pushed 2026-11-10) was inside the 7-day cooldown, so 1.0.4 is the newest eligible stable tag. The image runs as user `rustfs`, listens on 9000 (S3) and 9001 (console), reads `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY`, stores under `/data`. |
| SDK | `@aws-sdk/client-s3` 3.1162.0, `@aws-sdk/s3-request-presigner` 3.1162.0 (package-lock; both already dependencies of `apps/api`, no new dependency) |
| Owner | senior-developer (backend) |
| Evidence | `apps/api/src/platform/storage/object-storage.contract.int.test.ts` — 13 tests passed, 9.3 s (own container start included). `apps/api/src/platform/health/health.int.test.ts` — 4 tests passed (Postgres + Valkey + RustFS); both suites together 17 tests, 17.6 s. Unit: `s3-object-storage.test.ts` + `boundary.test.ts` + `checks/object-storage.test.ts` + `runtime/services.test.ts` — 83 tests; `s3-object-storage.ts` 99.4 % line / 96.6 % branch, `checks/object-storage.ts` 100 %. Whole `apps/api` + `apps/worker` unit run: 369 tests green. |
| **Verdict** | **GO.** RustFS 1.0.4 satisfies the `ObjectStorage` port as written with the SDK defaults: path-style addressing, pre-signed GET with response header override and enforced expiry, versioning, HEAD user metadata, conditional `If-None-Match: *` writes and the default CRC32 flexible checksums all behave as on AWS S3. No `WHEN_REQUIRED` workaround and no switch to SeaweedFS (the FALLBACK) is needed. The audit-anchor sink (ADR-0021 am. 1) can rely on `putIfAbsent` against RustFS. |

Throwaway code: none. The adapter (`s3-object-storage.ts`), the readiness check (`health/checks/object-storage.ts`) and the
test container helper (`storage/tests/rustfs.ts`) are production-grade and stay.

## 1. What was built

- **Adapter** `createS3ObjectStorage(options)` implements the committed port (`put`, `putIfAbsent`, `head`, `get`,
  `presignGet`, `delete`, `checkBucket`) plus `destroy()`. Two SDK clients: one for I/O against `STORAGE_ENDPOINT`, one for
  pre-signing against `STORAGE_PUBLIC_ENDPOINT ?? STORAGE_ENDPOINT` (built only when they differ). Connect timeout 2 s,
  request timeout 10 s, `maxAttempts: 3`. Arguments are validated before any I/O; SDK errors become `ObjectStorageError`
  with a fixed message (status, name and `code` are read, the message is never copied).
- **Config mapping** `storageOptionsFromConfig` / `objectStorageFromConfig`: `STORAGE_ENDPOINT`, `STORAGE_PUBLIC_ENDPOINT`,
  `STORAGE_REGION`, `STORAGE_FORCE_PATH_STYLE`; static credentials only when both `STORAGE_ACCESS_KEY_ID_REF` and
  `STORAGE_SECRET_ACCESS_KEY_REF` resolved (keys of `RuntimeConfig.secrets` are the config key names).
- **Readiness** `createObjectStorageCheck(storage, bucket)`: `HeadBucket` on `STORAGE_BUCKET_DOCUMENTS` with the runner's
  abort signal. Wired in `platform/runtime/services.ts` (`readinessChecks` gained the third parameter,
  `createRuntimeServices` gained `secrets`, the storage is closed on graceful shutdown). The API and worker entry points
  pass `secrets` from `loadRuntimeConfigOrExit`.
- **Boundary** `boundary.test.ts`: only files under `apps/api/src/platform/storage/` import the S3 SDK packages (positive
  control included).

## 2. Findings

| # | Finding | Evidence | Impact |
|---|---|---|---|
| F-01 | **Pre-signed GET works path-style.** URL is `http://<host>:<mapped port>/<bucket>/<key>?X-Amz-…`; a plain `fetch` returns 200 and the exact bytes. `response-content-disposition=attachment` is honoured: the response carries `Content-Disposition: attachment`. | contract test "pre-signed GET …" | Download links need no proxy. `STORAGE_PUBLIC_ENDPOINT` only matters when the browser-visible host differs from the in-network one. |
| F-02 | **Expiry is enforced to the second.** A URL with `X-Amz-Expires=1` answers 200 immediately and **403** after 2.5 s. A URL for a different key (path tampered, signature unchanged) is also **403**. | contract tests "expired …", "tampered …" | D-025 (≤ 300 s) holds in the store as well as in the port (TTL 0 and 301 are rejected before I/O). |
| F-03 | **Versioning works.** `PutBucketVersioning` Enabled; two puts return two distinct `VersionId`s; `GetObject` and `HeadObject` with the first `VersionId` return the first bytes, the unversioned read returns the latest. | contract test "versioning …" | Matches the ADR-0021 retention design for labels and documents. |
| F-04 | **HEAD returns content type, length and user metadata.** Metadata keys come back lower-case; `x-amz-meta-sha256` round-trips and equals the SHA-256 computed by the port. The port hides `sha256` from `metadata` and exposes it as `sha256`. | contract test "put then head then get …" | Integrity is checkable without reading the body. |
| F-05 | **`If-None-Match: *` is honoured.** The first `putIfAbsent` creates; the second returns HTTP 412 (`PreconditionFailed`) which the adapter maps to `{ created: false }`; the original bytes are kept. Same result on a versioned bucket: no second version is created by the losing write. | contract tests "putIfAbsent …" | No FALLBACK for the audit-anchor sink (ADR-0021 am. 1); no fallback to HEAD-then-PUT is needed. |
| F-06 | **Default flexible checksums are accepted.** SDK 3.1162 sends CRC32 by default (`requestChecksumCalculation: 'WHEN_SUPPORTED'`); RustFS 1.0.4 accepted every put, including 5 MiB, and `GetObject` with response validation on. `WHEN_REQUIRED` is therefore **not** set. | all put/get tests pass with SDK defaults | If a later RustFS or other S3-compatible store rejects the checksum headers, the switch is one option each (`requestChecksumCalculation`, `responseChecksumValidation`) in `clientConfig`. The contract suite is the tripwire. |
| F-07 | **Error shapes.** Missing object: HEAD → `NotFound`/404, GET → `NoSuchKey`/404 (both → `undefined`). Wrong secret key: HTTP 403 → `ACCESS_DENIED`. Conditional write conflict: 412 `PreconditionFailed`. Missing bucket on `HeadBucket`: not 403 and not 5xx → `UNEXPECTED` (a configuration error, readiness reports `unavailable`). Stopped container: connection error / timeout → `UNAVAILABLE` (readiness 503 within the 2.5 s bound). | contract and health tests | Mapping uses status, name and Node `code` only. |
| F-08 | **Readiness leaks nothing.** With RustFS stopped, `/health/ready` is 503 with `object_storage: 'unavailable'` within 2.5 s, `/health/live` stays 200, and the body contains neither `host:port`, the port nor the access key. | health test AT-US-012-02-object-storage | AT-US-012-05 holds for the new component. |
| F-09 | **Container start.** `Wait.forHttp('/health', 9000)` returns 200 once the S3 API is up and credentials are loaded; buckets can be created immediately afterwards. Non-root user and an anonymous `/data` volume work without extra flags. Pull size ≈ 135 MB (amd64). | `storage/tests/rustfs.ts` | Compose can use the same health URL. |
| F-10 | **`putIfAbsent` and SDK retries.** With `maxAttempts: 3`, a retried `PutObject` whose first attempt succeeded but lost its response sees 412 and reports `created: false` although this caller created the object. Not reproducible without fault injection; documented in the adapter header. | design note | Callers (audit anchor) compare `head().sha256` with their own hash when `created` is `false`. |

## 3. Interpretations and decisions

- `get` refuses to buffer an object over `MAX_PUT_BYTES` (`TOO_LARGE`, stream destroyed): the port is for ≤ 5 MB objects.
- `head`/`get` return `metadata` without the reserved `sha256` entry; a non-hex `sha256` metadata value is ignored.
- The test helper lives in `storage/tests/rustfs.ts` (not `storage/testing/`) because `jest.config.ts` already excludes
  `**/{tests,fixtures}/**` from coverage (it runs only in the integration suites).
- Test seams `client` (any `{ send, destroy? }`) and `presignClient` replace the SDK clients; production code passes neither.

## 4. Follow-ups

| Owner | Follow-up |
|---|---|
| TASK-014 (compose) | Add a `rustfs` service pinned to the image above (`/health` health check on 9000, `RUSTFS_ACCESS_KEY` / `RUSTFS_SECRET_KEY` from `STORAGE_*_REF` secrets) and a bucket-init job creating `STORAGE_BUCKET_DOCUMENTS` and `STORAGE_BUCKET_RAW_CARRIER_PAYLOADS` (documents bucket versioned). Until then a local `docker compose up` reports `object_storage: unavailable` and `/health/ready` is 503. |
| TASK-014 / infra | Bucket versioning, encryption and lifecycle for AWS S3 at M5 via Terraform; the adapter needs no code change (omit `STORAGE_ENDPOINT`, `forcePathStyle` false, IAM role). |
| M2 (exports, bulk documents) | Streaming and multipart uploads for bodies > 5 MB; `get` as a stream. The port deliberately offers bytes only. |
| TASK-021 (audit store) | Use `putIfAbsent` for anchors; on `created: false` compare `head().sha256` before treating it as a duplicate (F-10). |
| Dependency upkeep | Re-run this contract suite when bumping the RustFS tag or `@aws-sdk/client-s3` (F-06 checksum defaults are the usual breakage). Bump the pin only for tags older than 7 days. |
