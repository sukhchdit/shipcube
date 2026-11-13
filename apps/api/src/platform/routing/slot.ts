// The contract every pipeline slot implements (TASK-020): given the route's descriptor at mount time, the Express
// handler that runs this step for that route. Later tasks replace one slot folder each (authn TASK-052, the staff
// MFA gate of REQ-AUTH-018, authz TASK-060, rate-limit TASK-041, idempotency TASK-040, etag TASK-096, audit TASK-029)
// without touching the pipeline or the other slots.
import type { RequestHandler } from 'express';

import type { RouteDescriptor } from './define-route.js';

export type RouteSlot = (route: RouteDescriptor) => RequestHandler;

/**
 * A contract stub refuses, at mount time, a route whose metadata it cannot honour (PR32-SEC-03, condition C3), naming
 * the task that replaces it: a module route cannot ship unaudited or without its idempotency or rate-limit guarantee
 * just because it merged before the slot's owner. The guard goes away when that task replaces the slot folder.
 */
export class SlotNotImplementedError extends Error {
  constructor(
    readonly slot: string,
    readonly operationId: string,
    readonly requirement: string,
    readonly owner: string,
  ) {
    super(`${slot} slot stub cannot honour ${requirement} on ${operationId}; ${owner} replaces it (PR32-SEC-03)`);
    this.name = 'SlotNotImplementedError';
  }
}
