/**
 * Shared Playwright fixture (TASK-004; TEST-STRATEGY §7.8). Specs import `test`/`expect` from here instead of
 * `@playwright/test`. Every test using `page` gets:
 *   - an error guard: any `pageerror` (uncaught exceptions, React recoverable/hydration errors reported through
 *     `reportError`) or `console.error` fails the test. There is no allow-list. TASK-022 adds the CSP
 *     `securitypolicyviolation` listener here (NFR-SEC-006).
 *   - deterministic axe scans (WCAG 2.2 AA tags; serious and critical violations fail the test): specs call
 *     `scanA11y()` once a state has settled (after a `goto` and its web-first assertions, after each state change),
 *     and the fixture scans the final state at teardown. Nothing scans on browser events, so no scan races an
 *     interaction or a navigation.
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, test as base, type Page } from '@playwright/test';

const WCAG_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];
const BLOCKING_IMPACTS: ReadonlySet<string> = new Set(['serious', 'critical']);
/** Sequentially focusable elements, in document order (none of the current pages use a positive tabindex). */
const TABBABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

interface Finding {
  url: string;
  id: string;
  impact: string;
  targets: string[];
}

async function blockingViolations(page: Page): Promise<Finding[]> {
  const results = await new AxeBuilder({ page }).withTags(WCAG_TAGS).analyze();
  return results.violations
    .filter((violation) => BLOCKING_IMPACTS.has(violation.impact ?? ''))
    .map((violation) => ({
      url: page.url(),
      id: violation.id,
      impact: violation.impact ?? 'unknown',
      targets: violation.nodes.map((node) => node.target.join(' ')),
    }));
}

interface GuardFixtures {
  /** Scans the current, settled state with axe and fails on serious/critical violations. */
  scanA11y: () => Promise<void>;
  /**
   * The first Tab press of a keyboard user. WebKit, like Safari by default, leaves links out of the tab order (Safari
   * users enable "Press Tab to highlight each item" or hold Option), and Playwright's Windows/Linux WebKit has no
   * Option+Tab: Tab there moves focus out of the page. On WebKit the fixture therefore focuses the first tabbable
   * element in document order, which is where Option+Tab lands; Chromium and Firefox press the real key.
   */
  tabForward: () => Promise<void>;
}

export const test = base.extend<GuardFixtures>({
  page: async ({ page }, use) => {
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(`console.error: ${message.text()} (${message.location().url})`);
    });

    await use(page);

    if (!page.isClosed()) expect(await blockingViolations(page), 'axe serious/critical violations (final state)').toEqual([]);
    expect(errors, 'page errors and console.error output').toEqual([]);
  },
  scanA11y: async ({ page }, use) => {
    await use(async () => {
      expect(await blockingViolations(page), 'axe serious/critical violations').toEqual([]);
    });
  },
  tabForward: async ({ page, browserName }, use) => {
    await use(async () => {
      if (browserName !== 'webkit') {
        await page.keyboard.press('Tab');
        return;
      }
      await page.locator(TABBABLE).first().focus();
    });
  },
});

export { expect };
