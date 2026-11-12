/**
 * Seed CLI `main` in-process (TASK-023, US-049): every path that ends before or at the database connection. The
 * spawned-process and database-backed paths are in prisma/tests/seed/seed.int.test.ts.
 */
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { main, type Output } from './index.js';

interface Captured extends Output {
  readonly lines: string[];
  readonly errors: string[];
}

function capture(): Captured {
  const lines: string[] = [];
  const errors: string[] = [];
  return { lines, errors, out: (line) => lines.push(line), err: (line) => errors.push(line) };
}

const randomPassword = (prefix = ''): string => `${prefix}${randomBytes(18).toString('base64url')}`;

/** A URL on a port nothing listens on, carrying a random password that must never be echoed. */
const unreachableUrl = (password: string): string => `postgresql://platform_migrator:${password}@127.0.0.1:1/platform`;

const refusal = (output: Captured): unknown => JSON.parse(output.errors.at(-1) ?? '{}');

describe('seed CLI main (US-049)', () => {
  it('rejects an unknown command with exit 2 and a usage line', async () => {
    const output = capture();
    await expect(main(['everything'], {}, output)).resolves.toBe(2);
    expect(refusal(output)).toMatchObject({ event: 'seed.usage' });
  });

  it('refuses a missing APP_ENV before reading any other variable (exit 1)', async () => {
    const output = capture();
    await expect(main(['reference'], {}, output)).resolves.toBe(1);
    expect(refusal(output)).toMatchObject({ event: 'seed.refused', code: 'SEED_ENVIRONMENT_INVALID', subjects: ['APP_ENV'] });
  });

  it('[AT-US-049-04-2] refuses a local-only default in staging before connecting, naming only the variable', async () => {
    const output = capture();
    const seedPassword = randomPassword('local-only-');
    const dbPassword = randomPassword();
    const env = {
      APP_ENV: 'staging',
      NODE_ENV: 'production',
      SEED_SUPERADMIN_PASSWORD: seedPassword,
      DATABASE_MIGRATOR_URL: unreachableUrl(dbPassword),
    };
    await expect(main(['demo'], env, output)).resolves.toBe(1);
    expect(refusal(output)).toMatchObject({ code: 'SEED_DEFAULT_PASSWORD_REFUSED', subjects: ['SEED_SUPERADMIN_PASSWORD'] });
    const printed = [...output.lines, ...output.errors].join('\n');
    expect(printed).not.toContain(seedPassword);
    expect(printed).not.toContain(dbPassword);
  });

  it('refuses a missing DATABASE_MIGRATOR_URL naming it (exit 1)', async () => {
    const output = capture();
    await expect(main(['reference'], { APP_ENV: 'local' }, output)).resolves.toBe(1);
    expect(refusal(output)).toMatchObject({ code: 'SEED_VARIABLE_MISSING', subjects: ['DATABASE_MIGRATOR_URL'] });
  });

  it('reads DATABASE_MIGRATOR_URL_FILE and reports an unreachable database as exit 2 without echoing the URL', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'seed-cli-'));
    try {
      const dbPassword = randomPassword();
      const file = join(dir, 'migrator-url');
      writeFileSync(file, `${unreachableUrl(dbPassword)}\n`);
      const output = capture();
      await expect(main(['reference'], { APP_ENV: 'local', DATABASE_MIGRATOR_URL_FILE: file }, output)).resolves.toBe(2);
      expect(refusal(output)).toMatchObject({ event: 'seed.failed' });
      expect([...output.lines, ...output.errors].join('\n')).not.toContain(dbPassword);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
