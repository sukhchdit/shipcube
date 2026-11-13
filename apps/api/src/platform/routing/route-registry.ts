/**
 * The in-process route registry (api/README §15 input 1, US-067; TASK-020). `mountRoutes` registers the final handler
 * of every route it mounts; the registry maps that handler back to its descriptor. Keyed weakly by the handler, so
 * each `createApp` (tests build many) has its own entries and nothing leaks. The route-metadata test walks the composed
 * app, reads the last handler of every Express route and asks `descriptorOf`: a route mounted with a raw
 * `router.get(...)` has no descriptor and fails the test.
 */
import type { RequestHandler } from 'express';

import type { RouteDescriptor } from './define-route.js';

const registry = new WeakMap<RequestHandler, RouteDescriptor>();

export function registerRouteHandler(handler: RequestHandler, route: RouteDescriptor): void {
  if (registry.has(handler)) throw new Error(`route handler of ${route.operationId} registered twice`);
  registry.set(handler, route);
}

/** The descriptor of a handler mounted by `mountRoutes`, or undefined for anything else. */
export function descriptorOf(handler: unknown): RouteDescriptor | undefined {
  return typeof handler === 'function' ? registry.get(handler as RequestHandler) : undefined;
}
