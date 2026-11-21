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

describe('[PR61-SEC-06] canonicalIp writes IPv6 in RFC 5952 form', () => {
  it('every spelling of one address has one canonical text (so one ip_hash and one vault row)', () => {
    const spellings = ['2001:db8::1', '2001:0db8:0000:0000:0000:0000:0000:0001', '2001:DB8:0:0:0:0:0:1', '2001:db8:0::0:1'];
    expect(new Set(spellings.map((ip) => canonicalIp(ip)))).toEqual(new Set(['2001:db8::1']));
  });

  it('compresses the longest zero run (the first on a tie), never a single zero group', () => {
    expect(canonicalIp('2001:db8:0:0:1:0:0:1')).toBe('2001:db8::1:0:0:1');
    expect(canonicalIp('2001:db8:0:1:0:0:0:1')).toBe('2001:db8:0:1::1');
    expect(canonicalIp('2001:db8:0:1:1:1:1:1')).toBe('2001:db8:0:1:1:1:1:1');
    expect(canonicalIp('::')).toBe('::');
    expect(canonicalIp('::1')).toBe('::1');
    expect(canonicalIp('fe80::1%eth0')).toBe('fe80::1');
    expect(canonicalIp('::ffff:203.0.113.7')).toBe('203.0.113.7');
  });
});

describe('[PR61-SEC-12] every spelling of an IPv4-mapped IPv6 address is unmapped from its parsed groups', () => {
  it.each([
    ['::ffff:127.0.0.1'],
    ['::ffff:7f00:1'],
    ['::ffff:7f00:0001'],
    ['0:0:0:0:0:ffff:127.0.0.1'],
    ['0:0:0:0:0:ffff:7f00:1'],
    ['0000:0000:0000:0000:0000:ffff:7f00:0001'],
    ['::FFFF:7F00:1'],
    ['0::ffff:7f00:1'],
    ['::ffff:127.0.0.1%eth0'],
  ])('%s is the IPv4 address 127.0.0.1 for the coarse network and the canonical IP', (ip) => {
    expect(coarseNetwork(ip)).toBe('127.0.0.0/24');
    expect(canonicalIp(ip)).toBe('127.0.0.1');
  });

  it('unmaps a non-loopback address spelt in hex groups', () => {
    expect(coarseNetwork('::ffff:c633:6409')).toBe('198.51.100.0/24');
    expect(canonicalIp('::ffff:c633:6409')).toBe('198.51.100.9');
  });

  it.each(['::fffe:7f00:1', '::1:ffff:7f00:1', '1::ffff:7f00:1', '::ffff:0:7f00:1', '64:ff9b::7f00:1'])(
    '%s is not IPv4-mapped and stays IPv6',
    (ip) => {
      expect(coarseNetwork(ip)).toMatch(/\/48$/u);
      expect(canonicalIp(ip)).not.toMatch(/^\d+\.\d+\.\d+\.\d+$/u);
    },
  );
});
