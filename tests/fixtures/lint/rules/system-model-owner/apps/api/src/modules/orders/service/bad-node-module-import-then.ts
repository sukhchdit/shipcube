declare const use: (value: unknown) => unknown;

/**
 * PR44-SEC-10 / D-TASK020-59 residual: the dynamic import of node:module through .then, its value passed on
 * (the callback parameter handed to a function, and the module given to a non-inline callback).
 */
export const passParameter = (): Promise<unknown> => import('node:module').then((loaded) => use(loaded));
export const passCallback = (): Promise<unknown> => import('node:module').then(use);
