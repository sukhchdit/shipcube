import { describe, expect, it } from '@jest/globals';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRoutesStub } from 'react-router';

import Home from './home';
import LocaleLayout from './locale-layout';

const renderAt = (path: string) => {
  const Stub = createRoutesStub([{ path: '/:lng', Component: LocaleLayout, children: [{ index: true, Component: Home }] }]);
  return render(<Stub initialEntries={[path]} />);
};

describe('locale layout (US-106, US-108, accessibility.md §2)', () => {
  it('has the banner, one main, the content-info landmark and a localised skip link as the first focusable element', async () => {
    renderAt('/es');
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('contentinfo')).toHaveTextContent('Los precios y los plazos de entrega se muestran antes de reservar.');

    await userEvent.tab();
    const skipLink = screen.getByRole('link', { name: 'Saltar al contenido' });
    expect(skipLink).toHaveFocus();
    expect(skipLink).toHaveAttribute('href', '#main');
    expect(document.getElementById('main')).toBe(screen.getByRole('main'));
  });

  it('lists the three languages by their own names, each tagged with its language, and marks the active one', () => {
    renderAt('/fr');
    const nav = screen.getByRole('navigation', { name: 'Langue' });
    const links = within(nav).getAllByRole('link');
    expect(links.map((link) => link.textContent)).toEqual(['English', 'Español', 'Français']);
    expect(links.map((link) => link.getAttribute('lang'))).toEqual(['en', 'es', 'fr']);
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/en/', '/es/', '/fr/']);
    expect(links.map((link) => link.getAttribute('aria-current'))).toEqual([null, null, 'page']);
  });

  it('remembers the chosen language in the lng cookie that Nginx reads for "/"', async () => {
    document.cookie = 'lng=; Max-Age=0; Path=/';
    renderAt('/en');
    await userEvent.click(screen.getByRole('link', { name: 'Español' }));
    expect(document.cookie).toContain('lng=es');
  });
});
