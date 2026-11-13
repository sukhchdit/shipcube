// The shared anonymous principal cannot be changed by a handler, and an unknown credential reads as anonymous (TASK-020).
import { describe, expect, it } from '@jest/globals';
import type { Response } from 'express';

import { ANONYMOUS, credentialsReadOf, markCredentialsRead, principalOf, readonlySet, setPrincipal } from './route-state.js';

const response = (): Response => ({ locals: {} }) as unknown as Response;

describe('[PR32-SEC-15] ANONYMOUS is deep-frozen', () => {
  it('has a frozen principal and a permission view without mutators', () => {
    expect(Object.isFrozen(ANONYMOUS)).toBe(true);
    expect(Object.isFrozen(ANONYMOUS.permissions)).toBe(true);
    expect(ANONYMOUS.permissions.size).toBe(0);
    expect('add' in ANONYMOUS.permissions).toBe(false);
    expect('delete' in ANONYMOUS.permissions).toBe(false);
    expect('clear' in ANONYMOUS.permissions).toBe(false);
  });

  it('refuses a mutation through Set.prototype (the backing set is unreachable)', () => {
    const view: unknown = ANONYMOUS.permissions;
    expect(() => Set.prototype.add.call(view as Set<string>, 'shipment:read')).toThrow(TypeError);
    expect(ANONYMOUS.permissions.has('shipment:read')).toBe(false);
  });
});

describe('readonlySet', () => {
  it('reads like a Set of its values and does not follow the source iterable', () => {
    const source = new Set(['a', 'b']);
    const view = readonlySet(source);
    source.add('c');
    expect(view.size).toBe(2);
    expect(view.has('a')).toBe(true);
    expect(view.has('c')).toBe(false);
    expect([...view]).toEqual(['a', 'b']);
    expect([...view.keys()]).toEqual(['a', 'b']);
    expect([...view.values()]).toEqual(['a', 'b']);
    expect([...view.entries()]).toEqual([
      ['a', 'a'],
      ['b', 'b'],
    ]);
    const seen: [string, string, ReadonlySet<string>][] = [];
    view.forEach((value, again, set) => seen.push([value, again, set]));
    expect(seen).toEqual([
      ['a', 'a', view],
      ['b', 'b', view],
    ]);
  });
});

describe('[R2-n3] principalOf fails closed', () => {
  it('reads a missing principal as ANONYMOUS', () => {
    expect(principalOf(response())).toBe(ANONYMOUS);
  });

  it('reads a principal with an unknown credential kind as ANONYMOUS', () => {
    const res = response();
    setPrincipal(res, { ...ANONYMOUS, credential: 'bearer' } as unknown as typeof ANONYMOUS);
    expect(principalOf(res)).toBe(ANONYMOUS);
  });

  it('returns a principal with a known credential kind as set', () => {
    const res = response();
    const guest = { ...ANONYMOUS, credential: 'quote-token' as const, guestTokenHash: 'a'.repeat(64) };
    setPrincipal(res, guest);
    expect(principalOf(res)).toBe(guest);
  });
});

describe('[D-ARCH-109] the authn slot records that it read the credentials', () => {
  it('is false on a fresh response and true once marked, only for that response', () => {
    const res = response();
    const other = response();
    expect(credentialsReadOf(res)).toBe(false);
    markCredentialsRead(res);
    expect(credentialsReadOf(res)).toBe(true);
    expect(credentialsReadOf(other)).toBe(false);
  });

  it('reads only the boolean true as marked (a truthy value a handler wrote is not)', () => {
    const res = { locals: { routeCredentialsRead: 'yes' } } as unknown as Response;
    expect(credentialsReadOf(res)).toBe(false);
  });
});
