// Public entry point of @platform/shared. Shared types, enums, constants, error catalogue, Money/units helpers, queue and event names (ADR-0003).
// Re-exports only (D-ARCH-036); exports are added by the tasks that implement this package.
export {
  AppError,
  isAppError,
  MAX_VALIDATION_ISSUES,
  type AppErrorJson,
  type AppErrorOptions,
  type ValidationIssue,
} from './errors/app-error.js';
export type { CatalogueEntry, ModuleCatalogue, ProblemStatus } from './errors/catalogue-entry.js';
// Generated from openapi.yaml (REQ-API-019, TASK-017): `npm run openapi:types`; the typed client (api/README.md §17) builds on these.
export type { components, operations, paths } from './api/types.gen.js';
export {
  CATALOGUE_MODULES,
  ERROR_CATALOGUE,
  isErrorCode,
  mergeCatalogues,
  type ErrorCatalogue,
  type ErrorCode,
} from './errors/catalogue/index.js';
export { ANONYMOUS_ACTOR_ID, isUuidV7, SYSTEM_ACTOR_ID, uuidv7, uuidV7Timestamp } from './ids/uuidv7.js';
export {
  isServerControlledField,
  SERVER_CONTROLLED_FIELDS,
  serverControlledFieldIssues,
  UNKNOWN_FIELD,
  type ServerControlledField,
} from './ids/server-controlled.js';
// Route audit descriptor = openapi `x-audit` (TASK-020); consumed by defineRoute, the audit writer and capture.
export {
  AUDIT_ACTIONS,
  AUDIT_SENSITIVITIES,
  type AdditionalAuditEntry,
  type AuditAction,
  type AuditDescriptor,
  type AuditSensitivity,
} from './audit/descriptor.js';
