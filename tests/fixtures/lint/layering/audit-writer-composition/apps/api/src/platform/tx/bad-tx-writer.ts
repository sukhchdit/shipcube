// The tx slot may mount the capture hook, but not take the writer itself.
import { auditWriterFromConfig } from '../audit/writer.js';

export const writer: unknown = auditWriterFromConfig({ lockTimeoutMs: 250 });
