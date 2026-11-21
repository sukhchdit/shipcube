/**
 * The scope of an idempotency key (api/README §5 "Scope"; ADR-0014 amendments 1 and 4, threat model R-05 / T-79;
 * data-model §6.2 `scope_hash`; AT-US-038-08; TASK-040). Pure: no I/O.
 *
 * `scope_hash` = SHA-256 of UTF-8(JCS([version, owner kind, owner, actor scope, actor, method, path, key])) where the
 * owner is, in this order: the active organisation; else the guest-token hash; else, for an authenticated actor with
 * no organisation, the actor alone; else (an anonymous route) HMAC-SHA256 of the client network (IPv4 /32, IPv6 /64)
 * under the scope network key. The JCS array makes the encoding unambiguous (no concatenation collisions). The same key
 * value of two organisations, two users or two guests is therefore two independent scopes (EC-A29), and a stored body
 * is decrypted only for a request of the same scope (its AAD carries hex(scope_hash), body-cipher.ts).
 *
 * The client network is keyed (never a bare SHA-256): `idem_key` is stored in clear, so an unkeyed hash of an IPv4
 * address could be reversed by enumerating 2^32 candidates.
 */
import { createHash, createHmac } from 'node:crypto';

import { canonicalIp, jcs } from '@platform/audit';

import type { Principal } from '../routing/define-route.js';
import type { IdempotencyRequest } from './request.js';

/** Bumped if the encoding ever changes (an old row then simply never matches; it expires within 24 h). */
const SCOPE_VERSION = 'idempotency-scope-v1';

export type ScopeOwnerKind = 'org' | 'guest' | 'actor' | 'network';

export interface IdempotencyScope {
  /** SHA-256 of the scope (32 bytes): `idempotency_keys.scope_hash`. */
  readonly scopeHash: Uint8Array<ArrayBuffer>;
  readonly ownerKind: ScopeOwnerKind;
  /** `scope_org_id` (informational), or null. */
  readonly scopeOrgId: string | null;
  /** `actor_id`, or null for a request without an actor (guest, anonymous). */
  readonly actorId: string | null;
}

const expandIpv6 = (canonical: string): string[] => {
  const [head = '', tail] = canonical.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = tail === undefined || tail === '' ? [] : tail.split(':');
  const fill = tail === undefined ? [] : new Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right];
};

/**
 * The client network of an IP: `a.b.c.d/32` for IPv4 (an IPv4-mapped IPv6 address counts as IPv4) and the /64 prefix
 * `g0:g1:g2:g3::/64` for IPv6; `''` for anything that is not an IP address.
 */
export function clientNetworkOf(ip: string): string {
  const canonical = canonicalIp(ip);
  if (canonical === null) return '';
  if (!canonical.includes(':')) return `${canonical}/32`;
  return `${expandIpv6(canonical).slice(0, 4).join(':')}::/64`;
}

function ownerOf(principal: Principal, clientIp: string, networkKey: Uint8Array): readonly [ScopeOwnerKind, string] | undefined {
  if (principal.orgId !== '') return ['org', principal.orgId.toLowerCase()];
  if (principal.guestTokenHash !== '') return ['guest', principal.guestTokenHash];
  if (principal.actorId !== '') return ['actor', ''];
  const network = clientNetworkOf(clientIp);
  // No client network (an empty or unparsable req.ip): no scope, never one scope shared by every anonymous caller.
  if (network === '') return undefined;
  return ['network', createHmac('sha256', networkKey).update(network, 'utf8').digest('hex')];
}

/**
 * The scope of `request` for this caller (see the header), or `undefined` for an anonymous caller without a client
 * network (code review n6): an empty or unparsable `req.ip` (a misconfigured trust proxy; TASK-041 guards it) must not
 * put every anonymous caller in one scope, where one caller's key could replay another's stored response.
 */
export function scopeOf(
  principal: Principal,
  clientIp: string,
  request: Pick<IdempotencyRequest, 'key' | 'method' | 'path'>,
  networkKey: Uint8Array,
): IdempotencyScope | undefined {
  const owned = ownerOf(principal, clientIp, networkKey);
  if (owned === undefined) return undefined;
  const [ownerKind, owner] = owned;
  const actor = principal.actorId.toLowerCase();
  const canonical = jcs([SCOPE_VERSION, ownerKind, owner, principal.actorScope, actor, request.method, request.path, request.key]);
  return Object.freeze({
    scopeHash: new Uint8Array(createHash('sha256').update(canonical, 'utf8').digest()),
    ownerKind,
    scopeOrgId: principal.orgId === '' ? null : principal.orgId.toLowerCase(),
    actorId: actor === '' ? null : actor,
  });
}
