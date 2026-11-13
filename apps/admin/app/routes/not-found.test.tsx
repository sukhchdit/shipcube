import { afterEach, describe, expect, it } from '@jest/globals';

import { meta } from './not-found';

afterEach(() => {
  document.cookie = 'lng=; Max-Age=0; Path=/';
});

describe('admin not-found route meta (WCAG 2.4.2)', () => {
  it.each([
    ['en', 'Page not found'],
    ['es', 'Página no encontrada'],
    ['fr', 'Page introuvable'],
  ])('titles the page in the %s cookie locale', (locale, title) => {
    document.cookie = `lng=${locale}; Path=/`;
    expect(meta()).toEqual([{ title }]);
  });

  it('falls back to the default locale without a cookie', () => {
    expect(meta()).toEqual([{ title: 'Page not found' }]);
  });
});
