declare function defineRoute(spec: object): unknown;
declare const phaseName: string;

// PR44-SEC-04 K02-K04: a computed key the rule cannot resolve (it may be handler or load) is reported. A declared
// string and a let.
export const dynamicKey = defineRoute({ operationId: 'dynamicKey', [phaseName]: async () => ({}), handler: async () => ({}) });

let mutableKey = 'load';
export const rename = (next: string): void => {
  mutableKey = next;
};
export const letKey = defineRoute({ operationId: 'letKey', [mutableKey]: async () => ({}), handler: async () => ({}) });
