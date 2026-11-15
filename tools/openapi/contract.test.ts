/**
 * The shared contract loader never fetches a `$ref` over the network (PR21-SEC-07): a document with an `http` reference
 * is refused without a request reaching the server, and every reference in openapi.yaml is internal. PR21-SEC-08: both
 * tests discriminate - the refusal comes from the resolver ("Unable to resolve"), not from a failed download, and the
 * reference scan reads the PARSED document, so a quoted `$ref` key counts.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';

import SwaggerParser from '@apidevtools/swagger-parser';

import { loadContract, OPENAPI_PATH } from './contract.js';

// Parses the full contract and serves a loopback request; the 5 s Jest default timed out under parallel host load (W0-FLAKE).
jest.setTimeout(60_000);

/** Every value of an object key equal to `$ref`, anywhere in a parsed document. */
function collectRefs(node: unknown, out: string[] = []): string[] {
  if (Array.isArray(node)) for (const item of node) collectRefs(item, out);
  else if (typeof node === 'object' && node !== null) {
    for (const [key, value] of Object.entries(node)) {
      if (key === '$ref') out.push(String(value));
      else collectRefs(value, out);
    }
  }
  return out;
}

/** A one-schema document whose schema is a `$ref` to `ref`, the key written with `quote` around it. */
const remoteRefDocument = (ref: string, quote = ''): string =>
  [
    'openapi: 3.1.0',
    'info: { title: probe, version: 1.0.0 }',
    'paths: {}',
    'components:',
    '  schemas:',
    '    Remote:',
    `      ${quote}$ref${quote}: '${ref}'`,
    '',
  ].join('\n');

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

  it('[PR21-SEC-08] a never-resolving http $ref is refused by the resolver, not by a failed download', async () => {
    const specPath = join(scratch, 'invalid-host-ref.yaml');
    await writeFile(specPath, remoteRefDocument('http://schema.example.invalid/schema.yaml'), 'utf8');
    const message = await loadContract(specPath).then(
      () => 'resolved',
      (error: unknown) => String((error as { message?: unknown }).message),
    );
    expect(message).toContain('Unable to resolve $ref pointer');
    expect(message).not.toContain('Error downloading');
  });

  it('[PR21-SEC-08] openapi.yaml references nothing outside itself (every $ref key of the parsed document)', async () => {
    const refs = collectRefs(await SwaggerParser.parse(OPENAPI_PATH));
    expect(refs.length).toBeGreaterThan(0);
    expect(refs.filter((ref) => !ref.startsWith('#/'))).toEqual([]);
  });

  it('[PR21-SEC-08] the reference scan counts a quoted $ref key (seeded external reference)', async () => {
    for (const [index, quote] of ['', '"', "'"].entries()) {
      const specPath = join(scratch, `quoted-ref-${String(index)}.yaml`);
      await writeFile(specPath, remoteRefDocument('http://evil.example.invalid/x.yaml', quote), 'utf8');
      expect(collectRefs(await SwaggerParser.parse(specPath))).toEqual(['http://evil.example.invalid/x.yaml']);
    }
  });
});
