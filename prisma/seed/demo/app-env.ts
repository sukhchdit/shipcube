import { APP_ENVS, type AppEnv } from '@platform/config';

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
