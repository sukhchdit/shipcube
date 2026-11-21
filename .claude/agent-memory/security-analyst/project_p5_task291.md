---
name: project-p5-task291
description: TASK-291 (W0-FLAKE-3, pre-push) security r1 at f4f8a12 PASS_W_COND (ccc38a5); r2 delta at 12d7873 PASS_W_COND (0b89579): SEC-01 (fetchOnce duplicate headers) and SEC-03 (lock label) closed, SEC-02 INFO open; record PR-pending on main (rename needed); C1 lane B at 12d7873; transport differential kit
metadata:
  type: project
---

**Round 2 (2026-11-19, delta `f4f8a12..12d7873`).** The round was appended to the same record on main and D-SECPR291-02 added, both in `0b89579`.
- **PR291-SEC-01 closed.** The fix is `joinDuplicateHeaders: true` at `loopback.ts:90`. The rerun differential gave 0 narrower rows; the mutant (option removed) missed the same 16 rows again.
- **PR291-SEC-03 closed:** the label is now `api-openapi`.
- **Code twin r2** (`550544e`, APPROVED_WITH_NITS): R2-n3 (doubled content-type is joined) is parity with `fetch`, not a finding.
- **C1 (lane B at `12d7873`):** the rls-cross-tenant total is unchanged, because the new cases are plain `*.test.ts` and run in `unit`.
- **Owned paths:** 22.
- **Sim:** `sim-r2.mjs` reads the LAST Head row and adds control C10 (the round-1 record alone does not cover the head). Result 15 of 15.
- **Next:** any owned-path change after `12d7873` needs a round 3.

Round 1, 2026-11-19, pre-push. The head moved from `1672070` to `f4f8a12` mid-round. `f4f8a12` holds the code review r1 fixes, including CODEOWNERS `/tests/generated/loopback-*`. A network outage then interrupted the round, and it was resumed. The record `docs/05-quality/security/PR-pending-TASK-291-security-review.md` and D-SECPR291-01 were pushed on main as `ccc38a5`. The code twin is r1 CHANGES_REQUESTED on `f3f9557` (R1-M1 is the prerender item, re-scoped by D-ARCH-158).

**PR291-SEC-01 (LOW): `fetchOnce` (`apps/api/src/platform/routing/tests/loopback.ts`) builds its headers from `IncomingMessage.headers`.**
- Node keeps only the first copy of these headers when a response repeats them: `age`, `authorization`, `content-length`, `content-type`, `etag`, `expires`, `from`, `host`, `if-modified-since`, `if-unmodified-since`, `last-modified`, `location`, `max-forwards`, `proxy-authorization`, `referer`, `retry-after`, `server`, `user-agent`.
- Effect: the rls `runApiCase` header scan, and the rbac runner since PR #60, miss a leak in the second copy. undici `fetch` and browsers join the copies.
- Fix: `joinDuplicateHeaders: true` on the request. With it, 24 of 27 probe rows match `fetch`; the other 3 rows (redirects, always-gzip) are stricter than `fetch`.
- The code twin said "at least as strict"; it missed this.
- Due: this PR, preferred (api-routing lock; needs a delta round), or else before the first `API_CASES` entry or rbac-matrix activation, at the latest G3.

**PR291-SEC-02 (INFO): the shim reads the `@platform/source` target from the manifest.**
- It loads `../`, `./../`, a target without `./`, and a `node_modules` segment, all of which Node refuses (`ERR_INVALID_PACKAGE_TARGET`).
- Mitigated by the exact pin in `tools/db/prisma-client-package.test.ts:51-58`; all files involved are owned.

**PR291-SEC-03 (INFO): lock label `contract-stubs` is not a lock in `plan-data.mjs`.** The right label is `api-openapi`.

**Conditions:**
- C1: lane B at `f4f8a12`: integration, catalog-c1-c14 and rls-cross-tenant 0/0/0, the rls total identical to main's, and the hosted job green.
- C2: rename.

`security-integration` is selected (15 trigger paths), but the hosted job does not run `integration`, which holds 9 of the 11 converted readers.

**Facts:**
- The checker reads the HEAD CODEOWNERS from the `--root` working tree. Running it with the main checkout as root undercounts owned paths (17 instead of 20 here); simulate with the merge checked out.
- `tests/generated/loopback-*` is now owned.

**Kit** (session scratch `r291/probes/`):
- `build.mjs`: verbatim runner text with stubbed imports, plus a fix-candidate copy.
- `transport.mjs`: 27-behaviour differential.
- `shim2.mjs <repo> <sha>`: crafted manifests next to Node's self-reference resolution.
- `sim.mjs <repo> <sim> <record> <main> <head> <base> <prefix>`: 14 scenarios.
- `gl-over.mjs`: over-approximating gitleaks scan.

**How to apply:**
- Delta round if `loopback.ts` or the allow-list changes after `f4f8a12` (sim C6/C7). Re-run `transport.mjs` against the fixed `loopback.ts`: expect 0 head-WEAKER rows.
- When reviewing a conversion of any allow-listed suite (9 of 10 are owned), check its header assertions under `fetchOnce`, and check that `PINNED_CEILING` and the allow-list only shrink.

Related: [[project-p5-pr57-task288]], [[project-p5-pr60-task289]], [[project-p5-task287c1]], [[project-security-review-conventions]]
