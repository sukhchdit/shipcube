/**
 * Tenant override seam (AT-US-101-04; tokens.md §1 rule 4 and §11; D-UX-002; TASK-038): a brand or tenant value for a
 * tenant-overridable semantic token is applied through CSS variables only, with no change to primitives or code. Only the
 * listed tokens can be overridden, and an override that breaks a contrast pair is rejected for its theme, naming the pair.
 */
import { describe, expect, it } from '@jest/globals';

import { THEME_SCOPES, buildTenantOverrideCss, checkContrast, loadTokens } from './tokens-core.mjs';

const tokens = loadTokens();
const PRIMARY = 'theme.light.action.primary.bg';
// A dark green: 7.4:1 against white, so it passes every light pair that involves the primary action and the focus ring.
const BRAND_GREEN = '#0b5d2a';

describe('tenant override layer', () => {
  it('[AT-US-101-04] re-declares the primary action variable under the light scope, with the override value', () => {
    const { css, applied, rejected } = buildTenantOverrideCss(tokens, { [PRIMARY]: BRAND_GREEN });
    expect(rejected).toEqual([]);
    expect(applied).toEqual([PRIMARY]);
    expect(css).toBe(`${THEME_SCOPES.light} {\n  --color-action-primary-bg: ${BRAND_GREEN};\n}\n`);
  });

  it('[AT-US-101-04] writes the dark overrides under data-theme="dark" and under prefers-color-scheme for the system theme', () => {
    const { css } = buildTenantOverrideCss(tokens, { 'theme.dark.action.primary.bg': '#86efac', 'theme.dark.text.link': '#93c5fd' });
    expect(css).toContain(`${THEME_SCOPES.dark} {\n  --color-action-primary-bg: #86efac;\n  --color-text-link: #93c5fd;\n}`);
    expect(css).toContain(`@media (prefers-color-scheme: dark) {\n  ${THEME_SCOPES.system} {\n    --color-action-primary-bg: #86efac;`);
    expect(css).not.toContain(`${THEME_SCOPES.light} {`);
  });

  it('[AT-US-101-04] accepts #rgb and normalises case; emits nothing without overrides', () => {
    expect(buildTenantOverrideCss(tokens, { 'theme.light.text.link': '#003' }).css).toContain('--color-text-link: #003;');
    expect(buildTenantOverrideCss(tokens, { 'theme.light.focus.ring': '#0B5D2A' }).css).toContain('--color-focus-ring: #0b5d2a;');
    expect(buildTenantOverrideCss(tokens, {})).toEqual({ css: '', applied: [], rejected: [] });
  });

  it('never touches primitives: a primitive or a non-listed semantic token is rejected, not applied', () => {
    const { css, applied, rejected } = buildTenantOverrideCss(tokens, {
      'color.primitive.blue.600': '#ff0000',
      'theme.light.bg.canvas': '#ff0000',
      'theme.light.status.danger.fg': '#ff0000',
    });
    expect(css).toBe('');
    expect(applied).toEqual([]);
    expect(rejected.map((r) => r.token)).toEqual(['color.primitive.blue.600', 'theme.light.bg.canvas', 'theme.light.status.danger.fg']);
    expect(rejected.every((r) => r.reason === 'not tenant-overridable')).toBe(true);
  });

  it('rejects a value that is not a hex colour (no rgb(), no named colour, no injection)', () => {
    for (const value of ['red', 'rgb(0,0,0)', '#12', '#ff0000; } body { display: none', 'url(x)']) {
      const { css, rejected } = buildTenantOverrideCss(tokens, { [PRIMARY]: value });
      expect(css).toBe('');
      expect(rejected[0]?.reason).toContain('is not a #rgb or #rrggbb colour');
    }
  });

  it('[AT-US-101-04] rejects an override that fails a contrast pair for that theme and names the pair, keeping the default', () => {
    // White action text on a pale primary: 1.2:1.
    const { css, applied, rejected } = buildTenantOverrideCss(tokens, { [PRIMARY]: '#cfe3ff' });
    expect(css).toBe('');
    expect(applied).toEqual([]);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.reason).toMatch(/action\.primary\.fg on action\.primary\.bg is 1\.\d\d:1, below 4\.5:1/u);
  });

  it('a failing light override does not block a passing dark override (the pair test is per theme)', () => {
    const { css, applied, rejected } = buildTenantOverrideCss(tokens, { [PRIMARY]: '#cfe3ff', 'theme.dark.focus.ring': '#93c5fd' });
    expect(applied).toEqual(['theme.dark.focus.ring']);
    expect(rejected.map((r) => r.token)).toEqual([PRIMARY]);
    expect(css).toContain('--color-focus-ring: #93c5fd;');
  });

  it('the brand colour used above really passes every pair of its theme', () => {
    expect(checkContrast(tokens, 'light', { [PRIMARY]: BRAND_GREEN }).filter((r) => !r.pass)).toEqual([]);
  });
});
