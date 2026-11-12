/**
 * Key-register holders at runtime start-up (PR3-SEC-06, PR-0003 code review m5; ADR-0018 amendment 1 "Holder").
 * A service must not even receive key material the register gives to another holder: the API never holds the
 * audit-anchor signing key, the worker never holds the CSRF, MFA or login-counter keys. Pure: the caller passes
 * the start-up environment; only variable NAMES are read and reported.
 *
 * Tooling keys (`DATABASE_MIGRATOR_URL`, `SHADOW_DATABASE_URL`, bootstrap credentials) are not runtime
 * configuration; `toolingKeyGuard` refuses them in staging and production, so they are not repeated here.
 */
import { type EnvInput, pickConfigured } from './env-input.js';
import { type AppEnv, isHardenedAppEnv, type Service } from './environment.js';
import type { ConfigIssue } from './errors.js';
import { KEY_REGISTER, type KeyHolder, PREVIOUS_SUFFIX } from './keys.js';
import { CONFIG_KEY_NAMES } from './schema.js';

const RUNTIME_KEYS: ReadonlySet<string> = new Set(CONFIG_KEY_NAMES);

/** Holders of every runtime register variable, including its `<NAME>_PREVIOUS` rotation twin. */
const HOLDERS_BY_VARIABLE: ReadonlyMap<string, readonly KeyHolder[]> = new Map(
  KEY_REGISTER.flatMap((entry) =>
    entry.variables
      .flatMap((variable) => [variable, `${variable}${PREVIOUS_SUFFIX}`])
      .filter((variable) => RUNTIME_KEYS.has(variable))
      .map((variable) => [variable, entry.holders] as const),
  ),
);

/** Names of configured (non-empty) register variables that `service` does not hold, sorted. */
export function keysNotHeldBy(env: EnvInput, service: Service): readonly string[] {
  const configured = Object.keys(pickConfigured(env, [...HOLDERS_BY_VARIABLE.keys()]));
  return Object.freeze(configured.filter((name) => !(HOLDERS_BY_VARIABLE.get(name) ?? []).includes(service)).sort());
}

/**
 * Start-up issues for keys `service` does not hold: refused in staging and production. In local and test the
 * keys are reported to the caller as warnings instead (see `loadRuntimeConfigOrExit`), because `compose.env` is
 * one file shared by every service until TASK-014 splits the per-service environments.
 */
export function holderIssues(env: EnvInput, service: Service, appEnv: AppEnv): readonly ConfigIssue[] {
  if (!isHardenedAppEnv(appEnv)) return [];
  return keysNotHeldBy(env, service).map((key) => ({ key, code: 'forbidden-for-service', rule: `holders.${service}` }));
}
