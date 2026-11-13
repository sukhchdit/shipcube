import { describe, expect, it } from '@jest/globals';

import { browserLocale, detectLocale, isLocale, localeFromLanguageTag } from './locales';

describe('admin locale detection (DR-A18)', () => {
  it('prefers the lng cookie over the browser languages', () => {
    expect(detectLocale({ cookie: 'a=b; lng=fr', languages: ['es-ES'] })).toBe('fr');
  });

  it('ignores an unsupported cookie value and uses the first supported browser language subtag', () => {
    expect(detectLocale({ cookie: 'lng=de', languages: ['de-DE', 'ES-mx'] })).toBe('es');
  });

  it('falls back to en', () => {
    expect(detectLocale({})).toBe('en');
    expect(detectLocale({ cookie: '', languages: ['ja'] })).toBe('en');
  });

  it('validates locales and language tags', () => {
    expect(isLocale('fr')).toBe(true);
    expect(isLocale('xx')).toBe(false);
    expect(localeFromLanguageTag('FR-ca')).toBe('fr');
  });

  it('uses the default locale where there is no browser (the build-time render); the browser path is covered in locale-context.test.tsx', () => {
    expect(browserLocale()).toBe('en');
  });
});
