# PR-0002 / TASK-002: change-scoped security review

| Field | Value |
|---|---|
| PR | #2 `feat(lint): lint, format and layering rules with negative fixtures (TASK-002, US-001)`, https://github.com/sukhchdit/shipcube/pull/2 |
| Branch / head | `feat/TASK-002-lint-format-layering-rules-negative` @ `9bc9c04`; merge-base `4da693a`; `main` @ `26662fb` (docs-only since the merge-base); 4 commits; 98 files, +1,800 / −23 |
| Scope | `eslint.config.mjs`, `tools/eslint-rules/**`, `tools/stylelint-rules/**`, `tools/lint/**`, `stylelint.config.mjs`, `.stylelintignore`, `commitlint.config.mjs`, `tests/fixtures/lint/**`, `package.json` (3 new direct dev dependencies, `lint` script, `engines`), `package-lock.json` (+63 name@version tuples) |
| Security requirements in scope | D-ARCH-042 / ADR-0002 PR1-SEC am. item 3 (`bcrypt` confinement), D-ARCH-003 rev 2/rev 4 (licence and maintenance), ADR-0023 am. F/I/J (install hardening, cooldown), SEC-P3-04 (local part), NFR-MAINT-002, NFR-SEC-012; lint as a mitigation for ADR-0016 §13 (SSRF), REQ-SEC-016 (XSS), REQ-AUDIT-001, ADR-0005 (Prisma confinement) |
| Reviewer / date | security-analyst, 2026-11-12. Read-only on the worktree. Node 24.22.3, npm 11.19.1, run with the CLAUDE.md §2 PATH prefix. Host memory limits applied: no install, build, Docker or full suites. ESLint ran once in-process (`lintText`) against the real config to probe bypasses |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open for this change. Findings: 1 MEDIUM (PR2-SEC-01), 4 LOW (PR2-SEC-02..05) and 3 INFO (PR2-SEC-06..08). None is exploitable at `9bc9c04`, because no application code exists yet. Each finding is a gap in a control that Wave 1+ code will depend on, and each is routed to a named task below. **Merge is allowed** (no Critical/High). |

## 1. Summary

The supply-chain side of the change is clean:
- **Lockfile delta.** 63 new tuples, all dev-only. 0 removals, 0 integrity changes and 0 flag moves on existing entries.
  - Every `resolved` URL is on `registry.npmjs.org`, and every integrity is `sha512`.
  - No `hasInstallScript`, no `os`/`cpu` entries, no deprecations, and no `@platform/*` entry that is not a link.
- **Cooldown.** The 7-day cooldown held. The youngest entry is `table@6.10.1` at 8.2 days when the lockfile was committed.
- **Signatures.** `npm audit signatures` verifies 1,490 of 1,490 installed packages, 569 of them with attestations.
- **Licences.** Every licence is on the allowlist or is a D-ARCH-003 rev 2 equivalent.
- **Direct dependencies.** All three are exact-pinned and released within the last 10 months.
- **Advisories.** `npm audit --omit=dev` = 0. The dev closure has the same 3 root advisories as the base. The new plugin adds only one dependent edge to the `minimatch@10.2.6` that is already present.

The lint program works as specified for the paths the fixtures exercise. The findings concern how the controls can be **switched off or bypassed without anyone noticing**:
- **Inline `eslint-disable` and `/* eslint rule: off */` comments.** They disable the security-relevant rules (bcrypt confinement, `no-innerhtml`, `outbound-http-via-client`, `audit-writer-allowlist`, `boundaries/dependencies`). They need no justification and nothing counts them (PR2-SEC-01).
- **The `bcrypt` confinement misses some forms.** It does not catch `import('bcrypt')`, `createRequire(...)('bcrypt')` or `.cjs` `require` (PR2-SEC-02).
- **Some files get no rules at all.** `.jsx` files and any folder named `build`, `coverage` or `dist` at any depth receive no lint rules. Stylelint currently lints zero files (PR2-SEC-03).

## 2. Method

| Area | How it was verified |
|---|---|
| Lockfile integrity / registry | Structural diff of `git show 4da693a:package-lock.json` against `9bc9c04` (the lockfile is `-diff` in `.gitattributes`). The diff covered new and removed tuples, integrity changes on unchanged versions, `dev`/`optional`/`devOptional`/`peer`/`hasInstallScript` flag moves, `resolved` hosts, hash algorithm, aliases, `@platform/*` entries and `os`/`cpu` |
| Cooldown | Registry `time[version]` for every new tuple, compared with the commit time of `d7adad4` (2026-11-12T12:18Z) |
| Licence / maintenance / deprecation | Full registry packument for each of the 63 tuples: the version's licence, release date, last publish of the package, `deprecated`, install-type scripts and repository. `gh api repos/<slug>` for `archived` on all 55 upstream repos. Installed `svg-tags/package.json` and its `LICENSE` |
| Signatures / provenance | `npm audit signatures --@platform:registry=https://registry.npmjs.org/` (the safe override form from PR1-SEC-12) and `npm view <pkg> repository.url maintainers dist.attestations` for the forks |
| Advisories | `npm audit --json` on head, on base (in a scratch copy of the base manifest and lockfile) and with `--omit=dev`. GHSA pages for preconditions and fixed versions |
| Lint bypasses | `ESLint#lintText` with the PR's `eslint.config.mjs` (the same hermetic overrides as `tools/lint/lint-fixtures.mjs`) on 23 in-memory probes. `ESLint#isPathIgnored` / `calculateConfigForFile` on a path matrix. Script and output are in the review scratch directory |
| Child-process / fixtures | Read `tools/lint/lint-fixtures.mjs`, `tools/test-support/process.ts` (`spawnSync(process.execPath, …)`, no shell), `tools/lint/commitlint.test.ts`, the Jest `IGNORED_PATHS` and the `tools/tsconfig.json` exclude. Searched the fixtures for credentials and endpoints |
| Secrets | Regex sweep of the 1,800 added lines (excluding the lockfile): cloud keys, PEM, GitHub/Slack/Stripe tokens, JWTs, `password/secret/token = "…"`, 40+ char base64. 5 hits, all path literals (false positives). gitleaks was not run because Docker is excluded on this host; the TASK-007 lane-A gitleaks gate covers it |

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR2-SEC-01 | Security lint rules can be switched off inline with no justification, policy or count | **MEDIUM** | CWE-693 | A04 Insecure Design | `eslint.config.mjs:253`; `tools/eslint-rules/any-justification.mjs:47`; no suppression-count script | TASK-007 (+ stylelint options in TASK-002 fix cycle or TASK-004) | Open (follow-up) |
| PR2-SEC-02 | `bcrypt` confinement is bypassable (dynamic import, `createRequire`, `.cjs` `require`, sibling packages, hasher re-export, option clobbering) | LOW | CWE-693 (→ CWE-916 / CWE-208) | A04 / A02 | `eslint.config.mjs:263-274, 412` | TASK-049 (ESLint) + TASK-007 (Semgrep backstop) | Open (follow-up) |
| PR2-SEC-03 | Lint coverage holes: `.jsx` unlinted, JS files get no `platform/*` rules, `build`/`coverage`/`dist` ignored at any depth, Stylelint lints nothing | LOW | CWE-693 | A05 Security Misconfiguration | `eslint.config.mjs:37-41, 239-251, 257`; `.stylelintignore:2-5`; `package.json` `lint` | TASK-004 | Open (follow-up) |
| PR2-SEC-04 | `outbound-http-via-client` and `no-innerhtml` are deny-lists with known gaps | LOW | CWE-918 / CWE-79 | A10 SSRF / A03 Injection | `tools/eslint-rules/outbound-http-via-client.mjs:90-185`; `tools/eslint-rules/no-innerhtml.mjs:8-70` | TASK-113, TASK-112, TASK-007 (Semgrep) | Open (follow-up) |
| PR2-SEC-05 | ADR-0005 root-`PrismaClient` confinement and the T-83 "no external calls in `withTenantTx`" lint are not implemented and have no owning task | LOW | CWE-284 | A01 Broken Access Control | `eslint.config.mjs:113-119, 159-168` | TASK-016 | Open (follow-up) |
| PR2-SEC-06 | 36 dev-only audit findings (35 moderate, 1 low) from 3 root advisories; not reachable | INFO | CWE-405 / CWE-400 / CWE-1321 | A06 Vulnerable Components | `package-lock.json` (dev closure) | TASK-007 (watchlist) | Accepted, watch |
| PR2-SEC-07 | Licence/maintenance data for the TASK-007 gates: legacy `licenses` array (`svg-tags`), MIT-0/CC0 equivalents, 30 stale dev transitives | INFO | n/a | A06 | `package-lock.json` | TASK-007 | Report |
| PR2-SEC-08 | No CODEOWNERS on the lint-control files; the head config grades itself | INFO | CWE-693 | A04 | repository root | TASK-007 | Open (follow-up) |

### PR2-SEC-01: security lint rules can be switched off inline (MEDIUM)

**What.** The only inline-directive policy is `platform/any-justification`, which applies to `@typescript-eslint/no-explicit-any` and to blanket disables. Even for blanket disables it accepts **any** `-- text` as justification. `linterOptions.noInlineConfig` is unset, so ESLint honours both of these:
- `eslint-disable*` directives for any rule;
- inline rule-configuration comments such as `/* eslint no-restricted-imports: "off" */`.

Nothing counts suppressions. NFR-MAINT-002 requires "a script that counts suppression comments … Pass: all counts are zero" (except with a linked task ID), and `nfr-strategy.md` MAINT-002 lists that script, but no task in `docs/04-plan/tasks/` owns it.

**Evidence** (real config, `lintText`; `SVC` = `apps/api/src/modules/orders/service`):

| Probe | Result |
|---|---|
| P7 `// eslint-disable-next-line no-restricted-imports` + `import bcrypt from 'bcrypt'` | clean |
| P8 `/* eslint no-restricted-imports: "off" */` + bcrypt import | clean |
| P12 `// eslint-disable-next-line platform/no-innerhtml` + `el.innerHTML = s` (apps/web) | clean |
| P13 `/* eslint-disable boundaries/dependencies */` + `@prisma/client` in a service | clean |
| P14 `/* eslint-disable -- legacy */` (blanket, with any reason) + bcrypt import | clean; passes `any-justification` |
| P17 `// eslint-disable-next-line platform/outbound-http-via-client` + `fetch(u)` | clean |
| P18 an unused disable directive | error (`reportUnusedDisableDirectives: 'error'` works) |

**Exploitability and impact.** Several ADRs and the threat model cite these lint rules as mitigations:
- ADR-0016 §13: "Lint forbids `fetch`/`axios`/`http` elsewhere";
- ADR-0005: Prisma confinement;
- REQ-SEC-016: no-innerhtml;
- REQ-AUDIT-001: audit writer;
- D-ARCH-042: bcrypt.

In this project the code is written by developer agents under fix-cycle pressure. A one-line disable is the shortest route to a green `npm run lint`, and nothing structural stops it. Review would catch it only if the reviewer looks for it.

The resulting weakness is SSRF, XSS, audit bypass or tenant-layer bypass in code that ships. That impact is bounded by the other layers: the dispatcher, CSP, RLS fail-closed and the planned Semgrep rules. Impact M × likelihood M = **MEDIUM**.

**Remediation (code level).** The policy must live where an inline comment cannot turn it off, so it should not be only an ESLint rule (a rule can itself be disabled inline):
1. **Add `tools/lint/check-suppressions.mjs` as the third step of `npm run lint`**, after Stylelint. It is plain Node, has no dependency, and reads `git ls-files` for `*.{ts,tsx,mts,cts,js,mjs,cjs,jsx,css}` outside `tests/fixtures/**`. It enforces these rules:
   - (a) Fail on any inline rule-configuration comment: `/* eslint <rule>: … */`, `/* eslint-env */`, `/* global */` in TS.
   - (b) Fail on any blanket `eslint-disable` or `stylelint-disable` with no rule list.
   - (c) Fail on any disable, of any kind, that names a **protected** rule:
     - `no-restricted-imports`, `no-restricted-syntax`;
     - `boundaries/*`;
     - `platform/no-innerhtml`, `platform/outbound-http-via-client`, `platform/audit-writer-allowlist` (and the PR2-SEC-02/05 rules once they exist);
     - `import-x/no-relative-packages`, `import-x/no-extraneous-dependencies`;
     - `@typescript-eslint/ban-ts-comment`;
     - `csstools/use-logical`, `platform/hover-in-media`.
     Exceptions for these rules are made only by a file-scoped override in `eslint.config.mjs`, which is reviewed and code-owned (PR2-SEC-08).
   - (d) Every remaining `eslint-disable*`, `stylelint-disable*`, `@ts-expect-error`, `istanbul ignore` / `c8 ignore` and `nosemgrep` must carry `-- … TASK-\d{3}` (NFR-MAINT-002 says a *linked task ID*; `any-justification` accepts any text).
   - (e) Print the counts per kind. These counts are the NFR-MAINT-002 evidence.
2. **Tighten `platform/any-justification`** to require `TASK-\d{3}` in the description, so it matches NFR-MAINT-002.
3. **Set the Stylelint report options** in `stylelint.config.mjs`: `reportNeedlessDisables: true`, `reportInvalidScopeDisables: true`, `reportDescriptionlessDisables: true`.
4. **Route:** items 1, 2 and 4 to TASK-007, because it owns lane A and the US-048 static-safeguard tooling and depends on TASK-002. Item 3 is a one-liner for the TASK-002 fix cycle if one opens, otherwise TASK-004. **Due before the first Wave-1 feature task merges.**

**Verification test.**
- `tools/lint/check-suppressions.test.ts` runs the script against fixtures:
  - `bad-inline-config.ts` (`/* eslint no-restricted-imports: "off" */`);
  - `bad-blanket-with-reason.ts`;
  - `bad-protected-disable.ts` (`// eslint-disable-next-line platform/no-innerhtml -- TASK-123`);
  - `bad-no-task-id.ts` (`-- because`).
- Each must exit non-zero, naming the file and the reason. `ok-any-with-task.ts` (`-- TASK-123 remove after …`) must pass.
- A wiring test asserts that `npm run lint` has three `&&` steps, with the last one being the check.

### PR2-SEC-02: `bcrypt` confinement is bypassable (LOW)

**What.** The confinement uses the core `no-restricted-imports` rule with `regex: '^bcrypt(?:js)?(?:/.*)?$'` (`eslint.config.mjs:263-274`) and turns the whole rule off for `PASSWORD_HASHER_MODULE` (`:412`).

**Evidence.**

| Probe | Result |
|---|---|
| P1 static `import bcrypt from 'bcrypt'` (orders service) | `no-restricted-imports` ✔ |
| P4 `export { hash } from 'bcrypt'` / P5 `export * from 'bcryptjs'` / P6 `import type` | caught ✔ |
| P9 `.cts` `import bcrypt = require('bcrypt')` | caught ✔ |
| P22 apps/worker / P23 tools/db `.mjs` static import | caught ✔ (also `no-extraneous-dependencies`, because only `apps/api` declares `bcrypt`) |
| P19 relative path into `node_modules/bcrypt` | caught by `import-x/no-relative-packages` ✔ |
| **P2** `await import('bcrypt')` | **clean** |
| **P3** `createRequire(import.meta.url)('bcrypt')` | **clean** |
| **P10** `.cjs` `require('bcrypt')` under `apps/api/src` | **clean** |
| **P20/P21** `@node-rs/bcrypt`, `bcrypt-ts` | flagged only by `no-unresolved`, because neither is installed; once added as a dependency it would be clean |
| **P11** the hasher module itself `export { default as bcrypt } from 'bcrypt'` | **clean**: the module can re-export the primitive and defeat the port |

There is also a latent clobbering risk. Flat config **replaces** a rule's options when a later block sets it. Any future file-scoped `no-restricted-imports` entry, for example to ban `lodash` in `apps/web`, would silently drop the bcrypt pattern for those files. No test asserts the effective config.

**Exploitability and impact.** Exploiting this needs an author who bypasses the port, by accident or on purpose. Bypassing the port loses what D-ARCH-042 and ADR-0006 am. 16 put in it:
- the peppered SHA-512 pre-hash (72-byte truncation, CWE-916);
- the cost floor;
- the dummy-hash constant-time compare (enumeration timing, CWE-208).

It also breaks the "one-module exit" from `bcrypt` 6.0.0. Mitigations: `bcrypt` is declared only in `apps/api`, so other workspaces are already blocked; reviewers check TASK-049; the dynamic and `createRequire` forms are unusual. Impact M × likelihood L = **LOW**.

**Remediation.**
1. Replace the core-rule entry with a local rule, `platform/password-hasher-only`, built on `tools/eslint-rules/module-sources.mjs`. That visitor already handles `ImportExpression` and literal `require`. The new rule must:
   - add a `CallExpression` check for calls whose argument is a string literal matching the pattern, which covers `createRequire(...)(…)` and `module.require`;
   - match `/^(?:@[^/]+\/)?bcrypt(?:[-.\w]*)?(?:\/.*)?$/` (the bcrypt family including `bcryptjs`, `bcrypt-ts` and `@node-rs/bcrypt`);
   - in the hasher module, still report `ExportAllDeclaration` / `ExportNamedDeclaration` whose source matches, so the module may *use* bcrypt but never re-export it;
   - be switched off by name only. Delete the `{ files: [PASSWORD_HASHER_MODULE], rules: { 'no-restricted-imports': 'off' } }` block, so any future `no-restricted-imports` patterns also apply to the hasher.
2. Add `tools/lint/config-coverage.test.ts`. It uses `ESLint#calculateConfigForFile` over a path matrix: `apps/api/src/modules/x/service/a.ts`, `apps/api/src/platform/a.ts`, `apps/worker/src/jobs/a.ts`, `packages/{shared,pricing,carriers}/src/a.ts`, `prisma/seed/a.ts`, `tools/db/a.mjs`, `apps/web/app/routes/a.tsx`. For each path it asserts:
   - the file is not ignored;
   - `platform/password-hasher-only` is at `2`;
   - the security rules in scope for that path are at `2`.
   This test also guards PR2-SEC-03 and PR2-SEC-04.
3. **Semgrep backstop: mandated in TASK-007.** This answers reviewer-focus item 2: yes, make the Semgrep rule mandatory there. Add `.semgrep/password-hashing.yml`:
   - it matches `import $X from "$M"`, `import("$M")`, `require("$M")` and `$R("$M")` where `$M` matches `^(@[^/]+/)?bcrypt`;
   - `paths.exclude` is the hasher module, and a second rule forbids re-export from it;
   - it runs with `--disable-nosem`, so `nosemgrep` cannot suppress this pack;
   - it runs from the base ref (SEC-P3-31).
   Semgrep CLI LGPL-2.1 is on the D-ARCH-003 rev 2 tool register.
4. **Route:** items 1 and 2 go to TASK-049, which creates the hasher module, and must merge before or with it. They can go earlier if the TASK-002 fix cycle opens. Item 3 goes to TASK-007.

**Verification test.**
- Fixtures under `tests/fixtures/lint/rules/bcrypt-confinement/`:
  - `bad-dynamic.ts` (`import('bcrypt')`);
  - `bad-create-require.ts`;
  - `bad-sibling.ts` (`bcrypt-ts`);
  - a `bcrypt-password-hasher.ts` variant that re-exports.
- Each must fail with `platform/password-hasher-only`. The existing `ok` hasher fixture stays clean.
- The Semgrep rule has a `tests/fixtures/semgrep/` pair, run in lane A.

### PR2-SEC-03: lint coverage holes (LOW)

**What and evidence** (`isPathIgnored` / `calculateConfigForFile` on the real config):

| Path | Result |
|---|---|
| `apps/web/app/routes/p.jsx` | **no matching config**: `eslint .` skips it silently (no `.jsx` in any `files` pattern) |
| `apps/api/src/platform/p.js` | linted, but `platform/no-innerhtml`, `outbound-http-via-client` and `money-arith` are **absent**, because `APP_AND_PACKAGE_SOURCES`, `SERVER_SOURCES` and `REACT_*` are `.ts/.tsx` only. In P15 only an incidental `no-undef` on `fetch` fired |
| `packages/carriers/src/build/p.ts`, `apps/api/src/modules/shipments/build/p.ts`, `packages/shared/src/coverage/p.ts` | **ignored**: `globalIgnores` `**/build/**`, `**/coverage/**`, `**/dist/**` match at any depth. "Coverage" is a domain word in shipping (declared-value / insurance coverage) |
| `.stylelintignore` `dist/`, `build/`, `coverage/` | gitignore semantics, so they also match at any depth |
| `npm run lint` Stylelint step | `git ls-files '*.css'` outside the fixtures = **0**. `--allow-empty-input` makes "linted nothing" indistinguishable from "clean" |

**Exploitability and impact.**
- For `apps/api`, `apps/worker` and `packages/*`, strict `tsc` without `allowJs` makes a `.js` module unusable (TS7016 on import), so that hole is mostly closed.
- In `apps/web` / `apps/admin` (React Router framework mode), route modules are referenced **by string** from `app/routes.ts`, and Vite compiles `.jsx` natively. A `.jsx` route would be neither linted (XSS, i18n, a11y rules) nor type-checked.
- A folder named `coverage`, `build` or `dist` under `src/` loses every rule silently.

Impact M × likelihood L = **LOW**.

**Remediation (TASK-004, which creates `apps/*/app` and the first CSS; item 2 may land in the TASK-002 fix cycle):**
1. Add a block that fails non-TypeScript sources in app and package code:
   ```js
   {
     files: ['apps/*/{src,app}/**/*.{js,jsx,mjs,cjs}', 'packages/*/src/**/*.{js,jsx,mjs,cjs}'],
     rules: { 'no-restricted-syntax': ['error', { selector: 'Program', message: 'Application and package sources are TypeScript only (ADR-0001, CLAUDE.md §2).' }] },
   }
   ```
   Also add `jsx` to the baseline `files` globs at `:257` so the block applies. Alternatively, make `tools/repo/structure.ts` reject those extensions.
2. Anchor the ignores to output locations:
   - ESLint: `'{apps,packages,prisma,tests}/*/dist/**'`, `'{apps,packages}/*/build/**'`, `'coverage/**'`, `'{apps,packages}/*/coverage/**'`, `'dist/**'`, `'build/**'`.
   - `.stylelintignore`: `/dist/`, `/coverage/`, `/apps/*/build/`, `/apps/*/dist/`, `/packages/*/dist/`.
3. When TASK-004 adds the Tailwind entry CSS, remove `--allow-empty-input` from `npm run lint`, or add a test that `stylelint` reports at least one linted `apps/web/app/**/*.css` file.

**Verification test.** Extend `tools/lint/config-coverage.test.ts` (PR2-SEC-02 item 2) with these assertions:
- `apps/web/app/routes/a.jsx` resolves to a config that reports the `Program` error;
- `packages/shared/src/coverage/a.ts` is **not** ignored;
- `dist/x.js` **is** ignored.

### PR2-SEC-04: deny-list gaps in `outbound-http-via-client` and `no-innerhtml` (LOW)

Static deny-lists are never complete; these are the cheap gaps to close.

**`outbound-http-via-client`** (`tools/eslint-rules/outbound-http-via-client.mjs`):
- `HTTP_MODULES` lacks `http2`/`node:http2`; `net`/`tls` `connect` and `createConnection` are not covered.
- The global `WebSocket` (stable since Node 22) and `EventSource` constructors are not covered.
- Only *calls* to the identifier `fetch` are flagged, so these pass: `const f = fetch; f(u)`, `globalThis['fetch'](u)` and `Reflect.apply(fetch, …)`.
- `import('node:https')` (dynamic) is not tracked.

**`no-innerhtml`** (`tools/eslint-rules/no-innerhtml.mjs`):
- `srcdoc` / JSX `srcDoc`, `Range#createContextualFragment`, `DOMParser#parseFromString`, `Element#setHTMLUnsafe` / `Document.parseHTMLUnsafe` and `Object.assign(el, { innerHTML })` are not covered.
- `document.write` is caught only when the object is the bare identifier `document`; `window.document.write` passes.

**Exploitability and impact.** SSRF (CWE-918) and DOM XSS (CWE-79) remain mitigated by the `OutboundHttpClient` dispatcher and its SSRF tests (TASK-113), the CSP (NFR-SEC-006), React escaping, and the planned Semgrep packs. The lint rule is a guard against accidental direct use. **LOW.**

**Remediation.**
- TASK-113 extends `outbound-http-via-client`:
  - add `http2`, `net` and `tls` to the modules;
  - report `NewExpression` of the globals `WebSocket` and `EventSource`;
  - report any *read* of the global `fetch` identifier, via the existing `isGlobal` check on `Identifier[name=fetch]`, not only calls;
  - handle literal `ImportExpression` of the HTTP modules.
- TASK-112 (HTML-injection lint, REQ-SEC-016) extends `no-innerhtml` with the sinks above.
- TASK-007's `.semgrep` outbound-HTTP and innerHTML rules must cover the **same** sink list and run with `--disable-nosem`.

**Verification test.** Add one `bad-*` fixture per new sink: `bad-http2.ts`, `bad-websocket.ts`, `bad-fetch-alias.ts`, `bad-srcdoc.tsx`, `bad-contextual-fragment.ts`, `bad-window-document-write.ts`. The negative-fixture table must list each with its rule.

### PR2-SEC-05: Prisma-client construction and `withTenantTx` lint unowned (LOW)

**What.** ADR-0005 says: "the root `PrismaClient` is not exported outside `apps/api/src/platform/db` (lint rule)". Threat-model T-83 lists "No external calls inside `withTenantTx` (lint)", with verification "UNIT lint".

The PR's boundaries policy allows any `repository` file to import `@prisma/client` and the generated client (`DATABASE_CODE`, `eslint.config.mjs:119`). That is correct for model types, but it also lets a repository run `new PrismaClient({ adapter })`, which opens a connection outside `withTenantTx` and so outside the tenant context. No task in `docs/04-plan/tasks/` names either lint rule; TASK-016 creates `withTenantTx`.

**Exploitability and impact.** RLS is `FORCE`d and fails closed: with no tenant context there are no rows. So the direct effect is broken queries rather than leakage, as long as the runtime only holds the `platform_app` URL. The residual risks are:
- a repository built on a mis-scoped connection string;
- worker code that never sets context.

Impact M × likelihood L = **LOW**.

**Remediation (TASK-016).** Add a local rule, `platform/prisma-client-construction`, on `moduleSourceVisitor` plus `NewExpression`:
- a *value* import of `PrismaClient` (or of `PrismaPg` / `@prisma/adapter-pg`) is allowed only in `apps/api/src/platform/db/**`, `apps/worker/src/platform/db/**`, `prisma/**`, `tools/db/**` and tests;
- `new PrismaClient(…)` is reported everywhere else;
- type-only imports pass.

For T-83, either add a rule that reports `await` of an `OutboundHttpClient` or `fetch` call lexically inside a `withTenantTx(` callback, or have principal-architect record that T-83 is verified by review and Semgrep instead of lint, and amend the threat-model row.

**Verification test.**
- A `bad-new-client.repository.ts` fixture fails with the new rule; `ok-types-only.repository.ts` stays clean.
- A `bad-fetch-in-tx.service.ts` fixture fails, if the T-83 rule is implemented.

### PR2-SEC-06: dev-only audit findings (INFO, watchlist)

`npm audit` on the head reports 36 packages: 35 moderate and 1 low. The base had 35 (34 + 1). The only new entry is `eslint-plugin-jsx-a11y-x`, which depends on the existing `minimatch@10.2.6` (`^10.2.5`); it adds no new vulnerable node. `npm audit --omit=dev` = 0. All 36 come from 3 root advisories:

| Advisory | Package / range | Fixed | CVSS v4 | Precondition | Our exposure |
|---|---|---|---|---|---|
| GHSA-g3hv-75wg-m249 | `minimatch` ≥7.0.0 <11.0.1 (10.2.6, 9.0.9, 5.1.9 nodes) | 11.0.1 | 6.9, A:L | attacker supplies the **glob pattern** | patterns come only from committed ESLint/Jest/test-exclude config; changing them needs repo write, which already gives code execution through the config |
| GHSA-3g3m-2fjr-6pw4 | `glob` ≥9.0.0 ≤14.0.1 | 14.0.2 | 6.3, A:L | caller relies on `AbortSignal` to bound a walk over attacker-influenced patterns or trees | Jest/test-exclude/archiver walk our own repo; no `AbortSignal`-bounded walk over untrusted input |
| GHSA-gcqx-w48m-w2h4 | `deepmerge` 4.2.0–4.3.1 (jest-config) | none | 2.7, I:L | attacker supplies merge source objects | merges our own Jest config |

None of these is reachable from untrusted input, so the effective severity is **INFO**. Do not add `overrides`: they would be major jumps (`minimatch` 10→11) inside the very tools that act as security gates, and they would need `dependency-overrides.json` entries. **TASK-007 watchlist:**
- the dependency-auditor baseline records the three GHSAs;
- bump when ESLint, typescript-eslint, import-x, jsx-a11y-x, Jest or testcontainers depend on `minimatch` ≥ 11.0.1 or `glob` ≥ 14.0.2;
- lane A `--audit-level=high` gates any re-rating automatically;
- `npm audit --omit=dev` must stay 0.

### PR2-SEC-07: inputs for the TASK-007 licence and freshness gates (INFO)

1. **`svg-tags@1.0.0`** (via stylelint) declares its licence only in the legacy `"licenses": [{ "type": "MIT" }]` array. A `LICENSE` file (MIT) ships with it. The lockfile entry has **no `license` field**, so a lockfile-only `licence-check.mjs` would classify it "missing" and fail it under D-ARCH-003 rev 2 item 3. The checker must read legacy `licenses` arrays from the installed manifest or the registry. Do not register an exception.
2. **Permitted equivalents in the dev closure.**
   - MIT-0: `@csstools/css-syntax-patches-for-csstree@1.1.16`, `@csstools/selector-resolve-nested@4.0.2`, `@csstools/selector-specificity@6.0.1`.
   - CC0-1.0: `mdn-data@2.27.1`, `language-subtag-registry@0.3.23`, `stylelint-use-logical@2.1.3`.
   - MPL-2.0 (allowlist): `axe-core@4.14.0`.
   - All are dev-only and none enters an image.
3. **Stale transitives.** 30 new dev-only transitives belong to packages with no release in more than 18 months. None is deprecated (lockfile and registry), none is archived (all 55 upstream repos checked), and none has an advisory. Under D-ARCH-003 rev 4 item 3 they are **report-only** and go into the first freshness report:
   - `@nodelib/fs.{scandir,stat,walk}`, `@sindresorhus/merge-streams`, `aria-query`, `astral-regex`, `axobject-query`;
   - `braces`, `cssesc`, `damerau-levenshtein`, `fast-glob`, `fastest-levenshtein`, `fill-range`, `glob-parent@5.1.2`;
   - `global-modules`, `global-prefix@3.0.0`, `has-flag@5`, `is-number`, `is-path-inside`, `kind-of`, `mathml-tag-names`;
   - `merge2`, `micromatch`, `postcss-value-parser`, `queue-microtask`, `reusify`, `run-parallel`, `slash@5`;
   - `svg-tags`, `to-regex-range`.
4. **`prepare` scripts.** Five manifests declare `prepare` (`stylelint`, `meow`, `postcss-selector-parser`, `css-functions-list`, `fastest-levenshtein`). npm runs `prepare` only for git and directory dependencies, never for registry tarballs, and `ignore-scripts=true` blocks it anyway. The lockfile shows no `hasInstallScript`. **No `deps:rebuild` allow-list change is needed.**

### PR2-SEC-08: no CODEOWNERS on the lint controls (INFO)

`eslint.config.mjs`, `stylelint.config.mjs`, `.stylelintignore`, `tools/eslint-rules/**`, `tools/stylelint-rules/**`, `tools/lint/**`, `tests/fixtures/lint/**` and the `lint` script now *define* security controls. A PR's own head config is what grades that PR. A narrowing edit together with a matching fixture or test edit is visible in the diff, but nothing requires a security reviewer. There is no `CODEOWNERS` file. D-ARCH-003 rev 4 and platform.md §7 already assume one exists.

**Route: TASK-007.**
- Add `.github/CODEOWNERS` covering the paths above, plus `tools/ci/**`, `.semgrep/**`, `.npmrc` and `package-lock.json`.
- Add a lane-A step that runs the **base-ref** `tools/lint/negative-fixtures.test.ts` and its fixtures against the **head** configs (the SEC-P3-31 base-ref pattern), so that weakening a rule fails even when the PR also edits the tests.

## 4. Dependency table (new direct dependencies)

| Name | Version | Licence | Released | Last publish of package | Provenance / signature | Install scripts | Advisories | Verdict |
|---|---|---|---|---|---|---|---|---|
| `eslint-plugin-jsx-a11y-x` | 0.2.0 (exact) | MIT | 2026-05-10 | 2026-05-10 (6.1 mo) | SLSA v1 provenance; registry signature ✔. Repo `es-tooling/…` → now `eslint-community/eslint-plugin-jsx-a11y-x` (not archived); publisher 43081j | none | none of its own; depends on `minimatch ^10.2.5` (PR2-SEC-06) | **APPROVED** |
| `stylelint` | 17.16.0 (exact) | MIT | 2026-10-01 | 2026-11-03 (18.0.0) | SLSA v1 provenance; signature ✔; `stylelint/stylelint` active | `prepare` only (not run, PR2-SEC-07 item 4) | none | **APPROVED**. 17.x kept for the `stylelint-use-logical` peer range `<18`; still maintained |
| `stylelint-use-logical` | 2.1.3 (exact) | CC0-1.0 | 2026-02-04 | 2026-02-04 (9.2 mo) | signature ✔ (no attestation); `csstools/stylelint-use-logical` active (pushed 2026-10-30) | none | none | **APPROVED** (CC0-1.0 is on the allowlist) |
| `jsx-ast-utils-x` (transitive of the above) | 0.1.0 | MIT | 2025-05-21 | 17.7 mo | SLSA v1 provenance; `eslint-community/jsx-ast-utils-x`; publisher JounQin (also `eslint-plugin-import-x`, already in tree) | none | none | OK (transitive; under 18 mo) |

Transitive tree: 63 new name@version tuples, all dev-only.

| Licence | Count |
|---|---|
| MIT | 46 |
| ISC | 5 |
| CC0-1.0 | 3 |
| MIT-0 | 3 |
| Apache-2.0 | 2 |
| MPL-2.0 | 1 |
| BSD-2-Clause | 1 |
| BSD-3-Clause | 1 |
| legacy-array MIT (`svg-tags`) | 1 |
| **Total** | **63** |

Six more lockfile entries are nested copies of versions already in the tree, also all on the allowlist. Every licence passes D-ARCH-003 rev 2.

## 5. Triage of the PR's "Reviewer focus" items

| Item | Security disposition |
|---|---|
| 1. Layering vs ADR-0003 | Layering correctness belongs to code-reviewer. The security-relevant gap (Prisma construction / T-83) is PR2-SEC-05 |
| 2. Hasher override disables all `no-restricted-imports`; dynamic import not caught | Confirmed by probes P2, P3, P10 and P11. Fix is PR2-SEC-02; the Semgrep backstop is **mandated** in TASK-007 |
| 3. Fixture linting disables `no-unresolved` / `no-extraneous-dependencies` | **Acceptable.** The override sits only in `tools/lint/lint-fixtures.mjs` `overrideConfig`, not in `eslint.config.mjs`. The real config keeps both at error (probes P20–P23 fired them). The runner uses `spawnSync(process.execPath, …)` with no shell and fixed paths. Fixtures are linted, never executed, and are excluded from Jest (`/fixtures/` in `IGNORED_PATHS`), `tsc` (`tools/tsconfig.json` exclude), ESLint, Stylelint and Prettier. They contain no credentials (only `http://localhost`) |
| 4. ~11 s unit-lane cost | Not a security matter |
| 5. Later batch-0.2 PRs must pass these rules | Agreed. When TASK-003/004/005 are reconciled, PR2-SEC-01 makes a newly added `eslint-disable` the thing to look for in their diffs until the suppression check exists |

## 6. Controls verified in this PR

| Control | Evidence |
|---|---|
| `--max-warnings 0` on ESLint and Stylelint | `package.json` `lint`; asserted by `negative-fixtures.test.ts` "lint wiring" |
| Unused disable directives fail | `linterOptions.reportUnusedDisableDirectives: 'error'`; probe P18 |
| `bcrypt` static, re-export, type and import-equals forms | Probes P1, P4, P5, P6, P9, P22, P23; fixtures `bad-hash.ts`, `bad-hash-js.ts` |
| Install hardening unchanged | `.npmrc` and `overrides` unchanged; three exact pins (`save-exact`); no install scripts; no `deps:rebuild` change needed |
| Cooldown (`min-release-age=7`) | Youngest tuple 8.2 days old at the lock commit |
| Registry integrity | 1,591 `resolved` URLs, all `registry.npmjs.org`; sha512 throughout; `npm audit signatures` 1,490/1,490 |
| Production closure untouched | All 69 new or changed entries are `dev`; `npm audit --omit=dev` = 0 |

## 7. Follow-ups routed to named tasks

| Follow-up | Finding | Task (owner) | Due |
|---|---|---|---|
| `tools/lint/check-suppressions.mjs` as the third `lint` step; protected-rule list; `TASK-\d{3}` on every suppression; counts as NFR-MAINT-002 evidence; `--disable-nosem` | PR2-SEC-01 | TASK-007 (devops-engineer; senior-developer for the lint script) | Before the first Wave-1 feature merge |
| `any-justification` requires `TASK-\d{3}` | PR2-SEC-01 | TASK-007, or the TASK-002 fix cycle if one opens | Same |
| Stylelint `reportNeedlessDisables` / `reportInvalidScopeDisables` / `reportDescriptionlessDisables` | PR2-SEC-01 | TASK-002 fix cycle, else TASK-004 | With TASK-004 |
| `platform/password-hasher-only` local rule (dynamic import, `createRequire`, `require`, sibling packages, no re-export from the hasher); remove the blanket override; `config-coverage.test.ts` | PR2-SEC-02 | TASK-049 (backend-developer) | Before or with the hasher module |
| `.semgrep/password-hashing.yml` backstop, base ref, `--disable-nosem` | PR2-SEC-02 | TASK-007 | Batch 0.3 |
| TS-only block for `apps/*/{src,app}` and `packages/*/src`; anchored ignores (ESLint and `.stylelintignore`); remove `--allow-empty-input` or prove ≥1 CSS file linted | PR2-SEC-03 | TASK-004 (frontend-developer); anchoring may land in the TASK-002 fix cycle | With TASK-004 |
| Extend `outbound-http-via-client` (http2/net/tls, WebSocket/EventSource, `fetch` reads, dynamic `node:https`) | PR2-SEC-04 | TASK-113 | With TASK-113 |
| Extend `no-innerhtml` (srcdoc, createContextualFragment, DOMParser, setHTMLUnsafe, `Object.assign`, `window.document.write`) | PR2-SEC-04 | TASK-112 | With TASK-112 |
| Semgrep outbound-HTTP and innerHTML packs cover the same sink list | PR2-SEC-04 | TASK-007 | Batch 0.3 |
| `platform/prisma-client-construction` rule; T-83 rule, or a principal-architect amendment of the threat-model row | PR2-SEC-05 | TASK-016 (database-engineer); principal-architect for T-83 wording | With TASK-016 |
| Watchlist for GHSA-g3hv-75wg-m249, GHSA-3g3m-2fjr-6pw4, GHSA-gcqx-w48m-w2h4 in the dependency-auditor baseline | PR2-SEC-06 | TASK-007 | Baseline run after TASK-007 merges |
| `licence-check.mjs` reads legacy `licenses` arrays; MIT-0/CC0 equivalents; 30 stale transitives in the first freshness report | PR2-SEC-07 | TASK-007 | Batch 0.3 |
| `.github/CODEOWNERS` for the lint-control paths; lane-A base-ref fixture suite against the head configs | PR2-SEC-08 | TASK-007 | Batch 0.3 |

## 8. Evidence (commands, PR head `9bc9c04`)

| Command | Result |
|---|---|
| `git rev-list --count 4da693a..9bc9c04`; `git log 4da693a..main` | 4 commits; `main` drift is docs-only (`363b87f`, `26662fb`) |
| `node lockdiff.mjs base-lock.json head-lock.json` | +63 tuples, −0; integrity changes 0; flag moves 0; hosts `{registry.npmjs.org: 1591}`; non-dev additions 0; install scripts 0; deprecated 0; non-sha512 0 |
| `npm audit --json` (head) / (base, scratch copy) / `--omit=dev` | 36 (35 mod, 1 low) / 35 (34 mod, 1 low) / 0 |
| `npm audit signatures --@platform:registry=https://registry.npmjs.org/` | 1,490 verified signatures, 569 attestations, exit 0 |
| Registry packuments (63) + `gh api repos/<slug>` (55) | Cooldown OK; 0 deprecated; 0 archived; 30 stale transitives (report-only) |
| `node probe-lint.mjs <worktree>` (P1–P18 + coverage matrix), `probe-lint-2.mjs` (P19–P23) | As tabulated in PR2-SEC-01/02/03 |
| Regex secret sweep over the added lines | 0 true positives |

## Round 2 (head 6ba7649)

| Field | Value |
|---|---|
| Delta | `9bc9c04..6ba7649`: 3 commits (`f392385`, `a50cde1`, `6ba7649`), fast-forward on the round-1 head (no history rewrite). 46 files, +675 / −118. No change to `package.json`, workspace manifests, `.npmrc`, `.gitattributes` or `.github/**` |
| Inputs | Fix-cycle comment https://github.com/sukhchdit/shipcube/pull/2#issuecomment-6825077614. Code review `docs/05-quality/reviews/PR-0002-TASK-002-code-review.md` (item n5 was routed to security-analyst) |
| Reviewer / date | security-analyst, 2026-11-12. Read-only on the worktree. Same host limits as round 1: no install, build, Docker or full suites. ESLint and Stylelint ran in-process against the head configs (`lintText`, `isPathIgnored`, `calculateConfigForFile`, `stylelint.lint({ code })`). Every probe set has a positive control |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open. The delta closes the in-PR parts of PR2-SEC-02 and PR2-SEC-03, plus item 3 of PR2-SEC-01, and introduces no regression. New in round 2: 1 LOW (PR2-SEC-09, a pre-existing gap of the PR2-SEC-03 class that round 1 missed) and 3 INFO (PR2-SEC-10..12). **Merge is allowed.** |

### R2.1 Closure table

| ID | Round-1 item due in this PR | Round-2 evidence | Status |
|---|---|---|---|
| PR2-SEC-01 (MEDIUM) | Item 3 only: the Stylelint `reportNeedlessDisables`, `reportInvalidScopeDisables` and `reportDescriptionlessDisables` options | `stylelint.config.mjs:15-17`. Probes: a needless disable fails with `--report-needless-disables`; a disable with no `-- description` fails with `--report-descriptionless-disables`; a disable that names an unconfigured rule fails with `--report-invalid-scope-disables`; a scoped disable with a description stays clean. Fixtures `tests/fixtures/lint/css/bad-*-disable.css` | **Item 3 closed.** Items 1, 2 and 4 stay **open** under TASK-007. A blanket `/* stylelint-disable -- legacy */` still passes, because any description is accepted; item 1(b) of the check-suppressions step covers it. Outside the three CSS fixtures, the delta adds no `eslint-disable`, inline `/* eslint … */`, `@ts-*`, `nosemgrep` or coverage-ignore comment |
| PR2-SEC-02 (LOW) | ESLint items 1 and 2 were routed to TASK-049, or earlier if the TASK-002 fix cycle opened | R2.2 (1). Every form named in round 1 now fails (list below). The hasher's `export … from 'bcrypt'` fails in all 3 forms. The blanket `'off'` is gone: the hasher's effective `no-restricted-imports` is `[2, { patterns: [] }]`, re-declared from the shared `RESTRICTED_IMPORT_PATTERNS` | **In-PR scope closed.** The residual stays **open, LOW**: aliased forms, local-binding re-export from the hasher, policy ordering. Semgrep backstop in TASK-007 (mandatory); hardening in TASK-049 |
| PR2-SEC-03 (LOW) | Item 2 (anchored ignores) could land in the fix cycle; the rest went to TASK-004 | R2.2 (2). `.jsx` is linted. `.js`/`.cjs` under `apps/api/src` now get `no-innerhtml` and `outbound-http-via-client`; round-1 probe P15 fired only `no-undef`, and both rules now fire. Both the ESLint and the Stylelint ignore lists are anchored | **In-PR scope closed.** Still **open, LOW**, in TASK-004: the TS-only block for app and package sources (a `.jsx` route is now linted but still not type-checked), and either removing `--allow-empty-input` or asserting that at least one CSS file is linted. Related new finding: PR2-SEC-09 |
| PR2-SEC-04 | none in this PR | unchanged | Open: TASK-112 / TASK-113 / TASK-007 |
| PR2-SEC-05 | none in this PR | The two new exact-path Prisma allowances get repository-equivalent rights, including `new PrismaClient()` (R2.2 (4)) | Open, TASK-016. **Addendum** in R2.3 |
| PR2-SEC-06..08 | none in this PR | The package set is unchanged (R2.2 (3)), so PR2-SEC-06 and PR2-SEC-07 still hold as written | Unchanged |

### R2.2 Answers to the review focus

**(1) bcrypt confinement.** The new boundaries policy covers the bcrypt family `['bcrypt*', '@*/bcrypt*']`. It has no `from`, so it applies to every file in the boundaries block (`{apps,packages,prisma,tools,tests}/**`, all `LINTED` extensions). `additional-dependency-nodes` adds `createRequire(...)(...)` and `<x>.require(...)`. `no-restricted-imports` stays as the static net, with the family regex `^(?:@[^/]+/)?bcrypt[-.\w]*(?:/.*)?$`.

All probes ran in `apps/api/src/modules/orders/service/` unless the probe names another location:

| Probe | Form | Result |
|---|---|---|
| C1 (control) | `import bcrypt from 'bcrypt'` | `no-restricted-imports` + `boundaries/dependencies` |
| B2 | `await import('bcrypt')` | `boundaries/dependencies` |
| B3 | `createRequire(import.meta.url)('bcrypt')` | `boundaries/dependencies` |
| B6 | `const require = createRequire(import.meta.url); require('bcrypt')`, the idiomatic form | `boundaries/dependencies` (the default `require` node) |
| B4 / B8c | `.cjs` `require('bcrypt')`, `require('bcryptjs/umd')` | `boundaries/dependencies` |
| B5 / B12 | `module.require('bcrypt')`, `process.mainModule.require('bcrypt')` | `boundaries/dependencies` |
| B8a / B8b | `import('bcrypt-ts')`, `import('@node-rs/bcrypt')`, neither installed | `boundaries/dependencies` |
| B24 | `.cts` `import b = require('bcrypt')` | both rules |
| R4 | ``import(`bcrypt`)`` | `boundaries/dependencies` |
| B20 / B21 / B23 / B26 / B27 | a test file, `apps/worker`, `tools/db/*.mjs`, a `.jsx` route in `apps/web`, `packages/shared` | caught by boundaries (static forms also by `no-restricted-imports`) |
| R8 / R9 | root-level `scripts/*.mjs` and `infra/*.mjs` `import('bcrypt')`, outside the boundaries block | `import-x/no-extraneous-dependencies` only (no root workspace declares `bcrypt`) |
| H1 / H7 | the hasher uses bcrypt (static and dynamic) | clean (intended) |
| H2–H4 | the hasher: `export { compare } from`, `export * from`, `export * as b from 'bcrypt'` | `boundaries/dependencies` ("never re-exports it") |
| **R1** | `const req = createRequire(import.meta.url); req('bcrypt')` | **clean** |
| **R2** | `import { createRequire as cr } …; cr(import.meta.url)('bcrypt')` | **clean** |
| **R3** | `module.createRequire(import.meta.url)('bcrypt')` | **clean** |
| **R5** | `import(name)` with `const name = 'bcrypt'` | **clean** |
| **R6 / R7** | `Module._load('bcrypt')`, `require.call(null, 'bcrypt')` | **clean** (also `module['require']('bcrypt')`, by inspection of the selector) |
| **H5 / H6** | the hasher: `import * as b from 'bcrypt'; export { b }` and `import b from 'bcrypt'; export default b` | **clean** |

**Is leaving aliased `createRequire` to Semgrep (TASK-007) acceptable? Yes**, for four reasons:
- (a) The idiomatic form, `const require = createRequire(import.meta.url)`, is caught (B6).
- (b) The remaining forms need a deliberate rename or an indirection. ESLint can follow those only with data-flow analysis; Semgrep does it natively.
- (c) Only `apps/api` declares `bcrypt`. Elsewhere, `import-x/no-extraneous-dependencies` also fires on static imports, `import()` and `require` (R8, R9).
- (d) Impact M × likelihood L stays **LOW**.

This is accepted on conditions, which are listed under "Follow-ups by task".

The hasher no longer has a blanket `no-restricted-imports: off`. This is confirmed by its effective config `[2, { patterns: [] }]`, while the service path keeps the bcrypt regex.

Two structural points remain:
- **Policy order.** In boundaries the last matching policy decides, and the bcrypt block sits in the middle of `BOUNDARIES_POLICIES` (`eslint.config.mjs:208-214`). No later `allow` matches the family today: `:216-284` was read, and B21, B26 and B27 confirm it. However, a future broad allow added after the block, such as `{ allow: { to: { module: { origin: 'external' } } } }` for one package, would re-allow bcrypt there.
- **What the effective-config test checks.** It asserts the *severity* of `boundaries/dependencies`, not that the bcrypt policy is among its options on each path. A later file-scoped `boundaries/dependencies` block would therefore replace the policy list without anyone noticing. Round 1 found this clobbering class for `no-restricted-imports`; `RESTRICTED_IMPORT_PATTERNS` now fixes it for that rule, but not for boundaries.

**(2) `.jsx`, anchored ignores, Stylelint.** The `LINTED` set (`{js,jsx,mjs,cjs,ts,tsx,mts,cts}`) is used by the baseline, import-x, boundaries and local-rule blocks. `.jsx` gets JSX parsing, the React/a11y/i18n blocks, and the source-rule globs.

ESLint ignore matrix (`isPathIgnored`, then `calculateConfigForFile`):
- **Ignored:** `dist/x.js`, `build/x.js`, `coverage/lcov-report/x.js`, `apps/web/build/client/x.js`, `apps/api/dist/x.js`, `packages/shared/dist/x.js`, `tests/e2e/dist/x.js`, `prisma/dist/x.js`, `apps/web/.react-router/types/x.ts`.
- **Linted, with `no-restricted-imports`, `boundaries/dependencies`, `outbound-http-via-client` and `no-innerhtml` at error:** `packages/shared/src/coverage/a.ts`, `apps/api/src/modules/shipments/build/a.ts`, `packages/carriers/src/dist/a.ts`, `apps/api/src/dist/a.ts`.
- **Linted, with `no-restricted-imports`, `boundaries/dependencies`, `no-innerhtml` and `i18next/no-literal-string` at error** (outbound-http is off by design in browser code): `apps/web/app/routes/a.jsx`, `apps/web/app/coverage/a.tsx`, `packages/ui/src/build/a.tsx`.
- **Behaviour:** `console.log` in `packages/shared/src/coverage/s1.ts` fails with `no-console`. `.jsx` `innerHTML` in `apps/web` and a `.js` file in `apps/api/src/platform` (`innerHTML` + `fetch`) fail with `no-innerhtml` (both files) and `outbound-http-via-client` (the `.js` file).
- **Fails closed.** Output folders outside the anchor list (`apps/web/out/`, `tools/dist/`) are linted. An unexpected output location therefore produces lint noise; it is never silently skipped.

Stylelint ignore matrix:
- **Ignored:** `dist/`, `build/`, `coverage/`, `apps/web/build/client/assets/`, `apps/web/dist/`, `packages/ui/dist/`, `apps/web/.react-router/`, `docs/`, `tests/fixtures/lint/css/`.
- **Linted:** `apps/web/app/`, `apps/web/app/coverage/`, `packages/ui/src/build/`, `packages/ui/src/dist/`, `packages/ui/build/`.

The three `report*Disables` options work (R2.1).

**(3) Lockfile delta.** A deep JSON diff of `package-lock.json` at `9bc9c04` and at `6ba7649` finds exactly **one** differing path, with the positive control detected:
- the path is `packages[""].engines.node`, which changes from `>=24 <25` to `>=24.2 <25`;
- the new value equals the root `package.json`, which the delta does not touch (it already read `>=24.2 <25` at `9bc9c04`).

No package entry, version, integrity, `resolved` URL or flag changed. The package set is identical, so the round-1 cooldown, licence, signature and advisory results carry over unchanged. The developer's `npm audit --audit-level=high` shows the same 36 dev-only findings (35 moderate, 1 low). A new `tools/repo/toolchain.test.ts` case keeps the lockfile and manifest `engines` equal.

**(4) Weakenings introduced by the delta.**
- **`packages/ui/**` excluded from `outbound-http-via-client`: accepted.** This is consistent with ADR-0016 §13:
  - That control targets *server* egress; SSRF needs a server-side request.
  - Browser requests are governed by CSP `connect-src` (NFR-SEC-006) and the same-origin policy.
  - `apps/web` and `apps/admin` were never in scope.

  The exclusion is narrow. Every other existing or future package stays in scope (probe O2: `fetch` in `packages/shared` fails). The residual (server code importing the browser package) is **PR2-SEC-10 (INFO)**.
- **Prisma at exact paths: accepted.** `packages/audit/src/store/prisma-store.ts` (TASK-025) and `apps/api/src/platform/outbox/writer.ts` (TASK-043) are consistent with the ADRs:
  - ADR-0007: the writer "inserts inside the business transaction (`withTenantTx`)".
  - ADR-0003: its platform-plumbing list names the "outbox writer"; ADR-0004 covers the transactional outbox.
  - Both are narrow: siblings beside them still fail (probes P3, P5).

  ADR-0003's layering bullet literally says "Repositories: the only code importing the Prisma client". The two files are documented exceptions, which principal-architect may want to note in ADR-0003; the ADR wording is code-review's to route, and there is no security objection. The security residual: the `db-platform` category gives both files repository-equivalent rights. That includes `import pg from 'pg'` (P2, clean) and `new PrismaClient()` (P4, clean). See the **PR2-SEC-05 addendum** in R2.3.
- **Other changes, no security effect, or a tightening:**
  - `i18next/no-literal-string` is off for test files only; jsx-a11y stays on.
  - `TEST_FILES` now also covers `.test.{js,jsx}`. The folder part of that glob is PR2-SEC-09.
  - New routes/controller layering policies: a tightening.
  - The web/admin allow-list (`@platform/shared` and `@platform/ui` only): a tightening, which also keeps server packages such as `@platform/config` out of the public bundle.
  - `Intl.*` called without `new` is now reported: a tightening.
  - The commitlint test now runs `spawnSync(process.execPath, …)` (no shell) with the message on stdin, in an `mkdtemp` scratch directory that is removed afterwards.
  - The `lint-fixtures.mjs` repository probes are in-memory `lintText`, so nothing is written to the repository.
- **Non-security note for code-review (NIT, not a finding).** The additional dependency-node selectors use `> Literal`. A non-string literal argument, such as `x.require('a', 1)`, prints `[boundaries][warning] Dependency node value is not a string` and is skipped, with no crash. `> Literal:first-child` would silence the warning.

**(5) `.gitignore` folder names at any depth (developer-flagged).** This is **PR2-SEC-11: INFO, owner TASK-007** (rationale in R2.3).

### R2.3 New findings and addendum

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR2-SEC-09 | Source folders named `test`/`tests` under `src/` are classified as test code. They lose the layering policies, the Prisma confinement and the SSRF, XSS, audit-writer and console rules, yet they compile into `dist` | LOW | CWE-693 | A05 Security Misconfiguration | `eslint.config.mjs:49` (`TEST_FILES`), used at `:106`, `:129`, `:141`, `:354`, `:363`, `:453`, `:464` | TASK-004 | Open (follow-up) |
| PR2-SEC-10 | Server code can consume the browser package `packages/ui`, which is now outside `outbound-http-via-client` | INFO | CWE-918 (potential) | A10 SSRF | `eslint.config.mjs:52, 464`; no boundaries policy from `api`/`worker`/server packages to `ui` | TASK-113 | Open (follow-up) |
| PR2-SEC-11 | `.gitignore` folder patterns match at any depth and silently untrack source folders | INFO | n/a | A05 | `.gitignore` (`dist/`, `build/`, `out/`, `coverage/`, `logs/`, `uploads/`, `tmp/`, `temp/`, `test-results/`, `playwright-report/`, `.react-router/`) | TASK-007 | Open (follow-up) |
| PR2-SEC-12 | The audit-writer allow-list is broader than ADR-0007's list of direct callers (code-review n5) | INFO | CWE-693 | A09 Logging and Monitoring Failures | `eslint.config.mjs:67-75` | TASK-025 | Open (follow-up) |

#### PR2-SEC-09: test-folder classification at any depth (LOW)

**What.** `TEST_FILES` contains `'**/{test,tests,__tests__}/**'`. That glob is unchanged since round 1; the delta only added `.test.{js,jsx}`. Round 1 missed it.

Take a *production* file such as `apps/api/src/modules/orders/tests/helper.ts`:
- **Layering and Prisma.** It is in category `test`. Every layering policy uses `noneOf: ['test']`, so none applies. `DATABASE_CODE` includes `test`, so the file may import Prisma and `pg`.
- **Rules.** It is outside `no-console`, `money-arith`, `no-tofixed-tolocalestring`, `no-innerhtml`, `audit-writer-allowlist`, `outbound-http-via-client` and `no-non-null-assertion`.
- **Shipping.** Workspace `tsconfig.json` files have `include: ["src"]`, so the file compiles into `dist` and ships.

**Evidence.** One snippet was linted at several paths. It contains `new PrismaClient()`, `el.innerHTML = s`, `console.log` and `fetch(u)`.

| Path | Result |
|---|---|
| `apps/api/src/modules/orders/service/control.ts` (control) | `boundaries/dependencies`, `platform/no-innerhtml`, `no-console`, `platform/outbound-http-via-client` |
| `apps/api/src/modules/orders/tests/helper.ts` | **clean** |
| `apps/api/src/platform/test/helper.ts` | **clean** |
| `packages/carriers/src/tests/helper.ts` | **clean** |

The bcrypt confinement is unaffected, because its policy has no `from`.

**Exploitability and impact.** The gap needs production code in a folder named `test`/`tests` under `src`. That is plausible for carrier "test mode" stubs or a domain folder. The impact is the same set of bypasses as PR2-SEC-03. Impact M × likelihood L = **LOW**.

**Remediation (TASK-004, together with the PR2-SEC-03 remainder).** Anchor the folder forms to workspace roots, and keep the file-name and `__tests__` conventions:

```js
const TEST_FILES = [
  '**/*.test.{ts,tsx,js,jsx}',
  '**/__tests__/**',
  '{apps,packages}/*/{test,tests}/**',
  'prisma/{test,tests}/**',
  'tests/**',
];
```

**Verification test.**
- Add a fixture `rules/test-folder/apps/api/src/modules/orders/tests/bad-fetch.ts`. It must fail with `platform/outbound-http-via-client`.
- `packages/audit/test/a.ts` must stay in category `test`. TASK-025 puts its tests there.
- `config-coverage.test.ts` asserts that `apps/api/src/modules/x/tests/a.ts` has `outbound-http-via-client` and `no-innerhtml` at error.

#### PR2-SEC-10: server code may import the browser package (INFO)

**What.** `BROWSER_PACKAGES = ['packages/ui/**']` is excluded from `outbound-http-via-client`, which is correct for browser code. However, no boundaries policy stops `apps/api`, `apps/worker` or a server package from importing `@platform/ui`; the existing app policies constrain only web and admin. Node 24 has a global `fetch`. A server-side call into a `packages/ui` helper that does `fetch(url)` or uses Axios would therefore issue a request outside `OutboundHttpClient`.

**Evidence.**
- Probe O1: `fetch` in `packages/ui/src/session` is clean, by design.
- Probe O3: `apps/api` importing `@platform/ui` fails only with `import-x/no-extraneous-dependencies`; no boundaries finding.

**Exploitability and impact.** Exploitation needs all of the following:
- `@platform/ui` added to a server manifest, which is a visible change;
- a UI helper called with a URL derived from the request;
- the change passing review.

The TASK-113 dispatcher does not protect a request that bypasses it. This is a defence-in-depth gap, not an exploitable path at this head. **INFO.**

**Remediation (TASK-113, when it extends the outbound rule).** Add these policies:

```js
{
  from: IMPORTER_APP('{api,worker}'),
  disallow: [{ to: toPackage('@platform/ui') }, { to: { file: { categories: 'package', captured: { pkg: 'ui' } } } }],
  message: 'packages/ui is browser code outside platform/outbound-http-via-client; server code never imports it (ADR-0003, ADR-0016 §13).',
},
{
  from: IMPORTER_PACKAGE('!(ui)'),
  disallow: [{ to: toPackage('@platform/ui') }, { to: { file: { categories: 'package', captured: { pkg: 'ui' } } } }],
  message: 'packages/ui is browser code; other packages never import it (ADR-0003, ADR-0016 §13).',
},
```

**Verification test.** Add `REPO_PROBES` in `tools/lint/lint-fixtures.mjs` for `apps/api/src/platform/lint-probe-bad-ui.ts` and `packages/carriers/src/lint-probe-bad-ui.ts`, each importing `@platform/ui`. Both must fail with `boundaries/dependencies`.

#### PR2-SEC-11: `.gitignore` folder names match at any depth (INFO)

**What.** Root `.gitignore` folder patterns with no leading or inner `/` match at any depth: `dist/`, `build/`, `out/`, `coverage/`, `logs/`, `uploads/`, `tmp/`, `temp/`, `test-results/`, `playwright-report/`, `.react-router/`. A source folder with one of these names is silently untracked. Examples: `packages/shared/src/coverage/` (declared-value coverage) and `apps/api/src/modules/uploads/` (document uploads). `git ls-files -i -c --exclude-standard` lists exactly the three force-added `rules/output-ignores/**` fixtures.

**Assessment.** For the controls in scope, this fails closed:
- An untracked file never reaches a commit, a PR diff, CI, an image or `main`, so nothing unreviewed or unlinted can ship by this path.
- The effect is local/CI divergence or lost work: a module that works locally fails `tsc` or import resolution in CI. That is an S3 defect, not a vulnerability.
- Once a file is force-added, git tracks it and the diff shows it. Since this round, ESLint and Stylelint also lint it.

**INFO.** The developer proposed LOW; INFO is the security severity. The defect side is S3 for senior-developer.

**Remediation (TASK-007).** Anchor the output and scratch patterns to the same matrix as the ESLint and Stylelint ignores:
- Patterns: `/dist/`, `/build/`, `/coverage/`, `/apps/*/build/`, `/apps/*/dist/`, `/apps/*/coverage/`, `/packages/*/dist/`, `/packages/*/coverage/`, `/tests/*/dist/`, `/apps/*/.react-router/`, `/out/`, `/logs/`, `/uploads/`, `/tmp/`, `/temp/`, `/tests/*/test-results/`, `/tests/*/playwright-report/`.
- Write one line per pattern, because `.gitignore` has no brace expansion.
- Keep `node_modules/` and `*.tsbuildinfo` unanchored.

**Verification test.** `tools/repo/gitignore.test.ts` runs `git check-ignore --no-index -v` over the ESLint ignore matrix plus `packages/shared/src/coverage/a.ts` and `apps/api/src/modules/uploads/a.ts`. It expects the ignore decisions to equal the ESLint decisions.

#### PR2-SEC-12: audit-writer allow-list breadth (INFO; disposition of code-review n5)

**What.** `AUDIT_WRITER_ALLOW_LIST` turns `platform/audit-writer-allowlist` off for:
- all of `apps/api/src/platform/**`;
- all of `apps/worker/src/**`;
- `packages/audit/**`;
- the whole identity module.

ADR-0007 names a narrower set of direct callers: identity events, permission denials, config changes, system jobs and the state machine, plus the audit middleware and `withTenantTx` in the request pipeline.

**Assessment.** A direct writer call from an unlisted place cannot escalate privilege:
- the database still grants only INSERT;
- the chain still links the entry;
- the immutability triggers still apply.

What the allow-list protects is *uniformity*. Actor, action and outcome are derived by the middleware from route metadata (REQ-AUDIT-001/002). A direct call from, for example, `platform/idempotency` or `platform/egress` can write an entry with fields its caller chooses. That puts the consistency of the trail at risk, and with it the O4 completeness evidence. It is a defence-in-depth scope issue with no exploit path. **INFO.**

**Remediation (TASK-025, once the callers exist).** Narrow the allow-list to:
- `packages/audit/**`;
- `apps/api/src/platform/{audit,authz,db}/**` (middleware, permission denials, `withTenantTx`);
- `apps/worker/src/processors/**` (system jobs);
- `apps/api/src/modules/{identity,compliance,admin-settings,shipments}/service/**`.

Any later addition is a code-owned config edit (PR2-SEC-08).

**Verification test.**
- Fixtures `bad-platform-idempotency-writes-audit.ts` and `bad-identity-controller-writes-audit.ts` must fail.
- One `ok-*` fixture for each listed path must pass.

#### PR2-SEC-05 addendum: rights of the planned Prisma files

The `db-platform` category gives the two planned files the same rights as `apps/*/src/platform/db/**`:
- Probe P4: `new PrismaClient()` in `apps/api/src/platform/outbox/writer.ts` lints **clean**.
- Probe P2: `import pg from 'pg'` in `packages/audit/src/store/prisma-store.ts` lints **clean**.

ADR-0007 requires the audit insert inside the business transaction, and ADR-0004 / US-011 require the outbox row in the same transaction. A separate client or `pg` pool in either file would do two things:
- commit the entry or event independently of the business row, which violates REQ-AUDIT-004 and REQ-PLAT-016;
- run without the tenant context.

Additions to the PR2-SEC-05 remediation:
- **TASK-016.** `platform/prisma-client-construction` must allow construction and `@prisma/adapter-pg` / `pg` / `pg-pool` value imports only under the explicit `apps/*/src/platform/db/**` path, not for the whole `db-platform` category. An equivalent alternative is to move the two files to their own category, `prisma-tx-consumer`, which gets `PRISMA_TARGETS` only (types, `Prisma.sql`) and no `SQL_DRIVER_TARGETS`.
- **TASK-025 and TASK-043 reviews.** Check that `prisma-store.ts` and `writer.ts` take the `TenantDb` transaction handle as a parameter and never construct or import a client.

### R2.4 Follow-ups by task (round-2 additions; the round-1 §7 table still stands except for the items closed in R2.1)

| Task (owner) | Follow-up | Finding | Due |
|---|---|---|---|
| TASK-004 (frontend-developer) | TS-only block for `apps/*/{src,app}` and `packages/*/src`. Remove `--allow-empty-input` or assert that at least one CSS file is linted. Anchor `TEST_FILES` and add the config-coverage assertions | PR2-SEC-03 remainder, PR2-SEC-09 | In TASK-004's open fix cycle if PR #2 merges first; otherwise as a TASK-004 follow-up before the first Wave-1 feature merge |
| TASK-007 (devops-engineer; senior-developer for scripts) | Suppression check, including blanket `stylelint-disable` with any description, and `TASK-\d{3}` in `any-justification` | PR2-SEC-01 items 1, 2, 4 | Batch 0.3, before the first Wave-1 feature merge |
| TASK-007 | `.semgrep/password-hashing.yml` is **mandatory**. Run it from the base ref with `--disable-nosem` and one `tests/fixtures/semgrep/` pair per form. It must cover these residual forms:<br>- `$R = createRequire(...)` … `$R("$M")` (any binding name, including `import { createRequire as $C }`);<br>- `$X.createRequire(...)("$M")`;<br>- `$M._load("$P")`;<br>- `require.call(...)` / `require.apply(...)`;<br>- `$O["require"]("$P")`;<br>- a non-literal `import($E)` / `require($E)` in `apps/*/src`;<br>- in the hasher, `export { $X }` / `export default $X` / `module.exports = $X` where `$X` is bound to a bcrypt-family import (H5/H6) | PR2-SEC-02 residual | Batch 0.3 |
| TASK-007 | `.gitignore` anchoring plus `tools/repo/gitignore.test.ts` | PR2-SEC-11 | Batch 0.3 |
| TASK-049 (backend-developer) | Move the three bcrypt entries to the **end** of `BOUNDARIES_POLICIES`, so no later `allow` can override them. Make the coverage test behavioural: lint `import('bcrypt')` at every matrix path, and assert that the bcrypt policy is in the `boundaries/dependencies` options. A dedicated `platform/password-hasher-only` rule is needed only if it adds local-binding re-export detection (H5/H6); otherwise review checks that the hasher exports only the `PasswordHasher` port | PR2-SEC-02 residual | Before or with the hasher module |
| TASK-016 (database-engineer) | `prisma-client-construction` keyed on the explicit `apps/*/src/platform/db/**` path (or the `prisma-tx-consumer` category) | PR2-SEC-05 + addendum | With TASK-016 |
| TASK-025 (backend-developer) | Narrow the audit-writer allow-list. `prisma-store.ts` takes `TenantDb` | PR2-SEC-12, PR2-SEC-05 addendum | With TASK-025 |
| TASK-043 (backend-developer) | `writer.ts` takes `TenantDb`; no client of its own | PR2-SEC-05 addendum | With TASK-043 |
| TASK-113 (backend-developer) | Boundaries policies: server code never imports `@platform/ui` | PR2-SEC-10 | With TASK-113 |

### R2.5 Evidence (round 2)

| Command | Result |
|---|---|
| `git merge-base --is-ancestor 9bc9c04 6ba7649`; `git log 9bc9c04..6ba7649`; `git diff --name-status` on manifests, `.npmrc`, `.gitattributes`, `.github` | Fast-forward; 3 commits; no manifest, `.npmrc` or `.github` change |
| `node lock-deepdiff.mjs base-lock.json head-lock.json` | 1 differing JSON path (`packages[""].engines.node`); positive control detected |
| `node probe-r2.mjs <worktree>` | 45 `lintText` probes plus a 19-path ignore/effective-config matrix, as tabulated in R2.2 |
| `node probe-stylelint.mjs <worktree>` | 7 disable probes plus a 14-path ignore matrix, as in R2.1 and R2.2 (2) |
| `node probe-testdirs.mjs <worktree>` | PR2-SEC-09 table |
| Grep of the added lines for suppression directives | Only the 3 CSS fixture directives (seeded on purpose) |
| Regex secret and URL sweep over the added lines (excluding the lockfile) | 0 hits |
| `git ls-files -i -c --exclude-standard` | Exactly the 3 force-added `rules/output-ignores/**` fixtures |
| `npm audit` | Not re-run: the package set is identical (deep diff). The developer's `--audit-level=high` exit 0 with 36 (35 moderate, 1 low) matches round 1 |
