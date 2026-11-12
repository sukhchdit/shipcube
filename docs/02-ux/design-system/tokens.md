# Design tokens

Version 1.0 · 2026-11-12 · owner ux-designer · stories US-101, US-102, US-103, US-107, US-120 · NFR-A11Y-005, NFR-A11Y-006

The machine-readable source is [`tokens.json`](tokens.json) (W3C Design Tokens Community Group format with `{alias}` references). `packages/ui` turns it into CSS custom properties and a Tailwind preset. This page explains the tokens and gives their contrast evidence.

## 1. Principles

1. **Feature code never uses raw values.** Colours, spacing, radii, shadows, durations and z-indices come only from tokens. This is enforced by the token lint in US-101 (`#hex`, `rgb()`, off-grid `px` and unknown `var(--…)` all fail).
2. **Use semantic tokens, not primitives.** Components consume `theme.*` tokens such as `--color-text-muted`. Primitive tokens (`color.primitive.*`) exist only so the theme can alias them.
3. **Three theme modes.** `data-theme="light" | "dark" | "system"` sits on `<html>`. `system` follows `prefers-color-scheme`. An invalid stored value falls back to `system` (US-102).
4. **Tenant theming.** A tenant can override only the tokens listed in `$extensions.com.platform.meta.tenantOverridable` (primary action, link, focus ring, selected). Every override must pass the contrast-pair test. A failing pair rejects that override for that theme and the default is used (D-UX-002).
5. **Root font size is not changed.** `html { font-size: 100% }` respects the user's browser setting. Base UI text is `0.875rem` (14 px at default). All type and control sizes use `rem`, so text zoom and 200% scaling work.

## 2. CSS variable naming and the Tailwind mapping

| Token path | CSS variable | Tailwind utility (preset) |
|---|---|---|
| `theme.<mode>.bg.surface` | `--color-bg-surface` | `bg-surface` |
| `theme.<mode>.text.muted` | `--color-text-muted` | `text-muted` |
| `theme.<mode>.border.control` | `--color-border-control` | `border-control` |
| `theme.<mode>.action.primary.bgHover` | `--color-action-primary-bg-hover` | `bg-action-primary-hover` |
| `theme.<mode>.status.danger.fg` | `--color-status-danger-fg` | `text-danger` |
| `space.2` | `--space-2` (8px) | `p-2`, `gap-2` (the Tailwind spacing scale is replaced by the token scale) |
| `radius.md` | `--radius-md` | `rounded-md` |
| `shadow.<mode>.e2` | `--shadow-e2` | `shadow-e2` |
| `motion.duration.fast` | `--duration-fast` | `duration-fast` |
| `breakpoint.md` | n/a (build-time) | `md:` (screens: `xs` 360, `md` 768, `lg` 1024, `xl` 1280, `2xl` 1536; Tailwind's default `sm` 640 is removed, D-UX-003) |

The preset replaces the Tailwind defaults for `colors`, `spacing`, `borderRadius`, `boxShadow`, `transitionDuration`, `screens`, `zIndex` and `fontSize`. It does not extend them, so a utility like `bg-red-500` simply does not exist.

## 3. Colour

### 3.1 Primitive palette (neutral placeholder brand)

| Family | Steps used | Notes |
|---|---|---|
| slate | 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950 | Neutrals for both themes |
| blue | 50, 100, 300, 400, 500, 600, 700, 900, 950 | Placeholder brand primary, info |
| green | 50, 400, 700, 800, 950 | Success |
| amber | 50, 400, 700, 800, 950 | Warning, test mode, unreviewed data |
| red | 50, 300, 400, 600, 700, 950 | Danger, errors |

The hex values and relative luminance (L) of each step are in `tokens.json`. The palette is generic and carries no brand identity. `BRAND_*` configuration replaces the primary family.

### 3.2 Semantic roles

| Role | Light | Dark | Use |
|---|---|---|---|
| `bg.canvas` | slate-50 | slate-950 | Page background |
| `bg.surface` | white | slate-900 | Cards, inputs, header, tables |
| `bg.raised` | white (+shadow) | slate-800 | Menus, popovers, dialogs, sheets |
| `bg.subtle` | slate-100 | slate-800 | Table header, inset panels |
| `bg.hover` | slate-100 | slate-800 | Row and list hover (only under `hover: hover`) |
| `bg.selected` | blue-50 | blue-950 | Selected card or row, current navigation item |
| `bg.skeleton` | slate-200 | slate-800 | Skeleton blocks (static, no shimmer, D-UX-012) |
| `text.primary` | slate-900 | slate-50 | Body and headings |
| `text.secondary` | slate-700 | slate-300 | Supporting text |
| `text.muted` | slate-600 | slate-400 | Hints, metadata, timestamps |
| `text.placeholder` | slate-500 | slate-400 | Input placeholders (never the only label) |
| `text.disabled` | slate-400 | slate-600 | Disabled control text (contrast-exempt) |
| `text.link` | blue-700 | blue-400 | Inline links (always underlined in body text) |
| `border.subtle` | slate-200 | slate-800 | Decorative dividers only |
| `border.control` | slate-500 | slate-500 | Input and checkbox borders, secondary buttons, card outlines that act as the only boundary |
| `border.selected` | blue-600 | blue-400 | Selected card (2 px) |
| `action.primary.*` | blue-600 / 700 / 900, white text | blue-400 / 300 / 500, slate-950 text | Primary buttons |
| `action.danger.*` | red-600 / 700 / 950, white text | red-400 / 300 / 400 (+inset), slate-950 text | Destructive buttons |
| `focus.ring` | blue-600 | blue-400 | 2 px ring with a 2 px offset in `focus.offset` |
| `status.success` | fg green-700, bg green-50 | fg green-400, bg green-950 | Delivered, booked, saved, "Cheapest" badge |
| `status.warning` | fg amber-700, strong amber-800, bg amber-50 | fg amber-400, bg amber-950 | Test mode, unreviewed or sample data, expiring quotes, partial results |
| `status.danger` | fg red-700, bg red-50 | fg red-400, bg red-950 | Errors, exceptions, prohibited items |
| `status.info` | fg blue-700, bg blue-50 | fg blue-300, bg blue-950 | Information, "Fastest" badge, in-transit |
| `status.neutral` | fg slate-700, bg slate-100 | fg slate-300, bg slate-800 | Draft, cancelled, unknown |

**Colour is never the only signal.** Every status badge, inline alert and validation message also has an icon and text (US-102, US-106). The icon is the same in light and dark themes.

### 3.3 Contrast evidence (computed, WCAG 2.x relative luminance)

The ratios were computed for the default palette with the WCAG formula (sRGB linearisation, `(L1 + 0.05) / (L2 + 0.05)`). The CI contrast test reads `$extensions.com.platform.contrastPairs` from `tokens.json` and recomputes every pair in both themes. Thresholds: 4.5:1 for text, 3:1 for UI components, borders and focus indicators.

**Light theme**

| Foreground | Background | Ratio | Min | Result |
|---|---|---|---|---|
| text.primary #0F172A | bg.surface #FFFFFF | 17.85 | 4.5 | Pass |
| text.primary | bg.canvas #F8FAFC | 17.06 | 4.5 | Pass |
| text.primary | bg.subtle #F1F5F9 | 16.30 | 4.5 | Pass |
| text.primary | bg.selected #EFF6FF | 16.40 | 4.5 | Pass |
| text.secondary #334155 | bg.surface / canvas / subtle / selected | 10.35 / 9.89 / 9.45 / 9.51 | 4.5 | Pass |
| text.muted #475569 | bg.surface / canvas / subtle / selected | 7.58 / 7.24 / 6.92 / 6.96 | 4.5 | Pass |
| text.placeholder #64748B | bg.surface | 4.76 | 4.5 | Pass (placeholders appear only on surface) |
| text.link #1D4ED8 | bg.surface / canvas / subtle | 6.70 / 6.41 / 6.12 | 4.5 | Pass |
| action.primary.fg #FFFFFF | action.primary.bg #2563EB / hover #1D4ED8 / active #1E3A8A | 5.17 / 6.70 / 10.36 | 4.5 | Pass |
| action.danger.fg #FFFFFF | danger.bg #DC2626 / hover #B91C1C / active #450A0A | 4.83 / 6.47 / 16.14 | 4.5 | Pass |
| action.secondary.fg #0F172A | secondary.bg #FFFFFF / hover #F1F5F9 / active #E2E8F0 | 17.85 / 16.30 / 14.48 | 4.5 | Pass |
| border.control #64748B | bg.surface / canvas | 4.76 / 4.55 | 3.0 | Pass |
| border.selected #2563EB | bg.surface | 5.17 | 3.0 | Pass |
| focus.ring #2563EB | bg.surface / canvas / subtle | 5.17 / 4.94 / 4.72 | 3.0 | Pass |
| status.success.fg #15803D | bg.surface / success.bg #F0FDF4 | 5.02 / 4.79 | 4.5 | Pass |
| status.success.strong #166534 | success.bg | 6.81 | 4.5 | Pass |
| status.warning.fg #B45309 | bg.surface / warning.bg #FFFBEB | 5.02 / 4.84 | 4.5 | Pass |
| status.warning.strong #92400E | warning.bg | 6.84 | 4.5 | Pass |
| status.danger.fg #B91C1C | bg.surface / danger.bg #FEF2F2 | 6.47 / 5.91 | 4.5 | Pass |
| status.info.fg #1D4ED8 | info.bg #EFF6FF | 6.16 | 4.5 | Pass |
| status.neutral.fg #334155 | neutral.bg #F1F5F9 | 9.45 | 4.5 | Pass |

**Dark theme**

| Foreground | Background | Ratio | Min | Result |
|---|---|---|---|---|
| text.primary #F8FAFC | bg.canvas #020617 / surface #0F172A / raised #1E293B / selected #172554 | 19.28 / 17.06 / 13.98 / 14.05 | 4.5 | Pass |
| text.secondary #CBD5E1 | canvas / surface / raised / selected | 13.59 / 12.02 / 9.85 / 9.90 | 4.5 | Pass |
| text.muted #94A3B8 | canvas / surface / raised / selected | 7.87 / 6.96 / 5.70 / 5.73 | 4.5 | Pass |
| text.placeholder #94A3B8 | bg.surface | 6.96 | 4.5 | Pass |
| text.link #60A5FA | canvas / surface / raised | 7.94 / 7.02 / 5.75 | 4.5 | Pass |
| action.primary.fg #020617 | primary.bg #60A5FA / hover #93C5FD / active #3B82F6 | 7.94 / 11.19 / 5.48 | 4.5 | Pass |
| action.danger.fg #020617 | danger.bg #F87171 / hover #FCA5A5 | 7.29 / 10.63 | 4.5 | Pass |
| action.secondary.fg #F8FAFC | secondary.bg #0F172A / hover #1E293B / active #334155 | 17.06 / 13.98 / 9.89 | 4.5 | Pass |
| border.control #64748B | canvas / surface / raised | 4.24 / 3.75 / 3.07 | 3.0 | Pass (raised is the tightest; do not place controls on a lighter surface than raised) |
| border.selected #60A5FA | bg.raised | 5.75 | 3.0 | Pass |
| focus.ring #60A5FA | canvas / surface / raised | 7.94 / 7.02 / 5.75 | 3.0 | Pass |
| status.success.fg #4ADE80 | surface / success.bg #052E16 | 10.24 / 8.55 | 4.5 | Pass |
| status.warning.fg #FBBF24 | surface / warning.bg #451A03 | 10.69 / 8.97 | 4.5 | Pass |
| status.danger.fg #F87171 | surface / danger.bg #450A0A | 6.45 / 5.84 | 4.5 | Pass |
| status.info.fg #93C5FD | info.bg #172554 | 8.15 | 4.5 | Pass |
| status.neutral.fg #CBD5E1 | neutral.bg #1E293B | 9.85 | 4.5 | Pass |

**Exempt pairs.** `text.disabled` (WCAG 1.4.3 exception for inactive components). `border.subtle` (decorative, never the only control boundary). `bg.skeleton` (decorative). The pairs a developer must not create are listed below. The contrast test also flags them if a component spec references them.

| Never use | Why |
|---|---|
| `text.placeholder` (light) on `bg.subtle` | 4.34:1, below 4.5 |
| White text on light `blue-500` (#3B82F6) | 3.68:1 |
| `border.subtle` as the only border of an input or card | below 3:1 |
| Dark `red-600` as a button background with dark text | 4.18:1 |

## 4. Typography

The font stack is the system stack only: no web fonts, no font downloads and no licensing (D-UX-001). Numbers in prices, weights, tables, countdowns and codes use `font-variant-numeric: tabular-nums`.

| Token | Size / line height (< 1024 px) | ≥ 1024 px | Weight | Use |
|---|---|---|---|---|
| `display` | 28 / 36 | 36 / 44 | 600 | Home hero heading only |
| `h1` | 24 / 32 | 30 / 38 | 600 | One per page (US-106) |
| `h2` | 20 / 28 | 24 / 32 | 600 | Section titles |
| `h3` | 18 / 26 | 18 / 26 | 600 | Card titles, sub-sections |
| `h4` | 14 / 20 | 14 / 20 | 600 | Group labels, table headers |
| `body` | 14 / 20 | 14 / 20 | 400 | Base UI text (brief §8) |
| `bodyLarge` | 16 / 24 | 16 / 24 | 400 | Lead paragraphs, legal prose |
| `label` | 14 / 20 | 14 / 20 | 500 | Form labels, buttons |
| `caption` | 12 / 16 | 12 / 16 | 400 | Badges, footnotes. Never for errors or prices. |
| `price` | 20 / 28 | 20 / 28 | 600 | Totals on result cards and summaries |
| `mono` | 14 / 20 | 14 / 20 | 400 | Tracking numbers, order numbers, hashes, recovery codes |

**Input text size.** Input text is 16 px under `@media (pointer: coarse)` so iOS Safari does not zoom on focus, and 14 px under `pointer: fine` (D-UX-004). Line length for prose is at most 72ch (`size.layout.reading`, 720 px).

## 5. Spacing (4/8 grid)

| Token | Value | Typical use |
|---|---|---|
| `space.1` | 4 px | Icon-to-text gap, badge padding (block) |
| `space.2` | 8 px | Control internal gap, tight stacks |
| `space.3` | 12 px | Input padding (inline), table cell padding (inline) |
| `space.4` | 16 px | Card padding (mobile), mobile gutter, form field gap |
| `space.5` | 20 px | Between field groups |
| `space.6` | 24 px | Card padding (desktop), tablet gutter |
| `space.8` | 32 px | Section gap, desktop gutter |
| `space.10` | 40 px | Page section separation (mobile) |
| `space.12` | 48 px | Page section separation (desktop) |
| `space.16` / `20` / `24` | 64 / 80 / 96 px | Hero and marketing blocks |

Any value off this scale fails the US-101 lint. The only exceptions are `borderWidth` (1 or 2 px) and `focusRing` (2 px).

## 6. Radius, borders and elevation

| Token | Value | Use |
|---|---|---|
| `radius.sm` | 4 px | Badges, chips, checkbox |
| `radius.md` | 8 px | Buttons, inputs, cards, table container |
| `radius.lg` | 12 px | Dialogs, sheets, popovers, toasts |
| `radius.full` | 9999 px | Switch track, monogram, pill badges |
| `borderWidth.hairline` | 1 px | Default |
| `borderWidth.thick` | 2 px | Selected card, invalid input, focus ring |
| `shadow.e1` | resting card | Result cards, panels |
| `shadow.e2` | hover lift, sticky bars | Card hover (with `motion.lift` -2 px, `hover: hover` only), sticky action bar, sticky summary |
| `shadow.e3` | popover | Menus, combobox list, toast |
| `shadow.e4` | modal | Dialog, drawer, bottom sheet |
| `shadow.pressed` | inset | Active state of buttons (both themes); the active state of the dark danger button |

In dark mode, elevation comes from lighter surfaces (`bg.raised`) as well as the darker shadows.

## 7. Motion

| Token | Value | Use |
|---|---|---|
| `motion.duration.fast` | 120 ms | Colour, background and border changes on hover, active and focus |
| `motion.duration.base` | 150 ms | Disclosure open, card lift, toast enter, skeleton-to-content cross-fade |
| `motion.duration.slow` | 180 ms | Dialog, drawer, bottom sheet, toast exit |
| `motion.duration.instant` | 0 ms | Every duration under `prefers-reduced-motion: reduce` |
| `motion.easing.standard` | cubic-bezier(0.2, 0, 0, 1) | Default |
| `motion.easing.enter` | cubic-bezier(0, 0, 0.2, 1) | Elements appearing |
| `motion.easing.exit` | cubic-bezier(0.4, 0, 1, 1) | Elements leaving |

Rules:
- Only `opacity`, `transform`, `background-color`, `border-color`, `color` and `box-shadow` are animated. Height is never animated. Disclosures use an opacity fade plus `grid-template-rows` snap, so there is no layout jank.
- Under `prefers-reduced-motion: reduce`, every duration resolves to 0 ms, `motion.lift` resolves to 0 and there is no auto-playing motion. Skeletons are always static (D-UX-012).
- The lint rejects any transition outside 120 to 180 ms (US-103), except the reduced-motion 0 ms value.
- Hover styles are declared only inside `@media (hover: hover)` (stylelint, NFR-A11Y-006).

## 8. Sizes, density and layout

| Token | Value | Notes |
|---|---|---|
| `size.control.fine` | 36 px | Control height on `pointer: fine` |
| `size.control.coarse` | 44 px | Control height and minimum width on `pointer: coarse` |
| `size.control.largeFine` / `largeCoarse` | 44 / 48 px | "Get quotes", "Pay", "Book this service" |
| `size.target.min` | 44 px | Minimum touch target. Inline text links inside sentences are the only exception (NFR-A11Y-004 exception list). |
| `size.icon.sm/md/lg` | 16 / 20 / 24 px | Icons inside controls: 16 (fine) or 20 (coarse) |
| `size.layout.header*` | 56 / 64 px | Mobile / desktop header height |
| `size.layout.sidebar*` | 240 / 64 px | Admin sidebar expanded / collapsed |
| `size.layout.stickyActionBar` | 64 px + `env(safe-area-inset-bottom)` | Mobile wizard, checkout and results compare tray |
| `size.layout.summaryColumn` | 360 px | Sticky price summary (≥ 1024 px) |
| `size.table.rowComfortable` / `rowCompact` | 48 / 36 px | Admin density (comfortable is the default) |
| Gutters | 16 / 24 / 32 px | < 768, 768 to 1023, ≥ 1024 |

**Scroll padding.** `html { scroll-padding-block-start: <header height + 8px>; scroll-padding-block-end: <sticky bar height + 8px> }` on pages with sticky regions, so focused elements are never hidden (WCAG 2.4.11, NFR-A11Y-003).

## 9. Breakpoints

| Name | Min width | Layout changes |
|---|---|---|
| (base) | 0 (designed at 360, reflows at 320) | Single column, card lists, drawer navigation, sticky bottom action bar, bottom sheets |
| `md` | 768 px | Data tables replace card lists. Two-column field rows (postcode with country, city with state). Results filters in a side sheet. |
| `lg` | 1024 px | Admin sidebar fixed. Wizard stepper on the start side with a sticky summary on the end side. Account side navigation. Web header shows the full navigation. |
| `xl` | 1280 px | Desktop baseline. Admin side-panel previews. Results side column. |
| `2xl` | 1536 px | Admin grids widen to `containerWide`. Customer content stays at 1280 max. |

## 10. z-index scale

`base 0 < raised 1 < sticky 10 < header 20 < drawer 30 < popover 40 < dialog 50 < toast 60 < skipLink 70`. Popovers inside dialogs are portalled and inherit `popover` above the dialog content by Radix stacking. Toasts always sit above dialogs so a dialog action's outcome is visible.

## 11. Tenant and brand configuration (seam, D-UX-002)

| Configuration | Affects | Validation |
|---|---|---|
| `BRAND_NAME` | Header wordmark, `<title>` suffix, email sender display name, legal text placeholders | Non-empty, at most 40 characters. A literal brand string in code fails lint (US-108). |
| `BRAND_LOGO_URL` / `BRAND_LOGO_DARK_URL` | Header and email logo (SVG preferred, reserved 32 px height, width from the asset's aspect ratio declared in config so there is no CLS) | Must exist at build time. Without it, a text-only wordmark renders. |
| `BRAND_PRIMARY_*` (light: 600/700/900; dark: 400/300/500) | The `tenantOverridable` tokens | Contrast-pair test; on failure the default is used and a warning is logged. |
| `BRAND_FAVICON_URL` | Favicon | Optional |

Theming UI for tenants is out of scope (US-101 note). Only the data seam exists.
