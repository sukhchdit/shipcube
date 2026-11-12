import type { OrdersService } from '../service/orders.service.js';

export interface OrdersController {
  show(id: string): string;
}

export const createOrdersController = (service: OrdersService): OrdersController => ({ show: (id) => service.get(id) });
