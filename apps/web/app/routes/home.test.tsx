import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { createRoutesStub } from 'react-router';

import Home, { meta } from './home';

const renderAt = (path: string) => {
  const Stub = createRoutesStub([{ path: '/:lng/', Component: Home }]);
  return render(<Stub initialEntries={[path]} />);
};

type MetaArgs = Parameters<typeof meta>[0];
const metaFor = (pathname: string) => meta({ location: { pathname } } as MetaArgs);

describe('home route (US-112, NFR-WEB-005)', () => {
  it.each([
    ['/en/', 'Compare carriers and ship worldwide'],
    ['/es/', 'Compara transportistas y envía a todo el mundo'],
    ['/fr/', 'Comparez les transporteurs et expédiez partout dans le monde'],
  ])('renders the single localised heading at %s', (path, heading) => {
    renderAt(path);
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
  });

  it('declares a localised title, a description, a canonical URL and hreflang alternates for en, es, fr and x-default', () => {
    const descriptors = metaFor('/es/');
    expect(descriptors).toContainEqual({ title: 'Compara transportistas y envía a todo el mundo' });
    expect(descriptors).toContainEqual({ tagName: 'link', rel: 'canonical', href: 'http://localhost:8080/es/' });
    const alternates = descriptors
      .filter((d) => 'rel' in d && d.rel === 'alternate')
      .map((d) => ('hrefLang' in d ? d.hrefLang : undefined));
    expect(alternates).toEqual(['en', 'es', 'fr', 'x-default']);
  });
});
