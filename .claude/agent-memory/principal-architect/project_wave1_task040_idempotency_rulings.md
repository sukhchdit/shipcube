---
name: wave1-task040-idempotency-rulings
description: Context behind D-ARCH-191..195 and D-ARCH-200..204 (2026-11-20) — ADR-0014 amendments 5 to 16, ADR-0013 am. 6, ADR-0003 call-phase amendment, ADR-0012 am. 5, ADR-0018 am. 9, R-ARCH-39 on TASK-040 (idempotency keys): part 040-B, hourly worker purge with ledger claim, checks after the claim, what a call phase may do, lease rule, sealed envelope; what is owed and the lessons
metadata:
  type: project
---

Two rounds on TASK-040. Round 1: D-ARCH-191..195 on code review round 1 (commit `91ec18cf`). Round 2: D-ARCH-200..204 on the gatekeeper's D-QG-003, code review rounds 2 and 3, the security record D-SECPR040-01 and D-PM-083/084 (commit `1012fa6f`). The rules are in ADR-0014 amendments 5 to 16, ADR-0013 amendment 6, the ADR-0003 amendment of 2026-11-20 (rules (i) to (l)), ADR-0012 amendment 5, ADR-0018 amendment 9, data-model §3.5/§4.4/§6.2/§10.4/§10.5 (A37, A39), api/README §3/§5/§8, risks.md R-ARCH-39. Card lines and change lists are in the DECISIONS entries. This note keeps what those do not say. Related: [[wave1-task041-ratelimit-rulings]], [[wave1-task043-outbox-rulings]].

**Why the rulings went the way they did:**
- Reviewer and product-manager wrote that part 040-B gates "every unsafe route, TASK-049 first". The contract says otherwise: only `required`/`optional` modes are refused at mount (6 + 41 operations; 27 unsafe ones are `not-applicable`, every auth operation among them). senior-developer later derived 33 gated cards and found TASK-062 (`updateMe`, Wave 1), so part 040-B is on a Wave 1 path after all.
- The purge cadence "conflict" was not one; what was missing was the place (worker schedule, owner glob `apps/*/src/platform/idempotency/**`).
- m7 was a rule for two unbuilt tasks, not a pipeline redesign: nothing before the claim may read state the first execution changes or consume a single-use credential.
- The gatekeeper then found the hole in that rule: with the `If-Match` comparison in the handler, a `call` phase runs first. product-manager made "stale on arrival answers 412 before any external call" a requirement and left me the race. My answer is a limit, not a clean-up: a `call` makes only an effect that is right whatever happens to the write that follows (`read`, `inert`, `reachable`); anything else is a saga step after the commit. ADR-0014 already had that shape ("sync intent creation", cancellation saga); the misleading piece was my own route example in ADR-0003 with a carrier cancellation in a `call`.
- R2-n2 (claim lost after `call`): I leaned to a WARN line without an audit entry. security-analyst and product-manager (D-PM-084) had both ruled FAILED + WARN by the time I wrote; their reason (the one record of a possible second call) holds, so I ruled with them.
- Definer function for the purge: my first reason ("no RLS") contradicted D-ARCH-198 of the same day. The valid one: the API store deletes in normal operation, so the runtime role keeps DELETE anyway.
- Round 3 (D-ARCH-205, 206; commit `686dfc20`; gatekeeper D-QG-004, QG-040-C7): my rule (j) said the checkout never confirms "with the Mock gateway as with Stripe". The contract has the Mock authorise synchronously in four places and M0 is built on it (no browser step, no webhook route before Wave 6). I narrowed the rule instead of changing the contract: rule (j) is about effects outside the process; the Mock is an in-process simulator refused in production. Control: `capabilities().simulated` plus one assertion in the gateway contract suite for every other adapter. `deletePaymentMethod` has no `call` (a detach is right only if the delete commits; worker step after the commit).

**Still owed by me:**
- A rule for the Stripe adapter before TASK-167 is dispatched: Stripe (API v1) replays the saved answer of an idempotency key, 500 included, for at least 24 h, and refuses a repeated key with other parameters. A derived key that never changes repeats a gateway 500; the attempt number is read in `load` and nothing is written when `call` fails.
- Conditions may come back from quality-gatekeeper on amendments 10 to 16 and the ADR-0003 amendment; security-analyst confirms the reading of P-3 (ledger claim next to the purge DELETE) in the part 040-B round and the proof placement with TASK-187.
- The `<NAME>_NEXT` read-ahead form for key rotation is deferred to the M5 rotation runbook.
- The contract descriptions of D-ARCH-203 ride part 040-B; api-designer acknowledges.

**How to apply:**
- A card that mounts a `required`/`optional` operation gets PRECONDITION PART 040-B; an auth route card does not.
- A card whose route declares `call` gets the CALL CLASS line: a row in the pinned table of the route-metadata test and, for `inert`/`reachable`, a fault test. A hold, a capture, a refund, a carrier booking/cancellation/pickup or a message never sits in a `call`.
- A derived provider key covers every input of the request (the aggregate version included).
- A new purge is its own schedule on `housekeeping`, in the folder of the module that owns the table, and each batch takes the ledger claim (D-SECPR039-01 (ii), both halves).
- A second use of one configured key is an HKDF-derived key with its own label, added to the ADR-0018 row.

**Process lessons:**
1. Check the premise of a finding against the contract before defining who waits: "unsafe route" and "idempotent route" are different sets.
2. When I move a check to a later step, walk every phase between the old and the new place for effects that now precede it. I did not, and the gatekeeper found the `call` phase.
3. An example in an ADR is read as the design of the operation it names. Keep it true to that operation or say it is only a shape.
4. Three owners ruled while I was drafting (gatekeeper, security-analyst, product-manager twice). Before writing each ruling I re-read `git log` and the tail of DECISIONS.md; one of my answers changed because of it.
5. Several Edit calls to the same file in one tool block lost one edit silently (the project has a PostToolUse formatter hook). Send edits to one file one at a time, and grep for a marker of every edit before committing.
6. Other agents had requirement and plan files uncommitted throughout. `git commit --only -F msg -- <paths>` held exactly my files both times; with `git fetch` showing behind=0 a plain push is a fast-forward and no autostash is needed.
7. The orchestrator asked for a `Claude Opus 5.5` trailer; the harness attribution for this session is `Claude Fable 5.2`, and only the user can override it. I used the harness line and said so in the report.
8. The scratchpad is shared between sessions; use task-specific file names.
9. Verify provider behaviour in its documentation before writing a key rule (the Stripe idempotency page settled rule (k) and exposed the saved-500 question).
10. Before writing a rule about an operation, read that operation in `openapi.yaml` (description, response texts, `x-audit.additional`) and its story. I wrote "the contract decides" in one amendment and contradicted the contract in the next; the gatekeeper found four places.
11. The shared scratchpad lost my append script between two rounds. Keep helper scripts short enough to rewrite, and run the guarded append and the commit in one command.
