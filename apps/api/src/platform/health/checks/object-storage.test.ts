import { describe, expect, it, jest } from '@jest/globals';

import { evaluateReadiness } from '../../runtime/readiness.js';
import { ObjectStorageError } from '../../storage/object-storage.port.js';
import { createObjectStorageCheck } from './object-storage.js';

describe('object_storage readiness check (US-012)', () => {
  it('is a frozen critical check named object_storage', () => {
    const check = createObjectStorageCheck({ checkBucket: () => Promise.resolve() }, 'documents');
    expect(check).toMatchObject({ name: 'object_storage', critical: true });
    expect(Object.isFrozen(check)).toBe(true);
  });

  it('probes the configured bucket with the runner signal', async () => {
    const checkBucket = jest.fn<(bucket: string, signal: AbortSignal) => Promise<void>>().mockResolvedValue(undefined);
    const signal = new AbortController().signal;
    await createObjectStorageCheck({ checkBucket }, 'documents').check(signal);
    expect(checkBucket).toHaveBeenCalledWith('documents', signal);
  });

  it('a rejection makes the component unavailable and the body carries no cause', async () => {
    const failing = createObjectStorageCheck({ checkBucket: () => Promise.reject(new ObjectStorageError('UNAVAILABLE')) }, 'documents');
    const stub = (name: 'database' | 'redis' | 'audit_partitions' | 'audit_chain') => ({
      name,
      critical: name === 'database' || name === 'redis',
      check: () => Promise.resolve(),
    });
    const report = await evaluateReadiness([stub('database'), stub('redis'), failing, stub('audit_partitions'), stub('audit_chain')]);
    expect(report.httpStatus).toBe(503);
    expect(report.body.components.object_storage).toBe('unavailable');
    expect(JSON.stringify(report.body)).not.toMatch(/documents|UNAVAILABLE/u);
  });
  it('reports the failure class to onFailure and still rejects; a non-port error is UNEXPECTED; success reports nothing', async () => {
    const codes: string[] = [];
    const onFailure = (code: string): void => {
      codes.push(code);
    };
    const signal = new AbortController().signal;
    const denied = new ObjectStorageError('ACCESS_DENIED');
    await expect(
      createObjectStorageCheck({ checkBucket: () => Promise.reject(denied) }, 'documents', onFailure).check(signal),
    ).rejects.toBe(denied);
    await expect(
      createObjectStorageCheck({ checkBucket: () => Promise.reject(new Error('documents at 10.0.0.1')) }, 'documents', onFailure).check(
        signal,
      ),
    ).rejects.toThrow();
    await createObjectStorageCheck({ checkBucket: () => Promise.resolve() }, 'documents', onFailure).check(signal);
    expect(codes).toEqual(['ACCESS_DENIED', 'UNEXPECTED']);
  });
});
