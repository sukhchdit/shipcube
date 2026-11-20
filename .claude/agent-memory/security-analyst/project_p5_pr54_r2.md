---
name: project-p5-pr54-r2
description: PR #54 (TASK-020 020-D) security rounds 2 and 3. R2 @a6fc0a3 PASS_W_COND (C3 = PR54-SEC-07 dynamic-SQL executors reach COMMIT via standard_conforming_strings). R3 @07cf78a (record d4380fd, pushed) PASS_W_F-U: C3 + SEC-08 closed, no new finding. Follow-ups due before TASK-073
metadata:
  type: project
---

Rounds 2 and 3 are appended to `docs/05-quality/security/PR-0054-TASK-020D-security-review.md` on the PR branch.
- **Round 2:** Head row `a6fc0a3`, commit `85cf474`.
- **Round 3:** Head row `07cf78a` (the code-review r3 docs commit), commit `d4380fd`. Code head `d716f7b`, 63 owned paths.
- Code review: r2 APPROVED_WITH_NITS (R2-m1 dynamic SQL, R2-n1, R2-n2); r3 APPROVED_WITH_NITS (R3-n1: slack = 20 s default, so only the spy pins the magnitude; optional).

**R2 PASS_WITH_CONDITIONS.**
- C1 (a)-(e) and C2 closed for named forms; F5 decline accepted. Every remaining path starts with SELECT, and X1 uses two calls.
- New LOW **PR54-SEC-07 (CWE-184).** On PG 18.6, call 1 sets `query_to_xml('select set_config(''standard_'' || ''conforming_strings'', ''off'', true)', …)`; call 2 `SELECT 'x\' ; ' ; COMMIT ; SELECT ' -- '` then committed a rolled-back row.
  - The simple protocol parses a whole call first, so the setting only affects the NEXT call.
  - Session `search_path` via `query_to_xml` / `ts_stat` and a session advisory lock both survive COMMIT.
  - The code reviewer's PGlite run missed the COMMIT route: SPI refuses a direct COMMIT.
- INFO **PR54-SEC-08**: `pg_notify`.
- Ruling on R2-m1: **fix in this PR** (C3).

**R3 PASS_WITH_FOLLOW-UPS.**
- `DYNAMIC_SQL /^(?:query_to_xml|query_to_xmlschema|query_to_xml_and_xmlschema|ts_stat|ts_rewrite)$/iu` and `NOTIFY_FUNCTION` are refused anywhere in both twins.
- PG 18.6: X1-X5 refused by the guard, while the server effects still reproduce when the texts are sent directly.
- Corpus 150 + 18 templates: 0 failures. Of 156 templates, 1 intended flip (the new int row). 14/14 mutants killed.
- A catalog-hint query (arg names) found no other SPI executor; `ts_rewrite`'s arg is unnamed.
- **Open follow-ups:**
  - PR54-SEC-02 (b) readers (`table/schema/database/cursor_to_xml*`) and (c) runtime `alter`, before TASK-073's first raw statement;
  - -04 CODEOWNERS (015-C);
  - -05 optional;
  - add extension executors (dblink, crosstab, xpath_table) to `DYNAMIC_SQL` if ever installed.

**How to apply:** for a later merge-only or main-merge round, the record voids only on a change to one of the PR's 63 owned paths. Main's PR #55 `tools/ci/**` did not overlap (sim S4 pass).
- **Kit** (session scratch `review/PR-54-sec-r2/probes/`): `twins3.mjs`, `pgprobe3.mjs` + `run-pg.sh <guard dir>` (password via env only), `fixcheck3.mjs` (+3b mutants), `record-sim3.mjs`, `finalize3.mjs`.
- **Lessons:**
  - `stripTypeScriptTypes` transform reformats code, so exact-string mutant anchors must be short expressions (`isName(token, X)`).
  - `String.replace` with `$'` in the replacement corrupted a probe again; use split/join.

Related: [[project-p5-pr54-020d]], [[project-security-review-conventions]]
