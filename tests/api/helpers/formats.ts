// In-house Ajv formats for the OpenAPI response validator (US-034, REQ-API-004, api/README.md §16 item 1).
// `ajv-formats` is rejected by the maintenance rule (CLAUDE.md §5), so every `format` the contract uses is defined
// here. A format the contract uses but this table lacks fails the validator setup (`assertKnownFormats`): an unknown
// format is never silently ignored. Every check is a bounded, linear-time test (length caps, no nested quantifiers).
import type { FormatDefinition } from 'ajv';
import type { Ajv2020 } from 'ajv/dist/2020.js';

const MAX_DATE_TIME_LENGTH = 64;
const MAX_EMAIL_LENGTH = 254;
const MAX_EMAIL_LOCAL_LENGTH = 64;
const MAX_URI_LENGTH = 8192;
const INT32_MIN = -(2 ** 31);
const INT32_MAX = 2 ** 31 - 1;
/** |value| < 2^63: the int64 range as far as an IEEE double can tell (2^63 - 1 is not representable). */
const INT64_BOUND = 2 ** 63;

const FULL_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[Tt](\d{2}):(\d{2}):(\d{2})(?:\.\d{1,9})?(?:[Zz]|([+-])(\d{2}):(\d{2}))$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const EMAIL_LOCAL = /^[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+(?:\.[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]+)*$/;
const DOMAIN_LABEL = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;
const URI_SCHEME = /^[A-Za-z][A-Za-z0-9+.-]*:/;
/** RFC 3986 unreserved + reserved + `%` (percent-encodings are checked separately). */
const URI_CHARACTERS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;=%]*$/;
const BROKEN_PERCENT_ENCODING = /%(?![0-9A-Fa-f]{2})/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function isCalendarDate(year: string, month: string, day: string): boolean {
  const m = Number(month);
  const d = Number(day);
  return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(Number(year), m);
}

/** RFC 3339 `full-date`. */
export function isDate(value: string): boolean {
  const match = FULL_DATE.exec(value);
  return match !== null && isCalendarDate(match[1] ?? '', match[2] ?? '', match[3] ?? '');
}

/** RFC 3339 `date-time` (`T`/`Z` in either case, optional fraction, `Z` or a `±hh:mm` offset; leap second only at 23:59). */
export function isDateTime(value: string): boolean {
  if (value.length > MAX_DATE_TIME_LENGTH) return false;
  const match = DATE_TIME.exec(value);
  if (match === null) return false;
  const [, year = '', month = '', day = '', hour = '', minute = '', second = '', , offsetHour, offsetMinute] = match;
  if (!isCalendarDate(year, month, day)) return false;
  const h = Number(hour);
  const m = Number(minute);
  const s = Number(second);
  const leapSecond = s === 60 && h === 23 && m === 59;
  if (h > 23 || m > 59 || (s > 59 && !leapSecond)) return false;
  return offsetHour === undefined || (Number(offsetHour) <= 23 && Number(offsetMinute) <= 59);
}

/** RFC 9562 textual UUID, any version (incl. nil and max), either case. */
export function isUuid(value: string): boolean {
  return UUID.test(value);
}

/** Pragmatic RFC 5321 mailbox: dot-atom local part (≤ 64), host name of LDH labels (each ≤ 63), total ≤ 254. */
export function isEmail(value: string): boolean {
  if (value.length > MAX_EMAIL_LENGTH) return false;
  const at = value.lastIndexOf('@');
  if (at <= 0 || at !== value.indexOf('@')) return false;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  if (local.length > MAX_EMAIL_LOCAL_LENGTH || !EMAIL_LOCAL.test(local)) return false;
  const labels = domain.split('.');
  return domain.length > 0 && labels.every((label) => DOMAIN_LABEL.test(label));
}

/** RFC 3986 absolute URI: a scheme, only URI characters, well-formed percent-encodings, parseable by WHATWG URL. */
export function isUri(value: string): boolean {
  if (value.length > MAX_URI_LENGTH) return false;
  if (!URI_SCHEME.test(value) || !URI_CHARACTERS.test(value) || BROKEN_PERCENT_ENCODING.test(value)) return false;
  return URL.canParse(value);
}

export function isInt32(value: number): boolean {
  return Number.isInteger(value) && value >= INT32_MIN && value <= INT32_MAX;
}

export function isInt64(value: number): boolean {
  return Number.isInteger(value) && Math.abs(value) < INT64_BOUND;
}

const stringFormat = (validate: (value: string) => boolean): FormatDefinition<string> => ({ type: 'string', validate });
const numberFormat = (validate: (value: number) => boolean): FormatDefinition<number> => ({ type: 'number', validate });

/** Every format the validator understands. Keep in step with the `format` values of openapi.yaml. */
export const CONTRACT_FORMATS: Readonly<Record<string, FormatDefinition<string> | FormatDefinition<number>>> = Object.freeze({
  'date-time': stringFormat(isDateTime),
  date: stringFormat(isDate),
  uuid: stringFormat(isUuid),
  email: stringFormat(isEmail),
  uri: stringFormat(isUri),
  int32: numberFormat(isInt32),
  int64: numberFormat(isInt64),
});

/** Throws when the contract uses a format this module does not define (setup must fail, not ignore it). */
export function assertKnownFormats(used: Iterable<string>): void {
  const unknown = [...new Set(used)].filter((format) => !Object.hasOwn(CONTRACT_FORMATS, format)).sort();
  if (unknown.length > 0) {
    throw new Error(`The contract uses format(s) with no validator in tests/api/helpers/formats.ts: ${unknown.join(', ')}`);
  }
}

export function registerContractFormats(ajv: Ajv2020): void {
  for (const [name, definition] of Object.entries(CONTRACT_FORMATS)) ajv.addFormat(name, definition);
}
