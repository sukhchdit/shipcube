import { importedHandler } from './route-support.js';

interface OrdersController {
  cancel(ctx: { id: string }): Promise<unknown>;
}

declare const controller: OrdersController;
declare function defineRoute(spec: object): unknown;
declare function makeHandler(deps: object): (ctx: { id: string }) => Promise<unknown>;
declare const deps: object;

// D-ARCH-111 (b) positive controls: a member expression and an imported binding are not reported (R6 reaches the
// service method they end in); a handler the rule cannot follow on a transaction: 'none' route is not a root.
export const cancel = defineRoute({ operationId: 'cancelOrder', handler: controller.cancel });
export const imported = defineRoute({ operationId: 'importedHandler', handler: importedHandler });
export const none = defineRoute({ operationId: 'noneMade', transaction: 'none', handler: makeHandler(deps) });
