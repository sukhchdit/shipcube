import { createOrdersRepository } from '../repository/orders.repository.js';

export const findRoute = (id: string): string => createOrdersRepository().find(id);
