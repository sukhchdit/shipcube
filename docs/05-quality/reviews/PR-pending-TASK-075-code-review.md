# Code review: TASK-075 (CarrierAdapter contract, capability guard, normalisation and egress), pre-push round 1

| Field | Value |
|---|---|
| PR | not pushed yet (pre-push review; the orchestrator renames this record once the PR exists) |
| Branch / head | `feat/TASK-075-carrieradapter-contract-carriercontext-capability-guard` @ `c2eaa47` (one commit), based on `origin/main` `5145d52` |
| Diff reviewed | `git diff 5145d52 c2eaa47`: 26 files, +3342 / -2 (`packages/carriers/src/**`, `tools/lint/carrier-wire-boundary.test.ts`, `packages/config/src/carrier-environment.test.ts`) |
| Card | `docs/04-plan/tasks/WAVE-02.md` TASK-075 (US-121 DC, US-124 DC; REQ-CARR-001/002/003/007; ADR-0010 am. 11 items 2, 3, 6; D-ARCH-106) |
| Sources re-read | CLAUDE.md; US-121, US-124 (EPIC-06) and their AT ids; ADR-0010 incl. am. 11; DR-B18, DR-B30, REQ-CARR-001..008, REQ-TRACK-001/005, REQ-CUST-005; US-122, US-241; ADR-0009 §3 (money); data-model enums, `tracking_events`, `shipment_packages`, `carrier_services` |
| Developer decisions | D-TASK075-01..10 (in the hand-off; not yet in DECISIONS.md) |
| Reviewer | code-reviewer, 2026-11-19 |

## 1. Verdict

```
VERDICT: CHANGES_REQUESTED
SUMMARY: The contract, the guard, the egress contract and the label rule are well built. Registration names every defect,
         the guard refuses before any I/O, Map lookups are prototype-safe and log fields are shape-checked. One MAJOR:
         normaliseTrackingEvents drops unmapped tracking events, but REQ-TRACK-001 and US-241 say "never dropped"
         (IN_TRANSIT + unmapped flag), and TrackingEvent cannot carry what REQ-TRACK-001/005 store. Seven MINORs, 11 NITs.
```

Nothing is pushed and no adapter consumes this contract yet. That is why R1-M1 is MAJOR: TASK-079 (Mock, batch 2.2) and TASK-135/139/140 build on the helper and the type. Fixing it now costs one function and one interface. After four adapters it costs four.

## 2. Verification performed (HOST RULE: static review and single-process Node probes on `git archive` extracts; no npm, no Jest, no Docker)

Set-up: `git archive c2eaa47` (full tree, plus a packages-only copy) went into the reviewer scratchpad (`review/T075-cr`), with a node_modules junction to the worktree. Nothing ran inside the PR worktree.

- **Type-check:** `tsc -p` over `packages/carriers/src` and the new config test (a scratch tsconfig, no references, noEmit) exits 0. That is 24 carriers files.
- **Lint:** I ran type-aware ESLint with the repository `eslint.config.mjs` on all 26 changed files, with `--max-warnings 0`: clean (about 19 s).
- **Format:** `prettier --check` on all 26 changed files: clean.
- **Not re-run:** the Jest unit suite and coverage. I relied on the developer's report of 167/167 unit tests and 99.87 % lines / 99.04 % branches on packages/carriers. Lane B is the binding evidence.
- **Behaviour probes** (`probe1.ts`, tsx, on the archive copy):
  - P1: a `capabilities()` result that holds a function (`toString() {}` or `helper: () => 1`) passes `capabilityIssues` (`[]`). Then `guardAdapter` throws a raw `DOMException ... could not be cloned` from `structuredClone`. Because that is not a `CarrierContractError`, `createCarrierRegistry` re-throws it and the other adapters' defects are not reported. (R1-m1)
  - P2: `isIanaTimeZone` accepts `Europe/Nowhere`, `America/New_Yrok` and `Indian/Mars`, and `Intl.DateTimeFormat` throws RangeError for all three. It refuses `US/Eastern` and `GMT`, which Intl accepts. (R1-m3)
  - P3: with the test's own FAKE_EGRESS table, a production context gives `new URL('test/rates', egressBase(E, production)).pathname === '/v1/test/rates'`, which is inside the sandbox prefix. The egress property claims this never happens. (R1-m4)
  - P4: a synchronous throw inside an adapter becomes a rejection (good). Required operations are read from the adapter object on every call, while optional ones are bound at registration. Replacing `track` after registration changes what the guard calls. (R1-n4)
  - P5: an unmapped tracking event `ZZ99` is removed from the result, and one warn line is written. (R1-M1)
  - P6: a `CARRIER_OTHER` raw label keeps U+202E (bidi override). A 119-character label followed by an emoji is cut to 120 code units that end in a lone surrogate, so `isWellFormed()` is false. (R1-n3)
  - P7: `canonicalServiceCode('DHL','EXPRESS_P') === canonicalServiceCode('DHL_EXPRESS','P')`. Within one carrier, `p`/`P` collisions are caught. (R1-n11)
  - P8: `new CarrierError('TIMEOUT', { carrierErrorCode: 1001 })` keeps the number, because `RegExp.test` coerces it. (R1-n2)
  - P9: `contextIssues` accepts a hand-built context with `deadlineAt: 'never'` and `locale: 'xx\n'`. (R1-n5)
  - P10: an account with an environment outside the union makes `deriveCarrierEgressRules` throw a TypeError ("not iterable"), not a named issue. (R1-n10)
- **Lint probe for AT-US-121-05** (`lint-probe.mjs`, ESLint `lintText` with the real config, untyped, from `apps/api/src/modules/quotes/service/`):
  - value deep import, inline `import { type X }` and dynamic `import()` of `@platform/carriers/src/...`: each gives one `import-x/no-unresolved` finding;
  - `import type { RateQuote } from '@platform/carriers/src/canonical/types.js'`, `import type ... from '@platform/carriers/adapters/ups/wire.js'` and `export type { ... } from '@platform/carriers/src/...'`: **clean**.
  - tsc does refuse the type-only deep import, with TS2307 from `apps/api` (NodeNext follows the `exports` map). The developer's residual claim is therefore true, but the AC scenario as written ("imports a carrier wire-format **type**" -> "**lint** fails") is not met by lint. (R1-m2)
  - Side observations: `apps/web` and `packages/pricing` importing `@platform/carriers` get only `import-x/no-extraneous-dependencies`. This matters for D-TASK075-02 (see §4).
- **Config:** `packages/config/src/schema.ts:237` admits `oneOf(['sandbox'])` for each carrier environment, so the new test's claim (production refused in every APP_ENV) holds by construction.
- **Logging path of `CarrierError.cause`:** `packages/shared/src/logging/serializers/error.ts:169-178` walks own `cause` up to depth 3 and logs its redacted message. `redactUrl` (`string-redaction.ts:307`) keeps scheme, host and **path** and omits only the query. (R1-m5)

## 3. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R1-M1 | MAJOR | `packages/carriers/src/normalise/normalise.ts:139-172`; `canonical/types.ts:163-179`; `normalise/normalise.test.ts:172-186` | `normaliseTrackingEvents` **drops** events whose code has no mapping (D-TASK075-04: "never guessed"). REQ-TRACK-001 says: "Unmapped carrier codes map to `IN_TRANSIT` with flag `unmapped` and an alert metric, **never dropped**". US-241 has the scenario "An unmapped carrier code is never dropped", which expects a stored event with `IN_TRANSIT` + `unmapped` and `tracking_unmapped_event_total` + 1. `tracking_events.unmapped` exists in the data model. Every adapter (TASK-079/135/139/140) will call this helper, and TASK-168 cannot bring back an event the boundary has already discarded. The canonical `TrackingEvent` also lacks the fields the store needs: the carrier event id (REQ-TRACK-005 dedupe key, "identified by the carrier event ID"), the original description (REQ-TRACK-001 "store the event with the carrier's original code, original description"; data-model `carrier_description`, PER, never public) and the `unmapped` flag. The test at :173 pins the wrong behaviour. | (a) For an unmapped code, return `{ event, status: 'IN_TRANSIT', unmapped: true }`; mapped codes return `unmapped: false`. Keep the once-per-code warn line, and either expose a counter hook (e.g. `scope.onUnmapped?.(carrier, account)`) or document that TASK-168 increments `tracking_unmapped_event_total` from the `unmapped` flag. (b) Extend `TrackingEvent` with `unmapped: boolean`, `carrierEventId?: string` and `description?: string`, the last with a JSDoc warning that it is personal data and never public (DR-B31). (c) Replace the drop test with one that asserts "kept, IN_TRANSIT, unmapped" and one log line, and add a property: every input event yields exactly one output event (length preserved, order preserved). |
| R1-m1 | MINOR | `packages/carriers/src/guard.ts:137-156`; `capabilities.ts:222-237` | The declaration is **validated on the adapter's object and snapshotted with `structuredClone` afterwards**. (i) A non-cloneable value (a method, a function-valued helper field) passes validation, and registration then dies with a raw `DOMException`. The registry re-throws it, so "all defects of all adapters in one error" breaks (P1). (ii) A getter or inherited field (class-built declaration, `Object.create(proto)`) is validated through the prototype, but `structuredClone` copies own enumerable data only. The snapshot then lacks fields the validator saw: an inherited `operations.x = true` becomes `undefined`, so the guard fails closed, and an inherited `services` makes eligibility crash later. | Clone first, inside a try: on a DataCloneError push `capabilities() must return plain data (not cloneable: <name>)`. Then run `capabilityIssues` and the declared-true-without-implementation check **on the clone**, and freeze that same clone. Add tests for a function-valued field (named issue, registry still reports the other adapters) and for a getter-based declaration. |
| R1-m2 | MINOR | `tools/lint/carrier-wire-boundary.test.ts:8-10, 25-39`; `eslint.config.mjs` (no change in this PR) | AT-US-121-05 reads "a source file outside packages/carriers that imports a carrier wire-format **type**" -> "the **lint** boundary rule ... fails naming the file and the forbidden import". The probes are value imports only. My probe shows `import type` / `export type ... from` of a deep `@platform/carriers/...` path lint **clean**. tsc catches them (TS2307), so the wire format cannot leak, but the AC's own scenario fails lint. | Add `@typescript-eslint/no-restricted-imports` (or core `no-restricted-imports`; the TS variant needs `allowTypeImports: false`, which is the default) with `patterns: [{ group: ['@platform/carriers/*'], message: 'wire formats stay inside packages/carriers (REQ-CARR-001)' }]` for files outside `packages/carriers/**`. Add `import type` and `export type ... from` probes to the test. If eslint.config is out of scope for this task, the alternative is a tsc probe in the test plus a qa-lead note in the gherkin map that the type arm is enforced by the typecheck gate. Either way, the AC text and the evidence must agree. |
| R1-m3 | MINOR | `packages/carriers/src/capabilities.ts:96-129`; `capabilities.test.ts:179-186` | D-TASK075-08: the IANA heuristic accepts any `Area/<anything>` (misspelled zones pass registration and then throw RangeError in the DR-B25 cut-off computation of rate shopping and booking) and refuses valid backward links (`US/Eastern`, `GMT`). The JSDoc and the test title say "unknown names are refused", but only an unknown *area* is refused. | Put the authoritative check where the lint rule allows `Intl.DateTimeFormat`: add `isTimeZone(name)` to `packages/shared/src/intl/` (a FORMAT_HELPERS folder) as `try { new Intl.DateTimeFormat('en', { timeZone: name }); return true } catch { return false }`. It resolves aliases and is exactly what the cut-off code will need. Use it here, and keep the "no offsets" regex on top if wanted. If that is deferred to TASK-124, correct the JSDoc and the test title and record the residual. |
| R1-m4 | MINOR | `packages/carriers/src/egress.test.ts:95-104` | The property "[AT-US-121-04] ... a production context never [yields a URL] inside [the sandbox prefixes]" is **false** for the table it uses: the production prefix `/v1/` contains the sandbox prefix `/v1/test/`, as with DHL `/mydhlapi/` vs `/mydhlapi/test/`. `'test/rates'` gives `/v1/test/rates` (P3). It passes only because the generator almost never starts a string with `test/`. It gives false assurance about the very overlap ADR-0010 am. 11 item 6 cares about. | Make the property honest: either `fc.pre(!path.startsWith('test/'))` with an explicit example test that documents the overlap as an adapter obligation (TASK-135's per-adapter test), or assert at the matcher level that a production-tier call into a path covered by a sandbox prefix of the same origin is refused. The second is TASK-113's job (longest-prefix-wins tier). Route the overlap to TASK-113/135 in the hand-off (also SECURITY-FLAG S1). |
| R1-m5 | MINOR | `packages/carriers/src/normalise/normalise.ts:130-137`; `errors.ts:21-22, 40` | `normaliseError` (the "error mapping" of ADR-0010 am. 11 item 8) forwards `failure.cause` verbatim, and `CarrierError` stores it as `cause`. The JSDoc says "for the server log only. Never serialised", but the platform error serializer walks `cause` (depth 3) and logs its message. URL redaction there keeps the **path** (tracking/dispatch numbers, INT identifiers that ADR am. 11 item 8 keeps out of logs), and free carrier text in a cause message is only pattern-redacted. ADR am. 11 item 8 says "error mapping drops any `cause.message` containing a URL". | In `normaliseError` (or the `CarrierError` constructor), keep a sanitised cause only: name, an `errno`/`code` shape such as `ECONNRESET`, and the message only when it matches no URL or request-target pattern. Otherwise substitute a fixed text. Correct the JSDoc. Add a test that logs a `normaliseError(..., { cause: new Error('GET https://express.api.dhl.com/mydhlapi/test/shipments/1234567890/tracking?requestorName=Jane failed') })` through the real `PlatformLogger` and asserts that neither the path nor `Jane` appears. |
| R1-m6 | MINOR | `packages/carriers/src/canonical/types.ts:9-13` | D-TASK075-10: `CarrierMoney = { amountMinor: number, currency: string }`. ADR-0009 §3 defines `Money = { amount: Minor (branded), currency }` in `packages/shared/money`, and the API shape is `{ amount, currency }`. TASK-076 (same batch 2.1) builds it. Two money shapes with different field names means every adapter result needs a mapping at the pricing boundary, and the brand that stops plain-number arithmetic is absent here. Nothing validates `amountMinor` (a safe integer) or `currency` (ISO 4217) either. | Rename the field to `amount` now, while no adapter exists, and add a TODO/JSDoc pointing at the switch to `Money` from `@platform/shared` once TASK-076 lands (the orchestrator routes the swap). Or alias to `Money` if TASK-076 merges first. A shared "carrier decimal string -> minor units" helper (no parseFloat, per ADR-0009) would also stop four adapters from each inventing their own. |
| R1-m7 | MINOR | `packages/carriers/src/canonical/types.ts:92-131` | Contract gaps the M1 adapters will need, all additive. Cheaper now than after four adapters. (i) `ShipmentRequest` has no Incoterm, but REQ-CUST-005 defaults DAP and offers DDP per service, and DHL/UPS/FedEx create calls need the duties payer. (ii) `ShipmentConfirmation` has no per-package result, but data-model `shipment_packages.tracking_number` (piece level) and `carrier_package_ref` are filled from create, and labels are per piece for multi-package UPS/FedEx shipments. (iii) `PackageSpec` has no package type (`PARCEL_BOX`/`ENVELOPE`, REQ-BOOK-028). | Add `incoterm: 'DAP' \| 'DDP'` to `ShipmentRequest` (optional on `RateRequest`). Add `packages?: readonly { seq: number; trackingNumber?: string; carrierPackageRef?: string }[]` to `ShipmentConfirmation`. Add `packageType` to `PackageSpec`. Alternatively, record why each is deferred and to which task. |
| R1-n1 | NIT | `packages/carriers/src/egress.ts:43, 72-73` | `ENCODED_SEPARATOR` is unreachable: `PATH_CHARS` already refuses `%`. The test "an encoded separator" asserts the PATH_CHARS message. | Drop the branch, or check it before `PATH_CHARS` so the more specific message wins. |
| R1-n2 | NIT | `packages/carriers/src/errors.ts:45` | `CARRIER_RAW_CODE.test(x)` coerces non-strings: a numeric `1001` (DHL JSON) or an object with a `toString` is stored as is and serialised by `toJSON` (P8). | `typeof options.carrierErrorCode === 'string' && ...`; stringify numbers in the adapter. |
| R1-n3 | NIT | `packages/carriers/src/normalise/normalise.ts:46-50` | `sanitiseLabel` keeps format characters (U+202E bidi override, zero-width characters), and `slice(0, 120)` can split a surrogate pair (P6). | Add `\p{Cf}` to the stripped class, and finish with `.toWellFormed()` (Node 20+). |
| R1-n4 | NIT | `packages/carriers/src/guard.ts:169-189` | Optional operations are bound at registration, but required ones are looked up on the adapter on every call, so mutating the adapter after registration changes the guarded behaviour (P4). | Bind all eleven once at registration, as the optional ones are. |
| R1-n5 | NIT | `packages/carriers/src/context.ts:155-166` | `contextIssues` (the guard's per-call check) does not re-check `deadlineAt`, `locale` or `mockScenario`, so a hand-built context with `deadlineAt: 'never'` reaches the adapter and the TASK-132 timeout derivation (P9). | Share one validator between `createCarrierContext` and `contextIssues`, or brand contexts made by the factory. |
| R1-n6 | NIT | `packages/carriers/src/canonical/types.ts:73-81` | The JSDoc says US-123 `rates=empty` "is `NO_SERVICE`", but `noServiceReason` is a `CarrierErrorCode` and `NO_SERVICE` is a per-carrier status (REQ-CARR-008), not an error code. The invariant "present only when quotes is empty" is not enforced anywhere. | Reword the JSDoc ("empty `quotes` = NO_SERVICE; `noServiceReason` optionally says why, e.g. WEIGHT_EXCEEDED, US-122"). Have the guard (or the TASK-101 contract suite, REQ-CARR-011) assert the invariant. |
| R1-n7 | NIT | `packages/carriers/src/errors.ts:1-6` | "Every failure that leaves an adapter or the capability guard is a `CarrierError`" is not true: the guard passes adapter errors through unchanged (tested at `guard.test.ts:307`) and throws `CarrierContractError` for a bad context. | Say who converts (TASK-132 gateway: unknown -> `CARRIER_UNKNOWN_ERROR`, `CarrierContractError` -> local, non-ambiguous) and reword. |
| R1-n8 | NIT | `packages/carriers/src/context.ts:106` | `LOCALE` refuses `es-419` and script subtags (`zh-Hant`). This is harmless while locales are en/es/fr, but it is a surprising refusal for a BCP 47 field. | Accept `^[a-z]{2,3}(?:-(?:[A-Z]{2}\|\d{3}))?$`, or document that the context takes a Platform locale only. |
| R1-n9 | NIT | `packages/carriers/src/capabilities.test.ts:38-69` | AT-US-121-02 says "When capabilities() is called **on the Mock adapter**". This PR proves the validator on a fake, and the Mock clause belongs to TASK-079. | TASK-079 should re-run `capabilityIssues` on the real Mock declaration under the same AT id (hand-off note to the orchestrator). |
| R1-n10 | NIT | `packages/carriers/src/egress.ts:116-150` | `appEnv: string` and an out-of-union `environment` give a TypeError, not a named issue (P10). | Type `appEnv` as the APP_ENV union (passed in by the composition root), and validate `account.environment` with `isCarrierEnvironment` and push an issue. |
| R1-n11 | NIT | `packages/carriers/src/canonical/codes.ts:117-123`; `registry.ts:246-259` | Canonical service codes can collide across carriers (`DHL`+`EXPRESS_P` = `DHL_EXPRESS`+`P`). Today only `carrier_services.canonical_code UNIQUE` catches it, at seed time. | The registry can check canonical-code uniqueness across all registered declarations (one Set). |

## 4. Rulings on the developer decisions

| Decision | Ruling |
|---|---|
| D-TASK075-01 `getRates` returns `RateResponse { quotes, noServiceReason? }` | **Accepted, with a principal-architect note required.** US-122 has the scenario "the Mock returns no services with reason WEIGHT_EXCEEDED, not an exception", which `RateQuote[]` (brief §4.3) cannot express. However, ADR-0010 §Interface says "`CarrierAdapter` exactly as brief §4.3". A return-type change to a required operation needs a one-line ADR-0010 amendment / D-ARCH ruling (CLAUDE.md §5 architecture-change guardrail). Merge condition C2. See also R1-n6. |
| D-TASK075-02 canonical vocabularies in `packages/carriers`, not `packages/shared` | **Accepted for this task, with a note.** ADR-0010 §Interface says canonical types live in `packages/shared`. My probe shows `apps/web` and `packages/pricing` cannot import `@platform/carriers` today (not a dependency), and the web client localises `carrierErrors.<CODE>` while pricing (TASK-080) consumes surcharge codes. The move to `packages/shared` is therefore likely, not optional. Record it in the same architect note (C2) and route the mechanical move to TASK-080 or the first consumer. Also note that `packages/shared/src/api/types.gen.ts` carries a third copy of these enums (OpenAPI). A parity test between `CARRIER_ERROR_CODES` / `TRACKING_STATUSES` / `DOCUMENT_FORMATS` and the OpenAPI enums belongs with the move. |
| D-TASK075-03 the guard refuses another carrier's or environment's context as `CarrierContractError` | **Accepted.** It is a programming defect and it is refused before any I/O. TASK-132 must classify it as local and non-ambiguous (never `EXCEPTION` after `createShipment`); add that to TASK-132's hand-off (R1-n7). |
| D-TASK075-04 unmapped tracking events dropped and logged once | **Rejected**: R1-M1. It contradicts REQ-TRACK-001 and US-241. |
| D-TASK075-05 egress limited to the contract (matcher -> TASK-113, per-carrier `EGRESS` -> TASK-135/139/140) | **Accepted.** It matches the card's Files list ("egress.ts contract") and ADR am. 11 item 6 ("TASK-113 implements the rule shape; TASK-135/139/140 the per-adapter EGRESS"). Carry R1-m4's overlap to TASK-113. |
| D-TASK075-06 AT-US-121-05 enforced by existing lint rules; type-only deep imports caught by tsc | **Partially accepted**: R1-m2. The leak is prevented (lint + typecheck), but the AC's literal type-import scenario does not fail lint. |
| D-TASK075-07 config already refuses production carrier accounts | **Accepted.** Verified at `schema.ts:237` (`oneOf(['sandbox'])`). The new test pins it for all four APP_ENVs × three carriers, and `deriveCarrierEgressRules` repeats the refusal as defence in depth. |
| D-TASK075-08 `isIanaTimeZone` heuristic | **Accepted only as an interim, with a fix**: R1-m3. A `packages/shared/src/intl` helper removes the lint obstacle the heuristic works around. |
| D-TASK075-09 D-ARCH-106 deferred | **Accepted.** The card makes it due "in the PR that first wires the port into module code", and this PR wires nothing into module code. |
| D-TASK075-10 carrier money as integer minor units in a `number` | **Accepted in substance** (integer minor units, no float). The **shape** diverges from ADR-0009 `Money` (R1-m6). |

## 5. Merge conditions

- C1: R1-M1 fixed (helper policy, `TrackingEvent` fields, tests), and R1-m1..m7 fixed or explicitly routed with an owner in the hand-off.
- C2: principal-architect records D-TASK075-01 (getRates return type) and D-TASK075-02 (vocabulary location and the planned move) against ADR-0010 §Interface.
- C3: security-analyst reviews the change (SECURITY-FLAGS below); lane-B evidence on the pushed head.

## 6. Good

- **Registration.** It reports every defect of every adapter in one error (with a hostile-proxy test proving unexpected errors are not swallowed), and checks "declared true but not implemented".
- **The guard.** It checks capability first, then context, then the adapter, so refusal happens with zero I/O. A network monitor with a real control test (fetch + raw socket counted) proves it, and a fast-check property covers all 2^6 declarations.
- **Mapping tables.** They are validated against DR-B30/DR-B18 at definition. Lookups go through `Map`s, inherited names (`__proto__`, `constructor`) are tested, and keys that collide after normalisation are refused. The catalogue is pinned to the REQUIREMENTS.md DR-B30 row and the data-model enums.
- **Log lines.** They carry shape-checked codes only (`(unprintable)` otherwise; the forged-newline test). The error message comes from the canonical code (the AT-US-124-04 PII test), and a carrier error code survives only in a safe shape.
- **Egress tables.** They are exact: WHATWG origin equality, no port, credentials, IP literal or wildcard, and dot segments refused. `Object.hasOwn` guards the table lookup, the derivation reads no configuration (with a property test over env mutations), and production rules are refused outside `APP_ENV=production`.
- **`createLabelDocument`.** It accepts only bytes plus `document_format`, rejects URLs and raster formats, and pins the PDF magic.

## 7. Security flags (for security-analyst)

- S1: ADR-0010 am. 11 item 6 tier matching does not stop a **production** context from reaching a **sandbox** prefix on a shared origin (DHL `/mydhlapi/` contains `/mydhlapi/test/`). Only the reverse direction is separated (R1-m4). TASK-113 should resolve the tier by longest matching prefix. Low impact (both endpoints belong to the carrier), but the ADR text claims separation in both directions.
- S2: `CarrierError.cause` is logged through the platform serializer with the URL path kept. ADR am. 11 item 8 ("drops any cause.message containing a URL") is not implemented in the error mapping (R1-m5). CWE-532.
- S3: the type-only deep import of `@platform/carriers/*` passes lint and is held by the typecheck gate only (R1-m2).
- S4: unmapped tracking events: the fix for R1-M1 adds `description` (PER) to the canonical event. It must never reach public tracking (DR-B31 / guardrail "no personal data beyond city on public tracking").

---

# Round 2 (pre-push), 2026-11-20

| Field | Value |
|---|---|
| Head | `dde830b`: merge `7de6ec8` (origin/main `2ec81df` into `c2eaa47`), then fix commit `dde830b` |
| Diff reviewed | fix: `git diff 7de6ec8 dde830b`, 19 files, +981 / -171 (all under `packages/carriers/src`); remerge of `7de6ec8` |
| Inputs | round-1 findings above; security review `PR-pending-TASK-075-security-review.md` (PR075-SEC-01..09); D-SD-003 item 5 (routing of the TASK-075 follow-ups); D-TASK075-11..18 (in the hand-off) |

## R2.1 Verdict

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: R1-M1 is closed: unmapped tracking events come back as IN_TRANSIT with unmapped: true, in input order, and none
         is dropped. TrackingEvent carries unmapped, carrierEventId and description (PER, never logged). The R1 MINORs and
         NITs are fixed or routed (D-SD-003). PR075-SEC-01..08 are addressed. One new MINOR: the label checks have false
         negatives, and the guard drops a refused label, which DHL/FedEx cannot recover. Four NITs.
```

The approval holds only if (i) lane B passes on `dde830b` and (ii) principal-architect records D-TASK075-01 (merge condition C2). R2-m1 does not block: it can be fixed here or routed to TASK-101 with its fixtures.

## R2.2 Verification performed (same HOST RULE: static review and single-process Node probes on a `git archive` extract; no npm, no Jest, no Docker)

- **Remerge `7de6ec8` is a pure union:**
  - `git merge-tree --write-tree c2eaa47 2ec81df` gives a tree with no diff to `7de6ec8`;
  - `comm -12` of the two sides' file lists against the merge base is empty;
  - main's 11 commits touch only `docs/**`, `prisma/tests/**`, `tools/db/**` and `tools/quality/**`. Nothing under `packages/carriers` or `packages/config`.
- **Gates on the `dde830b` archive** (node_modules junction to the worktree; the worktree was not touched):
  - `tsc -p` (scratch tsconfig over `packages/carriers/src` and the config test, noEmit): exit 0;
  - type-aware ESLint with `--max-warnings 0` on the 36 `.ts` files of `5145d52..dde830b`: exit 0;
  - `prettier --check`: clean.
- **Not re-run:** Jest and coverage. Lane B on `dde830b` is queued and is the binding evidence.
- **Behaviour probes** (`probe2.ts`, tsx):
  - Q8: `['OK', 'a b', undefined, 'ZZ']` gives `DELIVERED/false` followed by three `IN_TRANSIT/true`. That is one output per input. It writes two warn lines (`(unprintable)` and `ZZ`), with no description.
  - Q9: the adapter receives only the six context fields, so an extra `secret` key is dropped. Together with the guard-hardening tests (getter flip, Proxy, mutation after the call starts), the snapshot is taken synchronously before the adapter runs: closed.
  - Q7b/Q7c: a sandbox prefix covering a production exact path is refused, and an own `__proto__` rule key is refused.
  - Q6c: a `DOMException('…https://x/y', 'TimeoutError')` cause becomes `{ name: 'TimeoutError' }`, with no URL.
  - The new findings come from Q1–Q7 (below).
- **Routing check:**
  - R1-m2: the TASK-076 code review (`PR-pending-TASK-076-code-review.md` line 128) confirms that `CARRIERS_DEEP_IMPORT_PATTERN` has value, `import type` and `export type … from` fixtures. That covers the shapes my round-1 lint probe found clean.
  - R1-m3, R1-m6 and R1-n9: routed in D-SD-003 item 5 to TASK-124, TASK-080 and TASK-079.

## R2.3 Round-1 closure

| R1 item | Status | Evidence |
|---|---|---|
| M1 unmapped tracking dropped | **Closed** | `normalise.ts:156-180`; `types.ts` `TrackingEvent.unmapped`, `carrierEventId`, `description` (PER JSDoc); `tracking-and-logging.test.ts:40-78` (example, plus a property that preserves length, order and catalogue status); old drop test removed |
| m1 clone after validate | **Closed** | `guard.ts:57-94` clones first and validates the clone; a non-cloneable value is a named issue, and the registry still reports the other adapters (`guard-hardening.test.ts:131-163`) |
| m2 `import type` deep path lints clean | **Routed** | TASK-076 pattern and fixtures (verified above); whichever PR merges second re-runs negative-fixtures |
| m3 IANA heuristic | **Routed** | TASK-124 (D-SD-003); the test title now says "interim heuristic" |
| m4 false egress property | **Closed** | `egress.test.ts`: `fc.pre` excludes `test/…`, and an explicit overlap example documents the TASK-113 obligation |
| m5 cause logged with URL path | **Closed** | `errors.ts` `safeCause` reduces `cause` to `{ name, code? }`; real-PlatformLogger test (`tracking-and-logging.test.ts:108-127`) asserts no sentinel, path or tracking number |
| m6 CarrierMoney vs ADR-0009 | **Routed** | TASK-080 (D-SD-003) |
| m7 contract gaps | **Closed** | `incoterm` (required on `ShipmentRequest`, optional on `RateRequest`), `PackageSpec.packageType`, `ShipmentConfirmation.packages` (`ShipmentPackageResult`) |
| n1 dead branch | **Closed** | encoded-separator check now runs first; the test asserts its own message |
| n2 coerced `carrierErrorCode` | **Closed** | `typeof` check; `hardening-misc.test.ts` uses `1001` |
| n3 bidi / lone surrogate | **Closed** | `\p{Cf}` and `\p{Cs}` stripped; test |
| n4 required ops read live | **Closed** | all eleven operations bound at registration; test |
| n5 hand-built context | **Closed** | `snapshotContext` re-validates through `createCarrierContext`; test |
| n6 RateResponse JSDoc | **Closed** | reworded; the invariant goes to the TASK-101 suite |
| n7 errors.ts overclaim | **Closed** | JSDoc names the TASK-132 conversion |
| n8 `es-419` | **Closed** | regex and test |
| n9 Mock clause of AT-US-121-02 | **Routed** | TASK-079 (D-SD-003) |
| n10 environment outside the union | **Closed** | named issue; test |
| n11 cross-carrier canonical collision | **Closed** | the registry checks uniqueness across adapters; test |

## R2.4 New findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| R2-m1 | MINOR | `packages/carriers/src/labels.ts:30-55`; `guard.ts:149-166, 184-188` | The new format checks have **false negatives**, and `createShipment` now **drops** a label the check refuses (PR075-SEC-03 (b)). `recoverLabel` is true for UPS and Mock only (ADR-0010 am. 11 item 3), and DHL has no cancel, so for DHL Express and FedEx a dropped label is the only copy lost. The shipment ends booked, unvoidable (DHL) and label-less (`EXCEPTION`, operator). Probes: Q1 rejects as ZPL a payload whose `~DG` logo download before `^XA` is 3.2 KB, because only the first 1 KiB is searched (a 0.9 KB graphic passes). Q2 rejects a PDF with a UTF-8 BOM or a CRLF before `%PDF-`; PDF readers tolerate a header within the first 1024 bytes. Q3 is the reverse residual: EPL whose field data contains `^XA` passes as ZPL. The security review asked for the ZPL check to be re-checked against real carrier ZPL before merging, but no real fixtures exist yet. | (a) Search `^XA` across the whole payload (still linear; the outbound client already caps response size), or skip leading `~D*` download commands before applying the window. (b) Accept `%PDF-` within the first 1024 bytes for the PDF formats. (c) In any case, route to TASK-101 (and TASK-135/139/140): every real-carrier ZPL and PDF fixture must pass `createLabelDocument`, and a refused label for a carrier with `operations.recoverLabel = false` must be a test case with the saga's EXCEPTION path. If (a)/(b) are deferred, record the residual next to PR075-SEC-03. |
| R2-n1 | NIT | `packages/carriers/src/guard.ts:15-17, 184-188` | The JSDoc says `createShipment` "never throws after the carrier accepted the shipment". Q4 (adapter returns `null`) and Q4b (a label getter throws) throw a TypeError or Error after the call. The duplicate-label guardrail then rests on TASK-132 treating a non-`CarrierError` failure after the call as ambiguous (EXCEPTION, no retry; add this to the TASK-132 hand-off next to the D-SD-003 line). Either way, the sentence is not true. | Wrap the post-call label pass in try/catch (on failure: `labels: []` plus one warn line), or reword to "never throws a `CarrierContractError`…". |
| R2-n2 | NIT | `packages/carriers/src/guard.ts:36-39`; `registry.ts:22` | `GuardOptions.logger` is optional, so a composition root that omits it drops labels with no log line (Q5). | Make `logger` required in `createCarrierRegistry` (the production entry), and keep it optional only on `guardAdapter` for tests. |
| R2-n3 | NIT | `packages/carriers/src/errors.ts:31-39` | `safeCause` reads `name`/`code` without a guard. A Proxy or throwing getter makes `new CarrierError(...)` itself throw (Q6, Q6b), turning error mapping into an unrelated error. | Wrap the reads in try/catch and return `{ name: 'Error' }`. |
| R2-n4 | NIT | `packages/carriers/src/egress.ts:89-103` | `crossTierIssues` compares only sandbox **prefixes** with production entries. A sandbox **exact** path under a production prefix on the same origin passes: Q7, sandbox `/api/rates` against production `/api/`, which lists a production endpoint as a sandbox-tier rule. That is the copy-paste error PR075-SEC-02 (a) targets, in its exact-path form. The shared-token case (the same exact path listed in both tiers) must stay allowed. | Also refuse a sandbox exact entry covered by a production prefix unless the identical exact path is listed in production too. Add the Q7 row to the test. |

## R2.5 Rulings (round-2 decisions as summarised in the dispatch; D-TASK075-11..18 are in the hand-off)

- **Drop-not-throw for `createShipment` labels, refuse for `recoverLabel` (PR075-SEC-03 (b)): accepted.** A throw would be retried into a duplicate label, and that guardrail outranks label completeness. The cost is R2-m1 for non-recoverable carriers, so the checks must not refuse real carrier output.
- **`safeCause` `{ name, code? }` replacing the cause: accepted.** It is stricter than ADR-0010 am. 11 item 8 ("drop a cause.message containing a URL"): it drops every message. That is the safe reading.
- **Unmapped tracking → `IN_TRANSIT`, `unmapped: true`, metric owned by TASK-168 from the flag: accepted.** It matches REQ-TRACK-001 and US-241.
- **Warning cap of 20 distinct codes plus one summary line per call (PR075-SEC-07): accepted.**
- **Closed EGRESS schema and one-directional sandbox-covers-production check, with the reverse direction routed to TASK-113 (D-SD-003): accepted,** with R2-n4.
- **Routings of R1-m2 (TASK-076), R1-m3 (TASK-124) and R1-m6 (TASK-080): accepted** (verified above).
- **`incoterm` required on `ShipmentRequest` but optional (DAP when absent) on `RateRequest`: accepted.** The quote flow defaults DAP (REQ-CUST-005), while a booking must state it.

## R2.6 Merge conditions (replace §5)

- C1: met for code review. R2-m1 is fixed here or routed to TASK-101/135/139/140 in the hand-off.
- C2: **still open for D-TASK075-01.** principal-architect records `getRates: RateResponse` against ADR-0010 §Interface ("exactly as brief §4.3"). D-TASK075-02 is covered by the D-SD-003 routing of the move to TASK-080; an architect line acknowledging the drift is still advisable.
- C3: lane B passes on `dde830b`, and the security round 2 is recorded.

## R2.7 Security flags (round 2)

- R2-n4: the sandbox exact path under a production prefix (PR075-SEC-02 (a), exact-path form).
- R2-m1: a format false negative destroys the only label copy for DHL/FedEx (availability and integrity, not confidentiality).
