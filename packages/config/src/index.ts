// Public entry point of @platform/config: typed, Joi-validated configuration and the key/secret register
// (ADR-0018). Re-exports only (D-ARCH-036). Build-time web config: `@platform/config/web`; test environments:
// `@platform/config/testing`.
export {
  APP_ENVS,
  ECS_METADATA_KEYS,
  HARDENED_APP_ENVS,
  isHardenedAppEnv,
  isLocalAppEnv,
  LOCAL_APP_ENVS,
  NODE_ENVS,
  SERVICES,
  TLS_REJECT_UNAUTHORIZED_KEY,
} from './environment.js';
export type { AppEnv, NodeEnv, Service } from './environment.js';
export { ConfigValidationError, formatConfigError } from './errors.js';
export type { ConfigIssue, ConfigIssueCode } from './errors.js';
export { GUARDS, isInspectorOption, nodeOptionTokens, runGuards, RUNTIME_DATABASE_URL_PARAMS } from './guards.js';
export type { Guard, GuardInput } from './guards.js';
export {
  createFileSecretProvider,
  SECRET_FILE_MAX_BYTES,
  SecretFileError,
  type FileSecretProviderOptions,
  type SecretFileSystem,
} from './file-secret-provider.js';
export {
  findDuplicateKeyMaterial,
  KEY_REGISTER,
  MAX_JWT_SIGNING_KEYS,
  MIN_SYMMETRIC_KEY_BYTES,
  parseKeySet,
  parseKeyVersion,
  parsePublicKeySet,
  PREVIOUS_SUFFIX,
  registerEntryFor,
} from './keys.js';
export type { KeyHolder, KeyMaterialKind, KeyRegisterEntry, KeyVersion, ParseResult, PublicKeyVersion } from './keys.js';
export { loadConfig, secretRefsOf } from './load-config.js';
export type { LoadConfigOptions } from './load-config.js';
export { ENV_EXAMPLE_PLACEHOLDER, isPlaceholder, LOCAL_ONLY_PREFIX, PLACEHOLDER_PATTERNS } from './placeholders.js';
export { holderIssues, keysNotHeldBy } from './holders.js';
export { CONFIG_EXIT_CODE, loadConfigOrExit, loadRuntimeConfigOrExit, LOCAL_ENV_FILE, readStartupEnv } from './process-env.js';
export type { LoadConfigOrExitOptions, LoadRuntimeConfigOptions, RuntimeConfig, RuntimeProbe, StartupIo } from './process-env.js';
export {
  BCRYPT_COST_FLOOR,
  BCRYPT_COST_MAX,
  CONFIG_KEY_NAMES,
  DB_CONNECTION_TIMEOUT_MS_DEFAULT,
  DB_IDLE_TIMEOUT_MS_DEFAULT,
  DB_POOL_MAX_DEFAULTS,
  DB_POOL_MAX_LIMIT,
  DB_STATEMENT_TIMEOUT_MS_DEFAULT,
  DB_STATEMENT_TIMEOUT_MS_LIMIT,
  CONFIG_SCHEMA,
  configObjectSchema,
  describeConfigKeys,
  requiredKeysFor,
  SECRET_KEY_NAMES,
} from './schema.js';
export type { Config, ConfigKey, ConfigKeyInfo, ConfigSchema, KeySpec, Sensitivity } from './schema.js';
export {
  checkResolvedSecrets,
  createEnvSecretProvider,
  parseSecretRef,
  resolveSecretRefs,
  SECRET_PROVIDER_KINDS,
  SECRET_RESOLVE_TIMEOUT_MS,
  SecretNotFoundError,
} from './secret-refs.js';
export type { ResolvedSecretContext, ResolveSecretRefsOptions, SecretProvider, SecretProviderKind, SecretRef } from './secret-refs.js';
export { REDACTED, Secret } from './secret.js';
export { TOOLING_CONFIG_KEYS, TOOLING_KEY_NAMES } from './tooling-keys.js';
export type { ToolingKeySpec } from './tooling-keys.js';
