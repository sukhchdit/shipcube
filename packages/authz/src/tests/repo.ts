/** Test-only helpers: locate the repository root and read or list repository files (no I/O in the domain code). */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

/** Walks up from the working directory to the package.json that declares npm workspaces. */
export function repoRoot(start: string = process.cwd()): string {
  let dir = resolve(start);
  for (;;) {
    const manifest = join(dir, 'package.json');
    if (existsSync(manifest) && Array.isArray((JSON.parse(readFileSync(manifest, 'utf8')) as { workspaces?: unknown }).workspaces))
      return dir;
    const parent = dirname(dir);
    if (parent === dir) throw new Error(`no workspace root above ${start}`);
    dir = parent;
  }
}

export function readRepoFile(relativePath: string): string {
  return readFileSync(join(repoRoot(), relativePath), 'utf8');
}

export function readText(absolutePath: string): string {
  return readFileSync(absolutePath, 'utf8');
}

/** Source files (`.ts`, `.tsx`, `.js`, `.mjs`) under `relativeDir`, recursively, without node_modules and build output. */
export function listSources(relativeDir: string): string[] {
  const root = join(repoRoot(), relativeDir);
  if (!existsSync(root)) return [];
  return readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((file) => /\.(tsx?|m?js)$/.test(file) && !/(^|[\\/])(node_modules|dist|build)[\\/]/.test(file))
    .map((file) => join(root, file));
}
