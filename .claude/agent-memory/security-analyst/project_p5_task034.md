---
name: project-p5-task034
description: TASK-034 (backup/restore rehearsal, rule R, zero-downtime probe) security round 1 at 3ee36f01 = PASS_W_COND (main 6feeb139, D-SECPR034-01); PR034-SEC-01 MEDIUM superuser restore runs migration-authored CHECK/generated code; LOW 02-05, INFO 06-08; next-round checks
metadata:
  type: project
---

Round 1 of TASK-034 = **PASS_WITH_CONDITIONS**, bound to `3ee36f01` (diff `530629f4..3ee36f01`, 40 files, 39 owned). Record `docs/05-quality/security/PR-pending-TASK-034-security-review.md` + D-SECPR034-01, committed on local main `6feeb139` (2026-11-21, not pushed). Code review twin: same-name record in `docs/05-quality/reviews/`, R2 APPROVED_WITH_NITS (D-CRPR034-01; R2-m1 MINOR forces a fix cycle 3). IDs are `PR034-SEC-nn`, distinct from PR #34's `PR34-SEC-nn`.

- **PR034-SEC-01 MEDIUM (CWE-250).** `pg_restore` as superuser evaluates table CHECK, domain CHECK and STORED generated expressions as the superuser during COPY. A migration routine `IF current_user is super THEN ALTER ROLE … SUPERUSER` used in a CHECK (NOT VALID + VALIDATE, `SET lock_timeout` first) lints clean on base and head. PGlite proves migrator-harmless and superuser-load escalates for all 3 call sites. `pg_dump` inlines validated CHECKs. The tool also restores on the LIVE cluster (the brief), not §8.6's fresh stack, and re-runs `00-roles.sql` cluster-wide. Fix: a lint rule + C15 catalog query (`pg_depend` from `pg_constraint`/generated `pg_attrdef` to non-`pg_catalog` procs, verified on PGlite) + isolation or a recorded deviation. C1 is due before `restore-rehearsal` activation, before any non-synthetic rehearsal, and at the latest G3.
- **LOW:**
  - 02: artefact modes (`createWriteStream` and `mkdirSync` without a mode).
  - 03: `maskValues` misses `DETAIL: Failing row contains (…)`, RAISE values and escaped-quote debug lines.
  - 04: the bare alias `t` in the fingerprint resolves to a column named `t`. Fix with `(t.*)::text`.
  - 05: the range `subtype_diff` writer is invisible to rule 10 (an IMMUTABLE wrapper may PERFORM a volatile writer: 51 writes in a GiST build).
- **INFO:**
  - 06: `ESCAPE_STRING_MARK` (ends in U+2063) glued to `E'` makes `E` an identifier character, so the R1-M2 decoding never runs in the lint path. Rule 16 still refuses every E-string.
  - 07: unsigned rule R records, accepted until M5 with a review step.
  - 08: the child-process environment carries the superuser URL.
- **Closed:** PR5-SEC-14, PR11-SEC-11 d (D-TASK034-12 accepted), PR293-SEC-04 a/b, D-ARCH-172. Also a live main bypass: `EXECUTE 'SELECT 1; -- c<LF>UPDATE …'` was clean on base because base normalised the newlines away before reading.

**Why:** the restore makes routine superuser loads (rule R requires a rehearsal per data-changing migration), and the linter only polices data writes (rule 10), never privilege inside routine bodies.

**How to apply:**
- **Next rounds.**
  - C2: delta round on the fix head (R2-m1 + any SEC fixes). Re-run the P1 shapes, the P5 fuzz with the mutant control, P6, and the fixed findings' probes.
  - C3: merge-only round. `package.json` is owned and changed on both sides. Main has #80-#84 with 4 migrations, all `data-changing: no`, and out of name order (POST-SEC-04).
- **Probe kit** (session scratch `t034sec/probes/`, may vanish):
  - `hooks.mjs`: `registerHooks` maps `.js` to `.ts` and strips types in transform mode;
  - `p1-lint`/`p1b-lint`: `lintMigrations(dir, label, {tableClasses: []})` base vs head;
  - `p2-linear`, `p3-mask`, `p4b-pglite`/`p4d-vectors` (PGlite + pglite-tools `pgDump`), `p5b-fuzz`/`p5m-fuzz`, `p6-mark`, `p7-range`, `p8-catalog`, `gl-emu.mjs` (borrowed from `t8182mo`).
- **PGlite gotchas:**
  - pglite-tools `pgDump` leaves the session read-only, so run writes before it.
  - A domain CHECK fires only on coercion: `INSERT … SELECT` of a domain-typed column skips it, while text input (what COPY supplies) fires it.
- **Commit gotcha:** a pathspec commit fails for an untracked file. `git add` the record first, then `git commit -- <record> <DECISIONS>`, after a numstat check (N/0) of DECISIONS.

Related: [[project-p5-task293]], [[project-p5-pr66-task290]], [[project-p5-wave0-db-baseline]], [[project-p5-postmerge-80-84]], [[project-security-review-conventions]]
