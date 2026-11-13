/**
 * Pipeline step 9, audit capture (REQ-AUDIT-001/006, ADR-0007; contract stub of TASK-020, the capture middleware is
 * TASK-029 on the TASK-025 writer). The tx slot calls the hook inside the request's tenant transaction, after the
 * handler and before COMMIT, so a failed audit write rolls the business change back (REQ-AUDIT-004). The stub writes
 * nothing, so it accepts only routes whose audit action is `NONE` and refuses any other route when it is mounted
 * (PR32-SEC-03, condition C3): an audited route cannot be served before TASK-029 (O4, 100 % audit completeness).
 */
import type { RouteContext, RouteDescriptor, RouteResult } from '../routing/define-route.js';
import { SlotNotImplementedError } from '../routing/slot.js';

export type AuditHook = (ctx: RouteContext, result: RouteResult) => Promise<void>;

const writesNothing: AuditHook = () => Promise.resolve();

/** The audit hook of one route, chosen at mount time; throws `SlotNotImplementedError` for an audited route. */
export function captureAudit(route: RouteDescriptor): AuditHook {
  if (route.audit.action !== 'NONE')
    throw new SlotNotImplementedError('audit', route.operationId, `audit action ${route.audit.action}`, 'TASK-029');
  return writesNothing;
}
