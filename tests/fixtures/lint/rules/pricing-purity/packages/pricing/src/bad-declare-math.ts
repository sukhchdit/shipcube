// Code review R1-m3 (TASK-080): a declared Math hides Math.random() from the global-scope pass; at run time it is still
// the real random source.
declare const Math: { random(): number };

export const jitter = (): number => Math.random();
