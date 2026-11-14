# PR #42 — TASK-025 audit writer core, per-tenant admission bulkhead, audit lock_timeout → 503 — code review, round 1

- **PR:** https://github.com/sukhchdit/shipcube/pull/42 · branch `feat/TASK-025-audit-writer-core` · head `e7dfbac4e5117de03ff1d6bf424c0755d5982d6a`
- **Reviewer:** code-reviewer · 2026-11-14 · round 1
- **Inputs:** PR body (D-TASK025-01..11, gate table); `git diff origin/main...e7dfbac` (46 files); WAVE-00.md TASK-025 card (incl. the D-ARCH-115 review requirement), TASK-029/030/033 cards; ADR-0007 amendment 10; data-model §5.4, §7.7; `prisma/bootstrap/10-audit.sql`; the SPK-04 harness `prisma/tests/spikes/spk04/chain.test.ts` on main; evidence `docs/05-quality/tests/runs/20261114T0246Z_ab8fea1/`.

```
VERDICT: CHANGES_REQUESTED
SUMMARY: Statements 1/1b/2/2b/4 follow data-model §5.4, the chain hash reproduces the SPK-04 pinned vector, ≤ 2 round trips run
         under the head lock, and the error translation and the bulkhead are correct and well tested (30 of 34 mutants killed, the
         other 4 equivalent or reachable only through m2). One MAJOR: the new write-capable export createPrismaAuditStore escapes
         the REQ-AUDIT-001 writer allow-list lint (probe-proven). The fix is one config line plus a fixture.
FINDINGS: 1 MAJOR, 5 MINOR, 10 NIT (section 3)
```

## 1. Verification I performed myself

| Check | Result |
|---|---|
| Unit: `packages/audit/src/{writer,store/prisma-store,entry-hash,errors}.test.ts` in the PR worktree | 4 suites, 46/46 pass |
| Unit and api in a scratch copy (git archive of e7dfbac, junction to the worktree's node_modules): entry, network, actions, tenant-admission, with-tenant-tx, runtime, audit-failure.api | all pass (the actions parity test also passes once `prisma/bootstrap` is in the copy) |
| Prettier `--check` on every changed `.ts/.mjs/.json` file (docs and lock excluded) | clean |
| ESLint `--max-warnings 0` on `prisma-store.ts`, `tenant-admission.ts`, `entry.ts` (real config) | exit 0 |
| SPK-04 pinned vector | `PINNED_FIRST` and `EXPECTED_CANONICAL` in `entry-hash.test.ts` are byte-identical to main's `prisma/tests/spikes/spk04/chain.test.ts`. `computeEntryHash` reproduces the vector and an independent SHA-256 of the hand-written canonical text. |
| Vocabularies vs database CHECKs | I compared `10-audit.sql` by hand: actions (18), actor types, outcomes, source apps, vault classifications and the correlation-id pattern (`^[A-Za-z0-9-]{8,64}$` = `CORRELATION_ID_PATTERN`) all match. The parity test parses the file. |
| Mutation spot-check (35 sed-style mutants, writer, store, errors, entry, hash, bulkhead, withTenantTx and runtime wiring; script in the scratchpad) | **30 killed**. Survivors: S4 (`first` = last row; equivalent because `sameKeys` holds); T3 (drop `queued === 0` from the fast path; equivalent, since direct hand-off means a free permit never coexists with a waiter); T4 (drop `dropIfIdle` in the timer; equivalent, since a waiter only exists while `inflight == cap`); N3 (drop the `cursor !== jsonPiiCount` check; reachable only through the m2 TOCTOU path). K1 was a no-op typo of mine and is excluded. |
| Probes | (a) lint exemption narrowness, using the rule's own `FORMS` (m1); (b) TOCTOU through the tokeniser await (m2); (c) Joi vs lone surrogate vs the pg encoding (m3); (d) `platform/audit-writer-allowlist` via ESLint `Linter` on a feature-module filename (M1) |
| Unions (`git merge-tree`) | #40 (ee64946): clean. main (34c8244): clean. #41 (deps): clean. #43 (TASK-024): clean. #39 (TASK-014, 894c72e): one textual conflict, `packages/config/src/values.test.ts` `GUARDS.length` 13 vs 14 (resolution: 15), plus one semantic item (section 6) |
| Evidence `20261114T0246Z_ab8fea1` | Verdict PASS. Suites: api 127, catalog 74, integration 279 (1 pre-existing skip), unit 4552. `git diff --name-only ab8fea1 e7dfbac` = evidence files only. The integration JUnit contains the 12 AT-US-087/088 cases and the D-ARCH-086 admission case. `coverage-summary.json`: packages/audit lines 1267/1267 and branches 391/395, as the body states. Partial files: entry 99.52 %, errors 97.87 %, network 93.93 % branches. tenant-admission 99.57/97.5, with-tenant-tx 97.7/97.91. |
| CI on head (run 43549201001) | fast-lane: success, every step executed. scans: only the "Security-owned paths need a review record" step failed (expected). ci-gate: red, because it aggregates scans. |

**Not re-run (per brief):** Docker, Testcontainers suites, lane B, the full lint/typecheck/build. For those I relied on the evidence above.

## 2. What was checked, and how it came out

**Statements vs data-model §5.4**
- **1 (vault INSERT).** One multi-row `INSERT … SELECT FROM unnest(…)` with multi-argument `unnest` left unqualified and `ON CONFLICT (subject_id, entity_name, field, value_hmac) DO NOTHING`.
  - One deviation: bytea values travel as hex `text[]` decoded in SQL, not as `$n::bytea[]` (n2).
- **1b (token lookup).** A separate statement: `WITH ORDINALITY … CROSS JOIN LATERAL … LIMIT 1`, with tokens mapped back by ordinal and every slot required.
- **2 (lock).** The `MATERIALIZED` CTE runs `pg_catalog.set_config('lock_timeout', $n, true)`, then `FOR UPDATE OF h`. Head, hash and clock come back in one round trip; microseconds are read via `extract(epoch …)` unqualified.
- **2b (create head).** `INSERT … ON CONFLICT (stream_id) DO NOTHING` with the zero hash as `decode(repeat('00',32),'hex')`. Never the text form.
- **4 (append).** One CTE does the INSERT plus the head UPDATE. No `RETURNING`. The `WHERE entry_count = seq-1` condition plus `affected !== 1` gives `HEAD_MOVED`.
- **Hash.** `entry_hash = SHA-256(UTF-8(JCS(canonical)) ‖ prev)` over the 35 columns. `occurred_at = max(now, head+1µs)`.
- **Proof against the stored row.** The integration test recomputes the hash from the stored database representation (jsonb, inet, bytea, timestamps). The IPv6 `/48` text was checked against PostgreSQL's `inet` output for 8 shapes.

**Round trips under the lock.** The writer tokenises (statements 1 and 1b) before calling `append`. `append` then locks, hashes in process and appends. `withTenantTx` runs nothing between the callback and COMMIT. That makes 2 round trips under the lock (statement 4 + COMMIT) for one entry per transaction. A second entry in the same transaction breaks the budget (m4).

**Error translation (`withTenantTx`)**
- `mapped()` checks `isAuditWriteError` first.
  - 55P03 gives 503 `SERVICE_UNAVAILABLE` with `Retry-After: 1` and reason `AUDIT_LOCK_TIMEOUT`.
  - Every other kind gives 500 `AUDIT_WRITE_FAILED`.
- **Original error.** It travels through a WeakMap to `onDbError` only. It is not on `cause` or `message`, and `toJSON` carries only safe fields. Mutant X1 (log the wrapper) is killed.
- **Rollback.** The callback throws, so Prisma rolls back. The integration tests prove it for 22023, 23505, 55P03 (held row: 503 well under the 2 s timeout) and the missing partition.

**Bulkhead**
- **Acquire and release.** Acquired from the validated values before `$transaction` and released in `finally`. A rejection or a synchronous throw cannot leak a permit; unit and integration tests both assert empty snapshots afterwards.
- **Queueing.** FIFO with direct hand-off and no barging. The wait timer is cleared on hand-off.
- **Overflow.** Depth = 2 × cap, refused at once. Wait expiry unlinks in O(1). Idle keys are dropped.
- **Keys.** Keys are per tenant (org UUID, `anonymous`, `operator`), and the operator key is never the organisation's.
- **Config.**
  - `DB_TENANT_MAX_CONCURRENT_TX` must be ≤ `DB_POOL_MAX` (guard). Unset means `max(2, floor(poolMax/2))`.
  - The wait is 1..2000 at load and ≤ maxWait at build. The parity with `DEFAULT_MAX_WAIT_MS` is pinned.
  - `DB_AUDIT_LOCK_TIMEOUT_MS` must be < `DB_TX_LOCK_TIMEOUT_MS` (guard). Its maximum, 59 999, sits inside the store's 1..60 000.
  - D-TASK025-10 holds.
- **Abort.** `withTenantTx` has no AbortSignal. A disconnected client keeps its queue slot until the wait expires. That is not a leak (n7).

## 3. Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| **R1-M1** | **MAJOR** | `packages/audit/src/index.ts:59` (export) · `eslint.config.mjs:815` · `tools/eslint-rules/audit-writer-allowlist.mjs:12` | **The new write-capable export escapes the REQ-AUDIT-001 writer allow-list.** `platform/audit-writer-allowlist` runs with its default `writerExports` (`AuditWriter`, `createAuditWriter`, `writeAuditEntry`). This PR adds `createPrismaAuditStore` to the package root. Its `append(db, row)` writes ANY row without `prepareEntry` (forged action, actor, outcome, `$pii` references; the PR's own AT-US-087-05 test does exactly that), and `insertVaultRows` writes vault rows for any subject. Probe (real rule, `Linter`, filename `apps/api/src/modules/addresses/service/create.ts`): importing `createAuditWriter` is reported; importing `createPrismaAuditStore` is **not**. Boundaries let api modules import `@platform/audit`, so this lint is the only control. | Pass `writerExports: ['AuditWriter', 'createAuditWriter', 'writeAuditEntry', 'createPrismaAuditStore']` to the rule in eslint.config.mjs. Alternatively, move the store to a subpath `@platform/audit/store` and extend `WRITER_MODULE` to `writer\|store`. Add a negative fixture (a module service importing the store fails) and a positive one (`apps/api/src/platform/audit/**` passes). `prisma/tests/**` stays outside the rule (test files). eslint.config.mjs is security-owned, so the security record must name the new head. |
| R1-m1 | MINOR | `packages/audit/src/store/prisma-store.test.ts:222-226` (pin) · `eslint.config.mjs:206` (exemption) | **The lint exemption is exact-file but the pin is not tight.** The store gets `allow: ['setter']`. The unit pin collects `/set_config\(([^)]*)\)/g` (case-sensitive, no whitespace) and bans the text `app.`. Probe with the rule's own `FORMS`: `set_config ('ap' \|\| 'p.org_id', …, true)`, `SET_CONFIG('ap' \|\| …)`, `set_config\n(…)` and `set_config ( ${key}, …)` with a bound key each pass BOTH the lint (no other form fires) and the pin. A second setter could rewrite `app.org_id` for the rest of the business transaction (an RLS context change). | Pin with the rule's own setter pattern. In the comment-stripped code, `code.match(/set_config/giu)` must have exactly 1 hit, and that hit must be `pg_catalog.set_config('lock_timeout', ${lockTimeoutMs}, true)` (exact substring). Keep the `app.` ban. Add a mutation self-test of the pin (inject one variant and expect failure). |
| R1-m2 | MINOR | `packages/audit/src/entry.ts:417` (validate) vs `:443` (substitute) · `writer.ts:92-93` | **Validate-then-use on the live caller graph.** `collect` validates `oldValue/newValue/details` at prepare time, and `complete()` re-walks the SAME caller objects after `await tokenise(...)`. Probe: after `prepareEntry`, adding `$pii` (a forged marker), a NUL string or a `Date` (stored as `{}`) to the input object, or doing so from another task during the tokeniser await, puts them into the row and the chain unvalidated. The D-TASK025-06 claim "a forged marker is refused" holds only at prepare time. N3 is the only guard and covers only a PII-count change. | Make `collect` return a validated, frozen deep snapshot (plain objects, arrays and primitives, with `PiiValue` leaves), and have `complete()` substitute over that snapshot only. Add a test that mutates the input inside a slow tokeniser and asserts the stored row equals the validated one. |
| R1-m3 | MINOR | `packages/audit/src/entry.ts:183-185, 261, 276` | **Client-controllable 500.** A lone surrogate in any business string (`"\ud800"` is valid JSON; Joi `string()` accepts it, as probed; pg stores U+FFFD, bytes `50efbfbd…`) makes `collect` refuse the entry. The otherwise valid mutation then answers 500 `AUDIT_WRITE_FAILED`. Any client can produce 5xx at will, which feeds the ROLLBACK_TRIGGERS error-rate signal. | Preferred: normalise strings with `String.prototype.toWellFormed()` in the snapshot of m2. The result is byte-identical to what pg stores, so hash and row agree. Keep the NUL refusal (pg rejects NUL in text/jsonb anyway). Alternatively, route a 400 boundary rule to TASK-029/TASK-100 and record the decision. Either way, record it (amends D-TASK025-06). |
| R1-m4 | MINOR | `packages/audit/src/writer.ts:90-99` (design; route) | **Several entries in one transaction break the §5.4 budget.** ADR-0007 has the state machine writing `STATE_TRANSITION` through the writer, and the capture middleware writes the mutation entry in the same business transaction. A second `write()` runs its vault statements and its `lockHead` after the first entry's head lock is held, which gives more than 2 round trips under the lock. Its vault `INSERT … ON CONFLICT` can also wait on a row another transaction inserted while that one waits for our head lock. That is a deadlock window, broken only by the 250 ms `lock_timeout`, so it surfaces as 503. "Without an interface change" (D-ARCH-085) does not cover this case. | Not blocking this PR. Route to principal-architect with TASK-029/TASK-030: either `writeAll(db, entries)` (tokenise every entry first, then lock streams in sorted `stream_id` order, then one append per stream) or a per-transaction guard that refuses a second `write()`. Meanwhile add a JSDoc line: one `write()` per transaction. |
| R1-m5 | MINOR | PR body traceability · WAVE-00.md TASK-025 card (process) | **US-087 cannot be marked complete by this PR.** The card says TASK-025 completes US-087 (DC) and must cover AT-US-087-01..08. AT-087-04 (spoofed XFF, HTTP layer), -07 (DB CHECK lacks `MFA_RECOVERY_USED`/`SESSION_REVOKED`, D-TASK025-03) and -08 (viewer) are left open. The deferrals are reasonable, but no owner AC names them yet. | Orchestrator: route -04 to TASK-029 or the trust-proxy owner, -07 to a principal-architect ruling plus a bootstrap-lane CHECK widening (rule 12, security-approved marker) with the writer list and catalog C9 following, and -08 to the viewer task. Put each ID into its owner's AC, and update traceability to show US-087 as partial. |
| R1-n1 | NIT | `prisma-store.ts:194-201` | When statement 2 returns no row, whether the CTE ran depends on the plan, so statement 2b can wait (on a concurrent first inserter's transaction) under the 2 s transaction `lock_timeout`, not 250 ms. This happens once per stream. | Document it in the JSDoc, or have TASK-030 E2 cover 2b. |
| R1-n2 | NIT | `prisma-store.ts:220-235` | bytea arrays are bound as hex `text[]` and decoded in SQL. Data-model §5.4 rule (c) and the TASK-030 card say `$n::bytea[]`. This is a deviation with no D-entry. | Record it as D-TASK025-12 (with the reason, e.g. the adapter's Buffer[] binding). TASK-030 E4's EXPLAIN must test this shape. |
| R1-n3 | NIT | `entry.ts:270, 277` · `errors.ts:159` | The `field` path of `INVALID_ENTRY` concatenates JSON object keys from business data and is logged through `toJSON`. A map keyed by e-mail or name would put personal data into logs (guardrail 0). | Record the top-level field plus array indices only, and replace object keys beyond depth 1 with `{key}`. |
| R1-n4 | NIT | `writer.ts:84-87` | An IP-index (HMAC) failure is reported as `INVALID_ENTRY`, so an infrastructure fault reads as a caller bug in logs. | Use a distinct kind (e.g. `IP_INDEX_FAILED`) or `DATABASE_ERROR`. |
| R1-n5 | NIT | `packages/config/src/schema.ts` (`DB_AUDIT_LOCK_TIMEOUT_MS`) | The key has no runtime consumer yet. "Validated below `DB_TX_LOCK_TIMEOUT_MS`" holds only once the composition passes the config value to `createAuditWriter`. | Name it in TASK-029's AC, or export an `auditWriterFromConfig(config, …)`. |
| R1-n6 | NIT | `errors.ts:191` · `with-tenant-tx.ts:383` | `isAuditWriteError` is an `instanceof` check. Two module instances (source vs dist) would turn a 503 into a 500 `INTERNAL_ERROR`. | Brand the class (`Symbol.for('platform.audit.AuditWriteError')`) and check the brand. |
| R1-n7 | NIT | `apps/api/src/platform/db/tenant-admission.ts:180` | Wait timers are not `unref()`'d, so shutdown can be held for up to `waitMs`. Without an AbortSignal, an aborted request holds its queue slot until expiry. Neither is a leak. | `unref` the global timers, and optionally accept a signal in `run`. |
| R1-n8 | NIT | `apps/api/src/platform/db/tenant-admission.int.test.ts:194` | `elapsedB < 100` is a wall-clock bound in a required suite on the shared host. The AC mandates it and the headroom is about 20×. | Keep it, but watch for flakes (PR #7 precedent: opt-in flag if it flakes). |
| R1-n9 | NIT | `prisma/tests/audit/audit-writer.int.test.ts:577-598` | AT-US-088-07 asserts only the SQLSTATE. The `PARTITION_MISSING` classification against the real driver message (the `lc_messages` prefix) is tested only with a fake. | Catch the `AuditWriteError` in the callback and assert `kind === 'PARTITION_MISSING'` before rethrowing. |
| R1-n10 | NIT | data-model §7.7 (route, not a defect) | All guest and public transactions of a process share the one `anonymous` key (per spec). It is likely to be the hottest key at the NFR-PERF-001 mix. | performance-engineer and TASK-280: report `db_tenant_admission_rejected_total` for the anonymous key in the `audit-ab` run. |

## 4. Deviation rulings

| Decision | Ruling |
|---|---|
| D-TASK025-01: lock timeout = catalogued 503 `SERVICE_UNAVAILABLE`, reason log-only | **Accepted.** It matches the `TENANT_CONCURRENCY_LIMIT` pattern and openapi. A distinct public code is a contract change request. |
| D-TASK025-02: translation in `withTenantTx`; every 55P03 during the write is 503 | **Accepted.** This includes vault statements (run under the 2 s transaction timeout) and the partition window of am. 10 item 2. It couples platform/db to `@platform/audit`, which is acceptable. n6 is a hardening nit. |
| D-TASK025-03: action list = database CHECK; AT-US-087-07 open | **Accepted.** A type that admits values the database refuses would be worse. Routing is in R1-m5. |
| D-TASK025-04: the store writes the chain now | **Accepted as necessary** (`prev_hash`, `entry_hash`, `stream_seq` are NOT NULL). The orchestrator should amend the TASK-030 card. The statements and hasher now live in `store/prisma-store.ts` and `entry-hash.ts`; TASK-030 moves them to `chain/**` and proves them (E1 sequence spy against this file, E2 already partly shown by AT-US-088-03, E3, E4). The pinned vector is already reproduced in `packages/audit/src/entry-hash.test.ts`, so TASK-030's lifecycle step only deletes the spike `chain*`/`canonical*` files. The m4 multi-entry design belongs in TASK-030's scope. |
| D-TASK025-05: random SYSTEM shard by default | **Accepted.** SEC-TC-57 stays with TASK-030. |
| D-TASK025-06: personal-value markers, one tokeniser batch | **Accepted, amended by R1-m2/m3.** The marker refusal must hold on the stored value, and lone surrogates should be normalised (or refused at the boundary) rather than turned into a 500. |
| D-TASK025-07: outcome rules | **Accepted.** DENIED-only, STATE_TRANSITION old and new, reserved actor ids and SYSTEM_JOB user are each killed by a mutant. |
| D-TASK025-08: `setter` exemption for exactly `prisma-store.ts` | **Accepted, provided R1-m1 is fixed.** The exemption is exact-file, but its pin must use the rule's own pattern. |
| D-TASK025-09: `prisma/tests/audit/**` → `package-audit` only; prisma devDependency; co-located unit tests | **Accepted.** Categories are cumulative (heuristic from PR #19). The new category adds only the one `to` target for that folder, and `package-audit` appears in no other policy, so nothing else widens. The lock delta is one workspace link. |
| D-TASK025-10: admission defaults | **Accepted.** Verified in section 2. Every `createDatabaseRuntime` runner, including the worker through `services.ts`, now has the bulkhead, which matches data-model §7.7 ("every caller … without opting in"). TASK-047 keeps the worker-specific keys. |
| D-TASK025-11: `.env.example` appended, compose.env not | **Accepted.** I could not diff `.env.example` (a permissions deny rule), so I relied on the load-config parity tests in the evidence. |

## 5. Merge conditions

1. Fix R1-M1 in this PR. R1-m1 and R1-m2 should also be fixed here (both cheap). For R1-m3, either fix it here or record the decision with an owner. R1-m4 and R1-m5 go into DECISIONS and their owners' AC (orchestrator).
2. **PR #40 first (D-ORCH-047/056).** The union with ee64946 is textually clean (`git merge-tree`). After #40 merges, the branch merges main, and the union must keep the following:
   - lane B runs the **merged** `test:coverage` and `coverage:gate` over unit + integration, and the gate judges `packages/audit` against 95/95;
   - the PR body re-quotes the **merged** packages/audit lines and branches from the new evidence (D-ARCH-115). Cross-check the uncovered branch COUNT, not only the percentage, because PR #40 r1 found that the merged branch percentage over-reports. The unit-only 391/395 here is a floor: the merged uncovered count must be ≤ 4;
   - fresh lane B evidence on the merge commit;
   - qa-lead later adds `coverage gate: packages/audit lines` and `coverage gate: packages/audit branches` to `unit.required_cases` (manifest-only PR).
3. **Whichever of #42 and #39 (TASK-014) merges second** must do two things:
   - resolve `packages/config/src/values.test.ts` to `GUARDS.length === 15`;
   - give the admission `TenantTxConfigError`s #39's `variable` argument (`DB_TENANT_ADMISSION_WAIT_MS`, `DB_TENANT_MAX_CONCURRENT_TX`). Today they default to `'DB_TX_*'`, so the exit-78 message would name the wrong key.

   The #39 api and worker images must ship `packages/audit` (with `canonicalize`), because with-tenant-tx now imports it at runtime.
4. Security-analyst record `PR-0042-*` on the FINAL head. 31 security-owned paths are touched, including eslint.config.mjs, package-lock.json and `apps/api/src/platform/db/**`. The scans step is red only for that.
5. Round 2 will be a delta review: the M1 fixture and config, the m1 pin with a mutation, the m2 snapshot test, the m3 decision, and the #40 union evidence.

## 6. Good — patterns worth keeping

- **WeakMap-held cause.** The original failure never sits on the error object, so loggers cannot reach the server text, and `onDbError` is the only consumer. The api test asserts it end to end over real HTTP.
- **Integration tests on the stored row.** Hashes are recomputed from the stored row, not from the input, and the coarse-IP text is checked against PostgreSQL's own `inet` output. Both are the right integrity proofs for a chain.
- **The held-row test.** It proves the CTE `lock_timeout` binds before the LockRows wait (503 well under the 2 s transaction timeout) and that the retry then produces exactly one change and one entry.
- **Bulkhead tests.** A manual clock, direct hand-off assertions (timer count, no barging), and permit/connection leak checks against a real pool (`pg_stat_activity` + a refilled pool).
- **The hasher seam (`EntryHasher`).** It let the integration test produce a REAL 22023 inside the audit INSERT for AT-US-088-01, rather than a fake.
- **Vocabulary parity.** The test parses `10-audit.sql`, and a compile-time proof shows descriptor actions are entry actions.

## 7. Security flags (for security-analyst)

- **R1-M1 (REQ-AUDIT-001).** The store and the vault writer can be imported from feature code without a lint finding. Audit-entry and vault-row forgery by application code.
- **R1-m1.** The `setter` exemption on `prisma-store.ts`: four spellings pass both the lint and the pin, and a second setter could change `app.*` within a tenant transaction.
- **R1-m2.** The forged `$pii` marker refusal can be bypassed through the validate/use gap.
- **R1-m3.** Client-triggerable 500s count toward the rollback-trigger error rate.
- **R1-n3.** Business JSON keys can reach logs through the `INVALID_ENTRY` field path.
- **INFO.** The writer trusts `entry.orgId`/`streamId` and does not compare them with the transaction's `app.org_id`. `audit_entries` has no RLS, so a capture bug could write org B's stream from org A's transaction. Consider a cheap equality check in TASK-029.


---

# Round 2 (head d2ef478)

- **Head:** `d2ef478501052ef6e2088268d3b06fb5dd4ab4dd` (code head `7af2ef8`; `9262c6c` adds evidence only, and `d2ef478` merges main's docs and `.claude` files).
- **Reviewer:** code-reviewer · 2026-11-14 · round 2 (delta after fix cycle 1 and the union with main, which includes PR #38 and PR #40).
- **Inputs:**
  - fix commits `cd46414`, `5ba9b71`, `a16ce0f`, `01e9809`;
  - merges `b69854a`, `7af2ef8`, `d2ef478`;
  - PR comment issuecomment-6873943769 and the PR body (D-TASK025-12..21);
  - evidence `docs/05-quality/tests/runs/20261114T0713Z_7af2ef8/`;
  - Lane A run 43573446773;
  - D-ARCH-120..122, D-ARCH-125 and D-SEC-PR42-01 in main's DECISIONS.md;
  - REQ-AUDIT-001 (REQUIREMENTS.md line 179).

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The round-1 findings are fixed and proven. R1-M1 store/assembler exports are now writer exports, with firing fixtures.
         The SEC-02 latch is sound (7/7 mutants killed), the frozen snapshot closes the round-1 bypasses, and the setter pin
         uses the rule's own pattern. wellFormed equals toWellFormed (0 differences over 299,593 strings), and the unions
         are pure. One NEW MAJOR, introduced by the R1-n5 fix: apps/api/src/platform/audit/writer.ts
         (auditWriterFromConfig) re-exports the writer from an allow-listed folder, and a feature module imports it
         without a lint finding (probe). The fix is one boundaries policy plus a fixture.
FINDINGS: 1 MAJOR (new), 1 MINOR (route), 3 NIT
```

## R2.1 Verification I performed myself

| Check | Result |
|---|---|
| Unit tests, run in a scratch copy (git archive of `d2ef478` with a junction to the worktree's node_modules). Paths: `packages/audit/src/**`, `apps/api/src/platform/db/{with-tenant-tx,tenant-db,system-db,tenant-admission}.test.ts`, `apps/api/src/platform/audit/writer.test.ts` (paths first, then `--selectProjects unit`) | 12 suites, 291/291 pass |
| `tools/lint/negative-fixtures.test.ts -t "audit-writer-allowlist\|PR42-SEC-07"` | 7/7 pass: the 2 new negative fixtures, the 2 new positive fixtures and the AuditSqlPort T-83 fixture fire as declared |
| Lint probe: the real `eslint.config.mjs`, untyped, 11 probe files under `apps/api/src/modules/addresses/service/` and `apps/worker/src/jobs/` | `createPrismaAuditStore`, aliased `prepareEntry as p`, `export { createPrismaAuditStore } from`, `import('@platform/audit')` and the worker's `createAuditWriter` are each **reported**. Relative imports into `packages/audit/src/{store/prisma-store,entry}.js` give `import-x/no-relative-packages`, and the `@platform/audit/src/...` subpath gives `no-unresolved` (the package exports only `.`). Pure helpers and type-only imports are clean. **`import { auditWriterFromConfig } from '../../../platform/audit/writer.js'` is CLEAN (R2-M1).** |
| Mutation spot-check: 26 sed-style mutants run against the targeted test files (script in the scratchpad, `review/PR-42-cr2-mutate.mjs`) | **21 killed.** Latch: L1 drop the rethrow, L2 last-wins, L3 no closed check, L4 the writer does not mark, L5 prepare/tokenise moved outside the try, L6 latch overrides the callback's own throw, L7 `$parent` exposed. Snapshot: S1/S2 return the caller's array/object, S3 tokenise the caller's PiiValue, S4 drop the marker refusal, S5 drop the collision refusal. Guards: N1 identity `wellFormed`, N3 NUL, N4 field-path depth, N5 `@` in entity id, N6 shape check, N7 route segments. Config: C1 drop `createPrismaAuditStore`, C2 drop `prepareEntry`, C3 drop `AuditSqlPort` from T-83. Setter pin on the real file: P1 `SET_CONFIG (${k}, …)`, P2 bound `lock_timeout` key. **Survivors:** S6 and S7 are equivalent (S6 still reads once; S7 freezes a writer-built array). N2 (`gu` on the replace regex) is equivalent: in Unicode mode the class still matches exactly the lone halves. N9 (`s` flag) is equivalent, because a zone with a newline fails `isIPv6` either way. **N8** (`instanceof` instead of the brand) survives: R2-n3. **P3** (a second setter hidden between `'/*'` and `'*/'` string literals) survives: R2-n2. |
| Snapshot probes: the round-1 probe (b), re-run with tsx and `--conditions=@platform/source` (`review/PR-42-cr2-probe-toctou.mts`) | Closed. After prepare, a forged `$pii`, NUL, Date or changed value gives `{"a":"x"}`. A two-faced accessor on a JSON member, an array element or `input.outcome` is read once (reads=1) and the first answer is kept. A PiiValue swapped after prepare does not reach the row, and the tokeniser receives copies (`sameObj=false`). **Residual (R2-n1):** `actor.roles` with an own `map` gives `["not a role key; DROP",42]`, and a Proxy that answers `length` 1 and then 40 gives 40 roles past `MAX_ROLES` = 32. |
| R1-m3 equivalence | Exhaustive differential of `wellFormed` (the regex taken from the source; it has no `u` flag) against Node 24's `String.prototype.toWellFormed`: every string of length 0–6 over {a, D800, DBFF, DC00, DFFF, FFFD, both halves of U+1F600} gives **0 of 299,593 different**. The repo's own fast-check test (seed 125, 400 runs) also kills N1. |
| (h) `?? ''` removal in network.ts | `ip.split('%')[0]` is never `undefined` (split returns at least one element), so the fallback was dead. `replace(/%.*$/su, '')` against `split('%')[0]`, exhaustively over {a, :, %, \n, 1} for lengths 0–7: **0 of 97,656 different**. Safe. |
| Route-template guard vs the contract | All 109 paths in `docs/03-architecture/api/openapi.yaml` pass `ROUTE_SEGMENT`. Express 5 wildcards and optional groups (`/things/*rest`, `/things{/:x}`) are already refused by `define-route` (define-route.test.ts:82-83), so the guards agree. |
| Unions (j) | Each of `b69854a`, `7af2ef8` and `d2ef478` equals `git merge-tree --write-tree p1 p2` byte for byte (`git diff --stat <tree> <merge>` is empty), so all three are pure. Between `7af2ef8` and `d2ef478` the only non-docs changes are `.claude/agent-memory/security-analyst/*`. `git merge-tree HEAD origin/main` (47bac24: PR #45 `.gitleaks.toml`, `tools/ci/sec-static.test.ts`, `tools/quality/gitleaks-baseline.txt`) is clean. |
| Evidence `20261114T0713Z_7af2ef8` | PASS. Results: api 127, catalog 74, integration 282 (1 pre-existing skip), unit 4706 (2 skips). Merged gate PASS. I recomputed packages/audit/src from `coverage-summary.json`: **lines 1413/1413, branches 433/433, 0 uncovered** (≤ 4, as round 1 required; the R2-m2 under-report caveat of PR #40 does not apply at 0). Other files: with-tenant-tx 116/117, tenant-db 147/147, tenant-admission 39/40, platform/audit/writer 2/2. The integration JUnit holds the three `[PR #42 fix cycle 1]` PostgreSQL 18 cases (swallowed INVALID_ENTRY → 500 with 0 rows; swallowed 55P03 → 503; lone surrogate stored as U+FFFD with the hash recomputed from the stored row). |
| (i) D-TASK025-21 | `unit.required_cases` gains `coverage gate: packages/audit lines` and `… branches`. Both match `COVERAGE_CASE` (lib/manifest.mjs:33), and both appear in the evidence's `unit.junit.xml` with `classname="unit"`. Base-manifest semantics apply, so they are judged from the next PR on. Lane A "Lane B evidence" passed on `d2ef478`. |
| CI on head `d2ef478` (run 43573446773) | fast-lane: success, every step executed (lint, format, type-check, unit, base-ref negative fixtures, build). scans: only "Security-owned paths need a review record" failed (expected; no round-2 security record names this head yet). ci-gate: red because it aggregates scans. |

**Not re-run (per brief):** Docker, Testcontainers, lane B, full lint/typecheck/build. For those I relied on the evidence and Lane A above.

## R2.2 Round-1 closure

| ID | Status | How verified |
|---|---|---|
| R1-M1 | **Closed** for `@platform/audit`. `writerExports` = AuditWriter, createAuditWriter, writeAuditEntry, createPrismaAuditStore, prepareEntry. The remaining value exports (vocabularies and predicates, `pii`/`PiiValue`/`PII_MARKER`, `systemShardStreamId`, the hash functions, the error helpers, `canonicalIp`/`coarseNetwork`) write nothing. The fixtures fire, C1 and C2 are killed, and all four import forms are reported (probe). **But see R2-M1** for the same capability re-exported from `apps/api/src/platform/audit`. |
| R1-m1 | **Closed.** The pin is `/set_config/giu` over the comment-stripped code: exactly 1 hit, the exact allowed text, and no `app\s*.`. A drift guard reads the rule's `setter` pattern. The self-test has 7 variants, and P1 and P2 are killed on the real file. Residual: R2-n2. |
| R1-m2 | **Closed** (probes above). `collect` reads each node once and builds frozen, non-writable members with writer-owned `PiiValue` copies. `complete()` substitutes over the snapshot only, so removing the N3 cursor check is safe: the walk covers exactly the collected copies. Residual: R2-n1. |
| R1-m3 | **Closed.** Lone surrogates become U+FFFD in strings, keys, reason, user agent and personal values (proven equal to `toWellFormed`). Two keys that normalise to the same text are refused rather than silently merged. NUL is still refused, and its HTTP boundary 400 goes to TASK-029 (D-TASK025-13). |
| R1-m4 | **Ruled** by D-ARCH-122 (`record` + `flush`, TASK-029/030). The interim JSDoc "one `write()` per transaction" is on the module and on `AuditWriter.write`. |
| R1-m5 | **Ruled** by D-ARCH-125 (AT-04 → TASK-041, AT-07 → TASK-285 + TASK-059/061, AT-08 → TASK-073). |
| R1-n1 / n2 / n3 / n4 / n7 / n9 | **Closed.** n1: JSDoc on `lockedHead`. n2: D-TASK025-12 plus the header. n3: `memberPath` (N4 killed). n4: `IP_INDEX_FAILED`, tested. n7: the `unref` test asserts `hasRef() === false`. n9: AT-US-088-07 asserts `PARTITION_MISSING` against the real driver. |
| R1-n5 | **Closed as asked, but it opens R2-M1.** `auditWriterFromConfig` binds `DB_AUDIT_LOCK_TIMEOUT_MS`. |
| R1-n6 | **Implemented, not tested** (R2-n3). |
| R1-n8 / n10 | Kept (AC-mandated) / routed (D-ARCH-120, TASK-284, TASK-280). |

**(b) SEC-02 latch, each requirement verified:**
- **`markRollbackOnly` is a required port member.** It is a required member of `AuditSqlPort`. `TenantDb<T>` satisfies it through `TenantDbLatch`, the fake implements it, and the type-check is green.
- **The first failure wins.** `??=` (L2 killed). A non-Error is latched as a TypeError.
- **`withTenantTx` rethrows a marked failure after the callback returns.** The check sits after `await fn(...)` and before `return`, inside `$transaction`, so Prisma rolls back and `mapped()` answers 500 or 503 (L1 killed; integration shows 0 rows). This matters because PostgreSQL answers `COMMIT` on an aborted transaction with `ROLLBACK` and no error. Without the latch, a swallowed SQL-level refusal would have resolved as success after rolling the business row back.
- **The callback's own throw passes through.** The latch is not consulted on the throw path (L6 killed).
- **The writer marks on every path.** `prepare` and `tokenise` are now inside the `try` (L5 killed), and all six kinds mark exactly once.
- **The new `TenantDb` member does not widen reach.** It is a closure over the handle's own `rollbackOnly` and `state`, with no reference to `tx`. It cannot clear or read the latch (`rollbackOnly()` is on the handle, not on `db`). It is non-writable through the proxy, refused after `revoke()` (L3 killed), and not a Prisma member. `isAllowed` adds exactly one string key (L7 shows `$parent` stays denied). The systemDelegates guard does not expose it. Feature code calling it can only force a rollback, which it could already do by throwing.
- **Pins updated.** The `Reflect.ownKeys` pins in tenant-db.test, system-db.test and tenant-db.real-client.test are updated.

## R2.3 Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| **R2-M1** | **MAJOR** | `apps/api/src/platform/audit/writer.ts:13` (`auditWriterFromConfig`) · `eslint.config.mjs:123` (the allow-list folder) · `tools/eslint-rules/audit-writer-allowlist.mjs:13` (`WRITER_MODULE`) | **The audit writer is re-exported from an allow-listed folder, and feature code imports it without a finding.** The R1-n5 fix put a writer factory (`createAuditWriter` over `createPrismaAuditStore`) in `apps/api/src/platform/audit/**`. That folder is in `AUDIT_WRITER_ALLOW_LIST`, so the rule is off inside it, and nothing polices what it exports. The rule recognises the writer only by `@platform/audit` export names or a specifier ending `audit/src/writer`. Probe (real config, file `apps/api/src/modules/addresses/service/p7-platform-writer.service.ts`): `import { auditWriterFromConfig } from '../../../platform/audit/writer.js'` is **CLEAN**, and no boundaries policy stops `api-module` → `apps/api/src/platform/audit`. Any module can then write any validated entry (any action, actor or outcome) into its tenant's chain. That is exactly what REQ-AUDIT-001's acceptance ("a lint/test rule fails the build if the audit writer is imported outside packages/audit and its allow-listed callers") forbids. It has the same severity rationale as R1-M1: the lint is the only control, and the probe proves the gap. TASK-029 will add `captureAudit` and similar capabilities to the same folder, so the gap would widen. | Preferred: a resolved-file boundaries policy that cannot be evaded by spelling the path differently. Add a category for `apps/api/src/platform/audit/**` and an `audit-writer-caller` category built from `AUDIT_WRITER_ALLOW_LIST`. The policy is `from: { file: { categories: { anyOf: ['api-module'], noneOf: ['test', 'audit-writer-caller'] } } }` with a `disallow` on value imports into that category and a REQ-AUDIT-001 message. Type-only imports must stay allowed if TASK-029 descriptors need its types. Acceptable alternative: give the rule a second arm that matches the **`path.posix.normalize`d** relative specifier against `(?:^\|/)platform/audit/`, so `./`, `../audit/../audit` and `platform/./audit` spellings cannot slip past. Fixtures for either option: a negative one (`orders/service/bad-orders-platform-writer.service.ts` importing `../../../platform/audit/writer.js`, also as a re-export and a dynamic `import()`) and a positive one (an identity-module service importing it). Self-check by deleting the policy and confirming the fixture fails. eslint.config.mjs is security-owned, so the security record must name the new head. |
| R2-m1 | MINOR (route; not blocking) | `packages/audit/src/entry.ts:190, 192, 467-471, 488, 516` (PR42-SEC-04 shapes) | **The new shape guards refuse values that a client can shape, which gives a 500.** `uaParsed` will come from a UA parser (TASK-029). uap-style families are captured from the raw User-Agent, so a crafted UA can yield a family containing `;`, `,`, `@` or non-ASCII text. `entityId` on a denial or early entry may come from a path parameter before Joi validation (e.g. `/shipments/a@b`). In both cases the writer answers INVALID_ENTRY, which surfaces as 500 `AUDIT_WRITE_FAILED`. This is the R1-m3 class again: a client can produce 5xx at will, and that counts toward ROLLBACK_TRIGGERS. The writer is right to keep personal data out of the clear columns. The open question is who normalises. | Either put it in TASK-029's AC (the capture hook passes `uaParsed: null` when the parser output does not match `UA_PARSED`, and passes only a validated id (else `null`) as `entityId` on DENIED and pre-validation entries), or have the writer null these two columns instead of refusing them. Record the choice either way (it amends D-TASK025-16). `route` is server-side (registry templates) and can stay a refusal. |
| R2-n1 | NIT | `packages/audit/src/entry.ts:376-380` (`roles`) | `roles()` checks `Array.isArray` and `value.length` and then calls the caller's own `value.map(...)`. That call reads `length` again and can be replaced. Probe results: an own `map` puts `["not a role key; DROP",42]` into `actor_roles`, and the 42 would hash as a number but be stored as text, which breaks chain verification. A Proxy that answers `length` 1 and then 40 bypasses `MAX_ROLES`. This needs a hostile or buggy in-process caller (JSON cannot produce either shape), but the JSDoc of `prepareEntry` ("every property of the input is read exactly once") overclaims. | Read `length` once and index-loop, as `collect` does for arrays: `const n = value.length; if (n > MAX_ROLES) throw …; for (let i = 0; i < n; i += 1) out.push(matching(value[i], …))`. Add a probe-style test (own `map`, length flip). |
| R2-n2 | NIT | `packages/audit/src/store/prisma-store.test.ts:215` (`stripComments`) | The pin strips comments lexically, so the string literals `const o = '/*'` … `const c = '*/'` hide everything between them. A second `$queryRaw\`SELECT set_config(${k}, …, true)\`` placed there passes the pin (P3 survives). The lint is silent too: the file is exempt for `setter`, and `keys` needs a literal `app.` key. This takes deliberate effort, so it is a NIT. | Nothing in the file's comments contains `set_config` (grep finds exactly one occurrence, line 109), so count over the **raw** source and drop the stripping for the setter count. Alternatively, strip with the TypeScript scanner. |
| R2-n3 | NIT | `packages/audit/src/errors.ts:55, 98-99` | The R1-n6 brand has no test: N8 (back to `instanceof`) survives every audit and db suite. A brand is also forgeable in-process. That is acceptable, since a forged one maps to a generic 500/503, but it should be stated. | Add a unit test where an object with the `Symbol.for('platform.audit.AuditWriteError')` brand (a "second module copy") is recognised and keeps its `kind`/`reason` through `toAuditWriteError`, and a plain `Error` is not. One JSDoc line: the brand is a cross-copy marker, not an authenticity check. |

## R2.4 Rulings on D-TASK025-12..21

| Decision | Ruling |
|---|---|
| 12 hex `text[]` bytea | **Accepted.** The E4 EXPLAIN in TASK-030 must test this shape (D-ARCH-122). |
| 13 `wellFormed` and NUL refusal | **Accepted.** Equivalence proven (R2.1). The NUL 400 belongs to TASK-029. |
| 14 rollback-only latch | **Accepted** (R2.2 (b)). TASK-047's job context must implement the member (noted in the PR body). |
| 15 frozen snapshot | **Accepted**, with R2-n1. |
| 16 column guards; JSON key policy → TASK-028 | **Accepted**, amended by R2-m1 (who normalises client-shapeable `uaParsed`/`entityId`). |
| 17 `writerExports` option rather than a subpath | **Accepted** for `@platform/audit`. It is incomplete until R2-M1 covers the api-side composition folder. |
| 18 setter pin stays a test | **Accepted**, with R2-n2. |
| 19 `IP_INDEX_FAILED` and the `Symbol.for` brand | **Accepted**, with R2-n3. |
| 20 `auditWriterFromConfig` | **Accepted in substance:** the configured value is bound. Its location must be policed (R2-M1). |
| 21 gate cases in `unit.required_cases` in this PR | **Accepted.** The names conform and appear in the evidence. qa-lead acknowledges as asked. |

## R2.5 Merge conditions

1. **Fix R2-M1 in this PR** (policy or rule arm, fixtures and the self-check mutant). Round 3 is a delta: re-run the `p7` probe (and the `./` / `..` spellings if the rule arm is chosen), the new fixtures, and the mutant. R2-m1 needs either the fix or a recorded routing into TASK-029's AC. R2-n1..n3 are cheap, and fixing them here is welcome.
2. **Security record on the final head.** The current scans failure is only this record. The R2-M1 fix touches eslint.config.mjs and `tests/fixtures/lint/**`.
3. **Evidence.** If the fix is lint config plus fixtures only, the path rules of `quality:check-evidence` decide whether fresh lane B evidence is needed. Lane A must be green on the new head either way.
4. **Sequencing (unchanged from round 1 and from the dispatch):**
   - **With #44 (020-C):** whichever merges second adds `markRollbackOnly` to every 020-C `Reflect.ownKeys(db)` pin, uses `TENANT_CONCURRENCY_LIMIT`, and takes a per-phase admission permit.
   - **With #39 (TASK-014):** whichever merges second resolves `values.test.ts` to `GUARDS.length === 15` and gives the admission `TenantTxConfigError`s the `variable` argument. The #39 images must ship `packages/audit`.
5. **Merge style.** Squash, with no non-docs commit after the reviewed head other than the R2-M1 fix.

## R2.6 Good: patterns worth keeping

- **The latch design.** It is one closure with the first failure winning, revoked with the handle and checked only on the success path. That gives fail-closed commits without changing which error the callback surfaces. The tests prove it at three levels: writer, `withTenantTx` with a recording `$transaction`, and real PostgreSQL with zero rows persisted.
- **The snapshot.** `defineProperty` members (so a `__proto__` key stays a plain key), frozen arrays and objects, writer-owned `PiiValue` copies handed to the tokeniser, and a fast-check property that deep mutation after prepare never changes `complete()`.
- **Pins that test themselves.** The setter pin carries its own mutants and a drift guard that reads the rule's source pattern. The negative fixtures include a positive one for the allow-listed folder.
- **Removing dead branches.** The two `?? ''` fallbacks and the N3 cursor check were removed with a stated invariant instead of being covered artificially. This is how the merged diff gate should be answered.

## R2.7 Security flags (for security-analyst)

- **R2-M1 (REQ-AUDIT-001).** The writer is reachable from any api module through `apps/api/src/platform/audit/writer.ts`. Probe-proven, and introduced in fix cycle 1.
- **R2-m1.** Client-shapeable `uaParsed`/`entityId` become 500s (rollback-trigger signal), the same class as PR42-SEC-12.
- **R2-n1.** Unvalidated `actor_roles` through a caller-supplied `map`/length flip (in-process only; it breaks chain verification).
- **R2-n2.** A setter-pin residual that needs planted `'/*'`/`'*/'` literals.
- **INFO.** The `Symbol.for` brand is forgeable in-process (a generic 500/503 only).


---

# Round 3 (head 96bd37a)

- **Head:** `96bd37a7b9dc4d32fd57c6badd8db19b28e2116b`. The code head is `6e3ec99`; `96bd37a` adds the 8 evidence files only (`git diff --name-only 6e3ec99 96bd37a`).
- **Reviewer:** code-reviewer · 2026-11-14 · round 3. This is a delta review after fix cycle 2 and the unions with main (PR #43, #44, #45 and #47).
- **Inputs:**
  - fix commits `c459988` (PR42-SEC-13), `e02fec6` (R2-M1), `e789232` (R2-n1..n3), `13dd72a` (#44 union) and `8d346fa` (CI lint heap);
  - merges `c7636ec`, `5964962`, `c65f205` (#44), `7e9fb3c` and `6e3ec99` (#47);
  - PR comments issuecomment-6877867966 and -6879392983, and the PR body (D-TASK025-22..29);
  - evidence `docs/05-quality/tests/runs/20261114T1437Z_6e3ec99/`;
  - Lane A run 43608317119.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R2-M1 is closed. A resolved-file boundaries policy flags every spelling I tried (25 probe shapes, including ./, .., export *,
         createRequire, import(), side-effect and the tx slot taking the writer). Policy mutants: 7 of 10 killed (2 survive, R3-n1;
         1 equivalent). track/settle is sound: 10 of 12 mutants killed (1 equivalent, 1 an unpinned design choice). The NITs are
         fixed, all five merges are pure, and the CI heap line is a reasonable, fail-loud change. One new MINOR (R3-m1): the
         JSDoc endorses `void writer.write(…)`, but a voided write that fails is an unhandled rejection, and the API treats
         that as fatal.
FINDINGS: 0 BLOCKER, 0 MAJOR, 1 MINOR, 3 NIT
```

## R3.1 Verification I performed myself

| Check | Result |
|---|---|
| Scratch copy (`git archive 96bd37a`, junction to the worktree's node_modules) | Created under `review/PR-42-cr3` |
| Unit: `packages/audit/src` plus `apps/api/src/platform/db/{with-tenant-tx,tenant-db,system-db,tenant-admission}.test.ts`, `platform/audit/writer.test.ts`, `platform/tx/execute-phases.test.ts` (paths first, then `--selectProjects unit`) | 13 suites, **332/332 pass** |
| `tools/lint/negative-fixtures.test.ts -t "PR #42 R2-M1"` | **13/13 pass** (9 negative rows, 4 positive rows) |
| **Lint probe, round 3** (`review/PR-42-cr3-lintprobe.mjs`: the real `eslint.config.mjs`, untyped, 37 probe files across api modules, platform folders, the app root and the worker) | Details below |
| **Policy mutants** (`review/PR-42-cr3-mutate-lint.mjs`: 10 mutants of the eslint.config.mjs policy, then `-t "PR #42 R2-M1"`) | Details below |
| **Code mutants** (`review/PR-42-cr3-mutate.mjs`: 18 mutants) | Details below |
| **Probe: a voided write that fails** (`PR-42-cr3/zz-probe-void.mts`, tsx with `--conditions=@platform/source`) | Details below (R3-m1) |
| Unions | Details below |
| Evidence `20261114T1437Z_6e3ec99` | Verdict PASS. Suites: api 128, catalog 102, integration 319 (1 pre-existing skip), rls-cross-tenant 126/0, unit 5008 (2 skips). I recomputed packages/audit/src from `coverage-summary.json`: **lines 1437/1437, branches 442/442**. Other files: with-tenant-tx 454/454 lines and 119/120 branches; tenant-db 469/469 and 155/155; tenant-admission 233/234 and 40/41; platform/audit/writer 19/19 and 2/2. The integration JUnit contains both `[PR #42 fix cycle 2] … (PR42-SEC-13)` cases. `unit.junit.xml` has `coverage gate: packages/audit lines` and `… branches`. rls-cross-tenant has 126 tests, 13 of them tagged SEC-TC-06. |
| CI on head `96bd37a` (run 43608317119) | fast-lane: **success**. The Lint step took 40 s with the 4 GB heap, and the base-ref negative-fixtures step passed. scans: only "Security-owned paths need a review record" failed (expected; no round-3 security record names this head yet). ci-gate: red, because it aggregates scans. |

**Lint probe results**
- **Reported by the REQ-AUDIT-001 policy:**
  - named import (= p7), `./…/platform/./audit`, a `platform/tx/../audit` detour, namespace, `import()`;
  - `export { … } from`, `export *`, `export * as`;
  - `createRequire(import.meta.url)(…)` (also flagged by `static-module-specifier`), `m.require(…)`, a template-literal `import()`;
  - mixed `import { type X, value }`, a side-effect `import '…'`, no extension, a `.ts` extension;
  - `capture.ts` from a module;
  - from `platform/http`, `platform/runtime`, the app root, and `shipments/controller`;
  - the tx slot taking `writer.ts`, directly or by a `..` detour.
- **Clean:**
  - `import type`, `export type … from`;
  - the tx slot → `capture.ts`;
  - allow-listed importers: `identity/service`, `shipments/service`, `platform/db`;
  - tests (`*.int.test.ts` and a module `tests/` folder).
- **Caught by other rules:**
  - A `Platform/Audit` case-variant fails `import-x/no-unresolved` (it also fails on Linux).
  - A variable specifier fails `static-module-specifier`.
  - `typeof import()` is a type, and is reported by `consistent-type-imports`.
  - The worker → apps/api relative import fails `no-relative-packages` plus another boundaries policy.
  - TS `import w = require()` makes `static-module-specifier` **crash** (R3-n3, a main defect). With that rule off it is reported by boundaries and `no-require-imports`.
- **Not caught:** a two-hop through another allow-listed folder (R3-n2).

**Policy mutants**
- **Killed (7 of 10):**
  - A: delete the policy (9 rows fail);
  - B: drop `kind: 'value'` (V9);
  - C: drop the tx-slot allow (execute.ts row);
  - D: drop the `audit-writer-caller` exclusion (V8);
  - E: drop the `test` exclusion;
  - F: widen the tx allow to the folder (bad-tx-writer);
  - H: `captured: { app: 'worker' }` (9 rows).
- **Survived:**
  - **G** (the category narrowed to `writer.ts`) and **I** (the tx-slot allow extended to any api file): see R3-n1.
  - J (the policy pair moved to the front of `BOUNDARIES_POLICIES`) is equivalent today, because no later policy allows api → `api-platform-audit`.

**Code mutants**
- **Track/settle, killed (10 of 12):**
  - T1: no `settle`. The suite crashes on the unhandled TENANT_TX_CLOSED rejection; see R3-m1.
  - T2: `while` → `if` (the nested-work test).
  - T3: no closed check in `track`.
  - T4: `track` does not register.
  - T5: the writer bypasses `track`.
  - T6: `track` returns the void promise.
  - T7: `settle` after the latch read (L8c).
  - T8: the work starts before the closed check.
  - T10: `track` missing from `ownKeys`.
  - T12: `track` wraps only `append`.
- **Track/settle, survived:**
  - T9 (no function check) is equivalent: `work()` throws the TypeError anyway, before registering.
  - T11 (`settle` also on the throw path) is an unpinned design choice. D-TASK025-23 says the throw path does not wait, and both behaviours are safe.
- **Roles (R2-n1):** R1 (`length` re-read in the loop), R2 (no number check) and R3 (back to the caller's `map`) are each killed.
- **Brand (R2-n3):** N8 (`instanceof`) is now killed.
- **Setter pin (R2-n2):** P3 (a setter between the `'/*'`…`'*/'` literals in the real `prisma-store.ts`) is now killed. P4 (`set_config` in a `//` comment) is also refused, which fails closed as D-TASK025-25 intends.

**Probe: a voided write that fails**
- (A) `void writer.write(db, invalid)`, then `settle()`. The latch holds `AuditWriteError INVALID_ENTRY` (correct), **and 1 `unhandledRejection` (AuditWriteError)** fires.
- (B) The same write after `revoke()` gives 1 `unhandledRejection` (DbError TENANT_TX_CLOSED).

**Unions**
- Each merge equals `git merge-tree --write-tree p1 p2` byte for byte: `c7636ec`, `5964962`, `7e9fb3c` and `6e3ec99`.
- `c65f205` differs only in the conflict hunk of `tools/lint/negative-fixtures.test.ts`. The resolution keeps both row sets whole: the R1-M1/PR42-SEC-06 store and assembler rows, and PR #44's `[PR44-SEC-01 A05]` aliased-createRequire row.
- `git merge-tree HEAD origin/main` (1df519c, docs only) is clean.
- Trial merges with the open PRs:
  - #39 (ef195bc): the known `packages/config/src/values.test.ts` conflict; `with-tenant-tx.ts` auto-merges.
  - #46 (ad30316): `.github/workflows/ci.yml` conflicts on the Lint step's **comment lines only**. Both sides set the identical `NODE_OPTIONS: --max-old-space-size=4096`.

**Not re-run (per brief):** Docker, Testcontainers, lane B, full lint/typecheck/build. For those I relied on the evidence and Lane A above.

## R3.2 Round-2 closure

| ID | Status | How verified |
|---|---|---|
| **R2-M1** | **Closed** | `eslint.config.mjs:597-602`. The importer is any non-test `app`/`api` file outside `AUDIT_WRITER_ALLOW_LIST`. The target is the **resolved** category `api-platform-audit` (`apps/api/src/platform/audit/**`) on value imports. That is a superset of `api-module`, and it also covers the app root and the platform folders, as I asked. **Every spelling of the round-2 p7 probe is reported** (R3.1). The fixtures fire (13/13), and deleting the policy fails 9/9 negative rows (mutant A). |
| R2-M1: tx → capture exception (D-TASK025-22) | **Narrow** | The allow runs `from` `api-tx-slot` (non-test) `to` `api-audit-capture`, which is exactly `apps/api/src/platform/audit/capture.ts`. In the probe, tx → `writer.ts` is reported, including through a `../audit/../audit` detour. Mutants C and F are killed. Residual: it is unpinned against widening the *importer* side (mutant I). That is R3-n1. |
| PR42-SEC-13 (D-TASK025-23) | **Closed** | Points 1 to 6 below. |
| R2-m1 | **Routed** (D-TASK025-27) | TASK-029 AC items (a)–(c) and the TASK-028 key policy are exactly what I asked for in round 2. The writer guards stay refusals. |
| R2-n1 | **Closed** | `length` is read once, the elements are read by index, and a non-number is refused (D-TASK025-24). R1–R3 are killed. Edge cases I checked by hand: Infinity is refused, NaN gives `[]`, and 1.5 is refused at index 1. |
| R2-n2 | **Closed** | The pin counts over the raw source. A self-test proves the stripper would hide E1. P3 is killed on the real file. |
| R2-n3 | **Closed** | A second-copy brand test exists, and N8 is killed. The JSDoc states "cross-copy marker, not an authenticity check" (D-TASK025-26). |

**PR42-SEC-13 (D-TASK025-23), in detail:**
1. **Thunk semantics.** `track` refuses (`TENANT_TX_CLOSED`) before calling `work`, so a refused write never starts (T3 and T8 killed).
2. **Refusal reaches the caller as a rejection.** `write` is `async`, so a refusal is a rejection, not a synchronous throw.
3. **Registration and the promise returned.** `started` is registered via a never-rejecting `settled`, and `track` returns `started` itself, so callers keep the real outcome (T6 killed).
4. **The settle loop.** `settle` loops until the set is empty. Each `settled` deletes itself through a callback registered before any `Promise.all`, so the loop terminates. Work started by tracked work is awaited (T2 killed).
5. **`withTenantTx` body order.** The order is: context, leak check, READ ONLY, `createTenantDb`, `fn`, **`settle`**, latch, return, then `revoke` in `finally`. `revoke` runs synchronously after the latch check, so no tracked write can start between the latch read and `revoke`.
6. **Real PostgreSQL 18 (in the evidence JUnit).**
   - A detached write whose tokeniser fails after the callback returned gives 500 `AUDIT_WRITE_FAILED`, **0 business rows and 0 entries**.
   - A `void` write that succeeds is appended inside the transaction, and its hash is recomputed from the stored row.
7. **Pins.** `createTenantDb` has one caller (`withTenantTx`). Every `Reflect.ownKeys(db)` pin (tenant-db, system-db, real-client) gained `track`.

## R3.3 Findings

| ID | Sev | Location | Issue | Required fix |
|---|---|---|---|---|
| **R3-m1** | MINOR (in-PR preferred; may route to TASK-029 with the JSDoc fix now) | `apps/api/src/platform/db/tenant-db.ts:71` (JSDoc) · `packages/audit/src/writer.ts:114` (`write`) · `apps/api/src/platform/runtime/process-errors.ts:88` | **The JSDoc endorses `void writer.write(…)`, but a voided write that fails crashes the API process.** The latch JSDoc names `void writer.write(…)` as a handled pattern. `write` is an `async` arrow, so it returns a *new* promise. `track`'s `then(ignore, ignore)` handles `started`, but not that new promise. Probe: the latch is set correctly, **and** an `unhandledRejection` fires (an AuditWriteError on the success path, a DbError TENANT_TX_CLOSED after revoke). The API's process handler answers `unhandledRejection` with `crash('process.unhandled_rejection')`. The 55P03 lock timeout is an expected, retryable 503 under contention (D-TASK025-01), so one contended voided write would kill every in-flight request on the process. That is a health-check failure on the ROLLBACK_TRIGGERS list. Integrity holds (settle plus the latch roll the business change back). The cost is availability. No production caller exists yet, so this is latent. Mutant T1 shows the same crash inside Jest. | **Preferred:** since the transaction owner surfaces every tracked failure through the latch, the writer's returned promise can be marked handled while awaiting callers still see the rejection. Make `write` a plain function: `let p; try { p = db.track(…) } catch (e) { p = Promise.reject(e) } p.catch(() => undefined); return p;`. Add a unit test asserting no `unhandledRejection` for a voided failing write (probe A). For the after-settle case (B), the failure then becomes silent. That case is D-TASK025-23's declared residual; log it once through the writer's options if a logger exists, or leave it to TASK-033. **Minimum (if routed):** fix the JSDoc now. Remove `void writer.write(…)` as an endorsed form, and state that a detached write must attach its own `.catch`, because the API treats an unhandled rejection as fatal. Put the code fix into TASK-029's AC. |
| R3-n1 | NIT | `tools/lint/negative-fixtures.test.ts:1091-1110` (AUDIT_COMPOSITION rows) | No negative row imports a file of the folder **other than `writer.ts`**, so two mutants survive: G (the category narrowed to `apps/api/src/platform/audit/writer.ts`) and I (the tx-slot allow given to any api file). That folder pattern is the one TASK-029 relies on for the files it adds there. | Add one row, `modules/orders/service/bad-orders-capture.service.ts`, importing `../../../platform/audit/capture.js`. On the real config it is reported (probe q19), and it kills both G and I. This is fixtures only. |
| R3-n2 | NIT (record; route) | D-TASK025-22 "Not covered" · `AUDIT_WRITER_ALLOW_LIST` (`eslint.config.mjs:121`) | **A two-hop through another allow-listed folder is lint-clean.** Probe: `platform/db/x.ts` with `export { auditWriterFromConfig } from '../audit/writer.js'` is clean, and so is a module service importing it from `platform/db`. The same holds for `@platform/audit` writer exports re-exported from `platform/db`, `platform/authz` or an allow-listed module's entry. This was pre-existing, and the same class as R2-M1. It needs a deliberate change in a trusted, reviewed folder, so it is a NIT. | Add it to D-TASK025-22's "Not covered" list (covered by review, and by TASK-033's per-route audit-completeness suite). Optionally have TASK-029 add a tripwire. One option is a source scan, along the lines of `tools/repo/test-seams.test.ts`: no allow-listed file outside `packages/audit/**` and `apps/api/src/platform/audit/**` re-exports a writer export or anything from `platform/audit`. |
| R3-n3 | NIT (main, out of scope; route to 020-D) | `tools/eslint-rules/module-sources.mjs:80` (PR #44) | `platform/static-module-specifier` crashes the whole lint run on TS `import w = require('…')`. The `ImportBinding` def's parent is a `TSImportEqualsDeclaration` with no `.source`. This fails closed (exit 2), `verbatimModuleSyntax` rejects the syntax in ESM anyway, and boundaries plus `no-require-imports` report it once the rule is off. It is the same class as PR #44 R2-m3 (null-parent walks). | Guard `def.parent.type === 'ImportDeclaration'` before reading `.source`, and add a fixture. |

**INFO (no action in this PR):**
- `settle` waits for as long as a tracked work runs. Prisma's JS side awaits the callback past its transaction timeout, so a tracked work stuck on a non-SQL await holds the admission permit. The same happens to an awaited write today. The tokeniser and store only run SQL on this transaction, which bounds it. When TASK-029 or the vault adds non-SQL awaits (KMS, an HMAC service), they need their own timeouts.
- Tracked work started by *untracked* detached code in the microtask gap between `settle`'s last size check and `withTenantTx`'s resumption is not awaited. That is inside D-TASK025-23's declared residual.

## R3.4 Rulings on D-TASK025-22..29

| Decision | Ruling |
|---|---|
| 22 Boundaries policy, value imports, tx → `capture.ts` exception | **Accepted.** The resolved-file judgement and the importer superset are correct, and the exception is exact-file. Amend the "Not covered" list with R3-n2. TASK-029: `capture.ts` should export only the hook factory, because the exception is per file, not per export. |
| 23 `track` takes a thunk; settle on the success path only | **Accepted** (R3.2 points 1 to 7). Amend the JSDoc per R3-m1. |
| 24 `roles()` fails closed on a non-number `length` | **Accepted.** |
| 25 Setter count over the raw source | **Accepted.** It also refuses `set_config` in a comment, which fails closed. |
| 26 Brand as a cross-copy marker | **Accepted.** |
| 27 R2-m1 routing to TASK-029/028 | **Accepted.** The orchestrator must put (a)–(c) and the verification line into TASK-029's AC verbatim. |
| 28 Sequencing with #44 gains `track` | **Accepted and done.** #44 merged first. This PR keeps `TENANT_CONCURRENCY_LIMIT` (13dd72a) and both fixture row sets. Each 020-C phase is its own `withTenantTx` (`execute.ts:230`, `:238`), so each phase takes its own permit and settles its own tracked writes. No 020-C `ownKeys(db)` pin exists. |
| 29 Lint step `NODE_OPTIONS=--max-old-space-size=4096` | **Accepted (maintainability only; security reviews it separately).** Reasons below. |

**Why D-TASK025-29 is accepted**
- **Narrow scope.** It is step-scoped and changes the heap size only (preload flags stay refused by `node-options-preload`). It does not change which rules or files are linted.
- **Fails loud.** If a union drops the line, lint OOMs again (exit 134). Nothing passes silently.
- **The cause is systemic, not this PR.** PR #46 independently arrived at the **identical** line, in `ci.yml` and in its new `lane-c.yml`. Its measurement: OOM at about 2 GB, pass at 3 GB. The cause is whole-repo typed ESLint in one process, which sits around 2 GB against V8's default heap on the 7–8 GB hosted runner.
- **Headroom.** 4 GB against a measured 2.1–2.3 GB is about 1.8× headroom, inside the runner's memory.
- **Sharding is not warranted yet.** It would:
  - split `--max-warnings 0` and the suppressions check;
  - complicate the "Lint must not mutate the tree" step and the base-ref fixture steps;
  - duplicate typegen;
  - lower the peak only if the shards do not share TS programs.

**Non-blocking follow-ups for devops-engineer / TASK-015**
1. Make the next cliff visible before it OOMs. Record the lint step's peak RSS (for example GNU `time -v` max resident) in the step summary, and warn at about 80 % of the cap.
2. Once #46 lands, the line lives in two workflow files. Single-source it, or pin in `check-workflow-policy` that every `npm run lint` step carries the same `NODE_OPTIONS`.
3. Local parity: developers on hosts with 8 GB of RAM or less get the roughly 2 GB default heap and will hit the same OOM. Document it (CONTRIBUTING / ADR-0023).

## R3.5 Merge conditions

1. **Security record round 3 naming `96bd37a`** (or the final head). The scans failure is only that record. `ci.yml` and `eslint.config.mjs` are security-owned.
2. **Fixes on this head.**
   - R3-n1 is fixtures only and welcome in this PR.
   - R3-m1: either the code fix in this PR, which touches `packages/audit`, so the `audit-package` path rule asks for fresh lane B evidence; or the JSDoc fix now with the code fix in TASK-029's AC (orchestrator's choice). Either way, record it.
   - R3-n2 is a D-entry amendment. R3-n3 routes to 020-D.
   - No re-review is needed for R3-n1, the R3-m1 JSDoc fix or the R3-m1 code fix as described, provided Lane A is green. The code fix needs only its one unit test and the evidence.
3. **Second-merger steps**
   - **With #46:** the `ci.yml` conflict is comment-only. Keep **one** `NODE_OPTIONS: --max-old-space-size=4096` line on the Lint step, plus one comment naming both causes. Keep #46's `lane-c.yml` line.
   - **With #39 (unchanged):**
     - `values.test.ts` `GUARDS.length === 15`;
     - the admission `TenantTxConfigError`s get `variable` (`DB_TENANT_ADMISSION_WAIT_MS`, `DB_TENANT_MAX_CONCURRENT_TX`);
     - the images ship `packages/audit`.
4. **Squash.** No non-docs commit after `96bd37a` other than the fixes above.

## R3.6 Good: patterns worth keeping

- **One policy instead of specifier regexes.** It judges the resolved file, so the whole class of spelling bypasses goes away. The fixtures enumerate the spellings anyway, the commit message quotes the deletion self-check, and the policy was placed last with its order reason stated.
- **The thunk-based `track`.** Refusal happens before the side effect, with no orphaned promise, and the caller gets the original promise back. A never-rejecting registration set keeps `settle` simple and terminating.
- **Real-database proof of the integrity claim.** The integration test shows 0 business rows and 0 entries for the detached failing write, and a hash recomputed from the stored row for the detached successful one.
- **Fix-cycle tables that name the failing-on-old-code test for each finding.** This made the delta review quick to verify.

## R3.7 Security flags (for security-analyst)

- **R3-m1 (availability):** a voided failing audit write is an unhandled rejection, which is a process crash in the API (`process-errors.ts:88`). It becomes client-influenceable once a caller voids a write and contention produces 55P03.
- **R3-n2:** a two-hop re-export of the writer through other allow-listed folders (pre-existing class).
- **`ci.yml` heap line (D-TASK025-29):** size only. `node-options-preload` still applies.
