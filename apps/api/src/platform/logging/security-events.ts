// Security-event sink over the runtime log (TASK-010; PR #11 code review R3-m1 (i), security review R3.6, D-ARCH-079).
// The runtime's database events (RUNTIME_SECURITY_EVENTS: db_session_default_tampered, db_role_setting_drift,
// db_session_context_leak, rls_write_rejected, db_privilege_denied) go through this sink, not ad-hoc `log.warn` calls:
// one `security.<event>` line at the catalogue level carrying exactly the attributes given (the database runtime
// passes `{ correlationId, sqlState }` and nothing else; never PostgreSQL text). It IS the shared sink
// (`createSecurityEventSink`, PR #20 n5): the same name validation, null dropping and field brand, so the platform
// logger writes the line as a security event (`event_type: "security"`, per-event attribute allow-list, written
// whatever APP_LOG_LEVEL says).
import { createSecurityEventSink, type SecurityEventSink } from '@platform/shared/logging';

import type { RuntimeLog } from '../runtime/log.js';

export function securityEventSinkFrom(log: Pick<RuntimeLog, 'warn' | 'error'>): SecurityEventSink {
  return createSecurityEventSink(log);
}
