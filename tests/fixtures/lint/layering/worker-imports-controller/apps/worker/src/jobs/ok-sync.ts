import { countOrders } from '../../../api/src/modules/orders/index.js';

export const sync = (): number => countOrders();
