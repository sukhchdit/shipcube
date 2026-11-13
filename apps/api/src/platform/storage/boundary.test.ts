/**
 * ADR-0021 §1: "no other code imports the AWS SDK for S3". Only files under apps/api/src/platform/storage/ may import
 * `@aws-sdk/client-s3` or `@aws-sdk/s3-request-presigner`; everything else goes through the `ObjectStorage` port.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from '@jest/globals';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const ALLOWED_DIR = join('apps', 'api', 'src', 'platform', 'storage') + sep;
const SDK_IMPORT = /(?:from\s+|import\s*\(\s*|require\s*\(\s*|import\s+)['"]@aws-sdk\/(?:client-s3|s3-request-presigner)(?:\/[^'"]*)?['"]/u;

/** Non-test TypeScript sources under `apps/*\/src` and `packages/*\/src`, as repository-relative paths. */
function sourceFiles(): string[] {
  const files: string[] = [];
  for (const group of ['apps', 'packages']) {
    for (const workspace of readdirSync(join(REPO_ROOT, group), { withFileTypes: true })) {
      if (!workspace.isDirectory()) continue;
      const src = join(REPO_ROOT, group, workspace.name, 'src');
      let entries;
      try {
        entries = readdirSync(src, { withFileTypes: true, recursive: true });
      } catch {
        continue; // workspace without a src folder
      }
      for (const entry of entries) {
        if (entry.isFile() && /\.tsx?$/u.test(entry.name) && !/\.test\.tsx?$/u.test(entry.name) && !/\.d\.ts$/u.test(entry.name)) {
          files.push(relative(REPO_ROOT, join(entry.parentPath, entry.name)));
        }
      }
    }
  }
  return files;
}

const importsS3Sdk = (file: string): boolean => SDK_IMPORT.test(readFileSync(join(REPO_ROOT, file), 'utf8'));

describe('ADR-0021 §1 boundary: only platform/storage imports the AWS SDK for S3', () => {
  it('positive control: the adapter is found importing the SDK, so the scan sees real files', () => {
    const importing = sourceFiles().filter(importsS3Sdk);
    expect(importing).toContain(join('apps', 'api', 'src', 'platform', 'storage', 's3-object-storage.ts'));
  });

  it('the pattern recognises static, dynamic and require forms and ignores other packages (control)', () => {
    expect(SDK_IMPORT.test("import { S3Client } from '@aws-sdk/client-s3';")).toBe(true);
    expect(SDK_IMPORT.test("const m = await import('@aws-sdk/s3-request-presigner');")).toBe(true);
    expect(SDK_IMPORT.test('const m = require("@aws-sdk/client-s3/dist-types");')).toBe(true);
    expect(SDK_IMPORT.test("import { SESClient } from '@aws-sdk/client-ses';")).toBe(false);
  });

  it('no source file outside apps/api/src/platform/storage imports it', () => {
    const offenders = sourceFiles().filter((file) => !file.startsWith(ALLOWED_DIR) && importsS3Sdk(file));
    expect(offenders).toEqual([]);
  });
});
