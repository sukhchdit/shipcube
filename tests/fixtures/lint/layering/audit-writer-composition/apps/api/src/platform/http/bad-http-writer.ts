// A platform folder outside the audit-writer allow-list.
import { auditWriterFromConfig } from '../audit/writer.js';

export const writer: unknown = auditWriterFromConfig({ lockTimeoutMs: 250 });
