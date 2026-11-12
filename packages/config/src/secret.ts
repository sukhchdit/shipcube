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

  /** Returns the secret value. Callers must not log, persist or echo it. */
  reveal(): T {
    return this.#value;
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
