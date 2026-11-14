// V1: a named import of the composed writer (PR #42 R2-M1 probe p7).
import { auditWriterFromConfig } from '../../../platform/audit/writer.js';

export const writer: unknown = auditWriterFromConfig({ lockTimeoutMs: 250 });
