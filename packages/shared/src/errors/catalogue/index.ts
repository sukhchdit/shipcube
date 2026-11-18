// Error-code catalogue (ADR-0016 §3, DR-A26, PLAN.md §5 rule 2). Each module owns `catalogue/<module>.ts`; this file
// only aggregates them, one typed import per file. errors/catalogue.test.ts discovers every `catalogue/*.ts` and
// fails when one is not listed here, when a code is duplicated, or when a code is not SCREAMING_SNAKE.
import type { CatalogueEntry, ModuleCatalogue } from '../catalogue-entry.js';
import { auditCatalogue } from './audit.js';
import { carriersCatalogue } from './carriers.js';
import { customsCatalogue } from './customs.js';
import { documentsCatalogue } from './documents.js';
import { identityCatalogue } from './identity.js';
import { ordersCatalogue } from './orders.js';
import { organisationsCatalogue } from './organisations.js';
import { paymentsCatalogue } from './payments.js';
import { pickupsCatalogue } from './pickups.js';
import { platformCatalogue } from './platform.js';
import { pricingCatalogue } from './pricing.js';
import { quotesCatalogue } from './quotes.js';
import { shipmentsCatalogue } from './shipments.js';
import { trackingCatalogue } from './tracking.js';

/** Module name (the catalogue file name) to that module's codes. */
export const CATALOGUE_MODULES = {
  audit: auditCatalogue,
  carriers: carriersCatalogue,
  customs: customsCatalogue,
  documents: documentsCatalogue,
  identity: identityCatalogue,
  orders: ordersCatalogue,
  organisations: organisationsCatalogue,
  payments: paymentsCatalogue,
  pickups: pickupsCatalogue,
  platform: platformCatalogue,
  pricing: pricingCatalogue,
  quotes: quotesCatalogue,
  shipments: shipmentsCatalogue,
  tracking: trackingCatalogue,
} as const satisfies Readonly<Record<string, ModuleCatalogue>>;

type Modules = typeof CATALOGUE_MODULES;
type UnionToIntersection<U> = (U extends unknown ? (arg: U) => void : never) extends (arg: infer I) => void ? I : never;

/** Every catalogue entry, keyed by code. */
export type ErrorCatalogue = UnionToIntersection<Modules[keyof Modules]>;
/** A code that has a catalogue entry; `AppError` accepts nothing else. */
export type ErrorCode = Extract<keyof ErrorCatalogue, string>;

/** Merges module catalogues; a code declared by two modules is a programming error and fails at load time. */
export function mergeCatalogues(modules: Readonly<Record<string, ModuleCatalogue>>): Readonly<Record<string, CatalogueEntry>> {
  const merged: Record<string, CatalogueEntry> = {};
  const owner = new Map<string, string>();
  for (const [module, entries] of Object.entries(modules)) {
    for (const [code, entry] of Object.entries(entries)) {
      const previous = owner.get(code);
      if (previous !== undefined) throw new Error(`Error code ${code} is declared by both ${previous} and ${module}`);
      owner.set(code, module);
      merged[code] = entry;
    }
  }
  return Object.freeze(merged);
}

export const ERROR_CATALOGUE = mergeCatalogues(CATALOGUE_MODULES) as ErrorCatalogue;

/** Type guard for codes arriving as plain strings (e.g. from a serialised problem). */
export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === 'string' && Object.hasOwn(ERROR_CATALOGUE, value);
}
