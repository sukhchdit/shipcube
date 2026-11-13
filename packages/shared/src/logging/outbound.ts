// Log fields of one outbound carrier/gateway call (PR6-SEC-02 item 3, PR6-SEC-03 item 1, NFR-OBS-001; TASK-010).
// Only identifiers, the route TEMPLATE, the status and the duration are logged: never request/response bodies, full
// URLs, paths with values or query strings. Extra properties on the input are dropped (an allow-list, not a filter).
import { OMITTED, redactString } from './string-redaction.js';
import type { LogFields } from './types.js';

export interface OutboundCallLog {
  /** `DHL`, `FEDEX`, `UPS`, `MOCK`, ... */
  readonly carrierCode: string;
  /** Carrier account identifier (internal UUID, never a carrier credential). */
  readonly accountId: string;
  /** Adapter operation (`rates`, `ship`, `track`, `token`, ...). */
  readonly operation: string;
  /** Route template with placeholders (`/rating/v1/{accountNumber}/rates`), never a concrete URL. */
  readonly routeTemplate: string;
  /** HTTP status, when a response arrived. */
  readonly status?: number;
  readonly durationMs: number;
  /** Normalised error code (`CARRIER_TIMEOUT`, ...). */
  readonly errorCode?: string;
  readonly correlationId?: string;
}

const MAX_IDENTIFIER_LENGTH = 128;
const MAX_TEMPLATE_LENGTH = 256;

/** A route template: a path without query, fragment, scheme/authority or userinfo. */
function routeTemplateField(value: unknown): string {
  if (typeof value !== 'string' || value.length > MAX_TEMPLATE_LENGTH || /[?#@]|:\/\//.test(value)) return OMITTED;
  return redactString(value);
}

function identifierField(value: unknown): string | null {
  return typeof value === 'string' ? redactString(value.slice(0, MAX_IDENTIFIER_LENGTH)) : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** The allow-listed fields of an outbound call line (`carrier.call`); absent optional values are `null`. */
export function outboundCallFields(input: OutboundCallLog): LogFields {
  const duration = numberField(input.durationMs);
  return {
    carrier_code: identifierField(input.carrierCode),
    account_id: identifierField(input.accountId),
    operation: identifierField(input.operation),
    route_template: routeTemplateField(input.routeTemplate),
    status: numberField(input.status),
    duration_ms: duration === null ? null : Math.max(0, Math.round(duration)),
    error_code: identifierField(input.errorCode),
    correlation_id: identifierField(input.correlationId),
  };
}
