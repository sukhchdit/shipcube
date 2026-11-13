/**
 * PR3-SEC-14 (TASK-014): the environment check of the database tooling one-shots (bootstrap, migrate, seed). They do
 * not load the runtime configuration, so the rules `loadConfig` applies to `DATABASE_URL` are applied here to the
 * tooling URL instead, through the same guards:
 *  - every APP_ENV: `APP_ENV` is set to a known value; the URL is set, is a `postgres://`/`postgresql://` URL and
 *    carries only the TLS selectors with valid values (`databaseUrlParamsGuard`);
 *  - staging/production: a TCP host and exactly one `sslmode=verify-full` (`transportGuard`), no placeholder or
 *    `local-only-*` value (`placeholderGuard`), and `NODE_TLS_REJECT_UNAUTHORIZED` unset or `1`
 *    (`tlsVerificationGuard`); local/test accept a plain URL.
 * Issues name variables, codes and rules only, never a value.
 */
import { APP_ENVS, type AppEnv, TLS_REJECT_UNAUTHORIZED_KEY } from './environment.js';
import type { ConfigIssue } from './errors.js';
import { databaseUrlParamsGuard, type GuardInput, placeholderGuard, tlsVerificationGuard, transportGuard } from './guards.js';

/** The key the reused guards check; their issues about it are reported against the tooling variable instead. */
const GUARDED_KEY = 'DATABASE_URL';
const POSTGRES_PROTOCOLS: ReadonlySet<string> = new Set(['postgres:', 'postgresql:']);
const KNOWN_APP_ENVS: readonly string[] = APP_ENVS;

const configured = (env: Readonly<Record<string, string | undefined>>, key: string): string | undefined => {
  const value = env[key];
  return value === undefined || value === '' ? undefined : value;
};

function appEnvOf(raw: string | undefined): { readonly appEnv?: AppEnv; readonly issue?: ConfigIssue } {
  if (raw === undefined) return { issue: { key: 'APP_ENV', code: 'missing' } };
  return KNOWN_APP_ENVS.includes(raw) ? { appEnv: raw as AppEnv } : { issue: { key: 'APP_ENV', code: 'invalid' } };
}

/**
 * Checks the PostgreSQL URL in `env[key]` for a tooling one-shot. An empty result means the one-shot may connect.
 * A missing or unknown `APP_ENV` is an issue (fail closed: the TLS requirement depends on it).
 */
export function checkToolingEnv(env: Readonly<Record<string, string | undefined>>, key: string): readonly ConfigIssue[] {
  const { appEnv, issue } = appEnvOf(configured(env, 'APP_ENV'));
  const issues: ConfigIssue[] = issue === undefined ? [] : [issue];
  const value = configured(env, key);
  if (value === undefined) return [...issues, { key, code: 'missing' }];
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

/** One value-free line: `KEY (code[: rule])` per issue. */
export function formatToolingIssues(issues: readonly ConfigIssue[]): string {
  return issues.map((issue) => `${issue.key} (${issue.rule === undefined ? issue.code : `${issue.code}: ${issue.rule}`})`).join(', ');
}
