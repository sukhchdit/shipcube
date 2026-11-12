import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { parseDurationSeconds, SECONDS_PER_UNIT } from './durations.js';
import { deepFreeze, pickConfigured } from './env-input.js';
import { isHardenedAppEnv, isLocalAppEnv } from './environment.js';
import { ConfigValidationError, formatConfigError, normaliseIssues } from './errors.js';
import { GUARDS, runGuards } from './guards.js';
import { ENV_EXAMPLE_PLACEHOLDER, isPlaceholder, LOCAL_ONLY_PREFIX } from './placeholders.js';
import { CONFIG_KEY_NAMES, describeConfigKeys, requiredKeysFor, SECRET_KEY_NAMES } from './schema.js';
import { Secret } from './secret.js';

describe('durations', () => {
  it('property: <n><unit> parses to n × unit seconds', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 999_999_999 }),
        fc.constantFrom('s', 'm', 'h', 'd') as fc.Arbitrary<keyof typeof SECONDS_PER_UNIT>,
        (n, unit) => {
          expect(parseDurationSeconds(`${n}${unit}`)).toBe(n * SECONDS_PER_UNIT[unit]);
        },
      ),
    );
  });

  it.each(['', '0d', '15', 'm', '1w', '1.5h', ' 1h', '-1d', '01h'])('rejects %p', (value) => {
    expect(parseDurationSeconds(value)).toBeUndefined();
  });
});

describe('placeholders (SEC-TC-51)', () => {
  it.each([
    ENV_EXAMPLE_PLACEHOLDER,
    'changeme',
    'Change-Me',
    'replace_me',
    '<stripe-key>',
    'PLACEHOLDER',
    `${LOCAL_ONLY_PREFIX}redis`,
    'xxx',
    '***',
    'TODO',
    'password',
  ])('detects %p', (value) => {
    expect(isPlaceholder(value)).toBe(true);
  });

  it.each(['Test Brand', 'no-reply@shipping.test', 'postgresql://platform_app@db:5432/platform', 'staging', 'Shipqube'])(
    'accepts %p',
    (value) => {
      expect(isPlaceholder(value)).toBe(false);
    },
  );

  it('property: random base64 key material is not mistaken for a placeholder', () => {
    fc.assert(
      fc.property(fc.uint8Array({ minLength: 32, maxLength: 64 }), (bytes) => {
        expect(isPlaceholder(Buffer.from(bytes).toString('base64'))).toBe(false);
      }),
    );
  });
});

describe('environment helpers', () => {
  it('classifies environments', () => {
    expect([isLocalAppEnv('local'), isLocalAppEnv('test'), isLocalAppEnv('staging'), isLocalAppEnv(undefined)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
    expect([isHardenedAppEnv('staging'), isHardenedAppEnv('production'), isHardenedAppEnv('test'), isHardenedAppEnv(undefined)]).toEqual([
      true,
      true,
      false,
      false,
    ]);
  });

  it('pickConfigured keeps named, non-empty values only', () => {
    expect(pickConfigured({ A: 'a', B: '', C: undefined, D: 'd' }, ['A', 'B', 'C'])).toEqual({ A: 'a' });
  });

  it('deepFreeze freezes plain containers and leaves class instances and typed arrays alone', () => {
    const bytes = new Uint8Array([1, 2]);
    const value = deepFreeze({ list: [{ n: 1 }], secret: new Secret(bytes), bytes });
    expect(Object.isFrozen(value.list[0])).toBe(true);
    expect(Object.isFrozen(value.bytes)).toBe(false);
    expect(value.secret.reveal()).toBe(bytes);
  });
});

describe('errors', () => {
  it('sorts and de-duplicates issues and lists each key once', () => {
    const error = new ConfigValidationError([
      { key: 'B', code: 'invalid', rule: 'x' },
      { key: 'A', code: 'missing' },
      { key: 'B', code: 'invalid', rule: 'x' },
      { key: 'B', code: 'placeholder' },
      { key: 'B', code: 'invalid', rule: 'a' },
    ]);
    expect(error.keys).toEqual(['A', 'B']);
    expect(error.issues.map((issue) => `${issue.key}:${issue.code}:${issue.rule ?? ''}`)).toEqual([
      'A:missing:',
      'B:invalid:a',
      'B:invalid:x',
      'B:placeholder:',
    ]);
    expect(error.name).toBe('ConfigValidationError');
    expect(error.message).toBe('Configuration rejected for 2 key(s): A (missing), B (invalid: a), B (invalid: x), B (placeholder)');
    expect(formatConfigError(error)).toContain('  - B: placeholder');
    expect(normaliseIssues([])).toEqual([]);
  });
});

describe('schema metadata', () => {
  it('documents every key and flags secrets', () => {
    const keys = describeConfigKeys();
    expect(keys.map((key) => key.name)).toEqual(CONFIG_KEY_NAMES);
    for (const key of keys) expect(key.description.length).toBeGreaterThan(5);
    expect(keys.find((key) => key.name === 'AUTH_BCRYPT_COST')).toMatchObject({
      hasDefault: true,
      sensitivity: 'internal',
      requiredFor: [],
    });
    expect(keys.find((key) => key.name === 'APP_ENV')).toMatchObject({ hasDefault: false, requiredFor: ['api', 'worker'] });
    expect(SECRET_KEY_NAMES).toContain('DATABASE_URL');
    expect(SECRET_KEY_NAMES).toContain('STRIPE_SECRET_KEY_REF');
    expect(SECRET_KEY_NAMES).not.toContain('BRAND_NAME');
  });

  it('required keys differ by service only where the register says so', () => {
    const api = new Set(requiredKeysFor('api'));
    const worker = new Set(requiredKeysFor('worker'));
    expect([...worker].filter((key) => !api.has(key)).sort()).toEqual(['AUDIT_ANCHOR_SIGNING_KEY', 'AUDIT_ANCHOR_SINK']);
    expect([...api].filter((key) => !worker.has(key)).sort()).toEqual([
      'CSRF_KEY',
      'CURSOR_KEY',
      'IDEMPOTENCY_BODY_KEY',
      'JWT_SIGNING_KEYS',
      'LOGIN_COUNTER_KEY',
      'MFA_CHALLENGE_BIND_KEY',
      'MFA_ENCRYPTION_KEY',
      'MFA_ENROLMENT_CODE_KEY',
      'RECOVERY_KEY',
    ]);
  });

  it('guards are pure: no APP_ENV means no environment-dependent refusal', () => {
    expect(GUARDS.length).toBe(7);
    expect(
      runGuards({ raw: { NODE_DEBUG: 'x', DATABASE_URL: 'postgresql://h/db', BRAND_NAME: '<x>' }, values: {}, appEnv: undefined }),
    ).toEqual([]);
  });
});
