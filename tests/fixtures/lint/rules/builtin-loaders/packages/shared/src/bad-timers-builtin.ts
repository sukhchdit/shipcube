/** PR44-SEC-14 (020-D): the same refusal in package sources (the timer module through getBuiltinModule). */
export const timers = (): unknown => process.getBuiltinModule('node:timers/promises');
