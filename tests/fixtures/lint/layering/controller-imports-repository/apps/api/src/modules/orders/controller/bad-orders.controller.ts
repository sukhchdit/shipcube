import { findOrder } from '../repository/orders.repository.js';

export const getOrder = (id: string): string => findOrder(id);
