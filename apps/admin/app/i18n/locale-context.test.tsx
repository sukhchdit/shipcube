import { afterEach, describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';

import { LocaleProvider, useDetectedLocale, useLocale, useT } from './locale-context';

function Probe() {
  const t = useT();
  return (
    <p>
      {useLocale()}:{t('goHome')}
    </p>
  );
}

function Detecting() {
  const locale = useDetectedLocale();
  return (
    <LocaleProvider locale={locale}>
      <Probe />
    </LocaleProvider>
  );
}

afterEach(() => {
  document.cookie = 'lng=; Max-Age=0; Path=/';
});

describe('admin locale context', () => {
  it('uses the default locale without a provider', () => {
    render(<Probe />);
    expect(screen.getByText('en:Go home')).toBeInTheDocument();
  });

  it('translates in the provided locale', () => {
    render(
      <LocaleProvider locale="es">
        <Probe />
      </LocaleProvider>,
    );
    expect(screen.getByText('es:Ir al inicio')).toBeInTheDocument();
  });

  it('switches from the default to the cookie locale after mount', async () => {
    document.cookie = 'lng=fr; Path=/';
    render(<Detecting />);
    expect(await screen.findByText("fr:Retour à l'accueil")).toBeInTheDocument();
  });
});
