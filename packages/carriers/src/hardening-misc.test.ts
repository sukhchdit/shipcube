import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { CARRIER_ERROR_MESSAGES } from './canonical/codes.js';
import { createCarrierContext } from './context.js';
import { type CarrierEgress, defineCarrierEgress, deriveCarrierEgressRules, type EgressAccount, egressIssues } from './egress.js';
import { CarrierError, safeCause } from './errors.js';
import { createLabelDocument, isPdf, isZpl } from './labels.js';
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

describe('[R2-m1] label checks have no false negatives on real shapes', () => {
  it('accepts ZPL whose ~DG graphic preamble is 4,800 bytes long', () => {
    const preamble = `~DGR:LOGO.GRF,2400,30,${'F0'.repeat(2389)}\n`;
    const label = bytes(`${preamble}^XA^XGR:LOGO.GRF,1,1^FS^XZ`);
    expect(label.length).toBeGreaterThan(4800);
    expect(createLabelDocument('ZPL', label).format).toBe('ZPL');
  });

  it('accepts a PDF with a UTF-8 BOM or CR/LF before %PDF- and refuses one whose header is beyond 1024 bytes', () => {
    const bom = Uint8Array.from([0xef, 0xbb, 0xbf, ...bytes('%PDF-1.7 synthetic')]);
    expect(createLabelDocument('PDF_4X6', bom).format).toBe('PDF_4X6');
    expect(createLabelDocument('PDF_A4', bytes('\r\n%PDF-1.4 synthetic')).format).toBe('PDF_A4');
    expect(() => createLabelDocument('PDF_A4', bytes(`${' '.repeat(1024)}%PDF-1.4`))).toThrow('PDF_A4 content must be a PDF');
    expect(() => createLabelDocument('PDF_A4', bytes('%PDF%PD%'))).toThrow('PDF_A4 content must be a PDF');
  });

  it('[R3-n1] a header that starts at byte 1020 and ends past byte 1024 is accepted', () => {
    expect(createLabelDocument('PDF_A4', bytes(`${'\n'.repeat(1020)}%PDF-1.7 synthetic`)).format).toBe('PDF_A4');
  });
});

describe('[PR075-SEC-14] only blank or BOM bytes may precede a header', () => {
  const BOM = [0xef, 0xbb, 0xbf];
  const PNG_HEADER = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  it.each([
    ['HTML, then %PDF- at byte 60', [...bytes(`<html><script>x</script>${' '.repeat(36)}%PDF-1.7`)]],
    ['a PNG header, 32 bytes, then %PDF-', [...PNG_HEADER, ...new Array<number>(32).fill(0x41), ...bytes('%PDF-1.7')]],
    ['ZPL, then %PDF- (a mislabel)', [...bytes('^XA^FDX^FS^XZ\n%PDF-1.7')]],
  ])('refuses %s as a PDF', (_label, payload) => {
    expect(() => createLabelDocument('PDF_4X6', Uint8Array.from(payload))).toThrow('PDF_4X6 content must be a PDF');
  });

  it.each([
    ['LF, then a PDF holding ^xa', [0x0a, ...bytes('%PDF-1.7 binary ^xa data')]],
    ['a BOM, then PNG bytes holding ^xa', [...BOM, ...PNG_HEADER, ...bytes('^xa')]],
    ['a space, then HTML holding ^XA', [...bytes(' <html>^XA</html>')]],
  ])('refuses %s as ZPL', (_label, payload) => {
    expect(() => createLabelDocument('ZPL', Uint8Array.from(payload))).toThrow('ZPL content must be ZPL');
  });

  it('still accepts BOM- and CR/LF-led PDFs and a BOM-led ZPL', () => {
    expect(createLabelDocument('PDF_4X6', Uint8Array.from([...BOM, ...bytes('%PDF-1.7')])).format).toBe('PDF_4X6');
    expect(createLabelDocument('PDF_LETTER', bytes('\r\n%PDF-1.7')).format).toBe('PDF_LETTER');
    expect(createLabelDocument('ZPL', Uint8Array.from([...BOM, ...bytes('^XA^FDX^FS^XZ')])).format).toBe('ZPL');
  });

  it('property: after any blank/BOM lead, a PNG, GIF, JPEG, BMP or markup header is neither ZPL nor PDF', () => {
    const magics = [PNG_HEADER, [...bytes('GIF89a')], [0xff, 0xd8, 0xff, 0xe0], [...bytes('BM')], [...bytes('<svg')]];
    fc.assert(
      fc.property(
        fc.array(fc.constantFrom(0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20, ...BOM), { maxLength: 16 }),
        fc.constantFrom(...magics),
        fc.uint8Array({ maxLength: 32 }),
        (lead, magic, tail) => {
          const payload = Uint8Array.from([...lead, ...magic, ...bytes('^XA%PDF-'), ...tail]);
          expect(isZpl(payload)).toBe(false);
          expect(isPdf(payload)).toBe(false);
        },
      ),
    );
  });
});

describe('[R2-n4 / PR075-SEC-11] cross-tier egress, exact paths and other carriers', () => {
  const rule = (origin: string, pathPrefixes: string[], tier: 'sandbox' | 'production') => ({ origin, pathPrefixes, tier });

  it('refuses a sandbox exact path under a production prefix on the same origin, keeping a shared exact path valid', () => {
    expect(
      egressIssues({
        sandbox: [rule('https://onlinetools.ups.com', ['/api/rates'], 'sandbox')],
        production: [rule('https://onlinetools.ups.com', ['/api/'], 'production')],
      }),
    ).toEqual(['EGRESS.sandbox[0] /api/rates lies under the production prefix /api/ on https://onlinetools.ups.com']);
    expect(
      egressIssues({
        sandbox: [rule('https://api.carrier.example', ['/v1/test/', '/v1/token'], 'sandbox')],
        production: [rule('https://api.carrier.example', ['/v1/', '/v1/token'], 'production')],
      }),
    ).toEqual([]);
  });

  it("refuses a sandbox list that reaches another carrier's production host", () => {
    const egress: Record<string, CarrierEgress> = {
      FEDEX: defineCarrierEgress('FEDEX', {
        sandbox: [rule('https://apis-sandbox.fedex.com', ['/'], 'sandbox')],
        production: [rule('https://apis.fedex.com', ['/'], 'production')],
      }),
      NEWCO: defineCarrierEgress('NEWCO', { sandbox: [rule('https://apis.fedex.com', ['/'], 'sandbox')], production: [] }),
    };
    const account = (carrierCode: string): EgressAccount => ({
      code: `${carrierCode}_SANDBOX`,
      carrierCode,
      environment: 'sandbox',
      enabled: true,
    });
    expect(() => deriveCarrierEgressRules({ accounts: [account('NEWCO')], egress, appEnv: 'local' })).toThrow(
      'NEWCO EGRESS.sandbox[0] / reaches the production entry / on https://apis.fedex.com',
    );
    expect(deriveCarrierEgressRules({ accounts: [account('FEDEX')], egress, appEnv: 'local' })).toEqual(egress.FEDEX?.sandbox);
  });
});
