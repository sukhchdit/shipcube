/**
 * Owner-only artefacts of the restore rehearsal (PR034-SEC-02, CWE-276; TASK-034 fix cycle 3): the modes every call
 * passes, platform-independent through a recording file system, and the real modes on POSIX.
 */
import { mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';

import { afterAll, describe, expect, it } from '@jest/globals';

import { PRIVATE_DIR_MODE, PRIVATE_FILES, PRIVATE_FILE_MODE, privateFiles, type PrivateFs } from './private-files.js';

const work = mkdtempSync(join(tmpdir(), 'private-files-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

function recording(platform: NodeJS.Platform): { fs: PrivateFs; calls: unknown[][] } {
  const calls: unknown[][] = [];
  return {
    calls,
    fs: {
      platform,
      mkdirSync: (...args) => calls.push(['mkdir', ...args]),
      chmodSync: (...args) => calls.push(['chmod', ...args]),
      writeFileSync: (...args) => calls.push(['write', ...args]),
      createWriteStream: (...args) => {
        calls.push(['stream', ...args]);
        return new Writable({ write: (_chunk, _encoding, done) => done() });
      },
    },
  };
}

describe('privateFiles (PR034-SEC-02)', () => {
  it('[PR034-SEC-02] folders 0o700 (recursive, so new parents too) and files 0o600; on POSIX an existing folder or replaced file is set again', () => {
    expect(PRIVATE_DIR_MODE).toBe(0o700);
    expect(PRIVATE_FILE_MODE).toBe(0o600);
    const posix = recording('linux');
    const files = privateFiles(posix.fs);
    files.makeDir('/r/reports/rehearsal/x-backup');
    files.writeFile('/r/x/manifest.json', '{}', true);
    files.writeFile('/r/x/restore-report.json', '{}', false);
    files.openSink('/r/x/platform.dump');
    expect(posix.calls).toEqual([
      ['mkdir', '/r/reports/rehearsal/x-backup', { recursive: true, mode: 0o700 }],
      ['chmod', '/r/reports/rehearsal/x-backup', 0o700],
      ['write', '/r/x/manifest.json', '{}', { flag: 'wx', mode: 0o600 }],
      ['write', '/r/x/restore-report.json', '{}', { flag: 'w', mode: 0o600 }],
      ['chmod', '/r/x/restore-report.json', 0o600],
      ['stream', '/r/x/platform.dump', { flags: 'wx', mode: 0o600 }],
    ]);
  });

  it('[PR034-SEC-02] on Windows the same modes are passed and no chmod runs (the profile ACL applies)', () => {
    const windows = recording('win32');
    const files = privateFiles(windows.fs);
    files.makeDir('C:/r/x');
    files.writeFile('C:/r/x/restore-report.json', '{}', false);
    expect(windows.calls).toEqual([
      ['mkdir', 'C:/r/x', { recursive: true, mode: 0o700 }],
      ['write', 'C:/r/x/restore-report.json', '{}', { flag: 'w', mode: 0o600 }],
    ]);
  });

  (process.platform === 'win32' ? it.skip : it)(
    '[PR034-SEC-02] POSIX: real folder, file and stream modes allow the owner only',
    async () => {
      const dir = join(work, 'a', 'b');
      PRIVATE_FILES.makeDir(dir);
      PRIVATE_FILES.writeFile(join(dir, 'f.json'), '{}', true);
      const sink = PRIVATE_FILES.openSink(join(dir, 'archive'));
      await new Promise<void>((resolve, reject) => sink.end('x', () => resolve()).on('error', reject));
      for (const path of [join(work, 'a'), dir]) expect(statSync(path).mode & 0o777).toBe(0o700);
      for (const path of [join(dir, 'f.json'), join(dir, 'archive')]) expect(statSync(path).mode & 0o777).toBe(0o600);
    },
  );

  it('an exclusive write and the sink refuse an existing file (a backup is never written over another)', async () => {
    const dir = join(work, 'exclusive');
    PRIVATE_FILES.makeDir(dir);
    PRIVATE_FILES.writeFile(join(dir, 'f.json'), '{}', true);
    expect(() => PRIVATE_FILES.writeFile(join(dir, 'f.json'), '{}', true)).toThrow(/EEXIST/);
    PRIVATE_FILES.writeFile(join(dir, 'f.json'), '{"a":1}', false);
    const sink = PRIVATE_FILES.openSink(join(dir, 'f.json'));
    await expect(new Promise((_resolve, reject) => sink.on('error', reject))).rejects.toThrow(/EEXIST/);
  });
});
