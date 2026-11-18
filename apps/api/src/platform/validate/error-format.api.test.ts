// US-036 acceptance tests (AT-US-036-01..03) against the real createApp with defineRoute fixture routes; no database.
// The problem body comes from the catalogue (status, title, derived type URI); a validation failure lists every
// failing field of every request part with a pointer, a stable sub-code and a message, capped at 50 items.
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { AppError, ERROR_CATALOGUE, MAX_VALIDATION_ISSUES } from '@platform/shared';
import Joi from 'joi';

import { createApp, type AppLogger } from '../../app.js';
import { CORRELATION_ID_PATTERN } from '../context/request-context.js';
import { defaultPipelineSlots } from '../routing/pipeline.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';
import { closeLoopbackServer, fetchOnce, LOOPBACK_TEST_TIMEOUT_MS } from '../routing/tests/loopback.js';
import { VALIDATION_SUB_CODES } from './validate.js';

const logger: AppLogger = { info: () => undefined, debug: () => undefined, error: () => undefined };

/** 80 optional integer fields f00..f79: one request can make each of them fail. */
const WIDE_FIELDS = Object.fromEntries(
  Array.from({ length: 80 }, (_, index) => [`f${String(index).padStart(2, '0')}`, Joi.number().integer()]),
);

const routes = [
  fixtureRoute({
    operationId: 'createContact',
    method: 'post',
    path: '/contacts',
    schema: {
      query: Joi.object({ limit: Joi.number().integer().min(1).max(100) }),
      body: Joi.object({ email: Joi.string().email().required(), name: Joi.string().min(1).max(100).required() }),
    },
    handler: () => {
      throw new AppError('CONFLICT', { detail: 'A contact with this e-mail already exists.' });
    },
  }),
  fixtureRoute({
    operationId: 'createWide',
    method: 'post',
    path: '/wide',
    schema: { body: Joi.object(WIDE_FIELDS) },
    handler: () => ({ status: 204 }),
  }),
];

const compose = (problemTypeBase?: string) =>
  createApp({
    health: [],
    modules: [{ name: 'contacts', routes }],
    logger,
    pipeline: defaultPipelineSlots({ tenantTx: undefined }),
    ...(problemTypeBase === undefined ? {} : { problemTypeBase }),
  });

jest.setTimeout(LOOPBACK_TEST_TIMEOUT_MS);

const servers: Server[] = [];
const bases: string[] = [];

beforeAll(async () => {
  for (const app of [compose(), compose('https://docs.brand.invalid/problems/')]) {
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>((resolve) => server.once('listening', () => resolve()));
    servers.push(server);
    bases.push(`http://127.0.0.1:${String((server.address() as AddressInfo).port)}`);
  }
});
afterAll(async () => {
  await Promise.all(servers.map((server) => closeLoopbackServer(server)));
});

interface Answer {
  readonly status: number;
  readonly contentType: string | null;
  readonly body: Record<string, unknown>;
}

/** POSTs JSON to the default app (or the branded one) through a fresh loopback socket. */
async function post(path: string, body: unknown, branded = false): Promise<Answer> {
  const response = await fetchOnce(`${bases[branded ? 1 : 0] ?? ''}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe('US-036 error catalogue and validation error format', () => {
  it('[AT-US-036-01] a 409 CONFLICT is application/problem+json with code CONFLICT and the type URI derived from the code', async () => {
    const res = await post('/api/v1/contacts', { email: 'asha@example.com', name: 'Asha' });
    expect(res.status).toBe(409);
    expect(res.contentType).toMatch(/^application\/problem\+json(;|$)/);
    expect(res.body).toEqual({
      type: 'https://docs.platform.invalid/problems/CONFLICT',
      title: ERROR_CATALOGUE.CONFLICT.title,
      status: 409,
      detail: 'A contact with this e-mail already exists.',
      instance: '/api/v1/contacts',
      code: 'CONFLICT',
      correlation_id: expect.stringMatching(CORRELATION_ID_PATTERN),
    });
  });

  it('[AT-US-036-01] the type URI follows the configured documentation base (brand domain)', async () => {
    const res = await post('/api/v1/contacts', { email: 'asha@example.com', name: 'Asha' }, true);
    expect(res.body).toMatchObject({ code: 'CONFLICT', type: 'https://docs.brand.invalid/problems/CONFLICT' });
  });

  it('[AT-US-036-02] an invalid email, an empty name and limit=0 are all reported: /body/email, /body/name, /query/limit', async () => {
    const res = await post('/api/v1/contacts?limit=0', { email: 'not-an-email', name: '' });
    expect(res.status).toBe(400);
    expect(res.contentType).toMatch(/^application\/problem\+json(;|$)/);
    expect(res.body).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      type: 'https://docs.platform.invalid/problems/VALIDATION_ERROR',
    });
    const errors = res.body['errors'] as { pointer: string; code: string; message: string }[];
    expect([...errors].sort((a, b) => a.pointer.localeCompare(b.pointer))).toEqual([
      { pointer: '/body/email', code: 'INVALID_FORMAT', message: VALIDATION_SUB_CODES.INVALID_FORMAT },
      { pointer: '/body/name', code: 'TOO_SHORT', message: VALIDATION_SUB_CODES.TOO_SHORT },
      { pointer: '/query/limit', code: 'OUT_OF_RANGE', message: VALIDATION_SUB_CODES.OUT_OF_RANGE },
    ]);
    for (const item of errors) {
      expect(Object.keys(item).sort()).toEqual(['code', 'message', 'pointer']);
      expect(item.code).toMatch(/^[A-Z][A-Z0-9_]*$/);
    }
  });

  it('[AT-US-036-02] a request value never appears in the problem body', async () => {
    const res = await post('/api/v1/contacts', { email: 'secret-value-123', name: 'x'.repeat(101) });
    expect(res.status).toBe(400);
    expect(JSON.stringify(res.body)).not.toContain('secret-value-123');
  });

  it('[AT-US-036-03] a request with 80 invalid fields gets exactly 50 errors', async () => {
    const body = Object.fromEntries(Object.keys(WIDE_FIELDS).map((key) => [key, 'not-a-number']));
    const res = await post('/api/v1/wide', body);
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ code: 'VALIDATION_ERROR' });
    const errors = res.body['errors'] as { pointer: string; code: string }[];
    expect(errors).toHaveLength(MAX_VALIDATION_ISSUES);
    expect(MAX_VALIDATION_ISSUES).toBe(50);
    expect(new Set(errors.map((item) => item.pointer)).size).toBe(50);
    expect(errors.every((item) => item.code === 'INVALID_TYPE')).toBe(true);
  });
});
