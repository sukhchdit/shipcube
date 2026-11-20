import { describe, expect, it } from '@jest/globals';
import { ANONYMOUS_ACTOR_ID } from '@platform/shared';
import { EVENT_CATALOGUE } from '@platform/shared/events';
import Joi from 'joi';

import { createOutbox, MAX_PAYLOAD_BYTES, outbox, OutboxWriteError, type OutboxDb } from './index.js';

const ID = '0193a5b2-7c1e-7d4a-9f3b-000000000f01';
const EVENT_ID = '0193a5b2-7c1e-7d4a-9f3b-000000000e01';
const TRACEPARENT = `00-${'a'.repeat(32)}-${'b'.repeat(16)}-01`;

const catalogue = {
  'shipment.booked': {
    aggregateType: 'shipment',
    payload: Joi.object({ shipment_id: Joi.string().guid().required(), note: Joi.string().max(10_000) }),
  },
} as const;

interface Call {
  readonly sql: string;
  readonly values: readonly unknown[];
}

/** A fake TenantDb: records the one raw statement and returns `rows`. */
function fakeDb(rows: unknown[] = [{ id: EVENT_ID }]): { readonly db: OutboxDb; readonly calls: Call[] } {
  const calls: Call[] = [];
  const db = {
    $queryRaw: (strings: TemplateStringsArray, ...values: unknown[]) => {
      calls.push({ sql: strings.join('$'), values });
      return Promise.resolve(rows);
    },
  } as unknown as OutboxDb;
  return { db, calls };
}

describe('[US-011] outbox writer (ADR-0004 item 2; REQ-PLAT-016)', () => {
  it('writes one bound INSERT on the business transaction; org, actor and correlation come from the transaction', async () => {
    const { db, calls } = fakeDb();
    const published = await createOutbox(catalogue).publish(db, {
      type: 'shipment.booked',
      aggregateId: ID,
      payload: { shipment_id: ID },
      traceparent: TRACEPARENT,
    });
    expect(published).toEqual({ id: EVENT_ID });
    expect(calls).toHaveLength(1);
    const [call] = calls;
    expect(call?.values).toEqual(['shipment.booked', 'shipment', ID, JSON.stringify({ shipment_id: ID }), TRACEPARENT, ANONYMOUS_ACTOR_ID]);
    expect(call?.sql).toContain('INSERT INTO public.outbox_events');
    expect(call?.sql).toContain('platform.app_org_id()');
    expect(call?.sql).toContain('platform.app_actor_id()');
    // AT-US-008-03 (D-062): the row's correlation id is the transaction's, set by withTenantTx from the request.
    expect(call?.sql).toContain("pg_catalog.current_setting('app.correlation_id', true)");
  });

  it('drops an invalid traceparent and stores none when the caller has none', async () => {
    for (const traceparent of ['not-a-traceparent', null, undefined]) {
      const { db, calls } = fakeDb();
      await createOutbox(catalogue).publish(db, { type: 'shipment.booked', aggregateId: ID, payload: { shipment_id: ID }, traceparent });
      expect(calls[0]?.values[4]).toBeNull();
    }
  });

  it.each([
    ['an uncatalogued type', { type: 'shipment.lost', aggregateId: ID, payload: { shipment_id: ID } }, 'not catalogued'],
    ['an inherited key as type', { type: 'toString', aggregateId: ID, payload: {} }, 'not catalogued'],
    [
      'an upper-case aggregate id',
      { type: 'shipment.booked', aggregateId: ID.toUpperCase(), payload: { shipment_id: ID } },
      'lower-case UUID',
    ],
    [
      'a payload its schema refuses',
      { type: 'shipment.booked', aggregateId: ID, payload: { email: 'x@y.z' } },
      'payload of shipment.booked refused',
    ],
    [
      'a payload over the size bound',
      { type: 'shipment.booked', aggregateId: ID, payload: { shipment_id: ID, note: 'x'.repeat(MAX_PAYLOAD_BYTES) } },
      'too large',
    ],
  ])('refuses %s before any statement (OutboxWriteError; the transaction rolls back)', async (_label, event, message) => {
    const { db, calls } = fakeDb();
    const write = createOutbox(catalogue).publish(db, event as never);
    await expect(write).rejects.toThrow(OutboxWriteError);
    await expect(createOutbox(catalogue).publish(db, event as never)).rejects.toThrow(message);
    expect(calls).toEqual([]);
  });

  it('refuses a non-object event and never echoes a payload value', async () => {
    const { db } = fakeDb();
    await expect(createOutbox(catalogue).publish(db, null as never)).rejects.toThrow('event must be an object');
    const refused = createOutbox(catalogue).publish(db, {
      type: 'shipment.booked',
      aggregateId: ID,
      payload: { shipment_id: 'leak-me-please' },
    });
    await expect(refused).rejects.not.toThrow('leak-me-please');
  });

  it('fails when the insert returns no row', async () => {
    const { db } = fakeDb([]);
    await expect(
      createOutbox(catalogue).publish(db, { type: 'shipment.booked', aggregateId: ID, payload: { shipment_id: ID } }),
    ).rejects.toThrow('the outbox insert returned no row');
  });

  it('the platform outbox writes the platform catalogue (no event type yet: everything is refused)', async () => {
    expect(Object.keys(EVENT_CATALOGUE)).toEqual([]);
    const { db, calls } = fakeDb();
    await expect(outbox.publish(db, { type: 'shipment.booked' as never, aggregateId: ID, payload: {} })).rejects.toThrow('not catalogued');
    expect(calls).toEqual([]);
  });
});
