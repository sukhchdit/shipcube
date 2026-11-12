# ADR-0017: Observability — Pino structured logs, OpenTelemetry traces, RED metrics, correlation IDs

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §3.3 (Pino), §9 (observability row), §4.13; REQ-PLAT-011/012/018/019; NFR-OBS-001..004, NFR-PRIV-001, NFR-AVAIL-002; platform.md §8

## Decision

1. **Logs.** Pino 10 JSON to stdout, one line per event: `time` (ISO UTC), `level`, `msg`, `service`, `version`, `env`, `correlation_id`, `org_id` (`none` when absent), `actor_id` (`system`/`anonymous`), `trace_id`/`span_id` when tracing is on. `pino-http` request logs: method, route **template**, status, duration — never bodies. Redaction paths generated from the audit classification registry (ADR-0007) plus fixed keys: `password`, `*.token`, `authorization`, `cookie`, `set-cookie`, `secret`, `api_key`, `totp`, `recovery_code`, card/payment fields, carrier credentials; emails masked to `a***@domain` (REQ-PLAT-012). Local dev: `pino-pretty` only via the dev script (never in images). A JSON Schema validates every captured line in e2e (NFR-OBS-001).
2. **Correlation.** `X-Correlation-Id` per ADR-0016 #15, carried in `AsyncLocalStorage` request context, job payloads, outbox rows, audit entries and outbound headers (`X-Correlation-Id`, plus carrier-specific `transId`/`Message-Reference`).
3. **Metrics.** `prom-client` 15 `/metrics` on api and worker (internal network only; not under `/api/v1`; descriptor `NONE`): RED per route template (`http_requests_total{method,route,status_class}`, `http_request_duration_seconds` histogram), queue gauges (waiting/active/failed/dead per queue), outbox relay lag, carrier call histograms + breaker state per account, audit write duration, chain verification result, rate-limit hits, security events counters. Cardinality guard: route templates only (no IDs), test fails > 1 000 series per metric (NFR-OBS-002). In AWS the ADOT collector scrapes `/metrics` and exports to CloudWatch EMF (platform.md).
4. **Traces.** OpenTelemetry SDK for Node (`@opentelemetry/sdk-node` + auto-instrumentations for http/express/pg/ioredis/undici) enabled by `OTEL_ENABLED=true` (REQ-PLAT-019, Should); spans: inbound HTTP, Prisma/pg queries, BullMQ enqueue/process (manual spans with context propagated in job payload `trace_context`), outbound carrier/gateway calls, saga steps. Span attributes exclude personal data and secrets (allow-list of attributes). Exporter OTLP to a collector; Compose `observability` profile runs otel-collector + Jaeger + Prometheus + Grafana; CI uses the in-memory exporter to assert the parent–child chain for a Mock booking (NFR-OBS-003).
5. **Health.** `/health/live` (process up) and `/health/ready` (Postgres, Redis, object storage ≤ 2 s each; audit partition horizon and chain status as *degraded*; outbox relay lag > 60 s degraded) on api and worker; no versions/hostnames in bodies (REQ-PLAT-018).
6. **SLIs/SLOs and alerts (design now, live at M5 — NFR-OBS-004 DEFERRED).** SLIs: availability = non-5xx / total (excluding health), latency = share of requests under budget per class, booking success, carrier availability per account. SLO 99.9 % monthly; multi-window burn-rate alerts (14.4× over 1 h, 6× over 6 h) defined as code (`infra/modules/cloudwatch/alarms.tf` + Prometheus rules for local); each alert maps to a runbook (platform.md §12). These alarms are the ROLLBACK_TRIGGERS of the CD pipeline (ADR-0023).
7. **Security events** (REQ-SEC-012): structured log lines `event_type: 'security'`, `event: <catalogue name>`, counters `security_events_total{event}`; catalogue in `api/README.md`.
8. **Audit vs logs.** Logs are operational and ephemeral (retention 30 d local / per CloudWatch group); the audit trail (ADR-0007) is the compliance record. Nothing in logs is needed to reconstruct audited actions.

## Alternatives considered

- **Winston.** Resolved by brief §3.3 in favour of Pino.
- **Vendor APM agents.** Not in the stack; OpenTelemetry keeps the exporter swappable (CloudWatch/X-Ray now, anything OTLP later).
- **Always-on tracing in local dev.** Off by default to keep `docker compose up` light; profile opt-in.

## Consequences

- Positive: one correlation ID end to end; metrics drive autoscaling and rollback; traces explain carrier latency.
- Negative: OTel SDK is still 0.x (API churn) — pinned; redaction lists must be maintained with the classification registry (test enforces).

## Reversibility

High.
