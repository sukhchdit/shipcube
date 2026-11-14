# Code review: PR #38, TASK-020 part 020-B (generated client package, runner activation, declared credential kinds), round 1

Reviewer: code-reviewer (principal engineer). Head reviewed: `bdf009d` (full SHA `bdf009d37945e9a56d5d63840120a55a5426d1e4`, branch `feat/TASK-020-b-prisma-client-package`). Diff base: merge-base `f782d95`. Since then `origin/main` has moved to `320e2e3`: PR #34 merged as `263b790`, plus docs.

Rulings checked against the code: D-ARCH-102, 103, 104, 105, 109, 110 (D-ARCH-106/107 for context); D-ORCH-051, D-ORCH-054; the WAVE-00 TASK-020 lines for part 020-B (package, import discipline, runner activation, follow-up (a)-(f)).

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The package, the import discipline, runner activation, declared credential kinds and the signature-only gate all match
  D-ARCH-102..104/109/110. Lane A is green on the head with every step executed; I killed 11 of 11 mutants of the new logic.
  ONE MAJOR: commit 5aafb2c silently deleted the two PR32-SEC-15 deep-freeze tests, and a mutant that un-freezes `audit` now
  survives all 118 routing tests. The fix is a restore that already passes on this head, and it can ride the PR #34 union commit.
  Six MINORs (two are security flags) and four NITs; none blocks once R1-M1 is fixed.
```

## 1. What I verified myself (and what I did not)

Method:
- the review worktree (read-only) and `git archive` extracts of the head and of the `git merge-tree` union with current main;
- the extracts used a `node_modules` junction to the worktree;
- Node 24, no Docker, no installs, no full suites.

Scratch copies and junctions were removed afterwards. The worktree still has 748 entries in `node_modules` and `git status` is clean.

| Check | Result |
|---|---|
| Targeted unit run: 11 suites (credentials, authenticate, authorise, route-state, define-route, db/runtime, db/generated, services.composition, entry-points, check-prisma-client, prisma-client-package) | 192 / 192 pass in 4.6 s. One "worker failed to exit gracefully" notice appeared in the combined run; no suite leaks when run alone, so I could not attribute it (observation only) |
| ESLint `--max-warnings 0` on all 38 changed `.ts`/`.mjs` (fixtures excluded) | clean |
| Prettier `--check` on changed files | clean. CODEOWNERS and `_base.prisma` have no parser, as expected |
| `tsc -b` | not re-run (several noEmit projects would rebuild; light-commands brief). Lane A `Type-check` is SUCCESS on `bdf009d` |
| Lane A on `bdf009d` (run 43523962597) | `fast-lane` SUCCESS: lint, format, typecheck, unit, build and both "must not mutate the tree" steps all executed, none skipped. `scans` fails only at "Security-owned paths need a review record" (expected) |
| Security-owned paths checker (`--pr 38`) | `status: missing`, 47 owned paths. **Not owned:** `packages/shared/src/http/credentials.ts` and `index.ts`, the SEC-TC-29 helper `tests/api/helpers/cache-control.ts`, and the contract stubs (see R1-m6) |
| Evidence `20261113T2251Z_cb7c12e` | PASS: unit 4226, api 120, integration 257 (1 skip), catalog 74, 0 failures. All 5 D-ARCH-103 repository-probe tests and all 8 fixture tests are in the unit JUnit. The delta `cb7c12e..bdf009d` is evidence, `.claude/` and `docs/` only (verified by name) |
| Mutation of the new logic (11 mutants, extract) | **11/11 killed**: M1 problem-handler drops `!credentialsReadOf`; M2 authn drops `markCredentialsRead`; M3 `presentedKinds` ignores `declared`; M4 signature-only branch off; M5 signature credential check dropped; M6 `requireTenantTx` check dropped; M7 `Client: PrismaClient` dropped; M8 helper pre-route arm uses declared; M9 stub server uses the generic test; M10 authn reads all kinds; M11 `services.tenantTx` undefined. I did not re-run the author's 4 Joi-walker mutants |
| Mutation of the deep freeze (`audit: frozenData(spec.audit)` -> `audit: spec.audit`) | **survives** 118/118 routing unit tests. With main's deleted describe block appended: killed (1 failed); unmutated with the block: 75/75 pass (R1-M1) |
| Timing of the 20 s loopback files | 42 tests in 2.7 s (12.8 s cold). A tsx probe of the same `probe()` shape: `createApp` 1-4 ms, loopback request 14-98 ms, close 1-2 ms |
| Problem-handler trust probe (tsx; replacement authenticator per the documented order: `markCredentialsRead`, then refuse a declared bearer) | 401 with `Cache-Control: no-store`, not `private, no-store`, on `[session]` and on `[anonymous, session]` (R1-m1) |
| `expect.arrayContaining` negation used in the int test | passes with a leaked `sqlState` key (R1-m3) |
| Lint probe, two hops through a module `tests/` folder | `modules/orders/tests/helper.ts` value-imports the generated client (`Prisma.sql`) and a service and a repository import that helper: **all clean**. A direct dynamic `import()` from a repository is refused (R1-m5) |
| Union with current main (`git merge-tree bdf009d origin/main`) | Conflict only in `eslint.config.mjs` (BOUNDARIES_FILES). `package.json`, `tools/tsconfig.json` and `negative-fixtures.test.ts` auto-merge correctly. `jest --listTests` on the union: `runner-activation.int.test.ts` is in `integration`; `declared-credentials.api.test.ts` and `problem-handler.api.test.ts` are in `api`; the other new suites are in `unit`; nothing is in `generated` (section 5) |

NOT re-run: `quality:heavy`, the Testcontainers test `runner-activation.int.test.ts`, the full unit/api suites, whole-solution `tsc -b`, gitleaks. For these I rely on evidence `20261113T2251Z_cb7c12e` and lane A on `bdf009d`. The repository probes of `negative-fixtures.test.ts` cannot run from an extract, because `@platform/*` resolves into the worktree; that is a known false failure. Their result is taken from the evidence JUnit.

## 2. Findings

| ID | Sev | Where | Problem | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `apps/api/src/platform/routing/define-route.test.ts:325-369` (commit `5aafb2c`) | The PR32-SEC-17 edit replaced, instead of extending, the end of the file. It deleted the whole `describe('[R2-n1] [PR32-SEC-15] the descriptor is deep-frozen')` block: "freezes audit (with additional), reauth and deprecated as copies" and "adds no reauth or deprecated key when the declaration has none". Neither the commit message nor the PR body mentions it. No other test pins these facts (grep: no `isFrozen(route.audit)` anywhere). Proof: mutant `audit: spec.audit` (no freeze, no copy) survives all 118 routing unit tests; with main's block restored it is killed. This is the regression coverage of a security finding's closure (PR32-SEC-15 / R2-n1), so DoD "coverage not reduced" fails | Restore the block verbatim from `origin/main` after the four new `[PR32-SEC-17]` tests, inside the file's last describe or as its own top-level describe as on main. Verified: it passes on this head unchanged (75/75). It can ride the PR #34 union commit (D-ORCH-054), which needs fresh lane-B evidence anyway |
| R1-m1 | MINOR | `apps/api/src/platform/errors/problem-handler.ts:80-85`; `apps/api/src/platform/routing/route-state.ts:123` | After `markCredentialsRead`, only the private mark decides SEC-TC-29 for a problem. `route-state.ts` tells every real authenticator (TASK-052/055/091/171/261) to call it "before reading a header". An authenticator that follows that order and then refuses a declared bearer before `markPrivateResponse` (a JWT that fails verification is the normal case) answers 401 with `no-store` only. Proven on `[session]` and `[anonymous, session]`. D-ARCH-109 (4) requires `private, no-store` "when the set has no `anonymous` member and on a request that presented a credential of a declared kind, errors included". Before this PR the generic test covered it. The authz defence in depth never runs, because authn failed first. Impact is small: the problem is `no-store` anyway, and the SEC-TC-29 helper would catch it in TASK-052's api tests. But D-TASK020-33 makes this ordering a contract for five tasks | Make the handler independent of authenticator discipline. The descriptor is already in route state (the `context` slot runs before authn): `isPrivateResponse(res) \|\| declaredTest(descriptor, req.headers) \|\| (!credentialsReadOf(res) && presentsCredential(req.headers))`, where `declaredTest` = `!auth.includes('anonymous') \|\| presentedKinds(headers, auth).length > 0` when a descriptor exists. This is never less private than today. Reword `route-state.ts:120-123` to "together with the decision" and drop "before reading a header". Add one test: a replacement authenticator that marks read and then refuses a bearer on `[session]` must give `private, no-store` |
| R1-m2 | MINOR | `packages/config/src/schema.ts:266`; `apps/api/src/platform/db/with-tenant-tx.ts:271`; `apps/api/src/main.ts:30`, `apps/worker/src/main.ts:30` (D-TASK020-38) | Config accepts `DB_CONNECTION_TIMEOUT_MS` 1..120000. Now that the runner is always built, 1..1999 throws `TenantTxConfigError` from `createRuntimeServices`, outside main's `try`. The process-error handler then writes one fatal line and exits **1**, not the config exit 78 (PR3-SEC-05). An orchestrator reads 1 as a crash and restart-loops instead of reporting a configuration error. Values that booted before this PR stop booting. Defaults and Compose use 5000, so nothing in the repo breaks. This is the "two allow-lists for one value" pattern of PR #9 r3 and PR #11 R3-m2 | **Answer to the brief: acceptable to merge as is; fix it in config, not at run time.** Because `maxWait` is a code constant (`DEFAULT_MAX_WAIT_MS`, not a key), the simplest rule is single-key: raise the schema minimum to 2000 (`t.int(2_000, 120_000)`), plus a parity unit test in apps/api that asserts `DB_CONNECTION_TIMEOUT_MS` min >= `DEFAULT_MAX_WAIT_MS`. A cross-key guard is only needed if `maxWait` ever becomes a key. Owner: the config owner (TASK-005 lineage), on the next `packages/config` touch, before TASK-014 documents the env surface and in any case before G3. Not in this PR (config lock) |
| R1-m3 | MINOR | `apps/api/src/platform/tx/runner-activation.int.test.ts:145` | `expect(Object.keys(body)).not.toEqual(expect.arrayContaining(['reason','sqlState','prismaCode','message']))` fails only when ALL FOUR keys are present. A body that leaks only `sqlState` (or only `reason`) passes; verified with `expect`. The text loop above it catches the known values, not a renamed key | `for (const key of ['reason', 'sqlState', 'prismaCode', 'message']) expect(body).not.toHaveProperty(key);`, or `expect(Object.keys(body).sort()).toEqual([...the documented problem keys])`. Fix with the union commit |
| R1-m4 | MINOR | `apps/api/src/platform/db/runtime.ts:44` (static `./generated.js`); `tools/deps/ignore-scripts.test.ts:182` (D-TASK020-39) | The unit lane regenerates the client (the SEC-TC-45 `deps:rebuild` e2e, under `PRISMA_TREE_LOCK`). The repository's convention is to import the generated client under that lock for exactly this reason (`prisma/tests/catalog/standard-columns-parity.test.ts:95-96`). This PR makes the import static and unlocked for every unit suite that loads `platform/db/runtime`, `runtime/services` or `@platform/api/runtime`, which includes the worker suites. The PR's probe checked that the files never *disappear*; it does not cover a *truncated* read (`writeFile` truncates, then writes), which gives a SyntaxError flake at import time. Disclosed as a residual; the probability is low | Accept for now. Watch the flake report (TASK-278). If it ever flakes: (a) move the `deps:rebuild` e2e suite into a serial project or lane-B only, or (b) have `tools/deps/prisma-cli.mjs generate` write to a temp output and rename it into place. The PR's lazy-import fallback does not fit the synchronous `databaseRuntimeFromConfig`. Record the owner in the residual note (devops, TASK-033) |
| R1-m5 | MINOR (security flag) | `eslint.config.mjs:97,250` (`TEST_FILES` -> category `test`) together with the new allow at `:393` | "One value importer" (D-ARCH-103 (3)) can be bypassed in two hops. A non-`.test` helper in any `tests/` folder (`apps/api/src/modules/orders/tests/helper.ts`) is category `test`, so it may value-import the generated client; a service or repository may import that helper. Lint probe: both hops clean, and `Prisma.sql` reaches a service. Same class as PR #20 r3 (logging) and PR #34's seam rule; it is not introduced here, but this PR's control relies on it | Route to security-analyst and the lint owner. Fix pattern (as PR34-SEC-01): a final policy "a file outside `test` never imports a `test`-category file", with one negative fixture (service imports `../tests/helper.js`) and one positive (a test imports it). Run `negative-fixtures` on the whole tree, because a production import of `routing/tests/fixture-route.ts` would surface. Due before the first module with a `tests/` helper (TASK-026) |
| R1-m6 | MINOR (security flag) | `.github/CODEOWNERS` (no line for `packages/shared/src/http/credentials.ts`) | Since D-ARCH-109, `presentedKinds` is THE predicate that decides which credential headers the authn slot reads and which responses become private. A change such as making `refresh-cookie` read `authorization` needs no security record, because the file is outside every owned path (checker output). The SEC-TC-29 oracle `tests/api/helpers/cache-control.ts` is unowned too | Add `/packages/shared/src/http/credentials.ts` (and, at the security-analyst's discretion, `/tests/api/helpers/cache-control.ts`) to CODEOWNERS and to `REQUIRED_CODEOWNED_PATHS` if that list pins owned paths. Cheapest in this PR, because CODEOWNERS is already in its owned scope; otherwise 015-C |
| R1-n1 | NIT | `authenticate.test.ts:17`, `authorise.test.ts:20` | **Answer to the brief: the 20 s budget is justified, not masking slowness.** createApp takes 1-4 ms and a request 14-98 ms; the slowest test makes 3 requests, which is at least 15x headroom under the 5 s default. The two FAIL runs were host contention in `quality:heavy` under parallel agents. Two leftovers: a real hang now costs 20 s instead of 5 s per test, and other loopback files (`problem-handler.api.test.ts`, the contract-stub tests) share the exposure | Optional: one shared constant (`LOOPBACK_TEST_TIMEOUT_MS`) in `tools/test-support` instead of two literals, or a project-level `testTimeout` for files that bind sockets; or one server per describe. Keep the comment that cites the runs |
| R1-n2 | NIT | `tools/db/check-prisma-client.mjs:29-38` | (a) It reads only `.prisma` files directly under `schema/`; Prisma multi-file schemas may use sub-folders. (b) A Prisma upgrade without a schema change leaves an old-generator client "fresh". (c) Nothing runs `typegen -w prisma`: the root `typegen` covers web/admin only, so the check is manual (D-ARCH-102 (3) does not require wiring it) | Recurse into `schema/`; also compare against the mtime of `node_modules/prisma/package.json`; optionally chain `npm run typegen -w prisma` into the root `typecheck` (owned file) |
| R1-n3 | NIT | `tests/api/helpers/cache-control.ts:32-45` vs `tests/generated/route-metadata.ts:83-102` | `SCHEME_KINDS` and `COMPANION_SCHEMES` are duplicated. The two copies disagree on an AND requirement (`{bearerAuth, quoteToken}`: the helper flattens it to two alternatives; `contractAuth` reports `session+quote-token`) and on a companion-only requirement. Both fail closed for `Cache-Control`, and the binding rules forbid both shapes today | Move both maps to one module, e.g. `tools/openapi/contract.ts` (both already import it), or add a parity test |
| R1-n4 | NIT | `tests/fixtures/lint/layering/prisma-client-imports/` | D-ARCH-103 (2) names two planned stores. There is a fixture for the audit store's *type* import, but none for a store's *value* import being refused (`prisma-store.ts` with `import { Prisma }`), and none for the outbox writer (`apps/api/src/platform/outbox/writer.ts`) | Add `bad-value` for `prisma-store.ts` and an `ok-type` for `outbox/writer.ts` |

## 3. Deviation rulings (D-TASK020-32..39)

- **D-TASK020-32 (`presentedKinds(headers, declared = all)`; subset check in `authenticate.ts`): sound.**
  - The Proxy test proves an undeclared header is never read.
  - The `RouteAuth[]` assignment is a real compile-time subset check.
  - `presentsCredential` stays the generic test by construction.
- **D-TASK020-33 (route-state flag; the handler trusts the mark): sound in intent; harden it per R1-m1.**
  - The flag is right for the "before the slot ran" arm.
  - The declared arm should be computed from the descriptor, not delegated to every authenticator.
- **D-TASK020-34 (`requireTenantTx`; optional seams for tests only): sound.**
  - `assertPipelineReady` and the tx-slot 503 remain.
  - `RuntimeServices.tenantTx` is non-optional, and M6, M7 and M11 are killed.
- **D-TASK020-35 (fixture-local stand-in, skipped as a lint target): acceptable.**
  - The real bare specifier is covered by 5 repository probes, all present in the evidence JUnit.
  - Lane A runs them after `deps:rebuild`.
- **D-TASK020-36 (the test builds `prisma/client` itself under the lock): acceptable.**
  - The output is git-ignored, and lane A "Build must not mutate the tree" passes.
- **D-TASK020-37 (`extensionProblems` exported for tests): acceptable.**
  - It widens the module surface slightly; no consumer outside tests.
- **D-TASK020-38: acceptable to merge as is; route a config bound (R1-m2).**
  - Failing fast at boot is right, but it should be exit 78 with a named key, decided by `packages/config`.
- **D-TASK020-39: residual accepted; the probe's scope is narrower than stated (R1-m4).**
- **Images (D-ARCH-102 (4)):** correctly deferred to TASK-014 (WAVE-00 line 544 carries the COPY and preflight lines).

## 4. Follow-up closure

- **D-ARCH-102 (1)-(3): met in code.**
  - The generator pins are parsed by a test that also proves the parser sees a dropped option.
  - `exports` has exactly `./client` in condition order.
  - `typegen` is check-only.
  - `db:generate` is the only generating root script.
  - api declares `@platform/prisma` and worker does not; the lock changes by the link.
  - The three resolution modes are all proven: tsc in lane A, Jest via `generated.test.ts`, plain `node` via `prisma-client-package.test.ts`.
- **D-ARCH-103: met.**
  - Value/type policies, the `db-root-client` pattern, type-only re-exports, the `SystemModelsAreDelegates` proof, and the `@ts-expect-error` cases for `$transaction` and the SYSTEM model are all present.
  - CODEOWNERS has the 3 lines. The residual is R1-m5.
- **D-ARCH-104: met.**
  - No `Client` argument; a non-optional runner.
  - Boot tests for api and worker.
  - The entry-point order is pinned by source scan.
  - The Testcontainers test shows probe, 200, and 503 problem+json without reason or SQLSTATE (lane B 3/3).
  - This closes PR #11 R3-m1 (iii) and R3.6 in code. D-TASK020-05 closes when this PR merges (STATUS: orchestrator).
- **D-ARCH-109 (5) / follow-up (a)-(f): met**, apart from the hardening in R1-m1.
  - The `[SEC-TC-29]` tests gain one foreign-credential case per kind.
  - `listCountries` keeps `public, max-age=3600`.
- **D-ARCH-110: met.**
  - Through the real `authorise`: signature with the permission 200, without it 403, session on a signature route 401, signature on a session route 401.
  - The misdeclared-descriptor case refuses as defence in depth.
  - `authenticated` is never set for a provider.
- **PR32-SEC-17: closed by code.** Fail-closed on a non-object `$_terms`, with 3 branch tests (the PR #32 code review R3-n1 request).
- **PR #32 R2-n2: closed** (the storage boundary header names both controls).
- **Still open, unchanged and out of scope (020-C or TASK-100):**
  - PR #32 R2-m1 (Joi `.prefs`, `Joi.link`);
  - R2-m2 (`checkRouteMetadata` wiring);
  - R2-m3 (T-83 shapes).

## 5. Union with PR #34 (now on main as `263b790`): what the union commit must preserve

1. **`eslint.config.mjs` BOUNDARIES_FILES (the only textual conflict).** Keep BOTH:
   - `{ pattern: ['apps/*/src/platform/db/client.ts', 'apps/*/src/platform/db/generated.ts'], category: 'db-root-client' }` (this PR);
   - `{ pattern: 'apps/*/src/platform/db/query-counter.ts', category: 'db-test-seam' }` with its comment (PR #34).
   Do not merge `query-counter.ts` into the `db-root-client` list.
2. **Policy order (auto-merged; verify by eye):**
   - this PR's `prisma-generated` value disallow/allow pair stays directly after `{ from: DATABASE_CODE, allow: PRISMA_TARGETS }`;
   - PR #34's `db-test-seam` disallow/allow pair stays the LAST two entries of `BOUNDARIES_POLICIES`.
   If R1-m5 lands in the same commit, put the new "non-test never imports test" policy before the seam pair, so the seam pair stays last as its comment says.
3. **`package.json` scripts:** both `db:generate` and `test:generated` (auto-merged correctly).
4. **`tools/tsconfig.json`** (auto-merged correctly; keep both):
   - `files` keeps both `generated.ts` and `query-counter.ts`;
   - `include` must NOT regain `../prisma/generated/**/*.ts`;
   - `references` keeps `../prisma/client`.
5. **`negative-fixtures.test.ts`** auto-merges. Run `negative-fixtures -t 'D-ARCH-103'` and PR #34's seam cases on the union, and `tools/repo/test-seams.test.ts`.
6. **Jest projects on the union:** verified, nothing moves into `generated`. Re-run `--listTests --selectProjects integration api` after the union commit as a check.
7. **Fold in R1-M1 and R1-m3 in the same commit**, then fresh lane-B evidence: the head changes non-docs lines (D-ORCH-054).
8. `prisma/tests/db/query-counter.int.test.ts` (PR #34) imports the generated client by relative path under the lock. That is consistent with this PR (D-ARCH-102: relative prisma/tests imports redirect through the project reference); no change needed.

## 6. Merge conditions

1. R1-M1 fixed (restore the deep-freeze block). Recommended with it: R1-m3 (one line) and R1-m1 (the problem-handler arm plus one test). R1-m6 is cheapest here.
2. Union with main per section 5; fresh `quality:heavy --profile pr` evidence on the union head; lane A `fast-lane` with all steps executed.
3. A security record (`docs/05-quality/security/PR-0038-*.md`) naming the final head; `scans` and `ci-gate` green.
4. Routed, not blocking:
   - R1-m2 to the config owner (before TASK-014 / G3);
   - R1-m4 to devops on the first flake;
   - R1-m5 to security-analyst and the lint owner (before TASK-026);
   - NITs at the next touch.
5. Orchestrator:
   - CLAUDE.md §2 gains `npm run db:generate`;
   - STATUS closes D-TASK020-05;
   - the TASK-052/055/091/171/261 sheet lines carry "call `markCredentialsRead` together with the decision" (D-TASK020-33), worded per R1-m1 if it is fixed.

## 7. Good

- The runner activation is a single choke point: `databaseRuntimeFromConfig` builds the client itself, and both entry points are pinned by source scan to one composition and to "startup before listen".
- `requireTenantTx` and `ActiveDatabaseRuntime` turn "runner exists" into a type plus a boot-time refusal, not a convention.
- The Proxy test in `credentials.test.ts` is the right shape for "a foreign header is never read". It proves absence of a read, not just of an effect.
- The authz tests run through the real `authorise` with `readonlySet` principals, plus a misdeclared-descriptor unit case for defence in depth.
- The generator-block test includes a parser self-check (a dropped option is seen), avoiding a vacuous pin.
- The third resolution mode runs plain `node` with empty `NODE_OPTIONS`, exactly the image condition set, and asserts both the resolved path and a driver-level error class.
- The PR body honestly reports two failed evidence runs and the D-TASK020-38/39 residuals.
