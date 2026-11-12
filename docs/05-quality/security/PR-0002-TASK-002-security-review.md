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
