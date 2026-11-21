# Code review: TASK-040 part 040-B, first pull request (lease rule, derived keys, sealed envelope, PR040-SEC-09, contract pins), pre-PR round 1

| Field | Value |
|---|---|
| Task | TASK-040 part 040-B, first pull request (ADR-0014 amendments 10, 15, 16; D-ARCH-200, D-ARCH-204; PR040-SEC-01, -02, -04, -07, -09; SEC-TC-04 / PR040-SEC-03) |
| Branch / head | `feat/TASK-040-part-b-idempotency-production` at `a4aadd2e`, not pushed, upstream unset, no PR number yet (opens after PR #80 merges; D-ORCH-150) |
| Delta reviewed | `0f0d92a0..a4aadd2e`: `1b49bbf5` (feat: lease, HKDF keys, envelope, migration, PR040-SEC-09), `a4aadd2e` (test: PR040-SEC-07 pins); 15 files, 807+/92- |
| Base | PR #80 head `0f0d92a0` (part 040-A, code `2abd665f`, approved; lane B PASS). Stacked per D-ORCH-150 |
| Developer decisions | D-TASK040-18 to D-TASK040-22 (commit body of `1b49bbf5`); ruled in §4 |
| Reviewer | code-reviewer, 2026-11-21 |
| Bindings read | Brief `docs/04-plan/briefs/TASK-040B1.md` (card verbatim: TWO PULL REQUESTS ALLOWED, PART 040-B FILES AND LOCKS, LEASE RULE, ENVELOPE, STORED CLIENT SECRETS, AS BUILT IN PART 040-A, PART 040-B SECURITY CONDITIONS); ADR-0014 amendments 10 and 15 (text read at the head); D-ARCH-200, D-ARCH-204, D-ORCH-150, D-ORCH-151, D-ORCH-156, D-ORCH-158; part-A records `PR-0080-TASK-040-code-review.md` (R2-n1, R3-m1) and `PR-0080-TASK-040-security-review.md` |
| Lane B | `20261121T0754Z_a4aadd2` PASS on PostgreSQL 18 (D-ORCH-156). Diagnostic only: the head is stacked, so lane B runs again after main is merged in |

```
VERDICT: APPROVED_WITH_NITS (conditional: zero BLOCKER, zero MAJOR; two MINORs carry merge conditions, see §6)
SUMMARY: Every PR-1 item of the card is built as ruled: HKDF keys with the amendment 15 labels (known answers plus an
         RFC 5869 oracle), one sealed envelope {v, origin, status, headers, body?} with clear-column equality and a
         Content-Type allow-list, the completed-body CHECK, the PR040-SEC-09 guard and the three PR040-SEC-07 pins.
         163 targeted rows pass here and 8/8 mutants die. R1-m1: the lease rule of amendment 10 does not count the rest
         of the transaction that wrote the lease. The read-only stretch therefore runs past the lease at statement
         timeouts of 8 s and above, and the 5 s skew margin falls to 2 s at the default timeout when the admission wait
         is not passed. The fix is one term and keeps 32.25 s at the defaults; it needs an architect ruling. R1-m2:
         the new migration's timestamp collides with TASK-080's and sorts before it, so this PR re-times it.
```

## 1. What I verified myself

Host rule (dispatch): every command ran in the foreground, one at a time, with no Docker and nothing run in the worktree.

Setup:
- All runs below use a `git archive a4aadd2e` extract in my scratchpad, with a junction to the worktree's `node_modules` and the git-ignored `prisma/generated` copied in.
- The worktree is at `a4aadd2e` and clean, so its `@platform/*` links resolve to the same tree.
- `git status` of the worktree was still clean after every run.

| Check | How | Result |
|---|---|---|
| Delta | `git log` / `git diff 0f0d92a0..a4aadd2e` | 2 commits, 15 files. No file of TASK-041's locks is touched (`app.ts`, `start-api.ts`, `pipeline.ts`, `matrix-app.ts`, `eslint.config.mjs`, `packages/**`). Commit bodies are under 100 columns |
| Unit Jest (changed and adjacent suites) | `--selectProjects unit --testPathPatterns "idempotency/(store\|from-config\|body-cipher\|problem\|scope)\.test\|idempotency-lease\.test\|x-idempotency\.test"` | 7 suites, 78/78 pass |
| API Jest | `--selectProjects api --testPathPatterns idempotency\.api\.test` | 33/33 pass |
| tx + idempotency, unit + api, with coverage | `--selectProjects unit api --testPathPatterns "apps/api/src/platform/(tx\|idempotency)/" --coverage` | 12 suites, 155/155 pass. Coverage: `execute.ts` 98.77 % line / 91.62 % branch; `store.ts` 100 / 98; `from-config.ts` 100 / 93.33; `body-cipher.ts` 100 / 100 |
| Routing + contract projects | `--selectProjects unit api --testPathPatterns "apps/api/src/platform/routing/\|tests/contract/"` | 7 suites, 208/208 pass. This includes `pipeline-guards.test.ts`, the other builder of a store |
| Typecheck | `tsc -b apps/api/tsconfig.json tests/contract/tsconfig.json` in the copy | exit 0 (27 s) |
| ESLint | `eslint --max-warnings 0` over the 12 changed `.ts` files | 0 problems |
| Prettier | `prettier --check` over the changed `.ts` files | clean (the `.sql` and `.prisma` files have no parser, as on main) |
| Migration lint | `tsx tools/db/lint-migrations.ts` | "no findings"; Prisma schema valid |
| Mutants (`cr040b1-mutate.mjs`, one at a time, restored in `finally`) | M-a: SEC-09 guard removed (`storedProblemOf` called bare); M-b: replay Content-Type check removed; M-c: clear-status comparison removed; M-d: lease 3T to 2T; M-e: body key = material; M-f: completion Content-Type check removed; M-g: header-count check in `sameHeaders` removed; M-h: network key derived with the body label | **8/8 killed** (1, 1, 2, 5, 2, 1, 1, 2 failing rows) |
| Probe P1, a non-JSON 2xx through the slot | A fixture case added to my copy of the API test: a 201 with `Content-Type: text/html`, sent twice with one key | Both requests answer 500 problem+json. Event order: `complete 201`, `rollback`, `failed-entry 500`, `release`. No row is left and the handler ran twice. So the refusal rolls the business transaction back and frees the key, as D-TASK040-19 says |
| Probe P2, idempotent 2xx media types | tsx over the dereferenced contract | 47 idempotent operations: 38 2xx responses are `application/json` and 9 are body-less 204s. No other media type, so the allow-list matches the contract today |
| Probe P3, lease margin with the writer's remainder | tsx over `idempotencyLeaseMs` (§3 R1-m1 table) | The read-only margin is negative at statement timeouts of 8, 9, 12 and 120 s. At 5 s with the admission wait defaulted to `maxWait` (what PR 1 computes until PR 2 passes the configured value), the margin is 2 s |
| HKDF | Labels compared with ADR-0014 amendment 15 item "Keys"; the test oracle read: HMAC-SHA256 written out, empty salt, one block | Labels verbatim. An empty salt equals HashLen zero bytes under HMAC padding, so RFC 5869 holds. The known answers are pinned for both labels |
| Union drift | `git merge-tree --write-tree --name-only` of `0f0d92a0` and of `a4aadd2e` against the heads of TASK-043, TASK-080, TASK-051 and TASK-041 | Identical conflicted-file sets for the base and the head. The delta adds no new conflict; `platform.prisma` merges cleanly with TASK-043 |
| Migration order | `git ls-tree` of `origin/main` and the open branches | `origin/main` ends at `20261119000000`. Open: `20261120000000` (043), `20261120100000` (#80), `20261120200000` / `…210000` (051), `20261121000000_pricing_config_versions` (TASK-080, #81) and this PR's `20261121000000_idempotency_keys_completed_body` (R1-m2) |

**Not re-run here:**
- the whole unit, api and generated projects, the integration suite (Docker), `quality:heavy` and coverage over the whole repository;
- for those I rely on lane B `20261121T0754Z_a4aadd2`: unit 8,355, integration 432 including the envelope and CHECK cases and gitleaks-full, api 212, catalog 113, migrations 30 including up/down/up of the new migration, rls 157.

## 2. Requirement check (brief "Acceptance")

| Acceptance row | Where | Status |
|---|---|---|
| `[PR040-SEC-04] [R2-n1]` lease table 5/8/9/12/120 s, 32.25 s at the defaults, 30 s floor | `tx/idempotency-lease.test.ts` | Met as worded. The stretch model omits the writer's remainder (R1-m1) |
| `[PR040-SEC-01]` labels, known answers, RFC 5869 oracle, separation, length refusal, P1 inversion, network scope keyed by the derived key, dual read through the derived previous key | `idempotency/from-config.test.ts` | Met. M-e and M-h are killed |
| `[PR040-SEC-02]` envelope sealed together; body-less 202/204; clear status, Location, Content-Type changed, added or removed; nulled ciphertext; malformed and old-form envelopes; Content-Type allow-list at completion and replay; through the API (500, handler not re-run); on PG 18 (CHECK by name, 204 envelope, clear-status tamper) | `store.test.ts`, `idempotency.api.test.ts`, `store.int.test.ts`, `prisma/tests/idempotency/idempotency-keys.int.test.ts` | Met (n4 and n5 are test-shape NITs) |
| `[PR040-SEC-09]` unrenderable thrown 4xx leaves no row; the retry runs at once | `idempotency.api.test.ts` | Met. The WARN carries the class only (`TypeError`). M-a is killed |
| `[PR040-SEC-07]` (a), (b), (c) with planted negatives | `tests/contract/x-idempotency.test.ts` | Met: `{recordConsent}`, `{emailShipmentDocuments}`, `{checkoutOrder, confirmPayment, createPaymentMethodSetup}` (n3) |
| `[SEC-TC-04] [PR040-SEC-03]` stored client secret: replayed; no clear column holds the shape (memory table and PG 18) | `idempotency.api.test.ts`, `store.int.test.ts` | Met. The secret value is built at run time, so there is no gitleaks literal |
| `[SEC-TC-53]` unchanged and green | contract project | Met |
| Kept: CLAIM LOST AFTER CALL and the m4 test change (D-ARCH-206) | `idempotency.api.test.ts` | Unchanged and green |

**Scope.**
- Nothing in the delta belongs to PR 2: no composition, no purge, no `openapi.yaml` and no lint lock.
- `ExecuteOptions.admissionWaitMs` is added as an optional input and is left unwired on purpose (D-TASK040-18). Passing the configured `DB_TENANT_ADMISSION_WAIT_MS` from `createApp` is a PR 2 rider (§6 C8).
- Nothing in the card's PR 1 list is missing.

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-m1 | MINOR | `apps/api/src/platform/tx/execute.ts:116`; `apps/api/src/platform/tx/idempotency-lease.test.ts:12-22`; ADR-0014 amendment 10 table (row "After the last write") | **The lease does not count the rest of the transaction that wrote it** (this is the developer's open question, and the answer is yes). `lease_until` is computed from the application clock at the write statement: `at` before the claim INSERT, `now()` before the renewal UPDATE. It becomes visible only at that transaction's COMMIT, and the commit can come up to `timeout` later. A concrete case: a claim INSERT that waits on a concurrent duplicate's uncommitted row until `lock_timeout`, and then succeeds when that row rolls back. Amendment 10's prose sizes the lease to the longest stretch "between the last write and the end of the request", but its table, the code and the test count only the 3 × T that follow the commit. For the read-only path (VIEW/DOWNLOAD success: renewal or claim statement, then the rest of that transaction, the handler transaction, the fail-closed entry and the completion), the true stretch is `timeout + 3T`, not `3T + 1 s`. Probe P3, margin = lease − stretch: 5 s / admission 250 ms: +5.5 s; 5 s / admission defaulted to `maxWait` (PR 1 as composed): **+2.0 s**; 8 s: **−2 s**; 9 s: **−3 s**; 12 s: **−6 s**; 120 s: **−114 s**. When the margin is negative, a retry can take the key over after the original's entry and before its completion. It then runs the route again: for `emailShipmentDocuments` (the only idempotent VIEW/DOWNLOAD operation, pin (b)) that means a second DOWNLOAD entry and a second `afterCommit` e-mail, while the original's completion fails as lost and is logged. The other stretches are covered: call `D + T` (the T absorbs the writer's remainder), failure `2T + timeout + 1 s ≤ 3T + 1 s`, load `≤ 2T`. The default configuration with the admission wait passed is still safe, which is why this is MINOR and not MAJOR. | Architect ruling on amendment 10 (owed by D-ORCH-156). Recommended: change the "after the last write" bound to "the rest of the writing transaction (`timeout`) + 3 × T", so `lease = max(30 s, max(D + T, timeout + 3T, timeout + 2T + 1 s) + 5 s)`. The defaults stay at 32.25 s (`timeout + 3T` = 26.75 s < `D + T` = 27.25 s), so the pinned value and the PR 2 composition are unaffected. In code that is one term at `execute.ts:116`. In the test, the `readOnly` and `failure` stretches start at the write, not at the commit (`timeout + …`), and the 32.25 s pin stays. If the architect instead accepts the residual, the ruling records it and the JSDoc at `execute.ts:96-108` says the bound counts from COMMIT. |
| R1-m2 | MINOR | `prisma/migrations/20261121000000_idempotency_keys_completed_body/` | **Timestamp collision with TASK-080's `20261121000000_pricing_config_versions`.** The two directories differ only after the timestamp, so Prisma orders them by name and this one (`i…`) sorts **before** TASK-080's (`p…`). The merge order of D-ORCH-151 is #82, #80, #81 (TASK-080), #83, then the stacked parts. So any database that applies #81 first then receives a migration that sorts before one it already applied. That breaks the append-only order every other migration keeps. It is harmless for these two independent tables today, but `migrate dev` replays in directory order while that database applied in merge order. **Ruling: this PR re-times.** It is the one that merges later, its lane B is diagnostic-only, and TASK-080's migration already carries review and lane-B evidence. | Rename to a timestamp after `20261121000000`, for example `20261121120000_idempotency_keys_completed_body`. Update the three references: `down.sql:1`, `apps/api/src/platform/idempotency/tests/memory-keys.ts:60` and `prisma/tests/idempotency/idempotency-keys.int.test.ts:235`. Re-run `db:lint-migrations`; up/down/up is lane B's. At merge, check that the directory sorts after every migration on `origin/main` (§6 C4) |
| R1-n1 | NIT | `packages/config/src/schema.ts:379`; `packages/config/src/keys.ts:171-176` (not in the delta) | The `IDEMPOTENCY_BODY_KEY` description ("AES-256-GCM key of stored idempotent responses.") and the register row (`algorithm: 'AES-256-GCM'`, purpose "stored responses") contradict ADR-0018 amendment 9 and the code: the material is now HKDF input to two keys. The brief puts `packages/config` out of scope, and TASK-041 holds those files. D-ORCH-156 lists the owner as owed. | Owner named by the orchestrator (the next task that takes the config files after 041-B). Text: description "Key-derivation input (HKDF-SHA256) of the AES-256-GCM key of stored idempotent responses and the HMAC-SHA-256 key of anonymous client networks (ADR-0018 amendment 9)."; register `algorithm` "HKDF-SHA256 → AES-256-GCM, HMAC-SHA-256", purpose "stored responses (AAD uses scope_hash); anonymous client networks". Keep `material: 'aes-256-gcm'`, which is what enforces exactly 32 bytes (`keys.ts:477`), or add a dedicated material kind |
| R1-n2 | NIT | `apps/api/src/platform/idempotency/store.ts:47` | The JSDoc of `IDEMPOTENCY_LEASE_MS` names `leaseMsFor`. The function is `idempotencyLeaseMs`; the stale name is part-A text in a file this PR edits. | Rename in the comment |
| R1-n3 | NIT | `tests/contract/x-idempotency.test.ts:93-100`, `:116` | (a) `isPublic` reads only the operation-level `security`. An operation without one inherits the document-level `security` (`bearerAuth` today), so a contract change to a global `security: []` would make every operation public and pin (a) would not notice. (c) The walk skips any key named `example`/`examples`, including a schema **property** with that name. | (a) Fall back to the document's `security` when the operation has none (keep the loaded document from `beforeAll`), and plant one negative for it. (c) Skip `example`/`examples` only as keywords, that is, not when walking the values of `properties` |
| R1-n4 | NIT | `apps/api/src/platform/idempotency/store.ts:65` (premise); tests | D-TASK040-19's allow-list rests on "every idempotent 2xx of the contract is JSON". Probe P2 shows that holds today (38 JSON, 9 body-less), but nothing pins it. A future idempotent operation with a non-JSON 2xx would be a permanent 500 at run time (probe P1 shows the mechanics: rollback, FAILED 500, release). No API-level test shows that rollback either; the store unit test pins only the RangeError. | Add a fourth contract pin in the PR040-SEC-07 block: the 2xx media types of every idempotent operation are `application/json` or none, with a planted negative. Add one API row: a 2xx with `text/html` answers 500, leaves no row and runs again on retry (probe P1 is the shape) |
| R1-n5 | NIT | `apps/api/src/platform/idempotency/store.int.test.ts:213` | The nulled-ciphertext UPDATE on PostgreSQL asserts only `.rejects.toThrow()`, so a permission or any other error would also pass. The constraint name is pinned only in the raw-SQL INSERT case of `idempotency-keys.int.test.ts`. | Assert `23514` and `ck_idempotency_keys__completed_body` on the error, or its cause, as the prisma test does |

No BLOCKER and no MAJOR.

**Security (first pass, for security-analyst):**
- PR040-SEC-01: verified, with labels, oracle and mutants.
- PR040-SEC-02: one envelope; clear columns must equal it; the CHECK closes the "null the ciphertext" form; the Content-Type allow-list applies both ways.
- PR040-SEC-09: WARN carries the class only.
- PR040-SEC-07: pins exact.
- SEC-TC-04 / PR040-SEC-03: no clear client-secret shape.
- R1-m1 is the PR040-SEC-04 residual (CWE-667): the security round should concur with, or rate, the remainder term.
- No new dependency, configuration key, secret literal or log field with personal data.

## 4. Rulings on the developer decisions

- **D-TASK040-18 (the admission-wait term defaults to `maxWait`): accepted.**
  - `resolveAdmissionOptions` refuses `admission.waitMs > maxWaitMs` (`with-tenant-tx.ts:305-309`), so the default is a validated upper bound and only lengthens the lease: 34 s instead of 32.25 s at the defaults.
  - PR 2 should pass `DB_TENANT_ADMISSION_WAIT_MS` from `createApp` (§6 C8).
  - Under R1-m1 that is the configuration where the skew margin is thinnest today (2 s).
- **D-TASK040-19 (envelope form and refusals): accepted.**
  - `{v: 1, origin, status, headers, body?}` with `body` absent rather than `null` for a body-less response. Wire header names inside and in the clear copy. Exact equality of the clear status and headers, so added, removed and changed headers are all unreadable.
  - Refusal at completion is a `RangeError`. In the handler transaction it rolls back (probe P1). In `settleClaim` it releases and answers the original, as for any failed completion.
  - Refusal at replay is `IdempotencyReplayError` (500, ERROR line, class and fixed reason only).
  - The part-040-A form `{origin, body}` is unreadable. That is safe only because no row exists before PR 2 mounts a route (§6 C5).
- **D-TASK040-20 (migration kind): accepted.**
  - `expand`, not data-changing, reversible.
  - NOT VALID + VALIDATE under `SET lock_timeout = '3s'` (rules 6 and 11; equal to the migrator role default, so no RESET is needed).
  - `down.sql` is prefix-idempotent (`DROP CONSTRAINT IF EXISTS`).
  - If a row did exist, VALIDATE would fail the deploy, which is the safe direction.
  - The directory name changes under R1-m2.
- **D-TASK040-21 (WARN `api.idempotency_problem_unrendered`): accepted.**
  - Class only. The original failure goes on to the problem handler. The key is released, not held for the lease, so PR040-SEC-09 is met.
- **D-TASK040-22 (32-byte check in `from-config`): accepted, with wording.**
  - The configuration still enforces exactly 32 bytes for `aes-256-gcm` material (`packages/config/src/keys.ts:477`). So `materialOf`'s check is a second line that names the variable, not a move.
  - It stays useful once the register row's material kind changes (R1-n1).

**Developer's open question (gap of up to `timeout` before the claim's commit):** confirmed real and quantified in R1-m1. It applies to the renewal as much as to the claim, and it matters only for the stretch after the last write.

## 5. Things worth keeping

- **Origin inside the authenticated envelope.** The origin marker (R3-M1) and now status and headers live inside the AES-GCM envelope, and the clear columns are reduced to checked copies. A database writer without the key can no longer choose what a replay sends.
- **Two derivations, both tested.** Each derivation has its own label, an independent HMAC oracle and the part-A P1 probe turned into a failing assertion (`open(MATERIAL)` throws).
- **The memory table now enforces the CHECKs** (`checkRow`). The unit and API suites therefore fail the way PostgreSQL would, instead of passing on rows the database refuses.
- **PR040-SEC-07 pins work on the dereferenced contract,** with planted negatives in both directions: a new member is named, and an example-only or 4xx-only secret is not.
- **The client-secret test builds the value at run time.** No secret-shaped literal enters the gitleaks range (PR33-SEC-08 lesson).

## 6. Merge conditions

- **C1 — R1-m1.** The architect's ruling on amendment 10, recorded in DECISIONS.
  - If the recommended remainder term is accepted: the fix in `execute.ts` and the test stretch model, then a delta review (one term plus the test).
  - If the residual is accepted instead: the ruling and the JSDoc wording.
- **C2 — Security round 1 on the final head** for PR040-SEC-01, -02, -04 (with R1-m1), -07 and -09. The purge conditions P-1 to P-5 belong to PR 2.
- **C3 — R1-m2.** The migration is re-timed after `20261121000000_pricing_config_versions`, the three references are updated and `db:lint-migrations` is clean.
- **C4 — At merge,** the migration directory sorts after every directory on `origin/main`. If a later main migration overtakes it, re-time again.
- **C5 — Merge order.** Part 040-A (#80) is on main first. This PR merges before PR 2 and before any composition mounts an idempotent route, so no row is ever written in the part-A form (the brief's merge condition; D-TASK040-19 relies on it). TASK-293 is on main (PR #72) as the migration prerequisite.
- **C6 — Stacked merge procedure (D-ORCH-158).** The repository squash-merges, so after #80's squash, merging `origin/main` into this branch conflicts on the delta files that #80 added or changed (add/add with different content).
  1. Resolve every conflicted file to the blob at this branch's head.
  2. Before the merge-only rounds, prove that `git diff --raw <origin/main> <merge>` equals `git diff --raw 0f0d92a0 <stacked head>` (old and new blobs; with the R1-m1/R1-m2 fixes, against the fixed head).
  3. A mismatch on any delta file means main changed that file after #80. That file then needs a hand union, not the stacked blob.
  4. Then run a merge-only code review and security round, a fresh lane B PASS on PostgreSQL 18 on the merged head (D-ORCH-156 is diagnostic only), and the hosted CI with the expected lane A extras `security-integration` and `migration-lint`.
- **C7 — Records.** Rename this record to `PR-<NNNN>-TASK-040B1-code-review.md` once the PR exists, and run the merge-ref check.
- **C8 — Riders, not merge conditions of this PR.**
  - R1-n1: the owner named by the orchestrator.
  - PR 2: pass `DB_TENANT_ADMISSION_WAIT_MS` to `ExecuteOptions.admissionWaitMs` from `createApp`, next to proof (g) (one `problemTypeBase` source).
  - The NITs R1-n2 to R1-n5 may ride the R1-m1/R1-m2 fix commit.
