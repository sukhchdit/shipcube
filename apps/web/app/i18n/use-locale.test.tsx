import { afterEach, describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import { act } from 'react';
import { hydrateRoot, type Root } from 'react-dom/client';
import { renderToString } from 'react-dom/server';
import { MemoryRouter } from 'react-router';

import { useLocale, useT } from './use-locale';

function Probe() {
  const t = useT();
  return (
    <p>
      {useLocale()}:{t('goHome')}
    </p>
  );
}

const at = (path: string) => (
  <MemoryRouter initialEntries={[path]}>
    <Probe />
  </MemoryRouter>
);

afterEach(() => {
  document.documentElement.lang = '';
  document.body.replaceChildren();
});

describe('web useLocale (ADR-0026 am. 4; PR #4 m2)', () => {
  it('follows the locale of the URL on the client, with en for unknown prefixes', () => {
    render(at('/fr/x'));
    expect(screen.getByText("fr:Retour à l'accueil")).toBeInTheDocument();
  });

  it('renders the server snapshot in the locale of the served HTML (<html lang>), not of the URL', () => {
    document.documentElement.lang = 'es';
    expect(renderToString(at('/fr/x'))).toBe('<p>es<!-- -->:<!-- -->Ir al inicio</p>');
    document.documentElement.lang = 'xx';
    expect(renderToString(at('/fr/x'))).toBe('<p>en<!-- -->:<!-- -->Go home</p>');
  });

  it('hydrates the default-locale SPA fallback at /es/... without a mismatch, then switches to es', async () => {
    document.documentElement.lang = 'en';
    const container = document.createElement('div');
    container.innerHTML = renderToString(at('/'));
    document.body.append(container);
    const recoverable: unknown[] = [];
    const roots: Root[] = [];

    await act(async () => {
      roots.push(hydrateRoot(container, at('/es/no-such-page'), { onRecoverableError: (error) => recoverable.push(error) }));
      await Promise.resolve();
    });

    expect(recoverable).toEqual([]);
    expect(container).toHaveTextContent('es:Ir al inicio');
    // RTL's cleanup does not know this root (PR #4 R3-n2).
    act(() => {
      for (const root of roots) root.unmount();
    });
  });
});
