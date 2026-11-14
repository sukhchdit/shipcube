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
