import { ordersModule } from '../../orders/index.js';

export const quoteRouteCount = (): number => ordersModule().length;
