/**
 * Process edge of the configuration package: the only module that touches `process.env`, the file system,
 * stderr and the exit code. API and worker entry points call `loadConfigOrExit('api' | 'worker')` first thing;
 * a rejected configuration prints the key names and reason codes to stderr and exits with `CONFIG_EXIT_CODE`
 * before anything else starts (NFR-OPS-005: well inside 5 s).
 */
import { existsSync, readFileSync } from 'node:fs';
import inspector from 'node:inspector';
import { join } from 'node:path';
import { parseEnv } from 'node:util';

import type { EnvInput } from './env-input.js';
import type { Service } from './environment.js';
import { ConfigValidationError, formatConfigError } from './errors.js';
import { isInspectorOption } from './guards.js';
import { loadConfig } from './load-config.js';
import type { Config } from './schema.js';

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

/** Loads the configuration of `service` or terminates the process naming the rejected keys (never values). */
export function loadConfigOrExit(service: Service, options: LoadConfigOrExitOptions = {}): Config {
  const io = options.io ?? processIo;
  const env = readStartupEnv(options.env ?? process.env, options.cwd ?? process.cwd());
  try {
    const config = loadConfig(env, { service });
    assertNoInspector(config, options.runtime ?? processRuntime);
    return config;
  } catch (error) {
    if (!(error instanceof ConfigValidationError)) throw error;
    io.stderr.write(`${formatConfigError(error)}\n`);
    return io.exit(CONFIG_EXIT_CODE);
  }
}
