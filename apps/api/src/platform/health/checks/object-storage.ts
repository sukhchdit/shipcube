/**
 * `object_storage` readiness check (US-012, REQ-PLAT-018): `HeadBucket` on the documents bucket through the
 * `ObjectStorage` port. The readiness runner's 2 s abort signal reaches the SDK request; a failure is reported as
 * `unavailable` without its cause (AT-US-012-05).
 */
import type { ReadinessCheck } from '../../runtime/readiness.js';
import type { ObjectStorage } from '../../storage/object-storage.port.js';

export function createObjectStorageCheck(storage: Pick<ObjectStorage, 'checkBucket'>, bucket: string): ReadinessCheck {
  return Object.freeze({
    name: 'object_storage' as const,
    critical: true,
    check: (signal: AbortSignal): Promise<void> => storage.checkBucket(bucket, signal),
  });
}
