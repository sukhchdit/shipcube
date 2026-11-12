# ADR-0009: Identifiers (UUIDv7), human-readable numbering, money and units

- **Status:** Accepted
- **Date:** 2026-11-12
- **Deciders:** principal-architect, data-architect
- **Related:** brief §4.4, §4.10; REQ-RLS-009/012, REQ-DATA-006/015, REQ-API-016, REQ-PRICE-002/004, DR-A24, DR-B05, DR-B06, DR-B11, DR-B22; D-032; NFR-DATA-001/002; A-050, A-059

## Context

The brief requires UUID primary keys (UUIDv7 for index locality), per-country human-readable sequences for orders/invoices/credit notes, integer minor-unit money with ISO 4217 codes and no floating point, metric and imperial entry with a configurable volumetric divisor, and `timestamptz` UTC storage with local dates kept as date + IANA zone.

## Decision

1. **Identifiers.** All PKs are UUIDv7 generated **in the application** with `uuid` 14 `v7()` (so the ID exists before the insert for outbox/audit/idempotency correlation) and PostgreSQL 18 `uuidv7()` as the column default for rows created by SQL (seed, triggers). A schema test asserts every `id` column is `uuid`. Public identifiers in URLs are the UUIDs; order numbers are display/lookup keys, never PKs.
2. **Number sequences (DR-A24, D-032).** `number_sequences(scope ORDER|INVOICE|CREDIT_NOTE, country char(2), next_value bigint, PK(scope,country))`. Allocation inside the checkout transaction: `UPDATE number_sequences SET next_value = next_value + 1 WHERE scope = $1 AND country = $2 RETURNING next_value - 1` (row lock → monotonic, unique, gaps allowed on rollback). Format `<alpha-2 origin>-<8-digit zero-padded><Luhn mod-10 check digit>` (e.g. `US-000012345X`); the public tracking lookup validates the check digit before any query (A-050). Invoice/credit-note scopes are defined, not allocated, before M2.
3. **Money.** `Money = { amount: bigint-safe integer (minor units), currency: ISO 4217 }` in `packages/shared/money` with `add/sub/mulRatio/allocate/convert/format`; **branded type** `Minor` prevents mixing with plain numbers; arithmetic uses integers only, percentage and FX multiplication round once, half away from zero at line level (DR-B11); `currencies(code, exponent)` from reference data (REQ-DATA-006) drives exponents; unknown codes throw. Storage: `BIGINT` + `CHAR(3)` pairs (column naming `<name>_amount`, `<name>_currency`); API: `{ "amount": 1234, "currency": "USD" }` (REQ-API-016); FX rates `NUMERIC(18,6)` in DB, strings in the API. Lint forbids `number` arithmetic on `Minor`, `parseFloat/toFixed` in money paths; property tests cover rounding invariants (NFR-QUAL-003).
4. **Units (DR-B05/B06).** Weights stored as integer **grams**, dimensions as integer **millimetres**; `packages/shared/units` converts entry values (kg/lb, cm/in) to internal integers (halves up) and back for display (1 decimal). Volumetric weight = L×W×H / divisor computed on internal integers, rounded up to the next gram; billable weight per package = max(actual, volumetric) rounded up to the service increment (default 500 g / 1 lb), summed per shipment. Divisors (default 5000 cm³/kg, 139 in³/lb) come from `carrier_services` per unit system.
5. **Time.** `timestamptz` everywhere (schema test rejects `timestamp`); local-by-nature dates (pickup date, holidays) as `date` + `tz text` (IANA). API: ISO 8601 `Z`; local dates `YYYY-MM-DD` + `time_zone`. DST-boundary unit tests for date helpers (NFR-DATA-002).
6. **Standard columns.** `id, created_at, updated_at, created_by, updated_by, version` on every table; soft-deletable tables add `deleted_at, deleted_by`; server-stamped by the Prisma extension; `version` incremented in a conditional update (`WHERE version = $expected`), 0 rows → 409/412 (REQ-RLS-011). Reserved system user ID for seed/jobs.

## Alternatives considered

- **`dinero.js`/`currency.js`.** Good libraries, but a 150-line integer helper with a branded type is simpler to audit at ≥ 95 % coverage and avoids a dependency on the critical path.
- **Postgres `SEQUENCE` per country.** Dynamic sequence creation per new country complicates migrations; a row-locked table is sufficient at launch volume and is portable.
- **`NUMERIC` money columns.** Rejected by the brief (integer minor units).
- **Decimal libraries for money.** Rejected: integer arithmetic is exact and faster.

## Consequences

- Positive: index-friendly IDs, exact money, deterministic rounding, one place for units.
- Negative: branded types add ceremony; per-country sequence rows are a (tiny) hotspot at very high checkout rates — acceptable for 10× launch volume (NFR-SCALE-001).

## Reversibility

Low for order-number format after the first production order (D-032); high for internals.
