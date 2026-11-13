/**
 * SPK-05 (R-ARCH-05): the `ObjectStorage` port implemented by `s3-object-storage.ts`, proved against RustFS 1.0.4
 * (Testcontainers; pinned image in tests/rustfs.ts). Findings are written up in docs/04-plan/spikes/SPK-05.md.
 */
import { createHash, randomBytes } from 'node:crypto';

import { PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { ObjectStorageError } from './object-storage.port.js';
import { createS3ObjectStorage, toObjectStorageError, type S3ObjectStorage } from './s3-object-storage.js';
import { RUSTFS_STARTUP_TIMEOUT_MS, startRustfs, type RunningRustfs } from './tests/rustfs.js';

const DOCUMENTS = 'spk05-documents';
const VERSIONED = 'spk05-versioned';
const PDF = 'application/pdf';

const unique = (): string => `${randomBytes(16).toString('hex')}/object.bin`;
const payload = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('SPK-05 ObjectStorage contract against RustFS', () => {
  let rustfs: RunningRustfs;
  let storage: S3ObjectStorage;
  /** A raw client with the same credentials: writes what the port refuses to write (forged metadata, wrong digest). */
  let raw: S3Client;

  beforeAll(async () => {
    rustfs = await startRustfs();
    await rustfs.createBucket(DOCUMENTS);
    await rustfs.createBucket(VERSIONED, { versioned: true });
    storage = createS3ObjectStorage({
      endpoint: rustfs.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: rustfs.accessKeyId, secretAccessKey: rustfs.secretAccessKey },
    });
    raw = new S3Client({
      endpoint: rustfs.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: rustfs.accessKeyId, secretAccessKey: rustfs.secretAccessKey },
    });
  }, RUSTFS_STARTUP_TIMEOUT_MS);

  afterAll(async () => {
    raw.destroy();
    storage.destroy();
    await rustfs.stop();
  }, RUSTFS_STARTUP_TIMEOUT_MS);

  it('SPK-05 put then head then get round-trips bytes, content type, length and the sha256 metadata', async () => {
    const key = unique();
    const body = randomBytes(2048);
    const put = await storage.put({ bucket: DOCUMENTS, key, body, contentType: PDF, metadata: { kind: 'label' } });
    expect(put.sha256).toMatch(/^[0-9a-f]{64}$/u);

    const head = await storage.head({ bucket: DOCUMENTS, key });
    expect(head).toMatchObject({ contentType: PDF, contentLength: 2048, sha256: put.sha256, metadata: { kind: 'label' } });
    // PR30-SEC-03: the store's own SHA-256 (sent as ChecksumSHA256 on put, returned with checksum mode on head).
    expect(head?.checksumSha256).toBe(put.sha256);

    const stored = await storage.get({ bucket: DOCUMENTS, key });
    expect(Buffer.from(stored?.body ?? new Uint8Array()).equals(body)).toBe(true);
    expect(stored?.sha256).toBe(put.sha256);
    expect(stored?.contentType).toBe(PDF);
  });

  it('SPK-05 the largest allowed body (5 MiB) round-trips', async () => {
    const key = unique();
    const body = randomBytes(5 * 1024 * 1024);
    await storage.put({ bucket: DOCUMENTS, key, body, contentType: 'application/octet-stream' });
    const stored = await storage.get({ bucket: DOCUMENTS, key });
    expect(stored?.contentLength).toBe(body.byteLength);
    expect(Buffer.from(stored?.body ?? new Uint8Array()).equals(body)).toBe(true);
  });

  it('SPK-05 a pre-signed GET returns the bytes with the forced content type and Content-Disposition attachment', async () => {
    const key = unique();
    const body = payload('presigned download');
    // Stored as HTML, served as the forced type (PR30-SEC-02, T-58): the stored type never reaches the browser.
    await storage.put({ bucket: DOCUMENTS, key, body, contentType: 'text/html' });
    const { url, expiresAt } = await storage.presignGet({ bucket: DOCUMENTS, key, ttlSeconds: 60, responseContentType: 'text/plain' });

    expect(new URL(url).pathname.startsWith(`/${DOCUMENTS}/`)).toBe(true);
    expect(new URL(url).host).toBe(`${rustfs.host}:${String(rustfs.port)}`);
    expect(expiresAt.getTime()).toBeGreaterThan(Date.now());
    const response = await fetch(url);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-disposition')).toBe('attachment');
    expect(response.headers.get('content-type')).toBe('text/plain');
    expect(Buffer.from(await response.arrayBuffer()).equals(Buffer.from(body))).toBe(true);
  });

  it('SPK-05 an expired pre-signed URL (ttl 2 s) is refused with 403, and not before expiresAt', async () => {
    const key = unique();
    await storage.put({ bucket: DOCUMENTS, key, body: payload('expires'), contentType: 'text/plain' });
    // ttl 2: the first fetch has at least a full second of slack whatever the sub-second signing instant (R1-m3).
    const { url, expiresAt } = await storage.presignGet({ bucket: DOCUMENTS, key, ttlSeconds: 2, responseContentType: 'text/plain' });
    expect(expiresAt.getTime() % 1000).toBe(0);
    expect((await fetch(url)).status).toBe(200);
    await new Promise((resolve) => setTimeout(resolve, 3_500));
    expect(Date.now()).toBeGreaterThan(expiresAt.getTime());
    const expired = await fetch(url);
    expect(expired.status).toBe(403);
    expect(await expired.text()).not.toContain('expires');
  });

  it('SPK-05 a tampered pre-signed URL (another key) is refused', async () => {
    const key = unique();
    await storage.put({ bucket: DOCUMENTS, key, body: payload('secret-bytes'), contentType: 'text/plain' });
    const { url } = await storage.presignGet({ bucket: DOCUMENTS, key, ttlSeconds: 60, responseContentType: 'text/plain' });
    const other = new URL(url);
    other.pathname = `/${DOCUMENTS}/${unique()}`;
    expect((await fetch(other)).status).toBe(403);
  });

  it('SPK-05 a pre-signed URL TTL of 301 s is rejected before any I/O', async () => {
    await expect(
      storage.presignGet({ bucket: DOCUMENTS, key: unique(), ttlSeconds: 301, responseContentType: 'text/plain' }),
    ).rejects.toMatchObject({
      code: 'INVALID_ARGUMENT',
    });
  });

  it('SPK-05 versioning: two puts give two version ids and each version reads back its own bytes', async () => {
    const key = unique();
    const first = await storage.put({ bucket: VERSIONED, key, body: payload('version one'), contentType: 'text/plain' });
    const second = await storage.put({ bucket: VERSIONED, key, body: payload('version two'), contentType: 'text/plain' });
    const firstVersion = first.versionId;
    if (firstVersion === undefined || second.versionId === undefined) throw new Error('versioned bucket returned no version id');
    expect(firstVersion).not.toBe(second.versionId);

    const old = await storage.get({ bucket: VERSIONED, key, versionId: firstVersion });
    expect(new TextDecoder().decode(old?.body)).toBe('version one');
    expect(old?.sha256).toBe(first.sha256);
    expect((await storage.head({ bucket: VERSIONED, key, versionId: firstVersion }))?.versionId).toBe(firstVersion);
    const latest = await storage.get({ bucket: VERSIONED, key });
    expect(new TextDecoder().decode(latest?.body)).toBe('version two');
    expect(latest?.versionId).toBe(second.versionId);
  });

  it('SPK-05 putIfAbsent: the second write reports created:false and the original bytes are kept', async () => {
    const key = unique();
    const first = await storage.putIfAbsent({ bucket: DOCUMENTS, key, body: payload('original'), contentType: 'text/plain' });
    expect(first.created).toBe(true);
    const second = await storage.putIfAbsent({ bucket: DOCUMENTS, key, body: payload('replacement'), contentType: 'text/plain' });
    expect(second).toEqual({ created: false });
    expect(new TextDecoder().decode((await storage.get({ bucket: DOCUMENTS, key }))?.body)).toBe('original');
  });

  it('SPK-05 putIfAbsent on a versioned bucket does not create a second version', async () => {
    const key = unique();
    await storage.putIfAbsent({ bucket: VERSIONED, key, body: payload('anchor'), contentType: 'text/plain' });
    expect(await storage.putIfAbsent({ bucket: VERSIONED, key, body: payload('forged'), contentType: 'text/plain' })).toEqual({
      created: false,
    });
    expect(new TextDecoder().decode((await storage.get({ bucket: VERSIONED, key }))?.body)).toBe('anchor');
  });

  it('SPK-05 get refuses an object whose sha256 metadata claim does not match its bytes (PR30-SEC-03)', async () => {
    const key = unique();
    const forged = createHash('sha256').update('what the anchor should say').digest('hex');
    await raw.send(new PutObjectCommand({ Bucket: DOCUMENTS, Key: key, Body: payload('other bytes'), Metadata: { sha256: forged } }));
    // head reports the claim (documented as unverified); the store's own checksum tells the truth.
    const head = await storage.head({ bucket: DOCUMENTS, key });
    expect(head?.sha256).toBe(forged);
    expect(head?.checksumSha256).not.toBe(forged);
    await expect(storage.get({ bucket: DOCUMENTS, key })).rejects.toMatchObject({ code: 'INTEGRITY_MISMATCH' });
  });

  it('SPK-05 the store refuses a put whose ChecksumSHA256 does not match the body (BadDigest maps to INTEGRITY_MISMATCH)', async () => {
    const key = unique();
    const wrong = createHash('sha256').update('not the body').digest('base64');
    const failure: unknown = await raw
      .send(
        new PutObjectCommand({
          Bucket: DOCUMENTS,
          Key: key,
          Body: payload('the body'),
          ChecksumAlgorithm: 'SHA256',
          ChecksumSHA256: wrong,
        }),
      )
      .then(
        () => undefined,
        (rejection: unknown) => rejection,
      );
    expect(toObjectStorageError(failure).code).toBe('INTEGRITY_MISMATCH');
    await expect(storage.head({ bucket: DOCUMENTS, key })).resolves.toBeUndefined();
  });

  it('SPK-05 head on a missing bucket resolves undefined (HEAD has no error body; checkBucket is the guard, R1-n4)', async () => {
    await expect(storage.head({ bucket: 'spk05-no-such-bucket', key: unique() })).resolves.toBeUndefined();
    await expect(storage.checkBucket('spk05-no-such-bucket', AbortSignal.timeout(5_000))).rejects.toMatchObject({ code: 'UNEXPECTED' });
  });

  it('SPK-05 head and get of a missing key resolve undefined', async () => {
    const locator = { bucket: DOCUMENTS, key: unique() };
    await expect(storage.head(locator)).resolves.toBeUndefined();
    await expect(storage.get(locator)).resolves.toBeUndefined();
  });

  it('SPK-05 delete removes an object', async () => {
    const key = unique();
    await storage.put({ bucket: DOCUMENTS, key, body: payload('gone soon'), contentType: 'text/plain' });
    await storage.delete({ bucket: DOCUMENTS, key });
    await expect(storage.head({ bucket: DOCUMENTS, key })).resolves.toBeUndefined();
  });

  it('SPK-05 checkBucket resolves for an existing bucket and rejects for a missing one without details', async () => {
    const signal = AbortSignal.timeout(5_000);
    await expect(storage.checkBucket(DOCUMENTS, signal)).resolves.toBeUndefined();
    const failure: unknown = await storage.checkBucket('spk05-does-not-exist', signal).then(
      () => undefined,
      (rejection: unknown) => rejection,
    );
    expect(failure).toBeInstanceOf(ObjectStorageError);
    // RustFS answers HeadBucket on a missing bucket with 404 (NotFound): a configuration error, not "unavailable".
    expect(failure).toMatchObject({ code: 'UNEXPECTED', message: 'UNEXPECTED' });
    expect(String(failure)).not.toContain('spk05-does-not-exist');
  });

  it('SPK-05 wrong credentials surface as ACCESS_DENIED with a fixed message', async () => {
    const intruder = createS3ObjectStorage({
      endpoint: rustfs.endpoint,
      region: 'us-east-1',
      forcePathStyle: true,
      credentials: { accessKeyId: rustfs.accessKeyId, secretAccessKey: randomBytes(24).toString('hex') },
    });
    try {
      await expect(intruder.checkBucket(DOCUMENTS, AbortSignal.timeout(5_000))).rejects.toMatchObject({
        code: 'ACCESS_DENIED',
        message: 'ACCESS_DENIED',
      });
      await expect(intruder.get({ bucket: DOCUMENTS, key: unique() })).rejects.toMatchObject({ code: 'ACCESS_DENIED' });
    } finally {
      intruder.destroy();
    }
  });
});
