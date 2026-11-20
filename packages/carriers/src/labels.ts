/**
 * Label documents leave an adapter only as bytes in a `document_format` (ADR-0010 am. 11 items 3 and 6, REQ-DOC-002):
 *  - the format is one of PDF_4X6 | PDF_A4 | PDF_LETTER | ZPL; raster carrier output (GIF, PNG, EPL, SPL) is refused,
 *    it survives only as a raw-payload `$blob` (am. 8) and is never offered to users;
 *  - the content is inline bytes. A string (a carrier `LabelURL`, `URL_ONLY` answer or base64 text) is refused: carrier
 *    supplied URLs are never dereferenced (PR6-SEC-06), and adapters decode base64 themselves;
 *  - PDF content starts with `%PDF-`, and ZPL content holds a `^XA` command with no PDF, raster or markup header, so a
 *    mislabelled payload cannot pass as either. The capability guard re-checks every label an adapter returns.
 * `createLabelDocument` only checks and copies; it performs no I/O.
 */
import { DOCUMENT_FORMATS, type DocumentFormat, isDocumentFormat } from './canonical/codes.js';
import type { LabelDocument } from './canonical/types.js';
import { CarrierContractError } from './errors.js';

/** `%PDF-` */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

/** Document and raster magics that are never ZPL: %PDF, PNG, GIF8, JPEG, BMP, and markup (`<`). */
const NOT_ZPL: readonly (readonly number[])[] = [
  [0x25, 0x50, 0x44, 0x46],
  [0x89, 0x50, 0x4e, 0x47],
  [0x47, 0x49, 0x46, 0x38],
  [0xff, 0xd8, 0xff],
  [0x42, 0x4d],
  [0x3c],
];
/** How far into the payload the `^XA` start-of-format command is searched (Zebra prefixes such as `CT~~CD,~CC^~CT~`). */
const ZPL_HEAD_BYTES = 1024;
const CARET = 0x5e;
const LOWER_X = 0x78;
const LOWER_A = 0x61;

/** ZPL: no foreign magic, and a `^XA` command (any case) within the first KiB (PR075-SEC-03). */
export function isZpl(bytes: Uint8Array): boolean {
  if (NOT_ZPL.some((magic) => startsWith(bytes, magic))) return false;
  const head = bytes.subarray(0, ZPL_HEAD_BYTES);
  for (let index = 0; index + 2 < head.length; index += 1) {
    if (head[index] === CARET && ((head[index + 1] ?? 0) | 0x20) === LOWER_X && ((head[index + 2] ?? 0) | 0x20) === LOWER_A) return true;
  }
  return false;
}

/** Builds a frozen label document; throws `CarrierContractError` for a non-document format or non-byte content. */
export function createLabelDocument(format: string, content: unknown): LabelDocument {
  const issues: string[] = [];
  if (!isDocumentFormat(format)) issues.push(`format ${JSON.stringify(format)} is not a document_format (${DOCUMENT_FORMATS.join(' | ')})`);
  if (!(content instanceof Uint8Array)) issues.push('content must be inline bytes (Uint8Array); carrier URLs and strings are refused');
  else if (content.length === 0) issues.push('content must not be empty');
  else if (format === 'ZPL') {
    if (!isZpl(content)) issues.push('ZPL content must be ZPL (a ^XA command, no PDF, raster or markup header)');
  } else if (isDocumentFormat(format) && !startsWith(content, PDF_MAGIC)) issues.push(`${format} content must be a PDF`);
  if (issues.length > 0) throw new CarrierContractError('invalid label document', issues);
  return Object.freeze({ format: format as DocumentFormat, content: Uint8Array.from(content as Uint8Array) });
}
