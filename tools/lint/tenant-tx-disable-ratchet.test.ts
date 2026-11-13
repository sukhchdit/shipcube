/**
 * T-83 hatch ratchet (D-ARCH-106 (6), ADR-0005 am. 11 item 21; PR32-SEC-01 condition C1): the only escape from
 * `platform/no-external-calls-in-tenant-tx` is a route's `transaction: 'none'`, never an inline disable. This suite
 * fails on any `eslint-disable`, `eslint-disable-line` or `eslint-disable-next-line` directive (line or block comment)
 * that names the rule, or names no rule at all (a blanket directive disables it too), in `apps/*\/src/**` or
 * `packages/*\/src/**`. Comments are read with the suppression checker's lexer (strings, templates and regular
 * expressions are skipped), over the tracked and untracked-not-ignored files (`git ls-files`).
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { listRepositoryFiles, scanText } from './check-suppressions.mjs';
import { findRepoRoot } from '../test-support/process.js';

const RULE = 'platform/no-external-calls-in-tenant-tx';
/** The rule's scope (eslint.config.mjs): application and package sources. */
const IN_SCOPE = /^(?:apps|packages)\/[^/]+\/src\//u;

/** `path:line directive` for every directive of `text` that disables the T-83 rule. */
const tenantTxDisables = (text: string, path: string): string[] =>
  scanText(text, path)
    .filter((suppression) => suppression.kind === 'eslint-disable' && (suppression.rules.length === 0 || suppression.rules.includes(RULE)))
    .map((suppression) => `${path}:${String(suppression.line)} ${suppression.directive}`);

describe('T-83 disable ratchet (D-ARCH-106 (6), PR32-SEC-01)', () => {
  it.each([
    ['line comment, next-line form', `// eslint-disable-next-line ${RULE} -- TASK-999 reason\nawait fetch(url);\n`],
    ['line comment, same-line form', `await fetch(url); // eslint-disable-line ${RULE}\n`],
    ['block comment, file form', `/* eslint-disable ${RULE} */\nawait fetch(url);\n`],
    ['block comment, next-line form in a rule list', `/* eslint-disable-next-line no-console, ${RULE} -- TASK-999 */\nfetch(url);\n`],
    ['a blanket directive (it disables every rule, T-83 included)', '/* eslint-disable */\nawait fetch(url);\n'],
  ])('[D-ARCH-106] seeded defect is caught: %s', (_title, text) => {
    expect(tenantTxDisables(text, 'apps/api/src/modules/orders/service/seeded.ts')).toHaveLength(1);
  });

  it.each([
    ['another rule', '// eslint-disable-next-line no-console -- TASK-999 reason\nconsole.log(1);\n'],
    ['the directive text inside a string literal', `const text = '// eslint-disable-next-line ${RULE}';\n`],
    ['the directive text inside a template literal', `const text = \`/* eslint-disable ${RULE} */\`;\n`],
  ])('[D-ARCH-106] not a T-83 disable: %s', (_title, text) => {
    expect(tenantTxDisables(text, 'packages/audit/src/store/seeded.ts')).toEqual([]);
  });

  it('[D-ARCH-106] the scope matches apps/*/src and packages/*/src only', () => {
    expect(['apps/api/src/app.ts', 'apps/worker/src/main.ts', 'packages/audit/src/store/x.ts'].every((path) => IN_SCOPE.test(path))).toBe(
      true,
    );
    expect(['apps/api/app.ts', 'tools/lint/x.ts', 'tests/api/x.ts', 'packages/audit/test/x.ts'].some((path) => IN_SCOPE.test(path))).toBe(
      false,
    );
  });

  it('[D-ARCH-106] [PR32-SEC-01] no source file in apps/*/src or packages/*/src disables platform/no-external-calls-in-tenant-tx', () => {
    const root = findRepoRoot();
    // A tracked file deleted in the working tree is skipped (it cannot carry a directive).
    const files = listRepositoryFiles(root).filter(
      (path) => IN_SCOPE.test(path) && /\.[cm]?[jt]sx?$/u.test(path) && existsSync(join(root, path)),
    );
    expect(files.length).toBeGreaterThan(0);
    const found = files.flatMap((path) => tenantTxDisables(readFileSync(join(root, path), 'utf8'), path));
    expect(found).toEqual([]);
  });
});
