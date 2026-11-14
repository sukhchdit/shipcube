import { createRequire } from 'node:module';
import type * as NodeModule from 'node:module';
import * as nodeModule from 'node:module';

type Make = typeof createRequire;
type Loader = ReturnType<typeof NodeModule.createRequire>;

/** PR44-SEC-01 positive control: createRequire(<url>).resolve(<literal>) (the openapi/serve.ts shape) and type positions. */
export const swaggerUi = (): string => createRequire(import.meta.url).resolve('swagger-ui-dist/package.json');
export const viaNamespace = (): string => nodeModule.createRequire(import.meta.url).resolve('x/package.json');
export type Types = [Make, Loader];
