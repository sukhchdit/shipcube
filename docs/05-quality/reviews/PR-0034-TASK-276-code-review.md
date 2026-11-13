# Code review: PR #34, TASK-276 test harness (round 1)

Reviewer: code-reviewer (principal engineer). Head reviewed: `4643265` (full SHA `46432656db5e625f3af9e4960e2c95642834682d`, merge of main at PR #33 into the three feature commits). Base: `origin/main` (docs-only drift since the merge, `f2f34a7`).

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The factories, fake clock, Mock scenario helper and query counter are sound (counter proven on the real Prisma 7 client with a dead adapter, and over real HTTP). Three MAJORs, all cheap:
  (R1-M1) the folder-decides `generated` project removes the two lane-A suites PR #32 already keeps in tests/generated from `unit`;
  (R1-M2) the leakage guard's afterEach, which IS the acceptance criterion, is a surviving mutant;
  (R1-M3) the advertised base64 encoding misses every embedded occurrence (JWT or Basic-auth style).
  Docker was unavailable, so prisma/tests/db/query-counter.int.test.ts and lane B evidence are open merge conditions.
```

## 1. What I verified myself (and what I did not)

Method: `git archive` extracts of the exact head and of a `git merge-tree` union with PR #32, `node_modules` junction to the main checkout, Node 24, no Docker, no installs, no builds. Scratch folders and junctions removed afterwards; main `node_modules` still 740 entries; worktrees clean.

| Check | Result |
|---|---|
| Targeted unit (8 suites: tests/factories, tests/helpers x3, query-counter.test, tools/repo jest-esm, root-scripts, jest-config) | 79 tests pass |
| `prettier --check` on all 21 changed text files | pass |
| ESLint `--max-warnings 0` on all changed `.ts` | clean in the worktree. In the extract one `import-x/no-extraneous-dependencies` error on `@platform/shared` appears: false failure caused by the junction (the same file lints clean in the worktree) |
| `tsc -p tests/factories` and `tests/helpers` (noEmit) | clean |
| Query counter on the real generated Prisma 7 client (dead adapter at 127.0.0.1:1, hook fires before connect): root `$queryRaw/$executeRaw/$queryRawUnsafe`, model ops, batch `$transaction([..])`, `_createItxClient` (itx model + raw), counter applied before and after another `$extends` | all counted, in order, names only (13 cases) |
| Query counter over real HTTP (Express 5, `express.json()`, router mount, 404) | per-request counts correct (GET 2, POST with parsed body 2, mounted route 1 with route `/api/v1/n/:id`, unmatched 0); AsyncLocalStorage survives the body parser |
| Leakage scanner probes (about 40 vectors, see R1-M3 and the minors) | see findings |
| jest `--listTests` per project on the union of this PR and PR #32 | see R1-M1 |
| Mutation of the guard's afterEach body | survives 15/15 (R1-M2) |
| Security-owned paths checker (`--pr 34`) | `status: missing`: record `docs/05-quality/security/PR-0034-*.md` required (owned: query-counter.ts and its tests, jest.config.ts, package.json, tsconfigs, the two prisma tests) |
| PR #34 + PR #35 merge | clean (`git merge-tree`, no conflicts) |

NOT re-run (Docker unavailable, D-ORCH-049): `prisma/tests/db/query-counter.int.test.ts`, `quality:heavy`, gitleaks, full `test:unit`, full lint and typecheck of the whole solution. For those I rely on the author's table (full unit, lint, format, typecheck pass before the merge of main; 34 suites / 786 tests after it) and on lane A, which is red only on the two expected steps (Lane B evidence, security record).

CI on the head: `fast-lane` FAIL at "Lane B evidence" (steps after it skip), `scans` FAIL at "Security-owned paths need a review record", `ci-gate` FAIL: both expected for a non-docs PR without evidence and record. Not a code finding.

## 2. Findings

| ID | Sev | Where | Problem | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `jest.config.ts:39,65,108,119,138-143` (D-TASK276-01) | The rule "the folder, not the suffix, picks the project" makes `unit`/`unit-dom` ignore `/tests/generated/` and gives `generated` every `*.test.{ts,tsx}` there. PR #32 (reviewed, not merged) keeps two **lane-A unit suites** in that folder, `tests/generated/route-metadata.test.ts` and `contract-drift.test.ts`, plus its `test:contract` script. Proof on the union (jest `--listTests`): `unit` lists neither file, `generated` lists both. Lane A runs `npm run test:unit` only (ci.yml), so route-registry and contract-openapi (TEST-STRATEGY §7, both lane A) silently stop running in the hosted fast lane; `test:contract` then runs only tools/openapi. It is a gap in "no gaps", created by this PR's rule; the tests are not Docker-bound, they are unit tests. The manifest (`required-suites.json`) binds `generated` to lane-B suites (rls, rbac, audit-generator, abuse), all of which need an app or a database, i.e. `*.api.test.ts` / `*.int.test.ts` | Narrow the project to the kinds that need it and keep the suffix rule for plain unit tests. Verified on the union tree: (a) `unit` and `unit-dom` stop ignoring `GENERATED_PATH` (they already ignore `.int/.api` by suffix); (b) `common` (hence `integration` and `api`) keeps ignoring it; (c) `generated` `testMatch: ['**/tests/generated/**/*.{api,int}.test.{ts,tsx}']`. Result: PR #32's two files stay in `unit`, `tests/generated/**/*.api|int.test.ts` run only in `generated`, nothing runs twice, nothing is dropped. Update the config header, `tests/helpers/README.md` ("the generated project owns every test file") and D-TASK276-01, and add a `jest.config` test that lists the projects of three sample paths (plain, `.api`, `.int` under tests/generated). If the orchestrator prefers the folder rule, PR #32 must move both files out of tests/generated before either merges, and that must be recorded as a decision |
| R1-M2 | MAJOR | `tests/helpers/leakage-scanner.ts:216` (the `afterEach` in `useLeakageGuard`), `leakage-scanner.test.ts:101-134` | The acceptance criterion is "the scanner fails a test whose logs contain a sentinel". The only code that does that is the registered `afterEach(() => { try { assertClean() } finally { capture.clear() } })`. No test exercises it: the failing case calls `guard.assertClean()` by hand and then clears the capture so the hook has nothing to find. Mutant: replace `assertClean();` by `void 0;` in the hook, 15 of 15 tests pass. (Deleting the hook entirely does fail two tests, but only by accident, through leftover lines.) | Inject the registration so the hook can be driven: `useLeakageGuard(options, register = afterEach)`. In the test pass a recording `register`, call the captured hook with a dirty capture and assert it throws `LeakageError` AND clears; call it with a clean capture and assert it passes. This kills both the "no assert" and "no clear" mutants without a child Jest process |
| R1-M3 | MAJOR | `tests/helpers/leakage-scanner.ts:9,49` | The module and README advertise base64 coverage, but the needle is `base64(value)` only. Base64 of a larger payload that contains the value encodes it differently unless the value starts on a 3-byte boundary. Probe results (sentinel e-mail): bare `base64(value)` found; `base64('x'+value)`, `base64('xx'+value)`, `base64(JSON.stringify({email:value}))`, a JWT-style `b64url` payload: all **missed**; `Basic base64(value:pw)` found only because it starts at offset 0; base64url (`-`,`_`, no padding) of a value followed by other bytes: missed; upper-case hex: missed. The realistic leak shape (a token or header that carries the e-mail in JSON) is the one not covered, so the scanner is trivially bypassed for it and the doc claim is wrong | For each sentinel generate the three alignments (prefix 0, 1, 2 bytes), take the stable middle of `base64(prefix + value + suffix-padding)` (drop the leading chars that depend on the prefix and the trailing partial quantum), and do the same in the base64url alphabet; add a case-insensitive hex needle. Tests: embed each sentinel at offsets 0..2 inside JSON, a JWT-shaped string and a Basic header, assert found; assert no false positive on 200 random strings |
| R1-m1 | MINOR | `leakage-scanner.ts:188` and `assertClean` | `lines()` returns only newline-terminated lines and `clear()` drops the pending partial line, so a write without a trailing newline is never scanned (probe: `capture.stream.write('x ' + NAME)` gives 0 findings, 0 lines). A destination that writes records without `\n` (a custom `LogDestination`, `process.stdout.write` capture) hides a leak | `assertClean` must also scan the pending remainder (expose `pending()` or fold it into the scanned set); test it |
| R1-m2 | MINOR | `leakage-scanner.ts:135` (child path) | "Findings NEVER carry the value" holds for values but not keys: the child path embeds the raw key. `expectNoLeaks({ [sentinelEmail]: { token: sentinelToken } })` throws a message containing the e-mail (probe: true). Any real e-mail used as a key in a scanned body is echoed into the test report the same way | Render a key into a path only when it matches `/^[A-Za-z_][A-Za-z0-9_]{0,39}$/`, else `<key N>` (the Map branch already does this); test with a sentinel key and a nested hit |
| R1-m3 | MINOR | `leakage-scanner.ts:92-134` | Blind spots, each probed: `Error.cause` and `AggregateError.errors` (non-enumerable) not visited (pino serialises `cause`); `Uint8Array`/`ArrayBuffer` holding the value (only `Buffer` is decoded); objects with no enumerable state but a `toJSON`/`toString` (`URL`, `URLSearchParams`); non-enumerable and symbol keys. `maxDepth` (24) silently **skips** deeper values and the PR's own test asserts that a leak 40 levels deep gives no finding: fail-open | Visit `cause` and `errors`; decode any `ArrayBufferView`; scan `toJSON()` output when present; on depth exhaustion return a `depth-exceeded` finding (cycles are already handled by `seen`) instead of passing |
| R1-m4 | MINOR | `tools/quality/heavy.mjs:81-83` (not in the diff), D-TASK276-01/02 | The two decisions disagree. D-TASK276-02 says activation of the generated suites is "manifest-only (qa-lead)"; D-TASK276-01 says the runner PRs add `generated` to `IN_BAND_PROJECTS`. `JEST_PROJECTS` (heavy.mjs:83) rejects `project: "generated"` too, so a manifest-only activation fails the runner validation. The planned manifest entries already say `jest --selectProjects generated` (rbac-matrix, audit-generator, rls-cross-tenant, abuse) | Either add `generated` to both sets (and `heavy.test.ts`) in this PR (tools/quality is CODEOWNED, voids the lane-B evidence, so one record covers it), or put an explicit owner on the line: TASK-033 (first generated suite) must do it. State it in the sheet or STATUS ROUTED, not only in the PR body |
| R1-m5 | MINOR | `apps/api/src/platform/db/query-counter.ts` (placement) | "Never mounted by the production composition root" is a comment and a PR-body sentence. Nothing enforces it: the file is in the production source tree and is compiled into `dist`, and no lint boundary or test stops `app.ts` or `main.ts` from importing it. I verified today that no composition file imports it | One cheap tripwire: a unit test that walks the static import graph from `apps/api/src/main.ts` and fails if `query-counter` is reachable (or a boundaries rule denying it to non-test importers). Optionally rename to `*.test-support.ts` |
| R1-m6 | MINOR | `tests/factories/rng.ts:79` | Collision-freedom is per (seed, `JEST_WORKER_ID`, `TEST_RUN_ID`), not per test file. Lane B runs integration, api (and later generated) with `-i`, so `JEST_WORKER_ID` is `1` for every file; two files calling `createFactories({ seed: 'x' })` get the same ids, e-mails and slugs. Harmless while each file has its own cloned database, a unique-constraint failure the day two files share one. Nothing sets `TEST_RUN_ID` anywhere. "Parallel workers never collide" is true, "no collision" is not | Document "one seed per file when a database is shared" in the JSDoc and README, or fold the Jest test path (`expect.getState().testPath`) into the run hash when available |
| R1-m7 | MINOR | `tests/helpers/fake-clock.ts:69-79` | Restore safety relies on the caller: `installFakeClock()` has no automatic restore, and a test that fails before `uninstall()` leaves fake timers on for the rest of the file, including `afterAll` hooks that await Testcontainers stop (timers faked, `setImmediate` faked by default). `withFakeClock` is safe; the README only says "call uninstall in afterEach" | Add a describe-level `useFakeClock(options)` that registers `beforeEach` install and `afterEach` `jest.useRealTimers()`, make it the documented default, with a test that a throwing test does not leak (same injected-register technique as R1-M2) |
| R1-n1 | NIT | `tests/factories/factories.ts:120`, `fake-clock.ts:12` | The same instant is defined twice (`FIXED_CREATED_AT`, `FIXED_NOW`) | Import `FIXED_NOW` |
| R1-n2 | NIT | `rng.ts:57` | `uuid()` is version-7 shaped but random: ids do not sort by creation. A test that relies on id order (keyset pagination) will pass or fail by seed. Also the generator state is 32 bits, so a stream is a window of one 2^32 cycle; fine for tests, worth one JSDoc line | Document it |
| R1-n3 | NIT | `factories.ts:176-232` | `membership.orgId`, `quote.orgId`, `shipment.quoteId` ... are independent random uuids: records are not relationally coherent unless overridden (D-TASK276-05 says placeholders). | One line in the README so module tasks do not assume coherence |
| R1-n4 | NIT | `query-counter.ts:118` | `completed = [...completed, x].slice(-1000)` copies up to 1000 entries per request | `push` + `shift` when over the bound |

### Deviation rulings

| Decision | Ruling |
|---|---|
| D-TASK276-01 (folder picks the project) | **Not accepted as written**: R1-M1. The narrowed form (suffix for unit tests, folder for the generated project) is accepted |
| D-TASK276-02 (no manifest edit, activation is manifest-only) | Accepted for the manifest; contradicts D-TASK276-01 on heavy.mjs: R1-m4 |
| D-TASK276-03 (count Prisma operations, not SQL statements; raw tenant statement counted; production-unmounted) | Accepted and proven on the real client. The unmounted claim needs R1-m5. Note the budget arithmetic: `withTenantTx` issues exactly one raw statement (`with-tenant-tx.ts:214`), so the int test's `rawCount 1` is right |
| D-TASK276-04 (sentinels derived with SHA-256, never literals) | Accepted; the source-scan test pins it. Observation for security-analyst below |
| D-TASK276-05 (placeholder record shapes) | Accepted (R1-n3) |
| D-TASK276-06 (`fail=` repeatable, rendered sorted) | Accepted: matches REQ-CARR-005/DR-B29 and api README §X-Mock-Scenario; vocabulary and 30000 ms limit checked against REQUIREMENTS.md:396/797 |
| Folded items (afterAll 60 s on seed.int and spk03; `testTimeout` 30 s on integration and generated) | Accepted. Lane B's own `--testTimeout` overrides it, as the comment says |
| D-ORCH-038 / D-ORCH-040 | Met: no helper creates or deletes temp dirs; the branch does not touch DECISIONS.md or STATUS.md |

## 3. Union with PR #32 (whoever merges second)

`git merge-tree` of the two heads: `jest.config.ts` and `package.json` auto-merge cleanly (the `api` project gains `globalTeardown`, the new project follows it); the other conflicts (app.ts, main.ts, runtime-seams, contract-validation, tools/openapi/api-mounts.ts) come from PR #32 vs main (PR #20), not from this PR. Steps:

1. `tools/repo/jest-esm.test.ts` conflicts on the script list. Union: `['test:api', 'test:contract', 'test:coverage', 'test:generated', 'test:integration', 'test:unit']`.
2. Semantic (R1-M1): with the narrowed project definition nothing else is needed; `test:contract` (`jest tests/generated tools/openapi --selectProjects unit`) keeps finding `route-metadata.test.ts` and `contract-drift.test.ts`. With the folder rule it would not, and `npm run test:unit` loses them too.
3. `tools/tsconfig.json`, `tsconfig.json`: PR #32 edits `tools/tsconfig.json` (system-db files) and this PR adds one `files` line: auto-merged clean; recheck after the union (`npm run typecheck`).
4. Both PRs are non-docs: the second merger needs fresh lane-B evidence on an ancestor of its head (D-ORCH-034).

## 4. Follow-up closure

| Item | Status |
|---|---|
| PR #26 review n6 (afterAll 5 s Testcontainer stop) | Closed here (60 s explicit, project timeout 30 s) |
| PR #26 R4-m1 SEC-18 ratio | Not applicable to this diff (as the PR says) |
| T-QA-03 pieces not delivered (template DB per worker, OpenAPI validator helper) | Routed correctly in the PR body (prisma/tests/harness, TASK-017 helpers) |

## 5. Security flags (for security-analyst)

- D-TASK276-04 observed that the platform logger redacts token, secret and e-mail values but **not** name, tax-id or Luhn-valid PAN values placed in a free `detail` field (the scanner test shows the PAN and name pass through). Confirm that this is intended for the logger (key-based redaction, free-text patterns) and that NFR-PRIV-001 / SEC-TC-52 do not require PAN redaction in free text; otherwise it is a logging gap, not a harness one.
- `jest.config.ts`, `package.json`, `apps/api/src/platform/db/**` and `prisma/tests/**` are owned paths: a record `docs/05-quality/security/PR-0034-*.md` naming the final head is required.
- The leakage scanner is a privacy control in test form; R1-M3 and R1-m1..m3 are false negatives in it, not in the product.

## 6. Merge conditions

1. Fix R1-M1, R1-M2, R1-M3 (round 2 = delta check: the three mutants must die, the projects table on the union tree must show no double run and no gap). R1-m1..m7 in-PR where cheap, otherwise named owners (R1-m4 must have one).
2. Lane B evidence once Docker is back: `quality:heavy --profile pr` with `unit` and `integration`, **including `prisma/tests/db/query-counter.int.test.ts` executing** (4 tests), and the new `generated` project resolving with `--passWithNoTests`; evidence commit on an ancestor of the final head, no later non-docs commit (a security-record or docs-only commit is fine).
3. Security record PR-0034 on the final head.
4. Squash with a conventional-commit title; merge order relative to PR #32 as in section 3.

## 7. Good

- Seeded streams forked per entity, so adding a call to one factory cannot shift another (tested).
- Sentinels derived by SHA-256 so no credential-shaped literal exists, with a test that scans the source for the values.
- Findings carry ids, places and encodings, never values, and the PR tests that for values.
- Query counter records before the call (a failing query still cost a round trip), scopes by AsyncLocalStorage, names only, bounded history; proven on the real client, itx and batch included.
- Mock scenario builder renders canonically, with a parse(render(s)) property.
- Honest gate table: the int test is stated as not executed.

## 8. Handoff

Round 2 = delta check on R1-M1..M3 plus the mutants above. Expected verdict after the fixes: APPROVED_WITH_NITS.
