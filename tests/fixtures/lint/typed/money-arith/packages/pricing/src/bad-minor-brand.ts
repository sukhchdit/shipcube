import type { Minor } from './minor.js';

// Neither name matches the name heuristic: only the type-aware branch sees minor units here.
export const total = (net: Minor, tax: Minor): number => net + tax;
