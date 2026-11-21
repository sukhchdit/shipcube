/**
 * Carrier decimal amounts to ADR-0009 `Money` (TASK-075 code review R1-m6, D-TASK075-10; TASK-080). Carrier APIs send
 * amounts as major-unit decimal text (`"12.34"` USD); adapters convert them here, exactly and without `parseFloat`,
 * through `fromMajor` of `@platform/shared`.
 *
 * Stricter than `fromMajor`: only plain decimal text is accepted (an optional leading minus, digits, an optional
 * fraction), never an exponent (`"1e3"`), a plus sign, white space, an empty string or a number. A non-zero digit
 * beyond the currency's exponent (`"12.345"` USD; `"12.340"` USD is exact and accepted), an unknown currency or an
 * amount outside the safe-integer range is invalid carrier data: it leaves as `CarrierError(CARRIER_UNKNOWN_ERROR)`,
 * the carrier layer's answer to a carrier response it cannot use (as the guard turns a contract failure inside an
 * adapter, PR075-SEC-10), with the `MoneyError` reduced to its safe name and code. The message never echoes the
 * value. The adapter passes its carrier and operation, which the error keeps for logs and metrics (code review R1-m4;
 * the guard passes a `CarrierError` through unchanged).
 */
import { fromMajor, type Money } from '@platform/shared';

import { CarrierError, type CarrierErrorOptions } from '../errors.js';

/** Plain major-unit decimal text; the length cap keeps the exact arithmetic bounded. */
const CARRIER_DECIMAL = /^-?\d{1,30}(?:\.\d{1,30})?$/u;

/** Where the amount came from: the carrier code and the adapter operation (never the value). */
export type CarrierAmountContext = Pick<CarrierErrorOptions, 'carrier' | 'operation'>;

/** `"12.34"` USD -> 1234 minor; `"1234"` JPY -> 1234. Invalid carrier data -> `CarrierError(CARRIER_UNKNOWN_ERROR)`. */
export function carrierDecimalToMoney(value: string, currency: string, context: CarrierAmountContext = {}): Money {
  if (typeof value !== 'string' || !CARRIER_DECIMAL.test(value)) {
    throw new CarrierError('CARRIER_UNKNOWN_ERROR', { ...context, cause: { name: 'CarrierAmountError', code: 'MONEY_INVALID' } });
  }
  try {
    return fromMajor(value, currency);
  } catch (error) {
    throw new CarrierError('CARRIER_UNKNOWN_ERROR', { ...context, cause: error });
  }
}
