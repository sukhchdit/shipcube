/**
 * The one `ObjectStorage` implementation (ADR-0021 §1; SPK-05): `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
 * against any S3 endpoint (RustFS locally, AWS S3 at M5). Only files in this folder import the AWS SDK (boundary test).
 *
 * Time bounds (CLAUDE.md §9, PR30-SEC-01): every attempt has a connect timeout (2 s) and a request timeout (10 s until
 * the response headers) that throws (`throwOnRequestTimeout`; the SDK default only logs a warning), the SDK standard retry strategy
 * makes at most 3 attempts with jittered backoff, and every operation, all attempts and the body transfer included, is
 * bounded by a deadline combined with the caller's abort signal: 15 s for put, putIfAbsent and get, 5 s for head,
 * delete and checkBucket. `s3-object-storage.http.test.ts` pins all of it against a loopback server.
 *
 * Retries: put overwrites by key, so a retry is safe on an unversioned bucket; on a versioned bucket a retried put
 * whose first attempt succeeded leaves an extra version, and a retried delete an extra delete marker. A retried
 * `putIfAbsent` whose first attempt succeeded but lost its response reports `created: false` (SPK-05 F-10, pinned by
 * the loopback test); callers that must know compare bytes with `get` (never the metadata claim).
 *
 * Arguments are validated before any I/O. SDK errors become `ObjectStorageError` with a fixed message: the SDK message
 * can carry the endpoint, bucket and key and is never copied.
 */
import { createHash } from 'node:crypto';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type S3ClientConfig,
  type GetObjectCommandOutput,
  type HeadObjectCommandOutput,
  type PutObjectCommandOutput,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import type { Config, Secret } from '@platform/config';

import {
  MAX_PRESIGN_TTL_SECONDS,
  MAX_PUT_BYTES,
  ObjectStorageError,
  type ObjectHead,
  type ObjectLocator,
  type ObjectStorage,
  type ObjectStorageErrorCode,
  type PresignedUrl,
  type PresignGetInput,
  type PutIfAbsentResult,
  type PutObjectInput,
  type PutObjectResult,
  type StoredObject,
} from './object-storage.port.js';

export interface S3Timeouts {
  /** TCP connect, per attempt. */
  readonly connectionMs: number;
  /** Per attempt, until the response headers arrive; throws a retryable `TimeoutError` (not the SDK default warning). */
  readonly requestMs: number;
  /** Whole-operation bound for put, putIfAbsent and get: every attempt, the backoff and the body transfer. */
  readonly dataDeadlineMs: number;
  /** Whole-operation bound for head, delete and checkBucket. */
  readonly metadataDeadlineMs: number;
}

export const S3_TIMEOUTS: S3Timeouts = Object.freeze({
  connectionMs: 2_000,
  requestMs: 10_000,
  dataDeadlineMs: 15_000,
  metadataDeadlineMs: 5_000,
});
export const S3_MAX_ATTEMPTS = 3;

/** The part of the SDK client the adapter uses; a fake with the same shape stands in for it in unit tests. */
export interface S3Sender {
  send(command: object, options?: { readonly abortSignal?: AbortSignal }): Promise<unknown>;
  destroy?(): void;
}

export interface S3ObjectStorageOptions {
  /** Unset for AWS S3 (the SDK resolves the regional endpoint). */
  readonly endpoint?: string;
  /** Browser-reachable endpoint the pre-signed URLs point at; defaults to `endpoint`. */
  readonly publicEndpoint?: string;
  readonly region: string;
  /** `true` for RustFS (`http://host:9000/<bucket>/<key>`). */
  readonly forcePathStyle: boolean;
  /** Static credentials (local only). Omitted: the SDK default provider chain (IAM role at M5). */
  readonly credentials?: { readonly accessKeyId: string; readonly secretAccessKey: string };
  readonly now?: () => Date;
  /** Test seam: shorter bounds for the loopback tests. Production passes nothing ({@link S3_TIMEOUTS}). */
  readonly timeouts?: S3Timeouts;
  /** Test seams: replace the SDK clients. */
  readonly client?: S3Sender;
  readonly presignClient?: S3Client;
}

export interface S3ObjectStorage extends ObjectStorage {
  /** Closes both SDK clients (graceful shutdown). */
  destroy(): void;
}

/** Exactly one of the two static-credential secrets resolved: refused instead of falling back (PR30-SEC-04). */
export class StorageConfigError extends Error {
  override readonly name = 'StorageConfigError';
}

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const METADATA_KEY = /^[a-z0-9-]{1,64}$/u;
const METADATA_VALUE = /^[\x20-\x7e]{0,256}$/u;
/** `type/subtype` with optional token parameters (`; charset=utf-8`); no quoting, no control characters. */
const MEDIA_TYPE = /^[a-z0-9][a-z0-9!#$&^_.+-]{0,126}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,126}(?:; ?[a-z0-9-]{1,64}=[a-z0-9._-]{1,64}){0,4}$/iu;
/** Unicode category Cc: C0 controls, DEL and C1 controls. */
const CONTROL_CHARACTERS = /\p{Cc}/u;
const MAX_KEY_BYTES = 1024;
const MAX_METADATA_ENTRIES = 16;
/** Node system error codes that mean "could not reach the store" (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT` …). */
const SYSTEM_ERROR_CODE = /^E[A-Z0-9_]{3,}$/u;
/**
 * Error names decide before the HTTP status (PR #30 R1-m4): S3 answers a stalled upload with 400 `RequestTimeout`,
 * a concurrent conditional write with 409 `ConditionalRequestConflict` (AWS only; retryable), an expired session
 * token with 400 `ExpiredToken`, and a checksum mismatch with 400 `BadDigest`.
 */
const NAMED_CODES: ReadonlyMap<string, ObjectStorageErrorCode> = new Map<string, ObjectStorageErrorCode>([
  ['AbortError', 'UNAVAILABLE'],
  ['TimeoutError', 'UNAVAILABLE'],
  ['RequestTimeout', 'UNAVAILABLE'],
  ['ConditionalRequestConflict', 'UNAVAILABLE'],
  ['ExpiredToken', 'ACCESS_DENIED'],
  ['TokenRefreshRequired', 'ACCESS_DENIED'],
  ['CredentialsProviderError', 'ACCESS_DENIED'],
  ['BadDigest', 'INTEGRITY_MISMATCH'],
]);

const invalid = (): ObjectStorageError => new ObjectStorageError('INVALID_ARGUMENT');

function assertBucket(bucket: string): void {
  if (!BUCKET_NAME.test(bucket) || bucket.includes('..')) throw invalid();
}

function assertKey(key: string): void {
  const bytes = Buffer.byteLength(key, 'utf8');
  if (bytes < 1 || bytes > MAX_KEY_BYTES) throw invalid();
  if (key.startsWith('/') || CONTROL_CHARACTERS.test(key) || key.split('/').includes('..')) throw invalid();
}

function assertLocator(locator: ObjectLocator): void {
  assertBucket(locator.bucket);
  assertKey(locator.key);
  if (
    locator.versionId !== undefined &&
    (locator.versionId.length < 1 || locator.versionId.length > 1024 || CONTROL_CHARACTERS.test(locator.versionId))
  ) {
    throw invalid();
  }
}

function assertHeaderText(value: string, maxLength: number): void {
  if (value.length < 1 || value.length > maxLength || CONTROL_CHARACTERS.test(value)) throw invalid();
}

function assertPut(input: PutObjectInput): void {
  assertBucket(input.bucket);
  assertKey(input.key);
  assertHeaderText(input.contentType, 255);
  if (input.body.byteLength > MAX_PUT_BYTES) throw new ObjectStorageError('TOO_LARGE');
  if (input.sha256 !== undefined && !SHA256_HEX.test(input.sha256)) throw invalid();
  const entries = Object.entries(input.metadata ?? {});
  if (entries.length > MAX_METADATA_ENTRIES) throw invalid();
  for (const [name, value] of entries) {
    if (name === 'sha256' || !METADATA_KEY.test(name) || !METADATA_VALUE.test(value)) throw invalid();
  }
}

/** PR30-SEC-02 / T-58: `attachment` unless the caller opted in to `inline`; any other disposition type is refused. */
function dispositionOf(input: PresignGetInput): string {
  const disposition = input.contentDisposition ?? 'attachment';
  assertHeaderText(disposition, 1024);
  const type = (disposition.split(';', 1)[0] ?? '').trim().toLowerCase();
  if (type === 'attachment' || (type === 'inline' && input.allowInline === true)) return disposition;
  throw invalid();
}

const sha256Digest = (bytes: Uint8Array): Buffer => createHash('sha256').update(bytes).digest();

/** A store checksum (base64) as lowercase hex; `undefined` unless it is a full-object SHA-256 (32 bytes). */
function checksumHex(base64: string | undefined): string | undefined {
  if (base64 === undefined) return undefined;
  const digest = Buffer.from(base64, 'base64');
  return digest.byteLength === 32 && digest.toString('base64') === base64 ? digest.toString('hex') : undefined;
}

interface SdkErrorShape {
  readonly name?: unknown;
  readonly code?: unknown;
  readonly $metadata?: { readonly httpStatusCode?: unknown };
}

const statusOf = (error: unknown): number | undefined => {
  const status = (error as SdkErrorShape | undefined)?.$metadata?.httpStatusCode;
  return typeof status === 'number' ? status : undefined;
};

const nameOf = (error: unknown): string | undefined => {
  const name = (error as SdkErrorShape | undefined)?.name;
  return typeof name === 'string' ? name : undefined;
};

/** A missing object: 404 other than `NoSuchBucket` (a missing bucket is a configuration error, not "absent"). */
function isNotFound(error: unknown): boolean {
  const name = nameOf(error);
  if (name === 'NoSuchKey' || name === 'NotFound') return true;
  return statusOf(error) === 404 && name !== 'NoSuchBucket';
}

const isPreconditionFailed = (error: unknown): boolean => statusOf(error) === 412 || nameOf(error) === 'PreconditionFailed';

/** Maps an SDK failure to a port error. Reads the name, status and code only, never the message. */
export function toObjectStorageError(error: unknown): ObjectStorageError {
  if (error instanceof ObjectStorageError) return error;
  const status = statusOf(error);
  const name = nameOf(error);
  const code = (error as SdkErrorShape | undefined)?.code;
  const named = name === undefined ? undefined : NAMED_CODES.get(name);
  let mapped: ObjectStorageErrorCode = 'UNEXPECTED';
  if (named !== undefined) mapped = named;
  else if (status === 403) mapped = 'ACCESS_DENIED';
  else if (status !== undefined) mapped = status >= 500 || status === 408 || status === 429 ? 'UNAVAILABLE' : 'UNEXPECTED';
  else if (typeof code === 'string' && SYSTEM_ERROR_CODE.test(code)) mapped = 'UNAVAILABLE';
  return new ObjectStorageError(mapped);
}

/** Any failure once the operation's bounded signal fired is the deadline (or the caller) giving up: `UNAVAILABLE`. */
const failure = (error: unknown, signal: AbortSignal): ObjectStorageError =>
  !(error instanceof ObjectStorageError) && signal.aborted ? new ObjectStorageError('UNAVAILABLE') : toObjectStorageError(error);

const bounded = (signal: AbortSignal | undefined, deadlineMs: number): AbortSignal =>
  signal === undefined ? AbortSignal.timeout(deadlineMs) : AbortSignal.any([signal, AbortSignal.timeout(deadlineMs)]);

type BodyStream = AsyncIterable<Uint8Array | string> & { destroy?: (error?: Error) => void };

/**
 * Reads a response body while counting bytes (PR30-SEC-05): more than {@link MAX_PUT_BYTES} is `TOO_LARGE` whatever
 * `Content-Length` said, and the stream is destroyed as soon as `signal` aborts (a trickling body cannot outlive the
 * deadline).
 */
async function readBounded(body: unknown, signal: AbortSignal): Promise<Uint8Array> {
  if (body === undefined || body === null) return new Uint8Array(0);
  if (typeof (body as Partial<AsyncIterable<unknown>>)[Symbol.asyncIterator] !== 'function') throw new ObjectStorageError('UNEXPECTED');
  const stream = body as BodyStream;
  signal.throwIfAborted();
  const onAbort = (): void => stream.destroy?.(new ObjectStorageError('UNAVAILABLE'));
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    const chunks: Uint8Array[] = [];
    let total = 0;
    for await (const chunk of stream) {
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      total += bytes.byteLength;
      if (total > MAX_PUT_BYTES) {
        stream.destroy?.();
        throw new ObjectStorageError('TOO_LARGE');
      }
      chunks.push(bytes);
    }
    signal.throwIfAborted();
    const out = new Uint8Array(total);
    let offset = 0;
    for (const bytes of chunks) {
      out.set(bytes, offset);
      offset += bytes.byteLength;
    }
    return out;
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
}

function toHead(output: HeadObjectCommandOutput | GetObjectCommandOutput): ObjectHead {
  const { sha256, ...metadata } = output.Metadata ?? {};
  const checksumSha256 = checksumHex(output.ChecksumSHA256);
  return {
    ...(output.ContentType === undefined ? {} : { contentType: output.ContentType }),
    contentLength: output.ContentLength ?? 0,
    ...(sha256 === undefined || !SHA256_HEX.test(sha256) ? {} : { sha256 }),
    ...(checksumSha256 === undefined ? {} : { checksumSha256 }),
    metadata,
    ...(output.VersionId === undefined ? {} : { versionId: output.VersionId }),
    ...(output.ETag === undefined ? {} : { etag: output.ETag }),
    ...(output.LastModified === undefined ? {} : { lastModified: output.LastModified }),
  };
}

/**
 * The SDK client configuration both clients use; exported so a unit test pins the bounds (a regression to the SDK
 * defaults, which have no connect timeout and only warn on a request timeout, must fail a test).
 */
export function s3ClientConfig(
  options: Pick<S3ObjectStorageOptions, 'region' | 'forcePathStyle' | 'credentials' | 'timeouts'>,
  endpoint: string | undefined,
): S3ClientConfig {
  const timeouts = options.timeouts ?? S3_TIMEOUTS;
  return {
    region: options.region,
    forcePathStyle: options.forcePathStyle,
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(options.credentials === undefined ? {} : { credentials: { ...options.credentials } }),
    requestHandler: { connectionTimeout: timeouts.connectionMs, requestTimeout: timeouts.requestMs, throwOnRequestTimeout: true },
    maxAttempts: S3_MAX_ATTEMPTS,
  };
}

export function createS3ObjectStorage(options: S3ObjectStorageOptions): S3ObjectStorage {
  const now = options.now ?? ((): Date => new Date());
  const { dataDeadlineMs, metadataDeadlineMs } = options.timeouts ?? S3_TIMEOUTS;
  const client: S3Sender = options.client ?? new S3Client(s3ClientConfig(options, options.endpoint));
  const publicEndpoint = options.publicEndpoint ?? options.endpoint;
  const presignClient =
    options.presignClient ??
    (options.publicEndpoint === undefined || options.publicEndpoint === options.endpoint
      ? undefined
      : new S3Client(s3ClientConfig(options, publicEndpoint)));
  const signer: S3Client | undefined = presignClient ?? (options.client === undefined ? (client as S3Client) : undefined);

  const send = (command: object, signal: AbortSignal): Promise<unknown> => client.send(command, { abortSignal: signal });

  async function write(input: PutObjectInput, callerSignal: AbortSignal | undefined, ifAbsent: boolean): Promise<PutIfAbsentResult> {
    assertPut(input);
    const digest = sha256Digest(input.body);
    const sha256 = digest.toString('hex');
    if (input.sha256 !== undefined && input.sha256 !== sha256) throw new ObjectStorageError('INTEGRITY_MISMATCH');
    const command = new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.body.byteLength,
      Metadata: { ...input.metadata, sha256 },
      // PR30-SEC-03: the store recomputes SHA-256 and refuses a mismatch (400 BadDigest → INTEGRITY_MISMATCH).
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: digest.toString('base64'),
      ...(ifAbsent ? { IfNoneMatch: '*' } : {}),
    });
    const signal = bounded(callerSignal, dataDeadlineMs);
    try {
      const output = (await send(command, signal)) as PutObjectCommandOutput;
      const result: PutObjectResult = {
        sha256,
        ...(output.VersionId === undefined ? {} : { versionId: output.VersionId }),
        ...(output.ETag === undefined ? {} : { etag: output.ETag }),
      };
      return { created: true, result };
    } catch (error) {
      if (ifAbsent && isPreconditionFailed(error)) return { created: false };
      throw failure(error, signal);
    }
  }

  return {
    async put(input, signal): Promise<PutObjectResult> {
      const outcome = await write(input, signal, false);
      if (!outcome.created) throw new ObjectStorageError('UNEXPECTED');
      return outcome.result;
    },

    putIfAbsent: (input, signal) => write(input, signal, true),

    async head(locator: ObjectLocator, callerSignal?: AbortSignal): Promise<ObjectHead | undefined> {
      assertLocator(locator);
      const command = new HeadObjectCommand({
        Bucket: locator.bucket,
        Key: locator.key,
        ...(locator.versionId === undefined ? {} : { VersionId: locator.versionId }),
        ChecksumMode: 'ENABLED',
      });
      const signal = bounded(callerSignal, metadataDeadlineMs);
      try {
        return toHead((await send(command, signal)) as HeadObjectCommandOutput);
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw failure(error, signal);
      }
    },

    async get(locator: ObjectLocator, callerSignal?: AbortSignal): Promise<StoredObject | undefined> {
      assertLocator(locator);
      const command = new GetObjectCommand({
        Bucket: locator.bucket,
        Key: locator.key,
        ...(locator.versionId === undefined ? {} : { VersionId: locator.versionId }),
      });
      const signal = bounded(callerSignal, dataDeadlineMs);
      try {
        const output = (await send(command, signal)) as GetObjectCommandOutput;
        if ((output.ContentLength ?? 0) > MAX_PUT_BYTES) {
          // Stored objects are ≤ 5 MiB through this port; refuse to buffer anything bigger.
          (output.Body as { destroy?: () => void } | undefined)?.destroy?.();
          throw new ObjectStorageError('TOO_LARGE');
        }
        const body = await readBounded(output.Body, signal);
        const head = toHead(output);
        const sha256 = sha256Digest(body).toString('hex');
        // PR30-SEC-03: the metadata value is a claim; a body that contradicts it is refused.
        if (head.sha256 !== undefined && head.sha256 !== sha256) throw new ObjectStorageError('INTEGRITY_MISMATCH');
        return { ...head, sha256, body };
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw failure(error, signal);
      }
    },

    async presignGet(input: PresignGetInput): Promise<PresignedUrl> {
      assertLocator(input);
      if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > MAX_PRESIGN_TTL_SECONDS) throw invalid();
      if (!MEDIA_TYPE.test(input.responseContentType)) throw invalid();
      const disposition = dispositionOf(input);
      if (signer === undefined) throw new ObjectStorageError('UNEXPECTED');
      // X-Amz-Date has whole seconds: sign with the floored instant so `expiresAt` is the real expiry (R1-m3).
      const signingDate = new Date(Math.floor(now().getTime() / 1000) * 1000);
      try {
        const url = await getSignedUrl(
          signer,
          new GetObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
            ResponseContentType: input.responseContentType,
            ResponseContentDisposition: disposition,
            ...(input.versionId === undefined ? {} : { VersionId: input.versionId }),
          }),
          { expiresIn: input.ttlSeconds, signingDate },
        );
        return { url, expiresAt: new Date(signingDate.getTime() + input.ttlSeconds * 1000) };
      } catch (error) {
        throw toObjectStorageError(error);
      }
    },

    async delete(locator: ObjectLocator, callerSignal?: AbortSignal): Promise<void> {
      assertLocator(locator);
      const signal = bounded(callerSignal, metadataDeadlineMs);
      try {
        await send(
          new DeleteObjectCommand({
            Bucket: locator.bucket,
            Key: locator.key,
            ...(locator.versionId === undefined ? {} : { VersionId: locator.versionId }),
          }),
          signal,
        );
      } catch (error) {
        throw failure(error, signal);
      }
    },

    async checkBucket(bucket: string, callerSignal: AbortSignal): Promise<void> {
      assertBucket(bucket);
      const signal = bounded(callerSignal, metadataDeadlineMs);
      try {
        await send(new HeadBucketCommand({ Bucket: bucket }), signal);
      } catch (error) {
        throw failure(error, signal);
      }
    },

    destroy(): void {
      client.destroy?.();
      presignClient?.destroy();
    },
  };
}

const ACCESS_KEY_REF = 'STORAGE_ACCESS_KEY_ID_REF';
const SECRET_KEY_REF = 'STORAGE_SECRET_ACCESS_KEY_REF';

/**
 * Maps the typed configuration (`STORAGE_*`) and the resolved secrets to adapter options. Static credentials need both
 * references; neither selects the SDK default provider chain (IAM role at M5); exactly one is a half-written pair and
 * throws {@link StorageConfigError} (names the keys, never a value) instead of silently using whatever identity the
 * host offers (PR30-SEC-04).
 */
export function storageOptionsFromConfig(
  config: Pick<Config, 'STORAGE_ENDPOINT' | 'STORAGE_PUBLIC_ENDPOINT' | 'STORAGE_REGION' | 'STORAGE_FORCE_PATH_STYLE'>,
  secrets: ReadonlyMap<string, Secret<string>>,
): S3ObjectStorageOptions {
  const accessKeyId = secrets.get(ACCESS_KEY_REF);
  const secretAccessKey = secrets.get(SECRET_KEY_REF);
  if ((accessKeyId === undefined) !== (secretAccessKey === undefined)) {
    throw new StorageConfigError(`${ACCESS_KEY_REF} and ${SECRET_KEY_REF} must both resolve or both be unset`);
  }
  return {
    ...(config.STORAGE_ENDPOINT === undefined ? {} : { endpoint: config.STORAGE_ENDPOINT }),
    ...(config.STORAGE_PUBLIC_ENDPOINT === undefined ? {} : { publicEndpoint: config.STORAGE_PUBLIC_ENDPOINT }),
    region: config.STORAGE_REGION,
    forcePathStyle: config.STORAGE_FORCE_PATH_STYLE,
    ...(accessKeyId === undefined || secretAccessKey === undefined
      ? {}
      : { credentials: { accessKeyId: accessKeyId.reveal(), secretAccessKey: secretAccessKey.reveal() } }),
  };
}

export function objectStorageFromConfig(
  config: Parameters<typeof storageOptionsFromConfig>[0],
  secrets: ReadonlyMap<string, Secret<string>>,
): S3ObjectStorage {
  return createS3ObjectStorage(storageOptionsFromConfig(config, secrets));
}
