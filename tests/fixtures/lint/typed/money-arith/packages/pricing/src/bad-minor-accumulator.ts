import type { Minor } from './minor.js';

interface Line {
  readonly amount: Minor;
}

// R2-M1: a Minor-typed left side is never the string exemption.
export const add = (start: Minor, k: Minor): Minor => {
  let t: Minor = start;
  t += k;
  return t;
};

export const total = (first: Line, rest: readonly Line[]): Minor => {
  let total = first.amount;
  for (const line of rest) total += line.amount;
  return total;
};
