// PR076-SEC-07: an ambient declaration makes Date a module-scope binding, so the global-scope pass would skip
// Date.now() below; at run time it is still the real clock.
declare const Date: DateConstructor;

export const stamp = (): number => Date.now();
