// SPK-01 throwaway: which baseline runtime deps load under the Jest unit project (swc -> CommonJS)?
import { describe, expect, it } from '@jest/globals';

const candidates = [
  'jose',
  'uuid',
  'p-limit',
  'canonicalize',
  'otplib',
  'cookie',
  'bowser',
  'joi',
  'pino',
  'express',
  'opossum',
  'bullmq',
  'ioredis',
  'pg',
  '@prisma/adapter-pg',
  'stripe',
  'helmet',
  'zod',
  'axios',
  'fast-check',
  'nock',
  'supertest',
  'testcontainers',
];

describe('SPK-01 ESM interop under Jest CJS transform', () => {
  it.each(candidates)('loads %s', async (name) => {
    let error: unknown;
    try {
      const mod: unknown = await import(name);
      expect(mod).toBeDefined();
    } catch (e) {
      error = e;
    }
    // Report instead of failing so one run lists every package.
    console.log(`${name}: ${error === undefined ? 'OK' : `FAIL ${String(error).split('\n')[0]}`}`);
  });
});

import { SignJWT, generateKeyPair, jwtVerify } from 'jose';
import { v7 } from 'uuid';
import nock from 'nock';
import canonicalize from 'canonicalize';
import { parseCookie } from 'cookie';
describe('SPK-01 ESM functional', () => {
  it('jose ES256 sign/verify, uuid v7, canonicalize, cookie, nock', async () => {
    const { privateKey, publicKey } = await generateKeyPair('ES256');
    const jwt = await new SignJWT({ sub: 'x' }).setProtectedHeader({ alg: 'ES256' }).sign(privateKey);
    expect((await jwtVerify(jwt, publicKey)).payload.sub).toBe('x');
    expect(v7()).toMatch(/^[0-9a-f-]{36}$/);
    expect(canonicalize({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
    expect(parseCookie('a=1')['a']).toBe('1');
    nock('https://example.test').get('/').reply(200, 'ok');
    expect(await (await fetch('https://example.test/')).text()).toBe('ok');
    nock.cleanAll();
  });
});
