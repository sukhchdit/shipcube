/**
 * Label documents leave an adapter only as bytes in a `document_format` (ADR-0010 am. 11 items 3 and 6, REQ-DOC-002):
 *  - the format is one of PDF_4X6 | PDF_A4 | PDF_LETTER | ZPL; raster carrier output (GIF, PNG, EPL, SPL) is refused,
 *    it survives only as a raw-payload `$blob` (am. 8) and is never offered to users;
 *  - the content is inline bytes. A string (a carrier `LabelURL`, `URL_ONLY` answer or base64 text) is refused: carrier
 *    supplied URLs are never dereferenced (PR6-SEC-06), and adapters decode base64 themselves;
 *  - only blank or BOM bytes may precede a header: PDF content starts with `%PDF-` after them (within the first 1024
 *    bytes), and ZPL content has no PDF, raster or markup header after them and holds a `^XA` command anywhere. A raster
 *    or markup payload therefore cannot pass as a PDF, and a document or raster header cannot pass as ZPL. Residuals:
 *    EPL whose field data holds `^XA` passes as ZPL (D-TASK075-21); every real-carrier ZPL and PDF fixture must pass
 *    these checks (TASK-101/135/139/140), because for carriers without `recoverLabel` a refused label is the only copy
 *    lost. The capability guard re-checks every label an adapter returns.
 * `createLabelDocument` only checks and copies; it performs no I/O.
 */
import { Buffer } from 'node:buffer';

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
/** The `^XA` start-of-format command in every letter case. */
const ZPL_START_COMMANDS = ['^XA', '^Xa', '^xA', '^xa'] as const;
/** A document header must start within the first 1024 bytes (the PDF reader rule). */
const LEADING_WINDOW = 1024;
/** Bytes that may precede a document header: NUL, TAB, LF, FF, CR, space and the UTF-8 BOM bytes (PR075-SEC-14). */
const LEADING: ReadonlySet<number> = new Set([0x00, 0x09, 0x0a, 0x0c, 0x0d, 0x20, 0xef, 0xbb, 0xbf]);

/** Offset of the first byte that is not blank or BOM, bounded by the 1024-byte header window. */
const firstSignificant = (bytes: Uint8Array): number => {
  let index = 0;
  while (index < bytes.length && index < LEADING_WINDOW && LEADING.has(bytes[index] ?? -1)) index += 1;
  return index;
};

/**
 * ZPL: after any blank/BOM lead, no foreign magic (PDF, PNG, GIF, JPEG, BMP, markup), and a `^XA` start-of-format
 * command (any case) anywhere in the payload (PR075-SEC-03, R2-m1, PR075-SEC-14). The whole payload is searched with
 * native `Buffer.includes`, so a long `~DG` graphic download before `^XA` is not a false negative: for carriers without
 * label recovery (DHL Express, FedEx) a refused label is the only copy lost.
 */
export function isZpl(bytes: Uint8Array): boolean {
  const body = bytes.subarray(firstSignificant(bytes));
  if (NOT_ZPL.some((magic) => startsWith(body, magic))) return false;
  const buffer = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return ZPL_START_COMMANDS.some((command) => buffer.includes(command, 0, 'latin1'));
}

/**
 * PDF: `%PDF-` at the first byte that is not blank or BOM, starting within the first 1024 bytes (R2-m1, R3-n1). Any
 * other data before the header (HTML, a PNG header, ZPL) is refused (PR075-SEC-14).
 */
export function isPdf(bytes: Uint8Array): boolean {
  const start = firstSignificant(bytes);
  return start < LEADING_WINDOW && startsWith(bytes.subarray(start), PDF_MAGIC);
}

/** Builds a frozen label document; throws `CarrierContractError` for a non-document format or non-byte content. */
export function createLabelDocument(format: string, content: unknown): LabelDocument {
  const issues: string[] = [];
  if (!isDocumentFormat(format)) issues.push(`format ${JSON.stringify(format)} is not a document_format (${DOCUMENT_FORMATS.join(' | ')})`);
  if (!(content instanceof Uint8Array)) issues.push('content must be inline bytes (Uint8Array); carrier URLs and strings are refused');
  else if (content.length === 0) issues.push('content must not be empty');
  else if (format === 'ZPL') {
    if (!isZpl(content)) issues.push('ZPL content must be ZPL (a ^XA command, no PDF, raster or markup header)');
  } else if (isDocumentFormat(format) && !isPdf(content)) issues.push(`${format} content must be a PDF`);
  if (issues.length > 0) throw new CarrierContractError('invalid label document', issues);
  return Object.freeze({ format: format as DocumentFormat, content: Uint8Array.from(content as Uint8Array) });
}
