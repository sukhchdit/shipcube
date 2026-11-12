# ADR-0018: Typed configuration (`packages/config`) and secrets handling

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.1 (`packages/config`), §4.11, §13 rule 7; CLAUDE.md §5 (secrets), §9; REQ-PLAT-004, REQ-SEC-011, REQ-CARR-015, REQ-PAY-004, REQ-DATA-002; NFR-OPS-005, NFR-SEC-007; D-022

## Decision

1. **One schema, three consumers.** `packages/config` exports a Joi schema (backend convention) of every runtime variable with type, default, `required` per environment, `secret: true` flag, and documentation; `loadConfig(env)` validates at process start and aborts with the list of **names** of missing/invalid keys (never values) within 5 s (REQ-PLAT-004, NFR-OPS-005). Frontend build-time config (`VITE_*`: API base URL, Stripe publishable key, brand, locales, feature flags endpoint) is a Zod schema in the same package (`config/web`) consumed by Vite's `define` — only non-secret keys are allowed by a test.
2. **Namespaces.** `APP_*` (env, port, base URLs, brand `BRAND_*`), `DB_*` (URL for `platform_app`, migrator URL used only by the migrate job, pool size, `sslmode`), `REDIS_*`, `AUTH_*` (token lifetimes, bcrypt cost ≥ 12 floor, cookie names, CSRF), `AUDIT_*` (verification schedule, partition horizon), `RATE_LIMIT_*`, `CARRIER_*` (per account: enabled, environment, `SECRET_REF`), `PAYMENT_*` (`STRIPE_SECRET_KEY_REF`, webhook secret ref, test-live flag), `STORAGE_*` (S3 endpoint, buckets, path style, presign TTL 300), `MAIL_*` (provider `smtp|ses`, host, from), `OTEL_*`, `FEATURE_*`, `SEED_*` (demo passwords, local-only defaults), `REGION` (brief §10 multi-region seam), `LOCALE_DEFAULT`.
3. **Secrets.** Code holds **references** (`*_REF`), resolved at start by a `SecretProvider`: `env` (local/CI: the reference is the variable name holding the value), `aws-secrets-manager` (ARN/name; cached; rotation-aware). Secret values live only in process memory; Pino redacts by key; `.env.example` lists every key with placeholders; a CI script compares `.env.example` with the schema (0 undocumented keys, 0 secret-looking example values) and Gitleaks scans history and diffs (REQ-SEC-011). Production start-up fails if a secret equals its placeholder, if a Stripe key is live-mode (`PAYMENT_LIVE_KEY_FORBIDDEN`), if `NODE_ENV=production` and the Mock carrier/gateway is enabled, or if DB/Redis TLS is disabled outside local (NFR-SEC-007).
4. **Environment matrix.** `local` (compose defaults, Secure cookie relaxed on localhost, Mock enabled, Swagger on), `test` (CI), `staging`, `production` (Swagger off unless configured, Mock disabled, `sslmode=verify-full`). `NODE_ENV` ∈ {development, test, production}; `APP_ENV` carries the finer environment.
5. **Feature flags** are **not** config: DB-backed with Redis cache (ADR-0027); config holds only the flag defaults file path.
6. **Configuration over hard-coding** (brief DoD): token lifetimes, rate limits, deadlines, retry/breaker values, polling intervals, limits (packages, addresses, saved cards), brand strings are schema keys with defaults equal to the REQ values; a lint rule flags magic numbers in services for these concerns (advisory).

## Alternatives considered

- **Zod for the backend schema.** Fixed stack says Joi on the backend; one Joi schema with a generated TypeScript type (`Joi.ObjectSchema` + hand-maintained interface checked by a test) keeps the rule.
- **dotenv-vault / SOPS.** Encrypted env files in repo are still secrets at rest in git; Secrets Manager references satisfy the guardrail.
- **Reading secrets lazily per call.** Simpler start-up but delays failures to runtime; fail-fast start is required (NFR-OPS-005).

## Consequences

- Positive: fail-fast start with actionable names; no secret in code, tests, fixtures or images; environment differences are explicit.
- Negative: adding a variable means schema + `.env.example` + docs (test-enforced).

## Reversibility

High.
