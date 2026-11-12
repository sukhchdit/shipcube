/**
 * Cross-key start-up policies (ADR-0018 §3 and amendment items 1, 3; platform.md §9.2, §9.4; ADR-0006 am.;
 * ADR-0010 am. 9). Each guard is a pure function over the raw configured strings and the values that passed the
 * schema; it returns issues that name keys only.
 */
import { type AppEnv, isHardenedAppEnv, isLocalAppEnv } from './environment.js';
import type { ConfigIssue } from './errors.js';
import { findDuplicateKeyMaterial, type KeyVersion, PREVIOUS_SUFFIX } from './keys.js';
import { isPlaceholder } from './placeholders.js';
import { Secret } from './secret.js';

export interface GuardInput {
  /** Configured (non-empty) raw values of schema keys. */
  readonly raw: Readonly<Record<string, string>>;
  /** Converted values of keys that passed the schema, defaults included. */
  readonly values: Readonly<Record<string, unknown>>;
  /** `APP_ENV` when it is valid. */
  readonly appEnv: AppEnv | undefined;
}

export type Guard = (input: GuardInput) => readonly ConfigIssue[];

/** SEC-P3-08 item 5, SEC-TC-51: placeholder and `local-only-*` values are refused in staging and production. */
export const placeholderGuard: Guard = ({ raw, appEnv }) =>
  isHardenedAppEnv(appEnv)
    ? Object.entries(raw)
        .filter(([, value]) => isPlaceholder(value))
        .map(([key]) => ({ key, code: 'placeholder' }))
    : [];

const DATABASE_URL_KEYS = ['DATABASE_URL', 'DATABASE_MIGRATOR_URL', 'SHADOW_DATABASE_URL'] as const;
const HTTPS_KEYS = ['WEB_APP_ORIGIN', 'ADMIN_APP_ORIGIN', 'STORAGE_ENDPOINT', 'STORAGE_PUBLIC_ENDPOINT'] as const;

const parseUrl = (value: string | undefined): URL | undefined => {
  if (value === undefined) return undefined;
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

/** NFR-SEC-007, platform.md §9.4: TLS to PostgreSQL, Valkey and HTTP endpoints outside `APP_ENV ∈ {local, test}`. */
export const transportGuard: Guard = ({ raw, appEnv }) => {
  if (appEnv === undefined || isLocalAppEnv(appEnv)) return [];
  const issues: ConfigIssue[] = [];
  const insecure = (key: string, secure: (url: URL) => boolean): void => {
    const url = parseUrl(raw[key]);
    if (url !== undefined && !secure(url)) issues.push({ key, code: 'insecure-transport' });
  };
  DATABASE_URL_KEYS.forEach((key) => insecure(key, (url) => url.searchParams.get('sslmode') === 'verify-full'));
  insecure('REDIS_URL', (url) => url.protocol === 'rediss:');
  HTTPS_KEYS.forEach((key) => insecure(key, (url) => url.protocol === 'https:'));
  return issues;
};

const INSPECT_FLAG = /(?:^|\s)--inspect(?:-brk|-wait|-port)?(?:=|\s|$)/;

/** SEC-P3-08 item 6, R-22: no debug sections or inspector outside `APP_ENV=local`. */
export const debugGuard: Guard = ({ raw, appEnv }) => {
  if (appEnv === undefined || appEnv === 'local') return [];
  const issues: ConfigIssue[] = [];
  if (raw.NODE_DEBUG !== undefined) issues.push({ key: 'NODE_DEBUG', code: 'debug-flag' });
  if (raw.DEBUG !== undefined) issues.push({ key: 'DEBUG', code: 'debug-flag' });
  if (raw.NODE_OPTIONS !== undefined && INSPECT_FLAG.test(raw.NODE_OPTIONS)) issues.push({ key: 'NODE_OPTIONS', code: 'debug-flag' });
  return issues;
};

/** ADR-0010 am. 9, ADR-0012, SEC-TC-24: no Mock carrier, Mock gateway or Mock webhook secret in production. */
export const productionGuard: Guard = ({ values, appEnv }) => {
  if (appEnv !== 'production') return [];
  const forbidden: string[] = [];
  if (values.MOCK_CARRIER_ENABLED === true) forbidden.push('MOCK_CARRIER_ENABLED');
  if (values.MOCK_SCENARIOS_ENABLED === true) forbidden.push('MOCK_SCENARIOS_ENABLED');
  if (values.PAYMENT_PROVIDER === 'mock') forbidden.push('PAYMENT_PROVIDER');
  if (values.MOCK_GATEWAY_WEBHOOK_SECRET !== undefined) forbidden.push('MOCK_GATEWAY_WEBHOOK_SECRET');
  return forbidden.map((key) => ({ key, code: 'forbidden-in-environment' }));
};

const CARRIER_CODES = ['DHL', 'FEDEX', 'UPS'] as const;

/** Keys that become required because of another key's value. A present-but-invalid key is already reported. */
export const companionGuard: Guard = ({ raw, values, appEnv }) => {
  const required: string[] = [];
  if (values.PAYMENT_PROVIDER === 'stripe') required.push('STRIPE_SECRET_KEY_REF', 'STRIPE_WEBHOOK_SECRET_REF');
  if (values.PAYMENT_PROVIDER === 'mock' && appEnv !== undefined && appEnv !== 'production') required.push('MOCK_GATEWAY_WEBHOOK_SECRET');
  for (const code of CARRIER_CODES) if (values[`CARRIER_${code}_ENABLED`] === true) required.push(`CARRIER_${code}_SECRET_REF`);
  if (values.MAIL_PROVIDER === 'smtp') required.push('MAIL_HOST');
  if (values.OTEL_ENABLED === true) required.push('OTEL_EXPORTER_OTLP_ENDPOINT');
  return required.filter((key) => raw[key] === undefined).map((key) => ({ key, code: 'missing' }));
};

const exceeds = (values: GuardInput['values'], key: string, limitKey: string): boolean => {
  const value = values[key];
  const limit = values[limitKey];
  return typeof value === 'number' && typeof limit === 'number' && value > limit;
};

/** ADR-0006 am. (SEC-P3-01 C1, SEC-P3-11): sliding lifetimes never exceed their absolute caps. */
export const sessionGuard: Guard = ({ values }) => {
  const issues: ConfigIssue[] = [];
  if (exceeds(values, 'AUTH_REFRESH_TTL', 'AUTH_SESSION_ABSOLUTE_TTL')) issues.push({ key: 'AUTH_REFRESH_TTL', code: 'inconsistent' });
  if (exceeds(values, 'AUTH_ADMIN_REFRESH_IDLE_TTL', 'AUTH_ADMIN_SESSION_ABSOLUTE_TTL')) {
    issues.push({ key: 'AUTH_ADMIN_REFRESH_IDLE_TTL', code: 'inconsistent' });
  }
  return issues;
};

const isKeyVersion = (value: unknown): value is KeyVersion =>
  typeof value === 'object' && value !== null && 'material' in value && value.material instanceof Secret && 'keyId' in value;

const keyVersionsOf = (value: unknown): readonly KeyVersion[] | undefined => {
  if (isKeyVersion(value)) return [value];
  if (Array.isArray(value) && value.length > 0 && value.every(isKeyVersion)) return value;
  return undefined;
};

/**
 * SEC-P3-08 item 1, SEC-TC-49: one key per purpose (no material shared by two variables or two kids), and a
 * `<NAME>_PREVIOUS` key must be an older version of the same purpose.
 */
export const keyMaterialGuard: Guard = ({ values }) => {
  const keys = new Map<string, readonly KeyVersion[]>();
  for (const [name, value] of Object.entries(values)) {
    const versions = keyVersionsOf(value);
    if (versions !== undefined) keys.set(name, versions);
  }
  const issues: ConfigIssue[] = findDuplicateKeyMaterial(keys).map((key) => ({ key, code: 'duplicate-key-material' }));
  for (const [name, versions] of keys) {
    if (!name.endsWith(PREVIOUS_SUFFIX)) continue;
    const current = keys.get(name.slice(0, -PREVIOUS_SUFFIX.length))?.[0];
    const previous = versions[0];
    if (current !== undefined && previous !== undefined && previous.version >= current.version) {
      issues.push({ key: name, code: 'inconsistent', rule: 'key.previousVersion' });
    }
  }
  return issues;
};

export const GUARDS: readonly Guard[] = Object.freeze([
  placeholderGuard,
  transportGuard,
  debugGuard,
  productionGuard,
  companionGuard,
  sessionGuard,
  keyMaterialGuard,
]);

export function runGuards(input: GuardInput): readonly ConfigIssue[] {
  return GUARDS.flatMap((guard) => guard(input));
}
