# PR-0004 / TASK-004: change-scoped security review

| Field | Value |
|---|---|
| PR | #4 `feat(web): web and admin app scaffolds (TASK-004)`, https://github.com/sukhchdit/shipcube/pull/4 |
| Branch / head | `feat/TASK-004-web-admin-app-scaffolds` @ `519bb89`. Base `main` @ `4da693a` (merge base). 5 commits (`b67eb36`..`519bb89`), 74 files, plus `package-lock.json` |
| Scope | P5 Wave 0, batch 0.2, under the D-ORCH-004 bootstrap merge rule. Covers: `apps/web` and `apps/admin` scaffolds (React Router 8.5.1 framework mode with `ssr:false`, Vite 8.3.6); custom `app/entry.server.tsx` without `isbot`; the `tools/repo/react-router-entry.test.ts` guard; `infra/nginx/{web,admin}.conf.template`; `.size-limit.json` with `size-limit` / `@size-limit/file` 14.3.0; the Jest `unit-dom` project; `packages/ui` skip link and `theme.css`. Also covers the Playwright + axe harness, which is drafted in PR comment 6823848131 and **not committed** (cooldown) |
| Security requirements in scope | PR1-SEC-03 / SPK-01 F-SEC-1, TASK-004 part (ADR-0026 am. 10, D-ARCH-039); SEC-P3-04 items 1–3 for the new dependencies; REQ-SEC-001 (static-site header subset); ADR-0026 am. 4/5 (`/` redirect, admin never indexed); ADR-0018 item 1 (`VITE_*` build-time config) |
| Reviewer / date | security-analyst, 2026-11-12. Read-only on the worktree. Commands ran under the CLAUDE.md §2 PATH prefix: Node 24.22.3, npm 11.19.1. Per the dispatch constraints there were no installs, builds, Docker runs or full suites. The `build/` output already present in the worktree was inspected read-only |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open for this change. There are 3 LOW and 6 INFO findings, each routed to a named task or to this PR. **PR1-SEC-03: the TASK-004 part is met.** The finding stays open only for its TASK-007 and TASK-014 parts. **This verdict covers `519bb89` only.** The harness commit changes the lockfile, so it needs a delta re-review before merge (§7) |

## 1. Summary

**The PR closes the TASK-004 part of PR1-SEC-03.**
- Both apps commit an `app/entry.server.tsx`. React Router's `resolveEntryFiles()` (`node_modules/@react-router/dev/dist/typegen-CqlAVM2O.js:442-479`) therefore takes the `userEntryServerFile` branch and never reaches the `package.json` rewrite or the ``execSync(`npm install`)``.
- The guard test has a positive check and negative fixtures: a missing entry, and `isbot` declared in each of `dependencies`, `devDependencies` and `peerDependencies`. It passes, and so does the static Nginx test (22/22 in the 3 security-relevant suites, run independently).
- The build left the tree clean: `git status --porcelain` is empty at the head.

**New dependencies (4 lockfile tuples).** `size-limit` 14.3.0, `@size-limit/file` 14.3.0, `lilconfig` 3.1.4 and `nanospinner` 1.2.2.
- All are MIT, dev-only and from `registry.npmjs.org` with `sha512` integrity.
- None has an install script, and all are older than 7 days at the lockfile commit.
- Registry signatures verify, and `npm audit --omit=dev` = 0.
- `nanospinner` is 23 months old. It is a transitive dev dependency, so under D-ARCH-003 rev 2 item 6 it is reported, not gated.

**The Nginx templates are sound for what they contain.**
- **No open redirect.** The `/` 302 always targets one of three constant paths (`/en/`, `/es/`, `/fr/`), as a relative `Location`. No directive reads `$host`, `$http_host` or `$request_uri`. The Accept-Language regex is linear, so there is no ReDoS risk.
- **No cache poisoning.** The 302 carries `Cache-Control: no-store` and `Vary: Cookie, Accept-Language`.
- **Hardening present:** `server_tokens off`, GET/HEAD only, dotfiles denied, and no directory listing (`autoindex` default off, and `try_files` never matches a directory).
- **Headers:** `nosniff`, `Referrer-Policy`, `X-Frame-Options: DENY` and COOP are set at server level with `always`. Admin also sends `X-Robots-Tag` and serves a disallow-all `robots.txt`.
- **Still to come:** CSP, Permissions-Policy and HSTS are deferred by design to TASK-022 and TASK-111.

**Client bundles.**
- No secrets or host paths.
- No source maps and no Vite manifest are emitted.
- One defence-in-depth gap: the whole-object `import.meta.env` read inlines every `VITE_*` variable present at build time (PR4-SEC-01).

**Playwright harness.** Nothing is installed yet. The lockfile has no `playwright` or `axe-core` entries, so the cooldown was not bypassed. The drafted install time is wrong, though: `playwright-core` 1.65.0 clears the cooldown at **20:17:41Z**, not 18:30Z (PR4-SEC-03).

## 2. Method

**Diff review.**
- I reviewed `git diff 4da693a..519bb89`, excluding the lockfile: 2,905 lines across all 74 files.
- Manual sink review of the app code found:
  - no `dangerouslySetInnerHTML`, `innerHTML` or `eval`;
  - no `new Function` or `postMessage`;
  - no storage APIs;
  - no `target="_blank"`;
  - no remote `@import` or `url()` in CSS.
- Redirect and URL builders reviewed: `root-redirect.tsx`, `locale-switcher.tsx` (`pathInLocale`), `error-view.tsx` and `page-meta.ts`.

**Upstream code read (installed `node_modules`).**
- `@react-router/dev` 8.5.1: `resolveEntryFiles`, `findEntry` and `entryExts`.
- `react-router` 8.5.1: the `Meta` merge loop in `dist/production/lib/dom/ssr/components.js:355-395`.
- Vite 8.3.6: `generatePattern` / `importMetaEnvVal` in `dist/node/chunks/node.js:17055-17085`.

**Nginx.**
- Read both templates statically.
- Checked the redirect and map logic against nginx `map` and `try_files` semantics, and checked the Accept-Language regex for catastrophic backtracking.
- The image itself does not exist yet (TASK-014), so no runtime check was possible.

**Build output (read-only, from the head's `npm run build` in this worktree).**
- `apps/{web,admin}/build/client` were checked for:
  - the inlined env object;
  - `*.map` files and `sourceMappingURL`;
  - `.vite/` manifests;
  - absolute host paths;
  - inline scripts, counted for the CSP work.

**Supply chain.**
- The base and head lockfiles were diffed structurally with `git show` and a Node script (`scratchpad/review/lockdelta.mjs`), comparing name@version tuples, integrity, `resolved`, flags and install scripts.
- `npm view` was used for licence, publish time, provenance and maintainers.
- `npm audit` was run full and `--omit=dev`.
- `npm audit signatures` was run in the override form `--@platform:registry=https://registry.npmjs.org/` (PR1-SEC-12).
- The harness packages, which are not installed, were checked with `npm view` only.

**Tests.** I ran these three suites independently: `tools/repo/react-router-entry.test.ts`, `nginx-templates.test.ts` and `size-limit.test.ts` (`--selectProjects unit --runInBand`).

**Secrets.**
- gitleaks was **not run**, because the dispatch did not allow Docker.
- Instead I ran a keyword and entropy grep over the added lines of the diff and over the built client output. There were no hits.
- gitleaks on this commit range is owed by TASK-007 lane A, once it exists.
- Semgrep is not installed on the host.

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR4-SEC-01 | Whole-object `import.meta.env` read inlines **every** `VITE_*` build variable into the public bundle; ADR-0018's `config/web` allow-list is not in place | LOW | CWE-538, CWE-200 | A05 | `apps/web/app/seo/public-origin.ts:21-24`; built `apps/web/build/client/assets/home-*.js` | senior-developer, **this PR** (recommended); otherwise TASK-005. principal-architect assigns the `config/web` owner | Open |
| PR4-SEC-02 | Nginx templates assume the image removes the stock `conf.d/default.conf`. If it doesn't, the stock server answers every `Host: localhost` request (web: every request) with no security headers, the version banner on, and no method or routing rules | LOW (latent) | CWE-693, CWE-1188 | A05 | `infra/nginx/web.conf.template:57-58`, `admin.conf.template:24-25` (`listen` without `default_server`, `server_name _`) | TASK-014 (image, binding); TASK-111 (header suite) | Open (latent; no image yet) |
| PR4-SEC-03 | Harness install timing: `playwright-core` 1.65.0 (an exact dependency of `playwright` 1.65.0) clears the 7-day cooldown at **2026-11-12T20:17:41Z**, not 18:30Z. Installing earlier fails, and overriding the failure would be a cooldown bypass | LOW | CWE-1357 | A08 | PR body and comment 6823848131 (install steps) | senior-developer (harness commit, binding) | Open |
| PR4-SEC-04 | PR1-SEC-03 guard scope: detection keys on `react-router.config.ts` and `app/` only, and nothing checks that the build leaves files untouched | INFO | CWE-829 | A08 | `tools/repo/react-router-entry.test.ts:15-24`; `tools/repo/workspaces.ts:47` | senior-developer (optional, this PR); TASK-007 (backstop) | Open |
| PR4-SEC-05 | Admin `<meta name="robots">` is dropped after hydration: React Router keeps only the deepest route's `meta` | INFO | CWE-200 | A05 | `apps/admin/app/root.tsx:33-38`; `apps/admin/app/routes/home.tsx:5-7` | senior-developer (this PR, optional) | Open |
| PR4-SEC-06 | Static-site header set incomplete by design (CSP, Permissions-Policy, HSTS), and the template comments name the wrong owner task | INFO | CWE-693, CWE-1021 | A05 | `infra/nginx/web.conf.template:15-19`, `admin.conf.template:11-14` | TASK-022, TASK-111, TASK-014 | Tracked |
| PR4-SEC-07 | Harness static server: a malformed percent-escape makes `decodeURIComponent` throw inside the request handler and crash the test server | INFO | CWE-248 | A05 | Drafted `tests/e2e/support/static-server.ts` (line 181 of the comment) | senior-developer (harness commit) | Open |
| PR4-SEC-08 | Playwright browser binaries are downloaded outside lockfile integrity and the cooldown | INFO | CWE-494 | A08 | Drafted install step `npm exec --no -w tests/e2e -- playwright install …` | senior-developer (harness commit); TASK-007 / TASK-011 | Open |
| PR4-SEC-09 | Dependency notes: `nanospinner` 1.2.2 is 23 months old (transitive, dev, report-only); `isbot` 5.2.2 in the lockfile is a pre-existing transitive of `@react-router/dev`, not a manifest declaration | INFO | CWE-1104 | A06 | lockfile `node_modules/nanospinner`, `node_modules/isbot` | TASK-007 (freshness report) | Report-only |

### PR4-SEC-01: whole-object `import.meta.env` inlines every `VITE_*` variable (LOW)

**Description.** `publicOrigin()` reads `(import.meta as {...}).env` and then `.VITE_PUBLIC_ORIGIN`.

The type assertion is stripped at transpile, so Vite sees a **whole-object** `import.meta.env` access. Vite 8's define plugin replaces that access with a serialisation of the complete `config.env` (`dist/node/chunks/node.js:17059-17085`: `for (const key in config.env) importMetaEnvKeys[key] = …` → `importMetaEnvVal`). `config.env` holds every `VITE_*` variable from `process.env` and from `apps/web/.env*`.

The built bundle confirms this. `home-*.js` contains `{BASE_URL:`/`,DEV:!1,MODE:`production`,PROD:!0,SSR:!1}.VITE_PUBLIC_ORIGIN`. It is benign today, because no `VITE_*` variable was set at build time. But any `VITE_*` variable present when the image is built gets embedded, whether or not the code uses it. Examples:
- a CI-wide variable meant for another app;
- a developer's `apps/web/.env.local`;
- a mis-prefixed key.

ADR-0018 item 1 intends something different: a Zod schema in `packages/config` (`config/web`), consumed through Vite `define`, with "only non-secret keys allowed by a test". That module does not exist yet, and no task sheet names an owner for it.

**Exploitability and impact.**
- **Precondition:** a `VITE_*`-named variable that carries non-public data in the build environment. By Vite's convention `VITE_*` values are already public, so this needs a separate mistake. Likelihood L.
- **Impact:** M. The value reaches every visitor. It also lands in an asset served `public, max-age=31536000, immutable`, so CDN and browser caches keep it after a fix.
- M×L = **LOW**.

**Remediation (code level).**
1. **Now, one line per app:** narrow what Vite can inline. Add `envPrefix: 'VITE_PUBLIC_'` to `apps/web/vite.config.ts` and `apps/admin/vite.config.ts`:
   ```ts
   export default defineConfig({
     envPrefix: 'VITE_PUBLIC_', // only explicitly public build-time values can reach the bundle (ADR-0018 item 1)
     plugins: [tailwindcss(), reactRouter()],
     // …
   });
   ```
   `VITE_PUBLIC_ORIGIN` keeps working unchanged. Other `VITE_*` names are no longer loaded.
2. **Preferred, where Jest allows it:** a static key read. Declare `interface ImportMetaEnv { readonly VITE_PUBLIC_ORIGIN?: string }` in `apps/web/app/env.d.ts` and read `import.meta.env.VITE_PUBLIC_ORIGIN`. Vite then inlines only that key. Keep `resolvePublicOrigin` as the pure, unit-tested function. This step is optional once item 1 is in place.
3. **Final:** principal-architect assigns the ADR-0018 `config/web` module, with its Zod schema, `define` wiring and non-secret-key test, to a task. TASK-005 is the natural home; otherwise the first web task that adds API configuration. Once it exists, the apps consume config only through it.

**Verification test.**
- Extend `apps/web/tests/prerender.int.test.ts`. Build with `VITE_PUBLIC_ORIGIN=https://example.test` and a canary `VITE_CANARY_SECRET=canary-7f3c` (or `VITE_PUBLIC_…` for a positive control) in `env`, then assert:
  - no file under `client/` contains `canary-7f3c`;
  - the canonical link is `https://example.test/en/`;
  - no `*.map` file and no `sourceMappingURL` exists under `client/`. This locks the current no-source-maps behaviour, which today rests only on Vite's default.
- Add a static test that both Vite configs set `envPrefix` to `'VITE_PUBLIC_'`.

### PR4-SEC-02: stock `default.conf` would shadow the templates (LOW, latent)

**Description.** The templates target the `nginx-unprivileged` image's envsubst step (`/etc/nginx/templates/*.template` → `/etc/nginx/conf.d/*.conf`). That image also ships `/etc/nginx/conf.d/default.conf`: `listen 8080; server_name localhost;`, plus an IPv6 `listen` added by the `10-listen-on-ipv6-by-default.sh` entrypoint. It has `root /usr/share/nginx/html` and no headers.

Our servers use `listen ${NGINX_PORT};` without `default_server`, and `server_name _` (a name that never matches). Request routing then works like this:
- `include conf.d/*.conf` loads files in alphabetical order. For **web**, `default.conf` sorts before `web.conf`, so the stock server is the default server and answers **every** request.
- For **admin**, `admin.conf` sorts first. But `Host: localhost` matches `default.conf`'s `server_name`, which is the normal local case at `localhost:8081`.
- IPv6 connections reach only `default.conf`.

In those cases none of the template controls apply:
- headers;
- `server_tokens off` (REQ-SEC-001 forbids version banners);
- the GET/HEAD restriction;
- the dotfile deny;
- the `/` 302 and the SPA fallback.

A related problem: the image's own `index.html` and `50x.html` stay in the document root unless the stage cleans it. The `build/server` pre-render bundle must also never be copied into it.

**Exploitability and impact.** This is latent: there is no Dockerfile until TASK-014. If it shipped, the browser protections would be missing on every page (impact M). TASK-026's Compose Playwright slice and TASK-111's header suite would very likely catch it first (likelihood L). **LOW.**

**Remediation (code level).**
1. **TASK-014, web and admin Dockerfiles (binding):**
   ```dockerfile
   RUN rm -f /etc/nginx/conf.d/default.conf && rm -rf /usr/share/nginx/html/*
   COPY infra/nginx/web.conf.template /etc/nginx/templates/web.conf.template
   COPY --from=build /app/apps/web/build/client/ /usr/share/nginx/html/
   ```
   Copy `build/client/` only, never `build/server/`.
2. **Template (this PR or TASK-014):** `listen ${NGINX_PORT} default_server;`. If IPv6 is wanted, add `listen [::]:${NGINX_PORT} default_server;`. Optionally also add an explicit `autoindex off;` for readers. Extend `tools/repo/nginx-templates.test.ts` to assert `default_server`.
3. **Fix the comments.** The template comments say TASK-022 owns "the image Dockerfile and the header/response test suite". Per `WAVE-00.md` and `WAVE-03.md`, the Dockerfiles are TASK-014 and the header suite is TASK-111 (US-043, REQ-SEC-001..003).

**Verification test.**
- TASK-014 image test:
  - `docker run … nginx -T` contains exactly one `server {` block;
  - `curl -H 'Host: localhost'` and `curl -H 'Host: other.example'` against `/en/` both return `X-Content-Type-Options: nosniff` and `Server: nginx` with no version;
  - `/usr/share/nginx/html/50x.html` is absent.
- TASK-111 runs its header suite against both images.

### PR4-SEC-03: Playwright cooldown clears at 20:17:41Z, not 18:30Z (LOW)

**Description.** Registry publish times:

| Package | Published | Clears 7 days at |
|---|---|---|
| `@playwright/test` 1.65.0 | 2026-11-05T18:30:18Z | 18:30:18Z |
| `playwright` 1.65.0 | 2026-11-05T18:28:14Z | 18:28:14Z |
| `playwright-core` 1.65.0 | 2026-11-05T**20:17:40Z** | **20:17:41Z** |
| `@axe-core/playwright` 4.14.0 | 2026-10-15T13:33:17Z | already clear |
| `axe-core` 4.14.0 | 2026-10-05T17:43:36Z | already clear |

`playwright` pins `playwright-core` exactly (`"playwright-core": "1.65.0"`). So the planned `npm install` fails with ETARGET under `min-release-age=7` until 20:17:41Z.

Any workaround is a cooldown bypass, contrary to SEC-P3-04 item 2. That includes `--min-release-age=0`, `--before=…`, `npm_config_min_release_age`, or installing `playwright-core` separately. The PR text also wrongly says `@axe-core/playwright` is still in its cooldown.

Positives:
- the harness manifest pins exact versions, and `.npmrc` sets `save-exact=true`;
- the install uses `--ignore-scripts`;
- browsers are installed through `npm exec --no`;
- nothing is in the lockfile yet.

**Exploitability and impact.** No exploit path exists today. The risk is procedural: a failed install at 18:30Z invites an override, and that weakens the control meant to absorb malicious releases (A08). Likelihood L, impact M. **LOW.**

**Remediation (binding on the harness commit).**
1. Do not run the install before **2026-11-12T20:18Z**. Pass no cooldown override flag or environment variable.
2. Install browsers through the allow-listed entry point, `npm run deps:rebuild -- --playwright=chromium,firefox,webkit` (ADR-0023 am. F). It validates browser names and runs `npm exec --no -- playwright install`.
3. Correct the PR body: the cooldown clears at 20:17:41Z, and `@axe-core/playwright` / `axe-core` are already clear.

**Verification test.** The harness commit's lockfile delta must contain only `@playwright/test`, `playwright`, `playwright-core`, `@axe-core/playwright` and `axe-core`, plus any of their declared dependencies. Each must be at least 7 days old at the commit timestamp, carry SLSA provenance (all five do on the registry today) and have no install script. security-analyst checks this in the delta re-review (§7).

### PR4-SEC-04: guard scope for PR1-SEC-03 (INFO)

The guard meets the criterion set in PR1-SEC-03 (a). Its negative fixtures are sound: deleting the entry makes the check fail, and so does `isbot` in any of the three fields. Measured against `resolveEntryFiles`, the trigger is narrower than the hazard:
- `@react-router/dev`'s Vite plugin also works with **no** config file, or with `react-router.config.{js,jsx,tsx,mjs,mts}`. The guard only looks at workspaces that have `react-router.config.ts`.
- The entry is looked up in the configured `appDirectory`. The guard hard-codes `app/`. Both apps set `appDirectory: 'app'` explicitly today.
- `optionalDependencies` is not inspected.
- The guard is static. No test asserts the behaviour itself: that a real build does not rewrite manifests.

**Suggested hardening (optional, cheap):**
- Select workspaces whose manifest declares `@react-router/dev` in any field, not just those with a `react-router.config.ts`.
- Assert `appDirectory === 'app'` in each config, or resolve it.
- Add `optionalDependencies` to `dependencyEntries`.
- In `apps/web/tests/prerender.int.test.ts`, which already runs real builds, assert that `build.output` does not match ``/adding `isbot/``, and that the SHA-256 values of `apps/<app>/package.json` and the root `package-lock.json` are unchanged across `buildApp()`.

The binding backstop stays the TASK-007 post-build `git status --porcelain` gate with its negative fixture.

### PR4-SEC-05: admin robots meta lost after hydration (INFO)

The root `meta()` returns `{ name: 'robots', content: 'noindex, nofollow' }`, and the built `index.html` contains it. But React Router's `Meta` keeps only the deepest route's array (`components.js:388-390`: `meta = [...routeMeta]`). On `/`, the home route's `meta()` returns `[{ title }]`, so the robots tag is removed from the live DOM.

Admin remains non-indexed: Nginx sends `X-Robots-Tag: noindex, nofollow` on every response, and `robots.txt` disallows all crawling. Only the third layer is lost, and the code comment overstates it.

**Fix:**
- Render `<meta name="robots" content="noindex, nofollow" />` statically inside `Layout`'s `<head>` in `apps/admin/app/root.tsx`, outside `<Meta />`, and drop it from `meta()`.
- Add an RTL test that the tag is present after the home route renders.

### PR4-SEC-06: header set completion and owner routing (INFO)

**Present now, at server level with `always` in both templates:**
- `X-Content-Type-Options: nosniff`;
- `Referrer-Policy: strict-origin-when-cross-origin`;
- `X-Frame-Options: DENY`;
- `Cross-Origin-Opener-Policy: same-origin`;
- `server_tokens off`;
- `charset utf-8`.

Admin also sends `X-Robots-Tag`. A test asserts that no `add_header` appears at location level, which prevents header-inheritance loss.

**Missing against REQ-SEC-001..003, deferred by plan:**
- `Permissions-Policy` (REQ-SEC-001);
- the enforcing hash-based CSP with `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'self'` and `connect-src` limited (REQ-SEC-002);
- HSTS, except locally (REQ-SEC-003).

These belong to **TASK-022** (SPK-06) and **TASK-111** (US-043), both M0 Must.

**Inputs for TASK-022/TASK-111:**
- Each pre-rendered page and the SPA fallback carry 4 inline classic `<script>` blocks and 1 inline module script, including `window.__reactRouterContext`. The hash set differs between the locale pages and `index.html`.
- Threat-model T-09 also requires `no-referrer` on token pages when they arrive.
- The comment mis-routing is covered in PR4-SEC-02 item 3.

### PR4-SEC-07: harness static server crashes on malformed escapes (INFO)

The server runs `decodeURIComponent(new URL(request.url).pathname)` with no guard. A request such as `/%E0%A4%A` throws `URIError` synchronously inside the `createServer` callback, and that terminates the server mid-suite.

The path-traversal guard itself is correct: `normalize(join(root, pathname))` plus `startsWith(root + sep)`. It also covers `%2e%2e%2f` and `%5c` on Windows. Exposure is local only (bound to `127.0.0.1`).

**Fix:** wrap the decode in `try { … } catch { response.writeHead(400).end(); return; }`.

### PR4-SEC-08: Playwright browser downloads (INFO)

`playwright install` downloads the Chromium, Firefox and WebKit builds from Microsoft's Playwright CDN. That download is outside npm lockfile integrity and the cooldown; `PLAYWRIGHT_DOWNLOAD_HOST` can redirect it. This is the same trust class as PR1-SEC-02, but the binaries are test-only and never shipped.

**Route to TASK-007 / TASK-011:**
- `check-workflow-policy` rejects `PLAYWRIGHT_DOWNLOAD_HOST` overrides, just as it rejects `PRISMA_ENGINES_MIRROR`;
- the CI browser cache is keyed on the Playwright version;
- browsers are installed only through `deps:rebuild --playwright=…`.

Note for TASK-007: on Linux, `deps:rebuild` adds `--with-deps`, which runs the OS package manager. That behaviour predates this PR and should be confined to lane C runners.

### PR4-SEC-09: dependency notes (INFO)

**`nanospinner` 1.2.2.**
- Last release 2024-12-09 (about 23 months), so it fails the 18-month freshness rule.
- Not deprecated, no advisory, MIT, depends only on `picocolors`.
- It arrives transitively through `size-limit`, which is maintained (release 2026-10-22).
- Under D-ARCH-003 rev 2 item 6 and rev 4 item 3 it is **report-only**: a dev-only, stale, non-deprecated transitive.
- TASK-007's freshness report must list it.

**`isbot` 5.2.2** (Unlicense, dev) is in the lockfile as a dependency of `@react-router/dev` 8.5.1. It was there on `main` before this PR. That is expected and harmless. PR1-SEC-03 concerns manifest declarations and the build-time install, not the transitive presence, so nobody should try to "remove" it.

## 4. Results by focus area

| # | Focus | Result |
|---|---|---|
| 1 | PR1-SEC-03 closure: no build-time install; guard negatives sound | **Met for TASK-004.** Entries exist in both apps, so `resolveEntryFiles` (`typegen-CqlAVM2O.js:442-479`) takes the user-entry branch and the `execSync(... install)` at `:466` is unreachable. No manifest declares `isbot`. The guard has negative fixtures for a missing entry and for `isbot` in each of 3 fields; 22/22 tests pass. `git status --porcelain` is empty after the head's build. `entry.server.tsx` has no request classification; it is used at build time only. Hardening suggestions are in PR4-SEC-04. |
| 2 | New dependencies | 4 tuples, all MIT, dev, registry with `sha512`, no install scripts, cooldown met. `size-limit` and `@size-limit/file` 14.3.0 carry SLSA provenance and are maintained. `@size-limit/file` measures bytes only and launches no browser. `@size-limit/preset-app` (14 High) is correctly avoided (D-ARCH-037). Audit: full tree 0 critical / 0 high / 34 moderate / 1 low (dev tooling, unchanged class); `--omit=dev` 0. Signatures: 1,425 verified, 562 attestations, 0 invalid. See §5. |
| 3 | Nginx templates | No open redirect: the `Location` is always `/en/`, `/es/` or `/fr/`. `absolute_redirect off` keeps it relative. No `$host`, `$http_host` or `$request_uri` anywhere, so no Host-header or CRLF influence. The regex is linear, with hyphen-delimited repetition and a scan bounded by header size. The 302 has `no-store` and a `Vary` header. Other controls: GET/HEAD only (405), `server_tokens off`, dotfiles denied (403), no directory listing, missing assets give a real 404 rather than the HTML fallback, `client_max_body_size 1k`. Headers: a correct subset is present now; CSP, Permissions-Policy and HSTS go to TASK-022/111 (PR4-SEC-06). The image wiring risk is PR4-SEC-02. |
| 4 | Admin separation | Separate template, image and port (compose `:8081`), so a separate origin. `X-Robots-Tag` and `robots.txt` disallow-all are present; the meta tag only survives the fallback HTML (PR4-SEC-05). Admin has no redirect logic. Web and admin are same-site (threat-model AS-1, and `localhost` ports locally). Cookie isolation therefore relies on distinct `__Host-` names (A-054), not on origin. This PR sets no auth cookie. The shared `lng` preference cookie is non-sensitive and set `SameSite=Lax`, with `Secure` on https. |
| 5 | Secrets and env in client bundles; source maps | No secrets, no absolute host paths, no `.vite/manifest.json`. No `*.map` files and no `sourceMappingURL` (Vite default `build.sourcemap: false`; lock it with the test in PR4-SEC-01). The admin bundle reads no env. The web bundle's whole-object env read is PR4-SEC-01. `build/server` exists locally and must stay out of images (PR4-SEC-02). |
| 6 | Drafted Playwright harness | Exact pins and `save-exact`; `--ignore-scripts`; `npm exec --no`; nothing installed. The cooldown timing is wrong (PR4-SEC-03). Browser download trust and test-server robustness are covered in PR4-SEC-07 and PR4-SEC-08. The licences are Apache-2.0 (Playwright) and MPL-2.0 (axe), both on the allow-list. |

## 5. Dependency table

### 5.1 New in this PR (lockfile delta `4da693a` → `519bb89`)

The structural delta is 4 added tuples, 0 removed, 0 integrity or `resolved` changes on retained entries, and 0 flag moves. The only manifest change is the root `devDependencies`, which gains `size-limit` and `@size-limit/file`, both pinned exactly.

| Package | Version | Direct? | Licence | Published | Age at lockfile commit (`b67eb36`, 2026-11-12T12:35Z) | Latest | Maintainer | Provenance | Install script | Advisories | Policy result |
|---|---|---|---|---|---|---|---|---|---|---|---|
| `size-limit` | 14.3.0 | root dev | MIT | 2026-10-22 | 20.7 d | 14.3.0 | ai (A. Sitnik) | SLSA v1 | no | none | Pass |
| `@size-limit/file` | 14.3.0 | root dev | MIT | 2026-10-22 | 20.7 d | 14.3.0 | ai | SLSA v1 | no | none | Pass |
| `lilconfig` | 3.1.4 | transitive (size-limit) | MIT | 2026-10-16 | 26.8 d | 3.1.5 (2026-11-09) | antonk52 | registry signature | no | none | Pass |
| `nanospinner` | 1.2.2 | transitive (size-limit) | MIT | 2024-12-09 | 23 months | 1.2.2 | usmanyunusov | registry signature | no | none | Pass. Stale transitive, report-only (PR4-SEC-09) |

### 5.2 Drafted harness (not installed; for the delta re-review)

| Package | Version | Licence | Published | Clears cooldown | Provenance | Notes |
|---|---|---|---|---|---|---|
| `@playwright/test` | 1.65.0 | Apache-2.0 | 2026-11-05T18:30:18Z | 2026-11-12T18:30:18Z | SLSA v1 | depends on `playwright` 1.65.0 (exact) |
| `playwright` | 1.65.0 | Apache-2.0 | 2026-11-05T18:28:14Z | 2026-11-12T18:28:14Z | SLSA v1 | depends on `playwright-core` 1.65.0 (exact) |
| `playwright-core` | 1.65.0 | Apache-2.0 | 2026-11-05T20:17:40Z | **2026-11-12T20:17:41Z** | SLSA v1 | the binding time (PR4-SEC-03) |
| `@axe-core/playwright` | 4.14.0 | MPL-2.0 | 2026-10-15 | cleared | SLSA v1 | `axe-core ~4.14.0` |
| `axe-core` | 4.14.0 | MPL-2.0 | 2026-10-05 | cleared | SLSA v1 | only canaries after 4.14.0; `~` does not select prereleases |

## 6. PR1-SEC-03 status

| Part | Requirement (PR-0001 §6) | Status at `519bb89` |
|---|---|---|
| (a) TASK-004 | Committed `app/entry.server.tsx` in both apps, no `isbot`; the structure test asserts the entry for every `react-router.config.ts` workspace and that no manifest declares `isbot` | **Met.** Optional hardening in PR4-SEC-04 |
| (b) TASK-007 | Post-build `git status --porcelain` gate with a negative fixture | Open (TASK-007) |
| (c) TASK-007 | Job-level `NPM_CONFIG_IGNORE_SCRIPTS: "true"` | Open (TASK-007) |
| (d) TASK-014 | Web/admin build stages run `NPM_CONFIG_OFFLINE=true` and checksum `package.json`/`package-lock.json` before and after the build | Open (TASK-014) |

PR1-SEC-03 is now **mitigated for the shipped apps** and stays open, MEDIUM latent, until (b) to (d) land. For the existing apps it is no longer reachable.

## 7. Follow-ups routed to named tasks

| Owner | Item | Finding | Binding? |
|---|---|---|---|
| **senior-developer, this PR (before merge, recommended)** | `envPrefix: 'VITE_PUBLIC_'` in both Vite configs, plus the canary and no-source-map assertions in `prerender.int.test.ts` | PR4-SEC-01 | Recommended. If not done here, it binds on TASK-005 |
| **senior-developer, harness commit** | Install no earlier than 2026-11-12T20:18Z with no cooldown override; browsers via `npm run deps:rebuild -- --playwright=chromium,firefox,webkit`; `try/catch` around `decodeURIComponent` in `static-server.ts`; correct the PR body times | PR4-SEC-03, -07, -08 | **Yes** |
| **security-analyst, delta re-review (R2)** | Before merge, re-check the harness commit: lockfile delta (tuples, age at commit, provenance, install scripts, licences), `npm audit --audit-level=high`, and that the files match the reviewed draft | PR4-SEC-03 | **Yes.** This verdict covers `519bb89` only |
| senior-developer, this PR (optional) | Static admin robots meta in `Layout`; guard hardening (workspaces declaring `@react-router/dev`, `appDirectory`, `optionalDependencies`, behavioural no-mutation assertion); fix the template comments' task pointers; `default_server` in both templates | PR4-SEC-04, -05, -02 (items 2–3) | No |
| **TASK-014** | Web/admin images: delete `conf.d/default.conf`, clean the html root, copy `build/client/` only (never `build/server/`), `nginx -T` single-server test, Host-variation header check; plus PR1-SEC-03 (d) | PR4-SEC-02; PR1-SEC-03 | **Yes** |
| **TASK-022** | Hash-based CSP covering the 4 classic + 1 module inline scripts per page and the SPA fallback | PR4-SEC-06 | Yes (as planned) |
| **TASK-111** | Permissions-Policy, enforcing CSP with `frame-ancestors 'none'`, HSTS off-local, header suite against both images including a non-matching `Host` | PR4-SEC-06, -02 | Yes (as planned) |
| **TASK-007** | Post-build porcelain gate and job-level `NPM_CONFIG_IGNORE_SCRIPTS` (PR1-SEC-03 b/c); gitleaks on this PR's range; `check-workflow-policy` rejects `PLAYWRIGHT_DOWNLOAD_HOST`; freshness report lists `nanospinner` 1.2.2 | PR1-SEC-03, PR4-SEC-08, -09 | Yes (as planned) |
| **principal-architect** | Assign the ADR-0018 `config/web` module (Zod schema, `define` wiring, non-secret-key test) to a task; TASK-005 is suggested | PR4-SEC-01 | Yes (ownership gap) |

## 8. Evidence (commands at `519bb89`, worktree `Shipqube-TASK-004`)

| Command | Result |
|---|---|
| `gh pr view 4 --json …`, `gh pr view 4 --comments` | 74 files; harness drafted in comment 6823848131; head `519bb89fa9f4…` |
| `git diff 4da693a..519bb89 -- . ':!package-lock.json'` | 2,905 lines reviewed |
| Lockfile structural delta (`git show` base/head + Node script) | 4 ADD (`size-limit`, `@size-limit/file`, `lilconfig`, `nanospinner`), 0 DEL, 0 integrity/`resolved` changes, root `devDependencies` +2 |
| `npm view <pkg>@<ver> license deprecated dist.attestations… maintainers` | as in §5 |
| `npm view <pkg> time --json` (incl. harness packages) | as in §5; `playwright-core` 1.65.0 at 2026-11-05T20:17:40.688Z |
| `npm audit --json` / `npm audit --omit=dev --json` | `{critical:0, high:0, moderate:34, low:1}` / all 0 |
| `npm audit signatures --@platform:registry=https://registry.npmjs.org/` | 1,425 verified registry signatures, 562 verified attestations, 0 invalid or missing |
| `jest --selectProjects unit --runInBand tools/repo/{react-router-entry,nginx-templates,size-limit}.test.ts` | 3 suites, **22/22** passed |
| `grep isbot package-lock.json` | `node_modules/isbot` 5.2.2 (dev), required by `@react-router/dev`; also on `main` |
| Read `@react-router/dev/dist/typegen-CqlAVM2O.js:442-519` | User entry → no install; missing entry and no `dependencies.isbot` → `updatePackage` + ``execSync(`npm install`)`` |
| Read `vite/dist/node/chunks/node.js:17055-17085` | Whole-object `import.meta.env` → all `config.env` keys serialised |
| Read `react-router/dist/production/lib/dom/ssr/components.js:355-395` | `meta = [...routeMeta]`: the deepest route wins, no merge |
| Inspect `apps/{web,admin}/build/client` | No `*.map`, no `sourceMappingURL`, no `.vite/`, no host paths; env object `{BASE_URL,DEV,MODE,PROD,SSR}` in `home-*.js`; admin `index.html` carries robots meta; 4+1 inline scripts per web page |
| `git status --porcelain`; `git check-ignore -v apps/web/.react-router apps/web/build` | Empty; both ignored (`.gitignore:95`, `:12`) |
| Secret keyword/entropy grep over added diff lines and `build/client` | No hits (gitleaks not run, per the no-Docker constraint) |

## Round 2 (head d2e867b)

| Field | Value |
|---|---|
| PR | #4 `feat(web): web and admin app scaffolds (TASK-004)`; round-2 delta review owed by §7 (harness commit with a lockfile change) |
| Head | d2e867b62ce9a13a712c83407ba2f6d8af3692cf |
| Range reviewed | `519bb89..d2e867b`, first parent: `9f5ea5e` (fix cycle 1), `f6eab82` and `1b0d734` (main merges), `4bc09ff`, `f44039f`, `50b4831` (lint wiring), `ba57e77` (merge of main `22eccb2`), `3349766` (Playwright + axe harness, m2 locale fix), `d2e867b` (jsdom support files moved to `tools/test-dom`). The PR's own content delta was isolated by comparing the net change at R1 (`4da693a...519bb89`) with the net change now (`22eccb2...d2e867b`): 27 files changed, 22 added, 3 moved out of `tools/test-support`, plus the lockfile |
| Scope | PR4-SEC-01, -03, -05, -07, -08 closure; the harness lockfile delta; the static test server; the m2 locale fix; the `tools/test-dom` move against lane A's base-ref fixture step; the merge commit's conflict resolutions; the Nginx template changes (`default_server`, gzip); anything new in the delta |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. No command ran in the TASK-004 worktree: PR files were read with `git show <sha>:<path>` from the main checkout, and the static server was probed as a copy in scratch. Node 24.22.3, npm 11.19.1 under the CLAUDE.md §2 PATH prefix. No install, build, test suite or e2e run |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open for this change, so merge is allowed. This round closes PR4-SEC-01, -03, -04, -05 and -07, and part of -08. The harness lockfile delta is exactly the 4 planned tuples. It adds 2 LOW and 1 INFO finding (PR4-SEC-10..12), each routed to a named owner. This verdict covers `d2e867b`, and stays valid across later merges of `main` as long as `main` changes none of the PR's security-owned paths. Overlap on 2026-11-13 is none; if PR #17 merges first, it will not be (R2.5 #6) |

### R2.1 Summary

**Round-1 findings.**
- **PR4-SEC-01 is closed for this PR.** Both Vite configs set `envPrefix: 'VITE_PUBLIC_'`, so the whole-object `import.meta.env` read can no longer publish any other `VITE_*` variable. Two tests lock this in:
  - a static test (`apps/{web,admin}/vite.config.test.ts`, unit lane) asserts the prefix and that no source map is built;
  - `apps/web/tests/prerender.int.test.ts` builds both apps with a random non-public canary in the environment. It asserts the canary (value and name) is absent from every client file, and that no `*.map` or `sourceMappingURL` exists. A `VITE_PUBLIC_ORIGIN` positive control proves the build environment reaches the bundle.
  - The test would have failed at `519bb89`, where the whole-object read inlined every `config.env` key.
  - The ADR-0018 `config/web` module now has an owner: TASK-022 (D-ARCH-054; the WAVE-00 sheet lists `loadWebBuildConfig`, `webBuildDefine`, the static key read and the canary test).
- **PR4-SEC-03 is closed.**
  - The harness lockfile delta is exactly `@playwright/test`, `playwright` and `playwright-core` 1.65.0 plus `@axe-core/playwright` 4.14.0. `axe-core` 4.14.0 was already present and is deduplicated.
  - All are dev-only, from `registry.npmjs.org` with `sha512` integrity equal to the registry's, and have no install script, SLSA v1 provenance, valid registry signatures and no advisories.
  - The stated install time is 2026-11-12T20:17:42Z (epoch 1794514662, one second after the 20:17:41Z clearance). The commit's author time is 20:55:25Z, and `.npmrc` is unchanged in the PR.
- **PR4-SEC-05 is closed.** The admin `Layout` renders a static `<meta name="robots" content="noindex, nofollow">` (`NoIndex`) in `<head>`, outside `<Meta />`, so hydration no longer drops it. An RTL test covers it.
- **PR4-SEC-07 is closed.**
  - The static server answers 400 to malformed escapes and to traversal, and keeps serving.
  - A 37-request raw-socket probe of a scratch copy found no file served outside the build root and no dotfile served. The server process never exited.
- **PR4-SEC-08 is partly closed.**
  - Lane A (TASK-007, on `main`) rejects `PLAYWRIGHT_*DOWNLOAD_HOST` in workflows, with a fixture.
  - Browsers come only from `deps:rebuild --playwright=…`: no script or workflow runs `playwright install`.
  - Playwright 1.65.0 is past the TLS-verification fix (`<1.55.1` advisory).
  - Residuals are in R2.3.

**The `tools/test-dom` move does not weaken lane A's base-ref fixture step.**
- `tools/test-support` on the head is again byte-identical to `main`, so the step still runs base copies of the suite, its fixtures, `lint-fixtures.mjs` and `tools/test-support`.
- With `--selectProjects unit`, Jest only resolves the `unit-dom` environment and setup paths (`jest-resolve` `resolveTestEnvironment`, path resolution). It never loads them, so no head code from `tools/test-dom` runs in that step.
- The move does take the jsdom environment and setup file out of the CODEOWNERS-owned `/tools/test-support/` path (PR4-SEC-11).

**New in this round.**
- **PR4-SEC-10 (LOW).** The new ESLint and Stylelint ignore globs for Playwright output match at any depth, while `.gitignore` is anchored. A tracked source folder named `test-results` or `playwright-report` is therefore compiled but never linted. This is the PR2-SEC-03/-09 class.
- **PR4-SEC-11 (LOW).** `tools/test-dom/` is outside CODEOWNERS.
- **PR4-SEC-12 (INFO).** The new `default_server` comment and test claim more than nginx does. `Host: localhost` and IPv6 still reach the stock `default.conf`, so the TASK-014 deletion remains binding.

**Merge commit `ba57e77`.**
- Its three conflicts were resolved in favour of `main`'s controls: the `check-suppressions` lint step is kept, and so is `main`'s stricter `test:integration` without `--passWithNoTests`. Both ESLint override blocks are kept.
- The `.stylelintignore` lines were rewritten to the equivalent `/**/…/` form; R2.5 covers their scope.
- The never-pushed first merge `2ff92da` is not an ancestor of `d2e867b` and is absent from the remote. `main`'s scrub commit `2e29004` is an ancestor of `ba57e77`, and lane A's gitleaks run on the range is green.

### R2.2 Method

- **Content delta.** I listed the blob changes between R1 and now for every path in the PR's net change and read every changed file (`git diff 519bb89 d2e867b` over `apps/web`, `apps/admin`, `infra`, `tools/repo`; `git diff 22eccb2 d2e867b` over the configuration files).
  - The `tests/e2e` files were read in full.
  - I compared them with the round-1 draft (comment 6823848131). Changes since the draft: `reuseExistingServer` went from `!CI` to `false`; there is a decode `try/catch` and an outer handler `try/catch`; traversal gets 400; the Accept-Language regex is now read from the template.
- **Merge commit.** `git merge-tree --write-tree 50b4831 22eccb2` (3 conflicts) compared with `ba57e77^{tree}` (4 files differ; each resolution read).
- **Lockfile.** A structural and generic deep JSON diff of `package-lock.json` across `22eccb2 → ba57e77 → 3349766 → d2e867b`.
  - Results: +4 (size-limit set) / +4 (harness) / 0, with no removals and no integrity, `resolved` or flag changes on retained entries.
  - Positive control: the leaf-diff counter reports 6 and 5 differing leaves.
- **Registry.**
  - Signatures: ECDSA verification of the `dist.signatures` of all 9 new tuples against `-/npm/v1/keys`, with a tampered-integrity negative control (fails as expected).
  - Integrity: each lockfile integrity was compared with the registry's `dist.integrity`.
  - Advisories: the bulk advisory endpoint, with a positive control (`playwright` 1.55.0 returns the known High).
  - `npm view` for licence, dependencies, scripts, provenance and publish times.
- **Static server.**
  - `git show d2e867b:tests/e2e/support/static-server.ts` into a scratch tree, with a fake build root, decoy files outside the root and dotfiles.
  - Started as a child process and probed with raw request targets over a TCP socket, so no client-side normalisation applied (Windows host).
  - The probe also measured the Accept-Language regex with 7 kB and 1,500-element headers.
- **Jest.** Read `jest-config` `normalize` and `jest-resolve` `resolveTestEnvironment` (main's `node_modules`) for what happens to an unselected project's environment.
- **Ignore globs.** `minimatch` (`dot: true`) checks of the new ESLint globs against deep source paths, plus `git check-ignore --no-index`.
- **Lane A.** Run 43314173521 on `d2e867b`: every fast-lane step succeeded, including the base-ref lint fixtures, lockfile, cooldown, licences, signatures, audit and build porcelain. `scans` ran Gitleaks and Semgrep successfully. Only the record step failed, which is what this record fixes.
- **Not done.**
  - No e2e or integration suite was run.
  - I could not query the host's endpoint-protection history for the Firefox `EPERM`: the session's permission policy denied the query, and I did not work around it (R2.3, PR4-SEC-08).

### R2.3 Round-1 findings at `d2e867b`

| ID | R1 | Status at `d2e867b` | Evidence / residual |
|---|---|---|---|
| PR4-SEC-01 | LOW | **Closed (this PR)** | `envPrefix: 'VITE_PUBLIC_'` in `apps/web/vite.config.ts:13`, `apps/admin/vite.config.ts:13`. Static test in the unit lane; canary + no-source-map test in `prerender.int.test.ts` (integration lane, heavy suites run locally per D-ORCH-001). `public-origin.ts` keeps the whole-object read, now confined. The final ADR-0018 module (`envPrefix` set to an unused prefix, `define`, static key read) is TASK-022 |
| PR4-SEC-02 | LOW (latent) | **Open (latent), TASK-014** | Item 2 done (`listen … default_server`). Item 3 done for the Dockerfile and test-suite pointers. Item 1 (delete `conf.d/default.conf`, clean the html root, copy `build/client/` only) stays **binding on TASK-014**. PR4-SEC-12 explains why `default_server` alone does not cover `Host: localhost` or IPv6 |
| PR4-SEC-03 | LOW | **Closed** | R2.1 and R2.6. Exact pins (`tests/e2e/package.json`), no cooldown override in any committed file, the install after 20:17:41Z (stated; consistent with the commit time and lane A's cooldown step) |
| PR4-SEC-04 | INFO | **Closed (backstop live)** | The optional guard hardening was not taken. The binding backstop, lane A's post-build `git status --porcelain` gate, is live on `main` and green for this head's build. The PR also adds a `typegen` script check with negative fixtures |
| PR4-SEC-05 | INFO | **Closed** | `apps/admin/app/components/no-index.tsx`, rendered in `Layout` `<head>` (`root.tsx:21`); robots entry removed from `meta()`; `no-index.test.tsx` |
| PR4-SEC-06 | INFO | **Tracked (TASK-022 / TASK-111)** | The Dockerfile (TASK-014) and suite (TASK-111) pointers are fixed and asserted. Residual: both templates still say TASK-022 adds HSTS and Permissions-Policy. Per WAVE-03, those REQ-SEC-001..003 headers are TASK-111; TASK-022 adds the CSP include. Whichever of TASK-022 or TASK-111 edits the templates first corrects the wording |
| PR4-SEC-07 | INFO | **Closed** | `decodedPathname()` returns `undefined` → 400; outer `try/catch` → 500 without exit. Probe in R2.5 |
| PR4-SEC-08 | INFO | **Partly closed** | Closed: workflow rejection of `PLAYWRIGHT_*DOWNLOAD_HOST` (TASK-007, `check-workflow-policy.mjs:77-78,248`, fixture `playwright-download-host.yml`); browsers only via `deps:rebuild`. **Residual:** (a) `deps:rebuild` refuses inherited Prisma redirect variables, but not `PLAYWRIGHT_*DOWNLOAD_HOST` in the local or lane-C environment (`rebuild.mjs:133` uses `forbiddenEnv`, which is Prisma-only). Owner: TASK-015. (b) Browser binaries remain unpinned (test-only). (c) `--with-deps` on Linux stays confined to lane C (TASK-015). (d) The host's endpoint protection blocked `firefox.exe` (D-ORCH-019). Before anyone adds an exclusion for `ms-playwright`, the orchestrator confirms in the protection history that this is a policy block or a false positive. Firefox evidence moves to lane C (COND-E2E-FF) |
| PR4-SEC-09 | INFO | **Report-only** | Unchanged |

**Related routed items not taken by this PR.** PR2-SEC-09 (LOW, routed to TASK-004/007) is still open at `d2e867b`: `TEST_FILES` keeps `**/{test,tests,__tests__}/**` (`eslint.config.mjs:49`). So is the PR2-SEC-03 residual: the TS-only block for app and package sources. Neither is a regression of this PR; both move with PR4-SEC-10 to TASK-022 (R2.8).

### R2.4 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR4-SEC-10 | ESLint and Stylelint ignore Playwright output folder names at **any depth**, while `.gitignore` ignores them only at the root and workspace roots. A tracked source folder named `test-results` or `playwright-report` is compiled and shipped but never linted | LOW | CWE-693 | A05 | `eslint.config.mjs:319-320`; `.stylelintignore:26-27` | senior-developer, this PR if another fix cycle runs; otherwise **TASK-022** (binding; it edits `eslint.config.mjs`) | Open |
| PR4-SEC-11 | The jsdom test environment and setup file moved from the CODEOWNERS-owned `/tools/test-support/` to the unowned `/tools/test-dom/`. Changes to them no longer require a security record | LOW | CWE-693 | A08 | `jest.config.ts:76,80,81`; `.github/CODEOWNERS` (no `/tools/test-dom/` line) | **TASK-015** (with the PR17-SEC-01 `.swcrc` lines), or this PR if another fix cycle runs | Open |
| PR4-SEC-12 | The `default_server` comment and test claim the template "answers every request" despite a stock `default.conf`. `Host: localhost` (any port) and IPv6 connections still go to the stock server | INFO | CWE-1188 | A05 | `infra/nginx/web.conf.template:57-59`, `admin.conf.template:25-27`; `tools/repo/nginx-templates.test.ts:36` | TASK-014 (binding delete + `nginx -T` test); comment fix by whoever edits the templates next | Open |

#### PR4-SEC-10: unanchored Playwright-output ignores (LOW)

**Description.** `globalIgnores` gains `'**/playwright-report/**'` and `'**/test-results/**'`, and `.stylelintignore` gains `/**/playwright-report/` and `/**/test-results/`. Both match at any depth.

`.gitignore`, by contrast, ignores those folders only at the root, under `apps/*`, `packages/*`, `tests/*` and `prisma/`. That anchoring is deliberate, from PR2-SEC-11 and R2-m1, and `tools/repo/gitignore.test.ts` asserts it.

Checked with `minimatch`:
- `apps/api/src/modules/quotes/test-results/handler.ts` and `packages/authz/src/playwright-report/guard.ts` are ESLint-ignored;
- `git check-ignore --no-index` does **not** ignore them (only `tests/e2e/test-results/x.json` is ignored).

Such a file is tracked, type-checked and built into `dist`, but none of these rules run on it:
- `no-innerhtml`, `outbound-http-via-client`, `audit-writer-allowlist`, `money-arith`;
- the boundaries layering, including the bcrypt confinement;
- the i18n and a11y rules.

`check-suppressions` does not notice, because nothing is suppressed. The comment right above these globs states the opposite principle ("anchored to the output folders … so a source folder named `build`, `dist` or `coverage` … is still linted").

**Exploitability and impact.**
- **Precondition:** code placed in a folder with one of these two names, by mistake or to evade the rules. Likelihood L, since the names are unusual for source folders.
- **Mitigation that remains:** Semgrep still scans these files, because `.semgrepignore` and the anchored `.gitignore` do not exclude them.
- **Impact:** M, because the lint rules are cited as mitigations in ADR-0016 §13, ADR-0005, ADR-0007 and REQ-SEC-016.
- M×L = **LOW**.

**Remediation (code level).** Anchor both lists the same way as the build-output globs. The R2-n8 symmetry test (`gitignore.test.ts`) maps these forms one-to-one.
```js
// eslint.config.mjs, globalIgnores
'{playwright-report,test-results}/**',
'{apps,packages,tests}/*/{playwright-report,test-results}/**',
'prisma/{playwright-report,test-results}/**',
```
```text
# .stylelintignore
/playwright-report/
/test-results/
/apps/*/playwright-report/
/apps/*/test-results/
/packages/*/playwright-report/
/packages/*/test-results/
/tests/*/playwright-report/
/tests/*/test-results/
/prisma/playwright-report/
/prisma/test-results/
```

**Verification test.** Extend the `report.ignored` probe paths in `tools/lint/lint-fixtures.mjs`. The expectations in `negative-fixtures.test.ts:411-438` become:
- `tests/e2e/test-results/x.js`: true;
- `playwright-report/x.js`: true;
- `apps/api/src/modules/quotes/test-results/a.ts`: false;
- `packages/authz/src/playwright-report/a.ts`: false;
- the Stylelint equivalents with `.css`.

Add the two deep paths to the "tracked" rows of `gitignore.test.ts`.

#### PR4-SEC-11: `tools/test-dom` outside CODEOWNERS (LOW)

**Description.** `.github/CODEOWNERS` owns `/tools/test-support/` and `/jest.config.ts`, because "each can drop or weaken a gate" (review m4). The `unit-dom` project's `testEnvironment` (`jsdom-environment.mjs`), `setupFilesAfterEnv` (`dom-setup.ts`) and CSS mapper target (`style-stub.ts`) now live in `/tools/test-dom/`, which no pattern owns.

Those files run before every `*.test.tsx` file. A setup file can:
- `jest.mock` any module for every component test;
- replace jest-dom matchers;
- or swap the DOM.

So a change there can make the whole `unit-dom` project vacuous. Today that project holds the PR4-SEC-05 robots test and the a11y and i18n component tests; later it will hold the UI authorisation and token-page tests. Such a change would not trigger lane A's security-owned-paths check.

The move itself is benign: the blobs are identical to the R1 files, and it does not weaken the base-ref step (R2.1).

**Exploitability and impact.**
- A deliberate or careless edit is still visible in code review; only the security-record trigger is lost. Likelihood L.
- Impact M: a CI control is weakened.
- **LOW.** This is the same class as PR17-SEC-01 (unowned `.swcrc`).

**Remediation.**
1. Add `/tools/test-dom/   @sukhchdit` to `.github/CODEOWNERS` under "Test, type-check and commit-message configuration". Because `.github/` is owned, doing this in this PR needs a round-3 record.
2. Generalise with a repo test: every path that `jest.config.ts` references (`testEnvironment`, `setupFiles*`, `moduleNameMapper` targets, `transform` modules, `globalSetup`/`globalTeardown`) must fall under a CODEOWNERS pattern. Then a future move cannot silently drop ownership. TASK-015 owns the PR17-SEC-01 CODEOWNERS work and is the natural home.
3. **Interim:** security-analyst checks every PR diff for `tools/test-dom/` changes until (1) lands.

**Verification test.** The repo test from item 2 fails on a fixture `jest.config.ts` whose `testEnvironment` points to an unowned folder, and passes on the real config.

#### PR4-SEC-12: `default_server` does not neutralise the stock server (INFO)

nginx picks the server by listen socket first, then by `server_name`; `default_server` applies only when no name matches. The stock `nginx-unprivileged` `conf.d/default.conf` has `server_name localhost`, and nginx strips the port from `Host` before matching, so `Host: localhost:8080` still selects it. Its IPv6 `listen` (added by `10-listen-on-ipv6-by-default.sh`) also has no counterpart in our templates.

The new comment ("this block answers every request even if the image still carries the stock conf.d/default.conf") and the test comment ("cannot take over the requests") therefore overstate the fix. For the local `localhost` case the shadowing from PR4-SEC-02 is unchanged.

**Fix:**
- TASK-014's `rm -f /etc/nginx/conf.d/default.conf` plus the `nginx -T` single-server test stay binding.
- Reword the comment to: "answers requests whose Host matches no server_name; TASK-014 deletes the stock default.conf, which would still take Host: localhost and IPv6".

### R2.5 Results by focus area

| # | Focus | Result |
|---|---|---|
| 1 | PR4-SEC-01: `envPrefix` + canary | **Closed.** Both configs set the prefix, and the unit lane asserts it. The canary is random per run and is searched for as both name and value in every client file of both apps. A positive control (`VITE_PUBLIC_ORIGIN` → canonical and hreflang URLs equal `https://example.test/<lng>/`) proves the environment reaches the build. The no-source-map assertion is now locked. The canary test runs in the integration lane, which runs locally (D-ORCH-001); lane A runs the static test |
| 2 | Harness supply chain (PR4-SEC-03/08) | **Pass.** See R2.6. Exact pins; `npm install --ignore-scripts … --save-exact` after the cooldown, with no override (`.npmrc` and `.node-version` unchanged; no `min-release-age` or `before` anywhere in the diff). Lane A's cooldown, licence, signature and audit steps are green. Browsers come only via `deps:rebuild --playwright=chromium,firefox,webkit`; Playwright ≥ 1.55.1 verifies TLS on the download. The `PLAYWRIGHT_*DOWNLOAD_HOST` workflow ban is live. Residual items are in R2.3, PR4-SEC-08 |
| 3 | Static test server | **Pass.** Bound to `127.0.0.1`. `reuseExistingServer: false`, so a process already holding the port is never trusted. Raw-socket probe of a scratch copy (Windows), 37 requests: malformed escape → 400; `..%2f`, `..%5c`, `/assets/..%2f…`, deep traversal to a decoy outside the root, mixed `/en/..%5c…`, a case-variant root, and absolute-form `http://evil/..%2f…` → 400. `/%2e%2e/…` and `/../..` are normalised by WHATWG `URL` → SPA fallback. NUL bytes, drive letters (raw and encoded), `::$DATA`, `CON`, `nul.txt`, `//host/share`, `*` and an 8 kB path → SPA fallback, never a file outside the root (`isFile` false for devices and NUL). `.hidden`, `%2ehidden`, `.well-known/…` and `.git/config` → 403. POST, OPTIONS and TRACE → 405; HEAD → 200 with no body. A CRLF in the `lng` cookie → 302 to a constant `/en/` (the `Location` is drawn only from `en|es|fr`). Accept-Language regex: 2.1 ms for a 7 kB header and 2.2 ms for 1,500 elements (linear). Decoy content leaked: none. The server stayed up through the final control (200) |
| 4 | m2 locale fix | **No security impact.** `useLocale` returns the URL locale (`localeFromPathname`, constrained to en/es/fr) on the client, and during hydration the `<html lang>` of the served file, validated by `isLocale` (unknown → `en`). The admin `useDetectedLocale` uses the same pattern with a constant build-time snapshot. No new sink, storage or network use. The `entry.server.tsx` `console.error` → `process.stderr.write` change is build-time only (no request data) |
| 5 | `tools/test-dom` move vs the base-ref fixture step | **Does not weaken the step.** `tools/test-support` on the head equals `main` (`git diff 22eccb2 d2e867b -- tools/test-support` is empty), so the step's base-sourced set is unchanged. `--selectProjects unit` filters after `normalize`, and `normalize` only *resolves* the `unit-dom` environment and setup paths, without loading them. The renamed blobs are identical to the R1 files. The step still runs under the head `jest.config.ts`; that is a pre-existing residual (PR17-SEC-06). **Ownership is lost** (PR4-SEC-11) |
| 6 | Merge `ba57e77` | **Clean for security.** It matches `git merge-tree` except for 3 conflict resolutions and 1 auto-merged file. `package.json` keeps `check-suppressions`, drops `--allow-empty-input` (a strengthening, PR2-SEC-03) and keeps `main`'s `test:integration` without `--passWithNoTests`. `eslint.config.mjs` keeps both override blocks. `negative-fixtures.test.ts` asserts the 4-step lint wiring. `.stylelintignore` was rewritten from `playwright-report/` to the equivalent `/**/playwright-report/` (scope: PR4-SEC-10). The unpushed `2ff92da` is not in the history. Owned-path overlap between `main` (`22eccb2..df09b0b`, docs and agent memory only) and the PR's net change: **none**. **Merge-order note.** Open PR #17 (`8dd1d24`, D-TASK007-04) also changes the owned `jest.config.ts` and `tools/lint/negative-fixtures.test.ts`, and `git merge-tree d2e867b 8dd1d24` conflicts in both. Whichever PR merges second needs a conflict resolution in owned paths. That voids its record for those paths and requires a security delta round naming its merge commit |
| 7 | Nginx templates | `default_server` (PR4-SEC-02 item 2; limits in PR4-SEC-12). Dynamic `gzip` + `gzip_vary` at server level: BREACH needs a secret and attacker-reflected input in the same compressed response. Static pre-rendered files carry neither, so it does not apply. TASK-111 / API work must re-assess it before any HTML carries a token or nonce. `Vary: Accept-Encoding` keeps the immutable asset cache correct. No `$host`, `$http_host` or `$request_uri` was introduced; the redirect is unchanged |
| 8 | Lint, type-check and test wiring | `lint` = `typegen` → ESLint → Stylelint (no `--allow-empty-input`) → `check-suppressions`, asserted by the wiring test. `typecheck` = `typegen` → `tsc -b`. `test:unit` selects `unit unit-dom`. The coverage exclusion is limited to `apps/*/app/{entry.server.tsx,routes.ts}` (build-time modules, outside the 95 % paths). The `routes.ts` `no-extraneous-dependencies` override lists exact files. `tests/e2e/tsconfig.json` adds `erasableSyntaxOnly` (stricter). There are no new `eslint-disable`, `stylelint-disable`, `nosem`, `gitleaks:allow` or `@ts-*` comments, no new `.swcrc` (PR17-SEC-01 watch) and no `.env*` files |
| 9 | Secrets | Lane A gitleaks (PR range, first parent) is green. A keyword grep over the added lines of the PR's content delta found only a benign comment word. Nothing secret-shaped was added |

### R2.6 Dependency delta (`22eccb2` → `d2e867b`)

Via the merge, the delta matches round 1 exactly: `size-limit` and `@size-limit/file` 14.3.0, `lilconfig` 3.1.4 and `nanospinner` 1.2.2 (R1 §5.1). The harness commit `3349766` adds the following, with `tests/e2e` `devDependencies` as the only other change. `d2e867b` and `main`'s later commits have no lockfile change.

| Package | Version | Direct? | Licence | Published | Age at `3349766` (author 2026-11-12T20:55:25Z) | Provenance | Signature | Install script | Advisories | Policy |
|---|---|---|---|---|---|---|---|---|---|---|
| `@playwright/test` | 1.65.0 | `tests/e2e` dev, exact | Apache-2.0 | 2026-11-05T18:30:18Z | 7 d 2 h | SLSA v1 | valid | no | none | Pass |
| `playwright` | 1.65.0 | transitive (exact) | Apache-2.0 | 2026-11-05T18:28:14Z | 7 d 2 h | SLSA v1 | valid | no | none | Pass |
| `playwright-core` | 1.65.0 | transitive (exact) | Apache-2.0 | 2026-11-05T20:17:40Z | 7 d 0 h 37 m | SLSA v1 | valid | no | none | Pass (the binding time; the install was stated at 20:17:42Z) |
| `@axe-core/playwright` | 4.14.0 | `tests/e2e` dev, exact | MPL-2.0 | 2026-10-15T13:33:17Z | 28 d | SLSA v1 | valid | no (`prepare` only, which does not run for registry tarballs; `ignore-scripts`) | none | Pass. Peer `playwright-core >=1.0.0` satisfied |
| `axe-core` | 4.14.0 | already present (dev), deduplicated | MPL-2.0 | 2026-10-05 | n/a | SLSA v1 | valid | no | none | Pass (unchanged entry) |

All lockfile integrities equal the registry's `dist.integrity`, and every `resolved` host is `registry.npmjs.org`. The bulk advisory query for all 9 new tuples returned `{}`; its positive control returned the known High for `playwright` 1.55.0.

### R2.7 PR1-SEC-03 status (observed at `d2e867b`)

| Part | Status |
|---|---|
| (a) TASK-004 entry files, no `isbot` | Met (R1); unchanged |
| (b) TASK-007 post-build porcelain gate | Met on `main` (lane A step "Build must not mutate the tree"), green for this head |
| (c) TASK-007 `NPM_CONFIG_IGNORE_SCRIPTS` | Met on `main` (`ci.yml:43`, `:63`) |
| (d) TASK-014 offline build + manifest checksum | Open (TASK-014) |

### R2.8 Follow-ups routed

| Owner | Item | Finding | Binding? |
|---|---|---|---|
| senior-developer, this PR (only if another fix cycle runs; otherwise TASK-022) | Anchor the Playwright-output ignores in ESLint and Stylelint; add the deep-path rows to the lint and gitignore tests | PR4-SEC-10 | Yes, by TASK-022 at the latest |
| **TASK-022** | PR4-SEC-10 if not done here; PR2-SEC-09 `TEST_FILES` anchoring and the PR2-SEC-03 TS-only block (carried from TASK-004, not taken); the ADR-0018 `config/web` module (PR4-SEC-01 final) | PR4-SEC-10, PR2-SEC-09, PR2-SEC-03 | Yes |
| **TASK-015** | `/tools/test-dom/` in CODEOWNERS plus the "every jest.config.ts reference is owned" test (with PR17-SEC-01); refuse inherited `PLAYWRIGHT_*DOWNLOAD_HOST` in `deps:rebuild`'s Playwright step; `--with-deps` confined to lane C; Firefox projects green on Linux (COND-E2E-FF) | PR4-SEC-11, -08 | Yes |
| **TASK-014** | Delete `conf.d/default.conf`, clean the html root, copy `build/client/` only, `nginx -T` single-server test, `Host: localhost` and IPv6 checks; PR1-SEC-03 (d) | PR4-SEC-02, -12; PR1-SEC-03 | Yes |
| TASK-022 / TASK-111 | Correct the template header-owner wording (HSTS and Permissions-Policy are TASK-111); re-assess `gzip` for any HTML that carries a token or nonce | PR4-SEC-06, R2.5 #7 | Yes (as planned) |
| sdlc-orchestrator | Before any endpoint-protection exclusion for `ms-playwright`, confirm in the host's protection history that the `firefox.exe` block is a policy block or a false positive | PR4-SEC-08 (d) | Yes, before any exclusion |
| security-analyst | Interim: check each PR diff for `tools/test-dom/` and deep `test-results`/`playwright-report` source folders until PR4-SEC-10/11 land | PR4-SEC-10, -11 | Yes |
| sdlc-orchestrator | Merge order with PR #17. Owned paths overlap (`jest.config.ts` and `negative-fixtures.test.ts`, conflicting). The second PR to merge needs a security delta round on its merge commit. If PR #4 merges first, no further PR #4 round is needed | R2.5 #6 | Procedural |

### R2.9 Evidence (commands; read-only, from the main checkout and scratch)

| Command | Result |
|---|---|
| `git fetch -q origin`; `git ls-remote origin` | `refs/pull/4/head` = `refs/heads/feat/TASK-004-web-admin-app-scaffolds` = `d2e867b62ce9…`; `2ff92da` not on the remote |
| `git log --first-parent 519bb89^..d2e867b` | 9 commits after `519bb89` (R2 range row) |
| Blob comparison of net changes `4da693a...519bb89` vs `22eccb2...d2e867b` | 27 changed, 22 added, 3 moved (`tools/test-support/{dom-setup.ts,jsdom-environment.mjs,style-stub.ts}` → `tools/test-dom/`, identical blobs) |
| `git merge-tree --write-tree --name-only 50b4831 22eccb2`; `git diff <tree> ba57e77` | Conflicts in `eslint.config.mjs`, `package.json`, `negative-fixtures.test.ts`; resolutions as in R2.5 #6 |
| `git merge-base --is-ancestor` | `2ff92da` ∉ history of `d2e867b`; `2e29004` (scrub) ∈ history of `ba57e77` |
| `git diff --name-only 22eccb2 origin/main` (`df09b0b`) ∩ PR net change | Empty (`main` changed only `docs/` and `.claude/agent-memory/`) |
| PR #17 net change (`8dd1d24`) ∩ PR #4 net change; `git merge-tree --write-tree d2e867b 8dd1d24` | `jest.config.ts`, `tools/lint/negative-fixtures.test.ts` (both owned); both conflict |
| `lockdiff.mjs` over `22eccb2`, `ba57e77`, `3349766`, `d2e867b`, `origin/main` | +4 (size-limit set), +4 (harness), 0, 0; no removals or retained-entry changes |
| `sigcheck.mjs` (registry keys, `dist.signatures`, `dist.integrity`, advisories bulk) | 9/9 signatures valid; tampered control invalid; 9/9 integrity match; advisories `{}`; control returns the `playwright` <1.55.1 High |
| `npm view <pkg>@<ver> license dependencies optionalDependencies peerDependencies scripts.* dist.attestations…` | As in R2.6; no `fsevents` optional dependency in `playwright` 1.65.0 |
| `node probe-static.mjs` (scratch copy of `static-server.ts`, child process, raw sockets) | R2.5 #3; no decoy or dotfile content in any response; the server stayed up |
| `minimatch` + `git check-ignore --no-index -v` | PR4-SEC-10 paths ESLint-ignored but git-tracked; only `tests/e2e/test-results/` is git-ignored |
| Read `jest-config` `normalize` (`index.js:1691`), `jest-resolve` `resolveTestEnvironment` (`:1626`) | Path resolution only for unselected projects |
| `gh run view 43314173521` | `fast-lane` success (all steps); `scans`: Gitleaks success, Semgrep success, record step failure; `ci-gate` failure (record only) |
| `git grep` for `playwright install`, `PLAYWRIGHT_*` | Only the lane A policy rule, its test and its fixture |
| Record check (main's `tools/ci/check-security-owned-paths.mjs`, scratch `git clone --shared`, this record committed on top of `d2e867b`) | See R2.10 |

### R2.10 Record-check simulation

Script `scratchpad/review/PR-4-sec-r2/scripts/record-sim.sh` (session scratch):
- `main`'s `tools/ci` was extracted with `git archive origin/main`.
- Each case ran in a fresh `git clone --shared --no-checkout` of the main checkout, detached at `d2e867b`, with the record committed on top.
- The CLI was `--root <clone> --base <origin/main> --head HEAD --pr <n> --json`, with base `df09b0b`.
- Each clone was removed afterwards; nothing was written to the main repository's `.git`.

| Case | Expected | Result |
|---|---|---|
| This record (rounds 1 + 2), `--pr 4` | pass | **`pass`**, exit 0. `satisfiedBy` = this record @ `d2e867b62ce9a13a712c83407ba2f6d8af3692cf`. Owned set (10): `.stylelintignore`, `apps/{admin,web}/tsconfig.json`, `eslint.config.mjs`, `jest.config.ts`, `package-lock.json`, `package.json`, `packages/ui/tsconfig.json`, `tests/e2e/tsconfig.json`, `tools/lint/negative-fixtures.test.ts`. Notes only: the round-1 head rows (`519bb89`, `b67eb36`) are voided by later owned changes |
| Control: round-1-only record (as on `d2e867b`), `--pr 4` | missing | `missing`, exit 1 (the same two notes) |
| Control: this record, `--pr 5` | missing | `missing`, exit 1 (`PR-0005-TASK-003-security-review.md` names no commit of this PR) |

## Round 3 (head e3cdb94)

| Field | Value |
|---|---|
| PR | #4 `feat(web): web and admin app scaffolds (TASK-004)`; round-3 delta review. It is owed because two merges of `main` resolved owned paths that PR #17, #18 and #19 also changed (D-ORCH-020; R2.5 #6), and because fix cycle 3 changed owned paths (PR4-SEC-10, PR4-SEC-11) |
| Head | e3cdb944b2be0decf7bb54f8885b97a393ea8051 |
| Range reviewed | `d2e867b..e3cdb94`, first parent: `8d5a4ac` (merge of `main` `80ff2c2`: PR #17 fixture-mode split, `SWC_JEST_OPTIONS`, `.swcrc` deleted; PR #18 TASK-016), `a8a2566` (PR4-SEC-11), `7c00aae` (PR4-SEC-10), `05dfe7e` (test unmount, code review R3-n2), `e3cdb94` (merge of `main` `99ea21f`, including PR #19 TASK-023). The PR's net change against `main` is 97 paths: the 92 of round 2 plus `.github/CODEOWNERS`, `tools/ci/check-workflow-policy.{mjs,test.ts}`, `tools/lint/lint-fixtures.mjs` and `tools/repo/gitignore.test.ts` |
| Scope | Closure of PR4-SEC-10 and -11. Whether the owned-path merge resolutions weaken any control: `jest.config.ts` (does `unit-dom` inherit `swcrc: false`?), `tools/lint/negative-fixtures.test.ts` (base and no-weakening semantics, the PR #18 `TENANT_DB` and `WARNINGS` tables, the PR #19 cases), the `eslint.config.mjs` union, CODEOWNERS. Whether the lockfile delta is unchanged. The D-ORCH-021 workflow-lever check. Anything new in the delta |
| Reviewer / date | security-analyst, 2026-11-13. Read-only. No command ran in the TASK-004 worktree: everything was read with `git show <sha>:<path>` from the main checkout or probed in scratch. Node 24.22.3 under the CLAUDE.md §2 PATH prefix. No install, build, test suite or e2e run |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open for this change, so merge is allowed once this record is committed (docs-only) on top of `e3cdb94` and lane A is green. PR4-SEC-10 and PR4-SEC-11 are closed. Both merges equal `git merge-tree` apart from two conflict resolutions, and those keep every PR #17, #18 and #19 control and every PR #4 assertion. The lockfile delta is the round-2 delta, leaf for leaf. No workflow lever changed. One INFO finding is new (PR4-SEC-13). This verdict covers `e3cdb94`. A later merge of `main` voids it only if `main` changes an owned path that this PR also changes; with `origin/main` at `21bf127` that overlap is empty |

### R3.1 Summary

- **PR4-SEC-10 is closed.**
  - ESLint `globalIgnores` now list `{playwright-report,test-results}/**`, `{apps,packages,tests}/*/{playwright-report,test-results}/**` and `prisma/{playwright-report,test-results}/**`. `.stylelintignore` has the 10 matching anchored lines. Both are exactly the R2 remediation and mirror the anchored `.gitignore` lines 62-71.
  - The lint wiring test (`ESLINT_IGNORED`, `STYLELINT_IGNORED`), the `lint-fixtures.mjs` probe matrices, the `.gitignore` "tracked" rows and the R2-n8 symmetry test all carry the deep-path cases.
  - An independent `ESLint#isPathIgnored` probe of the head config gave 17/17 expected decisions (R3.5 #3).
- **PR4-SEC-11 is closed.**
  - `/tools/test-dom/   @sukhchdit` is in CODEOWNERS.
  - `'tools/test-dom/'` is in `REQUIRED_CODEOWNED_PATHS`, so `checkCodeowners` turns the loss of that line into a `codeowners-coverage` finding. The policy test lists it.
  - The record checker reads CODEOWNERS from the base and the head, so changes to the 3 files now require a record.
  - The generic "every path that `jest.config.ts` references is owned" test (R2 remediation item 2) was not added. It stays with TASK-015 as hardening.
- **The merge resolutions are clean for security.**
  - `e3cdb94` equals `git merge-tree --write-tree 05dfe7e 99ea21f`, a clean merge, tree for tree.
  - `8d5a4ac` differs from `git merge-tree d2e867b 80ff2c2` only in its two conflicts: `jest.config.ts` and `negative-fixtures.test.ts`.
  - **`jest.config.ts`.** `unit-dom` spreads `common` and sets no `transform`, so it inherits `['@swc/jest', SWC_JEST_OPTIONS]` with `swcrc: false`. `main`'s `tools/ci/jest-transform.test.ts` asserts that for every project, which makes it 4 projects now, and lane A ran it green.
  - **`negative-fixtures.test.ts`.** Against `main` the PR only adds lines and widens one test title. Every `main` line survives, including `TENANT_DB`, `WARNINGS`, `bad-prisma-import`, the `MODE === 'exact'` splits and `expect-affected`. Two PR #4 assertions were re-expressed in `main`'s structure, and each is at least as strict as before (R3.5 #2).
  - **`eslint.config.mjs`** against `main` only adds the anchored ignores and the exact-file `routes.ts` override. The PR #19 `prisma-seed` category is untouched.
- **The lockfile delta is unchanged.** `delta(22eccb2 → d2e867b)` and `delta(99ea21f → e3cdb94)` are the same 64 leaf changes. They are the size-limit set (`size-limit`, `@size-limit/file`, `lilconfig`, `nanospinner`) and the harness set (`@playwright/test`, `playwright`, `playwright-core`, `@axe-core/playwright`), plus the root and `tests/e2e` dependency lists.
- **The D-ORCH-021 workflow-lever check finds nothing.**
  - `git diff 99ea21f e3cdb94 -- .github/workflows .github/actions` is empty, and so is the same diff against `origin/main`. The head's `ci.yml` is `main`'s blob.
  - No workflow file changed, so none of the D-ORCH-021 levers can have changed: `RANGE_BASE`, `BASH_ENV`, `PATH`, `BASH_FUNC_*`, `defaults.run`, a folded `run: >` on a gate step, or a `$GITHUB_ENV`/`$GITHUB_PATH` write.
  - A grep of the PR's whole net diff for `RANGE_BASE`, `RANGE_HEAD`, `BASH_ENV`, `BASH_FUNC`, `GITHUB_ENV`, `GITHUB_PATH`, `NODE_OPTIONS` and `defaults:` also finds nothing, for example in a script.
  - `.npmrc`, `.node-version`, `.gitattributes`, `.semgrepignore`, `.gitleaks*` and `tools/deps` are unchanged.
- **New finding.** PR4-SEC-13 (INFO): since `d2e867b`, `npm run lint` and `npm run typecheck` start with `npm run typegen`. That runs unowned head code (workspace `typegen` scripts, `apps/*/vite.config.ts`, `react-router.config.ts`, `app/routes.ts`) in the same job, before ESLint and `tsc`. I described the `typegen` step in R2.5 #8 but missed this integrity angle in round 2.

### R3.2 Method

- **Tree equivalence.** A three-way `ls-tree -r -z` comparison over 1,424 paths. Inputs: base `22eccb2`, the round-2 head `d2e867b`, `main` `99ea21f` and the new head `e3cdb94`. The expected entry is `d2e867b`'s where the PR changed the path, else `main`'s.
  - Result: 1,412 paths match.
  - 5 overlaps: `eslint.config.mjs`, `jest.config.ts`, `package.json`, `package-lock.json`, `negative-fixtures.test.ts`.
  - 7 deviations, which are exactly the paths of `a8a2566`, `7c00aae` and `05dfe7e` outside the overlaps.
  - Positive control: `main` treated as the head gives 87 mismatches.
- **Merges.** `git merge-tree --write-tree` for both merges, compared with the merge commits' trees (R3.1).
- **Overlap files.**
  - The net diff against `main` (`git diff 99ea21f e3cdb94 -- <path>`) for each overlap file, read in full.
  - A line-carry script: lines added by either side that are missing at the head, and lines `main` removed that came back. Every "came back" line also exists in `main`'s file, so they are moves.
  - The `package.json` added and removed lines are identical to round 2's.
- **Fix commits.** Each of `a8a2566`, `7c00aae` and `05dfe7e` was read in full. I also read `checkCodeowners` (`check-workflow-policy.mjs:891-909`).
- **Ignore probe.** `git archive e3cdb94` of `eslint.config.mjs`, `tools/eslint-rules`, `tools/lint` and the tsconfigs into scratch, with `node_modules` junctioned to the main checkout's. `ESLint#isPathIgnored` was run for 17 paths: 8 anchored output paths (positive controls) and 9 deep or case-variant source paths.
- **Lockfile.** A leaf-level JSON delta-equivalence script compared `delta(base → R2 head)` with `delta(main → head)`. Positive control: `delta(base → main)` differs from the PR delta.
- **React Router typegen.** Read `@react-router/dev` 8.5.1, the lockfile version: `cli/index.js:98-106` (`hasReactRouterRscPlugin` → `vite.resolveConfig({ configFile: flags.config, root })`, which loads `vite.config.ts`) and `:300-322`; and `typegen-CqlAVM2O.js:95-107,273,345` (the config loader evaluates `react-router.config.ts` and `app/routes.ts`).
- **Lane A.** Run 43342155742 on `e3cdb94`:
  - `fast-lane` succeeded in every step, including lint, type-check, unit tests, the base-ref lint fixtures in no-weakening mode, the lockfile, cooldown, licence, signature and audit steps, and the build porcelain check.
  - `scans`: Gitleaks and Semgrep succeeded.
  - Only the record step failed (`RANGE_BASE` `99ea21f`), plus the `ci-gate` aggregate. That failure is what this record fixes.
- **Not done.** No suite was run locally. The registry signature and advisory checks were not repeated: the tuples are byte-identical to round 2's, and lane A's signature and audit steps are green.

### R3.3 Earlier findings at `e3cdb94`

| ID | Severity | Status at `e3cdb94` | Evidence / residual |
|---|---|---|---|
| PR4-SEC-10 | LOW | **Closed** | `eslint.config.mjs:410-414`, `.stylelintignore:25-36`, `negative-fixtures.test.ts` (`ESLINT_IGNORED` +5 rows, `STYLELINT_IGNORED` +4 rows), `lint-fixtures.mjs:130-135,145-148`, `gitignore.test.ts:59-61`. Probe in R3.5 #3 |
| PR4-SEC-11 | LOW | **Closed** | `.github/CODEOWNERS:51-52`; `check-workflow-policy.mjs:874-875` (`REQUIRED_CODEOWNED_PATHS`); `check-workflow-policy.test.ts:372`. Hardening item 2 (generic `jest.config.ts` reference-ownership test) → TASK-015 |
| PR4-SEC-12 | INFO | Open, TASK-014 | Templates unchanged since `d2e867b` (tree-equal) |
| PR4-SEC-02 | LOW (latent) | Open (latent), TASK-014 | Unchanged |
| PR4-SEC-06 | INFO | Tracked (TASK-022 / TASK-111) | Unchanged |
| PR4-SEC-08 | INFO | Partly closed; residual (a)-(d) TASK-015 / orchestrator | Unchanged; `tools/deps` not touched |
| PR4-SEC-09 | INFO | Report-only | Unchanged |
| PR2-SEC-09, PR2-SEC-03 TS-only block | LOW | Open, TASK-022 | Not taken here (as routed in R2.8) |

The interim per-PR check for `tools/test-dom/` and deep `test-results`/`playwright-report` folders (R2.8) ends once this PR merges, because both controls are then on `main`. At `e3cdb94` no tracked path sits under `test-results/`, `playwright-report/` or `__mocks__/` at any depth, and there is no `.swcrc` (the PR17-SEC-01 and -09 watch items).

### R3.4 New finding

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR4-SEC-13 | `npm run lint` and `npm run typecheck` first run `npm run typegen`, which executes unowned head code in the lane A job before ESLint and `tsc` read their owned configuration | INFO | CWE-693 | A08 | `package.json:29,32,33`; `apps/{web,admin}/package.json:10`; `@react-router/dev` `cli/index.js:98-106`; `ci.yml:222-235` | **TASK-015** (lane A gate isolation, with PR10-SEC-17 and PR17-SEC-08); architect for the ADR-0023 wording | Open |

#### PR4-SEC-13: unowned code runs inside the lint and type-check steps (INFO)

**Description.** Since `d2e867b`, root `lint` is `npm run typegen && eslint … && stylelint … && node tools/lint/check-suppressions.mjs`, and `typecheck` is `npm run typegen && tsc -b`. Root `typegen` is `npm run typegen --workspaces --if-present`. Under `ignore-scripts`, npm still runs explicitly named scripts, so the following execute first:
- every workspace's `typegen` script, from an unowned `package.json`. Today that is `react-router typegen` in `apps/web` and `apps/admin`, but any workspace (`packages/*`, `tests/*`, `prisma`) can add one;
- for each React Router app, `vite.resolveConfig`, which bundles and runs `vite.config.ts` and its plugins, and then the config loader, which evaluates `react-router.config.ts` and `app/routes.ts`.

None of these paths is in CODEOWNERS. Code there runs in the `fast-lane` job, in the checked-out workspace, before ESLint loads `eslint.config.mjs` and `tools/eslint-rules`. A change could rewrite those files or the plugin code in `node_modules` and then restore them during the later `typecheck` typegen. Lint would then pass for chosen source files, while:
- the base-ref fixture step (which runs after the restore) passes;
- the porcelain gate (which ignores `node_modules`, and runs after the restore) passes;
- the security-owned-paths check sees no owned path changed.

**Exploitability and impact.**
- **This is not a new capability.** Lane A already runs unowned head code before lint: `deps:rebuild` runs `prisma generate` (`rebuild.mjs:96-103`), which loads the unowned root `prisma.config.ts`. The class has existed since TASK-003. PR #4 widens the set of files that can carry it and adds a per-workspace injection point.
- The precondition is a deliberately malicious change in a private, single-owner repository. Every PR also gets a security review that reads the diff. Likelihood L.
- Impact M: the lint rules are cited as security mitigations (R2.4, PR4-SEC-10).
- So the class is LOW (M×L), and this PR's increment is **INFO**.

**Remediation (TASK-015; none is required in this PR).**
1. Add a porcelain gate straight after the `Lint` step, before `Type-check` runs `typegen` again. It catches a typegen-phase rewrite of tracked files (owned configs, `tools/eslint-rules`), because only owned code runs after ESLint inside `npm run lint`.
2. Narrow the injection point. Make root `typegen` call the CLI directly, `npm exec --no -w apps/web -w apps/admin -- react-router typegen`, so that unowned workspace `package.json` scripts no longer run in the lint and type-check steps. Extend the lint wiring test to pin that exact string.
3. Consider CODEOWNERS lines for `/prisma.config.ts` and `/apps/*/vite.config.ts`. The Vite config also carries the PR4-SEC-01 `envPrefix` control, which decides which variables reach the public bundle.
4. Record the residual in ADR-0023's lane A notes: "fast-lane gates see the workspace after head code from `prisma.config.ts` and the React Router config/route modules has run". The real boundary for the `node_modules` variant is the security review of every PR.

**Verification test.** For item 1: a lane A fixture whose `typegen` script appends a rule override to `eslint.config.mjs` fails at the new porcelain step. For item 2: the wiring test rejects `npm run typegen --workspaces` in the root script. **Interim:** security-analyst flags, in every PR diff, changes to any workspace `typegen` script, `apps/*/{vite,react-router}.config.ts`, `apps/*/app/routes.ts` or `prisma.config.ts` that add file-system writes, child processes or network access.

### R3.5 Results by focus area

| # | Focus | Result |
|---|---|---|
| 1 | `jest.config.ts` resolution (`8d5a4ac`) | **Clean.** The PR's added and removed lines against `main` (+25/−6) are identical to round 2's against its base. Every line added by either side is present at the head (line-carry: 0 missing on both sides; nothing `main` removed returns). `common.transform` = `['@swc/jest', SWC_JEST_OPTIONS]` with `swcrc: false`, `tsx: true` and the automatic React runtime. `unit-dom` (`...common`) overrides only `testEnvironment`, `testEnvironmentOptions`, `testMatch`, `testPathIgnorePatterns`, `setupFilesAfterEnv` and `moduleNameMapper`, so it inherits the transform. `tools/ci/jest-transform.test.ts` asserts `project.transform` equals that tuple for **every** project, and lane A's unit step ran it green on this head. `tools/lint/jest.base-fixtures.config.json` (`main`, unchanged) carries the same options. `modulePathIgnorePatterns` is unchanged, and there are no `__mocks__` (PR17-SEC-09 watch) |
| 2 | `negative-fixtures.test.ts` resolution | **Clean; nothing weakened.** `git diff 99ea21f e3cdb94` on the file is +16/−1. The one removed line is the test title, which is widened, and no `main` assertion is removed. The PR #4 lint-wiring assertions are re-expressed in `main`'s PR17-SEC-04 structure. **(a)** `/^npm run typegen$/u` is the first `LINT_STEPS` entry (end-anchored). Exact mode requires the 4 steps in order. No-weakening mode (base copy against the head) still requires every base step, in order. **(b)** `expect(steps[2]).not.toContain('--allow-empty-input')` became `expect(steps.filter((s) => s.includes('--allow-empty-input'))).toEqual([])`, which is stricter because it covers every step, and it runs in both modes. Counts equal `main`'s: `TENANT_DB` 2, `WARNINGS` 6, `bad-prisma-import` 1, `MODE === 'exact'` 6, `expect-affected` 6. The PR #18 split (the `error` halves always run, the `off` halves exact-only) is untouched. Lane A ran `main`'s copy in no-weakening mode against the head configs, and it passed |
| 3 | `eslint.config.mjs` union and PR4-SEC-10 | **Clean.** The net diff against `main` is +13/−0. It holds only the 3 anchored ignore globs with their comment (they replace round 2's 2 unanchored globs, which never reached `main`) and round 2's exact-file `routes.ts` `no-extraneous-dependencies` override. The `prisma-seed` category (2 occurrences) and every PR #18/#19 block are intact. **Probe:** `ESLint#isPathIgnored` on the head config gave 17/17 as expected. Ignored: `playwright-report/x.js`, `test-results/x.js`, `tests/e2e/test-results/x.js`, `tests/e2e/playwright-report/trace/x.js`, `apps/web/test-results/x.ts`, `packages/ui/playwright-report/x.ts`, `prisma/test-results/x.ts`, `dist/x.js`. Linted: `apps/api/src/modules/quotes/test-results/a.ts`, `packages/authz/src/playwright-report/a.ts`, `tests/e2e/support/test-results/a.ts`, `prisma/seed/test-results/a.ts`, `tools/test-results/a.mjs`, `tools/ci/playwright-report/a.mjs`, `apps/web/app/routes/test-results/route.tsx`, `apps/web/app/playwright-report/a.tsx`, `apps/api/src/Test-Results/a.ts`. These decisions match `.gitignore` path for path |
| 4 | CODEOWNERS and PR4-SEC-11 | **Closed.** One added line, in the "test, type-check and commit-message configuration" block. No line was removed or reordered, so last-match-wins changes nothing for other paths. The policy finding fires if the line is dropped. The remaining residual (`checkCodeowners` checks coverage, not last-match precedence) is the existing PR10-SEC-20 INFO |
| 5 | `package.json` and lockfile | `package.json`: the PR's added and removed lines against `main` are identical to round 2's (`typegen`, `lint`, `typecheck`, `build` + `size`, `test:unit` with `unit-dom`, 2 exact devDependencies). Lockfile: 64 = 64 leaf changes, 0 differences. 8 added entries, all `registry.npmjs.org`, dev-only, no install script, licences MIT, Apache-2.0 or MPL-2.0. `tests/e2e` is the only changed entry; there are no removals. Positive control: 2 differing leaves |
| 6 | Workflow levers (D-ORCH-021) | **None changed** (R3.1). The PR's net change under `.github/` is CODEOWNERS only |
| 7 | Fix commit `05dfe7e` | Test-only: unmounts the `hydrateRoot` root that RTL's cleanup does not track. No security impact |
| 8 | Owned-path overlap with current `main` | `git diff --name-only 99ea21f origin/main` (`21bf127`: agent memory, `docs/01-requirements`, `docs/05-quality/reviews/PR-0004…`, `docs/05-quality/security/PR-0020…`/`PR-0021…`, `docs/sdlc`) has no CODEOWNERS-owned path. The overlap with the PR's net change is empty, so this record is not voided by `main` as it stands |
| 9 | Secrets | Lane A's Gitleaks (PR range `99ea21f..e3cdb94`, first parent) is green. The fix commits add only paths, globs, test rows and comments. Nothing secret-shaped was added, and this record quotes no flagged value |

### R3.6 Follow-ups routed

| Owner | Item | Finding | Binding? |
|---|---|---|---|
| **TASK-015** | Porcelain gate after `Lint`. Root `typegen` via `npm exec --no -w apps/web -w apps/admin -- react-router typegen`, pinned by the wiring test. Consider owning `/prisma.config.ts` and `/apps/*/vite.config.ts` | PR4-SEC-13 | Yes (with PR10-SEC-17 / PR17-SEC-08) |
| **TASK-015** | Generic test: every path that `jest.config.ts` references is CODEOWNED (hardening carried from PR4-SEC-11 item 2) | PR4-SEC-11 (hardening) | Yes |
| principal-architect | ADR-0023 lane A note: fast-lane gates run after head code from `prisma.config.ts` and the React Router config/route modules | PR4-SEC-13 | Yes (text) |
| security-analyst | Interim, per PR: flag workspace `typegen` scripts, `apps/*/{vite,react-router}.config.ts`, `apps/*/app/routes.ts` and `prisma.config.ts` changes that add file-system writes, child processes or network access | PR4-SEC-13 | Until TASK-015 |
| TASK-014, TASK-022, TASK-111, TASK-015, orchestrator | Unchanged from R2.8: PR4-SEC-02, -12 (TASK-014); PR2-SEC-09 and the PR2-SEC-03 TS-only block, `config/web` (TASK-022); PR4-SEC-06 wording and `gzip` (TASK-022/111); PR4-SEC-08 residuals (TASK-015, orchestrator) | various | As in R2.8 |

The R2.8 interim check for `tools/test-dom/` and deep output folders retires when this PR merges.

### R3.7 Evidence (commands; read-only, from the main checkout and scratch)

| Command | Result |
|---|---|
| `git fetch -q origin`; `git ls-remote origin` | `refs/pull/4/head` = `refs/heads/feat/TASK-004-web-admin-app-scaffolds` = `e3cdb944b2be…` (re-checked before hand-off); `origin/main` = `21bf127` |
| `git log --first-parent d2e867b..e3cdb94`; parents | `8d5a4ac` = (`d2e867b`, `80ff2c2`); `e3cdb94` = (`05dfe7e`, `99ea21f`) |
| `treecmp.mjs 22eccb2 d2e867b 99ea21f e3cdb94` | 1,424 paths; 1,412 match; 5 overlaps; 7 deviations = the fix-commit paths; control 87 |
| `git merge-tree --write-tree d2e867b 80ff2c2` vs `8d5a4ac^{tree}` | Conflicts in `jest.config.ts` and `negative-fixtures.test.ts`; those 2 files differ; everything else is equal (including the auto-merged `eslint.config.mjs`) |
| `git merge-tree --write-tree 05dfe7e 99ea21f` vs `e3cdb94^{tree}` | Clean; identical |
| `linecarry.mjs` over the overlap files | `jest.config.ts`, `package.json`: 0/0/0. `eslint.config.mjs`: 3 R2 lines missing (the unanchored globs; intended). `negative-fixtures.test.ts`: 3 R2 lines restructured (R3.5 #2), 1 `main` title widened, 26 "returned" lines all present in `main` (moves) |
| `git diff --numstat 99ea21f e3cdb94 -- <overlap files>` | `negative-fixtures.test.ts` +16/−1 (the widened title); `eslint.config.mjs` +13/−0; `jest.config.ts` +25/−6, with the same added and removed lines as round 2; `package.json` lines identical to round 2 |
| `lockdelta-eq.mjs 22eccb2 d2e867b 99ea21f e3cdb94` | 64 / 64 leaf changes, 0 differences; control 2 |
| `ignore-probe.mjs` (head `eslint.config.mjs`, `ESLint#isPathIgnored`) | 17/17 as expected |
| `git ls-tree -r e3cdb94` grep for `test-results/`, `playwright-report/`, `__mocks__/` and `.swcrc` | None |
| `git diff 99ea21f e3cdb94` and `origin/main…e3cdb94` over `.github/workflows`, `.github/actions` and the other lever files; grep of the net diff for lever names | Empty; no match |
| `git diff --name-only 99ea21f origin/main` ∩ CODEOWNERS | Empty |
| `gh run view 43342155742` | `fast-lane` success; `scans`: Gitleaks success, Semgrep success, record step failure (`RANGE_BASE` `99ea21f`); `ci-gate` failure (record only) |
| Record check (main's `tools/ci/check-security-owned-paths.mjs`, scratch `git clone --shared`, this record committed on top of `e3cdb94`) | See R3.8 |

### R3.8 Record-check simulation

Script `scratchpad/review/PR-4-sec-r3/scripts/record-sim.sh` (session scratch):
- `main`'s `tools/ci` was extracted with `git archive origin/main`.
- Each case ran in a fresh `git clone --shared --no-checkout` of the main checkout, detached at `e3cdb94`, with the record committed on top.
- The CLI was `--root <clone> --base <base> --head HEAD --pr <n> --json`. The base was `origin/main` (`21bf127`, docs-only past `99ea21f`) unless stated otherwise.
- Each clone was removed afterwards; nothing was written to the main repository's `.git`.

Owned set (17): `.github/CODEOWNERS`, `.stylelintignore`, `apps/{admin,web}/tsconfig.json`, `eslint.config.mjs`, `jest.config.ts`, `package-lock.json`, `package.json`, `packages/ui/tsconfig.json`, `tests/e2e/tsconfig.json`, `tools/ci/check-workflow-policy.{mjs,test.ts}`, `tools/lint/lint-fixtures.mjs`, `tools/lint/negative-fixtures.test.ts`, and `tools/test-dom/{dom-setup.ts,jsdom-environment.mjs,style-stub.ts}`. The last 3 count through the head's CODEOWNERS line, which is the PR4-SEC-11 fix working.

| Case | Expected | Result |
|---|---|---|
| This record (rounds 1-3), `--pr 4`, base `21bf127` | pass | **`pass`**, exit 0. `satisfiedBy` = this record @ `e3cdb944b2be0decf7bb54f8885b97a393ea8051`. Notes only: the older head rows (`519bb89`, `b67eb36`, `d2e867b`) are voided by later owned changes |
| This record, `--pr 4`, base `99ea21f` (lane A's last `RANGE_BASE`) | pass | **`pass`**, exit 0; same `satisfiedBy` |
| Control: round-2 record (as on `e3cdb94`), `--pr 4` | missing | `missing`, exit 1. The `d2e867b` row is voided by the owned changes since |
| Control: this record, `--pr 17` | missing | `missing`, exit 1 (`PR-0017-TASK-007-security-review.md` names no commit of this PR) |
| Control: this record plus a later commit that edits the owned `jest.config.ts`, `--pr 4` | missing | `missing`, exit 1 ("names e3cdb94, but jest.config.ts changed after it": rule (d)) |
