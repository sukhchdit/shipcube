// Shape of one domain event of the outbox catalogue (ADR-0004 items 1, 2, 5; data-model §3.5 `outbox_events.payload`;
// TASK-043). Each module owns `events/<module>.ts`; index.ts aggregates them. A payload carries identifiers, codes and
// a recipient locale only, never a personal value (consumers reload entities under RLS), and is validated per type
// against a closed Joi schema before the writer stores it.
import Joi from 'joi';

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

/** A lower-case canonical UUID. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The closed payload schema of an event that carries only these UUID keys, all required (the common case). */
export function identifierPayload(...keys: readonly string[]): Joi.ObjectSchema {
  return Joi.object(Object.fromEntries(keys.map((key) => [key, Joi.string().pattern(UUID).required()])));
}

/** One module's event file: `events/<module>.ts` exports a record of this shape. */
export type ModuleEvents = Readonly<Record<string, EventDefinition>>;

/** Event type to definition, over every module. */
export type EventCatalogue = Readonly<Record<string, EventDefinition>>;

/** The parts of a Joi `describe()` node the closed-schema walk reads. */
interface SchemaNode {
  readonly type?: string;
  readonly flags?: { readonly unknown?: boolean; readonly only?: boolean };
  readonly preferences?: { readonly allowUnknown?: boolean };
  readonly patterns?: unknown;
  readonly keys?: Readonly<Record<string, SchemaNode>>;
  readonly items?: readonly SchemaNode[];
  readonly rules?: readonly { readonly name: string }[];
}

/** Leaf types that cannot carry free text. */
const SAFE_LEAVES: ReadonlySet<string> = new Set(['number', 'boolean', 'date']);
/** String rules that bound a string to a grammar (an identifier, a timestamp, a ciphertext). */
const BOUNDED_STRING_RULES: ReadonlySet<string> = new Set(['pattern', 'guid', 'isoDate', 'base64']);

/**
 * One node of the structural allow-list walk (PR043-SEC-01): no node may open the object (`flags.unknown`, an
 * `allowUnknown` preference, `patterns`); an object needs explicit `keys`, all closed; an array exactly one closed
 * `items` entry; a string a grammar rule or a `valid` list (`flags.only`); otherwise only number, boolean and date.
 * `any`, `alternatives`, `link` and custom types are refused.
 */
function closedNode(node: SchemaNode): boolean {
  if (node.flags?.unknown === true || node.preferences?.allowUnknown === true || node.patterns !== undefined) return false;
  switch (node.type) {
    case 'object':
      return node.keys !== undefined && Object.values(node.keys).every(closedNode);
    case 'array':
      return node.items?.length === 1 && node.items.every(closedNode);
    case 'string':
      return node.flags?.only === true || (node.rules ?? []).some((rule) => BOUNDED_STRING_RULES.has(rule.name));
    default:
      return node.type !== undefined && SAFE_LEAVES.has(node.type);
  }
}

/**
 * True for a Joi object schema that is closed all the way down (PR043-SEC-01, code review m5): every key is declared,
 * nothing accepts unknown keys or patterned keys at any depth, and every string leaf is bound to a grammar or a list.
 * A payload carries identifiers, codes and a locale only (ADR-0004 item 1, SEC-P3-12), so an open object or a free
 * string, which could hold an e-mail address in the SYSTEM table, is refused when the catalogue loads.
 */
export function isClosedObjectSchema(schema: unknown): boolean {
  if (!Joi.isSchema(schema) || schema.type !== 'object') return false;
  return closedNode(schema.describe());
}

/**
 * Merges module event files; a type declared twice, a type or aggregate type outside its grammar, and a payload
 * schema that is not a closed object fail at load time.
 */
export function mergeEvents(modules: Readonly<Record<string, ModuleEvents>>): EventCatalogue {
  const merged: Record<string, EventDefinition> = {};
  const owner = new Map<string, string>();
  for (const [module, events] of Object.entries(modules)) {
    for (const [type, definition] of Object.entries(events)) {
      if (!EVENT_TYPE_PATTERN.test(type)) throw new Error(`Event type ${type} of ${module} is not <area>.<fact>`);
      if (!AGGREGATE_TYPE_PATTERN.test(definition.aggregateType))
        throw new Error(`Aggregate type of ${type} (${module}) is not a lower-case identifier`);
      if (!isClosedObjectSchema(definition.payload))
        throw new Error(`Payload schema of ${type} (${module}) must be a closed Joi object (declared keys, bounded values)`);
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
