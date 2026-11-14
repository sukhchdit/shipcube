// V6: `./` and `platform/./audit` spellings resolve to the same file.
import { auditWriterFromConfig } from './../../../platform/./audit/writer.js';

export const writer: unknown = auditWriterFromConfig({ lockTimeoutMs: 250 });
