import { APP_ENVS, ECS_METADATA_KEYS, isLocalAppEnv, type AppEnv } from '@platform/config';

import { SeedRefusedError } from '../framework/contracts.js';

const KNOWN_APP_ENVS: readonly string[] = APP_ENVS;

/**
 * Parses `APP_ENV` for the seed CLI. The seed decides what it may write from this value (REQ-DATA-002), so a missing or
 * unknown value is refused instead of defaulted: guessing `local` could seed demo credentials into a real environment.
 * The refusal names the variable only.
 */
export function parseAppEnv(raw: string | undefined): AppEnv {
  if (raw !== undefined && KNOWN_APP_ENVS.includes(raw)) return raw as AppEnv;
  throw new SeedRefusedError(
    'SEED_ENVIRONMENT_INVALID',
    ['APP_ENV'],
    `Seed refused: APP_ENV must be set to one of ${APP_ENVS.join(', ')}.`,
  );
}

/**
 * ADR-0018 am. 8 (D-ARCH-061) second signal, as `loadConfig` applies it to api/worker: `APP_ENV ∈ {local, test}` is
 * refused when an ECS task-metadata variable (`ECS_METADATA_KEYS`) is present and non-empty, because those values
 * unlock `local-only-*` demo passwords (PR13-SEC-02, threat T-23). Names variables only, never a value.
 */
export function assertNotLocalOnEcs(appEnv: AppEnv, env: Readonly<Record<string, string | undefined>>): void {
  const signals = ECS_METADATA_KEYS.filter((key) => (env[key] ?? '') !== '');
  if (isLocalAppEnv(appEnv) && signals.length > 0) {
    throw new SeedRefusedError(
      'SEED_ENVIRONMENT_INVALID',
      ['APP_ENV', ...signals],
      `Seed refused: APP_ENV=${appEnv} is not allowed on an ECS task (${signals.join(', ')} set).`,
    );
  }
}
