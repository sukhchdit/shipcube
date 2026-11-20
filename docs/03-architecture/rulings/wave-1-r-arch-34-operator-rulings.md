# Wave-1: rulings on guest-row binding (R-ARCH-34), operator memberships (PR65-SEC-02 (b)) and four smaller items (2026-11-19)

Owner principal-architect. Decisions D-ARCH-162 to D-ARCH-167. These are the two dispatch gates of D-SD-002: TASK-051 `guestclaim` and TASK-089 `seeddemo`.

**Inputs.** D-SD-002. `docs/05-quality/security/PR-0065-TASK-037-security-review.md` (PR65-SEC-02, PR65-SEC-04). `docs/05-quality/security/PR-0072-TASK-293-security-review.md` (PR293-SEC-03). risks.md R-ARCH-33, R-ARCH-34. data-model §3.2, §3.10, §4.3, §4.5, §4.6, §4.7, §6.1, §9, §10. ADR-0004, ADR-0005 (amendments 12 and 13), ADR-0013 (amendment 3). The merged code at `29fe2a1`: migration `20261117000000_organisations_identity`, `prisma/tests/catalog/tenant-keys.ts` and `c16-tenant-keys.int.test.ts`, `apps/api/src/platform/db/map-db-error.ts`, `prisma/tests/organisations/cases.ts`, `prisma/seed/**`, `tools/db/lint-migrations.ts`. The cards of TASK-051, TASK-057, TASK-087 and TASK-089. US-080, US-167, REQ-QUOTE-015 to -017.

**Edited (docs only).** ADR-0005 (amendment 14, items 31 to 36, and dated pointers at the three places it revises). ADR-0004 (item 6 note). ADR-0013 (amendment 3, one note). data-model §1.1 (P12), §1.5, §3.2, §3.5, §3.10, §4.3, §4.4, §4.6 (C16), §4.7, §6.1, §9.1, §9.3, §10.1, §10.5 and amendment row A32. risks.md (R-ARCH-33, R-ARCH-34, new R-ARCH-35). DECISIONS.md.

**Deliberately not edited.** `docs/04-plan/generator/plan-data.mjs` and the generated cards: the card lines are in section 6 for senior-developer's fold. `api/openapi.yaml`, `api/README.md`, the story files and `gherkin-test-map.md` (tooling inputs). No product code.

**Run here.** Single-process Node probes on in-memory PGlite 0.4.3 (PostgreSQL 17.5), in the session scratchpad. No Jest, no container, nothing written to the repository.

- **Probe A (ruling 1).** A reduced schema: `quotes`, two child tables, the tenant and guest policies with `FORCE`, a non-superuser role with the context keys set, committed seed rows. One control table carries the D-ARCH-154 T2 shape. Run twice: with a plain and with a partial organisation-side unique index.
- **Probe B (ruling 2).** Bootstrap files 00 to 02 and the six released migrations, applied statement by statement with `tools/db/sql-text.ts` `splitStatements` as `platform_migrator` (`uuidv7()` replaced by `gen_random_uuid()`), then the migration of section 3.4. Run without the new migration as the negative control. Its `down.sql` was applied and the function text compared.
- **Linter.** `tools/db/lint-migrations.ts` `lintMigrations` on a scratch copy of `prisma/migrations` plus the new migration and its `down.sql`: 0 findings with the manifest entry of section 3.4, the rule-9 finding without it.
- **Prisma.** `prisma validate` and `migrate diff --from-empty --to-schema … --script` (no database) on a scratch copy of the schema with the models of sections 2.8 and 3.4. The differ emits the unique indexes and the composite keys under the names given here.

**Not run here.** Lint, type check, unit, integration, catalog and generated suites. PGlite is PostgreSQL 17, not 18. Lane B on the implementing PRs is the evidence. If a PostgreSQL 18 observation differs from sections 2.7 or 3.5, the task returns to principal-architect and no expectation is adapted without a ruling.

## 1. Decisions

| # | Question | Ruling | Where |
|---|---|---|---|
| (1a) | R-ARCH-34: a guest row of a GUEST_CAPABLE child is bound to its quote by a single-column key only | **Owner-bound key pair (D-ARCH-162).** Two composite keys per reference, one through `org_id` and one through `guest_token_hash`, and no single-column key. The claim becomes one statement. | ADR-0005 am. 14 items 31 and 32; data-model §4.7, §4.3, §3.10 |
| (1b) | Which unique keys a GUEST_CAPABLE table may hold; scope of C16 arm (b) | **Every unique key holds an owner column (D-ARCH-163).** `org_id` or `guest_token_hash` is a key column, and a uniqueness rule comes as one index per owner column. Global secret digests are listed exceptions. C16 (b) covers TENANT and GUEST_CAPABLE tables and reads exclusion constraints. | ADR-0005 am. 14 item 33; data-model §4.7, §4.6 C16 |
| (1c) | PR293-SEC-03 (b): a row in another organisation and an unknown id must get the same response | **One mapping for every `23503`, and no code branches on the constraint name (D-ARCH-164).** With the pair of (1a) the database already answers both with one constraint. | ADR-0005 am. 14 item 34; data-model §4.7 |
| (2) | PR65-SEC-02 (b): is a database control needed for memberships of the OPERATOR organisation | **Yes: a staff grant (D-ARCH-165).** The lifecycle guard refuses a membership of an OPERATOR organisation unless `operator_staff_grants` names the member. `platform_app` can read that table and cannot write it; the provisioning lane writes it as `platform_migrator`. | ADR-0005 am. 14 item 35; data-model §3.2, §9; risks R-ARCH-35 |
| (3a) | PR65-SEC-04 (a): `INVITED` is reachable by UPDATE | **Closed in the same function replacement (D-ARCH-166).** | ADR-0005 am. 14 item 36; data-model §3.2 |
| (3b) | PR65-SEC-04 (b): a PARTNER organisation can be created below the service | **Deferred to the M3 partner design (D-ARCH-166).** | data-model §3.2; section 4.2 |
| (3c) | A users transition guard on TASK-057 | **Not adopted (D-ARCH-166).** The service-layer control stands. | section 4.3 |
| (3d) | Outbox purge horizon: 30 days (ADR-0004, ADR-0013) or 7 days (data-model) | **30 days (D-ARCH-167).** The ADR stands and the data-model is corrected. | ADR-0004 item 6; data-model §3.5, §6.1, §10.1, §10.5 |

## 2. Ruling 1: guest rows, unique keys and the error answer (R-ARCH-34; D-ARCH-162 to 164)

### 2.1 Facts

- The four GUEST_CAPABLE tables carry `org_id` and `guest_token_hash`, both nullable, with `ck_<t>__owner CHECK (num_nonnulls(org_id, guest_token_hash) = 1)`. The children copy both columns from their quote so that every policy is a column comparison (data-model §3.10).
- Nothing makes the copy equal to the quote. D-ARCH-154 rule T2 binds a child from the moment its `org_id` is set. While `org_id` is NULL the composite key checks nothing, and the single-column key accepts any quote id.
- What the control table of probe A shows for that shape (section 2.7, rows L1 to L5):
  - A guest row that names another guest's quote is accepted. It is invisible to the owner of the quote and the claim does not touch it.
  - A unique key without an owner column answers questions about another owner's rows: `23505` when the other owner holds the value, another code when not. This is the PR65-SEC-01 channel again.
  - The same unique key lets a foreign row take a value. For `ux_quote_shares__quote_active` that would mean one owner blocking another owner's share link, which is the write effect D-ARCH-154 closed on the TASK-037 tables.
  - A row of another organisation and an unknown id fail on two different constraints (PR293-SEC-03 (b)).
- A quote id is not a secret (P1). `quote_share_resolve` returns it to every holder of a share link.
- Guests are the least trusted writers: a guest token costs one anonymous request.
- No route lets a client name the quote of a child row except through a read of that quote under RLS. The gap is at the table, for the case where a service is wrong. That is the case RLS exists for (ADR-0005, NFR-SEC-011).

### 2.2 Options for (a)

| Option | Binds guest rows | Closes the unique-key channel | Claim | Cost |
|---|---|---|---|---|
| **A. Owner-bound pair: `(org_id, quote_id)` and `(guest_token_hash, quote_id)`, no single-column key** | yes, declaratively, for every role | yes, with (b) | one statement | one more unique index on `quotes`; two optional relations per child in Prisma |
| B. Keep T2 as it is, accept the existence channel | no | no | unchanged | none |
| C. Keep the single-column key and add the guest key as a third | yes | yes, with (b) | one statement | as A, plus a third key; a row of another owner and an unknown id still fail on different constraints |
| D. A trigger that compares the child with its quote | yes for inserts | no | unchanged | hand-written per table; it does not catch a claim that leaves a child table behind |
| E. Deferred guest key (`DEFERRABLE INITIALLY DEFERRED`) with the claim in separate statements | yes | yes, with (b) | unchanged | the refusal arrives at COMMIT, through another error path; `ON UPDATE NO ACTION` instead of the project's `RESTRICT` |

**A is chosen.** The owner CHECK leaves exactly one owner column set, so exactly one of the two keys is checked for every row. Existence is therefore always checked and the single-column key adds nothing. Dropping it is what makes a foreign parent and an unknown id fail on the same constraint.

### 2.3 Rule T2 as revised (data-model §4.7)

D-ARCH-154 said that for a nullable `org_id` the single-column key stays and the composite key is added beside it. That holds only where the referencing table has no `guest_token_hash`. The rule is now:

- **T2-G: the referencing table is GUEST_CAPABLE.** A reference to another organisation-keyed table is a pair of composite keys and no single-column key:

  ```sql
  CREATE UNIQUE INDEX ux_<parent>__org_id_id           ON public.<parent> (org_id, id);
  CREATE UNIQUE INDEX ux_<parent>__guest_token_hash_id ON public.<parent> (guest_token_hash, id);
  ALTER TABLE public.<child> ADD CONSTRAINT fk_<child>__org_id_<x>_id
    FOREIGN KEY (org_id, <x>_id) REFERENCES public.<parent> (org_id, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
  ALTER TABLE public.<child> ADD CONSTRAINT fk_<child>__guest_token_hash_<x>_id
    FOREIGN KEY (guest_token_hash, <x>_id) REFERENCES public.<parent> (guest_token_hash, id) ON DELETE RESTRICT ON UPDATE RESTRICT;
  ```

  Both target indexes are plain, not partial: PostgreSQL does not accept a partial index as the target of a foreign key.
- **T2-O: a reference that only organisation rows may hold.** Where a guest row can never hold the reference, the table carries `ck_<child>__<x>_org_only CHECK (<x>_id IS NULL OR org_id IS NOT NULL)` and the key through `org_id` alone, under the T1 name `fk_<child>__<x>_id`. Each such key is an entry of the C16 (a) exception map with the CHECK as its reason. First instance: `quotes.requote_of_quote_id` (section 2.8).
- **T2-N: nullable `org_id`, no `guest_token_hash`.** Unchanged from D-ARCH-154: the single-column key stays and the composite key sits beside it. No instance exists yet.
- **T1** is unchanged.

**The claim is one statement.** The claim changes the owner of the quote and of its children. With the pair, updating the quote first fails the guest key of the children, and updating the children first fails their organisation key. Both keys are satisfied when the four updates are one statement, because PostgreSQL runs the referential checks at the end of the statement:

```sql
WITH p AS (UPDATE public.quote_packages SET org_id = $org, guest_token_hash = NULL, updated_at = now(), updated_by = $user, version = version + 1
            WHERE quote_id = $quote AND org_id IS NULL),
     o AS (UPDATE public.quote_options  SET org_id = $org, guest_token_hash = NULL, updated_at = now(), updated_by = $user, version = version + 1
            WHERE quote_id = $quote AND org_id IS NULL),
     s AS (UPDATE public.quote_shares   SET org_id = $org, guest_token_hash = NULL, updated_at = now(), updated_by = $user, version = version + 1
            WHERE quote_id = $quote AND org_id IS NULL)
UPDATE public.quotes
   SET org_id = $org, claimed_by_user_id = $user, claimed_at = now(),
       claimed_from_token_hash = guest_token_hash, guest_token_hash = NULL,
       updated_at = now(), updated_by = $user, version = version + 1
 WHERE id = $quote AND org_id IS NULL;
```

- The affected-row count is that of the outer `UPDATE`, so `expectAffected(result, 1)` (ADR-0005 am. 10 item 15) is unchanged.
- A table that does not exist yet is left out: `quote_shares` joins the statement with TASK-237.
- A claim that forgets a child table fails with `23503` (probe row C6). That is intended: no child row can stay behind as a guest row of a claimed quote.
- This is also what AT-US-080-04 says: "org_id is set in one statement".

### 2.4 (b) Unique keys on tables with a nullable `org_id` (D-ARCH-163)

- **U1 (gate).** Every non-primary unique index and every exclusion constraint of a GUEST_CAPABLE table has `org_id` or `guest_token_hash` among its key columns. INCLUDE columns and expressions do not count. The only exceptions are globally unique secret digests that no writer can choose (`ux_quote_shares__share_token_hash`), each listed in the C16 (b) exception map with its reason.
- **U2 (design rule, checked in review).** A uniqueness rule that must hold for guest rows and for organisation rows is two indexes, one per owner column, with the same remaining key columns and the same predicate. NULLs are distinct, so the index through `org_id` says nothing about guest rows and the other way round. The index through `org_id` leads with it (REQ-RLS-001) and may be partial on `org_id IS NOT NULL`.
- **Why the owner column.** PostgreSQL checks a unique index while it inserts the index entry, before the referential check at the end of the statement. With the owner column in the key, a foreign row never meets the owner's entries and goes on to fail the key of (a).
- **Reads carry the owner predicate.** A child is read with `org_id = …` or `guest_token_hash = …` next to `quote_id`, because the unique indexes lead with the owner column. The policies add the same predicate, but an OR of policies is not an index condition.
- **Why U2 is not a catalog finding.** A rule that only organisation rows can break (a label of a saved quote) is legitimate, and predicates would have to be compared as text. C16 is the isolation gate; U2 is integrity.

### 2.5 (c) One answer for a refused reference (D-ARCH-164)

- **E1.** `mapDbError` gives every `23503` the same mapping: 500 `INTERNAL_ERROR`, reason `DB_ERROR`, not retryable, with the SQLSTATE and the Prisma code as its only variable parts. It never reads the constraint name, the message or the detail. That is what the code at `29fe2a1` does; TASK-051 pins it with a test.
- **E2.** No service, repository or module catalogue maps a foreign-key violation (`P2003`, or `23503` under a raw query) to a client-visible answer by constraint name, field name, message or detail. A reference that a client supplies is resolved by a read under RLS before the write. A row of another owner and an absent row are then the same miss and get the route's catalogue answer (404, or 422 for a field).
- **Why 500 and not 404.** A `23503` that reaches the mapper means a service skipped that read, or a parent vanished between read and write. Tenant tables are never hard-deleted at runtime, so in practice it is a defect, and it should fail the abuse suite instead of looking like a clean miss. This is the reading D-ARCH-156 gave `MEMBERSHIP_LIFECYCLE_VIOLATION`.
- **Unique violations.** A `23505` may be mapped by index name only for an index that C16 (b) passes or lists. Such an index holds an owner column or a digest, so the answer speaks about the writer's own rows only.
- **T2-N pairs.** Should one ever exist, its two constraint names still get one answer by E1 and E2.

### 2.6 Catalog assertion C16 as amended (owner TASK-051)

**Arm (a), references.** Scope as today: every foreign key in `public` whose two tables both carry `org_id`.

- A key is *org-bound* when `org_id` is a key column on both sides at the same position, and *guest-bound* when `guest_token_hash` is.
- Referencing `org_id` is `NOT NULL` (T1): the key is org-bound.
- Referencing `org_id` is nullable and the table has no `guest_token_hash` (T2-N): as today.
- The referencing table has `guest_token_hash` (T2-G):
  - the key is org-bound or guest-bound; any other key is reported, a single-column key included;
  - a guest-bound key needs an org-bound sibling of the same table pair with the same remaining columns;
  - an org-bound key needs a guest-bound sibling likewise, or an entry in `TENANT_REFERENCE_EXCEPTIONS` (T2-O).
- The exception map no longer has to be empty. Every entry names a live key that the rule would otherwise report.
- Planted probes, rolled back: a guest-capable parent with both target indexes and one child per shape. Not reported: the pair. Reported: a single-column key beside an org-bound key; an org-bound key alone; a guest-bound key alone; a guest-bound key with its columns swapped.

**Arm (b), unique keys.**

- Scope: the TENANT and GUEST_CAPABLE tables of the manifests that have an `org_id` column. USER_OWNED tables stay out: their isolation key is the user, and the rule for them is written when the first one carries a unique business key.
- Read: non-primary indexes with `indisunique OR indisexclusion`. This closes PR293-SEC-03 (c).
- Finding: no owner column among the key columns. The owner column is `org_id`, or `guest_token_hash` where the table has that column.
- Exceptions: `TENANT_UNIQUE_EXCEPTIONS`, as today. Each entry is live and holds no owner column.
- Planted probes on the guest-capable parent: `UNIQUE (code)` and `EXCLUDE USING btree (code WITH =)` are reported; `UNIQUE (org_id, code)`, `UNIQUE (guest_token_hash, code)` and `EXCLUDE USING btree (org_id WITH =, code WITH =)` are not.

The two limits stated in the header of `tenant-keys.ts` (sibling by containment; exclusion constraints out of scope) are replaced by the two that remain: predicates are not compared, and USER_OWNED tables are out of scope.

### 2.7 Probe A results (PostgreSQL 17.5; every case as the runtime role, in its own rolled-back transaction)

| Case | Result |
|---|---|
| G1 guest H1: package naming H2's quote, a `seq` H2 holds | `23503 fk_quote_packages__guest_token_hash_quote_id` |
| G2 the same, a free `seq` | the same |
| G3 guest H1: package naming a quote of organisation A | the same |
| G4 guest H1: package naming an unknown id | the same |
| G5, G6 guest H1: own package, free `seq`; duplicate `seq` | ok; `23505 ux_quote_packages__guest_quote_seq` |
| G7 guest H1: a guest row carrying H2's hash | `42501` RLS |
| T1 organisation A: package naming B's quote, a `seq` B holds | `23503 fk_quote_packages__org_id_quote_id` |
| T2, T3 organisation A: package naming a guest quote; an unknown id | the same |
| T4, T5 organisation A: own package, free `seq`; duplicate `seq` | ok; `23505 ux_quote_packages__org_quote_seq` |
| S1 guest H1: active share naming H2's quote, which has one | `23503 fk_quote_shares__guest_token_hash_quote_id` |
| S2 organisation A: active share naming B's quote, which has one | `23503 fk_quote_shares__org_id_quote_id` |
| S3, S4 owner: second active share; first active share | `23505` on the owner's own index; ok |
| C1 claim of H1's quote by A, one statement, `RESTRICT` keys | 1 row; quote, package and share now belong to A |
| C2 control: quote first, then children | `23503 fk_quote_packages__guest_token_hash_quote_id` |
| C3 control: children first, then quote | `23503 fk_quote_packages__org_id_quote_id` |
| C4 the statement with H2's token for H1's quote | 0 rows, nothing changed |
| C5 a second claim by B after A's | 0 rows |
| C6 the statement without the `quote_shares` update | `23503 fk_quote_shares__guest_token_hash_quote_id` |
| R1 to R3 organisation A re-quotes its own quote; B's quote; an unknown id | ok; `23503 fk_quotes__requote_of_quote_id`; the same |
| R4 a guest quote with a re-quote reference | `23514 ck_quotes__requote_org_only` |
| L1, L4 control table (single key + org composite, `UNIQUE (quote_id, seq)`): a value the other owner holds | `23505 ux_legacy__quote_seq` |
| L2, L3 control: organisation A naming B's parent; an unknown id | `23503 fk_legacy__org_id_quote_id`; `23503 fk_legacy__quote_id` |
| L5 control: guest H1 naming H2's parent, free value | ok, the row is accepted |

The results are the same with `ux_quote_packages__org_quote_seq` partial on `org_id IS NOT NULL`.

### 2.8 The quote tables (data-model §3.10 as amended; TASK-087, TASK-237)

| Table | Keys to `quotes` | Unique indexes | Other |
|---|---|---|---|
| `quotes` | `fk_quotes__requote_of_quote_id (org_id, requote_of_quote_id) → quotes (org_id, id)` (T2-O) | `ux_quotes__org_id_id (org_id, id)`, `ux_quotes__guest_token_hash_id (guest_token_hash, id)` | `ck_quotes__requote_org_only`; the other indexes are unchanged |
| `quote_packages` | the pair | `ux_quote_packages__org_quote_seq (org_id, quote_id, seq) WHERE org_id IS NOT NULL` and `ux_quote_packages__guest_quote_seq (guest_token_hash, quote_id, seq)` replace `ux_quote_packages__quote_seq` and `ix_quote_packages__org_quote` | |
| `quote_options` | the pair | none | `ix_quote_options__quote` and `ix_quote_options__org_quote` are unchanged |
| `quote_shares` | the pair | `ux_quote_shares__org_quote_active (org_id, quote_id) WHERE revoked_at IS NULL` and `ux_quote_shares__guest_quote_active (guest_token_hash, quote_id) WHERE revoked_at IS NULL` replace `ux_quote_shares__quote_active`; `ux_quote_shares__share_token_hash` stays and is an exception-map entry | `ix_quote_shares__quote_created` and `ix_quote_shares__org_quote` are unchanged |

- **Re-quote.** `requote_of_quote_id` is set only when the new quote and the original belong to the same organisation. That is the case of US-167 (a claimed quote; another organisation's id is a 404). A guest's new quote has a new token, so it cannot be bound to the old one and carries NULL.
- **Prisma.** `@@unique([orgId, id])` and `@@unique([guestTokenHash, id])` on `Quote`; on each child two optional relations that share `quoteId`, for example `quoteOfOrg Quote? @relation("…Org", fields: [orgId, quoteId], references: [orgId, id], …, map: "fk_quote_packages__org_id_quote_id")` and `quoteOfGuest Quote? @relation("…Guest", fields: [guestTokenHash, quoteId], references: [guestTokenHash, id], …)`. `prisma validate` accepts this on 7.10 and the differ emits the statements of section 2.3. The partial indexes stay in the migration SQL, as on the TASK-037 tables.
- **Later references into these tables** (a shipment naming its quote or option) are T1: the referenced table gets `ux_<parent>__org_id_id`. On `quote_options` that index is about 50 MB per million rows (estimate), so the task that adds the reference states the size it expects.
- **Cost on `quotes`.** One more unique index, `(guest_token_hash, id)`: a 48-byte key, about 70 to 90 MB per million rows (estimate, not measured), and one more index insertion per quote. The quote path is bounded by carrier calls (O2), not by index writes.

## 3. Ruling 2: memberships of the OPERATOR organisation (PR65-SEC-02 (b); D-ARCH-165)

### 3.1 Facts

- `platform.app_is_operator()` grants cross-tenant read to an actor with an ACTIVE membership of an OPERATOR organisation and the OPERATOR scope. The membership row is the only fact the database checks.
- D-ARCH-156 makes every membership insert a self-insert in the context of the target organisation. The database therefore cannot tell staff provisioning from a user who enrols himself.
- Probe B, without the new migration: user X, with no membership anywhere, in a context that names `OPERATOR_ORG_ID`, inserts his own ACTIVE membership and an `OPERATOR_SUPER_ADMIN` link. With the OPERATOR scope he then sees every organisation (1 before, 2 of 2 after). This reproduces P3 of the security record.
- Reaching it needs a context whose organisation is the operator organisation for a non-member, plus a path that inserts a membership of the actor into the context organisation. Both would be service defects. The first is exactly what TASK-049 (login default) and TASK-224 (organisation switch) are about to write.
- The same reasoning produced two database controls already: D-ARCH-151 (nobody creates a second OPERATOR organisation) and D-ARCH-155 (nobody is invited into it). Joining the existing one is the remaining path, and the outcome is the same: read access to every tenant.
- No staff-provisioning code exists yet. TASK-089 writes the first.

### 3.2 Options

| Option | Stops a self-insert by `platform_app` | New privilege or role | Fits Run 1 provisioning |
|---|---|---|---|
| S. Service-layer control only (route conditions of PR65-SEC-02 (a)) | no | none | yes |
| **F. A grant table that `platform_app` cannot write, checked by the lifecycle guard** | yes | none: SELECT for `platform_app`, the writer is the existing migrator lane | yes: the seed CLI already holds the migrator connection |
| D. Operator memberships only through a `SECURITY DEFINER` function | only against paths that do not call it | a write-capable definer function and a write policy for `platform_definer`, against ADR-0005 amendments 6, 12 item 25 and 13 item 29 | yes |
| R. A dedicated provisioning login role | yes | a new role, credential, policy set and grant set; the audit entry of the membership would need it too | no: too large |
| G. A marker in the transaction context | no: any session can set a context key | none | yes |

**F is chosen.** It is the only option under which no logic defect of the application can produce the row, and it adds one small table and one clause.

### 3.3 The rule

1. **`public.operator_staff_grants`** holds one row per user who may hold a membership of an OPERATOR organisation. Class GLOBAL, `runtimeReadOnly`: no RLS, `SELECT` for `platform_app`, written by `platform_migrator` only.
2. **`platform.memberships_lifecycle_guard()`** refuses the INSERT of a membership of an OPERATOR organisation unless a grant names `NEW.user_id`. An organisation the session cannot see counts as OPERATOR (fail closed). The other rules are unchanged, and "member = actor" still holds for staff.
3. **Who writes a grant.** The provisioning lane, as `platform_migrator`, between creating the user and adding the membership: the demo seed (TASK-089) now and `ops:staff-bootstrap` at M5. Neither api nor worker ever holds that credential (REQ-RLS-005), so no request can write one.
4. **Staff management in the admin app (M2, EPIC-B-207)** needs a runtime writer. That is a new ADR-0005 amendment: an INSERT policy on the grants gated by `platform.app_is_operator()`, and the removal of a grant when a staff member leaves.

**What it does not do.**

- It does not stop SQL injection. A session that can set the context keys can name an existing staff member as its actor (T-35, accepted). The grant closes minting a membership, not impersonation.
- A context that names the operator organisation for a non-member still shows that organisation's own rows, as for any tenant. The route conditions of PR65-SEC-02 (a) stay binding on TASK-049, TASK-224 and TASK-227.
- A granted user can add his own membership again after it was REMOVED, in an operator context. Run 1 has no flow that removes staff; item 4 deletes the grant.

### 3.4 Exact change list for the implementing task

**Task.** Recommended: TASK-051, as a second migration directory in the same PR (database-engineer, the RLS lane, one security review for both guards; it then needs the `mod-organisations` lock, which no other task of batch 1.5 holds). senior-developer may place it elsewhere at the fold. The only ordering rule: it is merged before TASK-089 opens its PR, and TASK-089 depends on it.

1. **`prisma/migrations/<timestamp>_operator_staff_grants/migration.sql`** (4 statements; linted clean here):

   ```sql
   -- migration-kind: expand
   -- data-changing: no
   -- reversible: yes
   --
   -- Operator staff grants and the operator rule of the membership lifecycle guard (PR65-SEC-02 (b), PR65-SEC-04 (a);
   -- D-ARCH-165, D-ARCH-166; ADR-0005 amendment 14 items 35 and 36; data-model §3.2). An ACTIVE membership of the OPERATOR
   -- organisation is what platform.app_is_operator() reads, and D-ARCH-156 makes every membership insert a self-insert, so
   -- a session whose context names the operator organisation could create its own. The guard now refuses a membership of
   -- an OPERATOR organisation unless a grant row names the member. platform_app holds SELECT only on the grants: the
   -- provisioning lane writes them as platform_migrator. user_id is a logical reference (no foreign key): the lane
   -- writes the grant for the id of the user it has just created.

   CREATE TABLE "public"."operator_staff_grants" (
       "id" UUID NOT NULL DEFAULT uuidv7(),
       "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
       "created_by" UUID NOT NULL,
       "updated_by" UUID NOT NULL,
       "version" INTEGER NOT NULL DEFAULT 1,
       "user_id" UUID NOT NULL,

       CONSTRAINT "pk_operator_staff_grants" PRIMARY KEY ("id"),
       CONSTRAINT "ck_operator_staff_grants__version" CHECK ("version" >= 1)
   );

   CREATE UNIQUE INDEX "ux_operator_staff_grants__user_id" ON "public"."operator_staff_grants"("user_id");

   GRANT SELECT ON TABLE "public"."operator_staff_grants" TO platform_app;

   -- The function of 20261117000000_organisations_identity, replaced in place: the trigger and its column list are
   -- unchanged. New: the operator rule on INSERT (fail closed: an organisation the session cannot see counts as OPERATOR)
   -- and the INVITED rule on UPDATE (PR65-SEC-04 (a): the insert rule alone left INVITED reachable by UPDATE).
   CREATE OR REPLACE FUNCTION platform.memberships_lifecycle_guard() RETURNS trigger
   LANGUAGE plpgsql
   SET search_path = pg_catalog, pg_temp
   AS $$
   DECLARE
     v_rule text;
   BEGIN
     IF TG_OP = 'INSERT' THEN
       v_rule := CASE WHEN NEW.user_id IS DISTINCT FROM platform.app_actor_id() THEN 'the member is not the actor'
                      WHEN NEW.status  IS DISTINCT FROM 'ACTIVE'                 THEN 'a membership is created ACTIVE'
                      WHEN NOT EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = NEW.org_id AND o.type <> 'OPERATOR')
                       AND NOT EXISTS (SELECT 1 FROM public.operator_staff_grants g WHERE g.user_id = NEW.user_id)
                                                                                 THEN 'an operator membership needs a staff grant' END;
     ELSE
       v_rule := CASE WHEN NEW.user_id IS DISTINCT FROM OLD.user_id THEN 'user_id cannot change'
                      WHEN NEW.org_id  IS DISTINCT FROM OLD.org_id  THEN 'org_id cannot change'
                      WHEN OLD.status = 'REMOVED' AND NEW.status IS DISTINCT FROM 'REMOVED' THEN 'REMOVED is terminal'
                      WHEN NEW.status = 'INVITED' AND OLD.status IS DISTINCT FROM 'INVITED' THEN 'INVITED is reserved' END;
     END IF;
     IF v_rule IS NOT NULL THEN
       RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = pg_catalog.format('MEMBERSHIP_LIFECYCLE_VIOLATION: %s', v_rule);
     END IF;
     RETURN NULL;
   END $$;
   ```

   - The table comes first, so a deploy that stops early leaves the old guard in place.
   - No trigger statement: `trg_memberships__lifecycle_guard` already fires on `INSERT OR UPDATE OF user_id, org_id, status`.
   - No foreign key to `users`: the Prisma relation would need a back-relation line in `identity.prisma`, which TASK-052 edits in the same batch, and a grant for an id that is no user grants nothing.
2. **`down.sql`** (2 statements): `CREATE OR REPLACE FUNCTION platform.memberships_lifecycle_guard()` with the body of `20261117000000_organisations_identity` copied verbatim, then `DROP TABLE IF EXISTS "public"."operator_staff_grants";`. The function comes first because it must stop reading the table before the table goes. The body must be byte-identical, or the up → down → up snapshot differs (checked here: the function text after `down.sql` equals the text before the migration).
3. **`tools/db/table-classes/organisations.json`:** `{ "name": "operator_staff_grants", "class": "GLOBAL", "runtimeReadOnly": true }`, and the `$comment` names the table.
4. **`prisma/sql/grants.manifest`:** `platform_app SELECT public.operator_staff_grants`, with a comment line naming this migration.
5. **`prisma/schema/organisations.prisma`:** model `OperatorStaffGrant` (`@@map("operator_staff_grants")`, the standard columns, `userId`, `@@unique([userId], map: "ux_operator_staff_grants__user_id")`), no relation. The header comment lists the new guard rule with the other things kept in SQL.
6. **`packages/shared/src/classification/registry.ts`:** the seven columns, all INTERNAL (C10).
7. **Tests** (`prisma/tests/organisations/cases.ts` and `organisations.int.test.ts`; each as `platform_app` with the production context statement; the security-analyst assigns the SEC-TC id):

   | # | Case | Expected |
   |---|---|---|
   | O1 | User X, no membership, context `OPERATOR_ORG_ID`: own ACTIVE membership | `P0001 MEMBERSHIP_LIFECYCLE_VIOLATION: an operator membership needs a staff grant`; with the OPERATOR scope X still sees one organisation |
   | O2 | `platform_app` inserts a grant | `42501` (no privilege) |
   | O3 | `platform_migrator` inserts the grant for a user; then that user, context `OPERATOR_ORG_ID`: own ACTIVE membership and an operator role link | ok; ok; with the OPERATOR scope the user reads another organisation's row |
   | O4 | A granted user is inserted by another actor; a granted user joins as SUSPENDED | `P0001 … the member is not the actor`; `P0001 … a membership is created ACTIVE` |
   | O5 | A user without a grant joins a BUSINESS_CUSTOMER organisation | ok |
   | O6 | `ACTIVE → INVITED` | `P0001 … INVITED is reserved`; `ACTIVE ↔ SUSPENDED` and `→ REMOVED` stay ok |

   - Mutant, by hand, reported in the PR: with the operator clause removed, O1 becomes ok.
   - Existing fixtures plant operator memberships as the superuser under `session_replication_role = replica` (`cases.ts` `fixture`, the generated RLS suite, C1 to C12), so no trigger fires and none of them changes.
8. **Catalog.** C5 (the manifest line), C10 and C1 to C2 (GLOBAL allow-list) follow from items 3, 4 and 6. C15 is unaffected: the table is `runtimeReadOnly`. C11 is unaffected: the function stays `SECURITY INVOKER`.

**TASK-089, then.**

- The staff-provisioning function exported from the service layer takes the grant step as a port with one method. Its only implementation lives in the seed lane and uses the migrator connection the seed CLI already opens (`prisma/seed/migrator-connection.ts`):

  ```sql
  INSERT INTO public.operator_staff_grants (created_by, updated_by, user_id)
  VALUES ($system, $system, $1) ON CONFLICT (user_id) DO NOTHING;
  ```

- Sequence per staff user: the registration path in the context of the personal organisation (as today); the grant; the ACTIVE membership and the operator role in the context of `OPERATOR_ORG_ID` with the staff user as actor.
- A re-run after a failure at any point finds the user by e-mail and adds what is missing. The grant insert is idempotent.
- Only the eight staff users get a grant. A test counts the rows.
- The line "no raw SQL and no migrator connection writes users, organisations or memberships" stays true.
- No module under `apps/` implements the port. A repository test says so until the M2 amendment.

**`ops:staff-bootstrap` (M5).** The same function and the same port. The pipeline task therefore holds the migrator credential for the grant and the runtime credential for everything else (R-ARCH-33 as amended).

### 3.5 Probe B results (PostgreSQL 17.5; real bootstrap files and migrations)

| Case | Without the migration | With it |
|---|---|---|
| X, no membership, context `OPERATOR_ORG_ID`: own ACTIVE membership | ok | `P0001 … an operator membership needs a staff grant` |
| X: `OPERATOR_SUPER_ADMIN` link on that membership | ok | no membership to link |
| Organisations X sees from another organisation's context with the OPERATOR scope | 1 before, 2 after | 1, 1 |
| `platform_app` inserts a grant | | `42501` permission denied |
| `platform_app` reads the grants | | ok |
| `platform_migrator` inserts a grant; again | | 1 row; 0 rows |
| The granted user: own membership, operator role link, then the OPERATOR scope | | ok; ok; sees both organisations |
| The granted user joins from another organisation's context | | `42501` RLS (`WITH CHECK` first) |
| Another actor inserts the granted user; the granted user joins as SUSPENDED | | `P0001`, the unchanged rules |
| A user without a grant joins a BUSINESS_CUSTOMER organisation | | ok |
| `ACTIVE → INVITED`; `ACTIVE → SUSPENDED → ACTIVE → REMOVED`; `REMOVED → ACTIVE` | | `P0001 … INVITED is reserved`; ok; `P0001 … REMOVED is terminal` |
| The new table: RLS flags, owner, `platform_app` privileges | | no RLS, `platform_migrator`, `SELECT` |
| The function: owner, definer flag, `proconfig`; the trigger definition | | `platform_migrator`, false, `{search_path=pg_catalog, pg_temp}`; unchanged |
| `down.sql`, then the function text and the table | | text equals the original; table gone |

## 4. Smaller items (D-ARCH-166, D-ARCH-167)

### 4.1 PR65-SEC-04 (a): INVITED by UPDATE

The guard gains `WHEN NEW.status = 'INVITED' AND OLD.status IS DISTINCT FROM 'INVITED' THEN 'INVITED is reserved'` in the function replacement of section 3.4. Until that migration merges, "no INVITED row is written" is a property of the database for INSERT only. The comment in the merged migration cannot be corrected (an applied file is immutable), so data-model §3.2 says it.

### 4.2 PR65-SEC-04 (b): PARTNER organisations below the service

**Deferred to the M3 partner design.**

- A PARTNER organisation and a `PARTNER_DEVELOPER` link give nothing in M1: no partner route and no partner permission exists.
- The cheap control, a CHECK that forbids the type until M3, binds every role. It would change a merged case (the type-immutability control of `prisma/tests/organisations/cases.ts` turns an organisation into PARTNER with the trigger off), and M3 would have to drop it again in a contract step.
- The M3 design decides how a partner organisation comes into existence. A grant table like the one of section 3 is the likely shape. That design owns the backstop and is not complete without one.

### 4.3 The users transition guard (TASK-057)

**Not adopted.** The security record asked whether a trigger should limit what a user may do to the own `users` row (self: only `PENDING_VERIFICATION → ACTIVE` with verification, and `ACTIVE → DEACTIVATED`).

- At the database every writer of a `users` row has `app.actor_id` = that user, because `p_users__own` is the only write policy. The verification flow, the housekeeping job that suspends for an overdue MFA enrolment, `ops:staff-reactivate` and the worker of OI-25 all act as the user.
- A trigger therefore cannot tell a self-service request from a system flow. A rule "self may only …" would refuse the legitimate transitions, and an actor type carried in the context is a value any session can set.
- What a trigger could still enforce, the bare transition graph, does not stop the cases of the finding: `SUSPENDED → ACTIVE` is a legal edge.
- The control stays where the distinction exists: closed Joi schemas on every self-service route and the T-33 fuzz cases that name each column. Both are already on the TASK-049 and TASK-057 cards (PR65-SEC-04 (c)).
- Revisit with M2 staff management, which adds an operator write branch on `users`.

### 4.4 Outbox purge horizon

**30 days.** ADR-0004 item 6 is the accepted decision. The 7 days of the data-model were never decided anywhere.

- A dead-letter record lives 14 days (ADR-0013 amendment 3). Redriving an `outbox_event` job needs its row, because `platform.job_context` reads it. At 7 days the row would be gone for the second half of the record's life.
- Order of the horizons: failed jobs 7 days ≤ dead-letter records 14 days ≤ outbox events 30 days ≤ `processed_events` 30 days after processing, which is never earlier than publishing.
- Cost: about 1.6 million resident rows instead of 0.4 million, about 1 GB with indexes (estimate from data-model §10.1).
- 30 days is also the limit ADR-0013 amendment 3 uses for anything that may outlive an erasure request.
- The purge itself has no owning task (section 7).

## 5. What changes for which finding

| Finding | State after these rulings |
|---|---|
| R-ARCH-34 (guest side) | Ruled. Closes when TASK-087 creates the quote tables under C16 as amended by TASK-051 |
| PR293-SEC-03 (a), (b), (c) | Ruled: sections 2.4, 2.5 and 2.6. (d), the catalogue text, is done in data-model §4.6 |
| PR65-SEC-02 (b) | Ruled: a database control. Closes when the migration of section 3.4 merges |
| PR65-SEC-04 (a) | Closes with the same migration |
| PR65-SEC-04 (b) | Deferred to M3, with the reason |
| PR65-SEC-04 (c), users guard | Not adopted; the service conditions stand |

## 6. Card lines for senior-developer's fold

Written without apostrophes, for `plan-data.mjs`.

| Task | Line |
|---|---|
| TASK-051 `guestclaim` | Replace the DISPATCH GATE line: "R-ARCH-34 RULED (D-ARCH-162..164; ADR-0005 amendment 14 items 31 to 34; data-model 4.7, 4.6 C16, 4.3 and 3.10 as amended 2026-11-19; rulings/wave-1-r-arch-34-operator-rulings.md section 2): (a) a GUEST_CAPABLE table references an organisation-keyed table through the OWNER-BOUND PAIR fk_<child>__org_id_<x>_id and fk_<child>__guest_token_hash_<x>_id, with NO single-column key, and the parent carries ux_<parent>__org_id_id and ux_<parent>__guest_token_hash_id; (b) every non-primary unique index of a GUEST_CAPABLE table holds org_id or guest_token_hash among its key columns; (c) the claim is ONE statement, the child updates as data-modifying CTEs of the UPDATE of quotes, and expectAffected(result, 1) reads the outer UPDATE" |
| TASK-051 | "C16 AS AMENDED (rulings section 2.6; SEC-TC-76): tenant-keys.ts and c16-tenant-keys.int.test.ts gain guest-bound keys in arm (a) (rules T2-G and T2-O, exception entries must be live) and, in arm (b), the scope TENANT plus GUEST_CAPABLE, the owner column org_id or guest_token_hash, and indisunique OR indisexclusion; planted probes as listed there; the header states the two remaining limits" |
| TASK-051 | "GUEST BINDING TESTS (rulings section 2.7): guest-claim.int.test.ts runs cases G1 to G7, T1 to T5, S1 to S4 and C1 to C6 as platform_app with the production context statement on committed seed rows, on rolled-back GUEST_CAPABLE probe tables rendered by renderRls with the keys and indexes of data-model 3.10; every refused reference names the one constraint of its writer class; C2 and C3 are the controls that show why the claim is one statement; an observation that differs on PostgreSQL 18 goes back to principal-architect" |
| TASK-051 | "ONE ANSWER FOR A REFUSED REFERENCE (D-ARCH-164; PR293-SEC-03 (b)): no product code changes; add to map-db-error.test.ts that two driver errors which differ only in constraint, message and detail map deep-equal for a raw 23503 and for Prisma P2003, and a repository test that no file under apps/ or packages/ other than map-db-error.ts and its test names P2003 or 23503" |
| The implementing task of ruling 2 (recommended TASK-051; lock `mod-organisations`) | "OPERATOR STAFF GRANTS (PR65-SEC-02 (b), PR65-SEC-04 (a); D-ARCH-165, D-ARCH-166; ADR-0005 amendment 14 items 35 and 36; rulings section 3.4): migration <timestamp>_operator_staff_grants exactly as given there (table, unique index, SELECT grant, CREATE OR REPLACE of platform.memberships_lifecycle_guard with the operator clause and the INVITED clause), down.sql with the original function body verbatim, the GLOBAL runtimeReadOnly manifest entry, the grants.manifest line, the Prisma model without a relation, the classification rows, and cases O1 to O6 with the mutant check; merged before TASK-089 opens its PR" |
| TASK-089 `seeddemo` | Replace the DISPATCH GATE line: "OPERATOR STAFF GRANT (D-ARCH-165; rulings section 3.4): per staff user the seed runs the registration path, then writes the grant through the migrator connection of the seed CLI (INSERT INTO public.operator_staff_grants ... ON CONFLICT (user_id) DO NOTHING, created_by and updated_by = the SYSTEM actor), then adds the ACTIVE membership and the operator role in the context of OPERATOR_ORG_ID with the staff user as actor; the staff-provisioning function exported from the service layer takes the grant step as a one-method port whose only implementation is in the seed lane, and a repository test shows no module under apps/ implements it; tests: a self-join into the operator organisation without a grant gives P0001, the provisioned join succeeds, a re-run after a failure between any two steps completes, and exactly the 8 staff users have a grant". Add the dependency on the implementing task |
| TASK-087 `quote` | "QUOTE TABLES AS AMENDED 2026-11-19 (D-ARCH-162, D-ARCH-163; data-model 3.10; rulings section 2.8): ux_quotes__org_id_id and ux_quotes__guest_token_hash_id; quote_packages and quote_options reference quotes through the owner-bound pair with no single-column key; ux_quote_packages__org_quote_seq (partial on org_id IS NOT NULL) and ux_quote_packages__guest_quote_seq replace ux_quote_packages__quote_seq and ix_quote_packages__org_quote; requote_of_quote_id has the composite key through org_id, ck_quotes__requote_org_only and the entry fk_quotes__requote_of_quote_id in TENANT_REFERENCE_EXCEPTIONS; every read and write of a child carries the owner predicate next to quote_id; C16 is the gate" |
| TASK-146 `claim` | "The claim is the ONE statement of data-model 4.3 as amended 2026-11-19 (D-ARCH-162): a claim written as separate statements fails with 23503 by design" |
| TASK-194 `requote` | "requote_of_quote_id is set only when the original quote belongs to the same organisation (D-ARCH-162); a guest quote carries NULL (ck_quotes__requote_org_only)" |
| TASK-237 share | "quote_shares AS AMENDED 2026-11-19 (D-ARCH-162, D-ARCH-163; data-model 3.10): the owner-bound pair; ux_quote_shares__org_quote_active and ux_quote_shares__guest_quote_active replace ux_quote_shares__quote_active; ux_quote_shares__share_token_hash is an entry of TENANT_UNIQUE_EXCEPTIONS with its reason; the claim statement gains the quote_shares update in this PR, with a test that a claim leaving a share behind fails with 23503" |
| TASK-057 `totp` | In the PR65-SEC-04 (c) line, replace the sentence that starts "if principal-architect rules a users transition guard" by: "no users transition guard is added (D-ARCH-166: every writer of a users row acts as that user, so a trigger cannot tell a self-service request from a system flow)" |
| The owner of the outbox purge (none today; TASK-043 if it is still undispatched) | "PURGE (ADR-0004 item 6; data-model 6.1 and 10.5 as corrected 2026-11-19; D-ARCH-167): the daily housekeeping job deletes outbox events published more than 30 days ago in batches of 5,000 and processed_events rows processed more than 30 days ago; a test shows a row published 29 days ago stays" |

## 7. Open, not decided here

1. **The outbox purge has no owning task.** No card names it. senior-developer assigns it at the fold (TASK-043, or the first housekeeping task after it).
2. **TASK-051 grows.** With C16, the pin test and, if it hosts ruling 2, a second migration, its size is M, not S. senior-developer decides whether ruling 2 becomes a late task instead; R-CI-MIN argues for one PR.
3. **SEC-TC ids** for the operator rule and for the guest-binding cases: security-analyst, with the review of the implementing PR.
4. **Threat model.** T-35 names the operator membership as the second factor behind the scope. The row can cite the grant as what protects that factor from being minted (security-analyst, next threat-model revision).
5. **M2 staff management** (EPIC-B-207) needs the amendment of section 3.3 item 4. product-manager may note it on the epic.
6. **data-model §8.3** still owes the wording for the rule-10 call sites and the lone carriage return (D-ORCH-139). Not done here.
