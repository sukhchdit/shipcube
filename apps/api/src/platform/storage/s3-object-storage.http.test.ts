/**
 * The adapter's time bounds and retry behaviour against a loopback HTTP server, through the real SDK (no Docker):
 * PR30-SEC-01 and PR #30 R1-m1/m2/m4. Pins the request timeout that throws, the per-operation deadline without a
 * caller signal (silent and trickling servers), 3 attempts on 5xx, SPK-05 F-10 (a lost response, then 412, is
 * `created: false`), the byte-counting `get` and the SHA-256 checksum header on put. The production values themselves
 * (2 s / 10 s / 3 attempts / 15 s / 5 s) are pinned in s3-object-storage.test.ts.
 */
import { createHash, randomBytes } from 'node:crypto';
import { createServer, type IncomingHttpHeaders, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { createS3ObjectStorage, S3_TIMEOUTS, type S3ObjectStorage, type S3Timeouts } from './s3-object-storage.js';

const BUCKET = 'documents';
const KEY = 'a6f1b2c3-0d4e-4f50-8a61-7b8c9d0e1f20/label.pdf';

interface Seen {
  readonly method: string;
  readonly url: string;
  readonly headers: IncomingHttpHeaders;
}

type Handler = (request: IncomingMessage, response: ServerResponse, index: number) => void;

interface Loopback {
  readonly endpoint: string;
  readonly seen: Seen[];
  connections: number;
  close(): Promise<void>;
}

const open: Loopback[] = [];
const storages: S3ObjectStorage[] = [];

async function loopback(handler: Handler): Promise<Loopback> {
  const seen: Seen[] = [];
  const server: Server = createServer((request, response) => {
    seen.push({ method: request.method ?? '', url: request.url ?? '', headers: request.headers });
    handler(request, response, seen.length - 1);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  const state: Loopback = {
    endpoint: `http://127.0.0.1:${String(port)}`,
    seen,
    connections: 0,
    close: () =>
      new Promise<void>((resolve) => {
        server.closeAllConnections();
        server.close(() => resolve());
      }),
  };
  server.on('connection', () => {
    state.connections += 1;
  });
  open.push(state);
  return state;
}

function storageFor(server: Loopback, timeouts: S3Timeouts = S3_TIMEOUTS): S3ObjectStorage {
  const storage = createS3ObjectStorage({
    endpoint: server.endpoint,
    region: 'us-east-1',
    forcePathStyle: true,
    credentials: { accessKeyId: `ak${randomBytes(6).toString('hex')}`, secretAccessKey: randomBytes(20).toString('hex') },
    timeouts,
  });
  storages.push(storage);
  return storage;
}

/** Reads the request body, then answers. */
const afterBody = (request: IncomingMessage, answer: () => void): void => {
  request.resume();
  request.on('end', answer);
};

function s3Error(response: ServerResponse, status: number, code: string): void {
  const body = `<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>m</Message></Error>`;
  response.writeHead(status, { 'content-type': 'application/xml', 'content-length': String(Buffer.byteLength(body)) });
  response.end(body);
}

/** Never answers (accepts the connection and the body, then stays silent). */
const silent: Handler = (request) => {
  request.resume();
};

async function timed<T>(operation: () => Promise<T>): Promise<{ outcome: unknown; ms: number }> {
  const started = performance.now();
  const outcome = await operation().then(
    (value: unknown) => value,
    (error: unknown) => error,
  );
  return { outcome, ms: performance.now() - started };
}

const body = (): Uint8Array => new TextEncoder().encode('loopback label bytes');

afterEach(async () => {
  for (const storage of storages.splice(0)) storage.destroy();
  for (const server of open.splice(0)) await server.close();
  jest.restoreAllMocks();
});

describe('S3 adapter retries (R1-m1): at most 3 attempts on 5xx', () => {
  it('500, 500, 200: put succeeds on the third request and sends the SHA-256 checksum, not the CRC32 default', async () => {
    const server = await loopback((request, response, index) =>
      afterBody(request, () => {
        if (index < 2) s3Error(response, 500, 'InternalError');
        else response.writeHead(200, { etag: '"e"' }).end();
      }),
    );
    const bytes = body();
    const result = await storageFor(server).put({ bucket: BUCKET, key: KEY, body: bytes, contentType: 'application/pdf' });
    expect(result.etag).toBe('"e"');
    expect(server.seen).toHaveLength(3);
    for (const request of server.seen) {
      expect(request.method).toBe('PUT');
      expect(request.headers['x-amz-checksum-sha256']).toBe(createHash('sha256').update(bytes).digest('base64'));
      expect(request.headers).not.toHaveProperty('x-amz-checksum-crc32');
    }
  });

  it('always 500: checkBucket is UNAVAILABLE after exactly 3 requests', async () => {
    const server = await loopback((request, response) => afterBody(request, () => response.writeHead(500).end()));
    await expect(storageFor(server).checkBucket(BUCKET, new AbortController().signal)).rejects.toMatchObject({ code: 'UNAVAILABLE' });
    expect(server.seen.map((request) => request.method)).toEqual(['HEAD', 'HEAD', 'HEAD']);
  });

  it('SPK-05 F-10: the first PUT succeeds but its response is lost, the retry gets 412: putIfAbsent reports created:false', async () => {
    const server = await loopback((request, response, index) =>
      afterBody(request, () => {
        if (index === 0) request.socket.destroy();
        else s3Error(response, 412, 'PreconditionFailed');
      }),
    );
    await expect(
      storageFor(server).putIfAbsent({ bucket: BUCKET, key: KEY, body: body(), contentType: 'application/json' }),
    ).resolves.toEqual({
      created: false,
    });
    expect(server.seen).toHaveLength(2);
    for (const request of server.seen) expect(request.headers['if-none-match']).toBe('*');
  });
});

describe('S3 adapter time bounds (PR30-SEC-01, R1-m2): a silent or trickling store never hangs a call', () => {
  it('the request timeout throws (no SDK warning) and is retried: UNAVAILABLE after 3 attempts, long before the deadline', async () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    const server = await loopback(silent);
    const storage = storageFor(server, { ...S3_TIMEOUTS, requestMs: 300, metadataDeadlineMs: 10_000 });
    const { outcome, ms } = await timed(() => storage.head({ bucket: BUCKET, key: KEY }));
    expect(outcome).toMatchObject({ code: 'UNAVAILABLE' });
    expect(server.seen).toHaveLength(3);
    // 3 x 300 ms plus jittered backoff; without throwOnRequestTimeout the call would wait for the 10 s deadline.
    expect(ms).toBeLessThan(4_000);
    expect(warn).not.toHaveBeenCalled();
  }, 15_000);

  it('without a caller signal every operation rejects UNAVAILABLE within its own deadline', async () => {
    const server = await loopback(silent);
    // Production request timeout (10 s) and attempts; short deadlines so the test is quick.
    const storage = storageFor(server, { ...S3_TIMEOUTS, dataDeadlineMs: 800, metadataDeadlineMs: 400 });
    const put = { bucket: BUCKET, key: KEY, body: body(), contentType: 'application/pdf' };
    const results = await Promise.all([
      timed(() => storage.put(put)).then((result) => ({ ...result, deadline: 800 })),
      timed(() => storage.putIfAbsent(put)).then((result) => ({ ...result, deadline: 800 })),
      timed(() => storage.get({ bucket: BUCKET, key: KEY })).then((result) => ({ ...result, deadline: 800 })),
      timed(() => storage.head({ bucket: BUCKET, key: KEY })).then((result) => ({ ...result, deadline: 400 })),
      timed(() => storage.delete({ bucket: BUCKET, key: KEY })).then((result) => ({ ...result, deadline: 400 })),
    ]);
    for (const { outcome, ms, deadline } of results) {
      expect(outcome).toMatchObject({ code: 'UNAVAILABLE' });
      expect(ms).toBeGreaterThanOrEqual(deadline - 50);
      expect(ms).toBeLessThan(deadline + 1_000);
    }
  }, 15_000);

  it('a caller signal shorter than the deadline wins', async () => {
    const server = await loopback(silent);
    const { outcome, ms } = await timed(() => storageFor(server).get({ bucket: BUCKET, key: KEY }, AbortSignal.timeout(300)));
    expect(outcome).toMatchObject({ code: 'UNAVAILABLE' });
    expect(ms).toBeLessThan(1_300);
  });

  it('a body trickling one byte every 100 ms cannot outlive the get deadline', async () => {
    const server = await loopback((request, response) =>
      afterBody(request, () => {
        response.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': '1000' });
        const timer = setInterval(() => response.write('x'), 100);
        response.on('close', () => clearInterval(timer));
      }),
    );
    const { outcome, ms } = await timed(() =>
      storageFor(server, { ...S3_TIMEOUTS, dataDeadlineMs: 800 }).get({ bucket: BUCKET, key: KEY }),
    );
    expect(outcome).toMatchObject({ code: 'UNAVAILABLE' });
    expect(ms).toBeLessThan(1_800);
  });

  it('a chunked body over 5 MiB without Content-Length is TOO_LARGE (counted while reading), not buffered', async () => {
    const mebibyte = Buffer.alloc(1024 * 1024, 0x61);
    const server = await loopback((request, response) =>
      afterBody(request, () => {
        response.writeHead(200, { 'content-type': 'application/octet-stream' });
        for (let index = 0; index < 6; index += 1) response.write(mebibyte);
        response.end();
      }),
    );
    await expect(storageFor(server).get({ bucket: BUCKET, key: KEY })).rejects.toMatchObject({ code: 'TOO_LARGE' });
  });
});
