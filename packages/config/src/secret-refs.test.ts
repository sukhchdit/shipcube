import { randomBytes } from 'node:crypto';
import { inspect } from 'node:util';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { ConfigValidationError, formatConfigError } from './errors.js';
import {
  checkResolvedSecrets,
  createEnvSecretProvider,
  describeFailureCause,
  parseSecretRef,
  resolveSecretRefs,
  SECRET_RESOLVE_RETRY_DELAY_MS,
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
    // Template-literal interpolation is the leak path under test; the type system rightly forbids it.
    expect(`${secret as unknown as string}`).toBe(REDACTED);
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
    ['file:/run/secrets/carriers/dhl.json', { provider: 'file', locator: '/run/secrets/carriers/dhl.json' }],
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
    ['[PR3-SEC-07] file outside /run/secrets (environ)', 'file:/proc/self/environ', 'ref.filePath'],
    ['[PR3-SEC-07] file outside /run/secrets (shadow)', 'file:/etc/shadow', 'ref.filePath'],
    ['[PR3-SEC-07] prefix look-alike', 'file:/run/secretsX/x', 'ref.filePath'],
    ['[PR3-SEC-07] dot segment', 'file:/run/secrets/./x', 'ref.filePath'],
    ['[PR3-SEC-07] hidden file', 'file:/run/secrets/.x', 'ref.filePath'],
    ['[PR3-SEC-07] double slash', 'file:/run/secrets//x', 'ref.filePath'],
    ['[PR3-SEC-07] backslash', 'file:/run/secrets/a\\..\\x', 'ref.filePath'],
    ['[PR3-SEC-07] NUL byte', 'file:/run/secrets/x\u0000', 'ref.filePath'],
    ['[PR3-SEC-07] the root itself', 'file:/run/secrets', 'ref.filePath'],
    ['[PR3-SEC-07] trailing slash', 'file:/run/secrets/x/', 'ref.filePath'],
    ['aws id with spaces', 'aws-secrets-manager:my secret', 'ref.awsSecretId'],
  ])('rejects %s', (_label, raw, rule) => {
    expect(parseSecretRef(raw)).toEqual({ ok: false, rule });
  });
});

const refs = (entries: Record<string, SecretRef>): ReadonlyMap<string, SecretRef> => new Map(Object.entries(entries));
const aws = (locator: string): SecretRef => ({ provider: 'aws-secrets-manager', locator });
/** Rejects with any reason, Errors or not: providers are untrusted, so the tests feed non-Error rejections too. */
const rejectWith = (reason: unknown): Promise<never> =>
  new Promise<never>(() => {
    throw reason;
  });
const never = (): Promise<string> => new Promise<string>(() => undefined);
const instant = { sleep: (): Promise<void> => Promise.resolve(), random: (): number => 0 } as const;
/** R2-n4: slack on wall-clock upper bounds (Windows timer granularity ~15.6 ms, loaded CI runners). */
const SLACK_MS = 500;

/** Provider whose behaviour per attempt is scripted by locator; counts the calls per locator. */
function scripted(script: Record<string, readonly (() => Promise<string>)[]>): SecretProvider & { readonly calls: Map<string, number> } {
  const calls = new Map<string, number>();
  return {
    kind: 'aws-secrets-manager',
    calls,
    resolve(locator) {
      const attempt = calls.get(locator) ?? 0;
      calls.set(locator, attempt + 1);
      const steps = script[locator] ?? [];
      const step = steps[Math.min(attempt, steps.length - 1)];
      if (step === undefined) throw new Error('unscripted locator');
      return step();
    },
  };
}

const rejection = async (promise: Promise<unknown>): Promise<ConfigValidationError> => {
  const caught = await promise.then(
    () => undefined,
    (error: unknown) => error,
  );
  expect(caught).toBeInstanceOf(ConfigValidationError);
  return caught as ConfigValidationError;
};

describe('secret resolution (port + orchestrator)', () => {
  it('resolves env references through the env provider', async () => {
    const value = token();
    const provider = createEnvSecretProvider({ STRIPE_SECRET_KEY: value });
    const resolved = await resolveSecretRefs(refs({ STRIPE_SECRET_KEY_REF: { provider: 'env', locator: 'STRIPE_SECRET_KEY' } }), [
      provider,
    ]);
    expect(resolved.get('STRIPE_SECRET_KEY_REF')?.reveal()).toBe(value);
  });

  it('[M1][PR3-SEC-04] a provider that ignores the signal and never settles fails within timeoutMs + ε', async () => {
    const provider = scripted({ hung: [never] });
    const started = performance.now();
    const error = await rejection(
      resolveSecretRefs(refs({ A_REF: aws('hung') }), [provider], { timeoutMs: 50, deadlineMs: 120, ...instant }),
    );
    const elapsed = performance.now() - started;
    expect(error.issues).toEqual([{ key: 'A_REF', code: 'unresolvable', rule: 'ref.timeout' }]);
    expect(elapsed).toBeGreaterThanOrEqual(40);
    expect(elapsed).toBeLessThan(50 + SLACK_MS);
    expect(provider.calls.get('hung')).toBe(1);
  });

  it('[M1][PR3-SEC-04] a provider that settles late is cut off at the timeout', async () => {
    const late = (): Promise<string> => new Promise((resolve) => setTimeout(() => resolve(token()), 5_000).unref());
    const started = performance.now();
    const error = await rejection(
      resolveSecretRefs(refs({ A_REF: aws('late') }), [scripted({ late: [late] })], { timeoutMs: 50, deadlineMs: 120, ...instant }),
    );
    expect(error.issues).toEqual([{ key: 'A_REF', code: 'unresolvable', rule: 'ref.timeout' }]);
    expect(performance.now() - started).toBeLessThan(50 + SLACK_MS);
  });

  it('[M1] one overall deadline bounds the call even when the per-attempt timeout is larger', async () => {
    const provider = scripted({ a: [never], b: [never] });
    const started = performance.now();
    const error = await rejection(
      resolveSecretRefs(refs({ A_REF: aws('a'), B_REF: aws('b') }), [provider], { timeoutMs: 5_000, deadlineMs: 60, ...instant }),
    );
    expect(performance.now() - started).toBeLessThan(60 + SLACK_MS);
    expect(error.issues.map((issue) => issue.rule)).toEqual(['ref.timeout', 'ref.timeout']);
    expect([provider.calls.get('a'), provider.calls.get('b')]).toEqual([1, 1]);
  });

  it('[m1] classifies every failure into a value-free rule and cause', async () => {
    class OddlyNamed extends Error {}
    Object.defineProperty(OddlyNamed, 'name', { value: 'not an identifier!' });
    const errno = (code: string): Error => Object.assign(new Error('EACCES: permission denied'), { code });
    const provider = scripted({
      typeError: [() => Promise.reject(new TypeError('boom'))],
      errno: [() => Promise.reject(errno('EACCES'))],
      nodeCode: [() => Promise.reject(errno('ERR_INVALID_ARG_TYPE'))],
      tokenCode: [() => Promise.reject(errno('AKIA1234567890ABCD'))],
      oddName: [() => Promise.reject(new OddlyNamed('x'))],
      string: [() => rejectWith('a thrown string')],
      nullThrow: [() => rejectWith(null)],
      undefinedValue: [() => Promise.resolve(undefined as unknown as string)],
      nullValue: [() => Promise.resolve(null as unknown as string)],
      syncThrow: [
        () => {
          throw new RangeError('synchronous');
        },
      ],
      empty: [() => Promise.resolve('')],
      notFound: [() => Promise.reject(new SecretNotFoundError())],
    });
    const error = await rejection(
      resolveSecretRefs(
        refs({
          A_REF: aws('typeError'),
          B_REF: aws('errno'),
          C_REF: aws('nodeCode'),
          D_REF: aws('tokenCode'),
          E_REF: aws('oddName'),
          F_REF: aws('string'),
          G_REF: aws('nullThrow'),
          H_REF: aws('undefinedValue'),
          I_REF: aws('nullValue'),
          J_REF: aws('syncThrow'),
          K_REF: aws('empty'),
          L_REF: aws('notFound'),
          M_REF: { provider: 'file', locator: '/run/secrets/x' },
          N_REF: { provider: 'env', locator: 'UNSET_VARIABLE' },
          O_REF: { provider: 'env', locator: 'EMPTY_VARIABLE' },
        }),
        [provider, createEnvSecretProvider({ EMPTY_VARIABLE: '' })],
        instant,
      ),
    );
    const providerError = (key: string, cause: string): object => ({ key, code: 'unresolvable', rule: 'ref.providerError', cause });
    expect(error.issues).toEqual([
      providerError('A_REF', 'TypeError'),
      providerError('B_REF', 'Error/EACCES'),
      providerError('C_REF', 'Error/ERR_INVALID_ARG_TYPE'),
      providerError('D_REF', 'Error'),
      providerError('E_REF', 'Error'),
      providerError('F_REF', 'non-error:string'),
      providerError('G_REF', 'non-error:null'),
      providerError('H_REF', 'non-string:undefined'),
      providerError('I_REF', 'non-string:null'),
      providerError('J_REF', 'RangeError'),
      { key: 'K_REF', code: 'unresolvable', rule: 'ref.empty' },
      { key: 'L_REF', code: 'unresolvable', rule: 'ref.notFound' },
      { key: 'M_REF', code: 'unresolvable', rule: 'ref.noProvider' },
      { key: 'N_REF', code: 'unresolvable', rule: 'ref.notFound' },
      { key: 'O_REF', code: 'unresolvable', rule: 'ref.notFound' },
    ]);
    expect(formatConfigError(error)).toContain('  - B_REF: unresolvable: ref.providerError (Error/EACCES)');
    expect(error.message).not.toMatch(/boom|permission|AKIA|thrown string|synchronous|UNSET_VARIABLE|run\/secrets/);
    for (const locator of ['typeError', 'string', 'undefinedValue', 'syncThrow']) expect(provider.calls.get(locator)).toBe(2);
    // R2-n3: EACCES is permanent, so it is not retried.
    for (const locator of ['errno', 'empty', 'notFound']) expect(provider.calls.get(locator)).toBe(1);
  });

  it('[m1] retries a provider error once after 100–300 ms of jitter, then succeeds', async () => {
    const value = token();
    const provider = scripted({ flaky: [() => Promise.reject(new Error('throttled')), () => Promise.resolve(value)] });
    const delays: number[] = [];
    const resolved = await resolveSecretRefs(refs({ A_REF: aws('flaky') }), [provider], {
      random: () => 0.5,
      sleep: (ms) => {
        delays.push(ms);
        return Promise.resolve();
      },
    });
    expect(resolved.get('A_REF')?.reveal()).toBe(value);
    expect(delays).toEqual([(SECRET_RESOLVE_RETRY_DELAY_MS.min + SECRET_RESOLVE_RETRY_DELAY_MS.max) / 2]);
    expect(provider.calls.get('flaky')).toBe(2);
  });

  it('[m1] retries a timeout once, then succeeds; the default sleep and jitter are bounded', async () => {
    const value = token();
    const provider = scripted({ slow: [never, () => Promise.resolve(value)] });
    const started = performance.now();
    const resolved = await resolveSecretRefs(refs({ A_REF: aws('slow') }), [provider], { timeoutMs: 30 });
    const elapsed = performance.now() - started;
    expect(resolved.get('A_REF')?.reveal()).toBe(value);
    expect(elapsed).toBeGreaterThanOrEqual(30 + SECRET_RESOLVE_RETRY_DELAY_MS.min - 10);
    expect(elapsed).toBeLessThan(30 + SECRET_RESOLVE_RETRY_DELAY_MS.max + SLACK_MS);
  });

  it('[m1] skips the retry when a full attempt no longer fits the deadline', async () => {
    let slept = false;
    const provider = scripted({ broken: [() => Promise.reject(new Error('down'))] });
    const error = await rejection(
      resolveSecretRefs(refs({ A_REF: aws('broken') }), [provider], {
        timeoutMs: 50,
        deadlineMs: 100,
        random: () => 0,
        sleep: () => {
          slept = true;
          return Promise.resolve();
        },
      }),
    );
    expect(error.issues).toEqual([{ key: 'A_REF', code: 'unresolvable', rule: 'ref.providerError', cause: 'Error' }]);
    expect(slept).toBe(false);
    expect(provider.calls.get('broken')).toBe(1);
  });

  it('[R2-n3] a retry that would start after the deadline keeps the first diagnosis without calling the provider', async () => {
    const provider = scripted({ flaky: [() => Promise.reject(new Error('down')), () => Promise.resolve(token())] });
    const error = await rejection(
      resolveSecretRefs(refs({ A_REF: aws('flaky') }), [provider], {
        timeoutMs: 20,
        deadlineMs: 200,
        random: () => 0,
        sleep: () => new Promise((resolve) => setTimeout(resolve, 260)),
      }),
    );
    expect(error.issues).toEqual([{ key: 'A_REF', code: 'unresolvable', rule: 'ref.providerError', cause: 'Error' }]);
    expect(provider.calls.get('flaky')).toBe(1);
  });

  it.each(['SECRET_FILE_OUTSIDE_ROOT', 'SECRET_FILE_NOT_REGULAR', 'SECRET_FILE_TOO_LARGE', 'EACCES', 'EPERM'])(
    '[R2-n3] a permanent provider failure (%s) is not retried and keeps its cause',
    async (code) => {
      class SecretFileError extends Error {
        readonly code = code;
      }
      let slept = false;
      const provider = scripted({ denied: [() => Promise.reject(new SecretFileError('refused')), () => Promise.resolve(token())] });
      const error = await rejection(
        resolveSecretRefs(refs({ A_REF: aws('denied') }), [provider], {
          sleep: () => {
            slept = true;
            return Promise.resolve();
          },
        }),
      );
      expect(error.issues).toEqual([{ key: 'A_REF', code: 'unresolvable', rule: 'ref.providerError', cause: `SecretFileError/${code}` }]);
      expect([slept, provider.calls.get('denied')]).toEqual([false, 1]);
    },
  );

  it('[R2-n3] a transient errno failure (EIO) is still retried once', async () => {
    const value = token();
    const provider = scripted({
      io: [() => Promise.reject(Object.assign(new Error('io'), { code: 'EIO' })), () => Promise.resolve(value)],
    });
    const resolved = await resolveSecretRefs(refs({ A_REF: aws('io') }), [provider], instant);
    expect(resolved.get('A_REF')?.reveal()).toBe(value);
    expect(provider.calls.get('io')).toBe(2);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a non-positive or fractional budget (%p)', async (budget) => {
    await expect(resolveSecretRefs(refs({}), [], { timeoutMs: budget })).rejects.toBeInstanceOf(RangeError);
    await expect(resolveSecretRefs(refs({}), [], { deadlineMs: budget })).rejects.toBeInstanceOf(RangeError);
  });

  it('the env provider rejects with a value-free error', async () => {
    await expect(createEnvSecretProvider({}).resolve('MISSING', AbortSignal.timeout(100))).rejects.toBeInstanceOf(SecretNotFoundError);
  });

  it('describes causes from the class and errno code only', () => {
    expect(describeFailureCause(new SecretNotFoundError())).toBe('SecretNotFoundError');
    expect(describeFailureCause(Object.assign(new Error('x'), { code: 42 }))).toBe('Error');
    expect(describeFailureCause(undefined)).toBe('non-error:undefined');
  });

  it('[PR3-SEC-15] reads the class name from the prototype chain and accepts Error/Exception-shaped names only', () => {
    const leak = `sk_test_${token()}`;
    // An own `constructor` on the thrown value is ignored.
    expect(describeFailureCause(Object.assign(new TypeError('x'), { constructor: { name: leak } }))).toBe('TypeError');
    expect(describeFailureCause(Object.assign(new Error('x'), { constructor: { name: 'FakeError' } }))).toBe('Error');
    // A prototype whose `constructor` is not a function, or is a getter, is ignored.
    const fakeProto = Object.create(Error.prototype, { constructor: { value: { name: 'LeakError' } } }) as object;
    expect(describeFailureCause(Object.setPrototypeOf(new Error('x'), fakeProto))).toBe('Error');
    const getterProto = Object.create(Error.prototype, { constructor: { get: () => ({ name: 'GetterError' }) } }) as object;
    expect(describeFailureCause(Object.setPrototypeOf(new Error('x'), getterProto))).toBe('Error');
    // A class whose name is data-shaped rather than Error-shaped.
    class ProviderFault extends Error {}
    const dataNamed = class extends Error {};
    Object.defineProperty(dataNamed, 'name', { value: leak });
    expect([describeFailureCause(new ProviderFault('x')), describeFailureCause(new dataNamed('x'))]).toEqual(['Error', 'Error']);
    class VaultTimeoutException extends Error {}
    expect(describeFailureCause(new VaultTimeoutException('x'))).toBe('VaultTimeoutException');
  });

  it('property: no value thrown, returned or echoed by a provider appears in any issue, message, inspect or stack', async () => {
    const throwables: Readonly<Record<string, (value: string) => unknown>> = {
      message: (value) => new Error(value),
      code: (value) => Object.assign(new Error('failed'), { code: value.toUpperCase() }),
      name: (value) => Object.assign(new Error('failed'), { name: value }),
      raw: (value) => value,
      // PR3-SEC-15: an own `constructor` property, and a dynamically named class, on the thrown value.
      ownConstructor: (value) => Object.assign(new Error('failed'), { constructor: { name: `Leak${value}Error` } }),
      namedClass: (value) => {
        const leaky = class extends Error {};
        Object.defineProperty(leaky, 'name', { value: `L${value}Error` });
        return new leaky('failed');
      },
    };
    await fc.assert(
      fc.asyncProperty(
        fc.uint8Array({ minLength: 12, maxLength: 32 }).map((bytes) => Buffer.from(bytes).toString('hex')),
        fc.constantFrom(...Object.values(throwables)),
        async (value, makeThrowable) => {
          const thrown = makeThrowable(value);
          const provider = scripted({ leak: [() => rejectWith(thrown)] });
          const error = await rejection(resolveSecretRefs(refs({ A_REF: aws('leak') }), [provider], instant));
          const surfaces = [
            error.message,
            formatConfigError(error),
            inspect(error, { depth: 5 }),
            String(error.stack),
            JSON.stringify(error.issues),
          ];
          for (const surface of surfaces) {
            expect(surface).not.toContain(value);
            expect(surface.toLowerCase()).not.toContain(value.toLowerCase());
          }
        },
      ),
      { numRuns: 50 },
    );
  });
});

describe('issue causes', () => {
  it('sort and de-duplicate by cause after key, code and rule', () => {
    const error = new ConfigValidationError([
      { key: 'A_REF', code: 'unresolvable', rule: 'ref.providerError', cause: 'TypeError' },
      { key: 'A_REF', code: 'unresolvable', rule: 'ref.providerError', cause: 'Error' },
      { key: 'A_REF', code: 'unresolvable', rule: 'ref.providerError', cause: 'TypeError' },
    ]);
    expect(error.issues.map((issue) => issue.cause)).toEqual(['Error', 'TypeError']);
    expect(error.message).toBe(
      'Configuration rejected for 1 key(s): A_REF (unresolvable: ref.providerError (Error)), A_REF (unresolvable: ref.providerError (TypeError))',
    );
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

  it('[m3] accepts a rotated password that merely contains <…> or a placeholder word', () => {
    const secrets = resolved({ CARRIER_UPS_SECRET_REF: 'Xk9<q!Tz>2wP', SMTP_PASSWORD_REF: 'exchangemerchant-7Qp!' });
    expect(checkResolvedSecrets(secrets, { appEnv: 'production', allowFullStripeTestKey: false })).toEqual([]);
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
