import { describe, expect, it } from '@jest/globals';

import { localisedPageMeta, localisedUrl } from './page-meta';
import { LOCAL_ORIGIN, resolvePublicOrigin } from './public-origin';

describe('localised page meta (US-112)', () => {
  it('builds locale-prefixed URLs with a trailing slash', () => {
    expect(localisedUrl('https://example.test', 'es', '')).toBe('https://example.test/es/');
    expect(localisedUrl('https://example.test', 'fr', 'track')).toBe('https://example.test/fr/track/');
  });

  it('emits title, description, canonical, and hreflang alternates including x-default', () => {
    const descriptors = localisedPageMeta({ locale: 'fr', path: 'track', title: 'T', description: 'D', origin: 'https://example.test' });
    expect(descriptors).toEqual([
      { title: 'T' },
      { name: 'description', content: 'D' },
      { tagName: 'link', rel: 'canonical', href: 'https://example.test/fr/track/' },
      { tagName: 'link', rel: 'alternate', hrefLang: 'en', href: 'https://example.test/en/track/' },
      { tagName: 'link', rel: 'alternate', hrefLang: 'es', href: 'https://example.test/es/track/' },
      { tagName: 'link', rel: 'alternate', hrefLang: 'fr', href: 'https://example.test/fr/track/' },
      { tagName: 'link', rel: 'alternate', hrefLang: 'x-default', href: 'https://example.test/en/track/' },
    ]);
  });
});

describe('public origin', () => {
  it('defaults to the local edge', () => {
    expect(resolvePublicOrigin(undefined)).toBe(LOCAL_ORIGIN);
    expect(resolvePublicOrigin('')).toBe(LOCAL_ORIGIN);
  });

  it('normalises to an origin without path or trailing slash', () => {
    expect(resolvePublicOrigin('https://example.test/some/path/')).toBe('https://example.test');
  });

  it('fails fast on a value that is not an http(s) origin', () => {
    expect(() => resolvePublicOrigin('ftp://example.test')).toThrow('http(s) origin');
    expect(() => resolvePublicOrigin('not a url')).toThrow();
  });
});
