# Code review: PR #44, TASK-020 part 020-C (route I/O phases, T-83 lint residuals, defineRoute credential-header hardening, generated-client value importer narrowed), round 1

Reviewer: code-reviewer (principal engineer). Head reviewed: `9def3f5` (full SHA `9def3f594bae2f8e340e779ed14e1f7c722df088`, branch `feat/TASK-020-c-route-io-phases`). Diff base: `git diff origin/main...9def3f5` (merge base = the second parent of `9def3f5`, main `2634a76`). Since then `origin/main` has moved to `77f41df`: PR #40 merged as `74385a1`, which is **non-docs** (`tools/ci/**`, `package.json`, `.github/CODEOWNERS`), plus docs.

Rulings checked against the code:
- D-ARCH-106 (4)-(6), (8) and D-ARCH-108;
- D-ARCH-111 (a)-(h);
- D-ARCH-113 (1), (3), (4) (fold 6 §2 rows 1b/2/2b);
- D-ARCH-114 (fold 6 §2 row 3);
- D-ARCH-122/124 (fold 7);
- D-ORCH-067;
- ADR-0003 amendments 2026-11-13 and 2026-11-14;
- ADR-0008 am. 6;
- api/README §8 and §15;
- the WAVE-00 TASK-020 lines "PART 020-C ROUTE I/O PHASES", "T-83 RULE RESIDUALS", "DEFINE-ROUTE HARDENING", "GENERATED-CLIENT VALUE IMPORTER NARROWED" and "020-C/020-D SYSTEM-TABLE RAW-SQL OWNERSHIP".

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The phase order, the read-only load, the permit-free call, the afterCommit queue, the defineRoute refusals, the
  credential-header rule with its [session] companion, the R2-n1 arm and the D-ARCH-114 narrowing all match the rulings;
  lane A is green on the exact head with every step executed, and 22 of 28 mutants of the new logic are killed (6 survive, 2 of them equivalent).
  ONE MAJOR: the call "request deadline" is a signal only. The slot never enforces it, so a call (or stream) that ignores
  the signal hangs the request forever, contrary to the code's own claim that "an in-flight call cannot outlive the stop
  window" (probe: still pending after 2 s with a 50 ms deadline). Six MINORs (three are security flags) and eight NITs.
```

## 1. What I verified myself (and what I did not)

Method:
- the review worktree (read-only);
- a `git archive` extract of `9def3f5` in the scratchpad, with a `node_modules` junction to the worktree and the git-ignored `prisma/generated` copied in;
- Node 24, no Docker, no installs, no full suites.

The extract and its junction were removed afterwards. The worktree still has 748 entries in `node_modules`, and `git status` is clean.

| Check | Result |
|---|---|
| Targeted unit run: execute-phases, after-commit, define-route, credentials, test-lane-idle-timeout | 160 / 160 pass (4.3 s) |
| `tests/generated/route-metadata.test.ts` (securitySchemes parity, companion parity) | 45 / 45 pass. The parity is exact: derived ∪ {`x-reauth-proof`} must EQUAL the list, so a dropped or an extra name fails |
| `problem-handler.api.test.ts` (api project, extract) | 62 / 62 pass. **R2-n1 revert mutant killed** (1 failed) |
| Prettier `--check` on all changed `.ts`/`.mjs`/`.md` (run dirs excluded) | clean |
| Lane A run 43562788599 on `9def3f5` | `fast-lane` SUCCESS. Every step executed, none skipped: lint, porcelain, format, actionlint, typecheck, unit, base-ref lint fixtures, build. `scans` fails only at "Security-owned paths need a review record"; `ci-gate` fails for that reason alone |
| Lane B evidence `20261114T0516Z_e43ccff` | PASS: unit 4454, api 124, integration 266 (+1 skip), catalog 74, 0 failures. `route-phases.int.test.ts` 5/5 in the JUnit; the holding arm took 1.63 s against the 1 s idle bound. Coverage: `execute.ts` 98.7 % lines / 96.1 % branches, `after-commit.ts` 100/100, `define-route.ts` 99.7/95.6, `credentials.ts` 100/100. The delta `e43ccff..9def3f5` is `.claude/agent-memory/**`, `docs/**` and the run dirs only, and the head's lane A evidence step accepted it |
| Typecheck, build, integration | not re-run (light-commands brief; no Docker). Relied on lane A (typecheck, build) and lane B (integration) on the head and evidence SHA above |
| Behaviour probes over real `createApp` + loopback (extract, fake runner) | **P1** a `call` returning `new Promise(() => {})` with `callDeadlineMs: 50` is **still pending after 2 s**, and nothing was opened or sent (R1-M1). **P2** client disconnects during `load`: `call` starts with `signal.aborted = false`, still false 300 ms later, and the handler transaction opens and commits (R1-m1). **P3** a result with both `body` and `stream`: events `begin:rw, handler, commit, send` then 500, so the write committed before the refusal (R1-m2). **P4** a stream that throws after COMMIT: the client sees `terminated`, and `afterCommit` never runs (R1-n4) |
| Mutation of the phases, queue, wiring and define-route guards (28 mutants: 27 unit + 1 api, extract, each applied alone and restored) | **22 killed, 6 survived** (E9 and E11 equivalent). Details in section 1.1 |
| Joi false-positive battery through `extensionProblems` (16 shapes) | Clean: rename, when/ref, replace, `has`, object `assert`, `match('one')`, `external`, `alter`, and/or/nand/oxor/without, `valid(ref)`, `default(Joi.x)`, `unique`, schema-key pattern. **Reported:** `rename(regex, Joi.x(...))` (Template) and `Date` in `example()`/`meta()`. All of these fail closed at module load (R1-n3) |
| Lint probes through the real `eslint.config.mjs` (fixture mini-roots in the extract, `tools/lint/lint-fixtures.mjs`) | T-83: inline, string-keyed `'load'`, computed `['handler']`, `deps.queue?.add`, `deps['queue'].add` reported. **Silent:** handler/load supplied through a spread of a same-file const (Q1), a const bound to a conditional of two inline functions (Q2) (R1-m5), destructuring alias `const { queue: q } = deps` (Q3, R1-n8). D-ARCH-114: `createRequire(u)(G)`, literal `import(G)`, `const require = createRequire(u)` reported. **Silent:** `const r = createRequire(u); r(G)`, `import { createRequire as mk }; mk(u)(G)`, `nm.createRequire(u)(G)`, and the two-hop through `platform/db/tests/hop.ts`. `new PrismaClient()` loaded through `createRequire(u)(G)` is reported by `boundaries` only; `platform/prisma-client-construction` stays silent (R1-m6) |
| Unions (`git merge-tree`) | `9def3f5` with `origin/main`, `origin/pr42` (21be73d) and `origin/pr43` (772d433) are all text-clean. Section 5 |

### 1.1 Mutation results

| ID | Mutant | Result |
|---|---|---|
| E1 | `load` not read-only | killed (2) |
| E2 | `call` moved inside the handler transaction | killed (7) |
| E3 | `afterCommit` scheduled before `send` | killed |
| E4 / E5 | disconnect source / deadline source dropped from `AbortSignal.any` | killed / killed |
| E6 | AfterCommitNotWired check dropped | killed |
| E7 | body+stream accepted | killed |
| E8 | phase context not frozen | killed |
| E9 | `lifetime?.release()` dropped | **survived** (listener lives until `res` is collected; equivalent in effect) |
| E10 | `CALL_DEADLINE_MS` 20 000 → 200 000 | **survived** 175 tests (R1-n2) |
| E11 | `writableFinished` check dropped | **survived** (equivalent: `release()` removes the listener before `close`) |
| A1 | drain `while` → `if` | killed |
| A2 | work started synchronously | killed (3) |
| A3 | logger try/catch dropped | killed |
| A4 | `message: String(thrown)` added to the failure line | killed (2) |
| M1 | main.ts `await afterCommit.drain()` dropped | **survived** 175 (R1-m3) |
| M2 | main.ts `afterCommit` not passed to `createApp` | **survived** 175 (R1-m3) |
| P1 | app.ts queue not passed to `defaultPipelineSlots` | killed |
| D1 | companion = "contains session" | killed |
| D2 | case-sensitive compare | killed (4) |
| D3 | Joi dependency entries treated as leaves (not walked) | **survived** 108 (R1-n1) |
| D4 | non-plain nested object skipped | killed (3) |
| D5 | non-plain `$_terms` container walked | killed (3) |
| D6 | load without call accepted | killed |
| D7 | load/call on `none` accepted | killed (2) |
| D8 | Joi ref not a leaf | killed |
| D9 | dependency prototype undefined | killed |
| PH | R2-n1 arm reverted (api project) | killed |

The author's 15 + 15 mutants (PR body) were not re-run one by one. My set overlaps 11 of the 15 guard mutants, and they agree.

## 2. Findings

| ID | Sev | Where | Problem | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `apps/api/src/platform/tx/execute.ts:38-42` (JSDoc + `CALL_DEADLINE_MS`), `:188` (`await call(...)`), `:131-135` (`await stream.complete(...)`); D-TASK020-48 | **The request deadline is never enforced by the slot.** `call` and `stream.complete` are awaited bare; the 20 s deadline and the disconnect only abort a signal. A call that does not pass the signal on, or awaits anything that ignores it, keeps the request, its socket and its closure alive indefinitely (P1: still pending after 2 s with a 50 ms deadline). `load` and `handler` are bounded by the transaction timeout, so `call` is the one phase with no bound at all. That is the reverse of what the code says: "Below the 25 s shutdown drain ... so an in-flight call cannot outlive the stop window". It also breaks the property ADR-0013 item 7 relies on: `server.close()` waits for that connection, the drain hits 25 s and the process exits 1 on every deploy that meets one stuck call. There is a second effect. A call that does honour the signal with `signal.throwIfAborted()` rethrows the `AbortSignal.timeout` reason, a DOMException `TimeoutError`, which no classifier maps, so the client gets a 500 instead of a retryable 503. ADR-0003's table promises only that "`ctx.signal` aborts", so this is not an AC breach in the letter. It is a correctness gap in the slot's own stated guarantee, and the hard stop before TASK-044 (streams over carrier calls) is the right time to close it. Same class as the PR #3 "timeout passed but not enforced" finding | (a) Race `call(...)` and `stream.complete(...)` against the signal (`abortable(promise, signal)` rejects with `signal.reason` on abort), so the slot answers at the deadline and never opens the handler transaction after an abort. (b) Build the deadline as an `AbortController` aborted by an unref'd `setTimeout` with an `AppError('SERVICE_UNAVAILABLE')` reason, like the disconnect reason, so a rethrown reason maps to 503 + `Retry-After`. (c) Tests: a never-settling `call` with `callDeadlineMs: 50` gives 503 within the bound and `events` has no `begin:rw`; a never-settling stream ends the response at the deadline; a `call` that rethrows `signal.reason` gives 503, not 500. **Alternative, if the architect rules the deadline advisory:** amend D-TASK020-48 and the JSDoc to say so, add an ADR-0011/TASK-113 line making every outbound client honour `ctx.signal`, and pin a lint or test for that. This becomes MINOR only with that ruling recorded |
| R1-m1 | MINOR (security flag) | `execute.ts:144-152, 209` (`requestSignal` created lazily inside `signal()`) | The `close` listener is registered only when `call` starts. A client that disconnects during `load` (or the authn/validate steps) has already fired `close`, so `call` gets a signal that never aborts on disconnect. The external call then runs in full and the write transaction commits for a client that is gone (P2). ADR-0003: "`ctx.signal` aborts ... on client disconnect" | Create the signal at slot entry, before `load`, or check `res.destroyed`/`req.socket.destroyed` when creating it and abort immediately. Optionally skip `call` when the signal is already aborted. Test: abort the fetch while `load` is held, then assert `call` sees `signal.aborted === true` (or never runs) and no `begin:rw` |
| R1-m2 | MINOR | `execute.ts:171-176` vs `:212-214` (D-TASK020-50) | The body/stream exclusivity is checked after `run()` returns, that is after COMMIT. A handler that returns both commits its write, then the client gets 500 and will retry, duplicating the effect, which is the exact G3 hazard the phases exist to prevent (P3: `begin:rw, handler, commit, send` → 500). The existing test asserts only `500` and `complete` not called | Validate the result shape inside `write()` before `audit(ctx, result)`, so the throw rolls the transaction back. Extend the test to assert `events` contains `rollback` and not `commit` |
| R1-m3 | MINOR | `apps/api/src/main.ts:36, 45, 75-81`; `apps/api/src/platform/runtime/entry-points.test.ts` | The production afterCommit wiring is unpinned. Dropping `afterCommit,` from the `createApp` call (createApp then builds its own queue, and main drains an always-empty one) or dropping `await afterCommit.drain()` survives all 175 tests (M1, M2). The after-commit tests drive `queue.drain()` directly, never main's composition. Also, if `server.close` rejects, `afterCommit.drain()` is skipped | Extend the existing source-text test in `entry-points.test.ts` (same `only()` helper): `afterCommit,` occurs once inside the `createApp({` call, and `await afterCommit.drain();` occurs once after `server.close(` inside `drain:`. Use `try { await close } finally { await afterCommit.drain() }` |
| R1-m4 | MINOR | `apps/api/src/platform/tx/after-commit.ts:34, 50-62`; `define-route.ts` `RouteAfterCommit` | The queue has no cap and the work gets no signal. Every request with `afterCommit` adds a promise to `inFlight`; work that hangs (an SMTP or fan-out start without a timeout) accumulates per request with no bound and no visibility until shutdown, where it can only be cut off by the 25 s bound (exit 1). The brief lists "cap" under the queue's semantics; ADR-0003's row says "in-process and best effort", which a bound fits | (a) A max-pending constant (for example 1 000, a code constant like `CALL_DEADLINE_MS`). Above it, do not start the work and log `api.after_commit_dropped` with the same label fields. (b) Pass an `AbortSignal` to `afterCommit`, aborted at drain start or after a per-work deadline, so well-behaved work stops cleanly inside the window. (c) Tests for both. If deferred, record a decision with an owner (TASK-044 or the first route that declares `afterCommit`) |
| R1-m5 | MINOR (security flag) | `tools/eslint-rules/no-external-calls-in-tenant-tx.mjs:478-500` (`collectPhase`), `:508-524` (`collectRoute`) | The rule's design is "follow it or report it" (D-ARCH-111 (a)/(b)), but two shapes are neither followed nor reported, and a fetch, queue or Valkey call in them passes. (Q1) Phases supplied by a spread, `defineRoute({ operationId, ...phases })` with `const phases = { load: async () => fetch(...), handler: async () => {...} }`: the spread only makes `transaction` unknown; the hidden handler and load are not walked. (Q2) `handler: pick` with `const pick = flag ? async () => { await fetch(...) } : ...`: the Identifier branch recurses only into a `CallExpression` initialiser, so a `ConditionalExpression` (or a `LogicalExpression`) initialiser is silently dropped, although an inline conditional is walked. Fetch is still caught by `outbound-http-via-client`; `deps.queue.add`, Valkey and S3 calls are not | (a) In `collectRoute`, resolve each `SpreadElement` argument through `routeSpec()`. If it is a same-file const literal, collect its `load`/`handler` like inline properties; otherwise, when no explicit `handler` follows the spread, report `routeSpec`. (b) In the Identifier branch, recurse `collectPhase(def.node.init, phase)` for every const initialiser except a member expression, which stays unreported by design. (c) Two fixtures (`bad-phase-spread.ts`, `bad-handler-const-conditional.ts`), with `negative-fixtures.test.ts` entries |
| R1-m6 | MINOR (security flag) | `tools/eslint-rules/module-sources.mjs:152-158` (`moduleSourceVisitor` sees only a bare `require('x')`); `eslint.config.mjs:399-401` (residual comment); D-TASK020-59 residual; D-ARCH-114 / fold 6 §2 row 3 premise | **The D-TASK020-59 residual is wider than stated, and the backstop the policy comment names does not exist.** The comment (and the D-ARCH-114 ruling text) says the dynamic forms "stay covered by platform/prisma-client-construction". They do not. `new PrismaClient()` loaded through `createRequire(u)('…/prisma/client')` is not reported by that rule, because `moduleSourceVisitor` never sees the load (the p8 probe gets the `boundaries` error only, from the direct-call selector). The var, alias and namespace forms (`const r = createRequire(u); r(G)`, `mk(u)(G)`, `nm.createRequire(u)(G)`) get **no** finding at all from the worker's `platform/db` (probes p1/p3/p7). The same visitor feeds `audit-writer-allowlist` and `node-path-only`, so `createRequire(u)('@platform/audit').createAuditWriter` passes the writer allow-list the same way. Card (h) says "module-sources.mjs resolves createRequire through import aliases and namespace members"; the PR applied it to `isRequireCall` but not to the visitor in the same file. CODEOWNERS (D-TASK020-43) remains the only control for owned paths; module code has none. This predates the PR, but the PR adds the false claim | Preferred in-PR (lint lock held, one function): `moduleSourceVisitor` takes `sourceCode` and its `CallExpression` arm uses `isRequireCall(node, sourceCode)`. Add one fixture per consumer: prisma-client-construction `createRequire(u)(G)` + `new PrismaClient()`; audit-writer-allowlist via an aliased createRequire. Correct the eslint.config.mjs comment either way. If routed: owner **020-D** (same file family, `lint` lock, already dispatched per D-ORCH-067) with a sheet line, plus a security-analyst note that PR38-SEC-02's residual is "CODEOWNERS only" until then |
| R1-n1 | NIT | `apps/api/src/platform/routing/define-route.test.ts:548`; `define-route.ts:409` (D-TASK020-56) | The test title says "(and walks the dependencies)", but nothing proves the walk: treating dependency entries as leaves survives 108 tests (D3) | Add a case: `Object.create(JOI_DEPENDENCY_PROTOTYPE)` (read the prototype as the code does) holding `{ schema: custom }` inside `$_terms.dependencies` must report EXTENSION |
| R1-n2 | NIT | `execute.ts:42` | `CALL_DEADLINE_MS < DRAIN_TIMEOUT_MS` is a stated invariant with no test (E10 survives) | One unit assertion importing both constants |
| R1-n3 | NIT | `define-route.ts:411-412` | The fail-closed report fires on legitimate author shapes: a Joi Template in `rename(regex, Joi.x(...))`, and a `Date` in `example()`/`meta()`. The message "Joi internals changed" sends the author the wrong way | Treat `Joi.isExpression(value)` as a leaf; name the constructor in the message (`… holds a Date …`). Fail closed either way |
| R1-n4 | NIT | `execute.ts:131-140, 216-221` (D-TASK020-50) | A stream that throws after COMMIT skips `afterCommit`, although the write committed (P4). Defensible, but not what ADR-0003's "runs after COMMIT" row says | Document it in the D-TASK020-50 / `completeStream` JSDoc, or schedule `afterCommit` in a `finally` once the transaction committed. TASK-044 decides |
| R1-n5 | NIT | `execute.ts:135` | The stream sink is `write: (chunk) => void res.write(chunk)`, which ignores backpressure; a slow SSE client buffers without bound | Route to TASK-044 (framing owner): `write` returns a promise that awaits `'drain'` when `res.write` returns false |
| R1-n6 | NIT | `apps/api/src/platform/tx/route-phases.int.test.ts:198-202` | The runtime-twin "fails" arm asserts only `status >= 500`. Any other failure of that route also passes, while the 25006 test right above it checks the cause in the logged lines | Assert the logged SQLSTATE `25P03` (idle-in-transaction termination) or the mapped reason |
| R1-n7 | NIT | `tools/repo/test-lane-idle-timeout.test.ts` (D-TASK020-53) | The ratchet selects suites by the text `createApp(`. A future shared API-lane app builder (tests/api helpers, TASK-033) that builds a real runner would be outside it. Fine for today: every suite that serves routes on a real runner is covered | When the builder lands, the ratchet keys on the builder too. Route to the API test app builder task |
| R1-n8 | NIT | `no-external-calls-in-tenant-tx.mjs` `isNamedDependencyCall` | `const { queue: q } = deps; q.add()` (destructuring rename) is not matched; card (d) asks only for the `const q = deps.queue` form | Optional: treat an `ObjectPattern` property whose key is a `names` entry like the const alias |

## 3. Deviation rulings (D-TASK020-47..61)

| Decision | Ruling |
|---|---|
| D-TASK020-47 read-only `load` (`SET TRANSACTION READ ONLY` after the context statement) | **Sound.** Switching to READ ONLY after a query is legal, and back to READ WRITE is not ("cannot set transaction read-write mode after any query"), so `load` cannot undo it through raw SQL or `set_config('transaction_read_only', …)`. Proven by the int test (25006, `on`/`off`). On the PR #42 union the statement stays inside the admission-wrapped `transaction()` closure (verified on the merge-tree text) |
| D-TASK020-48 `call` signal | The composition is right. Enforcement is R1-M1, and the lazy registration is R1-m1 |
| D-TASK020-49 afterCommit runner | Sound (setImmediate start, value-free failure line, drain loops over late work; A1-A4 killed). Wiring R1-m3; cap and signal R1-m4 |
| D-TASK020-50 stream hook | Acceptable as a hook for TASK-044; R1-m2, R1-n4, R1-n5 |
| D-TASK020-51 `RouteSpec<L, C>`, erased descriptor phases | **Sound.** `never` parameters are type-safe under `strictFunctionTypes`. Async `load` inference is exercised by the int test (`loaded.shipmentId`), and typecheck is green |
| D-TASK020-52 phase contexts | Sound; asserted per phase (E8 killed) |
| D-TASK020-53 lane constant instead of a lane env var | **Sound.** No API-lane suite reads config from the environment, and the ratchet has seeded defects plus a non-vacuity check. The PR #43 union really trips it (section 5). R1-n6, R1-n7 |
| D-TASK020-54 permit stand-in reason | Fine; switch on the PR #42 union |
| D-TASK020-55 "exactly `[session]`" = `'session'` or `['session']` | **Sound**: the sugar normalises to the same set, and every other set and every other credential header on `[session]` is refused (D1 killed) |
| D-TASK020-56 Joi dependency entries walked as a known container | **Accepted.** The finding (PR38-SEC-04) was about silently *skipping* containers. Walking an object whose prototype is captured from the default Joi root is the fail-closed equivalent: children would be seen, and a Joi upgrade that changes the class gives a prototype mismatch (reported) or undefined (reported; D9 killed). A forged prototype is author-only code, not a threat. Condition: pin the walk (R1-n1) |
| D-TASK020-57 D-ARCH-114 probes | Fine. The negative probe plus the in-memory positive probe at the real path are a good pattern |
| D-TASK020-58 `no-eval` scope | Fine (core `no-eval` reports `globalThis.eval` and indirect references too). `node:vm` is outside the ruling; noted for the security analyst |
| D-TASK020-59 lint interpretations (e)/(b)/(f), R4 on `fixtureRoute` | Interpretations accepted; they are broader than the card, not narrower. The residual is **not** accepted as stated: see R1-m6 (wider, and the named backstop does not cover it). "Next module-sources.mjs touch, or devops-engineer" is not an owner; 020-D is |
| D-TASK020-60 README/ADR edits | Fine; §15 and the ADR example match the code |
| D-TASK020-61 D-ARCH-124 to 020-D | Settled by D-ORCH-067 (orchestrator confirmed 020-D; TASK-020 complete for Wave-0 when 020-C merges). No finding |

## 4. Follow-up closure

| Item | Status |
|---|---|
| PR #38 code review R2-n1 (forged descriptor + credentials-read) | **Closed**: third arm as ruled, JSDoc true, forged-local test with control; revert mutant killed |
| PR38-SEC-03 (credential headers in `schema.headers`) | **Closed in code.** The refusal reads the same `describe().keys` that `validate.ts` `declaredHeaders` projects, so the refused set and the projected set cannot diverge (alternatives/whens add no projected keys, and `rename` cannot pull an undeclared header) |
| PR38-SEC-04 (`$_terms` container shape) | **Closed**, with the D-TASK020-56 interpretation; R1-n1 |
| PR38-SEC-02 / D-ARCH-114 (value importer narrowed) | **Static path closed**: worker and second-file fixtures fail; `generated.ts` and prisma/tests pass. The dynamic residual is R1-m6 |
| PR #32 R2-m3 / PR32-SEC-12 (T-83 residuals (a)-(h)) | Closed by fixtures per form, except the two silent shapes in R1-m5 |
| PR #38 R1-m5 (two-hop via a `tests/` helper) | **Still open** (security owner). Reproduced: `apps/worker/src/platform/db/tests/hop.ts` re-exports the generated client and a sibling file imports it with 0 findings |
| PR #32 R2-m4 (refresh cookie counted as presented) | Not in 020-C scope (TASK-052/055) |

## 5. Unions and sequencing hazards

- **PR #42 (TASK-025, fc1):** `git merge-tree 9def3f5 origin/pr42` is text-clean (tree `b6c2e46`).
  - `with-tenant-tx.ts` merges with `SET TRANSACTION READ ONLY` inside `transaction()`, which `admission.run(...)` wraps, so each phase takes and releases its own permit as ruled.
  - The new third parameter of `withTenantTx` survives the merge.
  - Whoever merges second switches the stand-in reason in `execute-phases.test.ts` to `TENANT_CONCURRENCY_LIMIT` (D-TASK020-54, D-ORCH-067).
  - `tenant-admission.int.test.ts` (15 000) does not compose `createApp`, so the ratchet ignores it (verified).
  - PR #42's new `audit-failure.api.test.ts` sets no idle key.
- **PR #43 (TASK-024):** text-clean (tree `2ad6d4f`). The ratchet hits `tests/generated/rls/cross-tenant.int.test.ts:398` (`DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000` inside a `createApp` suite), so `test-lane-idle-timeout.test.ts` goes red on the union. Whoever merges second:
  - imports `TEST_LANE_TX_IDLE_TIMEOUT_MS` there;
  - runs the suite on Docker to prove that no scenario holds a transaction idle for 1 s.
- **PR #39 (TASK-014):** the new `apps/api/src/platform/tx/tests/` helpers compile to `dist/**/tx/tests/`. PR #39's prune removes `tests/` directories, and its fc1 find adds `*/dist/*/tests/*` (D-ORCH-068), so they are covered. Confirm in the #39 r2 find assertion.
- **main:** `git merge-tree 9def3f5 origin/main` is clean. PR #40's merge brought non-docs files, so if the branch merges main before squash, lane-B evidence must be re-taken (D-ORCH-034).

## 6. Merge conditions

1. R1-M1 fixed with the tests listed, or the architect's "advisory deadline" ruling recorded (then MINOR).
2. R1-m1..m6 in-PR, preferred. Any that are routed need a named owner task and a sheet line: R1-m4 to TASK-044 or the first `afterCommit` route; R1-m6 to 020-D.
3. A security record `PR-0044-*` naming the final head, which turns the "Security-owned paths" step green.
4. Fresh lane-B evidence after any non-docs commit, or after a main merge carrying PR #40.
5. Lane A green on the exact final head with steps executed.
6. Squash.

Round 2 is a delta check:
- re-run P1/P2/P3;
- re-run mutants M1/M2/D3/E10;
- re-run the Q1/Q2 lint probes and the p1/p3/p7/p8 `createRequire` probes.

## 7. Good

- The phase ordering is tested with a real `createApp` over loopback and a fake runner that records `begin:ro`/`begin:rw`/`commit`/`rollback`/`send`. That one event list pins the whole ADR order, and the permit test has a **control** proving the cap is real.
- The repeat-safety test models the gateway's idempotency-key dedupe instead of asserting an internal flag.
- The `afterCommit` failure line is value-free by construction (four fields), and a test plants card numbers and e-mail addresses in the thrown messages.
- The credential-header refusal is single-sourced in `@platform/shared`, readers included, and pinned by an **exact** parity test against `securitySchemes` (it fails on extras as well as omissions).
- Companion parity replaces the blanket `PIPELINE_HEADERS` exclusion, which is stricter.
- The runtime twin is honest. The holding service is structurally typed precisely so that R2/R3/R6 cannot see it, and both arms run on PG 18 as `platform_app`.
- The D-ARCH-114 positive probe is linted in memory at the real path, so the probe file never shadows `generated.ts`.
