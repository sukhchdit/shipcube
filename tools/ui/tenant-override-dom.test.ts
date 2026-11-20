/**
 * AT-US-101-04 in a DOM (TASK-038): the cascade resolves a token variable to the tenant override without a code change.
 * The generated theme and the override layer are injected as two stylesheets, in that order, and the computed value of the
 * semantic variable is read from the document element. The tools tsconfig has no DOM lib and the `unit` project runs in
 * Node, so this one file opts into jsdom by docblock and pulls in the DOM types itself.
 *
 * @jest-environment jsdom
 */
/// <reference lib="dom" />
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from '@jest/globals';

import { findRepoRoot } from '../test-support/process.js';
import { buildTenantOverrideCss, loadTokens } from './tokens-core.mjs';

const ROOT = findRepoRoot();
const tokens = loadTokens();

/** The plain-CSS part of the generated theme: Tailwind's @theme registration blocks are build-time only. */
const baseTheme = readFileSync(join(ROOT, 'packages/ui/src/theme/tokens.generated.css'), 'utf8').replace(/@theme [^{]+\{[^}]*\}/gu, '');

function mount(...styles: string[]): void {
  for (const css of styles) {
    const style = document.createElement('style');
    style.textContent = css;
    document.head.append(style);
  }
}

const value = (name: string): string => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

afterEach(() => {
  document.head.replaceChildren();
  document.documentElement.removeAttribute('data-theme');
});

describe('tenant override resolves through the cascade', () => {
  it('[AT-US-101-04] without an override the primary action variable is the default token value', () => {
    mount(baseTheme);
    expect(value('--color-action-primary-bg')).toBe('#2563eb');
    expect(value('--space-2')).toBe('8px');
  });

  it('[AT-US-101-04] with an override layer after the theme, the same variable resolves to the tenant colour, other tokens unchanged', () => {
    const { css } = buildTenantOverrideCss(tokens, { 'theme.light.action.primary.bg': '#0b5d2a' });
    mount(baseTheme, css);
    expect(value('--color-action-primary-bg')).toBe('#0b5d2a');
    expect(value('--color-action-primary-bg-hover')).toBe('#1d4ed8');
    expect(value('--space-2')).toBe('8px');
  });

  it('[AT-US-101-04] a rejected override (contrast failure) leaves the default in force', () => {
    const { css } = buildTenantOverrideCss(tokens, { 'theme.light.action.primary.bg': '#cfe3ff' });
    mount(baseTheme, css);
    expect(value('--color-action-primary-bg')).toBe('#2563eb');
  });
});
