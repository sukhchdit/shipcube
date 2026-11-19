import type { Minor } from './minor.js';

export const exceeds = (net: Minor, limit: Minor): boolean => net > limit;

export const twice = (count: number): number => count * 2;
