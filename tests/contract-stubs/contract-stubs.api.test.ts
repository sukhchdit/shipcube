// Contract stubs (TASK-017 sheet item, US-034, ADR-0016 §1): every stub answer conforms to openapi.yaml, checked with
// the same validator the API tests use; the node:http server answers end-to-end on loopback.
import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { loadContract } from '../../tools/openapi/contract.js';
import type { ContractValidator, ResponseUnderTest } from '../api/helpers/contract-validator.js';
import { contractValidator } from '../api/helpers/expect-contract.js';
import { type ContractStubServer, parsePrefer, startContractStubServer } from './server.js';
import { buildStubs, type ContractStub, resolveStub, type StubVariant } from './stubs.js';

const CORRELATION_ID = 'stub-test-0001';
/** A concrete path for a template; `p-1` is no static segment of the contract. */
const samplePath = (fullPath: string): string => fullPath.replaceAll(/\{[^}]+\}/g, 'p-1');

function asResponse(stub: ContractStub, variant: StubVariant): ResponseUnderTest {
  const text = variant.body === undefined ? '' : typeof variant.body === 'string' ? variant.body : JSON.stringify(variant.body);
  const contentType = variant.contentType === undefined ? {} : { 'content-type': variant.contentType };
  return {
    method: stub.method,
    path: samplePath(stub.fullPath),
    status: variant.status,
    headers: { ...variant.headers, ...contentType, 'x-correlation-id': CORRELATION_ID },
    body: variant.body,
    text,
  };
}

async function fetched(method: string, path: string, response: Response): Promise<ResponseUnderTest> {
  const text = await response.text();
  const json = (response.headers.get('content-type') ?? '').includes('json');
  return {
    method,
    path,
    status: response.status,
    headers: Object.fromEntries(response.headers),
    body: json && text !== '' ? (JSON.parse(text) as unknown) : undefined,
    text,
  };
}

describe('contract stubs from openapi.yaml examples', () => {
  let validator: ContractValidator;
  let stubs: ContractStub[];

  beforeAll(async () => {
    validator = await contractValidator();
    stubs = buildStubs(await loadContract());
  });

  it('builds one stub per operation and every documented 2xx example validates against the contract', () => {
    expect(stubs).toHaveLength(133);
    const withoutExample = stubs
      .filter((stub) => stub.contentType !== undefined && stub.exampleName === undefined)
      .map((stub) => stub.operationId);
    expect(withoutExample).toEqual([]);
    const failures: string[] = [];
    let checked = 0;
    for (const stub of stubs) {
      for (const variant of stub.variants.filter(({ status }) => status >= 200 && status < 300)) {
        checked += 1;
        const response = asResponse(stub, variant);
        const deviations = validator.validateResponse(response);
        if (deviations.length > 0) failures.push(`${variant.exampleName ?? '<none>'}: ${validator.describeFailure(response, deviations)}`);
      }
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThanOrEqual(133);
  });

  it('a Prefer code selects a problem example the operation can return; unknown targets are reported', () => {
    expect(parsePrefer('code=404, example="NOT_FOUND"')).toEqual({ status: 404, exampleName: 'NOT_FOUND' });
    expect(parsePrefer(['code=99', 'wait=5'])).toEqual({ status: undefined, exampleName: undefined });
    const path = '/api/v1/shipments/0193a5b2-7c1e-7d4a-9f3b-000000000f01';
    const notFound = resolveStub(stubs, 'GET', path, { status: 404 });
    expect(notFound.kind).toBe('stub');
    if (notFound.kind !== 'stub') return;
    expect(notFound.stub.errorCodes).toContain((notFound.variant.body as { code: string }).code);
    expect(validator.validateResponse(asResponse(notFound.stub, notFound.variant))).toEqual([]);
    expect(resolveStub(stubs, 'GET', path, { status: 418 })).toMatchObject({
      kind: 'no-variant',
      reason: 'getShipment documents no 418 response',
    });
    expect(resolveStub(stubs, 'GET', path, { exampleName: 'nope' })).toMatchObject({ kind: 'no-variant' });
    expect(resolveStub(stubs, 'POST', '/health/live')).toEqual({ kind: 'method-not-allowed', allow: ['GET', 'HEAD'] });
    expect(resolveStub(stubs, 'GET', '/api/v1/nowhere')).toEqual({ kind: 'not-found' });
  });

  describe('server', () => {
    let server: ContractStubServer;
    beforeAll(async () => {
      server = await startContractStubServer();
    });
    afterAll(() => server.close());

    it('answers a GET stub, echoing a valid correlation ID', async () => {
      const res = await fetched(
        'GET',
        '/health/live',
        await fetch(`${server.url}/health/live`, { headers: { 'X-Correlation-Id': CORRELATION_ID } }),
      );
      expect(res).toMatchObject({ status: 200, body: { status: 'ok' } });
      expect(res.headers['x-correlation-id']).toBe(CORRELATION_ID);
      expect(validator.validateResponse(res)).toEqual([]);
    });

    it('answers a POST stub with its documented example and a generated correlation ID', async () => {
      const post = stubs.find((stub) => stub.method === 'POST' && stub.contentType === 'application/json' && !stub.fullPath.includes('{'));
      expect(post).toBeDefined();
      const path = post?.fullPath ?? '';
      const res = await fetched(
        'POST',
        path,
        await fetch(`${server.url}${path}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Correlation-Id': 'bad id!' },
          body: '{}',
        }),
      );
      expect(res.status).toBe(post?.status);
      expect(res.body).toEqual(post?.body);
      expect(res.headers['x-correlation-id']).toMatch(/^[0-9a-f-]{36}$/);
      expect(validator.validateResponse(res)).toEqual([]);
    });

    it('answers unknown routes with 404 and wrong methods with 405 problem+json, and honours Prefer', async () => {
      const unknown = await fetched('GET', '/api/v1/nowhere', await fetch(`${server.url}/api/v1/nowhere?x=1`));
      expect(unknown).toMatchObject({ status: 404, body: { code: 'NOT_FOUND', instance: '/api/v1/nowhere' } });
      expect(validator.validateResponse(unknown)).toEqual([]);
      const wrongMethod = await fetched('DELETE', '/health/live', await fetch(`${server.url}/health/live`, { method: 'DELETE' }));
      expect(wrongMethod).toMatchObject({ status: 405, headers: { allow: 'GET, HEAD' } });
      expect(validator.validateResponse(wrongMethod)).toEqual([]);
      const path = '/api/v1/shipments/0193a5b2-7c1e-7d4a-9f3b-000000000f01';
      const preferred = await fetched('GET', path, await fetch(`${server.url}${path}`, { headers: { Prefer: 'code=404' } }));
      expect(preferred).toMatchObject({ status: 404, body: { code: 'NOT_FOUND', instance: path } });
      expect(validator.validateResponse(preferred)).toEqual([]);
      const bad = await fetched('GET', path, await fetch(`${server.url}${path}`, { headers: { Prefer: 'example=nope' } }));
      expect(bad).toMatchObject({ status: 400, body: { code: 'MALFORMED_REQUEST' } });
    });
  });
});
