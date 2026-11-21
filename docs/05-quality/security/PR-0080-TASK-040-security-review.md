# PR-pending: TASK-040 part 040-A (idempotency keys with encrypted stored responses), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-040-security-review.md`. `<NNNN>` is the PR number zero-padded to 4 digits; the content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>` (D-ORCH-136, D-ORCH-138).

**Finding IDs.** `PR040-SEC-nn` are the findings of this task (TASK-040). They are not the `PR40-SEC-nn` findings of PR #40 (TASK-015, merged-coverage hook).

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-040-idempotency-keys`. **Original base `4e1163aa`:** `a633eb84`, `9f08ecb5`, `4ae63622`, `5e0dc1b0` (wip); `95945b7e` (feature, D-TASK040-01..10); `b281e5f3`, `5ab1f903` (wip); `d0a82a24` (fix cycle 1: M1, M2, m4, m5, m6, n1, n3, n4, n6, D-PM-081). **Merge of main `af4a1b48`:** `40fce4b2`. **Fix cycle 2:** `099fa1ad` (wip) and `3dc1e225` (D-ARCH-195: a 4xx is stored as the problem document as sent; D-TASK040-13) |
| Head | 3dc1e2259fe423d92a26a69915d1907f5ab657a8 |
| What was reviewed | `4e1163aa..d0a82a24` in full. The merge `40fce4b2` is a pure union: its tree `f7a0ca46` equals `git merge-tree --write-tree af4a1b48 d0a82a24`, and main had changed no path this branch owns. The fix-cycle-2 delta `40fce4b2..3dc1e225` (10 files, all under `apps/api/src/platform/`) was also reviewed in full. The coordinator asked for the round to bind to the final head, so it binds to `3dc1e225`, and no separate delta round is owed for fix cycle 2 |
| Merge base with main | `af4a1b48`. Main tip when this round was written: `eb0aab52`. Since `af4a1b48` main has changed documents only, and `git merge-tree --write-tree eb0aab52 3dc1e225` is clean |
| Lane A evidence | None; the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs --base af4a1b48 --head 3dc1e225`) gives `security_paths=true` (34 paths), so the hosted `security-integration` job runs on the PR |
| Lane B evidence | None at review time. `store.int.test.ts`, `prisma/tests/idempotency/idempotency-keys.int.test.ts` and the C15 literal are read from the source, not run |
| Owned paths changed | 37, as main's checker counts them (`--base af4a1b48 --head 3dc1e225`):<br>- 26 under `apps/api/src/platform/`: the `idempotency` module and its tests; `tx/execute.ts`, `tx/idempotency-lease.test.ts`; `errors/classify.ts`, `errors/problem-handler.ts`, `errors/rendered-problem.ts` and their tests; `db/system-models.ts`, `db/system-db.test.ts`; `routing/pipeline-guards.test.ts`;<br>- 6 under `prisma/`: the migration `20261120100000_idempotency_keys` and its `down.sql`, `platform.prisma`, `grants.manifest`, the C15 test, `idempotency-keys.int.test.ts`;<br>- `tools/db/grants-manifest.test.ts`, `tools/db/table-classes/idempotency.json`;<br>- `tests/contract/tsconfig.json`, `tests/generated/api-mounts.ts`, the root `tsconfig.json`.<br>So this record is a merge condition |
| Unowned paths read | - `packages/shared/src/classification/registry.ts` (diff);<br>- `tests/contract/x-idempotency.test.ts`;<br>- on the head: `errors/problem.ts`, `db/with-tenant-tx.ts`, `db/map-db-error.ts`, `audit/capture.ts`, `logging/request-logger.ts`, `app.ts`;<br>- `packages/shared/src/errors/app-error.ts`;<br>- `packages/config/src/{schema,keys,guards}.ts`;<br>- `prisma/sql/function-templates/std-columns-guard.sql`;<br>- `tools/ci/security-paths.mjs`, `.github/CODEOWNERS`;<br>- `openapi.yaml`: the 47 operations whose `x-idempotency` is `required` or `optional` |
| Binding items checked | - ADR-0014 §HTTP idempotency and amendments 1 and 4 to 9 (D-ARCH-191..195);<br>- ADR-0018 amendment 1 (key register, "one key per purpose", row `IDEMPOTENCY_BODY_KEY`);<br>- data-model §3.5, §6.2, §10.4; api/README §5;<br>- threat model T-79, R-05, AC-13, AC-14, SEC-TC-04, SEC-TC-53;<br>- REQ-API-009..011; REQ-AUDIT-005; REQ-AUDIT-010 as amended (D-PM-081); D-PM-082;<br>- D-QG-003 (QG-040-C4);<br>- code review rounds 1 and 2 (`docs/05-quality/reviews/PR-pending-TASK-040-code-review.md`) |
| Reviewer / date | security-analyst, 2026-11-20, round 1, pre-push.<br>**Host rule:** lane B owns the machine and the evidence worktree. I ran no npm, Jest, type-check, build or Docker, and no command at all in `../Shipqube-TASK-040` or in the branch worktree.<br>**Method:** static review, plus single-process Node 24 probes on `git archive` extracts of `d0a82a24` and `3dc1e225`. A load hook stripped the types; `@platform/*` was mapped to each extract's own packages; other packages resolved from the main checkout. Nothing ran against PostgreSQL |

## 1. Summary

The store meets the T-79 / R-05 mitigation it was built for.

- **Encryption.** Bodies are AES-256-GCM with a random 96-bit nonce and a full 128-bit tag. The AAD binds the table, the column, `hex(scope_hash)` and the key id. Probe P1 refuses all of these: a body read under another scope, a relabelled key id, a flipped bit, a truncated ciphertext (29 of 29, on both heads).
- **Dual read** works by key id.
- **Scopes.** Each of these gets its own scope: two users of one organisation; an organisation's actor and the same actor without one; a guest; an anonymous caller. The anonymous network is keyed (HMAC), never a bare hash.
- **The fix cycles close the security-relevant review items.**
  - **M1:** on a VIEW/DOWNLOAD route the fail-closed entry is written before the key is completed, and a failed entry releases the key.
  - **M2:** a thrown 4xx is stored, so a retry after a refused booking no longer runs `call` again.
  - **D-ARCH-195:** the stored 4xx is the rendered document. It replays byte for byte through the problem handler, with the handler's headers (P4).
- **Logs.** No log line carries the key, the scope hash or a body (P3, P4, and the D-PM-081 tests).

**New findings: five LOW and four INFO. Nothing Critical, High or Medium.**

- **PR040-SEC-01 (LOW, D-TASK040-04).** The configured key material is the AES key itself and also the HKDF input of the network HMAC key. Derive both keys.
- **PR040-SEC-02 (LOW).** Only the body is authenticated. Anyone who can write to the table can change a replay's status, `Location` and `Content-Type`; Express keeps a stored `text/html` over `res.json`. At `3dc1e225`, flipping a stored problem's marker turns it into an ordinary `text/html` replay. Seal the whole stored response.
- **PR040-SEC-03 (LOW).** `checkoutOrder`, `confirmPayment` and `createPaymentMethodSetup` store a Stripe `client_secret`, against "no stored secrets". Record the acceptance, or change the requirement.
- **PR040-SEC-04 (LOW, = code review R2-n1, extended).** The lease formula misses the third transaction of the read-only path and the renewal around `call`. Headroom is 3 s at the defaults and negative from `DB_TX_STATEMENT_TIMEOUT_MS` = 9 s.
- **PR040-SEC-05 (LOW, = R2-n2).** A claim lost after `call` answers 409 with no FAILED entry. Its only trace is the info line of an ordinary conflict.
- **PR040-SEC-06 to -09 (INFO):**
  - -06: `idem_key` is stored in clear, and nothing reads it.
  - -07: three contract pins are missing.
  - -08: the "5xx releases" rule needs `call` to be idempotent at the provider.
  - -09: a thrown 4xx whose document cannot be serialised leaves the claim held until the lease ends.

**Every LOW is due before part 040-B merges.** No row can exist and no idempotent route can mount in any composition before 040-B, so no LOW is exposed today. The 040-B security round checks them.

**Rulings asked of me (§3; QG-040-C4):**

| Item | Ruling |
|---|---|
| D-TASK040-04 | Stands, with the PR040-SEC-01 change. The rotation effect is accepted |
| D-ARCH-193 | Confirmed, with T187-1 to T187-6 |
| D-ARCH-195 form | Accepted; F2-2 to F2-4 hold, F2-1 waits for PR040-SEC-02 |
| D-PM-081 | Concurrence, except for one case (PR040-SEC-05) |
| Retention until 040-B | No exposure |
| Replay of a SENSITIVE VIEW/DOWNLOAD route | No entry of its own is needed |
| `Retry-After` allow-list | Accepted |
| D-ARCH-192 | Concurrence, with conditions P-1 to P-5. The worker folder joins CODEOWNERS (PR64-SEC-09), not `security-paths.mjs` |
| T-79 / R-05 | Text owed by me before G3 |

## 2. What I verified

| Check | Result |
|---|---|
| P1: body cipher (`body-cipher.ts`) | **29 of 29 on `d0a82a24` and `3dc1e225`.**<br>- Works: the round trip; dual read of a v1 body under a cipher with v2 current and v1 previous; new bodies are written under v2.<br>- Refused with `IdempotencyReplayError`: another scope (AAD); a key id relabelled to v2; an unknown key id; bit flips at bytes 0, 12, 20 and the last; a ciphertext without its tag.<br>- 10,000 seals gave 10,000 distinct nonces.<br>- A v2 body cannot be read by a cipher that holds v1 only. This is the old task set during a rolling rotation, and it fails closed with a 500.<br>- Decrypting with the **configured key bytes directly** succeeds: the AES key is the material itself (PR040-SEC-01) |
| P1: scope matrix (`scope.ts`) | **Distinct scopes:**<br>- two users of one organisation;<br>- an organisation's actor and the same actor without an organisation;<br>- a guest and an anonymous caller;<br>- neighbouring IPv4 addresses.<br>**Shared scopes:**<br>- an organisation scope ignores the IP and the case of the ids;<br>- `::ffff:a.b.c.d` equals `a.b.c.d`;<br>- one IPv6 /64 is one scope (R-05 by design).<br>**Other results:**<br>- A changed network key gives another anonymous scope (rotation).<br>- No scope is formed for `''`, `unknown`, `1.2.3`, a bad mapped address, or a leading space (n6).<br>**Aside:** the expanded mapped form `0:0:0:0:0:ffff:0102:0304` falls into the shared `::/64` bucket of `::1`. Only a caller who can choose `req.ip` reaches it, and that caller can pick any network anyway. Not a finding |
| P2: lease sizing (the real `idempotencyLeaseMs`, both heads) | The table in PR040-SEC-04. At `DB_TX_STATEMENT_TIMEOUT_MS` = 5 s (default), the lease is 30 s and the longest stretch 27 s. At 8 s the headroom is 0; from 9 s it is negative |
| P3 (`d0a82a24`): the real store over the branch's in-memory delegate, with the real `TenantDb` guard and `systemDelegates` | **14 of 14.**<br>- The body is ciphertext; `idem_key` is in clear.<br>- A row with only `response_status` (201 to 200) and `response_headers` (`Content-Type: text/html`, a foreign `Location`) changed still replays, because the body stays authentic. Real Express 5 then sends `text/html; charset=utf-8` for a `res.json` body, the foreign `Location`, and neither `X-Content-Type-Options` nor a CSP (PR040-SEC-02).<br>- A 429, a 503 and a plain `Error` are not stored; a DbError 403 is stored.<br>- For a reused key, an in-progress key and an unreadable row, neither the log lines nor the thrown error contain the key sentinel or the scope hash |
| P4 (`3dc1e225`): the D-ARCH-195 form, through the real problem handler and Express | **10 of 11.**<br>**The stored document:**<br>- keys `type, title, status, detail, instance, code, correlation_id, errors`;<br>- the configured type base is applied;<br>- `instance` drops the query;<br>- `detail` and every own field of each `errors[]` item are stored, including a free-text sentinel and an extra `value` field.<br>**The replay:**<br>- the bytes on the wire equal the first answer's, with the first `correlation_id`;<br>- `application/problem+json`;<br>- `Cache-Control: no-store` without a credential and `private, no-store` with one;<br>- no `Retry-After`;<br>- the handler's own `ETag` is dropped.<br>**Clear-column tampers:**<br>- a status flip on a problem row is refused (`IdempotencyReplayError`, because the catalogue status must match);<br>- **a marker flipped to `text/html` replays the document as an ordinary `text/html` result** (PR040-SEC-02).<br>**Other results:**<br>- An `errors[]` item that cannot be serialised makes `storedProblemOf` throw a `TypeError` (PR040-SEC-09).<br>- The logs carry no sentinel.<br>**The one failed check is a probe artefact:** Express's application-wide weak `ETag` (`app.ts` does not disable `etag`) is on the first answer and the replay alike. It is not a change of this branch |
| The real runner's error path (`with-tenant-tx.ts` `mapped`) | Non-database errors pass through unchanged. So `IdempotencyReplayError` (no FAILED entry, D-PM-081) and `IdempotencyClaimLostError` reach `execute.ts` with their class, as the tests' in-memory runner assumes |
| Logs | - The request logger never logs headers or bodies.<br>- The problem handler logs a 5xx with its class and a redacted message, and a DbError as `{name, code, originalCode, kind}`.<br>- The new events carry only `code`, `correlation_id`, `mode`, `status`, `error` (a class) and `reason` (a fixed phrase).<br>- The rendered-problem path logs nothing for a 4xx, as before |
| Migration, grants, table classes | - SYSTEM, no RLS. `platform_app` holds SELECT, INSERT, UPDATE and DELETE (the hard-delete allow-list), consistent across `idempotency.json`, the manifest and its test.<br>- The CHECKs: key `^[\x21-\x7E]{1,255}$`; 32-byte scope hash and fingerprint; the status pair; `response_status` within 200–499 and never 429; body and key id together; the key-id grammar.<br>- The standard-columns guard asserts `version = OLD.version + 1` on every UPDATE. That is what makes takeover, renewal and completion version-conditional.<br>- `response_body` is PER (the C10 exception); every other column is INT |
| `classify.ts`; `rendered-problem.ts` | - `Retry-After` is kept on a 503 and on the exact client code set `{IDEMPOTENCY_IN_PROGRESS}`, read with `ownDataProperty`.<br>- A `RenderedProblemError` is recognised only through its `WeakSet` brand: a forged look-alike is classified as usual.<br>- The 409 of a lost claim is never stored, because the claim is cleared first |
| Contract surface (`openapi.yaml`) | - 47 idempotent operations: 6 `required`, 41 `optional`.<br>- Exactly one is public (`security: []`): `recordConsent`, the only network-scoped operation.<br>- Exactly one has a VIEW/DOWNLOAD audit: `emailShipmentDocuments` (DOWNLOAD, SENSITIVE, 202, no body).<br>- Three carry `client_secret` in their 2xx schema.<br>- About twenty carry PER in their 2xx bodies: addresses, names, e-mail, phone, organisation tax references |

## 3. Rulings asked of security-analyst (QG-040-C4 and the dispatch)

### 3.1 D-TASK040-04: the anonymous scope key

1. **The keyed network hash stands.** `idem_key`, the method and the path are stored in clear. An unkeyed hash of an IPv4 address could then be reversed over 2^32 candidates, so the HMAC is required.
2. **Key separation needs a change (PR040-SEC-01).**
   - **Today.** The configured `IDEMPOTENCY_BODY_KEY` material is the AES-256-GCM key. It is also the input of `HKDF-SHA256(…, info "platform-idempotency-scope-network-v1")`.
   - **Risk.** No practical attack is known. But one secret now serves as a cipher key and as a key-derivation key. That conflicts with the register's "one key per purpose" (ADR-0018 amendment 1 item 1) and with NIST SP 800-108r1, under which a key-derivation key only derives.
   - **The change.** Derive both keys, `body = HKDF-SHA256(material, salt = empty, info = "platform-idempotency-body-v1", 32)` and `network = HKDF-SHA256(material, salt = empty, info = "platform-idempotency-scope-network-v1", 32)`. Derive the `_PREVIOUS` key the same way.
   - **Cost.** One line. No row exists in any deployment before part 040-B, so there is no compatibility cost.
3. **The rotation effect is accepted.**
   - **What happens.** The network key follows the current key, so a rotation changes every anonymous scope. During a rolling deploy the two task sets compute different scopes.
   - **Why it is harmless.** The only network-scoped operation is `recordConsent` (public, NORMAL). Its answer is the caller's own submission plus a record id and a time. A retry that spans the switch records the consent twice, and consent records are append-only, with the newest winning (EC-A47).
   - **Pin.** The set is pinned by PR040-SEC-07 (a).
4. **Every scope during a rotation: register-wide, no finding.**
   - **What happens.** `guards.ts` requires `<NAME>_PREVIOUS` to be an older version, so no read-ahead step is possible. During the rolling deploy, an old task that replays a row written by a new task answers 500 and raises `api.idempotency_replay_unreadable`. That fails closed and lasts minutes. Every dual-read key in the register behaves the same.
   - **Owed.** principal-architect states this in the register's rotation note, or adds a `<NAME>_NEXT` form.
5. **The NAT and trust-proxy sharing is accepted.**
   - **Who shares.** Callers behind one NAT share the network scope of `recordConsent`. So does every anonymous caller when `TRUST_PROXY_HOPS` is too low (PR041-SEC-05).
   - **Why it is accepted.** A cross-caller replay needs the other caller's key and an identical body, and the body includes the visitor's random `anonymous_id`. An empty IP is refused (D-TASK040-11).
6. **Owed by principal-architect before part 040-B merges** (D-ARCH-194; QG-040-C4):
   - **The ADR-0018 register row `IDEMPOTENCY_BODY_KEY`:** "key-derivation input of two HKDF keys: AES-256-GCM stored responses (AAD `hex(scope_hash)` and key id) and HMAC-SHA-256 of the anonymous client network".
   - **Its blast radius:** "replay bodies, including PER and payment client secrets, at most 25 h; pseudonyms of anonymous client networks".
   - **data-model §10.4:** `scope_hash` is an unkeyed SHA-256. For organisation, actor and guest owners its inputs are identifiers that the row stores anyway, or are already hashes. For the network owner the input is an HMAC under the derived network key.

### 3.2 D-ARCH-193: the proof check after the claim, consumed before `load`

**Confirmed.**

- **Why skipping the check on a replay is not a bypass.** A replay runs after the retry's own authentication, MFA gate, authorisation and class limit. It returns the stored result of an execution that passed the check, and only to the same scope (organisation, actor, method, path, key). It starts no action. A token thief who also holds the key gets data that the same token can read through the GET routes.
- **Accepted residual.** Within 24 h, a replay returns the data as it was, even if the actor has since lost access to that one resource through RLS while keeping the route permission.

**Conditions on TASK-187, checked in its security round:**
- **T187-1.** Consumption is one conditional statement (`UPDATE … WHERE consumed_at IS NULL AND expires_at > now() AND actor, session and operation match … RETURNING`). It runs in its own committed transaction, after the claim and before `load`.
- **T187-2.** A refusal releases the claim and is never stored.
  - At `3dc1e225`, `storedProblemOf` stores every thrown 4xx except a 429. The check's 401 `REAUTH_REQUIRED` must therefore be excluded explicitly in `execute.ts`.
  - Test: the same key with a fresh proof executes.
- **T187-3.** The proof never enters the fingerprint, a stored body, an audit value or a log line.
- **T187-4.** A replay, a 409 or a 422 neither reads nor consumes a proof. The `ReauthProofConditional` parameter text ("a proof that is sent is always verified and consumed", QG-040-C3 (a)) must say so.
- **T187-5.** After a lease takeover, the retry must present a fresh proof, because the first one is spent. A test covers it.
- **T187-6.** The check runs on every new execution of the `org.member.manage` and `payment_method.manage` operations, whatever their idempotency mode. This generalises SEC-P3-33 item 9.

### 3.3 D-ARCH-195: the storage form of a thrown 4xx (implemented at `3dc1e225`)

**Accepted.**

**What a stored problem document holds.**
- free-text `detail`, which may carry personal data (PR63-SEC-01 is still open);
- every own field of each `errors[]` item;
- `instance`, the request path with resource ids and without the query;
- the first request's correlation id.

It is no more sensitive than the stored 2xx bodies (addresses, names, e-mail addresses, tax references), and it gets the same encryption and the same 25 h bound. The replayed `correlation_id` goes back to the scope that received it.

**Checks:**

| Check | Result |
|---|---|
| F2-1: the document lies inside the authenticated envelope | Not met: PR040-SEC-02 |
| F2-2: problem-handler parity | **Met.** The replay goes through the problem handler's rendered path: `application/problem+json`; `no-store` or `private, no-store`; `DROPPED_ON_PROBLEM` removed; the error mark set (P4) |
| F2-3: nothing that must not be stored is stored | **Met.** A 409 from a lost claim, a thrown 429 and a thrown 5xx are never stored; no `Retry-After` is stored or replayed |
| F2-4: logs | **Met.** No key, body or scope in any log line |

### 3.4 D-PM-081: refusals without an audit entry

**I concur** for these three cases:
- the 409 `IDEMPOTENCY_IN_PROGRESS` of the claim;
- the 422 `IDEMPOTENCY_KEY_REUSED`;
- an unreadable replay.

They refuse before any action, inside the caller's own scope, and they are logged with the code and the correlation id.

**A note for TASK-214.** An ERROR event per unreadable retry can repeat for 24 h, bounded only by the class limit. The alert should therefore fire on a rate.

**One objection.** The developer applied the exception to the 409 of a renewal **after `call`** (fix cycle 1 commit body: "from the claim or from a renewal"). There the action was attempted and an external effect ran (PR040-SEC-05). This goes back to product-manager, as D-PM-081 invites.

### 3.5 Retention until part 040-B (D-ARCH-191, D-ARCH-192)

**No exposure now.** No composition on main or in Compose has a store. An idempotent route is refused at mount, and the module registry mounts no such route. So no row can exist before 040-B.

**If 040-B merged without the purge, I would rate it MEDIUM** (CWE-359; A04). PER ciphertext would outlive the 24 h upper bound of REQ-API-009, because lazy deletion fires only when the same UUID key is claimed again. D-ARCH-192 ("with the wiring or before it, never after") is the control, and the 040-B security round checks it.

Backups hold the ciphertext for their own retention (T-81, RR-05, M5).

### 3.6 Replay of a SENSITIVE VIEW or DOWNLOAD route (code review §7)

**No entry of its own is needed.**

- **The only such operation** is `emailShipmentDocuments`, which answers 202 with no body.
- **Why the replay needs no entry.** The replay sends no e-mail and transfers nothing to anyone new: the same actor, re-authorised, gets the same 202. The disclosure happened once, with its entry, and the M1 fix guarantees that entry.
- **Pin.** The set is pinned by PR040-SEC-07 (b).
- **Future operations.** An idempotent VIEW or DOWNLOAD operation that returns sensitive content in its body needs a decision first: either a replay entry, or `not-applicable`.

### 3.7 The `Retry-After` allow-list (D-TASK040-08)

**Accepted.** It is an exact code set, read as an own data property, so no other client error can grow the header. No stored response carries `Retry-After`.

### 3.8 D-ARCH-192: the hourly worker purge and the wider owner entry (QG-040-C4, before part 040-B is dispatched)

**I concur** that the purge runs in the worker, hourly, under the four conditions of D-SECPR039-01. I also concur with widening `SYSTEM_MODEL_OWNERS.idempotency` to `apps/*/src/platform/idempotency/**`. The rules "never reads `response_body`" and "imports nothing from the API store" are review rules today, so they need mechanical backing:

- **P-1. CODEOWNERS: required.**
  - **The line.** `/apps/worker/src/platform/idempotency/` gets a CODEOWNERS line, before part 040-B merges. Add it to PR64-SEC-09 (devops-engineer), which already covers the worker's `queues`, `jobs` and outbox folders.
  - **Why.** The folder holds a SYSTEM-scope DELETE on a table that holds personal data. A wrong predicate deletes live keys, and a retry then runs its `call` twice. A later edit there must need a security record.
  - **When it bites.** 040-B itself also changes owned paths (`pipeline.ts`, `eslint.config.mjs`), so its first PR gets a record anyway. The line matters for the edits after it.
- **P-2. `tools/ci/security-paths.mjs`: not required.** The hosted `security-integration` job runs the security suites, and none of them exercises the purge. The purge's own PostgreSQL 18 test is lane B. This stays with the open PR46-SEC-08 item for `apps/worker/src/platform/**`. It changes if the purge case is placed among the security suites.
- **P-3. Mechanical confinement, in 040-B.** The purge module's unit test pins three things:
  - over a recording client, the only statement is the D-ARCH-192 `DELETE … WHERE id IN (SELECT id … WHERE expires_at < pg_catalog.now() ORDER BY expires_at LIMIT 5000)`, with at most 200 batches;
  - the module's source text contains neither `response_body` nor `responseBody`;
  - it imports nothing from `apps/api` (the boundaries rule also refuses that, with a negative fixture).

  The owner-glob negative fixture of D-ARCH-192 stays.
- **P-4.** The purge logs counts only, never row content or the key. It runs only on the hourly schedule and has no other entry point.
- **P-5.** The purge deletes by `expires_at` only. An IN_PROGRESS row whose 24 h expired is deleted too, which is correct: its lease ended long before.

### 3.9 T-79 and R-05 (QG-040-C4, before G3; mine)

In the threat model I will:
- mark T-79 as mitigated by encryption with scope-bound AAD, using derived keys after PR040-SEC-01;
- record that payment client secrets are stored encrypted (PR040-SEC-03);
- record that the anonymous scope is the client network under a keyed HMAC, IPv4 /32 and IPv6 /64, with only `recordConsent` exposed;
- record the 25 h bound with the hourly purge;
- update R-05: the one-time-secret list (ADR-0014 amendment 1) holds, the contract test pins it (SEC-TC-53), and the client-secret operations are named;
- update AC-14 / SEC-TC-04: the anonymous half runs on `recordConsent`, because `createQuote` is `not-applicable`, and "no stored secrets" reads "no secret in clear".

## 4. Findings

| ID | Severity | CWE | OWASP 2021 | File:line (`3dc1e225`) | Owner | Due |
|---|---|---|---|---|---|---|
| PR040-SEC-01 | LOW | CWE-320 (key management; no closer base entry) | A02 | `apps/api/src/platform/idempotency/from-config.ts:40,51` | senior-developer; principal-architect (register row, §10.4) | before 040-B merges |
| PR040-SEC-02 | LOW | CWE-345 | A08 | `idempotency/store.ts:49-54,127-146,180-188,253-265`; `idempotency/body-cipher.ts:60-61`; `tx/execute.ts:206-214` | senior-developer | before 040-B merges |
| PR040-SEC-03 | LOW | CWE-922 (residual: encrypted) | A04 | `idempotency/store.ts:253-255` (every 2xx body is stored); `openapi.yaml` `checkoutOrder`, `confirmPayment`, `createPaymentMethodSetup` | principal-architect (decision, record); security-analyst (T-79); qa-lead (SEC-TC-04) | before 040-B merges |
| PR040-SEC-04 | LOW | CWE-667 | A04 | `tx/execute.ts:103-107,364-397,422-430` | senior-developer | before 040-B merges |
| PR040-SEC-05 | LOW | CWE-778 | A09 | `tx/execute.ts:364-378,401` | senior-developer; product-manager (D-PM-081 scope) | before 040-B merges |
| PR040-SEC-06 | INFO | CWE-359 (data minimisation) | A04 | `idempotency/store.ts:234`; the migration's `idem_key` | principal-architect (optional, a later contract step) | – |
| PR040-SEC-07 | INFO | – | A04 | `tests/contract/x-idempotency.test.ts` | senior-developer | with 040-B at the latest |
| PR040-SEC-08 | INFO | CWE-841 | A04 | `tx/execute.ts:401-418` (a 5xx releases); ADR-0014 | principal-architect; owners of TASK-113, TASK-132 and the gateway task | – |
| PR040-SEC-09 | INFO | CWE-755 | A04 | `tx/execute.ts:409-413`; `idempotency/problem.ts` `storedProblemOf` | senior-developer | with 040-B at the latest |

### PR040-SEC-01 (LOW): one secret serves as a cipher key and as a key-derivation key

- **Description.**
  - `bodyKeyOf` returns the deployed material as the AES-256-GCM key (`from-config.ts:40`).
  - `idempotencyStoreFrom` derives the network HMAC key from the same bytes (line 51).
  - P1 decrypts a sealed body with the configured bytes directly, and the `store.test.ts` case "a deployed key is its material" pins that direct use.
- **Exploitability and impact.**
  - No attack is known. Under standard assumptions the HKDF output is independent of the AES outputs.
  - It is a key-hygiene defect against the register rule. If either use is ever broken or leaked, the other goes with it, and the "one key, one purpose" argument no longer applies.
  - Low impact, low likelihood.
- **Remediation (code).**
  ```ts
  const BODY_INFO = 'platform-idempotency-body-v1';
  const derive = (material: Uint8Array, info: string): Uint8Array =>
    new Uint8Array(hkdfSync('sha256', material, new Uint8Array(0), info, 32));
  // bodyKeyOf: { keyId, key: derive(material /* or the local-only digest */, BODY_INFO) }
  // network key: derive(<current material>, NETWORK_KEY_INFO), from the material, not from the derived body key
  ```
- **Verification.**
  - A unit test: neither derived key equals the material, and the two keys differ.
  - Known-answer vectors for both labels.
  - The `store.test.ts` case is replaced.
  - P1's check "the AES key is the material" must fail after the fix.

### PR040-SEC-02 (LOW): the stored status and headers are not authenticated

- **Description.**
  - **What the AAD covers.** It binds only the body to the scope and the key id.
  - **What is trusted unauthenticated.**
    - `readStored` and `replayedHeadersOf` read `response_status` and `response_headers` from clear columns.
    - A row with no body (a 202, a 204) has no authenticated part at all.
    - `Content-Type` is stored, and it is the marker that makes a row a stored problem.
    - `send()` sets every stored header and then calls `res.json`, which keeps an existing `Content-Type`.
  - **What the probes showed.**
    - P3: a row changed to `200` with `Content-Type: text/html` and a foreign `Location` replays the authentic JSON body as `text/html`. The API process sends neither `nosniff` nor a CSP, and a declared `text/html` renders whatever `nosniff` says.
    - P4 at `3dc1e225`: a stored problem whose marker is flipped to `text/html` replays as an ordinary `text/html` result. A status flip on a problem row is refused, because the catalogue status must match.
- **Exploitability and impact.**
  - **Who can do it.** It needs a write to `idempotency_keys`. `platform_app` holds UPDATE on every column of this SYSTEM table, which has no RLS. Any SQL injection in the API process is enough, and so is a database operator.
  - **What a victim's replay can then get.**
    - a status flip on a 2xx row: a 201 shown as a 404 or 409 leads the client to submit again under a new key, which duplicates the order;
    - a `Location` of the attacker's choosing;
    - a JSON body with user-controlled strings, rendered as HTML on the API origin.
  - Likelihood low, impact medium: LOW.
- **Remediation (code).**
  - **Seal one envelope per completion,** always, with or without a body: `cipher.seal(scopeHash, JSON.stringify({ v: 1, status, headers: storedHeadersOf(result.headers), body }))`.
  - **On replay,** read status, headers and body from the opened envelope only. The clear `response_status` and `response_headers` become informational: they must equal the envelope, otherwise `IdempotencyReplayError('stored response mismatch')`. A later contract step can drop them.
  - **Tighten the CHECK** to `("status" = 'COMPLETED') = ("response_body" IS NOT NULL)`.
  - **Defence in depth:** allow only `application/json` and `application/problem+json` (with an optional `; charset=utf-8`) as the replayed `Content-Type`. Every idempotent 2xx in the contract is `application/json`.
  - **Optional:** a column-level UPDATE grant (`status`, `lease_until`, `response_*`, `updated_at`, `updated_by`, `version`).
  - No row exists yet, so the stored form can still change freely.
- **Verification.**
  - Unit tests: flipping the clear status, a header or the envelope gives 500, `api.idempotency_replay_unreadable` and no replay.
  - A body-less 202 row replays from its envelope.
  - A stored `Content-Type` outside the allow-list is refused.
  - Lane B: the CHECK case.

### PR040-SEC-03 (LOW): payment client secrets are stored, against "no stored secrets"

- **Description.**
  - **What is stored.** The 2xx bodies of `checkoutOrder` and `confirmPayment` (both `required`) and of `createPaymentMethodSetup` carry the gateway intent's `client_secret`. The store keeps every 2xx body.
  - **What the requirements say.**
    - T-79 and R-05: "never store one-time secrets".
    - AC-14: "no secrets stored".
    - SEC-TC-04: "DB scan shows no stored secrets".
    - The gateway's own guidance: a client secret should not be stored or logged.
  - **Why nothing marks it.** ADR-0014 amendment 1 makes only the one-time-secret routes `not-applicable`.
- **Exploitability and impact.**
  - **The protection today.** The secret is encrypted and bound to its scope, and gone within 25 h once the purge exists.
  - **What an attacker needs and gets.** Both the database and `IDEMPOTENCY_BODY_KEY`. With both, they can read the state of the last day's intents and confirm them with their own payment method, which costs the victim nothing.
  - Low likelihood, low to medium impact: LOW.
  - **Why the secret cannot simply be dropped.** The replay needs it: a retried checkout must return the same intent's secret.
- **Remediation (principal-architect decides).**
  - **Recommended: (a) accept and record.**
    - data-model §3.5 and §10.4, and ADR-0012: stored responses may contain gateway client secrets.
    - The ADR-0018 blast radius as in §3.1 item 6.
    - Threat model T-79 (mine) and SEC-TC-04 read "no secret in clear".
    - The SEC-TC-04 test scans every clear column of `idempotency_keys` for the client-secret shape.
  - **Rejected: (b)** a redacted body plus a fresh fetch of the secret at replay. It puts an external call on the replay path.
- **Verification.** The record lines above; PR040-SEC-07 (c).

### PR040-SEC-04 (LOW, = code review R2-n1, extended): the lease does not cover every stretch between two lease writes

- **Description.** `idempotencyLeaseMs` computes `max(30 s, max(D, 2·(W + T) + 1 s) + 5 s)`, with `T` = `timeout` (by default `DB_TX_STATEMENT_TIMEOUT_MS`) and `W` = `maxWait` = 2 s. Under the formula's own worst-case model, it misses two stretches:
  1. **The read-only path** after the last renewal runs three transactions: the handler transaction, the VIEW entry (`writeAlone`) and the completion (R2-n1).
  2. **The call path:**
     - the rest of the renewal transaction before `call` (its lease clock starts inside the callback);
     - then `call`, at most D = 20 s;
     - then the next renewal's admission.

  P2, longest stretch against the lease:

  | `DB_TX_STATEMENT_TIMEOUT_MS` | 5 s (default) | 6 s | 8 s | 9 s | 10 s | 12 s | 30 s | 120 s |
  |---|---|---|---|---|---|---|---|---|
  | lease | 30 s | 30 s | 30 s | 30 s | 30 s | 34 s | 70 s | 250 s |
  | longest stretch | 27 s (call path) | 28 s | 30 s | 33 s (read-only path) | 36 s | 42 s | 96 s | 366 s |
  | headroom | 3 s | 2 s | 0 | −3 s | −6 s | −8 s | −26 s | −116 s |

  At the defaults, the 5 s skew margin that D-TASK040-06 claims is in fact 3 s.
- **Exploitability and impact.**
  - **What it needs.**
    - either a raised `DB_TX_*` budget (the config allows up to 120 s), or a database slow enough to approach the bounds;
    - and a client retry inside the window.
  - **What then happens.**
    - The retry takes the key over and runs `load` and `call` again.
    - The first `call` has already run, and its handler transaction rolls back on `IdempotencyClaimLostError`.
    - The result: a duplicated external effect (a carrier booking, a gateway call), with one copy orphaned.
  - Likelihood low, impact medium: LOW.
- **Remediation (code).**
  ```ts
  const oneTransaction = admissionWait + transaction.maxWait + transaction.timeout; // admission <= 250 ms by default
  const longest = Math.max(callDeadlineMs + oneTransaction, 3 * oneTransaction + FAILED_ENTRY_WAIT_MS);
  return Math.max(IDEMPOTENCY_LEASE_MS, longest + LEASE_SKEW_MARGIN_MS);
  ```
  Or renew before the VIEW entry as well, and size the call path as above.
- **Verification.**
  - A table test in `idempotency-lease.test.ts` over `T` in {5, 8, 9, 12, 120} s asserts `lease − stretch ≥ LEASE_SKEW_MARGIN_MS` for the call, failure and read-only paths.
  - P2 is re-run.

### PR040-SEC-05 (LOW, = R2-n2): a claim lost after `call` leaves no audit entry and no distinct signal

- **Description.**
  - When the renewal before the handler transaction finds the claim taken over, `renew` answers 409 `IDEMPOTENCY_IN_PROGRESS`.
  - `run` then skips `recordFailure` (`error !== lostClaim`, line 401) and logs `api.idempotency_conflict` at info, the same line a client's duplicate produces.
  - The test `[m4] a key taken over during call …` pins `runs = ['load', 'call']` with no FAILED entry.
  - D-PM-081's rule ("a request refused by the key protocol is not an attempt") does not hold here: the action was attempted and its external effect ran.
- **Exploitability and impact.**
  - This is the one event that tells operations a `call` may have run twice (PR040-SEC-04) and that an effect is orphaned. Today it is invisible in the trail and in the logs.
  - A client cannot trigger it at will.
  - Impact: a repudiation and reconciliation gap. LOW.
- **Remediation (code).**
  - Have `renew` record the phase.
  - When the claim is lost **after `call` ran:**
    - call `recordFailure(audit, request, lostClaim, tenant, lifetime)`, so the route's FAILED entry is written with `code: IDEMPOTENCY_IN_PROGRESS`;
    - log `store.log.warn('api.idempotency_claim_lost', { phase: 'before-handler', correlation_id })`.
  - A loss at the renewal before `call` (only `load` ran) keeps today's answer.
  - Product-manager confirms that D-PM-081 does not cover the case after `call`.
- **Verification.**
  - The `[m4]` test expects one FAILED entry and one WARN line, with neither the key nor a body.
  - A loss before `call` writes no entry.

### PR040-SEC-06 (INFO): `idem_key` is stored in clear, and nothing reads it

`begin` writes the key the client chose, and no statement reads it back: `EXISTING` does not select it. The key is already inside `scope_hash`. A client may put its own data in a key, such as an order reference or an e-mail address. The column is classified INT and kept for at most 25 h.

Optional data minimisation, as a later expand/contract step: store SHA-256 of the key, or drop the column. This part does not need it.

### PR040-SEC-07 (INFO): pin the three sets that the acceptances rest on

Add three tests to `tests/contract/x-idempotency.test.ts`, each with a planted negative:
- **(a)** the public (`security: []`) idempotent operations are exactly `{recordConsent}` (§3.1 items 3 and 5);
- **(b)** the idempotent operations whose `x-audit.action` is VIEW or DOWNLOAD are exactly `{emailShipmentDocuments}` (§3.6);
- **(c)** the idempotent operations whose 2xx schema contains `client_secret` are exactly `{checkoutOrder, confirmPayment, createPaymentMethodSetup}` (PR040-SEC-03).

Changing any of these sets then needs a security decision.

### PR040-SEC-08 (INFO): "a 5xx releases the key" means `call` must be idempotent at the provider

- **How a second `call` happens.** In both cases below, the slot answers with a 5xx and releases the key; the retry, after `Retry-After: 1`, runs `call` again, and both runs can be in flight at once.
  - A `call` that outlives the enforced deadline goes on running after the slot answers 503.
  - A `call` whose provider acted before a 5xx.
- **Why it is not a defect of this part.** It is the ADR-0014 rule ("5xx delete the row"). The idempotency store cannot de-duplicate external effects across a 5xx; only a provider idempotency key derived from the business id (the order, shipment or pickup) can.
- **A rarer case.** On a read-only route, a completion that fails after the VIEW entry releases the key after the 202. A client retry then sends the e-mail again.
- **Owed.**
  - principal-architect confirms that ADR-0011, ADR-0012 and the carrier contract (TASK-075) require a provider idempotency key on every booking, pickup and payment call.
  - The owners of TASK-113, TASK-132 and the gateway task test it.

### PR040-SEC-09 (INFO): a thrown 4xx whose document cannot be serialised leaves the claim held

- **What happens.**
  - In the failure path, `storedProblemOf(error, context)` runs before `settleClaim` (`execute.ts:409-413`).
  - `AppError` does not validate its `errors[]` items. An item that cannot be serialised (a `BigInt`, a cycle) makes `JSON.stringify` throw a `TypeError` (P4).
  - The claim is then neither completed nor released.
- **Effect.**
  - The client gets the generic 500, and retries answer 409 until the lease ends (≥ 30 s), after which a retry takes the key over.
  - Before fix cycle 2, the problem handler's own `try/catch` answered 500, and the release still ran.
- **Trigger and impact.** Only a code defect triggers it. Availability of one key for one lease.
- **Fix.** `let stored; try { stored = storedProblemOf(error, context); } catch { stored = undefined; }`, then `settleClaim(…, stored?.result)`. The key is released and the original error is rethrown.
- **Test.** A thrown 400 with an `errors` item that cannot be serialised leaves no row.

## 5. Code review cross-reference

- **Round 1.**
  - M1 is closed: the code reads correctly, and the two `[M1]` tests assert the order of events.
  - M2 is closed. The release defect was fixed at `d0a82a24`, and the D-ARCH-195 form at `3dc1e225` (§3.3).
  - m3 is closed by D-PM-081 (§3.4).
- **Round 2.**
  - R2-n1 is PR040-SEC-04, which adds the call-path stretch.
  - R2-n2 is PR040-SEC-05. To the question "security-analyst to confirm": D-PM-081 should not cover this case.
  - R2-n3 (five transactions) is accepted. Each transaction is admitted under the tenant bulkhead, so it adds nothing beyond the class limit.
  - D-TASK040-04 is ruled in §3.1.
- **Round 3** (`3dc1e225`): items (a) to (d) cover the rendering parity, which P4 confirms from the security side (F2-2).

## 6. Conditions

**Before part 040-A merges.**
- Lane B passes on PostgreSQL 18 on the final head: `store.int.test.ts`, `idempotency-keys.int.test.ts` and the C15 literal.
- The hosted `security-integration` job is green at the pushed head.
- The record is renamed and the merge-ref check is done (D-ORCH-136/138).
- A further round is needed only if an owned path changes after `3dc1e225`. A main merge that only joins documents needs a merge-only round.

**Before part 040-B merges** (its security round checks all of these):
- PR040-SEC-01, -02, -04 and -05 are fixed, or each is answered with a reason.
- -03 is decided.
- -07 and -09 are done.
- Conditions P-1 to P-5 hold (§3.8).
- The purge ships with or before the wiring (§3.5).
- The Pino-backed `IdempotencyLog` keeps class-only fields.
- §3.1 item 6 is applied.

**TASK-187:** T187-1 to T187-6 (§3.2).

**Before G3:** the T-79 and R-05 text (§3.9).

## 7. Routing

| To | Item |
|---|---|
| senior-developer | **Part 040-B:** PR040-SEC-01, -02, -04, -05 (code), -07, -09; P-3, P-4.<br>**Card lines:** T187-1 to T187-6 on TASK-187 |
| principal-architect | - §3.1 item 4 (rotation note) and item 6 (register row, data-model §10.4);<br>- the PR040-SEC-03 decision and its record;<br>- PR040-SEC-06 (optional);<br>- PR040-SEC-08 confirmation;<br>- the `ReauthProofConditional` wording (T187-4, with QG-040-C3 (a)) |
| product-manager | PR040-SEC-05: D-PM-081 does not extend to a claim lost after `call` (the objection D-PM-081 routes back) |
| devops-engineer | P-1: the CODEOWNERS line for `/apps/worker/src/platform/idempotency/`, added to PR64-SEC-09 |
| qa-lead | SEC-TC-04: the anonymous half on `recordConsent`; "no secret in clear" (PR040-SEC-03) |
| quality-gatekeeper | QG-040-C4: the first and third bullets are answered here (§3.1, §3.2, §3.6); the second bullet is answered in §3.8; the fourth (T-79, R-05) is owed by me before G3 (§3.9) |
| security-analyst (self) | §3.9 before G3; the 040-B round; the TASK-187 conditions in that task's record |
| orchestrator | Rename this record once the PR exists |

| Verdict | **PASS_WITH_FOLLOW-UPS.** Round 1, bound to `3dc1e225` (which includes `d0a82a24`, the pure-union merge `40fce4b2` and fix cycle 2).<br>**Findings:** 0 Critical, 0 High, 0 Medium. New: PR040-SEC-01 to -05 LOW, all due before part 040-B merges; PR040-SEC-06 to -09 INFO.<br>**Rulings:**<br>- D-TASK040-04 stands with the PR040-SEC-01 derivation change, and its rotation effect is accepted.<br>- D-ARCH-193 is confirmed with T187-1 to T187-6.<br>- The D-ARCH-195 form is accepted (F2-2 to F2-4 met; F2-1 waits for -02).<br>- D-PM-081: concurrence, except for a claim lost after `call`.<br>- D-ARCH-192: concurrence with P-1 to P-5 (CODEOWNERS yes, `security-paths.mjs` no).<br>- A SENSITIVE VIEW/DOWNLOAD replay needs no entry of its own.<br>- The retention gap before 040-B carries no exposure.<br>**Owed before merge:** lane B PASS on the final head, the hosted `security-integration` job, the rename and the merge-ref check |

---

# Round 2: delta for fix cycle 3, head `e96bd979` (2026-11-20)

| Field | Value |
|---|---|
| Head | e96bd97984b5749d3c755f6306da1dbc114ba0b8 |
| What was reviewed | **`3dc1e225..e96bd979`.**<br>- **Three merges of main, each a pure union:** `5bea60ad`, `2ae719aa` and `a8b69fed`. For each, the merge commit's tree equals `git merge-tree --write-tree` of its two parents. Since `af4a1b48`, main has changed no path outside `docs/` and `.claude/`.<br>- **Code delta, 13 files:**<br>&nbsp;&nbsp;- `idempotency/{store,problem}.ts` and `tx/execute.ts`;<br>&nbsp;&nbsp;- the new `idempotency/enum-checks.test.ts`;<br>&nbsp;&nbsp;- the tests `store`, `problem`, `request`, `scope`, `store.int`, `idempotency.api`;<br>&nbsp;&nbsp;- `prisma/tests/catalog/c01-c12.int.test.ts` and `prisma/tests/idempotency/idempotency-keys.int.test.ts`;<br>&nbsp;&nbsp;- `apps/worker/src/platform/queues/open-queue.test.ts`.<br>- **Commits:** `db92e7f1`, `427373a7` and `20758572` (fix cycle 3: C9 lists, randomised test keys, the R3-M1 origin envelope), and `e96bd979` (D-PM-084).<br>- **The PR head will be `93f0f126`.** It is `e96bd979` plus a merge of main that touches only `docs/`, so no owned path changes after this head row |
| Merge base with main | `afb2b73c`. Main tip when this round was written: `1012fa6f`. `git merge-tree --write-tree 1012fa6f e96bd979` is clean |
| Owned paths changed | 39 (main's checker, `--base afb2b73c --head e96bd979`). The classifier gives `security_paths=true` (36 paths) |
| Method | - Static review of the delta.<br>- **P5:** a new single-process probe of the R3-M1 envelope, run on a `git archive a8b69fed` extract. It uses the real store over the branch's in-memory delegate.<br>- **P1 and P2** re-run on the same extract: 29/29, and the same lease table. `e96bd979` changes only `execute.ts` and one test.<br>- **Gitleaks.** An emulation of the pinned v8.30.1 rules over the branch range, plus `git grep` of the final tree for the literal.<br>- Nothing ran in either worktree. No npm, Jest or Docker |

## R2.1 What changed and what I verified

| Item | Result |
|---|---|
| **R3-M1: an origin envelope `{origin, body}`** (`store.ts` `complete` and `readStored`; D-TASK040-14) | **P5, 6 of 6.**<br>- **Inside the GCM plaintext:** the origin (`handler` or `slot-problem`), so the tag authenticates it. Only a sealed `slot-problem` row replays through `RenderedProblemError`.<br>- **Slot-problem rows:**<br>&nbsp;&nbsp;- a clear `Content-Type` changed to `text/html` is ignored: the row still replays as a problem;<br>&nbsp;&nbsp;- a status flip is refused (`IdempotencyReplayError`);<br>&nbsp;&nbsp;- a sealed body without the envelope (the old form) is refused.<br>**This closes the "marker flipped to `text/html`" path of PR040-SEC-02.**<br>**What stays open of PR040-SEC-02:**<br>- On a `handler` row, a database writer can still change the status, `Location` and `Content-Type` of the replay. P5: a tampered 201 replays as 409 `text/html` with a foreign `Location`.<br>- Nulling the body and its key id (allowed by the CHECK) turns any row, a slot-problem row included, into a body-less `handler` replay of a chosen status and headers.<br>So PR040-SEC-02 is **narrowed and stays open**. The D-ARCH-204 envelope `{v, status, headers, body}`, the CHECK `(status = 'COMPLETED') = (response_body IS NOT NULL)` and the `Content-Type` allow-list close it in part 040-B |
| **PR040-SEC-05: a claim lost after `call`** (`execute.ts` `renew(phase, callRan)`; D-PM-084, D-TASK040-17) | **Closed.**<br>- Whenever a renewal finds the claim taken over, the request logs WARN `api.idempotency_claim_lost {phase, correlation_id}`.<br>- `before-handler` with `call` run: the FAILED entry is written. `failedOutcomeApplies` holds for a 409 of an authenticated mutating route, and `skipsFailedEntry` concerns only DbError reasons.<br>- `before-call`: no entry (D-PM-081).<br>- The two new API tests assert one `failed-entry 409` and one WARN line for the first case, none and one WARN line for the second, and no key in any log line.<br>- A public route gets no FAILED entry, because REQ-AUDIT-010 covers authorised requests. `recordConsent` has no `call` anyway |
| **C9 enum lists** (D-TASK040-15) | - `ck_idempotency_keys__method` and `__status` are added to `ENUM_CHECKS` from the data model.<br>- `enum-checks.test.ts` compares `IDEMPOTENT_METHODS` and the new `IDEMPOTENCY_KEY_STATUSES` with the migration text.<br>- The store now writes `status` only through those constants.<br>No security effect beyond keeping the CHECK and the code in step |
| **Test keys** (D-TASK040-16) | - The four test files now use `randomUUID()`.<br>- `git grep` of `e96bd979` finds the literal only in main's EPIC-16 Gherkin line (`Idempotency-Key "…"`). That line cannot match `generic-api-key`, because the rule needs an assignment operator between the key word and the value.<br>- No key-shaped literal is assigned to a key-named identifier in the branch's final tree.<br>- The three old commits remain (§R2.3) |
| **`open-queue.test.ts`** (unowned) | A test-only clean-up of the PR64-SEC-01 test: it force-disconnects the queues that a metrics scrape opened. The spy wrapper calls the original method, and no assertion changed. No security effect |
| **Unchanged** | PR040-SEC-01 (P1 still decrypts with the configured bytes), -04 (P2 table unchanged) and -09 (`storedProblemOf` still runs before `settleClaim`). D-ARCH-200 and D-ARCH-204 place all three in part 040-B |

## R2.2 Status of the round-1 findings at `e96bd979`

| ID | Status |
|---|---|
| PR040-SEC-01 (LOW) | **Open; due in part 040-B, first pull request** (D-ARCH-204: the configured key only derives) |
| PR040-SEC-02 (LOW) | **Narrowed, open** (R2.1). Due in part 040-B, first pull request, as the D-ARCH-204 envelope |
| PR040-SEC-03 (LOW) | **Closed by ruling.** D-ARCH-204 accepts and records it. The SEC-TC-04 text says "no secret in clear" (`b9c0ddeb`). The contract pin is PR040-SEC-07 (c) |
| PR040-SEC-04 (LOW) | **Open; due in part 040-B** (D-ARCH-200: the lease counts the renewal after `call` and three transactions) |
| PR040-SEC-05 (LOW) | **Closed** at `e96bd979` (D-PM-084) |
| PR040-SEC-06 (INFO) | **Closed by ruling.** D-ARCH-204: `idem_key` stays in clear until the contract step that drops the clear response columns, and api/README §5 tells clients to keep personal data out of a key |
| PR040-SEC-07, -09 (INFO) | Open; part 040-B, first pull request (D-ARCH-204) |
| PR040-SEC-08 (INFO) | **Closed by ruling.** D-ARCH-202 item 6: every effect of a `call` carries a derived key, and bookings, pickups, captures, voids and refunds are saga steps with their keys |

**New findings in this delta: none.**

## R2.3 Ruling: the synthetic UUID literal in three unpushed commits (gitleaks-full, PR33-SEC-08)

**Facts.**
- **The hits.** `a633eb84`, `9f08ecb5` and `5e0dc1b0` add a synthetic UUID assigned to key-named identifiers: in `scope.test.ts`, `idempotency.api.test.ts` and `idempotency-keys.int.test.ts`; maybe also `request.test.ts`. `generic-api-key` reports them in the full-history scan of the head. They are not credentials, and nothing needs rotating. The final tree no longer has them (D-TASK040-16).
- **The branch has never been pushed:** `git ls-remote` shows no `feat/TASK-040*` ref.
- **Every PR lands on main as a squash.** All 65 `(#NN)` commits on main's first-parent line have one parent. So these commits never enter main's ancestry.
- **Lane A cannot read the baseline.** Its gitleaks step scans `RANGE_BASE..RANGE_HEAD` with only the base ref's `.gitleaks.toml` (`ci.yml`, "Gitleaks (PR commit range)"). On the first `pull_request` event it would report the same lines.

**Ruling.**

1. **No change to `tools/quality/gitleaks-baseline.txt`, `BASELINE_COUNT` or the sec-static pin.** Nothing is committed for this.
   - **Lane A.** The baseline does not reach lane A, so the PR would still be red at its first push.
   - **Scope.** The baseline is for main's own history (D-SEC-PR25-01).
   - **Dead entries.** Fingerprints of commits that a squash keeps off main would stay in an exact, count-pinned list for good.
2. **Preferred: a supersede branch with clean history (PR #18 and #19 precedent).** Before the first push, the developer publishes TASK-040 from a new branch whose only commit carries the final tree:
   ```
   git switch -c feat/TASK-040-idempotency-keys-v2 origin/main   # in a free worktree, not ../Shipqube-TASK-040
   git merge --squash <final head>                                # the head that already merged the same main tip
   git commit -F <message: the feature subject plus the D-TASK040 decision texts, without quoting the literal>
   git diff --quiet <final head> HEAD                             # must be empty: identical tree
   ```
   - **Not a history rewrite.** No existing ref moves and nothing is force-pushed. The old branch stays as it is, unpushed, as the archive of the reviewed SHAs. A squash is what main's merge does anyway.
   - **What it then costs:**
     - lane B runs once on the new head, which then has 0 new gitleaks-full findings;
     - the code review and this record each append a short supersede round with the new Head row. Main's checker requires the head row to name a commit of the PR. With an identical tree, that round is a tree-equality proof and nothing more.
3. **Accepted alternative, if the orchestrator judges a lane B re-run dearer: one exact entry per finding in `.gitleaks.toml`, under D-SEC-PR45-01 conditions 1 to 7.**
   - **The entries.** One `[[allowlists]]` table each, with all of: `condition = "AND"`, `regexTarget = "line"`, the full 40-hex commit, `targetRules = ["generic-api-key"]`, an anchored path, and `^\n?<exact line>$` with the value class pinned to the one UUID. Plus a fingerprint comment and the sec-static pin change.
   - **How they land.** In their own PR to main, with a record and a real-image before/after (a Docker slot from the coordinator).
   - **Why D-SEC-PR45-01 still applies.** It reserves this class for commits already pushed. I extend it to commits that review records and evidence have already bound. The rationale is the same: the history cannot be replaced without redoing that work.
   - **What they cover.** These entries serve lanes A, B and C at once, because `gitleaks-full.mjs` reads the same `.gitleaks.toml`.
   - **When to remove them.** Only once the branch is closed and the commits are not ancestors of main.
4. **The orchestrator chooses option 2 or 3.**
   - Under option 2, the lane B run queued on `93f0f126` cannot be the PR's gitleaks evidence, because its ancestry holds the commits.
   - Under option 3, the config PR must be on main before the PR's lane A and before lane B's gitleaks-full step reads its base ref.
   - **Exact fingerprints.** For option 3 they must come from the lane B report (rule, commit, path, line; never the value). My emulation over-reports and is not a source of fingerprints.

| Verdict | **PASS_WITH_FOLLOW-UPS.** Round 2 (delta, fix cycle 3) at `e96bd979`.<br>**Findings:** 0 Critical, 0 High, 0 Medium; no new findings.<br>**Closed:**<br>- PR040-SEC-05 (code);<br>- PR040-SEC-03, -06 and -08 (by ruling, D-ARCH-204 and D-ARCH-202).<br>**Narrowed and open:** PR040-SEC-02 (R3-M1 envelope).<br>**Open, due in part 040-B:** PR040-SEC-01, -02, -04, -07, -09.<br>**Gitleaks ruling (R2.3):**<br>- no baseline change;<br>- preferred: a supersede branch with clean history, which needs a short supersede round on its head;<br>- accepted alternative: D-SEC-PR45-01 commit-bound entries in their own PR.<br>**Owed before merge:**<br>- the gitleaks choice carried out;<br>- lane B PASS on the PR head;<br>- the hosted `security-integration` job;<br>- the rename and the merge-ref check |

---

# Round 3: supersede round, head `2abd665f` on branch `feat/TASK-040-idempotency-keys-v2` (2026-11-20)

This round carries out the preferred option of the R2.3 ruling (D-SECPR040-02 item (2)). The orchestrator built `feat/TASK-040-idempotency-keys-v2` from main and squashed the reviewed head `e96bd979` onto it as one commit, `2abd665f`. Its parent is `f65d7955`. The old branch `feat/TASK-040-idempotency-keys` keeps its commits, unpushed, as the archive of the reviewed SHAs. No ref was moved and nothing was force-pushed.

| Field | Value |
|---|---|
| Head | 2abd665f3f955986c20915f9c6374f118c02cdbb |
| Merge base with main | `f65d7955`, the commit's only parent. Main tip when this round was written: `c83e059e`. The two commits after `f65d7955` are documents only. `git merge-tree --write-tree c83e059e 2abd665f` is clean |
| Owned paths changed | 39 (main's checker, `--base f65d7955 --head 2abd665f`), the same set as round 2. The classifier gives `security_paths=true` (36 paths). One commit is in the PR range |
| Method | Plumbing comparisons from the main checkout, and a rebuilt gitleaks emulation (details in R3.2). Nothing ran in a worktree. No npm, Jest or Docker |

## R3.1 Tree equality: the code reviewed in round 2 is the code of this head

| Check | Result |
|---|---|
| `tree(2abd665f)` against `git merge-tree --write-tree e96bd979 f65d7955` | **Equal**: `a6b0bf97` for both |
| Code paths that differ between `e96bd979` and `2abd665f` (everything outside `docs/` and `.claude/`) | **0** |
| Code paths that differ between `93f0f126` (the old PR head) and `2abd665f` | **0** |
| The PR's net code diff | **Identical**, ignoring `index` lines: `git diff afb2b73c e96bd979` (the old branch against its merge base) equals `git diff f65d7955 2abd665f`. Between `afb2b73c` and `f65d7955`, main changed no code path |
| Documents in the squash commit | None. `2abd665f` touches no path under `docs/` or `.claude/` |

So every result of rounds 1 and 2 stands for `2abd665f` unchanged:
- **Closed:** PR040-SEC-05 (code); PR040-SEC-03, -06 and -08 (by ruling).
- **Narrowed and open:** PR040-SEC-02.
- **Open, due in the first pull request of part 040-B:** PR040-SEC-01, -02, -04, -07 and -09.
- **Conditions:** the D-ARCH-192 conditions P-1 to P-5 and the TASK-187 conditions T187-1 to T187-6.

The commit message gives the feature subject and a summary of the decisions. It does not contain the literal (`git log -1 --format=%B` checked).

## R3.2 Gitleaks: the PR range holds no finding

**The emulator.** I rebuilt the emulation, because the scratch area was wiped when the disk filled. It now follows gitleaks v8.30.1 git mode more closely than the round-2 emulator, which over-reported:
- **Scan unit:** each hunk's added lines form one fragment, so a match can span lines.
- **Per rule:** keyword prefilter, regex, secret group, entropy (`<=` skips), and the digit check of the `generic-*` rules.
- **Allowlists:** with their `regexTarget` (`secret`, `match`, `line`), `condition`, paths, commits and stopwords.
- **Configuration:** the pinned default ruleset, plus the repository's own `.gitleaks.toml` read from main, as lane A reads it from the base ref.

**Controls.**
- The old test literal on a key-named constant fires, and so does a generic key.
- A `keyId: 'idempotency-body-v1'` line does not fire, because of the `match`-target allowlist (`key[_.-]?id`). The round-2 emulator flagged lines of that kind.
- **Differential against the real image.** Over the old branch range `4e1163aa..e96bd979`, the emulation reports **exactly the three findings that lane B reported:**
  - `a633eb84` `scope.test.ts:24`;
  - `9f08ecb5` `idempotency.api.test.ts:33`;
  - `5e0dc1b0` `prisma/tests/idempotency/idempotency-keys.int.test.ts:58`.

  No others, and no `request.test.ts`.

**Results.**

| Range | Added lines | Findings |
|---|---|---|
| `4e1163aa..e96bd979` (old branch, control) | 72,987 | 3, the lane B set above |
| `f65d7955..2abd665f` (lane A's PR range: event base = merge base) | 3,720 | **0** |
| `origin/main..2abd665f` | 3,720 | **0** |

**What this means for each lane.**
- **Lane A** scans only `f65d7955..2abd665f`, so the PR is clean there.
- **Lane B and lane C** (gitleaks-full) scan the head's ancestry, which is main's history plus this one commit. Main's history is covered by the 17-entry baseline, unchanged, and the commit adds nothing.
- The baseline and `.gitleaks.toml` stay as they are.

**This is an emulation.** The real-image result comes from lane B on this head, once Docker Desktop is back. If lane B's gitleaks-full reports anything on `2abd665f`, send me its fingerprints (rule, commit, path, line), never the value.

## R3.3 What is owed now

- **Lane B PASS on `2abd665f`.** None of the earlier lane B runs (`95945b7e`, `93f0f126`) count for this head.
- **The hosted `security-integration` job** on the first `pull_request` event of the v2 branch.
- **The rename of this record** to `PR-<NNNN>-TASK-040-security-review.md` once the v2 PR exists, then the merge-ref check.

Main's checker accepts this record for the v2 PR through the Head row above. That is the only Head row whose commit lies in the v2 range: the earlier rows (`3dc1e225`, `e96bd979`) name commits outside it, and the checker skips those rows. A simulation on a shared clone gives `pass` for `--base f65d7955 --head 2abd665f`. Without this round the result is `missing` ("its head row names no commit of this PR").

**A later change.** If an owned path changes after `2abd665f`, a new round is needed. A merge of main that brings only documents needs a merge-only round.

| Verdict | **PASS_WITH_FOLLOW-UPS.** Round 3 (supersede) at `2abd665f` on `feat/TASK-040-idempotency-keys-v2`.<br>- **Tree equality:** `2abd665f`'s tree is the merge of the reviewed `e96bd979` with main (`a6b0bf97`), and the net code diff is identical, so rounds 1 and 2 hold unchanged.<br>- **Findings:** 0 Critical, 0 High, 0 Medium; no new findings. Open findings are due in part 040-B, as in round 2.<br>- **Gitleaks:** the emulation finds 0 in the PR range `f65d7955..2abd665f`; on the old range it reproduces exactly lane B's three findings. No baseline or configuration change.<br>- **Owed:** lane B PASS on `2abd665f`; the hosted `security-integration` job; the rename and the merge-ref check |
