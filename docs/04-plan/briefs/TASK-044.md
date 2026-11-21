# Dispatch brief: TASK-044, server-sent events convention (framing, heartbeats, Last-Event-ID, close semantics)

- **Plan fold / dispatch plan:** D-SD-005 (2026-11-20), batch 1.3. The card section below is copied verbatim from `docs/04-plan/tasks/WAVE-01.md`. If they differ, the generated card governs.
- **Branch:** `feat/TASK-044-server-sent-events-convention`, worktree `../Shipqube-TASK-044`, from `origin/main` at `530629f4`.
- **Builder and model:** senior-developer (lead), solo, opus (card: backend-developer · sonnet, complexity M). Host load allows at most two build agents host-wide, so no specialist is dispatched; the card's escalation rule (opus from fix cycle 2) applies to any re-dispatch.
- **Why now:** US-042 is demo-critical (DC). The convention feeds the quote result stream (TASK-091 `streamQuoteResults`), the booking progress stream and the web client's fetch-based reader. Merges wait on hosted-CI billing (D-ORCH-146), so the run builds ahead to a committed head ready for code review, security review and lane B.
- **Dependencies:** TASK-036 (merged). The stream hook of TASK-020 part 020-C (`RouteStream`, `RouteStreamSink`, `completeStream` in `execute.ts`) is on main, as the card requires.
- **Locks:** `api-sse`. Beside it in flight: TASK-041 (working rule 7 files), TASK-040 (PR #80: `apps/api/src/platform/idempotency/**`, `apps/api/src/platform/tx/execute.ts`, and `apps/api/src/platform/errors/problem-handler.ts`, see PR44-SEC-13 below), TASK-043 (outbox), TASK-045 (pagination). TASK-038 reshapes `packages/ui` (tokens and theme only).

## Read first

- US-042 Gherkin (`docs/01-requirements/stories/EPIC-16-api-conventions-security.md`, 8 scenarios) and rows AT-US-042-01..08 in `docs/05-quality/tests/gherkin-test-map.md` (suite `api`, lane B; -07 lists `rbac-matrix`).
- `docs/03-architecture/api/README.md` §9 (headers, framing, terminal events, 30 s cap, reconnect, caps, auth, privacy), §16 item 4 (`expectEventStream`: strictly increasing ids, names in `x-sse-events`, data valid against the referenced schema, ends with `complete` or `error`, end-to-close at most 1 s) and §17 (the in-house fetch + `ReadableStream` reader, no new dependency).
- `openapi.yaml`: `streamQuoteResults` and `streamBookingProgress` (`x-sse-events`, `x-error-codes`, `security`), `components/parameters/LastEventId` (`^[0-9]{1,10}$`), `components/headers/XAccelBuffering`, the `Sse*` schemas.
- ADR-0016 item 10 and amendments 3 (resume across replicas) and 9 (caps, subscribe-only streams); ADR-0003 amendment 2026-11-13 and D-ARCH-106 (4): the replay read is a short transaction and the body is completed after COMMIT through the stream hook.
- `apps/api/src/platform/tx/execute.ts` (`send`, `completeStream`, `requestLifetime`, `CALL_DEADLINE_MS`) and `apps/api/src/platform/routing/define-route.ts` (`RouteResult`, `RouteStream`) on main. Read only: both are held by other locks.
- PR44-SEC-13 in D-SEC-PR44-02 / D-ORCH-076 and the Express 5 final handler (`logerror` prints the whole error object with `console.error`, cause included, outside `env=test`).
- `tests/api/helpers/expect-contract.ts`, `contract-validator.ts` and `tests/api/declared-credentials.api.test.ts` (fixture routes standing in for contract operations on the real `createApp`).

## Scope notes (lead)

- **Module.** `apps/api/src/platform/sse/**`, self-contained: the framing (`id:`, `event:`, single-line JSON `data:`, `: heartbeat` comments), the response headers, a stream result builder that returns a `RouteResult` with the `stream` hook, the 15 s heartbeat, the 30 s cap, close after `complete` or `error`, cancellation of upstream work through an `AbortSignal`, Last-Event-ID parsing and its Joi header schema, and a privacy guard on event payloads. No route of its own: `streamQuoteResults` (TASK-091) and `streamBookingProgress` adopt it.
- **Locked files.** Do not edit `execute.ts` or `define-route.ts`. Where the convention needs a slot change (the 20 s request deadline ends a stream before its 30 s cap; `send()` replaces a private response's `Cache-Control`; the sink has no backpressure signal), record a decision and a follow-up for the lock holder, as TASK-045 did with its composition (D-TASK045-07).
- **PR44-SEC-13.** One line in `problem-handler.ts`: after headers are sent, pass a code-only `AppError` to `next()` (no cause, no detail, no errors). TASK-040 also edits this file (PR #80) in other lines; the change must stay a one-hunk union. Add a unit test: a route that writes, then throws an `AppError` with a server-only cause, under `env=production`, with a spy on `console.error`.
- **Replay.** The module takes the replayed events (read by the route in its `load` or handler transaction) and sends them first, after COMMIT; ids at or below the resume point or the last sent id are dropped, so replay and live events can overlap safely.
- **Client parser.** `packages/ui/src/sse/fetch-sse-parser.ts` per the card (api/README §17 names `packages/shared/src/api/sse.ts`; the card governs): a WHATWG-conformant incremental parser plus a `ReadableStream` reader, pure TypeScript, no React, no dependency.
- **No contract edit.** Contract or story mismatches go to api-designer or product-manager as open questions in the report.

## Acceptance (IDs in test titles)

- AT-US-042-01 … AT-US-042-08 over HTTP (suite `api`, lane B): fixture routes standing in for `streamQuoteResults` and `streamBookingProgress` on the real `createApp`; every response validated against the contract through the helpers; timing bounds through `timeOperation` (stall-corrected).
- PR44-SEC-13 unit test (suite `unit`).
- `expectEventStream` unit tests on seeded defects (non-increasing id, unknown event name, invalid data, missing terminal event, event after the terminal one, personal data).

## Tests and evidence

- Unit: framing, Last-Event-ID, privacy guard, the stream builder with fake timers (heartbeat at 15 s, cap at 30 s, close on terminal events, abort propagation, replay dedupe), the client parser, the helper; coverage of new files at least 85 % line and 75 % branch.
- Host: ESLint (`--max-warnings 0`), Prettier, `npm run typecheck`, unit Jest of the touched workspaces (`--runInBand`). The `*.api.test.ts` file compiles and runs only in lane B.

## `.env.example` lines this task may need

None expected: the convention's values (15 s, 30 s, 1 s) are contract constants, not configuration. `SSE_MAX_STREAMS_PER_IP` / `_PER_USER` belong to the stream caps of the route tasks.

## Working rules for this wave (apply to every brief of D-SD-005)

1. **Worktree and branch.** Work only in your own git worktree on the branch named above, created from the current `origin/main`. The main checkout is shared with other agents: never stash, reset or commit files you did not write, and never touch `.claude/agent-memory/**` of other agents.
2. **Node.** Every node or npm command starts with `export PATH="$APPDATA/fnm/aliases/default:$PATH";` (Node 24; Node 20 is rejected by `engine-strict`). Install with `npm ci --ignore-scripts`, then `npm run deps:rebuild`. Tools run through `npm exec --no --`, never `npx`.
3. **What you run on the host.** Lint, format check, typecheck, unit tests and the build of the workspaces you touch. Docker, Testcontainers, `quality:heavy` and the integration/api/catalog suites run only in the orchestrator's serial lane B queue (`../.orch/docker.lock`). Write the `*.int.test.ts` / `*.api.test.ts` files, make them compile, and ask the orchestrator for an **early lane B run on PostgreSQL 18** as soon as the migration and the first integration test exist. TASK-039 found a PostgreSQL 18-only failure (the C15 literal pin) on its first lane B run; finding such a failure on day 1 costs minutes, at review time it costs a fix cycle.
4. **Hand-written catalog literals.** Some catalog and manifest tests pin committed state as literals that a manifest change does not update. When you add a table:
   - `prisma/tests/catalog/c15-std-columns-guard.int.test.ts`: the `[SEC-TC-74] C15 (a) committed` test pins the sorted in-scope table list. If your manifest entry flags standard columns, extend that literal beside the manifest entry, with a comment naming your task, as TASK-037 and TASK-039 did.
   - `tools/db/grants-manifest.test.ts` pins counts of `prisma/sql/grants.manifest` lines: extend it together with the manifest.
   - `prisma/tests/catalog/tenant-keys.ts` and the C16 test, if the table carries an organisation key.
   - The classification registry, for every new column (catalog C10).
5. **api/README rows.** A new problem code goes into `docs/03-architecture/api/README.md` §11 and the error catalogue in the same PR: the parity test `tests/generated/error-catalogue.test.ts` compares both directions, and since TASK-292 it reads the §11 table too. A new security event goes into §13; SEC-TC-63 parses that table, so add a row and change no other cell. These code rows ride the PR (the D-API-003 pattern); api-designer acknowledges them at the next fold. Name each row you add in the PR body.
6. **`.env.example` is user-only.** Agents may not read or edit `.env*`. If you add a configuration key to `packages/config/src/schema.ts`, the parity test `tools/config/env-example-parity.test.ts` stays red until the user commits the placeholder line. Put the exact placeholder lines (key, placeholder value, one-line comment) in your Handoff Report under "`.env.example` lines needed". Prefer defaults in the schema, so that a missing line breaks only the parity test and not the run.
7. **Files owned by TASK-041 (in flight, slot 1).** Do not edit `apps/api/src/app.ts`, `apps/api/src/start-api.ts`, `apps/api/src/main.ts`, `apps/api/src/platform/routing/pipeline.ts`, `apps/api/src/platform/authz/authorise.ts`, `apps/api/src/platform/audit/capture.ts`, `apps/api/src/platform/rate-limit/**`, `packages/audit/src/network.ts`, `tests/generated/rbac/matrix-app.ts` or `eslint.config.mjs` (the `lint` lock). If you find you need one of them, stop and ask the orchestrator for the lock; do not work around it. `packages/config/src/schema.ts`, `packages/config/src/guards.ts`, `packages/shared/src/logging/security-event.ts`, `docs/03-architecture/api/README.md` §7 and `package-lock.json` also change on TASK-041. You may append to the first three if your card needs it. Merge `origin/main` again after part 041-A lands and resolve by keeping both sides.
8. **No new dependency** unless the card requires one. A lockfile change conflicts with TASK-041. If one is unavoidable, justify it in the report (licence against the allow-list, maintenance, size, alternatives) and regenerate the lockfile with `npm install --package-lock-only` after merging main.
9. **Diff coverage and entry points.** The lane A diff-coverage gate fails changed lines that no test executes. Keep entry files (`main.ts`) untouched and put logic in testable modules. Type-only files with no executable lines are fine.
10. **Security-owned paths** (CODEOWNERS: `prisma/**`, `tools/db/**`, `tools/ci/**`, `apps/api/src/platform/**`, every `package.json`, `stylelint.config.mjs`, `tools/stylelint-rules/**`, `tests/fixtures/lint/**`, …) need a security record. The orchestrator requests it; you list the owned paths you changed in the report.
11. **Commits.** Conventional Commits with a lower-case subject (commitlint), body lines under 100 characters, the task ID in the subject, and the trailer `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never force-push. No secret-shaped literals in tests or fixtures: gitleaks scans the whole PR range on every push, and a committed false positive stays in the range.
12. **Tests carry their IDs.** Every acceptance test title starts with its ID (`[AT-US-xxx-nn]`, `[SEC-TC-nn]`). That is how `quality:trace` and `ac-trace.json` find them.
13. **Turn budget.** If you are about to run out of turns, commit the work in progress on the branch and report exactly what is done, what is not, and the next step. Do not stop silently.
14. **Handoff Report** (`docs/sdlc/templates/HANDOFF.md`): branch and head SHA, files changed, test evidence (commands and counts), developer decisions as `D-TASKxxx-nn`, the security-owned paths touched, the `.env.example` lines needed, and open questions.

## Card (generated by docs/04-plan/generator/gen.mjs, verbatim)

#### TASK-044 — Server-sent events convention (framing, heartbeats, Last-Event-ID, close semantics)

| Field | Value |
|---|---|
| Stories (completes) | US-042 **DC** (M0 Must) Server-sent events convention |
| REQs | REQ-API-017, REQ-API-018 |
| NFRs | NFR-PERF-003 |
| Spikes / security / decisions | D-ORCH-023, D-ARCH-084, PR44-SEC-13, D-SEC-PR44-02, D-ORCH-076 |
| Specialist · model | backend-developer · sonnet (escalate to opus from fix cycle 2) |
| Complexity | M |
| Depends on | TASK-036 |
| Batch · locks | 1.3 · api-sse |
| Branch | `feat/TASK-044-server-sent-events-convention` |
| Priority | Must · demo-critical |

**Files / modules**
- apps/api/src/platform/sse/**
- packages/ui/src/sse/fetch-sse-parser.ts
- tests/api/helpers/expect-event-stream.ts

**Acceptance tests to write**
- All US-042 scenarios
- PR #21 code review R1-m5 remainder (D-ORCH-023 (1); api/README §16.4; D-ARCH-084): the `expectEventStream` helper in tests/api/helpers (framing, heartbeat and Last-Event-ID assertions validated against the contract) lands here as its first consumer
- D-ARCH-106 (ADR-0003 am. 2026-11-13): a stream is never produced inside a tenant transaction: the replay read is a short transaction and the stream body is completed after COMMIT through the stream hook of TASK-020 part 020-C, which this task consumes (this task defines the stream result type and the framing); this task does not start before part 020-C has merged
- PR44-SEC-13 (LOW, pre-existing since TASK-006; D-SEC-PR44-02; D-ORCH-076; DUE before this task merges — the first route that can fail after headers are sent): after headers are sent the problem handler passes the AppError to next() and Express 5 prints the unredacted server-only cause with console.error; the handler passes a code-only AppError (no cause, no meta, no message beyond the code) to next() and logs the redacted cause itself; unit test with a route that throws after res.write and a spy on console.error asserting that no cause text reaches it
- AT-US-042-01 … AT-US-042-08: all 8 scenarios of US-042, with the IDs in the test titles (TEST-STRATEGY §6; map `docs/05-quality/tests/gherkin-test-map.md`)

**DoD notes**
- Routes via `defineRoute` (permission, audit descriptor, Joi schema; unknown fields rejected); implements the `openapi.yaml` operation exactly with examples (contract changes go to api-designer as a change request, never edited in the task); problem+json codes from the catalogue; the generated RBAC-matrix, audit, RLS cross-tenant and abuse suites pick up the new routes/tables and stay green; keyset pagination + `org_id`-leading indexes for lists; Compose runs it.
- `security-integration` (ADR-0023 am. N items 1–2): the planned files match the trigger list (`apps/api/src/platform/**`), so expect the hosted job on the PR. The base-ref classifier decides on the paths the PR actually changes (`tools/ci/security-paths.mjs`): when it selects, `ci-gate` needs the job's success or an inherited security proof (am. L item 2) and degraded mode never waives it (D-ARCH-021); when it does not select, the PR does not claim the run.
- Traceability: the orchestrator merges this task ID into `docs/sdlc/traceability.md` from `task-map.csv`; STATUS.md records fix cycles.

