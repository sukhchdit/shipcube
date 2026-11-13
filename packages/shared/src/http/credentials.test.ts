// Credential presence (D-ARCH-107 (5), ADR-0008 am. 4; TASK-020): an Authorization header, a refresh cookie or an
// X-Quote-Token header; presence only, never validity.
import { describe, expect, it } from '@jest/globals';

import { presentsCredential, REFRESH_COOKIE_NAMES } from './credentials.js';

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
