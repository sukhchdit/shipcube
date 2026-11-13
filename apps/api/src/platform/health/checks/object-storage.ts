/**
 * `object_storage` readiness check (US-012, REQ-PLAT-018): `HeadBucket` on the documents bucket through the
 * `ObjectStorage` port. The readiness runner's 2 s abort signal reaches the SDK request; a failure is reported as
 * `unavailable` without its cause (AT-US-012-05). `onFailure` receives the error class only (an `ObjectStorageError`
 * code, never the endpoint, bucket, key or a credential) so the composition root can log why (PR #30 R1-m5).
 */
import type { ReadinessCheck } from '../../runtime/readiness.js';
import { ObjectStorageError, type ObjectStorage, type ObjectStorageErrorCode } from '../../storage/object-storage.port.js';

export function createObjectStorageCheck(
  storage: Pick<ObjectStorage, 'checkBucket'>,
  bucket: string,
  onFailure?: (code: ObjectStorageErrorCode) => void,
): ReadinessCheck {
  return Object.freeze({
    name: 'object_storage' as const,
    critical: true,
    check: async (signal: AbortSignal): Promise<void> => {
      try {
        await storage.checkBucket(bucket, signal);
      } catch (error) {
        onFailure?.(error instanceof ObjectStorageError ? error.code : 'UNEXPECTED');
        throw error;
      }
    },
  });
}
