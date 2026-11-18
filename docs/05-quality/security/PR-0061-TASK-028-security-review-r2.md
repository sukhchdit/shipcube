# PR-0061: TASK-028 audit redaction, field classification registry and capture privacy wiring, security review round 2

| Field | Value |
|---|---|
| PR | #61, https://github.com/sukhchdit/shipcube/pull/61, branch `feat/TASK-028-audit-redaction-field-classification-registry` |
| Head | d51b42b3509a78a43017caa0b84c10633549b349 |
| Round | 2 (delta). Round 1 is `docs/05-quality/security/PR-0061-TASK-028-security-review.md` on the PR branch (`18cd325`, head row `57faf1f`). This round is a separate file on main because the round-1 file exists only on the branch: an append to the same path on main is an add/add conflict, and GitHub then cannot build the merge ref (simulated with `git merge-tree`: exit 1 on that path). The code review round 2 uses the same placement |
| Delta reviewed | `14cdeed..d51b42b`: `1b0b18e` (fc1 part 1), `b0c5fe6` (fc1 part 2), 39 files; `d51b42b` merges `origin/main` `538f0b0` with an empty `--remerge-diff` (0 lines), and its tree equals `git merge-tree --write-tree b0c5fe6 538f0b0`. Tip `c39a993` is evidence only (8 files under `docs/05-quality/tests/runs/20261118T1255Z_d51b42b/`) |
| Merge base | `538f0b0` (`origin/main` was at `d76ac9e` when this round was written; `783522a..d76ac9e` is docs only) |
| Lane B evidence | `20261118T1255Z_d51b42b`, profile `pr`, verdict PASS: `api` 173, `catalog-c1-c14` 106, `integration` 339, `rls-cross-tenant` 126, `unit` 7,231 (2 skipped); merged coverage 99.12 % lines, 97.24 % branches. The junit carries the fix-cycle cases (D-ARCH-149/150, the live-mode seam refusal, exit 78 on a malformed key, PR61-SEC-02/05/06/09/10, the generated spellings). The orchestrator reports the queue's gitleaks-full step green; it is not part of the committed run directory |
| Lane A evidence | None yet: the fix cycle is not pushed (`origin` at `14cdeed`). Merge condition 1 below |
| Code review twin | Round 2 `docs/05-quality/reviews/PR-0061-TASK-028-code-review-r2.md` on main (`fa5432b`), APPROVED_WITH_NITS. Its R2-m1, R2-n1 and R2-n5 overlap this round (§5) |
| Owned paths changed | 34 (main's checker, `--base 538f0b0 --head c39a993`): the 18 of round 1, plus `apps/api/src/platform/audit/descriptor-runtime{,.test}.ts`, `eslint.config.mjs`, `packages/audit/src/network{,.test}.ts`, `packages/audit/src/redaction/{denylist.test,tests/spellings}.ts`, the 8 lint fixtures under `tests/fixtures/lint/rules/audit-writer-allowlist/` and `tools/lint/negative-fixtures.test.ts` |
| Binding items checked | D-SEC-PR61-01; D-ORCH-COORD-02 (PR61-SEC-09/10); D-ARCH-148, -149, -150 and D-ORCH-129; D-TASK028-01..17; D-ORCH-127; D-ORCH-133 local rewrite under the three conditions of D-SEC-PR64-02; D-ORCH-134 |
| Reviewer / date | security-analyst, 2026-11-18, round 2. Host rule (D-ORCH-125 amendment): no npm, Jest, typecheck, build or Docker. Git object reads and the record checker ran in the main checkout and a `--shared` scratch clone. Probes ran in the session scratchpad on `git archive` extracts of `d51b42b` and `14cdeed` (the round-1 code as the positive control), loaded through a type-stripping resolve hook, with random sentinels that are never printed. One read-only `ESLint#lintText` run loaded the configuration of the `Shipqube-TASK-028` worktree, which is clean at `d51b42b` (verified before and after). The evidence worktree `Shipqube-TASK-028-evidence` was not touched |

## R2.1 Summary

The fix cycle closes every round-1 and round-1b item that belongs to this PR:
- **Redaction.** 98 of 100 probed key spellings are now redacted through the real writer; 81 leaked at the round-1 code. All 19 credential value shapes are redacted (2 before). All 4 round-1 record shapes are redacted.
- **Exports.** The vault exports are confined to exact allow-lists (23 of 23 lint cases as intended).
- **Monthly subject and actor-owned filter values (D-ARCH-149).** Present and correct.
- **Personal values and reasons.** No longer vault a credential they contain (PR61-SEC-09).
- **IPv6.** Canonicalised to RFC 5952.
- **C10.** Pins the class of every §10.4 column (PR61-SEC-10).

The UA parser, the vault cryptography and the `local-only-*` gate hold as in round 1.

The local rewrite of the never-pushed commits meets all three D-SEC-PR64-02 conditions. Gitleaks emulation over the lane A range finds nothing, and the pre-rewrite range is the positive control (§R2.4).

Two new items:
- **PR61-SEC-11 (LOW):** a credential written as a `key=value` pair inside a string (form bodies, JSON or cookie text) and two record shapes are still kept by the audit, although the log hides them.
- **PR61-SEC-12 (INFO):** IPv4-mapped addresses not spelled `::ffff:a.b.c.d` are not unmapped.

Findings this round: 0 Critical, 0 High, 0 Medium, 1 LOW (new), 1 INFO (new).

Open from earlier rounds:
- PR61-SEC-04 (LOW, CODEOWNERS, devops);
- the routed parts of PR61-SEC-03 and PR61-SEC-08 (EPIC-B-413 / M5 runbook);
- the opaque-token residual of PR61-SEC-05.

**Verdict: PASS_WITH_FOLLOW-UPS.**

## R2.2 Method and probe map

Session B's numbering (D-ORCH-COORD-02) maps to this round as follows.

| Probe | What | Script |
|---|---|---|
| P2 (keys and records) | 100 keys at the top level and nested at `request.headers[0].x.<key>`, plus 12 record shapes, all through `prepareEntry` → `complete()`. A sentinel in the row draft is a leak. Each key is also classified by the log's `isSensitiveKey` | `p-r2.mjs` |
| P2 (values) | 29 values under a neutral key: the 19 round-1 shapes plus 10 new forms | `p-r2.mjs` |
| P2b (differential) | The residual forms against the log's `redactString` and `redactValue`, 12 business values, and a candidate predicate validated on both sets | `p-r2b.mjs` |
| P3 | 300,000 fuzzed user-agent headers (closedness, writer shape, step bound `3·min(len,512)+1`); time per call at 1 kB and 1 MB; real headers including `HeadlessChrome` | `p3p4.mjs` |
| P4 (vault) | Subject statements over a recording fake port, sorted insert, the monthly subject row, dedupe HMAC, nonce, five AAD swap/tamper cases, key-size checks, `local-only-*` derivation, key bytes in `util.inspect`/JSON | `p3p4.mjs` |
| P4 (lint, session B's name) | 26 virtual files against the real `eslint.config.mjs` of the code head, with a positive control | `p5-lint.mjs` |
| Gitleaks | v8.30.1 default rules (221, all compiled) and the repo allowlists, over first-parent patches | `gl-emul.mjs` |
| Record simulation | Main's `check-security-owned-paths.mjs` over plumbing merge refs | §R2.6 |

Each redaction probe ran on the head and the round-1 extract, so every "redacted" result has a "leaked" control. Three round-1 value labels (`JWS`, `JWS in URL`, `pi secret`) split the sentinel when building the shape. For those I report the `isSecretText` decision instead, which flagged them on the head and missed the last two at round 1.

## R2.3 Status of PR61-SEC-01..10

| ID | Round-2 status | Evidence |
|---|---|---|
| PR61-SEC-01 (MEDIUM) | **Closed** | Keys: 98/100 redacted on the head, 19/100 at round 1, 74/100 by the log. Every key the log redacts is now redacted by the audit too; the two misses (`kek`, `dek`) are missed by both (PR61-SEC-11). Values: 19/19 shapes flagged (round 1: 2/19). Records: `{name,value}`, `[name,value]`, `{key,value}` and `{header,value}` redacted. The AT-US-091-02 property no longer draws from the module's own examples: `tests/spellings.ts` generates spellings from an independent list. `isSecretText` stays linear: 1 MiB adversarial inputs take 36-116 ms, and each 4× and 8× growth step takes 4.4-4.8× and 7.3-8.9× the time. What remains is a narrower class (PR61-SEC-11) |
| PR61-SEC-02 (LOW) | **Closed** | Lint, 23 of 23 direct-import cases as intended. Feature modules and worker jobs are refused for all four exports, including dynamic `import()`. `start-api.ts` takes only tokeniser and privacy. The viewer module (`modules/audit/**`) takes only decrypt and keyOf. Writer allow-list files (identity, `platform/audit`, worker processors) take the writer and tokeniser exports but not decrypt. `packages/audit` is free. The negative fixtures pin it in lane A. Residuals (not new IDs): a re-export of decrypt from the viewer module can be imported lint-clean by another module through a relative path *today*, which supports code review R2-n5 (TASK-073); and a test-folder helper re-export is lint-clean, the known PR60-SEC-01 class (TASK-283) |
| PR61-SEC-03 (LOW) | **Closed for this PR; rest routed** | D-ARCH-149 code part 1: `filterSummary(query, subject)` gets the actor for an authenticated request (code read; unit case in the lane B junit). Code part 2: `unattributedSubject(at)` gives `01a19467-e800-7000-8000-000000000002` for November 2026, the same id at 30 November 23:59:59.999 UTC, and `01a22ee6-b000-…` for December. One subject row per call (P4). A non-finite clock yields a non-UUID and fails closed at the `::uuid[]` cast. Routed by D-ARCH-149 / D-ORCH-129: retention, "no revival" and erasure by value to EPIC-B-413 (a G4 precondition); `API_KEY` actors to EPIC-B-303 |
| PR61-SEC-04 (LOW) | **Open** | `.github/CODEOWNERS` on main and at `c39a993` still has no line for `packages/shared/src/classification/`, `apps/api/src/{app,start-api}.ts` or `packages/config/src/placeholders.ts`. It now also needs `packages/shared/src/logging/string-redaction.ts`: the audit denylist delegates to its `isSensitiveKey` and `hasCredentialShape`, so a later loosening of the log matcher would loosen the immutable trail without a security record. Owner: devops-engineer, with the PR48-SEC-02 activation PR |
| PR61-SEC-05 (INFO) | **Closed (shapes); residual routed** | `prepareEntry` refuses a credential-shaped `entityId` (JWS, `sk_live_…`) as INVALID_ENTRY, and `isAuditEntityId` returns false for them, so the capture stores `null`. An opaque random token is undetectable by shape and passes, as expected. The route-metadata rule from round 1 (an `auditEntityId` never reads a secret-named parameter) is not in this PR → TASK-031 / route reviews |
| PR61-SEC-06 (INFO) | **Closed** | `2001:db8::1`, `2001:0db8:0000:…:0001` and `2001:DB8:0:0:0:0:0:1` canonicalise alike; the longest-run and tie rules and the zone strip are correct. Residual: PR61-SEC-12 |
| PR61-SEC-07 (INFO) | **Closed** | D-ARCH-148. Data-model §3.4 on main reads "INT (token)" for the three columns, and the registry header cites the ruling. D-TASK028-01..17 are logged |
| PR61-SEC-08 (INFO) | **Closed (routed)** | D-ARCH-149: destroying the retired `AUDIT_INDEX_KEY` version 90 days after the yearly rotation is a step of the M5 rotation runbook. That bounds `ip_hash` enumeration to about 15 months |
| PR61-SEC-09 (LOW, r1b) | **Closed** | A PERSONAL object `{ name, password, extra: { auth: 'Bearer …' } }` through `redactRecord` → the writer: the vault text holds neither secret and keeps the name. A reason containing `Bearer …` is tokenised as `[REDACTED]`. A reason in plain prose ("my password is …") is still vaulted. That is expected: the vault is encrypted and erasable |
| PR61-SEC-10 (INFO, r1b) | **Closed** | `KEY_ID_SIBLINGS` carries a class per row, and C10 reports a mismatch. Checked against data-model §3 rows: SEC for `mfa_totp`, `mfa_enrolment_codes`, `login_attempt_counters` and the vault pair; INT for `ip_hash` and the tracking HMAC; PER for `response_body`; SPER for `value_ciphertext`. `mfa_challenges.ip_prefix_hmac` and `carrier_accounts.credentials_ciphertext` have no class row in §3 and are pinned SECRET (D-TASK028-14, the safe direction) |

The r1b additions are closed too: the audit now redacts `cc_number`, `ccNumber`, `codes`, `mfa_seed`, `pw`, `whsec`, `csrf`, `privateJwk`, `jwk`, `proof` and `session`, plus the 14 platform names. Both P2 runs confirm it.

## R2.4 Requested checks

**D-ORCH-133 local rewrite, against the three conditions of D-SEC-PR64-02:**
1. The backup branch `task028-fc1-pre-gitleaks-backup` (`d54880a`) is local. `git ls-remote --heads origin` lists no `pre-gitleaks` ref. It must be deleted after merge.
2. After a fetch, `git branch -r --contains` is empty for the old head `d54880a` and for `1b0b18e`, `b0c5fe6`, `d51b42b` and `c39a993`. `origin` is at `14cdeed`, the last pushed commit, which the rewrite did not change.
3. The literal was a synthetic PEM header around a test sentinel, not a key, so nothing needs rotating. `git diff d54880a d51b42b` shows only the two test files, where `pemBlock()` now builds the header at run time. Every other path is identical.

**Gitleaks.** Emulation of v8.30.1 (221 default rules plus the repo allowlists, first-parent added lines per file):

| Range | Fragments | Findings |
|---|---|---|
| Lane A range `538f0b0..c39a993` | 160 | 0 |
| `14cdeed..c39a993` | 126 | 0 |
| Pre-rewrite `14cdeed..d54880a` (positive control) | 118 | 1 (`private-key` in `5924554:packages/audit/src/redaction/denylist.test.ts`) |

Note, no ID: the committed `unit.junit.xml` keeps one test title with a PEM BEGIN line, a 25-character sentinel and the END line, because Jest's `%s` interpolates the generated value. The `private-key` rule needs 64 or more characters between the markers, and this title has 35, so it does not fire. The margin is the only protection, though. Lane B's gitleaks-full runs before the evidence commit exists, so only lane A's range scan ever reads that file. Prefer `it.each` titles that name the shape, not the value.

**UA parser (P3):**
- 0 outputs outside the closed grammar, 0 rejected by `isAuditUaParsed` and 0 over `3n+1` (maximum 1,025 steps, 3.0 steps per character).
- 3-6 µs per call at both 1 kB and 1 MB.
- `HeadlessChrome/142` now gives `null`; Edge, iOS Safari, Firefox and curl parse as in round 1.

The step count still does not see work repeated inside `classify` (code review R2-n3); the 512-character cut makes that harmless.

**Vault and keys (P4).** The subject insert is sorted by `(kind, ref_id)` and creates one monthly subject row. Dedupe HMAC and nonce behave as in round 1. Five AAD swap/tamper cases are refused and the own row decrypts. 16-byte AES, HMAC and index keys are refused. The `local-only-*` derivation is deterministic, per key id and 32 bytes. No key bytes appear in `util.inspect(showHidden)` or JSON of the composed object.

**Composition.**
- A malformed audit key now exits 78 with `api.audit_keys_rejected` and only the error class name.
- `createApp` throws `AuthenticateSeamError` when the seam is set in `live` mode. The error is unmapped by `bootFailureOf`, so `startApi` re-raises it, which fails closed.
- No new log line carries a value.

**Union with main.** `origin/main` (`783522a`) changed 101 code files since `538f0b0`:
- none of them overlaps this PR's files;
- no Prisma schema or migration changed, so C10 and the Prisma-schema completeness test meet no new table;
- there is no new importer of `@platform/audit`;
- `git merge-tree origin/main c39a993` is clean.

## R2.5 New findings

| ID | Title | Severity | CWE | OWASP | Location | Owner |
|---|---|---|---|---|---|---|
| PR61-SEC-11 | The audit keeps credential `key=value` pairs inside a string, two record shapes and two key names that the log hides (or that neither hides) | LOW | CWE-212 | A09:2021 | `packages/audit/src/redaction/denylist.ts:250-268` (`isSecretText` → `hasCredentialShape`), `:270-288` (pairing); `packages/shared/src/logging/string-redaction.ts:562-578` | senior-developer: with code review R2-m1 (same predicate), in-PR if another cycle happens, else TASK-031 before its diff builder records free-form values |
| PR61-SEC-12 | IPv4-mapped IPv6 spelled other than `::ffff:a.b.c.d` is neither unmapped nor coarsened as IPv4 | INFO | CWE-1289 | A04:2021 | `packages/audit/src/network.ts` (`unmapped`, `canonicalIp`, `coarseNetwork`) | TASK-041 (trusted chain) or the next change to `network.ts` |

### PR61-SEC-11 (LOW): credential pairs inside text

**What (P2/P2b, head; random sentinels).** The audit keeps these, although the log's `redactString` / `redactValue` hides them:

- **Pairs inside a string value (8):**
  - `login failed for password=<v>`;
  - a form body `grant_type=client_credentials&client_id=abc&client_secret=<v>` (the carrier OAuth request shape);
  - `invalid_client: client_secret: <v>`;
  - a JSON body as a string `{"access_token":"<v>",…}`, and the same JSON-escaped once more;
  - `__Host-rt_web=<v>; Path=/; Secure`;
  - `Set-Cookie: sid=<v>`;
  - `x-reauth-proof: <v>`.
- **Records (2):**
  - Node's flat `req.rawHeaders` list `['Host', 'x', 'X-Api-Key', <v>]`;
  - an SDK-style `{ Name: 'ApiKey', Value: <v> }` (capitalised member names).

Neither the log nor the audit hides these:
- `{ name, val }`;
- CloudFormation `{ ParameterKey, ParameterValue }`;
- `Bearer: <v>` and `Bearer` followed by a line break;
- the key names `kek` and `dek`;
- an opaque token used as an object key (undetectable by shape).

D-TASK028-11 left out the log's keyword-pair pass on purpose, because it also erases business values (`session:manage`, `reset_password`). That trade-off is right for that rule, but it leaves the pair class open.

**Severity.** A leaked value is a credential in an immutable, archived row, so Impact is H, and the matrix would give MEDIUM. I rate it LOW because the class is confined to serialized text. Audit values are structured `jsonb`: field-level diffs and a context snapshot (REQ-AUDIT-007, data-model §3.4). The structured form of every shape above is redacted (P2). A pair can only arrive when a writer stores a raw body, a header line, a cookie string or a provider error text as a string. No current or planned writer does that.

**Remediation.**
1. Add a narrow pair predicate to `hasCredentialShape`, or beside it. Use the log's `KEY_SEPARATOR` grammar and test the key's last segment with `isSecretKey`. Skip a bare `scope:action` pair: a colon with no quote and no blank around it, followed by a letter.
   - P2b validated it on the head: it flags 9 of the 10 residual forms (all except `Bearer` + line break).
   - It keeps 11 of 12 business values: `session:manage`, `address_book:manage`, `audit:read`, `reset_password`, `status: delivered`, `password policy: 12 characters`, `code=PERMISSION_DENIED`, `shipment:cancel`, and the others.
   - It flags `secret_ref: carrier/dhl`, which is the safe direction.
   - On 100,000 adversarial characters (`a=` repeated) it takes 33 ms. Apply it inside the existing 8 KiB windows.
2. Mirror the log walker's array pairing for flat lists: an item that follows a string naming a secret. Compare record member names case-insensitively (`Name`/`Value`), and add `val`.
3. Add `kek` and `dek` to the word list.
4. Fix this together with code review R2-m1 (the token68 over-redaction), because both live in the same predicate.

**Verification.** Pin the 10 residual forms and the 12 business values of P2b as a table test through `prepareEntry` → `complete()`. The 19 round-1 shapes must stay redacted.

### PR61-SEC-12 (INFO): mapped IPv4 in other spellings

`unmapped()` recognises only `::ffff:a.b.c.d`. Both `::ffff:c000:207` and `0:0:0:0:0:ffff:192.0.2.7` canonicalise to `::ffff:c000:207`. Their `ip_hash` therefore differs from that of `192.0.2.7`, and `coarseNetwork` gives `::/48` instead of `192.0.2.0/24`.

The input is `req.ip` from the trusted chain. Node reports IPv4 clients on a dual-stack socket as `::ffff:a.b.c.d`, so this needs an unusual proxy spelling. The effect is a missed exact-IP lookup, never disclosure.

**Fix:** unmap from the parsed groups (groups 0-4 zero and group 5 `ffff` → dotted quad from groups 6-7) before both `canonicalIp` and `coarseNetwork`.

**Test:** the four spellings give one `ip_hash` and one `ip_coarse`.

## R2.6 Code review round 2 overlap; record simulation; merge conditions

**Overlap with code review round 2.**
- **R2-m1 (prose over-redaction).** Confirmed by P2: `Invalid token signature`, `token exchange completed` and any URL with a query become `[REDACTED]`; `Basic plan` and `the token expired` are kept. Security has no objection to tightening the token68 rule, provided the 19 shapes of R2.3 remain a regression table.
- **R2-n1 (`[REDACTED_KEY]#n` collision throws `TypeError`).** Reproduced. It fails closed and is reachable only through caller-chosen keys. INFO-level, concur.
- **R2-n5.** See PR61-SEC-02 above: the relative-import hop is already lint-clean.

**Record simulation.** Main's checker ran in a `--shared` sparse clone, against plumbing merge refs of `origin/main` + this file + `c39a993`. The checker base is the merge base `538f0b0`.

| Scenario | Result |
|---|---|
| S1 | Pass, satisfied by this file at `d51b42b` |
| S2: a docs-only commit after `c39a993` | Pass |
| C1: no round-2 file (round 1 names `57faf1f` only) | Missing, as expected |
| C2: an owned-path change after `c39a993` | Missing, as expected |
| C3: the head row names `14cdeed` | Missing, as expected |
| C4: the final Verdict is FAIL | Missing, as expected |
| C5: `--pr 60` | Missing, as expected |

**Merge conditions (security).**
1. Push `c39a993` unchanged. Get a full lane A run on it, green in every step including `security-integration`, which is now due because a record exists. ci-gate reads this file from the merge ref, so it counts from the next `pull_request` event. If the push only gets a light run without a code proof, close and reopen the PR (D-ORCH-134).
2. Any later change to the 34 owned paths voids this record and needs a delta round. A merge of `main` that does not touch them does not.
3. Delete `task028-fc1-pre-gitleaks-backup` after the squash merge, and never push it (D-SEC-PR64-02 condition 1).

## R2.7 Proposed decision text

**D-SEC-PR61-03 · 2026-11-18 · security-analyst · PR #61 (TASK-028) security round 2 = PASS_WITH_FOLLOW-UPS at code head `d51b42b` (tip `c39a993` evidence only; record `PR-0061-TASK-028-security-review-r2.md` on main).** 0 Critical/High/Medium.
- **Closed:** PR61-SEC-01, -02, -06, -07, -09 and -10. -03 and -08 are closed for this PR with their D-ARCH-149 routes. -05 is closed for credential shapes; the opaque-token residual goes to TASK-031.
- **Still open:** PR61-SEC-04 (CODEOWNERS; now also `string-redaction.ts`) → devops.
- **New PR61-SEC-11 (LOW):** credential pairs inside strings, flat header lists and `{Name,Value}` records. Use a validated narrow pair predicate, fixed with code review R2-m1 → TASK-031 unless there is another cycle.
- **New PR61-SEC-12 (INFO):** mapped IPv4 spellings → TASK-041.
- **The D-ORCH-133 rewrite meets D-SEC-PR64-02's three conditions.** Gitleaks emulation finds 0 in the lane A range, with the pre-rewrite range as positive control.
- **Merge conditions:** R2.6.

Reversibility: High.

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_FOLLOW-UPS.** The fix cycle closes the round-1 MEDIUM and every in-PR item of rounds 1 and 1b: the denylist now covers everything the log covers by key and all 19 credential shapes, the vault exports are confined, D-ARCH-149's monthly subject and actor-owned filter values are in, and nested secrets no longer reach the vault. The local rewrite meets D-SEC-PR64-02. What remains is a LOW pair-in-text class, an INFO address spelling, CODEOWNERS (devops) and routed design work. No Critical or High finding is open for this change |
