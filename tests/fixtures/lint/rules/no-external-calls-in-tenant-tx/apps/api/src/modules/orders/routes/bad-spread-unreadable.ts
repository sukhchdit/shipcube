import { sharedSpec } from './route-support.js';

declare function defineRoute(spec: object): unknown;
declare function makePhases(): object;

// Code review R1-m5 (a): a spread the rule cannot read (it may hide a handler or a load) is reported unless an
// explicit handler follows it. A parameter, an import, a call result and a let.
export const fromParameter = (phases: object): unknown => defineRoute({ operationId: 'fromParameter', ...phases });
export const fromImport = defineRoute({ operationId: 'fromImport', ...sharedSpec });
export const fromCall = defineRoute({ operationId: 'fromCall', ...makePhases() });

let mutable: object = {};
export const reset = (next: object): void => {
  mutable = next;
};
export const fromLet = defineRoute({ operationId: 'fromLet', ...mutable });
