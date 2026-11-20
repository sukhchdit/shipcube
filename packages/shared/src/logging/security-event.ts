// Security log events (REQ-SEC-012, US-008, NFR-OBS-001; api/README.md §13 catalogue; SEC-TC-63, SEC-P3-30; TASK-010).
// SECURITY_EVENTS is the catalogue (SEC-TC-63 asserts it equals the README table in both directions). The sink writes
// each event through the platform logger as `security.<name>` with branded fields, which gives the line
// `event_type: "security"`, the per-event attribute allow-list and scalar snake_case attributes (logger.ts). Runtime
// database events of TASK-016 use the same sink.
import { markSecurityEvent } from './security-mark.js';
import type { LineLevel, PlatformLogger, SecurityEventAttrs, SecurityEventSink } from './types.js';

/** The `event` column of api/README.md §13, in table order. */
export const SECURITY_EVENTS = [
  'login_failed',
  'account_locked',
  'mfa_failed',
  'mfa_locked',
  'refresh_token_reuse',
  'permission_denied',
  'csrf_rejected',
  'ssrf_blocked',
  'rate_limit_auth',
  'cross_tenant_probe',
  'webhook_signature_invalid',
  'audit_write_failed',
  'audit_chain_broken',
  'live_key_forbidden',
  'registration_probe',
  'carrier_anon_budget_exhausted',
  'carrier_quota_pressure',
  'carrier_quota_org_share_exhausted',
  'job_context_mismatch',
  'webhook_livemode_rejected',
  'audit_anchor_missing',
  'cvc_recollection_failed',
] as const;
export type SecurityEventName = (typeof SECURITY_EVENTS)[number];

/**
 * Runtime database events (TASK-016: session integrity, `with-tenant-tx` mapping; TASK-021: audit immutability and
 * partition squats, D-ARCH-081 (4)); routed through the same sink but
 * not part of the README catalogue (api-designer change request, D-TASK010-01). apps/api asserts at type level that
 * every event its database runtime emits is listed here (PR #20 m3).
 */
export const RUNTIME_SECURITY_EVENTS = [
  'db_session_default_tampered',
  'db_role_setting_drift',
  'db_session_context_leak',
  'rls_write_rejected',
  'db_privilege_denied',
  'audit_mutation_rejected',
  'audit_partition_squatted',
  // TASK-041 (D-SECT39-01 item 5): the rate-limit / denial-budget store (Valkey) is unavailable and the instance fell back
  // to its per-instance counters. In the README §13 runtime table (api-designer to acknowledge).
  'rate_limit_store_unavailable',
] as const;
export type RuntimeSecurityEventName = (typeof RUNTIME_SECURITY_EVENTS)[number];

export type SecurityEventLevel = Extract<LineLevel, 'error' | 'warn'>;

/**
 * Level per event: integrity, live-key and runtime database failures are errors, everything else a warning. The level
 * is for alerting only: security lines are written whatever APP_LOG_LEVEL says (PR20-SEC-04, logger.ts).
 */
export const SECURITY_EVENT_LEVEL: Readonly<Record<SecurityEventName | RuntimeSecurityEventName, SecurityEventLevel>> = {
  login_failed: 'warn',
  account_locked: 'warn',
  mfa_failed: 'warn',
  mfa_locked: 'warn',
  refresh_token_reuse: 'warn',
  permission_denied: 'warn',
  csrf_rejected: 'warn',
  ssrf_blocked: 'warn',
  rate_limit_auth: 'warn',
  cross_tenant_probe: 'warn',
  webhook_signature_invalid: 'warn',
  audit_write_failed: 'error',
  audit_chain_broken: 'error',
  live_key_forbidden: 'error',
  registration_probe: 'warn',
  carrier_anon_budget_exhausted: 'warn',
  carrier_quota_pressure: 'warn',
  carrier_quota_org_share_exhausted: 'warn',
  job_context_mismatch: 'warn',
  webhook_livemode_rejected: 'warn',
  audit_anchor_missing: 'error',
  cvc_recollection_failed: 'warn',
  db_session_default_tampered: 'error',
  db_role_setting_drift: 'error',
  db_session_context_leak: 'error',
  rls_write_rejected: 'error',
  db_privilege_denied: 'error',
  audit_mutation_rejected: 'error',
  audit_partition_squatted: 'error',
  rate_limit_store_unavailable: 'error',
};

/**
 * Attributes each event may carry, in the snake_case form written to the line: the "Extra fields" column of
 * api/README.md §13 (SEC-TC-63 checks every key against that column) plus the runtime-events table of §13 for the
 * runtime events (`sql_state`; the partition squat also carries `partition_name`, `kind` and `reason`). An
 * ALLOW-list (PR #20 m2, PR20-SEC-05): any other attribute is dropped and counted in `dropped_attributes`, so a raw
 * identifier, IP or name can never ride along under an unlisted key. `correlationId` is lifted into the standard
 * `correlation_id` key for every event. The coarse IP of the §13 header is not an attribute yet (first authn /
 * rate-limit emitter, PR #20 n8).
 */
export const SECURITY_EVENT_FIELDS: Readonly<Record<SecurityEventName | RuntimeSecurityEventName, readonly string[]>> = {
  login_failed: ['reason', 'identifier_hash'],
  account_locked: ['identifier_hash', 'lock_until'],
  mfa_failed: ['method'],
  mfa_locked: ['lock_until'],
  refresh_token_reuse: ['family_id', 'session_id'],
  permission_denied: ['route_template', 'required_permission'],
  csrf_rejected: ['route', 'origin'],
  ssrf_blocked: ['host', 'reason'],
  rate_limit_auth: ['class', 'key_type'],
  cross_tenant_probe: ['count'],
  webhook_signature_invalid: ['provider'],
  audit_write_failed: ['route', 'entity'],
  audit_chain_broken: ['stream_id', 'first_broken_entry_id'],
  live_key_forbidden: ['key_name'],
  registration_probe: ['distinct_address_count', 'window'],
  carrier_anon_budget_exhausted: ['carrier_code', 'account_id', 'budget'],
  carrier_quota_pressure: ['carrier_code', 'account_id', 'threshold', 'used', 'quota'],
  carrier_quota_org_share_exhausted: ['carrier_code', 'account_id', 'share_pct', 'used'],
  job_context_mismatch: ['queue', 'job_name', 'job_id', 'reason'],
  webhook_livemode_rejected: ['provider', 'gateway_event_id'],
  audit_anchor_missing: ['verification_id', 'anchor_seq_from', 'anchor_seq_to', 'failure_kind'],
  cvc_recollection_failed: ['payment_id', 'order_id', 'gateway', 'cvc_check'],
  db_session_default_tampered: ['sql_state'],
  db_role_setting_drift: ['sql_state'],
  db_session_context_leak: ['sql_state'],
  rls_write_rejected: ['sql_state'],
  db_privilege_denied: ['sql_state'],
  audit_mutation_rejected: ['sql_state'],
  audit_partition_squatted: ['partition_name', 'kind', 'reason', 'sql_state'],
  rate_limit_store_unavailable: ['store', 'scope'],
};

/** Emitted instead of an event whose name is not a valid event identifier. */
export const INVALID_SECURITY_EVENT = 'invalid_event_name';

/** A valid security-event identifier (also the shape the logger accepts after the `security.` prefix). */
export const SECURITY_EVENT_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const CATALOGUE: ReadonlySet<string> = new Set<string>(SECURITY_EVENTS);
const NO_FIELDS: readonly string[] = [];

export function isSecurityEventName(value: unknown): value is SecurityEventName {
  return typeof value === 'string' && CATALOGUE.has(value);
}

/** Level of a (valid) event name: its SECURITY_EVENT_LEVEL entry, `warn` for names outside the table. */
export function securityEventLevel(name: string): SecurityEventLevel {
  return Object.hasOwn(SECURITY_EVENT_LEVEL, name) ? SECURITY_EVENT_LEVEL[name as keyof typeof SECURITY_EVENT_LEVEL] : 'warn';
}

/** The snake_case attribute keys `name` may carry; none for names outside SECURITY_EVENT_FIELDS. */
export function securityEventFields(name: string): readonly string[] {
  return Object.hasOwn(SECURITY_EVENT_FIELDS, name) ? SECURITY_EVENT_FIELDS[name as keyof typeof SECURITY_EVENT_FIELDS] : NO_FIELDS;
}

/** Scalar, non-null attributes copied into a fresh, branded object (never the caller's object). */
function sinkFields(attrs: SecurityEventAttrs | undefined): Record<string, string | number | boolean> {
  const fields: Record<string, string | number | boolean> = {};
  if (attrs !== undefined && attrs !== null) {
    try {
      for (const [key, value] of Object.entries(attrs)) {
        if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') fields[key] = value;
      }
    } catch {
      // A hostile attribute object (throwing Proxy trap): the event is still written, without attributes.
    }
  }
  return markSecurityEvent(fields);
}

/** The levels a sink writes at; satisfied by PlatformLogger and by the api's RuntimeLog. */
export type SecurityEventLogger = Pick<PlatformLogger, 'warn' | 'error'>;

/**
 * A sink writing security events through `logger`. Only lines written by a sink are security events: the sink brands
 * its fields (security-mark.ts), and the logger then sets `event_type: "security"`, applies the per-event attribute
 * allow-list and writes the line whatever APP_LOG_LEVEL says (logger.ts).
 */
export function createSecurityEventSink(logger: SecurityEventLogger): SecurityEventSink {
  return {
    emit(name: string, attrs?: SecurityEventAttrs): void {
      if (typeof name !== 'string' || !SECURITY_EVENT_NAME.test(name)) {
        logger.warn(`security.${INVALID_SECURITY_EVENT}`, sinkFields(undefined));
        return;
      }
      logger[securityEventLevel(name)](`security.${name}`, sinkFields(attrs));
    },
  };
}

/** Emits one catalogue event through `logger`. */
export function securityEvent(logger: SecurityEventLogger, name: SecurityEventName, attrs?: SecurityEventAttrs): void {
  createSecurityEventSink(logger).emit(name, attrs);
}
