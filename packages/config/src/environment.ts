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
