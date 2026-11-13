// Security-event sink over the runtime log (TASK-010; PR #11 R3-m1 (i), R3.6, D-ARCH-079): catalogue level, exactly
// the given attributes, and the platform logger's security line shape end to end.
import { describe, expect, it } from '@jest/globals';
import { RUNTIME_SECURITY_EVENTS, type RuntimeSecurityEventName } from '@platform/shared/logging';

import type { DbSecurityEvent } from '../db/map-db-error.js';
import type { SessionIntegrityFinding } from '../db/session-integrity.js';

import { createRuntimeLog } from '../runtime/log.js';
import { securityEventSinkFrom } from './security-events.js';

describe('securityEventSinkFrom', () => {
  it('[R3-m1] runtime database events are security lines carrying exactly { event, correlationId, sqlState }', () => {
    const raw: string[] = [];
    const sink = securityEventSinkFrom(createRuntimeLog('api', { write: (line: string) => raw.push(line) }));
    sink.emit('rls_write_rejected', { correlationId: 'req-12345678', sqlState: '42501' });
    sink.emit('db_session_context_leak', { correlationId: 'req-12345678' });
    sink.emit('db_role_setting_drift');
    const lines = raw.map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines.map((line) => [line['level'], line['event_type'], line['event'], line['correlation_id'], line['sql_state']])).toEqual([
      ['error', 'security', 'rls_write_rejected', 'req-12345678', '42501'],
      ['error', 'security', 'db_session_context_leak', 'req-12345678', undefined],
      ['error', 'security', 'db_role_setting_drift', null, undefined],
    ]);
    const standard = new Set([
      'timestamp',
      'level',
      'message',
      'service',
      'version',
      'correlation_id',
      'org_id',
      'actor_id',
      'event',
      'event_type',
    ]);
    for (const line of lines) expect(Object.keys(line).filter((key) => !standard.has(key) && key !== 'sql_state')).toEqual([]);
  });

  it('drops null attributes and routes by the catalogue level', () => {
    const calls: Array<[string, string, unknown]> = [];
    const sink = securityEventSinkFrom({
      warn: (event, fields) => calls.push(['warn', event, fields]),
      error: (event, fields) => calls.push(['error', event, fields]),
    });
    sink.emit('audit_write_failed', { route: '/api/v1/x', entity: null });
    sink.emit('login_failed', { reason: 'BAD_PASSWORD' });
    expect(calls).toEqual([
      ['error', 'security.audit_write_failed', { route: '/api/v1/x' }],
      ['warn', 'security.login_failed', { reason: 'BAD_PASSWORD' }],
    ]);
  });

  it('[PR #20 m3] every database runtime event is a runtime security event at error level, in the type and at run time', () => {
    // Compile-time exhaustiveness: a new SessionIntegrityFinding or DbSecurityEvent that is not listed in
    // RUNTIME_SECURITY_EVENTS fails the type check instead of silently defaulting to `warn`.
    type Unlisted = Exclude<SessionIntegrityFinding | DbSecurityEvent, RuntimeSecurityEventName>;
    const exhaustive: [Unlisted] extends [never] ? true : false = true;
    expect(exhaustive).toBe(true);
    const emitted: readonly (SessionIntegrityFinding | DbSecurityEvent)[] = [
      'db_session_default_tampered',
      'db_role_setting_drift',
      'db_session_context_leak',
      'rls_write_rejected',
      'db_privilege_denied',
    ];
    expect([...emitted].sort()).toEqual([...RUNTIME_SECURITY_EVENTS].sort());
    const levels: string[] = [];
    const sink = securityEventSinkFrom({
      warn: () => levels.push('warn'),
      error: () => levels.push('error'),
    });
    for (const event of emitted) sink.emit(event);
    expect(levels).toEqual(emitted.map(() => 'error'));
  });
});
