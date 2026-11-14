# PR-0044 / TASK-020 part 020-C: route I/O phases, credential-header hardening, T-83 lint residuals and the narrowed generated-client value importer (round 1)

| Field | Value |
|---|---|
| PR | #44 `feat(api): route I/O phases and credential-header hardening in defineRoute (TASK-020)`, https://github.com/sukhchdit/shipcube/pull/44, branch `feat/TASK-020-c-route-io-phases`. Three feature commits (`680e458` lint D-ARCH-114, `5164385` lint T-83 R4 and residuals, `a2e13f9` api phases and credential headers), two evidence commits (`6cb3a08`, `03a2633`) and four merges of `main`, the last of them `9def3f5`. Merge base `2634a76`. `main` has since moved to `aae9ded` (PR #40 merged as `74385a1`, plus docs, including the PR #44 code review); none of those commits touches a path this PR changes (§9) |
| Head | 9def3f594bae2f8e340e779ed14e1f7c722df088 |
| Lane A evidence | Run [43562788599](https://github.com/sukhchdit/shipcube/actions/runs/43562788599) on `9def3f5` (`RANGE_BASE` `2634a76`). `fast-lane` **success** with every step executed. `scans`: gitleaks, Semgrep and oasdiff pass; the only failed step is "Security-owned paths need a review record", and `ci-gate` fails for that reason alone. Base-ref `check-evidence`: **PASS**, run `20261114T0516Z_e43ccff` accepted, run `20261114T0455Z_79b9616` rejected as stale (`docs/01-requirements/stories/EPIC-03-organisations-rbac-tenancy.md` changed since `79b9616`), every older run rejected as not an ancestor |
| Lane B evidence | `docs/05-quality/tests/runs/20261114T0516Z_e43ccff`, profile `pr`, verdict PASS: api 124, catalog-c1-c14 74, integration 266 (1 skip; includes `route-phases.int.test.ts` 5/5 on PostgreSQL 18), unit 4454 (2 skip). `git_sha` `e43ccff`, `git_dirty` false, `build_clean` true. Lockfile and manifest SHA-256 equal the head's (recomputed). `e43ccff..9def3f5` adds only the evidence commit and two docs-only merges. The stale run `20261114T0455Z_79b9616` is committed too (profile `pr`) |
| Owned paths changed | 42 (real checker, §9): `apps/api/src/platform/**` (17), `tests/fixtures/lint/**` (18), `tools/eslint-rules/**` (2), `tools/lint/**` (2), `packages/shared/src/http/**` (2), `eslint.config.mjs`. **Not owned** (the record stays valid if they change, §9 S8/S8b): `apps/api/src/{app,main}.ts`, `packages/shared/src/index.ts`, `tests/generated/route-metadata{,.test}.ts`, `tools/repo/test-lane-idle-timeout.test.ts`, the docs and the run directories |
| Reviewer / date | security-analyst, 2026-11-14, round 1. Read-only on code; no Docker; no git command and no write in the PR worktree. Git ran in the main checkout against commit SHAs and in a scratch `git clone --shared` checked out only at simulated commits. ESLint ran in-process with the worktree's own `eslint.config.mjs` and `node_modules` through `lintText` on virtual paths (cwd = worktree, read-only, nothing written; the blob hashes of the config and rule files were checked equal to the head's from the main checkout). Run-time probes used `git archive` extracts of `9def3f5` and of the merge base, type-stripped, with a `node_modules` junction to the main checkout (removed afterwards) |

## 1. Summary

Part 020-C delivers what D-ARCH-106 (4)-(6), D-ARCH-111, D-ARCH-113 (1), (3), (4) and D-ARCH-114 ask, and the closures hold under probing. Each was measured against the merge base as a positive control.

- **PR38-SEC-03 closed (credential headers never reach a handler).**
  - On the head, the old P3 probe throws for all three credential routes; on the base, all three were accepted.
  - The matrix of 8 names x 4 spellings x 7 `auth` declarations gives 224 cells. 216 are refused. The 8 accepted cells are exactly `x-quote-token`, in four spellings, on `auth: 'session'` and `['session']`. On the base, 0 of 224 were refused.
  - `[session]` still refuses the other seven names.
  - The refusal and the projection in `validate.ts` read the same `describe().keys`. So `rename`, `when`, a key with a space and Unicode look-alikes deliver nothing (0 of 8 accepted shapes deliver a credential). On the base, `concat`, `append`, `keys` and `fork` delivered one.
  - `CREDENTIAL_HEADER_NAMES` equals the `securitySchemes`-derived set plus `x-reauth-proof`.
  - The contract has the `X-Quote-Token` parameter on exactly `claimQuote`, `saveQuote` and `createShipment`, all `[bearerAuth]`, so companion parity replaces the `PIPELINE_HEADERS` entry without widening anything.
- **PR38-SEC-04 closed.** A null-prototype, `Map` or class-instance `$_terms` is reported (all three were clean on the base). D-TASK020-56 is not a bypass: a tampered dependency entry that hides an extension type is found on the head (it was clean on the base). Residual: schemas held in rule arguments (`array.has`, `object.assert`) are not walked, on the base or on the head (PR44-SEC-06, INFO).
- **PR38-SEC-02 / D-ARCH-114 closed for the static forms.** Nine value forms (a named `PrismaClient` import, a named `Prisma` import, namespace, `export *`, `export {}`, side effect, `import()`, template `import()`, inline `createRequire(u)(x)`) are now refused from `apps/worker/src/platform/db/` and from a second `apps/api/src/platform/db/` file: 18 rows that were clean on `main`. `generated.ts` and tests still pass.
  - The residual is wider than D-TASK020-59 states (PR44-SEC-01, MEDIUM, pre-existing). A `createRequire` loader that is kept in a variable, imported under an alias or read from a namespace defeats `boundaries`, `moduleSourceVisitor` and the constructor-by-name arm. From any un-owned module file it loads the generated client, `pg`, `@prisma/adapter-pg` and the audit writer lint-clean, and constructs a second client.
  - Same item as code review R1-m6; the severity here is higher because module code has no CODEOWNERS line.
- **T-83 residuals (a)-(h) and core `no-eval`: PR32-SEC-12 closed.** Every named form reports on the head and was silent on `main`: R4 `load` (inline, wrapped, on `fixtureRoute`, in a same-file const spec; a parameter is reported), import-aliased factories, wrapped and IIFE phases, the `names` const alias, `Atomics.wait`, constructor-injected handles, a literal `import('undici')`, and `eval` in its direct, indirect, `globalThis` and alias forms.
  - `call` and `afterCommit` are correctly never roots.
  - Residual shapes and sources are still lint-clean (PR44-SEC-04, LOW): a spread of a phases object, a computed non-literal key, `defineRoute.call`, a const alias of the factory, `??`, `node:timers`, `global.setTimeout`, `node:http2`, `node:net`, `node:dns`, `node:child_process` and the global `WebSocket`. The last five also escape the SSRF rule `outbound-http-via-client`.
- **`load` is read-only and placed right.** The context statement stays the first statement. `SET TRANSACTION READ ONLY` follows the leak check inside the same `$transaction` callback, and `SET TRANSACTION READ WRITE`, `set_config('transaction_read_only', …)` and `RESET` cannot undo it. A literal raw `COMMIT`, `ROLLBACK` or session-level `SET` in a tagged template can still end the transaction or change the pooled session (PR44-SEC-05, LOW, pre-existing for `handler` as well; by PostgreSQL and Prisma semantics, not executed this round).
- **`call` holds no transaction, handle or permit.** Its context has no `db`, and the slot exposes no runner. A `db` kept from `load` is revoked (`TENANT_TX_CLOSED`, lazy results included). The admission permit is per `withTenantTx`, and the textual union with PR #42's `admission.run(...)` keeps it that way.
  - The signal misses a disconnect that happens before `call` starts (probe: not aborted at entry, nor within 1.5 s; controls abort at 297 ms and 310 ms).
  - The deadline is never enforced by the slot.
  - Both are PR44-SEC-02 (LOW), the same items as code review R1-m1 and R1-M1.
- **`afterCommit` is sound but unbounded.** The failure line carries route, operation, correlation id and an identifier-shaped class name only; there is no message, value or credential. Work runs after the response, with no transaction or handle, and is drained inside the 25 s bound. The queue has no cap: 200,000 hung items gave pending 200,000 and +226 MiB, with no refusal (PR44-SEC-03, LOW, = R1-m4).
- **Evidence hygiene: accepted.**
  - The PR gate table carries the D-SEC-PR23-02 statements.
  - Both runs are profile `pr`, and there is no lockfile change.
  - The count-only host-fragment scan finds 0 in both run directories (7 files, 9,364 lines each), in the 2,571 added code lines and in the commit messages; the synthetic control fires.
  - Lane A rejects the stale run and accepts the fresh one.

**Findings: 1 MEDIUM, 4 LOW, 4 INFO. Nothing Critical or High; nothing is a regression of this PR. Verdict: PASS_WITH_FOLLOW-UPS** (§11).
- PR44-SEC-01 and -05 are pre-existing and routed with due points.
- PR44-SEC-02, -03 and -04 coincide with code review findings that already force a fix cycle (R1-M1, R1-m1, R1-m4, R1-m5, R1-m6). The cheapest closure is in that cycle, followed by a security delta round.

## 2. Method

| Area | How |
|---|---|
| Diff | `git diff origin/main...9def3f5` (64 files; the 14 run files read for bindings and hygiene only). Read in full: `define-route.ts` (credential, phase and walk checks), `execute.ts`, `after-commit.ts`, the `with-tenant-tx.ts` and `problem-handler.ts` hunks, `credentials.ts`, `route-metadata.ts` (companion parity), `module-sources.mjs`, `no-external-calls-in-tenant-tx.mjs` (all 696 lines), the eslint hunks with their surrounding categories, `app.ts` and `main.ts`. Context read: `validate.ts` (`declaredHeaders`), `tenant-db.ts` (revocation), `db-raw-sql.mjs`, `prisma-client-construction.mjs`, `outbound-http-via-client.mjs`, `classify.ts` (`thrownClassName`), `shutdown.ts`, `.semgrep/password-hashing.yml` |
| P1 value-importer matrix (`lintprobe.mjs`, `cases-l.mjs`) | `ESLint#lintText` with the worktree config (`disableTypeChecked`, no project service). 17 forms (F01-F17) x 5 importers (worker `platform/db`, a second api `platform/db` file, `generated.ts`, a module repository, a `platform/db` test) = 85 rows. Plus 18 `moduleSourceVisitor`-consumer rows (A01-A18) from a module service: audit writer, `node-path-only`, adapter, `pg`, bcrypt, `.resolve`. The same 103 cases run on the main checkout's config are the positive control |
| P2 T-83 and `no-eval` (`cases-t.mjs`, `cases-t2.mjs`) | 55 + 38 cases on a module routes/service path, head vs `main`. Sources that only the T-83 rule reports (an injected `queue` and a `setTimeout` sleep) separate it from `outbound-http-via-client` |
| P3 credential headers and walk (`p-define.mjs`) | The head's and the base's real `defineRoute` / `fixtureRoute` / `extensionProblems` (type-stripped `git archive` extracts, resolve/load hook). It covers: the PR #38 P3 probe; the 224-cell header matrix; 17 header-schema shapes pushed through the real `declaredHeaders` + `prepareSchema(...).validate` with sentinel values (`validate.ts` copied with its private projection exported, in scratch); 11 walk cases; 8 phase-rule cases. The output is verdicts and booleans only |
| P4 `call` signal (`p-signal.mjs`) | Real `executeSlot` + Express 5 + a fake runner, and a raw-socket client. (A) the client goes at 100 ms while `load` sleeps 400 ms; (B) the client goes during `call`; (C) the deadline is 300 ms. `call` records `signal.aborted` at entry and waits up to 1.5 s for `abort` |
| P5 `afterCommit` queue (`p-queue.mjs`) | Real `createAfterCommitQueue`, 200,000 never-settling items, `--expose-gc` heap delta |
| P6 contract scan | `openapi.yaml` at the head: every operation with an `X-Quote-Token` parameter or a `quoteToken` security entry, and every credential-named header parameter |
| P7 hygiene | Count-only host-fragment scan (`hostscan.mjs`; needles computed at run time, labels and counts only, synthetic positive control) over both run directories, the added code lines, the commit messages, and `main`'s 138 run files. Gitleaks v8.30.1 default-rule emulation (`gl-emul.mjs`, run-time positive controls) over this record |
| P8 record simulation (`record-sim.sh`) | Sparse shared clone; plumbing scenario commits on `9def3f5`; the real `tools/ci/check-security-owned-paths.mjs` of `main`; 15 scenarios including the unions with simulated squashes of PR #42 (`21be73d`) and PR #43 (`772d433`). It also runs `main`'s current `check-evidence.mjs` against the head |
| Cross-check | Code review round 1 (`aae9ded` on `main`, CHANGES_REQUESTED: R1-M1, R1-m1..m6, R1-n1..n8), read before finalising. Where we overlap, its IDs are cited and the security rating is stated |

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR44-SEC-01 | A `createRequire` loader held in a variable, imported under an alias or read from a namespace is seen by no import control except `static-module-specifier` / `system-model-owner`. From un-owned module code, the generated client, `pg`, `@prisma/adapter-pg` and the audit writer load lint-clean, and `new C()` builds a second Prisma client | MEDIUM | CWE-693 | A01 | `eslint.config.mjs:770-780` (`additional-dependency-nodes`: inline form only), `:399-401` (residual comment); `tools/eslint-rules/module-sources.mjs:152-157`; `tools/eslint-rules/prisma-client-construction.mjs:37-45` | senior-developer (`lint` lock), in this PR's fix cycle (= code review R1-m6), at the latest 020-D; principal-architect for the ADR wording |
| PR44-SEC-02 | The `call` (and stream) signal is incomplete and not enforced: a client that leaves before `call` starts never aborts it, and the 20 s deadline only aborts a signal | LOW | CWE-404 | A04 | `apps/api/src/platform/tx/execute.ts:144-154, 188, 209` and `:131-135` | senior-developer, this PR's fix cycle (= R1-m1 + R1-M1) |
| PR44-SEC-03 | The `afterCommit` queue has no cap: pending work, and what each closure retains, grows without bound | LOW | CWE-770 | A04 | `apps/api/src/platform/tx/after-commit.ts:50-63` | senior-developer (= R1-m4); before the first route that declares `afterCommit` merges |
| PR44-SEC-04 | T-83 rule residuals after (a)-(h): spread phases, non-literal computed keys, factory indirection, `??`/`\|\|`, and sources missing from the lists | LOW | CWE-400 | A04 | `tools/eslint-rules/no-external-calls-in-tenant-tx.mjs:67-68, 160-166, 418-425, 478-524` | senior-developer (shapes: fix cycle with R1-m5, else 020-D); the source lists with TASK-113 |
| PR44-SEC-05 | A literal transaction-control or session statement in a tagged raw template ends the read-only `load` transaction (and the handler's) or changes the pooled session; neither the lint nor the `TenantDb` guard refuses it | LOW | CWE-693 | A04 | `tools/eslint-rules/db-raw-sql.mjs:32, 460` (only `SET LOCAL` text); `apps/api/src/platform/db/tenant-db.ts:64`; `with-tenant-tx.ts:364` | senior-developer, 020-D (with the D-ARCH-124 raw-SQL scanner) |
| PR44-SEC-06 | `extensionProblems` does not walk schemas held in rule arguments (`array.has`, `object.assert`): a `Joi.extend` type there is accepted, and it runs at validation | INFO | CWE-636 | A04 | `apps/api/src/platform/routing/define-route.ts:382-417` | next `define-route.ts` edit (with R1-n1/R1-n3) |
| PR44-SEC-07 | The `x-quote-token` companion value in `input.headers` also reaches `call` and is retained by `afterCommit` after the response | INFO | CWE-522 | A07 | `execute.ts:201-207, 188, 220` | senior-developer, next `execute.ts` touch; TASK-091 / the claimQuote route |
| PR44-SEC-08 | The runtime-twin ratchet and the credential parity tests are outside CODEOWNERS | INFO | CWE-693 | A08 | `.github/CODEOWNERS` (`tools/repo/`, `tests/generated/`) | devops-engineer 015-C or senior-developer |
| PR44-SEC-09 | `no-eval` residuals: `node:vm`, a literal `data:` URL `import()` and `new Worker(code, { eval: true })` are lint-clean in application code | INFO | CWE-95 | A03 | `eslint.config.mjs:907-912`; `tools/eslint-rules/static-module-specifier.mjs` | next `lint`-lock holder (020-D) |

## 4. Finding details

### PR44-SEC-01 (MEDIUM): aliased `createRequire` loads escape every import control but one

**What.** `boundaries` sees a `createRequire` load only in its inline form, `createRequire(<x>)('<m>')`. Its additional dependency node selector is `CallExpression[callee.callee.name="createRequire"] > Literal` (`eslint.config.mjs:772`).

`moduleSourceVisitor` sees only a bare `require('<m>')` (`module-sources.mjs:155`). ESM code has no global `require`, so in practice it sees no CommonJS load at all. It feeds three rules:
- `audit-writer-allowlist`;
- `node-path-only`;
- the import arm of `prisma-client-construction`.

The constructor arm of `prisma-client-construction` matches `new PrismaClient` / `new PrismaPg` by name only. The PR taught `isRequireCall` the aliases (D-ARCH-111 (h)), but only `static-module-specifier` and `system-model-owner` use it. Those force a literal specifier and never ask which module the literal names.

**Probe P1** (head; `main` identical on every row below, so it is pre-existing):

| Form | worker `platform/db` | 2nd api `platform/db` | module repository |
|---|---|---|---|
| F08 `const req = createRequire(import.meta.url); req('@platform/prisma/client')` | clean | clean | clean |
| F09 `import { createRequire as mk }`; `mk(u)(G)` | clean | clean | clean |
| F10 / F11 `m.createRequire(u)(G)` (namespace / default import) | clean | clean | clean |
| F16 `req(G)` destructured, `new PrismaClient({})` | clean (rule off in `platform/db`) | clean | `prisma-client-construction` |
| F17 `const C = req(G).PrismaClient; new C({})` | clean | clean | **clean** |
| F07 inline `createRequire(u)(G)` (control) | `boundaries` | `boundaries` | `boundaries` |

From a module service (rows A01-A18):
- **Lint-clean:** the audit writer via inline or aliased `createRequire` (A04-A06); `req('pg')` (A13); `req('@prisma/adapter-pg')` and `new A({})` through an alias (A11, A12); `createRequire(u)('fs')` (A08).
- **Reported (controls):** the static, `import()` and inline forms (A01-A03, A07, A09, A10, A14, A16), and a computed specifier (A17).
- **Covered outside lint:** `req('bcrypt')` (A15) is lint-clean, but `.semgrep/password-hashing.yml` matches `$R("bcrypt…")` under any binding, so lane A catches it.
- `createRequire(u).resolve(...)` (A18, the one use in `openapi/serve.ts:121`) stays clean.

**Impact.**
- `apps/api/src/modules/**` and the worker's job code have no CODEOWNERS line, so such a file needs no security record. Only code review would see it.
- A second Prisma client or `pg` client opens connections outside `withTenantTx`. It can set any `app.org_id`, which defeats RLS, the guarantee behind O3 "zero cross-tenant access" and PR2-SEC-05.
- The audit writer loaded by a feature module defeats REQ-AUDIT-001.
- The narrowing of D-ARCH-114 and the `SQL_DRIVER_CODE` confinement fall to the same aliased forms.
- The comment at `eslint.config.mjs:399-401` and ADR-0003 amendment 2026-11-14 item 2 name `prisma-client-construction` as the backstop for the dynamic forms. It is off in `platform/db` and misses `new C()`. ADR-0005 am. 11 item 22 says the import controls resolve `createRequire` through aliases, which holds for `static-module-specifier` only.

**Exploitability.** Impact high. Likelihood low: it needs a developer to reach for `createRequire`. That is exactly what an agent blocked by a `boundaries` error and the no-disable ratchet can do, and nothing but review stops it. Matrix H x L = MEDIUM.

**Remediation (code level).**
1. **Confine the loader itself.** This is preferred, because it closes every consumer at once. Add a rule (or a `static-module-specifier` arm) for `apps/*/src/**` and `packages/*/src/**`, tests excluded.
   - A call whose callee `isCreateRequire(callee, sourceCode)` (already alias- and namespace-aware in `module-sources.mjs`) is legal only as the object of a `.resolve(<literal>)` member call.
   - Any other use is reported: called, stored in a variable, returned or passed.
   - Every module load is then an `import` / `import()`, which `boundaries` and the visitor already see.
2. **Belt and braces (= R1-m6):** `moduleSourceVisitor(onReference, sourceCode)` uses `isRequireCall(node, sourceCode)` in its `CallExpression` arm. Make `prisma-client-construction` treat a require-style load (`names: ['*']`) of `@platform/prisma/client` or `@prisma/client` as a constructor import. On its own this does not close F08-F11 for `boundaries`, nor A13 `pg`, which only `boundaries` confines. So it is not sufficient alone.
3. Correct the `eslint.config.mjs:399-401` comment. principal-architect corrects ADR-0003 am. 2026-11-14 item 2 and ADR-0005 am. 11 item 22.

**Verification.** Re-run the 103 P1 cases: every F08-F11, F16 and F17 row and A04-A06, A08, A11-A13 must report; F15 (`import type`), A18 (`.resolve`) and the `generated.ts` and test rows stay clean. Add fixtures for F08, F09, F10, F17 and A05 under `tests/fixtures/lint/`, with `negative-fixtures.test.ts` entries.

**Due.** In this PR's fix cycle if R1-m6 is taken in-PR (one function, `lint` lock held); otherwise in 020-D. In either case it must merge before the first `apps/*/src/modules/**` or worker job code PR (Wave 1). Until then, code review of every module PR greps for `createRequire`.

### PR44-SEC-02 (LOW): the `call` signal misses an early disconnect and its deadline is advisory

**What.** `requestSignal` registers `res.once('close', …)` only when `signal()` is first called (`execute.ts:209`), which is when `call` starts (`:188`). A client that left during `load`, or during authn or validation, has already fired `close`.

**Probe P4:**
- **(A)** client gone at 100 ms, `load` 400 ms: `signal.aborted` is `false` at entry and still `false` 1.5 s later. The handler transaction then opens and commits (= code review P2).
- **(B) control:** a disconnect during `call` aborts after 297 ms (`AppError`).
- **(C) control:** the deadline aborts after 310 ms (`TimeoutError`).

The slot also awaits `call(...)` and `stream.complete(...)` bare (`:188`, `:135`). A call that ignores the signal holds the request, its socket and its closures indefinitely (= R1-M1). `main.ts` sets no server response timeout.

**Impact.**
- Nothing is held across `call`: no transaction, no connection, no permit. So this is not pool starvation.
- The carrier or gateway effect still runs for a client that is gone, costing carrier quota and gateway authorisations. Idempotency keys derived from `loaded` keep that to one effect per key.
- A hung external dependency or a call that ignores the signal pins requests until the 25 s drain bound exits the process with 1.
- The ADR-0003 row promises abort "on client disconnect". Likelihood medium, impact low: LOW.

**Remediation.**
- Create the lifetime at slot entry, before `run(...)`. Or, in `requestSignal`, abort at once when `res.closed || res.destroyed || req.socket.destroyed`:
  ```ts
  if (res.closed || res.destroyed) onClose(); else res.once('close', onClose);
  ```
- Before `call`, `signal.throwIfAborted()`, so neither `call` nor the handler transaction runs.
- Race `call(...)` and `stream.complete(...)` against the signal, and give the deadline an `AppError('SERVICE_UNAVAILABLE')` reason (R1-M1 (a)/(b)). An abort is then a retryable 503, never a 500 or a hang.

**Verification.**
- Add to `execute-phases.test.ts`: the client aborts while `load` is held, and `call` sees `aborted === true` or never runs, with no `begin:rw`.
- Add the R1-M1 tests: a never-settling `call` with `callDeadlineMs: 50` answers 503 within the bound, and no `begin:rw` follows.

### PR44-SEC-03 (LOW): the `afterCommit` queue is unbounded

**What.**
- `schedule` adds every item to `inFlight` with no limit and no per-item deadline (`after-commit.ts:50-63`).
- Probe P5: 200,000 never-settling items give `pending` 200,000 and +226 MiB of heap, with 0 refused.
- Real items also retain `request` (validated input) and `result` (the response body).
- The first planned consumer is the `createQuote` fan-out start (D-ARCH-106 (2)(c), TASK-083/091), on an `[anonymous, session]` route.

**Impact.** The response returns before the work, so a client is not slowed by a slow carrier. Attacker load and fan-out work decouple, and memory grows until the process restarts.
- No route declares `afterCommit` today, so the likelihood is low: LOW.
- It becomes MEDIUM the day a public route schedules work without a bound.

**Remediation (= R1-m4).**
- Add `createAfterCommitQueue(logger, { maxPending = AFTER_COMMIT_MAX_PENDING })`, a code constant like `CALL_DEADLINE_MS`; performance-engineer sizes it.
- At the cap, do not start the work, and log `api.after_commit_dropped` with the same four label fields (value-free).
- Pass an `AbortSignal` to `afterCommit`, aborted at drain start and after a per-item deadline.
- `main.ts` keeps one queue. `try { await close } finally { await afterCommit.drain() }` (R1-m3).

**Verification.** Unit tests:
- `maxPending + 1` scheduled gives exactly one dropped, one log line and `pending <= maxPending`;
- drain still settles;
- the signal aborts at drain start.

**Due.** Before the first route that declares `afterCommit` merges, and a merge condition of that route's PR.

### PR44-SEC-04 (LOW): T-83 rule residuals after (a)-(h)

**What.** The probe P2 rows are silent on the head and on `main`. Each was probed twice, once with an injected `queue` call and once with a `setTimeout` sleep, so `outbound-http-via-client` cannot mask the result.

Shapes in a route spec:
- a spread of a same-file phases object, `defineRoute({ ...decl, ...phases })` (S01), and of an inline or const `{ load }` (S02, S03, S04);
- a computed key that is not a string literal, `` [`load`] `` or `[K]` (K02-K04);
- factory indirection: `defineRoute.call(undefined, spec)`, `const dr = defineRoute`, `(0, defineRoute)(spec)` (F01-F03);
- `handler: maybe ?? (async () => …)` (H03);
- a handler in an array literal or a same-file object literal member (H08, H09);
- setter-injected handles (I02).

The spread is code review R1-m5 Q1; its Q2 (a `const` bound to a conditional of two inline functions) is the same class as H03.

Sources:
- `setTimeout` imported from `node:timers` (X02) and `global.setTimeout` (X01);
- `setInterval` from `node:timers/promises` (X03);
- `node:http2`, `node:net`, `node:dns`, `node:child_process` and the global `WebSocket` (X04-X08). These five also pass `outbound-http-via-client`, the NFR-SEC-010 SSRF control;
- a const alias or `.call` of `fetch` (X09, X10), and a destructured `names` key (X13, = R1-n8).

**Impact.** A transaction held open across I/O starves the per-tenant pool (T-83, M/M).
- The natural refactor shapes (`...phases`, `??`, `node:timers`) are the likely ones. The rest are deliberate.
- The runtime twin (idle 1 s in the API lanes) catches any of them that a test drives.
- LOW.

**Remediation.**
- **Spreads** (`collectRoute`): walk a `SpreadElement` whose argument resolves to an inline or same-file `const` object literal (recursively) as part of the spec. Report any other spread unless an explicit `handler` follows it (R1-m5 (a)).
- **Computed keys** (`propertyKey`): resolve a no-substitution template literal and a same-file `const` string. Otherwise report `routeSpec`.
- **Phases** (`collectPhase`): walk `LogicalExpression` operands like `ConditionalExpression`, and recurse into any `const` initialiser except a member expression (R1-m5 (b)).
- **Factory:** report a reference to `defineRoute` / `fixtureRoute` that is neither a direct callee nor an import specifier.
- **Sources:**
  - `EXTERNAL_MODULES` += `node:http2`, `http2`, `node:net`, `net`, `node:tls`, `tls`, `node:dgram`, `dgram`, `node:dns`, `dns`, `node:dns/promises`, `node:child_process`, `child_process`;
  - sleeps += `setTimeout` from `node:timers` / `timers`, `setInterval` from timers/promises, `global.setTimeout`;
  - global `WebSocket` like `fetch`.
  - TASK-113 mirrors the network list in `outbound-http-via-client`.
- One fixture per form.

**Verification.** The P2 rows S01-S04, K02-K04, F01-F03, H03, X01-X08 report on the fixed head. C03/C04 (`call`, `afterCommit`) stay clean.

### PR44-SEC-05 (LOW): raw transaction-control and session statements end the read-only `load`

**What holds.** The context statement runs first. `SET TRANSACTION READ ONLY` runs after the leak check, inside the same `$transaction` callback (`with-tenant-tx.ts:364`), so 25006 applies to every statement `fn` sends. Inside the transaction, PostgreSQL refuses the undo routes:
- `SET TRANSACTION READ WRITE` and `set_config('transaction_read_only', 'off', …)` after the first query (25001);
- `RESET transaction_read_only`, which has been refused since PostgreSQL 16 (`GUC_NO_RESET`).

A rollback to a savepoint cannot revert it either, because it was set before the savepoint. The code review ruling on D-TASK020-47 reaches the same conclusion for `SET` and `set_config`; it does not cover the transaction-control statements below.

**What does not hold.**
- `TenantDb` exposes the tagged `$queryRaw` / `$executeRaw` (`tenant-db.ts:64`). `platform/db-raw-sql` refuses only `SET LOCAL` text (`db-raw-sql.mjs:32, 460`).
- A repository method called from `load` can therefore send `` db.$executeRaw`COMMIT` ``, which commits the read-only transaction on the itx connection. The rest of `load` then runs in autocommit, read-write.
  - It runs without the transaction-local tenant context and timeouts. RLS tables then fail closed; SYSTEM tables have no RLS.
  - Prisma's own `COMMIT` later draws only a warning.
- Session-level statements change the pooled backend for later requests: `SET search_path …`, `SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY`, `RESET ALL`, `DISCARD ALL`.
- The same applies to `handler`, where a mid-handler `COMMIT` separates writes from their audit entry (O4).
- This is pre-existing. This PR makes "`load` writes nothing" a stated property, so it is recorded here.
- Derived from PostgreSQL and Prisma semantics; not executed this round (no Docker).

**Exploitability.** It needs literal SQL text in a repository: a mistake or deliberate code, visible in review. Impact medium, likelihood low: LOW.

**Remediation.**
- `db-raw-sql`: report a tagged raw template whose first keyword (after comments and whitespace) is `BEGIN`, `START`, `COMMIT`, `END`, `ROLLBACK`, `ABORT`, `SAVEPOINT`, `RELEASE`, `PREPARE TRANSACTION`, `SET` (any form), `RESET`, `DISCARD`, `LISTEN`, `UNLISTEN` or `NOTIFY`.
- `TenantDb` raw guard: the same first-keyword check at run time on the template strings, refusing before any statement is sent.
- Reuse the tokenizer of the D-ARCH-124 `rawSystemTable` check, which also scans raw-SQL text outside literals and comments.

**Verification.**
- A Testcontainers case in `route-phases.int.test.ts`: a `load` that sends `COMMIT` and then an `INSERT` is refused before `COMMIT` reaches the server, and the row count is unchanged.
- Lint fixtures for `COMMIT`, `SET search_path` and `RESET ALL`.

**Due.** With D-ARCH-124 (before the first module repository raw statement merges, TASK-073 first known) and before G3.

### PR44-SEC-06 (INFO): schemas in rule arguments are outside the extension walk

**What.**
- `Joi.array().items(Joi.string()).has(ext.string())` and `Joi.object({ a }).assert('.a', ext.string())` keep the schema in `_rules[].args`, not in `$_terms`.
- `extensionProblems` reports nothing for either, on the head and on the base. `defineRoute` accepts both as a body schema, and the extension's `validate` runs once per validation (probe P3, D5).
- `.custom()` and `.external()` are accepted too, so this gives a route author no new capability. But the walk's claim (every reachable schema is built on a built-in definition) is false for this shape.

**Remediation.** In `extensionProblems`, also visit the values of `schema._rules[i].args` that are schemas (or refuse `has`/`assert` with a schema argument). Add tests for both forms, and pin the dependency walk as R1-n1 asks.

### PR44-SEC-07 (INFO): the companion quote token reaches `call` and `afterCommit`

**What.**
- On the three `[session]` companion routes, the validated `input.headers['x-quote-token']` is part of `RouteRequestContext`. That is by design for the handler (D-ARCH-113 (1)).
- The same frozen `request` is handed to `call` (`:188`) and kept by the scheduled `afterCommit` closure until it settles (`:220`).
- No other credential reaches any phase (§5.1).

**Remediation.** Hand `call` and `afterCommit` an `input` whose `headers` drops the `CREDENTIAL_HEADER_NAMES` entries, or document that the claimQuote/saveQuote/createShipment phases never forward it. Add a test that `call` / `afterCommit` see no `x-quote-token`.

### PR44-SEC-08 (INFO): ownership of the ratchet and parity tests

**What.** The D-ARCH-106 (6) runtime-twin ratchet (`tools/repo/test-lane-idle-timeout.test.ts`) is outside every CODEOWNERS line, and so are the D-ARCH-113 parity tests (`tests/generated/route-metadata{,.test}.ts`). Record simulation S8/S8b: an edit to either after this record keeps it valid.

The primary controls are owned: the `defineRoute` refusal in `platform/routing` and the list in `packages/shared/src/http`. So this is INFO, the same class as PR38-SEC-06.

**Remediation.** Add CODEOWNERS lines for `/tools/repo/test-lane-idle-timeout.test.ts` and `/tests/generated/route-metadata*.ts`, plus `REQUIRED_CODEOWNED_PATHS`, with devops-engineer 015-C.

### PR44-SEC-09 (INFO): `no-eval` residuals

**What.** In `apps/*/src`, the following are lint-clean (P2 E06-E08):
- `vm.runInThisContext(...)` from `node:vm`;
- `await import('data:text/javascript,…')` (a literal specifier, so `static-module-specifier` accepts it);
- `new Worker(code, { eval: true })`.

`new Function` and string timers are left to the type-aware `no-implied-eval`, which this probe ran without type information, so they are not verified here. ADR-0005 am. 11 item 22 treats the eval family as deliberate evasion with one fixture each.

**Remediation.**
- `no-restricted-imports` for `node:vm` / `vm` in `apps/*/src` and `packages/*/src`.
- `static-module-specifier` refuses `data:`, `blob:` and `http(s):` specifiers.
- `no-restricted-syntax` for an `eval: true` property in a `Worker` options literal.
- One fixture each.

## 5. Focus areas checked

### 5.1 Credential headers (PR38-SEC-03)

- **List completeness.** `securitySchemes` derive `authorization` (bearer), `cookie` (both refresh-cookie schemes, whose names are in `REFRESH_COOKIE_NAMES`), `x-csrf-token`, `x-quote-token`, `stripe-signature`, `x-mock-signature` and `x-carrier-signature`. The header parameters add `x-reauth-proof`. That is exactly the 8 names of `CREDENTIAL_HEADER_NAMES`.
  - The other header parameters in the contract are not credentials: `Accept-Language`, `Idempotency-Key`, `If-Match`, `If-None-Match`, `Last-Event-ID`, `X-Correlation-Id` and `X-Mock-Scenario`.
  - The slot-owned `PIPELINE_HEADERS` that carry proofs (`x-csrf-token`, `x-reauth-proof`) are in the list, so a route can neither declare them nor have them compared.
- **Case and encoding.** Upper, title and alternating case are refused. A Kelvin sign (U+212A) in place of the `k` of `cookie` lower-cases to `cookie` and is refused, which is harmless over-matching. A trailing or leading space, a dotless-i `authorization`, a NUL suffix and the `rename`/`when` shapes are accepted, but `declaredHeaders` projects only exact `describe().keys` from Node's lower-case `req.headers`, and the sentinel never arrives (0/8).
- **Carve-out.** Exactly `'session'` and `['session']` accept `x-quote-token`. `[session, quote-token]`, `[anonymous, session]`, `[anonymous]`, `[refresh-cookie]` and `[signature]` refuse it, and `[session]` refuses the other seven (D-TASK020-55 confirmed).
- **Companion parity.** `PIPELINE_HEADERS` loses `x-quote-token`. `openApiParameters` skips it only where the operation's effective security lists `quoteToken` (getQuote, streamQuoteResults, which `defineRoute` refuses to declare it on anyway), and compares it elsewhere. A missing `doc` argument makes the comparison stricter, not looser. The contract scan (P6) has the parameter on the three `[bearerAuth]` companions only.
- **Old P3 probe.** It now throws (3/3). The base accepted it (3/3).
- **Problem handler third arm (R2-n1).** `(route === undefined || !credentialsReadOf(res)) && presentsCredential(...)` only adds cases that answer `private`, so it is more private, never less. The code review killed the revert mutant.

### 5.2 `$_terms` (PR38-SEC-04, D-TASK020-56)

- A non-plain `$_terms` (null-prototype, `Map`, class instance) is reported on the head. On the base it was walked as nothing.
- RegExp and refs are leaves.
- **Ruling on D-TASK020-56: accepted, not a bypass.**
  - Joi's dependency entries hold refs and strings, never schemas.
  - Walking them visits every own enumerable value, which is the fail-closed direction: a tampered entry that hides an extension is reported (P3 D5).
  - The prototype is read from the default Joi root. A second Joi copy or an upgrade gives a mismatch and is reported (the code review killed D9).
  - What remains is test-pinning (R1-n1) and the rule-argument gap (PR44-SEC-06).

### 5.3 D-ARCH-114 (PR38-SEC-02)

- The static narrowing works (§1).
- The worker, a second `platform/db` file, `import()` and the template `import()` are refused.
- A computed specifier is refused by `static-module-specifier`.
- The `createRequire` residual is PR44-SEC-01.
- **D-TASK020-59 residual: rated MEDIUM as PR44-SEC-01.** The residual is wider than stated: `boundaries` and the constructor arm miss the aliased forms too, and the stated backstop is off in `platform/db`. The owner is 020-D, not "the next touch".
- The PR #38 code review R1-m5 (a two-hop through a `platform/db/tests/` helper) is still open. It is owned with PR34-SEC-07 and due before TASK-026, unchanged.

### 5.4 T-83 (a)-(h), `load` and core `no-eval`

- Every named form fires on the head and not on `main` (§1).
- **Can external calls or long work still run inside the tenant transaction?** Yes, through the shapes of PR44-SEC-04, a same-file helper called from a root (H01, the stated lexical limit), and cross-file code that R6 does not reach. The runtime twin covers each of them that a test drives.
- **Can `load` write?** Through the handle: no (25006 on PostgreSQL 18, proven by the integration test, where call and handler never run). Through external I/O: R4. Through raw transaction control: PR44-SEC-05.

### 5.5 `call`

- **No `db` or transaction handle is reachable.**
  - `CallContext` is `request` + `signal`, frozen; the descriptor carries no runner.
  - A `db` returned from `load` is revoked at its COMMIT. `tenant-db.ts` revokes lazy results too, so a kept `PrismaPromise` rejects with `TENANT_TX_CLOSED` without sending.
  - `isInsideTenantTx()` is false in `call`, because the AsyncLocalStorage scope ended with `load`'s callback.
- **No admission permit is held across `call`.** Each `withTenantTx` takes its own. The code review's cap-of-one test has a control, and the textual union with PR #42 keeps `SET TRANSACTION READ ONLY` inside the `admission.run`-wrapped closure.
- **The signal:** PR44-SEC-02.

### 5.6 `afterCommit` and the stream hook

**Logging.**
- `api.after_commit_failed` carries route template, operationId, correlation id and `thrownClassName`. That is a prototype-constructor name filtered to an identifier of at most 64 characters, never a message. The code review planted card numbers and e-mails in thrown messages, and none surfaced.
- A failing logger is swallowed.

**Timing and context.**
- Work starts on `setImmediate` after the response.
- It runs with no transaction, handle or runner.
- Its context holds only the principal (no raw credential, and `guestTokenHash` is a hash) and the input (PR44-SEC-07).

**Shutdown.** `server.close()` resolves only after every in-flight request scheduled its work, and `drain()` loops until settled inside the 25 s bound. A hung item exits 1, which is tested. The wiring in `main.ts` is unpinned (R1-m3; security concurs).

**DoS bound.** There is none. That is PR44-SEC-03.

**Stream (D-TASK020-50).** Acceptable as a hook for TASK-044.
- `Cache-Control: private, no-store` is re-asserted before `flushHeaders`.
- Body/stream exclusivity is checked after COMMIT (R1-m2).
- The sink ignores backpressure (R1-n5).
- The stream shares the call signal, so PR44-SEC-02 applies.
- TASK-044 must bound the stream's duration.

### 5.7 Evidence hygiene

**D-SEC-PR23-02 statements (verbatim in the PR gate table).**
- Install: "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first".
- Tree: "`.git/info/exclude` is empty" (0 bytes).
- No `wave` or `gate` run is committed: both summaries say profile `pr`.
- There is no lockfile change (the head's lockfile SHA-256 equals the merge base's), so the ajv / `link:true` statement does not apply.

**Host-path scan.**
- 0 in each run directory (7 files, 9,364 lines each).
- 0 in the 2,571 added code lines and in the commit messages of `2634a76..9def3f5`.
- 0 in `main`'s 138 run files.
- The synthetic control fired for every needle.

**Stale run.** Lane A's base-ref `check-evidence` printed `run 20261114T0516Z_e43ccff accepted` and rejected `20261114T0455Z_79b9616` as stale. Both directories are touched by the range and neither fails integrity, so committing the stale run costs nothing.

**`main`'s new verifier.** `main` has since changed `tools/quality/**` (PR #40). The current base-ref copy run against the head is in §9. The code review's merge condition 4 stands: fresh lane-B evidence after any non-docs commit or a merge of `main`.

## 6. Earlier findings and decisions

| Item | Status |
|---|---|
| PR38-SEC-03 (LOW) | **Closed** (§5.1) |
| PR38-SEC-04 (INFO) | **Closed**; rule-argument residual PR44-SEC-06 |
| PR38-SEC-02 (LOW) | **Closed for the static forms** (D-ARCH-114); the dynamic residual is PR44-SEC-01 (replaces "CODEOWNERS only" as the statement of the residual) |
| PR32-SEC-12 (LOW, T-83 lexical residuals) | **Closed** for (a)-(h) and `no-eval`; new residuals PR44-SEC-04 |
| PR #38 code review R2-n1 | **Closed** (§5.1) |
| PR #38 code review R1-m5 + PR34-SEC-07 (test-folder hop) | Open, unchanged, before TASK-026 |
| D-TASK020-47 | Accepted; residual PR44-SEC-05 |
| D-TASK020-48 | Composition accepted; PR44-SEC-02 (= R1-m1, R1-M1). Security concurs with R1-M1 as a fix-cycle item: an advisory deadline needs an architect ruling *and* an ADR-0011/TASK-113 line that every outbound client honours `ctx.signal` |
| D-TASK020-49 | Accepted; PR44-SEC-03 (= R1-m4), R1-m3 |
| D-TASK020-50 | Accepted as a TASK-044 hook (§5.6) |
| D-TASK020-51, -52, -57, -60 | Accepted (types are not a security control; phase contexts frozen and asserted; probes pattern sound; docs) |
| D-TASK020-53 | Accepted; PR44-SEC-08 for the ratchet's ownership |
| D-TASK020-54 | Accepted; the PR #42 union switches the reason (§7) |
| D-TASK020-55 | Confirmed by the matrix (§5.1) |
| D-TASK020-56 | **Accepted, not a bypass** (§5.2) |
| D-TASK020-58 | Accepted; PR44-SEC-09 |
| D-TASK020-59 | Interpretations accepted; the residual is **rated MEDIUM** (PR44-SEC-01), owner 020-D or this fix cycle |
| D-TASK020-61 / D-ORCH-067 | No security objection; 020-D also carries PR44-SEC-05 and, if not taken here, PR44-SEC-01 and -04 |

## 7. Unions: what each must preserve

`git merge-tree` of `9def3f5` with PR #42 (`21be73d`), PR #43 (`772d433`), PR #39 (`7dd3c64`) and `main` (`aae9ded`) is text-clean in all four cases. In the record simulation, each union with #42 or #43 voids this record (S9, S10: both edit owned paths that this PR changes), so the second merger needs a merge-only or delta security round.

**PR #42 (TASK-025): `with-tenant-tx.ts`, `db/index.ts`, `eslint.config.mjs`.**
1. `withTenantTx(ctx, fn, call?)` keeps its third parameter through every wrapper. Inside the one `$transaction` callback, the `readOnly` line that sends `SET TRANSACTION READ ONLY` stays immediately after the leak check and before `createTenantDb`.
2. `admission.run(key, transaction)` wraps that closure. A dropped options argument would make `load` silently read-write, so the union's lane-B evidence must carry `route-phases.int.test.ts` 5/5, including the 25006 case and the `transaction_read_only` on/off case.
3. Any new statement of PR #42 inside the transaction (audit `lock_timeout`, `markRollbackOnly`) runs after the context statement. The audit hook never runs in `load`.
4. `execute-phases.test.ts` switches the stand-in reason to `TENANT_CONCURRENCY_LIMIT` (D-TASK020-54). Each phase transaction keeps its own permit, and none is held across `call`.
5. `eslint.config.mjs`:
   - `PRISMA_GENERATED_VALUE_CODE` stays the file-path selector plus `prisma`/`tools-db`/`test`, never `SQL_DRIVER_CODE`;
   - the `no-eval` block stays;
   - PR #42's `AuditSqlPort` handle type (PR42-SEC-07) and its store exemptions keep the T-83 `txFiles`/`txHandleTypes` options intact.
6. `TEST_LANE_TX_IDLE_TIMEOUT_MS` (1 000) stays valid under PR #42's config guards.

**PR #43 (TASK-024): `eslint.config.mjs`.**
1. `tests/generated/rls/cross-tenant.int.test.ts` composes `createApp` with an idle timeout of 15 000, so the union turns `test-lane-idle-timeout.test.ts` red. The second merger imports `TEST_LANE_TX_IDLE_TIMEOUT_MS` there and proves on Docker that no scenario holds a transaction idle for 1 s.
2. The two `eslint.config.mjs` hunks stay disjoint: PR #43's `render-rls-dr-a14.test.ts` keys entry, and this PR's D-ARCH-114 allow and `no-eval` block.
3. Re-lint `tests/generated/rls/**` with the union config.
4. `PIPELINE_HEADERS` stays without `x-quote-token`, and companion parity stays in `route-metadata.ts`.

**PR #39 (TASK-014): `main.ts`, `with-tenant-tx.ts`.**
1. `main.ts` keeps `afterCommit` passed to `createApp` and `await afterCommit.drain()` after `server.close` inside `drain:` (preferably `try/finally`, R1-m3), next to PR #39's `createOrExitOnConfigError` wrapper.
2. `TenantTxConfigError(message, variable)` from PR #39 coexists with this PR's options parameter.
3. The image prune keeps `dist/**/tx/tests/**` (and `routing/tests/**`) out of the images.

## 8. Checks owed (routed)

| Where | Check |
|---|---|
| This PR, fix cycle (code review R1-M1, R1-m1..m6 already force one) | PR44-SEC-02 and -03 with their tests; PR44-SEC-04 shapes and PR44-SEC-01 if taken in-PR; PR44-SEC-06/-07 optional. Then a **security delta round**: P1 (103 cases), P2 (93 cases), P4 and P5 re-run on the new head and the old head as the control; record simulation; fresh lane-B evidence |
| 020-D | PR44-SEC-05 (with the D-ARCH-124 scanner); PR44-SEC-01 and -04 if not done in this PR; PR44-SEC-09 |
| TASK-113 | The network modules of PR44-SEC-04 in both `no-external-calls-in-tenant-tx` and `outbound-http-via-client`; every outbound client honours `ctx.signal` |
| TASK-044 | Stream duration bound and backpressure (R1-n5); stream signal created at slot entry (PR44-SEC-02) |
| First route declaring `afterCommit` (TASK-083/091) | PR44-SEC-03 merged; that route's record checks the cap and the dropped-work log |
| TASK-091 / claimQuote, saveQuote, createShipment | PR44-SEC-07; the handler compares hashes in constant time and never logs the token |
| devops-engineer 015-C | PR44-SEC-08 |
| principal-architect | Wording of ADR-0003 am. 2026-11-14 item 2 and ADR-0005 am. 11 item 22 (PR44-SEC-01); the R1-M1 ruling if the deadline stays advisory |
| security-analyst (me), next text round | Threat model T-83 row: add the read-only `load`, the runtime twin, the stated residuals PR44-SEC-04/-05; a SEC-TC for "no credential header in `schema.headers`" is already with qa-lead (D-ORCH-067 (3)) |

## 9. Record simulation and secret hygiene

**Record simulation** (`record-sim.sh`; sparse shared clone; `main`'s real `check-security-owned-paths.mjs`; base = `main` tip `aae9ded` unless stated): 15 of 15 scenarios as expected. `git merge-tree` of the record commit with `main`, with a simulated squash of PR #42 and with one of PR #43: 0 conflicts each.

| Scenario | Base -> head | Expected | Result |
|---|---|---|---|
| S0 no record | `main` -> `9def3f5` | missing | missing |
| S1 this record on the head | `main` -> record commit | pass | **pass**: owned 42 (`apps/api/src/platform` 17, `tests/fixtures/lint` 18, `tools/eslint-rules` 2, `tools/lint` 2, `packages/shared/src/http` 2, `eslint.config.mjs` 1), satisfied by `9def3f5` |
| S1-mb | merge base `2634a76` -> record commit | pass | pass |
| S2 wrong PR number (`--pr 42`) | `main` -> record commit | missing | missing |
| S3 / S3b owned edit after the record (`define-route.ts` / `eslint.config.mjs`) | `main` -> edit | missing | missing / missing |
| S4 docs-only evidence after the record | `main` -> evidence | pass | pass |
| S5 merge of current `main` (PR #40 and docs) | `main` -> merge | pass | pass |
| S5b a `main` that also edits `eslint.config.mjs`, then the merge | that `main` -> merge | missing | missing |
| S6 the same record with a FAIL verdict | `main` -> record commit | missing | missing |
| S7 the record naming a SHA outside the range | `main` -> record commit | missing | missing |
| S8 / S8b un-owned edit after the record (ratchet test / `route-metadata.ts`) | `main` -> edit | pass | pass / pass (PR44-SEC-08) |
| S9 union with a simulated squash of PR #42 (`21be73d`) | that `main` -> union | missing | missing (merge-only or delta round needed, §7) |
| S10 union with a simulated squash of PR #43 (`772d433`) | that `main` -> union | missing | missing (same) |

**`main`'s current base-ref `check-evidence.mjs` against the head:** PASS with both copies, the `main` tip `aae9ded` (after PR #40 changed `tools/quality/**`) and the merge base `2634a76`. Each run accepts `20261114T0516Z_e43ccff` with 0 problems and rejects `20261114T0455Z_79b9616` as stale (`docs/01-requirements/stories/EPIC-03-organisations-rbac-tenancy.md`). So a lane A re-run on the current base would still accept this evidence for the unchanged head; a merge of `main` into the branch would not (non-docs paths), as the code review's merge condition 4 says.

**Gitleaks emulation over this record:** 0 findings over the record (222 rules, 221 compiled; the three run-time positive controls, a GitHub token, an AWS key id and a generic API key, fired). **Host-fragment scan of this record:** 0 (all needles; the synthetic control fired). No secret, credential value or OS user name is quoted in this record; the probe outputs held booleans, counts and rule IDs only.

## 10. Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

**D-SEC-PR44-01 · 2026-11-14 · security-analyst (logged by orchestrator) · PR #44 (020-C) round 1.**
- **Decision.** PR #44 security r1 at `9def3f5` = PASS_WITH_FOLLOW-UPS (0 Critical/High; 1 MEDIUM pre-existing, 4 LOW, 4 INFO).
- **Closed:** PR38-SEC-03 (224-cell matrix, exact `[session]` carve-out, 0 credentials projected), PR38-SEC-04 (non-plain `$_terms` reported; D-TASK020-56 accepted, not a bypass), PR38-SEC-02 for the static forms (18 rows newly refused), PR32-SEC-12 ((a)-(h) and `no-eval` fire on head, silent on `main`), PR #38 R2-n1.
- **New:**
  - **PR44-SEC-01 MEDIUM** (pre-existing; = code review R1-m6, rated higher because module code is un-owned): aliased or namespaced `createRequire` loads defeat `boundaries`, `moduleSourceVisitor` and the constructor-by-name arm. From module code, the generated client, `pg`, the adapter and the audit writer load lint-clean, and `new C()` builds a second client. Fix: confine `createRequire` to `.resolve(<literal>)` in `apps/*/src` and `packages/*/src`, plus the visitor fix. Due: this fix cycle or 020-D, and before the first module or worker-job code PR. ADR-0003 am. 2026-11-14 item 2 and ADR-0005 am. 11 item 22 wording → principal-architect.
  - **PR44-SEC-02 LOW** (= R1-m1 + R1-M1): disconnect before `call` missed; deadline advisory. Fix cycle.
  - **PR44-SEC-03 LOW** (= R1-m4): `afterCommit` queue uncapped (200k items +226 MiB). Before the first `afterCommit` route.
  - **PR44-SEC-04 LOW** (⊇ R1-m5): T-83 residual shapes and sources (spread phases, computed keys, factory indirection, `??`, `node:timers`, `global.setTimeout`, http2/net/dns/child_process/WebSocket, the last five also past the SSRF rule). Fix cycle or 020-D; lists with TASK-113.
  - **PR44-SEC-05 LOW** (pre-existing): literal `COMMIT`/`ROLLBACK`/session `SET` in tagged raw SQL ends the read-only `load` (and the handler's transaction) or changes the pooled session. 020-D with D-ARCH-124, before TASK-073 and G3.
  - **INFO:** PR44-SEC-06 (rule-argument schemas outside the extension walk), PR44-SEC-07 (quote token reaches `call`/`afterCommit`), PR44-SEC-08 (ratchet and parity tests un-owned → 015-C), PR44-SEC-09 (`node:vm`, `data:` import, Worker eval → 020-D).
- **Evidence.** `20261114T0516Z_e43ccff` accepted; `20261114T0455Z_79b9616` rejected by lane A as stale, harmless; D-SEC-PR23-02 statements verbatim; host scan 0.
- **Next round.** After the code review's fix cycle: a security delta round on the final head (P1/P2/P4/P5 differential, record simulation, fresh evidence). The second merger of #42/#43 needs a merge-only or delta round against §7.
- **Reversibility.** High.

## 11. Verdict

| Item | Result |
|---|---|
| Critical / High | 0 |
| Medium | 1 open: PR44-SEC-01 (pre-existing, routed with due point) |
| Low | 4 open: PR44-SEC-02, -03, -04 (fix cycle / first consumer), -05 (020-D) |
| Info | 4 open: PR44-SEC-06..09 |
| Regressions introduced by this PR | None found |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding is open at head `9def3f5`, and every closure claimed by the PR holds against its positive control. The MEDIUM and one LOW are pre-existing and routed with due points; the other LOW items coincide with code review findings that already require a fix cycle, after which a security delta round on the final head is required |

## Delta round 2 (fix cycles 1–2 + unions, head d943ef7)

| Field | Value |
|---|---|
| Round | Security delta round 2 after code review round 1 (`aae9ded`, CHANGES_REQUESTED) and the orchestrator rulings D-ORCH-069 (fix-cycle scope, the deadline is enforced) and D-ORCH-073 (testable entry point, no coverage exclusion). Decisions D-TASK020-62..77 (PR body), PR comments `#issuecomment-6874402969` (fix cycle 1) and `#issuecomment-6875213989` (fix cycle 2) |
| Head | d943ef7f1a9b9fa7ec4f9219018f0311a8d25deb |
| Code commit | `035687c1a361da36eee487eee6de757e7aee6681` (the last merge of `main`); `035687c..d943ef7` adds only the lane B run directory `20261114T0902Z_035687c` |
| Range reviewed | `9def3f5..d943ef7`. PR-own commits: `a45f189` (api: deadline, lifetime, afterCommit bound, `Retry-After`), `45542bd` (lint: `createRequire` confinement, `prisma-client-construction` scope, T-83 shapes and node sources), `542a111` (`start-api.ts`), `3a21efc` (RLS suite lane timeout), `d943ef7` (evidence); `b947c24` is the round-1 record. The four merges of `main` (`71dbb4f`, `443c2f1`, `a7caa87`, `035687c`) are pure: each commit tree equals `git merge-tree --write-tree` of its two parents. Merge base with `main`: `e21b9dd`. `main`'s tip when this round was written is `bd67d66` (`48f50e0` plus the code review round 2 record); it adds `docs/**` and `.claude/agent-memory/**` only |
| Lane A evidence | Run [43580008698](https://github.com/sukhchdit/shipcube/actions/runs/43580008698) on `d943ef7`: `fast-lane` **success** with every step executed (lane B evidence, install, licences, signatures, audit, lint, format, type-check, unit, base-ref negative fixtures, build, tree-mutation checks). `scans`: Gitleaks, Semgrep and oasdiff pass; the only failed step is "Security-owned paths need a review record" (the record named `9def3f5`), and `ci-gate` fails for that reason alone |
| Lane B evidence | `docs/05-quality/tests/runs/20261114T0902Z_035687c`, profile `pr`, verdict PASS: api 124, catalog-c1-c14 102, integration 296 (1 skip), unit 4739 (2 skip). `git_sha` `035687c`, `git_dirty` false, `build_clean` true. `lockfile_sha256` and `manifest_sha256` equal the head's `package-lock.json` and `tools/quality/required-suites.json` (recomputed; both files equal `main`'s). Merged coverage 98.83 % lines / 96.45 % branches; `main.ts`, `start-api.ts`, `abortable.ts`, `after-commit.ts` and `classify.ts` 100/100, `execute.ts` 100/96.2. The untracked FAIL run `20261114T0742Z_3b0dd72` is not in the tree |
| Owned paths changed | 52 of the PR's 82 owned paths changed after `9def3f5` (the checker's owned set against `main` intersected with `git diff --no-renames 9def3f5 d943ef7`): `apps/api/src/platform/` errors 3, routing 2, runtime 1, tx 6; `eslint.config.mjs`; `tools/eslint-rules/**` 7; `tools/lint/**` 2; `tests/fixtures/lint/**` 29; `tests/generated/rls/cross-tenant.int.test.ts`. **Not owned:** `apps/api/src/{start-api,main,app}.ts` and their tests, `packages/shared/src/errors/app-error.ts` (read in full anyway, R2.6) |
| Reviewer / date | security-analyst, 2026-11-14, delta round 2. Read-only on code; no Docker. Git ran in the main checkout against commit SHAs; in the PR worktree only read-only `git log` / `git status` ran. ESLint ran in-process with the worktree's own `eslint.config.mjs` and `node_modules` on virtual paths (71 config, rule and source blobs checked equal to `d943ef7`), and on `git archive` extracts of `d943ef7` and `9def3f5` (the control). Run-time probes used type-stripped `git archive` extracts of both heads with a `node_modules` junction to the main checkout (removed afterwards). Outputs held verdicts, counts, key names and booleans only |

### R2.1 Summary

- **PR44-SEC-01 (MEDIUM) closed.** `createRequire` is legal only as `createRequire(<url>).resolve('<literal>')` (`platform/static-module-specifier`, messageId `loader`). `moduleSourceVisitor` uses `isRequireCall`. `platform/prisma-client-construction` now covers `apps/*/src/platform/db/**` except `client.ts`, `generated.ts` and `runtime.ts`, and reports whole-module loads and const aliases.
  - Probe P1 (the round-1 matrix, 103 cases): every target row now reports. That is F08-F11, F16 and F17 from the worker `platform/db`, a second api `platform/db` file and a module repository (18 rows), plus A04-A06, A08 and A11-A13. 52 rows moved toward refusal and none moved away. The controls are unchanged: `generated.ts` F01-F06 clean, the 17 test-file rows clean, F15 (`import type`) clean, A18 (`.resolve`) clean.
  - Probe P1b (47 new shapes, head vs `9def3f5`) reports the `loader` messageId on the head for:
    - a `node:module` import without the prefix;
    - `import()` destructured or as a member;
    - `process.getBuiltinModule('module').createRequire`, destructured too;
    - `Module.createRequire`;
    - a literal computed key;
    - `export default createRequire`;
    - `.cache`;
    - `.then(m => m.createRequire …)`;
    - a namespace passed on and then read;
    - `.mts`, worker and `packages/*` files.

    None of them carried it on `9def3f5`, where 13 of them were clean. A non-literal `.resolve(n)` reports, and the `.resolve` result passed to `import()` is refused as a computed specifier. In `platform/db` (D01-D11), a namespace, alias, destructured, `import()` or stored-loader construction from a second api file or from the worker reports on the head and was clean on `9def3f5`; the three homes stay clean. `process.mainModule.require('pg')` and `new Module(…).require('pg')` are `boundaries` findings on both heads. A `.cts` `require()` call is refused by `@typescript-eslint/no-require-imports` on both heads.
  - Three lint mutants (confinement off, visitor back to a bare `require`, `platform/db` scope reverted) each flip probe rows, so the probe sees the fix.
  - **Residuals:**
    - (a) a template-literal key (`` m[`createRequire`] ``, `` { [`createRequire`]: c } ``) gets no finding from any rule (PR44-SEC-10, LOW, = code review R2-m2; grep-visible);
    - (b) the stated `Module._load`, `Reflect.get`, `m[k]` and two-hop alias forms, plus the built-in loaders of PR44-SEC-14 (INFO);
    - (c) any read of an `import x = …` binding crashes the rule (PR44-SEC-11, INFO, fail-closed).
- **PR44-SEC-02 (LOW) closed.** The request lifetime starts at slot entry; a closed response aborts at once; `throwIfAborted` runs before `call`. `call` and the stream are raced with `abortable()`, and the reason is a 503 `AppError` with `retryAfterSeconds: 1`. Probe P4, head vs `9def3f5`:
  - **A (client gone during a 400 ms `load`):** `call` never runs and there is no write transaction (`begin:ro, commit` only). On `9def3f5`, `call` ran and the handler committed.
  - **B (a `call` that ignores its signal and never settles, deadline 300 ms):** 503 with `Retry-After: 1` after 319 ms, then the connection closes. On `9def3f5` there was no response within 2.5 s.
  - **C (a `call` that rethrows `signal.reason`):** 503 with `Retry-After: 1`; it was a 500 on `9def3f5`.
  - **E (a never-settling stream):** the response ends at the deadline; it hung on `9def3f5`.
  - **No leak:** in every case the body holds only `code, correlation_id, detail, instance, status, title, type`, with no cause text and no sentinel placed in the `call` closure or in a thrown message. The server log carries no sentinel either (D: an error from `call` with a sentinel message is a 500 with no leak, on both heads).
  - `Retry-After` comes only from an own integer data property in 1..3600 on a 503 `AppError`, and is never in the body.
  - **Pre-slot disconnect** (probe P4c: a pre-slot step held 400 ms, client gone at 100 ms): on the head `call` never runs and there is no write. With the `res.closed || res.destroyed` check removed (mutant), and on `9def3f5`, `call` runs and the write commits. The behaviour holds, but no test pins it (= code review R2-m1; test owed, R2.9).
- **PR44-SEC-03 (LOW) closed.** `AFTER_COMMIT_MAX_PENDING` is 1,000, with a value-free `api.after_commit_dropped` line. A per-work 20 s deadline is enforced by not waiting, and the work signal aborts at drain start. Probe P5:
  - 200,000 hung items give pending 1,000 and +4 MiB, with 199,000 drop lines whose keys are `route, operation, correlation_id, max_pending`. On `9def3f5` they gave pending 200,000 and +226 MiB.
  - A drain-start abort reaches a well-behaved item at once.
  - **Residual:** work abandoned at its deadline leaves the count while it keeps running (PR44-SEC-12, INFO).
- **PR44-SEC-04 (LOW) closed.** Probe P2 (93 cases) against the round-1 head output:
  - The 40 rows that were silent are now reported: S01-S04, K02-K04, F01-F03 and H03 in both the I/O and the sleep forms, X01-X08 and X13.
  - The 53 other rows are unchanged; `call` and `afterCommit` (C03/C04) stay clean.
  - P2b (23 more sources) reports on the head, all newly:
    - `node:timers` default import and `timers` namespace;
    - `globalThis.setInterval`;
    - `tls`, `dgram`, `dns/promises` and `child_process` without the prefix;
    - a dynamic `import('node:net')`;
    - `globalThis.WebSocket`;
    - a template `import('node:http2')`;
    - nested spreads;
    - an unreadable spread without a handler;
    - `defineRoute` passed as a value.

    `tls`, `dgram`, `dns/promises`, `child_process`, both WebSocket forms and the template `import('node:http2')` also report under `outbound-http-via-client`. Pure `net` helpers stay clean.
  - **Still silent:**
    - as the rule header now states: H08/H09, X09/X10 (a `fetch` alias, which also passes the SSRF rule) and I02;
    - the code review's R2-n3 shapes (destructured methods, a holder alias in an enclosing factory);
    - the P2b rows `import { promises } from 'node:timers'`, a dynamic `import('node:timers/promises')` and `process.getBuiltinModule('node:timers/promises' | 'node:net')`.

    They are carried as INFO under PR44-SEC-04 (stated residuals) and PR44-SEC-14 (sources).
  - A **module-level** holder alias used inside a root crashes the T-83 rule (= code review R2-m3, reproduced here; the destructuring form is new in fix cycle 1). It fails closed: PR44-SEC-11.
- **`start-api.ts` (not owned, reviewed): sound.** The sequence equals the former `main.ts` in order and arguments. `main.ts` is pinned to exactly the two statements `import { raiseStartupError, startApi } …` and `startApi().catch(raiseStartupError)`, so production cannot pass overrides. Probe P6 (child processes, random sentinels):
  - **Errors after the handlers** (a services fault, an unmapped `createApp` error, a late unhandled rejection) give exactly one stdout line (`process.uncaught_exception` / `process.unhandled_rejection`) and exit 1, with nothing on stderr. A `password` property and a connection-string password are redacted; the free-text message is kept, as PR #20 designed.
  - **The real `loadRuntimeConfigOrExit`** over invalid values carrying sentinels exits 78 and names keys only, with no sentinel in either stream.
  - **A mapped `DocsSpecError`** exits 78 with one `api.docs_unavailable` line.
  - **A fault of the loader itself, before the handlers,** gets Node's default report, which is unredacted, exactly as the top-level-await entry did (D-TASK020-74). The control (no handlers) prints both sentinels.
  - **Probe P7 (real timers):** a listener that never closes exits 1 at 25,010 ms with force-close; a hung `afterCommit` item is abandoned at its 20 s deadline and the process exits 0 at 19,993 ms; a clean shutdown exits 0 at once.
- **New: PR44-SEC-13 (LOW, pre-existing since TASK-006).** After headers are sent, the problem handler passes a thrown `AppError` itself to Express's final handler. Express 5.3.0 `logerror` then prints it with `console.error(err)`: unredacted, including the server-only `cause`. Probe P4b: a sentinel in a stream's `AppError` cause reaches stderr on both heads, and a plain `Error` does not. The slot's own deadline reason carries fixed text only. The path is reachable through this PR's stream hook (TASK-044).
- **No coverage gate weakened (D-ORCH-073).**
  - No change to `jest.config*`, `tools/ci/**`, `tools/quality/**`, `package.json` or any CODEOWNERS/Gitleaks/Semgrep file in the PR's diff against `main`.
  - No added `istanbul`/`c8`/`v8` ignore, `coveragePathIgnorePatterns`, `coverageThreshold`, `eslint-disable`, `@ts-ignore`/`@ts-expect-error`/`@ts-nocheck`, `.skip(`/`.only(`/`xit(` in the added code lines (0 in each of the four PR-own commits).
  - The diff-coverage cases for `main.ts` and `start-api.ts` pass through executed tests (14/14).
- **Unions pure; D-ARCH-106 (6) intact.** `3a21efc` replaces the RLS suite's `DB_TX_IDLE_IN_TRANSACTION_TIMEOUT_MS: 15_000` with the imported `TEST_LANE_TX_IDLE_TIMEOUT_MS`. The constant is still 1,000, and the ratchet `tools/repo/test-lane-idle-timeout.test.ts` and `runtime-twin.ts` are byte-identical to `9def3f5`, with no exemption. The suite's 126/126 on PostgreSQL 18 is the developer's run; it was not re-run here (no Docker).
- **Evidence hygiene: accepted.**
  - The fix-cycle-2 gate table carries the D-SEC-PR23-02 statements verbatim: "`npm ci --ignore-scripts` + `npm run deps:rebuild` ran first" and "`.git/info/exclude` is empty" (0 bytes).
  - The run is profile `pr`, and there is no lockfile change.
  - The count-only host-fragment scan finds 0 in the new run directory (7 files, 9,755 lines), in the PR's 5,474 added code lines against `main` and in its commit messages; the synthetic control fired.

**Round 2 result: 0 Critical/High/Medium.** Open:
- **LOW:** PR44-SEC-05 (pre-existing, 020-D), new PR44-SEC-10 (020-D) and new PR44-SEC-13 (pre-existing, before TASK-044).
- **INFO:** PR44-SEC-04 (stated residuals), -06, -07, -08 (widened), -09, and new -11, -12, -14.

The code review round 2 twin (`bd67d66` on `main`, APPROVED_WITH_NITS) was read before finalising. Its R2-m1, R2-m2 and R2-m3 are reproduced here and rated: R2-m1 is a test owed; R2-m2 = PR44-SEC-10, LOW, so 020-D, not this PR; R2-m3 is in PR44-SEC-11. Its R2-n1..n3 are folded into PR44-SEC-12 and -14.

**Verdict: PASS_WITH_FOLLOW-UPS** (R2.12).

### R2.2 Method

| Probe | How |
|---|---|
| P1 / P1b `createRequire` and value importers | Round-1 `cases-l.mjs` (103) on the worktree config, diffed against the recorded `9def3f5` output; `cases-n.mjs` (47: N01-N33 loader shapes, D01-D11 `platform/db` construction, C01-C03 controls) on the worktree and on extracts of `d943ef7` and `9def3f5` (the extract cannot resolve `@platform/*` targets for `boundaries`, so `boundaries` rows were read from the worktree run). Three mutants on a `d943ef7` extract |
| P2 / P2b T-83 and SSRF sources | Round-1 `cases-t.mjs` (55) and `cases-t2.mjs` (38, queue and sleep sources so the SSRF rule cannot mask T-83) diffed against the recorded `9def3f5` output; `cases-t3.mjs` (23) on the head and on the `9def3f5` extract |
| P3 walk and credential headers | `define-route.ts` changed only in the `AfterCommitContext` type and the walk's leaf set (`Joi.isExpression`) and refusal text; the credential-header code is byte-identical to `9def3f5`, so the round-1 matrix stands. Joi 18.3.2: a template's `functions` option runs during validation, the same capability as `.custom()`, which the walk already accepts (PR44-SEC-06 reasoning); D-TASK020-72 accepted |
| P4 / P4b / P4c request lifetime | Real `executeSlot` + real `problemHandler` + Express 5, a recording fake runner and a raw-socket client (scenarios A-F above); P4b a stream `AppError` with a sentinel `cause` after headers, `console.error` captured, Express `env` `production`; P4c a pre-slot step held while the client leaves, on the head, on a mutant without the `res.closed` check and on `9def3f5` |
| P5 `afterCommit` queue | Real `createAfterCommitQueue`: 200,000 hung items with `--expose-gc`; cap 100 / deadline 50 ms with work that ignores its signal and holds a timer; a drain-start abort |
| P6 / P7 `start-api.ts` | P6: `child-start.mjs` runs the head's real `startApi(overrides).catch(raiseStartupError)` in a child per scenario (K0 control, K1 real configuration loader, K2-K6), with a resolve hook for `@platform/*` and the generated client. P7: three real-timer shutdowns in one process with injected process events, listener and exit |
| P8 lint robustness | `import x = require(…)` / `import x = NS.y` reads in `apps/*/src` on both heads (crash scope); the code review's module-level holder alias (R2-m3) on both heads |
| P9 hygiene and records | Count-only host-fragment scan; Gitleaks v8.30.1 default-rule emulation over this section; record simulation (R2.10) with `main`'s real `check-security-owned-paths.mjs` and `check-evidence.mjs` |
| Cross-check | Code review round 2 (`bd67d66` on `main`, APPROVED_WITH_NITS: R2-m1..m3, R2-n1..n4), read before finalising; overlapping IDs cited with the security rating |

### R2.3 Findings opened this round

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR44-SEC-10 | A no-substitution template-literal key (`` m[`createRequire`] ``, `` { [`createRequire`]: c } ``) escapes the `createRequire` confinement: the generated client, `pg` or the audit writer load with no finding from any rule (= code review R2-m2) | LOW | CWE-693 | A01 | `tools/eslint-rules/module-sources.mjs:94-99` (`isCreateRequire`: `Literal` keys only), `static-module-specifier.mjs:34-35` (`isCreateRequireKey`); `eslint.config.mjs` policy comment ("every form") | senior-developer, 020-D (`lint` lock), before 020-D merges and before the first module or worker-job code PR; until then code review greps `createRequire` |
| PR44-SEC-11 | Two lint crashes that fail closed: `static-module-specifier` on any read of an `import x = …` binding (new in this PR), and the T-83 rule on a module-level holder alias (= code review R2-m3; the plain alias already crashed at `9def3f5`, the destructuring form is new) | INFO | CWE-754 | A04 | `tools/eslint-rules/module-sources.mjs:78-84` (`def.parent.source` assumed), reached from `static-module-specifier.mjs:121-129`; `no-external-calls-in-tenant-tx.mjs:244-250` (`enclosingFunction` stops at `undefined`, not `null`) | 020-D (two guards + fixtures) |
| PR44-SEC-12 | The deadlines bound the wait, not the work: abandoned `call`, stream and `afterCommit` work keeps running untracked, outside the 1,000 cap; one error line per dropped item | INFO | CWE-770 | A04 | `apps/api/src/platform/tx/abortable.ts:11-25`; `after-commit.ts:89-120`; `execute.ts:236` | TASK-113 (client timeouts and `ctx.signal`); performance-engineer with the first `afterCommit` route (TASK-083/091) |
| PR44-SEC-13 | After headers are sent, a thrown `AppError` reaches Express's final handler, which prints it unredacted to stderr with its server-only `cause` | LOW | CWE-532 | A09 | `apps/api/src/platform/errors/problem-handler.ts:138-142`; Express 5.3.0 `lib/application.js` `logerror` | senior-developer; before the first stream route (TASK-044), or the next `problem-handler.ts` touch |
| PR44-SEC-14 | Built-in loaders and sources outside every import control: `process.getBuiltinModule('<built-in>')`; `Module` / `register` from `node:module`; T-83 misses `import { promises } from 'node:timers'`, a dynamic `import('node:timers/promises')`, destructured holder methods and a factory-scope holder alias (code review R2-n3) | INFO | CWE-693 | A10 | no rule for `process.getBuiltinModule`; `no-external-calls-in-tenant-tx.mjs:114, 734-770`; `outbound-http-via-client.mjs:13, 33` | 020-D (`lint` lock); the SSRF source list with TASK-113 |

### R2.4 Finding details

#### PR44-SEC-10 (LOW): a template-literal key escapes the `createRequire` confinement (= code review R2-m2)

**What (probe P1b N09/N10, module service; the code review reproduced it from `apps/worker/src/platform/db` as p9/p15).** `` m[`createRequire`](import.meta.url)('pg') `` and `` const { [`createRequire`]: c } = m; c(u)('pg') `` get no finding from any rule on the head (nor on `9def3f5`). `isCreateRequire` (`module-sources.mjs:94-99`) and `isCreateRequireKey` (`static-module-specifier.mjs:34-35`) accept a `Literal` key, but not a no-substitution template literal, which `staticSpecifier` treats as static everywhere else. With the loader unseen, `isRequireCall` does not see the load either, so `prisma-client-construction`, `audit-writer-allowlist` and `node-path-only` stay silent.

**Impact and rating.** The impact is the round-1 impact of PR44-SEC-01: a second Prisma or `pg` client opens connections outside `withTenantTx`, which defeats RLS. But the likelihood is below the round-1 shapes:
- The form is a deliberate respelling of a refused one; nobody writes it by accident.
- It still spells `createRequire`, so the interim review grep finds it.
- The worker's `platform/db` is CODEOWNED.

Rated LOW rather than MEDIUM, and therefore 020-D rather than another fix cycle of this PR. It is above the INFO of the other stated residuals because the fix claims every form and misses a two-character variant of one it covers.

**Remediation.**
- Run computed keys through `staticSpecifier(property)` in both predicates.
- Better, fail closed: report any computed member access on a `node:module` binding or on a `getBuiltinModule(…)` result whose key is not a static string other than `createRequire`. This also closes the documented `m[k]` residual.
- One fixture per form (call, destructure), with `negative-fixtures` rows and a mutant.
- Correct the `eslint.config.mjs` comment.

**Due.** With 020-D, before it merges, and before the first `apps/*/src/modules/**` or worker-job code PR. Until then, code review greps `createRequire` on every module or worker PR.

#### PR44-SEC-11 (INFO): two lint crashes that fail closed

**What.**
- **(a) `import x = …` reads (new in this PR).** `nodeModuleImport` (`module-sources.mjs:78-84`) reads `def.parent.source.value` for every `ImportBinding` definition. typescript-eslint gives a `TSImportEqualsDeclaration` an `ImportBinding` whose parent has no `source`.
  - On the head, any read of such a binding in non-test `apps/*/src` or `packages/*/src` throws "Cannot read properties of undefined (reading 'value')" in `platform/static-module-specifier`. That includes `import pg = require('pg')` in `.ts` or `.cts`, and `import X = NS.y` (probe P8 E01, N18/N19/N21/N22).
  - On `9def3f5` the same files linted with findings (`no-require-imports`, `boundaries`, `no-namespace`).
- **(b) A module-level holder alias** (`const q = deps.queue;` or `const { queue: q } = deps;` at module scope, used in a handler) throws "Cannot read properties of null (reading 'type')" in the T-83 rule. This is code review R2-m3, reproduced: on `9def3f5` the plain alias already crashed, and the destructuring form is new here.

**Impact.** ESLint aborts, so `npm run lint` and lane A fail. Nothing passes silently. The cost is a confusing failure and a lost finding list for the run.

**Remediation.**
- In `nodeModuleImport`, return `undefined` unless `def.parent?.type === 'ImportDeclaration'`. Optionally, treat a `TSImportEqualsDeclaration` with a `TSExternalModuleReference` as a require-style load in `moduleSourceVisitor`.
- In `enclosingFunction`, stop at `null` as well as `undefined` (R2-m3).
- Add a fixture for each shape.

#### PR44-SEC-14 (INFO): built-in loaders and sources outside every import control

**What (probe P1b, P2b; lint-clean on both heads).**
- `process.getBuiltinModule('node:http').get(…)`, `('node:child_process')`, `('node:net')` and `('node:timers/promises')` load built-ins that no import control sees. They pass `node-path-only`, T-83 and `outbound-http-via-client`.
- From `node:module`, `import { Module, register }`: `Module._load` is a stated residual, and `register()` installs a resolve hook.
- T-83 also misses:
  - `import { promises as tp } from 'node:timers'`;
  - `await import('node:timers/promises')`;
  - destructured holder methods and a factory-scope holder alias (code review R2-n3).

**Impact.** Each shape is deliberate or uncommon. Built-ins give no Prisma, `pg` or audit-writer client, so RLS is not reached. What they reach is the SSRF and T-83 controls: egress, child processes, and sleeps held inside the transaction. The runtime twin covers any of them that a test drives. INFO, the class of PR44-SEC-09.

**Remediation.**
- `no-restricted-properties` for `process.getBuiltinModule`, `process.binding` and `process.dlopen` in `apps/*/src` and `packages/*/src`.
- `no-restricted-imports` for `node:module` / `module` with `allowImportNames: ['createRequire']`. This closes `Module`, `register` and the namespace or default import.
- Add `promises` from `node:timers` and a literal `import()` of the timer modules to the T-83 timer forms.
- If ADR-0005 am. 11 item 22 (d) is revisited, add the R2-n3 shapes.
- One fixture each.

#### PR44-SEC-12 (INFO): the deadlines bound the wait, not the work

**What.**
- `abortable()` stops waiting. The `call`, stream or `afterCommit` work that ignored its signal keeps running, and its outcome is consumed.
- In the queue, `inFlight` drops an item at its deadline. Probe P5 (cap 100, deadline 50 ms, five rounds of 100 items that ignore the signal and hold a timer) ends with pending 0, 500 items still running and 500 `AfterCommitDeadlineError` lines.
- Each dropped item logs one error line: 199,000 lines for 199,000 drops.

**Impact.** Only work that ignores `ctx.signal` and has no timeout of its own accumulates. That is an outbound client without the ADR-0011 timeouts, or code that sleeps. So the real bound is the client layer. No route declares `afterCommit` or `call` today.

The code review's R2-n1 (timer clean-up unpinned) and R2-n2 (`call` plus `afterCommit` can exceed the 25 s drain; force-close still bounds it, which P7 D1 confirms) belong to the same class.

**Remediation.**
- TASK-113: every outbound client takes `ctx.signal` and has its own total timeout, below `CALL_DEADLINE_MS` and `AFTER_COMMIT_DEADLINE_MS`, with a test.
- Optionally keep abandoned `afterCommit` work counted, as an `abandoned` gauge toward the cap or a metric.
- Aggregate the drop log (first drop, then a counter per interval) before the first public `afterCommit` route.
- Optionally pin the timer clean-up (R2-n1).

#### PR44-SEC-13 (LOW): an `AppError` cause reaches stderr after headers are sent

**What.** `problem-handler.ts:138-142`:
- When `res.headersSent`, it calls `next(appError ?? new AppError('INTERNAL_ERROR'))`. The comment says the final handler gets a code-only `AppError`, "never the thrown value".
- That holds for non-`AppError` values only. For an `AppError` it is the thrown object.
- Express 5.3.0's `logerror` runs `console.error(err)` outside `env === 'test'`. That is `util.inspect`, with every own property and the `[cause]` chain, and it bypasses the Pino redaction of PR #20.

Probe P4b (Express `env` `production`): a stream that writes one chunk and throws `new AppError('INTERNAL_ERROR', { cause: new Error(<sentinel>) })` puts the sentinel on stderr on `d943ef7` and on `9def3f5`. A plain `Error` with the sentinel in its message does not.

**Impact.**
- `AppErrorOptions.cause` is documented "for the server log only". A service that wraps a carrier or gateway error, whose inspected form can include response data, gets it printed unredacted.
- Reachable only after headers are sent, that is, from the stream hook (TASK-044 SSE).
- The slot's own deadline reason carries the fixed text "request deadline exceeded" / "client closed the request".
- Impact medium (the "no secrets or PII in logs" guardrail); likelihood low; LOW. Pre-existing since TASK-006.

**Remediation.**
- `next(new AppError(appError?.code ?? 'INTERNAL_ERROR'))`: code-only, as the comment promises.
- A test with a stream that throws an `AppError` carrying a sentinel cause after the first chunk asserts that `console.error` never receives the sentinel and that the connection is destroyed.

### R2.5 Round-1 findings

| ID | Status at `d943ef7` |
|---|---|
| PR44-SEC-01 (MEDIUM) | **Closed** (P1, P1b, mutants) for every round-1 form. Residuals: PR44-SEC-10 (template key, LOW), the stated `Module._load` / `Reflect.get` / computed / two-hop forms, PR44-SEC-14. A `platform/db` file other than the three homes can still re-export the generated module whole (`export * from './generated.js'`, D04/D06). Every consumer that names `PrismaClient` is reported, though, and `apps/api/src/platform/**` is CODEOWNED |
| PR44-SEC-02 (LOW) | **Closed** (P4 A-F, P4c). The pre-slot guard is not pinned by a test (= code review R2-m1, test owed, R2.9). Residual PR44-SEC-12 |
| PR44-SEC-03 (LOW) | **Closed** (P5). Residual PR44-SEC-12; performance-engineer sizes the cap with TASK-083/091 |
| PR44-SEC-04 (LOW) | **Closed** for every named row. The rule header's stated residuals (H08/H09, X09/X10, I02) stay **open as INFO**. X09/X10 (a `fetch` alias) also pass `outbound-http-via-client` → TASK-113. The source residuals are PR44-SEC-14 |
| PR44-SEC-05 (LOW) | Open, unchanged, 020-D with D-ARCH-124 (D-ORCH-069) |
| PR44-SEC-06 (INFO) | Open (no change to the rule-argument walk); D-TASK020-72 templates as leaves accepted (P3) |
| PR44-SEC-07 (INFO) | Open: `afterCommit` now gets `{ ...request, signal }`, still with `input.headers` |
| PR44-SEC-08 (INFO) | Open and **widened**: `apps/api/src/start-api.ts` (process error handlers, shutdown, exit 78) and `main.ts` / `app.ts` are outside CODEOWNERS; sim S8 below. Add `/apps/api/src/start-api.ts`, `/apps/api/src/main.ts`, `/apps/api/src/app.ts` (and the worker entry) with 015-C |
| PR44-SEC-09 (INFO) | Open (E05-E08 unchanged) |
| Code review R1-M1, R1-m1..m6, R1-n1..n4, R1-n8 | Security concurs with the fixes as probed above; R1-n5 → TASK-044, R1-n6 → 020-D, R1-n7 → TASK-033 |

### R2.6 `start-api.ts`, `main.ts` and `app-error.ts`

- **Order and text.** `startApi` matches `443c2f1:apps/api/src/main.ts` statement for statement. The steps run in this order:
  1. `loadConfig('api')`, then the redacted runtime log.
  2. `exitAfterFlush`, then `installProcessErrorHandlers({ log, exit, source })`.
  3. `createRuntimeServices`, docs, health and the one `afterCommit` queue.
  4. `createApp`; exit 78 for `DocsSpecError` and the mapped refusals; any other error is rethrown.
  5. `await services.startup()`, `listen`, the error listener and `createShutdown`, whose `drain` is `try { server.close } finally { afterCommit.drain() }`.
  6. `once` for SIGTERM and SIGINT.
- **Seams.** The `API_PROCESS` defaults are the real process. `main.ts` is pinned to exactly its two statements, so no override reaches production. No top-level await remains.
- **`raiseStartupError`** re-raises on a microtask. After the handlers, the result is one redacted fatal line and exit 1 (P6 K3). Before them, it is Node's default report (P6 K5), which equals the former entry point and is reachable only by a fault of the loader itself. The real loader exits 78 by itself for every validation, holder or secret refusal, naming keys only (K1).
- **Shutdown** stays inside the 25 s `DRAIN_TIMEOUT_MS` (P7). `process-errors.ts`, `shutdown.ts`, `services.ts`, `log.ts` and `packages/config` are unchanged against `main`.
- **`AppError.retryAfterSeconds`** is an own property only when given (`declare`), is never serialised (`toJSON` unchanged) and is honoured only on a 503 within 1..3600.

### R2.7 Coverage gate (D-ORCH-073)

The ruling holds as written: no exclusion, waiver, ignore pattern, ignore comment or threshold change (R2.1). The gate passes because `main.ts` lost its top-level await and both files run under executed tests, which the PR's 17 killed mutants and 100/100 coverage confirm. The worker's `main.ts` keeps top-level await; per D-ORCH-073, any PR that changes it, PR #39 included, gets the same pattern.

### R2.8 Unions (replaces §7 for the second merger)

`git merge-tree` of `d943ef7` with PR #42 at `d611fda` conflicts only in `tools/lint/negative-fixtures.test.ts`; `with-tenant-tx.ts`, `db/index.ts` and `eslint.config.mjs` auto-merge. With PR #39 at `7dd3c64`, it conflicts in `apps/api/src/main.ts` (and in `tools/ci/check-workflow-policy*`, which arrived through `main`, not from this PR). In the record simulation, both unions void this record (S9, S10), so the second merger needs a merge-only or delta security round against this list.

**PR #42 (TASK-025, fix cycle 2 in flight).**
1. **Negative-fixture rows.** `tools/lint/negative-fixtures.test.ts` keeps all three row sets:
   - PR #43's, already in both branches;
   - this PR's 29 fixture paths (`createRequire`, `prisma-client-construction`, T-83 shapes and node sources, `outbound-http-via-client` network and server controls, `system-model-owner` loader rows);
   - PR #42's (`audit-writer` fixtures and the fix-cycle-2 R2-M1 import, re-export and `import()` negatives plus its positive).

   `tools/lint/lint-fixtures.mjs` lists every fixture once, and the base-ref negative-fixture step in lane A must pass on the union. A dropped row silently stops testing its fixture.
2. **Transaction body order.** Inside the one `$transaction` callback in `with-tenant-tx.ts`, the order stays:
   1. the context statement;
   2. the leak check;
   3. `SET TRANSACTION READ ONLY` when `readOnly`;
   4. `createTenantDb`;
   5. `fn`;
   6. the fix-cycle-2 `handle.settle()` (PR42-SEC-13);
   7. the `rollbackOnly()` latch;
   8. return, with `revoke` in `finally`.

   This closure is the one that `admission.run(admissionKeyOf(…), transaction)` wraps, and every wrapper keeps the third `call` parameter.
3. **`markRollbackOnly` pin.** `TenantDb` exposes `markRollbackOnly` (PR42-SEC-02), and the read-only `load` handle gets it too. A latched failure in `load` rolls that transaction back before `call`, which is fail-closed.
   - The exact `Reflect.ownKeys` pins in `tenant-db.test.ts` and `system-db.test.ts` stay exact.
   - `load`'s context gains no wider handle.
   - If `track`/`settle` changes the `TenantDb` surface, the union's evidence must carry `route-phases.int.test.ts` 5/5 (25006 and the access-mode case).
4. **Stand-in reason.** `execute-phases.test.ts` switches it from `TRANSACTION_UNAVAILABLE` to `TENANT_CONCURRENCY_LIMIT` (D-TASK020-54). The cap-of-one test and its control stay.
5. **Per-phase permit.** Each `withTenantTx` takes and releases its own permit: one for `load`, one for `handler`, none across `call`, the stream or `afterCommit`. A union that moves admission around the slot's `run(…)` would hold a permit across `call`, and must be refused.
6. **`eslint.config.mjs`.** This PR's `PRISMA_CLIENT_HOMES` scope, the `loader` confinement comment block, `PRISMA_GENERATED_VALUE_CODE` and the `no-eval` block stay. PR #42's `AuditSqlPort` handle type in the T-83 options, its store exemptions and the fix-cycle-2 boundaries policy for `apps/api/src/platform/audit/**` stay. In the union tree no value use of `PrismaClient`, `PrismaPg` or `@prisma/adapter-pg` exists outside the three homes, so the widened `prisma-client-construction` scope adds no finding to PR #42's files.
7. **Lane timeout.** `TEST_LANE_TX_IDLE_TIMEOUT_MS` (1,000) stays valid under PR #42's config guards. `tenant-admission.int.test.ts` does not compose `createApp`.

**PR #39 (TASK-014).**
1. **`createOrExitOnConfigError` moves into `start-api.ts`.** The call becomes:

   ```ts
   const services = await createOrExitOnConfigError(() => deps.createRuntimeServices(config, 'api', log, secrets), { log, exit });
   ```

   It stays after `installProcessErrorHandlers`, so other errors still reach the redacted fatal handler, and `exit` stays the flushing exit built from `deps.exitProcess`.
   - `main.ts` stays the two pinned statements.
   - The `entry-points.test.ts` pins follow.
   - New `start-api.test.ts` cases cover `DatabaseConfigError`: one `runtime.config_rejected` line naming `DATABASE_URL` and no value, exit 78, and no listener or signal handler. They also cover `TenantTxConfigError` naming its variable.
2. **Worker entry.** PR #39 also changes `apps/worker/src/main.ts`, so D-ORCH-073's pattern (`startWorker` plus executed tests) is due in PR #39. Otherwise the diff-coverage case fails there.
3. **`TenantTxConfigError`.** `TenantTxConfigError(message, variable)` coexists with `TenantTxCallOptions`.
4. **Image prune.** PR39-SEC-01 (C1): the prune also drops the new `dist/main.test.js` and `dist/start-api.test.js` along with `dist/**/tx/tests/**` and `routing/tests/**`.

**PR #43, #40, #45 (merged).** The only union-forced change was `3a21efc`, which is pure, as checked above. Diff coverage passes for the new entry files without any change to `tools/ci/diff-coverage.mjs`.

### R2.9 Checks owed (routed)

| Where | Check |
|---|---|
| 020-D (`lint` lock), or this PR if a further fix cycle happens anyway | PR44-SEC-10 (LOW, = R2-m2: template key, fail-closed computed keys, fixtures, mutant) before 020-D merges and before the first module or worker-job code PR; PR44-SEC-11 (two guards + fixtures, = R2-m3); the pre-slot disconnect test (= R2-m1: `call` never runs, no `begin:rw`, with a mutant that removes the `res.closed` check); PR44-SEC-05 (unchanged); PR44-SEC-14; PR44-SEC-09; PR44-SEC-04 stated residuals where cheap |
| Code review, every module or worker PR until 020-D merges | Grep `createRequire` (PR44-SEC-10 interim control) |
| TASK-113 | PR44-SEC-12: every outbound client honours `ctx.signal` and has a total timeout below the 20 s deadlines (with a test); `fetch` aliases (X09/X10) and the `getBuiltinModule` egress forms in `outbound-http-via-client` (PR44-SEC-14) |
| TASK-044 (first stream route) | PR44-SEC-13 fixed before merge; stream duration and backpressure (R1-n5) |
| First `afterCommit` route (TASK-083/091) | Cap sized by performance-engineer; aggregated drop log (PR44-SEC-12); PR44-SEC-07 |
| devops-engineer 015-C | PR44-SEC-08 widened (`start-api.ts`, `main.ts`, `app.ts`, worker entry) |
| Second merger of #42 or #39 | R2.8 list; merge-only or delta security round; fresh lane-B evidence |
| principal-architect (SHEET-FOLD-8) | ADR-0003 am. 2026-11-14 item 2 and ADR-0005 am. 11 item 22 wording for `createRequire` (D-ORCH-069), now matching `static-module-specifier`'s `loader` arm |

### R2.10 Record simulation and secret hygiene

**Record simulation** (sparse `git clone --shared`; plumbing scenario commits on `d943ef7`; the real `tools/ci/check-security-owned-paths.mjs` of `main` at `bd67d66`; base = that tip unless stated): 16 of 16 scenarios as expected.

| Scenario | Base -> head | Expected | Result |
|---|---|---|---|
| S0 round-1 record only (unchanged) | `main` -> `d943ef7` + that record | missing | missing (it names `9def3f5`; 52 owned paths changed after it) |
| S1 this record on the head | `main` -> record commit | pass | **pass**: owned 82, satisfied by `d943ef7`; one note for the older `9def3f5` row |
| S1-mb | merge base `e21b9dd` -> record commit | pass | pass |
| S2 wrong PR number (`--pr 42`) | `main` -> record commit | missing | missing |
| S3 / S3b owned edit after the record (`execute.ts` / `eslint.config.mjs`) | `main` -> edit | missing | missing / missing |
| S4 docs-only evidence after the record | `main` -> evidence | pass | pass |
| S5 merge of the current `main` (`bd67d66`) | `main` -> merge | pass | pass |
| S5b a `main` that also edits `eslint.config.mjs`, then the merge | that `main` -> merge | missing | missing |
| S6 the same record with a FAIL final verdict | `main` -> record commit | missing | missing |
| S7 the new head row naming a SHA outside the range | `main` -> record commit | missing | missing |
| S8 / S8b un-owned edit after the record (`start-api.ts` / `app-error.ts`) | `main` -> edit | pass | pass / pass (PR44-SEC-08) |
| S9 union with a simulated squash of PR #42 (`d611fda`) | that `main` -> union | missing | missing (R2.8) |
| S10 union with a simulated squash of PR #39 (`7dd3c64`) | that `main` -> union | missing | missing (R2.8) |
| S11 this round without its own final verdict row | `main` -> record commit | pass | pass: the round-1 verdict row is then the last one (procedural, PR10-SEC-04); this round ends with its own row |

**`main`'s base-ref `check-evidence.mjs` against `d943ef7`:** PASS with both base-ref copies, the `main` tip `bd67d66` and the merge base `e21b9dd`. Each accepts `20261114T0902Z_035687c` with 0 problems and rejects `20261114T0516Z_e43ccff` and `20261114T0455Z_79b9616` as stale. On the S5 merge of `bd67d66` the same verifier still accepts the run: `.claude/agent-memory/*/*.md` is in its staleness allow-list (`AGENT_MEMORY_GLOB`). So the code review's merge condition 2 ("merging that main would stale the evidence") is stricter than the gate, though harmless. A merge that brings non-docs paths still stales it.

**Gitleaks emulation over this section:** 0 findings (222 rules, 221 compiled; the three run-time positive controls, a GitHub token, an AWS key id and a generic API key, fired). **Host-fragment scan of this record:** 0 (all needles, over the whole record with this section; the synthetic control fired). No secret, credential value or OS user name is quoted; the probe outputs held booleans, counts, key names and rule IDs only, and the sentinels were random per run and never written here.

### R2.11 Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

**D-SEC-PR44-02 · 2026-11-14 · security-analyst (logged by orchestrator) · PR #44 (020-C) security delta round 2.**
- **Decision.** PR #44 at `d943ef7` (code `035687c`): **PASS_WITH_FOLLOW-UPS**. There are 0 Critical/High/Medium findings; 3 LOW and 8 INFO are open.
- **Closed (each against `9def3f5` as the control):**
  - **PR44-SEC-01 (MEDIUM):** `createRequire` is confined to `.resolve('<literal>')`, the visitor uses `isRequireCall`, and `prisma-client-construction` covers `platform/db` except the three homes. In P1, 52 of 103 rows moved toward refusal, every target row reports and the controls are unchanged. 47 new shapes were probed, and 3 mutants were killed.
  - **PR44-SEC-02:** a client gone before or during `load` means no `call` and no write. A deadline answers 503 with `Retry-After: 1` and no body leak; it was a hang on the old head. The pre-slot test is owed (= code R2-m1).
  - **PR44-SEC-03:** the queue holds 1,000 pending and uses +4 MiB under 200k items; it was +226 MiB.
  - **PR44-SEC-04:** 40 rows newly reported; the stated residuals are carried as INFO.
- **New:**
  - **PR44-SEC-10 (LOW, = code R2-m2).** A no-substitution template-literal key (`` m[`createRequire`] ``) escapes the confinement with zero findings. Rated LOW, not above: deliberate respelling, grep-visible, worker `platform/db` CODEOWNED. So **020-D, not a third fix cycle.** Due before 020-D merges and before the first module or worker-job code PR; code review greps `createRequire` until then.
  - **PR44-SEC-13 (LOW, pre-existing since TASK-006).** After headers are sent, a thrown `AppError` with its server-only `cause` reaches Express's unredacted `console.error`. Fix with a code-only `AppError` passed to `next` before TASK-044.
  - **PR44-SEC-11 (INFO).** Two lint crashes that fail closed: `import x = …` reads (this PR) and a module-level holder alias in T-83 (= code R2-m3) → 020-D guards.
  - **PR44-SEC-12 (INFO).** Abandoned `call`/stream/`afterCommit` work is outside the bounds, and there is one drop line per item (with code R2-n1/n2) → TASK-113 timeouts, and an aggregated log before the first `afterCommit` route.
  - **PR44-SEC-14 (INFO).** `process.getBuiltinModule` built-ins, `node:module` `Module`/`register`, two timers forms and code R2-n3 → 020-D, TASK-113.
  - **PR44-SEC-08 widened** to `start-api.ts`, `main.ts` and `app.ts` → 015-C.
- **`start-api.ts` accepted.** One redacted fatal line and exit 1 after the handlers; exit 78 with key names only from the real loader; the 25 s drain bound holds with real timers; the `main.ts` pin blocks overrides.
- **Accepted:** the D-ORCH-073 compliance (no gate weakened) and the RLS lane-timeout union (D-ARCH-106 (6) intact).
- **Evidence.** `20261114T0902Z_035687c` is accepted; the D-SEC-PR23-02 statements are verbatim; the host scan is 0.
- **Unions.** R2.8 replaces §7. PR #42 must keep all `negative-fixtures` rows, the transaction-body order including `settle`/`markRollbackOnly`, `TENANT_CONCURRENCY_LIMIT` and the per-phase permit. PR #39 re-applies `createOrExitOnConfigError` inside `start-api.ts` and applies the D-ORCH-073 pattern to the worker. The second merger needs a merge-only or delta round.
- **Reversibility.** High.

### R2.12 Verdict

| Item | Result at `d943ef7` |
|---|---|
| Critical / High | 0 |
| Medium | 0 (PR44-SEC-01 closed) |
| Low | 3 open: PR44-SEC-05 (pre-existing, 020-D), PR44-SEC-10 (residual of the 01 fix, 020-D, before the first module or worker-job code PR), PR44-SEC-13 (pre-existing, before TASK-044) |
| Info | 8 open: PR44-SEC-04 (stated residuals), -06, -07, -08 (widened), -09, -11, -12, -14 |
| Regressions introduced by this PR | PR44-SEC-11 (lint crashes that fail closed); no security regression |
| Coverage gate (D-ORCH-073) | Not weakened |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open at head `d943ef7`. The round-1 MEDIUM and the three fix-cycle LOW items are closed against `9def3f5` as the control. The three open LOW items are routed with due points: 020-D, before the first module or worker-job code PR, and before TASK-044. The second merger of PR #42 or PR #39 needs a merge-only or delta security round against R2.8 |
