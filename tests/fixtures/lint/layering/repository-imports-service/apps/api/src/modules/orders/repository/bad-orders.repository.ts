import { total } from '../service/orders.service.js';

export const load = (): number => total();
