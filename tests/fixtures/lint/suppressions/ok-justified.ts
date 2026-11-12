// eslint-disable-next-line @typescript-eslint/no-explicit-any -- TASK-123 remove after the carrier SDK ships types
export const loose: any = 1;

// @ts-expect-error -- TASK-123 the carrier SDK declares the field as a string
export const typed: number = '1';

// Directive-looking text outside comments is not a suppression (the lexer skips strings, templates and regexes).
export const quoted = '// eslint-disable-next-line no-restricted-imports';
export const doubleQuoted = "/* eslint-disable */";
export const template = `/* eslint-disable */ ${String(loose)} // @ts-ignore`;
export const pattern = /\/\/ eslint-disable(?:-line)?/u;
export const ratio = typed / 2 / 1;

/**
 * Prose may mention `// eslint-disable-next-line rule -- reason` inside a JSDoc block: the comment starts with `*`.
 */
export const documented = true;
