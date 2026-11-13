import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import type { Config, Secret } from '@platform/config';

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

describe('createRuntimeServices composition (TASK-019: object storage wired into readiness and shutdown)', () => {
  it('readiness reports object_storage unavailable for an unreachable store, without endpoint or key in the body; resources close it', async () => {
    delete process.env['PGOPTIONS'];
    const lines: string[] = [];
    const log = createRuntimeLog('api', {
      write: (line: string) => {
        lines.push(line);
        return true;
      },
    });
    const accessKey = randomBytes(10).toString('hex');
    const secrets = new Map([
      ['STORAGE_ACCESS_KEY_ID_REF', secret(accessKey)],
      ['STORAGE_SECRET_ACCESS_KEY_REF', secret(randomBytes(20).toString('hex'))],
    ]);
    const services = createRuntimeServices(config, 'api', log, secrets);
    try {
      expect(services.resources.map((resource) => resource.name)).toEqual(expect.arrayContaining(['valkey', 'object_storage']));
      const report = await services.probe.readiness();
      expect(report.httpStatus).toBe(503);
      expect(report.body.components.object_storage).toBe('unavailable');
      const text = JSON.stringify(report.body) + lines.join('');
      expect(text).not.toContain('127.0.0.1:1');
      expect(text).not.toContain(accessKey);
    } finally {
      services.valkey.disconnect();
      for (const resource of services.resources.filter((r) => r.name !== 'valkey')) await resource.close();
    }
  }, 15_000);
});
