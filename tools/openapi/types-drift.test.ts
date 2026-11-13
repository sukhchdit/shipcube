/**
 * Generated-types freshness (US-035 AT-US-035-03; REQ-API-019; ADR-0016 §1): the committed
 * `packages/shared/src/api/types.gen.ts` matches the document, and a contract change without regeneration fails the
 * `--check` CLI listing the file. Each check renders the full document once (a few seconds); the timeout leaves
 * headroom on a loaded host. The generated file holds type declarations only (PR21-SEC-05).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import ts from 'typescript';

import { OPENAPI_PATH, TYPES_GEN_PATH } from './contract.js';
import { type CliOutput, GENERATED_HEADER, main, repoRelative } from './types.js';

const GENERATION_TIMEOUT_MS = 60_000;
const SCHEMAS_ANCHOR = '\n  schemas:\n';

/** A CliOutput that records what the CLI prints. */
function capture(): CliOutput & { readonly out: string[]; readonly err: string[] } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, stdout: { write: (text: string) => out.push(text) }, stderr: { write: (text: string) => err.push(text) } };
}

describe('openapi:types drift check', () => {
  let scratch: string;

  beforeAll(async () => {
    scratch = await mkdtemp(join(tmpdir(), 'openapi-types-'));
  });

  afterAll(async () => {
    await rm(scratch, { recursive: true, force: true });
  });

  it(
    '[AT-US-035-03] the committed generated client is fresh: `openapi:types -- --check` exits 0 and prints nothing',
    async () => {
      const output = capture();
      await expect(main(['--check'], { specPath: OPENAPI_PATH, outFile: TYPES_GEN_PATH }, output)).resolves.toBe(0);
      expect([output.out, output.err]).toEqual([[], []]);
    },
    GENERATION_TIMEOUT_MS,
  );

  it(
    '[AT-US-035-03] stale generated client fails `openapi:types -- --check` with exit 1, listing the changed file',
    async () => {
      const spec = await readFile(OPENAPI_PATH, 'utf8');
      expect(spec).toContain(SCHEMAS_ANCHOR);
      const changed = spec.replace(
        SCHEMAS_ANCHOR,
        `${SCHEMAS_ANCHOR}    DriftProbe:\n      type: object\n      properties:\n        added:\n          type: string\n`,
      );
      const specPath = join(scratch, 'openapi.yaml');
      await writeFile(specPath, changed, 'utf8');

      const output = capture();
      await expect(main(['--check'], { specPath, outFile: TYPES_GEN_PATH }, output)).resolves.toBe(1);
      expect(output.out).toEqual(['stale: packages/shared/src/api/types.gen.ts\n']);
      expect(output.err.join('')).toContain('generated types are stale: run `npm run openapi:types`');
    },
    GENERATION_TIMEOUT_MS,
  );

  it('the committed file starts with the generated-file header', async () => {
    const committed = await readFile(TYPES_GEN_PATH, 'utf8');
    expect(committed.startsWith(GENERATED_HEADER.trimEnd())).toBe(true);
  });

  it('[PR21-SEC-05] the committed file holds type declarations only (no statement that runs code)', async () => {
    const source = ts.createSourceFile(
      TYPES_GEN_PATH,
      await readFile(TYPES_GEN_PATH, 'utf8'),
      ts.ScriptTarget.Latest,
      false,
      ts.ScriptKind.TS,
    );
    const disallowed = source.statements
      .filter((statement) => {
        if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) return false;
        // `export {}` (an empty, module-less export) is the only other statement allowed.
        return !(
          ts.isExportDeclaration(statement) &&
          statement.moduleSpecifier === undefined &&
          statement.exportClause !== undefined &&
          ts.isNamedExports(statement.exportClause) &&
          statement.exportClause.elements.length === 0
        );
      })
      .map(
        (statement) =>
          `${ts.SyntaxKind[statement.kind]} at line ${String(source.getLineAndCharacterOfPosition(statement.getStart(source)).line + 1)}`,
      );
    expect(source.statements.length).toBeGreaterThan(0);
    expect(disallowed).toEqual([]);
  });

  it('reports paths repository-relative with forward slashes', () => {
    expect(repoRelative(TYPES_GEN_PATH)).toBe('packages/shared/src/api/types.gen.ts');
  });

  it('the CLI rejects an unknown argument with exit code 2', async () => {
    const output = capture();
    await expect(main(['--write-elsewhere'], undefined, output)).resolves.toBe(2);
    expect(output.err.join('')).toContain('unknown argument(s): --write-elsewhere');
  });
});
