import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import type { FsProbe } from './structure.js';

/** FsProbe over the real filesystem rooted at `root`. */
export function nodeFsProbe(root: string): FsProbe {
  const stat = (rel: string) => {
    try {
      return statSync(join(root, ...rel.split('/')));
    } catch {
      return undefined;
    }
  };
  return {
    isDirectory: (rel) => stat(rel)?.isDirectory() ?? false,
    isFile: (rel) => stat(rel)?.isFile() ?? false,
    subdirectories: (rel) => {
      if (!(stat(rel)?.isDirectory() ?? false)) return [];
      return readdirSync(join(root, ...rel.split('/')), { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name);
    },
  };
}
