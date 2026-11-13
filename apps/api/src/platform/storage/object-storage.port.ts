/**
 * `ObjectStorage` port (ADR-0021 §1 and amendment 1; REQ-DOC-*, NFR-SEC-013; SPK-05, R-ARCH-05). The one S3 code path:
 * `s3-object-storage.ts` implements it with `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner` against any S3
 * endpoint (RustFS locally, AWS S3 at M5). No other module imports the AWS SDK (boundary test in this folder).
 *
 * Contract (proved against RustFS by `object-storage.contract.int.test.ts`):
 *  - Keys are opaque UUID-based paths (ADR-0021 §2; data-model P13: no personal data in keys). Invalid keys and
 *    buckets are a programming error (`ObjectStorageError` `INVALID_ARGUMENT`), checked before any I/O.
 *  - Every operation is time-bounded even without a caller signal (an optional `signal` only shortens it); a store
 *    that stops answering yields `UNAVAILABLE`, never a call pending for ever (CLAUDE.md §9).
 *  - `put` takes bytes (labels and documents are ≤ 5 MiB, ADR-0021 am. 2); the SHA-256 is computed over the bytes,
 *    compared with the caller's expected hash when given, sent as the S3 `ChecksumSHA256` the store verifies before
 *    it accepts the write, stored as object metadata `sha256` (`x-amz-meta-sha256`, lowercase hex) and returned.
 *  - `putIfAbsent` never overwrites (conditional `If-None-Match: *`, ADR-0021 am. 1: audit anchors).
 *  - `head` / `get` resolve `undefined` for a missing object (404), never throw for it.
 *  - `presignGet` signs a GET for at most 300 s (D-025) with a forced response content type and
 *    `Content-Disposition: attachment` unless the caller explicitly allows `inline`.
 *  - `checkBucket` is the readiness probe (`HeadBucket`), bounded by the caller's abort signal.
 * Errors other than "not found" and "precondition failed" surface as `ObjectStorageError` with a fixed code and no
 * endpoint, bucket credential or SDK message in it (AT-US-012-05, CLAUDE.md §9).
 */

/** D-025: pre-signed URLs live at most 300 s. */
export const MAX_PRESIGN_TTL_SECONDS = 300;
/** ADR-0021 am. 2: carrier labels and documents are ≤ 5 MiB; the port refuses larger bodies. */
export const MAX_PUT_BYTES = 5 * 1024 * 1024;

export type ObjectStorageErrorCode =
  'INVALID_ARGUMENT' | 'INTEGRITY_MISMATCH' | 'TOO_LARGE' | 'UNAVAILABLE' | 'ACCESS_DENIED' | 'UNEXPECTED';

export class ObjectStorageError extends Error {
  constructor(
    readonly code: ObjectStorageErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'ObjectStorageError';
  }
}

export interface PutObjectInput {
  readonly bucket: string;
  readonly key: string;
  readonly body: Uint8Array;
  /** Set by the caller from the detected format, never from carrier metadata (ADR-0021 am. 2). */
  readonly contentType: string;
  /** Expected lowercase hex SHA-256; a mismatch with the bytes is `INTEGRITY_MISMATCH` and nothing is written. */
  readonly sha256?: string;
  /** User metadata (`x-amz-meta-*`); lowercase keys `[a-z0-9-]`, ASCII values; `sha256` is reserved. */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface PutObjectResult {
  /** Lowercase hex SHA-256 of the stored bytes; the store verified it on receipt (`ChecksumSHA256`). */
  readonly sha256: string;
  /** Present when the bucket has versioning enabled. */
  readonly versionId?: string;
  readonly etag?: string;
}

export type PutIfAbsentResult = { readonly created: true; readonly result: PutObjectResult } | { readonly created: false };

export interface ObjectLocator {
  readonly bucket: string;
  readonly key: string;
  /** Reads a specific version (versioned buckets). */
  readonly versionId?: string;
}

export interface ObjectHead {
  readonly contentType?: string;
  readonly contentLength: number;
  /**
   * On `head`: the metadata `sha256` value, an UNVERIFIED claim (anyone who can write the object can write any
   * metadata); never use it to prove what the body is. On `get` (`StoredObject`): recomputed over the bytes read.
   */
  readonly sha256?: string;
  /**
   * The store's own SHA-256 of the object (lowercase hex), computed and verified by the store at write time
   * (`ChecksumSHA256` with checksum mode); present for objects written through this port.
   */
  readonly checksumSha256?: string;
  readonly metadata: Readonly<Record<string, string>>;
  readonly versionId?: string;
  readonly etag?: string;
  readonly lastModified?: Date;
}

export interface StoredObject extends ObjectHead {
  /** Lowercase hex SHA-256 computed over `body`; a body that contradicts its metadata claim is `INTEGRITY_MISMATCH`. */
  readonly sha256: string;
  readonly body: Uint8Array;
}

export interface PresignGetInput extends ObjectLocator {
  /** 1 … {@link MAX_PRESIGN_TTL_SECONDS}. */
  readonly ttlSeconds: number;
  /**
   * Forced `response-content-type` (`type/subtype`, optional token parameters): the type stored at put time, never
   * request input (T-58). The store serves the object with this type whatever the stored one is.
   */
  readonly responseContentType: string;
  /** `response-content-disposition`; default `attachment`. The disposition type must be `attachment` … */
  readonly contentDisposition?: string;
  /** … unless this is `true`, which also permits `inline` (reviewed callers only; T-58/T-59). Default `false`. */
  readonly allowInline?: boolean;
}

export interface PresignedUrl {
  readonly url: string;
  /** The exact instant the store stops honouring the URL (signing time floored to the second + TTL). */
  readonly expiresAt: Date;
}

export interface ObjectStorage {
  put(input: PutObjectInput, signal?: AbortSignal): Promise<PutObjectResult>;
  putIfAbsent(input: PutObjectInput, signal?: AbortSignal): Promise<PutIfAbsentResult>;
  head(locator: ObjectLocator, signal?: AbortSignal): Promise<ObjectHead | undefined>;
  get(locator: ObjectLocator, signal?: AbortSignal): Promise<StoredObject | undefined>;
  presignGet(input: PresignGetInput): Promise<PresignedUrl>;
  /** Hard delete; allow-listed callers only (ADR-0021 §1: erasure job, retention); not used in M1. */
  delete(locator: ObjectLocator, signal?: AbortSignal): Promise<void>;
  /** Readiness: resolves when `HeadBucket` succeeds on `bucket`; rejects otherwise (never with endpoint details). */
  checkBucket(bucket: string, signal: AbortSignal): Promise<void>;
}
