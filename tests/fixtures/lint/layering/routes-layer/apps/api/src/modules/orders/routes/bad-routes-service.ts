import { createOrdersService } from '../service/orders.service.js';

export const showRoute = (id: string): string => createOrdersService({ find: (key) => key }).get(id);
