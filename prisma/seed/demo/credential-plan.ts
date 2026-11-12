import { isPlaceholder, LOCAL_ONLY_PREFIX, Secret, type AppEnv } from '@platform/config';

import { SEED_PASSWORD_VARIABLES, SeedRefusedError, type DemoCredentialPlan, type SeedPasswordVariable } from '../framework/contracts.js';

/** Same bounds as the `SEED_*` entries of the config schema (`t.secretString(12, 128)`). */
export const SEED_PASSWORD_MIN_LENGTH = 12;
export const SEED_PASSWORD_MAX_LENGTH = 128;

export interface DemoCredentialPlanInput {
  readonly appEnv: AppEnv;
  readonly nodeEnv: string | undefined;
  /** Read-only view of the process environment. A `SEED_*` value is read only where the rules below need it. */
  readonly env: Readonly<Record<string, string | undefined>>;
}

/** `local-only-*` defaults are recognised case-insensitively after NFKC normalisation, like the config loader does. */
const isLocalOnlyDefault = (value: string): boolean => value.normalize('NFKC').toLowerCase().startsWith(LOCAL_ONLY_PREFIX);

const list = (names: readonly string[]): string => names.join(', ');

/**
 * Decides, before any write, how the demo seed provisions credentials (REQ-DATA-002, D-043, D-052, SEC-P3-14):
 * - production: the demo seed is skipped; a present `SEED_*` password variable is a misconfiguration and is refused.
 * - staging: no seeded password; staff and customers receive a set-password link. A present `SEED_*` variable is
 *   refused (its value is only classified, never used), and none is read when absent. An empty value counts as absent.
 * - local / test: every `SEED_*` variable is required and must be 12-128 characters and not a placeholder. The
 *   `local-only-*` defaults are accepted in `local` only.
 *
 * Every offending variable is reported in one {@link SeedRefusedError}. Messages and `subjects` carry variable names
 * only, never a value.
 */
export function planDemoCredentials(input: DemoCredentialPlanInput): DemoCredentialPlan {
  const { appEnv, nodeEnv, env } = input;
  if (nodeEnv === 'production' && (appEnv === 'local' || appEnv === 'test')) {
    throw new SeedRefusedError(
      'SEED_ENVIRONMENT_INVALID',
      ['NODE_ENV', 'APP_ENV'],
      `Seed refused: NODE_ENV=production is incompatible with APP_ENV=${appEnv}; check NODE_ENV and APP_ENV.`,
    );
  }
  if (appEnv === 'production' || appEnv === 'staging') return planHardened(appEnv, env);
  return planSeeded(appEnv, env);
}

function planHardened(appEnv: 'production' | 'staging', env: DemoCredentialPlanInput['env']): DemoCredentialPlan {
  // Presence is tested without reading; a value is read only for a variable that is present, to classify the refusal.
  // An empty value counts as absent, as in local/test: Compose renders an unset `${SEED_X:-}` as '' (code review n2).
  const present = SEED_PASSWORD_VARIABLES.flatMap((name) => {
    if (!Object.hasOwn(env, name)) return [];
    const value = env[name];
    return value === undefined || value === '' ? [] : [{ name, isDefault: isLocalOnlyDefault(value) }];
  });
  if (present.length === 0) {
    return appEnv === 'production' ? { kind: 'skip', reason: 'production' } : { kind: 'set-password-link' };
  }
  const names = present.map((variable) => variable.name);
  const code = present.some((variable) => variable.isDefault) ? 'SEED_DEFAULT_PASSWORD_REFUSED' : 'SEED_PASSWORD_FORBIDDEN';
  throw new SeedRefusedError(
    code,
    names,
    `Seed refused: ${list(names)} must not be set when APP_ENV=${appEnv}; ` +
      (appEnv === 'staging' ? 'staging users receive a set-password link.' : 'the demo seed does not run in production.'),
  );
}

function planSeeded(appEnv: 'local' | 'test', env: DemoCredentialPlanInput['env']): DemoCredentialPlan {
  const passwords = new Map<SeedPasswordVariable, Secret<string>>();
  const missingOrInvalid: string[] = [];
  const refusedDefaults: string[] = [];

  for (const name of SEED_PASSWORD_VARIABLES) {
    const value = env[name];
    if (value === undefined || value === '') {
      missingOrInvalid.push(name);
    } else if (isLocalOnlyDefault(value) ? appEnv === 'test' : isPlaceholder(value)) {
      refusedDefaults.push(name);
    } else if (value.length < SEED_PASSWORD_MIN_LENGTH || value.length > SEED_PASSWORD_MAX_LENGTH) {
      missingOrInvalid.push(name);
    } else {
      passwords.set(name, new Secret(value));
    }
  }

  if (missingOrInvalid.length === 0 && refusedDefaults.length === 0) return { kind: 'seeded-passwords', passwords };

  const parts: string[] = [];
  if (refusedDefaults.length > 0) {
    parts.push(`${list(refusedDefaults)} hold a default or placeholder value, which APP_ENV=${appEnv} does not accept; set a real value`);
  }
  if (missingOrInvalid.length > 0) {
    parts.push(
      `${list(missingOrInvalid)} must be set to ${SEED_PASSWORD_MIN_LENGTH}-${SEED_PASSWORD_MAX_LENGTH} characters (missing or wrong length)`,
    );
  }
  throw new SeedRefusedError(
    refusedDefaults.length > 0 ? 'SEED_DEFAULT_PASSWORD_REFUSED' : 'SEED_VARIABLE_MISSING',
    [...refusedDefaults, ...missingOrInvalid],
    `Seed refused: ${parts.join('; ')}.`,
  );
}
