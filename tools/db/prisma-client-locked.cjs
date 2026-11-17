'use strict';
/**
 * Jest moduleNameMapper target of `@platform/prisma/client` in every project (jest.config.ts; TASK-288 = TASK-W0-FLAKE-2,
 * D-ORCH-083, D-ORCH-098 residual). Loads the generated client (the `@platform/source` target of the package export)
 * under the prisma-tree READ lock, so a suite that imports it statically, directly or through apps/api, waits while
 * `deps:rebuild` or `prisma generate` rewrites prisma/generated instead of loading a half-written tree. CommonJS because
 * module loading is synchronous; the lock is held for the load only. It lives in tools/db because only tools/db, prisma/
 * and tests may hold the generated client as a value (D-ARCH-103). Test-only: no production path resolves this file.
 */
const { PRISMA_TREE_LOCK, withReadLockSync } = require('../test-support/fs-lock.ts');

module.exports = withReadLockSync(PRISMA_TREE_LOCK, () => require('../../prisma/generated/prisma/client.ts'));
