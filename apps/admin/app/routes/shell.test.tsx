import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRoutesStub } from 'react-router';

import { LocaleProvider } from '../i18n/locale-context';
import type { Locale } from '../i18n/locales';
import Home, { meta } from './home';
import NotFound from './not-found';
import Shell from './shell';

const renderAt = (path: string, locale: Locale = 'en') => {
  const Stub = createRoutesStub([
    { Component: Shell, children: [{ path: '/', Component: Home }] },
    { path: '*', Component: NotFound },
  ]);
  return render(
    <LocaleProvider locale={locale}>
      <Stub initialEntries={[path]} />
    </LocaleProvider>,
  );
};

describe('admin shell and home (REQ-ADMIN-001, accessibility.md §2)', () => {
  it('has the banner, one main with the single h1, and the skip link as first focusable element', async () => {
    renderAt('/');
    expect(screen.getByRole('banner')).toHaveTextContent('Staff area');
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1, name: 'Operator console' })).toBeInTheDocument();

    await userEvent.tab();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveFocus();
  });

  it.each([
    ['es', 'Saltar al contenido', 'Consola de operadores'],
    ['fr', 'Aller au contenu', 'Console des opérateurs'],
  ] as const)('is localised in %s', (locale, skip, heading) => {
    renderAt('/', locale);
    expect(screen.getByRole('link', { name: skip })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: heading })).toBeInTheDocument();
  });

  it('titles the page in the browser locale', () => {
    expect(meta()).toEqual([{ title: 'Operator console' }]);
  });

  it('unknown paths show the not-found state with a way home', () => {
    renderAt('/nowhere');
    expect(screen.getByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go home' })).toHaveAttribute('href', '/');
  });
});
