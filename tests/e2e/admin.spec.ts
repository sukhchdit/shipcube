/**
 * Operator console smoke suite (TASK-004 acceptance; NFR-COMPAT-001/002): the SPA shell in the browser's locale and
 * in the `lng` cookie's locale, with a keyboard path through the skip link. Every state is scanned with axe
 * (fixtures/guarded-page.ts), and any page error or console.error fails the test.
 */
import { expect, test } from './fixtures/guarded-page.js';
import { adminMessages } from './support/messages.js';
import { ADMIN_BASE_URL } from './support/servers.js';

test('admin root renders the SPA shell in the browser locale', async ({ page, scanA11y, tabForward }) => {
  const text = adminMessages('en');
  await page.goto(`${ADMIN_BASE_URL}/`);

  await expect(page.locator('html')).toHaveAttribute('lang', 'en');
  await expect(page).toHaveTitle(text.home.title);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(text.home.title);
  await scanA11y();

  await tabForward();
  await expect(page.getByRole('link', { name: text.skipToContent })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('#main')).toBeFocused();
});

test('admin follows the lng=fr cookie', async ({ page, scanA11y }) => {
  const text = adminMessages('fr');
  await page.context().addCookies([{ name: 'lng', value: 'fr', url: ADMIN_BASE_URL }]);
  await page.goto(`${ADMIN_BASE_URL}/`);

  await expect(page.locator('html')).toHaveAttribute('lang', 'fr');
  await expect(page).toHaveTitle(text.home.title);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(text.home.title);
  await scanA11y();
});
