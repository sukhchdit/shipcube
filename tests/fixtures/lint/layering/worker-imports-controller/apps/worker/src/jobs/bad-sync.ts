import { showOrder } from '../../../api/src/modules/orders/controller/orders.controller.js';

export const sync = (): string => showOrder();
