/**
 * `loadConfig(env, { service })`: validates the environment of the API or the worker against `CONFIG_SCHEMA`
 * and the cross-key guards (REQ-PLAT-004, NFR-OPS-005, EC-A40). Pure domain logic: the caller passes the
 * environment record; nothing here reads `process.env` or files.
 *
 * Every missing or invalid key is reported in one `ConfigValidationError` (names and reason codes only, never
 * values). On success the result is deeply frozen.
 */
import type Joi from 'joi';

import { deepFreeze, type EnvInput, pickConfigured } from './env-input.js';
import { type AppEnv, ECS_METADATA_KEYS, type Service } from './environment.js';
import { type ConfigIssue, ConfigValidationError } from './errors.js';
import { runGuards } from './guards.js';
import { type Config, CONFIG_KEY_NAMES, CONFIG_SCHEMA, type ConfigKey, configObjectSchema } from './schema.js';
import type { SecretRef } from './secret-refs.js';
import { TOOLING_KEY_NAMES } from './tooling-keys.js';

export interface LoadConfigOptions {
  readonly service: Service;
}

function schemaIssues(error: Joi.ValidationError | undefined): readonly ConfigIssue[] {
  if (error === undefined) return [];
  return error.details.map((detail) => {
    const key = String(detail.path[0] ?? '(root)');
    if (detail.type === 'any.required') return { key, code: 'missing' };
    const rule: unknown = detail.context?.rule;
    return { key, code: 'invalid', rule: typeof rule === 'string' ? rule : detail.type };
  });
}

export function loadConfig(env: EnvInput, options: LoadConfigOptions): Config {
  const raw = pickConfigured(env, CONFIG_KEY_NAMES);
  const validated = configObjectSchema(options.service).validate(raw);
  const value: unknown = validated.value;
  const fromSchema = schemaIssues(validated.error);
  const rejected = new Set(fromSchema.map((issue) => issue.key));
  const converted = (value ?? {}) as Record<string, unknown>;
  const values = Object.fromEntries(Object.entries(converted).filter(([key]) => !rejected.has(key)));
  const appEnv = values.APP_ENV as AppEnv | undefined;
  // Tooling keys are never mapped into the config; only their names reach the guards (toolingKeyGuard).
  const toolingKeys = Object.keys(pickConfigured(env, TOOLING_KEY_NAMES));
  // ECS task-metadata variables: presence only (localAppEnvOnEcsGuard, PR3-SEC-03).
  const ecsMetadataKeys = Object.keys(pickConfigured(env, ECS_METADATA_KEYS));
  const issues = [...fromSchema, ...runGuards({ raw, values, appEnv, toolingKeys, ecsMetadataKeys })];
  if (issues.length > 0) throw new ConfigValidationError(issues);
  return deepFreeze(converted) as Config;
}

/** The secret references present in `config`, keyed by configuration key, for `resolveSecretRefs`. */
export function secretRefsOf(config: Config): ReadonlyMap<ConfigKey, SecretRef> {
  const refs = new Map<ConfigKey, SecretRef>();
  for (const name of CONFIG_KEY_NAMES) {
    const value = config[name];
    if (CONFIG_SCHEMA[name].sensitivity === 'secret-ref' && value !== undefined) refs.set(name, value as SecretRef);
  }
  return refs;
}
