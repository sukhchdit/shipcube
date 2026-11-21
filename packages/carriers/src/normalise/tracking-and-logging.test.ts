import { describe, expect, it, jest } from '@jest/globals';
import { money } from '@platform/shared';
import { createLogger } from '@platform/shared/logging';
import fc from 'fast-check';

import { TRACKING_STATUSES } from '../canonical/codes.js';
import { defineCarrierMappings } from './mappings.js';
import {
  MAX_RAW_LABEL_LENGTH,
  MAX_UNMAPPED_WARNINGS,
  type NormaliseLogger,
  normaliseError,
  normaliseServices,
  normaliseSurcharge,
  normaliseTrackingEvents,
  UNMAPPED_SERVICE_EVENT,
  UNMAPPED_TRACKING_EVENT,
} from './normalise.js';

const DHL = defineCarrierMappings({
  carrierCode: 'DHL_EXPRESS',
  services: { P: 'EXPRESS' },
  surcharges: { FF: 'FUEL' },
  errors: { '420504': 'POSTCODE_INVALID' },
  trackingEvents: { PU: 'PICKED_UP', OK: 'DELIVERED' },
});

function captureLogger(): { logger: NormaliseLogger; lines: { event: string; fields: unknown }[] } {
  const lines: { event: string; fields: unknown }[] = [];
  return {
    lines,
    logger: {
      warn: jest.fn((event: string, fields?: unknown) => {
        lines.push({ event, fields });
      }),
    },
  };
}
const scope = (logger: NormaliseLogger) => ({ account: { id: 'acct-1', code: 'DHL_PLATFORM_SANDBOX' }, logger });

describe('[R1-M1] tracking events are never dropped (REQ-TRACK-001, US-241)', () => {
  it('an unmapped code is kept as IN_TRANSIT with unmapped: true and one warn line that never carries the description', () => {
    const { logger, lines } = captureLogger();
    const events = [
      { code: 'PU', id: 'e1', description: 'Picked up' },
      { code: 'ZZ99', id: 'e2', description: 'Signed by Synthetic Person at 1 Main St' },
      { code: 'OK', id: 'e3', description: 'Delivered' },
      { code: 'ZZ99', id: 'e4', description: 'Again' },
    ];
    const result = normaliseTrackingEvents(DHL, events, (event) => event.code, scope(logger));
    expect(result.map(({ event, status, unmapped }) => [event.id, status, unmapped])).toEqual([
      ['e1', 'PICKED_UP', false],
      ['e2', 'IN_TRANSIT', true],
      ['e3', 'DELIVERED', false],
      ['e4', 'IN_TRANSIT', true],
    ]);
    expect(lines).toEqual([
      {
        event: UNMAPPED_TRACKING_EVENT,
        fields: { carrier: 'DHL_EXPRESS', account: 'acct-1', accountCode: 'DHL_PLATFORM_SANDBOX', eventCode: 'ZZ99' },
      },
    ]);
    expect(JSON.stringify(lines)).not.toContain('Synthetic Person');
  });

  it('property: every input event yields exactly one output event, in order, with a catalogue status', () => {
    fc.assert(
      fc.property(fc.array(fc.oneof(fc.constantFrom('PU', 'OK', 'pu'), fc.string({ maxLength: 6 })), { maxLength: 30 }), (codes) => {
        const { logger } = captureLogger();
        const result = normaliseTrackingEvents(DHL, codes, (code) => code, scope(logger));
        expect(result.map(({ event }) => event)).toEqual(codes);
        for (const { status, unmapped } of result) {
          expect(TRACKING_STATUSES).toContain(status);
          if (unmapped) expect(status).toBe('IN_TRANSIT');
        }
      }),
    );
  });
});

describe('[PR075-SEC-07] unmapped-code warnings are capped per call', () => {
  it.each([
    ['services', UNMAPPED_SERVICE_EVENT],
    ['tracking events', UNMAPPED_TRACKING_EVENT],
  ])('%s: at most MAX_UNMAPPED_WARNINGS lines plus one summary with the count', (kind, event) => {
    const { logger, lines } = captureLogger();
    const codes = Array.from({ length: 5000 }, (_value, index) => `X${String(index)}`);
    if (kind === 'services') normaliseServices(DHL, codes, (code) => code, scope(logger));
    else normaliseTrackingEvents(DHL, codes, (code) => code, scope(logger));
    expect(lines).toHaveLength(MAX_UNMAPPED_WARNINGS + 1);
    expect(lines.every((line) => line.event === event)).toBe(true);
    expect(lines.at(-1)?.fields).toEqual({
      carrier: 'DHL_EXPRESS',
      account: 'acct-1',
      accountCode: 'DHL_PLATFORM_SANDBOX',
      unmappedCount: 5000,
      logged: MAX_UNMAPPED_WARNINGS,
    });
  });

  it('exactly MAX_UNMAPPED_WARNINGS distinct codes write no summary', () => {
    const { logger, lines } = captureLogger();
    const codes = Array.from({ length: MAX_UNMAPPED_WARNINGS }, (_value, index) => `X${String(index)}`);
    normaliseServices(DHL, codes, (code) => code, scope(logger));
    expect(lines).toHaveLength(MAX_UNMAPPED_WARNINGS);
  });
});

describe('[R1-m5 / PR075-SEC-04] no URL path or carrier text reaches a log line through the cause', () => {
  it('a cause carrying a carrier URL and a name is logged as { name, code } only, through the real platform logger', () => {
    const sentinel = `Sentinel${String(Date.now())}`;
    const cause = Object.assign(
      new Error(`GET https://express.api.dhl.com/mydhlapi/test/shipments/1234567890/tracking?requestorName=${sentinel} failed`),
      {
        code: 'ECONNRESET',
      },
    );
    const error = normaliseError(DHL, { code: '420504', cause, operation: 'track' });
    expect(error.cause).toEqual({ name: 'Error', code: 'ECONNRESET' });
    const written: string[] = [];
    const platformLogger = createLogger({ service: 'test', version: '0', destination: { write: (line: string) => written.push(line) } });
    platformLogger.error('carrier.call.failed', {}, error);
    const output = written.join('\n');
    expect(output).toContain('POSTCODE_INVALID');
    expect(output).not.toContain(sentinel);
    expect(output).not.toContain('/mydhlapi/test/shipments');
    expect(output).not.toContain('1234567890');
  });

  it('a non-object cause keeps only a generic name, and a hostile name or code is dropped', () => {
    expect(normaliseError(DHL, { cause: 'raw carrier text' }).cause).toEqual({ name: 'Error' });
    expect(normaliseError(DHL, { cause: { name: 'Bad name\n', code: 'has space' } }).cause).toEqual({ name: 'Error' });
  });
});

describe('[R1-n3] CARRIER_OTHER raw labels', () => {
  it('strip format characters (bidi override, zero width) and never end in a lone surrogate', () => {
    const amount = money(1, 'USD');
    const [bidi, zeroWidth, emoji] = [0x202e, 0x200b, 0x1f600].map((point) => String.fromCodePoint(point));
    expect(normaliseSurcharge(DHL, { label: `Weird${bidi ?? ''}Fee${zeroWidth ?? ''}`, amount }).raw).toBe('Weird Fee');
    const raw = normaliseSurcharge(DHL, { label: `${'x'.repeat(MAX_RAW_LABEL_LENGTH - 1)}${emoji ?? ''}`, amount }).raw ?? '';
    expect(raw).toBe('x'.repeat(MAX_RAW_LABEL_LENGTH - 1));
    expect(/\p{Cs}/u.test(raw)).toBe(false);
  });
});
