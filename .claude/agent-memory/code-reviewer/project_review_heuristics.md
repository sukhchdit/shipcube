---
name: review-heuristics
description: Recurring defect patterns found in this repo's P5 reviews, each proven by a cheap experiment, to check in every new diff
metadata:
  type: project
---

These patterns were confirmed in PR #3 (TASK-005, 2026-11-12) with small scratch tsx scripts, each under a minute to run:
- **Timeout passed but not enforced.** A port takes an `AbortSignal` and the orchestrator just awaits the provider. Test it with a provider that returns `new Promise(() => {})`. The fix is to race the provider against the abort.
- **Node flag guards.** Node accepts `_` for `-` in option names (`--inspect_brk`) and un-quotes NODE_OPTIONS. Regex guards on `--inspect*` need normalisation first.
- **Substring placeholder patterns** such as `<…>` or `changeme` give false positives on real punctuated secrets (the Secrets Manager charset). Placeholder checks should match whole values or whole URL components.
- **Joi/Zod.** Brief §3.3 says Zod on the frontend, Joi on the backend, with the limits and regexes shared plus a parity test. Flag backend code that calls Zod at runtime.
  - Sharing only *limits* is not enough. Joi `.uri()` (an RFC 3986 regex) and Zod `z.url()` (WHATWG `URL`: trims, lower-cases the scheme) disagree on `HTTPS://`, spaces, `http:host`, `"<{|^`, IDN hosts and ports > 65535.
  - Joi `.max()` counts UTF-16 units; Zod 4 counts code points (`'😀'.repeat(21)` passes Zod max 40).
  - Run a differential script with adversarial vectors (PR #3 r2: 16 of 30 diverged). Ask for shared *predicates* plus a fast-check differential property.
  - Once predicates are shared (PR #3 r3), only the wrappers can drift: trimming, returned value, rule id, and the shape of `missing` issues. Check that the property compares the rule id as well as the verdict. Run a loader-level differential on whole issue arrays (20k cases in about 1 min) and sed-mutate each wrapper.
- **Import-graph tests** that follow only `./` specifiers and deny-list a package miss package self-reference (`@platform/x/sub` via `exports`) and `#imports` aliases. Ask for an allow-list of externals.
- **Lint-driven merge-main fixes** (new TASK-002 rules) usually do three things:
  - drop casts (`no-unnecessary-type-assertion`). Check whether the target type accepts `undefined`; if so, the guarantee now lives only in a guard in another function (PR #5 R3-n2).
  - turn `async` fakes into `Promise`-returning ones (`require-await`). Check that a throw still becomes a rejection and that callers await.
  - add config-scoped rule `'off'` blocks. Ask what else the tree-wide relaxation now permits.
- **Parallel batch PRs** each add env keys (prisma.config, db client, vite import.meta.env). The `.env.example` and compose.env parity tests reject unknown keys, so always list the key gap and who reconciles it.

**Why:** each of these passed the author's own tests, because the tests used cooperative fakes.
**How to apply:** check every config, guard, secret or timeout diff against this list. See [[review-watchlist]] and [[scratch-copy-technique]].

**Docs/spike PRs (PR #6, 2026-11-12).** Re-read the cited sources yourself (gh api for GitHub, curl for raw spec YAML into the scratchpad). Do three things:
- Check whether a cited third-party source holds *more* evidence than the author used. PR #6 cited an SDK README, but the SDK source had the "unverified" paths.
- Test every "use library X for Y" premise against the installed library's code (pdfkit image sniffing).
- Check that recommended options are mapped to the REQ that consumes them, not only the capability REQ.
Host allow-lists are host-based (REQ-SEC-010), so carriers sharing a host across sandbox and production need path/env binding.
Round 2 of a spike PR (PR #6 r2):
- Re-read the *decided* path's schema for self-contradictions. Example: the UPS Label Recovery `Code` has minLength 4, but `PDF` is 3 characters.
- Path-prefix allow-list entries without a trailing `/` need segment-boundary matching.
- npm `time.modified` is not a release date; use `time[dist-tags.latest]`.
- Requirements (US AC) that land on main after the PR head can rename required README headings. Grep main for the literal strings a future docs-check will parse.

**Timing assertions in required suites (PR #7, 2026-11-12).** Wall-clock p95 deltas asserted in `*.int.test.ts` run on every `test:integration`. Heavy suites run on the contended local host (D-ORCH-001). When headroom is only about 2× and the doc itself records run-to-run swings, require an opt-in env flag; the doc table is the record. Lower-bound timer checks (e.g. `>= 1900` for a 2000 ms maxWait) are fine.
**Pool reset.** `@prisma/adapter-pg` `commit()`/`rollback()` only call `client.release()`, with no DISCARD/RESET. Any session-level `SET` leaks to the next checkout. Check every DB-context diff for session-level settings.

**Authz guards (PR #8, 2026-11-12):**
- Invariants keyed on a free-text field of the guarded data (such as `category`) are bypassable. Probe by re-categorising a write permission and granting it.
- Generators that write a migration path keyed by an unchanged version number rewrite applied migrations in place. Ask for a content pin per released version.
- Segment-position verb rules ("verb = last segment"): probe a NEW verb in the middle segment with a read qualifier (`res:purge:read`). A deny-list built from the catalogue's own verbs misses it (PR #8 r2, R2-m1); ask for a declared sub-resource allow-list.
- Raw-byte content pins: check `git ls-files --eol` (needs the `eol=lf` attr) and prove a CRLF copy fails CLOSED. Note when the pin lives beside the thing it pins.
- Check every "read-only role" rule against self-service routes (`/me/sessions`), because ASVS V3.3.4 needs session list and revoke for every user.

**Opt-in gates and the docs downstream of them (PR #7 r2, 2026-11-12).**
- When a fix moves a check behind an env flag, grep the plan sheet (WAVE-*.md / plan-data.mjs) and the ADR text that consume it. Plan lines written before the fix often say "runs in job X" without setting the flag. The job then silently skips the check and still reports success.
- ADR controls must be enforceable by the engine. Placeholder `app.*` GUCs are USERSET: PostgreSQL cannot deny a role from setting them at session level, and `GRANT SET ON PARAMETER` does nothing for USERSET parameters. A "prove X cannot be set" control is therefore infeasible; the control is a lint/Semgrep token ban plus a negative control that proves the leak.
- Fixed claims come back. A finding corrected in the spike doc (for example, "existing lint rule") can reappear in an ADR amendment that was drafted from the pre-fix SHA. Diff the claims in each amendment against the fixed doc.

**Runtime/HTTP skeleton patterns (PR #9, 2026-11-12):**
- **"First call" is not "fresh connection".** Any check that is stricter at start-up but runs lazily through a shared pool will meet connections that earlier work already used. Probe it with a fake pool whose first row is the post-use state. Also check whether a failing result is cached for the whole re-check interval, which makes it sticky.
- **Classifier allow-lists keyed on `type`.** body-parser wraps zlib errors as `status: 400` with no `type`, so a corrupt `Content-Encoding` body becomes a 500. Probe with real HTTP (`fetch` against `app.listen(0)`), because supertest mangles Buffer gzip bodies.
- **Public probes:** check for single-flight or TTL, and for whether they share the request DB pool.
- **Express 5 `app.listen(port, cb)`:** cb is also the once-`error` listener.
- **Problem handler:** check for `Cache-Control: no-store` and that headers set before the throw are stripped.
- `git diff` covering `.env.example` is blocked by a permissions deny rule. Diff the other paths explicitly.
- **Fix cycles add hand-written parsers. Time every new regex on adversarial input (PR #9 r2, R2-B1).**
  - The killer shape is an optional group with the same quantified class on both sides of a separator: `(?:\s*;\s*(?:param)?)*\s*$`. Input `';  '`×20+`'!'` stalled for 100 s.
  - Also check whether an earlier gate rejects the input. Here `type-is` accepted it.
  - Prove it end to end over `app.listen(0)` with an event-loop gap sampler.
  - Fix: put the OWS inside the optional group. Prove it with a random-string differential against the old regex.
- **Verifying a regex fix (PR #9 r3):**
  - Run an exhaustive differential against the old regex (every string of length ≤ 8 over a 6-character alphabet is about 2 M strings, in seconds) as well as a random one.
  - Re-insert the old regex as a mutation: synchronous regex tests *hang*, they do not fail (Jest timeouts cannot interrupt them), so run them under `timeout 45`.
  - Mutate the order of the guard checks too; order is often unpinned.
- **Two allow-lists for one value** (a config guard and a driver adapter) drift. After names are single-sourced, probe the *values* as well with a `loadConfig` × runtime-factory matrix (PR #9 r3). Probe that every value the config accepts is also accepted at runtime, or the failure arrives as exit 1 with a stack, not exit 78.

**CI gate / supply-chain checker patterns (PR #10, 2026-11-12).** Each was proven by a probe of under a minute.
- **npm boolean flags take a bare `true`/`false` as their value.** `npm ci --ignore-scripts false` sets the flag to false, and the CLI value beats both env and `.npmrc`. Regex guards that only know `--flag=false` / `--no-flag` miss it. Probe: `npm config get ignore-scripts --ignore-scripts false`.
- **Install-command regexes must come from npm's alias table** (`node_modules/npm/lib/utils/cmd-list.js` `aliases`). For example `clean-install`, `ic`, `cit`, `it`, `sit`, `ins`, `isnt`.
- **Gitleaks v8 always loads `<source>/.gitleaksignore`** (`cmd/root.go`) and honours `gitleaks:allow` unless `--ignore-gitleaks-allow` is passed. A "config from the base ref" claim is therefore not enough; check the ignore file and the allow comments.
- **Every "base-ref" claim:** list what the base-run tool still reads from the HEAD (ignore files, registers, test harness, jest config).
- **In-house YAML parsers:** probe lone CR, NEL and U+2028 inside a comment line. libyaml-family parsers break the line there, so the hidden content is invisible to the checker. Prettier catches only the lone CR.
- **`git diff --name-only` reports only the new path of a rename.** Ownership or record checks need `--no-renames`.
- **A "record names reviewed SHA, nothing changed since" check** breaks on merge-main. Intersect with the PR's own net owned paths.
- **Verify process premises against repo settings** (`gh api repos/<r>`): squash title (`COMMIT_OR_PR_TITLE` uses the commit subject for single-commit PRs), allowed merge methods. Branch protection returns 403 on private free-plan repos, so "required check" claims are not enforceable.

**Round-2 patterns from PR #10 (2026-11-13):**
- **"Every install" means every reify.** `update`, `dedupe`, `uninstall`, `link` and `audit fix` call Arborist `reify()` and run the install scripts of added nodes.
  - Check guard scope against the commands in `lib/commands/*.js` that call `reify(`, not just the install aliases.
  - A bare-flag value can be a shell expansion (`--ignore-scripts $X`).
- **Ground-truth npm flag parsing:** `NPM_CONFIG_IGNORE_SCRIPTS=true npm config get ignore-scripts <form>`. Put the key positional FIRST, because extra positionals print `X=undefined`.
- **Self-policing workflow rules** (required steps, mount rules, job isolation) are tripwires. Mutate the repo's own ci.yml in memory and run `checkWorkflow`:
  - `|| true`;
  - redirecting `GATE_*` to the head;
  - `--mount`/`$PWD` mounts;
  - `--exit-code 0`;
  - relative `node x.mjs`.
  Ask for anchored patterns, and for the claims to be worded as tripwires.
- **Expression-injection allow-lists:** `env.*` (and `steps`/`needs` outputs) launder untrusted input, because `${{ env.T }}` is expanded into the script text.
- **Semgrep ≥ 1.117 (Semgrepignore v2) honours nested `.semgrepignore` files.** Bind-mounting the base root file does not fix scope narrowing. Check the tool's CHANGELOG at the pinned tag (`gh api …/contents/CHANGELOG.md?ref=vX -H "Accept: application/vnd.github.raw"`).
- **`.gitattributes -diff` hides content from `git log -p`** (and so from gitleaks) when the worktree is mounted. With only `.git` mounted, attributes are not read (verified with git 2.52). Local git reproduces it in seconds, no Docker needed.
- **Record-format contracts** ("last Verdict table row wins") silently ignore a later FAIL written as prose. Tell the security-analyst to always append a header table.

**DB-guard patterns (PR #11, 2026-11-12):**
- **Guard the RETURN values too (PR #11 r2).** Prisma 7 `PrismaPromise` has an internal `requestTransaction(tx)`. Passing `null` or `{kind:'batch'}` runs the query on the ROOT client, outside the itx. Probe it with the PR's recording driver adapter (it logs ROOT vs TXn per statement).
- **First-argument checks miss values.** A `Prisma.raw` passed as a tagged-template *value* is spliced into the SQL. Lint must resolve aliases: `Prisma as P`, `{ raw } = Prisma`, `r = Prisma.raw`.
- **Check the ESLint twins of SQL form lists** for the quoted and spaced `SET "app"."x"` forms.
- **Prisma client Proxy guards.** Prisma 7 clients and delegates carry the public `$parent` property (the extension context), the internal `_originalClient` and a private `Symbol()` key holding the unapplied client. A top-level deny-list misses all three. Probe on the real shape without a DB: `new PrismaClient({adapter: new PrismaPg({connectionString:'postgresql://x@127.0.0.1:1/x'})})._createItxClient({id:'t'},0,{})`.
- **Regex "literal exemption" scans** (for example "set_config allowed when the first arg is a non-app literal") are beaten by `'' || 'app.x'`. Require a complete literal followed by `,`. Also check quoted-identifier forms (`"app"."x"`).
- **Catalog ACL equality via `aclexplode`.** Check whether PUBLIC (`grantee = 0`) and inherited privileges are excluded. Effective privilege is what matters.
- **New lint boundaries in one PR vs another open PR.** Run `git merge-tree` and grep the other PR's files for imports and string tokens the new rules ban. Semantic lint conflicts are not textual conflicts.

**Guard round 3 (PR #11 r3, 2026-11-13):**
- **Wrapped thenables:** check own keys (only then/catch/finally/toStringTag), null proto + frozen, laziness (no statement before await), a `closed` check BEFORE calling the inner `then`, and that `then` is a closure-free arrow. Mutate: unwrap, drop the closed check.
- **Composition-time refusals** (`PGOPTIONS` etc.) thrown from top-level setup give exit 1 + stack, not the config exit 78. Probe where the throw lands.
- **SET-based SQL rules** (rule 11 lock_timeout) miss `set_config('<guc>', v, false)` when the tenant rule exempts non-app literal keys.
- **Lint twins:** after a drift test pins some forms, check the forms it does NOT pin (U&, comment stripping) against the SQL lanes.
- **Scope-analysis lint:** probe container laundering (fn arg, object/array, spread, ternary, `import().then`); fine when a run-time guard backs it, but the JSDoc must not overclaim.

**DB spike PRs (PR #12 SPK-08, 2026-11-13):**
- **Spike exit lists live in several places.** The sheet's acceptance is a subset. Also grep `risks.md` R-ARCH-xx (the full exit list), `rulings/*.md` ("routed → TASK-xxx") and the data-model "verify in P5 spike" notes. Routed questions get dropped silently.
- **Refusal-branch coverage per event type.** When privilege stops every tamper statement first, the guard's second-layer branches (e.g. `sql_drop`) are never exercised. Ask for a test as a role that HAS the privilege: the schema owner via superuser `SET ROLE`, or the superuser itself.
- **Spike suites vs the real files.** The harness applies the whole `prisma/bootstrap` dir. A spike that re-creates objects the real bootstrap will own breaks the day the real files land. The lifecycle deadline is the PR that adds the real files, not the later "porting" task. PR #12 r2 accepted an alternative: the suite bootstraps a filtered temp copy (`0N-*.sql` only), so it survives until the porting task.
- **"Evidence" in an optional JSON report is not an assertion.** Look for `if (status !== 0)` branches and negative regexes over possibly-empty output. Recompute published golden vectors yourself; it takes about a minute in Node.
- **"Re-created in the same file" lint rules** (PR #12 r2): check that the re-create must carry the lost feature (`WHERE`, `INCLUDE`). Otherwise the rule passes the exact silent-downgrade it targets. Accepted fix for vacuous negatives: a positive `toContain` next to each one, plus a probe-touched proof such as a catalog read.
- **"Verbatim from spec" claims:** extract the spec's code fences with awk, normalise whitespace and comments, and `diff`.

**CLI / tooling DB clients (PR #13, 2026-11-13):**
- **pg `Client` with no `'error'` listener.** On connection loss pg emits `'error'` even while a query is pending (`_handleErrorEvent`). With no listener the process crashes with exit 1 and a raw stack, which breaks any exit-code contract.
  - Probe: a `net.createServer` fake. Write `R 00000008 00000000` + `Z 00000005 I` after the startup packet, then `socket.destroy()` on the first `Q` byte (0x51).
- **pg merges `parse(connectionString)` OVER the config object.** `?options=…&statement_timeout=0` in the URL beats `options:`/`statement_timeout:` set in code. Check every "pinned session" claim for an `options=` refusal plus a post-connect `SHOW`.
- **Framework PRs with an empty registry** (datasets added "by later tasks"): test the contract against every consumer row of the spec table. Look for:
  - FK ids when `id` is reserved;
  - `NULLS NOT DISTINCT` keys;
  - partial unique arbiters;
  - columns that are insert-only or runtime-mutated (counter resets).

**Drift = edit OR delete (PR #13 r2, 2026-11-13).** When a fix adds "report/log drift restoration", check that BOTH counters trigger it: an upsert reports a hand-DELETED row as `inserted`, not `updated`. With an unchanged version/hash any insert is a restoration. Probe `runDataset` with a fake returning `[{inserted:true}]` and the matching version row.
**Subset / "no-weakening" checks (PR #17, 2026-11-13).**
- Ask which *extras* are themselves weakening evidence. ESLint `reportUnusedDisableDirectives` turns "rule X stopped firing" into a `ruleId: null` extra; probe by turning off a rule that a fixture only *disables* (`no-explicit-any`).
- Positive assertions hide inside "weakening" tests (`toBe('off')`, `toEqual` on ignore maps, `not.toContain`); a strengthening PR fails them.
- Jest filter deny-lists: Jest accepts kebab-case (`--test-name-pattern`), attached `-tX`, `--listTests` (exit 0, runs nothing), and `onlyChanged`/`lastCommit` (exit 0 with no tests). The head `jest.config.ts` `testNamePattern` skips everything with exit 0. Ask for an allow-list of the exact invocation.
- A "rule stopped firing" signal can depend on another config switch: unused-directive reports need `linterOptions.reportUnusedDisableDirectives`, and reportUnusedDisableDirectives can be turned off together with the rule. Probe both switches at once, and ask for a direct fixture or effective-config check (PR #17 r2, R2-m1).
- Exact command pins that trimEnd lines differ from bash on backslash + space/tab (bash does not continue the line). Ask whether the divergence fails closed; check with a 3-line bash script.
- In pull_request workflows, job-level env such as RANGE_BASE is head-controlled. Pointing it at the head makes every "from the base ref" input head-sourced: the gate tooling, the checker itself and the record-gate range. No base-side pin can close this. Flag it as architectural (PR10-SEC-02).

**Moving files to dodge a CI step can de-own them (PR #4 r3, 2026-11-13).** When a PR relocates files out of a CODEOWNERS-owned folder (e.g. out of `tools/test-support/` to escape lane A's base-ref replace step), check that the new location is owned too. Jest testEnvironment/setupFiles referenced from an owned jest.config.ts are NOT covered by owning the config. Fix: a CODEOWNERS line plus REQUIRED_CODEOWNED_PATHS and its test. Do NOT accept a "robust" config that skips a project when its file is missing; that is a silent gate weakening.

**Client-side timeouts on pg CLIs:** `statement_timeout` is server-side; a blackholed network needs pg `query_timeout` + `keepAlive`.

**Supersede PRs that add a lint boundary category (PR #19, 2026-11-13).** In this eslint.config.mjs, boundaries categories are cumulative (a file gets every matching pattern; policies are last-match-wins). A new narrow category listed before a broad one (`prisma/seed/**` before `prisma/**`) keeps the broad one, so importer-side allow-lists (DATABASE_CODE, SQL_DRIVER_CODE) still match. Kill it three ways with `negative-fixtures.test -t '<area>'` (~1 min): add the broad category to the allow, drop the new one, widen the new pattern. Each must fail one fixture.
**Unmerged migrations edited in-PR:** stale comments become permanent once the migration is released (immutability check). Flag contradictions in the header before merge.

**Route/contract drift walkers and framework behaviours (PR #21, 2026-11-13).**
- **Express 5 stack walkers that `continue` on every non-router layer fail open.** `router.use('/path', handler)` serves requests but is neither a route nor a router. Probe: a module router with a path-mounted handler, then run `listMountedRoutes` + `checkContractDrift`. Fix: report non-router layers with `layer.slash !== true` as unrecognised.
- **"Mirror list" mount loaders** (a tool that re-states `createApp`'s composition) miss anything mounted directly on the app. Ask for a top-level `app.router.stack` assertion with explicit exclusions.
- **A new framework behaviour (e.g. OPTIONS 204 + Allow) must be mirrored** in the 405 `Allow`, the contract test helper and the contract stubs. Probe the PR's own helper against the PR's own app (`api(app).options(path)`).
- **A real-contract check with a pinned `now`** makes time-based rules (sunset passed) unable to fire on main.
- **Ajv implements OAS 3.0 `nullable` natively**, so strict mode accepts it. A typo keyword is still rejected.
- **"Literal mount" resolution by probe variants (PR #21 r2).** Substituting one segment rejects `/:param` and `/*rest`. It misses array mounts (router 2.x `layer.matchers` has one entry per path), optional groups (`{/:x}` in the middle or at the end; the matched `layer.path` grows), and root sub-apps (the handle is named `mounted_app`, has no stack and `slash` is true). Probe all of these with real HTTP.
- **A "redundant, subsumed" claim for a probe needs a counter-example search (PR #21 r3).** A surviving mutant is only dead code if no input reaches it: dropping the segment-substitution probe still passed 18 tests, yet it is the only guard for a leading param (`/:x/v1` resolves as `/api/v1`, and `/:x/docs` as the excluded docs mount). Also: RegExp `use()` paths are closures in router 2.x and cannot be told from strings; alternation regexes fail open. A sub-app on a Router is not wrapped as `mounted_app` (that is Application.use only).
- **A new fail-closed guard can break another open PR semantically.** Run the new walker or guard against the other open PR's composition (`git show <head>:apps/api/src/app.ts`), not just `git merge-tree`. Example: PR #20's path-mounted `routePrefix` against PR #21's R1-M1 fix.
- **ESLint `ignore` regexes for no-relative-packages** must be end-anchored or reject `..` segments. An unanchored prefix lets `apps/api/src/../../../packages/x` through. Probe with `lintText` and a filePath under the target folder; no file write is needed.

**Logging / redaction PRs (PR #20, 2026-11-13):**
- **New subpath of an allow-listed package.** `toPackage(x)` allow-lists expand to `x/**`, so a new server-only subpath (`@platform/shared/logging`) is importable by web/admin/pricing. Probe with the light lint probe plus positive controls.
- **"Native function" checks via `Function.prototype.toString` … `[native code]`** are passed by bound functions and Proxies. Compare by identity with the captured native (the V8 `stack` getter is one shared function).
- **PII filters as substring deny-lists** miss username/display_name/client_ip/dob/passport. Ask for a per-event allow-list from the catalogue's declared fields.
- **Redactor budgets:** caps per string × node cap can still give a huge line; time it (about 0.3 µs/char here). Free-text pair scanners: probe 4+ spaces, newline after the separator, multi-pair Cookie, `\"`-escaped JSON, IDN e-mail.
