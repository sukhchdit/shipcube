/**
 * Container entrypoint preflight (TASK-014; D-ORCH-007 item 2; PR3-SEC-13; PR3-SEC-11 R3.4 item 2; ADR-0018 am. 8,
 * D-ARCH-061; PR20-SEC-04 item 2).
 *
 * Node applies NODE_OPTIONS before any JavaScript runs, so an in-process guard cannot stop `--inspect-wait` (the
 * process listens and pauses first) or a `--require`/`--import` preload (it runs first). The api and worker images
 * therefore start through `tools/docker/entrypoint.sh`, which runs `entry-preflight-cli.js` with NODE_OPTIONS
 * REMOVED from the environment (`env -u NODE_OPTIONS`) and its original value in `PREFLIGHT_NODE_OPTIONS`, and execs
 * the application (with the original NODE_OPTIONS and `--disable-sigusr1`) only when this check passes.
 *
 * In `APP_ENV` local and test nothing is refused (compose.debug.yaml may enable the inspector there). Every other
 * value, including an absent or unknown `APP_ENV`, is checked as hardened (fail closed); the configuration loader
 * then reports an invalid `APP_ENV` itself. Refused, each naming only the variable, never a value:
 *  - NODE_OPTIONS with any token outside the option-name allow-list, or not in the canonical `--name[=value]` form;
 *  - any `PG*` variable (libpq/pg environment defaults such as PGOPTIONS, PGSSLMODE, PGHOST), even empty;
 *  - NODE_ENV other than `production`;
 *  - APP_LOG_LEVEL `error`, `fatal` or `silent` (the floor of `logLevelGuard`).
 *
 * Dependency-free on purpose (only `errors.ts` and `node-options.ts`): it runs before any application module loads.
 */
import { type ConfigIssue, ConfigValidationError, formatConfigError } from './errors.js';
import { nodeOptionName, nodeOptionTokens } from './node-options.js';

/** The variable through which the entrypoint passes the original NODE_OPTIONS to the preflight. */
export const PREFLIGHT_NODE_OPTIONS_KEY = 'PREFLIGHT_NODE_OPTIONS';

/** Exit code of a refused preflight: EX_CONFIG, the same as a rejected configuration (`CONFIG_EXIT_CODE`). */
export const PREFLIGHT_EXIT_CODE = 78;

/**
 * NODE_OPTIONS names allowed in staging and production: memory sizing, source maps, DNS order, the CA store choice
 * and diagnostics that only change what is printed. No preload (`--require`, `--import`, `--loader`), no inspector,
 * no policy, permission, config-file or `--conditions` switch, no V8 flag beyond the heap sizes.
 */
export const ALLOWED_NODE_OPTION_NAMES: ReadonlySet<string> = new Set([
  '--max-old-space-size',
  '--max-semi-space-size',
  '--enable-source-maps',
  '--dns-result-order',
  '--use-openssl-ca',
  '--use-bundled-ca',
  '--trace-warnings',
  '--trace-uncaught',
  '--unhandled-rejections',
]);

/** Canonical token shape: `--name` or `--name=value`, lower-case name, a plain value (no quotes, spaces or paths). */
const CANONICAL_TOKEN = /^--[a-z][a-z0-9-]*(?:=[A-Za-z0-9._-]+)?$/;

/** Log levels that would silence ordinary error lines (and, for `silent`, the fatal process-error line). */
export const SUPPRESSING_LOG_LEVELS: ReadonlySet<string> = new Set(['error', 'fatal', 'silent']);

const isAllowedToken = (token: string): boolean => CANONICAL_TOKEN.test(token) && ALLOWED_NODE_OPTION_NAMES.has(nodeOptionName(token));

/** `true` when a NODE_OPTIONS value contains only allow-listed options (the empty value is allowed). */
export const isAllowedNodeOptions = (value: string): boolean => nodeOptionTokens(value).every(isAllowedToken);

type PreflightEnv = Readonly<Record<string, string | undefined>>;

/** Issues for `env` (names and rules only). The NODE_OPTIONS value comes from `PREFLIGHT_NODE_OPTIONS`, else NODE_OPTIONS. */
export function entryPreflightIssues(env: PreflightEnv): readonly ConfigIssue[] {
  if (env.APP_ENV === 'local' || env.APP_ENV === 'test') return [];
  const issues: ConfigIssue[] = [];
  const nodeOptions = env[PREFLIGHT_NODE_OPTIONS_KEY] ?? env.NODE_OPTIONS;
  if (nodeOptions !== undefined && !isAllowedNodeOptions(nodeOptions)) {
    issues.push({ key: 'NODE_OPTIONS', code: 'forbidden-in-environment', rule: 'nodeOptions.allowList' });
  }
  for (const key of Object.keys(env).filter((name) => name.startsWith('PG'))) {
    issues.push({ key, code: 'forbidden-in-environment', rule: 'pg.environment' });
  }
  if (env.NODE_ENV !== 'production') issues.push({ key: 'NODE_ENV', code: 'forbidden-in-environment', rule: 'nodeEnv.production' });
  if (env.APP_LOG_LEVEL !== undefined && SUPPRESSING_LOG_LEVELS.has(env.APP_LOG_LEVEL)) {
    issues.push({ key: 'APP_LOG_LEVEL', code: 'forbidden-in-environment', rule: 'logLevel.floor' });
  }
  return issues;
}

export interface PreflightIo {
  readonly stderr: { write(chunk: string): unknown };
}

/**
 * Runs the preflight over `env` and returns the exit code (0 or `PREFLIGHT_EXIT_CODE`). A refusal writes one
 * value-free report to stderr: a first line naming the preflight, then one line per issue.
 */
export function runEntryPreflight(env: PreflightEnv, io: PreflightIo): number {
  const issues = entryPreflightIssues(env);
  if (issues.length === 0) return 0;
  io.stderr.write(`entrypoint preflight refused (exit ${PREFLIGHT_EXIT_CODE})\n${formatConfigError(new ConfigValidationError(issues))}\n`);
  return PREFLIGHT_EXIT_CODE;
}
