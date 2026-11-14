// API process entry point (ADR-0003, US-012, NFR-AVAIL-002). The composition and start-up sequence live in
// start-api.ts with the production process seams (D-ORCH-073); this module only starts it. No top-level await, so a
// test can import it with start-api mocked (main.test.ts).
import { raiseStartupError, startApi } from './start-api.js';

startApi().catch(raiseStartupError);
