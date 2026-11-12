// Security log events (REQ-SEC-012, US-008, NFR-OBS-001; api/README.md §13 catalogue; SEC-TC-63, SEC-P3-30; TASK-010).
// SECURITY_EVENTS is the catalogue (SEC-TC-63 asserts it equals the README table in both directions). The sink writes
// each event through the platform logger as `security.<name>`, which gives the line `event_type: "security"`, drops PII
// keys and keeps scalar attributes only (logger.ts). Runtime database events of TASK-016 use the same sink.
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

/** Runtime database events (TASK-016); routed through the same sink but not part of the README catalogue. */
export const RUNTIME_SECURITY_EVENTS = ['db_session_context_leak'] as const;
export type RuntimeSecurityEventName = (typeof RUNTIME_SECURITY_EVENTS)[number];

export type SecurityEventLevel = Extract<LineLevel, 'error' | 'warn'>;

/** Level per event: integrity and live-key failures are errors, everything else a warning. */
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
  db_session_context_leak: 'error',
};

/** Emitted instead of an event whose name is not a valid event identifier. */
export const INVALID_SECURITY_EVENT = 'invalid_event_name';

const EVENT_NAME = /^[a-z][a-z0-9_]{0,63}$/;
const CATALOGUE: ReadonlySet<string> = new Set<string>(SECURITY_EVENTS);

export function isSecurityEventName(value: unknown): value is SecurityEventName {
  return typeof value === 'string' && CATALOGUE.has(value);
}

/** Level of a (valid) event name: its SECURITY_EVENT_LEVEL entry, `warn` for names outside the table. */
export function securityEventLevel(name: string): SecurityEventLevel {
  return Object.hasOwn(SECURITY_EVENT_LEVEL, name) ? SECURITY_EVENT_LEVEL[name as keyof typeof SECURITY_EVENT_LEVEL] : 'warn';
}

/** A sink writing security events through `logger` (line shape and PII filtering: logger.ts). */
export function createSecurityEventSink(logger: PlatformLogger): SecurityEventSink {
  return {
    emit(name: string, attrs?: SecurityEventAttrs): void {
      if (typeof name !== 'string' || !EVENT_NAME.test(name)) {
        logger.warn(`security.${INVALID_SECURITY_EVENT}`);
        return;
      }
      logger[securityEventLevel(name)](`security.${name}`, attrs);
    },
  };
}

/** Emits one catalogue event through `logger`. */
export function securityEvent(logger: PlatformLogger, name: SecurityEventName, attrs?: SecurityEventAttrs): void {
  createSecurityEventSink(logger).emit(name, attrs);
}
