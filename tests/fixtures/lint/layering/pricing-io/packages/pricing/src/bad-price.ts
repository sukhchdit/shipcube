import { readFileSync } from 'node:fs';

export const loadRates = (): string => readFileSync('rates.json', 'utf8');
