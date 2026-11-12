// Security-event sink over the runtime log (TASK-010; PR #11 code review R3-m1 (i), security review R3.6, D-ARCH-079).
// The runtime's database events (db_session_default_tampered, db_role_setting_drift, db_session_context_leak,
// rls_write_rejected, db_privilege_denied) go through this sink, not ad-hoc `log.warn` calls: one `security.<event>`
// line at the catalogue level (`securityEventLevel`) carrying exactly the attributes given (the database runtime
// passes `{ correlationId, sqlState }` and nothing else; never PostgreSQL text). The platform logger turns the line
// into a security event (`event_type: "security"`, snake_case keys, PII filter).
import { securityEventLevel, type SecurityEventAttrs, type SecurityEventSink } from '@platform/shared/logging';

import type { LogFields, RuntimeLog } from '../runtime/log.js';

/** Null attributes are dropped: the runtime log takes scalar values only. */
function scalarFields(attrs: SecurityEventAttrs): LogFields {
  const fields: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(attrs)) if (value !== null) fields[key] = value;
  return fields;
}

export function securityEventSinkFrom(log: Pick<RuntimeLog, 'warn' | 'error'>): SecurityEventSink {
  return {
    emit: (name, attrs = {}) => {
      const fields = scalarFields(attrs);
      if (securityEventLevel(name) === 'error') log.error(`security.${name}`, fields);
      else log.warn(`security.${name}`, fields);
    },
  };
}
