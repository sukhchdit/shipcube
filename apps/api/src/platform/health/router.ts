/**
 * `GET /health/live` and `GET /health/ready` (US-012, REQ-PLAT-018; openapi.yaml `getLiveness`, `getReadiness`).
 * Mounted by `createApp` at the root, outside `/api/v1`, before authentication and without a rate limit. Public by
 * design and not audited (descriptor NONE, REQ-AUDIT-006): the handlers write no audit entry and the bodies hold
 * enum statuses only (AT-US-012-05). Responses are never cached, so a probe always sees the current state.
 * Other methods and paths fall through to the app's problem+json handlers (405/404, US-007).
 */
import { type Response, Router } from 'express';

import { LIVENESS_BODY } from '../runtime/readiness.js';
import type { HealthOptions } from './types.js';

export const HEALTH_LIVE_PATH = '/health/live';
export const HEALTH_READY_PATH = '/health/ready';

const send = (res: Response, status: number, body: object): void => {
  // AT-US-012-05: no framework fingerprint on the unauthenticated probes, whatever the app's settings.
  res.removeHeader('X-Powered-By');
  res.status(status).set('Cache-Control', 'no-store').json(body);
};

export function createHealthRouter(options: HealthOptions): Router {
  const router = Router();
  // Liveness has no dependency I/O: 200 while the event loop runs, also during a dependency outage (AT-US-012-02).
  router.get(HEALTH_LIVE_PATH, (_req, res) => {
    send(res, 200, LIVENESS_BODY);
  });
  router.get(HEALTH_READY_PATH, async (_req, res) => {
    const { httpStatus, body } = await options.probe.readiness();
    send(res, httpStatus, body);
  });
  return router;
}
