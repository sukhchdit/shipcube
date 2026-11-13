# PR-0038 / TASK-020 part 020-B: generated client package, runner activation, declared credential kinds and the signature-only gate (round 1)

| Field | Value |
|---|---|
| PR | #38 `feat(api): generated client package, runner activation and declared credential kinds (TASK-020)`, https://github.com/sukhchdit/shipcube/pull/38, branch `feat/TASK-020-b-prisma-client-package`. Seven commits (`85dd592`, `7c2c11c`, `fef633c`, `5aafb2c`, `d0a64dd`, `4d8bf4f`, evidence `1bea3cf`) and three merges of `main`, the last of them `bdf009d`. Merge base `f782d95`. `main` has since moved to `ea56793`: PR #34 merged as `263b790`, plus docs, including this PR's code review record |
| Head | bdf009d37945e9a56d5d63840120a55a5426d1e4 |
| Lane A evidence | Run [43523962597](https://github.com/sukhchdit/shipcube/actions/runs/43523962597) on `bdf009d`. `fast-lane` **success**, with every step executed: base-ref gates, workflow policy, install flags, migrations immutability, lockfile provenance and delta, cooldown, `npm ci --ignore-scripts`, licences, registry signatures, audit + osv, lane-B `check-evidence`, `deps:rebuild`, commitlint, lint, the lint-mutation check, format, actionlint, type-check, unit, base-ref negative fixtures, build and the build-mutation check. In `scans`, Gitleaks, Semgrep and oasdiff are green. Only "Security-owned paths need a review record" failed, which also failed `ci-gate`; this file is that record |
| Lane B evidence | `docs/05-quality/tests/runs/20261113T2251Z_cb7c12e`, profile `pr`, verdict PASS: api 120, catalog-c1-c14 74, integration 257 (1 skip; includes `runner-activation.int.test.ts` 3/3), unit 4226 (2 skip). `git_sha` is `cb7c12e`. The lockfile and manifest SHA-256 equal the head's (recomputed). `cb7c12e..bdf009d` adds only the evidence commit and a merge that brings 7 `docs/` and `.claude/agent-memory/` files |
| Owned paths changed | 47 (real checker, §9): `apps/api/src/platform/**` (22), `tests/fixtures/lint/**` (9), `prisma/**` (4), `tools/db/**` (3), `tools/lint/**` (2), and one each of `.github/CODEOWNERS`, `eslint.config.mjs`, `package.json`, `package-lock.json`, `apps/api/package.json`, `apps/api/tsconfig.json`, `tools/tsconfig.json`. **Not owned** (record stays valid if they change; see PR38-SEC-06): `packages/shared/src/http/credentials.ts`, `packages/shared/src/index.ts`, `tests/api/**`, `tests/contract-stubs/**` |
| Reviewer / date | security-analyst, 2026-11-14, round 1. Read-only on code. Git ran in the main checkout against commit SHAs, plus one sparse `git clone --shared` in scratch that is checked out only at simulated commits. Probes: ESLint `lintText` (in-memory, nothing written) with the PR worktree's real `eslint.config.mjs` and `node_modules`; type-stripped head sources from a `git archive` extract under a resolve/load hook; read-only greps of the PR worktree's generated client and `node_modules/express`. No git command, install, build or Docker run in the PR worktree. Its only change is this file |

## 1. Summary

Part 020-B does what D-ARCH-102..104, 109 and 110 ask, and the security-relevant behaviour holds under probing.

- **Credential kinds (D-ARCH-109).** The authn slot reads only the headers of the kinds in `route.auth`.
  - A recording Proxy over the headers shows zero reads for `[anonymous]` and `[signature]`. It shows exactly `authorization`, `cookie` or `x-quote-token` for the matching declared kind, and nothing for junk entries such as `__proto__`, `constructor`, `Session` or `session `.
  - In the contract, the refresh cookie is declared only by `refreshSession`, `logoutSession` and `getCsrfToken`.
  - The stub is still fail-closed. Its only non-401 exit is the anonymous principal, on a set that contains `anonymous`, when no declared kind is present.
- **Signature-only gate (D-ARCH-110).**
  - A `signatureOnly` permission needs credential `signature` plus the held permission.
  - Every other catalogued permission keeps actor (401), then held (403).
  - `PERMISSION_AUTH` / `SIGNATURE_AUTH` bind the sets at boot.
  - No bypass found (§5.2).
- **Runner activation (D-ARCH-104).** One composition, a non-optional runner, `errorFormat: 'minimal'` and no query logging.
  - The Testcontainers test proves the fresh-connection probe and a tenant route inside the runner's transaction.
  - It also proves a 503 problem with no SQLSTATE or reason, on PostgreSQL 18 as `platform_app`.
  - The SYSTEM-model exclusion of `TenantDb` (PR19-SEC-01) is unchanged and is now backed by a compile-time proof plus a run-time check that every `SYSTEM_MODELS` name is a real delegate.
- **Generated-client value boundary.** Every value form among 18 import shapes, probed from 11 importer locations (§5.6), is refused everywhere outside `platform/db`, `prisma/`, `tools/db` and tests. That includes `export *`, side-effect, `import()`, template-literal `import()`, `createRequire`, relative paths into `generated/` and into `dist/`, and a deep bare path.
- **Supply chain.** The lockfile changes by exactly one leaf (`apps/api` dependency on the existing `@platform/prisma` workspace link). No external package is added.
- **PR32-SEC-14, PR32-SEC-16 and R2-n2 are closed. PR32-SEC-17 is closed for the form it names.**

The gaps are in the lint and ownership controls around the new specifier and the new predicate:
- **PR38-SEC-01 (LOW):** `platform/db-raw-sql` does not know the new `@platform/prisma/client` specifier. In `platform/db`, where the value import is allowed, destructured, aliased or called-as-function `raw`/`sql`/`join` and a namespace re-export pass lint. Seven bare-specifier probes are silent; the five relative-path controls are reported.
- **PR38-SEC-02 (LOW):** the value allowance is the whole `apps/*/src/platform/db/**` category. That category includes `apps/worker/src/platform/db/`, which no CODEOWNERS line covers. There, template-literal `import()` and `createRequire` of the client are lint-clean and need no security record.
- **PR38-SEC-03 (LOW):** a route can declare `cookie`, `authorization` or `x-quote-token` in `schema.headers`. Its handler then receives the credential on any route, which contradicts D-ARCH-109 (3) "handlers never see the headers" (probe: 3 of 3 credential headers delivered, unmarked).
- INFO 04 (PR32-SEC-17 residual), 05 (D-TASK020-38 config bound) and 06 (CODEOWNERS for the D-ARCH-109 predicate and the SEC-TC-29 oracle).

**Findings: 3 LOW, 3 INFO. Nothing Critical, High or Medium. Verdict: PASS_WITH_FOLLOW-UPS** (§11). The code review's R1-M1 (CHANGES_REQUESTED, `ea56793`) is not a security finding, but it removes the regression tests that pin the PR32-SEC-15 closure. Security concurs that the tests must be restored (§6).

## 2. Method

| Area | How |
|---|---|
| Diff | `git diff f782d95...bdf009d` (64 files; the 7 evidence files read for bindings only). Read in full: `authenticate.ts`, `authorise.ts`, `problem-handler.ts`, `route-state.ts`, `credentials.ts`, the `define-route.ts` walk, `runtime.ts`, `generated.ts`, `services.ts`, `execute.ts`, the eslint diff with its surrounding categories and policies, `db-raw-sql.mjs` and `prisma-client-construction.mjs` (headers and source lists), `check-prisma-client.mjs`, the new tests, the SEC-TC-29 helper and stubs |
| P1 lint boundary (`lintprobe.mjs`) | `ESLint#lintText` with the head config (`disableTypeChecked`, no project service; `import-x/no-unresolved` left on). 18 shapes (S01-S18) x 11 importers: repository, service, `platform/tx`, `platform/db`, api root, worker `jobs`, worker `platform/db`, `packages/shared`, the planned audit store, an api test file, `apps/web`. Plus 14 `db-raw-sql` cases (R01-R14) in `apps/api/src/platform/db`, each bare-specifier case paired with a relative-path control |
| P2 credential predicate (`credprobe.mjs`) | Type-stripped head `credentials.ts`. A recording Proxy over the headers for 12 declared sets. Then 10 header shapes: blank, array, cookie without `=`, leading `;`, lower-case and quoted names, the name in a value, a cookie array, a comma-joined token, an upper-case header name |
| P3 header projection (`hdrprobe.mjs`) | The head's real `createApp` + `defineRoute` (`git archive` extract, resolve/load hook, loopback). `[anonymous]` routes declare `cookie`, `authorization`, `x-quote-token` and an `accept-language` control. Three requests each with random credential values; the output is booleans only |
| P4 Joi walk (`walkprobe.mjs`) | The head's `extensionProblems` and its constants, copied verbatim from `define-route.ts` and type-stripped, with Joi 18 from the worktree. Two controls (nested `Joi.extend` type; no extension), then `$_terms` tampered to `undefined`, a null-prototype copy, a `Map` and a class instance |
| P5 supply chain | Deep JSON diff of the base and head `package-lock.json` (every differing leaf), with a mutated-copy control. `link: true` entries; the `node_modules/ajv` tuple |
| P6 generated output (`genscan2.mjs`) | Count-only scan of `prisma/generated/prisma` and `prisma/dist/client` in the worktree (37 files): URL schemes by host, `DATABASE_URL`, `process.env`, `password` assignments, drive and home paths, and the OS user, home, 8.3 stem and host name. Needles are computed at run time; a positive control is included |
| P7 hygiene | Host-fragment count scan, 9 needle labels with a run-time control, over: the added lines of the code diff (1,765), the 7 evidence blobs (9,070 lines) and the commit messages (112). Gitleaks v8.30.1 default-rule emulation (222 rules, three run-time positive controls) over the same inputs and over this record |
| P8 record simulation (`record-sim.sh`) | Sparse shared clone. Scenario commits built by plumbing on `bdf009d`. The real `tools/ci/check-security-owned-paths.mjs` runs at the scenario head against `main` `320e2e3` and against the merge base (§9) |
| Cross-check | Code review round 1 on `main` (`ea56793`, CHANGES_REQUESTED: R1-M1, m1-m6, n1-n4). Where we overlap, its findings are cited, not duplicated (§5, §6) |

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner |
|---|---|---|---|---|---|---|
| PR38-SEC-01 | `platform/db-raw-sql` does not track helpers imported through the new `@platform/prisma/client` specifier | LOW | CWE-89 (via CWE-693) | A03 | `tools/eslint-rules/db-raw-sql.mjs:53` (`PRISMA_SOURCES`) | senior-developer (TASK-020 020-B; ride the union commit) |
| PR38-SEC-02 | The generated-client value allowance spans all of `apps/*/src/platform/db/**`, including the un-owned `apps/worker/src/platform/db/`, where two load forms are lint-clean | LOW | CWE-693 | A01 | `eslint.config.mjs:138, 268, 303-305, 393`; `.github/CODEOWNERS` | senior-developer (CODEOWNERS line, this PR); principal-architect (scope of D-ARCH-103 (2)) |
| PR38-SEC-03 | A route can declare a credential header in `schema.headers`, and its handler then receives the credential on any route | LOW | CWE-522 | A07 | `routing/define-route.ts` (no header-name rule); `validate/validate.ts:100-102, 162` | TASK-020 part 020-C (next `define-route.ts` edit) |
| PR38-SEC-04 | PR32-SEC-17 residual: a `$_terms` that is an object, but not a plain one, is walked as nothing and accepted | INFO | CWE-636 | A04 | `routing/define-route.ts:291-295, 299` | 020-C, with the next edit of `define-route.ts` |
| PR38-SEC-05 | D-TASK020-38: config accepts `DB_CONNECTION_TIMEOUT_MS` values that the always-built runner refuses at boot (exit 1, not 78) | INFO | CWE-1284 | A05 | `packages/config/src/schema.ts:266`; `db/with-tenant-tx.ts:271` | config owner (TASK-005 lineage); = code review R1-m2 |
| PR38-SEC-06 | The D-ARCH-109 predicate and the SEC-TC-29 oracle are outside every owned path | INFO | CWE-693 | A08 | `.github/CODEOWNERS` | senior-developer (this PR) or devops 015-C with PR32-SEC-11; = code review R1-m6 |

## 4. Finding details

### PR38-SEC-01 (LOW): the raw-SQL rule is blind to `@platform/prisma/client`

**Description.**
- `platform/db-raw-sql` reports the Prisma SQL helpers only when the binding comes from a module whose specifier matches `PRISMA_SOURCES`: `@prisma/client(/…)`, `@prisma/client-runtime-utils(/…)` or `…/generated/prisma(/…)`. The helpers are `raw` and `Sql` in any use, `sql` other than as a tag, `join` with a non-literal separator, a computed namespace member, and a re-export.
- This PR introduces the bare specifier `@platform/prisma/client`, which matches none of these. It is the form the import discipline now steers code to: the relative form draws `import-x/no-relative-packages`.
- Probe P1 in `apps/api/src/platform/db/zz-probe.ts` (`db-raw-sql` report counts):

| Case | Bare `@platform/prisma/client` | Relative `…/generated/prisma/client.js` (control) |
|---|---|---|
| R01/R02 `const { raw } = Prisma; raw(s)` | **0** | 1 |
| R04/R05 `import { Prisma as P }; P.raw(s)` | **0** | 1 |
| R06/R07 `Prisma.sql(s)` called as a function | **0** | 1 |
| R08/R09 `Prisma.join(ids, sep)` with a variable separator | **0** | 1 |
| R12/R13 `export { Prisma } from …` | **0** | 1 |
| R10 `Prisma[k]`; R14 `const t = Prisma.sql; t(s)` | **0**, **0** | not run |
| R03 `Prisma.raw(s)`; R11 `new Prisma.Sql(…)` (name-based belt and braces) | 1, 1 | |

**Exploitability and impact.**
- Exposure is confined to files that may value-import the client: `apps/*/src/platform/db/**`, `prisma/**`, `tools/db/**` and tests. The rule does not lint the last three anyway.
- `platform/db` holds the root client. A tagged `$queryRaw` on the ROOT client with an interpolated `raw(input)` is SQL injection. The run-time `isSqlFragment` guard (PR11-SEC-13) protects only `TenantDb`, not the root client.
- An untracked re-export of the `Prisma` namespace from a `platform/db` module would also hand `raw` to repositories under a name the rule cannot trace there either. The `TenantDb` run-time guard still refuses an `Sql` value at that point.
- Exploitation needs a code change in a CODEOWNERS-owned folder that survives review. Impact Medium x Likelihood Low = **LOW**.

**Remediation (code level).**
1. In `tools/eslint-rules/db-raw-sql.mjs:53`, add the workspace package to the source list:
   ```js
   const PRISMA_SOURCES =
     /^(?:@prisma\/client(?:\/.*)?|@prisma\/client-runtime-utils(?:\/.*)?|@platform\/prisma(?:\/.*)?|.*\/generated\/prisma(?:\/.*)?)$/u;
   ```
   Anchoring on the package name (`@platform/prisma` and every subpath) also covers a future second export.
2. In the rule's tests, add the seven bare-specifier forms R01, R04, R06, R08, R10, R12, R14 as invalid cases. Add `` Prisma.sql`…${v}` `` and `Prisma.join(ids, ', ')` from `@platform/prisma/client` as valid cases.
3. Add one negative fixture under `tests/fixtures/lint/layering/prisma-client-imports/apps/api/src/platform/db/` (for example `bad-raw-generated.ts`) with a row in `negative-fixtures.test.ts`.

**Verification test.**
- The new invalid cases fail on `bdf009d` and pass after the change.
- Mutation: removing the `@platform\/prisma` alternative turns at least R01 and R12 red.
- Re-run P1 R01-R14: every bare-specifier case reports, and the relative controls still report.

### PR38-SEC-02 (LOW): the value allowance includes an un-owned folder

**Description.**
- D-ARCH-103 (3) makes `apps/api/src/platform/db/generated.ts` "the one value importer" in the apps, and D-ARCH-103 (4) says the worker has no composition of its own.
- The lint, however, allows a value import of the `prisma-generated` category from `db-platform-core` (`PRISMA_GENERATED_VALUE_CODE = SQL_DRIVER_CODE`). That category is `DB_PLATFORM = 'apps/*/src/platform/db/**'`, which also matches `apps/worker/src/platform/db/`. That folder exists (`system-db.ts`), and no CODEOWNERS line covers it: only `/apps/api/src/platform/` is owned.
- Probe P1, `apps/worker/src/platform/db/zz-probe.ts`:
  - static named, re-export, `export *`, `import()`, side-effect and `.then` forms draw only `import-x/no-extraneous-dependencies`, because the worker does not declare `@platform/prisma`. Adding the dependency is an owned `**/package.json` edit.
  - The template-literal `` import(`@platform/prisma/client`) `` (S08) and `createRequire(import.meta.url)('@platform/prisma/client')` (S09) are **lint-clean**.
- `platform/prisma-client-construction` is off for `apps/*/src/platform/db/**`, so `new PrismaClient(…)` there is not reported either.
- Record simulation K: a new `apps/worker/src/platform/db/` file after the record leaves the record valid, so no security review is triggered.

**Exploitability and impact.**
- A second client and pool in the worker runs outside `withTenantTx`, which contradicts PR11-SEC-09 "never a second composition".
- RLS fails closed without the tenant settings, and `tenant-context-sql` exemptions are exact files, so setting the context by SQL text is refused. That limits the reach to what `platform_app` can touch without context.
- The zone was already privileged before this PR (`pg` and the root-client category). This PR adds the generated client to it.
- Insider or accidental change, no review trigger. Impact Medium x Likelihood Low = **LOW**.

**Remediation.**
1. In this PR, extend `.github/CODEOWNERS` to every app's database platform. Use either:
   ```
   /apps/worker/src/platform/            @sukhchdit
   ```
   or the wider `/apps/*/src/platform/db/ @sukhchdit`.
2. Architect ruling: narrow the apps-side allowance to the one value importer, as D-ARCH-103 (3) words it. Replace `PRISMA_GENERATED_VALUE_CODE = SQL_DRIVER_CODE` with a selector that keeps `prisma`, `tools-db` and `test`, but admits from `apps/*` only `db-root-client` (`client.ts`, `generated.ts`). Add fixtures:
   - `apps/api/src/platform/db/bad-value-other.ts`: value import refused;
   - `apps/worker/src/platform/db/bad-value-generated.ts`: refused;
   - keep `ok` for `generated.ts`.

   This also shrinks PR38-SEC-01's exposure to one file.

**Verification test.**
- After 1: record simulation K turns `missing`.
- After 2: P1 rows "worker platform/db" S01-S18 and "platform/db" S01 on a non-`generated.ts` file report `boundaries/dependencies`. `generated.ts` stays clean.

### PR38-SEC-03 (LOW): credential headers can be projected into a handler

**Description.**
- D-ARCH-109 (3) states: "Handlers never see the headers either way (`RouteContext` projects declared headers only, PR32-SEC-05 (c))."
- The projection is per route: `validate.ts` `declaredHeaders` copies every key that the route's own `schema.headers` names, and `defineRoute` has no rule on header names.
- Probe P3 (real `createApp`): `[anonymous]` routes declaring `cookie`, `authorization` and `x-quote-token` were **accepted**. Each handler received its credential header with the random value (3 of 3), and every answer was 200 with no `Cache-Control`.
- The `accept-language` control saw nothing, and no route saw a header it did not declare.

**Exploitability and impact.**
- A module handler that declares `cookie` (for example, to read a theme or locale cookie) receives the refresh token on a route outside the three `refresh-cookie` routes. Its output is not marked private.
- A later log line or echo of `input.headers` exposes the token. That is the exact reach D-ARCH-109 (3) and ADR-0006 am. 17 limit.
- **Compensating control:** `tests/generated/route-metadata.ts` compares `schema.headers` with the contract's header parameters, minus `PIPELINE_HEADERS`, which include `x-quote-token`.
  - A module route that declares one of these names fails lane A unless `openapi.yaml` also declares it, and OpenAPI ignores an `Authorization` header parameter.
  - But that test is un-owned (PR32-SEC-11), and fixture routes bypass it.
- Impact Medium x Likelihood Low = **LOW**.

**Remediation (in `define-route.ts`, with the 020-C edit).**
- Refuse credential header names in `schema.headers`:
  ```ts
  /** Read by the authn slot only (D-ARCH-109 (3)); never projected into a handler. */
  const CREDENTIAL_HEADERS: ReadonlySet<string> = new Set([
    'authorization', 'cookie', 'x-quote-token', 'x-csrf-token', 'stripe-signature', 'x-mock-signature', 'x-carrier-signature',
  ]);
  // in the schema checks:
  for (const key of headerKeysOf(spec.schema.headers)) {
    if (CREDENTIAL_HEADERS.has(key.toLowerCase())) problems.push(`schema.headers declares the credential header "${key}" (D-ARCH-109: read by the authn slot only)`);
  }
  ```
  `headerKeysOf` reads the keys from `describe().keys`.
- Derive the signature names from the contract's `securitySchemes`, or pin them with a parity test against `openapi.yaml`.
- If a CSRF slot must read `x-csrf-token`, keep it in the slot, not in the handler.

**Verification test.**
- `define-route.test.ts`: each name, in any case, is refused with the message; `accept-language` is still accepted.
- Re-run P3: `defineRoute` throws for the three credential routes.

### PR38-SEC-04 (INFO): PR32-SEC-17 residual, non-plain `$_terms`

**Description.**
- The fix at `define-route.ts:291-295` refuses a schema whose `$_terms` is `undefined`, `null` or a primitive. Probe P4 confirms the message.
- A `$_terms` that is an object whose prototype is not `Object.prototype` falls through `visit`:
  - not a schema;
  - not an array;
  - not a plain object at `:299`.
- Such a `$_terms` is therefore accepted with no problem. Cases: a null-prototype copy, a `Map`, a class instance. Each holds a nested `Joi.extend` type that the untampered control reports.

**Exploitability.**
- Only a Joi upgrade that changes the container (or deliberate tampering, which is out of model as in PR32-SEC-12 (i)/(j)) reaches it.
- The PR32-SEC-13 nested-extension tests would then go red, so it is test-gated, as PR32-SEC-17 was. **INFO.**

**Remediation.** Fail closed on the container shape too:
```ts
const terms = termsOf(value);
if (typeof terms !== 'object' || terms === null || Object.getPrototypeOf(terms) !== Object.prototype) {
  problems.add(`${where} has a Joi schema whose $_terms cannot be inspected (Joi internals changed)`);
  return;
}
```
Optionally, report any non-plain object met inside `$_terms` other than a `RegExp` or a Joi reference, instead of skipping it.

**Verification test.** Extend the `[PR32-SEC-17]` test with `Object.create(null)`, `new Map()` and a class instance as `$_terms`.

### PR38-SEC-05 (INFO): D-TASK020-38, a config bound the runner does not share

**Description and impact.**
- `packages/config` accepts `DB_CONNECTION_TIMEOUT_MS` from 1 to 120000. The runner, now always built for the API **and** the worker, refuses values below `DEFAULT_MAX_WAIT_MS` (2000) with `TenantTxConfigError`.
- Code review R1-m2 found that this is thrown outside `main`'s `try`: the process exits 1, not the configuration exit 78 (PR3-SEC-05), so an orchestrator restart-loops instead of reporting a configuration error.
- **Not a DoS vector.** Only the operator sets the key, the failure is fail-fast and leaks only key names, and Compose and the defaults use 5000. It is a misconfiguration robustness gap. **INFO.**

**Remediation.**
- Raise the schema minimum to `t.int(2_000, 120_000)` (single key, since `maxWait` is a code constant).
- Add a parity unit test asserting that the schema minimum is at least `DEFAULT_MAX_WAIT_MS`.
- Owner: config owner, before TASK-014 documents the env surface, and before G3 at the latest.

**Verification.** `load-config.test.ts` refuses 1999 with `number.min` and accepts 2000.

### PR38-SEC-06 (INFO): the new security logic sits outside every owned path

**Description.**
- Since D-ARCH-109, `packages/shared/src/http/credentials.ts` (`presentedKinds`, `presentsCredential`) decides which credential headers the authn slot reads and when a problem is private.
- `tests/api/helpers/cache-control.ts` (with `contract-validator.ts` and `tests/contract-stubs/*`) is the SEC-TC-29 oracle.
- Neither is owned. Record simulation J: an edit of `credentials.ts` after the record leaves the record valid.

**Impact.**
- A tampered predicate cannot raise privilege, because the anonymous principal is the floor.
- It can, however, re-introduce "present means refuse" (an availability defect) or make a foreign header read.
- A weakened oracle hides SEC-TC-29 regressions. **INFO** (same class as PR32-SEC-11).

**Remediation.** Add these lines to `.github/CODEOWNERS`, in this PR's owned edit (cheapest) or with 015-C:
```
/packages/shared/src/http/              @sukhchdit
/tests/api/helpers/cache-control.ts     @sukhchdit
/tests/api/helpers/contract-validator.ts @sukhchdit
```
Add them to `REQUIRED_CODEOWNED_PATHS` if that list pins owned paths.

**Verification.** Record simulation J turns `missing`.

## 5. Focus areas checked

### 5.1 Credential confusion (D-ARCH-107/109)

- **Routes read only their declared kinds.**
  - `authenticate.ts:34-35` calls `presentedKinds(req.headers, route.auth)`. Probe P2 shows that only the declared kinds' headers are read: for 12 sets, the recording Proxy saw `[]` for `anonymous`, `signature` and the junk entries, and exactly one header per declared kind.
  - Matching is exact (lower-case `__host-rt_web`, a quoted name and the name inside a value do not count). A blank `Authorization` is absence, so it is never "a present bearer".
  - Handlers are the exception: see PR38-SEC-03.
- **Refresh cookie.**
  - In the contract, `refreshCookieWeb` / `refreshCookieAdmin` appear only in `refreshSession`, `logoutSession` (each with `csrfToken`) and `getCsrfToken`.
  - In code, the authn slot reads `cookie` only for a set containing `refresh-cookie`. The problem handler uses the generic presence test only before a route has read the request.
  - No module route exists yet. TASK-055 must keep the reader inside the slot.
- **`presentedKinds` never reads a foreign header.** Proven (P2) and pinned by the PR's own Proxy test. `presentsCredential` (all kinds) is called in production only by `problem-handler.ts:81`, and only when `credentialsReadOf(res)` is false (short-circuit).
- **`markCredentialsRead` and the problem handler.**
  - The mark lives in `res.locals`. Express 5.3.0 creates `res.locals` with `Object.create(null)`, so Object-prototype pollution cannot set it.
  - Only the authn slot writes it, at slot entry. Handlers get a frozen transport view, never `res`.
  - No slot calls `next('route')`, so a later route or the fallback cannot inherit it.
  - A request can only reach a mark by matching a route, which runs that route's slot. **No attacker-controlled path makes the handler trust a mark it should not.**
  - The opposite direction is the real issue. An authenticator that marks and then refuses a declared bearer before `markPrivateResponse` answers `no-store` instead of `private, no-store` (code review R1-m1, reproduced there).
  - Storage impact: none (`no-store` already forbids storing), and the SEC-TC-29 helper flags it in TASK-052's api tests. Security concurs with R1-m1's fix: compute the declared arm from the route descriptor, which is never less private. No separate finding.

### 5.2 Signature-only gate (D-ARCH-110)

`catalogueRefusal` (`authorise.ts:32-40`) runs after the credential gate:
- the credential gate requires `route.auth` to contain `principal.credential`, and a missing principal is ANONYMOUS;
- a `signatureOnly` key needs `credential === 'signature'` (else 401) and the held key (else 403);
- everything else needs an actor (401), then the held key (403).

Bypass attempts, all refused:

| Attempt | Refused by | Status |
|---|---|---|
| Session or anonymous principal on a signature-only route | the credential gate, and the branch | 401 |
| Signature principal holding another provider's key | the held check | 403 |
| Signature principal on a `[session]` route, or on `authenticated` | the actor check | 401 |
| A misdeclared `[session]` descriptor | the branch | 401 |
| Binding a `signatureOnly` permission outside `[signature]` | `SIGNATURE_AUTH` at boot | boot refusal |

No real signature principal exists until TASK-171/261, so signature routes are unreachable today (the stub answers 401). `SIGNATURE_ONLY` is module-private.

### 5.3 Fail-closed authn stub

The only `next()` without an error is `anonymousAllowed && declaredPresented(...).length === 0` with the ANONYMOUS principal. Everything else is `markPrivateResponse` plus 401 `AUTH_REQUIRED`. `main.ts` passes no `pipeline` seam, so the stub is what production composes.

### 5.4 PR32-SEC-17

Closed for the named form (missing or renamed `$_terms`). The residual (non-plain container) is PR38-SEC-04.

### 5.5 Joi extension detection

- Exporting `extensionProblems` (D-TASK020-37) adds no consumer outside tests.
- The `definition === undefined`, depth and `seen` branches are now pinned by tests; the author reports 4/4 mutants killed, and the code review did not re-run them.
- Deliberate tampering stays out of model, as in PR #32 R3.

### 5.6 Generated-client value boundary (P1, 198 cases)

- **Refused everywhere** outside `platform/db`, `prisma/`, `tools/db` and tests, for the repository, service, `platform/tx`, api root, worker jobs, `packages/shared`, the planned audit store and `apps/web` (S01 to S18 except the type cases):
  - static, inline-`type` named (a run-time side-effect import under `verbatimModuleSyntax`), re-export, `export *`, side-effect, `import()`, template `import()`, `createRequire`, `.then`;
  - relative into `generated/` (also `internal/class.js`, extension-less);
  - relative into `dist/` (by `import-x/no-relative-packages` and the construction rule; `boundaries` classifies `prisma/dist/**` as `prisma`, not `prisma-generated`);
  - the deep bare path `@platform/prisma/dist/...` (the new `exports` map: `no-unresolved`). The map also closes every other deep `@platform/prisma/...` path that resolved before.
- **Type-only imports** are clean for the repository and the planned store only, as D-ARCH-103 (2) intends.
- **Computed specifiers** draw `platform/static-module-specifier`.
- **Gaps:** PR38-SEC-02 (worker `platform/db`). The two-hop route through a module `tests/` helper is the PR34-SEC-07 class (code review R1-m5): open, owner senior-developer, due before TASK-026 adds the first module `tests/` helper. Not re-raised.

### 5.7 TenantDb, SYSTEM delegates, `requireTenantTx` and the 503 path

- `tenant-db.ts`, `system-db.ts` and `system-models.ts` are unchanged. `AppDb = TenantDb<AppTransactionClient>` omits `$transaction`, the `*Unsafe` methods, `$queryRawTyped` and every SYSTEM model.
- `SystemModelsAreDelegates` is non-vacuous. `HasKey<AppDb,'referenceDatasetVersion'> = false` compiles only if the client type has no string index signature, and lane A type-check is green.
- `generated.test.ts` checks at run time that each SYSTEM name is a real delegate.
- The run-time exclusion derives model names from the client's `_runtimeDataModel` and fails closed (no model) if that is unreadable.
- `requireTenantTx` throws `DatabaseRuntimeError` at boot when a runner is missing. With `Client: PrismaClient` always passed, that cannot happen in a deployed process.
- `assertPipelineReady` (skipped only when a test passes a `pipeline` seam) and the tx-slot 503 remain as defence in depth.
- The integration test shows the 503 problem with `Retry-After` and the generic text. Its key-absence assertion is weaker than it reads: it fails only if all four keys leak (code review R1-m3). Fix it with the union commit.

### 5.8 Supply chain

- Deep diff base to head: **one leaf**, `packages["apps/api"].dependencies["@platform/prisma"] = "0.0.0"`. The mutated-copy control shows 1 difference.
- `node_modules/@platform/prisma` was already `{ resolved: "prisma", link: true }`.
- 15 `link: true` entries, all `@platform/*`; no non-`@platform` link.
- The `node_modules/ajv` tuple is unchanged: `8.20.0`, registry tarball (D-SEC-PR23-02 interim control).
- Lane A licences, signatures, audit, osv and cooldown are green.

### 5.9 CODEOWNERS

- The three lines of D-ARCH-103 (7) are present and correct: `/prisma/package.json`, `/prisma/schema/_base.prisma`, `/apps/api/src/platform/db/generated.ts`.
- They are already covered by `/prisma/` and `/apps/api/src/platform/` (same owner, last match wins). They are explicit, not new coverage.
- Gaps: PR38-SEC-02 and PR38-SEC-06.

### 5.10 Generator pins and generated output

- The datasource block has no `url`, and no `env()` appears in the schema.
- P6 over 37 generated and compiled files:
  - 0 hits for OS user, home, 8.3 stem, host name, drive or home paths;
  - URLs are documentation links only (prisma.io, pris.ly, github.com and two others);
  - `DATABASE_URL` and `process.env` appear only in JSDoc examples;
  - the two `password` hits are a JSDoc select example.
  - The control fired.
- Fact for TASK-014: the compiled client embeds the whole schema text, comments included, as `inlineSchema` (`dist/client/internal/class.js`). So D-ARCH-102 (4) "images never copy the schema" holds only for the `.prisma` files; the image carries the text. Nothing sensitive is in it today. Keep schema comments free of anything non-public.

### 5.11 D-TASK020-38

PR38-SEC-05: a misconfiguration concern, not an attacker-reachable DoS.

### 5.12 Evidence-run hygiene (D-SEC-PR23-02, D-ORCH-053)

- The `1bea3cf` gate table states "`npm ci --ignore-scripts`, then `npm run deps:rebuild` (22:50Z, same head) | exit 0 / exit 0" **verbatim**.
- It states "info/exclude non-comment lines | 0" rather than the literal words "empty `.git/info/exclude`". **Accepted as a substitute**, as for PR #34 (D-SEC-PR34-03): the statement is the stronger content claim (no ignore entry), and comment lines ignore nothing.
- Also stated: clean tree (0 porcelain lines, `git_dirty` false), profile `pr` only, `build_clean` true, `env_overrides` `[]`, a host-path scan with 0 hits, and the Docker lock held.
- P7 found 0 host fragments in the 7 evidence blobs.

## 6. Earlier findings and review items

| Item | State after this round |
|---|---|
| PR32-SEC-14 (INFO, signature-only gate) | **Closed** (D-ARCH-110 implemented; §5.2) |
| PR32-SEC-16 (INFO, refresh-cookie presence) | **Closed** by D-ARCH-109: route-aware stub, `presentedKinds`, problem handler, helper and stubs. The previous owner note ("the cookie still makes the response private") is superseded by D-ARCH-109 (4). The handler-side residual is PR38-SEC-03 |
| PR32-SEC-17 (INFO) | **Closed** for missing or renamed `$_terms`; residual in PR38-SEC-04 |
| PR32-SEC-15 (INFO, deep freeze) | The run-time code is unchanged (`frozenData` at `define-route.ts:443-459`), but commit `5aafb2c` deleted its regression tests (code review **R1-M1**, MAJOR). Security concurs that the block must be restored before merge; until then the closure is unpinned |
| PR #32 R2-n2 (`storage/boundary.test.ts` header) | **Closed** |
| PR11-SEC-09 items 3-4 at the tx slot; D-TASK020-05 | Verified by `runner-activation.int.test.ts` 3/3 in lane B (§5.7, with R1-m3). D-TASK020-05 closes on merge (STATUS: orchestrator) |
| PR19-SEC-01 (INFO, SYSTEM delegates) | Unchanged and decided (D-ARCH-080); strengthened by the delegate proof |
| PR34-SEC-07 (INFO, test-category hop) | Still open. It now also carries generated-client values (code review R1-m5); owner and due unchanged (before TASK-026) |
| PR32-SEC-12 (LOW), PR #32 R2-m1/m2/m3 | Out of scope (020-C) |

## 7. Union with `main` (PR #34 merged as `263b790`): what the union must preserve

`git merge-tree bdf009d 320e2e3` reports one text conflict, in `eslint.config.mjs` `BOUNDARIES_FILES`. `package.json`, `tools/tsconfig.json` and `tools/lint/negative-fixtures.test.ts` auto-merge. The union commit must keep:

1. **Both category lines:**
   - `{ pattern: ['apps/*/src/platform/db/client.ts', 'apps/*/src/platform/db/generated.ts'], category: 'db-root-client' }`;
   - `{ pattern: 'apps/*/src/platform/db/query-counter.ts', category: 'db-test-seam' }`, with its comment.

   `query-counter.ts` must not join `db-root-client`. Record simulation H resolved it this way: 0 conflict markers, all 4 expected lines present.
2. **Policy order:**
   - the `prisma-generated` value disallow/allow pair directly after `{ from: DATABASE_CODE, allow: PRISMA_TARGETS }`;
   - PR #34's `db-test-seam` disallow/allow pair as the **last two** `BOUNDARIES_POLICIES` (D-SEC-PR34-03).
   - Any new policy (code review R1-m5) goes before the seam pair.
3. **`package.json`:** both `db:generate` and `test:generated`. `prisma-client-package.test.ts` still sees `db:generate` as the only generating script.
4. **`tools/tsconfig.json`:**
   - `files` keeps `generated.ts` and `query-counter.ts`;
   - `include` must not regain `../prisma/generated/**/*.ts`;
   - `references` keeps `../prisma/client`.
5. **`negative-fixtures.test.ts`:** the four D-ARCH-103 `TENANT_DB` rows, the four allowed cases and the five repository probes, plus PR #34's seam cases. Also the PR19 `bad-prisma-import` and `prisma-seed` cases.
6. **The leakage-scanner `no-extraneous-dependencies` block** from PR #34 stays.
7. **Recommended in the same commit** (it is non-docs anyway and needs fresh lane-B evidence with the D-SEC-PR23-02 statements verbatim):
   - code review R1-M1 and R1-m3;
   - PR38-SEC-01;
   - the CODEOWNERS lines of PR38-SEC-02 (1) and PR38-SEC-06.

**The union voids this record** (simulation H: `eslint.config.mjs` is a PR-changed owned path). The next round re-checks:
- the effective-config delta equivalence of `main` to union against `f782d95` to `bdf009d` (about 50 paths, with mutation controls);
- the seam pair being last;
- P1 (S01-S18 x 11 and R01-R14);
- the lockfile delta (still one leaf);
- CODEOWNERS;
- the evidence statements.

That is a merge-only round if nothing but the union changes, and a delta round if any of item 7 lands.

## 8. Checks owed (routed)

| Owner | Check |
|---|---|
| TASK-052, 055, 091, 171, 261 (authenticators) | Read only the declared kinds through `presentedKinds`. Call `markCredentialsRead` together with the decision (code review R1-m1 wording). Build `permissions` with `readonlySet`. Signature authenticators build the provider principal only after the raw-body signature verified, and never read the permission from input. TASK-055 reads the cookie only in the slot of the three `refresh-cookie` routes (PR38-SEC-03) |
| TASK-027 (matrix) | Per route and per foreign kind: the result and `Cache-Control` equal the no-credential request (D-ARCH-109 (7)). Two signature rows per `[signature]` route (D-ARCH-110 (4)) |
| TASK-014 (images) | COPY `prisma/package.json` + `prisma/dist/client` only, plus a preflight import of `@platform/prisma/client`. No `--conditions=@platform/source` in the image's `NODE_OPTIONS`. `inlineSchema` note (§5.10) |
| TASK-024/025/026/040 (first consumers) | PR38-SEC-01 fixed before the first `platform/db` or store consumer of the bare specifier. Repositories use the `AppDb`/`Prisma` types from `platform/db/index.ts` (worker: `@platform/api/runtime`) |
| 020-C | PR38-SEC-03, PR38-SEC-04, PR32-SEC-12 |
| Config owner | PR38-SEC-05 (= R1-m2), before TASK-014 / G3 |
| devops 015-C | PR38-SEC-06 with PR32-SEC-11 if not done in this PR |
| security-analyst | Threat-model wording of D-ARCH-109 (8) (R-06, T-17, T-06, the SEC-TC-29 row) and the optional new SEC-TC for foreign credentials (grep for the next free ID first). Still owed from PR #32 R3; next text round |

## 9. Record simulation and secret hygiene

Real `tools/ci/check-security-owned-paths.mjs` at each scenario head. Base `320e2e3` (current `main`) unless noted.

| Scenario | Expected | Result |
|---|---|---|
| A: this record committed on `bdf009d` | pass | **pass**, owned 47 |
| A2: same, base `f782d95` | pass | pass, owned 47 |
| B: no record | missing | missing |
| C: checked as `--pr 37`; C2: the same text named `PR-0032-…` | missing | missing, missing |
| D: last Verdict row FAIL | missing | missing |
| E: Head row names a `main` commit | missing | missing |
| F: `eslint.config.mjs` edited after the record | missing | missing |
| G: docs-only commit after the record | pass | pass |
| H: union merge with `main` after the record | missing (re-review) | missing |
| J: `packages/shared/src/http/credentials.ts` edited after the record | pass (PR38-SEC-06) | pass |
| K: new `apps/worker/src/platform/db/` file after the record | pass (PR38-SEC-02) | pass |
| L: new `apps/api/src/platform/db/` file after the record | missing | missing, owned 48 |

13 of 13 as predicted. Hygiene of this record:
- Gitleaks v8.30.1 emulation: 0 findings; positive controls fired.
- Count-only host-fragment scan: 0 for all 9 labels; the control fired.
- No secret-shaped literal, OS user name, home or temporary path is quoted.

## 10. Proposed decision entry (for the orchestrator; DECISIONS.md not edited)

**D-SEC-PR38-01 · 2026-11-14 · security-analyst (logged by orchestrator) · PR #38 (TASK-020 part 020-B) r1 PASS_WITH_FOLLOW-UPS**

- **Decision:** PR #38 security r1 at `bdf009d` = PASS_WITH_FOLLOW-UPS (3 LOW, 3 INFO). Nothing Critical, High or Medium.
- **Closed:**
  - PR32-SEC-14 (D-ARCH-110 gate) and PR32-SEC-16 (D-ARCH-109 stub, predicate, problem handler, helper);
  - PR32-SEC-17 for the missing or renamed `$_terms` form;
  - PR #32 R2-n2.
- **Verified:**
  - routes read only declared kinds (Proxy probe), and the stub is fail-closed;
  - no signature-only bypass;
  - 198-case boundary matrix;
  - lockfile one leaf, `ajv` 8.20.0, no non-`@platform` link;
  - generated output free of secrets, URLs other than doc links, and host paths;
  - evidence `20261113T2251Z_cb7c12e` accepted (`npm ci --ignore-scripts` verbatim; `info/exclude` stated as 0 non-comment lines, accepted as substitute).
- **New LOW:**
  - **PR38-SEC-01**: `db-raw-sql` `PRISMA_SOURCES` lacks `@platform/prisma` (7 bare-specifier helper forms silent in `platform/db`) → senior-developer, preferably in the union commit, at the latest before TASK-024 merges / TASK-025, -026, -040 start;
  - **PR38-SEC-02**: the value allowance spans the un-owned `apps/worker/src/platform/db/` (template `import()` / `createRequire` lint-clean, no record needed) → CODEOWNERS line in this PR; principal-architect to rule on narrowing D-ARCH-103 (2) to `generated.ts`;
  - **PR38-SEC-03**: credential headers declarable in `schema.headers` reach handlers (contradicts D-ARCH-109 (3)) → 020-C, before TASK-055 starts and before the first module route with `schema.headers`.
- **New INFO:**
  - 04: non-plain `$_terms` (020-C);
  - 05: `DB_CONNECTION_TIMEOUT_MS` floor (config owner; = code review R1-m2);
  - 06: CODEOWNERS for `packages/shared/src/http/` and the SEC-TC-29 helper (= R1-m6).
- **Security concurs with code review R1-M1:** restore the PR32-SEC-15 deep-freeze tests before merge.
- **The union with `main` (PR #34) voids the record:** a merge-only round follows, or a delta round if fixes ride along. Union preservation list in the record §7.
- **Reversibility:** High.

## 11. Verdict

| Item | Value |
|---|---|
| Critical / High / Medium | 0 / 0 / 0 |
| Low | 3 open: PR38-SEC-01, -02, -03 |
| Info | 3 open: PR38-SEC-04, -05, -06 |
| Closed this round | PR32-SEC-14, PR32-SEC-16, PR32-SEC-17 (named form), PR #32 R2-n2 |
| Merge needs from security | A record naming the final head. Because the union with `main` changes `eslint.config.mjs`, a merge-only (or delta) round is required after the union commit. Code review R1-M1 restored |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding; three LOW and three INFO follow-ups with owners and due points; the head `bdf009d` is cleared from security's side, and the coming union commit needs its own merge-only round |
