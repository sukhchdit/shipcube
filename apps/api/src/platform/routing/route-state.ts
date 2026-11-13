/**
 * Per-request state the pipeline slots share (TASK-020): the principal (authn), the validated input (validate) and the
 * route template. Kept in `res.locals` under fixed keys and read through guards, so a slot never trusts an earlier
 * slot blindly: a missing principal is anonymous, missing input is a pipeline bug (500, never a silent empty input).
 */
import type { Response } from 'express';

import type { Principal, RouteDescriptor, RouteInput } from './define-route.js';

const PRINCIPAL = 'routePrincipal';
const INPUT = 'routeInput';
const DESCRIPTOR = 'routeDescriptor';
/** Read by the access log and the metrics label (PR #20 n6): mount prefix plus the full template, never a raw path. */
export const ROUTE_TEMPLATE_LOCAL = 'routeTemplate';

export const ANONYMOUS: Principal = Object.freeze({
  authenticated: false,
  actorId: '',
  orgId: '',
  actorScope: 'TENANT',
  guestTokenHash: '',
  permissions: new Set<string>(),
});

const locals = (res: Response): Record<string, unknown> => res.locals as Record<string, unknown>;

export function setRouteDescriptor(res: Response, route: RouteDescriptor, template: string): void {
  locals(res)[DESCRIPTOR] = route;
  locals(res)[ROUTE_TEMPLATE_LOCAL] = template;
}

export function setPrincipal(res: Response, principal: Principal): void {
  locals(res)[PRINCIPAL] = principal;
}

export function principalOf(res: Response): Principal {
  const value = locals(res)[PRINCIPAL];
  return typeof value === 'object' && value !== null && 'permissions' in value ? (value as Principal) : ANONYMOUS;
}

export function setInput(res: Response, input: RouteInput): void {
  locals(res)[INPUT] = input;
}

export class PipelineStateError extends Error {
  constructor(what: string) {
    super(`route pipeline: ${what} is missing (a slot was skipped)`);
    this.name = 'PipelineStateError';
  }
}

export function inputOf(res: Response): RouteInput {
  const value = locals(res)[INPUT];
  if (typeof value !== 'object' || value === null) throw new PipelineStateError('validated input');
  return value as RouteInput;
}

/** The route template recorded for this response (`/api/v1/shipments/:shipmentId`), if a route or OPTIONS matched. */
export function routeTemplateOf(res: Response): string | undefined {
  const value = locals(res)[ROUTE_TEMPLATE_LOCAL];
  return typeof value === 'string' ? value : undefined;
}

export function setRouteTemplate(res: Response, template: string): void {
  locals(res)[ROUTE_TEMPLATE_LOCAL] = template;
}
