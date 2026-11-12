import type { OrdersController } from '../controller/orders.controller.js';
import { orderIdSchema } from '../schemas/orders.schemas.js';

export const ordersRoutes = (controller: OrdersController) => [
  { method: 'GET', path: '/orders/:id', schema: orderIdSchema, handler: (id: string) => controller.show(id) },
];
