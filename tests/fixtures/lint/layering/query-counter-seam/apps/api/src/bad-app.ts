import { withQueryCounter } from './platform/db/query-counter.js';

export const client = withQueryCounter(1);
