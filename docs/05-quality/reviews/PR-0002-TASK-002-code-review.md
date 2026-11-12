# Code review: PR #2, TASK-002 (lint, format and layering rules with negative fixtures, US-001)

| Field | Value |
|---|---|
| PR | https://github.com/sukhchdit/shipcube/pull/2 |
| Branch / head | `feat/TASK-002-lint-format-layering-rules-negative` @ `9bc9c04540cd901a5141e6493a68a8d13f1412a1` (4 commits over `main` 363b87f) |
| Reviewer | code-reviewer (independent), round 1, 2026-11-12 |
| Merge rule | D-ORCH-004 bootstrap (no hosted CI; PR-body local evidence plus reviews) |

## Verdict

**CHANGES_REQUESTED**: 1 MAJOR, 10 MINOR and 6 NIT findings.

**Summary:** This is a well-built lint foundation. It uses a typed flat config, one resolver shared by import-x and boundaries, eight small local rules with a shared module-source visitor, and a strict seeded-fixture harness that asserts the exact rule ID. The three Gherkin rows of AT-US-001-03 and AT-US-001-05 are met. However, the **routes layer of ADR-0003 / NFR-MAINT-001 is not constrained at all**: a `routes` file can import a repository or a service, and a controller can import routes, and lint stays green. That is the core rule this task exists to enforce (M1).

Several path scopes also collide with files that later tasks already plan (m2, m3, m4). These are cheap to fix now and expensive to discover during rebase.

## Scope reviewed

- Full diff `main...9bc9c04` (98 files): `eslint.config.mjs`, `stylelint.config.mjs`, `commitlint.config.mjs`, `.stylelintignore`, `tools/eslint-rules/*.mjs` (8 rules + `module-sources.mjs`), `tools/stylelint-rules/hover-in-media.mjs`, `tools/lint/{resolver.mjs, lint-fixtures.mjs, negative-fixtures.test.ts, commitlint.test.ts}`, `tests/fixtures/lint/**` (77 fixtures), and the `tools/repo/{structure,toolchain}.test.ts` follow-ups, `package.json`, `package-lock.json`.
- Context read: WAVE-00 §TASK-002, US-001 Gherkin, REQ-PLAT-002, NFR-MAINT-001/002, NFR-DATA-001, NFR-I18N-003/004, NFR-A11Y-006, ADR-0002 (§5, §6, SPK-01 am. 3/5, PR1-SEC am. 3), ADR-0003, ADR-0007, ADR-0009 §3, ADR-0015 §6, ADR-0016 §13 / am. 10, ADR-0026 §4, and the planned file lists of TASK-006/025/043/065/076. Plugin internals checked: `@boundaries/config` default dependency nodes (import, export, require and dynamic-import are all on by default), and file categories (multi-valued, captures merged).
- **Verification performed (read-only; heavy gates are left to the orchestrator per the brief):**
  - I lint-probed 22 probe files in 3 probe roots with the real `eslint.config.mjs`. The harness is the same as `lint-fixtures.mjs` and ran on an isolated `git archive` copy with a node_modules junction, removed afterwards; the worktree is unchanged (`git status` empty, node_modules count 740).
  - I ran `tools/lint/` with Jest in that copy. negative-fixtures passed **53/54**. The one failure, the `@platform/source` path assertion, is an artefact of the junction: the resolver realpaths into the worktree. commitlint failed 2/2 only because an archive has no `.git` (see n1).
  - I did **not** run `npm run lint`, typecheck, build or the full unit suite (memory-constrained host). The PR body evidence for those stands until the orchestrator re-runs them.

## Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| M1 | **MAJOR** | `eslint.config.mjs:131-157` (layering policies) | **The `routes` layer is unconstrained, and controllers may import routes.** Probed: `routes/x.ts` importing `../repository/orders.repository.js` gives **0 findings**. `controller/x.ts` importing `../routes/x.js` gives **0 findings**. routes → service also passes. NFR-MAINT-001 (in TASK-002's NFR list) and REQ-PLAT-002 list "routes → controller → service → repository" as the first rule. ADR-0003 has route handlers point at controllers (`handler: controller.cancel`). As written, an HTTP route file can query the database directly and bypass both the controller and the service. That is exactly the drift the layering lint exists to stop. | Add `{ from: inLayer('routes'), disallow: { to: toLayer('service', 'repository') }, message: 'routes map to controllers only …' }` and `{ from: inLayer('controller'), disallow: { to: toLayer('routes') } }`. Add `bad-*`/`ok-*` fixtures for routes → repository, routes → service and controller → routes, and table rows for them. The module `index.ts` (category `module-entry`, unconstrained) stays the composition root that wires repository → service → controller. If the architect instead wants `routes.ts` (discovered by TASK-006's `index.generated.ts`) to be the composition root, record that exception in ADR-0003, and still forbid routes → repository for anything other than factory wiring. |
| m1 | MINOR | `eslint.config.mjs:412`, `:263-273` | **bcrypt confinement (focus 1 and 2).** (a) `'no-restricted-imports': 'off'` for the hasher file turns off *every* present and future pattern of the generic rule for that file. A later task that adds a pattern, say for `node:child_process` or a forbidden SDK, would silently exempt the hasher. Flat config also *replaces*, not merges, rule options, so any later block that re-declares `no-restricted-imports` for a subset of files would silently drop the bcrypt pattern there. (b) Probed: `await import('bcrypt')` and `createRequire(import.meta.url)('bcrypt')` both lint clean. `boundaries/dependencies` already catches dynamic imports by default: the probe `await import('@prisma/client')` in a service was reported. | Move the confinement into `BOUNDARIES_POLICIES`. Add a file descriptor `{ pattern: PASSWORD_HASHER_MODULE, category: 'password-hasher' }`, then `{ disallow: { to: toPackage('bcrypt', 'bcryptjs') }, message }` plus `{ from: { file: { categories: 'password-hasher' } }, allow: … }`. This covers import, export-from, `require` and `import()`, and has no blanket "off". To keep the ADR-0002 PR1-SEC am. 3 wording (`no-restricted-imports`), keep both, and change the override to re-declare the rule with the shared pattern list minus the bcrypt entry rather than `'off'`. Add a `bad-dynamic-hash.ts` fixture. `createRequire` aliasing stays for Semgrep (TASK-007), which security-analyst confirms. |
| m2 | MINOR | `eslint.config.mjs:39` (`SERVER_SOURCES`) | `'packages/*/src/**/*.ts'` includes **`packages/ui`**, a browser package, in "server code" for `platform/outbound-http-via-client`. Probed: `packages/ui/src/session/client.ts` with `import axios` is reported. TASK-065 plans exactly that file set (`packages/ui/src/session/**`, an Axios interceptor). ADR-0026 §4 puts "a thin typed client over Axios" beside `packages/shared/api`. | Scope the rule to server packages: `packages/{audit,authz,carriers,config,pricing}/src/**/*.ts`. Decide for `packages/shared` now, which is the reviewer's recommendation. Either exempt `packages/shared/src/api/**` and add a boundaries policy forbidding `apps/{api,worker}` from importing it, or have the architect place the Axios client in `packages/ui`. Without this, TASK-065 must edit the `lint`-locked config. |
| m3 | MINOR | `eslint.config.mjs:119` (`DATABASE_CODE`) | Planned Prisma users are outside the allow-set, and the probe flagged both. TASK-025 plans `packages/audit/src/store/prisma-store.ts`, and ADR-0007 puts the audit store in `packages/audit`. TASK-043 plans `apps/api/src/platform/outbox/writer.ts`, and its relay runs `SKIP LOCKED` SQL. Even a type-only `Prisma.TransactionClient` import is rejected. | Decide now and encode it. Add `packages/audit/src/store/**` (a repository by function) as a database category, with an `ok-*` fixture. For the outbox writer, either add `apps/*/src/platform/outbox/**` or record in ADR-0003 that non-repository platform code takes the transaction type from `platform/db` re-exports. Otherwise route the decision explicitly to TASK-025/TASK-043 in STATUS.md. |
| m4 | MINOR | `eslint.config.mjs:419-436` (React TSX block) | `i18next/no-literal-string` (and jsx-a11y-x) also applies to `*.test.tsx`. Probed: `apps/web/app/root.test.tsx` with `<p>english home</p>` is reported. PR #4 already contains such tests (`apps/web/app/routes/root-redirect.test.tsx`, `packages/ui/src/skip-link.test.tsx` "Skip to content"), so it will go red once this merges. Every other source-only block here uses `ignores: TEST_FILES`. | Add `ignores: TEST_FILES` to the i18next block. jsx-a11y on tests may stay. |
| m5 | MINOR | `package-lock.json:57` | The lockfile root still says `"engines": { "node": ">=24 <25" }`, while `package.json` now says `>=24.2 <25`: commit 9bc9c04 edited only the manifest. This is manifest/lock drift. The next `npm install` rewrites it as unrelated noise, and TASK-007's lockfile checks may trip on it. R2-n1 is therefore only partly closed. | Run `npm install --package-lock-only --ignore-scripts` with Node 24, and commit. Optionally assert in `tools/repo/toolchain.test.ts` that `package-lock.json` `packages[""].engines` equals the manifest's `engines`. |
| m6 | MINOR | `tools/lint/negative-fixtures.test.ts:245`, `tools/lint/lint-fixtures.mjs:324` | **Resolver coverage (focus 3).** The `@platform/source` test calls `resolver.mjs` directly, not through ESLint. The fixtures switch `import-x/no-unresolved` off, and the repository has **zero** real `@platform/*` imports today. So nothing proves that `import-x/resolver-next` actually applies the condition, or that `no-unresolved` fires at all. Relative `.js` → `.ts` resolution *is* proven indirectly, because the boundaries fixtures depend on `extensionAlias`. | Add one fixture root linted with `no-unresolved` **on**: `ok-workspace.ts` importing `@platform/shared` must be clean, and `bad-unresolved.ts` importing `./missing.js` must report `import-x/no-unresolved`. This stays hermetic: npm workspaces always create the `node_modules/@platform/*` links, so it does not depend on what happens to be hoisted. |
| m7 | MINOR | `tools/eslint-rules/any-justification.mjs:47-48` | NFR-MAINT-002 allows `any`, `@ts-ignore` and non-null assertions in domain code only "with a linked task ID in the comment". The rule accepts any non-empty reason (`-- x` passes) and covers only `no-explicit-any`. A suppression of `@typescript-eslint/no-non-null-assertion` in `DOMAIN_CODE` needs no reason at all. The AT-US-001-05 Gherkin itself is met. | Require `/\bTASK-\d{3,}\b/` in the description (the message already asks for it). Apply the same check to suppressions of `no-non-null-assertion`, and of `ban-ts-comment` if desired. Can be routed to TASK-015 (suppression-count script) if not fixed here. |
| m8 | MINOR | `tests/fixtures/lint/layering/*` (fixture roots), `negative-fixtures.test.ts:216` | Fixture roots have no `package.json`, so the cross-workspace fixtures (worker → api, web → api, package → app) test the *relative* import form, which `import-x/no-relative-packages` rejects in the real repo. Probed: the same `ok-sync.ts` with `apps/*/package.json` present gives `import-x/no-relative-packages`. The form the worker can actually use is a package specifier, and it is untested for the worker policy. `apps/api` has no `exports`, and `@platform/worker` does not depend on `@platform/api`. | Add `package.json` stubs to those fixture roots and switch the `ok-*`/`bad-*` imports to the package-specifier form. Route the "how does the worker import module services" decision (`exports` on `@platform/api` or a dedicated entry) to TASK-006, which owns the worker skeleton and module registry. |
| m9 | MINOR | `eslint.config.mjs:183-191` | ADR-0003 rules are not fully encoded. (a) "apps/web and apps/admin … import `@platform/shared` and `@platform/ui`": probed, `apps/web/app` importing `@platform/config` and `@platform/pricing` lints clean, which lets server config and secret-loading code into a browser bundle. (b) "`packages/carriers` may import the HTTP client and Redis token cache only through injected ports": Redis (`ioredis`/`iovalkey`) is not restricted. | (a) Add `disallow: { to: toPackage('@platform/config', '@platform/audit', '@platform/carriers', '@platform/pricing', '@platform/authz') }` for web and admin, plus a fixture. If the UI should use `authz` for permission-aware rendering, the architect lists it explicitly. (b) Route to the carriers adapter task, or add `toPackage('ioredis', 'iovalkey', 'bullmq')` for `IMPORTER_PACKAGE('carriers')` now. |
| m10 | MINOR | `tools/eslint-rules/money-arith.mjs:10` | ADR-0009 §3 and NFR-DATA-001 specify "lint forbids `number` arithmetic on the branded `Minor` type". The rule matches by name (`amount`, `*Amount`, `*_minor` …), so `total + tax` on `Minor` values escapes. This is acceptable today because the `Minor` type does not exist yet. | Track it to **TASK-076** (pure pricing engine and `packages/shared/src/money/**`). When `Minor` lands, add a type-aware branch (`parserServices` → checker: operand type carries the `Minor` brand), keep the name heuristic as a fallback, and add a typed fixture. |
| n1 | NIT | `tools/lint/commitlint.test.ts:31`, `:22` | `expect(stdout + stderr).toBe('')` brings back the brittleness that PR #1 n2 just removed from `structure.test.ts`. `--edit <file>` also makes commitlint look for a git root (observed: `TypeError: Could not find git root` in a `git archive` export), so the unit test fails outside a git checkout. | Pipe the message on stdin (`runNode([cli, '--config', cfg], { input })`, with no git needed), and assert `status === 0` and that stdout has no `✖`. |
| n2 | NIT | `tests/fixtures/lint/README.md:10` | The README says the tree is excluded from Prettier, but `.prettierignore` does not list it (the fixtures are formatted and checked). | Fix the sentence, or add the path to `.prettierignore` if formatting the fixtures is unwanted. |
| n3 | NIT | `tools/lint/negative-fixtures.test.ts` | Nothing enforces "one negative fixture per custom local rule" (task AC). A rule added to `tools/eslint-rules/index.mjs` without a case still passes. | Add a test that each key of `plugin.rules` appears as `platform/<key>` in `ESLINT_VIOLATIONS`. |
| n4 | NIT | `package.json:20` vs ADR-0002 §6 | ADR-0002 §6 says `stylelint "apps/**/*.css" "packages/ui/**/*.css"`; the PR uses `"**/*.css" --max-warnings 0 --allow-empty-input` with `.stylelintignore`. That is a sensible superset, but it is text drift. | The principal-architect records the actual script in ADR-0002 §6 (amendment note). |
| n5 | NIT | `eslint.config.mjs:53-55` | The audit-writer allow-list turns the rule off for all of `apps/api/src/platform/**` and all of `apps/worker/src/**`. ADR-0007 lists narrower callers (middleware, permission denials, `withTenantTx`, system jobs). | Narrow it to `apps/api/src/platform/{audit,authz,db}/**` and the worker processors. Security-analyst judges the risk. |
| n6 | NIT | `tools/eslint-rules/no-tofixed-tolocalestring.mjs:55-66` | `Intl.NumberFormat('en')` and `Intl.DateTimeFormat()` called **without** `new` are valid and are not caught (only `NewExpression` is checked). | Apply the same `Intl.<name>` check in `CallExpression`. Add the fixture `bad-intl-call.ts`. |

## Developer-flagged focus items: answers

1. **Hasher override is too broad:** yes in principle, harmless today because there is only one pattern. See m1 for the fix that removes the blanket `off`.
2. **Dynamic `import('bcrypt')`:** confirmed as not caught, and neither is `createRequire`. Boundaries already handles `import()` and `require`, so the backstop belongs in lint (m1). Semgrep in TASK-007 remains useful only for aliasing tricks.
3. **Fixture linting disables `no-unresolved` / `no-extraneous-dependencies`:** a reasonable call for hermeticity, but the end-to-end proof of the `@platform/source` wiring is missing (m6). `no-extraneous-dependencies` is exercised by the real `npm run lint` on real files. That is acceptable.
4. **~11 s fixture cost:** observed 7.1 s for the suite. Jest overlaps it with other suites, and lane A maps AT-US-001-03 to the `lint` lane anyway. **Acceptable; no finding.** If it grows, group roots so fewer `ESLint` instances are needed (the config is reloaded per instance).
5. **Boundaries faithfully encode ADR-0003:** mostly. Controller ↛ repository, service ↛ express/Prisma/pg, repository ↛ upper layers, module index-only access (including type-only imports, probed), no app cross-imports, packages ↛ apps, and pricing purity (external and core origins plus other packages) are all correct and fixture-backed. **Gaps:** the routes layer (M1), the web/admin package allow-list and carriers Redis (m9), and the worker import form (m8). Category semantics were verified: categories are multi-valued and captures merge, so the "last matching policy decides" ordering holds.
6. **TASK-001 follow-ups:** see below. All closed except R2-n1, which is only partly closed (m5).
7. **New dependencies:**
   - `eslint-plugin-jsx-a11y-x` 0.2.0: MIT, peer `eslint ^9 || ^10`, flat config works (fixture `jsx-a11y-x/alt-text` fires). It is a 0.x fork, so the exact pin is right. It matches D-ARCH-037 and ADR-0002 SPK-01 am. 5.
   - `stylelint` 17.16.0: MIT, the pin is consistent with ADR-0002 am. 5.
   - `stylelint-use-logical` 2.1.3: CC0-1.0, peer `stylelint >= 11 < 18`, satisfied.
   - All three are exact-pinned devDependencies, and maintenance looks fine for all three. Licence and age verification belongs to security-analyst.

## Follow-up closure check (PR-0001 items routed to TASK-002)

| Item | Status | Evidence |
|---|---|---|
| m4 (barrel exclusion unenforced) | **Closed** | `platform/barrel-reexport-only` on `packages/*/src/index.ts`, the same glob as the Jest exclusion, with a bad fixture and an ok fixture (re-exports, `export type … from`, `export *`, `export {}`). Open doc step: record the choice in SPK-01 §2.5 (orchestrator). |
| n1 (`tseslint.config` deprecated) | **Closed** | `defineConfig` / `globalIgnores` from `eslint/config`. |
| n2 (`stderr === ''` brittle) | **Closed** in `structure.test.ts` (status plus stdout) | The same pattern reappears in `commitlint.test.ts`; see n1 above. |
| n3 ("renamed" wording) | **Closed** | The fixture creates `packages/authz-old` (`structure.test.ts:67`). |
| n5 (`--disable-warning=ExperimentalWarning`) | **Accepted, no change** | As ratified in PR #1 round 2 / D-ARCH-036. |
| R2-n1 (`engines.node` floor) | **Partly closed** | The manifest and `toolchain.test.ts` say `>=24.2 <25`, but the lockfile root is stale (m5). |
| jose/uuid extraneous import (TASK-001 context) | **Closed** | A narrow `packageDir` override for `tools/repo/jest-esm.test.ts` only. |

## Good

- One resolver module serves both import-x (`resolver-next`) and boundaries (legacy v2 by path), with the `@platform/source` condition and NodeNext `extensionAlias`. Both consumers classify identically.
- Policies are written as prohibition plus narrow exception, with ADR-citing messages, and the fixtures assert the exact message fragment. Exactly one finding per `bad-*` fixture, a clean-sweep check for everything else, and a guard against unlisted `bad-*` files.
- `module-sources.mjs` gives the local rules uniform coverage of static, re-export, `import()` and `require`, and handles type-only imports correctly (audit writer type import passes).
- The local rules are small, documented, carry `meta.messages`, and are type-checked through `tools/tsconfig.json` `checkJs`.
- Forward-looking ignores were included, for example `\+types/` for React Router typegen and the `?url`/`?raw` Vite suffixes.
- `reportUnusedDisableDirectives: 'error'` and exact pins on the new 0.x and peer-constrained plugins.

## Security flags (for security-analyst; not reviewed in depth)

- m1: bcrypt confinement bypass through `import()` / `createRequire` (probed).
- `no-innerhtml` misses newer sinks: `Element.setHTMLUnsafe`, `Document.parseHTMLUnsafe`, `Range.createContextualFragment`, `DOMParser.parseFromString`, and `srcdoc` assignment.
- `outbound-http-via-client` misses `node:http2`, `node:net`/`node:tls` connects, `globalThis['fetch']` (computed), aliased `fetch`, `WebSocket`/`EventSource`, and `export … from 'axios'` re-exports. The denylist approach also cannot enforce ADR-0016 am. 10's "only these SDKs" exception register.
- n5: the audit-writer allow-list is broader than ADR-0007.
- m9(a): web/admin may import `@platform/config` (server secret-loading code) into a browser bundle.

## Notes for merge

- **Expected conflicts:** root `package.json` (devDependencies and `scripts` with PR #4 and PR #5), and `package-lock.json` (PRs #3, #4 and #5). This PR does **not** touch `jest.config.ts`, so it has no conflict there with PR #4. Regenerate the lock with `npm install --package-lock-only --ignore-scripts` after resolving the manifests (this also fixes m5).
- **After merge, batch-0.2 PRs must pass the new rules.** Known impacts:
  - PR #4: `*.test.tsx` literals hit `i18next/no-literal-string` (m4). The CSS (`app.css`, `theme.css`) looked clean for `use-logical` and `hover-in-media` on inspection, and the `.tsx` sources use `t()`.
  - PR #3: `packages/config/src/index.ts` must stay re-export-only, and the `parseFloat`/`no-console` bans apply to the config parser.
  - PR #5: Prisma users must live under `tools/db/**`, `prisma/**` or `apps/*/src/platform/db/**`.
- Recommended order: merge #2 first after the fix cycle, then the others rebase-by-merge (senior-developer reconciles, as the PR body states).
- Fix-cycle expectation: for each new policy (M1, m1 and m9 if taken), list the mutation or fixture that proves it fires, as PR #1 round 2 did.

## DoD checklist (TASK-002)

| DoD item | Status |
|---|---|
| Linked AC satisfied and demonstrated by tests | **Partial.** AT-US-001-03 (3 rows) and AT-US-001-05 pass; one negative fixture per local rule passes. NFR-MAINT-001's routes → controller rule is not enforced (M1). AT-US-001-01/02/04 are carried from TASK-001 and pass per the PR evidence. |
| Lint, format, type checks pass; no new warnings | Per PR evidence (not re-run here; orchestrator). |
| Unit tests for new logic; coverage not reduced | Yes: 54 fixture cases plus 2 commitlint cases. The tools are outside the coverage scope by design. |
| code-reviewer APPROVED | **No.** M1 is open. |
| security-analyst | Parallel review; see the security flags. |
| Public interfaces documented / ADR | Rule headers are documented. ADR-0002 §6 script drift (n4); the m3/m8 decisions may need ADR-0003 notes. |
| traceability.md / STATUS.md | Orchestrator: record the routed MINORs (m2→TASK-065 if not fixed, m3→TASK-025/043, m7→TASK-015, m8→TASK-006, m9(b)→carriers task, m10→TASK-076). |

## Round 2 (head 6ba7649)

| Field | Value |
|---|---|
| Head | `6ba76496b8cec8f03e76eebb2e2db761223d64c0`: 3 commits on 9bc9c04 (`f392385` fix(lint), `a50cde1` test(lint), `6ba7649` chore(deps)). Normal push, no rewrite. |
| Reviewer | code-reviewer (independent), round 2, 2026-11-12 |
| Inputs | Round-1 findings above; the fix-cycle comment (issuecomment-6825077614); delta `9bc9c04..6ba7649` (46 files, +675/-118); D-ORCH-006; D-TASK002-02 |

### Verdict

**APPROVED_WITH_NITS.** No BLOCKER or MAJOR finding is open. Every in-scope round-1 finding is closed and backed by a fixture or an effective-config assertion. The new items are one MINOR (the `.gitignore` depth issue, routed) and three NITs. None of them blocks the merge.

**Summary:**
- The routes layer is now constrained in both directions, and the module `index.ts` is the composition root, as D-ORCH-006 rules.
- bcrypt confinement now covers static imports, `import()` (including template literals), `require`, `module.require`, `createRequire(...)(...)` and re-exports from the hasher.
- The web/admin `@platform/*` allow-list, `.jsx` coverage and the anchored output ignores are proven by tests that I re-ran.

### Verification performed (this round)

| Check | Result |
|---|---|
| `npm run lint` (ESLint + Stylelint, `--max-warnings 0`) in the PR worktree at 6ba7649 | **exit 0** (42 s) |
| `jest --selectProjects unit --testPathPatterns tools/lint/`, run once | **2 suites, 94/94 passed** (negative-fixtures 92 + commitlint 2) in 21 s. The commitlint cases now pass outside a git root by design (stdin input, scratch cwd). |
| Lockfile/manifest engines, read directly | `packages[""].engines` = `{"node":">=24.2 <25","npm":">=11.10"}`, the same as the manifest. The lock delta is that one line. |
| Independent probes | The real `eslint.config.mjs` over a probe root in my scratch dir; no files written to the worktree. Results below. |
| Worktree after the runs | `git status --porcelain` empty; node_modules count 740 (unchanged) |

Not re-run, because the dispatch set a host-memory constraint: `format:check`, `typecheck`, the full `test:unit` (172), `build` and `npm audit`. For those I rely on the developer's gate table in the fix-cycle comment. The orchestrator re-runs them at merge (D-ORCH-004).

**Probe results.** In my probe root `@platform/*` does not resolve, so those imports are classified as external.

| Probe | Result |
|---|---|
| Single-file layer: `billing/routes.ts` imports `./service/billing.service.js` | **Reported** ("routes map HTTP paths to controllers only"). The `routes.ts` file form is covered too. |
| Hasher `bcrypt-password-hasher.ts` does `export * from 'bcryptjs'` | **Reported** ("never re-exports it"). `ExportAllDeclaration` counts as `nodeKind: export`. |
| ``import(`bcrypt`)`` (template literal) in a service | **Reported** (bcrypt message) |
| `const req = createRequire(import.meta.url); req('bcrypt')` (aliased) | Clean. **Known and accepted gap**, routed to the TASK-007 Semgrep backstop (D-TASK002-02 item 1). |
| `apps/web` does `await import('@platform/config')`, and `export * as c from '@platform/config/web'` (both unresolved, so external) | **Both reported.** The `toPackage('@platform/*')` arm covers the external-classification path; the in-repo `lintText` probes cover the resolved-file path. Together they give defence in depth. |
| `apps/web` does `export * as s from '@platform/shared'` | Clean |
| A routes file imports its own module `index.ts` (value), and that `index.ts` wires the routes | `import-x/no-cycle` reports it |
| `orders/routes/x.ts` imports `../../quotes/index.js` and uses `quotesService` | **Clean.** See R2-n7. |
| A controller imports another module's `routes.ts` | Reported by the module-internals policy |

### Closure of round-1 findings

| ID | Status | Evidence |
|---|---|---|
| **M1** routes layer | **Closed** | `eslint.config.mjs:156-166` adds routes ↛ service/repository and controller ↛ routes. The comment cites D-ORCH-006 (index.ts is the composition root). Fixtures in `layering/routes-layer/**`: `bad-routes-service`, `bad-routes-repository` and `bad-controller-routes` each fail with the exact message. The `index.ts` that wires repository → service → controller → routes and `ok-orders.routes.ts` (controller type plus schema) lint clean. My probe confirms the single-file `routes.ts` form too. |
| **m1** bcrypt confinement | **Closed** | A boundaries policy (`:208-214`) plus `boundaries/additional-dependency-nodes` (`:412-424`) cover `createRequire(...)(...)` and `x.require('…')`. The blanket `'off'` is gone: the hasher re-declares `no-restricted-imports` from `RESTRICTED_IMPORT_PATTERNS` minus bcrypt (`:473-479`). The effective-config test asserts both rules are `error` on a path matrix that includes `.cjs` and `.jsx`, and that the hasher's options contain no bcrypt pattern. Nine bad fixtures cover: static, subpath, `bcrypt-ts`, `@node-rs/bcrypt`, `import()`, `createRequire`, `.cjs require`, `module.require` and the hasher re-export. Only the aliased `createRequire` form remains; it is routed (accepted). |
| **m2** `SERVER_SOURCES` includes packages/ui | **Closed** | `BROWSER_PACKAGES = ['packages/ui/**']` is excluded from the outbound-http block. Effective config: `packages/ui/src/session/client.ts` is `off`, and `packages/shared/src/a.ts` is `error`. Fixtures: `ok-session-client.ts` (Axios) is clean; `bad-carrier-fetch.ts` is reported. |
| **m3** planned Prisma users | **Closed** | `PLANNED_PRISMA_FILES` (exact paths) are categorised as `db-platform`. `prisma-store.ts` and `writer.ts` are clean; `bad-other-store.ts` and `bad-relay.ts` beside them are still reported. |
| **m4** i18next on tests | **Closed** | The i18next block is split out with `ignores: TEST_FILES`; jsx-a11y still applies to tests. `ok-heading.test.tsx` is clean. Effective config for `a.test.tsx`: i18next `off`, alt-text `error`. PR #4's `*.test.tsx` literals stop failing. |
| **m5** lockfile engines drift | **Closed** | The lock root equals the manifest (verified directly). A new `toolchain.test.ts` case, "lockfile root engines equal the root manifest engines", guards it from now on. Watchlist R2-n1 is now fully closed. |
| **m6** resolver end-to-end | **Closed** | The `resolution/` root is linted with `no-unresolved` on. `ok-workspace.ts` (`@platform/shared` plus NodeNext `./local.js`) is clean; `bad-unresolved.ts` fails with `import-x/no-unresolved`. The in-repo `lintText` "ok" probe also asserts zero findings with real resolution. |
| **m9(a)** web/admin package allow-list | **Closed** | Policy `:229-235` disallows `@platform/*` (external arm) and any `package` file whose `pkg` is not shared or ui (resolved arm), then allows shared and ui. In-repo probes: web → `@platform/config` and admin → `@platform/pricing` are reported; web → shared + ui is clean. My probes cover the dynamic `import()` and `export * as` forms. |
| **PR2-SEC-03** (in-scope part) | **Closed** | (1) `.jsx` is linted: `LINTED` is used in every baseline, import-x, boundaries and local-rule block, `.jsx` gets JSX parsing, and the React/i18n/a11y globs include it. Proven by fixture `bad-heading-jsx.jsx` plus an effective-config assertion. (2) The ESLint ignores are anchored (`:296-299`). An ignore-matrix test checks that root and workspace `dist`/`build`/`coverage` are ignored and `src/**/{coverage,build,dist}` is linted. I checked every tsconfig `outDir`: all are the workspace-root `dist`, so all are covered. (3) `.stylelintignore` is anchored, and `reportNeedlessDisables`, `reportInvalidScopeDisables` and `reportDescriptionlessDisables` are on, with three CSS fixtures and a Stylelint ignore matrix. PR #4's CSS has no `stylelint-disable` comments, so the new reporting does not break it. |
| **n1** commitlint brittleness | **Closed** | stdin input, cwd in a scratch dir outside any git checkout, and assertions on `status` and "no `✖`". `runNode` gains an optional `input`. |
| **n2** README / Prettier | **Closed** | The README now says Prettier formats and checks the tree, and documents `resolution/` and the double-control bcrypt case. |
| **n3** one fixture per local rule | **Closed** | The test "every local platform/* rule has at least one negative fixture" reads the rule keys from `tools/eslint-rules/index.mjs` through the report (`localRules`), so it cannot drift from the plugin. |
| **n6** `Intl.*` without `new` | **Closed** | A shared `forbiddenIntl(callee)` is used from both `CallExpression` and `NewExpression`. Fixture `bad-intl-call.ts`. |
| m7 → TASK-015, m8 → TASK-006, m9(b) → carriers adapter task, m10 → TASK-076, n5 → TASK-016 | **Accepted as routed** | Not re-raised. The orchestrator records them in STATUS.md / traceability. |
| n4 (ADR-0002 §6 script wording) | **Routed to principal-architect** | Text-only amendment; not a merge condition. |

### Rulings on the developer's decisions (D-TASK002-02)

1. **Dual bcrypt controls (double reporting on static imports): accepted.**
   - `no-restricted-imports` is what ADR-0002 PR1-SEC am. 3 names. The boundaries policy adds the non-static forms and the re-export ban.
   - A static violation produces two findings, so a deliberate bypass needs two `eslint-disable` directives. That friction points in the right direction.
   - The test asserts the exact rule set, so neither control can silently drop out.
   - Residual risk: the two "family" definitions can drift apart. One is a regex (`^(?:@[^/]+/)?bcrypt[-.\w]*(?:/.*)?$`), the other picomatch (`bcrypt*`, `@*/bcrypt*`). The four `BCRYPT_BOTH` fixtures pin them together for the forms that matter. No change required.
2. **`SERVER_SOURCES` = `packages/*` minus browser packages: accepted.**
   - This is better than the closed list I suggested in round 1, because a new package is server-scoped by default.
   - `packages/shared` correctly stays in scope: it is isomorphic and should make no network calls.
   - If the architect later places the ADR-0026 Axios client in `packages/shared/src/api`, that becomes a narrow `OUTBOUND_CLIENT` entry decided by TASK-065, not a scope change.
   - Minor coupling: `ui` is named both in `BROWSER_PACKAGES` and in the web/admin `'!(shared|ui)'` capture. Keep the two in step.
3. **Prisma at exact planned paths: accepted.** It is the narrowest option. TASK-025 and TASK-043 **must** create exactly `packages/audit/src/store/prisma-store.ts` and `apps/api/src/platform/outbox/writer.ts`. Any other file needs a config edit, which forces a review. The orchestrator should note this in those tasks' briefs.
4. **`lintText` probes for the `@platform/*` proofs: accepted.**
   - They lint in memory at real repository paths with real resolution, write nothing, and assert the exact message.
   - They are the only way to exercise the resolved-file arm, because fixture roots cannot classify `@platform/*` targets.
   - They depend on `packages/{config,pricing,shared,ui}/src/index.ts` existing, which has been true since TASK-001. A rename makes them fail loudly, not silently, because the ok probe asserts zero `no-unresolved` findings.

### New findings (round 2)

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `.gitignore:11-12,36` (pre-existing, TASK-001) | **`dist/`, `build/` and `coverage/` are git-ignored at any depth.** Verified with `git check-ignore`: `packages/shared/src/coverage/x.ts` is ignored by `.gitignore:36`. This PR deliberately lints such source folders, and declared-value *coverage* is a domain word, but git silently refuses to track them. A developer's new `…/coverage/*.ts` would be left out of the commit: lint and CI pass locally and fail elsewhere. The three `rules/output-ignores/**` fixtures exist only because they were force-added, and a sibling fixture added later would be lost silently. The developer flagged this. | Anchor the entries the way the lint ignores are anchored: `/dist/`, `/build/`, `/coverage/`, `/apps/*/{dist,build,coverage}/`, `/packages/*/{dist,build,coverage}/`, `/tests/*/{dist,build,coverage}/`, `/prisma/{dist,build}/`. Add a structure/toolchain test that `git check-ignore --no-index packages/x/src/coverage/a.ts` exits 1. **Routing accepted: TASK-007**, which owns repository hygiene checks. Pick one owner rather than "TASK-007 or TASK-004". **Not a merge condition.** |
| R2-n7 | NIT | `eslint.config.mjs:156-161` | A routes file may import **another** module's public `index.ts` and call its service. My probe `orders/routes/cross.routes.ts` → `../../quotes/index.js` → `quotesService` was clean. A routes file importing its own `index.ts` is already caught by `import-x/no-cycle`. This is a narrow bypass of "routes → controller only". | Add `toLayer('module-entry')` to the routes disallow, with a `bad-routes-other-module.ts` fixture. Routes receive everything through the composition root, so they have no legitimate reason to import a module entry. Can ride with TASK-006 (module registry). |
| R2-n8 | NIT | `.stylelintignore` vs `eslint.config.mjs:296-299` | The two ignore lists are not symmetric. ESLint ignores `{apps,packages,tests}/*/{dist,build,coverage}/**`; Stylelint lacks `/packages/*/build/`, `/tests/*/{dist,build,coverage}/` and `/packages/*/.react-router/`. Harmless today, because no workspace emits CSS there. | Mirror the ESLint list, and add one `STYLE_IGNORE_MATRIX` row (`tests/e2e/coverage/x.css`). |
| R2-n9 | NIT | `eslint.config.mjs:292-306` | Playwright output (`test-results/`, `playwright-report/`) is git-ignored but **not** lint-ignored, and ESLint flat config does not read `.gitignore`. After a local e2e run with traces, the HTML report's bundled viewer JS/CSS under `playwright-report/` can be linted and fail `npm run lint` locally. Not a regression (the round-1 ignores lacked it too); it becomes live when PR #4's harness lands. | When PR #4 rebases onto this PR, add `'**/playwright-report/**'` and `'**/test-results/**'` to `globalIgnores` and to `.stylelintignore`. These names are never source folders, so unanchored patterns are fine. Route to PR #4 / TASK-004. |

### Notes for merge

- **Merge condition:** the orchestrator re-runs `format:check`, `typecheck`, `test:unit` and `build` at 6ba7649 under D-ORCH-004; I re-ran only lint and the `tools/lint` suites. If those are green, PR #2 merges first in batch 0.2 (D-ORCH-006 item 5).
- **New rules the rebasing PRs (#5, #4, #3) will hit:**
  - **PR #4:**
    - The `*.test.tsx` literals issue is resolved by m4.
    - `.jsx` is now linted.
    - Stylelint now reports needless, descriptionless and invalid-scope disables (PR #4's CSS has none today).
    - Add the R2-n9 ignores.
  - **Web/admin imports (PR #3 and PR #4):** they may import only `@platform/shared` and `@platform/ui`.
    - I grepped the current heads (PR #3 d8ba197, PR #4 519bb89, PR #5 be468bc): **no** web/admin import of a server package exists today.
    - The rule becomes live once `apps/web` consumes PR #3's web config subset: an import of `@platform/config` from `apps/web` then fails.
    - PR #3's `zod` web subset must then be consumed via `@platform/shared` or move there, or the architect rules an explicit exception (for example a browser-safe `@platform/config/web` entry, allowed by a narrow policy).
    - **Flag to the senior-developer reconciling PR #3.**
  - **PR #5:** Prisma users must sit under a repository, `apps/*/src/platform/db/**`, `prisma/**`, `tools/db/**`, tests, or one of the two exact planned paths.
  - **PR #3:** `packages/config/src/index.ts` stays re-export-only, and the `parseFloat`/`no-console` bans apply.
- **Lockfile conflicts** are expected with #3, #4 and #5. Regenerate with `npm install --package-lock-only --ignore-scripts`; the new `toolchain.test.ts` engines-equality case catches any re-drift.
- **Orchestrator bookkeeping:**
  - R2-m1 → TASK-007
  - R2-n7 → TASK-006
  - R2-n8 → TASK-007 (or fix here)
  - R2-n9 → TASK-004
  - The exact-path Prisma contract goes in the TASK-025 and TASK-043 briefs.
  - n4 → principal-architect (ADR-0002 §6 wording).

### DoD checklist (TASK-002, round 2)

| DoD item | Status |
|---|---|
| Linked AC satisfied and demonstrated by tests | **Yes.** AT-US-001-03 (3 rows) and AT-US-001-05 pass. NFR-MAINT-001 routes → controller → service → repository is now fully encoded and fixture-backed. A test now enforces one negative fixture per local rule. |
| Lint, format, type checks pass; no new warnings | Lint exit 0 (re-run). Format and typecheck per the developer's evidence; the orchestrator re-runs them at merge. |
| Unit tests for new logic; coverage not reduced | Yes: 92 fixture/config cases, 2 commitlint cases, and the toolchain lock case. |
| code-reviewer APPROVED | **Yes: APPROVED_WITH_NITS** (no BLOCKER or MAJOR) |
| security-analyst | Separate R2 delta review. The bcrypt and `.jsx`/ignore items it raised (the in-scope parts of PR2-SEC-02/03) are closed per the table above. |
| Public interfaces documented / ADR | Rule and policy comments cite their ADRs and D-ORCH-006. n4 is ADR text for the architect. |
| traceability.md / STATUS.md | Orchestrator, per the bookkeeping note above. |
