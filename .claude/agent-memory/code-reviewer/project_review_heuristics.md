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

**CI gate / supply-chain checker patterns (PR #10, 2026-11-12).** Each was proven by a probe of under a minute.
- **npm boolean flags take a bare `true`/`false` as their value.** `npm ci --ignore-scripts false` sets the flag to false, and the CLI value beats both env and `.npmrc`. Regex guards that only know `--flag=false` / `--no-flag` miss it. Probe: `npm config get ignore-scripts --ignore-scripts false`.
- **Install-command regexes must come from npm's alias table** (`node_modules/npm/lib/utils/cmd-list.js` `aliases`). For example `clean-install`, `ic`, `cit`, `it`, `sit`, `ins`, `isnt`.
- **Gitleaks v8 always loads `<source>/.gitleaksignore`** (`cmd/root.go`) and honours `gitleaks:allow` unless `--ignore-gitleaks-allow` is passed. A "config from the base ref" claim is therefore not enough; check the ignore file and the allow comments.
- **Every "base-ref" claim:** list what the base-run tool still reads from the HEAD (ignore files, registers, test harness, jest config).
- **In-house YAML parsers:** probe lone CR, NEL and U+2028 inside a comment line. libyaml-family parsers break the line there, so the hidden content is invisible to the checker. Prettier catches only the lone CR.
- **`git diff --name-only` reports only the new path of a rename.** Ownership or record checks need `--no-renames`.
- **A "record names reviewed SHA, nothing changed since" check** breaks on merge-main. Intersect with the PR's own net owned paths.
- **Verify process premises against repo settings** (`gh api repos/<r>`): squash title (`COMMIT_OR_PR_TITLE` uses the commit subject for single-commit PRs), allowed merge methods. Branch protection returns 403 on private free-plan repos, so "required check" claims are not enforceable.
