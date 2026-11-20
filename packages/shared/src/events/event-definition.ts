// Shape of one domain event of the outbox catalogue (ADR-0004 items 1, 2, 5; data-model §3.5 `outbox_events.payload`;
// TASK-043). Each module owns `events/<module>.ts`; index.ts aggregates them. A payload carries identifiers, codes and
// a recipient locale only, never a personal value (consumers reload entities under RLS), and is validated per type
// against a closed Joi schema before the writer stores it.
import type Joi from 'joi';

/** The `outbox_events.type` grammar (`ck_outbox_events__type`): `<area>.<fact>`, lower case and `_`. */
export const EVENT_TYPE_PATTERN = /^[a-z_]+\.[a-z_]+$/;
/** The `outbox_events.aggregate_type` grammar (`ck_outbox_events__aggregate_type`). */
export const AGGREGATE_TYPE_PATTERN = /^[a-z][a-z_]{0,62}$/;

export interface EventDefinition {
  /** The aggregate the event is about (`shipment`, `user`, ...); the writer stores it, never the caller. */
  readonly aggregateType: string;
  /** The closed schema of the payload (identifiers and codes only). */
  readonly payload: Joi.ObjectSchema;
}

/** One module's event file: `events/<module>.ts` exports a record of this shape. */
export type ModuleEvents = Readonly<Record<string, EventDefinition>>;

/** Event type to definition, over every module. */
export type EventCatalogue = Readonly<Record<string, EventDefinition>>;

/**
 * Merges module event files; a type declared twice, a type or aggregate type outside its grammar fails at load time.
 */
export function mergeEvents(modules: Readonly<Record<string, ModuleEvents>>): EventCatalogue {
  const merged: Record<string, EventDefinition> = {};
  const owner = new Map<string, string>();
  for (const [module, events] of Object.entries(modules)) {
    for (const [type, definition] of Object.entries(events)) {
      if (!EVENT_TYPE_PATTERN.test(type)) throw new Error(`Event type ${type} of ${module} is not <area>.<fact>`);
      if (!AGGREGATE_TYPE_PATTERN.test(definition.aggregateType))
        throw new Error(`Aggregate type of ${type} (${module}) is not a lower-case identifier`);
      const previous = owner.get(type);
      if (previous !== undefined) throw new Error(`Event type ${type} is declared by both ${previous} and ${module}`);
      owner.set(type, module);
      merged[type] = Object.freeze({ aggregateType: definition.aggregateType, payload: definition.payload });
    }
  }
  return Object.freeze(merged);
}

export type EventPayloadCheck =
  | { readonly ok: true; readonly payload: Readonly<Record<string, unknown>> }
  | {
      /** `<path>: <joi type>` per issue: key paths and rule names only, never a value. */
      readonly ok: false;
      readonly issues: readonly string[];
    };

/** Validates a payload against its definition: closed object, no conversion, every issue reported. Never throws. */
export function validateEventPayload(definition: EventDefinition, payload: unknown): EventPayloadCheck {
  const result = definition.payload
    .prefs({ convert: false, abortEarly: false, allowUnknown: false, errors: { wrap: { label: false } } })
    .validate(payload);
  if (result.error === undefined) return { ok: true, payload: result.value as Readonly<Record<string, unknown>> };
  return { ok: false, issues: result.error.details.map((detail) => `${detail.path.join('.') || '(root)'}: ${detail.type}`) };
}
