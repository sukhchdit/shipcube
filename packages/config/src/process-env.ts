/**
 * Process edge of the configuration package: the only module that touches `process.env`, the file system,
 * stderr and the exit code. API and worker entry points call `loadRuntimeConfigOrExit('api' | 'worker')` first
 * thing (PR3-SEC-05): it validates the environment, enforces the register holders, resolves the secret references
 * and checks the resolved values. A rejected configuration prints the key names and reason codes to stderr and
 * exits with `CONFIG_EXIT_CODE` before anything else starts (NFR-OPS-005: well inside 5 s).
 */
import { existsSync, readFileSync } from 'node:fs';
import inspector from 'node:inspector';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

import type { EnvInput } from './env-input.js';
import { isLocalAppEnv, type Service } from './environment.js';
import { ConfigValidationError, formatConfigError } from './errors.js';
import { createFileSecretProvider } from './file-secret-provider.js';
import { isInspectorOption } from './guards.js';
import { holderIssues, keysNotHeldBy } from './holders.js';
import { loadConfig, secretRefsOf } from './load-config.js';
import type { Config } from './schema.js';
import {
  checkResolvedSecrets,
  createEnvSecretProvider,
  resolveSecretRefs,
  type ResolveSecretRefsOptions,
  type SecretProvider,
} from './secret-refs.js';
import type { Secret } from './secret.js';

/** Git-ignored developer file for sandbox credentials, read only when `APP_ENV=local` (platform.md §2.7). */
export const LOCAL_ENV_FILE = '.env.local';

/** EX_CONFIG from sysexits(3): the process refused to start because of its configuration. */
export const CONFIG_EXIT_CODE = 78;

/**
 * The environment a process starts with: `env`, plus `.env.local` in `cwd` when `APP_ENV=local`. Non-empty
 * values already in `env` win over the file.
 */
export function readStartupEnv(env: EnvInput, cwd: string): EnvInput {
  if (env.APP_ENV !== 'local') return env;
  const file = join(cwd, LOCAL_ENV_FILE);
  if (!existsSync(file)) return env;
  const merged: Record<string, string | undefined> = { ...env };
  for (const [key, value] of Object.entries(parseEnv(readFileSync(file, 'utf8')))) {
    if (merged[key] === undefined || merged[key] === '') merged[key] = value;
  }
  return merged;
}

export interface StartupIo {
  readonly stderr: { write(chunk: string): unknown };
  readonly exit: (code: number) => never;
}

const processIo: StartupIo = {
  stderr: process.stderr,
  exit: (code) => process.exit(code),
};

/** How the running process was started, independent of NODE_OPTIONS (PR3-SEC-01 item 2). */
export interface RuntimeProbe {
  /** Node CLI options of the process (`process.execArgv`). */
  readonly execArgv: readonly string[];
  /** `true` when the inspector is listening, however it was enabled. */
  readonly inspectorActive: () => boolean;
}

const processRuntime: RuntimeProbe = {
  execArgv: process.execArgv,
  inspectorActive: () => inspector.url() !== undefined,
};

export interface LoadConfigOrExitOptions {
  readonly env?: EnvInput;
  readonly cwd?: string;
  readonly io?: StartupIo;
  readonly runtime?: RuntimeProbe;
}

/** SEC-P3-08 item 6: an inspector enabled on the command line (`node --inspect …`) is refused outside local too. */
function assertNoInspector(config: Config, runtime: RuntimeProbe): void {
  if (config.APP_ENV === 'local') return;
  if (runtime.inspectorActive() || runtime.execArgv.some(isInspectorOption)) {
    throw new ConfigValidationError([{ key: 'NODE_OPTIONS', code: 'debug-flag', rule: 'runtime.inspector' }]);
  }
}

function loadValidated(service: Service, env: EnvInput, runtime: RuntimeProbe): Config {
  const config = loadConfig(env, { service });
  assertNoInspector(config, runtime);
  return config;
}

/** Prints the value-free report and exits with `CONFIG_EXIT_CODE`; any other error is rethrown unchanged. */
function exitOnConfigError(error: unknown, io: StartupIo): never {
  if (!(error instanceof ConfigValidationError)) throw error;
  io.stderr.write(`${formatConfigError(error)}\n`);
  return io.exit(CONFIG_EXIT_CODE);
}

/**
 * Loads the configuration of `service` or terminates the process naming the rejected keys (never values).
 * Synchronous and without secret resolution: entry points use `loadRuntimeConfigOrExit`.
 */
export function loadConfigOrExit(service: Service, options: LoadConfigOrExitOptions = {}): Config {
  const io = options.io ?? processIo;
  const env = readStartupEnv(options.env ?? process.env, options.cwd ?? process.cwd());
  try {
    return loadValidated(service, env, options.runtime ?? processRuntime);
  } catch (error) {
    return exitOnConfigError(error, io);
  }
}

export interface LoadRuntimeConfigOptions extends LoadConfigOrExitOptions {
  /** Secret providers; default: `env` over the start-up environment, and `file` confined to `/run/secrets`. */
  readonly providers?: readonly SecretProvider[];
  /** Budgets and test seams of `resolveSecretRefs`. */
  readonly resolve?: ResolveSecretRefsOptions;
}

/** A started service's configuration: the validated values and the resolved `*_REF` secrets, keyed by config key. */
export interface RuntimeConfig {
  readonly config: Config;
  readonly secrets: ReadonlyMap<string, Secret<string>>;
}

/** PR3-SEC-06: refused in staging/production; named on stderr in local (one shared compose.env until TASK-014). */
function enforceHolders(service: Service, env: EnvInput, config: Config, io: StartupIo): void {
  const issues = holderIssues(env, service, config.APP_ENV);
  if (issues.length > 0) throw new ConfigValidationError(issues);
  if (!isLocalAppEnv(config.APP_ENV) || config.APP_ENV === 'test') return;
  const notHeld = keysNotHeldBy(env, service);
  if (notHeld.length > 0) {
    io.stderr.write(`Configuration warning: ${service} does not hold ${notHeld.join(', ')} (refused in staging/production)\n`);
  }
}

/**
 * The start-up composition every service uses (PR3-SEC-05, PR-0003 code review m4): `loadConfig` and the inspector
 * check, the register holders (PR3-SEC-06), `resolveSecretRefs` over `secretRefsOf(config)` and
 * `checkResolvedSecrets` (placeholder and live-Stripe-key refusals). Any rejection is one `ConfigValidationError`:
 * stderr gets key names and reason codes only, and the process exits with `CONFIG_EXIT_CODE`.
 */
export async function loadRuntimeConfigOrExit(service: Service, options: LoadRuntimeConfigOptions = {}): Promise<RuntimeConfig> {
  const io = options.io ?? processIo;
  const env = readStartupEnv(options.env ?? process.env, options.cwd ?? process.cwd());
  try {
    const config = loadValidated(service, env, options.runtime ?? processRuntime);
    enforceHolders(service, env, config, io);
    const providers = options.providers ?? [createEnvSecretProvider(env), createFileSecretProvider()];
    const secrets = await resolveSecretRefs(secretRefsOf(config), providers, options.resolve);
    const issues = checkResolvedSecrets(secrets, {
      appEnv: config.APP_ENV,
      allowFullStripeTestKey: config.PAYMENT_ALLOW_FULL_TEST_KEY,
    });
    if (issues.length > 0) throw new ConfigValidationError(issues);
    return Object.freeze({ config, secrets });
  } catch (error) {
    return exitOnConfigError(error, io);
  }
}
