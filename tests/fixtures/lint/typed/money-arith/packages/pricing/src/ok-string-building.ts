import type { Minor } from './minor.js';

// R2-M1: `+=` onto a string builds text, so the exemption applies even with a Minor right side.
export const label = (m: { readonly amount: Minor }): string => {
  let s = 'net ';
  s += m.amount;
  return s;
};
