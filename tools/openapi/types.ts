/**
 * Generated API types (REQ-API-019, US-035 AT-US-035-03; ADR-0016 §1, api/README.md §17): renders
 * `packages/shared/src/api/types.gen.ts` from the OpenAPI document with the openapi-typescript 7 Node API (the
 * README's `--alphabetize --immutable` CLI flags), formatted with the repository's Prettier configuration.
 * CLI: `npm run openapi:types` writes the file; `npm run openapi:types -- --check` exits 1 listing the stale file.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { relative } from 'node:path';
import { pathToFileURL } from 'node:url';

import openapiTS, { astToString } from 'openapi-typescript';
import { format, resolveConfig } from 'prettier';

import { OPENAPI_PATH, REPO_ROOT, TYPES_GEN_PATH } from './contract.js';

export const GENERATED_HEADER = [
  '// Generated from docs/03-architecture/api/openapi.yaml by tools/openapi/types.ts (openapi-typescript 7). Do not edit:',
  '// change the contract, then regenerate with `npm run openapi:types` (CI fails a stale file: `npm run openapi:types -- --check`).',
  '',
].join('\n');

export interface GeneratedTypesFiles {
  readonly specPath: string;
  readonly outFile: string;
}

/** Repository-relative, forward-slash path, as printed by the check (stable across hosts). */
export function repoRelative(path: string): string {
  return relative(REPO_ROOT, path).replaceAll('\\', '/');
}

/** Renders the formatted file content for the document at `specPath` (no file is written). */
export async function renderTypes(specPath: string, outFile: string = TYPES_GEN_PATH): Promise<string> {
  const ast = await openapiTS(pathToFileURL(specPath), { alphabetize: true, immutable: true, silent: true });
  const source = `${GENERATED_HEADER}${astToString(ast)}`;
  const prettierOptions = (await resolveConfig(outFile)) ?? {};
  return format(source, { ...prettierOptions, filepath: outFile });
}

/** Line endings are compared as LF: `.gitattributes` checks text out as LF, but an editor may not keep it. */
const normalise = (text: string): string => text.replaceAll('\r\n', '\n');

/** Regenerates in memory and lists the out file (repo-relative) when the file on disk is missing or differs. */
export async function checkGenerated({ specPath, outFile }: GeneratedTypesFiles): Promise<{ stale: string[] }> {
  const expected = await renderTypes(specPath, outFile);
  let actual: string | undefined;
  try {
    actual = await readFile(outFile, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const fresh = actual !== undefined && normalise(actual) === normalise(expected);
  return { stale: fresh ? [] : [repoRelative(outFile)] };
}

export async function writeGenerated({ specPath, outFile }: GeneratedTypesFiles): Promise<void> {
  await writeFile(outFile, await renderTypes(specPath, outFile), 'utf8');
}

export async function main(argv: readonly string[] = process.argv.slice(2)): Promise<number> {
  const files = { specPath: OPENAPI_PATH, outFile: TYPES_GEN_PATH };
  const unknown = argv.filter((arg) => arg !== '--check');
  if (unknown.length > 0) {
    process.stderr.write(`[openapi:types] unknown argument(s): ${unknown.join(' ')} (usage: openapi:types [-- --check])\n`);
    return 2;
  }
  try {
    if (argv.includes('--check')) {
      const { stale } = await checkGenerated(files);
      for (const file of stale) process.stdout.write(`stale: ${file}\n`);
      if (stale.length > 0) process.stderr.write('[openapi:types] generated types are stale: run `npm run openapi:types`\n');
      return stale.length > 0 ? 1 : 0;
    }
    await writeGenerated(files);
    process.stdout.write(`[openapi:types] wrote ${repoRelative(files.outFile)}\n`);
    return 0;
  } catch (error) {
    process.stderr.write(`[openapi:types] ${error instanceof Error ? error.message : String(error)}\n`);
    return 1;
  }
}

if (import.meta.main) {
  void main().then((code) => {
    process.exitCode = code;
  });
}
