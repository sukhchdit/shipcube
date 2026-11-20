# Design tokens

`tokens.json` is the DTCG source of the design system (US-101). It is a copy of `docs/02-ux/design-system/tokens.json`,
the UX hand-off; `tools/ui/tokens-core.test.ts` fails when the two differ, so change both together.

- **Compile:** `npm run tokens:build` writes `../src/theme/tokens.generated.css` (the Tailwind 4 theme, the CSS variables,
  light and dark). The file is committed; the drift test fails when it is stale. `../src/theme.css` imports it and holds
  the hand-written base layer (no raw values). Apps import `@platform/ui/theme.css`.
- **Use:** utilities (`bg-surface`, `text-muted`, `p-2`, `rounded-md`, `shadow-e2`, `duration-fast`) or `var(--token)`.
  Never `#hex`, `rgb()`, `hsl()` or an off-grid length: `platform/token-lint` (Stylelint, `npm run lint`) rejects them,
  and `var(--x)` of a token that does not exist. The generated file is the only stylesheet allowed to hold raw values.
- **Contrast:** `tools/ui/contrast.test.ts` recomputes every pair in `$extensions.com.platform.contrastPairs` per theme.
- **Tenant and brand override:** `buildTenantOverrideCss` (`tools/ui/tokens-core.mjs`) emits a stylesheet that re-declares
  only the `tenantOverridable` semantic variables, after the theme, under the same scopes. A value that is not a hex
  colour, a token that is not listed, or a set that fails a contrast pair of its theme is rejected and the default stays.
  Primitives are never edited.
