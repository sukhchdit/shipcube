/**
 * The idempotency key store, the PORT of `idempotency_keys` (REQ-API-009..011, DR-A20; ADR-0014 §HTTP idempotency;
 * data-model §6.2 protocol; api/README §5; TASK-040).
 *
 * PR19-SEC-01 / D-ARCH-080 consumer (the first writable SYSTEM model): `idempotency_keys` is reached only here, through
 * `systemDelegates(db).idempotencyKey` on the `TenantDb` of a transaction the tx slot opened; the
 * `platform/system-model-owner` lint names apps/api/src/platform/idempotency/** as its only owner. This module is the
 * only writer and reader of the ciphertext response bodies. It takes `AppDb` as a type and imports no value from the
 * generated client (D-ARCH-104). Every function with an `AppDb` parameter runs inside a transaction: no external I/O
 * (T-83); the work here is bound statements and local CPU (hashing, AES-GCM).
 *
 * Protocol (data-model §6.2, application clock as in §7.6):
 *  1. `begin`, in a transaction of its own committed before the route's phases run, so a concurrent duplicate sees the
 *     claim: INSERT … ON CONFLICT (scope_hash) DO NOTHING (`createManyAndReturn` with `skipDuplicates`) of an
 *     IN_PROGRESS row with the lease the tx slot sized (at least 30 s) and a 24 h expiry. When nothing was inserted, the existing row decides: an
 *     expired row is deleted and the claim is retried (AT-US-038-09); another fingerprint is `reused` (422,
 *     AT-US-038-04); COMPLETED is a `replay` of the stored status, headers and decrypted body (AT-US-038-01/-07), or a
 *     `replay-problem` for a stored thrown 4xx (problem.ts); an unreadable row is logged at ERROR and throws;
 *     IN_PROGRESS with a live lease is `in-progress` (409 + Retry-After 1, AT-US-038-05); with an expired lease (a
 *     crashed request) the lease is taken over (conditional on the row version) and the request executes.
 *  2. `complete`: COMPLETED with the response, conditional on the claim's id, version and IN_PROGRESS. The response is
 *     ONE sealed envelope `{v, origin, status, headers, body}`, with or without a body (ADR-0014 amendment 15,
 *     PR040-SEC-02): a replay reads the status, the headers and the body from the opened envelope only; the clear
 *     `response_status` and `response_headers` are informational copies that must equal it, else the row is unreadable;
 *     `ck_idempotency_keys__completed_body` makes a completed row always carry the ciphertext. Inside the
 *     handler transaction for a 2xx (atomic with the business change and its audit entry); in a short transaction of
 *     its own for a returned or thrown 4xx, after the rolled-back handler transaction (D-TASK029-16/-17, D-ARCH-143); after
 *     the fail-closed entry of a read-only (VIEW / DOWNLOAD) handler. A claim
 *     lost to a takeover throws {@link IdempotencyClaimLostError}, so a stale request's 2xx rolls back.
 *  3. `release`: DELETE of the claim (same condition) after a 5xx, a 429 or any other failure, so the retry executes
 *     again (AT-US-038-06, EC-A30). `renew` extends the lease between phases (same condition, code review m4).
 * The purge of expired rows (step 5 of §6.2) is the worker schedule of part TASK-040-B (D-ARCH-192), not request work.
 */
import { type Principal, type RouteResult } from '../routing/define-route.js';
import { type AppDb, type Prisma, serverStamped } from '../db/index.js';
import { systemDelegates } from '../db/system-db.js';
import { type BodyCipher, IdempotencyReplayError } from './body-cipher.js';
import type { RenderedProblemError } from '../errors/rendered-problem.js';
import { replayedProblemOf } from './problem.js';
import { IDEMPOTENT_REPLAYED_HEADER, type IdempotencyRequest } from './request.js';
import { scopeOf } from './scope.js';

/** A key is new again 24 h after its first use (ADR-0014, api/README §5 "Not stored", AT-US-038-09). */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1_000;
/**
 * The minimum in-progress lease (data-model §6.2): a crashed request's key is taken over after it. The tx slot sizes the
 * lease of each request to cover its longest phase and renews it between phases (`leaseMsFor`, tx/execute.ts).
 */
export const IDEMPOTENCY_LEASE_MS = 30_000;
/** `Retry-After` of 409 IDEMPOTENCY_IN_PROGRESS (api/README §5 "Conflicts"). */
export const IN_PROGRESS_RETRY_AFTER_SECONDS = 1;
/** Response headers stored for a replay (data-model §3.5 `response_headers`: allow-listed), with their wire names. */
const STORED_HEADERS: ReadonlyMap<string, string> = new Map([
  ['etag', 'ETag'],
  ['location', 'Location'],
  // A stored thrown 4xx is marked application/problem+json (problem.ts); a handler's own Content-Type is kept too.
  ['content-type', 'Content-Type'],
]);
const WIRE_HEADERS: ReadonlySet<string> = new Set(STORED_HEADERS.values());
/**
 * The only `Content-Type` values a stored response may carry (ADR-0014 amendment 15, PR040-SEC-02 defence in depth):
 * every idempotent 2xx of the contract is JSON and a stored 4xx is a problem document. Anything else is refused when
 * the key is completed and when it is replayed, so a replay can never be sent as `text/html`.
 */
const STORED_CONTENT_TYPE = /^application\/(?:problem\+)?json(?:;[ \t]*charset=utf-8)?$/iu;
/** The version of the sealed response envelope; an envelope of another version is unreadable. */
const ENVELOPE_VERSION = 1;

/** The `ck_idempotency_keys__status` values (catalog C9; enum-checks.test.ts compares them with the migration). */
export const IDEMPOTENCY_KEY_STATUSES = ['IN_PROGRESS', 'COMPLETED'] as const;
export type IdempotencyKeyStatus = (typeof IDEMPOTENCY_KEY_STATUSES)[number];
const IN_PROGRESS: IdempotencyKeyStatus = 'IN_PROGRESS';
const COMPLETED: IdempotencyKeyStatus = 'COMPLETED';

/** A 2xx or a 4xx other than 429 is stored; a 5xx, a 429 (and anything else) releases the key (EC-A30). */
export const isStoredStatus = (status: number): boolean =>
  (status >= 200 && status < 300) || (status >= 400 && status < 500 && status !== 429);

export interface IdempotencyClaim {
  readonly id: string;
  /** The row version this request owns (a lease takeover bumps it). */
  readonly version: number;
  readonly scopeHash: Uint8Array<ArrayBuffer>;
}

export type BeginOutcome =
  | { readonly kind: 'execute'; readonly claim: IdempotencyClaim }
  | { readonly kind: 'replay'; readonly result: RouteResult }
  /** A stored thrown 4xx: the tx slot rethrows `error` (problem.ts). */
  | { readonly kind: 'replay-problem'; readonly error: RenderedProblemError }
  | { readonly kind: 'reused' }
  | { readonly kind: 'in-progress' }
  /** An anonymous caller without a client network: no scope can be formed (scope.ts, code review n6). */
  | { readonly kind: 'unscoped' };

export interface BeginInput {
  readonly request: IdempotencyRequest;
  readonly principal: Principal;
  /** The client IP from the trusted proxy chain (the scope of an anonymous route). */
  readonly clientIp: string;
  /** The lease of the claim in milliseconds; default {@link IDEMPOTENCY_LEASE_MS}. */
  readonly leaseMs?: number;
}

/** A claim that is no longer this request's (taken over after its lease expired, or deleted): nothing may commit. */
export class IdempotencyClaimLostError extends Error {
  constructor() {
    super('the idempotency claim of this request was lost (lease expired and taken over, or released)');
    this.name = 'IdempotencyClaimLostError';
  }
}

/**
 * Who produced a stored response (code review R3-M1): the route (`handler`: a result it returned, replayed through
 * `send` as returned) or the tx slot (`slot-problem`: a thrown 4xx it rendered once, replayed through the problem
 * handler). Stored inside the sealed envelope (AAD-bound to the scope and key id), never in a column or header a row
 * could carry without the key, and never derived from the Content-Type (ADR-0014 amendment 15).
 */
export type StoredOrigin = 'handler' | 'slot-problem';
const STORED_ORIGINS: ReadonlySet<unknown> = new Set<StoredOrigin>(['handler', 'slot-problem']);

/**
 * The sealed form of a stored response (ADR-0014 amendment 15; D-ARCH-204; PR040-SEC-02, CWE-345): the status, the
 * allow-listed headers (wire names), the origin and the body are authenticated together by the AES-GCM tag; `body` is
 * absent for a response without one (a 202, a 204).
 */
interface StoredEnvelope {
  readonly v: typeof ENVELOPE_VERSION;
  readonly origin: StoredOrigin;
  readonly status: number;
  readonly headers: Readonly<Record<string, string>>;
  readonly body?: unknown;
}

/** Class-only log fields; never the key, the scope hash, the path or a body. */
export type IdempotencyLogFields = Readonly<Record<string, string | number | boolean>>;

export interface IdempotencyLog {
  info(event: string, fields?: IdempotencyLogFields): void;
  warn(event: string, fields?: IdempotencyLogFields): void;
  error(event: string, fields?: IdempotencyLogFields): void;
}

export interface IdempotencyStore {
  begin(db: AppDb, input: BeginInput): Promise<BeginOutcome>;
  /**
   * Completes the claim with `result`. `origin` `slot-problem` marks a problem document the tx slot rendered once for a
   * thrown 4xx (problem.ts); it is sealed inside the encrypted body envelope, so only this port can set it.
   */
  complete(db: AppDb, claim: IdempotencyClaim, result: RouteResult, origin?: StoredOrigin): Promise<void>;
  release(db: AppDb, claim: IdempotencyClaim): Promise<void>;
  /**
   * Extends the lease of an IN_PROGRESS claim this request still owns (conditional on its version); returns the claim at
   * its new version. Throws {@link IdempotencyClaimLostError} when the claim was taken over or released.
   */
  renew(db: AppDb, claim: IdempotencyClaim, leaseMs: number): Promise<IdempotencyClaim>;
  /** Where the tx slot reports a completion or a release it could not write. */
  readonly log: IdempotencyLog;
}

export interface IdempotencyStoreOptions {
  readonly cipher: BodyCipher;
  /** HMAC key of the client network of anonymous scopes (scope.ts). */
  readonly networkKey: Uint8Array;
  readonly log: IdempotencyLog;
  /** Milliseconds since the epoch; default `Date.now` (tests inject a clock). */
  readonly now?: () => number;
}

const sameBytes = (a: Uint8Array, b: Uint8Array): boolean => Buffer.from(a).equals(Buffer.from(b));

function storedHeadersOf(headers: RouteResult['headers']): Record<string, string> {
  const stored: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers ?? {})) {
    const wire = STORED_HEADERS.get(name.toLowerCase());
    if (wire !== undefined && typeof value === 'string') stored[wire] = value;
  }
  return stored;
}

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStoredContentType = (headers: Readonly<Record<string, string>>): boolean => {
  const contentType = headers['Content-Type'];
  return contentType === undefined || STORED_CONTENT_TYPE.test(contentType);
};

/** The headers of an opened envelope: allow-listed wire names with string values and an allowed Content-Type. */
function envelopeHeadersOf(value: unknown): Record<string, string> {
  if (!isRecord(value)) throw new IdempotencyReplayError('stored envelope malformed');
  const headers: Record<string, string> = {};
  for (const [name, header] of Object.entries(value)) {
    if (!WIRE_HEADERS.has(name) || typeof header !== 'string') throw new IdempotencyReplayError('stored envelope malformed');
    headers[name] = header;
  }
  if (!isStoredContentType(headers)) throw new IdempotencyReplayError('stored content type refused');
  return headers;
}

/** The opened envelope of a stored response (ADR-0014 amendment 15); anything else is unreadable. */
function envelopeOf(text: string): StoredEnvelope {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new IdempotencyReplayError('stored envelope malformed');
  }
  if (!isRecord(parsed) || parsed['v'] !== ENVELOPE_VERSION || !STORED_ORIGINS.has(parsed['origin'])) {
    throw new IdempotencyReplayError('stored envelope malformed');
  }
  const status = parsed['status'];
  if (typeof status !== 'number' || !Number.isInteger(status) || !isStoredStatus(status)) {
    throw new IdempotencyReplayError('stored status malformed');
  }
  const envelope: StoredEnvelope = {
    v: ENVELOPE_VERSION,
    origin: parsed['origin'] as StoredOrigin,
    status,
    headers: envelopeHeadersOf(parsed['headers']),
  };
  return Object.hasOwn(parsed, 'body') ? { ...envelope, body: parsed['body'] } : envelope;
}

/** The clear `response_headers` copy names exactly the sealed headers with the same values. */
function sameHeaders(clear: unknown, sealed: Readonly<Record<string, string>>): boolean {
  if (!isRecord(clear)) return false;
  const names = Object.keys(clear);
  return names.length === Object.keys(sealed).length && names.every((name) => Object.hasOwn(sealed, name) && clear[name] === sealed[name]);
}

const EXISTING = {
  id: true,
  version: true,
  fingerprint: true,
  status: true,
  leaseUntil: true,
  expiresAt: true,
  responseStatus: true,
  responseHeaders: true,
  responseBody: true,
  responseBodyKeyId: true,
} as const;

type ExistingRow = Prisma.IdempotencyKeyGetPayload<{ select: typeof EXISTING }>;

export function createIdempotencyStore(options: IdempotencyStoreOptions): IdempotencyStore {
  const { cipher, networkKey, log } = options;
  const now = options.now ?? Date.now;

  /**
   * The replay of a COMPLETED row: a route's result as returned, or the slot-rendered problem document to send again
   * (only for a row whose sealed envelope says `slot-problem`, R3-M1). Unreadable rows are logged (n4).
   */
  function replayOf(row: ExistingRow, scopeHash: Uint8Array<ArrayBuffer>): BeginOutcome {
    try {
      const { result, origin } = readStored(row, scopeHash);
      return origin === 'slot-problem' ? { kind: 'replay-problem', error: replayedProblemOf(result) } : { kind: 'replay', result };
    } catch (error) {
      if (error instanceof IdempotencyReplayError)
        log.error('api.idempotency_replay_unreadable', { error: error.name, reason: error.reason });
      throw error;
    }
  }

  /**
   * The status, the headers and the body come from the opened envelope only (PR040-SEC-02); the clear columns must equal
   * it, so a row whose status or headers were changed without the key is unreadable, never replayed.
   */
  function readStored(row: ExistingRow, scopeHash: Uint8Array<ArrayBuffer>): { result: RouteResult; origin: StoredOrigin } {
    if (row.responseBody === null || row.responseBodyKeyId === null) throw new IdempotencyReplayError('stored response missing');
    const envelope = envelopeOf(cipher.open(scopeHash, { ciphertext: row.responseBody, keyId: row.responseBodyKeyId }));
    if (row.responseStatus !== envelope.status || !sameHeaders(row.responseHeaders, envelope.headers)) {
      throw new IdempotencyReplayError('stored response mismatch');
    }
    const { status, origin } = envelope;
    const headers = { ...envelope.headers, [IDEMPOTENT_REPLAYED_HEADER]: 'true' };
    return { result: Object.hasOwn(envelope, 'body') ? { status, headers, body: envelope.body } : { status, headers }, origin };
  }

  /** What the existing row of a scope answers; `undefined`: claim again (the row is gone or expired). */
  async function decide(
    db: AppDb,
    scopeHash: Uint8Array<ArrayBuffer>,
    fingerprint: Uint8Array<ArrayBuffer>,
    at: number,
    leaseMs: number,
  ): Promise<BeginOutcome | undefined> {
    const keys = systemDelegates(db).idempotencyKey;
    const row = await keys.findUnique({ where: { scopeHash }, select: EXISTING });
    if (row === null) return undefined;
    if (row.expiresAt.getTime() <= at) {
      await keys.deleteMany({ where: { id: row.id, expiresAt: { lte: new Date(at) } } });
      return undefined;
    }
    if (!sameBytes(row.fingerprint, fingerprint)) return { kind: 'reused' };
    if (row.status === COMPLETED) return replayOf(row, scopeHash);
    if (row.leaseUntil.getTime() > at) return { kind: 'in-progress' };
    const taken = await keys.updateManyAndReturn({
      where: { id: row.id, version: row.version, status: IN_PROGRESS },
      data: { leaseUntil: new Date(at + leaseMs) },
      select: { id: true, version: true },
    });
    const owned = taken[0];
    return owned === undefined ? { kind: 'in-progress' } : { kind: 'execute', claim: { id: owned.id, version: owned.version, scopeHash } };
  }

  return Object.freeze({
    log,
    async begin(db: AppDb, { request, principal, clientIp, leaseMs = IDEMPOTENCY_LEASE_MS }: BeginInput): Promise<BeginOutcome> {
      const scope = scopeOf(principal, clientIp, request, networkKey);
      if (scope === undefined) return { kind: 'unscoped' };
      const keys = systemDelegates(db).idempotencyKey;
      // Two rounds: a row that expired or was released between the insert and the read is claimed once more.
      for (let round = 0; round < 2; round += 1) {
        const at = now();
        const inserted = await keys.createManyAndReturn({
          data: [
            serverStamped<Prisma.IdempotencyKeyCreateManyInput>({
              scopeHash: scope.scopeHash,
              scopeOrgId: scope.scopeOrgId,
              actorId: scope.actorId,
              method: request.method,
              path: request.path,
              idemKey: request.key,
              fingerprint: request.fingerprint,
              status: IN_PROGRESS,
              leaseUntil: new Date(at + leaseMs),
              expiresAt: new Date(at + IDEMPOTENCY_TTL_MS),
            }),
          ],
          skipDuplicates: true,
          select: { id: true, version: true },
        });
        const row = inserted[0];
        if (row !== undefined) return { kind: 'execute', claim: { id: row.id, version: row.version, scopeHash: scope.scopeHash } };
        const outcome = await decide(db, scope.scopeHash, request.fingerprint, at, leaseMs);
        if (outcome !== undefined) return outcome;
      }
      // A key deleted twice in a row by concurrent requests: the caller retries like any in-progress answer.
      return { kind: 'in-progress' };
    },

    async complete(db: AppDb, claim: IdempotencyClaim, result: RouteResult, origin: StoredOrigin = 'handler'): Promise<void> {
      if (!isStoredStatus(result.status)) throw new RangeError(`status ${String(result.status)} is never stored`);
      if (origin === 'slot-problem' && result.body === undefined) throw new RangeError('a slot-rendered problem has a body');
      const headers = storedHeadersOf(result.headers);
      if (!isStoredContentType(headers)) throw new RangeError('a Content-Type other than JSON or problem+JSON is never stored');
      // One envelope is sealed, with or without a body: status, headers, origin and body are all covered by the AES-GCM
      // tag (PR040-SEC-02; R3-M1); the clear status and headers are informational copies of it.
      const envelope: StoredEnvelope = {
        v: ENVELOPE_VERSION,
        origin,
        status: result.status,
        headers,
        ...(result.body === undefined ? {} : { body: result.body }),
      };
      const sealed = cipher.seal(claim.scopeHash, JSON.stringify(envelope));
      const { count } = await systemDelegates(db).idempotencyKey.updateMany({
        where: { id: claim.id, version: claim.version, status: IN_PROGRESS },
        data: {
          status: COMPLETED,
          responseStatus: result.status,
          responseHeaders: headers,
          responseBody: sealed.ciphertext,
          responseBodyKeyId: sealed.keyId,
        },
      });
      if (count !== 1) throw new IdempotencyClaimLostError();
    },

    async renew(db: AppDb, claim: IdempotencyClaim, leaseMs: number): Promise<IdempotencyClaim> {
      const renewed = await systemDelegates(db).idempotencyKey.updateManyAndReturn({
        where: { id: claim.id, version: claim.version, status: IN_PROGRESS },
        data: { leaseUntil: new Date(now() + leaseMs) },
        select: { version: true },
      });
      const row = renewed[0];
      if (row === undefined) throw new IdempotencyClaimLostError();
      return { ...claim, version: row.version };
    },

    async release(db: AppDb, claim: IdempotencyClaim): Promise<void> {
      await systemDelegates(db).idempotencyKey.deleteMany({ where: { id: claim.id, version: claim.version, status: IN_PROGRESS } });
    },
  });
}
