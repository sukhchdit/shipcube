import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { createLogger } from './logger.js';
import {
  createSecurityEventSink,
  INVALID_SECURITY_EVENT,
  isSecurityEventName,
  RUNTIME_SECURITY_EVENTS,
  SECURITY_EVENT_FIELDS,
  SECURITY_EVENT_LEVEL,
  SECURITY_EVENTS,
  securityEvent,
  securityEventLevel,
} from './security-event.js';
import type { PlatformLogger } from './types.js';

const README = ['docs', '03-architecture', 'api', 'README.md'];

/** The API conventions README, found from the Jest working directory (the repository root or below it). */
function readmePath(): string {
  let dir = resolve(process.cwd());
  for (;;) {
    const candidate = join(dir, ...README);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) throw new Error('docs/03-architecture/api/README.md not found above the working directory');
    dir = parent;
  }
}

const RUNTIME_HEADING = '### Runtime integrity events';

/**
 * The lines of README §13: `main` is the request-path catalogue (SEC-TC-63 parity), `runtime` the "Runtime integrity
 * events" subsection, which is not part of that parity (D-ARCH-081 (4)).
 */
function section13(): { readonly main: string[]; readonly runtime: string[] } {
  const lines = readFileSync(readmePath(), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('## 13.'));
  if (start < 0) throw new Error('README has no "## 13." section');
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => line.startsWith('## '));
  const section = end < 0 ? rest : rest.slice(0, end);
  const split = section.findIndex((line) => line.startsWith(RUNTIME_HEADING));
  if (split < 0) throw new Error(`README §13 has no "${RUNTIME_HEADING}" subsection`);
  return { main: section.slice(0, split), runtime: section.slice(split + 1) };
}

/** The first-column names of the main table under the `## 13.` heading. */
function catalogueFromReadme(): string[] {
  const names: string[] = [];
  for (const line of section13().main) {
    const match = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (match?.[1] !== undefined && match[1] !== 'event') names.push(match[1]);
  }
  return names;
}

/** Event name -> "Extra fields" cell of the README §13 main table. */
function extraFieldsFromReadme(): Map<string, string> {
  const cells = new Map<string, string>();
  for (const line of section13().main) {
    const columns = line.split('|').map((column) => column.trim());
    const match = /^`([^`]+)`$/.exec(columns[1] ?? '');
    if (match?.[1] !== undefined && columns[3] !== undefined) cells.set(match[1], columns[3]);
  }
  return cells;
}

interface RuntimeRow {
  readonly fields: string[];
  readonly level: string;
}

/** Event name -> allowed fields and level of the README §13 runtime-events table (Source | Event | Emitted when | Allowed fields | Level). */
function runtimeEventsFromReadme(): Map<string, RuntimeRow> {
  const rows = new Map<string, RuntimeRow>();
  for (const line of section13().runtime) {
    const columns = line.split('|').map((column) => column.trim());
    const match = /^`([a-z][a-z0-9_]*)`$/.exec(columns[2] ?? '');
    if (match?.[1] === undefined || columns[4] === undefined || columns[5] === undefined) continue;
    rows.set(match[1], { fields: columns[4].split(',').map((field) => field.trim()), level: columns[5] });
  }
  return rows;
}

function recordingLogger(): { readonly logger: PlatformLogger; readonly lines: () => Record<string, unknown>[] } {
  const raw: string[] = [];
  const logger = createLogger({ service: 'api', version: '1', destination: { write: (line: string) => raw.push(line) } });
  return { logger, lines: () => raw.map((line) => JSON.parse(line) as Record<string, unknown>) };
}

describe('security event catalogue', () => {
  it('[SEC-TC-63] the exported set equals the README §13 table event column in both directions', () => {
    const documented = catalogueFromReadme();
    const exported: readonly string[] = SECURITY_EVENTS;
    const missingFromCode = documented.filter((name) => !exported.includes(name));
    const missingFromReadme = exported.filter((name) => !documented.includes(name));
    expect({ missingFromCode, missingFromReadme }).toEqual({ missingFromCode: [], missingFromReadme: [] });
    expect(exported).toEqual(documented);
  });

  it('[SEC-TC-63] every allow-listed attribute of an event is named in its README §13 "Extra fields" cell', () => {
    const cells = extraFieldsFromReadme();
    for (const name of SECURITY_EVENTS) {
      const cell = (cells.get(name) ?? '').toLowerCase();
      for (const field of SECURITY_EVENT_FIELDS[name]) {
        const words = field.replaceAll('_', ' ');
        expect({ name, field, documented: cell.includes(field) || cell.includes(words) }).toEqual({ name, field, documented: true });
      }
    }
  });

  it('[D-ARCH-081 (4)] runtime events, their allow-lists and levels equal the README §13 runtime-events table, per event', () => {
    const documented = runtimeEventsFromReadme();
    // The same set in both directions (the runtime table is not ordered like the constant).
    expect([...documented.keys()].sort()).toEqual([...RUNTIME_SECURITY_EVENTS].sort());
    for (const name of RUNTIME_SECURITY_EVENTS) {
      expect({ name, fields: SECURITY_EVENT_FIELDS[name], level: SECURITY_EVENT_LEVEL[name] }).toEqual({
        name,
        fields: documented.get(name)?.fields,
        level: documented.get(name)?.level,
      });
    }
    // Pinned here as well, so a README edit alone cannot widen an allow-list.
    expect(SECURITY_EVENT_FIELDS.audit_mutation_rejected).toEqual(['sql_state']);
    expect(SECURITY_EVENT_FIELDS.audit_partition_squatted).toEqual(['partition_name', 'kind', 'reason', 'sql_state']);
    // TASK-041 (R1-m3): the rate-limit store event carries exactly these two attributes, at error level.
    expect(SECURITY_EVENT_FIELDS.rate_limit_store_unavailable).toEqual(['store', 'scope']);
    expect(SECURITY_EVENT_LEVEL.rate_limit_store_unavailable).toBe('error');
    for (const name of RUNTIME_SECURITY_EVENTS.filter(
      (event) => event !== 'audit_partition_squatted' && event !== 'rate_limit_store_unavailable',
    )) {
      expect({ name, fields: SECURITY_EVENT_FIELDS[name] }).toEqual({ name, fields: ['sql_state'] });
    }
  });

  it('has a level for every event, errors for integrity, live-key and runtime database failures', () => {
    for (const name of [...SECURITY_EVENTS, ...RUNTIME_SECURITY_EVENTS]) expect(SECURITY_EVENT_LEVEL[name]).toMatch(/^(warn|error)$/);
    const errors = Object.entries(SECURITY_EVENT_LEVEL)
      .filter(([, level]) => level === 'error')
      .map(([name]) => name)
      .sort();
    expect(errors).toEqual([
      'audit_anchor_missing',
      'audit_chain_broken',
      'audit_mutation_rejected',
      'audit_partition_squatted',
      'audit_write_failed',
      'db_privilege_denied',
      'db_role_setting_drift',
      'db_session_context_leak',
      'db_session_default_tampered',
      'live_key_forbidden',
      'rate_limit_store_unavailable',
      'rls_write_rejected',
    ]);
    expect(securityEventLevel('some_runtime_event')).toBe('warn');
    expect(securityEventLevel('toString')).toBe('warn');
  });

  it('recognises catalogue names only', () => {
    expect(isSecurityEventName('login_failed')).toBe(true);
    expect(isSecurityEventName('db_session_context_leak')).toBe(false);
    expect(isSecurityEventName(42)).toBe(false);
  });
});

describe('security event sink', () => {
  it('securityEvent(name, attrs) helper emits the catalogue name and never raw PII', () => {
    const { logger, lines } = recordingLogger();
    securityEvent(logger, 'registration_probe', {
      distinctAddressCount: 6,
      window: '1h',
      email: 'alice@example.com',
      ip: '203.0.113.7',
      name: 'Alice',
      note: 'seen alice@example.com with secret-token-123',
      ipCoarse: '203.0.113.0/24',
    });
    const [line] = lines();
    expect(line).toMatchObject({
      level: 'warn',
      event_type: 'security',
      event: 'registration_probe',
      message: 'security.registration_probe',
      distinct_address_count: 6,
      window: '1h',
      ip_coarse: '203.0.113.0/24',
      dropped_attributes: 4,
    });
    expect(line).not.toHaveProperty('note');
    const output = JSON.stringify(line);
    expect(output).not.toContain('alice@example.com');
    expect(output).not.toContain('203.0.113.7');
    expect(output).not.toContain('Alice');
    expect(output).not.toContain('secret-token-123');
  });

  it('emits error-level events at error and runtime events through the same sink', () => {
    const { logger, lines } = recordingLogger();
    const sink = createSecurityEventSink(logger);
    sink.emit('audit_chain_broken', { stream_id: 's-1' });
    sink.emit('db_session_context_leak');
    expect(lines().map((line) => [line['level'], line['event']])).toEqual([
      ['error', 'audit_chain_broken'],
      ['error', 'db_session_context_leak'],
    ]);
  });

  it.each(['Login_failed', 'with space', '', 'x'.repeat(65), 'dotted.name'])(
    'replaces the invalid name %p with invalid_event_name and no attributes',
    (name) => {
      const { logger, lines } = recordingLogger();
      createSecurityEventSink(logger).emit(name, { detail: 'x' });
      const [line] = lines();
      expect(line).toMatchObject({ level: 'warn', event: INVALID_SECURITY_EVENT, event_type: 'security' });
      expect(line).not.toHaveProperty('detail');
    },
  );
});
