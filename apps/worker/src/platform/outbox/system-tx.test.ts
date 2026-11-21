import { describe, expect, it } from '@jest/globals';
import { SYSTEM_ACTOR_ID } from '@platform/shared';

import { errorClassOf, systemContext } from './system-tx.js';

describe('outbox SYSTEM transactions (TASK-043)', () => {
  it('systemContext: the reserved SYSTEM actor, no organisation, TENANT scope and the given correlation id', () => {
    expect(systemContext('outbox-relay-1')).toEqual({
      orgId: '',
      actorId: SYSTEM_ACTOR_ID,
      actorScope: 'TENANT',
      guestTokenHash: '',
      correlationId: 'outbox-relay-1',
    });
  });

  it('errorClassOf: the class name of an Error, the typeof of anything else, never a message', () => {
    class JobProducerError extends Error {
      override name = 'JobProducerError';
    }
    expect(errorClassOf(new JobProducerError('carries value p@example.com'))).toBe('JobProducerError');
    expect(errorClassOf(new TypeError('x'))).toBe('TypeError');
    expect(errorClassOf('a thrown string with a value')).toBe('string');
    expect(errorClassOf(undefined)).toBe('undefined');
    expect(errorClassOf({ message: 'not an Error' })).toBe('object');
  });
});
