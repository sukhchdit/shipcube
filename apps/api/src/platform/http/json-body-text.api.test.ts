/**
 * The JSON body boundary refuses text that cannot be stored (PR42-SEC-15 (c), D-TASK025-13/-27): a parsed body with a
 * NUL or a lone surrogate in any string value or object key, at any depth, answers 400 MALFORMED_REQUEST from the body
 * parser, so no route (and no audit write, no JSONB column) ever sees it. Real createApp over a real listener; the
 * bodies are sent as raw JSON text with `\u` escapes, the only way to carry either through UTF-8.
 */
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import Joi from 'joi';

import { createApp, type AppLogger } from '../../app.js';
import { fixtureRoute } from '../routing/tests/fixture-route.js';

const echoed: unknown[] = [];
const logger: AppLogger = { info: () => undefined, debug: () => undefined, error: () => undefined };
const echo = fixtureRoute({
  operationId: 'echoText',
  method: 'post',
  path: '/echo-text',
  // Closed, as defineRoute requires; the refused bodies never reach validation (the parser answers first).
  schema: { body: Joi.object({ name: Joi.string(), note: Joi.string(), [`k${String.fromCodePoint(0x1f600)}`]: Joi.string() }) },
  handler: ({ input }) => {
    echoed.push(input.body);
    return { status: 201, body: { received: true } };
  },
});

let server: Server;
let base: string;

beforeAll(async () => {
  const app = createApp({ health: [], modules: [{ name: 'fixtures', routes: [echo] }], logger });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>((resolve) => server.once('listening', () => resolve()));
  base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}/api/v1`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

async function post(json: string): Promise<{ status: number; contentType: string | null; body: Record<string, unknown> }> {
  const response = await fetch(`${base}/echo-text`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: json,
    signal: AbortSignal.timeout(5_000),
  });
  return {
    status: response.status,
    contentType: response.headers.get('content-type'),
    body: (await response.json()) as Record<string, unknown>,
  };
}

describe('[PR42-SEC-15] the JSON body boundary refuses unstorable text', () => {
  it.each([
    ['NUL in a top-level string', '{"a":"x\\u0000y"}'],
    ['NUL in a nested key', '{"a":{"b":{"k\\u0000":1}}}'],
    ['a lone high surrogate in a key', '{"k\\ud800":"v"}'],
    ['a lone low surrogate in an array string', '{"a":[1,["\\udc00x"]]}'],
    ['the colliding-key pair (k + U+D800, k + U+DBFF)', '{"k\\ud800":1,"k\\udbff":2}'],
    ['NUL at the bottom of a 5 000-deep array', `${'['.repeat(5_000)}"\\u0000"${']'.repeat(5_000)}`],
  ])('[PR42-SEC-15] a body with NUL or a lone surrogate in a string or a key answers 400 MALFORMED_REQUEST: %s', async (_label, json) => {
    const before = echoed.length;
    const res = await post(json);
    expect(res.status).toBe(400);
    expect(res.contentType).toMatch(/^application\/problem\+json(;|$)/u);
    expect(res.body).toMatchObject({ status: 400, code: 'MALFORMED_REQUEST' });
    expect(echoed).toHaveLength(before);
  });

  it.each([
    ['a surrogate pair (emoji) in a key and a value', '{"k\\ud83d\\ude00":"smile \\ud83d\\ude00"}'],
    ['ordinary unicode', '{"name":"Zo\\u00eb \\u6771\\u4eac","note":"caf\\u00e9"}'],
  ])('accepts %s and the route receives it unchanged', async (_label, json) => {
    const before = echoed.length;
    const res = await post(json);
    expect(res.status).toBe(201);
    expect(echoed.slice(before)).toEqual([JSON.parse(json)]);
  });

  it('keeps the existing answers: 415 for a non-JSON body, 400 for a parse error', async () => {
    const plain = await fetch(`${base}/echo-text`, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain' },
      body: 'a',
      signal: AbortSignal.timeout(5_000),
    });
    expect(plain.status).toBe(415);
    await plain.body?.cancel();
    const broken = await post('{"a":');
    expect(broken.status).toBe(400);
  });
});
