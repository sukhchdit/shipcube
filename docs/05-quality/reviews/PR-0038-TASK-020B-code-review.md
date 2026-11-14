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

---

## Round 2 (head 8b3a8ed)

Head reviewed: `8b3a8ed` (full SHA `8b3a8edd39786b63739d8cacd5e3b4c283b29ffe`). Code head `cdd3716`; `8b3a8ed` adds evidence only (`git diff --name-only cdd3716 8b3a8ed` has no path outside `docs/`). Delta reviewed: `a5d135c..8b3a8ed`, which is the union `976edf6` plus 6 fix commits. `origin/main` is still `c0c31a1`, the second parent of the union.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: The union is pure: the merge tree differs from a clean re-merge only by the hand resolution of the one conflict, and the
  policy order meets every section 5 condition. R1-M1, R1-m1, R1-m2, R1-m3, R1-m6, R1-n1 and PR38-SEC-01/-02 are closed, and 11 of 11
  mutants are killed. The R1-m1 design respects D-ARCH-109 (3)/(4). Two new NITs. Merge needs the security record on the final head.
```

### R2.1 What I verified myself

Method: the review worktree (read-only), plus a `git archive` extract of `8b3a8ed` with a `node_modules` junction and a copy of the git-ignored `prisma/generated`. Node 24, no Docker, no installs. The extract and the junction were removed afterwards. The worktree still has 748 `node_modules` entries and `git status` is clean.

| Check | Result |
|---|---|
| Union purity: `git merge-tree --write-tree a5d135c c0c31a1`, then `git diff --stat <tree> 976edf6` | Only `eslint.config.mjs` differs: 4 lines, which are the conflict markers. Every other file is byte-identical to a clean re-merge. `git show --cc 976edf6` shows the resolution: BOTH `db-root-client` entries (`client.ts` and `generated.ts`) and PR #34's `db-test-seam` line with its comment, kept as separate entries |
| Policy order on the head (`eslint.config.mjs`) | The `prisma-generated` value disallow/allow pair (`:390-395`) directly follows `{ from: DATABASE_CODE, allow: PRISMA_TARGETS }` (`:386`). The `db-test-seam` pair (`:542-547`) is the last two entries of `BOUNDARIES_POLICIES`. No R1-m5 policy landed (deferred), so nothing sits after the seam pair |
| Auto-merged files | `package.json` has both `db:generate` and `test:generated`. `tools/tsconfig.json` `files` has both `generated.ts` and `query-counter.ts`, there is no `prisma/generated` include, and the `../prisma/client` reference is kept. `DECISIONS.md` and `STATUS.md` are equal to `c0c31a1` |
| Jest projects on the head (`--listTests`) | unit 176, integration 28 (includes `runner-activation.int.test.ts` and `query-counter.int.test.ts`), api 7 (includes `declared-credentials` and `problem-handler`), generated 0 |
| R1-M1: restored block vs main | The block from `describe('[R2-n1] [PR32-SEC-15] the descriptor is deep-frozen'` to the end of the file is identical to `origin/main` (`diff` prints nothing) |
| Lane A run 43535675720 on `8b3a8ed` | `fast-lane` SUCCESS with no skipped or failed step. `scans` fails only at "Security-owned paths need a review record", and `ci-gate` fails because `scans` failed (expected until the record lands) |
| Evidence `20261114T0021Z_cdd3716` | PASS, profile `pr`, `git_sha` `cdd3716`: unit 4372 (2 skip), api 123, integration 261 (1 skip), catalog 74, 0 failures. The new R1-m1 api tests (3), PR38-SEC-01 (9), PR38-SEC-02/-06 (11), R1-m2 (4) and deep-freeze (2) cases are in the JUnit, and so are the 3 `[D-ARCH-104]` runner-activation int cases that carry the R1-m3 per-key check |
| ESLint `--max-warnings 0` and Prettier `--check` on the 21 non-fixture `.ts`/`.mjs` files of the fix delta, plus `eslint.config.mjs` | clean |
| Targeted unit/api run (extract): define-route, route-state, with-tenant-tx, load-config, process-env, authenticate, authorise, problem-handler | 414/415 in the combined run, with one 5 s timeout described in R2-n2. The same file run alone gives 61/61 |
| Mutation of the fix delta (11 mutants, extract) | **11/11 killed**, see R2.3 |

Not re-run: `quality:heavy`, the Testcontainers suites (including the R1-m3 line in `runner-activation.int.test.ts`), the full unit/api suites, the whole-solution `tsc -b`, and gitleaks. For these I rely on evidence `20261114T0021Z_cdd3716` and on lane A for `8b3a8ed`. The R1-m3 line was checked by reading it: `for (const key of [...]) expect(body).not.toHaveProperty(key)` fails on any single leaked key, which is the r1 fix verbatim.

### R2.2 Closure of the round-1 findings

| ID | Status | Evidence |
|---|---|---|
| R1-M1 | **Closed** (`24e50c7`) | The block is restored verbatim, and mutant M1 is killed (1 failed: "freezes audit (with additional), reauth and deprecated as copies") |
| R1-m1 | **Closed** (`78039f4`) | Details in R2.4. Mutants M2-M6, M10 and M11 are killed |
| R1-m2 / PR38-SEC-05 | **Closed** (`5f6e167`) | Details in R2.5. Mutants M7 and M8 are killed |
| R1-m3 | **Closed** (`24e50c7`) | Each of the four keys is checked separately |
| R1-m6 / PR38-SEC-06 | **Closed** (`c1f4918`) | CODEOWNERS and `REQUIRED_CODEOWNED_PATHS` now include `/packages/shared/src/http/`, `cache-control.ts`, `contract-validator.ts` and `/tests/contract-stubs/`. For each of the 5 lines there are presence tests and three-way mutation tests (deleted, commented out, owner stripped), plus a neighbour test that keeps `packages/shared/src/errors/` and `tests/api/helpers/formats.ts` unowned. The added `'/tests/ @o'` in the minimal complete-coverage fixture (`check-workflow-policy.test.ts:708`) is needed so that fixture stays complete; it does not weaken the test |
| PR38-SEC-01 | **Closed** (`5823507`) | `PRISMA_SOURCES` gains `@platform\/prisma(?:\/.*)?`. It is anchored, so `@platform/prismatic` does not match. The relative path form `../../generated/prisma/client.js` was already covered. Mutant M9 (alternative removed) is killed: 8 fail (1 seeded fixture + 7 repository probes), and the positive probe stays clean |
| PR38-SEC-02 | **Closed for the CODEOWNERS part** (`c1f4918`) | `/apps/worker/src/platform/db/` is owned and required. Narrowing D-ARCH-103 (2) is left to the architect and is optional |
| R1-n1 | **Closed** (`cdd3716`) | `LOOPBACK_TEST_TIMEOUT_MS` lives in `routing/tests/loopback.ts`, a `test`-category helper that only tests import. The remainder is in R2-n2 |
| R1-m4, R1-m5, R1-n2..n4; PR38-SEC-03/-04 | Deferred per D-ORCH-055 | None of them got worse. The `routing/tests/loopback.ts` helper does add another file in a module-adjacent `tests/` folder (the R1-m5 shape), but it has no production importer and value-imports nothing from the generated client |

### R2.3 Mutation results (extract of `8b3a8ed`, each mutant applied alone and restored)

| # | Mutant | Suites run | Result |
|---|---|---|---|
| M1 | `define-route.ts`: `audit: frozenData(spec.audit)` changed to `audit: spec.audit` | define-route | killed (1) |
| M2 | `problem-handler.ts`: the descriptor arm removed | problem-handler.api | killed (3: both R1-m1 cases and the controls) |
| M3 | `routeDescriptorOf` returns the raw local (no `isDefinedRoute` brand) | route-state | killed (1: the forged spread copy) |
| M4 | `declaresPrivateResponse` uses `presentedKinds(headers)` (all kinds) | route-state, problem-handler.api, authenticate | killed (17) |
| M5 | handler last arm changed to `presentsCredential(...)` (ignores `credentialsReadOf`) | problem-handler.api | killed (4) |
| M6 | `declaresPrivateResponse` without `!auth.includes('anonymous')` | route-state, problem-handler.api | killed (3) |
| M7 | `DB_CONNECTION_TIMEOUT_MS_MIN` = 1999 | with-tenant-tx, load-config, process-env | killed (3) |
| M8 | schema back to `t.int(1, 120_000)` | load-config, process-env | killed (3) |
| M9 | `PRISMA_SOURCES` without `@platform/prisma` | negative-fixtures `-t PR38-SEC-01` | killed (8) |
| M10 | descriptor arm uses the generic `presentsCredential` | problem-handler.api | killed (4: the foreign-credential rows) |
| M11 | the authn stub does not call `markCredentialsRead` | authenticate, problem-handler.api, declared-credentials.api, route-state | killed (8) |

The author's claims of "unfreeze mutant killed" and "8 fail" for PR38-SEC-01 are reproduced exactly.

### R2.4 The R1-m1 design against D-ARCH-109

The handler now evaluates three checks in order: `isPrivateResponse(res)`, then `routeDescriptorOf(res)` with `declaresPrivateResponse(route.auth, headers)`, then `!credentialsReadOf(res) && presentsCredential(headers)`. The authn stub uses the same `declaresPrivateResponse`, so the problem handler and the authenticator share one definition.

- **(3) and (4): a foreign credential on a known route is not made private.** `declaresPrivateResponse` counts only `presentedKinds(headers, auth)`, the declared kinds. After the slot read the credentials, the generic arm is off. The route-state table covers this (`[anonymous]` + bearer, and `[anonymous, session]` + quote token or refresh cookie, all `false`), and so do the api rows and the controls (`[anonymous, session]` + `X-Quote-Token` or refresh cookie gives `no-store`, not private). M4, M5 and M10 prove these rows are load-bearing.
- **(4): a declared credential is private, errors included, whatever the authenticator's order.** The replacement authenticator calls `markCredentialsRead` and refuses before it marks. On `[session]` and `[anonymous, session]` the response is now `private, no-store`. That was the r1 probe, now a test.
- **The generic case "error before the authn slot ran" still applies** when the context step recorded the descriptor but authn has not run (`credentialsRead` false). D-ARCH-109 (4) allows this explicitly, and it costs nothing.
- **Order independence.** `markCredentialsRead` can now only switch the generic arm off. It can never hide a declared credential. An authenticator that never calls it makes errors more private, never less. The reworded `route-state.ts` JSDoc ("together with its decision; the order ... does not matter") is accurate.
- **A forged descriptor reads as "no route".** `routeDescriptorOf` requires the `defineRoute` WeakSet brand (M3 is killed by the spread-copy case). The only writer of the local is `setRouteDescriptor` (grep), and `mountRoutes` already refuses unbranded descriptors (PR #32 m2). Combining a forged local with `credentialsRead = true` is therefore unreachable without in-process code that rewrites `res.locals`. If that ever happens, only the private mark decides, so the JSDoc sentence "the handler then keeps the generic credential test" holds only before the slot ran (R2-n1).
- There is no import cycle: `route-state.ts` now value-imports `isDefinedRoute` from `define-route.ts`, and `define-route.ts` does not import `route-state.ts`.

**Ruling on D-TASK020-41: sound.** Keeping `markCredentialsRead` is right, because without it a foreign credential would make every error on an `[anonymous]` route private after the slot (D-ARCH-109 (4) forbids that). The sheet wording proposed for TASK-052/055/091/171/261 is correct.

### R2.5 The config floor (`5f6e167`)

- **Single-key rule.** `DB_CONNECTION_TIMEOUT_MS_MIN = 2_000` feeds `t.int(MIN, 120_000)`. The apps/api parity test pins `MIN === DEFAULT_MAX_WAIT_MS`, builds the runner at the floor, and expects `TenantTxConfigError` at the floor minus 1. That is the exact r1 ask. `resolveTransactionOptions` has no other cross-key rule that reaches config: `timeout` defaults to `statement`, and every other value only needs to be a positive integer.
- **Defaults stay valid.** `.env.example:155` and `compose.env:29` are 5000, and the schema default is 5000. `services.composition.test.ts` uses 2000 (exactly the floor) and the other test configs use 5000. No workflow or Terraform file sets the key (grep).
- **api and worker exit 78.** Both entry points call `loadRuntimeConfigOrExit` (api `main.ts:18`, worker `main.ts:18`). That loader shares `loadValidated` and `exitOnConfigError` with `loadConfigOrExit`, which the new `process-env` test drives for both services: EX_CONFIG and the message `DB_CONNECTION_TIMEOUT_MS: invalid: number.min`. The config check runs before `createRuntimeServices`, so the exit-1 path of r1 is gone for this key.
- The `'1.5'` row in the integer-rejection test became `'2000.5'`. This is right, because `'1.5'` would now be refused as `number.min` first.

### R2.6 New findings

| ID | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| R2-n1 | NIT | `apps/api/src/platform/routing/route-state.ts:59-62` (JSDoc of `routeDescriptorOf`); `apps/api/src/platform/errors/problem-handler.ts:94` | The JSDoc says that for an unbranded value "the problem handler then keeps the generic credential test". That is true only while `credentialsRead` is false. If authn has run and the local was overwritten, only the private mark decides. Unreachable today (single writer, branded mounts) | Either reword it ("reads as no route; before the slot ran the generic test applies"), or fail closed at no cost: `return (route === undefined \|\| !credentialsReadOf(res)) && presentsCredential(req.headers);`. If you take the code change, add a handler test with a forged local plus `markCredentialsRead`. Next touch (020-C) |
| R2-n2 | NIT | `apps/api/src/platform/errors/problem-handler.api.test.ts:205` (pre-existing test, unchanged here) | In my combined cold run (8 suites in parallel, extract plus junction), the first test of this file exceeded the 5 s default once. Alone the file gives 61/61, and lane A and the evidence pass it. This is the R1-n1 exposure I noted in r1: only two files adopted `LOOPBACK_TEST_TIMEOUT_MS` | Apply the constant (or a shared `beforeAll` warm-up request) to the other `createApp` loopback files: `problem-handler.api.test.ts`, `declared-credentials.api.test.ts`, and the contract-stub tests. Next touch, or on the first flake report (TASK-278) |

No BLOCKER, MAJOR or MINOR is new in this round.

### R2.7 Merge conditions

1. A security delta record (`docs/05-quality/security/PR-0038-*`) naming `8b3a8ed` or a later docs-only head, so that `scans` and `ci-gate` go green. The fix commits touch owned paths (CODEOWNERS, `tools/ci`, `eslint-rules`, `apps/api/src/platform`, `packages/shared`/`config`), so this is a delta round, not merge-only.
2. No non-docs commit after `cdd3716`, and no merge of a non-docs `main` change before the squash. Either would make evidence `20261114T0021Z_cdd3716` stale (D-ORCH-054). `origin/main` is `c0c31a1` today, so no re-merge is needed.
3. Squash merge with a linted title.
4. Still routed, unchanged: R1-m4 (devops, on the first flake), R1-m5 with PR34-SEC-07 (before TASK-026), R1-n2..n4 (next touch), PR38-SEC-03/-04 (020-C), and R2-n1/n2 (next touch).
5. Orchestrator:
   - add D-TASK020-40..46 to DECISIONS.md;
   - add the TASK-052/055/091/171/261 sheet wording per D-TASK020-41;
   - add `npm run db:generate` to CLAUDE.md §2;
   - close D-TASK020-05 in STATUS.

### R2.8 Good

- Each fix is its own commit, separate from the union. This made the purity proof a one-line `merge-tree` diff.
- `declaresPrivateResponse` is one definition used by both the authn stub and the handler, and the compile-time `RouteAuth[]` subset check moved with it. Tests that show a forged spread copy reads as "no route" ground the trust in the descriptor in the PR #32 brand.
- The config floor is a named, exported constant tied to the runner by a parity test that checks both sides: the floor builds, and the floor minus 1 throws.
- The CODEOWNERS tests mutate each line three ways and also pin the unowned neighbours, so an over-broad pattern would fail too.
