/**
 * The validate slot (pipeline step 6): validates the request parts against the route's schemas, prepared once per
 * route with the value-free messages, and stores the converted input for the handler. `preparedSchemasOf` exposes the
 * schemas the slot actually validates with, so the route-metadata test can walk them (PR20-SEC-12).
 */
import type { NextFunction, Request, Response } from 'express';

import type { RouteDescriptor } from '../routing/define-route.js';
import { setInput } from '../routing/route-state.js';
import type { RouteSlot } from '../routing/slot.js';
import { type PreparedSchemas, prepareSchemas, validateRequest } from './validate.js';

const prepared = new WeakMap<RouteDescriptor, PreparedSchemas>();

export function preparedSchemasOf(route: RouteDescriptor): PreparedSchemas {
  let schemas = prepared.get(route);
  if (schemas === undefined) {
    schemas = prepareSchemas(route.schema);
    prepared.set(route, schemas);
  }
  return schemas;
}

export const validate: RouteSlot = (route) => {
  const schemas = preparedSchemasOf(route);
  return (req: Request, res: Response, next: NextFunction) => {
    const headers = req.headers as Readonly<Record<string, unknown>>;
    setInput(res, validateRequest(schemas, { params: req.params, query: req.query, body: req.body as unknown, headers }));
    next();
  };
};
