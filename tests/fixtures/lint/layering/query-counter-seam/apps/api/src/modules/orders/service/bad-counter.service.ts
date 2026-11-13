import { withQueryCounter } from '../../../platform/db/query-counter.js';

export const counted = (): number => withQueryCounter(2);
