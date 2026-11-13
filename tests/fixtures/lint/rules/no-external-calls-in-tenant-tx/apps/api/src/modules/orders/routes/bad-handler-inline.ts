declare function defineRoute(spec: object): unknown;

// D-ARCH-106 R2: an inline defineRoute handler runs inside the tenant transaction: fetch plus a setTimeout sleep.
export const refresh = defineRoute({
  operationId: 'refreshOrder',
  transaction: 'tenant',
  handler: async (ctx: { url: string }) => {
    await new Promise((resolve) => setTimeout(resolve, 10));
    return fetch(ctx.url);
  },
});
