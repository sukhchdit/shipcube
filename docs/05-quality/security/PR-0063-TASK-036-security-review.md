# PR-0063: TASK-036 error catalogue and validation error format, security review

| Field | Value |
|---|---|
| PR | #63, https://github.com/sukhchdit/shipcube/pull/63, branch `feat/TASK-036-error-catalogue-validation-error-format`. One commit, `fcdb7ac`, on merge base `80dce9e`. When this round was written, `main` was at `0f3528e`. Since the merge base it has gained PR #60 (`96c2c7a`: `eslint.config.mjs`, `packages/authz/**`, `tests/generated/rbac/**`, `tools/lint/**`, lint fixtures) plus docs and agent-note commits. None of them touches a path this PR changes, and `git merge-tree origin/main fcdb7ac` is clean |
| Head | fcdb7acec11fe832b5f0244695ec5a46d853af5b |
| Lane A evidence | Run 44104641784 on `fcdb7ac` (`pull_request`, merge ref `9d1fb41` on `538f0b0`). **fast-lane:** the supply-chain steps are green (workflow policy, install flags, migrations, lockfile, cooldown, install, licences, signatures, audit). "Lane B evidence" is red because no evidence is on the branch, so lint, format, type-check, unit, the negative lint fixtures and build were **skipped**. **ci-gate:** Gitleaks (PR range), Semgrep and oasdiff are `success`. "Security-owned paths need a review record" is red: this record is missing, and 3 owned paths changed. security-integration was skipped |
| Lane B evidence | None on the branch. Run `20261117T1412Z_fc14eab` FAILED: the `rls/api-cases` ECONNRESET is contention-suspect, and the diff-coverage failure was on a file the amend removed. It is not evidence. Session A queued the head (D-ORCH-131) |
| Owned paths changed | 3, from the checker output of run 44104641784: `apps/api/src/platform/audit/capture.api.test.ts`, `apps/api/src/platform/routing/define-route.ts` (a type only), `apps/api/src/platform/validate/error-format.api.test.ts` (new) |
| Unowned paths changed | 31, all reviewed here: 13 files under `packages/shared/src/errors/catalogue/` (12 new) plus `catalogue.test.ts`; `apps/api/src/modules/index.generated.ts`; `tools/api/gen-module-registry{,.test}.ts`; `tests/generated/{error-catalogue.test,route-metadata,route-metadata.test}.ts`; `apps/{web,admin}/app/i18n/error-messages{,.test}.ts`; 6 locale files |
| Binding items checked | The TASK-036 card (WAVE-01); US-036 AT-US-036-01 to -06; DR-A26; api/README §3, §11 and §15 assertion 6; REQ-RBAC-007, REQ-RLS-013 with EC-A44 and AC-12, REQ-ORG-011, DR-A02, threat model T-14 and AC-26 (enumeration), NFR-SEC-009; D-TASK017-01 (3), D-ARCH-084; D-TASK036-01 to -03; the controls this PR relies on (PR9-SEC-07, PR11-SEC-09 item 6, PR20-SEC-12, PR32-SEC-03); the code review r1 on main (`0f3528e`, APPROVED_WITH_NITS) |
| Reviewer / date | security-analyst, 2026-11-18, round 1. **Static review only**, under the host rule of D-ORCH-131: no npm, Jest, type-check, build or Docker. Git object reads and `gh` ran in the main checkout. Nothing ran in the PR worktree and nothing was written there. Two things ran in the session scratchpad: a single-process Node text comparison (catalogue vs openapi.yaml vs README §11 vs DR-A26; it reads text and runs no PR code) and the record simulation (§9). Line numbers come from single-file reads at `fcdb7ac` |

## 1. Summary

For security, the change is mostly data: 79 catalogue entries and 6 locale blocks. It adds a client code-to-message-key map and test-side contract checks. The runtime error path is unchanged: `problem.ts`, `problem-handler.ts`, `classify.ts` and `validate.ts` are not touched.

- **No leak of internals.** The two new 5xx codes, DOCUMENT_INTEGRITY_FAILURE (500) and GATEWAY_UNAVAILABLE (503), get the generic detail. `buildProblem` forces it by status, not by code (`problem.ts:42-47`). All 6 5xx shared examples in openapi.yaml are generic too. The body stays a closed set: type, title, status, detail, instance, code, correlation_id and errors. AT-US-036-06 pins the exact key set of a 403 with `toEqual`. None of the README §11 internal-only names became an HTTP code, among them SSRF_BLOCKED, MISSING_TENANT_CONTEXT and PAYMENT_LIVE_KEY_FORBIDDEN (checked mechanically, §5 item 1).
- **No tenant-existence oracle in the catalogue.** NOT_FOUND still means "absent, soft-deleted or owned by another organisation, indistinguishably". AUTHZ_DENIED is decided at the permission gate before any lookup (DR-A08 order, README §3), so a 403 says nothing about a resource.
  - Two new codes do reveal ownership: QUOTE_ALREADY_CLAIMED (409) and INVITATION_EMAIL_MISMATCH (403). Both need a token of at least 128 bits (REQ-RLS-013, EC-A44, AC-12; REQ-ORG-011), so this is by design. Their texts in all 6 locale blocks name no address and no account.
  - INVALID_CREDENTIALS has one message in every locale block. ACCOUNT_DELAYED and ACCOUNT_LOCKED are not an existence oracle, because DR-A02 keeps counters for unknown identifiers too.
- **The client map is closed.** `errorMessageKey` maps only the catalogue's own keys (`Object.hasOwn`) and maps everything else to `errors.UNKNOWN`. A hostile `code` therefore cannot select another i18n key or a prototype member. The locale strings contain no interpolation, HTML or URL. The shared root that web and admin now import is browser-safe (code review V8).
- **Correlation id, logging, secrets.** The context middleware, the logger and the redaction are unchanged. The handler still logs only 5xx, with scalar fields. Gitleaks and Semgrep are green on the PR range. A manual scan of the diff found no credential-shaped value; the test strings are synthetic.
- **The open item is the `detail` field.** Since TASK-020 the 4xx `detail` has been the only free-text member of the problem body. This PR publishes the codes whose safety depends on every branch looking the same, and nothing pins `detail` for them (PR63-SEC-01). Three INFO items are forward-looking (PR63-SEC-02 to -04).

Findings: 0 Critical, 0 High, 0 Medium, 1 LOW, 3 INFO.

**Verdict: PASS_WITH_FOLLOW-UPS.**

## 2. Method

1. Read the full diff `origin/main...fcdb7ac` (34 paths). At `fcdb7ac` I read `app-error.ts`, `catalogue-entry.ts`, `catalogue/index.ts`, `problem.ts`, `problem-handler.ts`, `classify.ts`, `error-response.ts`, `validate.ts`, `map-db-error.ts` (codes and the DbError class), `mfa-gate.ts`, `authorise.ts` (the `refuse` path), `capture.ts` (header), the shared root `index.ts`, `uuidv7.ts`, `credentials.ts` and `gen-module-registry.ts`. Docs: api/README §3 and §11, DR-A26, REQ-AUTH-013/014, DR-A02, REQ-RLS-013 with EC-A44, T-14, and the TASK-036 card.
2. **Static parity, independent of the code review.** I extracted (code, status, title) from the 13 catalogue files, the `components/responses` examples of openapi.yaml, the README §11 table and the DR-A26 line. Results: 79 catalogue codes; 78 examples, all equal in status, title and derived `type`, with METHOD_NOT_ALLOWED as the declared framework-only exception; 79 README rows equal in status; 45/45 DR-A26 codes equal in status; every 5xx example detail is generic; 0 internal-only names published. **Control:** one status changed, one title changed and one internal-only code added gave 6 named problems. This agrees with code review V2 to V4.
3. **Producers of `detail`.** I grepped every production `new AppError(` and every `detail` in `apps/` and `packages/` at `fcdb7ac`: 20 constructions, none with a `detail`. I also listed the shared-example `detail` texts in openapi.yaml: 72 of 72 4xx examples are `<title>.`, and 6 of 6 5xx examples are generic.
4. **Who answers each 403.** Producers of AUTHZ_DENIED: `authorise.ts:42`, `:45`, `:110` (the permission gate, audited through `refuse`, `:57-66`), `mfa-gate.ts:17` and the data layer (`map-db-error.ts:104`, RLS write rejection).
5. **Classifier accept set before and after** (`classify.ts:54-61`): reasoned over the catalogue sizes (13 to 79) and the data layer's own list (`DB_PROBLEM_CODES`, `map-db-error.ts:17-25`). Not executed (host rule).
6. The locale files: all 6 `errors` blocks; a grep for `{{`, `<`, `http` and `$t(` in the added lines found 0 hits; the enumeration-sensitive codes read in en, es and fr.
7. Evidence: the step list and the checker output of lane A run 44104641784 (`gh run view --log`). The ci-gate checkout is the merge ref (`refs/remotes/pull/63/merge`), which matters for where this record is read (§9).
8. Cross-PR: changed-file intersections with `origin/main`, PR #61 (`14cdeed`), #64 (`90ef83f`) and #65 (`d3c2c16`).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR63-SEC-01 | The 4xx `detail` is free text, and nothing fixes it for the codes whose branches must be indistinguishable (NOT_FOUND, INVALID_CREDENTIALS, TOKEN_INVALID, TRACKING_NOT_FOUND, COUPON_INVALID, ACCOUNT_DELAYED/LOCKED). Nothing keeps request or third-party data out of it either. Latent: no production `AppError` passes a `detail` today | LOW | CWE-204, CWE-209 | A04 | `packages/shared/src/errors/app-error.ts:22-23`, `:60`; `apps/api/src/platform/errors/problem.ts:47`; `problem-handler.ts:120` | Items 1 to 3: this PR's fix cycle if one runs (lock `shared-errors`), else before TASK-052 merges. Item 4: the next holder of the `lint` lock, before TASK-052 / TASK-227 merge |
| PR63-SEC-02 | The DbError classifier is closed by the catalogue, not by the data layer's six codes. The catalogue grows from 13 to 79 codes, so a DbError with overwritten fields can now present 401 SESSION_REVOKED, 403 EMAIL_NOT_VERIFIED or 429 ACCOUNT_LOCKED | INFO | CWE-703 | A04 | `apps/api/src/platform/errors/classify.ts:54-61`; `apps/api/src/platform/db/map-db-error.ts:17-25` | The next touch of `platform/errors/classify.ts`, or this fix cycle if cheap |
| PR63-SEC-03 | Two producers of AUTHZ_DENIED are not the permission gate and write no PERMISSION_DENIED entry. One is the staff MFA gate stub: it says it uses AUTHZ_DENIED only because MFA_ENROLMENT_REQUIRED was not catalogued, and this PR catalogues it. The other is the RLS write rejection | INFO | CWE-393 | A04 | `apps/api/src/platform/mfa/mfa-gate.ts:4-6`, `:17`; `packages/shared/src/errors/catalogue/platform.ts:50-54`, `:60` | TASK-067 (owns the MFA gate); the comment fix at the next touch of `platform.ts` |
| PR63-SEC-04 | Forward requirements: the newly catalogued codes carry contract members the handler cannot emit yet. These are the extension members (`mfa_challenge_token`, a single-use secret; `current_etag`; `limit`; `blocking_conditions[]`; `prohibited_matches[]`) and `Retry-After` on the 429 codes and on 409 IDEMPOTENCY_IN_PROGRESS. Widening the handler must keep it closed | INFO | CWE-200 | A04 | `apps/api/src/platform/errors/problem.ts:40-53`; `classify.ts:71-75` | TASK-040, TASK-041, TASK-061, TASK-096 and TASK-103, whichever widens the handler first |

## 4. Finding details

### PR63-SEC-01 (LOW): the problem `detail` is unpinned for the indistinguishability codes

**Description.** `AppErrorOptions.detail` is documented as "client-safe English detail" (`app-error.ts:22-23`). Nothing enforces it. `AppError` stores whatever it gets (`:60`), and `buildProblem` copies it into every 4xx body (`problem.ts:47`, through `problem-handler.ts:120`). This PR completes the catalogue and publishes for module use the codes whose security property is that every branch answers the same:

- NOT_FOUND (`platform.ts:65`): missing, or another organisation's;
- INVALID_CREDENTIALS (`:35`): unknown email, wrong password, or a non-permitted account type or app;
- TOKEN_INVALID (`:21`): unknown, used or revoked;
- TRACKING_NOT_FOUND (`tracking.ts:8`);
- COUPON_INVALID (`pricing.ts:12`): "eligibility not disclosed";
- ACCOUNT_DELAYED and ACCOUNT_LOCKED (`platform.ts:109`, `:111`): unknown identifiers behave identically.

Suppose a service writes a branch-specific detail (`'No account with this email.'` on one branch only), or interpolates a stored value (`` `Invitation was sent to ${invitation.email}` ``, `` `Quote belongs to ${org.name}` ``). The first turns the code into an enumeration oracle (CWE-204, threat model T-14). The second sends another person's data to the caller (CWE-209).

Today nothing refuses either: no lint rule and no test. The PR's own fixture (`error-format.api.test.ts`, AT-US-036-01) shows the free-text form, with a harmless literal. At `fcdb7ac`, 0 of the 20 production `new AppError(...)` calls pass a `detail`, so the risk is latent. The contract never needs a custom detail for these codes: each of the 72 4xx shared examples uses `<title>.`, and the 6 5xx examples use the generic detail.

**Exploitability and impact.** It needs a later service to write such a detail, and code review may catch it. But the producers of these codes are exactly the coming identity, invitation, quote and tracking tasks (TASK-052 sign-in, TASK-227 invitations, TASK-146 quote claim, TASK-176 public tracking). AC-26 checks status and body equality on login, register and reset only. It does not cover invitations, tracking or coupons. Impact Medium (account enumeration, or third-party personal data in a response) x likelihood Low = LOW.

**Remediation (code level).**
1. `packages/shared/src/errors/catalogue-entry.ts`: add to `CatalogueEntry`
   ```ts
   /** Indistinguishability code: the body detail is always `<title>.`, whatever the thrown error carries (PR63-SEC-01). */
   readonly uniformDetail?: true;
   ```
   Set `uniformDetail: true` on NOT_FOUND, TRACKING_NOT_FOUND, INVALID_CREDENTIALS, TOKEN_INVALID, COUPON_INVALID, ACCOUNT_DELAYED, ACCOUNT_LOCKED and AUTHZ_DENIED.
2. `apps/api/src/platform/errors/problem.ts`, in `buildProblem` (read the entry as `CatalogueEntry`):
   ```ts
   const entry: CatalogueEntry = ERROR_CATALOGUE[input.code];
   const serverError = entry.status >= 500;
   const fixedDetail = serverError ? GENERIC_SERVER_DETAIL : entry.uniformDetail === true ? `${entry.title}.` : undefined;
   // ...
   detail: fixedDetail ?? input.detail ?? `${entry.title}.`,
   ```
   Apply the same rule to `this.detail` in the `AppError` constructor, so that `toJSON()` agrees with the body.
3. Tests, through the real problem handler:
   - `new AppError('NOT_FOUND', { detail: <random sentinel> })` and `new AppError('INVALID_CREDENTIALS', { detail: <sentinel> })` answer `Not found.` and `Invalid credentials.`, and the sentinel appears nowhere in the body;
   - a CONFLICT keeps its literal detail (the control);
   - a pin that the `uniformDetail` set equals the list in item 1, checked both ways.
4. The free-text half, in either form:
   - a `no-restricted-syntax` entry for production files in `eslint.config.mjs`: selector `NewExpression[callee.name='AppError'] Property[key.name='detail'][value.type!='Literal']`, message "a problem detail is a fixed English literal; never interpolate request or stored data (PR63-SEC-01)" (needs the `lint` lock);
   - or extend this PR's own production-source scan in `tests/generated/error-catalogue.test.ts` (it already reads every production file) to report a `detail:` whose value is not a plain quoted literal, with a seeded positive case.

**Verification.** The item 3 tests. The lint form also needs one negative fixture with `` detail: `x ${y}` `` that fails, and one with a literal that passes.

### PR63-SEC-02 (INFO): the classifier's accept set grows with the catalogue

`classifyDbError` (`classify.ts:54-61`) answers with any catalogue code whose catalogue status equals the DbError's own `status` field. The data layer itself only ever emits `DB_PROBLEM_CODES` (`map-db-error.ts:17-25`): AUTHZ_DENIED, NOT_FOUND, CONFLICT, SERVICE_UNAVAILABLE, INTERNAL_ERROR and AUDIT_WRITE_FAILED.

Before this PR the accept set was the 13 catalogued codes. It is now 79. Some overwritten-field shapes, of the kind `classify.test.ts` pins as fail-safe, are therefore accepted:
- `Object.assign(new DbError(...), { code: 'SESSION_REVOKED', status: 401 })` answers 401 SESSION_REVOKED, and the client signs the user out;
- `{ code: 'ACCOUNT_LOCKED', status: 429 }` is accepted;
- `{ code: 'EMAIL_NOT_VERIFIED', status: 403 }` is accepted.

This is reasoned from the code, not executed (host rule). There is no attacker path: it needs in-process code that overwrites a DbError's fields. It weakens, as defence in depth, the PR11-SEC-09 item 6 contract ("only its code and Retry-After reach the client").

**Fix.**
- Export `DB_PROBLEM_CODES` from `platform/db/index.ts`.
- In `classifyDbError`, refuse `!(DB_PROBLEM_CODES as readonly string[]).includes(code)` before the status comparison.
- Add `forge({ code: 'SESSION_REVOKED', status: 401 })` and `forge({ code: 'EMAIL_NOT_VERIFIED', status: 403 })` to the fail-safe cases.

### PR63-SEC-03 (INFO): AUTHZ_DENIED producers that are not the permission gate

This PR rewrites the AUTHZ_DENIED doc comment (`platform.ts:50-54`):
- before: "lacks the permission or the row-level scope … (incl. an RLS write rejection)";
- now (the README §11 text): "Caller lacks the route permission in the active organisation (PERMISSION_DENIED audited)".

Capture writes the DENIED entry only through `refuse` (`authorise.ts:57-66`). Two other producers answer the code without one:

- **(a) The staff MFA gate stub** (`mfa-gate.ts:17`). Its comment (`:4-6`) says it answers AUTHZ_DENIED rather than the contract's MFA_ENROLMENT_REQUIRED because that code "belongs to the auth module's catalogue, which the MFA task creates". This PR puts MFA_ENROLMENT_REQUIRED in the platform catalogue (`platform.ts:60`), so the stated reason is gone. Meanwhile an MFA-pending staff session is shown "You do not have permission to do this." The stub still fails closed (PR32-SEC-03 condition C3), which is the right direction.
- **(b) The RLS WITH CHECK rejection** (DbError 403, reason `RLS_WRITE_REJECTED`). It already raises the security event `rls_write_rejected` and is not a permission decision. That is acceptable, but the catalogue comment no longer mentions it.

**Fix.**
- (a) TASK-067 owns the gate (WAVE-01: "this task owns platform/auth/mfa-gate.ts"; the file is at `platform/mfa/mfa-gate.ts`). It should answer MFA_ENROLMENT_REQUIRED, fix the comment, and regenerate the RBAC matrix `deny-403-mfa` cells with it.
- (b) Add one clause to the AUTHZ_DENIED comment: "also the data layer's 403 RLS write rejection (security event rls_write_rejected, no PERMISSION_DENIED entry)".

### PR63-SEC-04 (INFO): the handler must stay closed when the contract members arrive

The catalogue now holds codes whose contract carries more than the handler can emit:

- **Extension members** (README §3, a closed set): `mfa_challenge_token` and `mfa_methods` on MFA_REQUIRED (the token is a 5-minute single-use secret), `current_etag` on CONCURRENCY_CONFLICT, `limit` on LIMIT_EXCEEDED, `blocking_conditions[]` on the checkout gate, `prohibited_matches[]` on ITEM_PROHIBITED.
- **`Retry-After`** on ACCOUNT_DELAYED, ACCOUNT_LOCKED, MFA_LOCKED, RATE_LIMITED, PAYMENT_ATTEMPTS_EXCEEDED and IDEMPOTENCY_IN_PROGRESS. Today `classifyAppError` keeps it only on a 503 (`classify.ts:71-75`).

`buildProblem` emits only code, detail and errors (`problem.ts:40-53`), so nothing can leak through an extension today. Conditions for the task that widens the handler:
1. A per-code closed allow-list of extension members in `buildProblem`, matching the README §3 table, never a spread of AppError's own properties. This keeps `cause` and any field a service attaches out of the body.
2. A one-time secret (`mfa_challenge_token`) never reaches a log line, an audit row or the idempotency store. The handler logs only 5xx today, so keep it that way and add a sentinel test. The problem stays `no-store` (`sendProblem`, `problem-handler.ts:101-107`).
3. `Retry-After` is widened per code, for the listed 429 and 409 codes, with the existing integer bound of 1 to 3600. It is never allowed for an arbitrary 4xx.

Owners: TASK-040 (idempotency, IDEMPOTENCY_IN_PROGRESS), TASK-041 (rate limit), TASK-061 (MFA challenge, `mfa_challenge_token`), TASK-096 (`current_etag`) and TASK-103 (lockout). Whichever widens the handler first carries conditions 1 to 3.

## 5. Verification of the claims

1. **Catalogue exactness** (method item 2): 0 differences, and the mutation control was caught. AT-US-036-05 pins the 45 DR-A26 statuses and the 79 published statuses. Code review R1-n7 notes that the pin lives in the same tree as the catalogue, so one PR can change both. I agree; it is low risk.
2. **AT-US-036-02** ("no request value in the body") holds by construction, not only by the test. `toIssues` emits a fixed message per sub-code (`validate.ts:91-97`), and the schemas are prepared with value-free templates (`SAFE_MESSAGES`). The pointer carries request keys, never values, and it is returned only to the sender.
3. **AT-US-036-06** goes through the real capture composition. The 403 body equals the closed key set, and the PERMISSION_DENIED entry has outcome DENIED.
4. **Assertion 6 moved from the mounted loop to every operation** (`route-metadata.ts`, `checkRouteMetadata`). This is strictly wider; no check was removed. The module half checks only declared lists (code review R1-m3, accepted).
5. **Generator.** Module folder names pass `^[a-z][a-z0-9-]*$` before they are written into TS source, so nothing can be injected into `index.generated.ts`. `--check` runs in lane A.
6. **Client bundle.** Only the two tests import `error-messages.ts` today. The shared root has no `node:` import (`uuidv7.ts` is declared browser-safe), and the catalogue it ships is public data. Code review §4 item 3 asks for a guard so that the shared root never re-exports `./queues` (PR #64, Joi). I support it: it is a bundle-content guard on the same import edge.

## 6. Earlier items

No earlier security item is bound to TASK-036. D-TASK017-01 (3), the catalogue membership deferred from PR #21, is closed by this PR: every `x-error-codes` entry of every operation is now checked (code review V5: 133 operations, 1,687 entries, 0 uncatalogued).

## 7. Sequencing and unions

- **`main`:** no path in common since the merge base, and the merge is clean.
- **PR #65 (TASK-037):** `OrganisationRuleError` carries `MEMBERSHIP_STATUS_NOT_WRITABLE`, which is not catalogued, and its codes are plain strings. The AT-US-036-04 scan does not see them. This is code review R1-m2 and its §4 item 2; I add only the security angle. When TASK-224/231 map these errors to problems, the mapped code must be an `ErrorCode`, and the `OrganisationRuleError` message must not become the `detail` (PR63-SEC-01 item 4 refuses that form).
- **PR #64 (TASK-035):** no overlap; see §5 item 6.
- **PR #61 (TASK-028):** no overlap. Its log-coverage test (D-ARCH-150) is not triggered, because this PR adds no table.

## 8. Proposed decision (for the orchestrator to log)

**D-SEC-PR63-01.** PR #63 (TASK-036) security r1 = PASS_WITH_FOLLOW-UPS at `fcdb7ac`. Findings: 0 Critical, 0 High, 0 Medium, 1 LOW, 3 INFO.
- **PR63-SEC-01 (LOW):** pin the problem detail of the indistinguishability codes, and keep data out of `detail`.
  - Items 1 to 3: this PR's fix cycle if one runs, else before TASK-052 merges.
  - Item 4: the next `lint` lock holder, before TASK-052 / TASK-227.
- **PR63-SEC-02 (INFO):** the DbError classifier is limited to `DB_PROBLEM_CODES`.
- **PR63-SEC-03 (INFO):** the MFA gate answers MFA_ENROLMENT_REQUIRED (TASK-067), and the AUTHZ_DENIED comment names the RLS producer.
- **PR63-SEC-04 (INFO):** conditions on the first task that adds problem extension members or a non-503 `Retry-After` (TASK-040/041/061/096/103).
- **Merge conditions (security):**
  - lane B PASS on the final head;
  - a lane A run in which lint, format, type-check, unit and build actually execute;
  - this record visible to ci-gate (§9);
  - any later commit that changes an owned path (`apps/api/src/platform/**`) needs a delta round naming the new head.

## 9. Record validation

- **Where the record is read.** This record is committed on `main`, not on the PR branch, because the PR worktree is reserved for the lane-B queue. The ci-gate job checks out the merge ref (`refs/remotes/pull/63/merge`, see the log of run 44104641784), and `check-security-owned-paths.mjs` reads records from that work tree. The record therefore satisfies the check on the **next `pull_request` event** after this commit, for example the lane-B evidence push. Re-running run 44104641784 does not work: it reuses merge ref `9d1fb41`, which was built before the record existed. If the orchestrator prefers the branch convention, the same file can be added verbatim to the evidence commit. Identical content on both sides merges cleanly.
- **Simulation.** I ran `main`'s checker in a shared, sparse clone over plumbing commits that imitate the merge ref: `main` plus this record, merged with the PR head. The results are below.

The checker is `main`'s `tools/ci/check-security-owned-paths.mjs`, unchanged since `538f0b0` (the tools ref of run 44104641784). It ran with `--base 538f0b0 --pr 63 --json`.

| Case | Scenario | Expected | Result |
|---|---|---|---|
| S1 | `main` (`0f3528e`) plus this record, merged with `fcdb7ac` (the shape of the next merge ref) | pass | pass: 3 owned paths, satisfied by this record |
| C0 | The same merge without the record | fail | fail ("missing") |
| C1 | This record with a FAIL verdict row | fail | fail |
| C2 | The head row naming a `main` commit instead of a PR commit | fail | fail |
| S3 | A lane-B evidence commit (docs only) on top of `fcdb7ac`, with the record on `main` | pass | pass |
| C4 | A commit after `fcdb7ac` that changes `define-route.ts` | fail | fail |
| C5 | The old merge-ref shape (`538f0b0` plus `fcdb7ac`, which a re-run of 44104641784 checks out) | fail | fail |

The record has exactly one head row and one verdict row. An over-approximating scan of this record with the 220 compilable rules of the pinned Gitleaks v8.30.1 config (keyword prefilter and rule regex, no entropy and no allowlists) found 0 hits. The runtime positive controls (a GitHub PAT shape and an AWS key id) were detected.

## 10. Verdict

No Critical, High or Medium finding. PR63-SEC-01 (LOW) is due in this PR's fix cycle, or before TASK-052 merges. PR63-SEC-02 to -04 are INFO, each with an owner. From security, the PR may merge at `fcdb7ac` once the merge conditions of §8 hold.

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open for the change. PR63-SEC-01 (LOW) is due in this PR's fix cycle, or before TASK-052 merges; PR63-SEC-02 to -04 are INFO with owners |
