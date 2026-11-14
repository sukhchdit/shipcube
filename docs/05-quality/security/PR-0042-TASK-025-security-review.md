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

---

# Delta round 2 (fix cycle 1 + union, head d2ef478)

| Field | Value |
|---|---|
| PR | #42, branch `feat/TASK-025-audit-writer-core`. Since round 1 (`e7dfbac`): this record (`21be73d`), merge of `main` with PR #40 (`b69854a`), fix commits `cd46414` (lint), `5ba9b71` (latch, snapshot, normalisation, guards), `a16ce0f` (manifest names), `01e9809` (coverage), merge of `main` (`7af2ef8`, docs only), lane B evidence (`9262c6c`) and a docs-only merge of `main` (`d2ef478`). Inputs: the PR body (D-TASK025-12..21), comment issuecomment-6873943769, and the code review round 2 that landed on `main` during this round (`f26c335`, CHANGES_REQUESTED, R2-M1; §R2.6) |
| Head | d2ef478501052ef6e2088268d3b06fb5dd4ab4dd |
| Code commit / merge base | Code `7af2ef8`; `9262c6c` adds the 7 evidence files only, and `d2ef478` merges `162a132` (docs and `.claude/` only). Merge base with `main`: `162a132` |
| Lane A evidence | Run [43573446773](https://github.com/sukhchdit/shipcube/actions/runs/43573446773) on `d2ef478` (GitHub merge ref with `47bac24`). `fast-lane` **success** with every step executed, including the lane-B evidence step with the base-ref verifier (`RANGE_BASE` `162a132`: "run 20261114T0713Z_7af2ef8 accepted"), lint, the lint-mutation check, type-check, unit, the base-ref negative fixtures and build. In `scans`, Gitleaks, Semgrep and oasdiff are green; only "Security-owned paths need a review record" failed, which this round answers |
| Lane B evidence | `docs/05-quality/tests/runs/20261114T0713Z_7af2ef8`, profile `pr`, PASS: api 127, catalog-c1-c14 74, integration 282 (1 skip), unit 4706 (2 skips). `git_sha` `7af2ef8`; only docs and `.claude/` change after it. `lockfile_sha256` equals the head's lockfile hash (recomputed). `manifest_sha256` equals the head's `required-suites.json`. Merged `packages/audit` coverage: lines 1413/1413, branches 433/433 |
| Owned paths changed | 44 (real checker, base `162a132`): `packages/audit/**` (16), `apps/api/src/platform/db/**` (12), `apps/api/src/platform/audit/**` (3), `tests/fixtures/lint/**` (5), `prisma/**` (3), and one each of `eslint.config.mjs`, `package-lock.json`, `tools/lint/negative-fixtures.test.ts`, `tools/quality/required-suites.json` and `tools/tsconfig.json`. Round 1 had 31; the 13 new ones are the fix cycle's tests, fixtures, the new `apps/api/src/platform/audit/writer.ts`, the manifest and `prisma/tests/rls/tenant-db.real-client.test.ts` |
| Reviewer / date | security-analyst, 2026-11-14, delta round 2. Read-only on code. Git ran in the main checkout against SHAs, plus a sparse `git clone --shared` in scratch checked out only at real or simulated commits. Probes ran on `git archive` extracts of `d2ef478` and of `e7dfbac` (the positive control), each with a `node_modules` of junctions to the main checkout's and `@platform/*` pointed at the extract. No command, install, build or Docker run in the PR worktree; its only change is this appended section. `.env.example` was not opened (tool policy); it is not in the `e7dfbac..7af2ef8` name list |

## R2.1 Summary

Fix cycle 1 closes what it set out to close, and the probes confirm it against the round-1 head as a positive control:

- **PR42-SEC-02 (MEDIUM) is closed.** In the real `withTenantTx` and `TenantDb` guard over a recording client, every swallowed refusal now rolls back: `INVALID_ENTRY`, `TOKENISER_UNAVAILABLE`, `TOKENISER_FAILED`, `IP_INDEX_FAILED` and `HEAD_MOVED` answer 500, and a swallowed 55P03 answers 503. On `e7dfbac` all of them committed. The new `TenantDb` member exposes nothing but the latch (§R2.4.1).
- **PR42-SEC-03, -05, -06, -07 and -12 are closed** for the forms round 1 named, plus new bypass forms (Proxies, `ownKeys` flips, look-alike `PiiValue`s, re-exports, aliased imports, `Readonly`/`Pick` port types).
- **PR42-SEC-04 is narrowed.** The writer now guards `route`, `entity_id` and `ua_parsed`. Routing the JSON-key policy to TASK-028 is acceptable with the verification in §R2.3.
- **D-TASK025-21 is exact.** The two names equal the gate's cases with classname `unit`. The head verifier requires them, the base-ref verifier does not, and lane A judged this PR with the base-ref manifest.
- **The union is pure** (three merges re-derived), evidence hygiene holds, and nothing round 1 verified regressed.

New in this round:

- **PR42-SEC-13 (MEDIUM):** the latch only sees failures that happen before the callback returns. A write that is started but not awaited (`void writer.write(…)` or `writer.write(…).catch(…)`, both lint-clean) commits the business change without its entry. This happens deterministically, even with no personal values in the entry.
- **PR42-SEC-16 (LOW, = code review R2-M1):** `apps/api/src/platform/audit/writer.ts` (`auditWriterFromConfig`, new in the fix cycle) hands the full writer to any api module through a relative import, and 7 of 7 import shapes are lint-clean.
- **PR42-SEC-15 (LOW):** writer refusals that a client can steer still give a 500. These are two object keys that normalise to the same text, and `ua_parsed` or `entity_id` passed through unvalidated (= code review R2-m1).
- **PR42-SEC-14 (INFO, = code review R2-n2):** the setter pin's regex comment-stripper is not string-aware, so a second setter between `'/*'` and `'*/'` literals, or on a template line that starts with `//`, passes both pin and lint.

**Findings now open: 2 MEDIUM (01, 13), 3 LOW (04, 15, 16), 5 INFO (08, 09, 10, 11, 14). Closed: 02, 03, 05, 06, 07, 12. Nothing Critical or High. Verdict: PASS_WITH_FOLLOW-UPS** (§R2.10).

The code review round 2 is CHANGES_REQUESTED (R2-M1), so a second fix cycle is certain. It changes owned paths (`eslint.config.mjs`, `tests/fixtures/lint/**`), and that voids this round. A round-3 delta is due on its head (§R2.7).

## R2.2 Method

| # | Probe | Result in |
|---|---|---|
| Q1 | TOCTOU matrix (31 cases) through the real `createAuditWriter` with a recording store, a slow tokeniser and a port that records `markRollbackOnly`. It covers the round-1 cases (C1–C2, M1–M6, G1), new forms N1–N20 (Proxies on the entry, origin, values and arrays, an `ownKeys` flip, a look-alike `PiiValue` with a flipping accessor, a tokeniser that mutates what it receives, a subject accessor, a reserved actor id, a deep read counter) and one refusal per failure kind. Run on head and on `e7dfbac` | §R2.3 (03, 02, 12) |
| Q2 | Latch matrix (20 cases) through the head's real `createWithTenantTx` and `createTenantDb` over a fake Prisma client that records commit or rollback. The callback swallows each failure kind, detaches the write (L8, L8b to L8d), marks a non-Error or a forged branded error, and touches the member (set, define, delete, setPrototypeOf, `ownKeys`, spread, captured reference after settle). Run on head and on `e7dfbac` | §R2.4.1, PR42-SEC-13 |
| Q3 | ESLint `lintText` with each extract's real config (type-aware rules off): boundaries B1–B10, writer allow-list W1–W12, setter exemption T0–T10 plus E1–E4, T-83 roots K1–K7. Also an exact emulation of the head's pin (`stripComments` + `setterPinViolations`) over every T and E text, and a repo-wide baseline R0–R2 in a module repository | §R2.3 (05, 06, 07), PR42-SEC-14 |
| Q4 | `wellFormed` against Node 24's `String.prototype.toWellFormed` (300,000 seeded strings weighted to surrogates, a wrong-implementation control) and its time at 8 K / 128 K / 1 M lone surrogates. The column guards ran over 21 shapes through `prepareEntry`, including 32 KB inputs | §R2.3 (04, 12) |
| Q5 | `tenant-admission.ts` on head: D1 (4,000 random operations), D2, D4 | §R2.5 |
| Q6 | `check-evidence.mjs` from `162a132` (lane A's base-ref copy), `d2ef478` and `22b0ebd`, on the sparse clone. Plus plumbing scenario commits on `d2ef478` that rename or reclassify the two audit gate cases, with `report_sha256` kept consistent | §R2.4.2 |
| Q7 | `git merge-tree --write-tree` re-derivation of `b69854a`, `7af2ef8` and `d2ef478`; a deep JSON diff of `main`'s and the head's lockfile (with a control); union simulations of `d2ef478` with `main` `f26c335` (PR #43 merged) and with PR #44's head `443c2f1` | §R2.4.3, §R2.7 |
| Q8 | Count-only host-fragment scan of the 7 evidence blobs (12 runtime-computed labels; control `.claude/` at `main`: 6 hits) | §R2.4.4 |
| Q9 | Lint cross-check of code review R2-M1: V0–V9, importing `apps/api/src/platform/audit/writer.ts` from feature code | PR42-SEC-16 |
| Q10 | Record simulation with `main`'s real checker (§R2.9) | §R2.9 |

No database, Docker or Testcontainers run. The PostgreSQL behaviour of the latch (0 business rows after a swallowed refusal or 55P03) rests on the three new `[PR #42 fix cycle 1]` integration cases, which pass in the evidence.

## R2.3 Round-1 findings: status

| ID | Round 1 | Now | Evidence |
|---|---|---|---|
| PR42-SEC-01 | MEDIUM | **Open**, owner now TASK-284 (D-ARCH-120), a dependency of TASK-052 | Code unchanged apart from `unref()` on wait timers (no security effect) |
| PR42-SEC-02 | MEDIUM | **Closed** | Q2 L1–L7: head rolls back with 500 (or 503 for 55P03); `e7dfbac` committed all seven. Q1: every refusal marks exactly once, and every stored entry marks nothing. Integration: swallowed INVALID_ENTRY gives 500 with 0 business rows; swallowed held-row 55P03 gives 503 with 0 rows. Residual: PR42-SEC-13 |
| PR42-SEC-03 | LOW | **Closed** | Q1 head: M1–M6, G1, N1–N6, N16 are SAFE (`e7dfbac`: BYPASS for all 13 except N1, which `e7dfbac` refused). The tokeniser receives frozen writer-owned copies, never the caller's object (N6, N7). The deep read counter shows that one path is read twice on head, `actor.roles.length`, against 16 paths on `e7dfbac`. That remainder (N9: a Proxy array reporting length 1 at the `MAX_ROLES` check and 40 when copied; each role is still validated) is in-process only, and it is code review R2-n1 (fix: read `length` once and index-loop) |
| PR42-SEC-04 | LOW | **Open (narrowed)**: JSON keys → TASK-028; route from the descriptor → TASK-029 | Q4: query strings, e-mail and `%40` segments, trailing slashes and 32 KB routes are refused; e-mail, `+`-phone, spaced and 32 KB entity ids are refused; raw user agents with `;` or `,` are refused; every check runs in under 1 ms. Accepted by design: templates, UUIDs, `Firefox 146 / Windows`. Inherent residuals of shape checks: a lower-case name-like literal segment (`/users/alice.smith`), a bare digit segment, a dotted name or bare phone digits as entity id, `curl/8.4.0` as `ua_parsed`. **Routing the JSON-key policy to TASK-028 (D-TASK025-16) is acceptable.** A writer-side key shape would turn client-keyed maps into the R1-m3 500 lever, and only the differ and redaction know which keys come from client data. Conditions for TASK-028: diffs carry schema field names as keys; client-keyed maps are either tokenised per key or carried as `[{key: PiiValue, value}]`; and a test shows that an e-mail-shaped key in a free-form map does not reach `audit_entries` in clear |
| PR42-SEC-05 | LOW | **Closed** for the named forms; residual PR42-SEC-14 (INFO) | Q3: T2, T9 and T10 stay lint-silent (the file is exempt for `setter`), but the head pin now fails them, and T1, T3, T4, T5, T7 and T8 too. T0 (the committed store) passes. The pin's self-test has 7 mutants and a drift guard on the rule's pattern |
| PR42-SEC-06 | LOW | **Closed** for `@platform/audit`; new path PR42-SEC-16 | Q3: W2 (`createPrismaAuditStore`), W3 (`prepareEntry`), W5 (aliased) and W8 (re-export) are reported on head and silent on `e7dfbac`. W6, W7 and W9 (namespace, dynamic, `export *`) are reported on both. Pure helpers (W3b) and types (W4) stay clean by design (D-TASK025-17). The allow-listed folders W10/W11 stay clean, and the web app (W12) now draws the allow-list error as well as boundaries |
| PR42-SEC-07 | LOW | **Closed** | Q3: K1 (`db: AuditSqlPort` in `packages/audit/src`), K3 (in an identity module), K4 (`Readonly<AuditSqlPort>`) and K5 (`Pick<AuditSqlPort, …>`) draw T-83 on head, but none on `e7dfbac`. K6, a local type alias of the port, stays silent on both; that is the accepted type-name residual of D-ARCH-106 / PR32-SEC-01. K7: the new `apps/api/src/platform/audit/writer.ts` is a whole-file root |
| PR42-SEC-08 | INFO | Open → TASK-284 (D-ARCH-121) | D4 still accepts a cap of 2^53 − 1 at the factory |
| PR42-SEC-09 / -10 / -11 | INFO | Open, routing unchanged (TASK-030/031/033/116) | 10: the new `IP_INDEX_FAILED` kind is also lost from the log line when a cause exists (`mapped()` unchanged) |
| PR42-SEC-12 | LOW | **Closed**; residual PR42-SEC-15 | Q4: `wellFormed` equals `toWellFormed` on 300,000 of 300,000 strings, and the control differs on 2,000/2,000. It is linear (1,048,576 lone surrogates in 50.9 ms). Q1 N12: a lone surrogate is stored as U+FFFD. The integration case recomputes the hash from the stored row (value and key) |

## R2.4 VERIFY items

### R2.4.1 The latch, and what the new `TenantDb` member exposes

Q2 on head (`e7dfbac` in brackets, the positive control):

| Case | Head | `e7dfbac` |
|---|---|---|
| L1–L5, L7 swallowed INVALID_ENTRY, TOKENISER_UNAVAILABLE, TOKENISER_FAILED, IP_INDEX_FAILED, HEAD_MOVED; swallow then more SQL | 500 `AUDIT_WRITE_FAILED`, rollback | resolved, commit |
| L6 swallowed 55P03 | 503 `SERVICE_UNAVAILABLE` / `AUDIT_LOCK_TIMEOUT`, rollback | resolved, commit |
| L8b detached write refused before its first `await` | 500, rollback (`prepare` runs synchronously and marks) | commit |
| L8, L8c, L8d detached write (`void` / `.catch`) still running when the callback returns | **resolved, commit; no entry** (the write's next statement gets `TENANT_TX_CLOSED`) | commit |
| L9 `markRollbackOnly('nope')` | TypeError latched, rollback | member refused |
| L10 a forged branded error marked by feature code | 503, rollback; its `sqlState` text reaches the `DbError` fields used for logs | member refused |
| L11 two concurrent transactions, one marked | marked one rolls back, the other commits | — |
| L12 latch reference kept and called after settle | `TENANT_TX_CLOSED`; the next transaction is unaffected | — |
| L13 assign, `defineProperty`, `delete`, `setPrototypeOf` on `db` | each refused (`TenantDbAccessError`); `ownKeys` = `$queryRaw`, `$executeRaw`, `markRollbackOnly` | — |
| L14 a spread copy `{ ...db }` given to the writer | rollback (the copy carries the real latch) | commit |
| L15 a hand-built port with a no-op latch | commit | commit |
| L16 / L17 controls (successful write; propagated refusal) | commit / 500 rollback | commit / 500 rollback |

**Exposure assessment.** The member is a closure over the handle's own `rollbackOnly` slot and guard state. It holds no reference to `tx`, cannot read or clear the latch (`rollbackOnly()` lives on the handle, not on `db`), is cached and non-writable through the Proxy, and is refused once the transaction has settled. What feature code can do with it:

- force a rollback, which it can already do by throwing;
- force a 503 with a forged `Symbol.for` brand (L10), which it can already do by throwing the same object (D-TASK025-19; code review R2-n3). The brand confers no capability, but a forged brand's `sqlState` skips the `SQLSTATE` shape check that real errors get. It reaches the redacting log path only, never the response.

**L15 is not a defect of the latch.** A caller that builds its own port with a no-op latch is deliberately skipping the control, which is equivalent to not calling the writer. The structural port cannot prevent that. PR42-SEC-16's boundary on who may hold a writer is the relevant control. **L8 is a defect** (PR42-SEC-13).

### R2.4.2 D-TASK025-21: the gate names

- **Exact names.** `unit.required_cases` gains exactly `coverage gate: packages/audit lines` and `coverage gate: packages/audit branches`. The evidence's `unit.junit.xml` carries both as passing cases with `classname="unit"` (lines 4685–4686). The `coverage gate (US-006) …` titles from `tools/ci/coverage-gate.test.ts` use the prefix `coverage gate (`, not the reserved `coverage gate:`, so they are not decoys.
- **Q6.** All three verifier copies accept the run. Scenario S1 (both audit cases renamed with a suffix) is accepted by the base-ref copy (`main`'s manifest does not require them) and rejected by the head copy with exactly the two required-case reasons. S2 (exact names, classname `Unit`) and S3 (exact names, a test file's classname) are rejected by both copies: the decoy rule of D-SEC-PR40-02 applies, and the head copy adds the required-case reasons. The head copy also rejects four older runs of other PRs for the missing audit names (positive control).
- **The names bind from the next PR on.** Lane A extracts `git archive "$RANGE_BASE" tools/quality` (`ci.yml:215-216`), and the run log shows the base-ref copy at `162a132` accepted this run. This PR therefore cannot self-activate a requirement its own evidence misses (the D-TASK024-16 trap), and later PRs are bound.
- **Position:** accepted, with qa-lead's acknowledgement pending as the PR asks.

### R2.4.3 The union is pure; lane A on the base-ref manifest

- **Merges.** Each of `b69854a`, `7af2ef8` and `d2ef478` equals `git merge-tree --write-tree <p1> <p2>`. After `9262c6c` only `docs/` and `.claude/` change.
- **§7 item 1, `eslint.config.mjs`.** `main` did not touch it between `2dd6958` and `22b0ebd`. The head's delta against `e7dfbac` is the four fix-cycle hunks. The exact-file setter entry is still last in `TENANT_CONTEXT_EXEMPTIONS` (line 216). `package-audit` (278) and `prisma-tests-audit` (291) sit after their parents, and the single policy is at line 448. B1–B10 give the round-1 results on head.
- **§7 item 2, `package-lock.json`.** The head's lockfile is byte-identical to `e7dfbac`'s (`3782ae2e…`), and `main`'s is unchanged since `2dd6958` (`f0d07b62…`). The deep diff against `main` is exactly 1 leaf, `packages["prisma"].devDependencies["@platform/audit"] = "0.0.0"`, and the control mutation was seen. D-SEC-PR23-02 interim statement: `node_modules/ajv` is `8.20.0`, `https://registry.npmjs.org/ajv/-/ajv-8.20.0.tgz`, MIT, with integrity equal to `main`'s. There are 15 `link: true` entries, all `node_modules/@platform/*`, and **no non-`@platform` `link: true` entry**.
- **§7 item 3, `tools/tsconfig.json`.** Unchanged since `e7dfbac`: the `tenant-admission.ts` entry (line 32) and the `../packages/audit` reference (line 47). `prisma/package.json`, `packages/config/**` and `packages/shared/src/errors/**` are unchanged too.
- **§7 item 4, `with-tenant-tx.ts`.** Admission still wraps the whole `$transaction`, keyed by `admissionKeyOf(values[0], values[2])` from the validated values. `mapped()` checks `isAuditWriteError` first and logs only through `onDbError`. The latch check sits inside `$transaction`, after `await fn(...)` and before `return`, with `revoke()` in `finally`.
- **Lane A** verified the evidence with the base-ref verifier and manifest (R2.4.2).

### R2.4.4 Evidence hygiene (D-SEC-PR23-02)

- **Gate table.** The PR body's gate table states verbatim that "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first" and that "`.git/info/exclude` is empty" (0 bytes).
- **Run.** Profile `pr`, `git_dirty: false`, `build_clean: true`, `env_overrides` empty.
- **Host-path scan** (12 labels, count-only): **0** over the 7 files. Control: 6 hits in `.claude/` at `main`.
- **Lockfile.** `lockfile_sha256` equals the recomputed SHA-256 of the head's `package-lock.json`.
- **Correction to round 1 and the PR body.** The one integration skip is `SPK-03 (d) set_config overhead`, an opt-in benchmark (`SPK03_BENCH=1`). It is not "the parked SEC-TC-43 migrator case". The same case was the skip in round 1's run, so round 1's header row repeated the error. All four SEC-TC-43 cases pass in both runs. Nothing depends on the wrong label.

### R2.4.5 Nothing regressed from round 1

- **Chain coverage.** `entry-hash.ts` (canonical object, 35 columns) is unchanged since `e7dfbac`. The 20 `audit-writer.int.test.ts` cases pass, including the recompute-from-database checks and the U+FFFD row.
- **Immutability.** No `.sql`, grant or DDL change. The `platform_app` 42501 and `AUDIT_IMMUTABLE:` case passes.
- **Generic error bodies.** `auditDbErrorMapping`, `map-db-error.ts` and the error catalogue are unchanged, and the 4 `audit-failure.api.test.ts` cases pass. The original failure is still held in the `WeakMap`.
- **No permit leak.** Q5 D1: 4,000 operations; 2,275 ran and 1,725 were refused (95 `wait`, 1,630 `depth`). No key exceeded its cap, and the end state was inflight `{0,0,0}`, queued 0 and keys 0. D2: a saturated tenant leaves another tenant admitted in 0.1 ms.
- **SYSTEM shard.** The default is still `randomInt(16)` (`writer.ts` unchanged there).

## R2.5 New findings

| ID | Title | Severity | CWE | OWASP | Location | Owner / due | Status |
|---|---|---|---|---|---|---|---|
| PR42-SEC-13 | A detached (not awaited) audit write commits the business change without its entry; the latch only sees failures raised before the callback returns | MEDIUM | CWE-778 | A09:2021 | `apps/api/src/platform/db/with-tenant-tx.ts:412-419`; `apps/api/src/platform/db/tenant-db.ts:409-413`; `packages/audit/src/writer.ts:97-109` | senior-developer: this PR's fix cycle 2, else before TASK-029 merges (its `record` + `flush` design); TASK-047 for the job port | Open |
| PR42-SEC-14 | The setter pin's comment-stripper is not string-aware: a second setter between `'/*'` and `'*/'` literals, or on a template line led by `//`, passes pin and lint (= code review R2-n2) | INFO | CWE-693 | A04:2021 | `packages/audit/src/store/prisma-store.test.ts:215` | senior-developer (fix cycle 2) or TASK-030 with D-TASK025-18's lint-level option | Open |
| PR42-SEC-15 | Writer refusals a client can steer still answer 500: keys that normalise to the same text; `ua_parsed` / `entity_id` passed through unvalidated (≈ code review R2-m1) | LOW | CWE-20 | A04:2021 | `packages/audit/src/entry.ts:336-344, 467-471, 488, 516` | TASK-029 (AC) and TASK-028 (keys), before TASK-029 merges | Open |
| PR42-SEC-16 | `auditWriterFromConfig` re-exports the writer from an allow-listed folder; any api module imports it lint-clean (= code review R2-M1) | LOW | CWE-284 | A04:2021 | `apps/api/src/platform/audit/writer.ts:13`; `eslint.config.mjs:121-131, 825`; `tools/eslint-rules/audit-writer-allowlist.mjs` | senior-developer: this PR's fix cycle 2 (the code review's MAJOR makes it certain) | Open |

### PR42-SEC-13 (MEDIUM): a detached write escapes the latch

- **Description.** `withTenantTx` reads the latch once, right after `await fn(handle.db)` resolves, and then revokes the handle. A write the callback starts but does not await is still running at that point. Its next statement gets `TENANT_TX_CLOSED`. The writer's own `catch` then calls `markRollbackOnly` on the closed handle, which throws `TENANT_TX_CLOSED` again and replaces the audit error. The transaction has already committed. Both lint-clean spellings do this: `void writer.write(db, e)` (`no-floating-promises` ignores `void` by default) and `writer.write(db, e).catch(log)` (a handled promise).
- **Probe Q2.**
  - L8: a slow tokeniser that succeeds gives commit, and no entry.
  - L8c: a tokeniser that fails after the callback returned gives commit; the detached promise settles as `TENANT_TX_CLOSED`.
  - L8d: no personal values and a store that issues two statements gives commit; `append` never completes. This is deterministic, not a race window.
  - Control L8b: a refusal raised before the write's first `await` rolls back, because `prepare` marks synchronously.
- **Exploitability / impact.** It takes a developer's missing `await` in one of the allow-listed callers. The JSDoc forbids it, but nothing enforces it. "Best-effort" audit writes (sign-in failures, views) invite the fire-and-forget spelling, though there it costs only that entry; inside a mutating transaction it costs the business change's entry. The impact is High, as for PR42-SEC-02: a mutation without its entry breaks O4 and REQ-AUDIT-004. The likelihood is Low: no caller exists yet, and TASK-029's designed `flush` is awaited. That gives **MEDIUM**. The generated audit-completeness suite (TASK-033, before G3) would catch it per route, but that suite is still `planned`.
- **Remediation (track in-flight writes on the handle; withTenantTx settles them before deciding).**

  ```ts
  // tenant-db.ts: the latch gains a tracker; feature code calling it can only delay the commit (bounded by the tx timeout).
  export interface TenantDbLatch {
    markRollbackOnly(failure: Error): void;
    track<T>(work: Promise<T>): Promise<T>;
  }
  const pending = new Set<Promise<void>>();
  const track = <T>(work: Promise<T>): Promise<T> => {
    if (state.closed) throw closedError();
    const settled = work.then(() => undefined, () => undefined);
    pending.add(settled);
    void settled.finally(() => pending.delete(settled));
    return work;
  };
  // handle: settle: async () => { while (pending.size > 0) await Promise.all([...pending]); }

  // with-tenant-tx.ts, inside the $transaction callback
  const result = await fn(handle.db);
  await handle.settle();                      // a detached write finishes, or marks, before commit
  const latched = handle.rollbackOnly();
  if (latched !== undefined) throw latched;
  return result;

  // writer.ts
  write: (db, entry) => db.track(writeOnce(db, entry)),   // AuditSqlPort gains the required `track`
  ```

  Add the `track` key to the `ownKeys` pins (`tenant-db.test`, `system-db.test`, `tenant-db.real-client.test`). TASK-047's job port implements both members.
- **Verification.** Unit tests: L8 (`void writer.write` with a 20 ms tokeniser) commits only after the entry is appended; L8c (the tokeniser fails after the callback returned) rolls back with 500; L8d rolls back or completes, but never commits without the entry. Integration case (as `platform_app`): the callback inserts a business row, starts `writer.write(...).catch(() => {})` without `await` and returns. Afterwards the business row exists only together with its entry.

### PR42-SEC-14 (INFO): the pin's comment-stripper is not string-aware

- **Description.** The pin strips `/*…*/` and whole-line `//` comments with regexes before counting `set_config`. Those regexes also strip text inside string and template literals.
- **Probe Q3.**
  - E1 appends `SELECT '/*', pg_catalog.set_config(${k}, ${v}, true), '*/'` (valid SQL).
  - E2 puts the setter on a template line that starts with `//` after a newline inside a SQL string literal.
  - E4 is E1 in upper case.
  - All three are lint-silent (`setter` is exempt in this file, and `keys` needs a literal `app.`) and **pass** the head pin.
  - E3, `UPDATE pg_catalog.pg_settings SET setting = ${v} WHERE name = ${k}`, passes too, but that is repo-wide (below).
- **Why INFO.** It needs a deliberately disguised edit of a CODEOWNED file under a security record. The same author can already hide a setter from `platform/tenant-context-sql` anywhere in the repository by dynamic SQL: R2, a DO block with a concatenated function name and key, is lint-silent in a module repository. So the pin is not the binding control; owned-path review is.
- **Remediation.** Count over the raw source: no comment in `prisma-store.ts` contains the setter name, as the code review checked. Alternatively strip comments with the TypeScript scanner. Add E1 and E2 to the self-test mutants. D-TASK025-18's lint-level `allowSetterKeys` remains the structural option for TASK-030.
- **Repo-wide note for PR44-SEC-05 (020-D, not this PR).** `UPDATE pg_catalog.pg_settings … WHERE name = ${k}` is a session-level `SET` with a bound key. It and a DO-block `EXECUTE` with a concatenated setter name (R1, R2) are invisible to every lint rule in a module repository. Add both shapes to the D-ARCH-124 scanner's scope; the next-checkout leak probe (`hasLeakedContext`) stays the run-time backstop for `app.*` keys.

### PR42-SEC-15 (LOW): writer refusals a client can steer

- **Description.** The fix cycle removed the lone-surrogate 500, but three refusals that a client can steer remain:
  - **Key collision.** A JSON object with two keys that normalise to the same text, such as `k` plus U+D800 and `k` plus U+DBFF, is refused with INVALID_ENTRY (Q1 N13). `JSON.parse` keeps both keys, so a client-keyed map reaching a diff answers 500.
  - **`uaParsed` and `entityId`.** If the capture hook passes a parser's family, or a path parameter before validation, a client can shape either value into a refusal (code review R2-m1).
  - **jsonb business columns.** The same JSON body may already fail in the business insert, by reasoning, not probed (no database this round). Prisma serialises a jsonb value with `JSON.stringify`, which escapes a lone surrogate, and PostgreSQL's json parser refuses an unpaired surrogate escape (22P02).
- **Exploitability / impact.** Same as PR42-SEC-12: a client-controlled 5xx that feeds `ROLLBACK_TRIGGERS`. No data effect. Today it depends on how TASK-028/029 build entries. Impact L × likelihood H if a caller passes raw values gives **LOW**.
- **Remediation.**
  - **TASK-029 AC.** The capture hook passes `uaParsed` only when the parser output matches the writer's shape, else `null`. `entityId` is a validated id, else `null` on DENIED and pre-validation entries. The JSON body boundary answers 400 for NUL **and for lone surrogates in strings and keys** (this extends D-TASK025-13's NUL item).
  - **TASK-028.** Client-keyed maps never reach a diff as raw keys (also covers PR42-SEC-04).
  - The writer may keep refusing; the refusal then only fires on server bugs.
- **Verification.** Api tests: a body with a colliding key pair, a crafted `User-Agent` and an e-mail path parameter each answer 400 or the route's normal status, never 500.

### PR42-SEC-16 (LOW): the writer is reachable through `apps/api/src/platform/audit/writer.ts`

- **Description.** `platform/audit-writer-allowlist` recognises the writer by `@platform/audit` export names and by a specifier ending in `audit/src/writer`. The new composition module sits in an allow-listed folder, so the rule is off inside it. Nothing polices who imports it, and it returns a full writer over the Prisma store.
- **Probe Q9** (head config, importer `apps/api/src/modules/quotes/service/`).
  - V0, the control (`createAuditWriter` from `@platform/audit`), is reported.
  - These are all **CLEAN**: V1 (named import of `../../../platform/audit/writer.js`), V2 (namespace import), V3 (dynamic `import()`), V4 (re-export), V5 (from a repository), V6 (the `platform/./audit` spelling) and V7 (from a file at the app root).
  - V8 (the allow-listed identity module) and V9 (type-only import) are clean by design.
  - This confirms code review R2-M1 independently.
- **Exploitability / impact.** Feature code can append any validated entry (any action, actor or outcome) to its tenant's chain. That is a forged or misleading audit trail, and it defeats REQ-AUDIT-001's "writer only from allow-listed callers". It needs a developer's import, under review. Impact M × likelihood L gives **LOW**, the same reasoning as PR42-SEC-06. TASK-029 will add more capabilities to this folder.
- **Remediation.** Choose one of the code review's two fixes and keep the fixtures in either case.
  - **Preferred: a resolved-file boundaries policy.**

    ```js
    // eslint.config.mjs (sketch in the file's own policy style): categories accumulate
    { pattern: 'apps/api/src/platform/audit/**', category: 'api-platform-audit' },
    ...AUDIT_WRITER_ALLOW_LIST.map((pattern) => ({ pattern, category: 'audit-writer-caller' })),
    { from: { file: { categories: { anyOf: ['api-module'], noneOf: ['audit-writer-caller', 'test'] } } },
      disallow: { to: { file: { categories: 'api-platform-audit' } } }, importKind: 'value',
      message: 'REQ-AUDIT-001: the audit writer composition is imported only by allow-listed callers' },
    ```

  - **Alternative: a rule arm.** The rule resolves a relative specifier with `path.posix.normalize(path.posix.join(dirname(file), spec))` and reports any target under `apps/*/src/platform/audit/`.
  - **Fixtures.** A negative one for each of V1, V3, V4 and V6, a positive one from an allow-listed module, and a self-check that deleting the policy turns the negative fixtures green.
- **Verification.** V1–V7 reported, V0 still reported, V8 and V9 clean, and the head's real files lint clean.

## R2.6 Code review round 2 (`f26c335`, CHANGES_REQUESTED): alignment

| Code review item | Security view |
|---|---|
| R2-M1 (MAJOR) writer re-exported from `apps/api/src/platform/audit/` | Same defect as PR42-SEC-16, found independently (Q9). Concur: fix in this PR |
| R2-m1 (MINOR) client-shapeable `uaParsed` / `entityId` give 500 | Part of PR42-SEC-15, which adds the key-collision refusal and the jsonb boundary item |
| R2-n1 `actor.roles` read twice / own `map` | Same as Q1 N9 (§R2.3, 03). In-process only; fix welcome in cycle 2 |
| R2-n2 pin hides a setter between `'/*'` and `'*/'` | Same as PR42-SEC-14 (E1), plus the `//`-line form E2 |
| R2-n3 brand untested and forgeable | Concur. Q2 L10 shows a forged brand maps only to the generic 503 and rolls back; no capability beyond throwing |
| Latch "sound, 7/7 mutants" | Concur for awaited writes. The detached write (PR42-SEC-13) is outside its mutants |

## R2.7 Sequencing: what voids this round

The record checker voids a round when an owned path that the PR changes changes after the named commit (rule (d)). Paths that only `main` changes do not void it.

1. **Docs-only commits after this record:** valid (simulated, S4).
2. **Fix cycle 2** (code review R2-M1 and PR42-SEC-16) changes `eslint.config.mjs` and `tests/fixtures/lint/**`. That **voids this round**, and round 3 is a delta: Q9 (V0–V9 plus the fixture spellings), Q3 W and B rows, the self-check mutant, plus Q1/Q2 if PR42-SEC-13/-14/R2-n1 ride the cycle, fresh lane B evidence, and the record simulation.
3. **A later merge of `main`.**
   - **PR #45's files alone** (`.gitleaks.toml`, `tools/ci/sec-static.test.ts`, `tools/quality/gitleaks-baseline.txt`) do **not** void the record, because this PR changes none of them (S5 passes). They do make the lane B run stale: `check-evidence` rejects `7af2ef8` against a union head (S9). So fresh evidence is needed after such a merge, but no new security round.
   - **But `main` has moved past that.** Its tip when this round was written was `e2d0fa2` (only docs after `cc2a57d`), and it contains PR #43 (`cc2a57d`), which changes `eslint.config.mjs` and `tools/lint/negative-fixtures.test.ts`. Both are paths this PR changes. **Any merge of current `main` voids this round** (S5b). The union itself is clean: `merge-tree` `c799a11`, with this PR's allow-list, T-83, exemption, category and policy lines intact. It needs a merge-only check of §7 items 1–5, or it folds into round 3.
   - **qa-lead's `rls-cross-tenant` activation PR** (D-ORCH-071/074) edits `tools/quality/required-suites.json`. Once on `main`, a merge of it voids this round too (a different line of the same owned file, so the textual merge is clean).
4. **PR #44 (020-C, open at `443c2f1`).** The union is **not** textually clean: `tools/lint/negative-fixtures.test.ts` conflicts, because both PRs add rows. `with-tenant-tx.ts`, `db/index.ts` and `eslint.config.mjs` auto-merge correctly. In the simulated union, the `readOnly` statement precedes `createTenantDb` (line 419/420), the latch check follows `fn` (425), admission wraps `$transaction` (436), and `TENANT_TX_HANDLE_TYPES` keeps `AuditSqlPort`. Whichever PR merges second:
   - keeps both PRs' fixture rows;
   - switches `execute-phases.test.ts`'s stand-in reason `TRANSACTION_UNAVAILABLE` to `TENANT_CONCURRENCY_LIMIT`;
   - keeps one admission permit per phase transaction. The latch is per handle, so a phase cannot latch another;
   - adds `markRollbackOnly` (and `track`, if PR42-SEC-13 lands) to any `Reflect.ownKeys(db)` pin. PR #44's changed files hold none today;
   - takes the union of the `db/index.ts` exports (`TenantTxCallOptions`).
   It voids whichever record it lands on.
5. **PR #39 (TASK-014, open at `7dd3c64`):** unchanged from round 1: `GUARDS.length === 15`, the `variable` argument in the admission `TenantTxConfigError`s, and images that ship `packages/audit` with `canonicalize`.

## R2.8 Checks owed (routed; updates §8)

| Owner | Check | Due |
|---|---|---|
| senior-developer (fix cycle 2) | PR42-SEC-16 (= R2-M1) with fixtures and self-check; PR42-SEC-13 `track` + settle (or explicitly routed to TASK-029); PR42-SEC-14 raw-source count and E1/E2 mutants; R2-n1 `roles` index loop; R2-n3 brand test | Fix cycle 2; else the §R2.5 due points |
| TASK-029 (capture middleware) | PR42-SEC-15 AC (`uaParsed`/`entityId` null unless valid; 400 for NUL and lone surrogates in JSON strings and keys); PR42-SEC-13 if not taken in cycle 2 (`flush` awaited and tracked); route = descriptor template (04) | Before TASK-029 merges |
| TASK-028 (tokeniser, redaction) | JSON-key policy with the 04 verification (no e-mail-shaped key in clear); no external I/O in `tokenise` (07 lint now enforces it for `AuditSqlPort` parameters) | Before TASK-028 merges |
| TASK-047 (worker twin) | The job port implements `markRollbackOnly` (and `track`); worker anonymous class (01) | Before TASK-047 merges |
| TASK-020 part 020-D (PR44-SEC-05) | Add `UPDATE pg_settings` and DO-block concatenated setters to the D-ARCH-124 scanner scope | With 020-D, before G3 |
| TASK-284 / TASK-285 | PR42-SEC-01 and -08 (D-ARCH-120/121); CHECK widening for `MFA_RECOVERY_USED` / `SESSION_REVOKED` (D-ARCH-119) | Before TASK-052 merges / before the first emitter |
| qa-lead | Acknowledge D-TASK025-21 | Activation PR |
| TASK-030 / -031 / -033 / -116 | 09, 10 (now including `IP_INDEX_FAILED`), 11 as in §8; the audit-completeness generator also asserts PR42-SEC-13's property per route | As in §8 |

## R2.9 Record simulation and secret hygiene

**Setup.** `main`'s real `tools/ci/check-security-owned-paths.mjs` (`git archive` of `main` `f26c335`, and of `162a132` for lane A's base-ref copy) ran against the sparse shared clone (`/.github/`, `/docs/05-quality/`, `/tools/`, `/package*.json`). Scenario commits were built with plumbing on `d2ef478`, and the record under test is this file. Nothing was written to the main repository's refs or to the PR worktree. In S5 to S9 the union commits were made with `merge-tree --write-tree` plus `commit-tree`.

| Scenario | Base → head | Expected | Result |
|---|---|---|---|
| S0 round-1 record only (as committed at `d2ef478`) | `162a132` → `d2ef478` | missing | missing (names `e7dfbac`; 29 owned paths changed after it) |
| S1 this record committed on `d2ef478` | `162a132` → S1 | pass | **pass**, 44 owned paths, satisfied by `d2ef478` |
| S1b S1 with lane A's base-ref checker copy (`162a132`) | `162a132` → S1 | pass | pass |
| S2 same tree, `--pr 40` | `162a132` → S1 | missing | missing |
| S3 owned edit after the record (`packages/audit/src/writer.ts`) | `162a132` → S3 | missing | missing |
| S3b owned edit after the record (`tools/quality/required-suites.json`) | `162a132` → S3b | missing | missing |
| S4 docs-only commit after the record | `162a132` → S4 | pass | pass |
| S5 union with `22b0ebd` (PR #45 files) | `22b0ebd` → S5 | pass | pass |
| S5b union with `main` `f26c335` (PR #43: `eslint.config.mjs`, `negative-fixtures.test.ts`) | `f26c335` → S5b | missing | missing |
| S6 the last Verdict row FAIL | `162a132` → S6 | missing | missing |
| S7 the Head row names `main`'s tip | `162a132` → S7 | missing | missing |
| S9 `check-evidence` (head copy) on the S5 union | `22b0ebd` → S5 | stale | `20261114T0713Z_7af2ef8` rejected as stale (3 paths: `.gitleaks.toml`, `tools/ci/sec-static.test.ts`, `tools/quality/gitleaks-baseline.txt`) |

**Secret hygiene of this section.**
- It quotes no secret, no OS user name and no host path; probe sentinels were random and are not quoted.
- The Gitleaks v8.30.1 default-ruleset emulation reports 0 findings over the appended lines. Its runtime positive controls (a GitHub PAT, an AWS key ID and a generic key) fired.
- The count-only host scan reports 0 over this file.

## R2.10 Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

**D-SEC-PR42-02 · 2026-11-14 · security-analyst (logged by orchestrator) · PR #42 (TASK-025) delta round 2 at d2ef478: PASS_WITH_FOLLOW-UPS**

- **Decision:** PR #42 delta round 2 at `d2ef478` (fix cycle 1 + union with PR #38/#40) = PASS_WITH_FOLLOW-UPS. Nothing Critical or High.
- **Closed, each probed against `e7dfbac` as the positive control:**
  - **PR42-SEC-02.** Swallowed INVALID_ENTRY, TOKENISER_UNAVAILABLE, TOKENISER_FAILED, IP_INDEX_FAILED and HEAD_MOVED now roll back with 500, and a swallowed 55P03 with 503 (all committed before). The new `TenantDb` member is a non-writable closure with no `tx` reference, refused after settle.
  - **PR42-SEC-03.** 13 bypass forms, including Proxies, `ownKeys` flips and look-alike `PiiValue`s, are now SAFE.
  - **PR42-SEC-05** (named forms), **-06** (`@platform/audit` names, aliases, re-exports) and **-07** (`AuditSqlPort`, `Readonly`/`Pick` forms).
  - **PR42-SEC-12.** `wellFormed` equals `toWellFormed` on 300,000 of 300,000 strings, and is linear.
- **Narrowed:** PR42-SEC-04. The writer guards route, entity id and `ua_parsed`. Routing the JSON-key policy to TASK-028 (D-TASK025-16) is accepted, with a test that no e-mail-shaped key reaches the row in clear.
- **New:**
  - **PR42-SEC-13 (MEDIUM).** A detached (`void` or `.catch`, lint-clean) write commits the business change without its entry, deterministically. Fix: track in-flight writes on the handle and settle them before the latch check. Owner: fix cycle 2, else before TASK-029 merges; TASK-047 for the job port.
  - **PR42-SEC-14 (INFO, = R2-n2).** The setter pin's regex stripper is fooled by `'/*'`…`'*/'` literals and by `//`-led template lines. Fix: count over the raw source.
  - **PR42-SEC-15 (LOW, ⊇ R2-m1).** Colliding normalised keys and unvalidated `uaParsed`/`entityId` are client-steerable 500s. Fix: TASK-029 AC (null unless valid; 400 for NUL and lone surrogates in JSON strings and keys) and TASK-028.
  - **PR42-SEC-16 (LOW, = R2-M1).** `auditWriterFromConfig` is importable by any api module (7/7 shapes lint-clean). Fix: a resolved-file boundaries policy, with fixtures, in fix cycle 2.
  - **Repo-wide note for PR44-SEC-05 / 020-D:** `UPDATE pg_settings` and DO-block concatenated setters are invisible to every lint rule.
- **D-TASK025-12..21:** all accepted. 16 with the TASK-028 condition; 17 incomplete until PR42-SEC-16 is fixed; 19's brand is forgeable but confers only the generic 500/503; 21 is exact (classname `unit`; the head verifier rejects a run without the cases while the base-ref verifier accepts it, so the names bind from the next PR on).
- **Union and evidence:**
  - The union is pure (three merges re-derived).
  - The lockfile is one leaf (ajv 8.20.0, no non-`@platform` `link: true`).
  - Evidence `20261114T0713Z_7af2ef8`: the verbatim D-SEC-PR23-02 statements are present, the host scan is 0 and the lockfile hash matches.
  - Correction: the integration skip is the opt-in `SPK-03 (d)` benchmark, not SEC-TC-43.
- **Sequencing:**
  - The code review's R2-M1 fix cycle voids this round, so a round-3 delta is due on its head.
  - A merge of `main` voids it too, now that `main` holds PR #43 (`eslint.config.mjs`, `negative-fixtures.test.ts`). PR #45's files alone would not, but they would make the lane B evidence stale.
  - The PR #44 union conflicts in `negative-fixtures.test.ts`.
- **Reversibility:** High.

## R2.11 Verdict (round 2)

| Item | Value |
|---|---|
| Critical / High / Medium | 0 / 0 / 2 (PR42-SEC-01 → TASK-284 before TASK-052; PR42-SEC-13 → fix cycle 2, else before TASK-029) |
| Low | 3 open: PR42-SEC-04 (narrowed), -15, -16 |
| Info | 5 open: PR42-SEC-08, -09, -10, -11, -14 |
| Closed by this round | PR42-SEC-02, -03, -05, -06, -07, -12 |
| Merge needs from security | This round covers `d2ef478` and any later docs-only head. The code review's fix cycle 2 (R2-M1 = PR42-SEC-16) and any merge of current `main` change owned paths and void it. A round-3 delta (§R2.7 item 2, plus the §7 union checks if `main` is merged) is due on the final head |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** Fix cycle 1 closes PR42-SEC-02, -03, -05, -06, -07 and -12 under probing. Nothing Critical or High is open. PR42-SEC-13 (MEDIUM) and -16 (LOW) are best fixed in the fix cycle 2 that the code review already requires; the rest are routed with due points. The head `d2ef478` is cleared from security's side |

---

# Delta round 3 (fix cycle 2 + unions, head 96bd37a)

| Field | Value |
|---|---|
| PR | #42, branch `feat/TASK-025-audit-writer-core`. Since round 2 (`d2ef478`): this record (`d611fda`); fix commits `c459988` (PR42-SEC-13), `e02fec6` (R2-M1 / PR42-SEC-16), `e789232` (R2-n1, R2-n2 / PR42-SEC-14, R2-n3), `13dd72a` (union with PR #44: admission stand-in reason) and `8d346fa` (CI lint heap, D-TASK025-29); merges `c7636ec` (PR #43, #45), `5964962` (docs), `c65f205` (PR #44), `7e9fb3c` (docs) and `6e3ec99` (PR #47); evidence commits `29e1a60`, `5f3168c` (both superseded) and `96bd37a`. Inputs: the PR body (D-TASK025-22..29), D-ORCH-081/082, D-SEC-PR47-01, and the code review round 3 that landed on `main` during this round (`1be9a74`, APPROVED_WITH_NITS; §R3.6) |
| Head | 96bd37a7b9dc4d32fd57c6badd8db19b28e2116b |
| Code commit / merge base | Code `6e3ec99`; `96bd37a` adds the 8 evidence files only. Merge base with `main`: `d753027`. `main`'s tip when this round was written: `9daad95`, with only `docs/` and `.claude/` changes after `d753027` (among them this PR's code review round 3) |
| Lane A evidence | Run [43608317119](https://github.com/sukhchdit/shipcube/actions/runs/43608317119) on `96bd37a`. `fast-lane` **success**, with every step executed: base-ref gate tooling, workflow policy, install flags, migration immutability, lockfile provenance and delta, cooldown, `npm ci --ignore-scripts`, licences, registry signatures, audit + osv, the lane-B evidence step (base-ref verifier, `RANGE_BASE` `d753027`: "run 20261114T1437Z_6e3ec99 accepted"), `deps:rebuild`, commitlint, lint (with the new step env; 40 s; `check-suppressions`: 5 suppressions in 667 files, 0 findings), the lint-mutation check, format, actionlint, type-check, unit, the base-ref lint negative fixtures, build and the build-mutation check. In `scans`, Gitleaks, Semgrep and oasdiff are green. Only "Security-owned paths need a review record" failed, which this round answers |
| Lane B evidence | `docs/05-quality/tests/runs/20261114T1437Z_6e3ec99`, profile `pr`, PASS: api 128, catalog-c1-c14 102, integration 319 (1 skip, the opt-in SPK-03 benchmark in `prisma/tests/spikes/spk03-rls-tx.int.test.ts`), **rls-cross-tenant 126** (0 skips, 13 `[SEC-TC-06]`), unit 5008 (2 skips). `git_sha` `6e3ec99`, `git_dirty: false`, `build_clean: true`, `env_overrides` empty. `lockfile_sha256` and `manifest_sha256` equal the head's `package-lock.json` and `tools/quality/required-suites.json` (recomputed); every `report_sha256` and the coverage attachment hash recompute equal. Merged `packages/audit`: lines 1437/1437, branches 442/442 (recomputed from `coverage-summary.json`) |
| Owned paths changed | 61 (real checker, base `d753027`): `packages/audit/**` (16), `apps/api/src/platform/db/**` (12), `apps/api/src/platform/audit/**` (3), `tests/fixtures/lint/**` (20), `prisma/**` (3), and one each of `.github/workflows/ci.yml`, `apps/api/src/platform/tx/execute-phases.test.ts`, `eslint.config.mjs`, `package-lock.json`, `tools/lint/negative-fixtures.test.ts`, `tools/quality/required-suites.json` and `tools/tsconfig.json`. Round 2 had 44. 39 owned paths changed after `d2ef478` beyond what the merges brought: the fix-cycle files, the 15 new `layering/audit-writer-composition` fixtures, `ci.yml` and `execute-phases.test.ts` |
| Reviewer / date | security-analyst, 2026-11-14, delta round 3. Read-only on code. Git ran in the main checkout against SHAs, plus a sparse `git clone --shared` in scratch checked out only at real or simulated commits. Probes ran on `git archive` extracts of `96bd37a`, of `d2ef478` (the positive control) and of `d753027`. No install, build, test run or Docker. In the PR worktree I ran only a read-only `git --no-optional-locks status` / `rev-parse` and the owned-paths checker reading its files; its only change is this appended section. `.env.example` is not in the round's change set (`d2ef478..6e3ec99` beyond the merges). The shared scratchpad was wiped mid-round (other agents); results below were recorded before the wipe, and the R2-n1 probe was re-run on rebuilt extracts |

## R3.1 Summary

Fix cycle 2 closes what it set out to close. Every probe ran on `96bd37a` and on `d2ef478` as the positive control, and the fixes were mutated to show each part is load-bearing:

- **PR42-SEC-16 (= code review R2-M1) is closed.** The resolved-file boundaries policy reports 28 import cases with the composition message, 27 of them lint-clean on `d2ef478`: every module form (named, namespace, `import()`, re-export, `export *`, `export * as`, side-effect, `require`, `module.require`, `createRequire(u)(…)`) and every spelling (`./`, `..` detours, `.ts`, no extension, `?query`, template-literal `import()`), from feature modules, repositories, the app root, `apps/api` outside `src` and three platform folders. Type-only imports stay clean. The tx-slot → `capture.ts` exception is exact-file (§R3.4.1).
- **PR42-SEC-13 is closed as filed.** All six detached-write cases that committed without their entry on `d2ef478` now commit with it or roll back (L8, L8c, L8d, plus L8e–L8g). `track` after revoke throws before the work starts (0 statements). The settle loop can be starved or held open only the way any callback can already hold its transaction: integrity holds through Prisma's transaction timeout, and nothing new is rated (§R3.4.2).
- **PR42-SEC-14, R2-n1 and R2-n3 are closed** (§R3.4.3).
- **D-TASK025-29 (`ci.yml`) is a literal heap size on the Lint step only.** No preload, no rule or file dropped, both policy copies pass, and nothing PR-controlled reaches the value (§R3.4.4).
- **The unions are pure** (five merges re-derived). D-TASK025-21's two names sit on top of PR #47's manifest exactly. **SEC-TC-74 does not move in this PR**: under D-SEC-PR47-01 (2) (b) the qa-lead manifest-only PR is its home (§R3.4.5). The evidence hygiene holds (§R3.4.6).

New in this round:

- **PR42-SEC-17 (MEDIUM):** `settle` sees only work registered before it last looks. An audit write whose *start* is deferred is refused after the commit decision, and the business change commits without its entry. Probed shapes: chained one or more microtask hops later, after a detached statement, or as the natural "read the before-image, then write" detached block. A two-part hardening, probe-validated, closes all of these except timer-deferred starts.
- **PR42-SEC-19 (LOW, = code review R3-m1):** a voided audit write that fails is an unhandled rejection, and the API treats that as fatal.
- **PR42-SEC-18 (INFO):** the Lint gate's step env is not pinned by `required-gates`. An expression-valued `NODE_OPTIONS`, or a `BASH_ENV` beside the new line, passes the base-ref policy (PR17-SEC-08 class).

**Findings now open: 2 MEDIUM (01, 17), 3 LOW (04, 15, 19), 5 INFO (08, 09, 10, 11, 18). Closed this round: 13, 14, 16 (and the code review's R2-n1, R2-n3). Nothing Critical or High. Verdict: PASS_WITH_FOLLOW-UPS** (§R3.11).

## R3.2 Method

| # | Probe | Result in |
|---|---|---|
| A | ESLint `lintText` with each extract's real `eslint.config.mjs` (type-aware rules off, nothing written; extracts built from the long path so the resolved-file arm is inside `boundaries/root-path`). 47 cases: V0–V10 (importer forms, spellings, importers), T1–T6 (tx slot and `capture.ts`), L1–L3 (two-hop laundering through planted files, removed afterwards). Run on head, `d2ef478` and `d753027`, and on five config mutants of the head | §R3.4.1 |
| B | `track`/`settle` matrix through the head's real `createWithTenantTx`, `createTenantDb` and `createAuditWriter` (type-stripped, resolve/load hook) over a fake Prisma client that serialises statements per transaction like one pg connection, logs every statement, COMMIT and ROLLBACK in order, and behaves like Prisma 7.10.1 on an interactive-transaction timeout (the callback is still awaited; COMMIT then fails). Verdict per case from the event order: "committed with entry", "rolled back" or "COMMIT WITHOUT ENTRY". 23 cases, on head and on `d2ef478` | §R3.4.2, PR42-SEC-17 |
| C | Mutants of the fix on a scratch copy (restored byte for byte, checked with `cmp`): settle line removed, settle without its loop, `write` not tracked, `track` accepted after revoke; and two hardening candidates (H1, H2) | §R3.4.2, PR42-SEC-17 |
| D | Emulation of the head pin (raw source) and the `d2ef478` pin (its own `stripComments`, read from that test file) over the real store plus 7 mutants | §R3.4.3 |
| E | `prepareEntry` with Proxy role arrays (length flips, NaN, string), an own `map`, controls; head and `d2ef478` | §R3.4.3 |
| F | `checkWorkflow(…, { requiredGates: true })` of `main`'s and the head's `check-workflow-policy.mjs` (byte-identical) over the head `ci.yml` and 9 Lint-step variants, `main`'s `ci.yml` as control; Node 24.22.3 `NODE_OPTIONS` acceptance of `--env-file`, `--env-file-if-exists`, `--experimental-config-file`, `--experimental-default-config-file`, `--conditions`, `--require`, `--import` | §R3.4.4, PR42-SEC-18 |
| G | `git merge-tree --write-tree` re-derivation of the five merges; a line-multiset check of the `negative-fixtures.test.ts` conflict resolution; deep JSON diff of `main`'s and the head's lockfile (with a mutation control); manifest leaf diff; overlap and `merge-tree` of the head with PR #46 (`ad30316`) and PR #39 (`c85d5e5`) | §R3.4.5, §R3.7 |
| H | Evidence: recomputed hashes, JUnit case checks, count-only host-fragment scan of the 8 evidence files (13 runtime-computed labels; control: `git worktree list` output, 212 hits) | §R3.4.6 |
| I | Record simulation with `main`'s real checker (§R3.9) | §R3.9 |

The PostgreSQL behaviour of the fix rests on the two `[PR #42 fix cycle 2]` integration cases, which pass in the evidence: a detached write whose tokeniser fails after the callback returned gives 500 with 0 business rows and 0 entries, and a detached `void` write that succeeds is appended with the business row and its hash recomputes.

## R3.3 Findings: status

| ID | Round 2 | Now | Evidence |
|---|---|---|---|
| PR42-SEC-01 | MEDIUM | **Open**, TASK-284 (D-ARCH-120) before TASK-052 | `tenant-admission.ts` unchanged since round 2 |
| PR42-SEC-04 | LOW (narrowed) | **Open**, JSON keys → TASK-028, route → TASK-029 | Writer guards unchanged (D-TASK025-27) |
| PR42-SEC-08 / -09 / -10 / -11 | INFO | Open, routing unchanged | — |
| PR42-SEC-13 | MEDIUM | **Closed as filed**; residual PR42-SEC-17 (deferred start) | §R3.4.2 |
| PR42-SEC-14 | INFO | **Closed** | §R3.4.3 |
| PR42-SEC-15 | LOW | **Open**, routed by D-TASK025-27 (TASK-029 AC (a)–(c), TASK-028) | The code review's R3.4 asks the orchestrator to copy (a)–(c) into TASK-029's AC verbatim; concur |
| PR42-SEC-16 | LOW | **Closed** | §R3.4.1 |

## R3.4 VERIFY items

### R3.4.1 PR42-SEC-16: the resolved-file policy (`eslint.config.mjs:291-297`, `:597-602`)

Probe A, importer `apps/api/src/modules/quotes/service/` unless stated. "R2-M1" means `boundaries/dependencies` with the REQ-AUDIT-001 composition message.

| Case | `96bd37a` | `d2ef478` |
|---|---|---|
| V0 control: `createAuditWriter` from `@platform/audit` | `audit-writer-allowlist` | `audit-writer-allowlist` |
| V1–V4c named import, namespace import, `import()`, named re-export, `export *`, `export * as ns` of `platform/audit/writer.js` | R2-M1 (each) | clean (each) |
| V5 from a repository | R2-M1 | clean |
| V6, V6b–V6f spellings: `platform/./audit`, `platform/db/../audit`, `.ts`, no extension, `?x=1`, template-literal `import()` | R2-M1 (each) | clean (each) |
| V6l side-effect `import`, V6m `module.require`, V6h `createRequire(import.meta.url)('…')` | R2-M1 (V6h also `static-module-specifier`) | clean |
| V6k bare `require('…')` | R2-M1 + `no-require-imports` | `no-require-imports` |
| V6g computed `import(s)`, V6i stored `createRequire` | `static-module-specifier` | `static-module-specifier` / clean (PR #44's rule) |
| V6j `import w = require('…')` | lint crash in `static-module-specifier` (`module-sources.mjs:80`), fails closed | `no-require-imports` |
| V6n `platform/Audit/Writer.js` | `no-unresolved` | `no-unresolved` |
| V7, V7b–V7e importers: app root `src` file, `apps/api` outside `src`, `platform/http`, `platform/runtime`, `platform/routing` | R2-M1 (each) | clean (each) |
| V7f worker file, V7g package file | existing app/package policies + `no-relative-packages` | same |
| V8, V8b, V8c allow-listed importers: identity service, `platform/db`, a `platform/audit` sibling | clean | clean |
| V9 `import type`, V9c `export type … from`, V9e `import type * as` | clean | clean |
| V9b `import { type X }` (inline specifier only) | R2-M1 (fails closed) | clean |
| V9d `typeof import('…')` | `consistent-type-imports` only | same |
| V10 a `*.test.ts` importer | clean (by design) | clean |
| T1, T1b tx slot → `../audit/capture.js`, `../audit/./capture.js` | clean (the exception) | clean |
| T2 tx slot → `writer.ts`; T3 tx slot → another file of the folder; T4 nested tx slot → `writer.ts` | R2-M1 (each) | clean (each) |
| T5 feature module → `capture.ts`; T6 `platform/http` → `capture.ts` | R2-M1 (each) | clean (each) |
| L1 service → a `tests/` helper that re-exports the writer; L2 service → a `*.test.ts` that re-exports it | clean | clean |
| L3 quotes service → an identity-service file that re-exports it | `boundaries/dependencies` (module boundary, not R2-M1) | same |

**Mutants of the policy** (scratch config copies; changed rows only):

| Mutant | Effect |
|---|---|
| M1 the disallow policy deleted | all 28 R2-M1 rows go clean |
| M2 `dependency: { kind: 'value' }` dropped | V9, V9c, V9d, V9e reported: types would no longer be allowed |
| M3 the tx-slot allow deleted | T1, T1b reported |
| M4 the tx-slot allow widened to `api-platform-audit` | T2, T3, T4 go clean |
| M5 `audit-writer-caller` dropped from `noneOf` | V8, V8b, V8c reported |

**Position.**
- The policy blocks every module import form and spelling I could build, and types stay importable (V9, V9c, V9e).
- **The exception is narrow.** Its target category is the exact file `apps/api/src/platform/audit/capture.ts` (T3 refuses any other file of the folder from the tx slot), and only non-test files of `apps/api/src/platform/tx/**` hold it (T5 and T6 refuse `capture.ts` to everyone else).
- **Concur with code review R3-n1:** the committed negative rows only import `writer.ts`, so mutants M4-like (allow widened) and a category narrowed to `writer.ts` survive the fixtures. Probe T3/T5 show the real config is right; one fixture row importing `capture.ts` from a module service closes the gap in the tests. Concur with R3.4: TASK-029 keeps `capture.ts` exporting only the hook factory, because the exception is per file, not per export.
- **Residuals, all pre-existing classes and not this PR's to close:**
  - L1/L2, a two-hop through a test-category file, is PR20-SEC-20 / PR34-SEC-07 (INFO, open; boundaries owner with the TASK-022 bundle scan). It now also applies to this policy.
  - Code review R3-n2, a re-export through another allow-listed folder (`platform/db`, `platform/authz`, an allow-listed module), is the allow-list's trust model. Those folders are reviewed, and `platform/db/**` and `platform/audit/**` are security-owned.
  - V6j's crash is PR44-SEC-11 / code review R3-n3 (020-D). It fails closed.

### R3.4.2 PR42-SEC-13: `track` and `settle`

The fix (`tenant-db.ts:430-443`, `with-tenant-tx.ts:422-432`, `writer.ts:114`). `track` refuses after revoke before calling the thunk; it registers a never-rejecting `settled` promise per work and returns the original. `settle` loops until the in-flight set is empty. `withTenantTx` awaits `settle()` after `fn` and before the latch read, then revokes in `finally`. `createAuditWriter().write` is `db.track(() => writeTracked(db, entry))`.

Probe B (every case writes one business row first, except B1):

| Case | `96bd37a` | `d2ef478` |
|---|---|---|
| L8 `void writer.write(…).catch(…)`, personal values, 20 ms tokeniser that succeeds | committed **with** entry | **COMMIT WITHOUT ENTRY** |
| L8b refusal before the write's first `await` (control) | 500, rollback | 500, rollback |
| L8c detached `.then(…)`, tokeniser fails 20 ms after the callback returned | 500 `AUDIT_WRITE_FAILED`, rollback | **COMMIT WITHOUT ENTRY** (detached settles as `TENANT_TX_CLOSED`) |
| L8d no personal values, store issues two statements, no timer | committed **with** entry | **COMMIT WITHOUT ENTRY** (append stops after its first statement) |
| L8e detached append fails after its first statement | 500, rollback | **COMMIT WITHOUT ENTRY** |
| L8f two detached writes | committed with both entries | **COMMIT WITHOUT ENTRY** |
| L8g a write started inside another tracked work, 5 ms later | committed with entry | n/a (no `track` member) |
| R1 `track` kept and called after settle; `db.track` read after settle; a kept handle given to `writer.write` | `TENANT_TX_CLOSED`, **work not started**; member read refused; `TENANT_TX_CLOSED`, **0 statements** | no member; read refused; refused, 0 statements |
| B2 awaited business row + awaited write (control) | committed with entry | committed with entry |

**Mutants (Probe C):**

| Mutant | Effect |
|---|---|
| M1 `await handle.settle()` removed | L8, L8c–L8g commit without entry |
| M2 `settle` awaits one snapshot instead of looping | L8g (nested) commits without entry |
| M3 `write` not tracked | L8, L8c–L8g commit without entry |
| M4 `track` accepted after revoke | R1 starts the work |

**Starvation and unbounded settle.**
- **S1:** a tracked work re-tracks itself every 2 ms, with the fake's transaction timeout at 300 ms. The callback was still pending at 1,000 ms (65 rounds). Once stopped, COMMIT was refused ("timed out") and the transaction rolled back.
- **S2:** a tracked work that never settles leaves `withTenantTx` pending (at 600 ms). The control, a callback that itself awaits a never-settling promise, behaves identically.
- **S3:** 10,000 tracked works settle and commit in 29.5 ms, and the in-flight set empties.
- **The Prisma side, read in 7.10.1** (`runtime/client.js`): `_transactionWithCallback` awaits the callback and then commits. Its TransactionManager closes a timed-out transaction (rollback, connection released), so a late COMMIT throws "Transaction already closed".

**Rating: no new finding.** `track` is a guard member, and calling it can only delay the commit, which the callback can already do by awaiting. The integrity property (no commit without the entry) holds through the transaction timeout. The availability residual (the request and its admission permit stay held while a callback keeps work in flight; the connection is released) is the existing hung-callback class. It is code review r3 INFO 1 and PR44-SEC-12; owners 020-D (D-ARCH-114 deadline) and TASK-028/029 (timeouts on non-SQL awaits such as KMS or an HMAC service).

**What `settle` does not see** is the subject of PR42-SEC-17: work whose start comes after its last look.

### R3.4.3 PR42-SEC-14, R2-n1, R2-n3

**PR42-SEC-14: closed.** Probe D. The head pin counts `set_config` over the raw source (`prisma-store.test.ts:231-238`, used at 251), and the real store has exactly one occurrence (`prisma-store.ts:116`).

| Text | Head pin (raw) | `d2ef478` pin (comment-stripped) |
|---|---|---|
| The real store | pass | pass |
| E1 setter between `'/*'` and `'*/'` literals | refused (2 setter occurrences) | pass |
| E2 setter on a `//`-led template line | refused | pass |
| E4 E1 in upper case | refused | pass |
| A comment naming the setter | refused (fails closed) | pass |
| An `app.` key in a comment | refused (fails closed) | pass |
| A DO block with a concatenated setter name | pass | pass |

The last row is the repo-wide note of round 2 (lint and pin are textual), already routed to 020-D / PR44-SEC-05 (D-ARCH-124 scanner). D-TASK025-25 accepted.

**R2-n1: closed.** Probe E. `roles()` (`entry.ts:380-390`) reads `length` once and validates by index:

| Input | Head | `d2ef478` |
|---|---|---|
| Proxy, `length` 1 then 40 | 1 role stored, 1 length read | 40 roles stored, 2 length reads |
| Proxy, `length` 40 then 1 | refused | refused |
| Own `map` returning `["not a role key; DROP", 42]` | ignored: the 2 real roles validated and stored | **the unvalidated junk stored** |
| Proxy, `length` NaN | 0 roles | 0 roles |
| Proxy, `length` `'1'` | refused (D-TASK025-24) | 1 role |

Both controls (two valid roles stored, an invalid role refused) behave the same on both heads.

**R2-n3: closed.** `errors.test.ts` covers the second-copy brand, a plain Error, a local symbol of the same description and a non-`true` brand. The JSDoc (`errors.ts:51-54`) states that the brand is a marker, not an authenticity check. D-TASK025-26 accepted.

### R3.4.4 D-TASK025-29: the Lint step heap (`ci.yml:254-261`)

- **The change.** Three comment lines plus `env: NODE_OPTIONS: --max-old-space-size=4096` on the Lint step. The step's `run:` stays `npm run lint`, and the root `package.json` (the lint script) is unchanged against `main`.
- **Heap size only.** `--max-old-space-size` is a V8 heap flag: no preload, `--require`, `--import` or loader.
- **Nothing dropped from lint.** The flat-config global ignores are unchanged. The `eslint.config.mjs` diff against `main` is additive, and its two changed lines widen controls (`TENANT_TX_HANDLE_TYPES` gains `AuditSqlPort`; `audit-writer-allowlist` gains `writerExports`). Lane A ran the base-ref negative fixtures against the head config (green), and `check-suppressions` reports 0 findings.
- **Scope.** The setting is step-scoped, so no other step's environment changes. It is not a gate-location variable (`GATE_*`) and not reserved (`GITHUB_*`/`RUNNER_*`).
- **Workflow policy (Probe F).** `main`'s and the head's `check-workflow-policy.mjs` are byte-identical, and lane A ran the base-ref copy (green).

  | `ci.yml` variant | Base-ref and head policy |
  |---|---|
  | H0 the head as is; C0 `main`'s `ci.yml` | pass |
  | N1–N4 `--require ./x.cjs` (after the heap flag), `-r`, `--import=`, `--experimental-loader` | `node-options-preload` |
  | N5 the value quoted | pass |
  | N6 `NODE_OPTIONS: ${{ github.event.pull_request.title }}` | **pass** |
  | N7 `BASH_ENV: ./x.sh` beside the heap line | **pass** |
  | N8 `run: npm run lint -- --no-warn-ignored` | `required-gates` |
  | N9 `continue-on-error: true` | `continue-on-error` |

  Node 24.22.3 refuses `--env-file`, `--env-file-if-exists`, `--experimental-config-file` and `--experimental-default-config-file` inside `NODE_OPTIONS` ("is not allowed in NODE_OPTIONS"), so the preload filter has no gap through those flags.
- **Injection from PR-controlled input: none.** The value is a literal, with no `${{ … }}` expression, so no PR title, branch name or other event field reaches it. N6 and N7 show that the policy would not refuse such an edit on this step. That is PR42-SEC-18 (INFO), a policy gap in the PR17-SEC-08 class, not a property of this change.
- **Sequencing.** PR #46 (`ad30316`) and PR #39 (`c85d5e5`) each add the **identical** line. With either, `merge-tree` conflicts only in the comment lines above it (§R3.7).

### R3.4.5 Unions (PR #43, #44, #45, #47) and SEC-TC-74

| Merge | Parents | Re-derived |
|---|---|---|
| `c7636ec` | `d611fda` + `48f50e0` (PR #43, #45) | tree equal to `merge-tree` |
| `5964962` | `e789232` + `bd67d66` | tree equal |
| `c65f205` | `29e1a60` + `47f942d` (PR #44) | equal except the one conflicted file, `tools/lint/negative-fixtures.test.ts` |
| `7e9fb3c` | `5f3168c` + `9645b34` | tree equal |
| `6e3ec99` | `8d346fa` + `d753027` (PR #47) | tree equal |

- **The `c65f205` resolution keeps both row sets.** All 51 lines the branch added and all 176 lines PR #44 added (against the merge base) are present, with no conflict marker. At the head, the file differs from `main` by 67 inserted lines and 0 removed.
- **With PR #44 (§R2.7 item 4):**
  - **Tx-body order** (`with-tenant-tx.ts`): the `readOnly` statement (419), then `createTenantDb` (420), `fn` (422), `settle` (425), the latch check (428–429) and `revoke` in `finally` (432). Admission wraps the whole `$transaction` (439), and `mapped()` still checks `isAuditWriteError` first (391–396).
  - **One permit per phase.** `execute.ts:230` (the read-only `load`) and `:238` (the write) are separate `withTenantTx` calls. Each takes its own admission permit and settles its own handle. `with-tenant-tx.ts:420` is the only non-test `createTenantDb` call, so every handle that can hold a tracked write is settled.
  - **`TENANT_CONCURRENCY_LIMIT`.** `execute-phases.test.ts` differs from `main` only in the stand-in reason and its JSDoc.
  - **`ownKeys` pins.** The pins in `tenant-db.test.ts`, `system-db.test.ts` and `tenant-db.real-client.test.ts` carry `track`, and no 020-C test pins `ownKeys(db)`.
- **With PR #43 / #45:**
  - `eslint.config.mjs` against `main` adds lines only, apart from the two widening lines above. The setter exemption is still last in `TENANT_CONTEXT_EXEMPTIONS`, and `package-audit` and `prisma-tests-audit` keep their single policy.
  - PR #45's files are not touched by the branch.
- **Lockfile (§7 item 2).** The head's lockfile is byte-identical to `d2ef478`'s (`3782ae2e…`), and `main`'s is unchanged (`f0d07b62…`). The deep diff against `main` is exactly 1 leaf, `packages["prisma"].devDependencies["@platform/audit"] = "0.0.0"`, and the control mutation was seen. `node_modules/ajv` is 8.20.0, MIT, from `registry.npmjs.org`, with integrity equal to `main`'s. There are 15 `link: true` entries, all `@platform/*`.
- **`tools/tsconfig.json`, `prisma/package.json` (§7 item 3).** Unchanged since round 2: the `tenant-admission.ts` entry, the `../packages/audit` reference and the one dev-dependency line.
- **With PR #47 (`required-suites.json`).** The leaf diff against `main` is exactly `suites.unit.required_cases` gaining `coverage gate: packages/audit lines` and `coverage gate: packages/audit branches`, appended after the four existing names. PR #47's `rls-cross-tenant` activation and every other line are untouched. The evidence carries both names as passing cases with `classname="unit"`, `manifest_sha256` equals the head's manifest, and the run includes `rls-cross-tenant` (126, 13 `[SEC-TC-06]`, 0 skips), as D-ORCH-081 requires. Lane A judged the run with `main`'s manifest, so the two names bind from the next PR on (R2.4.2 unchanged).
- **SEC-TC-74: not in this PR.** It is still in `required_cases_pending.catalog-c1-c14` on `main` and at the head (one occurrence, untouched by the branch). Lane A printed the expected note ("pending ID SEC-TC-74 is implemented … move it"). D-SEC-PR47-01 (2) puts the move in "#47's union commit if #42 merges first, otherwise in a qa-lead manifest-only PR right after #47". #47 merged first (`8defeb4`), so branch (b) applies, and **the qa-lead manifest-only PR is the right home**:
  1. That is the ruling's own condition.
  2. D-TASK025-21 scopes this PR's manifest change to two exact names. A third change would widen what this record and the code review accepted.
  3. Under the base-ref manifest rule, a move here would bind only from the next PR on, exactly like the qa-lead PR. Moving it here gains nothing.

  The due points are unchanged: before TASK-037 takes evidence and before the first `wave` run, together with the SEC-TC-69..75 adoption and the catalog `min_tests` ratchet. If that PR lands after this one, its leaf diff must keep the two audit names, and its fresh evidence must carry them.

### R3.4.6 Evidence hygiene (D-SEC-PR23-02)

- **Gate table.** The PR body states verbatim that "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first" (in a fresh clean worktree of `6e3ec99`) and that "`.git/info/exclude` is empty" (0 bytes).
- **Run.** Profile `pr`, `git_dirty: false`, `build_clean: true`, `env_overrides` empty.
- **Host-path scan** (13 labels, count-only): **0** over the 8 files. The control has 212 hits.
- **Lockfile.** `lockfile_sha256` equals the recomputed SHA-256 of the head's `package-lock.json` (`3782ae2e…`).
- **Acceptance.** Lane A's base-ref verifier (`RANGE_BASE` `d753027`) accepted `20261114T1437Z_6e3ec99` and rejected the two superseded runs of this cycle as stale (`ci.yml` and the manifest changed after them). That is the expected staleness behaviour.
- **Real-database proof.** The two `[PR #42 fix cycle 2]` integration cases pass, and the integration skip is the opt-in benchmark, not a security case.

## R3.5 New findings

| ID | Title | Severity | CWE | OWASP | Location | Owner / due | Status |
|---|---|---|---|---|---|---|---|
| PR42-SEC-17 | An audit write whose start is deferred (one or more microtask hops, after a detached statement, a "read, then write" detached block, a timer) is refused after the commit decision; the business change commits without its entry | MEDIUM | CWE-778 | A09:2021 | `apps/api/src/platform/db/tenant-db.ts:308-318, 430-443`; `apps/api/src/platform/db/with-tenant-tx.ts:422-432` | senior-developer: this PR if a further cycle runs (it touches the same files as R3-m1), else TASK-029 before it merges; TASK-047 for the job port; TASK-033 asserts per route | Open |
| PR42-SEC-18 | The Lint gate's step env is not pinned: an expression-valued `NODE_OPTIONS` or a `BASH_ENV` beside the heap line passes the base-ref policy (PR17-SEC-08 class) | INFO | CWE-693 | A08:2021 | `tools/ci/check-workflow-policy.mjs:326, 398, 485`; `.github/workflows/ci.yml:259-261` | devops-engineer: TASK-015 015-C (or PR #46's fix cycle), before G3 | Open |
| PR42-SEC-19 | A voided audit write that fails is an unhandled rejection, which the API answers with a process exit (= code review R3-m1) | LOW | CWE-248 | A04:2021 | `packages/audit/src/writer.ts:114`; `apps/api/src/platform/runtime/process-errors.ts:88`; the latch JSDoc in `tenant-db.ts` | senior-developer: the JSDoc in this PR's next commit if any; the code fix in this PR or TASK-029's AC, before TASK-029 merges | Open |

### PR42-SEC-17 (MEDIUM): a deferred-start audit write escapes `settle`

- **Description.** `settle` waits for work registered before its last look at the in-flight set, and `withTenantTx` reads the latch and revokes the handle in the same continuation. A write that the callback *schedules* but that *starts* later calls `track` only after the revoke. It is refused with `TENANT_TX_CLOSED` without starting, and the transaction has already committed the business change. Examples are a write chained behind a still-pending promise, behind a detached statement, or behind a timer.
- **Probe B (head and `d2ef478` alike):**
  - **K1, K2, K3, K4, K5, K8, K50:** `void ticks(k).then(() => writer.write(db, e)).catch(…)`, where the write starts 1 to 50 microtask hops after the callback scheduled it, gives **COMMIT WITHOUT ENTRY**. Even one hop escapes. Only a write chained on an already-settled promise (0 hops) starts in time.
  - **B1:** a detached business statement with the write chained after it gives COMMIT WITHOUT ENTRY. The chained write settles as 500 `TENANT_TX_CLOSED`.
  - **B3:** the natural "read the before-image, then write" block, `void (async () => { await db.$queryRaw…; await writer.write(db, e); })()`, gives COMMIT WITHOUT ENTRY.
  - **T0:** a write started from `setTimeout(0)` gives COMMIT WITHOUT ENTRY.
  - Controls: the L8 family (write started inside the callback) and B2 (awaited) commit with the entry.
- **Relation to D-TASK025-23 and the code review.** D-TASK025-23 declares as residual "a detached promise that never calls `track` (plain fire-and-forget business code)". The code review r3 INFO places "work started … in the microtask gap between `settle`'s last size check and `withTenantTx`'s resumption" inside that residual. The probe shows the reach is wider than a gap: every audit write whose start is deferred at all is lost, including B3, which is the shape a developer writes for a "best-effort" entry with an old value. The impact is the impact of PR42-SEC-13: a mutation without its entry, which breaks O4 and REQ-AUDIT-004.
- **Exploitability / impact.** It takes a developer's detached block that defers the write. That means two departures from the awaited pattern, both lint-clean, in an allow-listed caller. No caller exists yet; TASK-029's `flush` is awaited, and D-ARCH-122's "one write per transaction" makes direct calls rare. The late refusal is loud: with `void`, it is the process exit of PR42-SEC-19; with `.catch(log)`, an error log line. The committed change still has no entry. Impact High × likelihood Low gives **MEDIUM**, the rating PR42-SEC-13 had.
- **Remediation (probe-validated hardening).**

  ```ts
  // tenant-db.ts (sketch): (1) the guard registers every statement it starts; (2) settle until a macrotask turn adds nothing.
  // guardResult(): when the wrapped statement first starts (started ??= …), state.onStart?.(started)
  state.onStart = (p) => { const s = p.then(ignore, ignore); inFlight.add(s); void s.then(() => inFlight.delete(s)); };
  const settle = async (): Promise<void> => {
    for (;;) {
      while (inFlight.size > 0) await Promise.all([...inFlight]);
      await new Promise<void>((resolve) => setImmediate(resolve)); // deferred continuations start their work now
      if (inFlight.size === 0) return;
    }
  };
  ```

  Probe C on the head:

  | Candidate | Closes | Still escapes |
  |---|---|---|
  | **H1** (only the macrotask turn) | K1–K50 | B1, B3, T0 |
  | **H2** (H1 + statement tracking) | K1–K50, B1, B3 | T0 |

  With H2, L8–L8g, R1 and B2 are unchanged, and 10,000 tracked works still settle in about 30 ms. T0 (a timer) stays out of reach of any settle design; TASK-033's audit-completeness generator is the backstop for it and for anything else. A detached business statement then also completes before COMMIT instead of racing it, which is a correctness gain of its own. The added wait is bounded for integrity by the transaction timeout (§R3.4.2 S1).
- **Verification.** Unit tests in `with-tenant-tx.test.ts`: K1, B1 and B3 commit only together with the entry, or roll back; never COMMIT without it. T0 is documented as outside the transaction. Integration (`platform_app`): B3 against PostgreSQL 18 leaves the business row only together with its entry.

### PR42-SEC-18 (INFO): the Lint gate's step env is not pinned

- **Description.** `CI_REQUIRED_GATES` pins the Lint gate's `run` and `if`, but not its `env` (`check-workflow-policy.mjs:326`). The exact-env rule binds only the gates that declare one (porcelain, openapi-breaking, lane B evidence, base-ref lint fixtures). `node-options-preload` (`:398`, `:485`) tests the literal text of the value. Probe F: N6 (`NODE_OPTIONS: ${{ github.event.pull_request.title }}`, which would turn a PR title such as `--require ./x.cjs` into a preload) and N7 (`BASH_ENV: ./x.sh` beside the heap line; GitHub's bash honours it, so a function can shadow `npm`) both pass the base-ref policy.
- **Why INFO.** There is no instance, and the head's value is a literal. `ci.yml` is security-owned, so such an edit needs a record. The `BASH_ENV` half is PR17-SEC-08 (LOW, open with TASK-015). The step env is new with this PR, which makes pinning it cheap now.
- **Remediation.**
  - Give the Lint entry `env: { NODE_OPTIONS: '--max-old-space-size=4096' }` (exact env, like the porcelain gates), and hold every `npm run lint` step (including PR #46's `lane-c.yml`) to the same value. That also answers the code review r3's devops follow-up 2.
  - Refuse `${{` inside any `NODE_OPTIONS` value.
  - Add N6 and N7 as policy fixtures.
- **Verification.** N6, N7 and a changed heap value fail `required-gates`. H0 and `main`'s `ci.yml` (until it gains the line) behave as designed.

### PR42-SEC-19 (LOW, = code review R3-m1): a voided failing write ends the process

- **Description.** `write` (`writer.ts:114`) is an `async` arrow, so it returns a new promise that adopts `track`'s result. `track` handles only its own `started` promise. A caller that voids the write (as the latch JSDoc names) and whose write fails therefore leaves an unhandled rejection. `process-errors.ts:75-88` answers that with `crash('process.unhandled_rejection')` and `exit(1)`. This was confirmed by reading; the code review's probe (an unhandled rejection on the success-path refusal and on a late `TENANT_TX_CLOSED`) stands and was not re-run here. A late refusal of PR42-SEC-17 ends the process the same way.
- **Exploitability / impact.** Integrity holds, because the latch and `settle` roll the change back. The cost is availability. Under contention, the expected 55P03 (503, D-TASK025-01) on one voided write would end every in-flight request of the process, and a client can drive that contention. The resulting health-check failure is a ROLLBACK_TRIGGER. No caller exists yet. Impact Medium × likelihood Low gives **LOW**.
- **Remediation.** Take the code review's preferred form: `write` marks the returned promise handled while awaiting callers still see the rejection, and a unit test asserts that no `unhandledRejection` occurs. Also stop the JSDoc endorsing `void writer.write(…)`, and state that a detached write must at least `.catch(log)`.
- **Verification.** Unit tests: a voided write that fails (success path and after revoke) raises no `unhandledRejection`, while an awaited caller still gets the error.

## R3.6 Code review round 3 (`1be9a74`, APPROVED_WITH_NITS): alignment

| Code review item | Security view |
|---|---|
| R2-M1 closed (25 shapes; 7 of 10 policy mutants killed) | Concur: 28 cases carry the composition message on head (27 lint-clean on `d2ef478`), 5 of 5 policy mutants visible (§R3.4.1) |
| `track`/`settle` sound (10 of 12 mutants killed) | Concur for writes started inside the callback (M1–M4). The deferred-start shapes are PR42-SEC-17, rated MEDIUM, not inside D-TASK025-23's residual (§R3.5) |
| R3-m1 (MINOR) voided failing write crashes the process | = PR42-SEC-19 (LOW). Concur with the preferred fix |
| R3-n1 no negative row for a non-`writer.ts` file of the folder | Concur; probe T3/T5 show that the config is right and the fixtures are thin |
| R3-n2 two-hop through another allow-listed folder | Concur: a pre-existing allow-list trust class. Amend D-TASK025-22 "Not covered", as the review asks |
| R3-n3 lint crash on `import w = require()` | = my V6j; PR44-SEC-11 class, 020-D; fails closed |
| INFO: settle holds the permit while tracked work runs | Concur; no new finding (§R3.4.2) |
| D-TASK025-29 accepted (maintainability) | Concur from the security side (§R3.4.4); PR42-SEC-18 is the policy gap next to it |

## R3.7 Sequencing: what voids this round

The record checker voids a round when an owned path that the PR changes changes after the named commit. Paths that only `main` changes do not void it.

1. **Docs-only commits after this record, and a merge of `main` `9daad95`** (`docs/` and `.claude/` only) keep it valid (S4, S5). The evidence stays fresh too, because those paths are on the staleness allow-list (S8).
2. **The code review's merge conditions void this round if they land as code.**
   - R3-n1 changes `tests/fixtures/lint/**` and `tools/lint/negative-fixtures.test.ts`.
   - R3-m1's JSDoc fix changes `apps/api/src/platform/db/tenant-db.ts`; its code fix changes `packages/audit/src/writer.ts`.
   - All of these are owned, so a **round-4 delta** is then due. Its checklist:
     - (a) the new fixture row is reported, and the folder-wide mutants die;
     - (b) R3-m1: the returned promise is handled, awaiting callers still get the rejection, and there is no `unhandledRejection` on either path; re-run Probe B L8–R1 and mutants M1–M4;
     - (c) PR42-SEC-17's H2, if taken in the same cycle (recommended, same file): K1, B1 and B3 commit only with the entry;
     - (d) fresh lane B evidence (the `packages/audit` path rule);
     - (e) the record simulation.
   - If only the fixture row and JSDoc text land, (b) and (c) reduce to a read.
3. **PR #46 (015-B, in fix cycle; `ad30316`)** shares `ci.yml` and `eslint.config.mjs`.
   - `merge-tree` with this head conflicts only in `ci.yml`, in the comment lines above the identical `NODE_OPTIONS` line.
   - **Whichever merges second:**
     - keeps exactly one `env: NODE_OPTIONS: --max-old-space-size=4096` on the Lint step, with one comment naming both causes;
     - keeps #46's `lane-c.yml` line;
     - keeps this PR's `eslint.config.mjs` categories and policies, and #46's lines;
     - keeps the lint gate pin consistent with every lint step, if PR42-SEC-18's pin lands first.
   - That merge voids the second merger's record, so a merge-only round is due.
4. **PR #39 (TASK-014; `c85d5e5`)** conflicts in `ci.yml` the same comment-only way (identical heap line) and in `packages/config/src/values.test.ts`. Its overlap is otherwise unchanged from rounds 1 and 2:
   - `GUARDS.length === 15`;
   - the `variable` argument in the admission `TenantTxConfigError`s;
   - images that ship `packages/audit` with `canonicalize`;
   - `with-tenant-tx.ts`, `packages/config/**`, the lockfile and `prisma/package.json` merge as before.
   The second merger's record is voided.
5. **The qa-lead SEC-TC-74 manifest PR** edits `tools/quality/required-suites.json`, which this PR changes too. If it lands first, merging it voids this round. A merge-only round then checks a leaf diff of exactly its move plus the two audit names. Preferred order: after #42.

## R3.8 Checks owed (routed; updates §R2.8)

| Owner | Check | Due |
|---|---|---|
| senior-developer (next commit on this PR, if any) | R3-n1 fixture row; PR42-SEC-19 JSDoc (and code fix, or TASK-029 AC); PR42-SEC-17 H2 with K1/B1/B3 tests if a code cycle runs; then the round-4 delta of §R3.7 item 2 | Before merge if taken; else the due points below |
| TASK-029 (capture middleware) | PR42-SEC-17 (H2 or an equivalent, plus K1/B1/B3 tests) if not taken here; PR42-SEC-19 code fix if not taken here; PR42-SEC-15 AC (a)–(c) verbatim (D-TASK025-27); `capture.ts` exports only the hook factory; non-SQL awaits get their own timeouts | Before TASK-029 merges |
| TASK-033 (audit generator) | Per-route completeness: no committed mutation without its entry, including detached and deferred writes (PR42-SEC-13/-17 backstop) | Before G3 |
| TASK-047 (worker twin) | The job port implements `markRollbackOnly` and `track`, settles before COMMIT, and takes the PR42-SEC-17 hardening | Before TASK-047 merges |
| devops-engineer (TASK-015 015-C or PR #46) | PR42-SEC-18: exact env on the Lint gate, every lint step on the same value, `${{` refused in `NODE_OPTIONS`, N6/N7 fixtures; with PR17-SEC-08 | Before G3 |
| qa-lead | SEC-TC-74 to `catalog-c1-c14.required_cases` with the SEC-TC-69..75 adoption and the `min_tests` ratchet (D-SEC-PR47-01 (2) (b)); acknowledge D-TASK025-21 | Before TASK-037 takes evidence and before the first `wave` run |
| Boundaries owner (TASK-022) / 020-D | PR20-SEC-20 / PR34-SEC-07 two-hop now also covers the composition policy; R3-n3 / PR44-SEC-11 crash; the DO-block setter note (PR44-SEC-05) | As routed |
| TASK-284 / TASK-285 / TASK-028 / TASK-030 / -031 / -116 | PR42-SEC-01, -08, CHECK widening; -04 keys; -09, -10, -11 | Unchanged (§R2.8) |

## R3.9 Record simulation and secret hygiene

**Setup.** The real `tools/ci/check-security-owned-paths.mjs` and `tools/quality/check-evidence.mjs` of `main` `9daad95` were used (`tools/` and `.github/` are identical at `d753027`, which is lane A's base-ref copy). They ran against a sparse `git clone --shared` (`/.github/`, `/docs/05-quality/`, `/tools/`, `/package*.json`) that was checked out only at the scenario commits. The scenario commits were built with plumbing on `96bd37a`, and the record under test is this file. Nothing was written to the main repository's refs or to the PR worktree.

| Scenario | Base → head | Expected | Result |
|---|---|---|---|
| S0 round-2 record only (`96bd37a` as is) | `d753027` → `96bd37a` | missing | missing (names `d2ef478`; 39 owned paths changed after it) |
| S1 this record committed on `96bd37a` | `d753027` → S1 | pass | **pass**, 61 owned paths, satisfied by `96bd37a` |
| S2 same tree, `--pr 46` | `d753027` → S1 | missing | missing |
| S3 owned edit after the record (`packages/audit/src/writer.ts`) | `d753027` → S3 | missing | missing |
| S3b the R3-n1 fixture row added after the record | `d753027` → S3b | missing | missing (62 owned) |
| S3c `ci.yml` comment edit after the record (a #46 or #39 union) | `d753027` → S3c | missing | missing |
| S4 docs-only commit after the record | `d753027` → S4 | pass | pass |
| S5 union with `main` `9daad95` | `9daad95` → S5 | pass | pass |
| S6 the last Verdict row FAIL | `d753027` → S6 | missing | missing |
| S7 the Head row names `main`'s tip | `d753027` → S7 | missing | missing |
| S8 `check-evidence` (`main`'s copy) on the S5 union | `9daad95` → S5 | accepted | exit 0, "run 20261114T1437Z_6e3ec99 accepted" |

**Secret hygiene of this section.**
- It quotes no secret, no OS user name and no host path; probe sentinels were random and are not quoted.
- The Gitleaks v8.30.1 default-ruleset emulation reports 0 findings over the appended lines. Its runtime positive controls (a GitHub PAT, an AWS key ID and a generic key) fired.
- The count-only host scan reports 0 over this file.

## R3.10 Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

**D-SEC-PR42-03 · 2026-11-14 · security-analyst (logged by orchestrator) · PR #42 (TASK-025) delta round 3 at 96bd37a: PASS_WITH_FOLLOW-UPS**

- **Decision:** PR #42 delta round 3 at `96bd37a` (fix cycle 2 + unions with PR #43, #44, #45, #47) = PASS_WITH_FOLLOW-UPS. Nothing Critical or High.
- **Closed, each probed against `d2ef478`:**
  - **PR42-SEC-16 / R2-M1.** 28 import shapes and spellings, from every non-allow-listed api importer, are reported (27 of them lint-clean before). Types stay clean. The tx → `capture.ts` exception is exact-file. 5 of 5 policy mutants are visible.
  - **PR42-SEC-13 as filed.** Six detached-write cases that committed without their entry now commit with it or roll back. `track` after revoke never starts the work. 4 of 4 fix mutants are visible. A self-re-tracking or never-settling tracked work holds the transaction no longer than an awaited one; Prisma's timeout rolls it back.
  - **PR42-SEC-14** (raw-source pin refuses E1, E2, E4), **R2-n1** (one `length` read; the own-`map` smuggle is gone) and **R2-n3**.
- **D-TASK025-29:** accepted. A literal step-scoped heap size; no preload; no rule or file dropped; no PR-controlled input reaches it; both policy copies pass.
- **New:**
  - **PR42-SEC-17 (MEDIUM).** A deferred-start audit write is refused after the commit decision, and the business change commits without its entry. This covers one microtask hop, a write after a detached statement, the "read, then write" detached block, and a timer. Fix: statement tracking plus "settle until a macrotask turn adds nothing" (probe-validated; leaves only timers). Owner: this PR if a code cycle runs, else TASK-029; TASK-047; TASK-033 backstop.
  - **PR42-SEC-19 (LOW, = R3-m1).** A voided failing write is an unhandled rejection and ends the API process. Fix: the code review's preferred form, and a JSDoc that does not endorse `void`. Due before TASK-029 merges.
  - **PR42-SEC-18 (INFO).** The Lint gate's env is unpinned (expression-valued `NODE_OPTIONS`, `BASH_ENV`). Fix: exact env on the lint gate; devops-engineer, 015-C, before G3.
- **D-TASK025-22..28:** accepted. 22 with the code review's R3-n2 amendment and R3-n1 fixture row; 23 with PR42-SEC-17 as its residual (wider than declared).
- **SEC-TC-74:** stays pending in this PR. Under D-SEC-PR47-01 (2) (b) its home is the qa-lead manifest-only PR after #47, due before TASK-037 takes evidence and before the first `wave` run. That PR keeps this PR's two audit names.
- **Unions and evidence:** five merges re-derived; both `negative-fixtures.test.ts` row sets kept; the lockfile is one leaf; the manifest leaf diff is the two names on top of PR #47; evidence `20261114T1437Z_6e3ec99` has the verbatim D-SEC-PR23-02 statements, host scan 0, lockfile and manifest hashes equal, and `rls-cross-tenant` 126/0.
- **Sequencing:** an R3-n1 or R3-m1 commit voids this round (round-4 delta, §R3.7 item 2). For PR #46 or #39, whichever merges second keeps exactly one Lint heap line, and its record needs a merge-only round. The qa-lead SEC-TC-74 PR preferably merges after #42.
- **Reversibility:** High.

## R3.11 Verdict (round 3)

| Item | Value |
|---|---|
| Critical / High / Medium | 0 / 0 / 2 (PR42-SEC-01 → TASK-284 before TASK-052; PR42-SEC-17 → this PR's next code cycle or TASK-029 before it merges) |
| Low | 3 open: PR42-SEC-04 (narrowed), -15, -19 |
| Info | 5 open: PR42-SEC-08, -09, -10, -11, -18 |
| Closed by this round | PR42-SEC-13 (as filed), -14, -16; code review R2-n1, R2-n3 |
| Merge needs from security | This round covers `96bd37a` and any later docs-only head, including a merge of `main` up to `9daad95`. A commit for the code review's R3-n1 or R3-m1 changes owned paths and needs the small round-4 delta of §R3.7 item 2. A union with PR #46, PR #39 or the qa-lead manifest PR needs a merge-only round on whichever record it lands on |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** Fix cycle 2 closes PR42-SEC-13 as filed, -14 and -16 under probing, and the unions and the CI heap line are clean. Nothing Critical or High is open. PR42-SEC-17 (MEDIUM) is a wider residual of the detached-write class with a probe-validated fix, routed with a due point; PR42-SEC-19 and -18 are routed. The head `96bd37a` is cleared from security's side |
