/**
 * Label fixtures of the Mock carrier (TASK-075 code review R3-m1, PR075-SEC-14, D-SECPR075-03): every PDF and ZPL
 * fixture passes `createLabelDocument` and the sniffers, including the lead-byte cases of the fixture review (a blank or
 * BOM lead byte, and a `%PDF-` marker past offset 0). The fixtures are generated in code; nothing binary is committed.
 */
import { Buffer } from 'node:buffer';

import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';

import { DOCUMENT_FORMATS, type DocumentFormat } from '../../canonical/codes.js';
import { createLabelDocument, isPdf, isZpl } from '../../labels.js';
import { MOCK_LABEL_MARKER, mockLabel } from './labels.js';
import { textOf } from './tests/support.js';

const NUMBER = 'MOCK123456789012';
const BOM = [0xef, 0xbb, 0xbf];
const withPrefix = (prefix: readonly number[], content: Uint8Array): Uint8Array => Uint8Array.from([...prefix, ...content]);
const blanks = (count: number): number[] => Array.from({ length: count }, (_unused, index) => [0x20, 0x0a, 0x00, 0x0d][index % 4] ?? 0x20);
const sniffed = (format: DocumentFormat, content: Uint8Array): boolean => (format === 'ZPL' ? isZpl(content) : isPdf(content));

describe('Mock label fixtures', () => {
  it.each(DOCUMENT_FORMATS)(
    '[AT-US-122-03] %s: passes createLabelDocument and its sniffer, carries the marker, is byte-stable',
    (format) => {
      const label = mockLabel(format, NUMBER);
      const document = createLabelDocument(label.format, label.content);
      expect(document.format).toBe(format);
      expect(sniffed(format, label.content)).toBe(true);
      expect(textOf(label.content)).toContain(MOCK_LABEL_MARKER);
      expect(textOf(label.content)).toContain(NUMBER);
      expect(Buffer.from(mockLabel(format, NUMBER).content).equals(Buffer.from(label.content))).toBe(true);
      expect(Buffer.from(mockLabel(format, 'MOCK000000000002').content).equals(Buffer.from(label.content))).toBe(false);
      // the label never claims to be the other kind of document
      expect(format === 'ZPL' ? isPdf(label.content) : isZpl(label.content)).toBe(false);
    },
  );

  it.each(['PDF_4X6', 'PDF_A4', 'PDF_LETTER'] as const)('%s: the PDF is well formed (xref offsets, stream length, page box)', (format) => {
    const text = textOf(mockLabel(format, NUMBER).content);
    expect(text.startsWith('%PDF-1.4\n')).toBe(true);
    expect(text.endsWith('%%EOF\n')).toBe(true);
    const startxref = Number(/startxref\n(\d+)\n/u.exec(text)?.[1]);
    expect(text.slice(startxref, startxref + 4)).toBe('xref');
    const entries = text.slice(startxref).match(/^\d{10} 00000 n $/gmu) ?? [];
    expect(entries).toHaveLength(5);
    entries.forEach((entry, index) => {
      const offset = Number(entry.slice(0, 10));
      expect(text.slice(offset, offset + `${String(index + 1)} 0 obj`.length)).toBe(`${String(index + 1)} 0 obj`);
    });
    const length = Number(/\/Length (\d+) >>/u.exec(text)?.[1]);
    const stream = /stream\n([\s\S]*?)\nendstream/u.exec(text)?.[1] ?? '';
    expect(stream).toHaveLength(length);
    const box = /\/MediaBox \[0 0 (\d+) (\d+)\]/u.exec(text);
    expect([Number(box?.[1]), Number(box?.[2])]).toEqual({ PDF_4X6: [288, 432], PDF_A4: [595, 842], PDF_LETTER: [612, 792] }[format]);
  });

  it.each(DOCUMENT_FORMATS)('[AT-US-122-03] %s: a blank or BOM lead byte is still accepted (PR075-SEC-14)', (format) => {
    const { content } = mockLabel(format, NUMBER);
    for (const prefix of [[0x20], [0x0a], [0x00], BOM, [...BOM, 0x20, 0x0a], blanks(100)]) {
      const prefixed = withPrefix(prefix, content);
      expect(sniffed(format, prefixed)).toBe(true);
      expect(() => createLabelDocument(format, prefixed)).not.toThrow();
    }
  });

  it('[AT-US-122-03] a PDF marker past offset 0 is accepted within 1024 bytes of blanks and refused beyond (PR075-SEC-14)', () => {
    const { content } = mockLabel('PDF_4X6', NUMBER);
    expect(isPdf(withPrefix(blanks(1000), content))).toBe(true);
    expect(isPdf(withPrefix(blanks(1023), content))).toBe(true);
    expect(isPdf(withPrefix(blanks(1024), content))).toBe(false);
    expect(() => createLabelDocument('PDF_4X6', withPrefix(blanks(2000), content))).toThrow();
  });

  it('[AT-US-122-03] other data before the header is refused: markup, a raster header, a stray byte', () => {
    const pdf = mockLabel('PDF_4X6', NUMBER).content;
    const zpl = mockLabel('ZPL', NUMBER).content;
    const html = [...Buffer.from('<html>')];
    for (const prefix of [html, [0x89, 0x50, 0x4e, 0x47], [0x47, 0x49, 0x46, 0x38], [0x41]]) {
      expect(isPdf(withPrefix(prefix, pdf))).toBe(false);
      expect(() => createLabelDocument('PDF_4X6', withPrefix(prefix, pdf))).toThrow();
      expect(() => createLabelDocument('ZPL', withPrefix(html, zpl))).toThrow();
    }
    // a PDF is not ZPL and ZPL is not a PDF, whatever the declared format says
    expect(() => createLabelDocument('ZPL', pdf)).toThrow();
    expect(() => createLabelDocument('PDF_A4', zpl)).toThrow();
  });

  it('[AT-US-122-03] property: any tracking text yields labels that still pass; no input reaches PDF or ZPL syntax', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 60 }), (trackingNumber) => {
        for (const format of DOCUMENT_FORMATS) {
          const { content } = mockLabel(format, trackingNumber);
          expect(() => createLabelDocument(format, content)).not.toThrow();
          const text = textOf(content);
          if (format === 'ZPL') expect(text.match(/\^XA/gu)).toHaveLength(1);
          else expect(text.match(/\(/gu)?.length).toBe(text.match(/\)/gu)?.length);
        }
      }),
      { numRuns: 100 },
    );
    const hostile = textOf(mockLabel('ZPL', 'A^XZ^XA~DG').content);
    expect(hostile).toContain('A?XZ?XA?DG');
    expect(textOf(mockLabel('PDF_4X6', 'A)Tj(B').content)).toContain('Tracking: A?Tj?B');
  });
});
