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

## Round 2 (head f0387d4)

| Field | Value |
|---|---|
| Head | `f0387d4` (equals `refs/pull/6/head`, checked with `git ls-remote`). Delta from round 1 (`4e5d05f`): two PR commits, `5a9a2a5` (fix cycle 1) and `f0387d4` (pointers to ADR-0010 am. 11), plus two merges of `main` (`d3238ad`, `eb3989c`). `git diff --stat origin/main...f0387d4` still shows only the same 4 Markdown files. The fix-cycle delta on them is +194 / −93 |
| Scope | Egress rule table (SPK-02 §4 item 6), the "Personal data and secrets" inventories (UPS §3.11, FedEx §3.10, DHL §3.11), FedEx token-failure notes, carrier-returned URL rules, source pins. Consistency with ADR-0010 amendment 11 (D-ARCH-057, revised by D-ARCH-062) and `rulings/wave-0-batch-3-rulings.md` item 1 |
| Reviewer / date | security-analyst, 2026-11-12. Read-only. The files were read with `git show f0387d4:<path>`; no worktree was touched |
| **Verdict** | **PASS_WITH_FOLLOW-UPS.** No Critical, High or Medium finding is open against this PR. PR6-SEC-01 (MEDIUM) is **closed at design level**: SPK-02 §4 item 6 and ADR-0010 am. 11 item 6 now specify exact origin + path prefix + tier. PR6-SEC-07 and PR6-SEC-09 are closed, and the other round-1 items are documented and stay with their downstream tasks. One new LOW (MEDIUM from M3), PR6-SEC-11, is raised against ADR-0010 am. 11 item 5(c), REQ-CARR-016 and TASK-131, not against these files. PR6-SEC-12 (INFO) lists wording differences, where the ADR governs. **Merge is not blocked.** This verdict covers `f0387d4` only |

### R2.1 Status of round-1 findings

| ID | Sev | Round-2 status | Evidence at `f0387d4` | Remaining owner |
|---|---|---|---|---|
| PR6-SEC-01 | MEDIUM | **Closed (design)** | SPK-02 §4 item 6 table (10 rows):<br>- Exact origins: DHL sandbox `/mydhlapi/test/`, production `/mydhlapi/`. UPS `/api/` plus the exact path `/security/v1/oauth/token`. FedEx `/`. FedEx ETD rows apply only once the operation is implemented and the hosts are verified on an official page.<br>- No wildcard, suffix or "looks like production" matching, with the ETD sandbox `prod` host as the reason.<br>- Redirect hops are checked.<br>- Production-tier rules are refused unless `APP_ENV=production`.<br>- A test proves a sandbox account never emits a production URL.<br>Same substance as ADR am. 11 item 6. The differences (R2.3) do not weaken the control | TASK-113 (rule shape, refusal of encoded separators); TASK-135/139/140 (per-adapter `EGRESS` and tests); `packages/config` (refuses a production account outside `APP_ENV=production`); SEC-TC-66 (provisional) |
| PR6-SEC-02 | LOW | **README part done; open downstream** | All three README subsections exist. They cover secrets, account IDs, `SPER` tax IDs, URL-placed data and data-minimisation flags. Residual field gaps are in R2.4 | TASK-135/139/140 (`sensitive-fields` modules); TASK-188 |
| PR6-SEC-03 | LOW | Documented; open downstream | Each README lists the identifiers and personal data in paths and queries. DHL `requestorName` is a fixed value derived from `BRAND_*`, `reason` comes from a fixed enum, and the fixture is `pickup-cancel-requestorname-not-personal`. Wording difference with ADR item 8: R2.3 (c) | TASK-113, TASK-214, TASK-135 |
| PR6-SEC-04 | LOW | Adopted in ADR am. 11 item 8; open downstream | See R2.3 (d): `encodeURIComponent` alone does not neutralise `.` or `..` | TASK-135/139/140; SEC-TC-67 |
| PR6-SEC-05 | LOW (MEDIUM from M3) | Documented; open downstream | FedEx README §1 is correct for FedEx and matches ADR item 5(a) and 5(c):<br>- The limit is per IP and shared by all accounts and replicas.<br>- A token `403` triggers a carrier-wide cool-down, opens the breaker, fails fast with `CARRIER_UNAVAILABLE` and raises an operations event. It is never retried and never treated as a 401-style refresh.<br>- 400/401 responses are negative-cached per account and count toward the breaker.<br>- Fixtures: `token-401-bad-credentials-negative-cache`, `token-403-ip-penalty-opens-breaker`.<br>The global token bucket is not restated (R2.3 (e)). The generic 403 rule has a UPS side effect: PR6-SEC-11 | TASK-131, TASK-132, TASK-139; SEC-TC-68 |
| PR6-SEC-06 | LOW | Documented; open downstream | SPK-02 §4 item 6 and all three READMEs say carrier-returned URLs are never followed and never surfaced, and name the inline sources.<br>- UPS: `LabelLinksIndicator` must not be set. The pinned spec confirms that `LabelURL` comes back only with it (`Shipping.yaml` L4992 @ `fd57ca9`).<br>- FedEx: `ship-pdf-label-url-only` and `ship-label-url-expiry` are withdrawn.<br>- Negative fixtures with `https://169.254.169.254/` exist for all three carriers. Matches ADR item 6 | TASK-135/139/140; TASK-113 |
| PR6-SEC-07 | INFO | **Closed (docs)** | `expires_in` is read per response, parsed strictly as an integer, reduced by 60 s and capped by configuration. It is uncacheable when missing, non-numeric or `≤ 60`; fixtures added for UPS and FedEx.<br>FedEx secrets travel in the form body. Token requests and responses are excluded from body logging and raw capture, with fixture `token-request-body-not-logged`.<br>The README's strict parse is stricter than the ADR's `Number(expires_in)`; implement the strict form | TASK-131 (implementation) |
| PR6-SEC-08 | INFO | Unchanged; open | No change expected in this PR | TASK-261; product-manager (REQ-TRACK-006 note, D-ARCH-062 flag) |
| PR6-SEC-09 | INFO | **Closed** | SPK-02 §6 now says "Gitleaks v8.30.1 run locally on the branch: no leaks; CI lane will re-run". This matches R2.5 | n/a |
| PR6-SEC-10 | INFO | Unchanged; open | n/a | TASK-191; qa-lead |

Round-1 non-security note (`transactionSrc` hard-coded): **resolved**. `transactionSrc` is now derived from `BRAND_*`. `transId` is the correlation UUID with its hyphens removed (32 hex digits), not a truncation.

### R2.2 New findings

| ID | Title | Severity | CWE | OWASP 2021 | Location | Owner (task) | Status |
|---|---|---|---|---|---|---|---|
| PR6-SEC-11 | A token-endpoint `403` triggers a carrier-wide cool-down for **every** carrier, but a UPS token-endpoint `403` means "Blocked Merchant", which is one account | LOW (MEDIUM from M3) | CWE-653 | A04 | ADR-0010 am. 11 item 5(c); REQ-CARR-016; `docs/04-plan/tasks/WAVE-04.md:316` (TASK-131); `ups/README.md:28,35,224` | principal-architect (ADR wording); product-manager (REQ-CARR-016); TASK-131, TASK-132, TASK-140 | Open |
| PR6-SEC-12 | Wording differences between SPK-02 §4 and the READMEs on one side and ADR-0010 am. 11 on the other (the ADR governs; none weakens a control) | INFO | n/a | n/a | R2.3 | TASK-113, TASK-131, TASK-214; principal-architect (optional) | Open |

#### PR6-SEC-11: carrier-wide `403` cool-down applied to UPS (LOW, MEDIUM from M3)

**Description.**
- ADR am. 11 item 5(c), REQ-CARR-016 and the TASK-131 plan line all say the same thing: "a token-endpoint 403 sets a carrier-wide cool-down (`CARRIER_TOKEN_PENALTY_COOLDOWN_S = 600`) for all accounts of that carrier, no retries".
- The reason given is FedEx's **per-IP** penalty.
- The rule is not scoped to FedEx. A UPS token-endpoint `403` is "Blocked Merchant" (`OAuthClientCredentials.yaml`; `ups/README.md:28`). The README itself says on line 35: "account blocked or not enabled for the product, not a missing token". That status is per account.

**Exploitability and impact.**
- Under the current rule, one blocked UPS account stops token requests for **all** UPS accounts for 600 s.
- If the post-cool-down probe uses the same account, it gets `403` again and restarts the cool-down. UPS then stays unavailable for every tenant for as long as the blocked account is enabled.
- M1 has platform-owned accounts only, one UPS account per environment, so "carrier-wide" equals "account-wide" and there is no amplification yet. Impact M (one carrier is lost for all users; the other carriers still quote) × likelihood L = **LOW**.
- From M3, partner-owned accounts (ADR-0011) let one tenant's blocked account deny UPS to all tenants. Likelihood M, giving **MEDIUM**. This is the same profile as PR6-SEC-05.

**Remediation.**
1. **principal-architect, ADR am. 11 item 5(c); product-manager, REQ-CARR-016; TASK-131 and TASK-132.** Choose the cool-down scope by a static policy per adapter, not by the status code alone:
   ```ts
   // packages/carriers: static per-adapter declaration, next to EGRESS
   export interface TokenEndpointPolicy {
     /** FedEx: the token service penalises the shared public IP. UPS: 403 = Blocked Merchant (one account). */
     readonly on403: 'carrier-cooldown' | 'account-negative-cache';
   }
   // FedEx { on403: 'carrier-cooldown' } · UPS { on403: 'account-negative-cache' } · DHL: no token endpoint
   ```
   - For UPS, a `403` sets the per-account negative cache with a longer TTL (for example a new key `CARRIER_TOKEN_BLOCKED_TTL_S`, default 600), opens that account's breaker and raises an operations event. Other UPS accounts are unaffected.
   - FedEx keeps the carrier-wide cool-down.
2. **M3 re-check.** At COND-SANDBOX-DEMO, record the body code FedEx returns for the IP penalty. A non-penalty `403` on a partner-owned FedEx account can then be classified per account.
3. **This PR (optional, text only).** The UPS fixture `token-403-blocked-merchant` gains the note "per-account negative cache; other UPS accounts keep working; no carrier-wide cool-down".

**Verification test.** Extend SEC-TC-68 (provisional):
- The UPS token endpoint returns `403` for account A.
- Accounts B and C still obtain tokens and rates inside the 600 s window.
- A fails fast, and no carrier-wide cool-down key is written.
- The FedEx case is unchanged.

### R2.3 PR6-SEC-12: consistency with ADR-0010 am. 11 (INFO; the ADR governs)

SPK-02 §4 now states that am. 11 decides every request and that §4 is kept as the request record. The differences below therefore do not change what gets built. Each is either stricter than the ADR or neutral.

- **(a) Where rules come from.**
  - SPK-02 says production rules "exist only in production configuration". It adds a start-up check that the DHL sandbox base path starts with `/mydhlapi/test/`. The DHL README says "configured base URL".
  - ADR item 6 is stricter. Rules are static `EGRESS` per adapter, derived from the enabled accounts. No environment variable can add a rule, and URLs are built from `EGRESS[ctx.environment]`.
  - Read "configured" as "from the adapter's `EGRESS`". The DHL base-path check becomes a unit test on the static `EGRESS`.
- **(b) Binding rules to the calling tier.**
  - SPK-02 says rules are "bound to `CarrierContext.environment`". The ADR builds a union over the enabled accounts.
  - The two are equivalent in every non-production environment, because no production rule can exist there.
  - The difference shows in an `APP_ENV=production` deployment with both a DHL sandbox and a DHL production account. There the union accepts both prefixes on the shared origin, whichever account makes the call.
  - **Hardening for TASK-113, due before any G4 production release:** also require `rule.tier === ctx.environment`. The rule already carries `tier`.
  - The SPK-02 production DHL row says "excluding `/mydhlapi/test/`". The `pathPrefixes` shape cannot express that. The ADR's per-adapter test, which checks that a production context never emits a sandbox-prefixed URL, covers it.
- **(c) URLs in logs and spans.**
  - SPK-02 §4 item 8 and the READMEs require a **route template** and never the full URL. ADR item 8 says `url.full` **with the query string stripped**.
  - Under the ADR form, paths still carry INT identifiers: tracking numbers, dispatch numbers, UPS `DocumentId` and `ShipperNumber`. UPS reference tracking also puts `referenceNumber` in the path, which is customer free text.
  - A route template satisfies both texts, so the round-1 binding note for TASK-113 and TASK-214 stands. If the ADR form is implemented instead, UPS reference tracking must not be used with user-entered references.
- **(d) Path construction.**
  - ADR item 8 relies on "`encodeURIComponent` on a fixed template". That function leaves `.` and `..` unchanged, because they are unreserved characters.
  - Example: a tracking number `..` in `/shipments/${n}/tracking` normalises to `/mydhlapi/test/tracking`. That is still inside the prefix, so egress allows it, but it calls a different operation.
  - Keep the round-1 per-carrier identifier allow-pattern (the PR6-SEC-04 `carrierPath`). SEC-TC-67 already includes `..`.
- **(e) Global token bucket.** The ADR's global token bucket per carrier and egress (item 5(b)) is not restated in the FedEx README or SPK-02 item 5. TASK-131 implements it from the ADR and REQ-CARR-016.
- **(f) UPS token path.** SPK-02 says "(exact path)", while the ADR lists the path among "prefixes". Implement an exact match: in the round-1 `egressAllowed`, a prefix without a trailing `/` matches exactly.
- **(g) Error code.**
  - REQ-CARR-016 has the negative cache fail fast with `AUTH_FAILED`. ADR item 5(a) and the FedEx README say `CARRIER_UNAVAILABLE`.
  - This has no security effect. product-manager and principal-architect should align the two.
- **(h) Section name.**
  - The READMEs title the section "Personal data and secrets"; ADR items 4 and 8 call it "PII and redaction".
  - If TASK-191's `readme-docs-check` ever checks the heading, align one side.

### R2.4 Inventory completeness (residual of PR6-SEC-02; for TASK-135/139/140/188)

I checked the inventories against the pinned sources:
- **DHL** (D2 @ `50edb9b`):
  - Missing: `contactInformation.mobilePhone` (`Contact.php` L70-72).
  - Missing: **`shipmentNotification[].receiverId`**, which carries the receiver's **e-mail address** (`ShipmentRequest.php` L162-167). A generic leaf deny-list would never match this key.
  - `customerReferences[].value` (L177-182) is free text and should be flagged the way the UPS README flags `CustomerContext`.
- **UPS** (S4 `Shipping.yaml` @ `fd57ca9`):
  - Not listed: `FaxNumber` (69 schema occurrences) and `PhoneNumber` (9).
  - Not listed: the `InternationalForms.Contacts` parties (`ForwardAgent`, `UltimateConsignee`, `IntermediateConsignee`, `Producer`) and `AlternateDeliveryAddress`. These are covered only if leaf-key matching on `Name`, `AttentionName`, `AddressLine` and `Phone` is implemented (round-1 remediation 2).
- **FedEx** (the shapes themselves are unverified):
  - Add `child_id`, the name used in the prose, next to `child_key`.
  - `contact.phoneExtension`, `contact.faxNumber` and notification `emailAddress` leaves are likely to exist.

**Recommendation for TASK-188.** Redact whole party containers rather than leaf by leaf, and keep the completeness test against the README tables. The containers are:
- DHL `contactInformation`, the address lines and `shipmentNotification`;
- UPS `Phone` and `FaxNumber`;
- FedEx `contact`.

**This PR (optional).** Add the DHL and UPS fields above to the README tables.

### R2.5 Secrets sweep and evidence

| Command | Result |
|---|---|
| `git ls-remote origin refs/pull/6/head`; `git log --ancestry-path --no-merges 4e5d05f..f0387d4` | `f0387d40794e7b077e509f9514578adc78a8e76b`; PR commits `5a9a2a5`, `f0387d4` |
| `docker run --rm -v <repo>:/repo:ro zricethezav/gitleaks:latest git /repo --log-opts="--ancestry-path --no-merges 4e5d05f..f0387d4" --redact` | v8.30.1; 2 commits, ~48.6 KB, **no leaks found** |
| Same with `--log-opts="4e5d05f..f0387d4"` (includes the merged `main` commits) | 13 commits, ~727 KB, **no leaks found** |
| `node sweep.mjs added-lines.txt` (12 identifier and secret-shape patterns, all live on the positive control) over the 194 added lines | Hits are URL paths, public commit SHAs (`fd57ca9…`, `50edb9b…`, `7134d2e…`, this repo's `762b006…`), the support-article ID `000097963`, the product name "Basic Integrated", and `169.254.169.254` (a deliberate SSRF negative-fixture target). **0 true positives** |
| Spot-check of cited sources at their pins (public raw GitHub only; no carrier API host contacted) | UPS `Shipping.yaml` L11251-11268 (Ship: GIF/ZPL/EPL/SPL), L13479-13500 (Recovery including PDF), L4992 (`LabelURL` only with `LabelLinksIndicator`): **match**. FedEx `index.js` @ `7134d2e` L32, 35-38, 80-83, 118-123 (form-body `client_secret`), 168, 213-216, 258-261, 303-306: **match**. DHL `Client.php` L24-25 base URIs: **match**. `762b006` is the last commit touching `shipping-platform-brief.md`: **match** |
| Manual read of the fix-cycle delta against ADR-0010 am. 11 items 1–9, the batch-3 rulings item 1, REQ-CARR-016 and the TASK-131 plan line | Findings above |

### R2.6 Changes to the §5 binding notes

| Task | Added in round 2 | From |
|---|---|---|
| principal-architect | Per-carrier token-endpoint `403` policy. Optional: ADR item 8 wording (route template; identifier allow-pattern, because `encodeURIComponent` does not stop `..`) and the item 6 tier match | 11, 12 |
| product-manager | REQ-CARR-016 `403` sentence scoped per carrier; align `AUTH_FAILED` and `CARRIER_UNAVAILABLE` | 11, 12 |
| TASK-113 | Per-request `rule.tier === ctx.environment` (before any G4 production release); exact match for prefixes without a trailing `/` | 12 |
| TASK-131 / TASK-132 / TASK-140 | UPS `403` → per-account negative cache, not a carrier-wide cool-down; SEC-TC-68 UPS case | 11 |
| TASK-135 / 139 / 140 / 188 | R2.4 field residuals; redact whole party containers | 02 |
| this PR (optional, non-blocking) | R2.4 fields in the README tables; note on the UPS `token-403-blocked-merchant` fixture | 02, 11 |
