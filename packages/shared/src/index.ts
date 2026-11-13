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
export { CORRELATION_ID_PATTERN, isCorrelationId } from './correlation/correlation-id.js';
export type { CatalogueEntry, ModuleCatalogue, ProblemStatus } from './errors/catalogue-entry.js';
export {
  CATALOGUE_MODULES,
  ERROR_CATALOGUE,
  isErrorCode,
  mergeCatalogues,
  type ErrorCatalogue,
  type ErrorCode,
} from './errors/catalogue/index.js';
