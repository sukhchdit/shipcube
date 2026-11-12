/**
 * Secret references (ADR-0018 §3, amendment item 1). Configuration holds references (`*_REF`), never secret
 * values; a `SecretProvider` resolves them once at start-up:
 *
 *   env:<VAR_NAME>                       local/CI: the reference names the variable holding the value
 *   <VAR_NAME>                           shorthand for env:<VAR_NAME>
 *   file:/run/secrets/<name>             Compose secret file (absolute container path)
 *   aws-secrets-manager:<arn|name>       Secrets Manager (M5; adapter supplied by the consuming task)
 *
 * Resolution is an edge concern: this module defines the port, the parser, an orchestrator with a timeout per
 * call, the pure `env` adapter and the post-resolution checks. Resolved values stay inside `Secret` wrappers and
 * every error names the configuration key only.
 */
import { type AppEnv, isHardenedAppEnv } from './environment.js';
import { type ConfigIssue, ConfigValidationError } from './errors.js';
import type { ParseResult } from './keys.js';
import { isPlaceholder } from './placeholders.js';
import { Secret } from './secret.js';

export const SECRET_PROVIDER_KINDS = ['env', 'file', 'aws-secrets-manager'] as const;
export type SecretProviderKind = (typeof SECRET_PROVIDER_KINDS)[number];

export interface SecretRef {
  readonly provider: SecretProviderKind;
  readonly locator: string;
}

const ENV_NAME = /^[A-Z][A-Z0-9_]{0,127}$/;
const FILE_PATH = /^\/(?:[A-Za-z0-9._-]+\/)*[A-Za-z0-9._-]+$/;
const AWS_SECRET_ID = /^(?:arn:aws[a-z-]*:secretsmanager:[a-z0-9-]+:\d{12}:secret:[A-Za-z0-9/_+=.@-]+|[A-Za-z0-9/_+=.@-]{1,512})$/;

const fail = (rule: string): ParseResult<SecretRef> => ({ ok: false, rule });
const ref = (provider: SecretProviderKind, locator: string): ParseResult<SecretRef> => ({
  ok: true,
  value: Object.freeze({ provider, locator }),
});

/** Parses a secret reference. The rule of a failure names the format problem, never the input. */
export function parseSecretRef(raw: string): ParseResult<SecretRef> {
  if (ENV_NAME.test(raw)) return ref('env', raw);
  const separator = raw.indexOf(':');
  if (separator <= 0) return fail('ref.format');
  const scheme = raw.slice(0, separator);
  const locator = raw.slice(separator + 1);
  switch (scheme) {
    case 'env':
      return ENV_NAME.test(locator) ? ref('env', locator) : fail('ref.envName');
    case 'file':
      return FILE_PATH.test(locator) && !locator.split('/').includes('..') ? ref('file', locator) : fail('ref.filePath');
    case 'aws-secrets-manager':
      return AWS_SECRET_ID.test(locator) ? ref('aws-secrets-manager', locator) : fail('ref.awsSecretId');
    default:
      return fail('ref.provider');
  }
}

/** Port implemented by each secret backend. `resolve` must honour `signal` and must not log the value. */
export interface SecretProvider {
  readonly kind: SecretProviderKind;
  resolve(locator: string, signal: AbortSignal): Promise<string>;
}

/** Thrown by providers when a reference points at nothing. Carries no locator or value. */
export class SecretNotFoundError extends Error {
  override readonly name = 'SecretNotFoundError';
  constructor() {
    super('Secret reference did not resolve to a value');
  }
}

/** `env` provider over an explicit environment record (the edge passes `process.env`). */
export function createEnvSecretProvider(env: Readonly<Record<string, string | undefined>>): SecretProvider {
  return Object.freeze({
    kind: 'env' as const,
    resolve(locator: string): Promise<string> {
      const value = env[locator];
      return value === undefined || value === '' ? Promise.reject(new SecretNotFoundError()) : Promise.resolve(value);
    },
  });
}

/** Default budget per secret lookup; start-up must fail within 5 s (NFR-OPS-005). */
export const SECRET_RESOLVE_TIMEOUT_MS = 2_000;

export interface ResolveSecretRefsOptions {
  readonly timeoutMs?: number;
}

async function resolveOne(ref: SecretRef, provider: SecretProvider | undefined, timeoutMs: number): Promise<Secret<string> | undefined> {
  if (provider === undefined) return undefined;
  try {
    const value = await provider.resolve(ref.locator, AbortSignal.timeout(timeoutMs));
    return value === '' ? undefined : new Secret(value);
  } catch {
    return undefined;
  }
}

/**
 * Resolves every reference concurrently, each bounded by `timeoutMs`. Throws `ConfigValidationError` naming
 * every key whose reference has no provider, times out, fails or resolves to an empty value.
 */
export async function resolveSecretRefs(
  refs: ReadonlyMap<string, SecretRef>,
  providers: readonly SecretProvider[],
  options: ResolveSecretRefsOptions = {},
): Promise<ReadonlyMap<string, Secret<string>>> {
  const timeoutMs = options.timeoutMs ?? SECRET_RESOLVE_TIMEOUT_MS;
  const entries = [...refs];
  const values = await Promise.all(
    entries.map(([, ref]) =>
      resolveOne(
        ref,
        providers.find((provider) => provider.kind === ref.provider),
        timeoutMs,
      ),
    ),
  );
  const issues: ConfigIssue[] = [];
  const resolved = new Map<string, Secret<string>>();
  entries.forEach(([key], index) => {
    const value = values[index];
    if (value === undefined) issues.push({ key, code: 'unresolvable' });
    else resolved.set(key, value);
  });
  if (issues.length > 0) throw new ConfigValidationError(issues);
  return resolved;
}

export interface ResolvedSecretContext {
  readonly appEnv: AppEnv;
  /** `PAYMENT_ALLOW_FULL_TEST_KEY`: accept an `sk_test_` key instead of the restricted `rk_test_` key. */
  readonly allowFullStripeTestKey: boolean;
}

const STRIPE_LIVE_KEY = /^(?:sk|rk)_live_/;
const STRIPE_FULL_TEST_KEY = /^sk_test_[A-Za-z0-9]+$/;
const STRIPE_RESTRICTED_TEST_KEY = /^rk_test_[A-Za-z0-9]+$/;
const STRIPE_WEBHOOK_SECRET = /^whsec_[A-Za-z0-9+/=]+$/;

function stripeKeyIssue(key: string, value: string, allowFullTestKey: boolean): ConfigIssue | undefined {
  if (STRIPE_LIVE_KEY.test(value)) return { key, code: 'live-key-forbidden' };
  if (STRIPE_RESTRICTED_TEST_KEY.test(value)) return undefined;
  if (STRIPE_FULL_TEST_KEY.test(value)) return allowFullTestKey ? undefined : { key, code: 'invalid', rule: 'stripe.fullTestKey' };
  return { key, code: 'invalid', rule: 'stripe.keyFormat' };
}

/**
 * Checks resolved secret values (ADR-0018 §3, platform.md §9.2): placeholders are refused in staging and
 * production, a live Stripe key is refused (`PAYMENT_LIVE_KEY_FORBIDDEN`), an `sk_test_` key needs
 * `PAYMENT_ALLOW_FULL_TEST_KEY`, and the webhook secret must be a `whsec_` secret. Values are inspected in memory
 * and never copied into the returned issues.
 */
export function checkResolvedSecrets(
  resolved: ReadonlyMap<string, Secret<string>>,
  context: ResolvedSecretContext,
): readonly ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  for (const [key, secret] of resolved) {
    const value = secret.reveal();
    if (isHardenedAppEnv(context.appEnv) && isPlaceholder(value)) {
      issues.push({ key, code: 'placeholder' });
      continue;
    }
    if (key === 'STRIPE_SECRET_KEY_REF') {
      const issue = stripeKeyIssue(key, value, context.allowFullStripeTestKey);
      if (issue !== undefined) issues.push(issue);
    } else if (key === 'STRIPE_WEBHOOK_SECRET_REF' && !STRIPE_WEBHOOK_SECRET.test(value)) {
      issues.push({ key, code: 'invalid', rule: 'stripe.webhookSecretFormat' });
    }
  }
  return issues;
}
