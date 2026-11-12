/**
 * Secret references (ADR-0018 §3, amendment item 1). Configuration holds references (`*_REF`), never secret
 * values; a `SecretProvider` resolves them once at start-up:
 *
 *   env:<VAR_NAME>                       local/CI: the reference names the variable holding the value
 *   <VAR_NAME>                           shorthand for env:<VAR_NAME>
 *   file:/run/secrets/<name>             Compose secret file (absolute container path)
 *   aws-secrets-manager:<arn|name>       Secrets Manager (M5; adapter supplied by the consuming task)
 *
 * Resolution is an edge concern: this module defines the port, the parser, an orchestrator that enforces a
 * per-attempt timeout, an overall deadline and one jittered retry, the pure `env` adapter and the post-resolution
 * checks. The `file` adapter is `file-secret-provider.ts`. Resolved values stay inside `Secret` wrappers and
 * every error names the configuration key only.
 */
import { setTimeout as delay } from 'node:timers/promises';

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
/** Directory every `file:` reference must live under (Compose/ECS secret mounts). */
export const SECRET_FILE_ROOT = '/run/secrets';
/**
 * `file:` locators are absolute POSIX paths of 1–4 segments under `/run/secrets`. A segment never starts with a
 * dot, so `.`, `..` and hidden names cannot appear; `//`, backslashes, NUL and other characters cannot match.
 * The path is therefore already lexically normal. The file provider also confines the real path (symlinks).
 */
const FILE_PATH = /^\/run\/secrets(?:\/[A-Za-z0-9_-][A-Za-z0-9._-]{0,127}){1,4}$/;
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
      return FILE_PATH.test(locator) ? ref('file', locator) : fail('ref.filePath');
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

/** Default budget per secret lookup attempt. */
export const SECRET_RESOLVE_TIMEOUT_MS = 2_000;

/** Default budget for one `resolveSecretRefs` call, retries included: start-up must fail within 5 s (NFR-OPS-005). */
export const SECRET_RESOLVE_DEADLINE_MS = 4_500;

/** Bounds of the delay before the single retry (uniform jitter). A secret read is idempotent (CLAUDE.md §9). */
export const SECRET_RESOLVE_RETRY_DELAY_MS = Object.freeze({ min: 100, max: 300 });

/** Value-free failure classes, reported as `ConfigIssue.rule` on an `unresolvable` issue. */
export const SECRET_RESOLVE_FAILURES = ['ref.noProvider', 'ref.timeout', 'ref.notFound', 'ref.empty', 'ref.providerError'] as const;
export type SecretResolveFailure = (typeof SECRET_RESOLVE_FAILURES)[number];

/** Transient failures get one more attempt; a missing or empty secret does not appear by retrying. */
const RETRYABLE: ReadonlySet<SecretResolveFailure> = new Set(['ref.timeout', 'ref.providerError']);

export interface ResolveSecretRefsOptions {
  /** Budget per attempt; defaults to `SECRET_RESOLVE_TIMEOUT_MS`. */
  readonly timeoutMs?: number;
  /** Budget for the whole call, retries included; defaults to `SECRET_RESOLVE_DEADLINE_MS`. */
  readonly deadlineMs?: number;
  /** Uniform random number in [0, 1) for the retry jitter (test seam); defaults to `Math.random`. */
  readonly random?: () => number;
  /** Waits before the retry (test seam); defaults to `timers/promises#setTimeout`. */
  readonly sleep?: (ms: number) => Promise<void>;
}

type Outcome =
  | { readonly ok: true; readonly value: Secret<string> }
  | { readonly ok: false; readonly rule: SecretResolveFailure; readonly cause?: string };

const failure = (rule: SecretResolveFailure, cause?: string): Outcome =>
  cause === undefined ? { ok: false, rule } : { ok: false, rule, cause };

const IDENTIFIER = /^[A-Za-z_$][A-Za-z0-9_$]{0,63}$/;
/**
 * errno (`EACCES`), Node (`ERR_INVALID_ARG_TYPE`) and provider (`SECRET_FILE_TOO_LARGE`) codes only, letters and
 * underscores, so a token-shaped value cannot pass.
 */
const ERRNO_CODE = /^(?:E[A-Z]{2,15}|ERR_[A-Z_]{1,40}|SECRET_[A-Z_]{1,40})$/;
const typeName = (value: unknown): string => (value === null ? 'null' : typeof value);

/**
 * Value-free description of a thrown value: the constructor name (defined by code, never by data) plus an
 * errno-style `code` when present. Messages are never read, because providers may echo locators or values.
 */
export function describeFailureCause(error: unknown): string {
  if (!(error instanceof Error)) return `non-error:${typeName(error)}`;
  const className: unknown = error.constructor.name;
  const name = typeof className === 'string' && IDENTIFIER.test(className) ? className : 'Error';
  const code: unknown = (error as { code?: unknown }).code;
  return typeof code === 'string' && ERRNO_CODE.test(code) ? `${name}/${code}` : name;
}

function classifyFailure(error: unknown, signal: AbortSignal): Outcome {
  if (signal.aborted) return failure('ref.timeout');
  if (error instanceof SecretNotFoundError) return failure('ref.notFound');
  return failure('ref.providerError', describeFailureCause(error));
}

function classifyValue(value: unknown): Outcome {
  if (typeof value !== 'string') return failure('ref.providerError', `non-string:${typeName(value)}`);
  return value === '' ? failure('ref.empty') : { ok: true, value: new Secret(value) };
}

/**
 * One bounded attempt. The provider receives an abort signal, and the orchestrator also races the provider
 * against that signal, so a provider that ignores it cannot hold start-up past `timeoutMs` or the deadline.
 */
async function attemptResolve(provider: SecretProvider, locator: string, timeoutMs: number, deadline: AbortSignal): Promise<Outcome> {
  if (deadline.aborted) return failure('ref.timeout');
  const attempt = new AbortController();
  const timer = setTimeout(() => attempt.abort(new DOMException('Secret resolution timed out', 'TimeoutError')), timeoutMs);
  const signal = AbortSignal.any([attempt.signal, deadline]);
  let onAbort: () => void = () => undefined;
  const aborted = new Promise<never>((_resolve, reject) => {
    // classifyFailure keys on `signal.aborted`, not on this reason; a non-Error abort reason is normalised.
    onAbort = () => reject(signal.reason instanceof Error ? signal.reason : new DOMException('Secret resolution aborted', 'AbortError'));
    signal.addEventListener('abort', onAbort, { once: true });
  });
  try {
    return classifyValue(await Promise.race([provider.resolve(locator, signal), aborted]));
  } catch (error) {
    return classifyFailure(error, signal);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener('abort', onAbort);
  }
}

interface ResolvePlan {
  readonly timeoutMs: number;
  readonly deadlineAt: number;
  readonly deadline: AbortSignal;
  readonly random: () => number;
  readonly sleep: (ms: number) => Promise<void>;
}

/** One attempt, then at most one jittered retry of a transient failure when a full attempt still fits the deadline. */
async function resolveOne(ref: SecretRef, provider: SecretProvider | undefined, plan: ResolvePlan): Promise<Outcome> {
  if (provider === undefined) return failure('ref.noProvider');
  const first = await attemptResolve(provider, ref.locator, plan.timeoutMs, plan.deadline);
  if (first.ok || !RETRYABLE.has(first.rule)) return first;
  const { min, max } = SECRET_RESOLVE_RETRY_DELAY_MS;
  const delayMs = Math.round(min + plan.random() * (max - min));
  if (plan.deadlineAt - performance.now() < delayMs + plan.timeoutMs) return first;
  await plan.sleep(delayMs);
  return attemptResolve(provider, ref.locator, plan.timeoutMs, plan.deadline);
}

function positiveBudget(name: string, value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0) throw new RangeError(`${name} must be a positive integer number of milliseconds`);
  return value;
}

const issueFor = (key: string, outcome: Extract<Outcome, { ok: false }>): ConfigIssue =>
  outcome.cause === undefined
    ? { key, code: 'unresolvable', rule: outcome.rule }
    : { key, code: 'unresolvable', rule: outcome.rule, cause: outcome.cause };

/**
 * Resolves every reference concurrently. Each attempt is bounded by `timeoutMs` and the whole call by
 * `deadlineMs`, whether or not a provider honours its abort signal. A timeout or provider error is retried once
 * after 100–300 ms of jitter when a full attempt still fits the deadline. Throws `ConfigValidationError` with
 * one `unresolvable` issue per failed key; its rule is the failure class (`ref.noProvider`, `ref.timeout`,
 * `ref.notFound`, `ref.empty`, `ref.providerError` with a value-free `cause`). No locator or value is reported.
 */
export async function resolveSecretRefs(
  refs: ReadonlyMap<string, SecretRef>,
  providers: readonly SecretProvider[],
  options: ResolveSecretRefsOptions = {},
): Promise<ReadonlyMap<string, Secret<string>>> {
  const timeoutMs = positiveBudget('timeoutMs', options.timeoutMs ?? SECRET_RESOLVE_TIMEOUT_MS);
  const deadlineMs = positiveBudget('deadlineMs', options.deadlineMs ?? SECRET_RESOLVE_DEADLINE_MS);
  const deadline = new AbortController();
  const deadlineTimer = setTimeout(
    () => deadline.abort(new DOMException('Secret resolution deadline exceeded', 'TimeoutError')),
    deadlineMs,
  );
  const plan: ResolvePlan = {
    timeoutMs,
    deadlineAt: performance.now() + deadlineMs,
    deadline: deadline.signal,
    random: options.random ?? Math.random,
    sleep: options.sleep ?? ((ms) => delay(ms)),
  };
  try {
    const outcomes = await Promise.all(
      [...refs].map(async ([key, ref]) => {
        const provider = providers.find((candidate) => candidate.kind === ref.provider);
        return [key, await resolveOne(ref, provider, plan)] as const;
      }),
    );
    const issues: ConfigIssue[] = [];
    const resolved = new Map<string, Secret<string>>();
    for (const [key, outcome] of outcomes) {
      if (outcome.ok) resolved.set(key, outcome.value);
      else issues.push(issueFor(key, outcome));
    }
    if (issues.length > 0) throw new ConfigValidationError(issues);
    return resolved;
  } finally {
    clearTimeout(deadlineTimer);
  }
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
