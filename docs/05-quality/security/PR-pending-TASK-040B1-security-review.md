# PR-pending: TASK-040 part 040-B, first pull request (lease rule, derived keys, sealed envelope, PR040-SEC-09, contract pins), security review

**File name.** The pull request does not exist yet (it opens after PR #80, D-ORCH-150). Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-040B1-security-review.md`. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>` (D-ORCH-136, D-ORCH-138).

**Finding IDs.** The series of TASK-040 continues: `PR040-SEC-01` to `-09` are in `PR-0080-TASK-040-security-review.md` (part 040-A); this round adds `PR040-SEC-10` to `-13`. They are not the `PR40-SEC-nn` findings of PR #40.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-040-part-b-idempotency-production`, stacked on PR #80's head `0f0d92a0` (D-ORCH-150), upstream unset, not pushed. Commits `1b49bbf5` (feat: lease, HKDF keys, envelope, migration, PR040-SEC-09) and `a4aadd2e` (test: PR040-SEC-07 pins). Developer decisions D-TASK040-18 to D-TASK040-22 in the body of `1b49bbf5` |
| Head | a4aadd2ec715b97549f4b2b83b6c9be2e5e3fa8e |
| What was reviewed | The delta `0f0d92a0..a4aadd2e` in full: 15 files, 807+/92-. 14 of them are security-owned, as main's checker counts them (`--base 0f0d92a0 --head a4aadd2e`): 8 under `apps/api/src/platform/idempotency/`, `tx/execute.ts`, `tx/idempotency-lease.test.ts`, the migration `20261121000000_idempotency_keys_completed_body` (`migration.sql`, `down.sql`), `prisma/schema/platform.prisma`, `prisma/tests/idempotency/idempotency-keys.int.test.ts`. `tests/contract/x-idempotency.test.ts` is not owned; I read it as a control |
| Base and main | During this round PR #80 was squash-merged onto `origin/main` as `763800f3` (its 52 paths carry exactly the blobs of `0f0d92a0`), then #81 (TASK-080, `339b29d6`), #82 (TASK-041 part 041-A, `61c53b5e`), #83 (TASK-051, `a93a6113`) and #84 (npm group, `3c4d9a6d`) landed (D-ORCH-162). `origin/main` tip when this round was written: `4ba683ad`. §6 simulates the stacked merge against `763800f3`, `61c53b5e` and `4ba683ad` |
| Lane B | `20261121T0754Z_a4aadd2` PASS on PostgreSQL 18 (D-ORCH-156), diagnostic only: unit 8,355, integration 432 (the envelope and CHECK cases, gitleaks-full), api 212, catalog 113, migrations 30 (up/down/up of the new migration), rls 157 |
| Lane A | None (not pushed). Main's classifier, `security-paths.mjs --base 0f0d92a0 --head a4aadd2e`, gives `security_paths=true` (14 paths), so the hosted `security-integration` job runs on the PR |
| Binding items read | Brief `docs/04-plan/briefs/TASK-040B1.md` (card verbatim, PART 040-B SECURITY CONDITIONS); ADR-0014 amendments 10, 15, 16, 17; ADR-0018 amendment 9; D-ARCH-200, D-ARCH-204, D-ARCH-206; D-SECPR040-01 to -04; D-ORCH-150, -152, -156, -158; the code review round 1 `docs/05-quality/reviews/PR-pending-TASK-040B1-code-review.md` (`43c010d1`, APPROVED_WITH_NITS, R1-m1, R1-m2, R1-n1 to -n5) |
| Reviewer / date | security-analyst, 2026-11-21, round 1, pre-push.<br>**Host rule:** no Docker; every command in the foreground; nothing run in `../Shipqube-TASK-040B` (its state was read from the main checkout's object store only).<br>**Method:** single-process Node 24.22.3 probes on `git archive` extracts of `a4aadd2e` and, as the positive control, `0f0d92a0`, with a load hook that strips types and maps `@platform/*` to each extract; PGlite (PostgreSQL 17.5) for the migration text; a shared sparse clone with plumbing commits for the binding simulation. I ran no Jest: the targeted suites, 8 mutants and the API probes are the code review's (§1 of its record), the PostgreSQL 18 cases are lane B's. `.env*` was not opened |

## 1. Summary

The first pull request of part 040-B builds every security item the card gives it, and the probes confirm each one against the part-040-A head as the positive control.

- **PR040-SEC-01 closed.** The configured material only derives: HKDF-SHA256 with the amendment 15 labels, equal to WebCrypto HKDF on 500 random inputs and to the pinned vectors. The raw material no longer opens a stored body; at `0f0d92a0` it does.
- **PR040-SEC-02 closed.** One sealed envelope `{v, origin, status, headers, body?}`; 14 tamper shapes that replay at `0f0d92a0` (status, Location, Content-Type, added, removed or renamed headers, a body-less row, a nulled ciphertext, a part-A envelope, a sealed `text/html`) are all refused at the head, so are 6 non-JSON `Content-Type` values that `0f0d92a0` stores, and the six controls classify alike on both heads. The new CHECK refuses the nulled-ciphertext form in the database (PGlite on the exact migration bytes; lane B on PostgreSQL 18).
- **PR040-SEC-04 closed as ruled.** The code is amendment 10 exactly. The rule itself has a gap, which the code review found (R1-m1): I rate it **PR040-SEC-10, LOW**, and give the ruling input in §4.
- **PR040-SEC-07 and -09 closed;** PR040-SEC-03's test (SEC-TC-04) holds.
- **New:** PR040-SEC-10 LOW (the lease gap), PR040-SEC-11 INFO (a non-JSON 2xx on a read-only route silently loses idempotency), PR040-SEC-12 INFO (pin (a) keys on "public", not on "network-scoped"), PR040-SEC-13 INFO (the key register in `packages/config` still calls the material an AES key).
- **Binding:** this round binds to `a4aadd2e`, but the head cannot merge as it is: R1-m2 renames an owned migration directory (TASK-080's migration with the same timestamp is now on main), so a delta round is owed on the fix head, and then a merge-only round after `origin/main` is merged in. §6 gives the checks.
- **The D-ORCH-158 merge rule needs a refinement** (§6): main changed 2 of #80's conflicting paths after the squash (#81, #82), so "every conflicted file to the stacked blob" would now drop #81's grant block for `pricing_config_versions` from `grants.manifest`. The explicit-base merge (`--merge-base=0f0d92a0`) is clean and right, and the raw-diff equality catches the wrong form.

## 2. What I verified

| # | Probe (session scratch `t040b1sec/probes/`) | Result |
|---|---|---|
| P1 | `p1-contract.mjs`: the dereferenced contract at `a4aadd2e` (133 operations) | 47 idempotent operations. 46 declare `bearerAuth` at operation level, one declares `security: []` (`recordConsent`). One is audited DOWNLOAD (`emailShipmentDocuments`, `optional`, 202). Their 2xx media types: 38 `application/json` (200: 20, 201: 14, 202: 4) and 9 body-less 204 |
| P2 | `p2-lease.mjs`: the real `idempotencyLeaseMs` of the head against the stretches measured from the statement that wrote `lease_until` (application clock) to the statement that next protects the row | Call path: margin 5 s or more everywhere (the remainder of the writer plus the next admission is exactly one T). Failure path: 7.25 s or more. **Read-only path: negative from a statement timeout of 7 s** (§4, PR040-SEC-10). Control: the part-040-A formula at `0f0d92a0` gives 30 s at 5 s and at 9 s, as recorded in PR040-SEC-04 |
| P3 | `p3-envelope.mjs`: tamper matrix over the real store, cipher and `MemoryKeys` of each extract; rows changed only in the clear columns, the ciphertext or the key id; plus 10 `Content-Type` values at completion | Head: every tamper refused with a fixed reason (`stored response mismatch`, `stored response missing`, `stored envelope malformed`, `stored content type refused`, `authentication failed`). Base `0f0d92a0` (positive control): all 14 tamper shapes replay and all 6 refused values are stored, including a 201 replayed as 404, a foreign `Location`, `text/html`, a body-less 201 after the ciphertext is nulled. Controls alike on both: untouched 201 and 204 replay; another scope's ciphertext and a relabelled key id fail authentication; rotation (current v2, previous v1) reads a v1 row; v2 alone refuses it. Completion: `text/html`, `application/vnd.api+json`, `application/json, text/html`, `charset=utf-16`, a trailing LF and a space before `;` are refused; `charset=UTF-8`, no space after `;`, `Application/JSON`, `application/problem+json` are kept |
| P4 | `p4-keys.mjs`, `p4b-base-control.mjs`: derivation through `idempotencyStoreFrom` | 20/20 checks. `hkdfSync` with an empty salt reproduces RFC 5869 test case 3 (control); 500 random materials × 2 labels equal WebCrypto HKDF; the two pinned vectors equal WebCrypto. A stored body opens under HKDF(material, body label) and under neither the raw material nor the network-label key. The anonymous scope is keyed by HKDF(current material, network label), not by the material, the body key or HKDF(body key). The previous key is HKDF(previous material, body label); the network key follows the current material only. A `local-only-*` marker is digested, then derived. Deployed material of 0, 16, 31, 33 or 64 bytes is refused with a message that names the variable only; a previous key with the current key id is refused. Control: at `0f0d92a0` the raw material opens a stored body |
| P5 | `p5-pins.mjs`: the PR040-SEC-07 sets recomputed with my own walk | (a) `{recordConsent}`, (b) `{emailShipmentDocuments}`, (c) `{checkoutOrder, confirmPayment, createPaymentMethodSetup}`; no operation names `client_secret` in an example only. 36 operations of any mode can be served without `bearerAuth` or `quoteToken`; besides `recordConsent` all are `not-applicable`, among them the three signature webhooks and the three refresh-cookie operations (PR040-SEC-12) |
| P6 | `p6b-migration.mjs`: the exact `migration.sql` and `down.sql` bytes of the head on PGlite, minimal stand-in table, a fresh database per case | After up: a COMPLETED row without a body (the part-040-A 204 form) and an IN_PROGRESS row with a body fail with 23514 `ck_idempotency_keys__completed_body`; nulling the ciphertext of a COMPLETED row fails the same way; a COMPLETED row with a body and an IN_PROGRESS row without one pass. The constraint is validated. `down` drops it and runs twice without error. With a violating row present, up fails at VALIDATE (the safe direction). `lock_timeout` reads `3s` afterwards |
| P7 | Stacked merge and record simulation (§6) | Against `763800f3`: 12 conflicted files; the explicit-base merge is clean and equals the hand resolution; `diff --raw` equality holds (15/15). Against `61c53b5e`: 14 conflicted files; resolving all of them to the stacked blob reverts 2 files of #81/#82 (caught by the equality, 17 lines against 15); the explicit-base merge is clean and right. Record checker: 8 scenarios as expected on both tips |
| – | Other checks | `STORED_CONTENT_TYPE` is linear (1 MB adversarial values in under 5 ms, never on request input). Every `IdempotencyReplayError` reason is a fixed literal, and the new WARN carries the class only. The over-approximating gitleaks v8.30.1 scan (rule regex and keywords, no entropy, no allowlists; runtime controls for a GitHub PAT, an AWS id and a generic key fire) finds 0 hits in this record and in the code review record. Gitleaks over the commit range is lane B's gitleaks-full (PASS) |

## 3. The security items of this pull request

### 3.1 PR040-SEC-01 (key separation): closed

- `from-config.ts:48-71`. The material (`materialOf`, exactly 32 bytes for a deployed key, the SHA-256 digest for a `local-only-*` marker) feeds `deriveIdempotencyKey` = HKDF-SHA256(material, empty salt, label, 32) with `platform-idempotency-body-v1` (current and previous body keys) and `platform-idempotency-scope-network-v1` (current only). The labels match ADR-0014 amendment 15 and ADR-0018 amendment 9 verbatim.
- An empty salt is RFC 5869's "not provided" (HashLen zero bytes); with a uniformly random 32-byte input that is sound, and P4's test-case-3 control shows `hkdfSync` implements it that way.
- The network key is derived from the material, not from the derived body key, as the round-1 remediation asked. For a deployed key it equals the part-040-A value, so nothing about anonymous scopes changes between the parts (and no row exists anyway).
- Previous-key handling: derived with the body label, dual read by key id (`body-cipher.ts:66-73` refuses a previous key with the current id), never used for the network key. The rotation effect on anonymous scopes stays accepted (D-SECPR040-01 §3.1 item 3).
- D-TASK040-22 (the 32-byte check in `materialOf`): concurred. It is a second line behind the configuration's `aes-256-gcm` material rule (`packages/config/src/keys.ts`), and it keeps working when PR040-SEC-13 changes the register row.

### 3.2 PR040-SEC-02 (sealed envelope): closed

- **Every completion seals one envelope** (`store.ts:344-370`): `{v: 1, origin, status, headers, body?}` with the allow-listed wire headers, also for a body-less 202/204. The clear `response_status` and `response_headers` are copies.
- **A replay reads only the envelope** (`store.ts:270-279`). The clear columns must equal it exactly (`sameHeaders`: same names, same count, same values; exact wire-name case), else `stored response mismatch`. Status, origin, version and header names are validated after opening (`envelopeOf`, `envelopeHeadersOf`); the part-040-A form `{origin, body}` and any other version are unreadable.
- **`ck_idempotency_keys__completed_body`** closes the "null the ciphertext, keep a chosen clear status" form in the database (P6; lane B), and the store refuses it too (`stored response missing`).
- **Content-Type allow-list at completion and at replay** (`store.ts:65`, `184-199`, `347-348`). At completion it is a `RangeError`: inside the handler transaction (a 2xx of a write route) that rolls the write back, then the FAILED entry, the release and a 500 (code review probe P1). A sealed non-JSON type is refused at replay even when a key holder wrote it (P3 T15).
- **Rollback and key release on refusal:** a write route's refusal rolls back and releases (above). A read-only route's refusal comes after COMMIT, in `settleClaim`, which releases the key: that path is PR040-SEC-11.
- **D-TASK040-19 concurred,** with its precondition: no row in the part-040-A form ever exists. On `origin/main` (`763800f3`, and still at `4ba683ad`) `app.ts` wires no store and no route outside tests declares `required` or `optional`, so none can be written before this PR merges and before part 040-B's second PR mounts a route (code review C5).
- **Residuals, accepted, no finding.** The AAD binds the scope and the key id, not the row. A database writer could therefore put back an older ciphertext of the same scope, which exists only if the same client reused the same key after 24 h, and replays that client's own earlier response. The clear `fingerprint` can be changed to replay a stored response for another body under the same key and scope, the client's own response again. Both need write access to the table, which can also simply delete a row. PR040-SEC-06's future contract step (dropping the clear columns) does not change either.

### 3.3 PR040-SEC-03 / SEC-TC-04 (stored client secrets): the tests hold

The API test (memory table) and the lane-B test (PostgreSQL 18, every column but the ciphertext read as text by a superuser) show the secret is replayed and no clear column holds a client-secret shape. The shape is built at run time, so no secret-shaped literal enters the gitleaks range. The decision stays as ruled (D-ARCH-204), and pin (c) is exact (P5).

### 3.4 PR040-SEC-04 (lease): closed as ruled; the rule's gap is PR040-SEC-10

`execute.ts:110-118` is amendment 10's formula, and the table test pins it. The rule counts each stretch from the COMMIT of the transaction that wrote `lease_until`, but the value is computed at the write (`store.ts:316` and `375`), up to `timeout` earlier. For the read-only path that difference is not covered. §4 rates it.

### 3.5 PR040-SEC-07 (contract pins): closed

The three sets are exact, each with planted negatives (`tests/contract/x-idempotency.test.ts:86-178`), and P5 reproduces them with an independent walk. Two follow-ups, neither blocking: pin (a) should key on "network-scoped" rather than "public" (PR040-SEC-12, which includes code review R1-n3 (a)), and a fourth pin on the 2xx media types (PR040-SEC-11, = R1-n4).

### 3.6 PR040-SEC-09 (unrenderable thrown 4xx): closed

`storableProblemOf` (`execute.ts:528-539`) catches a rendering failure, logs WARN `api.idempotency_problem_unrendered` with the class only (`TypeError`), and returns `undefined`, so `settleClaim` releases the key and the original failure goes on to the problem handler (which answers 500). The API test pins no row, the WARN line and an immediate retry; the code review's mutant M-a kills it. It also stops a rendering bug from replacing the original error, which part 040-A allowed. D-TASK040-21 concurred.

### 3.7 The migration `20261121000000_idempotency_keys_completed_body`

- Expand, not data-changing, reversible: one CHECK, NOT VALID then VALIDATE, under `SET lock_timeout = '3s'` (equal to the migrator default); `down.sql` drops it with `IF EXISTS`. P6 ran the exact bytes. D-TASK040-20 concurred.
- A new CHECK that the part-040-A writer would violate (a body-less COMPLETED row) is safe only because no part-040-A writer ever runs with a mounted route (§3.2, C5). If a row existed, VALIDATE would fail the deploy (P6), which is the safe direction.
- The directory name collides with TASK-080's `20261121000000_pricing_config_versions` and sorts before it (code review R1-m2). That migration is on main since `339b29d6`, so the inversion is now real for any database that applied main. Concurred: this PR re-times. It has no security effect beyond the binding: the rename changes owned paths, so the fix head needs a delta round (C2).

### 3.8 D-TASK040-18 (the admission term defaults to `maxWait`): concurred

`resolveAdmissionOptions` refuses an admission wait above `maxWait`, so the default only lengthens the lease. Part 040-B's second PR passes the configured value (code review C8); it must take it from the same resolved admission options the runner validated, not from a second read of the environment. A non-finite value would make every lease an invalid date and every claim a 5xx (fail closed, but an outage of every idempotent route).

### 3.9 The stale `IDEMPOTENCY_BODY_KEY` text (code review R1-n1): PR040-SEC-13

ADR-0018 amendment 9 and data-model §10.4 were updated (D-SECPR040-01 §3.1 item 6). The code copy of the register is not: `packages/config/src/schema.ts:379` ("AES-256-GCM key of stored idempotent responses") and the `idempotency-body` row of `packages/config/src/keys.ts` (algorithm AES-256-GCM, purpose "stored responses", blast radius "replay bodies (≤ 24 h)"). See §4.

## 4. Findings

| ID | Severity | CWE | OWASP 2021 | File:line (`a4aadd2e`) | Owner | Due |
|---|---|---|---|---|---|---|
| PR040-SEC-10 (= code review R1-m1) | LOW | CWE-667 | A04 | `apps/api/src/platform/tx/execute.ts:110-118`; `tx/idempotency-lease.test.ts:13-22`; ADR-0014 amendment 10 (table, row "After the last write") | principal-architect (ruling); senior-developer (fix) | ruling before this PR merges; fix before the first idempotent route is mounted (part 040-B's second PR), preferably in this PR's fix commit |
| PR040-SEC-11 (extends R1-n4) | INFO | CWE-693 | A04 | `idempotency/store.ts:347-348`; `tx/execute.ts:437-445`, `557-569`; `tests/contract/x-idempotency.test.ts` | senior-developer | with the R1 fix commit, at the latest part 040-B's second PR |
| PR040-SEC-12 (includes R1-n3 (a)) | INFO | – | A04 | `tests/contract/x-idempotency.test.ts:92-99` | senior-developer | with R1-n3 |
| PR040-SEC-13 (= R1-n1, extended) | INFO | CWE-1059 | A02 | `packages/config/src/schema.ts:379`; `packages/config/src/keys.ts`, row `idempotency-body` | the task the orchestrator names (TASK-041 holds the files) | before G3 |

### PR040-SEC-10 (LOW): the lease does not count the rest of the transaction that wrote it

- **Description.** `lease_until` is the application clock at the write plus the lease. The write happens inside the claim or renewal transaction, which can run up to `timeout` more before it commits, and only then does the next phase start. Amendment 10 counts its stretches from that commit. For the call path this is harmless: the writer's remainder plus the next renewal's admission and pool wait is at most one T, which the D + T term already holds (P2: margin exactly 5 s at the defaults). For the read-only path (a VIEW or DOWNLOAD handler, then its fail-closed entry, then the completion after COMMIT) the stretch is `timeout + 3T`, against a lease sized for `3T + 1 s`.

  P2, read-only margin (lease minus stretch; the 5 s skew margin is what should remain):

  | Statement timeout | 5 s | 6 s | 7 s | 8 s | 9 s | 12 s | 30 s | 120 s |
  |---|---|---|---|---|---|---|---|---|
  | admission wait passed (250 ms; part 040-B's second PR) | +5.5 s | +2.5 s | **−0.5 s** | **−2 s** | **−3 s** | **−6 s** | **−24 s** | **−114 s** |
  | admission defaulted to `maxWait` (this PR as composed) | +2 s | 0 | **−1 s** | **−2 s** | **−3 s** | **−6 s** | **−24 s** | **−114 s** |

  The table test (5, 8, 9, 12, 120 s) passes because its `readOnly` stretch starts at the commit.
- **Exploitability and impact.**
  - **What it needs:** a statement timeout of 7 s or more (the configuration allows up to 120 s), the claim or renewal, the handler transaction, the VIEW/DOWNLOAD entry and the completion all close to their bounds without failing, and a retry of the same key after the lease ends. The retry part is natural: a client that keeps retrying on 409 with `Retry-After: 1` takes the key over the moment the lease ends.
  - **What happens:** the retry runs the route again. For `emailShipmentDocuments`, the only idempotent read-only operation (pin (b)), that is a second DOWNLOAD entry (truthful: the handler did run twice) and a second e-mail of the same documents to the recipients the same caller asked for. The original's completion then fails as lost and logs WARN `api.idempotency_completion_failed` with `IdempotencyClaimLostError` and 202, so the event is visible.
  - **What it does not do:** no other caller is involved, nothing is disclosed, no money moves. Write routes are not affected: their completion is inside the handler transaction, and a lost claim rolls the write back. Their `call` stretch is covered (above).
  - Likelihood low (a non-default timeout and four near-bound transactions), impact low (a duplicate e-mail and entry for the same caller): **LOW**.
- **Ruling input for principal-architect (amendment 10).**
  - **(a) Recommended: count the writer's remainder.** `lease = max(30 s, max(D + T, timeout + 3T, 3T + FAILED_ENTRY_WAIT_MS) + 5 s)`. Keep the `3T + 1 s` term: the statement timeout may be as low as 100 ms, so `timeout + 3T` does not always dominate it. The defaults do not move when the admission wait is passed (32.25 s, since `D + T` = 27.25 s > `timeout + 3T` = 26.75 s); with the admission defaulted it is 37 s instead of 34 s; at 120 s with the admission passed, 491.75 s instead of 372.75 s (a crashed request's key is then blocked about 8 minutes instead of 6). One term at `execute.ts:116`.
  - **(b) Alternative:** a renewal between the read-only handler transaction and the VIEW/DOWNLOAD entry. The stretch becomes `timeout + 2T`, which today's formula covers. Cost: one more write per read-only request and a new lost-claim point (nothing sent yet, so 409 without an entry is right). More code than (a) for the same result.
  - **(c) Not recommended:** accept the residual with a configuration ceiling (statement timeout at most 6 s in staging and production). It restricts operations through a rule nobody connects to idempotency.
  - If (c) is chosen anyway, the ruling records the residual, and the JSDoc at `execute.ts:97-109` says the bound counts from COMMIT.
- **Remediation (code, for (a)).**
  ```ts
  const oneTransaction = admissionWaitMs + transaction.maxWait + transaction.timeout;
  const longest = Math.max(
    callDeadlineMs + oneTransaction,
    transaction.timeout + 3 * oneTransaction, // the writer's remainder, then handler, entry, completion
    3 * oneTransaction + FAILED_ENTRY_WAIT_MS,
  );
  ```
- **Verification.** In `idempotency-lease.test.ts`, measure each stretch from the write: `readOnly = timeout + 3T`, `failure = timeout + 2T + 1 s`, `load = timeout + 2T`, `call = timeout + D + admission + maxWait`. Add 6 and 7 s to the table (7 s is the first negative case with the configured admission wait), or replace the table by a property test over the configuration bounds (statement timeout 100 ms to 120 s, admission 1 to 2,000 ms, `timeout` at least the statement timeout). The 32.25 s pin stays. Re-run P2.

### PR040-SEC-11 (INFO): a non-JSON 2xx on a read-only idempotent route silently loses idempotency

- **Description.** The allow-list refusal at completion has two outcomes. On a write route it is a 500 every time (rolled back, code review probe P1). On a read-only route the completion runs after COMMIT and after the VIEW/DOWNLOAD entry (`execute.ts:437-445`). `settleClaim` catches the `RangeError`, logs `api.idempotency_completion_failed` and releases the key (`557-569`), while the 2xx is sent and `afterCommit` is scheduled. Every retry with the same key then runs the route again.
- **Impact.** None today: the only idempotent read-only operation answers 202 `application/json` (P1). A future idempotent VIEW/DOWNLOAD operation with a non-JSON 2xx would send its side effect once per retry, with nothing but a WARN to show it.
- **Fix.** The fourth contract pin of code review R1-n4, inside the PR040-SEC-07 block: every 2xx of every idempotent operation is `application/json` or has no content, with a planted negative (a `text/csv` 200 on a planted operation is named). Add the read-only shape to the API rows R1-n4 asks for: a VIEW route returning a 200 `text/html` with a key answers once, logs the WARN and leaves no row.

### PR040-SEC-12 (INFO): pin (a) keys on "public", not on "network-scoped"

- **Description.** Pin (a) exists because only network-scoped keys share a scope across callers behind one address (amendment 11, "Only `recordConsent` is scoped by the client network"). A key is network-scoped whenever the principal has no organisation, no guest-token hash and no actor (`scope.ts:56-64`). `isPublic` reads only the operation's own `security` and accepts `[]` or an empty requirement. It misses two kinds of operation that would also be network-scoped if they took a key:
  - an operation without its own `security` under a document-level `security: []` (code review R1-n3 (a));
  - operations whose schemes give a principal with none of the three: the signature webhooks (`receiveStripeWebhook`, `receiveMockGatewayWebhook`, `receiveCarrierPush`) and, depending on what the refresh authenticator sets, the refresh-cookie operations (`refreshSession`, `logoutSession`). All are `not-applicable` today (P5).
- **Fix.** Pin the set of idempotent operations whose effective `security` (the operation's, else the document's) has an alternative with neither `bearerAuth` nor `quoteToken`, which must be exactly `{recordConsent}`. Planted negatives: a signature webhook made `optional`, and a document-level `security: []` with an operation that declares none.

### PR040-SEC-13 (INFO): the code copy of the key register still calls the material an AES key

- **Description.** ADR-0018 amendment 9 makes `IDEMPOTENCY_BODY_KEY` a key-derivation input. The configuration description and the `idempotency-body` register row in `packages/config` still say "AES-256-GCM key", purpose "stored responses", blast radius "replay bodies (≤ 24 h)". That register is the code-side cryptographic inventory (ASVS 5.0 V11.1.2), and it now understates the blast radius: with the key and the table, an attacker also gets the pseudonyms of anonymous client networks, and the bodies include payment client secrets for up to 25 h.
- **Fix (text from the code review R1-n1, blast radius added).** Description: "Key-derivation input (HKDF-SHA256) of the AES-256-GCM key of stored idempotent responses and the HMAC-SHA-256 key of anonymous client networks (ADR-0018 amendment 9)." Row: algorithm "HKDF-SHA256 → AES-256-GCM, HMAC-SHA-256"; purpose "stored responses (AAD uses scope_hash); anonymous client networks"; blast radius as ADR-0018 amendment 9 ("replay bodies, including personal data and payment client secrets, at most 25 h; pseudonyms of anonymous client networks"). Keep `material: 'aes-256-gcm'`, which enforces the 32 bytes, or add a material kind for derivation inputs.
- **Owner.** Not this PR: the brief puts `packages/config` out of scope and TASK-041 holds the files. The orchestrator names the task (D-ORCH-156 lists it as owed). Due before G3.

## 5. Status of the TASK-040 findings at `a4aadd2e`

| ID | Status |
|---|---|
| PR040-SEC-01 (LOW) | **Closed** (§3.1) |
| PR040-SEC-02 (LOW) | **Closed** (§3.2) |
| PR040-SEC-03 (LOW) | Closed by ruling (round 2); the SEC-TC-04 tests hold (§3.3) |
| PR040-SEC-04 (LOW) | **Closed as ruled** (§3.4); the gap in the rule is PR040-SEC-10 |
| PR040-SEC-05, -06, -08 | Closed (round 2) |
| PR040-SEC-07 (INFO) | **Closed** (§3.5); follow-ups PR040-SEC-11, -12 |
| PR040-SEC-09 (INFO) | **Closed** (§3.6) |
| PR040-SEC-10 (LOW) | New, open (§4) |
| PR040-SEC-11, -12, -13 (INFO) | New, open (§4) |
| Part 040-B items of the second PR | Still owed there: P-1 to P-5 with the P-3 reading under the ledger claim, the purge with or before the wiring, the Pino-backed `IdempotencyLog` with class-only fields, proofs (a) to (g) |

## 6. Binding, the stacked merge and what the merge-only round must check

**This round binds to `a4aadd2e`.** The head does not merge as it is: R1-m2 renames the migration directory (an owned path), and any PR040-SEC-10 fix changes `execute.ts`. Both void this binding, so a delta round on the fix head is owed (C2). Then `origin/main` is merged in, and the merge-only round follows (C3).

**Main moved during this round.** #80 landed as `763800f3`; then #81 (TASK-080, `339b29d6`) and #82 (TASK-041 part 041-A, `61c53b5e`) landed on top, and later #83 and #84 (`4ba683ad`, D-ORCH-162). I ran the simulation against `763800f3` and `61c53b5e` and re-checked the merge at `4ba683ad`. Against `763800f3` it matches the D-ORCH-158 rule as written. Against the later tips it shows that the rule, applied literally, reverts other pull requests' changes (below).

**Simulation** (shared sparse clone of the main repository, plumbing commits, main's `tools/ci/check-security-owned-paths.mjs`, this record committed on the main side as `PR-0099-TASK-040B1-security-review.md`):

| Check | Against `763800f3` (#80 only) | Against `61c53b5e` (#80, #81, #82) |
|---|---|---|
| #80's 52 paths changed on main after the squash | none (`git diff --raw 0f0d92a0 763800f3` over them is empty) | **5**: `prisma/sql/grants.manifest`, `routing/pipeline-guards.test.ts`, `tools/db/grants-manifest.test.ts`, `prisma/tests/catalog/c01-c12.int.test.ts`, `packages/shared/src/classification/registry.ts`. None of them is one of this PR's 15 delta paths |
| Conflicts of a plain `git merge-tree --write-tree a4aadd2e <tip>` | 12: add/add in 10 files, content conflicts in `tx/execute.ts` and `prisma/schema/platform.prisma` | **14**: the same 12, plus `prisma/sql/grants.manifest` and `routing/pipeline-guards.test.ts` |
| D-ORCH-158 as written: "every conflicted file to the stacked blob" | tree `d55972ab`, correct | **Wrong for the 2 new files.** It drops #81's grant block for `pricing_config_versions` from `grants.manifest` (4 lines) and reverts #82's import change in `pipeline-guards.test.ts`. The equality check catches it: 17 lines against 15 |
| `git merge-tree --write-tree --merge-base=0f0d92a0 a4aadd2e <tip>` | clean, tree `d55972ab` (equal to the hand resolution) | clean, tree `b73786e1`: the stacked blob for the 15 delta files and main's blob for every other file |
| D-ORCH-158 equality: `git diff --raw --no-renames <tip> <merge>` = `git diff --raw --no-renames 0f0d92a0 a4aadd2e` | equal (15 lines, old and new blobs and modes) | equal for the explicit-base tree (15 lines) |
| S1: the stacked merge with this record on main (renamed) | **pass**, 14 owned paths, satisfied by `a4aadd2e` | **pass**, 14 owned paths, satisfied by `a4aadd2e`. The binding would survive a pure stacked merge; it is the fix commit (S3) that voids it |
| S2: a resolution that keeps main's `store.ts` | **pass** (13 owned paths): the checker cannot see a dropped change. The equality catches it (1 differing line) | same |
| S3: an owned path changed after `a4aadd2e` (`execute.ts`, as the R1-m2/PR040-SEC-10 fix commit will) | missing: "names a4aadd2, but apps/api/src/platform/tx/execute.ts changed after it" | same |
| S4: no record; S5: last Verdict row FAIL; S6: the `PR-pending-…` name only | missing, missing, missing, each with the expected note | same |
| S7: a merge-only round appended on main naming the new head, read from the merge ref | **pass**, satisfied by the new head | same |
| S8 (control for S7): the appended round names a main commit | missing | same |

**Re-checked at `4ba683ad`** (#83 and #84 on top): the same 5 of #80's paths changed after the squash and none of the 15 delta paths; the same 14 conflicts; the explicit-base merge is clean (tree `206bfdfb`) and the equality holds (15/15). D-ORCH-162 queues the stacked merge onto `763800f3` first. That also works: at `763800f3` the literal rule is right (12 conflicts, all delta files), and the later merge of the tip then has `763800f3` as its merge base and takes #81 to #84 cleanly. Simulated: the same tree `206bfdfb`, equality 15/15.

**The D-ORCH-158 rule, refined (also for TASK-041 part 041-B).** "Resolve every conflicted file to the stacked head's blob" holds only while main has not changed a predecessor path after the squash. Once it has, a conflicted file can be one the stacked delta never touched, and the stacked blob is then the predecessor's stale blob. Read the rule as: the stacked blob only for the files in `git diff --name-only <predecessor head> <stacked head>`; main's blob for every other conflicted file, or a hand union where both sides changed it. The mechanical form is `git merge-tree --write-tree --merge-base=<predecessor head> <stacked head> <main tip>`. When it is clean, its tree is the merge; commit it with both parents. The equality of item 2 below stays the proof either way.

**What the merge-only round must check** (on the fixed head, after the delta round):
1. Which of #80's paths main changed after the squash (`git diff --name-only 0f0d92a0 <main tip>` over them; 5 at `61c53b5e` and at `4ba683ad`). None may be one of this PR's delta files. If one is (TASK-043 shares `platform.prisma`; part 044-B follows on `execute.ts`), that file needs a hand union and is reviewed as code, not as a merge.
2. The merge tree equals `git merge-tree --write-tree --merge-base=0f0d92a0 <fixed stacked head> <main tip>` when that is clean, and `git diff --raw --no-renames <main tip> <merge>` equals `git diff --raw --no-renames 0f0d92a0 <fixed stacked head>`. Only this equality catches a resolution that drops a change or reverts main's (`grants.manifest` above); the record checker passes the first (S2).
3. The re-timed migration directory sorts after every directory on `origin/main` at that time (code review C4).
4. Gitleaks: after the squash, lane A's range `<main tip>..<merge>` also contains #80's original commits (`2abd665f`, `0f0d92a0`), which were scanned for #80 (D-SECPR040-03: 0 findings), and the merge commit, whose first-parent diff carries main's changes since `f65d7955` as added lines. At `61c53b5e` that is about 51,000 lines, including the code of #81 and #82, which merged without a passing lane A (D-ORCH-162; #83 and #84 the same). My over-approximating scan (no entropy, no allowlists) is inconclusive there (41 `generic-api-key` candidates in 4,794 added code lines). Confirm 0 findings with the faithful emulation or the real image before pushing; lane B's gitleaks-full on the merged head is the first check of the combined tree.
5. The round's `Head` row names the merge commit; this record keeps its own row, which the checker then skips if owned paths changed after it.

## 7. Conditions (merge of this pull request)

- **C1 · principal-architect.** A recorded ruling on PR040-SEC-10 before this PR merges (it is also code review C1). With (a) or (b), the fix goes in this PR's fix commit (preferred; it needs a delta round anyway for R1-m2) or, at the latest, in part 040-B's second PR before any idempotent route is mounted. With (c), the ruling and the JSDoc wording.
- **C2 · security-analyst.** A delta round on the fix head: R1-m2 (the re-timed directory and its three references), the PR040-SEC-10 change if any, and the NITs that ride along. A commit that touches an owned path after that needs another delta round.
- **C3 · security-analyst.** The merge-only round after `origin/main` is merged in, with checks 1 to 5 of §6. The merge is made by the refined rule of §6 (the explicit-base merge, or the stacked blob only for this PR's delta files), not by resolving every conflicted file to the stacked blob.
- **C4 · orchestrator.** Before merge: a fresh lane B PASS on PostgreSQL 18 on the merged head (`20261121T0754Z_a4aadd2` is diagnostic only); hosted CI with the expected lane A extras `security-integration` and `migration-lint`; this record renamed to `PR-<NNNN>-TASK-040B1-security-review.md` and the merge-ref check (D-ORCH-136/138).
- **C5 · orchestrator (= code review C5).** This PR merges before part 040-B's second PR, and no composition mounts an idempotent route before it (true on `4ba683ad`).

Not conditions of this PR: PR040-SEC-11 and -12 (with the R1 fix commit or the second PR), PR040-SEC-13 (before G3), the second PR's items in §5, and the PR 2 rider of §3.8.

## 8. Routing

| To | Item |
|---|---|
| principal-architect | PR040-SEC-10: the amendment 10 ruling, with options (a) to (c) of §4 (C1) |
| senior-developer | PR040-SEC-10 fix if (a) or (b); R1-m2; PR040-SEC-11 (the fourth pin and the read-only API row); PR040-SEC-12 (pin (a) predicate, with R1-n3); in the second PR: `admissionWaitMs` from the resolved admission options (§3.8) |
| orchestrator | C3 to C5; the refined D-ORCH-158 merge rule of §6 for this PR and for TASK-041 part 041-B (its predecessor #82 is now on main too); name the owner of PR040-SEC-13 (with the R1-n1 text) |
| security-analyst (self) | C2, C3; before G3, the T-79 and R-05 text still owed from D-SECPR040-01 §3.9 |

| Verdict | **PASS_WITH_CONDITIONS.** Round 1 of part 040-B's first pull request, bound to `a4aadd2e` (delta `0f0d92a0..a4aadd2e`).<br>**Findings:** 0 Critical, 0 High, 0 Medium. New: PR040-SEC-10 LOW (= code review R1-m1: the read-only stretch of the lease misses the writer's remainder; margin negative from a statement timeout of 7 s; a duplicate e-mail and DOWNLOAD entry for the same caller); PR040-SEC-11, -12, -13 INFO.<br>**Closed:** PR040-SEC-01, -02, -07, -09; PR040-SEC-04 as ruled.<br>**Concurred:** D-TASK040-18 to D-TASK040-22; code review R1-m2 (this PR re-times).<br>**Binding:** main moved to `4ba683ad` (#80 to #84) during the round. The D-ORCH-158 rule is refined: the stacked blob only for this PR's delta files, or the explicit-base merge (`--merge-base=0f0d92a0`, clean today), with the raw-diff equality as proof. The literal rule would revert #81's `grants.manifest` block.<br>**Conditions:** C1 the architect's ruling on PR040-SEC-10; C2 a delta round on the fix head; C3 the merge-only round with the §6 checks and the refined rule; C4 lane B on the merged head, hosted CI, rename and merge-ref check; C5 merge order |
