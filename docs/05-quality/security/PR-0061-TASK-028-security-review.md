# PR-0061: TASK-028 audit redaction, field classification registry and capture privacy wiring, security review

| Field | Value |
|---|---|
| PR | #61 `feat(audit): redaction, field classification registry and capture privacy wiring (TASK-028)`, https://github.com/sukhchdit/shipcube/pull/61, branch `feat/TASK-028-audit-redaction-field-classification-registry`. Commits on the merge base `d173d8f`: `e526b11` (code, 23 files), `57faf1f` (lane B evidence only, 9 files) |
| Head | 57faf1fd971c9bbb2a71f210fd147b1041d7cf06 |
| Code commit | `e526b11` (the lane B evidence tree) |
| Lane A evidence | Run 44093229169 on `57faf1f` (`pull_request`, merge ref with `main` `732ad20`). `fast-lane` **success** in full mode: workflow policy, install flags, migrations immutable, lockfile, cooldown, licences, signatures, audit, "Lane B evidence", `deps:rebuild`, commitlint, lint, lint-porcelain, format, actionlint, type-check, unit, build, build-porcelain (base-ref negative lint fixtures and the Semgrep self-test skipped by their path conditions). `ci-gate`: Gitleaks (PR commit range), Semgrep and oasdiff **success**; the only red step is "Security-owned paths need a review record" (this record). `security-integration` **skipped**: lane scope reported `security_paths=true, record_ok=false`, so `security_integration_due=false` until this record is pushed (§6) |
| Lane B evidence | `20261117T1302Z_e526b11`, profile `pr`, verdict PASS: `api` 173, `catalog-c1-c14` 106 (the 4 new C10 cases), `integration` 339 (the 4 new composition cases), `rls-cross-tenant` 126, `unit` 6,863 (2 skipped); merged coverage 99.1 % lines, 97.22 % branches |
| Code review twin | Not on the branch when this round was written (`origin` and the local branch both at `57faf1f`). Running in parallel; owners below may be re-aligned to its items by the orchestrator |
| Owned paths changed | 18 (checker `owned[]`): `apps/api/src/platform/audit/composition.int.test.ts`, `apps/api/src/platform/routing/pipeline-audit-privacy.test.ts`, `apps/api/src/platform/routing/pipeline.ts`, `packages/audit/src/entry.ts`, `packages/audit/src/index.ts`, `packages/audit/src/redaction/{denylist,privacy,redact,user-agent,vault}.ts` and their 6 test files, `prisma/tests/catalog/c10-classification.int.test.ts`, `tools/db/classification.ts`, `tools/db/classification.test.ts` |
| Unowned paths changed | `apps/api/src/app.ts`, `apps/api/src/start-api.ts`, `apps/api/src/start-api.test.ts`, `packages/shared/src/classification/registry.ts` (+ test), `packages/shared/src/index.ts`, and the run directory `docs/05-quality/tests/runs/20261117T1302Z_e526b11/` (9 files). The composition root and the registry are reviewed here although CODEOWNERS does not own them (PR61-SEC-04) |
| Binding items checked | D-SEC-PR56-01 (condition 1), PR56-SEC-08, D-ARCH-141, D-ARCH-074, PR8-SEC-10, D-TASK029-21, REQ-AUDIT-008/009, NFR-PRIV-002/003, AT-US-091-01..05, ADR-0007 (§Privacy erasure, am. 2), data-model §1.2, §3.4, §5.7, §10.4 (SEC-P3-08 item 1), ADR-0018 key register, threat model T-87, T-89, T-91, SEC-TC-51 (placeholder guard), D-TASK028-03..07 as described in the dispatch brief (see PR61-SEC-07 on where D-TASK028-01..10 are recorded) |
| Reviewer / date | security-analyst, 2026-11-17, round 1. Git object reads, `gh` and the record checker ran in the main checkout. Probes ran in the session scratchpad on a `git archive` extract of `57faf1f` (`packages/{audit,shared,config}/src`), loaded through a type-stripping resolve hook, with random sentinels that are never printed. One read-only `ESLint#lintText` run loaded the PR worktree's configuration (no cache, no file written). No Jest, no Docker, no install. In the PR worktree I ran only `git status` before writing; then I wrote this file and committed it |

## 1. Summary

The PR adds the field classification registry, the audit secret denylist, the vault tokeniser (AES-256-GCM with AAD, keyed dedupe HMAC, data-subject resolution), the `ip_hash` index, an in-house user-agent parser, and the production composition that hands all three to the audit capture (D-SEC-PR56-01 condition 1).

Requested checks, in brief:

- **Vault tokeniser:** sound. The AAD binds the ciphertext to its token and key id. Each of five swap, relabel and tamper probes is refused. Nonces are fresh per value, key sizes are enforced, and no key byte is reachable from the composed object (§5.1).
- **`local-only-*` derivation (D-TASK028-06):** holds. Every value the parser accepts as a marker is refused by the placeholder guard in staging and production (§5.1, probe P6).
- **`ip_hash`:** HMAC-SHA256 under `AUDIT_INDEX_KEY` as specified. Two notes: IPv6 is not canonicalised to RFC 5952 (PR61-SEC-06, INFO), and the hash stays reversible by enumeration for as long as any version of the index key exists (PR61-SEC-08, INFO).
- **Denylist and credential-shape redaction (D-TASK028-05):** applied at the right place. The writer redacts while it snapshots, so the hash covers `[REDACTED]`, at every depth and inside arrays. The matcher is weak, though: 53 of 64 probed key spellings and 15 of 15 credential-shaped values reach the row in clear, and the platform's own log redaction already catches 42 of those keys and all 15 values. Among them are the platform's own credential names `X-Reauth-Proof` and `__Host-rt_web`, acronym runs (`CSRFToken`, `IDToken`), one-word concatenations (`refreshtoken`, `newpassword`), digit suffixes (`password2`) and `sk_live_…` / `whsec_…` / `Token …` / `DPoP …` values. **PR61-SEC-01, MEDIUM**: the audit store is immutable and archived, so a secret that gets in can never be removed. It is latent: today's only production writer (the capture) records no free-form object.
- **Classification:** complete for the live schema (C10 two-way, green in lane B). The authz tables follow PR8-SEC-10, which closes. The INT class of the three token columns (D-TASK028-03) is reasonable but contradicts data-model §3.4 as written (PR61-SEC-07, INFO).
- **UA parser:** linear and closed. 300,000 fuzzed headers gave 0 outputs outside the family × digits × OS grammar, 0 over the step bound and 0 rejected by the writer shape. Time per call is flat from 1 kB to 1 MB. There is no regular expression, hence no ReDoS (§5.4).
- **`AppDependencies.authenticate` (D-TASK028-07):** unreachable in production (§5.5).
- **Exports:** `createVaultTokeniser`, `createAuditPrivacy`, `decryptVaultValue` and `auditKeyOf` are value-importable lint-clean from feature modules and worker jobs (probe P5) (PR61-SEC-02, LOW; this is the developer's flagged MINOR).
- **Logs:** no PERSONAL value and no key material reaches a log (§5.7).
- **ANONYMOUS subject (D-TASK028-04):** list-filter values of authenticated requests (receiver-name searches, T-87's own example), anonymous clients' IP and user agent, and API-key actors' own fields have no subject-based erasure path. No vault retention is designed for them, and the tokeniser ignores `erased_at` (PR61-SEC-03, LOW).
- **CODEOWNERS:** the registry, the composition root and the placeholder patterns that D-TASK028-06 rests on are not security-owned (PR61-SEC-04, LOW).

Findings: 0 Critical, 0 High, 1 Medium, 3 LOW, 4 INFO. Closed by this PR: D-SEC-PR56-01 condition 1 (at merge), PR56-SEC-08, PR8-SEC-10 (classification part).

**Verdict: PASS_WITH_FOLLOW-UPS.**

## 2. Method

1. Read the full diff `d173d8f...e526b11` (23 code files) and the head copies of `entry.ts`, `network.ts`, `writer.ts`, `store/prisma-store.ts` (vault statements), `apps/api/src/platform/audit/{capture,descriptor-runtime,writer}.ts`, `packages/config/src/{keys,placeholders,guards,environment,schema}.ts`, `packages/shared/src/logging/string-redaction.ts`, `tools/eslint-rules/audit-writer-allowlist.mjs`, the relevant `eslint.config.mjs` blocks, `.github/CODEOWNERS`, ADR-0007, data-model §3.4/§5.7/§10.4, the threat model (T-87, T-89, T-91) and D-SEC-PR56-01 / D-ARCH-141.
2. **P1 denylist through the writer** (`p1-denylist.mjs`). 64 keys (7 controls) were placed (a) at the top level of `details` and (b) nested at `request.headers[0].x.<key>`. Each went through the real `prepareEntry` → `complete()` with random sentinels, and I checked whether the sentinel survives in the row draft. In the same run each key was classified by the audit `isSecretKey` and by the log's `isSensitiveKey` (differential). Five `{name|key, value}` / `[name, value]` record shapes were run the same way. **P7** added 15 digit-suffix and short spellings.
3. **P2 credential-shaped values** (`p2-values.mjs`). 17 values (2 controls) under a neutral key, classified by the audit `isSecretText` and by the log's `redactString`, which decides whether the sentinel survives.
4. **P3 user-agent parser** (`p3-ua.mjs`):
   - 300,000 random headers from table tokens, separators, random bytes, NUL, U+2028 and markup;
   - output closedness against the exported family tables, the writer's `isAuditUaParsed`, and the step bound `2 · min(len, 512) + 1`;
   - time per call at 1 kB, 16 kB and 1 MB for four adversarial shapes;
   - six real-world headers.
5. **P4 vault and IP index** (`p4-vault.mjs`). The tokeniser ran over a recording fake SQL port and store. It covered:
   - the statement order;
   - dedupe HMAC equality and nonce distinctness;
   - decryption of the own row, then ciphertext and token swaps, a relabelled key id, the same bytes under another key id, and a flipped tag;
   - the key-size checks;
   - `local-only-*` derivation (deterministic, per key id, 32 bytes);
   - key bytes in `util.inspect(showHidden)` and JSON of the composed object;
   - `ip_hash` equality across IPv6 spellings.
6. **P5 lint** (`p5-lint.mjs`): seven virtual files against the worktree's real `eslint.config.mjs`. The positive control (`createAuditWriter` in a module) must fire.
7. **P6 local-only markers** (`p6-localonly.mjs`): 10 key values (case, NFKC full-width, percent, whitespace, a real random key as control) through `parseKeyVersion` and `isPlaceholder`, plus `placeholderGuard` for `production` and `local`.
8. **Evidence:** `gh run view --json jobs` and the run log (lane scope line), lane B `summary.md` and the JUnit case names. Before writing I checked the overlap of main's changes since `d173d8f` with the PR's files and ran `git merge-tree` against `origin/main`. `check-security-owned-paths` ran on `d173d8f..57faf1f` (status `missing`, 18 owned paths) before the record and again after it (§6).

## 3. Findings

| ID | Title | Severity | CWE | OWASP | Location | Owner |
|---|---|---|---|---|---|---|
| PR61-SEC-01 | The audit secret denylist misses common and platform-specific credential spellings and shapes that the platform log already redacts; such values reach the immutable, hash-chained row in clear | MEDIUM | CWE-212 | A09:2021 | `packages/audit/src/redaction/denylist.ts:19-70` (word lists), `:107-131` (`keyWords`, `isSecretKey`), `:136-142` (`isSecretText`); applied at `packages/audit/src/entry.ts:331`, `:334`, `:356` | senior-developer; this PR's fix cycle if there is one, else due before the first writer caller that passes objects it did not build field by field (TASK-031 diff builder, TASK-052 identity recorder, TASK-047 job wrapper) |
| PR61-SEC-02 | The new write- and read-capable exports of `@platform/audit` are outside `AUDIT_WRITER_EXPORTS`: feature modules and worker jobs import them lint-clean | LOW | CWE-284 | A01:2021 | `eslint.config.mjs:174`; `packages/audit/src/index.ts:75`, `:87-88` | senior-developer (this PR's fix cycle, the developer's own MINOR) |
| PR61-SEC-03 | UNATTRIBUTED subject (D-TASK028-04): no subject-based erasure for list-filter values of authenticated requests, anonymous IP/UA and API-key actors' own fields; no vault retention designed; `erased_at` not consulted | LOW | CWE-359 | A04:2021 | `packages/audit/src/redaction/vault.ts:40`, `:152`; `apps/api/src/platform/audit/descriptor-runtime.ts:182`; `packages/audit/src/entry.ts:470` | principal-architect (decision); senior-developer (filter subject, TASK-031) |
| PR61-SEC-04 | The classification registry, the API composition root and the placeholder patterns that D-TASK028-06 rests on are not security-owned (CODEOWNERS) | LOW | CWE-693 | A08:2021 | `.github/CODEOWNERS` (no line for `packages/shared/src/classification/`, `apps/api/src/{app,start-api}.ts`, `packages/config/src/placeholders.ts`) | devops-engineer with the PR48-SEC-02 activation PR |
| PR61-SEC-05 | Credential-shape redaction does not cover the clear-text `entity_id` column; the `ENTITY_ID` shape admits a JWS and opaque base64url tokens | INFO | CWE-212 | A09:2021 | `packages/audit/src/entry.ts:530` | senior-developer (with SEC-01, or TASK-031) |
| PR61-SEC-06 | `canonicalIp` does not produce the RFC 5952 form for IPv6, so spellings of one address get different `ip_hash` values and vault rows | INFO | CWE-1289 | A04:2021 | `packages/audit/src/network.ts:62-65` | TASK-031 (viewer IP filter) or TASK-041 (trusted chain) |
| PR61-SEC-07 | D-TASK028-03 classes `ip_token`, `user_agent_token`, `reason_token` INT where data-model §3.4 says "PER (token)"; D-TASK028-01..10 are not recorded in the PR body or DECISIONS.md | INFO | — | — | `packages/shared/src/classification/registry.ts:116`, `:120`, `:128` | principal-architect (data-model §3.4 amendment); orchestrator (decision log) |
| PR61-SEC-08 | `ip_hash` is reversible by enumerating IPv4 under any retained `AUDIT_INDEX_KEY` version and stays in the immutable row and archive after the vault row is erased | INFO | CWE-359 | A04:2021 | design: ADR-0007 am. 2, ADR-0018 register (`AUDIT_INDEX_KEY` row) | principal-architect |

## 4. Finding details

### PR61-SEC-01 (MEDIUM): the audit denylist is weaker than the log's, for a sink that can never be cleaned

**What.** `isSecretKey` splits a key into ASCII words. A key is secret if a word is in `SECRET_WORDS` (exact match), or if the joined words contain one of 14 compounds. `isSecretText` recognises only a value that *starts* with `bearer `, `basic ` or `digest `, or a value that starts with `eyJ` and has two dots. Probe P1 ran 64 keys through the real `prepareEntry` → `complete()`. 53 of them leave the random sentinel in the row draft, both at the top level and nested inside an array. The log matcher redacts 42 of those 53:

| Class | Keys that reach the row (log redacts all unless marked) |
|---|---|
| Acronym run before a capitalised word | `CSRFToken`, `X-CSRFToken` (Django's header), `IDToken`, `JWTToken`, `APIToken`, `TOTPSecret`, `MFASecret`, `OTPCode`, `AWSSecret`, `APISecret`, `SAMLToken`, `SSOToken`, `PINCode` (log misses too) |
| One-word concatenation | `accesstoken`, `refreshtoken`, `idtoken`, `authtoken`, `sessiontoken`, `csrftoken`, `newpassword`, `oldpassword`, `userpassword`, `passwordhash`, `clientsecret`, `apisecret`, `apitoken`, `bearertoken`, `creditcard` (log misses too) |
| Digit suffix or short form (P7) | `password2`, `token2`, `access_token2`, `secret1`, `pass`, `pass_phrase` |
| The platform's own credentials | `X-Reauth-Proof`, `reauthProof`, `reauth_proof` (the step-up proof header), `__Host-rt_web`, `__Host-rt_admin` (the refresh-token cookies, ADR-0006) |
| Session and other credentials | `session_id`, `sessionId`, `sid`, `signature`, `stripe-signature`, `dsn`, `connectionString`, `manual_key` (the TOTP manual key), `code_verifier` (PKCE), `private_jwk`, `passcode`; log misses too: `connect.sid`, `hmac`, `otpauth_url` (carries the TOTP secret) |
| Key-material names (log misses too) | `AUDIT_VAULT_KEY`, `CSRF_KEY`, `RECOVERY_KEY`, `IDEMPOTENCY_BODY_KEY`, `OUTBOX_PAYLOAD_KEY`, `DATABASE_URL` |

The audit-only catches (`pinCode`, `pin_code`) show that the fix is a union of the two matchers, not a replacement of one by the other.

Values (P2). `isSecretText` keeps 15 of 15 credential shapes under a neutral key, and the log's `redactString` removes the credential from every one of them:
- `Bearer` with a leading space or a TAB;
- the `Token`, `DPoP`, `NTLM`, `Negotiate` and `AWS4-HMAC-SHA256` schemes;
- an `Authorization: Bearer …` line;
- a JWS or an opaque token inside a URL query (reset, invitation and magic links);
- an S3 presigned URL;
- a `postgresql://user:<password>@host` URL;
- the gateway shapes `sk_live_…`, `pi_…_secret_…` and `whsec_…`.

Records (P1). Four of five shapes reach the row:
- `{ name: 'X-Api-Key', value }`;
- `[ 'X-Api-Key', value ]`;
- `{ key: 'refresh_token', value }`;
- a credential used as an object *key*.

The fifth was redacted only because its parent key was `cookieJar`.

**Why it matters.** REQ-AUDIT-008 names tokens, authorisation headers and gateway credentials explicitly. `denylist.ts` and `entry.ts` promise redaction "whatever the caller passed". An entry is hash-chained and immutable, readable by every `audit:read` holder across tenants (T-91), and archived to S3 Object Lock at M5. A secret that gets in cannot be erased without breaking the chain. A refresh token or reauth proof there is account takeover for the token's lifetime, by anyone who can read audit entries.

**Exploitability.** Latent today. The only production writer is the capture, and its `details` hold `status`, `code`, `required_permission` and the filter summary, whose values are tokenised `PiiValue`s anyway. The next callers write objects: the TASK-031 diff builder (INT JSON columns pass through `redactSecrets`), the identity recorder (TASK-052), CONFIG_CHANGE entries, the job wrapper (TASK-047) and webhook receipts. The AT-US-091-02 property test draws keys only from `SECRET_KEY_EXAMPLES`, the developer's own 26 spellings, so it cannot find spelling gaps. Severity: Impact H × Likelihood L = MEDIUM.

**Remediation (code level).**
1. **Keys:** union with the hardened log matcher (`@platform/shared/logging` exports `isSensitiveKey`; packages/audit already depends on `@platform/shared`):
   ```ts
   import { isSensitiveKey } from '@platform/shared/logging';
   const SECRET_STEMS = ['password', 'passwd', 'passphrase', 'secret', 'token', 'credential', 'cookie', 'authoriz', 'authoris', 'bearer', 'creditcard', 'hmac'];
   export function isSecretKey(key: string): boolean {
     if (isSensitiveKey(key)) return true; // substring parts, exact names, __Host-/__Secure- cookies, reauth proof, session id
     const words = keyWords(key);          // split also at an upper run before Upper+lower: CSRFToken -> csrf, token
     if (words.some((word) => SECRET_WORDS.has(word.replace(/[0-9]+$/, '')))) return true; // password2, token2
     const joined = words.join('');
     return SECRET_COMPOUNDS.some((c) => joined.includes(c)) || SECRET_STEMS.some((s) => joined.includes(s)) || isKeyMaterialName(words);
   }
   ```
   `isKeyMaterialName`: the last word is `key`/`keys`, at least one word precedes it, and the name is not in a short exact allow-list (`idempotency_key`, `name_key`, `object_key`, `archive_object_key`, `cache_key`). `*_key_id` stays clear because its last word is `id`. Over-redaction is the documented safe direction.
2. **Values:** export a credential predicate from `string-redaction.ts` (the `TOKEN68_SCHEME`, `PARAMETER_SCHEME` and per-word `SECRET_SHAPE` tests, URL userinfo, and a URL query; no e-mail masking). Use it in `isSecretText` after trimming leading white space. A URL with a query or userinfo becomes `[REDACTED]` as a whole.
3. **Records:** mirror the log walker's pairing in `collect`. For a plain object whose only string members are a name (`name`, `key`, `header`, `field`) and a value (`value`, `values`, `content`, `data`), and whose name `isSecretKey`, redact the value. Do the same for a two-string array `[name, value]`.
4. **Ownership:** if the audit relies on the log matcher, put `packages/shared/src/logging/string-redaction.ts` under CODEOWNERS (PR61-SEC-04), so a later loosening needs a security record.

**Verification test.**
- Corpus test: every key of P1/P7 and every key the log's own redaction tests assert sensitive satisfies `isSecretKey`.
- Generated-spelling property: for each stem, camelCase, PascalCase with an acronym prefix, lower concatenation, SCREAMING_SNAKE, kebab, and digit suffix, at random depth through `prepareEntry` → `complete()`, with the sentinel absent.
- The 15 value shapes and 4 record shapes of P1/P2 through the writer, with the sentinel absent.
- Mutation: drop the `isSensitiveKey` call. The corpus test must go red.

### PR61-SEC-02 (LOW): capability exports outside the writer allow-list

`platform/audit-writer-allowlist` flags a value import from `@platform/audit` only by name (`AUDIT_WRITER_EXPORTS`). Probe P5, run against the real configuration, gave these results:

| Import | Result |
|---|---|
| `createAuditWriter` in `apps/api/src/modules/quotes/service/` (control) | flagged |
| `createVaultTokeniser` from the same module | CLEAN |
| `createAuditPrivacy` | CLEAN |
| `decryptVaultValue` | CLEAN |
| `auditKeyOf` | CLEAN |
| `createVaultTokeniser` from `apps/worker/src/jobs/` | CLEAN |
| from `apps/web` | refused by boundaries |

**Impact.** Any module can do two things it should not:
- insert `data_subjects` and `audit_pii_vault` rows through its own transaction, outside the writer and its entry contract. The store, which PR42-SEC-06 classed write-capable, is reachable this way.
- given an `AUDIT_VAULT_KEY` version, decrypt vault values outside the `audit:read` SENSITIVE view that ADR-0007 requires.

It is defence in depth for REQ-AUDIT-001: review and the missing key in feature code are the other layers. LOW.

**Remediation.**
- Add `'createVaultTokeniser', 'createAuditPrivacy', 'decryptVaultValue', 'auditKeyOf'` to `AUDIT_WRITER_EXPORTS`.
- Add the composition root `apps/api/src/start-api.ts` (exact file) to `AUDIT_WRITER_ALLOW_LIST`; TASK-047's worker composition root follows later.
- Alternative: move the four exports to a subpath `@platform/audit/privacy`, with a boundaries policy that allows only the composition roots and `packages/audit`.

**Verification:**
- lint fixtures: the P5 module cases are refused, `start-api.ts` stays clean, and the `createAuditWriter` control still fires;
- the base-ref negative lint fixtures step picks them up.

### PR61-SEC-03 (LOW): the UNATTRIBUTED subject has no erasure or retention path

**What.** `tokenise` stores every value whose `subject` is `null` under `UNATTRIBUTED_SUBJECT` = (`USER`, ANONYMOUS actor). Three groups of values end up there:

1. **List-filter values of authenticated requests.** `filterSummary` passes `subject: null` (`descriptor-runtime.ts:182`). These include the receiver-name search terms that T-87 names, which are personal data of a contact.
2. **The IP and raw user agent of anonymous clients.** Guests are natural persons too.
3. **The own fields of `API_KEY` actors.** `ownSubject` attributes only `USER` actors (`entry.ts:470`).

ADR-0007 erases by `subject_id` (`DELETE FROM audit_pii_vault WHERE subject_id = $1`), so an erasure of the user or of the contact misses these rows. The vault header says "retention removes them", but no retention mechanism or period exists for vault rows in ADR-0007 or data-model §5.7. The tokeniser also does not read `data_subjects.erased_at`. A write after an erasure therefore puts the subject's values back into the vault, and the M4/M5 erasure job would have to order its own audit writes around that.

**Impact and likelihood.** This is a compliance gap (GDPR Art. 17, DPDP). Every filtered list request feeds it. An exact-value erasure is still possible through `value_hmac` (HMAC of the value under the dedupe key, independent of the subject), and the values are encrypted and never archived. Impact M × Likelihood L = LOW.

**Remediation.**
- (a) `filterSummary(query, subject)` with `subject = principal.authenticated ? { kind: 'USER', refId: principal.actorId } : null`. The searcher's erasure then removes their search terms. Over-erasure of a third party's name is the safe direction.
- (b) Principal-architect logs D-TASK028-04 and names the retention of UNATTRIBUTED vault rows: who deletes them (`platform_erasure`), after how long, and that the viewer renders `[ERASED]`.
- (c) The architect also decides `erased_at` handling: refuse, or tokenise into a non-resolvable marker.
- (d) Attribute `API_KEY` actors with a `userId` (M3 seam).

**Verification.**
- Unit: `entryFor` on an authenticated list request yields filter `PiiValue`s whose subject is the actor.
- Integration (M4/M5 job): after erasing the user, no vault row holds their filter values.

### PR61-SEC-04 (LOW): security-relevant files outside CODEOWNERS

**What is unowned.** `check-security-owned-paths` reports 18 owned paths for this PR. It does not report these:

- `packages/shared/src/classification/registry.ts`. Its class decides between tokenisation and clear storage for every TASK-031 diff: a PER column reclassified INT lands in the immutable chain in clear.
- `apps/api/src/app.ts` and `apps/api/src/start-api.ts`: the audit-privacy composition and the `authenticate` seam.
- `packages/config/src/placeholders.ts`: the only guard between a committed `local-only-*` marker and a production vault key derived from it (§5.1).

None of these four paths would require a security record when changed later.

**Remediation.**
- Add `/packages/shared/src/classification/`, `/apps/api/src/app.ts`, `/apps/api/src/start-api.ts` and `/packages/config/src/placeholders.ts` (plus `string-redaction.ts` if PR61-SEC-01 reuses it) to `.github/CODEOWNERS`.
- Add the same paths to `REQUIRED_CODEOWNED_PATHS` in `tools/ci/check-workflow-policy.mjs`.

**Verification:** the policy test fails when one of the lines is removed.

### PR61-SEC-05 (INFO): `entity_id` is outside the credential-shape check

`entity_id` is a clear-text, hashed column. `ENTITY_ID` (`^[A-Za-z0-9][A-Za-z0-9_.:-]{0,255}$`) accepts a compact JWS (base64url and dots) and any opaque base64url token. The resolver is `auditEntityId` or a path parameter (`compileAudit`). A future token route, such as an invitation, a share link or a reset, whose resolver returns the token would persist it forever.

**Fix:**
- `prepareEntry`: `if (entityId !== null && isSecretText(entityId)) throw invalid('entityId')`;
- `entryFor`: keep the id only when `isAuditEntityId(id) && !isSecretText(id)`;
- route-metadata test: an `auditEntityId` never reads a parameter or field whose name `isSecretKey`.

### PR61-SEC-06 (INFO): IPv6 is not canonicalised before hashing

`canonicalIp` lower-cases IPv6 but keeps leading zeros and uncompressed groups. P4 shows that `2001:db8::1` and `2001:0db8:0000:0000:0000:0000:0000:0001` get different `ip_hash` values, and also different vault rows, because the dedupe works on the text. `ip_coarse` normalises through `ipv6Groups`, so the clear network and the hash disagree for such input.

The input is `req.ip` from the trusted proxy chain (D-ARCH-125), which is normally canonical. The effect is a missed exact-IP filter or erasure lookup, never disclosure.

**Fix:** format from `ipv6Groups` (lower-case hex without leading zeros, longest zero run of two or more compressed).

**Test:** the three spellings give one `ip_hash`.

### PR61-SEC-07 (INFO): classification deviates from the data model; decisions not recorded

data-model §3.4 classes `ip_token`, `user_agent_token` and `reason_token` "PER (token)". The registry classes them INT (D-TASK028-03), so that the SYSTEM-no-PII rule of C10 holds for `audit_entries` without an exception.

I accept the reasoning: the token is a pseudonymous reference whose value lives encrypted in the vault and disappears with erasure. It should still be one source of truth:
- principal-architect amends the §3.4 Class column (or C10 lists the three columns as exceptions);
- the registry header cites that amendment.

D-ORCH-126 says D-TASK028-01..10 are "as listed in the PR #61 body". At `57faf1f` the body (3,863 characters, no comments) names none of them, and DECISIONS.md only announces them. This round reviewed D-TASK028-03..07 from the dispatch brief and the code comments. The orchestrator should log all ten.

### PR61-SEC-08 (INFO): `ip_hash` erasure depends on key destruction

`ip_hash = HMAC-SHA256(AUDIT_INDEX_KEY, ip)` over a 2³² IPv4 space can be reversed by enumeration in hours on commodity hardware by anyone holding the key version. The api and worker hold it, and the register's blast radius already says "re-identification of hashed IPs". The hash stays in the immutable row and, at M5, in the Object Lock archive after the vault row is erased.

ADR-0007's "archives contain no personal data" therefore holds for `ip_hash` only once every key version that produced it is destroyed.

**Ask (principal-architect):**
- the ADR-0018 register states that a retired `AUDIT_INDEX_KEY` version is destroyed after the 90-day dual-read window;
- ADR-0007's erasure section states that `ip_hash` is erased by key destruction, not by the vault delete.

## 5. Requested checks

### 5.1 Vault tokeniser and keys

| Property | Result |
|---|---|
| Cipher and layout | AES-256-GCM, 96-bit `randomBytes` nonce per value, 128-bit tag, `nonce ‖ ct ‖ tag` (data-model §10.4) |
| AAD | `UTF-8(JCS(["audit_pii_vault", "ciphertext", token, ciphertext_key_id]))`. P4 refuses every swap: ciphertext into another row, token swapped, key-id label changed, the same bytes under another key id, and a flipped tag. Decrypting the own row succeeds |
| T-89 wording | The threat model's mitigation says "AAD = token‖subject‖class"; the implementation follows the later data-model §10.4 amendment (table, column, token, key id). `subject_id` and `classification` are not bound, but the vault is insert-only (`audit_vault_guard`; `platform_erasure` holds DELETE only), so re-attributing a row needs the superuser. Accepted; I align the T-89 text in the next threat-model round |
| Dedupe HMAC | HMAC-SHA256(`AUDIT_VAULT_HMAC_KEY`, UTF-8 value). The same value gives the same HMAC (P4), and the unique key is (subject, entity, field, value_hmac). On a dedupe hit the proposed ciphertext, encrypted under the proposed token, is discarded unseen, and the stored row keeps its own token and AAD |
| Key checks | AES exactly 32 bytes and HMAC at least 32 bytes, with an id of the form `<purpose>-v<n>` (P4: 16-byte keys refused for all three). Cross-purpose reuse: `createVaultTokeniser` itself accepts identical bytes for both roles (P4), but production keys come only from the validated configuration, whose `findDuplicateKeyMaterial` guard refuses the same material in two variables |
| Subject resolution | One lookup; only when a subject is missing, `INSERT … ON CONFLICT (kind, ref_id) DO NOTHING` and a second lookup (P4 statement trace). Under READ COMMITTED the second lookup sees a concurrent committed insert. Note, no finding: the insert order follows first occurrence, so two concurrent first-time flushes holding the same two new subjects in opposite order could deadlock once. Sorting `missing` by key makes that impossible |
| Rotation | Writes use the current key id. `decryptVaultValue` refuses another key version, so there is no dual read of `AUDIT_VAULT_KEY_PREVIOUS` yet; the viewer (TASK-031/060) and the re-encrypt job must add it. A rotation of the HMAC key gives new tokens (data-model, accepted). With random 96-bit nonces the per-key bound is about 2³² stored encryptions; dedupe stores only distinct values and the register rotates yearly. No concern at M1 volumes |
| `local-only-*` (D-TASK028-06) | The derivation `SHA-256("platform-audit-local-key\0" ‖ key_id ‖ "\0" ‖ marker)` is deterministic, distinct per key id and 32 bytes long (P4). P6: of 10 values, every one that `parseKeyVersion` marks `localOnly` (4 marker spellings) is refused by `isPlaceholder`, and the case, full-width, percent and whitespace variants fail parsing. The random-key control passes both. `placeholderGuard` returns `placeholder` for `production` and nothing for `local`. `APP_ENV` is required and closed, and `localAppEnvOnEcsGuard` refuses `local`/`test` on ECS. **Holds.** Optional hardening, no ID: `auditPrivacyFrom` refuses a `localOnly` key unless `isLocalAppEnv(config.APP_ENV)`, so the derivation does not rest on `placeholders.ts` alone (PR61-SEC-04) |
| Key bytes in objects | `util.inspect(…, {showHidden: true})` and the JSON of `createAuditPrivacy(…)` contain no key bytes and no `Uint8Array` (P4); keys live in closures |

### 5.2 `ip_hash`

HMAC-SHA256 under `AUDIT_INDEX_KEY` (at least 32 bytes) over `canonicalIp(ip)`, with `ip_hash_key_id` set and the 32-byte length checked by the writer. The integration test recomputes the HMAC for `127.0.0.1` and compares it. See PR61-SEC-06 (IPv6 spelling) and PR61-SEC-08 (enumeration).

### 5.3 Classification

The registry covers the 14 live tables, and lookups use own keys only. C10 runs two ways (unclassified and stale) against `information_schema.columns` of `public` and `platform`, ordinary and partitioned tables, partitions excluded. It also checks the SYSTEM-no-PII rule and the §10.4 `<col>_key_id` siblings. All of it is green in lane B, with planted-data negatives in the unit test. The Prisma-schema completeness check (AT-US-091-04) is one-way, which is correct because the bootstrap-lane tables are not Prisma models.

Both caveats fail closed:
- a table in the `platform` schema would be reported as unclassified;
- views are out of scope, since they hold no data.

`permissions`/`roles` are INT except `description`, `category` and `name_key` (PUB), and `role_permissions` is INT, as ADR-0008 am. 3 item 6 states. **PR8-SEC-10 closes** for its classification part. On the token columns see PR61-SEC-07, and on ownership see PR61-SEC-04.

### 5.4 User-agent parser

P3 results:
- 300,000 fuzzed headers: 0 outputs outside "family [major 1-4 digits] [/ OS]" built from the exported tables, 0 rejected by the writer's `isAuditUaParsed`, and 0 over the bound `2 · min(len, 512) + 1` (maximum observed 547);
- time per call is flat at 10-17 µs from 1 kB to 1 MB for separator-only, one-word, slash-heavy and paren-only headers, because the cut to 512 code units comes before any scan;
- no regular expression, hence no ReDoS;
- the six real headers parse as expected (Edge 142 / Windows, Safari 18 / iOS, Samsung Internet 27 / Android, Firefox 146 / Linux, curl 8, Safari 18 / macOS).

No character of the header other than version digits reaches `ua_parsed`. The raw header is a PERSONAL vault value, cut to 1,024 code points by the writer.

### 5.5 `AppDependencies.authenticate` (D-TASK028-07)

Not reachable in production:
- `startApi` passes `createApp` a closed object literal (`start-api.ts:129-139`) with no spread of external input;
- `main.ts` runs `API_PROCESS`;
- `createApp` has no other non-test caller (`git grep`);
- `start-api.test.ts` asserts `'authenticate' in composed === false`.

The seam replaces only the authentication slot; the capture behind it is still the composed one (unit test). It grants less than the older `pipeline` seam. Optional hardening, no ID: `createApp` throws when `authenticate` is set and `apiMode === 'live'`. Remove the seam with TASK-052.

### 5.6 Exports

See PR61-SEC-02. The pure exports (`isSecretKey`, `isSecretText`, `keyWords`, `REDACTED`, `redactRecord`, `redactSecrets`, the parser, `createIpIndex`, `UNATTRIBUTED_SUBJECT`) carry no capability and may stay open.

### 5.7 Logs

There is no new log statement in the 23 code files. Thrown messages carry names and sizes only ("AUDIT vault key must be 32 bytes", "vault row was encrypted under another key version", `UnclassifiedFieldError` with entity and field, never the value), and `AuditWriteError('TOKENISER_FAILED')` carries none.

The capture's failure line is class-only (`errorClass`, `code`, `reason`), and the boot refusal logs `slot`, `operation`, `requirement` and `owner`. A malformed key at boot reaches the process error handlers as one redacted line without a value.

The log's `token` key-part rule can only over-redact a field name. No log line here has a key containing `token`, and upper-case catalogue codes such as `TOKENISER_FAILED` stay readable (`CATALOGUE_IDENTIFIER`).

No PERSONAL value or key material reaches a log.

## 6. Evidence, state of main, merge readiness

- **Lane A 44093229169** (header table): fast-lane green, and the scans in ci-gate green. `security-integration` was skipped because `record_ok=false`. Per `tools/ci/lane-scope.mjs` it becomes due (`pull_request && security_paths && record_ok && no proof`) on the push that carries this record. It then runs the security suites, `catalog-c1-c14` with the new C10 cases included, on the merge ref with `main`.
- **PR #57 and D-ORCH-126's open point.** The merge ref includes PR #57's `tools/test-support/fs-lock.ts` change. The hosted run therefore re-checks C10 on the merged tree, which answers D-ORCH-126's open point for the catalog suites. The composition integration cases (`integration` suite) are not in the security-integration list. Whether lane B is re-queued for them is the orchestrator's call; the change has no security interaction.
- **State of main.** `origin/main` moved from `732ad20` to `80dce9e` (docs only) during this round. Main's code changes since `d173d8f` are PR #57's 8 harness files, which overlap none of the PR's 32 files. `git merge-tree` against `origin/main` is clean.
- **Record check.** `check-security-owned-paths --base d173d8f --pr 61` was `missing` (18 owned paths) before this record and `pass` on the record commit, with the Head row bound to `57faf1f`. Any later push to one of the 18 owned paths voids this record. A docs-only commit, or a merge of main that does not touch them, does not.

## 7. Closed and carried items

| Item | Status |
|---|---|
| D-SEC-PR56-01 condition 1 (wiring before the first audited route) | **Closed at merge.** `startApi` composes the tokeniser, IP index and parser from the validated keys, and the integration test proves D-ARCH-141's acceptance: one `PERMISSION_DENIED` entry whose tokens decrypt, with `ip_hash` and `ua_parsed`. Condition 2, the mount refusal of D-TASK029-21, stays as the backstop and is still tested (exit 78) |
| PR56-SEC-08 (LOW, the TASK-028 deferral) | **Closed** with the above |
| PR8-SEC-10 (classification part) | **Closed** (§5.3) |
| T-87 (PII outside tokenised fields) | Mitigated as designed. Residuals: PR61-SEC-03 and PR61-SEC-08 |
| AT-US-091-05 (hash over `[REDACTED]`) | Holds: redaction happens in the snapshot, before the hash. Strength of the matcher: PR61-SEC-01 |

## 8. Proposed decision text (for the orchestrator)

**D-SEC-PR61-01 · 2026-11-17 · security-analyst · PR #61 (TASK-028) security r1 = PASS_WITH_FOLLOW-UPS at `57faf1f`.** 0 Critical/High; 1 MEDIUM, 3 LOW, 4 INFO.
- **Closed:** D-SEC-PR56-01 condition 1 (at merge), PR56-SEC-08, and PR8-SEC-10 (classification).
- **PR61-SEC-01 (MEDIUM):** union the audit denylist with `@platform/shared/logging` `isSensitiveKey` and the log's credential shapes, add record pairing, and add a corpus and generated-spelling test. Do it in this PR's fix cycle if there is one, else before the first writer caller that records objects (TASK-031/052/047), whichever merges first.
- **PR61-SEC-02 (LOW):** extend `AUDIT_WRITER_EXPORTS` and allow-list `start-api.ts`.
- **PR61-SEC-03 (LOW):** principal-architect logs D-TASK028-04 and decides the retention of UNATTRIBUTED vault rows and the `erased_at` handling. The filter-value subject becomes the authenticated actor.
- **PR61-SEC-04 (LOW):** CODEOWNERS lines with the PR48-SEC-02 activation PR.
- **INFO:** 05 and 06 go to TASK-031; 07 and 08 go to principal-architect and the orchestrator.

Reversibility: High.

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_FOLLOW-UPS.** The vault encryption, AAD binding, key handling, the `local-only-*` gate, the user-agent parser and the production composition are sound, and D-SEC-PR56-01 condition 1 is met. The `authenticate` seam cannot be reached in production, and nothing personal or secret reaches a log. The denylist sits in the right place but is weaker than the log's, for a sink that can never be cleaned (MEDIUM, latent until a writer records free-form objects). The remaining items are lint, ownership, erasure-design and documentation follow-ups. No Critical or High finding is open for this change |
