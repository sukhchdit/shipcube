/**
 * Per-table and per-route inputs of the RLS generator (TASK-024) that the catalogue cannot supply. Both maps start
 * empty: a new table is covered by the generic row synthesis, and a new tenant-resource route FAILS the suite until
 * it registers its executable API case here (AT-US-077-02/-03; there is no skip list).
 *
 * - `ROW_OVERRIDES`: column values the synthesis cannot derive (a CHECK other than a single-column enum list, a
 *   pattern, a domain), keyed by table then column. Never secrets or personal data: synthetic values only.
 * - `API_CASES`: operationId -> `ApiCrossTenantCase` for every `tenant`/`user`/`guest` route with a path parameter
 *   (TASK-027 and the module tasks add theirs with the route; TASK-051 the quote routes; TASK-211 the account routes).
 *   `cross-tenant.int.test.ts` executes every entry against the real module registry (B's id -> 404 `NOT_FOUND`
 *   without B data, A's id -> the positive status; per credential kind the route accepts). An entry is a request
 *   description, never a bare operationId: registering a route always runs its case (PR43-SEC-01, R1-M2).
 */
import type { ApiCrossTenantCase } from './generator.js';

export const ROW_OVERRIDES: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {
  // D-ARCH-151: the one OPERATOR organisation is the reserved row of the migration and occupies
  // ux_organisations__single_operator, so no fixture plants another (the first enum value of ck_organisations__type
  // would be OPERATOR). BUSINESS_CUSTOMER also satisfies ck_organisations__personal_owner without an owner.
  organisations: { type: 'BUSINESS_CUSTOMER' },
};

export const API_CASES: ReadonlyMap<string, ApiCrossTenantCase> = new Map<string, ApiCrossTenantCase>();
