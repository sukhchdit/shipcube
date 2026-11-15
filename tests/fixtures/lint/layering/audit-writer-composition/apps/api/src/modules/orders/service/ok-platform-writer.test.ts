// Tests may import the composition (they build writers over fakes).
import { auditWriterFromConfig } from '../../../platform/audit/writer.js';

export const writer: unknown = auditWriterFromConfig({ lockTimeoutMs: 250 });
