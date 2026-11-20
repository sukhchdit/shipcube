---
name: project-wave1-pr65-r1-rulings
description: D-ARCH-154..157 (PR #65 / TASK-037 code review r1) — composite tenant-bound foreign keys through org_id (rule T1/T2, catalog C16), invitations only in BUSINESS_CUSTOMER organisations, AFTER ROW membership lifecycle guard, created_by at invitation acceptance; open follow-ups and the probe techniques that worked under the host rule
metadata:
  type: project
---

PR #65 r1 rulings, 2026-11-19, commit `0a0738c`; ADR-0005 amendment 13 (items 27 to 30); data-model §4.7 (new), §4.6 C16, §3.2, A31; risks R-ARCH-34; `rulings/wave-1-pr65-r1-rulings.md` (section 5 = exact change list for the PR).

- **D-ARCH-154:** a reference between two organisation-keyed tables is a composite FK through `org_id` (T1: replaces the single key, parent gets `ux_<parent>__org_id_id`; T2 for nullable `org_id`: single key stays, composite added as `fk_<child>__org_id_<x>_id`). First instances `membership_roles → memberships`, `memberships → invitations`.
- **D-ARCH-155:** `platform.role_scope_matches_org()` refuses an `invitations` row outside a `BUSINESS_CUSTOMER` organisation (`TG_TABLE_NAME` branch, same marker).
- **D-ARCH-156:** `trg_memberships__lifecycle_guard`, `AFTER ROW`: member = actor and `ACTIVE` at insert, `user_id`/`org_id` immutable, `REMOVED` terminal, no SYSTEM exemption.
- **D-ARCH-157:** at invitation acceptance `created_by` = the accepting user; "`created_by` = the inviter" of [[wave0-sheet-fold7-rulings]] (D-ARCH-123) is withdrawn.

**Why:**
- Referential-integrity checks bypass RLS. Probed: organisation A's role row naming B's membership made B's own grant fail with `23505` on a row B could not see.
- `OPERATOR_SUPER_ADMIN` holds every role-assignable permission, `org:member:invite` included, so an operator-role invitation was one lost service check away.
- `p_memberships__tenant` is `FOR ALL` and `p_users__org_member_read` reads memberships: any session of an organisation could expose any user's profile row. D-ARCH-123 had closed this for `INVITED` only.
- `std_columns_guard` forces `created_by` = the transaction's actor, so D-ARCH-123's inviter stamp was never implementable.

**How to apply:**
- Every later migration with a reference between two tables that carry `org_id` follows T1 or T2. Check C16 exists (default owner TASK-293, fallback TASK-051) before approving one.
- ~~Still owed by me: the guest-side binding of GUEST_CAPABLE rows.~~ Ruled 2026-11-19 (D-ARCH-162..164); rule T2 is revised, see [[wave1-r-arch34-operator-rulings]].
- Routed, check DECISIONS before the TASK-227 card is folded: product-manager wording of REQ-ORG-011 and US-084 (D-ARCH-157).
- A new assertion trigger on an RLS table is `AFTER ROW` by default: `WITH CHECK` answers first and the generated RLS suite needs no new trait. `BEFORE` triggers pre-empt `WITH CHECK`.
- Provisioning code (demo seed TASK-089, `ops:staff-bootstrap`) runs the membership insert with the member as `app.actor_id`. An "organisation enrols a user" path needs an ADR-0005 amendment.
- When a ruling sets a column value on an STD table, check it against the standard-columns guard first (see [[wave0-sheet-fold3-rulings]]).

**Process lessons:**
1. The PR worktree can hold the developer's uncommitted fix-cycle edits. Snapshot the file to the scratchpad, write the change list against statement text and not line numbers, and `diff -q` the snapshot again before committing.
2. Prescribed SQL was executed before it was written down (the PR's blocker was unexecuted SQL). What worked under the "no Jest, no Docker" host rule, all single-process:
   - PGlite probe: bootstrap 00 to 02 plus every migration, statements split with `tools/db/sql-text.ts` `splitStatements`, `uuidv7()` replaced by `gen_random_uuid()`; run patched and unpatched as a negative control. A committed seed in a separate transaction matters when a foreign key is involved (an update re-checks the key only on a key change or a same-transaction insert).
   - `node tools/deps/prisma-cli.mjs --verify-only validate --schema <scratch dir>` and `… migrate diff --from-empty --to-schema <scratch dir> --script` need no database and show the DDL Prisma would emit.
   - `tools/db/lint-migrations.ts` on a `git archive` extract with a `node_modules` junction. Remove the junction with `cmd //c rmdir` before any `rm -rf`, or the target is emptied.
3. `grep -c $'\r'` counts every line in this Git Bash; use `git ls-files --eol` (the repo is `eol=lf` in index and working tree).
4. Trailer: the brief again named an older model; I used the harness attribution and said so in the handoff, as in [[wave1-batch11-rulings]].
5. Plan cards were not folded this time (docs-only brief): the card lines are in the rulings file §7 for the senior-developer's next fold.
