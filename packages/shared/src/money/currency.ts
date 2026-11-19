/**
 * ISO 4217 currencies and their exponents (minor units) (ADR-0009 §3, REQ-DATA-006, REQ-PRICE-002; TASK-076). The
 * table holds the active ISO 4217 List One codes whose minor unit is a number (the funds, precious metals and testing
 * codes with "N.A." are left out). It is the code-side twin of the `currencies(code, minor_unit)` reference table
 * (data-model §2 reference data, seeded "ISO 4217 in use ... + all with minor units for completeness"); the pure
 * engine needs the exponent without I/O, and an unknown code throws CURRENCY_UNKNOWN instead of defaulting to 2.
 */
import { MoneyError } from './errors.js';

/** Whitespace-separated codes -> list. */
const codes = (text: string): readonly string[] => text.trim().split(/\s+/u);

/** Exponent 0: the minor unit is the major unit. */
const EXPONENT_0 = codes(`
  BIF CLP DJF GNF ISK JPY KMF KRW PYG RWF UGX UYI VND VUV XAF XOF XPF
`);
/** Exponent 3. */
const EXPONENT_3 = codes(`
  BHD IQD JOD KWD LYD OMR TND
`);
/** Exponent 4. */
const EXPONENT_4 = codes(`
  CLF UYW
`);
/** Exponent 2. */
const EXPONENT_2 = codes(`
  AED AFN ALL AMD ANG AOA ARS AUD AWG AZN BAM BBD BDT BGN BMD BND BOB BOV BRL BSD BTN BWP BYN BZD
  CAD CDF CHE CHF CHW CNY COP COU CRC CUP CVE CZK DKK DOP DZD EGP ERN ETB EUR FJD FKP GBP GEL GHS
  GIP GMD GTQ GYD HKD HNL HTG HUF IDR ILS INR IRR JMD KES KGS KHR KPW KYD KZT LAK LBP LKR LRD LSL
  MAD MDL MGA MKD MMK MNT MOP MRU MUR MVR MWK MXN MXV MYR MZN NAD NGN NIO NOK NPR NZD PAB PEN PGK
  PHP PKR PLN QAR RON RSD RUB SAR SBD SCR SDG SEK SGD SHP SLE SOS SRD SSP STN SVC SYP SZL THB TJS
  TMT TOP TRY TTD TWD TZS UAH USD USN UYU UZS VED VES WST XCD XCG YER ZAR ZMW ZWG
`);

/** Code -> exponent. A Map, so no inherited key (`constructor`, `__proto__`) can ever be read as a currency. */
export const CURRENCY_EXPONENTS: ReadonlyMap<string, number> = new Map([
  ...EXPONENT_0.map((code): [string, number] => [code, 0]),
  ...EXPONENT_2.map((code): [string, number] => [code, 2]),
  ...EXPONENT_3.map((code): [string, number] => [code, 3]),
  ...EXPONENT_4.map((code): [string, number] => [code, 4]),
]);

/** True for an ISO 4217 code of the table. */
export function isCurrencyCode(value: unknown): value is string {
  return typeof value === 'string' && CURRENCY_EXPONENTS.has(value);
}

/** The code itself, or CURRENCY_UNKNOWN. */
export function assertCurrencyCode(value: unknown): string {
  if (!isCurrencyCode(value)) throw new MoneyError('CURRENCY_UNKNOWN', 'currency is not an ISO 4217 code with minor units');
  return value;
}

/** The ISO 4217 exponent of the currency (JPY 0, USD 2, KWD 3, CLF 4), or CURRENCY_UNKNOWN. */
export function currencyExponent(code: string): number {
  const exponent = CURRENCY_EXPONENTS.get(code);
  if (exponent === undefined) throw new MoneyError('CURRENCY_UNKNOWN', 'currency is not an ISO 4217 code with minor units');
  return exponent;
}
