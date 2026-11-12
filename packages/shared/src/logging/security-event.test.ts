import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { createLogger } from './logger.js';
import {
  createSecurityEventSink,
  INVALID_SECURITY_EVENT,
  isSecurityEventName,
  RUNTIME_SECURITY_EVENTS,
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

/** The first-column names of the table under the `## 13.` heading. */
function catalogueFromReadme(): string[] {
  const lines = readFileSync(readmePath(), 'utf8').split(/\r?\n/);
  const start = lines.findIndex((line) => line.startsWith('## 13.'));
  if (start < 0) throw new Error('README has no "## 13." section');
  const names: string[] = [];
  for (const line of lines.slice(start + 1)) {
    if (line.startsWith('## ')) break;
    const match = /^\|\s*`([^`]+)`\s*\|/.exec(line);
    if (match?.[1] !== undefined && match[1] !== 'event') names.push(match[1]);
  }
  return names;
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

  it('has a level for every event, errors for integrity and live-key failures', () => {
    for (const name of [...SECURITY_EVENTS, ...RUNTIME_SECURITY_EVENTS]) expect(SECURITY_EVENT_LEVEL[name]).toMatch(/^(warn|error)$/);
    const errors = Object.entries(SECURITY_EVENT_LEVEL)
      .filter(([, level]) => level === 'error')
      .map(([name]) => name)
      .sort();
    expect(errors).toEqual([
      'audit_anchor_missing',
      'audit_chain_broken',
      'audit_write_failed',
      'db_session_context_leak',
      'live_key_forbidden',
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
      note: 'seen a***@example.com with [REDACTED]',
      ip_coarse: '203.0.113.0/24',
    });
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
