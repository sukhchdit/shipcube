import { createHash, randomBytes } from 'node:crypto';

import { S3Client } from '@aws-sdk/client-s3';
import { describe, expect, it } from '@jest/globals';
import { Secret } from '@platform/config';

import { MAX_PRESIGN_TTL_SECONDS, MAX_PUT_BYTES, ObjectStorageError, type ObjectStorageErrorCode } from './object-storage.port.js';
import {
  createS3ObjectStorage,
  objectStorageFromConfig,
  storageOptionsFromConfig,
  toObjectStorageError,
  type S3Sender,
} from './s3-object-storage.js';

const BUCKET = 'documents';
const KEY = '2c1f0d3e-0b7a-4d53-9a43-6a1f2d7d8e10/label.pdf';
const SDK_MESSAGE = 'connect ECONNREFUSED 10.9.8.7:9000 for bucket documents';
const ENDPOINT = 'http://storage.internal.test:9000';

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
const bytes = (text = 'label-bytes'): Uint8Array => new TextEncoder().encode(text);

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
    await expect(storage.presignGet({ ...bad, ttlSeconds: 60 })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    await expect(storage.presignGet({ bucket: BUCKET, key: KEY, ttlSeconds: 60, contentDisposition: 'a\r\nb' })).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
    await expect(storage.checkBucket('Bad_Bucket', new AbortController().signal)).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(calls).toHaveLength(0);
  });
});

describe('SPK-05 S3 object storage adapter: put, putIfAbsent, head, get', () => {
  it('put hashes the bytes, maps ContentType, ContentLength and Metadata (sha256 added) and returns the result', async () => {
    const { sender, calls } = fakeSender({ VersionId: 'v1', ETag: '"abc"' });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    const body = bytes('hello');
    const signal = new AbortController().signal;
    const result = await storage.put(
      { bucket: BUCKET, key: KEY, body, contentType: 'application/pdf', metadata: { kind: 'label' } },
      signal,
    );
    expect(result).toEqual({ sha256: sha256(body), versionId: 'v1', etag: '"abc"' });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.name).toBe('PutObjectCommand');
    expect(calls[0]?.signal).toBe(signal);
    expect(calls[0]?.input).toEqual({
      Bucket: BUCKET,
      Key: KEY,
      Body: body,
      ContentType: 'application/pdf',
      ContentLength: 5,
      Metadata: { kind: 'label', sha256: sha256(body) },
    });
  });

  it('put with a matching expected sha256 succeeds; a mismatch is INTEGRITY_MISMATCH and sends nothing', async () => {
    const { sender, calls } = fakeSender({});
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    const body = bytes('payload');
    await expect(storage.put({ bucket: BUCKET, key: KEY, body, contentType: 'text/plain', sha256: sha256(body) })).resolves.toEqual({
      sha256: sha256(body),
    });
    calls.length = 0;
    await expect(
      storage.put({ bucket: BUCKET, key: KEY, body, contentType: 'text/plain', sha256: sha256(bytes('other')) }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
    await expect(
      storage.putIfAbsent({ bucket: BUCKET, key: KEY, body, contentType: 'text/plain', sha256: sha256(bytes('other')) }),
    ).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
    expect(calls).toHaveLength(0);
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
    await expect(storage.putIfAbsent({ bucket: BUCKET, key: KEY, body: bytes(), contentType: 'text/plain' })).resolves.toEqual({
      created: false,
    });
  });

  it('put never sets IfNoneMatch and a 412 on put is an error, not created:false', async () => {
    const { sender, calls } = fakeSender(sdkError('PreconditionFailed', 412));
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.put({ bucket: BUCKET, key: KEY, body: bytes(), contentType: 'text/plain' })).rejects.toMatchObject({
      code: 'UNEXPECTED',
    });
    expect(calls[0]?.input).not.toHaveProperty('IfNoneMatch');
  });

  it('head maps the SDK output, hides sha256 from metadata and passes the version id', async () => {
    const hash = sha256(bytes());
    const modified = new Date('2026-11-01T10:00:00Z');
    const { sender, calls } = fakeSender({
      ContentType: 'application/pdf',
      ContentLength: 11,
      Metadata: { sha256: hash, kind: 'label' },
      VersionId: 'v9',
      ETag: '"t"',
      LastModified: modified,
    });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.head({ bucket: BUCKET, key: KEY, versionId: 'v9' })).resolves.toEqual({
      contentType: 'application/pdf',
      contentLength: 11,
      sha256: hash,
      metadata: { kind: 'label' },
      versionId: 'v9',
      etag: '"t"',
      lastModified: modified,
    });
    expect(calls[0]?.name).toBe('HeadObjectCommand');
    expect(calls[0]?.input).toEqual({ Bucket: BUCKET, Key: KEY, VersionId: 'v9' });
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

  it('get reads the whole body and the head fields', async () => {
    const body = bytes('stored');
    const { sender, calls } = fakeSender({
      Body: { transformToByteArray: () => Promise.resolve(body) },
      ContentLength: body.byteLength,
      ContentType: 'text/plain',
      Metadata: { sha256: sha256(body) },
    });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    const stored = await storage.get({ bucket: BUCKET, key: KEY, versionId: 'v1' });
    expect(stored?.body).toEqual(body);
    expect(stored).toMatchObject({ contentType: 'text/plain', contentLength: 6, sha256: sha256(body) });
    expect(calls[0]?.input).toEqual({ Bucket: BUCKET, Key: KEY, VersionId: 'v1' });
  });

  it('get returns an empty body when the SDK returns none', async () => {
    const { sender } = fakeSender({ ContentLength: 0 });
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await expect(storage.get({ bucket: BUCKET, key: KEY })).resolves.toMatchObject({ body: new Uint8Array(0) });
  });

  it('get refuses to buffer an object over 5 MiB and releases the stream', async () => {
    let destroyed = false;
    const { sender } = fakeSender({
      Body: {
        transformToByteArray: () => Promise.reject(new Error('must not be read')),
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

  it('delete sends DeleteObject (with the version when given) and checkBucket sends HeadBucket with the signal', async () => {
    const { sender, calls } = fakeSender({});
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    await storage.delete({ bucket: BUCKET, key: KEY, versionId: 'v2' });
    const signal = new AbortController().signal;
    await storage.checkBucket(BUCKET, signal);
    expect(calls.map((call) => call.name)).toEqual(['DeleteObjectCommand', 'HeadBucketCommand']);
    expect(calls[0]?.input).toEqual({ Bucket: BUCKET, Key: KEY, VersionId: 'v2' });
    expect(calls[1]?.input).toEqual({ Bucket: BUCKET });
    expect(calls[1]?.signal).toBe(signal);
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
  const now = new Date('2026-11-13T08:00:00.000Z');

  it('signs a path-style GET with attachment disposition and expiresAt from the injected clock', async () => {
    const storage = createS3ObjectStorage({
      region: 'us-east-1',
      forcePathStyle: true,
      client: fakeSender().sender,
      presignClient: presignClient(),
      now: () => now,
    });
    const presigned = await storage.presignGet({ bucket: BUCKET, key: KEY, ttlSeconds: 120 });
    const url = new URL(presigned.url);
    expect(presigned.expiresAt).toEqual(new Date('2026-11-13T08:02:00.000Z'));
    expect(url.origin).toBe(ENDPOINT);
    expect(url.pathname.startsWith(`/${BUCKET}/`)).toBe(true);
    expect(url.searchParams.get('X-Amz-Expires')).toBe('120');
    expect(url.searchParams.get('X-Amz-Date')).toBe('20261113T080000Z');
    expect(url.searchParams.get('response-content-disposition')).toBe('attachment');
  });

  it('honours an explicit content disposition and version id', async () => {
    const storage = createS3ObjectStorage({
      region: 'us-east-1',
      forcePathStyle: true,
      client: fakeSender().sender,
      presignClient: presignClient(),
    });
    const url = new URL(
      (await storage.presignGet({ bucket: BUCKET, key: KEY, ttlSeconds: 1, contentDisposition: 'inline', versionId: 'v3' })).url,
    );
    expect(url.searchParams.get('response-content-disposition')).toBe('inline');
    expect(url.searchParams.get('versionId')).toBe('v3');
  });

  it.each([0, -1, MAX_PRESIGN_TTL_SECONDS + 1, 1.5, Number.NaN])('rejects ttlSeconds %s before any I/O', async (ttlSeconds) => {
    const { sender, calls } = fakeSender({});
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender, presignClient: presignClient() });
    await expect(storage.presignGet({ bucket: BUCKET, key: KEY, ttlSeconds })).rejects.toMatchObject({ code: 'INVALID_ARGUMENT' });
    expect(calls).toHaveLength(0);
  });

  it('accepts the bounds 1 and 300', async () => {
    const storage = createS3ObjectStorage({
      region: 'us-east-1',
      forcePathStyle: true,
      client: fakeSender().sender,
      presignClient: presignClient(),
    });
    await expect(storage.presignGet({ bucket: BUCKET, key: KEY, ttlSeconds: 1 })).resolves.toBeDefined();
    await expect(storage.presignGet({ bucket: BUCKET, key: KEY, ttlSeconds: 300 })).resolves.toBeDefined();
  });

  it('an injected sender without a presign client cannot sign (UNEXPECTED, not a crash)', async () => {
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: fakeSender().sender });
    await expect(storage.presignGet({ bucket: BUCKET, key: KEY, ttlSeconds: 60 })).rejects.toMatchObject({ code: 'UNEXPECTED' });
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
      const url = new URL((await storage.presignGet({ bucket: BUCKET, key: KEY, ttlSeconds: 60 })).url);
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
      const url = new URL((await storage.presignGet({ bucket: BUCKET, key: KEY, ttlSeconds: 60 })).url);
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
    ['500', sdkError('InternalError', 500), 'UNAVAILABLE'],
    ['503 SlowDown', sdkError('SlowDown', 503), 'UNAVAILABLE'],
    ['429', sdkError('Throttled', 429), 'UNAVAILABLE'],
    ['408', sdkError('RequestTimeout', 408), 'UNAVAILABLE'],
    ['connection refused', sdkError('Error', undefined, { code: 'ECONNREFUSED' }), 'UNAVAILABLE'],
    ['connection reset', sdkError('Error', undefined, { code: 'ECONNRESET' }), 'UNAVAILABLE'],
    ['timeout', sdkError('TimeoutError'), 'UNAVAILABLE'],
    ['abort', sdkError('AbortError'), 'UNAVAILABLE'],
    ['400 BadDigest', sdkError('BadDigest', 400), 'UNEXPECTED'],
    ['404 NoSuchBucket', sdkError('NoSuchBucket', 404), 'UNEXPECTED'],
    ['unknown error', sdkError('Surprise'), 'UNEXPECTED'],
  ])('%s becomes %s with a fixed message', async (_label, error, code) => {
    const { sender } = fakeSender(error);
    const storage = createS3ObjectStorage({ region: 'us-east-1', forcePathStyle: true, client: sender });
    const operations: Array<() => Promise<unknown>> = [
      () => storage.put({ bucket: BUCKET, key: KEY, body: bytes(), contentType: 'text/plain' }),
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

  it.each([
    ['no secrets', new Map<string, Secret<string>>()],
    ['only the access key id', new Map([['STORAGE_ACCESS_KEY_ID_REF', new Secret(accessKeyId)]])],
    ['only the secret access key', new Map([['STORAGE_SECRET_ACCESS_KEY_REF', new Secret(secretAccessKey)]])],
  ])('sets no static credentials with %s (SDK default chain)', (_label, secrets) => {
    expect(storageOptionsFromConfig(base, secrets)).not.toHaveProperty('credentials');
  });

  it('omits unset endpoints (AWS S3) and builds a closeable storage from the configuration', () => {
    const awsConfig = { STORAGE_REGION: 'us-east-1', STORAGE_FORCE_PATH_STYLE: false } as Parameters<typeof storageOptionsFromConfig>[0];
    const options = storageOptionsFromConfig(awsConfig, new Map());
    expect(options).toEqual({ region: 'us-east-1', forcePathStyle: false });
    const storage = objectStorageFromConfig(base, new Map());
    expect(() => storage.destroy()).not.toThrow();
  });
});
