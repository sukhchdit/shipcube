import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from '@jest/globals';

import type { components } from '../api/types.gen.js';
import {
  CARRIER_ERROR_CODES,
  type CarrierErrorCode,
  DOCUMENT_FORMATS,
  type DocumentFormat,
  isCarrierErrorCode,
  isDocumentFormat,
  isSurchargeCode,
  isTrackingStatus,
  SURCHARGE_CODES,
  TRACKING_STATUSES,
  type TrackingStatus,
} from './carrier.js';

const OPENAPI = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'docs', '03-architecture', 'api', 'openapi.yaml'), 'utf8');

const indentOf = (line: string): number => line.length - line.trimStart().length;

/** The lines of a YAML block: the line matching `head` and every deeper-indented line after it. */
function block(lines: readonly string[], head: RegExp, from = 0): { lines: string[]; at: number } {
  const at = lines.findIndex((line, index) => index >= from && head.test(line));
  if (at < 0) throw new Error(`no line matching ${String(head)}`);
  const indent = indentOf(lines[at] ?? '');
  const end = lines.findIndex((line, index) => index > at && line.trim() !== '' && indentOf(line) <= indent);
  return { lines: lines.slice(at, end < 0 ? undefined : end), at };
}

/** The `enum:` list of `components.schemas.<schema>` or of its property `<property>`, in document order. */
function openApiEnum(schema: string, property?: string): string[] {
  const all = OPENAPI.split(/\r?\n/u);
  const schemas = block(
    all,
    /^ {2}schemas:$/u,
    all.findIndex((line) => line === 'components:'),
  );
  let scope = block(schemas.lines, new RegExp(`^ {4}${schema}:$`, 'u')).lines;
  if (property !== undefined) scope = block(scope, new RegExp(`^ +${property}:$`, 'u')).lines;
  const values = block(scope, /^ +enum:$/u)
    .lines.slice(1)
    .map((line) => /^ +- ([A-Z0-9_]+)$/u.exec(line)?.[1]);
  if (values.length === 0 || values.includes(undefined)) throw new Error(`unexpected enum shape for ${schema}`);
  return values as string[];
}

/** Compile-time equality of two string unions. */
type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
const COMPILE_TIME_PARITY: {
  readonly trackingStatus: Same<components['schemas']['TrackingStatus'], TrackingStatus>;
  readonly carrierErrorCode: Same<components['schemas']['CarrierErrorCode'], CarrierErrorCode>;
  readonly documentFormat: Same<components['schemas']['Document']['format'], DocumentFormat>;
  readonly labelFormats: Same<components['schemas']['CarrierService']['label_formats'][number], DocumentFormat>;
} = { trackingStatus: true, carrierErrorCode: true, documentFormat: true, labelFormats: true };

describe('carrier vocabularies equal their OpenAPI enums (D-TASK075-02, D-ARCH-168; TASK-080)', () => {
  it('TRACKING_STATUSES equals the TrackingStatus schema, element for element', () => {
    expect([...TRACKING_STATUSES]).toEqual(openApiEnum('TrackingStatus'));
  });

  it('CARRIER_ERROR_CODES equals the CarrierErrorCode schema, element for element', () => {
    expect([...CARRIER_ERROR_CODES]).toEqual(openApiEnum('CarrierErrorCode'));
  });

  it('DOCUMENT_FORMATS equals Document.format and CarrierService.label_formats, element for element', () => {
    expect([...DOCUMENT_FORMATS]).toEqual(openApiEnum('Document', 'format'));
    expect([...DOCUMENT_FORMATS]).toEqual(openApiEnum('CarrierService', 'label_formats'));
  });

  it('agrees with the generated contract types at compile time', () => {
    expect(COMPILE_TIME_PARITY).toEqual({ trackingStatus: true, carrierErrorCode: true, documentFormat: true, labelFormats: true });
  });

  it('the surcharge codes have no OpenAPI enum (charge line codes are free text; DR-B30 pin in packages/carriers)', () => {
    expect(OPENAPI).not.toMatch(/^ {4}SurchargeCode:$/mu);
    expect(SURCHARGE_CODES).toContain('CARRIER_OTHER');
  });

  it('each guard accepts exactly its own list', () => {
    const guards = [
      [isSurchargeCode, SURCHARGE_CODES],
      [isCarrierErrorCode, CARRIER_ERROR_CODES],
      [isTrackingStatus, TRACKING_STATUSES],
      [isDocumentFormat, DOCUMENT_FORMATS],
    ] as const;
    for (const [guard, list] of guards) {
      for (const value of list) expect(guard(value)).toBe(true);
      for (const value of ['', 'fuel', 'PDF', 1, null, undefined, {}]) expect(guard(value)).toBe(false);
    }
  });
});
