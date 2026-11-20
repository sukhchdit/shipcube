# PR-pending: TASK-039 (idempotent job processing, singleton scheduled jobs, bounded queue retention), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-039-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>`, so under the placeholder name the record step is red (section 8, control S3).

Order (D-ORCH-136, D-ORCH-138):
1. Open the PR as a draft.
2. Rename the record on main.
3. Confirm that the PR's merge ref contains the renamed record: `git fetch origin refs/pull/<n>/merge`, then `git ls-tree` it. Its first parent must be the rename commit or later.
4. Mark the PR ready.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-039-idempotent-job-processing-singleton-scheduled`, one commit `64eefab` on `7da0e50` (an ancestor of main; main has moved by docs commits only since then, and TASK-293 `f723fef` is in the base, so the MERGE PREREQUISITE line of the card is met) |
| Head | 64eefab9fab5c8cd25d9802034ca78162319f7ae |
| Lane A evidence | None: the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs`, run from the main checkout on `7da0e50..64eefab`) gives `security_paths=true` with 8 trigger paths (the migration pair, `platform.prisma`, `grants.manifest`, the `prisma/tests/worker` case, `worker.json`, and the two `apps/api/src/platform/db` files), so the hosted `security-integration` job runs on the PR |
| Lane B evidence | None for `64eefab` at review time. The Valkey and PostgreSQL integration cases this record leans on (`retention.int.test.ts`, `consumer.int.test.ts`, `prisma/tests/worker/job-executions.int.test.ts`) were read, not run |
| Owned paths changed | 9, as main's checker counts them (`--base 7da0e50 --head 64eefab`): `prisma/migrations/20261119000000_job_executions/{migration,down}.sql`, `prisma/schema/platform.prisma`, `prisma/sql/grants.manifest`, `prisma/tests/worker/job-executions.int.test.ts` (`/prisma/`), `tools/db/grants-manifest.test.ts`, `tools/db/table-classes/worker.json` (`/tools/db/`), `apps/api/src/platform/db/system-models.ts`, `apps/api/src/platform/db/system-db.test.ts` (`/apps/api/src/platform/`). So this record is a merge condition |
| Unowned paths changed | 26: `apps/worker/src/platform/{jobs,queues}/**` (15), `apps/worker/src/{processors,start-worker,start-worker.test}.ts`, `packages/shared/src/queues/**` (7) and `packages/shared/src/classification/registry.ts` |
| Binding items checked | The TASK-039 card (`docs/04-plan/tasks/WAVE-01.md`); ADR-0013 §2, §4, §5 and amendment 3 items 7 to 11 and 16 (D-ARCH-159, D-ARCH-160, D-ARCH-161); the PR #64 record (`PR-0064-TASK-035-security-review.md`, rounds 1 and 2: PR64-SEC-04, -06, -07, -08, -09, -11, -12, -13); D-ORCH-139; `infra/local/valkey/users.acl`; `prisma/sql/function-templates/std-columns-guard.sql`; the `platform/system-model-owner` lint rule; BullMQ 6.7.0 in the main checkout (`classes/job-scheduler.js`, `classes/queue.js`, `classes/worker.js`, `classes/redis-connection.js`, `commands/cleanJobsInSet-3.lua`, `commands/includes/cleanList.lua`, `addJobScheduler-11.lua`, `updateJobScheduler-12.lua`). The code review twin on main: `docs/05-quality/reviews/PR-pending-TASK-039-code-review.md` (`e61d3f4`, CHANGES_REQUESTED, section 7). D-ARCH-171 (`035299d`, written in parallel with this round: the ledger key per queue, the 30-day purge by TASK-043, the data-model §3.5 entry) |
| Reviewer / date | security-analyst, 2026-11-20, round 1, pre-push. Host rule (lane B owns the machine): no npm, Jest, type-check, build or Docker. Method: static review plus single-process Node 24 probes on `git archive` extracts of `64eefab` and `7da0e50`, with the sources type-stripped by a resolve/load hook and bare packages resolved from the main checkout; the migration ran on PGlite 0.4.3 (PostgreSQL 17.5, `uuidv7()` stubbed). Nothing ran in the PR worktree, not even read-only git: commits were read from the main checkout's shared object store. Line numbers come from single-file reads at `64eefab` |

## 1. Summary

The controls this task was asked to add are in place and hold in their direct form:

- **Scheduled-job identity (D-TASK039-01) is sound.** 34 dequeue rows (P1) behave as designed: an occurrence is accepted only with the closed `{ v: 2, schedule }` payload of a schedule declared on that queue, the name equal to the schedule and the id `repeat:<schedule>:<millis>` naming the same schedule; foreign queues, ids, names, leading zeros, newline suffixes, legacy five-part repeat keys, extra keys, string versions, arrays, `__proto__` and `constructor` are refused. The id form is BullMQ's own (verified in source). The ruling is in section 4: **accepted**, with four conditions for later schedules.
- **Aggregate job identity (PR64-SEC-07):** a job whose id names another aggregate, carries an empty, upper-case, two-part or over-long step, or whose name is not the kind is refused before the processor.
- **The migration is clean.** The linter gives 0 findings over both lanes, its mutation controls fire (a DELETE or PUBLIC grant, a missing header, a data-changing statement), the guard block is byte-identical to `renderStdColumnsGuard`, the grants manifest validates and C10 is clean. On PGlite (P4): the claim inserts once and then nothing, the standard-columns guard refuses a foreign `created_by` and `version` 2, the CHECKs refuse bad keys, queues and statuses, and `platform_app` gets 42501 on UPDATE, DELETE and TRUNCATE.
- **The claim is inside the effect's transaction.** `idempotentProcessor` claims and runs the effect in one `transaction(job, tx => …)` callback. A fake that models the unique-index wait (P5) shows one effect when a retry overlaps a hung first attempt: the retry's claim waits, then skips.
- **`clean()` is never called with a limit of 0.** There are two production call sites. The record trim calls only for a surplus that is a safe integer of 1 or more. The sweep uses the constant batch of 1,000. BullMQ 6.7.0 reads `limit || Infinity`, and its list clean reads only the oldest `limit` entries (`LRANGE -limit -1`).
- **Dead-letter records stay redacted and bounded.** A 100,000-key payload gives a 3,118-byte record, a 1,000-deep one 251 bytes, and the message stays at most 500 characters.
- **No secrets.** The ACL case generates its credentials and swaps only the hashes. New log lines carry class names, counts, queue names and job ids. The Gitleaks over-approximation gives 4 hits on the added lines, all suppressed by the real rule's stopwords.
- **Ownership.** The ownership lint rule lets only `apps/worker/src/platform/**` reach `jobExecution` (casts, `satisfies`, non-null, destructuring and brackets in an api module are all `notOwner`, P7).

Two LOW findings, both shared with the code review twin, and three INFO:

- **PR039-SEC-01** (= code review R1-M1). The per-job deadline arms its timer before it calls the processor. A processor that throws synchronously leaves the timer armed. When it fires, the rejection is unhandled, and the process handlers exit the worker with 1. This repeats on every attempt of the job. A fix is validated on a scratch copy.
- **PR039-SEC-02** (= R1-m1). `job_executions.job_key` is unique across all queues, but BullMQ ids are unique per queue, and the kind `shipment` is valid on two queues. A completed `shipment.<id>` on one queue makes the same id on the other a "duplicate", and its effect is silently skipped. The composite key `(queue, job_key)` is validated on PGlite, and D-ARCH-171 (written in parallel) requires exactly that index.
- **PR039-SEC-03 to -05 (INFO).** A late commit after the deadline; gaps in the forgery signal; the reserved `result` column and the SELECT grant (the ledger's growth is settled by D-ARCH-171).

The negative half of the PR64-SEC-11 ACL case passes for the wrong reason (code review R1-m3): BullMQ's `INFO` at connection set-up is refused to the `api` user before any `bull:*` key is touched. PR64-SEC-11 therefore stays open (section 6).

## 2. Findings

| ID | Severity | CWE / OWASP 2021 | Where (`64eefab`) | Title | Owner, due |
|---|---|---|---|---|---|
| PR039-SEC-01 | LOW | CWE-755 / A04 | `apps/worker/src/platform/queues/job-handler.ts:119-137` (`runWithDeadline`; the call at `:129`, the timer at `:121-128`) | A processor that throws synchronously crashes the worker when its deadline passes | This PR's fix cycle; at the latest before the first processor is registered (TASK-043/047) |
| PR039-SEC-02 | LOW | CWE-694 / A04 | `prisma/migrations/20261119000000_job_executions/migration.sql:33`; `apps/worker/src/platform/jobs/idempotent-processor.ts:52-59`, `:84`; `packages/shared/src/queues/documents.ts:5`, `tracking.ts:5` | The idempotency key is global, BullMQ ids are per queue: a cross-queue "duplicate" silently loses an effect | This PR's fix cycle, as D-ARCH-171 item 2 now requires (the migration is not merged, so the change is free; the ADR-0013 §4 note is done) |
| PR039-SEC-03 | INFO | CWE-662 / A04 | `job-handler.ts:119-137`, `:233-244`; `idempotent-processor.ts:83-87` | After the deadline the attempt is failed while its effect may still commit, and non-transactional work can overlap the retry | `throwIfAborted` in `idempotentProcessor`: this PR; signal discipline: TASK-047 and the saga/carrier tasks |
| PR039-SEC-04 | INFO | CWE-184 / A09 | `packages/shared/src/queues/payload-v2.ts:138-139`, `:146`, `:168-181` | The forgery signal misses compound tenant-key spellings and anything beyond its walk bounds | This PR's fix cycle (with R1-m2) or TASK-047 |
| PR039-SEC-05 | INFO | CWE-770, CWE-359 / A04 | `migration.sql:23`, `:40`; `packages/shared/src/classification/registry.ts` (`job_executions.result: INT`) | `result` is an unused, writable JSONB column classified INTERNAL; the claim needs no SELECT; growth (settled by D-ARCH-171) | `result`: optional, this PR's fix cycle, else the first writer; purge: TASK-043 (D-ARCH-171) |

## 3. Findings in detail

### PR039-SEC-01 (LOW): a processor that throws synchronously crashes the worker when its deadline passes

**Where.** `runWithDeadline` (`job-handler.ts:119-137`) builds the `expired` promise and arms its timer (`:121-128`), and only then calls `work(controller.signal)` (`:129`). The `try { await Promise.race(...) } finally { clearTimeout(timer) }` starts at `:132`.

**What happens.** A processor that throws before it returns a promise makes `work(...)` throw at `:129`. The async function rejects at once, so the handler records the failure and rethrows the sanitised `TRANSIENT`. But neither the `try` nor the `finally` has run: the timer stays armed, and `expired` has no handler, because `Promise.race` was never built. `deadlineMs` later (5 minutes in production) `reject(error)` fires on an unhandled promise.

**Probe P2** (`p2-deadline.mjs`, child process, `deadlineMs: 200`, the real `createJobHandler` from the extract):

| Processor | Head `64eefab` | Fixed scratch copy |
|---|---|---|
| Non-async, throws synchronously | handler rejects `TRANSIENT`, then `unhandledRejection` `JobDeadlineError` at 200 ms, exit 70 | no unhandled rejection, exit 0 |
| `async`, throws | no unhandled rejection (control) | same |
| Never settles, ignores the signal | aborted at 200 ms, attempt `TRANSIENT` (control) | same |

**Exploitability and impact.**
- `installProcessErrorHandlers` (`apps/api/src/platform/runtime/process-errors.ts:81-93`) logs `fatal` and exits with 1 on an unhandled rejection. Every job active on that worker stalls and is re-delivered, with no drain.
- The job is retried (5 attempts), and each attempt arms a new timer. One such job is therefore up to five worker crashes, 5 minutes after each attempt.
- Nothing registered today throws synchronously: `PROCESSORS` is empty, and `createScheduleProcessor` and `idempotentProcessor` return `async` functions. But `JobProcessor` is typed `(…) => Promise<void>`, `@typescript-eslint/promise-function-async` is not enabled, and a "validate, then return the promise" processor is an ordinary shape. Before this PR the same throw was caught inside the handler's `try`, so this is a regression in the primitive every later processor runs under.
- Impact is availability (HIGH, a crash loop on one poison job); likelihood is LOW (it needs a future processor of that shape). Matrix: LOW.

**Fix (validated on a scratch copy, P2 right-hand column).** Create the running promise before the timer, and through an async wrapper, so a synchronous throw becomes a rejection:

```ts
const controller = new AbortController();
// A processor that throws before it returns a promise becomes a rejection here, BEFORE any timer is armed.
const running = (async () => work(controller.signal))();
running.catch(() => undefined);
let timer: NodeJS.Timeout | undefined;
const expired = new Promise<never>((_resolve, reject) => { timer = setTimeout(() => { … }, deadlineMs); });
try { await Promise.race([running, expired]); } finally { clearTimeout(timer); }
```

The code twin's `expired.catch(() => undefined)` is a good second line.

**Verification test.** A unit case with a non-async processor that throws synchronously and `deadlineMs: 20`:
- the attempt is recorded (`worker.job_failed`, `TRANSIENT`);
- a `process.on('unhandledRejection')` spy is not called after 60 ms (or `jest.getTimerCount()` is 0 under fake timers);
- with the fix reverted, the case goes red.

### PR039-SEC-02 (LOW): the idempotency key is global, BullMQ ids are per queue

**Where.** The unique index is on `job_key` alone (`migration.sql:33`). The claim uses `job.id` as the key and stores `job.queue` beside it (`idempotent-processor.ts:52-59`, `:84`). BullMQ scopes a job id to its queue. The kind `shipment` is declared on `documents` and on `tracking-poll` (`documents.ts:5`, `tracking.ts:5`), and the dequeue check accepts `shipment.<id>` with name `shipment` on both (P1 rows A12 and A13).

**What happens.** A `shipment.<id>` job completed on one of those queues inserts the key. The `shipment.<id>` job of the other queue then claims nothing: the processor logs `worker.job_duplicate_skipped`, BullMQ marks the job completed, and no effect runs. PGlite (P4, P4b): at the head, the claim of `shipment.u1` on `tracking-poll` after `documents` inserts 0 rows.

**Exploitability and impact.** No attacker is needed; this is an integrity failure of the replay control itself. The effect is lost silently, and it stays lost: the key never expires, and a re-enqueue is skipped again. Examples are a shipment without its customs documents, or without its first tracking poll. That touches the run guardrail of "captured payments without a booked shipment" only indirectly, but it is the worst failure mode for an idempotency ledger. Likelihood: it needs a step-less `shipment.<id>` on both queues; D-ARCH-161 already steers tracking polls to `tracking_poll.<schedule_id>.<occurrence>`, and the producers of `documents` and `tracking-poll` are not built yet. Matrix: impact MEDIUM, likelihood LOW, so LOW.

**Fix (validated on PGlite, P4b).** Scope the key to the queue while the migration is unmerged:

```sql
CREATE UNIQUE INDEX "ux_job_executions__queue_job_key" ON "public"."job_executions"("queue", "job_key");
```

with `@@unique([queue, jobKey], map: "ux_job_executions__queue_job_key")` in `platform.prisma`. The target-less `ON CONFLICT DO NOTHING` that `createMany({ skipDuplicates })` sends needs no change. With this index, the same id on `documents` and on `tracking-poll` inserts 1 row each, and a repeat on `documents` inserts 0.

The code twin's alternative (b), a key of `<queue>/<job id>`, is equivalent for security. D-ARCH-171 (`035299d`, written in parallel with this round) chose the same index as above, added a dated note to ADR-0013 §4 (which said `job_key UNIQUE`) and a purge index `ix_job_executions__completed_at`, and gave the fix cycle a card line. I concur. The `processed_events` precedent, keyed `(consumer, event_id)`, is the same shape.

**Verification test.** `prisma/tests/worker/job-executions.int.test.ts`: one job id claimed on two queues inserts a row each, and a second claim on the first queue inserts nothing. A unit case: two `idempotentProcessor`s on two queues with one id both run their effect.

### PR039-SEC-03 (INFO): after the deadline the attempt fails while its effect may still commit

**What happens.** The deadline (`job-handler.ts:233-244`) frees the worker slot and fails the attempt as transient, but it cannot stop a processor that ignores its signal. P5 shows the transactional part holds: the retry's claim waits on the hung attempt's uncommitted key, and then skips (1 effect). Two gaps remain:
- **On the final attempt,** the dead-letter record and the failed job say "failed", while the hung attempt's transaction can still commit the effect. An operator who redrives it then gets `job_duplicate_skipped`. That is safe, but the record misleads.
- **Work outside the transaction** in the hung attempt, such as a carrier or gateway call, can run alongside the retry's. This is the at-least-once contract of ADR-0013 §4 made concrete. It matters for the "duplicate labels" guardrail once carrier processors run under this handler.

**Recommendation.**
- **(a) This PR, one line.** In `idempotentProcessor`, call `job.signal.throwIfAborted()` after `await effect(...)` and before the transaction callback returns. A late effect then rolls back with its claim, and the record tells the truth.
- **(b) TASK-047 and the saga and carrier tasks.** Pass `job.signal` to every outbound call, and check it before each non-idempotent external step.

Code review R1-n5, the sweep that ignores its signal, is the same theme on the housekeeping side.

### PR039-SEC-04 (INFO): the forgery signal misses compound spellings and anything past its bounds

**Held.** P1: all ten spellings the card lists, plus `actor_type`, a full-width `ｏｒｇ＿ｉｄ`, `org id` and a zero-width-space `org​id`, are flagged at any depth up to 4 and inside arrays. An own `__proto__` is refused and flagged. The control payload is not flagged.

**Gaps (P1).** None of these raise `job_context_mismatch`. The payload is refused in every case (the schema is closed), so only the security event is missing:
- `on_behalf_of_org_id`: a real column name of this data model (data-model.md, the classification registry);
- `owner_org_id`, `orgUuid`, `org_ids`, `actor_user_id`, `user_id`, and a Cyrillic `о` in `оrg_id`;
- a tenant key at depth 6;
- a tenant key after 300 filler keys in `trace_context`, or after 300 root keys (the root is refused as `object.max` with `signal=false`). Code review R1-m2 gives the root-behind-nested-filler variant.

**Recommendation.**
- Count an exceeded bound (depth, keys) and the `object.max` refusal as a signal: no producer writes such a payload.
- Match a normalised key that ends in `orgid|tenantid|actorid|organisationid|organizationid|userid|orguuid`, or contains `org` plus `id`, instead of the anchored whole-key form.
- Add `on_behalf_of_org_id` as a test case.

### PR039-SEC-05 (INFO): the `result` column and the ledger's growth

- **`result JSONB`** (`migration.sql:23`). Nothing writes it: the ledger inserts `{ jobKey, queue, status }`. D-ARCH-171 records it as "reserved, no writer". It is classified INTERNAL, but `platform_app` may insert any JSON there (P4 C13, an e-mail address accepted), into a SYSTEM table where C10 assumes no personal data. **Recommendation:** optionally `CHECK (result IS NULL)` in this unmerged migration; in any case the first writer brings the column's classification and states what it stores (identifiers only).
- **`SELECT`** is granted (`:40`), but the claim needs only `INSERT`: P4b ran it with `SELECT` revoked, 1 then 0 rows. The data is identifiers only, so this is acceptable. If SELECT stays for a later reader, name the reader in `worker.json`.
- **Growth: settled by D-ARCH-171.** Rows are purged 30 days after `completed_at` by the housekeeping job of TASK-043, which also brings the `DELETE` grant and the `hardDelete` flag. The 30 days outlive every redelivery path of the same id on its queue: a retry or stall, an operator retry (7 days), a new enqueue after a dead letter (14 days), and an outbox replay (30 days, D-ARCH-167). I concur. The purge must keep the age predicate in its own SQL (ruling condition (ii) in section 4).

## 4. Ruling on D-TASK039-01 (scheduled-job identity)

**Accepted.** The decision: the Job Scheduler id is the closed schedule name. The occurrence carries `{ v: 2, schedule }` and is accepted only when the schedule is declared on that queue, its name is the schedule, and its id is `repeat:<schedule>:<millis>` naming the same schedule. Residual: a party that can write `bull:*` can forge an occurrence.

Why it holds:
1. **The id form is BullMQ's own.** BullMQ 6.7.0 builds the id the same way in three places:
   - `JobScheduler.getSchedulerNextJobId` returns `repeat:${jobSchedulerId}:${nextMillis}` (`classes/job-scheduler.js:287-288`);
   - the first occurrence comes from `addJobScheduler-11.lua:144`;
   - every later occurrence comes from `updateJobScheduler-12.lua:79`.

   The occurrence's name is the template name. A legacy repeat key (five parts) is refused (P1 S20). The regex is anchored, its classes are disjoint from `:`, and its repetition is bounded, so it is linear.
2. **The payload carries nothing a handler could act on.** The schema is closed, `convert: false`, with `v` and the schedule name only, so no handler can take a parameter from the job. The only handler (`queue-retention`, `runtime.ts:93-97`) calls `sweepRetention` with code constants (`PRODUCTION_RETENTION`, `SWEEP_BATCH`, `SWEEP_MAX_ROUNDS`).
3. **One schedule belongs to one queue.** `mergeQueues` refuses a schedule declared on two queues at load (`index.ts:50-62`). A schedule-only queue refuses a registered processor (`runtime.ts:92`). The schedule schema of a queue without schedules refuses every value (P1 S2, S3).
4. **The residual is bounded.** A forged occurrence runs one more sweep. The sweep removes only what is already past its bound at that moment, and records are always kept at least as long as failed jobs. Its effect therefore equals the hourly run moved earlier, plus load. A party that can write `bull:*` can already delete or add any job directly, so forging adds no capability. The control is the ACL. The `api` user has no `~bull:*` (`users.acl` at `64eefab`). The `worker` user is the only `bull:*` writer. The production parity is ElastiCache users at M5 (T-73, T-92).
5. **The occurrence is not checked against the clock.** A forger can pick any `millis`, so such a check would add nothing. Accepted.

Conditions for every later schedule (audit partitions, chain verification, purges, erasure):
- **(i)** A handler takes every parameter from code constants or configuration, never from the job.
- **(ii)** A handler whose effect is destructive or not naturally idempotent applies its policy predicate itself. Purges, for example, delete by age, never "because a run started". If it writes, it runs through `idempotentProcessor` keyed by the occurrence id. A forged or early occurrence can then only do what the policy already allows at that moment.
- **(iii)** `SCHEDULE_NAMES` stays a closed code list. The load-time one-queue check and the runtime refusal of a registered processor stay. A schedule name stays short enough that `<schedule>-<millis>` fits `CORRELATION_ID_PATTERN`: at most 47 characters (code review R1-n1). Otherwise every occurrence fails outside the handler's failure path.
- **(iv)** Any "run now" operator action enqueues through the scheduler (`upsertJobScheduler` or the same contract), never as a hand-made job with a `repeat:` id.

## 5. Verification of the focus items

### 5.1 The `job_executions` migration (P3, P4, P4b)

- **Linter.** `lintRepository` over the extract (migrations and bootstrap, TASK-293 lexer in the base): **0 findings**.
- **Mutation controls on a copy:**

  | Mutation | Linter | Caught by |
  |---|---|---|
  | `GRANT … DELETE` | rule 8 | the linter |
  | grant to `PUBLIC` | rule 8 | the linter |
  | header kind removed | rule 1 | the linter |
  | data-changing `UPDATE` | rule 10 | the linter |
  | `GRANT … UPDATE` | 0 findings | the C5 grants catalog suite and the PR's int case (42501) |
  | guard trigger removed | 0 findings | the C15 catalog suite |
  | `down.sql` emptied | 0 findings | the up-down-up suite |

  The last three are outside the linter's rules by design, not regressions. The suites in the last column cover them in lane B by their stated purpose (C5 compares live grants with `grants.manifest`, C15 checks the guard trigger of every `stdColumns` table, `tools/db/up-down-up.ts` checks that every `down.sql` reverts its migration); I did not run them.
- **Rendered guard.** `renderStdColumnsGuard(worker.json entry)` is byte-identical to the migration's block. `renderModule('worker')` gives exactly that block and no RLS block (SYSTEM).
- **Grants manifest.** `validateGrants` gives 0 problems. The tuples are `INSERT` and `SELECT` only and match the migration's one `GRANT`. A `DELETE` line is refused as "outside the hard-delete allow-list" (control).
- **C10.** No finding for `job_executions`. Removing the `result` entry produces "no classification registry entry" (control).
- **PGlite 0.4.3 (PostgreSQL 17.5; `uuidv7()` stubbed; the real `std_columns_guard` template and migration text), as `platform_app` with the SYSTEM actor:**
  - first claim 1 row, second 0;
  - foreign `created_by` refused with `P0001 STD_COLUMNS_VIOLATION`, and so is `version` 2;
  - no actor set means the anonymous actor, so a SYSTEM claim is refused;
  - CHECK `23514` for a job key of 201 characters, an empty job key, the queue name `Outbox_Relay` and the status `failed`;
  - UPDATE, DELETE and TRUNCATE give `42501`;
  - `down.sql` twice and then the migration again: OK.

### 5.2 The claim inside the effect's transaction (P5)

`idempotentProcessor` (`idempotent-processor.ts:79-90`) runs `ledger.claim(tx)` and `effect(payload, job, tx)` in one transaction callback. The production ledger reaches `systemDelegates(tx).jobExecution` through the worker twin. That twin throws until TASK-047 binds it, so it fails closed, and nothing registers a processor yet.

P5 composes the real `createJobHandler` and `idempotentProcessor` over a fake transaction that models the unique-index wait, with a 100 ms deadline. Attempt 1 hangs for 300 ms inside its transaction. Attempt 2 starts at once:
- attempt 2's claim waits;
- attempt 1's effect commits;
- attempt 2 claims 0 rows and logs `worker.job_duplicate_skipped`.

Result: **1 effect**. A job without an id, or with an id over 200 characters, is refused non-retryably before any transaction.

What the real client does is pinned by `prisma/tests/worker/job-executions.int.test.ts` in lane B: two concurrent claims, one winner; a rollback frees the key. Code review R1-m4 asks that case to use the production row shape through the standard-columns extension; I agree.

### 5.3 Retention and `clean()` (ADR-0013 amendment 3; PR64-SEC-04)

- **`jobOptions`** sets `removeOnFail: FAILED_RETENTION` (fresh copies).
- **Every consumer `Worker`** gets both bounds as defaults (`consumer.ts:100-101`).
- **The scheduler template** carries both bounds (`schedulers.ts:40-42`).
- **The production composition** is pinned to the three constants (`start-worker.test.ts`).
- **`clean()` call sites.** There are exactly two in production code:
  - `retention.ts:50`, only when `surplus` is a safe integer ≥ 1;
  - `retention.ts:63`, with `batch` = `SWEEP_BATCH` (1,000), because production passes no `sweepBatch`.

  BullMQ facts behind this:
  - `Queue.clean` computes `maxCount = limit || Infinity`, and per call `min(10000, maxCount)` (`classes/queue.js:464-479`).
  - For `wait`, the Lua script reads `LRANGE key -limit -1`, the oldest `limit` entries, and removes those at or below `now - grace` (`cleanJobsInSet-3.lua`, `includes/cleanList.lua`). Records are pushed at the head (LPUSH), so `clean(0, surplus, 'wait')` removes the oldest surplus.
  - The sweep repeats a call only while it removed exactly its batch, at most 10 times per queue and set.
  - A negative or `NaN` depth gives no call.
  - A `sweepBatch: 0` test seam would read as "no limit", but only aged entries could be removed. It is a seam, not production, so no finding.
- **The counter** `platform_queue_dead_lettered_total{queue}` has every series at 0 from start and counts once per final failure, including a failed record write. Its label values are the fixed kebab queue names, so no escaping or cardinality concern.

### 5.4 Dead-letter record content (P5)

The record keeps `redactValue(job.data)` (keyed redaction, e-mail masking, bounded by the walker's node, depth and string caps):
- a 100,000-key payload gives a 3,118-byte record;
- a 1,000-deep payload gives 251 bytes;
- `message` is `redactString(...)` cut to 500 characters, even for a 100,000-character issue text.

The STALLED record (PR64-SEC-08) carries the same redacted data. Its message is the reason code.

Unchanged since TASK-035, and noted only: the refusal message lists key names. The string redactor masks an e-mail address used as a key name, but not a digit-only key such as a card number. That is the free-text residual of PR64-SEC-02. The issue list is now capped at 20 entries.

### 5.5 Logs and secrets

**New events and their fields:**

| Event | Fields |
|---|---|
| `worker.dead_letter_trimmed` | queue, count |
| `worker.dead_letter_trim_failed` | queue, error class |
| `worker.dead_letter_duplicate` | queue, jobId, reason, attempts |
| `worker.job_duplicate_skipped` | queue, jobId, attempt |
| `worker.queue_retention_failed` | queue, error class |
| `worker.queue_retention_swept` | counts |
| `worker.schedules_registered` | schedule names |
| `worker.schedules_register_failed` | error class |

None carries job data, a message or a URL.

**The ACL case** reads `users.acl`, replaces the `api` and `worker` hashes with SHA-256 of 24 random bytes per run, and connects with those. No repository credential is used. The unit pin of the production options uses a placeholder URL with a one-character password.

**Gitleaks.** `curl` of the pinned v8.30.1 `config/gitleaks.toml` (220 rules compiled). The over-approximation (keyword prefilter and rule regex, no entropy, allowlists or stopwords) gave 4 `generic-api-key` hits on the 2,268 added lines:
- three test UUID keys contain the stopword `000000`;
- the redaction sentinel of the existing AT-US-009-04 case contains the stopwords `secret` and `value`, and it is the same value that PR #64 merged.

The real rule suppresses all four. Runtime-built controls fired (a GitHub PAT and a generic key).

### 5.6 The ACL case (PR64-SEC-11) and ownership (P7)

**ACL case, positive half.** The worker user, with generated credentials, processes a job end to end and runs one full sweep over the 18 queues (`failedQueues: []`), so `clean` and the trim scripts pass the ACL.

**ACL case, negative half (code review R1-m3, confirmed from source).**
- BullMQ runs `INFO` when a connection is set up (`redis-connection.js:275`, `:549-556`). The `queue` profile does not set `skipVersionCheck`.
- `INFO` is in `@dangerous`, which the `api` user lacks; the `worker` user has an explicit `+info`.
- So the expected `NOPERM` comes from `INFO`, and the case would still pass if `api` were given `~bull:*`.
- The Job Scheduler upsert under the ACL is not exercised either. That is minor: it runs the same class of scripts on `bull:*` keys.

**Ownership lint (P7).** `platform/system-model-owner` was run with the head manifests and schema over nine cases:
- the PR's own `as`-cast use in `apps/worker/src/platform/jobs/` is clean;
- in an api module, plain, `as any`, `satisfies` with non-null, destructuring and bracket access are all `notOwner`, and so are `apps/api/src/platform/db` and `apps/worker/src/modules/`;
- control: `referenceDatasetVersion` from the worker is `notOwner`.

### 5.7 Single-flight metrics (PR64-SEC-12)

`metrics()` keeps one in-flight promise and clears it in `finally` (`runtime.ts:153-162`). The unit case runs 25 scrapes against a never-ready connection and sees one promise and 18 `getJobCounts` calls. A rejected collection is shared by the joined scrapes, and the next scrape starts afresh.

## 6. Earlier items

| Item | Status after this PR |
|---|---|
| PR64-SEC-04 (LOW, T-77) | **Closes when this PR merges.** All four mechanisms of D-ARCH-159 and the counter of D-ARCH-160 are present and pinned (section 5.3). The `MEMORY USAGE` figures are a PR-body item from lane B (`reports/queue-memory-usage.json`, git-ignored). The threat model may cite ADR-0013 amendment 3 in the T-77 row at its next revision |
| PR64-SEC-06 (INFO) | **Closed as scoped**: listed spellings, an own `__proto__` refused and flagged, issue list capped, payload key cap. What is left is PR039-SEC-04 |
| PR64-SEC-07 (INFO), job-identity half | **Closed** (P1, 34 of 34 rows). The deadline is delivered, with PR039-SEC-01. The tenant-context half stays with TASK-047 |
| PR64-SEC-08 (INFO) | **Closed**: a duplicate record id is logged as `worker.dead_letter_duplicate`, and a stalled-out job gets a STALLED record. The listener and `isDeferredFailure` are not pinned by a test (code review R1-m5); that is a test gap, not a security gap |
| PR64-SEC-09 (LOW, CODEOWNERS) | **Open**, and the list grows: `apps/worker/src/platform/jobs/`, `apps/worker/src/platform/queues/{retention,job-handler,runtime}.ts`, `packages/shared/src/queues/{scheduled-job,payload-v2}.ts`. Owner: devops, with the PR48-SEC-02 / PR61-SEC-04 activation PR |
| PR64-SEC-11 (INFO) | **Open (positive half done).** It closes when the negative half asserts a key-level refusal. For example: a raw `SET bull:probe x` or `EVALSHA` as `api`, expecting the key-permission `NOPERM`; or a Queue with `skipVersionCheck: true`. Plus a mutation note that `~bull:*` on `api` turns the case red. This PR's fix cycle (with R1-m3) |
| PR64-SEC-12 (INFO) | **Closed** (section 5.7) |
| PR64-SEC-13 (INFO, TASK-043 condition) | Holds for this PR: the sweep and the schedulers use the runtime's `openQueue` instances and construct no `Queue`. TASK-043 is still owed its factory condition |

## 7. Code review twin

The code twin (`docs/05-quality/reviews/PR-pending-TASK-039-code-review.md`, on main `e61d3f4`; CHANGES_REQUESTED with one MAJOR) and this record agree. The US-010 delivery split it asked for (R1-m6) landed in the plan fold `77ac6d2` (D-SD-003). Rows of the same item:

| This record | Code review | Note |
|---|---|---|
| PR039-SEC-01 | R1-M1 | The same defect and the same fix. The code twin rates it MAJOR as a regression; the security rating is LOW (latent availability) |
| PR039-SEC-02 | R1-m1 | The same defect; the fixes (a) and (b) are equivalent for security |
| PR039-SEC-03 (b) | R1-n5 | The sweep's signal |
| PR039-SEC-04 | R1-m2 | It adds the compound-spelling gap |
| PR039-SEC-05 | R1-n8 | It adds the `result` column and the SELECT note; the purge is D-ARCH-171 |
| (data-model entry) | R1-m7 | Done by D-ARCH-171 (`035299d`) |
| PR64-SEC-11 | R1-m3 | Confirmed from source |
| Ruling (iii) | R1-n1 | The 47-character bound |

The code twin accepted D-TASK039-01 on code grounds and left the threat ruling to this record (section 4).

## 8. Record binding and simulation

- **The binding.** The single `Head` row names `64eefab`. The PR changes 9 owned paths.
- **When the fix cycle voids the binding.** The checker voids it when the owned set changes after `64eefab`:
  - fixes limited to `apps/worker/src/**` and `packages/shared/src/queues/**` keep it valid for the checker (S6, S7);
  - the PR039-SEC-02 or -05 fix changes the migration and voids it (S8). The checker then demands a new record, and that is the delta round of C3.

**Simulation.** Main's real `tools/ci/check-security-owned-paths.mjs` (tip `36b0b21` when the simulation ran) ran in a `--shared` sparse clone (`/.github/`, `/docs/05-quality/security/`, `/tools/ci/`). Scenario commits were built by plumbing. The record was committed on the main tip as `PR-9999-TASK-039-security-review.md` and merged with the PR head (`merge-tree`, then `commit-tree -p <record commit> -p <head>`), the merge commit checked out, and the checker run with `--pr 9999 --base 7da0e50 --head <PR head> --root <clone>`.

| Scenario | Expected | Result |
|---|---|---|
| S1 Merge ref: the record committed on the main tip, merged with the head `64eefab` | pass | pass |
| S2 Control: no record (the main tip merged with the head) | fail | fail (`missing`) |
| S3 Control: the placeholder name `PR-pending-TASK-039-…` | fail | fail (`missing`) |
| S4 Control: a later `FAIL` verdict row | fail | fail (verdict FAIL) |
| S5 Control: the `Head` row names the base `7da0e50` | fail | fail (no commit of this PR) |
| S5b Control: the `Head` row names the main tip | fail | fail (no commit of this PR) |
| S6 A fix commit after the head that changes `apps/worker/src/platform/queues/job-handler.ts` only | pass | pass (the checker keeps the binding; C3 asks for the delta round anyway) |
| S7 A fix commit after the head that changes `packages/shared/src/queues/payload-v2.ts` only | pass | pass |
| S8 Control: a fix commit after the head that changes the migration (the PR039-SEC-02 fix) | fail | fail (`migration.sql changed after it`) |
| S9 The record committed on the branch at the head | pass | pass |

10 of 10 as expected. The record has exactly one `Head` row and one `Verdict` row (the last table row of the file).

## 9. Merge conditions and routes

- **C1.** Lane B (worker, `prisma/tests/worker`, catalog) and the hosted `security-integration` job are green at the pushed head.
- **C2.** Rename the record, then confirm the merge ref contains it (the order at the top).
- **C3.** A security delta round on the fix-cycle head. The PR039-SEC-01 and -02 fixes, and code review R1-M1, sit in the reviewed controls, and the -02 fix changes the migration, which voids this binding anyway (S8). The round re-runs P2 (deadline), P4b (composite key), P1 (dequeue and signal) and the record simulation.
- **Routes:**
  - **This PR's fix cycle:** PR039-SEC-01, PR039-SEC-02 (the migration change of the D-ARCH-171 card line, with its two-queue test), PR039-SEC-03 (a), PR039-SEC-04, PR039-SEC-05 (`result`, optional), PR64-SEC-11 (negative half).
  - **principal-architect:** nothing further. D-ARCH-171 (`035299d`) already covers the ADR-0013 §4 note, the data-model §1.5 and §3.5 entries (code review R1-m7) and the purge.
  - **TASK-043:** the `job_executions` purge of D-ARCH-171, with its age predicate in its own SQL (ruling condition (ii)).
  - **TASK-047 and the saga and carrier tasks:** PR039-SEC-03 (b), the signal discipline; ruling conditions (i) and (ii) for the first schedules they add.
  - **devops:** PR64-SEC-09, with the list in section 6.
  - **threat-model revision:** T-77 mitigation cites ADR-0013 amendment 3 once this PR merges.

| Verdict | PASS_WITH_FOLLOW-UPS: nothing Critical, High or Medium is open for TASK-039 at `64eefab`. Two LOW (PR039-SEC-01, -02) are due in this PR's fix cycle, with a security delta round (C3). D-TASK039-01 is accepted with conditions (i) to (iv) |


---

# Round 2: security delta round at `766ae52` (condition C3)

| Field | Value |
|---|---|
| Delta | `64eefab..766ae52`: the merge `9af4da9` of `origin/main` at `2960391` (the round-1 record commit) into the branch, plus the fix commit `766ae52`. The merge is a clean union: its tree `573ae11` equals `git merge-tree 64eefab 2960391`, and main had moved by docs commits only. The fix commit changes 19 files |
| Head | 766ae5241fe170c0d9b8fdf83410adc951dcc338 |
| Why a new binding | The fix changes the migration, so the round-1 binding to `64eefab` is void (round-1 simulation S8, and R2-S2 below) |
| Lane A / lane B evidence | None for `766ae52`: the branch is not pushed. The coordinator reports a lane B job running in the PR worktree on the old head `64eefab`. That run is not evidence for this head |
| Owned paths changed | The same 9 as round 1 (main's checker, `--base 2960391 --head 766ae52`, the merge base after `9af4da9`). Four of them change in the fix: `migration.sql`, `platform.prisma`, `prisma/tests/worker/job-executions.int.test.ts` and `tools/db/table-classes/worker.json`. The classifier still gives `security_paths=true` (8 trigger paths) |
| Developer decisions | D-TASK039-07 to -12, as the coordinator and the code twin round 2 quote them (not in DECISIONS.md) |
| Code review twin | Round 2 on main: `6ab40f28`, APPROVED_WITH_NITS (R2-n1 to R2-n4, all NITs) |
| Reviewer / date | security-analyst, 2026-11-20, round 2. Same host rule and method as round 1: no npm, Jest, type-check, build or Docker. Probes ran on a `git archive` extract of `766ae52`, with the round-1 extract of `64eefab` run side by side as the positive control. Nothing ran in either PR worktree: the commits were read from the main checkout's object store. Line numbers come from single-file reads at `766ae52` |

## R2.1 Summary

Every round-1 finding is closed at `766ae52`, and so is the open half of PR64-SEC-11. Each closure is shown by a probe that gives the round-1 result on `64eefab` and the fixed result on `766ae52`. Nothing new is found above INFO.

## R2.2 Closure of the round-1 findings

| Finding | Fix at `766ae52` | Probe: `64eefab` (control) → `766ae52` | Status |
|---|---|---|---|
| PR039-SEC-01 (LOW) | `runWithDeadline` starts `work` as a promise job (`Promise.resolve().then(() => work(signal))`). Both `running` and `expired` carry a handler before anything can settle. The timer is created inside the `try` and cleared in `finally` (D-TASK039-07) | P2, child process, `deadlineMs: 200`. A processor that throws synchronously: exit 70 with an unhandled `JobDeadlineError` → exit 0, nothing unhandled. The async and hanging controls are unchanged on both heads. P2b, four shapes in one process (sync throw, non-promise return, resolve, late reject): 2 deadline timers left and 2 unhandled rejections → 0 and 0. The non-promise return was a second crash path in round 1 (`running.catch` on a number) | **Closed** |
| PR039-SEC-02 (LOW) | `ux_job_executions__queue_job_key ON (queue, job_key)` replaces the single-column index, plus `ix_job_executions__completed_at`. Prisma has `@@unique([queue, jobKey])` and `@@index([completedAt])`, the same names and column order as the SQL (D-ARCH-171, D-TASK039-08) | P4c on PGlite. The same `shipment.<id>` on `documents`, then on `tracking-poll`: 1 and 0 rows → 1 and 1. A repeat on `documents`: 0 rows. The new int case and a unit case pin it | **Closed** |
| PR039-SEC-03 (INFO) | `job.signal.throwIfAborted()` inside the transaction, after the effect (`idempotent-processor.ts`; D-TASK039-09) | P5b, the real handler and `idempotentProcessor` over a fake transaction whose writes count only on commit. Scenario A, a final attempt past its deadline: a dead-letter record and 1 committed effect → a record and 0 committed effects, so the record now tells the truth. Scenario B, a retry overlapping a hung attempt: 1 committed effect on both heads (`effect#1` committed late → `effect#1` rolled back, `effect#2` committed) | **Closed (a).** Residuals: (b) non-transactional work in a hung attempt (TASK-047 and the saga/carrier tasks, unchanged); a deadline that fires during COMMIT still commits, after which the retry finds the key and skips, so the effect stays at most once (code twin R2.3, accepted) |
| PR039-SEC-04 (INFO) | The walk is breadth-first. More than 32 root keys, more than 256 examined keys, or more than 4 levels counts as a signal ("unexamined"). Keys are matched exactly (`org`/`organisation`/`tenant`/`actor`/`user` + `id`/`uuid`/`type`), by suffix, and by "contains `org` and ends in `id`" (D-TASK039-10) | P1. `on_behalf_of_org_id`, `owner_org_id`, `orgUuid`, `actor_user_id`, `user_id`, depth 6, a tenant key after 300 nested keys, and 300 root keys: all not flagged → all flagged. The listed spellings stay flagged, and the valid control stays clean. P8, the false-positive differential: 15,000 valid payloads over every kind (random UUIDs, correlation ids, steps, traceparent and tracestate) give 15,000 accepted and 0 flagged on both heads, and the valid scheduled occurrence is accepted. The cost stays bounded (keys are cut at 256 characters before folding; 200 calls with 1k, 8k and 64k-character hostile keys took about 58, 198 and 174 ms). 100,000 nested objects: 8 ms, flagged | **Closed.** INFO residual, not a new ID: a plural `org_ids` and homoglyph spellings (a Cyrillic `о`) are still not flagged. The payload is refused in every case, so only the event is missing |
| PR039-SEC-05 (INFO) | `ck_job_executions__result_unset CHECK (result IS NULL)`. SELECT stays, and `worker.json` names its readers (operators, the TASK-043 purge) as data-model §4.4 and D-ARCH-171 say | P4c. A JSON value in `result` → `23514`, and so is the JSON `null` literal. Only SQL NULL passes, which is what the ledger writes. The first writer drops the CHECK in its own migration and states the column's content (the migration header says so) | **Closed** |

## R2.3 PR64-SEC-11: the negative half is now proven at the key level

The ACL case (`retention.int.test.ts`) no longer relies on a BullMQ `Queue` as `api`. It opens a raw ioredis client as `api`, with credentials generated per run, and asserts four things:
- **The control:** `SET rl:acl-probe` returns `OK` (the user authenticates, and `~rl:*` is granted).
- `SET bull:outbox-relay:acl-probe` and `HSET bull:outbox-relay:<job id>` reject with `/NOPERM.*key/i`.
- The `INFO` denial is asserted separately, as a named fact.

Valkey 8.1 source (`src/acl.c` `getAclErrorMessage`) gives the wording for each refusal:
- a key refusal is `NOPERM No permissions to access a key` (the verbose form also names the key);
- a command refusal is `User … has no permissions to run the '…' command`, which contains no "key".

So the key assertions cannot be satisfied by the `INFO` denial. `src/commands/info.json` lists `INFO` under `DANGEROUS`. ioredis 6.0.0's ready check tolerates a NOPERM on `INFO` (`built/Redis.js:790`, a `console.warn`), so the client still becomes ready. If `~bull:*` were added to `api`, the `SET bull:…` assertion would fail: the case now sees the control it is meant to prove.

The case was read, not run (lane B). **PR64-SEC-11 closes when lane B passes this case at `766ae52` or its successor.**

## R2.4 Re-checked at `766ae52`

- **Dequeue identity (P1).** 34 of 34 rows as in round 1. The aggregate check now uses `isJobIdOf`, which has the same step grammar as `jobIdFor`. `SCHEDULED_JOB_ID` admits schedule names of at most 47 characters: `<schedule>-<millis>` is then at most 64 characters and fits `CORRELATION_ID_PATTERN`. `SCHEDULE_NAME_PATTERN` and a test pin every `SCHEDULE_NAMES` entry to that bound.
- **The migration (P3, P4c).**
  - The linter gives 0 findings over both lanes, and the round-1 mutation controls give the same results.
  - The guard block is byte-identical to `renderStdColumnsGuard`.
  - `validateGrants` gives 0 problems: SELECT and INSERT only, matching the one `GRANT`.
  - C10 is clean for `job_executions` (the control fires).
  - On PGlite: the three indexes and five CHECKs exist as named; a foreign `created_by` → `P0001`; a 201-character key → `23514`; UPDATE and DELETE → `42501`; `down.sql` twice and then the migration again: OK, with 3 indexes.
- **The ruling conditions of D-SECPR039-01** are on `SCHEDULE_NAMES` (`queue-definition.ts`) and referenced from `registerSchedules`:
  - (i) to (iv) are stated as given;
  - (iii) is enforced by the 47-character grammar and its test;
  - the refusal of a registered processor on a schedule-only queue now runs before any connection is opened (`runtime.ts`), with a unit case.
- **The sweep honours the job signal** (code review R1-n5, D-TASK039-11). It stops between queues, logs `worker.queue_retention_aborted` (counts only), and rejects with the abort reason. That rejection lands on the abandoned `running` promise, which has a handler.
- **STALLED lines** (D-TASK039-12) run in a job log context only when the raw payload's `correlation_id` matches `CORRELATION_ID_PATTERN`; anything else is logged without context. The line names the class BullMQ persisted (`UnrecoverableError`), and the record keeps `NonRetryableError` (code twin R2-n3, a NIT).
- **Secrets and logs.**
  - The Gitleaks over-approximation over the 394 added lines gives 3 `generic-api-key` hits: `row.jobKey`, which the rule's `^[a-zA-Z_.-]+$` allowlist covers and whose entropy is below 3.5; a test UUID key with the stopword `000000`; `'tracking-poll'`, which the allowlist covers. The real rule suppresses all three. The runtime controls fired.
  - The only new log event is `worker.queue_retention_aborted` (counts).

## R2.5 Record binding and simulation (round 2)

- **The binding.** This round's `Head` row names `766ae52`. The round-1 row (`64eefab`) stays in the file: the checker accepts the record when a `Head` row names a commit of the PR after which no owned path changed (R2-S1), and the voided round-1 row alone fails (R2-S2).
- **Simulation.** Main's real checker ran in the same `--shared` sparse clone set-up as round 1, at main tip `4cb06f0` when the simulation ran. The record, with this round appended, was committed on the main tip as `PR-9999-TASK-039-security-review.md` and merged with the PR head (`merge-tree`, then `commit-tree`); the merge commit was checked out, and the checker ran with `--pr 9999 --head <PR head>`.

| Scenario | Expected | Result |
|---|---|---|
| R2-S1 Merge ref: the record with this round on the main tip, merged with `766ae52`; `--base` = the merge base `2960391` | pass | pass (a note says the `64eefab` row is voided by the migration change) |
| R2-S1b The same with `--base 7da0e50`, the branch's original base | pass | pass |
| R2-S2 Control: the round-1 record only (`Head` `64eefab`) | fail | fail (the migration changed after it) |
| R2-S3 Control: a later `FAIL` verdict row | fail | fail (verdict FAIL) |
| R2-S4 Control: the placeholder name `PR-pending-TASK-039-…` | fail | fail (`missing`) |
| R2-S5 A fix commit after `766ae52` in `apps/worker` only | pass | pass |
| R2-S6 Control: a fix commit after `766ae52` that changes the migration | fail | fail |
| R2-S7 Control: this round's `Head` row names the merge `9af4da9` | fail | fail (the migration changed after it) |
| R2-S8 Main renames the `PR-pending-…` file that the branch carries from `9af4da9` to `PR-9999-…` (with this round), merged with `766ae52` | pass | pass: a clean merge, and the merged tree holds only the renamed file |

10 of 10 as expected. The file has two `Head` rows (one per round) and two `Verdict` rows. This round's `Verdict` row is the last table row of the file.

## R2.6 Merge conditions and routes (replace section 9 of round 1)

- **C1.** Lane B PASS at `766ae52` (or its successor): `retention.int` (the key-level ACL case, the STALLED case, AT-US-010-05/06), `consumer.int` and `prisma/tests/worker/job-executions.int` (the migration changed). Also the hosted `security-integration` job and lane A on the pushed head. The run in the PR worktree on `64eefab` does not count.
- **C2.** Unchanged: rename the record, then confirm the merge ref contains it. The branch carries the round-1 file from the main merge `9af4da9`, unmodified, so a rename on main merges cleanly (R2-S8).
- **No further security round is needed** unless an owned path changes after `766ae52`; the checker enforces that (R2-S6).
- **Routes still open:**
  - **TASK-047 and the saga and carrier tasks:** PR039-SEC-03 (b), the signal discipline before non-transactional steps; ruling conditions (i) and (ii) for their schedules.
  - **TASK-043:** the `job_executions` purge, with its age predicate in its own SQL (D-ARCH-171).
  - **devops:** PR64-SEC-09 (CODEOWNERS for `apps/worker/src/platform/{jobs,queues}/` and `packages/shared/src/queues/`).
  - **The orchestrator (lane B):** PR64-SEC-11 closes on the lane B pass of its case.
  - **INFO residual of PR039-SEC-04** (`org_ids`, homoglyphs): optional, whoever next changes `payload-v2.ts`.

| Verdict | PASS_WITH_FOLLOW-UPS: round 2 at `766ae52`. PR039-SEC-01 to -05 are closed (SEC-03 with its residual (b) routed), and PR64-SEC-11 closes on the lane B pass of its key-level case. Nothing Critical, High or Medium is open |

---

# Round 3: security delta round at `f08948e` (the C15 pin)

| Field | Value |
|---|---|
| Delta | `766ae52..49941626`, two commits. `f08948eb` changes one file, `prisma/tests/catalog/c15-std-columns-guard.int.test.ts` (4 lines added, 2 removed). `49941626` adds lane B evidence only: 9 files under `docs/05-quality/tests/runs/20261120T0525Z_f08948e/`, an unowned path |
| Head | f08948eb8cc9f9f04ef5a01eb385856018384483 |
| Why a new binding | `/prisma/` is a CODEOWNERS path, so `f08948eb` voids the round-2 binding to `766ae52` under rule (d) of `tools/ci/check-security-owned-paths.mjs`. The later evidence commit leaves the new binding valid |
| Owned paths changed | 10, as main's checker counts them (`--base 2960391 --head 49941626`): the 9 of rounds 1 and 2 plus the C15 test |
| Lane B evidence | `20261120T0525Z_f08948e` (commit `49941626`): profile `pr`, verdict PASS, `git_sha` `f08948eb…`, `git_dirty` false. api 179, catalog C1-C14 113, integration 416, migrations 30, rls-cross-tenant 157 and unit 7557: 0 failures, 2 unit cases skipped. The C15 case `[SEC-TC-74] C15 (a) committed` is in `integration.junit.xml` and passed |
| Reviewer / date | security-analyst, 2026-11-20, round 3. A diff review only, read from the main checkout's object store (`git show`, `git diff`). Nothing ran in the PR worktree, and no npm, Jest or Docker ran. Main's checker ran in a scratch clone (R3.3) |

## R3.1 What changed

The commit changes one assertion in the committed-state test `[SEC-TC-74] C15 (a) committed` (line 213 at `f08948eb`). The literal list of tables in scope gains `job_executions`:

```diff
-      expect(scope).toEqual(['invitations', 'membership_roles', 'memberships', 'organisations', 'users']);
+      expect(scope).toEqual(['invitations', 'job_executions', 'membership_roles', 'memberships', 'organisations', 'users']);
```

The comment above it is extended to say that TASK-039 added `job_executions` (the worker manifest, the first SYSTEM table in scope). A task that adds a guarded table extends the pin beside its manifest entry.

## R3.2 No assertion is weakened

- **The pin is still an exact equality.** `toEqual` on an array is ordered and exact. The new entry is in sorted position, the order that `SCOPE_SQL` returns (`ORDER BY 1`). No entry was removed.
- **The pin is stronger, not looser.** The manifest equality above it is unchanged: the scope minus exemptions equals `stdColumnsTables(ENTRIES)`. It already required `job_executions`, through `tools/db/table-classes/worker.json` (`"stdColumns": true`, class SYSTEM). The old literal contradicted the manifest, which is why lane B's early run on `64eefab` failed on it alone. The new literal adds one protection the manifest equality lacks: it fails if `job_executions` leaves the scope and the manifest together, a matching removal on both sides.
- **The rest of the test and file is unchanged:**
  - `EXEMPTIONS` is still empty.
  - The trigger-list equality and the per-table shape check (`expectedGuard`) are unchanged.
  - The `guardShapeFindings` check (PR43-SEC-05 (b)) and the `AFTER_GUARD_SQL` check (PR43-SEC-05 (c)) are unchanged.
  - The `READ_ONLY` and `AUDIT_TABLES` floor is unchanged.
  - So are `SCOPE_SQL`, `GUARD_TRIGGERS_SQL`, `GUARD_SHAPE`, the probe tests and the timeout.
- **The commit touches nothing else.** No production code, migration, grant or manifest changed. The guard on `job_executions` is the one round 2 checked (R2.4, byte-identical to `renderStdColumnsGuard`). The lane B run at `f08948e` now proves the guard on the committed schema, through this case.
- **The evidence commit adds no secret.** I grepped the 14,881 added lines for credential shapes: connection strings with passwords, private keys, AWS and GitHub tokens, and `password=`. The only hits are synthetic values inside test-case names (for example `postgresql://app:pw@db.test/platform` in a redaction test name), the same as earlier lane B evidence. No host path or environment value is recorded (`env_overrides: []`).

## R3.3 Record binding and simulation (round 3)

- **The binding.** This round's `Head` row names `f08948eb`. Only `docs/05-quality/tests/runs/**` changed after it, and that path is not owned. The round-1 and round-2 rows stay. Both are voided: the round-1 row by the migration change, and the round-2 row by the C15 change.
- **Simulation.** Main's real checker (tip `f665429b`) ran in a `--shared` scratch clone. The record, with this round appended, was committed on the main tip as `PR-9999-TASK-039-security-review.md`, replacing the `PR-pending-…` file. That commit was merged with `49941626` (`merge-tree`, then `commit-tree`) and checked out. The checker then ran with `--pr 9999 --base 2960391 --head 49941626`.

| Scenario | Expected | Result |
|---|---|---|
| R3-S1 Merge ref: the record with this round, merged with `49941626` | pass | pass (`@ f08948e`). The merge is clean, and the merged tree holds only the `PR-9999-…` file |
| R3-S2 Control: the record as of round 2 (last `Head` row `766ae52`), merged with `49941626` | fail | fail (`names 766ae52, but prisma/tests/catalog/c15-std-columns-guard.int.test.ts changed after it`) |
| R3-S3 Control: as R3-S1, with this round's `Head` row naming `766ae52` | fail | fail (the same note) |

All 3 scenarios gave the expected result. The file has three `Head` rows and three `Verdict` rows, one of each per round. This round's `Verdict` row is the last table row of the file.

## R3.4 Merge conditions and routes (replace R2.6 C1)

- **C1, lane B part: met** at `f08948e` (`20261120T0525Z_f08948e`, PASS). `integration.junit.xml` lists the cases R2.6 C1 named, and all of them passed (the file has no `<failure>`, `<error>` or `<skipped>` element):
  - `retention.int`, 8 cases. These include `[PR64-SEC-11] … the api user is refused every bull:* key (key-level NOPERM)`, the STALLED case, and AT-US-010-05 and -06.
  - `consumer.int`, 14 cases.
  - `prisma/tests/worker/job-executions.int`, 5 cases.

  These files are unchanged since `766ae52`, so they are the versions round 2 read. **PR64-SEC-11 is closed.** Still owed on the pushed head: lane A and the hosted `security-integration` job.
- **C2.** Unchanged: rename the record on main, then confirm that the merge ref contains it (D-ORCH-136, D-ORCH-138).
- **No further security round is needed** unless an owned path changes after `f08948eb`. Evidence-only and record commits do not void the binding.
- **Routes:** unchanged from R2.6 (TASK-047 and the saga and carrier tasks, TASK-043, devops PR64-SEC-09, the INFO residual of PR039-SEC-04).

| Verdict | PASS_WITH_FOLLOW-UPS: round 3 at `f08948e`. The only owned change adds `job_executions` to the exact committed-scope pin of C15 and weakens no assertion. No new finding. PR64-SEC-11 is closed on the lane B pass at `f08948e`. Nothing Critical, High or Medium is open for TASK-039 |
