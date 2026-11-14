# PR-0042 / TASK-025: audit writer core, per-tenant admission bulkhead and audit lock timeout (round 1)

| Field | Value |
|---|---|
| PR | #42 `feat(audit): audit writer core, admission bulkhead and audit lock timeout (TASK-025)`, https://github.com/sukhchdit/shipcube/pull/42, branch `feat/TASK-025-audit-writer-core`. Six commits on merge base `2dd6958`: `9323b19` (error model), `6865f64` (writer core), `8d8d9b3` (suites), `6d60703` (bulkhead and config keys), `ab8fea1` (comment hygiene) and the evidence commit `e7dfbac`. No merge of `main`. `main` has since moved to `a0e9888`, with `docs/` and `.claude/agent-memory/` changes only. Those include this PR's code review record (`474a827`, CHANGES_REQUESTED; §6) |
| Head | e7dfbac4e5117de03ff1d6bf424c0755d5982d6a |
| Lane A evidence | Run [43549201001](https://github.com/sukhchdit/shipcube/actions/runs/43549201001) on `e7dfbac`. `fast-lane` **success**, with every step executed: base-ref gates, workflow policy, install flags, migration immutability, lockfile provenance and delta, cooldown, `npm ci --ignore-scripts`, licences, registry signatures, audit + osv, lane-B `check-evidence`, `deps:rebuild`, commitlint, lint, the lint-mutation check, format, actionlint, type-check, unit, base-ref negative fixtures, build and the build-mutation check. In `scans`, Gitleaks, Semgrep and oasdiff are green. Only "Security-owned paths need a review record" failed, which also failed `ci-gate`. This file is that record |
| Lane B evidence | `docs/05-quality/tests/runs/20261114T0246Z_ab8fea1`, profile `pr`, verdict PASS: api 127, catalog-c1-c14 74, integration 279 (1 skip, the parked SEC-TC-43 case), unit 4552 (2 skip). `git_sha` is `ab8fea1`, the parent of `e7dfbac`, and `e7dfbac` adds only the 7 evidence files. `lockfile_sha256` equals the SHA-256 of the head's `package-lock.json` (recomputed). `packages/audit` is measured at lines 1267/1267 and branches 391/395 (7 files); `tenant-admission.ts` at lines 232/233 and branches 39/40 |
| Owned paths changed | 31 (real checker, §9): `packages/audit/**` (16), `apps/api/src/platform/db/**` (9), `apps/api/src/platform/audit/**` (1), `prisma/tests/audit/**` (1), and one each of `eslint.config.mjs`, `package-lock.json`, `prisma/package.json` and `tools/tsconfig.json`. **Not owned** (a change to them keeps this record valid; see PR42-SEC-08): `packages/config/src/{schema,guards,index,load-config.test,values.test}.ts`, `packages/shared/src/errors/catalogue/{audit,index}.ts`, `.env.example` and the 7 evidence files |
| Reviewer / date | security-analyst, 2026-11-14, round 1. Read-only on code. Git ran in the main checkout against commit SHAs, plus one sparse `git clone --shared` in scratch that is checked out only at simulated commits. Probes ran on two `git archive` extracts (head `e7dfbac` and `main`) in scratch, each with a `node_modules` built from junctions to the main checkout's entries and `@platform/*` pointed at the extract: ESLint `lintText` with the extract's real `eslint.config.mjs` (in memory, nothing written), and type-stripped head sources under a resolve/load hook. No command, install, build or Docker run in the PR worktree; its only change is this file. `.env.example` was not opened: the tool policy refuses `.env*` paths. Its 7 added lines are covered by the lane A Gitleaks pass and by the schema review in §5.4 (three non-secret integer keys) |

## 1. Summary

TASK-025 implements ADR-0007 amendment 10 items 1 to 3 (D-ARCH-085..087) as written, and the security-relevant claims hold under probing.

- **Integrity.** The canonical object covers all 35 hashed columns (every column except `prev_hash`, `entry_hash` and the generated `scope_org_id`). JSONB, `inet`, `bytea` and timestamps are hashed in the form PostgreSQL returns, and the integration suite recomputes each stored hash from the database representation. The head-row `FOR UPDATE` serialises a stream, and a concurrent rollback leaves the sequence dense (AT-US-088-08). UPDATE and DELETE are refused for `platform_app` (42501) and for the superuser (`AUDIT_IMMUTABLE:`). The bootstrap DDL is unchanged.
- **SYSTEM shard.** The SYSTEM shard key comes from a server-side `crypto.randomInt(16)`. With a fixed correlation ID, 400 writes hit all 16 shards (probe S1). This closes SEC-P3-17 at the writer layer.
- **Error disclosure.** The 500 and 503 bodies carry only the catalogue code and title. The original failure lives in a `WeakMap` and is not a `cause` property. It reaches only the redacting `onDbError` hook, whose serializer writes `{ name, code, originalCode, kind }` for database errors. `AUDIT_LOCK_TIMEOUT` appears only as the log line's `reason`.
- **Bulkhead accounting.** Over 4,000 random operations (sync throws, rejections, wait expiries, hand-offs), no permit leaked, no key exceeded its cap, and the process returned to zero keys. A saturated tenant leaves another tenant's admission at about 0.1 ms.
- **Lint and supply chain.** The boundaries allowance is exactly `prisma/tests/audit/**` → `packages/audit/**`: 8 of 8 neighbouring imports stay refused. The `set_config` exemption is exact-file. The lockfile changes by one leaf (the `prisma` workspace's dev dependency on the existing `@platform/audit` link). No grant, policy or audit DDL changes.

The weaknesses sit where the design leans on callers, and on one ADR choice:

- **PR42-SEC-01 (MEDIUM, design):** every unauthenticated transaction of a process shares one admission key (`anonymous`). With the default pool of 10, 15 concurrent slow anonymous requests (about 43 to 87 per second in the probe) refused 97 of 97 legitimate anonymous requests: sign-in, sign-up, guest quote and booking, public tracking. Tenants stayed unaffected. Owner: principal-architect, due before TASK-052 (sign-in) merges.
- **PR42-SEC-02 (MEDIUM):** the rollback that keeps a business change from committing without its entry depends on the caller rethrowing. A refusal raised before any SQL error (invalid entry, missing tokeniser, tokeniser mismatch, moved head) leaves the PostgreSQL transaction healthy. A callback that swallows it commits the business change without its entry. After `HEAD_MOVED`, the CTE has already inserted the entry row. A rollback-only latch makes the property structural.
- **LOW 03 to 07:**
  - **03:** the entry is validated on one read of caller-owned objects and assembled from a second read after the tokenise `await`. A probe stored `SUCCESS` for a DENIED-only action and a forged `$pii` marker.
  - **04:** `route`, `entity_id`, `ua_parsed` and JSON object keys accept personal data into the immutable row.
  - **05:** the exemption's pin test misses `set_config (` with a space, `SET_CONFIG(` and a quoted name with a computed key.
  - **06:** `createPrismaAuditStore` and `prepareEntry` are outside the writer allow-list.
  - **07:** the writer and the tokeniser port are not T-83 roots.
  - **12:** a lone surrogate in any business string turns an otherwise valid audited mutation into a client-controllable 500 (concurs with code review R1-m3).
- **INFO 08 to 11:** configuration extremes and the unowned guard (08), payload size versus hash time under the lock (09), tamper signals and failure kind in logs (10), and test gaps for TASK-030/033 (11).

**Findings: 2 MEDIUM, 6 LOW, 4 INFO. Nothing Critical or High. Verdict: PASS_WITH_FOLLOW-UPS** (§11).

The code review (`474a827`) is CHANGES_REQUESTED on R1-M1, which is the same defect as PR42-SEC-06. A fix cycle therefore follows, and it voids this record. PR42-SEC-02, -03, -05, -06, -07 and -12 are small, sit in files this PR owns, and should ride that cycle. Round 2 will be a delta round plus the union with `main` (§7, §8).

## 2. Method

| # | Probe | What it shows |
|---|---|---|
| P1 | ESLint `lintText` against the real configs of the head and `main` extracts (type-aware rules off, nothing written). Cases B1–B10 (boundaries), W1–W4 (writer allow-list, importer `apps/api/src/modules/quotes/service/`), T0–T10 (`platform/tenant-context-sql`), plus an emulation of the store's pin test on 8 mutated store texts | §5.6, PR42-SEC-05, -06 |
| P2 | Type-stripped head `packages/audit/src` under a resolve/load hook. A fake store records the row, and a tokeniser mutates the caller's entry during its `await`. Controls C1–C3, mutations M1–M6, accessor G1, shard draw S1 | PR42-SEC-03, §5.1 |
| P3 | `tenant-admission.ts` (head): D1 random property (4,000 operations, 6 keys, cap 2, wait 15 ms); D2 isolation (cap 5, 15 queued); D3b continuous anonymous flood (15 loops, hold 50 / 200 / 1,000 ms, 3 s each); D4 factory bounds | PR42-SEC-01, §5.4 |
| P4 | `prepareEntry` with PII-shaped free text; `toAuditWriteError` own keys, message and JSON | PR42-SEC-04, §5.3 |
| P5 | `computeEntryHash` timing for old and new values of 1 KB to 8 MB each | PR42-SEC-09 |
| P6 | ESLint T-83 roots: a tokeniser with `db: AuditSqlPort` in `packages/audit/src/` vs `store/` vs `db: TenantDb` | PR42-SEC-07 |
| P7 | Deep JSON diff of the base and head `package-lock.json` (every leaf, with a positive control); `node_modules/ajv` tuple; `link: true` entries | §5.6 |
| P8 | Count-only host-fragment scan of the 7 evidence blobs (12 runtime-computed labels; positive control on `.claude/` at `main`: 6 hits) | §5.8 |
| P9 | Record simulation: main's real `check-security-owned-paths.mjs`, plumbing scenario commits in a sparse shared clone, including a simulated PR #40 squash and its union | §9 |

The integration claims (held-row 503 inside the audit lock timeout, gap-free chain under concurrent rollback, 42501 / `AUDIT_IMMUTABLE:`, inet output equality) rest on the lane B run. 17 `audit-writer.int.test.ts` cases and the `tenant-admission.int.test.ts` case are present and green in `integration.junit.xml`. No database was started for this review.

## 3. Findings

| ID | Title | Severity | CWE | OWASP | Location | Owner / due | Status |
|---|---|---|---|---|---|---|---|
| PR42-SEC-01 | One shared `anonymous` admission key: an unauthenticated flood denies sign-in and every guest flow of the process | MEDIUM | CWE-770 | A04:2021 | `apps/api/src/platform/db/tenant-admission.ts:85-89`; ADR-0007 am. 10 item 3; data-model §7.7 | principal-architect (ruling) → implemented before TASK-052 merges | Open |
| PR42-SEC-02 | Fail-closed rollback relies on the caller rethrowing; a swallowed pre-SQL refusal commits the business change without its entry | MEDIUM | CWE-778 | A09:2021 | `packages/audit/src/writer.ts:90-99`; `apps/api/src/platform/db/with-tenant-tx.ts:407-416`; `errors.ts:16-18` | senior-developer (this PR's fix cycle preferred) → before TASK-029 merges | Open |
| PR42-SEC-03 | Entry validated on one read, row assembled from a second read across the tokenise `await` (TOCTOU) | LOW | CWE-367 | A04:2021 | `packages/audit/src/entry.ts:380-483` (`complete()` lines 435-481) | senior-developer (fix cycle) → before TASK-029 merges | Open |
| PR42-SEC-04 | `route`, `entity_id`, `ua_parsed` and JSON keys accept personal data into the immutable, hash-chained row | LOW | CWE-359 | A04:2021 | `packages/audit/src/entry.ts:180, 386, 401, 275-278` | TASK-029 (caller contract) + writer guard in the fix cycle | Open |
| PR42-SEC-05 | The exact-file `setter` exemption's pin test is case- and whitespace-sensitive: a second setter with a computed key passes lint and pin | LOW | CWE-693 | A04:2021 | `eslint.config.mjs:203-206`; `packages/audit/src/store/prisma-store.test.ts:222-226` | senior-developer (fix cycle) → before TASK-030 touches the store | Open |
| PR42-SEC-06 | `createPrismaAuditStore` and `prepareEntry` are exported but not covered by `platform/audit-writer-allowlist` | LOW | CWE-284 | A04:2021 | `packages/audit/src/index.ts:21-35, 58-67`; `eslint.config.mjs:815` | senior-developer (fix cycle) → before TASK-029 merges | Open |
| PR42-SEC-07 | The writer and the tokeniser port (`AuditSqlPort`) are not T-83 roots | LOW | CWE-400 | A04:2021 | `eslint.config.mjs:143-145` | senior-developer (fix cycle) → before TASK-028 merges | Open |
| PR42-SEC-08 | Configuration extremes: cap = pool disables the bulkhead; long audit lock timeout defeats fail-fast; the cross-key rule sits in an unowned file | INFO | CWE-1188 | A05:2021 | `packages/config/src/guards.ts:256-270`, `schema.ts:192-216` | principal-architect / devops (G4 production config) | Open |
| PR42-SEC-09 | No byte bound on `old_value` / `new_value` / `details`; the entry hash is computed under the head lock and scales with size | INFO | CWE-400 | A04:2021 | `packages/audit/src/entry.ts:252-279`; `store/prisma-store.ts:211` | TASK-030 (E1/E2) with TASK-031 (diff size) | Open |
| PR42-SEC-10 | Tamper signals: `HEAD_MOVED` / `HEAD_MISSING` raise no security event; the failure kind is dropped from the log when a cause exists; `audit_lock_timeout_total` not emitted | INFO | CWE-778 | A09:2021 | `apps/api/src/platform/db/with-tenant-tx.ts:382-387` | TASK-030 / TASK-116 | Open |
| PR42-SEC-11 | Test gaps routed: catalogue parity of hashed columns, cross-stream write, orphan entry after `HEAD_MOVED` | INFO | CWE-1164 | A04:2021 | `packages/audit/src/entry-hash.test.ts:97-101`; `prisma/tests/audit/audit-writer.int.test.ts` | TASK-030 / TASK-033 | Open |
| PR42-SEC-12 | A lone surrogate in any business string is a client-controllable 500 (code review R1-m3) | LOW | CWE-20 | A04:2021 | `packages/audit/src/entry.ts:183-185, 260-262, 276` | senior-developer (fix cycle) → before TASK-029 merges | Open |

## 4. Finding details

### PR42-SEC-01 (MEDIUM): one shared `anonymous` admission key

- **Description.** `admissionKeyOf` maps every transaction with `orgId === ''` to the single key `anonymous`, as ADR-0007 am. 10 item 3 and data-model §7.7 specify. These transactions include sign-in (the integration suite's LOGIN_FAILED entry runs with `orgId: ''`), sign-up, password reset, guest quote and booking, and public tracking. With the API default `DB_POOL_MAX=10`, that class gets 5 permits and 10 queue places per process, with a 250 ms wait. An unauthenticated client that keeps 15 requests in flight on any anonymous route that holds a transaction keeps the queue full. Every other anonymous arrival is then refused at once (`depth`) or after 250 ms (`wait`).
- **Probe P3 / D3b** (real `createTenantAdmission`, cap 5, wait 250 ms):

  | Attacker transaction hold | Attacker rate | Legitimate anonymous requests refused | Tenant request |
  |---|---|---|---|
  | 50 ms | about 87 req/s | 97 of 97 | admitted |
  | 200 ms | about 47 req/s | 97 of 97 | admitted |
  | 1,000 ms | about 43 req/s | 97 of 97 | admitted |

  The bulkhead does what it was built for (tenants are isolated), but it concentrates all unauthenticated load into one bucket at half the pool.
- **Exploitability / impact.** No credential is needed. Keeping the 10 queue places full costs about 40 requests per second whatever the hold time, because a refused request returns within 250 ms. Under a per-IP limit like REQ-QUOTE-002 (20/min/IP), that takes about 130 source IPs, the same distributed-source assumption as T-46. A route whose transaction an attacker can make long needs fewer. While the flood lasts, sign-in for every user and every guest booking on that process answers 503 `SERVICE_UNAVAILABLE`. Impact M (availability of the acquisition funnel and of sign-in; no data effect) × likelihood H gives **MEDIUM**. The ADR's accepted residual ("two simultaneously hot tenants can still fill a pool") does not cover a key that an attacker controls by definition.
- **Remediation (ruling for principal-architect; code in `tenant-admission.ts` and the route descriptor).** Split the anonymous class, and keep a global anonymous ceiling above the split:

  ```ts
  // Route descriptor (D-ARCH-086 amendment): anonymous traffic declares its admission class.
  type AnonymousAdmission = 'auth' | 'guest' | 'public';
  // tenant-admission.ts
  export function admissionKeyOf(orgId: string, actorScope: string, anon?: { cls: AnonymousAdmission; guestTokenHash: string }): AdmissionKey {
    if (actorScope === 'OPERATOR') return OPERATOR_KEY;
    if (orgId !== '') return { key: orgId.toLowerCase(), kind: 'tenant' };
    if (anon?.cls === 'guest' && anon.guestTokenHash !== '') return { key: `guest:${anon.guestTokenHash}`, kind: 'anonymous' }; // per guest session
    return { key: `anonymous:${anon?.cls ?? 'public'}`, kind: 'anonymous' };                                                      // auth never shares with public
  }
  ```

  Add a reserve, as R-15 does for the carrier bulkhead: `anonymous:auth` keeps its own permits that public and guest floods cannot take. Optionally add a per-client sub-key (coarse network from the trusted proxy chain, EC-A12) for `public`. Record the new threat (T-xx "unauthenticated flood on the shared admission key") and a SEC-TC in the threat model. Security owes that text, next text round.
- **Verification.** A unit test with the D3b shape: 15 slow `public` loops leave ≥ 95 % of `auth` admissions granted, and a per-guest-key flood leaves another guest admitted. Then an api or k6 case: an anonymous flood on a public route, with `POST /auth/login` answering non-503 at its normal rate (proposed SEC-TC).

### PR42-SEC-02 (MEDIUM): the fail-closed rollback relies on the caller rethrowing

- **Description.** `write()` throws `AuditWriteError`, and `withTenantTx` rolls back because the error leaves the callback. `errors.ts:16-18` documents the obligation, but nothing enforces it. Two cases follow:
  - **SQL failures.** PostgreSQL has already aborted the transaction (25P02 for any further statement) and turns the COMMIT into a rollback, so a swallowed SQL failure cannot commit the business row. Whether Prisma then reports success to the caller was not probed (no database in this round).
  - **Failures raised before any SQL error.** These are `INVALID_ENTRY`, `TOKENISER_UNAVAILABLE`, `TOKENISER_FAILED` (count or shape mismatch) and `HEAD_MOVED` (`affected !== 1`). They leave the transaction healthy. A callback that catches one and returns normally commits the business change without its entry.
  - **`HEAD_MOVED`.** The data-modifying CTE has already inserted the entry row (PostgreSQL always runs such a CTE to completion). There is no unique constraint on `(stream_id, stream_seq)`, and a partitioned table cannot have one without `occurred_at`. A swallowed `HEAD_MOVED` would therefore commit an orphan entry and fork the sequence.
- **Exploitability / impact.** It takes a developer's catch in one of the allow-listed callers (identity, compliance, admin-settings, the shipments state machine, worker processors, authz, the capture hook). A lint does not stop a catch that logs. The impact is High: a mutation without its entry breaks O4 and REQ-AUDIT-004 and enables repudiation. Likelihood is Low (no production caller exists yet, and the designed tx-slot path propagates, as `audit-failure.api.test.ts` proves). That gives **MEDIUM**.
- **Remediation (rollback-only latch).**

  ```ts
  // packages/audit/src/store/prisma-store.ts
  export interface AuditSqlPort {
    $queryRaw<T = unknown>(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<T>;
    $executeRaw(query: TemplateStringsArray, ...values: unknown[]): PromiseLike<number>;
    /** Marks the enclosing transaction rollback-only; TenantDb implements it and withTenantTx refuses to commit. */
    markRollbackOnly?(failure: Error): void;
  }
  // packages/audit/src/writer.ts
  async function write(db: AuditSqlPort, entry: AuditEntryInput): Promise<AppendedEntry> {
    try {
      const prepared = prepare(entry);
      const row = prepared.complete(await tokenise(db, prepared.piiValues));
      return await options.store.append(db, row, { lockTimeoutMs: options.lockTimeoutMs, actorStamp: row.userId ?? ANONYMOUS_ACTOR_ID });
    } catch (error) {
      const failure = toAuditWriteError(error);
      db.markRollbackOnly?.(failure);
      throw failure;
    }
  }
  // apps/api/src/platform/db/with-tenant-tx.ts, inside the $transaction callback
  const result = await fn(handle.db);
  const poisoned = handle.rollbackOnly();            // set by markRollbackOnly
  if (poisoned !== undefined) throw poisoned;        // Prisma rolls back; mapped() answers 500 / 503
  return result;
  ```

  `TenantDb` gains `markRollbackOnly` as its one new allowed member (deny-by-default Proxy). The structural port keeps the method optional for job contexts until TASK-047 implements it.
- **Verification.** Integration case (as `platform_app`): the callback inserts a business row, catches an `INVALID_ENTRY` from `writer.write` and returns `'ok'`. `withTenantTx` must reject with 500 `AUDIT_WRITE_FAILED`, and the row count must be 0. Same for a swallowed 55P03, which must reject with 503 instead of resolving. Unit test: every failure kind calls `markRollbackOnly` exactly once.

### PR42-SEC-03 (LOW): validation and assembly read the caller's objects twice

- **Description.** `prepareEntry` validates `input.action`, `input.outcome`, `origin.sourceApp`, `origin.correlationId` and walks `oldValue` / `newValue` / `details` (`collect`). `complete(tokens)` runs after the writer's `await tokenise(...)`, and it reads those same properties and objects again: `substitute` re-walks the caller's JSON with `Object.keys` and `record[key]`.
- **Probe P2.** The controls show the writer refuses the same values when handed in directly: C1 DENIED-only, C2 forged marker, C3 PiiValue swapped for raw text (cursor check).

  | Case | Mutation between validation and assembly | Stored row |
  |---|---|---|
  | M1 | `outcome` `DENIED` → `SUCCESS` on `LOGIN_FAILED` | `outcome = SUCCESS` (DENIED-only rule bypassed) |
  | M2 | adds `owner: {"$pii": <token of another subject>}` | forged marker stored |
  | G1 | accessor returns a string on the first read, a `$pii` object on the second (no `await` needed) | forged marker stored |
  | M3 | NUL and a lone surrogate | stored unvalidated (the database or JCS fails later, so 500) |
  | M4 / M5 | `correlationId` / `sourceApp` | stored unvalidated (DB CHECK refuses, so 500) |
  | M6 | nested object replaced by a `Date` | `{}` stored |

- **Exploitability / impact.** Only server code builds entries, and JSON request bodies cannot carry accessors. A trigger needs a getter or a Proxy in caller data, or concurrent mutation of a shared object during the tokenise round trip. A forged marker makes the viewer resolve another subject's vault token inside this entry (cross-subject disclosure), and erasure accounting (`pii_token_count`) misses it. Impact M × likelihood L gives **LOW**.
- **Remediation.** Read each scalar once into locals and validate the locals. `collect` builds a frozen deep copy in which each `PiiValue` is replaced by a slot index. `complete()` fills slots from that copy only and never touches caller objects again.

  ```ts
  const { action, outcome } = input; const { sourceApp, correlationId } = origin;   // validated, then used below
  type Skeleton = null | boolean | number | string | { readonly slot: number } | readonly Skeleton[] | { readonly [k: string]: Skeleton };
  function collect(value: AuditValue, field: string, depth: number, state: WalkState): Skeleton { /* validate + copy + slot */ }
  complete(tokens) { /* fill(skeleton, tokens): no read of input */ }
  ```

- **Verification.** Re-run M1, M2 and G1 as unit tests. The stored row must keep `DENIED` and carry no marker it did not create, or the write must be refused. A property test: mutating the input after `prepareEntry` returns never changes `complete()`'s output.

### PR42-SEC-04 (LOW): clear-text free-text columns

- **Description.** These columns are stored in clear, inside the chain, in an immutable row that erasure cannot reach (ADR-0007 am. 2 tokenises personal values precisely because of this):
  - `route` matches `^\/[\x21-\x7e]{0,255}$`, which admits a query string or a concrete path.
  - `entity_id` is any storable text up to 256 characters.
  - `ua_parsed` is any text up to 120 characters.
  - JSON object keys are any storable text (only `$pii` is refused).
- **Probe P4.** Each of these was accepted, and the row contained the address in clear: a route with `?email=<address>&token=…`, a route with the address as a path segment, `entityId` = the address, and a JSON key = the address. A 120-character raw user agent was accepted as `ua_parsed`. The template control `/api/v1/users/:id` was accepted.
- **Exploitability / impact.** The capture middleware (TASK-029) is the designed caller. Its descriptor provides the route template and entity IDs. A mistake there persists personal data permanently. Impact M (unerasable personal data, GDPR/DPDP erasure) × likelihood L gives **LOW**.
- **Remediation.**
  - **Writer guard, in the fix cycle.** Each segment check below is a single bounded class with no nested quantifier, so it runs in linear time:

    ```ts
    const ROUTE_SEGMENT = /^(?:[a-z0-9][a-z0-9._-]{0,62}|:[a-z][A-Za-z0-9_]{0,62}|\{[a-z][A-Za-z0-9_]{0,62}\})$/;
    const route = (v: string) => v.length <= 256 && v.startsWith('/') && v.slice(1).split('/').every((s) => ROUTE_SEGMENT.test(s));
    const ENTITY_ID = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$/;      // no '@', '+', space, '/', '?'
    const UA_PARSED = /^[A-Za-z][A-Za-z0-9 .]{0,50}(?: \/ [A-Za-z][A-Za-z0-9 .]{0,50})?$/; // "Firefox 146 / Windows"
    const JSON_KEY = /^[A-Za-z_][A-Za-z0-9_.:-]{0,63}$/;             // business keys; '$pii' stays refused separately
    ```

  - **TASK-029.** `route` is the descriptor's template (never `req.originalUrl`), `entityId` is the entity's ID, and `uaParsed` is derived from a parser's family and major version.
- **Verification.** Unit tests: the five P4 shapes are refused with `INVALID_ENTRY` and the field path, and the templates and UUID IDs are accepted. A ReDoS scaling test runs the new checks at 1 KB / 8 KB / 32 KB.

### PR42-SEC-05 (LOW): the setter exemption's pin is narrower than the rule it replaces

- **Description.** `TENANT_CONTEXT_EXEMPTIONS` allows the `setter` form (`/set_config/iu`) for the whole of `prisma-store.ts`. The `keys`, `session-set` and `session-set-config` forms stay active. The compensating unit test extracts setters with the case-sensitive `/set_config\(([^)]*)\)/g` and checks `/app\./`.
- **Probe P1.**

  | Mutation appended to the store | Lint | Pin test |
  |---|---|---|
  | T1 `set_config('app.org_id', …, true)` | reported (`keys`) | fails |
  | T4 `set_config(${k}, ${v}, false)` | reported | — |
  | T5 `SET LOCAL app.org_id` | reported | — |
  | T6 the allowed setter placed in `writer.ts` | reported (exact-file holds) | — |
  | T3 `set_config('statement_timeout','0',true)` | silent | fails |
  | T7 `'app.correlation_id'` | silent | fails |
  | T8 `'role'` | silent | fails |
  | T2 `pg_catalog.SET_CONFIG (${k}, ${v}, true)` | **silent** | **passes** |
  | T9 `set_config (${k}, ${v}, true)` | **silent** | **passes** |
  | T10 `"set_config"(${k}, ${v}, true)` | **silent** | **passes** |

  A computed key can be any GUC, including `app.org_id` (the transaction's tenant), `statement_timeout` or `lock_timeout` = `0`.
- **Exploitability / impact.** It needs an edit of an owned path (`/packages/audit/` is CODEOWNED, so a security record is required). The residual is a reviewer missing it. **LOW.**
- **Remediation.** Make the lint, not the test, carry the exemption's shape. A rule option allows only listed literal keys with literal `true`. Every other `set_config` occurrence in the file stays an error:

  ```js
  // eslint.config.mjs
  { files: ['packages/audit/src/store/prisma-store.ts'], allow: [], allowSetterKeys: ['lock_timeout'] },
  // tools/eslint-rules/tenant-context-sql.mjs: with allowSetterKeys, a text passes the setter form only when every
  // /set_config/giu match is /set_config\s*\(\s*'(lock_timeout)'\s*,\s*\$\d+\s*,\s*true\s*\)/iu on the rendered text
  ```

  At minimum, tighten the pin. `expect([...code.matchAll(/set_config/giu)]).toHaveLength(1)`, the single match must be `pg_catalog.set_config('lock_timeout', ${lockTimeoutMs}, true)`, and `expect(code).not.toMatch(/\bapp\s*\./iu)`.
- **Verification.** T2, T9 and T10 fail (lint error, or the pin goes red), and T0 stays clean. Add a negative lint fixture for the space form.

### PR42-SEC-06 (LOW): store primitives outside the writer allow-list

- **Description.** `platform/audit-writer-allowlist` recognises `AuditWriter`, `createAuditWriter` and `writeAuditEntry` (its default list; `eslint.config.mjs:815` passes no option). The PR also exports `createPrismaAuditStore` (append and vault insert on a handed transaction), `prepareEntry`, `computeEntryHash` and `canonicalEntry`. Probe W1 (control: `createAuditWriter` in `apps/api/src/modules/quotes/service/`) is reported. W2 (`createPrismaAuditStore`) and W3 (`prepareEntry`, `computeEntryHash`) are silent. `main` behaves the same for W2/W3 only because the names do not exist there.
- **Exploitability / impact.** Feature code can write an `AuditRowDraft` straight to the store. That skips entry validation, the DENIED-only rule and tokenisation, so raw personal values or forged actor columns reach the immutable row. A raw `INSERT INTO audit_entries` from a `TenantDb` is equally possible today, but the store looks sanctioned. **LOW.**
- **Remediation.**

  ```js
  'platform/audit-writer-allowlist': ['error', { writerExports: ['AuditWriter', 'createAuditWriter', 'writeAuditEntry', 'createPrismaAuditStore', 'prepareEntry'] }],
  ```

  Alternatively, move the store to a `@platform/audit/store` subpath and extend `WRITER_MODULE`. Raw SQL naming the audit tables outside the store goes to TASK-033's lint backlog.
- **Verification.** W2/W3 reported, W1 still reported, every allow-listed folder still clean, and a negative fixture per name.

### PR42-SEC-07 (LOW): the writer and the tokeniser port are not T-83 roots

- **Description.** T-83 (D-ARCH-106) roots are `TENANT_TX_FILES` (which includes `packages/audit/src/store/**`) and functions with a parameter typed `TenantDb`, `AppDb` or `AppTransactionClient`. `writer.ts` and every `PiiTokeniser.tokenise(db: AuditSqlPort, …)` run inside the business transaction by contract, but they match neither.
- **Probe P6.** A tokeniser in `packages/audit/src/kms-tokeniser.ts` with `db: AuditSqlPort`, calling `fetch` and `setTimeout`, drew only the generic `outbound-http-via-client` error. The T-83 rule was silent. The same body under `store/`, or with `db: TenantDb`, drew T-83 twice. A KMS or cache call through the sanctioned outbound client would draw nothing.
- **Exploitability / impact.** TASK-028 implements the tokeniser (HMAC, AES-GCM, subject resolution). External I/O there runs inside every audited transaction and holds a pool connection and an admission permit. That is the T-83 pool-exhaustion class. **LOW.**
- **Remediation.** `const TENANT_TX_HANDLE_TYPES = ['TenantDb', 'AppDb', 'AppTransactionClient', 'AuditSqlPort'];`, and optionally `packages/audit/src/writer.ts` in `TENANT_TX_FILES`.
- **Verification.** P6's K1 draws T-83 like K2/K3. The head's `packages/audit/src/**` still lints clean, and a negative fixture covers the port shape.

### PR42-SEC-08 (INFO): configuration extremes

These values are accepted as written:
- **Cap equal to the pool.** `databaseGuard` refuses only `DB_TENANT_MAX_CONCURRENT_TX > DB_POOL_MAX`. Equal values let one tenant take the whole pool, so the control is off.
- **Small pools.** For `DB_POOL_MAX` ≤ 3, the default `max(2, floor(pool/2))` gives a single tenant at least two-thirds of the pool (D-TASK025-10).
- **Audit lock timeout.** `DB_AUDIT_LOCK_TIMEOUT_MS` may reach 59,999 ms. Item 2's fail-fast lever is then gone. Once it exceeds `DB_TX_STATEMENT_TIMEOUT_MS`, the wait ends in 57014, a non-retryable 500 instead of the 503.
- **Factory bound.** The owned runtime check (`resolveAdmissionOptions`) validates only positivity and `waitMs ≤ maxWait`. Probe D4: the factory accepts cap 2^53 − 1. The cap-to-pool rule lives only in the unowned `guards.ts`.

Recommendation (principal-architect / devops, before a production configuration exists):
- A production guard: cap ≤ `max(2, floor(pool/2))`, `DB_POOL_MAX ≥ 4`, and `DB_AUDIT_LOCK_TIMEOUT_MS ≤ min(2000, DB_TX_STATEMENT_TIMEOUT_MS − 1)`.
- `resolveAdmissionOptions` takes the pool size and refuses a cap above it.

### PR42-SEC-09 (INFO): payload size against the head lock

`collect` bounds depth (32) and nodes (10,000), but not string or key length or total bytes. The hash is computed between lock grant and the append (step 3, by design). Probe P5 measured `computeEntryHash` at a median of:

| Old and new values | Hash time |
|---|---|
| 2 × 100 KB | 0.7 ms |
| 2 × 1 MB | 5.4 ms |
| 2 × 8 MB | 43.2 ms |

The API body limit (1 MB) bounds request-originated diffs, but not database-originated old values. A large entry extends its own stream's hold time by several RTTs. For anonymous traffic, the stream is a random SYSTEM shard. Recommendation to TASK-030 (E1/E2 budget) and TASK-031 (diff size): a serialized-size cap per JSON column (for example 64 KiB). Beyond it, either refuse with `INVALID_ENTRY` or store a digest plus a truncation marker, as the data-model decides.

### PR42-SEC-10 (INFO): tamper signals and failure kind

- **No security event.** `HEAD_MOVED`, `HEAD_MISSING` and the `parseHead` integrity refusal "cannot happen unless the head was tampered with" (`errors.ts`), but they map to a plain 500.
- **Kind lost.** `mapped()` logs `auditErrorCause(error) ?? error`. When a cause exists, the log line carries the cause's `{ name, code, originalCode, kind: 'postgres' }` and the mapping, but not the audit failure kind: `PARTITION_MISSING` versus `DATABASE_ERROR`.
- **Metric missing.** ADR am. 10 item 2's `audit_lock_timeout_total{stream_kind}` is not emitted yet.

Recommendation (TASK-030 / TASK-116):
- Add `auditKind: error.kind` (an enum, safe) to the `onDbError` fields.
- Raise a security event (`audit_chain_head_mismatch`) for `HEAD_MOVED` / `HEAD_MISSING` / integrity.
- Count lock timeouts per stream kind.

### PR42-SEC-11 (INFO): test gaps for later tasks

- **(a) Column parity.** The canonical-object test pins a count (35) and three absences. A column added later by a new `NN-audit-*.sql` would be stored unhashed without any test failing. TASK-030/033: a catalogue test asserting `pg_attribute(audit_entries)` minus `{prev_hash, entry_hash, scope_org_id}` equals `Object.keys(canonicalEntry(...))`.
- **(b) Cross-stream write.** Audit tables are SYSTEM class without RLS, so the writer appends to whatever stream `entry.orgId` names. TASK-029 derives `orgId` / `targetOrgId` from the validated `TenantContext`. TASK-033 adds "a hook in org A's transaction cannot append to org B's stream".
- **(c) Orphan entry.** A swallowed `HEAD_MOVED` leaves the CTE-inserted entry (see 02). TASK-033 asserts that it rolls back with the transaction.

### PR42-SEC-12 (LOW): a lone surrogate is a client-controllable 500

- **Description.** `"\ud800"` is valid JSON, and `JSON.parse` yields a lone surrogate. The code review probed that Joi `string()` accepts it (R1-m3). The business `text` insert succeeds, because the driver's UTF-8 encoding stores U+FFFD. `collect` refuses the audit entry (`unstorable`, `entry.ts:261` and `:276` for keys), so the otherwise valid mutation answers 500 `AUDIT_WRITE_FAILED` and rolls back. NUL is refused the same way, but PostgreSQL rejects NUL in `text` anyway, so that case belongs at the boundary.
- **Exploitability / impact.** Any client can do this at will on any audited mutation with a free-text field. The 5xx count feeds `ROLLBACK_TRIGGERS` (error rate above 2× baseline) and SLO burn alerts. That is a lever to roll back a canary or page on-call, with no data effect. Impact L (no production target in this run) × likelihood H gives **LOW**. It becomes MEDIUM once a canary target is configured.
- **Remediation.**
  - In the PR42-SEC-03 snapshot, normalise every string value and key with `String.prototype.toWellFormed()`. The result is what PostgreSQL stores for `text`, so the hash and the row agree.
  - Keep the NUL refusal in the writer.
  - Refuse NUL and lone surrogates with 400 at the HTTP boundary (a json-body reviver or a Joi base rule: TASK-020 part 020-C or TASK-029, with a D-entry amending D-TASK025-06).
- **Verification.** Api test: an audited mutation with `"\ud800"` in a string answers 2xx (normalised) or 400, never 500, and the stored entry's hash recomputes from the database representation. With `"\u0000"`, it answers 400.

## 5. Focus areas checked

### 5.1 Audit integrity and immutability

- **Hashed columns.** All 35 hashed columns appear in `canonicalEntry`, checked by hand against `10-audit.sql`'s 38 columns minus `prev_hash`, `entry_hash` and `scope_org_id`. `hash_version` is included, and `prev_hash` is chained by concatenation.
- **Canonical forms.**
  - UUIDs and tokens are lower-cased before hashing. PostgreSQL prints them lower-case.
  - `ip_hash` is lower-case hex from bytes, decoded with `decode(…, 'hex')`.
  - `occurred_at` is `YYYY-MM-DDTHH:MM:SS.ffffffZ` from integer microseconds (`bigint`), and the database stores microseconds.
  - The `/48` text follows PostgreSQL's `inet` output, integration-tested for 7 IPv6 shapes.
  - JSON numbers round-trip through `numeric` jsonb. Non-finite numbers, NUL and lone surrogates are refused before hashing.
  - The integration suite recomputes every stored row's hash from `SELECT … old_value, new_value, details, ip_coarse::text, encode(…)`.
- **Serialisation.** The head-row `FOR UPDATE` serialises a stream, and the `lock_timeout` CTE is materialised before `LockRows`. AT-US-088-03 holds the row as superuser and gets 503 within the 250 ms audit timeout, not the 2 s transaction timeout. The append-and-advance CTE carries `entry_count = seq − 1` with `expectAffected(1)`.
- **Concurrent rollback.** AT-US-088-08 shows only the committed entry, at sequence 1, with no gap. A waiter under READ COMMITTED reads the latest committed head after the lock is granted.
- **Immutability.** `platform_app` gets 42501 on UPDATE and DELETE. The superuser gets `AUDIT_IMMUTABLE:` from the `ENABLE ALWAYS` trigger. The bootstrap lane (PR #24) is untouched, so TRUNCATE, the owner and replica-mode cases stay as reviewed there. The per-role generated suite is TASK-033.
- **SYSTEM shard (SEC-P3-17).** `systemShard` defaults to `crypto.randomInt(16)` and is never derived from the correlation ID. Probe S1: 400 writes with one fixed correlation ID gave 16 distinct shards, all in `…000000`–`…00000f`. SEC-TC-57 (API level, ≥ 12 of 16 over 1,000 crafted requests) stays with TASK-030.

### 5.2 Same-transaction semantics

- The store is typed on a structural two-method port, imports neither Prisma nor `pg`, and constructs nothing. This is pinned by the source-rule test and by boundaries (`DATABASE_CODE`). It can only join the transaction it is handed (PR2-SEC-05, PR11-SEC-05 item 2, D-ARCH-074).
- Propagation is proven end to end. The api test runs the tx slot, the real `withTenantTx` and the problem handler. The integration suite covers a real 22023 in the INSERT (AT-US-088-01), a business failure after the entry (AT-US-088-02) and a missing partition (AT-US-088-07): in each, the business row is absent.
- The gap is a caller that does not propagate: PR42-SEC-02.

### 5.3 Error disclosure

- **Response bodies** (api test). 500 is `{status, code: AUDIT_WRITE_FAILED, title}`. 503 is `SERVICE_UNAVAILABLE` with `Retry-After: 1`. Neither carries `reason`, `kind`, `sqlState` or `retryable`, nor the message fragments `PARTITION_MISSING`, `23514`, `no partition`, `55P03`, `lock timeout` or `origin.ip`.
- **Error object** (probe P4). The message is `Audit write failed: <reason> (<kind>)`. There is no own `cause`. `toJSON` holds reason, kind, status, retryable, `retryAfterSeconds` and `sqlState` only, plus `field` (the path) for an invalid entry, which the log serializer does not read. The original failure is in a `WeakMap`. The logger's error serializer reads own data properties, so it cannot reach the original.
- **Log line.** `{component, reason, status, retryable}` plus the cause, serialised as `{ name, code, originalCode, kind }` for database errors. A non-database cause, such as a tokeniser exception, keeps a redacted message, so TASK-028 must not put values in its error messages (§8).
- **Admission refusals.** These are `DbError`s that are not logged (counters only). The catalogue entry `AUDIT_WRITE_FAILED` (500, "Audit write failed") matches openapi's `AuditWriteFailed`.

### 5.4 Bulkhead as a DoS control

- **Permit accounting** (probe D1, 4,000 operations).
  - Settle paths: sync throws, async rejections, wait expiries and direct hand-offs.
  - Outcome: 2,273 ran and 1,727 were refused with 503 (142 `wait`, 1,585 `depth`). No key ever exceeded its cap. The end state was inflight `{0,0,0}`, queued 0 and keys 0.
  - Release runs in `finally`. A hand-off clears the waiter's timer before granting. An expiring waiter unlinks in O(1). Idle keys are deleted.
  - A hung connection cannot pin a permit beyond the pg client's `query_timeout` (statement timeout plus margin, `client.ts:201`).
- **Isolation** (probe D2). With org A at cap 5 and 10 queued, A's 16th request was refused in 0.1 ms and org B was admitted in 0.1 ms.
- **Placement.** The key comes from the validated `contextValues` and is taken before pool checkout. A nested `withTenantTx` is refused before admission, so no transaction waits on its own key's permit.
- **Anonymous class.** PR42-SEC-01.
- **Configuration bounds.** In the schema, the cap is 1..100 (≤ pool by the guard) or unset, giving `max(2, floor(pool/2))` = 5 for the API default. The wait is 1..2000 with a default of 250, and the owned runtime refuses a wait above `maxWait`. The audit lock timeout is 1..59,999, default 250, < `DB_TX_LOCK_TIMEOUT_MS` by the guard. The store refuses values outside 1..60,000, and `lock_timeout = 0` (no timeout) cannot be configured. Extremes: PR42-SEC-08.

### 5.5 Personal data

- **Entry's own fields.** The IP is canonicalised: mapped IPv4 is unmapped, the zone is dropped, and IPv6 is lower-cased. The IP, the raw user agent (truncated to 1,024 code points without splitting a pair) and the typed reason are tokenised as `PERSONAL` on entity `audit_entry`. Only `ip_coarse` (/24, /48) and the `IpIndex` HMAC stay in clear, as ADR-0007 am. 2 allows.
- **Values in the JSON fields.** `PiiValue` markers become `{"$pii": token}` after ONE tokeniser call per entry. A missing tokeniser fails closed (`TOKENISER_UNAVAILABLE`). A token count, order or shape mismatch is `TOKENISER_FAILED`. A forged `$pii` key in business data is refused (C2), and an own `__proto__` key stays a plain key.
- **Vault SQL** (in the store, as asked). Statement 1 is one `INSERT … SELECT FROM unnest($n::uuid[], …, $n::text[]) ON CONFLICT DO NOTHING`, with HMAC and ciphertext as hex text decoded in SQL. Statement 1b is one `unnest … WITH ORDINALITY CROSS JOIN LATERAL (… LIMIT 1)` lookup, run as a separate statement so a concurrent winner's row is seen. Mixed key IDs, a non-32-byte HMAC or an unresolved token fail closed. Every value is a bound parameter.
- **Gaps.** PR42-SEC-03 (forged marker by double read) and PR42-SEC-04 (free-text columns and keys).

### 5.6 Lint, boundaries and owned shared files

- **`setter` exemption.** It is exact-file: T6, the same setter placed in `writer.ts`, is reported. It does not reach the tenant keys (T1) or the session forms (T4, T5). Its shape is enforced only by the pin test (PR42-SEC-05).
- **`prisma/tests/audit/**` → `packages/audit/**`.**
  - On head, B1 is allowed (`prisma/tests/audit` → `@platform/audit`).
  - B2 `@platform/authz`, B3 `@platform/pricing`, B4 `prisma/tests/other` → audit, B5 `prisma/tests/seed` → audit, B7 `@platform/shared`, B8 `@platform/config` and B9 `apps/api/src/app` are refused.
  - B6 (`prisma/seed` → audit) is refused by the writer allow-list.
  - On `main`, B1 is refused, which confirms the allowance is new.
  - The new `package-audit` category only adds matches (categories accumulate), and the real files lint clean in lane A.
  - B10 (`packages/audit` → `prisma/tests/audit`) is silent on head and `main` alike (pre-existing; the `paths.test.ts` tripwire scans `packages`).
- **`tools/tsconfig.json`.** One `files` entry (`tenant-admission.ts`) and one reference (`../packages/audit`). These widen type-check scope only.
- **Lockfile (probe P7).**
  - The deep diff of `2dd6958` → `e7dfbac` has exactly 1 leaf: `packages["prisma"].devDependencies["@platform/audit"] = "0.0.0"`. The control mutation was seen.
  - D-SEC-PR23-02 interim statement: `node_modules/ajv` is `8.20.0`, `https://registry.npmjs.org/ajv/-/ajv-8.20.0.tgz`, MIT, integrity unchanged from `main`. There are 15 `link: true` entries, all `node_modules/@platform/*`, and **no non-`@platform` `link: true` entry**.
  - No registry package is added: `canonicalize` 5.1.0 (Apache-2.0) was already declared and locked.
- **`prisma/package.json`.** The dev dependency keeps `@platform/audit` out of any `--omit=dev` image. `prisma/tests/**` must stay out of images (TASK-014 check, PR27-SEC-01).

### 5.7 RLS and roles

- **No grant, policy or audit DDL changes**, and no `.sql` file is in the diff.
- **Grants used.** The writer's SQL needs exactly `platform_app`'s existing grants:
  - `SELECT, INSERT, UPDATE` on `audit_stream_heads`. `FOR UPDATE` requires UPDATE; ADR am. 10 item 1 calls this grant load-bearing.
  - `SELECT, INSERT` on `audit_entries` (parent) and `audit_pii_vault`. `ON CONFLICT DO NOTHING` needs no UPDATE.
  - It needs nothing on `data_subjects` (TASK-028 resolves subjects).
- **Roles in the suite.** The integration suite runs the writer through `createWithTenantTx` on `pgh.appUrl(database)` (`platform_app`). It uses the superuser only for setup, assertions and the held row.
- **No RLS on audit tables.** They are SYSTEM class and carry no RLS (PR #24, D-ARCH-076), so `app.org_id` does not filter the writer, and the stream comes from the entry (PR42-SEC-11 (b)).
- **Migrator.** It gets nothing (D-ARCH-075). For PR13-SEC-08's TASK-025 item: no migrator privilege is added, and the seed's `ConfigChangeSink` is not wired to the writer here, so the item carries to the PR that wires it.

### 5.8 Evidence hygiene (D-SEC-PR23-02)

- **Gate table.** The PR body's gate table carries both statements verbatim: "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first" (before `quality:heavy`) and "`.git/info/exclude` is empty" (0 bytes).
- **Run.** Profile `pr` (no `wave` or `gate` run committed), `git_dirty: false`, `build_clean: true`, and `env_overrides` empty.
- **Hashes.** Lockfile SHA-256 equals the recomputed head hash.
- **Host-path scan** (count-only, 12 labels: OS user and lower-case form, 8.3 stem, home in three spellings, tmpdir, host name, git e-mail, generic users-directory forms): **0** over the 7 files. Control: 6 hits in `.claude/` at `main`.
- **Suites.** The new suites are in the run: 17 `audit-writer.int.test.ts` cases, the `tenant-admission.int.test.ts` case, 16 `tenant-admission` unit cases, 4 `audit-failure.api.test.ts` cases, and 0 failures in every JUnit file.

### 5.9 D-TASK025-01..11

| Decision | Security position |
|---|---|
| 01 503 `SERVICE_UNAVAILABLE` for a lock timeout, `AUDIT_LOCK_TIMEOUT` log-only | Accepted. It discloses less than a distinct public code |
| 02 translation in `withTenantTx`; any 55P03 during the write is 503 | Accepted. It is consistent with am. 10 item 2 (partition-lock window). A vault-conflict wait before the lock runs under the transaction `lock_timeout` (2 s) and is 503 as well. The caller obligation is PR42-SEC-02 |
| 03 18 actions = DB CHECK; `MFA_RECOVERY_USED`, `SESSION_REVOKED` not added | Accepted as fail-safe (a type wider than the CHECK would turn writes into 500s). Both are security events (ADR-0008), so the CHECK widening (rule-12 audit DDL with a security record) must merge before the first task that emits either one (AT-US-087-07). Owner: principal-architect |
| 04 store writes the chain now; TASK-030 keeps the proofs | Accepted. TASK-030 must keep the PR42-SEC-05 pin when it moves code |
| 05 random SYSTEM shard | Accepted; closes SEC-P3-17 at the writer layer (§5.1) |
| 06 markers, one batch, own fields tokenised | Accepted with PR42-SEC-03/04 |
| 07 outcome rules | Accepted. They are bypassable only through PR42-SEC-03 |
| 08 exact-file `setter` exemption | Accepted with PR42-SEC-05 |
| 09 DB suite in `prisma/tests/audit`, one allowance, one lock leaf | Accepted (§5.6) |
| 10 admission defaults; the SPK-04 harness gets the bulkhead | Accepted with PR42-SEC-01/08. TASK-280 must read 503 `TENANT_CONCURRENCY_LIMIT` as designed, not as a failure of the audit path |
| 11 `.env.example` keys, Compose takes the defaults | Accepted. The defaults (cap 5 for pool 10, wait 250, audit lock 250 < 2000) are the safe values |

## 6. Earlier findings and review items

| Item | State after this PR |
|---|---|
| SEC-P3-17 (LOW, P3) shard from the client correlation ID | **Closed at the writer layer** (D-TASK025-05, probe S1). SEC-TC-57 at the API level stays with TASK-030 |
| PR2-SEC-05 / PR11-SEC-05 item 2 (store must not construct a client) | Met: structural port, source-rule test, boundaries |
| PR13-SEC-08, TASK-025 item (no migrator privilege on audit tables) | Met for this PR (no grant). It carries to the PR that wires `ConfigChangeSink` |
| PR27 checks for the audit writer (nothing from `prisma/tests` in product code; `lock_timeout` via `set_config(…, true)`; generic 503; rollback fail-closed) | First three met. The fourth is met for propagating callers, with PR42-SEC-02 for the rest |
| PR40-SEC-05 (audit names join `unit.required_cases` with the first measured audit source) | The PR supplies the figures and routes the manifest change to qa-lead after PR #40 merges (the manifest is qa-lead's, and a manifest PR needs its own record). Due at the first activation checkpoint after this merge |
| PR27-SEC-06 (`prisma/seed` may import `prisma/tests`) | Unchanged. The new allowance does not widen it (B5 and B6 are refused) |

**Code review twin** (`docs/05-quality/reviews/PR-0042-TASK-025-code-review.md`, `474a827`, CHANGES_REQUESTED). Read after the probes above; the overlaps were found independently.

| Code review item | Security view |
|---|---|
| R1-M1 (MAJOR) store export outside the writer allow-list | Same defect as PR42-SEC-06. Concur: fix in this PR (one config line plus a fixture) |
| R1-m1 pin not tight | Same as PR42-SEC-05. The fix should be lint-level (rule option), not only a stricter test |
| R1-m2 validate-then-use | Same as PR42-SEC-03; the security impact is the forged `$pii` marker and the DENIED-only bypass |
| R1-m3 lone surrogate gives a client-controllable 500 | Concur, added as PR42-SEC-12 |
| R1-m4 several entries per transaction break the §5.4 budget | Concur (availability). A second `write()` takes another head lock after the first one, so the deadlock-freedom argument ("no lock after the head lock") no longer holds for two streams. It goes into the PR42-SEC-02 latch design and TASK-029/030 |
| R1-n3 `field` path "logged through `toJSON`" | The platform log serializer reads a fixed set of own properties and never calls `toJSON`. That set is `name`, redacted `message`, `stack`, `code`, `cause` and Joi `details`, or `code`, `originalCode` and `kind` for a database error. So the path does not reach the platform log today (§5.3). Hardening the path (top-level field plus indices) is still right for other sinks, and it ties to PR42-SEC-04 (personal data in keys) |
| R1-n10 shared `anonymous` key (NIT, routed to performance) | Security rates it MEDIUM (PR42-SEC-01): the key is attacker-controlled by definition, not only hot |
| Merge condition 3 (union with PR #39: `GUARDS.length`, `variable` argument) | Same as §7 |

## 7. Union with `main` after PR #40: what the union must preserve

Sequencing (D-ORCH-047/056): PR #40 merges first, then this branch merges `main` and takes fresh lane B evidence.

- **What the checker sees.** Rule (d) counts only owned paths that this PR changes. At PR #40's head `ee64946`, its 17 paths (`package.json`, `tools/ci/coverage-*`, `tools/quality/**`, `tools/repo/jest-esm.test.ts`, docs) do not overlap this PR's 46 paths.
- **Simulated union.** A simulated #40 squash on `main` plus its union with this record's commit is a clean `merge-tree` that changes 0 of this PR's paths, and the real checker passes it (§9, S5).
- **When a round is still needed.** A merge-only round is needed only if the merge changes any path this PR changes. That covers PR #40's fix cycle, or any other merge, touching `eslint.config.mjs`, `package-lock.json`, `tools/tsconfig.json`, `prisma/package.json`, `packages/config/src/**`, `apps/api/src/platform/db/**`, `apps/api/src/platform/audit/**`, `packages/shared/src/errors/catalogue/**` or `.env.example`. In S5b, a `main`-side edit to `eslint.config.mjs` voids the record.
- **PR #39 (TASK-014, open at `ace8c27`) overlaps.** It changes the owned `apps/api/src/platform/db/with-tenant-tx.ts` and the unowned `packages/config/src/{guards,index,load-config.test,values.test}.ts`. If PR #39 merges before this PR, the union voids this record and needs a merge-only round. In that union:
  - keep PR #39's `TenantTxConfigError(message, variable)` form, and pass the `DB_TENANT_*` key names in the admission throws (`resolveAdmissionOptions`);
  - keep `databaseGuard` in `GUARDS` next to PR #39's guards;
  - take the union of both export lists in `packages/config/src/index.ts`.

The union must preserve, and the next round checks:

1. **`eslint.config.mjs`:**
   - the exact-file entry `{ files: ['packages/audit/src/store/prisma-store.ts'], allow: ['setter'] }`, last in `TENANT_CONTEXT_EXEMPTIONS`, or its PR42-SEC-05 replacement;
   - the category line `packages/audit/**` → `package-audit` after `packages/*/**`;
   - `prisma/tests/audit/**` → `prisma-tests-audit` after `prisma/tests/**`;
   - the single policy `from prisma-tests-audit allow to package-audit`, and nothing more.
   - Re-run P1 (B1–B10, W1–W4, T0–T10), expecting the round-1 results unless a fix changed them.
2. **`package-lock.json`.** A deep diff against the new `main` shows exactly the `prisma` dev dependency leaf (plus whatever `main` brought). Restate the ajv tuple and the "no non-`@platform` `link: true`" statement.
3. **`tools/tsconfig.json`.** The `tenant-admission.ts` entry and the `../packages/audit` reference.
4. **`apps/api/src/platform/db/with-tenant-tx.ts`.** Admission still wraps the whole `$transaction` and is keyed from the validated values. `mapped()` checks `isAuditWriteError` first and logs only through `onDbError`.
5. **Fresh lane B evidence:**
   - profile `pr`, with the two D-SEC-PR23-02 statements verbatim in the gate table;
   - host scan 0 and lockfile hash equal;
   - `packages/audit` measured by the merged unit + integration gate that PR #40 introduces;
   - `audit-writer.int.test.ts` (17) and `tenant-admission.int.test.ts` green.
6. **Record.** A round-2 block with its own `| Head |` row (the pushed head after the fix cycle and the union) and a final `| **Verdict** |` row. The code review's R1-M1 makes a fix cycle certain, and that cycle changes owned paths (`eslint.config.mjs`, `packages/audit/**`). Round 2 is therefore a delta round: re-run P1, P2, P6 and the record simulation on the new head, plus the union checks in items 1 to 5. Without a fix cycle, a merge of `main` that changes none of this PR's paths would have kept this record valid (S5).

## 8. Checks owed (routed)

| Owner | Check | Due |
|---|---|---|
| principal-architect | PR42-SEC-01 ruling (anonymous admission classes, an `auth` reserve, the global anonymous ceiling) as an ADR-0007 am. 10 / data-model §7.7 amendment. D-TASK025-03 CHECK widening for `MFA_RECOVERY_USED` / `SESSION_REVOKED`. PR42-SEC-08 production bounds | Before TASK-052 merges; before the first emitter of either action |
| senior-developer (this PR's fix cycle, which the code review's R1-M1 requires) | PR42-SEC-06 (= R1-M1), -05 lint-level exemption shape (= R1-m1), -03 snapshot (= R1-m2), -12 `toWellFormed` (= R1-m3), -02 latch, -07 `AuditSqlPort` as a T-83 root, -04 writer guard. Items not taken in the cycle keep the owners in §3 | Fix cycle; else the §3 due points |
| TASK-029 (capture middleware) | Writer wired with `DB_AUDIT_LOCK_TIMEOUT_MS` from config; the hook is the last database work of the transaction; `route` = descriptor template, `entityId` = entity ID, `uaParsed` from a parser (04); `orgId` / `targetOrgId` from the validated context (11 (b)); best-effort VIEW and FAILED entries in a separate transaction; PR42-SEC-02 test if the latch landed | Before TASK-029 merges |
| TASK-028 (tokeniser) | No external I/O inside `tokenise` (07); error messages carry no values (§5.3); no personal data in JSON keys (04) | Before TASK-028 merges |
| TASK-030 (chain) | SEC-TC-57 at the API level; E1–E4; keep the store pin or lint shape (05); 09 size cap and lock budget; 10 security event and kind; 11 (a) catalogue parity | Before TASK-030 merges |
| TASK-033 (generator, immutability) | Per-role UPDATE/DELETE/TRUNCATE on every audit table; 11 (b) cross-stream and (c) orphan rollback; raw-SQL-on-audit-tables lint (06 backlog) | Before G3 |
| TASK-047 (worker twin) | Worker jobs without an organisation do not share the API's anonymous classes; the same latch on the job port | Before TASK-047 merges |
| TASK-014 | No `prisma/tests/**` (now including `prisma/tests/audit`) in any image; the optional Compose pins of D-TASK025-11 | With TASK-014 |
| TASK-280 | 503 `TENANT_CONCURRENCY_LIMIT` under a single-organisation load above the cap is designed behaviour (D-TASK025-10) | Before G3 |
| qa-lead | `coverage gate: packages/audit lines` / `branches` into `unit.required_cases` after PR #40 (PR40-SEC-05); a manifest-only PR with a security record | First activation checkpoint after this merge |
| security-analyst | Threat model: new T-xx and SEC-TC for PR42-SEC-01 (next text round) | Next threat-model text round |

## 9. Record simulation and secret hygiene

**Setup.** `main`'s real `tools/ci/check-security-owned-paths.mjs` (`git archive origin/main tools/ci`) ran against a sparse `git clone --shared` of the main repository. That clone checks out only `/.github/`, `/docs/05-quality/security/` and `/tools/ci/`. Scenario commits were built with plumbing (temporary index, `commit-tree`) on `e7dfbac`. Nothing was written to the main repository's refs or to the PR worktree. The record under test is this file.

| Scenario | Base → head | Expected | Result |
|---|---|---|---|
| S0 no record | `2dd6958` → `e7dfbac` | missing | missing |
| S1 this record committed on `e7dfbac` | `2dd6958` → S1 | pass | **pass**, 31 owned paths, satisfied by `e7dfbac` |
| S2 same tree, `--pr 40` | `2dd6958` → S1 | missing | missing |
| S3 owned edit after the record (`packages/audit/src/writer.ts`) | `2dd6958` → S3 | missing | missing |
| S3b owned edit after the record (`eslint.config.mjs`) | `2dd6958` → S3b | missing | missing |
| S4 docs-only evidence commit after the record | `2dd6958` → S4 | pass | pass |
| S5 union with a simulated PR #40 squash (clean `merge-tree`, 0 PR paths changed) | #40-squash → union | pass | pass |
| S5b union with a `main` that also edits `eslint.config.mjs` | edited main → union | missing | missing |
| S6 last Verdict row FAIL | `2dd6958` → S6 | missing | missing |
| S7 Head row names a commit outside the range (`main` tip) | `2dd6958` → S7 | missing | missing |
| S8 base = current `main` tip | `a0e9888` → S1 | pass | pass |

**Secret hygiene of this record.**
- It quotes no secret, no OS user name and no host path.
- A Gitleaks v8.30.1 default-ruleset emulation (Node; keyword prefilter, `secretGroup`, entropy, generic-rule digit check, rule and global allowlists; runtime-generated positive controls for a GitHub PAT, an AWS key ID and a generic key, all of which fired) reports 0 findings over its lines.
- The count-only host scan reports 0 over this file.

## 10. Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

**D-SEC-PR42-01 · 2026-11-14 · security-analyst (logged by orchestrator) · PR #42 (TASK-025) round 1 PASS_WITH_FOLLOW-UPS**

- **Decision:** PR #42 security round 1 at `e7dfbac` = PASS_WITH_FOLLOW-UPS. Nothing Critical or High; 2 MEDIUM, 6 LOW, 4 INFO.
- **Holds under probing:**
  - Chain hash over all 35 columns, recomputed from the database representation.
  - Gap-free chain under concurrent rollback; immutability for `platform_app` (42501) and the superuser.
  - Random SYSTEM shard: SEC-P3-17 closed at the writer layer (16/16 shards with a fixed correlation ID). SEC-TC-57 stays with TASK-030.
  - Generic 500/503 bodies, with `AUDIT_LOCK_TIMEOUT` and SQLSTATE only in the redacted log.
  - No permit leak (4,000 random operations); tenant isolation.
  - Exact-file `set_config` exemption; a narrow `prisma/tests/audit` → `packages/audit` allowance (8 of 8 neighbours refused); one lockfile leaf (ajv 8.20.0, no non-`@platform` `link: true`); no grant or DDL change.
- **MEDIUM:**
  - PR42-SEC-01: the single `anonymous` admission key lets 15 slow unauthenticated requests per process refuse 97 of 97 legitimate anonymous requests (sign-in, guest flows). → principal-architect ruling (anonymous admission classes with an `auth` reserve), implemented before TASK-052 merges.
  - PR42-SEC-02: rollback relies on callers rethrowing; a swallowed pre-SQL refusal commits without the entry. → rollback-only latch (`AuditSqlPort.markRollbackOnly`, checked by `withTenantTx`), this PR's fix cycle or before TASK-029 merges.
- **LOW:** 03 TOCTOU (fix cycle / before TASK-029); 04 free-text PII columns (TASK-029 plus writer guard); 05 setter pin evadable (fix cycle / before TASK-030); 06 store primitives outside the writer allow-list (fix cycle / before TASK-029); 07 `AuditSqlPort` not a T-83 root (fix cycle / before TASK-028); 12 lone surrogate gives a client-controllable 500 (fix cycle / before TASK-029).
- **Code review alignment (`474a827`, CHANGES_REQUESTED):** R1-M1 = 06, R1-m1 = 05, R1-m2 = 03, R1-m3 = 12. Security concurs that R1-M1 is fixed in this PR. R1-n10 is MEDIUM from security's side (01). The required fix cycle voids this record, so a round-2 delta and union record is due on the final head.
- **INFO:** 08 configuration extremes (principal-architect / devops, production config); 09 payload size under the lock (TASK-030/031); 10 tamper event and failure kind (TASK-030/116); 11 test gaps (TASK-030/033).
- **D-TASK025-03:** the widening of the action CHECK for `MFA_RECOVERY_USED` / `SESSION_REVOKED` is due before the first emitter merges.
- **Sequencing:** after PR #40 merges, a merge of `main` that changes none of this PR's 46 paths keeps this record valid (simulated). Any overlap, or a fix cycle, needs a round-2 record against the §7 list. PR #39 overlaps on `with-tenant-tx.ts` and `packages/config/src/**`, so if it merges first, the union needs a merge-only round.
- **Reversibility:** High.

## 11. Verdict

| Item | Value |
|---|---|
| Critical / High / Medium | 0 / 0 / 2 (PR42-SEC-01 design ruling before TASK-052; PR42-SEC-02 before TASK-029) |
| Low | 6 open: PR42-SEC-03, -04, -05, -06, -07, -12 |
| Info | 4 open: PR42-SEC-08, -09, -10, -11 |
| Closed by this PR | SEC-P3-17 (writer layer) |
| Merge needs from security | This record covers `e7dfbac`. The fix cycle that the code review requires (R1-M1) changes owned paths and voids it, so a round-2 delta and union record on the final head is needed before merge (§7) |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** The audit writer, store and bulkhead do what ADR-0007 am. 10 items 1 to 3 require, and nothing Critical or High is open. Two MEDIUM items are routed with due points: before the first anonymous sign-in route (TASK-052), and before the first production caller of the writer (TASK-029). The head `e7dfbac` is cleared from security's side. The fix cycle that the code review requires needs a round-2 delta and union record on the final head |
