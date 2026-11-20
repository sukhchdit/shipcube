import type { Minor } from './minor.js';

// `sum += value` accumulates minor units into a plain number; only the type says `value` is Minor.
export const total = (values: readonly Minor[]): number => {
  let sum = 0;
  for (const value of values) sum += value;
  return sum;
};
