import { ordersRoutes } from '../routes/ok-orders.routes.js';

export const routeCount = (): number => ordersRoutes({ show: (id: string) => id }).length;
