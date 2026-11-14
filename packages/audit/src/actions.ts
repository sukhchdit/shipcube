/**
 * Audit entry vocabularies (REQ-AUDIT-002/003/011, DR-A10/A11; data-model §1.7 and §3.4; US-087; TASK-025).
 *
 * Each list equals the CHECK constraint of `public.audit_entries` (or `audit_pii_vault`) that prisma/bootstrap/10-audit.sql
 * creates, value for value: `actions.test.ts` parses the bootstrap file and compares, and catalog test C9 pins the
 * database side. A value outside a list is a type error at compile time and a CHECK violation (23514) in the database
 * (AT-US-087-05), and the writer refuses it before any statement runs.
 *
 * `MFA_RECOVERY_USED` and `SESSION_REVOKED` (US-087 notes, ADR-0008) are NOT here: the database CHECK lacks them
 * (data-model OI-07), and widening it is audit DDL in the bootstrap lane (data-model §8.3 rule 12). Until that lands,
 * a value the database would reject must not type-check.
 */
import type { AuditAction as DescriptorAction } from '@platform/shared';

/** `ck_audit_entries__action` (data-model §1.7 `audit_action`, REQ-AUDIT-002). */
export const AUDIT_ENTRY_ACTIONS = [
  'CREATE',
  'UPDATE',
  'DELETE',
  'VIEW',
  'DOWNLOAD',
  'LOGIN',
  'LOGOUT',
  'LOGIN_FAILED',
  'ACCOUNT_LOCKED',
  'TOKEN_REUSE_DETECTED',
  'MFA_ENROLLED',
  'MFA_FAILED',
  'PERMISSION_DENIED',
  'EXPORT',
  'ON_BEHALF_ACTION',
  'CONFIG_CHANGE',
  'API_KEY_USE',
  'STATE_TRANSITION',
] as const;
export type AuditEntryAction = (typeof AUDIT_ENTRY_ACTIONS)[number];

/** `ck_audit_entries__actor_type` (REQ-AUDIT-011). */
export const AUDIT_ACTOR_TYPES = ['USER', 'API_KEY', 'SYSTEM_JOB', 'ANONYMOUS'] as const;
export type AuditActorType = (typeof AUDIT_ACTOR_TYPES)[number];

/** `ck_audit_entries__outcome` (REQ-AUDIT-010, DR-A10). */
export const AUDIT_OUTCOMES = ['SUCCESS', 'DENIED', 'FAILED'] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

/** `ck_audit_entries__source_app` (from `X-Client-App` or the process, ADR-0007 §Capture). */
export const AUDIT_SOURCE_APPS = ['web', 'admin', 'api', 'worker'] as const;
export type AuditSourceApp = (typeof AUDIT_SOURCE_APPS)[number];

/** `ck_audit_pii_vault__classification`: the classes whose values are tokenised into the vault (ADR-0007 §Privacy erasure). */
export const PII_CLASSIFICATIONS = ['PERSONAL', 'SENSITIVE_PERSONAL'] as const;
export type PiiClassification = (typeof PII_CLASSIFICATIONS)[number];

/**
 * Actions whose outcome is fixed by their meaning: a denial is recorded as DENIED (US-087 AT-06, US-088 AT-06,
 * REQ-AUDIT-010). Every other action may carry any outcome.
 */
export const DENIED_ONLY_ACTIONS: ReadonlySet<AuditEntryAction> = new Set<AuditEntryAction>(['LOGIN_FAILED', 'PERMISSION_DENIED']);

const ACTION_SET: ReadonlySet<string> = new Set(AUDIT_ENTRY_ACTIONS);
const ACTOR_TYPE_SET: ReadonlySet<string> = new Set(AUDIT_ACTOR_TYPES);
const OUTCOME_SET: ReadonlySet<string> = new Set(AUDIT_OUTCOMES);
const SOURCE_APP_SET: ReadonlySet<string> = new Set(AUDIT_SOURCE_APPS);
const CLASSIFICATION_SET: ReadonlySet<string> = new Set(PII_CLASSIFICATIONS);

export const isAuditEntryAction = (value: unknown): value is AuditEntryAction => typeof value === 'string' && ACTION_SET.has(value);
export const isAuditActorType = (value: unknown): value is AuditActorType => typeof value === 'string' && ACTOR_TYPE_SET.has(value);
export const isAuditOutcome = (value: unknown): value is AuditOutcome => typeof value === 'string' && OUTCOME_SET.has(value);
export const isAuditSourceApp = (value: unknown): value is AuditSourceApp => typeof value === 'string' && SOURCE_APP_SET.has(value);
export const isPiiClassification = (value: unknown): value is PiiClassification =>
  typeof value === 'string' && CLASSIFICATION_SET.has(value);

/**
 * Every action a route descriptor (`x-audit.action`, packages/shared) can declare is an entry action, so the capture
 * middleware (TASK-029) can pass the descriptor's action to the writer unchanged. A descriptor value the database
 * would reject is a compile error here.
 */
type DescriptorActionIsEntryAction = Exclude<DescriptorAction, 'NONE'> extends AuditEntryAction ? true : never;
export const DESCRIPTOR_ACTIONS_ARE_ENTRY_ACTIONS: DescriptorActionIsEntryAction = true;
