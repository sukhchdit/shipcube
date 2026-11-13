// Supertest wrapper that validates every response against openapi.yaml (US-034, REQ-API-004, api/README.md §16).
// `const client = await api(app); await client.get('/health/live').expect(200);` - the contract check is the first
// assertion on every request, so a deviating response fails the test whatever the test itself asserts.
// `expectContract(res)` checks a response a test already holds. Both record the conforming (operationId, status) pairs
// for the contract-coverage report (contract-coverage.ts).
import request, { type Response, type Test } from 'supertest';

import { loadContract, OPENAPI_PATH } from '../../../tools/openapi/contract.js';
import { type CoverageRecorder, createCoverageRecorder } from './contract-coverage.js';
import { type ContractValidator, createContractValidator, type ResponseUnderTest } from './contract-validator.js';

/** The app or server Supertest accepts. */
export type TestTarget = Parameters<typeof request>[0];

export interface ContractAgent {
  readonly validator: ContractValidator;
  get(path: string): Test;
  post(path: string): Test;
  put(path: string): Test;
  patch(path: string): Test;
  delete(path: string): Test;
  options(path: string): Test;
  head(path: string): Test;
}

const validators = new Map<string, Promise<ContractValidator>>();

/** The validator for the contract at `path` (default openapi.yaml), built once per Jest worker. */
export function contractValidator(path: string = OPENAPI_PATH): Promise<ContractValidator> {
  let validator = validators.get(path);
  if (validator === undefined) {
    validator = loadContract(path).then(createContractValidator);
    validators.set(path, validator);
  }
  return validator;
}

export function toResponseUnderTest(method: string, path: string, res: Response): ResponseUnderTest {
  const text: unknown = (res as { text?: unknown }).text;
  return {
    method,
    path,
    status: res.status,
    headers: res.headers,
    body: res.body,
    text: typeof text === 'string' ? text : undefined,
  };
}

/** Throws an Error listing every deviation; returns normally for a conforming response. */
export function assertContract(validator: ContractValidator, response: ResponseUnderTest): void {
  const deviations = validator.validateResponse(response);
  if (deviations.length > 0) throw new Error(validator.describeFailure(response, deviations));
}

let recorder: CoverageRecorder | undefined;

/**
 * Validates and records the conforming (operationId, status) pair for the contract-coverage report (api/README.md §16
 * item 6). Framework answers (no operation) and HEAD answered by a GET operation are not pairs of their own.
 */
function assertAndRecord(validator: ContractValidator, response: ResponseUnderTest): void {
  assertContract(validator, response);
  const operation = validator.resolveOperation(response.method, response.path);
  if (operation?.method !== response.method.toUpperCase()) return;
  recorder ??= createCoverageRecorder();
  recorder.record({ operationId: operation.operationId, status: response.status });
}

/** Method and path of the request behind a Supertest response (`res.req` is the Node ClientRequest). */
function requestLineOf(res: Response): { method: string; path: string } {
  const req: unknown = (res as { req?: unknown }).req;
  const method: unknown = typeof req === 'object' && req !== null ? (req as { method?: unknown }).method : undefined;
  const path: unknown = typeof req === 'object' && req !== null ? (req as { path?: unknown }).path : undefined;
  if (typeof method !== 'string' || typeof path !== 'string') {
    throw new TypeError('expectContract: the response carries no request line; pass { method, path }');
  }
  return { method, path };
}

/** Validates a response a test already holds; rejects with the deviations. */
export async function expectContract(res: Response, requestLine?: { method: string; path: string }): Promise<void> {
  const validator = await contractValidator();
  const { method, path } = requestLine ?? requestLineOf(res);
  assertAndRecord(validator, toResponseUnderTest(method, path, res));
}

/** A Supertest agent for `app` whose every response is validated against the contract first. */
export async function api(app: TestTarget): Promise<ContractAgent> {
  const validator = await contractValidator();
  const agent = request(app);
  const checked = (method: string, test: Test, path: string): Test =>
    test.expect((res: Response) => {
      assertAndRecord(validator, toResponseUnderTest(method, path, res));
    });
  return {
    validator,
    get: (path) => checked('GET', agent.get(path), path),
    post: (path) => checked('POST', agent.post(path), path),
    put: (path) => checked('PUT', agent.put(path), path),
    patch: (path) => checked('PATCH', agent.patch(path), path),
    delete: (path) => checked('DELETE', agent.delete(path), path),
    options: (path) => checked('OPTIONS', agent.options(path), path),
    head: (path) => checked('HEAD', agent.head(path), path),
  };
}
