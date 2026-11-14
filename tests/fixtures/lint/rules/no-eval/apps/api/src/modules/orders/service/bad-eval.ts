/** D-ARCH-111 (2): eval turns a string into code the import controls and the T-83 lint cannot see. */
export const run = (code: string): unknown => eval(code);
