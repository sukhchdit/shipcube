import { countOrders } from '../../orders/index.js';

export const quotesPerOrder = (quotes: number): number => quotes / (countOrders() + 1);
