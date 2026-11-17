// R3-n2 (D-TASK025-22): an allow-listed folder (platform/authz) re-exports the composed writer. Clean today: the folder
// is allow-listed, and the resolved-file policy judges each import on its direct target only, so a feature module
// importing this file is not reported either (the known residual pinned by tools/lint/audit-capture-boundary.test.ts).
export { auditWriterFromConfig } from '../audit/writer.js';
