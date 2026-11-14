import { sharedSpec } from './route-support.js';

declare function defineRoute(spec: object): unknown;
declare function makeSpec(): object;

// D-ARCH-111 (a): a spec that is not an inline literal or a same-file const literal cannot be read, so it is reported.
// A parameter (a route-building helper).
export const build = (spec: object): unknown => defineRoute(spec);

// An import.
export const shared = defineRoute(sharedSpec);

// A call result.
export const made = defineRoute(makeSpec());

// A let binding.
let mutable = { operationId: 'mutable', handler: async () => ({ status: 200 }) };
mutable = { ...mutable };
export const fromLet = defineRoute(mutable);
