export const isFree = (line: { amount: number }): boolean => line.amount === 0;

export const label = (line: { amount: number }): string => 'total ' + line.amount;
