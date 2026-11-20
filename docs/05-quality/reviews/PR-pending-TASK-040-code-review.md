# Code review: TASK-040 (idempotency keys with encrypted stored responses), round 1 (pre-PR)

- **Branch:** `feat/TASK-040-idempotency-keys`. No PR yet; the orchestrator renames this record once the PR exists.
- **Head reviewed:** `95945b7e`, an empty commit that carries D-TASK040-01..10 in its body. The code head is `5e0dc1b0`. The merge base with main is `4e1163aa`.
- **Reviewer:** code-reviewer, round 1, 2026-11-20.
- **Inputs:**
  - dispatch brief `docs/04-plan/briefs/TASK-040.md` and its card;
  - US-038 Gherkin (EPIC-16), AT-US-038-01..09;
  - ADR-0014 §HTTP idempotency and amendments 1 and 4;
  - data-model `idempotency_keys` (§3.5) and §6.2;
  - api/README §5;
  - ADR-0016;
  - REQ-AUDIT-010;
  - the D-TASK040-01..10 commit body.

```
VERDICT: CHANGES_REQUESTED
SUMMARY: A well-built store: the claim, conditional takeover and completion, AES-256-GCM bound to the scope
  through the AAD, fail-closed mount refusals, and clean grants and catalog pins. 174 + 213 + 825 targeted tests pass.
  Two MAJORs:
  (M1) On a read-only (VIEW/DOWNLOAD) idempotent route the key is completed BEFORE the fail-closed audit entry is
  written. When that entry fails (503), the retry replays the 2xx. No entry was ever written and the afterCommit effect
  never ran. I reproduced this.
  (M2) D-TASK040-03 releases the key on a THROWN 4xx. Services in this codebase throw their 4xx, so almost no real 4xx is
  replayed. That contradicts ADR-0014, data-model §6.2 step 4, api/README §5 and AT-US-038-07, and it needs an architect
  ruling or the fix.
  Deferring the production wiring is acceptable as a split, under conditions (§2). Deferring the purge is acceptable
  only if the purge ships with or before that wiring (§2).
FINDINGS: 2 MAJOR, 7 MINOR, 6 NIT (table in §3)
```

## 1. What I verified myself

Constraints: read only. I ran nothing in the evidence worktree, and no npm install, Docker or Testcontainers. Each check ran in a `git archive 95945b7e` extract in the scratchpad. The extract had a junction to the worktree's `node_modules` and a copy of the worktree's git-ignored `prisma/generated`. I redirected every `tsBuildInfoFile` that pointed at `node_modules/.cache` to a path inside the extract, so nothing was written through the junction. I removed the extract afterwards. The worktree is still clean at `95945b7e` and still has 748 `node_modules` entries. The only side effect is that the shared test lock under `node_modules/.cache/shipqube-test-locks` was touched: the directory exists and is empty, which is its idle state.

| Check | Result |
|---|---|
| Targeted Jest, `unit` + `api` projects (`--maxWorkers=2`): `platform/idempotency`, `errors/classify`, `pipeline-guards`, `db/system-db`, `contract/x-idempotency`, `grants-manifest`, `tx/execute` | 12 suites, **174 passed**. `idempotency.api.test.ts` runs in-process over a loopback server, with no Docker. |
| Repo-tool unit tests: `root-scripts`, `table-classes`, `classification`, `migration-lint`, `sql-text`, `render-rls` | 9 suites, **213 passed** |
| `tools/db/`, the system-model-owner rule, the classification registry, unit tests in `tests/generated/` | **825 tests, 823 passed**. The 2 failures are artefacts of the archive copy: `prisma-client-package` needs a built `prisma/dist`, and `loopback-ratchet` needs a git root. I re-ran `loopback-ratchet` after `git init` in the extract: 16 of 16 pass. |
| `tsc -b` over shared, config, authz, audit, pricing, carriers, api, worker, prisma, tests/{generated,helpers,factories,api,contract} and tools | clean (55 s) |
| ESLint `--max-warnings 0` on every changed `.ts` file (the PR's config, type-aware) | clean |
| Prettier `--check --ignore-unknown` on every changed file | clean |
| Coverage of the changed modules (unit + api, the tests above) | `execute.ts` 99.58 %, uncovered **412-413**. `store.ts` 98.72 %, uncovered **212-214**. Everything else 100 % of lines. See m5. |
| **Probe for M1:** an `optional` POST route with a DOWNLOAD / SENSITIVE audit (`readOnlyHandler: true`, shaped like the contract's `emailShipmentDocuments`), whose `afterCommit` entry fails once with `AUDIT_UNAVAILABLE` | First request **503**. Retry with the same key: **202 with `Idempotent-Replayed: true`**. The handler ran once. The event list shows the key completed in its own transaction **before** the failing entry, and no entry was ever written. |
| OpenAPI probe (`x-idempotency` against `x-audit`) | 6 `required` and 41 `optional` operations. `emailShipmentDocuments` (DOWNLOAD, SENSITIVE) is `optional`, so M1 is reachable as soon as that route ships. |
| Convention for 4xx in services (M2) | Services throw (`organisation-rules.ts:86` `OrganisationRuleError` gives 422 `ORG_TYPE_NOT_ALLOWED`). The generated registry describes `moduleRouteErrors` as "the codes its services can throw". No module returns a 4xx. |
| Merge-tree with TASK-043 (`da996002`) | Four conflicts, each a one-line literal union: `system-models.ts`, `system-db.test.ts`, the C15 scope literal and `grants-manifest.test.ts`. `DECISIONS.md` also conflicts, from the TASK-043 side. `platform.prisma`, `grants.manifest` and `registry.ts` auto-merge cleanly. The union of `SYSTEM_MODELS` is `['idempotencyKey', 'jobExecution', 'outboxEvent', 'processedEvent', 'referenceDatasetVersion']`. The union of the C15 literal adds `idempotency_keys` to TASK-043's eight names. These edits are not appends: both sides rewrite the same line. They are mechanical. |
| Merge-tree with TASK-041 (`3a6b4c8b`) | One conflict, in the import block of `pipeline-guards.test.ts`. TASK-041 does **not** touch `errors/classify.ts`: its limiter sets `Retry-After` on the response itself, and `sendProblem` keeps that header. See n2. |
| Migration order | `20261120100000_idempotency_keys` sorts after TASK-043's `20261120000000_outbox_events` and after main's latest, `20261119000000_job_executions`. |
| No new dependency | No `package.json` or lock change in the diff. |
| `system-model-owner` | `SYSTEM_MODEL_OWNERS.idempotency = ['apps/api/src/platform/idempotency/**']` is already on main, and `store.ts` is the only non-test importer of `systemDelegates(...).idempotencyKey`. |

**Not re-run:** the integration suites `idempotency-keys.int.test.ts` and the C15 literal on PostgreSQL 18, the full `test:unit`, coverage and lane A. Lane B is queued; this verdict is conditional on that evidence for those files.

## 2. Rulings on the two deferrals the dispatch asked about

**Production wiring (D-TASK040-02): acceptable as a split, under conditions.** Wiring the store needs `start-api.ts` (`idempotencyStoreFrom`, a Pino-backed `IdempotencyLog`), `AppDependencies` and `defaultSlots` in `app.ts`, and `tests/generated/rbac/matrix-app.ts`. All of them are TASK-041 lock files. Routing it through `RuntimeServices` would be a layering hack, and I do not recommend it. The split is safe because it fails closed: `executeSlot` refuses an idempotent route without a store when the route is mounted, and the module registry on main is empty, so nothing on main loses protection. The ACs are demonstrated through `createApp` + `defaultPipelineSlots` with the real slots, but the composition is a test composition.

What the split costs: api/README §5 makes **every** unsafe operation `optional` except the listed ones. The route-metadata test pins each route's mode to the contract. So the **first** module PR that mounts any unsafe route (TASK-049, TASK-092, TASK-224, TASK-231, …) will not boot until the wiring lands.

Conditions:
1. The orchestrator creates part **TASK-040-B** (production wiring), dispatched as soon as TASK-041 releases `app.ts`, `start-api.ts` and `matrix-app.ts`. It is a dependency of every route-bearing module task. It includes a composition test proving that an idempotent route mounts and replays under `createApp` defaults / `startApi`.
2. US-038 is recorded as partially delivered until 040-B merges (STATUS / traceability).

**Purge (D-TASK040-10): acceptable only if it ships with or before 040-B.** No AC needs the purge: AT-US-038-09 is met by deleting an expired row when it is claimed again. But `response_body` is PER ciphertext "kept 24 h only" (data-model §3.5), and ADR-0014 amendment 1 says "expired rows are purged hourly". Keys are UUIDv4, so expired rows are almost never claimed again; without a purge every row lives forever. No row can be written in production until 040-B, so deferring is harmless until then.

There is an ownership problem the architect must settle. The owner map gives `idempotency_keys` only to `apps/api/src/platform/idempotency/**`, so the TASK-043 worker housekeeping cannot purge it unless `eslint.config.mjs` changes (the lint lock) or a definer function is added. Data-model §6.2 step 5 ("housekeeping", which is daily for the outbox) and ADR-0014 amendment 1 ("hourly") also disagree on the cadence. See m2.

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| M1 | MAJOR | `apps/api/src/platform/tx/execute.ts:345-347` | On a read-only handler route (VIEW/DOWNLOAD, `readOnlyHandler: true`), `settleClaim` completes the key with the 2xx **before** `audit.afterCommit` writes the entry that fails closed (REQ-AUDIT-005; 503 `AUDIT_UNAVAILABLE` for SENSITIVE). When that write fails, the client gets 503, but the key is COMPLETED. The retry with the same key replays the 2xx with `Idempotent-Replayed: true`. No VIEW/DOWNLOAD entry is ever written, and the route's `afterCommit` (for `emailShipmentDocuments`, the e-mail) was never scheduled because the first request threw. A replay then reports success for an effect that never happened and a disclosure that was never audited. Reproduced (§1). No test covers an idempotent read-only route: the API test's capture always returns `readOnlyHandler: false`. | Run `audit.afterCommit` before settling the claim. If it throws, release the claim (`settleClaim(..., undefined)`) and rethrow. Add API tests with a `readOnlyHandler: true` capture: (a) success completes the key after the entry; (b) a failed entry gives 503, the key is released, and the retry executes again (handler twice, entry written on the retry). |
| M2 | MAJOR | `apps/api/src/platform/tx/execute.ts:337-343`; D-TASK040-03; pinned by `idempotency.api.test.ts:329` | A **thrown** 4xx (an `AppError`, or a domain error mapped through `routeErrors`) releases the key, so the retry runs again. ADR-0014 says "store 2xx/4xx response; 5xx/429 delete the row". Data-model §6.2 step 4 says 4xx outcomes produced inside the business transaction are recorded after the rollback. api/README §5 lists only 5xx and 429 under "Not stored". AT-US-038-07 says "the first request returned 422, the retry replays the 422". Services here throw their 4xx (§1), so on real routes the replay holds only for the rare returned 4xx. A retry after a thrown 4xx also runs `call` again, an external effect. A developer decision cannot contradict an Accepted ADR (CLAUDE.md §5). | **(a), recommended: implement it.** In the catch, when there is a claim and the thrown value classifies (`classifyThrown`, plus the same `routeErrors` mapping the problem handler uses) as a 4xx other than 429, complete the key after the FAILED entry. Either store the rendered problem document (add `Content-Type: application/problem+json` to the stored-header allow-list, so `send` keeps it), or store `{code, detail, errors}` and replay by throwing the equivalent `AppError` with `Idempotent-Replayed` already set. Tests: a thrown 422 and a thrown 409 are replayed and the handler ran once; a thrown 429 is not stored. **(b):** a principal-architect ruling that amends ADR-0014 and data-model §6.2, plus product-manager rewording of AT-US-038-07, recorded before merge. |
| m1 | MINOR | D-TASK040-02; `apps/api/src/app.ts` `defaultSlots` (not edited, locked) | Production never wires the store, so US-038 cannot work in production. The first module PR with an unsafe route fails to boot (§2). | The §2 conditions: an owned TASK-040-B right after TASK-041, a dependency of every route-bearing module task; US-038 marked partial until then. |
| m2 | MINOR | D-TASK040-10; `store.ts:26` | No purge. PER ciphertext outlives its 24 h retention, and lazy deletion practically never fires for UUID keys. The owner map blocks a worker purge. The cadence (hourly vs daily) is contradictory across ADR-0014 amendment 1 and data-model §6.2. | Architect rules where the purge runs (an api-side scheduler inside `platform/idempotency`, an owner-map extension for the worker, or a definer function) and the cadence. The purge ships no later than 040-B. Owner named in DECISIONS. |
| m3 | MINOR | D-TASK040-07; `execute.ts:312-316` (claim outside the `try`) | 409 `IDEMPOTENCY_IN_PROGRESS` and 422 `IDEMPOTENCY_KEY_REUSED` write no FAILED entry. Neither do 5xx failures of the claim phase (`IdempotencyReplayError` on a corrupt or rotated-out row, a claim transaction failure). REQ-AUDIT-010 requires FAILED for authorised mutating requests ending in 409, 422 or 5xx. The rationale (a client polling with `Retry-After: 1` would flood the chain, like GAP-A-09) is reasonable, but the exception belongs to product-manager, not the developer. | Either a product-manager ruling that records the REQ-AUDIT-010 exception for idempotency protocol conflicts (and states whether claim-phase 5xx are covered), or call `recordFailure` for them. Record it before merge. |
| m4 | MINOR | `store.ts:38`; `execute.ts:65`; D-TASK040-06 | The 30 s lease has no renewal. The request takes `load` + `call` (deadline 20 s) + the handler transaction (5 s per statement, admission up to 2 s) + the FAILED-entry wait, which can exceed 30 s. A client retry, most likely exactly when the request is slow, then takes over and runs `call` again while the first request is still running. Database state stays correct (the first gets `IdempotencyClaimLostError` and rolls back), but the external effect is duplicated. The application clock across API instances (D-TASK040-06) also shrinks the effective lease by the clock skew. | Renew the lease, conditional on the version, before `call` and before the handler transaction. Or pin `IDEMPOTENCY_LEASE_MS > CALL_DEADLINE_MS + the transaction budgets` in a test. Record the clock-skew assumption in D-TASK040-06. |
| m5 | MINOR | `execute.ts:412-413`; `store.ts:212-214`; `tests/memory-keys.ts:166` | Changed lines that no test executes: the warning when a release fails, and the fall-through to `in-progress` after two rounds. The lane B diff-coverage gate will flag them. `MemoryRunner.refuse` is a test seam no test uses. | Use `refuse` (or `failNext = 'deleteMany'`) to test a failed release: the original status is still answered, `api.idempotency_release_failed` is logged, and the key frees after the lease. Add a unit test where the row vanishes twice between the insert and the read. |
| m6 | MINOR | `prisma/tests/idempotency/idempotency-keys.int.test.ts:370-391` | The PostgreSQL 18 suite re-types the store's statements instead of calling `store.ts`. Nothing guards drift between that copy and the store: a change to `store.ts` keeps it green. The suite has not run yet. | Lane B evidence on the head. Prefer a store-level `apps/api/src/platform/idempotency/store.int.test.ts` over the real client (TASK-041's `rate-limit.int.test.ts` is the precedent): begin, complete, replay, takeover and release, plus two concurrent `begin` calls on one scope. |
| m7 | MINOR | D-TASK040-01; api/README §5 "Replay and re-auth proof" | The claim and replay live in the tx slot (step 8), so everything between slot 7a and the tx slot runs before a replay: slot 7b If-Match (US-039) and the single-use `X-Reauth-Proof` check. README §5 requires the idempotency lookup **before** the proof check, so that a retry with an already-consumed proof is replayed. With this placement that rule cannot be met. A retried PATCH with its original `If-Match` would also get 412 instead of its replay. | Architect records the ordering constraint now, and assigns the fix to the 040-B / pipeline work when `pipeline.ts` is unlocked: a lookup at 7a, or the precondition and proof checks moved after the claim. Route it to the US-039 and re-auth task owners. |
| n1 | NIT | `packages/shared/src/classification/registry.ts:189-193` | The TASK-040 block sits between the TASK-037 `invitations` comment and the `invitations:` entry, so the invitation comment now reads as if it described `idempotency_keys`. | Move the block above the invitations comment. |
| n2 | NIT | D-TASK040-08 | The merge note ("TASK-041 adds RATE_LIMITED: union-merge the set") is stale. TASK-041 at `3a6b4c8b` does not edit `classify.ts`, and its limiter sets `Retry-After` itself. | Correct the decision text so the merger does not invent a union. |
| n3 | NIT | `request.ts:74`; `idempotency.ts:65` | `pathOf(req.originalUrl)` takes the raw URL. Upper-case UUIDs, a trailing slash or percent-encoding that Express routes to the same handler give a different scope and fingerprint. The risk is low because clients retry byte-identical requests. | Normalise (lower-case the IDs from the validated params, drop a trailing slash), or document the choice. |
| n4 | NIT | `store.ts:145-153` | A COMPLETED row that does not authenticate answers 500 on every retry for up to 24 h. That is the correct refusal, but it is invisible to operations, which would most likely see it after a rotation mistake. | Log a class-only `api.idempotency_replay_unreadable` event. |
| n5 | NIT | D-TASK040-05 | ADR-0014 amendment 1 lists explicit `guest_token_hash` and `client_ip_hash` columns; the code follows the newer, more detailed data-model §6.2. | Ask principal-architect to align the wording of ADR-0014 amendment 1 at the next fold. |
| n6 | NIT | `scope.ts:60`; `from-config.ts:51` | With an empty or untrusted `req.ip`, every anonymous caller shares one network scope (HMAC of `''`). That is harmless only while keys are unguessable. | A unit test pinning that an empty IP still gives the network kind (or refuse the claim for it), and a note tying this to the TASK-041 trust-proxy guard. |

## 4. Rulings on the developer decisions

| Decision | Ruling |
|---|---|
| D-TASK040-01 (work in the tx slot) | Accepted given the `pipeline.ts` lock. Consequence: m7. |
| D-TASK040-02 (fail closed, wiring deferred) | Accepted with the §2 conditions (m1). |
| D-TASK040-03 (only returned results stored) | **Not accepted** without an architect ruling (M2). |
| D-TASK040-04 (HKDF network key) | Accepted for the code. Security-analyst confirms the key separation (§6). |
| D-TASK040-05 (single `scope_hash`) | Accepted: it follows data-model §6.2 (n5). |
| D-TASK040-06 (application clock, version-conditional writes) | Accepted with m4. |
| D-TASK040-07 (no audit for 409/422 conflicts) | Needs a product-manager ruling (m3). |
| D-TASK040-08 (`Retry-After` allow-list) | Code accepted; text stale (n2). |
| D-TASK040-09 (extra CHECKs, migration order) | Accepted. The CHECKs are pinned in the integration test; the order is verified (§1). |
| D-TASK040-10 (no purge, `tests/contract`, no dependency) | Purge: conditional (m2). The `tests/contract` project is accepted: root `tsconfig` reference, root-scripts pin, and the files run in the `unit` project through `roots`. No dependency added: verified. |

## 5. Merge conditions

1. M1 and M2 fixed, or for M2 the ruling and the AT-US-038-07 rewording recorded. Round 2 then re-verifies the probe.
2. The m3 ruling recorded. The m1 and m2 conditions recorded in DECISIONS: 040-B owner, purge owner and cadence.
3. Lane B on PostgreSQL 18 green on the final head, for `idempotency-keys.int.test.ts` and the C15 literal. Diff coverage clean (m5).
4. The second of TASK-040 and TASK-043 to merge takes the four literal unions in §1. Then a TASK-041 import union in `pipeline-guards.test.ts`. Keep migration `20261120100000` after any migration on main. TASK-293 is already on main.
5. A security-analyst record covering the security-owned paths: `prisma/**`, `tools/db/**`, `apps/api/src/platform/**`.

## 6. Good

- The claim, takeover, completion and release are all conditional on `(id, version, IN_PROGRESS)`. A stale request can neither complete nor release a claim that was taken over, and its 2xx rolls back (`IdempotencyClaimLostError`).
- AES-256-GCM with a random 96-bit nonce. The AAD is the JCS of `[table, column, hex(scope_hash), key_id]`, so a body copied to another scope or relabelled to another key does not authenticate. Dual read is keyed by `key_id`, and keys are refused at composition when malformed.
- The scope hash is the JCS of a versioned array, so concatenations cannot collide. The client network is keyed, never a bare SHA-256 of an IPv4 address.
- Mount-time refusals: an idempotent mode on a safe method, on a `transaction: 'none'` route, or without a store.
- The 4xx completion order matches the card: rollback, then the FAILED entry, then the completion, and the events are pinned.
- The extra CHECKs (`__response_status`, `__completed`, `__body_key_id`) make an impossible row unrepresentable in the database.
- The contract suite has a planted negative.

## 7. Security flags (for security-analyst)

- D-TASK040-04: the network HMAC key is HKDF of the **raw** body key, which is also used directly as the AES key. Confirm that the key separation is acceptable, or derive both keys by HKDF with distinct info labels. A rotation also changes every anonymous scope.
- Anonymous scope by client network: callers behind one NAT share a scope, and with a misconfigured trust proxy every anonymous caller shares one (n6). A collision needs the other caller's key and an identical body. Stored bodies may hold the caller's PER.
- M1: a replay bypasses the fail-closed VIEW/DOWNLOAD audit entry. Decide also whether **any** replay of a SENSITIVE VIEW/DOWNLOAD route needs its own entry (README §5 says no second entry).
- M2 and m4: a thrown 4xx release, or a lease takeover, re-runs `call`, an external effect.
- m3: REQ-AUDIT-010 gaps for idempotency conflicts and claim-phase 5xx.
- m2: PER ciphertext retained beyond 24 h until a purge exists. The SYSTEM owner map blocks a worker purge.
- `idem_key` is stored in clear and is client-chosen. Confirm it is never logged. Today the only log lines are the two `settleClaim` warnings in `execute.ts:406,412`, which carry the error class and the status only.


---

# Round 2: head `d0a82a24` (2026-11-20)

- **Commits reviewed:** `b281e5f3`, `5ab1f903` and `d0a82a24`, on top of `95945b7e`. Decisions are in the `d0a82a24` body: D-TASK040-03 revised, -06 amended, -08 corrected, -11 and -12 new.
- **Rulings now on main:**
  - product-manager: D-PM-081 and D-PM-082 (`164be6b0`; REQ-AUDIT-010 amended, A-116);
  - principal-architect: ADR-0014 amendments 5 to 9, D-ARCH-191..195 (`91ec18cf`).
- **Coordinator heads-up:** D-ARCH-195 (ADR-0014 am. 6) requires a stored 4xx to be the **rendered problem document as sent, `correlation_id` included**. The `{code, detail, errors}` form that this head re-renders on replay is therefore superseded. Fix cycle 2 is changing it, so I do not rule on that form here.

```
VERDICT: CHANGES_REQUESTED (procedural: M2 is superseded by D-ARCH-195 and is re-checked in round 3; nothing else blocks)
SUMMARY: M1 is closed. I re-ran the round-1 probe as the new [M1] tests: a failed DOWNLOAD entry now releases the key
  and the retry executes. m3, m4, m5, m6, n1, n3, n4 and n6 are closed. D-PM-081 is implemented and tested.
  m1, m2 and m7 are closed by rulings (D-ARCH-191/192/193) and carried to part 040-B. n5 is closed by D-ARCH-194.
  New: 4 NITs. Round 3 = the D-ARCH-195 storage form, the merge of main, F5/F6, and lane B on the final head.
FINDINGS: 0 BLOCKER, 1 MAJOR (M2, superseded: re-check in round 3), 0 new MINOR, 4 new NIT
```

## R2.1 What I verified myself

I ran nothing in `../Shipqube-TASK-040`, which is busy with lane B.

**Set-up.** I worked in a `git archive d0a82a24` extract taken from the main checkout. Its `node_modules` was a junction to the idle `Shipqube-TASK-039` worktree, whose lock is byte-identical to the branch lock (md5 `4a24da81…`). I added `@platform/*` junctions inside the extract so that every workspace link resolved to the extract's own sources. I generated the Prisma client inside the extract. I pointed each `tsBuildInfoFile` into the extract. Afterwards I removed the junctions and the extract. The TASK-039 worktree is unchanged: still 748 entries and a clean `git status`.

| Check | Result |
|---|---|
| Jest `unit` + `api` (`--maxWorkers=2`) over `platform/idempotency`, `errors/`, `pipeline-guards`, `db/system-db`, `contract/x-idempotency`, `grants-manifest`, `tx/`, `audit/capture` | 19 suites, **326 of 327 passed**. The one failure is the fast-check property `AT-US-007-03 … any thrown value … answers the same generic 500` in `problem-handler.api.test.ts`, at 17.8 s under parallel load. Neither that test nor the problem handler is changed by this branch. It passed 2 of 2 when re-run alone (62/62). It is load timing, not this change. |
| Route metadata, classification (tools and shared), root scripts, table classes | 6 suites, **121 passed** |
| `tsc -b` over shared, config, authz, audit, pricing, carriers, api, worker, prisma, tests/{generated,helpers,factories,api,contract} and tools | clean |
| ESLint `--max-warnings 0` on every `.ts` file changed from main | clean |
| Prettier `--check --ignore-unknown` on every changed file | clean |
| Coverage of `tx/execute.ts` and `platform/idempotency/*` (the tests above) | **100 % of lines** in every file. Round 1's uncovered `execute.ts:412-413` and `store.ts:212-214` are now covered. |
| M1 probe (round 1) against the new head | Now pinned by the tests `[M1] … completes its key after the fail-closed entry` and `[M1] a failed DOWNLOAD entry answers 503 AUDIT_UNAVAILABLE, releases the key, and the retry runs and writes the entry`. In the code (`execute.ts` after the handler commit), `audit.afterCommit` runs first, a failure releases the pending claim and rethrows, and only a success completes it. |
| Merge-tree against `origin/main` (`af4a1b48`) | **clean** |
| Merge-tree against TASK-043 (`da996002`) | Unchanged from round 1: the 4 one-line literal unions plus `DECISIONS.md`. The copied helper `idempotency/tests/migrated-postgres.ts` sits at a path of its own, so it causes no conflict, only duplication with the TASK-043 copy. |

**Not re-run:** `store.int.test.ts`, `idempotency-keys.int.test.ts` and the C15 literal. They need Docker, so they belong to lane B.

## R2.2 Round-1 findings

| ID | Status | Evidence |
|---|---|---|
| M1 | **Closed** | `execute.ts`: `audit.afterCommit` before `settleClaim` for a pending (read-only) claim; a failure releases it and rethrows. Two API tests cover it, and the order of events is asserted. |
| M2 | **Superseded by D-ARCH-195; re-check in round 3** | This head stores a thrown 4xx (closing the defect that a thrown 4xx released the key: `storedProblemOf` follows `classifyThrown`, and a DbError 4xx such as 403 `RLS_WRITE_REJECTED`, 404 or 409 is stored, while every retryable DbError is a 503 and is released). It then re-renders the problem on replay with a new `correlation_id`. ADR-0014 am. 6 now requires the rendered document as sent, rendered once. **Round 3 checks:** (a) the stored body is the exact document of the first response, its `correlation_id` included, and the replay sends it byte for byte with its own `X-Correlation-Id` header; (b) the tx slot renders it with the same `buildProblem` inputs as the problem handler, including the configured `typeBase` (a test in which a non-default type base survives a replay); (c) `Retry-After` is never stored; (d) the `Content-Type` stored-header allow-list (am. 6 lists it) cannot turn a handler's own returned `application/problem+json` result into an unreadable 500. Today's `replayedProblemOf` would throw `IdempotencyReplayError` for a returned problem body that is not of the `{code, detail, errors}` shape. Add a test: a returned 4xx with its own `Content-Type: application/problem+json` is replayed as returned. |
| m1 production wiring | **Closed by ruling** (D-ARCH-191, D-PM-082; ADR-0014 am. 9) | Part 040-B is defined with its proofs (a) to (f). The refusal at mount stays the control until then. |
| m2 purge | **Closed by ruling** (D-ARCH-192; am. 8) | Worker `idempotency-purge`, hourly, batches of 5,000, owner entry widened to `apps/*/src/platform/idempotency/**`. Ships in 040-B or before it. |
| m3 audit of protocol refusals | **Closed** (D-PM-081, REQ-AUDIT-010 amended) | No entry for 409 and 422, each logged `api.idempotency_conflict` with the code and correlation id. The key is never logged (asserted against the serialised log lines). An unreadable replay gives 500 with an ERROR event `api.idempotency_replay_unreadable {error, reason}` and no FAILED entry. A failed claim on a new request writes exactly one FAILED entry (`[D-PM-081 (c)]`). |
| m4 lease | **Closed** | `idempotencyLeaseMs`: the lease is max(30 s, max(call deadline, 2 × (maxWait + timeout) + FAILED wait) + 5 s), taken from the runner's own `transactionOptions`. It is renewed before `call` (when there is a `load`) and before the handler transaction (when there is a `load` or a `call`), conditional on the version. A lost claim answers 409 before the next phase. Both the sizing and the renewals are tested. The application clock stays, with skew covered by the margin (D-TASK040-06 amended). See R2-n1 and R2-n3. |
| m5 uncovered lines | **Closed** | 100 % line coverage; a failed-release test; a two-round fall-through test. The `refuse` seam is removed. |
| m6 statement mirror | **Closed** | `store.int.test.ts` runs `store.ts` itself on PostgreSQL 18: begin, complete, replay, concurrent begin, renew, takeover, release, expiry and the stored problem. It is pending lane B. Duplicated helper: R2-n4. |
| m7 order around the claim | **Closed by ruling** (D-ARCH-193; am. 7) | The design is accepted. The order goes into the file headers in 040-B; TASK-096 and TASK-187 carry it. |
| n1 | Closed | The registry block now sits above the invitations comment. |
| n2 | Closed | D-TASK040-08 corrected. |
| n3 | Closed | `concretePathOf(template, validated params)`. Safe because `defineRoute` requires the `schema.params` keys to equal the path parameters and limits segments to `[a-z0-9._-]` or `:name` (`define-route.ts:323,540-543`), so no parameter can be missing or a wildcard. The `[n3]` test replays across a trailing slash and a percent-encoded id. |
| n4 | Closed | ERROR event `api.idempotency_replay_unreadable` with the class and a fixed reason only. |
| n5 | Closed by ruling | D-ARCH-194 (am. 5). |
| n6 | Closed | No client network means no scope. An `optional` route runs without idempotency; a `required` one answers 503 with its FAILED entry and logs `api.idempotency_scope_unavailable` (D-TASK040-11). |

## R2.3 New findings (round 2)

| ID | Severity | File:line | Issue | Suggested fix |
|---|---|---|---|---|
| R2-n1 | NIT | `execute.ts` `idempotencyLeaseMs` | The sizing counts two transactions after the last renewal. The read-only (VIEW/DOWNLOAD) path runs three: the handler transaction, the fail-closed entry, the completion. It also leaves out the admission wait that comes before the pool's `maxWait` (≤ 250 ms by default). With the defaults the 30 s floor and the 20 s call deadline dominate, so there is no exposure. With a raised `DB_TX_*` budget (up to 120 s) the read-only path can outlive the lease. A takeover then re-runs that route's `afterCommit` effect (the e-mail of `emailShipmentDocuments`). | Use `3 × (maxWait + timeout + admission wait)`, and pin it in `idempotency-lease.test.ts`. |
| R2-n2 | NIT | `execute.ts` `renew` (lost claim) | A claim lost at the renewal **before the handler** answers 409 `IDEMPOTENCY_IN_PROGRESS` with no FAILED entry, but `call` (an external effect) has already run (test `[m4] a key taken over during call …`). Amended REQ-AUDIT-010 excepts refusals "before the handler runs", which this literally is, but here the business action was attempted. This only happens when the sizing invariant is broken (a pause longer than the lease plus the margin). | Write the FAILED entry when the claim is lost after `call` (the attempt is real), or record in D-PM-081 that this case is covered. security-analyst to confirm. |
| R2-n3 | NIT | `execute.ts` `run` | A route with `load` and `call` now uses five transactions (claim, load, renew, renew, handler) where it used three. Each takes a bulkhead admission. The cost is acceptable and the correctness gain is real. | Optional: skip the renewal before the handler when less than half the lease has passed since the last one. |
| R2-n4 | NIT | `apps/api/src/platform/idempotency/tests/migrated-postgres.ts` | A copy of TASK-043's `outbox/tests/migrated-postgres.ts` (stated in its header). Two copies of the container/bootstrap harness will drift, for example in the pinned image digest. | Whichever of TASK-040 and TASK-043 merges second moves both suites onto one shared helper. Name the owner in DECISIONS. |

## R2.4 Rulings on the new and revised decisions

| Decision | Ruling |
|---|---|
| D-TASK040-03 (revised) | Partly done. Storing thrown 4xx is right and matches am. 6. The storage form is superseded by D-ARCH-195 (round 3). |
| D-TASK040-06 (amended) | Accepted with R2-n1. Version-conditional writes keep the stored state correct under skew. |
| D-TASK040-08 (corrected) | Accepted. |
| D-TASK040-11 (no scope without a client network) | Accepted. Better than a shared scope, and the `required` route's 503 has its FAILED entry. |
| D-TASK040-12 (template path) | Accepted. The path grammar of `defineRoute` makes it total. |
| D-TASK040-04 (HKDF network key) | Still open for the security record, as ADR-0014 am. 5 records. |

## R2.5 Merge conditions (replace §5)

1. Round 3 on the fix-cycle-2 head: the D-ARCH-195 storage form against the M2 re-check list above, comment fixes F5/F6, and the merge of main, proved as a pure union.
2. Lane B on PostgreSQL 18 green on the final head for `store.int.test.ts`, `idempotency-keys.int.test.ts` and the C15 literal. Diff coverage clean.
3. The second of TASK-040 and TASK-043 to merge takes the four literal unions (§1) and settles R2-n4.
4. A security-analyst record on the final head, covering D-TASK040-04 and R2-n2.
5. Part 040-B, including the purge, as ruled in ADR-0014 am. 8 and 9. It does not block this part.

## R2.6 Good

- The M1 fix keeps one error path: the entry, then the release or the completion. Its tests assert the order of events, not just the statuses.
- The lease is derived from the runner's own `transactionOptions` instead of a constant, and renewals are version-conditional. A lost claim is answered before `call` can run twice.
- The D-PM-081 tests serialise every log line and assert that neither the key nor the body appears.
- `storedProblemOf` reuses `classifyThrown`, so stored and rendered failures cannot disagree on the status.
