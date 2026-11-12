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
  /** Names of tooling-only keys (`tooling-keys.ts`) configured in the process environment; never their values. */
  readonly toolingKeys?: readonly string[];
  /** Names of ECS task-metadata variables (`ECS_METADATA_KEYS`) present in the process environment; never values. */
  readonly ecsMetadataKeys?: readonly string[];
}

export type Guard = (input: GuardInput) => readonly ConfigIssue[];

/** SEC-P3-08 item 5, SEC-TC-51: placeholder and `local-only-*` values are refused in staging and production. */
export const placeholderGuard: Guard = ({ raw, appEnv }) =>
  isHardenedAppEnv(appEnv)
    ? Object.entries(raw)
        .filter(([, value]) => isPlaceholder(value))
        .map(([key]) => ({ key, code: 'placeholder' }))
    : [];

const HTTPS_KEYS = ['WEB_APP_ORIGIN', 'ADMIN_APP_ORIGIN', 'STORAGE_ENDPOINT', 'STORAGE_PUBLIC_ENDPOINT'] as const;

const parseUrl = (value: string): URL | undefined => {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
};

const hasDuplicateParam = (url: URL): boolean => {
  const names = [...url.searchParams.keys()];
  return new Set(names).size !== names.length;
};

/**
 * Query parameters a hardened `DATABASE_URL` may carry (PR3-SEC-12, optional item). Everything else is refused:
 * `host=` overrides the authority (another host or a Unix socket, so no TLS) and `options=` sets server GUCs.
 */
const POSTGRES_URL_PARAMS: ReadonlySet<string> = new Set([
  'sslmode',
  'sslrootcert',
  'sslnegotiation',
  'uselibpqcompat',
  'application_name',
  'connect_timeout',
]);

/**
 * PostgreSQL URL as node-postgres reads it (pg-connection-string 2.14.1 copies every query entry onto the config,
 * so the LAST `sslmode` wins, and `ssl=0` sets `ssl: false`): a TCP host name, no repeated or unlisted query
 * parameter, exactly one `sslmode=verify-full`, and no `ssl` override (TLS is selected by `sslmode` alone).
 */
const isVerifiedPostgresUrl = (_raw: string, url: URL): boolean =>
  // pg decodes the host, so a percent-encoded `/` makes a Unix-socket path: refused like an empty host.
  url.hostname !== '' &&
  !url.hostname.includes('%') &&
  !hasDuplicateParam(url) &&
  [...url.searchParams.keys()].every((name) => POSTGRES_URL_PARAMS.has(name)) &&
  url.searchParams.get('sslmode') === 'verify-full';

/**
 * Valkey URL as ioredis 6.0.0 reads it. TLS is on only when the RAW string starts with `rediss://`
 * (`built/Redis.js:707`); an opaque `rediss:user:pw@host` parses as protocol `rediss:` in WHATWG but is re-read by
 * ioredis as `redis://rediss:…` over plain TCP (PR3-SEC-12). `parseURL` also merges query parameters into the
 * options before `tls: true` applies, so `?tls=` selects plain TCP (PR3-SEC-02). Outside local/test: the raw
 * `rediss://` prefix, a non-empty host, and no query string or fragment at all.
 */
const isTlsRedisUrl = (raw: string, url: URL): boolean =>
  raw.startsWith('rediss://') && url.hostname !== '' && !raw.includes('?') && !raw.includes('#');

const isHttpsUrl = (_raw: string, url: URL): boolean => url.protocol === 'https:' && url.hostname !== '';

/**
 * NFR-SEC-007, platform.md §9.4: TLS to PostgreSQL, Valkey and HTTP endpoints outside `APP_ENV ∈ {local, test}`.
 * Fails closed (PR3-SEC-12): a value the WHATWG parser cannot read is insecure, whatever the driver would do with
 * it. A key the schema already rejected is reported there and not twice.
 */
export const transportGuard: Guard = ({ raw, values, appEnv }) => {
  if (appEnv === undefined || isLocalAppEnv(appEnv)) return [];
  const issues: ConfigIssue[] = [];
  const insecure = (key: string, secure: (raw: string, url: URL) => boolean): void => {
    const value = raw[key];
    if (value === undefined || !(key in values)) return;
    const url = parseUrl(value);
    if (url === undefined || !secure(value, url)) issues.push({ key, code: 'insecure-transport' });
  };
  insecure('DATABASE_URL', isVerifiedPostgresUrl);
  insecure('REDIS_URL', isTlsRedisUrl);
  HTTPS_KEYS.forEach((key) => insecure(key, isHttpsUrl));
  return issues;
};

const isSpace = (char: string): boolean => /\s/.test(char);

/**
 * Splits NODE_OPTIONS like Node's parser for quotes: a double-quoted section belongs to the current token with the
 * quotes removed, and `\` escapes the next character inside quotes. It splits on ANY whitespace, which is stricter
 * than Node (U+0020 only); over-splitting can only add refusals (R2-n2).
 */
export function nodeOptionTokens(value: string): readonly string[] {
  const tokens: string[] = [];
  let current = '';
  let started = false;
  let quoted = false;
  for (let index = 0; index < value.length; index += 1) {
    const char = value.charAt(index);
    if (quoted && char === '\\') {
      index += 1;
      current += value.charAt(index);
    } else if (char === '"') {
      quoted = !quoted;
    } else if (!quoted && isSpace(char)) {
      if (started) tokens.push(current);
      current = '';
      started = false;
      continue;
    } else {
      current += char;
    }
    started = true;
  }
  if (started) tokens.push(current);
  return tokens;
}

/**
 * Option name of a token, normalised: single quotes dropped (Node keeps them, but they mark an intent to pass
 * the flag), the `=value` part removed, `_` read as `-` (Node accepts `--inspect_brk` for `--inspect-brk`), and
 * lower-cased.
 */
const optionName = (token: string): string => (token.replace(/'/g, '').split('=', 1)[0] ?? '').replace(/_/g, '-').toLowerCase();

/** Every `--inspect*` option and the `--debug*` aliases (`--debug-port`) configure or start the inspector. */
export const isInspectorOption = (token: string): boolean => {
  const name = optionName(token);
  return name.startsWith('--inspect') || name.startsWith('--debug');
};

/** SEC-P3-08 item 6, R-22: no debug sections or inspector outside `APP_ENV=local`. */
export const debugGuard: Guard = ({ raw, appEnv }) => {
  if (appEnv === undefined || appEnv === 'local') return [];
  const issues: ConfigIssue[] = [];
  if (raw.NODE_DEBUG !== undefined) issues.push({ key: 'NODE_DEBUG', code: 'debug-flag' });
  if (raw.DEBUG !== undefined) issues.push({ key: 'DEBUG', code: 'debug-flag' });
  if (raw.NODE_OPTIONS !== undefined && nodeOptionTokens(raw.NODE_OPTIONS).some(isInspectorOption)) {
    issues.push({ key: 'NODE_OPTIONS', code: 'debug-flag' });
  }
  return issues;
};

/**
 * PR3-SEC-03, m7: a hardened `APP_ENV` requires the raw `NODE_ENV=production`; libraries read `process.env.NODE_ENV`
 * directly (Express defaults, cookie relaxation, the demo-seed gate), not the schema default.
 */
export const nodeEnvGuard: Guard = ({ raw, appEnv }) =>
  isHardenedAppEnv(appEnv) && raw.NODE_ENV !== 'production'
    ? [{ key: 'NODE_ENV', code: 'forbidden-in-environment', rule: 'nodeEnv.production' }]
    : [];

/**
 * PR3-SEC-03 option (b) (D-ORCH-007): the ECS agent injects its task-metadata endpoint into every container, so a
 * process that sees one runs on AWS and must not run with `APP_ENV=local|test` (Mock adapters, plain transport,
 * `local-only-*` keys). Presence of the variable only; the endpoint is never called.
 */
export const localAppEnvOnEcsGuard: Guard = ({ ecsMetadataKeys = [], appEnv }) =>
  isLocalAppEnv(appEnv) && ecsMetadataKeys.length > 0 ? [{ key: 'APP_ENV', code: 'forbidden-in-environment', rule: 'appEnv.ecsTask' }] : [];

/** PR-0003 §4, PR-0005 §4: the API and the worker never hold tooling credentials outside local/test. */
export const toolingKeyGuard: Guard = ({ toolingKeys = [], appEnv }) =>
  isHardenedAppEnv(appEnv) ? toolingKeys.map((key) => ({ key, code: 'forbidden-in-environment', rule: 'toolingKey' })) : [];

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
  nodeEnvGuard,
  localAppEnvOnEcsGuard,
  toolingKeyGuard,
  productionGuard,
  companionGuard,
  sessionGuard,
  keyMaterialGuard,
]);

export function runGuards(input: GuardInput): readonly ConfigIssue[] {
  return GUARDS.flatMap((guard) => guard(input));
}
