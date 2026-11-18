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
