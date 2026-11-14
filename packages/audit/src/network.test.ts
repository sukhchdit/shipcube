import { describe, expect, it } from '@jest/globals';

import { canonicalIp, coarseNetwork } from './network.js';

describe('client network fields (ADR-0007 am. 2: /24 and /48 in clear, the IP itself tokenised)', () => {
  it.each([
    ['203.0.113.77', '203.0.113.0/24'],
    ['10.0.0.1', '10.0.0.0/24'],
    ['::ffff:198.51.100.9', '198.51.100.0/24'],
    ['::FFFF:198.51.100.9', '198.51.100.0/24'],
    ['2001:db8:abcd:12::1', '2001:db8:abcd::/48'],
    ['2001:0db8:0000:0000::1', '2001:db8::/48'],
    ['2001:db8:0:1::1', '2001:db8::/48'],
    ['2001:0:5::9', '2001:0:5::/48'],
    ['0:5:0::1', '0:5::/48'],
    ['::1', '::/48'],
    ['::', '::/48'],
    ['fe80::1%eth0', 'fe80::/48'],
    ['64:ff9b:1::192.0.2.33', '64:ff9b:1::/48'],
    ['2001:db8:a:b:c:d:e:f', '2001:db8:a::/48'],
  ])('coarseNetwork(%s) = %s (PostgreSQL inet output form)', (ip, network) => {
    expect(coarseNetwork(ip)).toBe(network);
  });

  it.each(['', 'not-an-ip', '256.1.1.1', '1.2.3', '2001:db8::g', '::ffff:999.1.1.1'])('refuses %p', (ip) => {
    expect(coarseNetwork(ip)).toBeNull();
    expect(canonicalIp(ip)).toBeNull();
  });

  it('canonical IP: mapped IPv4 unmapped, zone removed, IPv6 lower case', () => {
    expect(canonicalIp('::ffff:198.51.100.9')).toBe('198.51.100.9');
    expect(canonicalIp('FE80::1%eth0')).toBe('fe80::1');
    expect(canonicalIp('203.0.113.77')).toBe('203.0.113.77');
  });
});
