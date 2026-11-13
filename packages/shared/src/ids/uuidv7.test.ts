import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { isServerControlledField, SERVER_CONTROLLED_FIELDS, serverControlledFieldIssues } from './server-controlled.js';
import { ANONYMOUS_ACTOR_ID, isUuidV7, SYSTEM_ACTOR_ID, uuidv7, uuidV7Timestamp } from './uuidv7.js';

describe('uuidv7 (ADR-0009, data-model P1; NFR-DATA-002)', () => {
  it('returns canonical lowercase UUIDv7 values whose embedded time is now', () => {
    const before = Date.now();
    const id = uuidv7();
    const after = Date.now();
    expect(isUuidV7(id)).toBe(true);
    const at = uuidV7Timestamp(id) ?? Number.NaN;
    expect(at).toBeGreaterThanOrEqual(before);
    expect(at).toBeLessThanOrEqual(after);
  });

  it('is unique and time-ordered (byte order = generation order) over a burst of ids (several share a millisecond)', () => {
    const ids = Array.from({ length: 2_000 }, () => uuidv7());
    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual(ids);
  });

  it.each([
    ['v4', '9b2e1f4a-3c5d-4e6f-8a7b-0c1d2e3f4a5b'],
    ['uppercase', uuidv7().toUpperCase()],
    ['bad variant', '01890a5d-ac96-774b-cb4f-8a2b0c1d2e3f'],
    ['not a string', 42],
    ['braced', `{${uuidv7()}}`],
  ])('rejects %s', (_label, value) => {
    expect(isUuidV7(value)).toBe(false);
    expect(uuidV7Timestamp(value)).toBeUndefined();
  });

  it('reserved actors are valid UUIDv7 with timestamp 0 (data-model §1.6)', () => {
    expect(SYSTEM_ACTOR_ID).toBe('00000000-0000-7000-8000-000000000001');
    expect(ANONYMOUS_ACTOR_ID).toBe('00000000-0000-7000-8000-000000000002');
    expect([SYSTEM_ACTOR_ID, ANONYMOUS_ACTOR_ID].map(uuidV7Timestamp)).toEqual([0, 0]);
  });

  it('the timestamp round-trips for any millisecond (property)', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 48 - 1 }), (ms) => {
        const hex = ms.toString(16).padStart(12, '0');
        const id = `${hex.slice(0, 8)}-${hex.slice(8)}-7000-8000-000000000000`;
        expect(uuidV7Timestamp(id)).toBe(ms);
      }),
    );
  });
});

describe('server-controlled fields (REQ-RLS-009, REQ-ORG-007; EC-A18)', () => {
  it('lists the standard columns, the tenant key and the on-behalf seam', () => {
    expect([...SERVER_CONTROLLED_FIELDS]).toEqual([
      'id',
      'org_id',
      'created_at',
      'updated_at',
      'created_by',
      'updated_by',
      'version',
      'on_behalf_of_org_id',
    ]);
    expect(isServerControlledField('version')).toBe(true);
    expect(isServerControlledField('reference')).toBe(false);
  });

  it('reports one UNKNOWN_FIELD issue per own server field, in list order, under the pointer prefix', () => {
    expect(serverControlledFieldIssues({ on_behalf_of_org_id: null, id: 'x', name: 'n' }, '/body/items/0')).toEqual([
      { pointer: '/body/items/0/id', code: 'UNKNOWN_FIELD', message: 'id is set by the server and must not be sent' },
      {
        pointer: '/body/items/0/on_behalf_of_org_id',
        code: 'UNKNOWN_FIELD',
        message: 'on_behalf_of_org_id is set by the server and must not be sent',
      },
    ]);
  });

  it('ignores inherited properties and non-object bodies', () => {
    const inherited = Object.create({ version: 1 }) as object;
    expect(serverControlledFieldIssues(inherited)).toEqual([]);
    for (const body of [null, undefined, 'version', 3, ['version']]) expect(serverControlledFieldIssues(body)).toEqual([]);
  });

  it('a body without server fields yields no issue (property)', () => {
    fc.assert(
      fc.property(
        fc.dictionary(
          fc.string().filter((key) => !isServerControlledField(key)),
          fc.jsonValue(),
        ),
        (body) => {
          expect(serverControlledFieldIssues(body)).toEqual([]);
        },
      ),
    );
  });
});
