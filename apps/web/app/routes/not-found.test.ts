import { describe, expect, it } from '@jest/globals';

import { meta } from './not-found';

type MetaArgs = Parameters<typeof meta>[0];
const titleAt = (pathname: string) => meta({ location: { pathname } } as MetaArgs);

describe('web not-found route meta (WCAG 2.4.2)', () => {
  it.each([
    ['/en/no-such-page', 'Page not found'],
    ['/es/no-such-page', 'Página no encontrada'],
    ['/fr/no-such-page', 'Page introuvable'],
  ])('titles %s in the URL locale', (pathname, title) => {
    expect(titleAt(pathname)).toEqual([{ title }]);
  });

  it('falls back to the default locale for an unknown prefix', () => {
    expect(titleAt('/de/no-such-page')).toEqual([{ title: 'Page not found' }]);
  });
});
