# PR-pending: TASK-079 (deterministic Mock carrier), security review

**File name.** The PR does not exist yet. Once it does, the orchestrator renames this file on main, with `git mv` in a docs-only commit, to `docs/05-quality/security/PR-<NNNN>-TASK-079-security-review.md`, where `<NNNN>` is the PR number zero-padded to 4 digits. The content stays as it is. Main's `check-security-owned-paths.mjs` counts only `PR-<NNNN>-*.md` records for PR `<NNNN>`, so under the pending name this record satisfies nothing. Order (D-ORCH-136, D-ORCH-138): open the PR as a draft, rename the record on main, confirm that the PR's merge ref contains the renamed record (`git fetch origin refs/pull/<n>/merge`, then `git ls-tree`; its first parent must be the rename commit or later), then mark the PR ready.

| Field | Value |
|---|---|
| PR | Not opened yet. Branch `feat/TASK-079-deterministic-mock-carrier`, one commit on main `f9cc7ca1` |
| Head | 7815e1c8353115041876cd43b96e3a4cda52a82c |
| Lane A evidence | None: the branch is not pushed. Main's classifier (`tools/ci/security-paths.mjs --base f9cc7ca1 --head 7815e1c8`) gives `security_paths=false` (19 changed paths), so the hosted `security-integration` job does not run on this PR |
| Lane B evidence | None read by me. The code-review twin (`docs/05-quality/reviews/PR-pending-TASK-079-code-review.md`, merge condition C1) reports 73/73 Mock unit tests and 6/6 boundary tests on an extract, coverage of `adapters/mock/**` 100 % lines / 96.05 % branches |
| Owned paths changed | 1, as main's checker counts them (`--base f9cc7ca1 --head 7815e1c8`): `tools/lint/carrier-wire-boundary.test.ts` (`/tools/lint/`). So this record is a merge condition. `packages/carriers/package.json` (owned) is unchanged |
| Unowned paths changed | 18: `packages/carriers/src/adapters/mock/**` (17 files: sources, README, tests, test support) and `packages/carriers/src/index.ts` |
| Binding items checked | The TASK-079 card and dispatch brief (`docs/04-plan/briefs/TASK-079.md`); D-TASK079-01 (barrel exception); ADR-0010 §Mock carrier and am. 9/11; ADR-0005 am. 11 item 21 with D-ARCH-106 (latency hook as the T-83 runtime twin); REQ-CARR-005/006 and DR-B29 (directive sources `X-Mock-Scenario` and `MOCK:` customer reference, `latency` 0..30000 ms); PR075-SEC-14 with D-SECPR075-03 (label fixtures); PR076-SEC-06 with D-SECPR076-01 (subpath control); AT-US-008-03 (Mock hop) and the `outboundCallFields` allow-list; `packages/config/src/guards.ts` `productionGuard`; the TASK-097 and TASK-083 cards |
| Reviewer / date | security-analyst, 2026-11-20, round 1, pre-push. Host rule: no npm, Jest, type-check, build or Docker, and nothing in the evidence worktree `../Shipqube-TASK-079` (not touched, not even read-only git; the branch was read with `git show` / `git archive` from the main checkout). Method: static review plus single-process Node 24 probes on `git archive` extracts of `7815e1c8` and `f9cc7ca1`, sources type-stripped by a resolve/load hook (`@platform/*` mapped to the extract, bare packages resolved from the main checkout) |

## 1. Summary

The Mock is a pure, network-free adapter, and every focus item holds in its direct form:

- **Barrel exception (D-TASK079-01).** It does not weaken the control's purpose today. The Mock has no wire format. A transitive walk from the barrel reaches 25 modules, and none of them is a wire module or another carrier's adapter. The deep-import lint pattern and the `.`-only exports map are unchanged and still pinned. What changes is the shape of the guarantee: the scan now opens one named door into `adapters/`, and it does not look behind that door. A `wire` module re-exported from inside `adapters/mock/` passes the owned test (PR079-SEC-01, LOW). I accept D-TASK079-01 with that follow-up.
- **Labels.** I built 80,040 labels (20,010 tracking texts in 4 formats, hostile and fuzzed). Every one passed `createLabelDocument` and its own sniffer, and none sniffed as the other kind. The PDF structure was exact: xref offsets, `/Length`, three balanced literal strings, no backslash. Each ZPL label had exactly one `^XA` and one `^XZ`, no `~`, and its field data stayed in the printable alphabet. The lead cases of PR075-SEC-14 behave as ruled, and the guarded `createShipment` keeps every Mock label.
- **Hostile tracking text** never reaches a label, a log line, a record or a tracking event. `recoverLabel` refuses any number that is not in the Mock format. `track` echoes the caller's own input in `trackingNumber` and never reflects it into events. The events are fixed, city-level constants.
- **Latency directive.** Production cannot reach it: the flag is a strict boolean, the default is off, and `productionGuard` refuses `MOCK_SCENARIOS_ENABLED` in production. The parser caps the value at 30,000 ms, and the context caps the directive at 512 characters. The sleep ignores `ctx.deadlineAt` and cannot be cancelled. So once TASK-097 wires an untrusted source, a caller can hold each Mock call for up to 30 s, whatever the deadline (PR079-SEC-02, LOW, the twin of code review m3).
- **Call records** hold identifiers only. The bound can be switched off by a non-finite option (PR079-SEC-03, INFO, the twin of m1).
- **Call log.** A throwing logger in `finally` replaces the call's outcome. That matters for the real adapters that copy this pattern (PR079-SEC-04, INFO).
- **AT-US-008-03.** Every operation that enters the adapter writes exactly one `carrier.call` line. Its key set is the 8 allow-listed keys. 11 random PII sentinels appeared in 0 lines, records or warnings.
- **Zero network.** I installed traps for sockets, TLS, DNS, UDP, `http(s)`, `fetch` and `child_process` before importing the barrel, then ran every operation, including the latency path on the real timer. They recorded 0 attempts. The Mock has no import-time side effect.
- **Egress.** `MOCK_EGRESS` is empty in both environments and frozen. It contributes no rule.
- **PR076-SEC-06.** Not triggered: no subpath was added.
- **Production exclusion.** Nothing here enables the Mock in production: no app file changed, and nothing outside `packages/carriers` references the factory. The Mock does answer contexts with a `production` account, so production exclusion is defence in depth for TASK-097 (PR079-SEC-05, INFO).

No Critical, High or Medium finding. **Verdict: PASS_WITH_FOLLOW-UPS.**

## 2. Findings

### PR079-SEC-01 · LOW · The AT-US-121-05 barrel scan stops at the sanctioned Mock entry, so a wire module re-exported from inside `adapters/mock/` passes the owned control

| | |
|---|---|
| CWE / OWASP | CWE-693 Protection Mechanism Failure · A04:2021 Insecure Design |
| Where | `tools/lint/carrier-wire-boundary.test.ts:113-119` (owned); residual guard `packages/carriers/src/adapters/mock/mock.units.test.ts:128-143` (unowned) |
| Twin | Code review n1 (NIT). It also covers the type-only form |

**Description.** Before this PR, the scan read every `from '…'` specifier of `packages/carriers/src/index.ts` and refused any specifier that named `adapters/` or `wire`. It now lets exactly `./adapters/mock/index.js` through, and it never reads that module. So the owned control proves "the barrel enters `adapters/` only through the Mock entry". It no longer proves "nothing reachable from the barrel is a wire module". The second statement is the purpose of AT-US-121-05. Inside the Mock folder, the only guard is the key pin in `mock.units.test.ts`. That file is not owned (a later PR can change it without a security record), and it sees only value exports.

**Probe** (`p5-barrel`: the head and base scan logic, copied verbatim, run on the extract with a planted `adapters/ups/wire.ts`):

| Case | Owned test at head | Candidate walk (below) |
|---|---|---|
| real head tree | pass | pass (25 modules reached) |
| M1 barrel re-exports `./adapters/ups/wire.js` | refused | refused |
| M2 barrel `./adapters/mock/../ups/wire.js` | refused | refused |
| **M3 `adapters/mock/index.ts` adds `export type { UpsWire } from '../ups/wire.js'`** | **pass** | refused |
| **M4 `adapters/mock/mock-adapter.ts` re-exports `../ups/wire.js`** | **pass** | refused |
| M5 barrel, double-quoted wire specifier (pre-existing; Prettier would rewrite it) | pass | refused |
| M6 barrel, `import('./adapters/ups/wire.js')` (pre-existing) | pass | refused |
| M8 `registry.ts` (a non-adapter hop) re-exports a wire module (pre-existing) | pass | refused |
| base tree (`f9cc7ca1`) | base test passes | pass |

M3 and M4 are new with this PR. M5, M6 and M8 pass the base test too, and the same fix closes them.

**Exploitability / impact.** No wire module exists yet; the first one arrives with TASK-135 (DHL Express). A later change in `adapters/mock/`, such as a TASK-097 scenario that reuses a real carrier's wire types to mimic its errors, would put carrier wire types on the package surface. The owned test would stay green, and no security record would be required. Impact: the boundary that keeps wire formats behind the capability guard and the normaliser erodes. Likelihood: low. Rating: LOW.

**Remediation (code).** Replace the one-level scan with a walk over relative specifiers from the barrel. Keep the exact-name pin.

```ts
import { posix } from 'node:path';
// in the existing it(...): after the exports-map pin
const src = join(repoRoot, 'packages', 'carriers', 'src');
const SPEC = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+|\brequire\s*\(\s*)(['"`])([^'"`]+)\1/gu;
const offending: string[] = [];
const seen = new Set<string>();
const queue = ['index.ts'];
for (let rel = queue.shift(); rel !== undefined; rel = queue.shift()) {
  if (seen.has(rel)) continue;
  seen.add(rel);
  for (const [, , spec = ''] of readFileSync(join(src, ...rel.split('/')), 'utf8').matchAll(SPEC)) {
    if (!spec.startsWith('.')) continue;
    const target = posix.join(posix.dirname(rel), spec).replace(/\.js$/u, '.ts');
    const foreignAdapter = target.startsWith('adapters/') && !target.startsWith('adapters/mock/');
    if (target.startsWith('..') || foreignAdapter || /(?:^|\/)wire(?:\/|\.|$)/u.test(target)) offending.push(`${rel} -> ${spec}`);
    else queue.push(target.endsWith('.ts') ? target : `${target}/index.ts`);
  }
}
expect(seen.has('adapters/mock/mock-adapter.ts')).toBe(true); // the walk really went through the Mock entry
expect(offending).toEqual([]);
```

When the first real adapter must be built by the composition root, principal-architect's forward note in the code review applies. Drop the `foreignAdapter` arm, keep the `wire` arm, and the walk stays the guard.

**Due / owner.** Fix in this PR's fix cycle if one happens. Otherwise TASK-097, the next holder of `pkg-carriers-mock`. In any case, it must land before the first `adapters/<carrier>/wire*` module merges (TASK-135). The file is owned, so the change needs a security round.

**Verification.** Add M3 and M4 as negative cases (an in-memory file map, or the probe above), and require the walk to report them. The real tree must pass, and so must a `seen.size` lower bound.

### PR079-SEC-02 · LOW · The latency directive's sleep ignores `ctx.deadlineAt` and cannot be cancelled; once an untrusted source is wired, every Mock call can be held for up to 30 s

| | |
|---|---|
| CWE / OWASP | CWE-400 Uncontrolled Resource Consumption · A04:2021 Insecure Design |
| Where | `packages/carriers/src/adapters/mock/mock-adapter.ts:245, 257-258`; `scenario.ts:10-24` |
| Twin | Code review m3 (MINOR) and SF-3 |

**Measured** (`p3-latency`, head extract, real timers):

- **The flag.** Only boolean `true` honours a directive. `'true'`, `1`, `{}`, `false` and `undefined` give no wait.
- **The parser** returns at most 30,000. These values give 0:
  - `latency=30001`, `99999`, `030000` and `000030000`;
  - `1e4`, `0x10`, `-1`, `+5` and `5 ms`;
  - an Arabic-Indic digit.

  It takes the first matching directive, so `latency=999999;latency=30000` gives 30,000. It parses a 512-character directive in 0.006 ms and a 64 KiB one in 0.61 ms (linear). A directive of 513 characters or more is refused by the guard before the adapter runs.
- **The deadline.** With `deadlineAt` 60 s in the past and `latency=400`, the guarded call still slept 406 ms and then answered OK.
- **The cost.** 20,000 concurrent pending calls cost about 2.3 KB of heap and one timer each, and finished in 3.2 s at 1,500 ms. The Mock's own cost is small. The risk is what the caller holds across the call: a bulkhead or concurrency permit, a worker slot for the booking saga, an HTTP socket. A transaction is what the D-ARCH-106 runtime twin is meant to catch.

**Exploitability / impact.**

- **Production:** not reachable. The adapter default is off, the flag is a strict boolean, and `productionGuard` refuses `MOCK_SCENARIOS_ENABLED` when `APP_ENV=production`.
- **This PR:** wires no source. No caller sets `mockScenario` from request data.
- **After TASK-097, in a non-production deployment that turns scenarios on:**
  - the `MOCK:` customer-reference source (DR-B29) is customer data, and the edge strip of `X-Mock-Scenario` does not apply to it;
  - any customer can then make each Mock call last 30 s;
  - a real carrier never outlives `deadlineAt`, because the HTTP client aborts at the deadline. The Mock answers OK after it, and writes an `OK` record for a call the gateway already treated as a timeout.

Rating: LOW (non-production availability, low likelihood).

**Remediation (code).** In the Mock, cap the wait at the deadline through an injected wall-clock seam, and end with the canonical timeout code:

```ts
/** Wall-clock milliseconds, for the deadline cap of the latency directive only. Defaults to `Date.now`. */
readonly nowMs?: () => number;
// in instrument():
const latencyMs = scenariosEnabled ? parseLatencyMs(ctx.mockScenario) : 0;
if (latencyMs > 0) {
  const remainingMs = Math.max(0, ctx.deadlineAt.getTime() - nowMs());
  await sleep(Math.min(latencyMs, remainingMs));
  if (latencyMs > remainingMs) throw new CarrierError('TIMEOUT', { carrier: MOCK_CARRIER_CODE });
}
```

The T-83 twin still works: a 1,500 ms latency under a deadline of at least 1.5 s keeps the transaction idle for longer than 1,000 ms. In addition:

- **TASK-097** honours directives only when `scenariosEnabled` is true AND `ctx.environment === 'sandbox'`. It reads the `MOCK:` customer-reference source only in `local`/`test` (or for an operator-flagged test account), not for any customer in a shared environment. It adds a test that a production-environment context ignores every directive.
- **TASK-083** (per-carrier deadlines, the first fan-out consumer) and **TASK-132** (resilience) bound every adapter call by `deadlineAt`, independent of the adapter. A bulkhead permit must count a call until the adapter's promise settles, so an adapter that overruns cannot oversubscribe the carrier.

**Due / owner.** The Mock cap and the TASK-097 gating are due before TASK-097 merges. That is the first change that connects an untrusted source. The deadline enforcement is due with TASK-083/TASK-132. The routing matches C3 of the code review (m3 to TASK-097/TASK-132).

**Verification.** A unit test with `nowMs` and `sleep` recorders:

- `latency=6000` with 4,000 ms left waits 4,000 ms, rejects with `TIMEOUT`, and writes one line and one record, both with `error_code TIMEOUT`;
- `latency=1500` with 4,000 ms left waits 1,500 ms and answers OK;
- a production-environment context with `latency=6000` never sleeps (TASK-097).

### PR079-SEC-03 · INFO · The call-record bound can be switched off, and the list is a process-wide ring shared by every request

| | |
|---|---|
| CWE / OWASP | CWE-770 Allocation of Resources Without Limits · A04:2021 Insecure Design |
| Where | `mock-adapter.ts:248, 277-278, 285` |
| Twin | Code review m1 (MINOR) |

**Measured** (`p4-records`, 3,000 calls per setting):

| `maxCallRecords` | Records kept |
|---|---|
| unset, `null` | 1,000 |
| `2` | 2 |
| `0`, `-5` | 1 |
| `2.5` | 3 |
| `'7'` | 7 |
| `NaN`, `Infinity`, `'abc'` | 3,000 (unbounded) |

The records hold `operation`, `correlationId`, `accountId`, `outcome` and `durationMs` only. No sentinel was found in them (section 3).

The ring is ordered by completion, not by start. With one slow call (`latency=50`) and one fast call, the last record after awaiting the slow call is the slow one. A consumer that reads "the last record" can therefore cite another request's call.

**Remediation.**

- Validate the option and fail fast: `if (options.maxCallRecords !== undefined && (!Number.isSafeInteger(options.maxCallRecords) || options.maxCallRecords < 1)) throw new TypeError('maxCallRecords must be a positive safe integer');`.
- Document that a consumer selects records by `correlationId`, never by position.
- principal-architect decides the channel for TASK-092 (for example an injected `onCall(record)` port), as m1 routes it.

**Owner:** with m1 (TASK-092, principal-architect). It is not exploitable from outside: the option comes from code, not from a request.

### PR079-SEC-04 · INFO · The log call in `finally` can replace the call's outcome

| | |
|---|---|
| CWE / OWASP | CWE-755 Improper Handling of Exceptional Conditions · A04:2021 Insecure Design |
| Where | `mock-adapter.ts:263-279` |

**Measured** (`p4-records`). With a logger whose `info` throws:

- a successful `track` rejects with the logger's plain `Error`;
- a `schedulePickup` that ended in `CarrierError(PICKUP_UNAVAILABLE)` rejects with the logger's error instead;
- no record is written in either case.

**Impact.**

- **The guard** passes a non-`CarrierError` through unchanged. The gateway (TASK-132) treats a non-`CarrierError` after `createShipment` as ambiguous (EXCEPTION, no retry).
- **For the Mock**, this costs nothing: the Mock is stateless and nothing was booked.
- **For the real adapters,** the card says the DHL, FedEx and UPS adapters copy this wrapper. A logging failure after a booking the carrier accepted would then turn into an EXCEPTION shipment with a live label at the carrier.
- **Likelihood is low.** Pino does not throw on a normal write.

**Remediation.** In the wrapper, make the outcome independent of the log line:

- push the record first;
- write the line inside a `try`/`catch`. The catch must not be silent. It must report through a channel that cannot throw (for example `process.emitWarning('carrier.call log failed')` with no fields), and it must leave the operation's result or error unchanged.

**Owner:** TASK-135/139/140, when the wrapper is copied (a line on each card), and TASK-132. It is optional in the Mock.

### PR079-SEC-05 · INFO · Production exclusion lives in configuration and the composition root only; the Mock itself serves production-environment contexts

| | |
|---|---|
| CWE / OWASP | CWE-489 Active Debug Code · A05:2021 Security Misconfiguration |
| Where | `packages/carriers/src/index.ts:157-173`; `mock-adapter.ts:242-333` |
| Twin | Code review SF-1, n2 |

**Measured.**

- **The Mock answers a production account.** A guarded `createShipment` with a `MOCK` account whose `environment` is `production` answered OK (`p1`).
- **Nothing in this PR wires the factory:**
  - outside `packages/carriers` (docs excluded), no file references `createMockAdapter`, `MOCK_EGRESS`, `mockLabel` or `parseLatencyMs`;
  - no file under `apps/`, `packages/config`, `infra/`, `.github/` or compose changed.
- **The layers that exist today:**
  - `productionGuard` refuses `MOCK_CARRIER_ENABLED` and `MOCK_SCENARIOS_ENABLED` when `APP_ENV=production`, and both default to off outside local/test;
  - `deriveCarrierEgressRules` refuses a production account when `APP_ENV` is not production;
  - the data model flags `carriers.non_production_only = true` for MOCK.

**Remediation (TASK-097, which owns the production exclusion).**

- The Mock refuses `ctx.environment === 'production'` before it answers, with a `CarrierError` (`CAPABILITY_NOT_SUPPORTED`) and one log line.
- A repository test pins that `createMockAdapter` is referenced only by the composition-root module and by tests.
- A composition test shows that a production configuration builds a registry without `MOCK`.
- Code review n2 (a narrower barrel surface) also reduces what production bundles carry.

## 3. Checked with no finding

| Item | Evidence |
|---|---|
| AT-US-008-03, no PII in `carrier.call` | `p1`: all 11 operations through `createCarrierRegistry`, plus a contract-refused `createShipment`, a hostile `track`, a 31-number `track` and a production-environment context. Result: 1 line for each operation that entered the adapter, 0 for those refused before entry (landed cost; a 513-character scenario). Event set `{carrier.call}`. Key set exactly `account_id, carrier_code, correlation_id, duration_ms, error_code, operation, route_template, status`. `error_code` holds canonical codes only. 11 random sentinels (party name, company, address line, city, postcode, e-mail, phone, client reference, customer reference, customs description, document content) appeared in 0 lines, 0 records and 0 guard warnings. Positive control: the sentinels are present in the serialised request |
| Zero network | Traps installed before `import('@platform/carriers')` on `net.Socket.prototype.connect`, `net.connect`, `tls.connect`, `dns.*` and `dns.promises.*`, `dgram.createSocket`, `http(s).request/get`, `fetch` and the `child_process` family. Import plus every operation (including the latency path on the real timer): 0 attempts. Static check: the Mock imports only `node:crypto`, `node:buffer`, `node:perf_hooks`, `node:timers/promises`, `@platform/shared(/logging)` and in-package modules. It has no `process.env`, `Math.random`, `Date.now`, `import()` or `require`. The suite's `monitorNetwork` covers sockets and `fetch` only (DNS and UDP are outside it). For this adapter, the wider traps above close that gap |
| Egress table empty | `MOCK_EGRESS` is `defineCarrierEgress('MOCK', { sandbox: [], production: [] })`: frozen, valid and empty, so `deriveCarrierEgressRules` adds no rule for a Mock account (contract test, and read). An empty table is "no allow-list entry", not "allow all" |
| Label fixtures vs PR075-SEC-14 / D-SECPR075-03 | `p2`: 80,040 labels (20,010 tracking texts in 4 formats: a fixed hostile list, a 20,000-character text, and xorshift-fuzzed strings weighted to `( ) \ ^ ~ % < > CR LF NUL ESC NEL NBSP U+2028`, lone surrogates and PDF/ZPL keywords). Each one passed `createLabelDocument` and its own sniffer, and none sniffed as the other kind. Each label was ASCII only. PDF: valid `startxref`, xref offsets and `/Length`; 3 balanced literal strings; no backslash. ZPL: one `^XA` and one `^XZ`, no `~`, field data in `[A-Za-z0-9_ .:?-]`. Lead cases: a blank, a BOM, and a BOM plus 1,000 blanks before the fixture are accepted in every format. A PNG magic after a blank and `<html>` after a BOM are refused in every format. A stray `A` is refused for PDF and accepted for ZPL (by design: `^XA` may appear anywhere, TASK-075 ruling). The guarded `createShipment` kept `PDF_4X6` and `ZPL` with 0 drop or refusal lines. Positive control: a probe-built unbalanced `(` is detected. Note (no finding): a text containing the word `endstream` would sit inside a PDF literal string. That is harmless, because `/Length` is exact, and the adapter only ever passes `MOCK\d{12}` numbers |
| Hostile tracking text | `recoverLabel` refuses numbers that are not in the Mock format (`SERVICE_UNAVAILABLE`), so hostile text reaches a label only through a direct `mockLabel` call, where `printable` neutralises it (above). `track` returns the caller's own strings as `trackingNumber` with `found: false`, including a 100,000-character string and non-string elements: an echo, not an amplification. The API boundary validates tracking input. Events are fixed (`Mock Origin City`, `Mock Gateway City`, `Mock Destination City`, generic descriptions). `carrierEventId` uses only numbers that match `^MOCK\d{12}$`. A non-array `numbers` throws a `TypeError` (idempotent operation; no finding) |
| Code review SF-4 (tracking number derivable from the shipment id) | The number is `SHA-256('tracking' NUL clientReference)` reduced to 12 digits, and the client reference is the shipment UUID (ADR-0014 G2). Shipment ids are not public. Real carriers' numbers are not secrets either, so public tracking must never treat a number as a capability (city-level guardrail). The Mock is non-production. No finding. The `NUL` join ambiguity (code review n3) has no security effect |
| PR076-SEC-06 (exports map) | Not triggered. `packages/carriers/package.json` is unchanged, and `exports` is still `.` only. This is pinned twice: the owned boundary test and `mock.units.test.ts`. The deep-import pattern `^@platform/carriers/.+$` in `eslint.config.mjs` is unchanged, so `@platform/carriers/adapters/mock/...` stays refused. The line moves to the first task that adds a subpath (D-SECPR076-01) |
| ReDoS | Every regex the PR adds is anchored and linear: `^latency=(\d{1,5})$`, `^MOCK\d{12}$`, `^MOCKPU\d{10}$`, `^[A-Z]{2}$`, `^[A-Za-z0-9][A-Za-z0-9 -]{1,14}$`, `^\d{4}-\d{2}-\d{2}$`, and the single-class replacements in `labels.ts`. The parser is measured linear above |
| Secrets | The added lines contain no secret-shaped literal (scan of the `f9cc7ca1..7815e1c8` diff for long tokens and credential keywords: identifiers only). The labels are generated in code, and nothing binary is committed |
| Money / limits | Limits are checked before any multiplication (`assertPackages` requires positive safe integers, then `limitViolation`), so the volumetric product stays bounded. Pricing uses the Money helpers (code review §2) |

## 4. Routing

| Item | Owner | Due |
|---|---|---|
| PR079-SEC-01 | This PR's fix cycle, else TASK-097 (owned file, security round required) | Before the first `adapters/<carrier>/wire*` module merges (TASK-135) |
| PR079-SEC-02 | Mock cap and directive gating: TASK-097. Deadline enforcement and bulkhead accounting: TASK-083 / TASK-132 | Before TASK-097 merges; with TASK-083 / TASK-132 |
| PR079-SEC-03 | TASK-092 and principal-architect (with code review m1) | Before TASK-092 consumes records |
| PR079-SEC-04 | TASK-135 / 139 / 140 card lines, and TASK-132 | When the wrapper is copied |
| PR079-SEC-05 | TASK-097 (production exclusion) | With TASK-097 |

Still owed for the merge: lane B on `7815e1c8` (code review C1); lane A on the pushed head; the rename of this record on main and the merge-ref check (D-ORCH-136, D-ORCH-138). A new security round is needed only if an owned path changes after `7815e1c8`.

| Field | Value |
|---|---|
| Verdict | PASS_WITH_FOLLOW-UPS. No Critical, High or Medium finding; LOW PR079-SEC-01 and PR079-SEC-02, INFO PR079-SEC-03..05, all routed |
