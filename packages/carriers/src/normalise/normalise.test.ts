import { describe, expect, it, jest } from '@jest/globals';
import fc from 'fast-check';

import {
  CARRIER_ERROR_CODES,
  CARRIER_ERROR_MESSAGES,
  type CarrierErrorCode,
  SERVICE_TIERS,
  SURCHARGE_CODES,
  type SurchargeCode,
  TRACKING_STATUSES,
} from '../canonical/codes.js';
import { CarrierContractError, CarrierError } from '../errors.js';
import { type CarrierMappingsInput, defineCarrierMappings, lookupKey, mappingIssues, mappingKey } from './mappings.js';
import {
  mapErrorCode,
  mapService,
  MAX_RAW_LABEL_LENGTH,
  type NormaliseLogger,
  normaliseError,
  normaliseServices,
  normaliseSurcharge,
  UNMAPPED_SERVICE_EVENT,
  UNPRINTABLE_CODE,
} from './normalise.js';

/** Synthetic DHL-shaped tables (the real ones arrive with TASK-135; these only exercise the mechanism). */
const DHL_INPUT: CarrierMappingsInput = {
  carrierCode: 'DHL_EXPRESS',
  services: { P: 'EXPRESS', D: 'EXPRESS', W: 'ECONOMY' },
  surcharges: { FF: 'FUEL', 'Remote Area Delivery': 'REMOTE_AREA', 'Residential Address': 'RESIDENTIAL' },
  errors: { '420504': 'POSTCODE_INVALID', 'Invalid postal code': 'POSTCODE_INVALID', '1001': 'INVALID_ADDRESS' },
  trackingEvents: { PU: 'PICKED_UP', OK: 'DELIVERED', CR: 'CUSTOMS_CLEARED' },
};
const DHL = defineCarrierMappings(DHL_INPUT);
const usd = (amountMinor: number): { amountMinor: number; currency: string } => ({ amountMinor, currency: 'USD' });

function captureLogger(): { logger: NormaliseLogger; lines: { event: string; fields: unknown }[] } {
  const lines: { event: string; fields: unknown }[] = [];
  const logger: NormaliseLogger = {
    warn: jest.fn((event: string, fields?: unknown) => {
      lines.push({ event, fields });
    }),
  };
  return { logger, lines };
}
const scope = (logger: NormaliseLogger) => ({ account: { id: 'acct-1', code: 'DHL_PLATFORM_SANDBOX' }, logger });

describe('[AT-US-124-01] a mapped service, surcharge and error', () => {
  it('[AT-US-124-01] a known service gets a canonical code (carrier code plus service code) and a tier', () => {
    const { logger, lines } = captureLogger();
    const kept = normaliseServices(DHL, [{ productCode: 'P', price: 100 }], (entry) => entry.productCode, scope(logger));
    expect(kept).toEqual([{ entry: { productCode: 'P', price: 100 }, service: { canonicalCode: 'DHL_EXPRESS_P', tier: 'EXPRESS' } }]);
    expect(SERVICE_TIERS).toContain(kept[0]?.service.tier);
    expect(lines).toEqual([]);
  });

  it('[AT-US-124-01] surcharge "Remote Area Delivery" -> REMOTE_AREA; error "Invalid postal code" -> POSTCODE_INVALID', () => {
    expect(normaliseSurcharge(DHL, { label: 'Remote Area Delivery', amount: usd(1500) })).toEqual({
      code: 'REMOTE_AREA',
      amount: usd(1500),
    });
    const error = normaliseError(DHL, { message: 'Invalid postal code', operation: 'getRates' });
    expect(error).toBeInstanceOf(CarrierError);
    expect(error.code).toBe('POSTCODE_INVALID');
    expect(error.toJSON()).toEqual({ code: 'POSTCODE_INVALID', carrier: 'DHL_EXPRESS', operation: 'getRates' });
  });

  it('[AT-US-124-01] lookups ignore case and whitespace, and the carrier code wins over the label or message', () => {
    expect(normaliseSurcharge(DHL, { label: '  remote   AREA delivery ', amount: usd(1) }).code).toBe('REMOTE_AREA');
    expect(normaliseSurcharge(DHL, { code: 'FF', label: 'Remote Area Delivery', amount: usd(1) }).code).toBe('FUEL');
    expect(mapErrorCode(DHL, { code: '1001', message: 'Invalid postal code' })).toBe('INVALID_ADDRESS');
    expect(mapService(DHL, 'p')).toEqual({ canonicalCode: 'DHL_EXPRESS_P', tier: 'EXPRESS' });
  });
});

describe('[AT-US-124-02] an unmapped service is dropped and logged', () => {
  it('[AT-US-124-02] XYZ_UNKNOWN for DHL_EXPRESS account acct-1 is absent from results and logged once with carrier, account and service code', () => {
    const { logger, lines } = captureLogger();
    const answer = [{ productCode: 'XYZ_UNKNOWN' }, { productCode: 'P' }, { productCode: 'XYZ_UNKNOWN' }];
    const kept = normaliseServices(DHL, answer, (entry) => entry.productCode, scope(logger));
    expect(kept.map(({ service }) => service.canonicalCode)).toEqual(['DHL_EXPRESS_P']);
    expect(lines).toEqual([
      {
        event: UNMAPPED_SERVICE_EVENT,
        fields: { carrier: 'DHL_EXPRESS', account: 'acct-1', accountCode: 'DHL_PLATFORM_SANDBOX', serviceCode: 'XYZ_UNKNOWN' },
      },
    ]);
  });

  it('[AT-US-124-02] a service code that is not a safe code is logged as unprintable, never verbatim', () => {
    const { logger, lines } = captureLogger();
    const hostile = 'P\nlevel=fatal msg=forged';
    expect(normaliseServices(DHL, [hostile, undefined, 'x'.repeat(500)], (code) => code, scope(logger))).toEqual([]);
    expect(lines).toHaveLength(1);
    expect(lines[0]?.fields).toMatchObject({ serviceCode: UNPRINTABLE_CODE });
    expect(JSON.stringify(lines)).not.toContain('forged');
  });

  it('property: kept services are exactly the mapped ones, in order, and every distinct unmapped code is logged once', () => {
    const codes = fc.constantFrom('P', 'D', 'W', 'p', 'ZZ', 'Q1', 'NOPE');
    fc.assert(
      fc.property(fc.array(codes, { maxLength: 20 }), (answer) => {
        const { logger, lines } = captureLogger();
        const kept = normaliseServices(DHL, answer, (code) => code, scope(logger));
        expect(kept.map(({ entry }) => entry)).toEqual(answer.filter((code) => mapService(DHL, code) !== undefined));
        const unmapped = new Set(answer.filter((code) => mapService(DHL, code) === undefined));
        expect(lines.map(({ fields }) => (fields as { serviceCode: string }).serviceCode).sort()).toEqual([...unmapped].sort());
      }),
    );
  });
});

describe('[AT-US-124-03] an unmapped surcharge becomes CARRIER_OTHER', () => {
  it('[AT-US-124-03] "Weird Fee" -> CARRIER_OTHER with the raw field keeping "Weird Fee"', () => {
    expect(normaliseSurcharge(DHL, { label: 'Weird Fee', amount: usd(250) })).toEqual({
      code: 'CARRIER_OTHER',
      amount: usd(250),
      raw: 'Weird Fee',
    });
  });

  it('[AT-US-124-03] the raw label is bounded and stripped of control characters and line breaks', () => {
    const line = normaliseSurcharge(DHL, { label: `Weird\r\nFee${String.fromCharCode(0x2028)}${'x'.repeat(300)}`, amount: usd(1) });
    expect(line.code).toBe('CARRIER_OTHER');
    expect(line.raw).toMatch(/^Weird Fee x+$/u);
    expect(line.raw?.length).toBe(MAX_RAW_LABEL_LENGTH);
  });

  it('property: every surcharge lands on a DR-B30 code, and only CARRIER_OTHER lines carry raw', () => {
    fc.assert(
      fc.property(fc.option(fc.string({ maxLength: 8 }), { nil: undefined }), fc.string({ maxLength: 40 }), (code, label) => {
        const line = normaliseSurcharge(DHL, { ...(code === undefined ? {} : { code }), label, amount: usd(1) });
        expect((SURCHARGE_CODES as readonly SurchargeCode[]).includes(line.code)).toBe(true);
        expect('raw' in line).toBe(line.code === 'CARRIER_OTHER');
      }),
    );
  });
});

describe('[AT-US-124-04] an unmapped error becomes CARRIER_UNKNOWN_ERROR', () => {
  it('[AT-US-124-04] an unrecognised code -> CARRIER_UNKNOWN_ERROR, and the message comes from the canonical code', () => {
    const rawText = 'Shipper John Smith at 1 Main St is not allowed (ref 99-ZZ)';
    const error = normaliseError(DHL, { code: '999999', message: rawText, operation: 'createShipment' });
    expect(error.code).toBe('CARRIER_UNKNOWN_ERROR');
    expect(error.message).toBe(CARRIER_ERROR_MESSAGES.CARRIER_UNKNOWN_ERROR);
    expect(error.carrierErrorCode).toBe('999999');
    expect(JSON.stringify(error)).not.toContain('John Smith');
    expect(error.message).not.toContain('John Smith');
  });

  it('[AT-US-124-04] a mapped error also never carries the raw carrier text', () => {
    const error = normaliseError(DHL, { message: 'Invalid postal code', cause: new Error('upstream 400') });
    expect(error.message).toBe(CARRIER_ERROR_MESSAGES.POSTCODE_INVALID);
    expect(error.cause).toEqual({ name: 'Error' });
    expect(mapErrorCode(DHL, {})).toBe('CARRIER_UNKNOWN_ERROR');
  });

  it('property: every carrier failure maps to a DR-B30 error code whose message is the canonical one', () => {
    fc.assert(
      fc.property(fc.option(fc.string(), { nil: undefined }), fc.option(fc.string(), { nil: undefined }), (code, message) => {
        const error = normaliseError(DHL, { ...(code === undefined ? {} : { code }), ...(message === undefined ? {} : { message }) });
        expect((CARRIER_ERROR_CODES as readonly CarrierErrorCode[]).includes(error.code)).toBe(true);
        expect(error.message).toBe(CARRIER_ERROR_MESSAGES[error.code]);
      }),
    );
  });
});

describe('[AT-US-124-05] every mapped value is in the canonical catalogue', () => {
  it('[AT-US-124-05] a table mapping to a value outside DR-B30 / DR-B18 is refused, naming the entry', () => {
    const bad = {
      ...DHL_INPUT,
      services: { P: 'PRIORITY' },
      surcharges: { X: 'HANDLING' },
      errors: { E: 'NOT_FOUND' },
      trackingEvents: { T: 'LOST' },
    } as unknown as CarrierMappingsInput;
    expect(mappingIssues(bad)).toEqual([
      'services["P"] maps to "PRIORITY", which is not one of EXPRESS | STANDARD | ECONOMY',
      `surcharges["X"] maps to "HANDLING", which is not one of ${SURCHARGE_CODES.join(' | ')}`,
      `errors["E"] maps to "NOT_FOUND", which is not one of ${CARRIER_ERROR_CODES.join(' | ')}`,
      `trackingEvents["T"] maps to "LOST", which is not one of ${TRACKING_STATUSES.join(' | ')}`,
    ]);
    expect(() => defineCarrierMappings(bad)).toThrow(CarrierContractError);
  });

  it('[AT-US-124-05] property: any table built from catalogue values is accepted, and every mapped value is a catalogue member', () => {
    const key = fc.stringMatching(/^[A-Z][A-Z0-9]{0,6}$/u);
    fc.assert(
      fc.property(
        fc.dictionary(key, fc.constantFrom(...SERVICE_TIERS)),
        fc.dictionary(key, fc.constantFrom(...SURCHARGE_CODES)),
        fc.dictionary(key, fc.constantFrom(...CARRIER_ERROR_CODES)),
        fc.dictionary(key, fc.constantFrom(...TRACKING_STATUSES)),
        (services, surcharges, errors, trackingEvents) => {
          const mappings = defineCarrierMappings({ carrierCode: 'ANY', services, surcharges, errors, trackingEvents });
          for (const { tier } of mappings.services.values()) expect(SERVICE_TIERS).toContain(tier);
          for (const code of mappings.surcharges.values()) expect(SURCHARGE_CODES).toContain(code);
          for (const code of mappings.errors.values()) expect(CARRIER_ERROR_CODES).toContain(code);
          for (const status of mappings.trackingEvents.values()) expect(TRACKING_STATUSES).toContain(status);
        },
      ),
    );
  });

  it('refuses unusable keys, colliding keys, bad service codes, a bad carrier code and missing tables', () => {
    expect(
      mappingIssues({
        ...DHL_INPUT,
        carrierCode: 'dhl',
        services: { 'P P': 'EXPRESS' },
        surcharges: { 'Fuel ': 'FUEL', fuel: 'PEAK', '   ': 'FUEL', ['x'.repeat(201)]: 'FUEL' },
      }),
    ).toEqual([
      'carrierCode must match ^[A-Z][A-Z0-9_]{1,31}$',
      `services["P P"] is not a valid carrier service code (^[A-Za-z0-9][A-Za-z0-9_-]{0,31}$)`,
      'surcharges["fuel"] collides with "Fuel " after normalisation',
      'surcharges["   "] is not a usable key (empty or longer than 200)',
      `surcharges["${'x'.repeat(201)}"] is not a usable key (empty or longer than 200)`,
    ]);
    expect(mappingIssues({ ...DHL_INPUT, errors: null } as unknown as CarrierMappingsInput)).toEqual(['errors must be an object']);
  });

  it('inherited property names never resolve to a mapping', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty']) {
      expect(mapService(DHL, name)).toBeUndefined();
      expect(mapErrorCode(DHL, { code: name, message: name })).toBe('CARRIER_UNKNOWN_ERROR');
      expect(normaliseSurcharge(DHL, { code: name, label: name, amount: usd(1) }).code).toBe('CARRIER_OTHER');
    }
  });

  it('mappingKey and lookupKey normalise carrier strings', () => {
    expect(mappingKey('  Remote\tArea  delivery ')).toBe('REMOTE AREA DELIVERY');
    expect(lookupKey('')).toBeUndefined();
    expect(lookupKey(42)).toBeUndefined();
    expect(lookupKey('x'.repeat(201))).toBeUndefined();
  });
});
