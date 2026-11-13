// The contract every pipeline slot implements (TASK-020): given the route's descriptor at mount time, the Express
// handler that runs this step for that route. Later tasks replace one slot folder each (authn TASK-052, the staff
// MFA gate of REQ-AUTH-018, authz TASK-060, rate-limit TASK-041, idempotency TASK-040, etag TASK-096, audit TASK-029)
// without touching the pipeline or the other slots.
import type { RequestHandler } from 'express';

import type { RouteDescriptor } from './define-route.js';

export type RouteSlot = (route: RouteDescriptor) => RequestHandler;
