# Code review: TASK-042 localisable strings, en/es/fr parity and ICU messages (pre-push, round 1)

| Field | Value |
|---|---|
| Task | TASK-042 (US-115 DC, M0 Must; REQ-I18N-001/002/003/013; NFR-I18N-001/002; D-ARCH-014; PR #4 code review m2 and R3-n1) |
| Branch | `feat/TASK-042-localisable-strings-en-es-fr` |
| Head | `b8ba7788` (`ae013a58` deps, `5dfed964` runtime and shared `errors` namespace, `b8ba7788` checker); not pushed, no PR number yet |
| Base | `origin/main` `530629f4` (still the tip of `origin/main` at review time) |
| Reviewer | code-reviewer, 2026-11-21 |
| Bindings read | CLAUDE.md §8/§9; brief `docs/04-plan/briefs/TASK-042.md` and the WAVE-01 card; US-115 AT-US-115-01..09 and the gherkin map rows; ADR-0026 §2, §10 and amendment 3; D-ARCH-014; ADR-0001 (i18next 27); `docs/02-ux/content-and-i18n.md` §2; developer decisions D-TASK042-01..09 (commit bodies) |

```
VERDICT: APPROVED_WITH_NITS (merge conditions C1-C6 in §5)
SUMMARY: One i18next + i18next-icu instance per app over bundled resources. The locale is passed on every lookup and
         values go through `replace`. The 80 error messages move byte for byte into the shared `errors` namespace.
         The tools/i18n checker covers AT-02/03/05/06/09 and runs as a pinned `npm run lint` step. R3-n1 is fixed
         (served locale captured once; isSpaMode verified in the built HTML). No BLOCKER or MAJOR finding.
         Four MINOR: a missing or misnamed value silently renders the raw ICU source; the checker would reject the
         UX-mandated `{ns}.context.json` files; JSX-sibling concatenation is not detected; the +28.3 kB budget
         measurement is not recorded.
```

## 1. What I verified myself

All commands ran in the foreground, one at a time, in a `git archive b8ba7788` extract under the session scratchpad. The extract's `node_modules` was a junction to the worktree's (read-only use). The `tsBuildInfoFile` of web and admin was redirected inside the extract. The worktree stayed clean (`git status` empty before and after).

| Check | How | Result |
|---|---|---|
| Format | `prettier --check` on the 42 added or modified files | Clean |
| Lint | `eslint --max-warnings 0` (type-aware, repository config) on every changed `.ts`/`.tsx`, after `react-router typegen` in the extract | 0 errors. The one warning is the expected "file ignored" on the `bad-book-now.tsx` fixture, which ESLint ignores by design |
| Types | `tsc -b packages/shared packages/ui apps/web apps/admin`, plus a `noEmit` probe project over `tools/i18n/**/*.ts` (6 files, base strict options) | Clean |
| i18n checker on the repository | `tsx tools/i18n/check.ts` | `i18n: 0 finding(s); pending linguistic review: 6 of 6 es/fr namespaces`, exit 0 |
| Targeted Jest | `--selectProjects unit unit-dom --maxWorkers=2 --testPathPatterns 'tools/i18n\|packages/ui/src/i18n\|apps/(web\|admin)/app/i18n'` | 10 suites, 71/71 pass |
| AT-US-115-01 and the lint wiring | `negative-fixtures -t 'AT-US-115-01\|npm run lint'` | 2/2 pass. The `@platform/source` resolver row fails, but only in an archive copy (a known false failure: the links resolve into the worktree) |
| Mutation testing | `mut.cjs`: 17 mutants with a function replacer, each followed by the pinning suite and a restore | **16/17 killed.** Killed: U1 (live read of `<html lang>`), U2 (ignoring `isSpaMode`), M1/M2 (dedupe off, or per key instead of per locale+key), C1 `returnEmptyString: true`, C2 values passed top-level instead of `replace`, C3 shadow guard off, K1 placeholder parity off, K2 unknown plural categories ignored, K3 collisions off, K4 register status unchecked, K5 test files counted as use, K6 `+=` not flagged, K7 unregistered set ignored, K9 `requiresOtherClause: false`, K10 extra-key off. **Survivor M3** (`res !== ''` in missing-key.ts:43) is equivalent under `returnEmptyString: false` (n5) |
| Lint-step pin | Reading `LINT_STEPS` (exact mode `toEqual`) | Dropping `&& npm run i18n:check` from `lint` fails the "npm run lint" row |
| Errors namespace move (D-TASK042-02) | Parsed `apps/{web,admin}/locales/{en,es,fr}/common.json` at `530629f4` against `packages/ui/src/locales/{lng}/errors.json` at head | `errors` is identical in all 6 files (80 keys each). The rest of each `common.json` is unchanged. A pure move |
| Hydration (D-TASK042-05) | Built web in the extract, then inspected `build/client/index.html` and `es/index.html` | SPA fallback: `isSpaMode:true`, `lang="en"`. Pre-rendered `/es`: `isSpaMode:false`, `lang="es"`. The `__reactRouterContext` inline script comes before the `type="module" async` script, and `root.tsx` imports `use-locale`, so `SERVED_LOCALE` is captured before `hydrateRoot` |
| Runtime probe | `probe-icu.mts` (tsx, `@platform/source`) on `createI18n` | `en('greeting')` (no value) → `Hello {name}`. `{nom}` instead of `{name}` → `Hello {name}`. `es('items')` with no count → the whole raw `{count, plural, …}` source. **No warning on any path** (m1) |
| Scanner probe | `probe-scan.mts` | Not flagged: `<p>{t('a')} {t('b')}</p>`, `<p>{t('price')} {n}</p>`, `tr('a') + tr('b')`, `createTranslator('es')('a') + '!'`, `parts.join` on a variable (m3, n3). An en-only `common.context.json` is loaded as namespace `common.context` (m2) |
| Bundle budget | `react-router build` of web and admin plus `size-limit` at head and at base `530629f4` (second extract) | Web public JS: **125.67 → 153.97 kB gz (+28.30; 16.03 kB headroom of 170)**. Admin: 122.43 → 150.61 kB (limit 350). CSS unchanged. esbuild + gzip -9 breakdown: i18next ≈ 15.9 kB, i18next-icu ≈ 3.3 kB, intl-messageformat ≈ 10.0 kB (of which the parser is ≈ 8.4 kB). The ICU part (≈ 13.3 kB) is inside D-ARCH-014's "≈ 15–20 kB" (m4) |
| Lockfile union with TASK-041 | TASK-041's branch head is now `96eda1e1` (it was `3a6b4c8b` at dispatch). Ran `git merge-tree --write-tree 96eda1e1 b8ba7788`, then `lockunion.cjs` (parsed `packages` maps) | Clean merge (exit 0). Package keys are disjoint. TASK-041: removes `node_modules/rate-limit-redis` and changes `apps/api`. TASK-042: adds the 6 packages and changes `""` and `packages/ui`. The merged lock equals base + both deltas (0 differences); top-level fields are equal. **Git unions it mechanically; no regeneration needed** |
| Other in-flight overlaps | `merge-tree` against the TASK-038, 040, 040-v2, 043 and 045 branches | All clean. TASK-038 shares `package.json` and `negative-fixtures.test.ts`; the merged `lint` script keeps the `i18n:check` step |
| New packages | Parsed lock entries | i18next 27.1.1 MIT (peer `typescript` ^5‖^6‖^7, satisfied). i18next-icu 2.7.0 MIT (peer intl-messageformat >=10.3.3 <13). intl-messageformat 12.1.5 BSD-3-Clause. @formatjs/icu-messageformat-parser 3.5.23, icu-skeleton-parser 2.1.13 and fast-memoize 3.1.7, all MIT. No `hasInstallScript`. The root devDependency parser dedupes with the one the runtime uses |

**Not re-run:** full `npm run lint` (`eslint .`), full `tsc -b` (api, worker, prisma and tests projects), full `test:unit`, coverage, Docker image builds, `npm audit`/osv (needs network), and e2e (no browsers; lane B). Lane A CI and lane B cover these (C1, C2).

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| m1 | MINOR | `packages/ui/src/i18n/create-i18n.ts:43` | `new ICU()` keeps i18next-icu's default `parseErrorHandler`, which returns the raw message when formatting fails. A value missing at the call site (e.g. `t('greeting')`) or misnamed (`{nom}` for `{name}`) renders the ICU source to the user (`Hello {name}`, or the whole `{count, plural, …}` text). Nothing is logged: i18next-icu only warns under `debug: true`. The checker compares en/es/fr with each other, never the code with the message, and `MessageValues` is untyped per key. This is a silent catch-all (CLAUDE.md §9) in the runtime every screen will use. | Pass `new ICU({ parseErrorHandler })`. The handler warns once per locale and key through the same `warn` sink as missing-key.ts, naming the key and the error kind only (no `err.message`, which quotes the message), and keeps returning `res`. Add a unit case for a missing value and one for a misnamed value. Optional later: per-key value typing. |
| m2 | MINOR | `tools/i18n/catalogue.ts:66-68` | Every `*.json` in `{lng}/` is loaded as a namespace. UX §2.2 (normative) requires a sibling `{ns}.context.json` (en only) for translator context. As soon as someone adds one, the checker reports `missing-namespace` (es, fr), `unused-key` for every context entry and a `review-register` mismatch. Probe: an en-only `common.context.json` is loaded as namespace `common.context`. | Skip `*.context.json` when loading namespaces. Better still, add a `context-key` check: every key in `{ns}.context.json` exists in en `{ns}`. Add one fixture row. |
| m3 | MINOR | `tools/i18n/sources.ts:54-70` | `isConcatenation` covers `+`/`+=`, template substitutions, `[…].join` and `.concat`, but not JSX. In JSX, a sentence built from adjacent children is the common way to concatenate: `<p>{t('a')} {t('b')}</p>` and `<p>{t('price')} {n}</p>` both pass the checker, and `i18next/no-literal-string` passes them too. The literal AT-05 scenario (`t("a") + t("b")`) is met, but UX §2.3 "No concatenation" is broader, and the file's JSDoc reads as complete. | Add a JSX branch: flag a `JsxElement`/`JsxFragment` whose children include a translation-call expression container next to any other non-whitespace child (text, expression or another call); `<Trans>` is the remedy. Add fixtures for both probe shapes, plus a negative fixture for a lone `{t('a')}`. If you defer it, route it with an owner in DECISIONS and correct the JSDoc to list what is not covered. |
| m4 | MINOR | `.size-limit.json` / commit `ae013a58` body | ADR-0026 am. 3 and D-ARCH-014 count the ICU runtime inside the 170 kB public budget, say it is "measured in Wave 0", and define a fallback if the budget is breached. The PR adds **+28.30 kB gz** (i18next ≈ 15.9; ICU stack ≈ 13.3, of which the parser is ≈ 8.4) and leaves 16.03 kB of headroom. Neither DECISIONS nor the commit bodies record this. The M1 home hero (RHF, Zod, TanStack Query, Axios) is unlikely to fit in 16 kB. | Record the measurement (D-TASK042-10: base, head, breakdown, headroom) and route the forecast to principal-architect before TASK-068/US-109 work starts. Name the first lever: pre-compile messages to ASTs at build time and drop the runtime parser (≈ 8.4 kB). That comes before D-ARCH-014's suffix-plural fallback. |
| n1 | NIT | `tests/e2e/i18n.spec.ts:13-17` | The AT-04 e2e checks only the engine's `Intl.PluralRules`, never a message rendered by the app bundle. It also hard-codes CLDR ≥ 42 categories (es `many`). An engine on an older system ICU (for example Playwright WebKit on Ubuntu 22.04 with libicu70) fails the test, although the product degrades correctly to `other`. | Watch it at the wave-end three-engine run. If it fails there, assert only the categories the shipped messages need, or render one real plural message through the app. |
| n2 | NIT | `tools/i18n/catalogue.ts:82-83` | Discovery sees only `apps/*/locales` and `packages/*/src/locales`. D-TASK042-09 says a new locales folder "fails until registered", but that holds only for those two shapes. E-mail template sets under api/worker, or UX's `packages/ui/locales`, would go unseen. | Walk `apps/` and `packages/` for any `locales` directory, skipping `node_modules`/`dist`/`build`, or narrow the D-TASK042-09 wording. |
| n3 | NIT | `tools/i18n/sources.ts:31`, `checks.ts:119` | The scanner recognises `t`, `translate` and `x.t` only. An alias (`const tr = useT()`), a factory call (`createTranslator(l)('a')`) and `.join` on an array variable all escape. Unused-key detection treats any string literal anywhere in the consumers as a use, so common words (`'title'`) mask unused keys. Both are best-effort by design. | Document the convention (translators are named `t`/`translate`) in the module JSDoc. When the lint lock frees, consider an `id-match`-style rule on `useT()` bindings. |
| n4 | NIT | `tools/i18n/check.ts:46` | The register is `JSON.parse(...) as ReviewRegister` with no validation. A missing file or a missing `namespaces` property throws a TypeError stack instead of a `review-register` finding. It fails closed, but the message is poor. | Validate the shape and report a finding. |
| n5 | NIT | `packages/ui/src/i18n/missing-key.ts:43` | Mutant M3 (`res !== ''` removed) survives. Under `returnEmptyString: false`, i18next never resolves `''`, so the guard is unreachable. | Drop the guard, or keep it with a comment that it is defensive. |
| n6 | NIT | `packages/ui/src/i18n/locales.ts:14,19`; `create-i18n.ts:35` | The apps' own namespace is `common`, but UX §2.1 assigns `common` to ui (shared generic actions). When ui gains `common`, `createI18n` throws on its own shadow guard. | Route a ruling to ux-designer/TASK-068/069 now: the app namespace becomes `shell` (UX §2.1), or ui `common` is renamed. Also update the UX §2.1 path to `packages/ui/src/locales` (D-TASK042-02). |

No security-sensitive defect found. React escapes text and attributes, and the lint config has `platform/no-innerhtml`, so `escapeValue: false` with verbatim ICU insertion is acceptable (REQ-SEC-016). The missing-key warnings name the locale and key only; the test pins that no value appears.

## 3. Rulings on the developer decisions

| Decision | Ruling | Basis |
|---|---|---|
| D-TASK042-01 (versions, six packages, react-i18next deferred) | **Accepted** | The pins match D-ARCH-014. i18next 27.1.1 (2026-11-10) is past the 7-day cooldown and inside ADR-0001's i18next 27. Licences are MIT/BSD-3. No install scripts. The checker's parser dedupes with the runtime's. Lock delta: adds only, plus `packages/ui` and the root entry. react-i18next waits for the first `<Trans>` consumer: fine. |
| D-TASK042-02 (`errors` moves to `packages/ui/src/locales`) | **Accepted** | Byte-identical move (§1). Completeness has three layers: (1) `ERROR_MESSAGES: Record<ErrorCode\|'UNKNOWN', string>` fails the type-check when a code is added; (2) `es`/`fr` are typed as the en shape; (3) error-key.test pins the exact key set in all three locales, and the checker adds extra-key and placeholder checks. The `src/` path deviation from UX §2.1 is justified by `rootDir`; the doc update is part of n6. |
| D-TASK042-03 (`getFixedT`, values through `replace`, sync init) | **Accepted** | The instance language is never changed after `lng: 'en'`, so a lookup is a pure function of (locale, key, values) during prerender and hydration alike. Mutant C2 (top-level values) is killed by the `lng` placeholder test. `isInitialized` is true on return. |
| D-TASK042-04 (en fallback, warn once per locale and key, key only; empty = missing) | **Accepted, with m1** | Dedupe granularity is pinned (M1, M2 killed). AT-07 says "once per key"; once per locale and key is a reasonable superset. The same sink should also carry format failures (m1). |
| D-TASK042-05 (PR #4 R3-n1: served locale captured once, `isSpaMode`) | **Accepted; R3-n1 closed on unit evidence** | Built HTML confirms the `isSpaMode` values and the script order (§1). U1 and U2 are killed. The e2e console-guard cases (`/es/no-such-page`, admin `lng=fr`) remain lane B evidence (C1). PR #4 R4-m1 is unaffected; it stays with TASK-015's Linux WebKit repeat. |
| D-TASK042-06 (checker in tools/i18n instead of an ESLint rule; lint lock) | **Accepted** | AT-05 "lint fails" holds: `npm run i18n:check` is an exact-pinned `LINT_STEPS` entry, and dropping it fails negative-fixtures. CI lane A runs `npm run lint`. The cost is no in-editor feedback. Coverage gaps: m3 and n3. |
| D-TASK042-07 (every plural needs every CLDR category of its locale) | **Accepted** | Stricter than UX §2.3 "wherever unbounded", but decidable without context. It reads the host `Intl` of the pinned Node 24, so the check is deterministic per Node version. |
| D-TASK042-08 (linguistic-review register) | **Accepted** | AT-06 is met: a missing, unknown or stale entry or status fails, and the pending count is printed on success. |
| D-TASK042-09 (out of scope: suite activation, e-mail sets, m6) | **Accepted** | Activation of `i18n-parity` in `required-suites.json` is manifest-only and belongs to the orchestrator (C5). m6 does not apply because no lazy route is added. The e-mail wording is covered by n2. |

## 4. Good patterns worth keeping

- One pure checker core and a thin CLI. The fixture-repository tests run the real checker in temp dirs, and the last block runs it on this repository, so the CI gate and the unit suite cannot drift.
- The checker parses with the same parser and options (`ignoreTag`, `requiresOtherClause`) as the runtime.
- The served-locale capture is tested with an isolated module registry, and a live-read mutant fails it.
- The shared-namespace shadow guard, and `replace` to keep placeholders apart from i18next options. Both are pinned.
- The warning text names the key, never values, and a test pins this.

## 5. Merge conditions

- **C1 (lane B, Chromium on `pr`):** on `b8ba7788` or a later head, run `tests/e2e/i18n.spec.ts` plus the existing web `/es/no-such-page` and admin `lng=fr` cases under the console-error guard (never allow-listed). The three-engine run happens at wave end (watch n1).
- **C2 (lane A CI green on the pushed head):** `lint` (including `i18n:check`), `typecheck`, the full `unit`/`unit-dom` run, `build` with `size-limit`, and `sec-static` for the six new packages (audit, osv, licence/age/cooldown, check-lockfile).
- **C3 (security record):** the PR changes security-owned paths: `/package.json`, `/package-lock.json` and `**/package.json` (`packages/ui/package.json`), per CODEOWNERS. A committed security review record naming this head, or a later one, is required.
- **C4 (record m4 before merge):** add D-TASK042-10 with the budget numbers and route the forecast to principal-architect. Fix m1 in this PR if a fix cycle opens (it is small and sits in the runtime core). Otherwise route m1 to TASK-054/058 with an owner. m2, m3 and n1-n6 may be routed with owners in DECISIONS.
- **C5 (follow-up):** a manifest-only `i18n-parity` activation in `tools/quality/required-suites.json`. Its runner must cover `tools/i18n/parity.test.ts`, `packages/ui/src/i18n/*.test.ts`, the app `messages.test.ts` files (AT-07/08) and the AT-01 negative-fixture row.
- **C6 (second merger with TASK-041):** the lockfile unions mechanically (proved against TASK-041 `96eda1e1`), so no `npm install --package-lock-only` is needed. If either branch changes its lock again, re-prove it with `git merge-tree` plus a parsed `packages` comparison. Use a squash merge.
