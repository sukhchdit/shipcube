import type { OrdersRepository } from '../repository/orders.repository.js';

export interface OrdersService {
  get(id: string): string;
}

export const createOrdersService = (repository: OrdersRepository): OrdersService => ({ get: (id) => repository.find(id) });
