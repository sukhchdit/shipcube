// Credential presence (D-ARCH-107 (5), D-ARCH-109, ADR-0008 am. 4/5; TASK-020): an Authorization header (session), a
// refresh cookie (refresh-cookie) or an X-Quote-Token header (quote-token); presence only, never validity. A route reads
// only the kinds it declares.
import { describe, expect, it } from '@jest/globals';

import { CREDENTIAL_HEADER_NAMES, PRESENTABLE_KINDS, presentedKinds, presentsCredential, REFRESH_COOKIE_NAMES } from './credentials.js';

describe('[D-ARCH-107] presentsCredential', () => {
  it('[D-ARCH-107] no header, an empty Authorization or X-Quote-Token, or unrelated cookies present no credential', () => {
    expect(presentsCredential({})).toBe(false);
    expect(presentsCredential({ authorization: '  ', 'x-quote-token': '' })).toBe(false);
    expect(presentsCredential({ cookie: 'theme=dark; rt_web=x; __Host-rt_webx=y' })).toBe(false);
    expect(presentsCredential({ cookie: '' })).toBe(false);
    expect(presentsCredential({ 'x-quote-token': ['', ' '] })).toBe(false);
  });

  it.each<[string, Record<string, string | string[]>]>([
    ['a bearer Authorization header', { authorization: 'Bearer x' }],
    ['any Authorization scheme', { authorization: 'Basic x' }],
    ['an X-Quote-Token header', { 'x-quote-token': 'abc' }],
    ['a repeated X-Quote-Token header', { 'x-quote-token': ['', 'abc'] }],
    ['the web refresh cookie among others', { cookie: 'theme=dark; __Host-rt_web=x' }],
    ['the admin refresh cookie without a value', { cookie: '__Host-rt_admin' }],
    ['a refresh cookie in a second Cookie header', { cookie: ['theme=dark', ' __Host-rt_web=x'] }],
  ])('[D-ARCH-107] %s is a credential', (_label, headers) => {
    expect(presentsCredential(headers)).toBe(true);
  });

  it('[D-ARCH-107] the refresh cookie names are the contract schemes refreshCookieWeb and refreshCookieAdmin, frozen', () => {
    expect(REFRESH_COOKIE_NAMES).toEqual(['__Host-rt_web', '__Host-rt_admin']);
    expect(Object.isFrozen(REFRESH_COOKIE_NAMES)).toBe(true);
  });
});

describe('[D-ARCH-109] presentedKinds', () => {
  const ALL = { authorization: 'Bearer x', cookie: 'theme=dark; __Host-rt_admin=y', 'x-quote-token': 'q' };

  it('[D-ARCH-109] the presentable kinds are session, refresh-cookie and quote-token, frozen, in canonical order', () => {
    expect(PRESENTABLE_KINDS).toEqual(['session', 'refresh-cookie', 'quote-token']);
    expect(Object.isFrozen(PRESENTABLE_KINDS)).toBe(true);
  });

  it.each<[string, Record<string, string | string[]>, readonly string[]]>([
    ['no header', {}, []],
    ['a bearer Authorization header', { authorization: 'Bearer x' }, ['session']],
    ['a blank Authorization header', { authorization: ' ' }, []],
    ['the web refresh cookie', { cookie: '__Host-rt_web=x' }, ['refresh-cookie']],
    ['an unrelated cookie', { cookie: 'rt_web=x; theme=dark' }, []],
    ['an X-Quote-Token header', { 'x-quote-token': 'q' }, ['quote-token']],
    ['all three', ALL, ['session', 'refresh-cookie', 'quote-token']],
  ])('[D-ARCH-109] without a declared set, %s presents %j', (_label, headers, kinds) => {
    const presented = presentedKinds(headers);
    expect(presented).toEqual(kinds);
    expect(Object.isFrozen(presented)).toBe(true);
  });

  it.each<[readonly string[], readonly string[]]>([
    [['anonymous'], []],
    [['signature'], []],
    [['session'], ['session']],
    [['refresh-cookie'], ['refresh-cookie']],
    [['anonymous', 'session'], ['session']],
    [
      ['session', 'quote-token'],
      ['session', 'quote-token'],
    ],
  ])('[D-ARCH-109] a route declaring %j counts only %j of three presented credentials', (declared, kinds) => {
    expect(presentedKinds(ALL, declared)).toEqual(kinds);
  });

  it('[D-ARCH-109] the header of an undeclared kind is never read (not parsed, not counted)', () => {
    const read: string[] = [];
    const recording = new Proxy<Record<string, string>>(ALL, {
      get: (target, name): string | undefined => {
        read.push(String(name));
        return typeof name === 'string' ? target[name] : undefined;
      },
    });
    expect(presentedKinds(recording, ['anonymous'])).toEqual([]);
    expect(read).toEqual([]);
    expect(presentedKinds(recording, ['refresh-cookie'])).toEqual(['refresh-cookie']);
    expect(read).toEqual(['cookie']);
    read.length = 0;
    expect(presentedKinds(recording, ['session', 'quote-token'])).toEqual(['session', 'quote-token']);
    expect(read).toEqual(['authorization', 'x-quote-token']);
  });
});

describe('[D-ARCH-113] CREDENTIAL_HEADER_NAMES', () => {
  it('[D-ARCH-113] is the frozen lower-case list of every credential or proof header', () => {
    expect(CREDENTIAL_HEADER_NAMES).toEqual([
      'authorization',
      'cookie',
      'x-csrf-token',
      'x-reauth-proof',
      'x-quote-token',
      'stripe-signature',
      'x-mock-signature',
      'x-carrier-signature',
    ]);
    expect(Object.isFrozen(CREDENTIAL_HEADER_NAMES)).toBe(true);
    for (const name of CREDENTIAL_HEADER_NAMES) expect(name).toBe(name.toLowerCase());
  });

  it('[D-ARCH-113] the presence readers read only headers from the list', () => {
    const read = new Set<string>();
    const recording = new Proxy<Record<string, string>>(
      { authorization: 'Bearer x', cookie: '__Host-rt_web=x', 'x-quote-token': 'q', 'x-other': 'o' },
      {
        get: (target, name): string | undefined => {
          if (typeof name !== 'string') return undefined;
          read.add(name);
          return target[name];
        },
      },
    );
    expect(presentedKinds(recording)).toEqual(['session', 'refresh-cookie', 'quote-token']);
    expect([...read].every((name) => (CREDENTIAL_HEADER_NAMES as readonly string[]).includes(name))).toBe(true);
    expect([...read].sort()).toEqual(['authorization', 'cookie', 'x-quote-token']);
  });
});
