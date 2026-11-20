# PR-pending: TASK-043 (transactional outbox writer, at-least-once relay, 30-day purge), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-043-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>` (D-ORCH-136, D-ORCH-138): open the PR as a draft, rename the record on main, confirm that the PR's merge ref contains the renamed record, then mark the PR ready.

**Finding IDs.** `PR043-SEC-nn` are the findings of this task (TASK-043). They are not the `PR43-SEC-nn` findings of PR #43 (TASK-024).

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-043-transactional-outbox-writer-at-least` on base `efa6d1e0`: `7d6e4cb3` and `f38c193d` (wip), `5193fea4` (feature), `94393c9e` (DECISIONS.md restored), `c60959bd` (fix cycle F1 to F12), `da996002` (F3 `lock_timeout` 10 s, F7 lag gauge at the claim) |
| Head | da996002f718e8006896c3f346b2431e63289873 |
| Dispatched commit | `c60959bdb429720878e1f6568f315ca5bda1373b`, reviewed in full as `efa6d1e0..c60959bd`. The follow-up `c60959bd..da996002` changes no owned path (main's checker: `not-required`, 0 owned paths). I read it and re-ran the relay probes on it, so this round binds to the later commit, as code review round 2 does |
| Merge base with main | `efa6d1e0`. Main tip when this round was written: `164be6b0`, 23 commits later. Code from PR #77, #78 and #79 is among them. Two paths overlap with this PR: `tools/lint/negative-fixtures.test.ts` (owned) and `docs/sdlc/DECISIONS.md`. `git merge-tree --write-tree 164be6b0 da996002` conflicts in `docs/sdlc/DECISIONS.md` only, because the branch carries a copy of an older main (code review R2-n1, R2-C3) |
| Lane A evidence | None; the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs --base efa6d1e0 --head da996002`) gives `security_paths=true` (20 paths), so the hosted `security-integration` job runs on the PR |
| Lane B evidence | None at review time. It is queued in the evidence worktree at `da996002`. Every `*.int.test.ts` claim below is read from the source, not run |
| Owned paths changed | 27, as main's checker counts them (`--base efa6d1e0 --head da996002`): `apps/api/package.json`; 11 under `/apps/api/src/platform/` (outbox writer, index, the test seam and its helper, writer unit and lane B tests, `db/system-models.ts` and its test, `queues/producer.ts` and its test, `runtime/index.ts`); `packages/shared/package.json`; 6 under `/prisma/` (migration, `down.sql`, `platform.prisma`, `grants.manifest`, the C15 and job-executions lane B tests); 4 lint fixtures under `/tests/fixtures/lint/`; `tools/db/grants-manifest.test.ts`, `tools/db/table-classes/outbox.json` and `worker.json`; `tools/lint/negative-fixtures.test.ts`. So this record is a merge condition |
| Unowned paths read | `apps/worker/src/platform/outbox/**` (relay, relay metrics, purge, system-tx and their tests), `apps/worker/src/start-worker.ts`, `platform/queues/runtime.ts`, `platform/jobs/schedulers.ts`, `processors.test.ts`; `packages/shared/src/events/**`, `packages/shared/src/queues/{payload-v2,platform,queue-definition,index}.ts`, `packages/shared/src/classification/registry.ts`; `packages/config/src/schema.ts` |
| Binding items checked | ADR-0004 items 1 to 7, the amendment on one-time tokens (SEC-P3-08), amendment 2 items 8 to 18 and amendment 3 items 19 to 23; ADR-0005 amendment 11 items 17 to 21 with the notes of 2026-11-20; ADR-0013 amendment 5; data-model §3.5, §4.4, §6.1, §10.5; D-ARCH-167, D-ARCH-171, D-ARCH-183 to D-ARCH-190; D-QG-002 (QG-043-C3, QG-043-C4); D-SECPR039-01 conditions (i) to (iv); PR64-SEC-09, PR64-SEC-13; threat model T-83; code review rounds 1 and 2 (`docs/05-quality/reviews/PR-pending-TASK-043-code-review.md`) |
| Reviewer / date | security-analyst, 2026-11-20, round 1, pre-push. Host rule: lane B owns the machine and the evidence worktree. No npm, Jest, type-check, build or Docker, and no command at all in the evidence worktree. Method: static review plus single-process Node 24 probes on a `git archive` extract of `c60959bd` (and of `apps/worker/src/platform/outbox` at `da996002`). The extract got a `node_modules` tree of junctions to the main checkout's entries, with `@platform/*` pointing at the extract's own workspaces, so the PR's sources and `exports` resolve. ESLint ran with the repository's `eslint.config.mjs` and type-aware rules off. Sources were type-stripped for the relay probes. Nothing ran against PostgreSQL or Valkey |

## 1. Summary

The writer, the relay and the purge hold what the dispatch asked about:

- **Writer.** The writer derives `org_id`, `actor_id`, `created_by`, `updated_by` and `correlation_id` from the transaction. Nothing the caller passes reaches those columns.
- **Relay.** The relay reads identifiers only and stores an error class, never a message: a sentinel in an error message reached neither `last_error` nor the log. It keeps its transaction within `3W / 4`: 107 to 287 ms at `W` = 400 ms with a hanging or slow producer.
- **Purge.** Each purge statement carries its own age predicate and batch bound and runs under the D-SECPR039-01 conditions.
- **Raw-table lint.** It reports every non-owner raw statement and every non-owner delegate on the three SYSTEM tables (12 of 12 probe rows as designed).
- **PR64-SEC-13, TASK-043 half.** It is met: the relay's producer gets its queues from `openQueue`.

**QG-043-C4.** I concur with the T-83 exception of the relay (ADR-0005 amendment 11, notes at items 17 and 20), with three conditions (§3). I also concur with dropping the Valkey lock and with "nothing is parked".

**QG-043-C3.** I confirm ADR-0004 amendment 3 item 21 (D-ARCH-190). The overwrite carries no `published_at` predicate, is one `UPDATE` by event id, and checks for exactly one row. I prefer it to both offered alternatives. It has five card conditions for TASK-078 (§4).

New findings: five LOW and two INFO. One of the INFO items, PR043-SEC-03, is a build defect that lane A will turn red. Nothing Critical, High or Medium.

- **PR043-SEC-01 (LOW).** `mergeEvents`' closed-schema check is shallow. `Joi.object()` with no keys, `.pattern()`, nested open objects, `Joi.any()`, arrays and free strings all pass, and an e-mail address is stored.
- **PR043-SEC-02 (LOW).** `createOutbox` is still reachable from every api production file, by a deep import of `writer.ts` or through the test seam. All are lint-clean. This extends code review R2-m3.
- **PR043-SEC-03 (INFO, merge-relevant).** The new `./testing/outbox` export makes `tools/docker/image-exports.test.ts` fail, and it would fail the worker image's preflight. It also answers the seam question for the image: the file is pruned there, so a production import fails at build.
- **PR043-SEC-04 (LOW).** A foreign holder of the relay lock blinds both relay alarms. The lag reads 0 and the last-tick time stays fresh while rows age. A one-line fix was validated by mutation.
- **PR043-SEC-05 (LOW).** `outbox_events.org_id` becomes the authoritative tenant of every derived job (TASK-047), but `platform_app` may `UPDATE` every column.
- **PR043-SEC-06 (LOW).** `DELETE` on the two dedupe ledgers has no horizon at the database, and deleting a row reopens a once-only effect.
- **PR043-SEC-07 (INFO).** The relay's SYSTEM transactions share the worker's `anonymous` admission key with guest and other SYSTEM work.

## 2. What I verified

| Probe | How | Result |
|---|---|---|
| P1 seam and catalogue bypass (code review m5, R2-m3) | Ten probe files written into the extract at real paths, linted with the real configuration | `createOutbox` by a deep relative import of `writer.ts`, from an api module service (A1) and from `apps/api/src/platform/routing` (A5): **lint-clean**. `createTestOutbox` through `@platform/api/testing/outbox` from an api module (A2), and through `../platform/outbox/tests/test-outbox.js` from an api module (A3) and from api platform code (A9): **lint-clean**. From worker production code (A4 `apps/worker/src/`, A6 `apps/worker/src/platform/jobs/`): reported by `boundaries/dependencies` (the worker reaches apps/api only through `@platform/api/runtime`). Controls: the barrel import `outbox` (A7) and a worker test file (A8) are clean, as designed |
| P2 raw-table ownership (dispatch: "the raw-table lint coverage") | Raw `$executeRaw` templates naming the three tables from non-owner files; `systemDelegates(tx).<model>.deleteMany` from an api module | `platform/system-model-owner` reports all 7 non-owner raw rows: `DELETE public.job_executions` from an api repository, from `apps/worker/src/` outside `platform/` and from `apps/api/src/platform/outbox/`; `"processed_events"` (quoted) from a repository and an `INSERT` from the api outbox folder; `Outbox_Events` (mixed case) from a repository and `public.outbox_events` from `platform/idempotency`. It also reports all 3 non-owner delegates (`jobExecution`, `outboxEvent`, `processedEvent`: `notOwner`). The owner controls (worker `platform/queues` raw `DELETE`; api `platform/outbox` delegate) stay clean. `SYSTEM_MODELS` gains `outboxEvent` and `processedEvent`, so neither delegate is on `TenantDb` |
| P3 T-83 lint, as the ADR-0005 item 20 note states it | The same lint run, then a mutant configuration whose `names` option adds `producer` and `jobProducer` | Today: `relay.ts` gives no report. Neither does a `producer.enqueue` inside a `runner.withTenantTx` callback in another worker file (C2), or inside a function that takes an `AppDb` (C4). Control: `queue.add` in the same callback is reported (C3). With the mutant names, `relay.ts`, C2 and C4 are all reported. So the note is accurate: today the lint neither knows nor guards the exception, and the TASK-047 change (names plus a single-file entry for `relay.ts`) is necessary and sufficient. A source search finds one production call site of the producer (`relay.ts:221`) and one construction (`start-worker.ts:136`) |
| P4 closed payload schemas (PR043-SEC-01) | `event-definition.ts` type-stripped, with the real Joi 18; 13 schemas through `mergeEvents` and `validateEventPayload`, with a payload that carries an e-mail address | The controls work: `identifierPayload` refuses the extra key, and `.unknown(true)` is refused by `mergeEvents`. A top-level `.options({ allowUnknown: true })` is overridden by the validator's own preferences, so it is closed. Ten shapes pass `mergeEvents` and store the address (table in PR043-SEC-01) |
| P5 relay behaviour (relay, metrics and system-tx type-stripped; fake runner; at `c60959bd` and again at `da996002`) | R1: every tick gets `locked: false` (a foreign holder) while a pending row is 600 s old. R2: `W` = 400 ms with a producer that never settles, and with one that takes 90 ms per row. R3: errors whose message carries a random sentinel | R1: lag gauge 0, last-tick age 0 s, so neither `OutboxRelayLag` nor `OutboxRelayStalled` would fire (PR043-SEC-04). Control: the same row with the lock gives lag 600. R2: the callback stays open 107 ms with the hanging producer (one enqueue bound of 100 ms, then the tick ends), and 287 ms with the slow one (3 of 50 published, then the `W / 2` budget). Both are within `3W / 4` = 300 ms. R3: `last_error` holds `JobProducerError` and `Error` (class names only), there is one WARN per streak with the class only, and the sentinel appears in neither the mark statements nor the log |
| P6 image exports (PR043-SEC-03) | The predicate of `tools/docker/image-exports.test.ts` re-implemented over the head manifests with the head's own `shouldRemove` (`prune-dist.mjs`) and `SKIPPED_EXPORTS` (`preflight.mjs`). Jest was not run | `@platform/api` exports one pruned path that is not skipped: `./testing/outbox`. The control holds: `./testing` is pruned and skipped. `@platform/worker` depends on `@platform/api`, and the preflight imports every non-skipped export of that dependency |
| P7 static checks | Reading, with line numbers from single-file reads | See below |

P7, item by item:

- **Grammar alignment.**
  - `ck_outbox_events__correlation_id` equals `CORRELATION_ID_PATTERN`, which the producer applies (`payload-v2.ts:110`).
  - The row `id` is a `uuid` cast to text, so it is lower case.
  - The relay drops an invalid stored `traceparent`, and the producer drops an unparsable `tracestate`. The `tracestate` length is checked before the regex.
  - So no row the writer wrote can be refused by the producer, which is the premise of "nothing is parked".
- **Writer.**
  - One bound `INSERT … SELECT`.
  - `org_id` = `platform.app_org_id()`.
  - The actor is `COALESCE(platform.app_actor_id(), ANONYMOUS)`.
  - `correlation_id` = `current_setting('app.correlation_id', true)`. If the setting is missing it is NULL, and the NOT NULL constraint fails closed.
  - `created_at = updated_at` = one `clock_timestamp()`.
  - The type is looked up with `Object.hasOwn`, the aggregate id is a lower-case UUID, the payload is capped at 8 KiB, and the error messages name paths and Joi rule names only.
- **Grants and migration.**
  - The table-level grants are at `migration.sql:86-89`.
  - `processed_events` has no `UPDATE` (D-ARCH-186).
  - `DELETE` on `job_executions` arrives with the purge (D-ARCH-171), and `down.sql` revokes it.
  - `hardDelete` flags are set in both manifests, and the grants manifest test is updated.
  - There is no foreign key onto `outbox_events`, as ADR-0004 amendment 3 item 21 requires.
- **Purge** (`purge.ts:42-63`).
  - Each `DELETE` carries `< pg_catalog.now() - interval '30 days'` on `published_at`, `processed_at` or `completed_at`. A pending event (NULL `published_at`) never matches.
  - Batches of 5,000, at most 200 per table and occurrence.
  - The batch key is `<occurrence id>.<table>.<n>` through `idempotentProcessor`, in its own SYSTEM transaction.
  - `throwIfAborted` runs between batches, outside the transaction.
  - D-SECPR039-01 holds: (i) code constants only; (ii) the predicates are in the SQL; (iii) the name is in the closed list, 12 characters; (iv) the occurrence identity check at dequeue is unchanged.
- **Logs and metrics.**
  - New log events: `worker.outbox_relay_failed {error: <class>}`, `worker.outbox_relay_recovered {}`, `worker.outbox_purge_capped {table, batches}`, `worker.outbox_purge_done {counts}`.
  - The metrics have fixed names and no labels.
  - Configuration: two non-secret integers with bounds (`OUTBOX_RELAY_POLL_INTERVAL_MS` 50 to 60,000; `OUTBOX_RELAY_BATCH_SIZE` 1 to 1,000).
  - Classification: every column `INT`. `token_enc` will be `SEC` with the first token event, per the registry comment.
- **PR64-SEC-13 (TASK-043 condition).**
  - `createProductionOutboxRelay` passes the worker queue runtime's `queueFor`, and every queue there comes from `openQueue` (`runtime.ts:92-93`), on the fail-fast profile.
  - `relay-queues.test.ts` refuses AUTH with WRONGPASS and asserts that the password reaches neither `console.error` nor stderr. The code review saw its live mutant.
- **Not verified here.**
  - Lane B (every `*.int.test.ts`: AT-US-011-01 to -06, the interleaving, the two-relay and held-lock rows, the 23514 rows, the purge on PostgreSQL 18, C15, the job-executions grants).
  - Two-session lock semantics.
  - The image build.
  - The `.env.example` lines: the tool policy refuses `.env*` paths. They are two non-secret integers, and lane A Gitleaks covers the file.

## 3. QG-043-C4: the T-83 exception of the relay

**Concurrence: yes, with three conditions.** The text is the two dated notes of 2026-11-20 in ADR-0005 amendment 11, at item 17 (the exception) and at item 20 (the lint treatment). It also covers ADR-0004 amendment 2 item 10 and the Valkey lock and parking questions D-QG-002 lists.

- **The exception is what item 17 says.**
  - **SYSTEM scope, no organisation.** `systemContext` gives `orgId: ''` and the SYSTEM actor (`system-tx.ts:25`), so every RLS table shows the tick nothing.
  - **No audit stream lock.** The runner takes no advisory lock of its own (`with-tenant-tx.ts` only sets the eight transaction-local settings), and the relay writes no audit entry.
  - **One connection per worker.** Ticks are serial in each worker's loop, and `stop()` awaits the running one.
  - **The transaction stays open for at most `3W / 4`, measured (P5 R2).** At `W` = 400 ms it was open 107 ms with a hanging producer and 287 ms with a slow one.
  - **An enqueue before a failed commit is repeated, not undone.** The event row was committed by its own transaction before any tick can see it, so a job never names a row that does not exist. The job id is deterministic. A rolled-back tick leaves only its marks undone.
  - **The bounds are configuration-derived.** `W` = the smaller of the runner's transaction timeout and `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS`. The runner sets both as transaction-local settings, so the server enforces the idle bound too.
- **The availability threat of T-83 does not apply.** The threat is a long transaction that holds audit locks and drains the pool, and none of the three facts it needs holds here: there is no audit lock, there is one connection, and the time is bounded. The effect-before-commit half of item 17 also does not apply, because the effect is idempotent and its row is already committed.
- **Dropping the Valkey lock: concur.** A transaction-level PostgreSQL lock ends with the claim's row locks. There is no expiry, so no paused holder can enqueue beside its successor. The `TenantDb` guard refuses the session-level forms (`raw-statement.ts`), so `platform_app` code cannot leak the lock onto a pooled connection. The one residual is a foreign holder of the key, which blinds the gauges (PR043-SEC-04).
- **"Nothing is parked": concur.** No row the writer wrote can be refused by the producer (P7 grammar alignment), so a parked state would serve only a defect. A defect in the deployed code stalls the stream visibly (ADR-0004 amendment 3 item 19, `OutboxRelayLag`). An attacker cannot create a poison row: the writer validates the row, the CHECKs enforce the producer's own grammar, and `outbox_events` is writable only from `apps/*/src/platform/outbox/**` (P2).

**Conditions:**

- **C4-1. No second production call site of the job producer before TASK-047's lint change.** That change adds `producer` and `jobProducer` to `names` and gives `relay.ts` its single-file entry; this is the D-ARCH-188 card line. P3 shows that until then a `producer.enqueue` inside any transaction root is lint-clean. `apps/worker/src/**` outside `platform/db/` is not a security-owned path, so such a PR would get no security round. Today `relay.ts:221` is the only call site. The orchestrator checks this at dispatch: no task before TASK-047 hands a processor the producer. Optional and cheaper: a source-scan tripwire in `tools/repo/test-seams.test.ts` style (`createJobProducer(` only in `start-worker.ts`), which needs no lint lock. PR64-SEC-09 (devops) gains `apps/worker/src/platform/outbox/`.
- **C4-2. PR043-SEC-04 is fixed or accepted in writing before TASK-214 builds `OutboxRelayLag` and `OutboxRelayStalled`.** Otherwise the alarm that replaces parking is silent in one case.
- **C4-3. The threat model's T-83 row follows before G3.** This is my own action, recorded here; the file is not part of this commit. The control cell will read: "No external call inside a tenant-transaction root (lint `platform/no-external-calls-in-tenant-tx`, roots R1 to R6, ratchets, runtime twin with a 1 s idle timeout in the test lanes); explicit timeout configuration. One reviewed exception: the outbox relay tick enqueues inside its SYSTEM transaction (ADR-0004 amendment 2 item 10; ADR-0005 amendment 11 item 17): no audit lock, one connection per worker, open at most `3W / 4`, the first transport failure ends the tick; from TASK-047 the lint names the producer and exempts `relay.ts` alone (item 20)."

## 4. QG-043-C3: the `token_enc` overwrite (ADR-0004 amendment 3 item 21; D-ARCH-190)

**Confirmed.** It is due before TASK-078 is dispatched. I take the architect's rule: no `published_at` predicate, one `UPDATE` by event id, and the job fails unless exactly one row was updated. I prefer it to both offered alternatives:

- **Against the predicate plus a row-count retry.** It leaves the token in place for the rest of a slow tick, and indefinitely after a rolled-back tick until a retry happens to win. The promise of SEC-P3-08 would then depend on retry timing.
- **Against accepting the 24 h backstop.** It gives up part of SEC-P3-08 for no gain.

**Why it is safe:**

- **The waiting case.** Under READ COMMITTED an `UPDATE` that meets the tick's `FOR UPDATE` lock waits. When the tick ends it re-checks its `WHERE` on the newest row version, and `id` never changes. It then applies after a committed tick and after a rolled-back one.
- **No deadlock.** The tick takes its rows with `SKIP LOCKED`, so it never waits for the consumer.
- **No change to the queue order.** The consumer of an event exists only after that event's job was accepted, so its lock cannot reorder the queue.
- **No cross-tenant reach.** The statement can only remove a field. A forged job naming another event id is resolved in that event's own tenant by `job_context`, so it gains nothing.

**Conditions for the TASK-078 card** (the D-SD-006 "DISPATCH GATE: TOKEN_ENC OVERWRITE OUTCOME" placeholder):

- **T078-1. The statement form.** `SET payload = payload - 'token_enc'`, together with `version = version + 1` and the standard columns the guard requires (`updated_at`, `updated_by`), and `WHERE id = $event_id`.
  - Every `SET` expression is relative to the row, so the re-check after the wait computes them on the current version.
  - The only predicate is the id. It carries no `published_at`, no `version = $read` and no `payload ? 'token_enc'`. Any of those would update 0 rows after the tick's mark, or on a retry after a lost acknowledgement, and fail the job for good.
- **T078-2. Its own short transaction.** It holds no other row lock while it waits, and its wait is bounded by `lock_timeout`. The job's retry repeats it. The 24 h housekeeping is the accepted backstop only after the retries are exhausted.
- **T078-3. One port.** The port lives under `apps/*/src/platform/outbox/**` and takes only the event id. Callers never pass SQL, columns or a payload. TASK-078's migration adds `payload` to the column-level `UPDATE` grant that PR043-SEC-05 proposes.
- **T078-4. Logs.** The overwrite logs the event id and the row count only, never the token, the ciphertext or the payload. `token_enc` stays in the redaction set and becomes `SEC` in the classification registry.
- **T078-5. Two more tests besides those of item 23.** A retry after a committed overwrite counts one row and succeeds. An overwrite after the 24 h housekeeping already removed the field counts one row.

## 5. Findings

| ID | Title | Severity | CWE | OWASP | File:line | Owner / due |
|---|---|---|---|---|---|---|
| PR043-SEC-01 | The closed-schema check of the event catalogue is one level deep and value-blind | LOW | CWE-1173 | A04 | `packages/shared/src/events/event-definition.ts:37-41, 55` | TASK-043 fix cycle (preferred) or a merge prerequisite of TASK-049 (the first event file) |
| PR043-SEC-02 | The catalogue-parameterised factory is reachable from api production code | LOW | CWE-1061 | A04 | `apps/api/src/platform/outbox/writer.ts:109`; `tests/test-outbox.ts:4`; `apps/api/package.json:14` | tripwire: TASK-043 fix cycle; boundaries policy: next lint-lock holder (code review R2-C5); before TASK-049 merges |
| PR043-SEC-03 | `./testing/outbox` fails `image-exports.test.ts` and the worker image preflight | INFO (merge-relevant) | CWE-710 | A05 | `apps/api/package.json:14`; `tools/docker/preflight.mjs:25` | TASK-043 fix cycle (lane A unit fails otherwise) |
| PR043-SEC-04 | A foreign holder of the relay lock blinds both relay alarms | LOW | CWE-778 | A09 | `relay.ts:197, 252` (at `da996002`); `relay-metrics.ts:16-17` | principal-architect (ADR-0004 amendment 2 item 11 definition), then TASK-043 or TASK-214; before TASK-214 builds the alarms |
| PR043-SEC-05 | The tenant binding of an outbox row is not enforced by the database | LOW | CWE-732 | A01 | `migration.sql:86`; `grants.manifest` (outbox lines) | principal-architect; before TASK-047 merges (`job_context` reads `org_id`) |
| PR043-SEC-06 | `DELETE` on the dedupe ledgers has no horizon at the database | LOW | CWE-837 | A04 | `migration.sql:87, 89` | principal-architect (guard or written acceptance); RB-06 card line (P7); G3 |
| PR043-SEC-07 | Relay and purge transactions share the worker's `anonymous` admission key | INFO | CWE-770 | A04 | `system-tx.ts:25`; `tenant-admission.ts:87` | TASK-047 (worker runner twin) |

### PR043-SEC-01 (LOW): the closed-schema check is one level deep and value-blind

- **Description.** `isClosedObjectSchema` accepts any Joi schema whose `describe()` has `type: 'object'` and no top-level `unknown` flag. It does not require `keys`, it does not look at `patterns`, nested nodes, preferences or leaf types, and it cannot see values. Probe P4 ran with the real Joi 18; `mergeEvents` accepted every schema below, and the validator stored an e-mail address under it:

  | Schema | Stored |
  |---|---|
  | `Joi.object()` (no keys; Joi then allows any key) | yes |
  | `Joi.object().keys()` (no argument) | yes |
  | `Joi.object({}).pattern(/./, Joi.any())` | yes |
  | `Joi.object({ meta: Joi.object().unknown() })` | yes |
  | `Joi.object({ meta: Joi.object() })` | yes |
  | `Joi.object({ meta: Joi.any() })` | yes |
  | `Joi.object({ meta: Joi.object({ id }).prefs({ allowUnknown: true }) })` | yes |
  | `Joi.object({ meta: Joi.alternatives().try(Joi.object().unknown(), Joi.string()) })` | yes |
  | `Joi.object({ list: Joi.array() })` | yes |
  | `Joi.object({ shipmentId: Joi.string() })` (closed keys, free value) | yes |
  | controls: `identifierPayload(...)`; `.unknown(true)`; top-level `.options({ allowUnknown: true })` | refused; refused by `mergeEvents`; refused (the validator's preferences win) |

- **Exploitability and impact.** It takes a code change: an event file whose payload schema has one of these shapes. That file passes code review, and `packages/shared/src/events/` is not a security-owned path. The result is personal data in `outbox_events.payload`. That is a SYSTEM table with no RLS, kept 30 days after publishing, outside the PII vault, so the erasure path of the vault does not cover it. This contradicts "identifiers, codes and a locale only" (ADR-0004 item 1, SEC-P3-12, data-model §3.5). Impact Medium, likelihood Low, so LOW. Code review m5 asked for exactly this control, and its most natural open spelling (J1, `Joi.object()`) gets through.
- **Remediation.** Replace the predicate with a structural allow-list walk of `describe()`:

  ```ts
  // every node: no flags.unknown, no preferences.allowUnknown, no patterns, no link/alternatives/any/custom type;
  // object nodes must have `keys`; array nodes must have one closed `items` entry; string leaves must carry a
  // `pattern`, `guid`, `isoDate` or `base64` rule, or an `allow`/`valid` list with `flags.only`; number, boolean, date allowed.
  const LEAF = new Set(['string', 'number', 'boolean', 'date']);
  const STRING_RULES = new Set(['pattern', 'guid', 'isoDate', 'base64']);
  function closedNode(d: Description): boolean {
    if (d.flags?.unknown === true || d.preferences?.allowUnknown === true || d.patterns !== undefined) return false;
    if (d.type === 'object') return d.keys !== undefined && Object.values(d.keys).every(closedNode);
    if (d.type === 'array') return d.items?.length === 1 && closedNode(d.items[0]);
    if (d.type === 'string') return d.flags?.only === true || (d.rules ?? []).some((r) => STRING_RULES.has(r.name));
    return LEAF.has(d.type);
  }
  export const isClosedObjectSchema = (s: unknown) => Joi.isSchema(s) && s.type === 'object' && closedNode(s.describe());
  ```

  The walk was validated on a scratch copy: 16 schemas, the four intended shapes accepted (UUID patterns, a `valid` locale, `guid`/`base64`/`isoDate` leaves, a nested closed object), the ten bypasses above, `.unknown(true)` and a top-level `allowUnknown` preference refused, 0 mismatches.

  Add `packages/shared/src/events/` to CODEOWNERS (folded into PR64-SEC-09, devops), so each new event type and its payload get a security round.
- **Verification test.** `events.test.ts`, title `[PR043-SEC-01]`: `mergeEvents` refuses each of the ten schemas above, accepts `identifierPayload('a','b')`, a closed object with `Joi.string().valid('en','es','fr')` and a pattern-checked `token_enc`, and refuses the two controls as today.

### PR043-SEC-02 (LOW): the factory is reachable from api production code

- **Description.** `createOutbox` is off both barrels, but `writer.ts:109` still exports it, and nothing confines who imports `writer.ts` or the seam. Probe P1:
  - These are all lint-clean: an api module service and `apps/api/src/platform/routing` with `import { createOutbox } from '…/platform/outbox/writer.js'`; an api module with `@platform/api/testing/outbox`; api module and api platform code with `…/outbox/tests/test-outbox.js`.
  - Only the worker is stopped, by the existing "worker imports apps/api only through `@platform/api/runtime`" policy.
  - Code review R2-m3 found the seam arm (`tests/test-outbox.ts`, `@platform/api/testing/outbox`). The deep `writer.ts` import is the second arm. It survives a fix that only blocks `tests/**` and `@platform/api/testing*`.
- **Exploitability and impact.** It takes a code change in apps/api. That code can publish a type that is not in the catalogue, with a payload schema of its own: no `mergeEvents` check, no catalogue entry and no review of the event file. Today the platform catalogue is empty, so a module that wants to publish before its event file exists is tempted to do exactly this. The impact is that of PR043-SEC-01, and the dispatcher will complete unhandled types without effect, so the row is stored and never consumed. LOW.
- **Remediation.**
  - (a) Now, with no lint lock: in `tools/repo/test-seams.test.ts`, add `test-outbox` and `@platform/api/testing` to `SEAM_SPECIFIER`, and add a second scan. That scan fails when a non-test file under `apps/*/src` other than `apps/api/src/platform/outbox/{index,writer}.ts` imports a specifier that ends in `platform/outbox/writer` (with or without the extension).
  - (b) With the next lint-lock holder (code review R2-C5), the resolved-file twin. Add categories `api-outbox-writer` (`apps/api/src/platform/outbox/writer.ts`) and `api-outbox-seam` (`apps/api/src/platform/outbox/tests/**`). Add a policy that disallows any `app` or `package` file, tests and `apps/api/src/platform/outbox/index.ts` excepted, from importing either. Give it one negative fixture per spelling: deep relative, workspace self-reference and `export … from`.
- **Verification test.** The two tripwire rows of (a) with a planted positive control per import form, as the existing `query-counter` row does. The fixtures of (b) in `negative-fixtures.test.ts`.

### PR043-SEC-03 (INFO, merge-relevant): `./testing/outbox` and the image preflight

- **Description.** `tools/docker/preflight.mjs:25` skips exactly `./testing`. `prune-dist.mjs` deletes `tests/` directories from `dist`. The new export's `default` target is `./dist/platform/outbox/tests/test-outbox.js`. Probe P6 re-implemented the test's predicate with the head's own functions, and `@platform/api` then has one pruned, non-skipped export.
  - So `tools/docker/image-exports.test.ts` ("`@platform/api` exports no path that prune-dist deletes", lane A unit) fails on this head.
  - The worker image's preflight imports every non-skipped export of its `@platform/api` dependency, so it would fail the worker's `docker build` with "cannot load @platform/api/testing/outbox".
  - The code review's targeted unit run did not include `tools/docker`.
- **Security reading.** This answers the dispatch question "it can't be imported by production code" for the image: the file is not in it, and the preflight makes a production import a build failure. It fails closed. In source and in lane A it is PR043-SEC-02.
- **Remediation.** One of:
  - (a) Serve the seam from the sanctioned `./testing` subpath: re-export `createTestOutbox` from the module behind `./testing`, or move `./testing` to a small index under a `tests/` folder that re-exports both helpers. Then remove `./testing/outbox`.
  - (b) Teach `SKIPPED_EXPORTS` and `image-exports.test.ts` the `./testing/*` family, which is an owned change to `tools/docker` with devops.

  (a) is smaller and keeps the one-convention rule of the test's header.
- **Verification test.** `tools/docker/image-exports.test.ts` green on the fixed head, plus a lane B or `images.stack` worker image build.

### PR043-SEC-04 (LOW): a foreign holder of the relay lock blinds both relay alarms

- **Description.** On a tick that does not get the lock, the relay sets the lag gauge to 0 (`relay.ts:197`) and then still sets the last-tick timestamp (`relay.ts:252`). `relay-metrics.ts:16-17` and ADR-0004 amendment 2 item 11 define the timestamp as "with or without the lock".
  - If something else holds `pg_advisory_xact_lock(478216878200)`, every worker reports lag 0 and a fresh timestamp while pending rows age. Two such holders are designed: the RB-06 replay statement and the 24 h `token_enc` housekeeping. A third would be a module transaction that takes the key by mistake; the xact form is legal through `TenantDb`.
  - So neither `OutboxRelayLag` (max lag > 30 s) nor `OutboxRelayStalled` (time since the last tick > 60 s) fires.
  - Probe P5 R1 showed exactly that with a 600 s old row, and the control with the lock showed lag 600. The `da996002` follow-up (lag at the claim) does not change this case.
- **Exploitability and impact.** A holder inside a platform_app transaction is bounded by its own timeouts. The unbounded case is an operator session during RB-06, for example an interactive transaction left open. An operator session does not go through the runner, so the transaction-local bounds the runner sets do not apply to it. Notifications, saga steps and every other event then stall with both alarms green. This is availability and detection, and the alarms are the stated replacement for parking and the fallback job. Impact Medium, likelihood Low, so LOW.
- **Remediation.** Count only ticks that held the lock as liveness. In `relay.ts`, `if (tick.locked) metrics.tickEnded(wall() / 1_000);`, and rename the gauge's HELP text to "the last tick that held the relay lock".
  - In normal operation some worker holds the lock every poll interval, so the maximum over workers stays fresh.
  - With a foreign holder every value stops, and `OutboxRelayStalled` fires after 60 s.
  - The mutation probe on a scratch copy of `da996002`: with the one-line change the foreign-holder arm turns `OutboxRelayStalled` on and the normal arm stays off; the unchanged code gives off and off.
  - ADR-0004 amendment 2 item 11 needs its definition amended (principal-architect). RB-06 already says `OutboxRelayLag` is expected during a replay; `OutboxRelayStalled` will be too.
  - Optional: on the no-lock path, read `min(created_at)` of pending rows without a lock (index-only on `ix_outbox_events__unpublished`) for the lag gauge.
- **Verification test.** `relay.test.ts`, title `[PR043-SEC-04]`: ticks with `locked: false` never move the last-tick gauge; a tick with the lock and no rows does; a stopped clock shows `time() - gauge > 60` after 61 s of `locked: false` ticks.

### PR043-SEC-05 (LOW): the tenant binding of an outbox row is not enforced by the database

- **Description.** `outbox_events.org_id` is "the authoritative tenant context of every job derived from the event" (data-model §3.5). `platform.job_context('outbox_event', id)` will read it (TASK-047), so the dispatcher's handlers run in that organisation.
  - The writer derives it from the transaction, but only in code. `migration.sql:86` grants `platform_app` `UPDATE` on every column (and `INSERT` of any value).
  - The relay needs `UPDATE` on six columns only: `published_at`, `attempts`, `last_error`, `updated_at`, `updated_by`, `version`. TASK-078 will add `payload`.
  - `org_id`, `actor_id`, `type`, `aggregate_type`, `aggregate_id`, `correlation_id`, `trace_context` and the creator columns are facts of the event, and nothing should change them.
- **Exploitability and impact.** Writing raw SQL against the table is confined to `apps/*/src/platform/outbox/**` (P2), and every statement is a bound tagged template, so this takes a defect or a new feature in that folder. If `org_id` or `actor_id` changed, the event's jobs would run in another tenant or as another actor: a cross-tenant effect (O3 guardrail). Nothing reads `org_id` today. Impact High from TASK-047 on, likelihood Low. I rate it LOW now, as defence in depth that is due before the first reader exists.
- **Remediation.**
  - Column-level grants, which the manifest format already supports (`<grantee> UPDATE public.outbox_events (<col>, …)`):

    ```sql
    REVOKE UPDATE ON TABLE public.outbox_events FROM platform_app;
    GRANT UPDATE (published_at, attempts, last_error, updated_at, updated_by, version) ON TABLE public.outbox_events TO platform_app;
    ```

    While the migration is unmerged, this is an edit of `migration.sql:86` and of the manifest line. Afterwards it is an expand migration.
  - Optionally, a `BEFORE INSERT` guard that refuses a row whose `org_id`, `actor_id` or `correlation_id` differs from the transaction's context, and a `BEFORE UPDATE` guard that refuses changes to the fact columns, for every role. The RB-06 replay changes `published_at` only.
- **Verification test.** C5 (grants) with the column tuples. Lane B: as `platform_app`, `UPDATE outbox_events SET org_id = …` gives 42501, and the relay's two mark statements still pass.

### PR043-SEC-06 (LOW): `DELETE` on the dedupe ledgers has no horizon at the database

- **Description.** `migration.sql:87, 89` grant `platform_app` `DELETE` on `processed_events` and `job_executions` for every row. The 30-day horizon exists only in `purge.ts`.
  - A deleted ledger row reopens its once-only effect: the next delivery of the same job or event runs it again, for example a label purchase or a notification.
  - Lint confines the raw statements to `apps/worker/src/platform/**` (P2). That glob is broad: queues, jobs, health, logging, and from TASK-047 the job context.
  - D-ARCH-171 accepted the grant together with the purge. The design rests on the code predicate.
- **Second arm (RB-06).** A replay near the horizon re-enqueues an event whose `processed_events` claim and follow-up `job_executions` rows may be purged before the replayed jobs finish. For example, an event published 29.9 days ago, behind a backlog. The effects then run again. D-ARCH-171's "one-shot for 30 days" ends exactly there.
- **Exploitability and impact.** It takes a defect in worker platform code, or an operator replay near day 30. The guardrail "duplicate labels" then rests on the state checks of the saga and carrier steps (ADR-0014). Impact Medium, likelihood Low, so LOW.
- **Remediation.**
  - (a) A row-level guard on the two ledgers, and on `outbox_events` for unpublished rows: `BEFORE DELETE … FOR EACH ROW` raising unless the row is past the horizon (`completed_at` / `processed_at` / `published_at` `< now() - interval '30 days'`). It is applied to every role and refuses a `DELETE` inside the horizon, including one by a defect. Or principal-architect accepts the residual in writing.
  - (b) RB-06 card line for the P7 runbook task: "a replay covers only events published less than 29 days ago, so their consumers' claims outlive the replayed delivery".
- **Verification test.** (a) Lane B: as `platform_app`, a `DELETE` of a 29-day ledger row raises, and the purge test's 31-day rows still go. (b) A runbook review item.

### PR043-SEC-07 (INFO): relay and purge share the worker's `anonymous` admission key

- **Description.** `systemContext` gives `orgId: ''` (`system-tx.ts:25`), which `admissionKeyOf` maps to `ANONYMOUS_KEY` (`tenant-admission.ts:87`). The bulkhead is always configured, at half the pool by default, so the relay tick, the purge batches, `queue-retention` and every guest-context job of the worker (once TASK-047 resolves guest jobs) draw from one permit pool.
- **Effect.** If guest-context jobs saturate it, the relay's admission wait expires, the tick throws and backs off, and event delivery slows behind guest traffic. The last-tick gauge stops, so `OutboxRelayStalled` does fire.
- **Remediation (TASK-047, which builds the worker's runner twin).** Give SYSTEM-actor contexts their own admission key, or exempt the relay tick. Test: a saturated `anonymous` key does not refuse a relay tick.

## 6. Earlier items

| Item | Status |
|---|---|
| PR64-SEC-13 (TASK-043 condition: producer queues through the factory, with an AUTH-refusal test) | **TASK-043 half met.** The lint half stays with the next lint-lock holder, as recorded in PR-0064 |
| PR64-SEC-09 (unowned worker and shared queue paths, devops) | Stays open. It gains `apps/worker/src/platform/outbox/` and `packages/shared/src/events/` (C4-1, PR043-SEC-01) |
| Code review m5 / R2-m3 | Seam arm: R2-m3. Deep-import arm and the shallow check: PR043-SEC-02 and PR043-SEC-01 |
| D-ARCH-171 (DELETE on `job_executions` with the purge) | Implemented as ruled: the grant, the manifest line, `hardDelete`, the predicate, batches of 5,000 and the 29-day test row. The residual is PR043-SEC-06 |
| D-SECPR039-01 conditions (i) to (iv) for `outbox-purge` | Hold (P7) |

## 7. Binding

- **The `Head` row names `da996002`.** It is the commit the code review's round 2 binds. The dispatched commit `c60959bd` would bind as well, because `c60959bd..da996002` changes no owned path.
- **The follow-up commit does not void the binding.** The relay and metrics fix (F3, F7) touches `apps/worker/**` and `docs/sdlc/DECISIONS.md` only, and both are unowned. Any later commit that touches only those keeps it too.
- **Updating the branch with main voids it.** Main changed `tools/lint/negative-fixtures.test.ts` (an owned path this PR also changes), so the merge commit changes an owned path after the head (PR10-SEC-21). A merge-only security round on that merge commit is then owed. A fix for PR043-SEC-01, -02, -03 or -05 in an owned path needs a delta round too.
- **Simulation with main's real checker.** It ran in merge-ref form on main `164be6b0`, with the record committed as `PR-9999-…` and `--pr 9999`, against plumbing scenario commits in a shared clone. 9 of 9 came out as expected.
  - **Pass:** the record merged with `da996002`; a later commit in `apps/worker` only; a `Head` row naming `c60959bd`.
  - **Fail:** no record; a `Head` row naming the base; a later FAIL verdict row; a later commit in an owned path (`apps/api/package.json`); the placeholder file name only; the branch updated with main. The last one fails with "`tools/lint/negative-fixtures.test.ts` changed after it".
  - **The branch must merge main anyway,** because of the DECISIONS.md conflict, so the merge-only round is practically certain.

## 8. Routing

| To | Items |
|---|---|
| TASK-043 fix cycle (backend-developer via senior-developer) | PR043-SEC-03 (lane A turns red otherwise); PR043-SEC-01 (preferred here); PR043-SEC-02 (a) tripwire; PR043-SEC-04 code line once the architect amends item 11; PR043-SEC-05 column grant while the migration is unmerged (if the architect agrees) |
| principal-architect | PR043-SEC-04 (ADR-0004 amendment 2 item 11 definition), PR043-SEC-05 (column grants and optional binding guard; data-model §4.4 row), PR043-SEC-06 (guard or written acceptance) |
| senior-developer, plan fold | TASK-078: T078-1 to T078-5 replace the placeholder "DISPATCH GATE: TOKEN_ENC OVERWRITE OUTCOME". TASK-047: PR043-SEC-07; C4-1 (no producer for processors before the lint change). The next lint-lock holder: PR043-SEC-02 (b) beside R2-C5. TASK-049: PR043-SEC-01 as a merge prerequisite if the fix cycle does not take it. P7 runbook task: PR043-SEC-06 (b). TASK-214: C4-2 |
| devops-engineer | PR64-SEC-09 paths (C4-1, PR043-SEC-01); PR043-SEC-03 option (b) if chosen |
| security-analyst (self) | C4-3: the threat model's T-83 row before G3 |
| quality-gatekeeper | QG-043-C4 first half answered (§3, conditions C4-1 to C4-3); QG-043-C3 answered (§4) |

| Verdict | **PASS_WITH_FOLLOW-UPS.** Round 1 at `da996002`: 0 Critical, 0 High, 0 Medium. New: PR043-SEC-01, -02, -04, -05, -06 LOW; PR043-SEC-03 (merge-relevant: lane A unit) and PR043-SEC-07 INFO. QG-043-C4: concurrence with the T-83 exception, the PostgreSQL lock and "nothing is parked", conditions C4-1 to C4-3. QG-043-C3: ADR-0004 amendment 3 item 21 confirmed, conditions T078-1 to T078-5. Owed: lane B PASS on the head, the hosted `security-integration` job at the pushed head, the rename and merge-ref check, and a merge-only round if the branch merges main |

---

# Round 2 (delta, bound to head `93f9faa0`)

| Field | Value |
|---|---|
| Head | 93f9faa02797a191081a51192a1b6e5d3d83fa73 |
| Path since round 1 | From `da996002` the branch gained three commits: `6388aef2`, a merge of main `feb00326` (which carries round 1 of this record); `07788996`, fix cycle 2 (PR043-SEC-01 to -04, plus D-ARCH-197 F14 and F15); and `93f9faa0`, a merge of main `af4a1b48` (ADR-0004 amendment 4, D-ARCH-196 to -199). Main tip when this round was written: `a3d0a02b` (docs only after `af4a1b48`). The evidence worktree is detached at `93f9faa0` with lane B queued; I ran nothing in it |
| Owned paths, PR against main | 27 (`--base af4a1b48 --head 93f9faa0`). Compared with round 1, `apps/api/package.json` dropped out (it now equals main) and `apps/api/src/platform/routing/tests/timing.ts` came in. Fix cycle 2 changed 11 owned paths: the migration, `grants.manifest`, `platform.prisma` (comment), `tools/db/grants-manifest.test.ts`, `apps/api/package.json`, `routing/tests/timing.ts`, and `outbox/{index,writer,tests/test-outbox,writer.int.test}.ts` with `runtime/index.ts` (comments) |
| Method | Static review of `6388aef2..07788996`, plus the round 1 probes re-run on `git archive` extracts of `93f9faa0`: the Joi walk with the real Joi 18, the image-exports predicate, and the relay with type-stripped sources and a fake runner. Also a merge-purity check of both merges and a record simulation with main's real checker. No npm, Jest, lint run, Docker or PostgreSQL. The `*.int.test.ts` rows (42501, 23514, column privileges) are read, not run |

## R2.1 The two merges of main are pure

| Merge | Parents | Result |
|---|---|---|
| `6388aef2` | `da996002`, main `feb00326` | The only conflict is `docs/sdlc/DECISIONS.md`, and the merge takes main's file whole (byte-identical to `feb00326`; the PR carries no DECISIONS.md delta any more, code review R2-C3). Every other path, all 52 non-docs paths that main brought (PR #77, #78, #79 among them) included, equals the clean three-way merge. **`tools/lint/negative-fixtures.test.ts` is byte-identical to the clean merge,** so it is the union of main's rows and this PR's TASK-043 rows |
| `93f9faa0` | `07788996`, main `af4a1b48` | No conflict. The tree equals the clean three-way merge on every path. Main brought documents only |

## R2.2 Round 1 findings

| ID | Status | Evidence |
|---|---|---|
| PR043-SEC-01 (LOW) | **Closed** | `isClosedObjectSchema` (`event-definition.ts`) now walks `describe()`: no `unknown` flag, no `allowUnknown` preference and no `patterns` at any depth; objects need `keys`; arrays need exactly one closed `items`; strings need `pattern`/`guid`/`isoDate`/`base64` or `valid`; other leaves are only number, boolean and date. Probe with the real Joi: all ten round-1 shapes are now refused by `mergeEvents`, and both controls (`identifierPayload`, a `valid` locale) are accepted. `events.test.ts` carries the ten shapes as `[PR043-SEC-01]` refusal rows and five accepted forms. The residual shapes outside the round-1 list are PR043-SEC-08 |
| PR043-SEC-02 (LOW) | **Tripwire arm extended, but incomplete: reopened by code review R3-m2 (R2.5).** The boundaries arm stays with the next lint-lock holder (code review R2-C5) | `tools/repo/test-seams.test.ts` (D-TASK043-12) adds `test-outbox` and `@platform/api/testing[/…]` to the seam specifiers. A second scan resolves relative specifiers against the importing file and refuses any production file under `apps/*/src` other than `outbox/index.ts` that reaches `platform/outbox/writer`. Planted positive controls cover five forms each, plus negatives (`test-outboxes`, `testingx`, `./writer.js` elsewhere). A non-vacuity check shows the barrel is seen. On `93f9faa0` no production file names the seam or the writer (`git grep`: comments only). This covers the five round-1 forms A1, A2, A3, A5 and A9. **Residual:** the scan reads quoted specifiers only, so a no-substitution template literal (`` import(`../outbox/writer.js`) ``, lint-legal under `platform/static-module-specifier`) passes it. The resolved-file boundaries twin of R2-C5 is what catches every spelling; that card line must name this form |
| PR043-SEC-03 (INFO) | **Closed** | `./testing/outbox` is removed. `createTestOutbox` is re-exported from `routing/tests/timing.ts`, the target of the one sanctioned `./testing` subpath. Re-running the `image-exports.test.ts` predicate with the head's `shouldRemove` and `SKIPPED_EXPORTS` finds no pruned, non-skipped export in `@platform/api`, `@platform/worker` or `@platform/shared`; the `./testing` control is pruned and skipped. `@platform/api/testing` is in the tripwire's seam set, so api production code cannot use it. Worker production code was already refused by boundaries (round 1, A4/A6), and the subpath is pruned from the image |
| PR043-SEC-04 (LOW) | **Closed** | `relay.ts`: `if (tick.locked) metrics.tickEnded(...)`, and the HELP text and the module comment say "held the relay lock" (D-ARCH-196, ADR-0004 amendment 4 item 24). Probe P5 R1 on `93f9faa0`: with a foreign holder, `OutboxRelayStalled` (> 60 s) now fires; the control with the lock still shows lag 600; and in normal operation (the lock held) Stalled stays off. The `[PR043-SEC-04]` unit rows match D-ARCH-196's change list |
| PR043-SEC-05 (LOW) | **UPDATE and actor arms closed (F14, F15); the `org_id` INSERT arm is open and routed to TASK-047 (D-ARCH-197 item 3)** | `migration.sql`: `GRANT SELECT, INSERT, DELETE` plus `GRANT UPDATE (published_at, attempts, last_error, updated_at, updated_by, version)`; `grants.manifest` holds the column line and the pins list six column tuples. The relay's two mark statements write exactly those columns, and the standard-columns guard sets `NEW` values, which needs no column privilege. `ck_outbox_events__actor CHECK (actor_id = created_by)` binds the actor through the guard's pin on `created_by`. Lane B rows (read, not run): column privileges listed from `information_schema.column_privileges`; `UPDATE` of `org_id`, `actor_id` or `payload` as `platform_app` gives 42501 while the marks pass; an insert with `actor_id` ≠ `created_by` gives 23514. Migration-linter rule 8 tests `delete|all` in the privilege text, which a column list does not contain; lane A's `lint-migrations` run is the evidence. TASK-078 adds `payload` to the grant (T078-3) |
| PR043-SEC-06 (LOW) | **Accepted residual with an owner** (D-ARCH-198, R-ARCH-38): the definer-function purge, 45-day ledgers and the 14-day replay bound land in a late task before G3. TASK-043 is unchanged for it, as ruled. I close it on that task |
| PR043-SEC-07 (INFO) | Routed to TASK-047 (D-ARCH-199: admission key `system` for organisation-less SYSTEM-actor transactions) |
| QG-043-C4 conditions | C4-1 unchanged: still one producer call site (`relay.ts`). C4-2 met by the SEC-04 fix. C4-3 (threat-model T-83 row) is still my action before G3 |
| QG-043-C3 (T078-1 to T078-5) | Unchanged. D-ARCH-197 adds nothing contrary; T078-3's column-grant extension is now concrete (`payload` joins the `UPDATE` column list) |

## R2.3 New finding

| ID | Title | Severity | CWE | OWASP | File:line | Owner / due |
|---|---|---|---|---|---|---|
| PR043-SEC-08 | The closed-schema walk does not see `when`, `ordered`, `custom`, inverted patterns or default functions (with code review R3-m1, widened in R2.5) | INFO | CWE-1173 | A04 | `packages/shared/src/events/event-definition.ts` (`closedNode`) | TASK-049 merge prerequisite (the first event file), or any earlier fix cycle that touches the file |

- **Description.** Six shapes were probed against the round-2 walk. My round-1 proposal had the same gaps; the developer implemented it as proposed. Five of them pass `mergeEvents` and store an e-mail address:
  - `Joi.object({}).when('b', { then: Joi.object().unknown() })`: `whens` is not read.
  - `Joi.array().items(Joi.number()).ordered(Joi.any())`: `ordered` is not read.
  - `Joi.string().guid().custom(() => value)`: a custom rule replaces the value even with `convert: false`.
  - `Joi.string().pattern(re, { invert: true })`: the walk counts the rule as a grammar.
  - `Joi.number().default(() => value)`: a default function inserts a value.
  - The sixth, a pattern that matches anything (`/^[\s\S]*$/`), cannot be decided mechanically and stays a review item.
- **Refused already** (controls): `Joi.link` to a shared free string, a `Joi.extend` custom type, `items(guid, any)` and `concat` with an open object. A `when` that switches a `guid` string to a free string passes the walk but is harmless: the base rule still applies and the value is refused.
- **Exploitability and impact.** Each shape is deliberate code in an event file, and none is a natural spelling of "an open payload". The event catalogue is empty until TASK-049. INFO.
- **Remediation.** In `closedNode`, after the existing first check:

  ```ts
  if (node.whens !== undefined || node.ordered !== undefined || node.externals !== undefined || node.flags?.default !== undefined) return false;
  if ((node.rules ?? []).some((rule) => rule.name === 'custom' || (rule.name === 'pattern' && rule.args?.options?.invert === true))) return false;
  ```

  `SchemaNode` gains `whens`, `ordered`, `externals`, `flags.default` and `rules[].args`. Validated on a scratch copy of the round-2 module: the five gaps are refused; the two controls, `.empty()` and the round-1 rows are unchanged. The permissive-pattern case stays with the reviewer of each event file (PR64-SEC-09 path `packages/shared/src/events/`).
- **Verification test.** Five more `[PR043-SEC-08]` refusal rows in `events.test.ts`.

## R2.5 Rulings on code review round 3 (`74a91e1d`, R3-m1 and R3-m2)

- **R3-m1 is PR043-SEC-08, widened. Ruling: not a merge condition of TASK-043.**
  - **Due:** a merge prerequisite of TASK-049, the first catalogued event type. It may land earlier in any commit that touches `event-definition.ts`.
  - **Why not now:** the catalogue is empty, so no payload can be stored until an event file exists. The file is not an owned path, so the fix keeps this binding. TASK-043's last fix cycle is better kept for lane B outcomes.
  - **Scope of the fix, as one item:**
    - (a) **The walk refuses** any node with `whens`, `ordered`, `externals` or `flags.default`, any `custom` rule, and a `pattern` with `invert` (validated, R2.3).
    - (b) **Patterns.** Every `pattern` regex must refuse a fixed probe set when the catalogue loads: an e-mail address, a string with a space, the empty string and a 257-letter string. Pattern quality beyond that stays a review duty of every catalogue PR, which is why `packages/shared/src/events/` joins the PR64-SEC-09 owned paths.
    - (c) **`base64`** is allowed only under keys that end in `_enc`, the ciphertext convention of the token amendment (`token_enc`). `closedNode` takes the key name for that.
  - **Tests:** one refusal row per shape and rule, plus the controls (`identifierPayload`, a `valid` locale, a `token_enc` ciphertext key).
- **R3-m2 reopens the tripwire arm of PR043-SEC-02 (LOW). Ruling: recommended in this PR, required at the latest before TASK-049 merges.**
  - **The gap.** Fix cycle 2 moved the seam into `apps/api/src/platform/routing/tests/timing.ts`, and the tripwire does not know that file. A production import of `…/routing/tests/timing.js` hands out `createTestOutbox`, and neither lint nor the tripwire sees it. So my R2.2 closure of the tripwire arm was incomplete.
  - **Why it is not a merge blocker.** The image preflight imports every compiled production module after prune-dist has deleted `tests/` (this is from the preflight's design; I did not run it). A production module that imports a `tests/` file therefore fails `docker build`, so the bypass cannot ship.
  - **Why it is still worth doing now.** The fix is about 15 lines in `tools/repo/test-seams.test.ts`. That path is not owned, so the fix keeps this binding. If TASK-043 runs a fix cycle 3, it belongs there.
  - **Form of the fix: the general rule.** Flag any non-test file under `apps/*/src` and `packages/*/src` whose relative specifier, resolved against the file, lands in a `test`, `tests` or `__tests__` folder. Also flag any `@platform/<pkg>/testing` specifier, beyond `@platform/api/testing`. Add positive-control rows for `../routing/tests/timing.js` and one `packages/` form.
  - **Lint twin.** The resolved-file boundaries policy of R2-C5 must cover the same rule, plus the no-substitution template-literal `import()` spelling (R2.2).

## R2.4 Binding

- **Head and simulation.** The `Head` row of this round names `93f9faa0`. The later docs-only merge of main, `320933c1` (story notes), changes no owned path (main's checker: `not-required`, 0), so this binding holds for it. Main's real checker ran in merge-ref form on main `a3d0a02b` with this record committed as `PR-9999-…`; the scenarios are listed in D-SECPR043-02.
- **Why the round-1 row no longer binds.** It names `da996002`, and owned paths changed after it (the fix cycle and main's paths through the merges). Only this round's row binds.
- **Later commits.**
  - A later commit that touches only unowned paths (`apps/worker/**`, `packages/shared/src/**`, `DECISIONS.md`) keeps this binding. A PR043-SEC-08 fix in `packages/shared/src/events/` is such a commit.
  - A later merge of main voids it only if main has by then changed an owned path that this PR also changes. Main's changes after `af4a1b48` are documents only.

| Verdict | **PASS_WITH_FOLLOW-UPS.** Round 2 at `93f9faa0`: 0 Critical, 0 High, 0 Medium. Both merges are pure, `negative-fixtures.test.ts` included. Closed: PR043-SEC-01, -03 and -04; PR043-SEC-05 UPDATE and actor arms (F14, F15). PR043-SEC-02 reopened for its tripwire arm by code review R3-m2: the general `tests/`-folder rule is recommended in this PR and required before TASK-049 merges; it is not a merge blocker, because the image preflight refuses a production import of a pruned `tests/` file. Open with owners: PR043-SEC-05 `org_id` INSERT arm (TASK-047), PR043-SEC-06 (late task before G3, accepted residual R-ARCH-38), PR043-SEC-07 (TASK-047). New: PR043-SEC-08 INFO, widened by code review R3-m1 (whens, ordered, custom, inverted and permissive patterns, default functions, `base64` only under `*_enc` keys): a merge prerequisite of TASK-049, not of this PR. QG-043-C4: C4-2 met; C4-1 and C4-3 open as before. Owed: lane B PASS at `93f9faa0` (the 42501 and 23514 rows, C5 with the column tuples), the hosted `security-integration` job, the rename and merge-ref check |
