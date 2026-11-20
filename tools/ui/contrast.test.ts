/**
 * Contrast evidence (NFR-A11Y-005, REQ-UI-001; tokens.md §3.3; TASK-038): every foreground/background pair listed in
 * `$extensions.com.platform.contrastPairs` of tokens.json is recomputed per theme from the resolved colours with the
 * WCAG 2.x formula and must meet its minimum (4.5:1 text, 3:1 UI components and focus indicators). A failing pair fails
 * the run naming theme, pair and ratio. The same computation gates tenant overrides (tools/ui/tenant-override.test.ts).
 */
import { describe, expect, it } from '@jest/globals';

import { checkContrast, contrastRatio, hexToRgb, loadTokens, relativeLuminance, themeColors } from './tokens-core.mjs';

const tokens = loadTokens();
const MODES = ['light', 'dark'] as const;

describe('WCAG 2.x arithmetic', () => {
  it('computes known reference ratios', () => {
    expect(contrastRatio('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contrastRatio('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
    expect(contrastRatio('#0f172a', '#ffffff')).toBeCloseTo(17.85, 2);
    // Order does not matter.
    expect(contrastRatio('#ffffff', '#0f172a')).toBe(contrastRatio('#0f172a', '#ffffff'));
  });

  it('expands short hex, ignores alpha and linearises both sides of the sRGB knee', () => {
    expect(hexToRgb('#fff')).toEqual([255, 255, 255]);
    expect(hexToRgb('#112233cc')).toEqual([17, 34, 51]);
    expect(relativeLuminance('#000000')).toBe(0);
    expect(relativeLuminance('#ffffff')).toBeCloseTo(1, 10);
    expect(relativeLuminance('#030303')).toBeGreaterThan(0);
    expect(relativeLuminance('#808080')).toBeCloseTo(0.2159, 3);
  });
});

describe.each(MODES)('contrast pairs, %s theme', (mode) => {
  const results = checkContrast(tokens, mode);

  it('[NFR-A11Y-005] covers every listed pair, including the focus ring and control borders at 3:1', () => {
    expect(results.length).toBe(tokens.$extensions['com.platform.contrastPairs'][mode].length);
    expect(results.some((r) => r.fg === 'focus.ring' && r.min === 3)).toBe(true);
    expect(results.some((r) => r.fg === 'border.control' && r.min === 3)).toBe(true);
    expect(results.some((r) => r.fg === 'text.primary' && r.min === 4.5)).toBe(true);
  });

  it.each(results.map((r) => [`${r.fg} on ${r.bg}`, r] as const))('[NFR-A11Y-005] %s meets its minimum', (_name, result) => {
    // The message names the failing pair, as lane A reports it.
    const message = `${result.mode}: ${result.fg} on ${result.bg} is ${result.ratio.toFixed(2)}:1, below ${result.min}:1`;
    expect(result.ratio >= result.min ? 'pass' : message).toBe('pass');
  });

  it('[NFR-A11Y-005] reproduces the ratios the UX hand-off documents (tokens.md §3.3, to 2 dp)', () => {
    const pairs = tokens.$extensions['com.platform.contrastPairs'][mode] as { expected: number }[];
    results.forEach((result, index) => {
      expect(Math.abs(result.ratio - (pairs[index]?.expected ?? Number.NaN))).toBeLessThan(0.011);
    });
  });
});

describe('contrast pair integrity', () => {
  it('names only tokens that exist in the theme, and fails loudly on an unknown token', () => {
    for (const mode of MODES) {
      const colors = themeColors(tokens, mode);
      for (const pair of tokens.$extensions['com.platform.contrastPairs'][mode] as { fg: string; bg: string }[]) {
        expect(colors.has(pair.fg)).toBe(true);
        expect(colors.has(pair.bg)).toBe(true);
      }
    }
    const broken = structuredClone(tokens);
    broken.$extensions['com.platform.contrastPairs'].light.push({ fg: 'text.nope', bg: 'bg.surface', min: 4.5, expected: 0 });
    expect(() => checkContrast(broken, 'light')).toThrow('text.nope on bg.surface names an unknown token (light)');
  });

  it('[NFR-A11Y-005] flags a failing pair: the documented forbidden placeholder-on-subtle pairing is below 4.5:1', () => {
    const colors = themeColors(tokens, 'light');
    const ratio = contrastRatio(colors.get('text.placeholder') ?? '', colors.get('bg.subtle') ?? '');
    expect(ratio).toBeCloseTo(4.34, 2);
    expect(ratio).toBeLessThan(4.5);
  });

  it('[NFR-A11Y-005] a weakened palette fails the check (the test can fail)', () => {
    const weak = structuredClone(tokens);
    const muted = weak.theme.light['text']?.['muted'];
    if (muted) muted.$value = '#94a3b8';
    expect(muted).toBeDefined();
    const failing = checkContrast(weak, 'light').filter((r) => !r.pass);
    expect(failing.map((r) => `${r.fg} on ${r.bg}`)).toContain('text.muted on bg.surface');
  });
});
