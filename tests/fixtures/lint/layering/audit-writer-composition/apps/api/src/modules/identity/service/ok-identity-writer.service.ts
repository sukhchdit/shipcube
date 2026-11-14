// V8: the allow-listed identity module (auth events) builds its writer from the composition.
import { auditWriterFromConfig } from '../../../platform/audit/writer.js';

export const writer: unknown = auditWriterFromConfig({ lockTimeoutMs: 250 });
