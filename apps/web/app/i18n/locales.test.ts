import { describe, expect, it } from '@jest/globals';

import { detectLocale, isLocale, localeFromLanguageTag, localeFromPathname, serializeLocaleCookie } from './locales';

describe('locale detection (DR-A18, ADR-0026 am. 4)', () => {
  it('prefers the lng cookie over the browser languages', () => {
    expect(detectLocale({ cookie: 'a=b; lng=fr; c=d', languages: ['es-ES'] })).toBe('fr');
  });

  it('ignores a cookie value that is not a supported locale', () => {
    expect(detectLocale({ cookie: 'lng=de', languages: ['es'] })).toBe('es');
    expect(detectLocale({ cookie: 'xlng=fr', languages: [] })).toBe('en');
  });

  it('takes the first supported language of the browser list and only its language subtag', () => {
    expect(detectLocale({ cookie: '', languages: ['de-DE', 'fr-CA', 'es'] })).toBe('fr');
    expect(detectLocale({ languages: ['ES-mx'] })).toBe('es');
  });

  it('falls back to en without signals', () => {
    expect(detectLocale({})).toBe('en');
    expect(detectLocale({ cookie: '', languages: ['de', 'ja'] })).toBe('en');
  });
});

describe('locale helpers', () => {
  it('validates locales', () => {
    expect(isLocale('es')).toBe(true);
    expect(isLocale('de')).toBe(false);
    expect(isLocale(undefined)).toBe(false);
    expect(localeFromLanguageTag(' FR-be ')).toBe('fr');
    expect(localeFromLanguageTag('')).toBeUndefined();
  });

  it('reads the locale from the first path segment', () => {
    expect(localeFromPathname('/es/track/')).toBe('es');
    expect(localeFromPathname('/fr')).toBe('fr');
    expect(localeFromPathname('/de/')).toBe('en');
    expect(localeFromPathname('/')).toBe('en');
  });

  it('serialises the lng cookie as the Nginx redirect expects, with Secure only on https', () => {
    expect(serializeLocaleCookie('es', false)).toBe('lng=es; Path=/; Max-Age=31536000; SameSite=Lax');
    expect(serializeLocaleCookie('fr', true)).toBe('lng=fr; Path=/; Max-Age=31536000; SameSite=Lax; Secure');
  });
});
