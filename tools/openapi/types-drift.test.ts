/**
 * Generated-types freshness (US-035 AT-US-035-03; REQ-API-019; ADR-0016 §1): the committed
 * `packages/shared/src/api/types.gen.ts` matches the document, and a contract change without regeneration is listed.
 * Each case renders the full document once (a few seconds); the timeout leaves headroom on a loaded host.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { OPENAPI_PATH, TYPES_GEN_PATH } from './contract.js';
import { checkGenerated, GENERATED_HEADER, main, repoRelative } from './types.js';

const GENERATION_TIMEOUT_MS = 60_000;
const SCHEMAS_ANCHOR = '\n  schemas:\n';

describe('openapi:types drift check', () => {
  let scratch: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'openapi-types-'));
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it(
    '[AT-US-035-03] the committed generated client is fresh',
    async () => {
      await expect(checkGenerated({ specPath: OPENAPI_PATH, outFile: TYPES_GEN_PATH })).resolves.toEqual({ stale: [] });
    },
    GENERATION_TIMEOUT_MS,
  );

  it(
    '[AT-US-035-03] stale generated client fails the check, listing the changed file',
    async () => {
      const spec = await readFile(OPENAPI_PATH, 'utf8');
      expect(spec).toContain(SCHEMAS_ANCHOR);
      const changed = spec.replace(
        SCHEMAS_ANCHOR,
        `${SCHEMAS_ANCHOR}    DriftProbe:\n      type: object\n      properties:\n        added:\n          type: string\n`,
      );
      const specPath = join(scratch, 'openapi.yaml');
      await writeFile(specPath, changed, 'utf8');

      await expect(checkGenerated({ specPath, outFile: TYPES_GEN_PATH })).resolves.toEqual({
        stale: ['packages/shared/src/api/types.gen.ts'],
      });
    },
    GENERATION_TIMEOUT_MS,
  );

  it('the committed file starts with the generated-file header', async () => {
    const committed = await readFile(TYPES_GEN_PATH, 'utf8');
    expect(committed.startsWith(GENERATED_HEADER.trimEnd())).toBe(true);
  });

  it('reports paths repository-relative with forward slashes', () => {
    expect(repoRelative(TYPES_GEN_PATH)).toBe('packages/shared/src/api/types.gen.ts');
  });

  it('the CLI rejects an unknown argument with exit code 2', async () => {
    await expect(main(['--write-elsewhere'])).resolves.toBe(2);
  });
});
