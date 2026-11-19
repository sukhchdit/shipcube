# PR-pending: TASK-293 (`lexfu`, TASK-290-F: tokenizer parity with scan.l, rule 10 at the call site, catalog C16 and P9-CK, SEC-TC-76..78), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-293-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>`, so under the placeholder name the record step is red (section 7, control C1).

Order (D-ORCH-136, D-ORCH-138):
1. Open the PR as a draft.
2. Rename the record on main.
3. Confirm that the PR's merge ref contains the renamed record: `git fetch origin refs/pull/<n>/merge`, then `git ls-tree` it. Its first parent must be the rename commit or later.
4. Mark the PR ready.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-293-task-290-f-tools-db`, two commits on `ca7e4b7` (merge base; PR #65 merged): `3183525` (the change) and `85afc70` (code review round 1 fixes). To be pushed as these code commits plus evidence-only commits (lane B run files under `docs/05-quality/tests/runs/` only) |
| Head | 85afc70829876e8ba69cc5d910ff73f8a800e060 |
| Tip to push | `85afc70` plus evidence-only commits. Main's checker accepts that tip through the merge ref (section 7). Any later change to an owned path voids the binding and needs a delta round, including a fix of PR293-SEC-01 in `tools/db/lint-migrations.ts` (sim control C5) |
| Lane A evidence | None: the branch is not pushed. Main's classifier selects `security-integration` for this range. Its 8 trigger paths are the 4 `prisma/tests/**` files and `tools/db/{lexer-cases,lint-migrations,shadow-init,sql-text}.ts`. The hosted job runs `catalog-c1-c14` on PostgreSQL 18, so C16 and P9-CK run there too |
| Lane B evidence | None for `85afc70` at review time; it is queued (merge condition C1). The coordinator reports that lane B on `3183525` passed every TASK-293 check on PostgreSQL 18 (catalog 113, 0 skipped), and that its one failure was an unrelated `consumer.int` AT-US-009-04 race. Those run files are not on main, so I did not read them |
| Owned paths changed | 12, as main's checker counts them on the test merge: `prisma/tests/catalog/{c16-tenant-keys.int.test.ts, tenant-keys.ts}`, `prisma/tests/migrations/split-statements.int.test.ts`, `prisma/tests/organisations/organisations.int.test.ts`, `tools/db/{lexer-cases.ts, lint-migrations.ts, lint-migrations.test.ts, shadow-init.ts, sql-text.ts, sql-text.test.ts}`, `tools/quality/lib/test-ids.test.ts`, `tools/quality/required-suites.json` |
| Unowned paths changed | `docs/03-architecture/threat-model.md` (three SEC-TC rows) and `docs/05-quality/tests/security-test-cases.md` (section "Adopted cases SEC-TC-76..78"), both read in full (section 4.6) |
| Binding items checked | PR66-SEC-01 (a)-(c) and PR66-SEC-02 (D-SEC-PR66-01/02, PR #66 record); PR #66 code review R1-m1, R1-n1, R1-n2; D-ARCH-154 (C16, T1/T2) and `wave-1-pr65-r1-rulings.md`; D-SEC-PR65-01/02 (PR65-SEC-01 rule, PR65-SEC-03 inventory, PR65-SEC-05 (a), (b), (d)); D-SEC-PR47-01 (1), (2); the TASK-293 card (WAVE-00 batch 0.13; D-SD-001); D-ORCH-137, D-ORCH-138. The code review twin on main (`docs/05-quality/reviews/PR-pending-TASK-293-code-review.md`): round 1 at `3183525` (`4e05347`) and round 2 at `85afc70` (`942d8d9`), both APPROVED_WITH_NITS (section 6) |
| Reviewer / date | security-analyst, 2026-11-19, round 1, pre-push. The round started on `3183525`. The head moved to `85afc70` mid-round, and every probe of the changed code was re-run on `85afc70`. `sql-text.ts`, `shadow-init.ts`, `lexer-cases.ts`, `required-suites.json` and every test file except `lint-migrations.test.ts` and `test-ids.test.ts` are byte-identical between the two; `tenant-keys.ts` differs by a JSDoc paragraph. Host rule (lane B owns the machine): no npm, Jest, type-check, build or Docker. Method: static review plus single-process Node probes on `git archive` extracts of `85afc70`, `3183525` and `ca7e4b7`, and PGlite 0.4.3 (PostgreSQL 17.5) from the main checkout's `node_modules`. Nothing ran in the PR worktree, not even read-only git: commits were read from the main checkout's shared object store. Line numbers come from single-file reads at `85afc70` |

## 1. Summary

- **PR66-SEC-01 is closed.** I ran all three shapes of my PR #66 finding through the real migration linter at `85afc70`. At the base each of them gave 0 findings; now each is seen (section 4.1, 18 rows):
  - (a) a lone CR that ends a `--` comment: the GRANT behind it is rule 8, and the CR itself is rule L, also before the `END` of a routine body;
  - (b) `$tag$` after `é`/`ä`, U+00A0, U+FEFF, U+3000 or an astral character: the GRANT between two such labels is rule 8;
  - (c) a faked `RESET ROLE` behind `$é$`, `$<emoji>$` or `$<NBSP>$` leaves rule 15 firing, and a faked ENABLE + FORCE behind `$é$` or `$aé$` leaves rule 9 firing.

  The real statements stay clean, and the ASCII controls are unchanged. The shadow-rendering route of the PR #66 record (a CR inside a `ck_` CHECK replacement hid `NOT VALID, DISABLE TRIGGER ALL`) is closed too: the head refuses the statement.
- **The corpus is unchanged.**
  - All 534 tracked `.sql` files give byte-identical `tokenize`, `splitStatements` and `stripComments` output at the base and at the head.
  - With every LF rewritten as CRLF, `stripComments` is identical modulo CR, and `splitStatements` is identical for 532 files and differs in white space only for 2.
  - The real bootstrap lane renders a byte-identical shadow.
- **Rule 10's call site is much better at `85afc70`, but it is not yet fail-closed (PR293-SEC-01, LOW).**
  - `85afc70` closes 5 of the shapes I found at `3183525`: the forward reference, `SET search_path`, a quoted name with a space, a quoted name with `[x]`, and the crash on `"f("`. It states two more as limits: `RENAME TO`, and a trigger fired by `INSERT … VALUES`.
  - Eleven shapes that PostgreSQL executes are still silent and not stated. Six are new with this rule: `SET SCHEMA`, `FOR … IN <DML>` in a routine, attribute notation, `CREATE CAST`, `CREATE AGGREGATE`, and a non-ASCII routine name (code review R2-n1).
  - Five are DO-block gaps in rule 10 itself:
    - `FOR … IN` and `OPEN … FOR` with `DELETE`/`UPDATE … RETURNING`;
    - a string holding `;` before the DML (two forms);
    - an unquoted-schema `UPDATE "<name holding ;>"`. That last one is seen on main and lost by the new linear scan.
  - PGlite ran the DML in every executed shape. A candidate fix closes 7 of them, keeps all 81 lint fixtures identical and stays linear.
  - Rule 10 is the backup guardrail (§8.6), not a tenant control.
- **The new linear body scan is equivalent to the regex it replaces, except for quoted names holding `;`.** On 300,000 fuzzed texts there are 0 differences once those names are removed. All 244 differences involve such a name. Every adversarial shape now scales linearly (ratio 1.7 to 3.4 for 4n).
- **C16 matches D-ARCH-154 and my PR65-SEC-01 intent.**
  - Arm (b) reads every unique index of a TENANT table and requires `org_id` among its KEY columns. INCLUDE columns and expressions do not count, and partial indexes stay in scope. The PR #65 mutant is re-planted on the real table and reported.
  - The one exception, `ux_invitations__token_hash`, is justified: it is a SHA-256 of a random token (PR65-SEC-03 inventory), global by design, and held live.
  - The primary-key exemption is backed by the standard-columns check (PK = `(id)` alone, `uuidv7()`).
  - Scope notes for later tables: PR293-SEC-03 (INFO).
- **The SEC-TC ids match what I assigned (D-SEC-PR65-01 (a)):** 76 = T1, T2, R1-m2, the PR65-SEC-01 case and C16; 77 = T3; 78 = T4 to T8. The threat-model rows and the new "Adopted cases SEC-TC-76..78" rows in `security-test-cases.md` say the same.
- **`required-suites.json` weakens no gate.**
  - It adds three required cases to `integration` and one to `catalog-c1-c14`.
  - It raises `catalog-c1-c14.min_tests` from 14 to 113 (106 at `d4de55d` + 7 new `it`).
  - No flag, lane, runner or status changes. The `test-ids` pin moves from 64 to 67 adopted ids, adding exactly 76, 77 and 78.
- **Remaining scan.l differential: E-string continuation (PR293-SEC-02, INFO).** `E'x'` followed by a newline and `'…'` keeps escapes live in the continued part. With an approved audit-DDL marker, a bootstrap file can hide a SECURITY DEFINER routine from rule 13; PGlite creates the routine. The migrations lane refuses every E-string (rule 16).
- **Not done by the developer; routed in section 8:**
  - the PR43-SEC-07 remainder regression cases (PR65-SEC-05 (d));
  - data-model §8.3 and §4.6 wording (architect);
  - the TEST-STRATEGY G3 count (qa-lead, code review R2-n3).

## 2. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner / due |
|---|---|---|---|---|---|---|
| PR293-SEC-01 | Rule 10 (backup guardrail) still misses eleven PostgreSQL-executed shapes, six of them in the new call-site half (not in its stated limits) and five in DO-block bodies, one of those a regression from the new linear scan | LOW | CWE-693, CWE-184 | A04 | `tools/db/lint-migrations.ts:743` and `:772` (statement starts), `:721-741` (`bodyDataChanging`; every `;` splits, `:735`), `:776-780` (`CALL_IDENT` plain branch is ASCII), `:860-871` (`writingRoutineCall`: no ALTER handling), `:750-770` (JSDoc limits) | database-engineer (lock `prisma-core`). Preferred: in this PR before the push (the candidate in section 3 is small and validated). Otherwise a `tools/db` follow-up, due before the first migration PR that defines a routine whose body changes data or holds a DO block with `FOR … IN` / `OPEN … FOR`, and at the latest G3 |
| PR293-SEC-02 | E-string continuation: the lexer ends the continued part as a plain string, while PostgreSQL keeps escapes live. It hides statements from the bootstrap-lane linter in an approved file | INFO | CWE-436 | A04 | `tools/db/sql-text.ts:103-124` (string rule; no quote-continuation state) | Next holder of `tools/db/sql-text.ts`; at the latest before the next approved audit-DDL bootstrap file |
| PR293-SEC-03 | C16 scope for later tables: GUEST_CAPABLE tables are outside arm (b), and no rule for them has been decided; a T2 pair answers "foreign" and "unknown" with different constraint names; EXCLUDE is out of scope (now a stated limit) | INFO | CWE-203 | A01 | `prisma/tests/catalog/tenant-keys.ts:20-22` (stated limits), `:99-109` (arm (b) query); `c16-tenant-keys.int.test.ts:35-37` (TENANT scope) | principal-architect with database-engineer in the R-ARCH-34 ruling (D-ARCH-154 "Open"), before TASK-051 writes the first GUEST_CAPABLE table; the error-mapper owner (TASK-036 line) before any 23503 is mapped below 500 |

## 3. Findings in detail

### PR293-SEC-01 (LOW): rule 10 still misses eleven executed shapes

**Description.** TASK-293 adds the call-site half of rule 10 (PR66-SEC-02), and `85afc70` rebuilds it:
- `RoutineRegistry` records each definition with the names it calls, and resolves writers at the call site, transitively and independent of definition order.
- Names are parsed identifiers, never a regular expression built from the SQL text.
- An unqualified definition or call matches every schema.
- The body forms are matched per `;`-separated segment, in linear time.

The JSDoc (`:750-770`) states five limits: bootstrap routines, run-time `EXECUTE` strings, computed names, `RENAME TO` and three-part names.

**Probe.** `p2h2.mjs` and `p9semi.mjs` ran the `3183525` and `85afc70` linters with header `data-changing: no`. `p4pg.mjs`, `p4pg2.mjs` and `p9semi.mjs` then ran each shape on PGlite 17.5 as one simple query, the way the bootstrap runner and Prisma's whole-script fallback send a file. The seeded table has 3 rows; the control `SELECT 1` leaves 3 rows and updates none.

| # | Shape | `3183525` | `85afc70` | PostgreSQL | Note |
|---|---|---|---|---|---|
| | Ten claimed shapes: `SELECT f()`, `FROM f()`, comment or spaces before `(`, quoted upper case, a writer from an earlier `data-changing: yes` file, `CREATE OR REPLACE` reader → writer, `EXECUTE 'SELECT f()'` in DO, `RETURN QUERY DELETE … RETURNING`, a view over a writer | rule 10 | rule 10 | DML ran | |
| | A PL/pgSQL caller defined before the writer; `SET search_path` then a qualified call; `"fixture purge"`; `"fixture[x]"` | 0 | **rule 10** | DML ran | closed by `85afc70` |
| | `"fixture("` | crash | rule 10, no crash | | closed (R1-m1) |
| | `ALTER FUNCTION w() RENAME TO v`, then `v()`; a writing trigger fired by `INSERT … VALUES` | 0 | 0 | DML ran | stated limits now |
| 1 | `ALTER FUNCTION public.w() SET SCHEMA platform`, then `platform.w()` | 0 | 0 | 3 → 0 | not stated |
| 2 | Writer body `FOR r IN DELETE … RETURNING … LOOP` | 0 | 0 | 3 → 0 | |
| 3 | Attribute notation `SELECT t.w FROM t` (a function of one composite argument) | 0 | 0 | 3 → 0 | |
| 4 | `CREATE CAST (t AS integer) WITH FUNCTION w(t)`, then `t::integer` | 0 | 0 | 3 → 0 | the PR's own control asserts the CREATE CAST is clean |
| 5 | `CREATE AGGREGATE a(integer) (SFUNC = w, …)`, then `a(1)` | 0 | 0 | 3 → 0 | |
| 6 | Non-ASCII routine name `public.purgé()` (`purge` control: rule 10) | 0 | 0 | executes (grammar: `ident_start` includes `\200-\377`) | code review R2-n1 |
| 7 | DO `FOR r IN DELETE … RETURNING` and `FOR r IN UPDATE … RETURNING` | 0 (main 0) | 0 | 3 → 0; 3 updated | pre-existing |
| 8 | DO `OPEN c FOR DELETE … RETURNING` (also `NO SCROLL`, `UPDATE`) | 0 (main 0) | 0 | 3 → 0; 3 updated | pre-existing |
| 9 | DO `WITH x AS (SELECT ';') DELETE FROM t` | 0 (main 0) | 0 | 3 → 0 | pre-existing; the `;` inside the string splits the segment |
| 10 | DO `INSERT … VALUES (1, ';') ON CONFLICT (id) DO UPDATE …` | 0 (main 0) | 0 | 1 updated | pre-existing; same cause |
| 11 | DO `UPDATE "fixture;items" SET …` (quoted name holding `;`, no schema) | **rule 10** (main too) | 0 | executes | **regression** of the segment split; with a schema (`public."fixture;items"`) both see it |
| | `CREATE OPERATOR` over a writer | rule 14 | rule 14 | | control |

**Why rows 2, 7 and 8 are missed.** PL/pgSQL's `FOR target IN query` and `OPEN cursor FOR query` accept INSERT, UPDATE, DELETE or MERGE with RETURNING. The statement starts `begin|then|else|loop|execute` (DO) and `…|as|atomic|query` (routines) include neither `in` nor `open … for`. `for` itself is left out on purpose, because of the `FOR UPDATE` row locks.

**Why rows 9 to 11 are missed.** `bodyDataChanging` splits the string-kept body text on every `;`, including one inside a string literal or a quoted identifier.

**Exploitability and impact.**
- **Who.** It needs someone who writes a migration: a mistake or an insider. A batched backfill written as `FOR r IN DELETE … RETURNING` or `OPEN … FOR UPDATE … RETURNING` is a natural form.
- **What breaks.** The `data-changing: yes` declaration is not demanded, and with it the backup and restore-test gate of CLAUDE.md §5 and data-model §8.6. A data-changing deploy then has no tested restore point.
- **What it does not touch.** Tenant isolation, privileges and RLS (rules 8, 9 and 15 and the catalog suite are unaffected).
- **Remaining controls.** CODEOWNERS review of `prisma/migrations/`. No production deploy exists before M5.
- **Rating.** Impact Medium × likelihood Low = **LOW**.

**Remediation (code level, `tools/db/lint-migrations.ts` at `85afc70`).** Items 1 and 2 were validated as a candidate on a scratch copy (`mkfix2.mjs`, `p6fix2.mjs`):
1. **Statement starts (rows 2, 7, 8).** Add `in` and the OPEN form to both start lists (`:743`, `:772`):
   ```ts
   const OPEN_FOR = 'open [a-z_][a-z0-9_$]*(?: no)?(?: scroll)? for';
   const doBodyChangesData = bodyDataChanging(`begin|then|else|loop|execute|in|${OPEN_FOR}`);
   const routineBodyChangesData = bodyDataChanging(`begin|then|else|loop|execute|as|atomic|query|in|${OPEN_FOR}`);
   ```
2. **`RENAME TO` and `SET SCHEMA` (row 1, and the stated rename limit).** Record the new name as a routine that calls the old one, so the registry resolves it transitively. Put this in `writingRoutineCall` before the call-site return:
   ```ts
   const ALTERED_NAME = new RegExp(
     `^alter (?:function|procedure|routine) (?:(${CALL_IDENT}) ?\\. ?)?(${CALL_IDENT})(?: ?\\([^)]*\\))? (rename to|set schema) (${CALL_IDENT})$`,
   );
   const moved = ALTERED_NAME.exec(maskedText);
   if (moved !== null) {
     const old = { schema: moved[1] === undefined ? null : identifierValue(moved[1]), name: identifierValue(moved[2] as string) };
     const name = moved[3] === 'rename to' ? identifierValue(moved[4] as string) : old.name;
     const schema = moved[3] === 'set schema' ? identifierValue(moved[4] as string) : old.schema;
     registry.define({ schema, name }, false, [old]);
   }
   ```
3. **Segments (rows 9 to 11).** Split on `;` only where it is code. Tokenize the expanded body and cut at code `;` tokens, so quoted identifiers and string literals stay whole. Then also test each string literal's own text as a body, for dynamic SQL (`EXECUTE '…'`), recursively with `MAX_DYNAMIC_DEPTH`.
4. **Non-ASCII names (row 6, code review R2-n1).** Add `\u0080-￿` to both ranges of the plain `CALL_IDENT` branch and to the `NAMED_CALL` lookbehind. When `ROUTINE_DEFINITION` matches but `DEFINED_NAME` does not, report the definition (fail closed) instead of skipping it.
5. **Rows 3 to 5.**
   - Refuse `CREATE CAST` and `CREATE AGGREGATE` under rule 14, as `CREATE OPERATOR` already is (PR24-SEC-02; no migration in the run needs either), or list them as stated limits.
   - List attribute notation as a stated limit.
   - Flip or drop the developer's CREATE CAST control accordingly.

**Validation of items 1 and 2 on `85afc70`.**
- Reported now: rename, `SET SCHEMA`, the routine `FOR … IN DELETE`, the DO `FOR … IN DELETE|UPDATE`, and `OPEN c [NO SCROLL] FOR DELETE|UPDATE`.
- Still clean, as they should be:
  - `FOR r IN SELECT … FOR UPDATE`;
  - `OPEN c FOR SELECT … FOR UPDATE OF t`;
  - `WHERE id IN (SELECT 1)`;
  - a reader routine and its call;
  - the developer's whole call-controls block;
  - `other.fixture_purge()`.
- All 81 lint fixture directories give identical findings, and `prisma/migrations` gives `[]`.
- The candidate still scales linearly: ratio 2.0 to 3.4 for 4n, including an `in insert into t on conflict open c for` ×1000 body.

**Verification tests.**
- `lint-migrations.test.ts`: one row per numbered shape, each with an ASCII control.
- The developer's 60 KB timing test: keep it, and add a scaling-ratio assertion, time(4n)/time(n) < 8 (an absolute bound misses a ×10 regression at that size).

### PR293-SEC-02 (INFO): E-string continuation is the remaining scan.l token-boundary differential

**Description.** In `scan.l`, `{quotecontinue}` (`{whitespace_with_newline}{quote}`, where `--` comments count as white space) returns to the state the scanner was in before the closing quote. For an `E'…'` string that state is `xe`, so `\'` in the continued part is an escaped quote. `tokenize` (`sql-text.ts:103-124`) starts a new, plain string at the second quote; there `\` is an ordinary character and `''` an escaped quote. So in `SELECT E'x'`LF`'a\'' ; <stmt> ; SELECT 1 AS "q" -- '`LF`;` the lexer reads one statement, while PostgreSQL ends the string after `a'` and runs `<stmt>`.

**Probe** (`p5econt.mjs`, `p5b.mjs`). `<stmt>` = `CREATE FUNCTION public.h() … SECURITY DEFINER AS $$ SELECT 1 $$`, with no `SET search_path`.
- Bootstrap lane with the approved marker: 0 findings at the base and at the head.
- The same statement without the continuation: rule 13.
- PGlite creates `h` as SECURITY DEFINER.
- Migrations lane: rule 16 refuses the file, because every E-string token is refused there (fail closed).

**Exploitability and impact.**
- The shape exists only in a bootstrap file that already carries an approved `@audit-ddl security-approved` marker, because rule 12 treats every E-string as audit DDL. So it needs an approving security reviewer to miss a visible, if subtle, quote sequence.
- On the database, the audit DDL guard and catalog C4/C11 (definer allow-list, fixed `search_path`) still catch the definer routine.
- PR66-SEC-01 listed three differentials. This is a fourth that the list missed, and TASK-293 does not change it.

**Remediation.** In `tokenize`, after an escape string closes, refuse a quote continuation (fail closed). Use a linear scan, not a regex: an alternation of white space and `--…` comments under `*` backtracks exponentially on a run of `--` without a newline.

```ts
/** scan.l quotecontinue: white space or -- comments, a newline, white space or -- comments, then a quote. */
function continuesString(sql: string, from: number): boolean {
  let newline = false;
  for (let k = from; k < sql.length; ) {
    const c = sql[k];
    if (c === '-' && sql[k + 1] === '-') {
      while (k < sql.length && sql[k] !== '\n' && sql[k] !== '\r') k += 1;
    } else if (c === '\n' || c === '\r') {
      newline = true;
      k += 1;
    } else if (c === ' ' || c === '\t' || c === '\f' || c === '\v') {
      k += 1;
    } else {
      return newline && c === "'";
    }
  }
  return false;
}
// in the string branch, after the closing quote at j:
if (escaped && continuesString(sql, j)) throw new SqlLexError('an E-string continued on a new line is refused (PR293-SEC-02)');
```

- **Checked (`cont-test.mjs`).** 9 of 9 cases are right: LF, CR, comment before and after the newline, same-line `'b'`, `;` and a comment-only line. The scan is linear: 2.4 M characters take 7 ms.
- **No tracked file changes.** The corpus holds 2 escape-string tokens and 0 continued ones (`econt-census.mjs`).

**Verification test.**
- Add the shape above to `sql-text.test.ts` (it throws) and to the bootstrap-lane lint (rule L).
- The plain-string continuation `'a'`LF`'b'` and `E'a' 'b'` on one line stay accepted.

### PR293-SEC-03 (INFO): C16 scope for the tables that come next

PGlite probe: `p8t2.mjs`.

- **(a) GUEST_CAPABLE.** Arm (b) reads TENANT tables only (`c16-tenant-keys.int.test.ts:35-37`).
  - On a GUEST_CAPABLE table `org_id` is nullable. A unique `(org_id, x)` does not hold among guest rows, because NULLs are distinct. A global unique `x` is the PR65-SEC-01 oracle across organisations.
  - D-ARCH-154 left guest binding open: R-ARCH-34, due before TASK-051's quotes migration.
  - That ruling should also say which unique keys a GUEST_CAPABLE table may hold: only server-generated, high-entropy values (like `token_hash`), each listed in the exception map with a reason. Arm (b)'s scope then widens to every class with `org_id`.
- **(b) T2 constraint names.** For a T2 pair the two failures differ only in the constraint name:
  - a foreign parent fails the composite key: `23503 fk_g__org_parent`;
  - an unknown id fails the single key first: `23503 fk_g__parent_id`.

  So any error mapping that keys on the constraint name turns T2 back into an existence oracle. No code in `apps/` or `packages/` maps a 23503 yet (an unmapped database error is a 500), and no T2 pair exists, so this is latent. The error mapper must give both members of a T2 pair one identical answer.
- **(c) EXCLUDE.** An `EXCLUDE USING btree (code WITH =)` on an `org_id` table answers `23P01` for B's value and `ok` for a new one. Its index has `indisunique = false`.
  - `85afc70` now states this as a limit (`tenant-keys.ts:20-22`), with the set-containment T2 sibling (code review R1-n4).
  - The fix when the first such table arrives: `(i.indisunique OR i.indisexclusion)`, plus a planted row.
- **(d) Catalogue text.** data-model §4.6 lists only C16 (a). It needs (b), its exception map and P9-CK (architect, next fold).

## 4. Verification of the closures and the routed scope

### 4.1 PR66-SEC-01 (a)-(c): closed

Probe `p1.mjs` / `p1h2.mjs`:
- the real `lintMigrations` of the base and of `85afc70`;
- the real table-class manifests plus two fixture tables;
- one scratch migration directory per row, header `expand / no / yes`.

| Row | Base | `85afc70` | Expected |
|---|---|---|---|
| control `GRANT TRUNCATE ON public.fixture_items TO platform_app` | 8 | 8 | 8 |
| (a) `SELECT 1; -- note`CR`GRANT …`LF | – | L, 8 | L, 8 |
| (a) CR ends `--` before the `END` of a BEGIN ATOMIC body, GRANT between two routines | – | L, 8 | L, 8 |
| (a) CRLF control | 8 | 8 | 8 |
| (b) `é$a$` … `ä$a$`; U+00A0, U+FEFF, U+3000 and an astral character before `$q$` (5 rows) | – | 8 | 8 |
| (b) ASCII control `x$q$` | 8 | 8 | 8 |
| (c) `$é$`, `$<emoji>$`, `$<U+00A0>$` around a faked `RESET ROLE` (3 rows) | – | 15 | 15 |
| (c) real `RESET ROLE` | – | – | – |
| (c) `$é$` and `$aé$` around a faked ENABLE + FORCE (2 rows) | – | 9 | 9 |
| (c) real ENABLE + FORCE | – | – | – |
| (c) ASCII tag `$q$` around the RLS statements | 9 | 9 | 9 |

18 of 18 rows are as expected, and 12 of them differ from the base.

- **Shadow rendering** (`p3b.mjs`). The PR #66 CR shape inside a `ck_` CHECK replacement:
  - The base keeps `CHECK (a > 0 )` and drops `NOT VALID, DISABLE TRIGGER ALL`.
  - The head refuses the statement (`ShadowInitError`, fail closed).
  - The real lane's shadow SQL (23,565 characters) is byte-identical.
- **Code against the scan.l productions.**
  - `DOLLAR_TAG` (`sql-text.ts:44`) equals `dolqdelim` on UTF-16: non-ASCII code units and surrogates stand for the bytes `\200-\377`.
  - The opener test `!isIdentifierChar(code.at(-1))` (`:137`) equals `ident_cont`. After a string, quoted identifier, comment or variable token, `code` is empty: a new token, as in scan.l.
  - The close search `indexOf(tag)` equals the `xdolq` rescan of the final `$`.
  - The documented approximation `1$a$` is a syntax error in PostgreSQL. The code twin's PGlite statement counts agree on every shape.
- **Lone CR** (`lint-migrations.ts`, `lexedStatements`). It is reported as rule L in `migration.sql`, `down.sql` and bootstrap files, and the lint continues. CRLF is not refused.

### 4.2 Corpus

Probes `corpus.mjs` and `corpus3.mjs`; 534 files; `sql-text.ts` is identical at `3183525` and `85afc70`.
- **LF as committed:** `tokenize`, `splitStatements` and `stripComments` are identical for all 534 files.
- **CRLF** (every LF rewritten):
  - `stripComments` is identical modulo CR.
  - `splitStatements` is identical for 532 files. The other 2 (`20261117000000_organisations_identity/migration.sql` and one lint fixture) differ in white space only, because the comment no longer swallows the CR.
  - The linter normalises white space, and `routineDefinitionSha256` collapses it.
- **Census:** 0 lone CRs, 0 non-ASCII characters next to `$`, 49 files with non-ASCII text.
- **Positive control:** a CR-comment text splits differently at base and head.

### 4.3 PR66-SEC-02: rule 10 at the call site

- **The capability is closed.** The plain shape of my PR #66 probe (`CREATE FUNCTION … DELETE …; SELECT f();`) is now rule 10. The residuals are PR293-SEC-01.
- **The linear body scan matches the replaced regex** (`fuzz-body2.mjs` to `fuzz-body4.mjs`).
  - Setup: the `3183525` regexes and the exported `85afc70` matcher, both anchor sets, 300,000 xorshift-generated texts over 49 tokens. The tokens include keywords, near misses, `;`, `'`, `$` and `"q"`.
  - Without the token `"a;b"`: 0 differences, with 53,509 DO positives and 62,201 routine positives.
  - With it: 244 DO differences, and every one of them involves `"a;b"` (row 11).
  - The code twin's 400,000-text fuzz had no quoted name holding `;`.
- **Cost** (`p10scale.mjs`). Every adversarial shape scales linearly, ratio 1.7 to 3.4 for 4n. The shapes: the R1-n3 bodies, DO `then insert … on conflict`, `with` runs, qualified-name runs, quoted pieces, `function` words, and a chain of 1,000 definitions with 1,000 calls (all flagged).
- **The exemptions cannot hide a call.**
  - The `NOT_A_CALL_SITE` forms cannot call a function when they run; a trigger's `WHEN` runs at DML time.
  - `ROUTINE_REFERENCE` strips only `function|procedure|routine <name>(`.
  - Quoted names compare as parsed values. A quoted name with metacharacters or `""` is a finding, never a crash (the developer's 7-name test).

### 4.4 C16 against D-ARCH-154 and PR65-SEC-01

- **Arm (a).** Every `public` foreign key between two `org_id` tables holds `org_id` at the same key position on both sides (T1), or, for a nullable `org_id`, has a composite sibling (T2).
  - `conparentid = 0` drops partition clones.
  - A NULL `composite` counts as not composite (fail closed).
  - The exception map is empty and pinned empty.
- **Arm (b)** is the rule I asked for in PR65-SEC-01.
  - Every unique index of a TENANT table needs `org_id` among its KEY columns (`indkey` with ordinality `<= indnkeyatts`).
  - INCLUDE columns and expressions do not count, and partial indexes stay in scope.
  - Planted and reported: an index without `org_id`, one with `org_id` as INCLUDE only, and one over an `org_id` expression. Planted and not reported: `(code, org_id)` and `(org_id, id)`.
  - The PR #65 mutant `(membership_id, role_id)` is re-planted on the real table and reported.
- **Exemptions.**
  - **Primary keys.** The standard-columns catalog check requires PK = `(id)` alone, `uuid`, default `uuidv7()`, on every non-append-only table (`standard-columns-scans.ts:181-184`). Ids are server-stamped (PR65-SEC-03).
  - **`ux_invitations__token_hash`.** It is a SHA-256 of a random token, redeemed through `platform.invitation_lookup` before any organisation context exists, so no organisation can choose or enumerate the digest (PR65-SEC-03 row). The entry must exist and must lack `org_id`, so it cannot hide drift.
  - **`organisations`.** It is out of scope by construction, because it is keyed on `id`. Its two unique indexes are PR65-SEC-03 rows routed to TASK-049.
- **Evidence.** The code twin ran the exact SQL on a PGlite-built schema: committed 0 findings, planted exactly the declared ones. Lane B on PostgreSQL 18 is merge condition C1.

### 4.5 P9-CK

- **The query.** `CHECK_NAMED_SQL` reads every non-system schema, tables and domains, with `ck\_%` escaped. Any `contype` other than `c` is a finding, including a PostgreSQL 18 NOT NULL constraint (`n`) named `ck_…`.
- **Planted controls.** A primary key and a UNIQUE constraint named `ck_` are reported; a domain CHECK is not.
- **What it backs.** The naming basis that `isCheckReplacement` now states (R1-n2).

### 4.6 SEC-TC-76..78, registry, threat model and manifest

- **Tags** (`organisations.int.test.ts` and C16). They match D-SEC-PR65-01 (a) and D-SEC-PR65-02:
  - `[SEC-TC-76]` on R1-m2, T1, the PR65-SEC-01 case and T2 (`:196, :222, :229, :235`), and on the five C16 cases;
  - `[SEC-TC-77]` on T3 (`:241`);
  - `[SEC-TC-78]` on T4/T5 and T6/T7/T8 (`:248, :256`).
- **No assertion is removed anywhere in `ca7e4b7..85afc70`.** No `SEC-TC-76x` id exists that a prefix match could confuse.
- **Threat-model rows (`threat-model.md:825-827`).** Accurate.
- **`security-test-cases.md`, section "Adopted cases SEC-TC-76..78" (added in `85afc70`).** The wording matches my assignment:
  - 76: T1, T2, the PR65-SEC-01 live-grant case, R1-m2, and C16 (a)/(b) with the exception rule and the planted controls;
  - 77: T3;
  - 78: T4 to T8.
  - Going straight to "adopted" is consistent with D-SEC-PR47-01 (1): an id that a passing test carries is never parked.
  - `parseSecurityCases` lists 67 adopted ids, and `test-ids.test.ts` pins exactly 01..64 plus 76, 77 and 78.
  - Two notes for qa-lead, not findings: TEST-STRATEGY's G3 line still reads 64/64 (code review R2-n3); and SEC-TC-74, also required, still sits under "Proposed".
  - Because the PR now carries these rows, I did **not** add them on main. That edit would conflict with the branch.
- **`required-suites.json:70-71`.**
  - `integration.required_cases`: `[]` → `["SEC-TC-76", "SEC-TC-77", "SEC-TC-78"]`.
  - `catalog-c1-c14.required_cases` gains `SEC-TC-76`.
  - `catalog-c1-c14.min_tests`: 14 → 113. Lane B `20261119T1143Z_d4de55d` observed 106, and this PR adds 7 `it` and no `it.each`.
  - `security`, `zero_skip`, `status`, `lane` and `runner` are unchanged.
  - CI reads the manifest from the base ref, so the change binds later PRs. For this PR, C1 checks the cases by hand.

## 5. Earlier items

| Item | Status |
|---|---|
| PR66-SEC-01 (LOW) (a), (b), (c), item 4 (R1-n1), optional item 5 (lone CR) | **Closed** at `85afc70` (section 4.1) |
| PR66-SEC-02 (INFO) | **Closed as filed** (the call shape is seen; the limits text is reworded). Residuals: PR293-SEC-01 |
| PR #66 code review R1-n2 (`ck_` basis) | Done: JSDoc and catalog P9-CK (section 4.5) |
| PR65-SEC-01 C16 rule part | **Done** (section 4.4); the index fix closed in D-SEC-PR65-02 |
| PR65-SEC-05 (a) tags, (b) `min_tests` ratchet | **Closed** (section 4.6) |
| PR65-SEC-05 (d) PR43-SEC-07 remainder regression cases | **Open, not delivered.** The proof stands from my PR #65 probes (PR-0065 record §5.4). Routed in section 8, due before TASK-049 merges (unchanged) |
| D-SEC-PR47-01 (2) catalog ratchet | **Done** (113) |
| PR65-SEC-02 (LOW), PR65-SEC-03/04 (INFO) | Unchanged, routed as in D-SEC-PR65-01 |

## 6. Code review twin

The twin's round 1 (`4e05347`) and round 2 (`942d8d9`), both APPROVED_WITH_NITS, agree with this round on the corpus, the scan.l parity, C16, P9-CK and the `113 = 106 + 7` arithmetic.

How its items map to this round:
- **R1-m1, R1-m2, R1-n1 (i) and (ii):** closed by `85afc70`; I re-probed each.
- **R1-n1 (iii) (rename):** now a stated limit. Item 2 of my remediation removes it, together with `SET SCHEMA` (row 1, new here).
- **R1-n2:** stated.
- **R1-n3:** closed. The body scan is linear, but its `;` split adds row 11 and keeps rows 9 and 10.
- **R1-n4:** stated in `tenant-keys.ts`; my PR293-SEC-03 adds GUEST_CAPABLE and T2 constraint names.
- **R1-m3:** closed by the PR.
- **R2-n1:** row 6.
- **R2-n2:** agreed; a three-part call is found.
- **R2-n3:** qa-lead.

New in this round:
- rows 1 to 5 and 7 to 11 of PR293-SEC-01, apart from row 6;
- PR293-SEC-02;
- PR293-SEC-03 (a) and (b).

The twin's flag S3 (PR65-SEC-05 (d) unowned) is routed in section 8.

## 7. Record binding and simulation

The checker (main's `tools/ci/check-security-owned-paths.mjs`) reads records and the head CODEOWNERS from the checked-out test merge. The record counts once two things hold: it is on main under its `PR-<NNNN>-` name, and a `pull_request` event after the rename has built the merge ref. It binds through the single `Head` row (the full `85afc70` SHA). Evidence-only commits change no owned path.

Simulation (`sec293/probes/sim293.mjs`). Setup:
- a `git clone --shared` of the main repository, with a sparse checkout of `/.github/ /docs/05-quality/security/ /tools/ci/`;
- scenario commits built with plumbing;
- main = `8b0ac3d` plus a record commit (its tip when this round was written; docs-only since `ca7e4b7` for every path the checker reads);
- the test merge = `merge-tree` of that main commit with the PR tip, checked out so that the head CODEOWNERS is the merge's;
- the checker taken from the merge's tree, with `--pr 9991` as a stand-in number.

| Scenario | Base given to the checker | Head | Result | Expected |
|---|---|---|---|---|
| S1 record on main under `PR-9991-…`, evidence tip | merge base `ca7e4b7` | evidence tip | exit 0, pass (12 owned) | pass |
| S2 same | main + record | evidence tip | exit 0, pass | pass |
| S3 same | main before the record | evidence tip | exit 0, pass | pass |
| S4 same, code head pushed alone | merge base | `85afc70` | exit 0, pass | pass |
| S5 same, two evidence-only commits | merge base | second evidence commit | exit 0, pass | pass |
| C1 record only under the placeholder name `PR-pending-…` | merge base | evidence tip | exit 1, missing | fail |
| C2 no record | merge base | evidence tip | exit 1, missing | fail |
| C3 a later `FAIL` verdict row appended | merge base | evidence tip | exit 1, missing | fail |
| C4 the `Head` row names the merge base instead | merge base | evidence tip | exit 1, missing | fail |
| C5 a `tools/db/lint-migrations.ts` change after the reviewed head (a PR293-SEC-01 fix) | merge base | that commit | exit 1, missing | fail |
| C6 a `tools/db/sql-text.ts` change after the reviewed head (a PR293-SEC-02 fix) | merge base | that commit | exit 1, missing | fail |
| C7 a `tools/quality/required-suites.json` change after the reviewed head | merge base | that commit | exit 1, missing | fail |
| C8 the record named for another PR number | merge base | evidence tip | exit 1, missing | fail |
| C9 the `Head` row names `3183525`, the commit before the round-1 fixes | merge base | evidence tip | exit 1, missing | fail |

14 of 14 scenarios are as expected. The record has exactly one `Head` row, no `Branch / head` row and one `Verdict` row, which is the last table row of the file. C9 shows why the binding is `85afc70`: that commit changed owned paths (`lint-migrations.ts`, its test, `tenant-keys.ts` and `test-ids.test.ts`) after `3183525`.

## 8. Merge conditions and routes

- **C1. Lane B evidence** at `85afc70`, or at a later head that changes no owned path after it, recorded under `docs/05-quality/tests/runs/`:
  - `catalog-c1-c14` = 113 tests, 0 failures, 0 errors, 0 skipped, including the five `[SEC-TC-76]` C16 cases and the two P9-CK cases. If the observed count differs, `min_tests` must equal it (code review condition 1).
  - `integration` 0/0/0, including the 8 `[PR66-SEC-01]` cases of `split-statements.int`, the retagged `[SEC-TC-76/77/78]` cases of `organisations.int`, and `c16-tenant-keys.int`. An unrelated `consumer.int` failure needs the orchestrator's flake ruling, not a code change.
  - `unit` 0 failures, including `lint-migrations.test.ts`, `sql-text.test.ts` and `test-ids.test.ts`.
  - `migrations` 0/0/0.
  - `rls-cross-tenant` with the same total as main's latest run (157 at `d4de55d`).
  - The hosted `security-integration` job green on the PR (ci-gate enforces it).
- **C2. Rename and merge-ref confirmation** (D-ORCH-136/138). Under the placeholder name the record step fails (sim C1).
- **If PR293-SEC-01 is fixed in this PR (preferred).** A delta security round on the new head:
  - the eleven rows with their controls;
  - the 81 lint fixtures and the repository lane unchanged;
  - a scaling ratio for any new start or split;
  - a re-run of this simulation;
  - C1 on that head.
- **Routes.**
  - **PR293-SEC-01:** database-engineer (lock `prisma-core`), due as in section 2. Interim rule until it is fixed: for any migration PR that defines a routine whose body changes data, or that holds a DO block with `FOR … IN` / `OPEN … FOR` or a string literal holding `;` before DML, the code review and the security record check the `data-changing` header by hand.
  - **PR293-SEC-02:** the next holder of `sql-text.ts`.
  - **PR293-SEC-03:** principal-architect and database-engineer in the R-ARCH-34 ruling, before TASK-051's first GUEST_CAPABLE table. The error-mapper owner for (b).
  - **PR65-SEC-05 (d), the PR43-SEC-07 remainder.** Four rolled-back `[SEC-TC-74]` cases in `organisations.int`: reset to 1; back-dated `updated_at`; wrong stamps plus a foreign organisation; the two MERGE forms. The exact shapes and outcomes are in PR-0065 §5.4. Owner: this PR's fix cycle if one runs, otherwise test-engineer under qa-lead as a named follow-up. Due before TASK-049 merges.
  - **data-model §8.3** (rule 10 call site and its limits, rule L lone CR) and **§4.6** (C16 (b), its exception map, P9-CK): principal-architect, next fold.
  - **TEST-STRATEGY G3 count** (64 → 67) and SEC-TC-74's section: qa-lead, in the acknowledgement commit of code review condition 3.

| Field | Value |
|---|---|
| Verdict | **PASS_WITH_CONDITIONS.** 0 Critical, 0 High, 0 Medium. PR66-SEC-01 (LOW) closed; PR66-SEC-02 (INFO) closed as filed; PR65-SEC-05 (a), (b) closed; PR65-SEC-01 C16 rule in place. New: PR293-SEC-01 LOW (rule 10 still misses eleven executed shapes, one a regression of the linear scan; fix preferred in this PR, otherwise before the first migration with a data-changing routine or a DO `FOR … IN` / `OPEN … FOR`, at the latest G3), PR293-SEC-02 INFO, PR293-SEC-03 INFO. Conditions: C1 lane B at `85afc70` (catalog-c1-c14 113/0/0/0 incl. C16 and P9-CK, integration, unit, migrations, rls unchanged, hosted security-integration green), C2 rename and merge-ref confirmation. PR65-SEC-05 (d) routed |
