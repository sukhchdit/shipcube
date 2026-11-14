/**
 * The entry hash of the per-stream chain (ADR-0007 §Hash chain; data-model §5.4 step 3, unchanged by amendment 10;
 * DR-A09; TASK-025). Pure: no I/O.
 *
 *   canonical object = every `audit_entries` column except `prev_hash`, `entry_hash` and the generated `scope_org_id`,
 *                      timestamps as `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC, microseconds), bytea as lower-case hex,
 *                      absent values as JSON `null`, `hash_version` included;
 *   entry_hash       = SHA-256( UTF-8(JCS(canonical object)) ‖ prev_hash ), the first prev_hash being 32 zero bytes.
 *
 * JCS is RFC 8785 through the `canonicalize` package (data-model §5.4). This is the same definition as the SPK-04
 * prototype (the harness chain.ts of the SPK-04 §8 table; product code never names the harness path, D-ARCH-089).
 * TASK-030 owns the chain module (`chain/hasher.ts`), ports the spike's pinned vector against it and may move this
 * code there unchanged.
 */
import { createHash } from 'node:crypto';

import canonicalize from 'canonicalize';

import type { AuditActorType, AuditEntryAction, AuditOutcome, AuditSourceApp } from './actions.js';

/** A JSON value as stored in `jsonb` (no `undefined`, no non-finite numbers, plain objects only). */
export type JsonValue = null | boolean | number | string | readonly JsonValue[] | { readonly [key: string]: JsonValue };

/** Canonicalisation version written to `hash_version` (data-model §3.4). */
export const HASH_VERSION = 1;

/** 32 zero bytes as lower-case hex: the `prev_hash` of `stream_seq = 1` (DR-A09). */
export const ZERO_HASH_HEX = '00'.repeat(32);

const HASH_HEX = /^[0-9a-f]{64}$/;

/** One `audit_entries` row without the chain columns (`stream_seq`, `occurred_at`, `prev_hash`, `entry_hash`). */
export interface AuditRowDraft {
  readonly id: string;
  readonly streamId: string;
  readonly orgId: string | null;
  readonly targetOrgId: string | null;
  readonly onBehalfOfOrgId: string | null;
  readonly actorType: AuditActorType;
  readonly userId: string | null;
  readonly apiKeyId: string | null;
  readonly jobName: string | null;
  readonly actorRoles: readonly string[];
  readonly sessionId: string | null;
  readonly ipToken: string | null;
  /** Lower-case hex of the 32-byte HMAC, or null. */
  readonly ipHash: string | null;
  readonly ipHashKeyId: string | null;
  /** `inet` text exactly as PostgreSQL prints it, e.g. `203.0.113.0/24`. */
  readonly ipCoarse: string | null;
  readonly userAgentToken: string | null;
  readonly uaParsed: string | null;
  readonly sourceApp: AuditSourceApp;
  readonly correlationId: string;
  readonly action: AuditEntryAction;
  readonly entityName: string;
  readonly entityId: string | null;
  readonly outcome: AuditOutcome;
  readonly reasonToken: string | null;
  readonly reauthProofId: string | null;
  readonly signatureMeaning: string | null;
  readonly httpMethod: string | null;
  readonly route: string | null;
  readonly oldValue: JsonValue | null;
  readonly newValue: JsonValue | null;
  readonly details: JsonValue | null;
  readonly piiTokenCount: number;
  readonly hashVersion: number;
}

/** The chain position of one entry, allocated under the stream lock. */
export interface ChainPosition {
  readonly streamSeq: number;
  /** Integer microseconds since the Unix epoch (`bigint`, so nothing is lost to `Date`'s milliseconds). */
  readonly occurredAtMicros: bigint;
}

const pad = (value: number | bigint, width: number): string => String(value).padStart(width, '0');

/** `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC) of integer microseconds since the epoch. */
export function formatMicros(micros: bigint): string {
  if (micros < 0n) throw new RangeError('timestamps before 1970 are not supported');
  const date = new Date(Number(micros / 1000n));
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}` +
    `T${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.${pad(micros % 1_000_000n, 6)}Z`
  );
}

/** `occurred_at = max(db_now, head_occurred_at + 1 µs)`: monotonic per stream even if the clock steps back (§5.4). */
export function nextOccurredAt(dbNowMicros: bigint, headMicros: bigint | null): bigint {
  if (headMicros === null) return dbNowMicros;
  const floor = headMicros + 1n;
  return dbNowMicros > floor ? dbNowMicros : floor;
}

/** The canonical object of an entry (snake_case column names, §5.4 step 3). */
export function canonicalEntry(row: AuditRowDraft, position: ChainPosition): Record<string, JsonValue> {
  return {
    id: row.id,
    occurred_at: formatMicros(position.occurredAtMicros),
    stream_id: row.streamId,
    stream_seq: position.streamSeq,
    org_id: row.orgId,
    target_org_id: row.targetOrgId,
    on_behalf_of_org_id: row.onBehalfOfOrgId,
    actor_type: row.actorType,
    user_id: row.userId,
    api_key_id: row.apiKeyId,
    job_name: row.jobName,
    actor_roles: [...row.actorRoles],
    session_id: row.sessionId,
    ip_token: row.ipToken,
    ip_hash: row.ipHash,
    ip_hash_key_id: row.ipHashKeyId,
    ip_coarse: row.ipCoarse,
    user_agent_token: row.userAgentToken,
    ua_parsed: row.uaParsed,
    source_app: row.sourceApp,
    correlation_id: row.correlationId,
    action: row.action,
    entity_name: row.entityName,
    entity_id: row.entityId,
    outcome: row.outcome,
    reason_token: row.reasonToken,
    reauth_proof_id: row.reauthProofId,
    signature_meaning: row.signatureMeaning,
    http_method: row.httpMethod,
    route: row.route,
    old_value: row.oldValue,
    new_value: row.newValue,
    details: row.details,
    pii_token_count: row.piiTokenCount,
    hash_version: row.hashVersion,
  };
}

/** RFC 8785 text of a JSON value; throws for anything JCS refuses (lone surrogates, non-finite numbers). */
export function jcs(value: JsonValue): string {
  const text = canonicalize(value);
  if (text === undefined) throw new TypeError('value has no JSON representation');
  return text;
}

/** `entry_hash` (lower-case hex) = SHA-256( UTF-8(JCS(canonical)) ‖ prev_hash ). */
export function computeEntryHash(row: AuditRowDraft, position: ChainPosition, prevHashHex: string): string {
  if (!HASH_HEX.test(prevHashHex)) throw new RangeError('prev_hash must be 32 bytes of lower-case hex');
  return createHash('sha256')
    .update(Buffer.from(jcs(canonicalEntry(row, position)), 'utf8'))
    .update(Buffer.from(prevHashHex, 'hex'))
    .digest('hex');
}
