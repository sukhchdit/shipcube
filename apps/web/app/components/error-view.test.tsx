import { describe, expect, it, jest } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRoutesStub } from 'react-router';

import { ErrorView, type ErrorViewKind } from './error-view';

const renderAt = (path: string, kind: ErrorViewKind, onRetry?: () => void) => {
  const Stub = createRoutesStub([{ path: '*', Component: () => <ErrorView kind={kind} {...(onRetry ? { onRetry } : {})} /> }]);
  return render(<Stub initialEntries={[path]} />);
};

describe('error and not-found states (ADR-0026 §3 ScreenState)', () => {
  it('not found: one h1, a way back to the locale home page, no retry', () => {
    renderAt('/es/nada', 'not-found');
    expect(screen.getByRole('heading', { level: 1, name: 'Página no encontrada' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Ir al inicio' })).toHaveAttribute('href', '/es/');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(screen.getByRole('main')).toBeInTheDocument();
  });

  it('error: explains what to do and offers a retry', async () => {
    const onRetry = jest.fn();
    renderAt('/fr/', 'error', onRetry);
    expect(screen.getByRole('heading', { level: 1, name: 'Un problème est survenu' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Réessayer' }));
    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('link', { name: "Retour à l'accueil" })).toHaveAttribute('href', '/fr/');
  });

  it('an unknown locale prefix is shown in English and links to /en/', () => {
    renderAt('/de/x', 'not-found');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/en/');
  });
});
