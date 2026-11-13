/**
 * SPK-04 (TASK-018) THROWAWAY: the audit-chain entry hash of data-model §5.4 step 4, shared by the benchmark server and
 * the post-run verifier.
 *
 * canonical object = every audit_entries column except prev_hash, entry_hash and the generated scope_org_id; timestamps
 * as `YYYY-MM-DDTHH:MM:SS.ffffffZ`, bytea as lower-case hex, absent values as JSON null, hash_version included.
 * entry_hash = SHA-256( UTF-8(JCS(canonical)) || prev_hash ), the first prev_hash being 32 zero bytes (DR-A09).
 *
 * Lifecycle (D-ARCH-089, SPK-04 §8): deleted by the TASK-030 PR, after the pinned entry-hash vector (chain.test.ts) is
 * ported to packages/audit/test/chain. Harness-only: nothing under apps/** or packages/** may import this file.
 *
 * Timestamps are carried as integer microseconds since the Unix epoch (bigint) so nothing is lost to Date's milliseconds.
 */
import { createHash, randomBytes } from 'node:crypto';

import { canonicalize, type JsonValue } from './canonical.js';

export const ZERO_HASH_HEX = '00'.repeat(32);

export type ActorType = 'USER' | 'API_KEY' | 'SYSTEM_JOB' | 'ANONYMOUS';

/** One audit_entries row (data-model §5.1) minus prev_hash, entry_hash and scope_org_id. */
export interface AuditEntry {
  readonly id: string;
  readonly occurredAtMicros: bigint;
  readonly streamId: string;
  readonly streamSeq: number;
  readonly orgId: string | null;
  readonly targetOrgId: string | null;
  readonly onBehalfOfOrgId: string | null;
  readonly actorType: ActorType;
  readonly userId: string | null;
  readonly apiKeyId: string | null;
  readonly jobName: string | null;
  readonly actorRoles: readonly string[];
  readonly sessionId: string | null;
  readonly ipToken: string | null;
  /** Lower-case hex of the 32-byte HMAC, or null. */
  readonly ipHash: string | null;
  readonly ipHashKeyId: string | null;
  /** inet text form, e.g. `203.0.113.0/24`. */
  readonly ipCoarse: string | null;
  readonly userAgentToken: string | null;
  readonly uaParsed: string | null;
  readonly sourceApp: 'web' | 'admin' | 'api' | 'worker';
  readonly correlationId: string;
  readonly action: string;
  readonly entityName: string;
  readonly entityId: string | null;
  readonly outcome: 'SUCCESS' | 'DENIED' | 'FAILED';
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

const pad = (value: number | bigint, width: number): string => String(value).padStart(width, '0');

/** `YYYY-MM-DDTHH:MM:SS.ffffffZ` (UTC) of integer microseconds since the epoch. */
export function formatMicros(micros: bigint): string {
  const millis = micros / 1000n;
  const fraction = micros % 1_000_000n;
  if (micros < 0n) throw new RangeError('timestamps before 1970 are not supported');
  const date = new Date(Number(millis));
  return (
    `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}` +
    `T${pad(date.getUTCHours(), 2)}:${pad(date.getUTCMinutes(), 2)}:${pad(date.getUTCSeconds(), 2)}.${pad(fraction, 6)}Z`
  );
}

/** occurred_at = max(db_now, head_occurred_at + 1 µs): monotonic per stream even if the clock steps back. */
export function nextOccurredAt(dbNowMicros: bigint, headMicros: bigint | null): bigint {
  if (headMicros === null) return dbNowMicros;
  const floor = headMicros + 1n;
  return dbNowMicros > floor ? dbNowMicros : floor;
}

export function canonicalObject(entry: AuditEntry): Record<string, JsonValue> {
  return {
    id: entry.id,
    occurred_at: formatMicros(entry.occurredAtMicros),
    stream_id: entry.streamId,
    stream_seq: entry.streamSeq,
    org_id: entry.orgId,
    target_org_id: entry.targetOrgId,
    on_behalf_of_org_id: entry.onBehalfOfOrgId,
    actor_type: entry.actorType,
    user_id: entry.userId,
    api_key_id: entry.apiKeyId,
    job_name: entry.jobName,
    actor_roles: [...entry.actorRoles],
    session_id: entry.sessionId,
    ip_token: entry.ipToken,
    ip_hash: entry.ipHash,
    ip_hash_key_id: entry.ipHashKeyId,
    ip_coarse: entry.ipCoarse,
    user_agent_token: entry.userAgentToken,
    ua_parsed: entry.uaParsed,
    source_app: entry.sourceApp,
    correlation_id: entry.correlationId,
    action: entry.action,
    entity_name: entry.entityName,
    entity_id: entry.entityId,
    outcome: entry.outcome,
    reason_token: entry.reasonToken,
    reauth_proof_id: entry.reauthProofId,
    signature_meaning: entry.signatureMeaning,
    http_method: entry.httpMethod,
    route: entry.route,
    old_value: entry.oldValue,
    new_value: entry.newValue,
    details: entry.details,
    pii_token_count: entry.piiTokenCount,
    hash_version: entry.hashVersion,
  };
}

/** entry_hash (lower-case hex) = SHA-256(UTF-8(JCS(canonical)) || prev_hash). */
export function entryHash(entry: AuditEntry, prevHashHex: string): string {
  if (!/^[0-9a-f]{64}$/.test(prevHashHex)) throw new RangeError('prev_hash must be 32 bytes of lower-case hex');
  return createHash('sha256')
    .update(Buffer.from(canonicalize(canonicalObject(entry)), 'utf8'))
    .update(Buffer.from(prevHashHex, 'hex'))
    .digest('hex');
}

/** RFC 9562 UUIDv7 (48-bit Unix milliseconds, version 7, variant 10, random tail). */
export function uuidv7(nowMs: number = Date.now(), random: Buffer = randomBytes(16)): string {
  const bytes = Buffer.from(random.subarray(0, 16));
  bytes.writeUIntBE(nowMs, 0, 6);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x70;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
