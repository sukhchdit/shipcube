# NFR strategy — every NFR → mechanism → ADR/design → verification approach

Version 1.0 · 2026-11-12 · owner principal-architect · Draft for G2. Source of targets: `docs/01-requirements/NFR.md` v1.3 (91 NFRs, including NFR-RES-007 added by D-048 and traced here since 2026-11-12, G2-C1; targets are not restated here, only the mechanism that meets them and how it is verified). Run status (FULL/PARTIAL/DEFERRED) is NFR.md's. qa-lead attaches concrete test IDs in P4 (`nfr-traceability.md` Test column).

## Performance efficiency (NFR-PERF)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| PERF-001 | Stateless Express 5 API; one `withTenantTx` per request; indexes per named access pattern; Redis caches (authz 5 s, flags 30 s); keyset pagination; Pino async logging; no per-request external calls on non-carrier routes; `/health`,`/metrics` excluded | ADR-0003, ADR-0005, ADR-0016, data-model.md indexes | k6 `steady` mixed workload on compose (2 api replicas) with thresholds; **gate at 100 rps in the local heavy lane on the developer host** (spec recorded with every result; ADR-0023 amendment E, D-ORCH-001), hosted 2-vCPU k6 smoke reported only; 300 rps attempted in P6 with host CPU recorded (PARTIAL) |
| PERF-002 | Parallel fan-out starts immediately; SSE emits each carrier's priced result as it arrives; Mock `fast` profile; pricing is pure in-memory | ADR-0010 §rate shopping, ADR-0015 | k6 SSE scenario measuring `time_to_first_result` p95 |
| PERF-003 | Per-carrier deadline 4 s, overall 5 s, `complete` event with per-carrier status; late results discarded; Redis rate cache 300 s (costs only) | ADR-0010, DR-B15/B16 | k6 SSE scenarios `fast+hung`, `slow+flaky`, all `hung`; cache-hit `time_to_done` check |
| PERF-004 | Checkout returns 202 after persisting intent (no carrier call in request); outbox relay 500 ms; worker saga steps on `booking` queue; Mock latency | ADR-0004, ADR-0013, ADR-0014 | k6 booking scenario at 5/s; timestamps from `STATE_TRANSITION` audit entries; zero stuck in BOOKING |
| PERF-005 | Public tracking reads stored `tracking_events`/shipment status only (polling is in the worker); Luhn pre-check rejects bad order numbers without a query; index on tracking number / order number | ADR-0009, ADR-0010, data-model.md | k6 `steady` at 50 rps with limit raised by config |
| PERF-006 | Composite indexes leading with `org_id`, partial `deleted_at IS NULL`, keyset cursors; query-plan registry test (`EXPLAIN` no Seq Scan > 10k rows); Prisma query counter asserting ≤ 12 queries and no N+1 (explicit `include`/batched loads) | ADR-0016 §5, data-model.md §3 | Integration tests with seeded 100k/1M rows; build-time test that every list endpoint has a registry entry; k6 list scenario |
| PERF-007 | Same as PERF-001 plus heap monitoring (`process_resident_memory_bytes`), connection pool sizing, graceful backpressure (bulkheads) | ADR-0017, platform.md | k6 ramp/steady/spike/soak scripts in `tests/load`; soak in the local heavy lane `gate` profile (weekly cadence during P5, platform.md OI-12), evidence under `docs/05-quality/performance/` (PARTIAL) |

## Scalability (NFR-SCALE)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| SCALE-001 | Horizontal scaling only (replica count + config); no in-process state; Redis-shared counters/caches; outbox + idempotent consumers | ADR-0003, ADR-0004, ADR-0013 | Same images at 1× (1 api/1 worker) and 10× load with 2+ replicas; capacity note (PARTIAL) |
| SCALE-002 | Sessions/revocation/rate limits/authz cache in Redis; BullMQ job IDs + `job_executions`/`processed_events` dedupe; deterministic saga keys; compose `edge` proxy for scale-out | ADR-0006, ADR-0013, ADR-0014, platform.md §2 | `docker compose --scale api=2 --scale worker=2` suite run; kill one api under load; duplicate-effect audit over 1 000 bookings |
| SCALE-003 | prom-client gauges (CPU via process metrics, request count, queue depth per queue) → ADOT → CloudWatch; Terraform ECS service autoscaling policies (ALB RequestCountPerTarget, CPU, custom queue depth) | ADR-0017, ADR-0022, platform.md §5 | Metrics scrape test in CI; `terraform validate` + Checkov; observed scaling DEFERRED to M5 |

## Availability and recovery (NFR-AVAIL, NFR-REC)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| AVAIL-001 | Multi-AZ ECS/RDS/Redis, canary deploys with alarm rollback, SLI/SLO definitions and burn-rate alert rules as code | ADR-0022, ADR-0017 §6, platform.md §8 | SLO document + alert rules reviewed; live measurement DEFERRED |
| AVAIL-002 | `/health/live` process-only; `/health/ready` checks PG/Redis/object storage ≤ 2 s each, audit degraded component; SIGTERM → stop accepting, drain ≤ 30 s (api) / `worker.close()` (worker); stalled-job re-delivery | ADR-0013 §7, ADR-0017 §5 | Stop/start dependencies and poll readiness; SIGTERM during k6; 100 slow jobs + SIGTERM → completed or re-queued exactly once |
| AVAIL-003 | Expand → migrate → contract; migration linter (TS script) forbidding DROP/RENAME/ADD NOT NULL without default in the same release; previous image against new schema under probe load | data-model.md §8, ADR-0023 | CI job: previous release image + migrated schema + k6 20 rps probe; linter in CI |
| REC-001 | RDS PITR (5-min RPO) + cross-region snapshot copy (AWS Backup); outbox/audit durability in PG | platform.md §10 | Rehearsal reports observed loss window on compose (informational); RDS drill DEFERRED |
| REC-002 | Restore runbook (DB restore, bucket restore, DNS/app cut-over) | platform.md §10/§12 | Measured compose restore ≤ 15 min; real RTO drill DEFERRED |
| REC-003 | `pg_dump`/`pg_restore` + object storage bucket copy into a fresh stack; verification script: row counts, FK validity, audit chain verify, document SHA-256 re-hash; runs weekly in CI and before data-changing migrations | ADR-0021 §3, ADR-0007, platform.md §10 | CI job exit 0 with archived report |

## Web performance (NFR-WEB)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| WEB-001 | Pre-rendered public HTML per locale (no JS needed for LCP element), system font stack with no web fonts (D-UX-001), AVIF/WebP with dimensions, critical CSS small (Tailwind purge), initial public JS ≤ 170 kB gz (D-035), CloudFront/Nginx compression | ADR-0026, ADR-0002 | Lighthouse CI mobile/slow-4G on every public route in en/es/fr |
| WEB-002 | Route-level code splitting, no long tasks on public routes (quote widget logic lazy), `motion` used sparingly, web-vitals probe | ADR-0026 | Playwright interactions with `web-vitals` on throttled CPU + Lighthouse TBT (PARTIAL: field INP later) |
| WEB-003 | Reserved dimensions for images/cards/skeletons; results list uses fixed-height skeletons replaced in place; system fonts (no swap shift) | ADR-0026 §6 | Lighthouse CLS + Playwright `PerformanceObserver` on streaming results |
| WEB-004 | `size-limit` budgets per entry/chunk; separate apps (no cross-bundle imports, lint); lazy routes native to framework mode | ADR-0002 §4, ADR-0026 §10 | `size-limit` in CI; manifest test (one chunk per route, no admin code in web) |
| WEB-005 | React Router `prerender` output with `<title>`, meta, canonical, `hreflang`; Nginx/CloudFront `Cache-Control: immutable` for hashed assets, `no-cache` HTML, brotli/gzip; image pipeline budget | ADR-0002, ADR-0026, platform.md §3 | `curl` assertions on pre-rendered HTML; header test on Nginx image; Lighthouse Performance/SEO; image-size check |

## Accessibility (NFR-A11Y)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| A11Y-001 | `packages/ui` built on Radix primitives; WCAG 2.2 criteria mapped to components (focus not obscured: sticky bars reserve space; no drag-only interactions; target sizes; wizard autosave avoids redundant entry; password fields allow paste + `autocomplete`); `lang` per locale | ADR-0026 §3 | Axe in CI + qa-lead manual checklist + screen-reader spot checks (PARTIAL: no third-party audit) |
| A11Y-002 | Shared Playwright fixture runs axe after every navigation; route inventory test; six states rendered via `ScreenState` so each state is reachable in tests | ADR-0024, ADR-0026 | 0 serious/critical axe findings across routes × states × themes |
| A11Y-003 | Keyboard-first components; skip link; 2 px focus ring token ≥ 3:1; sticky header/action bar offsets (`scroll-padding`, `scroll-margin`) | ADR-0026 | Keyboard-only Playwright specs; Tab-sweep with `elementFromPoint` |
| A11Y-004 | Token-driven control heights (36 px pointer / 44 px coarse); reflow to cards at 360 px; `scrollWidth` guard | ADR-0026 §3 | Playwright at 360/390 touch emulation + 320 px sweep |
| A11Y-005 | Token pairs defined for light/dark; contrast unit test over every pair | `packages/ui` tokens | Unit test computing contrast for all fg/bg pairs; axe `color-contrast` |
| A11Y-006 | `prefers-reduced-motion` honoured by tokens (`--motion-duration: 0ms`) and `useReducedMotion`; hover only under `@media (hover: hover)` (stylelint) | ADR-0026, ADR-0002 §5 | Playwright `reducedMotion: 'reduce'` sampling; stylelint rule |

## Security (NFR-SEC)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| SEC-001 | Threat model with ASVS 4.0.3 L2 chapter mapping; controls across ADR-0005/6/7/16/18; AWS-dependent items deferred | threat-model.md §9 | security-analyst checklist at P6 (PARTIAL) |
| SEC-002 | Semgrep (custom rules), Gitleaks (history + PR), `npm audit --omit=dev --audit-level=high`, Trivy image/fs, ZAP baseline vs compose; waivers logged | ADR-0023, ADR-0024 | CI gates; 0 Critical/High |
| SEC-003 | bcrypt cost 12 floor; constant-time dummy compare for unknown users; identical 202/401 bodies; offline breached list | ADR-0006 | Hash prefix unit test; response/timing comparison over 200 samples |
| SEC-004 | Token lifetimes/lockout/MFA parameters as config defaults (D-024, DR-A01/A02); family revocation; staff gate; 30-day absolute cap with `auth_time` and step-up (`x-reauth-scope`/`x-reauth-max-age`), CVC recollection on stale saved-card checkout, admin 30-min sliding refresh with input-only idle tracking, staff first-enrolment e-mail code and 24 h deadline (SEC-P3-01/11/14) | ADR-0006 am. 12–14, ADR-0012 am. 1, ADR-0026 am. 8 | Fake-clock API tests for every boundary (SEC-TC-37/38/39/56); cookie attribute assertions; matrix test for the staff gate |
| SEC-005 | `express-rate-limit` + `rate-limit-redis` with route classes; per-IP and per-account keys; trusted-proxy hop count; in-memory fallback for auth on Redis outage | ADR-0016 §8 | Supertest limit+1 per class; run against 2 replicas |
| SEC-006 | Helmet on API; hash-based CSP for static apps (nonce impossible on static HTML) with exact Stripe hosts; CSP report endpoint; HSTS outside local | ADR-0016 §11, ADR-0026 §9 | Playwright header assertions + `securitypolicyviolation` listener; ZAP |
| SEC-007 | Config rejects non-TLS DB/Redis outside local; ACM TLS 1.2+ policy on ALB/CloudFront; `sslmode=verify-full`; TLS to ElastiCache | ADR-0018 §3, platform.md §9 | Config unit test; Checkov on listener policies; handshake tests at M5 (PARTIAL) |
| SEC-008 | Origin allow-list + `X-CSRF-Token` + SameSite=Strict on cookie routes; exact-origin CORS with credentials, preflight 600 s | ADR-0006 §CSRF, ADR-0016 §11 | Cross-origin Supertest/Playwright attempts; build-time enumeration of cookie routes |
| SEC-009 | Joi `allowUnknown:false` from route metadata; 1 MB body limit; one problem+json handler with generic 5xx detail | ADR-0016 §3/§4 | Build-time strict-schema test; fast-check fuzz; leakage grep test |
| SEC-010 | Single `OutboundHttpClient`: https-only, host allow-list, post-resolution private-range block with pinning, redirect re-validation, timeout, size cap; lint bans other HTTP clients | ADR-0016 §13 | Unit/integration tests with local malicious server + DNS stubs; lint negative fixture |
| SEC-011 | RLS 404 for foreign IDs; `WITH CHECK`; Joi unknown-field rejection incl. server-controlled fields; permission catalogue + matrix; generated abuse suite from route metadata | ADR-0005, ADR-0008, ADR-0016 | Generated IDOR/mass-assignment suite + RBAC matrix; `PERMISSION_DENIED` audit assertions |
| SEC-012 | Licence allow-list + equivalents and tool register (D-ARCH-003 rev 2); 18-month rule for direct and flagged transitive deps; advisory checks; `npm ci --ignore-scripts` with a rebuild allow-list, 7-day release cooldown (`DEP_MIN_AGE_DAYS`, Dependabot `cooldown`), lockfile source/integrity check and `npm audit signatures` (SEC-P3-04/22); justification in task reports | ADR-0001, ADR-0023 am. F | `license-checker`-style script + registry age script + audit; SEC-TC-45 fixture package with `postinstall` marker |
| SEC-013 | Payment Element only (no PAN fields; `CARD_DATA_NOT_ACCEPTED`); Stripe signature verification with 300 s tolerance and event-ID dedupe; pre-signed URLs 300 s after permission + audit; 256-bit share/guest tokens | ADR-0012, ADR-0021, ADR-0005 | E2E PAN scanner on bodies/logs; webhook signature/tolerance/replay tests; download TTL + audit tests |

## Privacy (NFR-PRIV)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| PRIV-001 | Pino redaction paths generated from the classification registry + fixed secret keys; e-mail masking; request logs without bodies | ADR-0017 §1 | Sentinel unit tests on every logger path; e2e log grep |
| PRIV-002 | `[REDACTED]` for SECRET before hashing; PERSONAL values tokenised to the vault; classification tag on every audited field | ADR-0007 | Audit tests with sentinel secrets per entity; classification coverage test |
| PRIV-003 | Classification registry in `packages/audit` mapped to Prisma schema; build-time completeness test | ADR-0007, data-model.md | Schema-introspection test: 0 unclassified columns in tenant tables |
| PRIV-004 | Public tracking/shared quote projections with field allow-lists (DR-B31); notification log stores IDs/status only | ADR-0020 §5, api/openapi.yaml `PublicTracking` | Contract + snapshot tests on public endpoints; notification log inspection |
| PRIV-005 | `consent_records` written for every banner decision; retention periods recorded per data category in compliance packs | ADR-0027 (flags), data-model.md compliance | API tests for consent; seed test for retention fields on 5 packs (PARTIAL: enforcement M4/M5) |

## Audit (NFR-AUDIT)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| AUDIT-001 | Middleware from route metadata; same-transaction insert; fail-closed sensitive reads | ADR-0007, ADR-0003 | Audit generator per route; fault injection (audit insert fails → rollback / view fails) |
| AUDIT-002 | `platform_app` INSERT/SELECT only; BEFORE UPDATE/DELETE and TRUNCATE triggers for all roles; monthly partitions current+3 by daily job; no default partition; audit objects owned by `platform_audit_owner` (NOLOGIN, migrator not a member); identity-based DDL event trigger (`pg_event_trigger_ddl_commands`/`dropped_objects`); audit DDL only in the bootstrap lane with a linter marker (SEC-P3-03) | ADR-0007 am. 7, data-model.md §4.4/§5.2 | Role-by-role mutation attempts incl. `platform_migrator` and dynamic SQL (SEC-TC-43); catalog privilege assertions; partition job test |
| AUDIT-003 | Per-stream SHA-256 chain with advisory lock; hourly checkpoint + ECDSA P-256 signed anchor (`anchor_seq`, `prev_anchor_hash`) appended to a mandatory external sink; verifier fails on `ANCHOR_MISSING`/`CHECKPOINT_SIGNATURE_INVALID`; hourly incremental + nightly full verification; metrics/security event on break (SEC-P3-03) | ADR-0007 am. 7, data-model.md §5.5/§5.6 | Canonicalisation unit test; corruption-detection integration test; anchor tamper and deletion test with public-key-only verifier (SEC-TC-44); 1 M-row timing run |
| AUDIT-004 | `defineRoute` refuses incomplete routes; build-time registry ↔ OpenAPI test | ADR-0003 | Build-time test; operation count equality |
| AUDIT-005 | Diff + hash computed in-process; per-stream (not global) lock; batched vault inserts; indexes; audit disabled only in a benchmark build flag | ADR-0007; risks.md SPK-04 | k6 A/B audit on/off delta |
| AUDIT-006 | Column set per REQ-AUDIT-003 with NOT NULL where applicable; event list (LOGIN, LOGOUT, LOGIN_FAILED, PERMISSION_DENIED, ACCOUNT_LOCKED, TOKEN_REUSE_DETECTED, API_KEY_USE, CONFIG_CHANGE) emitted by allow-listed callers | ADR-0007, ADR-0006 | JSON-Schema validation per event type; viewer filter tests |
| AUDIT-007 | `AuditArchiver` interface + `archived_at` marker; manifest format defined; export to S3 Object Lock compliance mode at M5 | ADR-0007 §archive, platform.md §4 | Verifier tested against RustFS without Object Lock; real Object Lock DEFERRED |

## Tenant isolation (NFR-TENANT)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| TENANT-001 | `org_id` + forced RLS with tenant/operator/guest branches and `WITH CHECK`; `set_config` per transaction; `platform_app` without BYPASSRLS; composite indexes lead with `org_id` | ADR-0005, data-model.md §4 | Catalog test (RLS enabled/forced/policy/index); generated cross-tenant tests via repositories and raw SQL; unset-context test |
| TENANT-002 | Permission catalogue + roles seed + route metadata → generated matrix (allow/deny, 401, cross-tenant 404) | ADR-0008 | Matrix generator in CI; combination count reported |

## Internationalisation and compatibility (NFR-I18N, NFR-COMPAT)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| I18N-001 | `eslint-plugin-i18next/no-literal-string`; all strings via keys; pseudo-locale build | ADR-0002 §5, ADR-0026 | Lint at error level; rendered-output scan in pseudo-locale run |
| I18N-002 | Resource files en/es/fr + e-mail template sets; parity script (keys, placeholders, plurals) | ADR-0020 §3, ADR-0026 | CI parity script |
| I18N-003 | Logical CSS only (stylelint-use-logical); layouts tolerate +30 % (tokens, wrapping); 360 px overflow checks | ADR-0026, ADR-0002 §5 | Playwright overflow/visual checks in es/fr/pseudo-locale; stylelint |
| I18N-004 | `packages/shared/format` Intl helpers (numbers, dates with zone, currencies by ISO code, units); lint bans `toFixed`/`toLocaleString` outside helpers | ADR-0009, ADR-0026 §2 | Lint rule + helper unit tests across locales/currencies |
| COMPAT-001 | `browserslist` matrix; Playwright engines + device descriptors | ADR-0026 §11 | browserslist check; Playwright projects (PARTIAL: previous majors/real devices manual) |
| COMPAT-002 | Playwright projects 3 engines × 2 viewport classes; critical journeys as e2e specs | ADR-0024 | CI e2e matrix green with ≤ 1 retry |
| COMPAT-003 | Breakpoints 360/768/1024/1280/1536 in tokens; tables → cards on small screens (`packages/ui` DataTable) | ADR-0026 | Viewport sweep asserting no horizontal scroll/overlap |

## Resilience (NFR-RES)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| RES-001 | `AbortSignal.timeout` per operation (rates 4 s, create 20 s, track 10 s, cancel 10 s, pickup 15 s, gateway 10 s, token 5 s — DR-B32 values, D-ARCH-004); lint requires timeout on the client factory | ADR-0010, ADR-0016 §13 | nock delays / Mock `hung`; lint negative fixture |
| RES-002 | Retry wrapper: idempotent ops only, max 2 retries, base 200 ms ×2, full jitter, retried statuses; never `createShipment`/`schedulePickup` | ADR-0010 | nock sequences with seeded RNG asserting attempts/delays |
| RES-003 | opossum breaker per account (50 %/20 calls min 10 or 5 consecutive; half-open 30 s); two bulkheads per account (`rates` 6, `transactional` 4) so saga and tracking never queue behind rate shopping; anonymous share ≤ 50 % plus a global anonymous token bucket; daily quota guard (40 % reserve, alarms at 70/90 %); `CARRIER_BUSY` retryable and non-ambiguous in the saga; subscribe-only SSE with 2/IP and 5/user stream caps (SEC-P3-02); fail-fast ≤ 50 ms | ADR-0010 am. 1–6, ADR-0014 am. 3 | Mock `error`/`hung` state-transition tests; k6 with one hung carrier vs baseline; guest flood vs 20 bookings (SEC-TC-40); quota guard (SEC-TC-41); stream reopen = 0 carrier calls (SEC-TC-42) |
| RES-004 | BullMQ attempts 5, exponential from 2 s + jitter, DLQ per queue, deterministic job IDs, `job_executions` idempotency; AOF Redis | ADR-0013 | kill -9 worker / restart Redis tests; permanent-failure → DLQ after 5 |
| RES-005 | Idempotency-Key store with fingerprint and replay; saga step keys; client reference persisted before carrier call; compensations; sweeper | ADR-0014 | `Promise.all` concurrency tests; generated saga fault matrix |
| RES-006 | Fan-out `allSettled` with per-carrier status; UI notice per unavailable carrier (i18n); booking on an open breaker → stable error, no charge | ADR-0010, ADR-0026 §6 | Playwright with Mock `error`/`hung` in en/es/fr; API `complete` status assertions |
| RES-007 | Anonymous-flood isolation of paid bookings and carrier quotas (D-048, SEC-P3-02/29): the `transactional` bulkhead (4) is never shared with rate shopping, so saga `createShipment` calls never wait behind guests; guests are bounded by the anonymous share (≤ 50 % of the `rates` pool) and the global anonymous bucket per account (`CARRIER_ANON_CALLS_PER_MIN=120`, Redis, all replicas) and receive `carrier_error {code: CARRIER_BUSY}` or DR-B15 cached results inside the 5 s deadline; `CARRIER_BUSY`/quota rejections are `LOCAL_REJECT` (no network I/O) and the saga retries them with backoff inside its 30-minute deadline, never moving a shipment to `DRAFT`/`EXCEPTION`; the daily quota guard stops anonymous fan-out at (100 − `CARRIER_QUOTA_RESERVE_PCT=40`) = 60 % and everything but transactional calls at 90 %, emitting `carrier_quota_pressure` exactly once per threshold per day; `streamQuoteResults` is subscribe-only (0 carrier calls on reopen). Users in `PENDING_VERIFICATION` count as anonymous for all of the above; verified users are bounded by the `quote-create` class (30/min, 300/h per user; 1,000/h per organisation) and each organisation by `CARRIER_QUOTA_ORG_SHARE_PCT=10` % of an account's daily quota (`carrier_quota_org_share_exhausted`), so one account cannot drain a carrier for everyone (SEC-P3-29) | ADR-0010 am. 1–6 and 10, ADR-0014 am. 3, ADR-0016 am. 9 and 11; api/README.md §7 | k6 anonymous flood (≥ 50 source IPs at the per-IP limit, Mock `latency=3000`) concurrent with 20 authenticated bookings: 100 % `BOOKED`, 0 `DRAFT`/`EXCEPTION` (SEC-TC-40); quota-guard thresholds and single-fire alarms with `CARRIER_DAILY_QUOTA=500` (SEC-TC-41); stream reopen = 0 carrier calls (SEC-TC-42); unverified account throttled as anonymous, verified account 429 after 30/min, one organisation cannot exceed its 10 % share while another's quotes still fan out (SEC-TC-62) |

## Observability (NFR-OBS)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| OBS-001 | Pino JSON with `correlation_id`, `org_id`/`none`, `actor_id`/`system`/`anonymous`, service, version; `X-Correlation-Id` echo | ADR-0017 §1–2 | JSON-Schema validation of all captured lines in e2e; header ↔ log match |
| OBS-002 | prom-client RED per route template + queue metrics; cardinality guard | ADR-0017 §3 | `/metrics` scrape after exercising all routes vs route metadata; series-count test |
| OBS-003 | OTel SDK with auto-instrumentations; manual spans for BullMQ with `trace_context` in payloads; compose `observability` profile | ADR-0017 §4, ADR-0004 §7 | In-memory exporter test asserting one trace ID across API → queue → worker → carrier for a Mock booking |
| OBS-004 | Metric/log catalogue, SLI definitions, burn-rate alert rules and dashboards as code (Terraform CloudWatch module), runbook skeletons | ADR-0017 §6, platform.md §8/§12 | Documents reviewed; live dashboards/alerts DEFERRED |

## Quality and testing (NFR-QUAL)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| QUAL-001 | Jest `coverageThreshold` 85/75 merged across workspaces; coverage diff check on PR | ADR-0024 | CI coverage gate |
| QUAL-002 | Per-path thresholds 95/95 for `packages/pricing`, `packages/audit`, `packages/authz` (ledger when it exists) | ADR-0024 | CI coverage gate per path |
| QUAL-003 | fast-check properties (≥ 1 000 cases) for pricing invariants; Stryker ≥ 80 % | ADR-0015 §6, ADR-0024 | Stryker in the local heavy lane `gate` profile and in P6 (`docs/05-quality/performance/runs/…/stryker-summary.json`); property tests in the unit suite on every PR |
| QUAL-004 | Route metadata carries `tests` classes/`n/a` justifications; Supertest helper validates responses against OpenAPI (Ajv) | ADR-0016, ADR-0024 | Build-time completeness test; API suite |
| QUAL-005 | Shared contract suite × Mock/DHL/FedEx/UPS fixtures; README fields test; opt-in live sandbox | ADR-0010 | Jest contract suite; docs check |
| QUAL-006 | Deterministic fixtures (Mock scenarios, seeded data), Testcontainers isolation, Playwright retries ≤ 1, flake report script | ADR-0024 | Playwright report aggregation over last 20 CI runs |

## Operability (NFR-OPS)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| OPS-001 | Compose with health checks and `depends_on` conditions; one-shot migrate+seed job; idempotent seeds; `down -v` clean | platform.md §2, ADR-0002 | CI `docker compose up -d --wait` from clean checkout + smoke sign-in/quote; timer |
| OPS-002 | Multi-stage Dockerfiles, `node:24-trixie-slim` and `nginx-unprivileged` pinned by digest, non-root, HEALTHCHECK, `npm ci --omit=dev --ignore-scripts` followed by the allow-listed `npm run deps:rebuild` (ADR-0023 am. F, SEC-P3-04), no secrets in layers; separate migrate image | platform.md §3, ADR-0022 | Trivy + hadolint + Dockerfile assertions; `docker history` + Gitleaks; size checks |
| OPS-003 | Workflows `ci.yml` (hosted PR fast lane + `workflow_dispatch` full lane), `nightly.yml` (dispatch-only), `release.yml`, `cd.yml` with all §10 stages; heavy suites run locally with evidence under `docs/05-quality/` (ADR-0023 amendment, D-ORCH-001); deploy jobs no-op until targets exist; SBOM + GHCR publish | ADR-0023 (amendment A–D), ADR-0024 amendment, platform.md §7 | actionlint + stage-presence test (dispatch-only stages count as present); `quality:check-evidence` on every PR; fast-lane wall-clock ≤ 20 min measured; release dry-run on pre-release tag; pull-and-start from GHCR |
| OPS-004 | Terraform modules + overlays; `fmt -check`, `validate -backend=false`, Checkov with reasoned suppressions; tagging standard | ADR-0022, platform.md §6 | CI IaC job (PARTIAL: plan/apply M5) |
| OPS-005 | `packages/config` Joi schema; fail-fast with names only; `.env.example` parity script | ADR-0018 | Config unit tests; start-with-missing-var CI test; parity script |

## Maintainability and data (NFR-MAINT, NFR-DATA)

| NFR | Mechanism | ADR / design | Verification approach |
|---|---|---|---|
| MAINT-001 | `eslint-plugin-boundaries` + `import-x/no-cycle` rules for layering, package purity and app isolation; negative fixtures | ADR-0002 §5, ADR-0003 | Lint in CI + fixture rule tests |
| MAINT-002 | TS strict family in `tsconfig.base.json`; `tsc -b --noEmit`; `--max-warnings 0`; `no-explicit-any` error; suppression-count script | ADR-0001, ADR-0002 | CI typecheck/lint; script counts |
| MAINT-003 | Shared constants/regex/enums in `packages/shared`; parity test over ≥ 50 fixtures per schema (address, parcel, customs item); lint bans redefinition | ADR-0016 §4, ADR-0026 §4 | Parity test in `packages/shared` |
| MAINT-004 | Contract-first OpenAPI; Redocly lint; drift test vs route registry; `oasdiff` vs previous tag; examples required | ADR-0016 §1, api/README.md | CI contract job |
| DATA-001 | `Money` branded type, integer minor units, `BIGINT`+`CHAR(3)` columns, FX as `NUMERIC(18,6)`/strings; lint bans float ops on money | ADR-0009 | Lint; schema column-type test; pricing property tests |
| DATA-002 | UUIDv7 app + DB default; `timestamptz` only; local dates as `date` + IANA zone | ADR-0009, data-model.md | Schema introspection test; DST unit tests |
| DATA-003 | Standard columns via Prisma extension; partial unique indexes `deleted_at IS NULL`; no `DELETE` grant; version-conditional updates → 409/412 | ADR-0009, ADR-0005, data-model.md | Schema test; repository code scan for DELETE; concurrent-update API tests |
| DATA-004 | Prisma migrations with raw SQL; up→down→up on empty and seeded DB with schema diff; migration linter; backup + restore rehearsal before data-changing migrations | data-model.md §8, ADR-0023 | Testcontainers CI job; linter; rehearsal job |

## Deferred/partial items — what M5 must add
Carried verbatim from NFR.md "Partially verifiable this run"; the designs above provide the mechanism now and `platform.md` §10–§11 the M5 work (AWS apply, canary drill, DR drill, SLO measurement, Object Lock archive, TLS handshake tests, third-party a11y audit, field INP).
