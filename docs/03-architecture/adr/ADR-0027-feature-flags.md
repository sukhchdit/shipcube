# ADR-0027: Feature flags — database-backed, Redis-cached, audited

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.13 (feature flags), §13 rule 5 (no silent stubs); REQ-PLAT-020/021, DR-A28; A-056; BACKLOG EPIC-B-411 (admin UI, M4)

## Decision

1. **Model.** `feature_flags(key PK, description, default_value bool, kind BOOLEAN, created_by, ...)` and `feature_flag_overrides(flag_key, scope ENVIRONMENT|ORGANISATION, scope_id, value bool, percentage int NULL)` (GLOBAL tables; percentage targeting is Could and not evaluated in M1 — the column exists, evaluation returns the boolean). Resolution per DR-A28: organisation override → environment value → registered default; unknown key → configured default (`false`) with one warning per key per hour.
2. **Evaluation.** `FeatureFlagService.isEnabled(key, { orgId })` in `admin-settings`; Redis cache `flags:<env>` (whole flag set, TTL 30 s) so evaluation is a local lookup; invalidated on change. Typed flag keys live in `packages/shared/flags.ts` (`as const`), each with a **tracked task ID** when it guards unfinished work (brief §13 rule 5).
3. **API.** `GET /api/v1/feature-flags` (authenticated; evaluated for the active org) consumed by web/admin at start and refreshed every 60 s; `GET|POST /admin/feature-flags`, `PATCH /admin/feature-flags/{key}` require `featureflag:manage` and are audited `CONFIG_CHANGE` with before/after values (REQ-PLAT-021). Seed defines initial flags.
4. **Initial flags.** `quote.share_links`, `quote.compare`, `account.privacy_self_service`, `tracking.carrier_push`, `pickup.service_points_list`, `analytics.events` (no-op in M1), `carrier.partner_connect.<code>` (M3 gates).

## Alternatives considered

- **Config-file flags.** No per-organisation targeting or audit; rejected.
- **LaunchDarkly/Unleash.** Paid or additional service; $0 budget and brief says "simple database-backed".

## Consequences

Positive: audited, targetable, cheap. Negative: 30 s propagation; no UI until M4 (API/seed only).

## Reversibility

High.
