// The scope of an idempotency key (TASK-040; api/README §5 "Scope"; ADR-0014 amendment 1; AT-US-038-08).
import { randomUUID } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import type { Principal } from '../routing/define-route.js';
import { ANONYMOUS, readonlySet } from '../routing/route-state.js';
import { clientNetworkOf, scopeOf } from './scope.js';
import { TEST_NETWORK_KEY } from './tests/memory-keys.js';

const ORG_A = '0193a5b2-7c1e-7d4a-9f3b-0000000000a0';
const ORG_B = '0193a5b2-7c1e-7d4a-9f3b-0000000000b0';
const USER_A = '0193a5b2-7c1e-7d4a-9f3b-0000000000a1';
const USER_B = '0193a5b2-7c1e-7d4a-9f3b-0000000000b1';
const GUEST = 'a'.repeat(64);

const session = (actorId: string, orgId: string): Principal => ({
  ...ANONYMOUS,
  credential: 'session',
  authenticated: true,
  actorId,
  orgId,
  permissions: readonlySet([]),
});
const guest = (hash: string): Principal => ({ ...ANONYMOUS, credential: 'quote-token', guestTokenHash: hash });
const request = { key: randomUUID(), method: 'POST', path: '/api/v1/orders' } as const;
const hex = (principal: Principal, ip = '203.0.113.7', req: typeof request | Record<string, string> = request): string =>
  Buffer.from(scopeOf(principal, ip, req as typeof request, TEST_NETWORK_KEY)?.scopeHash ?? new Uint8Array()).toString('hex');

describe('[AT-US-038-08] keys are scoped to the caller', () => {
  it('the same key of two organisations, two users or two guests is two scopes', () => {
    const hashes = [
      hex(session(USER_A, ORG_A)),
      hex(session(USER_B, ORG_B)),
      hex(session(USER_B, ORG_A)),
      hex(guest(GUEST)),
      hex(guest('b'.repeat(64))),
      hex(session(USER_A, '')),
      hex(ANONYMOUS),
    ];
    expect(new Set(hashes).size).toBe(hashes.length);
  });

  it('the scope covers the method, the path and the key; it is deterministic', () => {
    const base = hex(session(USER_A, ORG_A));
    expect(hex(session(USER_A, ORG_A))).toBe(base);
    expect(hex(session(USER_A, ORG_A), undefined, { ...request, method: 'PUT' })).not.toBe(base);
    expect(hex(session(USER_A, ORG_A), undefined, { ...request, path: '/api/v1/orders/1' })).not.toBe(base);
    expect(hex(session(USER_A, ORG_A), undefined, { ...request, key: 'other' })).not.toBe(base);
  });

  it('records the informational organisation and actor; a guest or anonymous caller has no actor', () => {
    expect(scopeOf(session(USER_A, ORG_A), '', request, TEST_NETWORK_KEY)).toMatchObject({
      ownerKind: 'org',
      scopeOrgId: ORG_A,
      actorId: USER_A,
    });
    expect(scopeOf(guest(GUEST), '', request, TEST_NETWORK_KEY)).toMatchObject({ ownerKind: 'guest', scopeOrgId: null, actorId: null });
    expect(scopeOf(session(USER_A, ''), '', request, TEST_NETWORK_KEY)).toMatchObject({ ownerKind: 'actor', actorId: USER_A });
    expect(scopeOf(ANONYMOUS, '203.0.113.7', request, TEST_NETWORK_KEY)).toMatchObject({ ownerKind: 'network', actorId: null });
  });

  it('an anonymous caller is scoped by its client network under the network key (IPv4 /32, IPv6 /64)', () => {
    expect(hex(ANONYMOUS, '203.0.113.7')).not.toBe(hex(ANONYMOUS, '203.0.113.8'));
    expect(hex(ANONYMOUS, '2001:db8:1:2::1')).toBe(hex(ANONYMOUS, '2001:db8:1:2:ffff::9'));
    expect(hex(ANONYMOUS, '2001:db8:1:2::1')).not.toBe(hex(ANONYMOUS, '2001:db8:1:3::1'));
    const other = Buffer.from(
      scopeOf(ANONYMOUS, '203.0.113.7', request, new Uint8Array(32).fill(1))?.scopeHash ?? new Uint8Array(),
    ).toString('hex');
    expect(other).not.toBe(hex(ANONYMOUS, '203.0.113.7'));
  });

  it('[n6] an anonymous caller without a client network (empty or unparsable IP) has no scope; an authenticated one keeps its scope', () => {
    expect(scopeOf(ANONYMOUS, '', request, TEST_NETWORK_KEY)).toBeUndefined();
    expect(scopeOf(ANONYMOUS, 'not-an-ip', request, TEST_NETWORK_KEY)).toBeUndefined();
    expect(scopeOf(session(USER_A, ORG_A), '', request, TEST_NETWORK_KEY)?.ownerKind).toBe('org');
    expect(scopeOf(guest(GUEST), '', request, TEST_NETWORK_KEY)?.ownerKind).toBe('guest');
  });
});

describe('client network', () => {
  it('is the /32 of an IPv4 address (mapped IPv6 included) and the /64 of an IPv6 address; empty for a non-IP', () => {
    expect(clientNetworkOf('203.0.113.7')).toBe('203.0.113.7/32');
    expect(clientNetworkOf('::ffff:203.0.113.7')).toBe('203.0.113.7/32');
    expect(clientNetworkOf('2001:db8:1:2:3:4:5:6')).toBe('2001:db8:1:2::/64');
    expect(clientNetworkOf('2001:db8::1')).toBe('2001:db8:0:0::/64');
    expect(clientNetworkOf('::1')).toBe('0:0:0:0::/64');
    expect(clientNetworkOf('not-an-ip')).toBe('');
  });
});
