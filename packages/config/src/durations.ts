/**
 * Duration values such as `AUTH_REFRESH_TTL=30d` (ADR-0006). Format: a positive integer followed by one unit,
 * `s` seconds, `m` minutes, `h` hours or `d` days. Parsed to whole seconds.
 */
const DURATION = /^([1-9][0-9]{0,8})([smhd])$/;

export const SECONDS_PER_UNIT = Object.freeze({ s: 1, m: 60, h: 3_600, d: 86_400 } as const);

export type DurationUnit = keyof typeof SECONDS_PER_UNIT;

/** Seconds represented by `value`, or `undefined` when it is not a duration. */
export function parseDurationSeconds(value: string): number | undefined {
  const match = DURATION.exec(value);
  if (match === null) return undefined;
  const [, amount, unit] = match as unknown as [string, string, DurationUnit];
  return Number(amount) * SECONDS_PER_UNIT[unit];
}
