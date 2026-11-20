// `@platform/shared/events`: the domain event catalogue of the transactional outbox (ADR-0004 amendment 2 item 12;
// TASK-043). Each module owns `events/<module>.ts` (a `ModuleEvents` record) and adds ONE import line and one entry
// here (PLAN.md §5 rule 2); events.test.ts fails when a file of this folder is not listed. A subpath of its own because
// the payload schemas need Joi, which the browser-safe root barrel does not carry.
//
// TASK-043 ships the mechanism with no event type. Delivery does not route by type here (there is no `eventRouting`
// map, D-ARCH-184): the relay enqueues every event as one `outbox_event` job on the `outbox-relay` queue, and that
// queue's processor dispatches by type (TASK-047). No event type enters this catalogue before that processor exists:
// apps/worker/src/processors.test.ts fails otherwise (item 12; TASK-049 is the first publisher).
import { type EventCatalogue, mergeEvents, type ModuleEvents } from './event-definition.js';

/** Module name (the event file name) to that module's events. */
export const EVENT_MODULES = {} as const satisfies Readonly<Record<string, ModuleEvents>>;

type Modules = typeof EVENT_MODULES;
type EventsOf<M> = M extends unknown ? keyof M : never;

/** A catalogued event type; the outbox writer accepts nothing else. */
export type DomainEventType = Extract<EventsOf<Modules[keyof Modules]>, string>;

/** Every catalogued event type with its definition. */
export const EVENT_CATALOGUE: EventCatalogue = mergeEvents(EVENT_MODULES);

export {
  AGGREGATE_TYPE_PATTERN,
  EVENT_TYPE_PATTERN,
  identifierPayload,
  isClosedObjectSchema,
  mergeEvents,
  validateEventPayload,
  type EventCatalogue,
  type EventDefinition,
  type EventPayloadCheck,
  type ModuleEvents,
} from './event-definition.js';
