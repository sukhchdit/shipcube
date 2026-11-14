// @ts-check
/**
 * `npm run typegen -w prisma`: presence and freshness of the generated Prisma client (D-ARCH-102 (3); TASK-020 part
 * 020-B). Check only: it NEVER runs the Prisma CLI, so nothing generates implicitly. The client is produced by
 * `npm run deps:rebuild` (step 3) or `npm run db:generate`, both through tools/deps/prisma-cli.mjs.
 *
 * Fails (exit 1, one line on stderr ending in "run npm run db:generate") when `prisma/generated/prisma/client.ts` is
 * missing, or older than the newest file of `prisma/schema/` (a schema edit after the last generate). Prisma 7 no
 * longer generates after `migrate dev`, so a stale client is the common case this catches before `tsc -b` reports it
 * as hundreds of type errors.
 *
 * Plain ESM with `node:` builtins only.
 */
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REMEDY = 'run npm run db:generate';

/** The generated entry module whose modification time stands for the whole client. */
export const CLIENT_ENTRY = join('generated', 'prisma', 'client.ts');

/**
 * @typedef {{ ok: true } | { ok: false, reason: 'missing' | 'stale' | 'no-schema', message: string }} CheckResult
 */

/**
 * Newest modification time (ms) of the `.prisma` files directly under `schemaDir`; undefined when there are none.
 * @param {string} schemaDir
 * @returns {number | undefined}
 */
function newestSchemaMtime(schemaDir) {
  if (!existsSync(schemaDir)) return undefined;
  const times = readdirSync(schemaDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && entry.name.endsWith('.prisma'))
    .map((entry) => statSync(join(schemaDir, entry.name)).mtimeMs);
  return times.length === 0 ? undefined : Math.max(...times);
}

/**
 * @param {{ prismaDir: string }} options the `prisma/` workspace directory (holds `schema/` and `generated/`)
 * @returns {CheckResult}
 */
export function checkPrismaClient({ prismaDir }) {
  const schemaTime = newestSchemaMtime(join(prismaDir, 'schema'));
  if (schemaTime === undefined) {
    return { ok: false, reason: 'no-schema', message: 'prisma/schema holds no .prisma file; nothing to check against' };
  }
  const entry = join(prismaDir, CLIENT_ENTRY);
  if (!existsSync(entry)) {
    return { ok: false, reason: 'missing', message: `the generated Prisma client (prisma/generated/prisma) is missing: ${REMEDY}` };
  }
  if (statSync(entry).mtimeMs < schemaTime) {
    return {
      ok: false,
      reason: 'stale',
      message: `the generated Prisma client (prisma/generated/prisma) is older than prisma/schema: ${REMEDY}`,
    };
  }
  return { ok: true };
}

// CLI entry: `node tools/db/check-prisma-client.mjs [prismaDir]` (default: the repository's prisma/; the unit test passes
// fixture directories).
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const result = checkPrismaClient({ prismaDir: process.argv[2] ?? join(import.meta.dirname, '..', '..', 'prisma') });
  if (result.ok) {
    process.stdout.write('[check-prisma-client] generated client present and fresh\n');
  } else {
    process.stderr.write(`[check-prisma-client] ${result.message}\n`);
    process.exitCode = 1;
  }
}
