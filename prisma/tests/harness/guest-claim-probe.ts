/**
 * The GUEST_CAPABLE probe schema of the guest-binding cases (TASK-051; US-080, REQ-RLS-013; rulings/wave-1-r-arch-34-
 * operator-rulings.md §2.3, §2.7, §2.8; data-model §3.10 and §4.7 as amended 2026-11-19; D-ARCH-162, D-ARCH-163).
 *
 * The real quote tables are TASK-087/TASK-237. These four probe tables carry the prefix `gc_` (never the real names)
 * and the shape the ruling proved: both owner columns nullable with the owner CHECK, the owner-bound pair of keys to
 * `gc_quotes` and no single-column key, one unique index per owner column, the T2-O re-quote key with its CHECK, and
 * the RLS block of `renderRls({ class: 'GUEST_CAPABLE', … })` (tenant, operator and guest policies plus the de-claim
 * trigger over the migrated `platform.guest_capable_guard()`). They are planted in a throw-away clone of the migrated
 * template as `platform_migrator`, the way tests/generated/rls/probe.ts plants its probes. Imported by
 * prisma/tests/rls/guest-claim.int.test.ts and by the SEC-TC-07 race of tests/generated/rls (both may import the
 * harness; D-TASK051-05).
 *
 * Key creation order is significant: PostgreSQL fires the referential triggers in name order. Their names are
 * `RI_ConstraintTrigger_<a|c>_<oid>`, so name order is the text order of the OIDs, which equals creation order while
 * the OIDs have the same number of digits (true within one plant). The `gc_quote_packages` keys are therefore created
 * before those of `gc_quote_options` and `gc_quote_shares`, and a refused claim names the packages key first, as in the
 * ruling's probe (C2; C3 and C6 can fail on one key only).
 */
import { randomBytes, randomUUID } from 'node:crypto';

import type pg from 'pg';

import { CONTEXT_STATEMENT_SQL } from '../../../apps/api/src/platform/db/with-tenant-tx.js';
import { renderRls } from '../../../tools/db/render-rls.js';
import type { TableClassEntry } from '../../../tools/db/table-classes.js';
import { APP_ROLE } from './postgres.js';

export const GC_QUOTES = 'gc_quotes';
/** The children of `gc_quotes`, in claim order (the CTE names of rulings §2.3 are p, o and s). */
export const GC_CHILDREN = ['gc_quote_packages', 'gc_quote_options', 'gc_quote_shares'] as const;
export type GcChild = (typeof GC_CHILDREN)[number];
export const GC_TABLES = [GC_QUOTES, ...GC_CHILDREN] as const;
export type GcTable = (typeof GC_TABLES)[number];

/** Manifest-shaped entries of the probe tables (never added to tools/db/table-classes). */
export const GC_ENTRIES: readonly TableClassEntry[] = GC_TABLES.map((name): TableClassEntry => ({
  module: 'guest-claim-probe',
  name,
  class: 'GUEST_CAPABLE',
}));

const STD = `created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NOT NULL, updated_by uuid NOT NULL, version integer NOT NULL DEFAULT 1`;
const OWNERS = 'org_id uuid, guest_token_hash bytea';
const ownerCheck = (table: string): string => `CONSTRAINT ck_${table}__owner CHECK (num_nonnulls(org_id, guest_token_hash) = 1)`;

/** The owner-bound pair of rule T2-G (rulings §2.3): one key through each owner column, no single-column key. */
const ownerBoundPair = (child: GcChild): string[] => [
  `ALTER TABLE public.${child} ADD CONSTRAINT fk_${child}__org_id_quote_id
     FOREIGN KEY (org_id, quote_id) REFERENCES public.gc_quotes (org_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
  `ALTER TABLE public.${child} ADD CONSTRAINT fk_${child}__guest_token_hash_quote_id
     FOREIGN KEY (guest_token_hash, quote_id) REFERENCES public.gc_quotes (guest_token_hash, id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
];

/** The DDL of the probe tables, keys and indexes (data-model §3.10 as amended, renamed by the prefix), in order. */
export const GC_DDL: readonly string[] = [
  `CREATE TABLE public.gc_quotes (id uuid PRIMARY KEY, ${OWNERS},
     claimed_by_user_id uuid, claimed_at timestamptz, claimed_from_token_hash bytea, requote_of_quote_id uuid, ${STD},
     ${ownerCheck('gc_quotes')},
     CONSTRAINT ck_gc_quotes__requote_org_only CHECK (requote_of_quote_id IS NULL OR org_id IS NOT NULL))`,
  'CREATE UNIQUE INDEX ux_gc_quotes__org_id_id ON public.gc_quotes (org_id, id)',
  'CREATE UNIQUE INDEX ux_gc_quotes__guest_token_hash_id ON public.gc_quotes (guest_token_hash, id)',
  'CREATE INDEX ix_gc_quotes__org_created ON public.gc_quotes (org_id, created_at DESC, id DESC) WHERE org_id IS NOT NULL',
  // T2-O (rulings §2.3, §2.8): only organisation rows hold a re-quote reference, through org_id alone.
  `ALTER TABLE public.gc_quotes ADD CONSTRAINT fk_gc_quotes__requote_of_quote_id
     FOREIGN KEY (org_id, requote_of_quote_id) REFERENCES public.gc_quotes (org_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT`,
  `CREATE TABLE public.gc_quote_packages (id uuid PRIMARY KEY, ${OWNERS}, quote_id uuid NOT NULL, seq smallint NOT NULL, ${STD},
     ${ownerCheck('gc_quote_packages')}, CONSTRAINT ck_gc_quote_packages__seq CHECK (seq BETWEEN 1 AND 20))`,
  'CREATE UNIQUE INDEX ux_gc_quote_packages__org_quote_seq ON public.gc_quote_packages (org_id, quote_id, seq) WHERE org_id IS NOT NULL',
  'CREATE UNIQUE INDEX ux_gc_quote_packages__guest_quote_seq ON public.gc_quote_packages (guest_token_hash, quote_id, seq)',
  ...ownerBoundPair('gc_quote_packages'),
  `CREATE TABLE public.gc_quote_options (id uuid PRIMARY KEY, ${OWNERS}, quote_id uuid NOT NULL, gross_minor bigint NOT NULL, ${STD},
     ${ownerCheck('gc_quote_options')}, CONSTRAINT ck_gc_quote_options__gross CHECK (gross_minor >= 0))`,
  'CREATE INDEX ix_gc_quote_options__quote ON public.gc_quote_options (quote_id, gross_minor, id)',
  'CREATE INDEX ix_gc_quote_options__org_quote ON public.gc_quote_options (org_id, quote_id) WHERE org_id IS NOT NULL',
  ...ownerBoundPair('gc_quote_options'),
  `CREATE TABLE public.gc_quote_shares (id uuid PRIMARY KEY, ${OWNERS}, quote_id uuid NOT NULL,
     share_token_hash bytea NOT NULL, revoked_at timestamptz, ${STD}, ${ownerCheck('gc_quote_shares')})`,
  // A global digest no writer chooses: the C16 (b) exception shape (ux_quote_shares__share_token_hash).
  'CREATE UNIQUE INDEX ux_gc_quote_shares__share_token_hash ON public.gc_quote_shares (share_token_hash)',
  'CREATE UNIQUE INDEX ux_gc_quote_shares__org_quote_active ON public.gc_quote_shares (org_id, quote_id) WHERE revoked_at IS NULL',
  'CREATE UNIQUE INDEX ux_gc_quote_shares__guest_quote_active ON public.gc_quote_shares (guest_token_hash, quote_id) WHERE revoked_at IS NULL',
  ...ownerBoundPair('gc_quote_shares'),
];

async function guardFunctionExists(client: pg.ClientBase): Promise<boolean> {
  const { rows } = await client.query<{ oid: string | null }>("SELECT to_regprocedure('platform.guest_capable_guard()')::text AS oid");
  return typeof rows[0]?.oid === 'string';
}

/**
 * Plants the probe schema on `migrator` (a `platform_migrator` session on a throw-away clone, autocommit). The guard
 * function is NOT created here: it must come from migration 20261120200000_guest_capable_guard, so a clone without it
 * fails loudly instead of being repaired by the probe.
 */
export async function plantGuestClaimProbe(migrator: pg.ClientBase): Promise<void> {
  if (!(await guardFunctionExists(migrator))) throw new Error('platform.guest_capable_guard() is missing from the migrated template');
  for (const ddl of GC_DDL) await migrator.query(ddl);
  for (const entry of GC_ENTRIES) {
    await migrator.query(renderRls(entry));
    await migrator.query(`GRANT SELECT, INSERT, UPDATE ON public.${entry.name} TO ${APP_ROLE}`);
  }
}

// ---------------------------------------------------------------------------------------------------------------------
// Statements (every parameter has one type; each is a single command)
// ---------------------------------------------------------------------------------------------------------------------

/** $1 id, $2 org_id, $3 guest_token_hash, $4 actor. */
export const INSERT_QUOTE_SQL = `INSERT INTO public.gc_quotes (id, org_id, guest_token_hash, created_by, updated_by)
  VALUES ($1::uuid, $2::uuid, $3::bytea, $4::uuid, $4::uuid)`;
/** $1 id, $2 org_id, $3 guest_token_hash, $4 requote_of_quote_id, $5 actor. */
export const INSERT_REQUOTE_SQL = `INSERT INTO public.gc_quotes (id, org_id, guest_token_hash, requote_of_quote_id, created_by, updated_by)
  VALUES ($1::uuid, $2::uuid, $3::bytea, $4::uuid, $5::uuid, $5::uuid)`;
/** $1 id, $2 org_id, $3 guest_token_hash, $4 quote_id, $5 seq, $6 actor. */
export const INSERT_PACKAGE_SQL = `INSERT INTO public.gc_quote_packages (id, org_id, guest_token_hash, quote_id, seq, created_by, updated_by)
  VALUES ($1::uuid, $2::uuid, $3::bytea, $4::uuid, $5::smallint, $6::uuid, $6::uuid)`;
/** $1 id, $2 org_id, $3 guest_token_hash, $4 quote_id, $5 gross_minor, $6 actor. */
export const INSERT_OPTION_SQL = `INSERT INTO public.gc_quote_options (id, org_id, guest_token_hash, quote_id, gross_minor, created_by, updated_by)
  VALUES ($1::uuid, $2::uuid, $3::bytea, $4::uuid, $5::bigint, $6::uuid, $6::uuid)`;
/** $1 id, $2 org_id, $3 guest_token_hash, $4 quote_id, $5 share_token_hash, $6 actor. */
export const INSERT_SHARE_SQL = `INSERT INTO public.gc_quote_shares (id, org_id, guest_token_hash, quote_id, share_token_hash, created_by, updated_by)
  VALUES ($1::uuid, $2::uuid, $3::bytea, $4::uuid, $5::bytea, $6::uuid, $6::uuid)`;

const CTE_NAMES: Readonly<Record<GcChild, string>> = { gc_quote_packages: 'p', gc_quote_options: 'o', gc_quote_shares: 's' };

/** The claim update of one child ($1 org, $2 user, $3 quote), as a CTE body or a statement of its own. */
export const childClaimSql = (child: GcChild): string =>
  `UPDATE public.${child} SET org_id = $1::uuid, guest_token_hash = NULL, updated_at = now(), updated_by = $2::uuid, version = version + 1
    WHERE quote_id = $3::uuid AND org_id IS NULL`;

const QUOTE_CLAIM = `UPDATE public.gc_quotes
   SET org_id = $1::uuid, claimed_by_user_id = $2::uuid, claimed_at = now(),
       claimed_from_token_hash = guest_token_hash, guest_token_hash = NULL,
       updated_at = now(), updated_by = $2::uuid, version = version + 1
 WHERE id = $3::uuid AND org_id IS NULL`;

/**
 * The claim of rulings §2.3 as ONE statement over `children` ($1 org, $2 user, $3 quote): the child updates are
 * data-modifying CTEs of the UPDATE of the quote, so the referential checks of the owner-bound pair run once, at the
 * end of the statement. The affected-row count is that of the outer UPDATE (expectAffected(result, 1)).
 */
export function claimSql(children: readonly GcChild[] = GC_CHILDREN, returning = ''): string {
  const ctes = children.map((child) => `${CTE_NAMES[child]} AS (${childClaimSql(child)})`);
  return `${ctes.length > 0 ? `WITH ${ctes.join(',\n     ')}\n` : ''}${QUOTE_CLAIM}${returning === '' ? '' : `\n RETURNING ${returning}`}`;
}

/** The claim statement of rulings §2.3 over all three children. */
export const CLAIM_SQL = claimSql();

// ---------------------------------------------------------------------------------------------------------------------
// Identities, seed rows and the runtime context
// ---------------------------------------------------------------------------------------------------------------------

/** The actor `platform.std_columns_guard()` expects for guest sessions (data-model §7.6); the seed rows' creator. */
export const ANONYMOUS_ACTOR = '00000000-0000-7000-8000-000000000002';

/** A guest token hash (32 bytes, as `platform.app_guest_token_hash()` decodes it) and its context form. */
export interface GuestHash {
  readonly bytes: Buffer;
  /** Lowercase hex, the form the context statement binds (withTenantTx `guestTokenHash`). */
  readonly hex: string;
}

export function newGuestHash(): GuestHash {
  const bytes = randomBytes(32);
  return { bytes, hex: bytes.toString('hex') };
}

/** The owner of a row: an organisation or a guest token hash (exactly one, as the owner CHECK demands). */
export type Owner = { readonly org: string } | { readonly guest: GuestHash };

const ownerValues = (owner: Owner): [string | null, Buffer | null] => ('org' in owner ? [owner.org, null] : [null, owner.guest.bytes]);

/** One quote and one row in each child table, all with the same owner. */
export interface SeededQuote {
  readonly quote: string;
  readonly package: string;
  readonly option: string;
  readonly share: string;
}

/**
 * Inserts a quote with package `seq` 1, one option and one active share for `owner` on `client` (the superuser:
 * row security does not apply; the guard is a BEFORE UPDATE trigger, so inserts are unaffected).
 */
export async function seedQuote(client: pg.ClientBase, owner: Owner, withChildren = true): Promise<SeededQuote> {
  const [org, guest] = ownerValues(owner);
  const ids: SeededQuote = { quote: randomUUID(), package: randomUUID(), option: randomUUID(), share: randomUUID() };
  await client.query(INSERT_QUOTE_SQL, [ids.quote, org, guest, ANONYMOUS_ACTOR]);
  if (withChildren) {
    await client.query(INSERT_PACKAGE_SQL, [ids.package, org, guest, ids.quote, 1, ANONYMOUS_ACTOR]);
    await client.query(INSERT_OPTION_SQL, [ids.option, org, guest, ids.quote, 1000, ANONYMOUS_ACTOR]);
    await client.query(INSERT_SHARE_SQL, [ids.share, org, guest, ids.quote, randomBytes(32), ANONYMOUS_ACTOR]);
  }
  return ids;
}

/** A runtime context as the four security values of the production context statement. */
export interface ProbeContext {
  readonly org: string;
  readonly actor: string;
  readonly scope?: 'TENANT' | 'OPERATOR';
  /** Hex guest token hash, or '' (the empty binding of every route that is not a guest route or the claim). */
  readonly guestHash: string;
}

export const orgContext = (org: string, actor: string): ProbeContext => ({ org, actor, guestHash: '' });
export const guestContext = (guest: GuestHash): ProbeContext => ({ org: '', actor: '', guestHash: guest.hex });
export const claimContext = (org: string, actor: string, guest: GuestHash): ProbeContext => ({ org, actor, guestHash: guest.hex });

/**
 * Switches `client` (inside a transaction) to `platform_app` and binds `ctx` with the production statement of
 * withTenantTx (CONTEXT_STATEMENT_SQL; transaction-local). `lockTimeoutMs` defaults to the runtime's 2 s.
 */
export async function asApp(client: pg.ClientBase, ctx: ProbeContext, lockTimeoutMs = 2000): Promise<void> {
  await client.query(`SET LOCAL ROLE ${APP_ROLE}`);
  await client.query(CONTEXT_STATEMENT_SQL, [
    ctx.org,
    ctx.actor,
    ctx.scope ?? 'TENANT',
    ctx.guestHash,
    'guest-claim-it',
    '10000',
    String(lockTimeoutMs),
    '10000',
  ]);
}

/** `SQLSTATE constraint` (or `SQLSTATE message` when no constraint is named) of `sql` in a savepoint, or 'ok'. */
export async function outcome(client: pg.ClientBase, sql: string, params: readonly unknown[] = []): Promise<string> {
  await client.query('SAVEPOINT gc');
  try {
    await client.query(sql, [...params]);
    await client.query('RELEASE SAVEPOINT gc');
    return 'ok';
  } catch (error) {
    await client.query('ROLLBACK TO SAVEPOINT gc');
    const { code, constraint, message } = error as { code?: unknown; constraint?: unknown; message?: unknown };
    return `${String(code)} ${typeof constraint === 'string' && constraint !== '' ? constraint : String(message)}`;
  }
}
