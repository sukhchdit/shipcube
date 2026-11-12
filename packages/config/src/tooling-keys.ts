/**
 * Tooling-only configuration keys (TASK-003 reconciliation, PR-0003 §4 / PR-0005 §4): the migrate job, the
 * Prisma CLI and the one-shot `db:bootstrap` / `db:reset` tools read these keys; the API and the worker never do.
 *
 * They are NOT part of `CONFIG_SCHEMA`: `loadConfig` never maps them into a `Config`, and in staging and
 * production the API and the worker refuse to start when one of them is present in their environment
 * (`toolingKeyGuard`). They are documented in `.env.example` and covered by the parity tests, so the placeholder
 * rules apply to them as well. Names are exactly TASK-003's (`prisma.config.ts`, `tools/db/bootstrap.ts`),
 * including Docker's `<NAME>_FILE` idiom for the bootstrap passwords.
 */
import type { KeyHolder } from './keys.js';

export interface ToolingKeySpec {
  readonly name: string;
  readonly description: string;
  /** `secret` values are credentials; `secret-ref` values name a file that holds the credential. */
  readonly sensitivity: 'secret' | 'secret-ref';
  readonly holders: readonly KeyHolder[];
}

const spec = (
  name: string,
  sensitivity: ToolingKeySpec['sensitivity'],
  holders: readonly KeyHolder[],
  description: string,
): ToolingKeySpec => Object.freeze({ name, description, sensitivity, holders: Object.freeze([...holders]) });

export const TOOLING_CONFIG_KEYS: readonly ToolingKeySpec[] = Object.freeze([
  spec('DATABASE_MIGRATOR_URL', 'secret', ['migrate'], 'PostgreSQL URL of platform_migrator (migrate job and Prisma CLI only).'),
  spec('SHADOW_DATABASE_URL', 'secret', ['migrate'], 'Prisma shadow database URL (development tooling only).'),
  spec(
    'DATABASE_BOOTSTRAP_URL',
    'secret',
    ['bootstrap'],
    'Cluster-admin PostgreSQL URL of the one-shot role bootstrap (db:bootstrap, db:reset).',
  ),
  spec('BOOTSTRAP_MIGRATOR_PASSWORD', 'secret', ['bootstrap'], 'Password the bootstrap sets for platform_migrator.'),
  spec('BOOTSTRAP_MIGRATOR_PASSWORD_FILE', 'secret-ref', ['bootstrap'], 'File holding BOOTSTRAP_MIGRATOR_PASSWORD (Docker _FILE idiom).'),
  spec('BOOTSTRAP_APP_PASSWORD', 'secret', ['bootstrap'], 'Password the bootstrap sets for platform_app.'),
  spec('BOOTSTRAP_APP_PASSWORD_FILE', 'secret-ref', ['bootstrap'], 'File holding BOOTSTRAP_APP_PASSWORD (Docker _FILE idiom).'),
]);

/** Names of the tooling keys, in declaration order. */
export const TOOLING_KEY_NAMES: readonly string[] = Object.freeze(TOOLING_CONFIG_KEYS.map((key) => key.name));
