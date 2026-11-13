/**
 * Pipeline step 9, audit capture (REQ-AUDIT-001/006, ADR-0007; contract stub of TASK-020, the capture middleware is
 * TASK-029 on the TASK-025 writer). The tx slot calls the hook inside the request's tenant transaction, after the
 * handler and before COMMIT, so a failed audit write rolls the business change back (REQ-AUDIT-004). The stub writes
 * nothing: no audited route is mounted yet (health is `NONE`).
 */
import type { RouteContext, RouteResult } from '../routing/define-route.js';

export type AuditHook = (ctx: RouteContext, result: RouteResult) => Promise<void>;

export const captureAudit: AuditHook = () => Promise.resolve();
