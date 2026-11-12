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

**Timing assertions in required suites (PR #7, 2026-11-12).** Wall-clock p95 deltas asserted in `*.int.test.ts` run on every `test:integration`. Heavy suites run on the contended local host (D-ORCH-001). When headroom is only about 2× and the doc itself records run-to-run swings, require an opt-in env flag; the doc table is the record. Lower-bound timer checks (e.g. `>= 1900` for a 2000 ms maxWait) are fine.
**Pool reset.** `@prisma/adapter-pg` `commit()`/`rollback()` only call `client.release()`, with no DISCARD/RESET. Any session-level `SET` leaks to the next checkout. Check every DB-context diff for session-level settings.

**Authz guards (PR #8, 2026-11-12):**
- Invariants keyed on a free-text field of the guarded data (such as `category`) are bypassable. Probe by re-categorising a write permission and granting it.
- Generators that write a migration path keyed by an unchanged version number rewrite applied migrations in place. Ask for a content pin per released version.
- Check every "read-only role" rule against self-service routes (`/me/sessions`), because ASVS V3.3.4 needs session list and revoke for every user.
