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

/** One rule of a Joi `describe()` node; a `pattern` rule carries its regex as `regex.toString()`. */
interface SchemaRule {
  readonly name: string;
  readonly args?: { readonly regex?: string; readonly options?: { readonly invert?: boolean } };
}

/** The parts of a Joi `describe()` node the closed-schema walk reads. */
interface SchemaNode {
  readonly type?: string;
  readonly flags?: { readonly unknown?: boolean; readonly only?: boolean };
  readonly preferences?: { readonly allowUnknown?: boolean };
  readonly patterns?: unknown;
  readonly whens?: unknown;
  readonly ordered?: unknown;
  readonly externals?: unknown;
  readonly keys?: Readonly<Record<string, SchemaNode>>;
  readonly items?: readonly SchemaNode[];
  readonly rules?: readonly SchemaRule[];
}

/** Leaf types that cannot carry free text. */
const SAFE_LEAVES: ReadonlySet<string> = new Set(['number', 'boolean', 'date']);
/** String rules that bound a string to a grammar (an identifier, a timestamp, a ciphertext). */
const BOUNDED_STRING_RULES: ReadonlySet<string> = new Set(['pattern', 'guid', 'isoDate', 'base64']);
/** Flags that put a value of the schema's own choosing into the payload (a function may compute anything). */
const VALUE_FLAGS: readonly string[] = ['default', 'failover'];
/** `base64` holds ciphertext only: keys named `*_enc` (the `token_enc` convention, ADR-0004 amendment 3). */
const CIPHERTEXT_KEY = /_enc$/;

/**
 * Probe values every `pattern` regex must refuse (PR043-SEC-08 / code review R3-m1 (b)): an e-mail address, text with
 * a space, the empty string and a 257-letter string. A regex that matches any of them admits free text and counts as
 * open. Pattern quality beyond this set stays a review duty of every catalogue PR.
 */
const PATTERN_PROBES: readonly string[] = Object.freeze(['p@example.com', 'free text', '', 'a'.repeat(257)]);

/**
 * Rebuilds a `describe()` regex (`/source/flags`, Joi's `regex.toString()`) and tests the probes, a fresh RegExp per
 * probe so no `lastIndex` state carries over. A missing regex counts as open; one that does not parse throws, so the
 * catalogue fails to load (closed either way).
 */
function refusesEveryProbe(described: string | undefined): boolean {
  if (described === undefined) return false;
  const end = described.lastIndexOf('/');
  const source = described.slice(1, end);
  const flags = described.slice(end + 1);
  return PATTERN_PROBES.every((probe) => !new RegExp(source, flags).test(probe));
}

/**
 * Value-level refusals shared by every node type (PR043-SEC-08 (a)): a Joi conditional (`whens`) may swap in an open
 * schema; `ordered` array items, `externals`, a `custom` rule and a `default`/`failover` value may each put a value
 * the walk never sees; an inverted `pattern` admits everything except its grammar.
 */
function opensValues(node: SchemaNode): boolean {
  if (node.whens !== undefined || node.ordered !== undefined || node.externals !== undefined) return true;
  const flags = node.flags;
  if (flags !== undefined && VALUE_FLAGS.some((flag) => flag in flags)) return true;
  return (node.rules ?? []).some((rule) => rule.name === 'custom' || (rule.name === 'pattern' && rule.args?.options?.invert === true));
}

/**
 * A string is closed by a `valid` list (`flags.only`) or a grammar rule; every `pattern` must refuse the probe set,
 * and `base64` is allowed only under a `*_enc` key (PR043-SEC-08 (b), (c)).
 */
function closedString(node: SchemaNode, key: string | undefined): boolean {
  const rules = node.rules ?? [];
  if (rules.some((rule) => rule.name === 'base64') && (key === undefined || !CIPHERTEXT_KEY.test(key))) return false;
  if (!rules.filter((rule) => rule.name === 'pattern').every((rule) => refusesEveryProbe(rule.args?.regex))) return false;
  return node.flags?.only === true || rules.some((rule) => BOUNDED_STRING_RULES.has(rule.name));
}

/**
 * One node of the structural allow-list walk (PR043-SEC-01, PR043-SEC-08): no node may open the object
 * (`flags.unknown`, an `allowUnknown` preference, `patterns`) or its values (`opensValues`); an object needs explicit
 * `keys`, all closed; an array exactly one closed `items` entry, which inherits the array's key; a string see
 * `closedString`; otherwise only number, boolean and date. `any`, `alternatives`, `link` and custom types are refused.
 * `key` is the object key the node sits under (undefined at the root).
 */
function closedNode(node: SchemaNode, key?: string): boolean {
  if (node.flags?.unknown === true || node.preferences?.allowUnknown === true || node.patterns !== undefined) return false;
  if (opensValues(node)) return false;
  switch (node.type) {
    case 'object':
      return node.keys !== undefined && Object.entries(node.keys).every(([name, child]) => closedNode(child, name));
    case 'array':
      return node.items?.length === 1 && node.items.every((item) => closedNode(item, key));
    case 'string':
      return closedString(node, key);
    default:
      return node.type !== undefined && SAFE_LEAVES.has(node.type);
  }
}

/**
 * True for a Joi object schema that is closed all the way down (PR043-SEC-01, code review m5): every key is declared,
 * nothing accepts unknown keys or patterned keys at any depth, no conditional, default or custom rule can swap a value
 * in, and every string leaf is bound to a grammar or a list (PR043-SEC-08).
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
