# SPK-04: Audit write throughput, 300 rps mixed, audit on/off

| Field | Value |
|---|---|
| Task | TASK-018 (Wave 0) · branch `feat/TASK-018-spk-04-spike-audit-write` · harness commit that produced the evidence: `c037470` (the harness has since been repointed to the real bootstrap lane, §0 and §8; findings and numbers are unchanged, fix cycle 1 is text and tripwire only, no re-run) |
| Risk | R-ARCH-04 (per-stream advisory lock + vault inserts on the request path; one hot tenant serialising on one stream) |
| NFR / requirements | NFR-AUDIT-005 (audit overhead ≤ 15 ms p95 and ≤ 40 ms p99 vs the same route with audit disabled); NFR-PERF-001 context (p95 ≤ 300 ms at 300 rps); data-model.md §5.4 (chaining procedure), §5.7 (vault DDL); ADR-0007 item 4 (build-time `-bench` image) |
| Date / host | 2026-11-13 · Windows 11 Pro 10.0.26300, Intel i9-11950H (16 logical CPUs), 32 GB RAM (free at start: 6.2 GiB for the 300 rps run, 3.7 GiB for the 150 rps run: itself a contention indicator), Node v24.22.3, Docker Desktop 29.8.0 (WSL2 VM: 16 CPUs, 15.5 GiB) **shared with other agents' workloads** · `postgres:18` = PostgreSQL 18.6 (`sha256:e3d24f69…3c42`, the harness pin, default server settings: shared_buffers 128 MB, max_connections 100, fsync and synchronous_commit on) · k6 v2.2.0 `grafana/k6@sha256:5221b620a4f874faff6e32ba597aa667c058391fe4898b1c6f6377f062c6cdec` · Prisma 7 + `@prisma/adapter-pg` through `createDatabaseRuntime` / `withTenantTx` |
| Owner | performance-engineer |
| Evidence | `docs/05-quality/performance/spikes/SPK-04/20261113T034701Z_c037470/` (300 rps) and `docs/05-quality/performance/spikes/SPK-04/20261113T040201Z_c037470/` (150 rps): `host-spec.json`, `k6-audit-ab.summary.json`, `summary.json`, `summary.md` |
| **Verdict** | **Exit NOT DEMONSTRATED: INCONCLUSIVE under TEST-STRATEGY §7.10 at 300 rps (0 of 6 arms valid) and at 150 rps (the 2 `batched` arms invalid).** This is the only verdict of the spike. (The sheet allows GO / FALLBACK, the verdict tool also computes FALLBACK-INSUFFICIENT and INCONCLUSIVE; none of GO, FALLBACK or FALLBACK-INSUFFICIENT is claimed, because every one of them requires valid arms.) **Direction, not proof:** with one hot tenant at 60 rps on one stream, the §5.4 procedure (`on`) queued on the stream lock in the least-disturbed 300 rps repetition (rep 2: hot-org lock wait p50 97.7 ms / p95 228.6 ms; Δp95 on − off +1 042 ms, but the `on` arm of that repetition is itself invalid: 1.14 % dropped, 26.7 % busy samples); the waiting transactions hold pool connections, so checkout timed out (`SERVICE_UNAVAILABLE`, the 2 s `maxWait`) for other tenants too. Repetition 1 (all arms invalid, `off` itself collapsed) is evidence of host disturbance only. **R-ARCH-04 is not retired and not confirmed as a quantified limit.** The `batched` variant cannot be ranked: the same arm configuration at 150 rps (half the rate) collapsed to p95 1.9 to 2.8 s while at 300 rps rep 2 it gave p95 255 ms, a spread that lock queueing alone does not explain (§2.2, §5.4). At 150 rps (hot stream 30 rps) both `on` repetitions are valid but the budget is also **not demonstrated**: Δp95 +22.1 / −2.3 ms, Δp99 +59.4 / −149.8 ms; repetition 1, the one with a clean baseline, fails both budgets, and n = 2 cannot resolve a 15 ms budget on this host (§2.2). **Routed, not decided here:** the levers of §6 go to principal-architect as inputs (recorded in ADR-0007 amendment 10, D-ARCH-085..090); the clean 300 rps proof is TASK-280's (T-QA-06 `audit-ab`, before G3). Decisions D-TASK018-01..05 (evidence location: D-TASK018-05). |

Executable evidence under a lifecycle (D-ARCH-089, §8). The spike adds **no bootstrap file and no migration**.

**What the recorded runs (`c037470`) ran on.** The audit store was the SPK-08 **prototype**
(`prisma/tests/spikes/spk08/10-audit.sql` and `90-audit-ddl-guard.sql`, unchanged) plus a private fixture
`fixtures/20-spk04-audit-write.sql` (audit_stream_heads, data_subjects, audit_pii_vault and
`platform.audit_vault_guard()`; §5.7 statements verbatim), applied by the test superuser to a Testcontainers database.
Prototype simplifications that differ from the design (code review R1-m2): `audit_entries` had ENABLE + FORCE row-level
security with placeholder policies, but the design has **no RLS** on `audit_entries` (SYSTEM, ADR-0005; data-model §5.2,
PR12-SEC-08: the policies are not ported); the three fixture tables had no RLS; the triggers were origin-mode (`'O'`),
the design uses ENABLE ALWAYS (`'A'`). The bias of the RLS difference is small and pessimistic for `on` / `batched`
(policy evaluation per insert). The business table `spk04_orders` (fixtures/30) is created as `platform_migrator` with
ENABLE + FORCE RLS and the tenant policy template text. Runtime traffic is `platform_app` (NOSUPERUSER NOBYPASSRLS)
through the production DB factory and `withTenantTx`.

**What the harness runs on now (fix cycle 1, D-ORCH-033).** PR #24 (TASK-021) merged the real audit store and deleted the
SPK-08 prototype files, so `runner.ts` applies the real `prisma/bootstrap` lane (00..02, `10-audit.sql`,
`90-audit-ddl-guard.sql`) and fixture 20 is deleted. No benchmark was re-run: the numbers below are from the prototype
and stand as recorded. The harness was only smoke-run against the real lane (§7).

## 0. What was built

- `prisma/tests/spikes/spk04/server.ts`: a minimal `node:http` replica (no Express). Two processes on
  127.0.0.1:4101/4102, each with poolMax 10 and the tx options `statementTimeoutMs 5000, lockTimeoutMs 2000,
  idleInTransactionTimeoutMs 15000, poolConnectionTimeoutMs 5000`. The mode is chosen at process start
  (`SPK04_AUDIT=off|on|batched`). This switch exists only in the harness: the product measures "audit off" with the
  build-time `-bench` image (ADR-0007 item 4). Instrumentation per request covers server total, audit-phase time,
  lock-statement time and round-trip count, served on `GET /__stats` and `POST /__reset`.
- `canonical.ts` (RFC 8785 JCS, exact for well-formed strings: a lone surrogate is accepted here and rejected by the
  `canonicalize` package; unit-tested with the RFC key-order and number examples), `chain.ts` (canonical object of all
  §5.1 columns except prev_hash/entry_hash/scope_org_id, µs timestamps, `entry_hash = SHA-256(JCS ‖ prev_hash)`, pinned
  vector) and `verdict.ts` (pure decision logic, unit-tested at the 15/40 ms, 1 % and 10 % boundaries; fix cycle 1 adds
  the fail-closed `integrityFailures` / `finalVerdict`). `paths.ts` + `paths.test.ts` (fix cycle 1): the tripwire, see §8.
- `runner.ts`: DB setup (real bootstrap lane, migrations, fixture 30), seed (100 orgs × 20 orders × 3 data subjects),
  host spec, the 2 × 3 arm loop (CHECKPOINT before each arm; 20 s discarded warm-up; 120 s measured), host CPU sampled
  every 1 s, `docker stats` of Postgres once mid-arm, post-run integrity checks (fail closed: a throwing or failing
  check gives verdict `INTEGRITY_FAILED` and exit code 1), and the evidence files.
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
| Pooling | pooled Δ = mean of the per-repetition Δ, with n = 2 repetitions in the fixed order off, on, batched. This cannot resolve a 15 ms budget on this host (§2.2) and is **not** a method to adopt (§6) |

**Round trips per request** (BEGIN, the context statement and COMMIT count as 3 per transaction; **counted by the
harness's own instrumentation** (a hand-placed counter in `server.ts`), identical in every run, and equal to the
statement list by construction, e.g. create `on` = 3 + 1 + 3 × 2 + 1 + 1 + 1 + 2 = 15. They were not taken from the wire
or from `pg_stat_statements`; TASK-280 should):

| Op | off | on | batched | under the stream lock (on / batched) |
|---|---|---|---|---|
| create (3 PII) | 4 | 15 | 9 | 5 / 3 |
| update (1 PII) | 5 | 12 | 10 | 5 / 3 |
| detail (VIEW, second tx) | 4 | 12 | 10 | 5 / 3 |
| list (VIEW, second tx) | 4 | 12 | 10 | 5 / 3 |
| login_failed (SYSTEM shard) | 4 | 9 | 7 | 5 / 3 |

"Under the lock" means the statements after the lock is granted, up to and including COMMIT (counted, not timed): `on` = head INSERT ON
CONFLICT, head SELECT, entry INSERT, head UPDATE, COMMIT. `batched` = head SELECT, CTE, COMMIT. `batched` adds 2 round
trips on the first write to a stream.

**Host limits.** k6 (container), both replicas, the runner and PostgreSQL (container) share one Windows laptop. Other
agents' workloads were running at the same time (host CPU was already 39–58 % busy at 50 rps in the smoke runs). The
replicas bind to 127.0.0.1; the k6 container reaches them through `host.docker.internal`, which Docker Desktop proxies
to host loopback (verified: 0 transport errors). The client → Postgres round trip on this host is about 1.1–1.7 ms p50
(SPK-03), which suggests about 1.5 ms of hold time per statement under the lock; that is a hypothesis (§5.1), the
harness never measures hold time. Absolute numbers are indicative only, and with n = 2 and a disturbed host the A/B
deltas within a repetition are not a precise measurement either (§2.2).

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
that is why so many values sit near 2 001 ms. **All six arms are invalid** (10 invalidity reasons: dropped iterations
above 1 % in 4 arms, host CPU above 85 % in more than 10 % of samples in all 6). Rep 1 was disturbed from its first arm
on: `off` itself collapsed (p95 2 001 ms, 5.3 % errors), so rep 1 is evidence of host disturbance only. Rep 2 is the
only repetition with a usable `off` baseline (p95 38 ms, sustained 300 rps), but its `off` arm is also invalid by
host CPU (16.7 % of samples above 85 %) and its `on` arm is invalid (1.14 % dropped, 26.7 % busy samples); its
`batched` arm is invalid by 0.8 percentage points of busy samples (10.8 % against the 10 % limit). In rep 2 the hot
tenant in `on` queued on its stream lock. **CPU, as recorded** (`docker stats` of the Postgres container, one
mid-arm sample, percent of one core): rep 1 off 54 %, on 144 %, batched 195 %; rep 2 off 43 %, on 134 %, batched 106 %.
There is no per-process CPU series for the replicas in any artefact, so the CPU headroom of the app tier is **not
established**, and Postgres at about 1.3 to 1.4 cores in the `on` arms (144 % and 134 %; the 195 % figure is rep 1 `batched`) cannot be ruled out as a contributor on a shared
laptop. Lock-hold time × the hot-stream rate is the working explanation (hypothesis, §5.1), not a measured cause.
Pooled over two repetitions that include the collapsed one: Δ on − off p95 +1 513 / p99 +2 008 ms; Δ batched − off p95
+951 / p99 +1 327 ms (descriptive only).

### 2.2 150 rps (`20261113T040201Z_c037470`)

| rep | arm | p50 | p95 | p99 | Δp95 / Δp99 vs off | rps | dropped | errors | CPU mean | CPU > 85 % | audit phase p95 | hot-org lock wait p50 / p95 / p99 | valid |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | off | 7.2 | 12.6 | 24.1 | – | 150.0 | 0 % | 0 % | 45 % | 0 % | – | – | yes |
| 1 | on | 16.8 | 34.7 | 83.4 | +22.1 / +59.4 | 150.0 | 0.01 % | 0 % | 53 % | 2 % | 21.8 | 0.8 / 11.0 / 56.2 | yes |
| 1 | batched | 21.9 | 2 830.7 | 3 754.0 | +2 818 / +3 730 | 142.6 | 4.92 % | 2.3 % | 69 % | 34 % | 1 315.5 | 1.1 / 537.8 / 761.0 | **no** |
| 2 | off | 7.2 | 30.0 | 192.8 | – | 149.8 | 0.17 % | 0 % | 45 % | 4 % | – | – | yes |
| 2 | on | 15.0 | 27.7 | 43.0 | −2.3 / −149.8 | 150.0 | 0 % | 0 % | 42 % | 1 % | 15.8 | 0.7 / 5.2 / 16.3 | yes |
| 2 | batched | 18.1 | 1 872.3 | 2 958.9 | +1 842 / +2 766 | 144.1 | 1.86 % | 1.0 % | 73 % | 25 % | 549.7 | 1.1 / 475.2 / 1 180.8 | **no** |

**Statistics caveat (R1-m1).** n = 2 repetitions, mean of two deltas, fixed order off, on, batched. The `off` baseline
p95 moved from 12.6 to 30.0 ms between the repetitions (17 ms, more than the 15 ms budget); rep 2 `off` ran right after
an invalid `batched` arm and has a 192.8 ms p99 tail, which flatters `on` (Δ −2.3 / −149.8). The pooled +9.9 / −45.2 ms
is therefore an artefact of one noisy baseline. The repetition with the clean baseline (rep 1: +22.1 / +59.4 ms)
**fails** both budgets. **At 150 rps the budget is also not demonstrated.**

Per op, `on` rep 2 (k6 p95 / p99, ms): create 29.9 / 48.0, update 26.5 / 40.0, detail 26.8 / 41.3, list 26.4 / 39.4,
login_failed 26.0 / 36.4. Server audit phase p50 / p95, `on` rep 2: create 9.4 / 15.4, update 6.1 / 10.5, detail
9.2 / 20.2 (the whole second transaction), list 9.2 / 19.6, login_failed 4.3 / 7.1. Pooled Δ on − off: p95 +9.9,
p99 −45.2 ms (rep 2 `off` had a noisy tail, p99 192.8 ms). Hot-org pooled Δ on − off: p95 +13.4 ms.

Both `batched` arms at 150 rps were invalid (4.92 % and 1.86 % dropped; host CPU above 85 % in 33.6 % and 25.2 % of
samples). Postgres CPU in the mid-arm `docker stats` was 67 % (rep 1) and 114 % (rep 2) for `batched`, against 95 %
and 62 % for `on`. The audit phase p50 stayed at 8.8 ms while the tail exploded. This run cannot separate host
contention (batched is always the last arm, at the largest vault and entry counts) from a plan problem in the batched
statements, for example the multi-row token SELECT `JOIN unnest(…)` against the 100k–170k-row vault (§5.4, F-4).

**Max sustained rate observed (indicative for A-029 on this host, not a re-baseline):** with audit `on`, 150 rps was
sustained in 2 of 2 valid repetitions (0 errors, ≤ 0.01 % dropped); 300 rps was not demonstrated. `off` sustained 300
rps in 1 of 2 repetitions (and that arm is itself invalid by host CPU).

## 3. Integrity (both runs, as the superuser after all arms; **on the SPK-08 prototype store**)

These results say the *prototype* held under overload and that the chain procedure is sound. They prove no property of
the product store (O4 evidence stays with TASK-033 and catalog C14; PR27-SEC-02).

| Check | 300 rps | 150 rps |
|---|---|---|
| (a) Chains: seq gap-free from 1, prev_hash links, head = last entry, entry_hash recomputed for **every** entry, globally unique | PASS: 116 streams, 140 905 entries recomputed, 0 failures, hot org 28 125 entries | PASS: 116 streams, 82 213 entries, 0 failures, hot org 16 469 |
| (b) `platform_app` UPDATE/DELETE on audit_entries and audit_pii_vault | PASS: all four 42501 (`permission denied`) | PASS |
| (b′) Superuser UPDATE on audit_entries / DELETE on the vault (trigger layer; two of the four superuser legs, the runner now also probes DELETE on entries and UPDATE on the vault; TRUNCATE is TASK-033's) | PASS: 42501 `AUDIT_IMMUTABLE: UPDATE on audit_entries_2026_11` / `AUDIT_VAULT_IMMUTABLE: DELETE` | PASS |
| (c) Audit triggers enabled (6) and both DDL-guard event triggers enabled | PASS **for the prototype** (`tgenabled = 'O'`, `evtenabled = 'O'`). The product creates them ENABLE ALWAYS (`'A'`, D-ARCH-076); the runner now asserts `'A'` | PASS (same) |
| (d) `relforcerowsecurity` on audit_entries and spk04_orders | PASS **for the prototype**, which had RLS on audit_entries. The design has **no RLS** on audit_entries (SYSTEM, ADR-0005); the runner now asserts none there and ENABLE + FORCE on spk04_orders | PASS (same) |
| (e) Entries in the partition | PASS: all in `audit_entries_2026_11` | PASS |
| Vault rows | 173 806 | 99 365 |

Even under pool exhaustion and timeouts, no chain was forked, gapped or mis-hashed: the advisory lock, the
`entry_count = seq − 1` guard and the READ COMMITTED ordering held.

## 4. Verdict

One vocabulary (the verdict tool's, which extends the sheet's GO / FALLBACK): **exit NOT DEMONSTRATED: INCONCLUSIVE.**

- Validity rule: **INCONCLUSIVE** at 300 rps (0 of 6 arms valid) and at 150 rps (both `batched` arms invalid). Rep 1 at
  300 rps is evidence of host disturbance only (`off` itself collapsed).
- Exit question ("Δp95 ≤ 15 ms with the per-stream lock + vault inserts at 300 rps"): **not demonstrated**. In the
  least-disturbed 300 rps repetition (rep 2, whose `on` arm is itself invalid), `on` added +1 042 ms p95 and `batched`
  +217 ms p95. Direction: a hot stream at 60 rps queued (hot-org lock wait p95 229 ms in rep 2, 603 ms in rep 1) against
  5–11 ms at 150 rps. Whether the cause is lock-hold time, host CPU contention or a WAL flush floor is **not
  established** (§5.1).
- At 150 rps the budget is also **not demonstrated**: pooled +9.9 / −45.2 ms is inside it, but the clean-baseline
  repetition (rep 1: +22.1 / +59.4 ms) fails it, and n = 2 cannot resolve 15 ms here (§2.2).
- `batched` **cannot be ranked**: 150 rps collapsed (p95 1.9 to 2.8 s, hot-lock p95 475–538 ms) while 300 rps rep 2 did
  not (p95 255 ms, hot-lock p95 168 ms). A 10× spread between identical configurations at different rates means
  something other than lock queueing varies between arms (arm order, vault size, host load).
- Consequence: **R-ARCH-04 is not retired.** The design levers of §6 are inputs for principal-architect (taken up in
  ADR-0007 amendment 10, D-ARCH-085..090); the clean 300 rps proof is TASK-280's, before G3. This spike is not O2 evidence.

## 5. Findings for consumers

1. **Hypothesis, not a measurement: lock-hold time ≈ round trips × RTT, and it caps a stream's rate (TASK-030,
   TASK-025).** The model: 5 statements after the lock grant (`on`) at about 1.5 ms is 7.5 ms of hold, so a 60 rps
   stream has utilisation ρ ≈ 0.45 and an M/D/1 mean wait of about 3 ms. The measured hot-org lock wait p50 at 300 rps was
   97.7 ms (p95 228.6), which would need a hold of about 15 ms, about twice the model, while at 150 rps (30 rps on the
   stream) wait p50 0.7 ms / p95 5.2 ms fits about 7.5 ms. The implied hold roughly doubled between the two rates. Host
   CPU contention (72 % mean, 27 % of samples above 85 % at 300 rps against 42–53 % at 150 rps) is one candidate and is
   exactly the confounder §7.10 exists to exclude; a COMMIT / WAL-flush floor that batching cannot shrink is another.
   The harness never measures hold time (`lockMs` is the lock statement including the wait). A statement budget of "at
   most 3 round trips from the lock grant to COMMIT" is therefore **a hypothesis to test**, not a measured spec, and the
   ADR-0007 amendment 10 budget (row lock, at most 2 round trips under it) stands on the same footing until TASK-280
   measures grant-to-COMMIT hold time per request and the WAL-flush share.
2. **FALLBACK specification for TASK-030 (as measured).** (i) Before the lock: one multi-row
   `INSERT INTO audit_pii_vault … SELECT … FROM unnest($tokens::uuid[], $subjects::uuid[], $fields::text[],
   $hmacs::text[], $cts::text[]) ON CONFLICT (subject_id, entity_name, field, value_hmac) DO NOTHING`, then one
   multi-row token SELECT as a separate statement (a new snapshot is needed to see concurrent winners). Multi-argument
   `unnest(…)` must stay **unqualified**: `pg_catalog.unnest(a, b, …)` does not exist (42883). (ii) The lock as its
   own statement. (iii) Head SELECT; create the head only if absent (+2 round trips once per stream). (iv)
   `WITH appended AS (INSERT INTO audit_entries … ) UPDATE audit_stream_heads … WHERE stream_id = $ AND
   entry_count = $seq − 1`, asserting 1 row. (RETURNING on the insert is simply not needed. The earlier advice "no
   RETURNING because it would apply the audit_entries SELECT policy" was specific to the SPK-08 prototype, which had
   RLS on audit_entries; the design has none.) (v) COMMIT. Bind lists as arrays: `TenantDb` refuses
   `Prisma.join`/`Prisma.sql` fragments. Result: create 9, update 10, VIEW 10, SYSTEM 7 round trips.
3. **Pool coupling (TASK-025, TASK-016).** Lock waiters hold their pool connection while queued, so one hot stream
   exhausts the 10-connection pool and fails other tenants with `SERVICE_UNAVAILABLE` after the 2 s `maxWait`. That
   is a cross-tenant availability effect of R-ARCH-04, not only a latency effect.
4. **Plan check, a precondition for adopting `batched` (TASK-030, TASK-280).** `EXPLAIN` the batched token SELECT
   against a vault of ≥ 100k rows first: the two 150 rps `batched` arms were invalid with Postgres CPU of 67 % and 114 %
   (`docker stats`) and an unchanged median, which this spike could not attribute. Until then `batched` is a
   candidate that cannot be ranked (§4).
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

- **R-ARCH-04 is not retired, and not confirmed as a quantified limit** (exit NOT DEMONSTRATED: INCONCLUSIVE, §4); the
  direction is a hot stream queueing at 60 rps on this host. Design levers to evaluate (each one is an architecture
  decision, not taken here):
  (a) A row lock instead of the advisory lock: `SELECT … FROM audit_stream_heads WHERE stream_id = $ FOR UPDATE`.
  Under READ COMMITTED a FOR UPDATE that waited returns the latest committed row version, so lock + head read become
  1 round trip, leaving the CTE and COMMIT under the lock (2).
  (b) Sub-streams for hot tenants: shard a tenant stream like the 16 SYSTEM shards. This changes ADR-0007 chain
  semantics and verification.
  (c) A shorter lock wait than `lock_timeout 2000` for the audit lock, so queueing fails fast instead of draining the
  pool.
  (d) Re-measure on a native-Linux host, where RTT is a fraction of the 1.1–1.7 ms here: lock hold scales linearly with
  RTT.
- **NFR-AUDIT-005 measurement method (R1-m1):** mean-of-2 pooling is not adequate (this spike's own baseline moved
  17 ms between repetitions). Use at least 5 repetitions, an ABBA or Latin-square arm order, database state reset or
  reused identically per arm, report the **median delta and the range**, and require a **per-repetition** pass. Name the
  fail-closed VIEW second transaction as part of the overhead, and state the hot-stream share (20 % here) as part of the
  workload. Without a hot share the budget is far easier. (TEST-STRATEGY §7.10 / D-ARCH-088 already carry the randomised order and the per-repetition rule; the repetition count of at least 5 is this review's ask for TASK-280.)
- **A-029:** indicative only: on this shared Windows/Docker Desktop host, audit `on` sustained the full mix at 150 rps
  in 2 of 2 valid repetitions, and 300 rps was not demonstrated. A clean 300 rps A/B needs a quiet or dedicated host
  (the T-QA-06 lane-B `audit-ab` job).
- **TASK-280 re-run scope** (in addition to the above): measure grant-to-COMMIT hold time per request and the WAL-flush
  share; take round trips from `pg_stat_statements` or the driver (they were counted by the harness here); randomise
  the arm order; run the `EXPLAIN` of §5.4 before ranking `batched`.
- Condition proposal: before G3, re-run `audit-ab` with lever (a) and/or (d) and the hot share unchanged.

## 7. Reproduce

```bash
export PATH="$APPDATA/fnm/aliases/default:$PATH"
cd <repo>
# unit tests (no Docker): chain, canonical, verdict and the path tripwire
node --experimental-vm-modules --disable-warning=ExperimentalWarning node_modules/jest/bin/jest.js prisma/tests/spikes/spk04 --selectProjects unit
# full run (Docker Desktop; about 16 min per rate); evidence lands in docs/05-quality/performance/spikes/SPK-04/<UTC>_<sha7>/
SPK04_RATE=300 npm exec --no -- tsx prisma/tests/spikes/spk04/runner.ts
SPK04_RATE=150 npm exec --no -- tsx prisma/tests/spikes/spk04/runner.ts
# smoke: SPK04_RATE=50 SPK04_WARMUP_S=5 SPK04_MEASURE_S=20 SPK04_REPS=1 SPK04_OUT=<scratch dir>
```

Run the full benchmark under the host Docker lock. The recorded runs used the harness at `c037470` (SPK-08 prototype
store); the harness on `main` applies the real bootstrap lane, so a re-run is not byte-comparable to the recorded
numbers. `summary.json` of the 150 rps run says `"dirty": true`: the working tree held the 300 rps run's untracked
evidence directory (the harness diff between `c037470` and the PR head before the fix cycle is two comment lines).

**Fix cycle 1 smoke (no benchmark re-run; not evidence of any performance property).** One run of the runner against the
real bootstrap lane under the host Docker lock: 20 rps, 3 s warm-up, 8 s measured, 1 repetition, all three arms, output
outside the repository. Result: setup, seed, the arm loop and the integrity step ran end to end; 0 request errors in
all arms; 443 entries in 112 streams recomputed, 0 chain faults; 523 vault rows; all eight immutability legs answered
42501 (the superuser trigger legs need rows, so the runner now fails an empty vault or an empty entry table as
vacuous); product trigger state `ENABLE ALWAYS` and no RLS on `audit_entries` read back; exit code 0. The first smoke
found a real incompatibility that no static check could: the real vault constrains key ids to `^[a-z][a-z0-9-]*-v[0-9]+$`
(the prototype did not), so `server.ts` key ids `spk04-r0-k1` failed 48 to 61 % of the audit writes with
`INTERNAL_ERROR` and the new fail-closed integrity step reported `INTEGRITY_FAILED` (immutability legs vacuous on an
empty vault). `server.ts` now uses `spk04-<replica>-v1`. The recorded runs are unaffected (they ran on the prototype).

## 8. Lifecycle (D-ARCH-089, D-ORCH-033): executable evidence with a named deleting PR per file

Everything lives only under `prisma/tests/spikes/spk04/**` and `tests/load/spikes/**`; nothing outside those two trees
and the `eslint.config.mjs` k6 block (stays, 3 of 49 probed paths differ, 0 rules: PR #27 security record), no file
under `apps/**` or `packages/**` imports either tree, neither tree counts toward coverage or ships in any image
(PR27-SEC-01, TASK-014), and the `SPK04_AUDIT=off|on|batched` switch exists only in `server.ts` (ADR-0007 amendment 4: the
product has no runtime audit-off). Evidence stays under `docs/05-quality/performance/spikes/SPK-04/`, never `runs/`.

| File | Deleted by | After |
|---|---|---|
| `canonical.ts`, `canonical.test.ts` | **TASK-030** | `canonicalize` is used in `packages/audit` |
| `chain.ts`, `chain.test.ts` | **TASK-030** | the pinned entry-hash vector of `chain.test.ts` is reproduced in a `packages/audit/test/chain` unit test, or the difference is documented |
| `server.ts`, `runner.ts`, `verdict.ts`, `verdict.test.ts`, `paths.ts`, `paths.test.ts`, `fixtures/30-spk04-business.sql`, `tests/load/spikes/spk04-audit.js` | **TASK-280** | the arm loop, CPU sampler, verdict, evidence writer and integrity step are ported to `tests/load/lib` and the script to `tests/load/audit-ab.js` (T-QA-06), against the product `-bench` image and a real product route |

`fixtures/20-spk04-audit-write.sql` and the SPK-08 prototype SQL are **already gone**: PR #24 (TASK-021) deleted the
prototype and the real `prisma/bootstrap/10-audit.sql` owns `audit_stream_heads`, `data_subjects` and `audit_pii_vault`.

**Tripwire.** `paths.test.ts` (unit lane) fails when any path the runner reads is moved or deleted (bootstrap lane,
migrations, fixture 30, `server.ts`, the k6 script, the Postgres harness, the API runtime), when the real
`10-audit.sql` stops creating the tables the harness uses, and when product code under `apps/**` or `packages/**`
references the harness. The runner is otherwise not executed by any CI lane.

**TASK-280 inherits** (PR27-SEC-02..04, code review R1): the integrity step asserts the product state (no
`audit_entries` RLS, `tgenabled = 'A'`, `evtenabled = 'A'`, the four superuser legs plus TRUNCATE) and fails closed;
container flags for the k6 run; the `SPK04_BIND` override and the whole-environment pass-through to the replicas
removed; randomised arm order; at least 5 repetitions; hold time and `pg_stat_statements` round trips (§6).
