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
// Credential presence (D-ARCH-107 (5), D-ARCH-109; TASK-020): the declared-kind and the generic test, shared by the
// API and the SEC-TC-29 contract helper.
export {
  CREDENTIAL_HEADER_NAMES,
  PRESENTABLE_KINDS,
  presentedKinds,
  presentsCredential,
  REFRESH_COOKIE_NAMES,
  type CredentialHeaderName,
  type CredentialHeaders,
  type PresentableKind,
} from './http/credentials.js';
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
export { ANONYMOUS_ACTOR_ID, isUuidV7, OPERATOR_ORG_ID, SYSTEM_ACTOR_ID, uuidv7, uuidV7Timestamp } from './ids/uuidv7.js';
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
// Field classification registry (REQ-AUDIT-009, NFR-PRIV-003; TASK-028): the audit redaction, the prisma/schema
// completeness check and catalog C10 read it.
export {
  CLASSIFICATION_REGISTRY,
  CLASSIFICATION_TAGS,
  classificationOf,
  FIELD_CLASSIFICATIONS,
  isFieldClassification,
  registeredColumns,
  staleClassifications,
  unclassifiedColumns,
  type ClassificationRegistry,
  type FieldClassification,
  type SchemaColumn,
} from './classification/registry.js';
// Integer minor-unit money (ADR-0009 §3, REQ-PRICE-002, DR-B11; TASK-076): the only arithmetic on minor units.
export { CURRENCY_EXPONENTS, assertCurrencyCode, currencyExponent, isCurrencyCode } from './money/currency.js';
export { MONEY_ERROR_CODES, MoneyError, isMoneyError, type MoneyErrorCode } from './money/errors.js';
export {
  BPS_PER_UNIT,
  add,
  allocate,
  assertSameCurrency,
  compare,
  convert,
  equals,
  fromMajor,
  isMoney,
  isNegative,
  isZero,
  minor,
  money,
  mulRatio,
  negate,
  percentage,
  sub,
  sum,
  toMajorString,
  zero,
  type Minor,
  type Money,
} from './money/money.js';
export {
  MAX_DECIMAL_EXPONENT,
  MAX_DECIMAL_LENGTH,
  ceilRatio,
  compareRatio,
  decimalRatio,
  divideRatio,
  multiplyRatio,
  parseDecimal,
  ratio,
  roundHalfAwayFromZero,
  type Ratio,
} from './money/ratio.js';
// Carrier canonical vocabularies that leave the carrier layer (ADR-0010 am. 12 item 2, D-ARCH-168; TASK-080);
// packages/carriers re-exports them from canonical/codes.ts.
export {
  CARRIER_ERROR_CODES,
  DOCUMENT_FORMATS,
  SURCHARGE_CODES,
  TRACKING_STATUSES,
  isCarrierErrorCode,
  isDocumentFormat,
  isSurchargeCode,
  isTrackingStatus,
  type CarrierErrorCode,
  type DocumentFormat,
  type SurchargeCode,
  type TrackingStatus,
} from './vocabularies/carrier.js';
// Units and billable weight (ADR-0009 §4, DR-B05/B06, REQ-PRICE-004; TASK-076): shared by the API and the quote widget.
export {
  GRAMS_PER_POUND,
  MILLIMETRES_PER_INCH,
  SYSTEM_UNITS,
  UNIT_SYSTEMS,
  displayLength,
  displayWeight,
  normalisePackage,
  toGrams,
  toMillimetres,
  type CanonicalPackage,
  type LengthUnit,
  type PackageEntry,
  type UnitSystem,
  type WeightUnit,
} from './units/units.js';
export {
  DEFAULT_BILLABLE_WEIGHT_RULES,
  billableWeight,
  billableWeightRule,
  type BillableWeight,
  type BillableWeightRule,
  type CarrierServiceWeightTerms,
  type PackageWeights,
} from './units/billable-weight.js';
