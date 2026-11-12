/**
 * Seed CLI `main` in-process (TASK-023, US-049): every path that ends before or at the database connection. The
 * spawned-process and database-backed paths are in prisma/tests/seed/seed.int.test.ts.
 */
import { randomBytes } from 'node:crypto';
import { createServer, type AddressInfo, type Socket } from 'node:net';

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

  it('reports an unreachable database as exit 2 without echoing the URL', async () => {
    const dbPassword = randomPassword();
    const output = capture();
    await expect(main(['reference'], { APP_ENV: 'local', DATABASE_MIGRATOR_URL: unreachableUrl(dbPassword) }, output)).resolves.toBe(2);
    expect(refusal(output)).toMatchObject({ event: 'seed.failed' });
    expect([...output.lines, ...output.errors].join('\n')).not.toContain(dbPassword);
  });
});

type FakeServerMode =
  { readonly kind: 'drop-on-query' } | { readonly kind: 'reject-password'; readonly message: (password: string) => string };

/**
 * A minimal PostgreSQL wire-protocol server on 127.0.0.1 (startup → AuthenticationOk/ReadyForQuery, or a cleartext
 * password request answered with a FATAL ErrorResponse). Enough to drive the real `pg.Client` into the two failure
 * modes the CLI must survive: a socket dropped while a query is pending (code review m1) and a server error that
 * echoes a secret (n4, PR13-SEC-07).
 */
async function withFakeServer<T>(mode: FakeServerMode, run: (port: number) => Promise<T>): Promise<T> {
  const message = (type: string, body: Buffer): Buffer => {
    const header = Buffer.alloc(5);
    header.write(type, 0, 'latin1');
    header.writeInt32BE(body.length + 4, 1);
    return Buffer.concat([header, body]);
  };
  const int32 = (value: number): Buffer => {
    const buffer = Buffer.alloc(4);
    buffer.writeInt32BE(value);
    return buffer;
  };
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    let started = false;
    socket.on('error', () => undefined);
    socket.on('data', (data) => {
      if (!started) {
        started = true;
        if (mode.kind === 'drop-on-query') {
          socket.write(Buffer.concat([message('R', int32(0)), message('Z', Buffer.from('I', 'latin1'))]));
        } else {
          socket.write(message('R', int32(3)));
        }
        return;
      }
      if (mode.kind === 'drop-on-query') {
        socket.destroy();
        return;
      }
      // PasswordMessage: 'p', Int32 length, password, NUL.
      const password = data.subarray(5, data.indexOf(0, 5)).toString('utf8');
      const fields = Buffer.from(`SFATAL\0C28P01\0M${mode.message(password)}\0\0`, 'utf8');
      socket.end(message('E', fields));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    return await run((server.address() as AddressInfo).port);
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

const fakeServerUrl = (password: string, port: number): string =>
  `postgresql://platform_migrator:${password}@127.0.0.1:${String(port)}/platform`;

describe('seed CLI main: hardening (code review PR #13 m1-m3, PR13-SEC-01..03, n4)', () => {
  it.each([
    ['DATABASE_MIGRATOR_URL_FILE alone', { DATABASE_MIGRATOR_URL_FILE: '/run/secrets/never-opened' }, ['DATABASE_MIGRATOR_URL_FILE']],
    [
      'DATABASE_MIGRATOR_URL_FILE next to the URL',
      { DATABASE_MIGRATOR_URL_FILE: '/run/secrets/never-opened', DATABASE_MIGRATOR_URL: unreachableUrl(randomPassword()) },
      ['DATABASE_MIGRATOR_URL_FILE'],
    ],
    ['a SEED_*_FILE variant', { SEED_SUPERADMIN_PASSWORD_FILE: '/run/secrets/never-opened' }, ['SEED_SUPERADMIN_PASSWORD_FILE']],
  ])('refuses %s with exit 1 before reading any file, naming the variable only', async (_label, extra, subjects) => {
    const output = capture();
    await expect(main(['reference'], { APP_ENV: 'local', ...extra }, output)).resolves.toBe(1);
    expect(refusal(output)).toMatchObject({ code: 'SEED_ENVIRONMENT_INVALID', subjects });
    expect(output.errors.join('\n')).not.toContain('never-opened');
  });

  it.each(['ECS_CONTAINER_METADATA_URI', 'ECS_CONTAINER_METADATA_URI_V4'])(
    'refuses APP_ENV=local with local-only defaults on an ECS task (%s set) before connecting (PR13-SEC-02)',
    async (signal) => {
      const output = capture();
      const env = {
        APP_ENV: 'local',
        [signal]: 'http://169.254.170.2/v4/task',
        SEED_SUPERADMIN_PASSWORD: randomPassword('local-only-'),
        SEED_CUSTOMER_PASSWORD: randomPassword('local-only-'),
        // Unreachable: a guard that ran after connecting would exit 2 (ECONNREFUSED) instead of 1.
        DATABASE_MIGRATOR_URL: unreachableUrl(randomPassword()),
      };
      await expect(main(['demo'], env, output)).resolves.toBe(1);
      expect(refusal(output)).toMatchObject({ code: 'SEED_ENVIRONMENT_INVALID', subjects: ['APP_ENV', signal] });
      expect(output.lines).toEqual([]);
    },
  );

  it.each(['options=-c%20search_path%3Dpublic', 'statement_timeout=0', 'host=/tmp', 'hostaddr=10.0.0.1'])(
    'refuses a URL carrying %s with exit 1, never printing the URL or its password',
    async (query) => {
      const output = capture();
      const password = randomPassword();
      const env = { APP_ENV: 'local', DATABASE_MIGRATOR_URL: `${unreachableUrl(password)}?${query}` };
      await expect(main(['reference'], env, output)).resolves.toBe(1);
      expect(refusal(output)).toMatchObject({ code: 'SEED_ENVIRONMENT_INVALID', subjects: ['DATABASE_MIGRATOR_URL'] });
      expect([...output.lines, ...output.errors].join('\n')).not.toContain(password);
    },
  );

  it('a connection dropped while a query is pending exits 2 with one JSON seed.failed line, not a crash (m1)', async () => {
    const output = capture();
    const password = randomPassword();
    const status = await withFakeServer({ kind: 'drop-on-query' }, (port) =>
      main(['reference'], { APP_ENV: 'local', DATABASE_MIGRATOR_URL: fakeServerUrl(password, port) }, output),
    );
    expect(status).toBe(2);
    expect(output.errors).toHaveLength(1);
    expect(refusal(output)).toMatchObject({ level: 'error', event: 'seed.failed' });
    expect(output.errors[0]).not.toContain('    at ');
    expect(output.errors[0]).not.toContain(password);
  });

  it('redacts the decoded URL password and the SEED_* values from a server error that echoes them (n4)', async () => {
    const output = capture();
    const superadmin = randomPassword();
    const customer = randomPassword();
    const raw = `${randomPassword()}%40x`;
    const decoded = decodeURIComponent(raw);
    const env = { APP_ENV: 'local', SEED_SUPERADMIN_PASSWORD: superadmin, SEED_CUSTOMER_PASSWORD: customer };
    const status = await withFakeServer(
      { kind: 'reject-password', message: (password) => `password ${password} rejected; seed ${superadmin} / ${customer}` },
      (port) => main(['demo'], { ...env, DATABASE_MIGRATOR_URL: fakeServerUrl(raw, port) }, output),
    );
    expect(status).toBe(2);
    const printed = [...output.lines, ...output.errors].join('\n');
    expect(printed).toContain('[redacted]');
    for (const secret of [raw, decoded, superadmin, customer]) expect(printed).not.toContain(secret);
  });
});
