# Code review: PR #61, TASK-028 audit redaction, field classification registry and capture privacy wiring, round 2

Reviewer: code-reviewer (principal engineer). Round 1 (CHANGES_REQUESTED) is `docs/05-quality/reviews/PR-0061-TASK-028-code-review.md` on the PR branch (`14cdeed`). This record is on main as a separate file (the PR #60 r2 precedent), because the round 1 file exists only on the branch and an append on main would give the squash an add/add conflict.

Reviewed: the fix cycle 1 delta `14cdeed..d51b42b`. These are local commits, not pushed; origin is at `14cdeed`. Source: the detached evidence worktree `Shipqube-TASK-028-evidence`, read only through `git` from the main checkout.
- `1b0b18e` fc1 part 1: denylist union, vault, lint allow-list.
- `b0c5fe6` fc1 part 2: architect rulings and remaining findings.
- `d51b42b` merge of `origin/main` `538f0b0`. Its `git show --remerge-diff` is empty (0 lines), so the merge is a pure union.
- `c39a993` is evidence only: lane B `20261118T1255Z_d51b42b`.

Specs checked: my round 1 findings; D-ARCH-148, D-ARCH-149 and D-ARCH-150 with D-ORCH-129; D-TASK028-01..17 in `docs/sdlc/DECISIONS.md` on main; D-ORCH-127 (routing) and D-ORCH-133 (local rewrite to remove the gitleaks PEM test literal).

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: Both round 1 MAJORs are closed, and so are m1, m4 and m5. m2 is routed. m3 is closed by D-ARCH-148..150, whose
  code parts are all present (month subject, actor-owned filter values, the log-coverage test). D-TASK028-01..17 are
  logged.
  - M1: every round 1 spelling is now redacted (probe), the word lists are pinned by an independent required list with
    generated spellings, and long values are scanned in overlapping windows.
  - M2: the lint probe, re-run on the fix config, refuses all four vault exports outside their exact allow-lists,
    including namespace imports, dynamic imports and re-exports.
  One new MINOR: the log's token68 rule, which the audit now uses, reads ordinary prose as a credential ("DHL Express
  Basic shipping", "Token generation failed"). It fails safe but loses audit evidence. Five NITs. Lane B PASS on
  d51b42b (unit 7,231, 0 failures).
```

## 1. What I verified myself (and what I did not)

Host rule (D-ORCH-125 amendment, coordinator dispatch): no npm, Jest, typecheck, build or Docker. All checks are static or single-process Node probes on a `git archive d51b42b` extract. The extract has junctions for `node_modules` and for the copy's own `@platform/{shared,audit,config,authz}`.

| Check | Result |
|---|---|
| `git show --remerge-diff d51b42b` | empty: the main merge is a pure union |
| `14cdeed` is an ancestor of `b0c5fe6`; `git rev-list --count 14cdeed..b0c5fe6` | yes; 2 commits |
| PEM literal in the delta (`BEGIN … PRIVATE KEY` in one string) | none. The only PEM reference is `denylist.ts:259`, two separate `includes` calls (D-ORCH-133). |
| Lane B `20261118T1255Z_d51b42b` (`c39a993`) | PASS. api 173, catalog-c1-c14 106, integration 339, rls-cross-tenant 126, unit 7,231 (2 skipped), 0 `<failure>`. Merged coverage 99.12 % lines / 97.24 % branches. The junit contains the new cases: known-answer AAD, fresh nonce, 33-byte key, D-ARCH-149 month subject, four D-ARCH-150 log-coverage cases, sorted subject insert, HeadlessChrome, live-mode seam refusal, malformed key exits 78, RFC 5952. |
| Denylist probe (`review/PR-61-r2-probes/deny2.mts`, 87 keys, 25 texts) | All round 1 misses are now secret, including `TOTPSecret`, `OTPSecret`, `APIToken`, `JWTSecret`, `password2`, `token1`, `secret2`, `cc_number`, `ccNumber`, `csc`, `otpauth_url`, `provisioning_uri` and `passcode`. The round 1 text shapes are now secret: tab or leading white space after the scheme, embedded `Authorization: Bearer`, `otpauth:`, PEM (`PRIVATE`, `RSA PRIVATE`, `ENCRYPTED PRIVATE`), a JWS with an empty payload, `Token …`, `Negotiate …`. Business keys stay readable: `required_permission`, `result_count`, `filter`, `from_state`, `code`, `problem_code`, `country_code`, `name_key`, `idempotency_key`, `object_key`, `sha256`, `city`, `email`, `company`, `shipping`. |
| Long-value windows (`long.mts`) | A `Bearer` credential after 10 to 20,000 characters of text is found at every offset around the 8,192 window and 4,096 stride. 64 k adversarial inputs (`a `, `Bearer `, `?`, `eyJ`) take 0.4–10 ms in one process: linear. |
| Writer record shapes (`collide.mts`, `prepareEntry` on the extract) | `[['X-Api-Key', v], …]` and `{ name: 'Authorization', value }` redact the value. A credential-shaped key becomes `[REDACTED_KEY]#1`. A collision with a literal `[REDACTED_KEY]#1` key throws `TypeError` (R2-n1). |
| Lint probe re-run (`lint2.mjs`; ESLint `lintText` with the fix commit's `eslint.config.mjs`; 7 file paths × 9 import forms) | modules/orders and worker jobs: all nine forms refused (writer, tokeniser, privacy, decrypt, keyOf, namespace, dynamic `import()`, re-export). The `@platform/audit/src/...` deep path stops at `import-x/no-unresolved`. modules/identity and platform/audit (writer allow-list): writer, tokeniser and privacy allowed; the decrypt pair refused in every form. `start-api.ts`: only tokeniser and privacy allowed. `main.ts`: everything refused. modules/audit (the viewer): only `decryptVaultValue` / `auditKeyOf` allowed (and their re-export, R2-n5). |
| Round 1 mutation runner (`PR-61-cr-mut.mjs`, Jest) | **not re-run**: the host rule forbids Jest, and the scratchpad was cleared. Instead I checked statically that each round 1 survivor now has a pinning test that lane B ran (table in §2). |

## 2. Round 1 follow-up

| Round 1 item | Status | Evidence |
|---|---|---|
| **R1-M1** denylist splitter and coverage | **Closed** | `keyWords` splits at camel, acronym and letter/digit boundaries in one pass (`denylist.ts:188-215`). The audit's rules are unioned with the log's `isSensitiveKey`. New words, stems and key-material names were added. Record pairs (`{name,value}`, `[name, value]`) and credential-shaped keys are handled. `isAuditEntityId` and `reason` now refuse or redact credential text (PR61-SEC-05/-09), and personal objects are secret-redacted before they are tokenised. Mutants D3–D6 are now pinned: `REQUIRED_SECRET_WORDS` / `REQUIRED_SECRET_STEMS` are written out in `tests/spellings.ts`, and `wordSpellings` includes `${word}2` and `${WORD}Value`, run against `isAuditSecretKey` alone. Removing a list entry fails, unless a stem duplicates it (`password`), which is harmless. Probe: all round 1 spellings are secret. |
| **R1-M2** vault exports outside the allow-list | **Closed** | `AUDIT_PRIVACY_EXPORTS` and `AUDIT_VAULT_DECRYPT_EXPORTS` with exact-path roots (`eslint.config.mjs`). Eight new negative and positive fixtures plus `negative-fixtures.test.ts` cases. Lint probe above. |
| R1-m1 text shapes | Closed | probe, and `denylist.test.ts:210-256` |
| R1-m2 AT-US-091-06 | Routed (D-ORCH-127 → TASK-073) | The TASK-073 card has no line yet (R2-n4) |
| R1-m3 decisions and spec deviations | Closed | D-ARCH-148 (token columns INT, data-model amended, registry header cites it). D-ARCH-149: `unattributedSubject(at)` gives the November vector `01a19467-e800-7000-8000-000000000002` (I recomputed it: `Date.UTC(2026,10,1)` = `0x1a19467e800`); the clock is read once per call; `filterSummary(query, filterSubject(principal))` is unit-tested. D-ARCH-150: `log-coverage.test.ts`, two-way exceptions, planted case. D-TASK028-01..17 logged. |
| R1-m4 crypto tests | Closed | `vault.test.ts`: known-answer decrypt with `createDecipheriv` and the literal JCS AAD (wrong key id, wrong column and the three-element AAD each fail) kills V2/V3. Nonce prefix comparison kills V7. 33-byte key kills V8. Tagged `[SEC-TC-49]`. |
| R1-m5 IP sentinel, SEC-TC-19 | Closed | `composition.int.test.ts` asserts `127.0.0.1` is absent (with `ip_coarse` nulled) and is tagged `[SEC-TC-19]` |
| R1-n1 regex typo | Closed | `start-api.test.ts` |
| R1-n2 `@@schema` | Closed | `tools/db/classification.ts` reads `@@schema` and keys `platform.<table>`. The comment stripper now keeps `//` inside strings. |
| R1-n3 local derivation home | Routed ("code R1-n3 later", D-TASK028-11..17) | Unchanged; acceptable while packages/audit is the only consumer |
| R1-n4 authenticate seam | Closed | `@internal`, retired with TASK-052, and `AuthenticateSeamError` in `live` mode (`app.ts:116-124`) |
| R1-n5 UA step bound | Mostly closed | Literal counts (512 / 1,024 / 1,025 / 512 / 1,025). Classified word length is counted. U3 and U5 are pinned. Residual: R2-n3. |
| R1-n6 `redactRecord` entity name | Closed | JSDoc says table name, not descriptor entity |

Other fc1 content reviewed and accepted:
- RFC 5952 IPv6 canonical form (PR61-SEC-06): the longest run of at least two zero groups, the first on a tie; single zero groups are not compressed.
- Subject inserts sorted by `(kind, ref_id)` against lock-order deadlocks.
- C10 pins the class of each §10.4 column (D-TASK028-14).
- A malformed audit key exits 78 with a class-only line.
- Safari requires `Version/` (HeadlessChrome → null).

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `packages/shared/src/logging/string-redaction.ts:562` (`TOKEN68_CREDENTIAL`), used by `denylist.ts:250` | Any scheme word (`basic`, `token`, `bearer`, `negotiate`, `apikey`, `dpop`, `ntlm`) followed by any 8-character word is read as a credential. Probe (`prose.mts`): "DHL Express Basic shipping", "Basic Delivery service", "Token generation failed", "Apikey rotation scheduled" and "Negotiate discounts quarterly" are all stored as `[REDACTED]`. Any URL with a query is also redacted (`https://x/page?lang=en`). This fails safe for privacy, but it erases business evidence, such as CONFIG_CHANGE of a carrier service label or a note, in an immutable trail. It also contradicts D-TASK028-12 ("Basic plan stays readable" holds only for 4-letter words). The log path is unchanged (`redactString` does not use the new rule). | Require the token68 credential to look like one, for example a digit, an inner capital or one of `+/=._~-`, or ≥ 20 characters. Pin "Basic shipping" and "Token generation failed" as negatives and keep `Basic dXNlcjpwYXNz` positive. Not a merge blocker; in-PR if another cycle happens, otherwise on the next touch of `string-redaction.ts` or with TASK-031 (record the owner). |
| R2-n1 | NIT | `packages/audit/src/entry.ts:352-370` | A credential-shaped key renamed to `[REDACTED_KEY]#n` can collide with a literal key of that name. `defineMember` is non-configurable, so `prepareEntry` throws `TypeError: Cannot redefine property` (probed) instead of `AuditWriteError` INVALID_ENTRY. `redactSecrets` (`redact.ts`) silently overwrites one member instead. Reachable only through caller-chosen keys. | Check the stored name against the names already defined and throw `invalid(path)`. Mirror the check in `redactSecrets`. |
| R2-n2 | NIT | `denylist.ts:217-221` (key-material rule), `:76-77` (`signature`, `proof`) | Over-redaction of evidence keys: `role_keys`, `roleKeys`, `permission_keys`, `entity_key`, `route_key`, `proof_of_delivery`, `delivery_proof`, `signature_required`. TASK-037's change record uses `roles` today and is unaffected. | When a membership, role or POD task first writes such a key, add it to `NON_SECRET_KEY_NAMES` or restrict the key-material rule to the singular `key`. Note it in the TASK-231 and POD cards. |
| R2-n3 | NIT | `packages/audit/src/redaction/user-agent.ts` (`close`) | Steps are counted in `close`, so a classify repeated per character (round 1 mutant U6) still leaves the count unchanged. The JSDoc's "a super-linear classification would move the count" overclaims. The risk is nil (512 cap). | Count inside `classify` (each `indexOf`/`slice`), or soften the JSDoc. |
| R2-n4 | NIT | TASK-073 card (`docs/04-plan/tasks/WAVE-01.md`) | AT-US-091-06 is routed in D-ORCH-127, but the TASK-073 card does not carry it. | Orchestrator sheet fold: add the AT-US-091-06 line to TASK-073. |
| R2-n5 | NIT | `eslint.config.mjs` (`AUDIT_VAULT_READERS`) | The viewer module may re-export `decryptVaultValue` (lint probe: `reexport` is allowed in modules/audit). That would be a two-hop path (PR #42 R2-M1 pattern) once other modules can import the audit module's entry. | With TASK-073, forbid re-exporting the decrypt pair from `modules/audit` (the `barrel-reexport-only` style), and add a fixture. |

## 4. Merge conditions

1. The security-analyst round 2 record on main for this delta.
2. The orchestrator pushes `c39a993`. Lane A on that head must be green, including `security-integration` (now due, because the record exists), and `check-evidence` must accept `20261118T1255Z_d51b42b`.
3. Squash merge. R2-m1 and R2-n1..n5 are logged with owners (in-PR is optional).
