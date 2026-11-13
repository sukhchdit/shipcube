/**
 * CORS preflight seam (REQ-SEC-004; contract stub of TASK-020, the allow-listed preflight answer is TASK-048).
 * createApp mounts it PATH-LESS before `routes`, so a preflight is answered before the OPTIONS responder and the
 * /api/docs mount (PR21-SEC-06, D-ORCH-024 (5)). Pass-through until TASK-048 replaces this folder.
 */
import type { NextFunction, Request, RequestHandler, Response } from 'express';

export function corsPreflight(): RequestHandler {
  return function corsPreflight(_req: Request, _res: Response, next: NextFunction): void {
    next();
  };
}
