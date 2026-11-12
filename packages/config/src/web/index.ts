// Entry point `@platform/config/web`: build-time configuration for apps/web and apps/admin (ADR-0018 §1).
// Re-exports only (D-ARCH-036); free of Node-only modules so frontend tooling can import it.
export { ConfigValidationError, formatConfigError } from '../errors.js';
export type { ConfigIssue, ConfigIssueCode } from '../errors.js';
export { loadWebBuildConfig, webBuildDefine } from './load-web-config.js';
export { BRAND_VALUE_SCHEMAS, LOCALES, WEB_CONFIG_KEYS, webConfigSchema } from './web-schema.js';
export type { Locale, WebBuildConfig } from './web-schema.js';
