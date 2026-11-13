/**
 * The shared contract loader never fetches a `$ref` over the network (PR21-SEC-07): a document with an `http` reference
 * is refused without a request reaching the server, and every reference in openapi.yaml is internal.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { loadContract, OPENAPI_PATH } from './contract.js';

describe('openapi contract loader', () => {
  let scratch: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'openapi-contract-'));
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it('refuses an http $ref without sending a request', async () => {
    let requests = 0;
    const server = createServer((_req, res) => {
      requests += 1;
      res.writeHead(200, { 'Content-Type': 'application/yaml' });
      res.end('type: string\n');
    });
    server.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', resolve));
    const { port } = server.address() as AddressInfo;
    try {
      const specPath = join(scratch, 'remote-ref.yaml');
      await writeFile(
        specPath,
        [
          'openapi: 3.1.0',
          'info: { title: probe, version: 1.0.0 }',
          'paths: {}',
          'components:',
          '  schemas:',
          '    Remote:',
          `      $ref: 'http://127.0.0.1:${String(port)}/schema.yaml'`,
          '',
        ].join('\n'),
        'utf8',
      );
      await expect(loadContract(specPath)).rejects.toThrow();
      expect(requests).toBe(0);
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  it('openapi.yaml references nothing outside itself', async () => {
    const text = await readFile(OPENAPI_PATH, 'utf8');
    const refs = [...text.matchAll(/\$ref:\s*['"]?([^'"\s]+)/g)].map((match) => match[1] ?? '');
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((ref) => !ref.startsWith('#/'))).toEqual([]);
  });
});
