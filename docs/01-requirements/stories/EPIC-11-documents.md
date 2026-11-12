# EPIC-11 — Labels and documents

- **Goal:** Customers get their shipping label and customs documents as versioned, hashed, private files that can be downloaded only through audited, permission-checked, short-lived links.
- **Milestone(s):** M1
- **REQ areas covered:** REQ-DOC (all rows 001-015)
- **Exit-demo contribution:** PRD 6.2: "a <carrier> label and a commercial invoice PDF", confirmation email with documents, documents downloadable from the shipment detail; PRD 6.1 audit viewer (DOWNLOAD entries).
- **Depends on epics:** EPIC-01 (PLAT: queue, object storage), EPIC-03 (RBAC/RLS), EPIC-04 (AUDIT, fail-closed), EPIC-05 (UI/I18N), EPIC-06 (CARR: labels), EPIC-09 (customs data, invoice content US-186, confirmation page), EPIC-10 (saga), EPIC-12 (pickup), EPIC-15 (NOTIF: email), EPIC-16 (API/SEC).

## Conventions used in the acceptance criteria

- Roles: "customer" = user holding `document:read`, `document:download` and `document:email` through `shipment:read`; "Viewer" holds `document:read` only (assumed split, A-B-11-1); a role with none of them gets 403 `AUTHZ_DENIED`. Unauthenticated: 401 `AUTH_REQUIRED`. Other organisation: 404 `NOT_FOUND`.
- Document statuses: `CURRENT`, `SUPERSEDED`, `VOIDED`. Types: `SHIPPING_LABEL`, `COMMERCIAL_INVOICE`, `PRO_FORMA_INVOICE`, `CARRIER_CUSTOMS_DECLARATION`, `PICKUP_CONFIRMATION`. Rules DR-B26, EC-B33..EC-B35.
- Download audit: action `DOWNLOAD` on entity `document` with document ID, version and SHA-256 (DR-A12 sensitive entity, fail-closed). Listing writes `VIEW`.
- Download file name: `<order number>-<document type>-v<version>.pdf`, for example `US-123456782-SHIPPING_LABEL-v1.pdf`.
- `@live-sandbox` (COND-SANDBOX-DEMO) appears only on US-222 (real carrier label).
- "UI standard" = en/es/fr, six screen states, 360 px and 1280 px, keyboard operable, axe clean.

## Story summary

| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs |
|---|---|---|---|---|---|---|
| US-220 | Document model and private encrypted storage | M1 | Must | M | EPIC-01 | REQ-DOC-001, REQ-DOC-005, REQ-DOC-006 |
| US-221 | Document versioning | M1 | Must | S | US-220 | REQ-DOC-004 |
| US-222 | Carrier label stored in every offered format | M1 | Must | M | US-220, EPIC-06 | REQ-DOC-002 |
| US-223 | Asynchronous document generation job | M1 | Must | M | US-220, US-221, EPIC-10 | REQ-DOC-012 |
| US-224 | Document list and re-download from shipment detail | M1 | Must | M | US-220, US-225 | REQ-DOC-011 |
| US-225 | Pre-signed download URL after permission and tenant check | M1 | Must | M | US-220 | REQ-DOC-007 |
| US-226 | Fail-closed download audit | M1 | Must | S | US-225, EPIC-04 | REQ-DOC-008 |
| US-227 | Integrity check before download | M1 | Should | S | US-225 | REQ-DOC-009 |
| US-228 | Email documents to the account address | M1 | Should | M | US-225, EPIC-15 | REQ-DOC-010 |
| US-229 | Void label on cancellation and refuse voided downloads | M1 | Should | M | US-225, EPIC-09 | REQ-DOC-013, REQ-DOC-014 |
| US-230 | Pickup confirmation document | M1 | Should | S | US-221, EPIC-12 | REQ-DOC-003 |
| US-231 | ZPL label output | M1 | Could | S | US-222 | REQ-DOC-015 |

Counts: 12 stories. Must 7 (US-220..US-226), Should 4 (US-227..US-230), Could 1 (US-231).

## Stories

### US-220 — Document model and private encrypted storage
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** EPIC-01
- **Linked REQs:** REQ-DOC-001, REQ-DOC-005, REQ-DOC-006
- **As a** customer **I want** my documents kept private and tamper-evident **so that** nobody else can read them and I can trust their content.
- **Notes:** MinIO in Compose (D-025). No end-user uploads in M1.

#### Acceptance criteria
```gherkin
Feature: Document model and storage
  Scenario: Stored document has full metadata
    When the Mock label for shipment S1 is stored
    Then the document has type SHIPPING_LABEL, shipment link, version 1, format, media type "application/pdf", size in bytes, SHA-256, storage location, status CURRENT and creation time

  Scenario: Hash is computed over the stored bytes
    Then the SHA-256 in the metadata equals the hash of the object read back from storage and appears in the metadata response

  Scenario: Private, encrypted, personal-data-free key
    Then the object has server-side encryption, no public access (an anonymous GET of the object URL returns 403), and a key made only of organisation and shipment UUIDs, containing no name, address or tracking number

  Scenario Outline: Unknown type or status rejected
    When a document is created with <field> "<value>"
    Then creation fails with 400 "VALIDATION_ERROR"
    Examples:
      | field  | value        |
      | type   | TAX_INVOICE  |
      | status | ARCHIVED     |

  Scenario: Oversized document
    When a generated file exceeds 5 MB
    Then storage is refused, an alert is raised and no CURRENT version is created

  Scenario: Permission paths
    Then metadata is readable only with "document:read" (403 "AUTHZ_DENIED" otherwise), unauthenticated gets 401 and another organisation's document gets 404 "NOT_FOUND"

  Scenario: Audit
    Then creating a document writes CREATE on "document" with type, version and SHA-256 in the same transaction as the metadata row
```

### US-221 — Document versioning
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-220
- **Linked REQs:** REQ-DOC-004
- **As a** customer **I want** re-issued documents kept as new versions **so that** I always get the latest and history is preserved.

#### Acceptance criteria
```gherkin
Feature: Document versioning
  Scenario: Re-issue with different bytes
    Given invoice version 1 is CURRENT
    When the invoice is regenerated with different bytes
    Then version 2 is CURRENT, version 1 is SUPERSEDED and both are kept

  Scenario: Identical bytes create no version
    When the carrier label is re-fetched and its SHA-256 is unchanged
    Then no new version is created

  Scenario: Latest by default, older by explicit version
    Then a download request without a version returns version 2 and a request with version 1 returns version 1

  Scenario: Unknown version
    When version 7 is requested
    Then the response is 404 "NOT_FOUND"

  Scenario: Concurrent re-issue
    Given two jobs re-issue the same changed document at once
    Then exactly one version n+1 is created (no duplicate numbers)

  Scenario: Permission paths
    Then unauthenticated gets 401, a role without "document:read" gets 403 "AUTHZ_DENIED", another organisation gets 404

  Scenario: Audit
    Then each new version writes CREATE and the supersession writes UPDATE on "document"
```

### US-222 — Carrier label stored in every offered format
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-220, EPIC-06
- **Linked REQs:** REQ-DOC-002
- **As a** customer **I want** the label in the size my printer needs **so that** I can print it first time.
- **Notes:** A4 for non-US/CA origins, Letter for US/CA origins, plus 4x6 inches. COND-SANDBOX-DEMO: real labels from the DHL, FedEx and UPS sandboxes.

#### Acceptance criteria
```gherkin
Feature: Label formats
  Scenario Outline: Formats offered by origin
    Given a service offering PDF 4x6 and the regional page size, with origin <origin>
    Then the stored label formats are "4x6" and "<page>"
    Examples:
      | origin | page   |
      | US     | Letter |
      | CA     | Letter |
      | IN     | A4     |
      | UK     | A4     |

  Scenario: Mock returns both formats
    Then both format files exist as separate documents of type SHIPPING_LABEL, each marked "MOCK - NOT A VALID LABEL"

  Scenario: Carrier returns one format
    Given the carrier returns only 4x6
    Then only 4x6 is stored and offered

  Scenario: Format choice on confirmation page and shipment detail
    When the customer picks "A4" and presses Download
    Then the A4 file is downloaded and the printer-required hint is shown beside the button

  Scenario: Unsupported format requested
    When a client requests format "A3"
    Then the response is 404 "NOT_FOUND"

  Scenario: Permission paths
    Then unauthenticated gets 401, a role without "document:download" gets 403 "AUTHZ_DENIED", another organisation gets 404

  Scenario: UI standard
    Then the format selector passes the UI standard in en/es/fr at 360 px and 1280 px

  @live-sandbox
  Scenario: Real sandbox label (COND-SANDBOX-DEMO)
    Given CARRIER_LIVE_SANDBOX=1 and sandbox credentials for a carrier
    When a shipment is booked
    Then a real sandbox label PDF is stored for that carrier with its SHA-256 and is downloadable
```

### US-223 — Asynchronous document generation job
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-220, US-221, EPIC-10
- **Linked REQs:** REQ-DOC-012
- **As a** customer **I want** documents prepared in the background without blocking my booking **so that** I get confirmation quickly and documents follow.

#### Acceptance criteria
Permission path: covered by scenario "Customers cannot enqueue generation directly".
```gherkin
Feature: Document generation job
  Scenario: Mock booking documents within 30 seconds
    When the Mock booking reaches BOOKED
    Then label and invoice documents exist within 30 seconds (p95) and the shipment moves to LABEL_READY

  Scenario: Deterministic job ID
    Then the job ID is derived from shipment, document type and input hash

  Scenario: Redelivery creates no duplicate
    When the same job is delivered twice
    Then one document version exists

  Scenario: Retries with backoff then dead letter
    Given generation fails every time
    Then there are 5 attempts with exponential backoff (5 s base), the job lands in the dead-letter queue and an alert is raised

  Scenario: Shipment stays BOOKED while pending or failed
    Then the shipment remains BOOKED, the UI shows "documents are being prepared" and the booking is not compensated

  Scenario: Generation completes after a failure was fixed
    When a dead-lettered job is re-run
    Then the document is created and the shipment moves to LABEL_READY

  Scenario: Customers cannot enqueue generation directly
    When a customer or an unauthenticated client calls a generation route
    Then an authenticated customer gets 404 "NOT_FOUND" (no such route), an unauthenticated client gets 401 "AUTH_REQUIRED", and the job runs only as the system actor on behalf of the booking user

  Scenario: Audit
    Then each generated document writes CREATE on "document" with actor type system and the booking correlation ID
```

### US-224 — Document list and re-download from shipment detail
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-220, US-225
- **Linked REQs:** REQ-DOC-011
- **As a** customer **I want** to see and re-download my documents any time **so that** I can reprint a lost label.

#### Acceptance criteria
```gherkin
Feature: Document list and re-download
  Scenario: List documents
    When the customer opens the shipment detail
    Then each document shows type, version, format, size, hash, status and creation time

  Scenario: Re-download later
    Given a CURRENT label created 30 days ago
    Then the customer can download it again

  Scenario: Voided document not downloadable
    Given a VOIDED label
    Then it is listed as void and its download action is disabled

  Scenario: Empty list
    Given documents are still generating
    Then the empty state reads "documents are being prepared"

  Scenario: Permission paths
    Then listing needs "document:read" (403 "AUTHZ_DENIED"), downloading needs "document:download" (a Viewer sees the list but gets 403 on download), unauthenticated gets 401, another organisation's shipment gets 404 "NOT_FOUND"

  Scenario: Audit
    Then listing writes VIEW on "document" for the shipment

  Scenario: UI standard
    Then the list is a table at 1280 px and cards at 360 px, in en/es/fr, with loading, empty, error, offline and permission-denied states and axe clean
```

### US-225 — Pre-signed download URL after permission and tenant check
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-220
- **Linked REQs:** REQ-DOC-007
- **As a** security analyst **I want** downloads to use short-lived URLs issued only after authorisation **so that** documents containing addresses cannot leak.

#### Acceptance criteria
```gherkin
Feature: Pre-signed download URL
  Scenario: Authorised download
    When a customer holding "document:download" requests the label of their organisation's shipment
    Then the response contains a pre-signed URL valid for 300 seconds
    And the file is served with "Content-Disposition: attachment" and filename "US-123456782-SHIPPING_LABEL-v1.pdf"

  Scenario: URL expires
    When the URL is used after 301 seconds
    Then storage rejects it

  Scenario: Cross-tenant document
    When a customer of organisation B requests organisation A's document
    Then the response is 404 "NOT_FOUND", no URL is issued and a DENIED audit entry exists (EC-B33)

  Scenario: Missing permission
    When a Viewer without "document:download" requests the URL
    Then the response is 403 "AUTHZ_DENIED" and a DENIED audit entry exists

  Scenario: Unauthenticated
    Then the response is 401 "AUTH_REQUIRED"

  Scenario: URL and personal data never logged
    Then the URL does not appear in logs and the filename contains no name, address or tracking number

  Scenario: Specific version
    When version 1 is requested explicitly
    Then a URL to version 1 is issued
```

### US-226 — Fail-closed download audit
- **Milestone:** M1 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-225, EPIC-04
- **Linked REQs:** REQ-DOC-008
- **As a** Compliance Auditor **I want** every download recorded before the link exists **so that** no document leaves the system unseen.
- **Notes:** EC-B34, DR-A12.

#### Acceptance criteria
```gherkin
Feature: Fail-closed download audit
  Scenario: Audit entry is written before the URL
    When a download is authorised
    Then an audit entry with action DOWNLOAD, entity "document", document ID, version and SHA-256 is committed before the URL is returned

  Scenario: Audit store unavailable
    Given the audit write fails
    Then the response is 503 "AUDIT_UNAVAILABLE" and no pre-signed URL is issued

  Scenario: Denied attempts are audited
    When a cross-tenant or unauthorised download is attempted
    Then an entry with outcome DENIED is written and the response is 404 "NOT_FOUND" or 403 "AUTHZ_DENIED"

  Scenario: Email channel
    When a document is emailed (US-228)
    Then a DOWNLOAD entry with channel EMAIL is written first

  Scenario: Auditor visibility
    Then the Compliance Auditor sees the entries filtered by entity "document" and action DOWNLOAD with actor, IP and hash chain verified

  Scenario: Permission paths
    Then unauthenticated gets 401 "AUTH_REQUIRED" and a role without "document:download" gets 403 "AUTHZ_DENIED" with a DENIED entry
```

### US-227 — Integrity check before download
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-225
- **Linked REQs:** REQ-DOC-009
- **As the** operator **I want** a tampered or corrupted document never served **so that** customers do not print a bad label.
- **Notes:** EC-B35.

#### Acceptance criteria
```gherkin
Feature: Integrity check
  Scenario: Hash matches
    Then the URL is issued after the recomputed SHA-256 equals the stored hash

  Scenario: Hash mismatch
    Given the stored bytes were altered
    Then the response is 500 "DOCUMENT_INTEGRITY_FAILURE", no URL is issued, an audit entry with outcome FAILED is written and an alert is raised

  Scenario: Missing object
    Given the object is missing from storage
    Then the response is 500 "DOCUMENT_INTEGRITY_FAILURE" and an alert is raised

  Scenario: Latency budget
    Then the check on a 5 MB document completes within the endpoint budget for non-carrier endpoints

  Scenario: Permission paths
    Then the check runs only after authorisation: unauthenticated 401, no permission 403 "AUTHZ_DENIED", other organisation 404
```

### US-228 — Email documents to the account address
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-225, EPIC-15
- **Linked REQs:** REQ-DOC-010
- **As a** customer **I want** my documents emailed to me **so that** I can print them from any device.

#### Acceptance criteria
```gherkin
Feature: Email documents
  Scenario: Small set attached
    Given the documents of a shipment total 4 MB
    When the customer presses "Email documents"
    Then the mail catcher holds one email to the account's verified address with the documents attached, in the user's locale

  Scenario: Large set sent as link
    Given the documents total 12 MB
    Then the email contains a link to the account instead of attachments

  Scenario: Only the account address
    When a request names another recipient address
    Then the response is 400 "VALIDATION_ERROR" and nothing is sent

  Scenario: Rate limit
    Given 5 sends for the shipment in the last hour
    When a sixth is requested
    Then the response is 429 "RATE_LIMITED" with Retry-After

  Scenario: Unverified email
    Then the response is 403 "EMAIL_NOT_VERIFIED"

  Scenario: Permission paths
    Then "document:email" is required (403 "AUTHZ_DENIED"), unauthenticated 401, another organisation 404 "NOT_FOUND"

  Scenario: Audit
    Then a DOWNLOAD entry with channel EMAIL is written for each document before sending
```

### US-229 — Void label on cancellation and refuse voided downloads
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** M · **Depends on:** US-225, EPIC-09
- **Linked REQs:** REQ-DOC-013, REQ-DOC-014
- **As a** customer **I want** a cancelled label marked void **so that** nobody uses a label that no longer works.

#### Acceptance criteria
```gherkin
Feature: Void label
  Scenario: Carrier confirms the void
    Given a shipment being cancelled
    When the carrier confirms the void
    Then the label is VOIDED with the file and metadata retained and the invoice stays CURRENT

  Scenario: Void failure keeps the label usable
    Given Mock "fail=void"
    Then the label stays CURRENT and the shipment goes to EXCEPTION

  Scenario: Download of a voided label
    When the customer requests the voided label
    Then the response is 410 "DOCUMENT_VOIDED", no URL is issued and a DENIED audit entry exists

  Scenario: UI shows void
    Then the label is shown as "Void" with the download disabled in en/es/fr

  Scenario: Permission paths
    Then voiding is system-only (a customer route returns 404 "NOT_FOUND"); another organisation's voided label gives 404; unauthenticated 401

  Scenario: Audit
    Then the status change writes UPDATE on "document" with from and to status
```

### US-230 — Pickup confirmation document
- **Milestone:** M1 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-221, EPIC-12
- **Linked REQs:** REQ-DOC-003
- **As a** customer **I want** a pickup confirmation PDF **so that** I can show the driver the reference.

#### Acceptance criteria
```gherkin
Feature: Pickup confirmation document
  Scenario: Generated after scheduling
    Given a pickup scheduled for 2026-12-01 13:00 to 17:00 America/New_York with reference "MOCKPU-1"
    Then a PICKUP_CONFIRMATION PDF states the reference, date, local window with zone abbreviation "EST", address, contact and instructions

  Scenario: Reschedule creates version 2
    When the pickup is rescheduled
    Then version 2 is CURRENT and version 1 is SUPERSEDED

  Scenario: No pickup, no document
    Given collection mode DROP_OFF
    Then no pickup confirmation is generated

  Scenario: Permission paths
    Then download follows US-225 rules: 401 unauthenticated, 403 "AUTHZ_DENIED" without "document:download", 404 for other organisations
```

### US-231 — ZPL label output
- **Milestone:** M1 · **MoSCoW:** Could · **Size:** S · **Depends on:** US-222
- **Linked REQs:** REQ-DOC-015
- **As a** warehouse shipper **I want** a ZPL label **so that** I can print on a thermal printer.

#### Acceptance criteria
```gherkin
Feature: ZPL label
  Scenario: Offered when the carrier supports it
    Given capability labelFormats includes "ZPL"
    Then a ZPL document is stored and offered in the format selector

  Scenario: Not offered otherwise
    Given labelFormats lacks "ZPL"
    Then no ZPL option appears

  Scenario: Download rules apply
    Then download uses the audited pre-signed flow; unauthenticated gets 401, a role without "document:download" gets 403 "AUTHZ_DENIED", another organisation gets 404
```

## Coverage check

| REQ | Stories |
|---|---|
| REQ-DOC-001 | US-220 |
| REQ-DOC-002 | US-222 |
| REQ-DOC-003 | US-230 |
| REQ-DOC-004 | US-221 |
| REQ-DOC-005 | US-220 |
| REQ-DOC-006 | US-220 |
| REQ-DOC-007 | US-225 |
| REQ-DOC-008 | US-226 |
| REQ-DOC-009 | US-227 |
| REQ-DOC-010 | US-228 |
| REQ-DOC-011 | US-224 |
| REQ-DOC-012 | US-223 |
| REQ-DOC-013 | US-229 |
| REQ-DOC-014 | US-229 |
| REQ-DOC-015 | US-231 |
