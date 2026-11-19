export const pricedAt = (now: string): Date => new Date(now);

export const elapsed = (from: Date, to: Date): number => to.getTime() - from.getTime();
