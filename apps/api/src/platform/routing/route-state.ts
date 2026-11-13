/**
 * Per-request state the pipeline slots share (TASK-020): the principal (authn), the validated input (validate) and the
 * route template. Kept in `res.locals` under fixed keys and read through guards, so a slot never trusts an earlier
 * slot blindly: a missing principal is anonymous, missing input is a pipeline bug (500, never a silent empty input).
 */
import { isRouteAuth } from '@platform/authz';
import type { Response } from 'express';

import type { Principal, RouteDescriptor, RouteInput } from './define-route.js';

const PRINCIPAL = 'routePrincipal';
const INPUT = 'routeInput';
const DESCRIPTOR = 'routeDescriptor';
/** Read by the access log and the metrics label (PR #20 n6): mount prefix plus the full template, never a raw path. */
export const ROUTE_TEMPLATE_LOCAL = 'routeTemplate';

/**
 * A frozen read-only view of `values` (PR32-SEC-15): it has no `add`/`delete`/`clear`, and the backing `Set` is not
 * reachable from it, so `Set.prototype.add.call(view, ...)` throws instead of changing a principal shared across
 * requests. The authenticators (TASK-052/055/091/171/261) build their principals' permissions with it.
 */
export function readonlySet<T>(values: Iterable<T>): ReadonlySet<T> {
  const backing = new Set(values);
  const view: ReadonlySet<T> = {
    get size() {
      return backing.size;
    },
    has: (value) => backing.has(value),
    forEach: (callback, thisArg?: unknown) => {
      for (const value of backing) callback.call(thisArg, value, value, view);
    },
    entries: () => backing.entries(),
    keys: () => backing.keys(),
    values: () => backing.values(),
    [Symbol.iterator]: () => backing.values(),
  };
  return Object.freeze(view);
}

/** No credential (D-ARCH-107 (4)): no actor, no organisation, no permission. Deep-frozen: shared by every request. */
export const ANONYMOUS: Principal = Object.freeze({
  credential: 'anonymous',
  authenticated: false,
  actorId: '',
  orgId: '',
  actorScope: 'TENANT',
  guestTokenHash: '',
  permissions: readonlySet<string>([]),
});

const locals = (res: Response): Record<string, unknown> => res.locals as Record<string, unknown>;

export function setRouteDescriptor(res: Response, route: RouteDescriptor, template: string): void {
  locals(res)[DESCRIPTOR] = route;
  locals(res)[ROUTE_TEMPLATE_LOCAL] = template;
}

export function setPrincipal(res: Response, principal: Principal): void {
  locals(res)[PRINCIPAL] = principal;
}

/**
 * The request's principal. Fails closed: a missing principal, or one whose `credential` is missing or not a known kind
 * (D-ARCH-107 (4)), is ANONYMOUS, so the authz credential gate refuses it on every route without `anonymous`.
 */
export function principalOf(res: Response): Principal {
  const value = locals(res)[PRINCIPAL];
  if (typeof value !== 'object' || value === null || !('permissions' in value)) return ANONYMOUS;
  return isRouteAuth((value as { credential?: unknown }).credential) ? (value as Principal) : ANONYMOUS;
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

/** SEC-TC-29 (T-06, ASVS 8.2.1): authenticated responses are never stored by the browser or a shared cache. */
export const PRIVATE_CACHE_CONTROL = 'private, no-store';
const PRIVATE_RESPONSE = 'routePrivateResponse';

/**
 * Marks the response as authenticated (D-ARCH-107 (5): the route's auth set has no `anonymous`, or the request
 * presented a credential) and sets `Cache-Control: private, no-store`. The mark, not the header text, is what the tx
 * slot re-asserts after the handler's headers and what the problem handler reads (PR #32 m1 (a)/(b)).
 */
export function markPrivateResponse(res: Response): void {
  locals(res)[PRIVATE_RESPONSE] = true;
  res.setHeader('Cache-Control', PRIVATE_CACHE_CONTROL);
}

export function isPrivateResponse(res: Response): boolean {
  return locals(res)[PRIVATE_RESPONSE] === true;
}

const CREDENTIALS_READ = 'routeCredentialsRead';

/**
 * Records that the authn slot read this request's credentials for its route (D-ARCH-109). From then on the private
 * mark alone decides SEC-TC-29: the slot marked the response if the route has no `anonymous` member or the request
 * presented a credential of a declared kind, and a foreign credential must not make an error private. Every
 * authenticator that replaces the stub (TASK-052/055/091/171/261) calls it before reading a header.
 */
export function markCredentialsRead(res: Response): void {
  locals(res)[CREDENTIALS_READ] = true;
}

/** False before the route is known (404/405 fallback, body parser) and before the authn slot ran. */
export function credentialsReadOf(res: Response): boolean {
  return locals(res)[CREDENTIALS_READ] === true;
}
