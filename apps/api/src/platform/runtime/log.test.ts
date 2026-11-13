// Runtime log factory (TASK-010): package version reading and the options passed through to the shared logger.
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

import { describe, expect, it } from '@jest/globals';

import { createRuntimeLog, readPackageVersion, UNKNOWN_VERSION } from './log.js';

function manifest(content: string): URL {
  const dir = mkdtempSync(join(tmpdir(), 'runtime-log-'));
  const file = join(dir, 'package.json');
  writeFileSync(file, content);
  return pathToFileURL(file);
}

describe('readPackageVersion', () => {
  it('reads a semver version from the manifest', () => {
    expect(readPackageVersion(manifest(JSON.stringify({ version: '1.4.0-m1' })))).toBe('1.4.0-m1');
  });

  it('falls back to the unknown version for a missing file, bad JSON or a non-semver value', () => {
    expect(readPackageVersion(new URL('file:///definitely/missing/package.json'))).toBe(UNKNOWN_VERSION);
    expect(readPackageVersion(manifest('{not json'))).toBe(UNKNOWN_VERSION);
    expect(readPackageVersion(manifest(JSON.stringify({ version: 'latest; rm -rf /' })))).toBe(UNKNOWN_VERSION);
    expect(readPackageVersion(manifest('null'))).toBe(UNKNOWN_VERSION);
  });
});

describe('createRuntimeLog', () => {
  it('passes version, level, context and clock to the shared logger', () => {
    const raw: string[] = [];
    const log = createRuntimeLog(
      'worker',
      { write: (line: string) => raw.push(line) },
      { version: '2.0.0', level: 'warn', context: () => ({ correlationId: 'abc-12345678' }), now: () => new Date(0) },
    );
    log.info('dropped.by.level');
    log.warn('kept', { port: 3000 });
    expect(raw.map((line) => JSON.parse(line) as unknown)).toEqual([
      expect.objectContaining({
        level: 'warn',
        timestamp: '1970-01-01T00:00:00.000Z',
        service: 'worker',
        version: '2.0.0',
        event: 'kept',
        correlation_id: 'abc-12345678',
        port: 3000,
      }),
    ]);
  });
});
