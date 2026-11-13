/**
 * Public web smoke suite (TASK-004 acceptance; NFR-COMPAT-001/002, NFR-WEB-004/005): the pre-rendered locale pages,
 * the `/` redirect (DR-A18), the not-found and loading states of the SPA fallback, and the static server's own
 * robustness. Every page state is scanned with axe (fixtures/guarded-page.ts), and any page error or console.error
 * fails the test.
 */
import type { APIRequestContext } from '@playwright/test';

import { expect, test } from './fixtures/guarded-page.js';
import { LOCALES, webMessages } from './support/messages.js';
import { WEB_BASE_URL } from './support/servers.js';

for (const locale of LOCALES) {
  test(`web /${locale}/ is the localised, accessible public home`, async ({ page, scanA11y, tabForward }) => {
    const text = webMessages(locale);
    await page.goto(`/${locale}/`);

    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page).toHaveTitle(text.home.meta.title);
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(text.home.hero.title);
    await scanA11y();

    await tabForward();
    const skipLink = page.getByRole('link', { name: text.skipToContent });
    await expect(skipLink).toBeFocused();
    await expect(skipLink).toBeVisible();
    await scanA11y();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main')).toBeFocused();
  });
}

test('web /es without the trailing slash serves the Spanish page', async ({ page, scanA11y }) => {
  const text = webMessages('es');
  await page.goto('/es');

  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page).toHaveTitle(text.home.meta.title);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(text.home.hero.title);
  await scanA11y();
});

test('web /es/no-such-page renders the Spanish not-found state', async ({ page, scanA11y }) => {
  const text = webMessages('es');
  await page.goto('/es/no-such-page');

  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page).toHaveTitle(text.notFound.meta.title);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(text.notFound.title);
  await scanA11y();
});

test('web SPA fallback shows an accessible loading state until the app has loaded', async ({ page, scanA11y }) => {
  // Hold the JavaScript so the pre-rendered loading state of index.html stays on screen; CSS still loads.
  let release = () => {};
  const scriptsReleased = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(/\/assets\/.+\.js$/, async (route) => {
    await scriptsReleased;
    await route.continue();
  });

  await page.goto('/es/no-such-page', { waitUntil: 'commit' });
  await expect(page.getByRole('status')).toHaveText(webMessages('en').loading);
  await scanA11y();

  release();
  await expect(page.locator('html')).toHaveAttribute('lang', 'es');
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(webMessages('es').notFound.title);
});

test.describe('web / redirect (DR-A18)', () => {
  // The browser derives Accept-Language from the context locale (it overrides extra headers on navigations), so the
  // header-order cases go through the request API, and the browser case sets the locale.
  const redirectFor = async (request: APIRequestContext, headers: Record<string, string>) => {
    const response = await request.get('/', { headers, maxRedirects: 0 });
    expect(response.status()).toBe(302);
    expect(response.headers()['cache-control']).toBe('no-store');
    return response.headers()['location'];
  };

  test('follows the first supported Accept-Language entry, then en', async ({ request }) => {
    expect(await redirectFor(request, { 'Accept-Language': 'de-DE, fr-CA;q=0.9, es;q=0.8' })).toBe('/fr/');
    expect(await redirectFor(request, { 'Accept-Language': 'ES' })).toBe('/es/');
    expect(await redirectFor(request, { 'Accept-Language': 'de, pt-BR' })).toBe('/en/');
    expect(await redirectFor(request, {})).toBe('/en/');
  });

  test('prefers the lng cookie over Accept-Language', async ({ request }) => {
    expect(await redirectFor(request, { 'Accept-Language': 'fr', Cookie: 'theme=dark; lng=es' })).toBe('/es/');
  });

  test.describe('in a French browser', () => {
    test.use({ locale: 'fr-CA' });

    test('lands on the French home', async ({ page, scanA11y }) => {
      await page.goto('/');
      await expect(page).toHaveURL(`${WEB_BASE_URL}/fr/`);
      await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
      await expect(page.getByRole('heading', { level: 1 })).toHaveText(webMessages('fr').home.hero.title);
      await scanA11y();
    });
  });
});

test.describe('static server robustness (PR4-SEC-07)', () => {
  test('answers 400 to a malformed escape and to traversal, and keeps serving', async ({ request }) => {
    expect((await request.get('/%E0%A4%A')).status()).toBe(400);
    expect((await request.get('/..%2f..%2fpackage.json')).status()).toBe(400);
    expect((await request.get('/en/')).status()).toBe(200);
  });

  test('mirrors the Nginx method, dotfile and missing-asset rules', async ({ request }) => {
    expect((await request.post('/en/')).status()).toBe(405);
    expect((await request.get('/.git/config')).status()).toBe(403);
    expect((await request.get('/assets/missing-0000.js')).status()).toBe(404);
  });
});
