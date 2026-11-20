// PR64-SEC-01 (merge condition C1): the worker ACL password must never reach stderr when Valkey refuses AUTH.
// (a) a fake RESP server that answers HELLO/AUTH with -WRONGPASS runs the real worker queues (18 BullMQ Queue instances
// plus the consumer's own dead-letter queue) through reconnect cycles; neither console.error nor process.stderr.write
// may see the password, and the redacted logger gets class-only `worker.queue_error` lines. (b) every `new Queue(` in
// the worker's sources is inside the openQueue factory. Mutation check: removing the `error` listener from openQueue
// makes (a) fail (BullMQ then console.error()s the ioredis error, which carries the HELLO ... AUTH arguments).
import { readdirSync, readFileSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { fileURLToPath } from 'node:url';

import { createRuntimeLog } from '@platform/api/runtime';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { Queue } from 'bullmq';

import { queueConnectionOptions } from './connection.js';
import { createQueueConsumer } from './consumer.js';
import { openQueue } from './open-queue.js';
import { createWorkerQueues } from './runtime.js';

// Built at run time from parts: a literal would be a secret-scanner finding (PR33-SEC-08).
const PASSWORD = ['PROBEMARKER', 'pw', '0123456789'].join('');

interface FakeValkey {
  readonly server: Server;
  readonly port: number;
  /** Every byte the clients sent, to prove the password did cross the wire (the test is not vacuous). */
  received(): string;
}

/** A RESP server that refuses the handshake (`HELLO` / `AUTH`) with WRONGPASS and answers anything else +OK. */
async function fakeValkey(): Promise<FakeValkey> {
  let received = '';
  const server = createServer((socket) => {
    socket.on('data', (chunk) => {
      const text = chunk.toString('latin1');
      received += text;
      for (const part of text.split('*').filter((piece) => /^\d+\r\n/.test(piece))) {
        const words = part.split('\r\n').filter((word, index) => index > 0 && word !== '' && !word.startsWith('$'));
        const name = (words[0] ?? '').toUpperCase();
        socket.write(
          name === 'HELLO' || name === 'AUTH' ? '-WRONGPASS invalid username-password pair or user is disabled.\r\n' : '+OK\r\n',
        );
      }
    });
    socket.on('error', () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('no port');
  return { server, port: address.port, received: () => received };
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Waits for `work` (failure ignored) for at most `ms`; the timer never outlives the call. */
async function bounded(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, ms);
  });
  await Promise.race([
    work.then(
      () => undefined,
      () => undefined,
    ),
    expired,
  ]);
  clearTimeout(timer);
}

describe('[PR64-SEC-01] worker queues and a Valkey that refuses AUTH', () => {
  const cleanups: (() => Promise<void> | void)[] = [];
  afterEach(async () => {
    jest.restoreAllMocks();
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  });

  it('never prints the ACL password to console.error or stderr; the redacted logger gets class-only worker.queue_error lines', async () => {
    const consoleErrors: string[] = [];
    const stderrWrites: string[] = [];
    // Collect what the mutated code would print; the text is only inspected for the password, never forwarded.
    jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      consoleErrors.push(
        args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '),
      );
    });
    jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
      stderrWrites.push(String(chunk));
      return true;
    });

    const valkey = await fakeValkey();
    cleanups.push(() => new Promise<void>((resolve) => valkey.server.close(() => resolve())));
    const raw: string[] = [];
    const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { level: 'debug' });
    const url = `redis://worker:${PASSWORD}@127.0.0.1:${String(valkey.port)}/0`;
    const connection = queueConnectionOptions(url, 'worker-consumers', 'worker');
    const queueConnection = queueConnectionOptions(url, 'worker-queues', 'queue');
    // The 18 Queue instances of the runtime (the metrics and dead-letter queues) ...
    const queues = createWorkerQueues({ connection, queueConnection, log, processors: {} });
    // ... and one consumer with its own dead-letter queue: its Worker and Queue meet the same refusal.
    const consumer = createQueueConsumer({ queue: 'booking', processor: () => Promise.resolve(), connection, queueConnection, log });
    cleanups.push(async () => {
      // Forced: the Worker never got a connection, so a graceful close would wait for one.
      await bounded(consumer.close(true), 3_000);
      await bounded(queues.close(), 3_000);
      // Connections that never got past the refused handshake may not finish a graceful close: end their reconnect loops.
      await bounded(consumer.worker.disconnect(), 1_000);
    });
    consumer.start();
    void queues.metrics().catch(() => undefined);
    const lines = (): Record<string, unknown>[] =>
      raw.flatMap((chunk) =>
        chunk
          .split('\n')
          .filter((line) => line !== '')
          .map((line) => JSON.parse(line) as Record<string, unknown>),
      );
    const deadline = Date.now() + 10_000;
    while (!lines().some((line) => line['event'] === 'worker.queue_error') && Date.now() < deadline) await sleep(50);
    // A few more reconnect cycles (the reconnect delay starts at 100 ms), so a leak on a later cycle is seen too.
    await sleep(1_200);

    // The handshake with the password did reach the fake server: the assertions below are not vacuous.
    expect(valkey.received()).toContain(PASSWORD);
    const queueErrors = lines().filter((line) => line['event'] === 'worker.queue_error');
    expect(queueErrors.length).toBeGreaterThan(0);
    for (const line of queueErrors) {
      expect(typeof line['queue']).toBe('string');
      expect(typeof line['error']).toBe('string');
      expect(String(line['error'])).toMatch(/^[A-Za-z]+$/);
    }
    expect(JSON.stringify(lines())).not.toContain(PASSWORD);
    expect(consoleErrors.join('\n')).not.toContain(PASSWORD);
    expect(stderrWrites.join('')).not.toContain(PASSWORD);
    expect(consoleErrors).toEqual([]);
  });

  it('[PR64-SEC-12] metrics() is single-flight: N scrapes against a never-ready connection leave one pending collection', async () => {
    const valkey = await fakeValkey();
    cleanups.push(() => new Promise<void>((resolve) => valkey.server.close(() => resolve())));
    const log = createRuntimeLog('worker', { write: () => true }, { level: 'debug' });
    const url = `redis://worker:${PASSWORD}@127.0.0.1:${String(valkey.port)}/0`;
    const counts = jest.spyOn(Queue.prototype, 'getJobCounts');
    const queues = createWorkerQueues({
      connection: queueConnectionOptions(url, 'worker-consumers', 'worker'),
      queueConnection: queueConnectionOptions(url, 'worker-queues', 'queue'),
      log,
      processors: {},
    });
    cleanups.push(async () => {
      await bounded(queues.close(), 3_000);
    });
    const scrapes = Array.from({ length: 25 }, () => queues.metrics());
    for (const scrape of scrapes) scrape.catch(() => undefined);
    await sleep(300);
    expect(new Set(scrapes).size).toBe(1);
    // One collection: 9 queues and 9 dead-letter queues, each counted once.
    expect(counts).toHaveBeenCalledTimes(18);
  });

  it('logs an error event as its class name, and a non-Error value as its type; never the message', async () => {
    const raw: string[] = [];
    const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { level: 'debug' });
    // The refusing fake server, as above: the queue's own connection errors are logged too; only the events emitted
    // below are asserted.
    const valkey = await fakeValkey();
    cleanups.push(() => new Promise<void>((resolve) => valkey.server.close(() => resolve())));
    const url = `redis://worker:${PASSWORD}@127.0.0.1:${String(valkey.port)}/0`;
    const queue = openQueue('booking', { connection: queueConnectionOptions(url, 'worker-queues', 'queue') }, log);
    cleanups.push(async () => {
      await bounded(queue.close(), 3_000);
      // A queue that never got a connection may not finish a graceful close: drop its reconnect loop for good.
      await bounded(queue.disconnect(), 1_000);
    });
    expect(queue.listenerCount('error')).toBeGreaterThanOrEqual(1);
    queue.emit('error', new TypeError('secret message AUTH x'));
    queue.emit('error', 'plain string with a secret' as unknown as Error);
    const lines = raw.flatMap((chunk) =>
      chunk
        .split('\n')
        .filter((line) => line !== '')
        .map((line) => JSON.parse(line) as Record<string, unknown>),
    );
    expect(lines).toContainEqual(expect.objectContaining({ event: 'worker.queue_error', queue: 'booking', error: 'TypeError' }));
    expect(lines).toContainEqual(expect.objectContaining({ event: 'worker.queue_error', queue: 'booking', error: 'string' }));
    expect(JSON.stringify(lines)).not.toMatch(/secret|AUTH/);
  });

  it('every `new Queue(` in the worker sources is inside the openQueue factory', () => {
    const root = fileURLToPath(new URL('../../', import.meta.url));
    const files = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .map((path) => path.replaceAll('\\', '/'))
      .filter((path) => path.endsWith('.ts') && !path.endsWith('.test.ts') && !path.endsWith('.d.ts'));
    expect(files).toContain('platform/queues/open-queue.ts');
    const constructing = files.filter((path) => {
      const source = readFileSync(`${root}${path}`, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      return /\bnew\s+(?:Queue|QueueEvents|FlowProducer|QueueScheduler)\b/.test(source);
    });
    expect(constructing).toEqual(['platform/queues/open-queue.ts']);
  });
});
