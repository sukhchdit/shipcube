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
- **Lint-driven merge-main fixes** (new TASK-002 rules) usually do three things:
  - drop casts (`no-unnecessary-type-assertion`). Check whether the target type accepts `undefined`; if so, the guarantee now lives only in a guard in another function (PR #5 R3-n2).
  - turn `async` fakes into `Promise`-returning ones (`require-await`). Check that a throw still becomes a rejection and that callers await.
  - add config-scoped rule `'off'` blocks. Ask what else the tree-wide relaxation now permits.
- **Parallel batch PRs** each add env keys (prisma.config, db client, vite import.meta.env). The `.env.example` and compose.env parity tests reject unknown keys, so always list the key gap and who reconciles it.

**Why:** each of these passed the author's own tests, because the tests used cooperative fakes.
**How to apply:** check every config, guard, secret or timeout diff against this list. See [[review-watchlist]] and [[scratch-copy-technique]].
