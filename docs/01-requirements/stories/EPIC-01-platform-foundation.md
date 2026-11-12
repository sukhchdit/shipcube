# EPIC-01 — Platform foundation and local environment

- **Goal:** A developer or operator can clone the repository, run one command and get a healthy, observable, tested full stack whose cross-cutting conventions (errors, logging, jobs, outbox, config) are in place before any feature is built.
- **Milestone(s):** M0 (all stories)
- **REQ areas covered:** REQ-PLAT (REQ-PLAT-001 .. REQ-PLAT-022)
- **Exit-demo contribution:** PRD §6.1 Background ("single docker compose up, migrations and seeds have run"), "One mock booking flows API -> queue -> worker" (queues, idempotent jobs, outbox, correlation ID), "Generators pass" (CI running tests), health for the M0 smoke test.
- **Depends on epics:** EPIC-04 (audit entries for job and flag assertions), EPIC-16 (CI security scans, problem+json catalogue), EPIC-17 (seed content run by compose), EPIC-03 (tenant context in job payloads)

## Story summary
| ID | Title | MS | MoSCoW | Size | Depends on | Linked REQs |
|---|---|---|---|---|---|---|
| US-001 | Monorepo layout, layering lint, strict TypeScript and root scripts | M0 | Must | M | — | REQ-PLAT-001, REQ-PLAT-002, REQ-PLAT-003 |
| US-002 | Typed, validated configuration | M0 | Must | S | US-001 | REQ-PLAT-004 |
| US-003 | One-command local environment | M0 | Must | M | US-001, US-002, EPIC-17 | REQ-PLAT-005 |
| US-004 | Hardened multi-stage container images | M0 | Must | M | US-003 | REQ-PLAT-006 |
| US-005 | CI pipeline skeleton | M0 | Must | M | US-001, US-048 | REQ-PLAT-007 |
| US-006 | Coverage gate | M0 | Must | S | US-005 | REQ-PLAT-008 |
| US-007 | Central error handler and framework error mapping | M0 | Must | M | US-001 | REQ-PLAT-009, REQ-PLAT-010 |
| US-008 | Correlation ID and structured, redacted logging | M0 | Must | M | US-002 | REQ-PLAT-011, REQ-PLAT-012 |
| US-009 | Named queues with retries and dead-letter queue | M0 | Must | M | US-002, US-008 | REQ-PLAT-013 |
| US-010 | Idempotent job processing and scheduled jobs | M0 | Must | M | US-009 | REQ-PLAT-014, REQ-PLAT-015 |
| US-011 | Transactional outbox and at-least-once relay | M0 | Must | M | US-009, EPIC-03 | REQ-PLAT-016, REQ-PLAT-017 |
| US-012 | Liveness and readiness endpoints | M0 | Must | S | US-003 | REQ-PLAT-018 |
| US-013 | Telemetry seam and graceful shutdown | M0 | Should | S | US-008, US-009 | REQ-PLAT-019, REQ-PLAT-022 |
| US-014 | Feature-flag evaluation and audited changes | M0 | Should | M | EPIC-03, EPIC-04 | REQ-PLAT-020, REQ-PLAT-021 |

## Stories

### US-001 — Monorepo layout, layering lint, strict TypeScript and root scripts
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** —
- **Linked REQs:** REQ-PLAT-001, REQ-PLAT-002, REQ-PLAT-003
- **As a** developer **I want** a single workspace with enforced layering, strict typing and uniform root scripts **so that** every feature is built to the same boundaries and a failing check always fails the build.
- **Notes:** Script names are documented in CLAUDE.md §2 by the architect. `any` suppressions need an inline justification comment.

#### Acceptance criteria
Permission path: not applicable — build tooling with no principal; a second negative scenario is included.
```gherkin
Feature: Monorepo layout, layering lint, strict TypeScript and root scripts
  Scenario: Repository structure is complete
    Given a fresh clone
    When the repository-structure test runs
    Then apps/web, apps/admin, apps/api, apps/worker, packages/shared, packages/ui, packages/carriers, packages/pricing, packages/audit, packages/authz, packages/config, prisma, infra, tests and docs all exist
    And each folder under apps/api/src/modules/<module> contains routes, controller, service, repository, schemas, policies, events and tests

  Scenario: Missing folder fails the structure test
    Given the folder packages/authz is renamed
    When the repository-structure test runs
    Then it exits non-zero and names "packages/authz"

  Scenario Outline: Each layering rule is enforced by a seeded negative fixture
    Given a fixture file "<fixture>" that violates the rule "<rule>"
    When lint runs
    Then lint exits non-zero and reports "<rule>"
    Examples:
      | fixture                         | rule                                   |
      | controller imports a repository | controllers contain no business logic  |
      | service imports from express    | services import no Express types       |
      | service imports @prisma/client  | only repositories import Prisma        |

  Scenario: Root scripts fail on defects
    Given a type error is introduced in any workspace
    When "npm run typecheck" runs
    Then it exits non-zero
    And the scripts lint, format:check, test:unit, test:integration, test:e2e, test:coverage and build each exist at the root

  Scenario: Unjustified any suppression is rejected
    Given a source line with an any suppression and no justification comment
    When lint runs
    Then lint exits non-zero
```

### US-002 — Typed, validated configuration
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-001
- **Linked REQs:** REQ-PLAT-004
- **As a** developer **I want** all runtime configuration loaded and validated at start-up through one package **so that** a misconfigured process refuses to start and names exactly what is wrong.
- **Notes:** Applies to api, worker and build-time frontend config. Brand (`BRAND_*`), token lifetimes, rate limits, deadlines and feature defaults are config keys, never literals.

#### Acceptance criteria
Permission path: not applicable — process start-up with no principal; a second negative scenario is included.
```gherkin
Feature: Typed, validated configuration
  Scenario: Valid environment starts the process
    Given every required key is present and valid
    When the api process starts
    Then it reaches ready state and exposes typed config values from packages/config

  Scenario: Invalid and missing keys are all listed, names only
    Given DATABASE_URL is missing and ACCESS_TOKEN_TTL_SECONDS is "abc" and JWT_SECRET is "s3cr3t-value"
    When the api process starts
    Then it exits non-zero
    And stderr lists "DATABASE_URL" and "ACCESS_TOKEN_TTL_SECONDS"
    And no configured value appears in the output

  Scenario: Bcrypt cost below the floor is rejected
    Given BCRYPT_COST is 10
    When the api process starts
    Then it exits non-zero naming "BCRYPT_COST"

  Scenario: Worker and frontend builds use the same validation
    Given a required key is missing
    When the worker starts and when the web build runs
    Then both fail listing the missing key name
```

### US-003 — One-command local environment
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-001, US-002, EPIC-17
- **Linked REQs:** REQ-PLAT-005
- **As a** developer **I want** `docker compose up` to start the whole stack, migrate and seed **so that** I can demonstrate and test the product from a clean machine.
- **Notes:** Services: PostgreSQL, Redis, API, worker, web, admin, mail catcher, S3-compatible storage. Healthy within 180 s on a warm image cache (ASSUMED).

#### Acceptance criteria
Permission path: not applicable — local tooling with no principal; a second negative scenario is included.
```gherkin
Feature: One-command local environment
  Scenario: Cold start reaches healthy
    Given no containers or volumes exist and images are cached
    When "docker compose up" runs
    Then migrations are applied and the seed runs
    And all eight services report healthy within 180 s
    And GET /health/ready on the API returns 200

  Scenario: Second start is idempotent
    Given the stack has run once
    When "docker compose up" runs again
    Then row counts of seeded tables are unchanged

  Scenario: Reset returns to clean state
    When "docker compose down -v" runs and "docker compose up" runs
    Then seeded tables are re-created with the same natural keys

  Scenario: A failing migration stops the stack visibly
    Given a deliberately invalid migration
    When "docker compose up" runs
    Then the api service does not become healthy
    And the migration error is visible in the compose logs without secret values
```

### US-004 — Hardened multi-stage container images
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-003
- **Linked REQs:** REQ-PLAT-006
- **As an** operator **I want** every deployable built as a minimal, non-root, secret-free image **so that** the artefacts are safe to publish and run.
- **Notes:** Image digests pinned. Frontends are static assets served from a hardened Nginx image. Secret-pattern scan of image history is a CI step (US-048).

#### Acceptance criteria
Permission path: not applicable — build artefacts with no principal; a second negative scenario is included.
```gherkin
Feature: Hardened multi-stage container images
  Scenario: Images satisfy the hardening checks
    Given images for api, worker, web and admin are built
    When the image inspection test runs
    Then each image is multi-stage, has a HEALTHCHECK, runs as a non-root UID and uses a pinned base digest
    And web and admin images serve static assets from Nginx

  Scenario: A secret in a layer fails the build
    Given a Dockerfile that copies a file containing a secret-pattern value
    When the image-history scan runs
    Then the job fails and names the layer, not the value

  Scenario: Unpinned base image is rejected
    Given a Dockerfile with "FROM node:20" without a digest
    When the Dockerfile lint runs
    Then it exits non-zero

  Scenario: Container health check reflects state
    Given the api image is running with PostgreSQL unreachable
    When the container health check runs
    Then the container is reported unhealthy
```

### US-005 — CI pipeline skeleton
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-001, US-048
- **Linked REQs:** REQ-PLAT-007
- **As a** developer **I want** a GitHub Actions pipeline with all quality stages in a fixed order **so that** no change reaches `main` without passing every check.
- **Notes:** Order: install, lint and format check, type check, unit tests with coverage gate, integration tests with service containers, build, security scans, image build, SBOM, Terraform fmt/validate/Checkov. GHCR publish only from `main`/tag. No Terraform apply or AWS deploy; deploy and canary jobs exist disabled with a documented enabling condition.

#### Acceptance criteria
Permission path: not applicable — CI workflow; a second negative scenario is included.
```gherkin
Feature: CI pipeline skeleton
  Scenario: Green pipeline runs the stages in order
    Given a pull request with no defects
    When the workflow runs
    Then the stages execute in the documented order and the run succeeds

  Scenario: Any failing stage fails the run
    Given a unit test is made to fail
    When the workflow runs
    Then the run is red
    And the later stages (build, scans, image build) are skipped

  Scenario: Images are published only from main or tags
    Given a pull request run
    When the image stage completes
    Then no image is pushed to GHCR
    And on a push to main the images are pushed

  Scenario: No AWS deploy is possible
    When the workflow definition is linted
    Then it contains no terraform apply step and the deploy and canary jobs are disabled with an enabling-condition comment

  Scenario: Integration tests use service containers
    When the integration stage runs
    Then PostgreSQL and Redis service containers are started and the tests pass against them
```

### US-006 — Coverage gate
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-005
- **Linked REQs:** REQ-PLAT-008
- **As a** developer **I want** CI to fail when coverage is below target **so that** security-critical code stays thoroughly tested.
- **Notes:** Overall 85% lines / 75% branches; 95% for packages/pricing, ledger code, packages/audit, packages/authz. The ledger gate is configured but vacuous until M4.

#### Acceptance criteria
Permission path: not applicable — CI gate; a second negative scenario is included.
```gherkin
Feature: Coverage gate
  Scenario: Coverage at target passes
    Given overall coverage is 86% lines and 76% branches and each critical package is at least 95%
    When the coverage gate runs
    Then it passes

  Scenario Outline: Below-threshold coverage fails the gate
    Given coverage "<scope>" is "<value>"
    When the coverage gate runs
    Then it exits non-zero naming "<scope>"
    Examples:
      | scope            | value        |
      | overall lines    | 84.9%        |
      | overall branches | 74.9%        |
      | packages/audit   | 94.9% lines  |
      | packages/authz   | 94.9% lines  |
      | packages/pricing | 94.9% lines  |

  Scenario: Ledger gate is vacuous before M4
    Given packages/ledger does not exist
    When the coverage gate runs
    Then it does not fail on the missing package and logs that the ledger gate is inactive
```

### US-007 — Central error handler and framework error mapping
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-001
- **Linked REQs:** REQ-PLAT-009, REQ-PLAT-010
- **As a** frontend developer **I want** every failure returned as RFC 9457 problem+json with a stable code **so that** clients handle errors deterministically and nothing internal leaks.
- **Notes:** Code catalogue in DR-A26 (see US-036). 405 carries `Allow`.

#### Acceptance criteria
```gherkin
Feature: Central error handler and framework error mapping
  Scenario Outline: Framework failures map to stable codes
    When the client sends "<request>"
    Then the response is application/problem+json with status <status> and code "<code>"
    And the body contains type, title, status, detail, instance and correlation_id
    Examples:
      | request                                   | status | code                   |
      | GET /api/v1/does-not-exist                | 404    | NOT_FOUND              |
      | DELETE on a GET-only route                | 405    | METHOD_NOT_ALLOWED     |
      | POST with body "{bad json"                | 400    | MALFORMED_REQUEST      |
      | POST with a 2 MB body                     | 413    | PAYLOAD_TOO_LARGE      |
      | POST with Content-Type text/plain         | 415    | UNSUPPORTED_MEDIA_TYPE |
      | route handler throws an uncaught error    | 500    | INTERNAL_ERROR         |

  Scenario: 405 includes the Allow header
    When DELETE is sent to a route that supports only GET and HEAD
    Then the response header Allow is "GET, HEAD"

  Scenario: 5xx never leaks internals
    Given the repository throws a database error containing SQL text and a thrown string "secret-token-123"
    When the route is called
    Then the body detail is "An unexpected error occurred" and includes the correlation_id
    And the body contains no stack trace, SQL, file path or "secret-token-123"
    And the full error is present in the server logs

  Scenario: Unauthenticated caller still receives problem+json
    When an unauthenticated client requests an unknown route
    Then the response is 404 problem+json (permission path: no principal needed; same response for all callers)

  Scenario: Error response is not audited as a mutation
    When a 404 is returned for an unknown route
    Then no audit entry is written
```

### US-008 — Correlation ID and structured, redacted logging
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-002
- **Linked REQs:** REQ-PLAT-011, REQ-PLAT-012
- **As an** operator **I want** one correlation ID on every log line, audit entry, outbox event, job and carrier call, with secrets redacted **so that** I can trace a booking end to end without exposing sensitive data.
- **Notes:** Inbound pattern `^[A-Za-z0-9-]{8,64}$`. Request logs record method, route template, status, duration; never bodies. Emails masked to `a***@domain`.

#### Acceptance criteria
Permission path: not applicable — infrastructure behaviour valid for anonymous and authenticated callers alike; a second negative scenario is included.
```gherkin
Feature: Correlation ID and structured, redacted logging
  Scenario: Valid inbound correlation ID is echoed
    When a request carries "X-Correlation-Id: abc-12345678"
    Then the response header X-Correlation-Id is "abc-12345678"

  Scenario: Invalid inbound value is replaced
    When a request carries "X-Correlation-Id: bad id!"
    Then the response header is a newly generated UUID

  Scenario: One ID is visible end to end for the M0 booking
    Given a booking request with correlation ID "demo-booking-0001"
    When the booking completes through the worker
    Then the same ID appears in api logs, the audit entries, the outbox event, the job payload, the worker logs and the Mock carrier call

  Scenario: Redaction of sensitive keys
    Given a log call with keys password, token, authorization, cookie, set-cookie, secret, apiKey, totpCode, recoveryCode and cardNumber
    Then each logged value is "[REDACTED]"

  Scenario: Emails are masked and mandatory fields present
    When a log line contains "alice@example.com"
    Then it shows "a***@example.com"
    And every line has timestamp (UTC ISO 8601), level, message, service, version, correlation_id, org_id and actor_id

  Scenario: Request logs omit bodies
    When a POST with a JSON body is handled
    Then the request log has method, route template, status and duration and no body content
```

### US-009 — Named queues with retries and dead-letter queue
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-002, US-008
- **Linked REQs:** REQ-PLAT-013
- **As an** operator **I want** background work to retry transient failures and park permanent ones in a dead-letter queue **so that** nothing is silently lost.
- **Notes:** 5 attempts, exponential backoff from 2 s with jitter. Non-retryable: validation, missing tenant context, permission. Queue names are constants in packages/shared. Depth and failed counts exposed as metrics.

#### Acceptance criteria
Permission path: not applicable — worker infrastructure; a second negative scenario is included.
```gherkin
Feature: Named queues with retries and dead-letter queue
  Scenario: Transient failure is retried then succeeds
    Given a job that fails twice with a network error and then succeeds
    When the worker processes it
    Then it is attempted 3 times with delays of about 2 s and 4 s each with jitter
    And the job is completed

  Scenario: Exhausted retries go to the dead-letter queue
    Given a job that always fails with a transient error
    When the worker processes it
    Then it is attempted 5 times
    And a dead-letter record holds the redacted job data, the failure reason and attempt count 5

  Scenario Outline: Non-retryable errors skip retries
    Given a job failing with "<error>"
    When the worker processes it
    Then it is attempted once and moved to the dead-letter queue immediately
    Examples:
      | error                  |
      | validation error       |
      | missing tenant context |

  Scenario: Dead-letter data is redacted
    Given a failing job payload containing a field "token"
    Then the dead-letter record shows "[REDACTED]" for it

  Scenario: Queue metrics are exposed
    Then queue depth and failed count are available as metrics per named queue
```

### US-010 — Idempotent job processing and scheduled jobs
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-009
- **Linked REQs:** REQ-PLAT-014, REQ-PLAT-015
- **As an** operator **I want** duplicate job deliveries to have no second effect and scheduled jobs to fire once per interval across workers **so that** retries and scale-out are safe.
- **Notes:** Payload always carries `org_id`, `actor_id`, `correlation_id`, idempotency key. Scheduled jobs needed by audit chain verification (REQ-AUDIT-013), partition pre-creation (REQ-AUDIT-017) and outbox relay fallback.

#### Acceptance criteria
```gherkin
Feature: Idempotent job processing and scheduled jobs
  Scenario: Duplicate mock-booking job produces one shipment
    Given the M0 mock-booking job for shipment S1
    When the same job is delivered twice
    Then exactly one Mock carrier shipment exists for S1
    And exactly one audit entry for the booking transition exists

  Scenario: Job ID is deterministic
    When two enqueue calls use the same business key
    Then the queue holds one job

  Scenario: Payload without required context is rejected
    Given a job payload missing org_id
    When it is enqueued
    Then enqueue fails with a validation error and nothing is queued

  Scenario: Job without tenant context is dead-lettered at the worker
    Given a delivered job whose payload lacks actor_id
    Then it is moved to the dead-letter queue without retries

  Scenario: Scheduled job fires once with three workers
    Given three worker instances start simultaneously
    When one scheduling interval elapses
    Then the scheduled job runs exactly once

  Scenario: Re-registration at restart does not duplicate schedules
    When a worker restarts 5 times
    Then exactly one repeatable definition exists per scheduled job

  Scenario: Cross-tenant job data is not accessible
    Given a job for org A
    When processed by the worker
    Then database access is scoped to org A and cannot read org B rows
```

### US-011 — Transactional outbox and at-least-once relay
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** M · **Depends on:** US-009, EPIC-03
- **Linked REQs:** REQ-PLAT-016, REQ-PLAT-017
- **As a** developer **I want** domain events written atomically with state changes and relayed at least once in order **so that** consumers never miss or invent events.
- **Notes:** Event row: UUIDv7 event ID, type, aggregate type/ID, org_id, payload, correlation ID, created_at, published_at. Relay latency recorded as a metric.

#### Acceptance criteria
Permission path: not applicable — internal pipeline with no principal; a second negative scenario is included.
```gherkin
Feature: Transactional outbox and at-least-once relay
  Scenario: Event is committed with the change
    When an order status change commits
    Then one outbox row exists with event ID, type, aggregate, org_id, payload, correlation_id and created_at and published_at null

  Scenario: Rolled-back change leaves no event
    Given the state change transaction is forced to roll back
    Then no outbox row exists for it

  Scenario: Relay publishes in order per aggregate and marks after accept
    Given events E1, E2, E3 for aggregate A
    When the relay runs
    Then they are enqueued in creation order
    And published_at is set only after the queue accepted each

  Scenario: Crash between enqueue and mark creates a duplicate that is discarded
    Given the relay crashes after enqueueing E1 and before marking it
    When the relay restarts
    Then E1 is enqueued again
    And the consumer processes E1 once because it discards the duplicate by event ID

  Scenario: Queue unavailable keeps events pending
    Given Redis is unreachable
    When the relay runs
    Then events remain unpublished and are retried, and none is lost

  Scenario: Relay latency metric
    Then commit-to-enqueue latency is recorded as a metric
```

### US-012 — Liveness and readiness endpoints
- **Milestone:** M0 · **MoSCoW:** Must · **Size:** S · **Depends on:** US-003
- **Linked REQs:** REQ-PLAT-018
- **As an** operator **I want** liveness and readiness probes on the API and worker **so that** orchestration and smoke tests know when the service is usable.
- **Notes:** Outside `/api/v1`, not audited (descriptor `NONE`, "health probe"). 2 s timeout per dependency. No versions, hostnames or secrets in bodies.

#### Acceptance criteria
```gherkin
Feature: Liveness and readiness endpoints
  Scenario: Healthy stack
    When GET /health/live and GET /health/ready are called without authentication
    Then both return 200
    And ready lists postgres, redis and object-storage as "up"

  Scenario Outline: A dependency outage makes readiness fail
    Given "<dependency>" is unreachable
    When GET /health/ready is called
    Then the response is 503 and "<dependency>" is "down" while others report their own status
    And GET /health/live still returns 200
    Examples:
      | dependency     |
      | postgres       |
      | redis          |
      | object-storage |

  Scenario: Slow dependency is bounded
    Given PostgreSQL does not answer
    Then GET /health/ready responds within 2.5 s

  Scenario: Audit status is degraded, not failing
    Given the next audit partition is missing
    When GET /health/ready is called
    Then the status is 200 and component "audit" is "degraded"

  Scenario: No sensitive content (unauthenticated caller allowed by design)
    Then the body contains no version number, hostname or secret
    And no audit entry is written
```

### US-013 — Telemetry seam and graceful shutdown
- **Milestone:** M0 · **MoSCoW:** Should · **Size:** S · **Depends on:** US-008, US-009
- **Linked REQs:** REQ-PLAT-019, REQ-PLAT-022
- **As an** operator **I want** optional OpenTelemetry tracing and metrics, and clean shutdown on SIGTERM **so that** I can diagnose production and deploy without dropping work.
- **Notes:** Telemetry disabled by default locally; exporter endpoint is config. Spans carry no personal data or secrets.

#### Acceptance criteria
Permission path: not applicable — process-level behaviour; a second negative scenario is included.
```gherkin
Feature: Telemetry seam and graceful shutdown
  Scenario: Enabled telemetry creates linked spans
    Given OTEL is enabled with a test exporter
    When a request enqueues a job that the worker processes
    Then spans exist for the inbound request, the Prisma query, enqueue, process and an outbound HTTP call under one trace ID

  Scenario: RED metrics per route template
    When /api/v1/shipments/{id} is called 3 times with one 500
    Then request rate 3, error rate 1 and duration are recorded for that route template, not the concrete path

  Scenario: Disabled by default
    Given OTEL is not enabled
    Then no exporter connection is attempted

  Scenario: Span attributes contain no personal data
    When spans are exported for a login request
    Then no attribute contains an email, password or token

  Scenario: SIGTERM drains and exits 0
    Given a request taking 5 s is in flight
    When SIGTERM is sent
    Then new requests are refused, the in-flight request completes and the process exits with code 0

  Scenario: Long job returns to the queue
    Given an active job running longer than 30 s
    When SIGTERM is sent
    Then after 30 s the process exits and the job is re-delivered and handled once
```

### US-014 — Feature-flag evaluation and audited changes
- **Milestone:** M0 · **MoSCoW:** Should · **Size:** M · **Depends on:** EPIC-03, EPIC-04
- **Linked REQs:** REQ-PLAT-020, REQ-PLAT-021
- **As an** operator **I want** database-backed flags evaluated per environment and organisation, with audited changes **so that** features can be toggled safely.
- **Notes:** Resolution order DR-A28: org override, else environment value, else registered default. Cache at most 30 s. Admin screen is M4; change is API/seed only. Percentage targeting not required.

#### Acceptance criteria
```gherkin
Feature: Feature-flag evaluation and audited changes
  Scenario: Organisation override wins
    Given flag "x" is false for the environment and true for org A
    When org A user calls GET /api/v1/feature-flags
    Then "x" is true
    And an org B user sees false

  Scenario: Unknown flag returns default and warns once
    When code evaluates unknown key "nope" 3 times within an hour
    Then it returns false each time and exactly one warning is logged

  Scenario: Cache window
    Given flag "x" was evaluated and then changed
    Then new evaluations within 30 s may use the cached value and after 30 s use the new value

  Scenario: Unauthenticated read is refused
    When GET /api/v1/feature-flags is called without a token
    Then the response is 401 AUTH_REQUIRED

  Scenario: Change requires featureflag:manage
    When a user without featureflag:manage updates a flag
    Then the response is 403 AUTHZ_DENIED and a PERMISSION_DENIED audit entry with outcome DENIED is written

  Scenario: Audit of a flag change
    When a Super Admin changes flag "x" from false to true
    Then one CONFIG_CHANGE audit entry holds before and after values, the actor and outcome SUCCESS in the same transaction
```

## Coverage check
| REQ | Stories |
|---|---|
| REQ-PLAT-001 | US-001 |
| REQ-PLAT-002 | US-001 |
| REQ-PLAT-003 | US-001 |
| REQ-PLAT-004 | US-002 |
| REQ-PLAT-005 | US-003 |
| REQ-PLAT-006 | US-004 |
| REQ-PLAT-007 | US-005 |
| REQ-PLAT-008 | US-006 |
| REQ-PLAT-009 | US-007 |
| REQ-PLAT-010 | US-007 |
| REQ-PLAT-011 | US-008 |
| REQ-PLAT-012 | US-008 |
| REQ-PLAT-013 | US-009 |
| REQ-PLAT-014 | US-010 |
| REQ-PLAT-015 | US-010 |
| REQ-PLAT-016 | US-011 |
| REQ-PLAT-017 | US-011 |
| REQ-PLAT-018 | US-012 |
| REQ-PLAT-019 | US-013 |
| REQ-PLAT-020 | US-014 |
| REQ-PLAT-021 | US-014 |
| REQ-PLAT-022 | US-013 |
