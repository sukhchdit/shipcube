// The module index.ts is the composition root (D-ORCH-006): it wires repository -> service -> controller -> routes.
import { createOrdersController } from './controller/orders.controller.js';
import { createOrdersRepository } from './repository/orders.repository.js';
import { ordersRoutes } from './routes/ok-orders.routes.js';
import { createOrdersService } from './service/orders.service.js';

export const ordersModule = () => ordersRoutes(createOrdersController(createOrdersService(createOrdersRepository())));
