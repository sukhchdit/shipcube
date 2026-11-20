/**
 * The transactional outbox writer: `outbox.publish(db, event)` (ADR-0004 item 2; REQ-PLAT-016; US-011; data-model §3.5,
 * §6.1; TASK-043).
 *
 * Inside the business transaction, never beside it (ADR-0005 am. 10 item 2, PR2-SEC-05 addendum, PR11-SEC-05 item 2,
 * D-ARCH-074): `publish` takes the `TenantDb` of the transaction and nothing else. No PrismaClient, no `pg`, no pool:
 * the event row is one bound `INSERT` on that transaction, so it commits with the state change and an audit entry, and
 * a rolled-back transaction leaves no event (AT-US-011-01/02). The negative lint fixture for this exact path proves the
 * imports are refused (tools/lint/negative-fixtures.test.ts).
 *
 * The sanctioned effect after commit (D-ARCH-106, ADR-0005 am. 11 item 18; T-83): a handler that must cause an effect
 * once its transaction committed (a notification, a saga step, a Valkey write such as a session revocation) publishes
 * an event here; the worker relay delivers it. This file is a whole-file T-83 root (eslint TENANT_TX_FILES): nothing in
 * it may call a network, queue or timer API.
 *
 * Server-derived columns (never the caller's): `org_id` = `platform.app_org_id()` and `actor_id` (with `created_by`,
 * `updated_by`) = `platform.app_actor_id()` of the transaction, ANONYMOUS when it has none (as the standard-columns
 * guard reads it); `correlation_id` = the transaction's `app.correlation_id`, which withTenantTx set from the request
 * (or job) context, so the row carries exactly the originating `X-Correlation-Id` (AT-US-008-03 outbox hop, D-062);
 * `aggregate_type` comes from the catalogue. The caller supplies the type, the aggregate id, the payload (validated
 * against the type's closed schema) and optionally the W3C `traceparent` of its span (an invalid one is dropped).
 *
 * `outbox_events` is a SYSTEM table (PR19-SEC-01, D-ARCH-080): only `apps/*\/src/platform/outbox/**` may name it
 * (`platform/system-model-owner`, rawSystemTable); module code calls `outbox.publish`.
 */
import { ANONYMOUS_ACTOR_ID } from '@platform/shared';
import { type DomainEventType, EVENT_CATALOGUE, type EventCatalogue, validateEventPayload } from '@platform/shared/events';
import { isTraceparent } from '@platform/shared/queues';

import type { AppTransactionClient } from '../db/index.js';
import type { TenantDb } from '../db/tenant-db.js';

/** A lower-case canonical UUID (the platform mints UUIDv7). */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
/** Upper bound of a serialised payload: identifiers and codes only, so far below this (data-model §3.5). */
export const MAX_PAYLOAD_BYTES = 8_192;

/** A programming error of the caller (unknown type, bad id, payload refused by its schema): the transaction rolls back. */
export class OutboxWriteError extends Error {
  override readonly name = 'OutboxWriteError';
}

/** The handle `publish` writes through: the business transaction's `TenantDb` (raw tagged templates only). */
export type OutboxDb = TenantDb<AppTransactionClient>;

export interface OutboxEventInput<TType extends string> {
  readonly type: TType;
  /** The UUID of the aggregate the event is about (lower case). */
  readonly aggregateId: string;
  /** Identifiers, codes and a locale only; validated against the type's closed schema. */
  readonly payload: Readonly<Record<string, unknown>>;
  /** W3C `traceparent` of the producing span; an invalid value is dropped (W3C: restart the trace). */
  readonly traceparent?: string | null | undefined;
}

export interface PublishedEvent {
  /** `outbox_events.id`, the id of the `outbox_event` job the relay will enqueue. */
  readonly id: string;
}

export interface Outbox<TType extends string> {
  /** Writes the event row in the transaction behind `db`; it commits or rolls back with it. */
  publish(db: OutboxDb, event: OutboxEventInput<TType>): Promise<PublishedEvent>;
}

interface Validated {
  readonly type: string;
  readonly aggregateType: string;
  readonly aggregateId: string;
  readonly payloadJson: string;
  readonly traceparent: string | null;
}

function validate(catalogue: EventCatalogue, event: OutboxEventInput<string>): Validated {
  if (typeof event !== 'object' || event === null) throw new OutboxWriteError('event must be an object');
  const definition = Object.hasOwn(catalogue, event.type) ? catalogue[event.type] : undefined;
  if (definition === undefined) throw new OutboxWriteError('event type is not catalogued');
  if (typeof event.aggregateId !== 'string' || !UUID.test(event.aggregateId))
    throw new OutboxWriteError(`aggregate id of ${event.type} must be a lower-case UUID`);
  const checked = validateEventPayload(definition, event.payload);
  if (!checked.ok) throw new OutboxWriteError(`payload of ${event.type} refused: ${checked.issues.join(', ')}`);
  const payloadJson = JSON.stringify(checked.payload);
  if (Buffer.byteLength(payloadJson, 'utf8') > MAX_PAYLOAD_BYTES) throw new OutboxWriteError(`payload of ${event.type} is too large`);
  const traceparent = typeof event.traceparent === 'string' && isTraceparent(event.traceparent) ? event.traceparent : null;
  return { type: event.type, aggregateType: definition.aggregateType, aggregateId: event.aggregateId, payloadJson, traceparent };
}

/** The outbox over a catalogue (a test seam; production code uses `outbox`, the full catalogue). */
export function createOutbox<TCatalogue extends EventCatalogue>(catalogue: TCatalogue): Outbox<Extract<keyof TCatalogue, string>> {
  return {
    async publish(db, event) {
      const row = validate(catalogue, event);
      const inserted = await db.$queryRaw<{ id: string }[]>`
        INSERT INTO public.outbox_events
               (type, aggregate_type, aggregate_id, org_id, actor_id, payload, correlation_id, trace_context,
                created_by, updated_by)
        SELECT ${row.type}::text, ${row.aggregateType}::text, ${row.aggregateId}::uuid, platform.app_org_id(), ctx.actor,
               ${row.payloadJson}::jsonb, pg_catalog.current_setting('app.correlation_id', true), ${row.traceparent}::text,
               ctx.actor, ctx.actor
          FROM (SELECT COALESCE(platform.app_actor_id(), ${ANONYMOUS_ACTOR_ID}::uuid) AS actor) AS ctx
        RETURNING id::text AS id`;
      const id = inserted[0]?.id;
      if (inserted.length !== 1 || id === undefined) throw new OutboxWriteError('the outbox insert returned no row');
      return { id };
    },
  };
}

/** The outbox of the platform catalogue (`@platform/shared/events`). */
export const outbox: Outbox<DomainEventType> = createOutbox(EVENT_CATALOGUE);
