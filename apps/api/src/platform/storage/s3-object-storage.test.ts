import { createHash, randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';

import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from '@jest/globals';
import { Secret } from '@platform/config';

import { MAX_PRESIGN_TTL_SECONDS, MAX_PUT_BYTES, ObjectStorageError, type ObjectStorageErrorCode } from './object-storage.port.js';
import {
  createS3ObjectStorage,
  objectStorageFromConfig,
  S3_MAX_ATTEMPTS,
  S3_TIMEOUTS,
  s3ClientConfig,
  StorageConfigError,
  storageOptionsFromConfig,
  toObjectStorageError,
  type S3Sender,
} from './s3-object-storage.js';

const BUCKET = 'documents';
const KEY = '2c1f0d3e-0b7a-4d53-9a43-6a1f2d7d8e10/label.pdf';
const SDK_MESSAGE = 'connect ECONNREFUSED 10.9.8.7:9000 for bucket documents';
const ENDPOINT = 'http://storage.internal.test:9000';
const TEXT = 'text/plain';

interface Recorded {
  readonly name: string;
  readonly input: Record<string, unknown>;
  readonly signal: AbortSignal | undefined;
}

/** Fake SDK sender: records commands and answers (or throws) from a queue. */
function fakeSender(...responses: unknown[]): { sender: S3Sender; calls: Recorded[]; destroyed: () => boolean } {
  const calls: Recorded[] = [];
  let destroyed = false;
  const sender: S3Sender = {
    send(command, options): Promise<unknown> {
      calls.push({
        name: command.constructor.name,
        input: (command as { input: Record<string, unknown> }).input,
        signal: options?.abortSignal,
      });
      const next = responses.length > 1 ? responses.shift() : responses[0];
      return next instanceof Error ? Promise.reject(next) : Promise.resolve(next);
    },
    destroy(): void {
      destroyed = true;
    },
  };
  return { sender, calls, destroyed: () => destroyed };
}

const sdkError = (name: string, status?: number, extra: Record<string, unknown> = {}): Error =>
  Object.assign(new Error(SDK_MESSAGE), { name, ...(status === undefined ? {} : { $metadata: { httpStatusCode: status } }), ...extra });

const sha256 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');
const sha256Base64 = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('base64');
const bytes = (text = 'label-bytes'): Uint8Array => new TextEncoder().encode(text);
/** A Node response body as the SDK returns it (an async-iterable Readable). */
const stream = (...chunks: Uint8Array[]): Readable => Readable.from(chunks.map((chunk) => Buffer.from(chunk)));

const presignClient = (): S3Client =>
  new S3Client({
    region: 'us-east-1',
    endpoint: ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: `ak${randomBytes(6).toString('hex')}`, secretAccessKey: randomBytes(20).toString('hex') },
  });

describe('SPK-05 S3 object storage adapter: validation before I/O', () => {
  const put = { bucket: BUCKET, key: KEY, body: bytes(), contentType: 'application/pdf' };

  it.each<[string, Partial<typeof put> & Record<string, unknown>]>([
    ['bucket too short', { bucket: 'ab' }],
    ['bucket too long', { bucket: 'a'.repeat(64) }],
    ['bucket upper case', { bucket: 'Documents' }],
    ['bucket underscore', { bucket: 'doc_uments' }],
    ['bucket leading dot', { bucket: '.documents' }],
    ['bucket consecutive dots', { bucket: 'docu..ments' }],
    ['key empty', { key: '' }],
    ['key leading slash', { key: '/a/b' }],
    ['key dot-dot segment', { key: 'a/../b' }],
    ['key control character', { key: 'a/b\u0000c' }],
    ['key newline', { key: 'a\nb' }],
    ['key longer than 1024 bytes', { key: 'k'.repeat(1025) }],
    ['key multi-byte over 1024 bytes', { key: 'é'.repeat(513) }],
    ['content type empty', { contentType: '' }],
    ['content type with newline', { contentType: 'text/plain\r\nX-Evil: 1' }],
    ['expected sha256 upper case', { sha256: 'A'.repeat(64) }],
    ['expected sha256 short', { sha256: 'abc' }],
    ['metadata key upper case', { metadata: { Foo: 'x' } }],
    ['metadata key reserved sha256', { metadata: { sha256: 'x' } }],
    ['metadata key too long', { metadata: { ['k'.repeat(65)]: 'x' } }],
    ['metadata value non-ascii', { metadata: { note: 'é' } }],
    ['metadata value control character', { metadata: { note: 'a\u0001b' } }],
    ['metadata too many entries', { metadata: Object.fromEntries(Array.from({ length: 17 }, (_, index) => [`k${String(index)}`, 'v'])) }],
  ])('put and putIfAbsent reject %s with INVALID_ARGUMENT and send nothing', async (_label, override) => {
    const { sender, calls } = fakeSender({});
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.put({ ...put, ...override })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(storage.putIfAbsent({ ...put, ...override })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(calls).toHaveLength(0);
  });

  it('rejects a body over 5 MiB with TOO_LARGE and accepts exactly 5 MiB', async () => {
    const { sender, calls } = fakeSender({});
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.put({ ...put, body: new Uint8Array(MAX_PUT_BYTES + 1) })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(calls).toHaveLength(0);
    await expect(storage.put({ ...put, body: new Uint8Array(MAX_PUT_BYTES) })).resolves.toBeDefined();
    expect(calls).toHaveLength(1);
  });

  it('a key of exactly 1024 bytes is accepted', async () => {
    const { sender, calls } = fakeSender({});
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await storage.put({ ...put, key: 'k'.repeat(1024) });
    expect(calls).toHaveLength(1);
  });

  it('head, get, delete, presignGet and checkBucket validate bucket, key and version before I/O', async () => {
    const { sender, calls } = fakeSender({});
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender, presignClient: presignClient() });
    const bad = { bucket: BUCKET, key: '../x' };
    await expect(storage.head(bad)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(storage.get({ bucket: 'X', key: KEY })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(storage.delete({ bucket: BUCKET, key: KEY, versionId: '' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(storage.head({ bucket: BUCKET, key: KEY, versionId: 'v\u0000' })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(storage.presignGet({ ...bad, ttlSeconds: 60, responseContentType: TEXT })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(storage.checkBucket('Bad_Bucket', new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(calls).toHaveLength(0);
  });
});

describe('SPK-05 S3 object storage adapter: put, putIfAbsent, head, get', () => {
  it('put hashes the bytes, maps ContentType, ContentLength, Metadata (sha256 added) and the SHA-256 checksum', async () => {
    const { sender, calls } = fakeSender({ VersionId: 'v1', ETag: '"abc"' });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    const body = bytes('hello');
    const controller = new AbortController();
    const result = await storage.put(
      { bucket: BUCKET, key: KEY, body, contentType: 'application/pdf', metadata: { kind: 'label' } },
      controller.signal,
    );
    expect(result).toEqual({ sha256: sha256(body), versionId: 'v1', etag: '"abc"' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('PutObjectCommand');
    // The SDK gets the caller's signal combined with the operation deadline: aborting the caller aborts the request.
    expect(calls[0]?.signal?.aborted).toBe(false);
    controller.abort();
    expect(calls[0]?.signal?.aborted).toBe(true);
    expect(calls[0]?.input).toEqual({
      Bucket: BUCKET,
      Key: KEY,
      Body: body,
      ContentType: 'application/pdf',
      ContentLength: 5,
      Metadata: { kind: 'label', sha256: sha256(body) },
      ChecksumAlgorithm: 'SHA256',
      ChecksumSHA256: sha256Base64(body),
    });
  });

  it('every operation hands the SDK a bounded signal even when the caller passes none', async () => {
    const { sender, calls } = fakeSender({});
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await storage.put({ bucket: BUCKET, key: KEY, body: bytes(), contentType: TEXT });
    await storage.putIfAbsent({ bucket: BUCKET, key: KEY, body: bytes(), contentType: TEXT });
    await storage.head({ bucket: BUCKET, key: KEY });
    await storage.get({ bucket: BUCKET, key: KEY });
    await storage.delete({ bucket: BUCKET, key: KEY });
    expect(calls).toHaveLength(5);
    for (const call of calls) expect(call.signal).toBeInstanceOf(AbortSignal);
  });

  it('put with a matching expected sha256 succeeds; a mismatch is INTEGRITY_MISMATCH and sends nothing', async () => {
    const { sender, calls } = fakeSender({});
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    const body = bytes('payload');
    await expect(storage.put({ bucket: BUCKET, key: KEY, body, contentType: TEXT, sha256: sha256(body) })).resolves.toEqual({
      sha256: sha256(body),
    });
    calls.length = 0;
    await expect(storage.put({ bucket: BUCKET, key: KEY, body, contentType: TEXT, sha256: sha256(bytes('other')) })).rejects.toMatchObject({
      code: 'INTEGRITY_MISMATCH',
    });
    await expect(
      storage.putIfAbsent({ bucket: BUCKET, key: KEY, body, contentType: TEXT, sha256: sha256(bytes('other')) }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
    expect(calls).toHaveLength(0);
  });

  it('a store that refuses the SHA-256 checksum (400 BadDigest) is INTEGRITY_MISMATCH', async () => {
    const { sender } = fakeSender(sdkError('BadDigest', 400));
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.put({ bucket: BUCKET, key: KEY, body: bytes(), contentType: TEXT })).rejects.toMatchObject({
      code: 'INTEGRITY_MISMATCH',
    });
  });

  it('putIfAbsent sends IfNoneMatch "*" and reports created:true with the result', async () => {
    const { sender, calls } = fakeSender({ ETag: '"e"' });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    const outcome = await storage.putIfAbsent({ bucket: BUCKET, key: KEY, body: bytes(), contentType: 'application/json' });
    expect(outcome).toEqual({ created: true, result: { sha256: sha256(bytes()), etag: '"e"' } });
    expect(calls[0]?.input).toMatchObject({ IfNoneMatch: '*' });
  });

  it.each([
    ['status 412', sdkError('Whatever', 412)],
    ['name PreconditionFailed', sdkError('PreconditionFailed')],
  ])('putIfAbsent maps %s to created:false', async (_label, error) => {
    const { sender } = fakeSender(error);
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.putIfAbsent({ bucket: BUCKET, key: KEY, body: bytes(), contentType: TEXT })).resolves.toEqual({
      created: false,
    });
  });

  it('putIfAbsent: an AWS 409 ConditionalRequestConflict is a retryable UNAVAILABLE, not created:false', async () => {
    const { sender } = fakeSender(sdkError('ConditionalRequestConflict', 409));
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.putIfAbsent({ bucket: BUCKET, key: KEY, body: bytes(), contentType: TEXT })).rejects.toMatchObject({
      code: 'UNAVAILABLE',
    });
  });

  it('put never sets IfNoneMatch and a 412 on put is an error, not created:false', async () => {
    const { sender, calls } = fakeSender(sdkError('PreconditionFailed', 412));
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.put({ bucket: BUCKET, key: KEY, body: bytes(), contentType: TEXT })).rejects.toMatchObject({
      code: 'UNEXPECTED',
    });
    expect(calls[0]?.input).not.toHaveProperty('IfNoneMatch');
  });

  it('head maps the SDK output (claim and store checksum apart), hides sha256 from metadata and passes the version id', async () => {
    const hash = sha256(bytes());
    const modified = new Date('2026-11-01T10:00:00Z');
    const { sender, calls } = fakeSender({
      ContentType: 'application/pdf',
      ContentLength: 11,
      Metadata: { sha256: hash, kind: 'label' },
      ChecksumSHA256: sha256Base64(bytes()),
      VersionId: 'v9',
      ETag: '"t"',
      LastModified: modified,
    });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.head({ bucket: BUCKET, key: KEY, versionId: 'v9' })).resolves.toEqual({
      contentType: 'application/pdf',
      contentLength: 11,
      sha256: hash,
      checksumSha256: hash,
      metadata: { kind: 'label' },
      versionId: 'v9',
      etag: '"t"',
      lastModified: modified,
    });
    expect(calls[0]?.name).toBe('HeadObjectCommand');
    expect(calls[0]?.input).toEqual({ Bucket: BUCKET, Key: KEY, VersionId: 'v9', ChecksumMode: 'ENABLED' });
  });

  it.each([
    ['a composite multipart checksum', `${sha256Base64(bytes())}-3`],
    ['a CRC-sized value', 'AAAAAA=='],
  ])('head ignores %s as checksumSha256', async (_label, value) => {
    const { sender } = fakeSender({ ChecksumSHA256: value });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.head({ bucket: BUCKET, key: KEY })).resolves.not.toHaveProperty('checksumSha256');
  });

  it('head tolerates a sparse output and ignores a malformed sha256 metadata value', async () => {
    const { sender } = fakeSender({ Metadata: { sha256: 'not-hex' } });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.head({ bucket: BUCKET, key: KEY })).resolves.toEqual({ contentLength: 0, metadata: {} });
  });

  it.each([
    ['NotFound by name', sdkError('NotFound', 404)],
    ['NoSuchKey by name', sdkError('NoSuchKey')],
    ['404 with an unknown name', sdkError('UnknownCode', 404)],
  ])('head and get resolve undefined for a missing object (%s)', async (_label, error) => {
    const { sender } = fakeSender(error);
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.head({ bucket: BUCKET, key: KEY })).resolves.toBeUndefined();
    await expect(storage.get({ bucket: BUCKET, key: KEY })).resolves.toBeUndefined();
  });

  it('a missing bucket (NoSuchBucket) is an error, not an absent object', async () => {
    const { sender } = fakeSender(sdkError('NoSuchBucket', 404));
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.head({ bucket: BUCKET, key: KEY })).rejects.toBeInstanceOf(ObjectStorageError);
  });

  it('get reads the whole body in chunks, returns the head fields and the sha256 computed over the bytes', async () => {
    const body = bytes('stored body');
    const { sender, calls } = fakeSender({
      Body: stream(body.subarray(0, 4), body.subarray(4)),
      ContentLength: body.byteLength,
      ContentType: TEXT,
      Metadata: { sha256: sha256(body) },
    });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    const stored = await storage.get({ bucket: BUCKET, key: KEY, versionId: 'v1' });
    expect(stored?.body).toEqual(body);
    expect(stored).toMatchObject({ contentType: TEXT, contentLength: 11, sha256: sha256(body) });
    expect(calls[0]?.input).toEqual({ Bucket: BUCKET, Key: KEY, VersionId: 'v1' });
  });

  it('get of an object without a sha256 claim still returns the computed digest', async () => {
    const body = bytes('foreign object');
    const { sender } = fakeSender({ Body: stream(body), ContentLength: body.byteLength });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.get({ bucket: BUCKET, key: KEY })).resolves.toMatchObject({ sha256: sha256(body) });
  });

  it('get refuses a body that contradicts its sha256 metadata claim (INTEGRITY_MISMATCH)', async () => {
    const { sender } = fakeSender({ Body: stream(bytes('tampered')), Metadata: { sha256: sha256(bytes('original')) } });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.get({ bucket: BUCKET, key: KEY })).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
  });

  it('get returns an empty body when the SDK returns none', async () => {
    const { sender } = fakeSender({ ContentLength: 0 });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.get({ bucket: BUCKET, key: KEY })).resolves.toMatchObject({
      body: new Uint8Array(0),
      sha256: sha256(new Uint8Array(0)),
    });
  });

  it('get refuses a body that is not a stream (UNEXPECTED)', async () => {
    const { sender } = fakeSender({ Body: { transformToByteArray: () => Promise.resolve(bytes()) } });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.get({ bucket: BUCKET, key: KEY })).rejects.toMatchObject({ code: 'UNEXPECTED' });
  });

  it('get refuses to buffer an object declared over 5 MiB and releases the stream', async () => {
    let destroyed = false;
    const { sender } = fakeSender({
      Body: {
        [Symbol.asyncIterator]: () => {
          throw new Error('must not be read');
        },
        destroy: () => {
          destroyed = true;
        },
      },
      ContentLength: MAX_PUT_BYTES + 1,
    });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.get({ bucket: BUCKET, key: KEY })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(destroyed).toBe(true);
  });

  it('get counts bytes: a body over 5 MiB without (or below) its ContentLength is TOO_LARGE, and exactly 5 MiB passes', async () => {
    const chunk = new Uint8Array(1024 * 1024);
    const over = fakeSender({ Body: stream(chunk, chunk, chunk, chunk, chunk, new Uint8Array(1)) });
    await expect(
      createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: over.sender }).get({ bucket: BUCKET, key: KEY }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    const lying = fakeSender({ Body: stream(chunk, chunk, chunk, chunk, chunk, new Uint8Array(1)), ContentLength: 10 });
    await expect(
      createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: lying.sender }).get({ bucket: BUCKET, key: KEY }),
    ).rejects.toMatchObject({ code: 'TOO_LARGE' });
    const exact = fakeSender({ Body: stream(chunk, chunk, chunk, chunk, chunk) });
    const stored = await createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: exact.sender }).get({
      bucket: BUCKET,
      key: KEY,
    });
    expect(stored?.body.byteLength).toBe(MAX_PUT_BYTES);
  });

  it('delete sends DeleteObject (with the version when given) and checkBucket sends HeadBucket under the caller signal', async () => {
    const { sender, calls } = fakeSender({});
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await storage.delete({ bucket: BUCKET, key: KEY, versionId: 'v2' });
    const controller = new AbortController();
    await storage.checkBucket(BUCKET, controller.signal);
    expect(calls.map((call) => call.name)).toEqual(['DeleteObjectCommand', 'HeadBucketCommand']);
    expect(calls[0]?.input).toEqual({ Bucket: BUCKET, Key: KEY, VersionId: 'v2' });
    expect(calls[1]?.input).toEqual({ Bucket: BUCKET });
    controller.abort();
    expect(calls[1]?.signal?.aborted).toBe(true);
  });

  it('destroy closes the injected sender and the presign client', () => {
    const { sender, destroyed } = fakeSender({});
    const signer = presignClient();
    let signerDestroyed = false;
    signer.destroy = (): void => {
      signerDestroyed = true;
    };
    createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender, presignClient: signer }).destroy();
    expect(destroyed()).toBe(true);
    expect(signerDestroyed).toBe(true);
  });
});

describe('SPK-05 S3 object storage adapter: presignGet', () => {
  // A non-zero millisecond part: X-Amz-Date is floored to the second, so must be the signing time behind expiresAt.
  const now = new Date('2026-11-13T08:00:00.900Z');
  const base = { bucket: BUCKET, key: KEY, responseContentType: 'application/pdf' } as const;
  const signerStorage = (): ReturnType<typeof createS3ObjectStorage> =>
    createS3ObjectStorage({
      region: 'us-east-1',
      forcePathStyle: true,
      client: fakeSender().sender,
      presignClient: presignClient(),
      now: () => now,
    });

  it('signs a path-style GET with a forced content type, attachment disposition and the exact expiry', async () => {
    const presigned = await signerStorage().presignGet({ ...base, ttlSeconds: 120 });
    const url = new URL(presigned.url);
    expect(url.searchParams.get('X-Amz-Date')).toBe('20261113T080000Z');
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
    // The store stops honouring the URL at X-Amz-Date + X-Amz-Expires: expiresAt must be exactly that, never later.
    expect(presigned.expiresAt).toEqual(new Date('2026-11-13T08:02:00.000Z'));
    expect(url.origin).toBe(ENDPOINT);
    expect(url.pathname.startsWith(`/${BUCKET}/`)).toBe(true);
    expect(url.searchParams.get('response-content-type')).toBe('application/pdf');
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment');
  });

  it('honours an attachment disposition with a filename, a version id and inline only when explicitly allowed', async () => {
    const storage = signerStorage();
    const named = new URL(
      (await storage.presignGet({ ...base, ttlSeconds: 1, contentDisposition: 'attachment; filename="label.pdf"', versionId: 'v3' })).url,
    );
    expect(named.searchParams.get('response-content-disposition')).toBe('attachment; filename="label.pdf"');
    expect(named.searchParams.get('versionId')).toBe('v3');
    const inline = new URL((await storage.presignGet({ ...base, ttlSeconds: 1, contentDisposition: 'inline', allowInline: true })).url);
    expect(inline.searchParams.get('response-content-disposition')).toBe('inline');
  });

  it.each<[string, Record<string, unknown>]>([
    ['inline without allowInline', { contentDisposition: 'inline' }],
    ['inline with allowInline false', { contentDisposition: 'INLINE; filename=a.html', allowInline: false }],
    ['an unknown disposition type', { contentDisposition: 'x-download' }],
    ['a bare parameter list', { contentDisposition: '; filename=a.pdf' }],
    ['a disposition with CR/LF', { contentDisposition: 'attachment\r\nX-Evil: 1' }],
    ['an empty content type', { responseContentType: '' }],
    ['a content type without subtype', { responseContentType: 'text' }],
    ['a content type with CR/LF', { responseContentType: 'text/plain\r\nX-Evil: 1' }],
    ['a content type with a quoted parameter', { responseContentType: 'text/plain; charset="utf-8"' }],
  ])('rejects %s with INVALID_ARGUMENT before signing', async (_label, override) => {
    await expect(signerStorage().presignGet({ ...base, ttlSeconds: 60, ...override })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
  });

  it.each([0, -1, MAX_PRESIGN_TTL_SECONDS + 1, 1.5, Number.NaN])('rejects ttlSeconds %s before any I/O', async (ttlSeconds) => {
    const { sender, calls } = fakeSender({});
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender, presignClient: presignClient() });
    await expect(storage.presignGet({ ...base, ttlSeconds })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(calls).toHaveLength(0);
  });

  it('accepts the bounds 1 and 300 and a content type with a token parameter', async () => {
    const storage = signerStorage();
    await expect(storage.presignGet({ ...base, ttlSeconds: 1 })).resolves.toBeDefined();
    await expect(storage.presignGet({ ...base, ttlSeconds: 300, responseContentType: 'text/plain; charset=utf-8' })).resolves.toBeDefined();
  });

  it('an injected sender without a presign client cannot sign (UNEXPECTED, not a crash)', async () => {
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: fakeSender().sender });
    await expect(storage.presignGet({ ...base, ttlSeconds: 60 })).rejects.toMatchObject({ code: 'UNEXPECTED' });
  });

  it('without injection a second client is built for a different public endpoint and the pre-signed URL uses it', async () => {
    const accessKeyId = `ak${randomBytes(6).toString('hex')}`;
    const storage = createS3ObjectStorage({
      endpoint: 'http://rustfs:9000',
      publicEndpoint: 'http://localhost:9000',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey: randomBytes(20).toString('hex') },
    });
    try {
      const url = new URL((await storage.presignGet({ ...base, ttlSeconds: 60 })).url);
      expect(url.origin).toBe('http://localhost:9000');
      expect(url.searchParams.get('X-Amz-Credential')?.startsWith(`${accessKeyId}/`)).toBe(true);
    } finally {
      storage.destroy();
    }
  });

  it('without a public endpoint the signing client is the main one', async () => {
    const storage = createS3ObjectStorage({
      endpoint: 'http://rustfs:9000',
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: `ak${randomBytes(6).toString('hex')}`, secretAccessKey: randomBytes(20).toString('hex') },
    });
    try {
      const url = new URL((await storage.presignGet({ ...base, ttlSeconds: 60 })).url);
      expect(url.origin).toBe('http://rustfs:9000');
    } finally {
      storage.destroy();
    }
  });
});

describe('SPK-05 S3 object storage adapter: error mapping hides the SDK message', () => {
  it.each<[string, Error, ObjectStorageErrorCode]>([
    ['403 AccessDenied', sdkError('AccessDenied', 403), 'ACCESS_DENIED'],
    ['403 SignatureDoesNotMatch', sdkError('SignatureDoesNotMatch', 403), 'ACCESS_DENIED'],
    ['403 RequestTimeTooSkewed', sdkError('RequestTimeTooSkewed', 403), 'ACCESS_DENIED'],
    ['400 ExpiredToken', sdkError('ExpiredToken', 400), 'ACCESS_DENIED'],
    ['400 TokenRefreshRequired', sdkError('TokenRefreshRequired', 400), 'ACCESS_DENIED'],
    ['no credentials (CredentialsProviderError)', sdkError('CredentialsProviderError'), 'ACCESS_DENIED'],
    ['500', sdkError('InternalError', 500), 'UNAVAILABLE'],
    ['503 SlowDown', sdkError('SlowDown', 503), 'UNAVAILABLE'],
    ['429', sdkError('Throttled', 429), 'UNAVAILABLE'],
    ['408', sdkError('RequestTimeout', 408), 'UNAVAILABLE'],
    ['400 RequestTimeout (what S3 sends for a stalled upload)', sdkError('RequestTimeout', 400), 'UNAVAILABLE'],
    ['409 ConditionalRequestConflict', sdkError('ConditionalRequestConflict', 409), 'UNAVAILABLE'],
    ['connection refused', sdkError('Error', undefined, { code: 'ECONNREFUSED' }), 'UNAVAILABLE'],
    ['connection reset', sdkError('Error', undefined, { code: 'ECONNRESET' }), 'UNAVAILABLE'],
    ['timeout', sdkError('TimeoutError'), 'UNAVAILABLE'],
    ['abort', sdkError('AbortError'), 'UNAVAILABLE'],
    ['400 BadDigest', sdkError('BadDigest', 400), 'INTEGRITY_MISMATCH'],
    ['404 NoSuchBucket', sdkError('NoSuchBucket', 404), 'UNEXPECTED'],
    ['409 another conflict', sdkError('OperationAborted', 409), 'UNEXPECTED'],
    ['unknown error', sdkError('Surprise'), 'UNEXPECTED'],
  ])('%s becomes %s with a fixed message', async (_label, error, code) => {
    const { sender } = fakeSender(error);
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    const operations: Array<() => Promise<unknown>> = [
      () => storage.put({ bucket: BUCKET, key: KEY, body: bytes(), contentType: TEXT }),
      () => storage.head({ bucket: BUCKET, key: KEY }),
      () => storage.get({ bucket: BUCKET, key: KEY }),
      () => storage.delete({ bucket: BUCKET, key: KEY }),
      () => storage.checkBucket(BUCKET, new AbortController().signal),
    ];
    for (const operation of operations) {
      const failure: unknown = await operation().then(
        () => undefined,
        (rejection: unknown) => rejection,
      );
      expect(failure).toBeInstanceOf(ObjectStorageError);
      expect(failure).toMatchObject({ code, message: code });
      for (const leak of [SDK_MESSAGE, 'ECONNREFUSED', '10.9.8.7', BUCKET, KEY]) {
        expect((failure as Error).message).not.toContain(leak);
        expect(String(failure)).not.toContain(leak);
      }
      expect(failure).not.toHaveProperty('cause');
    }
  });

  it('an ObjectStorageError passes through unchanged and non-error values map to UNEXPECTED', () => {
    const original = new ObjectStorageError('TOO_LARGE');
    expect(toObjectStorageError(original)).toBe(original);
    expect(toObjectStorageError('boom').code).toBe('UNEXPECTED');
    expect(toObjectStorageError(undefined).code).toBe('UNEXPECTED');
    expect(toObjectStorageError({ name: 7, $metadata: { httpStatusCode: 'x' }, code: 5 }).code).toBe('UNEXPECTED');
  });

  it('an unreachable store fails presign-free calls as UNAVAILABLE, honouring the caller abort signal', async () => {
    const { sender, calls } = fakeSender(sdkError('AbortError'));
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    const controller = new AbortController();
    controller.abort();
    await expect(storage.checkBucket(BUCKET, controller.signal)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(calls[0]?.signal?.aborted).toBe(true);
  });

  it('once the caller aborted, any failure (even one the map calls UNEXPECTED) is UNAVAILABLE', async () => {
    const controller = new AbortController();
    const sender: S3Sender = {
      send: () => {
        controller.abort();
        return Promise.reject(sdkError('Surprise'));
      },
    };
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.head({ bucket: BUCKET, key: KEY }, controller.signal)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
  });
});

describe('SPK-05 SDK client configuration (CLAUDE.md §9; PR30-SEC-01)', () => {
  it('pins connect 2 s, request 10 s that throws, and 3 attempts; deadlines 15 s (data) and 5 s (metadata)', () => {
    expect(S3_TIMEOUTS).toEqual({ connectionMs: 2_000, requestMs: 10_000, dataDeadlineMs: 15_000, metadataDeadlineMs: 5_000 });
    expect(S3_MAX_ATTEMPTS).toBe(3);
    expect(s3ClientConfig({ region: 'us-east-1', forcePathStyle: true }, ENDPOINT)).toEqual({
      region: 'us-east-1',
      forcePathStyle: true,
      endpoint: ENDPOINT,
      requestHandler: { connectionTimeout: 2_000, requestTimeout: 10_000, throwOnRequestTimeout: true },
      maxAttempts: 3,
    });
  });

  it('the production client is built from that configuration (resolved by the SDK)', async () => {
    const client = new S3Client(s3ClientConfig({ region: 'us-east-1', forcePathStyle: true }, ENDPOINT));
    try {
      expect(await client.config.maxAttempts()).toBe(3);
      const handlerConfig = await (client.config.requestHandler as unknown as { configProvider: Promise<Record<string, unknown>> })
        .configProvider;
      expect(handlerConfig).toMatchObject({ connectionTimeout: 2_000, requestTimeout: 10_000, throwOnRequestTimeout: true });
    } finally {
      client.destroy();
    }
  });
});

describe('SPK-05 configuration mapping', () => {
  const base = {
    STORAGE_ENDPOINT: ENDPOINT,
    STORAGE_PUBLIC_ENDPOINT: 'http://localhost:9000',
    STORAGE_REGION: 'eu-west-1',
    STORAGE_FORCE_PATH_STYLE: true,
  } as const;
  const accessKeyId = `ak${randomBytes(6).toString('hex')}`;
  const secretAccessKey = randomBytes(20).toString('hex');

  it('maps endpoint, public endpoint, region, path style and both resolved secrets', () => {
    const options = storageOptionsFromConfig(
      base,
      new Map([
        ['STORAGE_ACCESS_KEY_ID_REF', new Secret(accessKeyId)],
        ['STORAGE_SECRET_ACCESS_KEY_REF', new Secret(secretAccessKey)],
      ]),
    );
    expect(options).toEqual({
      endpoint: ENDPOINT,
      publicEndpoint: 'http://localhost:9000',
      region: 'eu-west-1',
      forcePathStyle: true,
      credentials: { accessKeyId, secretAccessKey },
    });
  });

  it('sets no static credentials with neither secret (SDK default chain)', () => {
    expect(storageOptionsFromConfig(base, new Map())).not.toHaveProperty('credentials');
  });

  it.each([
    ['only the access key id', new Map([['STORAGE_ACCESS_KEY_ID_REF', new Secret(accessKeyId)]])],
    ['only the secret access key', new Map([['STORAGE_SECRET_ACCESS_KEY_REF', new Secret(secretAccessKey)]])],
  ])('refuses a half-written pair (%s): StorageConfigError naming the keys, never a value', (_label, secrets) => {
    let thrown: unknown;
    try {
      storageOptionsFromConfig(base, secrets);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorageConfigError);
    expect(thrown).toMatchObject({ name: 'StorageConfigError' });
    const message = (thrown as Error).message;
    expect(message).toMatch(/STORAGE_ACCESS_KEY_ID_REF.*STORAGE_SECRET_ACCESS_KEY_REF/u);
    expect(message).not.toContain(accessKeyId);
    expect(message).not.toContain(secretAccessKey);
  });

  it('omits unset endpoints (AWS S3) and builds a closeable storage from the configuration', () => {
    const awsConfig = { STORAGE_REGION: 'us-east-1', STORAGE_FORCE_PATH_STYLE: false } as Parameters<typeof storageOptionsFromConfig>[0];
    const options = storageOptionsFromConfig(awsConfig, new Map());
    expect(options).toEqual({ region: 'us-east-1', forcePathStyle: false });
    const storage = objectStorageFromConfig(base, new Map());
    expect(() => storage.destroy()).not.toThrow();
  });
});
