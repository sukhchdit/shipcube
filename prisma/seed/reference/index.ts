/**
 * The reference seed definition (TASK-023, data-model §9.2): the datasets upserted by natural key and the steps that
 * run after them, all inside one transaction (see `runReferenceSeed`).
 *
 * Later tasks append here, each with its own `Dataset` file next to this one:
 * - TASK-026 `countries` (and its `currencies` dependency), TASK-066 `currencies`/`fx_rates`, and the other
 *   data-model §9.2 datasets as their tables arrive. A dataset needs a stable `name`, a `version`, the natural key
 *   and `source` on every row; configuration datasets set `audited`, published ones `insertOnly`.
 * - TASK-021 appends the `ensure_audit_partitions` step (`SELECT platform.ensure_audit_partitions(3)`), which belongs
 *   to the audit module because it needs that function.
 *
 * `permissions`, `roles` and `role_permissions` are not datasets: the generated seed migration is their only writer
 * (D-ARCH-060), so the seed only verifies parity.
 */
import type { Dataset, SeedStep } from '../framework/contracts.js';
import { authzParityStep } from './authz-parity-step.js';

export const REFERENCE_DATASETS: readonly Dataset[] = [];

export const REFERENCE_STEPS: readonly SeedStep[] = [authzParityStep];

export { authzParityStep, catalogueSnapshot, diffAuthz, type AuthzSnapshot } from './authz-parity-step.js';
