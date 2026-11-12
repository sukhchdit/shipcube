# PR-0006 / TASK-009: change-scoped security review

| Field | Value |
|---|---|
| PR | #6 `docs(carriers): SPK-02 carrier API documentation capture into adapter READMEs (TASK-009)`, https://github.com/sukhchdit/shipcube/pull/6 |
| Branch / head | `feat/TASK-009-spk-02-spike-carrier-api` @ `4e5d05f`. Merge base `main` @ `84ac551`. 4 commits (`f0710e6`, `3ccab5d`, `6c8bbfe`, `4e5d05f`), 4 files, +660 / −0 |
| Scope | P5 Wave 0, batch 0.3, under the D-ORCH-004 bootstrap merge rule. Documentation only: `packages/carriers/src/adapters/{ups,dhl-express,fedex}/README.md` and `docs/04-plan/spikes/SPK-02.md`. No code, configuration, lockfile, fixture or test change |
| Security requirements in scope | CLAUDE.md §5 (sandbox-only carriers, no secrets, no restricted data); REQ-CARR-015/016/018/019/020; REQ-SEC-010 and ADR-0016 §13 (egress allow-list); ADR-0010 (ports, amendments 7–9); ADR-0017 §4 (span attributes); REQ-PLAT-012 and NFR-PRIV-001 (no PII in logs); REQ-TRACK-006; threat-model T-59, T-72, T-95, T-96, T-97, T-98, L-13 |
| Reviewer / date | security-analyst, 2026-11-12. Read-only. The PR files were read with `git show 4e5d05f:<path>`; no worktree was touched |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical or High finding. 1 MEDIUM, 5 LOW and 4 INFO, each routed to a named task or to this PR. The MEDIUM is a design gap in SPK-02 §4 item 6 (the host allow-list request). It must be settled when principal-architect decides the ADR-0010 amendment and before TASK-113 fixes the allow-list shape. **Merge is not blocked.** This verdict covers `4e5d05f` only |

## 1. Summary

**Secrets and personal data: clean.**
- The three READMEs and the spike record contain no credentials, tokens, account numbers, tracking numbers, e-mail addresses, phone numbers or IP addresses.
- Every identifier is a placeholder (`<UPS_CLIENT_ID>`, `<DHL_API_KEY>`, `<FEDEX_SECRET_KEY>`, `<TRACKING_NUMBER_1Z>`, `<SHIPPER_NUMBER>` and so on).
- Gitleaks v8.30.1 over `84ac551..4e5d05f` (4 commits, ~78 KB): **no leaks found**. My own identifier sweep (with a positive control) found only false positives: dates, URL paths, a public support-article ID and the product name "Basic Integrated Visibility".
- No restricted legacy data appears (brief §13 rule 9).

**Carrier hosts.**
- Every host is `https` and sits under the carrier's own registrable domain: `ups.com`, `fedex.com`, `dhl.com`.
- Sandbox and production are listed separately for every carrier. Both kinds of credential are to be modelled as separate carrier accounts.
- **DHL is the exception that matters.** Its sandbox and production share one host (`express.api.dhl.com`) and differ only by path (`/mydhlapi/test` against `/mydhlapi`). The ADR-0016 §13 host allow-list therefore cannot enforce the CLAUDE.md §5 rule "no production carrier endpoints before G4" for DHL. SPK-02 §4 item 6 asks for host-only entries and does not mention this (PR6-SEC-01).

**OAuth.**
- The UPS README says to read `expires_in` from every response and never hard-code a lifetime.
- The FedEx README documents token reuse, single in-flight refresh and server-side tokens.
- Both match ADR-0010 and REQ-CARR-016.
- Two new facts need design attention:
  - FedEx's token service is throttled **per public IP**, with a 10-minute `403` penalty. That makes token-failure handling a cross-account availability concern (PR6-SEC-05).
  - FedEx client secrets travel in a **form body**, not a header (PR6-SEC-07).

**PII.**
- The UPS README flags signature and proof-of-delivery images and gives a privacy note for tracking. Every fixture plan includes a signatory-redaction case.
- However, no README lists the request-side personal, tax-ID and secret fields per carrier. ADR-0010 amendment 8 and REQ-CARR-018 redact requests **by field name**, so that list is what TASK-188 and TASK-010 need (PR6-SEC-02).
- Several operations put identifiers in URLs, and DHL puts a **person's name** (`requestorName`) in a query string (PR6-SEC-03).

**Carrier push.**
- All three carriers are declared `pushTracking=false`. No carrier authenticity scheme is documented, so REQ-TRACK-006 and TASK-261 have nothing real to verify against (PR6-SEC-08).

**Positive observations.**
- `idempotent create = false` is declared for all three carriers (duplicate-label guardrail).
- UPS label recovery is preferred over re-creating a shipment.
- DHL labels are persisted at once, because they are inline-only.
- The FedEx README tells the adapter to check `errors[]` in 200 responses (T-97).
- Fixtures are planned as synthesised, labelled and PII-free.
- No dependency was added. The third-party SDKs were only read, which is consistent with ADR-0010's rejection of aggregator SDKs.

## 2. Method

- I extracted the four files from `4e5d05f` into scratch and read all of them line by line (SPK-02 88 lines, UPS 207, DHL 174, FedEx 191).
- I cross-checked them against ADR-0010 (in full, with amendments 1–10), ADR-0016 §13 and amendment 10, ADR-0017 §4, REQ-CARR-015..021, REQ-SEC-010, REQ-TRACK-006, data-model §classification (`SPER` tax and identity references, REQ-BOOK-008), threat-model §carrier rows and the SEC-TC catalogue (highest ID in use: SEC-TC-65), and the task map (TASK-010, 113, 128, 131, 132, 135, 139, 140, 188, 191, 214, 261).
- I ran Gitleaks against the PR commit range with the Docker image.
- I ran an identifier and secret-shape sweep (Node script, positive control first). It looked for digit runs of 6 or more, UPS 1Z numbers, e-mail addresses, phone shapes, base64 runs of 24 or more, JWTs, `Bearer`/`Basic` values, IPv4 addresses, hex runs of 32 or more, and `key=value` secret assignments.
- I checked every listed host for scheme, for a carrier-owned registrable domain, and for sandbox/production separation.
- **Not verifiable from the repository:** the claim that no carrier API host was contacted. Nothing in the diff could make such a call, and no credentials exist (D-003).

## 3. Findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR6-SEC-01 | DHL sandbox and production share one host, so a host-only allow-list cannot keep DHL traffic sandbox-only; SPK-02 asks for host-only entries | MEDIUM | CWE-923, CWE-183 | A04 | `SPK-02.md:67` (§4 item 6); `dhl-express/README.md:17-18`; `ups/README.md:19`; `fedex/README.md:111`; ADR-0016 §13 | principal-architect (ADR-0010/0016 amendment); TASK-113 (binding); this PR (text, optional) | Open |
| PR6-SEC-02 | No per-carrier inventory of request-side personal, tax-ID and secret fields for the field-name redactor and log redaction | LOW | CWE-359, CWE-532 | A04 | all three READMEs (no "sensitive fields" section); `ups/README.md:110`; `dhl-express/README.md:50,80`; `fedex/README.md:62` | TASK-135/139/140 (README section); TASK-188; TASK-010 | Open |
| PR6-SEC-03 | Identifiers and a personal name are placed in carrier URLs (path and query), which reach traces, logs and error text | LOW | CWE-598, CWE-532 | A09 | `dhl-express/README.md:38,74,83`; `ups/README.md:91,132`; ADR-0017 §4 | TASK-113, TASK-214, TASK-135, TASK-140 | Open |
| PR6-SEC-04 | Carrier request construction: untrusted identifiers and address text go into paths, comma lists and query strings next to `accountNumber`. Raw interpolation allows path traversal and parameter pollution | LOW | CWE-74, CWE-235 | A03 | `dhl-express/README.md:38,65-66,83`; `ups/README.md:76-77,91`; `fedex/README.md:70` | TASK-135/139/140; TASK-113 (final-URL guard) | Open |
| PR6-SEC-05 | The FedEx token service throttles per public IP with a 10-minute `403` penalty; per-account single-flight does not stop one failing account from locking every FedEx account | LOW (MEDIUM from M3) | CWE-770, CWE-400 | A04 | `fedex/README.md:25`; `SPK-02.md:44`; ADR-0010 §Ports `TokenCache`; REQ-CARR-016 | TASK-131, TASK-132, TASK-139 | Open |
| PR6-SEC-06 | Carrier responses carry URLs (`LabelURL`, FedEx `URL_ONLY`, DHL `trackingUrl`/`cancelPickupUrl`). Following or surfacing them moves destination choice to response data | LOW | CWE-918, CWE-601 | A10 | `ups/README.md:65`; `fedex/README.md:62-63,184`; `dhl-express/README.md:52` | TASK-135/139/140; TASK-113 | Open |
| PR6-SEC-07 | Token handling details: `expires_in` parsing and clamping; FedEx secrets in the form body | INFO | CWE-613, CWE-532 | A07 | `ups/README.md:23-24,196`; `fedex/README.md:21-24,182` | TASK-131, TASK-139, TASK-140 | Open |
| PR6-SEC-08 | No carrier push authenticity scheme is documented; REQ-TRACK-006 and TASK-261 would have to invent one | INFO | CWE-345 | A08 | `SPK-02.md:46`; `fedex/README.md:81` | product-manager (REQ-TRACK-006 note); TASK-261 | Open |
| PR6-SEC-09 | Evidence text conflict: SPK-02 §6 says Gitleaks was "run by CI (not run locally)", but the PR body reports a local run | INFO | n/a | n/a | `SPK-02.md:87` | this PR (text) | Open |
| PR6-SEC-10 | Sandbox hygiene: no load or performance traffic to carrier sandboxes; live-run call budget | INFO | CWE-770 | A04 | `fedex/README.md:40`; `dhl-express/README.md:28,110` | TASK-191; qa-lead (`test:load`) | Open |

### PR6-SEC-01: DHL sandbox and production share one host (MEDIUM)

**Description.**
- The DHL README gives the sandbox base `https://express.api.dhl.com/mydhlapi/test` and the production base `https://express.api.dhl.com/mydhlapi` (lines 17-18). They are the **same origin**.
- ADR-0016 §13 and REQ-SEC-010 define the egress control as a **host** allow-list per environment.
- SPK-02 §4 item 6 (line 67) asks for "host allow-list entries per environment" and lists `express.api.dhl.com` once, with no path qualifier.
- The result is that a sandbox environment allowing that host also allows every DHL **production** path. CLAUDE.md §5 forbids production carrier endpoints until G4 for a production release. For UPS and FedEx, the host allow-list is what technically enforces that rule; for DHL nothing would.

**Two related shape issues the allow-list design must absorb:**
- The UPS token endpoint is **outside** `/api` (`/security/v1/oauth/token`, `ups/README.md:19`), so a path-prefix model needs two prefixes per UPS environment.
- The FedEx ETD **sandbox** host is `documentapitest.prod.fedex.com/sandbox` (`fedex/README.md:111`). Its name contains `prod`, so any suffix or wildcard rule (`*.fedex.com`, `*.prod.fedex.com`) or any "looks like production" string heuristic gets it wrong.

**Exploitability and impact.**
- **Path 1, misconfiguration.** DHL production credentials end up on the `sandbox` carrier account, or the base path is mis-set to `/mydhlapi`. Real waybills would then be booked and billed. The egress layer would not object, because host and scheme are allowed. Impact H: real charges and a guardrail breach.
- **Path 2, path escape.** A path built from untrusted input escapes `/test` (see PR6-SEC-04). With the separate sandbox credentials, production rejects the call, but a production endpoint has still been contacted.
- Likelihood L this run: no credentials exist (D-003), and carrier secrets are confined to the `carrier-sandbox` GitHub environment (SEC-TC-51).
- H×L = **MEDIUM**.

**Remediation.**
1. **SPK-02 §4 item 6 text** (this PR, optional; otherwise principal-architect writes it into the ADR-0010/0016 amendment). Replace the host list with origin plus path-prefix entries per environment:

   | Environment | UPS | FedEx | DHL Express |
   |---|---|---|---|
   | sandbox | `https://wwwcie.ups.com` prefixes `/api/`, `/security/v1/oauth/token` | `https://apis-sandbox.fedex.com` prefix `/`; ETD (only when implemented) `https://documentapitest.prod.fedex.com` prefix `/sandbox/` | `https://express.api.dhl.com` prefix `/mydhlapi/test/` |
   | production (G4-production only) | `https://onlinetools.ups.com` same prefixes | `https://apis.fedex.com`; ETD `https://documentapi.prod.fedex.com` | `https://express.api.dhl.com` prefix `/mydhlapi/` |

   Add: "Entries are exact origins (no wildcards or suffix matching). Production entries exist only in `APP_ENV=production` configuration."

2. **TASK-113 (binding): the `OutboundHttpClient` rule shape.**
   ```ts
   export interface EgressRule {
     readonly origin: string;                 // exact, e.g. 'https://express.api.dhl.com'
     readonly pathPrefixes: readonly string[]; // e.g. ['/mydhlapi/test/']
     readonly tier: 'sandbox' | 'production' | 'gateway-test';
   }

   export function egressAllowed(target: URL, rules: readonly EgressRule[]): boolean {
     if (target.protocol !== 'https:' || target.username || target.password || target.port !== '') return false;
     // WHATWG URL already resolved '.', '..', '%2e' segments; refuse encoded separators a server could decode later
     if (/%2f|%5c|%2e/i.test(target.pathname)) return false;
     return rules.some((r) => r.origin === target.origin &&
       r.pathPrefixes.some((p) => p.endsWith('/') ? target.pathname.startsWith(p) : target.pathname === p));
   }
   ```
   Apply the same check to every redirect hop, which ADR-0016 §13 already requires.

3. **Start-up configuration check (TASK-113, with the TASK-005 config schema).** Refuse to start when `APP_ENV !== 'production'` and any carrier rule has `tier: 'production'`. For DHL also refuse when the configured sandbox base path does not start with `/mydhlapi/test/`. Report names only, never values.

4. **TASK-135.** The DHL adapter derives its base URL from `CarrierContext.environment` plus configuration. A per-account free-form base URL is not allowed.

**Verification test.** Proposed SEC-TC-66 for qa-lead (the ID is provisional), integration, using the sandbox rule set:
- **Blocked:** `GET https://express.api.dhl.com/mydhlapi/shipments/X/tracking`; `…/mydhlapi/test/../shipments/X/tracking` (built with string concatenation, then `new URL`); `…/mydhlapi/test/%2e%2e/shipments`; `…/mydhlapi/testX/rates`; `…/mydhlapi/test/..%2Fshipments`; `https://wwwcie.ups.com/security/v1/other`. Each returns `SSRF_BLOCKED` and emits the `ssrf_blocked` event.
- **Positive controls (allowed):** `…/mydhlapi/test/rates` and `https://wwwcie.ups.com/security/v1/oauth/token`.
- **Config test:** a `local` or `test` environment containing any production-tier carrier rule refuses to start.

### PR6-SEC-02: no per-carrier sensitive-field inventory (LOW)

**Description.**
- REQ-CARR-018 and ADR-0010 amendment 8 redact **requests** by field name. Responses and tracking use an allow-list, which is safer.
- Field names differ per carrier and partly by case, so a generic deny-list (`name`, `phone`, `email`, `address`) misses them:
  - UPS PascalCase: `AttentionName`, `Phone.Number`, `EMailAddress`, `AddressLine`, `TaxIdentificationNumber`, `ShipperNumber`;
  - DHL: `contactInformation.fullName`, `postalAddress.addressLine1..3`, `registrationNumbers[]`, `requestorName`, `remark`;
  - FedEx: `contact.personName`, `address.streetLines[]`, `shipper.tins[]`, `accountNumber.value`, and the form fields `client_secret` and `child_secret`.
- The READMEs mention some of these in passing (`ups/README.md:110` `PickupAddress.ContactName`/`Phone`; `fedex/README.md:62` `shipper.tins[]`; `dhl-express/README.md:50,80` `customerDetails…contactInformation`). None of them carries a list the redactor and the tests can consume.
- **Tax and identity references** (`IN_PAN`, `IN_GSTIN`, `IN_IEC`; data-model `SPER`, REQ-BOOK-008 "never in logs") reach carriers through exactly these fields.
- A related data-minimisation gap: the READMEs list options that fetch signature or POD data. These are UPS `returnSignature` and `returnPOD` (`ups/README.md:93`, default `false`), DHL `epod-detail-esig` and `all-checkpoints-with-remarks` (`dhl-express/README.md:65,68`) and FedEx SPOD documents (`fedex/README.md:76`). No M1 story needs any of them.

**Exploitability and impact.** A missed field puts personal or `SPER` data into the `raw-carrier-payloads` bucket, and into logs if any body is logged. That breaches the zero-PII-in-logs guardrail (T-95). Impact M, likelihood L to M, because amendment 8's response allow-list already covers the response side. **LOW**.

**Remediation.**
1. **TASK-135/139/140 (binding).** Each adapter README gains a `## Sensitive fields` table: JSON path or form field or header, class (`PER`, `SPER`, `SECRET`, `ACCOUNT_ID`), and handling (`redact`, `never send`, `blob`). Start with the paths above, and mark DHL and FedEx paths "unverified" until the person-diff of SPK-02 §4 item 4 has been done.
2. **TASK-188 (binding).** The request redactor's deny-list is **per carrier**, loaded from one typed module per adapter (for example `packages/carriers/src/adapters/<code>/sensitive-fields.ts`). Do not rely on one generic list. Matching is case-insensitive on the leaf key, plus exact paths for the ambiguous `Name`/`name` leaves.
3. **TASK-010 and TASK-113 (binding).** Pino never logs carrier request or response bodies at any level. The only stored copy is the TASK-188 redacted payload. Outbound log lines carry carrier code, account ID, operation, status, duration, error code and correlation ID only. This removes the dependency on deny-list completeness for logs.
4. **TASK-135/139/140 (binding), data minimisation.** Keep UPS `returnSignature=false` and `returnPOD=false`. Do not call DHL `proof-of-delivery`. Use DHL `trackingView=all-checkpoints` (not `…-with-remarks`, not `shipment-details-only`). Do not request FedEx SPOD documents. Enabling any of them needs a story and an ADR-0019 document path.

**Verification test.** Extend SEC-TC-52 (raw-payload part) and AC-45 (sentinel test):
- For each carrier, the synthesised create, pickup and cancel request fixtures carry a distinct sentinel in **every** path of the README `Sensitive fields` table, including an `IN_PAN` sentinel and the DHL `requestorName`.
- After the call against `nock`, no sentinel appears in the stored raw-payload JSON, the captured Pino output, an error message or HTTP response, or the in-memory OTel exporter.
- A completeness test fails when a `Sensitive fields` path has no sentinel in the fixtures.

### PR6-SEC-03: identifiers and personal data in carrier URLs (LOW)

**Description.** Some operations place identifiers or personal data in the URL itself:
- **DHL**
  - `GET /rates?accountNumber=…&originCityName=…&destinationPostalCode=…` (line 38);
  - `GET /shipments/{n}/get-image?shipperAccountNumber=…` (line 74);
  - `DELETE /pickups/{n}?requestorName=…&reason=…` (line 83). `requestorName` is required and naturally a person's name.
- **UPS**
  - tracking numbers in the path (line 91);
  - `DELETE /paperlessdocuments/{version}/DocumentId/ShipperNumber`, with the account number in the path (line 132).

These URLs reach three places:
- OpenTelemetry undici client spans, as `url.full`, `url.path` and `url.query`. ADR-0017 §4 promises an attribute allow-list but does not name these keys.
- undici and fetch error messages and `cause` chains.
- Any outbound request log line.

**Exploitability and impact.** The exposure is internal: logs and traces with limited access. Account numbers are billing identifiers. A requester name is personal data, and its presence breaches NFR-PRIV-001. L×M = **LOW**.

**Remediation.**
1. **TASK-113.** `OutboundHttpClient` records `server.address`, the HTTP method and a **route template** (`DELETE /mydhlapi/test/pickups/{id}`) supplied by the adapter. It never records the full URL or the query. Error mapping drops `cause.message` text that contains the URL.
2. **TASK-214, ADR-0017 §4 allow-list.** Exclude `url.full`, `url.path` and `url.query` (and `http.url`, `http.target` from older semantic conventions) from client spans. Alternatively, disable undici auto-instrumentation for the carrier dispatcher and create manual spans with `url.template`.
3. **TASK-135.** `requestorName` is a fixed, non-personal configuration value: the operator brand from `BRAND_*`, or an operations role name. It is never the user's or the shipper's name. `reason` comes from a fixed enum.

**Verification test.** Included in the SEC-TC-52/AC-45 extension above: the in-memory span exporter and the log capture contain neither the `requestorName` sentinel nor the account-number sentinel, and the recorded route equals the template.

### PR6-SEC-04: request construction, path traversal and parameter pollution (LOW)

**Description.** Tracking numbers come from untrusted input (public tracking, user lookups). City names and postcodes come from quote input. Both go into carrier URLs:
- **Paths:** DHL `/shipments/{n}/tracking`, `/pickups/{n}`; UPS `/track/v1/details/{inquiryNumber}`, `/void/cancel/{id}`.
- **Comma lists:** DHL `GET /tracking?shipmentTrackingNumber=<comma list>`.
- **JSON-array-style query values:** UPS void `trackingnumber=["…"]`.
- **Queries next to `accountNumber`:** DHL `GET /rates`.

Raw string interpolation enables three attacks:
- a dot-segment escape (`../`) out of the base path, which reaches production for DHL (PR6-SEC-01) or another endpoint under the same credentials;
- an injected `&accountNumber=` (HTTP parameter pollution);
- extra waybills in a comma list.

**Exploitability and impact.** The Joi tracking-number format at the API boundary is the first defence. The adapter's schema validation of responses (T-97) stops a redirected call's response from reaching the user, and EC-A48 keeps provider text out of errors. Impact L, likelihood M if an adapter concatenates strings. **LOW**.

**Remediation (TASK-135/139/140, binding; one shared helper in `packages/carriers`).**
```ts
const CARRIER_ID = /^[A-Za-z0-9]{1,35}$/; // tighten per carrier, e.g. UPS shipment id /^1Z[0-9A-Z]{16}$/

/** Tagged template: every interpolated value must be a plain carrier identifier; validated before any I/O. */
export function carrierPath(strings: TemplateStringsArray, ...ids: string[]): string {
  return strings.reduce((acc, part, i) => {
    const id = ids[i - 1] as string;
    if (!CARRIER_ID.test(id)) throw new CarrierInputError('INVALID_CARRIER_IDENTIFIER'); // no network I/O
    return acc + encodeURIComponent(id) + part;
  });
}

export function carrierUrl(base: URL, path: string, query: Record<string, string> = {}): URL {
  const prefix = base.pathname.endsWith('/') ? base.pathname : `${base.pathname}/`;
  const url = new URL(prefix + path.replace(/^\//, ''), base.origin);
  for (const [k, v] of Object.entries(query)) url.searchParams.set(k, v); // never string-concatenate queries
  if (url.origin !== base.origin || !url.pathname.startsWith(prefix)) throw new CarrierInputError('URL_ESCAPE');
  return url;
}
// usage: carrierUrl(dhlBase, carrierPath`/shipments/${waybill}/tracking`, { trackingView: 'all-checkpoints' })
```
- **Batch tracking:** validate each element, join validated elements only, and map the response **by tracking number**. Drop tracking numbers that were not requested.
- **Headers:** values such as `transId` and `Message-Reference` come from server-generated or ADR-0016 §15-validated values only.

**Verification test.** Proposed SEC-TC-67 (provisional), a unit property test with fast-check:
- Arbitrary strings, including `..`, `../..`, `%2e%2e`, `/`, `,`, `&`, `?`, `#`, CR/LF and Unicode, used as a tracking number, dispatch number, city or postcode.
- Each input is either rejected with `CarrierInputError` and **zero** `nock` requests, or produces a URL whose origin and prefix equal the base, with exactly the expected segment count and exactly one `accountNumber` parameter.
- Batch: an input containing `,` is rejected. A response containing an unrequested number is not returned.

### PR6-SEC-05: FedEx per-IP token throttle and penalty (LOW, MEDIUM from M3)

**Description.**
- The FedEx token service limits each **public IP** to a burst of 3 requests per second over 5 s and an average of 1 per second over 2 min. A violation gives a **10-minute `403` penalty** on every request, and repeated violations extend it (`fedex/README.md:25`, F4).
- ADR-0010 and REQ-CARR-016 give single in-flight refresh **per account**, plus "401 → drop and one retry". They say nothing about **failed** token fetches.
- With wrong or rotated credentials, every call (up to the bulkhead width, and until the breaker opens) issues a new token request.
- All API and worker replicas share the egress IP (NAT), so one failing account can put **every** FedEx account, and every tenant using FedEx, into the penalty.
- A token-endpoint `403` must also not be read as "token expired, refresh".
- UPS documents `429 Quota Limit Exceeded` on its token endpoint (`ups/README.md:27`) with the same pattern.

**Exploitability and impact.** Today there is one platform-owned FedEx account, so the blast radius is FedEx availability for everyone for 10 minutes or more. Impact M, likelihood L, giving **LOW**. From M3, partner-owned accounts (ADR-0011) let one tenant's bad credentials deny FedEx to all tenants: likelihood M, giving MEDIUM.

**Remediation (TASK-131 and TASK-132, binding; TASK-139 implements the carrier part).**
1. **Negative cache.** A token fetch failing with 400/401 (`invalid_client`) sets `carrier:tokenfail:<account_id>` (TTL from configuration, default 60 s). While it is set, the adapter fails fast with `CARRIER_UNAVAILABLE` and makes no token request. Token failures count toward the account breaker.
2. **Global token-request budget per carrier and egress.** A Redis token bucket shared across replicas: FedEx at most 1 per second with a burst of 3, below the documented limit; UPS by configuration. The key is not per account.
3. **Penalty handling.** A `403` from the FedEx token endpoint sets a carrier-wide cool-down of 10 min (configuration) for **all** FedEx accounts on that egress. There are no retries during it, and a security or operations event is raised. Never "drop token and retry" on a token-endpoint `403`.
4. REQ-CARR-016 gains the failure-path sentence. product-manager words it; principal-architect amends ADR-0010 §Ports.

**Verification test.** Proposed SEC-TC-68 (provisional), integration with `nock` and the fake clock:
- The token endpoint returns `401` for account A. 200 concurrent `getRates` across accounts A, B and C over 10 s give at most 13 token requests in total, and account B's cached token keeps working.
- The token endpoint returns `403` once. During the cool-down, 0 further token requests are made and all FedEx accounts fail fast. After the cool-down, exactly one probe is made.

### PR6-SEC-06: URLs supplied by carrier responses (LOW)

**Description.** Responses contain:
- UPS `ShipmentResults.LabelURL` (`ups/README.md:65`);
- FedEx `labelResponseOptions=URL_ONLY` with `packageDocuments[].url` (`fedex/README.md:62-63`, fixtures `ship-pdf-label-url-only` and `ship-label-url-expiry` on line 184);
- DHL `trackingUrl` and `cancelPickupUrl` (`dhl-express/README.md:52`).

If an adapter dereferences these URLs, response data chooses the request target (T-96 and AC-28 name a malicious upstream as the threat). The label host may not be on the allow-list, which invites a broad entry. If these URLs reach the browser, they become carrier-controlled links (open redirect or phishing). Label URLs can be unauthenticated bearer links to documents that contain names and addresses.

**Exploitability and impact.** The `OutboundHttpClient` allow-list still applies, so impact stays L unless someone widens it. Likelihood L to M, because the fixture plan already anticipates URL mode. **LOW**.

**Remediation (TASK-135/139/140, binding).**
- Request **inline** labels: FedEx `labelResponseOptions=LABEL`, UPS `GraphicImage`, DHL inline `documents[].content`. Never follow a carrier-supplied URL.
- If a carrier offers URL mode only, add its exact label origin through an ADR amendment, fetch through `OutboundHttpClient`, persist the bytes to the `documents` bucket at once with magic-byte and size checks (T-59), and discard the URL.
- Customer-facing tracking links come from a configured template per carrier (`https://…?tracking-id={n}`, validated ID), never from `trackingUrl`.
- `cancelPickupUrl` is never called. Cancel goes through the configured base plus `carrierPath`.
- The canonical output carries no carrier URL. Raw-payload redaction drops it, as amendment 8(b) already implies; state this explicitly in TASK-188.

**Verification test.** Contract negative (extends SEC-TC-25): a fixture whose `LabelURL`, `url` or `trackingUrl` points to `https://169.254.169.254/` or to an off-list host causes **zero** outbound requests to it, and the canonical result and the API response contain no carrier URL.

### PR6-SEC-07: token handling details (INFO)

1. **`expires_in` parsing.** UPS returns it as a **string** (`ups/README.md:23`). TASK-131 parses it strictly (`/^\d{1,6}$/`) and computes `ttl = expires_in − 60`:
   - if `ttl ≤ 0`, or the value is missing or non-numeric: use the token once, do not cache it, and log a warning without the value;
   - cap the TTL at `CARRIER_TOKEN_MAX_TTL_S` (configuration, for example 4 h);
   - never write a Redis key without a TTL.

   Add fixtures `token-expires-in-missing`, `token-expires-in-non-numeric` and `token-expires-in-below-skew` to the UPS and FedEx fixture plans (`ups/README.md:196`, `fedex/README.md:182`). The FedEx README states 3600 as "confirmed" (line 22). Add the UPS README's sentence that the value is read per response and never hard-coded, which SPK-02 §4 item 5 already requires.
2. **FedEx secrets travel in the form body** (`client_secret`, plus `child_key` and `child_secret` for CSP grants, line 21), not in a header. JSON-path redaction does not cover a URL-encoded body. Token requests and responses are therefore excluded from **all** body logging and raw-payload capture (TASK-131 and TASK-113). The AC-45 sentinel test (US-128) adds sentinels in `client_secret` and `child_secret` and in the UPS and DHL `Authorization: Basic` header.

### PR6-SEC-08: no carrier push authenticity scheme (INFO)

- All three adapters declare `pushTracking=false` (`SPK-02.md:46`).
- No source read documents a signature or shared-secret scheme. UPS `UPSTrackAlert` exists but was not read.
- REQ-TRACK-006 (Should) and TASK-261 (US-252) require "a signature- or shared-secret-verified endpoint per carrier".

**Binding for TASK-261:**
- Register `POST /webhooks/carriers/{code}` only for carriers whose `capabilities().pushTracking` is `true`. Today that is none of the real carriers, so the route answers 404 or 401 for DHL, FedEx and UPS. Do not invent a scheme.
- Before enabling any carrier, an ADR-0010 amendment must document its authenticity mechanism: HMAC or shared secret compared in constant time, a timestamp/replay window, a body-size cap and the secret's `secretRef`. ADR-0010 amendment 9 (push events are hints confirmed by `track()`) still applies.

**Note for product-manager:** REQ-TRACK-006 is provable only with Mock-signed fixtures in this run.

### PR6-SEC-09: evidence text conflict (INFO)

- `SPK-02.md:87` says "Gitleaks run is by CI (not run locally)". The PR body reports a local `gitleaks` v8.30.1 Docker run with no leaks.
- My independent run agrees with the PR body: v8.30.1, `84ac551..4e5d05f`, 4 commits, no leaks.
- Fix the SPK-02 line so the record matches the evidence. Text only.

### PR6-SEC-10: sandbox hygiene (INFO)

- FedEx forbids performance tests against the sandbox (`fedex/README.md:40`).
- The DHL sandbox allows 500 calls per day per credential set (`dhl-express/README.md:28,110`). An account suspension would be a denial of service against our own integration.

**Binding:**
- `test:load` (k6) targets the Mock carrier only, and its configuration test asserts that no carrier host appears in the k6 scripts or environment.
- The TASK-191 live run (`CARRIER_LIVE_SANDBOX=1`) has a documented per-run call budget (one or two calls per operation) and runs single-threaded.

## 4. Results by focus area

| Focus (dispatch) | Result |
|---|---|
| No secrets, account numbers or real credentials | **Met.** Placeholders only; Gitleaks clean (independent run); sweep clean |
| Host allow-list entries; sandbox and production separated; production only after G4 | **Partly met.** All hosts are `https` and carrier-owned, and UPS and FedEx are cleanly separated. **DHL shares one origin**, which needs path-prefix rules and a production-tier start-up refusal (PR6-SEC-01, MEDIUM) |
| OAuth client credentials: token caching, no hard-coded lifetimes, no tokens in logs | **Met at documentation level** (UPS explicit; FedEx consistent with ADR-0010). Additions: failure-path throttling (PR6-SEC-05), `expires_in` clamping and form-body secrets (PR6-SEC-07) |
| PII fields in shipment and customs payloads flagged for redaction (TASK-010) | **Partly met.** Tracking-side PII is flagged (signatures, POD, signatory fixtures). There is no request-side inventory per carrier, including `SPER` tax IDs (PR6-SEC-02), and identifiers and a name appear in URLs (PR6-SEC-03) |
| Webhook and tracking push authenticity | **Not applicable yet.** All carriers `pushTracking=false`; binding for TASK-261 (PR6-SEC-08) |
| New SEC-TC and binding notes | Proposed SEC-TC-66, 67 and 68 (provisional IDs), plus extensions of SEC-TC-25, SEC-TC-52 and AC-45; binding notes in §5 |

## 5. Binding notes for downstream tasks

| Task | Binding note | From |
|---|---|---|
| principal-architect (ADR-0010 / ADR-0016 amendment from SPK-02 §4) | Egress rules are exact origin plus path prefix per environment. DHL sandbox is `/mydhlapi/test/` only. Production-tier rules exist only with `APP_ENV=production`. UPS token path is outside `/api`. The FedEx ETD sandbox host is named `*.prod.*`. Add the token-failure path to §Ports `TokenCache` | 01, 05 |
| TASK-113 (`OutboundHttpClient`) | `EgressRule {origin, pathPrefixes, tier}`; refuse encoded separators in the path; production-tier start-up refusal; route template instead of full URL in logs, spans and errors; never log bodies; token calls excluded from body capture | 01, 03, 04, 07 |
| TASK-010 (Pino) | Carrier request and response bodies never logged. Redaction keys include `authorization`, `client_secret`, `child_secret`, `access_token`. Rely on "never log bodies" rather than on deny-list completeness | 02, 07 |
| TASK-131 / TASK-132 (token cache, resilience) | Negative cache for token failures; global per-carrier, per-egress token bucket; FedEx token `403` means a carrier-wide cool-down with no retry; token failures count toward the breaker; strict `expires_in` parsing, TTL clamp, never a key without TTL | 05, 07 |
| TASK-135 / 139 / 140 (adapters) | `Sensitive fields` README section; `carrierPath`/`carrierUrl` helper with no string concatenation; batch responses mapped by number; inline labels only, never follow carrier URLs; constant `requestorName`; data minimisation (no POD, signature or remarks views); add the three `expires_in` fixtures | 02, 03, 04, 06, 07 |
| TASK-188 (raw payload retention) | Per-carrier request deny-list from the adapter's `sensitive-fields` module; carrier URLs dropped; completeness test against the README table | 02, 06 |
| TASK-214 (observability) | ADR-0017 attribute allow-list excludes `url.full`, `url.path`, `url.query`, `http.url`, `http.target` on client spans; carrier spans use `url.template` | 03 |
| TASK-261 (carrier push) | Route only for `pushTracking=true` carriers (none today); no invented scheme; ADR amendment required before enabling any carrier | 08 |
| TASK-191 / qa-lead | Live-run call budget; k6 never targets carrier hosts; SEC-TC-66/67/68 proposals and the SEC-TC-25, SEC-TC-52 and AC-45 extensions | 01, 02, 04, 05, 10 |
| this PR (optional text fixes) | SPK-02 §4 item 6 (path-prefix wording, table in PR6-SEC-01) and SPK-02 §6 Gitleaks line | 01, 09 |

**Non-security note for code-reviewer.** `ups/README.md:26` hard-codes `transactionSrc = shipqube`. The brand is `BRAND_*` configuration, so source it from configuration.

## 6. Evidence

| Command | Result |
|---|---|
| `gh pr view 6`; `gh pr diff 6 --name-only` | OPEN, +660/−0, 4 Markdown files |
| `git fetch origin pull/6/head:refs/remotes/pr/6`; `git rev-parse` | `4e5d05fdee3a702582f8c79f0bc10742b53451f7`; merge base `84ac5517b7965d9aee9ea70332611fcf9e54b488` |
| `docker run --rm -v <repo>:/repo:ro zricethezav/gitleaks:latest git /repo --log-opts=84ac551..4e5d05f --redact` | v8.30.1; 4 commits scanned, ~78.15 KB, **no leaks found** |
| `node sweep.mjs <scratch>/files` (identifier and secret-shape regexes, positive control first) | Control: 8 hits (all patterns live). PR files: only dates, URL paths, a public support-article ID (`000097963`), "Basic Integrated" (product name) and prose `password = client secret`. **0 true positives** |
| Manual read of all 660 lines against ADR-0010, ADR-0016, ADR-0017, REQ-CARR-015..021, REQ-SEC-010, REQ-TRACK-006, data-model classification and the threat model | Findings above |
