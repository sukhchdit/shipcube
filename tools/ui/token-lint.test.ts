/**
 * Token lint analysis (US-101, tokens.md §1 rule 1 and §5; TASK-038): positive and negative cases for the pure functions
 * behind the Stylelint rule `platform/token-lint`. The rule itself is exercised end to end, with the real
 * stylelint.config.mjs, by the seeded fixtures in tools/lint/negative-fixtures.test.ts.
 */
import { describe, expect, it } from '@jest/globals';

import { findColourLiterals, findOffGridSpacing, findUnknownVariables, isRuntimeVariable, isSpacingProperty } from './token-lint.mjs';
import { knownCssVariables, loadTokens, spaceScalePx } from './tokens-core.mjs';

const tokens = loadTokens();
const SCALE = spaceScalePx(tokens);
const known = knownCssVariables(tokens);
const isKnown = (name: string): boolean => known.has(name) || isRuntimeVariable(name);

describe('hard-coded colours', () => {
  it.each([
    ['color', '#ff0000', ['#ff0000']],
    ['color', '#F00', ['#F00']],
    ['background-color', '#ff000080', ['#ff000080']],
    ['border-color', '#abcd', ['#abcd']],
    ['background-color', 'rgb(0,0,0)', ['rgb()']],
    ['color', 'rgba(0, 0, 0, 0.5)', ['rgba()']],
    ['color', 'hsl(210 50% 40%)', ['hsl()']],
    ['color', 'oklch(0.7 0.1 200)', ['oklch()']],
    ['--brand', '#112233', ['#112233']],
    ['box-shadow', '0 1px 2px var(--x, #000)', ['#000']],
    ['background', 'linear-gradient(to right, red, var(--color-bg-subtle))', ['red']],
    ['border', '1px solid Black', ['Black']],
    ['color', 'rebeccapurple', ['rebeccapurple']],
  ])('[AT-US-101-02] %s: %s is rejected', (prop, value, expected) => {
    expect(findColourLiterals(prop, value)).toEqual(expected);
  });

  it.each([
    ['color', 'var(--color-text-primary)'],
    ['color', 'currentcolor'],
    ['background-color', 'transparent'],
    ['background', 'url(#gradient)'],
    ['background-image', 'url(\'data:image/svg+xml;utf8,<svg fill="#ff0000"/>\')'],
    ['content', "'#ff0000'"],
    ['font-family', 'red-hat, sans-serif'],
    ['width', 'green'],
    ['--tw-shadow', '0 0 var(--color-border-subtle)'],
    ['border', 'var(--border-width-hairline) solid var(--color-border-control)'],
    ['color', 'var(--red)'],
    ['grid-area', 'header'],
  ])('allows %s: %s (a token, a keyword or data)', (prop, value) => {
    expect(findColourLiterals(prop, value)).toEqual([]);
  });
});

describe('off-grid spacing', () => {
  it.each([
    ['margin', '13px', ['13px']],
    ['padding', '8px 13px', ['13px']],
    ['margin-block-start', '-5px', ['-5px']],
    ['gap', '0.8125rem', ['0.8125rem']],
    ['padding-inline', '1px', ['1px']],
    ['inset', '2px', ['2px']],
    ['top', 'calc(var(--space-2) + 3px)', ['3px']],
    ['scroll-padding-block-start', '7px', ['7px']],
    ['row-gap', '1.3em', ['1.3em']],
  ])('[AT-US-101-03] %s: %s is rejected', (prop, value, expected) => {
    expect(findOffGridSpacing(prop, value, SCALE)).toEqual(expected);
  });

  it.each([
    ['margin', '0'],
    ['margin', '0 auto'],
    ['margin-block', '-8px'],
    ['padding', '8px 16px'],
    ['padding-inline', '1.5rem'],
    ['gap', '0.25rem'],
    ['gap', 'var(--space-2)'],
    ['margin', 'var(--x, 13px)'],
    ['padding', 'calc(var(--space-4) * 2)'],
    ['inset-inline-start', '50%'],
    ['padding-block-end', 'env(safe-area-inset-bottom)'],
    ['padding-inline', '96px'],
    ['margin', 'auto'],
    ['width', '13px'],
    ['border-width', '3px'],
    ['--card-gap', '13px'],
  ])('allows %s: %s (on the 4/8 scale, a variable, a keyword or not a spacing property)', (prop, value) => {
    expect(findOffGridSpacing(prop, value, SCALE)).toEqual([]);
  });

  it('knows which properties are spacing properties', () => {
    for (const prop of [
      'margin',
      'margin-inline-start',
      'padding-block',
      'gap',
      'column-gap',
      'inset-block-end',
      'top',
      'scroll-margin-top',
    ]) {
      expect(isSpacingProperty(prop)).toBe(true);
    }
    for (const prop of ['width', 'border-width', 'font-size', 'line-height', 'transform']) expect(isSpacingProperty(prop)).toBe(false);
  });
});

describe('unknown tokens', () => {
  it('[AT-US-101-05] rejects var(--colour-nonexistent) and names the variable', () => {
    expect(findUnknownVariables('var(--colour-nonexistent)', isKnown)).toEqual(['--colour-nonexistent']);
    expect(findUnknownVariables('calc(var(--space-2) + var(--space-99))', isKnown)).toEqual(['--space-99']);
    expect(findUnknownVariables('var(--color-text-primry, #fff)', isKnown)).toEqual(['--color-text-primry']);
  });

  it('accepts platform tokens, Tailwind and Radix runtime variables', () => {
    expect(findUnknownVariables('var(--space-2) var(--color-text-primary) var(--shadow-e2)', isKnown)).toEqual([]);
    expect(findUnknownVariables('var(--tw-ring-offset-width) var(--radix-popover-trigger-width)', isKnown)).toEqual([]);
    expect(findUnknownVariables('var( --size-control-fine )', isKnown)).toEqual([]);
    expect(findUnknownVariables('none', isKnown)).toEqual([]);
  });
});
