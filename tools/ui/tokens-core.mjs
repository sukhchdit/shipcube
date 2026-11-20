/**
 * Design-token compiler core (US-101, REQ-UI-001, NFR-A11Y-005; TASK-038). Pure functions over the DTCG source
 * `packages/ui/tokens/tokens.json` (a copy of docs/02-ux/design-system/tokens.json, which a test keeps equal):
 *  - `compileThemeCss` writes the Tailwind 4 theme and the CSS custom properties (committed as
 *    packages/ui/src/theme/tokens.generated.css; tools/ui/tokens-core.test.ts fails when file and source drift apart);
 *  - `knownCssVariables` is the vocabulary the Stylelint rule `platform/token-lint` accepts in `var(--x)`;
 *  - `checkContrast` and `buildTenantOverrideCss` implement the WCAG 2.x contrast test and the tenant override seam
 *    (tokens.md §1 rule 4, D-UX-002): an override is applied through CSS variables only, never by editing a primitive.
 *
 * Variable names follow `$extensions.com.platform.meta.cssVariablePrefixRules` in tokens.json. No dependency.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));

/** Repository-relative POSIX path of the generated theme (also the one file allowed to hold raw values). */
export const GENERATED_THEME_PATH = 'packages/ui/src/theme/tokens.generated.css';
export const TOKENS_PATH = join(HERE, '../../packages/ui/tokens/tokens.json');
export const UX_TOKENS_PATH = join(HERE, '../../docs/02-ux/design-system/tokens.json');

/**
 * @typedef {'light' | 'dark'} Mode
 * @typedef {{ path: string[], key: string, type: string, value: unknown }} FlatToken
 * @typedef {{ name: string, value: string, mode: Mode | null, key: string }} CssVariable
 * @typedef {{ fg: string, bg: string, min: number, expected: number }} ContrastPair
 * @typedef {{ mode: Mode, fg: string, bg: string, min: number, ratio: number, pass: boolean }} ContrastResult
 * @typedef {{
 *   $extensions: {
 *     'com.platform.meta': { tenantOverridable: string[] },
 *     'com.platform.contrastPairs': Record<Mode, ContrastPair[]>,
 *   },
 *   theme: Record<Mode, Record<string, Record<string, { $value: string }>>>,
 * }} TokenTree the parts of the DTCG document this module reads by name; the rest is walked generically
 */

/** @returns {TokenTree} the parsed DTCG tree */
export function loadTokens(path = TOKENS_PATH) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * @param {object} tree
 * @returns {Map<string, FlatToken>} every leaf (an object with `$value`) by dotted path
 */
export function flattenTokens(tree) {
  /** @type {Map<string, FlatToken>} */
  const out = new Map();
  /** @param {any} node @param {string[]} path */
  const walk = (node, path) => {
    for (const [name, child] of Object.entries(node)) {
      if (name.startsWith('$') || child === null || typeof child !== 'object') continue;
      const next = [...path, name];
      if ('$value' in child) out.set(next.join('.'), { path: next, key: next.join('.'), type: child.$type, value: child.$value });
      else walk(child, next);
    }
  };
  walk(tree, []);
  return out;
}

const ALIAS = /^\{([^{}]+)\}$/u;

/**
 * Follows `{a.b.c}` references to the final value.
 * @param {Map<string, FlatToken>} flat
 * @param {unknown} value
 * @param {string[]} [trail]
 * @returns {unknown}
 */
export function resolveValue(flat, value, trail = []) {
  if (typeof value !== 'string') return value;
  const match = ALIAS.exec(value);
  if (!match) return value;
  const target = /** @type {string} */ (match[1]);
  if (trail.includes(target)) throw new Error(`Token alias cycle: ${[...trail, target].join(' -> ')}`);
  const token = flat.get(target);
  if (!token) throw new Error(`Token alias "{${target}}" does not exist`);
  return resolveValue(flat, token.value, [...trail, target]);
}

/**
 * `bgHover` -> `bg-hover`, `skipLink` -> `skip-link`, `2xl` -> `2xl`.
 * @param {string} name
 * @returns {string}
 */
export function kebab(name) {
  return name.replace(/([a-z\d])([A-Z])/gu, '$1-$2').toLowerCase();
}

const GENERIC_FAMILIES = new Set(['ui-sans-serif', 'system-ui', '-apple-system', 'sans-serif', 'ui-monospace', 'monospace']);

/** @param {string} family */
function formatFamily(family) {
  return GENERIC_FAMILIES.has(family) || !/[\s-]/u.test(family) ? family : `'${family}'`;
}

/** @param {any} layer */
function formatShadowLayer(layer) {
  const parts = [layer.inset ? 'inset' : null, layer.offsetX, layer.offsetY, layer.blur, layer.spread, String(layer.color).toLowerCase()];
  return parts.filter((part) => part !== null).join(' ');
}

/**
 * @param {string} type DTCG `$type`
 * @param {any} value a fully resolved `$value`
 * @returns {string}
 */
export function formatValue(type, value) {
  switch (type) {
    case 'color':
      return String(value).toLowerCase();
    case 'fontFamily':
      return /** @type {string[]} */ (value).map(formatFamily).join(', ');
    case 'cubicBezier':
      return `cubic-bezier(${/** @type {number[]} */ (value).join(', ')})`;
    case 'shadow':
      return (Array.isArray(value) ? value : [value]).map(formatShadowLayer).join(', ');
    default:
      return String(value);
  }
}

/**
 * Every CSS custom property a token produces (`cssVariablePrefixRules`). Primitives, typography composites,
 * `font.numeric` and breakpoints (build-time only, tokens.md §2) produce none.
 * @param {Map<string, FlatToken>} flat
 * @returns {CssVariable[]}
 */
export function cssVariables(flat) {
  /** @type {CssVariable[]} */
  const out = [];
  for (const token of flat.values()) {
    const [head = '', a = '', b = '', ...rest] = token.path;
    /** @type {string | null} */
    let name = null;
    /** @type {Mode | null} */
    let mode = null;
    if (head === 'theme') {
      mode = /** @type {Mode} */ (a);
      name = `--color-${[b, ...rest].map(kebab).join('-')}`;
    } else if (head === 'shadow') {
      mode = /** @type {Mode} */ (a);
      name = `--shadow-${kebab(b)}`;
    } else if (head === 'font' && a === 'family') name = `--font-${b}`;
    else if (head === 'font' && a === 'size') name = `--font-size-${b}`;
    else if (head === 'font' && a === 'lineHeight') name = `--line-height-${b}`;
    else if (head === 'font' && a === 'weight') name = `--font-weight-${b}`;
    else if (head === 'space') name = `--space-${a}`;
    else if (head === 'radius') name = `--radius-${a}`;
    else if (head === 'borderWidth') name = `--border-width-${kebab(a)}`;
    else if (head === 'focusRing') name = `--focus-ring-${kebab(a)}`;
    else if (head === 'motion' && a === 'duration') name = `--duration-${b}`;
    else if (head === 'motion' && a === 'easing') name = `--ease-${b}`;
    else if (head === 'motion' && a === 'lift') name = '--motion-lift';
    else if (head === 'size') name = `--size-${token.path.slice(1).map(kebab).join('-')}`;
    else if (head === 'zIndex') name = `--z-${kebab(a)}`;
    if (name === null) continue;
    out.push({ name, value: formatValue(token.type, resolveValue(flat, token.value)), mode, key: token.key });
  }
  const seen = new Set();
  for (const variable of out) {
    const id = `${variable.mode ?? ''}|${variable.name}`;
    if (seen.has(id)) throw new Error(`Two tokens produce the CSS variable ${variable.name}`);
    seen.add(id);
  }
  return out;
}

/**
 * The Tailwind colour utility name of a semantic colour (tokens.md §2: `--color-bg-surface` -> `bg-surface`,
 * `--color-status-danger-fg` -> `text-danger`, `--color-action-primary-bg-hover` -> `bg-action-primary-hover`).
 * @param {string[]} path the token path below `theme.<mode>`
 * @returns {string}
 */
export function colorAlias(path) {
  const [group = '', a = '', b = ''] = path;
  switch (group) {
    case 'bg':
      return kebab(a);
    case 'text':
      return a === 'inverse' ? 'on-inverse' : kebab(a);
    case 'border':
      if (a === 'subtle') return 'hairline';
      return a === 'control' ? 'control' : `${kebab(a)}-edge`;
    case 'focus':
      return a === 'ring' ? 'focus' : 'focus-gap';
    case 'action':
      if (b === 'fg') return `on-action-${a}`;
      if (b === 'bg') return `action-${a}`;
      return b === 'border' ? `action-${a}-edge` : `action-${a}-${kebab(b.replace(/^bg/u, ''))}`;
    case 'status':
      return b === 'fg' ? a : `${a}-${kebab(b)}`;
    default:
      throw new Error(`No Tailwind colour alias rule for theme group "${group}"`);
  }
}

/** The three scopes a theme mode is written under; the tenant override layer reuses them (specificity must match). */
export const THEME_SCOPES = Object.freeze({
  light: ':root',
  dark: ":root[data-theme='dark']",
  system: ":root:not([data-theme='light']):not([data-theme='dark'])",
});

/** @param {string} px */
function pxToRem(px) {
  const match = /^(-?[\d.]+)px$/u.exec(px);
  if (!match) throw new Error(`Expected a px dimension, got "${px}"`);
  return `${Number(match[1]) / 16}rem`;
}

/** @param {string[]} lines @param {string} indent */
const indented = (lines, indent = '  ') => lines.map((line) => `${indent}${line}`);

/** @param {string} selector @param {string[]} lines */
const block = (selector, lines) => [`${selector} {`, ...indented(lines), '}'];

/**
 * The generated theme: Tailwind registration, then the token variables per theme scope.
 * @param {TokenTree} tree
 * @returns {string}
 */
export function compileThemeCss(tree) {
  const flat = flattenTokens(tree);
  const variables = cssVariables(flat);
  const of = (/** @type {Mode | null} */ mode, /** @type {(v: CssVariable) => boolean} */ pick = () => true) =>
    variables.filter((v) => v.mode === mode && pick(v));
  const declare = (/** @type {CssVariable[]} */ list) => list.map((v) => `${v.name}: ${v.value};`);

  const breakpoints = [...flat.values()].filter((t) => t.path[0] === 'breakpoint');
  const colorAliases = of('light', (v) => v.name.startsWith('--color-')).map((v) => {
    const alias = colorAlias(/** @type {FlatToken} */ (flat.get(v.key)).path.slice(2));
    return { alias: `--color-${alias}`, source: v.name };
  });
  const duplicateAlias = colorAliases.find((a, i) => colorAliases.findIndex((b) => b.alias === a.alias) !== i);
  if (duplicateAlias) throw new Error(`Two semantic colours share the Tailwind name ${duplicateAlias.alias}`);
  const selfAlias = colorAliases.find((a) => a.alias === a.source);
  if (selfAlias) throw new Error(`The Tailwind name ${selfAlias.alias} would alias itself`);

  const staticTheme = [
    '--color-*: initial;',
    '--breakpoint-*: initial;',
    ...breakpoints.map((t) => `--breakpoint-${t.path[1]}: ${t.value};`),
    // The 4 px base: Tailwind multiplies it, so p-2 is 8 px and p-4 is 16 px (the --space-* scale is on the same grid).
    '--spacing: 0.25rem;',
    '--radius-*: initial;',
    ...declare(of(null, (v) => v.name.startsWith('--radius-'))),
    ...declare(of(null, (v) => v.name === '--font-sans' || v.name === '--font-mono' || v.name.startsWith('--font-weight-'))),
    '--ease-*: initial;',
    ...declare(of(null, (v) => v.name.startsWith('--ease-'))),
    '--container-*: initial;',
    ...[
      ['page', 'size.layout.containerMax'],
      ['wide', 'size.layout.containerWide'],
      ['form', 'size.layout.formNarrow'],
      ['reading', 'size.layout.reading'],
    ].map(
      ([name, key]) =>
        `--container-${name}: ${pxToRem(String(resolveValue(flat, /** @type {FlatToken} */ (flat.get(String(key))).value)))};`,
    ),
  ];

  const display = /** @type {Record<string, string>} */ (
    resolveValue(flat, /** @type {FlatToken} */ (flat.get('typography.display')).value)
  );
  const fontSizes = of(null, (v) => v.name.startsWith('--font-size-'));
  const inlineTheme = [
    ...colorAliases.map((a) => `${a.alias}: var(${a.source});`),
    '--text-*: initial;',
    ...fontSizes.flatMap((v) => {
      const step = v.name.replace('--font-size-', '');
      const lineHeight = `--line-height-${step}`;
      const base = [`--text-${step}: var(${v.name});`, `--text-${step}--line-height: var(${lineHeight});`];
      // text-base is the Tailwind spelling of the 16 px step (font.size.md) the scaffold already uses.
      return step === 'md' ? [...base, `--text-base: var(${v.name});`, `--text-base--line-height: var(${lineHeight});`] : base;
    }),
    // Display type, home hero only (tokens.md §4): 28/36 below 1024 px (typography.display), 36/44 from 1024 px.
    `--text-display: ${display['fontSize']};`,
    `--text-display--line-height: ${display['lineHeight']};`,
    '--text-display-lg: var(--font-size-4xl);',
    '--text-display-lg--line-height: var(--line-height-4xl);',
    ...of(null, (v) => v.name.startsWith('--duration-')).map(
      (v) => `--transition-duration-${v.name.replace('--duration-', '')}: var(${v.name});`,
    ),
    // Elevation differs per theme, so the utility must read the live variable (Tailwind would otherwise inline the light value).
    '--shadow-*: initial;',
    ...of('light', (v) => v.name.startsWith('--shadow-')).map((v) => `${v.name}: var(${v.name});`),
  ];

  const shared = of(
    null,
    (v) =>
      !['--font-sans', '--font-mono'].includes(v.name) &&
      !v.name.startsWith('--ease-') &&
      !v.name.startsWith('--radius-') &&
      !v.name.startsWith('--font-weight-'),
  );
  const colours = (/** @type {Mode} */ mode) => [
    ...declare(of(mode, (v) => v.name.startsWith('--color-'))),
    ...declare(of(mode, (v) => v.name.startsWith('--shadow-'))),
  ];
  const darkOnly = [...colours('dark'), 'color-scheme: dark;'];
  const reducedMotion = [...of(null, (v) => v.name.startsWith('--duration-')).map((v) => `${v.name}: 0ms;`), '--motion-lift: 0px;'];

  const lines = [
    '/*',
    ' * GENERATED by tools/ui/compile-tokens.mjs from packages/ui/tokens/tokens.json (US-101, tokens.md §2). Do not edit:',
    ' * run `npm run tokens:build`. tools/ui/tokens-core.test.ts fails when this file and the source drift apart.',
    ' * This is the only stylesheet that may hold raw colour values (platform/token-lint is off for it, stylelint.config.mjs).',
    ' */',
    '',
    '/* The default Tailwind palette, breakpoints, radii, shadows and easings are replaced, not extended (tokens.md §2). */',
    ...block('@theme static', staticTheme),
    '',
    ...block('@theme inline', inlineTheme),
    '',
    '/* Light theme (default): semantic colours plus the scale tokens. */',
    ...block(THEME_SCOPES.light, [...declare(shared), ...colours('light'), 'color-scheme: light;']),
    '',
    '/* Dark theme: explicit data-theme="dark", or data-theme="system" (and no attribute) under prefers-color-scheme. */',
    ...block(THEME_SCOPES.dark, darkOnly),
    '',
    '@media (prefers-color-scheme: dark) {',
    ...indented(block(THEME_SCOPES.system, darkOnly)),
    '}',
    '',
    '/* Every duration resolves to 0 ms under reduced motion and the card lift to 0 (tokens.md §7). */',
    '@media (prefers-reduced-motion: reduce) {',
    ...indented(block(':root', reducedMotion)),
    '}',
    '',
  ];
  return lines.join('\n');
}

/**
 * Every CSS variable the platform defines or registers: the token variables plus the Tailwind-registered names in the
 * generated theme. Parsed from the compiled text so the rule and the stylesheet cannot disagree.
 * @param {TokenTree} tree
 * @returns {Set<string>}
 */
export function knownCssVariables(tree) {
  const names = new Set(['--spacing']);
  for (const match of compileThemeCss(tree).matchAll(/^\s*(--[\w-]+):/gmu)) names.add(/** @type {string} */ (match[1]));
  return names;
}

/**
 * The px values of the 4/8 grid scale (`space.*`), as numbers.
 * @param {object} tree
 * @returns {number[]}
 */
export function spaceScalePx(tree) {
  const values = [...flattenTokens(tree).values()].filter((t) => t.path[0] === 'space').map((t) => Number.parseFloat(String(t.value)));
  return [...new Set(values)].sort((x, y) => x - y);
}

/* ---------------------------------------------------------------------------------------------------------------
 * Contrast (WCAG 2.x), tenant override.
 * ------------------------------------------------------------------------------------------------------------- */

/** @param {string} hex `#rgb`, `#rrggbb` or `#rrggbbaa` (alpha ignored: contrast pairs are opaque) */
export function hexToRgb(hex) {
  const digits = hex.replace(/^#/u, '');
  const full = digits.length <= 4 ? [...digits].map((d) => d + d).join('') : digits;
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16));
}

/** @param {string} hex */
export function relativeLuminance(hex) {
  const [r = 0, g = 0, b = 0] = hexToRgb(hex).map((channel) => {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {string} fg @param {string} bg */
export function contrastRatio(fg, bg) {
  const [hi = 0, lo = 0] = [relativeLuminance(fg), relativeLuminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * The resolved semantic colours of one theme, keyed by path below `theme.<mode>` (`text.primary`).
 * @param {TokenTree} tree
 * @param {Mode} mode
 * @param {Record<string, string>} [overrides] full token paths (`theme.light.text.link`) -> hex
 * @returns {Map<string, string>}
 */
export function themeColors(tree, mode, overrides = {}) {
  const flat = flattenTokens(tree);
  /** @type {Map<string, string>} */
  const colors = new Map();
  for (const token of flat.values()) {
    if (token.path[0] !== 'theme' || token.path[1] !== mode) continue;
    const local = token.path.slice(2).join('.');
    colors.set(local, String(overrides[token.key] ?? resolveValue(flat, token.value)).toLowerCase());
  }
  return colors;
}

/**
 * Recomputes every pair of `$extensions.com.platform.contrastPairs` for a theme (tokens.md §3.3).
 * @param {TokenTree} tree
 * @param {Mode} mode
 * @param {Record<string, string>} [overrides]
 * @returns {ContrastResult[]}
 */
export function checkContrast(tree, mode, overrides = {}) {
  const colors = themeColors(tree, mode, overrides);
  /** @type {ContrastPair[]} */
  const pairs = tree.$extensions['com.platform.contrastPairs'][mode];
  return pairs.map((pair) => {
    const fg = colors.get(pair.fg);
    const bg = colors.get(pair.bg);
    if (fg === undefined || bg === undefined) throw new Error(`Contrast pair ${pair.fg} on ${pair.bg} names an unknown token (${mode})`);
    const ratio = contrastRatio(fg, bg);
    return { mode, fg: pair.fg, bg: pair.bg, min: pair.min, ratio, pass: ratio >= pair.min };
  });
}

const HEX_COLOUR = /^#(?:[\da-f]{3}|[\da-f]{6})$/iu;

/**
 * The tenant/brand override layer (tokens.md §1 rule 4 and §11, D-UX-002): a stylesheet that re-declares the
 * `tenantOverridable` semantic variables under the same theme scopes, emitted after the base theme. A token that is not
 * overridable or not a hex colour is rejected; an override set that breaks any contrast pair of its theme is rejected
 * as a whole for that theme (the default stays), and the rejection names the failing pair.
 * @param {TokenTree} tree
 * @param {Record<string, string>} overrides full token path -> hex, e.g. `{ 'theme.light.action.primary.bg': '#0b5cad' }`
 * @returns {{ css: string, applied: string[], rejected: { token: string, reason: string }[] }}
 */
export function buildTenantOverrideCss(tree, overrides) {
  const allowed = new Set(/** @type {string[]} */ (tree.$extensions['com.platform.meta'].tenantOverridable));
  const flat = flattenTokens(tree);
  /** @type {{ token: string, reason: string }[]} */
  const rejected = [];
  /** @type {string[]} */
  const applied = [];
  /** @type {Record<Mode, Record<string, string>>} */
  const byMode = { light: {}, dark: {} };
  for (const [token, value] of Object.entries(overrides)) {
    if (!allowed.has(token)) rejected.push({ token, reason: 'not tenant-overridable' });
    else if (!HEX_COLOUR.test(value)) rejected.push({ token, reason: `"${value}" is not a #rgb or #rrggbb colour` });
    else byMode[/** @type {Mode} */ (/** @type {FlatToken} */ (flat.get(token)).path[1])][token] = value.toLowerCase();
  }
  /** @type {Record<Mode, string[]>} */
  const declarations = { light: [], dark: [] };
  for (const mode of /** @type {Mode[]} */ (['light', 'dark'])) {
    const set = byMode[mode];
    const tokens = Object.keys(set);
    if (tokens.length === 0) continue;
    const failing = checkContrast(tree, mode, set).filter((r) => !r.pass);
    if (failing.length > 0) {
      for (const token of tokens) {
        rejected.push({ token, reason: failing.map((r) => `${r.fg} on ${r.bg} is ${r.ratio.toFixed(2)}:1, below ${r.min}:1`).join('; ') });
      }
      continue;
    }
    for (const token of tokens) {
      const variable = /** @type {CssVariable} */ (cssVariables(flat).find((v) => v.key === token));
      declarations[mode].push(`${variable.name}: ${set[token]};`);
      applied.push(token);
    }
  }
  const css = [
    ...(declarations.light.length ? block(THEME_SCOPES.light, declarations.light) : []),
    ...(declarations.dark.length
      ? [
          ...block(THEME_SCOPES.dark, declarations.dark),
          '@media (prefers-color-scheme: dark) {',
          ...indented(block(THEME_SCOPES.system, declarations.dark)),
          '}',
        ]
      : []),
  ].join('\n');
  return { css: css === '' ? '' : `${css}\n`, applied, rejected };
}
