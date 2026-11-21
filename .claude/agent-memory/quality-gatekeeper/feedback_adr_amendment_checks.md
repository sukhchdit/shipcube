---
name: adr-amendment-verification-heuristics
description: Twelve checks that found real gaps when verifying an ADR amendment under CLAUDE.md §5 (D-QG-001 to D-QG-005); apply them to every later amendment verification
metadata:
  type: feedback
---

When verifying an ADR amendment, do these twelve checks beyond reading the amended ADR.

1. **Find the other Accepted text the amendment makes an exception to.** The architect adds dated pointers inside the ADR being amended, but a rule stated in a different ADR (or the threat model row, or the brief) is often left without one. D-QG-002: ADR-0004 am. 2 named a T-83 exception while ADR-0005 am. 11 item 17 ("binding", no queue call in a tenant transaction) had no note. D-QG-001: brief §3.2 and CLAUDE.md §2.
2. **Grep the code for universal claims** ("every advisory lock is transaction-level", "the only hatch", "no caller produces"). D-QG-002: `tools/db/bootstrap.ts` held a session-level lock the new key registry omitted.
3. **Ask what can run between a side effect and its commit.** If an enqueue happens inside a transaction, the job can run before the marking commit, so any later statement with a predicate on the marked column can match no row and return silently under READ COMMITTED.
4. **Look for a guarantee that moved a hop.** When a design replaces "relay enqueues on the target queue" with "relay enqueues on one queue, a dispatcher fans out", the at-least-once rule must be restated for the new hop, with a named repeater and a test.

5. **When a check moves later, ask what now runs before it.** D-QG-003: the `If-Match` comparison moved from a pipeline slot into the handler's conditional write, so on a route with a `call` phase the external call runs before the 412.
6. **Read the contract's own prose.** Count modes and operations from `openapi.yaml` with a script, and grep parameter and header descriptions for sentences the amendment contradicts (D-QG-003: `ReauthProofConditional` "always verified and consumed"; `Idempotent-Replayed` declared on 2xx only).
7. **Compare "Applied in" with `git show --stat`.** A decision entry can list files that sit modified and uncommitted in the shared checkout (D-QG-003: three story files of D-PM-079/081/082). Read requirements with `git show HEAD:<path>`, not from the working tree.
8. **Look for a later entry of the same day that argues the other way** (D-QG-003: a definer function rejected in D-ARCH-192 and adopted for sibling tables in D-ARCH-198).

9. **An answer to a condition is new Accepted text; verify it as a fresh amendment.** D-QG-004: the rule that closed QG-040-C2 ("the checkout never confirms an intent, with the Mock gateway as with Stripe") contradicted the `checkoutOrder` contract description and its `x-audit.additional` entry. Read the operation's description, response text, examples and vendor extensions for every operation a new rule names.

10. **Test a universal sentence against the designed tables too, not only the merged ones.** D-QG-005: "every foreign key of the Platform is RESTRICT" held for the 13 merged keys and failed on a designed key in data-model §3.11 (`ON UPDATE CASCADE`). Grep `data-model.md` for the opposite shape.
11. **When a rule tightens one arm of a catalog gate, ask the same question of the other arm, and of what the new database major version allows.** D-QG-005: item 38 made C16 (b) ask whether an owner column separates owners; C16 (a) still counted a foreign key without reading `conenforced`, and PostgreSQL 18 accepts `NOT ENFORCED` keys. Read the gate's SQL on the task branch by SHA.
12. **Read card-line parentheses as claims.** D-QG-005: "(C16 (b) reports both)" was true of one of the two shapes it covered. A card line is copied verbatim into `plan-data.mjs`.

Also check whether a story marked "completes" on the task keeps that status when a ruling moves scenario halves to later tasks (D-QG-005: US-080, M0 Must, HTTP halves moved to Wave 2 and Wave 5 with the split left open).

Also check whether the plan fold has happened before the verdict: card lines written in a D-ARCH entry are not on any card until senior-developer folds them, and a routing that says "no card names it yet" is an owner-less routing.

When closing conditions (D-QG-006), three more checks paid off:
- **Routings that land after the fold.** A security delta round written after the plan fold routes new items to cards (PR051-SEC-06 to TASK-298, the O7 tag "before G3"). Grep the plan for each finding id of the latest security and review records; an item on the card of the task that is about to merge has no owner afterwards.
- **A JUnit title is not the assertion.** Find the case in the JUnit, then read the `expect` line at the code head with `git show <sha>:<path>` (exact `toBe` against an either-or), and recompute the report hashes against `summary.json` (`git_sha`, `git_dirty`, image digest).
- **Which suite ran the case.** Compare the classname in the JUnit with the suite column of `gherkin-test-map.md`; a split story can read as covered in the trace on its database half alone (US-080).

To check a fold: extract the quoted card lines from the rulings table with a script, test each as a substring of `plan-data.mjs`, and run `gen.mjs .` (no `--write`) on a `git archive` of main that includes `docs/04-plan`, `docs/01-requirements` and `tools/ci`.

**Why:** These found five of the seven QG-043 conditions; none was visible from the amended ADR alone.
**How to apply:** Any D-QG verification, and G2-style architecture checks at later gates. Commit trailer: use the attribution line of the session's own system reminder; a dispatch may name a different model. Related: [[verify-all-n-ids-claims-by-diff]], [[shared-main-checkout-mechanics]].
