# ADR-0011: Third-party carrier account rules and the partner connection flow (seam for M3)

- **Status:** Accepted (design seam; build is M3 — EPIC-B-302)
- **Date:** 2026-11-12 (sources checked on this date)
- **Deciders:** principal-architect
- **Related:** brief §2.2, §4.3 ("Third-party account rules"), §7; BACKLOG.md EPIC-B-302; ADR-0010; REQ-CARR-015 (secret handling)

## Context

Brief §4.3 requires, before partner account connection is built, checking each carrier's programme rules for platforms that ship on other companies' accounts and recording the outcome in an ADR, and designing the connection so that either "customer enters credentials" or "customer authorises via OAuth" works per carrier. The build is M3, but the data model and the `CarrierContext` must accommodate it now.

## Findings (verified 2026-11-12; URLs below)

| Carrier | Programme for third-party platforms | How a partner's own account is used | Connection flow implied | Sources (checked 2026-11-12) |
|---|---|---|---|---|
| **UPS** | **UPS Ready** programme for vendors/solution providers: accept the UPS Ready License Agreement, pass integration testing/certification at an independent lab (fee), produce labels, not open-source (vendor application form). Separate from end-user API access. | **OAuth 2.0 Authorization Code** flow ("OAuth Authorization Code API" v1.0): the UPS customer logs in at UPS, authorises the app; the app never sees credentials; tokens: `GET /security/v1/oauth/authorize` (`client_id`, `redirect_uri`, `response_type=code`, `state`, optional PKCE `code_challenge`), `POST /security/v1/oauth/token` (`grant_type=authorization_code`, Basic client auth), `POST /security/v1/oauth/refresh` (`grant_type=refresh_token`); servers `https://wwwcie.ups.com/security` / `https://onlinetools.ups.com/security`. Client-credentials flow is for the platform's own accounts. | **OAuth authorise** (preferred, no credential storage) with refresh tokens stored envelope-encrypted; fallback "enter account number" is not sufficient alone because API calls are authorised by the app's token, not by the account number. | github.com/UPS-API/api-documentation (`OAuthAuthCode.yaml`, `OAuthClientCredentials.yaml`); ups.com/forms/e-mail/ready_partner (UPS Ready minimum criteria); third-party integrator notes (goshippo.com, docs.sorted.com) |
| **FedEx** | **FedEx Compatible** programme (certified providers, contractual agreement via a Channel/Partner Development Manager) and the **Integrator Program** (validation via PIW submission + Validation Cover Sheet, test cases, label and brand validation). Developer-portal project types distinguish "Compatible Provider" and "Integrator Provider". Portal note: an Integrator must use its **own** FedEx account number and cannot use a customer's account for project setup; production keys are issued after FedEx review. | OAuth `POST /oauth/token` with `grant_type=csp_credentials` ("FedEx Internal, Compatible and Integrator customers") carrying the provider's `client_id`/`client_secret` **plus the customer's child credentials** (`child_key`/`child_secret`, naming inconsistent in the docs: `child_id`/`child_secret` in the parameter list); `client_pc_credentials` for proprietary parent–child accounts; token lifetime 3600 s. | **Credentials entry** of the customer's child key/secret (issued by FedEx to the customer for the provider's app) once the Platform is an approved Compatible/Integrator provider; no customer-facing OAuth redirect flow exists. | developer.fedex.com/api/en-us/catalog/authorization/v1/docs.html; developer.fedex.com/api/en-us/get-started/integrator-provider.html; fedex.com/en-ca/compatible/become-a-provider.html |
| **DHL Express** | No public partner/integrator programme page found. MyDHL API access requires an **active DHL Express customer account**; test credentials from the developer portal; production API key and access granted after validation by the DHL Express team / account manager. Terms page: "Specific terms for the use of and access to the DHL Express – MyDHL API" (content not machine-readable today). | HTTP Basic with the API key/secret issued to an account holder plus the account number(s) (shipper, payer, duties). A partner would supply **its own** API key/secret and account number. | **Credentials entry** (API key, API secret, account number(s)); "Test connection" = `GET /address-validate` or `/rates` on the test base URL. Confirm with DHL account management whether a platform may store customer-issued keys under the API terms before M3. | developer.dhl.com/express; help.shipengine.com (connection requirements: account number, API key, API secret); viya.me MyDHLAPI onboarding notes |

## Decision

1. **Connection modes per carrier** (data, not code branches): `carrier_accounts.connection_mode ∈ {OAUTH_AUTHORIZATION_CODE, CREDENTIALS}`; `carriers.supported_connection_modes` seeded: UPS `[OAUTH_AUTHORIZATION_CODE, CREDENTIALS]` (credentials mode only for platform-owned accounts), FedEx `[CREDENTIALS]` (child key/secret under CSP grant), DHL Express `[CREDENTIALS]`, Mock `[CREDENTIALS]`.
2. **Account ownership**: `carrier_accounts.owner_type ∈ {PLATFORM, PARTNER}`, `owner_org_id` (NULL for platform). `CarrierContext.account` carries `{ id, carrierCode, ownerType, ownerOrgId, environment }` from M0 so routing to partner accounts (M3) needs no interface change.
3. **Credential storage seam**: platform accounts reference Secrets Manager/env by name (`credential_secret_ref`); partner-supplied credentials and OAuth refresh tokens (M3) are **envelope-encrypted with a per-tenant KMS data key** (`carrier_account_credentials(account_id, ciphertext, data_key_ciphertext, kms_key_id, version)`), write-only after save (never returned by any API), never logged. The `SecretResolver` port (ADR-0010) resolves both sources.
4. **OAuth authorization-code seam**: `carrier_oauth_states(state, org_id, carrier, pkce_verifier_hash, redirect_uri, expires_at)` and a callback route `GET /api/v1/carriers/oauth/{carrier}/callback` are defined in the M3 contract, not in this run's OpenAPI.
5. **Programme prerequisites are operator actions**, tracked as M3 pre-conditions in BACKLOG EPIC-B-302: UPS Ready application and certification; FedEx Compatible/Integrator approval; DHL terms confirmation. Until approved, partner connections for that carrier are disabled by a per-carrier feature flag (`carrier.partner_connect.<code>`).
6. **Metering seam** (brief §2.2): every carrier call records `(account_id, org_id, operation, outcome)` in a `carrier_usage` counter table/metric from M1 so partner fees can be computed later.

## Consequences

- Positive: M3 needs no change to `CarrierContext`, adapters or RLS; programme risk is surfaced early to the operator.
- Negative: UPS OAuth means hosting a redirect callback and refresh-token lifecycle in M3; FedEx child credentials still require storing customer secrets (envelope encryption mandatory).
- Verification (M3): connection-mode matrix tests; encryption write-only tests; OAuth state/PKCE tests.

## Reversibility

High (data-driven modes).
