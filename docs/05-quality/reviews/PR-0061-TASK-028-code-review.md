# Code review: PR #61, TASK-028 audit redaction, field classification registry and capture privacy wiring, round 1

Reviewer: code-reviewer (principal engineer). Head reviewed: `57faf1f` (full SHA `57faf1fd971c9bbb2a71f210fd147b1041d7cf06`, branch `feat/TASK-028-audit-redaction-field-classification-registry`); code head `e526b11` (`57faf1f` adds only the lane B evidence directory). Diff base: `git diff origin/main...57faf1f` (32 files; 24 non-evidence files), merge base `d173d8f`, main at `732ad20`.

Specs checked against the code:
- the TASK-028 card (`docs/04-plan/tasks/WAVE-00.md` §TASK-028: files, acceptance lines, DoD notes);
- US-091 AT-01..06 (`docs/01-requirements/stories/EPIC-04-audit-trail-viewer.md`) and the gherkin map rows;
- REQ-AUDIT-008/009, D-SEC-PR56-01 condition 1, D-TASK029-21, D-ARCH-141 (in-house UA parser), D-SEC-PR53-02 (no wall-clock bounds);
- ADR-0007 §Redaction and classification, §Privacy erasure and amendment 2; data-model §3.4 (`audit_entries`, `audit_pii_vault`, `data_subjects`), §4.6 C10, §10.4;
- the PR #42 R1-M1 precedent (write-capable `@platform/audit` exports and the `platform/audit-writer-allowlist` rule);
- CLAUDE.md §2 and §8–9.

The developer decisions D-TASK028-01..10 are not in `docs/sdlc/DECISIONS.md`. D-ORCH-126 says they are "as listed in the PR #61 body", but the body does not number them, and the code cites D-TASK028-03 and D-TASK028-04. See m3.

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The structure is sound. The registry is keyed by table/column with own-key lookups. The C10 check runs both
  ways (unclassified and stale) against the live schema of both lanes. Redaction runs inside the writer's snapshot walk,
  so the hash covers "[REDACTED]" (AT-05 proven). The vault is AES-256-GCM with a fresh 96-bit nonce and an AAD bound to
  token and key id. The UA output comes from closed tables plus digits only. startApi composes the privacy dependencies
  through AppDependencies -> defaultPipelineSlots -> createAuditCapture, and the D-TASK029-21 backstop still refuses.
  Lane A fast-lane is green and lane B is PASS; my full unit run is green (6,788 passed) with redaction/classification
  coverage at 100 % lines / 99.5 % branches; 30 of my 47 mutants are killed.
  Two MAJORs:
  - M1: the secret denylist fails open on standard spellings of REQ-AUDIT-008 secrets. `TOTPSecret`, `OTPSecret`,
    `APIToken`, `password2`, `cc_number`, `ccNumber`, `csc` and `otpauth_url` are all stored in clear, in an immutable
    table. The property test only feeds a hand-picked example list, and 4 denylist mutants survive.
  - M2: `createVaultTokeniser` (writes vault and data_subjects rows on a handed transaction) and
    `decryptVaultValue` / `auditKeyOf` (decrypt the PII vault) are exported from the `@platform/audit` root outside
    `AUDIT_WRITER_EXPORTS`. A module importing them is lint-clean (probed). This is the same class as PR #42 R1-M1.
  Five MINORs and six NITs.
```

## 1. What I verified myself (and what I did not)

### 1.1 Gates

| Check | Result |
|---|---|
| ESLint `--max-warnings 0` on the 23 changed `.ts` files (PR worktree, Node 24.22.3) | exit 0 |
| Prettier `--check` on the same files | clean |
| Full `unit` project with coverage over `packages/audit/src/**`, `packages/shared/src/classification/*`, `tools/db/classification.ts` (my run on the head; the path filters did not narrow the run, so it is the whole project) | **247 / 247 suites, 6,788 passed, 2 skipped, 0 failed** (372 s); coverage 100 % lines (2,957/2,957), 99.51 % branches (822/826). Below 100 % branches: `redaction/vault.ts` 97.95 %, `tools/db/classification.ts` 96.22 %. The card's ≥ 95 % on packages/audit holds. |
| Lane A run 44093229169 on `57faf1f` | fast-lane **success**: every step ran, including Lint, Format check, Type-check, Unit tests, Build and Lane B evidence. Two steps are skipped by design (base-ref negative fixtures, Semgrep self-test). `ci-gate` **fails only** on "Security-owned paths need a review record" (18 paths, no `PR-0061-*` security record yet). `security-integration` was **skipped** because `security_integration_due=false`: lane-scope makes it due only once `record_ok` (`tools/ci/lane-scope.mjs:45`). It must run green after the security record lands. |
| Lane B evidence `20261117T1302Z_e526b11` | bound to the code head, verdict PASS. Suites: api 173, catalog-c1-c14 106 (the four `[C10]` cases present), integration 339 (the four `composition.int.test.ts` cases present), rls-cross-tenant 126, unit 6,863. Merged coverage 99.1 % / 97.22 %. Not re-run (D-ORCH-125: reviewers do not start `quality:heavy`). |
| `git merge-tree --write-tree origin/main HEAD` | clean (tree `a64c284`). The file sets of `d173d8f..origin/main` and `d173d8f..HEAD` do not intersect. |

Not re-run by me: `npm run typecheck` (lane A's Type-check step on this head is green), the integration/catalog suites (lane B), and the full `npm run lint` (lane A green; I linted the changed files).

### 1.2 The untested combination with PR #57 (`fs-lock.ts`)

Main's `7db21b7` (PR #57) changed `tools/test-support/fs-lock.ts`, added `tools/test-support/lock-children.ts` and `tools/db/prisma-client-locked.cjs`, and added a `jest.config.ts` moduleNameMapper that loads `@platform/prisma/client` under the prisma-tree read lock. My ruling: **this does not need a lane B re-run before merge.**
- C10 reaches the lock only through `PlatformPostgres.template({ migrated: true })` → `withFileLock(PRISMA_TREE_LOCK, …)` (`prisma/tests/harness/postgres.ts:116`). That is the same call every existing catalog suite makes. PR #57 changed neither `prisma/tests/harness/**` nor the `withFileLock` / `PRISMA_TREE_LOCK` exports, and its own lane B (`20261117T0739Z_bfe5235`, D-ORCH-124) ran catalog-c1-c14 on the new lock.
- `composition.int.test.ts` loads the generated client through `apps/api` → after the merge it goes through the read-lock shim, exactly like every existing apps/api integration suite that #57's evidence covered. Its other new piece, the `db:bootstrap` child process, runs outside Jest and takes no lock.
- No new lock holder, no new lock order, no new file in either lock's tree. Lane A's `check-evidence` accepted the run (the evidence SHA stays an ancestor after a main merge).
If the orchestrator merges main into the branch, lane A on the merged head is enough; a lane B re-run is warranted only if that lane A voids the proof.

### 1.3 Probes and mutants

Scripts (scratchpad, `review/`): `PR-61-cr-mut.mjs` (archive copy of `e526b11` with a node_modules junction; each mutant runs the 11 affected unit suites, about 10 s), `PR-61-lint.mjs` (ESLint `lintText` on module and worker file paths), `pr61/deny.mts` (denylist probe).

| Mutant | Result | Mutant | Result |
|---|---|---|---|
| V1 drop `setAAD` | killed | D1 JWS shape → false | killed |
| V2 AAD without key id | **survived** | D2 drop `digest ` scheme | killed |
| V3 AAD column name changed | **survived** | D3 drop word `totp` | **survived** |
| V4 dedupe HMAC under the vault key | killed | D4 drop word `card` | **survived** |
| V5 every value → unattributed subject | killed | D5 drop compound `paymentmethod` | **survived** |
| V6 drop the decrypt key-id check | survived (equivalent: the AAD carries the key id, so GCM still fails) | D6 no split at digit→upper | **survived** |
| V7 **fixed all-zero nonce** | **survived** | D7 drop word `cookie` | killed |
| V8 AES key "≥ 32" instead of "= 32" | **survived** | E1/E2/E3 drop the writer's text, PII-text, key redaction | killed ×3 |
| V9 drop the HMAC key check | killed | E4 null under a secret key → `[REDACTED]` | survived (fail-safe over-redaction) |
| V10 never insert missing subjects | killed | R1–R5 redactRecord / redactSecrets branches | killed ×5 |
| V11 `ip.toUpperCase()` | survived (equivalent for IPv4) | U1 no 512 cut, U2 five-digit major | killed ×2 |
| P1 no local derivation, P2 key id dropped from the derivation | killed ×2 | U3 OS markers outside comments, U5 `,` not a separator, U6 classify repeated per character (quadratic) | **survived** ×3 |
| C1–C5 C10 rules, Prisma reader enum lists, exceptions | killed ×5 | U4 rank ties go to the later token | survived (equivalent in the table) |
| G1 own-key lookup, G2 PR8-SEC-10 PUB column | killed ×2 | A1/A2 pipeline drops `ipIndex` / `parseUserAgent` | survived in unit; killed by `composition.int.test.ts` (asserts `ip_hash` and `ua_parsed`) |
| A3 authenticate seam ignored, S1/S2 startApi privacy wiring | killed ×3 | | |

30 of 47 killed. Equivalent or fail-safe: V6, V11, E4, U4. Covered only by lane B: A1, A2. Real test gaps: V2, V3, V7, V8 (m4), D3–D6 (M1) and U3, U5, U6 (n5).

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `packages/audit/src/redaction/denylist.ts:106-131` (`keyWords`, `isSecretKey`), `:19-70` (lists); test `writer-redaction.test.ts:64-80`, `redact.test.ts:101-138` | The denylist misses standard spellings of REQ-AUDIT-008 secrets (probe `pr61/deny.mts`). (a) `keyWords` splits only at lower/digit→upper, so an acronym followed by a word is one word: `TOTPSecret`→`totpsecret`, `OTPSecret`, `APIToken`, `JWTSecret` are not redacted. (b) Letters and digits are never split, so `password2` (Django's confirmation field), `token1` and `secret2` are not redacted. (c) REQ-named card and TOTP fields are absent: `cc_number`, `ccNumber`, `csc`, `otpauth_url` / `otpauthUrl` / `provisioning_uri` (which carry the TOTP secret), `passcode`. (d) The property test (AT-US-091-02) draws keys only from the developer's own `SECRET_KEY_EXAMPLES`, and every list entry is redundant with another, so dropping `totp`, `card` or `paymentmethod`, or the digit split, keeps the suite green (D3–D6). This matters because `audit_entries` is immutable, hash-chained and archived to Object Lock: a secret written in clear can never be removed, and the PR body claims redaction "whatever the caller passes". | Split at the acronym boundary (upper followed by upper+lower: `APIToken` → `api`,`token`) and at letter↔digit boundaries, in the same single pass (no regex). Add `passcode`, `csc` and `cvn` to the words, and `otpauth`, `ccnumber` and `provisioninguri` to the compounds. Do not add a bare `code` (it would wipe `details.code` problem codes); record that choice. Replace the hand list in the property test with generated spellings of every word and compound (snake, camel, kebab, UPPER, acronym-camel, digit suffix, prefixed by another word), so every list entry has a case that only it catches. Re-run D3–D6: each must die. |
| R1-M2 | MAJOR | `packages/audit/src/index.ts:75,85-92`; `eslint.config.mjs:174` (`AUDIT_WRITER_EXPORTS`) | The new value exports escape `platform/audit-writer-allowlist`. `createVaultTokeniser(...).tokenise(db, values)` INSERTs `data_subjects` and `audit_pii_vault` rows on a handed transaction. `createAuditPrivacy` returns that tokeniser. `decryptVaultValue` + `auditKeyOf` decrypt the vault. Lint probe (`PR-61-lint.mjs`): from `apps/api/src/modules/<m>/service/x.ts` and `apps/worker/src/jobs/x.ts`, importing `createVaultTokeniser`, `createAuditPrivacy`, `decryptVaultValue` or `auditKeyOf` is CLEAN, while the controls (`createAuditWriter`, `createPrismaAuditStore`) are flagged. ADR-0007 §Privacy erasure: "Vault reads are themselves SENSITIVE views (audited) and allowed only to `audit:read` holders". A feature module could decrypt outside the audited viewer, or plant vault rows outside the writer contract. Same class as PR #42 R1-M1 (MAJOR there). | Add `createVaultTokeniser` and `createAuditPrivacy` to `AUDIT_WRITER_EXPORTS`, and exempt the two composition roots by exact path (`apps/api/src/start-api.ts`, and later the worker's). Put `decryptVaultValue` and `auditKeyOf` under a narrower decrypt allow-list: the future viewer module (`apps/api/src/modules/audit/**`, TASK-073) and tests. Either a second rule option or an `@platform/audit/vault` subpath with a boundaries policy is fine. Add negative fixtures for each export (module, worker job, allow-listed module importing the decrypt pair) and positive controls. |
| R1-m1 | MINOR | `packages/audit/src/redaction/denylist.ts:133-142` (`isSecretText`) | Secret-shaped text whatever its key: `"Bearer\tx"`, `" Bearer x"`, `"Authorization: Bearer x"`, `"otpauth://totp/…?secret=…"`, a PEM `-----BEGIN … PRIVATE KEY-----` block and `"eyJ…..sig"` (empty payload) all pass in clear (probe). This is the backstop for values under innocuous keys (`note`, `raw`). | In one linear pass: skip leading whitespace; accept any whitespace after the scheme; add the `otpauth://` prefix and the `-----BEGIN` + `PRIVATE KEY` marker. Pin each case with a unit test. |
| R1-m2 | MINOR | US-091 AT-06; `docs/05-quality/tests/gherkin-test-map.md:451` | AT-US-091-06 ("the viewer shows [REDACTED]; the API never returns the raw value to any role", suite `rbac-matrix`) has no test and no routed owner. The card requires all six IDs in test titles, and TASK-028 "completes" US-091. It cannot be tested before the viewer exists. | Record a decision routing AT-US-091-06 to TASK-073 (viewer API, US-097/098), add the line to the TASK-073 card, and keep US-091 out of "complete" in traceability until it lands. A test is not required in this PR. |
| R1-m3 | MINOR | `packages/shared/src/classification/registry.ts:14-17,116-128`; `packages/audit/src/redaction/vault.ts:16-18,40` | These deviations from the accepted specs have no logged decision: (a) `ip_token`, `user_agent_token` and `reason_token` are INT; data-model §3.4 says "PER (token)". The C10 SYSTEM-no-PII rule passes only because of that change (D-TASK028-03). (b) Values without a subject belong to `{kind: 'USER', refId: ANONYMOUS_ACTOR_ID}` (D-TASK028-04). Guest IPs and UAs therefore sit under one never-erased subject, and the vault is insert-only and excluded from archives, so retention removes nothing. No owner is named for that retention. (c) ADR-0007 places the registry in `packages/audit/classification.ts` and says it "feeds the Pino redaction list"; data-model L4300 says the same. Neither is delivered or ruled. | Log D-TASK028-01..10 by number in DECISIONS.md. Get an architect ruling and amend data-model §3.4 (token-column class, C10 exception text), §1.6/§3.4 (anonymous subject and its retention owner) and ADR-0007 (registry home, Pino feed or its owner task). Merge condition, not a code change. |
| R1-m4 | MINOR | `packages/audit/src/redaction/vault.test.ts:88-116,169-176` | The crypto tests cannot see format or nonce regressions. (a) No known-answer AAD: encrypt and decrypt share `vaultAad`, so changing the AAD layout (V2, V3) passes. The integration test decrypts with the same function. The re-encrypt job, the viewer and the erasure checks depend on this format for years (data-model §10.4). (b) **A fixed all-zero nonce passes (V7).** "Fresh nonces" compares whole ciphertexts, and those differ through the tag (the AAD differs per token) even when the nonce is reused. GCM nonce reuse is catastrophic. (c) A 33-byte AES key passes construction (V8) and fails per request instead of at boot. | (a) Decrypt one row with `createDecipheriv` and an AAD built literally as `'["audit_pii_vault","ciphertext","<token>","vault-v1"]'`. (b) Assert that the first 12 bytes of two ciphertexts differ. (c) Add a 33-byte key case. Tag the swap case `[SEC-TC-49]`. |
| R1-m5 | MINOR | `apps/api/src/platform/audit/composition.int.test.ts:315-320` | The "no personal value in clear" assertion checks only the UA sentinel. The IP (`127.0.0.1`) is not asserted absent from the row; `ip_coarse` is `127.0.0.0`, so the check is cheap and meaningful. SEC-TC-19 (US-091) is not tagged anywhere. | Assert `JSON.stringify(entry)` does not contain `127.0.0.1`, and tag the case `[SEC-TC-19]` (partial: the `[ERASED]` half belongs to TASK-073). |
| R1-n1 | NIT | `apps/api/src/start-api.test.ts:424` | `/-vd+$/` should be `/-v\d+$/` (the `purpose` of the fake key is the key id). Unused today. | Fix the regex. |
| R1-n2 | NIT | `tools/db/classification.ts:75-76` | The Prisma reader ignores `@@schema(...)`. A future `platform`-schema model would key as bare `x` in the completeness check and as `platform.x` in C10. That fails closed, but the cause would be confusing. | Read `@@schema` and apply `registryTableName`, or document the gap. |
| R1-n3 | NIT | `packages/audit/src/redaction/privacy.ts:211-216` | The local-only key derivation is the first consumer of `local-only-*` key material. The next one (MFA, outbox token encryption) will need the same rule. Watchlist PR #5 m6 asks for one derivation. | Move `auditKeyOf`'s derivation into `@platform/config` (for example a `KeyVersion` method) when the second consumer lands; note the owner. |
| R1-n4 | NIT | `apps/api/src/app.ts:100-105` | `AppDependencies.authenticate` is a production-interface test seam. It is narrow and `startApi` never sets it (pinned), but nothing marks it for retirement. | JSDoc `@internal` plus "retire with TASK-052" in the TASK-052 card. |
| R1-n5 | NIT | `packages/audit/src/redaction/user-agent.test.ts:100-112` | The "exact step bound" counts the scanner's own steps: the adversarial cases assert `steps === 512 + words`, where `words` comes from the same function, and the per-word classify work is not counted (U6, a quadratic classify, passes). U3 (OS markers outside comments) and U5 (`,` separator) are unpinned. The 512 cut makes the real risk nil. | Assert literal counts per case (512, 768, 513, 512, …). Count the classified word length in `steps`, or say in the JSDoc that classify is O(word). Add one case each for U3 and U5. |
| R1-n6 | NIT | `packages/audit/src/redaction/redact.ts:235-239` | `redactRecord(entity, …)` takes a registry table name (`address_book_entries`), while the audit descriptor's entity is `address`. TASK-031's diff builder needs a mapping. A wrong name fails closed (UnclassifiedFieldError), so this is safe. | Say "table name, not the descriptor entity" in the JSDoc. |

## 3. Requirement and AC trace

| Card line | Status |
|---|---|
| US-091 AT-01 (denylisted keys redacted, no raw value in any column) | Tested (`writer-redaction.test.ts`, `redact.test.ts`). Under-matching per **M1**. |
| AT-02 (property, random depth) | Tested on the example list only (**M1** d). |
| AT-03 (classification tags) | Tested via `redactRecord` → `PiiValue.classification` → vault row. |
| AT-04 (unclassified field fails the build) | Tested: Prisma-schema completeness over every `*.prisma` file, a planted model, and `UnclassifiedFieldError` naming entity and field. |
| AT-05 (redaction before hashing) | Tested: the hash of the raw entry equals the hash of the redacted entry, with a non-secret control. |
| AT-06 (viewer never returns raw) | **Missing** (m2). |
| C10 against the live schema of both lanes; SYSTEM-no-PII; §10.4 key-id siblings | Done (catalog suite, 4 cases, lane B). The rules are proven on planted data and C1–C5 mutants die. |
| PR8-SEC-10 (authz tables INT except the four PUB columns) | Done and pinned (G2 killed). |
| Audit capture composition (startApi → AppDependencies → defaultPipelineSlots → createAuditCapture; the 403 entry has vault tokens, `ip_hash` and `ua_parsed`; the audited fixture route; the backstop still refuses with exit 78) | Done (`composition.int.test.ts`, production `startApi`, only the authentication slot replaced; lane B). `pipeline.ts` remains the single composition point. |
| UA parser (in-house, no dependency, ≤ 512 characters, closed family table, digits only, null for unknown, exact step bound) | Done. The output is closed by construction (fast-check over 700-character binary strings). The step bound is a proxy (n5). |
| Coverage ≥ 95/95 on packages/audit | Holds (lines 100 %, branches 99.5 % over the changed scope; lane B merged 99.1 / 97.2). |
| No wall-clock bounds | Holds. The only timers are the child-process deadline and Jest budgets. |

## 4. Deviation rulings

- **Audit token columns INTERNAL (D-TASK028-03):** acceptable on the merits. A UUIDv7 token is a pseudonymous reference whose value disappears with erasure, and keeping `audit_entries` free of PER columns lets C10's SYSTEM rule hold as written. It contradicts data-model §3.4, though, so it needs the architect's amendment (m3). The registry must not later drive "INT is loggable" decisions for these columns without that ruling.
- **ANONYMOUS actor as the data subject (D-TASK028-04):** acceptable as the M0 mechanism (`subject_id` is NOT NULL, and an anonymous request has no person). The retention owner is missing (m3).
- **The writer applies the denylist during the snapshot walk:** correct placement. Each node is read once, nothing under a secret key is visited, the hash covers the marker, and a secret-shaped `PiiValue` is never tokenised. The defects are in the matcher (M1, m1), not the placement.
- **`AppDependencies.authenticate` test seam:** accepted. The capture under it is still composed from the dependencies, and the A3 mutant dies (n4).
- **Composition integration test bootstrapping through the CLI child process:** accepted. It is closer to the Compose migrate job than the harness, and it does not touch the prisma-tree lock (§1.2).
- **Local-only key derivation:** correct. SHA-256 over a fixed context, the key id and the marker gives 32 bytes, separated per key id. It is reachable only for `local-only-*` material, which the config's placeholder guard refuses in staging and production. Nothing derived is logged (n3 for its home).

## 5. Merge conditions

1. Fix M1 and M2 with the mutants and fixtures named above (D3–D6 must die; the lint probe must report all four exports outside their allow-lists). Fix m1, m4 and m5 in this PR. Route m2 and m3 by decision.
2. D-TASK028-01..10 logged by number in DECISIONS.md, with the architect's ruling on m3 (a)–(c).
3. New lane B evidence on the fix head, through the serial queue (D-ORCH-125). Lane A green on the final head, including `security-integration`, which becomes due once the security record exists.
4. A security-analyst record naming the final head.
5. Round 2 is a delta review: re-run `PR-61-cr-mut.mjs` and `PR-61-lint.mjs`, plus the new denylist spellings.

## 6. Security flags (for security-analyst)

- M1 (secrets in clear in an immutable store) and m1 (text shapes).
- M2: vault decrypt and vault write reachable from any module (CWE-284; ADR-0007 "vault reads are audited views").
- m3 (b): guest IPs and UAs under a never-erased subject, with no retention owner (GDPR/DPDP storage limitation).
- m4 (b): the nonce uniqueness of AES-GCM is not pinned by any test.
- The decrypt path supports one key version. `AUDIT_VAULT_KEY_PREVIOUS` dual-read is not built (expected with TASK-073 or the re-encrypt job).
- `AppDependencies.authenticate`: a production-reachable slot override (n4).

## 7. Good patterns worth keeping

- Redaction inside the single snapshot walk: no second read of caller data, and the marker is part of the hashed content.
- Own-key registry lookups, and C10 two-way plus planted-live-list cases (dropped sibling, new column) in the catalog suite itself.
- A UA output assembled only from closed tables and digits, with a fast-check property asserting membership.
- The production composition proven end to end with `startApi`, real config keys, a decrypted vault and an HMAC-checked `ip_hash`, plus the backstop exit 78 in the same suite.
- Fail-fast key validation at boot, with no key material in messages.
