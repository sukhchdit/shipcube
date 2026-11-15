/**
 * The audit entry contract: who, what, where, when and outcome (REQ-AUDIT-003/011, DR-A10/A11; data-model §3.4;
 * US-087; TASK-025). Pure: validation and row assembly, no I/O.
 *
 * The caller hands the writer the COMPLETE entry in one call, with every personal value in it marked as a
 * {@link PiiValue} (ADR-0007 am. 10 item 1, D-ARCH-085): personal values inside `oldValue` / `newValue` / `details`
 * (placed there by the redaction of TASK-028), plus the client IP, the raw user agent and a typed reason, which the
 * writer marks itself. {@link prepareEntry} validates everything and returns the personal values in one ordered list;
 * the writer tokenises that list in ONE batch and {@link PreparedEntry.complete} substitutes the tokens
 * (`{"$pii": "<token>"}` inside JSON values, `ip_token` / `user_agent_token` / `reason_token` columns). A personal
 * value therefore never reaches `audit_entries` or the chain in clear (ADR-0007 am. 2).
 *
 * Every refusal is `AuditWriteError` INVALID_ENTRY naming the field path, never its value.
 */
import { ANONYMOUS_ACTOR_ID, isCorrelationId, SYSTEM_ACTOR_ID } from '@platform/shared';

import {
  type AuditEntryAction,
  type AuditOutcome,
  type AuditSourceApp,
  DENIED_ONLY_ACTIONS,
  isAuditEntryAction,
  isAuditOutcome,
  isAuditSourceApp,
  isPiiClassification,
  type PiiClassification,
} from './actions.js';
import { type AuditRowDraft, HASH_VERSION, type JsonValue } from './entry-hash.js';
import { AuditWriteError } from './errors.js';
import { canonicalIp, coarseNetwork } from './network.js';

/** The natural person a personal value belongs to (`data_subjects`, ADR-0007 §Privacy erasure). */
export interface DataSubjectRef {
  readonly kind: 'USER' | 'CONTACT';
  /** The user id, or the contact row id (`shipment_parties`, `address_book_entries`, `invitations`). */
  readonly refId: string;
}

/** Input of {@link PiiValue}. */
export interface PiiValueInput {
  /** Audited entity the value belongs to, e.g. `shipment_party`; `audit_entry` for the entry's own fields. */
  readonly entityName: string;
  /** Field name, e.g. `name`, `ip`. */
  readonly field: string;
  readonly classification: PiiClassification;
  readonly value: string;
  /** Whose personal data it is; `null` when no subject is known (the tokeniser decides how to store it). */
  readonly subject: DataSubjectRef | null;
}

/** A personal value inside an entry; replaced by its vault token before anything is hashed or stored. */
export class PiiValue implements PiiValueInput {
  readonly entityName: string;
  readonly field: string;
  readonly classification: PiiClassification;
  readonly value: string;
  readonly subject: DataSubjectRef | null;

  constructor(input: PiiValueInput) {
    this.entityName = input.entityName;
    this.field = input.field;
    this.classification = input.classification;
    this.value = input.value;
    this.subject = input.subject === null ? null : Object.freeze({ kind: input.subject.kind, refId: input.subject.refId });
    Object.freeze(this);
  }
}

/** Marks a personal value for tokenisation. */
export const pii = (input: PiiValueInput): PiiValue => new PiiValue(input);

/** A JSON value whose leaves may be personal values awaiting their token. */
export type AuditValue = null | boolean | number | string | PiiValue | readonly AuditValue[] | { readonly [key: string]: AuditValue };

/** Who acted (REQ-AUDIT-011). */
export type AuditActor =
  | {
      readonly type: 'USER';
      readonly userId: string;
      /** Role keys held at the time of the action. */
      readonly roles?: readonly string[];
      readonly sessionId?: string | null;
    }
  | {
      /** Seam for M3 API keys. */
      readonly type: 'API_KEY';
      readonly apiKeyId: string;
      readonly userId?: string | null;
      readonly roles?: readonly string[];
    }
  | {
      /** A worker job or system reconciler; `user_id` becomes the SYSTEM actor (data-model §1.6). */
      readonly type: 'SYSTEM_JOB';
      readonly jobName: string;
    }
  | { readonly type: 'ANONYMOUS' };

/** Where the action came from. */
export interface AuditOrigin {
  readonly sourceApp: AuditSourceApp;
  /** The request's or the originating job's correlation id (ADR-0016 §15). */
  readonly correlationId: string;
  /** Client IP from the trusted proxy chain (EC-A12); tokenised, never stored in clear. */
  readonly ip?: string | null;
  /** Raw `User-Agent`; tokenised (truncated to {@link MAX_USER_AGENT_LENGTH} code points). */
  readonly userAgent?: string | null;
  /** Parsed browser family + major version / OS family only, e.g. `Firefox 146 / Windows` (≤ 120 characters). */
  readonly uaParsed?: string | null;
  readonly httpMethod?: string | null;
  /** Route template, never the concrete URL. */
  readonly route?: string | null;
}

/** One complete audit entry as the writer receives it. */
export interface AuditEntryInput {
  readonly action: AuditEntryAction;
  readonly outcome: AuditOutcome;
  /** Audited entity, e.g. `session`, `shipment` (`^[a-z][a-z0-9_]*$`). */
  readonly entityName: string;
  /** `null` for list views and entity-less events. */
  readonly entityId?: string | null;
  /** The actor's active organisation; `null` (or `''`) for none, which writes to a SYSTEM shard. */
  readonly orgId: string | null;
  /** Organisation whose data an operator cross-tenant action touched (REQ-RLS-006, DR-A15). */
  readonly targetOrgId?: string | null;
  readonly actor: AuditActor;
  readonly origin: AuditOrigin;
  /** Field-level diff (CREATE: new only, UPDATE: changed fields, DELETE: old only), keys sorted by JCS. */
  readonly oldValue?: AuditValue;
  readonly newValue?: AuditValue;
  /** Context snapshot (filter summary, result count, required permission, from/to state, ...). */
  readonly details?: AuditValue;
  /** Typed reason (REQ-AUDIT-025, ≤ 500 characters); tokenised. */
  readonly reason?: string | null;
  /** Owner of the entry's own personal fields (IP, user agent, reason); defaults to the USER actor. */
  readonly subject?: DataSubjectRef | null;
}

/** HMAC index of client IPs (`ip_hash`, `ip_hash_key_id`; ADR-0007 am. 2, SEC-P3-08 item 1). */
export interface IpIndex {
  /** `<purpose>-v<n>` of `AUDIT_INDEX_KEY`. */
  readonly keyId: string;
  /** HMAC-SHA256(AUDIT_INDEX_KEY, canonical IP): 32 bytes. */
  hash(ip: string): Uint8Array;
}

export interface PrepareOptions {
  /** The entry id (UUIDv7). */
  readonly id: string;
  /** SYSTEM shard 0..15 used when the entry has no organisation (ADR-0007 am. 1). */
  readonly systemShard: number;
  readonly ipIndex?: IpIndex;
}

/** A validated entry waiting for the tokens of its personal values. */
export interface PreparedEntry {
  /** Every personal value of the entry, in the order {@link complete} expects their tokens. */
  readonly piiValues: readonly PiiValue[];
  /** The row with the tokens substituted (tokens in `piiValues` order). */
  complete(tokens: readonly string[]): AuditRowDraft;
}

export const MAX_ROLES = 32;
export const MAX_PII_VALUES = 256;
export const MAX_PII_VALUE_LENGTH = 8_192;
export const MAX_USER_AGENT_LENGTH = 1_024;
export const MAX_REASON_LENGTH = 500;
export const MAX_UA_PARSED_LENGTH = 120;
export const MAX_ENTITY_ID_LENGTH = 256;
export const MAX_JSON_DEPTH = 32;
export const MAX_JSON_NODES = 10_000;
/** Key a JSON object may not carry: it is the token marker of the vault (`{"$pii": "<token>"}`). */
export const PII_MARKER = '$pii';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NAME = /^[a-z][a-z0-9_]{0,62}$/;
const ROLE_KEY = /^[A-Za-z][A-Za-z0-9_.:-]{0,63}$/;
const JOB_NAME = /^[a-z][a-z0-9_.:-]{0,63}$/;
const KEY_ID = /^[a-z][a-z0-9-]*-v[0-9]+$/;
const HTTP_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
/*
 * Shapes of the clear-text columns that reach the immutable, hash-chained row (PR42-SEC-04). Each is one bounded
 * character class without nested quantifiers (linear time). They refuse the shapes that carry personal data: a query
 * string, an e-mail address, a raw user agent. TASK-029 supplies these values from the descriptor and a parser.
 */
/** One segment of a route TEMPLATE: a literal, `:param` or `{param}` (never a concrete value with `@`, `?`, `%`). */
const ROUTE_SEGMENT = /^(?:[a-z0-9._~-]{1,64}|:[A-Za-z][A-Za-z0-9_]{0,62}|\{[A-Za-z][A-Za-z0-9_]{0,62}\})$/;
const MAX_ROUTE_LENGTH = 256;
/** An entity identifier (UUID, code, number): no `@`, `+`, space, `/`, `?`. */
const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;
/** Browser family and major version / OS family, e.g. `Firefox 146 / Windows`: no `;`, `,`, `@` (a raw user agent). */
const UA_PARSED = /^[A-Za-z0-9][A-Za-z0-9 ._()/-]{0,119}$/;
/** An object key that may appear in an INVALID_ENTRY field path (R1-n3); other keys are logged as `{key}`. */
const PATH_KEY = /^[A-Za-z_][A-Za-z0-9_]{0,63}$/;
/** A lone surrogate is refused by JCS (RFC 8785 §3.2.2.2). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const LONE_SURROGATES = new RegExp(LONE_SURROGATE.source, 'g');
const REPLACEMENT_CHARACTER = String.fromCharCode(0xfffd);
const NUL = String.fromCharCode(0);

/**
 * `String.prototype.toWellFormed` (ES2024; the repository's lib is ES2023): every lone surrogate becomes U+FFFD, which
 * is also what PostgreSQL stores for the driver's UTF-8 encoding of such a string, so the hashed row and the stored
 * row agree (PR #42 R1-m3, PR42-SEC-12, D-TASK025-13). A lone surrogate is valid JSON and Joi accepts it, so refusing
 * it here would give any client a 500 at will.
 */
export function wellFormed(value: string): string {
  return LONE_SURROGATE.test(value) ? value.replace(LONE_SURROGATES, REPLACEMENT_CHARACTER) : value;
}

/** NUL (U+0000) is not storable in `text`/`jsonb` (22P05): refused (the HTTP boundary owns the 400, D-TASK025-13). */
const hasNul = (value: string): boolean => value.includes(NUL);
const RESERVED_ACTORS: ReadonlySet<string> = new Set([SYSTEM_ACTOR_ID, ANONYMOUS_ACTOR_ID]);
/** Entity and field of the entry's own personal columns in the vault. */
const OWN_ENTITY = 'audit_entry';

const invalid = (field: string): AuditWriteError => new AuditWriteError('INVALID_ENTRY', { field });

/** `00000000-0000-0000-0000-0000000000NN` for shard `NN` (data-model §1.6). */
export function systemShardStreamId(shard: number): string {
  if (!Number.isInteger(shard) || shard < 0 || shard > 15) throw new RangeError('SYSTEM shard must be an integer 0..15');
  return `00000000-0000-0000-0000-0000000000${shard.toString(16).padStart(2, '0')}`;
}

function uuid(value: unknown, field: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw invalid(field);
  return value.toLowerCase();
}

function optionalUuid(value: unknown, field: string): string | null {
  return value === undefined || value === null ? null : uuid(value, field);
}

/** A storable string: well-formed (lone surrogates become U+FFFD) and without NUL. */
function storable(value: string, field: string): string {
  if (hasNul(value)) throw invalid(field);
  return wellFormed(value);
}

function boundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) throw invalid(field);
  return storable(value, field);
}

function optionalText(value: unknown, field: string, max: number): string | null {
  return value === undefined || value === null ? null : boundedText(value, field, max);
}

function matching(value: unknown, pattern: RegExp, field: string): string {
  if (typeof value !== 'string' || !pattern.test(value)) throw invalid(field);
  return value;
}

/** First `max` code points of `value` (never splits a surrogate pair). */
function truncateCodePoints(value: string, max: number): string {
  const points = Array.from(value);
  return points.length <= max ? value : points.slice(0, max).join('');
}

/** A validated, frozen copy of a data subject reference (each property read once). */
function copySubject(subject: unknown, field: string): DataSubjectRef | null {
  if (subject === undefined || subject === null) return null;
  if (typeof subject !== 'object') throw invalid(`${field}.kind`);
  const { kind, refId } = subject as { readonly kind?: unknown; readonly refId?: unknown };
  if (kind !== 'USER' && kind !== 'CONTACT') throw invalid(`${field}.kind`);
  return Object.freeze({ kind, refId: uuid(refId, `${field}.refId`) });
}

/** The writer's own validated copy of a personal value (each property read once; the copy is what is tokenised). */
function copyPiiValue(value: PiiValue, field: string): PiiValue {
  const { entityName, field: name, classification, value: text, subject } = value;
  if (!isPiiClassification(classification)) throw invalid(`${field}.classification`);
  return new PiiValue({
    entityName: matching(entityName, NAME, `${field}.entityName`),
    field: matching(name, NAME, `${field}.field`),
    classification,
    value: boundedText(text, `${field}.value`, MAX_PII_VALUE_LENGTH),
    subject: copySubject(subject, `${field}.subject`),
  });
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Reflect.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

interface WalkState {
  nodes: number;
  readonly pii: PiiValue[];
}

/**
 * The INVALID_ENTRY field path of an object member (R1-n3): the keys of the top-level object are schema field names
 * and stay readable; deeper keys, and any key outside {@link PATH_KEY}, are business data and appear as `{key}`.
 */
const memberPath = (path: string, key: string, depth: number): string => `${path}.${depth === 0 && PATH_KEY.test(key) ? key : '{key}'}`;

/** Code-unit order (what JCS sorts by, RFC 8785 §3.2.3). */
const byCodeUnits = (a: readonly [string, string], b: readonly [string, string]): number => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0);

/** Writes an own enumerable data property (a `__proto__` key, which JSON.parse makes an own key, stays a plain key). */
function defineMember(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: false, configurable: false });
}

/**
 * Validates a JSON value and returns its frozen SNAPSHOT (PR #42 R1-m2, PR42-SEC-03): every node of the caller's value
 * is read exactly once, strings and keys are normalised ({@link wellFormed}), each personal value is replaced by the
 * writer's own copy and collected in traversal order (keys sorted by code units, as JCS sorts them). The row is later
 * assembled from the snapshot only, so a caller mutation after validation (during the tokeniser round trip, or from
 * an accessor answering differently on a second read) cannot reach the row or the chain.
 */
function collect(value: unknown, path: string, depth: number, state: WalkState): AuditValue {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw invalid(path);
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(path);
    return value;
  }
  if (typeof value === 'string') return storable(value, path);
  if (value instanceof PiiValue) {
    const copy = copyPiiValue(value, path);
    state.pii.push(copy);
    return copy;
  }
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    const length = items.length;
    const out: AuditValue[] = [];
    for (let index = 0; index < length; index += 1) out.push(collect(items[index], `${path}[${String(index)}]`, depth + 1, state));
    return Object.freeze(out);
  }
  if (typeof value !== 'object' || !isPlainObject(value)) throw invalid(path);
  const record = value as Readonly<Record<string, unknown>>;
  const keys = Object.keys(record)
    .map((key): readonly [string, string] => [storable(key, path), key])
    .sort(byCodeUnits);
  const out = {};
  keys.forEach(([key, original], index) => {
    // A forged token marker, or two keys that normalise to the same text, is refused.
    if (key === PII_MARKER || (index > 0 && keys[index - 1]?.[0] === key)) throw invalid(path);
    defineMember(out, key, collect(record[original], memberPath(path, key, depth), depth + 1, state));
  });
  return Object.freeze(out);
}

/** Replaces each personal value by `{"$pii": token}`, in the traversal order of {@link collect}. */
function substitute(value: AuditValue, next: () => string): JsonValue {
  if (value instanceof PiiValue) return { [PII_MARKER]: next() };
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((item: AuditValue) => substitute(item, next));
  const record = value as { readonly [key: string]: AuditValue };
  const out: Record<string, JsonValue> = {};
  // defineProperty, not assignment: a `__proto__` key (JSON.parse makes it an own property) must stay a plain key.
  for (const key of Object.keys(record).sort()) {
    Object.defineProperty(out, key, {
      value: substitute(record[key] as AuditValue, next),
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }
  return out;
}

interface ActorColumns {
  readonly actorType: AuditRowDraft['actorType'];
  readonly userId: string | null;
  readonly apiKeyId: string | null;
  readonly jobName: string | null;
  readonly actorRoles: readonly string[];
  readonly sessionId: string | null;
}

/**
 * `length` is read once and the elements by index, never through the caller's own `map` (an own `map`, or a Proxy
 * whose `length` changes between reads, cannot smuggle unvalidated or extra roles; PR #42 R2-n1).
 */
function roles(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw invalid('actor.roles');
  const count: unknown = value.length;
  if (typeof count !== 'number' || count > MAX_ROLES) throw invalid('actor.roles');
  const out: string[] = [];
  for (let index = 0; index < count; index += 1) {
    out.push(matching(value[index], ROLE_KEY, `actor.roles[${String(index)}]`));
  }
  return out;
}

function actorUser(value: unknown, field: string): string {
  const id = uuid(value, field);
  if (RESERVED_ACTORS.has(id)) throw invalid(field);
  return id;
}

function actorColumns(actor: AuditActor): ActorColumns {
  if (typeof actor !== 'object' || actor === null) throw invalid('actor');
  switch (actor.type) {
    case 'USER':
      return {
        actorType: 'USER',
        userId: actorUser(actor.userId, 'actor.userId'),
        apiKeyId: null,
        jobName: null,
        actorRoles: roles(actor.roles),
        sessionId: optionalUuid(actor.sessionId, 'actor.sessionId'),
      };
    case 'API_KEY':
      return {
        actorType: 'API_KEY',
        userId: actor.userId === undefined || actor.userId === null ? null : actorUser(actor.userId, 'actor.userId'),
        apiKeyId: uuid(actor.apiKeyId, 'actor.apiKeyId'),
        jobName: null,
        actorRoles: roles(actor.roles),
        sessionId: null,
      };
    case 'SYSTEM_JOB':
      return {
        actorType: 'SYSTEM_JOB',
        userId: SYSTEM_ACTOR_ID,
        apiKeyId: null,
        jobName: matching(actor.jobName, JOB_NAME, 'actor.jobName'),
        actorRoles: [],
        sessionId: null,
      };
    case 'ANONYMOUS':
      return { actorType: 'ANONYMOUS', userId: null, apiKeyId: null, jobName: null, actorRoles: [], sessionId: null };
    default:
      throw invalid('actor.type');
  }
}

function organisation(value: unknown, field: string): string | null {
  return value === '' ? null : optionalUuid(value, field);
}

/** `ip_hash` and its key id; a failing or malformed index is `IP_INDEX_FAILED`, an infrastructure fault (R1-n4). */
function ipHash(index: IpIndex | undefined, ip: string | null): { readonly ipHash: string | null; readonly ipHashKeyId: string | null } {
  if (ip === null || index === undefined) return { ipHash: null, ipHashKeyId: null };
  let keyId: unknown;
  let digest: unknown;
  try {
    keyId = index.keyId;
    digest = index.hash(ip);
  } catch (error) {
    throw new AuditWriteError('IP_INDEX_FAILED', { cause: error });
  }
  if (typeof keyId !== 'string' || !KEY_ID.test(keyId)) throw new AuditWriteError('IP_INDEX_FAILED');
  if (!(digest instanceof Uint8Array) || digest.length !== 32) throw new AuditWriteError('IP_INDEX_FAILED');
  return { ipHash: Buffer.from(digest).toString('hex'), ipHashKeyId: keyId };
}

/** The owner of the entry's own personal fields: the explicit subject, else the USER actor, else none. */
function ownSubject(subject: unknown, userId: string | null, actorType: string): DataSubjectRef | null {
  if (subject !== undefined && subject !== null) return copySubject(subject, 'subject');
  return actorType === 'USER' && userId !== null ? Object.freeze({ kind: 'USER', refId: userId }) : null;
}

/** `origin.route`: a route template (PR42-SEC-04), never a concrete URL. */
function routeTemplate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.length > MAX_ROUTE_LENGTH || !value.startsWith('/')) throw invalid('origin.route');
  if (
    value !== '/' &&
    !value
      .slice(1)
      .split('/')
      .every((segment) => ROUTE_SEGMENT.test(segment))
  )
    throw invalid('origin.route');
  return value;
}

/** A clear-text column in its shape (PR42-SEC-04), after the storable-text checks. */
function shaped(value: unknown, field: string, max: number, pattern: RegExp): string | null {
  const text = optionalText(value, field, max);
  if (text !== null && !pattern.test(text)) throw invalid(field);
  return text;
}

/**
 * Validates an entry and returns its personal values plus the function that assembles the row once their tokens are
 * known. Throws `AuditWriteError` INVALID_ENTRY (IP_INDEX_FAILED for a failing IP index).
 *
 * Every property of the input is read exactly once, and the row is assembled from the validated copies only (PR #42
 * R1-m2, PR42-SEC-03): mutating the input after this call returns changes nothing that {@link PreparedEntry.complete}
 * produces.
 */
export function prepareEntry(input: AuditEntryInput, options: PrepareOptions): PreparedEntry {
  if (typeof input !== 'object' || (input as unknown) === null) throw invalid('entry');
  const { action, outcome, oldValue, newValue, details } = input;
  if (!isAuditEntryAction(action)) throw invalid('action');
  if (!isAuditOutcome(outcome)) throw invalid('outcome');
  if (DENIED_ONLY_ACTIONS.has(action) && outcome !== 'DENIED') throw invalid('outcome');
  const entityName = matching(input.entityName, NAME, 'entityName');
  const entityId = shaped(input.entityId, 'entityId', MAX_ENTITY_ID_LENGTH, ENTITY_ID);
  const orgId = organisation(input.orgId, 'orgId');
  const targetOrgId = organisation(input.targetOrgId, 'targetOrgId');
  const actor = actorColumns(input.actor);

  const origin: unknown = input.origin;
  if (typeof origin !== 'object' || origin === null) throw invalid('origin');
  const {
    sourceApp,
    correlationId,
    ip: rawIp,
    userAgent: rawUserAgent,
    uaParsed: rawUaParsed,
    httpMethod: rawMethod,
    route: rawRoute,
  } = origin as AuditOrigin;
  if (!isAuditSourceApp(sourceApp)) throw invalid('origin.sourceApp');
  if (!isCorrelationId(correlationId)) throw invalid('origin.correlationId');
  const ip = rawIp === undefined || rawIp === null ? null : canonicalIp(String(rawIp));
  if (ip === null && rawIp !== undefined && rawIp !== null) throw invalid('origin.ip');
  const userAgent =
    rawUserAgent === undefined || rawUserAgent === null || rawUserAgent === ''
      ? null
      : boundedText(
          typeof rawUserAgent === 'string' ? truncateCodePoints(rawUserAgent, MAX_USER_AGENT_LENGTH) : rawUserAgent,
          'origin.userAgent',
          MAX_USER_AGENT_LENGTH * 2,
        );
  const uaParsed = shaped(rawUaParsed, 'origin.uaParsed', MAX_UA_PARSED_LENGTH, UA_PARSED);
  const httpMethod = rawMethod === undefined || rawMethod === null ? null : String(rawMethod);
  if (httpMethod !== null && !HTTP_METHODS.has(httpMethod)) throw invalid('origin.httpMethod');
  const route = routeTemplate(rawRoute);
  const reason = optionalText(input.reason, 'reason', MAX_REASON_LENGTH);

  const absent = (value: AuditValue | undefined): boolean => value === undefined || value === null;
  if (action === 'STATE_TRANSITION' && (absent(oldValue) || absent(newValue))) {
    throw invalid(absent(oldValue) ? 'oldValue' : 'newValue');
  }
  const state: WalkState = { nodes: 0, pii: [] };
  const snapshots = (
    [
      ['oldValue', oldValue],
      ['newValue', newValue],
      ['details', details],
    ] as const
  ).map(([field, value]) => (value === undefined || value === null ? null : collect(value, field, 0, state)));

  const subject = ownSubject(input.subject, actor.userId, actor.actorType);
  const own = (field: string, value: string | null): PiiValue | null =>
    value === null ? null : pii({ entityName: OWN_ENTITY, field, classification: 'PERSONAL', value, subject });
  const ownValues = [own('ip', ip), own('user_agent', userAgent), own('reason', reason)];
  for (const value of ownValues) if (value !== null) state.pii.push(value);
  if (state.pii.length > MAX_PII_VALUES) throw invalid('pii');

  const id = uuid(options.id, 'id');
  const streamId = orgId ?? systemShardStreamId(options.systemShard);
  const network = ipHash(options.ipIndex, ip);
  const piiValues = Object.freeze([...state.pii]);

  return {
    piiValues,
    complete(tokens: readonly string[]): AuditRowDraft {
      if (tokens.length !== piiValues.length) throw new AuditWriteError('TOKENISER_FAILED');
      const checked = tokens.map((token) => {
        if (typeof token !== 'string' || !UUID.test(token)) throw new AuditWriteError('TOKENISER_FAILED');
        return token.toLowerCase();
      });
      let cursor = 0;
      const next = (): string => checked[cursor++] as string;
      const [oldJson, newJson, detailsJson] = snapshots.map((snapshot) => (snapshot === null ? null : substitute(snapshot, next))) as [
        JsonValue | null,
        JsonValue | null,
        JsonValue | null,
      ];
      const [ipToken, userAgentToken, reasonToken] = ownValues.map((value) => (value === null ? null : next()));
      return Object.freeze({
        id,
        streamId,
        orgId,
        targetOrgId,
        onBehalfOfOrgId: null,
        ...actor,
        actorRoles: Object.freeze([...actor.actorRoles]),
        ipToken: ipToken ?? null,
        ipHash: network.ipHash,
        ipHashKeyId: network.ipHashKeyId,
        ipCoarse: ip === null ? null : coarseNetwork(ip),
        userAgentToken: userAgentToken ?? null,
        uaParsed,
        sourceApp,
        correlationId,
        action,
        entityName,
        entityId,
        outcome,
        reasonToken: reasonToken ?? null,
        reauthProofId: null,
        signatureMeaning: null,
        httpMethod,
        route,
        oldValue: oldJson,
        newValue: newJson,
        details: detailsJson,
        piiTokenCount: checked.length,
        hashVersion: HASH_VERSION,
      });
    },
  };
}
