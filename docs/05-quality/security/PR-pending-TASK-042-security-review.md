# PR-pending: TASK-042 (localisable strings, en/es/fr parity and ICU messages through i18next-icu; US-115), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-042-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's checker does not count a `PR-pending-*` name (simulation S3 in §9).

**Finding IDs.** `PR042-SEC-nn` are the findings of this task (TASK-042). They are not the `PR42-SEC-nn` findings of PR #42 (TASK-025, audit writer).

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-042-localisable-strings-en-es-fr` on base `530629f4`: `ae013a58` (dependencies), `5dfed964` (ICU runtime and the shared `errors` namespace), `b8ba7788` (the `tools/i18n` checker in `npm run lint`) |
| Head | b8ba77882f0998945201c0cf8e91dc8b33cdf36c |
| Merge base with main | `530629f4`. Main's tip when this round was written is `7f8731dd`; `530629f4..7f8731dd` changes nothing outside `docs/` and `.claude/agent-memory/`, and `git merge-tree --write-tree 7f8731dd b8ba7788` is clean |
| Lane A evidence | None: the branch is not pushed. Main's gate scripts were run by hand on a shared clone at the head (§2). Main's classifier gives `security_paths=true` (production-closure lockfile change) and `lint_controls=true`, so the hosted `security-integration` job and the base-ref negative-fixture step run on the PR |
| Lane B evidence | None yet (`tests/e2e/i18n.spec.ts` and the console-guard cases are lane B; code review C1) |
| Owned paths changed | 6, as main's checker counts them (`--base 530629f4 --head b8ba7788 --pr 9999`, no record: `missing`): `package.json`, `package-lock.json`, `packages/ui/package.json`, `packages/ui/tsconfig.json`, `tests/fixtures/lint/react/apps/web/app/components/bad-book-now.tsx`, `tools/lint/negative-fixtures.test.ts` |
| Unowned paths read | `packages/ui/src/i18n/**`, `packages/ui/src/locales/**`, `packages/ui/src/index.ts`, `apps/{web,admin}/app/i18n/**`, `apps/{web,admin}/locales/**`, `tools/i18n/**`, `tests/e2e/i18n.spec.ts`; for context `packages/shared/src/errors/catalogue/index.ts` (`isErrorCode`), `eslint.config.mjs` (`platform/no-innerhtml`, `i18next/no-literal-string`), `tools/lint/check-suppressions.mjs` (`PROTECTED_RULES`), `.github/workflows/ci.yml` (lane A step order), `apps/api/Dockerfile` (install scope); the installed `i18next-icu` 2.7.0 `dist/es/{index,utils}.js` |
| Binding items checked | CLAUDE.md §5 (dependencies) and §9; brief `docs/04-plan/briefs/TASK-042.md` and its card; ADR-0001 (i18next 27); D-ARCH-014 (pins); ADR-0026 §2 and amendment 3 (no `eval`, pre-formatted values); REQ-SEC-016; D-TASK042-01..09 (commit bodies); code review round 1 `docs/05-quality/reviews/PR-pending-TASK-042-code-review.md` (`7f7dcf52`, APPROVED_WITH_NITS, its C3 asks for this record); D-SD-011 routings (TASK-042 suite activation, TASK-068/069 n6, TASK-125 m4) |
| Reviewer / date | security-analyst, 2026-11-21, round 1, pre-push. Host rule: foreground commands only, one at a time, each at most 8 minutes, no Docker. Nothing ran in the TASK-042 worktree except a read-only `git log`/`git status` at the start; every git read after that used the shared object store from the main checkout, and every probe ran on a `git archive b8ba7788` extract or a shared clone in the session scratchpad, with a `node_modules` junction to the worktree's install (read only) |
| Verdict | **PASS_WITH_CONDITIONS.** No Critical or High finding. One MEDIUM (PR042-SEC-01, a published High upstream advisory on the pinned i18next 27.1.1, not reachable in this configuration) and four INFO. Merge condition C1 bumps i18next to 27.1.3 or later once it clears the 7-day cooldown; conditions C1 to C4 in §8 |

## 1. Summary

The six new packages are clean on every supply-chain check this host can run: allow-listed licences (MIT, BSD-3-Clause), registry signatures valid, lockfile integrity equal to the registry and to the downloaded tarballs, registry `resolved` URLs, no install script that npm would run, no binaries, no transitive dependency outside `@formatjs/*`, the 7-day cooldown respected at lock time, and 0 advisories in npm's bulk feed, OSV and npm audit of the head install. Main's real `check-lockfile`, `check-dep-age` and `licence-check` pass on the head.

One upstream fact changes the picture: **i18next published a High repository advisory, GHSA-q76c-gcvw-89x9 (CVSS 7.5, CWE-248/CWE-400, "i18next exits the Node process on a language code named after an inherited property"), for every version below 27.1.3, on 2026-11-16.** It is not in the reviewed GitHub Advisory Database yet, so npm audit and OSV do not report it, and lane A will pass today. 27.1.3 was 4.9 days old when the lockfile was written, so the developer's "newest release past the cooldown" claim (D-TASK042-01) was right at the time. Probes show it is not reachable through this PR's configuration (bundled resources, no backend, fixed locale list), but the shipped version carries a known High (CLAUDE.md §5) and lane A will start failing on it as soon as GitHub reviews the advisory. That is **PR042-SEC-01 (MEDIUM)**, and the bump is merge condition C1.

The rendering path holds. Values go into the ICU message verbatim; i18next's own interpolation and `$t()` nesting are bypassed under i18next-icu, so a value is never re-parsed (probed). React's text escaping is the only escaper, which matches REQ-SEC-016 and `escapeValue: false`; `platform/no-innerhtml` is a protected rule over all app and package sources. No shipped message has a placeholder, a tag or a URL (327 messages), and no consumer passes values yet. The missing-key warning names the locale and key only (probed with sentinels); format errors are silent (code review m1) and print nothing. `errorMessageKey` uses `Object.hasOwn`, so inherited names map to `errors:UNKNOWN`. i18next-icu 2.7.0 carries the 2.4.4 prototype-pollution guard on its memo walker.

The checker fails closed as a lint step: under `tsx`, a missing key, an ICU syntax error, a placeholder mismatch, malformed JSON and a BOM all exit non-zero, and the step is the last link of the `&&` chain. It reads only top-level `{lng}/*.json` files of three registered folders, so translation content placed elsewhere is never checked (INFO, with code review n2); this is a localisation gate, not a security control.

The lockfile unions mechanically with TASK-041 at its current head `0614a90f`: `git merge-tree` is clean, the package keys are disjoint, and the merged lock equals the base plus both deltas.

## 2. Method and evidence

| Probe | What | Result |
|---|---|---|
| Lock delta | Generic leaf diff of `package-lock.json` `530629f4` → `b8ba7788` (positive control: one tampered integrity is found) | 42 leaves in 8 package keys: the 6 new `node_modules/*` entries, `packages/ui` (4 dependency leaves: `@platform/shared`, `i18next`, `i18next-icu`, `intl-messageformat`) and the root `devDependencies.@formatjs/icu-messageformat-parser`. Nothing removed or changed; no `hasInstallScript`, `bin`, `optional` or `dev` flag; one copy of the parser (the checker's and the runtime's are the same tuple). Main's lock equals the base lock |
| Registry | Packument and version manifest per tuple, `dist.signatures` verified as ECDSA P-256 over `name@version:integrity` against `-/npm/v1/keys` (tampered-integrity control rejected for every signature), tarball downloaded and hashed, tar entries listed (never extracted to run) | §3 |
| Advisories | npm bulk endpoint and OSV `querybatch` for the 6 tuples, with `lodash@4.17.15` as a positive control (5 and 5 hits); GitHub global advisories by package; repository advisories of `i18next/i18next`, `i18next/i18next-icu` and `formatjs/formatjs` | 0 for every new tuple in both feeds and in the global database. Repository advisories: GHSA-q76c-gcvw-89x9 affects 27.1.1 (PR042-SEC-01); GHSA-5jr9-983r-c8x4 (`>= 25.3.3, < 26.4.4`) and GHSA-6jcc-5g8w-32mx (`<= 26.3.3`) do not; none for i18next-icu or formatjs |
| Main's gates by hand | Shared clone checked out at `b8ba7788`, main's `tools/ci` (`7f8731dd` has the same tools as `d99ccfc9`): `check-lockfile.mjs --base 530629f4`, `check-dep-age.mjs --fetch` then `--times`, `licence-check.mjs` (worktree install), `npm audit --json`, `security-paths.mjs` | `check-lockfile: PASS` (6 new production tuples, 0 integrity changes), `check-dep-age: PASS`, `licence-check: PASS`, npm audit 0 high/critical (34 moderate rows, all pre-existing dev tooling: minimatch GHSA-g3hv-75wg-m249 and glob GHSA-3g3m-2fjr-6pw4, already on the watch list; none names a new tuple). osv-scanner was not run (it needs Docker); OSV was queried through its API instead |
| Runtime | The PR's `packages/ui/src/i18n/*.ts`, type-stripped, with the real i18next 27.1.1, i18next-icu 2.7.0 and intl-messageformat 12.1.5; every console channel captured; random sentinels | §4 |
| Advisory reachability | (a) the PR's `createI18n` with `changeLanguage`, `loadLanguages` and `getFixedT` for `hasOwnProperty`, `isPrototypeOf`, `toLocaleString`, `__defineGetter__`; (b) positive control: a plain i18next 27.1.1 instance with an asynchronous backend and `changeLanguage('hasOwnProperty')` | (a) no throw, language stays `en`; (b) one uncaught `obj[k].push is not a function` (the advisory, reproduced) |
| Checker | The PR's real CLI (`tsx tools/i18n/check.ts --root <fixture>`) on 16 fixture copies of the head tree | §5 |
| Union | `git merge-tree --write-tree 0614a90f b8ba7788`; parsed `packages` maps: merged versus base plus both deltas, with a dropped-entry control | §6 |
| Gitleaks | Faithful v8.30.1 emulation (no generic digit check, per-hunk fragments, base `.gitleaks.toml`), `git log -p -U0 --diff-merges=first-parent --text 530629f4..b8ba7788`, runtime positive controls | 1,936 added lines, **0 findings**; controls `1,1,0` as expected |
| Record binding | Main's real `check-security-owned-paths.mjs` in a sparse shared clone, plumbing scenarios | §9 |

Not run: Docker (osv-scanner, gitleaks image), Jest suites, ESLint, `tsc`, the build and size-limit. Code review round 1 ran lint, types, the targeted Jest projects, the build and the budget on an extract; lane A and lane B cover the rest (C2).

## 3. Supply chain, per package

All six resolve to `https://registry.npmjs.org/<name>/-/<file>.tgz`, and in every case the lock integrity equals the registry's `dist.integrity` and the SHA-512 of the downloaded tarball. All tarballs hold only `package/` entries, no links, no `binding.gyp` and no binary-like files. Ages are at the lock commit `ae013a58` (2026-11-21T04:06Z); the cooldown is `min-release-age=7`.

| Package | Licence (lock / registry / tarball) | Published, age at lock | Newest release | Scripts | Signatures / provenance | Dependencies | Advisories |
|---|---|---|---|---|---|---|---|
| `i18next@27.1.1` | MIT / MIT / MIT | 2026-11-10, 10.8 d | 27.2.2 (2026-11-19) | `prepare` only: npm runs it for git and local installs, never for a registry tarball, and `.npmrc` sets `ignore-scripts=true`; the lock has no `hasInstallScript` | 2 valid; no provenance attestation | none (optional peer `typescript`) | **GHSA-q76c-gcvw-89x9, High, `< 27.1.3`** (repository advisory only; PR042-SEC-01). npm bulk 0, OSV 0 |
| `i18next-icu@2.7.0` | MIT / MIT / MIT | 2026-11-05, 15.2 d | 2.7.1 (2026-11-19; formats fixes only) | none | 2 valid; no provenance attestation | none (peer `intl-messageformat >=10.3.3 <13`) | 0 |
| `intl-messageformat@12.1.5` | BSD-3-Clause (all three) | 2026-11-08, 12.2 d | 12.2.0 (2026-11-17) | none | 2 valid; SLSA v1 provenance | `@formatjs/fast-memoize` 3.1.7, `@formatjs/icu-messageformat-parser` 3.5.23 (exact) | 0 |
| `@formatjs/icu-messageformat-parser@3.5.23` | MIT | 2026-11-08, 12.2 d | 3.5.23 | none | 2 valid; SLSA v1 provenance | `@formatjs/icu-skeleton-parser` 2.1.13 | 0 |
| `@formatjs/icu-skeleton-parser@2.1.13` | MIT | 2026-11-08, 12.2 d | 2.1.13 | none | 2 valid; SLSA v1 provenance | none | 0 |
| `@formatjs/fast-memoize@3.1.7` | MIT | 2026-07-11, 133 d | 3.1.7 (4.4 months) | none | 1 valid; SLSA v1 provenance | none | 0 |

- **Maintenance:** every package released within 18 months (the oldest newest-release is `@formatjs/fast-memoize`, 4.4 months); none deprecated; 2 or 3 maintainers each.
- **Cooldown:** every tuple was at least 10.8 days old at lock time. For i18next, 27.1.2 (2026-11-15T07:04Z) and 27.1.3 (2026-11-16T05:54Z) were 5.9 and 4.9 days old, so 27.1.1 was the newest admissible release.
- **Pins:** the D-ARCH-014 pins hold (i18next-icu 2.7.0, intl-messageformat 12.1.5, parser 3.5.23) and i18next is inside ADR-0001's 27 line. All four direct pins are exact.
- **Closure:** the six tuples are production closure through `packages/ui` (the static web and admin bundles). `apps/api` installs with `--workspace=apps/api` and prunes to its own closure, so the api image does not ship them.
- **Workspace link:** `packages/ui` now depends on `@platform/shared` 0.0.0; the lock keeps `node_modules/@platform/shared` as a link to `packages/shared`, and `check-lockfile` (which enforces link-only `@platform/*`) passes. The web bundle already carried the shared error catalogue at the base (`apps/web/app/i18n/error-messages.ts` imported `isErrorCode`), so the browser sees nothing new.
- **What I could not verify:** advisory feeds other than npm, OSV and GitHub (repository and global); the osv-scanner image; behaviour of the bundled packages in real browsers (lane B). Provenance attestations exist only for the four formatjs packages; npm's signature check does not require them, and `npm audit signatures` in lane A checks the signatures.

## 4. Rendering, injection and log paths (`packages/ui/src/i18n/**`)

| Probe | Result |
|---|---|
| A value `<img src=x onerror=alert(1)>` in `Hello {name}` | Returned verbatim as text. Safe only because React renders it as text: true for every current consumer |
| A value that is ICU (`{name}`), i18next nesting (`$t(errors:UNKNOWN)`) or i18next interpolation (`{{lng}}`) | Returned verbatim; i18next-icu replaces i18next's interpolation and nesting, and intl-messageformat never parses values |
| A `select` value of `constructor`, `__proto__`, `toString`, `hasOwnProperty` | Selects `other`; no throw |
| Crafted locale codes (`hasOwnProperty`, `constructor`, `__proto__`, `toString`, `constructor-US`, `xx1`) through the app API | English text, no throw (advisory reachability (a) in §2) |
| `errorMessageKey` with `__proto__`, `constructor`, `toString`, `hasOwnProperty` | `errors:UNKNOWN` (`Object.hasOwn`) |
| Missing-key warnings with a sentinel value | 10 warnings, none carries the value |
| Format errors (missing value, non-number to `plural`/`number`, non-date to `date`) through a capturing `parseErrorHandler` | Nothing on any console channel. `MissingValueError` quotes the message source, never a value; `RangeError` quotes neither; a string `count` formats as `NaN` instead of failing |
| Console output of `createI18n` and every lookup above | 0 lines (no support notice, no debug output); the instance has `debug: false` |
| Content | 327 shipped messages: 0 with an ICU argument, 0 tag-like, 0 with a URL or scheme. No consumer passes values (`fixedTranslator` is the only `replace` call) |

So the PR adds no injection path today. Two forward conditions follow from the design (PR042-SEC-02): values are raw, so they must never reach a non-text sink, and `<Trans>` (react-i18next, deferred to its first consumer) parses component tags after ICU has inserted the values.

## 5. The `tools/i18n` checker as a lint gate

| Fixture | Exit | Findings |
|---|---|---|
| C0 clean head | 0 | 0, "pending linguistic review: 6 of 6" |
| C1 es key removed | 1 | `missing-key` |
| C2 fr `Erreur {` | 1 | `icu-syntax` |
| C3 es `Error {detail}` (en has no argument) | 1 | `placeholder-mismatch` |
| C4 malformed JSON | 1 | crash (`SyntaxError`), fails closed |
| C5 UTF-8 BOM | 1 | crash, fails closed |
| B7 an es-only `__proto__` key | 1 | `extra-key` |
| R1 `apps/web/locales` removed, register intact | 1 | `review-register` (the register is a floor) |
| A1 unknown argument | 2 | usage error |
| B1 `apps/web/locales/es/extra/common.json` with a broken message | 0 | none (subfolders are not read) |
| B2 `packages/ui/locales/es/shell.json` (the UX §2.1 path) | 0 | none |
| B3 `apps/web/app/i18n/extra-es.json` | 0 | none |
| B4 `apps/web/locales/es/more.JSON` | 0 | none |
| B5 an inline TypeScript catalogue `{ es: { a: 'Hola {nombre' } }` | 0 | none |
| B6 `apps/web/locales/de/common.json` | 0 | none (not a shipped locale) |
| R2 locales folder and its register entries removed together | 0 | none (the app's static JSON imports then fail the type-check and build) |

- The `import.meta.main` guard works under `tsx` (C1-C5 exit 1), so the step cannot pass silently by not running.
- `npm run i18n:check` is the last link of the `lint` `&&` chain, after ESLint, Stylelint and the suppression check, so it cannot undo an earlier step, and the porcelain gate after `lint` catches a step that writes files. Lane A's supply-chain gates (lockfile, cooldown, licences, signatures, audit) run before `deps:rebuild` and before any head code. The PR4-SEC-13 class is unchanged: `typegen` already runs unowned head code earlier in the same step.
- `LINT_STEPS` pins the step `npm run i18n:check`, but not the body of the `i18n:check` script (PR042-SEC-05). `tools/i18n/**` is neither security-owned nor in `LINT_CONTROL_PATHS`. That is acceptable for a localisation gate.
- B1 to B5 are the bypass the dispatch asked about: content outside top-level `{lng}/*.json` of a registered folder is never checked, while the runtime renders whatever the code imports (PR042-SEC-04, extends code review n2). React escaping holds for all of it, so this is a quality gap only.

## 6. Lockfile union with TASK-041

- TASK-041's branch head is now `0614a90f` (the merge of `96eda1e1` with `530629f4`; code review C6 proved the union against `96eda1e1`). Its lock differs from `96eda1e1`'s by main's `effect` leaves, which are also in TASK-042's base.
- Merge base of `0614a90f` and `b8ba7788`: `530629f4`. `git merge-tree --write-tree 0614a90f b8ba7788` exits 0 (tree `3cad6086`). The only path both branches change is `package-lock.json`.
- Parsed `packages` maps: TASK-041 changes `apps/api` and removes `node_modules/rate-limit-redis` (2 keys); TASK-042 changes `""`, `packages/ui` and adds the 6 entries (8 keys); overlap 0. The merged lock equals base plus both deltas (0 differing keys; control: a dropped `node_modules/i18next` is found), the top-level fields equal the base's, and every workspace dependency has an installed entry.
- **C6 of the code review holds:** git unions the lock; no `npm install --package-lock-only` is needed. The C1 bump changes only `node_modules/i18next` and the `packages/ui` dependency string, so it stays disjoint from TASK-041 (re-prove after the bump, C4).

## 7. Findings

### PR042-SEC-01 · MEDIUM · i18next 27.1.1 is affected by a published High advisory (GHSA-q76c-gcvw-89x9)

- **CWE:** CWE-1395 (dependency on a vulnerable third-party component); the advisory's own classes are CWE-248 and CWE-400. **OWASP:** A06:2021 Vulnerable and Outdated Components.
- **Where:** `packages/ui/package.json:21` (`"i18next": "27.1.1"`), `package-lock.json:17129` (`node_modules/i18next`).
- **Description:** i18next's repository advisory GHSA-q76c-gcvw-89x9 (published 2026-11-16, High, CVSS 7.5) covers every version below 27.1.3. A language code named after an inherited `Object.prototype` property makes the backend connector throw `obj[k].push is not a function` when its load finishes; with an asynchronous backend nothing catches it, so one request ends a Node.js process, and in a browser `init()` never resolves. 27.1.3 also fixes a throw from `t()`, `getFixedT()` and `changeLanguage()` with an object `fallbackLng`. The advisory is not in the reviewed GitHub Advisory Database yet, so npm audit and OSV report 0.
- **Exploitability and impact:** not reachable in this PR. `createI18n` bundles its resources (no backend), uses a string `fallbackLng`, sets `supportedLngs` to en/es/fr, and the apps only pass locales that `isLocale` admits. Probe (a) drove `changeLanguage`, `loadLanguages` and `getFixedT` with four advisory codes without effect; probe (b) reproduced the uncaught throw on 27.1.1 as soon as an asynchronous backend is present. It becomes reachable when a later task adds a backend (lazy namespaces), a language detector, a `changeLanguage` with a request-derived code (TASK-062 locale resolution reads a cookie and the browser locale), or a server-side i18next (notification templates). Impact if reached: process exit on a server (High), a hung page in a browser. Likelihood today: Low. Matrix H × L = MEDIUM. Two further facts weigh on merge timing: CLAUDE.md §5 admits no dependency with a known High, and lane A's audit gate turns red for every PR once GitHub reviews the advisory (the `effect` precedent, D-SECAUDIT-02).
- **Remediation (code level):** in `packages/ui/package.json`, `"i18next": "27.1.3"` (or the newest 27.x that is at least 7 days old at the time of the bump; 27.1.3 qualifies from 2026-11-23T05:54Z, 27.1.5 from 2026-11-24T12:42Z, 27.2.2 from 2026-11-26T09:03Z). Then `npm install --package-lock-only --ignore-scripts` under the repository `.npmrc` (so `min-release-age=7` applies), and check that the lock delta is exactly `node_modules/i18next` (`version`, `resolved`, `integrity`) plus the `packages/ui` dependency string. No other change: i18next-icu has no i18next peer, and the typescript peer is unchanged.
- **Verification test:** a unit row in `packages/ui/src/i18n/create-i18n.test.ts` titled `[PR042-SEC-01] i18next is at least 27.1.3 (GHSA-q76c-gcvw-89x9)` that reads the installed `i18next/package.json` version and compares it numerically. Lane A on the fix head shows `check-lockfile` with one changed tuple and `check-dep-age: PASS`. A delta security round on the fix head confirms it (the bump changes owned paths, so the binding of this round is void anyway).

### PR042-SEC-02 · INFO · values are inserted raw, so the sinks must stay text-only, including the coming `<Trans>`

- **CWE:** CWE-79 / CWE-74. **OWASP:** A03:2021 Injection.
- **Where:** `packages/ui/src/i18n/create-i18n.ts:56` (`interpolation: { escapeValue: false }`), `:43` (i18next-icu with its default `escapeVariables: false`), `:72` (`replace: values`).
- **Description:** no layer below React escapes values (§4). That is correct for React text children and attribute values, which React escapes. It is unsafe for any other sink: a URL attribute (`href`, `src`, `action`) built from a translated string or a value (a `javascript:` URL), or a DOM write outside React. It is also unsafe inside react-i18next `<Trans>`, which the brief defers to its first consumer: `<Trans>` parses `<0>…</0>` component tags in the formatted string, and the formatted string already contains the values, so a value such as `<1>sign in again</1>` can wrap text in a component (a link) that the message author placed elsewhere.
- **Exploitability:** none today (no values, no placeholders, no `<Trans>`, `platform/no-innerhtml` protected). It is a design condition for the consumers.
- **Remediation:** conditions on (a) the task that adds react-i18next (the first `<Trans>` consumer): user-controlled data is never an ICU value of a `<Trans>` message; it is passed as a component child (`components={{ name: <span>{value}</span> }}` style) or the message is split; add one test with a value carrying `<0>x</0>` that renders as literal text; (b) every consumer: translated strings and values never feed a URL attribute (`href`, `src`, `action`, `formAction`, `to`) unless the URL is built from code constants; propose a lint rule (no `t()`/`translate()` call in those attributes) with the next lint-lock holder.
- **Verification test:** the `<Trans>` test in (a); a negative lint fixture for (b) when the rule lands.

### PR042-SEC-03 · INFO · constraints for the code-review m1 fix (format errors) and the debug switch

- **CWE:** CWE-532 (sensitive information in logs). **OWASP:** A09:2021.
- **Where:** `packages/ui/src/i18n/create-i18n.ts:43` (`new ICU()` with the default `parseErrorHandler`), `:44-63` (no `debug` option, so it defaults to off, and no test pins it).
- **Description:** I concur with code review m1 (a missing or misnamed value renders the raw ICU source, silently). For its fix: the handler must report the key, the locale and `err.code` (or the error class) only. Not `err.message`: intl-messageformat's `MissingValueError` quotes the whole message source, and other formatter errors can quote the offending value. Not `options`: they hold the values. i18next-icu's own warning (only under i18next `debug: true`) appends `err.message`, and i18next's debug logger prints its options, so `debug` must stay off in every build.
- **Remediation:** `new ICU({ parseErrorHandler: (err, key, res, options) => { report(key, options.lng, errorKind(err)); return res; } })` through the existing `warn` sink, deduplicated like missing keys; keep `createI18n` without a `debug` option.
- **Verification test:** a missing-value and a misnamed-value case that assert one warning with the key and kind, and no sentinel value in it; a row asserting `instance.options.debug === false`.

### PR042-SEC-04 · INFO · the checker reads only top-level `{lng}/*.json` of three registered folders

- **CWE:** CWE-693 (scope of a protection mechanism; here a localisation gate, not a security control). **OWASP:** none.
- **Where:** `tools/i18n/catalogue.ts:65-66` (`readdirSync` of `{lng}/`, `.json` only, no subfolders), `:79-92` (discovery of `apps/*/locales` and `packages/*/src/locales` only).
- **Description:** fixtures B1-B5 (§5) pass with broken messages in a subfolder, at the UX path `packages/ui/locales`, as JSON under `app/`, with an upper-case extension, or as an inline TypeScript catalogue. The runtime renders whatever the code imports, so parity, ICU and placeholder checks can be bypassed by location. React escaping and the type-checked catalogue shapes still hold.
- **Remediation:** with code review n2: (1) walk `apps/` and `packages/` for every `locales` folder (skipping `node_modules`, `dist`, `build`); (2) report any entry under `{lng}/` that is not a top-level `*.json` file; (3) in the source scan, report an import of a `.json` module from consumer code that does not resolve to a registered `{lng}/{ns}.json`.
- **Verification test:** fixture rows B1-B4 in `tools/i18n/parity.test.ts` expecting a finding each; one row for (3).

### PR042-SEC-05 · INFO · the `i18n:check` script body is not pinned

- **CWE:** CWE-693. **OWASP:** none.
- **Where:** `package.json:35` (`"i18n:check": "tsx tools/i18n/check.ts"`); `tools/lint/negative-fixtures.test.ts:1493` pins only `npm run i18n:check` in `lint`.
- **Description:** a later change of the script body to a no-op keeps the `LINT_STEPS` row green. Root `package.json` is security-owned, so such a change needs a security record; the pin turns it into a red test as well.
- **Remediation:** add an exact row for `scripts['i18n:check']` next to the root `typegen` pin.
- **Verification test:** mutating the body (for example `tsx tools/i18n/check.ts || true`) fails that row.

## 8. Conditions

- **C1 (merge condition, PR042-SEC-01).** Before merge: i18next 27.1.3 or later, as specified in the finding, with the version-floor test, and a delta security round on the fix head (owned paths change). 27.1.3 becomes admissible on 2026-11-23T05:54Z. If the merge has to happen before then, it may proceed at 27.1.1 only under the dated acceptance in D-SECPR042-01 (granted 2026-11-21, expires 2026-11-30): the bump then lands in a follow-up PR by 2026-11-30, and in any case before any task adds an i18next backend, a language detector, a `changeLanguage` with a request-derived code (TASK-062) or a server-side i18next. If GitHub reviews the advisory first, lane A turns red and the bump is the remedy (no waiver: it has an upstream fix).
- **C2.** Lane A green on the pushed head, including `Lockfile provenance and delta`, `Release cooldown and freshness`, `Licences`, `Registry signatures and provenance`, `Vulnerability audit` (npm audit and osv-scanner), `Lint` with `i18n:check`, the base-ref negative fixtures (`lint_controls=true`) and `security-integration` (`security_paths=true`). Lane B as in code review C1.
- **C3.** The orchestrator renames this record to `PR-<NNNN>-TASK-042-security-review.md` once the PR exists, and checks that the merge ref contains it (D-ORCH-136/138).
- **C4.** The second merger of TASK-041 and TASK-042 re-proves the lockfile union after any further lock change on either side (the C1 bump included): `git merge-tree` plus the parsed `packages` comparison of §6. If git cannot union it, regenerate with `npm install --package-lock-only --ignore-scripts` and run `check-lockfile` and `check-dep-age` again. A main merge into this branch that brings TASK-041's lock voids this binding (§9 S10), so it needs a merge-only security round.
- **Follow-ups (not merge conditions).** PR042-SEC-03 with m1, and PR042-SEC-05, ride C1's fix cycle (small, same files). PR042-SEC-04 with n2: the same fix cycle, otherwise qa-lead at the `i18n-parity` activation. PR042-SEC-02 (a) on the task that adds react-i18next; (b) on TASK-062 and the next lint-lock holder.

## 9. Record binding

Six owned paths change (header). The checker binds the `Head` row `b8ba7788`. Simulation with main's real `check-security-owned-paths.mjs` in a sparse shared clone (`/.github/`, `/docs/05-quality/security/`, `/tools/ci/`), plumbing commits, PR number 9999:

| Scenario | Expected | Result |
|---|---|---|
| S1 merge ref (main tip + record named `PR-9999-…`, merged with `b8ba7788`), `--base 530629f4` | pass | pass, bound to `b8ba7788`, 6 owned paths |
| S2 the same with `--base` at the record commit | pass | pass |
| S3 the record under its pending name only | fail | `missing` (no `PR-9999-*.md`) |
| S4 no record | fail | `missing` |
| S5 a later round whose last `Verdict` row is FAIL | fail | `missing` (verdict FAIL) |
| S6 the `Head` row naming main tip `7f8731dd` | fail | `missing` (no commit of this PR) |
| S7 the C1 bump after the head (`packages/ui/package.json`, `package-lock.json`) | fail | `missing` (owned paths changed after `b8ba778`) |
| S8 the m1 fix after the head (`create-i18n.ts` only) | pass | pass |
| S9 an evidence commit under `docs/` after the head | pass | pass |
| S10 the branch merges a main that carries TASK-041 lockfile | fail | `missing` (`package-lock.json` changed after `b8ba778`) |
| S11 the branch merges a docs-only main | pass | pass |

11 of 11 as expected.

The binding survives a later commit that changes only unowned files (the m1 fix in `create-i18n.ts`, evidence, docs) and does not survive the C1 bump or a main merge that brings another lockfile change.

## 10. Alignment with code review round 1

- C3 of the code review asks for this record: done.
- m1: concurred; PR042-SEC-03 adds the logging constraints for its fix.
- n2: extended by PR042-SEC-04 (subfolders, other extensions, imports).
- C6: confirmed against TASK-041's current head `0614a90f` (§6).
- "No security-sensitive defect found": still true of the PR's own code. The one finding of this round is upstream (PR042-SEC-01) and was published after D-ARCH-014 chose the line.
