/**
 * Seed CLI (TASK-023, US-049; data-model §9). `npm run db:seed` runs `reference` (all environments),
 * `npm run db:seed:demo` runs `demo` (reference first, then the demo users; skipped when APP_ENV=production).
 *
 * Exit codes: 0 success · 1 refusal (a precondition failed before or instead of writing; stderr names the variable or
 * dataset and a code, never a value) · 2 unexpected error or bad usage. Output is JSON lines. Nothing here prints the
 * database URL or any password.
 */
import { readFileSync } from 'node:fs';

import pg from 'pg';

import { SeedRefusedError, type ConfigChange, type ConfigChangeSink, type SeedLogger, type SeedSql } from './framework/contracts.js';
import { runReferenceSeed } from './framework/runner.js';
import { DEFERRED_PROVISIONER, DEMO_USERS, parseAppEnv, planDemoCredentials, runDemoSeed } from './demo/index.js';
import { REFERENCE_DATASETS, REFERENCE_STEPS } from './reference/index.js';

export const COMMANDS = ['reference', 'demo'] as const;
type Command = (typeof COMMANDS)[number];

const CONNECT_TIMEOUT_MS = 10_000;
const STATEMENT_TIMEOUT_MS = 120_000;
/** The migrator session is privileged: pin the search path like tools/db/bootstrap.ts (SEC-P3-34 item 2). */
const SESSION_OPTIONS = '-c search_path=pg_catalog,pg_temp';

export interface Output {
  readonly out: (line: string) => void;
  readonly err: (line: string) => void;
}

const processOutput: Output = {
  out: (line) => process.stdout.write(`${line}\n`),
  err: (line) => process.stderr.write(`${line}\n`),
};

function jsonLogger(out: Output['out'], level: 'info' | 'warn'): SeedLogger['info'] {
  return (event, fields) => {
    out(JSON.stringify({ level, event, ...fields }));
  };
}

function createLogger(output: Output): SeedLogger {
  return { info: jsonLogger(output.out, 'info'), warn: jsonLogger(output.out, 'warn') };
}

/**
 * Secret from `NAME` or from the file named by `NAME_FILE` (Compose secrets). Mirrors `readSecret` in
 * tools/db/bootstrap.ts: the layering rules keep prisma/ from importing tools/. Never logged.
 */
function readSecret(env: NodeJS.ProcessEnv, name: string): string {
  const direct = env[name];
  if (direct !== undefined && direct !== '') return direct;
  const file = env[`${name}_FILE`];
  if (file !== undefined && file !== '') return readFileSync(file, 'utf8').replace(/\r?\n$/, '');
  throw new SeedRefusedError('SEED_VARIABLE_MISSING', [name], `Seed refused: ${name} (or ${name}_FILE) is not set.`);
}

/**
 * Receives configuration changes inside the seed transaction. Until the audit writer (TASK-025) and the authz
 * reconciler (TASK-221) provide the `CONFIG_CHANGE` audit entry, a change is logged with dataset, versions and hash only.
 */
const loggingConfigChangeSink = (logger: SeedLogger): ConfigChangeSink => ({
  configChanged(_sql: SeedSql, change: ConfigChange): Promise<void> {
    logger.info('seed.config_change', {
      dataset: change.dataset,
      fromVersion: change.fromVersion ?? 'none',
      toVersion: change.toVersion,
      fromSha256: change.fromSha256 ?? 'none',
      toSha256: change.toSha256,
    });
    return Promise.resolve();
  },
});

async function withMigratorConnection<T>(connectionString: string, run: (sql: SeedSql) => Promise<T>): Promise<T> {
  const client = new pg.Client({
    connectionString,
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: STATEMENT_TIMEOUT_MS,
    idle_in_transaction_session_timeout: STATEMENT_TIMEOUT_MS,
    application_name: 'platform-seed',
    options: SESSION_OPTIONS,
  });
  await client.connect();
  try {
    return await run(client);
  } finally {
    await client.end();
  }
}

const isCommand = (value: string | undefined): value is Command => COMMANDS.some((command) => command === value);

/** Replaces every secret substring in `text`, so an error from a driver can never echo the URL. */
function redact(text: string, secrets: readonly string[]): string {
  return secrets.filter((secret) => secret !== '').reduce((result, secret) => result.split(secret).join('[redacted]'), text);
}

export async function main(argv: readonly string[], env: NodeJS.ProcessEnv = process.env, output: Output = processOutput): Promise<number> {
  const command = argv[0];
  if (!isCommand(command)) {
    output.err(JSON.stringify({ level: 'error', event: 'seed.usage', message: `usage: seed <${COMMANDS.join('|')}>` }));
    return 2;
  }
  const logger = createLogger(output);
  const secrets: string[] = [];
  try {
    const appEnv = parseAppEnv(env['APP_ENV']);
    // Demo credentials are decided before anything connects or writes (REQ-DATA-002, AT-US-049-04/-06).
    const plan = command === 'demo' ? planDemoCredentials({ appEnv, nodeEnv: env['NODE_ENV'], env }) : undefined;

    const url = readSecret(env, 'DATABASE_MIGRATOR_URL');
    secrets.push(url);
    const reference = await withMigratorConnection(url, (sql) =>
      runReferenceSeed({
        sql,
        datasets: REFERENCE_DATASETS,
        steps: REFERENCE_STEPS,
        logger,
        configChanges: loggingConfigChangeSink(logger),
      }),
    );
    logger.info('seed.reference.done', {
      datasets: reference.datasets.length,
      applied: reference.datasets.filter((dataset) => dataset.status === 'applied').length,
      steps: reference.steps.length,
    });

    if (plan !== undefined) {
      const demo = await runDemoSeed({ appEnv, users: DEMO_USERS, provisioner: DEFERRED_PROVISIONER, logger }, plan);
      logger.info('seed.demo.done', { ...demo });
    }
    return 0;
  } catch (error) {
    if (error instanceof SeedRefusedError) {
      output.err(JSON.stringify({ level: 'error', event: 'seed.refused', code: error.code, subjects: error.subjects }));
      return 1;
    }
    const name = error instanceof Error ? error.name : 'Error';
    const message = error instanceof Error ? redact(error.message, secrets) : 'non-error value thrown';
    output.err(JSON.stringify({ level: 'error', event: 'seed.failed', error: name, message }));
    return 2;
  }
}

if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
