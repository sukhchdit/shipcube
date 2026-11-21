# Wave-1: rulings on guest-row binding (R-ARCH-34), operator memberships (PR65-SEC-02 (b)) and four smaller items (2026-11-19)

Owner principal-architect. Decisions D-ARCH-162 to D-ARCH-167. These are the two dispatch gates of D-SD-002: TASK-051 `guestclaim` and TASK-089 `seeddemo`. *Amended 2026-11-21 after the TASK-051 code review, round 1, and lane B on PostgreSQL 18 (D-ARCH-207 to D-ARCH-214): section 8, with dated notes in sections 2.3 to 2.7, 3.3, 3.4 and 6.*

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
- **T2-O: a reference that only organisation rows may hold.** Where a guest row can never hold the reference, the table carries `ck_<child>__<x>_org_only CHECK (<x>_id IS NULL OR org_id IS NOT NULL)` and the key through `org_id` alone, under the T1 name `fk_<child>__<x>_id`. Each such key is an entry of the C16 (a) exception map with the CHECK as its reason. *Amended 2026-11-21 (D-ARCH-209; section 8.3):* the entry names the CHECK, and C16 verifies it. First instance: `quotes.requote_of_quote_id` (section 2.8).
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
- A claim that forgets a child table fails: with `23001` (`restrict_violation`) on PostgreSQL 18, where the update of the quote is a refused `RESTRICT` action on the guest key of the forgotten table, and with `23503` on 17.5 (probe row C6). That is intended: no child row can stay behind as a guest row of a claimed quote. *Amended 2026-11-21 (D-ARCH-211; section 8.5): the first version named `23503` only.*
- This is also what AT-US-080-04 says: "org_id is set in one statement".

### 2.4 (b) Unique keys on tables with a nullable `org_id` (D-ARCH-163)

- **U1 (gate).** Every non-primary unique index and every exclusion constraint of a GUEST_CAPABLE table has `org_id` or `guest_token_hash` among its key columns. INCLUDE columns and expressions do not count. The only exceptions are globally unique secret digests that no writer can choose (`ux_quote_shares__share_token_hash`), each listed in the C16 (b) exception map with its reason. *Amended 2026-11-21 (D-ARCH-208; section 8.2):* an owner column counts only when it separates owners. In a unique index it is `NOT NULL` or the index is `NULLS DISTINCT`; in an exclusion constraint its operator is equality.
- **U2 (design rule, checked in review).** A uniqueness rule that must hold for guest rows and for organisation rows is two indexes, one per owner column, with the same remaining key columns and the same predicate. NULLs are distinct, so the index through `org_id` says nothing about guest rows and the other way round. *Amended 2026-11-21 (D-ARCH-208; section 8.2):* both indexes are `NULLS DISTINCT`, the default. `NULLS NOT DISTINCT` is excluded: it makes every row whose owner column is NULL one owner. One index over both owner columns is not an alternative. The index through `org_id` leads with it (REQ-RLS-001) and may be partial on `org_id IS NOT NULL`.
- **Why the owner column.** PostgreSQL checks a unique index while it inserts the index entry, before the referential check at the end of the statement. With the owner column in the key, a foreign row never meets the owner's entries and goes on to fail the key of (a).
- **Reads carry the owner predicate.** A child is read with `org_id = …` or `guest_token_hash = …` next to `quote_id`, because the unique indexes lead with the owner column. The policies add the same predicate, but an OR of policies is not an index condition.
- **Why U2 is not a catalog finding.** A rule that only organisation rows can break (a label of a saved quote) is legitimate, and predicates would have to be compared as text. C16 is the isolation gate; U2 is integrity.

### 2.5 (c) One answer for a refused reference (D-ARCH-164)

- **E1.** `mapDbError` gives every `23503` the same mapping: 500 `INTERNAL_ERROR`, reason `DB_ERROR`, not retryable, with the SQLSTATE and the Prisma code as its only variable parts. It never reads the constraint name, the message or the detail. That is what the code at `29fe2a1` does; TASK-051 pins it with a test. *Amended 2026-11-21 (D-ARCH-212; section 8.6):* the same holds for `23001` (`restrict_violation`), which PostgreSQL 18 answers for a refused `RESTRICT` action. Both SQLSTATEs get the same response.
- **E2.** No service, repository or module catalogue maps a foreign-key violation (`P2003`, or `23503` under a raw query) to a client-visible answer by constraint name, field name, message or detail. *Amended 2026-11-21 (D-ARCH-212):* this covers `23001` as well, and Prisma 7.10.1 reports both SQLSTATEs of a model operation as `P2003`. A reference that a client supplies is resolved by a read under RLS before the write. A row of another owner and an absent row are then the same miss and get the route's catalogue answer (404, or 422 for a field).
- **Why 500 and not 404.** A `23503` that reaches the mapper means a service skipped that read, or a parent vanished between read and write. Tenant tables are never hard-deleted at runtime, so in practice it is a defect, and it should fail the abuse suite instead of looking like a clean miss. This is the reading D-ARCH-156 gave `MEMBERSHIP_LIFECYCLE_VIOLATION`. A `23001` that reaches the mapper means a statement changed or deleted a referenced key while a row still named it, a claim that left a child table out for instance. It is a defect in the same way (2026-11-21).
- **Unique violations.** A `23505` may be mapped by index name only for an index that C16 (b) passes or lists. Such an index holds an owner column or a digest, so the answer speaks about the writer's own rows only.
- **T2-N pairs.** Should one ever exist, its two constraint names still get one answer by E1 and E2.

### 2.6 Catalog assertion C16 as amended (owner TASK-051)

**Arm (a), references.** Scope as today: every foreign key in `public` whose two tables both carry `org_id`.

- A key is *org-bound* when `org_id` is a key column on both sides at the same position, and *guest-bound* when `guest_token_hash` is.
- Referencing `org_id` is `NOT NULL` (T1): the key is org-bound.
- Referencing `org_id` is nullable and the table has no `guest_token_hash` (T2-N): as today.
- The referencing table has `guest_token_hash` (T2-G):
  - the key is org-bound or guest-bound; any other key is reported, a single-column key included;
  - a key that holds both owner columns is reported and is nobody's sibling (*added 2026-11-21, D-ARCH-207; section 8.1*);
  - a guest-bound key needs an org-bound sibling of the same table pair with the same remaining columns;
  - an org-bound key needs a guest-bound sibling likewise, or an entry in `TENANT_REFERENCE_EXCEPTIONS` (T2-O).
- The exception map no longer has to be empty. Every entry names a live key that the rule would otherwise report. *Amended 2026-11-21 (D-ARCH-209; section 8.3):* an entry also names the CHECK of its key. It is live only for a key reported as org-bound without a guest-bound sibling, and only while that CHECK passes the verification of section 8.3.
- Planted probes, rolled back: a guest-capable parent with both target indexes and one child per shape. Not reported: the pair. Reported: a single-column key beside an org-bound key; an org-bound key alone; a guest-bound key alone; a guest-bound key with its columns swapped. *2026-11-21:* also reported: a key that holds both owner columns (`c16_g_both`). The T2-O cases are in section 8.3.

**Arm (b), unique keys.**

- Scope: the TENANT and GUEST_CAPABLE tables of the manifests that have an `org_id` column. USER_OWNED tables stay out: their isolation key is the user, and the rule for them is written when the first one carries a unique business key.
- Read: non-primary indexes with `indisunique OR indisexclusion`. This closes PR293-SEC-03 (c).
- Finding: no owner column among the key columns. The owner column is `org_id`, or `guest_token_hash` where the table has that column. *Amended 2026-11-21 (D-ARCH-208; section 8.2):* an owner column counts only when it separates owners (rules B1 and B2).
- Exceptions: `TENANT_UNIQUE_EXCEPTIONS`, as today. Each entry is live and holds no owner column. *2026-11-21:* no owner key column at all. An index whose owner column does not count cannot be an exception.
- Planted probes on the guest-capable parent: `UNIQUE (code)` and `EXCLUDE USING btree (code WITH =)` are reported; `UNIQUE (org_id, code)`, `UNIQUE (guest_token_hash, code)` and `EXCLUDE USING btree (org_id WITH =, code WITH =)` are not. *2026-11-21:* five more probes in section 8.2.

The two limits stated in the header of `tenant-keys.ts` (sibling by containment; exclusion constraints out of scope) are replaced by the two that remain: predicates are not compared, and USER_OWNED tables are out of scope. *2026-11-21:* the exclusion-operator shape of R1-M1 is enforced and is not a third limit (section 8.2).

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
| C2 control: quote first, then children | PostgreSQL 18: `23001 fk_quote_packages__guest_token_hash_quote_id`; 17.5: `23503`, the same constraint *(amended 2026-11-21, D-ARCH-211)* |
| C3 control: children first, then quote | `23503 fk_quote_packages__org_id_quote_id` |
| C4 the statement with H2's token for H1's quote | 0 rows, nothing changed |
| C5 a second claim by B after A's | 0 rows |
| C6 the statement without the `quote_shares` update | PostgreSQL 18: `23001 fk_quote_shares__guest_token_hash_quote_id`; 17.5: `23503`, the same constraint *(amended 2026-11-21, D-ARCH-211)* |
| R1 to R3 organisation A re-quotes its own quote; B's quote; an unknown id | ok; `23503 fk_quotes__requote_of_quote_id`; the same |
| R4 a guest quote with a re-quote reference | `23514 ck_quotes__requote_org_only` |
| L1, L4 control table (single key + org composite, `UNIQUE (quote_id, seq)`): a value the other owner holds | `23505 ux_legacy__quote_seq` |
| L2, L3 control: organisation A naming B's parent; an unknown id | `23503 fk_legacy__org_id_quote_id`; `23503 fk_legacy__quote_id` |
| L5 control: guest H1 naming H2's parent, free value | ok, the row is accepted |

The results are the same with `ux_quote_packages__org_quote_seq` partial on `org_id IS NOT NULL`.

**PostgreSQL 18 (lane B run `20261121T0336Z_203d02e` of TASK-051 at `203d02eb`; added 2026-11-21, D-ARCH-211).** Every case of this table reproduced on 18 on the `gc_` probe tables, with one difference: C2 and C6 answer `23001` (`restrict_violation`) on the constraint named here. In both, a key of the quote changes while a row still names it. That is a refused `RESTRICT` action, and PostgreSQL 18 gives it its own SQLSTATE. A row that names a missing parent (G1 to G4, T1 to T3, S1, S2, R2, R3, C3, L2, L3) is `23503` in both versions. Section 8.5.

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
2. **`platform.memberships_lifecycle_guard()`** refuses the INSERT of a membership of an OPERATOR organisation unless a grant names `NEW.user_id`. An organisation the session cannot see counts as OPERATOR (fail closed). The other rules are unchanged, and "member = actor" still holds for staff. *Amended 2026-11-21 (security review PR051-SEC-03; D-ARCH-214; section 8.11):* the same holds for an UPDATE that makes such a membership ACTIVE.
3. **Who writes a grant.** The provisioning lane, as `platform_migrator`, between creating the user and adding the membership: the demo seed (TASK-089) now and `ops:staff-bootstrap` at M5. Neither api nor worker ever holds that credential (REQ-RLS-005), so no request can write one.
4. **Staff management in the admin app (M2, EPIC-B-207)** needs a runtime writer. That is a new ADR-0005 amendment: an INSERT policy on the grants gated by `platform.app_is_operator()`, and the removal of a grant when a staff member leaves.

**What it does not do.**

- It does not stop SQL injection. A session that can set the context keys can name an existing staff member as its actor (T-35, accepted). The grant closes minting a membership, not impersonation.
- A context that names the operator organisation for a non-member still shows that organisation's own rows, as for any tenant. The route conditions of PR65-SEC-02 (a) stay binding on TASK-049, TASK-224 and TASK-227.
- A granted user can add his own membership again after it was REMOVED, in an operator context. Run 1 has no flow that removes staff; item 4 deletes the grant.
- *2026-11-21 (D-ARCH-214):* deleting a grant does not change a membership. A member who is ACTIVE when the grant is deleted stays an operator until the membership is suspended or removed, so the membership goes first (section 8.11).

### 3.4 Exact change list for the implementing task

**Task.** Recommended: TASK-051, as a second migration directory in the same PR (database-engineer, the RLS lane, one security review for both guards; it then needs the `mod-organisations` lock, which no other task of batch 1.5 holds). senior-developer may place it elsewhere at the fold. The only ordering rule: it is merged before TASK-089 opens its PR, and TASK-089 depends on it.

1. **`prisma/migrations/<timestamp>_operator_staff_grants/migration.sql`** (4 statements; the first version was linted clean here. *Amended 2026-11-21, D-ARCH-214: the UPDATE clause for `ACTIVE` and the comment above the function, run on a reduced schema and not linted again; section 8.11*):

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
   -- unchanged. New: the operator rule, on INSERT and on an UPDATE that makes the row ACTIVE (fail closed: an
   -- organisation the session cannot see counts as OPERATOR; PR051-SEC-03: the insert rule alone let a suspended
   -- membership return without a grant), and the INVITED rule on UPDATE (PR65-SEC-04 (a): the insert rule alone left
   -- INVITED reachable by UPDATE).
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
                      WHEN NEW.status = 'INVITED' AND OLD.status IS DISTINCT FROM 'INVITED' THEN 'INVITED is reserved'
                      WHEN NEW.status = 'ACTIVE' AND OLD.status IS DISTINCT FROM 'ACTIVE'
                       AND NOT EXISTS (SELECT 1 FROM public.organisations o WHERE o.id = NEW.org_id AND o.type <> 'OPERATOR')
                       AND NOT EXISTS (SELECT 1 FROM public.operator_staff_grants g WHERE g.user_id = NEW.user_id)
                                                                                 THEN 'an operator membership needs a staff grant' END;
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
   | O7 *(added 2026-11-21, D-ARCH-214)* | A SUSPENDED membership of the operator organisation whose grant the migrator has deleted: `SUSPENDED → ACTIVE`; the same once the grant is back; `SUSPENDED → ACTIVE` in a BUSINESS_CUSTOMER organisation | `P0001 … an operator membership needs a staff grant`, and with the OPERATOR scope the member still sees one organisation; ok; ok |

   - Mutant, by hand, reported in the PR: with the operator clause removed, O1 becomes ok. *2026-11-21:* and with the UPDATE clause removed, O7 becomes ok.
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
| TASK-146 `claim` | "The claim is the ONE statement of data-model 4.3 as amended 2026-11-19 (D-ARCH-162): a claim written as separate statements fails with 23503 by design" *Superseded 2026-11-21 by the line of section 8.9 (D-ARCH-211).* |
| TASK-194 `requote` | "requote_of_quote_id is set only when the original quote belongs to the same organisation (D-ARCH-162); a guest quote carries NULL (ck_quotes__requote_org_only)" |
| TASK-237 share | "quote_shares AS AMENDED 2026-11-19 (D-ARCH-162, D-ARCH-163; data-model 3.10): the owner-bound pair; ux_quote_shares__org_quote_active and ux_quote_shares__guest_quote_active replace ux_quote_shares__quote_active; ux_quote_shares__share_token_hash is an entry of TENANT_UNIQUE_EXCEPTIONS with its reason; the claim statement gains the quote_shares update in this PR, with a test that a claim leaving a share behind fails with 23503" *The last clause is superseded 2026-11-21 by the line of section 8.9 (D-ARCH-211).* |
| TASK-057 `totp` | In the PR65-SEC-04 (c) line, replace the sentence that starts "if principal-architect rules a users transition guard" by: "no users transition guard is added (D-ARCH-166: every writer of a users row acts as that user, so a trigger cannot tell a self-service request from a system flow)" |
| The owner of the outbox purge (none today; TASK-043 if it is still undispatched) | "PURGE (ADR-0004 item 6; data-model 6.1 and 10.5 as corrected 2026-11-19; D-ARCH-167): the daily housekeeping job deletes outbox events published more than 30 days ago in batches of 5,000 and processed_events rows processed more than 30 days ago; a test shows a row published 29 days ago stays" |

## 7. Open, not decided here

1. **The outbox purge has no owning task.** No card names it. senior-developer assigns it at the fold (TASK-043, or the first housekeeping task after it).
2. **TASK-051 grows.** With C16, the pin test and, if it hosts ruling 2, a second migration, its size is M, not S. senior-developer decides whether ruling 2 becomes a late task instead; R-CI-MIN argues for one PR.
3. **SEC-TC ids** for the operator rule and for the guest-binding cases: security-analyst, with the review of the implementing PR.
4. **Threat model.** T-35 names the operator membership as the second factor behind the scope. The row can cite the grant as what protects that factor from being minted (security-analyst, next threat-model revision).
5. **M2 staff management** (EPIC-B-207) needs the amendment of section 3.3 item 4. product-manager may note it on the epic.
6. **data-model §8.3** still owes the wording for the rule-10 call sites and the lone carriage return (D-ORCH-139). Not done here.

## 8. Amendment of 2026-11-21: TASK-051 code review round 1, security review round 1 and lane B on PostgreSQL 18 (D-ARCH-207 to D-ARCH-214)

**Inputs.** `docs/05-quality/reviews/PR-pending-TASK-051-code-review.md` (CHANGES_REQUESTED; section 4 questions 1 to 6; findings R1-M1, R1-m1, R1-m4, R1-n1; observation L-1; merge condition 6). The branch `feat/TASK-051-guest-capable-tables-atomic-claim` at `203d02eb`, read by SHA: `prisma/tests/catalog/tenant-keys.ts`, `prisma/tests/harness/guest-claim-probe.ts`, `prisma/tests/rls/guest-claim.int.test.ts`, `apps/api/src/platform/db/map-db-error.ts` and its test, `tools/repo/refused-reference-answer.test.ts`. Lane B run `20261121T0336Z_203d02e` on PostgreSQL 18 (summary and log). `@prisma/adapter-pg` and `@prisma/client` 7.10.1 as installed. `prisma/sql/function-templates/std-columns-guard.sql`. `api/openapi.yaml`, read only: `claimQuote`, the three operations with `x-tenancy: guest`, the three operations with the `QuoteToken` parameter. Added the same day: `docs/05-quality/security/PR-pending-TASK-051-security-review.md` (security round 1, PASS_WITH_CONDITIONS; D-SECPR051-01), which routes PR051-SEC-01, PR051-SEC-03 and L-1 to principal-architect.

**Edited (docs only).** This file: dated notes in sections 2.3 to 2.7 and 6, and this section. ADR-0005 (amendment 15, items 37 to 39; dated pointers at items 32 to 35). data-model §3.2, §3.10, §4.3, §4.6 (C16), §4.7 and amendment rows A40 and A41. risks.md (R-ARCH-34, R-ARCH-35; version 1.28). DECISIONS.md.

**Deliberately not edited.** `plan-data.mjs` and the generated cards: the lines are in section 8.9. The story files, `api/**` and `gherkin-test-map.md` (tooling inputs). `threat-model.md`: SEC-TC-76 names `23503` for cases on the referencing side only, which stays true. No product code.

**Run here.** Two single-process Node probes on in-memory PGlite 0.4.3 (PostgreSQL 17.5), the first with `btree_gist`, in the session scratchpad. No Jest, no container, nothing in the TASK-051 worktree, nothing written to the repository. Results: sections 8.7 and 8.11.

**Not run here.** PostgreSQL 18. For 18 the evidence is lane B of the pull request: the run at `203d02eb` for sections 8.4 and 8.5, and the run at the fix head for the rest. A PGlite replay of section 2.7 answers `23503` for C2 and C6. That is the 17.5 answer and not a failure.

| # | Question of the review | Ruling | Gatekeeper check |
|---|---|---|---|
| 1 | D-TASK051-03: a foreign key that holds both owner columns | **Confirmed (D-ARCH-207).** It is a C16 (a) finding, nobody's sibling and never an exception. | no |
| 2 | R1-M1: an owner column that does not separate owners | **Confirmed, and both shapes are enforced (D-ARCH-208).** No third stated limit. The two indexes of U2 are `NULLS DISTINCT`. | yes: ADR-0005 amendment 15 item 38 |
| 3 | R1-m1: must a T2-O entry name its CHECK | **Yes (D-ARCH-209).** C16 verifies the kind of the key and the CHECK. | no |
| 4 | D-TASK051-06: `42501` for AT-US-080-06 | **Acknowledged (D-ARCH-210),** as the answer of the class block. The real tables answer through the standard-columns guard first. | no |
| 5 | L-1: C2 and C6 on PostgreSQL 18 | **Amended to `23001` (D-ARCH-211).** The keys stay `RESTRICT`. | yes: ADR-0005 amendment 15 item 37 |
| 6 | R1-m4: E1 and E2 name `23503` only | **Extended to `23001` (D-ARCH-212).** One response for both; the tripwire names three tokens. | yes: the same item 37 |
| + | D-TASK051-07 and merge condition 6: the route-side binding and the HTTP halves | **Agreed (D-ARCH-213).** The rule and its owners are in section 8.8. The pipeline seam for two of its three cases is not designed and is owed by me before TASK-091 is dispatched. | no (the seam ruling will need one) |
| S | Security round 1, PR051-SEC-03: the staff grant is checked on INSERT only | **Folded into this migration (D-ARCH-214).** The operator rule also applies to an UPDATE that makes the membership ACTIVE. Section 8.11. | yes: ADR-0005 amendment 15 item 39 |

### 8.1 A foreign key that holds both owner columns (question 1; D-TASK051-03; D-ARCH-207)

**Confirmed.** On a table with `guest_token_hash`, a foreign key whose referencing columns include both `org_id` and `guest_token_hash` is a C16 (a) finding.

- It is nobody's sibling: it is neither the org-bound nor the guest-bound member of a pair.
- No exception entry can name it (section 8.3: an entry is live for one kind of finding only).
- Why: the owner CHECK leaves one owner column NULL on every row. `MATCH SIMPLE` skips a key that has a NULL column, so the key is never checked: a row of organisation B naming A's parent, a guest row naming another guest's parent and a row naming an unknown id were all accepted (probe rows Q1a). `MATCH FULL` refuses every row, the owner's own included (Q1b). Neither form binds anything.
- The planted probe of R1-n1 is therefore required, not optional: `c16_g_both (org_id, guest_token_hash, parent_id) → c16_gparent (org_id, guest_token_hash, id)`, in `PLANTED_GUEST_REFERENCE_FINDINGS`. Its target key `(org_id, guest_token_hash, id)` is `NULLS DISTINCT` and is not an arm (b) finding.

### 8.2 An owner column counts only when it separates owners (question 2; R1-M1; D-ARCH-208; ADR-0005 amendment 15 item 38)

**Confirmed, and enforced for both shapes.** The exclusion-operator half does not become a stated limit.

**Rule, arm (b).** An owner column (`org_id`, or `guest_token_hash` where the table has it) counts when it is a key column and:

- **B1, unique index:** the column is `NOT NULL`, or the index is `NULLS DISTINCT` (`pg_index.indnullsnotdistinct` is false);
- **B2, exclusion constraint:** the operator at its key position (`pg_constraint.conexclop`) is the equality member of a btree operator family (`pg_amop`: access method `btree`, strategy 3), whatever access method the constraint itself uses.

A non-primary unique index or exclusion constraint in which no owner column counts is a finding, unless it is a listed exception.

- **Exceptions stay literal.** An entry of `TENANT_UNIQUE_EXCEPTIONS` is live only for an index with no owner column among its key columns at all. An index that holds an owner column which does not count is always a finding and cannot be excepted.
- **Fail closed, stated.** `UNIQUE NULLS NOT DISTINCT (org_id, guest_token_hash, …)` is reported, although under the owner CHECK it does separate owners (Q2e). It is the alternative D-ARCH-163 rejected, U2 asks for two indexes, and the rule stays one fact per column.
- **TENANT tables.** `org_id` is `NOT NULL` there, so `NULLS NOT DISTINCT` stays legal for an index that leads with it. It then concerns the other, nullable key columns only.
- **U2 as amended (section 2.4).** The two indexes of a uniqueness rule are `NULLS DISTINCT`, the default. One index over both owner columns is not an alternative: under `NULLS DISTINCT` it enforces nothing (Q2f), and under `NULLS NOT DISTINCT` it is reported.

**Why the exclusion half is enforced.**

- C16 (b) reads exclusion constraints since D-ARCH-163, to close PR293-SEC-03 (c). Reading them and accepting `org_id WITH <>` would pass the one constraint that conflicts only across owners: `23P01` when another organisation holds the value, `23503` for an unknown id (Q2d).
- `btree_gist` is installed by `prisma/bootstrap/01-schemas.sql`, so the shape is one statement away.
- The cost is one catalog fact.
- A btree exclusion constraint can only use `=`: the other btree operators are not commutative and `<>` is not a member of a btree family. The refused shape therefore needs gist, the planted probe uses gist, and a gist constraint with `=` is the control that shows the rule reads the operator and not the access method.

**Shape of the change (as the review asks).** The SQL returns the facts, the pure function decides, and `tenant-keys.test.ts` drives the function with fixtures. A sketch that returns them, run in the probe on 17.5 (the developer may shape it differently; the rule and the probes below are what binds):

```sql
SELECT x.relname::text AS index, t.relname::text AS "table",
       CASE WHEN i.indisexclusion THEN 'exclusion' ELSE 'unique' END AS kind,
       i.indnullsnotdistinct AS nulls_not_distinct,
       COALESCE((SELECT pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
                          'column', a.attname, 'not_null', a.attnotnull,
                          'equality', CASE WHEN i.indisexclusion THEN EXISTS (
                              SELECT 1 FROM pg_catalog.pg_amop ao JOIN pg_catalog.pg_am am ON am.oid = ao.amopmethod
                               WHERE ao.amopopr = c.conexclop[k.n] AND am.amname = 'btree' AND ao.amopstrategy = 3) END)
                        ORDER BY k.n)
                   FROM pg_catalog.unnest(i.indkey::int2[]) WITH ORDINALITY AS k(attnum, n)
                   JOIN pg_catalog.pg_attribute a ON a.attrelid = t.oid AND a.attnum = k.attnum AND NOT a.attisdropped
                  WHERE k.n <= i.indnkeyatts AND a.attname IN ('org_id', 'guest_token_hash')), '[]'::jsonb) AS owner_columns
  FROM pg_catalog.pg_index i
  JOIN pg_catalog.pg_class x ON x.oid = i.indexrelid
  JOIN pg_catalog.pg_class t ON t.oid = i.indrelid
  LEFT JOIN pg_catalog.pg_constraint c ON c.conindid = i.indexrelid AND c.contype = 'x'
 WHERE (i.indisunique OR i.indisexclusion) AND NOT i.indisprimary
   AND t.relnamespace = 'public'::regnamespace AND t.relname = ANY ($1::text[]);
```

**Planted probes, added to those of section 2.6.**

| Where | Statement | Expected |
|---|---|---|
| `c16_gparent` | `UNIQUE NULLS NOT DISTINCT (guest_token_hash, code)` | reported |
| `c16_gparent` | `UNIQUE NULLS NOT DISTINCT (org_id, code)` | reported |
| `c16_gparent` | `EXCLUDE USING gist (org_id WITH <>, code WITH =)` | reported |
| `c16_gparent` | `EXCLUDE USING gist (org_id WITH =, code WITH =)` | not reported |
| `c16_parent` (`org_id NOT NULL`) | `UNIQUE NULLS NOT DISTINCT (org_id, code)` | not reported |
| `c16_parent` (`org_id NOT NULL`) | `EXCLUDE USING gist (org_id WITH <>, code WITH =)` | reported: `NOT NULL` does not rescue an operator that is not equality (security record PR051-SEC-01) |

Fixture rows of the host unit test: each row above; `UNIQUE NULLS NOT DISTINCT` over both owner columns (reported); an exception entry that names an index whose owner column does not count (the index is reported and the entry is reported as not live). The header of `tenant-keys.ts` describes arm (b) accordingly and keeps its two stated limits.

No committed index has either shape (`prisma/migrations` at `203d02eb` and on main holds no `NULLS NOT DISTINCT` and no `EXCLUDE`), so the change adds no committed finding.

### 8.3 A T2-O entry names its CHECK (question 3; R1-m1; D-ARCH-209)

**Yes.** An entry of `TENANT_REFERENCE_EXCEPTIONS` names the key, the CHECK that justifies it, and the reason.

- **Kind.** An entry applies only to a key that arm (a) reports as org-bound without a guest-bound sibling, on a table with `guest_token_hash`, whose referencing columns are `org_id` and exactly one other column `<c>`. A key reported for any other reason (a single-column key, a key that is not owner-bound, a key with both owner columns, a guest-bound key alone) is reported whatever the map says, and an entry that names it is itself a finding.
- **CHECK.** C16 reads the named constraint on the referencing table and requires `contype = 'c'`, `convalidated`, and a definition equal to that of the T2-O predicate for `<c>`. `pg_get_constraintdef` prints it as `CHECK (((<c> IS NULL) OR (org_id IS NOT NULL)))` on 17.5 (Q3).
  - The predicate is the rule. The pinned text is what PostgreSQL 18 prints for it: if lane B shows another spelling, the developer pins the 18 text and says so in the commit. That is not a differing observation in the sense of section 2.7 and needs no new ruling.
  - A `NOT VALID` constraint has `convalidated` false and a longer definition. A `NOT ENFORCED` constraint of PostgreSQL 18 fails the same two tests.
- **A failed entry hides nothing.** When the CHECK is missing, not validated or of another form, the key is reported and the entry is reported.
- **Why the text and not the columns.** `CHECK (<c> IS NULL OR org_id IS NULL)` names the same two columns and admits exactly the guest row that T2-O forbids (Q3). A test on the columns passes it.
- **Why the name is not derived.** The first instance is `fk_quotes__requote_of_quote_id` with `ck_quotes__requote_org_only`. Neither name follows from the other.
- **Tests,** on the planted `c16_g_org_only`, with the map passed in by the test:
  1. an entry that names the key and `c16_g_org_only_check`: the key is not reported and the entry is live;
  2. the CHECK dropped: the key is reported and the entry is not live;
  3. the CHECK replaced by `CHECK (parent_id IS NULL OR org_id IS NULL)`, and the CHECK added `NOT VALID`: the key is reported in both;
  4. an entry that names the single-column key `c16_g_single_parent`: the key is still reported and the entry is not live.
- The committed map stays empty until TASK-087 adds `fk_quotes__requote_of_quote_id` with `ck_quotes__requote_org_only`.
- **Owner:** TASK-051, in this fix cycle. C16 is the gate of TASK-087, and the first entry arrives there.

### 8.4 `42501` for the claim in a context without an organisation (question 4; D-TASK051-06; D-ARCH-210)

**Acknowledged.** The guest `USING` admits the row, and neither `WITH CHECK` admits a row whose `org_id` is set while `app.org_id` is empty. Confirmed on 17.5 (the review's replay; Q4a) and on 18 (lane B at `203d02eb`: AT-US-080-06 passed). The expectation of TASK-051 stands as written.

- **It is the answer of the class block.** The `gc_` probe tables carry the policies and the de-claim guard, and nothing else.
- **The real quote tables answer differently.** They also carry `trg_<t>__std_columns` (C15), a `BEFORE` trigger, and `BEFORE` triggers run before `WITH CHECK` (data-model §4.7). Without an actor the guard expects the anonymous actor in `updated_by`, and the claim writes the claiming user. On the real tables the same statement is therefore refused by the guard first, with `P0001 STD_COLUMNS_VIOLATION`; with the anonymous actor in `updated_by` it reaches `WITH CHECK` and gets `42501` (Q4b, reduced schema). Both are refusals with nothing changed. The line is on the TASK-146 card (section 8.9).
- **The route never reaches it.** `claimQuote` declares `bearerAuth` only, so its auth set is exactly `[session]`: a request without a bearer is answered 401 `AUTH_REQUIRED` by the authentication slot, before the tx slot opens a transaction. AT-US-080-06 is that 401. The database answer is the backstop behind it, and reaching it would be a defect that shows as 403 or 500, not as a clean 401.

### 8.5 A refused `RESTRICT` action is `23001` on PostgreSQL 18 (question 5; L-1; D-ARCH-211; ADR-0005 amendment 15 item 37)

**Fact.** PostgreSQL 18 reports a refused `RESTRICT` action with SQLSTATE `23001` (`restrict_violation`) and the message "update or delete on table … violates RESTRICT setting of foreign key constraint … on table …" (PostgreSQL commit 086c84b23, "Fix error code for referential action RESTRICT"). Up to 17 the code was `23503` (Q5). The check on the referencing side, a row that names a missing parent, is `23503` in every version. We met the change through lane B, not through the release notes.

| Side | Cases of section 2.7 | PostgreSQL 18 | 17.5 |
|---|---|---|---|
| Referenced side: a key of the quote changes while a row still names it | C2 (the quote first), C6 (the statement without `quote_shares`) | `23001` | `23503` |
| Referencing side: a row names a parent that is missing for its owner | G1 to G4, T1 to T3, S1, S2, R2, R3, C3, L2, L3 | `23503` | `23503` |

**Ruling.**

- Section 2.7: C2 is `23001 fk_quote_packages__guest_token_hash_quote_id` and C6 is `23001 fk_quote_shares__guest_token_hash_quote_id` on PostgreSQL 18. The constraint names are unchanged. Every other row of the table reproduced on 18 as written, the one-statement claim (C1) included.
- Section 2.3, data-model §4.3 and ADR-0005 amendment 14 item 32: a claim that leaves a child table out fails with `23001` on PostgreSQL 18, on the guest key of the table left out. A claim written as separate statements fails with `23001` when the quote is updated first and with `23503` when a child is updated first.
- The keys stay `ON DELETE RESTRICT ON UPDATE RESTRICT`. No migration changes.
- **The developer** changes the two expectations (and their titles) to `23001` and cites D-ARCH-211 in the commit, or in the squash commit of the superseding branch (D-ORCH-147). Nothing else in section 2.7 changes. C2 names the packages key because that key is created first; R1-n2 stays the developer's call.
- **TASK-146:** the claim repository handles neither code. Both are defects that `mapDbError` answers with 500 (section 8.6).

**Alternatives rejected.**

- **`NO ACTION` keys, to keep one SQLSTATE.** Every merged migration uses `RESTRICT` and an applied file is immutable. Nothing in the application branches on the code. `NO ACTION` also accepts the change of a referenced key when another row supplies that key (not run here).
- **An expectation that accepts either code.** Lane B runs PostgreSQL 18 only, and an either-or expectation would hide the next change of this kind.

### 8.6 One answer for a refused reference, both SQLSTATEs (question 6; R1-m4; D-ARCH-212; ADR-0005 amendment 15 item 37)

E1 and E2 of section 2.5 as extended:

- **E1.** A refused reference is SQLSTATE `23503` (`foreign_key_violation`) or `23001` (`restrict_violation`). `mapDbError` gives both the same response: 500 `INTERNAL_ERROR`, reason `DB_ERROR`, not retryable. The only variable parts of the mapping are `sqlState` and `prismaCode`. Both are for logs and metrics: the problem handler reads neither field, so the response body is the same for both codes. The mapper reads no constraint name, message or detail. The code at `203d02eb` does this already, because `23001` takes the same fall-through as `23503`: no product code changes.
- **E2.** No service, repository or module catalogue maps a refused reference to a client-visible answer by constraint name, field name, message or detail, and no file under `apps/` or `packages/` other than the mapper and its test names `P2003`, `23503` or `23001`.
- **Prisma.** `@prisma/adapter-pg` 7.10.1 maps `23503` to the kind `ForeignKeyConstraintViolation` and `23001` to `RestrictViolation`, and the client reports both as `P2003`. A raw query reports either under `P2010`. Both keep `cause.originalCode`. So `P2003` already covers a refused `RESTRICT` action of a model operation, and the SQLSTATE `23001` has to join the tripwire for raw queries.
- **Tests, TASK-051 fix cycle.**
  - The deep-equal test runs for `23503` and for `23001`, each under `P2010` and under `P2003`: four combinations, each with two constraint names that map deep-equal and carry no constraint text. One more assertion: under one Prisma code the mappings of the two SQLSTATEs differ in `sqlState` only.
  - The repository test looks for `P2003`, `23503` and `23001`, with a positive and a negative control for each. No file under `apps/` or `packages/` names `23001` at `203d02eb` or on main (`git grep -w`).
- R1-n4 (the tripwire is lexical) stays a stated limit in the file header, as the review left it.

### 8.7 Probe results (PGlite 0.4.3 = PostgreSQL 17.5; reduced schemas; each case in a savepoint of a rolled-back transaction)

| Row | Case | Result |
|---|---|---|
| Q1a | A key over `(org_id, guest_token_hash, parent_id)`, `MATCH SIMPLE`: a row of B naming A's parent; a guest row naming another guest's parent; a row naming an unknown id | ok; ok; ok |
| Q1b | The same key `MATCH FULL`: an organisation row and a guest row, each naming its own parent | `23503`; `23503` |
| Q2a | The ruled indexes: B names A's quote with a `seq` A holds, then a free one; guest H1 names H2's quote likewise | `23503` on the organisation key, twice; `23503` on the guest key, twice |
| Q2b | The guest index recreated `NULLS NOT DISTINCT`: B names A's quote, held `seq`; free `seq` | `23505 ux_…__guest_quote_seq`; `23503` |
| Q2c | The organisation index recreated `NULLS NOT DISTINCT` and not partial: H1 names H2's quote, held `seq`; free `seq` | `23505 ux_…__org_quote_seq`; `23503` |
| Q2d | `EXCLUDE USING gist (org_id WITH <>, quote_id WITH =)`: B names A's quote; B names an unknown id | `23P01`; `23503` |
| Q2e | `UNIQUE NULLS NOT DISTINCT (org_id, guest_token_hash, code)`: B takes A's code; a guest takes it; A takes it twice | ok; ok; `23505` |
| Q2f | The same index `NULLS DISTINCT`: A takes a code twice | ok (it enforces nothing) |
| Q2g | The sketch of section 8.2 with rule B1/B2 over 16 planted shapes | no owner column, an INCLUDE column, `NULLS NOT DISTINCT` on a nullable owner column (one or both), and `<>` on the only owner column: finding. `NULLS DISTINCT` owner indexes, `NULLS NOT DISTINCT` on a `NOT NULL` owner column, `=` through btree and through gist, and `<>` on one owner column beside `=` on the other (a conflict then needs equal guest hashes, so it stays inside one owner): pass |
| Q3 | `pg_get_constraintdef` of the T2-O CHECK; of the same predicate `NOT VALID`; of `… OR (org_id IS NULL)` | `CHECK (((requote_of_quote_id IS NULL) OR (org_id IS NOT NULL)))`; the same text plus ` NOT VALID`, `convalidated` false; the same two columns, another text |
| Q4a | A context with the guest hash and no organisation, class block only: the claim | `42501` (`WITH CHECK`) |
| Q4b | The same with a `BEFORE` guard of the standard-columns kind: `updated_by` = the user; = the anonymous actor | `P0001 STD_COLUMNS_VIOLATION`; `42501` |
| Q5 | 17.5: a referenced key changed while a row names it; a referenced row deleted; a child moved before its parent | `23503` "update or delete on table … violates foreign key constraint …", twice; `23503` "insert or update on table …" |

### 8.8 The route-side guest binding and the HTTP halves of US-080 (D-TASK051-07; merge condition 6; D-ARCH-213)

**Agreed.** The rule goes on the TASK-091 and TASK-146 cards, with the HTTP halves.

**The rule.**

1. The transaction context carries a non-empty `guestTokenHash` in three cases, six operations in all:
   - **(a) guest read:** `getQuote` and `streamQuoteResults` for a guest principal. The hash is the one the quote-token authenticator derived (ADR-0008 amendments 4 to 6).
   - **(b) guest create:** `createQuote` for an anonymous caller. The hash is that of the token minted for this request, because the insert of the guest row has to pass the guest `WITH CHECK`.
   - **(c) claim:** `claimQuote`, `saveQuote` and `createShipment`, the three operations that declare the `QuoteToken` companion header (D-ARCH-113), for a session principal that presents a well-formed token. The hash is that of the presented value, beside the organisation and the actor of the principal.
2. Every other request binds the empty string, whatever headers arrive. A session caller on `getQuote` or `streamQuoteResults` binds the empty string as well: the bearer decides alone.
3. The hash is always derived server-side by `guestTokenHash()` (ADR-0005 amendment 10 item 8) and is put into the context by the pipeline, from the route descriptor. No handler, service or repository supplies it.
4. **Test:** over the mounted route table, a request that presents a well-formed `X-Quote-Token` is given a recorded context whose `guestTokenHash` is the empty string on every operation other than the six above.

**What exists, and what is owed.**

- `tenantContextOf` copies the value of the principal, and no authenticator sets one yet. "Every other route binds the empty string" therefore holds today, and the database half is proven by TASK-051 (the empty binding reads and writes no guest row under any context).
- Case (a) is designed and is TASK-091's.
- Cases (b) and (c) have no seam: nothing puts a minted or a presented token into the context of an anonymous or a session principal. That is a pipeline change under `apps/api/src/platform/**`, outside the `mod-quotes` lock, and it is not designed.
- **Owed by principal-architect before TASK-091 is dispatched:** the seam, as a note on the route descriptor of ADR-0003, with security-analyst, because case (c) puts a value derived from a header into the context of an authenticated caller. That ruling also reconciles the TASK-091 card sentence "the handler compares the SHA-256 of the presented value with the stored guest_token hash": under RLS the claim context sees the row only when the hash matches, so the policy is the comparison.

**HTTP halves.**

| Scenario | Database half | HTTP half |
|---|---|---|
| AT-US-080-01 Token access | TASK-051 | TASK-091: `getQuote` with the guest token returns the quote |
| AT-US-080-02 Crafted IDs and wrong tokens | TASK-051 | TASK-091: another guest's token, a guessed token, a bearer of another organisation and the id alone answer 404 `NOT_FOUND` |
| AT-US-080-03 Null `org_id` only on flagged tables | TASK-051 (with R1-m3) | none: a database property |
| AT-US-080-04 Atomic claim | TASK-051 | TASK-146: after `claimQuote` the organisation reads the quote and `getQuote` with the token answers 404 |
| AT-US-080-05 Claim twice | TASK-051 | TASK-146: 409 `QUOTE_ALREADY_CLAIMED` |
| AT-US-080-06 Unauthenticated claim | TASK-051 (backstop, section 8.4) | TASK-146: 401 `AUTH_REQUIRED`, and no transaction is opened |
| AT-US-080-07 Audit | TASK-051 (`RETURNING old.org_id, new.org_id`) | TASK-146: the `UPDATE` entry of the claim, in the claim transaction |

US-080 is marked complete on TASK-051 in the task map. Whether it stays open until TASK-146 is a delivery split for product-manager and senior-developer, as D-PM-078 was for US-040. The suite column of the gherkin map is qa-lead's (R1-n5).

### 8.9 Card lines for senior-developer's fold

Written without apostrophes, for `plan-data.mjs`.

| Task | Line |
|---|---|
| TASK-051 `guestclaim` (fix cycle) | "C16 (a) BOTH OWNER COLUMNS (D-TASK051-03; D-ARCH-207; rulings/wave-1-r-arch-34-operator-rulings.md section 8.1; data-model 4.6 C16 as amended 2026-11-21): a foreign key of a table with guest_token_hash that holds both owner columns is reported and is the sibling of no key; the planted probe c16_g_both (org_id, guest_token_hash, parent_id) -> c16_gparent (org_id, guest_token_hash, id) joins PLANTED_GUEST_REFERENCE_FINDINGS" |
| TASK-051 | "C16 (b) AN OWNER COLUMN SEPARATES OWNERS (R1-M1; D-ARCH-208; ADR-0005 amendment 15 item 38; rulings section 8.2): an owner column counts in a unique index only when it is NOT NULL or the index is NULLS DISTINCT (pg_index.indnullsnotdistinct false), and in an exclusion constraint only when its operator at that key position (pg_constraint.conexclop) is the equality member of a btree operator family (pg_amop, strategy 3); the SQL returns the facts and the pure function decides, driven by fixtures in tenant-keys.test.ts; an exception entry is live only for an index with no owner key column at all; planted on c16_gparent and reported: UNIQUE NULLS NOT DISTINCT (guest_token_hash, code), UNIQUE NULLS NOT DISTINCT (org_id, code), EXCLUDE USING gist (org_id WITH <>, code WITH =); planted on c16_parent and reported: EXCLUDE USING gist (org_id WITH <>, code WITH =); planted and not reported: EXCLUDE USING gist (org_id WITH =, code WITH =) on c16_gparent and UNIQUE NULLS NOT DISTINCT (org_id, code) on c16_parent; fixture: UNIQUE NULLS NOT DISTINCT over both owner columns is reported; the header describes arm (b) accordingly and keeps its two stated limits" |
| TASK-051 | "C16 (a) T2-O ENTRY (R1-m1; D-ARCH-209; rulings section 8.3): an entry of TENANT_REFERENCE_EXCEPTIONS names the key, its CHECK and the reason; it is live only for a key reported as org-bound without a guest-bound sibling whose referencing columns are org_id and one other column c, and only while the named constraint on the referencing table is a validated CHECK whose pg_get_constraintdef equals CHECK (((c IS NULL) OR (org_id IS NOT NULL))); otherwise the key is reported and the entry is reported; tests on the planted c16_g_org_only with a map passed in by the test: the entry with its CHECK hides the key and is live; the CHECK dropped, the CHECK with the predicate c IS NULL OR org_id IS NULL and the CHECK NOT VALID each report the key; an entry naming the single-column key c16_g_single_parent hides nothing; the committed map stays empty" |
| TASK-051 | "POSTGRESQL 18 ANSWER OF C2 AND C6 (L-1; D-ARCH-211; ADR-0005 amendment 15 item 37; rulings section 2.7 as amended 2026-11-21): guest-claim.int.test.ts expects 23001 fk_gc_quote_packages__guest_token_hash_quote_id for C2 and 23001 fk_gc_quote_shares__guest_token_hash_quote_id for C6 (a refused RESTRICT action is restrict_violation on PostgreSQL 18); C3 and every other case keep 23503; the titles and the header follow; the commit cites D-ARCH-211" |
| TASK-051 | "ONE ANSWER, BOTH SQLSTATES (R1-m4; D-ARCH-212; ADR-0005 amendment 15 item 37; rulings section 8.6): the deep-equal test of map-db-error.test.ts runs for 23503 and for 23001, each under P2010 and under P2003 (Prisma 7.10.1 reports both SQLSTATEs of a model operation as P2003), and asserts that under one Prisma code the two mappings differ in sqlState only; refused-reference-answer.test.ts looks for P2003, 23503 and 23001 with a positive and a negative control for each; no product code changes" |
| TASK-051 | "AT-US-080-06 DATABASE HALF (D-TASK051-06; D-ARCH-210): 42501 is acknowledged as the answer of the class block on the gc_ probe tables; the expectation does not change" |
| TASK-051 | "OPERATOR RULE ON UPDATE (PR051-SEC-03; D-ARCH-214; ADR-0005 amendment 15 item 39; rulings section 3.4 as amended 2026-11-21): the CREATE OR REPLACE of platform.memberships_lifecycle_guard in the operator staff grants migration gains the UPDATE clause exactly as given there (a membership of an OPERATOR organisation that becomes ACTIVE needs a staff grant) and the amended comment above the function; down.sql is unchanged; case O7: a SUSPENDED operator membership whose grant the migrator has deleted is refused ACTIVE with P0001 MEMBERSHIP_LIFECYCLE_VIOLATION: an operator membership needs a staff grant and its member still sees one organisation with the OPERATOR scope, the same update succeeds once the grant is back, and SUSPENDED to ACTIVE in a BUSINESS_CUSTOMER organisation needs no grant; mutant by hand: with the UPDATE clause removed O7 becomes ok" |
| TASK-087 `quote` | Add: "UNIQUE KEYS ARE NULLS DISTINCT (D-ARCH-208; ADR-0005 amendment 15 item 38; data-model 4.7 U2 as amended 2026-11-21): the two indexes of a uniqueness rule are created with the default NULLS DISTINCT, never NULLS NOT DISTINCT and never as one index over both owner columns (C16 (b) reports both); the entry fk_quotes__requote_of_quote_id of TENANT_REFERENCE_EXCEPTIONS names its CHECK ck_quotes__requote_org_only, which C16 verifies (D-ARCH-209)" |
| TASK-091 `guestquote` | Add: "DISPATCH GATE (D-ARCH-213; rulings section 8.8): principal-architect rules the pipeline seam that puts a guest token hash into the transaction context for createQuote by an anonymous caller and for the claim operations (a note on the route descriptor of ADR-0003, with security-analyst) before this task is dispatched" |
| TASK-091 | Add: "GUEST BINDING, ROUTE SIDE (D-TASK051-07; D-ARCH-213; SEC-TC-81; ADR-0005 amendment 10 items 8 and 11; data-model 4.3): the transaction context carries a non-empty guestTokenHash only on getQuote and streamQuoteResults for a guest principal (the hash the quote-token authenticator derived), on createQuote for an anonymous caller (the hash of the token minted for this request) and on the claim operations of TASK-146; a session caller on getQuote or streamQuoteResults binds the empty string; the hash is derived server-side by guestTokenHash and no handler, service or repository supplies it; api test over the mounted route table: on every operation other than getQuote, streamQuoteResults, createQuote, claimQuote, saveQuote and createShipment a request that presents a well-formed X-Quote-Token is given a recorded context whose guestTokenHash is the empty string" |
| TASK-091 | Add: "US-080 HTTP HALVES (D-ARCH-213; the database halves are on TASK-051): [AT-US-080-01] getQuote with the guest token returns the quote; [AT-US-080-02] the token of another guest, a guessed token, a bearer of another organisation and the quote id alone answer 404 NOT_FOUND" |
| TASK-146 `claim` | Replace the D-ARCH-162 line: "The claim is the ONE statement of data-model 4.3 as amended 2026-11-19 and 2026-11-21 (D-ARCH-162, D-ARCH-211): a claim written as separate statements is refused by design, with 23001 when the quote is updated first and with 23503 when a child is updated first (PostgreSQL 18); the claim repository handles neither code, both are defects that mapDbError answers with 500 (D-ARCH-212), and its outer count goes through expectAffected(result, 1)" |
| TASK-146 | Add: "CLAIM CONTEXT (D-TASK051-07; D-ARCH-213; SEC-TC-81): claimQuote and the implicit claim of createShipment run with the organisation and the actor of the session principal and with guestTokenHash = guestTokenHash(X-Quote-Token), bound by the pipeline seam ruled for TASK-091; without a well-formed token the context binds the empty string and the claim touches 0 rows (the service re-reads: 200, 409 or 404)" |
| TASK-146 | Add: "US-080 HTTP HALVES (D-ARCH-213; D-ARCH-210): [AT-US-080-04] after claimQuote the organisation reads the quote and its children and getQuote with the token answers 404; [AT-US-080-05] a claim by a second account answers 409 QUOTE_ALREADY_CLAIMED; [AT-US-080-06] claimQuote without a bearer answers 401 AUTH_REQUIRED and the transaction runner records no transaction; database backstop on the real tables: the claim statement in a context with the guest hash and no organisation is refused by the standard-columns guard (P0001 STD_COLUMNS_VIOLATION, a BEFORE trigger) before WITH CHECK, where the TASK-051 probe tables answer 42501; [AT-US-080-07] the claim writes one UPDATE audit entry of the quote with old org_id null and new org_id set, in the claim transaction" |
| TASK-234 save | Add: "saveQuote claims a guest quote through the claim repository of TASK-146 (the one statement) in the claim context of D-ARCH-213; it writes no claim statement of its own" |
| TASK-237 share | In the D-ARCH-162 line, replace the last clause by: "the claim statement gains the quote_shares update in this PR, with a test that a claim leaving a share behind fails with 23001 fk_quote_shares__guest_token_hash_quote_id on PostgreSQL 18 (D-ARCH-211)" |

### 8.10 Verification and open items

1. **quality-gatekeeper** verifies ADR-0005 amendment 15 (items 37 to 39) before TASK-051 merges (CLAUDE.md §5). Questions 1, 3 and 4 change no ADR text and need no check.
2. **security-analyst:** round 1 landed while this was written (D-SECPR051-01, PASS_WITH_CONDITIONS). Its PR051-SEC-01 is section 8.2, its condition C2 is section 8.5, its condition C6 is section 8.8 (SEC-TC-81 is named on the card lines), and its PR051-SEC-03 is section 8.11. Its delta round on the fix head covers the amended function.
3. **Owed by principal-architect:** the pipeline seam of section 8.8, before TASK-091 is dispatched.
4. **product-manager and senior-developer:** whether US-080 stays open until TASK-146 (section 8.8).
5. **Observed, not changed.** data-model §3.12 and §6.3 give `ux_saga_steps__saga_step_shipment ON (saga_id, step, shipment_id) NULLS NOT DISTINCT` on a TENANT table: it has no owner column, so C16 (b) will report it when the saga tables are created. With `org_id` leading it passes, `NULLS NOT DISTINCT` included (rule B1: `org_id` is `NOT NULL`). The creating task meets the gate; the sketch is corrected then.

### 8.11 The operator rule also applies when a membership becomes ACTIVE by UPDATE (security round 1, PR051-SEC-03; D-ARCH-214; ADR-0005 amendment 15 item 39)

Added the same day, after the security record landed (D-SECPR051-01).

**Finding.** The guard checks the grant on INSERT only. A SUSPENDED membership of the operator organisation whose user has no grant can be set ACTIVE by any session in that organisation's context, and the member then reads every tenant (probe P4 of the security record; reproduced here on a reduced schema with the function as committed, row S3a).

**Ruling: folded into this migration.** The function replacement of section 3.4 gains one clause in its UPDATE branch: a membership of an OPERATOR organisation whose status becomes `ACTIVE` needs a grant for its user. The text of section 3.4 is amended in place and stays binding. `down.sql` does not change.

- **Why now and not with M2** (the record offered both, and prefers now):
  - the migration is not merged, so the clause costs four lines and one test. After the merge the file is immutable, and the same clause needs a second function replacement with its own `down.sql`;
  - it is the same kind of gap as PR65-SEC-04 (a), which this replacement already closes: a rule on INSERT that an UPDATE walks around;
  - the impact, if it is ever reached, is read access to every tenant;
  - with the clause, "a membership of an OPERATOR organisation needs a staff grant" holds for every way a membership becomes ACTIVE, and offboarding is safe with SUSPENDED as well as with REMOVED.
- **What stays open.** Deleting a grant does not change a membership. A member who is ACTIVE when the grant is deleted stays an operator until the membership is suspended or removed.
  - Until M2 only the migrator lane can delete a grant (`platform_app` holds `SELECT` only, C5). It suspends or removes the membership first.
  - The M2 amendment of section 3.3 item 4 ties the deletion to the membership in the database: it refuses the deletion while a membership that is not REMOVED exists, or it lets `app_is_operator()` read the grant. It is not complete without one of the two.
- **Tests.** Case O7 of section 3.4 item 7, and its mutant. The security-analyst decides whether O7 joins SEC-TC-79.
- **Run here** (PGlite 17.5; reduced schema: `organisations`, `memberships`, `operator_staff_grants`, a stub of `platform.app_actor_id()`, the trigger as migrated; the function text is that of the branch at `203d02eb` with the clause inserted, and the committed function is the negative control):

| Row | Case | Committed function | With the clause |
|---|---|---|---|
| S3a | Operator membership, no grant: `SUSPENDED → ACTIVE` | ok | `P0001 … an operator membership needs a staff grant` |
| S3b | Operator membership, grant present: `SUSPENDED → ACTIVE` | ok | ok |
| S3c | Customer membership, no grant: `SUSPENDED → ACTIVE` | ok | ok |
| S3d | Operator membership, no grant: `SUSPENDED → REMOVED`; an update that keeps `SUSPENDED` | ok; ok | ok; ok |
| S3e | `→ INVITED`; `org_id` changed | `P0001`, the unchanged rules | the same |
| S3f | Insert into the operator organisation without a grant; with one; into a customer organisation without one | `P0001`; ok; ok | the same |

- **Not run here:** the real schema with RLS, the migration linter on the amended file, PostgreSQL 18. On an UPDATE the organisation of the row is the organisation of the context, so the fail-closed half of the clause is as unreachable as it is on INSERT (code review R1-n6). Lane B at the fix head is the evidence.
