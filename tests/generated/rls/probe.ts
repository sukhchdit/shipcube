/**
 * The probe schema of the RLS generator (TASK-024). On `main` no tenant table exists yet (the first arrive with
 * TASK-037/049/051), so the generator is proven non-vacuous on probe tables of every RLS class and of the three
 * DR-A14 sets, created in a throw-away clone of the migrated template exactly as a migration would: as
 * `platform_migrator`, from the renderer (`renderRls`, `renderStdColumnsGuard`) and the function templates
 * (`app-is-operator.sql`, the guest-capable and standard-columns guards). A DR-A14 table that the committed schema
 * already holds is not planted (`PROBE_ENTRIES` drops it at load time); the committed layer covers it from then on.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import type pg from 'pg';

import {
  FUNCTION_TEMPLATE_DIR,
  renderGuestCapableGuardFunction,
  renderRls,
  renderStdColumnsGuard,
  renderStdColumnsGuardFunction,
} from '../../../tools/db/render-rls.js';
import { loadTableClasses, type TableClassEntry } from '../../../tools/db/table-classes.js';

const MODULE = 'rls-probe';
const COMMITTED = new Set(loadTableClasses().map((entry) => entry.name));

/** DR-A14 probes; dropped when the committed manifests list the real table (the committed layer then covers it). */
const DR_A14_PROBES: readonly TableClassEntry[] = [
  { module: MODULE, name: 'organisations', class: 'TENANT', policySet: 'dr-a14-organisations', definerRead: true },
  { module: MODULE, name: 'memberships', class: 'TENANT', policySet: 'dr-a14-memberships', definerRead: true },
  { module: MODULE, name: 'users', class: 'USER_OWNED', policySet: 'dr-a14-users', definerRead: true },
];

/** The probe tables under test, one per RLS class plus the DR-A14 sets (static: Jest enumerates cases at load). */
export const PROBE_ENTRIES: readonly TableClassEntry[] = [
  { module: MODULE, name: 'rls_probe_parcels', class: 'TENANT', stdColumns: true },
  { module: MODULE, name: 'rls_probe_quotes', class: 'GUEST_CAPABLE' },
  { module: MODULE, name: 'rls_probe_tokens', class: 'USER_OWNED' },
  ...DR_A14_PROBES.filter((entry) => !COMMITTED.has(entry.name)),
];

const PLANTS_DR_A14 = PROBE_ENTRIES.some((entry) => entry.policySet !== undefined);

const STD = `created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1`;

const DR_A14_DDL = `
CREATE TABLE public.organisations (id uuid PRIMARY KEY, type text NOT NULL,
  CONSTRAINT ck_organisations__type CHECK (type IN ('BUSINESS_CUSTOMER', 'INDIVIDUAL', 'OPERATOR', 'PARTNER')));
CREATE TABLE public.memberships (id uuid PRIMARY KEY, org_id uuid NOT NULL, user_id uuid NOT NULL, status text NOT NULL,
  CONSTRAINT ck_memberships__status CHECK (status IN ('ACTIVE', 'INVITED', 'REMOVED', 'SUSPENDED')));
CREATE INDEX ix_memberships__org_id ON public.memberships (org_id);
CREATE TABLE public.users (id uuid PRIMARY KEY, display_name text NOT NULL);
GRANT SELECT, INSERT, UPDATE ON public.organisations, public.memberships, public.users TO platform_app;`;

const PROBE_DDL = `
CREATE TABLE public.rls_probe_parcels (id uuid PRIMARY KEY, org_id uuid NOT NULL, ref text NOT NULL, ${STD});
CREATE INDEX ix_rls_probe_parcels__org_id ON public.rls_probe_parcels (org_id);
CREATE TABLE public.rls_probe_quotes (id uuid PRIMARY KEY, org_id uuid, guest_token_hash bytea, ref text NOT NULL);
CREATE INDEX ix_rls_probe_quotes__org_id ON public.rls_probe_quotes (org_id);
CREATE TABLE public.rls_probe_tokens (id uuid PRIMARY KEY, user_id uuid NOT NULL, note text NOT NULL);
GRANT SELECT, INSERT, UPDATE ON public.rls_probe_parcels, public.rls_probe_quotes, public.rls_probe_tokens TO platform_app;
GRANT DELETE ON public.rls_probe_tokens TO platform_app;`;

async function functionExists(client: pg.ClientBase, signature: string): Promise<boolean> {
  const { rows } = await client.query<{ oid: string | null }>('SELECT to_regprocedure($1)::text AS oid', [signature]);
  return rows[0]?.oid !== null && rows[0]?.oid !== undefined;
}

/**
 * Plants the probe schema on `migrator` (a `platform_migrator` session, autocommit: the clone is throw-away). The
 * order is a migration's: tables, `app_is_operator()` (its SQL body is validated against the tables), the guard
 * functions, then the rendered blocks (an operator policy needs `app_is_operator()` to exist).
 */
export async function plantProbeSchema(migrator: pg.ClientBase): Promise<void> {
  if (PLANTS_DR_A14) await migrator.query(DR_A14_DDL);
  await migrator.query(PROBE_DDL);
  if (!(await functionExists(migrator, 'platform.app_is_operator()'))) {
    await migrator.query(readFileSync(join(FUNCTION_TEMPLATE_DIR, 'app-is-operator.sql'), 'utf8'));
  }
  if (!(await functionExists(migrator, 'platform.guest_capable_guard()'))) await migrator.query(renderGuestCapableGuardFunction());
  if (!(await functionExists(migrator, 'platform.std_columns_guard()'))) await migrator.query(renderStdColumnsGuardFunction());
  for (const entry of PROBE_ENTRIES) {
    await migrator.query(renderRls(entry));
    if (entry.stdColumns === true) await migrator.query(renderStdColumnsGuard(entry));
  }
}
