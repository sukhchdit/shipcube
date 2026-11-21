// Job processors by named queue (ADR-0013; TASK-035). A queue task registers its processor here; a queue without a
// processor gets no consumer in this worker, its jobs wait and its gauges are still exported. The scheduled jobs of a
// schedule-only queue (housekeeping: queue-retention, TASK-039) are run by the worker queue runtime itself, which owns
// the Queue instances the sweep cleans (PR64-SEC-13); a processor registered here for such a queue is refused at start.
import type { ProcessorRegistry } from './platform/queues/runtime.js';

export const PROCESSORS: ProcessorRegistry = {};
