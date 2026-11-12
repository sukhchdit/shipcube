// Entry point `@platform/config/testing`: runtime-generated environments for tests of the API and worker.
// Re-exports only (D-ARCH-036). Never import from production code.
export { createTestEnv, keyValueFor, p256PrivateKeyValue, p256PublicKeyValue, randomKeyValue } from './test-env.js';
export type { TestEnvOptions } from './test-env.js';
