/** Supporting module of the D-ARCH-111 route fixtures: the route factories, a spec and a handler reached by import. */
export declare function defineRoute(spec: object): unknown;
export declare function fixtureRoute(spec: object): unknown;

export const sharedSpec = { operationId: 'sharedSpec', handler: async (): Promise<object> => ({ status: 200 }) };

export declare const importedHandler: (ctx: { id: string }) => Promise<unknown>;
