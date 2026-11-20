/**
 * Deterministic label fixtures of the Mock carrier (AT-US-122-03, PR075-SEC-14, D-SECPR075-03). The documents are
 * generated in code, byte for byte the same for the same tracking number and format, and carry the marker "MOCK - NOT A
 * VALID LABEL". They hold no personal data (tracking number and format only). The adapter returns them as raw
 * `{ format, content }`; it never builds a `LabelDocument` (R3-m1): the capability guard re-checks every label, and the
 * tests assert that each fixture passes `createLabelDocument` and the PDF/ZPL sniffers.
 */
import { Buffer } from 'node:buffer';

import type { DocumentFormat } from '../../canonical/codes.js';
import type { LabelDocument } from '../../canonical/types.js';

export const MOCK_LABEL_MARKER = 'MOCK - NOT A VALID LABEL';

/** Page boxes in PostScript points. */
const PAGE_POINTS: Readonly<Record<Exclude<DocumentFormat, 'ZPL'>, readonly [number, number]>> = {
  PDF_4X6: [288, 432],
  PDF_A4: [595, 842],
  PDF_LETTER: [612, 792],
};

/** Escapes the three characters that are special in a PDF literal string. */
const pdfText = (text: string): string => text.replace(/[\\()]/gu, (char) => `\\${char}`);

/** Label text keeps to the tracking-number alphabet; anything else is replaced so no input can reach the PDF syntax. */
const printable = (text: string): string => text.replace(/[^A-Za-z0-9_ .:-]/gu, '?');

function pdfDocument(format: Exclude<DocumentFormat, 'ZPL'>, trackingNumber: string): Uint8Array {
  const [width, height] = PAGE_POINTS[format];
  const stream = [
    'BT',
    '/F1 16 Tf',
    `24 ${String(height - 48)} Td`,
    `(${pdfText(MOCK_LABEL_MARKER)}) Tj`,
    '0 -28 Td',
    `(${pdfText(`Tracking: ${printable(trackingNumber)}`)}) Tj`,
    '0 -28 Td',
    `(${pdfText(`Format: ${format}`)}) Tj`,
    'ET',
  ].join('\n');
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${String(width)} ${String(height)}] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>`,
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${String(stream.length)} >>\nstream\n${stream}\nendstream`,
  ];
  let body = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((object, index) => {
    offsets.push(body.length);
    body += `${String(index + 1)} 0 obj\n${object}\nendobj\n`;
  });
  const xref = body.length;
  body += `xref\n0 ${String(objects.length + 1)}\n0000000000 65535 f \n`;
  for (const offset of offsets) body += `${String(offset).padStart(10, '0')} 00000 n \n`;
  body += `trailer\n<< /Size ${String(objects.length + 1)} /Root 1 0 R >>\nstartxref\n${String(xref)}\n%%EOF\n`;
  return Uint8Array.from(Buffer.from(body, 'latin1'));
}

function zplDocument(trackingNumber: string): Uint8Array {
  const code = printable(trackingNumber).replace(/[\^~]/gu, '?');
  const zpl = `^XA^FO30,30^A0N,30,30^FD${MOCK_LABEL_MARKER}^FS^FO30,90^A0N,26,26^FD${code}^FS^FO30,140^BCN,90,Y,N,N^FD${code}^FS^XZ\n`;
  return Uint8Array.from(Buffer.from(zpl, 'latin1'));
}

/** The Mock label of one tracking number in one document format, as the raw pair an adapter returns. */
export function mockLabel(format: DocumentFormat, trackingNumber: string): LabelDocument {
  return { format, content: format === 'ZPL' ? zplDocument(trackingNumber) : pdfDocument(format, trackingNumber) };
}
