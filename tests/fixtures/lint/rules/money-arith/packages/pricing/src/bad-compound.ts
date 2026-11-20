export const total = (lines: readonly { amount: number }[]): number => {
  let t = 0;
  for (const line of lines) t += line.amount;
  return t;
};
