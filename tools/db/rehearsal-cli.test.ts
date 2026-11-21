/**
 * Shared command-line pieces of the rehearsal tools (TASK-034): flags, the local-only database URL rule and the
 * artefact folder.
 */
import { join } from 'node:path';

import { describe, expect, it, jest } from '@jest/globals';
import type pg from 'pg';

import { REPO_ROOT } from './lint-migrations.js';
import { RehearsalError } from './rehearsal-manifest.js';
import { defaultRunDir, integerFlag, localDatabaseUrl, messageOf, parseFlags, pgSession, utcStamp, withDatabase } from './rehearsal-cli.js';

const SPEC = { values: ['out', 'rate'], switches: ['keep'] };

describe('parseFlags', () => {
  it('reads --name value, --name=value and switches', () => {
    const flags = parseFlags(['--out', 'a', '--rate=5', '--keep'], SPEC);
    expect([...flags.values]).toEqual([
      ['out', 'a'],
      ['rate', '5'],
    ]);
    expect(flags.switches.has('keep')).toBe(true);
  });

  it('refuses positional arguments, unknown and repeated flags and missing values', () => {
    expect(() => parseFlags(['a'], SPEC)).toThrow(/unexpected argument at position 1/);
    expect(() => parseFlags(['--nope'], SPEC)).toThrow(/unknown flag --nope/);
    expect(() => parseFlags(['--out', 'a', '--out', 'b'], SPEC)).toThrow(/--out is given twice/);
    expect(() => parseFlags(['--out'], SPEC)).toThrow(/--out needs a value/);
    expect(() => parseFlags(['--out', '--keep'], SPEC)).toThrow(/--out needs a value/);
    expect(() => parseFlags(['--out='], SPEC)).toThrow(/--out needs a value/);
    expect(() => parseFlags(['--keep=yes'], SPEC)).toThrow(/unknown flag --keep/);
  });

  it('bounds integer flags', () => {
    const flags = parseFlags(['--rate', '50'], SPEC);
    expect(integerFlag(flags, 'rate', 20, 1, 100)).toBe(50);
    expect(integerFlag(parseFlags([], SPEC), 'rate', 20, 1, 100)).toBe(20);
    for (const raw of ['0', '101', '1.5', '-3', 'x']) {
      expect(() => integerFlag(parseFlags([`--rate=${raw}`], SPEC), 'rate', 20, 1, 100)).toThrow(/--rate must be an integer from 1 to 100/);
    }
  });
});

describe('localDatabaseUrl (nothing runs against a shared environment)', () => {
  it('accepts a loopback URL and returns the endpoint and the decoded user', () => {
    const local = localDatabaseUrl({ V: 'postgresql://post%67res@127.0.0.1:5433/platform' }, 'V');
    expect(local.endpoint).toEqual({ host: '127.0.0.1', port: '5433', database: 'platform' });
    expect(local.user).toBe('postgres');
    expect(localDatabaseUrl({ V: 'postgresql://localhost/platform' }, 'V').user).toBe('');
  });

  it('refuses an unset variable, a remote host and a database name that is not plain, without echoing the value', () => {
    const remote = 'postgresql://u@db.example.com/platform';
    expect(() => localDatabaseUrl({}, 'V')).toThrow(/^V is not set$/);
    expect(() => localDatabaseUrl({ V: '' }, 'V')).toThrow(/^V is not set$/);
    expect(() => localDatabaseUrl({ V: remote }, 'V')).toThrow(/^V must name a loopback host or a Unix socket/);
    expect(() => localDatabaseUrl({ V: 'postgresql://u@localhost/Platform-1' }, 'V')).toThrow(/^V must name a plain lower-case database/);
    try {
      localDatabaseUrl({ V: remote }, 'V');
    } catch (error) {
      expect(error).toBeInstanceOf(RehearsalError);
      expect((error as Error).message).not.toContain('example.com');
    }
  });

  it('replaces the database of a URL and keeps its query', () => {
    expect(withDatabase('postgresql://u:p@127.0.0.1:5432/platform?sslmode=disable', 'rehearsal_x')).toBe(
      'postgresql://u:p@127.0.0.1:5432/rehearsal_x?sslmode=disable',
    );
    expect(() => withDatabase('postgresql://u@127.0.0.1/platform', '../x')).toThrow(RehearsalError);
  });
});

describe('artefacts and sessions', () => {
  it('stamps run folders under the git-ignored reports/rehearsal', () => {
    const date = new Date('2026-11-21T10:15:00.123Z');
    expect(utcStamp(date)).toBe('20261121T101500Z');
    expect(defaultRunDir('backup', date)).toBe(join(REPO_ROOT, 'reports', 'rehearsal', '20261121T101500Z-backup'));
  });

  it('wraps a client (end) and a pool client (release), returning rows only', async () => {
    const client = {
      query: jest.fn<(sql: string, params?: unknown[]) => Promise<{ rows: object[] }>>(() => Promise.resolve({ rows: [{ a: 1 }] })),
      end: jest.fn(() => Promise.resolve()),
    };
    const session = pgSession(client as unknown as pg.Client);
    expect(await session.query('SELECT $1', [1])).toEqual([{ a: 1 }]);
    expect(client.query).toHaveBeenCalledWith('SELECT $1', [1]);
    await session.query('SELECT 1');
    expect(client.query).toHaveBeenLastCalledWith('SELECT 1', undefined);
    await session.end();
    expect(client.end).toHaveBeenCalled();
    const pooled = { query: jest.fn(() => Promise.resolve({ rows: [] })), release: jest.fn() };
    await pgSession(pooled as unknown as pg.PoolClient).end();
    expect(pooled.release).toHaveBeenCalled();
  });

  it('reports any thrown value as one line', () => {
    expect(messageOf(new Error('x'))).toBe('x');
    expect(messageOf('y')).toBe('y');
  });
});
