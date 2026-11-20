import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { CARRIER_ERROR_MESSAGES } from './canonical/codes.js';
import { createCarrierContext } from './context.js';
import { type CarrierEgress, defineCarrierEgress, deriveCarrierEgressRules, type EgressAccount, egressIssues } from './egress.js';
import { CarrierError, safeCause } from './errors.js';
import { createLabelDocument, isZpl } from './labels.js';
import type { CarrierOperation } from './operations.js';

const bytes = (text: string): Uint8Array => new TextEncoder().encode(text);

describe('[PR075-SEC-03] ZPL content must be ZPL', () => {
  it.each([
    ['plain', '^XA^FO50,50^FDSYNTHETIC^FS^XZ'],
    ['CR/LF lead', '\r\n^XA^FDX^FS^XZ'],
    ['Zebra prefix', 'CT~~CD,~CC^~CT~\n^XA^FDX^FS^XZ'],
    ['lower case', '^xa^fdx^fs^xz'],
    ['graphic before the format', '~DGR:LOGO.GRF,4,1,FF00FF00\n^XA^XGR:LOGO.GRF^FS^XZ'],
  ])('accepts %s ZPL', (_label, text) => {
    expect(isZpl(bytes(text))).toBe(true);
    expect(createLabelDocument('ZPL', bytes(text)).format).toBe('ZPL');
  });

  it.each([
    ['PDF', [0x25, 0x50, 0x44, 0x46, 0x2d, 0x5e, 0x58, 0x41]],
    ['PNG', [0x89, 0x50, 0x4e, 0x47, 0x5e, 0x58, 0x41]],
    ['GIF', [0x47, 0x49, 0x46, 0x38, 0x5e, 0x58, 0x41]],
    ['JPEG', [0xff, 0xd8, 0xff, 0x5e, 0x58, 0x41]],
    ['BMP', [0x42, 0x4d, 0x5e, 0x58, 0x41]],
    ['HTML', [...bytes('<html>^XA</html>')]],
    ['EPL', [...bytes('N\nA50,0,0,1,1,1,N,"SYNTHETIC"\nP1\n')]],
  ])('refuses %s bytes as ZPL', (_label, payload) => {
    expect(() => createLabelDocument('ZPL', Uint8Array.from(payload))).toThrow('ZPL content must be ZPL');
  });

  it('property: bytes without a ^XA command are never ZPL', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 64 }).filter((value) => !/\^xa/iu.test(String.fromCharCode(...value))),
        (value) => {
          expect(isZpl(value)).toBe(false);
        },
      ),
    );
  });
});

describe('[PR075-SEC-05] CarrierError validates its fields at run time', () => {
  it('an unknown code becomes CARRIER_UNKNOWN_ERROR with its canonical message', () => {
    for (const code of ['NOT_A_CODE', 'toString', '__proto__']) {
      const error = new CarrierError(code as 'TIMEOUT');
      expect(error.code).toBe('CARRIER_UNKNOWN_ERROR');
      expect(error.message).toBe(CARRIER_ERROR_MESSAGES.CARRIER_UNKNOWN_ERROR);
    }
  });

  it('a carrier, operation or carrier error code outside its shape is dropped', () => {
    const error = new CarrierError('TIMEOUT', {
      carrier: 'DHL\r\ninjected',
      operation: 'x y' as CarrierOperation,
      carrierErrorCode: 1001 as unknown as string,
    });
    expect(error.toJSON()).toEqual({ code: 'TIMEOUT' });
  });

  it('safeCause keeps a class name and a safe code only', () => {
    expect(safeCause(undefined)).toBeUndefined();
    expect(safeCause(null)).toBeUndefined();
    expect(safeCause(new TypeError('Jane Doe, 1 Main St'))).toEqual({ name: 'TypeError' });
    expect(safeCause({ code: 'ECONNRESET' })).toEqual({ name: 'Error', code: 'ECONNRESET' });
  });
});

describe('[PR075-SEC-02 (a)] a sandbox list may not cover production entries on the same origin', () => {
  const table = (sandbox: Record<string, unknown>[], production: Record<string, unknown>[]): unknown => ({
    sandbox: sandbox.map((rule) => ({ tier: 'sandbox', ...rule })),
    production: production.map((rule) => ({ tier: 'production', ...rule })),
  });

  it.each([
    ['DHL sandbox prefix = production prefix', [{ origin: 'https://express.api.dhl.com', pathPrefixes: ['/mydhlapi/'] }]],
    ['DHL sandbox prefix /', [{ origin: 'https://express.api.dhl.com', pathPrefixes: ['/'] }]],
  ])('refuses %s', (_label, sandbox) => {
    const issues = egressIssues(table(sandbox, [{ origin: 'https://express.api.dhl.com', pathPrefixes: ['/mydhlapi/'] }]));
    expect(issues).toEqual([expect.stringContaining('reaches the production entry /mydhlapi/ on https://express.api.dhl.com')]);
  });

  it('refuses a production host copied into sandbox, and UPS production /api/ in sandbox', () => {
    expect(
      egressIssues(
        table([{ origin: 'https://apis.fedex.com', pathPrefixes: ['/'] }], [{ origin: 'https://apis.fedex.com', pathPrefixes: ['/'] }]),
      ),
    ).toHaveLength(1);
    expect(
      egressIssues(
        table(
          [{ origin: 'https://onlinetools.ups.com', pathPrefixes: ['/api/'] }],
          [{ origin: 'https://onlinetools.ups.com', pathPrefixes: ['/api/'] }],
        ),
      ),
    ).toHaveLength(1);
  });

  it('keeps a shared exact path (a token endpoint) and the nested DHL layout valid', () => {
    expect(
      egressIssues(
        table(
          [{ origin: 'https://api.carrier.example', pathPrefixes: ['/v1/test/', '/oauth/token'] }],
          [{ origin: 'https://api.carrier.example', pathPrefixes: ['/v1/', '/oauth/token'] }],
        ),
      ),
    ).toEqual([]);
    expect(
      egressIssues(
        table(
          [{ origin: 'https://express.api.dhl.com', pathPrefixes: ['/mydhlapi/test/'] }],
          [{ origin: 'https://express.api.dhl.com', pathPrefixes: ['/mydhlapi/'] }],
        ),
      ),
    ).toEqual([]);
  });
});

describe('[PR075-SEC-06] the EGRESS schema is closed', () => {
  it('refuses unknown table keys and unknown rule keys', () => {
    expect(egressIssues({ sandbox: [], production: [], staging: [] })).toEqual([
      'EGRESS.staging is not an environment (sandbox | production)',
    ]);
    expect(
      egressIssues({
        sandbox: [{ origin: 'https://x.example', pathPrefixes: ['/'], tier: 'sandbox', allowRedirects: true }],
        production: [],
      }),
    ).toEqual(['EGRESS.sandbox[0].allowRedirects is not a rule field']);
  });

  it('copies only origin, pathPrefixes and tier', () => {
    const rule = { origin: 'https://x.example', pathPrefixes: ['/'], tier: 'sandbox' as const };
    const defined = defineCarrierEgress('X', { sandbox: [rule], production: [] });
    expect(Object.keys(defined.sandbox[0] ?? {}).sort()).toEqual(['origin', 'pathPrefixes', 'tier']);
  });

  it('[R1-n10] an account environment outside the union is a named issue', () => {
    const egress: Record<string, CarrierEgress> = { X: defineCarrierEgress('X', { sandbox: [], production: [] }) };
    const account = { code: 'X_ACCOUNT', carrierCode: 'X', environment: 'live', enabled: true } as unknown as EgressAccount;
    expect(() => deriveCarrierEgressRules({ accounts: [account], egress, appEnv: 'local' })).toThrow(
      'account X_ACCOUNT has an environment other than sandbox or production',
    );
  });
});

describe('[R1-n8] context locales', () => {
  it('accepts a numeric region (es-419)', () => {
    const ctx = createCarrierContext({
      account: { id: 'acct-1', code: 'X_ACCOUNT', carrierCode: 'X_CARRIER', environment: 'sandbox' },
      correlationId: 'corr-0123456789',
      deadlineAt: new Date(0),
      locale: 'es-419',
    });
    expect(ctx.locale).toBe('es-419');
  });
});
