/**
 * Pooled-fetch ratchet scanner (TASK-291, D-ORCH-113 (a), D-ARCH-146; PR #56 code review R2-n3). The global `fetch` keeps
 * pooled keep-alive sockets, so a loopback suite either waits in `server.close()` or reuses a socket the server already
 * closed (ECONNRESET) under host load. The one transport is `fetchOnce` of
 * apps/api/src/platform/routing/tests/loopback.ts. This module finds the files that still call the global `fetch`
 * against a loopback server; loopback-ratchet.test.ts compares the list with the checked-in allow-list, which may only shrink.
 * Pure over file text, plus one `git ls-files` listing. Never imported by production code.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

/** Roots scanned, and the extensions of a source file. */
export const SCAN_ROOTS = ['apps/', 'packages/', 'tests/', 'tools/'] as const;
const SOURCE = /\.(?:[cm]?[jt]sx?)$/u;
/** Never scanned: fixture trees seed defects on purpose, and this scanner and its test name the patterns. */
const EXCLUDED = [/^tests\/fixtures\//u, /^tests\/generated\/loopback-(?:scan|ratchet)\./u, /(?:^|\/)node_modules\//u, /(?:^|\/)dist\//u];

/** A call of the global `fetch` (a bare `fetch(` or `globalThis.fetch(`), not `fetchOnce(` and not a method such as `x.fetch(`. */
const GLOBAL_FETCH_CALL = /(?<![\w$.])(?:globalThis\.)?fetch\(/u;
/** What makes a file a loopback client: a loopback literal, a listening server or the stub server's URL. */
const LOOPBACK_MARKER = /127\.0\.0\.1|localhost|\.listen\(|server\.url|\$\{base\}/u;

/** `text` without block comments and without line comments that start a line or follow white space (`http://` survives). */
export function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//gu, '').replace(/(^|\s)\/\/.*$/gmu, '$1');
}

/** Whether `text` calls the global fetch and also talks to a loopback server. */
export function callsGlobalFetchOnLoopback(text: string): boolean {
  const code = withoutComments(text);
  return GLOBAL_FETCH_CALL.test(code) && LOOPBACK_MARKER.test(code);
}

/** Whether `path` (repo-relative, forward slashes) is in the scan scope. */
export function inScanScope(path: string): boolean {
  return SCAN_ROOTS.some((root) => path.startsWith(root)) && SOURCE.test(path) && !EXCLUDED.some((pattern) => pattern.test(path));
}

/** The text of a listed file; a tracked file that is missing or unreadable fails with its path named. */
function readSource(root: string, path: string): string {
  try {
    return readFileSync(join(root, path), 'utf8');
  } catch (error) {
    throw new Error(`loopback scan: cannot read ${path} (tracked but deleted, or the root is not the repository checkout)`, {
      cause: error,
    });
  }
}

/** The sorted repo-relative paths under the roots that still call the global fetch against a loopback server. */
export function scanLoopbackFetchUsers(root: string): string[] {
  const listing = execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 30_000,
    windowsHide: true,
  });
  return [...new Set(listing.split('\0').filter((path) => path !== '' && inScanScope(path)))]
    .filter((path) => callsGlobalFetchOnLoopback(readSource(root, path)))
    .sort();
}

export interface AllowListEntry {
  readonly file: string;
  /** The folder lock whose next task converts the file to `fetchOnce` (docs/04-plan/tasks/WAVE-00.md). */
  readonly lock: string;
}

/** Ratchet findings: a file not on the list (new user) and a listed file that no longer matches (converted or gone). */
export function ratchetFindings(found: readonly string[], allowed: readonly AllowListEntry[]): string[] {
  const listed = new Set(allowed.map((entry) => entry.file));
  const present = new Set(found);
  return [
    ...found
      .filter((file) => !listed.has(file))
      .map(
        (file) => `${file}: calls the global fetch against a loopback server; use fetchOnce (loopback.ts), the allow-list may only shrink`,
      ),
    ...[...listed]
      .filter((file) => !present.has(file))
      .map((file) => `${file}: converted or removed; delete it from loopback-fetch-allowlist.json`),
  ].sort();
}
