// V2: a namespace import.
import * as composition from '../../../platform/audit/writer.js';

export const writer: unknown = composition.auditWriterFromConfig({ lockTimeoutMs: 250 });
