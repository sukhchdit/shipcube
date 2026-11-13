import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import type { Config, Secret } from '@platform/config';

import { StorageConfigError } from '../storage/s3-object-storage.js';
import { createRuntimeLog } from './log.js';
import { createRuntimeServices } from './services.js';

/** Unreachable dependencies: nothing listens on port 1 of the loopback interface. */
const config = {
  DATABASE_URL: { reveal: () => 'postgres://platform_app@127.0.0.1:1/platform' },
  DB_POOL_MAX: 1,
  DB_IDLE_TIMEOUT_MS: 1_000,
  DB_CONNECTION_TIMEOUT_MS: 1_000,
  DB_STATEMENT_TIMEOUT_MS: 25_000,
  DB_TX_STATEMENT_TIMEOUT_MS: 5_000,
  DB_TX_LOCK_TIMEOUT_MS: 2_000,
  DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000,
  REDIS_URL: { reveal: () => 'redis://127.0.0.1:1' },
  STORAGE_ENDPOINT: 'http://127.0.0.1:1',
  STORAGE_REGION: 'us-east-1',
  STORAGE_FORCE_PATH_STYLE: true,
  STORAGE_BUCKET_DOCUMENTS: 'documents-test',
} as unknown as Config;

const secret = (value: string): Secret<string> => ({ reveal: () => value }) as unknown as Secret<string>;

const capture = (): { lines: string[]; log: ReturnType<typeof createRuntimeLog> } => {
  const lines: string[] = [];
  const log = createRuntimeLog('api', {
    write: (line: string) => {
      lines.push(line);
      return true;
    },
  });
  return { lines, log };
};

const storageErrorLines = (lines: readonly string[]): string[] => lines.filter((line) => line.includes('"object_storage.error"'));

async function until(condition: () => boolean, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!condition() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 25));
}

describe('createRuntimeServices composition (TASK-019: object storage wired into readiness and shutdown)', () => {
  it('readiness reports object_storage unavailable for an unreachable store and logs the class only; resources close it', async () => {
    delete process.env['PGOPTIONS'];
    const { lines, log } = capture();
    const accessKey = randomBytes(10).toString('hex');
    const secretKey = randomBytes(20).toString('hex');
    const secrets = new Map([
      ['STORAGE_ACCESS_KEY_ID_REF', secret(accessKey)],
      ['STORAGE_SECRET_ACCESS_KEY_REF', secret(secretKey)],
    ]);
    const services = createRuntimeServices(config, 'api', log, secrets);
    try {
      expect(services.resources.map((resource) => resource.name)).toEqual(expect.arrayContaining(['valkey', 'object_storage']));
      // The documents storage is exposed for its first consumer (ADR-0021 am. 2 item 5): the port surface (destroy is for shutdown).
      expect(Object.keys(services.storage).sort()).toEqual([
        'checkBucket',
        'delete',
        'destroy',
        'get',
        'head',
        'presignGet',
        'put',
        'putIfAbsent',
      ]);
      const report = await services.probe.readiness();
      expect(report.httpStatus).toBe(503);
      expect(report.body.components.object_storage).toBe('unavailable');
      await until(() => storageErrorLines(lines).length > 0, 5_000);

      // The storage failure is logged (so the assertions below are not vacuous), with its class and nothing else.
      const storageLines = storageErrorLines(lines);
      expect(storageLines.length).toBeGreaterThan(0);
      const entry = JSON.parse(storageLines[0] ?? '{}') as Record<string, unknown>;
      expect(entry).toMatchObject({ level: 'warn', event: 'object_storage.error' });
      // UNAVAILABLE in a real process (connection refused). Under Jest's VM realm the SDK re-wraps the cross-realm Node
      // error and drops its `code`, so the class is UNEXPECTED here; either way it is a closed-set class, nothing else.
      expect(['UNAVAILABLE', 'UNEXPECTED']).toContain(entry['error']);
      expect(Object.keys(entry).sort()).toEqual(['error', 'event', 'level', 'service', 'time']);

      const text = JSON.stringify(report.body) + lines.join('');
      for (const leak of ['127.0.0.1:1', 'documents-test', accessKey, secretKey]) expect(text).not.toContain(leak);
    } finally {
      services.valkey.disconnect();
      for (const resource of services.resources.filter((r) => r.name !== 'valkey')) await resource.close();
    }
  }, 15_000);

  it.each([
    ['only the access key id', 'STORAGE_ACCESS_KEY_ID_REF'],
    ['only the secret access key', 'STORAGE_SECRET_ACCESS_KEY_REF'],
  ])('refuses to start with %s resolved (fail closed, no default-chain fallback), naming keys only', (_label, key) => {
    const value = randomBytes(12).toString('hex');
    const { log } = capture();
    let thrown: unknown;
    try {
      createRuntimeServices(config, 'api', log, new Map([[key, secret(value)]]));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(StorageConfigError);
    expect((thrown as Error).message).toContain('STORAGE_ACCESS_KEY_ID_REF');
    expect((thrown as Error).message).toContain('STORAGE_SECRET_ACCESS_KEY_REF');
    expect((thrown as Error).message).not.toContain(value);
  });
});
