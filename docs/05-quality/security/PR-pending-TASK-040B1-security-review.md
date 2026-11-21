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

# Round 2: delta round on the fix head (condition C2) and merge-only round for the stacked merge `0ccdd009` (condition C3)

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-040-part-b-idempotency-production`, pushed at `9d1687b1` (D-TASK040-23 to -25). Commits since round 1: `0ccdd009` (stacked merge of `origin/main` `4ba683ad`, D-ORCH-166), `2c9cc41c` (code review R1-m2 re-time, R1-n2, R1-n5), `9d1687b1` (fix cycle 1: PR040-SEC-10 as ruled by D-ARCH-232 and ADR-0014 amendment 18; PR040-SEC-11 and -12 with code review R1-n3 and R1-n4) |
| Head | 9d1687b124ccd137c95c706d3ab5717531070e78 |
| What was reviewed | (1) The merge `0ccdd009` as a merge, with checks 1 to 5 of §6 (R2.3). (2) The delta `0ccdd009..9d1687b1` in full: 10 files, 251+/69-. The migration directory is renamed (`migration.sql` 100 %, `down.sql` 80 %: its first comment line). 9 of the 10 are security-owned; `tests/contract/x-idempotency.test.ts` is not, and I read it as a control. The range the checker will see, `4ba683ad..9d1687b1`, changes the same 15 paths as round 1 (the re-timed directory instead of the old one), 14 of them owned |
| Base and main | The merge base is `4ba683ad`; it is also the `base.sha` the pull request event will carry. Since then main has moved in `docs/` and `.claude/` only. Tips when this round was written: local `main` `c123cf9a`, `origin/main` `88fd7360` |
| Lane B | `20261121T1538Z_2c9cc41` on `2c9cc41c` (the merge and the re-time): FAIL on exactly the main-wide cases of D-ORCH-170 and on nothing else. Those cases are gitleaks-full (2 tests; 3 fingerprints beyond the 17-line baseline: the 2 main PR080-SEC-07 lines and the branch-only line of `0ccdd009`, which PR #85 adds to the baseline, D-DEVOPS-002) and `compose-stack.test.ts` (O-1, PR #86). Everything else passed: api 243, catalog 121, migrations 30 (up/down/up of the re-timed migration), RLS 162, integration 506, unit 8,552 (2 skipped). `run-live75` on `9d1687b1` was queued behind CHORE-VALKEY and had not run when this round was written |
| Binding items read | D-ARCH-232 and ADR-0014 amendment 18; D-TASK040-23 to -25; D-SD-013; code review round 2 (D-CRPR040B1-01, `cd16eb96`, APPROVED_WITH_NITS, R2-n1, R2-n2); D-QG-010 part 1 (QG-040-C9); D-ORCH-166 to -171; D-DEVOPS-001, -002; PR080-SEC-07 routes (a) to (c) (`PR-0081-TASK-080-security-review.md` R3.2) |
| Reviewer / date | security-analyst, 2026-11-21, round 2.<br>**Host rule as round 1:** no Docker, no Jest and no npm suites. No command ran in `../Shipqube-TASK-040B`: its commits were read from the shared object store and the lane B log from the queue directory.<br>**Method:** single-process Node 24.22.3 probes on a `git archive` extract of `9d1687b1`. As controls, `a4aadd2e`'s `execute.ts` and five mutants sit next to the head's file. The head's `tests/contract/x-idempotency.test.ts` ran in-process on the head's dereferenced contract (a stub of `@jest/globals`, the real `expect` 30). Plumbing gave the merge proofs, and a shared sparse clone the record simulation.<br>`.env*` was not opened. #82's path list names `.env.example`; for it only blob ids were compared, and the gitleaks emulation excluded it by pathspec (checked by names only) |

## R2.1 Summary

- **PR040-SEC-10 closed** as ruled by D-ARCH-232 (amendment 18): `lease = max(30 s, timeout + max(D + T, 3T) + F + 5 s)`. I re-ran probe P2 with every stretch counted from the write and every later transaction, the one that ends the stretch included, counted with its full T. The stretches come from the code paths of `run()`, not from the six rows. Result: no stretch below the 5 s margin in 479,604 production configurations or in 2,000,000 random inputs of the function's domain. The smallest margin is exactly 5.000 s, on the failed `call`. The control `a4aadd2e` fails 2,250,176 times (worst −114 s), and the probe detects all five mutants.
- **PR040-SEC-11 closed:** pin (d) and both API rows. **PR040-SEC-12 closed:** pin (a) on the effective security. One residual of pin (d) becomes **PR040-SEC-14, INFO** (= code review R2-n2, extended): three weakenings of its predicate survive the planted negatives. None of the three shapes is in the contract today.
- **PR040-SEC-13 stays open and goes to part 040-B's second pull request.** That routing is acceptable, due before G3 as before (R2.6).
- **The stacked merge `0ccdd009` is pure.** Its tree equals the explicit-base merge-tree (`206bfdfb`), and the raw-diff equality holds (15/15). Every path of #81, #82 (rate limiting, 49/49), #83 and #84 is byte-identical to main at the head. So are #80's paths outside this pull request (40/52, its error rendering included). Condition C3 is discharged for this merge.
- **Gitleaks:** the faithful emulation finds exactly 1 finding over the pull request's range (93,338 added lines): the PR080-SEC-07 line re-added by `0ccdd009`. Lane A's range scan reads the base `.gitleaks.toml`, never the baseline of #85. It will therefore report that line unless PR080-SEC-07 route (c) is applied first. C4 now names this.
- **New:** PR040-SEC-14 INFO. No Critical, High, Medium or Low is open for this pull request.

## R2.2 What I verified

| # | Probe (session scratch `t040b1r2/probes/`) | Result |
|---|---|---|
| P2r2 | `p2r2-lease.mjs`: the real `idempotencyLeaseMs` of the head. The stretches are enumerated over `run()`'s eight route shapes (`load` or not, `call` or not, writing or read-only handler), each with its outcomes. W = the clock reading of a claim, takeover or renewal, followed by at most `timeout` of its transaction. Every later transaction counts in full as T = admission wait + `maxWait` + `timeout`, so does the one with the protecting statement (a renewal or a completion). D counts for `call`, F (1 s) before the completion of a stored 4xx. The thresholds are the probe's own constants (5 s, 30 s, 1 s, 20 s), not the module's | **Production domain** (`maxWait` 2,000 ms, a code constant; D 20,000; statement timeout every millisecond from 100 to 120,000; admission 1, 250 or 2,000 ms, or not passed): 479,604 configurations, **0 stretches below 5 s**, 0 below the floor. Smallest margins: failed `call` 5.000 s; `call` to the renewal 6.000 s; read-only handler, entry and completion 6.000 s; failed handler 15 s; `load` to the renewal 16 s; handler completing inside 26 s. **Function domain:** 2,000,000 xorshift draws (`maxWait` 1 to 120,000; admission 1 to `maxWait` or absent; timeout 100 to 120,000; D 1 to 120,000): 0 below 5 s, smallest 5.000 s. **Values:** 38,250 / 40,000 ms at 5 s (admission 250 ms / not passed), 42,250 / 46,000 at 7 s, 60,750 / 66,000 at 12 s, 492,750 / 498,000 at 120 s. The head is never shorter than `a4aadd2e` (production domain sampled every 7 ms: 0 cases) |
| P2r2-c | Controls through the same probe | `a4aadd2e`'s `execute.ts`: 2,250,176 violations; read-only −114.000 s at 120 s; `call` to the renewal −2.499 s and failed `call` −3.499 s at a timeout of 7,499 ms. Mutants of the head: timeout term dropped 2,240,840 (−114 s); F dropped 110,692 (4.000 s on the failed `call`); `3 *` to `2 *` 1,801,004 (−118 s); the `a4aadd2e` expression 2,250,176; admission default `maxWait` to 0 525,596 (0 s on the read-only row at 8 s). All five are detected |
| P5r2 | `p5r2-pins.mjs`: the head's dereferenced contract; my own walk, then the pull request's predicates (from a copy of the test file with an appended export), then the test file itself | 133 operations, 47 idempotent. Document-level `security` is `[{bearerAuth}]`. Schemes: `bearerAuth`, `refreshCookieWeb`, `refreshCookieAdmin`, `csrfToken`, `quoteToken`, and the signature schemes for Stripe, the mock gateway and carriers. My walk on the effective security gives (a) `{recordConsent}` and (b) `{emailShipmentDocuments}`. (d) The 2xx media types are 200 JSON ×20, 201 JSON ×14, 202 JSON ×4 and 204 without content ×9, and no other. No operation of the 133 has a `default` response. Twelve planted shapes through the pull request's predicates: 11 classify as they must (an alternative with a signature scheme, or an empty one, is named; an AND of bearer and signature, a quote token alone and bearer with scopes are not; a `2XX` key, a JSON type with a parameter, a 2xx `problem+json` and a 2xx `text/event-stream` are named; a 204 is not). The twelfth, a `default` response with `text/html`, is not named (= code review R2-n2). The head test file in-process: 23 passed, 0 failed |
| P5r2-m | Mutants of the test file's predicates, each run against the whole file | Killed: pin (a) reads only the operation's `security`; `quoteToken` dropped from the identifying schemes; an absent `security` counted as identifying; a control that names every JSON type. **Survived:** pin (d) ignoring a `2XX` key, and pin (d) accepting every `…json` type (also `application/vnd.api+json`, which the store refuses at completion, round 1 P3). See PR040-SEC-14 |
| M1 | Merge purity (plumbing) | `0ccdd009^{tree}` = `206bfdfb` = `git merge-tree --write-tree --merge-base=0f0d92a0 a4aadd2e 4ba683ad` (clean). A plain merge-tree gives the 14 conflicts of D-ORCH-166. `git diff --raw --no-renames 4ba683ad 0ccdd009` equals `git diff --raw --no-renames 0f0d92a0 a4aadd2e` (15 lines, old and new blobs and modes). None of the 15 delta paths changed on main between `0f0d92a0` and `4ba683ad` |
| M2 | Main's controls at the head: every path of each main PR, blob at `9d1687b1` against `4ba683ad` | Only this PR's 15 paths differ (12 modified; added: `from-config.test.ts` and the two re-timed migration files). #81 61/61, **#82 49/49** (`rate-limit/*`, `pipeline.ts`, `capture.ts`, `authorise.ts`, `app.ts`, `start-api.ts`, `packages/config` `guards.ts` and `schema.ts`, `security-event.ts`, the lockfile), #83 32/32 and #84 7/7 are identical. #80: 40/52 identical, among them its error rendering (`errors/rendered-problem.ts`, `problem-handler.ts`, `classify.ts`), `grants.manifest`, the catalog tests and the classification registry. The other 12 are this PR's files; their blob at `4ba683ad` equals `0f0d92a0`'s, so the head carries #80's version plus this PR's delta and nothing else. #82's changes to `capture.ts` and `pipeline.ts` concern denials only (the T-39 mark, the budget), not `readOnlyHandler`, `afterCommit` or `afterFailure`, which the slot uses; `with-tenant-tx.ts`, `tx/`, `idempotency/` and `errors/` did not change on main after `0f0d92a0` |
| M3 | Migration order | `20261121120000_idempotency_keys_completed_body` sorts after every directory on `origin/main` and on local `main` (the last one there is `20261121000000_pricing_config_versions`). The SQL is byte-identical to round 1's (P6 stands); `down.sql` changes only in its comment |
| M4 | `gl-emu-noenv.mjs`: gitleaks v8.30.1 emulation, faithful mode (hunk fragments, `secretGroup`, entropy, rule allowlists with `regexTarget = "match"`, stopwords, global allowlist; runtime controls for a GitHub PAT, an AWS id and a generic key all fire). Run over the 7 commits of `4ba683ad..9d1687b1` with `--diff-merges=first-parent`, `.env*` excluded by pathspec | 93,338 added lines. Over-approximation: 373 candidates. **Faithful: 1 finding, `0ccdd009…:docs/sdlc/DECISIONS.md:generic-api-key:7697`.** That is the PR080-SEC-07 false positive (a quoted doc-comment phrase, no secret), and it is the same line lane B's real image counts. The 251 added lines of `2c9cc41c` and `9d1687b1` give 0 (one over-approximation candidate in `9d1687b1`, `IDENTIFYING_SCHEMES`, falls to the 3.5 entropy threshold) |
| M5 | C5 at the head | No production composition passes a store to `executeSlot` or calls `idempotencyStoreFrom`, and no route outside tests declares `required` or `optional` (`pipeline.ts` spreads only what `createApp` gives). Main is docs-only after `4ba683ad` |
| S | Record simulation (R2.7) | As expected in every scenario |

**Modelling assumption, no finding.** The writer's remainder is bounded by the interactive-transaction `timeout`. Two things are not counted as separate terms: the COMMIT round trip after the callback returns, and timer scheduling delay. Both sit inside the 5 s margin, which amendment 18 keeps for skew and jitter. QG-010 notes that the read-only row also over-counts F (no FAILED entry outside write mode). Both points only make the probe stricter.

## R2.3 The stacked merge `0ccdd009`: checks 1 to 5 of §6

1. **#80's paths that main changed after the squash:** the same 5 as round 1 (`grants.manifest`, `pipeline-guards.test.ts`, `grants-manifest.test.ts`, `c01-c12.int.test.ts`, `registry.ts`). None is a delta path (M1). The merge took main's blob for the 2 of them that conflicted (D-ORCH-166).
2. **The merge tree** is the explicit-base merge-tree, and the raw-diff equality holds (M1). The refined D-ORCH-158 rule was applied as round 1 asked.
3. **The re-timed directory sorts last** (M3).
4. **Gitleaks:** one finding in the range, the PR080-SEC-07 line of `0ccdd009` (M4). The rest of the 274 over-approximation candidates of the merge's first-parent diff (main's text since `f65d7955`, #81 to #84 included) fall to entropy, the allowlists or the stopwords. Lane B: #85 adds the fingerprint to the gitleaks-full baseline (count 22). **Lane A is a different case.** Its PR range scan reads the base `.gitleaks.toml` and never the baseline, and the merge cannot leave the branch's ancestry. So lane A will report it, as D-DEVOPS-002 notes. PR080-SEC-07 route (c) applies: a D-SEC-PR45-01 commit-bound `.gitleaks.toml` entry for `0ccdd009` (one commit, `docs/sdlc/DECISIONS.md`, `generic-api-key`, an anchored line with a constrained value class) in its own pull request merged first, or a supersede of this branch (D-SECPR040-02 route) with supersede rounds. This is in C4 below. It is not a finding of this pull request.
5. **Head row:** this round names `9d1687b1`, the last commit that changes an owned path. The merge itself changes no owned path beyond the stacked blobs (the equality). Round 1's row stays, and the checker skips it because `execute.ts` changed after `a4aadd2e`.

**C3 is discharged for `0ccdd009`.** A new merge of main is needed if main changes code before this pull request merges, or if GitHub cannot build the merge ref. That merge needs its own merge-only round: these five checks on the new merge, and a Head row naming it.

## R2.4 The delta

### PR040-SEC-10 (LOW): closed

- `execute.ts:121-123` is the fix-cycle line of D-ARCH-232 verbatim: `transaction.timeout + Math.max(callDeadlineMs + oneTransaction, 3 * oneTransaction) + FAILED_ENTRY_WAIT_MS`. The floor, `LEASE_SKEW_MARGIN_MS` and the `admissionWaitMs` default are unchanged. The JSDoc (`97-115`) states the six stretches of amendment 18, each from the clock reading of the write.
- My own path enumeration (P2r2) finds no stretch outside the six rows. QG-010 found the same independently. Every stretch keeps 5 s over the whole configuration range. The read-only row, the one with an unstoppable effect (a second e-mail and DOWNLOAD entry of `emailShipmentDocuments`), keeps at least 6 s. The values match D-ARCH-232: 38.25 s at the defaults, 40 s as this pull request composes it, 492.75 s at a statement timeout of 120 s.
- **Test strength.** `idempotency-lease.test.ts` has the 5 to 120 s table at both admission waits, the fast-check property over the configuration bounds (2,000 runs) and the pins 38250, 60750, 546000, 96004, 30000 and 40000. The four mutants of the ruling fail it (D-TASK040-23..25; code review round 2). They also fail my probe, which shares no stretch formula with the test.
- **Two points, neither new.** (1) The admission-default mutant shows what an understated `admissionWaitMs` does: 0 s of margin. Part 040-B's second pull request must pass the value the runner validated, from the same resolved admission options (round 1 §3.8, code review C8). (2) The lease test types the six rows by hand, so a new phase in the slot does not fail it. For TASK-187's re-authentication transaction, that is QG-040-C9; I concur and add nothing.
- **Availability cost, accepted:** a crashed request blocks its own key's retry for up to 8.3 minutes at the configured maximum (498 s as composed). Only the same caller's key is affected; the retry gets 409 with `Retry-After: 1`. No finding.

### PR040-SEC-11 (INFO): closed; residual PR040-SEC-14

- **Pin (d)** (`x-idempotency.test.ts`, `nonJsonSuccessMediaTypes` and its two tests): no idempotent operation has a 2xx other than `application/json` or no content. The planted `text/csv` 200 is named; it is not named on a not-applicable operation or on a 4xx. My walk agrees (P5r2).
- **API rows** (`idempotency.api.test.ts`):
  - (1) A writing route with a `text/html` 201 answers 500 `problem+json`. It writes one FAILED entry (500) and no row, releases the key, and the retry runs again.
  - (2) A VIEW route with a `text/html` 200 answers once, in the order VIEW entry, completion refused, release. It logs one WARN `api.idempotency_completion_failed` `{error: RangeError, status: 200}` and leaves no row, and the retry runs the route again. Row (2) pins the residual of round 1 as it is, so a later fail-closed design must change it on purpose. That is what I asked for.
  - The capture double now treats VIEW like DOWNLOAD, as the real capture does for every non-write mode.
  - Code review R2-n1 (pin the rollback in row (1) by event order): concurred, test-only.
- **Residual:** P5r2 shows three weakenings of pin (d) that no planted negative catches: a `default` response (code review R2-n2), a `2XX` key, and a `+json` type the store refuses. **PR040-SEC-14** (R2.5).

### PR040-SEC-12 (INFO): closed

Pin (a) reads the effective `security`: the operation's own, else the document's, with an absent one counting as no requirement. A key is network-scoped when the list is empty or has an alternative with neither `bearerAuth` nor `quoteToken`. Those are exactly the schemes that give `scope.ts` an organisation, a guest-token hash or an actor. The set is still `{recordConsent}`, and the planted negatives include a signature webhook made `optional` and an operation without `security` under a document-level `[]` or no document security. My six extra shapes classify correctly, and three mutants of the predicate die (P5r2). R1-n3 (c), the keyword-only `example`/`examples` skip, is in the same commit and has its planted case.

### R1-m2 and the NITs (`2c9cc41c`)

- The re-time: the directory sorts last (M3), and the three references follow (`down.sql:1`, `tests/memory-keys.ts:60`, `idempotency-keys.int.test.ts:235`).
- R1-n5: the PostgreSQL case now requires a `DbError` with SQLSTATE 23514 instead of any rejection. That is stronger, and the constraint name stays pinned by the raw-SQL case.
- R1-n2: a JSDoc name.

None of these has a security effect.

## R2.5 Findings (new in this round)

| ID | Severity | CWE | OWASP 2021 | File:line (`9d1687b1`) | Owner | Due |
|---|---|---|---|---|---|---|
| PR040-SEC-14 (= code review R2-n2, extended) | INFO | CWE-1023 | A04 | `tests/contract/x-idempotency.test.ts:146-150` (`nonJsonSuccessMediaTypes`), `:243-249` (the pin (d) planted test) | senior-developer | any later commit to the file; at the latest part 040-B's second pull request. Not a merge condition |

### PR040-SEC-14 (INFO): pin (d) misses three shapes of a non-storable 2xx

- **Description.** Pin (d) is PR040-SEC-11's guard against a future idempotent operation whose 2xx the store will not complete. On a read-only route that would silently lose idempotency, as API row (2) shows. The predicate looks only at status keys matching `^2(?:\d\d|XX)$` and only flags media types other than `application/json`. P5r2 finds three weakenings that the planted negatives do not catch:
  - (i) a `default` response is never read (code review R2-n2);
  - (ii) a mutant that ignores the `2XX` key survives;
  - (iii) a mutant that accepts every `…json` type survives, although the store refuses `application/vnd.api+json` at completion.
- **Impact.** None today: the contract has no `default` response, no `2XX` key and only `application/json` 2xx bodies on idempotent operations (P5r2). It weakens a regression guard for a future operation.
- **Fix.**
  - Treat a `default` response like a 2xx in `nonJsonSuccessMediaTypes`. Today that flags nothing.
  - Add planted negatives that must be named: a `2XX` with `text/html`, a `200` with `application/vnd.api+json` and a `default` with `text/html`.
  - Optionally, test the media type with the store's own `STORED_CONTENT_TYPE` instead of a string compare. A 2xx is then named exactly when the store would refuse it.
- **Verification.** The two surviving mutants of P5r2 fail the suite, and the planted cases are named.

## R2.6 PR040-SEC-13 routed to the second pull request: acceptable

The routing (D-ORCH-167, D-TASK040-25, card line D-SD-013) is acceptable, with the due date unchanged: before G3.

- **It is inventory text.** The stale `schema.ts` description and `keys.ts` register row change no behaviour. `materialOf`'s 32-byte check, which round 1 concurred with, does not depend on them.
- **Nothing reads the key yet.** No production composition wires the store before the second pull request (M5), so until then the register understates nothing that runs. The second pull request makes `IDEMPOTENCY_BODY_KEY` operational (the wiring and the purge), so it is the natural place for the text.
- **The files are held by TASK-041 part 041-B.** The change should land after 041-B merges, to avoid a conflict there.
- **The due date does not move with the pull request.** If the second pull request is not merged by the G3 check, the text change goes in on its own before G3. The text is round 1 §4 (the R1-n1 wording, with the blast radius of ADR-0018 amendment 9). The second pull request's security round checks it.

## R2.7 Record simulation

A shared sparse clone with plumbing commits (`record-sim-r2.sh`). Main's `tools/ci/check-security-owned-paths.mjs` was run with `--base 4ba683ad --head <head> --pr 99`, the way `ci.yml` passes the event's base and head. The work tree was the simulated merge ref: main's tip `c123cf9a` plus the record under the name `PR-0099-…`, merged with the head.

| Scenario | Result |
|---|---|
| S1: round 1 + this round on main, head `9d1687b1` | **pass**, 14 owned paths, satisfied by `9d1687b1`. Round 1's row gets the expected note (owned paths changed after `a4aadd2e`) |
| S2: round 1 only (control) | missing |
| S3: an owned path (`execute.ts`) changed after `9d1687b1` | missing |
| S4: the last Verdict row FAIL | missing ("verdict FAIL is not one of …") |
| S5: the `PR-pending-…` name only | missing ("no record named … PR-0099-*") |
| S6: this round's Head row names a main commit | missing |
| S7: head `0ccdd009` (the pure merge, before the fix commits) | pass, satisfied by `a4aadd2e`: a pure stacked merge keeps round 1's binding, as round 1 S1 predicted. The fix commits are what void it (S2) |

The candidate has 2 `Head` rows (one per round) and 2 `Verdict` rows, and its last line is this round's Verdict row.

## R2.8 Status at `9d1687b1`

| ID | Status |
|---|---|
| PR040-SEC-01, -02, -07, -09 | Closed (round 1). The delta touches `store.ts` in one comment line only; `body-cipher.ts` and `from-config.ts` are not in it |
| PR040-SEC-03, -04, -05, -06, -08 | Closed (earlier rounds) |
| PR040-SEC-10 (LOW) | **Closed** (R2.4) |
| PR040-SEC-11 (INFO) | **Closed** (R2.4); residual PR040-SEC-14 |
| PR040-SEC-12 (INFO) | **Closed** (R2.4) |
| PR040-SEC-13 (INFO) | Open. Routed to part 040-B's second pull request, accepted (R2.6). Due before G3 |
| PR040-SEC-14 (INFO) | New, open (R2.5) |
| Second pull request | Still owed there: P-1 to P-5 with the P-3 reading under the ledger claim; the purge with or before the wiring; the Pino-backed `IdempotencyLog` with class-only fields; proofs (a) to (g); `admissionWaitMs` from the resolved admission options (§3.8); PR040-SEC-13; PR040-SEC-14 if no earlier commit takes it |

## R2.9 Conditions (merge of this pull request), updated

- **C1 · closed.** D-ARCH-232 (amendment 18), verified by D-QG-010.
- **C2 · closed** by this round.
- **C3 · discharged for `0ccdd009`** (R2.3). A new merge of main needs a new merge-only round on that merge.
- **C4 · orchestrator, open, now four items.**
  - (a) Lane B on PostgreSQL 18 at `9d1687b1` (`run-live75`). Until #85 and #86 are on main, a FAIL on exactly the D-ORCH-170 cases reads as PASS for this pull request: gitleaks-full with the 3 PR080-SEC-07 fingerprints, the `0ccdd009` one included, and `compose-stack.test.ts`.
  - (b) **Lane A gitleaks:** PR080-SEC-07 route (c) for `0ccdd009` (R2.3 item 4), owner orchestrator with devops-engineer, done before the hosted CI run counts. Either the commit-bound `.gitleaks.toml` entry merged to main in its own pull request, with its security record, or a supersede of this branch with supersede rounds.
  - (c) Hosted CI with the `security-integration` and `migration-lint` extras.
  - (d) This record renamed to `PR-<NNNN>-TASK-040B1-security-review.md`, and the merge-ref check (D-ORCH-136/138).
- **C5 · holds** at `9d1687b1` (M5). It stays a merge-order condition for the second pull request.

Not conditions of this pull request: PR040-SEC-13 (before G3, second pull request), PR040-SEC-14 (INFO), QG-040-C9 (before TASK-187), and the second pull request's items above.

| Verdict | **PASS_WITH_CONDITIONS.** Round 2 of part 040-B's first pull request: the delta `0ccdd009..9d1687b1` and the merge-only round for `0ccdd009`, bound to `9d1687b1`.<br>**Findings:** 0 Critical, 0 High, 0 Medium, 0 Low open. New: PR040-SEC-14 INFO (= code review R2-n2 extended; pin (d) misses a `default` response, a `2XX` key and a refused `+json` type).<br>**Closed:** PR040-SEC-10 LOW (amendment 18 formula; P2 re-run from the write with full T: 0 of 479,604 production and 2,000,000 random configurations below 5 s, minimum 5.000 s; the control and five mutants detected); PR040-SEC-11 and -12 INFO.<br>**Routing accepted:** PR040-SEC-13 to the second pull request, due before G3.<br>**Merge:** `0ccdd009` is pure (tree `206bfdfb`, raw-diff equality 15/15). Every control of #80 to #84 is kept: #82 49/49 paths and #80's error rendering identical to main. Gitleaks: exactly the PR080-SEC-07 line of `0ccdd009`.<br>**Conditions:** C1 and C2 closed, C3 discharged for this merge. Open: C4 (lane B at `9d1687b1`; lane A gitleaks route (c) for `0ccdd009`; hosted CI; rename and merge-ref check). C5 holds |
