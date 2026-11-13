// node:http server answering every openapi.yaml operation with its documented example (TASK-017 sheet item, US-034,
// ADR-0016 §1). Local development and tests only: binds 127.0.0.1 by default, ignores request bodies, never calls out.
// Framework behaviour mirrors the API (api/README.md §3, REQ-PLAT-010/011): X-Correlation-Id echoed when valid else
// generated, 404 NOT_FOUND / 405 METHOD_NOT_ALLOWED (with Allow) as problem+json, OPTIONS on a known path 204 with
// Allow (including OPTIONS, also listed in every 405 Allow). `Prefer: code=<status>` and
// `Prefer: example=<name>` select another documented response.
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';

import { ERROR_CATALOGUE, type ErrorCode } from '@platform/shared';

import { loadContract, type OpenApiDocument } from '../../tools/openapi/contract.js';
import { requestCarriesCredential } from '../api/helpers/cache-control.js';
import { requestPathOf } from '../api/helpers/path-match.js';
import { buildStubs, type ContractStub, PRIVATE_CACHE_CONTROL, resolveStub, type StubSelection, type StubVariant } from './stubs.js';

const CORRELATION_ID = /^[A-Za-z0-9-]{8,64}$/;
const PROBLEM_TYPE_BASE = 'https://docs.platform.invalid/problems/';
const PROBLEM_MEDIA_TYPE = 'application/problem+json';
const MAX_PREFER_LENGTH = 512;

export interface ContractStubServerOptions {
  readonly port?: number;
  readonly host?: string;
  /** Defaults to openapi.yaml through `loadContract()`. */
  readonly document?: OpenApiDocument;
}

export interface ContractStubServer {
  /** `http://<host>:<port>` without a trailing slash. */
  readonly url: string;
  readonly stubs: readonly ContractStub[];
  close(): Promise<void>;
}

/** `Prefer: code=404, example=NOT_FOUND` (RFC 7240 preferences; unknown ones are ignored). */
export function parsePrefer(header: string | string[] | undefined): StubSelection {
  const value = (Array.isArray(header) ? header.join(',') : (header ?? '')).slice(0, MAX_PREFER_LENGTH);
  let status: number | undefined;
  let exampleName: string | undefined;
  for (const token of value.split(/[,;]/)) {
    const [rawKey = '', ...rest] = token.split('=');
    const key = rawKey.trim().toLowerCase();
    const raw = rest
      .join('=')
      .trim()
      .replace(/^"(.*)"$/, '$1');
    if (key === 'code' && /^[1-5]\d\d$/.test(raw)) status = Number(raw);
    if (key === 'example' && raw !== '') exampleName = raw;
  }
  return { status, exampleName };
}

function correlationIdOf(req: IncomingMessage): string {
  const inbound = req.headers['x-correlation-id'];
  return typeof inbound === 'string' && CORRELATION_ID.test(inbound) ? inbound : randomUUID();
}

function problem(code: ErrorCode, path: string, correlationId: string, detail?: string): Record<string, unknown> {
  const { title, status } = ERROR_CATALOGUE[code];
  return {
    type: `${PROBLEM_TYPE_BASE}${code}`,
    title,
    status,
    detail: detail ?? `${title}.`,
    instance: path,
    code,
    correlation_id: correlationId,
  };
}

/** Like the API's problem handler (SEC-TC-29, D-ARCH-107 (5)): no-store, and private too when the request carried a credential. */
function sendProblem(req: IncomingMessage, res: ServerResponse, body: Record<string, unknown>, headers: Record<string, string> = {}): void {
  const cacheControl = requestCarriesCredential(req.headers) ? PRIVATE_CACHE_CONTROL : 'no-store';
  res.writeHead(Number(body['status']), { ...headers, 'Content-Type': PROBLEM_MEDIA_TYPE, 'Cache-Control': cacheControl });
  res.end(JSON.stringify(body));
}

/** The example body as sent: problem examples carry this request's correlation ID and path. */
function bodyFor(variant: StubVariant, path: string, correlationId: string): unknown {
  const { body } = variant;
  if (variant.contentType !== PROBLEM_MEDIA_TYPE || typeof body !== 'object' || body === null || Array.isArray(body)) return body;
  return { ...body, instance: path, correlation_id: correlationId };
}

function sendVariant(req: IncomingMessage, res: ServerResponse, variant: StubVariant, path: string, correlationId: string): void {
  const headers: Record<string, string> = { ...variant.headers };
  // SEC-TC-29: a request that carried a credential is answered private, whatever the operation (D-ARCH-107 (5)).
  if (requestCarriesCredential(req.headers)) headers['Cache-Control'] = PRIVATE_CACHE_CONTROL;
  const body = bodyFor(variant, path, correlationId);
  const payload =
    variant.contentType === undefined || body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body);
  if (variant.contentType !== undefined && payload !== undefined) headers['Content-Type'] = variant.contentType;
  res.writeHead(variant.status, headers);
  res.end(req.method === 'HEAD' ? undefined : payload);
}

function handle(stubs: readonly ContractStub[], req: IncomingMessage, res: ServerResponse): void {
  req.resume();
  const correlationId = correlationIdOf(req);
  res.setHeader('X-Correlation-Id', correlationId);
  const url = req.url ?? '/';
  const path = requestPathOf(url);
  const resolution = resolveStub(stubs, req.method ?? 'GET', url, parsePrefer(req.headers.prefer));
  switch (resolution.kind) {
    case 'not-found':
      sendProblem(req, res, problem('NOT_FOUND', path, correlationId));
      return;
    case 'method-not-allowed':
      sendProblem(req, res, problem('METHOD_NOT_ALLOWED', path, correlationId), { Allow: resolution.allow.join(', ') });
      return;
    case 'options':
      res.writeHead(204, { Allow: resolution.allow.join(', ') });
      res.end();
      return;
    case 'no-variant':
      // A stub-tool usage error (unknown Prefer target), not contract behaviour of the operation.
      sendProblem(req, res, problem('MALFORMED_REQUEST', path, correlationId, `Contract stub: ${resolution.reason}.`));
      return;
    case 'stub':
      sendVariant(req, res, resolution.variant, path, correlationId);
  }
}

/** Starts the stub server; `port: 0` picks a free port. */
export async function startContractStubServer(options: ContractStubServerOptions = {}): Promise<ContractStubServer> {
  const { port = 0, host = '127.0.0.1' } = options;
  const stubs = buildStubs(options.document ?? (await loadContract()));
  const server = createServer((req, res) => {
    handle(stubs, req, res);
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  const authority = address.family === 'IPv6' ? `[${address.address}]` : address.address;
  return {
    url: `http://${authority}:${String(address.port)}`,
    stubs,
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => {
          if (error === undefined) resolve();
          else reject(error);
        });
      }),
  };
}
