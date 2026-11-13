/**
 * Cross-key start-up policies (ADR-0018 §3 and amendment items 1, 3; platform.md §9.2, §9.4; ADR-0006 am.;
 * ADR-0010 am. 9). Each guard is a pure function over the raw configured strings and the values that passed the
 * schema; it returns issues that name keys only.
 */
import { isAbsolute } from 'node:path';

import { SUPPRESSING_LOG_LEVELS } from './entry-preflight.js';
import { type AppEnv, isHardenedAppEnv, isLocalAppEnv, type Service, TLS_REJECT_UNAUTHORIZED_KEY } from './environment.js';
import type { ConfigIssue } from './errors.js';
import { findDuplicateKeyMaterial, KEY_REGISTER, type KeyVersion, PREVIOUS_SUFFIX } from './keys.js';
import { isInspectorOption, nodeOptionTokens } from './node-options.js';
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
  /** `NODE_TLS_REJECT_UNAUTHORIZED` is configured to something other than `1` (PR9-SEC-04); never its value. */
  readonly tlsVerificationOverridden?: boolean;
  /** The loading service; companion keys it does not hold (register `holders`, PR3-SEC-06) are not required. */
  readonly service?: Service;
}

/** `true` unless `key` is a register variable whose holders exclude `service`. */
const heldBy = (key: string, service: Service | undefined): boolean =>
  service === undefined || (KEY_REGISTER.find((entry) => entry.variables.includes(key))?.holders.includes(service) ?? true);

export type Guard = (input: GuardInput) => readonly ConfigIssue[];

// Moved to node-options.ts (TASK-014: the entrypoint preflight needs them without the key register); re-exported here.
export { isInspectorOption, nodeOptionTokens };

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

/**
 * The only query parameters `DATABASE_URL` may carry, in every APP_ENV: the TLS selectors. This is the one list;
 * the runtime pool factory (`apps/api/src/platform/db/client.ts`) imports it (PR-0009 R2-m2).
 *  - `host=` would override the authority (another host or a Unix socket, so no TLS); `options=` sets server GUCs;
 *    `ssl=` would override the TLS choice (PR3-SEC-12).
 *  - `application_name` would replace the per-service name used for `pg_stat_activity` attribution, and
 *    `connect_timeout` the bounded `connectionTimeoutMillis` (R2-m2 ruling).
 *  - `uselibpqcompat` is not accepted: the runtime decides TLS itself, so it would have no effect (D-TASK006-02).
 */
export const RUNTIME_DATABASE_URL_PARAMS: ReadonlySet<string> = new Set(['sslmode', 'sslrootcert', 'sslnegotiation']);

/** Query parameter names, percent-decoded as pg reads them; false when one repeats or is not allow-listed. */
export const hasOnlyRuntimeDatabaseUrlParams = (url: URL): boolean => {
  const names = [...url.searchParams.keys()];
  return new Set(names).size === names.length && names.every((name) => RUNTIME_DATABASE_URL_PARAMS.has(name));
};

/** libpq `sslmode` values; `no-verify` (a pg-only extension that turns verification off) is not one of them. */
export const DATABASE_SSLMODES: ReadonlySet<string> = new Set(['disable', 'allow', 'prefer', 'require', 'verify-ca', 'verify-full']);

/**
 * PR #9 code review R3-m1, PR #11 code review R3-m2 (TASK-014): the VALUES of the TLS selectors, with the same rules
 * the runtime TLS translation applies, so a bad value fails at configuration load (exit 78 naming DATABASE_URL)
 * instead of later as an uncaught `DatabaseConfigError`. Values are percent-decoded, as pg reads them.
 *  - `sslmode` ∈ {disable, allow, prefer, require, verify-ca, verify-full};
 *  - `sslnegotiation` ∈ {postgres, direct}, and `direct` implies TLS (pg reads TLS from a non-`disable` sslmode, or
 *    from no sslmode with `sslrootcert` or `sslnegotiation=direct`);
 *  - `sslrootcert` is an absolute path, never libpq's `system` trust-store keyword.
 * Whether the file exists and is readable is decided where it is opened (`readRootCertificate`), not here.
 */
export const hasValidDatabaseUrlParamValues = (url: URL): boolean => {
  const sslmode = url.searchParams.get('sslmode');
  const sslnegotiation = url.searchParams.get('sslnegotiation');
  const sslrootcert = url.searchParams.get('sslrootcert');
  if (sslmode !== null && !DATABASE_SSLMODES.has(sslmode)) return false;
  if (sslnegotiation !== null && sslnegotiation !== 'postgres' && sslnegotiation !== 'direct') return false;
  const tls = sslmode === null ? sslnegotiation === 'direct' || sslrootcert !== null : sslmode !== 'disable';
  if (sslnegotiation === 'direct' && !tls) return false;
  return sslrootcert === null || (sslrootcert !== 'system' && isAbsolute(sslrootcert));
};

/**
 * PR-0009 R2-m2 (r1 n6): the query-parameter rule applies in every APP_ENV, so a local URL the runtime would refuse
 * fails here with exit 78 and the key name, not later with a stack. A URL the WHATWG parser cannot read is left to
 * the schema and, outside local/test, to the transport guard. TASK-014 adds the value predicate above.
 */
export const databaseUrlParamsGuard: Guard = ({ raw, values }) => {
  const value = raw.DATABASE_URL;
  if (value === undefined || !('DATABASE_URL' in values)) return [];
  const url = parseUrl(value);
  if (url === undefined) return [];
  if (!hasOnlyRuntimeDatabaseUrlParams(url)) return [{ key: 'DATABASE_URL', code: 'invalid', rule: 'databaseUrl.queryParameter' }];
  return hasValidDatabaseUrlParamValues(url) ? [] : [{ key: 'DATABASE_URL', code: 'invalid', rule: 'databaseUrl.parameterValue' }];
};

/**
 * PostgreSQL URL outside local/test: a TCP host name and exactly one `sslmode`, `verify-full`. Repeated, unlisted
 * and `ssl=` parameters are refused in every APP_ENV by databaseUrlParamsGuard (together they are the PR3-SEC-02/12
 * rule: pg-connection-string 2.14.1 lets the LAST `sslmode` win and `ssl=0` turn TLS off).
 */
const isVerifiedPostgresUrl = (_raw: string, url: URL): boolean => {
  const sslmodes = url.searchParams.getAll('sslmode');
  // pg decodes the host, so a percent-encoded `/` makes a Unix-socket path: refused like an empty host.
  return url.hostname !== '' && !url.hostname.includes('%') && sslmodes.length === 1 && sslmodes[0] === 'verify-full';
};

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

/**
 * PR9-SEC-04: `NODE_TLS_REJECT_UNAUTHORIZED=0` turns off certificate verification for every TLS client that does not
 * pin `rejectUnauthorized` (Node only warns). Staging and production refuse any value but `1`; local/test allow it.
 */
export const tlsVerificationGuard: Guard = ({ tlsVerificationOverridden = false, appEnv }) =>
  isHardenedAppEnv(appEnv) && tlsVerificationOverridden
    ? [{ key: TLS_REJECT_UNAUTHORIZED_KEY, code: 'forbidden-in-environment', rule: 'tls.rejectUnauthorized' }]
    : [];

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
export const companionGuard: Guard = ({ raw, values, appEnv, service }) => {
  const required: string[] = [];
  if (values.PAYMENT_PROVIDER === 'stripe') required.push('STRIPE_SECRET_KEY_REF', 'STRIPE_WEBHOOK_SECRET_REF');
  if (values.PAYMENT_PROVIDER === 'mock' && appEnv !== undefined && appEnv !== 'production') required.push('MOCK_GATEWAY_WEBHOOK_SECRET');
  for (const code of CARRIER_CODES) if (values[`CARRIER_${code}_ENABLED`] === true) required.push(`CARRIER_${code}_SECRET_REF`);
  if (values.MAIL_PROVIDER === 'smtp') required.push('MAIL_HOST');
  if (values.OTEL_ENABLED === true) required.push('OTEL_EXPORTER_OTLP_ENDPOINT');
  // D-ARCH-100 item 1 (PR30-SEC-04): with an in-network STORAGE_ENDPOINT the pre-signed URL would carry the internal
  // host; the browser-reachable endpoint is required in every environment.
  if (values.STORAGE_ENDPOINT !== undefined) required.push('STORAGE_PUBLIC_ENDPOINT');
  return required.filter((key) => raw[key] === undefined && heldBy(key, service)).map((key) => ({ key, code: 'missing' }));
};

/** A pair of secret references that is configured together or not at all (D-ARCH-100 item 1). */
export interface CredentialPair {
  readonly keys: readonly [string, string];
  /** Rule reported when exactly one member is configured (code `inconsistent`). */
  readonly pairRule: string;
  /** Rule reported for each configured member in staging and production (code `forbidden-in-environment`). */
  readonly hardenedRule: string;
}

/**
 * PR30-SEC-04 config half and PR30-SEC-11 (D-ARCH-100 item 1; ADR-0021 am. 2 item 6 and am. 3). Static object-store
 * credentials are a local/test convenience (RustFS); in staging and production the IAM task role is the identity, so
 * both references are refused there with no override switch (a non-IAM store for staging needs an ADR-0021
 * amendment first). TASK-116 appends the audit-anchor sink pair.
 */
export const CREDENTIAL_PAIRS: readonly CredentialPair[] = Object.freeze([
  Object.freeze({
    keys: Object.freeze(['STORAGE_ACCESS_KEY_ID_REF', 'STORAGE_SECRET_ACCESS_KEY_REF'] as const),
    pairRule: 'storage.credentialPair',
    hardenedRule: 'storage.staticCredentials',
  }),
]);

/**
 * One member of a credential pair alone is `inconsistent` on the configured key (local/test); any member in staging
 * or production is `forbidden-in-environment`. Keys only, never a value. This replaces the uncaught
 * `StorageConfigError` of PR30-SEC-11 for the configuration case; the adapter-level throw stays as defence in depth.
 */
export const credentialPairGuard: Guard = ({ raw, appEnv }) =>
  CREDENTIAL_PAIRS.flatMap(({ keys, pairRule, hardenedRule }): ConfigIssue[] => {
    const configured = keys.filter((key) => raw[key] !== undefined);
    if (isHardenedAppEnv(appEnv)) return configured.map((key) => ({ key, code: 'forbidden-in-environment', rule: hardenedRule }));
    return configured.length === 1 ? configured.map((key) => ({ key, code: 'inconsistent', rule: pairRule })) : [];
  });

/**
 * PR20-SEC-04 item 2 (D-ORCH-025 (2); D-ARCH-084): staging and production keep at least `warn`; local and test keep
 * the full range. The security sink bypasses the level gate already (PR #20); this protects the error lines and the
 * fatal process-error line. The TASK-014 entrypoint preflight applies the same floor before Node loads the app.
 */
export const logLevelGuard: Guard = ({ values, appEnv }) =>
  isHardenedAppEnv(appEnv) && typeof values.APP_LOG_LEVEL === 'string' && SUPPRESSING_LOG_LEVELS.has(values.APP_LOG_LEVEL)
    ? [{ key: 'APP_LOG_LEVEL', code: 'forbidden-in-environment', rule: 'logLevel.floor' }]
    : [];

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
  databaseUrlParamsGuard,
  debugGuard,
  nodeEnvGuard,
  localAppEnvOnEcsGuard,
  tlsVerificationGuard,
  toolingKeyGuard,
  productionGuard,
  companionGuard,
  credentialPairGuard,
  logLevelGuard,
  sessionGuard,
  keyMaterialGuard,
]);

export function runGuards(input: GuardInput): readonly ConfigIssue[] {
  return GUARDS.flatMap((guard) => guard(input));
}
