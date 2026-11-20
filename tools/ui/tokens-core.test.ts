/**
 * Design-token compiler (US-101, REQ-UI-001; TASK-038): the committed theme equals the compiled source, the source equals
 * the UX hand-off, and the variable naming follows tokens.md §2. The Tailwind 4 build of the theme is exercised per app in
 * apps/web/app/theme.test.ts and apps/admin/app/theme.test.ts (the apps declare the tailwindcss dependency).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import {
  GENERATED_THEME_PATH,
  THEME_SCOPES,
  TOKENS_PATH,
  UX_TOKENS_PATH,
  colorAlias,
  compileThemeCss,
  cssVariables,
  flattenTokens,
  formatValue,
  kebab,
  knownCssVariables,
  loadTokens,
  resolveValue,
  spaceScalePx,
} from './tokens-core.mjs';

const ROOT = findRepoRoot();
const tokens = loadTokens();
const read = (path: string): string => readFileSync(join(ROOT, path), 'utf8');

describe('token compiler: source of truth and drift (US-101)', () => {
  it('[AT-US-101-01] the committed generated theme equals the compiled tokens.json (run npm run tokens:build to refresh)', () => {
    expect(read(GENERATED_THEME_PATH)).toBe(compileThemeCss(tokens));
  });

  it('[AT-US-101-01] packages/ui/tokens/tokens.json equals the UX hand-off docs/02-ux/design-system/tokens.json', () => {
    expect(loadTokens(TOKENS_PATH)).toEqual(loadTokens(UX_TOKENS_PATH));
  });

  it('[AT-US-101-01] the compiler is deterministic', () => {
    expect(compileThemeCss(tokens)).toBe(compileThemeCss(structuredClone(tokens)));
  });
});

describe('token compiler: variables (tokens.md §2, cssVariablePrefixRules)', () => {
  const css = compileThemeCss(tokens);
  const declaration = (name: string, scope: string = ':root'): string | undefined => {
    const block = css.split(/\n(?=:root|@media|@theme)/u).find((chunk) => chunk.startsWith(`${scope} {`));
    return new RegExp(`^\\s*${name}: ([^;]+);`, 'mu').exec(block ?? '')?.[1];
  };

  it('[AT-US-101-01] exposes --space-2 = 8px and the whole 4/8 scale as CSS variables on :root', () => {
    expect(declaration('--space-2')).toBe('8px');
    expect(spaceScalePx(tokens)).toEqual([0, 4, 8, 12, 16, 20, 24, 32, 40, 48, 64, 80, 96]);
    for (const step of [0, 1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20, 24]) expect(declaration(`--space-${step}`)).toMatch(/px$/u);
  });

  it.each([
    ['--color-bg-surface', '#ffffff', ':root'],
    ['--color-text-muted', '#475569', ':root'],
    ['--color-action-primary-bg-hover', '#1d4ed8', ':root'],
    ['--color-status-danger-fg', '#b91c1c', ':root'],
    ['--color-bg-surface', '#0f172a', THEME_SCOPES.dark],
    ['--shadow-e2', '0px 4px 8px -2px #00000080', THEME_SCOPES.dark],
    ['--duration-fast', '120ms', ':root'],
    ['--ease-standard', 'cubic-bezier(0.2, 0, 0, 1)', '@theme static'],
    ['--radius-md', '8px', '@theme static'],
    ['--size-control-coarse', '44px', ':root'],
    ['--z-skip-link', '70', ':root'],
  ])('[AT-US-101-01] %s resolves to %s under %s', (name, value, scope) => {
    expect(declaration(name, scope)).toBe(value);
  });

  it('[AT-US-101-01] writes the system-theme dark block under prefers-color-scheme and zero durations under reduced motion', () => {
    expect(css).toContain(`@media (prefers-color-scheme: dark) {\n  ${THEME_SCOPES.system} {`);
    expect(css).toMatch(
      /@media \(prefers-reduced-motion: reduce\) \{\n {2}:root \{\n {4}--duration-instant: 0ms;\n {4}--duration-fast: 0ms;/u,
    );
    expect(css).toContain('--motion-lift: 0px;');
  });

  it('[AT-US-101-04] semantic colours are declared per theme and primitives are never exposed as variables', () => {
    const names = cssVariables(flattenTokens(tokens)).map((variable) => variable.name);
    expect(names.some((name) => name.includes('primitive'))).toBe(false);
    expect(css).not.toMatch(/--color-(?:slate|blue|red|green|amber)-/u);
  });

  it('knownCssVariables lists every declared variable and nothing invented', () => {
    const known = knownCssVariables(tokens);
    expect(known.has('--space-2')).toBe(true);
    expect(known.has('--color-text-primary')).toBe(true);
    expect(known.has('--spacing')).toBe(true);
    expect(known.has('--colour-nonexistent')).toBe(false);
    for (const name of known) expect(css).toContain(`${name}:`);
  });

  it('colour utility names follow tokens.md §2 and never collide', () => {
    expect(colorAlias(['bg', 'surface'])).toBe('surface');
    expect(colorAlias(['text', 'muted'])).toBe('muted');
    expect(colorAlias(['text', 'inverse'])).toBe('on-inverse');
    expect(colorAlias(['border', 'control'])).toBe('control');
    expect(colorAlias(['border', 'subtle'])).toBe('hairline');
    expect(colorAlias(['border', 'strong'])).toBe('strong-edge');
    expect(colorAlias(['action', 'primary', 'bgHover'])).toBe('action-primary-hover');
    expect(colorAlias(['action', 'secondary', 'border'])).toBe('action-secondary-edge');
    expect(colorAlias(['action', 'danger', 'fg'])).toBe('on-action-danger');
    expect(colorAlias(['focus', 'ring'])).toBe('focus');
    expect(colorAlias(['focus', 'offset'])).toBe('focus-gap');
    expect(colorAlias(['status', 'danger', 'fg'])).toBe('danger');
    expect(colorAlias(['status', 'danger', 'bg'])).toBe('danger-bg');
    expect(() => colorAlias(['mystery', 'x'])).toThrow('No Tailwind colour alias rule');
  });
});

describe('token compiler: value formatting and failure modes', () => {
  it('kebab-cases camelCase token names', () => {
    expect(kebab('bgHover')).toBe('bg-hover');
    expect(kebab('skipLink')).toBe('skip-link');
    expect(kebab('2xl')).toBe('2xl');
  });

  it('formats colours, font stacks, easings and layered or inset shadows', () => {
    expect(formatValue('color', '#AABBCC')).toBe('#aabbcc');
    expect(formatValue('fontFamily', ['system-ui', 'Segoe UI', 'SFMono-Regular', 'Menlo', 'monospace'])).toBe(
      "system-ui, 'Segoe UI', 'SFMono-Regular', Menlo, monospace",
    );
    expect(formatValue('cubicBezier', [0.2, 0, 0, 1])).toBe('cubic-bezier(0.2, 0, 0, 1)');
    const layer = { color: '#0F172A0F', offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px' };
    expect(formatValue('shadow', [layer, { ...layer, inset: true }])).toBe('0px 1px 2px 0px #0f172a0f, inset 0px 1px 2px 0px #0f172a0f');
    expect(formatValue('number', 70)).toBe('70');
  });

  it('resolves alias chains and rejects missing targets and cycles', () => {
    const flat = flattenTokens({
      a: { $type: 'color', $value: '{b}' },
      b: { $type: 'color', $value: '#112233' },
      loop1: { $type: 'color', $value: '{loop2}' },
      loop2: { $type: 'color', $value: '{loop1}' },
    });
    expect(resolveValue(flat, '{a}')).toBe('#112233');
    expect(resolveValue(flat, 7)).toBe(7);
    expect(() => resolveValue(flat, '{missing}')).toThrow('does not exist');
    expect(() => resolveValue(flat, '{loop1}')).toThrow('alias cycle');
  });

  it('refuses two tokens that produce the same variable', () => {
    const dimension = { $type: 'dimension', $value: '1px' };
    expect(cssVariables(flattenTokens({ size: { control: { largeFine: dimension } } })).map((variable) => variable.name)).toEqual([
      '--size-control-large-fine',
    ]);
    const clash = { size: { control: { largeFine: dimension }, 'control-large': { fine: dimension } } };
    expect(() => cssVariables(flattenTokens(clash))).toThrow('Two tokens produce the CSS variable --size-control-large-fine');
  });
});

describe('both apps consume the shared theme (AT-US-101-01)', () => {
  it('[AT-US-101-01] apps/web and apps/admin import the Tailwind base and @platform/ui/theme.css, which imports the generated tokens', () => {
    for (const app of ['web', 'admin']) {
      const css = read(`apps/${app}/app/app.css`);
      expect(css).toContain("@import 'tailwindcss';");
      expect(css).toContain("@import '@platform/ui/theme.css';");
    }
    const manifest = JSON.parse(read('packages/ui/package.json')) as { exports: Record<string, string> };
    expect(manifest.exports['./theme.css']).toBe('./src/theme.css');
    expect(read('packages/ui/src/theme.css')).toContain("@import './theme/tokens.generated.css';");
  });

  it('the hand-written theme holds no raw colour: every colour value lives in the generated file', () => {
    expect(read('packages/ui/src/theme.css')).not.toMatch(/#[\da-f]{3,8}\b|\b(?:rgb|hsl)a?\(/iu);
  });
});
