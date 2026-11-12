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

## Amendment after the P3 security review (2026-11-12, `docs/05-quality/security/P3-architecture-security-review.md` SEC-P3-08; threat-model T-89, R-11, R-16, R-22, T-103; D-ARCH-022)

1. **Key and secret register (SEC-P3-08 item 1).** One key per purpose; the config schema rejects identical values across any two key-type secrets and any symmetric key shorter than 32 bytes. Every key variable holds `<key_id>:<base64>` with `key_id = <purpose>-v<n>`; an optional `<NAME>_PREVIOUS` holds the retired key for dual reads during rotation. **Every ciphertext and HMAC lookup value is stored with its `key_id`** (sibling `<col>_key_id` column, data-model.md §10.4), so reads are dual during rotation and writes use the current key. **AES-256-GCM** uses a 96-bit random nonce, a 128-bit tag and **AAD = table ‖ column ‖ row id or token ‖ key_id**, which stops ciphertext swapping between rows (T-89). At M5 symmetric keys become KMS envelope keys (`GenerateDataKey`, DEK cached ≤ 5 min; `kms:Decrypt` per task role) and the anchor signing key a non-exportable KMS asymmetric key.

   | Key / secret | Algorithm · purpose | Holder | Storage (local → M5) | Rotation cadence · method | Blast radius if leaked |
   |---|---|---|---|---|---|
   | `JWT_SIGNING_KEYS` | ES256 key pair set (two `kid`s) · access tokens | API signs; API + worker verify (public part only) | env ref → Secrets Manager | 90 d · add new `kid`, publish public key, switch issuer after 15 min, retire old after 15 min | forge access tokens ≤ 15 min; revocation set still applies |
   | `CSRF_KEY` | HMAC-SHA-256 · CSRF token | API | env ref → Secrets Manager | 180 d · dual verify 24 h | CSRF on refresh/logout only (Origin and SameSite still hold) |
   | `RECOVERY_KEY` | HMAC-SHA-256 · recovery-code lookup | API | env ref → Secrets Manager | on demand · `key_id` per code row; retired key kept until all codes under it are consumed or regenerated | offline guessing of recovery codes (≈ 50 bits each) |
   | `MFA_ENCRYPTION_KEY` | AES-256-GCM · TOTP secrets | API | env ref → KMS envelope | 1 y · re-encrypt job by `key_id` | TOTP secrets of all users (with DB access) |
   | `AUDIT_VAULT_KEY` | AES-256-GCM · `audit_pii_vault.ciphertext` (AAD uses the token) | API (write), worker viewer/erasure | env ref → KMS envelope | 1 y · re-encrypt job | personal data in audit values |
   | `AUDIT_INDEX_KEY` | HMAC-SHA-256 · `ip_hash` | API, worker | env ref → Secrets Manager | 1 y · new rows under new `key_id`; IP filters query both ids for 90 d | re-identification of hashed IPs |
   | `AUDIT_ANCHOR_SIGNING_KEY` | ECDSA P-256 private · anchor signatures (ADR-0007 am. 7) | **worker only** (`Sign`); API and third parties verify with `AUDIT_ANCHOR_PUBLIC_KEYS` | key file → KMS `ECC_NIST_P256`, non-exportable | 1 y · new `key_id`; **old public keys kept forever** (anchors are permanent) | forge future anchors (past anchors in the locked sink remain valid evidence) |
   | `TRACKING_INDEX_KEY` | HMAC-SHA-256 · `tracking_index` | API, worker | env ref → Secrets Manager | 1 y · dual compute | brute-force of tracking numbers from the index |
   | `OUTBOX_PAYLOAD_KEY` | AES-256-GCM · `token_enc` in outbox payloads | API (encrypt), worker (decrypt) | env ref → KMS envelope | 90 d · dual read 7 d | one-time e-mail tokens in flight (≤ hours) |
   | `IDEMPOTENCY_BODY_KEY` | AES-256-GCM · stored responses (AAD uses `scope_hash`) | API | env ref → KMS envelope | 90 d · dual read 24 h | replay bodies (≤ 24 h) |
   | `CURSOR_KEY` | HMAC-SHA-256 · pagination cursors | API | env ref → Secrets Manager | 30 d · dual verify 1 h | forged cursors (still RLS-bound) |
   | `LOGIN_COUNTER_KEY` | HMAC-SHA-256 · `auth:fail:<hash>` identifiers | API | env ref → Secrets Manager | 30 d · counters live ≤ 15 min, no dual | linking lockout counters to identifiers |
   | `CARRIER_TOKEN_CACHE_KEY` | AES-256-GCM · carrier OAuth tokens in Redis (AAD = `carrier_token ‖ account_id ‖ key_id`) | API, worker | env ref → KMS envelope | 90 d · dual read 1 h | carrier sandbox tokens (≤ 1 h) |
   | `IDENTIFIER_ENCRYPTION_KEY` | AES-256-GCM · `shipment_party_identifiers.value_ciphertext` and `organisation_tax_references` (AAD uses the row id) | API (write, masked read), worker (invoice render only) | env ref → KMS envelope | 1 y · re-encrypt job by `key_id` | tax and identity references of all parties (with DB access) |
   | `AUDIT_VAULT_HMAC_KEY` | HMAC-SHA-256 · `audit_pii_vault.value_hmac` dedupe index | API, worker | env ref → Secrets Manager | 1 y · dual compute by `key_id` | equality oracle on vault values (no plaintext) |
   | `MFA_CHALLENGE_BIND_KEY` | HMAC-SHA-256 · IP-prefix binding of `mfa_challenges` | API | env ref → Secrets Manager | 90 d · challenges live 5 min, no dual | none alone (challenge token still required) |
   | `MFA_ENROLMENT_CODE_KEY` | HMAC-SHA-256 · `mfa_enrolment_codes` lookup (ADR-0006 am. 14) | API | env ref → Secrets Manager | 90 d · codes live 10 min, no dual | offline guessing of 6-digit codes (attempt counter still applies) |
   | `PASSWORD_PEPPER` | HMAC-SHA-256 · bcrypt pre-hash (reserved; adopted by the SEC-P3-16 backlog item, `user_credentials.pepper_key_id`) | API | env ref → Secrets Manager | on demand · re-hash at next login | none alone (bcrypt still applies) |
   | `MOCK_GATEWAY_WEBHOOK_SECRET` | HMAC-SHA-256 · Mock gateway webhooks | API | env ref; **non-production only** | per environment | forged mock payments outside production only |
   | `STRIPE_SECRET_KEY_REF` | restricted `rk_test_` key (ADR-0012 am. 2) | API, worker | env ref → Secrets Manager | roll in the Stripe dashboard, update the reference | test-mode payment operations within the restricted permissions |
   | `STRIPE_WEBHOOK_SECRET_REF` | HMAC-SHA-256 · one per webhook endpoint and environment | API | env ref → Secrets Manager | roll per endpoint | forged webhooks (processor still retrieves the PaymentIntent) |
   | `CARRIER_<ACCOUNT>_SECRET_REF` | carrier credentials (sandbox) | API, worker via `SecretResolver` | env ref → Secrets Manager (partner accounts: per-tenant KMS, ADR-0011) | per carrier portal | sandbox account abuse / quota (SEC-P3-02 guard) |
   | `DB_URL`, `DB_MIGRATOR_URL`, bootstrap credential | PostgreSQL logins `platform_app`, `platform_migrator`, cluster admin | API/worker; migrate job; bootstrap step only | env ref → Secrets Manager (RDS master = break-glass, ADR-0007 am. 7) | 90 d (RDS rotation at M5) | data access within the role's RLS/ownership limits |
   | `REDIS_URL` (per service) | Valkey ACL users `api`, `worker` with key-prefix limits (ADR-0013 am. 4) | each service its own | `compose.env` local-only → ElastiCache RBAC | 90 d | queue/cache tampering limited to the user's prefixes |
   | `STORAGE_*_KEY_REF`, `MAIL_*` | S3-compatible and SMTP credentials | API, worker | local-only → IAM task role (no static keys) / SES | n/a at M5 (roles) | object or mail access |

2. **Stripe and carrier secrets in CI (item 3).** They are **environment secrets** of the GitHub Environment `carrier-sandbox` (branch policy `main` only; `workflow_dispatch`), consumed only by the `contract-live` job; a lane A policy test fails any `pull_request`/`push` job that references that environment or `secrets.CARRIER_*`/`secrets.STRIPE_*` (ADR-0023 amendment H).
3. **Refusals widen (items 5–6; amends §3).** Placeholder and `local-only-*` values are refused when `APP_ENV ∈ {staging, production}` (was production only). The schema refuses `NODE_DEBUG`, `DEBUG` and `NODE_OPTIONS` containing `--inspect*` outside `local`; nodemailer runs with `logger: false, debug: false` and the AWS SDK logger is unset (R-22).
4. **Developer host (item 7).** Sandbox and Stripe test credentials live only in user-scoped environment variables or a git-ignored `.env.local`; they never enter `compose*.yaml` or `compose.env` (which hold only `local-only-*` values). `npm run hooks:install` (in-house Node script, no new dependency) installs a pre-commit hook that runs Gitleaks in its pinned container on staged files (NFR-SEC-002). Verification: SEC-TC-49, SEC-TC-50, SEC-TC-51.

## Reversibility

High.
