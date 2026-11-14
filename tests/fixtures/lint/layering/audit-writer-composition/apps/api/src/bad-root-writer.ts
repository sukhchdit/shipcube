// A file at the app root (V7).
import { auditWriterFromConfig } from './platform/audit/writer.js';

export const writer: unknown = auditWriterFromConfig({ lockTimeoutMs: 250 });
