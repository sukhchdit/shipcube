/**
 * The one `ObjectStorage` implementation (ADR-0021 §1; SPK-05): `@aws-sdk/client-s3` + `@aws-sdk/s3-request-presigner`
 * against any S3 endpoint (RustFS locally, AWS S3 at M5). Only files in this folder import the AWS SDK for S3 (boundary
 * test).
 *
 * Every call has a connect timeout (2 s), a request timeout (10 s) and SDK standard retries (3 attempts, jittered
 * backoff) and takes the caller's abort signal. All operations are idempotent except that a retried `putIfAbsent`
 * whose first attempt succeeded but lost its response reports `created: false`; callers that care compare the stored
 * `sha256` with `head` (SPK-05 §3). Arguments are validated before any I/O. SDK errors become `ObjectStorageError`
 * with a fixed message: the SDK message can carry the endpoint, bucket and key and is never copied.
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

export const S3_CONNECTION_TIMEOUT_MS = 2_000;
export const S3_REQUEST_TIMEOUT_MS = 10_000;
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
  /** Test seams: replace the SDK clients. */
  readonly client?: S3Sender;
  readonly presignClient?: S3Client;
}

export interface S3ObjectStorage extends ObjectStorage {
  /** Closes both SDK clients (graceful shutdown). */
  destroy(): void;
}

const SHA256_HEX = /^[0-9a-f]{64}$/u;
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/u;
const METADATA_KEY = /^[a-z0-9-]{1,64}$/u;
const METADATA_VALUE = /^[\x20-\x7e]{0,256}$/u;
/** Unicode category Cc: C0 controls, DEL and C1 controls. */
const CONTROL_CHARACTERS = /\p{Cc}/u;
const MAX_KEY_BYTES = 1024;
const MAX_METADATA_ENTRIES = 16;
/** Node system error codes that mean "could not reach the store" (`ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT` …). */
const SYSTEM_ERROR_CODE = /^E[A-Z0-9_]{3,}$/u;
const UNAVAILABLE_NAMES: ReadonlySet<string> = new Set(['AbortError', 'TimeoutError', 'RequestTimeout', 'RequestTimeTooSkewed']);

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

const sha256Hex = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

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

/** Maps an SDK failure to a port error. Reads the status, name and code only, never the message. */
export function toObjectStorageError(error: unknown): ObjectStorageError {
  if (error instanceof ObjectStorageError) return error;
  const status = statusOf(error);
  const name = nameOf(error);
  const code = (error as SdkErrorShape | undefined)?.code;
  let mapped: ObjectStorageErrorCode = 'UNEXPECTED';
  if (status === 403) mapped = 'ACCESS_DENIED';
  else if (status !== undefined) mapped = status >= 500 || status === 408 || status === 429 ? 'UNAVAILABLE' : 'UNEXPECTED';
  else if (name !== undefined && UNAVAILABLE_NAMES.has(name)) mapped = 'UNAVAILABLE';
  else if (typeof code === 'string' && SYSTEM_ERROR_CODE.test(code)) mapped = 'UNAVAILABLE';
  return new ObjectStorageError(mapped);
}

function toHead(output: HeadObjectCommandOutput | GetObjectCommandOutput): ObjectHead {
  const { sha256, ...metadata } = output.Metadata ?? {};
  return {
    ...(output.ContentType === undefined ? {} : { contentType: output.ContentType }),
    contentLength: output.ContentLength ?? 0,
    ...(sha256 === undefined || !SHA256_HEX.test(sha256) ? {} : { sha256 }),
    metadata,
    ...(output.VersionId === undefined ? {} : { versionId: output.VersionId }),
    ...(output.ETag === undefined ? {} : { etag: output.ETag }),
    ...(output.LastModified === undefined ? {} : { lastModified: output.LastModified }),
  };
}

export function createS3ObjectStorage(options: S3ObjectStorageOptions): S3ObjectStorage {
  const now = options.now ?? ((): Date => new Date());
  const clientConfig = (endpoint: string | undefined): S3ClientConfig => ({
    region: options.region,
    forcePathStyle: options.forcePathStyle,
    ...(endpoint === undefined ? {} : { endpoint }),
    ...(options.credentials === undefined ? {} : { credentials: { ...options.credentials } }),
    requestHandler: { connectionTimeout: S3_CONNECTION_TIMEOUT_MS, requestTimeout: S3_REQUEST_TIMEOUT_MS },
    maxAttempts: S3_MAX_ATTEMPTS,
  });
  const client: S3Sender = options.client ?? new S3Client(clientConfig(options.endpoint));
  const publicEndpoint = options.publicEndpoint ?? options.endpoint;
  const presignClient =
    options.presignClient ??
    (options.publicEndpoint === undefined || options.publicEndpoint === options.endpoint
      ? undefined
      : new S3Client(clientConfig(publicEndpoint)));
  const signer: S3Client | undefined = presignClient ?? (options.client === undefined ? (client as S3Client) : undefined);

  async function send<T>(command: object, signal: AbortSignal | undefined): Promise<T> {
    try {
      return (await client.send(command, signal === undefined ? undefined : { abortSignal: signal })) as T;
    } catch (error) {
      throw toObjectStorageError(error);
    }
  }

  async function write(input: PutObjectInput, signal: AbortSignal | undefined, ifAbsent: boolean): Promise<PutIfAbsentResult> {
    assertPut(input);
    const sha256 = sha256Hex(input.body);
    if (input.sha256 !== undefined && input.sha256 !== sha256) throw new ObjectStorageError('INTEGRITY_MISMATCH');
    const command = new PutObjectCommand({
      Bucket: input.bucket,
      Key: input.key,
      Body: input.body,
      ContentType: input.contentType,
      ContentLength: input.body.byteLength,
      Metadata: { ...input.metadata, sha256 },
      ...(ifAbsent ? { IfNoneMatch: '*' } : {}),
    });
    try {
      const output = (await client.send(command, signal === undefined ? undefined : { abortSignal: signal })) as PutObjectCommandOutput;
      const result: PutObjectResult = {
        sha256,
        ...(output.VersionId === undefined ? {} : { versionId: output.VersionId }),
        ...(output.ETag === undefined ? {} : { etag: output.ETag }),
      };
      return { created: true, result };
    } catch (error) {
      if (ifAbsent && isPreconditionFailed(error)) return { created: false };
      throw toObjectStorageError(error);
    }
  }

  return {
    async put(input, signal): Promise<PutObjectResult> {
      const outcome = await write(input, signal, false);
      if (!outcome.created) throw new ObjectStorageError('UNEXPECTED');
      return outcome.result;
    },

    putIfAbsent: (input, signal) => write(input, signal, true),

    async head(locator: ObjectLocator, signal?: AbortSignal): Promise<ObjectHead | undefined> {
      assertLocator(locator);
      const command = new HeadObjectCommand({
        Bucket: locator.bucket,
        Key: locator.key,
        ...(locator.versionId === undefined ? {} : { VersionId: locator.versionId }),
      });
      try {
        return toHead((await client.send(command, signal === undefined ? undefined : { abortSignal: signal })) as HeadObjectCommandOutput);
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw toObjectStorageError(error);
      }
    },

    async get(locator: ObjectLocator, signal?: AbortSignal): Promise<StoredObject | undefined> {
      assertLocator(locator);
      const command = new GetObjectCommand({
        Bucket: locator.bucket,
        Key: locator.key,
        ...(locator.versionId === undefined ? {} : { VersionId: locator.versionId }),
      });
      try {
        const output = (await client.send(command, signal === undefined ? undefined : { abortSignal: signal })) as GetObjectCommandOutput;
        if ((output.ContentLength ?? 0) > MAX_PUT_BYTES) {
          // Stored objects are ≤ 5 MB through this port; refuse to buffer anything bigger.
          (output.Body as { destroy?: () => void } | undefined)?.destroy?.();
          throw new ObjectStorageError('TOO_LARGE');
        }
        const body = (await output.Body?.transformToByteArray()) ?? new Uint8Array(0);
        return { ...toHead(output), body };
      } catch (error) {
        if (isNotFound(error)) return undefined;
        throw toObjectStorageError(error);
      }
    },

    async presignGet(input: PresignGetInput): Promise<PresignedUrl> {
      assertLocator(input);
      if (!Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 1 || input.ttlSeconds > MAX_PRESIGN_TTL_SECONDS) throw invalid();
      const disposition = input.contentDisposition ?? 'attachment';
      assertHeaderText(disposition, 1024);
      if (signer === undefined) throw new ObjectStorageError('UNEXPECTED');
      const signingDate = now();
      try {
        const url = await getSignedUrl(
          signer,
          new GetObjectCommand({
            Bucket: input.bucket,
            Key: input.key,
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

    async delete(locator: ObjectLocator, signal?: AbortSignal): Promise<void> {
      assertLocator(locator);
      await send(
        new DeleteObjectCommand({
          Bucket: locator.bucket,
          Key: locator.key,
          ...(locator.versionId === undefined ? {} : { VersionId: locator.versionId }),
        }),
        signal,
      );
    },

    async checkBucket(bucket: string, signal: AbortSignal): Promise<void> {
      assertBucket(bucket);
      await send(new HeadBucketCommand({ Bucket: bucket }), signal);
    },

    destroy(): void {
      client.destroy?.();
      presignClient?.destroy();
    },
  };
}

/**
 * Maps the typed configuration (`STORAGE_*`) and the resolved secrets to adapter options. Static credentials are set
 * only when both references resolved; otherwise the SDK default provider chain applies (IAM role at M5).
 */
export function storageOptionsFromConfig(
  config: Pick<Config, 'STORAGE_ENDPOINT' | 'STORAGE_PUBLIC_ENDPOINT' | 'STORAGE_REGION' | 'STORAGE_FORCE_PATH_STYLE'>,
  secrets: ReadonlyMap<string, Secret<string>>,
): S3ObjectStorageOptions {
  const accessKeyId = secrets.get('STORAGE_ACCESS_KEY_ID_REF');
  const secretAccessKey = secrets.get('STORAGE_SECRET_ACCESS_KEY_REF');
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
