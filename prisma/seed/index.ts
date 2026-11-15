/**
 * Seed CLI (TASK-023, US-049; data-model §9). `npm run db:seed` runs `reference` (all environments),
 * `npm run db:seed:demo` runs `demo` (reference first, then the demo users; skipped when APP_ENV=production).
 *
 * Exit codes: 0 success · 1 refusal (a precondition failed before or instead of writing; stderr names the variable or
 * dataset and a code, never a value) · 2 unexpected error or bad usage. Output is JSON lines. Nothing here prints the
 * database URL or any password.
 */
import { types } from 'node:util';

import {
  SeedRefusedError,
  type ConfigChange,
  type ConfigChangeSink,
  type DemoCredentialPlan,
  type SeedLogger,
  type SeedSql,
} from './framework/contracts.js';
import { runReferenceSeed } from './framework/runner.js';
import { assertNotLocalOnEcs, DEFERRED_PROVISIONER, DEMO_USERS, parseAppEnv, planDemoCredentials, runDemoSeed } from './demo/index.js';
import { type MigratorClientFactory, readMigratorUrl, refuseFileVariants, withMigratorConnection } from './migrator-connection.js';
import { REFERENCE_DATASETS, REFERENCE_STEPS } from './reference/index.js';

export const COMMANDS = ['reference', 'demo'] as const;
type Command = (typeof COMMANDS)[number];

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
 * Receives configuration changes inside the seed transaction. Until the audit writer (TASK-025) and the authz
 * reconciler (TASK-221) provide the `CONFIG_CHANGE` audit entry, a change is logged with dataset, versions and hash only.
 */
export const loggingConfigChangeSink = (logger: SeedLogger): ConfigChangeSink => ({
  configChanged(_sql: SeedSql, change: ConfigChange): Promise<void> {
    if (change.kind === 'drift-restored') {
      logger.info('seed.config_change', {
        kind: change.kind,
        dataset: change.dataset,
        version: change.version,
        sha256: change.sha256,
        restoredRows: change.restoredRows,
      });
    } else {
      logger.info('seed.config_change', {
        kind: change.kind,
        dataset: change.dataset,
        fromVersion: change.fromVersion ?? 'none',
        toVersion: change.toVersion,
        fromSha256: change.fromSha256 ?? 'none',
        toSha256: change.toSha256,
      });
    }
    return Promise.resolve();
  },
});

const isCommand = (value: string | undefined): value is Command => COMMANDS.some((command) => command === value);

/** Replaces every secret substring in `text` (longest first), so a driver or provider error can never echo one. */
function redact(text: string, secrets: readonly string[]): string {
  return [...secrets]
    .filter((secret) => secret !== '')
    .sort((a, b) => b.length - a.length)
    .reduce((result, secret) => result.split(secret).join('[redacted]'), text);
}

/** The revealed `SEED_*` passwords of a seeded plan, so a provisioner error can never echo one (PR13-SEC-07). */
const planSecrets = (plan: DemoCredentialPlan | undefined): string[] =>
  plan?.kind === 'seeded-passwords' ? [...plan.passwords.values()].map((password) => password.reveal()) : [];

export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  output: Output = processOutput,
  /** Test seam only (the CLI entry passes nothing): replaces the driver client factory. */
  createClient?: MigratorClientFactory,
): Promise<number> {
  const command = argv[0];
  if (!isCommand(command)) {
    output.err(JSON.stringify({ level: 'error', event: 'seed.usage', message: `usage: seed <${COMMANDS.join('|')}>` }));
    return 2;
  }
  const logger = createLogger(output);
  const secrets: string[] = [];
  try {
    refuseFileVariants(env);
    const appEnv = parseAppEnv(env['APP_ENV']);
    // ADR-0018 am. 8 second signal: APP_ENV=local|test is refused on an ECS task (PR13-SEC-02).
    assertNotLocalOnEcs(appEnv, env);
    // Demo credentials are decided before anything connects or writes (REQ-DATA-002, AT-US-049-04/-06).
    const plan = command === 'demo' ? planDemoCredentials({ appEnv, nodeEnv: env['NODE_ENV'], env }) : undefined;
    secrets.push(...planSecrets(plan));

    const migrator = readMigratorUrl(env);
    secrets.push(...migrator.secrets);
    const reference = await withMigratorConnection(
      migrator.url,
      (sql) =>
        runReferenceSeed({
          sql,
          datasets: REFERENCE_DATASETS,
          steps: REFERENCE_STEPS,
          logger,
          configChanges: loggingConfigChangeSink(logger),
        }),
      createClient === undefined ? {} : { createClient },
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
    // isNativeError, not instanceof: driver and socket errors may come from another realm (e.g. a test VM context).
    const native = types.isNativeError(error);
    const name = native ? error.name : 'Error';
    const message = native ? redact(error.message, secrets) : 'non-error value thrown';
    output.err(JSON.stringify({ level: 'error', event: 'seed.failed', error: name, message }));
    return 2;
  }
}

if (import.meta.main) {
  void main(process.argv.slice(2)).then((code) => {
    process.exitCode = code;
  });
}
