// Health contract types (TASK-006 split contract). The definitions live in the process-agnostic runtime entry so
// the worker's node:http health server shares them (`@platform/api/runtime`).
export type {
  ReadinessBody,
  ReadinessCheck,
  ReadinessComponent,
  ReadinessOptions,
  ReadinessProbe,
  ReadinessReport,
} from '../runtime/readiness.js';

import type { ReadinessProbe } from '../runtime/readiness.js';

export interface HealthOptions {
  /** Checks plus drain state; build it with `createReadinessProbe(checks)`. */
  readonly probe: ReadinessProbe;
}
