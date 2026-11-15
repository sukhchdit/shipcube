// The tx slot mounts the capture hook: the one value import from platform/audit outside the allow-list.
import { captureAudit } from '../audit/capture.js';

export const hook: unknown = captureAudit();
