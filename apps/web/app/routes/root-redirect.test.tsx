import { describe, expect, it } from '@jest/globals';
import { render } from '@testing-library/react';
import { createRoutesStub } from 'react-router';

import NotFound from './not-found';
import RootRedirect, { clientLoader } from './root-redirect';

describe('root redirect (ADR-0026 am. 4, DR-A18)', () => {
  it('redirects "/" to the cookie locale, else a browser language, else /en/', async () => {
    document.cookie = 'lng=fr; Path=/';
    const response = clientLoader();
    expect(response.status).toBe(302);
    expect(response.headers.get('Location')).toBe('/fr/');

    document.cookie = 'lng=; Max-Age=0; Path=/';
    expect(clientLoader().headers.get('Location')).toBe('/en/');
  });

  it('follows the redirect to the locale page when routed', async () => {
    const Stub = createRoutesStub([
      { path: '/', Component: RootRedirect, loader: () => clientLoader() },
      { path: '/en/', Component: () => <p>english home</p> },
    ]);
    const { findByText } = render(<Stub initialEntries={['/']} />);
    expect(await findByText('english home')).toBeInTheDocument();
  });

  it('renders nothing itself', () => {
    expect(RootRedirect()).toBeNull();
  });

  it('the catch-all route shows the not-found state', () => {
    const Stub = createRoutesStub([{ path: '*', Component: NotFound }]);
    const { getByRole } = render(<Stub initialEntries={['/es/unknown']} />);
    expect(getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeInTheDocument();
  });
});
