// Shared OpenAPI contract loader for the TASK-017 tooling (US-034, US-035; ADR-0016 §1; api/README.md §15-17): the
// route/document drift check, the generated-types freshness check, the Supertest response validator and the contract
// stubs all read the document through this module, so they agree on paths, methods and the `/api/v1` base path.
// The document is parsed and fully dereferenced with @apidevtools/swagger-parser (already a root dev dependency).
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import SwaggerParser from '@apidevtools/swagger-parser';

export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
/** The source of truth (REQ-API-002). Read-only for P5 tasks; changes go to api-designer (PLAN.md rule 5). */
export const OPENAPI_PATH = resolve(REPO_ROOT, 'docs', '03-architecture', 'api', 'openapi.yaml');
/** Generated frontend types (ADR-0016 §1, api/README.md §17); committed, checked for staleness. */
export const TYPES_GEN_PATH = resolve(REPO_ROOT, 'packages', 'shared', 'src', 'api', 'types.gen.ts');

export const HTTP_METHODS = ['get', 'put', 'post', 'delete', 'options', 'head', 'patch', 'trace'] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

/** A dereferenced OpenAPI 3.1 document, typed only as far as the tooling reads it. */
export interface OpenApiDocument {
  readonly openapi: string;
  readonly info: Readonly<Record<string, unknown>>;
  readonly servers?: readonly ServerObject[];
  readonly paths: Readonly<Record<string, PathItem>>;
  readonly components?: Readonly<Record<string, unknown>>;
  readonly [extension: `x-${string}`]: unknown;
}

export interface ServerObject {
  readonly url: string;
  readonly variables?: Readonly<Record<string, unknown>>;
}

export type PathItem = Readonly<Partial<Record<HttpMethod, OperationObject>>> & {
  readonly servers?: readonly ServerObject[];
  readonly parameters?: readonly unknown[];
};

/** An operation object; vendor extensions (`x-permission`, `x-error-codes`, ...) are read by name. */
export type OperationObject = Readonly<Record<string, unknown>> & {
  readonly operationId?: string;
  readonly deprecated?: boolean;
  readonly servers?: readonly ServerObject[];
  readonly responses?: Readonly<Record<string, unknown>>;
  readonly requestBody?: Readonly<Record<string, unknown>>;
};

export interface ContractOperation {
  /** `operationId` (unique, camelCase per api/README.md §1). */
  readonly operationId: string;
  /** Upper-case HTTP method. */
  readonly method: Uppercase<HttpMethod>;
  /** The path key in the document, e.g. `/shipments/{shipmentId}`. */
  readonly path: string;
  /** The request path the API serves: server base path + path, e.g. `/api/v1/shipments/{shipmentId}`, `/health/live`. */
  readonly fullPath: string;
  readonly operation: OperationObject;
}

const cache = new Map<string, Promise<OpenApiDocument>>();

/**
 * `$ref` resolution never uses the network (PR21-SEC-07): an `http(s)` reference fails the load instead of fetching
 * unreviewed schema content. Every reference in the contract is internal (`#/...`); local file references still work.
 */
export const DEREFERENCE_OPTIONS = { resolve: { http: false } } as const;

/** Parses and dereferences the document once per path (per Jest worker). Throws on a parse or `$ref` error. */
export function loadContract(path: string = OPENAPI_PATH): Promise<OpenApiDocument> {
  let loaded = cache.get(path);
  if (loaded === undefined) {
    loaded = SwaggerParser.dereference(path, DEREFERENCE_OPTIONS) as unknown as Promise<OpenApiDocument>;
    cache.set(path, loaded);
  }
  return loaded;
}

function variableDefault(server: ServerObject, name: string): string {
  const variable = server.variables?.[name];
  const value = typeof variable === 'object' && variable !== null ? (variable as { default?: unknown }).default : undefined;
  return typeof value === 'string' ? value : 'x';
}

/**
 * The path part of the first server URL, with `{variables}` replaced by their defaults:
 * `http://localhost:3000/api/v1` -> `/api/v1`; `{apiRoot}` (default `http://localhost:3000`) -> ``.
 */
export function serverBasePath(servers: readonly ServerObject[] | undefined): string {
  const server = servers?.[0];
  if (server === undefined) return '';
  const url = server.url.replaceAll(/\{([^}]+)\}/g, (_match, name: string) => variableDefault(server, name));
  const path = new URL(url, 'http://placeholder.invalid').pathname;
  return path === '/' ? '' : path.replace(/\/+$/, '');
}

/** Every operation with its served path; operation-level, then path-level, then document `servers` decide the base. */
export function listOperations(doc: OpenApiDocument): ContractOperation[] {
  const operations: ContractOperation[] = [];
  for (const [path, item] of Object.entries(doc.paths)) {
    for (const method of HTTP_METHODS) {
      const operation = item[method];
      if (operation === undefined) continue;
      const base = serverBasePath(operation.servers ?? item.servers ?? doc.servers);
      operations.push({
        operationId: operation.operationId ?? `${method.toUpperCase()} ${path}`,
        method: method.toUpperCase() as Uppercase<HttpMethod>,
        path,
        fullPath: `${base}${path}`,
        operation,
      });
    }
  }
  return operations;
}
