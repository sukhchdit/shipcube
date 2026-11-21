/**
 * Owner-only files and folders for the restore rehearsal's artefacts (PR034-SEC-02, CWE-276; TASK-034 fix cycle 3): the
 * archive holds every row and threat model T-81 classes a backup as all-tenant PII, so the archive, `manifest.json`,
 * `schema.sql` and `restore-report.json` are created `0o600` and their folders `0o700`. A folder or report that already
 * exists keeps its old mode on creation, so on POSIX it is set again with `chmod`. On Windows the modes carry no ACL
 * (Node maps them to the read-only flag at most): the files inherit the user-profile ACL there.
 */
import { chmodSync, createWriteStream, mkdirSync, writeFileSync } from 'node:fs';
import type { Writable } from 'node:stream';

export const PRIVATE_FILE_MODE = 0o600;
export const PRIVATE_DIR_MODE = 0o700;

/** The file-system calls this module makes, injectable for the platform-independent unit test. */
export interface PrivateFs {
  readonly platform: NodeJS.Platform;
  readonly mkdirSync: (path: string, options: { recursive: true; mode: number }) => unknown;
  readonly chmodSync: (path: string, mode: number) => void;
  readonly writeFileSync: (path: string, data: string, options: { flag: 'w' | 'wx'; mode: number }) => void;
  readonly createWriteStream: (path: string, options: { flags: 'wx'; mode: number }) => Writable;
}

export const NODE_PRIVATE_FS: PrivateFs = { platform: process.platform, mkdirSync, chmodSync, writeFileSync, createWriteStream };

export interface PrivateFiles {
  /** Creates `path` and any missing parent `0o700`; on POSIX `path` itself is set `0o700` even when it existed. */
  makeDir(path: string): void;
  /** Writes `data` to `path` `0o600`: `exclusive` refuses an existing file (`wx`), otherwise the file is replaced. */
  writeFile(path: string, data: string, exclusive: boolean): void;
  /** Opens a new file `0o600` for a stream (`wx`: never over an existing file or a planted symlink). */
  openSink(path: string): Writable;
}

export function privateFiles(fs: PrivateFs = NODE_PRIVATE_FS): PrivateFiles {
  const posix = fs.platform !== 'win32';
  return {
    makeDir(path) {
      fs.mkdirSync(path, { recursive: true, mode: PRIVATE_DIR_MODE });
      if (posix) fs.chmodSync(path, PRIVATE_DIR_MODE);
    },
    writeFile(path, data, exclusive) {
      fs.writeFileSync(path, data, { flag: exclusive ? 'wx' : 'w', mode: PRIVATE_FILE_MODE });
      if (posix && !exclusive) fs.chmodSync(path, PRIVATE_FILE_MODE);
    },
    openSink: (path) => fs.createWriteStream(path, { flags: 'wx', mode: PRIVATE_FILE_MODE }),
  };
}

export const PRIVATE_FILES: PrivateFiles = privateFiles();
