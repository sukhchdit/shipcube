// PR076-SEC-07: a declare global block widens the global scope the purity rule reasons about.
declare global {
  interface PricingClock {
    readonly now: number;
  }
}

export const marker = 1;
