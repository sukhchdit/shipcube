// Test seam (TASK-043; code review m5): an outbox over a test catalogue, for unit and lane B tests of the writer, the
// relay and the purge. Exported as `@platform/api/testing`; never imported by production code, which publishes
// through `outbox` (the closed platform catalogue) only.
export { createOutbox as createTestOutbox } from '../writer.js';
