/**
 * Signed cursors (US-037; ADR-0016 item 5; ADR-0018 `CURSOR_KEY`): round trip, binding, tampering, expiry, rotation,
 * canonical encoding and bounds. Key material is generated per run (no secret-shaped literal).
 */
import { createHmac, randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';
import { AppError } from '@platform/shared';

import { createCursorCodec, type CursorKeyVersion, cursorKeyBytes, MAX_CURSOR_LENGTH, MAX_CURSOR_TTL_MS } from './cursor.js';

const keyOf = (keyId: string, bytes: Uint8Array = new Uint8Array(randomBytes(32)), localOnly = false): CursorKeyVersion => ({
  keyId,
  localOnly,
  material: { reveal: () => bytes.slice() },
});

const T0 = Date.UTC(2026, 10, 21, 12, 0, 0);
const BINDING = JSON.stringify(['list', 'listMembers', 'org-a', 'actor-a', '', '-created_at,-id', []]);
const ID = '0193a5b2-7c1e-7d4a-9f3b-000000000b02';

/** The code of the AppError `run` throws. */
function codeOf(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    if (error instanceof AppError) return error.code;
    throw error;
  }
  throw new Error('no error thrown');
}

const flip = (text: string, at: number): string => `${text.slice(0, at)}${text[at] === 'A' ? 'B' : 'A'}${text.slice(at + 1)}`;

describe('cursor codec', () => {
  const current = keyOf('cursor-v2');
  const codec = createCursorCodec({ current, now: () => T0 });

  it('round-trips the position under the same binding', () => {
    const cursor = codec.encode(BINDING, { id: ID });
    expect(codec.decode(BINDING, cursor)).toEqual({ id: ID });
    const withKeys = codec.encode(BINDING, { id: ID, keys: ['1763726400123456', 42] });
    expect(codec.decode(BINDING, withKeys)).toEqual({ id: ID, keys: ['1763726400123456', 42] });
  });

  it('is opaque base64url with a 32-byte MAC and carries no binding (organisation, actor, sort, filters)', () => {
    const cursor = codec.encode(BINDING, { id: ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]{43}$/);
    const payload = Buffer.from(cursor.split('.')[0] ?? '', 'base64url').toString('utf8');
    expect(JSON.parse(payload)).toEqual({ v: 1, x: Math.floor((T0 + MAX_CURSOR_TTL_MS) / 1000), i: ID });
    expect(payload).not.toContain('org-a');
  });

  it('[AT-US-037-10] a cursor issued for one binding (org A) is INVALID_CURSOR under any other (org B, sort, filters, operation)', () => {
    const cursor = codec.encode(BINDING, { id: ID });
    for (const other of [
      JSON.stringify(['list', 'listMembers', 'org-b', 'actor-a', '', '-created_at,-id', []]),
      JSON.stringify(['list', 'listMembers', 'org-a', 'actor-b', '', '-created_at,-id', []]),
      JSON.stringify(['list', 'listMembers', 'org-a', 'actor-a', '', 'created_at,id', []]),
      JSON.stringify(['list', 'listMembers', 'org-a', 'actor-a', '', '-created_at,-id', [['status', 'eq', 'ACTIVE']]]),
      JSON.stringify(['list', 'listInvitations', 'org-a', 'actor-a', '', '-created_at,-id', []]),
    ]) {
      expect(codeOf(() => codec.decode(other, cursor))).toBe('INVALID_CURSOR');
    }
  });

  it('[AT-US-037-03-3] a tampered cursor is INVALID_CURSOR: any changed payload or MAC character, re-signed payload, junk', () => {
    const cursor = codec.encode(BINDING, { id: ID });
    const dot = cursor.indexOf('.');
    for (const at of [0, 5, dot - 1, dot + 1, cursor.length - 2])
      expect(codeOf(() => codec.decode(BINDING, flip(cursor, at)))).toBe('INVALID_CURSOR');
    const forgedPayload = Buffer.from(JSON.stringify({ v: 1, x: 9_999_999_999, i: ID }), 'utf8').toString('base64url');
    expect(codeOf(() => codec.decode(BINDING, `${forgedPayload}${cursor.slice(dot)}`))).toBe('INVALID_CURSOR');
    for (const junk of [
      'tampered',
      '',
      '.',
      'a.b.c',
      `${cursor}.x`,
      `${cursor.slice(0, dot)}.`,
      `${cursor.slice(0, dot)}.%%%`,
      'x'.repeat(MAX_CURSOR_LENGTH + 1),
    ]) {
      expect(codeOf(() => codec.decode(BINDING, junk))).toBe('INVALID_CURSOR');
    }
  });

  it('refuses a non-canonical MAC encoding (trailing bits set) and a MAC of the wrong length', () => {
    const cursor = codec.encode(BINDING, { id: ID });
    const [payload, mac] = cursor.split('.') as [string, string];
    const last = mac.at(-1) ?? 'A';
    const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
    const sibling = alphabet[(alphabet.indexOf(last) & ~3) + ((alphabet.indexOf(last) + 1) & 3)] ?? 'A';
    expect(Buffer.from(`${mac.slice(0, -1)}${sibling}`, 'base64url')).toEqual(Buffer.from(mac, 'base64url'));
    expect(codeOf(() => codec.decode(BINDING, `${payload}.${mac.slice(0, -1)}${sibling}`))).toBe('INVALID_CURSOR');
    expect(codeOf(() => codec.decode(BINDING, `${payload}.${mac.slice(0, -4)}`))).toBe('INVALID_CURSOR');
  });

  it('refuses an authentic payload of an unexpected shape (signed with the same key, as a future format would be)', () => {
    const sign = (payload: unknown): string => {
      const encoded = Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
      const mac = createHmac('sha256', cursorKeyBytes(current)).update(`platform-cursor\0v1\0${BINDING}\0${encoded}`, 'utf8').digest();
      return `${encoded}.${mac.toString('base64url')}`;
    };
    const x = Math.floor(T0 / 1000) + 60;
    expect(codec.decode(BINDING, sign({ v: 1, x, i: ID }))).toEqual({ id: ID });
    for (const payload of [
      { v: 2, x, i: ID },
      { v: 1, x: String(x), i: ID },
      { v: 1, x: x + 0.5, i: ID },
      { v: 1, x, i: 'has space' },
      { v: 1, x, i: 'x'.repeat(65) },
      { v: 1, x, i: ID, s: 'not-a-list' },
      { v: 1, x, i: ID, s: [true] },
      { v: 1, x, i: ID, s: Array.from({ length: 9 }, () => 1) },
      { v: 1, x, i: ID, extra: 1 },
      [1, x, ID],
      null,
    ]) {
      expect(codeOf(() => codec.decode(BINDING, sign(payload)))).toBe('INVALID_CURSOR');
    }
    const notJson = Buffer.from('{not json', 'utf8').toString('base64url');
    const mac = createHmac('sha256', cursorKeyBytes(current)).update(`platform-cursor\0v1\0${BINDING}\0${notJson}`, 'utf8').digest();
    expect(codeOf(() => codec.decode(BINDING, `${notJson}.${mac.toString('base64url')}`))).toBe('INVALID_CURSOR');
  });

  it('[AT-US-037-03-4] an expired cursor is INVALID_CURSOR: valid until the expiry second, refused from it on', () => {
    let now = T0;
    const clocked = createCursorCodec({ current, ttlMs: 10_000, now: () => now });
    const cursor = clocked.encode(BINDING, { id: ID });
    now = T0 + 9_999;
    expect(clocked.decode(BINDING, cursor)).toEqual({ id: ID });
    now = T0 + 10_000;
    expect(codeOf(() => clocked.decode(BINDING, cursor))).toBe('INVALID_CURSOR');
  });

  it('the default lifetime is the one-hour dual-verify window', () => {
    let now = T0;
    const clocked = createCursorCodec({ current, now: () => now });
    const cursor = clocked.encode(BINDING, { id: ID });
    now = T0 + MAX_CURSOR_TTL_MS - 1_000;
    expect(clocked.decode(BINDING, cursor)).toEqual({ id: ID });
    now = T0 + MAX_CURSOR_TTL_MS;
    expect(codeOf(() => clocked.decode(BINDING, cursor))).toBe('INVALID_CURSOR');
  });

  it('rotation: a cursor signed with the previous key verifies while it is configured; new cursors use the current key', () => {
    const previous = keyOf('cursor-v1');
    const old = createCursorCodec({ current: previous, now: () => T0 });
    const cursor = old.encode(BINDING, { id: ID });
    const rotating = createCursorCodec({ current, previous, now: () => T0 });
    expect(rotating.decode(BINDING, cursor)).toEqual({ id: ID });
    expect(codeOf(() => codec.decode(BINDING, cursor))).toBe('INVALID_CURSOR');
    expect(codec.decode(BINDING, rotating.encode(BINDING, { id: ID }))).toEqual({ id: ID });
  });

  it('a local-only marker is stretched to 32 bytes per key id; a deployed key is used as decoded', () => {
    const marker = new Uint8Array(Buffer.from('local-only-cursor', 'utf8'));
    const a = cursorKeyBytes(keyOf('cursor-v1', marker, true));
    expect(a).toHaveLength(32);
    expect(Buffer.from(a)).not.toEqual(Buffer.from(cursorKeyBytes(keyOf('cursor-v2', marker, true))));
    expect(Buffer.from(cursorKeyBytes(keyOf('cursor-v1', marker, true)))).toEqual(Buffer.from(a));
    const deployed = new Uint8Array(randomBytes(32));
    expect(Buffer.from(cursorKeyBytes(keyOf('cursor-v1', deployed)))).toEqual(Buffer.from(deployed));
    const local = createCursorCodec({ current: keyOf('cursor-v1', marker, true), now: () => T0 });
    expect(local.decode(BINDING, local.encode(BINDING, { id: ID }))).toEqual({ id: ID });
  });

  it('encode refuses an id or keys a cursor cannot carry, and a cursor longer than the contract allows', () => {
    expect(() => codec.encode(BINDING, { id: '' })).toThrow('URL-safe token');
    expect(() => codec.encode(BINDING, { id: 'a/b' })).toThrow('URL-safe token');
    expect(() => codec.encode(BINDING, { id: ID, keys: Array.from({ length: 9 }, () => 1) })).toThrow('out of bounds');
    expect(() => codec.encode(BINDING, { id: ID, keys: [Number.NaN] })).toThrow('out of bounds');
    expect(() => codec.encode(BINDING, { id: ID, keys: ['x'.repeat(257)] })).toThrow('out of bounds');
    expect(() => codec.encode(BINDING, { id: ID, keys: ['x'.repeat(250), 'y'.repeat(250)] })).toThrow(
      `exceeds ${String(MAX_CURSOR_LENGTH)}`,
    );
  });

  it('refuses a lifetime above the one-hour dual-verify window or below one second', () => {
    expect(() => createCursorCodec({ current, ttlMs: MAX_CURSOR_TTL_MS + 1 })).toThrow(RangeError);
    expect(() => createCursorCodec({ current, ttlMs: 999 })).toThrow(RangeError);
    expect(() => createCursorCodec({ current, ttlMs: 1_500.5 })).toThrow(RangeError);
    expect(createCursorCodec({ current }).decode(BINDING, createCursorCodec({ current }).encode(BINDING, { id: ID }))).toEqual({ id: ID });
  });

  it('the INVALID_CURSOR error carries only the catalogue detail (nothing about why)', () => {
    let error: unknown;
    try {
      codec.decode(BINDING, 'tampered');
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(AppError);
    expect((error as AppError).toJSON()).toEqual({ code: 'INVALID_CURSOR', status: 400, detail: 'Invalid cursor.' });
  });
});
