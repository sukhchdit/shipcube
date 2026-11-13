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

---

## Round 2 (head 3934d12, delta)

Reviewer: code-reviewer role (delta check dispatched together with the security round 2; read-only, written by the security-analyst in that capacity). Head reviewed: `3934d12` (full SHA `3934d1224f090701c8c5ca230633971e19cf9d0d`). PR base `d693e8c` (the `main` code tip: `origin/main` is `e1805a5`, which differs from it by 5 docs and agent-memory files only). Commits since round 1 (`4643265`): merge `422607d` (main `6420f90`), fix `8aa5b66`, fix `81bea01`, merge `030fae9` (main `d693e8c`, which carries PRs #35 and #36), evidence `3934d12`. The PR's own change against `d693e8c` is 35 non-docs files, +2,527 / -10, plus the 7 evidence files.

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R1-M1, R1-M2 and R1-M3 are fixed, and so are R1-m1..m7 and the folded n-items; every fix is pinned by a test that now fails when the fix is mutated away (61 mutants of the PR's own code: 54 killed, 1 equivalent, 6 explained below). The two merges are pure unions. Lane A is green on this head except the security-record step. Two MINOR test-strength gaps (R2-m1, R2-m2) and three NITs are new; none is a BLOCKER or MAJOR, and fixing them on this branch would void the lane B evidence for no product gain, so they go to named next touches.
```

### R2.1 What I ran

Method: `git archive` extracts of the head, of `4643265` (round 1), of `d693e8c` (main) and of the `git merge-tree` union of the head with PR #32's head (`5eee2d0`); `node_modules` as a directory of junctions to the main checkout with `@platform/*` re-pointed at each extract; Node 24; no Docker, no installs, no builds. The scratch trees and junctions were removed afterwards. Every mutant was applied to an extract, run against the owning Jest suite and restored (the restored files are byte-equal to the head blobs).

| Check | Result |
|---|---|
| Lane A on the head (run 43496097102) | `fast-lane` green end to end: commitlint, Lint, Format check, actionlint, Type-check, Unit tests, "Lint negative fixtures from the base ref against the head configs", Build, "Lane B evidence". This is the first time lint, type-check, unit and build ran in CI for this PR. `scans`: Gitleaks, Semgrep, OpenAPI green; red only at "Security-owned paths need a review record" (the companion record), so `ci-gate` is red for that reason alone |
| Targeted unit suites on the extract (leakage scanner 51, fake clock 9, factories 14, query counter 13, jest-projects 13, test-seams 2, jest-config-owned 4, heavy 22, root-scripts, jest-esm, helpers) | 11 suites, 157 tests, all pass |
| `jest --listTests` per project, `main` to head | 0 files dropped from any project; unit 149 to 156 (+7: the PR's own tests), integration 25 to 26 (`query-counter.int`), unit-dom 12, api 6, generated 0 (no generated suite exists yet) |
| `jest --listTests` on the union with PR #32 | `tests/generated/route-metadata.test.ts` and `contract-drift.test.ts` are in `unit` and in no other project; 0 files in two projects; unit 172 (PR #32's own move of `tools/openapi/drift.test.ts` to `tests/generated/contract-drift.test.ts` accounts for the one name that disappears) |
| Nine planted files (`tests/generated/` with `.test.ts`, `.api.test.ts`, `.int.test.ts`, `.test.tsx`, `.api.test.tsx`, `.int.test.tsx`, a nested one, plus `tools/ci/tests/generated/` and `apps/api/src/tests/generated/`) through real Jest | plain `.test.ts` to `unit`, plain `.test.tsx` to `unit-dom`, every `.api` / `.int` file to `generated` and to no other project. The `tools/repo/jest-projects.test.ts` map (modelled with `path.posix.matchesGlob` and `RegExp`) agrees with real Jest on all nine |
| Effective `jest.config.ts`, `main` to head, every leaf | coverage provider, `collectCoverageFrom`, `coverageThreshold`, `SWC_JEST_OPTIONS` (`swcrc: false`), `modulePathIgnorePatterns` (`/__mocks__/`), roots, environments, `transform`: equal. Differences: `api` and `integration` gain the `/tests/generated/` ignore, the new `generated` project (spreads `common`). Round 1 to head: `unit` and `unit-dom` lose that ignore (they equal `main` again), both inert `testTimeout` values are gone |
| Merge `422607d` and merge `030fae9` | `git merge-tree` of each merge's two parents equals the merge commit's tree: pure unions, no evil edit |
| Scanner probe on the head's real `leakage-scanner.ts` (type-stripped, 243 rows) and the same rows on the round-1 build | head: 188 expect-hit rows hit, 43 expect-gap rows gap, 8 rows differ from my expectation (all explained in R2.3); round 1: 124 rows differ (positive control) |
| Mutation run, 61 mutants | 54 killed, 7 survived: 1 equivalent (identical-needle de-duplication), 2 are my "is a weakening visible" controls aimed at a suite that is not the pin (the swcrc mutant dies in tools/ci/jest-transform.test.ts, 3 of 3 fail; the coverage threshold is leaf-equal to main), 4 are real test-strength gaps (R2-m1, R2-m2 twice, R2-n3) |

NOT re-run by me: Docker suites (`prisma/tests/db/query-counter.int.test.ts` and lane B). I rely on the accepted evidence run `20261113T1943Z_030fae9` (base-ref `check-evidence` PASS on both the `d693e8c` and the `e1805a5` tooling), which shows `query-counter.int.test.ts` executing, 4 of 4 passing.

### R2.2 Round 1 closure

| ID | Status | Proof |
|---|---|---|
| R1-M1 | **Closed** | Suffix picks the project, `generated` is `tests/generated/**/*.{api,int}.test.{ts,tsx}`. Union with PR #32 and the nine planted files above. Three mutants (r1 testMatch, `unit` ignores the folder again, `common` stops ignoring it) die in `jest-projects.test.ts` (3, 2 and 3 failures). Header, README and D-TASK276-01 (superseded entry in DECISIONS) are updated |
| R1-M2 | **Closed** | `useLeakageGuard(options, register = afterEach)`. Mutating the hook body `assertClean()` to `void 0`: 1 of 51 fails (was 0 of 15). `capture.clear()` dropped: 7 fail. Hook never registered: 4 fail. Default registrar replaced by a no-op: 2 fail. `assertClean` ignoring extra values or log lines: 1 and 3 fail |
| R1-M3 | **Closed** | Three byte alignments for base64 and base64url, case-folded text, hex in any case. Mutants: alignments reduced to `[0]`, `[0,1]`, `[0,2]` (19 fail each), start ceil to floor (18), end floor to ceil (16), base64url dropped or not translated (1 each), needle minimum length 16 to 1 (1), hex case-sensitive (1), case-folded needle dropped (2), base64 compared case-insensitively (1). Probe: the five text sentinels at offsets 0, 1, 2 as bare base64, with a trailing byte, inside JSON, base64url without padding, `Basic user:value`, `Basic value:pw`, JWT payload and inside a JSON log line: all hit; round 1 missed 68 of the base64, base64url, Basic and JWT rows (124 rows differ from expectation on that build) |
| R1-m1 | Closed | Pending last line scanned and CR stripped (also across chunks); 3 failures when the tail is dropped, 1 each when CR is not stripped |
| R1-m2 | Closed | Keys never echoed: 11 shapes (sentinel as key, inside a longer key, PAN, base64, hex, percent and upper-case spellings, Map key, symbol description, nested) show 0 echoes; 4 mutants die |
| R1-m3 | Closed | `cause`, `AggregateError.errors`, typed arrays, `ArrayBuffer`, `DataView`, `URL` (via `toJSON`), `URLSearchParams`, `Headers`, non-enumerable and symbol keys all hit; depth overflow is a `DEPTH_LIMIT` finding (a clean 40-level object now fails by design; `maxDepth` is the lever). Each branch has a killed mutant. Residuals in R2.3 |
| R1-m4 | Closed | `heavy.mjs` accepts `generated` in `JEST_PROJECTS` and runs it in band (`-i --testTimeout`); D-TASK276-02 amended. Both set edits have killed mutants in `heavy.test.ts` |
| R1-m5 | Closed | `db-test-seam` boundaries policy with lint fixtures plus `tools/repo/test-seams.test.ts`; behaviour in the security record (PR34-SEC-01) |
| R1-m6 | Closed | The run identity folds in the Jest test file (relative to the working directory): two mutants die in `factories.test.ts` |
| R1-m7 | Closed with a gap | `useFakeClock()` exists and installs before each test, but the test that should pin the restore is too weak (R2-m1) |
| R1-n1..n4 | Not changed | `FIXED_NOW` duplication, v7-shaped random ids, placeholder graphs and the 1,000-entry array copy are untouched or documented; nits stay nits |
| PR #26 review n6 (afterAll 5 s) | Closed | `afterAll(..., 60_000)` in `seed.int` and `spk03`, no project-level timeout |

### R2.3 New findings

| ID | Sev | Where | Problem | Fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `tests/helpers/fake-clock.test.ts` ("restores real timers after a test that threw before cleaning up") | The test advances the fake clock by 1,000 ms and then asserts `Date.now() > FIXED_NOW`. A fake clock that is still installed reads `FIXED_NOW + 1,000`, which also passes. Removing `jest.useRealTimers()` from the `useFakeClock` after-each hook survives (9 of 9). This is the guarantee R1-m7 asked for | Assert `Date.now() > FIXED_NOW + 60_000` after the hook (real time is months later), or check `setTimeout` is not the fake one |
| R2-m2 | MINOR | `tools/repo/test-seams.test.ts` (the `apps/*/src` walk) | The planted-string control proves the regexes, not the walk. Pointing the scan at a non-existent folder, or exempting every file, still passes (2 of 2), so the tripwire can go silent unnoticed. The lint policy is the primary arm and is pinned by fixtures (seven of eight policy mutants die; the eighth widens the seam category to the whole db folder, which only the full lint would catch), so this is a tripwire-strength gap | Count the files scanned (`> 0`) and run the same walk over a temp tree holding a planted `apps/x/src/app.ts` that imports the seam (must be reported) |
| R2-n1 | NIT | `leakage-scanner.ts:178` | `Reflect.get(value, 'toJSON')` sits outside the `try`, so a throwing `toJSON` accessor aborts the scan (the test pins a throwing `toJSON` function only). It fails closed, but the header says "A throwing getter is skipped" | Move the read into the `try` |
| R2-n2 | NIT | `createLogCapture().stream.write` | `pending` is re-split on every write: 8,000 unterminated 10-byte writes take 35 ms, 32,000 take 1.7 s (superlinear). Only a destination that never writes a newline hits it | Split from the last `\n` only |
| R2-n3 | NIT | `tools/repo/jest-projects.test.ts` | The map has no `node_modules` or `dist` row under `tests/generated/`, so the `generated` project's own ignore list is unpinned (survivor) | One more row |

Probe rows that differ from my expectation and are not findings: four `base64 of UPPER value` rows (those four sentinels are already upper-case, so a hit is correct); functions with own properties are not walked (documented by the `typeof` guard); a `Uint16Array` holding UTF-16 text is decoded as UTF-8 (contrived); a PAN as a JSON array of groups, three or more separators, a thin space (U+2009) and a grouped PAN directly followed by more digits are not found (contrived, routed in the security record as INFO PR34-SEC-08). Scaling: 11 adversarial shapes at 8 KiB, 32 KiB, 128 KiB and 1 MiB show ratios of 1.6 to 10.8 at 128k/8k (linear is 16), 1 MiB in 2.3 to 34 ms; 300,000 small objects scan in 1.9 s.

### R2.4 Deviation rulings (decisions as now on main)

| Decision | Ruling |
|---|---|
| D-TASK276-01 (superseded: suffix picks the project; `generated` takes only `*.api` / `*.int` under `tests/generated/`) | Accepted; this is the narrowed form R1-M1 asked for |
| D-TASK276-02 (amended: `heavy.mjs` accepts `generated`) | Accepted |
| D-TASK276-03 (amended: seam enforced by policy plus scan) | Accepted; see R2-m2 for the scan's strength |
| D-TASK276-05 (amended: run identity hashes the test file) | Accepted |
| D-TASK276-07 (no project-level `testTimeout`) | Accepted; verified in the effective config |
| D-TASK276-08 (`DEPTH_LIMIT`, `case-folded`) | Accepted |
| Lazy `PrismaPromise` fix (`81bea01`) | Accepted: `measure()` awaits the measured function inside the `AsyncLocalStorage` scope. Found by the first real run of the integration test (0 instead of 1), pinned by a thenable unit test (reverting the line: 1 of 13 fails; a variant that returns the thenable un-awaited inside the scope: 1 fails) and by the integration test executing 4 of 4 in the accepted run. `middleware()` is unaffected (it runs `next` inside `storage.run`) |

### R2.5 Union with PR #32 (whoever merges second)

`git merge-tree` of the head and PR #32's head (`5eee2d0`): `jest.config.ts`, `package.json` and `tools/tsconfig.json` auto-merge cleanly. Three textual conflicts, each two independent additions side by side: `eslint.config.mjs` (this PR's `tests/helpers/leakage-scanner.test.ts` allowance and PR #32's `tests/generated/**/*.ts` allowance: keep both blocks), `tools/lint/negative-fixtures.test.ts` (the two seam cases and PR #32's root-client case: keep both), `tools/repo/jest-esm.test.ts` (script list, union `test:api`, `test:contract`, `test:coverage`, `test:generated`, `test:integration`, `test:unit`). R1-M1 needs nothing else: after the union both PR #32 suites stay in `unit` (listing above). The second merger needs fresh lane B evidence (D-ORCH-034) and a merge-only security round (shared owned paths).

### R2.6 Merge conditions

1. None open for this head. The nits (R2-m1, R2-m2, R2-n1..n3) are routed to the next touch of `tests/helpers` and `tools/repo/test-seams.test.ts`: the `redaction` / `log-scan` activation PR (US-008, T-QA-05) or the API test app builder PR, whichever lands first (test-engineer). Do not fix them on this branch: any non-docs commit stales the accepted lane B run (D-ORCH-034) and the PR is otherwise ready.
2. Security record PR-0034 at `3934d12`: PASS_WITH_FOLLOW-UPS (companion round 2).
3. Squash with a conventional-commit title; order against PR #32 as in R2.5.

---

## Union re-check (head 2e5e16f)

Reviewer: code-reviewer. Head `2e5e16f` (full SHA `2e5e16fa73c3bee85d71e274afe9c3593ead59fa`), `origin/main` `60540ef`. Commits since the approved head `3934d12`: merge `0dc5fbb` (main `62f799e`, which carries PR #32 `f883d68` and PR #37 `ca54ae7`), semantic fix `6b62d35`, merge `5b08fe8` (main `60540ef`, docs only), evidence `2e5e16f` (7 files under `docs/05-quality/tests/runs/20261113T2217Z_5b08fe8/`). Scope per dispatch: union correctness only; no full re-review. Light commands only (git, `jest --listTests`, `gh`); no Docker, build, lint or test run by me.

```
VERDICT: APPROVED
SUMMARY: Both merges are pure unions. The only hand edits are the three reported conflict hunks, each keeping both sides; the only post-approval code change is 6b62d35, which follows the standard-columns systemDelegates pattern exactly. PR #32's tests/generated/*.test.ts run in `unit` only, and no file is in two projects. Lane A fast-lane is green on 2e5e16f. The only red check is the security-record step, which is merge condition 2. The round-2 nits stay routed as before.
```

### U.1 Checks

| Check | Method | Result |
|---|---|---|
| (a) Single-side files byte-equal | MB = `git merge-base 3934d12 60540ef` = `d693e8c`. Files changed on both sides (`comm -12`): `eslint.config.mjs`, `jest.config.ts`, `package.json`, `tools/lint/negative-fixtures.test.ts`, `tools/repo/jest-esm.test.ts`, `tools/tsconfig.json`. For every branch-only file, `git diff --quiet 3934d12 2e5e16f`. For every main-only file, `git diff --quiet 60540ef 2e5e16f` | Main-only: 0 differ. Branch-only: 1 differs, `prisma/tests/db/query-counter.int.test.ts`, which is exactly the `6b62d35` fix (the only file in that commit). The file set of `60540ef..2e5e16f` is the branch set of `d693e8c..3934d12` plus the 7 new evidence files, and nothing else |
| Merges are pure unions | `git merge-tree --write-tree` of each merge's two parents, then `git diff` of that tree against the merge commit | `5b08fe8`: identical tree (clean merge). `0dc5fbb`: differs only by the conflict markers in the three reported files. The auto-merged `jest.config.ts`, `package.json` and `tools/tsconfig.json` match a clean re-merge byte for byte |
| (b) `eslint.config.mjs` | `git show --cc 0dc5fbb`. Also compared the ordered `files:` sequence of the config blocks at base, branch, main and head | The resolution keeps the PR's `tests/helpers/leakage-scanner.test.ts` block, then main's `tests/generated/**/*.ts` block with its anchored `no-relative-packages` ignore. It drops `tools/openapi/drift.test.ts`, which PR #32 deliberately replaced; that file no longer exists. Block order at the head = main's order plus the one PR block in the position it had on the branch (main to head diff: 1 added line; branch to head diff: exactly main's edits). The two globs do not overlap, and none of main's 7 new blocks matches `tests/helpers/**`, so flat-config precedence for both allowances is unchanged |
| (b) `negative-fixtures.test.ts` | `--cc` hunk | Keeps both seam cases (PR34-SEC-01: `bad-app.ts`, `bad-counter.service.ts`) and the tx-slot root-client case (PR11-SEC-09). All three fixture files are tracked at the head. Bracket structure is correct (the `],[` split was added) |
| (b) `jest-esm.test.ts` | `--cc` hunk | Sorted union: `test:api, test:contract, test:coverage, test:generated, test:integration, test:unit`. This matches the 6 jest scripts in the head `package.json`, as R2.5 predicted |
| (b) Auto-merged files | `git diff 60540ef 2e5e16f` | `package.json`: only `+test:generated`. `jest.config.ts`: the PR's own delta (header, `GENERATED_PATH` in `common`, `generated` project after `api`), and main's `api.globalTeardown` is kept. `tools/tsconfig.json`: `+query-counter.ts`, sorted next to main's `system-*.ts` lines |
| (c) Project partition on the head | `jest --listTests --selectProjects <p>` for each project | unit 172, unit-dom 12, integration 27, api 6, generated 0. `tests/generated/route-metadata.test.ts` and `contract-drift.test.ts` are in `unit` only; 0 files are in two projects. `unit` overrides `testPathIgnorePatterns` (no `/tests/generated/`), so `common`'s new ignore does not reach it. `test:contract` (`jest tests/generated tools/openapi --selectProjects unit`) still lists both suites plus the 3 `tools/openapi` tests. This agrees with the developer's listing and with the R2.1 union listing |
| (c) Executed, not only listed | Evidence `20261113T2217Z_5b08fe8` (`unit.junit.xml`, `integration.junit.xml`) | Both `tests/generated/*.test.ts` appear as `unit` testcases. `prisma/tests/db/query-counter.int.test.ts` runs 4 of 4 in `integration`. Verdict PASS (unit 4252, integration 258, api 101, catalog 74; 0 failures). `5b08fe8` is an ancestor of the head, and the only later commit is docs-only |
| (d) Semantic fix `6b62d35` | Compared with `prisma/tests/rls/standard-columns.int.test.ts:19,124-241`, `apps/api/src/platform/db/system-db.ts:28`, and the `platform/system-model-owner` lint scope | Same import (`../../../apps/api/src/platform/db/system-db.js`) and the same `systemDelegates(tx).referenceDatasetVersion.<op>` form inside `withTenantTx`. The assertions are unchanged (`rawCount 1`, model ops `['findMany']`, budget 2): the accessor adds no query, and the evidence run confirms this. The other `referenceDatasetVersion` reads in the file use `counted`, the root `PrismaClient`, not a `TenantDb`, so they are correctly untouched. No other branch file reads a SYSTEM delegate. The owner lint covers `apps/*/src` and `packages/*/src` minus tests, so `prisma/tests` is outside it, as for standard-columns |
| CI on the head (run 43519334443) | `gh pr view 34 --json statusCheckRollup` and `--log-failed` | `fast-lane` SUCCESS. `scans` FAILURE only at "Security-owned paths need a review record": the PR-0034 record names `4643265` / `3934d12`, and owned paths (`eslint.config.mjs`, `jest.config.ts`, `package.json`, `query-counter.int.test.ts`, `negative-fixtures.test.ts`, `tools/tsconfig.json`) changed after `3934d12`. `ci-gate` is red for that reason alone |

### U.2 Findings

None. No BLOCKER, MAJOR, MINOR or NIT is introduced by the union or by `6b62d35`. R2-m1, R2-m2 and R2-n1..n3 stay open and routed as in R2.6.

### U.3 Merge conditions (replace R2.6 items 2 and 3)

1. No code change. Any non-docs commit on top of `2e5e16f` makes the `5b08fe8` lane B evidence stale (D-ORCH-034).
2. A merge-only security round: record `docs/05-quality/security/PR-0034-*.md` with a `Branch / head` row naming `2e5e16f`, or a later docs-only commit, and a PASS-family verdict, committed on the branch. Then `scans` and `ci-gate` must be green on the final head.
3. Squash merge with a conventional-commit title. PR #32 is already on main, so there are no ordering constraints left.
