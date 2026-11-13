# SPK-04: Audit write throughput, 300 rps mixed, audit on/off

| Field | Value |
|---|---|
| Task | TASK-018 (Wave 0) · branch `feat/TASK-018-spk-04-spike-audit-write` · harness commit `c037470` |
| Risk | R-ARCH-04 (per-stream advisory lock + vault inserts on the request path; one hot tenant serialising on one stream) |
| NFR / requirements | NFR-AUDIT-005 (audit overhead ≤ 15 ms p95 and ≤ 40 ms p99 vs the same route with audit disabled); NFR-PERF-001 context (p95 ≤ 300 ms at 300 rps); data-model.md §5.4 (chaining procedure), §5.7 (vault DDL); ADR-0007 item 4 (build-time `-bench` image) |
| Date / host | 2026-11-13 · Windows 11 Pro 10.0.26300, Intel i9-11950H (16 logical CPUs), 32 GB RAM (about 7 GB free), Node v24.22.3, Docker Desktop 29.8.0 (WSL2 VM: 16 CPUs, 15.5 GiB) **shared with other agents' workloads** · `postgres:18` = PostgreSQL 18.6 (`sha256:e3d24f69…3c42`, the harness pin, default server settings: shared_buffers 128 MB, max_connections 100, fsync and synchronous_commit on) · k6 v2.2.0 `grafana/k6@sha256:5221b620a4f874faff6e32ba597aa667c058391fe4898b1c6f6377f062c6cdec` · Prisma 7 + `@prisma/adapter-pg` through `createDatabaseRuntime` / `withTenantTx` |
| Owner | performance-engineer |
| Evidence | `docs/05-quality/performance/runs/20261113T034701Z_c037470/` (300 rps) and `docs/05-quality/performance/runs/20261113T040201Z_c037470/` (150 rps): `host-spec.json`, `k6-audit-ab.summary.json`, `summary.json`, `summary.md` |
| **Verdict** | **INCONCLUSIVE under the validity rule at both 300 and 150 rps** (TEST-STRATEGY §7.10: host CPU > 85 % in more than 10 % of samples and/or more than 1 % dropped iterations in at least one arm per run). **What the evidence says:** the data-model §5.4 procedure (`on`) does **not** hold 300 rps on this host. One hot tenant at 60 rps on one stream lock builds a lock queue (hot-org lock wait p95 229 ms / 603 ms); the waiting transactions hold pool connections, so checkout times out (`SERVICE_UNAVAILABLE`, the 2 s `maxWait`) for every tenant. Δp95 on − off was +1 042 ms in the cleaner repetition. The `batched` FALLBACK candidate cut that to Δp95 +217 ms / Δp99 +419 ms (rep 2), still far over budget. At 150 rps (hot stream 30 rps) both `on` repetitions are valid: Δp95 +22.1 / −2.3 ms, Δp99 +59.4 / −149.8 ms, pooled +9.9 / −45.2 ms. That is inside the budget pooled, but rep 1 alone fails it. **Recommendation:** treat the 300 rps exit as **not met**. Specify the FALLBACK for TASK-030 (§5.2) and **escalate to principal-architect (FALLBACK-INSUFFICIENT direction)**, because the batched variant alone did not meet the budget at 60 rps per stream on this host (§6). Decisions D-TASK018-01..04. |

Throwaway code. The spike adds **no bootstrap file and no migration**. The audit prototype is the SPK-08 one
(`prisma/tests/spikes/spk08/10-audit.sql` and `90-audit-ddl-guard.sql`, reused unchanged) plus
`prisma/tests/spikes/spk04/fixtures/20-spk04-audit-write.sql` (audit_stream_heads, data_subjects, audit_pii_vault and
`platform.audit_vault_guard()`; §5.7 statements verbatim). All of it is applied by the test superuser to a
Testcontainers database. The business table `spk04_orders` (fixtures/30) is created as `platform_migrator` with
ENABLE + FORCE RLS and the tenant policy template text. Runtime traffic is `platform_app` (NOSUPERUSER NOBYPASSRLS)
through the production DB factory and `withTenantTx`.

## 0. What was built

- `prisma/tests/spikes/spk04/server.ts`: a minimal `node:http` replica (no Express). Two processes on
  127.0.0.1:4101/4102, each with poolMax 10 and the tx options `statementTimeoutMs 5000, lockTimeoutMs 2000,
  idleInTransactionTimeoutMs 15000, poolConnectionTimeoutMs 5000`. The mode is chosen at process start
  (`SPK04_AUDIT=off|on|batched`). This switch exists only in the harness: the product measures "audit off" with the
  build-time `-bench` image (ADR-0007 item 4). Instrumentation per request covers server total, audit-phase time,
  lock-statement time and round-trip count, served on `GET /__stats` and `POST /__reset`.
- `canonical.ts` (exact RFC 8785 JCS, unit-tested with the RFC key-order and number examples), `chain.ts` (canonical
  object of all §5.1 columns except prev_hash/entry_hash/scope_org_id, µs timestamps, `entry_hash = SHA-256(JCS ‖
  prev_hash)`, pinned vector) and `verdict.ts` (pure decision logic, unit-tested at the 15/40 ms, 1 % and 10 %
  boundaries). Unit tests: 27 passing.
- `runner.ts`: DB setup, seed (100 orgs × 20 orders × 3 data subjects), host spec, the 2 × 3 arm loop (CHECKPOINT
  before each arm; 20 s discarded warm-up; 120 s measured), host CPU sampled every 1 s, `docker stats` of Postgres
  once mid-arm, post-run integrity checks, and the evidence files.
- `tests/load/spikes/spk04-audit.js`: the k6 script. constant-arrival-rate, tags `group:non_carrier`, `op:<name>`,
  `hot:<0|1>`; the NFR-PERF-001 thresholds are informational.

## 1. Method

| Item | Value |
|---|---|
| Op mix | create 35 % · update 20 % · detail 30 % · list 10 % · login_failed 5 % |
| Tenants | 100 orgs. Org 0 is HOT with 20 % of all traffic (60 rps at 300 rps, all on one tenant stream). The others are uniform. login_failed goes to 16 SYSTEM shard streams (hash(correlation_id) mod 16) |
| PII | create: 3 vault values; update: 1 (the old value is recorded as `[REDACTED]`, a simplification); random values with about 10 % repeats per org/field (the ON CONFLICT path) |
| Fail-closed reads | detail and list write their VIEW entry in a separate short `withTenantTx` after the read and before the response (§5.4 last paragraph) |
| Arms | `off`: business statements only. `on`: §5.4 exactly. `batched`: one multi-row vault INSERT…SELECT FROM unnest + one token SELECT; the lock as its own statement; head SELECT (create only if absent); entry INSERT + head UPDATE in one CTE statement |
| Schedule | per rate: 2 repetitions × [off, on, batched] in that order; warm-up 20 s (discarded) + 120 s measured |
| Latency source | k6 `http_req_duration` (client side, includes the host.docker.internal hop); server-side phase timings from `/__stats` |
| Pooling | pooled Δ = mean of the per-repetition Δ |

**Round trips per request** (BEGIN, the context statement and COMMIT count as 3 per transaction; measured, identical
in every run):

| Op | off | on | batched | under the stream lock (on / batched) |
|---|---|---|---|---|
| create (3 PII) | 4 | 15 | 9 | 5 / 3 |
| update (1 PII) | 5 | 12 | 10 | 5 / 3 |
| detail (VIEW, second tx) | 4 | 12 | 10 | 5 / 3 |
| list (VIEW, second tx) | 4 | 12 | 10 | 5 / 3 |
| login_failed (SYSTEM shard) | 4 | 9 | 7 | 5 / 3 |

"Under the lock" means the round trips after the lock is granted, up to and including COMMIT: `on` = head INSERT ON
CONFLICT, head SELECT, entry INSERT, head UPDATE, COMMIT. `batched` = head SELECT, CTE, COMMIT. `batched` adds 2 round
trips on the first write to a stream.

**Host limits.** k6 (container), both replicas, the runner and PostgreSQL (container) share one Windows laptop. Other
agents' workloads were running at the same time (host CPU was already 39–58 % busy at 50 rps in the smoke runs). The
replicas bind to 127.0.0.1; the k6 container reaches them through `host.docker.internal`, which Docker Desktop proxies
to host loopback (verified: 0 transport errors). The client → Postgres round trip on this host is about 1.1–1.7 ms p50
(SPK-03), so every statement under the lock costs about 1.5 ms of hold time. Absolute numbers are indicative; the A/B
deltas within one repetition are the measurement.

## 2. Results

### 2.1 300 rps (`20261113T034701Z_c037470`)

| rep | arm | p50 | p95 | p99 | Δp95 / Δp99 vs off | rps | dropped | errors | CPU mean | CPU > 85 % | audit phase p95 | hot-org lock wait p50 / p95 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | off | 12.2 | 2 001.6 | 2 028.3 | – | 291.3 | 2.90 % | 5.3 % | 65 % | 23 % | – | – |
| 1 | on | 2 012.4 | 3 985.8 | 4 206.8 | +1 984 / +2 178 | 235.2 | 20.2 % | 21.1 % | 75 % | 34 % | 2 040.6 | 258.9 / 602.7 |
| 1 | batched | 1 649.3 | 3 686.2 | 4 262.8 | +1 685 / +2 235 | 255.9 | 13.3 % | 15.5 % | 94 % | 84 % | 1 828.4 | 172.3 / 496.4 |
| 2 | off | 7.7 | 38.4 | 166.4 | – | 299.7 | 0.12 % | 0 % | 61 % | 17 % | – | – |
| 2 | on | 48.4 | 1 080.9 | 2 003.2 | +1 042 / +1 837 | 296.6 | 1.14 % | 0.7 % | 72 % | 27 % | 455.7 | 97.7 / 228.6 |
| 2 | batched | 17.8 | 255.3 | 584.9 | +217 / +419 | 299.1 | 0.31 % | 0 % | 68 % | 11 % | 119.5 | 4.3 / 167.6 |

All latencies are in ms. Every error was `DbError:SERVICE_UNAVAILABLE`, the Prisma pool-checkout `maxWait` of 2 s;
that is why so many values sit near 2 001 ms. Rep 1 was disturbed from its first arm on: `off` itself collapsed, so
rep 1 is noise-dominated. In rep 2, `off` sustained 300 rps (p95 38 ms) while the hot tenant in `on` queued on its
stream lock. The replica processes used about 0.26 cores each and Postgres about 0.5 cores (`docker stats` 54 %), so
neither the app tier nor the DB CPU was the limit: lock-hold time × the hot-stream rate was. Pooled: Δ on − off p95
+1 513 / p99 +2 008 ms; Δ batched − off p95 +951 / p99 +1 327 ms.

### 2.2 150 rps (`20261113T040201Z_c037470`)

| rep | arm | p50 | p95 | p99 | Δp95 / Δp99 vs off | rps | dropped | errors | CPU mean | CPU > 85 % | audit phase p95 | hot-org lock wait p50 / p95 / p99 | valid |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | off | 7.2 | 12.6 | 24.1 | – | 150.0 | 0 % | 0 % | 45 % | 0 % | – | – | yes |
| 1 | on | 16.8 | 34.7 | 83.4 | +22.1 / +59.4 | 150.0 | 0.01 % | 0 % | 53 % | 2 % | 21.8 | 0.8 / 11.0 / 56.2 | yes |
| 1 | batched | 21.9 | 2 830.7 | 3 754.0 | +2 818 / +3 730 | 142.6 | 4.92 % | 2.3 % | 69 % | 34 % | 1 315.5 | 1.1 / 537.8 / 761.0 | **no** |
| 2 | off | 7.2 | 30.0 | 192.8 | – | 149.8 | 0.17 % | 0 % | 45 % | 4 % | – | – | yes |
| 2 | on | 15.0 | 27.7 | 43.0 | −2.3 / −149.8 | 150.0 | 0 % | 0 % | 42 % | 1 % | 15.8 | 0.7 / 5.2 / 16.3 | yes |
| 2 | batched | 18.1 | 1 872.3 | 2 958.9 | +1 842 / +2 766 | 144.1 | 1.86 % | 1.0 % | 73 % | 25 % | 549.7 | 1.1 / 475.2 / 1 180.8 | **no** |

Per op, `on` rep 2 (k6 p95 / p99, ms): create 29.9 / 48.0, update 26.5 / 40.0, detail 26.8 / 41.3, list 26.4 / 39.4,
login_failed 26.0 / 36.4. Server audit phase p50 / p95, `on` rep 2: create 9.4 / 15.4, update 6.1 / 10.5, detail
9.2 / 20.2 (the whole second transaction), list 9.2 / 19.6, login_failed 4.3 / 7.1. Pooled Δ on − off: p95 +9.9,
p99 −45.2 ms (rep 2 `off` had a noisy tail, p99 192.8 ms). Hot-org pooled Δ on − off: p95 +13.4 ms.

Both `batched` arms at 150 rps were invalid: Postgres CPU was 95 % and 114 % in the mid-arm `docker stats`, against
62–67 % in the `on` arms. The audit phase p50 stayed at 8.8 ms while the tail exploded. This run cannot separate host
contention (batched is always the last arm, at the largest vault and entry counts) from a plan problem in the batched
statements, for example the multi-row token SELECT `JOIN unnest(…)` against the 100k–170k-row vault (§5.3, F-4).

**Max sustained rate observed (re-baselines A-029 on this host):** with audit `on`, 150 rps sustained cleanly (2/2
valid repetitions, 0 errors, ≤ 0.01 % dropped); 300 rps did not. `off` sustained 300 rps in 1 of 2 repetitions.

## 3. Integrity (both runs, as the superuser after all arms)

| Check | 300 rps | 150 rps |
|---|---|---|
| (a) Chains: seq gap-free from 1, prev_hash links, head = last entry, entry_hash recomputed for **every** entry, globally unique | PASS: 116 streams, 140 905 entries recomputed, 0 failures, hot org 28 125 entries | PASS: 116 streams, 82 213 entries, 0 failures, hot org 16 469 |
| (b) `platform_app` UPDATE/DELETE on audit_entries and audit_pii_vault | PASS: all four 42501 (`permission denied`) | PASS |
| (b′) Superuser UPDATE on audit_entries / DELETE on the vault (trigger layer) | PASS: 42501 `AUDIT_IMMUTABLE: UPDATE on audit_entries_2026_11` / `AUDIT_VAULT_IMMUTABLE: DELETE` | PASS |
| (c) Audit triggers enabled (6) and both DDL-guard event triggers enabled | PASS (`tgenabled = 'O'`, `evtenabled = 'O'`) | PASS |
| (d) `relforcerowsecurity` on audit_entries and spk04_orders | PASS | PASS |
| (e) Entries in the partition | PASS: all in `audit_entries_2026_11` | PASS |
| Vault rows | 173 806 | 99 365 |

Even under pool exhaustion and timeouts, no chain was forked, gapped or mis-hashed: the advisory lock, the
`entry_count = seq − 1` guard and the READ COMMITTED ordering held.

## 4. Verdict

- Validity rule: **INCONCLUSIVE** at 300 rps (all six arms invalid) and at 150 rps (both `batched` arms invalid).
- Exit question ("Δp95 ≤ 15 ms with the per-stream lock + vault inserts at 300 rps"): **not met**. In the
  least-disturbed 300 rps repetition, `on` added +1 042 ms p95 and `batched` +217 ms p95. The cause is structural and
  reproduces in both repetitions: the hot-org lock wait p95 was 229–603 ms against 5–11 ms at 150 rps.
- At 150 rps, `on` meets the budget pooled (Δp95 +9.9 ms, Δp99 −45.2 ms), but repetition 1 alone does not (+22.1 /
  +59.4 ms).
- Therefore: **FALLBACK** (specify the batched variant for TASK-030, §5.2) **and escalate to principal-architect**.
  Batched alone did not meet the budget at 60 rps per stream on this host, so it is FALLBACK-INSUFFICIENT for the
  300 rps target as measured.

## 5. Findings for consumers

1. **Lock-hold time is round trips × RTT; it is what caps a stream's rate (TASK-030, TASK-025).** With 5 round trips
   after the lock grant (`on`) at about 1.5 ms each, the hot stream queues at 60 rps. With 3 (`batched`) it queued less
   (hot lock wait p50 4.3 ms against 97.7 ms in rep 2 at 300 rps) but still did not meet the budget. Statement budget
   for the chain writer: **at most 3 round trips from the lock grant to COMMIT**, and nothing else under the lock.
2. **FALLBACK specification for TASK-030 (as measured).** (i) Before the lock: one multi-row
   `INSERT INTO audit_pii_vault … SELECT … FROM unnest($tokens::uuid[], $subjects::uuid[], $fields::text[],
   $hmacs::text[], $cts::text[]) ON CONFLICT (subject_id, entity_name, field, value_hmac) DO NOTHING`, then one
   multi-row token SELECT as a separate statement (a new snapshot is needed to see concurrent winners). Multi-argument
   `unnest(…)` must stay **unqualified**: `pg_catalog.unnest(a, b, …)` does not exist (42883). (ii) The lock as its
   own statement. (iii) Head SELECT; create the head only if absent (+2 round trips once per stream). (iv)
   `WITH appended AS (INSERT INTO audit_entries … ) UPDATE audit_stream_heads … WHERE stream_id = $ AND
   entry_count = $seq − 1`, asserting 1 row, with **no RETURNING** on the insert (RETURNING would apply the
   audit_entries SELECT policy to SYSTEM/anonymous rows). (v) COMMIT. Bind lists as arrays: `TenantDb` refuses
   `Prisma.join`/`Prisma.sql` fragments. Result: create 9, update 10, VIEW 10, SYSTEM 7 round trips.
3. **Pool coupling (TASK-025, TASK-016).** Lock waiters hold their pool connection while queued, so one hot stream
   exhausts the 10-connection pool and fails other tenants with `SERVICE_UNAVAILABLE` after the 2 s `maxWait`. That
   is a cross-tenant availability effect of R-ARCH-04, not only a latency effect.
4. **Plan check (TASK-030).** Before adopting the batched token SELECT, `EXPLAIN` it against a vault of ≥ 100k rows:
   the 150 rps batched arms showed Postgres CPU at 95–114 % with an unchanged median, which this spike could not
   attribute.
5. **Data-model §5.4 step 3 defect (TASK-021 / TASK-030).** `'\x' || repeat('00', 32)` is `text`. Inserting it into
   the bytea `head_hash` / `last_verified_hash` fails with **42804** (`column "head_hash" is of type bytea but
   expression is of type text`, recorded in `summary.json`). Use `decode(repeat('00', 32), 'hex')` (used by the
   harness) or `'\x0000…'::bytea`.
6. **SQL text (TASK-030).** `pg_catalog.extract(epoch FROM …)` is a syntax error. EXTRACT is keyword syntax, so the
   qualified form must be `pg_catalog.extract('epoch', …)` or stay unqualified. To get µs-exact timestamps out without
   Date's millisecond truncation, read `((extract(epoch FROM ts) * 1000000)::bigint)::text`.
7. **Store (TASK-021).** Integrity held under overload: no chain fault in 223 118 entries across both runs. The
   immutability layers (privileges, then row triggers) both answered 42501.

## 6. NFR / ADR implications for principal-architect

- **R-ARCH-04 is confirmed** on this host at 60 rps per stream. Design levers to evaluate (each one is an
  architecture decision, not taken here):
  (a) A row lock instead of the advisory lock: `SELECT … FROM audit_stream_heads WHERE stream_id = $ FOR UPDATE`.
  Under READ COMMITTED a FOR UPDATE that waited returns the latest committed row version, so lock + head read become
  1 round trip, leaving the CTE and COMMIT under the lock (2).
  (b) Sub-streams for hot tenants: shard a tenant stream like the 16 SYSTEM shards. This changes ADR-0007 chain
  semantics and verification.
  (c) A shorter lock wait than `lock_timeout 2000` for the audit lock, so queueing fails fast instead of draining the
  pool.
  (d) Re-measure on a native-Linux host, where RTT is a fraction of the 1.1–1.7 ms here: lock hold scales linearly with
  RTT.
- **NFR-AUDIT-005 measurement method:** define the delta per repetition, with pooling as the mean of repetitions (as
  here) or as per-repetition pass. Name the fail-closed VIEW second transaction as part of the overhead, and state the
  hot-stream share (20 % here) as part of the workload. Without a hot share the budget is far easier.
- **A-029 re-baseline:** this shared Windows/Docker Desktop host sustains the full mix with audit at 150 rps, not
  300 rps. A clean 300 rps A/B needs a quiet or dedicated host (the T-QA-06 lane-B `audit-ab` job).
- Condition proposal: before G3, re-run `audit-ab` with lever (a) and/or (d) and the hot share unchanged.

## 7. Reproduce

```bash
export PATH="$APPDATA/fnm/aliases/default:$PATH"
cd <repo>
# unit tests (no Docker)
node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js prisma/tests/spikes/spk04 --selectProjects unit
# full run (Docker Desktop; about 16 min per rate); evidence lands in docs/05-quality/performance/runs/<UTC>_<sha7>/
SPK04_RATE=300 npm exec --no -- tsx prisma/tests/spikes/spk04/runner.ts
SPK04_RATE=150 npm exec --no -- tsx prisma/tests/spikes/spk04/runner.ts
# smoke: SPK04_RATE=50 SPK04_WARMUP_S=5 SPK04_MEASURE_S=20 SPK04_REPS=1 SPK04_OUT=<scratch dir>
```

## 8. Throwaway / lifecycle

- **Stays as the lane-B `audit-ab` seed (T-QA-06):** `tests/load/spikes/spk04-audit.js` (moves to
  `tests/load/audit-ab.js` when T-QA-06 lands), the `eslint.config.mjs` k6 block, `verdict.ts` (+ test) and the
  runner's arm loop, CPU sampler and evidence writer.
- **Deleted when TASK-030 lands:** `canonical.ts` (replaced by `canonicalize` in packages/audit), `chain.ts` (replaced
  by the packages/audit hasher, which must reproduce the pinned vector in `chain.test.ts` or document the difference),
  `server.ts` audit modes (replaced by the real writer behind the `-bench` image), and
  `fixtures/20-spk04-audit-write.sql` (replaced by TASK-021's bootstrap audit DDL, together with SPK-08's
  `spk08/10-audit.sql` and `90-audit-ddl-guard.sql`).
- `fixtures/30-spk04-business.sql` goes with the server when lane B switches to a real product route.
