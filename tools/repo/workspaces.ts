import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface Manifest {
  name: string;
  private?: boolean;
  license?: string;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  engines?: Record<string, string>;
  workspaces?: string[];
}

export interface WorkspaceManifest {
  /** Repository-relative directory with POSIX separators; `.` for the root. */
  dir: string;
  manifest: Manifest;
}

const readManifest = (path: string): Manifest => JSON.parse(readFileSync(path, 'utf8')) as Manifest;

/**
 * The root manifest plus every workspace manifest. Supports the two pattern shapes the root uses:
 * `dir/*` (direct children holding a package.json) and a plain directory.
 */
export function listManifests(repoRoot: string): WorkspaceManifest[] {
  const root = readManifest(join(repoRoot, 'package.json'));
  const result: WorkspaceManifest[] = [{ dir: '.', manifest: root }];
  for (const pattern of root.workspaces ?? []) {
    const dirs = pattern.endsWith('/*')
      ? readdirSync(join(repoRoot, pattern.slice(0, -2)), { withFileTypes: true })
          .filter((entry) => entry.isDirectory())
          .map((entry) => `${pattern.slice(0, -2)}/${entry.name}`)
      : [pattern];
    for (const dir of dirs) {
      const path = join(repoRoot, ...dir.split('/'), 'package.json');
      if (existsSync(path)) result.push({ dir, manifest: readManifest(path) });
    }
  }
  return result;
}

/** All dependency entries of a manifest as `[name, range, field]`. */
export function dependencyEntries(manifest: Manifest): Array<[string, string, string]> {
  const fields = ['dependencies', 'devDependencies', 'peerDependencies'] as const;
  return fields.flatMap((field) =>
    Object.entries(manifest[field] ?? {}).map(([name, range]): [string, string, string] => [name, range, field]),
  );
}
