type AppDb = { order: { create(data: object): Promise<unknown> } };

// D-ARCH-106 R6: a function taking `db: AppDb` runs inside the transaction (reached through an injected controller).
export async function create(db: AppDb, url: string): Promise<unknown> {
  await fetch(url);
  return db.order.create({});
}
