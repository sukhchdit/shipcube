# Code review: TASK-079 deterministic Mock carrier (pre-push, round 1)

| Field | Value |
|---|---|
| Task | TASK-079 (US-122 DC, REQ-CARR-004, NFR-QUAL-005; AT-US-008-03 Mock hop, D-ARCH-106, AT-US-121-02 on the real Mock, R3-m1 / PR075-SEC-14 / D-SECPR075-03, PR076-SEC-06) |
| Head | `7815e1c8` (one commit on main `f9cc7ca1`), branch `feat/TASK-079-deterministic-mock-carrier`; not pushed, no PR number yet |
| Reviewer | code-reviewer, 2026-11-20 |
| Bindings read | CLAUDE.md; brief `docs/04-plan/briefs/TASK-079.md` and its card; US-122 (6 scenarios) and US-123 scenario 1; ADR-0010 body and amendments 9, 11, 12; ADR-0014 G2 (client reference = shipment id); TASK-075 sources on main (`guard.ts`, `registry.ts`, `labels.ts`, `context.ts`, `capabilities.ts`, `tests/network-monitor.ts`); `packages/shared` Money helpers and `outboundCallFields`; developer decisions D-TASK079-01, -02, -03, -05, -07 as named in the dispatch (-04 and -06 are not in the commit body and were not given to me, so they are not ruled here) |

```
VERDICT: APPROVED_WITH_NITS (merge conditions C1-C3 below)
SUMMARY: A clean, pure Mock: price = f(billable weight, zone, service) on the Money helpers, tracking number = f(client
         reference), generated PDF/ZPL labels that pass createLabelDocument and both sniffers, one outboundCallFields line
         per operation, a gated latency hook, empty egress, 100 % line coverage. No BLOCKER or MAJOR. Three MINOR items
         are design hand-offs (call-record channel, fixed tracking anchor, latency sleep blind to the deadline), routed.
```

## 1. What I verified myself

Host rule of the dispatch: no install, Jest or Docker in the evidence worktree (lane B was running there, started 10:57Z). I ran everything in a `git archive 7815e1c8` extract in the scratchpad, with `node_modules` junctioned to the main checkout (the PR adds no dependency), and removed it afterwards (main `node_modules` count 740 before and after; worktree `git status` clean).

| Check | How | Result |
|---|---|---|
| Unit tests of the Mock | `jest --selectProjects unit --testPathPatterns packages/carriers/src/adapters/mock --maxWorkers=2 --coverage` | 4 suites, 73 tests pass. Coverage of `adapters/mock/**`: 100 % statements, lines and functions, 96.05 % branches (`mock-adapter.ts` 94.16 %, `rates.ts` 96.15 %). Above the 85/75 bar |
| Changed guard test | `jest --selectProjects unit --testPathPatterns tools/lint/carrier-wire-boundary` | 6/6 pass |
| Types | `tsc -b packages/carriers` in the extract | Clean |
| Lint | `eslint --max-warnings 0` on `adapters/mock/**`, `src/index.ts`, `tools/lint/carrier-wire-boundary.test.ts` (repository config, type-aware, includes `platform/money-arith`) | Clean |
| Format | `prettier --check` on the same set | Clean |
| Probes (node) | `Date.parse('2026-02-30T00:00:00.000Z')`; `trackingNumberFor('X\u00002')` vs `trackingNumberFor('X', 2)` re-implemented from `derive.ts` | Feb 30 rolls over to 2026-03-02 (n5); the two numbers are equal, `MOCK195712048854` (n3) |
| Not re-run | full `test:unit`, coverage merge, build of every workspace, lane A gates | Rely on lane B for `7815e1c8` (C1) |

Read in full: all 17 files of `adapters/mock/`, the barrel delta, the boundary test, and the callers on main (`guard.ts` `run`/`checkedLabels`, `registry.ts`, `createLabelDocument`, `isPdf`/`isZpl`, `createCarrierContext`, `outboundCallFields`, Money `mulRatio`/`percentage`/`ratio`).

## 2. Correctness notes (what holds)

- **Determinism.** No `Math.random`, no wall clock, no `randomUUID`. `Date.parse`/`new Date(n)` are pure conversions of request data; `performance.now` and the timer only enter through the `monotonicMs`/`sleep` seams and only affect `durationMs` and waiting. Labels carry no `/CreationDate` or `/ID`, so the bytes are stable (tested for every format).
- **Money.** `priceService` rounds once per product through `mulRatio`/`percentage` (halves away from zero), `ratio(billableG / 500)` is always an integer because `billableWeightG` rounds up to the step. Totals equal base + fuel (tested). Example values are hand-checked in `mock.units.test.ts` (STANDARD zone 4 2 kg = 4816; EXPRESS zone 1 0.5 kg = 3102).
- **Limits before arithmetic.** `assertPackages` (positive safe integers) then `limitViolation` run before any multiplication, so the volumetric product is bounded (at most 768e6). A 1000 kg request is `{ quotes: [], noServiceReason: 'WEIGHT_EXCEEDED' }`, not an exception (AT-US-122-06).
- **Labels.** The adapter returns raw `{ format, content }`; `printable` restricts tracking text to `[A-Za-z0-9_ .:-]` before it reaches PDF or ZPL syntax (property test with arbitrary strings, plus `A^XZ^XA~DG` and `A)Tj(B`). PDF xref offsets and `/Length` are correct because the text is ASCII (tested). Every format passes `createLabelDocument` and its sniffer; BOM/blank leads, the 1023/1024 window edge and foreign headers are covered, and the guarded `createShipment` drops none of the four formats.
- **Call log.** `instrument` emits exactly one `carrier.call` line in `finally` (success and failure), through `outboundCallFields`, with `correlation_id = ctx.correlationId`; the field set is pinned and a content scan proves no party, postcode, reference or label text leaks. The record's outcome for a `CarrierContractError` is `CARRIER_UNKNOWN_ERROR`, which matches what the guard turns it into.
- **Gating.** `scenariosEnabled === true` is strict; disabled (the default) ignores `latency=6000`; out-of-range and malformed directives never sleep.

## 3. Findings

| ID | Severity | File:line | Issue | Required fix / route |
|---|---|---|---|---|
| m1 | MINOR | `mock-adapter.ts:97-100, 249, 277-278, 285` | **The call-record channel (D-TASK079-02) is not reachable by its stated consumer.** `callRecords()` exists only on the raw adapter. `createCarrierRegistry` hands out `GuardedCarrierAdapter = Readonly<Required<CarrierAdapter>>`, a frozen facade that has no `callRecords`, so the booking saga (TASK-092) can reach the records only if the composition root keeps a second, unguarded reference. The list is also a per-process ring of 1,000 entries shared by every request and replica. That is fine as test evidence but not as an audit source: under load an entry can be evicted before the saga reads it. Separately, `Math.max(1, NaN)` is `NaN`, so `maxCallRecords: NaN` (or `Infinity`) silently makes the ring unbounded. | Now: validate `maxCallRecords` as a positive safe integer (fall back to the default), and state in the README/JSDoc that `callRecords()` is diagnostic/test evidence and that the saga cites the `ctx.correlationId` it created. Before TASK-092, and before DHL/FedEx/UPS copy this pattern: principal-architect decides the record channel (for example an injected `onCall(record)` sink port, like the logger). Route to TASK-092 and principal-architect. |
| m2 | MINOR | `tracking.ts:11`, `mock-adapter.ts:247, 314` | **Every Mock shipment tracks straight to `DELIVERED`, with events dated from a fixed past anchor** (`2026-01-05T09:00Z`). A shipment booked today with ship date 2026-12-01 shows INFO_RECEIVED through DELIVERED in January 2026, months before it existed. This is deterministic and matches "track baseline" on the card. But it is demo-critical: TASK-089 and the PRD exit demos show tracking, and the tracking ingestion (REQ-TRACK forward-only, event time against shipment creation) will see a timeline that ends before it starts. `track()` gets only numbers, so the Mock cannot anchor on the ship date. | Record the limitation in the README. Route the fix to TASK-097 (the `track=` vocabulary, where a happy-path progression relative to an injected `Clock` or a per-number anchor belongs) and tell the tracking-ingestion owner, so nobody builds a sanity check that rejects every Mock event. |
| m3 | MINOR | `mock-adapter.ts:245, 257-258` | **The latency sleep ignores `ctx.deadlineAt` and cannot be aborted.** In US-123 scenario 1 (`latency=6000` against the 4,000 ms rates deadline) the gateway reports TIMEOUT at 4 s. The Mock's timer then keeps running for 2 s more, and afterwards writes a `carrier.call` line and a record with outcome `OK` for a call the caller already treated as a timeout. A saga that cites the record would see a contradiction. In the API Jest lanes the pending timer is an open handle for up to 30 s. | Cap the wait at `deadlineAt` (through an injected `Clock`/`nowMs` seam, as ADR-0010 §Ports already provides) and record `CARRIER_TIMEOUT` when the cap is hit, or accept an `AbortSignal` once TASK-132 defines one. Route to TASK-097 or TASK-132, whichever lands the gateway timeout first. |
| n1 | NIT | `tools/lint/carrier-wire-boundary.test.ts:117-119` | The sanctioned exception stops at `./adapters/mock/index.js`; the scan does not look inside it. The key pin in `mock.units.test.ts:128-143` catches a new **value** re-export, but `export type { X } from '../ups/wire.js'` in `mock/index.ts` would pass both tests, and that is exactly the type leak AT-US-121-05 guards against. | Also scan `adapters/mock/index.ts`: every `from` specifier must match `^\./[a-z-]+\.js$` (same folder, no `..`, no `wire`). |
| n2 | NIT | `src/index.ts:157-173`, `adapters/mock/index.ts` | The package surface is wider than the composition root needs. It must register the Mock and derive egress: `createMockAdapter`, `MOCK_CARRIER_CODE`, `MOCK_SERVICE_CODES`, `MOCK_EGRESS` and the types. `mockLabel`, `MOCK_LABEL_MARKER`, `mockCapabilities`, `parseLatencyMs` and `MAX_LATENCY_MS` are test helpers or TASK-097 territory: publishing `parseLatencyMs` now freezes an API that TASK-097 will replace with the full DR-B29 parser. | Trim the barrel (the Mock tests already import from `./index.js` and the sibling modules) and adjust the key pin. |
| n3 | NIT | `derive.ts:12-21` | `parts.join('\u0000')` is ambiguous: `trackingNumberFor('X\u00002')` equals `trackingNumberFor('X', 2)` (probed: both `MOCK195712048854`). Client references are shipment UUIDs (ADR-0014 G2), so this cannot happen today. | Encode the parts unambiguously (`JSON.stringify(parts)` or length-prefixed). |
| n4 | NIT | `README.md` (Track row), `mock.calls.test.ts:159, 198` | "A number the Mock did not issue is `found: false`" and "refuses a number it never issued" overclaim: the Mock is stateless, so any `MOCK\d{12}` is found and cancellable. | Say "a number that is not in the Mock format". |
| n5 | NIT | `mock-adapter.ts:194-198`, `rates.ts:81-85` | `isoWeekday` and `estimatedDelivery` accept rollover dates: `2026-02-30` becomes Monday 2026-03-02 (probed), so a pickup on a non-existent date is served. | Round-trip check: `new Date(t).toISOString().slice(0, 10) === date`. |
| n6 | NIT | `mock-adapter.ts:250, 284`; `capabilities.ts:44` | `capabilities()` returns the same mutable object on every call, while the JSDoc of `mockCapabilities` says "a fresh declaration per call". The guard clones at registration, so only raw-adapter callers are exposed. Also `volumetricDivisor.metric: 5000` repeats `VOLUMETRIC_DIVISOR_MM3_PER_G`. | Deep-freeze the instance (or return `mockCapabilities()`), and use the constant. |
| n7 | NIT | `mock.contract.test.ts:56-79`; `mock.calls.test.ts:52` | AT-US-122-02 says "price changes **only** with weight, zone or service", but the "only" half is one example, not a property. In the AT-US-008-03 test the expected `routeTemplate` is copied from the actual line, so the per-operation route is not pinned (only the `/mock/v1/` prefix). | Add an fc property that varies content type, direction, ship date, residential, postcode, account and correlation and asserts equal totals. Pin `ROUTE[operation]` literally. |
| n8 | NIT | `mock.calls.test.ts`, `mock.units.test.ts` | The brief says to wrap the Mock tests in the network monitor. Only `mock.contract.test.ts` is wrapped; it does exercise every operation once under the monitor, so the property holds, but the calls suite (latency hook, real timer) runs unmonitored. Separately, the test titled "uses only injected seams for time: ... are the only clock reads" proves only that the defaults work. | Move the `beforeEach`/`afterEach` monitor into `tests/support.ts` and use it in all three suites. Retitle the seam test. |
| n9 | NIT | `rates.ts:41-51` vs `capabilities.ts:36` | `limitViolation` compares dimensions in any orientation, but the declaration publishes per-axis `maxDimensionsMm` (1200 x 800 x 800). If TASK-083's DR-B34 eligibility compares per axis, a 100 x 1200 x 800 box is excluded from fan-out, although the Mock would quote it. | Route to TASK-083: use the same orientation-free rule (best as a shared helper in `capabilities.ts`). |

## 4. Deviation rulings

| Decision | Ruling |
|---|---|
| **D-TASK079-01** (barrel exports `./adapters/mock/index.js`; the AT-US-121-05 scan allows exactly that entry) | **Accepted.** A `./testing` subpath would be the wrong home: the Mock is a runtime adapter that the API/worker composition root registers when `MOCK_CARRIER_ENABLED`, and `registry.ts` (TASK-075) already says that the composition root builds the adapters. The AT protects **wire formats**, and the Mock has none. Naming the exception exactly, and keeping the "the exports map has `.` only" pin, keeps the guard tight, so PR076-SEC-06 does not trigger (no subpath added) and its line moves to the first task that adds one. Two follow-ups: n1 (scan inside the entry) and n2 (narrower surface). Forward note for principal-architect: the real adapters (TASK-101/135/139/140) need the same factory exposure. When the first lands, replace the named exception with a rule ("an `adapters/<x>/index.ts` entry re-exports its factory and egress only, never from `wire`") instead of growing a list of names. |
| D-TASK079-02 (bounded `callRecords()`) | Accepted for this task, with m1. |
| D-TASK079-03 (injected `monotonicMs`/`sleep`/`trackingStart` seams) | Accepted. It matches ADR-0010 §Ports. m3 asks for a `Clock`/now seam for the deadline cap. |
| D-TASK079-05 (pricing model: flat fee + zone step x service permille per 500 g + 12 % fuel, 4 zones over 7 regions) | Accepted. The model is monotone in weight and zone, and EXPRESS > STANDARD > ECONOMY holds (fc property over 1-600 steps). The demo lane US to IN is zone 4. |
| D-TASK079-07 (contract tests under `src/adapters/mock/`) | Accepted, as the brief directs. qa-lead reconciles the `carrier-contract` runner text (`packages/carriers/test/contract`) with `packages/carriers/src/adapters/mock/mock.contract.test.ts` in the manifest-only activation PR. `required-suites.json` is untouched (correct). |

## 5. Acceptance trace

| AT | Test | Verdict |
|---|---|---|
| AT-US-122-01 | `mock.contract.test.ts` (three services, transit ranges, byte-identical JSON) | Met |
| AT-US-122-02 | example 2.0 vs 2.5 kg plus repeat; fc property on weight and zone; units property | Met (n7: "only" is an example) |
| AT-US-122-03 | same reference, same number and identical label bytes, marker; fc purity property; multi-package; label fixture suite | Met |
| AT-US-122-04 | DOCUMENT export, IN to US import, US to US domestic; symmetric zones | Met |
| AT-US-122-05 | capabilities flags; no `estimateLandedCost` own property | Met |
| AT-US-122-06 | 1000 kg, 5 x 69 kg, 1300 mm, rotated box, empty list | Met |
| AT-US-121-02 (real Mock) | `capabilityIssues(mockCapabilities(), 'MOCK')` is `[]`, plus mutations; registration through the registry; landed cost refused before the adapter is entered (0 log lines) | Met (closes TASK-075 R1-n9) |
| AT-US-008-03 Mock hop | one line per operation (10 operations), field allow-list pinned, correlation ID on the line and the record, failure codes | Met (m1 on the record's consumer) |
| D-ARCH-106 latency hook | directed wait on every operation, real timer, duration includes latency, disabled/malformed never sleep | Met (m3) |
| R3-m1 / PR075-SEC-14 label fixtures | `labels.test.ts` | Met (closes the TASK-075 R3-m1 item for the Mock; real carriers keep theirs) |
| PR076-SEC-06 | no subpath added; exports pin kept in two tests | Not triggered; the line moves on |

## 6. Merge conditions

- **C1.** Lane B PASS on `7815e1c8` (running at review time; unit profile), with the coverage quote for `packages/carriers/src/adapters/mock/**`.
- **C2.** A security record on the head. `tools/lint/carrier-wire-boundary.test.ts` is a CODEOWNERS path (`/tools/lint/`), and the AT-US-121-05 guard was relaxed by one named entry (D-TASK079-01). The record should also state the PR076-SEC-06 disposition (not triggered).
- **C3.** Routing recorded by the orchestrator: m1 to TASK-092 and principal-architect, m2 to TASK-097 and the tracking owner, m3 to TASK-097/TASK-132, n9 to TASK-083, and D-TASK079-07 runner text to qa-lead. The NITs may be fixed in this PR or by the next task that touches `adapters/mock/`.

## 7. Good patterns worth keeping

- One `instrument` wrapper as the only path of every operation: log, record, latency and outcome are decided once, and the "exactly one line" claim is structural, not per-method.
- Labels generated in code (nothing binary committed, no gitleaks exposure), with an input-sanitiser property that proves no tracking text reaches PDF or ZPL syntax.
- Limits checked before any multiplication, and malformed input refused as a `CarrierContractError` that the guard already knows how to classify.
- The exception in the guard test is named exactly and pinned to occur once, and the folder's runtime surface is pinned by key.

## 8. Security flags (for security-analyst)

- **SF-1.** The Mock factory now ships in every consumer bundle through the package barrel. Production exclusion rests on the composition root registering it only when `MOCK_CARRIER_ENABLED` and on `guards.ts` refusing that flag in production. Confirm that `adapters/mock/**` has no import-time side effect (I found none: constants, a frozen table and pure functions only).
- **SF-2.** The AT-US-121-05 guard change sits in a CODEOWNERS path (C2).
- **SF-3.** With scenarios enabled, `latency=30000` holds a bulkhead slot per call for up to 30 s, and the sleep ignores the deadline (m3). This is non-production only (`MOCK_SCENARIOS_ENABLED` refused in production), but the edge strip of `X-Mock-Scenario` in non-local environments is what bounds it.
- **SF-4.** Mock tracking numbers are `SHA-256('tracking' NUL shipmentId)` reduced to 12 digits, so anyone who knows a shipment id can compute its tracking number. This only matters if public tracking treats the number as a capability; the Mock is not in production.
