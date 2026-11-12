# Code review: PR #6, TASK-009 (SPK-02 carrier API documentation capture), round 1

| Field | Value |
|---|---|
| PR | https://github.com/sukhchdit/shipcube/pull/6 |
| Branch / head | `feat/TASK-009-spk-02-spike-carrier-api` @ `4e5d05f`. Four docs-only commits over merge-base `84ac551`: `f0710e6` UPS, `3ccab5d` DHL, `6c8bbfe` FedEx, `4e5d05f` SPK-02. 4 files, +660/−0 |
| Reviewer | code-reviewer (independent), 2026-11-12 |
| Inputs | WAVE-00.md TASK-009; PLAN.md §9 SPK-02 row (L225); ADR-0010 §Real adapters and amendments 3, 7, 8; ADR-0016; ADR-0019; ADR-0003; REQ-CARR-002, REQ-DOC-002, REQ-SEC-010; D-TASK009-01; CLAUDE.md §5 |

```
VERDICT: CHANGES_REQUESTED
SUMMARY: High-quality, honest evidence capture. All 14 UPS claims and the FedEx/DHL claims I checked match their
         sources exactly, and the official / secondary / unverified labelling is applied with discipline.
         One MAJOR is open. The UPS-PDF option recommended in the ADR-0010 amendment request (SPK-02 §4 item 3)
         rests on a false premise (pdfkit cannot read GIF), omits a PDF path the official spec documents, and
         omits REQ-DOC-002. Four MINORs (one evidence gap, source pinning, two security-lens items) and seven
         NITs. No security finding is High or Critical.
```

## 1. Verification performed by the reviewer

This is a docs-only PR, so I re-ran no build, lint or test gates (dispatch constraint). I did not re-run Gitleaks. Instead I ran a regex scan of all four files at `4e5d05f`, looking for 1Z numbers, 9–22-digit runs, e-mail addresses, JWTs, base64 runs of 32+ characters and `key=`/`token=` assignments. The only hits were URL path fragments. There are no credentials, account numbers or personal data in the files.

I spot-checked the claims against their sources, reading only public documentation and GitHub. No carrier API host was contacted. Downloads are in the scratchpad `review/PR-6-cr/`.

| Source re-read | Claims checked | Result |
|---|---|---|
| UPS official OpenAPI YAML (`UPS-API/api-documentation` `main`, head `fd57ca9`), 9 specs | Path keys of all 9 specs; CIE/production servers; token path without `/api` (`OAuthClientCredentials.yaml:19-25`); `expires_in`/`issued_at`/`refresh_count` typed `string` (:101-118); void is `DELETE` with `trackingnumber` query, `v3` Roadie-only, `shipperNumber` Roadie-only (`Shipping.yaml:2382-2440`); label recovery `default: v1` and `v2603` for Roadie (:2475-2512); ship label codes GIF/ZPL/EPL/SPL (:11251-11263); Tracking `transId`/`transactionSrc` required and 120-day retention; deprecated Rating enum `v1…v2205` incl. `1701`/`1707`; AV `v2`, Locator `v3`, Paperless `v2`, Landed Cost `v1`, Pickup `v2409`; `PickupDate` `yyyyMMdd` with length 4 (`Pickup.yaml:1959-1968`); `Prn` length 26 vs `PRN` minLength 11 (:242-246, :1475-1481) | **All match** |
| DHL third-party SDK `sonnenglas/mydhl-php-sdk` @ `50edb9b` (MIT, last push 2026-08-06) | Base URLs, `x-version` `3.3.1`, `Message-Reference(-Date)` (`Client.php:22-25, 195-197`); `shipments`, `upload-image`, `upload-invoice-data`, `add-piece`; no cancel/void in `ShipmentService`; tracking single and batch `MAX_BATCH_SIZE = 200`; `pickups` POST/PATCH/DELETE with required `requestorName`/`reason`; encodings `pdf/zpl/lp2/epl`; 500/day sandbox; 10-day pickup horizon; `/get-image` does not return the transport label | **All match** |
| FedEx `developer.fedex.com` authorization and rate-limit pages (HTTP 200, prose readable) | `expires_in` 3600 / "regenerated after every 60 minutes"; `child_id` in prose vs `child_key` in examples; 1,400 per 10 s; 500,000/day example; Track 100K/day; 10-minute 403 IP penalty | **All match** |
| FedEx third-party SDK `stores-com/fedex` @ `7134d2e` (cited as F5) | Hosts, `URL_ONLY`, 200 with `errors[]`, `expires_in` 3600 | Match. **The SDK source also confirms paths the README marks unverified** (m1) |
| `node_modules/pdfkit` 0.20.2 (`js/pdfkit.js:4916-4921`) | SPK-02 §4.3 premise "GIF→PDF with pdfkit" | **pdfkit accepts JPEG and PNG only; any other format throws `Unknown image format.`** (M1) |
| Merge safety | `git diff --name-only 84ac551 origin/main` | No overlap with `packages/carriers/**` or `docs/04-plan/spikes/**`, so the merge is a pure union. `gh pr view 6 --json statusCheckRollup` is **empty**: CI has not run on the head |

## 2. Findings

| ID | Severity | File:line | Issue | Required fix |
|---|---|---|---|---|
| M1 | **MAJOR** | `docs/04-plan/spikes/SPK-02.md:64` (§4 item 3), `:37` (§2 item 4); `ups/README.md:64`, `:180` | The recommended UPS PDF option ("adapter converts GIF to PDF … no new network dependency; `pdfkit` is already in the baseline, ADR-0001") is built on three errors. **(1)** pdfkit 0.20.2 cannot read GIF: `openImage` recognises only JPEG (`ff d8`) and PNG (`89 50 4e 47`) and otherwise throws `Unknown image format.` (`pdfkit.js:4916-4921`). A GIF decoder would be a **new dependency**, subject to the CLAUDE.md §5/§9 dependency rules. **(2)** pdfkit is not an ADR-0001 baseline item of `packages/carriers`. It is a dependency of `apps/worker` and is owned by the `documents` module (ADR-0019, ADR-0003:35). Rendering a PDF inside the adapter adds a dependency to `packages/carriers` and moves document generation across a module boundary. **(3)** The option set omits a PDF path the official spec documents: `LabelRecovery_LabelSpecification_LabelImageFormat.Code` lists `PDF` (`Shipping.yaml:13479-13497`). The README's "`PDF` is not documented as a label code" is true for Ship only. The request also cites REQ-CARR-002 but not **REQ-DOC-002**, which stores labels only among PDF 4x6 / A4 / Letter. "Declare GIF and ZPL only" would leave UPS with no REQ-DOC-002 format, so product-manager must be named. Why it matters: the dispatch brief asks whether the amendment request is well-formed, and this is the recommendation the architect will most likely adopt. Adopted as written, it fails at TASK-140 or adds an unvetted dependency. | Rewrite §4 item 3 as a neutral option set with evidence. **(a)** Ship with `GIF` (or `ZPL`), then `POST /labels/v1/recovery` with `LabelImageFormat.Code = PDF`. This is official but unverified in CIE, costs one extra transactional call per label (quota, latency), and must use the shipment identifier only. **(b)** Decode GIF to PNG and embed it with pdfkit in the `documents` module (not the adapter), via a GIF decoder justified per §9 (licence, maintenance, size). **(c)** ZPL/GIF only, with a product-manager decision against REQ-DOC-002. Leave the recommendation to the architect, or recommend (a) subject to verification. Correct SPK-02 §2 item 4, UPS README §3.2 and §7 Q1 to "not documented for Ship; documented for Label Recovery". |
| m1 | MINOR | `fedex/README.md:26, 60, 70, 100, 155-159`; `SPK-02.md:9, 24-25, 42` | **Evidence gap in a cited source.** F5 (`stores-com/fedex`) is cited, but only its README was read. Its `index.js` @ `7134d2e` calls `POST /ship/v1/shipments` (L80), `PUT /ship/v1/shipments/cancel` (L35-38), `POST /address/v1/addresses/resolve` (L303) and `PUT /ship/v1/endofday/` (L168), and sends `x-customer-transaction-id` (L32). The README marks these "unverified", says "no source found" for address resolve, and calls the cancel method unverified. Under the standard the DHL README applies (third-party SDK source = "confirmed (secondary)"), they should be upgraded. SPK-02 §4 item 1 asks the architect to adopt §1 as the **authoritative** table, so it must be consistent. The verdict is unchanged: FedEx stays FALLBACK for Pickup, Locations and all field names. | Read F5 `index.js` at a pinned SHA. Upgrade those five items to "confirmed (secondary)", citing F5@SHA and line. Update SPK-02 header, §1, §2 item 9 and FedEx README §6. |
| m2 | MINOR | `ups/README.md:153`; `dhl-express/README.md:121`; `fedex/README.md:140, 146` | **Sources are not reproducible.** S1, D2 and F5 point at mutable default branches ("default branch head") without commit SHAs, and the UPS raw URLs use `main`. F11 lumps five different search results into one row, yet it backs four path claims and the ETD hosts. "Retrieved 2026-11-12" does not let a later reader (TASK-191, a person diffing the portal) re-read what was read. | Record the commit SHA read for each GitHub source. Use the SHAs the author actually read; for reference, mine on 2026-11-12 were UPS-API `fd57ca9`, mydhl-php-sdk `50edb9b` and stores-com/fedex `7134d2e`. Split F11 into one row per source, with the exact URL or search query and the claim it supports. |
| m3 | MINOR (security LOW) | `SPK-02.md:67` (§4 item 6); `fedex/README.md:111`; `fedex/README.md:184` fixtures `ship-pdf-label-url-only`, `ship-label-url-expiry` | **The host allow-list request does not enforce sandbox-only, and it does not cover returned URLs.** **(a)** DHL sandbox and production share `express.api.dhl.com` and differ only by path (`/mydhlapi/test`). REQ-SEC-010 is host-based, so the allow-list cannot keep a sandbox account off the production endpoint, which CLAUDE.md §5 forbids before G4. The FedEx ETD sandbox (`…/sandbox`) has the same problem. **(b)** The FedEx README conditions the ETD hosts on "only when the ETD operation is implemented", but §4 item 6 drops that condition, and those hosts rest only on search snippets (F11). **(c)** No rule covers carrier-returned URLs: FedEx `URL_ONLY` label URLs, UPS `LabelURL`, DHL `trackingUrl`/`cancelPickupUrl`. Following them means server-side fetches to hosts that are not on the list, and a pressure to widen it. | In §4 item 6: bind each account's base URL (scheme + host + path prefix) to `CarrierContext.environment`, with a test that a sandbox account never produces a production URL (DHL path prefix included). Restore "ETD hosts only when implemented and verified on an official page". Add "never dereference carrier-supplied URLs; request inline label bytes (`LABEL`/base64)". Replace the `ship-pdf-label-url-only` success fixture with an inline-label case, and keep URL_ONLY as a negative case. State that production entries exist only in production configuration. |
| m4 | MINOR (security LOW) | All three READMEs §3 (no PII subsection); `dhl-express/README.md:83`; `ups/README.md:93`; `dhl-express/README.md:65, 68` | **No per-operation PII inventory for the redactor.** The READMEs flag tracking signature/POD redaction, which is good, but not the following. Request-side PII field names for the ADR-0010 am. 8 deny-list: UPS `AttentionName`, `Phone.Number`, `AddressLine`, `TaxIdentificationNumber`, `PickupAddress.ContactName/Phone`; FedEx `contact.personName/phoneNumber/emailAddress`, `shipper.tins[]`; DHL `contactInformation.*`, `registrationNumbers`. **PII in URL query strings**, which reaches HttpClient logs and OTel `url.full` and bypasses body redaction: DHL cancel pickup `requestorName` (required), DHL `GET /rates` city and postal code, UPS reference tracking `destZip`/`shipperNum`. **Data minimisation at source:** keep UPS `returnSignature`/`returnPOD` false, and avoid DHL `all-checkpoints-with-remarks` and `epod-detail-esig` unless needed. | Add a short "PII and redaction" subsection to each README listing these items. Add to SPK-02 §4 (or route to TASK-135/139/140) that the HttpClient logs and traces URLs with the query string stripped or redacted. |
| n1 | NIT | `SPK-02.md:87` | Contradicts the PR body. SPK-02 §6 says "Gitleaks run is by CI (not run locally)", but the PR body reports a local Gitleaks v8.30.1 run with no leaks. | Align SPK-02 §6 with what was actually run. |
| n2 | NIT | `ups/README.md:11`, `fedex/README.md:11`, `dhl-express/README.md:11` | `[Sandbox quirks](#sandbox-quirks)` is a broken anchor: the heading `## 4. Sandbox quirks` slugs to `#4-sandbox-quirks`. | Fix the anchors. |
| n3 | NIT | `ups/README.md:26` | `transId` = "correlation ID truncated to 32 characters": a hyphenated UUID is 36 characters, so truncation cuts the last group. `transactionSrc = shipqube` hard-codes the brand, but the brand is `BRAND_*` configuration. | Use the 32-hex-digit form without hyphens, and a neutral constant or config value for `transactionSrc`. |
| n4 | NIT | `fedex/README.md:22-25`, `:182` | FedEx states `expires_in = 3600` (and fixture `token-success-3600`) without the UPS README's explicit "read `expires_in`, never hard-code". It also does not say that a token-endpoint `403` during the 10-minute IP penalty must stop refreshes and open the breaker, rather than be handled as a 401-style refresh. | Mirror SPK-02 §4 item 5 in FedEx §1. Clamp the TTL when `expires_in ≤ 60`. Add a `token-403-ip-penalty` → breaker note. |
| n5 | NIT | `SPK-02.md:68` | "Only FedEx per-10-second limits are documented" is wrong: F4 also documents daily quotas (an organisation example and Track 100K/day per project). The conclusion (seed `0`) still holds. | Fix the wording. |
| n6 | NIT | `SPK-02.md:63` (§4 item 2) | DHL has no cancel and no label recovery, and returns the label only inline at create. After an ambiguous `createShipment`, the carrier shipment can therefore exist without a label and cannot be cancelled. | Mention reconciliation of ambiguous DHL creates (for example a lookup by shipper reference via tracking) as an input to TASK-135. |
| n7 | NIT | `fedex/README.md:26, 41` | Empty Source cells. | Cite F5 at a pinned SHA (see m1) for L26, and mark L41 as a design note. |

## 3. Answers to the reviewer-focus questions

- **ADR-0010 correction list (SPK-02 §2).** Items 1–3 and 5–13 are accurate as spot-checked. Item 4 needs the M1 correction (PDF exists via Label Recovery). "DHL has no cancel" is honestly labelled as absence of evidence in a third-party SDK, and that is the right framing.
- **Is "confirmed (secondary)" enough for TASK-135/139 to start?** Yes, to *start* from synthesised fixtures. That matches PLAN §9 and SPK-02 §5. It is not enough to *close*: a person with portal access must diff before closure, or the item stays a COND-SANDBOX-DEMO condition. That is already the stated rule, and §4 item 4's "Diffed against official spec by a person: yes/no" line is the right TASK-191 hook.
- **Fixture plans.** They are useful and well chosen. They cover ambiguous creates, single-object-vs-array variants, string `expires_in`, batch partial-not-found, redaction cases and `cancel-capability-not-supported-no-io`. Change one under m3: replace `ship-pdf-label-url-only`.

## 4. Security lens

| Check | Result |
|---|---|
| Secrets, credentials, account numbers | None. Placeholders only (`<DHL_API_KEY>`, `<UPS_CLIENT_ID>`, `<TRACKING_NUMBER_1Z>`, …). Reviewer regex scan clean |
| Instructions to call production endpoints | None. Production hosts are listed as facts; every README makes live calls opt-in sandbox only (`CARRIER_LIVE_SANDBOX=1`, COND-SANDBOX-DEMO). The spike itself contacted no carrier API host |
| Host allow-list entries | Correct hosts. They are minimal except that the ETD hosts are not conditioned on implementation in §4 item 6. Two gaps: sandbox-only cannot be enforced by host for DHL and FedEx ETD, and there is no rule for carrier-returned URLs (m3, **LOW**) |
| OAuth token handling | Good: no hard-coded lifetime (SPK-02 §4 item 5; UPS `expires_in` string), single-flight refresh, FedEx IP-penalty awareness. FedEx README wording (n4, INFO) |
| PII in label/customs/tracking payloads | Signature/POD redaction is flagged. Request-field inventory, query-string PII and data-minimisation flags are missing (m4, **LOW**) |
| **High/Critical** | **None.** For security-analyst: m3 (CWE-918 SSRF hardening / environment confusion, OWASP A10) and m4 (CWE-532 PII in logs, OWASP A09), both LOW at design time; they become implementation conditions on TASK-135/139/140 |

## 5. Good patterns worth keeping

- A three-level evidence vocabulary (confirmed / confirmed (secondary) / unverified), applied per item, with the reason given for each gap (§3 of SPK-02).
- Unreadable sources are still listed (S11, D1) "so the gap is explicit".
- Spec-level subtleties are recorded where they matter: string-typed `expires_in`, a token path outside `/api`, a `PickupDate` length conflict, single-object-vs-array response variants, DHL label returned only at create, and the 10-minute gap before upload.
- Retry and idempotency are restated per operation against ADR-0010, and `idempotent create = false` is declared explicitly for all three carriers.

## 6. Merge conditions

1. Fix M1 in this PR: §4 item 3 option set, §2 item 4 and the UPS README wording.
2. Fix m1 and m2 in this PR. SPK-02 §1 is proposed as the authoritative ADR table, and its sources must be reproducible.
3. m3 and m4: amend SPK-02 §4 in this PR (preferred, as small additions to the amendment request), or route them explicitly to TASK-135/139/140 and security-analyst in DECISIONS.md.
4. NITs are optional in this PR.
5. CI must run on the final head (the status rollup was empty on `4e5d05f`). Re-review (round 2) is limited to the delta.

## Round 2 (head f0387d4)

| Field | Value |
|---|---|
| Head | `f0387d4` (`origin/feat/TASK-009-spk-02-spike-carrier-api`, equal to `gh pr view 6` `headRefOid`) |
| Content delta reviewed | `4e5d05f..f0387d4 -- packages/carriers docs/04-plan/spikes/SPK-02.md`. The content comes from two commits: `5a9a2a5` (fix cycle 1) and `f0387d4` (alignment with ADR-0010 am. 11). The merges of main (`d3238ad`, `eb3989c`) are excluded. 4 files, +194/−93 |
| Inputs | Fix comments #6828740606 and #6829045538; ADR-0010 am. 11 (main, items 1–9); `rulings/wave-0-batch-3-rulings.md` item 1 and the PR table; D-ARCH-057/062; risks.md R-ARCH-25; US-137 (EPIC-06, main `cb69b04`); WAVE-07 TASK-191 |
| Reviewer | code-reviewer (independent), 2026-11-12 |

```
VERDICT: APPROVED_WITH_NITS
SUMMARY: All round-1 findings are closed: M1, m1–m4 and n1–n7. SPK-02 §4 item 3 is now a neutral, evidenced option set.
         Its "Decided: option (a)" note and the UPS README match ADR-0010 am. 11 item 3. Every line citation I re-read at
         the pinned SHAs is correct. The egress table and the PII subsections match am. 11 items 6 and 8. No BLOCKER or
         MAJOR findings. Six new NITs, mostly alignment with rulings that landed after the head, routed to their owners.
         No Critical or High security finding. CI has still not run on the head.
```

### R2.1 Verification performed by the reviewer

This is a docs-only PR, so per the dispatch I ran no build, lint, typecheck or test suite. I ran `prettier --check` on the 4 changed files in the `Shipqube-TASK-009` worktree at `f0387d4`. Result: exit 0. I contacted no carrier API host. Spot-checks read only public GitHub raw files and the public npm registry metadata. New downloads are in the scratchpad `review/PR-6-cr-r2/`. I re-used the round-1 downloads of `UPS-API/api-documentation@fd57ca9` and `stores-com/fedex@7134d2e`.

| Check | Result |
|---|---|
| UPS `Shipping.yaml` @ `fd57ca9`: lines cited in SPK-02 §2 item 4 and §4 item 3 and in UPS README §3.2, §3.4 and S4 | **All correct.**<br>- L2475-2596 is the `/labels/{version}/recovery` operation; L2597 starts the next path.<br>- L11251-11268 is `LabelSpecification_LabelImageFormat`, Ship: "GIF, ZPL, EPL and SPL".<br>- L13356-13380 is `LabelRecoveryRequest`, which declares `TrackingNumbers` and `ReferenceValues` as `required` and `TrackingNumber` as max 18. The README's spec-quirk statement is accurate.<br>- L13479-13500 is `LabelRecovery_LabelSpecification_LabelImageFormat` with "PDF -- label is in PDF format".<br>ADR-0010 am. 11 cites the narrower ranges `:11251-11263` and `:13479-13496`. Both sets of ranges are valid; SPK-02's ranges include the `Description` property. New observation: R2-n2 |
| F5 `stores-com/fedex` `index.js` @ `7134d2e`, the 8 line citations (L32, 35-38, 80-83, 118, 168, 213-216, 258-261, 303-306) | **All 8 match exactly** (method and path). L32 sits inside `if (options.customer_transaction_id)`, which matters for R2-n5 |
| DHL SDK @ `50edb9b`: `Client.php` L24-25 base URLs; `src/ValueObjects/{Contact,Address,RegistrationNumber}.php` field names used in the DHL PII subsection | Match: `/mydhlapi/` and `/mydhlapi/test/`; `fullName`, `companyName`, `phone`, `email`, `addressLine1..3`, `postalCode`, `cityName`; `typeCode`, `number`, `issuerCountryCode`. `PickupService::cancel` requires non-empty `requestorName` and `reason` in the query (L64-82) |
| npm registry, the option (b) dependency facts (SPK-02 §4 item 3) | SPK-02 is **accurate**: `@jimp/js-gif` 1.6.1 (MIT, published 2026-04-07) → `omggif` ^1.0.10 (published 2019-07-16) and `gifwrap` ^0.10.1 (published 2022-03-17). The ADR's dates differ; see R2.4 |
| ADR-0010 am. 11 consistency | See R2.2. SPK-02 §4 now opens with a status line: "decided in ADR-0010 amendment 11 … the text below is kept as the request record". That correctly makes the ADR, not the request text, authoritative |
| Secrets and PII regex scan of the 4 files at `f0387d4` (1Z numbers, 9–22-digit runs, e-mail addresses, JWTs, 32+ base64 runs, `key/token/secret/password=`) | **Clean.** The only hits are commit SHAs, URL fragments, the prose "password = client secret" and the placeholder `<key:secret>` |
| Merge safety | `git diff --name-only origin/main...f0387d4` lists exactly the 4 files. `origin/main` has since moved to `cb69b04` (docs-only D-059, no overlap with these paths), so a merge is a pure union. `gh pr view 6 --json statusCheckRollup` is **`[]`**: CI has not run on `f0387d4` |
| Author's gates (fix comments) | They report lint, format, typecheck, unit 753/753, build and audit on `5a9a2a5`, and lint, format and unit on `f0387d4`. I did not re-run these; I accept them for a markdown-only delta. My prettier check agrees |

### R2.2 Closure of round-1 findings

| ID | Status | Evidence at `f0387d4` |
|---|---|---|
| **M1** UPS PDF | **Closed** | **Option set.** SPK-02 §4 item 3 (L64) quotes REQ-DOC-002 in full and lists three neutral options:<br>- **(a)** Ship GIF/ZPL, then Label Recovery with `PDF`. Cited at the SHA; marked not exercised in CIE; notes the extra transactional call and the request by tracking number only.<br>- **(b)** Decode the GIF in `documents`, not the adapter, as a named new dependency that is not added.<br>- **(c)** GIF/ZPL only, with an explicit product-manager decision against REQ-DOC-002.<br>The pdfkit premise is gone, and (b) states pdfkit's JPEG/PNG limit.<br>**Decision note.** "Decided: ADR-0010 am. 11 item 3 adopts option (a) … new optional `recoverLabel` operation, no PDF code in `packages/carriers`" is consistent with am. 11 item 3(a)–(c).<br>**Corrections.** §2 item 4 and UPS README §3.2 now say "not documented for Ship; documented for Label Recovery". README §3.4 lists the recovery formats.<br>**UPS README §7 Q1** is closed with the am. 11 design: `labelFormats = [PDF_4X6, ZPL]`; the saga's step 4 calls `recoverLabel`; the adapter renders no PDF. This matches am. 11 3(b)/(c) and R-ARCH-25. The fixture `label-recovery-pdf` is added |
| **m1** FedEx secondary confirmations | **Closed** | Rate, Ship, Cancel (`PUT`), Track and Address-resolve paths and methods are upgraded to "confirmed (secondary)" with F5 line numbers in all of these places: SPK-02 header verdict, §1, §2 item 9; FedEx README §1, §3.1–3.4, §3.6, §6; and F5 row. `x-customer-transaction-id` is upgraded too. Pickup and Locations stay unverified, and the verdict stays FALLBACK. Wording nits: R2-n5, R2-n6 |
| **m2** Source pinning | **Closed** | All GitHub rows carry the SHA read: UPS full SHA `fd57ca9f…`, with the raw URLs rewritten from `main` to the SHA; DHL `50edb9bb…`; FedEx `7134d2e3…`; F2 brief `762b0061…`. Web pages are labelled "not pinnable · retrieved 2026-11-12". F11 is split into F11a–F11e and D4 into D4a/D4b, one source and claim per row. Disclosure nit: R2-n5 |
| **m3** Egress | **Closed** | SPK-02 §4 item 6 is now an exact-origin + path-prefix + tier table:<br>- DHL `/mydhlapi/test/` vs `/mydhlapi/`; the UPS token path outside `/api/`; FedEx ETD gated on implementation **and** official verification.<br>- Production rules are refused unless `APP_ENV=production`, with a sandbox-never-emits-production test.<br>- Redirect hops are re-checked. No wildcard or suffix matching (the ETD sandbox host contains `prod`).<br>- Carrier-returned URLs are never followed or surfaced, in SPK-02 and all three READMEs.<br>- `ship-pdf-label-url-only` is replaced by `ship-pdf-label-inline`, and the negative cases are `ship-label-url-only-not-followed` (FedEx), `ship-labelurl-not-followed` (UPS) and `shipment-carrier-urls-not-followed` (DHL), including `169.254.169.254`.<br>It agrees with am. 11 item 6's `EgressRule = { origin, pathPrefixes, tier }` and its environment binding. Where SPK-02 says "exist only in production configuration", the adopted ADR is stricter: static per-adapter `EGRESS`, no env-settable rule. The §4 status line makes the ADR authoritative, so there is no conflict. Implementation nit: R2-n3 |
| **m4** PII inventory | **Closed** | Each README has a per-operation "Personal data and secrets" subsection (UPS §3.11, FedEx §3.10, DHL §3.11). Each lists:<br>- request-side personal, tax-ID and secret field names (field names spot-checked: DHL SDK value objects; UPS round-1 spec read);<br>- identifiers in paths and query strings, including DHL `requestorName` (fixed non-personal value from `BRAND_*`), DHL `/rates` city and postcode, and UPS `destZip`/`shipperNum`;<br>- binding data-minimisation flags.<br>FedEx paths are honestly marked conventional/unverified. SPK-02 §4 item 8 asks for route-template-only logging. This matches am. 11 item 8. Heading-name nit: R2-n1 |
| n1 Gitleaks wording | Closed | SPK-02 §6: "Gitleaks v8.30.1 run locally …; CI lane will re-run" |
| n2 Anchors | Closed | `#4-sandbox-quirks` in all three; the headings exist |
| n3 `transId` / `transactionSrc` | Closed | 32 hex digits without hyphens; `transactionSrc` from `BRAND_*` |
| n4 FedEx token | Closed | Read `expires_in` per response, strict parse, ≤ 60 → use once. The 403 is per IP, shared, causes a carrier-wide cool-down and opens the breaker, and is never handled as a refresh. 400/401 get a negative cache. Fixtures added. Consistent with am. 11 item 5 |
| n5 Quota wording | Closed | SPK-02 §4 item 7 |
| n6 Ambiguous DHL create | Closed | SPK-02 §4 item 2 and DHL README §3.3. Adopted as am. 11 item 9 |
| n7 Empty source cells | Closed | The "Other headers" row cites F5 @ `7134d2e`; the Retry row is marked as a design note |
| Focus: "Diffed against official spec by a person: no" | **Present** | A `Spec diff` row in all three READMEs (L10). It contains the exact string US-137 parses (`Diffed against official spec by a person: no`), with the am. 11 item 4 and COND-SANDBOX-DEMO pointer. `no` is honest for UPS too: an agent, not a person, read the YAML |

### R2.3 New findings (round 2)

| ID | Severity | File:line @ `f0387d4` | Issue | Required fix / owner |
|---|---|---|---|---|
| R2-n1 | NIT | `ups/README.md:143`, `fedex/README.md:120`, `dhl-express/README.md:109`; the Docs URL rows (L7) | US-137 (main `cb69b04`, after this head) and am. 11 items 4 and 8 name the subsection **"PII and redaction"** and require "docs URL **with a specification commit SHA**". The READMEs title it "Personal data and secrets", and the UPS Docs URL row carries no SHA (the SHA is in §5 only). TASK-191's `readme-docs-check` will fail all three if it matches the heading literally. | Optional in this PR: rename to "PII and redaction (personal data and secrets)" and add `@ fd57ca9` to the UPS Docs URL row. Otherwise TASK-191, which owns the parser, decides the match rule and TASK-135/139/140 align the READMEs. |
| R2-n2 | NIT | `ups/README.md` §3.4 (L88) | A spec quirk on the **decided** path is not recorded. `LabelRecovery_LabelSpecification_LabelImageFormat.Code` declares `minLength: 4, maxLength: 4` (`Shipping.yaml:13499-13500` @ `fd57ca9`). That contradicts the 3-character `GIF`/`PDF`/`ZPL` values and the operation's own examples (`Code: ZPL` L2535, `Code: GIF` L2555). Ship's schema says 1..4. A validator generated from the published schema would reject `PDF`. | Add the quirk next to the `TrackingNumbers` one in §3.4. TASK-140: do not validate the recovery request's `Code` length against the published schema; settle it in CIE. principal-architect may add it to R-ARCH-25 |
| R2-n3 | NIT (security INFO) | `SPK-02.md:75,77` (UPS token rows); ADR-0010 am. 11 item 6 | SPK-02 says the UPS token path is an **exact path**. ADR am. 11 lists `/security/v1/oauth/token` as a **prefix**. A naive `startsWith` admits `/security/v1/oauth/tokenX` and `/security/v1/oauth/token/…`. The `/api/` prefixes have trailing slashes; this one does not. | TASK-113: match prefixes at path-segment boundaries (prefix ends in `/` or the path equals the prefix) after WHATWG normalisation, and add a test with `/security/v1/oauth/tokenX`. principal-architect: say "exact path" for the token rule in am. 11's table |
| R2-n4 | NIT | `SPK-02.md:99,101` (§5); `dhl-express/README.md:60` (§3.3 "Recommended"), `:174-178` (§8 "amendment request"), §9 shipments row | Decision state is stale after am. 11:<br>- SPK-02 §5 TASK-135 row still says "resolve the `cancelShipment` decision first" (decided by am. 11 item 2).<br>- The TASK-191 row omits the new mandatory line and the PII subsection.<br>- DHL README §3.3/§8 still say "Recommended" / "amendment request" without citing am. 11 items 2 and 9.<br>- The DHL fixture plan lacks `create-timeout-then-tracking-reconcile` (am. 11 item 9). | Optional in this PR. Otherwise TASK-135 updates the DHL README and fixture plan as part of its am. 11 work |
| R2-n5 | NIT | `fedex/README.md:27`; `SPK-02.md:42` (§2 item 9); `fedex/README.md:166-170` (F11a-e); `SPK-02.md:64` | Accuracy and disclosure:<br>- F5 sends `x-customer-transaction-id` only when the caller passes `options.customer_transaction_id` (`index.js` L31-32). The README says "sends it on every API call". Say "supports it, optionally, on every API method".<br>- The F11a–e URLs were reconstructed by re-running the searches. The fix comment discloses this, but the Sources table does not.<br>- In the "Decided:" sentence, the quoted phrase is the §2 correction wording, not option (a)'s name. | Optional wording fixes in this PR |
| R2-n6 | NIT | `fedex/README.md:11` (header Verdict row) | The header still lists Rate, Ship, Cancel and Address Validation as "FALLBACK for paths and field names". §6 and the SPK-02 header now say their paths and methods are confirmed (secondary), and that FALLBACK applies to Pickup/Locations paths and to all field names. The overall verdict (FALLBACK) is the same. | Mirror the SPK-02 header wording |

### R2.4 Out-of-PR observation (for principal-architect, NIT)

ADR-0010 am. 11 item 3 and ruling 1.3 support "no npm GIF decoder passes the 18-month rule" with npm `time.modified` dates: `omggif` 2022-06, `gifwrap` 2022-06, `gifuct-js` 2025-01. Those are metadata-modification dates, not release dates. The latest releases are `omggif` 1.0.10 on 2019-07-16, `gifwrap` 0.10.1 on 2022-03-17, `gifuct-js` 2.1.2 on 2021-11-04 and `@jimp/gif` 0.22.12 on 2024-02-23. The ADR also does not name `@jimp/js-gif` 1.6.1 (2026-04-07), which is itself inside the window but has transitive dependencies outside it. The conclusion holds and is in fact stronger. Correct the dates when the ADR is next touched. SPK-02's figures are the accurate ones.

### R2.5 Security lens (short)

| Check | Result |
|---|---|
| Secrets, credentials, account numbers, personal data | None. Regex scan is clean; placeholders only |
| Sandbox-only | Production origins appear only as facts and as `APP_ENV=production`-gated egress rows. No instruction calls a production endpoint, and live runs stay `CARRIER_LIVE_SANDBOX=1` opt-in |
| m3 (CWE-918) and m4 (CWE-532) from round 1 | Closed at design level. Implementation conditions are carried by am. 11 items 6 and 8 → TASK-113/135/139/140/188/214 |
| New | R2-n3 (INFO): segment-boundary prefix matching for TASK-113 |
| **High/Critical** | **None** |

### R2.6 Merge conditions

1. CI must run green on the final head. `statusCheckRollup` is empty on `f0387d4`.
2. The NITs R2-n1..n6 are optional in this PR. Whatever is not fixed here goes to the named owners: R2-n1 → TASK-191/135/139/140; R2-n2 → TASK-140 and R-ARCH-25; R2-n3 → TASK-113 and the architect; R2-n4 → TASK-135; R2-n5/n6 → TASK-139. R2.4 goes to principal-architect. If the author pushes NIT fixes, a re-review only needs a delta diff check, limited to markdown.
3. When TASK-113/135/139/140 land, the reviewer checks: the per-adapter `EGRESS` tests, including the DHL prefix; URLs logged with the query string stripped; the inline-label-only negative fixtures; the DHL `requestorName` constant; and the token-endpoint 403 cool-down.
