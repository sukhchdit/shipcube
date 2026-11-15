/**
 * Audit entry vocabularies (REQ-AUDIT-002/003/011, DR-A10/A11; data-model §1.7 and §3.4; US-087; TASK-025).
 *
 * Each list equals the EFFECTIVE CHECK constraint of `public.audit_entries` (or `audit_pii_vault`) that the bootstrap
 * lane leaves, value for value: the last definition across prisma/bootstrap/*.sql in file order (10-audit.sql creates
 * them; 91-audit-actions-v2.sql widens `ck_audit_entries__action`, TASK-285). `actions.test.ts` replays the files and
 * compares; catalog test C9 and prisma/tests/audit/audit-actions-v2.int.test.ts pin the database side. A value outside
 * a list is a type error at compile time and a CHECK violation (23514) in the database (AT-US-087-05), and the writer
 * refuses it before any statement runs.
 */
import type { AuditAction as DescriptorAction } from '@platform/shared';

/**
 * `ck_audit_entries__action` (data-model §1.7 `audit_action`, REQ-AUDIT-002): the 20 actions in REQ-AUDIT-002 order.
 * `MFA_RECOVERY_USED` (a recovery code consumed, REQ-AUTH-016/017; first emitter TASK-061) and `SESSION_REVOKED` (a
 * session ended other than by the user's own logout, REQ-AUTH-004; first emitter TASK-059) joined with TASK-285
 * (D-ARCH-119, AT-US-087-07).
 */
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
  'MFA_RECOVERY_USED',
  'SESSION_REVOKED',
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
