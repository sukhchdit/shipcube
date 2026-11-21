---
name: task044-fc1
description: TASK-044 fix cycle 1 (2026-11-21) - unhandledRejection spy is vacuous in Jest, equal-work ratio pins for linear-time fixes, id-less SSE frame ripples into helpers, scan-the-wire privacy pattern
metadata:
  type: feedback
---

Lessons from the TASK-044 part 044-A fix cycle (SSE privacy guard, outcome guard, `error` event without an id).

**Why:** each cost a probe or a rerun, and they recur for any stream route (TASK-141, TASK-173) and any ReDoS fix.

**How to apply:**
- **A `process.on('unhandledRejection')` listener inside a Jest test sees nothing** (probed with an unobserved
  `Promise.reject` positive control: 0 events). Do not offer it as proof. Prove a guarded continuation by the hook
  settling with its error frame and `onFailure` hearing the reason.
- **Linear-time pins that do not flake:** compare EQUAL WORK on both sides (16 x 4 KiB scans against 1 x 64 KiB, each
  repeated, best of 7) and assert `ratio * 16 < 32`. Linear gives about 16, quadratic about 256. Add a single-scan guard
  (< 1 s) first so a regression fails at once instead of running for minutes.
- **A fast-check language oracle** (the old regex on strings of at most 24 characters from a small alphabet) proves a
  rewritten pattern accepts the same strings. Build NBSP and U+2028 with `String.fromCodePoint`; Edit decodes `\u` escapes.
- **An `id`-less frame ripples into text-scanning helpers.** `hasTerminalEvent` looked for `\nevent: error\n` inside a
  block, which an id-less block (it starts with `event:`) never has. Wrap the block as `\n${block}\n` before searching.
- **Scan what is sent:** serialise once (cap included), frame it, then scan `JSON.parse(json)`. Walking the live object
  misses `toJSON`. A branded `SseJson` type keeps unchecked text out of the framer.
- **Layered guards hide a mutant.** With a shape check inside `end`, the outer try/catch in `settle` is killed only by a
  throwing accessor on the outcome. Keep that case in the table.
- **`fixtureRoute` omits `permission` from its type,** so session fixtures need a cast. Use `defineRoute` with the full
  spec instead (`audit`, `rateLimit: 'none'`, `idempotency`, `tenancy`, `auth`, `transaction`).

Related: [[task044-sse]], [[task051-fc1]], [[pr33-fc1]]
