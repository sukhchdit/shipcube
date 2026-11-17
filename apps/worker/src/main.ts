// Worker process entry point (ADR-0003, ADR-0013, US-012, NFR-AVAIL-002). The composition and start-up sequence live
// in start-worker.ts with the production process seams (D-ORCH-073, D-ARCH-136); this module only starts it. No
// top-level await, so a test can import it with start-worker mocked (main.test.ts).
import { raiseStartupError, startWorker } from './start-worker.js';

startWorker().catch(raiseStartupError);
