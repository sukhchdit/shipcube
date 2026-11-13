import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { isPlaceholder, Secret } from '@platform/config';
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import type {
  DemoCredential,
  DemoCredentialPlan,
  DemoSeedOptions,
  DemoUserProvisioner,
  DemoUserSpec,
  SeedLogger,
} from '../framework/contracts.js';

import { planDemoCredentials } from './credential-plan.js';
import { DEFERRED_PROVISIONER } from './deferred-provisioner.js';
import { runDemoSeed } from './run-demo-seed.js';
import { DEMO_USERS } from './users.js';

const randomSecret = (): string => randomBytes(16).toString('hex');

interface LogCall {
  readonly level: 'info' | 'warn';
  readonly event: string;
  readonly fields: Readonly<Record<string, string | number | boolean>> | undefined;
}

function capturingLogger(): { logger: SeedLogger; calls: LogCall[] } {
  const calls: LogCall[] = [];
  const logger: SeedLogger = {
    info: (event, fields) => calls.push({ level: 'info', event, fields }),
    warn: (event, fields) => calls.push({ level: 'warn', event, fields }),
  };
  return { logger, calls };
}

interface Ensured {
  readonly spec: DemoUserSpec;
  readonly credential: DemoCredential;
}

function recordingProvisioner(outcomes: (spec: DemoUserSpec, index: number) => 'created' | 'unchanged' | 'deferred' = () => 'created'): {
  provisioner: DemoUserProvisioner;
  ensured: Ensured[];
} {
  const ensured: Ensured[] = [];
  const provisioner: DemoUserProvisioner = {
    ensureUser: (spec, credential) => {
      ensured.push({ spec, credential });
      return Promise.resolve(outcomes(spec, ensured.length - 1));
    },
  };
  return { provisioner, ensured };
}

const options = (provisioner: DemoUserProvisioner, logger: SeedLogger, appEnv: DemoSeedOptions['appEnv'] = 'local'): DemoSeedOptions => ({
  appEnv,
  users: DEMO_USERS,
  provisioner,
  logger,
});

const seededPlan = (superadmin: string, customer: string): DemoCredentialPlan =>
  planDemoCredentials({
    appEnv: 'local',
    nodeEnv: 'development',
    env: { SEED_SUPERADMIN_PASSWORD: superadmin, SEED_CUSTOMER_PASSWORD: customer },
  });

describe('DEMO_USERS (data-model §9.3)', () => {
  it('lists 8 operator staff, 5 Acme users and 1 individual with unique synthetic addresses', () => {
    expect(DEMO_USERS).toHaveLength(14);
    expect(new Set(DEMO_USERS.map((user) => user.email)).size).toBe(14);
    expect(DEMO_USERS.every((user) => user.email.endsWith('.example'))).toBe(true);
    const staff = DEMO_USERS.filter((user) => user.kind === 'staff');
    expect(staff.map((user) => user.email)).toEqual(
      ['superadmin', 'admin', 'operations', 'finance', 'support', 'sales', 'auditor', 'content'].map((part) => `${part}@operator.example`),
    );
    expect(staff.every((user) => user.passwordVariable === 'SEED_SUPERADMIN_PASSWORD')).toBe(true);
    const customers = DEMO_USERS.filter((user) => user.kind === 'customer');
    expect(customers.map((user) => user.email)).toEqual([
      'owner@acme-exports.example',
      'admin@acme-exports.example',
      'shipper@acme-exports.example',
      'finance@acme-exports.example',
      'viewer@acme-exports.example',
      'individual@customer.example',
    ]);
    expect(customers.every((user) => user.passwordVariable === 'SEED_CUSTOMER_PASSWORD')).toBe(true);
  });
});

describe('runDemoSeed', () => {
  it('[AT-US-049-03] production plan: logs demo.skipped and makes no provisioner call', async () => {
    const { logger, calls } = capturingLogger();
    const { provisioner, ensured } = recordingProvisioner();
    const plan = planDemoCredentials({ appEnv: 'production', nodeEnv: 'production', env: {} });

    const summary = await runDemoSeed(options(provisioner, logger, 'production'), plan);

    expect(summary).toEqual({ created: 0, unchanged: 0, deferred: 0, skipped: true });
    expect(ensured).toEqual([]);
    expect(calls).toEqual([{ level: 'info', event: 'demo.skipped', fields: { reason: 'production' } }]);
  });

  it('[AT-US-049-05] local plan: ensures every demo user with the matching Secret', async () => {
    const superadmin = `local-only-${randomSecret()}`;
    const customer = `local-only-${randomSecret()}`;
    const { logger } = capturingLogger();
    const { provisioner, ensured } = recordingProvisioner();

    const summary = await runDemoSeed(options(provisioner, logger), seededPlan(superadmin, customer));

    expect(summary).toEqual({ created: DEMO_USERS.length, unchanged: 0, deferred: 0, skipped: false });
    expect(ensured.map((entry) => entry.spec)).toEqual(DEMO_USERS);
    for (const { spec, credential } of ensured) {
      expect(credential.kind).toBe('password');
      if (credential.kind !== 'password') throw new Error('unreachable');
      expect(credential.password).toBeInstanceOf(Secret);
      expect(credential.password.reveal()).toBe(spec.passwordVariable === 'SEED_SUPERADMIN_PASSWORD' ? superadmin : customer);
    }
  });

  it('[AT-US-049-09] staging plan: every user receives a set-password-link and no SEED_* value is read', async () => {
    const reads: (string | symbol)[] = [];
    const env = new Proxy<Record<string, string | undefined>>(
      { APP_ENV: 'staging' },
      {
        get(target, property, receiver) {
          reads.push(property);
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    const plan = planDemoCredentials({ appEnv: 'staging', nodeEnv: 'production', env });
    const { logger } = capturingLogger();
    const { provisioner, ensured } = recordingProvisioner();

    await runDemoSeed(options(provisioner, logger, 'staging'), plan);

    expect(ensured).toHaveLength(DEMO_USERS.length);
    expect(ensured.every((entry) => entry.credential.kind === 'set-password-link')).toBe(true);
    expect(reads.filter((property) => typeof property === 'string' && property.startsWith('SEED_'))).toEqual([]);
  });

  it.each(['local', 'test'] as const)(
    '[AT-US-049-10] %s with every SEED_* set: password credentials only, no set-password-link',
    async (appEnv) => {
      const plan = planDemoCredentials({
        appEnv,
        nodeEnv: 'test',
        env: { SEED_SUPERADMIN_PASSWORD: randomSecret(), SEED_CUSTOMER_PASSWORD: randomSecret() },
      });
      const { logger } = capturingLogger();
      const { provisioner, ensured } = recordingProvisioner();

      await runDemoSeed(options(provisioner, logger, appEnv), plan);

      expect(ensured).toHaveLength(DEMO_USERS.length);
      expect(ensured.filter((entry) => entry.credential.kind === 'set-password-link')).toEqual([]);
      expect(ensured.every((entry) => entry.credential.kind === 'password')).toBe(true);
    },
  );

  it('calls the provisioner sequentially, in order', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const order: string[] = [];
    const provisioner: DemoUserProvisioner = {
      async ensureUser(spec) {
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        await Promise.resolve();
        order.push(spec.email);
        inFlight -= 1;
        return 'unchanged';
      },
    };
    const { logger } = capturingLogger();
    await runDemoSeed(options(provisioner, logger, 'staging'), { kind: 'set-password-link' });
    expect(maxInFlight).toBe(1);
    expect(order).toEqual(DEMO_USERS.map((user) => user.email));
  });

  it('logs one demo.user event per user and a summary counting each outcome', async () => {
    const { logger, calls } = capturingLogger();
    const outcomes = ['created', 'unchanged', 'deferred'] as const;
    const { provisioner } = recordingProvisioner((_spec, index) => outcomes[index % 3] ?? 'created');

    const summary = await runDemoSeed(options(provisioner, logger, 'staging'), { kind: 'set-password-link' });

    const userEvents = calls.filter((call) => call.event === 'demo.user');
    expect(userEvents).toHaveLength(DEMO_USERS.length);
    expect(userEvents[0]?.fields).toEqual({ email: DEMO_USERS[0]?.email, outcome: 'created' });
    expect(userEvents[1]?.fields).toEqual({ email: DEMO_USERS[1]?.email, outcome: 'unchanged' });
    expect(userEvents[2]?.fields).toEqual({ email: DEMO_USERS[2]?.email, outcome: 'deferred' });
    expect(summary.created + summary.unchanged + summary.deferred).toBe(DEMO_USERS.length);
    expect(summary).toEqual({ created: 5, unchanged: 5, deferred: 4, skipped: false });
    expect(calls.at(-1)).toEqual({
      level: 'info',
      event: 'demo.completed',
      fields: { appEnv: 'staging', credential: 'set-password-link', users: 14, created: 5, unchanged: 5, deferred: 4 },
    });
  });

  it('throws a programming error naming the variable when the plan lacks a password', async () => {
    const { logger } = capturingLogger();
    const { provisioner, ensured } = recordingProvisioner();
    const empty: DemoCredentialPlan = { kind: 'seeded-passwords', passwords: new Map() };
    await expect(runDemoSeed(options(provisioner, logger), empty)).rejects.toThrow('SEED_SUPERADMIN_PASSWORD');
    expect(ensured).toEqual([]);
  });

  it('propagates a provisioner failure and stops', async () => {
    const { logger } = capturingLogger();
    let calls = 0;
    const provisioner: DemoUserProvisioner = {
      ensureUser: () => {
        calls += 1;
        return Promise.reject(new Error('identity unavailable'));
      },
    };
    await expect(runDemoSeed(options(provisioner, logger, 'staging'), { kind: 'set-password-link' })).rejects.toThrow(
      'identity unavailable',
    );
    expect(calls).toBe(1);
  });

  it('[AT-US-049-07] no logger call, summary or plan renders a password (property over arbitrary passwords)', async () => {
    const hexPassword = fc
      .string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 12, maxLength: 64 })
      .filter((value) => !isPlaceholder(value));
    await fc.assert(
      fc.asyncProperty(hexPassword, hexPassword, async (superadmin, customer) => {
        const plan = seededPlan(superadmin, customer);
        const { logger, calls } = capturingLogger();
        const { provisioner } = recordingProvisioner();

        const summary = await runDemoSeed(options(provisioner, logger), plan);

        const rendered = [
          JSON.stringify(calls),
          inspect(calls, { depth: 8 }),
          JSON.stringify(summary),
          JSON.stringify(plan),
          inspect(plan, { depth: 8 }),
        ];
        for (const rendering of rendered) {
          expect(rendering).not.toContain(superadmin);
          expect(rendering).not.toContain(customer);
        }
      }),
      { numRuns: 25 },
    );
  });
});

describe('DEFERRED_PROVISIONER', () => {
  it('reports every user as deferred and writes nothing', async () => {
    const { logger } = capturingLogger();
    const plan = { kind: 'set-password-link' } as const;

    const summary = await runDemoSeed(options(DEFERRED_PROVISIONER, logger, 'staging'), plan);

    expect(summary).toEqual({ created: 0, unchanged: 0, deferred: DEMO_USERS.length, skipped: false });
    await expect(DEFERRED_PROVISIONER.ensureUser(DEMO_USERS[0] as DemoUserSpec, { kind: 'set-password-link' })).resolves.toBe('deferred');
  });
});
