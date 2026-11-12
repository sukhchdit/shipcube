import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { isPlaceholder, LOCAL_ONLY_PREFIX, type AppEnv } from '@platform/config';
import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { SEED_PASSWORD_VARIABLES, SeedRefusedError } from '../framework/contracts.js';

import { parseAppEnv } from './app-env.js';
import { planDemoCredentials } from './credential-plan.js';

const randomSecret = (): string => randomBytes(16).toString('hex');
const localDefault = (): string => `${LOCAL_ONLY_PREFIX}${randomBytes(8).toString('hex')}`;

type Env = Record<string, string | undefined>;

const realEnv = (): Env => ({ SEED_SUPERADMIN_PASSWORD: randomSecret(), SEED_CUSTOMER_PASSWORD: randomSecret() });
const defaultEnv = (): Env => ({ SEED_SUPERADMIN_PASSWORD: localDefault(), SEED_CUSTOMER_PASSWORD: localDefault() });

function refusal(run: () => unknown): SeedRefusedError {
  try {
    run();
  } catch (error) {
    if (error instanceof SeedRefusedError) return error;
    throw error;
  }
  throw new Error('expected a SeedRefusedError');
}

/** Message, stack, JSON and util.inspect of the error: the places a secret could leak from. */
function renderings(error: Error): string[] {
  return [error.message, error.stack ?? '', JSON.stringify(error), inspect(error, { depth: 6 })];
}

const plan = (appEnv: AppEnv, env: Env, nodeEnv?: string) => planDemoCredentials({ appEnv, nodeEnv, env });

describe('parseAppEnv', () => {
  it.each(['local', 'test', 'staging', 'production'] as const)('accepts %s', (value) => {
    expect(parseAppEnv(value)).toBe(value);
  });

  it.each([undefined, '', 'prod', 'Production', ' local', 'development'])(
    'refuses %p with SEED_ENVIRONMENT_INVALID naming APP_ENV',
    (value) => {
      const error = refusal(() => parseAppEnv(value));
      expect(error.code).toBe('SEED_ENVIRONMENT_INVALID');
      expect(error.subjects).toEqual(['APP_ENV']);
      expect(error.message).toContain('APP_ENV');
    },
  );
});

describe('planDemoCredentials: environment guard', () => {
  it.each(['local', 'test'] as const)('refuses NODE_ENV=production with APP_ENV=%s, naming both variables', (appEnv) => {
    const error = refusal(() => plan(appEnv, realEnv(), 'production'));
    expect(error.code).toBe('SEED_ENVIRONMENT_INVALID');
    expect(error.subjects).toEqual(['NODE_ENV', 'APP_ENV']);
  });

  it('allows NODE_ENV=production with APP_ENV=staging and production', () => {
    expect(plan('staging', {}, 'production')).toEqual({ kind: 'set-password-link' });
    expect(plan('production', {}, 'production')).toEqual({ kind: 'skip', reason: 'production' });
  });
});

describe('planDemoCredentials: production', () => {
  it('[AT-US-049-03] plans a skip when no SEED_* variable is set', () => {
    expect(plan('production', {})).toEqual({ kind: 'skip', reason: 'production' });
  });

  it('treats a variable that is explicitly undefined as absent', () => {
    expect(plan('production', { SEED_SUPERADMIN_PASSWORD: undefined })).toEqual({ kind: 'skip', reason: 'production' });
  });

  it('[AT-US-049-04-3] refuses a local-only default with SEED_DEFAULT_PASSWORD_REFUSED and never echoes it', () => {
    const value = localDefault();
    const error = refusal(() => plan('production', { SEED_SUPERADMIN_PASSWORD: value }));
    expect(error.code).toBe('SEED_DEFAULT_PASSWORD_REFUSED');
    expect(error.subjects).toEqual(['SEED_SUPERADMIN_PASSWORD']);
    expect(error.message).toContain('SEED_SUPERADMIN_PASSWORD');
    for (const rendering of renderings(error)) expect(rendering).not.toContain(value);
  });

  it('refuses any other SEED_* value with SEED_PASSWORD_FORBIDDEN', () => {
    const value = randomSecret();
    const error = refusal(() => plan('production', { SEED_CUSTOMER_PASSWORD: value }));
    expect(error.code).toBe('SEED_PASSWORD_FORBIDDEN');
    expect(error.subjects).toEqual(['SEED_CUSTOMER_PASSWORD']);
    for (const rendering of renderings(error)) expect(rendering).not.toContain(value);
  });

  it('treats an empty string as present and forbidden', () => {
    expect(refusal(() => plan('production', { SEED_CUSTOMER_PASSWORD: '' })).code).toBe('SEED_PASSWORD_FORBIDDEN');
  });
});

describe('planDemoCredentials: staging', () => {
  it('[AT-US-049-09] plans set-password-link and reads no SEED_* value', () => {
    const reads: (string | symbol)[] = [];
    const env = new Proxy<Env>(
      { APP_ENV: 'staging', PATH: '/bin' },
      {
        get(target, property, receiver) {
          reads.push(property);
          return Reflect.get(target, property, receiver) as unknown;
        },
      },
    );
    expect(plan('staging', env)).toEqual({ kind: 'set-password-link' });
    expect(reads.filter((property) => typeof property === 'string' && property.startsWith('SEED_'))).toEqual([]);
  });

  it('[AT-US-049-04-2] refuses a local-only default with SEED_DEFAULT_PASSWORD_REFUSED and never echoes it', () => {
    const value = localDefault();
    const error = refusal(() => plan('staging', { SEED_SUPERADMIN_PASSWORD: value }));
    expect(error.code).toBe('SEED_DEFAULT_PASSWORD_REFUSED');
    expect(error.subjects).toEqual(['SEED_SUPERADMIN_PASSWORD']);
    for (const rendering of renderings(error)) expect(rendering).not.toContain(value);
  });

  it('refuses a non-default SEED_* value with SEED_PASSWORD_FORBIDDEN and lists every offender once', () => {
    const values = [randomSecret(), randomSecret()];
    const error = refusal(() => plan('staging', { SEED_SUPERADMIN_PASSWORD: values[0], SEED_CUSTOMER_PASSWORD: values[1] }));
    expect(error.code).toBe('SEED_PASSWORD_FORBIDDEN');
    expect(error.subjects).toEqual([...SEED_PASSWORD_VARIABLES]);
    for (const value of values) for (const rendering of renderings(error)) expect(rendering).not.toContain(value);
  });

  it('reports a default among forbidden values as SEED_DEFAULT_PASSWORD_REFUSED naming all present variables', () => {
    const error = refusal(() => plan('staging', { SEED_SUPERADMIN_PASSWORD: randomSecret(), SEED_CUSTOMER_PASSWORD: localDefault() }));
    expect(error.code).toBe('SEED_DEFAULT_PASSWORD_REFUSED');
    expect(error.subjects).toEqual([...SEED_PASSWORD_VARIABLES]);
  });
});

describe('planDemoCredentials: test', () => {
  it('[AT-US-049-04-1] refuses local-only defaults with SEED_DEFAULT_PASSWORD_REFUSED naming them and never echoing them', () => {
    const env = defaultEnv();
    const error = refusal(() => plan('test', env));
    expect(error.code).toBe('SEED_DEFAULT_PASSWORD_REFUSED');
    expect(error.subjects).toEqual([...SEED_PASSWORD_VARIABLES]);
    for (const value of Object.values(env)) for (const rendering of renderings(error)) expect(rendering).not.toContain(value ?? '');
  });

  it('[AT-US-049-04-1] refuses a single default superadmin password even when the customer password is real', () => {
    const value = localDefault();
    const error = refusal(() => plan('test', { ...realEnv(), SEED_SUPERADMIN_PASSWORD: value }));
    expect(error.code).toBe('SEED_DEFAULT_PASSWORD_REFUSED');
    expect(error.subjects).toEqual(['SEED_SUPERADMIN_PASSWORD']);
    for (const rendering of renderings(error)) expect(rendering).not.toContain(value);
  });

  it('[AT-US-049-10-2] seeds passwords for non-default values and issues no set-password-link', () => {
    const env = realEnv();
    const result = plan('test', env);
    expect(result.kind).toBe('seeded-passwords');
    if (result.kind !== 'seeded-passwords') throw new Error('unreachable');
    expect(result.passwords.size).toBe(SEED_PASSWORD_VARIABLES.length);
    expect(result.passwords.get('SEED_SUPERADMIN_PASSWORD')?.reveal()).toBe(env['SEED_SUPERADMIN_PASSWORD']);
    expect(result.passwords.get('SEED_CUSTOMER_PASSWORD')?.reveal()).toBe(env['SEED_CUSTOMER_PASSWORD']);
  });

  it('refuses every variable when none is set, listing all of them', () => {
    const error = refusal(() => plan('test', {}));
    expect(error.code).toBe('SEED_VARIABLE_MISSING');
    expect(error.subjects).toEqual([...SEED_PASSWORD_VARIABLES]);
  });
});

describe('planDemoCredentials: local', () => {
  it('[AT-US-049-05] accepts local-only defaults as seeded passwords', () => {
    const env = defaultEnv();
    const result = plan('local', env);
    expect(result.kind).toBe('seeded-passwords');
    if (result.kind !== 'seeded-passwords') throw new Error('unreachable');
    expect(result.passwords.get('SEED_SUPERADMIN_PASSWORD')?.reveal()).toBe(env['SEED_SUPERADMIN_PASSWORD']);
    expect(result.passwords.get('SEED_CUSTOMER_PASSWORD')?.reveal()).toBe(env['SEED_CUSTOMER_PASSWORD']);
  });

  it('[AT-US-049-10-1] seeds passwords for non-default values', () => {
    expect(plan('local', realEnv()).kind).toBe('seeded-passwords');
  });

  it('[AT-US-049-06] refuses a missing SEED_CUSTOMER_PASSWORD with SEED_VARIABLE_MISSING listing it', () => {
    const error = refusal(() => plan('local', { SEED_SUPERADMIN_PASSWORD: localDefault() }));
    expect(error.code).toBe('SEED_VARIABLE_MISSING');
    expect(error.subjects).toEqual(['SEED_CUSTOMER_PASSWORD']);
    expect(error.message).toContain('SEED_CUSTOMER_PASSWORD');
    expect(error.message).not.toContain('SEED_SUPERADMIN_PASSWORD');
  });

  it('lists all missing variables at once, treating an empty string as missing', () => {
    const error = refusal(() => plan('local', { SEED_SUPERADMIN_PASSWORD: '' }));
    expect(error.code).toBe('SEED_VARIABLE_MISSING');
    expect(error.subjects).toEqual([...SEED_PASSWORD_VARIABLES]);
  });

  it.each([['changeme-changeme'], ['REPLACE_ME_REPLACE_ME'], ['postgres://user:placeholder@host/db']])(
    'refuses the placeholder %p without echoing it',
    (placeholder) => {
      expect(isPlaceholder(placeholder)).toBe(true);
      const error = refusal(() => plan('local', { ...realEnv(), SEED_CUSTOMER_PASSWORD: placeholder }));
      expect(error.code).toBe('SEED_DEFAULT_PASSWORD_REFUSED');
      expect(error.subjects).toEqual(['SEED_CUSTOMER_PASSWORD']);
      for (const rendering of renderings(error)) expect(rendering).not.toContain(placeholder);
    },
  );

  it.each([
    ['too short', 11],
    ['too long', 129],
  ])('refuses a password that is %s (length bounds 12-128)', (_label, length) => {
    const value = 'x'.repeat(length - 1) + '9';
    const error = refusal(() => plan('local', { ...realEnv(), SEED_SUPERADMIN_PASSWORD: value }));
    expect(error.code).toBe('SEED_VARIABLE_MISSING');
    expect(error.subjects).toEqual(['SEED_SUPERADMIN_PASSWORD']);
    for (const rendering of renderings(error)) expect(rendering).not.toContain(value);
  });

  it.each([12, 128])('accepts a password of exactly %i characters', (length) => {
    const value = randomBytes(length).toString('hex').slice(0, length);
    expect(plan('local', { ...realEnv(), SEED_SUPERADMIN_PASSWORD: value }).kind).toBe('seeded-passwords');
  });

  it('reports every offender in one error: default/placeholder first, then missing', () => {
    const error = refusal(() => plan('local', { SEED_SUPERADMIN_PASSWORD: 'changeme-changeme' }));
    expect(error.code).toBe('SEED_DEFAULT_PASSWORD_REFUSED');
    expect(error.subjects).toEqual(['SEED_SUPERADMIN_PASSWORD', 'SEED_CUSTOMER_PASSWORD']);
    expect(error.message).toContain('SEED_CUSTOMER_PASSWORD');
  });
});

describe('planDemoCredentials: secrecy', () => {
  const hexPassword = fc
    .string({ unit: fc.constantFrom(...'0123456789abcdef'), minLength: 12, maxLength: 64 })
    .filter((value) => !isPlaceholder(value));

  it('[AT-US-049-07] the plan never renders a password through JSON.stringify or util.inspect', () => {
    fc.assert(
      fc.property(hexPassword, hexPassword, (superadmin, customer) => {
        const result = plan('local', { SEED_SUPERADMIN_PASSWORD: superadmin, SEED_CUSTOMER_PASSWORD: customer });
        expect(result.kind).toBe('seeded-passwords');
        for (const rendering of [JSON.stringify(result), inspect(result, { depth: 8 })]) {
          expect(rendering).not.toContain(superadmin);
          expect(rendering).not.toContain(customer);
        }
      }),
      { numRuns: 50 },
    );
  });
});
