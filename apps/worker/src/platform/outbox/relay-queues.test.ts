// PR #64 code review R2-n5 and PR64-SEC-13 (INFO; condition on TASK-043, D-SEC-PR64-02; the PR64-SEC-01 class, CWE-532):
// every queue the relay's job producer enqueues through is the worker queue runtime's own, built by `openQueue` with a
// class-only `error` listener on the fail-fast `queue` profile. Against a fake RESP server that refuses AUTH, an
// enqueue through that producer is refused (the outbox row would stay pending, AT-US-011-05) and the ACL password
// never reaches console.error or stderr. The mutant (the same Queue without the listener, i.e. openQueue with its
// listener removed) DOES print the password, so the assertions are not vacuous.
import { createServer, type Server } from 'node:net';

import { createJobProducer, createRuntimeLog } from '@platform/api/runtime';
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import { QUEUE_NAMES } from '@platform/shared/queues';
import { Queue } from 'bullmq';

import { queueConnectionOptions } from '../queues/connection.js';
import { createWorkerQueues } from '../queues/runtime.js';
import { createOutboxRelay } from './relay.js';
import type { RawDb } from './system-tx.js';

// Built at run time from parts: a literal would be a secret-scanner finding (PR33-SEC-08).
const PASSWORD = ['RELAYMARKER', 'pw', '9876543210'].join('');
const ID = '0193a5b2-7c1e-7d4a-9f3b-000000000f01';

/** A RESP server that refuses the handshake (`HELLO` / `AUTH`) with WRONGPASS and answers anything else +OK. */
async function fakeValkey(): Promise<{ readonly server: Server; readonly port: number; received(): string }> {
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

async function bounded(work: Promise<unknown>, ms: number): Promise<void> {
  let timer: NodeJS.Timeout | undefined;
  await Promise.race([work.catch(() => undefined), new Promise<void>((resolve) => (timer = setTimeout(resolve, ms)))]);
  clearTimeout(timer);
}

/** console.error and stderr writes, captured (inspected for the password only, never forwarded). */
function captureStderr(): { readonly text: () => string } {
  const seen: string[] = [];
  jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
    seen.push(args.map((arg) => (typeof arg === 'string' ? arg : JSON.stringify(arg, Object.getOwnPropertyNames(Object(arg))))).join(' '));
  });
  jest.spyOn(process.stderr, 'write').mockImplementation((chunk: unknown) => {
    seen.push(String(chunk));
    return true;
  });
  return { text: () => seen.join('\n') };
}

describe('[PR64-SEC-13] [R2-n5] the relay producer enqueues through the worker queue factory only', () => {
  const cleanups: (() => Promise<void>)[] = [];
  afterEach(async () => {
    // Connections first, while console.error is still captured (a refused reconnect may still report).
    for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
    jest.restoreAllMocks();
  });

  it('an enqueue against a Valkey that refuses AUTH is refused, and the password reaches neither console.error nor stderr', async () => {
    const stderr = captureStderr();
    const valkey = await fakeValkey();
    cleanups.push(() => new Promise<void>((resolve) => valkey.server.close(() => resolve())));
    const raw: string[] = [];
    const log = createRuntimeLog('worker', { write: (line: string) => raw.push(line) }, { level: 'debug' });
    const url = `redis://worker:${PASSWORD}@127.0.0.1:${String(valkey.port)}/0`;
    const queues = createWorkerQueues({
      connection: queueConnectionOptions(url, 'worker-consumers', 'worker'),
      queueConnection: queueConnectionOptions(url, 'worker-queues', 'queue'),
      log,
      processors: {},
    });
    cleanups.push(async () => {
      await bounded(queues.close(), 3_000);
      // n2: end every queue's reconnect loop (a refused handshake never lets a graceful close finish).
      await Promise.all(QUEUE_NAMES.map((name) => bounded(queues.queueFor(name).disconnect(), 1_000)));
    });
    const producer = createJobProducer({ queueFor: (name) => queues.queueFor(name), contextCorrelationId: () => undefined });
    // The relay over a fake SYSTEM transaction serving one pending row: the refused queue leaves it pending.
    const executed: string[] = [];
    const db: RawDb = {
      $queryRaw: <T>(strings: TemplateStringsArray) =>
        Promise.resolve(
          (strings.join('$').includes('pg_try_advisory_xact_lock')
            ? [{ locked: true }]
            : [
                {
                  id: ID,
                  correlation_id: 'relay-corr-0001',
                  trace_context: null,
                  aggregate_type: 'shipment',
                  aggregate_id: ID,
                  age_seconds: 0,
                },
              ]) as T,
        ),
      $executeRaw: (strings: TemplateStringsArray) => Promise.resolve(void executed.push(strings.join('$'))).then(() => 1),
    };
    const relay = createOutboxRelay({
      runner: { withTenantTx: (_ctx, fn) => fn(db) },
      producer,
      log,
      batchSize: 10,
      pollIntervalMs: 500,
      budgetMs: 2_500,
      enqueueTimeoutMs: 1_500,
    });
    expect(await relay.runOnce()).toMatchObject({ locked: true, claimed: 1, published: 0, failed: 1, full: false });
    expect(executed).toHaveLength(1);
    expect(executed[0]).toContain('last_error');
    const deadline = Date.now() + 10_000;
    while (!raw.join('').includes('worker.queue_error') && Date.now() < deadline) await sleep(50);
    await sleep(1_000);
    expect(valkey.received()).toContain(PASSWORD);
    expect(raw.join('')).toContain('worker.queue_error');
    expect(raw.join('')).not.toContain(PASSWORD);
    expect(stderr.text()).not.toContain(PASSWORD);
  }, 30_000);

  it('the mutant: the same Queue without the class-only listener prints the password (the test above would turn red)', async () => {
    const stderr = captureStderr();
    const valkey = await fakeValkey();
    cleanups.push(() => new Promise<void>((resolve) => valkey.server.close(() => resolve())));
    const url = `redis://worker:${PASSWORD}@127.0.0.1:${String(valkey.port)}/0`;
    // Deliberately unguarded (test only; the source scan of open-queue.test.ts keeps it out of the worker sources).
    const mutant = new Queue('outbox-relay', { connection: queueConnectionOptions(url, 'worker-queues', 'queue') });
    cleanups.push(async () => {
      await bounded(mutant.close(), 3_000);
      await bounded(mutant.disconnect(), 1_000);
    });
    const deadline = Date.now() + 10_000;
    while (!stderr.text().includes(PASSWORD) && Date.now() < deadline) await sleep(50);
    expect(stderr.text()).toContain(PASSWORD);
  }, 30_000);
});
