/**
 * The web app consumes the design tokens (US-101, REQ-UI-001, AT-US-101-01; TASK-038): its own app.css, compiled by the
 * Tailwind 4 compiler the build uses, exposes the token variables from packages/ui and the utilities the app's routes
 * use, and does not carry the Tailwind palette or breakpoints that the token theme replaces.
 */
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { describe, expect, it } from '@jest/globals';
import { compile } from 'tailwindcss';

const ROOT = resolve(__dirname, '../../..');
const APP_CSS = join(__dirname, 'app.css');

/** Resolves the two package imports of app.css the way Vite does; every other import is relative. */
function locate(id: string, base: string): string {
  if (id === 'tailwindcss') return join(ROOT, 'node_modules/tailwindcss/index.css');
  if (id === '@platform/ui/theme.css') return join(ROOT, 'packages/ui/src/theme.css');
  return resolve(base, id);
}

async function build(candidates: string[]): Promise<string> {
  const compiled = await compile(readFileSync(APP_CSS, 'utf8'), {
    base: dirname(APP_CSS),
    loadStylesheet: (id: string, base: string) => {
      const path = locate(id, base);
      return Promise.resolve({ path, base: dirname(path), content: readFileSync(path, 'utf8') });
    },
  });
  return compiled.build(candidates);
}

describe('apps/web token theme (AT-US-101-01)', () => {
  it('[AT-US-101-01] exposes the token variables from packages/ui as CSS variables (--space-2 = 8px)', async () => {
    const css = await build([]);
    expect(css).toContain('--space-2: 8px;');
    expect(css).toContain('--color-text-primary: #0f172a;');
    expect(css).toContain('--duration-fast: 120ms;');
    expect(css).toContain(":root[data-theme='dark']");
  });

  it('[AT-US-101-01] builds the utilities the routes use from the token scale', async () => {
    const css = await build([
      'px-4',
      'md:px-6',
      'gap-4',
      'max-w-page',
      'max-w-reading',
      'bg-surface',
      'text-secondary',
      'text-link',
      'rounded-md',
    ]);
    expect(css).toContain('max-width: var(--container-page)');
    expect(css).toContain('background-color: var(--color-bg-surface)');
    expect(css).toContain('color: var(--color-text-link)');
    expect(css).toContain('border-radius: var(--radius-md)');
    expect(css).toContain('@media (width >= 768px)');
  });

  it('[AT-US-101-01] replaces, not extends, the Tailwind palette and breakpoints (bg-red-500 and sm: do not exist)', async () => {
    const css = await build(['bg-red-500', 'text-slate-900', 'sm:p-2', 'shadow-lg', 'text-5xl']);
    expect(css).not.toMatch(/red-500|slate-900|shadow-lg|text-5xl|sm\\:p-2/u);
  });

  it('[AT-US-101-04] the elevation utilities read the live variable, so the dark theme changes them', async () => {
    const css = await build(['shadow-e2']);
    expect(css).toContain('--tw-shadow: var(--shadow-e2);');
    expect(css).toContain('--shadow-e2: 0px 4px 8px -2px #00000080;');
  });
});
