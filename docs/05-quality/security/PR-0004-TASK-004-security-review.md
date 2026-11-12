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
