/**
 * Label documents leave an adapter only as bytes in a `document_format` (ADR-0010 am. 11 items 3 and 6, REQ-DOC-002):
 *  - the format is one of PDF_4X6 | PDF_A4 | PDF_LETTER | ZPL; raster carrier output (GIF, PNG, EPL, SPL) is refused,
 *    it survives only as a raw-payload `$blob` (am. 8) and is never offered to users;
 *  - the content is inline bytes. A string (a carrier `LabelURL`, `URL_ONLY` answer or base64 text) is refused: carrier
 *    supplied URLs are never dereferenced (PR6-SEC-06), and adapters decode base64 themselves;
 *  - PDF content starts with `%PDF-`, so a mislabelled raster payload cannot pass as a PDF.
 * `createLabelDocument` only checks and copies; it performs no I/O.
 */
import { DOCUMENT_FORMATS, type DocumentFormat, isDocumentFormat } from './canonical/codes.js';
import type { LabelDocument } from './canonical/types.js';
import { CarrierContractError } from './errors.js';

/** `%PDF-` */
const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d] as const;

const startsWith = (bytes: Uint8Array, prefix: readonly number[]): boolean =>
  bytes.length >= prefix.length && prefix.every((byte, index) => bytes[index] === byte);

/** Builds a frozen label document; throws `CarrierContractError` for a non-document format or non-byte content. */
export function createLabelDocument(format: string, content: unknown): LabelDocument {
  const issues: string[] = [];
  if (!isDocumentFormat(format)) issues.push(`format ${JSON.stringify(format)} is not a document_format (${DOCUMENT_FORMATS.join(' | ')})`);
  if (!(content instanceof Uint8Array)) issues.push('content must be inline bytes (Uint8Array); carrier URLs and strings are refused');
  else if (content.length === 0) issues.push('content must not be empty');
  else if (isDocumentFormat(format) && format !== 'ZPL' && !startsWith(content, PDF_MAGIC)) issues.push(`${format} content must be a PDF`);
  if (issues.length > 0) throw new CarrierContractError('invalid label document', issues);
  return Object.freeze({ format: format as DocumentFormat, content: Uint8Array.from(content as Uint8Array) });
}
