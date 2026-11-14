/**
 * Presence and freshness check of the generated Prisma client (tools/db/check-prisma-client.mjs; D-ARCH-102 (3),
 * TASK-020 part 020-B): the `typegen` script of the prisma workspace. Fixture `prisma/` directories in a temporary
 * folder; the CLI runs in a child process. The check never generates: no fixture ever gains a client.
 */
import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterAll, describe, expect, it } from '@jest/globals';

import { findRepoRoot, runNode } from '../test-support/process.js';
import { CLIENT_ENTRY, checkPrismaClient, REMEDY } from './check-prisma-client.mjs';

const work = mkdtempSync(join(tmpdir(), 'check-prisma-client-'));
afterAll(() => rmSync(work, { recursive: true, force: true }));

const SCRIPT = join(findRepoRoot(), 'tools', 'db', 'check-prisma-client.mjs');
const OLD = new Date('2026-01-01T00:00:00Z');
const NEW = new Date('2026-06-01T00:00:00Z');

let counter = 0;
/** A fixture prisma/ directory: schema files with `schemaTime`, and the client entry with `clientTime` (or none). */
function fixture({
  schemaTime,
  clientTime,
  schemaFiles = ['_base.prisma', 'authz.prisma'],
}: {
  schemaTime?: Date;
  clientTime?: Date;
  schemaFiles?: string[];
}): string {
  counter += 1;
  const dir = join(work, `prisma-${String(counter)}`);
  mkdirSync(join(dir, 'schema'), { recursive: true });
  for (const name of schemaFiles) {
    const path = join(dir, 'schema', name);
    writeFileSync(path, '// schema\n');
    if (schemaTime !== undefined) utimesSync(path, schemaTime, schemaTime);
  }
  if (clientTime !== undefined) {
    const entry = join(dir, CLIENT_ENTRY);
    mkdirSync(join(entry, '..'), { recursive: true });
    writeFileSync(entry, '// client\n');
    utimesSync(entry, clientTime, clientTime);
  }
  return dir;
}

describe('check-prisma-client (D-ARCH-102 (3): presence and freshness, never generates)', () => {
  it('passes when the client is newer than every schema file', () => {
    expect(checkPrismaClient({ prismaDir: fixture({ schemaTime: OLD, clientTime: NEW }) })).toEqual({ ok: true });
  });

  it('passes when the client and the newest schema file have the same modification time', () => {
    expect(checkPrismaClient({ prismaDir: fixture({ schemaTime: NEW, clientTime: NEW }) })).toEqual({ ok: true });
  });

  it('fails with "run npm run db:generate" when prisma/generated is missing', () => {
    const result = checkPrismaClient({ prismaDir: fixture({ schemaTime: OLD }) });
    expect(result).toMatchObject({ ok: false, reason: 'missing' });
    expect(result.ok ? '' : result.message).toContain(REMEDY);
  });

  it('fails with "run npm run db:generate" when ONE schema file is newer than the client (schema edited after generate)', () => {
    const dir = fixture({ schemaTime: OLD, clientTime: OLD });
    const edited = join(dir, 'schema', 'authz.prisma');
    utimesSync(edited, NEW, NEW);
    const result = checkPrismaClient({ prismaDir: dir });
    expect(result).toMatchObject({ ok: false, reason: 'stale' });
    expect(result.ok ? '' : result.message).toContain(REMEDY);
  });

  it('ignores non-.prisma files in prisma/schema (a newer README does not make the client stale)', () => {
    const dir = fixture({ schemaTime: OLD, clientTime: OLD });
    const readme = join(dir, 'schema', 'README.md');
    writeFileSync(readme, 'notes\n');
    utimesSync(readme, NEW, NEW);
    expect(checkPrismaClient({ prismaDir: dir })).toEqual({ ok: true });
  });

  it('fails when prisma/schema holds no .prisma file or does not exist', () => {
    expect(checkPrismaClient({ prismaDir: fixture({ clientTime: NEW, schemaFiles: [] }) })).toMatchObject({
      ok: false,
      reason: 'no-schema',
    });
    expect(checkPrismaClient({ prismaDir: join(work, 'absent') })).toMatchObject({ ok: false, reason: 'no-schema' });
  });

  it('CLI: exit 1 and the remedy on stderr for a missing client; exit 0 for a fresh one; nothing is generated', () => {
    const missing = fixture({ schemaTime: OLD });
    const failed = runNode([SCRIPT, missing], { cwd: work });
    expect(failed.status).toBe(1);
    expect(failed.stderr).toContain(`[check-prisma-client] the generated Prisma client (prisma/generated/prisma) is missing: ${REMEDY}`);
    expect(checkPrismaClient({ prismaDir: missing })).toMatchObject({ reason: 'missing' });

    const fresh = runNode([SCRIPT, fixture({ schemaTime: OLD, clientTime: NEW })], { cwd: work });
    expect(fresh.status).toBe(0);
    expect(fresh.stdout).toContain('generated client present and fresh');
  });
});
