/**
 * Server-controlled standard columns as a Prisma 7 query extension (data-model.md P2 and §7.6, ADR-0005 amendment 10
 * item 5; REQ-RLS-009, REQ-ORG-007, REQ-SEC-007; US-064; TASK-032).
 *
 * On every model write that runs inside `withTenantTx` the extension rewrites the arguments, and only the arguments:
 *  - create / createMany / createManyAndReturn / upsert.create: `id = uuidv7()`, `createdBy = updatedBy = actor`,
 *    `version = 1`, `onBehalfOfOrgId = null` (the M1 seam, DR-A06) and, for models with `orgId`, the transaction's
 *    organisation when the input has none. `createdAt`/`updatedAt` come from the column default `now()` (the
 *    transaction start), so a new row has `created_at = updated_at`.
 *  - update / updateMany / updateManyAndReturn / upsert.update: `updatedBy = actor`, `updatedAt = now`,
 *    `version: { increment: 1 }`. The version-conditional `where` and the 412/409 mapping are TASK-100 (REQ-RLS-011).
 *  - Caller input that already holds a server-controlled field is refused with 400 `VALIDATION_ERROR`, sub-code
 *    `UNKNOWN_FIELD` (AT-US-064-03, EC-A18) before any statement runs, so nothing is persisted. The one tolerated case
 *    is an `orgId` on create that equals the transaction's organisation (redundant, not forged).
 *  - Nested relation writes (`create`, `createMany`, `connectOrCreate`, `upsert`, `update*`, `delete*`, `set` inside a
 *    relation field) are refused (`DbError` 500 `NESTED_WRITE_UNSUPPORTED`): Prisma runs no query extension for the
 *    nested rows, so they would escape the stamping. Only `connect` / `disconnect` are allowed.
 * Reads, deletes and raw queries pass through unchanged (soft delete: TASK-100). A raw `INSERT` cannot skip the
 * stamping silently: `created_by`/`updated_by` have no default and are `NOT NULL` (catalog suite `catalog-std`).
 *
 * The actor and organisation come from the `withTenantTx` closure (data-model §7.6: no AsyncLocalStorage): the
 * runner extends the root client once per transaction with {@link withStandardColumns} and opens the transaction on
 * the extended client (SPK-03 F-05: the extension runs inside the interactive transaction). Prisma's `$extends`
 * returns a lightweight wrapper over the same engine and pool. The extension never issues a query of its own.
 *
 * Which columns a model has is read from the client's own runtime data model, so a new model is covered without a
 * registry edit; a model the data model does not know passes through (the database constraints still apply).
 */
import { ANONYMOUS_ACTOR_ID, AppError, uuidv7, type ValidationIssue } from '@platform/shared';

import { DbError, dbErrorMapping } from '../map-db-error.js';
import type { TransactionStamp } from '../with-tenant-tx.js';

/** Prisma field → API (snake_case) name of every server-controlled field (`SERVER_CONTROLLED_FIELDS`). */
export const SERVER_FIELD_API_NAMES: Readonly<Record<string, string>> = Object.freeze({
  id: 'id',
  orgId: 'org_id',
  createdAt: 'created_at',
  updatedAt: 'updated_at',
  createdBy: 'created_by',
  updatedBy: 'updated_by',
  version: 'version',
  onBehalfOfOrgId: 'on_behalf_of_org_id',
});

/** Prisma fields the extension sets on create; the generated create inputs require some of them (no column default). */
export type ServerColumn = 'id' | 'orgId' | 'createdAt' | 'updatedAt' | 'createdBy' | 'updatedBy' | 'version' | 'onBehalfOfOrgId';

/**
 * Typed seam for repository create input (D-TASK032-02). Prisma generates `createdBy`/`updatedBy` (and, on tenant
 * models, `orgId`) as REQUIRED create fields because the columns have no default, yet the caller must never supply
 * them: the extension does. Repositories write `data: serverStamped<Prisma.XUncheckedCreateInput>({ ...business fields })`;
 * the type removes every server column from what the caller may pass, and at run time the value is returned as is
 * (the extension fills the columns inside the transaction).
 */
export function serverStamped<TInput extends object>(data: Omit<TInput, ServerColumn>): TInput {
  return data as TInput;
}

/** Relation-field operations that write no row of the related model. */
const ALLOWED_NESTED_OPERATIONS: ReadonlySet<string> = new Set(['connect', 'disconnect']);

const CREATE_OPERATIONS: ReadonlySet<string> = new Set(['create', 'createMany', 'createManyAndReturn']);
const UPDATE_OPERATIONS: ReadonlySet<string> = new Set(['update', 'updateMany', 'updateManyAndReturn']);

/** What the extension needs to know about one model. */
export interface StandardColumnsModel {
  /** Scalar field names. */
  readonly scalars: ReadonlySet<string>;
  /** Relation (object) field names. */
  readonly relations: ReadonlySet<string>;
}

/** Model name (PascalCase, as Prisma passes it to query extensions) → its fields. */
export type StandardColumnsCatalogue = ReadonlyMap<string, StandardColumnsModel>;

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date);

/**
 * Builds the catalogue from a Prisma runtime data model (`{ models: { Name: { fields: [{ name, kind }] } } }`).
 * Fails closed on an unreadable shape: an empty catalogue stamps nothing, and the `NOT NULL` server columns without
 * a default then reject every insert.
 */
export function catalogueFromDataModel(dataModel: unknown): StandardColumnsCatalogue {
  const catalogue = new Map<string, StandardColumnsModel>();
  if (!isPlainObject(dataModel) || !isPlainObject(dataModel['models'])) return catalogue;
  for (const [name, model] of Object.entries(dataModel['models'])) {
    if (!isPlainObject(model) || !Array.isArray(model['fields'])) continue;
    const scalars = new Set<string>();
    const relations = new Set<string>();
    for (const field of model['fields'] as unknown[]) {
      if (!isPlainObject(field) || typeof field['name'] !== 'string') continue;
      if (field['kind'] === 'object') relations.add(field['name']);
      else scalars.add(field['name']);
    }
    catalogue.set(name, Object.freeze({ scalars, relations }));
  }
  return catalogue;
}

/** The actor recorded in `created_by`/`updated_by`: the caller, or the reserved anonymous actor (data-model §1.6). */
export const stampActor = (stamp: TransactionStamp): string => (stamp.actorId === '' ? ANONYMOUS_ACTOR_ID : stamp.actorId);

const unknownFieldIssue = (field: string): ValidationIssue => {
  const name = SERVER_FIELD_API_NAMES[field] ?? field;
  return { pointer: `/body/${name}`, code: 'UNKNOWN_FIELD', message: `${name} is set by the server and must not be sent` };
};

/** Server-controlled fields present in one write payload; `orgId` is tolerated on create when it is the stamp's. */
function forgedFields(data: PlainObject, stamp: TransactionStamp, isCreate: boolean): string[] {
  return Object.keys(SERVER_FIELD_API_NAMES).filter((field) => {
    if (!Object.hasOwn(data, field)) return false;
    if (field === 'orgId' && isCreate && stamp.orgId !== '') {
      const value = data[field];
      return typeof value !== 'string' || value.toLowerCase() !== stamp.orgId;
    }
    return true;
  });
}

function assertNoNestedWrites(model: StandardColumnsModel, data: PlainObject): void {
  for (const relation of model.relations) {
    const nested = data[relation];
    if (nested === undefined) continue;
    if (!isPlainObject(nested) || Object.keys(nested).some((op) => !ALLOWED_NESTED_OPERATIONS.has(op))) {
      throw new DbError(dbErrorMapping(500, 'NESTED_WRITE_UNSUPPORTED'));
    }
  }
}

/** Validates every payload of one call and throws one `VALIDATION_ERROR` listing all forged fields. */
function assertPayloads(model: StandardColumnsModel, payloads: readonly unknown[], stamp: TransactionStamp, isCreate: boolean): void {
  const forged = new Set<string>();
  for (const data of payloads) {
    // A non-object payload is Prisma's to reject; nothing of ours to stamp in it.
    if (!isPlainObject(data)) continue;
    for (const field of forgedFields(data, stamp, isCreate)) forged.add(field);
    assertNoNestedWrites(model, data);
  }
  if (forged.size > 0) {
    const ordered = Object.keys(SERVER_FIELD_API_NAMES).filter((field) => forged.has(field));
    throw new AppError('VALIDATION_ERROR', { errors: ordered.map(unknownFieldIssue) });
  }
}

function stampCreate(model: StandardColumnsModel, data: unknown, stamp: TransactionStamp): unknown {
  if (!isPlainObject(data)) return data;
  const has = (field: string): boolean => model.scalars.has(field);
  const actor = stampActor(stamp);
  return {
    ...data,
    ...(has('id') ? { id: uuidv7() } : {}),
    ...(has('createdBy') ? { createdBy: actor } : {}),
    ...(has('updatedBy') ? { updatedBy: actor } : {}),
    ...(has('version') ? { version: 1 } : {}),
    ...(has('onBehalfOfOrgId') ? { onBehalfOfOrgId: null } : {}),
    ...(has('orgId') && stamp.orgId !== '' ? { orgId: stamp.orgId } : {}),
  };
}

function stampUpdate(model: StandardColumnsModel, data: unknown, stamp: TransactionStamp, now: Date): unknown {
  if (!isPlainObject(data)) return data;
  const has = (field: string): boolean => model.scalars.has(field);
  return {
    ...data,
    ...(has('updatedBy') ? { updatedBy: stampActor(stamp) } : {}),
    ...(has('updatedAt') ? { updatedAt: now } : {}),
    ...(has('version') ? { version: { increment: 1 } } : {}),
  };
}

const asList = (data: unknown): readonly unknown[] => (Array.isArray(data) ? (data as unknown[]) : [data]);

/**
 * The pure rewrite: returns the arguments Prisma should run for `operation` on `model`, or throws before any
 * statement. `args` is never mutated. Operations other than create/update/upsert are returned unchanged.
 */
export function stampArgs(
  model: StandardColumnsModel | undefined,
  operation: string,
  args: unknown,
  stamp: TransactionStamp,
  now: Date,
): unknown {
  if (model === undefined || !isPlainObject(args)) return args;
  if (CREATE_OPERATIONS.has(operation)) {
    const data = args['data'];
    assertPayloads(model, asList(data), stamp, true);
    const stamped = Array.isArray(data) ? data.map((row: unknown) => stampCreate(model, row, stamp)) : stampCreate(model, data, stamp);
    return { ...args, data: stamped };
  }
  if (UPDATE_OPERATIONS.has(operation)) {
    assertPayloads(model, [args['data']], stamp, false);
    return { ...args, data: stampUpdate(model, args['data'], stamp, now) };
  }
  if (operation === 'upsert') {
    assertPayloads(model, [args['create']], stamp, true);
    assertPayloads(model, [args['update']], stamp, false);
    return { ...args, create: stampCreate(model, args['create'], stamp), update: stampUpdate(model, args['update'], stamp, now) };
  }
  return args;
}

/** The `$allOperations` parameters Prisma passes to a query extension (the subset used here). */
export interface QueryExtensionParams {
  readonly model?: string;
  readonly operation: string;
  readonly args: unknown;
  readonly query: (args: unknown) => Promise<unknown>;
}

/** A Prisma extension object (`Prisma.defineExtension` input shape) with one `$allModels.$allOperations` hook. */
export interface StandardColumnsExtension {
  readonly name: 'standard-columns';
  readonly query: {
    readonly $allModels: {
      $allOperations(params: QueryExtensionParams): Promise<unknown>;
    };
  };
}

/** The extension bound to one transaction's actor and organisation. `now` is injectable for tests. */
export function standardColumnsExtension(
  stamp: TransactionStamp,
  catalogue: StandardColumnsCatalogue,
  now: () => Date = () => new Date(),
): StandardColumnsExtension {
  return {
    name: 'standard-columns',
    query: {
      $allModels: {
        // A refused write REJECTS (never throws synchronously) and the query is never called: nothing is persisted.
        $allOperations({ model, operation, args, query }) {
          const definition = model === undefined ? undefined : catalogue.get(model);
          return Promise.resolve().then(() => query(stampArgs(definition, operation, args, stamp, now())));
        },
      },
    },
  };
}

/** The part of a Prisma client this module touches. */
export interface ExtendableClient {
  $extends(extension: StandardColumnsExtension): unknown;
}

/** One catalogue per root client (its data model never changes at run time). */
const catalogues = new WeakMap<object, StandardColumnsCatalogue>();

function catalogueOf(client: object): StandardColumnsCatalogue {
  let catalogue = catalogues.get(client);
  if (catalogue === undefined) {
    catalogue = catalogueFromDataModel(Reflect.get(client, '_runtimeDataModel', client));
    catalogues.set(client, catalogue);
  }
  return catalogue;
}

/**
 * `client` extended with the standard-columns extension for one transaction. The result is checked to still expose
 * `$transaction` (fail closed on an unexpected Prisma shape) and typed as the caller's client type, because a query
 * extension changes no model or result type.
 */
export function withStandardColumns<TClient extends ExtendableClient>(client: TClient, stamp: TransactionStamp, now?: () => Date): TClient {
  const extended = client.$extends(standardColumnsExtension(stamp, catalogueOf(client), now));
  if (!isExtendedClient<TClient>(extended)) throw new TypeError('withStandardColumns: $extends returned no client');
  return extended;
}

function isExtendedClient<TClient>(value: unknown): value is TClient {
  return typeof value === 'object' && value !== null && typeof Reflect.get(value, '$transaction') === 'function';
}
