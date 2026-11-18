// Job processors by named queue (ADR-0013; TASK-035). A queue task registers its processor here (TASK-039 onwards);
// a queue without a processor gets no consumer in this worker, its jobs wait and its gauges are still exported.
import type { ProcessorRegistry } from './platform/queues/runtime.js';

export const PROCESSORS: ProcessorRegistry = {};
