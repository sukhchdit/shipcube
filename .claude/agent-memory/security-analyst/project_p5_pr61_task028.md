---
name: project-p5-pr61-task028
description: PR #61 (TASK-028 audit redaction, classification registry, vault tokeniser, UA parser, startApi privacy wiring) security r1 @57faf1f PASS_W_F-U, record 18cd325 pushed; 01 MEDIUM audit denylist weaker than log matcher; LOW 02-04; INFO 05-08; probe kit; R1b independent pass @e526b11 (orch-delivered record = r1 + appended section) adds LOW 09 PER-JSON/reason secrets reach vault, INFO 10 C10 class pin; R2 @d51b42b PASS_W_F-U (D-SEC-PR61-03, main dbd2bb7): 01-10 closed or routed except 04, new LOW 11 pairs-in-text, INFO 12 mapped IPv4
metadata:
  type: project
---

Record `docs/05-quality/security/PR-0061-TASK-028-security-review.md`, committed by me as `18cd325` in worktree `Shipqube-TASK-028`. Head row is `57faf1f` (code `e526b11`) on base `d173d8f`, with 18 owned paths. The code-review twin had not landed, so mine went out as a single push. Lane A 44098391317 started on `18cd325`; security-integration should be due there (lane-scope rule: `security_paths && record_ok && no proof`).

**Closed:** D-SEC-PR56-01 condition 1 (at merge), PR56-SEC-08, PR8-SEC-10 (classification part).

**Findings (proposed D-SEC-PR61-01):**
- **01 MEDIUM (CWE-212)** — the audit `denylist.ts` (word split + 14 compounds; `isSecretText` matches only the prefixes bearer/basic/digest/eyJ) is weaker than the log's `@platform/shared/logging` `isSensitiveKey` / `redactString`.
  - P1: 53 of 64 keys reach the row via `prepareEntry` → `complete()`; the log redacts 42 of them. P2: 15 of 15 credential values are kept, and the log redacts all of them.
  - The misses include `X-Reauth-Proof`, `__Host-rt_web`, `CSRFToken`, `refreshtoken`, `password2`, `*_KEY` names and `{name,value}` records.
  - Fix: a union with the log matcher, plus record pairing and a generated-spelling test.
  - Due: this PR's fix cycle, else before TASK-031/052/047.
- **02 LOW** — `createVaultTokeniser`, `createAuditPrivacy`, `decryptVaultValue` and `auditKeyOf` are missing from `AUDIT_WRITER_EXPORTS`. P5 shows a module import of them is lint-clean.
- **03 LOW** — UNATTRIBUTED (ANONYMOUS) subject. Affected: authenticated filter values (`subject: null`), anonymous IP/UA and API_KEY actors. There is no erasure by subject, no vault retention, and `erased_at` is ignored. Owner: principal-architect.
- **04 LOW** — CODEOWNERS lacks `packages/shared/src/classification/`, `apps/api/src/{app,start-api}.ts` and `packages/config/src/placeholders.ts`.
- **INFO:**
  - 05: `entity_id` admits JWS-shaped values;
  - 06: IPv6 is not canonicalised to RFC 5952 before `ip_hash`;
  - 07: D-TASK028-03 classes the token columns INT against data-model "PER (token)"; D-TASK028-01..10 are not in the PR body despite D-ORCH-126;
  - 08: `ip_hash` can be reversed by IPv4 enumeration until the key version is destroyed.

**Verified sound:**
- AES-GCM AAD binding (5 swap/tamper probes refused) and the local-only gate (P6: every `localOnly` parse is refused by `placeholderGuard`).
- The UA parser (300k fuzz runs closed, steps ≤ 2·512+1, flat timing).
- The `authenticate` seam is unreachable from `startApi`.
- No log leaks.

**How to apply (round 2 / later tasks):**
- Re-run P1/P2/P7 against the new head; every leak row must flip.
- Re-run P5 with the four names, which must be flagged, while `start-api.ts` stays clean.
- **TASK-031 review:** check the filter subject (03), `entity_id` (05), the IPv6 canonical form (06) and the decrypt dual-read.
- **Checker gotcha:** it reads records from the `--root` WORK TREE, so a "record-less head" control passes once the worktree holds the record. Use the pre-record run as the control.

**Kit** (session scratch `pr61/probes/`): `hooks.mjs` is a no-junction resolve hook. `PROBE_EXT` is a `git archive` extract; bare specifiers from the extract resolve via `PROBE_MAIN`'s `package.json`; `@platform/x` resolves to `src/index.ts`; types are stripped. The probes are `p1-denylist`, `p2-values`, `p3-ua`, `p4-vault`, `p5-lint` (worktree config), `p6-localonly` and `p7-digits`.

**Round 2 (2026-11-18), code head `d51b42b`, tip `c39a993` evidence only — PASS_W_F-U, D-SEC-PR61-03.** Record committed on main as `dbd2bb7`, as a separate file `PR-0061-TASK-028-security-review-r2.md`, because appending to the branch's round-1 path is an add/add merge-ref conflict (proved with `merge-tree`, exit 1). Owned paths: 34 vs merge base `538f0b0`.
- **Closed:** 01, 02, 06, 07, 09, 10. 03, 05 and 08 are closed for the PR, with routes to EPIC-B-413/303 and TASK-031. 04 (CODEOWNERS, plus `string-redaction.ts`) stays open with devops.
- **New 11 LOW** (key=value pairs inside strings, flat `rawHeaders`, `{Name,Value}`, `kek`/`dek`). The narrow pair predicate is validated in `p-r2b.mjs`; owner is TASK-031 together with code R2-m1.
- **New 12 INFO** (IPv4-mapped spellings other than `::ffff:dotted`).
- **D-ORCH-133 rewrite:** passes the D-SEC-PR64-02 conditions. Gitleaks emulation found 0 on `538f0b0..c39a993`; the pre-rewrite range is the positive control (1 private-key hit).

**Facts:**
- The audit denylist now delegates to the log's `isSensitiveKey` and to a new `hasCredentialShape`, so `string-redaction.ts` changes affect the immutable trail.
- The JUnit evidence can carry credential-shaped values in `it.each %s` titles. Lane B gitleaks-full never scans the evidence commit; only lane A's range scan does.

**Kit** (session scratch `pr61r2/`): `probes/{hooks,p-r2,p-r2b,p3p4,p5-lint,record-sim}.mjs` and `gl/gl-emul.mjs` (221 rules, repo allowlists). `record-sim.mjs` creates its temp dir next to the record file: point it at a scratch copy, never at the checkout (a stray dir was left once and removed).

Related: [[project-p5-pr56-task029]], [[project-p5-pr20-logging]], [[project-p5-pr48-rbac-matrix]], [[project-security-review-conventions]]

**Round 1b (2026-11-17, independent pass, second orchestrator session, D-ORCH-COORD-01):** I was dispatched for r1 in parallel with the instance that wrote 18cd325 and found it only at the end. Delivered to `.orch/records/PR-0061/PR-0061-TASK-028-security-review.md`: round 1 text verbatim plus an appended `# Round 1b` section, with its own `| Head | e526b11… |` row and a final Verdict row (PASS_WITH_FOLLOW-UPS). The sim with main's checker: S2 (my Head row alone) passes bound to e526b11; FAIL-verdict, owned-change-after and no-record controls all fail as expected. New items, proposed as D-SEC-PR61-02:
- **09 LOW (CWE-212):** `redactRecord` tokenises a PER/SPER JSON value whole (`personalText` = `JSON.stringify`, only `isSecretText` on the text), so a nested password/api_key/Bearer reaches the vault (P3 3/3; the INT control is redacted). The own `reason` skips `isSecretText` (entry.ts:578-581). Fix: `JSON.stringify(redactSecrets(v))`. Fix cycle 1 with 01, else before TASK-031.
- **10 INFO:** C10 checks only the key-id sibling of the §10.4 columns, not their class (a misclassified `value_ciphertext` is in clear). Pin the data-model class per KEY_ID_SIBLINGS row; the classes are mixed (SEC, SPER, INT for customer_ref_postcode_hmac), so not all are SECRET.
- Corpus additions for 01 (both matchers miss): cc_number/ccNumber, codes, mfa_seed, pw, whsec, csrf, plus 5 `*_key` names. The value fix should require a token68 credential after the scheme (independent code review R1-m3 (a): `Basic economy` is redacted forever).
**How to apply (delta round after fix cycle 1):** check that 09 is in the fix and that the generated-spelling test draws from an oracle, not from `SECRET_KEY_EXAMPLES` (self-referential).
