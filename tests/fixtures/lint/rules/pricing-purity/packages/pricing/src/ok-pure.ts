import { money, type Money } from '@platform/shared';

export const pricedAt = (now: string): Date => new Date(now);

export const elapsed = (from: Date, to: Date): number => to.getTime() - from.getTime();

export const epoch = (): number => Date.UTC(2026, 10, 12) + Date.parse('2026-11-12T00:00:00Z');

export const larger = (a: number, b: number): number => Math.max(a, b);

export const fee = (): Money => money(100, 'USD');
