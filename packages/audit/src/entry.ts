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
const ROUTE = /^\/[\x21-\x7e]{0,255}$/;
const HTTP_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']);
/** A lone surrogate is refused by JCS (RFC 8785 §3.2.2.2). */
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
/** NUL (U+0000) is not storable in `text`/`jsonb` (22P05), and a lone surrogate cannot be canonicalised. */
const unstorable = (value: string): boolean => value.includes(String.fromCharCode(0)) || LONE_SURROGATE.test(value);
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

function boundedText(value: unknown, field: string, max: number): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max || unstorable(value)) throw invalid(field);
  return value;
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

function checkSubject(subject: DataSubjectRef | null, field: string): void {
  if (subject === null) return;
  if (typeof subject !== 'object' || (subject.kind !== 'USER' && subject.kind !== 'CONTACT')) throw invalid(`${field}.kind`);
  uuid(subject.refId, `${field}.refId`);
}

function checkPiiValue(value: PiiValue, field: string): void {
  matching(value.entityName, NAME, `${field}.entityName`);
  matching(value.field, NAME, `${field}.field`);
  if (!isPiiClassification(value.classification)) throw invalid(`${field}.classification`);
  boundedText(value.value, `${field}.value`, MAX_PII_VALUE_LENGTH);
  checkSubject(value.subject, `${field}.subject`);
}

function isPlainObject(value: object): boolean {
  const proto: unknown = Reflect.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

interface WalkState {
  nodes: number;
  readonly pii: PiiValue[];
}

/** Validates a JSON value and collects its personal values in traversal order (keys sorted, as JCS sorts them). */
function collect(value: AuditValue, field: string, depth: number, state: WalkState): void {
  state.nodes += 1;
  if (state.nodes > MAX_JSON_NODES || depth > MAX_JSON_DEPTH) throw invalid(field);
  if (value === null || typeof value === 'boolean') return;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw invalid(field);
    return;
  }
  if (typeof value === 'string') {
    if (unstorable(value)) throw invalid(field);
    return;
  }
  if (value instanceof PiiValue) {
    checkPiiValue(value, field);
    state.pii.push(value);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item: AuditValue, index) => collect(item, `${field}[${String(index)}]`, depth + 1, state));
    return;
  }
  if (typeof value !== 'object' || !isPlainObject(value)) throw invalid(field);
  const record = value as { readonly [key: string]: AuditValue };
  for (const key of Object.keys(record).sort()) {
    if (key === PII_MARKER || unstorable(key)) throw invalid(field);
    collect(record[key] as AuditValue, `${field}.${key}`, depth + 1, state);
  }
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

function roles(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > MAX_ROLES) throw invalid('actor.roles');
  return value.map((role: unknown, index) => matching(role, ROLE_KEY, `actor.roles[${String(index)}]`));
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

function ipHash(index: IpIndex | undefined, ip: string | null): { readonly ipHash: string | null; readonly ipHashKeyId: string | null } {
  if (ip === null || index === undefined) return { ipHash: null, ipHashKeyId: null };
  const keyId = matching(index.keyId, KEY_ID, 'ipIndex.keyId');
  const digest = index.hash(ip);
  if (!(digest instanceof Uint8Array) || digest.length !== 32) throw invalid('ipIndex.hash');
  return { ipHash: Buffer.from(digest).toString('hex'), ipHashKeyId: keyId };
}

/** The owner of the entry's own personal fields: the explicit subject, else the USER actor, else none. */
function ownSubject(input: AuditEntryInput, userId: string | null, actorType: string): DataSubjectRef | null {
  if (input.subject !== undefined && input.subject !== null) return input.subject;
  return actorType === 'USER' && userId !== null ? { kind: 'USER', refId: userId } : null;
}

/**
 * Validates an entry and returns its personal values plus the function that assembles the row once their tokens are
 * known. Throws `AuditWriteError` INVALID_ENTRY.
 */
export function prepareEntry(input: AuditEntryInput, options: PrepareOptions): PreparedEntry {
  if (typeof input !== 'object' || (input as unknown) === null) throw invalid('entry');
  if (!isAuditEntryAction(input.action)) throw invalid('action');
  if (!isAuditOutcome(input.outcome)) throw invalid('outcome');
  if (DENIED_ONLY_ACTIONS.has(input.action) && input.outcome !== 'DENIED') throw invalid('outcome');
  const entityName = matching(input.entityName, NAME, 'entityName');
  const entityId = optionalText(input.entityId, 'entityId', MAX_ENTITY_ID_LENGTH);
  const orgId = organisation(input.orgId, 'orgId');
  const targetOrgId = organisation(input.targetOrgId, 'targetOrgId');
  const actor = actorColumns(input.actor);

  const origin = input.origin;
  if (typeof origin !== 'object' || (origin as unknown) === null) throw invalid('origin');
  if (!isAuditSourceApp(origin.sourceApp)) throw invalid('origin.sourceApp');
  if (!isCorrelationId(origin.correlationId)) throw invalid('origin.correlationId');
  const ip = origin.ip === undefined || origin.ip === null ? null : canonicalIp(String(origin.ip));
  if (ip === null && origin.ip !== undefined && origin.ip !== null) throw invalid('origin.ip');
  const userAgent =
    origin.userAgent === undefined || origin.userAgent === null || origin.userAgent === ''
      ? null
      : boundedText(truncateCodePoints(origin.userAgent, MAX_USER_AGENT_LENGTH), 'origin.userAgent', MAX_USER_AGENT_LENGTH * 2);
  const uaParsed = optionalText(origin.uaParsed, 'origin.uaParsed', MAX_UA_PARSED_LENGTH);
  const httpMethod = origin.httpMethod === undefined || origin.httpMethod === null ? null : String(origin.httpMethod);
  if (httpMethod !== null && !HTTP_METHODS.has(httpMethod)) throw invalid('origin.httpMethod');
  const route = origin.route === undefined || origin.route === null ? null : matching(origin.route, ROUTE, 'origin.route');
  const reason = optionalText(input.reason, 'reason', MAX_REASON_LENGTH);

  const absent = (value: AuditValue | undefined): boolean => value === undefined || value === null;
  if (input.action === 'STATE_TRANSITION' && (absent(input.oldValue) || absent(input.newValue))) {
    throw invalid(absent(input.oldValue) ? 'oldValue' : 'newValue');
  }
  const state: WalkState = { nodes: 0, pii: [] };
  const values: Array<readonly [string, AuditValue | null]> = [
    ['oldValue', input.oldValue ?? null],
    ['newValue', input.newValue ?? null],
    ['details', input.details ?? null],
  ];
  for (const [field, value] of values) collect(value, field, 0, state);
  const jsonPiiCount = state.pii.length;

  const subject = ownSubject(input, actor.userId, actor.actorType);
  checkSubject(subject, 'subject');
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
      const [oldValue, newValue, details] = values.map(([, value]) => (value === null ? null : substitute(value, next))) as [
        JsonValue | null,
        JsonValue | null,
        JsonValue | null,
      ];
      if (cursor !== jsonPiiCount) throw new AuditWriteError('TOKENISER_FAILED');
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
        sourceApp: origin.sourceApp,
        correlationId: origin.correlationId,
        action: input.action,
        entityName,
        entityId,
        outcome: input.outcome,
        reasonToken: reasonToken ?? null,
        reauthProofId: null,
        signatureMeaning: null,
        httpMethod,
        route,
        oldValue,
        newValue,
        details,
        piiTokenCount: checked.length,
        hashVersion: HASH_VERSION,
      });
    },
  };
}
