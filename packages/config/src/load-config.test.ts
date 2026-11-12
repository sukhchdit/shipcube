import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { type AppEnv, SERVICES } from './environment.js';
import { ConfigValidationError, formatConfigError } from './errors.js';
import { KEY_REGISTER, type KeyVersion } from './keys.js';
import { loadConfig, secretRefsOf } from './load-config.js';
import {
  BCRYPT_COST_FLOOR,
  BCRYPT_COST_MAX,
  type Config,
  CONFIG_SCHEMA,
  type ConfigKey,
  requiredKeysFor,
  SECRET_KEY_NAMES,
} from './schema.js';
import { Secret } from './secret.js';
import { createTestEnv, keyValueFor, randomKeyValue } from './testing/test-env.js';
import { loadWebBuildConfig } from './web/load-web-config.js';

const randomSecret = (): string => `v${randomBytes(16).toString('hex')}`;

/** Runs `fn` and returns the ConfigValidationError it throws. */
function rejection(fn: () => unknown): ConfigValidationError {
  try {
    fn();
  } catch (error) {
    if (error instanceof ConfigValidationError) return error;
    throw error;
  }
  throw new Error('expected a ConfigValidationError');
}

/** Everything a rejected start-up can print or serialise. */
const rendered = (error: ConfigValidationError): string =>
  [error.message, formatConfigError(error), JSON.stringify(error.issues), inspect(error, { depth: 5 }), String(error.stack)].join('\n');

const keyMaterialEntries = KEY_REGISTER.filter((entry) => entry.material !== 'credential');
const symmetricEntries = KEY_REGISTER.filter((entry) => entry.material === 'hmac-sha256' || entry.material === 'aes-256-gcm');

describe('typed configuration (US-002, REQ-PLAT-004, NFR-OPS-005)', () => {
  describe('[AT-US-002-01] a valid environment starts the process with typed values', () => {
    it.each(SERVICES)('[AT-US-002-01] loads a complete environment for %s', (service) => {
      const config = loadConfig(createTestEnv(), { service });
      // Compile-time checks: the types are derived from the schema.
      const cost: number = config.AUTH_BCRYPT_COST;
      const appEnv: AppEnv = config.APP_ENV;
      const db: Secret<string> = config.DATABASE_URL;
      const stripe: Config['STRIPE_SECRET_KEY_REF'] = config.STRIPE_SECRET_KEY_REF;
      expect(cost).toBe(BCRYPT_COST_FLOOR);
      expect(appEnv).toBe('test');
      expect(db).toBeInstanceOf(Secret);
      expect(stripe).toBeUndefined();
    });

    it('[AT-US-002-01] converts and defaults values from the one schema', () => {
      const env = { ...createTestEnv(), APP_PORT: '8081', AUTH_REFRESH_TTL: '7d', DOCS_ENABLED: 'false', VITE_API_BASE_URL: '/api' };
      const config = loadConfig(env, { service: 'api' });
      expect(config.APP_PORT).toBe(8081);
      expect(config.AUTH_REFRESH_TTL).toBe(7 * 86_400);
      expect(config.AUTH_SESSION_ABSOLUTE_TTL).toBe(30 * 86_400);
      expect(config.AUTH_ACCESS_TOKEN_TTL_SECONDS).toBe(900);
      expect(config.DOCS_ENABLED).toBe(false);
      expect(config.MOCK_CARRIER_ENABLED).toBe(true);
      expect(config.PAYMENT_PROVIDER).toBe('mock');
      expect(config.LOCALE_DEFAULT).toBe('en');
      expect(config.JWT_SIGNING_KEYS?.[0]?.keyId).toBe('jwt-signing-v1');
      expect(config.CSRF_KEY?.material.reveal()).toHaveLength(32);
      expect(Object.keys(config)).not.toContain('VITE_API_BASE_URL');
    });

    it('[AT-US-002-01] the loaded configuration is deeply read-only', () => {
      const config = loadConfig(createTestEnv(), { service: 'api' });
      expect(Object.isFrozen(config)).toBe(true);
      expect(Object.isFrozen(config.JWT_SIGNING_KEYS)).toBe(true);
      expect(Object.isFrozen(config.CSRF_KEY)).toBe(true);
      expect(() => Object.assign(config, { APP_PORT: 1 })).toThrow(TypeError);
    });

    it('[AT-US-002-01] logging the configuration never prints a secret', () => {
      const env = createTestEnv();
      const config = loadConfig(env, { service: 'api' });
      const printed = `${JSON.stringify(config)}\n${inspect(config, { depth: 10 })}`;
      for (const name of SECRET_KEY_NAMES) {
        const value = env[name];
        if (value !== undefined) expect(printed).not.toContain(value.slice(value.indexOf(':') + 1));
      }
      expect(printed).toContain('[REDACTED]');
    });

    it('[AT-US-002-01] staging and production environments with real values start', () => {
      expect(loadConfig(createTestEnv({ appEnv: 'staging' }), { service: 'api' }).PAYMENT_PROVIDER).toBe('mock');
      const production = loadConfig(createTestEnv({ appEnv: 'production' }), { service: 'worker' });
      expect(production.PAYMENT_PROVIDER).toBe('stripe');
      expect(production.MOCK_CARRIER_ENABLED).toBe(false);
      expect(production.DOCS_ENABLED).toBe(false);
    });

    it('[AT-US-002-01] ignores variables the schema does not know', () => {
      const config = loadConfig({ ...createTestEnv(), PATH: '/usr/bin', JWT_SECRET: randomSecret() }, { service: 'api' });
      expect(Object.keys(config)).not.toContain('PATH');
      expect(Object.keys(config)).not.toContain('JWT_SECRET');
    });
  });

  describe('[AT-US-002-02] invalid and missing keys are all listed, names only', () => {
    it('[AT-US-002-02] lists DATABASE_URL and the access-token TTL and prints no configured value', () => {
      const jwtSecret = randomSecret();
      const env: Record<string, string | undefined> = {
        ...createTestEnv(),
        DATABASE_URL: undefined,
        AUTH_ACCESS_TOKEN_TTL_SECONDS: 'abc',
        JWT_SECRET: jwtSecret,
      };
      const error = rejection(() => loadConfig(env, { service: 'api' }));
      expect(error.keys).toEqual(['AUTH_ACCESS_TOKEN_TTL_SECONDS', 'DATABASE_URL']);
      expect(error.missingKeys).toEqual(['DATABASE_URL']);
      expect(error.issues).toContainEqual({ key: 'AUTH_ACCESS_TOKEN_TTL_SECONDS', code: 'invalid', rule: 'number.base' });
      const output = rendered(error);
      expect(output).toContain('DATABASE_URL');
      expect(output).toContain('ACCESS_TOKEN_TTL_SECONDS');
      for (const value of [jwtSecret, 'abc', ...SECRET_KEY_NAMES.map((name) => env[name])]) {
        if (value !== undefined) expect(output).not.toContain(value);
      }
    });

    it('[AT-US-002-02] an empty value counts as missing (Compose passes ${VAR:-} as "")', () => {
      const error = rejection(() => loadConfig({ ...createTestEnv(), REDIS_URL: '' }, { service: 'worker' }));
      expect(error.issues).toEqual([{ key: 'REDIS_URL', code: 'missing' }]);
    });

    it('[AT-US-002-02] property: any subset of required keys removed is reported exactly', () => {
      for (const service of SERVICES) {
        const required = requiredKeysFor(service);
        fc.assert(
          fc.property(fc.subarray([...required], { minLength: 1 }), (removed) => {
            const env: Record<string, string | undefined> = createTestEnv();
            for (const name of removed) env[name] = undefined;
            const error = rejection(() => loadConfig(env, { service }));
            expect(error.missingKeys).toEqual([...removed].sort());
            expect(error.keys).toEqual([...removed].sort());
          }),
          { numRuns: 40 },
        );
      }
    });

    it('[AT-US-002-02] property: invalid secret values never appear in the error', () => {
      // Every structured secret (URLs, keys); SEED_* passwords are free-form, so any 12+ characters are valid.
      const secretKeys = SECRET_KEY_NAMES.filter((name) => CONFIG_SCHEMA[name].sensitivity === 'secret' && !name.startsWith('SEED_'));
      fc.assert(
        fc.property(fc.constantFrom(...secretKeys), fc.uint8Array({ minLength: 16, maxLength: 48 }), (name, bytes) => {
          const value = `v${Buffer.from(bytes).toString('hex')}`;
          const error = rejection(() => loadConfig({ ...createTestEnv(), [name]: value }, { service: 'api' }));
          expect(error.keys).toEqual([name]);
          expect(rendered(error)).not.toContain(value);
        }),
        { numRuns: 60 },
      );
    });

    it('[AT-US-002-02] the formatted report has one line per issue', () => {
      const error = rejection(() => loadConfig({ ...createTestEnv(), APP_ENV: 'qa', APP_PORT: '70000' }, { service: 'api' }));
      expect(formatConfigError(error).split('\n')).toEqual([
        'Configuration invalid; refusing to start (2 key(s)):',
        '  - APP_ENV: invalid: any.only',
        '  - APP_PORT: invalid: number.port',
      ]);
    });
  });

  describe('[AT-US-002-03] bcrypt cost below the floor is rejected', () => {
    it('[AT-US-002-03] AUTH_BCRYPT_COST=10 is named', () => {
      const error = rejection(() => loadConfig({ ...createTestEnv(), AUTH_BCRYPT_COST: '10' }, { service: 'api' }));
      expect(error.issues).toEqual([{ key: 'AUTH_BCRYPT_COST', code: 'invalid', rule: 'number.min' }]);
    });

    it('[AT-US-002-03] property: every cost below 12 is rejected and 12..31 accepted', () => {
      fc.assert(
        fc.property(fc.integer({ min: -1000, max: 1000 }), (cost) => {
          const load = () => loadConfig({ ...createTestEnv(), AUTH_BCRYPT_COST: String(cost) }, { service: 'api' });
          if (cost >= BCRYPT_COST_FLOOR && cost <= BCRYPT_COST_MAX) expect(load().AUTH_BCRYPT_COST).toBe(cost);
          else expect(rejection(load).keys).toEqual(['AUTH_BCRYPT_COST']);
        }),
        { numRuns: 80 },
      );
    });
  });

  describe('[AT-US-002-04] worker and frontend builds use the same validation', () => {
    it('[AT-US-002-04] a missing BRAND_NAME fails the worker and the web build, naming the key', () => {
      const env: Record<string, string | undefined> = { ...createTestEnv(), VITE_API_BASE_URL: '/api', BRAND_NAME: undefined };
      const worker = rejection(() => loadConfig(env, { service: 'worker' }));
      const web = rejection(() => loadWebBuildConfig(env));
      expect(worker.missingKeys).toEqual(['BRAND_NAME']);
      expect(web.missingKeys).toEqual(['BRAND_NAME']);
      expect(formatConfigError(web)).toContain('BRAND_NAME');
    });

    it('[AT-US-002-04] an invalid BRAND_NAME is rejected identically by both schemas', () => {
      const env = { ...createTestEnv(), VITE_API_BASE_URL: '/api', BRAND_NAME: 'x'.repeat(41) };
      expect(rejection(() => loadConfig(env, { service: 'api' })).issues).toEqual([{ key: 'BRAND_NAME', code: 'invalid', rule: 'zod' }]);
      expect(rejection(() => loadWebBuildConfig(env)).issues).toEqual([{ key: 'BRAND_NAME', code: 'invalid', rule: 'too_big' }]);
    });

    it('[AT-US-002-04] a worker without its worker-only keys fails; the API does not need them', () => {
      const env: Record<string, string | undefined> = {
        ...createTestEnv(),
        AUDIT_ANCHOR_SINK: undefined,
        AUDIT_ANCHOR_SIGNING_KEY: undefined,
      };
      expect(rejection(() => loadConfig(env, { service: 'worker' })).missingKeys).toEqual([
        'AUDIT_ANCHOR_SIGNING_KEY',
        'AUDIT_ANCHOR_SINK',
      ]);
      expect(loadConfig(env, { service: 'api' }).AUDIT_ANCHOR_SINK).toBeUndefined();
    });

    it('[AT-US-002-04] an API-only key is optional for the worker', () => {
      const env: Record<string, string | undefined> = { ...createTestEnv(), CSRF_KEY: undefined };
      expect(loadConfig(env, { service: 'worker' }).CSRF_KEY).toBeUndefined();
      expect(rejection(() => loadConfig(env, { service: 'api' })).missingKeys).toEqual(['CSRF_KEY']);
    });
  });
});

describe('key register in the schema (SEC-TC-49 config part, SEC-P3-08 item 1) @security', () => {
  it('[SEC-TC-49] two key variables with identical material are rejected, both named', () => {
    const material = randomBytes(32).toString('base64');
    const env = { ...createTestEnv(), CSRF_KEY: `csrf-v1:${material}`, CURSOR_KEY: `cursor-v1:${material}` };
    const error = rejection(() => loadConfig(env, { service: 'api' }));
    expect(error.issues).toEqual([
      { key: 'CSRF_KEY', code: 'duplicate-key-material' },
      { key: 'CURSOR_KEY', code: 'duplicate-key-material' },
    ]);
    expect(rendered(error)).not.toContain(material);
  });

  it('[SEC-TC-49] property: any two register keys sharing material are rejected exactly', () => {
    // 32 random bytes are a valid HMAC-SHA-256 and AES-256-GCM key, so any two symmetric rows can share them.
    const pairs = fc
      .tuple(fc.constantFrom(...symmetricEntries), fc.constantFrom(...symmetricEntries))
      .filter(([a, b]) => a.keyId !== b.keyId);
    fc.assert(
      fc.property(pairs, fc.uint8Array({ minLength: 32, maxLength: 32 }), ([a, b], bytes) => {
        const material = Buffer.from(bytes).toString('base64');
        const [nameA = '', nameB = ''] = [a.variables[0], b.variables[0]];
        const env = { ...createTestEnv(), [nameA]: `${a.keyId}-v1:${material}`, [nameB]: `${b.keyId}-v1:${material}` };
        const error = rejection(() => loadConfig(env, { service: 'api' }));
        expect(error.keys).toEqual([nameA, nameB].sort());
        expect(error.issues.every((issue) => issue.code === 'duplicate-key-material')).toBe(true);
      }),
      { numRuns: 50 },
    );
  });

  it('[SEC-TC-49] a retired key reused as another purpose, or two identical kids, are rejected', () => {
    const env = createTestEnv();
    const vaultMaterial = (env.AUDIT_VAULT_KEY ?? '').split(':')[1] ?? '';
    const reused = { ...env, MFA_ENCRYPTION_KEY: randomKeyValue('mfa-v2'), MFA_ENCRYPTION_KEY_PREVIOUS: `mfa-v1:${vaultMaterial}` };
    expect(rejection(() => loadConfig(reused, { service: 'api' })).issues).toEqual([
      { key: 'AUDIT_VAULT_KEY', code: 'duplicate-key-material' },
      { key: 'MFA_ENCRYPTION_KEY_PREVIOUS', code: 'duplicate-key-material' },
    ]);
    const jwt = (env.JWT_SIGNING_KEYS ?? '').split(':')[1] ?? '';
    const twoKids = { ...env, JWT_SIGNING_KEYS: `jwt-signing-v2:${jwt},jwt-signing-v1:${jwt}` };
    expect(rejection(() => loadConfig(twoKids, { service: 'api' })).issues).toEqual([
      { key: 'JWT_SIGNING_KEYS', code: 'duplicate-key-material' },
    ]);
  });

  it('[SEC-TC-49] local-only markers count as material too', () => {
    const env = { ...createTestEnv(), CSRF_KEY: 'csrf-v1:local-only-shared', CURSOR_KEY: 'cursor-v1:local-only-shared' };
    expect(rejection(() => loadConfig(env, { service: 'api' })).keys).toEqual(['CSRF_KEY', 'CURSOR_KEY']);
  });

  it('[SEC-TC-49] every key variable must carry a key_id of its own purpose', () => {
    for (const entry of keyMaterialEntries) {
      const [variable = ''] = entry.variables;
      const value = keyValueFor(entry);
      const bare = value.slice(value.indexOf(':') + 1);
      const missingId = rejection(() => loadConfig({ ...createTestEnv(), [variable]: bare }, { service: 'worker' }));
      expect(missingId.issues).toContainEqual({ key: variable, code: 'invalid', rule: 'key.idMissing' });
      const wrongPurpose = rejection(() => loadConfig({ ...createTestEnv(), [variable]: `other-v1:${bare}` }, { service: 'worker' }));
      expect(wrongPurpose.issues).toContainEqual({ key: variable, code: 'invalid', rule: 'key.purpose' });
    }
  });

  it('[SEC-TC-49] a symmetric key shorter than 32 bytes is rejected', () => {
    const error = rejection(() => loadConfig({ ...createTestEnv(), CURSOR_KEY: randomKeyValue('cursor-v1', 31) }, { service: 'api' }));
    expect(error.issues).toEqual([{ key: 'CURSOR_KEY', code: 'invalid', rule: 'key.length' }]);
  });

  it('[SEC-TC-49] a _PREVIOUS key must be an older version of the same purpose', () => {
    const env = createTestEnv();
    const ok = loadConfig(
      { ...env, CSRF_KEY: randomKeyValue('csrf-v2'), CSRF_KEY_PREVIOUS: randomKeyValue('csrf-v1') },
      { service: 'api' },
    );
    const previous: KeyVersion | undefined = ok.CSRF_KEY_PREVIOUS;
    expect(previous?.version).toBe(1);
    const sameVersion = rejection(() => loadConfig({ ...env, CSRF_KEY_PREVIOUS: randomKeyValue('csrf-v1') }, { service: 'api' }));
    expect(sameVersion.issues).toEqual([{ key: 'CSRF_KEY_PREVIOUS', code: 'inconsistent', rule: 'key.previousVersion' }]);
  });
});

describe('start-up refusals (SEC-TC-51 start-up part, SEC-P3-08 items 5–6, NFR-SEC-007) @security', () => {
  const hardened: readonly AppEnv[] = ['staging', 'production'];

  it.each(hardened)('[SEC-TC-51] APP_ENV=%s refuses start-up when a secret equals a placeholder', (appEnv) => {
    const env = { ...createTestEnv({ appEnv }), CSRF_KEY: 'csrf-v1:CHANGE_ME' };
    const error = rejection(() => loadConfig(env, { service: 'api' }));
    expect(error.issues).toContainEqual({ key: 'CSRF_KEY', code: 'placeholder' });
  });

  it('[SEC-TC-51] property: in staging any secret set to a placeholder or local-only value is refused by name', () => {
    const base = createTestEnv({ appEnv: 'staging' });
    const configured = SECRET_KEY_NAMES.filter((name) => base[name] !== undefined);
    const placeholder = fc.constantFrom('CHANGE_ME', 'changeme', '<db-password>', 'placeholder', 'local-only-value', 'REPLACE_ME');
    fc.assert(
      fc.property(fc.constantFrom(...configured), placeholder, (name, marker) => {
        const value = base[name] ?? '';
        // URLs get the marker as password; key variables keep their key_id and get the marker as material.
        const replaced = name.endsWith('_URL')
          ? value.replace(/:[^:@/]+@/, `:${marker}@`)
          : `${value.slice(0, value.indexOf(':'))}:${marker}`;
        const env = { ...base, [name]: replaced };
        const error = rejection(() => loadConfig(env, { service: 'worker' }));
        expect(error.issues).toContainEqual({ key: name, code: 'placeholder' });
      }),
      { numRuns: 60 },
    );
  });

  it('[SEC-TC-51] local and test accept compose-style local-only values', () => {
    for (const appEnv of ['local', 'test'] as const) {
      const env = {
        ...createTestEnv({ appEnv }),
        CSRF_KEY: 'csrf-v1:local-only-csrf-key',
        SEED_SUPERADMIN_PASSWORD: 'local-only-superadmin',
      };
      const config = loadConfig(env, { service: 'api' });
      expect(config.CSRF_KEY?.localOnly).toBe(true);
      expect(config.SEED_SUPERADMIN_PASSWORD?.reveal()).toBe('local-only-superadmin');
    }
  });

  it('[SEC-TC-51] a non-secret placeholder is refused in staging as well', () => {
    const error = rejection(() => loadConfig({ ...createTestEnv({ appEnv: 'staging' }), BRAND_NAME: '<brand>' }, { service: 'api' }));
    expect(error.issues).toEqual([{ key: 'BRAND_NAME', code: 'placeholder' }]);
  });

  it('[NT-SEC-007-a] plain transport is refused outside local and test', () => {
    const env = {
      ...createTestEnv({ appEnv: 'staging' }),
      DATABASE_URL: `postgresql://platform_app:${randomSecret()}@db:5432/platform?sslmode=require`,
      DATABASE_MIGRATOR_URL: `postgresql://platform_migrator:${randomSecret()}@db:5432/platform`,
      REDIS_URL: `redis://api:${randomSecret()}@cache:6379`,
      WEB_APP_ORIGIN: 'http://web.example.org',
      STORAGE_ENDPOINT: 'http://s3.example.org',
    };
    const error = rejection(() => loadConfig(env, { service: 'api' }));
    expect(error.issues).toEqual(
      ['DATABASE_MIGRATOR_URL', 'DATABASE_URL', 'REDIS_URL', 'STORAGE_ENDPOINT', 'WEB_APP_ORIGIN'].map((key) => ({
        key,
        code: 'insecure-transport',
      })),
    );
  });

  it('[NT-SEC-007-a] plain local transport is accepted in local and test', () => {
    expect(
      loadConfig({ ...createTestEnv({ appEnv: 'local' }), STORAGE_ENDPOINT: 'http://rustfs:9000' }, { service: 'api' }).STORAGE_ENDPOINT,
    ).toBe('http://rustfs:9000');
  });

  it.each(['test', 'staging', 'production'] as const)('debug and inspector flags are refused with APP_ENV=%s', (appEnv) => {
    const env = {
      ...createTestEnv({ appEnv }),
      NODE_DEBUG: 'http',
      DEBUG: 'express:*',
      NODE_OPTIONS: '--max-old-space-size=1152 --inspect=0.0.0.0:9229',
    };
    expect(rejection(() => loadConfig(env, { service: 'api' })).issues).toEqual([
      { key: 'DEBUG', code: 'debug-flag' },
      { key: 'NODE_DEBUG', code: 'debug-flag' },
      { key: 'NODE_OPTIONS', code: 'debug-flag' },
    ]);
  });

  it('debug flags are allowed in local; harmless NODE_OPTIONS everywhere', () => {
    const local = { ...createTestEnv({ appEnv: 'local' }), NODE_DEBUG: 'http', NODE_OPTIONS: '--inspect' };
    expect(loadConfig(local, { service: 'api' }).NODE_OPTIONS).toBe('--inspect');
    const staging = { ...createTestEnv({ appEnv: 'staging' }), NODE_OPTIONS: '--max-old-space-size=1152 --conditions=x' };
    expect(loadConfig(staging, { service: 'api' }).NODE_OPTIONS).toContain('--max-old-space-size');
  });

  it('production refuses the Mock carrier, Mock scenarios, the Mock gateway and its webhook secret', () => {
    const base = createTestEnv({ appEnv: 'production' });
    const mockGatewaySecret = keyValueFor(KEY_REGISTER.find((entry) => entry.keyId === 'mock-gateway-webhook') ?? KEY_REGISTER[0]!);
    const env = {
      ...base,
      MOCK_CARRIER_ENABLED: 'true',
      MOCK_SCENARIOS_ENABLED: 'true',
      PAYMENT_PROVIDER: 'mock',
      MOCK_GATEWAY_WEBHOOK_SECRET: mockGatewaySecret,
    };
    expect(rejection(() => loadConfig(env, { service: 'api' })).issues).toEqual(
      ['MOCK_CARRIER_ENABLED', 'MOCK_GATEWAY_WEBHOOK_SECRET', 'MOCK_SCENARIOS_ENABLED', 'PAYMENT_PROVIDER'].map((key) => ({
        key,
        code: 'forbidden-in-environment',
      })),
    );
  });

  it('keys required by another value are named as missing', () => {
    const env: Record<string, string | undefined> = {
      ...createTestEnv(),
      CARRIER_DHL_ENABLED: 'true',
      OTEL_ENABLED: 'true',
      MAIL_HOST: undefined,
      MOCK_GATEWAY_WEBHOOK_SECRET: undefined,
    };
    expect(rejection(() => loadConfig(env, { service: 'api' })).missingKeys).toEqual([
      'CARRIER_DHL_SECRET_REF',
      'MAIL_HOST',
      'MOCK_GATEWAY_WEBHOOK_SECRET',
      'OTEL_EXPORTER_OTLP_ENDPOINT',
    ]);
    const stripe = { ...createTestEnv(), PAYMENT_PROVIDER: 'stripe' };
    expect(rejection(() => loadConfig(stripe, { service: 'api' })).missingKeys).toEqual([
      'STRIPE_SECRET_KEY_REF',
      'STRIPE_WEBHOOK_SECRET_REF',
    ]);
  });

  it('an invalid companion is reported once, as invalid', () => {
    const env = { ...createTestEnv(), CARRIER_UPS_ENABLED: 'true', CARRIER_UPS_SECRET_REF: 'not a ref' };
    expect(rejection(() => loadConfig(env, { service: 'api' })).issues).toEqual([
      { key: 'CARRIER_UPS_SECRET_REF', code: 'invalid', rule: 'ref.format' },
    ]);
  });

  it('sliding session lifetimes never exceed their absolute caps (ADR-0006 am.)', () => {
    const env = { ...createTestEnv(), AUTH_REFRESH_TTL: '30d', AUTH_SESSION_ABSOLUTE_TTL: '7d', AUTH_ADMIN_SESSION_ABSOLUTE_TTL: '20m' };
    expect(rejection(() => loadConfig(env, { service: 'api' })).issues).toEqual([
      { key: 'AUTH_ADMIN_REFRESH_IDLE_TTL', code: 'inconsistent' },
      { key: 'AUTH_REFRESH_TTL', code: 'inconsistent' },
    ]);
  });

  it('durations above their caps or in the wrong format are rejected', () => {
    const env = { ...createTestEnv(), AUTH_SESSION_ABSOLUTE_TTL: '90d', AUTH_UNVERIFIED_TTL: '7 days' };
    expect(rejection(() => loadConfig(env, { service: 'api' })).issues).toEqual([
      { key: 'AUTH_SESSION_ABSOLUTE_TTL', code: 'invalid', rule: 'duration.max' },
      { key: 'AUTH_UNVERIFIED_TTL', code: 'invalid', rule: 'duration.format' },
    ]);
  });

  it('origins must not carry a path', () => {
    const error = rejection(() => loadConfig({ ...createTestEnv(), ADMIN_APP_ORIGIN: 'http://admin.test/app' }, { service: 'api' }));
    expect(error.issues).toEqual([{ key: 'ADMIN_APP_ORIGIN', code: 'invalid', rule: 'origin.path' }]);
  });
});

describe('secret references in the configuration (ADR-0018 §3)', () => {
  it('collects every configured *_REF as a parsed reference', () => {
    const env = {
      ...createTestEnv(),
      CARRIER_FEDEX_ENABLED: 'true',
      CARRIER_FEDEX_SECRET_REF: 'env:CARRIER_FEDEX_CREDENTIALS',
      MAIL_SMTP_PASSWORD_REF: 'file:/run/secrets/smtp_password',
    };
    const refs = secretRefsOf(loadConfig(env, { service: 'api' }));
    expect(Object.fromEntries(refs)).toEqual({
      CARRIER_FEDEX_SECRET_REF: { provider: 'env', locator: 'CARRIER_FEDEX_CREDENTIALS' },
      MAIL_SMTP_PASSWORD_REF: { provider: 'file', locator: '/run/secrets/smtp_password' },
    });
  });

  it('every secret-ref key is named *_REF and every *_REF key is a secret reference', () => {
    for (const name of Object.keys(CONFIG_SCHEMA) as ConfigKey[]) {
      expect(name.endsWith('_REF')).toBe(CONFIG_SCHEMA[name].sensitivity === 'secret-ref');
    }
  });
});
