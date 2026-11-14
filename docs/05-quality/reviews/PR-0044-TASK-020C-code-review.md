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


---

# Round 2 (head d943ef7)

Reviewer: code-reviewer. This is a delta check. Head `d943ef7` (full `d943ef7f1a9b9fa7ec4f9219018f0311a8d25deb`); the code commit is `035687c`, and `d943ef7` adds only the evidence run directory. It covers:
- fix cycle 1: `a45f189` (api runtime), `45542bd` (lint), and the merges `71dbb4f` and `443c2f1`;
- fix cycle 2: `542a111` (start-api), the merge `a7caa87`, `3a21efc` (RLS lane timeout) and the merge `035687c`.

Inputs read: the PR comments for cycles 1 and 2, the PR body D-TASK020-62..77, D-ORCH-069 and D-ORCH-073 on main, evidence `20261114T0902Z_035687c`, and lane A run 43580008698.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R1-M1 is fixed and proven. A call that never settles, with a 50 ms deadline, answers 503 + Retry-After: 1 in
  157 ms and no write transaction ever opens, including for work abandoned after the deadline. All r1 MINORs and NITs
  in scope are closed, the r1 survivors M1/M2/D3/E10 are now killed, the cycle-2 entry point is executed by real tests
  with no exclusion anywhere, and all four merges are byte-identical to clean re-merges.
  No BLOCKER or MAJOR. Three new MINORs, routable:
  - the pre-slot disconnect guard is unpinned;
  - a template-literal `createRequire` key loads the generated client with zero findings;
  - the T-83 rule crashes ESLint on a module-level holder alias.
```

## R2.1 What I verified myself

Method:
- the PR worktree, read-only;
- a `git archive d943ef7` copy in the scratchpad, with a `node_modules` junction and the git-ignored `prisma/generated` copied in;
- Node 24, no Docker, no installs, no full suites.

The copy and its junction were removed afterwards. The worktree still has 748 `node_modules` entries, and `git status` shows only the pre-existing untracked FAIL run directory `20261114T0742Z_3b0dd72`, which I did not touch.

| Check | Result |
|---|---|
| Targeted unit run in the worktree: `platform/tx` (abortable, after-commit, execute-phases), start-api, main, entry-points, define-route, classify, test-lane-idle-timeout, shared catalogue | 10 suites, **224/224** pass (4.6 s) |
| Lane A run 43580008698 on `d943ef7` | `fast-lane` SUCCESS, with every step executed and none skipped. `scans` fails only at "Security-owned paths need a review record", and `ci-gate` fails only for that reason |
| Lane B evidence `20261114T0902Z_035687c` | PASS: api 124, catalog 102, integration 296 (1 skip), unit 4739 (2 skips). Merged coverage 98.83 % lines / 96.45 % branches. The run's "coverage merge: generated coverage run" case **passed**: that coverage-only run executes the `generated` project, `tests/generated/rls/cross-tenant.int.test.ts` included, so the D-TASK020-77 lane timeout ran green at `035687c` in the evidence itself, not only in the author's claim. `rls-cross-tenant` is still `planned` in the manifest |
| Coverage-policy scan of `e21b9dd..d943ef7` | No change to `jest.config.ts`, `tools/ci/diff-coverage.mjs`, `tools/quality/**` or any threshold. No `istanbul`/`c8`/`v8 ignore`, `coveragePathIgnorePatterns`, `collectCoverageFrom`, `coverageThreshold`, `eslint-disable`, `@ts-ignore`/`@ts-expect-error`, `.skip`/`.only`/`xit`/`it.todo` added. **D-ORCH-073 holds** |
| Typecheck, build, integration, format | Not re-run (light-commands brief, no Docker). I relied on lane A (typecheck, build, format, lint, unit on the exact head) and lane B (integration) |

### R2.1.1 Behaviour probes (loopback, real `createApp`, recording fake runner, my own harness file in the copy)

| Probe | Result |
|---|---|
| **P1** (r1 P1 re-run): `call` returns `new Promise(() => {})`, `callDeadlineMs: 50` | **503**, `Retry-After: 1`, `code: SERVICE_UNAVAILABLE`, 157 ms including listener start-up. Events: `call, send` only, with **no `begin:rw`** |
| P1b: a call that resolves at 150 ms with a 40 ms deadline (abandoned); a call that rejects at 100 ms with a 30 ms deadline | Both 503. After 400 ms more, still **no `begin:rw`** (the late resolution is ignored). `unhandledRejection` count 0 |
| **P2** (r1 P2 re-run): client aborts while `load` is held | Events `begin:ro, load, commit`. `call` never runs, no write transaction |
| **P3** (r1 P3 re-run): handler returns both `body` and `stream` | 500 with events `begin:rw, rollback, send`. The write is rolled back, with no commit before the 500 |
| P4: `call` 30 ms, then a stream that never settles, deadline 80 ms | The stream is terminated 112 ms after the request start. Call and stream share one deadline armed at `call` start (as documented) |
| P5: queue with `maxPending: 2`, `deadlineMs: 60`, two hung works plus a third | One `api.after_commit_dropped` line `{route, operation, correlation_id, max_pending}`, then two `api.after_commit_failed` lines with `error_class: AfterCommitDeadlineError`. `drain()` settles in 69 ms; `pending` is 0 |
| P6: `abortable` on an already-aborted signal, over work that rejects later | Rejects at once with the signal reason; the later rejection is consumed (0 unhandled) |
| **P7** (new): client aborts while an **earlier** pipeline slot is held (the etag slot position, i.e. before `executeSlot` runs) | Head: at slot entry `res.closed=true`, `call` skipped, no `begin:rw`. **With the `res.closed \|\| res.destroyed` pre-check removed:** `call aborted=false, begin:rw, handler, audit, commit`, which is the r1 defect for the authn/validate window. The guard works but no test pins it (R2-m1) |

D-TASK020-74 semantics (plain Node 24 scripts): a top-level-await rejection and `queueMicrotask(() => { throw e })` both exit 1, and both print the error when no handler is installed. With handlers installed, both reach the `uncaughtException` listener. The only difference is the `origin` argument: `unhandledRejection` for top-level await, `uncaughtException` now. So the logged line's `origin` field changes, and D-TASK020-74's "which is what the top-level-await entry did" is true except for that field (R2-n4).

### R2.1.2 Mutation spot-checks (copy, each applied alone and restored; tests: `platform/tx`, start-api, main, entry-points; plus define-route for the r1 set)

| Set | Result |
|---|---|
| **r1 survivors re-run** | **4/4 killed.** M1 (`await afterCommit.drain()` dropped from start-api: 3 failed). M2 (`afterCommit,` not passed to `createApp`: 3 failed). D3 (Joi dependency entries treated as leaves: 1 failed). E10 (`CALL_DEADLINE_MS` 20 000 → 200 000: 1 failed) |
| abortable.ts (X1-X5) | 4/5 killed: already-aborted branch, reason replaced, listener not removed, `clear` no-op. **X4 survives** (`timer.unref()` dropped; equivalent while the work is in flight, because `clear()` runs in `finally`) |
| execute.ts (E1-E11) | 7/11 killed: call not raced, `throwIfAborted` dropped, stream not raced, 503 without `retryAfterSeconds`, body+stream check disabled, afterCommit not in `finally`, stream given an unrelated signal. **Survivors:** E3 (pre-slot `res.closed \|\| res.destroyed` check dropped, which is behavioural, see P7 → R2-m1); E6 (`writableFinished` check dropped; equivalent because `release()` removes the listener first, as in r1 E11); E10 (`timer.unref()` dropped) and E11 (`clearTimeout` dropped in `release`), both timer hygiene (R2-n1) |
| after-commit.ts (A1-A6) | 5/6 killed: abandon-at-drain instead of deadline, drain-start abort dropped, cap `>=`→`>`, deadline not enforced, work signal without the stop signal. **A6 survives** (`bound.clear()` dropped; R2-n1) |
| start-api.ts / main.ts (S1-S12, M1-M2) | 11/14 killed: afterCommit not passed, drain out of `finally`, handlers on another emitter, `startup()` not awaited (killed by the source pin), unmapped error swallowed, `closeIdleConnections` dropped, `raiseStartupError` swallowing, no force-close, `exitProcess` remapped, `main.ts` swallowing, `main.ts` with `{}` overrides. **Survivors, all equivalent:** S5 (`once` → `on`; createShutdown ignores a second signal), S6 (the 78 exit through `exit` (flush) instead of bare `exitProcess`; the fake stdout flushes synchronously, and this is pre-existing behaviour), S11 (an extra unused queue) |

Total: 31 of 40 killed. Of the 9 survivors, 5 are equivalent (X4, E6, S5, S6, S11), 3 are timer hygiene (E10, E11, A6) and 1 is behavioural (E3).

### R2.1.3 Lint probes (my own mini-root `rules/zz-probe`, real `eslint.config.mjs` through `tools/lint/lint-fixtures.mjs`; single-file runs through the same overrides)

| Probe | Head result |
|---|---|
| **Q1** (r1): phases from a spread of a same-file const, holding queue calls in `load` and `handler` | Reported twice (load, handler) |
| **Q2** (r1): `handler: pick`, `const pick = flag ? async () => {…queue.add…} : …` | Reported |
| Q2b conditional of two same-file named consts; Q2c spread of `flag ? phasesB : phasesA`; Q2d `defineRoute(Object.assign(…))`; Q2f `as`-cast inline handler; Q2g method shorthand | Q2b, Q2f and Q2g reported. Q2c and Q2d get "receives a route spec the rule cannot read" (fail closed) |
| Q2e: a function-declaration handler that calls a same-file helper doing `deps.queue.add` | Silent: calls are not followed, which is outside the ruled scope (the runtime twin is the backstop) |
| **Q3** (r1, R1-n8) inside the handler: `const { queue: q } = deps; q.add()` | Reported |
| Q3b `const { add } = deps.queue; add()`; Q3c `const { queue: { add: enqueue } } = deps` | Silent: the callee is an Identifier, not a member call, so it is outside card (d) (R2-n3) |
| Q3d `globalThis.setTimeout` in a handler | Reported (PR44-SEC-04 source) |
| **Module-level alias** `const q = deps.queue;` (or `const { queue: q } = deps;`) used inside `withTenantTx`/a handler | **ESLint crashes:** `TypeError: Cannot read properties of null (reading 'type')` in `enclosingFunction`, which aborts the whole lint run (R2-m3). Same shape at main `e21b9dd`: no crash, silent. At r1 `9def3f5`: the plain alias crashed. Fix cycle 1 extends the crash to the destructuring form |
| Factory-scope alias `function createSvc(d) { const q = d.queue; return { run: (c) => withTenantTx(c, async () => q.add()) } }` | Silent. The alias is not in the same function, and ADR-0005 am. 11 item 22 (d) restricts matching to "one same-function `const` alias", so this is a residual by ruling. I note it because it is the usual DI factory shape (R2-n3) |
| **p1** `const r = createRequire(u); r('@platform/prisma/client')` in `apps/worker/src/platform/db` | `static-module-specifier` (loader) + `prisma-client-construction` |
| **p3** `import { createRequire as mk }; mk(u)(G)` (worker platform/db) | Both rules |
| **p7** `nm.createRequire(u)(G)` (worker platform/db) | Both rules |
| **p8** `createRequire(u)(G)` + `new PrismaClient()` in a module repository | `static-module-specifier` + `prisma-client-construction` ×2 (value load and `new`). **The r1 R1-m6 gap is closed** |
| Audit writer through an aliased createRequire (module service) | `static-module-specifier` + `audit-writer-allowlist` |
| `nm?.createRequire(u)?.(G)`; literal and template `import()` of the client; `new Module('x').require(G)`; `import(createRequire(u).resolve(G))` | All reported (by loader, prisma-client-construction or computed specifier) |
| `createRequire(import.meta.url).resolve('<literal>')` | Clean (positive control) |
| **p9** `nm[\`createRequire\`](import.meta.url)('@platform/prisma/client')` in `apps/worker/src/platform/db`; **p15** `const { [\`createRequire\`]: make } = nm; make(u)(G)` | **Zero findings from any rule** (R2-m2) |

### R2.1.4 Unions and delta conservation

- **Every merge on the branch since r1 is a clean re-merge.** `git merge-tree --write-tree P1 P2` versus the merge commit gives an empty `git diff --stat` for `71dbb4f`, `443c2f1`, `a7caa87` and `035687c`. No hand edits are hidden in any merge.
- **Delta conservation.** The file set of `e21b9dd..d943ef7` equals the r1 delta (`2634a76..9def3f5`) united with the files of the six first-parent non-merge commits (`b947c24`, `a45f189`, `45542bd`, `542a111`, `3a21efc`, `d943ef7`). Both set differences are empty.
- **main now:** `origin/main` = `48f50e0`. Its delta from `e21b9dd` is `docs/sdlc/{DECISIONS,STATUS}.md` and three `.claude/agent-memory/senior-developer/**` files. `merge-tree` is clean. Under the current staleness rule (`docs/**` only, PR #28 lesson), merging that main **would stale the evidence** because of the `.claude/**` files. Squash from this head, or re-take lane B evidence after any main merge.
- **PR #42 (head `d611fda`, fc2):** one textual conflict, `tools/lint/negative-fixtures.test.ts` (this PR's `[PR44-SEC-01 A05]` row against PR #42's R1-M1/PR42-SEC-06 rows). Keep both row sets (D-ORCH-075). `with-tenant-tx.ts`, `db/index.ts` and `eslint.config.mjs` auto-merge.
  - This PR adds no `Reflect.ownKeys(db)` pin. The `markRollbackOnly` pins are PR #42's own.
  - Whoever merges second switches the stand-in `TRANSACTION_UNAVAILABLE` in `execute-phases.test.ts` (`fakeRunner`) to `TENANT_CONCURRENCY_LIMIT`.
  - The per-phase permit stays as ruled: `readOnly` sits inside the admission-wrapped `transaction()` (r1 §5).
- **PR #39 (head `7dd3c64`):** conflicts in `apps/api/src/main.ts`, as expected. The `check-workflow-policy.{mjs,test.ts}` conflicts are PR #39 against main's PR #43, not this PR. If PR #39 merges second, its change moves into `start-api.ts` as `const services = await createOrExitOnConfigError(() => deps.createRuntimeServices(config, 'api', log, secrets), { log, exit });`. Then:
  - main.ts stays the two pinned statements;
  - the `[D-ARCH-104]` pin still finds `deps.createRuntimeServices(config, 'api', log, secrets)` once;
  - `start-api.test.ts` needs an exit-78 case for a `TenantTxConfigError` (exit after the flush, before startup/listen/signals), or the PR #40 diff-coverage gate fails on the new `start-api.ts` lines;
  - the worker's `main.ts` gets the D-ORCH-073 pattern if PR #39 changes it.

## R2.2 Round-1 findings: closure

| ID | Status | Evidence |
|---|---|---|
| R1-M1 (MAJOR) | **CLOSED** | P1/P1b; tests `[R1-M1]` (call, rethrown reason, stream); E1/E4/E5 and X2 killed. The deadline reason is an `AppError('SERVICE_UNAVAILABLE', { retryAfterSeconds: 1 })`. `classify.ts` keeps `Retry-After` only on a 503 AppError with an own integer data property in 1..3600, and never invokes a getter (tested) |
| R1-m1 | **CLOSED** for load; the pre-slot half works but is unpinned | P2, P7; E2 killed. E3 survives → R2-m1 |
| R1-m2 | **CLOSED** | P3 (`rollback`, no `commit`); E7 killed |
| R1-m3 | **CLOSED** | r1 M1/M2 killed; S1/S2 killed; `start-api.test` SIGTERM order (`server.close` before `afterCommit.aborted`) and failing-close case |
| R1-m4 | **CLOSED** | P5; A2-A5 killed. Cap 1 000, deadline 20 s, both pinned below `DRAIN_TIMEOUT_MS`; work gets `AbortSignal.any([stop, deadline])`. Composite budget note: R2-n2 |
| R1-m5 | **CLOSED** | Q1, Q2, Q2b-g |
| R1-m6 | **CLOSED** for every r1 form (p1/p3/p7/p8, audit writer) and the policy comment is now accurate for them. The template-literal key variant is new: R2-m2 |
| R1-n1 | CLOSED (D3 killed) |
| R1-n2 | CLOSED (E10 killed) |
| R1-n3 | CLOSED (`Joi.isExpression` leaf; the refusal names the class via own `constructor.name`, regex-bounded) |
| R1-n4 | CLOSED (afterCommit in `finally` once committed; E8 killed) |
| R1-n5 / R1-n6 / R1-n7 | Routed by D-ORCH-073 to TASK-044 / 020-D / TASK-033. Accepted |
| R1-n8 | CLOSED in the same function (Q3). The module-level form crashes (R2-m3) |

### Cycle-2 refactor (D-TASK020-73..77)

- **Composition (73):** `start-api.ts` matches the former `main.ts` line for line (diffed against `443c2f1:apps/api/src/main.ts`). The only changes are the `deps.*` seams, `return deps.exitProcess(...)` in place of `process.exit` (same bare exit) and the `SHUTDOWN_SIGNALS` constant. The URL depths are unchanged (`start-api.ts` sits beside `main.ts`), and the docs-path test checks that the file exists. `API_PROCESS` maps each seam to the real function: an identity test kills S12, and the `processEvents`/`stdout` identity is checked.
- **Thin caller (74):** pinned by an exact two-statement body test plus `main.test.ts` (no overrides; the rejection is handed on). The semantics are equivalent apart from the `origin` field (R2-n4).
- **Tests execute the code (75):** `start-api.test` runs the real `createRuntimeLog`, `exitAfterFlush`, `installProcessErrorHandlers`, `createAfterCommitQueue` and `createShutdown` against fake seams. Only `createApp`/`listen`, the services and the process are faked, and `createApp` itself is exercised by the loopback suites. The 25 s bound is asserted with fake timers at 24 999 / 25 000 ms. 15 + 2 cases, matching the claim.
- **Pins (76):** not weakened. Every r1 order assertion is kept, applied to `start-api.ts`. `NO_PRISMA` now also covers `main.ts`. The new afterCommit pin enforces created < `createApp({` < `afterCommit,` < end of call, and `server.close(` < `} finally {` < the single drain < `forceClose:`. A production override is impossible: `main.ts` takes no arguments (pinned) and `API_PROCESS` is identity-tested.
- **RLS lane timeout (77):** correct and necessary. The ratchet is satisfied by importing `TEST_LANE_TX_IDLE_TIMEOUT_MS` (exempting the suite would weaken D-ARCH-106 (6)), and the suite ran green in the evidence's generated coverage run (R2.1).

## R2.3 New findings

| ID | Sev | Where | Problem | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR (security flag, PR44-SEC-02 follow-up) | `apps/api/src/platform/tx/execute.ts:176` (`if (res.closed \|\| res.destroyed) onClose();`); `execute-phases.test.ts` | The pre-slot half of R1-m1 (a client gone during authn/validate/idempotency/etag, before `executeSlot` registers its listener) is implemented and works (P7), but **no test pins it**. Removing the check (E3) passes all 61 tests and restores the r1 behaviour for that window: `call` runs with `aborted=false` and the write commits for a client that is gone | One test: a pipeline whose `etag` slot is held while the client aborts, then released. Assert that `call` never runs and that `events` has no `begin:rw` (my P7 shape). Test-only. In-PR is cheapest; otherwise route it with R2-m2/m3 |
| R2-m2 | MINOR (security flag, PR44-SEC-01 residual) | `tools/eslint-rules/module-sources.mjs:94-99` (`isCreateRequire`: a computed member matches only a `Literal` key); `static-module-specifier.mjs:34-35` (`isCreateRequireKey`: same); `eslint.config.mjs:412-415` comment ("reports … in every form") | A **no-substitution template literal** key evades the whole PR44-SEC-01 confinement. `nm[\`createRequire\`](import.meta.url)('@platform/prisma/client')` and `const { [\`createRequire\`]: make } = nm; make(u)(G)` in `apps/worker/src/platform/db` get **zero findings from every rule** (p9, p15): no loader report, no `prisma-client-construction`, no boundaries. Both rules already treat such a literal as static for specifiers (`staticSpecifier`). The rule header lists "a computed member `m['create' + 'Require']`" as a residual, but a template literal without expressions is not computed in that sense, and the config comment claims every form. Insider-only code, so same class as R1-m6, and CODEOWNERS on the worker's `platform/db` remains | Use `staticSpecifier(property)` (already exported from the same file) for computed keys in `isCreateRequire` and `isCreateRequireKey`. Preferably fail closed instead: report any computed member access on a `node:module` binding or a `getBuiltinModule(...)` result whose key is not a static string other than `createRequire`. That also closes the documented `nm[k]` residual. Add one fixture per form (call, destructure) with negative-fixtures rows and a mutant. Owner: **020-D** (lint lock, same file family, PR44-SEC-05 already there) with a sheet line, unless security-analyst rates it above LOW, in which case in-PR |
| R2-m3 | MINOR | `tools/eslint-rules/no-external-calls-in-tenant-tx.mjs:244-250` (`enclosingFunction` loops `while (current !== undefined …)`; ESLint's `Program.parent` is `null`), reached from `isNamedDependencyCall` `:806-821` | A **module-level** const alias of a holder chain used inside a root (`const q = deps.queue;` or `const { queue: q } = deps;` at module scope, then `q.add()` in a handler or a `withTenantTx` callback) throws `TypeError: Cannot read properties of null (reading 'type')`. That aborts the entire `npm run lint` run with a stack trace instead of a finding. It fails closed (lint goes red) but is unhelpful, and the negative-fixtures harness would crash the same way. Introduced by this PR: main `e21b9dd` does not crash on any of these shapes, r1 crashed on the plain alias, and fc1's `isNamedKeyTarget` extends it to the destructuring form | `while (current !== undefined && current !== null && …)` and return `undefined` for module level. Add a fixture with both module-level forms and assert the ruled outcome: silent under "same-function" (ADR-0005 am. 11 item 22 (d)), or reported if the architect widens (d) to module-level consts, which are as followable as same-function ones. Owner: 020-D with R2-m2, or in-PR with R2-m1 |
| R2-n1 | NIT | `execute.ts:183,188`, `after-commit.ts:101`, `abortable.ts:31` | Timer hygiene is unpinned: dropping `clearTimeout` in `release()` (E11), `bound.clear()` (A6) or either `unref()` (E10, X4) passes every test. Not observable functionally, but a dropped `clearTimeout` keeps a 20 s closure over `res` and the request per request (about rps × 20 s live timers) | Optional: one fake-timer assertion (`jest.getTimerCount()` back to 0 after a request with `call`, and after a queue drain) |
| R2-n2 | NIT | `after-commit.ts:56-57` JSDoc; `execute.ts:43-49` JSDoc | Each deadline is pinned below `DRAIN_TIMEOUT_MS`, but a request in `call` at SIGTERM (up to 20 s; the request signal is not aborted at drain start) followed by its afterCommit work that ignores its signal (up to 20 s more) exceeds the 25 s drain. The drain bound still holds (force-close, exit 1), so nothing hangs; only the "clean exit" budget is not compositional | Document the composition in one line, or abort in-flight request signals at drain start (`createShutdown` hook). TASK-044 or the first afterCommit route |
| R2-n3 | NIT (security residual list) | `no-external-calls-in-tenant-tx.mjs` `isNamedDependencyCall` | These are silent, by the ruling's scope: destructured methods (`const { add } = deps.queue; add()`, nested `{ queue: { add: enqueue } }`), and a holder alias declared in an enclosing factory function (`createSvc(d) { const q = d.queue; … withTenantTx(… q.add()) }`), which is the common DI shape | For the security-analyst's T-83 residual row. If (d) is revisited, include the factory-scope alias and Identifier callees bound by destructuring from a `names` chain |
| R2-n4 | NIT | PR body D-TASK020-74; `start-api.ts:165-169` JSDoc | "which is what the top-level-await entry did" is true for the exit code, the handler and the single fatal line. The `origin` field of `process.uncaught_exception` changes from `unhandledRejection` (top-level await reaches `uncaughtException` with that origin on Node 24) to `uncaughtException` | Wording only. No change needed unless an alert keys on `origin` |

## R2.4 Merge conditions

1. A security delta record `PR-0044-*` naming `d943ef7`, or the final head, turns "Security-owned paths need a review record" green, and with it `scans` and `ci-gate`.
2. No non-docs commit after `035687c` without fresh lane-B evidence. Do **not** merge current main (`48f50e0`, which carries `.claude/agent-memory/**`) before the squash unless the evidence is re-taken. Squash from this head, or from a docs-only descendant.
3. Lane A green on the exact final head with every step executed.
4. R2-m1..m3: in-PR (R2-m1 is test-only; R2-m3 is a one-line guard plus a fixture; R2-m2 is two predicates plus fixtures; all three need fresh evidence) **or** routed with sheet lines to 020-D (lint lock, already queued with PR44-SEC-05) before 020-D merges and before any module or worker code lands that loads modules dynamically. R2-n1..n4 are optional.
5. SQUASH (title already linted by CI).
6. Second-merger steps: §R2.1.4 for PR #42 (keep both negative-fixtures row sets; `TENANT_CONCURRENCY_LIMIT` stand-in) and PR #39 (`createOrExitOnConfigError` inside `start-api.ts`, plus an exit-78 test case).

## R2.5 Good

- `abortable()` consumes the abandoned promise's later rejection, and the abort reason is itself the retryable 503. A call that rethrows `signal.reason` and a slot that stops waiting therefore give the same answer. The tests prove both separately.
- The body/stream check moved inside the transaction, and the test asserts `rollback` rather than only the status code.
- The entry-point refactor took the hard option (D-ORCH-073 (c)) without touching the gate. `start-api.test` drives the real shutdown sequence to the millisecond (24 999 / 25 000) with fake timers, and the identity test on `API_PROCESS` closes the "production gets different seams" gap.
- The afterCommit failure and drop lines stay value-free (four fields plus `max_pending`).
- The RLS union change took the stricter path (lane constant) over an exemption, and the evidence's coverage run proves it executed.
