import { randomBytes } from 'node:crypto';

import { describe, expect, it } from '@jest/globals';

import { outboundCallFields, type OutboundCallLog } from './outbound.js';
import { OMITTED } from './string-redaction.js';

const sentinel = (): string => `sentinel-${randomBytes(8).toString('hex')}`;

const BASE: OutboundCallLog = {
  carrierCode: 'DHL',
  accountId: '0b7f6a52-58e4-4d39-9a51-0d1b3f7b2a10',
  operation: 'rates',
  routeTemplate: '/mydhlapi/rates/{accountNumber}',
  status: 200,
  durationMs: 123.6,
  errorCode: 'CARRIER_TIMEOUT',
  correlationId: 'c-1',
};

describe('outboundCallFields', () => {
  it('[PR6-SEC-02 item 3] returns only the allow-listed keys, never bodies or url.*', () => {
    const value = sentinel();
    const input = {
      ...BASE,
      body: value,
      requestBody: value,
      responseBody: value,
      'url.full': `https://carrier.example/rates?x=${value}`,
      url: value,
      headers: { authorization: value },
    } as OutboundCallLog;
    const fields = outboundCallFields(input);
    expect(fields).toEqual({
      carrier_code: 'DHL',
      account_id: '0b7f6a52-58e4-4d39-9a51-0d1b3f7b2a10',
      operation: 'rates',
      route_template: '/mydhlapi/rates/{accountNumber}',
      status: 200,
      duration_ms: 124,
      error_code: 'CARRIER_TIMEOUT',
      correlation_id: 'c-1',
    });
    expect(JSON.stringify(fields)).not.toContain(value);
  });

  it.each(['/rates?account=1', '/rates#frag', 'https://carrier.example/rates', '//user@host/rates', `/${'x'.repeat(300)}`])(
    'omits a route that is not a template (%s)',
    (routeTemplate) => {
      expect(outboundCallFields({ ...BASE, routeTemplate }).route_template).toBe(OMITTED);
    },
  );

  it('writes null for absent optional values and invalid numbers', () => {
    const fields = outboundCallFields({
      carrierCode: 'UPS',
      accountId: 'a',
      operation: 'token',
      routeTemplate: '/security/v1/oauth/token',
      durationMs: Number.NaN,
    });
    expect(fields).toMatchObject({ status: null, duration_ms: null, error_code: null, correlation_id: null });
    expect(fields['route_template']).toBe('/security/v1/oauth/token');
  });

  it('clamps negative durations and ignores non-string identifiers', () => {
    const fields = outboundCallFields({ ...BASE, durationMs: -5, carrierCode: 7 } as unknown as OutboundCallLog);
    expect(fields).toMatchObject({ duration_ms: 0, carrier_code: null });
  });
});
