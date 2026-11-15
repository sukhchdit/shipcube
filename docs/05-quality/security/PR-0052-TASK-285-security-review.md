# PR-0052: TASK-285 audit action vocabulary v2, security review

| Field | Value |
|---|---|
| PR | #52 `feat(audit): widen the action CHECK to the 20 REQ-AUDIT-002 actions (TASK-285)`, https://github.com/sukhchdit/shipcube/pull/52, branch `feat/TASK-285-audit-actions-v2`. Five commits on the merge base `73addb0`: `34136cd` (widening file, vocabulary, parity and lane tests), `d8ed84f` (guard-plant lane copy without 91), two merges of `main` (`b9dd80b`, `552a772`) and `a718dcd` (evidence only: 9 added files under one run directory). `main` was `cb96be4` when this round was written; since the merge base it has moved by docs, code-review records and agent notes only (`docs/sdlc/DECISIONS.md`, `docs/sdlc/STATUS.md`, `docs/05-quality/reviews/PR-0052-*` and `PR-0053-*`, `.claude/agent-memory/{senior-developer,code-reviewer}/*`) |
| Head | a718dcd4dd528c8890e6c4e70d5e481f6c137eff |
| Lane A evidence | Run 43721397887 on `a718dcd`. **fast-lane `success`**: workflow policy, install flags, "Released migrations are immutable", lockfile, licences, signatures, audit, "Lane B evidence" (run `20261115T1311Z_552a772` accepted), lint, format, type-check, unit, build. **scans**: "Gitleaks (PR commit range)" `success`; the only red step is "Security-owned paths need a review record" (10 owned paths, no `PR-0052-*` record). `ci-gate` is red only as the aggregate. This file is the missing record |
| Owned paths changed | 10: `prisma/bootstrap/91-audit-actions-v2.sql` (new), `tools/db/shadow-init.ts`, `packages/audit/src/actions.ts`, and the tests `packages/audit/src/actions.test.ts`, `prisma/tests/audit/audit-actions-v2.int.test.ts` (new), `prisma/tests/bootstrap/bootstrap.int.test.ts`, `prisma/tests/catalog/c01-c12.int.test.ts`, `tools/db/bootstrap.test.ts`, `tools/db/lint-migrations.test.ts`, `tools/db/shadow-init.test.ts` |
| Unowned paths changed | The run directory `docs/05-quality/tests/runs/20261115T1311Z_552a772/` (9 files) |
| Binding items checked | data-model §8.3 rule 12 and the audit DDL lane (D-TASK015-01, D-ARCH-119, ADR-0007 amendment 11 item 4), D-TASK285-01..07, REQ-AUDIT-002, AT-US-087-05/-07, PR12-SEC-03, PR24-SEC-06 (the marker binds a reviewer and a date, the record binds the blob), D-SEC-PR23-02 (evidence commit shape) |
| Reviewer / date | security-analyst, 2026-11-15, round 1. Read-only. Git object reads ran in the main checkout. Probes ran on type-stripped extracts of `tools/db/shadow-init.ts` and `tools/db/sql-text.ts` (head and merge base) and on scratch copies in the session scratchpad; no junction, no install, no Jest, no Docker, no commit. One `tsc --noEmit` ran on a scratch file (§7). The record simulation used a sparse `git clone --shared`. In the PR worktree I only wrote and read this file (no git command there). Line numbers come from single-file reads at `a718dcd`. The code-review twin `docs/05-quality/reviews/PR-0052-TASK-285-code-review.md` (APPROVED_WITH_NITS) landed on `main` in `cb96be4` while this round was being written; I read it before finalising and cite its IDs (routing in D-ORCH-099) |

## 1. Summary

The PR widens `ck_audit_entries__action` from the 18 values of the released `10-audit.sql` to the 20 REQ-AUDIT-002 actions (`MFA_RECOVERY_USED` and `SESSION_REVOKED` join) in a new bootstrap file `prisma/bootstrap/91-audit-actions-v2.sql`. It extends `AUDIT_ENTRY_ACTIONS`, rewrites the parity test to replay the lane, pins the contract-enum gap at compile time, and teaches the shadow-database rendering one new statement form.

The widening file does exactly what D-ARCH-119 asks and nothing else. It is one `ALTER TABLE public.audit_entries DROP CONSTRAINT IF EXISTS … , ADD CONSTRAINT … CHECK (…)` under `SET ROLE platform_audit_owner`, a strict superset of the released list, idempotent, applied once through the ledger, and it touches no grant, policy, trigger, function, event trigger or owner. The guard of `90` admits it only as the audit owner, the immutability triggers still refuse the superuser after the upgrade, and the immutability check and the runner refuse every out-of-order or in-place change. **Rule-12 approval is granted for blob `9945c349e2334c60b1b2238d438ad8827b2a7b22` (§5).**

One defect is in the new shadow-init KEEP form: its comment promises "no third action" and "no NOT VALID / NO INHERIT tail", but a constraint attribute placed between the CHECK and a further action defeats the regex, so a multi-action `ALTER TABLE` (for example `… CHECK (…) NOT VALID, DISABLE TRIGGER ALL, ADD CONSTRAINT z CHECK (true)`) is kept verbatim (PR52-SEC-01, LOW). It affects only the shadow database and the fail-closed tripwire; the real lane stays under rule 12, CODEOWNERS and the catalog tests. The code review ruled the form "narrow and safe" after refusing these attributes as a tail; the interposed shape is the gap. The contract-enum gap (D-TASK285-02) is pinned correctly; its api-designer change request had no due point (PR52-SEC-02, INFO, the same item as code review R1-m1, now routed to TASK-073 by D-ORCH-099).

Findings: 0 Critical, 0 High, 0 Medium, 1 LOW, 1 INFO.

**Verdict: PASS_WITH_FOLLOW-UPS.**

## 2. Method

1. Read the full diff `73addb0...a718dcd`, the released `10-audit.sql` (blob `c3d4db9`) and `90-audit-ddl-guard.sql` (blob `9aab9aa`), `tools/db/bootstrap.ts` (ledger), `tools/ci/check-migration-immutability.mjs`, `tools/db/lint-migrations.ts` (rule 12), `tools/db/shadow-init.ts` and `tools/db/sql-text.ts`, D-ARCH-119, D-TASK285-01..07, REQ-AUDIT-002, data-model §1.7 and amendment A27, ADR-0007 amendment 11 item 4, the WAVE-00/WAVE-01 cards of TASK-059, TASK-061 and TASK-073.
2. **Blob and content check** of the widening file: blob SHA, statement list, value-list superset and order against `10-audit.sql` and REQ-AUDIT-002 (script, §5 and §6).
3. **Immutability-policy probe**: `checkBootstrapChanges` from `main`'s `check-migration-immutability.mjs` over five name-status cases, plus the real CLI over `origin/main..pr/52` (§5 item 4).
4. **KEEP-form probe** (`keep-probe.mjs`): `renderShadowInit` of the head and of the merge base side by side, type-stripped, over 7 controls and 7 attack shapes (§4). PostgreSQL 18 acceptance of the shapes is grammar-confirmed from `REL_18_STABLE` `gram.y` (`alter_table_cmds ',' alter_table_cmd`, `CHECK '(' a_expr ')' ConstraintAttributeSpec`, `ConstraintAttributeElem` = `NOT VALID | NO INHERIT | NOT ENFORCED | …`), not executed.
5. **Parity script** (`parity.mjs`): REQ-AUDIT-002, `91`, `AUDIT_ENTRY_ACTIONS`, catalog C9 list, data-model §1.7 and the three `openapi.yaml` enums, read with `git show` at the head (§6).
6. **Contract-pin mutation control**: the pin's type shape over four contract variants with `tsc --noEmit --strict` (§7).
7. Evidence checks: lane A step list, the run's JUnit (counts per changed test file, 0 failures), the attachment hash, a count-only host-fragment scan with a positive control, a secret-shape scan, and the evidence-commit shape (§8).
8. Record simulation (§11).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR52-SEC-01 | The new shadow-init KEEP form keeps a multi-action `ALTER TABLE` when a constraint attribute (`NOT VALID`, `NO INHERIT`, `NOT ENFORCED`) sits between the CHECK and the next action; it also keeps a same-name CHECK that replaces a primary key, foreign key or unique constraint. The comment's "no third action" guarantee and the fail-closed tripwire do not hold for these shapes | LOW | CWE-185 | A08 | `tools/db/shadow-init.ts:153-158`; fixtures `tools/db/shadow-init.test.ts:130-155` | senior-developer / database-engineer: this PR's fix cycle if one opens, else DUE before the next bootstrap-lane file merges. Extends code review R1-n1 (unpinned lookahead); the review's V6 refused the attributes only as a tail |
| PR52-SEC-02 | The contract-enum gap (D-TASK285-02) is pinned at compile time, but the api-designer change request had no tracked owner or due point; the TASK-073 card did not name it, so the audit viewer could ship enums that cannot return or filter `SESSION_REVOKED` and `MFA_RECOVERY_USED` entries | INFO | CWE-778 | A09 | `docs/03-architecture/api/openapi.yaml` (three enums, 18 values); `packages/audit/src/actions.test.ts:146-161`; `docs/04-plan/tasks/WAVE-01.md` (TASK-073 card) | Same item as code review R1-m1; routed by D-ORCH-099 to an AC line on TASK-073, due before TASK-059/061 emit. Closes when that AC line is on the card |

## 4. Finding details

### PR52-SEC-01 (LOW): the KEEP form accepts more than a same-name CHECK replacement

**Description.** The new KEEP pattern (`shadow-init.ts:156-158`) is

```
^alter table (?:only )?QNAME drop constraint (?:if exists )?(NAME) ?, ?add constraint \1 check ?\((?:(?!\) ?, ?[a-z])[^;])*\)$
```

applied to `statementCode()` (comments to a space, strings and dollar bodies blanked, whitespace collapsed, lower case). The tempered token refuses only a `)` directly followed by `,` and a letter, and the anchor `\)$` refuses only a tail after the last `)`. A constraint attribute between the CHECK's closing parenthesis and the comma breaks both assumptions: `) not valid, <action> … (…)` contains no `) ,` sequence, and the statement still ends in `)`. The pattern also cannot see what kind of constraint the DROP removes.

**Probe** (head versus merge base, same renderer input; base refuses all of them because it has no such KEEP form):

| Case (statement after the shared prefix `ALTER TABLE public.audit_entries DROP CONSTRAINT IF EXISTS ck_audit_entries__action, ADD CONSTRAINT ck_audit_entries__action CHECK (action IN ('A','B'))`) | Head | Expected |
|---|---|---|
| Control: the real `91` file | kept | kept |
| Control: the bare replacement | kept | kept |
| Control: `NOT VALID` tail | refused | refused |
| Control: `, ADD COLUMN y int` | refused | refused |
| Control: `/* c */ , DISABLE TRIGGER ALL` | refused | refused |
| Control: other constraint name | refused | refused |
| Control: `NOT VALID, OWNER TO …` (ownership refusal, line 198) | refused | refused |
| `NOT VALID, DISABLE TRIGGER ALL, ADD CONSTRAINT z CHECK (true)` | **kept** | refused |
| `NO INHERIT, NO FORCE ROW LEVEL SECURITY, ADD CONSTRAINT z CHECK (true)` | **kept** | refused |
| `NOT ENFORCED, DISABLE ROW LEVEL SECURITY, ALTER COLUMN action SET DEFAULT ('A')` | **kept** | refused |
| `NOT VALID, DROP CONSTRAINT ck_audit_entries__outcome, ADD CONSTRAINT z CHECK (true)` | **kept** | refused |
| `NOT VALID, ADD COLUMN y int CHECK (y > 0)` | **kept** | refused |
| `DROP CONSTRAINT pk_audit_entries, ADD CONSTRAINT pk_audit_entries CHECK (true)` | **kept** | refused (not a CHECK replacement) |

All 7 controls behaved as expected. A 204,059-character pathological statement rendered in 118 ms, so there is no ReDoS concern (the input is the trusted lane anyway). The code review's 17-form probe (its V6) refused `NOT VALID`, `NO INHERIT` and `NOT ENFORCED` as a tail and noted the PK-replacement residual as harmless; it did not try an attribute followed by a further action. Its R1-n1 (the lookahead is pinned by no fixture) is the test-side half of this finding: the remediation below makes the lookahead unnecessary.

**Exploitability and impact.** The rendering runs only against the migrator-owned shadow database that `migrate dev` / `migrate diff` use, so a kept statement cannot reach a real database. What weakens is the tripwire: until now an unknown bootstrap statement form failed `prisma.config.ts` at load ("statement form not recognised"), which forced a change to the security-owned `shadow-init.ts`. A bootstrap file that also disabled audit triggers or row level security in the same `ALTER TABLE` would now render silently. On the real lane such a file still needs the rule-12 marker, a security record that approves its exact blob, CODEOWNERS review, and it would fail the catalog tests that read trigger and RLS state, so the delta is defence in depth plus shadow fidelity (a `NOT VALID`/`NOT ENFORCED` CHECK in the shadow differs from what the comment promises). Impact M, likelihood L: LOW.

**Remediation (code level).** Replace the tempered regex by a prefix match plus a balanced-parenthesis scan that skips quoted identifiers, so the CHECK's own closing parenthesis must be the last character:

```ts
const CHECK_REPLACEMENT = new RegExp(
  `^alter table (?:only )?${QNAME} drop constraint (?:if exists )?(${NAME}) ?, ?add constraint \\1 check ?\\(`,
);

/** A same-name CHECK replacement whose CHECK expression ends the statement (strings are already blanked). */
function isCheckReplacement(text: string): boolean {
  const head = CHECK_REPLACEMENT.exec(text);
  if (head === null) return false;
  let depth = 1;
  for (let i = head[0].length; i < text.length; i += 1) {
    const c = text[i];
    if (c === '"') {
      const close = text.indexOf('"', i + 1);
      if (close < 0) return false;
      i = close;
    } else if (c === '(') depth += 1;
    else if (c === ')' && --depth === 0) return i === text.length - 1;
  }
  return false;
}
```

Use it in place of the KEEP entry (`if (!KEEP.some(…) && !isCheckReplacement(text)) throw …`). I ran this function over the head's `statementCode()` on 12 cases (the real `91` statement, the bare form, `ONLY` with tight commas, a nested-parenthesis body, the six attack shapes above and two quoted-identifier shapes): it keeps the first four and refuses the other eight, 0 mismatches. Optionally require that the dropped name starts with `ck_` (the data-model naming rule for CHECK constraints), which also refuses the PK/FK/UNIQUE replacement. Correct the comment at lines 153-155 to what the code enforces.

**Verification test.** Add to the refusal table of `shadow-init.test.ts`: `…CHECK (note <> '') NOT VALID, DISABLE TRIGGER ALL, ADD CONSTRAINT z CHECK (true);`, the same with `NO INHERIT, NO FORCE ROW LEVEL SECURITY` and with `NOT ENFORCED, ALTER COLUMN note SET DEFAULT ('x')`, a CHECK body that contains a quoted identifier with a parenthesis (`CHECK ("a)b" <> '') NOT VALID, ADD COLUMN y int CHECK (y > 0)`), and `DROP CONSTRAINT pk_x, ADD CONSTRAINT pk_x CHECK (true)` if the `ck_` rule is adopted. Keep the two existing keep cases and the real-lane case at line 231 green.

### PR52-SEC-02 (INFO): the contract change request needs a due point

**Description.** `openapi.yaml` lists 18 actions in `AuditEntry.action`, `AuditEntrySummary.action` and the `listAuditEntries` `filter[action]` enum (parity script, §6). D-TASK285-02 routes the fix to api-designer and the PR pins the gap: `ContractParity` (`actions.test.ts:146-161`) requires every contract value to be an entry action and the missing set to be exactly the two new values. The pin works (mutation control, §7), but it only forces an update of the test when the contract changes; nothing forces the contract change. The TASK-073 card (audit viewer API) does not mention the gap, and TASK-059/061 (the first emitters) will write such entries first.

**Impact.** If TASK-073 shipped against the 18-value enums, entries with the two actions would fail OpenAPI response validation (a 500 or a dropped row in the viewer) and an auditor could not filter for `SESSION_REVOKED` or `MFA_RECOVERY_USED` (request validation 400). That is a review gap for exactly the account-takeover signals the two actions exist for (CWE-778 class), not a data exposure.

**Status.** Code review R1-m1 raised the same point and D-ORCH-099 routed it while this round was being written: an AC line on TASK-073, due before TASK-059/061 emit the new actions. This INFO closes when that line is on the card. **Remediation.** The orchestrator logs the change request with an owner (api-designer) and adds a DUE line to the TASK-073 card: "contract enums carry the 20 REQ-AUDIT-002 actions (D-TASK285-02); `actions.test.ts` `ContractParity` second element becomes `never` in the same PR". Verification: after the contract PR, `types.gen.ts` lists 20 values, the pin is updated to full equality, and TASK-073's response-validation api test includes one `SESSION_REVOKED` entry.

## 5. Rule-12 approval of `prisma/bootstrap/91-audit-actions-v2.sql`

**Approval statement.** Rule-12 approval (data-model §8.3 rule 12; audit DDL lane, D-TASK015-01, D-ARCH-119) is **granted for `prisma/bootstrap/91-audit-actions-v2.sql` at blob `9945c349e2334c60b1b2238d438ad8827b2a7b22`** (35 lines, marker line 3 `-- @audit-ddl security-approved: security-analyst 2026-11-15`). `10-audit.sql` (blob `c3d4db9f3125d4915c0ff9d1ce1132d0e8e0e713`) and `90-audit-ddl-guard.sql` (blob `9aab9aaab73fcb53e3f8a5e835d7d451af606be3`) are unchanged by this PR and stay approved. Any other blob of `91` needs a new security record; once a database applies the file, the ledger sha256 binds it (PR24-SEC-06).

| # | Requested check | Result |
|---|---|---|
| 1 | Only widens the action CHECK (DROP IF EXISTS + ADD) under `SET ROLE platform_audit_owner` | **Met.** Code statements, in order: `SET search_path = pg_catalog, pg_temp` (line 25), `SET ROLE platform_audit_owner` (26), one `ALTER TABLE public.audit_entries DROP CONSTRAINT IF EXISTS ck_audit_entries__action, ADD CONSTRAINT ck_audit_entries__action CHECK (action IN (…))` (28-33), `RESET ROLE` (35). No other statement; no psql variable. The list holds 20 distinct values; the 18 values of `10-audit.sql` are all present (none removed, none renamed), the two additions are `MFA_RECOVERY_USED` and `SESSION_REVOKED`, and the order equals REQ-AUDIT-002. No `ONLY`, so the parent and every partition get the constraint; `10-audit.sql:77` keeps "no DEFAULT partition", so no catch-all partition exists to escape the CHECK |
| 2 | Does not weaken immutability, the DDL guard, grants or RLS | **Met.** The file has no GRANT, REVOKE, POLICY, ROW LEVEL SECURITY, TRIGGER, FUNCTION, EVENT TRIGGER, OWNER or AUTHORIZATION clause. The `90` guard returns early only when `current_user = 'platform_audit_owner'` (`90-audit-ddl-guard.sql:55`), which the file reaches through `SET ROLE`; the integration test proves the same statement is refused with 42501 for the superuser without `SET ROLE` (guard message) and for the migrator (not the owner) (`audit-actions-v2.int.test.ts:316`), that both event triggers are still enabled ALWAYS after the upgrade (`:359`), and that UPDATE, DELETE and TRUNCATE still raise `AUDIT_IMMUTABLE` for the superuser and 42501 for `platform_app` on a new-action entry (`:291`). The CHECK expression is deparsed with operator OIDs fixed at creation under `pg_catalog` first. The lock is bounded: the runner sets `lock_timeout` for the session (`bootstrap.ts:255`) and each file runs under `statement_timeout = 5min` in one transaction (`:141`); a timeout rolls back, and writers blocked meanwhile fail closed (the audit write is inside the business transaction) |
| 3 | Idempotent | **Met.** `DROP CONSTRAINT IF EXISTS` + `ADD` in one statement re-asserts the same constraint. Proven on PostgreSQL 18 in the evidence run: a second lane run applies nothing, and with the ledger row deleted the file re-applies and leaves an identical `pg_get_constraintdef` (`:359`, `:392`). Partitions show `conislocal = false`, `coninhcount = 1`, the parent's definition, before and after, including partitions created after the upgrade (`:385`) |
| 4 | Immutability check and ledger behave correctly | **Met.** Ledger: a recorded file whose sha256 differs is refused (`bootstrap.ts:283-286`); a new file sorting before the last applied one is refused (`:291-292`); the file and its ledger row commit together (`:296-298`). Immutability check, real CLI over `origin/main..pr/52`: PASS (1 change). Pure-policy probe with `main`'s `checkBootstrapChanges`: `A 91` on the released set → no finding; `A 11-audit-actions-v2.sql` → `bootstrap/added-out-of-order` (why D-TASK285-01 renamed the file); `M 91` and `D 91` after release → `bootstrap/released-changed`; `A 90a-x.sql` after 91 → `added-out-of-order`. The two lane-test edits keep their security property: PR12-SEC-03 "exactly once" now deletes 91's ledger row first so the runner reaches 90 and still fails closed on it (42723); the guard-plant case drops 91 from its lane copy because 91 sorts after 90 (commit `d8ed84f`) |
| 5 | The shadow-init KEEP form cannot keep an arbitrary CHECK replacement | **Not met as claimed**: PR52-SEC-01 (LOW). The real `91` statement renders correctly and lands after the first `ensure_audit_partitions` call (`shadow-init.test.ts:231`), so the shadow database mirrors the real lane today |

Lint rule 12 at the head reports no finding for the lane with the reviewer list (the `lint-migrations.test.ts` repository case runs with `today = 2026-11-15`), and with an empty list flags exactly `10`, `90` and `91`. The marker is self-attested (PR24-SEC-06): this record, not the marker, binds the content.

**Residual (no finding).** The architecture text still names the file `11-audit-actions-v2.sql` and data-model §1.7 still lists 18 values with "(OI-07)"; principal-architect ratifies the `91` name and the list by amendment (D-TASK285-01, SHEET-FOLD-8). The `ADD CONSTRAINT` validation scans every partition under ACCESS EXCLUSIVE; on a large shared store the file belongs in the deploy window, as its header says and D-ARCH-119 accepted, and past the 5-minute bound it rolls back (fail closed; code review R1-n3, runbook TASK-090). The existing-database upgrade is proved on an empty store only; I agree with code review R1-m2 (routed to TASK-033 by D-ORCH-099) that a pre-upgrade row and hash-chain continuity across the DDL should be asserted. The DDL rewrites no row and the hash covers row content, not the catalog, so I expect it to hold; it is a test gap, not a finding.

## 6. Vocabulary parity

| Source | Values | Result |
|---|---|---|
| REQ-AUDIT-002 (`REQUIREMENTS.md`) | 20 | reference order |
| `91-audit-actions-v2.sql` CHECK | 20 | equal, same order |
| `AUDIT_ENTRY_ACTIONS` (`packages/audit/src/actions.ts`) | 20 | equal, same order |
| Catalog C9 list (`c01-c12.int.test.ts`) | 20 | equal to the sorted list |
| `actions.test.ts` replay of the lane | 20 | effective constraint = `91`; `10` alone still gives 18 (the negative control is in the test) |
| `@platform/shared` `AUDIT_ACTIONS` (route descriptors) | subset | every descriptor action other than `NONE` is an entry action (existing test) |
| data-model §1.7 `audit_action` row | 18 | stale text, covered by amendment A27 and SHEET-FOLD-8 (§5 residual) |
| `openapi.yaml` enums (three) | 18 | missing exactly `MFA_RECOVERY_USED`, `SESSION_REVOKED`, no extra value; pinned (§7), PR52-SEC-02 |

No other code enumerates the action list (`git grep` for `TOKEN_REUSE_DETECTED` outside `docs/` finds only these files and the generated `types.gen.ts`). The replay helper in `actions.test.ts:51` strips only `--` comments and matches a `DROP CONSTRAINT <name>` on any table; both are test-robustness points for the code reviewer, not security items, because the database side is pinned independently by C9 and `audit-actions-v2.int.test.ts`.

## 7. Contract-enum gap pin (D-TASK285-02)

`ContractParity<C>` = `[Same<Exclude<C, Entry>, never>, Same<Exclude<Entry, C>, 'MFA_RECOVERY_USED' | 'SESSION_REVOKED'>]`, asserted as `[true, true]` for the three generated contract types. `packages/audit/tsconfig.json` includes `src`, and `tsconfig.base.json` excludes no test file, so lane A's type-check step checks the pin (it passed). Mutation control with the same type shape (`tsc --noEmit --strict`): the 18-value contract compiles; a 20-value contract (the future fix), a 19-value contract and an 18-value contract plus an unknown value each fail with TS2322 (`true` not assignable to `false`). The pin is effective in both directions; the open point is the owner and due date (PR52-SEC-02).

## 8. Evidence hygiene (`docs/05-quality/tests/runs/20261115T1311Z_552a772/`)

- The evidence commit `a718dcd` adds exactly 9 files under the one run directory on parent `552a772`; `summary.json` names `git_sha` `552a772…`, `git_dirty false`, `build_clean true`, profile `pr`, verdict PASS, empty `invalid_reasons` and `env_overrides`. The `coverage-summary.json` attachment hash matches the committed blob.
- Suites: unit 5,669 (2 skipped), integration 333 (1 skipped), api 128, catalog 102, migrations 8, rls-cross-tenant 126; 0 failures in every JUnit file. Changed test files present: `audit-actions-v2.int.test.ts` 12 cases, `bootstrap.int.test.ts` 20, `shadow-init.test.ts` 59, `actions.test.ts` 12, `lint-migrations.test.ts` 152, `bootstrap.test.ts` 26, C1-C12 59.
- Count-only host-fragment scan (OS user name, its 8.3 stem, home and temp directory forms, host name, git e-mail) over all 9 files: 0 for every needle; the positive control file built at run time scored 5.
- Path- and secret-shaped strings: the hits are test names with synthetic fixtures already present in earlier runs on `main` (placeholder database and Redis URLs, `/run/secrets/...` locators, the AWS documentation account id, ECS metadata URLs, and the per-run random password of `check-tooling-env.test.ts:14`, `randomBytes(12)`, in 10 earlier runs). No real credential, no host path.
- The two host-saturation FAIL runs named in D-TASK285 are not in the PR tree. Lane A's Gitleaks over the commit range passed.

## 9. Sequencing and unions

- `main` moved by docs, code-review records and agent notes only since the merge base; `git merge-tree` of the head with `main` (`78cd2a4`, and the docs-only `cb96be4` after it), with PR #53 (`8a48139`) and with PR #46 (`4bbce92`) is clean, and none of them shares a changed path with this PR. A later merge of `main` that brings only paths this PR does not change keeps this record valid (simulation S7, S8). It would, however, stale the lane-B evidence (`main` now carries `.claude/agent-memory/*`, outside the `docs/**` allowance), so code review merge condition 2 (squash without another merge of `main`) stands.
- Any change to an owned path after this record (including a PR52-SEC-01 fix in this PR) voids it for lane A and needs a delta round that re-confirms the `91` blob.
- TASK-059 and TASK-061 may start emitting after merge; TASK-073 carries PR52-SEC-02.

## 10. Proposed decision

**D-SEC-PR52-01 · 2026-11-15 · security-analyst (to be logged by the orchestrator) · PR #52 r1; rule-12 approval of `91-audit-actions-v2.sql`; KEEP form; contract gap due point.**
- **Decision:** (1) Rule-12 approval is granted for `prisma/bootstrap/91-audit-actions-v2.sql` at blob `9945c349e2334c60b1b2238d438ad8827b2a7b22`; any other blob needs a new record, and after the first apply the ledger sha256 binds it. (2) PR52-SEC-01 (LOW): the shadow-init CHECK-replacement form is replaced by a balanced-parenthesis check (code in the record), with the five refusal fixtures; owner senior-developer / database-engineer, in this PR's fix cycle if one opens, otherwise DUE before the next bootstrap-lane file merges. (3) PR52-SEC-02 (INFO, = code review R1-m1): confirmed as routed by D-ORCH-099 (AC line on TASK-073: contract enums carry the 20 actions; the `ContractParity` pin becomes full equality in the same PR; due before TASK-059/061 emit).
- **Why:** the widening is a pure superset under the audit owner, idempotent and ledger-bound; the shadow tripwire is weaker than its comment states; the contract gap would otherwise reach the audit viewer unnoticed.
- **Alternatives rejected:** withholding the approval until the KEEP form is fixed (the defect affects only the shadow rendering, not the approved file); fixing the contract in this PR (contract changes belong to api-designer).
- **Reversibility:** High until a shared database applies `91`.

## 11. Record validation

Simulated with `main`'s `tools/ci/check-security-owned-paths.mjs` in a sparse shared clone, over plumbing commits (nothing checked out in the worktree):

| Scenario | Expected | Result |
|---|---|---|
| S0: `a718dcd` without a record, base `73addb0` (control) | missing | missing, exit 1, 10 owned paths (the lane A failure) |
| S1: this record committed on `a718dcd`, base `73addb0` | pass | pass, satisfied by `a718dcd`, 10 owned paths |
| S1b: as S1, base = `main` tip `cb96be4` | pass | pass, satisfied by `a718dcd` |
| S2: `--pr 53` (control) | missing | missing |
| S3: the last `Verdict` row set to FAIL (control) | missing | missing |
| S4: the `Head` row names the `main` tip (control) | missing | missing |
| S5: `91-audit-actions-v2.sql` edited after the record | missing | missing ("changed after it") |
| S5b: `tools/db/shadow-init.ts` edited after the record | missing | missing |
| S6: a docs-only commit after the record | pass | pass |
| S7: merge of the `main` tip `cb96be4` after the record | pass | pass |
| S8: merge of the PR #53 head after the record (no shared path) | pass | pass |

Checks on the file itself: exactly one table row has a first cell starting with `Head` (the full SHA); the only `Verdict` row is the last table row (§12); Gitleaks emulation (v8.30.1 rules) over this file: 0 findings with its run-time positive controls firing; count-only host-fragment scan of this file: 0 for every needle; line endings LF.

## 12. Verdict

| Field | Value |
|---|---|
| Findings | 0 Critical, 0 High, 0 Medium, 1 LOW (PR52-SEC-01), 1 INFO (PR52-SEC-02) |
| Rule-12 approval | Granted: `prisma/bootstrap/91-audit-actions-v2.sql` blob `9945c349e2334c60b1b2238d438ad8827b2a7b22` |
| Conditions | None |
| Follow-ups | PR52-SEC-01: this PR's fix cycle if one opens, else DUE before the next bootstrap-lane file merges. PR52-SEC-02: routed by D-ORCH-099 (TASK-073 AC line, due before TASK-059/061 emit) |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** The widening file is a pure superset of the released action CHECK under `platform_audit_owner`, idempotent, ledger-bound and refused by the guard for every other identity; immutability, the DDL guard, grants and RLS are untouched; the immutability check and the runner refuse every out-of-order or in-place change; the vocabulary is equal across requirements, database, package and catalog, and the contract gap is pinned. No Critical or High finding is open for this change |
