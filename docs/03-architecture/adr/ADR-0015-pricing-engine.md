# ADR-0015: Pure pricing engine (`packages/pricing`) and pricing configuration as versioned seed

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect
- **Related:** brief §4.4; REQ-PRICE-001..021, REQ-COMP-005, DR-B05..B13; D-010, D-019, D-034; A-059..A-066; NFR-QUAL-002/003, NFR-DATA-001; ADR-0009 (money)

## Context

`packages/pricing` must be pure and deterministic (no I/O), take carrier cost quotes plus configuration and return itemised charge lines, totals and a machine-readable explanation; booked prices are immutable snapshots. M1 scope (D-010): billable weight, live-carrier cost source, margin/discount rules with precedence, fuel surcharge + carrier pass-through surcharges, protection cover, coupons/discounts with stacking rules, tax from the compliance pack, FX snapshot. Rate-card cost source and operator-configured surcharges are M2 (input model carries the discriminators).

## Decision

1. **API**: `price(input: PricingInput): PricingResult` where
   - `PricingInput = { request: { lane, contentType, packages[g,mm], shipDate, residential, customerSegment?, orgId?, emailDomain?, couponCodes[] }, carrierQuote: { carrierCode, accountId, serviceCode, cost: Money, costCurrency, surcharges[{code, amount, includedInBase}], transitDays, fuelIncluded }, config: PricingConfigSnapshot, fx: FxSnapshot[], tax: ResolvedTaxRule, cover?: { declaredValue: Money, additional: boolean }, now: ISO }` — everything the engine needs is passed in; the `pricing` **module** (not the package) loads config/FX/tax (REQ-COMP-005).
   - `PricingResult = { lines: ChargeLine[] (code, label key, amount, taxAmount, taxCode, source LIVE|CONFIG|PASS_THROUGH|INFO), totals { net, tax, gross }, sellCurrency, fx { from, to, rate, at, source, stale }, billableWeight { perPackage[], total }, explanation: RuleTrace[] (rule ids fired, candidates considered, precedence reason, floor applied, discount set chosen, warnings e.g. FX_STALE, PRICE_FLOOR_APPLIED), configVersion }`.
2. **Evaluation order** (DR-B07): FX-convert base cost → select **one** margin rule (DR-B08 precedence: priority, specificity order service > account > carrier > lane both > destination > origin > segment > content type > weight band > date range, later effective-from, lowest key; seeded default priority −1000) → discounts (DR-B09: stackable sum vs best non-stackable, larger wins, capped at base) → price floor (DR-B10) → fuel on discounted base when not carrier-included → pass-through surcharges at converted cost → optional cover (percentage, min charge, max insurable) → tax per line (DR-B12; inclusive/exclusive display mode from the pack) → totals (DR-B11 rounding: per line, half away from zero, totals never re-rounded; FX rounded once). Included cover is an informational zero line.
3. **Billable weight** (DR-B05/B06) is computed in `packages/shared/units` and passed in; the engine re-validates that it is integer grams.
4. **Configuration as versioned seed** (D-010): `pricing_config_versions(version, effective_from, source)` with child tables `margin_rules`, `discounts` (email domain, org, coupon, volume tier; stackable flag; date bounds), `coupons`, `surcharge_rules` (fuel % by date range; M2 adds remote/peak/residential/oversize), `cover_terms`; the module materialises a `PricingConfigSnapshot` (cached in memory per version, invalidated on seed). Each quote option stores `configVersion` and the full `PricingResult` as the immutable **price snapshot** (`quote_options.price_snapshot jsonb`), copied to the shipment at booking (REQ-PRICE-019/020); rule changes never alter a booked price.
5. **Cost source discriminator**: `carrierQuote.source ∈ { LIVE, RATE_CARD }`; `RATE_CARD` inputs are accepted by the type and rejected at runtime with `COST_SOURCE_NOT_SUPPORTED` until M2 (explicit, no silent stub). Zones tables exist empty (REQ-DATA-017).
6. **Testing**: ≥ 95 % line/branch coverage (NFR-QUAL-002); property tests with `fast-check` (≥ 1 000 cases): determinism, integer minor units, Σ lines = totals, rounding conservation, floor never undercuts cost unless allowed, snapshot immutability; Stryker mutation score ≥ 80 % (NFR-QUAL-003); golden-file tests for the seeded configuration on the US→IN lane; a lint rule forbids any import from `node:*`, `axios`, Prisma or Redis inside the package (NFR-MAINT-001).
7. **Seeded defaults** (A-060/A-061/A-062/A-064): default margin 15 %, volume tiers at 10/50 shipments per 30 days, tax of the origin country, best-value score 0.6 price + 0.4 transit (computed in `quotes`, not in the engine).

## Alternatives considered

- **Rules engine library (json-rules-engine, etc.).** Generic matching but opaque precedence; the brief needs an explicit, explainable precedence and property testing — a typed in-house evaluator is smaller and auditable.
- **Pricing inside the quotes service with DB access.** Breaks purity and testability.
- **Floating-point percentages.** Rejected; percentages are basis points (`bps` integers).

## Consequences

- Positive: deterministic, explainable, snapshot-safe; M2 admin UI only swaps the config source.
- Negative: configuration lives in seed files until M2 (D-010); engine inputs are verbose by design.

## Reversibility

High for configuration; medium for the result schema (stored in snapshots from M1).
