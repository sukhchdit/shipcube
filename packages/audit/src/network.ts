/**
 * Client network fields of an audit entry (ADR-0007 amendment 2; data-model §3.4 `ip_coarse`; TASK-025).
 *
 * The raw IP is personal data: it is tokenised into the vault (`ip_token`) and indexed by HMAC (`ip_hash`). Only the
 * network survives in clear: `/24` for IPv4 and `/48` for IPv6, which is not personal data at that granularity and is
 * what `ck_audit_entries__ip_coarse` (`masklen IN (24, 48)`) accepts. An IPv4-mapped IPv6 address (`::ffff:a.b.c.d`,
 * how Node reports IPv4 clients on a dual-stack socket) is treated as the IPv4 address.
 *
 * The IP itself must already come from the trusted proxy chain (EC-A12); resolving `X-Forwarded-For` is the HTTP
 * layer's job, never the writer's.
 */
import { isIPv4, isIPv6 } from 'node:net';

/** The IPv4 address an IPv4-mapped IPv6 address carries, else the input. */
function unmapped(ip: string): string {
  const match = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  return match?.[1] ?? ip;
}

/** The eight 16-bit groups of a valid IPv6 address (zone already removed), dotted-quad tail included. */
function ipv6Groups(ip: string): number[] {
  let text = ip;
  const tail = /(\d{1,3}(?:\.\d{1,3}){3})$/.exec(text);
  if (tail?.[1] !== undefined) {
    const [a, b, c, d] = tail[1].split('.').map(Number) as [number, number, number, number];
    text = `${text.slice(0, -tail[1].length)}${((a << 8) | b).toString(16)}:${((c << 8) | d).toString(16)}`;
  }
  const [head = '', rest] = text.split('::');
  const left = head === '' ? [] : head.split(':');
  const right = rest === undefined || rest === '' ? [] : rest.split(':');
  const fill = rest === undefined ? [] : new Array<string>(8 - left.length - right.length).fill('0');
  return [...left, ...fill, ...right].map((group) => Number.parseInt(group, 16));
}

/**
 * The coarse network of a client IP in `inet` text form: `a.b.c.0/24` or `xxxx:xxxx:xxxx::/48`. Returns `null` for
 * anything that is not an IP address, so a malformed value never reaches the database.
 */
export function coarseNetwork(ip: string): string | null {
  const zoneless = ip.split('%')[0] ?? '';
  const address = unmapped(zoneless);
  if (isIPv4(address)) {
    const [a, b, c] = address.split('.').map(Number) as [number, number, number];
    return `${String(a)}.${String(b)}.${String(c)}.0/24`;
  }
  if (!isIPv6(address)) return null;
  // PostgreSQL's inet output compresses the longest zero run. For a /48 network the five host groups are zero, so the
  // run is the tail plus any zero groups directly before it; the groups up to the last non-zero one stay written out.
  // The text is hashed into the chain, so it must equal what the database prints back (integration-tested).
  const network = ipv6Groups(address).slice(0, 3);
  let last = network.length - 1;
  while (last >= 0 && network[last] === 0) last -= 1;
  return `${network
    .slice(0, last + 1)
    .map((group) => group.toString(16))
    .join(':')}::/48`;
}

/** The canonical text of a client IP (IPv4-mapped addresses unmapped, zone removed, IPv6 lower case), or `null`. */
export function canonicalIp(ip: string): string | null {
  const zoneless = ip.split('%')[0] ?? '';
  const address = unmapped(zoneless);
  if (isIPv4(address)) return address;
  if (isIPv6(address)) return address.toLowerCase();
  return null;
}
