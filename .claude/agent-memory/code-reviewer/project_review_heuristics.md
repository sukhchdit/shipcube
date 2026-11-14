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
- **Round 2 of a subpath guard (PR #20 r2):** direct-import fixtures are not enough. Probe the TRANSITIVE path: the allowed root barrel re-exporting the server-only folder (`export * from './logging/…'`) passes, because `barrel-reexport-only` allows re-exports. Ask for a policy from the package's own non-server files. Also probe `import()`, `export … from`, `createRequire`, `x/sub/path`, `pino/file`, `pino-*`, and build configs (react-router.config.ts).
- **PII key lists:** grep the project's own `openapi.yaml` for `*_name`/`*_ip` keys (`display_name`, `receiver_name`) and test them against the class. Generic lists miss domain keys. Never suggest a bare `ip` suffix (it matches `ship`, `relationship`).
- **Budgeted walkers:** `Object.keys(v)` before `slice(0, MAX_KEYS)` is uncharged. Probe 100 references to one 300k-key object (2 s). Budgets measured before JSON escaping, or excluding `err`, do not bound the line (quotes double it; a 50 KB line).
- **Free-text values that start with `[` or `{`** end at the first `,`, so the second array item leaks. Also probe PEM blocks and full-width keys (an ASCII-only key regex sees no key at all).
- **Round 3 of a redactor (PR #20 r3):** run a sentinel probe over every new pass PLUS the neighbours of its lead set (`|;{@` for a `(=:,[` target-lead set), double-escaped JSON, and an omitted key whose value is an object (`query: { a, b }` ends at first comma). Over-redaction from free-text omitted/suffix classes (`curl:` hits `url`) is fail-closed; rule it, do not block. Re-check the boundary policy carve-outs: `TEST_FILES` includes `{test,tests,__tests__}/**` dirs, so a module re-exporting `./test/x.js` is a two-hop bypass.
- **Flush-before-exit helpers:** test the premise with a real child process (pipe stdout, paused reader, 4 MB line, bare `process.exit` control) and count timer ticks between crash and exit. On Windows 11 / Node 24, `process.stdout` to a pipe was synchronous (control lossless); only TTYs are async. Also confirm a top-level ESM throw reaches `uncaughtException` (it does).
- **Semantic auto-merge traps:** `git merge-tree` shows the textual conflicts, but the CLEAN side may keep a line that a cross-PR ruling says to change (PR #20's `routes.use(prefix, mw, api)`). Print the merged function body and check every ruling line.

**Event-trigger DDL guards (PR #24, 2026-11-13).**
- `ddl_command_end` reports only the address a command returns. Side-effect objects with user-chosen names are invisible to an own-name match.
  - Known case: `CREATE TYPE r AS RANGE (multirange_type_name = x)` creates pg_type x. Proved: utility.c T_CreateRangeStmt → DefineRange returns the range type.
  - Already covered by the per-command reports or the PR12-SEC-02-a fix: identity sequences, constraint-backed indexes, EXCLUDE.
- Ask for a post-command catalogue INVARIANT (no non-owner object under the reserved names in protected schemas) rather than enumerating command forms.
- Probe it on PGlite (see [[scratch-copy-technique]]).
- Round 2 of a post-state invariant: rerun the SAME probe file against the OLD guard blob as the negative control (it should accept the bypasses), then against the new one. Plant pre-existing squats with the event trigger suspended (`ALTER EVENT TRIGGER … DISABLE` inside a rolled-back transaction) to test the "everything blocked while a squat exists" consequence. Also check whether each kind of squat can be DROPPED: a `sql_drop` name match can make relation, index and function squats undroppable.
- Operator-hijack readiness probes: a planted `public.=(oid, integer)` is only usable once it is GRANTed (functions lose PUBLIC EXECUTE by default privileges). Plant the operator BEFORE the squat, because an existing squat makes the invariant refuse the CREATE OPERATOR too.
- In JS `String.replace`, a replacement text containing `$f$'` expands `$'`. Pass a function replacer when editing SQL-bearing probe files.

**Contract-pipeline unions.** The api tests may keep their own copy of an app constant (contract-validation's CRITICAL list). A PR that changes the constant in the app passes on its own base and breaks on the merge. Always run the api project on `git merge-tree` output.

**Gate-tooling PRs that add a folder (PR #23, 2026-11-13).**
- A new tool folder that a base-ref CI step depends on must be CODEOWNED. Prove it with `node tools/ci/check-security-owned-paths.mjs --root . --base origin/main --head HEAD --pr <n> --json` and read `owned`: PR text, manifest `security_critical_paths` and docs all said "security-owned" while the list had no such paths. Same class as PR #4 R3-M1.
- Tripwire tests that `toContain` a command prefix miss an appended flag. Mutate the base-ref line with `--report-only` (the checker then always exits 0) and run `ci-policy.test -t "<name>"` plus `check-workflow-policy.mjs`.
- "A JUnit for a planned suite fails the check" can be implemented as "the run is rejected": the check still passes when nothing is required. Probe the all-planned manifest with a run holding those JUnits.
- A verifier that lazily loads a dependency (Ajv only when runs exist) is untested by CI. Probe the real CI shape: script copied outside the workspace with no node_modules above it, `--root` a repo with a `node_modules` junction.
- Squash merge + "git_sha is an ancestor of head": fine on pull_request, red on a push-to-main range. Check whether the step has an event switch like check-security-owned-paths.
- Evidence windows ordered by an attacker-controlled stamp can only deny, not forge; confirm that runs touched by the range are always evaluated.

**Tripwire-on-a-security-flag pattern (PR #23 r2, good):** `swap(run, from, to)` mutations + a findings function, asserted `changed: true, findings: true` for every variant (appended, prepended, valued, in comment, dropped, doubled, `|| true`). Ask for this shape whenever a PR pins a flag that disables a gate (`--report-only`, `continue-on-error`). Always re-mutate the real file in an extract as well.

**Benchmark / load-spike PRs (PR #27 SPK-04, 2026-11-13).**
- Check the verdict against the PR's own validity rule: count valid arms per run in `summary.json` (`validity.valid`). "Structural" claims need at least one valid arm; otherwise the honest word is "not demonstrated".
- Re-read every number the prose cites against the artefact by arm (the `docker stats` 54% was from the collapsed `off` arm, not the arm discussed). Grep the artefacts for any figure that has no source (`0.26 cores`).
- Test the doc's mechanism with arithmetic: M/D/1 mean wait = rho*h/(2(1-rho)). A model that predicts 3 ms where 98 ms is measured means the mechanism (or the host) is not what the doc says.
- Same configuration at two rates with a 10x worse tail at the LOWER rate = uncontrolled variable (order, DB state, host), so that arm cannot be ranked.
- Fixed arm order + one DB across arms: the next repetition's baseline inherits the previous (possibly invalid) arm. Flag pooled mean-of-2 deltas.
- Kept spike harness vs sheet "throwaway not merged": ask whether any CI lane executes it. SPK-03/08 precedent was `*.int.test.ts` (CI-run, named porting task). A runner needing Docker + k6 is not comparable. Cross-check open sibling PRs for deletions of files the harness reads (`gh pr view N --json files` shows deletions; `git show origin/prN:path`); fetch with `git fetch origin pull/N/head:refs/remotes/origin/prN` then delete the ref.
- Prototype SQL reused from an earlier spike can carry design artefacts the data-model later removed (audit_entries RLS); advice derived from them (no RETURNING under RLS) must be marked prototype-specific.
- Cheap independent checks that worked: canonicalize differential vs the installed `canonicalize` pkg (20k random, 0 diffs; lone surrogate differs), PGlite for SQL-text defect claims (use String.fromCharCode(92) in the probe; .mts for top-level await), eslint with the config block regex-removed to prove it is needed.
- Evidence-checker simulation (PR #28): to test a manifest-activation PR's mechanics, clone the worktree, make a fake base commit = old base + PR manifest, run the head `check-evidence.mjs --base <fake> --head <head> --event pull_request`; then vary head (docs-only, `.claude`-only, root file) to read the steady-state consequences. Node 24 prefix and a node_modules junction suffice; ~1 s per run.
- When a PR parks/defers items "to owner task X", grep the task AC (`docs/04-plan/generator/plan-data.mjs`) for the ID: an owner whose AC never names it will not deliver it.

**Adapter / SDK-wrapper PRs (PR #30 TASK-019, 2026-11-13).**
- **Config-constants mutation:** delete the timeout/retry options from the client config and run the unit suite. Fake-sender tests never see them (78 green). Ask for a loopback `http.createServer` test (500,500,200 = 3 hits; `socket.destroy()` then 412; connect to 10.255.255.1 = `connect()` times at 0/2/4 s) and an assertion on the effective client config.
- **Per-socket timeouts are not deadlines.** AWS SDK `requestTimeout` is an idle timer; a server trickling 1 byte / 5 s keeps `get()` alive (probe, 45 s+). Ask for `AbortSignal.any([caller, AbortSignal.timeout(n)])` and a counting reader when `Content-Length` is missing.
- **Presign:** the SDK floors `X-Amz-Date` to the second, so `signingDate + ttl` overstates the expiry by the sub-second part. Tests with an injected clock at `.000` hide it. A real-store expiry test with `ttl 1` flakes at about the latency/1 s rate (use ttl 2).
- **AWS vs emulator error shapes the emulator cannot show:** S3 `RequestTimeout` is HTTP 400; conditional writes return 409 `ConditionalRequestConflict`; HEAD has no body, so a missing bucket reads as `NotFound`. Check name-before-status ordering in the error map.
- **"Never log the cause" designs make "no secret in logs" assertions vacuous.** Count the captured log lines (here 3, all valkey). Ask for a class-only log line (precedent `valkey.error`).
- **Deny-list import boundaries** miss sibling packages of the same family (`lib-storage`, `s3-presigned-post`, `@smithy/signature-v4`); the next feature (multipart) needs exactly those.
- **Spike follow-up owners:** verify the owner task actually writes the thing (TASK-021 is SQL; anchors are TASK-116) and that its AC names the rule.
- **Decision-log insertions** can steal the previous entry's trailing line; diff `DECISIONS.md` hunks, not just additions.

**Prisma 7 query-extension PRs (PR #26, 2026-11-13).** Verified on the real generated client with a dead adapter (no DB):
- **Ordering:** the EARLIER `$extends` query extension runs first (outer); a later one is inner and sees the outer's rewritten args. A recorder must be applied AFTER the extension under test to see its output.
- **Runtime data model is slim:** fields carry only name/kind/type/dbName/relationName; no `relationFromFields`. An extension cannot map a relation field to its FK scalar, so `connect` on update can change "server-owned" FK columns (org_id). Ask for a schema rule or a type-based refusal, and name the DB backstop.
- **Compile-before-connect:** with an adapter at 127.0.0.1:1, an invalid args shape gives `PrismaClientValidationError` in ~5 ms, a valid one gives "Can't reach database server". This separates shape validity from DB effects without Docker.
- **"Fails closed" claims for catalogue-driven guards:** check BOTH directions. An empty catalogue fails closed for omitted NOT NULL columns but OPEN for forged fields on update.
- **Composition lines:** mutate the one line that wires a guard into the runtime (`scopeClient: …`). If only hand-built runners test it, the mutant survives.
- **Merges of main into DECISIONS.md** can insert a block between another entry's lines (adjacent-append auto-merge). Diff the entry headings vs main.

**Lane A skip trap (PR #30 r2):** when `Lane B evidence` fails early in fast-lane, every later step (lint, format, typecheck, unit, build) is SKIPPED though the job summary looks "mostly green". Check step conclusions with `gh run view --json jobs`, never trust "scans passed". Also verify claims like "docs-only merge delta" with `git diff --name-only <pre-merge> <merge>`: PR #28's tools/quality came in under that label.

**Pipeline/skeleton PRs (PR #32, 2026-11-13).**
- **Stub slots that pass through fail open.** Check that each stub refuses at MOUNT time (it gets the descriptor) any route it cannot honour, e.g. audit action != NONE or idempotency required. Prove it with a tsx probe over the real createApp.
- **A "descriptor-only" claim needs a brand.** Typed descriptors can be spread-forged (`{...defineRoute(x), transaction:'none'}`). Probe mountRoutes with a spread; ask for a WeakSet brand.
- **Lexical lint rules vs callbacks passed by reference.** If the only `withTenantTx` call passes a function reference, the rule guards nothing. Lint-probe the real handler shape (`defineRoute({handler})`).
- **Security headers set by an early slot can be overridden by a late `send()`** that applies handler headers. Also check that the test helper and the app use the SAME "authenticated" predicate (x-permission vs security schemes).
- **RegExp mount fixes keyed on captured params** miss `(?:a|b)`, character classes and top-level `|`. Probe with real HTTP.
- **Joi closed-schema walkers** that read `flags.unknown`/`patterns` miss schema-level preferences: `.prefs({allowUnknown:true})` / `.options(...)` show up only in `describe().preferences` and override the validate call's options at run time; `Joi.link` is not walked. Probe each form through `defineRoute` and `validateRequest`.
- **Checker functions tested directly, wiring untested.** For a `checkX()` that composes `add(rule, f(...))` lines, delete each line and run the suite; with a clean real tree nothing finds the gap (PR #32 r2: 3 survivors). Ask for one seeded case through the composed function per rule.
- **Credential-presence predicates vs cookie paths.** A `__Host-` cookie is always Path=/, so it rides on every same-host request; counting it as a presented credential on routes that do not read it 401s anonymous routes (login) once the cookie exists. Check ADR cookie scoping before accepting a presence rule.
- **Sheet folds land on main while a PR is in flight.** Diff the sheet on main (and `git log -S` the line) against the PR body's "not done" list.

**Gate-tool PRs with a container step (PR #33, 2026-11-13).**
- **Temp dir bind-mounted into a non-root container:** `mkdtemp` is 0700 owned by the runner uid; a `--user 65534 --cap-drop ALL` container gets EACCES on Linux but not on Docker Desktop. Check mode/uid wherever tests ran only on the Windows host.
- **"Gate vs release tag" semantics:** probe a SECOND unrelated PR after a sanctioned break merges (records searched only in the PR's own diff = main red for everyone). Probe tag selection with `vnext` / `-rc1` tags and record matching with a longer identifier (substring).
- **Spec vs test-strategy scope drift:** diff the gate's scope list against TEST-STRATEGY section 8 and D-QA-* decisions, not only the story AC (D-QA-003 money paths; ledger is a module path, not a package).
- **Gate wired in one line (heavy.mjs):** delete the line, run the suite; a green run means no pipeline-level test. Also ask whether the verifier requires the gate's case names.
- **Lane A pins:** mutate the real ci.yml in memory with `checkWorkflow(..., {requiredGates:true})`: `|| true`, `; true`, `true || cmd`, redirect, step `env:` override of the `GATE_*` var (only gates that declare `env` have the exact-env rule), reordering. Pins with `ifs: []` accept a missing `if` (stricter), fine.
- **Evidence staleness after merge-main:** build a real merge commit in a `git clone --local` of the main repo (plumbing, no worktree needed) and run the base `check-evidence`; `git merge` on a checked-out ref moves that ref, so verify which SHA you pass.

**Test-harness / jest-project PRs (PR #34, 2026-11-13).**
- **A project defined by folder rather than suffix** must be proven on the union with every open PR that puts files in that folder: `jest --listTests --selectProjects <p>` on a `git merge-tree` extract (jest.config.ts auto-merges, so only the listing shows the gap). Lane A runs only `test:unit`; anything moved out of `unit` stops running in the hosted lane silently.
- **Test-support guards whose only proof is a hand call.** Mutate the registered hook (`assertClean();` -> `void 0;`): green means the AC is unpinned. Fix pattern: inject the registrar (`register = afterEach`) and drive the captured hook.
- **Encoding scanners:** base64 needles of the bare value miss any embedded occurrence (3 alignments needed, plus base64url); probe JSON, JWT and Basic shapes. Also probe: partial line without `\n`, object keys echoed into finding paths, `Error.cause`, typed arrays, `URL`, depth cut-off (fail-open).
- **Prisma counter without Docker:** dead adapter at 127.0.0.1:1 fires the `$allOperations` hook before connecting; `_createItxClient({id:'t'},0,{})` gives the itx shape; real Express + `express.json()` proves ALS survives body parsing.
- **Metric tools:** run them on the newest stored run and cross-check one number by hand (NFR rows with passing parts 4 vs reported 1); mutate the zero-denominator/zero-test guards.
- **Doc claims about the evidence checker** ("rejects unknown files") must be checked against `FIXED_RUN_FILES` and the `summary.json` attachment rule, not the README alone.

**Fix-cycle commits that "replace the end of a file" (PR #38, 2026-11-14).** When a fix commit's diff on a test file shows `-});` plus a removed `describe(`, check that the describe still exists: `git log -S"<describe title>" -- <file>` and grep the head. PR #38 silently dropped two PR32-SEC-15 tests this way. Prove it with a mutant of the guarded code, plus the restored block as the control.
**"Trust a flag set by a slot" designs.** If a later handler trusts a state flag that an earlier slot sets "before reading", probe a replacement slot that sets the flag and then throws before its second mark. Prefer recomputing from data already in state (the route descriptor) over authenticator discipline.
**`expect(keys).not.toEqual(expect.arrayContaining([a,b,c]))`** passes unless ALL the keys are present, so it is vacuous for a single leak. Ask for per-key `not.toHaveProperty`.
**A static import of a regenerated artefact** (the Prisma client) in unit suites, where the repository convention is to import it under a file lock, is a truncated-read flake risk. "Files never disappeared" probes do not cover partial content.

**Coverage-merge PRs (PR #40, 2026-11-14).** "Lower bound" claims for merged branch coverage must be checked on the PERCENTAGE, not only the uncovered count: phantom covered entries inflate covered and total together. V8 and @bcoe normalisation coalesce adjacent sibling ranges with equal counts (early-return `then` + continuation both 0), so another run splits the same span and a key-level merge keeps both shapes. Probe with REAL Jest, no Docker: scratch dir + node_modules junction, `transform: {}`, CJS source, 3 runs (A, B, A+B) with `--coverageReporters=json`, merge with the PR function, compare per file (~3 s per trial). The `node:inspector` Profiler `startPreciseCoverage({callCount, detailed})` shows raw ranges and adjacency. Also check per-PROJECT (not per-source) emptiness when projects share one Jest run.
- **r2 lessons (range-tree merge).** (1) A PR's seeded random generator only covers the shapes it emits: write targeted shapes (TS via @swc/jest: one-line `if (…) return x;`, for-of continue/break, async try/finally, `??`/`?.`, class members, IIFEs) and drive them through the PR's own `runTrial`/`compareTrial` exports; TS source-map crossings are where residual over-reports live. (2) Port faithfulness: differential against the transitively installed library (`createRequire(<wt>/package.json)('@bcoe/v8-coverage').mergeFunctionCovs`) with random crossing inputs; sanity-check the detector with a known deviation. (3) "Never above n-ary merge" proofs cover the merge stage only; per-run-then-merge vs n-ary is non-associative even for exact V8-shaped trees (model: ~4 % of functions above), so ask for the invariant that actually holds (uncovered never fewer) plus pinned counterexamples. (4) Mutants in split/crossing paths can be dead in production once inputs are uncrossed to a laminar union; classify as equivalent-in-use but ask for a unit pin if the port is exported.

**Container image / Compose PRs (PR #39, 2026-11-14).**
- **Entrypoint preflights that police NODE_OPTIONS must also police the command args.** `exec node <flags> "$@"` lets a task-def/`docker run` command override pass `--inspect=0.0.0.0:9229 dist/main.js`; same trust channel as env. Ask for a refusal of `-`-prefixed args (or one `dist/*.js` arg) in hardened APP_ENV.
- **In-repo promises in config comments** (dependabot.yml "docker ecosystem added with TASK-014") are AC-like: grep the PR's touched areas for "added with TASK-xxx" / "TASK-xxx adds" lines naming the task under review.
- **Sheet folds landing after the head's last merge-main** add merge checks (D-ARCH-115). Diff `git log <head>..origin/main -- docs/04-plan` and read new "REVIEW REQUIREMENT" lines.
- **Review-time Jest gotcha (my own error):** `jest --selectProjects unit <file>` treats `<file>` as a project name and runs the WHOLE project. Put paths first: `jest <file> --selectProjects unit`. Under a memory-restricted dispatch this matters.
- Membership proof for an opt-in project: `--listTests --selectProjects <p>` per project with and without the env flag, cmp the lists, and `sort | uniq -d` across all lists for double membership.

**Writer/store packages (PR #42, 2026-11-14).**
- **Name-list lint allow-lists vs new exports.** A rule that recognises a capability by export NAME (`writerExports`) misses every new write-capable export the PR adds (a lower-level store). Probe with ESLint `Linter` + the rule module + a feature-module filename; ask for the option or a subpath with a module-pattern match.
- **Exemption pins must use the rule's own pattern.** A unit pin `/set_config\(/` (case/space-sensitive) next to a rule matching `/set_config/i` lets `set_config (`, `SET_CONFIG(`, newline and bound-key setters through both. Probe by importing the rule's exported FORMS.
- **Validate-then-use across an await.** `prepare()` validating the caller's live object graph and `complete()` re-walking it after an awaited port (tokeniser) = TOCTOU; mutate the input from a timer during the await. Ask for a validated frozen snapshot.
- **Strict canonicalisers vs lenient boundaries.** JCS refuses lone surrogates; Joi `string()` accepts them and pg stores U+FFFD (Buffer utf8). Refusing in the audit path = client-triggerable 500 on a valid mutation. `toWellFormed()` equals the stored bytes.
- **Mutation script:** node script in the scratch copy with `[id, file, from, to, testPattern]` rows, assert `from` occurs exactly once, spawn jest per mutant, restore in `finally` (~10 s per mutant). On git-bash pass `MSYS_NO_PATHCONV=1` for `--testPathPatterns` starting with `/`. The api project's globalSetup needs `tools/`, `tests/api/helpers` and `docs/03-architecture/api` in the archive; parity tests need `prisma/bootstrap`.

**Statement splitters with block tracking (PR #43, 2026-11-14).** When a PR teaches `splitStatements` to keep `BEGIN ATOMIC` / CASE bodies whole, probe a routine head holding the unreserved keyword `begin` (param, RETURNS TABLE column, function name) followed by hostile statements: a depth counter that never closes swallows the rest of the file and silences every statement-anchored lint rule. psqlscan.l counts only at paren_depth 0 and CASE only inside BEGIN; a later `END;` resyncs depth, so an EOF-depth check alone is insufficient. Also: "registered case" registries that are `Set<string>` make a fail-closed enumeration decorative; ask for executable case shapes. Probe-layer DDL that plants several real-named tables must be per table, or the next task that lands one of them breaks the suite with 42P07. Round 2 lesson: even a psql-faithful BEGIN ATOMIC/CASE/END counter desyncs on a RESERVED keyword used as a column label (`AS case`, `AS end`) or attribute (`t.case`): PG's ColLabel/attr_name accept reserved words. `case` + a later top-level `END;` hides statements; probe it, and ask the counter to skip words after `as`/`.`.

**Request-phase pipelines (PR #44, 2026-11-14).**
- **Lazy event listeners miss past events.** A disconnect signal built on first use (`res.once('close')` inside a getter) never fires if the client left during an earlier phase. Probe: abort the fetch while phase 1 is held, then read `signal.aborted` in phase 2.
- **Result-shape checks after COMMIT.** Any "invalid result -> 500" check that runs after the write transaction commits invites a duplicate on retry. Probe with a recording fake runner: look for `commit` before the 500.
- **Comment-named backstops.** When a policy comment says "the residual stays covered by rule X", lint-probe the exact residual form against rule X (here `createRequire(u)(x)` + `new PrismaClient()`: only the boundaries selector fired, the named rule did not).
- **"Follow it or report it" lint rules:** probe a spread of a same-file const supplying the root property, and a const alias whose initialiser is a conditional/logical expression; both fell through silently.
- **Round 2 (PR #44):** guards that handle "already happened before I subscribed" (`if (res.closed) onClose()`) need their own test; the "during phase 1" test does not kill removing them. Probe by holding an EARLIER middleware slot while the client aborts.
- **Lint rules walking `.parent`:** ESLint's `Program.parent` is `null`, not `undefined`; a `while (current !== undefined)` walk crashes the whole lint run on module-level shapes. Probe module-level variants of every alias/def form.
- **Name matchers for computed keys:** check `Literal` vs no-substitution `TemplateLiteral` (`nm[\`createRequire\`]`); rules that accept template literals as static specifiers often forget them as member keys.

**Allow-list pins (PR #45, 2026-11-14).** When a test claims "any widened allow-list changes a test", check that the regex SOURCES are pinned exactly, not just counted; shape guards that check `^...$` let `(?:.*)$` and `[^\n]*` through. Check that test oracles modelling gitleaks AND semantics skip ABSENT keys (gitleaks does) instead of failing them, and that a commit-bound entry has a retirement trigger (main is squash-merged, so the commit drops out of every scanned range).

**Allow-listed folders launder capabilities (PR #42 r2, 2026-11-14).** An import allow-list that turns a rule OFF for a folder (`AUDIT_WRITER_ALLOW_LIST` includes `apps/api/src/platform/audit/**`) polices nothing that folder EXPORTS. A fix-cycle helper (`auditWriterFromConfig`) re-exported the writer, and a module importing it via `../../../platform/audit/writer.js` was lint-clean. Whenever a PR adds a value export in an allow-listed folder, lint-probe a non-allow-listed module importing it. Ask for a resolved-file boundaries policy, because specifier regexes are evadable by spelling (`./`, `..`).
- **Snapshot claims ("every property read once"):** probe helpers that call the caller's own array methods (`value.map`, spread). An own `map` or a Proxy `length` flip bypasses element validation and caps.
- **Lexical comment-stripping in source pins:** string literals `'/*'` … `'*/'` hide code between them. If the file's comments never contain the pinned token, count over the raw source.
