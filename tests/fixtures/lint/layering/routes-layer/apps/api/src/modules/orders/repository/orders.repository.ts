export interface OrdersRepository {
  find(id: string): string;
}

export const createOrdersRepository = (): OrdersRepository => ({ find: (id) => id });
