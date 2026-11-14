/**
 * Per-table and per-route inputs of the RLS generator (TASK-024) that the catalogue cannot supply. Both maps start
 * empty: a new table is covered by the generic row synthesis, and a new tenant-resource route FAILS the suite until
 * it registers its API case here (AT-US-077-02/-03; there is no skip list).
 *
 * - `ROW_OVERRIDES`: column values the synthesis cannot derive (a CHECK other than a single-column enum list, a
 *   pattern, a domain), keyed by table then column. Never secrets or personal data: synthetic values only.
 * - `API_CASES`: the operationIds of tenant-resource routes whose cross-tenant 404 case is generated (TASK-027 and the
 *   module tasks add theirs with the route; TASK-211 extends the account routes).
 */
export const ROW_OVERRIDES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {};

export const API_CASES: ReadonlySet<string> = new Set<string>();
