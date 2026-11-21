---
name: project-p5-task040
description: TASK-040 part 040-A idempotency store security round 1 bound to 3dc1e225 (record on main 23e6a244, D-SECPR040-01) - PR040-SEC-01..09, QG-040-C4 answers (D-TASK040-04, D-ARCH-192/193, VIEW/DOWNLOAD replay), 040-B and TASK-187 checks
metadata:
  type: project
---

TASK-040 round 1 = PASS_WITH_FOLLOW-UPS, bound to the final head `3dc1e225` (fix cycle 2, D-ARCH-195 rendered problem). I reviewed `d0a82a24` in full; merge `40fce4b2` was a pure union (tree equals merge-tree), plus the 10-file delta. Record `docs/05-quality/security/PR-pending-TASK-040-security-review.md` + D-SECPR040-01, main `23e6a244` (2026-11-20). 37 owned paths at base `af4a1b48`.

- **IDs:** `PR040-SEC-nn` (task), NOT `PR40-SEC-nn` (PR #40 = TASK-015 covhook).
- **LOW, all due before part 040-B merges** (no row or idempotent route exists before 040-B):
  - 01: raw key material used as the AES key and also as the HKDF input of the network key. Fix: HKDF both keys (`platform-idempotency-body-v1` / `-scope-network-v1`).
  - 02: stored status/headers not authenticated. Express keeps a stored `text/html` over `res.json`; the API sends no nosniff/CSP. Fix: seal `{v,status,headers,body}` always + Content-Type value allow-list.
  - 03: Stripe `client_secret` stored (checkoutOrder, confirmPayment, createPaymentMethodSetup) against T-79/SEC-TC-04 "no stored secrets". Recommended: accept and record.
  - 04 (= code review R2-n1, extended): the lease formula misses the read-only third transaction and the renewal around `call`. Headroom 3 s at defaults, negative from `DB_TX_STATEMENT_TIMEOUT_MS` = 9 s.
  - 05 (= R2-n2): a claim lost after `call` gives 409 with no FAILED entry. Objection routed to product-manager (D-PM-081 scope).
- **INFO:**
  - 06: `idem_key` in clear, never read.
  - 07: contract pins: public = {recordConsent}, VIEW/DOWNLOAD = {emailShipmentDocuments}, client_secret ops.
  - 08: a 5xx releases the key, so providers need their own idempotency keys.
  - 09: `storedProblemOf` can throw before `settleClaim`, leaving the claim held until the lease ends.
- **QG-040-C4 answers:**
  - D-TASK040-04 stands with the change in 01. The rotation effect is accepted (only recordConsent is network-scoped).
  - D-ARCH-193 confirmed with T187-1..6. T187-2: `storedProblemOf` stores EVERY thrown 4xx except 429, so TASK-187 must exclude 401 REAUTH_REQUIRED explicitly.
  - D-ARCH-192 concurred with P-1..P-5: a CODEOWNERS line for `/apps/worker/src/platform/idempotency/` joins PR64-SEC-09; `security-paths.mjs` NOT required.
  - A SENSITIVE VIEW/DOWNLOAD replay needs no entry of its own.
  - T-79/R-05/AC-14/SEC-TC-04 text is mine before G3 (record §3.9).

**Round 2 (delta, fix cycle 3 + D-PM-084) at `e96bd979`: PASS_W_F-U, D-SECPR040-02, main `3eb56d70`.** The PR head `93f0f126` is that plus a docs-only merge, and the binding holds. No new findings.
- **Closed:** 05 (code); 03, 06, 08 by ruling (D-ARCH-204 / D-ARCH-202).
- **Narrowed:** 02. The R3-M1 `{origin, body}` envelope protects slot-problem rows. Still open: handler-row status/headers, and nulling body + key id forges a body-less handler replay.
- **Open, due in 040-B PR 1 (D-ARCH-204, two 040-B PRs allowed):** 01, 02, 04, 07, 09.
- **Gitleaks literal ruling:** 3 unpushed commits (`a633eb84`, `9f08ecb5`, `5e0dc1b0`) hold a synthetic UUID that `generic-api-key` flags.
  - No baseline change: lane A's PR range scan never reads the baseline, and PRs land by squash (65/65), so the entries would be dead.
  - Preferred: a supersede branch with one squash commit and a tree-equality check, plus supersede rounds.
  - Accepted alternative: D-SEC-PR45-01 commit-bound `.gitleaks.toml` entries in their own PR. I extended that rule to unpushed commits that records and evidence have already bound.
  - Code review R4-m1 agrees.

**Round 3 (supersede) at `2abd665f` on `feat/TASK-040-idempotency-keys-v2`: PASS_W_F-U, D-SECPR040-03, main `c481471c`.** One squash commit on `f65d7955`; tree `a6b0bf97` == merge-tree(e96bd979, f65d7955), so the net code diff is identical. Gitleaks emulation: 0 findings in `f65d7955..2abd665f`. Lane B on `2abd665f` is owed (Docker was down: disk full).

**QG-040-C7 (c): D-SECPR040-04 (main `5f43960e`), concurrence with D-ARCH-205/206 (ADR-0012 am. 6/7).**
- Mock (`capabilities().simulated`) may authorise in `call`.
  - C-1: production refuses any adapter with `simulated: true`; SEC-TC-24 gains the case.
  - C-2: the suite gets a negative control.
- `deletePaymentMethod` detaches as a worker step after commit (C-3..C-6): a removed method is unusable at once; the event carries the id only; DLQ when the detach keeps failing.
- Abandoned-setup housekeeping (C-7..C-9) acts only on Platform setup rows, claimed against a late `createPaymentMethod`.
- Mine before G3: the T-71 row gains C-1.

**Fact:** `check-security-owned-paths` passes only if a Head-row commit is in the PR's `base..head` commits; it silently skips Head rows whose commit is outside the range. A supersede (non-ancestor) head therefore needs a new round naming it, even when the tree is identical.

**Why:** 040-B (wiring + hourly worker purge) gets its own security round and must close the LOWs.

**Update 2026-11-21:** #80 squash-merged as `763800f3`. 040-B PR 1 round 1 at `a4aadd2e` closed 01/02/07/09 and 04 as ruled; see [[project-p5-task040b1]] (new 10-13). PR 2 still owes P-1..P-5 and the purge.

**How to apply:**
- At 040-B: check 01/02/04/05/07/09, P-1..P-5, the purge ships with the wiring, the register row and data-model §10.4 updated, and the Pino IdempotencyLog stays class-only.
- At TASK-187: check T187-1..6.
- Before G3: threat-model text.
- If 040-A changes an owned path after `3dc1e225`, a new round; a main merge only needs a merge-only round.
- Probe kit (session scratch `t040sec/probes/`): `hooks.mjs` (strip-types load hook, `@platform` mapped to the extract), `p1` cipher+scope, `p2` lease table, `p3`/`p4` real store over the branch's `tests/memory-keys.ts` MemoryKeys + memoryRunner, real problemHandler + Express, `gl.mjs` gitleaks over-approximation.
- Probe fact: Express 5 adds an app-wide weak ETag to problem bodies (`app.ts` does not disable etag), which is pre-existing.

Related: [[project-p5-task041]], [[project-p5-task043]], [[project-p5-pr64-task035]], [[project-security-review-conventions]]
