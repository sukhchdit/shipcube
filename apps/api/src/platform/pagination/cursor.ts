/**
 * Signed pagination cursors (REQ-API-007; ADR-0016 item 5; api/README.md §4; ADR-0018 key register row `CURSOR_KEY`:
 * HMAC-SHA-256, 30 d rotation with dual verify for 1 h).
 *
 * A cursor is `base64url(payload) "." base64url(mac)`. The payload is the page boundary (`{ v, x, i, s? }`: format
 * version, expiry in Unix seconds, the id of the last row, optionally its sort-key values) and the MAC is
 * HMAC-SHA-256(key, "platform-cursor\0v1\0" ‖ binding ‖ "\0" ‖ base64url(payload)). The binding is not in the cursor:
 * it is recomputed from the request (operation, caller, sort and filters; `parseListQuery`), so a cursor presented
 * for another organisation, caller, sort or filter set fails the MAC exactly like a tampered one (AT-US-037-10). The
 * payload is signed, not encrypted: it only holds what the caller already received on the previous page.
 *
 * Verification: the MAC is checked first (constant-time) under the current key, then under the previous key if one
 * is configured (dual verify during rotation); only an authentic payload is parsed, and then its expiry is checked.
 * Every failure is the same 400 `INVALID_CURSOR` with the catalogue detail, so a client cannot tell a forged cursor
 * from an expired or foreign one. Cursors live at most one hour (`MAX_CURSOR_TTL_MS`), the dual-verify window of the
 * register, so a key retired after that window never strands a live cursor (D-TASK045-02). The lifetime is also
 * enforced at decode: an authentic cursor whose expiry lies further ahead than the codec's lifetime (plus
 * `CURSOR_CLOCK_SKEW_MS` between instances) is refused, whoever signed it (PR045-SEC-05).
 *
 * Size: the sort-key values are bounded tokens (at most `MAX_CURSOR_KEYS` safe integers or strings of
 * `MAX_CURSOR_KEY_LENGTH` characters of `[0-9A-Za-z :.+_-]`), so the largest cursor fits `MAX_CURSOR_LENGTH` whatever
 * the row data (PR045-SEC-04); cursor.test.ts pins the largest case.
 *
 * Key bytes follow the audit privacy pattern (packages/audit privacy.ts): a deployed key is its decoded material
 * (the configuration guarantees at least 32 bytes); a `local-only-*` marker (APP_ENV local/test only; the placeholder
 * guard refuses it elsewhere) is stretched to 32 bytes with SHA-256 under a context label of this purpose.
 */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';

import { AppError } from '@platform/shared';

/** The structural shape of `@platform/config`'s `KeyVersion` this module needs. */
export interface CursorKeyVersion {
  readonly keyId: string;
  readonly localOnly: boolean;
  readonly material: { reveal(): Uint8Array };
}

/** The page boundary a cursor carries. */
export interface CursorPosition {
  /** The id (tie-breaker column value) of the last row of the page. */
  readonly id: string;
  /** The sort-key values of that row, for consumers that compare keys themselves (raw SQL keyset); optional. */
  readonly keys?: readonly (string | number)[];
}

export interface CursorCodec {
  /** A cursor for `position` bound to `binding`; throws (a programming error) for an id or keys out of bounds. */
  encode(binding: string, position: CursorPosition): string;
  /** The position of an authentic, unexpired cursor issued for `binding`; anything else throws 400 INVALID_CURSOR. */
  decode(binding: string, cursor: string): CursorPosition;
}

export interface CursorCodecOptions {
  /** `CURSOR_KEY`. */
  readonly current: CursorKeyVersion;
  /** `CURSOR_KEY_PREVIOUS`, during rotation. */
  readonly previous?: CursorKeyVersion | undefined;
  /** Lifetime of a new cursor; default and maximum `MAX_CURSOR_TTL_MS`. */
  readonly ttlMs?: number;
  /** Clock (ms since the epoch); default `Date.now`. */
  readonly now?: () => number;
}

/** The openapi `Cursor` parameter's `maxLength`. */
export const MAX_CURSOR_LENGTH = 512;
/** One hour: the dual-verify window of `CURSOR_KEY` (ADR-0018 register). */
export const MAX_CURSOR_TTL_MS = 60 * 60 * 1000;
/** Bounds of the optional sort-key values: one per sort term (`MAX_SORT_TERMS`), each a bounded token. */
export const MAX_CURSOR_KEYS = 4;
export const MAX_CURSOR_KEY_LENGTH = 48;
/** Timestamp text (`2026-11-21 12:00:00.123456+00`), integers as text, UUIDs: no quotes, escapes or non-ASCII. */
const KEY_TEXT = new RegExp(`^[0-9A-Za-z :.+_-]{1,${String(MAX_CURSOR_KEY_LENGTH)}}$`);
/** Tolerated clock difference between the instance that issued a cursor and the one that decodes it. */
export const CURSOR_CLOCK_SKEW_MS = 60_000;
/** An id is a UUID or another opaque token of URL-safe characters. */
const CURSOR_ID = /^[A-Za-z0-9_-]{1,64}$/;
const BASE64URL = /^[A-Za-z0-9_-]+$/;
const MAC_BYTES = 32;
const FORMAT_VERSION = 1;
const MAC_CONTEXT = `platform-cursor\0v${String(FORMAT_VERSION)}\0`;
const LOCAL_KEY_CONTEXT = 'platform-cursor-local-key';

/** The HMAC key bytes of one key version (see the header for `local-only-*` markers). */
export function cursorKeyBytes(version: CursorKeyVersion): Uint8Array {
  const material = version.material.reveal();
  if (!version.localOnly) return material;
  return new Uint8Array(createHash('sha256').update(`${LOCAL_KEY_CONTEXT}\0${version.keyId}\0`, 'utf8').update(material).digest());
}

const invalidCursor = (): AppError => new AppError('INVALID_CURSOR');

function isKeyValue(value: unknown): value is string | number {
  return (typeof value === 'string' && KEY_TEXT.test(value)) || (typeof value === 'number' && Number.isSafeInteger(value));
}

function validKeys(keys: readonly unknown[]): boolean {
  return keys.length <= MAX_CURSOR_KEYS && keys.every(isKeyValue);
}

interface Payload {
  readonly v: number;
  readonly x: number;
  readonly i: string;
  readonly s?: readonly (string | number)[];
}

/** The payload of an authentic cursor, or undefined when its shape is not exactly the one `encode` writes. */
function readPayload(text: string): Payload | undefined {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const allowed = new Set(['v', 'x', 'i', 's']);
  if (Object.keys(record).some((key) => !allowed.has(key))) return undefined;
  const { v, x, i, s } = record;
  if (v !== FORMAT_VERSION || typeof x !== 'number' || !Number.isSafeInteger(x) || typeof i !== 'string' || !CURSOR_ID.test(i)) {
    return undefined;
  }
  if (s !== undefined && !(Array.isArray(s) && validKeys(s))) return undefined;
  return s === undefined ? { v, x, i } : { v, x, i, s: s as readonly (string | number)[] };
}

export function createCursorCodec(options: CursorCodecOptions): CursorCodec {
  const ttlMs = options.ttlMs ?? MAX_CURSOR_TTL_MS;
  if (!Number.isInteger(ttlMs) || ttlMs < 1_000 || ttlMs > MAX_CURSOR_TTL_MS) {
    throw new RangeError(`cursor ttlMs must be an integer in 1000..${String(MAX_CURSOR_TTL_MS)}`);
  }
  const now = options.now ?? Date.now;
  const keys = [options.current, ...(options.previous === undefined ? [] : [options.previous])].map(cursorKeyBytes);
  const [signingKey] = keys;
  if (signingKey === undefined) throw new Error('no cursor key');

  const macOf = (key: Uint8Array, binding: string, encodedPayload: string): Buffer =>
    createHmac('sha256', key).update(`${MAC_CONTEXT}${binding}\0${encodedPayload}`, 'utf8').digest();

  return Object.freeze({
    encode(binding: string, position: CursorPosition): string {
      if (!CURSOR_ID.test(position.id)) throw new Error('cursor position id is not a URL-safe token of at most 64 characters');
      if (position.keys !== undefined && !validKeys(position.keys)) throw new Error('cursor position keys are out of bounds');
      const payload: Payload = {
        v: FORMAT_VERSION,
        x: Math.floor((now() + ttlMs) / 1000),
        i: position.id,
        ...(position.keys === undefined ? {} : { s: [...position.keys] }),
      };
      const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      const cursor = `${encodedPayload}.${macOf(signingKey, binding, encodedPayload).toString('base64url')}`;
      if (cursor.length > MAX_CURSOR_LENGTH) throw new Error(`cursor exceeds ${String(MAX_CURSOR_LENGTH)} characters`);
      return cursor;
    },

    decode(binding: string, cursor: string): CursorPosition {
      if (cursor.length === 0 || cursor.length > MAX_CURSOR_LENGTH) throw invalidCursor();
      const parts = cursor.split('.');
      const [encodedPayload, encodedMac] = parts;
      if (parts.length !== 2 || encodedPayload === undefined || encodedMac === undefined) throw invalidCursor();
      if (!BASE64URL.test(encodedPayload) || !BASE64URL.test(encodedMac)) throw invalidCursor();
      const mac = Buffer.from(encodedMac, 'base64url');
      // Canonical encoding only: a MAC with trailing bits set re-encodes differently and is refused.
      if (mac.length !== MAC_BYTES || mac.toString('base64url') !== encodedMac) throw invalidCursor();
      const authentic = keys.some((key) => timingSafeEqual(macOf(key, binding, encodedPayload), mac));
      if (!authentic) throw invalidCursor();
      const payload = readPayload(Buffer.from(encodedPayload, 'base64url').toString('utf8'));
      const at = now();
      if (payload === undefined || payload.x * 1000 <= at || payload.x * 1000 > at + ttlMs + CURSOR_CLOCK_SKEW_MS) throw invalidCursor();
      return payload.s === undefined ? { id: payload.i } : { id: payload.i, keys: payload.s };
    },
  });
}
