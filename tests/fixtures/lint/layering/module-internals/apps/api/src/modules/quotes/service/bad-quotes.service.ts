import { countOrders } from '../../orders/service/orders.service.js';

export const quotesPerOrder = (quotes: number): number => quotes / (countOrders() + 1);
