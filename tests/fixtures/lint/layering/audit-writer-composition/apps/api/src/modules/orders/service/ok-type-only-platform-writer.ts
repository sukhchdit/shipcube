// V9: types of the composition stay importable outside the allow-list.
import type { AuditWriterDeps } from '../../../platform/audit/writer.js';

export const deps: AuditWriterDeps = { lockTimeoutMs: 250 };
