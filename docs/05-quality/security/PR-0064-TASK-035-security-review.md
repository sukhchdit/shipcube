# PR-0064: TASK-035 named BullMQ queues, retries, dead-letter queues and payload v2, security review

| Field | Value |
|---|---|
| PR | #64, https://github.com/sukhchdit/shipcube/pull/64, branch `feat/TASK-035-named-bullmq-queues-retries-dead`. One commit, `90ef83f` (code). Merge base with `main` `80dce9e`; `main` was `099b78b` when this round was written (docs and agent-note commits only since the merge base on the paths this PR changes) |
| Head | 90ef83fd8e283c7c6e3ef2c18a7dd880f3141c3e |
| Lane A evidence | Run 44105548507 on `90ef83f` (`pull_request`). fast-lane: install, licences, registry signatures and provenance, vulnerability audit (npm audit + osv-scanner) `success`; "Lane B evidence" `failure` (no lane B run yet), so lint, type-check, unit and build were skipped. ci-gate: Gitleaks `success`, Semgrep `success`, oasdiff `success`; the only red step is "Security-owned paths need a review record" (6 owned paths, no record). `security_paths=true`, `record_ok=false`, so `security_integration_due=false` and security-integration was skipped |
| Lane B evidence | None yet. The PR is fifth in the lane-B queue (D-ORCH-131); `consumer.int.test.ts` has never run (D-ORCH-COORD-03). This round is static plus light Node probes; nothing here substitutes for that run |
| Owned paths changed | 6 (checker `owned[]` in run 44105548507): `apps/api/src/platform/queues/producer.ts`, `apps/api/src/platform/queues/producer.test.ts`, `apps/api/src/platform/runtime/index.ts`, `apps/api/src/platform/runtime/entry-points.test.ts`, `package-lock.json`, `packages/shared/package.json` |
| Unowned paths changed | 28: `apps/worker/src/platform/queues/**` (10 files), `apps/worker/src/{main,start-worker,processors}.ts` and their tests, `apps/worker/src/platform/health/server{,.test}.ts`, `packages/shared/src/queues/**` (13 files). All of them were reviewed here; see PR64-SEC-09 for their CODEOWNERS status |
| Binding items checked | ADR-0013 and its amendments 1-6 (SEC-P3-12 payload v2, Valkey ACL users); threat-model T-73, T-74, T-77, R-18, SEC-TC-20, SEC-TC-50; data-model §4.5 `job_context`; US-009 AT-US-009-01..05; REQ-PLAT-013, DR-A25, EC-A38, NFR-RES-004, NFR-OBS-002; the TASK-035 sheet (WAVE-01) incl. the D-ORCH-073 / D-ARCH-136 worker entry-point line and D-062; TASK-039/043/047 sheets; D-TASK035-01..06 (D-ORCH-COORD-03, accepted subject to review by D-ORCH-131); `infra/local/valkey/users.acl`, `compose.yaml` (worker, redis), platform.md §2/§8 |
| Reviewer / date | security-analyst, 2026-11-18, round 1. Static review under the D-ORCH-130/131 host rule: no install, Jest, type-check, build, audit or Docker run. Nothing was run in the PR worktree `Shipqube-TASK-035` (not even read-only git); all git reads ran in the main checkout. Probes ran in the session scratchpad on `git archive` copies of `90ef83f`, with `bullmq` 6.7.0, `ioredis` 6.0.0 and `joi` 18.3.2 from the main checkout's `node_modules` (the head lockfile pins the same versions), types stripped in transform mode, and a fake RESP server on 127.0.0.1 (no Valkey, no container) |

## 1. Summary

The PR delivers the nine ADR-0013 queues with `-dead` dead-letter queues, the payload v2 contract (`{ v, kind, id, correlation_id, trace_context }`, closed Joi schema, no conversion), jittered exponential retries, the redacted dead-letter record, per-queue gauges on the worker's `/metrics`, the injectable `startWorker` composition, and a producer that copies the correlation ID from the originating context.

What holds:
- **Tenant context is never taken from Redis.** The schema refuses `org_id`, `actor_id` and every other unknown top-level or nested key (`unknown(false)`, `convert: false`), and a carried `org_id`/`actor_id`/`orgId`/`actorId` also raises `job_context_mismatch` with the catalogue's allow-listed attributes. Processors get the validated clone, not `job.data`, and the job name selects nothing (one processor per queue). Queues without kinds (`audit-maintenance`, `housekeeping`) refuse every payload (fail closed, D-TASK035-05).
- **The producer writes identifiers only.** It validates before `add`, refuses a missing correlation ID, never generates one, and the api ACL user has no `~bull:*` (users.acl), so the api process cannot write queues even though the producer is on its runtime door.
- **The dead-letter record is redacted and bounded** (`redactValue` with the logger's depth, node and string limits; message through `redactString`, 500 chars), and the consumer logs only error classes.
- **Valkey connection options** come from `buildValkeyOptions` (explicit host, port, db, ACL user, pinned TLS), never the raw URL; no secret in code; the worker uses the `worker` ACL user.
- **Retries are bounded**: 5 attempts, delay clamped (retry index capped at 30), jitter draw clamped, non-retryable errors final on the first attempt. Concurrency is a fixed per-queue constant.
- **joi** (the one new declared dependency of `@platform/shared`) is already in the lockfile at 18.3.2 for `apps/api` and `packages/config`: no new package enters the closure. BSD-3-Clause; 18.3.2 is past every published joi and @hapi/hoek advisory range; published 2026-11-04 (maintained). It stays off the browser-safe root barrel (subpath `./queues` only).

What does not:
- **PR64-SEC-01 (MEDIUM): the worker ACL password is printed in clear to stderr whenever Valkey refuses AUTH.** The 18 BullMQ `Queue` instances the runtime builds have no `error` listener; BullMQ's `QueueBase.emit` then falls back to `console.error(err)`, and ioredis attaches the failing command with its arguments (`HELLO 3 AUTH worker <password>`) to the error. Probe P2: 97 password copies on stderr in 3 s, 0 structured log lines; with a listener attached, 0. **Merge condition C1.**
- **PR64-SEC-02 (MEDIUM, T-74): BullMQ keeps the raw error text, the stack and the raw job data of every failed job in Valkey, forever.** The dead-letter copy is redacted; the failed-set original beside it (`failedReason`, `stacktrace`, `data`, `removeOnFail: false`) is not. AT-US-009-04's secret sits unredacted in the failed set while the test asserts only the record.
- LOW: no timeout on the non-blocking queue connections, so `/metrics` and the dead-letter write hang during an outage (03); unbounded failed-set and DLQ retention under `noeviction` (04); free-text `tracestate` in an identifiers-only payload (05); the worker queue platform and the payload schema are not security-owned (09).
- INFO: forgery-signal gaps incl. a silently stripped `__proto__` key (06); the tenant-context and job-identity hooks TASK-039/047 must add (07); dead-letter id reuse and stalled jobs (08); requirements text still describes payload v1 (10); the ACL users are not exercised by the integration suite (11).

Findings: 0 Critical, 0 High, 2 MEDIUM, 4 LOW, 5 INFO.

**Verdict: PASS_WITH_CONDITIONS.** C1: PR64-SEC-01 fixed in this PR, with the test of §4, verified by a security delta round before merge. PR64-SEC-02 is due in the same fix cycle (it runs anyway for C1), at the latest before TASK-039 registers the first processor.

## 2. Method

1. Read the full diff `80dce9e...90ef83f` (34 paths) and the head files: every file under `packages/shared/src/queues/` and `apps/worker/src/platform/queues/`, `start-worker.ts`, `main.ts`, `processors.ts`, `health/server.ts`, `producer.ts`, `apps/api/src/platform/runtime/index.ts`, `apps/api/src/platform/valkey/{options,client}.ts`, `apps/worker/src/platform/logging/job-context.ts`, `packages/shared/src/logging/{index,security-event}.ts`, `packages/shared/src/correlation/correlation-id.ts`, the tests, `infra/local/valkey/users.acl`, `infra/local/env/worker.env` (user name only), `compose.yaml`.
2. Read the BullMQ 6.7.0 and ioredis 6.0.0 code paths the PR relies on: `RedisConnection` (blocking connections force `maxRetriesPerRequest: null` themselves, `redis-connection.js:116-117`), `QueueBase.emit` (the `console.error` fallback, `queue-base.js:76-89`), `Job.moveToFailed` / `updateStacktrace` (`job.js:470-486, 945-953`), ioredis `DataHandler.returnError` (`err.command = { name, args }`, `DataHandler.js:57-64`) and the handshake error path (`event_handler.js`, `recoverFromFatalError`).
3. Probes (§7): P1 payload validation edge cases against the head's real `validateJobPayload`; P2 the head's real `createWorkerQueues` + `queueConnectionOptions` against a fake RESP server that refuses AUTH (modes: runtime, control with an `error` listener, call-site trace); P3 the `tracestate` check proposed in §4, cases and scaling.
4. Dependency: the lockfile delta (one added `dependencies` line in the `packages/shared` entry; no package entry changes), `npm view joi@18.3.2`, GitHub advisories for `joi` and its seven dependencies.
5. Lane A evidence (`gh run view 44105548507`), record simulation (§9).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR64-SEC-01 | The worker's BullMQ `Queue` instances have no `error` listener. On an AUTH refusal BullMQ prints the ioredis error with `console.error`, and the error carries the handshake command's arguments: the `worker` ACL password reaches stderr in clear on every reconnect, bypassing the redacted logger | MEDIUM | CWE-532 | A09 | `apps/worker/src/platform/queues/runtime.ts:43-44`; `consumer.ts:84` (consumer-owned DLQ); BullMQ `queue-base.js:76-89` | **This PR (merge condition C1)** |
| PR64-SEC-02 | BullMQ persists the raw `error.message` (`failedReason`) and `error.stack` (`stacktrace`) of every failed attempt, and the raw job data, in the job hash; `removeOnFail: false` keeps them forever. The redaction of the dead-letter record is bypassed by the failed-set original next to it | MEDIUM | CWE-359 | A04 | `consumer.ts:120-122, 127-130` (the processor's error is rethrown unchanged); `packages/shared/src/queues/job-options.ts:32, 42`; `consumer.int.test.ts:213-227` | This PR's fix cycle, at the latest before TASK-039 registers a processor |
| PR64-SEC-03 | `queueConnectionOptions` drops the command timeout and sets `maxRetriesPerRequest: null` for every queue connection, not only the worker's blocking one; `/metrics` (18 `getJobCounts` per request, no deadline, no cache) and the dead-letter write wait without bound while Valkey is down or refuses AUTH | LOW | CWE-400 | A04 | `apps/worker/src/platform/queues/connection.ts:12-13`; `runtime.ts:43-44, 70-71`; `health/server.ts:68` | This PR's fix cycle |
| PR64-SEC-04 | No retention for the failed set (`removeOnFail: false`) or the dead-letter queues (never consumed, `removeOnComplete/removeOnFail: false`). Under `maxmemory-policy noeviction` sustained failures grow Valkey until it refuses writes, which also stops the api's sessions and rate limits on the same instance (T-77) | LOW | CWE-770 | A04 | `job-options.ts:32, 42`; `consumer.ts:103-107`; ADR-0013 §1, §2 | principal-architect (ADR-0013 retention amendment); TASK-039 (housekeeping trims the DLQs) |
| PR64-SEC-05 | `trace_context.tracestate` is any 1-512 characters: CR/LF, NUL, U+2028 and free text are accepted (P1 T1-T5). It is the one free-text field of an identifiers-only payload (R-18, SEC-TC-50) and is handed unvalidated to whoever propagates it later | LOW | CWE-20 | A04 | `packages/shared/src/queues/payload-v2.ts:56` | This PR's fix cycle, else before the first producer passes a trace context (TASK-043) |
| PR64-SEC-06 | Forgery signal gaps: `carriesTenantContext` checks four exact top-level spellings (`ORG_ID`, `orgID`, `tenant_id`, `organisation_id`, nested `trace_context.org_id` are refused but not flagged), and an own `__proto__` key, as `JSON.parse` of job data produces, passes validation silently (Joi's clone drops it). The issue list is uncapped (100k unknown keys: a 2.4 MB message, 489 ms validation) | INFO | CWE-20 | A04 | `payload-v2.ts:88-96`; `consumer.ts:120` | TASK-047 (SEC-TC-20/50 owner), or this fix cycle |
| PR64-SEC-07 | The consumer has no structural tenant-context step: processors receive `(payload, job)` and must resolve `platform.job_context` themselves; TASK-039 and TASK-043 register processors before TASK-047 exists. The consumer does not check that `job.id` and `job.name` match the payload, which matters once TASK-039 keys `job_executions` on the job id. No per-job deadline | INFO | CWE-639 | A01 | `consumer.ts:43, 124-132` | TASK-047 (context in the consumer), TASK-039 (identity check, deadline) |
| PR64-SEC-08 | The dead-letter record reuses the job id, so a second final failure of the same job (after an operator retry) is silently not recorded while `worker.job_dead_lettered` is still logged; a stalled-out job (D-TASK035-06) leaves no record and no `worker.job_failed` line | INFO | CWE-778 | A09 | `consumer.ts:103-108` | TASK-039 |
| PR64-SEC-09 | Only 6 of 34 changed paths are security-owned. The payload v2 schema (the SEC-P3-12 control), the consumer that enforces it, the dead-letter redaction and the worker composition can be changed by a later PR without a security record | LOW | CWE-693 | A08 | `.github/CODEOWNERS` (no line for `apps/worker/src/platform/` beyond `db/`, `apps/worker/src/{main,start-worker,processors}.ts`, `packages/shared/src/queues/`, `packages/shared/src/logging/`) | devops-engineer with the PR48-SEC-02 / PR61-SEC-04 activation PR |
| PR64-SEC-10 | DR-A25 ("every payload has `org_id`, `actor_id`, `correlation_id` and an idempotency key"), the US-010 Notes and EC-A38 still describe payload v1, which ADR-0013 am. 1 superseded. Fail-safe today (a v1 payload is refused and flagged), but TASK-039 starts from US-010 | INFO | CWE-1059 | A04 | `docs/01-requirements/REQUIREMENTS.md:703, 749`; `docs/01-requirements/stories/EPIC-01-platform-foundation.md` (US-010 Notes) | product-manager |
| PR64-SEC-11 | The integration suite runs Valkey without the ACL file, so no test shows that the `worker` user (`~bull:* +@all -@dangerous +info`) can run BullMQ, or pins the producer's claim that the `api` user cannot write `bull:*` | INFO | CWE-1068 | A05 | `consumer.int.test.ts:33-40` | This fix cycle or TASK-039 |

## 4. Finding details

### PR64-SEC-01 (MEDIUM): the Valkey ACL password reaches stderr on an AUTH refusal

**Description.** `createWorkerQueues` builds one `Queue` per named queue and one per dead-letter queue (`runtime.ts:43-44`, 18 instances), and `createQueueConsumer` builds its own DLQ `Queue` when none is passed (`consumer.ts:84`). Only the BullMQ `Worker` gets an `error` listener (`consumer.ts:144`). When a connection error reaches a `Queue` without a listener, BullMQ 6.7.0 `QueueBase.emit` catches the `ERR_UNHANDLED_ERROR`, retries the emit, and finally runs `console.error(err)` (`queue-base.js:76-89`). For a refused handshake, ioredis 6.0.0 has already attached the command to the error (`DataHandler.returnError`: `err.command = { name, args }`), and with RESP3 that command is `HELLO 3 AUTH <user> <password>`. `console.error` uses `util.inspect`, which prints own properties, so the password is written to stderr in clear. It repeats on every reconnect of every instance (the runtime's retry strategy never gives up), and nothing reaches the structured log.

**Probe P2** (head `createWorkerQueues` + `queueConnectionOptions`, fake RESP server answering `HELLO`/`AUTH` with `-WRONGPASS`, sentinel password): 97 stderr copies of the sentinel in 3 s, all `name: 'hello'`, 0 RuntimeLog lines; call-site trace: 99 of 99 `console.error` calls from `bullmq/dist/cjs/classes/queue-base.js:89`. Control (same run with a no-op `error` listener on every `Queue`): 0 stderr lines.

**Exploitability and impact.** Any AUTH refusal triggers it: a rotated or wrong password, the user switched off (`user worker off`, the message says "or user is disabled", and the password is then still valid), a REDIS_URL pointing at another environment's Valkey, or the wrong user name with a valid password. stderr goes to the same CloudWatch log group as stdout in ECS and to `docker logs` locally, which have a wider audience than the secret store. The `worker` user reads and writes `bull:*`, `carrier:*`, `audit:*` and `cache:*`; with network access to Valkey that is enough to forge jobs (contained by `job_context`, TASK-047) and to read the carrier token cache. Impact High (a credential), likelihood Low (needs an AUTH refusal while the password still has value, plus in-VPC access to use it): MEDIUM. It breaks the run guardrail "secrets in logs = 0" and the PR20-SEC-06 rule that process-level error output never bypasses the redactor, which is why it is a merge condition despite the MEDIUM.

**Remediation (code).** One factory that every worker `Queue` goes through, which always attaches a class-only listener; use it in `runtime.ts` and `consumer.ts`, and later for the TASK-043 relay's producer queues (`queueFor`):

```ts
// apps/worker/src/platform/queues/open-queue.ts
export function openQueue(name: string, options: QueueOptions, log: RuntimeLog): Queue {
  const queue = new Queue(name, options);
  // Without a listener BullMQ console.error()s the ioredis error, whose `command.args` carry the AUTH password.
  queue.on('error', (error: unknown) => log.warn('worker.queue_error', { queue: name, error: error instanceof Error ? error.name : typeof error }));
  return queue;
}
```

**Verification test.** (a) A unit test with a fake RESP server (as P2: `net.createServer`, `-WRONGPASS` for `HELLO`/`AUTH`, `+OK` otherwise) and a sentinel password: run `createWorkerQueues` for about one reconnect cycle, spy on `console.error` and `process.stderr.write`, and assert that neither receives the sentinel and that at least one `worker.queue_error` line with only the class was logged. (b) A source-scan test: `new Queue(` appears in `apps/worker/src/**` (non-test) only inside the factory. Mutation check: remove the listener and (a) must fail.

### PR64-SEC-02 (MEDIUM): raw error text, stacks and job data persist in the failed set

**Description.** On every failed attempt BullMQ `Job.moveToFailed` sets `failedReason = err.message` and pushes `err.stack` (which starts with the message) to `stacktrace`, and writes both into the job hash (`job.js:471, 483-486, 945-953`; no `stackTraceLimit` is set). On the final failure `removeOnFail: false` (`job-options.ts:32, 42`) keeps the hash, with its original `data`, without limit. The consumer rethrows the processor's own error unchanged (`consumer.ts:127-130`) and the PAYLOAD_INVALID error with the issue list (`:120-122`). The PR's own design treats that text as sensitive: the consumer logs "error class only: a message may carry data" (`consumer.ts:76`) and the dead-letter record keeps only a redacted, truncated message and redacted data. The failed-set original, which ADR-0013 and `dead-letter.ts:6` call the operator backstop and which the M4 System health screen will show, keeps the unredacted versions. AT-US-009-04 (`consumer.int.test.ts:213-227`) asserts `[REDACTED]` in the record only; the same job's hash in the failed set still holds the token sentinel.

**Exploitability and impact.** Today no processor is registered, the producer only writes validated identifiers, and the PAYLOAD_INVALID message names key paths only, so nothing sensitive is stored yet. The first processors (TASK-039 onwards) will throw database and carrier errors: Prisma validation errors print call arguments, pg `detail` echoes key values, carrier HTTP errors can carry response bodies with addresses. That text then lives in Valkey and its AOF file indefinitely, outside erasure (REQ-PRIV) and outside the log redaction guarantees, readable by every holder of the `worker` credential and by operators through the failed-job view. This is threat T-74 ("PII in job payloads, the DLQ and Redis", MEDIUM, CWE-359), whose mitigation R-18 covers payloads but not error text. Impact Medium, likelihood Medium once processors exist: MEDIUM.

**Remediation (code).** BullMQ must only ever see a sanitised failure; the original stays in the redacted log and the redacted record:

```ts
// consumer.ts
/** What BullMQ persists (failedReason, stacktrace): the reason code only, no message text, no frames. */
function persistedFailure(error: unknown): Error {
  const failure = isNonRetryable(error) ? new NonRetryableError(error.reason, error.reason) : new Error('TRANSIENT');
  failure.stack = `${failure.name}: ${failure.message}`;
  return failure;
}
...
const error = new NonRetryableError('PAYLOAD_INVALID', `payload v2 refused: ${checked.issues.join(', ')}`);
await recordFailure(job, error);
await job.updateData(redactValue(job.data)); // the failed-set copy is the redacted one
throw persistedFailure(error);
...
} catch (error) {
  await recordFailure(job, error);
  throw persistedFailure(error);
}
```

Also set `stackTraceLimit: 0` in `jobOptions` (defence in depth for errors thrown outside the wrapper, e.g. by BullMQ itself). Keep `NonRetryableError`'s `name = 'UnrecoverableError'` so BullMQ's retry decision is unchanged. Retention of the failed set is PR64-SEC-04.

**Verification test.** Integration (lane B): (a) a processor throwing `new Error(<sentinel>)` until attempts are exhausted; then `JSON.stringify` of `queue.getJob(id)` (`failedReason`, `stacktrace`, `data`) contains no sentinel, and the record's `message` is redacted; (b) extend AT-US-009-04 to assert the failed-set job hash, not only the record; (c) a non-retryable case still fails after one attempt (the retry decision survives the wrapper). Unit: `persistedFailure` keeps the class name BullMQ checks and drops message and frames.

### PR64-SEC-03 (LOW): the non-blocking queue connections have no timeout

**Description.** `queueConnectionOptions` deletes `commandTimeout` and sets `maxRetriesPerRequest: null` (`connection.ts:12-13`). The comment's reason, the blocking `BZPOPMIN`, applies only to the worker's blocking connection, and BullMQ already forces `maxRetriesPerRequest: null` on blocking connections itself (`redis-connection.js:116-117`). The same options go to the 18 `Queue` instances used for the gauges and the dead-letter writes, so ioredis keeps their commands in the offline queue until Valkey answers. `GET /metrics` (`health/server.ts:68`) awaits 18 `getJobCounts` calls per request without a deadline or cache; P2 shows `metrics()` still pending after 3 s against an AUTH-refusing server. A dead-letter write during an outage likewise holds the job's slot until Valkey returns.

**Exploitability and impact.** The worker's port 9464 is internal (not published in Compose; `/metrics` returns 404 at the edge and the ALB), so only in-network callers and the scraper reach it. Each request during an outage adds a pending response and 18 queued commands that never time out, against CLAUDE.md §9 ("every external call has timeouts"). Availability only, internal: LOW.

**Remediation (code).** Two profiles: `queueConnectionOptions(url, name, 'worker')` as today for `Worker`, and a `'queue'` profile that keeps `buildValkeyOptions`' `commandTimeout` (2 s) and `maxRetriesPerRequest` (1) for every `Queue`. Bound the gauge collection: `metrics: () => withDeadline(collectQueueMetrics(queues), 2_000)` (the health server already turns a rejection into 503), and optionally single-flight it so concurrent scrapes share one collection.

**Verification test.** With the P2 fake server (or an unused port), `queues.metrics()` rejects within 2.5 s, and `GET /metrics` answers 503 within the budget; a `Worker` built from the `'worker'` profile still has `maxRetriesPerRequest: null` (pin).

### PR64-SEC-04 (LOW): unbounded failed-set and dead-letter retention under `noeviction`

**Description.** Every job keeps its hash in the failed set forever (`removeOnFail: false`), and every dead-letter record is added with `removeOnComplete: false, removeOnFail: false` to a queue nobody consumes (`consumer.ts:103-107`), so both only grow. Compose runs Valkey with `--maxmemory-policy noeviction` (BullMQ's requirement, ADR-0013 §9), and the api's `auth:*`, `rl:*` and `sse:*` keys live on the same instance.

**Exploitability and impact.** A long carrier or database outage makes every affected job exhaust its retries: two retained copies per job (hash with up to five stacks, plus the record). At `maxmemory` Valkey refuses writes: queues stop, and so do refresh-token rotation and rate limiting. T-77 rates the flood LOW; the retention gap is what turns a bounded flood into permanent growth. LOW.

**Remediation.** An ADR-0013 amendment by principal-architect: failed jobs `removeOnFail: { age: <N days> }` once the dead-letter record exists (the record is the operator view), dead-letter records trimmed by the TASK-039 housekeeping to an age and count bound, and alarms on DLQ depth (the gauge exists) and Valkey `used_memory` (platform.md §8.5).

**Verification test.** A `jobOptions` pin for the bounded `removeOnFail`; a TASK-039 integration case where housekeeping trims records older than the bound and keeps newer ones.

### PR64-SEC-05 (LOW): free-text `tracestate`

**Description.** `TRACE_CONTEXT` validates `traceparent` strictly but `tracestate` only as `Joi.string().max(512)` (`payload-v2.ts:56`). P1 accepted CR LF plus a header line, NUL, U+2028, and an e-mail address with a phone number and a street (T1-T5).

**Exploitability and impact.** Writing it needs a producer that passes the value (the producer takes `traceContext` from its caller) or Redis write access. Today nothing reads it. A later telemetry task that extracts it into an OTel context or forwards it as an outbound `tracestate` header receives unvalidated text from Redis, and SEC-TC-50's "identifiers only" assertion passes payloads that carry free text. LOW.

**Remediation (code).** Preferred: drop `tracestate` from payload v2 (a `traceparent` is enough to continue the trace). The W3C grammar removes control characters and enforces structure, but its value alphabet still admits text such as an e-mail address (probe P3), so only dropping the field restores "identifiers only". If a vendor needs it, validate the grammar in linear time, for example (probe P3: 15/15 cases, scaling ratio 0.9-1.3 from 1k to 8k):

```ts
const TS_KEY = /^(?:[a-z][a-z0-9_*\/-]{0,255}|[a-z0-9][a-z0-9_*\/-]{0,240}@[a-z][a-z0-9_*\/-]{0,13})$/;
const TS_VALUE = /^[\x20-\x2b\x2d-\x3c\x3e-\x7e]{0,255}[\x21-\x2b\x2d-\x3c\x3e-\x7e]$/;
function isTracestate(text: string): boolean {
  const members = text.split(',');
  if (members.length > 32) return false;
  return members.every((raw) => {
    // Linear OWS trim. Not `raw.replace(/^[ \t]+|[ \t]+$/g, '')`: P3 measured that form quadratic (ratio 58-139 from
    // 1k to 8k on a blank run followed by another character); not String#trim, which also strips U+2028 and NBSP.
    let start = 0;
    let end = raw.length;
    while (start < end && (raw[start] === ' ' || raw[start] === '\t')) start += 1;
    while (end > start && (raw[end - 1] === ' ' || raw[end - 1] === '\t')) end -= 1;
    const member = raw.slice(start, end);
    const eq = member.indexOf('=');
    return eq > 0 && TS_KEY.test(member.slice(0, eq)) && TS_VALUE.test(member.slice(eq + 1));
  });
}
// tracestate: Joi.string().max(512).custom((v, h) => (isTracestate(v) ? v : h.error('string.pattern.base')))
```

**Verification test.** Refused: CR/LF, NUL, U+2028, a member without `=`, 33 members, a 257-char value, an upper-case key, a `,` inside a value; accepted: `vendor1=abc123,tenant@vendor2=x-y_z`, 32 members, a 256-char value. A scaling test (child process, 1k and 8k blank-run and key-run near misses, ratio below 16) on the final code.

### PR64-SEC-06 (INFO): forgery-signal gaps

`carriesTenantContext` (`payload-v2.ts:88-92`) checks `org_id`, `actor_id`, `orgId`, `actorId` at the top level only. P1: `ORG_ID`, `OrgId`, `orgID`, `org-id`, `tenant_id`, `tenantId`, `organisation_id`, `organization_id`, `actorID`, and `trace_context.org_id` are all refused (`object.unknown`) but not flagged. An own `__proto__` key, which `JSON.parse` of job data creates, is not refused at all: Joi's shallow clone assigns it, which sets and then restores the prototype, so the key disappears and the payload validates (P1 P1: `ok: true`). The processor gets the clean clone, so no processor reaches the smuggled data; what is lost is the refusal and the security event, and any SEC-TC-50 check built on `validateJobPayload` passes a Redis job that carries arbitrary data under `__proto__`. The issue list is uncapped: 100k unknown keys give a 2.4 MB message (stored by BullMQ until PR64-SEC-02 is fixed) and 489 ms of event-loop time per job. Fix: before Joi, compare `Object.keys(value)` (which includes an own `__proto__`) with the five allowed keys; flag with the logger's `normaliseKey` against `org|organisation|organization|tenant|actor` (+`id`/`type`) at any depth (bounded walk); cap `issues` at 20 plus a count.

### PR64-SEC-07 (INFO): tenant-context and job-identity hooks for TASK-039 and TASK-047

The processor signature (`consumer.ts:43`) lets each processor resolve its own context. TASK-039 (`job_executions`, schedulers) and TASK-043 (outbox relay) register processors before TASK-047 provides `platform.job_context`. Recommendations for the owners: TASK-047 resolves `platform.job_context(kind, id)` in the consumer, before the processor, and hands the processor the resolved `{ orgId, actorType, actorId }` and the tenant-transaction factory, so no processor can open a tenant transaction with an org of its own choosing; TASK-039/043 processors stay SYSTEM-scope until then. TASK-039 should refuse PAYLOAD_INVALID when `job.id` does not start with `${payload.kind}.${payload.id}` or `job.name !== payload.kind`, because `job_executions.job_key` will be the job id while the action follows the payload id. A per-job deadline (an `AbortSignal` in `ProcessorJob`) keeps a hung processor from holding its slot forever.

### PR64-SEC-08 (INFO): dead-letter id reuse and stalled jobs

`deadLetter.add(..., { jobId: job.id })` (`consumer.ts:103-104`): BullMQ ignores an `add` whose id exists, and records are never removed, so after an operator retries a dead-lettered job, its second final failure writes nothing while `worker.job_dead_lettered` is still logged with the new reason. Use a unique record id (`${job.id}.${attempts}.${Date.now()}`) or log when `add` returns an existing job. D-TASK035-06 (a stalled-out job stays in the failed set without a record) is accepted: the failed gauge still counts it; note that no `worker.job_failed` line exists for it either. Non-security, for the code review: a deterministic job id stays blocked for re-enqueue while its job is retained (failed: forever; completed: 24 h), which matters for recurring business keys such as tracking polls.

### PR64-SEC-09 (LOW): CODEOWNERS does not cover the worker queue platform or the payload schema

The record check fires on this PR only because of the producer, the runtime door, the lockfile and `packages/shared/package.json`. The SEC-P3-12 control itself (`packages/shared/src/queues/payload-v2.ts`), the consumer that enforces it and raises `job_context_mismatch`, the dead-letter redaction, the connection options of PR64-SEC-01/03 and the worker composition (`start-worker.ts`, `main.ts`, `processors.ts`) are unowned, as is `packages/shared/src/logging/` (the redactor). A later PR could set `unknown(true)` or drop the redaction without a security record. Fix: add `/apps/worker/src/platform/`, `/apps/worker/src/start-worker.ts`, `/apps/worker/src/main.ts`, `/apps/worker/src/processors.ts`, `/packages/shared/src/queues/` and `/packages/shared/src/logging/` to CODEOWNERS with the activation PR that carries PR48-SEC-02 and PR61-SEC-04. Verification: `check-security-owned-paths` reports these paths as owned for a scratch change.

### PR64-SEC-10 (INFO): requirements still describe payload v1

`REQUIREMENTS.md:703` (DR-A25), `:749` (EC-A38, "arrives without `org_id`") and the US-010 Notes ("Payload always carries `org_id`, `actor_id`, `correlation_id`, idempotency key") predate ADR-0013 am. 1. A v1 payload is refused at dequeue and flagged, so the code fails safe, but TASK-039 is specified from US-010. Product-manager: amend the three texts to payload v2 (`org_id` from `platform.job_context`; idempotency by the deterministic job id and `job_executions`).

### PR64-SEC-11 (INFO): the ACL users are not exercised

`consumer.int.test.ts:33-40` starts Valkey without `--aclfile`. Add one case with `infra/local/valkey/users.acl` (credentials from the test's own generated values, never the repo's): the `worker` user processes a job end to end (BullMQ needs `INFO`, `EVALSHA`, `BZPOPMIN`, `CLIENT SETNAME` under `-@dangerous`), and a `Queue.add` as the `api` user fails with `NOPERM`.

## 5. Focus areas: verified sound

| Area | Result |
|---|---|
| Payload validation | Closed object at both levels, `convert: false`, kinds per queue, UUID and correlation patterns anchored; null, arrays, strings, `v: '2'`, missing `trace_context`, upper-case ids, a zero trace id and a non-`00` version refused (P1 and the PR's unit tests). Exceptions: PR64-SEC-05, -06 |
| Deserialization trust | BullMQ `JSON.parse`s `data` and `opts`; no reviver, no class revival. The processor gets Joi's clone; the job name selects nothing. `job.opts.attempts`/`backoff` come from Redis, which is the accepted Redis-write threat (T-73), and the delay is clamped either way |
| Tenant context | Never read from the payload; `runWithJobContext` binds only the validated correlation ID; `org_id`/`actor_id` forgeries refused and flagged with allow-listed attributes (`security-event.ts:119`). Structural follow-up: PR64-SEC-07 |
| PII/secrets in job data, logs, DLQ | Producer writes identifiers only; logs carry `queue`, `jobId`, attempt, reason code and error class; the record is deep-redacted and bounded. Exceptions: PR64-SEC-01 (stderr), PR64-SEC-02 (failed set) |
| Valkey configuration | No secret in code or tests (test URLs are local placeholders); `buildValkeyOptions` (pinned TLS, explicit options, no URL in errors); the worker uses the `worker` ACL user (`worker.env`); the api user has no `~bull:*` |
| Dependency | joi 18.3.2: BSD-3-Clause, already locked for two workspaces, no new package, past all advisories (GHSA-4528-x5fx-h6hg, -6h2x-m376-mqjq, -wr44-6hxh-3jwq, -6w3j-5fw6-r9vr, -gg4h-3hg2-grpc, -q7cg-457f-vx79), @hapi/hoek 11.0.7 past both of its advisories; lane A licences, signatures and audit green |
| Resource exhaustion | Attempts 5, retry index clamped at 30, jitter clamped, non-retryable final at once, constant concurrency, stalled jobs capped by BullMQ's `maxStalledCount` (1). Exceptions: PR64-SEC-03 (timeouts), PR64-SEC-04 (retention) |
| `/metrics` | GET/HEAD only, fixed label values (queue names match the kebab pattern), `no-store`, `nosniff`, internal port. Exception: PR64-SEC-03 |
| Worker entry point (D-ORCH-073) | Consumers are built stopped and started only after `services.startup()`; process error handlers are installed before the composition; shutdown drains active jobs before the listener closes |

## 6. D-TASK035-01..06 (accepted by D-ORCH-131 subject to review)

| Item | Security reading |
|---|---|
| 01 `<queue>-dead` | Sound. `mergeQueues` refuses a queue name that ends in `-dead`, so no named queue can collide with a dead-letter queue |
| 02 job id `<kind>.<id>[.<step>]` | Sound (anchored patterns, lower-case UUID). Consumer-side check of the id against the payload: PR64-SEC-07 |
| 03 joi in `@platform/shared` via `./queues` | Sound: subpath only, not in the browser-safe barrel, no new package |
| 04 concurrency as a constant | No security impact (bounded); ADR-0013 §6 says "from config", a code-review matter |
| 05 no kinds for `audit-maintenance` / `housekeeping` | Sound: fails closed (every payload refused) |
| 06 stalled jobs without a record | Accepted with the observation in PR64-SEC-08 |

## 7. Probes

| Probe | What | Result |
|---|---|---|
| P1 payload | Head `validateJobPayload` (type-stripped `git archive` copy, joi 18.3.2): 2 controls, `__proto__` / `constructor` keys from `JSON.parse`, 11 tenant-key spellings, a nested `org_id`, 8 `trace_context` cases, 1k/100k unknown keys, a long key name, array, `v: 2.0`, upper-case id, a kindless queue | Controls as expected (valid accepted; `org_id` refused and flagged). `__proto__` accepted silently, other spellings refused unflagged (PR64-SEC-06); `tracestate` CR/LF, NUL, U+2028, PII accepted (PR64-SEC-05); 100k keys: 2,388,908-char message, 489 ms |
| P3 tracestate | The PR64-SEC-05 sketch: 15 grammar cases; 200 runs each of three near-miss shapes at 1k and 8k | 15/15 as expected; linear (ratios 0.9, 1.1, 1.3). The first draft's regex trim was quadratic (ratio 58-139) and was replaced in §4 |
| P2 runtime / control / trace | Head `createWorkerQueues` + `queueConnectionOptions` (`processors: {}`), fake RESP server refusing `HELLO`/`AUTH`, sentinel password, 3 s | runtime: 97 sentinel copies on stderr, 0 log lines, `metrics()` pending after 3 s; control (listener on each `Queue`): 0 stderr lines; trace: 99/99 `console.error` calls from `bullmq/dist/cjs/classes/queue-base.js:89` (PR64-SEC-01, -03) |

## 8. Conditions and routing

- **C1 (merge condition): PR64-SEC-01** in this PR, with tests (a) and (b) of §4, then a security delta round naming the fix head. The orchestrator does not merge PR #64 on this record alone.
- **This fix cycle (follow-ups, not conditions):** PR64-SEC-02 (due at the latest before TASK-039 registers a processor), PR64-SEC-03, PR64-SEC-05; PR64-SEC-06 and -11 if cheap, else TASK-047 / TASK-039.
- **principal-architect:** PR64-SEC-04 (ADR-0013 retention amendment).
- **TASK-039 / TASK-047 sheets:** PR64-SEC-07, PR64-SEC-08, PR64-SEC-04 (housekeeping trim).
- **product-manager:** PR64-SEC-10.
- **devops-engineer (activation PR):** PR64-SEC-09 with PR48-SEC-02 and PR61-SEC-04.
- **Notes for the code review (not security findings):** the gauge names (`platform_queue_jobs`, `platform_queue_dead_letter_jobs`) differ from platform.md §8 (`bullmq_queue_waiting|active|failed|delayed`, `bullmq_dlq_depth`, `bullmq_oldest_waiting_age_seconds`), which the worker autoscaling policy (platform.md §6) reads, and the in-house renderer deviates from ADR-0017 am. 1 (`@prometheus-io/client`); `NO_PROCESSOR` is declared but unused; the re-enqueue observation in PR64-SEC-08.
- **Lane B:** this round does not replace the pending lane-B run; `consumer.int.test.ts` (AT-US-009-01..05, NFR-RES-004 crash test) must pass there.

## 9. Record simulation

`main`'s `tools/ci/check-security-owned-paths.mjs` (extracted with `git archive` from `main`), base `a70dc64` (local `main` tip), `--json`, run against a scratch `git clone --shared --no-checkout` of the main repository with a sparse checkout of `.github/` and `docs/05-quality/security/`. Scenario commits were built with plumbing in that clone only (nothing was written to the main repository or the PR worktree); the clone is removed afterwards.

| Scenario | Head | Expected | Result |
|---|---|---|---|
| S1 this record committed on top of `90ef83f` (what the orchestrator will push) | sim `db19e43` | pass | **pass**, satisfied by this record at `90ef83f`, 6 owned paths |
| S2 control: no record | `90ef83f` | missing | missing ("no record named … PR-0064-*.md") |
| S3 control: `--pr 65` | sim `db19e43` | missing | missing |
| S4 control: same record with a FAIL verdict row | sim `c7e2235` | missing | missing ("verdict FAIL is not one of …") |
| S5 an owned path (`producer.ts`) changed after the record | sim `a36bcf0` | missing | missing ("names 90ef83f, but … producer.ts changed after it") |
| S6 an unowned path (`consumer.ts`) changed after the record | sim `f692350` | pass | **pass** |

**Record placement.** The PR worktree is reserved for the lane-B queue, so this record is committed on `main` (as PR #63's was, D-SEC-PR63-01); the orchestrator may also add it verbatim to the branch. ci-gate checks out the merge ref (the record is then in `--root`) and passes the PR head as `--head`, so the diffs exclude `main`'s own changes. Simulated with the record on top of `main` `96278d0` and a `merge-tree` merge with `90ef83f`:

| Scenario | Root | Base / head | Expected | Result |
|---|---|---|---|---|
| M-d | merge ref with the record | `main` tip / `90ef83f` | pass | **pass** (6 owned, satisfied at `90ef83f`) |
| M-e | merge ref with the record | merge base `80dce9e` / `90ef83f` | pass | **pass** |
| M-f | merge ref with the record | `main` tip / `90ef83f`, `--pr 65` | missing | missing |
| M-g | `main` without the record | `main` tip / `90ef83f` | missing | missing |

The record counts from the next `pull_request` event on PR #64 (the evidence push), not from a re-run of 44105548507, whose merge ref predates it.

S6 matters for C1: the PR64-SEC-01 fix touches only unowned files (`runtime.ts`, `consumer.ts`), so ci-gate will stay green on this record after the fix lands. The condition is therefore enforced by the orchestrator, not by the gate (and PR64-SEC-09 is why).

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_CONDITIONS.** 0 Critical, 0 High, 2 MEDIUM, 4 LOW, 5 INFO. C1 = PR64-SEC-01 fixed in this PR and verified by a security delta round before merge |

# Round 2 (delta `90ef83f..266abb6`, fix cycle 1)

| Field | Value |
|---|---|
| Delta | One code commit, `266abb6` `fix(worker): dead-letter id, queue error listener, sanitised failures, fail-fast queue profile (TASK-035)`: 17 files, +1027/-130, every one of them unowned (`apps/worker/src/platform/{queues,health}/**`, `apps/worker/src/start-worker.ts`, `packages/shared/src/queues/**`). It was amended locally from `7ca95f4` (never pushed; backup branch `task035-fc1-pre-gitleaks-backup`), see R2.6. The local branch tip `4eab6c2` adds only the lane-B evidence (8 files under `docs/05-quality/tests/runs/20261118T1229Z_266abb6/`). Nothing is pushed yet: `origin` and `refs/pull/64/head` are still `90ef83f` (D-ORCH-134: the push waits for this round). `origin/main` was `b651bea` when this round was written (PR #67 merged as `591d0f5`). Since the merge base `80dce9e` it changed `eslint.config.mjs`, `packages/authz/**`, `tests/generated/rbac/**`, `tests/fixtures/lint/**`, `tools/lint/**`, `tools/ci/advisory-watchlist.json`, `tools/ci/check-audit.test.ts` and docs, none of PR #64's paths. `git merge-tree --write-tree origin/main 4eab6c2` is clean |
| Head | 266abb689cbb17e453651c9d400c8ae70500a4c9 |
| Lane A evidence | None for this delta yet (not pushed). The record binds to the code commit `266abb6`; the evidence commit after it changes no owned path, so main's checker accepts the pushed tip `4eab6c2` (R2.9) |
| Lane B evidence | `20261118T1229Z_266abb6`, profile `pr`, verdict PASS: api 173, catalog-c1-c14 102, integration 345 (all 14 `consumer.int.test.ts` cases), rls-cross-tenant 126, unit 6847 (2 skipped), 0 failures; merged coverage 99.38 % lines / 96.42 % branches; US-006 merged gate PASS. Both `gitleaks-full` cases (pinned image v8.30.1, full ancestry of `266abb6`) passed |
| Owned paths changed | 6, unchanged from round 1 (main's checker in R2.9). `.github/CODEOWNERS` and `tools/ci/check-security-owned-paths.mjs` have not changed on `main` since `80dce9e` |
| Binding items checked | D-SEC-PR64-01 condition C1 (PR64-SEC-01, tests (a) and (b) of §4); the fix-cycle follow-ups PR64-SEC-02, -03, -05 (D-ORCH-132 scope); D-ORCH-133 (local rewrite of never-pushed commits); D-TASK035-07..13; code review round 2 (`76d5e4e`, APPROVED_WITH_NITS) R2-n2, R2-n3, R2-n4, R2-n5 |
| Reviewer / date | security-analyst, 2026-11-18, round 2 (delta). Host rule (heavy lane-B run on this machine): no npm, Jest, type-check, build or Docker. Single-process Node probes ran in the session scratchpad on `git archive` extracts of `266abb6` (head), `90ef83f` (round 1, positive control) and three mutants of the head, types stripped in transform mode, with `bullmq` 6.7.0, `ioredis` 6.0.0 and `joi` 18.3.2 from the main checkout's `node_modules` (the delta does not touch the lockfile). The fake Valkey servers listened on 127.0.0.1 only; every password was a random per-run value or a placeholder. Nothing was run in the PR worktree `Shipqube-TASK-035-fc1`, not even read-only git: SHAs were resolved in the main checkout, which shares its object store |

## R2.1 Summary

**C1 is discharged.** PR64-SEC-01 is fixed at `266abb6`. Every worker `Queue` is built by `openQueue` (`open-queue.ts:12-17`), which always attaches a listener that logs the error class only. Against a Valkey that refuses AUTH, the head writes 0 password copies to stderr in 3 s, with 124 class-only `worker.queue_error` lines across all 18 queue names. Under the same probe, round 1 writes 112 copies, and a mutant without the listener writes 113 (P2r2). The consumer's `Worker` listener is load-bearing too: removing it gives 12 copies, and test (a) catches that, because the consumer meets the same refusal. Across `apps/*/src` and `packages/*/src`, `open-queue.ts:13` is the only construction of a BullMQ `Queue`; the api producer takes an injected `queueFor`.

**The fix-cycle follow-ups are closed:**
- **PR64-SEC-02.** BullMQ now only sees a reason code. P4 drives the head's real handler into BullMQ 6.7.0's real `Job.prototype.moveToFailed` over 17 scenarios. `failedReason` and `stacktrace` never hold a sentinel. Under the production job options `stacktrace` is `[]`, and without them it holds only `<Name>: <CODE>`. The raw-rethrow mutant leaks into `failedReason`, and into `stacktrace` when `stackTraceLimit` is absent.
- **PR64-SEC-03.** `GET /metrics` answers 503 after about 2.02 s in every outage shape. Round 1 never answered within 6 s. After the first `ready`, the `queue` profile fails at once (2 ms) or at the 2 s command timeout.
- **PR64-SEC-05.** `tracestate` is validated against the W3C grammar in linear time. Over 300,000 fuzz strings it shows 0 differences from an independent character-level reading of the ABNF.

**New:** two INFO items.
- **PR64-SEC-12.** Gauge collections started before the queue connections were ever ready never settle. P6 measures about 31 KB per scrape, and on recovery they all fire at once as 18 scripts per scrape.
- **PR64-SEC-13.** Test (b)'s lexical scan reaches today's code only (code review R2-n5), so a future `Queue`, `Worker` or producer queue must go through the factory. This becomes a TASK-043 condition.

**Gitleaks:** the password-shaped literal of `7ca95f4` is gone from the rewritten commit and from the evidence commit (R2.6). I agree with D-ORCH-133.

Open for the change: 0 Critical, 0 High, 0 Medium. LOW PR64-SEC-04 and -09 (routed in round 1). INFO PR64-SEC-06, -07, -08 (in part), -10, -11, -12 and -13.

**Verdict: PASS_WITH_FOLLOW-UPS** at `266abb6`.

## R2.2 Method

1. Read `git diff 90ef83f 266abb6` in full (17 files), `git diff 7ca95f4 266abb6` (only `open-queue.test.ts`), the evidence diff `266abb6..4eab6c2` (8 files), and the head files in context: `open-queue.ts`, `job-handler.ts`, `consumer.ts`, `runtime.ts`, `connection.ts`, `errors.ts`, `dead-letter.ts`, `health/server.ts`, `start-worker.ts`, `payload-v2.ts`, `job-options.ts`, and the new and changed tests.
2. BullMQ 6.7.0 and ioredis 6.0.0 paths the fix relies on:
   - `QueueBase.emit` and its `console.error(err)` fallback (`queue-base.js:79-92`);
   - `RedisConnection` blocking override (`redis-connection.js:113-121`) and `waitUntilReady` (`:180-235`). It resolves only on `ready` and rejects only on `end`, so with a never-giving-up retry strategy, `client` stays pending until the first `ready`;
   - `Job.moveToFailed` and `updateStacktrace` (`job.js:473-523, 947-957`). `stackTraceLimit === 0` empties `stacktrace`;
   - `Worker.handleFailed` (`worker.js:646-680`);
   - ioredis `sendHandshake` and the RESP3 downgrade (`event_handler.js:89-200`).
3. Probes (R2.4): P2r2 leak, P4 failed-set persistence, P5 fail-fast and `/metrics` deadline, P6 pending collections, P7 `tracestate`, P8 source-scan reach. Each has a positive control or mutant.
4. Gitleaks: a full emulation of the v8.30.1 `generic-api-key` rule and an over-approximating all-rules scan over the added lines of `90ef83f..7ca95f4`, `90ef83f..266abb6` and `266abb6..4eab6c2`; the lane-B `gitleaks-full` JUnit; remote refs via `ls-remote` and `branch -r --contains`.
5. Code review round 2 (`76d5e4e` on `main`), aligned in R2.7. Record simulation with main's checker (R2.9).

## R2.3 Round-1 findings: status at `266abb6`

| ID | Status | Evidence |
|---|---|---|
| PR64-SEC-01 (MEDIUM, C1) | **Closed. C1 discharged** | `openQueue` (`open-queue.ts:12-17`) is used by `runtime.ts:47-48` and by `consumer.ts:59` (the consumer-owned dead-letter queue). The consumer's `Worker` keeps its class-only listener (`consumer.ts:73`). P2r2: head 0 stderr copies, 0 stderr lines, 124 `worker.queue_error` lines whose only content field is the class (`ReplyError`), and 0 log lines with the sentinel. Controls: round 1 gives 112 copies (896 stderr lines); mutant M1 (listener removed from `openQueue`) gives 113; mutant M3 (the consumer's `Worker` listener removed) gives 12. Test (a) (`open-queue.test.ts:77-136`) asserts that the password crossed the wire, that `console.error` was never called, and that neither `console.error` nor `process.stderr.write` saw the password. Its spy serialises own properties (`command.args`), so M1 and M3 both fail it. Test (b) (`:166-179`) holds for every construction in today's tree; its reach is PR64-SEC-13. Lane B: all three `open-queue.test.ts` cases are green |
| PR64-SEC-02 (MEDIUM) | **Closed** | `persistedFailure` (`job-handler.ts:74-79`) rethrows `TRANSIENT`, or a `NonRetryableError` named `UnrecoverableError` carrying only its reason, with `stack` = `name: message`. A refused payload's stored data is replaced by `redactValue(job.data)` (`:115-122`, after the record, before the throw). `jobOptions` sets `stackTraceLimit: 0` (`job-options.ts:45`, pinned in `packages/shared/src/queues/queues.test.ts:99`). P4 results: `failedReason` is always one of `TRANSIENT`, `VALIDATION_ERROR`, `UNRECOVERABLE` or `PAYLOAD_INVALID`. `stacktrace` is `[]` under the production options and `["<Name>: <CODE>"]` without them. 0 sentinels in `failedReason`, `stacktrace` or the thrown error across 17 scenarios: transient on attempts 1 and 5, `NonRetryableError` with text, BullMQ `UnrecoverableError` with text, a plain object named `UnrecoverableError`, a thrown string, a synchronous throw, each with and without `stackTraceLimit`, and three refused payloads. A refused payload's `token` value and its bearer value are gone from the stored data. The retry decision is unchanged: `delayed` for transient failures before the last attempt, `failed` at once for non-retryable ones. Mutant M2 (the raw error rethrown) puts the sentinels into `failedReason` in 12 of 14 processor scenarios (a thrown string has no message) and into `stacktrace` whenever `stackTraceLimit` is absent and the thrown value has a stack. So `stackTraceLimit: 0` works on its own as defence in depth. Lane B ran the int case on Valkey 8 (`consumer.int.test.ts`, "[PR64-SEC-02] … sanitised") and AT-US-009-04, which now asserts the failed-set hash. Residuals by design, accepted: the dead-letter record keeps the redacted, bounded message, so free text the redactor does not recognise survives there. In a refused payload, free text under an unrecognised key, and a key name, survive in the stored data and in the record (the redactor's scope; only a Redis writer or a producer bypass can create such a payload). If `updateData` fails, the raw data stays, the failure is logged (`worker.job_data_redact_failed`), and the refusal is still final |
| PR64-SEC-03 (LOW) | **Closed** for `/metrics` and dead-letter writes after the first `ready`; residual is PR64-SEC-12 | Two profiles (`connection.ts:17-22`). `queue` keeps `buildValkeyOptions`' 2 s `commandTimeout` and `maxRetriesPerRequest: 1` and adds `enableOfflineQueue: false`. BullMQ does not override them for a `Queue`, because only blocking connections get `maxRetriesPerRequest: null`. `worker` (Workers only) is as before. `/metrics` races the collection against a 2 s deadline (`server.ts:23-31, 82`), and a rejection becomes a value-free 503. P5 against five fake shapes: head `GET /metrics` gives 503 in 2,024-2,030 ms for refuse, silent and closed-port, 2,026 ms for ready-then-silent and 18 ms for ready-then-drop. A direct `metrics()` call rejects in 2,016 ms (ready-then-silent, command timeout) and in 2 ms (ready-then-drop, no offline queue). Round 1: no response within 6 s in all five shapes. Before the first `ready`, `metrics()` stays pending in both rounds (BullMQ's `client` getter), which is PR64-SEC-12. The profile wiring at the call sites is not pinned (code review R2-n2, supported in R2.7) |
| PR64-SEC-04 (LOW) | Open, unchanged | Still `removeOnFail: false`, and dead-letter records are never removed. principal-architect (ADR-0013 retention amendment), plus the TASK-039 housekeeping trim |
| PR64-SEC-05 (LOW) | **Closed** | `isTracestate` (`payload-v2.ts:65-77`) is wired as a Joi `custom` rule (`:83`). P7 results. 24 grammar cases: 0 mismatches against both the head and the reference. 300,000 fuzz strings (half grammar-weighted, half random over 26 characters including CR, LF, NUL, U+2028, NBSP and DEL): 79,290 accepted, 0 differences. Scaling on six near-miss shapes: ratio 1.1-9.2 from 1k to 8k and 2.7-101 from 1k to 64k, which is linear; the slowest shape takes 2.2 ms at 64k. The cap is not a gate, because Joi runs the custom rule even when `max(512)` fails; still, a 1 MB value is refused in 0.5 ms. CR/LF is refused (`any.invalid`), and a well-formed list is accepted through the whole payload. Residual, accepted in round 1 as the alternative to dropping the field: the W3C value alphabet still admits free text such as `k=<local>@<domain>`. The check is stricter than W3C on empty members (code review R2-n3); see R2.7 |
| PR64-SEC-06 (INFO) | Open, unchanged | P4 P3: an own `__proto__` key from `JSON.parse` still validates, and the processor runs. TASK-047, or the next change to `payload-v2.ts` |
| PR64-SEC-07 (INFO) | Open, unchanged | TASK-047 (tenant context in the consumer), TASK-039 (job identity check, deadline) |
| PR64-SEC-08 (INFO) | **Partly closed** (D-TASK035-07) | The record id is now `<job id>.dead.<attempts>` (`dead-letter.ts:24-26`), so a later final failure after an operator `retry()` writes its own record. Still open: after a `retry({ resetAttemptsMade })` the add is ignored while `worker.job_dead_lettered` is still logged, and a stalled-out job has no record. TASK-039 |
| PR64-SEC-09 (LOW) | Open; the surface grew | The fix put the C1 control (`open-queue.ts`) and the PR64-SEC-02 control (`job-handler.ts`) into unowned files. A later PR could remove either without a security record, and the gate would stay green. The `/apps/worker/src/platform/` line proposed in §4 covers both. devops-engineer with the activation PR (PR48-SEC-02, PR61-SEC-04) |
| PR64-SEC-10 (INFO) | Open, unchanged | product-manager |
| PR64-SEC-11 (INFO) | Open, unchanged | The suite still runs Valkey without `--aclfile`. TASK-039 |

## R2.4 Probes

| Probe | What | Result |
|---|---|---|
| P2r2 leak | Real `createWorkerQueues` (18 `Queue`) plus `createQueueConsumer('booking')` with its own dead-letter queue, started, and 3 `metrics()` calls, against a fake RESP server answering `-WRONGPASS` to `HELLO`/`AUTH`. Child process, 3 s; fresh random sentinel per run; the parent counts copies in the child's real stdout and stderr | Head: 0 / 0 stderr lines / 124 class-only lines / 0 unhandled rejections. Round 1: 112 copies. M1 (no `openQueue` listener): 113. M3 (no `Worker` listener): 12. The password crossed the wire in every run (not vacuous) |
| P4 failed set | Head `createJobHandler` on a fake job (`Object.create(Job.prototype)`), the thrown error fed to BullMQ's real `moveToFailed` over a capturing backend. Sinks: `failedReason`, `stacktrace`, stored data, record, log, thrown error. 17 scenarios | As in R2.3. M2 (raw rethrow) is the positive control |
| P5 fail-fast | Head and round-1 composition with the real health server, `GET /metrics`, against refuse / silent / closed / ready-then-silent / ready-then-drop | As in R2.3. 0 unhandled rejections |
| P6 pending | 0 / 100 / 1,000 / 2,000 `metrics()` calls before the first `ready`, heap after GC, then the fake starts accepting | Linear, about 31 KB per call (2,000 calls: 62,196 KiB; control 24 KiB). On recovery every call settles, with 18 script calls each (36,000 for 2,000): PR64-SEC-12 |
| P7 tracestate | The head's `isTracestate` and the whole `validateJobPayload` | As in R2.3 |
| P8 scan reach | Test (b)'s strip and regex over nine constructions | 2 of 2 controls caught. Missed: `new bullmq.Queue(`, `new Q(` (renamed import), `Reflect.construct(Queue, …)`, `new (Queue)(`, a subclass, a second `new Worker(` without a listener, and a `/*` inside a string literal that strips a later `new Queue(` (PR64-SEC-13) |
| G gitleaks | Full `generic-api-key` emulation (regex, secret group, digit check, entropy > 3.5, rule and global allowlists; runtime-built positive control fires, negative control silent) and an all-rules over-approximation (222 rules, 220 compiled) over added lines | `90ef83f..7ca95f4`: 1 finding (the `PASSWORD` constant of `open-queue.test.ts`, 23 characters, entropy 4.23). `90ef83f..266abb6`: 0. `266abb6..4eab6c2` (13,250 added lines): 0. The over-approximation's hits are all `generic-api-key`, and the entropy, digit and allowlist steps clear them |

## R2.5 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR64-SEC-12 | Gauge collections started before the queue connections were ever `ready` never settle. Each scrape during a never-ready outage leaves about 31 KB and 18 queued scripts behind, and all of them fire together when Valkey comes back | INFO | CWE-400 | A04 | `runtime.ts:75`; `health/server.ts:23-31`; BullMQ `redis-connection.js:180-235` | TASK-039, or the next change to the worker's metrics (with the ADR-0017 am. 1 client alignment of the round-1 code-review note) |
| PR64-SEC-13 | The PR64-SEC-01 control is pinned behaviourally for today's constructions only. Test (b) is lexical, so a renamed or namespace import, a subclass, `Reflect.construct`, a second `Worker`, or a producer queue built outside `apps/worker/src` would bring the stderr leak back without a red test | INFO | CWE-532 | A09 | `open-queue.test.ts:166-179`; future `queueFor` queues (TASK-043) | TASK-043 (condition); next holder of the `lint` lock (rule) |

### PR64-SEC-12 (INFO): pending gauge collections before the first `ready`

**Description.** `WorkerQueues.metrics()` runs 18 `getJobCounts` calls. Each awaits BullMQ's `client` getter, the connection's `initializing` promise. That promise settles only on the first `ready` (or on `end`, which the never-giving-up retry strategy never produces). The 2 s `/metrics` deadline bounds the HTTP response but not the work: every scrape during a never-ready outage, for example a worker started while Valkey refuses its rotated password, adds one pending collection. P6: about 31 KB of heap per scrape, linear (2,000 scrapes: 62 MB). On recovery, 18 scripts per scrape are sent together (36,000 for 2,000 scrapes).

**Exploitability and impact.** The port is internal, and the scrape rate is the collector's. At one scrape every 15 s, an 8-hour never-ready outage costs about 60 MB and a burst of about 35,000 scripts. The readiness probe fails throughout the same outage (`readinessChecks` includes the Valkey check), so an orchestrator that replaces unready tasks bounds it; Compose does not. Availability only, internal trigger: INFO.

**Remediation (code).** Single-flight the collection, so concurrent and repeated scrapes share one in-flight promise:

```ts
// runtime.ts
let inflight: Promise<string> | undefined;
// ...
metrics() {
  inflight ??= collectQueueMetrics(queues).then(renderQueueMetrics).finally(() => { inflight = undefined; });
  return inflight;
},
```

**Verification test.** Against a refusing fake (as `open-queue.test.ts` (a)), 100 `metrics()` calls leave one pending collection: the fake receives at most 18 scripts after it starts accepting, and every call settles with the same result.

### PR64-SEC-13 (INFO): the factory is the control, and the scan only reaches today's code

**Description.** Code review R2-n5 found that test (b) misses renamed and namespace imports and `Reflect.construct`, and that its `//` strip eats code after a URL string. P8 adds four more misses: `new (Queue)(`, a subclass, a second `new Worker(` (the scan does not list `Worker`, whose listener lives only in `consumer.ts`), and a `/*` inside a string. Each of these constructions reopens PR64-SEC-01 (M1 and M3 show the stderr leak for a `Queue` and a `Worker` without a listener). Today nothing escapes: `open-queue.ts:13` and `consumer.ts:64` are the only BullMQ emitter constructions in `apps/*/src` and `packages/*/src`. The first new ones are scheduled. TASK-043's outbox relay needs producer queues for `queueFor` (`producer.ts`), and code review R2-n5 notes that an api-side `Queue` would sit outside the worker scan.

**Remediation.**
- **TASK-043 (condition).** Every queue handed to `createJobProducer({ queueFor })` comes from `openQueue` with the `queue` profile. If the queue has to live under `apps/api`, it needs an equivalent factory with a class-only `error` listener and its own copy of test (a).
- **Next `lint`-lock holder.** An import-level rule replaces the text scan. Use `no-restricted-imports` with `{ name: 'bullmq', importNames: ['Queue', 'Worker', 'QueueEvents', 'FlowProducer', 'QueueScheduler'] }` for `apps/**/src/**`, excepting `open-queue.ts` (`Queue`) and `consumer.ts` (`Worker`). Add a ban on a namespace or default import of `bullmq`.

**Verification test.** Lint fixtures: a renamed import, a namespace import and a `Worker` import outside the two files are each refused, and the two files are clean. For TASK-043: the relay's queues pass the test (a) shape.

## R2.6 Gitleaks and the local rewrite (D-ORCH-133)

- **What lane B found.** At `7ca95f4`, `open-queue.test.ts` held the fake password as one string literal. This is a real `generic-api-key` finding for the full-history scan, although the value was never a credential. The G emulation reproduces it as 1 finding. At `266abb6` the test assembles the value from three string parts at run time (`open-queue.test.ts:19-20`). The fix diff gives 0 findings, the evidence diff gives 0, and the lane-B `gitleaks-full` cases (pinned image, ancestry of `266abb6`, 17-line baseline) passed.
- **Never pushed.** After a fetch, no remote-tracking ref contains `7ca95f4` or `266abb6`. `ls-remote` shows the branch and `refs/pull/64/head` at `90ef83f`. No file at `4eab6c2` names `7ca95f4` or holds the old literal.
- **Ruling: I agree with D-ORCH-133.** Amending a commit that no remote ref contains changes no shared history and needs no force push. The alternative is a `.gitleaksignore` fingerprint or an 18th baseline line, which would add a permanent suppression to the full-history gate for a fake value. That costs more review (D-SEC-PR45-01, PR25-SEC-01) and widens the gate. Three conditions apply:
  1. The backup branch `task035-fc1-pre-gitleaks-backup` (and `task028-fc1-pre-gitleaks-backup`) stays local and is never pushed, because it carries the finding. Delete it once PR #64 merges.
  2. Before amending, check after a fetch that `git branch -r --contains <sha>` is empty.
  3. If a never-pushed commit carries a real secret, rewriting is not enough: the secret is rotated as well.

## R2.7 Code review round 2 (`76d5e4e`, APPROVED_WITH_NITS): alignment

- **R2-n2 (profile wiring unpinned): supported, with a security reason.** If `connection` and `queueConnection` were swapped, the `Queue`s would silently get the blocking profile (no timeout, offline queue). That reopens PR64-SEC-03 for dead-letter writes, while `/metrics` would still be bounded by the deadline. The one-line pins the code review suggests are enough.
- **R2-n3 (`tracestate` stricter than W3C on empty members): keep the strict check.** If TASK-043 copies an inbound `tracestate`, the producer should drop an invalid one, as W3C says to discard on a parse failure, rather than relax the validator. Route to TASK-043.
- **R2-n4 / D-TASK035-10 (BullMQ control-flow errors become TRANSIENT): no security objection.** It fails closed, and processors hold no token or worker handle.
- **R2-n5 = PR64-SEC-13.** The TASK-043 half is now a security condition.
- **D-TASK035-07..13: no security objection.**
  - 07 partly closes PR64-SEC-08.
  - 08 and 09 are the round-1 remediations of PR64-SEC-01 and -02.
  - 11 is confirmed by P5.
  - 13 (validate rather than drop `tracestate`) is within the round-1 remit.
- **Note for the code review, not a finding.** `worker.queue_error` logs one line per refused reconnect per connection: 124 lines in 3 s in P2r2, and about 4 lines/s at the 5 s reconnect cap during a sustained refusal. Logging state changes, or the first error per queue and then a periodic count, would keep a long outage from flooding the log.

## R2.8 Conditions and routing

- **C1: discharged at `266abb6`.**
- **Remaining merge conditions (security):**
  1. Push `4eab6c2` as is (PR #67 merged as `591d0f5`, so the audit step passes again). Lane A must run in full, with every fast-lane step executed and green; under D-ORCH-134 that means the close and reopen path, because no earlier full run covers this code tree. ci-gate reads this record from the merge ref, at the first `pull_request` event (push or `reopened`) after the record is on `main`.
  2. The `security-integration` job, due once `record_ok` is true, runs and passes.
  3. A later commit on this PR that changes one of the 6 owned paths, or anything under `apps/worker/src/platform/{queues,health}/`, `apps/worker/src/start-worker.ts` or `packages/shared/src/queues/`, needs a security delta round. The orchestrator enforces this, because the gate sees only the 6 owned paths (PR64-SEC-09).
  4. Lock order with Dependabot #58 (bullmq 6.7.2), per code review R2.6 item 3. Whichever of the two merges second re-runs, in lane B, `open-queue.test.ts` (a) and the PR64-SEC-02 int case. Both rest on BullMQ internals (the `QueueBase.emit` fallback, `updateStacktrace`).
- **New routes:**
  - PR64-SEC-12 → TASK-039, or the next change to the worker metrics.
  - PR64-SEC-13 → TASK-043 (condition) and the next `lint`-lock holder.
  - Code review R2-n3 → TASK-043 (drop an invalid `tracestate` at the producer).
- **Unchanged routes:**
  - PR64-SEC-04 → principal-architect and TASK-039.
  - PR64-SEC-06 → TASK-047.
  - PR64-SEC-07 → TASK-047 and TASK-039.
  - PR64-SEC-08 (rest) → TASK-039.
  - PR64-SEC-09 → devops-engineer, activation PR; add `open-queue.ts` and `job-handler.ts` to its list.
  - PR64-SEC-10 → product-manager.
  - PR64-SEC-11 → TASK-039.

## R2.9 Record simulation

Main's `tools/ci/check-security-owned-paths.mjs` ran on plumbing scenario commits in a `git clone --shared --no-checkout` of the main repository, with a sparse checkout of `.github/`, `docs/05-quality/security/` and `tools/ci/`. Each run used `--pr 64 --json`, against `origin/main` `b651bea`. The work tree was the simulated merge ref ("main + this record" merged with the PR tip, parents in GitHub's order) and `--head 4eab6c2` unless noted. The record had exactly two table rows whose first cell starts with `Head`: round 1 (`90ef83f`) and round 2 (`266abb6`, full SHA). Its last `Verdict` row is this round's. Nothing was written to the main repository or the PR worktree, and the clone was removed afterwards.

| Scenario | Root / base / head | Expected | Result |
|---|---|---|---|
| S1 this record on `main`; merge ref with the tip | merge ref / `main` tip / `4eab6c2` | pass | **pass**, 6 owned (reported at `90ef83f`, the first head row that binds) |
| S2 as S1, base = merge base `80dce9e` | merge ref / `80dce9e` / `4eab6c2` | pass | **pass** |
| S3 as S1, head = the code commit (evidence not pushed) | merge ref / `main` tip / `266abb6` | pass | **pass** |
| S4 S1 plus a docs-only commit after the tip | merge ref / `main` tip / docs commit | pass | **pass** |
| S5 the round-2 head row alone (round-1 row renamed) | merge ref / `main` tip / `4eab6c2` | pass at `266abb6` | **pass at `266abb6`** |
| C1 control: no PR-0064 record on `main` | | missing | missing ("no record named PR-0064-*.md") |
| C2 control: this round's Verdict set to FAIL | | missing | missing ("verdict FAIL is not one of …") |
| C3 control: `--pr 65` | | missing | missing |
| C4 control: an owned path (`producer.ts`) changed after the tip | | missing | missing (both head rows: "… changed after it") |
| C5 control: the round-2 head row alone, naming the never-pushed `7ca95f4` | | missing | missing ("names no commit of this PR") |
| C6 control: the round-2 head row alone, owned change after the tip | | missing | missing |
| F1 fact: the round-1 record only, as on `main` before this round | | pass at `90ef83f` | **pass at `90ef83f`** |

12 of 12 as expected. The candidate is LF (0 CR bytes) and has 2 table rows whose first cell starts with `Head`; its last line is this round's `Verdict` row. F1 is why C1 had to be held by the orchestrator: the fix touched only unowned paths, so the round-1 record alone already satisfies the gate (PR64-SEC-09). S5 shows that the round-2 row binds on its own. The record counts from the first `pull_request` event after it is on `main` (the push of `4eab6c2`, or the `reopened` event of D-ORCH-134); a re-run of an older lane-A run reuses its old merge ref and does not see it.

| Field | Value |
|---|---|
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** Round 2 at `266abb6`: C1 (PR64-SEC-01) is discharged. PR64-SEC-02, -03 and -05 are closed under probing with positive controls, and PR64-SEC-08 is partly closed. 0 Critical, 0 High, 0 Medium open for the change. LOW PR64-SEC-04 and -09 and INFO PR64-SEC-06, -07, -08 (rest), -10, -11, -12 and -13 are routed. The evidence-only tip `4eab6c2` keeps the binding |
