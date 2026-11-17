import { randomUUID } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import { SYSTEM_ACTOR_ID as AUTHZ_SYSTEM_ACTOR_ID } from '@platform/authz';
import {
  ANONYMOUS_ACTOR_ID,
  AppError,
  isUuidV7,
  SERVER_CONTROLLED_FIELDS,
  serverControlledFieldIssues,
  SYSTEM_ACTOR_ID,
} from '@platform/shared';
import fc from 'fast-check';

import { DbError } from '../map-db-error.js';
import type { TransactionStamp } from '../with-tenant-tx.js';
import {
  catalogueFromDataModel,
  type QueryExtensionParams,
  SERVER_FIELD_API_NAMES,
  stampActor,
  stampArgs,
  standardColumnsExtension,
  type StandardColumnsModel,
  withStandardColumns,
} from './standard-columns.js';

const STD = ['id', 'createdAt', 'updatedAt', 'createdBy', 'updatedBy', 'version'];
const field = (name: string, kind = 'scalar') => ({ name, kind, type: 'String' });

/** A runtime data model in Prisma's shape: one TENANT model with the seam, one SYSTEM model, one bare model. */
const DATA_MODEL = {
  models: {
    Shipment: {
      fields: [...STD, 'orgId', 'onBehalfOfOrgId', 'reference']
        .map((name) => field(name))
        .concat([field('parcels', 'object'), field('org', 'object'), field('onBehalfOfOrg', 'object')]),
    },
    ReferenceDatasetVersion: { fields: [...STD, 'dataset'].map((name) => field(name)) },
    Ledger: { fields: ['id', 'occurredAt', 'amountMinor'].map((name) => field(name)) },
  },
};

const CATALOGUE = catalogueFromDataModel(DATA_MODEL);
const model = (name: string): StandardColumnsModel => {
  const found = CATALOGUE.get(name);
  if (found === undefined) throw new Error(`no model ${name}`);
  return found;
};

const ORG = randomUUID();
const ACTOR = randomUUID();
const STAMP: TransactionStamp = { orgId: ORG, actorId: ACTOR };
const NOW = new Date('2026-11-13T10:00:00.000Z');

function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected a throw');
}

describe('standard-columns catalogue (runtime data model)', () => {
  it('splits scalar and relation fields per model', () => {
    expect([...model('Shipment').relations]).toEqual(['parcels', 'org', 'onBehalfOfOrg']);
    expect(model('Shipment').scalars.has('onBehalfOfOrgId')).toBe(true);
    expect(model('Ledger').scalars.has('createdBy')).toBe(false);
  });

  it.each([
    ['undefined', undefined],
    ['no models', {}],
    ['models not an object', { models: [] }],
  ])('fails closed on an unreadable data model (%s): empty catalogue', (_label, dataModel) => {
    expect(catalogueFromDataModel(dataModel).size).toBe(0);
  });

  it('skips malformed models and fields', () => {
    const catalogue = catalogueFromDataModel({
      models: { A: null, B: { fields: 'x' }, C: { fields: [null, { kind: 'scalar' }, field('ok')] } },
    });
    expect([...catalogue.keys()]).toEqual(['C']);
    expect([...(catalogue.get('C')?.scalars ?? [])]).toEqual(['ok']);
  });
});

describe('AT-US-064-01 server sets the standard columns on create (unit)', () => {
  it('AT-US-064-01: create gets a UUIDv7 id, created_by = updated_by = caller, version 1, on_behalf_of_org_id null and the transaction org', () => {
    const out = stampArgs(model('Shipment'), 'create', { data: { reference: 'R1' } }, STAMP, NOW) as { data: Record<string, unknown> };
    expect(out.data).toEqual({
      reference: 'R1',
      id: expect.any(String),
      createdBy: ACTOR,
      updatedBy: ACTOR,
      version: 1,
      onBehalfOfOrgId: null,
      orgId: ORG,
    });
    expect(isUuidV7(out.data['id'])).toBe(true);
    // created_at / updated_at come from the column default now(): one value per transaction, so they are equal.
    expect(out.data).not.toHaveProperty('createdAt');
    expect(out.data).not.toHaveProperty('updatedAt');
  });

  it('[D-TASK037-05] a tenant-key model takes its id from the transaction: Organisation the org, User the actor; never a forged id', () => {
    const catalogue = catalogueFromDataModel({
      models: { Organisation: { fields: STD.map((name) => field(name)) }, User: { fields: STD.map((name) => field(name)) } },
    });
    const organisation = catalogue.get('Organisation');
    const user = catalogue.get('User');
    expect([organisation?.tenantKey, user?.tenantKey, model('Shipment').tenantKey]).toEqual(['org', 'actor', undefined]);
    expect(stampArgs(organisation, 'create', { data: { displayName: 'A' } }, STAMP, NOW)).toMatchObject({
      data: { id: ORG, createdBy: ACTOR },
    });
    expect(stampArgs(user, 'create', { data: { email: 'a@b.c' } }, STAMP, NOW)).toMatchObject({ data: { id: ACTOR, createdBy: ACTOR } });
    // Without the context value the id is a fresh UUIDv7 (RLS then refuses the row: fail closed).
    const anonymous = stampArgs(user, 'create', { data: {} }, { orgId: ORG, actorId: '' }, NOW) as { data: { id: string } };
    const orgless = stampArgs(organisation, 'create', { data: {} }, { orgId: '', actorId: ACTOR }, NOW) as { data: { id: string } };
    expect([anonymous.data.id, orgless.data.id].every((id) => id !== ACTOR && id !== ORG && isUuidV7(id))).toBe(true);
    expect(thrown(() => stampArgs(organisation, 'create', { data: { id: ORG } }, STAMP, NOW))).toMatchObject({ code: 'VALIDATION_ERROR' });
  });

  it('createMany / createManyAndReturn stamp every row with a distinct, time-ordered id', () => {
    for (const operation of ['createMany', 'createManyAndReturn']) {
      const out = stampArgs(
        model('Shipment'),
        operation,
        { data: [{ reference: 'a' }, { reference: 'b' }], skipDuplicates: false },
        STAMP,
        NOW,
      ) as {
        data: Array<Record<string, unknown>>;
        skipDuplicates: boolean;
      };
      expect(out.skipDuplicates).toBe(false);
      expect(out.data.map((row) => row['reference'])).toEqual(['a', 'b']);
      const ids = out.data.map((row) => String(row['id']));
      expect(new Set(ids).size).toBe(2);
      expect([...ids].sort()).toEqual(ids);
    }
  });

  it('createMany with a single object payload is stamped too', () => {
    const out = stampArgs(model('ReferenceDatasetVersion'), 'createMany', { data: { dataset: 'x' } }, STAMP, NOW) as {
      data: Record<string, unknown>;
    };
    expect(out.data).toMatchObject({ dataset: 'x', createdBy: ACTOR, version: 1 });
  });

  it('a model without org_id / the seam gets only the columns it has', () => {
    const out = stampArgs(model('ReferenceDatasetVersion'), 'create', { data: { dataset: 'x' } }, STAMP, NOW) as {
      data: Record<string, unknown>;
    };
    expect(Object.keys(out.data).sort()).toEqual(['createdBy', 'dataset', 'id', 'updatedBy', 'version']);
    const bare = stampArgs(model('Ledger'), 'create', { data: { amountMinor: 1n } }, STAMP, NOW) as { data: Record<string, unknown> };
    expect(Object.keys(bare.data).sort()).toEqual(['amountMinor', 'id']);
  });

  it('a transaction without an organisation leaves org_id to the input-free default (RLS / NOT NULL decide)', () => {
    const out = stampArgs(model('Shipment'), 'create', { data: { reference: 'g' } }, { orgId: '', actorId: '' }, NOW) as {
      data: Record<string, unknown>;
    };
    expect(out.data).not.toHaveProperty('orgId');
    expect(out.data['createdBy']).toBe(ANONYMOUS_ACTOR_ID);
  });

  it('an orgId equal to the transaction org is tolerated on create (redundant, not forged)', () => {
    const out = stampArgs(model('Shipment'), 'create', { data: { reference: 'r', orgId: ORG.toUpperCase() } }, STAMP, NOW) as {
      data: Record<string, unknown>;
    };
    expect(out.data['orgId']).toBe(ORG);
  });

  it('never mutates the caller arguments (property)', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string().filter((key) => !(key in SERVER_FIELD_API_NAMES) && key !== 'parcels' && key !== '__proto__'),
          fc.jsonValue(),
        ),
        (data) => {
          const args = { data, select: { id: true } };
          const snapshot = structuredClone(args);
          const out = stampArgs(model('Shipment'), 'create', args, STAMP, NOW) as { data: Record<string, unknown>; select: unknown };
          expect(args).toEqual(snapshot);
          // every caller field survives unchanged, the server fields are added
          for (const [key, value] of Object.entries(data)) expect(out.data[key]).toEqual(value);
          expect(out.data['createdBy']).toBe(ACTOR);
          expect(out.select).toEqual({ id: true });
        },
      ),
    );
  });
});

describe('AT-US-064-02 seed and system-job writes use the reserved system user (unit)', () => {
  it('AT-US-064-02: a SYSTEM_JOB context stamps created_by/updated_by with the reserved system user ID', () => {
    const out = stampArgs(
      model('ReferenceDatasetVersion'),
      'create',
      { data: { dataset: 'x' } },
      { orgId: '', actorId: SYSTEM_ACTOR_ID },
      NOW,
    ) as {
      data: Record<string, unknown>;
    };
    expect(out.data).toMatchObject({ createdBy: SYSTEM_ACTOR_ID, updatedBy: SYSTEM_ACTOR_ID });
  });

  it('the shared reserved ID is the one the authz seed migration writes (single value, data-model §1.6)', () => {
    expect(SYSTEM_ACTOR_ID).toBe(AUTHZ_SYSTEM_ACTOR_ID);
    expect(isUuidV7(SYSTEM_ACTOR_ID)).toBe(true);
    expect(isUuidV7(ANONYMOUS_ACTOR_ID)).toBe(true);
    expect(stampActor({ orgId: '', actorId: '' })).toBe(ANONYMOUS_ACTOR_ID);
  });
});

describe('AT-US-064-03 client-supplied server fields are rejected before any statement (unit)', () => {
  const prismaFields = Object.keys(SERVER_FIELD_API_NAMES);

  it('the extension list and the HTTP-boundary list name the same fields', () => {
    expect(Object.values(SERVER_FIELD_API_NAMES).sort()).toEqual([...SERVER_CONTROLLED_FIELDS].sort());
  });

  it.each(prismaFields.filter((name) => name !== 'orgId'))(
    'AT-US-064-03: create with "%s" is 400 VALIDATION_ERROR / UNKNOWN_FIELD',
    (name) => {
      const error = thrown(() => stampArgs(model('Shipment'), 'create', { data: { reference: 'r', [name]: 'x' } }, STAMP, NOW));
      expect(error).toBeInstanceOf(AppError);
      expect(error).toMatchObject({
        code: 'VALIDATION_ERROR',
        status: 400,
        errors: [{ pointer: `/body/${SERVER_FIELD_API_NAMES[name] ?? ''}`, code: 'UNKNOWN_FIELD' }],
      });
    },
  );

  it('AT-US-064-03: a forged orgId (another org, or any org in an org-less transaction) is rejected on create', () => {
    for (const stamp of [STAMP, { orgId: '', actorId: ACTOR }]) {
      expect(thrown(() => stampArgs(model('Shipment'), 'create', { data: { orgId: randomUUID() } }, stamp, NOW))).toMatchObject({
        code: 'VALIDATION_ERROR',
        errors: [{ pointer: '/body/org_id', code: 'UNKNOWN_FIELD' }],
      });
    }
    expect(thrown(() => stampArgs(model('Shipment'), 'create', { data: { orgId: 42 } }, STAMP, NOW))).toBeInstanceOf(AppError);
  });

  it.each(prismaFields)('AT-US-064-03: update setting "%s" is rejected (the tenant key and the version are server-owned)', (name) => {
    expect(thrown(() => stampArgs(model('Shipment'), 'update', { where: { id: 'x' }, data: { [name]: ORG } }, STAMP, NOW))).toMatchObject({
      code: 'VALIDATION_ERROR',
    });
  });

  it('every forged field of a createMany is listed once, in the canonical order', () => {
    const error = thrown(() =>
      stampArgs(
        model('Shipment'),
        'createMany',
        {
          data: [
            { version: 3, createdBy: ACTOR },
            { onBehalfOfOrgId: ORG, version: 2 },
          ],
        },
        STAMP,
        NOW,
      ),
    );
    expect((error as AppError).errors?.map((issue) => issue.pointer)).toEqual([
      '/body/created_by',
      '/body/version',
      '/body/on_behalf_of_org_id',
    ]);
  });

  it('upsert checks both branches', () => {
    expect(
      thrown(() => stampArgs(model('Shipment'), 'upsert', { where: { id: 'x' }, create: { id: 'y' }, update: {} }, STAMP, NOW)),
    ).toBeInstanceOf(AppError);
    expect(
      thrown(() => stampArgs(model('Shipment'), 'upsert', { where: { id: 'x' }, create: {}, update: { version: 9 } }, STAMP, NOW)),
    ).toBeInstanceOf(AppError);
  });

  it('the HTTP-boundary helper reports the same sub-code for a request body (EC-A18)', () => {
    expect(serverControlledFieldIssues({ name: 'n', version: 2, on_behalf_of_org_id: null })).toEqual([
      { pointer: '/body/version', code: 'UNKNOWN_FIELD', message: 'version is set by the server and must not be sent' },
      {
        pointer: '/body/on_behalf_of_org_id',
        code: 'UNKNOWN_FIELD',
        message: 'on_behalf_of_org_id is set by the server and must not be sent',
      },
    ]);
  });
});

describe('updates and pass-through operations', () => {
  it('update / updateMany / updateManyAndReturn set updated_by, updated_at and increment version', () => {
    for (const operation of ['update', 'updateMany', 'updateManyAndReturn']) {
      const out = stampArgs(model('Shipment'), operation, { where: { id: 'x' }, data: { reference: 'R2' } }, STAMP, NOW);
      expect(out).toEqual({ where: { id: 'x' }, data: { reference: 'R2', updatedBy: ACTOR, updatedAt: NOW, version: { increment: 1 } } });
    }
  });

  it('upsert stamps the create branch like create and the update branch like update', () => {
    const out = stampArgs(
      model('Shipment'),
      'upsert',
      { where: { id: 'x' }, create: { reference: 'c' }, update: { reference: 'u' } },
      STAMP,
      NOW,
    ) as {
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    };
    expect(out.create).toMatchObject({ reference: 'c', createdBy: ACTOR, version: 1, orgId: ORG, onBehalfOfOrgId: null });
    expect(out.update).toEqual({ reference: 'u', updatedBy: ACTOR, updatedAt: NOW, version: { increment: 1 } });
  });

  it.each(['findMany', 'findUnique', 'count', 'aggregate', 'groupBy', 'delete', 'deleteMany'])(
    '%s passes through unchanged (soft delete: TASK-100)',
    (operation) => {
      const args = { where: { id: 'x' } };
      expect(stampArgs(model('Shipment'), operation, args, STAMP, NOW)).toBe(args);
    },
  );

  it('a write on a model missing from the catalogue throws; reads on it pass (PR26-SEC-02)', () => {
    const forged = { data: { createdBy: 'x', version: 9 } };
    for (const operation of ['create', 'createMany', 'createManyAndReturn', 'update', 'updateMany', 'updateManyAndReturn', 'upsert']) {
      expect(thrown(() => stampArgs(undefined, operation, forged, STAMP, NOW))).toBeInstanceOf(TypeError);
    }
    const read = { where: { id: 'x' } };
    expect(stampArgs(undefined, 'findMany', read, STAMP, NOW)).toBe(read);
    expect(stampArgs(undefined, 'delete', read, STAMP, NOW)).toBe(read);
  });

  it('missing args or a non-object payload pass through for Prisma to judge', () => {
    expect(stampArgs(model('Shipment'), 'create', undefined, STAMP, NOW)).toBeUndefined();
    expect(stampArgs(model('Shipment'), 'create', { data: null }, STAMP, NOW)).toEqual({ data: null });
    expect(stampArgs(model('Shipment'), 'update', { data: 'x' }, STAMP, NOW)).toEqual({ data: 'x' });
  });
});

describe('every relation field is refused in a write payload (deny by default; PR26-SEC-01, D-TASK032-04)', () => {
  const REFUSED = { status: 500, reason: 'NESTED_WRITE_UNSUPPORTED' };
  const OPERATIONS = [
    'create',
    'createMany',
    'connectOrCreate',
    'upsert',
    'update',
    'updateMany',
    'delete',
    'deleteMany',
    'set',
    'connect',
    'disconnect',
  ];

  it.each(OPERATIONS)('a "%s" inside a relation field is NESTED_WRITE_UNSUPPORTED (500) before any statement', (op) => {
    const error = thrown(() => stampArgs(model('Shipment'), 'create', { data: { reference: 'r', parcels: { [op]: {} } } }, STAMP, NOW));
    expect(error).toBeInstanceOf(DbError);
    expect(error).toMatchObject(REFUSED);
  });

  type Build = (relation: object) => unknown;
  const SHAPES: ReadonlyArray<readonly [string, string, Build]> = [
    ['create', 'create', (relation) => ({ data: { reference: 'r', ...relation } })],
    ['createMany (second row)', 'createMany', (relation) => ({ data: [{ reference: 'a' }, { reference: 'b', ...relation }] })],
    ['createManyAndReturn', 'createManyAndReturn', (relation) => ({ data: [{ reference: 'a', ...relation }] })],
    ['update', 'update', (relation) => ({ where: { id: 'x' }, data: relation })],
    ['updateMany', 'updateMany', (relation) => ({ where: {}, data: relation })],
    ['updateManyAndReturn', 'updateManyAndReturn', (relation) => ({ where: {}, data: relation })],
    [
      'upsert (create branch)',
      'upsert',
      (relation) => ({ where: { id: 'x' }, create: { reference: 'c', ...relation }, update: { reference: 'u' } }),
    ],
    ['upsert (update branch)', 'upsert', (relation) => ({ where: { id: 'x' }, create: { reference: 'c' }, update: relation })],
  ];
  const FORMS: readonly object[] = [
    { parcels: { connect: [{ id: 'p' }] } },
    { parcels: { disconnect: [{ id: 'p' }] } },
    { parcels: { set: [{ id: 'p' }] } },
    { org: { connect: { id: randomUUID() } } },
    { org: { disconnect: true } },
    { onBehalfOfOrg: { connect: { id: randomUUID() } } },
    { onBehalfOfOrg: { connectOrCreate: { where: { id: 'x' }, create: {} } } },
  ];

  it.each(SHAPES)(
    '%s refuses connect / disconnect / set on a to-many relation and on the FK-backed org and on-behalf relations',
    (_label, operation, build) => {
      for (const form of FORMS) {
        expect(thrown(() => stampArgs(model('Shipment'), operation, build(form), STAMP, NOW))).toMatchObject(REFUSED);
      }
    },
  );

  it('a relation key is refused whatever its value shape (array, scalar, null, empty object)', () => {
    for (const value of [[], 'x', null, {}, 0, false]) {
      expect(thrown(() => stampArgs(model('Shipment'), 'update', { data: { parcels: value } }, STAMP, NOW))).toMatchObject(REFUSED);
    }
  });

  it('an undefined relation value is absent for Prisma and passes; a model with no relation is unaffected', () => {
    expect(() => stampArgs(model('Shipment'), 'update', { data: { reference: 'r', parcels: undefined } }, STAMP, NOW)).not.toThrow();
    expect(() => stampArgs(model('Ledger'), 'create', { data: { amountMinor: 1 } }, STAMP, NOW)).not.toThrow();
  });

  it('the scalar foreign-key form of the same change is a forged server column and is refused as UNKNOWN_FIELD', () => {
    expect(() => stampArgs(model('Shipment'), 'update', { data: { reference: 'r' } }, STAMP, NOW)).not.toThrow();
    expect(thrown(() => stampArgs(model('Shipment'), 'update', { data: { orgId: randomUUID() } }, STAMP, NOW))).toBeInstanceOf(AppError);
    expect(thrown(() => stampArgs(model('Shipment'), 'update', { data: { onBehalfOfOrgId: randomUUID() } }, STAMP, NOW))).toBeInstanceOf(
      AppError,
    );
  });
});

describe('the Prisma extension object and per-transaction binding', () => {
  it('$allOperations rewrites the args for the model Prisma names and calls query once', async () => {
    const extension = standardColumnsExtension(STAMP, CATALOGUE, () => NOW);
    const seen: unknown[] = [];
    const params: QueryExtensionParams = {
      model: 'Shipment',
      operation: 'update',
      args: { where: { id: 'x' }, data: {} },
      query: (args) => {
        seen.push(args);
        return Promise.resolve('row');
      },
    };
    await expect(extension.query.$allModels.$allOperations(params)).resolves.toBe('row');
    expect(seen).toEqual([{ where: { id: 'x' }, data: { updatedBy: ACTOR, updatedAt: NOW, version: { increment: 1 } } }]);
    expect(extension.name).toBe('standard-columns');
  });

  it('raw operations (no model) pass through', async () => {
    const extension = standardColumnsExtension(STAMP, CATALOGUE);
    const args = ['SELECT 1'];
    await expect(
      extension.query.$allModels.$allOperations({ operation: '$queryRaw', args, query: (a) => Promise.resolve(a) }),
    ).resolves.toBe(args);
  });

  it('a validation failure rejects without calling query (nothing reaches the database)', async () => {
    const extension = standardColumnsExtension(STAMP, CATALOGUE);
    let called = false;
    const run = (): Promise<unknown> =>
      extension.query.$allModels.$allOperations({
        model: 'Shipment',
        operation: 'create',
        args: { data: { version: 2 } },
        query: () => {
          called = true;
          return Promise.resolve();
        },
      });
    await expect(run()).rejects.toBeInstanceOf(AppError);
    expect(called).toBe(false);
  });

  it('withStandardColumns extends the client with an extension built from its runtime data model (cached per client)', () => {
    const extensions: unknown[] = [];
    const extended = { $transaction: () => Promise.resolve() };
    const client = {
      _runtimeDataModel: DATA_MODEL,
      $transaction: () => Promise.resolve(),
      $extends(extension: unknown) {
        extensions.push(extension);
        return extended;
      },
    };
    expect(withStandardColumns(client, STAMP)).toBe(extended);
    expect(withStandardColumns(client, { orgId: '', actorId: SYSTEM_ACTOR_ID })).toBe(extended);
    expect(extensions).toHaveLength(2);
  });

  it('fails closed when $extends returns something that is not a client', () => {
    const client = { _runtimeDataModel: DATA_MODEL, $extends: () => ({}) };
    expect(() => withStandardColumns(client, STAMP)).toThrow('$extends returned no client');
  });

  it.each<[string, object]>([
    ['no runtime data model (a Prisma upgrade renamed the private property)', {}],
    ['an empty runtime data model', { _runtimeDataModel: { models: {} } }],
    ['a runtime data model of the wrong shape', { _runtimeDataModel: [] }],
  ])('refuses to build the extension on %s (PR26-SEC-02)', (_label, shape) => {
    let extended = 0;
    const client = {
      ...shape,
      $extends() {
        extended += 1;
        return { $transaction: () => Promise.resolve() };
      },
    };
    expect(() => withStandardColumns(client, STAMP)).toThrow('no runtime data model');
    expect(extended).toBe(0);
  });

  it('$allOperations rejects a write on a model missing from the catalogue without calling query, and lets reads through', async () => {
    const extension = standardColumnsExtension(STAMP, CATALOGUE);
    let calls = 0;
    const query = (args: unknown): Promise<unknown> => {
      calls += 1;
      return Promise.resolve(args);
    };
    const forged = { data: { createdBy: 'x', version: 9 } };
    const run = (model: string, operation: string, args: unknown): Promise<unknown> =>
      extension.query.$allModels.$allOperations({ model, operation, args, query });
    await expect(run('Nope', 'update', forged)).rejects.toBeInstanceOf(TypeError);
    await expect(run('Nope', 'create', forged)).rejects.toBeInstanceOf(TypeError);
    expect(calls).toBe(0);
    const read = { where: { id: 'x' } };
    await expect(run('Nope', 'findMany', read)).resolves.toBe(read);
    expect(calls).toBe(1);
  });
});
