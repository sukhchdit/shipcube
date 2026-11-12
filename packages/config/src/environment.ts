/** Environment and process vocabularies (ADR-0018 §4). */
export const APP_ENVS = ['local', 'test', 'staging', 'production'] as const;
export type AppEnv = (typeof APP_ENVS)[number];

export const NODE_ENVS = ['development', 'test', 'production'] as const;
export type NodeEnv = (typeof NODE_ENVS)[number];

/** Processes that load the runtime configuration through `loadConfig`. */
export const SERVICES = ['api', 'worker'] as const;
export type Service = (typeof SERVICES)[number];

/** Environments in which compose defaults, plain local transport and the Mock adapters are allowed. */
export const LOCAL_APP_ENVS: readonly AppEnv[] = Object.freeze(['local', 'test']);

/** Environments in which placeholder and `local-only-*` values are refused (SEC-P3-08 item 5). */
export const HARDENED_APP_ENVS: readonly AppEnv[] = Object.freeze(['staging', 'production']);

export const isLocalAppEnv = (appEnv: AppEnv | undefined): boolean => appEnv !== undefined && LOCAL_APP_ENVS.includes(appEnv);

export const isHardenedAppEnv = (appEnv: AppEnv | undefined): boolean => appEnv !== undefined && HARDENED_APP_ENVS.includes(appEnv);

/**
 * Variables the ECS agent injects into every task container (AWS ECS task metadata endpoint v3 and v4). Their
 * presence marks a process running on AWS; only the names are read (PR3-SEC-03 option (b), D-ORCH-007).
 */
export const ECS_METADATA_KEYS: readonly string[] = Object.freeze(['ECS_CONTAINER_METADATA_URI', 'ECS_CONTAINER_METADATA_URI_V4']);

/**
 * Node's process-wide switch for TLS certificate verification: `0` disables it for every client that leaves
 * `rejectUnauthorized` unset (PR9-SEC-04). Not a schema key; `loadConfig` reads it only to derive a value-free flag
 * for `tlsVerificationGuard`.
 */
export const TLS_REJECT_UNAUTHORIZED_KEY = 'NODE_TLS_REJECT_UNAUTHORIZED';
