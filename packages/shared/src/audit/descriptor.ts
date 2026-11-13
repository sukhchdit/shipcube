/**
 * The audit descriptor every route declares (REQ-AUDIT-006, NFR-AUDIT-004, ADR-0003 "Route metadata"; TASK-020): the
 * shape of openapi.yaml `x-audit`, which the route-metadata test deep-compares with the route. Declarations only: the
 * closed value lists below are the literal unions the contract uses today; the audit writer (TASK-025) and the
 * capture middleware (TASK-029) consume the descriptor, nothing here acts on it.
 */

/** `x-audit.action` values of the contract; `NONE` means the route writes no audit entry and needs a justification. */
export const AUDIT_ACTIONS = [
  'NONE',
  'CREATE',
  'UPDATE',
  'DELETE',
  'VIEW',
  'DOWNLOAD',
  'LOGIN',
  'LOGOUT',
  'MFA_ENROLLED',
  'STATE_TRANSITION',
  'CONFIG_CHANGE',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

/** `x-audit.sensitivity`: `NONE` only together with action `NONE`. */
export const AUDIT_SENSITIVITIES = ['NONE', 'NORMAL', 'SENSITIVE'] as const;
export type AuditSensitivity = (typeof AUDIT_SENSITIVITIES)[number];

/** A second entry the same request writes under a condition (`x-audit.additional[]`, e.g. a quote share update). */
export interface AdditionalAuditEntry {
  readonly action: Exclude<AuditAction, 'NONE'>;
  readonly entity: string;
  readonly sensitivity: Exclude<AuditSensitivity, 'NONE'>;
  /** English condition, copied from the contract (`when`). */
  readonly when: string;
}

interface AuditedDescriptor {
  readonly action: Exclude<AuditAction, 'NONE'>;
  /** Audited entity name (`shipment`, `user`, ...); `null` only for routes without a single entity (login). */
  readonly entity: string | null;
  readonly sensitivity: Exclude<AuditSensitivity, 'NONE'>;
  readonly reasonRequired: boolean;
  readonly justification?: string;
  readonly additional?: readonly AdditionalAuditEntry[];
}

interface UnauditedDescriptor {
  readonly action: 'NONE';
  readonly entity: null;
  readonly sensitivity: 'NONE';
  readonly reasonRequired: false;
  /** Why the route writes no entry (REQ-AUDIT-006: health, static reference reads, ...). */
  readonly justification: string;
  readonly additional?: undefined;
}

/** `x-audit` of one operation. A `NONE` descriptor carries a justification by type. */
export type AuditDescriptor = AuditedDescriptor | UnauditedDescriptor;
