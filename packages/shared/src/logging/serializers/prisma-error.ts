// Database, Prisma and driver errors in logs (PR7-SEC-03 item 3, ADR-0005 amendment 10 item 6, US-008; TASK-010).
// Their messages, `meta`, `originalMessage`, `detail`, `hint`, `where` and rendered queries carry table names and input
// values, so the log keeps only validated identifiers: `{ name, code?, originalCode?, kind? }`. Nothing else is read
// into the output, and every read is an own-data-property read (no getter is invoked).
import { constructorName, hasOwnKey, inheritedDataProperty, ownDataProperty, ownString } from '../own-property.js';

/** The only shape a database error takes in a log line. */
export interface SerializedDatabaseError {
  readonly name: string;
  /** Prisma `P\d{4}` or a SQLSTATE. */
  readonly code?: string;
  /** SQLSTATE reported by the driver underneath a Prisma error. */
  readonly originalCode?: string;
  /** Driver-adapter error kind (`postgres`, ...). */
  readonly kind?: string;
}

const IDENTIFIER = /^[A-Za-z][A-Za-z0-9_]{0,63}$/;
const PRISMA_CODE = /^P\d{4}$/;
const SQLSTATE = /^[0-9A-Z]{5}$/;
const PRISMA_ERROR_NAME = /^PrismaClient\w{0,64}Error$/;
const DATABASE_ERROR_NAMES: ReadonlySet<string> = new Set(['DriverAdapterError', 'DatabaseError', 'DbError']);
const DATABASE_ERROR_KEYS = ['clientVersion', 'meta', 'originalCode', 'originalMessage', 'sqlState'] as const;

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string' && IDENTIFIER.test(value);
}

/**
 * Class name for a log line: the own `name` when it reads like a class name, else the constructor's name, else the
 * inherited `name`; `Error` when none is a valid identifier (pg's DatabaseError sets `name` to the message type
 * `error`, so a lower-case own name defers to the constructor).
 */
export function errorName(value: unknown): string {
  const own = ownString(value, 'name');
  if (isIdentifier(own) && /^[A-Z]/.test(own)) return own;
  const candidates = [constructorName(value), inheritedDataProperty(value, 'name'), own];
  return candidates.find((candidate): candidate is string => isIdentifier(candidate) && candidate !== 'Object') ?? 'Error';
}

/** True for Prisma client errors, driver-adapter errors and pg/driver database errors. */
export function isDatabaseError(value: unknown): boolean {
  const names = [ownString(value, 'name'), constructorName(value)];
  if (names.some((name) => name !== undefined && (PRISMA_ERROR_NAME.test(name) || DATABASE_ERROR_NAMES.has(name)))) {
    return true;
  }
  if (DATABASE_ERROR_KEYS.some((key) => hasOwnKey(value, key))) return true;
  return hasOwnKey(value, 'severity') && hasOwnKey(value, 'routine');
}

function firstMatching(candidates: readonly unknown[], pattern: RegExp): string | undefined {
  const found = candidates.find((candidate) => typeof candidate === 'string' && pattern.test(candidate));
  return typeof found === 'string' ? found : undefined;
}

/** `{ name, code?, originalCode?, kind? }` of a database error; never its message, meta, query or stack. */
export function serializeDatabaseError(value: unknown): SerializedDatabaseError {
  const meta = ownDataProperty(value, 'meta');
  const adapterCause = ownDataProperty(ownDataProperty(meta, 'driverAdapterError'), 'cause');
  const cause = ownDataProperty(value, 'cause');

  const ownCode = ownDataProperty(value, 'code');
  const code = firstMatching([ownCode], PRISMA_CODE) ?? firstMatching([ownCode, ownDataProperty(value, 'sqlState')], SQLSTATE);
  const originalCode = firstMatching(
    [
      ownDataProperty(value, 'originalCode'),
      ownDataProperty(adapterCause, 'originalCode'),
      ownDataProperty(adapterCause, 'code'),
      ownDataProperty(meta, 'code'),
      ownDataProperty(cause, 'originalCode'),
      ownDataProperty(cause, 'code'),
    ],
    SQLSTATE,
  );
  const kind = firstMatching([ownDataProperty(adapterCause, 'kind'), ownDataProperty(cause, 'kind')], IDENTIFIER);

  return {
    name: errorName(value),
    ...(code === undefined ? {} : { code }),
    ...(originalCode === undefined ? {} : { originalCode }),
    ...(kind === undefined ? {} : { kind }),
  };
}
