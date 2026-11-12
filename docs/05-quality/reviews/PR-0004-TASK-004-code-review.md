# Code review: PR #4, TASK-004 (web and admin app scaffolds), round 1

| Field | Value |
|---|---|
| PR | https://github.com/sukhchdit/shipcube/pull/4 |
| Branch / head | `feat/TASK-004-web-admin-app-scaffolds` @ `519bb89` (5 commits over merge-base `4da693a`) |
| Reviewer | code-reviewer (independent), 2026-11-12 |
| Inputs | WAVE-00.md §TASK-004; ADR-0026 §1, §2, §10 and amendments 4, 5, 10, 12; platform.md §3.3; NFR-WEB-004/005, NFR-COMPAT-001/002; tokens.json; accessibility.md §2; PR body; drafted harness ([PR comment 6823848131](https://github.com/sukhchdit/shipcube/pull/4#issuecomment-6823848131)); PR-0001 review item m8 |
| Host constraint | Memory-constrained host with 8 reviewers in parallel. I did not run `npm ci`, a build, Docker or a full suite. I ran one targeted test file, a Prettier check, a lint probe with the TASK-002 config, and inspected the existing `build/` output in the worktree (read-only). |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The scaffold is clean, well-documented code. The prerender, the 302 redirect, the custom entry without isbot,
         the jsdom project, the token theme and the no-literal-string lookup all do what ADR-0026 asks.
         The only MAJOR is the open acceptance criterion: the Playwright + axe smoke on 3 engines x 2 widths is not
         committed (cooldown). The PR has to wait for that commit, or the orchestrator has to split the AC formally.
         Eight MINORs, chiefly: not-found pages are titled "Loading"/"Operator console"; SPA-fallback routes in es/fr
         are not hydration-safe; Nginx has no compression; about 25 lint errors are predicted against TASK-002's rules.
```

## 1. Verification performed by the reviewer

All Node commands ran under `export PATH="$APPDATA/fnm/aliases/default:$PATH"` (Node 24).

| Check | Result |
|---|---|
| `jest --selectProjects unit-dom --testPathPatterns apps/web/app/routes/locale-layout` | 1 suite, **3/3 passed**. The jsdom environment, the `@platform/source` + `browser` conditions, the CSS stub and jest-dom setup all work. |
| `prettier --check` on every changed file (excluding the lockfile) | Clean. The two `.conf.template` files have no Prettier parser; `format:check .` skips them. |
| **Lint probe with the TASK-002 rules** (PR #2 @ `9bc9c04`): its React, i18next, jsx-a11y-x and no-console blocks, without type information, applied to this tree from a scratch config | **24 errors**, listed in §4. jsx-a11y-x reports nothing. |
| Built output in the worktree (`apps/web/build`, `apps/admin/build`; read-only) | `es/index.html` has `<html lang="es">`, a localised `<title>`, the description, the canonical link, 4 `hreflang` alternates with x-default → `/en/`, the raw `<h1>` and `"isSpaMode":false`. The SPA fallback `index.html` has `lang="en"`, `<title>Loading</title>`, `"isSpaMode":true` and no canonical. The admin fallback is titled `Operator console`. |
| Built CSS | The skip-link utilities are emitted in a working order (`focus:not-sr-only` comes before `focus:fixed` and `focus:px-4`/`py-2`). `--z-skip-link:70` is kept. `inset-bs-4` maps to `inset-block-start`, and `start-4` to `inset-inline-start`. |
| Lockfile delta | Adds `size-limit`, `@size-limit/file`, `lilconfig` and `nanospinner`, all MIT. Nothing else changes. |
| React Router 8.5.1 source | Verified two behaviours. Meta inheritance (`components.js`: a leaf route with no `meta` inherits its parent's). SPA-mode hydration (`routes.js` `shouldHydrateRouteLoader`: in SPA mode non-root routes hydrate, so the root `HydrateFallback` is rendered during hydration). |
| `git status --porcelain` afterwards | Clean. |

These were **not re-run** (host constraint), so I relied on the PR evidence: `npm ci`, full `lint`/`typecheck`/`test:unit` (157/157), `test:integration` (5/5), `build` + size, `npm audit`, and post-build `git status`. **No `test:coverage` evidence was given** (see m8).

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| M1 | **MAJOR** | `tests/e2e/*` (absent) | The TASK-004 acceptance criterion "Playwright smoke passes on Chromium, Firefox, WebKit at 360 and 1280 px with 0 serious/critical axe violations" is **not met at this head**. The DoD also asks for "axe 0 serious/critical in every state", and CLAUDE.md §8 requires the AC to be demonstrated by tests before merge. The PR states this openly; the cause is the 7-day cooldown, not the code. | Land the harness commit after 2026-11-12T18:30Z and meet every condition in §3. Round 2 reviews that commit only. |
| m1 | MINOR | `apps/web/app/routes/not-found.tsx:4`, `apps/web/app/root.tsx:33-38`, `apps/admin/app/routes/not-found.tsx:4`, `apps/admin/app/root.tsx:33-39` | **Not-found pages carry the wrong `<title>`.** The `*` routes export no `meta`, so React Router uses the root's meta. The `error` there is `null`, because the route renders a component rather than throwing. Result: the web 404 at `/es/x` is titled "Cargando" ("Loading"), and the admin 404 is titled "Operator console". This fails WCAG 2.4.2 Page Titled, and axe does not catch it (`document-title` only checks presence). The 404 branch of `root.meta` is reached only by a thrown 404, which no route throws. | Export `meta` from both `not-found.tsx` routes, returning `notFound.meta.title` in the URL locale (web) or the browser locale (admin). Add a unit test, and an e2e assertion on `/es/no-such-page` (§3 item 4). |
| m2 | MINOR | `apps/web/app/root.tsx:12-13, 45-55`, `apps/web/app/i18n/use-locale.ts:11-13` | **SPA-fallback routes in es/fr are not hydration-safe.** `index.html` is rendered at `/`, so it carries `lang="en"`, "Loading" and `<title>Loading</title>`. Nginx serves it for every non-prerendered URL. In SPA mode the client hydrates the root `HydrateFallback` with the **real** URL, so `/es/x` renders `lang="es"` and "Cargando". React reports a hydration mismatch: the attribute is not patched, and the text mismatch forces a client re-render of the whole document. Today this affects only the 404. ADR-0026 §2, though, keeps the prefix on every authenticated route, so every `/es/account/...` page will inherit the problem, and TASK-042 will copy this Layout. The admin app avoids it for `lang` (defers to an effect), but its `meta()` reads the cookie at render time (`browserLocale()`). That is inconsistent with the stated "first client render matches the build-time HTML". React 19 probably patches hoisted `<title>` text without error, so this is lower risk. | During **SPA-mode** hydration, render with `DEFAULT_LOCALE` and switch after hydration. For example, use `useSyncExternalStore(noop, () => urlLocale, () => (isSpaMode ? DEFAULT_LOCALE : urlLocale))`, where `isSpaMode` comes from `window.__reactRouterContext`. Prerendered pages already match. Alternatively, write the TASK-042 design note now and gate it with the e2e console-error check (§3 item 5). Either way, prove it with an e2e case on `/es/no-such-page` and on the admin with `lng=fr`. |
| m3 | MINOR | `infra/nginx/web.conf.template:65`, `infra/nginx/admin.conf.template:134` | **No compression is active.** `gzip_static on` serves only pre-built `*.gz` files, and the build emits none. `gzip on` is missing. This misses platform.md §3.3 ("`gzip_static on` plus dynamic `gzip` for small text") and NFR-WEB-005 ("Brotli or gzip is on"). | Add `gzip on; gzip_vary on; gzip_types text/css application/javascript text/javascript application/json image/svg+xml text/plain;` at server level in both templates. Assert it in `nginx-templates.test.ts`. Track the pre-compression build step (`*.gz`) to TASK-022. |
| m4 | MINOR | Lint coordination with PR #2 (TASK-002) | My probe predicts **24 errors** (§4) once TASK-002's config applies, plus one type-aware `@typescript-eslint/require-await` (m4-e). The PR says it was "re-checked against TASK-002's rules on rebase", but the current head has not been. The probe shows: <br>• 2 × `no-console` in `entry.server.tsx`.<br>• 1 × `react-hooks/set-state-in-effect` in `apps/admin/app/i18n/locale-context.tsx:14`.<br>• 21 × `i18next/no-literal-string`: 13 in test files, and 8 on non-copy props (`kind`, `targetId`, `aria-current`, the ternary `'not-found' : 'error'`). | Whichever PR merges second fixes it: <br>(a) **TASK-002 config:** exclude `TEST_FILES` from `i18next/no-literal-string`, since tests need literal fixtures; consider adding `kind`, `targetId` and `aria-current` to `jsx-attributes.exclude`.<br>(b) **This PR:** replace the `useEffect`/`setState` in `useDetectedLocale` with `useSyncExternalStore(noop, browserLocale, () => DEFAULT_LOCALE)`, which also fixes m2's admin half. In `entry.server.tsx`, use a justified `// eslint-disable-next-line no-console -- build-time prerender diagnostics (ADR-0026 am. 10)` or a config exemption for `apps/*/app/entry.server.tsx`. Re-run `npm run lint` after the rebase and attach the output. |
| m5 | MINOR | `apps/web/app/seo/public-origin.ts:2, 21-24` | `VITE_PUBLIC_ORIGIN` silently defaults to `http://localhost:8080` in **every** build, release images included. A production build without the variable bakes localhost canonical and `hreflang` URLs into the pre-rendered HTML. This is a fail-open on an SEO-critical NFR-WEB-005 output. The variable is also not in any key register or `.env.example`. | Register `VITE_PUBLIC_ORIGIN` (build-time, public, not a secret) in TASK-005's key register. Make the TASK-022 Dockerfile pass it as a required build arg. Make the header/response suite assert that the canonical origin equals the configured origin. A fail-fast option: throw when `import.meta.env.PROD && process.env.CI && !VITE_PUBLIC_ORIGIN` at prerender. |
| m6 | MINOR | `.size-limit.json:3-24` | **The budgets don't match the shape of NFR-WEB-004.** `web assets/*.js ≤ 170 kB` sums **every** web chunk. It fails closed today (119.8 kB), but it breaks falsely once the web app gains authenticated lazy routes, since NFR-WEB-004 gives those 350 kB. Also missing: "each lazy route chunk ≤ 150 kB" and "admin code absent from the web bundle and vice versa". | Track to the first task that adds lazy routes (TASK-038/042 or the wizard). Split the checks into public initial (entry + root + locale-layout + home chunks), authenticated initial, and a per-file `≤ 150 kB` lazy check. Add the manifest test that NFR-WEB-004 names. No change is needed for this PR beyond a comment in `.size-limit.json` or the PR naming the follow-up. |
| m7 | MINOR | `apps/web/tests/prerender.int.test.ts:238-251` | NFR-WEB-005 asks for "main content in the raw HTML: title, **meta description**, canonical, hreflang, and **visible primary heading**". The test asserts the title, lang, canonical and hreflang, but not the description or `<h1>`. The built HTML has both, so this is a missing guard rather than a defect. | Add `expect(html).toContain('<meta name="description" content="…localised…"/>')` and an `<h1[^>]*>{home.hero.title}</h1>` assertion per locale. |
| m8 | MINOR | `jest.config.ts:39-49`; evidence table | There is no `npm run test:coverage` evidence. Both `app/entry.server.tsx` files (about 50 lines) fall inside `collectCoverageFrom` but run only at build time, so v8 reports them at 0%. DoD: "coverage not reduced". | Attach the `test:coverage` summary for this head. If entry.server drags the total down, exclude `apps/*/app/entry.server.tsx` with a comment: it is build-time only and exercised by `prerender.int.test.ts`. |
| n1 | NIT | `infra/nginx/web.conf.template:26`, drafted `static-server.ts`, `tools/repo/nginx-templates.test.ts:197` | The DR-A18 Accept-Language regex exists in three copies (Nginx, e2e static server, test extractor). The test reads it from the template; the static server hard-codes it. | Have `static-server.ts` extract the regex from the template the same way the test does. |
| n2 | NIT | `packages/ui/src/theme.css:10-46, 67-104` | `--text-*`, `--shadow-*`, `--font-weight-*`, `--leading-*` and `--ease-*` are not reset, so off-token utilities (`text-5xl`, `shadow-xl`) exist, and the default `text-3xl` line-height (2.25rem) differs from token `font.lineHeight.3xl` (2.375rem). The dark palette is duplicated verbatim. | TASK-038 (compiled theme and token lint) owns this. Note it on that task. |
| n3 | NIT | `apps/web/app/routes/root-redirect.test.tsx:9` | `async` test without `await`. Type-aware `require-await` (TASK-002 `recommendedTypeChecked`) flags it. | Drop `async`. |
| n4 | NIT | `tools/test-support/jsdom-environment.mjs:10-20` | Two risks. Node's real `fetch` is exposed in jsdom, so a component test can reach the network. Node's `AbortSignal` replaces jsdom's, which can break jsdom's `addEventListener(..., { signal })` validation in later component tests (Radix, TanStack). | Leave a comment naming both. Consider a setup that fails on unmocked `fetch` (nock is already a root devDependency). |
| n5 | NIT | `apps/web/app/components/locale-switcher.tsx:7-10` | The language switch drops `?query` and `#hash`. That is harmless now, but it will lose `/{lng}/track?number=…` later. | Carry over `search` and `hash` from `useLocation()`. |
| n6 | NIT | `infra/nginx/web.conf.template:91`, `admin.conf.template:161` | `location ~ /\.` also denies `/.well-known/`, which `security.txt` may need later. `/es` and `/es/` both return 200 (the canonical covers it). | Note for TASK-022: `location ^~ /.well-known/` before the dotfile rule, and optionally `301 /es → /es/`. |
| n7 | NIT | `apps/web/tests/prerender.int.test.ts:256-257` | The test asserts on the React Router CLI log text (`Prerender (html): SPA Fallback -> …`), which can change across 8.x minors. The file assertions below it are the real guard. | Keep the file assertions and treat the log match as secondary. |
| n8 | NIT | PR body ("no-store for HTML") | The template correctly uses `no-cache` for HTML (NFR-WEB-005) and `no-store` only for the `/` 302. The body wording is wrong. | Fix the PR text. |

**Focus items from the dispatch**

1. **`typecheck` = `npm run typegen && tsc -b`.** Acceptable. Route `+types` cannot resolve without typegen. Typegen writes only to the git-ignored `.react-router/`. The `isbot`/`npm install` path is closed by guard 10(a). `npm run <script>` still runs under `ignore-scripts=true` (only pre/post hooks are skipped). Conditions: principal-architect ratifies it in an ADR-0002 amendment and CLAUDE.md §2 is reworded ("typegen, then `tsc -b`"). Lane A must call `npm run typecheck`, not a bare `tsc -b`. `root-scripts.test.ts` now takes the segment after the last `&&`, which is fine.
2. **Stopgap i18n.** Good. I found no literal user-facing JSX strings; the i18next hits in the probe are props and test fixtures. en/es/fr parity holds at compile time (`Record<Locale, Messages>`) and at test time (leaf-key equality, no empty values) for both apps. The files and key paths match what TASK-042 keeps. The missing-key fallback goes to `en`, then to the key itself.
3. **Prerender.** Correct. The pages are `/en`, `/es` and `/fr`, with `lang`, title, description, canonical, en/es/fr hreflang plus x-default → en, and the raw `<h1>`. `/` is not prerendered, so `index.html` is the content-free fallback. Nginx sends a 302 with cookie → Accept-Language → `en`, `no-store` and `Vary: Cookie, Accept-Language`, with relative `Location` (`absolute_redirect off`). The `$status:$uri` map keeps a 404 from being cached as immutable. See m1, m2, m3, m5 and m7.
4. **size-limit.** The configuration fails the build (the real-CLI negative test is good). The numbers match NFR-WEB-004 (170 / 50 / 350 / 50 kB gzip); see m6 for the semantics. Dependencies: 4 packages, all MIT, maintained. `preset-app` was rightly rejected.
5. **entry.server.tsx.** Correct and minimal. There is no `isbot`, and it awaits `allReady` (static generation). An `onError` sets 500, which makes React Router's prerender fail the build: fail closed. The guard test covers both conditions with negative fixtures (missing entry; `isbot` in each of the 3 dependency fields). Only `no-console` remains (m4).
6. **jsdom project.** m8 from PR-0001 is **resolved**: `customExportConditions: ['@platform/source','browser']`, `*.test.tsx` only, CSS stubbed, jest-dom on `@jest/globals`, Fetch globals for react-router. I verified it by running the project. See n4.
7. **Tokens into Tailwind 4.** The semantic values match `tokens.json` (light and dark; focus ring blue-600/blue-400; `zIndex.skipLink` 70; breakpoints; container 1280/720; radius; system font stack, D-UX-001). Utility names follow the tokens.md mapping (`--color-bg-surface` → `bg-surface`), and the palette and breakpoint resets prevent `bg-red-500`. The focus ring and reduced-motion base styles are present. See n2.
8. **Shell accessibility.** Good. The skip link is the first focusable element and targets `main#main` (`tabIndex=-1`). Web has banner, a localised `nav` "Language", one `main`, contentinfo, a single `h1`, `lang` on language names, `aria-current="page"`, and targets of 36 px (44 px with a coarse pointer). The loading state has `role="status"`. Admin has banner, main and a single `h1`; its "Admin" nav comes in a later task. Defects: m1 (title) and m2 (lang on SPA fallback).
9. **Lint after TASK-002.** See m4 and §4.

## 3. Playwright + axe follow-up: what must be true for the next commit (closes M1)

I reviewed the drafted harness as a preview. The design is sound: 6 projects, axe on every load with serious/critical blocking, a static server that mirrors the Nginx routing with a traversal guard, and ports below the Windows dynamic range. The next commit must meet all of these:

1. **Supply chain.** Install exactly `@playwright/test@1.65.0` and `@axe-core/playwright@4.14.0` **after** 2026-11-12T18:30Z, with `--ignore-scripts` and no cooldown override. The lockfile delta may contain only these two plus their transitive set (`playwright`, `playwright-core`, `axe-core`), with licences Apache-2.0/MPL-2.0. `npm audit --audit-level=high` must exit 0. Browsers are installed via `npm exec --no -w tests/e2e -- playwright install chromium firefox webkit`, never `npx`.
2. **Evidence.** A green run of **all 6 projects** (`chromium|firefox|webkit` × `360|1280`) from the root `npm run test:e2e` against a fresh `npm run build`, with 0 retries locally. Paste the list-reporter totals. Afterwards `git status --porcelain` is empty, and `npm run typecheck` passes with the new `tests/e2e` sources.
3. **Deterministic axe.** The `page.on('load')` scans race the test's own interactions (Tab, Enter, focus assertions), so results depend on timing. Scan at defined points instead: after each `goto` has settled, after state changes via `scanA11y()`, and at teardown. If the event hook stays, await pending scans before the next action. Keep the navigation-race swallow narrow.
4. **States covered** (DoD "axe 0 serious/critical in every state"). Add these cases:
   - web **not-found** `/es/no-such-page`: `html[lang=es]`, Spanish `h1` and **title**, which verifies m1 and m2;
   - web `/es` without the trailing slash;
   - admin with cookie `lng=fr`: `html[lang=fr]`, French `h1` and title;
   - the loading state, if it can be observed.
   The error state is optional; a unit test covers it already.
5. **Console guard.** The fixture fails on `pageerror` and on `console.error` messages, which include React hydration errors. This is the executable check for m2, and the base for the CSP `securitypolicyviolation` listener that TASK-022 adds (NFR-SEC-006).
6. **Mobile width.** The 360 px projects use `Desktop *` descriptors with only the viewport overridden, so `isMobile`/`hasTouch` are off and the `pointer-coarse:` 44 px targets are never exercised. For chromium-360 and webkit-360, use a mobile descriptor (e.g. `devices['Pixel 7']` / `devices['iPhone 15']`) with the width set to 360. Firefox has no `isMobile`, so it keeps the viewport only. Alternatively, document the deviation against NFR-COMPAT-001/002.
7. **Robustness of the static server.** Wrap `decodeURIComponent` (a malformed `%` must return 400, not crash the server). Derive the Accept-Language regex from `infra/nginx/web.conf.template` (n1).
8. **tsconfig.** Node type-stripping executes `static-server.ts`, so add `erasableSyntaxOnly: true` to `tests/e2e/tsconfig.json`. That way `tsc` rejects any syntax Node cannot strip.
9. **Lint.** The new files pass `npm run lint` under whichever ESLint config is on `main` at merge time (TASK-002's, if it merged first).

## 4. Lint probe output (TASK-002 rules applied to this head, no type information)

| Rule | Count | Locations |
|---|---|---|
| `no-console` | 2 | `apps/web/app/entry.server.tsx:21`, `apps/admin/app/entry.server.tsx:21` |
| `react-hooks/set-state-in-effect` | 1 | `apps/admin/app/i18n/locale-context.tsx:14` |
| `i18next/no-literal-string`, source | 8 | `apps/{web,admin}/app/root.tsx:58-59` (ternary `'not-found' : 'error'`, 2 each); `apps/{web,admin}/app/routes/not-found.tsx:5` (`kind="not-found"`); `apps/web/app/routes/locale-layout.tsx:13` and `apps/admin/app/routes/shell.tsx:15` (`targetId="main"`); `apps/web/app/components/locale-switcher.tsx:31` (`'page'`) |
| `i18next/no-literal-string`, tests | 13 | `apps/admin/app/i18n/locale-context.test.tsx:36`; `apps/admin/app/root.test.tsx:20,35,52`; `apps/web/app/root.test.tsx:23`; `apps/web/app/routes/root-redirect.test.tsx:22,34`; `packages/ui/src/skip-link.test.tsx:12 (×2),13,24 (×2)` |
| Type-aware (predicted, not run) | 1 | `@typescript-eslint/require-await` at `apps/web/app/routes/root-redirect.test.tsx:9` (n3) |

## 5. Merge notes

- **Can it merge before the Playwright commit? No, not as TASK-004 "Done".** The Playwright smoke is a listed acceptance test of TASK-004. CLAUDE.md §5 (Git) and §8 require the DoD, including "AC demonstrated by tests", before merging to `main`. The cooldown clears at 2026-11-12T18:30Z, a matter of hours, so waiting costs little. **Recommendation: hold the merge.** Land the harness commit plus the m1/m3/m4(b)/m7 fixes, then run round 2. Round 2 verifies only §3, the listed MINOR fixes, and a rebase on the then-current `main`.
- **Exception, if the orchestrator needs the web-core/admin-core locks released earlier for batch 0.3:** merge only after a formal AC split, i.e. a DECISIONS.md entry plus a new tracked task (e.g. "TASK-004a Playwright + axe harness", e2e-core lock, due before the Wave 0 exit gate) in `task-map.csv`/traceability. M1 then moves to that task, and this PR becomes APPROVED_WITH_NITS once m1, m3 and m4(b) are fixed. Without the split, the merge would breach the DoD guardrail.
- **Merge order with PR #2 (TASK-002).** Whichever merges second rebases and fixes §4. The cleaner split: TASK-002 excludes test files from `i18next/no-literal-string`, and TASK-004 fixes the source hits (m4b).
- **Typecheck deviation.** principal-architect records it in an ADR-0002 amendment and the CLAUDE.md §2 wording (focus item 1).
- **Tracked to other tasks (not blocking this PR):**
  - TASK-022: m5 build arg, the `*.gz` part of m3, n6.
  - TASK-038: n2.
  - TASK-042: the m2 pattern.
  - Lazy-route task: m6.
  - TASK-005: register `VITE_PUBLIC_ORIGIN` (m5).

## 6. What is good (keep these patterns)

- Every guard has a negative case. The `isbot` and entry guards use fixtures; the size-limit CLI is exercised for real on a fixture; the Nginx Accept-Language regex is extracted from the template and run against the cases.
- The prerender acceptance test builds into a temp dir via `APP_BUILD_DIR`. It never skips, and never touches `build/`.
- The cache map is keyed on `$status:$uri`, so a missing asset is never cached as immutable. Every `add_header` is at server level, and a test enforces that.
- Locale routing is derived from one `LOCALES` constant (routes, prerender list, hreflang). Unknown prefixes fall through to the not-found route instead of a param route.
- Comments explain *why*, citing ADR, NFR and decision IDs, without narrating the code.

## 7. Security flags for security-analyst

- The CSP, HSTS toggle and Permissions-Policy are absent until TASK-022/SPK-06, as the ADR accepts. Confirm this is tracked.
- `VITE_PUBLIC_ORIGIN` is inlined into the client bundle (the `VITE_` prefix), so it must never carry a secret. It fails open to localhost (m5).
- The `lng` cookie is set client-side without `Secure` on http by design (ADR-0026 am. 4). Confirm `Secure` on https: `serializeLocaleCookie(…, protocol === 'https:')` does this.
- Drafted e2e static server: the path-traversal guard (`normalize` + `startsWith(root + sep)`) is correct. A malformed URI crashes the process (test-only; §3 item 7).
- The jsdom test environment exposes the real Node `fetch` (test-only network egress; n4).
- `entry.server.tsx` logs render errors with `console.error` at build time only. There is no request data, so no PII path exists.

## Round 2 (head 9f5ea5e, non-harness delta)

| Field | Value |
|---|---|
| Delta | `519bb89..9f5ea5e`: 1 commit (`9f5ea5e fix(web,admin): review fix cycle 1 for TASK-004`), 30 files, +341/−50 |
| Reviewer | code-reviewer (independent), 2026-11-12 |
| Inputs | Round 1 above; fix comment [6825316110](https://github.com/sukhchdit/shipcube/pull/4#issuecomment-6825316110); security round 1 (PR4-SEC-01..09); ADR-0026 am. 13; ADR-0002 batch-0.2 amendment; D-ORCH-006; `main` at `33a9cd0` (TASK-002 merged) |
| Scope | Non-harness fixes only. The Playwright + axe harness (M1) lands after 2026-11-12T20:18Z and gets round 3 (D-ORCH-006 item 3). |

```
VERDICT: CHANGES_REQUESTED  (M1 only; every round-1 MINOR in scope is closed)
SUMMARY: The fix cycle is precise and every change is backed by a test: per-route not-found titles (m1), dynamic gzip (m3),
         description/h1 guards (m7), the coverage exclusion with evidence (m8), the typegen structure guard (am. 13), and
         envPrefix with a random build canary plus a negative control (PR4-SEC-01). M1 (Playwright + axe AC) is the only
         remaining MAJOR. Two new MINORs are predicted lint failures that appear only under main's TYPE-AWARE TASK-002
         config. Both must be fixed in the merge-main pass before round 3.
```

### R2.1 Verification performed by the reviewer

I ran no `npm ci`, build, Docker or Jest suite, and touched nothing in the `Shipqube-TASK-004` worktree. Everything ran on `git archive 9f5ea5e` extracts in my scratch dir, using the main checkout's tooling (Node 24).

| Check | Result |
|---|---|
| Full read of the delta, plus the touched files in context (`apps/admin/app/root.tsx`, `i18n/locales.ts`, `apps/web/app/root.tsx`, `routes/home.tsx`, locale JSON) | See findings. |
| `prettier --check` on all 28 changed non-template files, with the PR's `.prettierrc` | **Clean.** |
| **Lint probe, untyped:** main's `eslint.config.mjs` (TASK-002 at `33a9cd0`) with `disableTypeChecked`, applied to `apps/{web,admin}/app`, `packages/ui/src`, `apps/web/tests`, both `vite.config*.ts` and the two `tools/repo` tests | **0 problems in 51 files.** The 24 round-1 hits are gone: no-console, set-state-in-effect, and the 8 source `no-literal-string` hits. The 13 test-file hits are covered by TASK-002 excluding `TEST_FILES`. **Positive control:** a probe file with `useEffect(() => setV(1))`, `console.error` and `<p>Hello</p>` produced exactly 3 errors, so the rules were live. |
| **Lint probe, type-aware** (single rules, scratch tsconfig resolving `vite` types from main's `node_modules`) | (a) `(await import('./vite.config')).default as UserConfig` → `@typescript-eslint/no-unnecessary-type-assertion` fires. The rule is in `recommendedTypeChecked`, which main applies to `**/*.{ts,tsx}` with no override for tests. Finding R2-m1. (b) A route module whose `./+types/<route>` import is unresolved → `no-unsafe-member-access` plus `no-unsafe-argument` on `location.pathname`. Finding R2-m2. |
| React semantics of the admin locale hook | `useSyncExternalStore(subscribeToNothing, browserLocale, () => DEFAULT_LOCALE)` is correct. During hydration React uses `getServerSnapshot` (`en`), so the SPA fallback hydrates cleanly, then re-renders with the cookie locale; `<html lang>` and the content then switch through a normal client render. The subscribe function is module-level and stable, and the snapshot is a primitive, so there is no resubscribe or tearing loop. The `renderToString` test is a real guard: it would fail if `getServerSnapshot` read the cookie. |
| ADR-0026 am. 13 / ADR-0002 batch-0.2 amendment / CLAUDE.md §2 | The guard matches the amendment text. Both apps declare `"typegen": "react-router typegen"`. The root `typecheck` is `npm run typegen && tsc -b`. CLAUDE.md §2 is already reworded on `main`. **Round-1 focus item 1 conditions are closed.** |
| PR body (n8, PR4-SEC-03) | It now says `no-cache` for HTML and `no-store` only on the `/` 302. The cooldown time is 20:18Z, and browsers install through `npm run deps:rebuild -- --playwright=…`, which exists on `main` (`tools/deps/rebuild.mjs`) and runs `npm exec --no -- playwright install`. |
| Cleanup | Scratch extracts removed. `git status --porcelain` in the main checkout is empty apart from this file. |

**Relied on the developer's evidence (comment 6825316110)** for the following: lint/format/typecheck exit 0 under the branch's own (pre-TASK-002) config; `test:unit` 175/175; `test:integration` 10/10, including the canary build and its negative control (`envPrefix: 'VITE_'` makes the web case fail); build + size-limit; `test:coverage` 94.87 % lines / 97.95 % branches; `npm audit --audit-level=high` exit 0; clean `git status`.

### R2.2 Closure of round-1 findings

| ID | Status | Notes |
|---|---|---|
| M1 | **Open** | Harness commit after 20:18Z; round 3. Conditions are in R2.4. |
| m1 | **Closed** | `meta` on both not-found routes: web uses the URL locale (`notFound.meta.title`, unknown prefix → en); admin uses the cookie locale. Unit-tested for en/es/fr plus fallback. The e2e assertion is in R2.4 item 4. |
| m2 | Routed (TASK-042) | **Caveat for round 3:** the console guard (R2.4 item 5) **will** exercise this on `/es/no-such-page`. Web `HydrateFallback` reads the URL locale during SPA-mode hydration, so "Cargando" vs the built "Loading" is a text mismatch, which React 19 reports as a recoverable error (`pageerror`). If the harness sees it, the web fix lands in the harness commit: render `DEFAULT_LOCALE` during SPA hydration (the same `useSyncExternalStore` pattern now used in admin). It must **not** be allow-listed. The admin content and `lang` half is now fixed by the hook. Admin `meta()` still reads the cookie at render, which is lower risk (title hoisting); TASK-042 keeps it. |
| m3 | **Closed** | `gzip on`, `gzip_vary on`, `gzip_types …` at server level in both templates, with an indent-anchored test. `*.gz` pre-compression is TASK-022. See R2-n2. |
| m4 | **Closed (untyped); see R2-m1/R2-m2 for type-aware** | `process.stderr.write` is build-time only, with a justified comment and no request data. The hook replaces the effect. Constants (`ERROR_KIND`, `NOT_FOUND_KIND`, `MAIN_CONTENT_ID`, `CURRENT_PAGE`) are typed and named for intent. n3 is closed. |
| m5, m6 | Routed | TASK-022/TASK-005 (m5); the first lazy-route task (m6). Unchanged. |
| m7 | **Closed** | Per-locale description and `<h1>` read from the locale JSON, plus exactly one `<h1>`. Canonical and `hreflang` now assert the exact configured origin (`https://example.test`), which is a stronger positive control than the round-1 regex. |
| m8 | **Closed** | `!apps/*/app/{entry.server.tsx,routes.ts}`, with a comment naming the integration test that exercises them. The evidence is above the 85/75 thresholds. |
| n1, n2, n4–n7 | Routed / unchanged | As in §5. n8 is closed (PR body). |
| PR4-SEC-01 | **Closed (code side)** | `envPrefix: 'VITE_PUBLIC_'` in both apps. There is a config test, plus a build-level canary: a random `VITE_CANARY_NOT_PUBLIC` value, and neither the value nor the name may appear in any client file. There is also a no-`.map` and no-`sourceMappingURL` check, and a documented negative control. The cast-based env read is kept; its rationale (Jest has no `import.meta.env`) is sound now that the prefix bounds what Vite can inline. security-analyst confirms. |
| PR4-SEC-02/05/06 (optional) | **Done** | `default_server` (see R2-n3); a static `<NoIndex />` in the admin `Layout` head; the duplicate root `meta` robots entry is removed, and `root.test` asserts that it is gone; the owner-pointer wording is pinned by the test. |

### R2.3 New findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `apps/web/vite.config.test.ts:12`, `apps/admin/vite.config.test.ts:12` | `config = (await import('./vite.config')).default as UserConfig`. `defineConfig({...})` resolves to the `UserConfig` overload, so the assertion does not change the type. `@typescript-eslint/no-unnecessary-type-assertion` (in `recommendedTypeChecked`, applied by main's config to test files too) reports it. **Reproduced** on an equivalent scratch file. The branch's own config has no type-aware block, so the PR's "lint exit 0" cannot see it. That makes 2 errors after merging `main`. | Drop `as UserConfig` (the `let config: UserConfig` annotation already types it). Re-run `npm run lint` on the merged tree. |
| R2-m2 | MINOR (merge condition) | Root `package.json` `lint` script (main: `eslint . --max-warnings 0 && stylelint …`); `apps/web/app/root.tsx:33-34`, `apps/web/app/routes/home.tsx:8-9`, `apps/web/app/routes/not-found.tsx:7-8` | **On a clean checkout, `npm run lint` depends on `typegen` having run.** Route modules import `./+types/<route>` from the git-ignored `.react-router/`. Main's config ignores `\+types/` in `import-x/no-unresolved`, but the **type-aware** rules then see an unresolvable `Route.MetaArgs`. `location.pathname` produces `no-unsafe-member-access` and `no-unsafe-argument` (**reproduced**: "Unsafe member access .pathname on a type that cannot be resolved"). The developer's worktree already has `.react-router/` from `typecheck`, so a local lint run is falsely green. A fresh clone or lane A running lint before typecheck goes red. This is the same reason ADR-0002's batch-0.2 amendment put `typegen` in front of `tsc -b`. | In the merge-main pass, make the root script `"lint": "npm run typegen && eslint . --max-warnings 0 && stylelint …"` (pre-hooks are skipped under `ignore-scripts`, so it must be explicit). Extend `tools/repo/root-scripts.test.ts` to assert it. **Verify by deleting `apps/*/.react-router/` and then running `npm run lint`.** Have principal-architect add one sentence to the ADR-0002 batch-0.2 amendment ("lint likewise runs typegen first"). |
| R2-n1 | NIT | Commit `9f5ea5e` trailer | `Refs: TASK-004, US-105, US-106` is wrong. TASK-004 is an enabler traced to NFR-COMPAT-001/002 and NFR-WEB-004/005. This is corrected in the PR comment, and history is not rewritten (CLAUDE.md §5). | The harness commit uses `Refs: TASK-004, NFR-COMPAT-001, NFR-COMPAT-002, NFR-WEB-004, NFR-WEB-005`. The squash-merge message carries the correct refs. |
| R2-n2 | NIT | `infra/nginx/{web,admin}.conf.template` gzip block | `gzip_proxied` defaults to `off`, which governs `gzip_static` too. nginx therefore does not compress any request that carries a `Via` header, which CloudFront and many proxies add. `gzip_http_version` defaults to 1.1, and an nginx `edge` proxying with the default `proxy_http_version 1.0` gets no compression either. Today m3 is satisfied for direct requests only. | Route to TASK-022/TASK-111. Decide `gzip_proxied any`, or rely on CloudFront compression. Make the TASK-111 header suite assert `Content-Encoding: gzip` **through the edge**. |
| R2-n3 | NIT | Same templates, `listen ${NGINX_PORT} default_server;` | IPv4 only. If the stock `default.conf` survives, it also listens on `[::]:80`, so IPv6 requests would still reach it. | TASK-014 removes the stock file (binding per PR4-SEC-02). Optionally add `listen [::]:${NGINX_PORT} default_server;` there. |

No correctness defects in the delta. The SEC-01 canary and the `renderToString` hydration test are good examples of tests that fail for the right reason.

### R2.4 Round-3 checklist: harness commit (closes M1)

Round 3 reviews the harness commit plus the merge-main result. All of the following must hold:

1. **Supply chain.** Install after **2026-11-12T20:18Z** (`playwright-core` 1.65.0 publish 20:17:41Z + 7 d; PR4-SEC-03), with no cooldown override flag or variable. Exact pins in `tests/e2e` devDependencies: `@playwright/test@1.65.0`, `@axe-core/playwright@4.14.0` (`--save-exact` / `.npmrc`), via `npm install --ignore-scripts -w tests/e2e -D …`. The lockfile delta may contain only these plus `playwright`, `playwright-core` and `axe-core` (Apache-2.0 / MPL-2.0). `npm audit --audit-level=high` exits 0. Browsers come only through `npm run deps:rebuild -- --playwright=chromium,firefox,webkit` (ADR-0023 am. F), never `npx`.
2. **Evidence.** A green run of **all 6 projects** (`chromium|firefox|webkit` × `360|1280`) from the root `npm run test:e2e`, against a fresh `npm run build`, with 0 retries. Paste the list-reporter totals. Afterwards `git status --porcelain` is empty, and `npm run typecheck` passes with the `tests/e2e` sources included.
3. **Deterministic axe.** Scan at defined points: after each settled `goto`, after state changes via `scanA11y()`, and at teardown. No unawaited `page.on('load')` scans racing interactions. Keep the navigation-race swallow narrow. Serious and critical violations block.
4. **States covered.**
   - web `/es/no-such-page`: `html[lang=es]`, Spanish `h1` **and `<title>`** (verifies m1 end to end);
   - web `/es` without the trailing slash;
   - admin with cookie `lng=fr`: `html[lang=fr]`, French `h1` and title;
   - the loading state, if observable;
   - the error state is optional (covered by unit tests).
5. **Console guard.** Fail on `pageerror` and on `console.error`, including React hydration and recoverable errors. **No allow-list for hydration errors.** If item 4's `/es/no-such-page` case trips m2, fix the web SPA-hydration locale in the harness commit (R2.2 m2 row).
6. **Mobile width.** For chromium-360 and webkit-360, use mobile descriptors (`devices['Pixel 7']`, `devices['iPhone 15']`) at width 360, so `isMobile`/`hasTouch` exercise the `pointer-coarse:` 44 px targets. Firefox gets the viewport only. Alternatively, record a deviation against NFR-COMPAT-001/002.
7. **Static-server robustness.** A malformed `%` escape returns 400; the server must not crash (PR4-SEC-07). Read the Accept-Language regex from `infra/nginx/web.conf.template`, not a hard-coded copy (n1). The traversal guard stays.
8. **tsconfig.** Set `erasableSyntaxOnly: true` in `tests/e2e/tsconfig.json`, because Node type-stripping executes `static-server.ts`.
9. **Lint under `main`'s config, type-aware included.** `npm run lint` passes on the merged tree with `apps/*/.react-router/` deleted first (R2-m2), and R2-m1 is fixed. `**/playwright-report/**` and `**/test-results/**` are added to the ESLint and Stylelint ignores and to `.gitignore` (PR #2 R2-n9, routed to TASK-004).
10. **Merge-main result.** The branch includes `main` as of the merge order (002 → 003 → 004, D-ORCH-006 item 5). Re-run the full gate on the merged head and paste it: lint, format:check, typecheck, test:unit, test:integration, build + size-limit, test:coverage, audit.

### R2.5 Merge notes (round 2)

- **Not mergeable yet:** M1 is open, and PR #4 holds for round 3 (D-ORCH-006 item 3). There are no other BLOCKER/MAJOR findings. Once R2.4 holds and R2-m1/R2-m2 are fixed, the expected round-3 outcome is APPROVED or APPROVED_WITH_NITS.
- **New routings:** R2-n2 to TASK-022/TASK-111; R2-n3 to TASK-014; R2-m2's ADR sentence to principal-architect.

## Round 3 (head d2e867b)

| Field | Value |
|---|---|
| Delta | `50b4831..d2e867b`, 3 commits: `ba57e77` merge of `main` @`22eccb2`; `3349766` Playwright + axe harness plus the web SPA-hydration locale fix; `d2e867b` jsdom support files moved from `tools/test-support` to `tools/test-dom`. Branch-only source delta: `apps/web/app/i18n/use-locale{,.test}.ts(x)`, `tests/e2e/**`, `jest.config.ts`, `tools/test-dom/**`, lockfile. |
| Reviewer | code-reviewer (independent), 2026-11-13 |
| Inputs | Rounds 1–2 above (§3, R2.4); fix comment [6836992875](https://github.com/sukhchdit/shipcube/pull/4#issuecomment-6836992875); D-ORCH-019, D-TASK004-01, D-ARCH-050, D-TASK007-03; TEST-STRATEGY §7.8; `required-suites.json`; lane A run 43314173521 |
| Main drift | `origin/main` is at `559fde7`. `git diff 22eccb2 origin/main -- . ':!docs' ':!.claude'` is empty: docs-only since the merge. |

```
VERDICT: CHANGES_REQUESTED  (one MAJOR, two-line fix; everything in the R2.4 checklist is closed or formally deferred)
SUMMARY: The harness is good work: six projects named per TEST-STRATEGY §7.8, an error guard with no allow-list that caught
         the m2 hydration mismatch, axe scans at settled points only, and a static server that fails closed on malformed
         escapes and traversal. The m2 fix is correct and its test kills both mutants I tried. The merge is a pure union.
         One MAJOR: d2e867b moves the jsdom environment and setup files out of the CODEOWNERS/security-owned set
         (tools/test-support/), so future edits to them escape the security-record gate. Re-own tools/test-dom/ and it is approved.
```

### R3.1 Verification performed by the reviewer

I ran nothing in the `Shipqube-TASK-004` worktree, and no `npm ci`, build, Docker or e2e. Everything ran on a `git archive d2e867b` extract in my scratch dir, with `node_modules` junctioned to the main checkout's (Node 24). The extract and junction were removed afterwards; main's `node_modules` count (740) and `git status` are unchanged.

| Check | Result |
|---|---|
| Full read of `3349766` and `d2e867b`, and of `apps/web/app/root.tsx`, `i18n/locales.ts`, `infra/nginx/web.conf.template` maps, the lane A base-ref fixture step (`ci.yml`), `CODEOWNERS`, `check-security-owned-paths.mjs` and `check-workflow-policy.mjs` | See the findings below. |
| `jest --selectProjects unit-dom --testPathPatterns apps/web/app/(i18n/use-locale\|root\|routes/not-found)` | **2 suites, 8/8 passed.** |
| **Mutation 1:** server snapshot `() => renderedLocale(urlLocale)` replaced with `() => urlLocale` (the pre-fix behaviour) | **2 of 3 fail** (the `renderToString` case and the `hydrateRoot` case with `onRecoverableError`). This matches the developer's claim. |
| **Mutation 2:** `renderedLocale` ignores `<html lang>` and always returns `en` | **1 of 3 fails** (the `lang="es"` server-snapshot case). The test pins the served-lang read, not just "default during hydration". |
| **Static-server probe:** fake `apps/web/build/client` (root, `en/`, `es/`, `assets/a.js`, `.hidden/`, plus a sibling file outside the root); `node tests/e2e/support/static-server.ts web 4199`; 22 paths, 8 `Accept-Language` values, 2 cookies, a POST, then a liveness request | 400 for `/%E0%A4%A`, `/%`, `/..%2f..%2fpackage.json`, `/..%5c..%5cpackage.json` (Windows separator), `/..%2fsibling.txt` and `/a%2F..%2F..%2F..%2Fsibling.txt`. `/../sibling.txt` and `/%2e%2e/...` are normalised by the URL parser and get the SPA fallback; **nothing outside the root was ever served.** 403 for `/.hidden/x.txt` and `/%2ehidden/x.txt`; 404 for a missing asset; 405 for POST. `/es` (no slash) serves `es/index.html`. `/x%00.txt` gets the fallback rather than an error. The server answered after every malformed request. The `Accept-Language` regex parsed from the template gives `de-DE, fr-CA;q=0.9` → `/fr/`, `ES` → `/es/`, `zz-fr`/`enx`/`esperanto`/`*` → `/en/`, `fr;q=0.1, es;q=0.9` → `/fr/` (first-listed, by design per DR-A18). One divergence is noted in R3-n5. |
| **Merge `ba57e77` is a pure union** | Merge base `44d6c2e`. Files changed on both sides: `.stylelintignore`, `eslint.config.mjs`, `package.json`, `tools/lint/negative-fixtures.test.ts`, `package-lock.json`. `git merge-tree --write-tree 50b4831 22eccb2` conflicts in exactly `eslint.config.mjs`, `package.json` and `negative-fixtures.test.ts`. `git diff --stat <merge-tree> ba57e77` touches only those 3 files plus `.stylelintignore`, so **every other path, including the lockfile, is byte-identical to a clean re-merge.** The hand resolutions (`git show --cc`): (a) `eslint.config.mjs`: both sides' blocks kept (the branch's `routes.ts` dev-dependency block; main's `prisma.config.ts` and `prisma/tests/**` blocks), nothing dropped. (b) `package.json`: main's db/authz/gen/hooks scripts and `pg` pins, plus the branch's `typegen`, `typecheck`, `build && size`, `unit unit-dom` and `size-limit`. `lint` = `npm run typegen && eslint … && stylelint … --max-warnings 0 && node tools/lint/check-suppressions.mjs`. Main's `--allow-empty-input` is dropped, which **batch-0.2 rulings item 12 / ADR-0002 §79 require at this rebase** (PR2-SEC-03 item 3). `test:integration` takes main's form (no `--passWithNoTests`). (c) `negative-fixtures.test.ts`: union of both expectations (typegen first, then the suppression check) plus a `not.toContain('--allow-empty-input')` guard. (d) `.stylelintignore` (auto-merged, then hand-edited): `playwright-report/` becomes `/**/playwright-report/` (and likewise `test-results/`) so main's ESLint/Stylelint ignore-symmetry test (R2-n8) holds. This is a justified, documented adjustment, not a semantic change. |
| **Lockfile deltas** (parsed `packages` maps) | MB→`50b4831` and `22eccb2`→`ba57e77` are **identical**: + `size-limit` 14.3.0, `@size-limit/file` 14.3.0, `lilconfig` 3.1.4, `nanospinner` 1.2.2 (all MIT), and the root devDependency. `ba57e77`→`3349766`: + `@playwright/test`, `playwright`, `playwright-core` 1.65.0 (Apache-2.0), `@axe-core/playwright` 4.14.0 (MPL-2.0; `axe-core ~4.14.0` dedupes to the existing 4.14.0), and the `tests/e2e` devDependencies, exact-pinned. `3349766`→`d2e867b`: none. There are no install scripts and no `fsevents` nesting. |
| `prettier --check` on `tests/e2e`, `apps/web/app/i18n`, `jest.config.ts`, `tools/test-dom`, and the merge-resolved files | Clean. (`.stylelintignore` has no Prettier parser, as expected.) |
| `as UserConfig` in `apps/**` (R2-m1) | No matches. |
| Lane A run 43314173521 @`d2e867b` (`gh run view`) | fast-lane: every step **success**, including Lint (a fresh checkout has no `.react-router/`, so this is the R2-m2 proof in CI), Type-check (including `tests/e2e` with `@playwright/test` installed), Unit tests, the base-ref lint fixtures, Lockfile, Cooldown, Licences, Signatures, Audit, Build and Build porcelain. scans: only "Security-owned paths need a review record" **fails** (record pending); ci-gate fails on that alone. |

**Relied on the developer's evidence** (comment 6836992875): 4 of 6 e2e projects green (52/52, 0 retries) after a fresh build; `test:integration` 96, `test:api` 43, `test:coverage` 96.77 % / 96.64 %; size-limit numbers; `npm audit` high = 0; porcelain clean. Firefox is host-blocked (D-ORCH-019).

### R3.2 Round-3 checklist (R2.4) closure

| # | Item | Status | Notes |
|---|---|---|---|
| 1 | Supply chain | **Closed** | Exact pins in `tests/e2e/package.json`. The lock delta is only the 4 packages above. The install time (20:17:42Z) is 1 s after the cooldown boundary. That is tight, but `.npmrc` `min-release-age=7` makes npm itself refuse anything earlier, and no override was used. Browsers come through `deps:rebuild --playwright=…`. |
| 2 | Evidence on 6 projects | **Closed with condition** | 4/6 locally. Firefox is accepted under **COND-E2E-FF** (D-ORCH-019; STATUS.md conditions table; TASK-015/qa-lead, before G3). This is the "formal AC split" route from round-1 §5. The Firefox projects are defined and run the same specs, so only the evidence is deferred. |
| 3 | Deterministic axe | **Closed** | No event-driven scans. `scanA11y()` runs after web-first assertions, the fixture scans the final state at teardown (`!page.isClosed()`), WCAG 2.0/2.1/2.2 A/AA tags apply, and serious/critical violations block. The loading-state case scans while JS is held, which is a real settled state. |
| 4 | States | **Closed** | `/es/no-such-page` (lang, h1, **title**); `/es` without the slash; admin `lng=fr` (lang, h1, title); the loading state (`role=status` in the fallback's `en`, then a release and the final Spanish not-found); also the `/` redirect order and a French browser landing on `/fr/`. |
| 5 | Console guard / m2 | **Closed** | `pageerror` and every `console.error` fail the test, with no allow-list. It caught React #418, and the fix is in `use-locale.ts`, not a filter. My mutations confirm the unit test guards it. See R3.4 for the semantics review and R3-n1 for a forward-looking caveat. |
| 6 | Mobile width | **Closed** | `devices['Pixel 7']` and `devices['iPhone 15']` at 360 × 780 (isMobile, hasTouch); Firefox gets the viewport plus `hasTouch` (D-QA-005); desktop is 1280 × 800. This matches TEST-STRATEGY §7.8 exactly. See R3-n4: coarse-pointer sizing is configured but not asserted. |
| 7 | Static server | **Closed** | `decodeURIComponent` is wrapped (400). Traversal returns 400 and was verified with `/`, `%2f`, `%5c` and `%2e` variants. The DR-A18 regex is parsed from the template and throws if the map is missing (n1 closed). Every handler error becomes a 500 rather than a crash. `reuseExistingServer: false`. |
| 8 | `erasableSyntaxOnly` | **Closed** | `tests/e2e/tsconfig.json` sets it, along with `lib: [ES2023, DOM]`, `types: [node]`, and excludes for the output folders. |
| 9 | Lint under main's config | **Closed** | `lint` runs typegen first, and the wiring test asserts it. Lane A lint on a fresh checkout is green (R2-m2 closed). R2-m1 is closed. ESLint ignores `**/playwright-report/**` and `**/test-results/**`; `.stylelintignore` uses the `/**/` form; `.gitignore` anchors both under `/tests/*/` (PR #2 R2-n9 closed). |
| 10 | Merge main + full gate | **Closed** | The pure union is proven by SHA (R3.1). The developer's full gate and lane A fast-lane are green on `d2e867b`. `main` has moved only in docs since. |
| R2-n1 | Commit refs | **Closed** | `3349766` carries `Refs: TASK-004, NFR-COMPAT-001, NFR-COMPAT-002, NFR-WEB-004, NFR-WEB-005`. |

### R3.3 Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R3-M1 | **MAJOR** | `jest.config.ts:76-81`; `tools/test-dom/*` (new); `.github/CODEOWNERS:49-50`; `tools/ci/check-workflow-policy.mjs:656-680` (`REQUIRED_CODEOWNED_PATHS`) | **The move takes the Jest environment and setup files out of the security-owned set.** `CODEOWNERS` owns `/jest.config.ts` and `/tools/test-support/` because "each can drop or weaken a gate" (PR #10 m4, PR10-SEC-04). `check-security-owned-paths.mjs` derives its owned set from CODEOWNERS, and `check-workflow-policy.mjs` makes `tools/test-support/` a required owned path. At r1/r2, `jsdom-environment.mjs` (a custom environment class that writes globals) and `dom-setup.ts` (`setupFilesAfterEnv`) were covered by that line. In `tools/test-dom/` they are owned by nobody. After merge, a PR can change the environment or setup that runs before **every** web/admin component test (stub `expect`, swallow `console.error`, replace globals) without triggering the security-record gate. Ownership covers the reference in `jest.config.ts` but not the code it loads. This PR only passes the gate now because it also touches `jest.config.ts`. | Add `/tools/test-dom/ @sukhchdit` to `.github/CODEOWNERS`, in the "Test, type-check and commit-message configuration" block. Add `'tools/test-dom/'` to `REQUIRED_CODEOWNED_PATHS` in `tools/ci/check-workflow-policy.mjs`, and extend its test (`check-workflow-policy.test.ts:~229`) so the line cannot be dropped silently. Both files are security-owned, and this PR already needs a security record. **Keep the move itself** (ruling in R3.4). |
| R3-n1 | NIT | `apps/web/app/i18n/use-locale.ts:16-20, 30-36` | `getServerSnapshot` reads the live `document.documentElement.lang`, which React itself patches after hydration. That is correct today: the SPA fallback hydrates in one pass, and pre-rendered pages have lang = URL locale. Once TASK-042 or lazy routes add Suspense boundaries that hydrate **after** the root's post-hydration re-render has patched `lang` to `es`, those boundaries would read `es` against `en` server HTML and report a mismatch. The e2e guard would catch it, so this fails closed. | TASK-042: capture the served locale once, before hydration (module-level `const SERVED_LANG = typeof document === 'undefined' ? undefined : document.documentElement.lang`), and isolate modules in the test. Alternatively, read React Router's `isSpaMode`. |
| R3-n2 | NIT | `apps/web/app/i18n/use-locale.test.tsx:47-56` | The `hydrateRoot` root is never unmounted, and RTL's cleanup does not know about it. The root stays mounted on a detached container for the rest of the file. | `const root = hydrateRoot(…)`, then `act(() => root.unmount())` at the end of the test. |
| R3-n3 | NIT | `tests/e2e/playwright.config.ts:20-28` vs TEST-STRATEGY §7.8 last bullet | The strategy puts failure artefacts in the git-ignored `tests/e2e/output/`. The config uses Playwright's defaults (`test-results/`, `playwright-report/`). Both are ignored, so nothing leaks; the issue is drift between the document and the code. | Either set `outputDir: 'output/test-results'` and the html reporter's `outputFolder: 'output/report'` (and ignore `/tests/*/output/`), or have qa-lead amend §7.8. Route to T-QA-05. |
| R3-n4 | NIT | `tests/e2e/playwright.config.ts:35-40`; `web.spec.ts` | The mobile descriptors are set so the `pointer-coarse:` 44 px targets apply, but no test proves that `(pointer: coarse)` matches on the `-mobile` projects. axe `target-size` (24 px) is the only size check. | T-QA-05 (the 390 px projects already own the target-size checks): assert `matchMedia('(pointer: coarse)').matches` and a ≥ 44 px box for the locale-switcher links on the `-mobile` projects. |
| R3-n5 | NIT | `tests/e2e/support/static-server.ts:54-61` | `new URL(request.url, 'http://localhost')` parses a request-target that starts with `//` as an authority. `//evil.example/` therefore becomes pathname `/` and gets the 302, whereas Nginx (`merge_slashes on`) serves `/evil.example/` through the SPA fallback. This is test-only and harmless, since `Location` is always local. | `new URL(\`http://localhost${request.url ?? '/'}\`)`, or reject request-targets that do not start with a single `/`. |
| R3-n6 | NIT | WebKit close hang on Windows (PR comment, open item 2) | Runner exit hangs in 2 of 5 local four-project runs after all tests have passed. CI lanes B/C are Linux, so they are unaffected. But heavy suites run locally (D-ORCH-001), so a local gate run can stall. | Acceptable as a known issue. Record it in TEST-STRATEGY §11 (flake/known-issues) and set `globalTimeout` for CI runs, so a hang fails the job with a clear message rather than running into the job timeout. No harness change is needed for this PR. |

Other observations, not findings: the request-only redirect and robustness tests run once per project (6×) without needing a browser; restricting them to one project is optional. The WebKit `tabForward` selector does not filter hidden elements, which is fine while the skip link comes first in DOM order.

### R3.4 Rulings requested by the dispatch

1. **Project naming (`-mobile/-desktop` instead of `-360/-1280`): correct.** TEST-STRATEGY §7.8 and `required-suites.json` (`e2e-chromium`/`-firefox`/`-webkit` runners with `--project=<engine>-mobile --project=<engine>-desktop`) are the authoritative names. My R2.4 wording (`360|1280`) described widths, not names. The viewports (360 × 780, 1280 × 800) match §7.8 exactly. D-ORCH-019 item 2 stands.
2. **WebKit `tabForward` deviation: accepted.**
   - The fixture documents it honestly, and Chromium (and Firefox under COND-E2E-FF) still press a real Tab, so the "skip link is the first Tab stop" assertion is executed with a real key on at least one engine per run. On WebKit the test still proves three things: the skip link is first in tabbable DOM order, it becomes visible on focus, and Enter moves focus to `#main`.
   - Condition: the US-113 keyboard sweep (`e2e-a11y`, J-KB-* on 3 engines desktop) uses the same documented technique or a real Option+Tab where the platform has it, and records the WebKit limitation once in TEST-STRATEGY, not per test.
   - D-ORCH-019 item 3 stands.
3. **`tools/test-support` → `tools/test-dom` move: the right fix; making `jest.config.ts` "robust" instead is not.**
   - The base-ref step replaces `tools/test-support` wholesale (`rm -rf` before checkout) on purpose: head-only files must not shadow the base harness (PR #10 m3).
   - Any head-only file there that `jest.config.ts` references therefore breaks Jest's config validation. That is a fail-closed outcome, which is the safe direction.
   - A "robust" config would have to drop the `unit-dom` project, or fall back, when its environment file is missing. That is exactly the kind of silent gate-weakening the step exists to prevent. Reject it.
   - Keeping the DOM support files outside the replaced directory is the clean separation, because they are not lint-fixture harness. The move must keep its ownership, though (R3-M1).
   - Optional follow-up for the step owner (TASK-007, PR #17 is reworking this step per D-TASK007-03): run the base suite with a minimal step-owned Jest config, so unrelated head projects cannot break the step. Treat that as hardening, not a blocker.
4. **WebKit close hang: acceptable** for merge (R3-n6). It does not affect results, CI lanes are Linux, and it needs only a known-issue note and a CI `globalTimeout`.
5. **m2 fix semantics: correct.**
   - `useSyncExternalStore(subscribeToNothing, () => urlLocale, () => renderedLocale(urlLocale))`: during hydration React uses the server snapshot, which is the served `<html lang>` (`en` in the SPA fallback; the URL locale in pre-rendered pages and at build time). After commit, the passive store-consistency check sees `getSnapshot() !== inst.value` and forces a sync re-render, which patches `lang` and the text.
   - `subscribe` is module-level and stable. The snapshots are primitives, so there is no tearing loop. In a transition, the per-render `getSnapshot` closure keeps the consistency check stable.
   - Components that mount after hydration (the not-found route) use `getSnapshot` directly. The admin hook uses the same pattern.
   - Caveat: R3-n1.
6. **Lockfile delta: clean** (R3.1).

### R3.5 Merge notes (round 3)

- **Not mergeable at `d2e867b`:** R3-M1 is the only MAJOR. Once `/tools/test-dom/` is owned in CODEOWNERS and in the workflow-policy required list (with its test), round 4 is a delta check of those 2–3 files. The expected verdict then is **APPROVED_WITH_NITS**.
- **Security record:** lane A's scans job stays red until a PR-0004 security record names a head at or after the R3-M1 fix, since the fix touches owned paths and would void an earlier record under rule (d). The security-analyst should therefore review **after** the fix commit, or re-confirm on it.
- **COND-E2E-FF** (Firefox on Linux before G3, TASK-015/qa-lead) must appear in `traceability.md` against TASK-004 at merge, not only in STATUS.md, because the DoD requires traceability to be updated.
- **Routings:** R3-n1 → TASK-042; R3-n3 and R3-n4 → T-QA-05 / qa-lead; R3-n6 → qa-lead (TEST-STRATEGY §11) and TASK-015 (CI `globalTimeout`); R3.4 item 3's optional step hardening → TASK-007 / PR #17 owner. R3-n2 and R3-n5 can be fixed in the R3-M1 commit, or dropped.
- Earlier routings (m3 `*.gz`, m5, m6, n2, n4–n7, R2-n2, R2-n3) are unchanged.

### R3.6 Security flags for security-analyst

- **R3-M1:** ownership regression for the Jest environment/setup files (CWE-693, A05 Security Misconfiguration). Please confirm the fix in the record.
- Static server (test-only): traversal and malformed-escape handling verified (R3.1). The `//authority` parse divergence (R3-n5) cannot be used for an open redirect, because `Location` is always `/{lng}/`.
- The `jsdom-environment.mjs` round-1 n4 note (real Node `fetch` in jsdom) still applies, unchanged by the move.
- Supply chain: 4 new dev-only packages (Apache-2.0/MPL-2.0), exact pins, no install scripts, and the cooldown is enforced by `.npmrc`. Browsers come only via `deps:rebuild`.
