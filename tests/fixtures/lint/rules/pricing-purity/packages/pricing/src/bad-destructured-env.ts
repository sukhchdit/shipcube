const { env } = process;

export const rate = (): string | undefined => env['FUEL_RATE'];
