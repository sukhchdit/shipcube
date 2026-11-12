import { getOrder } from '../service/orders.service.js';

export const showOrder = (id: string): string => getOrder(id);
