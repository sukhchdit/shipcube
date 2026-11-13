/**
 * ADR-0021 §1: "no other code imports the AWS SDK for S3". Two controls (D-TASK019-02 (6), PR #32 code review R2-n2):
 * the ESLint no-restricted-imports entry of TASK-020 (S3_SDK_IMPORT_PATTERN in eslint.config.mjs) covers static imports
 * and export-from; this unit test covers those and also dynamic import() and require, which that rule does not see.
 * Only files under apps/api/src/platform/storage/ may import any
 * `@aws-sdk/*` package (client-s3, s3-request-presigner, lib-storage, s3-presigned-post, ...) or `@smithy/signature-v4`;
 * everything else goes through the `ObjectStorage` port. A future AWS adapter for another service gets its own folder
 * added to OTHER_AWS_ADAPTER_DIRS by its task, as a reviewed decision.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from '@jest/globals';

const REPO_ROOT = join(import.meta.dirname, '..', '..', '..', '..', '..');
const ALLOWED_DIR = join('apps', 'api', 'src', 'platform', 'storage') + sep;
/** Other folders allowed to import `@aws-sdk/*` (none yet). Never add S3 here: S3 stays behind the port. */
const OTHER_AWS_ADAPTER_DIRS: readonly string[] = [];
const SOURCE_FILE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/u;
const EXCLUDED_FILE = /\.test\.(?:[cm]?ts|tsx|[cm]?js|jsx)$|\.d\.[cm]?ts$/u;
/** Static, type-only, re-export, side-effect, dynamic (quotes or template literal) and require forms. */
const SDK_IMPORT =
  /(?:\bfrom\s*|\bimport\s*\(\s*|\brequire\s*\(\s*|\bimport\s+)['"`](?:@aws-sdk\/[a-z0-9-]+|@smithy\/signature-v4)(?:\/[^'"`]*)?['"`]/u;

/** Non-test sources under `apps/*\/src` and `packages/*\/src`, as repository-relative paths. */
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
        if (entry.isFile() && SOURCE_FILE.test(entry.name) && !EXCLUDED_FILE.test(entry.name)) {
          files.push(relative(REPO_ROOT, join(entry.parentPath, entry.name)));
        }
      }
    }
  }
  return files;
}

const importsAwsSdk = (file: string): boolean => SDK_IMPORT.test(readFileSync(join(REPO_ROOT, file), 'utf8'));
const allowed = (file: string): boolean => [ALLOWED_DIR, ...OTHER_AWS_ADAPTER_DIRS].some((dir) => file.startsWith(dir));

describe('ADR-0021 §1 boundary: only platform/storage imports the AWS SDK', () => {
  it('positive control: the adapter is found importing the SDK, so the scan sees real files', () => {
    const importing = sourceFiles().filter(importsAwsSdk);
    expect(importing).toContain(join('apps', 'api', 'src', 'platform', 'storage', 's3-object-storage.ts'));
  });

  it.each([
    ["import { S3Client } from '@aws-sdk/client-s3';", 'static'],
    ["import type { S3ClientConfig } from '@aws-sdk/client-s3';", 'type-only'],
    ["export { S3Client } from '@aws-sdk/client-s3';", 're-export'],
    ["import '@aws-sdk/client-s3';", 'side-effect'],
    ["const m = await import('@aws-sdk/s3-request-presigner');", 'dynamic'],
    ['const m = await import(`@aws-sdk/client-s3`);', 'dynamic template literal'],
    ['const m = require("@aws-sdk/client-s3/dist-types");', 'require of a subpath'],
    ["import {\n  S3Client,\n} from '@aws-sdk/client-s3';", 'multi-line'],
    ["import { Upload } from '@aws-sdk/lib-storage';", 'multipart helper'],
    ["import { createPresignedPost } from '@aws-sdk/s3-presigned-post';", 'presigned POST'],
    ["import { SignatureV4 } from '@smithy/signature-v4';", 'raw SigV4 signer'],
    ["import { SESClient } from '@aws-sdk/client-ses';", 'another AWS client'],
  ])('the pattern recognises %s (%s)', (source) => {
    expect(SDK_IMPORT.test(source)).toBe(true);
  });

  it.each([
    "import { createHash } from 'node:crypto';",
    "import { Something } from '@smithy/types';",
    "import { thing } from '@aws-sdkx/client-s3';",
    "const text = 'the @aws-sdk/client-s3 package';",
  ])('the pattern ignores %s (negative control)', (source) => {
    expect(SDK_IMPORT.test(source)).toBe(false);
  });

  it('no source file outside apps/api/src/platform/storage imports it', () => {
    const offenders = sourceFiles().filter((file) => !allowed(file) && importsAwsSdk(file));
    expect(offenders).toEqual([]);
  });
});
