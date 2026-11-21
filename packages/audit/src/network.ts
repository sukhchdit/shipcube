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

/** The address without its IPv6 zone (`fe80::1%eth0` -> `fe80::1`). */
const withoutZone = (ip: string): string => ip.replace(/%.*$/su, '');

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
 * The IPv4 address an IPv4-mapped IPv6 address (::ffff:0:0/96) carries, else the input (PR61-SEC-12, CWE-1289). Decided
 * on the parsed groups, so every spelling is unmapped: the dotted tail, the hex tail (`::ffff:7f00:1`), the expanded
 * forms (`0:0:0:0:0:ffff:...`), upper case and zero-padded groups.
 */
function unmapped(ip: string): string {
  if (!isIPv6(ip)) return ip;
  const groups = ipv6Groups(ip);
  if (!groups.slice(0, 5).every((group) => group === 0) || groups[5] !== 0xffff) return ip;
  const [high = 0, low = 0] = groups.slice(6);
  return [high >> 8, high & 0xff, low >> 8, low & 0xff].join('.');
}

/**
 * The coarse network of a client IP in `inet` text form: `a.b.c.0/24` or `xxxx:xxxx:xxxx::/48`. Returns `null` for
 * anything that is not an IP address, so a malformed value never reaches the database.
 */
export function coarseNetwork(ip: string): string | null {
  const address = unmapped(withoutZone(ip));
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

/** The canonical text of a client IP (IPv4-mapped addresses unmapped, zone removed, IPv6 in RFC 5952 form), or `null`. */
export function canonicalIp(ip: string): string | null {
  const address = unmapped(withoutZone(ip));
  if (isIPv4(address)) return address;
  return isIPv6(address) ? rfc5952(ipv6Groups(address)) : null;
}

/**
 * The RFC 5952 text of eight IPv6 groups (PR61-SEC-06): lower-case hex without leading zeros, the longest run of two or
 * more zero groups (the first, on a tie) compressed to `::`. Every spelling of one address hashes alike (`ip_hash`).
 */
function rfc5952(groups: readonly number[]): string {
  let bestStart = -1;
  let bestLength = 1;
  for (let start = 0; start < groups.length; start += 1) {
    let length = 0;
    while (start + length < groups.length && groups[start + length] === 0) length += 1;
    if (length > bestLength) {
      bestStart = start;
      bestLength = length;
    }
    start += length;
  }
  const hex = groups.map((group) => group.toString(16));
  if (bestStart === -1) return hex.join(':');
  return `${hex.slice(0, bestStart).join(':')}::${hex.slice(bestStart + bestLength).join(':')}`;
}
