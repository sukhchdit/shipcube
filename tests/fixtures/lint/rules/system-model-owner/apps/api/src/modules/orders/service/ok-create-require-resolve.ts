import { createRequire } from 'node:module';

type Make = typeof createRequire;
type Loader = ReturnType<typeof createRequire>;

/**
 * PR44-SEC-01 positive control: createRequire(<url>).resolve(<literal>) (the openapi/serve.ts shape) and type positions.
 * The namespaced form is gone since 020-D: a namespace or default import of node:module is refused by
 * no-restricted-imports (PR44-SEC-14, rules/builtin-loaders).
 */
export const swaggerUi = (): string => createRequire(import.meta.url).resolve('swagger-ui-dist/package.json');
export type Types = [Make, Loader];
