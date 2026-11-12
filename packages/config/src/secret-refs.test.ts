import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { describe, expect, it } from '@jest/globals';

import { ConfigValidationError } from './errors.js';
import {
  checkResolvedSecrets,
  createEnvSecretProvider,
  parseSecretRef,
  resolveSecretRefs,
  type SecretProvider,
  type SecretRef,
  SecretNotFoundError,
} from './secret-refs.js';
import { REDACTED, Secret } from './secret.js';

const token = (): string => randomBytes(12).toString('hex');

describe('Secret', () => {
  it('reveals the value only through reveal()', () => {
    const value = token();
    const secret = new Secret(value);
    expect(secret.reveal()).toBe(value);
    expect(String(secret)).toBe(REDACTED);
    expect(`${secret}`).toBe(REDACTED);
    expect(JSON.stringify({ secret })).toBe(`{"secret":"${REDACTED}"}`);
    expect(inspect({ secret })).not.toContain(value);
    expect(Object.isFrozen(secret)).toBe(true);
  });
});

describe('secret references (ADR-0018 §3)', () => {
  it.each([
    ['STRIPE_SECRET_KEY', { provider: 'env', locator: 'STRIPE_SECRET_KEY' }],
    ['env:CARRIER_DHL_CREDENTIALS', { provider: 'env', locator: 'CARRIER_DHL_CREDENTIALS' }],
    ['file:/run/secrets/stripe_key', { provider: 'file', locator: '/run/secrets/stripe_key' }],
    ['aws-secrets-manager:stripe/restricted-key', { provider: 'aws-secrets-manager', locator: 'stripe/restricted-key' }],
    [
      'aws-secrets-manager:arn:aws:secretsmanager:eu-west-1:123456789012:secret:stripe/key-AbCdEf',
      { provider: 'aws-secrets-manager', locator: 'arn:aws:secretsmanager:eu-west-1:123456789012:secret:stripe/key-AbCdEf' },
    ],
  ])('parses %s', (raw, expected) => {
    expect(parseSecretRef(raw)).toEqual({ ok: true, value: expected });
  });

  it.each([
    ['lower-case bare name', 'stripe_key', 'ref.format'],
    ['unknown provider', 'vault:kv/stripe', 'ref.provider'],
    ['empty scheme', ':STRIPE', 'ref.format'],
    ['env with lower-case name', 'env:stripe', 'ref.envName'],
    ['relative file', 'file:run/secrets/x', 'ref.filePath'],
    ['file traversal', 'file:/run/secrets/../../etc/shadow', 'ref.filePath'],
    ['aws id with spaces', 'aws-secrets-manager:my secret', 'ref.awsSecretId'],
  ])('rejects %s', (_label, raw, rule) => {
    expect(parseSecretRef(raw)).toEqual({ ok: false, rule });
  });
});

describe('secret resolution (port + orchestrator)', () => {
  const refs = (entries: Record<string, SecretRef>): ReadonlyMap<string, SecretRef> => new Map(Object.entries(entries));

  it('resolves env references through the env provider', async () => {
    const value = token();
    const provider = createEnvSecretProvider({ STRIPE_SECRET_KEY: value });
    const resolved = await resolveSecretRefs(refs({ STRIPE_SECRET_KEY_REF: { provider: 'env', locator: 'STRIPE_SECRET_KEY' } }), [
      provider,
    ]);
    expect(resolved.get('STRIPE_SECRET_KEY_REF')?.reveal()).toBe(value);
  });

  it('names every key that is unset, empty, unsupported or timed out; never the locator or value', async () => {
    const hanging: SecretProvider = {
      kind: 'aws-secrets-manager',
      resolve: (_locator, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    };
    const emptyFile: SecretProvider = { kind: 'file', resolve: () => Promise.resolve('') };
    const error = await resolveSecretRefs(
      refs({
        A_REF: { provider: 'env', locator: 'UNSET_VARIABLE' },
        B_REF: { provider: 'env', locator: 'EMPTY_VARIABLE' },
        C_REF: { provider: 'aws-secrets-manager', locator: 'stripe/key' },
        D_REF: { provider: 'file', locator: '/run/secrets/empty' },
      }),
      [createEnvSecretProvider({ EMPTY_VARIABLE: '' }), hanging, emptyFile],
      { timeoutMs: 20 },
    ).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(ConfigValidationError);
    const rejected = error as ConfigValidationError;
    expect(rejected.issues).toEqual(['A_REF', 'B_REF', 'C_REF', 'D_REF'].map((key) => ({ key, code: 'unresolvable' })));
    expect(rejected.message).not.toMatch(/UNSET_VARIABLE|stripe\/key|run\/secrets/);
  });

  it('reports a missing provider as unresolvable', async () => {
    const error = await resolveSecretRefs(refs({ X_REF: { provider: 'file', locator: '/run/secrets/x' } }), []).catch(
      (caught: unknown) => caught,
    );
    expect((error as ConfigValidationError).keys).toEqual(['X_REF']);
  });

  it('the env provider rejects with a value-free error', async () => {
    await expect(createEnvSecretProvider({}).resolve('MISSING', AbortSignal.timeout(100))).rejects.toBeInstanceOf(SecretNotFoundError);
  });
});

describe('resolved secret checks (ADR-0018 §3, SEC-P3-08 items 4–5) @security', () => {
  const resolved = (entries: Record<string, string>): ReadonlyMap<string, Secret<string>> =>
    new Map(Object.entries(entries).map(([key, value]) => [key, new Secret(value)]));
  const stripeTestKey = (prefix: string): string => `${prefix}${randomBytes(12).toString('hex')}`;

  it('[SEC-TC-51] refuses a resolved placeholder in staging and production only', () => {
    const secrets = resolved({ CARRIER_UPS_SECRET_REF: 'CHANGE_ME' });
    for (const appEnv of ['staging', 'production'] as const) {
      expect(checkResolvedSecrets(secrets, { appEnv, allowFullStripeTestKey: false })).toEqual([
        { key: 'CARRIER_UPS_SECRET_REF', code: 'placeholder' },
      ]);
    }
    expect(checkResolvedSecrets(secrets, { appEnv: 'local', allowFullStripeTestKey: false })).toEqual([]);
  });

  it('refuses live Stripe keys (PAYMENT_LIVE_KEY_FORBIDDEN)', () => {
    for (const prefix of ['sk_live_', 'rk_live_']) {
      const issues = checkResolvedSecrets(resolved({ STRIPE_SECRET_KEY_REF: stripeTestKey(prefix) }), {
        appEnv: 'test',
        allowFullStripeTestKey: true,
      });
      expect(issues).toEqual([{ key: 'STRIPE_SECRET_KEY_REF', code: 'live-key-forbidden' }]);
    }
  });

  it('accepts a restricted rk_test_ key; sk_test_ only when explicitly allowed', () => {
    const context = { appEnv: 'staging', allowFullStripeTestKey: false } as const;
    expect(checkResolvedSecrets(resolved({ STRIPE_SECRET_KEY_REF: stripeTestKey('rk_test_') }), context)).toEqual([]);
    expect(checkResolvedSecrets(resolved({ STRIPE_SECRET_KEY_REF: stripeTestKey('sk_test_') }), context)).toEqual([
      { key: 'STRIPE_SECRET_KEY_REF', code: 'invalid', rule: 'stripe.fullTestKey' },
    ]);
    expect(
      checkResolvedSecrets(resolved({ STRIPE_SECRET_KEY_REF: stripeTestKey('sk_test_') }), { ...context, allowFullStripeTestKey: true }),
    ).toEqual([]);
    expect(checkResolvedSecrets(resolved({ STRIPE_SECRET_KEY_REF: token() }), context)).toEqual([
      { key: 'STRIPE_SECRET_KEY_REF', code: 'invalid', rule: 'stripe.keyFormat' },
    ]);
  });

  it('requires a whsec_ webhook secret', () => {
    const context = { appEnv: 'test', allowFullStripeTestKey: false } as const;
    expect(checkResolvedSecrets(resolved({ STRIPE_WEBHOOK_SECRET_REF: stripeTestKey('whsec_') }), context)).toEqual([]);
    expect(checkResolvedSecrets(resolved({ STRIPE_WEBHOOK_SECRET_REF: token() }), context)).toEqual([
      { key: 'STRIPE_WEBHOOK_SECRET_REF', code: 'invalid', rule: 'stripe.webhookSecretFormat' },
    ]);
  });
});
