import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ComponentProps } from 'react';
import { createRoutesStub } from 'react-router';

import { ErrorView } from './components/error-view';
import { LocaleProvider } from './i18n/locale-context';
import App, { ErrorBoundary, HydrateFallback, meta } from './root';

type MetaArgs = Parameters<typeof meta>[0];
type BoundaryProps = ComponentProps<typeof ErrorBoundary>;
/** The shape `isRouteErrorResponse` recognises: what a thrown `data(null, { status: 404 })` becomes. */
const NOT_FOUND = { status: 404, statusText: 'Not Found', internal: false, data: null };
const metaFor = (error: unknown = null) => meta({ error } as MetaArgs);

const renderBoundary = (error: unknown) => {
  const Stub = createRoutesStub([{ path: '/', Component: () => <ErrorBoundary {...({ error } as BoundaryProps)} /> }]);
  render(
    <LocaleProvider locale="en">
      <Stub initialEntries={['/']} />
    </LocaleProvider>,
  );
};

describe('admin root route', () => {
  it('shows the loading state while the SPA fallback hydrates', () => {
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

  it('error boundary: a 404 response shows the not-found view', () => {
    renderBoundary(NOT_FOUND);
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
  });

  it('error boundary: any other failure shows the error view', () => {
    renderBoundary(new Error('boom'));
    expect(screen.getByRole('heading', { level: 1, name: 'Something went wrong' })).toBeInTheDocument();
  });

  it('the retry button calls the retry handler', async () => {
    const onRetry = jest.fn();
    const Stub = createRoutesStub([{ path: '/', Component: () => <ErrorView kind="error" onRetry={onRetry} /> }]);
    render(<Stub initialEntries={['/']} />);
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('titles the shell and error states', () => {
    expect(metaFor()).toEqual([{ title: 'Operator console' }]);
    expect(metaFor(new Error('boom'))).toEqual([{ title: 'Something went wrong' }]);
    expect(metaFor(NOT_FOUND)).toEqual([{ title: 'Page not found' }]);
  });
});
