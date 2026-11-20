// The deterministic Mock carrier (TASK-079). Re-exports only (D-ARCH-036). The Mock has no wire format, so its factory
// and its public constants are part of the package surface (see ../../index.ts); no subpath export is added.
export { mockCapabilities } from './capabilities.js';
export { MOCK_CARRIER_CODE, MOCK_CURRENCY, MOCK_SERVICE_CODES, type MockServiceCode } from './constants.js';
export { EGRESS as MOCK_EGRESS } from './egress.js';
export { MOCK_LABEL_MARKER, mockLabel } from './labels.js';
export { createMockAdapter, type MockAdapterOptions, type MockCallRecord, type MockCarrierAdapter } from './mock-adapter.js';
export { MAX_LATENCY_MS, parseLatencyMs } from './scenario.js';
