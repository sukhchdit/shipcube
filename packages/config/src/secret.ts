/**
 * Opaque holder for secret material (ADR-0018 §3: secret values live only in process memory).
 * Every serialisation path (`String()`, template literals, `JSON.stringify`, `util.inspect`, Pino) yields a
 * fixed marker, so a configuration object can be logged by mistake without leaking a value. Only `reveal()`
 * returns the value, which makes every read of secret material greppable.
 */
export const REDACTED = '[REDACTED]';

const INSPECT = Symbol.for('nodejs.util.inspect.custom');

export class Secret<T> {
  readonly #value: T;

  constructor(value: T) {
    this.#value = value;
    Object.freeze(this);
  }

  /**
   * Returns the secret value. Callers must not log, persist or echo it. Byte material is returned as a fresh copy
   * (typed arrays cannot be frozen), so no consumer can alter the key bytes another consumer reads.
   */
  reveal(): T {
    const value = this.#value;
    return value instanceof Uint8Array ? (Uint8Array.prototype.slice.call(value) as T) : value;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [INSPECT](): string {
    return REDACTED;
  }
}
