/**
 * Repository-structure rules (brief §4.1, ADR-0002, ADR-0003; REQ-PLAT-001, US-001).
 * Pure: takes a filesystem probe so it can run against the real tree or a fixture.
 */

/** Top-level folders every clone must contain (US-001 scenario 1). */
export const REQUIRED_FOLDERS = [
  'apps/web',
  'apps/admin',
  'apps/api',
  'apps/worker',
  'packages/shared',
  'packages/ui',
  'packages/carriers',
  'packages/pricing',
  'packages/audit',
  'packages/authz',
  'packages/config',
  'prisma',
  'infra',
  'tests',
  'docs',
] as const;

/** Modules instantiated in M0/M1 (ADR-0003 "Modules (bounded contexts) in this run"). */
export const API_MODULES = [
  'identity',
  'organisations',
  'quotes',
  'pricing',
  'carriers',
  'shipments',
  'orders',
  'payments',
  'customs',
  'documents',
  'pickups',
  'tracking',
  'notifications',
  'compliance',
  'audit',
  'admin-settings',
] as const;

/** Layers each module folder contains (ADR-0003). A layer is a `<layer>/` folder or a `<layer>.ts` file. */
export const MODULE_LAYERS = ['routes', 'controller', 'service', 'repository', 'schemas', 'policies', 'events', 'tests'] as const;

export const MODULES_DIR = 'apps/api/src/modules';

export interface FsProbe {
  /** True when `relPath` (POSIX separators, relative to the repository root) is a directory. */
  isDirectory(relPath: string): boolean;
  /** True when `relPath` is a regular file. */
  isFile(relPath: string): boolean;
  /** Names of the sub-directories of `relPath`; empty when it does not exist. */
  subdirectories(relPath: string): string[];
}

/**
 * Returns the repository-relative paths that are missing, sorted. An empty array means the
 * structure is complete. Every module folder present under `apps/api/src/modules` is checked,
 * not only the ADR-0003 list, so a new module cannot skip a layer.
 */
export function findStructureViolations(fs: FsProbe): string[] {
  const missing: string[] = [];
  for (const folder of REQUIRED_FOLDERS) {
    if (!fs.isDirectory(folder)) missing.push(folder);
  }
  const present = new Set(fs.subdirectories(MODULES_DIR));
  const modules = new Set<string>([...API_MODULES, ...present]);
  for (const mod of modules) {
    const modDir = `${MODULES_DIR}/${mod}`;
    if (!present.has(mod)) {
      missing.push(modDir);
      continue;
    }
    for (const layer of MODULE_LAYERS) {
      const asDir = `${modDir}/${layer}`;
      if (!fs.isDirectory(asDir) && !fs.isFile(`${asDir}.ts`)) missing.push(asDir);
    }
  }
  return missing.sort();
}
