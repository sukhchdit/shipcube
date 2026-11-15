/**
 * The runtime configuration schema of the API and the worker (ADR-0018 §1–2, REQ-PLAT-004, NFR-OPS-005).
 *
 * One source: each entry of `CONFIG_SCHEMA` pairs a Joi validator (the backend convention) with its TypeScript
 * value type, sensitivity, per-service requirement, environment-aware default and documentation. The `Config`
 * type, the Joi object schema, the secret-key list for log redaction and the `.env.example` parity test are all
 * derived from it, so there is no hand-written interface that could drift.
 *
 * Cross-key policies (placeholders, transport, debug flags, Mock gating, key reuse) live in `guards.ts`.
 */
import Joi from 'joi';

import { isBrandName, isBrandUrl, LOCALES } from './brand-rules.js';
import { parseDurationSeconds } from './durations.js';
import { APP_ENVS, type AppEnv, isLocalAppEnv, NODE_ENVS, type Service, SERVICES } from './environment.js';
import {
  type KeyVersion,
  type ParseResult,
  parseKeySet,
  parseKeyVersion,
  parsePublicKeySet,
  type PublicKeyVersion,
  registerEntryFor,
} from './keys.js';
import { parseSecretRef, type SecretRef } from './secret-refs.js';
import { Secret } from './secret.js';

/** `secret` values are wrapped in `Secret` and redacted; `secret-ref` values are references to secrets. */
export type Sensitivity = 'secret' | 'secret-ref' | 'public' | 'internal';

/** A Joi validator together with the TypeScript type of the value it produces. */
export interface Typed<T> {
  readonly joi: Joi.Schema;
  readonly __type?: T;
}

export interface KeySpec<T = unknown, Optional extends boolean = boolean> {
  readonly joi: Joi.Schema;
  readonly description: string;
  readonly sensitivity: Sensitivity;
  /** Services that refuse to start without the key (keys with a default are never missing). */
  readonly requiredFor: readonly Service[];
  /** `true` when the loaded value may be `undefined`. */
  readonly optional: Optional;
  readonly defaultFor?: DefaultFor<T>;
  readonly __type?: T;
}

/** A default that may depend on `APP_ENV` (ADR-0010 am. 9) and on the loading service (pool sizes). */
export type DefaultFor<T> = (appEnv: AppEnv | undefined, service: Service) => T;

interface Meta {
  readonly description: string;
  readonly sensitivity?: Sensitivity;
}

const typed = <T>(joi: Joi.Schema): Typed<T> => ({ joi });

const spec = <T, O extends boolean>(t: Typed<T>, meta: Meta, requiredFor: readonly Service[], optional: O): KeySpec<T, O> => ({
  joi: t.joi,
  description: meta.description,
  sensitivity: meta.sensitivity ?? 'internal',
  requiredFor,
  optional,
});

/** Required by every service. */
const required = <T>(t: Typed<T>, meta: Meta): KeySpec<T, false> => spec(t, meta, SERVICES, false);

/** Required by `services` only; optional (possibly `undefined`) elsewhere. */
const requiredFor = <T>(services: readonly Service[], t: Typed<T>, meta: Meta): KeySpec<T, true> => spec(t, meta, services, true);

const optional = <T>(t: Typed<T>, meta: Meta): KeySpec<T, true> => spec(t, meta, [], true);

/** Optional key with a default; the default may depend on `APP_ENV` (ADR-0010 am. 9) and on the service. */
const withDefault = <T>(t: Typed<T>, fallback: T | DefaultFor<T>, meta: Meta): KeySpec<T, false> => ({
  ...spec(t, meta, [], false),
  defaultFor: typeof fallback === 'function' ? (fallback as DefaultFor<T>) : () => fallback,
});

/** Wraps a parser as a Joi string rule; a failure reports `any.invalid` with the parser's rule id (no value). */
const parsed = <T>(parse: (raw: string) => ParseResult<T>): Typed<T> =>
  typed(
    Joi.string().custom((value: string, helpers) => {
      const result = parse(value);
      return result.ok ? result.value : helpers.error('any.invalid', { rule: result.rule });
    }),
  );

/** A `brand-rules.ts` predicate as a Joi `.custom` rule; a failure reports `any.invalid` with `rule` (no value). */
const sharedPredicate =
  (accepts: (value: string) => boolean, rule: string): Joi.CustomValidator<string> =>
  (value, helpers) =>
    accepts(value) ? value : helpers.error('any.invalid', { rule });

const t = {
  string: (pattern?: RegExp, max = 256): Typed<string> =>
    typed(pattern === undefined ? Joi.string().max(max) : Joi.string().max(max).pattern(pattern)),
  oneOf: <const V extends string>(values: readonly V[]): Typed<V> => typed(Joi.string().valid(...values)),
  int: (min: number, max: number): Typed<number> => typed(Joi.number().integer().min(min).max(max)),
  port: (): Typed<number> => typed(Joi.number().port()),
  bool: (): Typed<boolean> => typed(Joi.boolean()),
  duration: (maxSeconds: number): Typed<number> =>
    parsed((raw): ParseResult<number> => {
      const seconds = parseDurationSeconds(raw);
      if (seconds === undefined) return { ok: false, rule: 'duration.format' };
      return seconds <= maxSeconds ? { ok: true, value: seconds } : { ok: false, rule: 'duration.max' };
    }),
  url: (schemes: readonly string[]): Typed<string> => typed(Joi.string().uri({ scheme: [...schemes] })),
  origin: (): Typed<string> =>
    typed(
      Joi.string()
        .uri({ scheme: ['http', 'https'] })
        .custom((value: string, helpers) =>
          new URL(value).origin === value ? value : helpers.error('any.invalid', { rule: 'origin.path' }),
        ),
    ),
  email: (): Typed<string> => typed(Joi.string().email({ tlds: false })),
  secretUrl: (schemes: readonly string[]): Typed<Secret<string>> =>
    typed(
      Joi.string()
        .uri({ scheme: [...schemes] })
        .custom((value: string) => new Secret(value)),
    ),
  secretString: (min: number, max: number): Typed<Secret<string>> =>
    typed(
      Joi.string()
        .min(min)
        .max(max)
        .custom((value: string) => new Secret(value)),
    ),
  secretRef: (): Typed<SecretRef> => parsed(parseSecretRef),
  key: (variable: string): Typed<KeyVersion> => parsed((raw) => parseKeyVersion(registerEntryFor(variable), raw)),
  keySet: (variable: string): Typed<readonly KeyVersion[]> => parsed((raw) => parseKeySet(registerEntryFor(variable), raw)),
  publicKeySet: (purpose: string): Typed<readonly PublicKeyVersion[]> => parsed((raw) => parsePublicKeySet(purpose, raw)),
  /** `BRAND_NAME`: trimmed, 1..40 code points; the predicate is shared with the web Zod schema (`brand-rules.ts`). */
  brandName: (): Typed<string> =>
    typed(
      Joi.string().custom((value: string, helpers) => {
        // Trimmed inside the rule (as Zod `.trim()` does), so a whitespace-only name fails `brand.name` on both sides.
        const trimmed = value.trim();
        return isBrandName(trimmed) ? trimmed : helpers.error('any.invalid', { rule: 'brand.name' });
      }),
    ),
  /** Absolute http(s) URL or root-relative path; the predicate is shared with the web Zod schema (`brand-rules.ts`). */
  urlOrRootPath: (): Typed<string> => typed(Joi.string().custom(sharedPredicate(isBrandUrl, 'brand.url'))),
};

/** Lowest accepted bcrypt cost (REQ-AUTH-003, NFR-SEC-003, ADR-0006). */
export const BCRYPT_COST_FLOOR = 12;
/** bcrypt's own upper bound for the cost factor. */
export const BCRYPT_COST_MAX = 31;

/** Upper bound of `DB_POOL_MAX` (the TASK-003 pool factory allows 200; config is deliberately stricter). */
export const DB_POOL_MAX_LIMIT = 100;
/** Per-process pool size by service (data-model §7.1, platform.md §5). */
export const DB_POOL_MAX_DEFAULTS: Readonly<Record<Service, number>> = Object.freeze({ api: 10, worker: 5 });
/** Defaults equal to the TASK-003 pool factory defaults (apps/api/src/platform/db/client.ts). */
export const DB_IDLE_TIMEOUT_MS_DEFAULT = 10_000;
export const DB_CONNECTION_TIMEOUT_MS_DEFAULT = 5_000;
/**
 * Floor of `DB_CONNECTION_TIMEOUT_MS` (PR #38 code review R1-m2, PR38-SEC-05). The tenant-transaction runner, which
 * the API and the worker always build, waits up to its `maxWait` (apps/api `DEFAULT_MAX_WAIT_MS`, a code constant, not
 * a key) for a pooled connection and refuses a pool timeout below it. Refusing the value here makes it a configuration
 * error at load (exit 78, key named) instead of a boot crash (exit 1). apps/api pins the parity with the constant.
 */
export const DB_CONNECTION_TIMEOUT_MS_MIN = 2_000;
/**
 * Pool-level `statement_timeout` backstop (PR-0005 code review m7), default 25 000 ms (below the 30 s request cap of
 * REQ-SEC-015); the role backstop (TASK-016, 30 s) applies only to sessions outside the pool, because this startup
 * parameter overrides a role default on every pooled connection. Request transactions set a tighter 5 s with
 * `set_config` (data-model §4.1, T5).
 */
export const DB_STATEMENT_TIMEOUT_MS_DEFAULT = 25_000;
/** Upper bound of `DB_STATEMENT_TIMEOUT_MS`: long worker jobs batch their work instead (data-model §7). */
export const DB_STATEMENT_TIMEOUT_MS_LIMIT = 300_000;
/**
 * Per-transaction timeouts set by `withTenantTx`'s context statement (data-model §4.1 settings 6-8; ADR-0005 am. 10
 * item 12, TASK-016). They win over the `platform_app` role defaults, which the role itself can rewrite.
 */
export const DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT = 5_000;
export const DB_TX_LOCK_TIMEOUT_MS_DEFAULT = 2_000;
export const DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS_DEFAULT = 15_000;
/** Inclusive bounds of the three `DB_TX_*` keys, in milliseconds. */
export const DB_TX_TIMEOUT_BOUNDS = Object.freeze({
  DB_TX_STATEMENT_TIMEOUT_MS: Object.freeze({ min: 100, max: 120_000 }),
  DB_TX_LOCK_TIMEOUT_MS: Object.freeze({ min: 100, max: 60_000 }),
  DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: Object.freeze({ min: 1_000, max: 600_000 }),
});
const txTimeout = (key: keyof typeof DB_TX_TIMEOUT_BOUNDS): Typed<number> =>
  t.int(DB_TX_TIMEOUT_BOUNDS[key].min, DB_TX_TIMEOUT_BOUNDS[key].max);
/**
 * Per-tenant admission bulkhead of `withTenantTx` (ADR-0007 am. 10 item 3, D-ARCH-086, data-model §7.7): at most
 * `DB_TENANT_MAX_CONCURRENT_TX` concurrent transactions per organisation per process. The key has no schema default
 * because its default depends on `DB_POOL_MAX` (a `DefaultFor` sees only APP_ENV and the service): unset means
 * {@link defaultTenantMaxConcurrentTx} of the loaded pool size, applied by apps/api `tenantTxOptionsFromConfig`. A set
 * value above `DB_POOL_MAX` is refused by the `databaseGuard`.
 */
export const DB_TENANT_MAX_CONCURRENT_TX_FLOOR = 2;
/** The default admission cap for a pool of `poolMax` connections: `max(2, floor(poolMax / 2))`. */
export const defaultTenantMaxConcurrentTx = (poolMax: number): number =>
  Math.max(DB_TENANT_MAX_CONCURRENT_TX_FLOOR, Math.floor(poolMax / 2));
export const DB_TENANT_ADMISSION_WAIT_MS_DEFAULT = 250;
/**
 * Upper bound of `DB_TENANT_ADMISSION_WAIT_MS`: the tenant-transaction `maxWait` (apps/api `DEFAULT_MAX_WAIT_MS`, a code
 * constant, not a key). The runner refuses a longer admission wait at boot; refusing it here makes it a configuration
 * error at load (exit 78). apps/api pins the parity with the constant.
 */
export const DB_TENANT_ADMISSION_WAIT_MS_MAX = 2_000;
/**
 * Transaction-local `lock_timeout` of the audit insert (ADR-0007 am. 10 item 2; TASK-025), strictly below
 * `DB_TX_LOCK_TIMEOUT_MS` (the `databaseGuard` refuses anything else), so an audit lock wait fails first and maps to
 * AUDIT_LOCK_TIMEOUT.
 */
export const DB_AUDIT_LOCK_TIMEOUT_MS_DEFAULT = 250;
export const DB_AUDIT_LOCK_TIMEOUT_MS_BOUNDS = Object.freeze({ min: 1, max: DB_TX_TIMEOUT_BOUNDS.DB_TX_LOCK_TIMEOUT_MS.max - 1 });

const MINUTE = 60;
const HOUR = 3_600;
const DAY = 86_400;

const localOnly = (appEnv: AppEnv | undefined): boolean => isLocalAppEnv(appEnv);
const POSTGRES = ['postgres', 'postgresql'] as const;
const S3_BUCKET = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;
const HOSTNAME = /^[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?(\.[A-Za-z0-9]([A-Za-z0-9-]{0,61}[A-Za-z0-9])?)*$/;
const RELATIVE_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._\-/]+$/;

const key = (variable: string, description: string): KeySpec<KeyVersion, true> =>
  requiredFor(registerEntryFor(variable).requiredFor, t.key(variable), { description, sensitivity: 'secret' });

const previousKey = (variable: string): KeySpec<KeyVersion, true> =>
  optional(t.key(variable), { description: `Retired ${variable} kept for dual reads during rotation.`, sensitivity: 'secret' });

const carrier = (code: string) =>
  ({
    enabled: withDefault(t.bool(), false, { description: `Enable the ${code} sandbox adapter (needs CARRIER_${code}_SECRET_REF).` }),
    environment: withDefault(t.oneOf(['sandbox'] as const), 'sandbox', {
      description: `${code} endpoint set; only sandbox is permitted before G4 (CLAUDE.md §5).`,
    }),
    secretRef: optional(t.secretRef(), { description: `Reference to the ${code} sandbox credentials.`, sensitivity: 'secret-ref' }),
  }) as const;

const dhl = carrier('DHL');
const fedex = carrier('FEDEX');
const ups = carrier('UPS');

export const CONFIG_SCHEMA = {
  // Process and application (APP_*)
  NODE_ENV: withDefault(t.oneOf(NODE_ENVS), 'development', { description: 'Node.js runtime mode.' }),
  APP_ENV: required(t.oneOf(APP_ENVS), { description: 'Deployment environment; drives guards, not behaviour forks (ADR-0018 §4).' }),
  APP_PORT: withDefault(t.port(), 3000, { description: 'HTTP port of the API process.' }),
  APP_HEALTH_PORT: withDefault(t.port(), 9464, { description: 'Health and metrics port of the worker process.' }),
  APP_LOG_LEVEL: withDefault(t.oneOf(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'] as const), 'info', {
    description: 'Pino log level.',
  }),
  DOCS_ENABLED: withDefault(t.bool(), localOnly, { description: 'Serve the OpenAPI UI (on by default in local and test only).' }),
  WEB_APP_ORIGIN: required(t.origin(), { description: 'Origin of the customer web app (CORS, CSRF Origin check, links).' }),
  ADMIN_APP_ORIGIN: required(t.origin(), { description: 'Origin of the admin app.' }),
  TRUST_PROXY_HOPS: withDefault(t.int(0, 5), 1, { description: 'Reverse-proxy hops trusted for client IPs (2 behind CloudFront + ALB).' }),
  REGION: withDefault(t.string(/^[a-z0-9-]{2,32}$/), 'local', { description: 'Deployment region label (brief §10 multi-region seam).' }),
  LOCALE_DEFAULT: withDefault(t.oneOf(LOCALES), 'en', { description: 'Fallback locale for e-mails and API messages.' }),
  FEATURE_FLAGS_DEFAULTS_PATH: optional(t.string(RELATIVE_PATH), {
    description: 'Relative path of the feature-flag defaults file (ADR-0027).',
  }),

  // Debug and inspector guards (SEC-P3-08 item 6): refused outside APP_ENV=local
  NODE_DEBUG: optional(t.string(), { description: 'Node core debug sections; must be unset outside local.' }),
  DEBUG: optional(t.string(), { description: 'debug-module namespaces; must be unset outside local.' }),
  NODE_OPTIONS: optional(t.string(undefined, 1024), { description: 'Node options; --inspect* is refused outside local.' }),

  // Brand (BRAND_*), shared with the web build
  BRAND_NAME: required(t.brandName(), {
    description: 'Product name shown in UI and e-mails (≤ 40 chars).',
    sensitivity: 'public',
  }),
  BRAND_LOGO_URL: optional(t.urlOrRootPath(), {
    description: 'Logo URL or root-relative path.',
    sensitivity: 'public',
  }),
  BRAND_LOGO_DARK_URL: optional(t.urlOrRootPath(), { description: 'Dark-theme logo.', sensitivity: 'public' }),
  BRAND_FAVICON_URL: optional(t.urlOrRootPath(), { description: 'Favicon URL.', sensitivity: 'public' }),

  // Database (DB_*; URLs per data-model §7.1)
  DATABASE_URL: required(t.secretUrl(POSTGRES), {
    description: 'PostgreSQL URL of platform_app; sslmode=verify-full outside local/test.',
    sensitivity: 'secret',
  }),
  // DATABASE_MIGRATOR_URL, SHADOW_DATABASE_URL and the bootstrap credentials are tooling keys (`tooling-keys.ts`),
  // never part of the API/worker configuration.
  // The TASK-003 pool factory (apps/api/src/platform/db/client.ts) accepts up to 200 connections; the config
  // bound of 100 is deliberately stricter (data-model §7.1 sizes api 10, worker 5 per process).
  DB_POOL_MAX: withDefault(t.int(1, DB_POOL_MAX_LIMIT), (_appEnv, service) => DB_POOL_MAX_DEFAULTS[service], {
    description: 'pg pool size per process (data-model §7.1: api 10, worker 5).',
  }),
  DB_IDLE_TIMEOUT_MS: withDefault(t.int(1, 3_600_000), DB_IDLE_TIMEOUT_MS_DEFAULT, {
    description: 'Milliseconds an idle pooled connection is kept before it is closed.',
  }),
  DB_CONNECTION_TIMEOUT_MS: withDefault(t.int(DB_CONNECTION_TIMEOUT_MS_MIN, 120_000), DB_CONNECTION_TIMEOUT_MS_DEFAULT, {
    description: 'Milliseconds to wait for a new PostgreSQL connection before failing.',
  }),
  DB_STATEMENT_TIMEOUT_MS: withDefault(t.int(100, DB_STATEMENT_TIMEOUT_MS_LIMIT), DB_STATEMENT_TIMEOUT_MS_DEFAULT, {
    description: 'pg statement_timeout of pooled connections in milliseconds (backstop; requests set 5 s per transaction).',
  }),
  // Per-transaction timeouts of the withTenantTx context statement (data-model §4.1; ADR-0005 am. 10 item 12).
  DB_TX_STATEMENT_TIMEOUT_MS: withDefault(txTimeout('DB_TX_STATEMENT_TIMEOUT_MS'), DB_TX_STATEMENT_TIMEOUT_MS_DEFAULT, {
    description: 'Transaction-local statement_timeout (ms) set by withTenantTx; wins over the 30 s role backstop.',
  }),
  DB_TX_LOCK_TIMEOUT_MS: withDefault(txTimeout('DB_TX_LOCK_TIMEOUT_MS'), DB_TX_LOCK_TIMEOUT_MS_DEFAULT, {
    description: 'Transaction-local lock_timeout (ms) set by withTenantTx; 55P03 maps to a retryable 503.',
  }),
  DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: withDefault(
    txTimeout('DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS'),
    DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS_DEFAULT,
    { description: 'Transaction-local idle_in_transaction_session_timeout (ms) set by withTenantTx.' },
  ),
  // Per-tenant admission bulkhead of withTenantTx (D-ARCH-086, data-model §7.7) and the audit insert lock wait.
  DB_TENANT_MAX_CONCURRENT_TX: optional(t.int(1, DB_POOL_MAX_LIMIT), {
    description: 'Concurrent tenant transactions per organisation per process (≤ DB_POOL_MAX); unset: max(2, DB_POOL_MAX / 2).',
  }),
  DB_TENANT_ADMISSION_WAIT_MS: withDefault(t.int(1, DB_TENANT_ADMISSION_WAIT_MS_MAX), DB_TENANT_ADMISSION_WAIT_MS_DEFAULT, {
    description: 'Milliseconds a tenant transaction waits for admission before a retryable 503 (≤ the 2 000 ms maxWait).',
  }),
  DB_AUDIT_LOCK_TIMEOUT_MS: withDefault(
    t.int(DB_AUDIT_LOCK_TIMEOUT_MS_BOUNDS.min, DB_AUDIT_LOCK_TIMEOUT_MS_BOUNDS.max),
    DB_AUDIT_LOCK_TIMEOUT_MS_DEFAULT,
    { description: 'Transaction-local lock_timeout (ms) of the audit insert; must be below DB_TX_LOCK_TIMEOUT_MS.' },
  ),

  // Valkey (REDIS_*)
  REDIS_URL: required(t.secretUrl(['redis', 'rediss']), {
    description: "Valkey URL with this service's ACL user; rediss:// outside local/test.",
    sensitivity: 'secret',
  }),

  // Identity and sessions (AUTH_*; ADR-0006)
  AUTH_ACCESS_TOKEN_TTL_SECONDS: withDefault(t.int(60, 15 * MINUTE), 15 * MINUTE, {
    description: 'Access-token lifetime in seconds (≤ 15 min).',
  }),
  // Durations are written as `<n><s|m|h|d>` and loaded as seconds; defaults are given in seconds.
  AUTH_REFRESH_TTL: withDefault(t.duration(30 * DAY), 30 * DAY, {
    description:
      'Sliding refresh lifetime (fallback 7d if the auth_time step-up is not delivered, ADR-0006 am.); ≤ AUTH_SESSION_ABSOLUTE_TTL.',
  }),
  AUTH_SESSION_ABSOLUTE_TTL: withDefault(t.duration(30 * DAY), 30 * DAY, { description: 'Customer absolute session cap (≤ 30d).' }),
  AUTH_ADMIN_REFRESH_IDLE_TTL: withDefault(t.duration(30 * MINUTE), 30 * MINUTE, {
    description: 'Admin idle timeout (≤ 30m); ≤ AUTH_ADMIN_SESSION_ABSOLUTE_TTL.',
  }),
  AUTH_ADMIN_SESSION_ABSOLUTE_TTL: withDefault(t.duration(12 * HOUR), 12 * HOUR, { description: 'Admin absolute session cap (≤ 12h).' }),
  AUTH_UNVERIFIED_TTL: withDefault(t.duration(90 * DAY), 7 * DAY, { description: 'Lifetime of unverified accounts.' }),
  AUTH_BCRYPT_COST: withDefault(t.int(BCRYPT_COST_FLOOR, BCRYPT_COST_MAX), BCRYPT_COST_FLOOR, {
    description: 'bcrypt cost factor (floor 12).',
  }),
  AUTH_HASH_WORKERS: withDefault(t.int(1, 16), 2, { description: 'Password-hashing worker threads (ADR-0025).' }),

  // Key register (ADR-0018 amendment item 1): `<key_id>:<base64>`
  JWT_SIGNING_KEYS: requiredFor(registerEntryFor('JWT_SIGNING_KEYS').requiredFor, t.keySet('JWT_SIGNING_KEYS'), {
    description: 'ES256 signing keys (1–2 kids, PKCS#8 DER base64); the first signs.',
    sensitivity: 'secret',
  }),
  CSRF_KEY: key('CSRF_KEY', 'HMAC key of CSRF tokens.'),
  CSRF_KEY_PREVIOUS: previousKey('CSRF_KEY'),
  RECOVERY_KEY: key('RECOVERY_KEY', 'HMAC key of recovery-code lookups.'),
  RECOVERY_KEY_PREVIOUS: previousKey('RECOVERY_KEY'),
  MFA_ENCRYPTION_KEY: key('MFA_ENCRYPTION_KEY', 'AES-256-GCM key of TOTP secrets.'),
  MFA_ENCRYPTION_KEY_PREVIOUS: previousKey('MFA_ENCRYPTION_KEY'),
  AUDIT_VAULT_KEY: key('AUDIT_VAULT_KEY', 'AES-256-GCM key of the audit PII vault.'),
  AUDIT_VAULT_KEY_PREVIOUS: previousKey('AUDIT_VAULT_KEY'),
  AUDIT_INDEX_KEY: key('AUDIT_INDEX_KEY', 'HMAC key of audit ip_hash.'),
  AUDIT_INDEX_KEY_PREVIOUS: previousKey('AUDIT_INDEX_KEY'),
  AUDIT_ANCHOR_SIGNING_KEY: key('AUDIT_ANCHOR_SIGNING_KEY', 'ECDSA P-256 private key of audit anchors (worker only; PKCS#8 DER base64).'),
  AUDIT_ANCHOR_PUBLIC_KEYS: optional(t.publicKeySet('audit-anchor'), {
    description: 'Anchor verification keys (SPKI DER base64, comma-separated; retired keys kept forever).',
    sensitivity: 'public',
  }),
  TRACKING_INDEX_KEY: key('TRACKING_INDEX_KEY', 'HMAC key of tracking_index.'),
  TRACKING_INDEX_KEY_PREVIOUS: previousKey('TRACKING_INDEX_KEY'),
  OUTBOX_PAYLOAD_KEY: key('OUTBOX_PAYLOAD_KEY', 'AES-256-GCM key of outbox payload tokens.'),
  OUTBOX_PAYLOAD_KEY_PREVIOUS: previousKey('OUTBOX_PAYLOAD_KEY'),
  IDEMPOTENCY_BODY_KEY: key('IDEMPOTENCY_BODY_KEY', 'AES-256-GCM key of stored idempotent responses.'),
  IDEMPOTENCY_BODY_KEY_PREVIOUS: previousKey('IDEMPOTENCY_BODY_KEY'),
  CURSOR_KEY: key('CURSOR_KEY', 'HMAC key of pagination cursors.'),
  CURSOR_KEY_PREVIOUS: previousKey('CURSOR_KEY'),
  LOGIN_COUNTER_KEY: key('LOGIN_COUNTER_KEY', 'HMAC key of lockout counter identifiers.'),
  CARRIER_TOKEN_CACHE_KEY: key('CARRIER_TOKEN_CACHE_KEY', 'AES-256-GCM key of carrier OAuth tokens in Valkey.'),
  CARRIER_TOKEN_CACHE_KEY_PREVIOUS: previousKey('CARRIER_TOKEN_CACHE_KEY'),
  IDENTIFIER_ENCRYPTION_KEY: key('IDENTIFIER_ENCRYPTION_KEY', 'AES-256-GCM key of tax and identity references.'),
  IDENTIFIER_ENCRYPTION_KEY_PREVIOUS: previousKey('IDENTIFIER_ENCRYPTION_KEY'),
  AUDIT_VAULT_HMAC_KEY: key('AUDIT_VAULT_HMAC_KEY', 'HMAC key of the vault dedupe index.'),
  AUDIT_VAULT_HMAC_KEY_PREVIOUS: previousKey('AUDIT_VAULT_HMAC_KEY'),
  MFA_CHALLENGE_BIND_KEY: key('MFA_CHALLENGE_BIND_KEY', 'HMAC key binding MFA challenges to an IP prefix.'),
  MFA_ENROLMENT_CODE_KEY: key('MFA_ENROLMENT_CODE_KEY', 'HMAC key of e-mailed enrolment codes.'),
  PASSWORD_PEPPER: key('PASSWORD_PEPPER', 'Reserved bcrypt pre-hash pepper (SEC-P3-16 backlog).'),
  PASSWORD_PEPPER_PREVIOUS: previousKey('PASSWORD_PEPPER'),
  MOCK_GATEWAY_WEBHOOK_SECRET: key(
    'MOCK_GATEWAY_WEBHOOK_SECRET',
    'HMAC secret of Mock gateway webhooks; required with PAYMENT_PROVIDER=mock, refused in production.',
  ),

  // Payments (PAYMENT_*; ADR-0012)
  PAYMENT_PROVIDER: withDefault(t.oneOf(['mock', 'stripe'] as const), (appEnv) => (appEnv === 'production' ? 'stripe' : 'mock'), {
    description: 'Payment gateway adapter; mock is refused in production.',
  }),
  STRIPE_SECRET_KEY_REF: optional(t.secretRef(), {
    description: 'Reference to the restricted rk_test_ key (required with stripe).',
    sensitivity: 'secret-ref',
  }),
  STRIPE_WEBHOOK_SECRET_REF: optional(t.secretRef(), {
    description: "Reference to this endpoint's whsec_ secret.",
    sensitivity: 'secret-ref',
  }),
  PAYMENT_ALLOW_FULL_TEST_KEY: withDefault(t.bool(), false, { description: 'Accept an sk_test_ key instead of rk_test_ (logs a WARN).' }),

  // Carriers (CARRIER_*; ADR-0010)
  MOCK_CARRIER_ENABLED: withDefault(t.bool(), localOnly, {
    description: 'Register the Mock carrier (default on in local/test; refused in production).',
  }),
  MOCK_SCENARIOS_ENABLED: withDefault(t.bool(), localOnly, {
    description: 'Honour Mock scenario directives (default on in local/test; refused in production).',
  }),
  CARRIER_TOKEN_CACHE: withDefault(t.oneOf(['redis', 'memory'] as const), 'redis', {
    description: 'Where carrier OAuth tokens are cached (encrypted in redis).',
  }),
  CARRIER_DHL_ENABLED: dhl.enabled,
  CARRIER_DHL_ENVIRONMENT: dhl.environment,
  CARRIER_DHL_SECRET_REF: dhl.secretRef,
  CARRIER_FEDEX_ENABLED: fedex.enabled,
  CARRIER_FEDEX_ENVIRONMENT: fedex.environment,
  CARRIER_FEDEX_SECRET_REF: fedex.secretRef,
  CARRIER_UPS_ENABLED: ups.enabled,
  CARRIER_UPS_ENVIRONMENT: ups.environment,
  CARRIER_UPS_SECRET_REF: ups.secretRef,

  // Object storage (STORAGE_*; ADR-0021)
  STORAGE_ENDPOINT: optional(t.url(['http', 'https']), {
    description: 'S3 endpoint for put/get (unset in AWS); https outside local/test.',
  }),
  STORAGE_PUBLIC_ENDPOINT: optional(t.url(['http', 'https']), { description: 'Browser-reachable endpoint for pre-signed URLs.' }),
  STORAGE_REGION: withDefault(t.string(/^[a-z0-9-]{2,32}$/), 'us-east-1', { description: 'S3 signing region.' }),
  STORAGE_FORCE_PATH_STYLE: withDefault(t.bool(), false, { description: 'Path-style addressing (true for RustFS).' }),
  STORAGE_BUCKET_DOCUMENTS: required(t.string(S3_BUCKET, 63), { description: 'Bucket for labels, invoices and customs documents.' }),
  STORAGE_BUCKET_RAW_CARRIER_PAYLOADS: required(t.string(S3_BUCKET, 63), { description: 'Bucket for redacted raw carrier payloads.' }),
  STORAGE_PRESIGN_TTL_SECONDS: withDefault(t.int(1, 300), 300, { description: 'Pre-signed URL lifetime (≤ 300 s).' }),
  STORAGE_ACCESS_KEY_ID_REF: optional(t.secretRef(), {
    description: 'Reference to the static access key id (local only; IAM role at M5).',
    sensitivity: 'secret-ref',
  }),
  STORAGE_SECRET_ACCESS_KEY_REF: optional(t.secretRef(), {
    description: 'Reference to the static secret access key (local only).',
    sensitivity: 'secret-ref',
  }),

  // Mail (MAIL_*; ADR-0020)
  MAIL_PROVIDER: withDefault(t.oneOf(['smtp', 'ses'] as const), 'smtp', { description: 'Mail transport.' }),
  MAIL_HOST: optional(t.string(HOSTNAME, 253), { description: 'SMTP host (required with smtp).' }),
  MAIL_PORT: withDefault(t.port(), 587, { description: 'SMTP port (Mailpit: 1025).' }),
  MAIL_SECURE: withDefault(t.bool(), false, { description: 'Implicit TLS for SMTP.' }),
  MAIL_FROM: required(t.email(), { description: 'Sender address; the display name is BRAND_NAME.' }),
  MAIL_SMTP_USER: optional(t.string(undefined, 256), { description: 'SMTP user name.' }),
  MAIL_SMTP_PASSWORD_REF: optional(t.secretRef(), { description: 'Reference to the SMTP password.', sensitivity: 'secret-ref' }),

  // Telemetry (OTEL_*; ADR-0017)
  OTEL_ENABLED: withDefault(t.bool(), false, { description: 'Export traces and metrics over OTLP.' }),
  OTEL_EXPORTER_OTLP_ENDPOINT: optional(t.url(['http', 'https']), { description: 'OTLP/HTTP endpoint (required when OTEL_ENABLED).' }),

  // Audit (AUDIT_*; ADR-0007, ADR-0021)
  AUDIT_ANCHOR_SINK: requiredFor(['worker'], t.url(['file', 's3', 'cloudwatch']), {
    description: 'External anchor sink (file: locally, s3:// at M5).',
  }),

  // Demo seed (SEED_*; local-only defaults, D-022)
  SEED_SUPERADMIN_PASSWORD: optional(t.secretString(12, 128), {
    description: 'Demo super-admin password (seed only).',
    sensitivity: 'secret',
  }),
  SEED_CUSTOMER_PASSWORD: optional(t.secretString(12, 128), { description: 'Demo customer password (seed only).', sensitivity: 'secret' }),
} as const satisfies Record<string, KeySpec>;

export type ConfigSchema = typeof CONFIG_SCHEMA;
export type ConfigKey = keyof ConfigSchema;

type ValueOf<S> = S extends KeySpec<infer T, infer O> ? (O extends true ? T | undefined : T) : never;

/** The validated, deeply read-only configuration of the API and the worker. */
export type Config = { readonly [K in ConfigKey]: ValueOf<ConfigSchema[K]> };

export const CONFIG_KEY_NAMES: readonly ConfigKey[] = Object.freeze(Object.keys(CONFIG_SCHEMA) as ConfigKey[]);

const specOf = (name: ConfigKey): KeySpec => CONFIG_SCHEMA[name];

/** Keys whose values are secrets or references to secrets (log redaction, placeholder checks, parity). */
export const SECRET_KEY_NAMES: readonly ConfigKey[] = Object.freeze(
  CONFIG_KEY_NAMES.filter((name) => {
    const { sensitivity } = specOf(name);
    return sensitivity === 'secret' || sensitivity === 'secret-ref';
  }),
);

export interface ConfigKeyInfo {
  readonly name: ConfigKey;
  readonly description: string;
  readonly sensitivity: Sensitivity;
  readonly requiredFor: readonly Service[];
  readonly hasDefault: boolean;
}

/** Documentation view of the schema (names and metadata only). */
export function describeConfigKeys(): readonly ConfigKeyInfo[] {
  return CONFIG_KEY_NAMES.map((name) => {
    const { description, sensitivity, requiredFor: services, defaultFor } = specOf(name);
    return Object.freeze({ name, description, sensitivity, requiredFor: services, hasDefault: defaultFor !== undefined });
  });
}

/** Names of keys a service cannot start without (keys with defaults excluded). */
export function requiredKeysFor(service: Service): readonly ConfigKey[] {
  return CONFIG_KEY_NAMES.filter((name) => specOf(name).requiredFor.includes(service));
}

const appEnvOf = (parent: Record<string, unknown>): AppEnv | undefined => {
  const value = parent.APP_ENV;
  return typeof value === 'string' && (APP_ENVS as readonly string[]).includes(value) ? (value as AppEnv) : undefined;
};

const joiFor = (keySpec: KeySpec, service: Service): Joi.Schema => {
  const { defaultFor } = keySpec;
  if (defaultFor !== undefined) return keySpec.joi.default((parent: Record<string, unknown>) => defaultFor(appEnvOf(parent), service));
  return keySpec.requiredFor.includes(service) ? keySpec.joi.required() : keySpec.joi.optional();
};

const objectSchemas = new Map<Service, Joi.ObjectSchema>();

/** The Joi object schema for `service` (cached). Unknown variables are ignored and stripped. */
export function configObjectSchema(service: Service): Joi.ObjectSchema {
  let schema = objectSchemas.get(service);
  if (schema === undefined) {
    const shape: Record<string, Joi.Schema> = {};
    for (const name of CONFIG_KEY_NAMES) shape[name] = joiFor(specOf(name), service);
    schema = Joi.object(shape).options({ abortEarly: false, allowUnknown: true, stripUnknown: true, convert: true });
    objectSchemas.set(service, schema);
  }
  return schema;
}
