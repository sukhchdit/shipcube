/**
 * Audit value redaction (REQ-AUDIT-008/009, NFR-PRIV-002; ADR-0007 §Redaction and classification, §Privacy erasure;
 * US-091; TASK-028). Pure, no I/O.
 *
 *  - {@link redactSecrets}: the denylist walk the writer applies to every JSON value of an entry before it is hashed
 *    (entry.ts): a non-null value under a secret key, or a secret-shaped text, becomes `[REDACTED]`.
 *  - {@link redactRecord}: the registry walk the diff builder (TASK-031) applies to an audited entity's row: each field
 *    takes its class from the classification registry (`packages/shared`); PUBLIC / INTERNAL stay (with secrets still
 *    redacted inside), PERSONAL / SENSITIVE_PERSONAL become {@link PiiValue}s (tokenised into the vault by the writer,
 *    the vault row carrying the class), SECRET becomes `[REDACTED]`. A field without a class fails closed with
 *    {@link UnclassifiedFieldError}, naming the entity and the field, never the value (REQ-AUDIT-009).
 * Field names are looked up in their snake_case column form (`passwordHash` -> `password_hash`).
 */
import { type ClassificationRegistry, CLASSIFICATION_REGISTRY, classificationOf, type FieldClassification } from '@platform/shared';

import { type AuditValue, type DataSubjectRef, pii, PiiValue } from '../entry.js';
import { isSecretKey, isSecretPair, isSecretText, pairedSecretMembers, REDACTED, REDACTED_KEY } from './denylist.js';

/** An audited entity's field without a classification entry (REQ-AUDIT-009: fail closed, never store it unclassified). */
export class UnclassifiedFieldError extends Error {
  constructor(
    readonly entity: string,
    readonly field: string,
  ) {
    super(`audited entity ${entity} has no classification for field ${field} (REQ-AUDIT-009)`);
    this.name = 'UnclassifiedFieldError';
  }
}

const isPlainObject = (value: object): boolean => {
  const proto: unknown = Reflect.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

/** Writes an own data property (a `__proto__` key stays a plain key). */
function define(target: Record<string, unknown>, key: string, value: unknown): void {
  Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}

/**
 * REQ-AUDIT-008: `value` with every non-null value under a denylisted key, and every secret-shaped text, replaced by
 * `[REDACTED]`. Other values are returned as they are (objects and arrays copied); the caller validates the shape.
 */
export function redactSecrets(value: unknown): unknown {
  if (typeof value === 'string') return isSecretText(value) ? REDACTED : value;
  if (value instanceof PiiValue) return isSecretText(value.value) ? REDACTED : value;
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) {
    const items: readonly unknown[] = value;
    const pair = isSecretPair(items);
    return items.map((item, index) => (pair && index === 1 && item !== null ? REDACTED : redactSecrets(item)));
  }
  if (!isPlainObject(value)) return value;
  const entries = Object.entries(value);
  const paired = new Set(pairedSecretMembers(Object.fromEntries(entries)));
  const out: Record<string, unknown> = {};
  let hiddenKeys = 0;
  for (const [key, member] of entries) {
    const stored = isSecretText(key) ? `${REDACTED_KEY}#${String((hiddenKeys += 1))}` : key;
    define(out, stored, member !== null && (isSecretKey(key) || paired.has(key)) ? REDACTED : redactSecrets(member));
  }
  return out;
}

/** `passwordHash` -> `password_hash` (already snake_case names are unchanged). */
export function columnName(field: string): string {
  let out = '';
  for (let index = 0; index < field.length; index += 1) {
    const char = field.charAt(index);
    const lower = char.toLowerCase();
    out += char !== lower && index > 0 ? `_${lower}` : lower;
  }
  return out;
}

/**
 * The text a personal value is tokenised as: a string as it is, anything else as the JSON text of its secret-redacted
 * copy, so a secret nested in a personal object never reaches the vault (PR61-SEC-09).
 */
const personalText = (value: unknown): string => (typeof value === 'string' ? value : JSON.stringify(redactSecrets(value)));

export interface RedactRecordOptions {
  /** Whose personal data the record holds (the user, or the contact row); null when unknown. */
  readonly subject: DataSubjectRef | null;
  /** Defaults to the platform registry. */
  readonly registry?: ClassificationRegistry;
}

function redactField(
  entity: string,
  column: string,
  classification: FieldClassification,
  value: unknown,
  subject: DataSubjectRef | null,
): unknown {
  if (value === null || value === undefined) return null;
  if (classification === 'SECRET' || isSecretKey(column)) return REDACTED;
  if (classification === 'PERSONAL' || classification === 'SENSITIVE_PERSONAL') {
    const text = personalText(value);
    return isSecretText(text) ? REDACTED : pii({ entityName: entity, field: column, classification, value: text, subject });
  }
  return redactSecrets(value);
}

/**
 * The audit value of one row of `entity`: a TABLE name of the registry (`address_book_entries`), not the route
 * descriptor's audit entity (`address`); the diff builder (TASK-031) maps one to the other, and a wrong name fails
 * closed with {@link UnclassifiedFieldError}. Keys are camelCase fields or snake_case columns (`passwordHash` ->
 * `password_hash`). Each field is classified, redacted and marked (AT-US-091-01/-03). Throws
 * {@link UnclassifiedFieldError} for a field the registry does not know.
 */
export function redactRecord(entity: string, record: Readonly<Record<string, unknown>>, options: RedactRecordOptions): AuditValue {
  const registry = options.registry ?? CLASSIFICATION_REGISTRY;
  const out: Record<string, unknown> = {};
  for (const [field, value] of Object.entries(record)) {
    const column = columnName(field);
    const classification = classificationOf(entity, column, registry);
    if (classification === undefined) throw new UnclassifiedFieldError(entity, column);
    define(out, column, redactField(entity, column, classification, value, options.subject));
  }
  return out as AuditValue;
}
