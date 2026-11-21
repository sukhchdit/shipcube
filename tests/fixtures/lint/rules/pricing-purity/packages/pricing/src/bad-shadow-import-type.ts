// PR080-SEC-02 (TASK-080): a type-only import alias binds Date for the scope manager, while TypeScript resolves the
// value Date below to the real clock.
import type { Money as Date } from '@platform/shared';

export const stamp = (): number => Date.now();
