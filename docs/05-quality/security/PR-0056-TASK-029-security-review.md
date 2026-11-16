# PR-0056: TASK-029 automatic audit capture, security review

| Field | Value |
|---|---|
| PR | #56 `feat(api): descriptor-driven automatic audit capture (TASK-029)`, https://github.com/sukhchdit/shipcube/pull/56, branch `feat/TASK-029-automatic-audit-capture`. Merge base `28c41ed`. Commits: `ce71530` (writer record/flush, store batch), `c5e5952` (JSON boundary NUL / lone surrogates), `ec413c2` (lint boundary probes), `91eca4a` (capture middleware), `460d3e7` (flush integration test), `2132569` (merge of `main`, docs only), `6622ff9` (FAILED entry for load/call failures), `8b854ce` (prettier), `4b02531` (evidence only). `main` was `ba60aa7` when this round was written; since the merge base it moved by docs and agent notes only |
| Head | 4b02531c0e4c9b0e3ef94d0732ed463c128b17de |
| Lane A evidence | Run 43806951976 on `4b02531`: **fast-lane `success`** (Lane B evidence accepted, lint, lint mutation check, type-check, unit, base-ref negative fixtures, build). **scans**: "Gitleaks (PR commit range)" `success`; the only red step is "Security-owned paths need a review record" (33 owned paths, no `PR-0056-*` record). `security-integration` skipped (due once the record passes), `ci-gate` red only as the aggregate. Lane B run `20261116T0436Z_8b854ce`: api 160, catalog 102, integration 323, rls 126, unit 6,037 (2 skipped), 0 failures; the audit-generator suite is still "skipped by manifest (planned)" |
| Owned paths changed | 33: `apps/api/src/platform/audit/{capture,descriptor-runtime}.ts` and their tests, `platform/audit/writer.test.ts`, `platform/authz/authorise.ts`, `platform/db/{tenant-db,with-tenant-tx}.ts` and tests (+ `system-db.test.ts`), `platform/http/json-body.ts` and two tests, `platform/routing/{define-route,pipeline}.ts`, `pipeline-guards.test.ts`, `platform/tx/execute.ts`, `packages/audit/src/{entry,errors,index,writer}.ts`, `store/prisma-store.ts` and tests, `tests/fake-sql.ts`, `prisma/tests/audit/{audit-actions-v2,audit-capture-flush,audit-writer}.int.test.ts`, `prisma/tests/rls/tenant-db.real-client.test.ts`, the lint fixture `ok-two-hop-writer-reexport.ts`, `tools/lint/audit-capture-boundary.test.ts` |
| Unowned paths changed | `apps/api/src/app.ts`, `apps/api/src/start-api.ts`, `packages/shared/src/errors/catalogue/audit.ts`, `tests/generated/audit-descriptors.test.ts`, and the run directory `docs/05-quality/tests/runs/20261116T0436Z_8b854ce/` (8 files). All read; `app.ts` and `start-api.ts` are part of the TASK-028 deferral assessment (§6.5) |
| Binding items checked | PR42-SEC-15 (a)-(c), PR42-SEC-17, PR42-SEC-19 (PR #42 record, routed by D-TASK025-27); code review PR #42 R3-n1/R3-n2; D-ARCH-106, D-ARCH-122 (ADR-0007 am. 11 item 3, data-model §5.4), D-ARCH-125; REQ-AUDIT-001/004/005/006/010; threat model T-39, T-69, T-83, T-85, T-86, T-107; SEC-P3-28, SEC-P3-32 (`x-audit.additional`); D-TASK029-01..15 and its TASK-028 follow-up |
| Reviewer / date | security-analyst, round 1, 2026-11-16 to 2026-11-17. Git object reads and the owned-path computation ran in the main checkout. In the PR worktree I ran only read-only probes (an in-memory ESLint `lintText` against its real `eslint.config.mjs`, and type-stripped Node probes that import its sources; nothing written), then wrote and committed this file. No Jest, no Docker, no PostgreSQL this round. Line numbers come from single-file reads at `4b02531`. The code-review twin `docs/05-quality/reviews/PR-0056-TASK-029-code-review.md` (CHANGES_REQUESTED, one MAJOR) landed on this branch as `f376377` (docs only) during this round; I read it after my first commit (`38aaef9`) and added §8a, PR56-SEC-09 (= its R1-M1) and the updated counts in a docs-only follow-up commit |

## 1. Summary

The PR turns the audit stub into descriptor-driven capture. Mutations record their entry and run the transaction's one flush as the last database work of the handler transaction. VIEW and DOWNLOAD entries are written in their own short transaction after COMMIT and before anything is sent; a SENSITIVE one fails closed with 503 `AUDIT_UNAVAILABLE`. A 403 `AUTHZ_DENIED` is preceded by a PERMISSION_DENIED entry in its own transaction, and a failure to write it answers 500/503. FAILED entries cover 409/422/5xx of authenticated mutations. The writer gains `record`/`flush` with the D-ARCH-122 invariants and the STREAM_MISMATCH check; the tenant transaction gains statement tracking and the settle loop (PR42-SEC-17 H2); the JSON boundary refuses NUL and lone surrogates (PR42-SEC-15 (c)).

The integrity core holds. A mutation whose handler returns 2xx cannot commit without its entry: the flush is awaited in the transaction, the latch, I2 and I3 fail the transaction, and deferred starts are settled (only timer starts escape, as documented). A *returned* non-2xx result is the exception (PR56-SEC-09, the code review's R1-M1). Entries take the actor, organisation, correlation id and IP from the server-side principal and request context; client-shaped columns are null unless they match the writer's shape. The writer refuses a tenant entry whose organisation differs from the transaction's. Personal values (IP, user agent, filter values) are tokenised. No new path writes a header or query value to a log.

The claimed closures hold: PR42-SEC-15 (a)(b)(c), PR42-SEC-17 (with its documented timer residual), PR42-SEC-19 and R3-n1. The R3-n2 tripwire exists but is blind to the one re-export that does exist.

Findings, all latent today because the production module registry is empty:
- **PR56-SEC-01 (MEDIUM):** a filter value that the writer refuses (NUL via `%00`, an empty string, more than 8,192 characters) silently drops the VIEW entry of a NORMAL list. The response is still released. The same value makes a SENSITIVE list answer 503. This is the PR42-SEC-15 class again, now arriving through the query string.
- **PR56-SEC-03 (MEDIUM):** every 403 now costs a tenant transaction and a stream-head lock, before any per-actor rate limit. T-39's aggregation mitigation is not built.
- **PR56-SEC-09 (MEDIUM, = code review R1-M1):** a handler's *returned* non-2xx status commits its writes. A returned 400/403/404 (or an anonymous 409/422/5xx) commits with no entry. A returned 409/422/5xx commits a change that persisted under an entry that says FAILED.
- **PR56-SEC-02 (LOW):** `createAuditCapture` is re-exported from the tx slot. Any api module can import it lint-clean and append entries with an arbitrary actor.
- **PR56-SEC-04 (LOW):** `x-audit.additional[]` is ignored, so the SEC-P3-32 and SEC-P3-28 second entries have no writer.
- **PR56-SEC-05 (LOW):** `source_app` is client-asserted.
- **PR56-SEC-08 (LOW):** the TASK-028 deferral. Accepted, with two conditions.
- **INFO:** 06 (stream-check asymmetry) and 07 (no target organisation, roles or session on entries).

Findings: 0 Critical, 0 High, 3 Medium, 4 Low, 2 Info.

**Verdict: PASS_WITH_FOLLOW-UPS.** The code review's CHANGES_REQUESTED forces a fix cycle. That cycle should carry PR56-SEC-09 with R1-M1, and preferably 01, 02 and 04. Any push to an owned path then needs a delta round 2.

## 2. Method

1. Read the full diff `28c41ed...4b02531` and, at the head, `capture.ts`, `descriptor-runtime.ts`, `tx/execute.ts`, `authz/authorise.ts`, `routing/pipeline.ts`, `db/{tenant-db,with-tenant-tx}.ts`, `http/json-body.ts`, `packages/audit/src/{writer,entry}.ts`, `store/prisma-store.ts`, `rate-limit/limits.ts`, `start-api.ts`, `modules/index.generated.ts`, the boundaries block of `eslint.config.mjs`, the contract's `x-audit` blocks, D-TASK029-01..15, the PR #42 record (SEC-15/17/19) and threat-model rows T-39/T-69/T-85/T-86.
2. **P1, lint reachability** (in-memory `lintText` with the head's real `eslint.config.mjs`, type-aware parsing off): who may value-import `createAuditCapture` through `platform/tx/execute.js`. Nine cases, including three controls that must be reported.
3. **P2, filter values** through the REAL `createAuditCapture`, `compileAudit`, `entryFor`, writer and `prepareEntry`. The tenant-transaction runner, tokeniser and store are fakes; the runner honours the latch and the I3 checks. Seven cases.
4. **P3, forgery** through the same harness: a "feature" caller builds the capture from `platform/tx/execute.js` and records with a forged principal.
5. **P4, JSON boundary**: `isStorableText` against a code-point reference over 300,000 seeded strings drawn from NUL, high, low and paired surrogates, with a NUL-only control predicate. Also structure cases (100,000-deep nesting, a `__proto__` key, a key with a lone surrogate, an emoji pair) and timing for 1 M characters and 500 k pairs.
6. Evidence: lane A step list (run 43806951976) and the lane B JUnit titles for SEC-15/17, I2, I3 and STREAM_MISMATCH.
7. Owned-path list from main's `check-security-owned-paths.mjs` exports; a record check after the commit (§9).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner / due |
|---|---|---|---|---|---|---|
| PR56-SEC-01 | Client-chosen list-filter values suppress NORMAL VIEW entries and fail SENSITIVE lists with 503 | MEDIUM | CWE-778 | A09:2021 | `apps/api/src/platform/audit/descriptor-runtime.ts:148-156`; `capture.ts:110-121`; `packages/audit/src/entry.ts:281` | senior-developer: this PR's next code cycle if one runs, else before the first audited list route merges; TASK-033 generator case |
| PR56-SEC-02 | The tx slot re-exports `createAuditCapture`; any api module mints entries with any actor lint-clean, and the R3-n2 scan skips that folder | LOW | CWE-284 | A04:2021 | `apps/api/src/platform/tx/execute.ts:47`; `eslint.config.mjs:594-599`; `tools/lint/audit-capture-boundary.test.ts:211-247` | senior-developer: this PR's next code cycle, else the next PR touching `eslint.config.mjs` |
| PR56-SEC-03 | Every 403 writes PERMISSION_DENIED under the stream-head lock before any per-actor limit; T-39's aggregation is not built | MEDIUM | CWE-770 | A04:2021 | `apps/api/src/platform/authz/authorise.ts:58-80`; `routing/pipeline.ts:34-35`; `audit/capture.ts:143-158`; `rate-limit/limits.ts` (stub) | TASK-041 (limiter) with the T-39 denial budget, before the first route with a catalogued permission is registered in `moduleRegistry` |
| PR56-SEC-04 | `x-audit.additional[]` is ignored; `createQuoteShare` (SEC-P3-32) and `checkoutOrder` (SEC-P3-28) would mount without their second entry | LOW | CWE-778 | A09:2021 | `apps/api/src/platform/audit/descriptor-runtime.ts:119-139` | senior-developer: mount refusal in this PR's next cycle, else before either route's task merges |
| PR56-SEC-05 | `source_app` is taken from client-controlled `X-Client-App` | LOW | CWE-348 | A09:2021 | `descriptor-runtime.ts:142`; `tx/execute.ts` `transportOf` | TASK-052 (session-bound client app) and the audit viewer's column label |
| PR56-SEC-06 | STREAM_MISMATCH accepts an organisation-less (SYSTEM shard) entry inside a tenant transaction | INFO | CWE-284 | A01:2021 | `packages/audit/src/writer.ts:156` | TASK-030 (moves the stream code) |
| PR56-SEC-07 | Entries carry no `target_org_id`, roles or session; `operator-cross-tenant` routes mount without a target-organisation resolver | INFO | CWE-778 | A09:2021 | `descriptor-runtime.ts:176-205` | TASK-052 (roles, session); the admin-slice tasks (target organisation) |
| PR56-SEC-08 | Production composition: capture without tokeniser, IP index and UA parser, so every audited route and every 403 answers 500 (TASK-028 deferral) | LOW | CWE-703 | A05:2021 | `apps/api/src/start-api.ts:116`; `routing/pipeline.ts:57` | TASK-028; boot assertion (§4.8). **Deferral accepted** with conditions |
| PR56-SEC-09 | A returned (not thrown) non-2xx result commits the handler's writes: no entry for 400/403/404 and for anonymous 409/422/5xx; a FAILED entry for a change that persisted (= code review R1-M1) | MEDIUM | CWE-778 | A09:2021 | `apps/api/src/platform/audit/capture.ts:89-107`; `tx/execute.ts:226-236`; `descriptor-runtime.ts:211-213` | senior-developer: this PR's fix cycle, with R1-M1 and the principal-architect ruling on D-TASK029-04 |

## 4. Finding details

### PR56-SEC-01 (MEDIUM): client-chosen filter values suppress list VIEW entries

- **Description.** `filterSummary` (`descriptor-runtime.ts:148-156`) copies each validated query value into a PERSONAL `PiiValue`. A string is copied as it is; any other value goes through `JSON.stringify`. The writer validates every personal value with `boundedText` (`entry.ts:281`): the value must be non-empty, at most 8,192 code units long and free of NUL, or the entry is refused (INVALID_ENTRY).
  - Express 5's default query parser (`node:querystring`) decodes `%00` to U+0000.
  - Joi `string()` accepts NUL, and it accepts `''` with `.allow('')`.
  - The new JSON-body check (PR42-SEC-15 (c)) covers bodies only, not query strings.

  For a NORMAL list, `afterCommit`'s catch (`capture.ts:118-121`) swallows the refusal and the rows are sent. Only the `onDbError` log line remains. For a SENSITIVE list the same value answers 503 `AUDIT_UNAVAILABLE`.
- **Probe P2** (the real capture, descriptor runtime, writer and entry validation):

  | Case | Query | Result | Entry |
  |---|---|---|---|
  | N0 (control) | `q=abc` | released | written |
  | N1 | `q` containing NUL | released | **none** |
  | N2 | `q=''` | released | **none** |
  | N3 | `q` of 8,193 characters | released | **none** |
  | N4 | `q` = array holding a NUL (JSON-escaped by `JSON.stringify`) | released | written |
  | S0 (control) | SENSITIVE, `q=abc` | released | written |
  | S1 | SENSITIVE, `q` containing NUL | **503 AUDIT_UNAVAILABLE** | none |

- **Exploitability / impact.** Any member allowed to call a list route can append `&q=%00` (or the equivalent for any free-text filter whose schema has no pattern) and read the list with no trail. That is the insider-scraping case REQ-AUDIT-001 and O4 exist for. "Best effort" for NORMAL views (ADR-0007 am. 10) was meant for infrastructure failures, not for a refusal the client chooses. The SENSITIVE variant is a 503 for the requester's own request only, so it adds a client-steerable 5xx (the PR42-SEC-12 class). The finding is latent: `moduleRegistry` is empty and no list route exists yet. Impact M × likelihood M gives **MEDIUM**.
- **Remediation.** In `filterSummary`, emit only values the writer accepts, so the entry can never be refused because of what the client sent:

  ```ts
  // descriptor-runtime.ts, filterSummary: a value is stored as text only when the writer accepts it as is
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  const text = raw !== '' && !raw.includes('\u0000') ? raw : JSON.stringify(value); // '' -> '""', NUL -> \u0000 escape
  const bounded = text.length <= MAX_FILTER_TEXT ? text : `${truncateCodePoints(text, MAX_FILTER_TEXT - 1)}…`;
  summary[key] = pii({ entityName: 'audit_entry', field: 'filter', classification: 'PERSONAL', value: bounded, subject: null });
  ```

  Lone surrogates cannot arrive through the query parser (invalid UTF-8 decodes to U+FFFD), and the writer normalises them anyway. Also make a swallowed NORMAL failure countable (metric plus `audit_view_unrecorded` security event), so a pattern of dropped views is visible beyond one log line.
- **Verification.** An api test on a NORMAL list route for `?q=%00`, `?q=` (schema with `.allow('')`) and a 9 KiB value: each answers 200 with exactly one VIEW entry. The SENSITIVE variant answers 200 with its entry. A mutant that restores the raw copy turns the test red. Add the same cases to the TASK-033 generator.

### PR56-SEC-02 (LOW): `createAuditCapture` re-exported from the tx slot

- **Description.**
  - `tx/execute.ts:47` re-exports `createAuditCapture`, so that `pipeline.ts` gets the factory without importing `capture.ts`.
  - The REQ-AUDIT-001 boundaries policy (`eslint.config.mjs:594-599`) judges only the resolved *direct* target. `tx/execute.ts` is category `api-tx-slot`, not `api-platform-audit`, so any api file can import the factory through it.
  - The R3-n2 source-scan tripwire (`audit-capture-boundary.test.ts:211-247`) scans only the api folders on `AUDIT_WRITER_ALLOW_LIST`. `platform/tx` is not on that list; it is the one folder allowed to value-import `capture.ts`. The scan therefore reports "no re-export" while this one exists.
- **Probe P1** (head config, `lintText`):
  - Controls, all reported:
    - C1: module → `capture.ts`.
    - C2: module → `audit/writer.ts`.
    - C3: module → `@platform/audit` `createAuditWriter`.
  - `createAuditCapture` from `platform/tx/execute.js`, all **CLEAN**:
    - X1: module service.
    - X2: module routes.
    - X3: module repository (namespace import).
    - X4: `platform/routing`.
    - X5: dynamic `import()`.
    - X6: app root.
- **Probe P3.** A caller builds the capture from `tx/execute.ts` and calls `mount(route).inTransaction(ctx, { status: 204 })` with a forged principal inside its own transaction. It appended a `DELETE address` entry attributed to another user (`actor is victim: true`), with source `admin`.
  - With a runner, `denied(request, tenant)` writes into whichever organisation's stream the caller chooses: STREAM_MISMATCH compares the entry with the transaction the caller opened.
- **Exploitability / impact.** The result is a forged or misleading trail (any actor, action, outcome, source), which defeats REQ-AUDIT-001's "only allow-listed callers". It takes a developer's import in feature code that review might miss (the importing file is not security-owned). Impact M × likelihood L gives **LOW**, as PR42-SEC-16.
- **Remediation.**
  1. Drop the re-export. Let the tx slot own construction: for example, `executeSlot`/`authoriseSlot` receive an `AuditCapture` that `defaultPipelineSlots` obtains from a tx-slot function, and the factory itself stays unexported outside `platform/audit` and `platform/tx`.
  2. Add a boundaries policy: api files other than `platform/routing`, `platform/authz`, `platform/tx` and tests do not value-import `api-tx-slot`.
  3. Extend the tripwire scan to every folder allowed to value-import `capture.ts` (`api-tx-slot`), for `export … from '../audit/…'`.
- **Verification.** X1–X6 are reported and C1–C3 are unchanged. The scan fails on a mutant that adds `export { createAuditCapture } from '../audit/capture.js'` to `tx/execute.ts`.

### PR56-SEC-03 (MEDIUM): denial writes before any per-actor limit (T-39)

- **Description.** `refuse` (`authorise.ts:58-80`) awaits `capture.denied` before answering 403. Each denial therefore costs:
  - one tenant transaction (an admission permit and a pool connection);
  - the vault statements for the IP and user-agent tokens;
  - the head-row lock and append on the actor's organisation stream (`capture.ts:143-158`).

  Authorisation runs before rate limiting (DR-A08; `pipeline.ts:34-35`), so TASK-041's per-class and per-user limits never see a denied request. Only the step-0 per-IP limiter does, and it is a pass-through stub today. Threat model T-39 (MEDIUM) requires "above N denials/min per actor, one aggregated summary entry"; the PR writes one entry per denial and has no budget.
- **Exploitability / impact.** A Viewer (or any member) loops a forbidden mutation from several IPs. Their organisation's stream head and admission permits stay busy, so the same tenant's legitimate writes get 503 `AUDIT_LOCK_TIMEOUT` / `TENANT_CONCURRENCY_LIMIT`, its SENSITIVE views get 503 `AUDIT_UNAVAILABLE`, and the trail grows (T-86).
  - The tenant bulkhead confines this to the attacker's tenant.
  - Denials of organisation-less principals (operators) land on the 16 SYSTEM shards, which anonymous and guest traffic also writes (`createQuote` CREATE SENSITIVE, `getQuote` VIEW SENSITIVE). That part is T-85 / PR42-SEC-01 (TASK-284) and is not filed again.
  - This is reasoning, not a PostgreSQL probe (no Docker this round). It is latent: no route with a catalogued permission is registered.
  - Impact M × likelihood M gives **MEDIUM**, the threat model's own rating.
- **Remediation.** Build T-39 before the first such route ships: a per-actor denial budget in the authorisation slot, keyed `org:actor`. The first N denials per minute are audited one by one; above N the request answers 429 `RATE_LIMITED` without a write, and one aggregated `PERMISSION_DENIED` entry with `details.count` closes the window.

  ```ts
  // authorise.ts, refuse(): before capture.denied (TASK-041 provides the Valkey-backed budget)
  if (!(await denialBudget.take(`${principal.orgId}:${principal.actorId}`))) return next(new AppError('RATE_LIMITED', { retryAfterSeconds }));
  ```

  Keep D-TASK029-06 as it is (no silent 403 when the write fails).
- **Verification.** Extend SEC-TC-15: N+1 denials in a minute give N entries plus one 429, and the aggregated entry carries the count. Add a k6 denied flood whose acceptance criterion is that the p95 latency and 503 rate of the same tenant's legitimate writes stay within the budget.

### PR56-SEC-04 (LOW): `x-audit.additional[]` ignored

- **Description.** `compileAudit` (`descriptor-runtime.ts:119-139`) never reads `route.audit.additional`. Two contract operations declare a second entry that a security condition requires:
  - `createQuoteShare`: `UPDATE quote_share`, the implicit revocation (SEC-P3-32, D-ARCH-032).
  - `checkoutOrder`: `UPDATE payment` for a failed CVC check (SEC-P3-28).

  Feature modules may not import the writer (AT-US-086-03), and the capture offers no seam for a conditional entry. Both routes would therefore mount and silently lack the entry. The TASK-033 generator, which binds each additional entry to a fixture (D-ARCH-032 ruling 1), is still "planned" in the manifest.
- **Impact.** The revocation and the CVC-failure transition go unrecorded. This is latent. Impact M × likelihood L gives **LOW**.
- **Remediation.** Fail closed at mount, like D-TASK029-05, until a seam exists:

  ```ts
  if ((route.audit.additional?.length ?? 0) > 0)
    throw new SlotNotImplementedError('audit', route.operationId, 'x-audit.additional entries', 'a recording seam for conditional entries');
  ```

  Then add the seam, for example a handler-result member `auditAdditional: [{ index, entityId }]` that `inTransaction` records before the one flush.
- **Verification.** A route with `additional` refuses to mount; after the seam lands, a test shows two entries for one request.

### PR56-SEC-05 (LOW): client-asserted `source_app`

- **Description.** `sourceAppOf` (`descriptor-runtime.ts:142`) takes `X-Client-App` when it says `web` or `admin`. Any API client can therefore label its entries `admin`, or a script can claim `web`. The actor, organisation and IP token stay server-derived, so attribution survives. The column misleads only an investigation that trusts it ("this deletion came from the admin console"). D-TASK029-13 and the `RouteTransport` comment call it informational. Impact L × likelihood H gives **LOW**.
- **Remediation.** Accept `admin` only for OPERATOR principals (the admin SPA is operator-only, D-008) and `web` only for non-operators; otherwise record `api`. Once TASK-052 issues sessions, bind the client application to the session (audience) and take it from there. Label the column "client-asserted" in the audit viewer until then.

  ```ts
  const sourceAppOf = (clientApp: string, scope: Principal['actorScope']): AuditSourceApp =>
    clientApp === 'admin' && scope === 'OPERATOR' ? 'admin' : clientApp === 'web' && scope !== 'OPERATOR' ? 'web' : 'api';
  ```

- **Verification.** A tenant member sending `X-Client-App: admin` records `api`; an operator sending `admin` records `admin`.

### PR56-SEC-06 (INFO): stream check is one-sided

`writer.ts:156` refuses a tenant entry of another organisation, and an organisation entry in an organisation-less transaction. Both are required by the AC and covered by unit and integration tests. It accepts `orgId: null` inside a tenant transaction. A capture bug that loses the principal's organisation would then file tenant activity on the SYSTEM shards, invisible to the tenant's `scope_org_id` view. There is no instance: `entryFor` and `tenantContextOf` derive both values from the same principal. Fix: refuse an organisation-less entry when `contextOrgId() !== ''`, unless it names a `targetOrgId`. Add one test.

### PR56-SEC-07 (INFO): no target organisation, roles or session on entries

`entryFor` (`descriptor-runtime.ts:176-205`) sets no `targetOrgId`/`onBehalfOfOrgId`, and the actor carries no roles or `sessionId`. Eight contract operations are `operator-cross-tenant` (the audit viewer reads are SENSITIVE; the feature-flag writes are CONFIG_CHANGE). DR-A15 and REQ-RLS-006 want an operator action on one organisation's data to name that organisation. Owners:
- TASK-052: roles and session.
- The admin-slice tasks: an `auditTargetOrgId` resolver, or a mount refusal for audited `operator-cross-tenant` routes until it exists.

### PR56-SEC-08 (LOW): production composition fails closed with 500 (TASK-028 deferral)

- **Description.** `startApi` passes `auditConfig` (`start-api.ts:116`), and `defaultPipelineSlots` builds the capture with no writer dependencies and no UA parser (`pipeline.ts:57`). In a deployed process every audited route answers 500 `TOKENISER_UNAVAILABLE`, and so does every 403, because an entry with an IP or a user agent has personal values to tokenise. D-TASK029's follow-up names this and routes it to TASK-028.
- **Deferral verdict: ACCEPTED.**
  - It fails closed: no mutation commits without its entry, no view is released unaudited, and no denial is silent.
  - It is unreachable today: `moduleRegistry` is empty at the head and on `main`, and the base routes (health, docs) are NONE and have no catalogued permission.
  - Conditions (tracked, not merge-blocking for this PR):
    1. The TASK-028 wiring (tokeniser, IP index, UA parser through `AppDependencies` into `createAuditCapture`) merges before, or with, the first PR that registers an audited route or a route with a catalogued permission. TASK-026 (admin settings, same batch) is the likely first.
    2. Add a boot assertion next to `assertPipelineReady`: `startApi` refuses to start when a mounted route is audited and the capture has no tokeniser or IP index. This turns "500 on every audited request, feeding ROLLBACK_TRIGGERS" into a start-up failure that the compose smoke test catches.
- Impact on availability only, latent: **LOW**.

### PR56-SEC-09 (MEDIUM, = code review R1-M1): a returned non-2xx result commits without a matching entry

- **Description.** The tx slot's `write` (`execute.ts:226-236`) returns the handler's result, and the transaction commits whatever the status. The audit hook (`capture.ts:89-107`) records:
  - SUCCESS below 400;
  - FAILED for 409/422/5xx, and only when the principal is authenticated and the method mutating (`descriptor-runtime.ts:211-213`);
  - nothing otherwise.

  A handler that writes and then *returns* 400, 403 or 404 therefore commits its writes with no entry. So does an anonymous mutation that returns 409/422/5xx. A returned 409/422/5xx of an authenticated user commits the change under an entry whose outcome says FAILED, without the diff. ADR-0007 §Capture and REQ-AUDIT-010 write FAILED in a separate transaction *because the business transaction rolled back*. D-TASK029-04 departs from that without a principal-architect ruling.
- **Exploitability / impact.** It takes a handler that writes and then returns a non-recorded status. That is a plausible shape ("insert the child, then answer 404 for a missing parent", a partial upsert, a guest route answering 409). Once such a handler exists, any client can trigger it at will, and the business change persists with no trail entry or with a misleading one. This breaks O4 and REQ-AUDIT-004, and US-086's "feature code never has to remember to audit". No such handler exists yet. Impact H × likelihood L gives **MEDIUM**, the rating PR42-SEC-13 had for the same effect.
- **Remediation.** Concur with the code review. Preferred: roll back the handler transaction for every returned status of 400 or more, and write FAILED (409/422/5xx) in its own transaction as the ADR says. Alternative: keep commit-on-return, but let the TenantDb guard count write statements; a returned status that records no entry after a write becomes 500 and rolls back. Either way, a principal-architect ruling settles D-TASK029-04.
- **Verification.** Api tests:
  - a handler writes and returns 404: no business row (or 500), never "committed without an entry";
  - a returned 409 or 500: business row absent, FAILED entry present in its own transaction;
  - an anonymous mutating route that writes and returns 409: no business row.

  A mutant that commits on return must fail these.

## 5. Claimed closures

| Item | Status | Evidence |
|---|---|---|
| PR42-SEC-15 (a) colliding normalised keys | **Closed** | Keys normalise to the same text only through lone surrogates, which the JSON boundary now refuses (P4). The only other client-keyed map, the filter summary, uses schema keys (closed schemas). Diffs are TASK-031 |
| PR42-SEC-15 (b) `ua_parsed` / `entity_id` | **Closed** | `entryFor` passes `isAuditEntityId`, `isAuditUaParsed` and `isAuditRouteTemplate` values only, else null. IP goes through `canonicalIp`, else null. Api test "a crafted User-Agent and an e-mail path parameter never fail the entry" |
| PR42-SEC-15 (c) NUL / lone surrogates → 400 | **Closed for JSON bodies** | P4: 0 mismatches against the code-point reference on 300,000 strings. The NUL-only control differs on 2,000/2,000. 100,000-deep nesting is caught, as are a `__proto__` key with NUL and a lone low surrogate in a key; an emoji pair is accepted. Linear: 1 M characters 15.9 ms, 500 k pairs 20.5 ms. Residual for query strings: **PR56-SEC-01** |
| PR42-SEC-17 deferred-start write | **Closed**; residual T0 (timer) documented | The code matches the probe-validated H2: `guardResult` registers the first start through `state.onStart`, and `settle` loops until a `setImmediate` turn adds nothing. Lane B unit tests K1, K2, K8, K50, B1, B3, "B3 with a failing append" and T0 passed. Not re-probed with my own matrix (the PR #42 kit is gone), and no mutants were run this round. The TASK-033 backstop for T0 is not active yet (generator "planned") |
| PR42-SEC-19 voided failing write | **Closed** | `handled()` starts the work, turns a synchronous throw into a rejection and attaches `catch(ignore)`. It returns the same promise, so an awaiting caller still sees the rejection. Used by both `flush` and `write` |
| R3-n1 capture importers | **Closed** | Direct value imports of `capture.ts` from modules and `platform/routing` are reported (C1 and the PR's own probes); the tx slot is allowed |
| R3-n2 two-hop tripwire | **Present, blind spot** | The tripwire test exists, but its source scan skips `platform/tx`, which re-exports the factory: **PR56-SEC-02** |
| D-ARCH-122 I1-I4, STREAM_MISMATCH | **Hold** | `flushed` is set before the first await (I1 and concurrent flush); `WRITE_AFTER_FLUSH` (I2); `beforeCommit` runs after settle and the latch (I3); `write` = record + flush (I4). Head locks are taken in ascending canonical-UUID order before the first append. STREAM_MISMATCH is unit- and integration-tested; it is one-sided: **PR56-SEC-06** |

## 6. Behaviour assessed

1. **SENSITIVE VIEW / DOWNLOAD fails closed.** `run` writes the entry after the handler COMMIT and before `send`. Any write failure throws 503 `AUDIT_UNAVAILABLE` (Retry-After 1), so neither the body, the stream nor `afterCommit` starts. Only 2xx results are audited, and a VIEW handler's own writes commit before the entry, as ADR-0007 am. 10 designs it. **Correct.** The client-steerable trigger is PR56-SEC-01, the contention trigger PR56-SEC-03.
2. **PERMISSION_DENIED before the 403.** `refuse` awaits `denied` and only then calls `next(403)`; a write failure becomes `next(error)` (500/503). The entry holds no entity id, uses the `NOT_VALIDATED` input and names the required permission. 401s are not audited. **Correct.** Cost and DoS: PR56-SEC-03.
3. **`source_app` from `X-Client-App`.** Compared against two literals only, never logged, never used for a decision: PR56-SEC-05.
4. **Filter summary tokenised PERSONAL.** Every value is tokenised (never clear text in the row); keys are schema field names; `result_count` is derived from `data`. A key is not personal data under a closed schema. Residual: PR56-SEC-01.
5. **TASK-028 latent issue.** Deferral accepted with two conditions: PR56-SEC-08.

| Concern | Result |
|---|---|
| Audit bypass | Write routes fail closed (in-transaction flush, latch, I3, settle). NORMAL views are best effort by design; the client-steerable drop is PR56-SEC-01; `additional[]` is PR56-SEC-04. NOTE: `defaultPipelineSlots` still accepts the test seam `audit` from `ExecuteOptions`, which replaces the whole mounted capture (views, denials and FAILED included). `createApp` never passes it; strip it in `defaultPipelineSlots` the next time the file changes |
| Forgery | The descriptor fixes the action, and the frozen principal fixes the actor. The only path to arbitrary entries is PR56-SEC-02 |
| Tenant stream crossing | Entry organisation = principal organisation = transaction organisation, with the writer check on top. Crossing is possible only through PR56-SEC-02 (the caller picks the transaction). Organisation-less entries in tenant transactions: PR56-SEC-06 |
| PII in columns or logs | IP, user agent and filter values are tokenised; `ua_parsed`, `entity_id` and `route` are shape-gated; `details` holds only server values (`status`, `code`, `required_permission`). INVALID_ENTRY field paths print `{key}` for non-schema keys. `onDbError` is the redacting logger. The PR adds no log statement |
| DoS via locks / 503 | PR56-SEC-03 (denials). FAILED entries are skipped when the audit path or the bulkhead failed. A FAILED entry otherwise costs one short transaction per failed request. SYSTEM-shard contention: T-85 / PR42-SEC-01 (TASK-284) |
| Log injection via headers / UA | No new path: the user agent is only tokenised, `X-Client-App` is compared to literals, and the correlation id must match `CORRELATION_ID_PATTERN` in the middleware and the writer alike. Error messages carry route metadata only |

## 7. Decisions D-TASK029-01..15

Concur with all except 04 (PR56-SEC-09, = code review R1-M1: a principal-architect ruling is needed). Notes:
- 03: NORMAL best effort, with PR56-SEC-01 as the client-steerable residual.
- 06: concur, but T-39's aggregation is owed (PR56-SEC-03).
- 08: one-sided (PR56-SEC-06).
- 09: concur, T0 residual.
- 12: concur.
- 13: PR56-SEC-05.
- TASK-028 follow-up: accepted with conditions (PR56-SEC-08).

These are proposed for the orchestrator to log as **D-SEC-PR56-01**:
- (1) Accept the TASK-028 deferral under PR56-SEC-08 conditions 1 and 2.
- (2) T-39's denial budget becomes part of TASK-041 and is due before the first catalogued-permission route is registered.
- (3) `x-audit.additional[]` routes are refused at mount until a recording seam exists.

## 8. Follow-ups and owners

| Owner | Items | Due |
|---|---|---|
| senior-developer (this PR, if a code cycle runs) | PR56-SEC-01 filter sanitising plus api test; PR56-SEC-02 re-export, boundaries policy and tripwire scope; PR56-SEC-04 mount refusal; NOTE on the `audit` seam | Otherwise before the first audited list route (01), the next `eslint.config.mjs` change (02), or the `createQuoteShare`/`checkoutOrder` tasks (04) |
| TASK-041 | PR56-SEC-03 denial budget and aggregated entry (T-39, SEC-TC-15) | Before the first route with a catalogued permission is registered |
| TASK-028 | PR56-SEC-08 wiring and the boot assertion | Before or with the first audited route in `moduleRegistry` |
| TASK-052 | PR56-SEC-05 session-bound client app; PR56-SEC-07 roles and session | With the authenticators |
| TASK-030 | PR56-SEC-06 one-sided stream check | With the move into `chain/**` |
| TASK-033 / qa-lead | Generator cases for 01 and 04; activate the audit-generator suite (the T0 backstop of PR42-SEC-17) | Before G3 |
| senior-developer + principal-architect (this PR's fix cycle) | PR56-SEC-09 with code review R1-M1 and the D-TASK029-04 ruling | Before merge (the code review's MAJOR) |

## 8a. Code-review twin (`f376377`, CHANGES_REQUESTED)

| Code review | Security view |
|---|---|
| R1-M1 (MAJOR) returned non-2xx commits | = **PR56-SEC-09 (MEDIUM)**; concur with the fix options |
| R1-m1 production composition lacks tokeniser | = PR56-SEC-08. Concur with the AC line on the owning card. A mount-time refusal (capture without a tokeniser refuses audited and permission-gated routes) satisfies my condition 2 as well as a boot assertion |
| R1-m2 query-string NUL in the filter summary | = **PR56-SEC-01**. I rate it MEDIUM rather than MINOR, because the NORMAL case is an audit suppression the client chooses, not only a 5xx |
| R1-m3 denial before the rate limiter ("security-analyst to rate") | = **PR56-SEC-03, MEDIUM** (threat model T-39). Choice recorded: a per-actor denial budget with an aggregated entry, owned by TASK-041. Do not move the denial write after `rateLimit` alone, because the per-class limit would then count denied requests against legitimate traffic of the same class |
| R1-m4 `afterFailure` under congestion | Concur; LOW security weight (an availability amplification under pool exhaustion: a second transaction per failed request). Add `TRANSACTION_UNAVAILABLE`, `STATEMENT_TIMEOUT` and `LOCK_TIMEOUT` to the exclusion set, skip aborted requests, and bound the write by the request deadline |
| R1-m5 no roles / session on entries | = PR56-SEC-07 (INFO) |
| R1-m6 VIEW handlers run read-write | Concur; the same class as PR56-SEC-09 (a write without its entry). `readOnly: true` for `view`/`list` mode closes it |
| R1-m7 survivors; silent catches | Concur. The class-only log line in both catches is also part of PR56-SEC-01's remediation (count dropped views) |
| R1-n1..n5 | No security weight; R1-n2 (head-row stamp from the first entry) is metadata only |

## 9. Record check

Before committing, main's `tools/ci/check-security-owned-paths.mjs` without this file reported the 33 owned paths and "no record named docs/05-quality/security/PR-0056-*.md" (the negative control). After committing it, the same script runs with `--base 28c41ed --head <record commit> --pr 56 --root <PR worktree>`; its result is in the hand-off report. Any later push to one of the 33 owned paths voids this record and needs a delta round; a merge of `main` does not, unless `main` changed one of them. Do not merge `main` again before the squash unless needed: the agent-memory files on `main` stale the lane B evidence.

| Field | Value |
|---|---|
| Critical / High / Medium / Low / Info | 0 / 0 / 3 / 4 / 2 |
| Verdict | **PASS_WITH_FOLLOW-UPS.** No Critical or High open. The three MEDIUMs are latent (empty production module registry) and have owners and due points; PR56-SEC-09 rides the fix cycle that the code review's MAJOR forces; the TASK-028 deferral is accepted with conditions |
