import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { DOCUMENT_FORMATS } from './canonical/codes.js';
import { CarrierContractError } from './errors.js';
import { createLabelDocument } from './labels.js';
import { monitorNetwork, type NetworkMonitor } from './tests/network-monitor.js';

const pdf = (body = 'synthetic label'): Uint8Array => new TextEncoder().encode(`%PDF-1.7\n${body}`);
const zpl = new TextEncoder().encode('^XA^FO50,50^FDSYNTHETIC^FS^XZ');

let network: NetworkMonitor;
beforeEach(() => {
  network = monitorNetwork();
});
afterEach(() => {
  network.restore();
});

describe('LabelDocument (ADR-0010 am. 11 items 3 and 6)', () => {
  it('accepts every document_format with matching bytes and copies the content', () => {
    for (const format of DOCUMENT_FORMATS) {
      const content = format === 'ZPL' ? zpl : pdf();
      const label = createLabelDocument(format, content);
      expect(label).toEqual({ format, content });
      expect(label.content).not.toBe(content);
      expect(Object.isFrozen(label)).toBe(true);
    }
  });

  it.each(['GIF', 'PNG', 'EPL', 'SPL', 'pdf_4x6', 'PDF'])(
    'refuses the raster or unknown format %s: raster output never leaves the adapter',
    (format) => {
      expect(() => createLabelDocument(format, pdf())).toThrow(/is not a document_format/u);
    },
  );

  it('refuses a carrier-supplied URL in place of label bytes, without dereferencing it', () => {
    const url = 'https://carrier.example/labels/1Z0000000000000000.pdf';
    expect(() => createLabelDocument('PDF_4X6', url)).toThrow(
      'content must be inline bytes (Uint8Array); carrier URLs and strings are refused',
    );
    expect(() => createLabelDocument('PDF_4X6', new URL(url))).toThrow(CarrierContractError);
    expect(network.attempts()).toBe(0);
  });

  it('refuses empty content and a PDF format whose bytes are not a PDF', () => {
    expect(() => createLabelDocument('PDF_A4', new Uint8Array())).toThrow('content must not be empty');
    const gif = new TextEncoder().encode('GIF89a....');
    expect(() => createLabelDocument('PDF_LETTER', gif)).toThrow('PDF_LETTER content must be a PDF');
  });

  it('property: any non-PDF byte string is refused as a PDF format and accepted as ZPL', () => {
    fc.assert(
      fc.property(
        fc.uint8Array({ minLength: 1, maxLength: 64 }).filter((bytes) => bytes[0] !== 0x25),
        (bytes) => {
          expect(() => createLabelDocument('PDF_4X6', bytes)).toThrow(CarrierContractError);
          expect(createLabelDocument('ZPL', bytes).content).toEqual(bytes);
        },
      ),
    );
  });
});
