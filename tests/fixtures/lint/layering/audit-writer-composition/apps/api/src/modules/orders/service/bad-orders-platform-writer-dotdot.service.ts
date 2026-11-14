// A `..` detour through the folder resolves to the same file.
import { auditWriterFromConfig } from '../../../platform/audit/../audit/writer.js';

export const writer: unknown = auditWriterFromConfig({ lockTimeoutMs: 250 });
