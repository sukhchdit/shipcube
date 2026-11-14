/**
 * Container entrypoint preflight (TASK-014; D-ORCH-007 item 2; PR3-SEC-13; PR3-SEC-11 R3.4 item 2; ADR-0018 am. 8,
 * D-ARCH-061; PR20-SEC-04 item 2; PR39-SEC-02; PR9-SEC-04 item 3).
 *
 * Node applies NODE_OPTIONS and its command-line options before any JavaScript runs, so an in-process guard cannot
 * stop `--inspect-wait` (the process listens and pauses first) or a `--require`/`--import` preload (it runs first).
 * The api and worker images therefore start through `tools/docker/entrypoint.sh`, which runs `entry-preflight-cli.js`
 * with NODE_OPTIONS REMOVED from the environment (`env -u NODE_OPTIONS`), its original value in
 * `PREFLIGHT_NODE_OPTIONS` and the container argv after a `--` separator, and execs the application (with the
 * original NODE_OPTIONS, `--disable-sigusr1` and that argv) only when this check passes.
 *
 * The environment is hardened unless `APP_ENV` is local or test AND no ECS task-metadata variable is set non-empty
 * (the second signal of `localAppEnvOnEcsGuard`, PR39-SEC-02 (b)): an absent or unknown `APP_ENV` is hardened (fail
 * closed; the configuration loader then reports it), and so is `APP_ENV=local` inside an ECS task. In local/test
 * outside ECS nothing is refused (compose.debug.yaml may enable the inspector there). Hardened, the preflight
 * refuses, each issue naming only the variable (or `CMD`), never a value or an argument:
 *  - a container argv other than exactly one `dist/….js` entry script (`CMD`, rule `argv.entryOnly`, PR39-SEC-02 (a));
 *  - NODE_OPTIONS with any token outside the option-name allow-list, a value outside the option's allowed values,
 *    or not in the canonical `--name[=value]` form;
 *  - NODE_EXTRA_CA_CERTS other than the RDS bundle path, and SSL_CERT_FILE / SSL_CERT_DIR at all, even empty
 *    (PR39-SEC-02 (c), PR9-SEC-04 item 3);
 *  - NODE_TLS_REJECT_UNAUTHORIZED other than unset or `1` (PR9-SEC-04);
 *  - any `PG*` variable (libpq/pg environment defaults such as PGOPTIONS, PGSSLMODE, PGHOST), even empty;
 *  - NODE_ENV other than `production`;
 *  - APP_LOG_LEVEL `error`, `fatal` or `silent` (the floor of `logLevelGuard`).
 *
 * Dependency-free on purpose (only `errors.ts`, `node-options.ts` and the import-free constants of
 * `environment.ts`): it runs before any application module loads.
 */
import { ECS_METADATA_KEYS, TLS_REJECT_UNAUTHORIZED_KEY } from './environment.js';
import { type ConfigIssue, ConfigValidationError, formatConfigError } from './errors.js';
import { nodeOptionName, nodeOptionTokens } from './node-options.js';

/** The variable through which the entrypoint passes the original NODE_OPTIONS to the preflight. */
export const PREFLIGHT_NODE_OPTIONS_KEY = 'PREFLIGHT_NODE_OPTIONS';

/** Exit code of a refused preflight: EX_CONFIG, the same as a rejected configuration (`CONFIG_EXIT_CODE`). */
export const PREFLIGHT_EXIT_CODE = 78;

/** The issue key that stands for the container argv (the image CMD or a task-definition `command`). */
export const ARGV_ISSUE_KEY = 'CMD';

/**
 * The only NODE_EXTRA_CA_CERTS value allowed when hardened: the RDS global bundle baked at M5 under
 * DATABASE_CA_DIRECTORIES `/etc/ssl/platform` (D-ARCH-116 rule 4; PR9-SEC-04 item 3).
 */
export const RDS_CA_BUNDLE_PATH = '/etc/ssl/platform/rds-global-bundle.pem';

/** Variables that replace OpenSSL's trust store; refused whenever present, even empty (rule `caStore.fixed`). */
export const CA_STORE_KEYS: readonly string[] = Object.freeze(['SSL_CERT_FILE', 'SSL_CERT_DIR']);

/**
 * The container argv allowed when hardened: one relative `dist/….js` entry script (`dist/main.js` in both images).
 * No option token (the regex anchors on `dist/`), no absolute path; a `..` segment is refused separately.
 */
const ENTRY_SCRIPT = /^dist\/[A-Za-z0-9_][A-Za-z0-9/_.-]*\.js$/;

/**
 * NODE_OPTIONS names allowed in staging and production: memory sizing, source maps, DNS order, Node's bundled CA
 * store and diagnostics that only change what is printed. No preload (`--require`, `--import`, `--loader`), no
 * inspector, no policy, permission, config-file or `--conditions` switch, no V8 flag beyond the heap sizes.
 *
 * `--use-openssl-ca` is NOT allowed (architect R4, R1-n6): the runtime image carries no system CA store (no
 * ca-certificates, no /etc/ssl/certs); outbound TLS uses Node's bundled Mozilla store, so --use-openssl-ca could
 * only make every TLS call fail (or, with SSL_CERT_FILE / SSL_CERT_DIR, swap the trust store of every client).
 */
export const ALLOWED_NODE_OPTION_NAMES: ReadonlySet<string> = new Set([
  '--max-old-space-size',
  '--max-semi-space-size',
  '--enable-source-maps',
  '--dns-result-order',
  '--use-bundled-ca',
  '--trace-warnings',
  '--trace-uncaught',
  '--unhandled-rejections',
]);

/**
 * Allowed options whose value is constrained; the bare flag and any other value are refused. `--unhandled-rejections`
 * may only make an unhandled rejection fatal (`strict`, `throw`), never quieter (`none`, `warn`, ...).
 */
export const CONSTRAINED_NODE_OPTION_VALUES: ReadonlyMap<string, ReadonlySet<string>> = new Map([
  ['--unhandled-rejections', new Set(['strict', 'throw'])],
]);

/** Canonical token shape: `--name` or `--name=value`, lower-case name, a plain value (no quotes, spaces or paths). */
const CANONICAL_TOKEN = /^--[a-z][a-z0-9-]*(?:=[A-Za-z0-9._-]+)?$/;

/** Log levels that would silence ordinary error lines (and, for `silent`, the fatal process-error line). */
export const SUPPRESSING_LOG_LEVELS: ReadonlySet<string> = new Set(['error', 'fatal', 'silent']);

function isAllowedToken(token: string): boolean {
  if (!CANONICAL_TOKEN.test(token)) return false;
  const name = nodeOptionName(token);
  if (!ALLOWED_NODE_OPTION_NAMES.has(name)) return false;
  const allowedValues = CONSTRAINED_NODE_OPTION_VALUES.get(name);
  if (allowedValues === undefined) return true;
  const separator = token.indexOf('=');
  return separator !== -1 && allowedValues.has(token.slice(separator + 1));
}

/** `true` when a NODE_OPTIONS value contains only allow-listed options (the empty value is allowed). */
export const isAllowedNodeOptions = (value: string): boolean => nodeOptionTokens(value).every(isAllowedToken);

/** `true` when `argv` is exactly one `dist/….js` entry script with no `..` segment (PR39-SEC-02 (a), R1-m1). */
export function isAllowedEntryArgv(argv: readonly string[]): boolean {
  if (argv.length !== 1) return false;
  const [script = ''] = argv;
  return !script.startsWith('-') && ENTRY_SCRIPT.test(script) && !script.split('/').includes('..');
}

/** The CLI's application argv: every argument after the first `--`; none (refused when hardened) without one. */
export function argvAfterSeparator(args: readonly string[]): readonly string[] {
  const separator = args.indexOf('--');
  return separator === -1 ? [] : args.slice(separator + 1);
}

type PreflightEnv = Readonly<Record<string, string | undefined>>;

/** Names of the ECS task-metadata variables set non-empty (the AWS signal of `localAppEnvOnEcsGuard`). */
export const presentEcsMetadataKeys = (env: PreflightEnv): readonly string[] => ECS_METADATA_KEYS.filter((key) => (env[key] ?? '') !== '');

/** `false` only for APP_ENV local/test outside an ECS task (PR39-SEC-02 (b): the ECS variable is the second signal). */
export const isHardenedPreflightEnv = (env: PreflightEnv): boolean =>
  !(env.APP_ENV === 'local' || env.APP_ENV === 'test') || presentEcsMetadataKeys(env).length > 0;

const forbidden = (key: string, rule: string): ConfigIssue => ({ key, code: 'forbidden-in-environment', rule });

function trustStoreIssues(env: PreflightEnv): ConfigIssue[] {
  const issues: ConfigIssue[] = [];
  const extraCaCerts = env.NODE_EXTRA_CA_CERTS;
  if (extraCaCerts !== undefined && extraCaCerts !== RDS_CA_BUNDLE_PATH)
    issues.push(forbidden('NODE_EXTRA_CA_CERTS', 'caBundle.allowList'));
  for (const key of CA_STORE_KEYS) if (env[key] !== undefined) issues.push(forbidden(key, 'caStore.fixed'));
  const rejectUnauthorized = env[TLS_REJECT_UNAUTHORIZED_KEY];
  if (rejectUnauthorized !== undefined && rejectUnauthorized !== '1') issues.push(forbidden(TLS_REJECT_UNAUTHORIZED_KEY, 'tls.verify'));
  return issues;
}

/**
 * Issues for `env` and the container `argv` (names and rules only). The NODE_OPTIONS value comes from
 * `PREFLIGHT_NODE_OPTIONS`, else NODE_OPTIONS. `argv` is required: an empty argv is refused when hardened.
 */
export function entryPreflightIssues(env: PreflightEnv, argv: readonly string[]): readonly ConfigIssue[] {
  if (!isHardenedPreflightEnv(env)) return [];
  const issues: ConfigIssue[] = [];
  if (!isAllowedEntryArgv(argv)) issues.push(forbidden(ARGV_ISSUE_KEY, 'argv.entryOnly'));
  const nodeOptions = env[PREFLIGHT_NODE_OPTIONS_KEY] ?? env.NODE_OPTIONS;
  if (nodeOptions !== undefined && !isAllowedNodeOptions(nodeOptions)) issues.push(forbidden('NODE_OPTIONS', 'nodeOptions.allowList'));
  issues.push(...trustStoreIssues(env));
  for (const key of Object.keys(env).filter((name) => name.startsWith('PG'))) issues.push(forbidden(key, 'pg.environment'));
  if (env.NODE_ENV !== 'production') issues.push(forbidden('NODE_ENV', 'nodeEnv.production'));
  if (env.APP_LOG_LEVEL !== undefined && SUPPRESSING_LOG_LEVELS.has(env.APP_LOG_LEVEL))
    issues.push(forbidden('APP_LOG_LEVEL', 'logLevel.floor'));
  return issues;
}

export interface PreflightIo {
  readonly stderr: { write(chunk: string): unknown };
}

/**
 * Runs the preflight over `env` and the container `argv` and returns the exit code (0 or `PREFLIGHT_EXIT_CODE`). A
 * refusal writes one value-free report to stderr: a first line naming the preflight, then one line per issue.
 */
export function runEntryPreflight(env: PreflightEnv, io: PreflightIo, argv: readonly string[]): number {
  const issues = entryPreflightIssues(env, argv);
  if (issues.length === 0) return 0;
  io.stderr.write(`entrypoint preflight refused (exit ${PREFLIGHT_EXIT_CODE})\n${formatConfigError(new ConfigValidationError(issues))}\n`);
  return PREFLIGHT_EXIT_CODE;
}
