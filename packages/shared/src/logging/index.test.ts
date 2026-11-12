import { describe, expect, it } from '@jest/globals';

import * as logging from './index.js';

describe('@platform/shared/logging', () => {
  it('exports the logging API', () => {
    expect(logging.LOG_LEVELS).toEqual(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']);
    for (const name of [
      'createLogger',
      'redactValue',
      'redactString',
      'maskEmails',
      'isSensitiveKey',
      'serializeThrown',
      'outboundCallFields',
      'createSecurityEventSink',
      'securityEvent',
      'isSecurityEventName',
    ] as const) {
      expect(typeof logging[name]).toBe('function');
    }
    expect(logging.REDACTED).toBe('[REDACTED]');
    expect(logging.OMITTED).toBe('[OMITTED]');
    expect(logging.SECURITY_EVENTS).toHaveLength(22);
  });
});
