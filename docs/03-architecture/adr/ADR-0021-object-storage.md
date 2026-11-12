# ADR-0021: Object storage — S3 API, RustFS locally (MinIO retired), SHA-256 integrity, pre-signed URLs, virus-scanning seam

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect, platform-architect
- **Related:** brief §4.10 files, §4.3 raw payloads, §4.9 archive, §10 (S3 buckets); REQ-DOC-*, REQ-CARR-018, REQ-AUDIT-018, REQ-RBAC-012; D-025; NFR-SEC-013, NFR-REC-003, NFR-AUDIT-007; ADR-0019

## Context

Files (labels, invoices, customs documents, raw carrier payloads, exports, future uploads) live in S3 with versioning, SSE-KMS, a stored SHA-256, virus scanning on upload (no uploads in M1, D-025) and short-lived pre-signed URLs after a permission check; every download is audited. Brief §10 asks for "S3-compatible storage" in Compose. Verified 2026-11-12: **MinIO's community edition is archived** (no Docker images/binaries since 2025-10, repository archived 2026) and **LocalStack now requires an account/auth token** (release 2026.03.0), so neither is an acceptable zero-friction local store under the maintained-dependency guardrail. **RustFS** (Apache-2.0, S3-compatible, 1.0 GA 2026-09-16, Docker image, maintained) is the chosen local server; SeaweedFS (Apache-2.0) is the fallback.

## Decision

1. **Port** `ObjectStorage { put(bucket, key, bytes|stream, { contentType, sha256, metadata }), get(bucket, key), head, presignGet(bucket, key, ttlSeconds ≤ 300), delete (allow-listed callers only) }` implemented once with `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` against any S3 endpoint (`STORAGE_ENDPOINT`, `STORAGE_FORCE_PATH_STYLE=true` locally). No other code imports the AWS SDK for S3.
2. **Buckets** (names from config; per environment): `documents` (labels, invoices, customs docs), `raw-carrier-payloads` (redacted request/response JSON, ADR-0010), `exports` (M2+), `audit-archive` (M5, Object Lock compliance mode), `inbound-mail` (M4). Keys: `org/<org_id>/shipment/<shipment_id>/<doc_type>/v<version>/<uuid>.<ext>`; raw payloads `carrier/<code>/<shipment_id>/<op>/<uuid>.json`. Server-side encryption SSE-KMS in AWS; bucket versioning on for `documents`; local RustFS has versioning enabled where supported (spike confirms feature coverage — risk R-ARCH-05).
3. **Integrity**: SHA-256 computed while streaming on write, stored on the `documents`/`carrier_raw_payloads` row and as object metadata `x-amz-meta-sha256`; the restore rehearsal re-hashes a sample (NFR-REC-003); `documents` download responses include the hash for client verification.
4. **Downloads**: `GET /documents/{id}/download` → permission `document:download` (REQ-RBAC-012) → `DOWNLOAD` audit entry (SENSITIVE, fail-closed) → pre-signed GET URL with TTL **300 s** (D-025), `response-content-disposition` set, returned as JSON `{ url, expires_at, sha256 }` (no redirect, so the audit entry precedes the URL). Expired URL use → 410 `DOWNLOAD_EXPIRED` semantics on the Platform side (the store itself returns 403; the UI re-requests). Raw payload objects are never exposed to customers.
5. **Uploads**: none in M1. Seam: `UploadScanner { scan(bucket, key) → CLEAN | INFECTED | ERROR }` port with a `NoopScanner` that is **refused** in production config (fails start-up if an upload route exists without a real scanner); AWS implementation at M4 = S3 event → Lambda (ClamAV layer or GuardDuty Malware Protection for S3) → tag + quarantine bucket.
6. **Local/CI**: Compose service `rustfs` with a one-shot bucket-creation job; Testcontainers `GenericContainer('rustfs/rustfs:<pinned>')` for integration tests of the storage adapter (contract test also runnable against real S3 when credentials exist).
7. **Retention/erasure**: object lifecycle rules per bucket are M4/M5 (retention periods recorded in compliance packs); documents of erased subjects are deleted by the erasure job (hard delete allow-list).

## Alternatives considered

- **MinIO** — archived/no images (verified); a community fork (`pgsty/minio`) exists but is AGPL and young. **LocalStack** — account/token now mandatory; also AGPL-free but heavy. **SeaweedFS** — mature, Apache-2.0, S3 gateway; kept as fallback if the RustFS spike fails on pre-signed URLs or versioning. **Filesystem storage locally** — would diverge from the S3 code path and hide signing bugs.

## Consequences

- Positive: one S3 code path everywhere; audited, short-lived downloads; hashes for integrity and restore checks.
- Negative: RustFS is young (1.0 in 2026-09) — a Wave-0 spike validates pre-signed URLs, versioning, path-style access and `HEAD` metadata; fallback documented.

## Amendment after the P3 security review (2026-11-12, `docs/05-quality/security/P3-architecture-security-review.md` SEC-P3-03 item 7, SEC-P3-09, SEC-P3-21 item 5; D-ARCH-019, D-ARCH-028)

1. **`audit-anchors` sink (SEC-P3-03; amends §2 buckets).** New bucket `audit-anchors` holds the hourly signed anchor records of ADR-0007 amendment 7 (`anchors/<yyyy>/<mm>/<anchor_seq>.json`). Locally the sink is a file on a dedicated volume (`AUDIT_ANCHOR_SINK=file:…`); at M5 it is this bucket with **Object Lock in compliance mode** (retention ≥ 7 years), the worker task role holding `s3:PutObject` only (no delete, no `s3:BypassGovernanceRetention`), or a retention-locked CloudWatch Logs group. Providing the locked sink is a **G4 precondition for any production release** (risks.md R-ARCH-18). The `ObjectStorage` port gains `putIfAbsent` (conditional `If-None-Match: *`) so an anchor key is never overwritten.
2. **Carrier label and document bytes are validated at put time (SEC-P3-21 item 5, T-59; amends §3).** Bytes returned by a carrier (`createShipment` labels, paperless documents) are accepted only if the magic bytes match the declared format (`%PDF-`, PNG signature, ZPL `^XA`), the size is ≤ 5 MB and the content type is set explicitly from the detected format (never from carrier metadata); otherwise the saga records `LABEL_INVALID`, keeps the shipment `BOOKED` with documents pending and raises an alert. Downloads keep `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`.
3. **`SENSITIVE` documents (SEC-P3-09; amends §4).** Documents classified `SENSITIVE` (ADR-0019 amendment 1) are stored with SSE (SSE-KMS at M5), are never attached to e-mails and are downloadable only through the audited pre-signed path by holders of `document:download` (the customer Viewer is not one).

## Reversibility

High (port + S3 API).
