import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { createRoutesStub } from 'react-router';

import App, { ErrorBoundary, HydrateFallback, meta } from './root';

type MetaArgs = Parameters<typeof meta>[0];
type BoundaryProps = ComponentProps<typeof ErrorBoundary>;
/** The shape `isRouteErrorResponse` recognises: what a thrown `data(null, { status: 404 })` becomes. */
const NOT_FOUND = { status: 404, statusText: 'Not Found', internal: false, data: null };
const metaFor = (pathname: string, error: unknown = null) => meta({ location: { pathname }, error } as MetaArgs);

describe('root route', () => {
  it('shows the loading state, localised, while the SPA fallback hydrates', () => {
    const Stub = createRoutesStub([{ path: '/', Component: HydrateFallback }]);
    render(<Stub initialEntries={['/']} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading');
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('renders the matched child through the outlet', () => {
    const Stub = createRoutesStub([{ path: '/', Component: App, children: [{ index: true, Component: () => <p>child</p> }] }]);
    render(<Stub initialEntries={['/']} />);
    expect(screen.getByText('child')).toBeInTheDocument();
  });

  const renderBoundary = (path: string, error: unknown) => {
    const Stub = createRoutesStub([{ path: '*', Component: () => <ErrorBoundary {...({ error } as BoundaryProps)} /> }]);
    render(<Stub initialEntries={[path]} />);
  };

  it('error boundary: a 404 response shows the not-found view', () => {
    renderBoundary('/es/x', NOT_FOUND);
    expect(screen.getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('error boundary: any other failure shows the error view with a retry', () => {
    renderBoundary('/fr/x', new Error('boom'));
    expect(screen.getByRole('heading', { level: 1, name: 'Un problème est survenu' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Réessayer' })).toBeInTheDocument();
  });

  it('titles the SPA shell and error states in the locale of the URL', () => {
    expect(metaFor('/es/')).toEqual([{ title: 'Cargando' }]);
    expect(metaFor('/fr/x', new Error('boom'))).toEqual([{ title: 'Un problème est survenu' }]);
    expect(metaFor('/en/x', NOT_FOUND)).toEqual([{ title: 'Page not found' }]);
  });
});
