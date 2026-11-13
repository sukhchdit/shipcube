/**
 * Pipeline step 7b, `If-Match` / ETag preconditions (REQ-API-012/013, DR-A16, api/README §6; contract stub of
 * TASK-020, optimistic concurrency is TASK-096). Pass-through until TASK-096 replaces this folder.
 */
import type { NextFunction, Request, Response } from 'express';

import type { RouteSlot } from '../routing/slot.js';

export const etag: RouteSlot = () => (_req: Request, _res: Response, next: NextFunction) => {
  next();
};
