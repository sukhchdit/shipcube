/**
 * PR3-SEC-14 (TASK-014): the environment check of the database tooling one-shots (bootstrap, migrate, seed). They do
 * not load the runtime configuration, so the rules `loadConfig` applies to `DATABASE_URL` are applied here to the
 * tooling URL instead, through the same guards:
 *  - every APP_ENV: `APP_ENV` is set to a known value; the URL is set, is a `postgres://`/`postgresql://` URL and
 *    carries only the TLS selectors with valid values (`databaseUrlParamsGuard`); APP_ENV local/test is refused
 *    inside an ECS task, i.e. with an ECS task-metadata variable set non-empty (`localAppEnvOnEcsGuard`, PR39-SEC-02);
 *  - staging/production: a TCP host and exactly one `sslmode=verify-full` (`transportGuard`), no placeholder or
 *    `local-only-*` value (`placeholderGuard`), and `NODE_TLS_REJECT_UNAUTHORIZED` unset or `1`
 *    (`tlsVerificationGuard`); local/test accept a plain URL;
 *  - hardened (APP_ENV not local/test, or an ECS task-metadata variable set; the entrypoint preflight's signal): no
 *    `PG*` variable at all, even empty (rule `pg.environment`; PR39-SEC-02, R1-n9), so libpq/pg environment
 *    defaults such as PGOPTIONS or PGSSLMODE cannot reach a migrator- or superuser-privileged connection.
 * Issues name variables, codes and rules only, never a value.
 */
import { presentEcsMetadataKeys } from './entry-preflight.js';
import { APP_ENVS, type AppEnv, isLocalAppEnv, TLS_REJECT_UNAUTHORIZED_KEY } from './environment.js';
import type { ConfigIssue } from './errors.js';
import {
  databaseUrlParamsGuard,
  type GuardInput,
  localAppEnvOnEcsGuard,
  placeholderGuard,
  tlsVerificationGuard,
  transportGuard,
} from './guards.js';

/** The key the reused guards check; their issues about it are reported against the tooling variable instead. */
const GUARDED_KEY = 'DATABASE_URL';
const POSTGRES_PROTOCOLS: ReadonlySet<string> = new Set(['postgres:', 'postgresql:']);
const KNOWN_APP_ENVS: readonly string[] = APP_ENVS;

type ToolingEnv = Readonly<Record<string, string | undefined>>;

const configured = (env: ToolingEnv, key: string): string | undefined => {
  const value = env[key];
  return value === undefined || value === '' ? undefined : value;
};

function appEnvOf(raw: string | undefined): { readonly appEnv?: AppEnv; readonly issue?: ConfigIssue } {
  if (raw === undefined) return { issue: { key: 'APP_ENV', code: 'missing' } };
  return KNOWN_APP_ENVS.includes(raw) ? { appEnv: raw as AppEnv } : { issue: { key: 'APP_ENV', code: 'invalid' } };
}

function urlIssues(env: ToolingEnv, key: string, appEnv: AppEnv | undefined): ConfigIssue[] {
  const value = configured(env, key);
  if (value === undefined) return [{ key, code: 'missing' }];
  const issues: ConfigIssue[] = [];
  const url = URL.parse(value);
  if (url === null || !POSTGRES_PROTOCOLS.has(url.protocol)) issues.push({ key, code: 'invalid', rule: 'databaseUrl.protocol' });
  const tlsRejectUnauthorized = configured(env, TLS_REJECT_UNAUTHORIZED_KEY);
  const input: GuardInput = {
    raw: { [GUARDED_KEY]: value },
    values: { [GUARDED_KEY]: value },
    appEnv,
    tlsVerificationOverridden: tlsRejectUnauthorized !== undefined && tlsRejectUnauthorized !== '1',
  };
  for (const guard of [databaseUrlParamsGuard, transportGuard, placeholderGuard, tlsVerificationGuard]) {
    issues.push(...guard(input).map((found) => (found.key === GUARDED_KEY ? { ...found, key } : found)));
  }
  return issues;
}

/**
 * Checks the PostgreSQL URL in `env[key]` for a tooling one-shot. An empty result means the one-shot may connect.
 * A missing or unknown `APP_ENV` is an issue (fail closed: the TLS requirement depends on it).
 */
export function checkToolingEnv(env: ToolingEnv, key: string): readonly ConfigIssue[] {
  const { appEnv, issue } = appEnvOf(configured(env, 'APP_ENV'));
  const ecsMetadataKeys = presentEcsMetadataKeys(env);
  const issues: ConfigIssue[] = issue === undefined ? [] : [issue];
  issues.push(...localAppEnvOnEcsGuard({ raw: {}, values: {}, appEnv, ecsMetadataKeys }));
  issues.push(...urlIssues(env, key, appEnv));
  if (!isLocalAppEnv(appEnv) || ecsMetadataKeys.length > 0) {
    for (const name of Object.keys(env).filter((variable) => variable.startsWith('PG'))) {
      issues.push({ key: name, code: 'forbidden-in-environment', rule: 'pg.environment' });
    }
  }
  return issues;
}

/** One value-free line: `KEY (code[: rule])` per issue. */
export function formatToolingIssues(issues: readonly ConfigIssue[]): string {
  return issues.map((issue) => `${issue.key} (${issue.rule === undefined ? issue.code : `${issue.code}: ${issue.rule}`})`).join(', ');
}
